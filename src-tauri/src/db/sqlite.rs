use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};

use super::pool::PoolState;
use super::{
    attach_row_keys, create_table_ddl, hex_blob, rows_to_objects, unsupported, where_clause,
    AddColumnRequest, AlterColumnRequest, ColumnInfo, ConstraintInfo, CreateTableRequest,
    DatabaseAdapter, DatabaseOverview, DetailedColumnInfo, ForeignKeyInfo, IndexInfo, QueryResult,
    RowCount, SchemaSize, TableData, TableInfo, TriggerInfo, TxSession,
};

pub struct SqliteAdapter {
    path: String,
    read_only: bool,
    pool_state: PoolState,
    key: String,
}

pub fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

pub(super) fn filtered_count_sql(
    target: &str,
    filter: Option<&str>,
    allow_raw: bool,
    cap: i64,
) -> Result<Option<String>, String> {
    if allow_raw || filter.is_none_or(|value| value.trim().is_empty()) {
        return Ok(None);
    }
    let predicate = where_clause(filter, false)?;
    let limit = cap.saturating_add(1);
    Ok(Some(format!(
        "SELECT COUNT(*) FROM (SELECT 1 FROM {target}{predicate} LIMIT {limit})"
    )))
}

pub(super) fn filtered_count(count: i64, cap: i64) -> RowCount {
    RowCount {
        count,
        exact: count <= cap,
        estimate: None,
    }
}

fn is_params(tail: &str) -> bool {
    !tail.is_empty()
        && tail.split('&').all(|pair| {
            pair.split_once('=').is_some_and(|(key, _)| {
                !key.is_empty() && key.chars().all(|c| c.is_ascii_lowercase() || c == '_')
            })
        })
}

pub(crate) fn split_file_params(value: &str) -> (&str, &str) {
    value
        .rsplit_once('?')
        .filter(|(_, query)| is_params(query))
        .unwrap_or((value, ""))
}

fn params_are_read_only(query: &str) -> bool {
    query
        .split('&')
        .any(|pair| matches!(pair, "mode=ro" | "immutable=1" | "access_mode=read_only"))
}

pub(crate) fn can_create_file(query: &str) -> bool {
    query.split('&').any(|pair| pair == "mode=rwc") && !params_are_read_only(query)
}

