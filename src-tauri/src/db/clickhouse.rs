use std::sync::OnceLock;

use async_trait::async_trait;

use super::{
    rows_to_objects, timed, where_clause, AddColumnRequest, AlterColumnRequest, ColumnInfo,
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
    format!("`{}`", ident.replace('`', "\\`"))
}

fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
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

    async fn raw(&self, sql: &str) -> Result<(String, Option<serde_json::Value>), String> {
        timed(async {
            let response = http()
                .post(&self.base)
                .query(&[
                    ("database", self.database.as_str()),
                    ("default_format", "JSONCompact"),
                    ("output_format_json_quote_64bit_integers", "0"),
                ])
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
        })
        .await
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
        let columns: Vec<String> = parsed
            .get("meta")
            .and_then(|m| m.as_array())
            .map(|m| m.iter().map(|c| text(&c["name"])).collect())
            .unwrap_or_default();
        let rows: Vec<Vec<serde_json::Value>> = parsed
            .get("data")
            .and_then(|d| d.as_array())
            .map(|d| {
                d.iter()
                    .map(|r| r.as_array().cloned().unwrap_or_default())
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
        let sql = format!("SELECT database, name FROM system.tables WHERE database = {} AND NOT is_temporary AND engine NOT IN ('View', 'MaterializedView', 'LiveView') ORDER BY name", lit(db));
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
        let sql = format!(
            "SELECT * FROM {}.{}{}{} LIMIT {} OFFSET {}",
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
                schema: String::new(),
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
        let sql = format!("SELECT name, type, default_expression, is_in_primary_key, position FROM system.columns WHERE database = {} AND table = {} ORDER BY position", lit(schema), lit(table));
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
        let sql = format!(
            "CREATE TABLE {}{}.{} ({}) ENGINE = MergeTree ORDER BY {order}",
            if req.if_not_exists {
                "IF NOT EXISTS "
            } else {
                ""
            },
            quote(&req.schema),
            quote(&req.name),
            columns.join(", ")
        );
        self.exec(&sql).await
    }

    async fn explain_query(&self, sql: &str, analyze: bool) -> Result<serde_json::Value, String> {
        let keyword = if analyze {
            "EXPLAIN PIPELINE"
        } else {
            "EXPLAIN json = 1, indexes = 1"
        };
        let rows = self.rows(&format!("{keyword} {sql}")).await?;
        let lines: Vec<String> = rows.iter().map(|r| text(&r[0])).collect();
        if !analyze {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&lines.join("\n")) {
                return Ok(parsed);
            }
        }
        Ok(serde_json::Value::String(lines.join("\n")))
    }

    async fn create_schema(&self, name: &str) -> Result<(), String> {
        self.exec(&format!("CREATE DATABASE {}", quote(name))).await
    }

    async fn drop_schema(&self, name: &str, _cascade: bool) -> Result<(), String> {
        self.exec(&format!("DROP DATABASE {}", quote(name))).await
    }

    async fn get_database_overview(&self) -> Result<DatabaseOverview, String> {
        let rows = self
            .rows("SELECT database, count(), sum(total_bytes) FROM system.tables WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') GROUP BY database ORDER BY database")
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
}
