use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::limits::Limit;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use super::{FederationSource, MAX_CELL_BYTES, MAX_RESULT_BYTES, MAX_RESULT_ROWS, MAX_SQL_BYTES};
use crate::db::{ColumnInfo, QueryResult, TableData};

const MAX_VM_STEPS: u64 = 20_000_000;
const PROGRESS_STEPS: i32 = 1_000;
pub(super) const MAX_DATABASE_PAGES: usize = 8_192;
pub(super) const DATABASE_PAGE_BYTES: usize = 4_096;
pub(super) const MAX_ALIAS_DATABASE_BYTES: usize = MAX_DATABASE_PAGES * DATABASE_PAGE_BYTES;

pub(super) struct Definition {
    pub source: FederationSource,
    pub columns: Vec<ColumnInfo>,
}

pub(super) struct Sandbox {
    connection: Connection,
    allowed: HashSet<(String, String)>,
    reads: Arc<Mutex<HashSet<(String, String)>>>,
    cancel: CancellationToken,
    deadline: Instant,
}

fn error(cause: rusqlite::Error) -> String {
    if matches!(&cause, rusqlite::Error::SqliteFailure(failure, _) if failure.code == rusqlite::ErrorCode::DiskFull)
    {
        return format!("Die lokale SQLite-Speichergrenze ist erreicht: höchstens {} MiB je Alias ({MAX_DATABASE_PAGES} Seiten à {DATABASE_PAGE_BYTES} Byte), einschließlich aller Tabellen und ihrer Verwaltungsdaten. Die Grenze von 64 MiB für rohe Quelldaten gilt zusätzlich. Weniger oder kleinere Quellen je Alias auswählen; es wird kein unvollständiges Ergebnis berechnet.", MAX_ALIAS_DATABASE_BYTES / (1024 * 1024));
    }
    format!("Lokale SQL-Abfrage: {cause}")
}

fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn safe_function(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "abs"
            | "avg"
            | "changes"
            | "char"
            | "coalesce"
            | "concat"
            | "concat_ws"
            | "count"
            | "cume_dist"
            | "date"
            | "datetime"
            | "dense_rank"
            | "first_value"
            | "format"
            | "glob"
            | "group_concat"
            | "hex"
            | "if"
            | "ifnull"
            | "iif"
            | "instr"
            | "json"
            | "json_array"
            | "json_array_length"
            | "json_extract"
            | "json_group_array"
            | "json_group_object"
            | "json_insert"
            | "json_object"
            | "json_patch"
            | "json_quote"
            | "json_remove"
            | "json_replace"
            | "json_set"
            | "json_type"
            | "json_valid"
            | "julianday"
            | "lag"
            | "last_value"
            | "lead"
            | "length"
            | "like"
            | "likelihood"
            | "likely"
            | "lower"
            | "ltrim"
            | "max"
            | "min"
            | "nth_value"
            | "ntile"
            | "nullif"
            | "octet_length"
            | "percent_rank"
            | "printf"
            | "quote"
            | "rank"
            | "replace"
            | "round"
            | "row_number"
            | "rtrim"
            | "sign"
            | "soundex"
            | "sqlite_version"
            | "strftime"
            | "string_agg"
            | "substr"
            | "substring"
            | "sum"
            | "timediff"
            | "total"
            | "trim"
            | "typeof"
            | "unicode"
            | "unixepoch"
            | "unlikely"
            | "upper"
    )
}

fn sqlite_value(value: &Value) -> Result<SqlValue, String> {
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(value) => Ok(SqlValue::Integer(i64::from(*value))),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                Ok(SqlValue::Integer(value))
            } else if value.is_u64() {
                Ok(SqlValue::Text(value.to_string()))
            } else {
                value
                    .as_f64()
                    .map(SqlValue::Real)
                    .ok_or_else(|| "Ungültige Zahl in der Quelle.".into())
            }
        }
        Value::String(value) if value.len() <= MAX_CELL_BYTES => Ok(SqlValue::Text(value.clone())),
        Value::String(_) => Err("Ein Quellwert überschreitet die Grenze von 1 MiB.".into()),
        value => {
            let text = serde_json::to_string(value).map_err(|cause| cause.to_string())?;
            if text.len() > MAX_CELL_BYTES {
                return Err("Ein Quellwert überschreitet die Grenze von 1 MiB.".into());
            }
            Ok(SqlValue::Text(text))
        }
    }
}

pub(super) fn value_bytes(value: &Value) -> usize {
    match value {
        Value::Null => 4,
        Value::Bool(_) => 5,
        Value::Number(_) => 24,
        Value::String(value) => value.len().saturating_add(8),
        Value::Array(values) => values
            .iter()
            .fold(8_usize, |sum, value| sum.saturating_add(value_bytes(value))),
        Value::Object(values) => values.iter().fold(8_usize, |sum, (key, value)| {
            sum.saturating_add(key.len())
                .saturating_add(8)
                .saturating_add(value_bytes(value))
        }),
    }
}