pub fn opens_read_only(connection_string: &str) -> bool {
    params_are_read_only(split_file_params(connection_string.trim()).1)
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
        .or_else(|| value.strip_prefix("file:"))
        .unwrap_or(value);
    let (stripped, _) = split_file_params(stripped);
    if stripped == ":memory:" || stripped.is_empty() {
        return Ok(":memory:".to_string());
    }
    let path = if stripped.contains('%') && !std::path::Path::new(stripped).exists() {
        percent_encoding::percent_decode_str(stripped)
            .decode_utf8_lossy()
            .into_owned()
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

pub fn existing_file_path(connection_string: &str) -> Result<String, String> {
    let path = file_path(connection_string)?;
    if path == ":memory:"
        || std::path::Path::new(&path).exists()
        || can_create_file(split_file_params(connection_string.trim()).1)
    {
        return Ok(path);
    }
    Err(format!(
        "Datenbankdatei nicht gefunden: {path}. Für eine neue Datenbank „?mode=rwc“ an den Pfad anhängen."
    ))
}

fn value_to_json(value: ValueRef<'_>) -> serde_json::Value {
    match value {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(i) => super::exact_number::int(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(f.to_string())),
        ValueRef::Text(t) => serde_json::Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => serde_json::Value::String(hex_blob(b)),
    }
}

pub(crate) fn file_header(path: &str) -> Vec<u8> {
    use std::io::Read;
    let mut header = Vec::with_capacity(16);
    if let Ok(file) = std::fs::File::open(path) {
        let _ = file.take(16).read_to_end(&mut header);
    }
    header
}

fn map_err(e: rusqlite::Error) -> String {
    use rusqlite::ErrorCode;
    let german = match &e {
        rusqlite::Error::SqlInputError { msg, offset, .. } => {
            let summary = engine_summary(msg).map(|s| format!("{s}: ")).unwrap_or_default();
            return format!("SQLite: {summary}{msg} (Position {})", offset + 1);
        }
        rusqlite::Error::SqliteFailure(failure, _) => match failure.code {
            ErrorCode::NotADatabase => Some("Datei ist keine SQLite-Datenbank oder verschlüsselt."),
            ErrorCode::DatabaseCorrupt => Some("Datei ist beschädigt."),
            ErrorCode::ReadOnly => Some("Verbindung ist schreibgeschützt: Datei nur lesend geöffnet (Lesemodus, Dateirechte oder ?mode=ro)."),
            ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked => Some(
                "Datei wird gerade von einem anderen Programm verwendet. Schließen und erneut versuchen.",
            ),
            ErrorCode::CannotOpen => Some("Datei kann nicht geöffnet werden."),
            ErrorCode::DiskFull => Some("Datenträger ist voll."),
            _ => None,
        },
        _ => None,
    };
    match german {
        Some(text) => format!("SQLite: {text}"),
        None => {
            let text = e.to_string();
            match engine_summary(&text) {
                Some(summary) => format!("SQLite: {summary}: {text}"),
                None => format!("SQLite: {text}"),
            }
        }
    }
}

fn engine_summary(message: &str) -> Option<&'static str> {
    const SUMMARIES: [(&str, &str); 10] = [
        ("no such table", "Tabelle nicht gefunden"),
        ("no such column", "Spalte nicht gefunden"),
        ("no such function", "Funktion nicht gefunden"),
        ("syntax error", "Syntaxfehler"),
        ("incomplete input", "Anweisung unvollständig"),
        ("already exists", "Objekt existiert bereits"),
        ("UNIQUE constraint failed", "Eindeutigkeit verletzt"),
        ("NOT NULL constraint failed", "Pflichtfeld leer"),
        ("FOREIGN KEY constraint failed", "Fremdschlüssel verletzt"),
        ("cannot store", "Wert passt nicht zum Spaltentyp"),
    ];
    SUMMARIES
        .iter()
        .find(|(needle, _)| message.contains(needle))
        .map(|(_, summary)| *summary)
}

type Rows = (Vec<String>, Vec<Vec<serde_json::Value>>);

fn collect(stmt: &mut rusqlite::Statement<'_>, limit: usize) -> Result<Rows, String> {
    let columns = super::unique_column_names(stmt.column_names().map(|c| c.to_string()).collect());
    let count = columns.len();
    let mut rows = Vec::new();
    let mut result = stmt.query([]).map_err(map_err)?;
    while rows.len() < limit {
        let Some(row) = result.next().map_err(map_err)? else {
            break;
        };
        let mut values = Vec::with_capacity(count);
        for i in 0..count {
            values.push(value_to_json(row.get_ref(i).map_err(map_err)?));
        }
        rows.push(values);
    }
    Ok((columns, rows))
}

fn query_all(conn: &Connection, sql: &str) -> Result<Rows, String> {
    collect(&mut conn.prepare(sql).map_err(map_err)?, usize::MAX)
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
            path: existing_file_path(connection_string)?,
            read_only: opens_read_only(connection_string),
            pool_state,
            key,
        })
    }

    fn open(path: &str, read_only: bool) -> Result<Connection, String> {
        if file_header(path).get(8..12) == Some(b"DUCK") {
            return Err(
                "Datei ist eine DuckDB-Datenbank: duckdb:// statt sqlite:// verwenden.".into(),
            );
        }
        let conn = if path == ":memory:" {
            Connection::open_in_memory().map_err(map_err)?
        } else {
            let mode = if read_only {
                OpenFlags::SQLITE_OPEN_READ_ONLY
            } else {
                OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
            };
            Connection::open_with_flags(path, mode | OpenFlags::SQLITE_OPEN_URI).map_err(|e| {
                format!(
                    "SQLite-Datei konnte nicht geöffnet werden ({path}): {}",
                    map_err(e).trim_start_matches("SQLite: ")
                )
            })?
        };
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(map_err)?;
        Ok(conn)
    }

    async fn conn(&self) -> Result<Arc<Mutex<Connection>>, String> {
        let path = self.path.clone();
        let read_only = self.read_only;
        self.pool_state
            .shared(&self.key, || async move {
                Self::open(&path, read_only).map(Mutex::new)
            })
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

    fn tables_sql(schema: &str) -> String {
        format!(
            "SELECT name FROM pragma_table_list WHERE schema = '{}' AND type IN ('table', 'virtual') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
            schema.replace('\'', "''")
        )
    }

    fn table_info(
        conn: &Connection,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let (_, rows) = query_all(
            conn,
            &format!("PRAGMA {}.table_xinfo({})", quote(schema), quote(table)),
        )?;
        Ok(rows
            .iter()
            .filter_map(|r| {
                let generated = match r.get(6).and_then(|v| v.as_i64()).unwrap_or(0) {
                    1 => return None,
                    2 => Some("Generiert (VIRTUAL)".to_string()),
                    3 => Some("Generiert (STORED)".to_string()),
                    _ => None,
                };
                Some(DetailedColumnInfo {
                    name: text(&r[1]),
                    data_type: text(&r[2]),
                    is_nullable: !truthy(&r[3]),
                    column_default: r.get(4).filter(|v| !v.is_null()).map(text),
                    is_primary_key: truthy(&r[5]),
                    ordinal_position: r[0].as_i64().unwrap_or(0) as i32 + 1,
                    character_maximum_length: None,
                    comment: generated,
                })
            })
            .collect())
    }
}

