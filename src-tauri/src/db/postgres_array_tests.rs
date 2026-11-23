use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio_postgres::types::{FromSql, Type};

use super::*;
use crate::db::exact_number::ExactJson;

fn column() -> Column {
    serde_json::from_value(json!({
        "name": "items", "data_type": "ARRAY", "delimiter": ",",
        "element_type": "text", "element_kind": "b", "element_schema": "pg_catalog",
        "type_schema": "pg_catalog", "type_name": "_text"
    }))
    .unwrap()
}

fn assignment(column: Column, text: Option<&str>) -> Result<String, String> {
    let updates = HashMap::from([(column.name.clone(), text.map(str::to_string))]);
    Ok(update_assignments(&[column], &updates)?.remove(0))
}

#[test]
fn existing_table_json_values_encode_without_losing_element_boundaries_or_numbers() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/postgres-array.json")).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let row = ExactJson::from_sql(&Type::JSON, case["row_json"].as_str().unwrap().as_bytes())
            .unwrap()
            .0;
        assert_eq!(row["items"], case["row_value"], "{}", case["name"]);
        let input = case["input"].as_str().unwrap();
        let delimiter = case["delimiter"].as_str().unwrap().chars().next().unwrap();
        let mut output = String::new();
        let shape = encode_dimension(input, delimiter, 1, &mut 0, &mut output).unwrap();
        assert_eq!(
            output,
            case["expected"].as_str().unwrap(),
            "{}",
            case["name"]
        );
        let mut metadata = column();
        metadata.delimiter = Some(delimiter.to_string());
        metadata.element_type = Some(case["element_type"].as_str().unwrap().to_string());
        let sql = assignment(metadata, Some(input)).unwrap();
        assert!(sql.contains(&literal(&output)));
        assert_eq!(
            sql.matches("pg_catalog.array_lower").count(),
            shape.len() * 2
        );
    }
}