fn json_value(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) if value.unsigned_abs() > 9_007_199_254_740_991 => {
            Value::String(value.to_string())
        }
        ValueRef::Integer(value) => Value::from(value),
        ValueRef::Real(value) => Value::from(value),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => Value::String(crate::db::hex_blob(value)),
    }
}

impl Sandbox {
    pub fn new(
        definitions: &[Definition],
        cancel: CancellationToken,
        deadline: Instant,
    ) -> Result<Self, String> {
        let connection = Connection::open_in_memory().map_err(error)?;
        connection
            .set_limit(Limit::SQLITE_LIMIT_SQL_LENGTH, MAX_SQL_BYTES as i32)
            .map_err(error)?;
        connection
            .set_limit(Limit::SQLITE_LIMIT_LENGTH, MAX_CELL_BYTES as i32)
            .map_err(error)?;
        connection
            .set_limit(Limit::SQLITE_LIMIT_COLUMN, 512)
            .map_err(error)?;
        connection
            .set_limit(Limit::SQLITE_LIMIT_EXPR_DEPTH, 100)
            .map_err(error)?;
        connection
            .set_limit(Limit::SQLITE_LIMIT_COMPOUND_SELECT, 32)
            .map_err(error)?;
        connection
            .set_limit(Limit::SQLITE_LIMIT_VDBE_OP, 100_000)
            .map_err(error)?;
        connection
            .set_limit(Limit::SQLITE_LIMIT_ATTACHED, super::MAX_SOURCES as i32)
            .map_err(error)?;
        connection.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA automatic_index=ON; PRAGMA cache_size=-4096;").map_err(error)?;
        let mut attached = HashSet::new();
        let mut allowed = HashSet::new();
        for definition in definitions {
            let source = &definition.source;
            if attached.insert(source.alias.to_lowercase()) {
                connection
                    .execute(
                        &format!("ATTACH DATABASE ':memory:' AS {}", quote(&source.alias)),
                        [],
                    )
                    .map_err(error)?;
                connection.execute_batch(&format!("PRAGMA {}.page_size={DATABASE_PAGE_BYTES}; PRAGMA {}.max_page_count={MAX_DATABASE_PAGES}; PRAGMA {}.cache_size=-4096;", quote(&source.alias), quote(&source.alias), quote(&source.alias))).map_err(error)?;
            }
            let columns = definition
                .columns
                .iter()
                .map(|column| quote(&column.name))
                .collect::<Vec<_>>()
                .join(", ");
            connection
                .execute_batch(&format!(
                    "CREATE TABLE {}.{} ({columns})",
                    quote(&source.alias),
                    quote(&source.table)
                ))
                .map_err(error)?;
            allowed.insert((source.alias.to_lowercase(), source.table.to_lowercase()));
        }
        let reads = Arc::new(Mutex::new(HashSet::new()));
        let sandbox = Self {
            connection,
            allowed,
            reads,
            cancel,
            deadline,
        };
        sandbox.protect()?;
        Ok(sandbox)
    }