fn run_query(c: &Connection, sql: &str, limit: usize) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    match c.prepare(sql) {
        Ok(mut stmt) if stmt.column_count() > 0 => {
            let (columns, rows) = collect(&mut stmt, limit)?;
            Ok(QueryResult {
                rows: rows_to_objects(&columns, rows),
                columns,
                rows_affected: None,
                execution_time_ms: start.elapsed().as_millis() as u64,
                truncated: false,
            })
        }
        Ok(mut stmt) => {
            let affected = stmt.execute([]).map_err(map_err)?;
            Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: Some(affected as u64),
                execution_time_ms: start.elapsed().as_millis() as u64,
                truncated: false,
            })
        }
        Err(rusqlite::Error::MultipleStatement) => {
            c.execute_batch(sql).map_err(map_err)?;
            Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: Some(c.changes()),
                execution_time_ms: start.elapsed().as_millis() as u64,
                truncated: false,
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
    let cancel = super::execution::cancellation_token();
    let pending_cancel = cancel.clone();
    let duration = super::execution::query_duration();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let (result_sender, mut result_receiver) = tokio::sync::oneshot::channel();
    let (release_sender, release_receiver) = tokio::sync::oneshot::channel::<()>();
    let work = tokio::task::spawn_blocking(move || {
        let outcome = (|| {
            let guard = conn
                .lock()
                .map_err(|_| "SQLite-Verbindung ist blockiert".to_string())?;
            if pending_cancel.is_cancelled() {
                return Err("Abfrage abgebrochen, bevor sie gestartet wurde.".to_string());
            }
            let _ = sender.send(guard.get_interrupt_handle());
            let result = f(&guard);
            let _ = result_sender.send(result);
            let _ = release_receiver.blocking_recv();
            Ok(())
        })();
        outcome
    });
    let handle = match receiver.await {
        Ok(handle) => handle,
        Err(_) => {
            work.await
                .map_err(|error| format!("SQLite-Task fehlgeschlagen: {error}"))??;
            return Err("SQLite-Abfrage konnte nicht gestartet werden.".into());
        }
    };
    let timed_out = tokio::select! {
        biased;
        result = &mut result_receiver => {
            drop(handle);
            let _ = release_sender.send(());
            work.await.map_err(|error| format!("SQLite-Task fehlgeschlagen: {error}"))??;
            return result.map_err(|error| format!("SQLite-Ergebnis fehlt: {error}"))?;
        }
        _ = cancel.cancelled() => false,
        _ = tokio::time::sleep(duration) => true,
    };
    handle.interrupt();
    let outcome = result_receiver
        .await
        .map_err(|error| format!("SQLite-Ergebnis fehlt: {error}"))?;
    drop(handle);
    let _ = release_sender.send(());
    work.await
        .map_err(|error| format!("SQLite-Task fehlgeschlagen: {error}"))??;

    match outcome {
        Err(error) if error.to_lowercase().contains("interrupt") => Err(if timed_out {
            format!("Query-Timeout nach {} Sekunden: Abfrage vom Server abgebrochen. Transaktionszustand prüfen.", duration.as_secs())
        } else {
            "Abfrage vom Server abgebrochen. Transaktionszustand prüfen.".into()
        }),
        other => other,
    }
}

struct SqliteTx {
    conn: Arc<Mutex<Connection>>,
}

#[async_trait]
impl TxSession for SqliteTx {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        let sql = sql.trim().to_string();
        run_blocking(self.conn.clone(), move |c| run_query(c, &sql, usize::MAX)).await
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
            let names = strings(c, &Self::tables_sql(&schema))?;
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

