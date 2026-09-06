use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};

use super::pool::PoolState;
use super::{
    attach_row_keys, create_table_sql, hex_blob, rows_to_objects, unsupported, where_clause,
    AddColumnRequest, AlterColumnRequest, ColumnInfo, ConstraintInfo, CreateTableRequest,
    DatabaseAdapter, DatabaseOverview, DetailedColumnInfo, ForeignKeyInfo, IndexInfo, QueryResult,
    SchemaSize, TableData, TableInfo, TriggerInfo, TxSession,
};

pub struct SqliteAdapter {
    path: String,
    pool_state: PoolState,
    key: String,
}

pub fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

pub fn file_path(connection_string: &str) -> Result<String, String> {
    let value = connection_string.trim();
    if value.is_empty() {
        return Err("Pfad zur Datenbankdatei fehlt".to_string());
    }
    let stripped = value
        .strip_prefix("sqlite://")
        .or_else(|| value.strip_prefix("duckdb://"))
        .or_else(|| value.strip_prefix("file://"))
        .or_else(|| value.strip_prefix("sqlite:"))
        .or_else(|| value.strip_prefix("duckdb:"))
        .unwrap_or(value);
    let stripped = stripped.split('?').next().unwrap_or(stripped);
    if stripped == ":memory:" || stripped.is_empty() {
        return Ok(":memory:".to_string());
    }
    let decoded = url::form_urlencoded::parse(format!("p={stripped}").as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| stripped.to_string());
    let path = if stripped.contains('%') {
        decoded
    } else {
        stripped.to_string()
    };
    let expanded = match path.strip_prefix("~/") {
        Some(rest) => match std::env::var("HOME") {
            Ok(home) => format!("{home}/{rest}"),
            Err(_) => path,
        },
        None => path,
    };
    Ok(expanded)
}

fn value_to_json(value: ValueRef<'_>) -> serde_json::Value {
    match value {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(i) => serde_json::Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(f.to_string())),
        ValueRef::Text(t) => serde_json::Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => serde_json::Value::String(hex_blob(b)),
    }
}

fn map_err(e: rusqlite::Error) -> String {
    format!("SQLite: {e}")
}

fn query_all(
    conn: &Connection,
    sql: &str,
) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>), String> {
    let mut stmt = conn.prepare(sql).map_err(map_err)?;
    let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let count = columns.len();
    let mut rows = Vec::new();
    let mut result = stmt.query([]).map_err(map_err)?;
    while let Some(row) = result.next().map_err(map_err)? {
        let mut values = Vec::with_capacity(count);
        for i in 0..count {
            values.push(value_to_json(row.get_ref(i).map_err(map_err)?));
        }
        rows.push(values);
    }
    Ok((columns, rows))
}

fn strings(conn: &Connection, sql: &str) -> Result<Vec<String>, String> {
    let (_, rows) = query_all(conn, sql)?;
    Ok(rows
        .into_iter()
        .filter_map(|r| r.into_iter().next())
        .map(|v| match v {
            serde_json::Value::String(s) => s,
            other => other.to_string(),
        })
        .collect())
}

