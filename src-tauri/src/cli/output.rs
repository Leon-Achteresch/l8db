use comfy_table::{presets::UTF8_FULL_CONDENSED, ContentArrangement, Table};
use serde_json::Value;
use std::io::{IsTerminal, Write};

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum Format {
    Table,
    Json,
    Ndjson,
    Csv,
    Tsv,
}

impl Format {
    pub fn resolve(requested: Option<Format>) -> Format {
        requested.unwrap_or(if std::io::stdout().is_terminal() {
            Format::Table
        } else {
            Format::Tsv
        })
    }
}

const TABLE_CELL_CHARS: usize = 80;

pub fn cell(row: &Value, column: &str, index: usize) -> Value {
    match row {
        Value::Object(map) => map.get(column).cloned().unwrap_or(Value::Null),
        Value::Array(list) => list.get(index).cloned().unwrap_or(Value::Null),
        other => other.clone(),
    }
}

fn plain(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

fn table_text(value: &Value) -> String {
    let Some(text) = plain(value) else {
        return "NULL".into();
    };
    let flat = text.replace(['\t', '\n', '\r'], " ");
    if flat.chars().count() > TABLE_CELL_CHARS {
        let cut: String = flat.chars().take(TABLE_CELL_CHARS - 1).collect();
        format!("{cut}…")
    } else {
        flat
    }
}

fn csv_field(text: &str) -> String {
    if text.contains([',', '"', '\n', '\r']) || text.starts_with(' ') || text.ends_with(' ') {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.to_string()
    }
}

fn tsv_field(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('\t', "\\t")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn terminal_width() -> Option<u16> {
    terminal_size::terminal_size().map(|(width, _)| width.0)
}

pub fn write_rows(
    out: &mut impl Write,
    format: Format,
    columns: &[String],
    rows: &[Value],
) -> std::io::Result<()> {
    match format {
        Format::Table => {
            let mut table = Table::new();
            table
                .load_preset(UTF8_FULL_CONDENSED)
                .set_content_arrangement(ContentArrangement::Dynamic)
                .set_header(columns.iter().map(String::as_str));
            if let Some(width) = terminal_width().filter(|width| *width >= 40) {
                table.set_width(width);
            }
            for row in rows {
                table.add_row(
                    columns
                        .iter()
                        .enumerate()
                        .map(|(index, column)| table_text(&cell(row, column, index))),
                );
            }
            writeln!(out, "{table}")
        }
        Format::Json => {
            let objects: Vec<Value> = rows.iter().map(|row| object(columns, row)).collect();
            serde_json::to_writer_pretty(&mut *out, &objects)?;
            writeln!(out)
        }
        Format::Ndjson => {
            for row in rows {
                serde_json::to_writer(&mut *out, &object(columns, row))?;
                writeln!(out)?;
            }
            Ok(())
        }
        Format::Csv | Format::Tsv => {
            let (separator, field): (&str, fn(&str) -> String) = if format == Format::Csv {
                (",", csv_field)
            } else {
                ("\t", tsv_field)
            };
            let header: Vec<String> = columns.iter().map(|column| field(column)).collect();
            writeln!(out, "{}", header.join(separator))?;
            for row in rows {
                let line: Vec<String> = columns
                    .iter()
                    .enumerate()
                    .map(|(index, column)| {
                        plain(&cell(row, column, index))
                            .map(|text| field(&text))
                            .unwrap_or_default()
                    })
                    .collect();
                writeln!(out, "{}", line.join(separator))?;
            }
            Ok(())
        }
    }
}

fn object(columns: &[String], row: &Value) -> Value {
    Value::Object(
        columns
            .iter()
            .enumerate()
            .map(|(index, column)| (column.clone(), cell(row, column, index)))
            .collect(),
    )
}

pub fn write_list(
    out: &mut impl Write,
    format: Format,
    header: &str,
    items: &[String],
) -> std::io::Result<()> {
    let columns = [header.to_string()];
    let rows: Vec<Value> = items
        .iter()
        .map(|item| Value::Array(vec![Value::String(item.clone())]))
        .collect();
    write_rows(out, format, &columns, &rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn render(format: Format, columns: &[&str], rows: &[Value]) -> String {
        let columns: Vec<String> = columns.iter().map(|c| c.to_string()).collect();
        let mut out = Vec::new();
        write_rows(&mut out, format, &columns, rows).unwrap();
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn csv_quotes_and_nulls() {
        let text = render(
            Format::Csv,
            &["id", "name"],
            &[json!({"id": 1, "name": "a,\"b\""}), json!([2, null])],
        );
        assert_eq!(text, "id,name\n1,\"a,\"\"b\"\"\"\n2,\n");
    }

    #[test]
    fn tsv_escapes_control_characters() {
        let text = render(Format::Tsv, &["v"], &[json!({"v": "a\tb\nc"})]);
        assert_eq!(text, "v\na\\tb\\nc\n");
    }

    #[test]
    fn json_keeps_column_order_and_types() {
        let text = render(Format::Ndjson, &["b", "a"], &[json!([true, null])]);
        assert_eq!(text, "{\"b\":true,\"a\":null}\n");
    }

    #[test]
    fn table_shows_null_and_cuts_long_cells() {
        let long = "x".repeat(200);
        let text = render(Format::Table, &["v", "w"], &[json!({"v": null, "w": long})]);
        assert!(text.contains("NULL"));
        assert!(text.contains('…'));
        assert!(!text.contains(&"x".repeat(100)));
    }
}