    async fn catalog_fingerprint(&self) -> Result<Option<String>, String> {
        use sha2::{Digest, Sha256};
        self.run(|c| {
            strings(
                c,
                "SELECT type || ' ' || name || ' ' || COALESCE(sql, '') FROM main.sqlite_master ORDER BY type, name",
            )
        })
        .await
        .map(|objects| {
            let mut digest = Sha256::new();
            for object in objects {
                digest.update(object.as_bytes());
                digest.update([0u8]);
            }
            Some(
                digest
                    .finalize()
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect(),
            )
        })
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
                None if object_type == "view" => strings(
                    c,
                    &format!(
                        "SELECT name FROM {} WHERE type = 'view' ORDER BY name",
                        Self::master(&schema)
                    ),
                )?,
                None => strings(c, &Self::tables_sql(&schema))?,
            };
            let mut out = Vec::new();
            for t in tables {
                for col in Self::table_info(c, &schema, &t)? {
                    out.push(ColumnInfo {
                        schema: schema.clone(),
                        table: t.clone(),
                        name: col.name,
                        data_type: col.data_type,
                    });
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

    async fn count_rows_capped(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
        cap: i64,
    ) -> Result<RowCount, String> {
        let target = format!("{}.{}", quote(schema), quote(table));
        let Some(sql) = filtered_count_sql(&target, filter, allow_raw_filter, cap)? else {
            return self
                .count_rows(schema, table, filter, allow_raw_filter)
                .await
                .map(RowCount::exact);
        };
        self.run(move |c| {
            c.query_row(&sql, [], |row| row.get(0))
                .map(|count| filtered_count(count, cap))
                .map_err(map_err)
        })
        .await
    }

    async fn begin_transaction(&self) -> Result<Box<dyn TxSession>, String> {
        let conn = if self.path == ":memory:" {
            self.conn().await?
        } else {
            let path = self.path.clone();
            let read_only = self.read_only;
            let conn = tokio::task::spawn_blocking(move || Self::open(&path, read_only))
                .await
                .map_err(|e| format!("SQLite-Task fehlgeschlagen: {e}"))??;
            Arc::new(Mutex::new(conn))
        };
        run_blocking(conn.clone(), |c| c.execute_batch("BEGIN").map_err(map_err)).await?;
        Ok(Box::new(SqliteTx { conn }))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let sql = sql.trim().to_string();
        let limit = super::execution::row_limit();
        self.run(move |c| run_query(c, &sql, limit)).await
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

    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, String> {
        let (schema, table) = (schema.to_string(), table.to_string());
        self.run(move |c| {
            let mut stmt = c
                .prepare(&format!(
                    "SELECT sql FROM {} WHERE tbl_name = ?1 AND type IN ('table', 'index', 'trigger') AND sql IS NOT NULL \
                     ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name",
                    Self::master(&schema)
                ))
                .map_err(map_err)?;
            let statements = stmt
                .query_map([&table], |r| r.get::<_, String>(0))
                .map_err(map_err)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(map_err)?;
            if statements.is_empty() {
                return Err("Tabelle nicht gefunden".to_string());
            }
            Ok(statements
                .iter()
                .map(|s| format!("{s};\n"))
                .collect::<Vec<_>>()
                .join("\n"))
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
            "DROP VIEW IF EXISTS {s}.{v}; CREATE VIEW {s}.{v} {rest}",
            s = quote(schema),
            v = quote(view),
            rest = super::view_ddl::view_ddl_rest(body)
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
            let mut primary_keys: std::collections::HashMap<String, Vec<String>> =
                std::collections::HashMap::new();
            let mut out = Vec::with_capacity(rows.len());
            for r in &rows {
                let to_table = text(&r[2]);
                let to_column = if r[4].is_null() {
                    if !primary_keys.contains_key(&to_table) {
                        let mut pk: Vec<(i64, String)> = query_all(
                            c,
                            &format!("PRAGMA {}.table_info({})", quote(&schema), quote(&to_table)),
                        )
                        .map(|(_, columns)| columns)
                        .unwrap_or_default()
                        .iter()
                        .filter_map(|col| {
                            let position = col[5].as_i64().unwrap_or(0);
                            (position > 0).then(|| (position, text(&col[1])))
                        })
                        .collect();
                        pk.sort();
                        primary_keys.insert(
                            to_table.clone(),
                            pk.into_iter().map(|(_, name)| name).collect(),
                        );
                    }
                    primary_keys[&to_table]
                        .get(r[1].as_i64().unwrap_or(0) as usize)
                        .cloned()
                        .unwrap_or_else(|| "rowid".to_string())
                } else {
                    text(&r[4])
                };
                out.push(ForeignKeyInfo {
                    constraint_name: format!("fk_{}_{}", table, text(&r[0])),
                    from_schema: schema.clone(),
                    from_table: table.clone(),
                    from_column: text(&r[3]),
                    to_schema: schema.clone(),
                    to_table,
                    to_column,
                });
            }
            Ok(out)
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
                let definition: String = c
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
                let parts = catalog::table_parts(&definition);
                let columns: Vec<String> = info
                    .iter()
                    .enumerate()
                    .map(|(position, i)| match (&i[2], i[1].as_i64()) {
                        (serde_json::Value::Null, Some(-1)) => "rowid".to_string(),
                        (serde_json::Value::Null, _) => {
                            parts.get(position).cloned().unwrap_or_default()
                        }
                        (name, _) => text(name),
                    })
                    .collect();
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
        let table_name = table.to_string();
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
            let condition = catalog::where_condition(&idx.definition);
            out.push(ConstraintInfo {
                name: idx.name,
                constraint_type: "UNIQUE".to_string(),
                definition: match &condition {
                    Some(condition) => {
                        format!("UNIQUE ({}) WHERE {condition}", idx.columns.join(", "))
                    }
                    None => format!("UNIQUE ({})", idx.columns.join(", ")),
                },
                columns: if condition.is_some() {
                    Vec::new()
                } else {
                    idx.columns
                },
            });
        }
        let foreign = self.list_foreign_keys(schema, table).await?;
        let (schema, table) = (schema.to_string(), table.to_string());
        let (sql, actions) = self
            .run(move |c| {
                let sql = c
                    .query_row(
                        &format!(
                            "SELECT sql FROM {} WHERE type = 'table' AND name = ?1",
                            Self::master(&schema)
                        ),
                        [&table],
                        |r| r.get::<_, Option<String>>(0),
                    )
                    .ok()
                    .flatten()
                    .unwrap_or_default();
                let (_, keys) = query_all(
                    c,
                    &format!(
                        "PRAGMA {}.foreign_key_list({})",
                        quote(&schema),
                        quote(&table)
                    ),
                )?;
                let actions: std::collections::HashMap<String, String> = keys
                    .iter()
                    .map(|r| {
                        let action = [("UPDATE", text(&r[5])), ("DELETE", text(&r[6]))]
                            .into_iter()
                            .filter(|(_, action)| !action.is_empty() && action != "NO ACTION")
                            .map(|(event, action)| format!(" ON {event} {action}"))
                            .collect::<String>();
                        (format!("fk_{}_{}", table, text(&r[0])), action)
                    })
                    .collect();
                Ok((sql, actions))
            })
            .await?;
        let mut grouped: Vec<(String, Vec<ForeignKeyInfo>)> = Vec::new();
        for fk in foreign {
            match grouped
                .iter_mut()
                .find(|(name, _)| *name == fk.constraint_name)
            {
                Some((_, keys)) => keys.push(fk),
                None => grouped.push((fk.constraint_name.clone(), vec![fk])),
            }
        }
        for (name, keys) in grouped {
            let from: Vec<String> = keys.iter().map(|k| k.from_column.clone()).collect();
            let to: Vec<String> = keys.iter().map(|k| k.to_column.clone()).collect();
            out.push(ConstraintInfo {
                definition: format!(
                    "FOREIGN KEY ({}) REFERENCES {}({}){}",
                    from.join(", "),
                    keys[0].to_table,
                    to.join(", "),
                    actions.get(&name).map(String::as_str).unwrap_or("")
                ),
                name,
                constraint_type: "FOREIGN KEY".to_string(),
                columns: from,
            });
        }
        let parts = catalog::table_parts(&sql);
        for (index, (name, expression)) in parts
            .iter()
            .flat_map(|part| catalog::check_clauses(part))
            .enumerate()
        {
            out.push(ConstraintInfo {
                name: name.unwrap_or_else(|| format!("ck_{}_{}", table_name, index + 1)),
                constraint_type: "CHECK".to_string(),
                definition: format!("CHECK ({expression})"),
                columns: Vec::new(),
            });
        }
        Ok(out)
    }

    async fn preview_create_table_ddl(&self, req: &CreateTableRequest) -> Result<String, String> {
        create_table_ddl(
            req,
            quote,
            true,
            Some(super::constraints::ConstraintDialect::Sqlite),
        )
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        let sql = create_table_ddl(
            req,
            quote,
            true,
            Some(super::constraints::ConstraintDialect::Sqlite),
        )?;
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
            let size: i64 = c
                .query_row(
                    "SELECT page_count * page_size FROM pragma_page_count, pragma_page_size",
                    [],
                    |r| r.get(0),
                )
                .map_err(map_err)?;
            let mut schemas = Vec::new();
            for name in strings(c, "SELECT name FROM pragma_database_list ORDER BY seq")? {
                let table_count = strings(c, &Self::tables_sql(&name))?.len() as i64;
                schemas.push(SchemaSize {
                    size_bytes: if name == "main" { size } else { 0 },
                    schema: name,
                    table_count,
                });
            }
            Ok(DatabaseOverview {
                database: path,
                size_bytes: size,
                size_pretty: super::pretty_bytes(size),
                schemas,
            })
        })
        .await
    }

    async fn create_schema(&self, _name: &str) -> Result<(), String> {
        Err(unsupported(
            "Schemas (nutze ATTACH DATABASE im SQL-Arbeitsplatz)",
        ))
    }

    async fn snapshot_rows(
        &self,
        request: &super::snapshot::SnapshotRequest,
    ) -> Result<TableData, String> {
        let object = format!("{}.{}", quote(&request.schema), quote(&request.table));
        let sql = super::snapshot::select_sql(request, &object, quote)?;
        let mut collector = super::snapshot::Collector::new(request.max_rows);
        self.run(move |c| {
            let mut stmt = c.prepare(&sql).map_err(map_err)?;
            let columns: Vec<String> = stmt.column_names().map(|c| c.to_string()).collect();
            let mut rows = stmt.query([]).map_err(map_err)?;
            while let Some(row) = rows.next().map_err(map_err)? {
                let mut object = serde_json::Map::new();
                for (index, name) in columns.iter().enumerate() {
                    object.insert(
                        name.clone(),
                        value_to_json(row.get_ref(index).map_err(map_err)?),
                    );
                }
                collector.push(object)?;
            }
            collector.finish(columns)
        })
        .await
    }

    async fn schema_catalog(
        &self,
        schema: &str,
        types: &[String],
    ) -> Result<Vec<super::schema_catalog::CatalogObject>, String> {
        self.schema_catalog_impl(schema, types).await
    }
}

#[path = "sqlite_catalog.rs"]
mod catalog;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::create_pool_state;

    #[test]
    fn missing_files_are_only_created_on_request() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("typo.sqlite");
        let err = existing_file_path(&format!("sqlite://{}", path.display())).unwrap_err();
        assert!(err.contains("nicht gefunden"));
        assert!(!path.exists());
        assert_eq!(
            existing_file_path(&format!("sqlite://{}?mode=rwc", path.display())).unwrap(),
            path.display().to_string()
        );
        assert_eq!(existing_file_path("sqlite::memory:").unwrap(), ":memory:");
        for suffix in ["?hint=mode=rwc", "?mode=rwc-extra", "?immutable=1&mode=rwc"] {
            assert!(existing_file_path(&format!("sqlite://{}{suffix}", path.display())).is_err());
        }
        let literal = dir.path().join("mode=rwc.sqlite");
        assert!(existing_file_path(literal.to_str().unwrap()).is_err());
    }

