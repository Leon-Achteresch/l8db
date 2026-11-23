use super::IndexInfo;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct IndexKey {
    pub name: String,
    pub position: u32,
    pub descending: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum IndexFilter {
    None,
    Known { predicate: String },
    Unavailable,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexDefinitionStatus {
    Reconstructed,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexRoles {
    pub keys: Vec<IndexKey>,
    pub included: Vec<String>,
    pub other: Vec<String>,
    pub filter: IndexFilter,
    pub definition_status: IndexDefinitionStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexMetadata {
    #[serde(flatten)]
    pub index: IndexInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roles: Option<IndexRoles>,
}

impl From<IndexInfo> for IndexMetadata {
    fn from(index: IndexInfo) -> Self {
        Self { index, roles: None }
    }
}
