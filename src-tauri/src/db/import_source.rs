use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};

use super::csv_stream::{CsvFileSource, CsvRows, MAX_FILE_BYTES};

pub const PREVIEW_ROWS: usize = 100;
const MAX_WORKBOOK_BYTES: u64 = 256 * 1024 * 1024;
const MAX_JSON_RECORD_BYTES: usize = 16 * 1024 * 1024;

pub type SourceRow = Vec<Option<String>>;
pub type RowStream = Box<dyn Iterator<Item = Result<SourceRow, String>> + Send>;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportFormat {
    #[default]
    Csv,
    Json,
    Ndjson,
    Xlsx,
    Parquet,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportPreview {
    pub columns: Vec<String>,
    pub rows: Vec<SourceRow>,
    pub sheets: Vec<String>,
    pub sheet: Option<String>,
    pub total_rows: Option<u64>,
    pub source_types: Vec<Option<String>>,
}

pub fn open_rows(source: &CsvFileSource) -> Result<RowStream, String> {
    let rows: RowStream = match source.format {
        ImportFormat::Csv => Box::new(CsvRows::open(source)?),
        ImportFormat::Json | ImportFormat::Ndjson => {
            let objects = json_objects(&source.path, source.format)?;
            let keys = source.keys.clone();
            let indices = source.indices.clone();
            Box::new(objects.map(move |object| {
                let object = object?;
                indices
                    .iter()
                    .map(|index| {
                        let key = keys
                            .get(*index)
                            .ok_or_else(|| format!("JSON-Feld {} fehlt.", index + 1))?;
                        Ok(object.get(key).and_then(json_text))
                    })
                    .collect()
            }))
        }
        ImportFormat::Xlsx => {
            let (_, rows, _) = workbook_rows(&source.path, source.sheet.as_deref())?;
            Box::new(select_columns(
                rows.into_iter()
                    .skip(source.skip_rows + usize::from(source.has_header)),
                source.indices.clone(),
                source.empty_as_null,
            ))
        }
        ImportFormat::Parquet => Box::new(select_columns(
            parquet_rows(&source.path)?.1,
            source.indices.clone(),
            false,
        )),
    };
    Ok(rows)
}

fn select_columns<I>(
    rows: I,
    indices: Vec<usize>,
    empty_as_null: bool,
) -> impl Iterator<Item = Result<SourceRow, String>> + Send
where
    I: Iterator<Item = Result<SourceRow, String>> + Send,
{
    rows.map(move |row| {
        let row = row?;
        indices
            .iter()
            .map(|index| match row.get(*index) {
                Some(Some(text)) if text.is_empty() && empty_as_null => Ok(None),
                Some(value) => Ok(value.clone()),
                None => Ok(None),
            })
            .collect()
    })
}

pub fn preview(
    path: &str,
    format: ImportFormat,
    sheet: Option<&str>,
    skip_rows: usize,
    has_header: bool,
) -> Result<ImportPreview, String> {
    match format {
        ImportFormat::Csv => Err("CSV-Vorschau wird über read_csv_preview geladen.".into()),
        ImportFormat::Json | ImportFormat::Ndjson => {
            let mut columns: Vec<String> = Vec::new();
            let mut objects = Vec::new();
            for object in json_objects(path, format)?.take(PREVIEW_ROWS) {
                let object = object?;
                for key in object.keys() {
                    if !columns.contains(key) {
                        columns.push(key.clone());
                    }
                }
                objects.push(object);
            }
            let rows = objects
                .iter()
                .map(|object| {
                    columns
                        .iter()
                        .map(|key| object.get(key).and_then(json_text))
                        .collect()
                })
                .collect();
            Ok(ImportPreview {
                source_types: vec![None; columns.len()],
                columns,
                rows,
                sheets: Vec::new(),
                sheet: None,
                total_rows: None,
            })
        }
        ImportFormat::Xlsx => {
            let (sheets, rows, selected) = workbook_rows(path, sheet)?;
            let mut rows: Vec<SourceRow> =
                rows.into_iter().skip(skip_rows).collect::<Result<_, _>>()?;
            let total = rows.len() as u64 - u64::from(has_header && !rows.is_empty());
            let width = rows.iter().map(Vec::len).max().unwrap_or(0);
            let header = if has_header && !rows.is_empty() {
                Some(rows.remove(0))
            } else {
                None
            };
            let columns = (0..width)
                .map(|index| {
                    header
                        .as_ref()
                        .and_then(|row| row.get(index).cloned().flatten())
                        .filter(|name| !name.trim().is_empty())
                        .unwrap_or_else(|| format!("Spalte {}", index + 1))
                })
                .collect::<Vec<_>>();
            rows.truncate(PREVIEW_ROWS);
            for row in &mut rows {
                row.resize(width, None);
            }
            Ok(ImportPreview {
                source_types: vec![None; columns.len()],
                columns,
                rows,
                sheets,
                sheet: Some(selected),
                total_rows: Some(total),
            })
        }
        ImportFormat::Parquet => {
            let (columns, rows, total, types) = parquet_preview(path)?;
            Ok(ImportPreview {
                columns,
                rows,
                sheets: Vec::new(),
                sheet: None,
                total_rows: Some(total),
                source_types: types,
            })
        }
    }
}

pub fn json_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

fn open_limited(path: &str, limit: u64, label: &str) -> Result<File, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Import benötigt eine reguläre Datei.".into());
    }
    if metadata.len() > limit {
        return Err(format!(
            "{label} überschreitet {} MiB.",
            limit / 1024 / 1024
        ));
    }
    Ok(file)
}

