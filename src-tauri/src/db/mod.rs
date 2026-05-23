pub mod commands;
pub mod pool;
pub mod transaction;
mod postgres;

use async_trait::async_trait;
use pool::PoolState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseKind {
    Postgres,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub kind: DatabaseKind,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableData {
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetailedColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub is_primary_key: bool,
    pub ordinal_position: i32,
    pub character_maximum_length: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AddColumnRequest {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AlterColumnRequest {
    pub old_name: String,
    pub new_name: Option<String>,
    pub data_type: Option<String>,
    pub set_not_null: Option<bool>,
    pub new_default: Option<String>,
    pub drop_default: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnInfo {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ForeignKeyInfo {
    pub constraint_name: String,
    pub from_schema: String,
    pub from_table: String,
    pub from_column: String,
    pub to_schema: String,
    pub to_table: String,
    pub to_column: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>,
    pub rows_affected: Option<u64>,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FunctionInfo {
    pub schema: String,
    pub name: String,
    pub identity_args: String,
    pub return_type: String,
    pub language: String,
    pub oid: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtensionInfo {
    pub name: String,
    pub version: Option<String>,
    pub schema: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoleInfo {
    pub name: String,
    pub oid: String,
    pub superuser: bool,
    pub can_login: bool,
    pub create_db: bool,
    pub create_role: bool,
    pub replication: bool,
    pub bypass_rls: bool,
    pub conn_limit: i32,
    pub valid_until: Option<String>,
    pub member_of: Vec<String>,
    pub members: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRoleOptions {
    pub name: String,
    pub password: Option<String>,
    pub superuser: bool,
    pub can_login: bool,
    pub create_db: bool,
    pub create_role: bool,
    pub replication: bool,
    pub bypass_rls: bool,
    pub conn_limit: Option<i32>,
    pub valid_until: Option<String>,
    pub member_of: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AlterRoleOptions {
    pub name: String,
    pub password: Option<String>,
    pub superuser: Option<bool>,
    pub can_login: Option<bool>,
    pub create_db: Option<bool>,
    pub create_role: Option<bool>,
    pub replication: Option<bool>,
    pub bypass_rls: Option<bool>,
    pub conn_limit: Option<i32>,
    pub valid_until: Option<String>,
    pub clear_valid_until: bool,
    pub grant_roles: Vec<String>,
    pub revoke_roles: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TablePrivileges {
    pub schema: String,
    pub table: String,
    pub object_type: String,
    pub select: bool,
    pub insert: bool,
    pub update: bool,
    pub delete: bool,
    pub truncate: bool,
    pub references: bool,
    pub trigger: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemaPrivileges {
    pub schema: String,
    pub usage: bool,
    pub create: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RolePrivileges {
    pub schemas: Vec<SchemaPrivileges>,
    pub tables: Vec<TablePrivileges>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PrivilegeChange {
    pub grant: bool,
    pub privilege: String,
    pub object_type: String,
    pub schema: Option<String>,
    pub table: Option<String>,
    pub role_name: String,
}

#[async_trait]
pub trait DatabaseAdapter: Send + Sync {
    async fn test_connection(&self) -> Result<(), String>;
    async fn list_databases(&self) -> Result<Vec<String>, String>;
    async fn list_schemas(&self) -> Result<Vec<String>, String>;
    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String>;
    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String>;
    async fn fetch_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        limit: i64,
        offset: i64,
        order_by: Option<&str>,
        order_desc: bool,
        is_view: bool,
    ) -> Result<TableData, String>;
    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
    ) -> Result<i64, String>;
    async fn update_row(
        &self,
        schema: &str,
        table: &str,
        ctid: &str,
        updates: &std::collections::HashMap<String, Option<String>>,
    ) -> Result<(), String>;
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String>;
    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String>;
    async fn get_view_definition(
        &self,
        schema: &str,
        view: &str,
    ) -> Result<String, String>;
    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String>;
    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String>;
    async fn get_function_definition(&self, oid: &str) -> Result<String, String>;
    async fn list_extensions(&self) -> Result<Vec<ExtensionInfo>, String>;
    async fn list_roles(&self) -> Result<Vec<RoleInfo>, String>;
    async fn create_role(&self, options: &CreateRoleOptions) -> Result<(), String>;
    async fn alter_role(&self, options: &AlterRoleOptions) -> Result<(), String>;
    async fn drop_role(&self, name: &str) -> Result<(), String>;
    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String>;
    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String>;
    async fn list_table_columns_detailed(&self, schema: &str, table: &str) -> Result<Vec<DetailedColumnInfo>, String>;
    async fn add_column(&self, schema: &str, table: &str, column: &AddColumnRequest) -> Result<(), String>;
    async fn alter_column(&self, schema: &str, table: &str, changes: &AlterColumnRequest) -> Result<(), String>;
    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String>;
    async fn list_role_privileges(&self, role_name: &str) -> Result<RolePrivileges, String>;
    async fn modify_privilege(&self, change: &PrivilegeChange) -> Result<(), String>;
    async fn validate_sql(&self, sql: &str) -> Result<(), String>;
    async fn list_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, String>;
    async fn get_er_schema(&self, schema: Option<&str>) -> Result<ERSchema, String>;
    async fn list_triggers(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<TriggerInfo>, String>;
    async fn list_sequences(&self, schema: Option<&str>) -> Result<Vec<SequenceInfo>, String>;
    async fn alter_sequence(&self, schema: &str, name: &str, changes: &AlterSequenceRequest) -> Result<(), String>;
    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String>;
    async fn list_constraints(&self, schema: &str, table: &str) -> Result<Vec<ConstraintInfo>, String>;
    async fn install_extension(&self, name: &str, schema: Option<&str>) -> Result<(), String>;
    async fn uninstall_extension(&self, name: &str) -> Result<(), String>;
    async fn list_available_extensions(&self) -> Result<Vec<AvailableExtensionInfo>, String>;
    async fn execute_script(&self, sql: &str) -> Result<Vec<ScriptStatementResult>, String>;
    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String>;
}

#[derive(Debug, Clone, Serialize)]
pub struct TriggerInfo {
    pub trigger_name: String,
    pub table_schema: String,
    pub table_name: String,
    pub event: String,
    pub timing: String,
    pub orientation: String,
    pub function_schema: String,
    pub function_name: String,
    pub enabled: String,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SequenceInfo {
    pub schema: String,
    pub name: String,
    pub data_type: String,
    pub start_value: String,
    pub min_value: String,
    pub max_value: String,
    pub increment_by: String,
    pub cycle: bool,
    pub last_value: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ERColumn {
    pub name: String,
    pub data_type: String,
    pub is_primary_key: bool,
    pub is_nullable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ERTable {
    pub schema: String,
    pub name: String,
    pub columns: Vec<ERColumn>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ERSchema {
    pub tables: Vec<ERTable>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexInfo {
    pub name: String,
    pub is_unique: bool,
    pub is_primary: bool,
    pub columns: Vec<String>,
    pub index_type: String,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConstraintInfo {
    pub name: String,
    pub constraint_type: String,
    pub columns: Vec<String>,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptStatementResult {
    pub statement: String,
    pub success: bool,
    pub rows_affected: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ColumnDefinition {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub is_unique: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateTableRequest {
    pub schema: String,
    pub name: String,
    pub columns: Vec<ColumnDefinition>,
    pub if_not_exists: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AlterSequenceRequest {
    pub increment_by: Option<String>,
    pub min_value: Option<String>,
    pub max_value: Option<String>,
    pub cycle: Option<bool>,
    pub restart_with: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AvailableExtensionInfo {
    pub name: String,
    pub default_version: String,
    pub comment: Option<String>,
    pub installed: bool,
}

pub(crate) fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

pub(crate) fn map_pg_err(e: tokio_postgres::Error) -> String {
    if let Some(db_err) = e.as_db_error() {
        let mut msg = format!("{}: {}", db_err.severity(), db_err.message());
        if let Some(detail) = db_err.detail() {
            msg.push_str(&format!("\nDetail: {detail}"));
        }
        if let Some(hint) = db_err.hint() {
            msg.push_str(&format!("\nHinweis: {hint}"));
        }
        if let Some(pos) = db_err.position() {
            msg.push_str(&format!("\nPosition: {pos:?}"));
        }
        msg
    } else {
        format!("Datenbankfehler: {e}")
    }
}

pub fn create_adapter(config: ConnectionConfig, pool_state: PoolState) -> Box<dyn DatabaseAdapter> {
    match config.kind {
        DatabaseKind::Postgres => Box::new(postgres::PostgresAdapter::from_config(config, pool_state)),
    }
}

pub fn create_adapter_from_string(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    pool_state: PoolState,
) -> Result<Box<dyn DatabaseAdapter>, String> {
    match kind {
        DatabaseKind::Postgres => Ok(Box::new(
            postgres::PostgresAdapter::from_connection_string(connection_string, database, pool_state)?,
        )),
    }
}
