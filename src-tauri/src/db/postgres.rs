use std::str::FromStr;

use async_trait::async_trait;
use tokio_postgres::{Client, Config, NoTls, SimpleQueryMessage};

use super::{ColumnInfo, ConnectionConfig, DatabaseAdapter, QueryResult, TableData, TableInfo};

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

    pub fn from_connection_string(
        connection_string: &str,
        database: Option<&str>,
    ) -> Result<Self, String> {
        let mut config = Config::from_str(connection_string).map_err(|error| error.to_string())?;
        if let Some(database) = database {
            if !database.is_empty() {
                config.dbname(database);
            }
        }
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

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let (client, handle) = self.connect().await?;
        let result = client
            .query(
                "SELECT datname FROM pg_database \
                 WHERE datistemplate = false AND datallowconn = true \
                 ORDER BY datname",
                &[],
            )
            .await
            .map_err(|error| error.to_string())
            .map(|rows| rows.into_iter().map(|row| row.get(0)).collect());
        handle.abort();
        result
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        let (client, handle) = self.connect().await?;
        let result = client
            .query(
                "SELECT schema_name FROM information_schema.schemata \
                 WHERE schema_name <> 'information_schema' \
                   AND schema_name NOT LIKE 'pg_%' \
                 ORDER BY schema_name",
                &[],
            )
            .await
            .map_err(|error| error.to_string())
            .map(|rows| rows.into_iter().map(|row| row.get(0)).collect());
        handle.abort();
        result
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let (client, handle) = self.connect().await?;
        let query = match schema {
            Some(schema) => {
                client
                    .query(
                        "SELECT table_schema, table_name \
                         FROM information_schema.tables \
                         WHERE table_type = 'BASE TABLE' AND table_schema = $1 \
                         ORDER BY table_name",
                        &[&schema],
                    )
                    .await
            }
            None => {
                client
                    .query(
                        "SELECT table_schema, table_name \
                         FROM information_schema.tables \
                         WHERE table_type = 'BASE TABLE' \
                           AND table_schema NOT IN ('pg_catalog', 'information_schema') \
                         ORDER BY table_schema, table_name",
                        &[],
                    )
                    .await
            }
        };
        let result = query.map_err(|error| error.to_string()).map(|rows| {
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
        filter: Option<&str>,
        limit: i64,
        order_by: Option<&str>,
        order_desc: bool,
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

            let where_clause = match filter {
                Some(expression) if !expression.trim().is_empty() => {
                    format!(" WHERE {}", expression.trim())
                }
                _ => String::new(),
            };
            let order_clause = match order_by {
                Some(column) if columns.iter().any(|name| name == column) => {
                    let direction = if order_desc { "DESC" } else { "ASC" };
                    format!(
                        " ORDER BY t.{} {}",
                        quote_ident(column),
                        direction
                    )
                }
                _ => String::new(),
            };
            let sql = format!(
                "SELECT to_jsonb(t) || jsonb_build_object('__ctid__', t.ctid::text) FROM {}.{} AS t{}{} LIMIT $1",
                quote_ident(schema),
                quote_ident(table),
                where_clause,
                order_clause,
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

    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
    ) -> Result<i64, String> {
        let (client, handle) = self.connect().await?;
        let where_clause = match filter {
            Some(expression) if !expression.trim().is_empty() => {
                format!(" WHERE {}", expression.trim())
            }
            _ => String::new(),
        };
        let sql = format!(
            "SELECT COUNT(*) FROM {}.{}{}",
            quote_ident(schema),
            quote_ident(table),
            where_clause,
        );
        let result = client
            .query_one(&sql, &[])
            .await
            .map_err(|e| e.to_string())
            .map(|row| row.get::<_, i64>(0));
        handle.abort();
        result
    }

    async fn update_row(
        &self,
        schema: &str,
        table: &str,
        ctid: &str,
        updates: &std::collections::HashMap<String, Option<String>>,
    ) -> Result<(), String> {
        let ctid = ctid.trim();
        let ctid_valid = ctid.starts_with('(') && ctid.ends_with(')') && {
            let inner = &ctid[1..ctid.len() - 1];
            let parts: Vec<&str> = inner.splitn(2, ',').collect();
            parts.len() == 2
                && parts[0].trim().parse::<u64>().is_ok()
                && parts[1].trim().parse::<u64>().is_ok()
        };
        if !ctid_valid {
            return Err("Ungültige ctid".to_string());
        }

        let (client, handle) = self.connect().await?;

        let result = async {
            let col_rows = client
                .query(
                    "SELECT column_name FROM information_schema.columns \
                     WHERE table_schema = $1 AND table_name = $2",
                    &[&schema, &table],
                )
                .await
                .map_err(|e| e.to_string())?;

            let valid_columns: std::collections::HashSet<String> =
                col_rows.iter().map(|r| r.get::<_, String>(0)).collect();

            let mut set_parts: Vec<String> = Vec::new();
            for (col, val) in updates {
                if !valid_columns.contains(col) {
                    return Err(format!("Unbekannte Spalte: {col}"));
                }
                let sql_val = match val {
                    None => "NULL".to_string(),
                    Some(s) if s.is_empty() => "NULL".to_string(),
                    Some(s) => format!("'{}'", s.replace('\'', "''")),
                };
                set_parts.push(format!("{} = {}", quote_ident(col), sql_val));
            }

            if set_parts.is_empty() {
                return Ok(());
            }

            let sql = format!(
                "UPDATE {}.{} SET {} WHERE ctid = '{}'::tid",
                quote_ident(schema),
                quote_ident(table),
                set_parts.join(", "),
                ctid,
            );

            client
                .execute(sql.as_str(), &[])
                .await
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
        .await;

        handle.abort();
        result
    }
}