type JsonObject = serde_json::Map<String, serde_json::Value>;

pub struct JsonObjects {
    reader: BufReader<std::io::Take<File>>,
    format: ImportFormat,
    started: bool,
    done: bool,
    record: usize,
}

fn json_objects(path: &str, format: ImportFormat) -> Result<JsonObjects, String> {
    let file = open_limited(path, MAX_FILE_BYTES, "JSON-Datei")?;
    let mut reader = BufReader::new(file.take(MAX_FILE_BYTES + 1));
    if reader
        .fill_buf()
        .map_err(|error| error.to_string())?
        .starts_with(&[239, 187, 191])
    {
        reader.consume(3);
    }
    Ok(JsonObjects {
        reader,
        format,
        started: false,
        done: false,
        record: 0,
    })
}

impl JsonObjects {
    fn peek(&mut self) -> Result<Option<u8>, String> {
        loop {
            let buffer = self.reader.fill_buf().map_err(|error| error.to_string())?;
            let Some(&byte) = buffer.first() else {
                return Ok(None);
            };
            if byte.is_ascii_whitespace() {
                self.reader.consume(1);
                continue;
            }
            return Ok(Some(byte));
        }
    }

    fn line(&mut self) -> Result<Option<String>, String> {
        loop {
            let mut bytes = Vec::new();
            let read = (&mut self.reader)
                .take(MAX_JSON_RECORD_BYTES as u64 + 1)
                .read_until(b'\n', &mut bytes)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                return Ok(None);
            }
            if bytes.len() > MAX_JSON_RECORD_BYTES {
                return Err("JSON-Datensatz überschreitet 16 MiB.".into());
            }
            let text = String::from_utf8(bytes)
                .map_err(|_| "JSON-Datei ist kein gültiges UTF-8.".to_string())?;
            if !text.trim().is_empty() {
                return Ok(Some(text));
            }
        }
    }

    fn element(&mut self) -> Result<Option<serde_json::Value>, String> {
        if self.format == ImportFormat::Ndjson {
            return match self.line()? {
                Some(line) => serde_json::from_str(&line)
                    .map(Some)
                    .map_err(|error| error.to_string()),
                None => Ok(None),
            };
        }
        if !self.started {
            self.started = true;
            match self.peek()? {
                Some(b'[') => self.reader.consume(1),
                _ => return Err("JSON-Datei muss ein Array von Objekten enthalten.".into()),
            }
            if self.peek()? == Some(b']') {
                self.reader.consume(1);
                return Ok(None);
            }
        } else {
            match self.peek()? {
                Some(b',') => self.reader.consume(1),
                Some(b']') => {
                    self.reader.consume(1);
                    return Ok(None);
                }
                Some(_) => return Err("Komma oder schließende Klammer erwartet.".into()),
                None => return Err("JSON-Array ist nicht abgeschlossen.".into()),
            }
        }
        if self.peek()? != Some(b'{') {
            return Err("Array-Elemente müssen JSON-Objekte sein.".into());
        }
        let mut deserializer = serde_json::Deserializer::from_reader(&mut self.reader);
        serde::Deserialize::deserialize(&mut deserializer)
            .map(Some)
            .map_err(|error| error.to_string())
    }
}

impl Iterator for JsonObjects {
    type Item = Result<JsonObject, String>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        let result = match self.element() {
            Ok(None) => {
                self.done = true;
                return None;
            }
            Ok(Some(serde_json::Value::Object(object))) => Ok(object),
            Ok(Some(_)) => Err("Jeder Datensatz muss ein JSON-Objekt sein.".to_string()),
            Err(error) => Err(error),
        };
        self.record += 1;
        if result.is_err() {
            self.done = true;
        }
        Some(result.map_err(|error| format!("JSON-Datensatz {}: {error}", self.record)))
    }
}