    fn protect(&self) -> Result<(), String> {
        let cancel = self.cancel.clone();
        let deadline = self.deadline;
        let mut steps = 0_u64;
        self.connection
            .progress_handler(
                PROGRESS_STEPS,
                Some(move || {
                    steps = steps.saturating_add(PROGRESS_STEPS as u64);
                    cancel.is_cancelled() || Instant::now() >= deadline || steps >= MAX_VM_STEPS
                }),
            )
            .map_err(error)?;
        let allowed = self.allowed.clone();
        let reads = self.reads.clone();
        self.connection
            .authorizer(Some(move |context: AuthContext<'_>| match context.action {
                AuthAction::Select | AuthAction::Recursive => Authorization::Allow,
                AuthAction::Read { table_name, .. } => {
                    let key = (
                        context.database_name.unwrap_or_default().to_lowercase(),
                        table_name.to_lowercase(),
                    );
                    if allowed.contains(&key) {
                        match reads.lock() {
                            Ok(mut reads) => {
                                reads.insert(key);
                                Authorization::Allow
                            }
                            Err(_) => Authorization::Deny,
                        }
                    } else {
                        Authorization::Deny
                    }
                }
                AuthAction::Function { function_name } if safe_function(function_name) => {
                    Authorization::Allow
                }
                _ => Authorization::Deny,
            }))
            .map_err(error)?;
        Ok(())
    }

    pub fn references(&self, sql: &str) -> Result<HashSet<(String, String)>, String> {
        self.check_cancelled()?;
        let statement = self.connection.prepare(sql).map_err(error)?;
        if !statement.readonly() || statement.column_count() == 0 || statement.parameter_count() > 0
        {
            return Err(
                "Nur eine lesende SELECT-Abfrage ohne ungebundene Parameter ist erlaubt.".into(),
            );
        }
        self.reads
            .lock()
            .map(|reads| reads.clone())
            .map_err(|_| "Quellenauswahl ist blockiert.".into())
    }

    fn check_cancelled(&self) -> Result<(), String> {
        if self.cancel.is_cancelled() {
            Err("Datenbankübergreifende Abfrage wurde abgebrochen.".into())
        } else if Instant::now() >= self.deadline {
            Err("Zeitlimit der datenbankübergreifenden Abfrage erreicht.".into())
        } else {
            Ok(())
        }
    }

    pub fn load(&self, source: &FederationSource, data: TableData) -> Result<(), String> {
        self.check_cancelled()?;
        self.connection
            .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
            .map_err(error)?;
        let operation = (|| {
            self.connection.execute_batch("BEGIN").map_err(error)?;
            let columns = data
                .columns
                .iter()
                .map(|column| quote(column))
                .collect::<Vec<_>>()
                .join(", ");
            let placeholders = std::iter::repeat_n("?", data.columns.len())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "INSERT INTO {}.{} ({columns}) VALUES ({placeholders})",
                quote(&source.alias),
                quote(&source.table)
            );
            let mut statement = self.connection.prepare(&sql).map_err(error)?;
            for row in data.rows {
                self.check_cancelled()?;
                let values = data
                    .columns
                    .iter()
                    .map(|column| sqlite_value(&row[column]))
                    .collect::<Result<Vec<_>, _>>()?;
                statement.execute(params_from_iter(values)).map_err(error)?;
            }
            drop(statement);
            self.connection.execute_batch("COMMIT").map_err(error)
        })();
        if operation.is_err() {
            let _ = self.connection.execute_batch("ROLLBACK");
        }
        self.protect()?;
        operation.map_err(|cause| format!("Quelle {}.{}: {cause}", source.alias, source.table))
    }

    pub fn execute(&self, sql: &str) -> Result<QueryResult, String> {
        self.check_cancelled()?;
        let started = Instant::now();
        let mut statement = self.connection.prepare(sql).map_err(error)?;
        if !statement.readonly() || statement.column_count() == 0 || statement.parameter_count() > 0
        {
            return Err(
                "Nur eine lesende SELECT-Abfrage ohne ungebundene Parameter ist erlaubt.".into(),
            );
        }
        let mut seen = HashSet::<String>::new();
        let columns = statement
            .column_names()
            .iter()
            .map(|name| {
                let mut candidate = (*name).to_string();
                let mut suffix = 2;
                while !seen.insert(candidate.clone()) {
                    candidate = format!("{name} ({suffix})");
                    suffix += 1;
                }
                candidate
            })
            .collect::<Vec<_>>();
        let mut output = Vec::new();
        let mut retained_bytes = 0_usize;
        let mut rows = statement.query([]).map_err(error)?;
        let mut truncated = false;
        while let Some(row) = rows.next().map_err(error)? {
            self.check_cancelled()?;
            if output.len() >= MAX_RESULT_ROWS {
                truncated = true;
                break;
            }
            let mut value = serde_json::Map::new();
            for (index, column) in columns.iter().enumerate() {
                let cell = json_value(row.get_ref(index).map_err(error)?);
                retained_bytes = retained_bytes
                    .saturating_add(column.len())
                    .saturating_add(value_bytes(&cell));
                if retained_bytes > MAX_RESULT_BYTES {
                    return Err("Das Ergebnis überschreitet 8 MiB. Spalten gezielter auswählen oder SQL filtern.".into());
                }
                value.insert(column.clone(), cell);
            }
            output.push(Value::Object(value));
        }
        Ok(QueryResult {
            columns,
            rows: output,
            rows_affected: None,
            execution_time_ms: started.elapsed().as_millis() as u64,
            truncated,
        })
    }

    #[cfg(test)]
    pub fn allocated_pages(&self) -> Result<usize, String> {
        let mut total = 0;
        let aliases = self
            .allowed
            .iter()
            .map(|(alias, _)| alias)
            .collect::<HashSet<_>>();
        for alias in aliases {
            self.connection
                .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
                .map_err(error)?;
            let pages: i64 = self
                .connection
                .query_row(&format!("PRAGMA {}.page_count", quote(alias)), [], |row| {
                    row.get(0)
                })
                .map_err(error)?;
            total +=
                usize::try_from(pages).map_err(|_| "Ungültige SQLite-Seitenzahl".to_string())?;
        }
        self.protect()?;
        Ok(total)
    }
}
