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
pub struct ColumnInfo {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>,
    pub rows_affected: Option<u64>,
    pub execution_time_ms: u64,
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
