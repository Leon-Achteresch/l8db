use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use duckdb::core::LogicalTypeId;
use duckdb::types::{TimeUnit, ValueRef};
use duckdb::Connection;

use super::pool::PoolState;
use super::sqlite::existing_file_path;
use super::{
    attach_row_keys, create_table_ddl, hex_blob, rows_to_objects, where_clause, AddColumnRequest,
    AlterColumnRequest, ColumnInfo, ConstraintInfo, CreateTableRequest, DatabaseAdapter,
    DatabaseOverview, DetailedColumnInfo, DuckdbFilePathContext, ForeignKeyInfo, IndexInfo,
    QueryResult, SchemaSize, SequenceInfo, TableData, TableInfo,
};

pub struct DuckdbAdapter {
    path: String,
    read_only: bool,
    pool_state: PoolState,
    key: String,
}

pub fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn file_reader(path: &str) -> Option<&'static str> {
    let extension = std::path::Path::new(path)
        .extension()?
        .to_str()?
        .to_ascii_lowercase();
    Some(match extension.as_str() {
        "parquet" => "read_parquet",
        "csv" => "csv",
        "tsv" => "tsv",
        "json" | "jsonl" | "ndjson" => "read_json_auto",
        _ => return None,
    })
}

fn file_view_sql(path: &str, source: &str, encoding: Option<&str>) -> Option<String> {
    let file = std::path::Path::new(path);
    let reader = file_reader(path)?;
    let name = file
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("data");
    let source = match reader {
        "csv" | "tsv" => format!(
            "read_csv({}{}, null_padding = true, parallel = false{})",
            lit(source),
            if reader == "tsv" {
                ", delim = '\\t'"
            } else {
                ""
            },
            encoding
                .map(|e| format!(", encoding = {}", lit(e)))
                .unwrap_or_default()
        ),
        other => format!("{other}({})", lit(source)),
    };
    Some(format!(
        "CREATE VIEW {} AS SELECT * FROM {source}",
        quote(name)
    ))
}

fn german(message: &str) -> String {
    if message.contains("Could not set lock on file") {
        let pid = message
            .split("(PID ")
            .nth(1)
            .and_then(|rest| rest.split(')').next())
            .map(|pid| format!(" (Prozess {pid})"))
            .unwrap_or_default();
        return format!("Datei wird gerade von einem anderen Programm verwendet{pid}. Schließen und erneut versuchen.");
    }
    if message.contains("attached in read-only mode") {
        return "Nur lesend geöffnet (?mode=ro).".into();
    }
    if message.contains("not a valid DuckDB database file") {
        return "Datei ist keine DuckDB-Datenbank.".into();
    }
    let extension = message
        .split("Please try installing and loading the ")
        .nth(1)
        .and_then(|rest| rest.split_whitespace().next())
        .or_else(|| {
            message
                .split("\" is an existing extension")
                .next()
                .filter(|head| head.len() < message.len())
                .and_then(|head| head.rsplit("Extension \"").next())
        });
    if let Some(name) = extension {
        return format!("DuckDB-Erweiterung „{name}“ fehlt. l8db lädt Erweiterungen nicht automatisch nach; bei Bedarf bewusst mit „INSTALL {name}; LOAD {name};“ laden.");
    }
    let message = message
        .split("\n\nPossible ")
        .next()
        .unwrap_or(message)
        .split("\n  file = ")
        .next()
        .unwrap_or(message);
    match message.find("CSV Error on Line: ") {
        Some(start) => format!(
            "CSV-Fehler in Zeile {}",
            message[start + "CSV Error on Line: ".len()..].trim_end()
        ),
        None => {
            let message = message.trim_end();
            match engine_summary(message) {
                Some(summary) => format!("{summary}: {message}"),
                None => message.to_string(),
            }
        }
    }
}

fn engine_summary(message: &str) -> Option<&'static str> {
    let (class, rest) = message.split_once(" Error: ")?;
    Some(match class {
        "Catalog" if rest.contains("does not exist") => "Objekt nicht gefunden",
        "Catalog" if rest.contains("already exists") => "Objekt existiert bereits",
        "Parser" => "Syntaxfehler",
        "Binder" if rest.contains("not found") => "Spalte oder Name nicht gefunden",
        "Binder" => "Ausdruck ungültig",
        "Conversion" => "Wert lässt sich nicht umwandeln",
        "Constraint" => "Bedingung verletzt",
        _ => return None,
    })
}

fn map_err(e: duckdb::Error) -> String {
    format!("DuckDB: {}", german(&e.to_string()))
}

fn bit_text(bytes: &[u8]) -> Option<String> {
    let (&padding, data) = bytes.split_first()?;
    let bits: String = data
        .iter()
        .flat_map(|byte| {
            (0..8)
                .rev()
                .map(move |i| if byte >> i & 1 == 1 { '1' } else { '0' })
        })
        .skip(padding as usize)
        .collect();
    (padding < 8).then_some(bits)
}

fn union_json(column: &duckdb::arrow::array::ArrayRef, idx: usize) -> serde_json::Value {
    use duckdb::arrow::array::{Array, UnionArray};
    use duckdb::arrow::datatypes::DataType;
    let value = owned_to_json(ValueRef::Union(column, idx).to_owned());
    let tag = column
        .as_any()
        .downcast_ref::<UnionArray>()
        .map(|array| array.type_id(idx))
        .and_then(|id| match column.data_type() {
            DataType::Union(fields, _) => fields
                .iter()
                .find(|(type_id, _)| *type_id == id)
                .map(|(_, field)| field.name().clone()),
            _ => None,
        });
    match tag {
        Some(tag) if !value.is_null() => serde_json::json!({ tag: value }),
        _ => value,
    }
}

fn value_to_json(value: ValueRef<'_>, kind: LogicalTypeId) -> serde_json::Value {
    match value {
        ValueRef::Text(t) => serde_json::Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) if kind == LogicalTypeId::Bit => {
            serde_json::Value::String(bit_text(b).unwrap_or_else(|| hex_blob(b)))
        }
        ValueRef::Blob(b) | ValueRef::Geometry(b) => serde_json::Value::String(hex_blob(b)),
        ValueRef::Timestamp(unit, t) if kind == LogicalTypeId::TimestampTZ => instant(unit, t)
            .map(|dt| serde_json::Value::String(dt.format("%Y-%m-%d %H:%M:%S%.f+00").to_string()))
            .unwrap_or_else(|| serde_json::Value::String(t.to_string())),
        ValueRef::Union(column, idx) => union_json(column, idx),
        other => owned_to_json(duckdb::types::Value::from(other)),
    }
}

