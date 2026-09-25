use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use super::export::{masked_text, ColumnMask, CsvExportOptions, CsvFileWriter, MaskMode};

pub const PARQUET_ROW_GROUP_ROWS: usize = 50_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileFormat {
    #[default]
    Csv,
    Xml,
    Html,
    Parquet,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowsExportRequest {
    pub path: String,
    pub format: FileFormat,
    pub columns: Vec<String>,
    #[serde(default)]
    pub column_types: Vec<String>,
    pub rows: Vec<serde_json::Value>,
    #[serde(default)]
    pub masks: Vec<ColumnMask>,
    #[serde(default)]
    pub title: Option<String>,
}

pub struct AtomicFile {
    path: PathBuf,
    writer: Option<BufWriter<tempfile::NamedTempFile>>,
}

impl AtomicFile {
    pub fn create(path: &str) -> Result<Self, String> {
        let path = PathBuf::from(path);
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| std::path::Path::new("."));
        let file = tempfile::NamedTempFile::new_in(parent)
            .map_err(|e| format!("Datei kann nicht geschrieben werden: {e}"))?;
        Ok(Self {
            path,
            writer: Some(BufWriter::new(file)),
        })
    }

    pub fn write(&mut self, text: &str) -> Result<(), String> {
        self.writer
            .as_mut()
            .ok_or_else(|| "Exportdatei ist bereits geschlossen.".to_string())?
            .write_all(text.as_bytes())
            .map_err(|e| format!("Schreibfehler: {e}"))
    }

    fn take(&mut self) -> Result<BufWriter<tempfile::NamedTempFile>, String> {
        self.writer
            .take()
            .ok_or_else(|| "Exportdatei ist bereits geschlossen.".to_string())
    }

    fn publish(path: &PathBuf, writer: BufWriter<tempfile::NamedTempFile>) -> Result<(), String> {
        let file = writer
            .into_inner()
            .map_err(|e| format!("Schreibfehler: {e}"))?;
        file.as_file()
            .sync_all()
            .map_err(|e| format!("Schreibfehler: {e}"))?;
        file.persist(path)
            .map_err(|e| format!("Exportdatei kann nicht ersetzt werden: {e}"))?;
        Ok(())
    }

    pub fn finish(mut self) -> Result<(), String> {
        let writer = self.take()?;
        Self::publish(&self.path, writer)
    }
}

pub fn escape_xml(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\t' | '\n' | '\r' => out.push(ch),
            c if (c as u32) < 0x20 || c == '\u{FFFE}' || c == '\u{FFFF}' => out.push('\u{FFFD}'),
            c => out.push(c),
        }
    }
    out
}

pub fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParquetKind {
    Bool,
    Int64,
    Double,
    Date,
    Timestamp { utc: bool },
    Text,
}

pub fn parquet_kind_for_type(data_type: &str) -> ParquetKind {
    let lower = data_type.trim().to_ascii_lowercase();
    let base = lower.split('(').next().unwrap_or("").trim().to_string();
    let base = base.strip_prefix("nullable(").unwrap_or(&base).to_string();
    if lower.ends_with("[]") || lower.starts_with("array") {
        return ParquetKind::Text;
    }
    match base.as_str() {
        "bool" | "boolean" | "bit" => ParquetKind::Bool,
        "smallint" | "integer" | "int" | "bigint" | "int2" | "int4" | "int8" | "tinyint"
        | "mediumint" | "smallserial" | "serial" | "bigserial" | "int16" | "int32" | "int64"
        | "int8_t" | "uint8" | "uint16" | "uint32" => ParquetKind::Int64,
        "real" | "float" | "float4" | "float8" | "double" | "double precision" | "binary_float"
        | "binary_double" | "float32" | "float64" => ParquetKind::Double,
        "date" => ParquetKind::Date,
        _ if base.starts_with("timestamp") || base.starts_with("datetime") => {
            ParquetKind::Timestamp {
                utc: lower.contains("with time zone")
                    || base == "timestamptz"
                    || base.contains("offset"),
            }
        }
        _ => ParquetKind::Text,
    }
}

