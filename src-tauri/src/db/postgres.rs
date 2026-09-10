use std::str::FromStr;

use async_trait::async_trait;
use tokio_postgres::{Client, Config, NoTls};

use super::{ConnectionConfig, DatabaseAdapter, TableData, TableInfo};

pub struct PostgresAdapter {
    config: Config,
}

impl PostgresAdapter {
    pub fn from_config(config: ConnectionConfig) -> Self {
        let mut pg = Config::new();
        pg.host(&config.host)
            .port(config.port)
            .user(&config.user)
            .password(&config.password)
            .dbname(&config.database);
        Self { config: pg }
    }

    pub fn from_connection_string(connection_string: &str) -> Result<Self, String> {
        let config = Config::from_str(connection_string).map_err(|error| error.to_string())?;
        Ok(Self { config })
    }

    async fn connect(&self) -> Result<(Client, tauri::async_runtime::JoinHandle<()>), String> {
        let (client, connection) = self
            .config
            .connect(NoTls)
            .await
            .map_err(|error| error.to_string())?;
        let handle = tauri::async_runtime::spawn(async move {
            let _ = connection.await;
        });
        Ok((client, handle))
    }
}

fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

#[async_trait]
impl DatabaseAdapter for PostgresAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        let (client, handle) = self.connect().await?;
        let result = client
            .simple_query("SELECT 1")
            .await
            .map(|_| ())
            .map_err(|error| error.to_string());
        handle.abort();
        result
    }

    async fn list_tables(&self) -> Result<Vec<TableInfo>, String> {
        let (client, handle) = self.connect().await?;
        let result = client
            .query(
                "SELECT table_schema, table_name \
                 FROM information_schema.tables \
                 WHERE table_type = 'BASE TABLE' \
                   AND table_schema NOT IN ('pg_catalog', 'information_schema') \
                 ORDER BY table_schema, table_name",
                &[],
            )
            .await
            .map_err(|error| error.to_string())
            .map(|rows| {
                rows.into_iter()
                    .map(|row| TableInfo {
                        schema: row.get(0),
                        name: row.get(1),
                    })
                    .collect()
            });
        handle.abort();
        result
    }

    async fn fetch_rows(
        &self,
        schema: &str,
        table: &str,
        limit: i64,
    ) -> Result<TableData, String> {
        let (client, handle) = self.connect().await?;

        let result = async {
            let column_rows = client
                .query(
                    "SELECT column_name \
                     FROM information_schema.columns \
                     WHERE table_schema = $1 AND table_name = $2 \
                     ORDER BY ordinal_position",
                    &[&schema, &table],
                )
                .await
                .map_err(|error| error.to_string())?;
            let columns: Vec<String> = column_rows.iter().map(|row| row.get(0)).collect();

            let sql = format!(
                "SELECT to_jsonb(t) FROM {}.{} AS t LIMIT $1",
                quote_ident(schema),
                quote_ident(table),
            );
            let data_rows = client
                .query(&sql, &[&limit])
                .await
                .map_err(|error| error.to_string())?;
            let rows: Vec<serde_json::Value> =
                data_rows.iter().map(|row| row.get(0)).collect();

            Ok(TableData { columns, rows })
        }
        .await;

        handle.abort();
        result
    }
}