fn instant(unit: TimeUnit, value: i64) -> Option<chrono::NaiveDateTime> {
    let micros = match unit {
        TimeUnit::Second => value.checked_mul(1_000_000)?,
        TimeUnit::Millisecond => value.checked_mul(1_000)?,
        TimeUnit::Microsecond => value,
        TimeUnit::Nanosecond => {
            return Some(chrono::DateTime::from_timestamp_nanos(value).naive_utc());
        }
    };
    chrono::DateTime::from_timestamp_micros(micros).map(|dt| dt.naive_utc())
}

fn owned_to_json(value: duckdb::types::Value) -> serde_json::Value {
    use super::exact_number::{decimal, int, uint};
    use duckdb::types::Value as V;
    use serde_json::Value as J;
    fn num(f: f64) -> J {
        serde_json::Number::from_f64(f)
            .map(J::Number)
            .unwrap_or_else(|| J::String(f.to_string()))
    }
    fn text(value: impl ToString) -> J {
        J::String(value.to_string())
    }
    match value {
        V::Null => J::Null,
        V::Boolean(b) => J::Bool(b),
        V::TinyInt(i) => J::from(i),
        V::SmallInt(i) => J::from(i),
        V::Int(i) => J::from(i),
        V::BigInt(i) => int(i),
        V::HugeInt(i) => decimal(&i.to_string()),
        V::UTinyInt(i) => J::from(i),
        V::USmallInt(i) => J::from(i),
        V::UInt(i) => J::from(i),
        V::UBigInt(i) => uint(i),
        V::UHugeInt(i) => decimal(&i.to_string()),
        V::Float(f) => num(f.to_string().parse().unwrap_or(f64::from(f))),
        V::Double(f) => num(f),
        V::Decimal(d) => decimal(&d.to_string()),
        V::Timestamp(unit, t) => instant(unit, t)
            .map(|dt| text(dt.format("%Y-%m-%d %H:%M:%S%.f")))
            .unwrap_or_else(|| text(t)),
        V::Date32(days) => chrono::NaiveDate::from_ymd_opt(1970, 1, 1)
            .and_then(|epoch| epoch.checked_add_signed(chrono::Duration::days(days.into())))
            .map(|date| text(date.format("%Y-%m-%d")))
            .unwrap_or_else(|| text(days)),
        V::Time64(unit, t) => instant(unit, t)
            .map(|dt| text(dt.time().format("%H:%M:%S%.f")))
            .unwrap_or_else(|| text(t)),
        V::Interval {
            months,
            days,
            nanos,
        } => text(super::interval_text(months, days, nanos)),
        V::Text(s) | V::Enum(s) => J::String(s),
        V::Blob(b) | V::Geometry(b) => J::String(hex_blob(&b)),
        V::List(items) | V::Array(items) => {
            J::Array(items.into_iter().map(owned_to_json).collect())
        }
        V::Struct(fields) => J::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), owned_to_json(value.clone())))
                .collect(),
        ),
        V::Map(entries) => J::Object(
            entries
                .iter()
                .map(|(key, value)| {
                    let key = match owned_to_json(key.clone()) {
                        J::String(key) => key,
                        other => other.to_string(),
                    };
                    (key, owned_to_json(value.clone()))
                })
                .collect(),
        ),
        V::Union(inner) => owned_to_json(*inner),
        other => text(format!("{other:?}")),
    }
}

fn query_all(
    conn: &Connection,
    sql: &str,
) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>), String> {
    query_limited(conn, sql, usize::MAX)
}

fn query_limited(
    conn: &Connection,
    sql: &str,
    limit: usize,
) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>), String> {
    let mut stmt = conn.prepare(sql).map_err(map_err)?;
    let mut result = stmt.query([]).map_err(map_err)?;
    let mut columns: Vec<String> = Vec::new();
    let mut kinds: Vec<LogicalTypeId> = Vec::new();
    let mut rows = Vec::new();
    while rows.len() < limit {
        let Some(row) = result.next().map_err(map_err)? else {
            break;
        };
        if columns.is_empty() {
            columns = row.as_ref().column_names();
            kinds = (0..columns.len())
                .map(|i| row.as_ref().column_logical_type(i).id())
                .collect();
        }
        let count = columns.len();
        let mut values = Vec::with_capacity(count);
        for (i, kind) in kinds.iter().enumerate().take(count) {
            values.push(value_to_json(row.get_ref(i).map_err(map_err)?, *kind));
        }
        rows.push(values);
    }
    if columns.is_empty() {
        columns = result
            .as_ref()
            .map(|s| s.column_names())
            .unwrap_or_default();
    }
    Ok((super::unique_column_names(columns), rows))
}

fn text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn unwrap_parens(text: &str) -> &str {
    let Some(inner) = text.strip_prefix('(').and_then(|t| t.strip_suffix(')')) else {
        return text;
    };
    let mut depth = 0;
    for c in inner.chars() {
        match c {
            '(' => depth += 1,
            ')' if depth == 0 => return text,
            ')' => depth -= 1,
            _ => {}
        }
    }
    inner
}