fn text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn truthy(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::String(s) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

impl SqliteAdapter {
    pub fn new(
        connection_string: &str,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        Ok(Self {
            path: file_path(connection_string)?,
            pool_state,
            key,
        })
    }

    fn open(path: &str) -> Result<Connection, String> {
        let conn = if path == ":memory:" {
            Connection::open_in_memory().map_err(map_err)?
        } else {
            Connection::open_with_flags(
                path,
                OpenFlags::SQLITE_OPEN_READ_WRITE
                    | OpenFlags::SQLITE_OPEN_CREATE
                    | OpenFlags::SQLITE_OPEN_URI,
            )
            .map_err(|e| format!("SQLite-Datei konnte nicht geöffnet werden ({path}): {e}"))?
        };
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(map_err)?;
        Ok(conn)
    }

    async fn conn(&self) -> Result<Arc<Mutex<Connection>>, String> {
        let path = self.path.clone();
        self.pool_state
            .shared(
                &self.key,
                || async move { Self::open(&path).map(Mutex::new) },
            )
            .await
    }

    async fn run<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    {
        run_blocking(self.conn().await?, f).await
    }

    fn master(schema: &str) -> String {
        format!("{}.sqlite_master", quote(schema))
    }

    fn table_info(
        conn: &Connection,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let (_, rows) = query_all(
            conn,
            &format!("PRAGMA {}.table_info({})", quote(schema), quote(table)),
        )?;
        Ok(rows
            .iter()
            .map(|r| DetailedColumnInfo {
                name: text(&r[1]),
                data_type: text(&r[2]),
                is_nullable: !truthy(&r[3]),
                column_default: r.get(4).filter(|v| !v.is_null()).map(text),
                is_primary_key: truthy(&r[5]),
                ordinal_position: r[0].as_i64().unwrap_or(0) as i32 + 1,
                character_maximum_length: None,
            })
            .collect())
    }
}

fn run_query(c: &Connection, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    match c.prepare(sql) {
        Ok(stmt) if stmt.column_count() > 0 => {
            drop(stmt);
            let (columns, rows) = query_all(c, sql)?;
            Ok(QueryResult {
                columns: columns.clone(),
                rows: rows_to_objects(&columns, rows),
                rows_affected: None,
                execution_time_ms: start.elapsed().as_millis() as u64,
            })
        }
        Ok(mut stmt) => {
            let affected = stmt.execute([]).map_err(map_err)?;
            Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: Some(affected as u64),
                execution_time_ms: start.elapsed().as_millis() as u64,
            })
        }
        Err(rusqlite::Error::MultipleStatement) => {
            c.execute_batch(sql).map_err(map_err)?;
            Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: Some(c.changes()),
                execution_time_ms: start.elapsed().as_millis() as u64,
            })
        }
        Err(e) => Err(map_err(e)),
    }
}

async fn run_blocking<T, F>(conn: Arc<Mutex<Connection>>, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let guard = conn
            .lock()
            .map_err(|_| "SQLite-Verbindung ist blockiert".to_string())?;
        f(&guard)
    })
    .await
    .map_err(|e| format!("SQLite-Task fehlgeschlagen: {e}"))?
}

struct SqliteTx {
    conn: Arc<Mutex<Connection>>,
}

#[async_trait]
impl TxSession for SqliteTx {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        let sql = sql.trim().to_string();
        run_blocking(self.conn.clone(), move |c| run_query(c, &sql)).await
    }
    async fn commit(&mut self) -> Result<(), String> {
        run_blocking(self.conn.clone(), |c| {
            c.execute_batch("COMMIT").map_err(map_err)
        })
        .await
    }
    async fn rollback(&mut self) -> Result<(), String> {
        run_blocking(self.conn.clone(), |c| {
            c.execute_batch("ROLLBACK").map_err(map_err)
        })
        .await
    }
}