pub fn infer_parquet_kind<'a>(values: impl Iterator<Item = &'a serde_json::Value>) -> ParquetKind {
    let mut kind: Option<ParquetKind> = None;
    for value in values {
        let next = match value {
            serde_json::Value::Null => continue,
            serde_json::Value::Bool(_) => ParquetKind::Bool,
            serde_json::Value::Number(number) if number.is_i64() => ParquetKind::Int64,
            serde_json::Value::Number(_) => ParquetKind::Double,
            _ => return ParquetKind::Text,
        };
        kind = Some(match (kind, next) {
            (None, next) => next,
            (Some(current), next) if current == next => current,
            (Some(ParquetKind::Int64), ParquetKind::Double)
            | (Some(ParquetKind::Double), ParquetKind::Int64) => ParquetKind::Double,
            _ => return ParquetKind::Text,
        });
    }
    kind.unwrap_or(ParquetKind::Text)
}

#[derive(Debug, Clone, PartialEq)]
enum ParquetValue {
    Bool(bool),
    Int(i64),
    Double(f64),
    Date(i32),
    Timestamp(i64),
    Text(String),
}

fn parse_timestamp(text: &str) -> Option<i64> {
    if let Ok(moment) = chrono::DateTime::parse_from_rfc3339(text) {
        return Some(moment.timestamp_micros());
    }
    let normalized = text.replace(' ', "T");
    if let Ok(moment) = chrono::DateTime::parse_from_str(&normalized, "%Y-%m-%dT%H:%M:%S%.f%#z") {
        return Some(moment.timestamp_micros());
    }
    for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"] {
        if let Ok(moment) = chrono::NaiveDateTime::parse_from_str(&normalized, format) {
            return Some(moment.and_utc().timestamp_micros());
        }
    }
    chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .ok()
        .map(|date| {
            date.and_time(chrono::NaiveTime::MIN)
                .and_utc()
                .timestamp_micros()
        })
}

fn parquet_value(
    kind: ParquetKind,
    column: &str,
    value: &serde_json::Value,
) -> Result<Option<ParquetValue>, String> {
    let mismatch = || {
        format!(
            "Spalte {column}: Wert {} passt nicht zum Parquet-Typ {kind:?}.",
            value
        )
    };
    if value.is_null() {
        return Ok(None);
    }
    let text = super::export::value_text(value).unwrap_or_default();
    Ok(Some(match kind {
        ParquetKind::Bool => match value {
            serde_json::Value::Bool(flag) => ParquetValue::Bool(*flag),
            _ => match text.trim().to_ascii_lowercase().as_str() {
                "true" | "t" | "1" => ParquetValue::Bool(true),
                "false" | "f" | "0" => ParquetValue::Bool(false),
                _ => return Err(mismatch()),
            },
        },
        ParquetKind::Int64 => ParquetValue::Int(
            value
                .as_i64()
                .or_else(|| text.trim().parse().ok())
                .ok_or_else(mismatch)?,
        ),
        ParquetKind::Double => ParquetValue::Double(
            value
                .as_f64()
                .or_else(|| text.trim().parse().ok())
                .ok_or_else(mismatch)?,
        ),
        ParquetKind::Date => {
            let date = chrono::NaiveDate::parse_from_str(text.get(..10).unwrap_or(""), "%Y-%m-%d")
                .map_err(|_| mismatch())?;
            let epoch = chrono::NaiveDate::from_ymd_opt(1970, 1, 1).expect("epoch");
            ParquetValue::Date((date - epoch).num_days() as i32)
        }
        ParquetKind::Timestamp { .. } => {
            ParquetValue::Timestamp(parse_timestamp(text.trim()).ok_or_else(mismatch)?)
        }
        ParquetKind::Text => ParquetValue::Text(text),
    }))
}

pub struct ParquetSink {
    path: PathBuf,
    columns: Vec<String>,
    kinds: Vec<ParquetKind>,
    buffer: Vec<Vec<Option<ParquetValue>>>,
    writer: Option<parquet::file::writer::SerializedFileWriter<BufWriter<tempfile::NamedTempFile>>>,
}

fn parquet_error(error: parquet::errors::ParquetError) -> String {
    format!("Parquet: {error}")
}

