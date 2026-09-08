use async_trait::async_trait;
use mysql_async::consts::{ColumnFlags, ColumnType};
use mysql_async::prelude::*;
use mysql_async::{Column, Conn, Opts, OptsBuilder, Pool, Row, SslOpts, Value};

use super::pool::PoolState;
use super::{
    attach_row_keys, create_table_sql, hex_blob, rows_to_objects, timed, where_clause,
    AddColumnRequest, AlterColumnRequest, ColumnInfo, ConstraintInfo, CreateTableRequest,
    DatabaseAdapter, DatabaseOverview, DetailedColumnInfo, ForeignKeyInfo, FunctionInfo, IndexInfo,
    QueryResult, SchemaSize, SessionInfo, SslMode, TableData, TableInfo, TriggerInfo, TxSession,
};

pub struct MysqlAdapter {
    opts: Opts,
    pool_state: PoolState,
    key: String,
}

pub fn quote(ident: &str) -> String {
    format!("`{}`", ident.replace('`', "``"))
}

pub fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
}

fn default_sql(value: &str) -> String {
    let trimmed = value.trim();
    let upper = trimmed.to_uppercase();
    if upper == "NULL" || upper.starts_with("CURRENT_TIMESTAMP") {
        trimmed.to_string()
    } else if trimmed.ends_with(')') {
        format!("({trimmed})")
    } else {
        lit(trimmed)
    }
}

fn map_err(e: mysql_async::Error) -> String {
    match e {
        mysql_async::Error::Server(err) => format!("MySQL {}: {}", err.code, err.message),
        other => format!("MySQL: {other}"),
    }
}

fn is_numeric(column: &Column) -> bool {
    matches!(
        column.column_type(),
        ColumnType::MYSQL_TYPE_TINY
            | ColumnType::MYSQL_TYPE_SHORT
            | ColumnType::MYSQL_TYPE_LONG
            | ColumnType::MYSQL_TYPE_LONGLONG
            | ColumnType::MYSQL_TYPE_INT24
            | ColumnType::MYSQL_TYPE_YEAR
            | ColumnType::MYSQL_TYPE_FLOAT
            | ColumnType::MYSQL_TYPE_DOUBLE
            | ColumnType::MYSQL_TYPE_DECIMAL
            | ColumnType::MYSQL_TYPE_NEWDECIMAL
    )
}

fn is_binary(column: &Column) -> bool {
    column.character_set() == 63
        && column.flags().contains(ColumnFlags::BINARY_FLAG)
        && matches!(
            column.column_type(),
            ColumnType::MYSQL_TYPE_BLOB
                | ColumnType::MYSQL_TYPE_TINY_BLOB
                | ColumnType::MYSQL_TYPE_MEDIUM_BLOB
                | ColumnType::MYSQL_TYPE_LONG_BLOB
                | ColumnType::MYSQL_TYPE_VAR_STRING
                | ColumnType::MYSQL_TYPE_STRING
                | ColumnType::MYSQL_TYPE_GEOMETRY
        )
}