#[async_trait]
impl DatabaseAdapter for SqliteAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.run(|c| c.execute_batch("SELECT 1").map_err(map_err))
            .await
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        self.run(|c| strings(c, "SELECT name FROM pragma_database_list ORDER BY seq"))
            .await
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        self.list_databases().await
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let schema = schema.unwrap_or("main").to_string();
        self.run(move |c| {
            let names = strings(
                c,
                &format!("SELECT name FROM {} WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name", Self::master(&schema)),
            )?;
            Ok(names.into_iter().map(|name| TableInfo { schema: schema.clone(), name }).collect())
        })
        .await
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let schema = schema.unwrap_or("main").to_string();
        let table = table.map(str::to_string);
        let object_type = if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
            "view"
        } else {
            "table"
        };
        self.run(move |c| {
            let tables = match table {
                Some(t) => vec![t],
                None => strings(c, &format!("SELECT name FROM {} WHERE type = '{object_type}' AND name NOT LIKE 'sqlite_%' ORDER BY name", Self::master(&schema)))?,
            };
            let mut out = Vec::new();
            for t in tables {
                for col in Self::table_info(c, &schema, &t)? {
                    out.push(ColumnInfo { schema: schema.clone(), table: t.clone(), name: col.name, data_type: col.data_type });
                }
            }
            Ok(out)
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
        _is_view: bool,
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let where_sql = where_clause(filter, allow_raw_filter)?;
        let (schema, table, order_by) = (
            schema.to_string(),
            table.to_string(),
            order_by.map(str::to_string),
        );
        self.run(move |c| {
            let detailed = Self::table_info(c, &schema, &table)?;
            let pk: Vec<String> = detailed
                .iter()
                .filter(|c| c.is_primary_key)
                .map(|c| c.name.clone())
                .collect();
            let columns: Vec<String> = detailed.into_iter().map(|c| c.name).collect();
            let order_sql = match order_by {
                Some(col) if columns.contains(&col) => format!(
                    " ORDER BY {} {}",
                    quote(&col),
                    if order_desc { "DESC" } else { "ASC" }
                ),
                _ => String::new(),
            };
            let sql = format!(
                "SELECT * FROM {}.{}{}{} LIMIT {} OFFSET {}",
                quote(&schema),
                quote(&table),
                where_sql,
                order_sql,
                limit.max(0),
                offset.max(0)
            );
            let (cols, rows) = query_all(c, &sql)?;
            let mut rows = rows_to_objects(&cols, rows);
            attach_row_keys(&mut rows, &pk);
            Ok(TableData {
                columns: if columns.is_empty() {
                    cols.clone()
                } else {
                    columns
                },
                rows,
            })
        })
        .await
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
        self.run(move |c| {
            c.query_row(&sql, [], |r| r.get::<_, i64>(0))
                .map_err(map_err)
        })
        .await
    }

    async fn begin_transaction(&self) -> Result<Box<dyn TxSession>, String> {
        let conn = if self.path == ":memory:" {
            self.conn().await?
        } else {
            let path = self.path.clone();
            let conn = tokio::task::spawn_blocking(move || Self::open(&path))
                .await
                .map_err(|e| format!("SQLite-Task fehlgeschlagen: {e}"))??;
            Arc::new(Mutex::new(conn))
        };
        run_blocking(conn.clone(), |c| c.execute_batch("BEGIN").map_err(map_err)).await?;
        Ok(Box::new(SqliteTx { conn }))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let sql = sql.trim().to_string();
        self.run(move |c| run_query(c, &sql)).await
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let schema = schema.unwrap_or("main").to_string();
        self.run(move |c| {
            let names = strings(
                c,
                &format!(
                    "SELECT name FROM {} WHERE type = 'view' ORDER BY name",
                    Self::master(&schema)
                ),
            )?;
            Ok(names
                .into_iter()
                .map(|name| TableInfo {
                    schema: schema.clone(),
                    name,
                })
                .collect())
        })
        .await
    }

    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let (schema, view) = (schema.to_string(), view.to_string());
        self.run(move |c| {
            c.query_row(
                &format!(
                    "SELECT sql FROM {} WHERE type = 'view' AND name = ?1",
                    Self::master(&schema)
                ),
                [&view],
                |r| r.get::<_, String>(0),
            )
            .map_err(map_err)
        })
        .await
    }

    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String> {
        let ddl = format!(
            "DROP VIEW IF EXISTS {s}.{v}; CREATE VIEW {s}.{v} AS {body}",
            s = quote(schema),
            v = quote(view)
        );
        self.run(move |c| {
            c.execute_batch("BEGIN").map_err(map_err)?;
            let result = c.execute_batch(&ddl).map_err(map_err);
            let _ = c.execute_batch(if dry_run || result.is_err() {
                "ROLLBACK"
            } else {
                "COMMIT"
            });
            result
        })
        .await
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let sql = format!("DROP TABLE {}.{}", quote(schema), quote(table));
        self.run(move |c| c.execute_batch(&sql).map_err(map_err))
            .await
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let sql = format!("DELETE FROM {}.{}", quote(schema), quote(table));
        self.run(move |c| c.execute_batch(&sql).map_err(map_err))
            .await
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let (schema, table) = (schema.to_string(), table.to_string());
        self.run(move |c| Self::table_info(c, &schema, &table))
            .await
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
        self.run(move |c| c.execute_batch(&sql).map_err(map_err))
            .await
    }

    async fn alter_column(
        &self,
        schema: &str,
        table: &str,
        changes: &AlterColumnRequest,
    ) -> Result<(), String> {
        if changes.data_type.is_some()
            || changes.set_not_null.is_some()
            || changes.new_default.is_some()
            || changes.drop_default
        {
            return Err("SQLite unterstützt nur das Umbenennen von Spalten. Typ, NULL und Default erfordern eine neue Tabelle.".to_string());
        }
        let Some(new_name) = changes.new_name.as_deref().filter(|n| !n.is_empty()) else {
            return Ok(());
        };
        let sql = format!(
            "ALTER TABLE {}.{} RENAME COLUMN {} TO {}",
            quote(schema),
            quote(table),
            quote(&changes.old_name),
            quote(new_name)
        );
        self.run(move |c| c.execute_batch(&sql).map_err(map_err))
            .await
    }

    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String> {
        let sql = format!(
            "ALTER TABLE {}.{} DROP COLUMN {}",
            quote(schema),
            quote(table),
            quote(column)
        );
        self.run(move |c| c.execute_batch(&sql).map_err(map_err))
            .await
    }

    async fn list_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, String> {
        let (schema, table) = (schema.to_string(), table.to_string());
        self.run(move |c| {
            let (_, rows) = query_all(
                c,
                &format!(
                    "PRAGMA {}.foreign_key_list({})",
                    quote(&schema),
                    quote(&table)
                ),
            )?;
            Ok(rows
                .iter()
                .map(|r| ForeignKeyInfo {
                    constraint_name: format!("fk_{}_{}", table, text(&r[0])),
                    from_schema: schema.clone(),
                    from_table: table.clone(),
                    from_column: text(&r[3]),
                    to_schema: schema.clone(),
                    to_table: text(&r[2]),
                    to_column: text(&r[4]),
                })
                .collect())
        })
        .await
    }

    async fn list_triggers(&self, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
        let (schema, table) = (schema.to_string(), table.to_string());
        self.run(move |c| {
            let (_, rows) = query_all(c, &format!("SELECT name, sql FROM {} WHERE type = 'trigger' AND tbl_name = '{}' ORDER BY name", Self::master(&schema), table.replace('\'', "''")))?;
            Ok(rows
                .iter()
                .map(|r| {
                    let definition = text(&r[1]);
                    let upper = definition.to_uppercase();
                    let timing = if upper.contains("INSTEAD OF") { "INSTEAD OF" } else if upper.contains(" BEFORE ") { "BEFORE" } else { "AFTER" };
                    let event = ["INSERT", "UPDATE", "DELETE"].iter().find(|e| upper.contains(&format!(" {e} ")) || upper.contains(&format!(" {e} OF"))).unwrap_or(&"UNKNOWN");
                    TriggerInfo {
                        trigger_name: text(&r[0]),
                        table_schema: schema.clone(),
                        table_name: table.clone(),
                        event: event.to_string(),
                        timing: timing.to_string(),
                        orientation: "ROW".to_string(),
                        function_schema: String::new(),
                        function_name: String::new(),
                        enabled: "O".to_string(),
                        definition,
                    }
                })
                .collect())
        })
        .await
    }

    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let (schema, table) = (schema.to_string(), table.to_string());
        self.run(move |c| {
            let (_, list) = query_all(
                c,
                &format!("PRAGMA {}.index_list({})", quote(&schema), quote(&table)),
            )?;
            let mut out = Vec::new();
            for r in list {
                let name = text(&r[1]);
                let (_, info) = query_all(
                    c,
                    &format!("PRAGMA {}.index_info({})", quote(&schema), quote(&name)),
                )?;
                let columns: Vec<String> = info.iter().map(|i| text(&i[2])).collect();
                let definition = c
                    .query_row(
                        &format!(
                            "SELECT sql FROM {} WHERE type = 'index' AND name = ?1",
                            Self::master(&schema)
                        ),
                        [&name],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .ok()
                    .flatten()
                    .unwrap_or_default();
                out.push(IndexInfo {
                    is_unique: truthy(&r[2]),
                    is_primary: text(&r[3]) == "pk",
                    columns,
                    index_type: "btree".to_string(),
                    definition,
                    name,
                });
            }
            Ok(out)
        })
        .await
    }

    async fn list_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, String> {
        let columns = self.list_table_columns_detailed(schema, table).await?;
        let mut out = Vec::new();
        let pk: Vec<String> = columns
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name.clone())
            .collect();
        if !pk.is_empty() {
            out.push(ConstraintInfo {
                name: format!("pk_{table}"),
                constraint_type: "PRIMARY KEY".to_string(),
                definition: format!("PRIMARY KEY ({})", pk.join(", ")),
                columns: pk,
            });
        }
        for idx in self
            .list_indexes(schema, table)
            .await?
            .into_iter()
            .filter(|i| i.is_unique && !i.is_primary)
        {
            out.push(ConstraintInfo {
                name: idx.name,
                constraint_type: "UNIQUE".to_string(),
                definition: format!("UNIQUE ({})", idx.columns.join(", ")),
                columns: idx.columns,
            });
        }
        for fk in self.list_foreign_keys(schema, table).await? {
            out.push(ConstraintInfo {
                name: fk.constraint_name,
                constraint_type: "FOREIGN KEY".to_string(),
                columns: vec![fk.from_column.clone()],
                definition: format!(
                    "FOREIGN KEY ({}) REFERENCES {}({})",
                    fk.from_column, fk.to_table, fk.to_column
                ),
            });
        }
        Ok(out)
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        let sql = create_table_sql(req, quote, true);
        self.run(move |c| c.execute_batch(&sql).map_err(map_err))
            .await
    }

    async fn explain_query(&self, sql: &str, _analyze: bool) -> Result<serde_json::Value, String> {
        let sql = format!("EXPLAIN QUERY PLAN {sql}");
        self.run(move |c| {
            let (columns, rows) = query_all(c, &sql)?;
            Ok(serde_json::Value::Array(rows_to_objects(&columns, rows)))
        })
        .await
    }

    async fn get_database_overview(&self) -> Result<DatabaseOverview, String> {
        let path = self.path.clone();
        self.run(move |c| {
            let size: i64 = c.query_row("SELECT page_count * page_size FROM pragma_page_count, pragma_page_size", [], |r| r.get(0)).map_err(map_err)?;
            let mut schemas = Vec::new();
            for name in strings(c, "SELECT name FROM pragma_database_list ORDER BY seq")? {
                let table_count: i64 = c.query_row(&format!("SELECT COUNT(*) FROM {} WHERE type = 'table' AND name NOT LIKE 'sqlite_%'", Self::master(&name)), [], |r| r.get(0)).map_err(map_err)?;
                schemas.push(SchemaSize { size_bytes: if name == "main" { size } else { 0 }, schema: name, table_count });
            }
            Ok(DatabaseOverview { database: path, size_bytes: size, size_pretty: super::pretty_bytes(size), schemas })
        })
        .await
    }

    async fn create_schema(&self, _name: &str) -> Result<(), String> {
        Err(unsupported(
            "Schemas (nutze ATTACH DATABASE im SQL-Arbeitsplatz)",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::create_pool_state;

    fn adapter() -> SqliteAdapter {
        SqliteAdapter::new(":memory:", create_pool_state(), "test".to_string()).unwrap()
    }

    #[test]
    fn parses_paths() {
        assert_eq!(file_path("sqlite:///tmp/a.db").unwrap(), "/tmp/a.db");
        assert_eq!(file_path("/tmp/a.db").unwrap(), "/tmp/a.db");
        assert_eq!(file_path("sqlite://:memory:").unwrap(), ":memory:");
        assert_eq!(
            file_path("sqlite:///tmp/a%20b.db?mode=ro").unwrap(),
            "/tmp/a b.db"
        );
    }

    #[tokio::test]
    async fn roundtrip_metadata_and_rows() {
        let db = adapter();
        db.execute_script("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INT); INSERT INTO users (name, age) VALUES ('a', 1), ('b', 2); CREATE VIEW v AS SELECT name FROM users")
            .await
            .unwrap();
        assert_eq!(db.list_tables(None).await.unwrap()[0].name, "users");
        assert_eq!(db.list_views(None).await.unwrap()[0].name, "v");
        let rows = db
            .fetch_rows(
                "main",
                "users",
                Some("age > 1"),
                10,
                0,
                Some("name"),
                true,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(rows.rows.len(), 1);
        assert_eq!(rows.rows[0]["name"], "b");
        assert_eq!(db.count_rows("main", "users", None, true).await.unwrap(), 2);
        let cols = db
            .list_table_columns_detailed("main", "users")
            .await
            .unwrap();
        assert!(cols[0].is_primary_key);
        let result = db.execute_query("UPDATE users SET age = 5").await.unwrap();
        assert_eq!(result.rows_affected, Some(2));
        assert!(db
            .count_rows("main", "users", Some("1=1; DROP TABLE users"), false)
            .await
            .is_err());
        let overview = db.get_database_overview().await.unwrap();
        assert_eq!(overview.schemas[0].table_count, 1);
    }
}
