use crate::db::ColumnInfo;
use serde_json::Value;
use std::collections::BTreeMap;

type Tables<'a> = BTreeMap<(&'a str, &'a str), Vec<&'a ColumnInfo>>;

fn tables(columns: &[ColumnInfo]) -> Tables<'_> {
    let mut tables = BTreeMap::new();
    for column in columns {
        tables
            .entry((column.schema.as_str(), column.table.as_str()))
            .or_insert_with(Vec::new)
            .push(column);
    }
    tables
}

fn name(key: (&str, &str)) -> String {
    super::server::qualified(key.0, key.1)
}

fn line(key: (&str, &str), columns: &[&ColumnInfo]) -> String {
    format!(
        "{}({})",
        name(key),
        columns
            .iter()
            .map(|column| format!("{} {}", column.name, column.data_type))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

pub(super) fn search(columns: &[ColumnInfo], args: &Value, max_chars: usize) -> String {
    let term = super::server::arg_str(args, "term").trim().to_lowercase();
    let limit = args["limit"].as_u64().unwrap_or(50).clamp(1, 200) as usize;
    let offset = args["offset"].as_u64().unwrap_or(0);
    let matching: Vec<_> = tables(columns)
        .into_iter()
        .filter(|(key, columns)| {
            term.is_empty()
                || name(*key).to_lowercase().contains(&term)
                || columns
                    .iter()
                    .any(|column| column.name.to_lowercase().contains(&term))
        })
        .collect();
    if matching.is_empty() && !term.is_empty() {
        return format!("No tables or columns match '{term}'");
    }
    let total = matching.len();
    let offset = offset.min(usize::MAX as u64) as usize;
    let mut text = format!(
        "{total} {}",
        if term.is_empty() { "tables" } else { "matches" }
    );
    let footer = |next: usize| {
        format!(
            "\n[{} more tables; next offset={next}, limit={limit}]",
            total.saturating_sub(next)
        )
    };
    let mut shown = 0;
    let mut chars = text.chars().count();
    for (key, columns) in matching.iter().skip(offset).take(limit) {
        let mut row = if term.is_empty() {
            name(*key)
        } else {
            line(*key, columns)
        };
        let reserve = footer(offset + shown + 1).chars().count();
        if chars + row.chars().count() + 1 + reserve > max_chars && !term.is_empty() {
            row = format!("{} [columns omitted; use describe]", name(*key));
        }
        let row_chars = row.chars().count() + 1;
        if chars + row_chars + reserve > max_chars {
            if shown == 0 {
                return super::server::cap(
                    format!("{text}\n{row}{}", footer(offset + 1)),
                    max_chars,
                );
            }
            break;
        }
        text.push('\n');
        text.push_str(&row);
        chars += row_chars;
        shown += 1;
    }
    if offset.saturating_add(shown) < total {
        text.push_str(&footer(offset + shown));
    } else if offset >= total && total > 0 {
        text.push_str(&format!("\n[no tables at offset={offset}]"));
    }
    super::server::cap(text, max_chars)
}

pub(super) fn describe(
    columns: &[ColumnInfo],
    table: &str,
    max_chars: usize,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("table fehlt".into());
    }
    let tables = tables(columns);
    let exact: Vec<_> = tables
        .iter()
        .filter(|(key, _)| name(**key) == table || key.1 == table)
        .collect();
    let matching: Vec<_> = if exact.is_empty() {
        tables
            .iter()
            .filter(|(key, _)| {
                name(**key).eq_ignore_ascii_case(table) || key.1.eq_ignore_ascii_case(table)
            })
            .collect()
    } else {
        exact
    };
    match matching.as_slice() {
        [] => Err(format!("Tabelle '{table}' nicht gefunden. search nutzen.")),
        [(key, columns)] => Ok(super::server::cap(line(**key, columns), max_chars)),
        _ => Err(super::server::cap(
            format!(
                "Tabelle '{table}' ist mehrdeutig. table vollständig angeben: {}",
                matching
                    .iter()
                    .map(|(key, _)| name(**key))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            max_chars,
        )),
    }
}