fn index_columns(expressions: &str) -> Vec<String> {
    let trimmed = expressions.trim();
    let inner = trimmed
        .strip_prefix('[')
        .and_then(|t| t.strip_suffix(']'))
        .unwrap_or(trimmed);
    let mut parts = Vec::new();
    let (mut depth, mut quoted, mut current) = (0, false, String::new());
    let mut chars = inner.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\'' if quoted && chars.peek() == Some(&'\'') => {
                chars.next();
                current.push(c);
            }
            '\'' => quoted = !quoted,
            '(' if !quoted => {
                depth += 1;
                current.push(c);
            }
            ')' if !quoted => {
                depth -= 1;
                current.push(c);
            }
            ',' if !quoted && depth == 0 => parts.push(std::mem::take(&mut current)),
            _ => current.push(c),
        }
    }
    parts.push(current);
    parts
        .iter()
        .map(|part| unwrap_parens(part.trim()).to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

fn truthy(v: &serde_json::Value) -> bool {
    matches!(v, serde_json::Value::Bool(true)) || v.as_i64().is_some_and(|i| i != 0)
}

const FILE_PATH_CONTEXT_MAX_BYTES: usize = 8_192;

pub(super) async fn file_path_context(
    pool: &PoolState,
    connection_string: &str,
    database: Option<&str>,
) -> DuckdbFilePathContext {
    let key = super::connection::connection_key(connection_string, database);
    let Some(connection) = pool.ready_shared::<Mutex<Connection>>(&key).await else {
        return DuckdbFilePathContext::NoSession;
    };
    tokio::task::spawn_blocking(move || {
        let connection = match connection.try_lock() {
            Ok(connection) => connection,
            Err(std::sync::TryLockError::WouldBlock) => return DuckdbFilePathContext::Busy,
            Err(std::sync::TryLockError::Poisoned(_)) => return DuckdbFilePathContext::Unknown,
        };
        let file_search_path = connection
            .query_row("SELECT current_setting('file_search_path')", [], |row| {
                row.get::<_, String>(0)
            })
            .ok()
            .filter(|value| value.len() <= FILE_PATH_CONTEXT_MAX_BYTES);
        let working_directory = std::env::current_dir()
            .ok()
            .filter(|path| path.is_absolute())
            .and_then(|path| path.into_os_string().into_string().ok())
            .filter(|value| value.len() <= FILE_PATH_CONTEXT_MAX_BYTES);
        DuckdbFilePathContext::Snapshot {
            file_search_path,
            working_directory,
        }
    })
    .await
    .unwrap_or(DuckdbFilePathContext::Unknown)
}

impl DuckdbAdapter {
    pub fn new(
        connection_string: &str,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let path = existing_file_path(connection_string)?;
        if super::sqlite::file_header(&path).starts_with(b"SQLite format 3\0") {
            return Err(
                "Datei ist eine SQLite-Datenbank: sqlite:// statt duckdb:// verwenden.".into(),
            );
        }
        Ok(Self {
            path,
            read_only: super::sqlite::opens_read_only(connection_string),
            pool_state,
            key,
        })
    }

    async fn run<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    {
        let path = self.path.clone();
        let read_only = self.read_only;
        let sealed = self.pool_state.seals_files();
        let conn: Arc<Mutex<Connection>> = self
            .pool_state
            .shared(&self.key, || async move {
                let (source, encoding) = match file_reader(&path) {
                    Some("csv" | "tsv") => super::csv_stream::duckdb_encoding(&path)?,
                    _ => (path.clone(), None),
                };
                let view = file_view_sql(&path, &source, encoding);
                let seal = sealed.then(|| {
                    let allowed = if view.is_some() { lit(&source) } else { String::new() };
                    format!("SET allowed_paths = [{allowed}]; SET enable_external_access = false; SET lock_configuration = true;")
                });
                let conn = if path == ":memory:" || view.is_some() {
                    Connection::open_in_memory()
                } else if read_only {
                    duckdb::Config::default()
                        .access_mode(duckdb::AccessMode::ReadOnly)
                        .and_then(|config| Connection::open_with_flags(&path, config))
                } else {
                    Connection::open(&path)
                }
                .map_err(|e| format!("DuckDB-Datei konnte nicht geöffnet werden ({path}): {}", german(&e.to_string())))?;
                conn.execute_batch("SET autoinstall_known_extensions = false")
                    .map_err(map_err)?;
                if let Some(sql) = view {
                    conn.execute_batch(&sql)
                        .map_err(|e| format!("Datei konnte nicht gelesen werden ({path}): {}", german(&e.to_string())))?;
                }
                if let Some(sql) = seal {
                    for extension in ["icu", "json"] {
                        let _ = conn.execute_batch(&format!("LOAD {extension}"));
                    }
                    conn.execute_batch(&sql).map_err(map_err)?;
                }
                Ok(Mutex::new(conn))
            })
            .await?;
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|_| "DuckDB-Verbindung ist blockiert".to_string())?;
            f(&guard)
        })
        .await
        .map_err(|e| format!("DuckDB-Task fehlgeschlagen: {e}"))?
    }

    async fn rows(&self, sql: String) -> Result<Vec<Vec<serde_json::Value>>, String> {
        self.run(move |c| query_all(c, &sql).map(|(_, rows)| rows))
            .await
    }

    async fn exec(&self, sql: String) -> Result<(), String> {
        self.run(move |c| c.execute_batch(&sql).map_err(map_err))
            .await
    }

    async fn exec_atomic(&self, statements: Vec<String>) -> Result<(), String> {
        if statements.is_empty() {
            return Ok(());
        }
        self.run(move |c| {
            c.execute_batch("BEGIN").map_err(map_err)?;
            let result = statements
                .iter()
                .try_for_each(|sql| c.execute_batch(sql).map_err(map_err));
            let _ = c.execute_batch(if result.is_ok() { "COMMIT" } else { "ROLLBACK" });
            result
        })
        .await
    }
}

fn run_sql(c: &Connection, sql: &str, limit: usize) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let first = sql.split_whitespace().next().unwrap_or("").to_uppercase();
    if matches!(
        first.as_str(),
        "SELECT"
            | "WITH"
            | "SHOW"
            | "DESCRIBE"
            | "EXPLAIN"
            | "PRAGMA"
            | "FROM"
            | "SUMMARIZE"
            | "CALL"
    ) || (matches!(first.as_str(), "INSERT" | "UPDATE" | "DELETE")
        && sql
            .to_ascii_uppercase()
            .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
            .any(|word| word == "RETURNING"))
    {
        let (columns, rows) = query_limited(c, sql, limit)?;
        return Ok(QueryResult {
            rows: rows_to_objects(&columns, rows),
            columns,
            rows_affected: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            truncated: false,
        });
    }
    let affected = c.execute(sql, []).map_err(map_err)?;
    Ok(QueryResult {
        columns: vec![],
        rows: vec![],
        rows_affected: Some(affected as u64),
        execution_time_ms: start.elapsed().as_millis() as u64,
        truncated: false,
    })
}

struct DuckdbTx {
    conn: Arc<Mutex<Connection>>,
}

impl DuckdbTx {
    async fn blocking(&self, sql: String) -> Result<QueryResult, String> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|_| "DuckDB-Verbindung ist blockiert".to_string())?;
            run_sql(&guard, &sql, usize::MAX)
        })
        .await
        .map_err(|e| format!("DuckDB-Task fehlgeschlagen: {e}"))?
    }
}

#[async_trait]
impl super::TxSession for DuckdbTx {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        self.blocking(sql.trim().to_string()).await
    }
    async fn commit(&mut self) -> Result<(), String> {
        self.blocking("COMMIT".into()).await.map(|_| ())
    }
    async fn rollback(&mut self) -> Result<(), String> {
        self.blocking("ROLLBACK".into()).await.map(|_| ())
    }
}

