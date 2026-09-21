use serde::Deserialize;
use std::fs::File;
use std::io::{BufRead, BufReader, Bytes, Read};
use std::iter::Peekable;

pub const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_RECORD_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub struct CsvFileSource {
    pub path: String,
    pub delimiter: String,
    pub quote: String,
    pub has_header: bool,
    pub empty_as_null: bool,
    pub indices: Vec<usize>,
}

pub fn preview(path: &str) -> Result<serde_json::Value, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err("CSV-Vorschau benötigt eine reguläre Datei bis 1 GiB.".into());
    }
    let mut bytes = Vec::new();
    file.take(2 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    let partial = metadata.len() > bytes.len() as u64;
    if let Err(error) = std::str::from_utf8(&bytes) {
        if !partial || error.error_len().is_some() {
            return Err("CSV-Datei ist kein gültiges UTF-8.".into());
        }
        bytes.truncate(error.valid_up_to());
    }
    let text = String::from_utf8(bytes).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "text": text, "partial": partial }))
}

struct Utf8Chars {
    bytes: Bytes<std::io::Take<BufReader<File>>>,
    consumed: u64,
}

impl Iterator for Utf8Chars {
    type Item = Result<char, String>;

    fn next(&mut self) -> Option<Self::Item> {
        let first = self.bytes.next()?;
        Some((|| {
            let first = first.map_err(|error| error.to_string())?;
            let length = match first {
                0..=127 => 1,
                194..=223 => 2,
                224..=239 => 3,
                240..=244 => 4,
                _ => return Err("CSV-Datei ist kein gültiges UTF-8.".into()),
            };
            self.consumed += length as u64;
            if self.consumed > MAX_FILE_BYTES {
                return Err("CSV-Datei überschreitet 1 GiB.".into());
            }
            let mut bytes = [first, 0, 0, 0];
            for byte in &mut bytes[1..length] {
                *byte = self
                    .bytes
                    .next()
                    .ok_or("Unvollständiges UTF-8 am Dateiende.")?
                    .map_err(|error| error.to_string())?;
            }
            std::str::from_utf8(&bytes[..length])
                .map_err(|_| "CSV-Datei ist kein gültiges UTF-8.".to_string())?
                .chars()
                .next()
                .ok_or_else(|| "Leeres UTF-8-Zeichen.".into())
        })())
    }
}

pub struct CsvRows {
    characters: Peekable<Utf8Chars>,
    source: CsvFileSource,
    record: usize,
    line: usize,
    done: bool,
}

impl CsvRows {
    pub fn open(source: &CsvFileSource) -> Result<Self, String> {
        if source.delimiter.chars().count() != 1
            || source.quote.chars().count() != 1
            || source.delimiter == source.quote
            || source.delimiter.contains(['\r', '\n'])
            || source.quote.contains(['\r', '\n'])
        {
            return Err("Streaming benötigt verschiedene einzelne Trenn- und Quote-Zeichen ohne Zeilenumbruch.".into());
        }
        let file = File::open(&source.path).map_err(|error| error.to_string())?;
        if !file
            .metadata()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            return Err("Import benötigt eine reguläre Datei.".into());
        }
        if file.metadata().map_err(|error| error.to_string())?.len() > MAX_FILE_BYTES {
            return Err("CSV-Datei überschreitet 1 GiB.".into());
        }
        let mut reader = BufReader::new(file);
        if reader
            .fill_buf()
            .map_err(|error| error.to_string())?
            .starts_with(&[239, 187, 191])
        {
            reader.consume(3);
        }
        Ok(Self {
            characters: Utf8Chars {
                bytes: reader.take(MAX_FILE_BYTES + 1).bytes(),
                consumed: 0,
            }
            .peekable(),
            source: source.clone(),
            record: 0,
            line: 1,
            done: false,
        })
    }

    fn character(&mut self) -> Result<Option<char>, String> {
        self.characters.next().transpose()
    }

    fn record(&mut self) -> Result<Option<Vec<Option<String>>>, String> {
        let mut values = Vec::new();
        let mut field = String::new();
        let mut quoted = false;
        let mut in_quotes = false;
        let mut started = false;
        let mut size = 0;
        let mut start_line = self.line;
        loop {
            let next = self.character()?;
            let Some(character) = next else {
                if in_quotes {
                    return Err(format!(
                        "Nicht geschlossenes Anführungszeichen ab Zeile {start_line}."
                    ));
                }
                if values.is_empty() && !started {
                    return Ok(None);
                }
                values.push(Self::field(field, quoted, self.source.empty_as_null));
                return Ok(Some(values));
            };
            size += character.len_utf8();
            if size > MAX_RECORD_BYTES {
                return Err(format!(
                    "CSV-Datensatz ab Zeile {start_line} überschreitet 1 MiB."
                ));
            }
            if in_quotes {
                if self.source.quote.starts_with(character) {
                    if matches!(self.characters.peek(), Some(Ok(next)) if *next == character) {
                        self.character()?;
                        size += character.len_utf8();
                        field.push(character);
                    } else {
                        in_quotes = false;
                    }
                } else {
                    field.push(character);
                    if character == '\n' {
                        self.line += 1;
                    }
                }
                continue;
            }
            if self.source.quote.starts_with(character) && !started {
                quoted = true;
                in_quotes = true;
                started = true;
                continue;
            }
            if self.source.delimiter.starts_with(character) {
                values.push(Self::field(
                    std::mem::take(&mut field),
                    quoted,
                    self.source.empty_as_null,
                ));
                quoted = false;
                started = false;
                continue;
            }
            if character == '\r' || character == '\n' {
                if character == '\r' && matches!(self.characters.peek(), Some(Ok('\n'))) {
                    self.character()?;
                }
                self.line += 1;
                if values.is_empty() && !started {
                    size = 0;
                    start_line = self.line;
                    continue;
                }
                values.push(Self::field(field, quoted, self.source.empty_as_null));
                return Ok(Some(values));
            }
            field.push(character);
            started = true;
        }
    }

    fn field(text: String, quoted: bool, empty_as_null: bool) -> Option<String> {
        if text.is_empty() && !quoted && empty_as_null {
            None
        } else {
            Some(text)
        }
    }
}