impl ParquetSink {
    pub fn create(path: &str, columns: &[String], kinds: Vec<ParquetKind>) -> Result<Self, String> {
        use parquet::basic::{LogicalType, Repetition, TimeUnit, Type as Physical};
        use parquet::schema::types::Type;
        if columns.is_empty() {
            return Err("Keine Spalten für den Export vorhanden.".into());
        }
        let mut file = AtomicFile::create(path)?;
        let fields = columns
            .iter()
            .zip(&kinds)
            .map(|(name, kind)| {
                let (physical, logical) = match kind {
                    ParquetKind::Bool => (Physical::BOOLEAN, None),
                    ParquetKind::Int64 => (
                        Physical::INT64,
                        Some(LogicalType::Integer {
                            bit_width: 64,
                            is_signed: true,
                        }),
                    ),
                    ParquetKind::Double => (Physical::DOUBLE, None),
                    ParquetKind::Date => (Physical::INT32, Some(LogicalType::Date)),
                    ParquetKind::Timestamp { utc } => (
                        Physical::INT64,
                        Some(LogicalType::Timestamp {
                            is_adjusted_to_u_t_c: *utc,
                            unit: TimeUnit::MICROS,
                        }),
                    ),
                    ParquetKind::Text => (Physical::BYTE_ARRAY, Some(LogicalType::String)),
                };
                Type::primitive_type_builder(name, physical)
                    .with_repetition(Repetition::OPTIONAL)
                    .with_logical_type(logical)
                    .build()
                    .map(Arc::new)
                    .map_err(parquet_error)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let schema = Type::group_type_builder("schema")
            .with_fields(fields)
            .build()
            .map_err(parquet_error)?;
        let properties = parquet::file::properties::WriterProperties::builder()
            .set_compression(parquet::basic::Compression::SNAPPY)
            .build();
        let writer = parquet::file::writer::SerializedFileWriter::new(
            file.take()?,
            Arc::new(schema),
            Arc::new(properties),
        )
        .map_err(parquet_error)?;
        Ok(Self {
            path: file.path.clone(),
            columns: columns.to_vec(),
            kinds,
            buffer: Vec::new(),
            writer: Some(writer),
        })
    }

    pub fn write_values(&mut self, values: &[serde_json::Value]) -> Result<(), String> {
        let row = self
            .columns
            .iter()
            .zip(&self.kinds)
            .zip(values)
            .map(|((column, kind), value)| parquet_value(*kind, column, value))
            .collect::<Result<Vec<_>, _>>()?;
        self.buffer.push(row);
        if self.buffer.len() >= PARQUET_ROW_GROUP_ROWS {
            self.flush()?;
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<(), String> {
        use parquet::data_type::{
            BoolType, ByteArray, ByteArrayType, DoubleType, Int32Type, Int64Type,
        };
        if self.buffer.is_empty() {
            return Ok(());
        }
        let rows = std::mem::take(&mut self.buffer);
        let writer = self
            .writer
            .as_mut()
            .ok_or("Parquet-Datei ist bereits geschlossen.")?;
        let mut group = writer.next_row_group().map_err(parquet_error)?;
        let mut index = 0;
        while let Some(mut column) = group.next_column().map_err(parquet_error)? {
            let cells = rows.iter().map(|row| row[index].as_ref());
            let levels: Vec<i16> = rows
                .iter()
                .map(|row| i16::from(row[index].is_some()))
                .collect();
            macro_rules! write {
                ($type:ty, $variant:ident, $map:expr) => {{
                    let values: Vec<_> = cells
                        .filter_map(|cell| match cell {
                            Some(ParquetValue::$variant(value)) => Some($map(value)),
                            _ => None,
                        })
                        .collect();
                    column
                        .typed::<$type>()
                        .write_batch(&values, Some(&levels), None)
                        .map_err(parquet_error)?;
                }};
            }
            match self.kinds[index] {
                ParquetKind::Bool => write!(BoolType, Bool, |value: &bool| *value),
                ParquetKind::Int64 => write!(Int64Type, Int, |value: &i64| *value),
                ParquetKind::Double => write!(DoubleType, Double, |value: &f64| *value),
                ParquetKind::Date => write!(Int32Type, Date, |value: &i32| *value),
                ParquetKind::Timestamp { .. } => {
                    write!(Int64Type, Timestamp, |value: &i64| *value)
                }
                ParquetKind::Text => write!(ByteArrayType, Text, |value: &String| {
                    ByteArray::from(value.as_bytes().to_vec())
                }),
            }
            column.close().map_err(parquet_error)?;
            index += 1;
        }
        group.close().map_err(parquet_error)?;
        Ok(())
    }

    pub fn finish(mut self) -> Result<(), String> {
        self.flush()?;
        let writer = self
            .writer
            .take()
            .ok_or("Parquet-Datei ist bereits geschlossen.")?;
        let inner = writer.into_inner().map_err(parquet_error)?;
        AtomicFile::publish(&self.path, inner)
    }
}

pub enum RowSink {
    Csv(CsvFileWriter),
    Xml(AtomicFile),
    Html(AtomicFile),
    Parquet(Box<ParquetSink>),
}

pub struct SinkSpec<'a> {
    pub format: FileFormat,
    pub path: &'a str,
    pub columns: &'a [String],
    pub kinds: Vec<ParquetKind>,
    pub csv: Option<&'a CsvExportOptions>,
    pub title: Option<&'a str>,
}

const HTML_HEAD: &str = "<!DOCTYPE html>\n<html lang=\"de\">\n<head>\n<meta charset=\"utf-8\">\n";

impl RowSink {
    pub fn create(spec: SinkSpec<'_>) -> Result<Self, String> {
        match spec.format {
            FileFormat::Csv => {
                let options = spec.csv.ok_or("CSV-Optionen fehlen.")?;
                let mut writer = CsvFileWriter::create(spec.path, options)?;
                writer.write_header(spec.columns)?;
                Ok(RowSink::Csv(writer))
            }
            FileFormat::Xml => {
                let mut file = AtomicFile::create(spec.path)?;
                file.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rows>\n")?;
                Ok(RowSink::Xml(file))
            }
            FileFormat::Html => {
                let mut file = AtomicFile::create(spec.path)?;
                let title = escape_html(spec.title.unwrap_or("Export"));
                let mut head = format!(
                    "{HTML_HEAD}<title>{title}</title>\n</head>\n<body style=\"margin:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2328;\">\n<table style=\"border-collapse:collapse;font-size:13px;\">\n<thead>\n<tr>"
                );
                for column in spec.columns {
                    head.push_str(&format!(
                        "<th style=\"border:1px solid #d0d7de;background:#f6f8fa;padding:4px 8px;text-align:left;\">{}</th>",
                        escape_html(column)
                    ));
                }
                head.push_str("</tr>\n</thead>\n<tbody>\n");
                file.write(&head)?;
                Ok(RowSink::Html(file))
            }
            FileFormat::Parquet => Ok(RowSink::Parquet(Box::new(ParquetSink::create(
                spec.path,
                spec.columns,
                spec.kinds,
            )?))),
        }
    }

    pub fn write_row(
        &mut self,
        columns: &[String],
        row: &serde_json::Value,
        masks: &[ColumnMask],
        csv: Option<&CsvExportOptions>,
    ) -> Result<(), String> {
        let value = |column: &String| row.get(column).cloned().unwrap_or(serde_json::Value::Null);
        match self {
            RowSink::Csv(writer) => {
                let options = csv.ok_or("CSV-Optionen fehlen.")?;
                writer.write_line(&super::export::csv_row_line(columns, row, masks, options))
            }
            RowSink::Xml(file) => {
                let mut out = String::from("  <row>\n");
                for column in columns {
                    let name = escape_xml(column);
                    match masked_text(column, &value(column), masks) {
                        Some(text) => out.push_str(&format!(
                            "    <column name=\"{name}\">{}</column>\n",
                            escape_xml(&text)
                        )),
                        None => {
                            out.push_str(&format!("    <column name=\"{name}\" null=\"true\"/>\n"))
                        }
                    }
                }
                out.push_str("  </row>\n");
                file.write(&out)
            }
            RowSink::Html(file) => {
                let mut out = String::from("<tr>");
                for column in columns {
                    match masked_text(column, &value(column), masks) {
                        Some(text) => out.push_str(&format!(
                            "<td style=\"border:1px solid #d0d7de;padding:4px 8px;vertical-align:top;white-space:pre-wrap;\">{}</td>",
                            escape_html(&text)
                        )),
                        None => out.push_str(
                            "<td style=\"border:1px solid #d0d7de;padding:4px 8px;color:#8c959f;font-style:italic;\">NULL</td>",
                        ),
                    }
                }
                out.push_str("</tr>\n");
                file.write(&out)
            }
            RowSink::Parquet(sink) => {
                let values: Vec<serde_json::Value> = columns
                    .iter()
                    .map(
                        |column| match masks.iter().find(|mask| &mask.column == column) {
                            Some(mask) if mask.mode == MaskMode::Null => serde_json::Value::Null,
                            Some(mask) => {
                                serde_json::Value::String(mask.text.clone().unwrap_or_default())
                            }
                            None => value(column),
                        },
                    )
                    .collect();
                sink.write_values(&values)
            }
        }
    }

    pub fn finish(self) -> Result<(), String> {
        match self {
            RowSink::Csv(writer) => writer.finish(),
            RowSink::Xml(mut file) => {
                file.write("</rows>\n")?;
                file.finish()
            }
            RowSink::Html(mut file) => {
                file.write("</tbody>\n</table>\n</body>\n</html>\n")?;
                file.finish()
            }
            RowSink::Parquet(sink) => sink.finish(),
        }
    }

    pub fn abort(self) {
        if let RowSink::Csv(writer) = self {
            writer.abort();
        }
    }
}

pub fn parquet_kinds(
    columns: &[String],
    column_types: &[String],
    rows: &[serde_json::Value],
    masks: &[ColumnMask],
) -> Vec<ParquetKind> {
    columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            if masks
                .iter()
                .any(|mask| &mask.column == column && mask.mode == MaskMode::Text)
            {
                return ParquetKind::Text;
            }
            match column_types.get(index).filter(|kind| !kind.is_empty()) {
                Some(data_type) => parquet_kind_for_type(data_type),
                None => infer_parquet_kind(rows.iter().filter_map(|row| row.get(column))),
            }
        })
        .collect()
}

pub fn write_rows_file(request: &RowsExportRequest) -> Result<u64, String> {
    if request.format == FileFormat::Csv {
        return Err("CSV-Export aus geladenen Zeilen erfolgt im Frontend.".into());
    }
    let kinds = if request.format == FileFormat::Parquet {
        parquet_kinds(
            &request.columns,
            &request.column_types,
            &request.rows,
            &request.masks,
        )
    } else {
        Vec::new()
    };
    let mut sink = RowSink::create(SinkSpec {
        format: request.format,
        path: &request.path,
        columns: &request.columns,
        kinds,
        csv: None,
        title: request.title.as_deref(),
    })?;
    for row in &request.rows {
        if let Err(error) = sink.write_row(&request.columns, row, &request.masks, None) {
            sink.abort();
            return Err(error);
        }
    }
    sink.finish()?;
    Ok(request.rows.len() as u64)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = 0xffff_ffffu32;
        for byte in bytes {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    0xedb8_8320 ^ (crc >> 1)
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    fn stored_zip(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, content) in entries {
            let offset = out.len() as u32;
            let crc = crc32(content.as_bytes());
            let size = content.len() as u32;
            let header = |signature: u32, central_entry: bool| {
                let mut bytes = signature.to_le_bytes().to_vec();
                if central_entry {
                    bytes.extend(20u16.to_le_bytes());
                }
                bytes.extend(20u16.to_le_bytes());
                bytes.extend(0u16.to_le_bytes());
                bytes.extend(0u16.to_le_bytes());
                bytes.extend(0u32.to_le_bytes());
                bytes.extend(crc.to_le_bytes());
                bytes.extend(size.to_le_bytes());
                bytes.extend(size.to_le_bytes());
                bytes.extend((name.len() as u16).to_le_bytes());
                bytes.extend(0u16.to_le_bytes());
                if central_entry {
                    bytes.extend([0u8; 6]);
                    bytes.extend(0u32.to_le_bytes());
                    bytes.extend(offset.to_le_bytes());
                }
                bytes.extend(name.as_bytes());
                bytes
            };
            out.extend(header(0x0403_4b50, false));
            out.extend(content.as_bytes());
            central.extend(header(0x0201_4b50, true));
        }
        let start = out.len() as u32;
        out.extend(&central);
        out.extend(0x0605_4b50u32.to_le_bytes());
        out.extend([0u8; 4]);
        out.extend((entries.len() as u16).to_le_bytes());
        out.extend((entries.len() as u16).to_le_bytes());
        out.extend((central.len() as u32).to_le_bytes());
        out.extend(start.to_le_bytes());
        out.extend(0u16.to_le_bytes());
        out
    }

    pub fn minimal_xlsx() -> Vec<u8> {
        stored_zip(&[
            ("[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>"),
            ("_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>"),
            ("xl/workbook.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Daten\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"),
            ("xl/_rels/workbook.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>"),
            ("xl/worksheets/sheet1.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>id</t></is></c><c r=\"B1\" t=\"inlineStr\"><is><t>name</t></is></c></row><row r=\"2\"><c r=\"A2\"><v>1</v></c><c r=\"B2\" t=\"inlineStr\"><is><t>x</t></is></c></row><row r=\"3\"><c r=\"A3\"><v>2.5</v></c><c r=\"B3\" t=\"inlineStr\"><is><t></t></is></c></row></sheetData></worksheet>"),
        ])
    }

    fn request(format: FileFormat, path: &std::path::Path) -> RowsExportRequest {
        RowsExportRequest {
            path: path.to_str().unwrap().into(),
            format,
            columns: vec!["id".into(), "name".into(), "secret".into()],
            column_types: vec![],
            rows: vec![
                serde_json::json!({"id": 1, "name": "<a & \"b\">\u{1}", "secret": "x"}),
                serde_json::json!({"id": 2, "name": null, "secret": "y"}),
            ],
            masks: vec![ColumnMask {
                column: "secret".into(),
                mode: MaskMode::Text,
                text: Some("***".into()),
            }],
            title: Some("t<1>".into()),
        }
    }

    #[test]
    fn xml_escapes_values_and_marks_nulls() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("rows.xml");
        write_rows_file(&request(FileFormat::Xml, &path)).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rows>"));
        assert!(
            text.contains("<column name=\"name\">&lt;a &amp; &quot;b&quot;&gt;\u{FFFD}</column>")
        );
        assert!(text.contains("<column name=\"name\" null=\"true\"/>"));
        assert!(text.contains("<column name=\"secret\">***</column>"));
        assert!(text.trim_end().ends_with("</rows>"));
    }