    fn adapter() -> SqliteAdapter {
        SqliteAdapter::new(":memory:", create_pool_state(), "test".to_string()).unwrap()
    }

    #[tokio::test]
    #[ignore]
    async fn filtered_count_large_table_budget() {
        let db = adapter();
        db.execute_query("CREATE TABLE events (id INTEGER PRIMARY KEY, active INTEGER)")
            .await
            .unwrap();
        db.execute_query(
            "WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<2000000)
             INSERT INTO events SELECT i, i%2 FROM n",
        )
        .await
        .unwrap();
        let mut samples = Vec::new();
        for round in 0..23 {
            let start = std::time::Instant::now();
            let result = db
                .count_rows_capped("main", "events", Some("active = 1"), false, 100_000)
                .await
                .unwrap();
            let elapsed = start.elapsed();
            if round > 1 {
                samples.push(elapsed);
            }
            assert_eq!(
                (result.count, result.exact, result.estimate),
                (100_001, false, None)
            );
        }
        for (filter, expected) in [("id < 0", 0), ("id <= 100000", 100_000)] {
            let result = db
                .count_rows_capped("main", "events", Some(filter), false, 100_000)
                .await
                .unwrap();
            assert_eq!((result.count, result.exact), (expected, true));
        }
        for (filter, raw) in [(None, false), (Some("id > 0"), true)] {
            let result = db
                .count_rows_capped("main", "events", filter, raw, 100_000)
                .await
                .unwrap();
            assert_eq!((result.count, result.exact), (2_000_000, true));
        }
        let conn = db.conn().await.unwrap();
        conn.lock()
            .unwrap()
            .progress_handler(2_000_000, Some(|| true))
            .unwrap();
        let bounded = db
            .count_rows_capped("main", "events", Some("active = 1"), false, 100_000)
            .await
            .unwrap();
        assert_eq!(bounded.count, 100_001);
        samples.sort();
        println!(
            "SQLite filtered count, 2M rows: median {:?}, p95 {:?}",
            samples[10], samples[19]
        );
        assert!(samples[19] < std::time::Duration::from_millis(30));
    }