fn cell_text(cell: &calamine::Data) -> Option<String> {
    use calamine::Data;
    match cell {
        Data::Empty => None,
        Data::String(text) => Some(text.clone()),
        Data::Int(value) => Some(value.to_string()),
        Data::Float(value) => Some(if value.fract() == 0.0 && value.abs() < 1e15 {
            format!("{}", *value as i64)
        } else {
            value.to_string()
        }),
        Data::Bool(value) => Some(value.to_string()),
        Data::DateTime(value) => value.as_datetime().map(|moment| {
            if moment.time() == chrono::NaiveTime::MIN {
                moment.format("%Y-%m-%d").to_string()
            } else {
                moment.format("%Y-%m-%d %H:%M:%S%.f").to_string()
            }
        }),
        Data::DateTimeIso(text) | Data::DurationIso(text) => Some(text.clone()),
        Data::Error(error) => Some(format!("#{error:?}")),
    }
}

type WorkbookRows = (Vec<String>, Vec<Result<SourceRow, String>>, String);

fn workbook_rows(path: &str, sheet: Option<&str>) -> Result<WorkbookRows, String> {
    use calamine::Reader;
    open_limited(path, MAX_WORKBOOK_BYTES, "Arbeitsmappe")?;
    let mut workbook =
        calamine::open_workbook_auto(path).map_err(|error| format!("Arbeitsmappe: {error}"))?;
    let sheets = workbook.sheet_names();
    let selected = match sheet {
        Some(name) if sheets.iter().any(|entry| entry == name) => name.to_string(),
        Some(name) => return Err(format!("Tabellenblatt {name} nicht gefunden.")),
        None => sheets
            .first()
            .cloned()
            .ok_or("Arbeitsmappe enthält keine Tabellenblätter.")?,
    };
    let range = workbook
        .worksheet_range(&selected)
        .map_err(|error| format!("Tabellenblatt {selected}: {error}"))?;
    let offset = range
        .start()
        .map(|(_, column)| column as usize)
        .unwrap_or(0);
    let rows = range
        .rows()
        .map(|row| {
            let mut values: SourceRow = vec![None; offset];
            values.extend(row.iter().map(cell_text));
            while values.last().is_some_and(Option::is_none) {
                values.pop();
            }
            Ok(values)
        })
        .collect();
    Ok((sheets, rows, selected))
}

fn parquet_field_text(field: &parquet::record::Field) -> Option<String> {
    use parquet::record::Field;
    match field {
        Field::Null => None,
        Field::Bytes(bytes) => Some(super::hex_blob(bytes.data())),
        Field::Str(text) => Some(text.clone()),
        Field::TimestampMillis(value) => {
            chrono::DateTime::from_timestamp_millis(*value).map(|moment| {
                moment
                    .naive_utc()
                    .format("%Y-%m-%d %H:%M:%S%.f")
                    .to_string()
            })
        }
        Field::TimestampMicros(value) => {
            chrono::DateTime::from_timestamp_micros(*value).map(|moment| {
                moment
                    .naive_utc()
                    .format("%Y-%m-%d %H:%M:%S%.f")
                    .to_string()
            })
        }
        other => json_text(&other.to_json_value()),
    }
}

fn parquet_reader(
    path: &str,
) -> Result<parquet::file::serialized_reader::SerializedFileReader<File>, String> {
    let file = open_limited(path, u64::MAX, "Parquet-Datei")?;
    parquet::file::serialized_reader::SerializedFileReader::new(file)
        .map_err(|error| format!("Parquet: {error}"))
}

type ParquetRows = Box<dyn Iterator<Item = Result<SourceRow, String>> + Send>;

fn parquet_rows(path: &str) -> Result<(Vec<String>, ParquetRows), String> {
    use parquet::file::reader::FileReader;
    let reader = parquet_reader(path)?;
    let columns: Vec<String> = reader
        .metadata()
        .file_metadata()
        .schema_descr()
        .root_schema()
        .get_fields()
        .iter()
        .map(|field| field.name().to_string())
        .collect();
    let rows = reader.into_iter().map(|row| {
        let row = row.map_err(|error| format!("Parquet: {error}"))?;
        Ok(row
            .get_column_iter()
            .map(|(_, field)| parquet_field_text(field))
            .collect())
    });
    Ok((columns, Box::new(rows)))
}

type ParquetPreview = (Vec<String>, Vec<SourceRow>, u64, Vec<Option<String>>);

