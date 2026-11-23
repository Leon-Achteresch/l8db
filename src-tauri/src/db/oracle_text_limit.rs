use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum OracleTextUnit {
    Byte,
    Char,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct OracleTextLimit {
    pub length: i32,
    pub unit: OracleTextUnit,
}

pub(super) fn oracle_text_limit(
    data_type: &str,
    char_used: Option<&str>,
    char_length: Option<i32>,
    data_length: Option<i32>,
) -> Option<OracleTextLimit> {
    let (length, unit) = match (data_type, char_used) {
        ("CHAR" | "VARCHAR2", Some("B")) => (data_length, OracleTextUnit::Byte),
        ("CHAR" | "VARCHAR2" | "NCHAR" | "NVARCHAR2", Some("C")) => {
            (char_length, OracleTextUnit::Char)
        }
        _ => return None,
    };
    Some(OracleTextLimit {
        length: length.filter(|length| *length > 0)?,
        unit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_catalog_units_and_lengths_for_multibyte_data() {
        let example = "é界";
        for data_type in ["VARCHAR2", "CHAR"] {
            let bytes = oracle_text_limit(data_type, Some("B"), Some(4), Some(4)).unwrap();
            assert_eq!(
                serde_json::to_value(&bytes).unwrap(),
                json!({"length": 4, "unit": "BYTE"})
            );
            assert!(example.len() > bytes.length as usize);
        }
        for data_type in ["CHAR", "VARCHAR2", "NCHAR", "NVARCHAR2"] {
            let chars = oracle_text_limit(data_type, Some("C"), Some(2), Some(8)).unwrap();
            assert_eq!(
                serde_json::to_value(&chars).unwrap(),
                json!({"length": 2, "unit": "CHAR"})
            );
            assert_eq!(example.chars().count(), chars.length as usize);
        }
    }

    #[test]
    fn omits_unknown_or_inconsistent_metadata() {
        for args in [
            ("VARCHAR2", None, Some(2), Some(8)),
            ("VARCHAR2", Some("X"), Some(2), Some(8)),
            ("VARCHAR2", Some("B"), Some(2), None),
            ("VARCHAR2", Some("C"), None, Some(8)),
            ("VARCHAR2", Some("B"), Some(2), Some(0)),
            ("CHAR", Some("C"), Some(-1), Some(8)),
            ("NVARCHAR2", Some("B"), Some(2), Some(8)),
            ("RAW", Some("B"), Some(2), Some(8)),
            ("CLOB", Some("C"), Some(2), Some(8)),
        ] {
            assert!(oracle_text_limit(args.0, args.1, args.2, args.3).is_none());
        }
    }
}