#[async_trait]
impl DatabaseAdapter for DuckdbAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.exec("SELECT 1".to_string()).await
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(self.rows("SELECT database_name FROM duckdb_databases() WHERE NOT internal ORDER BY database_name".to_string()).await?.iter().map(|r| text(&r[0])).collect())
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows(
                "SELECT schema_name FROM duckdb_schemas() WHERE NOT internal OR (schema_name = 'main' AND database_name = current_database()) ORDER BY schema_name"
                    .to_string(),
            )
            .await?
            .iter()
            .map(|r| text(&r[0]))
            .collect())
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let schema = schema.unwrap_or("main");
        let sql = format!("SELECT schema_name, table_name FROM duckdb_tables() WHERE NOT internal AND schema_name = {} ORDER BY table_name", lit(schema));
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: text(&r[0]),
                name: text(&r[1]),
            })
            .collect())
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let schema = schema.unwrap_or("main");
        let source = if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
            "duckdb_views() v ON v.schema_name = c.schema_name AND v.view_name = c.table_name"
        } else {
            "duckdb_tables() v ON v.schema_name = c.schema_name AND v.table_name = c.table_name"
        };
        let mut sql = format!("SELECT c.schema_name, c.table_name, c.column_name, c.data_type FROM duckdb_columns() c JOIN {source} WHERE NOT c.internal AND c.schema_name = {}", lit(schema));
        if let Some(t) = table {
            sql.push_str(&format!(" AND c.table_name = {}", lit(t)));
        }
        sql.push_str(" ORDER BY c.table_name, c.column_index");
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| ColumnInfo {
                schema: text(&r[0]),
                table: text(&r[1]),
                name: text(&r[2]),
                data_type: text(&r[3]),
            })
            .collect())
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let sql = format!(
            "SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, c.column_index, c.character_maximum_length, \
             EXISTS (SELECT 1 FROM duckdb_constraints() k WHERE k.schema_name = c.schema_name AND k.table_name = c.table_name AND k.constraint_type = 'PRIMARY KEY' AND list_contains(k.constraint_column_names, c.column_name)) \
             FROM duckdb_columns() c WHERE c.schema_name = {} AND c.table_name = {} ORDER BY c.column_index",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| DetailedColumnInfo {
                name: text(&r[0]),
                data_type: text(&r[1]),
                is_nullable: truthy(&r[2]),
                column_default: Some(text(&r[3])).filter(|d| !d.is_empty()),
                ordinal_position: r[4].as_i64().unwrap_or(0) as i32,
                character_maximum_length: r[5].as_i64().map(|v| v as i32),
                comment: None,
                is_primary_key: truthy(&r[6]),
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
        let (cols, rows) = self.run(move |c| query_all(c, &sql)).await?;
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
            .rows(sql)
            .await?
            .first()
            .and_then(|r| r[0].as_i64())
            .unwrap_or(0))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let sql = sql.trim().to_string();
        let limit = super::execution::row_limit();
        self.run(move |c| run_sql(c, &sql, limit)).await
    }

    async fn begin_transaction(&self) -> Result<Box<dyn super::TxSession>, String> {
        let conn = self.run(|c| c.try_clone().map_err(map_err)).await?;
        let conn = Arc::new(Mutex::new(conn));
        let tx = DuckdbTx { conn };
        tx.blocking("BEGIN TRANSACTION".into()).await?;
        Ok(Box::new(tx))
    }

    async fn list_sequences(&self, schema: Option<&str>) -> Result<Vec<SequenceInfo>, String> {
        let filter = schema
            .map(|s| format!(" AND schema_name = {}", lit(s)))
            .unwrap_or_default();
        let sql = format!("SELECT schema_name, sequence_name, start_value::VARCHAR, min_value::VARCHAR, max_value::VARCHAR, increment_by::VARCHAR, cycle, last_value::VARCHAR FROM duckdb_sequences() WHERE database_name = current_database(){filter} ORDER BY schema_name, sequence_name");
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| SequenceInfo {
                schema: text(&r[0]),
                name: text(&r[1]),
                data_type: "BIGINT".to_string(),
                start_value: text(&r[2]),
                min_value: text(&r[3]),
                max_value: text(&r[4]),
                increment_by: text(&r[5]),
                cycle: truthy(&r[6]),
                last_value: Some(text(&r[7])).filter(|v| !v.is_empty()),
            })
            .collect())
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let sql = format!("SELECT schema_name, view_name FROM duckdb_views() WHERE NOT internal AND schema_name = {} ORDER BY view_name", lit(schema.unwrap_or("main")));
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: text(&r[0]),
                name: text(&r[1]),
            })
            .collect())
    }

    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let sql = format!(
            "SELECT sql FROM duckdb_views() WHERE schema_name = {} AND view_name = {}",
            lit(schema),
            lit(view)
        );
        self.rows(sql)
            .await?
            .first()
            .map(|r| text(&r[0]))
            .ok_or_else(|| "View nicht gefunden".to_string())
    }

    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, String> {
        let table_sql = format!(
            "SELECT sql FROM duckdb_tables() WHERE schema_name = {} AND table_name = {}",
            lit(schema),
            lit(table)
        );
        let mut ddl = self
            .rows(table_sql)
            .await?
            .first()
            .map(|r| format!("{}\n", text(&r[0])))
            .ok_or_else(|| "Tabelle nicht gefunden".to_string())?;
        let index_sql = format!(
            "SELECT sql FROM duckdb_indexes() WHERE schema_name = {} AND table_name = {} AND sql IS NOT NULL ORDER BY index_name",
            lit(schema),
            lit(table)
        );
        for r in self.rows(index_sql).await? {
            ddl.push_str(&format!("\n{}\n", text(&r[0])));
        }
        Ok(ddl)
    }

    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String> {
        let ddl = format!(
            "CREATE OR REPLACE VIEW {}.{} {}",
            quote(schema),
            quote(view),
            super::view_ddl::view_ddl_rest(body)
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
        self.exec(format!("DROP TABLE {}.{}", quote(schema), quote(table)))
            .await
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(format!("DELETE FROM {}.{}", quote(schema), quote(table)))
            .await
    }

    async fn add_column(
        &self,
        schema: &str,
        table: &str,
        column: &AddColumnRequest,
    ) -> Result<(), String> {
        let target = format!("{}.{}", quote(schema), quote(table));
        let name = quote(&column.name);
        let mut sql = format!(
            "ALTER TABLE {target} ADD COLUMN {name} {}",
            column.data_type
        );
        if let Some(d) = column.default_value.as_deref().filter(|d| !d.is_empty()) {
            sql.push_str(&format!(" DEFAULT {d}"));
        }
        let mut statements = vec![sql];
        if !column.is_nullable {
            statements.push(format!(
                "ALTER TABLE {target} ALTER COLUMN {name} SET NOT NULL"
            ));
        }
        self.exec_atomic(statements).await
    }

    async fn alter_column(
        &self,
        schema: &str,
        table: &str,
        changes: &AlterColumnRequest,
    ) -> Result<(), String> {
        let target = format!("{}.{}", quote(schema), quote(table));
        let column = quote(&changes.old_name);
        let mut statements = Vec::new();
        if let Some(t) = changes.data_type.as_deref().filter(|t| !t.is_empty()) {
            statements.push(format!(
                "ALTER TABLE {target} ALTER COLUMN {column} TYPE {t}"
            ));
        }
        if changes.drop_default {
            statements.push(format!(
                "ALTER TABLE {target} ALTER COLUMN {column} DROP DEFAULT"
            ));
        } else if let Some(d) = changes.new_default.as_deref().filter(|d| !d.is_empty()) {
            statements.push(format!(
                "ALTER TABLE {target} ALTER COLUMN {column} SET DEFAULT {d}"
            ));
        }
        if let Some(not_null) = changes.set_not_null {
            statements.push(format!(
                "ALTER TABLE {target} ALTER COLUMN {column} {} NOT NULL",
                if not_null { "SET" } else { "DROP" }
            ));
        }
        if let Some(new_name) = changes
            .new_name
            .as_deref()
            .filter(|n| !n.is_empty() && *n != changes.old_name)
        {
            statements.push(format!(
                "ALTER TABLE {target} RENAME COLUMN {column} TO {}",
                quote(new_name)
            ));
        }
        self.exec_atomic(statements).await
    }

    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String> {
        self.exec(format!(
            "ALTER TABLE {}.{} DROP COLUMN {}",
            quote(schema),
            quote(table),
            quote(column)
        ))
        .await
    }

    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let sql = format!("SELECT index_name, is_unique, is_primary, sql, expressions FROM duckdb_indexes() WHERE schema_name = {} AND table_name = {} ORDER BY index_name", lit(schema), lit(table));
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| IndexInfo {
                name: text(&r[0]),
                is_unique: truthy(&r[1]),
                is_primary: truthy(&r[2]),
                columns: index_columns(&text(&r[4])),
                index_type: "art".to_string(),
                definition: text(&r[3]),
            })
            .collect())
    }

    async fn list_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, String> {
        let sql = format!("SELECT constraint_type, constraint_text, constraint_column_names FROM duckdb_constraints() WHERE schema_name = {} AND table_name = {} ORDER BY constraint_index", lit(schema), lit(table));
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .enumerate()
            .map(|(i, r)| ConstraintInfo {
                name: format!("{}_{}", text(&r[0]).to_lowercase().replace(' ', "_"), i + 1),
                constraint_type: text(&r[0]),
                definition: text(&r[1]),
                columns: r[2]
                    .as_array()
                    .map(|a| a.iter().map(text).collect())
                    .unwrap_or_default(),
            })
            .collect())
    }

    async fn list_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, String> {
        let sql = format!("SELECT constraint_name, constraint_column_names, referenced_table, referenced_column_names FROM duckdb_constraints() WHERE schema_name = {} AND table_name = {} AND constraint_type = 'FOREIGN KEY' ORDER BY constraint_index", lit(schema), lit(table));
        let names = |value: &serde_json::Value| -> Vec<String> {
            value
                .as_array()
                .map(|a| a.iter().map(text).collect())
                .unwrap_or_default()
        };
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .flat_map(|r| {
                names(&r[1])
                    .into_iter()
                    .zip(names(&r[3]))
                    .map(|(from_column, to_column)| ForeignKeyInfo {
                        constraint_name: text(&r[0]),
                        from_schema: schema.to_string(),
                        from_table: table.to_string(),
                        from_column,
                        to_schema: schema.to_string(),
                        to_table: text(&r[2]),
                        to_column,
                    })
                    .collect::<Vec<_>>()
            })
            .collect())
    }

    async fn preview_create_table_ddl(&self, req: &CreateTableRequest) -> Result<String, String> {
        create_table_ddl(
            req,
            quote,
            true,
            Some(super::constraints::ConstraintDialect::Duckdb),
        )
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        self.exec(create_table_ddl(
            req,
            quote,
            true,
            Some(super::constraints::ConstraintDialect::Duckdb),
        )?)
        .await
    }

    async fn explain_query(&self, sql: &str, analyze: bool) -> Result<serde_json::Value, String> {
        let rows = self
            .rows(format!(
                "EXPLAIN {}{sql}",
                if analyze { "ANALYZE " } else { "" }
            ))
            .await?;
        Ok(serde_json::Value::String(
            rows.iter()
                .map(|r| r.iter().map(text).collect::<Vec<_>>().join("\n"))
                .collect::<Vec<_>>()
                .join("\n"),
        ))
    }

    async fn create_schema(&self, name: &str) -> Result<(), String> {
        self.exec(format!("CREATE SCHEMA {}", quote(name))).await
    }

    async fn drop_schema(&self, name: &str, cascade: bool) -> Result<(), String> {
        self.exec(format!(
            "DROP SCHEMA {}{}",
            quote(name),
            if cascade { " CASCADE" } else { "" }
        ))
        .await
    }

    async fn get_database_overview(&self) -> Result<DatabaseOverview, String> {
        let size_bytes = if self.path == ":memory:" {
            0
        } else {
            std::fs::metadata(&self.path)
                .map(|m| m.len() as i64)
                .unwrap_or(0)
        };
        let rows = self.rows("SELECT s.schema_name, COUNT(t.table_name) FROM duckdb_schemas() s LEFT JOIN duckdb_tables() t ON t.schema_name = s.schema_name AND NOT t.internal WHERE NOT s.internal OR (s.schema_name = 'main' AND s.database_name = current_database()) GROUP BY s.schema_name ORDER BY s.schema_name".to_string()).await?;
        Ok(DatabaseOverview {
            database: self.path.clone(),
            size_bytes,
            size_pretty: super::pretty_bytes(size_bytes),
            schemas: rows
                .iter()
                .map(|r| SchemaSize {
                    schema: text(&r[0]),
                    table_count: r[1].as_i64().unwrap_or(0),
                    size_bytes: 0,
                })
                .collect(),
        })
    }
}

