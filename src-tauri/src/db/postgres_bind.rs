use bytes::BytesMut;
use tokio_postgres::types::{to_sql_checked, Format, IsNull, ToSql, Type};

#[derive(Debug)]
pub(super) struct TextParameter<'a>(pub(super) &'a Option<String>);

impl ToSql for TextParameter<'_> {
    fn to_sql(
        &self,
        _ty: &Type,
        out: &mut BytesMut,
    ) -> Result<IsNull, Box<dyn std::error::Error + Sync + Send>> {
        match self.0 {
            Some(value) => {
                out.extend_from_slice(value.as_bytes());
                Ok(IsNull::No)
            }
            None => Ok(IsNull::Yes),
        }
    }

    fn accepts(_ty: &Type) -> bool {
        true
    }

    fn encode_format(&self, _ty: &Type) -> Format {
        Format::Text
    }

    to_sql_checked!();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transmits_values_in_text_format_for_the_inferred_database_type() {
        let value = Some("42".to_string());
        let param = TextParameter(&value);
        let mut bytes = BytesMut::new();
        assert!(matches!(param.encode_format(&Type::INT4), Format::Text));
        assert!(matches!(
            param.to_sql_checked(&Type::INT4, &mut bytes).unwrap(),
            IsNull::No
        ));
        assert_eq!(&bytes[..], b"42");
        let mut bytes = BytesMut::new();
        assert!(matches!(
            TextParameter(&None)
                .to_sql_checked(&Type::UUID, &mut bytes)
                .unwrap(),
            IsNull::Yes
        ));
        assert!(bytes.is_empty());
    }
}
