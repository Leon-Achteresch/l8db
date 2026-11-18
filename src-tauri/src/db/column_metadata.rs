use super::DetailedColumnInfo;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum KeywordLimit {
    Configured { value: u64 },
    NotDeclared,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExactStrategy {
    Keyword,
    MatchPhrase,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MappingScope {
    SingleIndex,
    MultipleIndices,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExactFilterMetadata {
    pub target: String,
    pub strategy: ExactStrategy,
    pub ignore_above: KeywordLimit,
    pub scope: MappingScope,
    pub index_mode: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnMetadata {
    #[serde(flatten)]
    pub column: DetailedColumnInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exact_filter: Option<ExactFilterMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_update: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableColumnDetails {
    pub columns: Vec<ColumnMetadata>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub unlogged: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ColumnDetailsResponse {
    Columns(Vec<ColumnMetadata>),
    Table(TableColumnDetails),
}

impl From<DetailedColumnInfo> for ColumnMetadata {
    fn from(column: DetailedColumnInfo) -> Self {
        Self {
            column,
            exact_filter: None,
            on_update: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyword_metadata_keeps_legacy_columns_json_identical() {
        let column = DetailedColumnInfo {
            name: "created_at".into(),
            data_type: "timestamp".into(),
            is_nullable: true,
            column_default: None,
            is_primary_key: false,
            ordinal_position: 1,
            character_maximum_length: None,
            comment: Some("existing comment".into()),
        };
        let legacy = serde_json::to_value(&column).unwrap();
        assert_eq!(
            serde_json::to_value(ColumnMetadata::from(column)).unwrap(),
            legacy
        );
    }
}