#[test]
fn sql_null_empty_array_empty_text_and_text_null_stay_distinct() {
    assert_eq!(assignment(column(), None).unwrap(), "\"items\" = NULL");
    assert_eq!(
        assignment(column(), Some("[]")).unwrap(),
        "\"items\" = E'{}'"
    );
    for (input, encoded) in [
        (r#"[null]"#, "{NULL}"),
        (r#"[""]"#, r#"{""}"#),
        (r#"["NULL"]"#, r#"{"NULL"}"#),
    ] {
        let sql = assignment(column(), Some(input)).unwrap();
        assert!(sql.contains(&literal(encoded)), "{sql}");
    }
    assert!(assignment(column(), Some("null"))
        .unwrap_err()
        .contains("SQL-NULL"));
}

#[test]
fn existing_lower_bounds_are_reused_for_each_new_dimension_and_empty_stays_canonical() {
    let sql = assignment(column(), Some("[[1,2,3],[4,5,6]]")).unwrap();
    assert!(sql.contains("COALESCE(pg_catalog.array_lower(\"items\", 1), 1)::bigint + 2 - 1"));
    assert!(sql.contains("COALESCE(pg_catalog.array_lower(\"items\", 2), 1)::bigint + 3 - 1"));
    assert!(sql.ends_with("::\"pg_catalog\".\"_text\""));
    let empty = assignment(column(), Some("[]")).unwrap();
    assert!(!empty.contains("array_lower"));
}

#[test]
fn explicit_postgres_array_text_and_scalar_json_are_not_reinterpreted() {
    for text in [r#"[0:1]={"a","b"}"#, r#"{"a\\b","O'Reilly"}"#, "{}"] {
        assert_eq!(
            assignment(column(), Some(text)).unwrap(),
            format!("\"items\" = {}", literal(text))
        );
    }
    let mut scalar = column();
    scalar.data_type = "jsonb".into();
    assert_eq!(
        assignment(scalar, Some("[1,null]")).unwrap(),
        "\"items\" = '[1,null]'"
    );
    let updates = HashMap::from([("missing".into(), Some("[]".into()))]);
    assert_eq!(
        update_assignments(&[column()], &updates).unwrap_err(),
        "Unbekannte Spalte: missing"
    );
    assert!(update_assignments(&[column()], &HashMap::new())
        .unwrap()
        .is_empty());
}

#[test]
fn multidimensional_shape_and_unsupported_element_types_fail_before_any_write() {
    for input in [
        "[1,[2]]",
        "[[1],[2,3]]",
        "[[]]",
        "[[null],null]",
        "[{}]",
        "[",
        r#"["\u0000"]"#,
    ] {
        assert!(assignment(column(), Some(input)).is_err(), "{input}");
    }
    let six = "[[[[[[1]]]]]]";
    assert!(assignment(column(), Some(six)).is_ok());
    assert!(assignment(column(), Some(&format!("[{six}]"))).is_err());
    for (kind, name) in [
        ("b", "json"),
        ("b", "jsonb"),
        ("c", "record"),
        ("d", "custom_domain"),
    ] {
        let mut metadata = column();
        metadata.element_kind = Some(kind.into());
        metadata.element_type = Some(name.into());
        assert!(assignment(metadata, Some("[null]"))
            .unwrap_err()
            .contains("PostgreSQL-Arraytext"));
    }
    let mut unknown = column();
    unknown.delimiter = None;
    assert!(assignment(unknown, Some("[]"))
        .unwrap_err()
        .contains("Metadaten unvollständig"));
    let mut unknown = column();
    unknown.element_kind = None;
    assert!(assignment(unknown, Some("[]"))
        .unwrap_err()
        .contains("Metadaten unvollständig"));
}

#[test]
fn enum_elements_array_domains_and_quoted_identifiers_keep_catalog_types() {
    let mut metadata = column();
    metadata.name = "a\"; DROP TABLE x; --".into();
    metadata.type_schema = "custom\"schema".into();
    metadata.type_name = "array\"domain".into();
    metadata.element_schema = Some("custom".into());
    metadata.element_type = Some("status".into());
    metadata.element_kind = Some("e".into());
    let sql = assignment(metadata, Some(r#"["O'Reilly","\\'",null]"#)).unwrap();
    assert!(sql.starts_with("\"a\"\"; DROP TABLE x; --\" = "));
    assert!(sql.contains("array_lower(\"a\"\"; DROP TABLE x; --\", 1)"));
    assert!(sql.ends_with("::\"custom\"\"schema\".\"array\"\"domain\""));
    assert!(sql.contains("O''Reilly"));
    assert!(COLUMNS_SQL.contains("e.typdelim::text"));
    assert!(COLUMNS_SQL.contains("COALESCE(c.domain_name, c.udt_name)"));
}

#[test]
fn array_conversion_has_bounded_work_and_no_background_or_database_work() {
    let input = serde_json::to_string(
        &(0..12_000)
            .map(|index| Some(format!("item-{index},\\\"雪")))
            .collect::<Vec<_>>(),
    )
    .unwrap();
    let columns = vec![column()];
    let updates = HashMap::from([("items".into(), Some(input.clone()))]);
    let row_json = format!("{{\"items\":{input}}}");
    let mut times = Vec::with_capacity(21);
    let mut capacity = 0;
    let mut decoded_capacity = 0;
    for index in 0..23 {
        let started = Instant::now();
        let row = ExactJson::from_sql(&Type::JSON, row_json.as_bytes())
            .unwrap()
            .0;
        let values = row["items"].as_array().unwrap();
        decoded_capacity = decoded_capacity.max(
            values.capacity() * std::mem::size_of::<Value>()
                + values
                    .iter()
                    .map(|value| match value {
                        Value::String(text) => text.capacity(),
                        _ => 0,
                    })
                    .sum::<usize>(),
        );
        let result = update_assignments(&columns, &updates).unwrap();
        let elapsed = started.elapsed();
        capacity = capacity.max(result[0].capacity());
        assert!(capacity < input.len() * 8 + 1024);
        if index >= 2 {
            times.push(elapsed);
        }
    }
    times.sort();
    println!("postgres-array: elements=12000, input_bytes={}, median_ms={:.3}, p95_ms={:.3}, max_sql_capacity={}, max_decoded_capacity={}, codec_db_requests=0, background_tasks=0", input.len(), times[10].as_secs_f64()*1000.0, times[19].as_secs_f64()*1000.0, capacity, decoded_capacity);
    assert!(decoded_capacity < 2 * 1024 * 1024);
    assert!(times[10] < Duration::from_millis(100));
    assert!(times[19] < Duration::from_millis(200));
    let too_many = format!("[{}]", vec!["0"; MAX_ELEMENTS + 1].join(","));
    assert!(assignment(column(), Some(&too_many))
        .unwrap_err()
        .contains("100.000"));
    let too_large = format!("[\"{}\"]", "x".repeat(MAX_BYTES));
    let started = Instant::now();
    assert!(assignment(column(), Some(&too_large))
        .unwrap_err()
        .contains("8 MiB"));
    assert!(started.elapsed() < Duration::from_millis(100));
    let padded = format!("{}[]", " ".repeat(MAX_BYTES));
    assert!(assignment(column(), Some(&padded))
        .unwrap_err()
        .contains("8 MiB"));
}
