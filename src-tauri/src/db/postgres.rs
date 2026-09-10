use std::str::FromStr;
use std::time::Duration;

use async_trait::async_trait;
use bb8::PooledConnection;
use bb8_postgres::PostgresConnectionManager;
use tokio::time::timeout;
use tokio_postgres::{Config, NoTls, SimpleQueryMessage};

use super::pool::PoolState;
use super::{map_pg_err, quote_ident, ColumnInfo, ConnectionConfig, DatabaseAdapter, ExtensionInfo, FunctionInfo, QueryResult, TableData, TableInfo};

const QUERY_TIMEOUT: Duration = Duration::from_secs(30);

pub struct PostgresAdapter {
    config: Config,
    pool_state: PoolState,
    pool_key: String,
}

impl PostgresAdapter {
    pub fn from_config(config: ConnectionConfig, pool_state: PoolState) -> Self {
        let mut pg = Config::new();
        pg.host(&config.host)
            .port(config.port)
            .user(&config.user)
            .password(&config.password)
            .dbname(&config.database)
            .connect_timeout(Duration::from_secs(10));
        let pool_key = format!(
            "{}:{}@{}:{}/{}",
            config.user, config.password, config.host, config.port, config.database
        );
        Self {
            config: pg,
            pool_state,
            pool_key,
        }
    }

    pub fn from_connection_string(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
    ) -> Result<Self, String> {
        let mut config =
            Config::from_str(connection_string).map_err(|e| format!("Ungültiger Connection String: {e}"))?;
        if let Some(database) = database {
            if !database.is_empty() {
                config.dbname(database);
            }
        }
        config.connect_timeout(Duration::from_secs(10));
        let pool_key = match database {
            Some(db) if !db.is_empty() => format!("{connection_string}##{db}"),
            _ => connection_string.to_string(),
        };
        Ok(Self {
            config,
            pool_state,
            pool_key,
        })
    }

    async fn get_conn(
        &self,
    ) -> Result<PooledConnection<'static, PostgresConnectionManager<NoTls>>, String> {
        let pool = self
            .pool_state
            .get_pool(&self.pool_key, self.config.clone())
            .await?;
        pool.get_owned()
            .await
            .map_err(|e| format!("Verbindung fehlgeschlagen: {e}"))
    }

    async fn timed<F, T>(&self, future: F) -> Result<T, String>
    where
        F: std::future::Future<Output = Result<T, String>>,
    {
        timeout(QUERY_TIMEOUT, future)
            .await
            .map_err(|_| "Query-Timeout: Die Abfrage hat länger als 30 Sekunden gedauert".to_string())?
    }
}

