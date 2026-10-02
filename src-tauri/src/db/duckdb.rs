use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use duckdb::types::{TimeUnit, ValueRef};
use duckdb::Connection;

use super::pool::PoolState;
use super::sqlite::existing_file_path;
use super::{
    create_table_ddl, hex_blob, rows_to_objects, where_clause, AddColumnRequest,
    AlterColumnRequest, ColumnInfo, ConstraintInfo, CreateTableRequest, DatabaseAdapter,
    DatabaseOverview, DetailedColumnInfo, ForeignKeyInfo, IndexInfo, QueryResult, SchemaSize,
    TableData, TableInfo,
};

pub struct DuckdbAdapter {
    path: String,
    pool_state: PoolState,
    key: String,
}

pub fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn file_view_sql(path: &str) -> Option<String> {
    let file = std::path::Path::new(path);
    let reader = match file.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "parquet" => "read_parquet",
        "csv" => "read_csv_auto",
        _ => return None,
    };
    let name = file
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("data");
    Some(format!(
        "CREATE VIEW {} AS SELECT * FROM {reader}({})",
        quote(name),
        lit(path)
    ))
}

fn map_err(e: duckdb::Error) -> String {
    format!("DuckDB: {e}")
}

fn value_to_json(value: ValueRef<'_>) -> serde_json::Value {
    match value {
        ValueRef::Text(t) => serde_json::Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) | ValueRef::Geometry(b) => serde_json::Value::String(hex_blob(b)),
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
        V::Float(f) => num(f as f64),
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
    let mut stmt = conn.prepare(sql).map_err(map_err)?;
    let mut result = stmt.query([]).map_err(map_err)?;
    let mut columns: Vec<String> = Vec::new();
    let mut rows = Vec::new();
    while let Some(row) = result.next().map_err(map_err)? {
        if columns.is_empty() {
            columns = row.as_ref().column_names();
        }
        let count = columns.len();
        let mut values = Vec::with_capacity(count);
        for i in 0..count {
            values.push(value_to_json(row.get_ref(i).map_err(map_err)?));
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

fn truthy(v: &serde_json::Value) -> bool {
    matches!(v, serde_json::Value::Bool(true)) || v.as_i64().is_some_and(|i| i != 0)
}

impl DuckdbAdapter {
    pub fn new(
        connection_string: &str,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        Ok(Self {
            path: existing_file_path(connection_string)?,
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
        let conn: Arc<Mutex<Connection>> = self
            .pool_state
            .shared(&self.key, || async move {
                let view = file_view_sql(&path);
                let conn = if path == ":memory:" || view.is_some() {
                    Connection::open_in_memory()
                } else {
                    Connection::open(&path)
                }
                .map_err(|e| format!("DuckDB-Datei konnte nicht geöffnet werden ({path}): {e}"))?;
                if let Some(sql) = view {
                    conn.execute_batch(&sql)
                        .map_err(|e| format!("Datei konnte nicht gelesen werden ({path}): {e}"))?;
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
}

fn run_sql(c: &Connection, sql: &str) -> Result<QueryResult, String> {
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
    ) {
        let (columns, rows) = query_all(c, sql)?;
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
            run_sql(&guard, &sql)
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
        let columns: Vec<String> = self
            .list_table_columns_detailed(schema, table)
            .await?
            .into_iter()
            .map(|c| c.name)
            .collect();
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
        Ok(TableData {
            columns: if columns.is_empty() {
                cols.clone()
            } else {
                columns
            },
            rows: rows_to_objects(&cols, rows),
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
        self.run(move |c| run_sql(c, &sql)).await
    }

    async fn begin_transaction(&self) -> Result<Box<dyn super::TxSession>, String> {
        let conn = self.run(|c| c.try_clone().map_err(map_err)).await?;
        let conn = Arc::new(Mutex::new(conn));
        let tx = DuckdbTx { conn };
        tx.blocking("BEGIN TRANSACTION".into()).await?;
        Ok(Box::new(tx))
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
        let mut sql = format!(
            "ALTER TABLE {}.{} ADD COLUMN {} {}",
            quote(schema),
            quote(table),
            quote(&column.name),
            column.data_type
        );
        if let Some(d) = column.default_value.as_deref().filter(|d| !d.is_empty()) {
            sql.push_str(&format!(" DEFAULT {d}"));
        }
        self.exec(sql).await
    }

    async fn alter_column(
        &self,
        schema: &str,
        table: &str,
        changes: &AlterColumnRequest,
    ) -> Result<(), String> {
        let target = format!("{}.{}", quote(schema), quote(table));
        if let Some(t) = changes.data_type.as_deref().filter(|t| !t.is_empty()) {
            self.exec(format!(
                "ALTER TABLE {target} ALTER COLUMN {} TYPE {t}",
                quote(&changes.old_name)
            ))
            .await?;
        }
        if changes.drop_default {
            self.exec(format!(
                "ALTER TABLE {target} ALTER COLUMN {} DROP DEFAULT",
                quote(&changes.old_name)
            ))
            .await?;
        } else if let Some(d) = changes.new_default.as_deref().filter(|d| !d.is_empty()) {
            self.exec(format!(
                "ALTER TABLE {target} ALTER COLUMN {} SET DEFAULT {d}",
                quote(&changes.old_name)
            ))
            .await?;
        }
        if let Some(not_null) = changes.set_not_null {
            self.exec(format!(
                "ALTER TABLE {target} ALTER COLUMN {} {} NOT NULL",
                quote(&changes.old_name),
                if not_null { "SET" } else { "DROP" }
            ))
            .await?;
        }
        if let Some(new_name) = changes
            .new_name
            .as_deref()
            .filter(|n| !n.is_empty() && *n != changes.old_name)
        {
            self.exec(format!(
                "ALTER TABLE {target} RENAME COLUMN {} TO {}",
                quote(&changes.old_name),
                quote(new_name)
            ))
            .await?;
        }
        Ok(())
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
        let sql = format!("SELECT index_name, is_unique, is_primary, sql FROM duckdb_indexes() WHERE schema_name = {} AND table_name = {} ORDER BY index_name", lit(schema), lit(table));
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| IndexInfo {
                name: text(&r[0]),
                is_unique: truthy(&r[1]),
                is_primary: truthy(&r[2]),
                columns: vec![],
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
mod tests {
    use super::*;
    use crate::db::pool::create_pool_state;
    use serde_json::json;

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
                json!(12.5),
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
                json!("2024-01-02 03:04:05"),
            ]
        );
    }

    #[test]
    fn file_views_cover_csv_and_parquet() {
        assert_eq!(
            file_view_sql("/tmp/o'hara.CSV").unwrap(),
            "CREATE VIEW \"o'hara\" AS SELECT * FROM read_csv_auto('/tmp/o''hara.CSV')"
        );
        assert!(file_view_sql("/tmp/a.parquet")
            .unwrap()
            .contains("read_parquet('/tmp/a.parquet')"));
        assert!(file_view_sql("/tmp/a.duckdb").is_none());
        assert!(file_view_sql(":memory:").is_none());
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
