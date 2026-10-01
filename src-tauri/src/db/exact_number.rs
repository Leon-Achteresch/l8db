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

pub(crate) fn quote_unsafe_top_level_numbers(json: &str) -> Cow<'_, str> {
    let bytes = json.as_bytes();
    let mut out: Option<String> = None;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    let mut copied = 0;
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
            b'{' | b'[' => depth += 1,
            b'}' | b']' => depth = depth.saturating_sub(1),
            b'-' | b'0'..=b'9' if depth == 1 => {
                let end = bytes[index..]
                    .iter()
                    .position(|b| !matches!(b, b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9'))
                    .map_or(bytes.len(), |offset| index + offset);
                let token = &json[index..end];
                let has_exponent = token.contains(['e', 'E']);
                if has_exponent || !is_exact_in_js(token) {
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
        assert!(value["doc"]["n"].is_number());
        assert!(matches!(
            quote_unsafe_top_level_numbers(r#"{"a": 1, "b": "x\"9"}"#),
            Cow::Borrowed(_)
        ));
    }
}
