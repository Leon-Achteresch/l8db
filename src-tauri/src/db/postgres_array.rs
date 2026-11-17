use std::collections::HashMap;

use serde_json::value::RawValue;

use super::super::quote_ident;

const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_ELEMENTS: usize = 100_000;
const MAX_DIMENSIONS: usize = 6;

pub(crate) const COLUMNS_SQL: &str = "SELECT c.column_name, c.data_type, e.typdelim::text, \
    e.typname::text, e.typtype::text, en.nspname::text, \
    COALESCE(c.domain_schema, c.udt_schema)::text, \
    COALESCE(c.domain_name, c.udt_name)::text \
    FROM information_schema.columns c \
    JOIN pg_catalog.pg_namespace tn ON tn.nspname = c.udt_schema \
    JOIN pg_catalog.pg_type t ON t.typnamespace = tn.oid AND t.typname = c.udt_name \
    LEFT JOIN pg_catalog.pg_type e ON e.oid = t.typelem AND c.data_type = 'ARRAY' \
    LEFT JOIN pg_catalog.pg_namespace en ON en.oid = e.typnamespace \
    WHERE c.table_schema = $1 AND c.table_name = $2";

#[derive(Debug)]
#[cfg_attr(test, derive(serde::Deserialize))]
pub(crate) struct Column {
    name: String,
    data_type: String,
    delimiter: Option<String>,
    element_type: Option<String>,
    element_kind: Option<String>,
    element_schema: Option<String>,
    type_schema: String,
    type_name: String,
}

pub(crate) fn columns(rows: &[tokio_postgres::Row]) -> Vec<Column> {
    rows.iter()
        .map(|row| Column {
            name: row.get(0),
            data_type: row.get(1),
            delimiter: row.get(2),
            element_type: row.get(3),
            element_kind: row.get(4),
            element_schema: row.get(5),
            type_schema: row.get(6),
            type_name: row.get(7),
        })
        .collect()
}

fn literal(text: &str) -> String {
    format!("E'{}'", text.replace('\\', "\\\\").replace('\'', "''"))
}

fn quoted_element(text: &str, output: &mut String) -> Result<(), String> {
    if text.contains('\0') {
        return Err("Array-Elemente dürfen kein NUL-Zeichen enthalten.".into());
    }
    output.push('"');
    for ch in text.chars() {
        if matches!(ch, '"' | '\\') {
            output.push('\\');
        }
        output.push(ch);
    }
    output.push('"');
    Ok(())
}

fn encode_dimension(
    text: &str,
    delimiter: char,
    depth: usize,
    count: &mut usize,
    output: &mut String,
) -> Result<Vec<usize>, String> {
    if depth > MAX_DIMENSIONS {
        return Err("PostgreSQL-Arrays unterstützen höchstens sechs Dimensionen.".into());
    }
    let values: Vec<&RawValue> = serde_json::from_str(text).map_err(|_| {
        "Ein gültiges JSON-Array oder PostgreSQL-Arraytext wird erwartet.".to_string()
    })?;
    if depth > 1 && values.is_empty() {
        return Err("Leere Unterarrays haben keine verlustfreie PostgreSQL-Arrayform.".into());
    }
    output.push('{');
    let nested = values
        .first()
        .is_some_and(|value| value.get().starts_with('['));
    let mut inner_shape: Option<Vec<usize>> = None;
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            output.push(delimiter);
        }
        let raw = value.get();
        if raw.starts_with('[') != nested {
            return Err("Array-Dimensionen müssen rechteckig sein.".into());
        }
        if nested {
            let shape = encode_dimension(raw, delimiter, depth + 1, count, output)?;
            if inner_shape.as_ref().is_some_and(|inner| inner != &shape) {
                return Err("Array-Dimensionen müssen rechteckig sein.".into());
            }
            inner_shape = Some(shape);
        } else {
            *count += 1;
            if *count > MAX_ELEMENTS {
                return Err("JSON-Array-Eingaben sind auf 100.000 Elemente begrenzt.".into());
            }
            match raw.as_bytes().first() {
                Some(b'n') => output.push_str("NULL"),
                Some(b'"') => {
                    let decoded: String = serde_json::from_str(raw)
                        .map_err(|_| "Ungültiges Array-Textelement.".to_string())?;
                    quoted_element(&decoded, output)?;
                }
                Some(b'{') => {
                    return Err("Objekte sind keine skalaren PostgreSQL-Arrayelemente.".into())
                }
                _ => quoted_element(raw, output)?,
            }
        }
    }
    output.push('}');
    if values.is_empty() {
        return Ok(Vec::new());
    }
    let mut shape = vec![values.len()];
    shape.extend(inner_shape.unwrap_or_default());
    Ok(shape)
}

