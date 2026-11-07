use crate::db::DatabaseKind;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PAGE_SIZE: usize = 100;
pub const MAX_RESULT_ROWS: usize = 1000;
pub const MAX_RESULT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_SQL_BYTES: usize = 1024 * 1024;
pub const MAX_LOG_ROWS: i64 = 50_000;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUser {
    pub id: String,
    pub email: String,
    pub role: String,
    pub active: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedConnection {
    pub id: String,
    pub name: String,
    pub kind: DatabaseKind,
    pub database: Option<String>,
    pub access: String,
    pub require_approval: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedQuery {
    pub id: String,
    pub connection_id: String,
    pub name: String,
    pub sql: String,
    pub author: String,
    pub revision: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLog {
    pub id: i64,
    pub actor: String,
    pub action: String,
    pub connection_id: Option<String>,
    pub outcome: String,
    pub created_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingQuery {
    pub id: String,
    pub connection_id: String,
    pub author: String,
    pub sql: String,
    pub status: String,
    pub created_at: i64,
}

#[derive(Deserialize)]
pub struct Credentials {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: DatabaseKind,
    pub database: Option<String>,
    pub connection_string: Option<String>,
    #[serde(default)]
    pub require_approval: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantInput {
    pub user_id: String,
    pub access: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryInput {
    pub sql: String,
    pub job_id: Option<String>,
    pub max_rows: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataInput {
    pub operation: String,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub table: Option<String>,
    pub filter: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub order_by: Option<String>,
    #[serde(default)]
    pub order_desc: bool,
    #[serde(default)]
    pub is_view: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProfile {
    pub id: String,
    pub endpoint: String,
    pub user: WorkspaceUser,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestInput {
    pub profile: String,
    pub method: String,
    pub path: String,
    pub body: Option<Value>,
}
