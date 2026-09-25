use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaskMode {
    Text,
    Null,
    Hash,
    Partial,
    Fake,
    Shuffle,
}

pub fn fnv1a(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325u64, |hash, byte| {
        (hash ^ byte as u64).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

pub fn hash_text(text: &str) -> String {
    format!("{:016x}", fnv1a(text))
}

pub fn partial_text(text: &str) -> String {
    if let Some(at) = text.find('@') {
        let local: Vec<char> = text[..at].chars().collect();
        let first = local.first().map(|c| c.to_string()).unwrap_or_default();
        return format!("{first}***{}", &text[at..]);
    }
    let chars: Vec<char> = text.chars().collect();
    match chars.len() {
        0 => String::new(),
        1..=3 => "***".into(),
        4..=6 => format!("{}***", chars[0]),
        n => format!("{}***{}", chars[0], chars[n - 1]),
    }
}

pub fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

pub fn mask_text(
    column: &str,
    text: &str,
    mode: MaskMode,
    replacement: Option<&str>,
) -> Option<String> {
    match mode {
        MaskMode::Null => None,
        MaskMode::Text => Some(replacement.unwrap_or_default().to_string()),
        MaskMode::Hash => Some(hash_text(text)),
        MaskMode::Partial => Some(partial_text(text)),
        MaskMode::Fake => Some(super::datagen::fake_for_column(column, fnv1a(text))),
        MaskMode::Shuffle => Some(text.to_string()),
    }
}

pub fn mask_value(
    column: &str,
    value: &Value,
    mode: MaskMode,
    replacement: Option<&str>,
) -> Option<String> {
    match mode {
        MaskMode::Null => None,
        MaskMode::Text => Some(replacement.unwrap_or_default().to_string()),
        _ => value_text(value).and_then(|text| mask_text(column, &text, mode, replacement)),
    }
}

pub fn shuffle_column(rows: &mut [Value], column: &str, seed: u64) {
    let mut values: Vec<Value> = rows
        .iter()
        .map(|row| row.get(column).cloned().unwrap_or(Value::Null))
        .collect();
    let mut rng = super::datagen::Rng::new(seed ^ fnv1a(column));
    for i in (1..values.len()).rev() {
        let j = rng.below(i as u64 + 1) as usize;
        values.swap(i, j);
    }
    for (row, value) in rows.iter_mut().zip(values) {
        if let Some(object) = row.as_object_mut() {
            object.insert(column.to_string(), value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hash_matches_frontend_fnv() {
        assert_eq!(hash_text(""), "cbf29ce484222325");
        assert_eq!(hash_text("a"), "af63dc4c8601ec8c");
        assert_eq!(hash_text("ä"), hash_text("ä"));
    }

    #[test]
    fn partial_masks() {
        assert_eq!(partial_text("jan@example.de"), "j***@example.de");
        assert_eq!(partial_text("Schmidt"), "S***t");
        assert_eq!(partial_text("Anna"), "A***");
        assert_eq!(partial_text("ab"), "***");
        assert_eq!(partial_text("Österreich"), "Ö***h");
    }

    #[test]
    fn modes_apply_to_values() {
        assert_eq!(
            mask_value("x", &json!("secret"), MaskMode::Null, None),
            None
        );
        assert_eq!(
            mask_value("x", &json!(5), MaskMode::Text, Some("***")),
            Some("***".into())
        );
        let fake = mask_value("email", &json!("a@b.de"), MaskMode::Fake, None).unwrap();
        assert!(fake.contains('@'));
        assert_eq!(
            fake,
            mask_value("email", &json!("a@b.de"), MaskMode::Fake, None).unwrap()
        );
        assert_eq!(mask_value("x", &Value::Null, MaskMode::Hash, None), None);
    }

    #[test]
    fn shuffle_keeps_multiset() {
        let mut rows: Vec<Value> = (0..20).map(|i| json!({ "v": i, "k": i })).collect();
        shuffle_column(&mut rows, "v", 1);
        let mut values: Vec<i64> = rows.iter().map(|r| r["v"].as_i64().unwrap()).collect();
        assert!(rows.iter().any(|r| r["v"] != r["k"]));
        values.sort();
        assert_eq!(values, (0..20).collect::<Vec<_>>());
    }
}
