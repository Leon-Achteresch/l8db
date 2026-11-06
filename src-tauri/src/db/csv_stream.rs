use serde::Deserialize;
use std::fs::File;
use std::io::{BufRead, BufReader, Bytes, Read};
use std::iter::Peekable;

pub const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_RECORD_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CsvFileSource {
    pub path: String,
    #[serde(default)]
    pub delimiter: String,
    #[serde(default)]
    pub quote: String,
    #[serde(default)]
    pub has_header: bool,
    #[serde(default)]
    pub empty_as_null: bool,
    #[serde(default)]
    pub null_text: Option<String>,
    pub indices: Vec<usize>,
    #[serde(default)]
    pub format: super::import_source::ImportFormat,
    #[serde(default)]
    pub sheet: Option<String>,
    #[serde(default)]
    pub skip_rows: usize,
    #[serde(default)]
    pub keys: Vec<String>,
}

const SAMPLE_BYTES: u64 = 2 * 1024 * 1024;

const CP1252_HIGH: [char; 32] = [
    '\u{20ac}', '\u{81}', '\u{201a}', '\u{192}', '\u{201e}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{2c6}', '\u{2030}', '\u{160}', '\u{2039}', '\u{152}', '\u{8d}', '\u{17d}', '\u{8f}',
    '\u{90}', '\u{2018}', '\u{2019}', '\u{201c}', '\u{201d}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{2dc}', '\u{2122}', '\u{161}', '\u{203a}', '\u{153}', '\u{9d}', '\u{17e}', '\u{178}',
];

fn cp1252_char(byte: u8) -> char {
    match byte {
        0x80..=0x9f => CP1252_HIGH[(byte - 0x80) as usize],
        _ => byte as char,
    }
}

fn is_windows_1252(sample: &[u8], partial: bool) -> bool {
    match std::str::from_utf8(sample) {
        Ok(_) => false,
        Err(error) => !partial || error.error_len().is_some(),
    }
}

fn read_sample(path: &str) -> Result<(Vec<u8>, bool), String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err("CSV-Vorschau benötigt eine reguläre Datei bis 1 GiB.".into());
    }
    let mut bytes = Vec::new();
    file.take(SAMPLE_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    let partial = metadata.len() > bytes.len() as u64;
    Ok((bytes, partial))
}

pub fn preview(path: &str) -> Result<serde_json::Value, String> {
    let (mut bytes, partial) = read_sample(path)?;
    if is_windows_1252(&bytes, partial) {
        let text: String = bytes.iter().map(|byte| cp1252_char(*byte)).collect();
        return Ok(
            serde_json::json!({ "text": text, "partial": partial, "encoding": "windows-1252" }),
        );
    }
    if let Err(error) = std::str::from_utf8(&bytes) {
        bytes.truncate(error.valid_up_to());
    }
    let text = String::from_utf8(bytes).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "text": text, "partial": partial, "encoding": "utf-8" }))
}

struct Utf8Chars {
    bytes: Bytes<std::io::Take<BufReader<File>>>,
    consumed: u64,
    single_byte: bool,
}

impl Iterator for Utf8Chars {
    type Item = Result<char, String>;

    fn next(&mut self) -> Option<Self::Item> {
        let first = self.bytes.next()?;
        Some((|| {
            let first = first.map_err(|error| error.to_string())?;
            if self.single_byte {
                self.consumed += 1;
                return Ok(cp1252_char(first));
            }
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
        let (sample, partial) = read_sample(&source.path)?;
        let single_byte = is_windows_1252(&sample, partial);
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
                single_byte,
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
                values.push(self.field(field, quoted));
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
                let text = std::mem::take(&mut field);
                values.push(self.field(text, quoted));
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
                values.push(self.field(field, quoted));
                return Ok(Some(values));
            }
            field.push(character);
            started = true;
        }
    }

    fn field(&self, text: String, quoted: bool) -> Option<String> {
        let null_text = self
            .source
            .null_text
            .as_deref()
            .filter(|value| !value.is_empty());
        if !quoted
            && ((text.is_empty() && self.source.empty_as_null) || null_text == Some(text.as_str()))
        {
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
    fn windows_1252_files_and_null_text_are_understood() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"name;preis\nM\xfcller \x80;NULL\n\"NULL\";1\n")
            .unwrap();
        let path = file.path().to_str().unwrap();
        let result = preview(path).unwrap();
        assert_eq!(result["encoding"], "windows-1252");
        assert!(result["text"].as_str().unwrap().contains("Müller €"));
        let source = CsvFileSource {
            path: path.into(),
            delimiter: ";".into(),
            quote: "\"".into(),
            has_header: true,
            null_text: Some("NULL".into()),
            indices: vec![0, 1],
            ..Default::default()
        };
        assert_eq!(
            CsvRows::open(&source)
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap(),
            vec![
                vec![Some("Müller €".into()), None],
                vec![Some("NULL".into()), Some("1".into())],
            ]
        );
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
            ..Default::default()
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
            ..Default::default()
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
