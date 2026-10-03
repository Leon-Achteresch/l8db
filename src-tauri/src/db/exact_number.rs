use std::borrow::Cow;

use serde_json::Value;

const MAX_SAFE_INTEGER: i128 = 9_007_199_254_740_991;

fn normalized(text: &str) -> Option<(bool, String, String)> {
    let (negative, body) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text.strip_prefix('+').unwrap_or(text)),
    };
    let (whole, fraction) = body.split_once('.').unwrap_or((body, ""));
    if whole.is_empty() && fraction.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !fraction.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let whole = whole.trim_start_matches('0').to_string();
    let fraction = fraction.trim_end_matches('0').to_string();
    let zero = whole.is_empty() && fraction.is_empty();
    Some((negative && !zero, whole, fraction))
}

pub(crate) fn is_exact_in_js(text: &str) -> bool {
    let Some(decimal) = normalized(text) else {
        return false;
    };
    if decimal.2.is_empty() {
        return decimal.1.is_empty()
            || decimal
                .1
                .parse::<i128>()
                .is_ok_and(|value| value <= MAX_SAFE_INTEGER);
    }
    text.parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
        .and_then(|value| normalized(&value.to_string()))
        .is_some_and(|shortest| shortest == decimal)
}

pub(crate) fn decimal(text: &str) -> Value {
    if is_exact_in_js(text) {
        if let Ok(integer) = text.parse::<i64>() {
            return Value::from(integer);
        }
        if let Some(number) = text
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
        {
            return Value::Number(number);
        }
    }
    Value::String(text.to_string())
}

pub(crate) fn int(value: i64) -> Value {
    if i128::from(value).abs() <= MAX_SAFE_INTEGER {
        Value::from(value)
    } else {
        Value::String(value.to_string())
    }
}

pub(crate) fn uint(value: u64) -> Value {
    if i128::from(value) <= MAX_SAFE_INTEGER {
        Value::from(value)
    } else {
        Value::String(value.to_string())
    }
}

pub(crate) fn signed_be_text(bytes: &[u8]) -> String {
    let negative = bytes.first().is_some_and(|b| b & 0x80 != 0);
    let mut magnitude: Vec<u8> = bytes
        .iter()
        .map(|b| if negative { !b } else { *b })
        .collect();
    if negative {
        for byte in magnitude.iter_mut().rev() {
            let (sum, carry) = byte.overflowing_add(1);
            *byte = sum;
            if !carry {
                break;
            }
        }
    }
    let mut digits = Vec::new();
    while magnitude.iter().any(|b| *b != 0) {
        let mut rest = 0u32;
        for byte in magnitude.iter_mut() {
            let current = (rest << 8) | u32::from(*byte);
            *byte = (current / 10) as u8;
            rest = current % 10;
        }
        digits.push(b'0' + rest as u8);
    }
    if digits.is_empty() {
        digits.push(b'0');
    } else if negative {
        digits.push(b'-');
    }
    digits.reverse();
    String::from_utf8(digits).unwrap_or_default()
}

pub(crate) fn scaled_text(unscaled: &str, scale: i32) -> String {
    let (sign, digits) = match unscaled.strip_prefix('-') {
        Some(digits) => ("-", digits),
        None => ("", unscaled),
    };
    if digits == "0" || scale.unsigned_abs() > 1000 {
        return if scale == 0 || digits == "0" {
            unscaled.to_string()
        } else {
            format!("{unscaled}E{}", -i64::from(scale))
        };
    }
    if scale <= 0 {
        return format!(
            "{sign}{digits}{}",
            "0".repeat(scale.unsigned_abs() as usize)
        );
    }
    let scale = scale as usize;
    let padded = format!("{digits:0>width$}", width = scale + 1);
    let (whole, fraction) = padded.split_at(padded.len() - scale);
    format!("{sign}{whole}.{fraction}")
}

fn number_end(bytes: &[u8], index: usize) -> usize {
    bytes[index..]
        .iter()
        .position(|b| !matches!(b, b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9'))
        .map_or(bytes.len(), |offset| index + offset)
}

fn has_unsafe_number(json: &str) -> bool {
    let bytes = json.as_bytes();
    let mut in_string = false;
    let mut escaped = false;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
        } else if byte == b'"' {
            in_string = true;
        } else if matches!(byte, b'-' | b'0'..=b'9') {
            let end = number_end(bytes, index);
            if !is_exact_in_js(&json[index..end]) {
                return true;
            }
            index = end;
            continue;
        }
        index += 1;
    }
    false
}