    #[tokio::test]
    async fn mode_ro_opens_the_file_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ro.sqlite");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES (1)")
            .unwrap();
        assert!(!opens_read_only(&format!("sqlite://{}", path.display())));
        assert!(!opens_read_only("sqlite:///d/what?mode=rox.db"));
        let url = format!("sqlite://{}?mode=ro", path.display());
        let db = SqliteAdapter::new(&url, create_pool_state(), "ro".into()).unwrap();
        let err = db
            .execute_query("INSERT INTO t VALUES (2)")
            .await
            .unwrap_err();
        assert!(err.contains("Verbindung ist schreibgeschützt"), "{err}");
        assert!(db.begin_transaction().await.is_ok());
        let rows = db
            .execute_query("SELECT count(*) AS n FROM t")
            .await
            .unwrap();
        assert_eq!(rows.rows[0]["n"], 1);
    }

    #[tokio::test]
    async fn cancellation_interrupts_only_its_query() {
        let db = adapter();
        let options = super::super::execution::ExecutionOptions {
            job_id: Some("sqlite-cancel-test".into()),
            ..Default::default()
        };
        let query = super::super::execution::run(Some(options), true, db.execute_query("WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n"));
        let cancellation = async {
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            assert!(super::super::execution::cancel("sqlite-cancel-test").unwrap());
        };
        let (result, _) = tokio::join!(query, cancellation);
        assert!(result.unwrap_err().contains("vom Server abgebrochen"));
        assert!(!super::super::execution::cancel("sqlite-cancel-test").unwrap());
        let next = db.execute_query("SELECT 42 AS answer").await.unwrap();
        assert_eq!(next.rows[0]["answer"], 42);
    }

    #[tokio::test]
    async fn configured_timeout_interrupts_sqlite_and_preserves_followup() {
        let db = adapter();
        let started = std::time::Instant::now();
        let options = super::super::execution::ExecutionOptions {
            query_timeout: Some(5),
            ..Default::default()
        };
        let result = super::super::execution::run(Some(options), true, db.execute_query("WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n")).await;
        assert!(result
            .unwrap_err()
            .contains("Query-Timeout nach 5 Sekunden"));
        assert!(started.elapsed() >= std::time::Duration::from_secs(5));
        assert!(started.elapsed() < std::time::Duration::from_secs(15));
        assert!(db.execute_query("SELECT 1").await.is_ok());
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

    #[test]
    fn paths_keep_question_marks_plus_signs_and_file_uris() {
        let dir = tempfile::tempdir().unwrap();
        let odd = dir.path().join("Daten #1 ?x+y 100%.sqlite");
        std::fs::write(&odd, b"").unwrap();
        let shown = odd.display().to_string();
        assert_eq!(file_path(&format!("sqlite://{shown}")).unwrap(), shown);
        assert_eq!(
            file_path(&format!("sqlite://{shown}?mode=rwc")).unwrap(),
            shown
        );
        let plus = dir.path().join("a+b c.sqlite");
        std::fs::write(&plus, b"").unwrap();
        assert_eq!(
            file_path(&format!("{}/a+b%20c.sqlite", dir.path().display())).unwrap(),
            plus.display().to_string()
        );
        assert_eq!(
            file_path("sqlite:/tmp/a+b&c%20d.db?mode=ro").unwrap(),
            "/tmp/a+b&c d.db"
        );
        assert_eq!(file_path("file:/tmp/a.db").unwrap(), "/tmp/a.db");
        assert_eq!(
            split_file_params("/d/neu.sqlite?mode=rwc"),
            ("/d/neu.sqlite", "mode=rwc")
        );
        assert_eq!(split_file_params("/d/was?.sqlite"), ("/d/was?.sqlite", ""));
        let missing =
            existing_file_path(&format!("{}/fehlt ?x.sqlite", dir.path().display())).unwrap_err();
        assert!(missing.contains("fehlt ?x.sqlite"), "{missing}");
    }

    #[tokio::test]
    async fn files_of_the_wrong_kind_get_german_errors() {
        let dir = tempfile::tempdir().unwrap();
        let text = dir.path().join("notes.sqlite");
        std::fs::write(
            &text,
            "kein SQLite, nur Text, aber lang genug für einen Header\n".repeat(20),
        )
        .unwrap();
        let db = SqliteAdapter::new(
            &text.display().to_string(),
            create_pool_state(),
            "text".into(),
        )
        .unwrap();
        let error = db.list_tables(None).await.unwrap_err();
        assert_eq!(
            error,
            "SQLite: Datei ist keine SQLite-Datenbank oder verschlüsselt."
        );
        let duck = dir.path().join("x.db");
        let mut header = vec![0u8; 8];
        header.extend_from_slice(b"DUCK");
        header.resize(4096, 0);
        std::fs::write(&duck, header).unwrap();
        let db = SqliteAdapter::new(
            &duck.display().to_string(),
            create_pool_state(),
            "duck".into(),
        )
        .unwrap();
        assert!(db
            .list_tables(None)
            .await
            .unwrap_err()
            .contains("duckdb://"));
        let error = adapter().execute_query("selec 1").await.unwrap_err();
        assert!(
            error.starts_with("SQLite: Syntaxfehler: near \"selec\": syntax error (Position 1)"),
            "{error}"
        );
        assert!(!error.contains(" in selec"), "{error}");
    }

    #[tokio::test]
    async fn catalog_shows_generated_columns_and_hides_only_internal_tables() {
        let db = adapter();
        db.execute_script("CREATE TABLE gen (a INTEGER, b INTEGER, s INTEGER GENERATED ALWAYS AS (a+b) STORED, v INTEGER AS (a*2) VIRTUAL); \
            INSERT INTO gen (a, b) VALUES (2, 3); CREATE TABLE sqliteinfo (a INT); CREATE TABLE auto (id INTEGER PRIMARY KEY AUTOINCREMENT); \
            INSERT INTO auto DEFAULT VALUES; CREATE VIRTUAL TABLE docs USING fts5(body); CREATE VIRTUAL TABLE geo USING rtree(id, x0, x1)")
            .await
            .unwrap();
        let names: Vec<String> = db
            .list_tables(None)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert_eq!(names, ["auto", "docs", "gen", "geo", "sqliteinfo"]);
        assert_eq!(
            db.get_database_overview().await.unwrap().schemas[0].table_count,
            5
        );
        let columns = db.list_table_columns_detailed("main", "gen").await.unwrap();
        let described: Vec<(&str, Option<&str>)> = columns
            .iter()
            .map(|c| (c.name.as_str(), c.comment.as_deref()))
            .collect();
        assert_eq!(
            described,
            [
                ("a", None),
                ("b", None),
                ("s", Some("Generiert (STORED)")),
                ("v", Some("Generiert (VIRTUAL)"))
            ]
        );
        let rows = db
            .fetch_rows("main", "gen", None, 10, 0, Some("v"), false, false, false)
            .await
            .unwrap();
        assert_eq!(rows.columns, ["a", "b", "s", "v"]);
        assert_eq!(
            (rows.rows[0]["s"].clone(), rows.rows[0]["v"].clone()),
            (5.into(), 4.into())
        );
        let all = db.list_columns(None, None, None).await.unwrap();
        assert!(all.iter().any(|c| c.table == "gen" && c.name == "v"));
        assert!(!all
            .iter()
            .any(|c| c.table.starts_with("docs_") || c.table == "sqlite_sequence"));
    }

    #[tokio::test]
    async fn constraints_show_checks_conditions_expressions_and_actions() {
        let db = adapter();
        db.execute_script("CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT, CONSTRAINT name_set CHECK (name <> '')); \
            CREATE TABLE child (id INTEGER PRIMARY KEY CHECK (id > 0), pid INTEGER REFERENCES parent ON DELETE CASCADE, code TEXT); \
            CREATE UNIQUE INDEX idx_partial ON child (pid) WHERE id > 10; CREATE UNIQUE INDEX ex_lower ON parent (lower(name))")
            .await
            .unwrap();
        let fks = db.list_foreign_keys("main", "child").await.unwrap();
        assert_eq!(
            (fks[0].to_table.as_str(), fks[0].to_column.as_str()),
            ("parent", "id")
        );
        let indexes = db.list_indexes("main", "parent").await.unwrap();
        assert_eq!(
            indexes
                .iter()
                .find(|i| i.name == "ex_lower")
                .unwrap()
                .columns,
            ["lower(name)"]
        );
        let definitions = |list: Vec<ConstraintInfo>| -> Vec<(String, String)> {
            list.into_iter()
                .map(|c| (c.constraint_type, c.definition))
                .collect()
        };
        let child = definitions(db.list_constraints("main", "child").await.unwrap());
        assert!(
            child.contains(&("UNIQUE".into(), "UNIQUE (pid) WHERE id > 10".into())),
            "{child:?}"
        );
        assert!(
            child.contains(&(
                "FOREIGN KEY".into(),
                "FOREIGN KEY (pid) REFERENCES parent(id) ON DELETE CASCADE".into()
            )),
            "{child:?}"
        );
        assert!(
            child.contains(&("CHECK".into(), "CHECK (id > 0)".into())),
            "{child:?}"
        );
        let parent = db.list_constraints("main", "parent").await.unwrap();
        assert!(parent
            .iter()
            .any(|c| c.name == "name_set" && c.definition == "CHECK (name <> '')"));
        assert!(parent
            .iter()
            .any(|c| c.definition == "UNIQUE (lower(name))"));
        let partial = db.list_constraints("main", "child").await.unwrap();
        assert!(partial
            .iter()
            .find(|c| c.name == "idx_partial")
            .unwrap()
            .columns
            .is_empty());
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
