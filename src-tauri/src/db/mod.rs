pub mod commands;
mod postgres;

use async_trait::async_trait;
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

#[async_trait]
pub trait DatabaseAdapter: Send + Sync {
    async fn test_connection(&self) -> Result<(), String>;
    async fn list_databases(&self) -> Result<Vec<String>, String>;
    async fn list_schemas(&self) -> Result<Vec<String>, String>;
    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String>;
    async fn fetch_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        limit: i64,
        order_by: Option<&str>,
        order_desc: bool,
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
}

pub fn create_adapter(config: ConnectionConfig) -> Box<dyn DatabaseAdapter> {
    match config.kind {
        DatabaseKind::Postgres => Box::new(postgres::PostgresAdapter::from_config(config)),
    }
}

pub fn create_adapter_from_string(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
) -> Result<Box<dyn DatabaseAdapter>, String> {
    match kind {
        DatabaseKind::Postgres => Ok(Box::new(
            postgres::PostgresAdapter::from_connection_string(connection_string, database)?,
        )),
    }
}