    #[test]
    fn html_is_standalone_and_escaped() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("rows.html");
        write_rows_file(&request(FileFormat::Html, &path)).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("<!DOCTYPE html>"));
        assert!(text.contains("<title>t&lt;1&gt;</title>"));
        assert!(text.contains("&lt;a &amp; &quot;b&quot;&gt;"));
        assert!(text.contains(">NULL</td>"));
        assert!(text.trim_end().ends_with("</html>"));
    }

    #[test]
    fn parquet_types_follow_database_types_and_values() {
        assert_eq!(parquet_kind_for_type("bigint"), ParquetKind::Int64);
        assert_eq!(parquet_kind_for_type("numeric(10,2)"), ParquetKind::Text);
        assert_eq!(
            parquet_kind_for_type("double precision"),
            ParquetKind::Double
        );
        assert_eq!(
            parquet_kind_for_type("timestamp with time zone"),
            ParquetKind::Timestamp { utc: true }
        );
        assert_eq!(parquet_kind_for_type("date"), ParquetKind::Date);
        assert_eq!(parquet_kind_for_type("integer[]"), ParquetKind::Text);
        let values = [
            serde_json::json!(1),
            serde_json::json!(2.5),
            serde_json::Value::Null,
        ];
        assert_eq!(infer_parquet_kind(values.iter()), ParquetKind::Double);
        let values = [serde_json::json!(true), serde_json::json!("x")];
        assert_eq!(infer_parquet_kind(values.iter()), ParquetKind::Text);
    }

    #[test]
    fn parquet_typed_columns_round_trip() {
        use parquet::file::reader::FileReader;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("rows.parquet");
        let mut sink = ParquetSink::create(
            path.to_str().unwrap(),
            &["d".into(), "ts".into(), "n".into()],
            vec![
                ParquetKind::Date,
                ParquetKind::Timestamp { utc: true },
                ParquetKind::Int64,
            ],
        )
        .unwrap();
        sink.write_values(&[
            serde_json::json!("2024-01-02"),
            serde_json::json!("2024-01-02T03:04:05.5+01:00"),
            serde_json::json!("7"),
        ])
        .unwrap();
        assert!(sink
            .write_values(&[
                serde_json::Value::Null,
                serde_json::Value::Null,
                serde_json::json!("x")
            ])
            .is_err());
        sink.finish().unwrap();
        let reader = parquet::file::serialized_reader::SerializedFileReader::new(
            std::fs::File::open(&path).unwrap(),
        )
        .unwrap();
        assert_eq!(reader.metadata().file_metadata().num_rows(), 1);
        let row = reader.into_iter().next().unwrap().unwrap();
        let text = row.to_string();
        assert!(text.contains("2024-01-02"), "{text}");
        assert!(text.contains("n: 7"), "{text}");
    }

    #[test]
    fn failed_export_keeps_existing_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("rows.parquet");
        std::fs::write(&path, "sentinel").unwrap();
        let mut failing = request(FileFormat::Parquet, &path);
        failing.column_types = vec!["integer".into(), "text".into(), "text".into()];
        failing.rows[1]["id"] = serde_json::json!("abc");
        assert!(write_rows_file(&failing).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "sentinel");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
