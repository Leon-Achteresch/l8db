use std::collections::HashSet;
use std::fs;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

pub const EXPORT_BATCH_ROWS: i64 = 1_000;
pub const EXPORT_MAX_ROWS: i64 = 5_000_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvExportOptions {
    pub delimiter: String,
    pub quote: String,
    pub header: bool,
    pub null_text: String,
    pub line_ending: String,
    pub bom: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaskMode {
    Text,
    Null,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMask {
    pub column: String,
    pub mode: MaskMode,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableExportRequest {
    pub job_id: String,
    pub schema: String,
    pub table: String,
    pub filter: Option<String>,
    pub allow_raw_filter: bool,
    pub order_by: Option<String>,
    pub order_desc: bool,
    pub is_view: bool,
    pub path: String,
    pub options: CsvExportOptions,
    pub masks: Vec<ColumnMask>,
    pub max_rows: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableExportOutcome {
    pub rows: i64,
    pub path: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableExportProgress {
    pub job_id: String,
    pub rows: i64,
}

pub fn validate_csv_options(options: &CsvExportOptions) -> Result<(), String> {
    if options.delimiter.chars().count() != 1 {
        return Err("Trennzeichen muss genau ein Zeichen sein.".to_string());
    }
    if options.quote.chars().count() != 1 {
        return Err("Quote-Zeichen muss genau ein Zeichen sein.".to_string());
    }
    if options.delimiter == options.quote {
        return Err("Trennzeichen und Quote-Zeichen müssen sich unterscheiden.".to_string());
    }
    if options.delimiter == "\r" || options.delimiter == "\n" {
        return Err("Trennzeichen darf kein Zeilenumbruch sein.".to_string());
    }
    if options.line_ending != "\n" && options.line_ending != "\r\n" {
        return Err("Zeilenende muss LF oder CRLF sein.".to_string());
    }
    Ok(())
}

pub fn effective_max_rows(requested: Option<i64>) -> i64 {
    match requested {
        Some(value) if value > 0 => value.min(EXPORT_MAX_ROWS),
        _ => EXPORT_MAX_ROWS,
    }
}

pub fn value_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

pub fn masked_text(
    column: &str,
    value: &serde_json::Value,
    masks: &[ColumnMask],
) -> Option<String> {
    match masks.iter().find(|mask| mask.column == column) {
        Some(mask) => match mask.mode {
            MaskMode::Null => None,
            MaskMode::Text => Some(mask.text.clone().unwrap_or_default()),
        },
        None => value_text(value),
    }
}

pub fn csv_field(text: Option<&str>, options: &CsvExportOptions) -> String {
    let raw = text.unwrap_or(options.null_text.as_str());
    let needs_quote = raw.contains(&options.delimiter)
        || raw.contains(&options.quote)
        || raw.contains('\n')
        || raw.contains('\r')
        || raw != raw.trim();
    if !needs_quote {
        return raw.to_string();
    }
    let escaped = raw.replace(
        options.quote.as_str(),
        &format!("{}{}", options.quote, options.quote),
    );
    format!("{}{}{}", options.quote, escaped, options.quote)
}

pub fn csv_line(fields: &[Option<String>], options: &CsvExportOptions) -> String {
    fields
        .iter()
        .map(|field| csv_field(field.as_deref(), options))
        .collect::<Vec<_>>()
        .join(options.delimiter.as_str())
}

pub fn csv_row_line(
    columns: &[String],
    row: &serde_json::Value,
    masks: &[ColumnMask],
    options: &CsvExportOptions,
) -> String {
    let fields: Vec<Option<String>> = columns
        .iter()
        .map(|column| {
            let value = row.get(column).cloned().unwrap_or(serde_json::Value::Null);
            masked_text(column, &value, masks)
        })
        .collect();
    csv_line(&fields, options)
}

pub struct CsvFileWriter {
    path: PathBuf,
    writer: Option<BufWriter<fs::File>>,
    options: CsvExportOptions,
    wrote_line: bool,
}

impl CsvFileWriter {
    pub fn create(path: &str, options: &CsvExportOptions) -> Result<Self, String> {
        let file = fs::File::create(path)
            .map_err(|e| format!("Datei kann nicht geschrieben werden: {e}"))?;
        let mut writer = Self {
            path: PathBuf::from(path),
            writer: Some(BufWriter::new(file)),
            options: options.clone(),
            wrote_line: false,
        };
        if options.bom {
            writer.write_raw("\u{feff}")?;
        }
        Ok(writer)
    }

    fn write_raw(&mut self, text: &str) -> Result<(), String> {
        let writer = self
            .writer
            .as_mut()
            .ok_or_else(|| "Exportdatei ist bereits geschlossen.".to_string())?;
        writer
            .write_all(text.as_bytes())
            .map_err(|e| format!("Schreibfehler: {e}"))
    }

    pub fn write_line(&mut self, line: &str) -> Result<(), String> {
        if self.wrote_line {
            let eol = self.options.line_ending.clone();
            self.write_raw(&eol)?;
        }
        self.write_raw(line)?;
        self.wrote_line = true;
        Ok(())
    }

    pub fn write_header(&mut self, columns: &[String]) -> Result<(), String> {
        if !self.options.header {
            return Ok(());
        }
        let fields: Vec<Option<String>> = columns.iter().map(|c| Some(c.clone())).collect();
        let line = csv_line(&fields, &self.options);
        self.write_line(&line)
    }

    pub fn finish(mut self) -> Result<(), String> {
        if let Some(mut writer) = self.writer.take() {
            writer.flush().map_err(|e| format!("Schreibfehler: {e}"))?;
        }
        Ok(())
    }

    pub fn abort(mut self) {
        self.writer.take();
        let _ = fs::remove_file(&self.path);
    }
}

fn cancel_registry() -> &'static Mutex<HashSet<String>> {
    static REGISTRY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashSet::new()))
}

pub fn request_cancel(job_id: &str) {
    if let Ok(mut set) = cancel_registry().lock() {
        set.insert(job_id.to_string());
    }
}

pub fn is_cancelled(job_id: &str) -> bool {
    cancel_registry()
        .lock()
        .map(|set| set.contains(job_id))
        .unwrap_or(false)
}

pub fn clear_cancel(job_id: &str) {
    if let Ok(mut set) = cancel_registry().lock() {
        set.remove(job_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> CsvExportOptions {
        CsvExportOptions {
            delimiter: ",".to_string(),
            quote: "\"".to_string(),
            header: true,
            null_text: String::new(),
            line_ending: "\n".to_string(),
            bom: false,
        }
    }

    #[test]
    fn plain_values_are_not_quoted() {
        assert_eq!(csv_field(Some("abc"), &options()), "abc");
    }

    #[test]
    fn delimiter_quote_and_newline_force_quoting() {
        let opts = options();
        assert_eq!(csv_field(Some("a,b"), &opts), "\"a,b\"");
        assert_eq!(csv_field(Some("a\"b"), &opts), "\"a\"\"b\"");
        assert_eq!(csv_field(Some("a\nb"), &opts), "\"a\nb\"");
        assert_eq!(csv_field(Some(" a "), &opts), "\" a \"");
    }

    #[test]
    fn null_uses_null_text() {
        let mut opts = options();
        opts.null_text = "NULL".to_string();
        assert_eq!(csv_field(None, &opts), "NULL");
    }

    #[test]
    fn row_line_serializes_json_values() {
        let columns = vec!["id".to_string(), "name".to_string(), "meta".to_string()];
        let row = serde_json::json!({ "id": 1, "name": "a;b", "meta": null });
        let line = csv_row_line(&columns, &row, &[], &options());
        assert_eq!(line, "1,a;b,");
    }

    #[test]
    fn masks_replace_values_in_output() {
        let columns = vec!["id".to_string(), "email".to_string(), "token".to_string()];
        let row = serde_json::json!({ "id": 7, "email": "a@b.de", "token": "secret" });
        let masks = vec![
            ColumnMask {
                column: "email".to_string(),
                mode: MaskMode::Text,
                text: Some("***".to_string()),
            },
            ColumnMask {
                column: "token".to_string(),
                mode: MaskMode::Null,
                text: None,
            },
        ];
        let mut opts = options();
        opts.null_text = "NULL".to_string();
        let line = csv_row_line(&columns, &row, &masks, &opts);
        assert_eq!(line, "7,***,NULL");
    }

    #[test]
    fn options_are_validated() {
        let mut opts = options();
        opts.delimiter = ";;".to_string();
        assert!(validate_csv_options(&opts).is_err());
        let mut same = options();
        same.quote = ",".to_string();
        assert!(validate_csv_options(&same).is_err());
        assert!(validate_csv_options(&options()).is_ok());
    }

    #[test]
    fn max_rows_is_capped() {
        assert_eq!(effective_max_rows(None), EXPORT_MAX_ROWS);
        assert_eq!(effective_max_rows(Some(0)), EXPORT_MAX_ROWS);
        assert_eq!(effective_max_rows(Some(42)), 42);
        assert_eq!(effective_max_rows(Some(i64::MAX)), EXPORT_MAX_ROWS);
    }
}