#[async_trait]
impl DatabaseAdapter for PostgresAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.simple_query("SELECT 1")
                .await
                .map(|_| ())
                .map_err(map_pg_err)
        })
        .await
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.query(
                "SELECT datname FROM pg_database \
                 WHERE datistemplate = false AND datallowconn = true \
                 ORDER BY datname",
                &[],
            )
            .await
            .map_err(map_pg_err)
            .map(|rows| rows.into_iter().map(|row| row.get(0)).collect())
        })
        .await
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.query(
                "SELECT schema_name FROM information_schema.schemata \
                 WHERE schema_name <> 'information_schema' \
                   AND schema_name NOT LIKE 'pg_%' \
                 ORDER BY schema_name",
                &[],
            )
            .await
            .map_err(map_pg_err)
            .map(|rows| rows.into_iter().map(|row| row.get(0)).collect())
        })
        .await
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let query = match schema {
                Some(schema) => {
                    conn.query(
                        "SELECT table_schema, table_name \
                         FROM information_schema.tables \
                         WHERE table_type = 'BASE TABLE' AND table_schema = $1 \
                         ORDER BY table_name",
                        &[&schema],
                    )
                    .await
                }
                None => {
                    conn.query(
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
            query.map_err(map_pg_err).map(|rows| {
                rows.into_iter()
                    .map(|row| TableInfo {
                        schema: row.get(0),
                        name: row.get(1),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let result = match (schema, table) {
                (Some(s), Some(t)) => {
                    conn.query(
                        "SELECT c.table_schema, c.table_name, c.column_name, c.data_type \
                         FROM information_schema.columns c \
                         WHERE c.table_schema = $1 AND c.table_name = $2 \
                         ORDER BY c.ordinal_position",
                        &[&s, &t],
                    )
                    .await
                }
                (Some(s), None) => {
                    conn.query(
                        "SELECT c.table_schema, c.table_name, c.column_name, c.data_type \
                         FROM information_schema.columns c \
                         JOIN information_schema.tables t \
                           ON c.table_schema = t.table_schema AND c.table_name = t.table_name \
                         WHERE t.table_type = 'BASE TABLE' AND c.table_schema = $1 \
                         ORDER BY c.table_schema, c.table_name, c.ordinal_position",
                        &[&s],
                    )
                    .await
                }
                _ => {
                    conn.query(
                        "SELECT c.table_schema, c.table_name, c.column_name, c.data_type \
                         FROM information_schema.columns c \
                         JOIN information_schema.tables t \
                           ON c.table_schema = t.table_schema AND c.table_name = t.table_name \
                         WHERE t.table_type = 'BASE TABLE' \
                           AND c.table_schema NOT IN ('pg_catalog', 'information_schema') \
                         ORDER BY c.table_schema, c.table_name, c.ordinal_position",
                        &[],
                    )
                    .await
                }
            };
            result.map_err(map_pg_err).map(|rows| {
                rows.into_iter()
                    .map(|row| ColumnInfo {
                        schema: row.get(0),
                        table: row.get(1),
                        name: row.get(2),
                        data_type: row.get(3),
                    })
                    .collect()
            })
        })
        .await
    }

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
    ) -> Result<TableData, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let column_rows = conn
                .query(
                    "SELECT column_name \
                     FROM information_schema.columns \
                     WHERE table_schema = $1 AND table_name = $2 \
                     ORDER BY ordinal_position",
                    &[&schema, &table],
                )
                .await
                .map_err(map_pg_err)?;
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
                    format!(" ORDER BY t.{} {}", quote_ident(column), direction)
                }
                _ => String::new(),
            };
            let sql_with_ctid = format!(
                "SELECT to_jsonb(t) || jsonb_build_object('__ctid__', t.ctid::text) FROM {}.{} AS t{}{} LIMIT $1 OFFSET $2",
                quote_ident(schema),
                quote_ident(table),
                where_clause,
                order_clause,
            );
            let sql_without_ctid = format!(
                "SELECT to_jsonb(t) FROM {}.{} AS t{}{} LIMIT $1 OFFSET $2",
                quote_ident(schema),
                quote_ident(table),
                where_clause,
                order_clause,
            );

            let sql = if is_view { &sql_without_ctid } else { &sql_with_ctid };
            let data_rows = match conn.query(sql, &[&limit, &offset]).await {
                Ok(rows) => rows,
                Err(_) if !is_view => {
                    conn.query(&sql_without_ctid, &[&limit, &offset])
                        .await
                        .map_err(map_pg_err)?
                }
                Err(e) => return Err(map_pg_err(e)),
            };
            let rows: Vec<serde_json::Value> = data_rows.iter().map(|row| row.get(0)).collect();

            Ok(TableData { columns, rows })
        })
        .await
    }

    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
    ) -> Result<i64, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
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
            conn.query_one(&sql, &[])
                .await
                .map_err(map_pg_err)
                .map(|row| row.get::<_, i64>(0))
        })
        .await
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

        let conn = self.get_conn().await?;
        self.timed(async {
            let col_rows = conn
                .query(
                    "SELECT column_name FROM information_schema.columns \
                     WHERE table_schema = $1 AND table_name = $2",
                    &[&schema, &table],
                )
                .await
                .map_err(map_pg_err)?;

            let valid_columns: std::collections::HashSet<String> =
                col_rows.iter().map(|r| r.get::<_, String>(0)).collect();

            let mut set_parts: Vec<String> = Vec::new();
            for (col, val) in updates {
                if !valid_columns.contains(col) {
                    return Err(format!("Unbekannte Spalte: {col}"));
                }
                let sql_val = match val {
                    None => "NULL".to_string(),
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

            conn.execute(sql.as_str(), &[])
                .await
                .map(|_| ())
                .map_err(map_pg_err)
        })
        .await
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let conn = self.get_conn().await?;
        let start = std::time::Instant::now();

        self.timed(async {
            let messages = conn.simple_query(sql).await.map_err(map_pg_err)?;
            let elapsed = start.elapsed().as_millis() as u64;

            let mut columns: Vec<String> = Vec::new();
            let mut rows: Vec<serde_json::Value> = Vec::new();
            let mut rows_affected: Option<u64> = None;

            for msg in messages {
                match msg {
                    SimpleQueryMessage::Row(row) => {
                        if columns.is_empty() {
                            columns = row
                                .columns()
                                .iter()
                                .map(|c| c.name().to_string())
                                .collect();
                        }
                        let mut obj = serde_json::Map::new();
                        for (i, col) in columns.iter().enumerate() {
                            let val = row
                                .get(i)
                                .map(|v| serde_json::Value::String(v.to_string()))
                                .unwrap_or(serde_json::Value::Null);
                            obj.insert(col.clone(), val);
                        }
                        rows.push(serde_json::Value::Object(obj));
                    }
                    SimpleQueryMessage::CommandComplete(count) => {
                        rows_affected = Some(count);
                    }
                    _ => {}
                }
            }

            Ok(QueryResult {
                columns,
                rows,
                rows_affected,
                execution_time_ms: elapsed,
            })
        })
        .await
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let query = match schema {
                Some(schema) => {
                    conn.query(
                        "SELECT table_schema, table_name \
                         FROM information_schema.views \
                         WHERE table_schema = $1 \
                         ORDER BY table_name",
                        &[&schema],
                    )
                    .await
                }
                None => {
                    conn.query(
                        "SELECT table_schema, table_name \
                         FROM information_schema.views \
                         WHERE table_schema NOT IN ('pg_catalog', 'information_schema') \
                         ORDER BY table_schema, table_name",
                        &[],
                    )
                    .await
                }
            };
            query.map_err(map_pg_err).map(|rows| {
                rows.into_iter()
                    .map(|row| TableInfo {
                        schema: row.get(0),
                        name: row.get(1),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn get_view_definition(
        &self,
        schema: &str,
        view: &str,
    ) -> Result<String, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.query_one(
                "SELECT pg_get_viewdef(c.oid, true) \
                 FROM pg_class c \
                 JOIN pg_namespace n ON n.oid = c.relnamespace \
                 WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('v', 'm')",
                &[&schema, &view],
            )
            .await
            .map_err(map_pg_err)
            .map(|row| row.get::<_, String>(0))
        })
        .await
    }

    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let query = match schema {
                Some(schema) => {
                    conn.query(
                        "SELECT n.nspname, p.proname, \
                                pg_catalog.pg_get_function_identity_arguments(p.oid), \
                                pg_catalog.pg_get_function_result(p.oid), \
                                l.lanname, \
                                p.oid::text \
                         FROM pg_catalog.pg_proc p \
                         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
                         JOIN pg_catalog.pg_language l ON l.oid = p.prolang \
                         WHERE n.nspname = $1 AND p.prokind IN ('f', 'p') \
                         ORDER BY p.proname",
                        &[&schema],
                    )
                    .await
                }
                None => {
                    conn.query(
                        "SELECT n.nspname, p.proname, \
                                pg_catalog.pg_get_function_identity_arguments(p.oid), \
                                pg_catalog.pg_get_function_result(p.oid), \
                                l.lanname, \
                                p.oid::text \
                         FROM pg_catalog.pg_proc p \
                         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
                         JOIN pg_catalog.pg_language l ON l.oid = p.prolang \
                         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') \
                               AND p.prokind IN ('f', 'p') \
                         ORDER BY n.nspname, p.proname",
                        &[],
                    )
                    .await
                }
            };
            query.map_err(map_pg_err).map(|rows| {
                rows.into_iter()
                    .map(|row| FunctionInfo {
                        schema: row.get(0),
                        name: row.get(1),
                        identity_args: row.get(2),
                        return_type: row.get(3),
                        language: row.get(4),
                        oid: row.get(5),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn get_function_definition(&self, oid: &str) -> Result<String, String> {
        let conn = self.get_conn().await?;
        let oid_val: u32 = oid
            .parse()
            .map_err(|_| format!("Ungültige OID: {oid}"))?;
        self.timed(async {
            conn.query_one(
                "SELECT pg_get_functiondef($1::oid)",
                &[&oid_val],
            )
            .await
            .map_err(map_pg_err)
            .map(|row| row.get::<_, String>(0))
        })
        .await
    }

    async fn list_extensions(&self) -> Result<Vec<ExtensionInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.query(
                "SELECT e.extname, \
                        e.extversion, \
                        n.nspname, \
                        c.description \
                 FROM pg_extension e \
                 JOIN pg_namespace n ON n.oid = e.extnamespace \
                 LEFT JOIN pg_description c \
                   ON c.objoid = e.oid \
                   AND c.classoid = 'pg_extension'::regclass \
                 ORDER BY e.extname",
                &[],
            )
            .await
            .map_err(map_pg_err)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| ExtensionInfo {
                        name: row.get(0),
                        version: row.get(1),
                        schema: row.get(2),
                        description: row.get(3),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn validate_sql(&self, sql: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.simple_query("BEGIN").await.map_err(map_pg_err)?;
            let result = conn.simple_query(sql).await.map_err(map_pg_err);
            let _ = conn.simple_query("ROLLBACK").await;
            result.map(|_| ())
        })
        .await
    }
}
