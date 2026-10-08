use std::sync::OnceLock;

use async_trait::async_trait;

use super::{
    rows_to_objects, where_clause, AddColumnRequest, AlterColumnRequest, ColumnInfo,
    CreateTableRequest, DatabaseAdapter, DatabaseOverview, DetailedColumnInfo, FunctionInfo,
    QueryResult, SchemaSize, TableData, TableInfo,
};

pub struct ClickhouseAdapter {
    base: String,
    user: String,
    password: String,
    database: String,
}

pub fn quote(ident: &str) -> String {
    format!("`{}`", ident.replace('\\', "\\\\").replace('`', "\\`"))
}

fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(super::execution::connection_duration())
            .build()
            .expect("HTTP-Client")
    })
}

fn text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn text_opt(v: &serde_json::Value) -> Option<String> {
    let t = text(v);
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

fn int(v: &serde_json::Value) -> i64 {
    match v {
        serde_json::Value::Number(n) => n.as_i64().unwrap_or(0),
        serde_json::Value::String(s) => s.parse().unwrap_or(0),
        serde_json::Value::Bool(b) => *b as i64,
        _ => 0,
    }
}

impl ClickhouseAdapter {
    pub fn new(connection_string: &str, database: Option<&str>) -> Result<Self, String> {
        let url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige ClickHouse-URL".to_string())?;
        if !matches!(url.scheme(), "clickhouse" | "http" | "https") {
            return Err("Eine clickhouse:// URL ist erforderlich".to_string());
        }
        let host = url.host_str().ok_or("Host fehlt")?;
        let mut secure = url.scheme() == "https" || matches!(url.port(), Some(8443) | Some(443));
        let mut user = percent(url.username());
        let mut password = percent(url.password().unwrap_or(""));
        for (k, v) in url.query_pairs() {
            match k.as_ref() {
                "secure" | "ssl" => secure = matches!(v.as_ref(), "1" | "true" | "yes"),
                "sslmode" => secure = v != "disable" && v != "prefer",
                "user" => user = v.into_owned(),
                "password" => password = v.into_owned(),
                _ => {}
            }
        }
        let port = url.port().unwrap_or(if secure { 8443 } else { 8123 });
        let path_db = percent(url.path().trim_start_matches('/'));
        let database = database
            .filter(|d| !d.is_empty())
            .map(str::to_string)
            .unwrap_or(if path_db.is_empty() {
                "default".to_string()
            } else {
                path_db
            });
        Ok(Self {
            base: format!("{}://{host}:{port}/", if secure { "https" } else { "http" }),
            user: if user.is_empty() {
                "default".to_string()
            } else {
                user
            },
            password,
            database,
        })
    }

    fn create_table_sql(&self, req: &CreateTableRequest) -> String {
        let columns: Vec<String> = req
            .columns
            .iter()
            .map(|c| {
                let data_type = if c.is_nullable
                    && !c.is_primary_key
                    && !c.data_type.starts_with("Nullable(")
                {
                    format!("Nullable({})", c.data_type)
                } else {
                    c.data_type.clone()
                };
                let default = c
                    .default_value
                    .as_deref()
                    .filter(|d| !d.is_empty())
                    .map(|d| format!(" DEFAULT {d}"))
                    .unwrap_or_default();
                format!("{} {data_type}{default}", quote(&c.name))
            })
            .collect();
        let pk: Vec<String> = req
            .columns
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| quote(&c.name))
            .collect();
        let order = if pk.is_empty() {
            "tuple()".to_string()
        } else {
            format!("({})", pk.join(", "))
        };
        format!(
            "CREATE TABLE {}{}.{} ({}) ENGINE = MergeTree ORDER BY {order}",
            if req.if_not_exists {
                "IF NOT EXISTS "
            } else {
                ""
            },
            quote(&req.schema),
            quote(&req.name),
            columns.join(", ")
        )
    }

    async fn raw(&self, sql: &str) -> Result<(String, Option<serde_json::Value>), String> {
        self.raw_with(sql, &[]).await
    }

    async fn raw_with(
        &self,
        sql: &str,
        extra: &[(&str, &str)],
    ) -> Result<(String, Option<serde_json::Value>), String> {
        let query_id = format!("l8db-{:032x}", rand::random::<u128>());
        let cancel = super::execution::cancellation_token();
        if cancel.is_cancelled() {
            return Err("Abfrage abgebrochen, bevor sie gestartet wurde.".into());
        }
        let timed_out = tokio::select! {
            biased;
            answer = self.send(sql, extra, &query_id) => return answer,
            _ = cancel.cancelled() => false,
            _ = tokio::time::sleep(super::execution::query_duration()) => true,
        };
        self.kill(&query_id).await?;
        Err(if timed_out {
            format!(
                "Query-Timeout nach {} Sekunden: Abfrage vom Server abgebrochen.",
                super::execution::query_duration().as_secs()
            )
        } else {
            "Abfrage vom Server abgebrochen.".into()
        })
    }

    async fn send(
        &self,
        sql: &str,
        extra: &[(&str, &str)],
        query_id: &str,
    ) -> Result<(String, Option<serde_json::Value>), String> {
        let response = http()
            .post(&self.base)
            .query(&[
                ("database", self.database.as_str()),
                ("query_id", query_id),
                ("default_format", "JSONCompact"),
                ("output_format_json_quote_64bit_integers", "1"),
                ("output_format_json_quote_decimals", "1"),
            ])
            .query(extra)
            .header("X-ClickHouse-User", &self.user)
            .header("X-ClickHouse-Key", &self.password)
            .body(sql.to_string())
            .send()
            .await
            .map_err(|e| format!("ClickHouse nicht erreichbar: {e}"))?;
        let summary = response
            .headers()
            .get("X-ClickHouse-Summary")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| serde_json::from_str(s).ok());
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("Antwort konnte nicht gelesen werden: {e}"))?;
        if !status.is_success() {
            return Err(format!("ClickHouse {}: {}", status.as_u16(), body.trim()));
        }
        Ok((body, summary))
    }

    async fn kill(&self, query_id: &str) -> Result<(), String> {
        http()
            .post(&self.base)
            .timeout(super::execution::connection_duration())
            .header("X-ClickHouse-User", &self.user)
            .header("X-ClickHouse-Key", &self.password)
            .body(format!(
                "KILL QUERY WHERE query_id = {} ASYNC",
                lit(query_id)
            ))
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map(|_| ())
            .map_err(|e| format!("Abbruch nicht bestätigt: {e}. Serverzustand prüfen."))
    }

    async fn query(
        &self,
        sql: &str,
    ) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>, Option<u64>), String> {
        let (body, summary) = self.raw(sql).await?;
        let written = summary
            .as_ref()
            .and_then(|s| s.get("written_rows"))
            .map(int)
            .map(|n| n as u64);
        if body.trim().is_empty() {
            return Ok((vec![], vec![], written));
        }
        let parsed: serde_json::Value = match serde_json::from_str(&body) {
            Ok(v) => v,
            Err(_) => {
                return Ok((
                    vec!["result".to_string()],
                    body.lines()
                        .map(|l| vec![serde_json::Value::String(l.to_string())])
                        .collect(),
                    None,
                ))
            }
        };
        let meta = parsed
            .get("meta")
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default();
        let columns = super::unique_column_names(meta.iter().map(|c| text(&c["name"])).collect());
        let wide: Vec<bool> = meta
            .iter()
            .map(|c| {
                let column_type = text(&c["type"]);
                column_type.contains("Decimal") || WIDE_INT.iter().any(|w| column_type.contains(w))
            })
            .collect();
        let rows: Vec<Vec<serde_json::Value>> = parsed
            .get("data")
            .and_then(|d| d.as_array())
            .map(|d| {
                d.iter()
                    .map(|r| {
                        let mut row = r.as_array().cloned().unwrap_or_default();
                        for (i, v) in row.iter_mut().enumerate() {
                            if wide.get(i).copied().unwrap_or(false) {
                                unquote_safe_ints(v);
                            }
                        }
                        row
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok((columns, rows, None))
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Vec<serde_json::Value>>, String> {
        self.query(sql).await.map(|(_, rows, _)| rows)
    }

    async fn exec(&self, sql: &str) -> Result<(), String> {
        self.raw(sql).await.map(|_| ())
    }
}

const WIDE_INT: [&str; 6] = ["Int64", "UInt64", "Int128", "UInt128", "Int256", "UInt256"];

fn unquote_safe_ints(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(s) if super::exact_number::is_exact_in_js(s) => {
            *value = super::exact_number::decimal(s);
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(unquote_safe_ints),
        serde_json::Value::Object(map) => map.values_mut().for_each(unquote_safe_ints),
        _ => {}
    }
}

fn percent(value: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", value.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| value.to_string())
}

#[async_trait]
impl DatabaseAdapter for ClickhouseAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.exec("SELECT 1").await
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SELECT name FROM system.databases ORDER BY name")
            .await?
            .iter()
            .map(|r| text(&r[0]))
            .collect())
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SELECT name FROM system.databases WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') ORDER BY name")
            .await?
            .iter()
            .map(|r| text(&r[0]))
            .collect())
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let db = schema.unwrap_or(&self.database);
        let sql = format!("SELECT database, name FROM system.tables WHERE database = {} AND NOT is_temporary AND name NOT LIKE '.inner%' AND engine NOT IN ('View', 'MaterializedView', 'LiveView') ORDER BY name", lit(db));
        Ok(self
            .rows(&sql)
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
        let db = schema.unwrap_or(&self.database);
        let engines = if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
            "IN"
        } else {
            "NOT IN"
        };
        let mut sql = format!("SELECT c.database, c.table, c.name, c.type FROM system.columns c JOIN system.tables t ON t.database = c.database AND t.name = c.table WHERE c.database = {} AND t.engine {engines} ('View', 'MaterializedView', 'LiveView')", lit(db));
        if let Some(t) = table {
            sql.push_str(&format!(" AND c.table = {}", lit(t)));
        }
        sql.push_str(" ORDER BY c.table, c.position");
        Ok(self
            .rows(&sql)
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
        let select = if columns.is_empty() {
            "*".to_string()
        } else {
            columns
                .iter()
                .map(|c| quote(c))
                .collect::<Vec<_>>()
                .join(", ")
        };
        let sql = format!(
            "SELECT {select} FROM {}.{}{}{} LIMIT {} OFFSET {}",
            quote(schema),
            quote(table),
            where_sql,
            order_sql,
            limit.max(0),
            offset.max(0)
        );
        let (cols, rows, _) = self.query(&sql).await?;
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
            "SELECT count() FROM {}.{}{}",
            quote(schema),
            quote(table),
            where_clause(filter, allow_raw_filter)?
        );
        Ok(self
            .rows(&sql)
            .await?
            .first()
            .map(|r| int(&r[0]))
            .unwrap_or(0))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let (columns, rows, written) = self.query(sql).await?;
        Ok(QueryResult {
            rows: rows_to_objects(&columns, rows),
            rows_affected: if columns.is_empty() { written } else { None },
            columns,
            execution_time_ms: start.elapsed().as_millis() as u64,
            truncated: false,
        })
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let db = schema.unwrap_or(&self.database);
        let sql = format!("SELECT database, name FROM system.tables WHERE database = {} AND engine IN ('View', 'MaterializedView', 'LiveView') ORDER BY name", lit(db));
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: text(&r[0]),
                name: text(&r[1]),
            })
            .collect())
    }

    async fn table_comment(&self, schema: &str, table: &str) -> Result<Option<String>, String> {
        let sql = format!(
            "SELECT comment FROM system.tables WHERE database = {} AND name = {}",
            lit(schema),
            lit(table)
        );
        Ok(self.rows(&sql).await?.first().and_then(|r| text_opt(&r[0])))
    }

    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let sql = format!(
            "SELECT create_table_query FROM system.tables WHERE database = {} AND name = {}",
            lit(schema),
            lit(view)
        );
        self.rows(&sql)
            .await?
            .first()
            .map(|r| text(&r[0]))
            .ok_or_else(|| "View nicht gefunden".to_string())
    }

    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, String> {
        let sql = format!(
            "SELECT create_table_query FROM system.tables WHERE database = {} AND name = {}",
            lit(schema),
            lit(table)
        );
        self.rows(&sql)
            .await?
            .first()
            .map(|r| format!("{};\n", text(&r[0])))
            .ok_or_else(|| "Tabelle nicht gefunden".to_string())
    }

    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String> {
        if dry_run {
            return self.exec(&format!("EXPLAIN SYNTAX {body}")).await;
        }
        self.exec(&format!(
            "CREATE OR REPLACE VIEW {}.{} AS {}",
            quote(schema),
            quote(view),
            body
        ))
        .await
    }

    async fn list_functions(&self, _schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let rows = match self.rows("SELECT name, origin, create_query FROM system.functions WHERE origin != 'System' ORDER BY name").await {
            Ok(rows) => rows,
            Err(_) => return Ok(vec![]),
        };
        Ok(rows
            .iter()
            .map(|r| FunctionInfo {
                schema: self.database.clone(),
                name: text(&r[0]),
                identity_args: String::new(),
                return_type: String::new(),
                language: text(&r[1]),
                oid: text(&r[0]),
            })
            .collect())
    }

    async fn get_function_definition(&self, oid: &str) -> Result<String, String> {
        let rows = self
            .rows(&format!(
                "SELECT create_query FROM system.functions WHERE name = {}",
                lit(oid)
            ))
            .await?;
        rows.first()
            .map(|r| text(&r[0]))
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
        let sql = format!("SELECT name, type, default_expression, is_in_primary_key, position, comment FROM system.columns WHERE database = {} AND table = {} ORDER BY position", lit(schema), lit(table));
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| DetailedColumnInfo {
                name: text(&r[0]),
                is_nullable: text(&r[1]).starts_with("Nullable("),
                data_type: text(&r[1]),
                column_default: text_opt(&r[2]),
                is_primary_key: int(&r[3]) == 1,
                ordinal_position: int(&r[4]) as i32,
                character_maximum_length: None,
                comment: text_opt(&r[5]),
            })
            .collect())
    }

    async fn add_column(
        &self,
        schema: &str,
        table: &str,
        column: &AddColumnRequest,
    ) -> Result<(), String> {
        let data_type = if column.is_nullable && !column.data_type.starts_with("Nullable(") {
            format!("Nullable({})", column.data_type)
        } else {
            column.data_type.clone()
        };
        let mut sql = format!(
            "ALTER TABLE {}.{} ADD COLUMN {} {}",
            quote(schema),
            quote(table),
            quote(&column.name),
            data_type
        );
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
        let target = format!("{}.{}", quote(schema), quote(table));
        if let Some(data_type) = changes.data_type.as_deref().filter(|t| !t.is_empty()) {
            self.exec(&format!(
                "ALTER TABLE {target} MODIFY COLUMN {} {data_type}",
                quote(&changes.old_name)
            ))
            .await?;
        }
        if changes.drop_default {
            self.exec(&format!(
                "ALTER TABLE {target} MODIFY COLUMN {} REMOVE DEFAULT",
                quote(&changes.old_name)
            ))
            .await?;
        } else if let Some(d) = changes.new_default.as_deref().filter(|d| !d.is_empty()) {
            self.exec(&format!(
                "ALTER TABLE {target} MODIFY COLUMN {} DEFAULT {d}",
                quote(&changes.old_name)
            ))
            .await?;
        }
        if let Some(new_name) = changes
            .new_name
            .as_deref()
            .filter(|n| !n.is_empty() && *n != changes.old_name)
        {
            self.exec(&format!(
                "ALTER TABLE {target} RENAME COLUMN {} TO {}",
                quote(&changes.old_name),
                quote(new_name)
            ))
            .await?;
        }
        Ok(())
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

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        let sql = self.create_table_sql(req);
        self.exec(&sql).await
    }

    async fn preview_create_table_ddl(&self, req: &CreateTableRequest) -> Result<String, String> {
        Ok(self.create_table_sql(req))
    }

    async fn explain_query(&self, sql: &str, analyze: bool) -> Result<serde_json::Value, String> {
        let rows = self
            .rows(&format!("EXPLAIN json = 1, indexes = 1 {sql}"))
            .await?;
        let lines: Vec<String> = rows.iter().map(|r| text(&r[0])).collect();
        let mut plan = serde_json::from_str::<serde_json::Value>(&lines.join("\n"))
            .unwrap_or_else(|_| serde_json::Value::String(lines.join("\n")));
        if !analyze {
            return Ok(plan);
        }
        let trimmed = sql.trim().trim_end_matches(';');
        let run = if trimmed.to_ascii_uppercase().contains(" FORMAT ") {
            trimmed.to_string()
        } else {
            format!("{trimmed} FORMAT Null")
        };
        let start = std::time::Instant::now();
        let (_, summary) = self.raw_with(&run, &[("wait_end_of_query", "1")]).await?;
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        let stat = |key: &str| summary.as_ref().map(|s| int(&s[key])).unwrap_or(0);
        let elapsed_ms = match stat("elapsed_ns") {
            0 => ms,
            ns => ns as f64 / 1_000_000.0,
        };
        if let Some(root) = plan.get_mut(0).and_then(|p| p.get_mut("Plan")) {
            if let Some(obj) = root.as_object_mut() {
                obj.insert("Actual Rows".into(), stat("result_rows").into());
                obj.insert("Plan Rows".into(), stat("read_rows").into());
                obj.insert("Actual Total Time".into(), elapsed_ms.into());
                obj.insert("Actual Startup Time".into(), 0.0.into());
                obj.insert("Read Rows".into(), stat("read_rows").into());
                obj.insert("Read Bytes".into(), stat("read_bytes").into());
                obj.insert("Memory Usage".into(), stat("memory_usage").into());
            }
        }
        if let Some(entry) = plan.get_mut(0).and_then(|p| p.as_object_mut()) {
            entry.insert("Execution Time".into(), elapsed_ms.into());
            entry.insert("Planning Time".into(), 0.0.into());
        }
        Ok(plan)
    }

    async fn create_schema(&self, name: &str) -> Result<(), String> {
        self.exec(&format!("CREATE DATABASE {}", quote(name))).await
    }

    async fn drop_schema(&self, name: &str, _cascade: bool) -> Result<(), String> {
        self.exec(&format!("DROP DATABASE {}", quote(name))).await
    }

    async fn get_database_overview(&self) -> Result<DatabaseOverview, String> {
        let rows = self
            .rows("SELECT database, count(), sum(total_bytes) FROM system.tables WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') AND name NOT LIKE '.inner%' GROUP BY database ORDER BY database")
            .await?;
        let schemas: Vec<SchemaSize> = rows
            .iter()
            .map(|r| SchemaSize {
                schema: text(&r[0]),
                table_count: int(&r[1]),
                size_bytes: int(&r[2]),
            })
            .collect();
        let size_bytes = schemas
            .iter()
            .filter(|s| s.schema == self.database)
            .map(|s| s.size_bytes)
            .sum();
        Ok(DatabaseOverview {
            database: self.database.clone(),
            size_bytes,
            size_pretty: super::pretty_bytes(size_bytes),
            schemas,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unquotes_only_exact_wide_values() {
        let mut value = serde_json::json!([
            "42",
            "12.50",
            "9007199254740993",
            "12345678901234567890.12345",
            "abc"
        ]);
        unquote_safe_ints(&mut value);
        assert_eq!(
            value,
            serde_json::json!([
                42,
                12.5,
                "9007199254740993",
                "12345678901234567890.12345",
                "abc"
            ])
        );
    }

    #[test]
    fn builds_http_base() {
        let a = ClickhouseAdapter::new(
            "clickhouse://analyst:pw@ch.example.com:8443/events?secure=1",
            None,
        )
        .unwrap();
        assert_eq!(a.base, "https://ch.example.com:8443/");
        assert_eq!(a.database, "events");
        let b = ClickhouseAdapter::new("clickhouse://localhost", Some("other")).unwrap();
        assert_eq!(b.base, "http://localhost:8123/");
        assert_eq!(b.user, "default");
        assert_eq!(b.database, "other");
    }

    #[test]
    fn quote_escapes_backslashes_and_backticks() {
        assert_eq!(quote("plain"), "`plain`");
        assert_eq!(quote("a`b"), "`a\\`b`");
        assert_eq!(quote("x\\"), "`x\\\\`");
        assert_eq!(
            quote("x\\`; DROP TABLE t; --"),
            "`x\\\\\\`; DROP TABLE t; --`"
        );
        assert_eq!(
            super::super::import::Dialect::Clickhouse.quote("x\\`y"),
            quote("x\\`y")
        );
    }

    type Seen = std::sync::Arc<std::sync::Mutex<Vec<String>>>;

    async fn slow_server(delay: std::time::Duration) -> (String, Seen) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Seen::default();
        let log = seen.clone();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let log = log.clone();
                tokio::spawn(async move {
                    let mut request = Vec::new();
                    let mut buf = [0u8; 4096];
                    loop {
                        let n = socket.read(&mut buf).await.unwrap_or(0);
                        request.extend_from_slice(&buf[..n]);
                        let text = String::from_utf8_lossy(&request).to_string();
                        let Some((head, body)) = text.split_once("\r\n\r\n") else {
                            if n == 0 {
                                return;
                            }
                            continue;
                        };
                        let length = head
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                            })
                            .unwrap_or(0);
                        if body.len() < length && n > 0 {
                            continue;
                        }
                        let line = head.lines().next().unwrap_or("").to_string();
                        log.lock().unwrap().push(format!("{line} {body}"));
                        if !body.starts_with("KILL") {
                            tokio::time::sleep(delay).await;
                        }
                        break;
                    }
                    let _ = socket
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                        )
                        .await;
                });
            }
        });
        (format!("http://{addr}/"), seen)
    }

    async fn raw_with_options(
        url: &str,
        options: super::super::execution::ExecutionOptions,
    ) -> Result<String, String> {
        let adapter = ClickhouseAdapter::new(url, None).unwrap();
        super::super::execution::run(Some(options), true, async {
            adapter.raw("SELECT 1").await.map(|(body, _)| body)
        })
        .await
    }

    async fn raw_with_timeout(url: &str, seconds: u64) -> Result<String, String> {
        raw_with_options(
            url,
            super::super::execution::ExecutionOptions {
                query_timeout: Some(seconds),
                ..Default::default()
            },
        )
        .await
    }

    fn killed_query_id(seen: &Seen) -> bool {
        let seen = seen.lock().unwrap();
        let id = seen
            .iter()
            .find_map(|r| r.split("query_id=").nth(1))
            .and_then(|rest| rest.split('&').next())
            .unwrap_or("missing");
        seen.iter()
            .any(|r| r.contains(&format!("KILL QUERY WHERE query_id = '{id}' ASYNC")))
    }

    #[tokio::test]
    async fn http_timeout_follows_each_query_timeout() {
        let (slow, seen) = slow_server(std::time::Duration::from_secs(7)).await;
        let started = std::time::Instant::now();
        let short = raw_with_timeout(&slow, 5).await;
        assert!(short.unwrap_err().contains("Query-Timeout"));
        assert!(started.elapsed() < std::time::Duration::from_millis(6500));
        assert!(killed_query_id(&seen));
        let (medium, seen) = slow_server(std::time::Duration::from_secs(6)).await;
        assert_eq!(raw_with_timeout(&medium, 8).await.unwrap(), "ok");
        assert!(!seen.lock().unwrap().iter().any(|r| r.contains("KILL")));
    }

    #[tokio::test]
    async fn cancelling_a_job_kills_its_server_query() {
        let (slow, seen) = slow_server(std::time::Duration::from_secs(30)).await;
        let job = format!("clickhouse-cancel-{:x}", rand::random::<u64>());
        let cancel = {
            let job = job.clone();
            async move {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                super::super::execution::cancel(&job)
            }
        };
        let started = std::time::Instant::now();
        let (result, cancelled) = tokio::join!(
            raw_with_options(
                &slow,
                super::super::execution::ExecutionOptions {
                    job_id: Some(job),
                    ..Default::default()
                },
            ),
            cancel
        );
        assert_eq!(cancelled, Ok(true));
        assert!(result.unwrap_err().contains("abgebrochen"));
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        assert!(killed_query_id(&seen));
    }
}
