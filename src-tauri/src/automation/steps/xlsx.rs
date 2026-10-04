use std::io::Write;
use std::path::Path;

use serde_json::Value;

use crate::db::export_formats::escape_xml;

pub const XLSX_MAX_ROWS: usize = 1_048_576;
pub const XLSX_MAX_COLUMNS: usize = 16_384;
pub const XLSX_SHEET_NAME_MAX: usize = 31;
pub const DEFAULT_SHEET_NAME: &str = "Daten";

const INVALID_SHEET_CHARS: [char; 7] = ['\\', '/', '?', '*', '[', ']', ':'];

const CONTENT_TYPES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>"#;

const ROOT_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#;

const WORKBOOK_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#;

const STYLES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#;

pub struct XlsxOptions<'a> {
    pub sheet_name: &'a str,
    pub header: bool,
    pub null_text: &'a str,
}

#[derive(Debug, PartialEq)]
pub enum Cell {
    Empty,
    Number(String),
    Text(String),
}

pub fn sheet_name_error(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Some("Blattname darf nicht leer sein.".into());
    }
    if trimmed.chars().count() > XLSX_SHEET_NAME_MAX {
        return Some(format!(
            "Blattname darf höchstens {XLSX_SHEET_NAME_MAX} Zeichen haben."
        ));
    }
    let bad: Vec<String> = INVALID_SHEET_CHARS
        .iter()
        .filter(|ch| trimmed.contains(**ch))
        .map(|ch| ch.to_string())
        .collect();
    if !bad.is_empty() {
        return Some(format!(
            "Blattname darf diese Zeichen nicht enthalten: {}",
            bad.join(" ")
        ));
    }
    if trimmed.starts_with('\'') || trimmed.ends_with('\'') {
        return Some("Blattname darf nicht mit einem Apostroph beginnen oder enden.".into());
    }
    None
}

pub fn column_ref(index: usize) -> String {
    let mut n = index + 1;
    let mut letters = Vec::new();
    while n > 0 {
        let rest = (n - 1) % 26;
        letters.push((b'A' + rest as u8) as char);
        n = (n - 1) / 26;
    }
    letters.iter().rev().collect()
}