pub(crate) fn json_document(text: &str) -> Value {
    if has_unsafe_number(text) {
        return Value::String(text.to_string());
    }
    serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string()))
}

pub(crate) fn quote_unsafe_top_level_numbers(json: &str) -> Cow<'_, str> {
    let bytes = json.as_bytes();
    let mut out: Option<String> = None;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    let mut copied = 0;
    let mut container_start: Option<usize> = None;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'{' | b'[' => {
                if depth == 1 {
                    container_start = Some(index);
                }
                depth += 1;
            }
            b'}' | b']' => {
                depth = depth.saturating_sub(1);
                if depth == 1 {
                    if let Some(start) = container_start.take() {
                        let raw = &json[start..=index];
                        if has_unsafe_number(raw) {
                            let buffer =
                                out.get_or_insert_with(|| String::with_capacity(json.len() + 16));
                            buffer.push_str(&json[copied..start]);
                            buffer.push_str(&Value::String(raw.to_string()).to_string());
                            copied = index + 1;
                        }
                    }
                }
            }
            b'-' | b'0'..=b'9' if depth == 1 => {
                let end = number_end(bytes, index);
                let token = &json[index..end];
                if !is_exact_in_js(token) {
                    let buffer = out.get_or_insert_with(|| String::with_capacity(json.len() + 16));
                    buffer.push_str(&json[copied..index]);
                    buffer.push('"');
                    buffer.push_str(token);
                    buffer.push('"');
                    copied = end;
                }
                index = end;
                continue;
            }
            _ => {}
        }
        index += 1;
    }
    match out {
        Some(mut buffer) => {
            buffer.push_str(&json[copied..]);
            Cow::Owned(buffer)
        }
        None => Cow::Borrowed(json),
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ExactJson(pub Value);

impl<'a> tokio_postgres::types::FromSql<'a> for ExactJson {
    fn from_sql(
        ty: &tokio_postgres::types::Type,
        raw: &'a [u8],
    ) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        let raw = if *ty == tokio_postgres::types::Type::JSONB {
            match raw.split_first() {
                Some((1, rest)) => rest,
                _ => return Err("Unbekannte JSONB-Version".into()),
            }
        } else {
            raw
        };
        let text = std::str::from_utf8(raw)?;
        Ok(ExactJson(serde_json::from_str(
            &quote_unsafe_top_level_numbers(text),
        )?))
    }

    tokio_postgres::types::accepts!(JSON, JSONB);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_numbers_that_survive_javascript() {
        for text in [
            "0",
            "-0",
            "0.0",
            "42",
            "-17",
            "9007199254740991",
            "0.1",
            "123.45",
            "123.450",
        ] {
            assert!(is_exact_in_js(text), "{text} should be exact");
        }
        assert!(!is_exact_in_js("1e3"));
        assert!(!is_exact_in_js("abc"));
        assert_eq!(decimal("123.450"), json!(123.45));
        assert_eq!(decimal("-0.5"), json!(-0.5));
        assert_eq!(decimal(".5"), json!(0.5));
        assert_eq!(decimal("+7"), json!(7));
    }

    #[test]
    fn stringifies_numbers_javascript_would_round() {
        for text in [
            "9007199254740993",
            "-9007199254740993",
            "12345678901234567890",
            "0.1000000000000000055511151231257827",
            "123456789012345.6789",
        ] {
            assert!(!is_exact_in_js(text), "{text} must not be exact");
            assert_eq!(decimal(text), json!(text));
        }
        assert_eq!(int(i64::MAX), json!(i64::MAX.to_string()));
        assert_eq!(int(-42), json!(-42));
        assert_eq!(uint(u64::MAX), json!(u64::MAX.to_string()));
    }

    #[test]
    fn renders_arbitrary_precision_numbers() {
        assert_eq!(signed_be_text(&[]), "0");
        assert_eq!(signed_be_text(&[0x00]), "0");
        assert_eq!(signed_be_text(&[0x7f]), "127");
        assert_eq!(signed_be_text(&[0x80, 0x00]), "-32768");
        assert_eq!(signed_be_text(&[0xff]), "-1");
        let big = (1u128 << 100).to_be_bytes();
        assert_eq!(signed_be_text(&big), (1u128 << 100).to_string());
        assert_eq!(scaled_text("12345", 2), "123.45");
        assert_eq!(scaled_text("-5", 3), "-0.005");
        assert_eq!(scaled_text("7", -2), "700");
        assert_eq!(scaled_text("0", 5), "0");
        assert_eq!(scaled_text("1", 5000), "1E-5000");
    }

    #[test]
    fn quotes_only_unsafe_top_level_values() {
        let row = r#"{"id": 9007199254740993, "price": 12.50, "doc": {"n": 9007199254740993}, "s": "9007199254740993", "e": 1e400, "a": [1, 2]}"#;
        let value: Value = serde_json::from_str(&quote_unsafe_top_level_numbers(row)).unwrap();
        assert_eq!(value["id"], json!("9007199254740993"));
        assert_eq!(value["price"], json!(12.5));
        assert_eq!(value["s"], json!("9007199254740993"));
        assert_eq!(value["e"], json!("1e400"));
        assert_eq!(value["a"], json!([1, 2]));
        assert_eq!(value["doc"], json!(r#"{"n": 9007199254740993}"#));
        assert!(matches!(
            quote_unsafe_top_level_numbers(r#"{"a": 1, "b": "x\"9"}"#),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn keeps_nested_values_with_unsafe_numbers_as_raw_json_text() {
        let row = r#"{"doc": {"n": 9007199254740993, "s": "a\"b"}, "arr": [1, -9007199254740993], "deep": [{"x": [0.1000000000000000055511151231257827]}], "exp": {"e": 1e400}, "safe": {"n": [1, 2.5, "9007199254740993"]}, "big": 18446744073709551616, "tail": 7}"#;
        let value: Value = serde_json::from_str(&quote_unsafe_top_level_numbers(row)).unwrap();
        assert_eq!(
            value["doc"],
            json!(r#"{"n": 9007199254740993, "s": "a\"b"}"#)
        );
        assert_eq!(value["arr"], json!("[1, -9007199254740993]"));
        assert_eq!(
            value["deep"],
            json!(r#"[{"x": [0.1000000000000000055511151231257827]}]"#)
        );
        assert_eq!(value["exp"], json!(r#"{"e": 1e400}"#));
        assert_eq!(value["safe"], json!({"n": [1, 2.5, "9007199254740993"]}));
        assert_eq!(value["big"], json!("18446744073709551616"));
        assert_eq!(value["tail"], json!(7));
        assert!(matches!(
            quote_unsafe_top_level_numbers(r#"{"a": {"b": [1, 2]}, "c": "[9007199254740993]"}"#),
            Cow::Borrowed(_)
        ));
    }

    #[test]
    fn json_documents_with_unsafe_numbers_stay_text() {
        assert_eq!(json_document(r#"{"a": [1, 2.5]}"#), json!({"a": [1, 2.5]}));
        assert_eq!(json_document("42"), json!(42));
        assert_eq!(json_document(r#""x""#), json!("x"));
        for text in [
            r#"{"a": 9007199254740993}"#,
            "[1, [2, -9007199254740993]]",
            "9007199254740993",
            r#"{"d": 0.1000000000000000055511151231257827}"#,
        ] {
            assert_eq!(json_document(text), json!(text));
        }
        assert_eq!(json_document("not json"), json!("not json"));
    }

    #[tokio::test]
    #[ignore]
    async fn lab_nested_big_numbers_survive_grid_round_trip() {
        use crate::db::{pool::create_pool_state, postgres::PostgresAdapter, DatabaseAdapter};
        let url = std::env::var("L8DB_E2E_PG_URL")
            .unwrap_or_else(|_| "postgresql://postgres:testpw@127.0.0.1:5433/testdb".to_string());
        let adapter =
            PostgresAdapter::from_connection_string(&url, None, create_pool_state()).unwrap();
        adapter
            .execute_query("DROP TABLE IF EXISTS l8db_nested_exact; CREATE TABLE l8db_nested_exact (id int PRIMARY KEY, doc jsonb, raw json, ids bigint[], amounts numeric[], plain jsonb); INSERT INTO l8db_nested_exact VALUES (1, '{\"n\": 9007199254740993, \"d\": 0.1000000000000000055511151231257827, \"s\": \"it''s\"}', '{\"e\": 1e400}', '{9007199254740993,1}', '{12345678901234567890.123456789}', '{\"n\": [1, 2.5]}')")
            .await
            .unwrap();
        let data = adapter
            .fetch_rows(
                "public",
                "l8db_nested_exact",
                None,
                10,
                0,
                None,
                false,
                false,
                false,
            )
            .await
            .unwrap();
        let row = &data.rows[0];
        let doc = row["doc"].as_str().expect("doc as raw text").to_string();
        assert!(doc.contains("9007199254740993"), "{doc}");
        assert!(
            doc.contains("0.1000000000000000055511151231257827"),
            "{doc}"
        );
        assert_eq!(
            row["raw"],
            json!(format!(r#"{{"e": 1{}}}"#, "0".repeat(400)))
        );
        assert_eq!(row["ids"], json!("[9007199254740993, 1]"));
        assert_eq!(row["amounts"], json!("[12345678901234567890.123456789]"));
        assert_eq!(row["plain"], json!({"n": [1, 2.5]}));
        let browser: Value = serde_json::from_str(&serde_json::to_string(row).unwrap()).unwrap();
        let edited = browser["doc"].as_str().unwrap().replace("it's", "edited");
        adapter
            .execute_query(&format!(
                "UPDATE l8db_nested_exact SET doc = '{}' WHERE id = 1",
                edited.replace('\'', "''")
            ))
            .await
            .unwrap();
        let check = adapter
            .execute_query("SELECT doc->>'n' AS n, doc->>'d' AS d, doc->>'s' AS s FROM l8db_nested_exact WHERE id = 1")
            .await
            .unwrap();
        assert_eq!(check.rows[0]["n"], json!("9007199254740993"));
        assert_eq!(
            check.rows[0]["d"],
            json!("0.1000000000000000055511151231257827")
        );
        assert_eq!(check.rows[0]["s"], json!("edited"));
        adapter
            .execute_query("DROP TABLE l8db_nested_exact")
            .await
            .unwrap();
    }

    #[tokio::test]
    #[ignore]
    async fn lab_mysql_json_big_numbers_stay_exact() {
        use crate::db::{
            create_adapter_from_string, pool::create_pool_state, provider::DatabaseKind,
        };
        let url = std::env::var("L8DB_SMOKE_MYSQL_URL").expect("L8DB_SMOKE_MYSQL_URL required");
        let adapter =
            create_adapter_from_string(DatabaseKind::Mysql, &url, None, create_pool_state())
                .unwrap();
        for sql in [
            "DROP TABLE IF EXISTS l8db_json_exact",
            "CREATE TABLE l8db_json_exact (id int PRIMARY KEY, doc json)",
            "INSERT INTO l8db_json_exact VALUES (1, '{\"n\": 9007199254740993, \"a\": [1, -9007199254740993]}'), (2, '{\"n\": [1, 2.5]}'), (3, '9007199254740993')",
        ] {
            adapter.execute_query(sql).await.unwrap();
        }
        let schema = url.rsplit('/').next().unwrap().split('?').next().unwrap();
        let data = adapter
            .fetch_rows(
                schema,
                "l8db_json_exact",
                None,
                10,
                0,
                Some("id"),
                false,
                false,
                false,
            )
            .await
            .unwrap();
        let first = data.rows[0]["doc"].as_str().expect("raw text").to_string();
        assert!(first.contains("9007199254740993"), "{first}");
        assert!(first.contains("-9007199254740993"), "{first}");
        assert_eq!(data.rows[1]["doc"], json!({"n": [1, 2.5]}));
        assert_eq!(data.rows[2]["doc"], json!("9007199254740993"));
        let query = adapter
            .execute_query("SELECT doc FROM l8db_json_exact WHERE id = 1")
            .await
            .unwrap();
        assert_eq!(query.rows[0]["doc"], json!(first));
        adapter
            .execute_query(&format!(
                "UPDATE l8db_json_exact SET doc = '{}' WHERE id = 1",
                first.replace('\'', "''")
            ))
            .await
            .unwrap();
        let check = adapter
            .execute_query("SELECT CAST(JSON_EXTRACT(doc, '$.n') AS CHAR) AS n FROM l8db_json_exact WHERE id = 1")
            .await
            .unwrap();
        assert_eq!(check.rows[0]["n"], json!("9007199254740993"));
        adapter
            .execute_query("DROP TABLE l8db_json_exact")
            .await
            .unwrap();
    }
}