impl Iterator for CsvRows {
    type Item = Result<Vec<Option<String>>, String>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        loop {
            match self.record() {
                Ok(Some(row)) => {
                    self.record += 1;
                    if self.source.has_header && self.record == 1 {
                        continue;
                    }
                    let mapped = self
                        .source
                        .indices
                        .iter()
                        .map(|index| {
                            row.get(*index).cloned().ok_or_else(|| {
                                format!(
                                    "Datensatz {}: CSV-Spalte {} fehlt.",
                                    self.record,
                                    index + 1
                                )
                            })
                        })
                        .collect();
                    return Some(mapped);
                }
                Ok(None) => {
                    self.done = true;
                    return None;
                }
                Err(error) => {
                    self.done = true;
                    return Some(Err(error));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn preview_stops_at_a_valid_utf8_boundary() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(&vec![b'a'; 2 * 1024 * 1024 - 1]).unwrap();
        file.write_all("😀".as_bytes()).unwrap();
        let result = preview(file.path().to_str().unwrap()).unwrap();
        assert_eq!(result["partial"], true);
        assert_eq!(result["text"].as_str().unwrap().len(), 2 * 1024 * 1024 - 1);
    }

    #[test]
    fn csv_stream_accepts_unicode_options_across_buffers() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        let value = format!("{}😀¦x", "a".repeat(8186));
        write!(file, "a¦b\n„{value}„¦„„\n").unwrap();
        let source = CsvFileSource {
            path: file.path().to_str().unwrap().into(),
            delimiter: "¦".into(),
            quote: "„".into(),
            has_header: true,
            empty_as_null: true,
            indices: vec![0, 1],
        };
        assert_eq!(
            CsvRows::open(&source)
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap(),
            vec![vec![Some(value), Some(String::new())]]
        );
    }

    #[test]
    fn csv_stream_preserves_quotes_multiline_and_empty_records() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        write!(file, "v\r\n\r\n\"\"\r\n\"a\n\"\"b\"\"\"\r\n").unwrap();
        let source = CsvFileSource {
            path: file.path().to_str().unwrap().into(),
            delimiter: ",".into(),
            quote: "\"".into(),
            has_header: true,
            empty_as_null: true,
            indices: vec![0],
        };
        let rows = CsvRows::open(&source)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![vec![Some("".into())], vec![Some("a\n\"b\"".into())]]
        );
        write!(file, "\"unfinished").unwrap();
        assert!(CsvRows::open(&source)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap_err()
            .contains("Anführungszeichen"));
    }
}