#[cfg(test)]
#[path = "duckdb_path_context_tests.rs"]
mod path_context_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::create_pool_state;
    use serde_json::json;

    #[test]
    fn real_values_use_their_shortest_text() {
        assert_eq!(owned_to_json(duckdb::types::Value::Float(1.1)), json!(1.1));
    }

    #[tokio::test]
    async fn mode_ro_opens_the_file_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ro.duckdb");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE t(x INT); INSERT INTO t VALUES (1)")
            .unwrap();
        let url = format!("duckdb://{}?mode=ro", path.display());
        let db = DuckdbAdapter::new(&url, create_pool_state(), "ro".into()).unwrap();
        let err = db
            .execute_query("INSERT INTO t VALUES (2)")
            .await
            .unwrap_err();
        assert!(err.contains("Nur lesend geöffnet"), "{err}");
        let rows = db
            .execute_query("SELECT count(*) AS n FROM t")
            .await
            .unwrap();
        assert_eq!(rows.rows[0]["n"], 1);
    }

    #[tokio::test]
    async fn column_changes_honour_not_null_and_roll_back_together() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("columns.duckdb");
        let adapter = DuckdbAdapter::new(
            &format!("duckdb:{}?mode=rwc", path.display()),
            create_pool_state(),
            "columns".into(),
        )
        .unwrap();
        adapter
            .exec("CREATE TABLE items (id INTEGER, name VARCHAR)".into())
            .await
            .unwrap();
        adapter
            .add_column(
                "main",
                "items",
                &AddColumnRequest {
                    name: "code".into(),
                    data_type: "VARCHAR".into(),
                    is_nullable: false,
                    default_value: Some("'x'".into()),
                },
            )
            .await
            .unwrap();
        let columns = adapter
            .list_table_columns_detailed("main", "items")
            .await
            .unwrap();
        let code = columns.iter().find(|c| c.name == "code").unwrap();
        assert!(!code.is_nullable);
        let failed = adapter
            .alter_column(
                "main",
                "items",
                &AlterColumnRequest {
                    old_name: "name".into(),
                    new_name: Some("id".into()),
                    data_type: Some("TEXT".into()),
                    set_not_null: None,
                    new_default: Some("'neu'".into()),
                    drop_default: false,
                    using: None,
                },
            )
            .await;
        assert!(failed.is_err());
        let columns = adapter
            .list_table_columns_detailed("main", "items")
            .await
            .unwrap();
        let name = columns.iter().find(|c| c.name == "name").unwrap();
        assert!(!name
            .column_default
            .clone()
            .unwrap_or_default()
            .contains("neu"));
    }

    #[tokio::test]
    async fn main_schema_is_listed_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("schemas.duckdb");
        let adapter = DuckdbAdapter::new(
            &format!("duckdb:{}?mode=rwc", path.display()),
            create_pool_state(),
            "schemas".into(),
        )
        .unwrap();
        adapter
            .exec("CREATE TABLE items (id INTEGER); CREATE SCHEMA extra".into())
            .await
            .unwrap();
        assert_eq!(adapter.list_schemas().await.unwrap(), ["extra", "main"]);
        let overview = adapter.get_database_overview().await.unwrap();
        let counts: Vec<_> = overview
            .schemas
            .iter()
            .map(|s| (s.schema.as_str(), s.table_count))
            .collect();
        assert_eq!(counts, [("extra", 0), ("main", 1)]);
    }

    #[tokio::test]
    async fn foreign_keys_and_constraint_columns_are_listed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fk.duckdb");
        let adapter = DuckdbAdapter::new(
            &format!("duckdb:{}?mode=rwc", path.display()),
            create_pool_state(),
            "fk".into(),
        )
        .unwrap();
        adapter
            .exec(
                "CREATE TABLE parent (a INTEGER, b INTEGER, PRIMARY KEY (a, b)); \
                 CREATE TABLE child (id INTEGER PRIMARY KEY, pa INTEGER, pb INTEGER, \
                 FOREIGN KEY (pa, pb) REFERENCES parent (a, b))"
                    .into(),
            )
            .await
            .unwrap();
        let fks = adapter.list_foreign_keys("main", "child").await.unwrap();
        let pairs: Vec<_> = fks
            .iter()
            .map(|fk| {
                (
                    fk.from_column.as_str(),
                    fk.to_table.as_str(),
                    fk.to_column.as_str(),
                )
            })
            .collect();
        assert_eq!(pairs, [("pa", "parent", "a"), ("pb", "parent", "b")]);
        let constraints = adapter.list_constraints("main", "parent").await.unwrap();
        assert!(constraints
            .iter()
            .any(|c| c.constraint_type == "PRIMARY KEY" && c.columns == ["a", "b"]));
    }

    #[test]
    fn values_render_as_readable_exact_json() {
        let conn = Connection::open_in_memory().unwrap();
        let (_, rows) = query_all(
            &conn,
            "SELECT DATE '2024-01-02', TIMESTAMP '2024-01-02 03:04:05.123456', TIME '13:14:15', \
             12.50::DECIMAL(10,2), 12345678901234567890.123456789::DECIMAL(38,9), \
             9007199254740993::BIGINT, 170141183460469231731687303715884105727::HUGEINT, \
             [1, 2], {'a': 1, 'b': 'x'}, MAP {'k': 1}, INTERVAL 1 DAY + INTERVAL 90 MINUTE, \
             '00000000-0000-0000-0000-000000000001'::UUID, 'x'::ENUM('x', 'y'), [1, 2]::INTEGER[2], \
             TIMESTAMPTZ '2024-01-02 03:04:05+00'",
        )
        .unwrap();
        assert_eq!(
            rows[0],
            vec![
                json!("2024-01-02"),
                json!("2024-01-02 03:04:05.123456"),
                json!("13:14:15"),
                json!("12.50"),
                json!("12345678901234567890.123456789"),
                json!("9007199254740993"),
                json!("170141183460469231731687303715884105727"),
                json!([1, 2]),
                json!({"a": 1, "b": "x"}),
                json!({"k": 1}),
                json!("1 day 01:30:00"),
                json!("00000000-0000-0000-0000-000000000001"),
                json!("x"),
                json!([1, 2]),
                json!("2024-01-02 03:04:05+00"),
            ]
        );
    }

    #[test]
    fn untyped_nulls_preserve_scalar_and_nested_values_without_poisoning_connections() {
        let conn = Connection::open_in_memory().unwrap();
        let (_, rows) = query_all(&conn, "SELECT NULL, [NULL, NULL], {'missing': NULL, 'value': 1}, MAP {'missing': NULL}, array_value(NULL, NULL)").unwrap();
        assert_eq!(
            rows[0],
            vec![
                json!(null),
                json!([null, null]),
                json!({"missing":null,"value":1}),
                json!({"missing":null}),
                json!([null, null])
            ]
        );
        assert_eq!(query_all(&conn, "SELECT 42").unwrap().1[0], vec![json!(42)]);
    }

    #[test]
    fn null_heavy_results_remain_bounded_and_keep_request_count_constant() {
        let conn = Connection::open_in_memory().unwrap();
        let mut samples = Vec::new();
        for _ in 0..15 {
            let start = std::time::Instant::now();
            let (_, rows) = query_limited(&conn, "SELECT NULL AS missing, {'missing': NULL, 'value': i} AS record FROM range(1000000) t(i)", 1000).unwrap();
            assert_eq!(rows.len(), 1000);
            assert!(rows
                .iter()
                .all(|row| row[0].is_null() && row[1]["missing"].is_null()));
            assert!(serde_json::to_vec(&rows).unwrap().len() < 100000);
            samples.push(start.elapsed());
        }
        samples.sort();
        eprintln!("DuckDB NULL decoding: 1M source rows, retained 1000 rows/<100KB JSON, 1 request/run, median {:?}, p95 {:?}, no background tasks", samples[7], samples[14]);
        assert!(samples[14] < std::time::Duration::from_millis(500));
    }

    #[test]
    fn file_views_cover_csv_tsv_json_and_parquet() {
        assert_eq!(
            file_view_sql("/tmp/o'hara.CSV", "/tmp/o'hara.CSV", None).unwrap(),
            "CREATE VIEW \"o'hara\" AS SELECT * FROM read_csv('/tmp/o''hara.CSV', null_padding = true, parallel = false)"
        );
        assert!(file_view_sql("/tmp/a.tsv", "/tmp/a.tsv", Some("latin-1"))
            .unwrap()
            .ends_with(
                "delim = '\\t', null_padding = true, parallel = false, encoding = 'latin-1')"
            ));
        assert!(file_view_sql("/tmp/a.parquet", "/tmp/a.parquet", None)
            .unwrap()
            .contains("read_parquet('/tmp/a.parquet')"));
        assert!(file_view_sql("/tmp/a.jsonl", "/tmp/a.jsonl", None)
            .unwrap()
            .contains("read_json_auto('/tmp/a.jsonl')"));
        assert!(file_view_sql("/tmp/a.duckdb", "/tmp/a.duckdb", None).is_none());
        assert!(file_view_sql(":memory:", ":memory:", None).is_none());
    }

    #[test]
    fn bits_unions_and_zoned_timestamps_keep_their_meaning() {
        let conn = Connection::open_in_memory().unwrap();
        let (_, rows) = query_all(
            &conn,
            "SELECT '10101'::BIT, '1010'::BIT, '0'::BIT, union_value(num := 5)::UNION(num INTEGER, str VARCHAR), \
             union_value(str := 'x')::UNION(num INTEGER, str VARCHAR), TIMESTAMPTZ '2026-11-11 10:00:00+01', 'x'::BLOB",
        )
        .unwrap();
        assert_eq!(
            rows[0],
            vec![
                json!("10101"),
                json!("1010"),
                json!("0"),
                json!({"num": 5}),
                json!({"str": "x"}),
                json!("2026-11-11 09:00:00+00"),
                json!("\\x78"),
            ]
        );
    }

    #[test]
    fn index_expressions_become_columns() {
        assert_eq!(index_columns("[a]"), ["a"]);
        assert_eq!(index_columns("[a, '(lower(b))']"), ["a", "lower(b)"]);
        assert_eq!(
            index_columns("['(b = ''x'')', '(a) + (b)']"),
            ["b = 'x'", "(a) + (b)"]
        );
        assert!(index_columns("[]").is_empty());
    }

    fn file_adapter(path: &std::path::Path, key: &str) -> Result<DuckdbAdapter, String> {
        DuckdbAdapter::new(
            &format!("duckdb:{}", path.display()),
            create_pool_state(),
            key.to_string(),
        )
    }

    async fn first_column(db: &DuckdbAdapter, sql: &str) -> Result<Vec<serde_json::Value>, String> {
        let result = db.execute_query(sql).await?;
        Ok(result
            .rows
            .iter()
            .map(|row| row[result.columns[0].as_str()].clone())
            .collect())
    }

    #[tokio::test]
    async fn text_files_keep_every_row_and_decode_common_encodings() {
        let dir = tempfile::tempdir().unwrap();
        let ragged = dir.path().join("ragged.csv");
        std::fs::write(&ragged, "a,b,c\n1,2\n3,4,5,6\n").unwrap();
        let db = file_adapter(&ragged, "ragged").unwrap();
        let result = db.execute_query("SELECT * FROM ragged").await.unwrap();
        assert_eq!(result.columns[..3], ["a", "b", "c"]);
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0]["c"], json!(null));
        assert_eq!(result.rows[1]["c"], json!(5));
        let quoted = dir.path().join("quoted.csv");
        std::fs::write(&quoted, "id;note\n1;\"a\nb\"\n\n2;x\n").unwrap();
        let db = file_adapter(&quoted, "quoted").unwrap();
        assert_eq!(
            first_column(&db, "SELECT note FROM quoted ORDER BY id")
                .await
                .unwrap(),
            [json!("a\nb"), json!("x")]
        );
        let latin = dir.path().join("latin.csv");
        std::fs::write(&latin, b"id,name\n1,M\xfcller\n").unwrap();
        let db = file_adapter(&latin, "latin").unwrap();
        assert_eq!(
            first_column(&db, "SELECT name FROM latin").await.unwrap(),
            [json!("Müller")]
        );
        let utf16 = dir.path().join("wide.csv");
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend(
            "id,name\n1,Müller\n"
                .encode_utf16()
                .flat_map(u16::to_le_bytes),
        );
        std::fs::write(&utf16, bytes).unwrap();
        let db = file_adapter(&utf16, "wide").unwrap();
        assert_eq!(
            first_column(&db, "SELECT name FROM wide").await.unwrap(),
            [json!("Müller")]
        );
        let big_endian = dir.path().join("wide_be.csv");
        let mut bytes = vec![0xfe, 0xff];
        bytes.extend(
            "id,name\n1,Müller 😀\n"
                .encode_utf16()
                .flat_map(u16::to_be_bytes),
        );
        std::fs::write(&big_endian, bytes).unwrap();
        let db = file_adapter(&big_endian, "wide_be").unwrap();
        assert_eq!(
            first_column(&db, "SELECT name FROM wide_be").await.unwrap(),
            [json!("Müller 😀")]
        );
        let excel = dir.path().join("excel.csv");
        std::fs::write(&excel, b"id;preis\n1;5 \x80 f\xfcr M\xfcller\n").unwrap();
        let db = file_adapter(&excel, "excel").unwrap();
        assert_eq!(
            first_column(&db, "SELECT preis FROM excel").await.unwrap(),
            [json!("5 € für Müller")]
        );
        let cp1252 = dir.path().join("euro.csv");
        std::fs::write(&cp1252, b"id,price\n1,5\x80\n").unwrap();
        let db = file_adapter(&cp1252, "euro").unwrap();
        assert_eq!(
            first_column(&db, "SELECT price FROM euro").await.unwrap(),
            [json!("5€")]
        );
        let tsv = dir.path().join("tab.tsv");
        std::fs::write(&tsv, "id\tname\n1\ta,b\n").unwrap();
        let db = file_adapter(&tsv, "tsv").unwrap();
        assert_eq!(
            first_column(&db, "SELECT name FROM tab").await.unwrap(),
            [json!("a,b")]
        );
        let lines = dir.path().join("events.jsonl");
        std::fs::write(&lines, "{\"id\":1}\n{\"id\":2,\"extra\":true}\n").unwrap();
        let db = file_adapter(&lines, "jsonl").unwrap();
        assert_eq!(
            first_column(&db, "SELECT count(*) FROM events")
                .await
                .unwrap(),
            [json!(2)]
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 9);
    }

    #[tokio::test]
    async fn extensions_are_never_downloaded_and_sqlite_files_are_refused() {
        let db = DuckdbAdapter::new(":memory:", create_pool_state(), "ext".into()).unwrap();
        assert_eq!(
            first_column(
                &db,
                "SELECT value FROM duckdb_settings() WHERE name = 'autoinstall_known_extensions'"
            )
            .await
            .unwrap(),
            [json!("false")]
        );
        let parquet = first_column(&db, "SELECT extension_name FROM duckdb_extensions() WHERE install_mode = 'STATICALLY_LINKED' AND extension_name IN ('json', 'parquet') ORDER BY 1").await.unwrap();
        assert_eq!(parquet, [json!("json"), json!("parquet")]);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.sqlite");
        rusqlite::Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE t (a INT)")
            .unwrap();
        let error = file_adapter(&path, "sqlite-file").err().unwrap();
        assert!(error.contains("sqlite://"), "{error}");
    }

    #[tokio::test]
    async fn sequences_index_columns_and_row_keys_are_listed() {
        let db = DuckdbAdapter::new(":memory:", create_pool_state(), "seq".into()).unwrap();
        db.exec("CREATE SCHEMA s1; CREATE SEQUENCE s1.seq1 START 10 INCREMENT 2; SELECT nextval('s1.seq1'); \
                 CREATE TABLE s1.t (id INTEGER PRIMARY KEY, a INTEGER, b VARCHAR, bin BLOB); CREATE INDEX idx_t ON s1.t (a, lower(b))".into())
            .await
            .unwrap();
        let sequences = db.list_sequences(Some("s1")).await.unwrap();
        assert_eq!(sequences.len(), 1);
        assert_eq!(
            (
                sequences[0].name.as_str(),
                sequences[0].start_value.as_str(),
                sequences[0].increment_by.as_str(),
                sequences[0].last_value.as_deref()
            ),
            ("seq1", "10", "2", Some("10"))
        );
        assert!(db.list_sequences(Some("main")).await.unwrap().is_empty());
        let indexes = db.list_indexes("s1", "t").await.unwrap();
        assert_eq!(indexes[0].columns, ["a", "lower(b)"]);
        let inserted = db
            .execute_query("INSERT INTO s1.t VALUES (1, 2, 'x', from_hex('00ff')) RETURNING *")
            .await
            .unwrap();
        assert_eq!(inserted.rows[0]["bin"], json!("\\x00ff"));
        let rows = db
            .fetch_rows("s1", "t", None, 10, 0, None, false, false, false)
            .await
            .unwrap();
        assert_eq!(rows.rows[0]["__ctid__"], json!("{\"id\":1}"));
        let updated = db.execute_query("UPDATE s1.t SET a = 3").await.unwrap();
        assert_eq!(updated.rows_affected, Some(1));
    }

    #[test]
    fn engine_errors_are_shortened_to_german_hints() {
        assert_eq!(
            german("IO Error: Could not set lock on file \"/x.duckdb\": Conflicting lock is held in /Apps/l8db (PID 68114) by user leon. See also https://duckdb.org/docs"),
            "Datei wird gerade von einem anderen Programm verwendet (Prozess 68114). Schließen und erneut versuchen."
        );
        let csv = german("Invalid Input Error: CSV Error on Line: 2\nOriginal Line: 1,2\nExpected Number of Columns: 3 Found: 2\n\nPossible fixes: x\n  file = /x.csv\n  delimiter = ,");
        assert_eq!(
            csv,
            "CSV-Fehler in Zeile 2\nOriginal Line: 1,2\nExpected Number of Columns: 3 Found: 2"
        );
        assert_eq!(
            german("Catalog Error: Table with name nope does not exist!"),
            "Objekt nicht gefunden: Catalog Error: Table with name nope does not exist!"
        );
        assert!(
            german("Parser Error: syntax error at or near \"selec\"").starts_with("Syntaxfehler: ")
        );
        assert_eq!(german("Invalid Input Error: x"), "Invalid Input Error: x");
        assert!(german("IO Error: Extension \"/h/.duckdb/extensions/v2.0.0/osx_arm64/sqlite_scanner.duckdb_extension\" not found.\nExtension \"sqlite_scanner\" is an existing extension.\n")
            .starts_with("DuckDB-Erweiterung „sqlite_scanner“ fehlt."));
    }

    #[tokio::test]
    async fn csv_views_stay_fast_on_large_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.csv");
        let mut text = String::from("id,name,value\n");
        for i in 0..300_000 {
            text.push_str(&format!("{i},n{i},{}\n", i * 2));
        }
        std::fs::write(&path, text).unwrap();
        let db = file_adapter(&path, "large").unwrap();
        let mut samples = Vec::new();
        for _ in 0..7 {
            let start = std::time::Instant::now();
            let rows = db
                .execute_query("SELECT count(*) AS n, sum(value) AS s FROM large")
                .await
                .unwrap();
            assert_eq!(rows.rows[0]["n"], json!(300_000));
            samples.push(start.elapsed());
        }
        let page = db
            .fetch_rows(
                "main", "large", None, 100, 250_000, None, false, true, false,
            )
            .await
            .unwrap();
        assert_eq!(page.rows.len(), 100);
        samples.sort();
        eprintln!("DuckDB CSV view: 300k rows/5.6 MB, 1 view, 1 query per scan, median {:?}, p95 {:?}, page of 100 rows retained", samples[3], samples[6]);
        assert!(samples[6] < std::time::Duration::from_secs(3));
    }

    #[tokio::test]
    async fn csv_file_opens_as_in_memory_view() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("people.csv");
        std::fs::write(&path, "id,name\n1,Ada\n2,Linus\n").unwrap();
        let db = DuckdbAdapter::new(
            &format!("duckdb:{}", path.display()),
            create_pool_state(),
            "csv-test".to_string(),
        )
        .unwrap();
        let views = db.list_views(None).await.unwrap();
        assert_eq!(views[0].name, "people");
        let result = db
            .execute_query("SELECT name FROM people ORDER BY id")
            .await
            .unwrap();
        assert_eq!(result.rows.len(), 2);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