fn parquet_preview(path: &str) -> Result<ParquetPreview, String> {
    use parquet::file::reader::FileReader;
    let reader = parquet_reader(path)?;
    let metadata = reader.metadata().file_metadata();
    let total = metadata.num_rows().max(0) as u64;
    let types = metadata
        .schema_descr()
        .root_schema()
        .get_fields()
        .iter()
        .map(|field| {
            Some(if field.is_primitive() {
                let info = field.get_basic_info();
                match info.logical_type_ref() {
                    Some(logical) => format!("{logical:?}"),
                    None => format!("{:?}", field.get_physical_type()),
                }
            } else {
                "GROUP".to_string()
            })
        })
        .collect();
    let (columns, rows) = parquet_rows(path)?;
    let rows = rows.take(PREVIEW_ROWS).collect::<Result<Vec<_>, _>>()?;
    Ok((columns, rows, total, types))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn source(path: &str, format: ImportFormat, indices: Vec<usize>) -> CsvFileSource {
        CsvFileSource {
            path: path.into(),
            indices,
            format,
            ..Default::default()
        }
    }

    #[test]
    fn json_array_streams_objects_with_nested_values() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        write!(
            file,
            "\u{feff} [ {{\"id\": 1, \"name\": \"a,b\", \"meta\": {{\"x\": [1]}}}},\n{{\"id\": 2, \"flag\": true, \"name\": null}} ]"
        )
        .unwrap();
        let path = file.path().to_str().unwrap();
        let preview = preview(path, ImportFormat::Json, None, 0, true).unwrap();
        assert_eq!(preview.columns, vec!["id", "name", "meta", "flag"]);
        assert_eq!(preview.rows[1][3], Some("true".into()));
        let mut request = source(path, ImportFormat::Json, vec![0, 2, 3]);
        request.keys = preview.columns.clone();
        let rows = open_rows(&request)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                vec![Some("1".into()), Some("{\"x\":[1]}".into()), None],
                vec![Some("2".into()), None, Some("true".into())],
            ]
        );
    }

    #[test]
    fn json_rejects_non_object_elements_and_truncation() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        write!(file, "[{{\"a\":1}}, 2]").unwrap();
        let mut request = source(file.path().to_str().unwrap(), ImportFormat::Json, vec![0]);
        request.keys = vec!["a".into()];
        let error = open_rows(&request)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap_err();
        assert!(error.contains("Datensatz 2"));
        let mut file = tempfile::NamedTempFile::new().unwrap();
        write!(file, "[{{\"a\":1}}").unwrap();
        request.path = file.path().to_str().unwrap().into();
        assert!(open_rows(&request)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .is_err());
    }

    #[test]
    fn ndjson_skips_blank_lines() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        write!(file, "{{\"a\":\"x\"}}\n\n{{\"b\":2,\"a\":\"y\"}}\r\n").unwrap();
        let path = file.path().to_str().unwrap();
        let preview = preview(path, ImportFormat::Ndjson, None, 0, true).unwrap();
        assert_eq!(preview.columns, vec!["a", "b"]);
        let mut request = source(path, ImportFormat::Ndjson, vec![1, 0]);
        request.keys = preview.columns;
        let rows = open_rows(&request)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                vec![None, Some("x".into())],
                vec![Some("2".into()), Some("y".into())]
            ]
        );
    }

    #[test]
    fn parquet_round_trip_reads_typed_values() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("rows.parquet");
        let columns = vec!["id".to_string(), "name".to_string(), "ok".to_string()];
        let rows = vec![
            serde_json::json!({"id": 1, "name": "a", "ok": true}),
            serde_json::json!({"id": 2, "name": null, "ok": false}),
        ];
        super::super::export_formats::write_rows_file(
            &super::super::export_formats::RowsExportRequest {
                path: path.to_str().unwrap().into(),
                format: super::super::export_formats::FileFormat::Parquet,
                columns,
                column_types: vec![],
                rows,
                masks: vec![],
                title: None,
            },
        )
        .unwrap();
        let path = path.to_str().unwrap();
        let preview = preview(path, ImportFormat::Parquet, None, 0, true).unwrap();
        assert_eq!(preview.columns, vec!["id", "name", "ok"]);
        assert_eq!(preview.total_rows, Some(2));
        let rows = open_rows(&source(path, ImportFormat::Parquet, vec![2, 0, 1]))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                vec![Some("true".into()), Some("1".into()), Some("a".into())],
                vec![Some("false".into()), Some("2".into()), None],
            ]
        );
    }

    #[test]
    fn xlsx_reads_exported_workbook() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("book.xlsx");
        std::fs::write(&path, super::super::export_formats::tests::minimal_xlsx()).unwrap();
        let path = path.to_str().unwrap();
        let preview = preview(path, ImportFormat::Xlsx, None, 0, true).unwrap();
        assert_eq!(preview.sheets, vec!["Daten"]);
        assert_eq!(preview.columns, vec!["id", "name"]);
        assert_eq!(preview.total_rows, Some(2));
        let mut request = source(path, ImportFormat::Xlsx, vec![1, 0]);
        request.has_header = true;
        request.empty_as_null = true;
        let rows = open_rows(&request)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                vec![Some("x".into()), Some("1".into())],
                vec![None, Some("2.5".into())]
            ]
        );
    }
}