fn has_explicit_dimensions(text: &str) -> bool {
    let Some((dimensions, _)) = text.split_once('=') else {
        return false;
    };
    dimensions.ends_with(']')
        && dimensions.contains(':')
        && dimensions
            .chars()
            .all(|ch| matches!(ch, '[' | ']' | ':' | '-' | '+' | '0'..='9'))
}

fn array_sql(column: &Column, text: &str) -> Result<String, String> {
    let input_bytes = text.len();
    let text = text.trim();
    if text.starts_with('{') || has_explicit_dimensions(text) {
        return Ok(literal(text));
    }
    if input_bytes > MAX_BYTES {
        return Err("JSON-Array-Eingaben sind auf 8 MiB begrenzt.".into());
    }
    if !text.starts_with('[') {
        return Err(
            "JSON-Array oder PostgreSQL-Arraytext erwartet; SQL-NULL separat setzen.".into(),
        );
    }
    if column.element_type.is_none()
        || column.element_schema.is_none()
        || column.element_kind.is_none()
    {
        return Err("Array-Metadaten unvollständig; PostgreSQL-Arraytext verwenden.".into());
    }
    if matches!(column.element_kind.as_deref(), Some("d" | "c"))
        || (column.element_schema.as_deref() == Some("pg_catalog")
            && matches!(column.element_type.as_deref(), Some("json" | "jsonb")))
    {
        return Err("Für JSON-, Komposit- und Element-Domain-Arrays bitte expliziten PostgreSQL-Arraytext verwenden.".into());
    }
    let delimiter = column
        .delimiter
        .as_deref()
        .filter(|text| text.len() == 1)
        .and_then(|text| text.chars().next())
        .ok_or("Array-Metadaten unvollständig; PostgreSQL-Arraytext verwenden.")?;
    let mut encoded = String::with_capacity(text.len());
    let shape = encode_dimension(text, delimiter, 1, &mut 0, &mut encoded)?;
    if shape.is_empty() {
        return Ok(literal(&encoded));
    }
    let name = quote_ident(&column.name);
    let bounds = shape
        .iter()
        .enumerate()
        .map(|(index, length)| {
            let lower = format!("COALESCE(pg_catalog.array_lower({name}, {}), 1)", index + 1);
            format!("'[' || {lower}::text || ':' || ({lower}::bigint + {length} - 1)::text || ']' ")
        })
        .collect::<Vec<_>>()
        .join("|| ");
    Ok(format!(
        "({bounds}|| '=' || {})::{}.{}",
        literal(&encoded),
        quote_ident(&column.type_schema),
        quote_ident(&column.type_name),
    ))
}

pub(crate) fn update_assignments(
    columns: &[Column],
    updates: &HashMap<String, Option<String>>,
) -> Result<Vec<String>, String> {
    let columns: HashMap<_, _> = columns
        .iter()
        .map(|column| (&column.name, column))
        .collect();
    updates
        .iter()
        .map(|(name, value)| {
            let column = columns
                .get(name)
                .ok_or_else(|| format!("Unbekannte Spalte: {name}"))?;
            let value = match value {
                None => "NULL".to_string(),
                Some(text) if column.data_type == "ARRAY" => {
                    array_sql(column, text).map_err(|error| format!("Spalte {name}: {error}"))?
                }
                Some(text) => format!("'{}'", text.replace('\'', "''")),
            };
            Ok(format!("{} = {value}", quote_ident(name)))
        })
        .collect()
}

#[cfg(test)]
#[path = "postgres_array_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "postgres_array_live_tests.rs"]
mod live_tests;