fn value_to_json(value: Value, column: &Column) -> serde_json::Value {
    match value {
        Value::NULL => serde_json::Value::Null,
        Value::Bytes(bytes) => {
            if is_binary(column) {
                return serde_json::Value::String(hex_blob(&bytes));
            }
            let text = String::from_utf8_lossy(&bytes).into_owned();
            if is_numeric(column) {
                if let Ok(i) = text.parse::<i64>() {
                    return serde_json::Value::from(i);
                }
                if let Ok(f) = text.parse::<f64>() {
                    if let Some(n) = serde_json::Number::from_f64(f) {
                        return serde_json::Value::Number(n);
                    }
                }
            }
            if column.column_type() == ColumnType::MYSQL_TYPE_JSON {
                if let Ok(json) = serde_json::from_str(&text) {
                    return json;
                }
            }
            serde_json::Value::String(text)
        }
        Value::Int(i) => serde_json::Value::from(i),
        Value::UInt(u) => serde_json::Value::from(u),
        Value::Float(f) => serde_json::Number::from_f64(f as f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Double(d) => serde_json::Number::from_f64(d)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Date(y, m, d, h, i, s, us) => serde_json::Value::String(
            if h == 0
                && i == 0
                && s == 0
                && us == 0
                && column.column_type() == ColumnType::MYSQL_TYPE_DATE
            {
                format!("{y:04}-{m:02}-{d:02}")
            } else {
                format!(
                    "{y:04}-{m:02}-{d:02} {h:02}:{i:02}:{s:02}{}",
                    if us > 0 {
                        format!(".{us:06}")
                    } else {
                        String::new()
                    }
                )
            },
        ),
        Value::Time(neg, d, h, i, s, us) => serde_json::Value::String(format!(
            "{}{:02}:{i:02}:{s:02}{}",
            if neg { "-" } else { "" },
            u32::from(h) + d * 24,
            if us > 0 {
                format!(".{us:06}")
            } else {
                String::new()
            }
        )),
    }
}

fn cell(row: &Row, index: usize) -> String {
    match row.as_ref(index) {
        Some(Value::Bytes(b)) => String::from_utf8_lossy(b).into_owned(),
        Some(Value::NULL) | None => String::new(),
        Some(Value::Int(i)) => i.to_string(),
        Some(Value::UInt(u)) => u.to_string(),
        Some(other) => format!("{other:?}"),
    }
}

fn cell_opt(row: &Row, index: usize) -> Option<String> {
    match row.as_ref(index) {
        Some(Value::NULL) | None => None,
        _ => Some(cell(row, index)),
    }
}

fn cell_i64(row: &Row, index: usize) -> i64 {
    cell(row, index).parse().unwrap_or(0)
}

impl MysqlAdapter {
    pub fn new(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let mut url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige MySQL-URL".to_string())?;
        if !matches!(url.scheme(), "mysql" | "mariadb") {
            return Err("Eine mysql:// URL ist erforderlich".to_string());
        }
        let mut ssl = SslMode::Prefer;
        let mut explicit_ssl = false;
        let pairs: Vec<(String, String)> = url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        let mut kept = Vec::new();
        for (k, v) in pairs {
            match k.as_str() {
                "sslmode" => {
                    explicit_ssl = true;
                    ssl = serde_json::from_value(serde_json::Value::String(v))
                        .map_err(|_| "Ungültiger SSL-Modus".to_string())?;
                }
                "ssl-mode" | "ssl_mode" => {
                    explicit_ssl = true;
                    ssl = match v.to_lowercase().as_str() {
                        "disabled" => SslMode::Disable,
                        "preferred" => SslMode::Prefer,
                        "required" => SslMode::Require,
                        "verify_ca" => SslMode::VerifyCa,
                        "verify_identity" => SslMode::VerifyFull,
                        _ => return Err("Ungültiger SSL-Modus".to_string()),
                    };
                }
                _ => kept.push((k, v)),
            }
        }
        url.set_scheme("mysql").ok();
        url.query_pairs_mut()
            .clear()
            .extend_pairs(kept.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        if url.query().is_some_and(str::is_empty) {
            url.set_query(None);
        }
        let opts = Opts::from_url(url.as_str()).map_err(|e| format!("Ungültige MySQL-URL: {e}"))?;
        let mut builder = OptsBuilder::from_opts(opts)
            .tcp_nodelay(true)
            .client_found_rows(true)
            .conn_ttl(Some(std::time::Duration::from_secs(60)));
        if let Some(db) = database.filter(|d| !d.is_empty()) {
            builder = builder.db_name(Some(db));
        }
        if explicit_ssl
            || url
                .host_str()
                .is_some_and(|h| !matches!(h, "localhost" | "127.0.0.1" | "::1"))
        {
            builder = builder.ssl_opts(match ssl {
                SslMode::Disable => None,
                SslMode::Prefer if !explicit_ssl => None,
                SslMode::Prefer | SslMode::Require => {
                    Some(SslOpts::default().with_danger_accept_invalid_certs(true))
                }
                SslMode::VerifyCa => {
                    Some(SslOpts::default().with_danger_skip_domain_validation(true))
                }
                SslMode::VerifyFull => Some(SslOpts::default()),
            });
        }
        Ok(Self {
            opts: builder.into(),
            pool_state,
            key,
        })
    }

    async fn conn(&self) -> Result<Conn, String> {
        let opts = self.opts.clone();
        let pool = self
            .pool_state
            .shared(
                &self.key,
                || async move { Ok::<Pool, String>(Pool::new(opts)) },
            )
            .await?;
        timed(async { pool.get_conn().await.map_err(map_err) }).await
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Row>, String> {
        let mut conn = self.conn().await?;
        timed(async { conn.query(sql).await.map_err(map_err) }).await
    }

    async fn exec(&self, sql: &str) -> Result<(), String> {
        let mut conn = self.conn().await?;
        timed(async { conn.query_drop(sql).await.map_err(map_err) }).await
    }

    async fn current_database(&self, conn: &mut Conn) -> Result<String, String> {
        let row: Option<Option<String>> = conn
            .query_first("SELECT DATABASE()")
            .await
            .map_err(map_err)?;
        Ok(row.flatten().unwrap_or_default())
    }

    fn function_oid(schema: &str, name: &str, routine_type: &str) -> String {
        format!("{schema}\u{1f}{name}\u{1f}{routine_type}")
    }
}

async fn run_query(conn: &mut Conn, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    timed(async {
        let mut result = conn.query_iter(sql).await.map_err(map_err)?;
        let columns_meta: Vec<Column> = result.columns().map(|c| c.to_vec()).unwrap_or_default();
        let columns: Vec<String> = columns_meta
            .iter()
            .map(|c| c.name_str().into_owned())
            .collect();
        let rows: Vec<Row> = result.collect().await.map_err(map_err)?;
        let rows_affected = if columns.is_empty() {
            Some(result.affected_rows())
        } else {
            None
        };
        result.drop_result().await.map_err(map_err)?;
        let data: Vec<Vec<serde_json::Value>> = rows
            .into_iter()
            .map(|row| {
                let values = row.unwrap();
                values
                    .into_iter()
                    .zip(columns_meta.iter())
                    .map(|(v, c)| value_to_json(v, c))
                    .collect()
            })
            .collect();
        Ok(QueryResult {
            rows: rows_to_objects(&columns, data),
            columns,
            rows_affected,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    })
    .await
}

struct MysqlTx {
    conn: Conn,
}

#[async_trait]
impl TxSession for MysqlTx {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        run_query(&mut self.conn, sql).await
    }
    async fn commit(&mut self) -> Result<(), String> {
        self.conn.query_drop("COMMIT").await.map_err(map_err)
    }
    async fn rollback(&mut self) -> Result<(), String> {
        self.conn.query_drop("ROLLBACK").await.map_err(map_err)
    }
}

#[async_trait]
impl DatabaseAdapter for MysqlAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        let mut conn = timed(async { Conn::new(self.opts.clone()).await.map_err(map_err) }).await?;
        conn.query_drop("SELECT 1").await.map_err(map_err)?;
        conn.disconnect().await.map_err(map_err)
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SHOW DATABASES")
            .await?
            .iter()
            .map(|r| cell(r, 0))
            .collect())
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys') ORDER BY schema_name")
            .await?
            .iter()
            .map(|r| cell(r, 0))
            .collect())
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let filter = match schema {
            Some(s) => format!(" AND table_schema = {}", lit(s)),
            None => " AND table_schema = DATABASE()".to_string(),
        };
        let sql = format!("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE'{filter} ORDER BY table_schema, table_name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: cell(r, 0),
                name: cell(r, 1),
            })
            .collect())
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let kind = if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
            "VIEW"
        } else {
            "BASE TABLE"
        };
        let mut sql = format!("SELECT c.table_schema, c.table_name, c.column_name, c.column_type FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name WHERE t.table_type = '{kind}'");
        match schema {
            Some(s) => sql.push_str(&format!(" AND c.table_schema = {}", lit(s))),
            None => sql.push_str(" AND c.table_schema = DATABASE()"),
        }
        if let Some(t) = table {
            sql.push_str(&format!(" AND c.table_name = {}", lit(t)));
        }
        sql.push_str(" ORDER BY c.table_schema, c.table_name, c.ordinal_position");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| ColumnInfo {
                schema: cell(r, 0),
                table: cell(r, 1),
                name: cell(r, 2),
                data_type: cell(r, 3),
            })
            .collect())
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
        _is_view: bool,
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let where_sql = where_clause(filter, allow_raw_filter)?;
        let detailed = self.list_table_columns_detailed(schema, table).await?;
        let pk: Vec<String> = detailed
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name.clone())
            .collect();
        let columns: Vec<String> = detailed.into_iter().map(|c| c.name).collect();
        let order_sql = match order_by {
            Some(col) if columns.iter().any(|c| c == col) => format!(
                " ORDER BY {} {}",
                quote(col),
                if order_desc { "DESC" } else { "ASC" }
            ),
            _ => String::new(),
        };
        let sql = format!(
            "SELECT * FROM {}.{}{}{} LIMIT {} OFFSET {}",
            quote(schema),
            quote(table),
            where_sql,
            order_sql,
            limit.max(0),
            offset.max(0)
        );
        let mut result = self.execute_query(&sql).await?;
        attach_row_keys(&mut result.rows, &pk);
        Ok(TableData {
            columns: if columns.is_empty() {
                result.columns
            } else {
                columns
            },
            rows: result.rows,
        })
    }

    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let sql = format!(
            "SELECT COUNT(*) FROM {}.{}{}",
            quote(schema),
            quote(table),
            where_clause(filter, allow_raw_filter)?
        );
        Ok(self
            .rows(&sql)
            .await?
            .first()
            .map(|r| cell_i64(r, 0))
            .unwrap_or(0))
    }

    async fn begin_transaction(&self) -> Result<Box<dyn TxSession>, String> {
        let mut conn = timed(async { Conn::new(self.opts.clone()).await.map_err(map_err) }).await?;
        conn.query_drop("START TRANSACTION")
            .await
            .map_err(map_err)?;
        Ok(Box::new(MysqlTx { conn }))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let mut conn = self.conn().await?;
        run_query(&mut conn, sql).await
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let filter = match schema {
            Some(s) => format!(" WHERE table_schema = {}", lit(s)),
            None => " WHERE table_schema = DATABASE()".to_string(),
        };
        let sql = format!("SELECT table_schema, table_name FROM information_schema.views{filter} ORDER BY table_name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: cell(r, 0),
                name: cell(r, 1),
            })
            .collect())
    }

    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let sql = format!("SELECT view_definition FROM information_schema.views WHERE table_schema = {} AND table_name = {}", lit(schema), lit(view));
        self.rows(&sql)
            .await?
            .first()
            .map(|r| cell(r, 0))
            .ok_or_else(|| "View nicht gefunden".to_string())
    }

    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String> {
        if dry_run {
            return self.exec(&format!("EXPLAIN {body}")).await;
        }
        self.exec(&format!(
            "CREATE OR REPLACE VIEW {}.{} AS {}",
            quote(schema),
            quote(view),
            body
        ))
        .await
    }

    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let filter = match schema {
            Some(s) => format!(" WHERE routine_schema = {}", lit(s)),
            None => " WHERE routine_schema = DATABASE()".to_string(),
        };
        let sql = format!("SELECT routine_schema, routine_name, routine_type, COALESCE(dtd_identifier, ''), external_language FROM information_schema.routines{filter} ORDER BY routine_name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| {
                let (schema, name, routine_type) = (cell(r, 0), cell(r, 1), cell(r, 2));
                FunctionInfo {
                    oid: Self::function_oid(&schema, &name, &routine_type),
                    identity_args: String::new(),
                    return_type: if routine_type == "PROCEDURE" {
                        "PROCEDURE".to_string()
                    } else {
                        cell(r, 3)
                    },
                    language: cell_opt(r, 4).unwrap_or_else(|| "SQL".to_string()),
                    schema,
                    name,
                }
            })
            .collect())
    }

    async fn get_function_definition(&self, oid: &str) -> Result<String, String> {
        let parts: Vec<&str> = oid.split('\u{1f}').collect();
        if parts.len() != 3 {
            return Err("Ungültige Funktionsreferenz".to_string());
        }
        let keyword = if parts[2] == "PROCEDURE" {
            "PROCEDURE"
        } else {
            "FUNCTION"
        };
        let sql = format!(
            "SHOW CREATE {keyword} {}.{}",
            quote(parts[0]),
            quote(parts[1])
        );
        self.rows(&sql)
            .await?
            .first()
            .map(|r| cell(r, 2))
            .ok_or_else(|| "Funktion nicht gefunden".to_string())
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!("DROP TABLE {}.{}", quote(schema), quote(table)))
            .await
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!(
            "TRUNCATE TABLE {}.{}",
            quote(schema),
            quote(table)
        ))
        .await
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let sql = format!(
            "SELECT column_name, column_type, is_nullable, column_default, column_key, ordinal_position, character_maximum_length FROM information_schema.columns WHERE table_schema = {} AND table_name = {} ORDER BY ordinal_position",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| DetailedColumnInfo {
                name: cell(r, 0),
                data_type: cell(r, 1),
                is_nullable: cell(r, 2) == "YES",
                column_default: cell_opt(r, 3),
                is_primary_key: cell(r, 4) == "PRI",
                ordinal_position: cell_i64(r, 5) as i32,
                character_maximum_length: cell_opt(r, 6).and_then(|v| v.parse().ok()),
            })
            .collect())
    }

    async fn add_column(
        &self,
        schema: &str,
        table: &str,
        column: &AddColumnRequest,
    ) -> Result<(), String> {
        let mut sql = format!(
            "ALTER TABLE {}.{} ADD COLUMN {} {}",
            quote(schema),
            quote(table),
            quote(&column.name),
            column.data_type
        );
        if !column.is_nullable {
            sql.push_str(" NOT NULL");
        }
        if let Some(d) = column.default_value.as_deref().filter(|d| !d.is_empty()) {
            sql.push_str(&format!(" DEFAULT {d}"));
        }
        self.exec(&sql).await
    }

    async fn alter_column(
        &self,
        schema: &str,
        table: &str,
        changes: &AlterColumnRequest,
    ) -> Result<(), String> {
        let current = self
            .list_table_columns_detailed(schema, table)
            .await?
            .into_iter()
            .find(|c| c.name == changes.old_name)
            .ok_or_else(|| format!("Unbekannte Spalte: {}", changes.old_name))?;
        let name = changes
            .new_name
            .as_deref()
            .filter(|n| !n.is_empty())
            .unwrap_or(&changes.old_name);
        let data_type = changes
            .data_type
            .as_deref()
            .filter(|t| !t.is_empty())
            .unwrap_or(&current.data_type);
        let not_null = changes.set_not_null.unwrap_or(!current.is_nullable);
        let default = if changes.drop_default {
            None
        } else {
            changes
                .new_default
                .as_deref()
                .filter(|d| !d.is_empty())
                .map(str::to_string)
                .or_else(|| current.column_default.as_deref().map(default_sql))
        };
        let mut sql = format!(
            "ALTER TABLE {}.{} CHANGE COLUMN {} {} {}",
            quote(schema),
            quote(table),
            quote(&changes.old_name),
            quote(name),
            data_type
        );
        if not_null {
            sql.push_str(" NOT NULL");
        } else {
            sql.push_str(" NULL");
        }
        if let Some(d) = default {
            sql.push_str(&format!(" DEFAULT {d}"));
        }
        self.exec(&sql).await
    }

    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String> {
        self.exec(&format!(
            "ALTER TABLE {}.{} DROP COLUMN {}",
            quote(schema),
            quote(table),
            quote(column)
        ))
        .await
    }

    async fn list_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, String> {
        let sql = format!(
            "SELECT constraint_name, table_schema, table_name, column_name, referenced_table_schema, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage WHERE referenced_table_name IS NOT NULL AND table_schema = {} AND table_name = {} ORDER BY constraint_name, ordinal_position",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| ForeignKeyInfo {
                constraint_name: cell(r, 0),
                from_schema: cell(r, 1),
                from_table: cell(r, 2),
                from_column: cell(r, 3),
                to_schema: cell(r, 4),
                to_table: cell(r, 5),
                to_column: cell(r, 6),
            })
            .collect())
    }

    async fn list_triggers(&self, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
        let sql = format!(
            "SELECT trigger_name, event_manipulation, action_timing, action_orientation, action_statement FROM information_schema.triggers WHERE event_object_schema = {} AND event_object_table = {} ORDER BY trigger_name",
            lit(schema),
            lit(table)
        );
        let rows = self.rows(&sql).await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in rows.iter() {
            let name = cell(r, 0);
            let definition = self
                .rows(&format!(
                    "SHOW CREATE TRIGGER {}.{}",
                    quote(schema),
                    quote(&name)
                ))
                .await
                .ok()
                .and_then(|rows| rows.first().map(|r| cell(r, 2)))
                .unwrap_or_else(|| cell(r, 4));
            out.push(TriggerInfo {
                trigger_name: name,
                table_schema: schema.to_string(),
                table_name: table.to_string(),
                event: cell(r, 1),
                timing: cell(r, 2),
                orientation: cell(r, 3),
                function_schema: String::new(),
                function_name: String::new(),
                enabled: "O".to_string(),
                definition,
            });
        }
        Ok(out)
    }

    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let sql = format!(
            "SELECT index_name, non_unique, column_name, index_type FROM information_schema.statistics WHERE table_schema = {} AND table_name = {} ORDER BY index_name, seq_in_index",
            lit(schema),
            lit(table)
        );
        let mut out: Vec<IndexInfo> = Vec::new();
        for r in self.rows(&sql).await? {
            let name = cell(&r, 0);
            let column = cell(&r, 2);
            if let Some(existing) = out.iter_mut().find(|i| i.name == name) {
                existing.columns.push(column);
                continue;
            }
            out.push(IndexInfo {
                is_unique: cell(&r, 1) == "0",
                is_primary: name == "PRIMARY",
                columns: vec![column],
                index_type: cell(&r, 3).to_lowercase(),
                definition: String::new(),
                name,
            });
        }
        for idx in &mut out {
            idx.definition = format!(
                "{}INDEX {} ON {}.{} ({})",
                if idx.is_unique { "UNIQUE " } else { "" },
                quote(&idx.name),
                quote(schema),
                quote(table),
                idx.columns
                    .iter()
                    .map(|c| quote(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        Ok(out)
    }

    async fn list_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, String> {
        let sql = format!(
            "SELECT tc.constraint_name, tc.constraint_type, GROUP_CONCAT(kcu.column_name ORDER BY kcu.ordinal_position SEPARATOR ',') FROM information_schema.table_constraints tc LEFT JOIN information_schema.key_column_usage kcu ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name WHERE tc.table_schema = {} AND tc.table_name = {} GROUP BY tc.constraint_name, tc.constraint_type ORDER BY tc.constraint_type, tc.constraint_name",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| {
                let columns: Vec<String> = cell_opt(r, 2)
                    .map(|c| c.split(',').map(str::to_string).collect())
                    .unwrap_or_default();
                ConstraintInfo {
                    name: cell(r, 0),
                    definition: format!("{} ({})", cell(r, 1), columns.join(", ")),
                    constraint_type: cell(r, 1),
                    columns,
                }
            })
            .collect())
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        self.exec(&create_table_sql(req, quote, true)).await
    }

    async fn explain_query(&self, sql: &str, analyze: bool) -> Result<serde_json::Value, String> {
        let rows = self
            .rows(&format!(
                "EXPLAIN {} {sql}",
                if analyze { "ANALYZE" } else { "FORMAT=JSON" }
            ))
            .await?;
        let text: Vec<String> = rows.iter().map(|r| cell(r, 0)).collect();
        if analyze {
            return Ok(serde_json::Value::String(text.join("\n")));
        }
        serde_json::from_str(text.first().map(String::as_str).unwrap_or("{}"))
            .map_err(|e| format!("EXPLAIN konnte nicht gelesen werden: {e}"))
    }

    async fn list_sessions(&self) -> Result<Vec<SessionInfo>, String> {
        let mut conn = self.conn().await?;
        let self_id: Option<u64> = conn
            .query_first("SELECT CONNECTION_ID()")
            .await
            .map_err(map_err)?;
        let rows: Vec<Row> = conn
            .query("SELECT id, user, COALESCE(db, ''), COALESCE(command, ''), COALESCE(host, ''), COALESCE(state, ''), COALESCE(info, ''), time FROM information_schema.processlist ORDER BY id")
            .await
            .map_err(map_err)?;
        Ok(rows
            .iter()
            .map(|r| {
                let pid = cell_i64(r, 0);
                SessionInfo {
                    pid: pid as i32,
                    user: cell(r, 1),
                    database: cell(r, 2),
                    application: cell(r, 3),
                    client_addr: cell_opt(r, 4),
                    state: cell_opt(r, 5),
                    query: cell(r, 6),
                    query_start: Some(format!("vor {} s", cell(r, 7))),
                    transaction_start: None,
                    wait_event: None,
                    is_self: self_id == Some(pid as u64),
                    blocked_by: Vec::new(),
                }
            })
            .collect())
    }

    async fn cancel_session(&self, pid: i32) -> Result<bool, String> {
        self.exec(&format!("KILL QUERY {pid}")).await.map(|_| true)
    }

    async fn terminate_session(&self, pid: i32) -> Result<bool, String> {
        self.exec(&format!("KILL CONNECTION {pid}"))
            .await
            .map(|_| true)
    }

    async fn create_schema(&self, name: &str) -> Result<(), String> {
        self.exec(&format!("CREATE DATABASE {}", quote(name))).await
    }

    async fn drop_schema(&self, name: &str, _cascade: bool) -> Result<(), String> {
        self.exec(&format!("DROP DATABASE {}", quote(name))).await
    }

    async fn get_database_overview(&self) -> Result<DatabaseOverview, String> {
        let mut conn = self.conn().await?;
        let database = self.current_database(&mut conn).await?;
        let rows: Vec<Row> = conn
            .query("SELECT table_schema, COUNT(*), COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','performance_schema','mysql','sys') GROUP BY table_schema ORDER BY table_schema")
            .await
            .map_err(map_err)?;
        let schemas: Vec<SchemaSize> = rows
            .iter()
            .map(|r| SchemaSize {
                schema: cell(r, 0),
                table_count: cell_i64(r, 1),
                size_bytes: cell_i64(r, 2),
            })
            .collect();
        let size_bytes = schemas
            .iter()
            .filter(|s| database.is_empty() || s.schema == database)
            .map(|s| s.size_bytes)
            .sum();
        Ok(DatabaseOverview {
            database,
            size_bytes,
            size_pretty: super::pretty_bytes(size_bytes),
            schemas,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::create_pool_state;

    #[test]
    fn translates_sslmode_and_database() {
        let adapter = MysqlAdapter::new(
            "mysql://root:pw@db.example.com:3307/app?sslmode=require&compression=fast",
            Some("other"),
            create_pool_state(),
            "k".into(),
        )
        .unwrap();
        assert_eq!(adapter.opts.db_name(), Some("other"));
        assert_eq!(adapter.opts.ip_or_hostname(), "db.example.com");
        assert_eq!(adapter.opts.tcp_port(), 3307);
        assert!(adapter.opts.ssl_opts().is_some());
        let plain = MysqlAdapter::new(
            "mysql://root@localhost/app",
            None,
            create_pool_state(),
            "k".into(),
        )
        .unwrap();
        assert!(plain.opts.ssl_opts().is_none());
        assert!(
            MysqlAdapter::new("postgres://x@y/z", None, create_pool_state(), "k".into()).is_err()
        );
    }
}
