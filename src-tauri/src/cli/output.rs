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

pub fn table_text(value: &Value) -> String {
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
    if text.is_empty()
        || text.contains([',', '"', '\n', '\r'])
        || text.starts_with(' ')
        || text.ends_with(' ')
    {
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

fn write_table(
    out: &mut impl Write,
    columns: &[String],
    rows: &[Value],
    width: Option<u16>,
) -> std::io::Result<()> {
    let cells: Vec<Vec<String>> = rows
        .iter()
        .map(|row| {
            columns
                .iter()
                .enumerate()
                .map(|(index, column)| table_text(&cell(row, column, index)))
                .collect()
        })
        .collect();
    let chars = |text: &String| text.chars().count();
    let needed: usize = columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let widest = cells.iter().filter_map(|row| row.get(index)).map(chars);
            widest.max().unwrap_or(0).max(chars(column)) + 3
        })
        .sum::<usize>()
        + 1;
    if columns.len() > 1 && width.is_some_and(|width| needed > usize::from(width)) {
        if cells.is_empty() {
            return writeln!(out, "{}", columns.join(", "));
        }
        let key = columns.iter().map(chars).max().unwrap_or(0);
        for (number, row) in cells.iter().enumerate() {
            if number > 0 {
                writeln!(out)?;
            }
            writeln!(out, "Zeile {}", number + 1)?;
            for (column, value) in columns.iter().zip(row) {
                writeln!(out, "  {column:<key$}  {value}")?;
            }
        }
        return Ok(());
    }
    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL_CONDENSED)
        .set_content_arrangement(ContentArrangement::Dynamic)
        .set_header(columns.iter().map(String::as_str));
    if let Some(width) = width {
        table.set_width(width);
    }
    for row in cells {
        table.add_row(row);
    }
    writeln!(out, "{table}")
}

pub fn write_rows(
    out: &mut impl Write,
    format: Format,
    columns: &[String],
    rows: &[Value],
) -> std::io::Result<()> {
    match format {
        Format::Table => write_table(
            out,
            columns,
            rows,
            terminal_width().filter(|width| *width >= 40),
        ),
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
            let (separator, field, null): (&str, fn(&str) -> String, &str) =
                if format == Format::Csv {
                    (",", csv_field, "")
                } else {
                    ("\t", tsv_field, "\\N")
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
                            .unwrap_or_else(|| null.to_string())
                    })
                    .collect();
                writeln!(out, "{}", line.join(separator))?;
            }
            Ok(())
        }
    }
}

fn object(columns: &[String], row: &Value) -> Value {
    let mut map = serde_json::Map::new();
    for (index, column) in columns.iter().enumerate() {
        let mut key = column.clone();
        let mut n = 1;
        while map.contains_key(&key) {
            n += 1;
            key = format!("{column}_{n}");
        }
        map.insert(key, cell(row, column, index));
    }
    Value::Object(map)
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
        let text = render(Format::Tsv, &["v"], &[json!([null]), json!([""])]);
        assert_eq!(text, "v\n\\N\n\n");
        let text = render(Format::Csv, &["v"], &[json!([null]), json!([""])]);
        assert_eq!(text, "v\n\n\"\"\n");
    }

    #[test]
    fn json_keeps_column_order_and_types() {
        let text = render(Format::Ndjson, &["b", "a"], &[json!([true, null])]);
        assert_eq!(text, "{\"b\":true,\"a\":null}\n");
        let text = render(Format::Ndjson, &["id", "id", "id_2"], &[json!([1, 2, 3])]);
        assert_eq!(text, "{\"id\":1,\"id_2\":2,\"id_2_2\":3}\n");
    }

    #[test]
    fn table_shows_null_and_cuts_long_cells() {
        let long = "x".repeat(200);
        let text = render(Format::Table, &["v", "w"], &[json!({"v": null, "w": long})]);
        assert!(text.contains("NULL"));
        assert!(text.contains('…'));
        assert!(!text.contains(&"x".repeat(100)));
    }

    #[test]
    fn tables_wider_than_the_terminal_become_one_record_per_row() {
        let names: Vec<String> = (1..=22).map(|n| format!("SPALTE_{n:02}")).collect();
        let row = |start: i64| Value::Array((0..22).map(|n| json!(start + n)).collect());
        let show = |rows: &[Value], width| {
            let mut out = Vec::new();
            write_table(&mut out, &names, rows, width).unwrap();
            String::from_utf8(out).unwrap()
        };
        let narrow = show(&[row(100), json!([null])], Some(120));
        assert!(narrow.starts_with("Zeile 1\n  SPALTE_01  100\n  SPALTE_02  101\n"));
        assert!(narrow.contains("\n\nZeile 2\n  SPALTE_01  NULL\n"));
        assert!(narrow.lines().all(|line| line.chars().count() <= 120));
        assert_eq!(show(&[], Some(120)), format!("{}\n", names.join(", ")));
        for fits in [show(&[row(100)], Some(400)), show(&[row(100)], None)] {
            assert!(fits.contains("SPALTE_22") && fits.contains('┆') && !fits.contains("Zeile"));
        }
    }
}