pub fn is_numeric_cell_text(text: &str) -> bool {
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pattern = PATTERN.get_or_init(|| {
        regex::Regex::new(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$")
            .expect("Zahlenmuster")
    });
    if !pattern.is_match(text) {
        return false;
    }
    let digits: String = text.chars().filter(char::is_ascii_digit).collect();
    if digits.trim_start_matches('0').len() > 15 {
        return false;
    }
    text.parse::<f64>().is_ok_and(f64::is_finite)
}

pub fn cell_for(value: &Value, null_text: &str) -> Cell {
    let text = match value {
        Value::Null => null_text.to_string(),
        Value::String(text) => text.clone(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        other => other.to_string(),
    };
    if text.is_empty() {
        return Cell::Empty;
    }
    let numeric_source = matches!(value, Value::Number(_) | Value::String(_));
    if numeric_source && is_numeric_cell_text(&text) {
        Cell::Number(text)
    } else {
        Cell::Text(text)
    }
}

fn cell_xml(out: &mut String, reference: &str, cell: &Cell, style: u8) {
    let style = if style > 0 {
        format!(" s=\"{style}\"")
    } else {
        String::new()
    };
    match cell {
        Cell::Empty => out.push_str(&format!("<c r=\"{reference}\"{style}/>")),
        Cell::Number(text) => out.push_str(&format!("<c r=\"{reference}\"{style}><v>{text}</v></c>")),
        Cell::Text(text) => out.push_str(&format!(
            "<c r=\"{reference}\"{style} t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
            escape_xml(text)
        )),
    }
}

pub fn input_error(columns: &[String], rows: usize, options: &XlsxOptions<'_>) -> Option<String> {
    if let Some(error) = sheet_name_error(options.sheet_name) {
        return Some(error);
    }
    if columns.is_empty() {
        return Some("Keine Spalten für den Export vorhanden.".into());
    }
    if columns.len() > XLSX_MAX_COLUMNS {
        return Some(format!(
            "Excel unterstützt höchstens {XLSX_MAX_COLUMNS} Spalten, gewählt sind {}.",
            columns.len()
        ));
    }
    let needed = rows + usize::from(options.header);
    if needed > XLSX_MAX_ROWS {
        return Some(format!(
            "Excel unterstützt höchstens {XLSX_MAX_ROWS} Zeilen, benötigt werden {needed}."
        ));
    }
    None
}

pub fn write(
    path: &Path,
    columns: &[String],
    rows: &[Value],
    options: &XlsxOptions<'_>,
) -> Result<u64, String> {
    if let Some(error) = input_error(columns, rows.len(), options) {
        return Err(error);
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Datei kann nicht geschrieben werden: {e}"))?;
    let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(temp));
    let file_options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    let workbook = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{}" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        escape_xml(options.sheet_name.trim())
    );
    let fixed = [
        ("[Content_Types].xml", CONTENT_TYPES_XML.to_string()),
        ("_rels/.rels", ROOT_RELS_XML.to_string()),
        ("xl/workbook.xml", workbook),
        ("xl/_rels/workbook.xml.rels", WORKBOOK_RELS_XML.to_string()),
        ("xl/styles.xml", STYLES_XML.to_string()),
    ];
    let write_err = |e: std::io::Error| format!("Schreibfehler: {e}");
    for (name, content) in fixed {
        zip.start_file(name, file_options)
            .map_err(super::output::zip_error)?;
        zip.write_all(content.as_bytes()).map_err(write_err)?;
    }
    zip.start_file("xl/worksheets/sheet1.xml", file_options)
        .map_err(super::output::zip_error)?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#,
    )
    .map_err(write_err)?;
    let refs: Vec<String> = (0..columns.len()).map(column_ref).collect();
    let mut row_index = 1usize;
    let mut line = String::new();
    if options.header {
        line.push_str(&format!("<row r=\"{row_index}\">"));
        for (i, column) in columns.iter().enumerate() {
            cell_xml(
                &mut line,
                &format!("{}{row_index}", refs[i]),
                &Cell::Text(column.clone()),
                1,
            );
        }
        line.push_str("</row>");
        zip.write_all(line.as_bytes()).map_err(write_err)?;
        row_index += 1;
    }
    for row in rows {
        line.clear();
        line.push_str(&format!("<row r=\"{row_index}\">"));
        for (i, column) in columns.iter().enumerate() {
            let value = row.get(column).unwrap_or(&Value::Null);
            cell_xml(
                &mut line,
                &format!("{}{row_index}", refs[i]),
                &cell_for(value, options.null_text),
                0,
            );
        }
        line.push_str("</row>");
        zip.write_all(line.as_bytes()).map_err(write_err)?;
        row_index += 1;
    }
    zip.write_all(b"</sheetData></worksheet>")
        .map_err(write_err)?;
    let mut buffered = zip.finish().map_err(super::output::zip_error)?;
    buffered.flush().map_err(write_err)?;
    let temp = buffered
        .into_inner()
        .map_err(|e| format!("Schreibfehler: {e}"))?;
    temp.as_file().sync_all().map_err(write_err)?;
    temp.persist(path)
        .map_err(|e| format!("Exportdatei kann nicht ersetzt werden: {e}"))?;
    Ok(rows.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use calamine::{Data, Reader};
    use serde_json::json;

    #[test]
    fn helpers_match_typescript() {
        assert_eq!(column_ref(0), "A");
        assert_eq!(column_ref(25), "Z");
        assert_eq!(column_ref(26), "AA");
        assert_eq!(column_ref(16_383), "XFD");
        assert!(is_numeric_cell_text("-12.5e3"));
        assert!(!is_numeric_cell_text("007"));
        assert!(!is_numeric_cell_text("1234567890123456"));
        assert!(!is_numeric_cell_text("1."));
        assert_eq!(sheet_name_error("Daten"), None);
        assert!(sheet_name_error(" ").is_some());
        assert!(sheet_name_error("a/b").unwrap().contains('/'));
        assert!(sheet_name_error("'x").is_some());
        assert!(sheet_name_error(&"x".repeat(32)).is_some());
        assert_eq!(cell_for(&json!(null), ""), Cell::Empty);
        assert_eq!(cell_for(&json!(null), "NULL"), Cell::Text("NULL".into()));
        assert_eq!(cell_for(&json!("42"), ""), Cell::Number("42".into()));
        assert_eq!(cell_for(&json!(true), ""), Cell::Text("true".into()));
        assert_eq!(
            cell_for(&json!({"a": 1}), ""),
            Cell::Text("{\"a\":1}".into())
        );
    }

    #[test]
    fn workbook_reads_back_with_calamine() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.xlsx");
        let columns = vec!["id".to_string(), "name".to_string(), "betrag".to_string()];
        let rows = vec![
            json!({"id": 1, "name": "Zoë & <Ünïcode> 🚀", "betrag": 12.5}),
            json!({"id": 2, "name": null, "betrag": "2026-10-04"}),
        ];
        let written = write(
            &path,
            &columns,
            &rows,
            &XlsxOptions {
                sheet_name: "Bericht",
                header: true,
                null_text: "",
            },
        )
        .unwrap();
        assert_eq!(written, 2);
        let mut workbook = calamine::open_workbook_auto(&path).unwrap();
        assert_eq!(workbook.sheet_names(), vec!["Bericht".to_string()]);
        let range = workbook.worksheet_range("Bericht").unwrap();
        assert_eq!(range.get_size(), (3, 3));
        assert_eq!(range.get((0, 1)), Some(&Data::String("name".into())));
        assert_eq!(range.get((1, 0)), Some(&Data::Float(1.0)));
        assert_eq!(
            range.get((1, 1)),
            Some(&Data::String("Zoë & <Ünïcode> 🚀".into()))
        );
        assert_eq!(range.get((1, 2)), Some(&Data::Float(12.5)));
        assert!(matches!(range.get((2, 1)), None | Some(Data::Empty)));
        assert_eq!(range.get((2, 2)), Some(&Data::String("2026-10-04".into())));
        assert!(write(
            &path,
            &columns,
            &rows,
            &XlsxOptions {
                sheet_name: "a:b",
                header: true,
                null_text: "",
            },
        )
        .is_err());
    }
}
