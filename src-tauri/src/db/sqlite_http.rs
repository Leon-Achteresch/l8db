use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use async_trait::async_trait;
use base64::Engine;
use serde_json::{json, Value};

use super::http_api::{self, text};
use super::sqlite::quote;
use super::{
    create_table_ddl, rows_to_objects, split_statements, where_clause, AddColumnRequest,
    ColumnInfo, CreateTableRequest, DatabaseAdapter, DetailedColumnInfo, ForeignKeyInfo, IndexInfo,
    QueryResult, TableData, TableInfo, TriggerInfo, TxSession,
};

fn visible(alias: &str) -> String {
    ["sqlite_%", "_cf_%", "libsql_%"]
        .iter()
        .map(|p| format!("{alias}name NOT LIKE '{p}'"))
        .collect::<Vec<_>>()
        .join(" AND ")
}

#[derive(Clone, Debug, PartialEq)]
enum Backend {
    D1 {
        api: String,
        account: String,
        database: Option<String>,
    },
    Libsql {
        base: String,
    },
}

#[derive(Clone)]
pub struct SqliteHttpAdapter {
    backend: Backend,
    token: String,
    insecure: bool,
}

#[derive(Debug, Default)]
struct Outcome {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    changes: Option<u64>,
}

fn d1_ids() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.chars().enumerate().all(|(i, c)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        Value::String(s) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

fn hrana_value(value: &Value) -> Value {
    match value["type"].as_str() {
        Some("integer") => {
            let raw = text(&value["value"]);
            match raw.parse::<i64>() {
                Ok(n) if n.unsigned_abs() <= (1u64 << 53) => Value::from(n),
                _ => Value::String(raw),
            }
        }
        Some("float") => value["value"].clone(),
        Some("text") => value["value"].clone(),
        Some("blob") => base64::engine::general_purpose::STANDARD_NO_PAD
            .decode(text(&value["base64"]).trim_end_matches('='))
            .map(|bytes| Value::String(super::hex_blob(&bytes)))
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn hrana_outcome(result: &Value) -> Outcome {
    let columns = result["cols"]
        .as_array()
        .map(|c| c.iter().map(|c| text(&c["name"])).collect())
        .unwrap_or_default();
    let rows = result["rows"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .map(|r| {
                    r.as_array()
                        .map(|cells| cells.iter().map(hrana_value).collect())
                        .unwrap_or_default()
                })
                .collect()
        })
        .unwrap_or_default();
    Outcome {
        columns,
        rows,
        changes: result["affected_row_count"].as_u64(),
    }
}

fn d1_outcome(result: &Value) -> Outcome {
    let inner = &result["results"];
    let columns = inner["columns"]
        .as_array()
        .map(|c| c.iter().map(text).collect())
        .unwrap_or_default();
    let rows = inner["rows"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .map(|r| r.as_array().cloned().unwrap_or_default())
                .collect()
        })
        .unwrap_or_default();
    Outcome {
        columns,
        rows,
        changes: result.pointer("/meta/changes").and_then(Value::as_u64),
    }
}

fn pipeline_body(statements: &[String]) -> Value {
    let steps: Vec<Value> = statements
        .iter()
        .enumerate()
        .map(|(i, sql)| {
            let mut step = json!({"stmt": {"sql": sql, "want_rows": true}});
            if i > 0 {
                step["condition"] = json!({"type": "ok", "step": i - 1});
            }
            step
        })
        .collect();
    json!({"requests": [
        {"type": "batch", "batch": {"steps": steps}},
        {"type": "close"}
    ]})
}

fn pipeline_outcomes(value: &Value) -> Result<Vec<Outcome>, String> {
    let first = &value["results"][0];
    if first["type"] == "error" {
        return Err(format!("libSQL: {}", text(&first["error"]["message"])));
    }
    let result = &first["response"]["result"];
    if let Some(error) = result["step_errors"]
        .as_array()
        .and_then(|e| e.iter().find(|e| !e.is_null()))
    {
        return Err(format!("libSQL: {}", text(&error["message"])));
    }
    Ok(result["step_results"]
        .as_array()
        .map(|steps| {
            steps
                .iter()
                .filter(|s| !s.is_null())
                .map(hrana_outcome)
                .collect()
        })
        .unwrap_or_default())
}

impl SqliteHttpAdapter {
    pub fn new(connection_string: &str, database: Option<&str>) -> Result<Self, String> {
        let url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige URL (d1:// oder libsql://)".to_string())?;
        let token = http_api::param(&url, &["authToken", "auth_token", "token", "api_token"])
            .unwrap_or_else(|| http_api::decode(url.password().unwrap_or("")));
        match url.scheme() {
            "d1" => {
                let host = url.host_str().unwrap_or("api.cloudflare.com");
                let tls = http_api::tls(&url, true);
                let api = if host.eq_ignore_ascii_case("api.cloudflare.com") && url.port().is_none()
                {
                    "https://api.cloudflare.com/client/v4".to_string()
                } else {
                    format!("{}/client/v4", http_api::base_url(&url, tls.secure, None)?)
                };
                let account = http_api::param(&url, &["account_id", "account"])
                    .unwrap_or_else(|| http_api::decode(url.username()));
                if account.is_empty() {
                    return Err("Die Cloudflare-Account-ID fehlt (Benutzer der URL).".into());
                }
                let path_db = http_api::decode(url.path().trim_matches('/'));
                let database = database
                    .filter(|d| !d.is_empty() && *d != "main")
                    .map(str::to_string)
                    .or(Some(path_db).filter(|d| !d.is_empty()));
                Ok(Self {
                    backend: Backend::D1 {
                        api,
                        account,
                        database,
                    },
                    token,
                    insecure: tls.insecure,
                })
            }
            "libsql" | "http" | "https" => {
                let tls = http_api::tls(&url, url.scheme() != "http");
                Ok(Self {
                    backend: Backend::Libsql {
                        base: http_api::base_url(&url, tls.secure, None)?,
                    },
                    token,
                    insecure: tls.insecure,
                })
            }
            _ => Err("Eine d1:// oder libsql:// URL ist erforderlich".into()),
        }
    }

    fn label(&self) -> &'static str {
        match self.backend {
            Backend::D1 { .. } => "Cloudflare D1",
            Backend::Libsql { .. } => "libSQL",
        }
    }

    fn request(&self, method: reqwest::Method, url: String) -> reqwest::RequestBuilder {
        let request = http_api::client(self.insecure).request(method, url);
        if self.token.is_empty() {
            request
        } else {
            request.bearer_auth(&self.token)
        }
    }

    async fn call(&self, request: reqwest::RequestBuilder) -> Result<Value, String> {
        let reply = http_api::send(self.label(), request).await?;
        let value = reply.json();
        let failed = value
            .as_ref()
            .and_then(|v| v.get("success"))
            .is_some_and(|s| s == &json!(false));
        if !reply.ok() || failed {
            return Err(format!(
                "{} {}: {}",
                self.label(),
                reply.status,
                http_api::error_message(&reply.body)
            ));
        }
        value.ok_or_else(|| format!("{}: Antwort ist kein JSON", self.label()))
    }

    async fn d1_list(&self) -> Result<Vec<(String, String)>, String> {
        let Backend::D1 { api, account, .. } = &self.backend else {
            return Ok(vec![]);
        };
        let mut out = Vec::new();
        for page in 1..=50 {
            let value = self
                .call(self.request(
                    reqwest::Method::GET,
                    format!("{api}/accounts/{account}/d1/database?per_page=100&page={page}"),
                ))
                .await?;
            let batch = value["result"].as_array().cloned().unwrap_or_default();
            out.extend(batch.iter().map(|d| (text(&d["name"]), text(&d["uuid"]))));
            let total = value
                .pointer("/result_info/total_count")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            if batch.len() < 100 || out.len() >= total {
                break;
            }
        }
        if let Ok(mut cache) = d1_ids().lock() {
            for (name, uuid) in &out {
                cache.insert(format!("{account}#{name}"), uuid.clone());
            }
        }
        Ok(out)
    }

    async fn d1_uuid(&self) -> Result<String, String> {
        let Backend::D1 {
            account, database, ..
        } = &self.backend
        else {
            return Err("Keine D1-Verbindung".into());
        };
        match database {
            Some(db) if is_uuid(db) => return Ok(db.clone()),
            Some(db) => {
                if let Some(uuid) = d1_ids()
                    .lock()
                    .ok()
                    .and_then(|c| c.get(&format!("{account}#{db}")).cloned())
                {
                    return Ok(uuid);
                }
            }
            None => {}
        }
        let list = self.d1_list().await?;
        match database {
            Some(db) => list
                .into_iter()
                .find(|(name, _)| name == db)
                .map(|(_, uuid)| uuid)
                .ok_or_else(|| format!("D1-Datenbank '{db}' nicht gefunden")),
            None => list
                .into_iter()
                .next()
                .map(|(_, uuid)| uuid)
                .ok_or_else(|| "Keine D1-Datenbank im Account gefunden".to_string()),
        }
    }

    async fn run(&self, sql: &str) -> Result<Vec<Outcome>, String> {
        match &self.backend {
            Backend::D1 { api, account, .. } => {
                let uuid = self.d1_uuid().await?;
                let value = self
                    .call(
                        self.request(
                            reqwest::Method::POST,
                            format!("{api}/accounts/{account}/d1/database/{uuid}/raw"),
                        )
                        .json(&json!({"sql": sql})),
                    )
                    .await?;
                Ok(value["result"]
                    .as_array()
                    .map(|r| r.iter().map(d1_outcome).collect())
                    .unwrap_or_default())
            }
            Backend::Libsql { base } => {
                let statements = split_statements(sql);
                if statements.is_empty() {
                    return Ok(vec![]);
                }
                let value = self
                    .call(
                        self.request(reqwest::Method::POST, format!("{base}/v2/pipeline"))
                            .json(&pipeline_body(&statements)),
                    )
                    .await?;
                pipeline_outcomes(&value)
            }
        }
    }

    async fn query(&self, sql: &str) -> Result<Outcome, String> {
        let mut outcomes = self.run(sql).await?;
        let changes = outcomes.iter().filter_map(|o| o.changes).sum::<u64>();
        let position = outcomes.iter().rposition(|o| !o.columns.is_empty());
        Ok(match position {
            Some(i) => outcomes.swap_remove(i),
            None => Outcome {
                changes: Some(changes),
                ..Default::default()
            },
        })
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Vec<Value>>, String> {
        Ok(self.query(sql).await?.rows)
    }

    async fn names(&self, sql: &str) -> Result<Vec<String>, String> {
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| r.first().map(text).unwrap_or_default())
            .collect())
    }

    async fn exec(&self, sql: &str) -> Result<(), String> {
        self.run(sql).await.map(|_| ())
    }

    async fn table_info(&self, table: &str) -> Result<Vec<DetailedColumnInfo>, String> {
        Ok(self
            .rows(&format!("PRAGMA table_info({})", quote(table)))
            .await?
            .iter()
            .map(|r| DetailedColumnInfo {
                name: text(&r[1]),
                data_type: text(&r[2]),
                is_nullable: !truthy(&r[3]),
                column_default: r.get(4).filter(|v| !v.is_null()).map(text),
                is_primary_key: truthy(&r[5]),
                ordinal_position: r[0].as_i64().unwrap_or(0) as i32 + 1,
                character_maximum_length: None,
                comment: None,
            })
            .collect())
    }

    async fn objects(&self, kind: &str) -> Result<Vec<String>, String> {
        self.names(&format!(
            "SELECT name FROM sqlite_master WHERE type = '{kind}' AND {} ORDER BY name",
            visible("")
        ))
        .await
    }
}

struct AutoCommit {
    adapter: SqliteHttpAdapter,
}

#[async_trait]
impl TxSession for AutoCommit {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        self.adapter.execute_query(sql).await
    }

    async fn commit(&mut self) -> Result<(), String> {
        Ok(())
    }

    async fn rollback(&mut self) -> Result<(), String> {
        Err("Über HTTP werden Änderungen sofort übernommen, ein Rollback ist nicht möglich.".into())
    }
}

#[async_trait]
impl DatabaseAdapter for SqliteHttpAdapter {
    async fn begin_transaction(&self) -> Result<Box<dyn TxSession>, String> {
        Ok(Box::new(AutoCommit {
            adapter: self.clone(),
        }))
    }

    async fn test_connection(&self) -> Result<(), String> {
        self.exec("SELECT 1").await
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        match &self.backend {
            Backend::D1 { .. } => Ok(self.d1_list().await?.into_iter().map(|(n, _)| n).collect()),
            Backend::Libsql { .. } => Ok(vec!["main".to_string()]),
        }
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(vec!["main".to_string()])
    }

    async fn list_tables(&self, _schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        Ok(self
            .objects("table")
            .await?
            .into_iter()
            .map(|name| TableInfo {
                schema: "main".into(),
                name,
            })
            .collect())
    }

    async fn list_columns(
        &self,
        _schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let kind = if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
            "view"
        } else {
            "table"
        };
        if let Some(table) = table {
            return Ok(self
                .table_info(table)
                .await?
                .into_iter()
                .map(|c| ColumnInfo {
                    schema: "main".into(),
                    table: table.to_string(),
                    name: c.name,
                    data_type: c.data_type,
                })
                .collect());
        }
        let joined = format!(
            "SELECT m.name, p.name, p.type FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = '{kind}' AND {} ORDER BY m.name, p.cid",
            visible("m.")
        );
        match self.rows(&joined).await {
            Ok(rows) => Ok(rows
                .iter()
                .map(|r| ColumnInfo {
                    schema: "main".into(),
                    table: text(&r[0]),
                    name: text(&r[1]),
                    data_type: text(&r[2]),
                })
                .collect()),
            Err(_) => {
                let mut out = Vec::new();
                for table in self.objects(kind).await? {
                    out.extend(
                        self.table_info(&table)
                            .await?
                            .into_iter()
                            .map(|c| ColumnInfo {
                                schema: "main".into(),
                                table: table.clone(),
                                name: c.name,
                                data_type: c.data_type,
                            }),
                    );
                }
                Ok(out)
            }
        }
    }

    async fn fetch_rows(
        &self,
        _schema: &str,
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
        let detailed = self.table_info(table).await?;
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
        let outcome = self
            .query(&format!(
                "SELECT * FROM {}{where_sql}{order_sql} LIMIT {} OFFSET {}",
                quote(table),
                limit.max(0),
                offset.max(0)
            ))
            .await?;
        let mut rows = rows_to_objects(&outcome.columns, outcome.rows);
        super::attach_row_keys(&mut rows, &pk);
        Ok(TableData {
            columns: if columns.is_empty() {
                outcome.columns
            } else {
                columns
            },
            rows,
        })
    }

    async fn count_rows(
        &self,
        _schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let rows = self
            .rows(&format!(
                "SELECT COUNT(*) FROM {}{}",
                quote(table),
                where_clause(filter, allow_raw_filter)?
            ))
            .await?;
        Ok(rows
            .first()
            .and_then(|r| r.first())
            .map(|v| v.as_i64().unwrap_or_else(|| text(v).parse().unwrap_or(0)))
            .unwrap_or(0))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let outcome = self.query(sql.trim()).await?;
        let columns = super::unique_column_names(outcome.columns);
        Ok(QueryResult {
            rows_affected: if columns.is_empty() {
                outcome.changes
            } else {
                None
            },
            rows: rows_to_objects(&columns, outcome.rows),
            columns,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn list_views(&self, _schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        Ok(self
            .objects("view")
            .await?
            .into_iter()
            .map(|name| TableInfo {
                schema: "main".into(),
                name,
            })
            .collect())
    }

    async fn get_view_definition(&self, _schema: &str, view: &str) -> Result<String, String> {
        self.names(&format!(
            "SELECT sql FROM sqlite_master WHERE type = 'view' AND name = {}",
            lit(view)
        ))
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "View nicht gefunden".to_string())
    }

    async fn get_table_ddl(&self, _schema: &str, table: &str) -> Result<String, String> {
        let statements = self
            .names(&format!(
                "SELECT sql FROM sqlite_master WHERE tbl_name = {} AND type IN ('table', 'index', 'trigger') AND sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name",
                lit(table)
            ))
            .await?;
        if statements.is_empty() {
            return Err("Tabelle nicht gefunden".to_string());
        }
        Ok(statements
            .iter()
            .map(|s| format!("{s};\n"))
            .collect::<Vec<_>>()
            .join("\n"))
    }

    async fn drop_table(&self, _schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!("DROP TABLE {}", quote(table))).await
    }

    async fn truncate_table(&self, _schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!("DELETE FROM {}", quote(table))).await
    }

    async fn list_table_columns_detailed(
        &self,
        _schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        self.table_info(table).await
    }

    async fn add_column(
        &self,
        _schema: &str,
        table: &str,
        column: &AddColumnRequest,
    ) -> Result<(), String> {
        let mut sql = format!(
            "ALTER TABLE {} ADD COLUMN {} {}",
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

    async fn drop_column(&self, _schema: &str, table: &str, column: &str) -> Result<(), String> {
        self.exec(&format!(
            "ALTER TABLE {} DROP COLUMN {}",
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
        Ok(self
            .rows(&format!("PRAGMA foreign_key_list({})", quote(table)))
            .await?
            .iter()
            .map(|r| ForeignKeyInfo {
                constraint_name: format!("fk_{}_{}", table, text(&r[0])),
                from_schema: schema.to_string(),
                from_table: table.to_string(),
                from_column: text(&r[3]),
                to_schema: schema.to_string(),
                to_table: text(&r[2]),
                to_column: text(&r[4]),
            })
            .collect())
    }

    async fn list_triggers(&self, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
        let rows = self
            .rows(&format!(
                "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = {} ORDER BY name",
                lit(table)
            ))
            .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let definition = text(&r[1]);
                let upper = definition.to_uppercase();
                let timing = if upper.contains("INSTEAD OF") {
                    "INSTEAD OF"
                } else if upper.contains(" BEFORE ") {
                    "BEFORE"
                } else {
                    "AFTER"
                };
                let event = ["INSERT", "UPDATE", "DELETE"]
                    .iter()
                    .find(|e| {
                        upper.contains(&format!(" {e} ")) || upper.contains(&format!(" {e} OF"))
                    })
                    .unwrap_or(&"UNKNOWN");
                TriggerInfo {
                    trigger_name: text(&r[0]),
                    table_schema: schema.to_string(),
                    table_name: table.to_string(),
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
    }

    async fn list_indexes(&self, _schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let list = self
            .rows(&format!("PRAGMA index_list({})", quote(table)))
            .await?;
        let definitions: HashMap<String, String> = self
            .rows(&format!(
                "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = {}",
                lit(table)
            ))
            .await?
            .iter()
            .map(|r| (text(&r[0]), text(&r[1])))
            .collect();
        let mut out = Vec::new();
        for r in list {
            let name = text(&r[1]);
            let columns = self
                .rows(&format!("PRAGMA index_info({})", quote(&name)))
                .await?
                .iter()
                .map(|i| text(&i[2]))
                .collect();
            out.push(IndexInfo {
                is_unique: truthy(&r[2]),
                is_primary: text(&r[3]) == "pk",
                columns,
                index_type: "btree".to_string(),
                definition: definitions.get(&name).cloned().unwrap_or_default(),
                name,
            });
        }
        Ok(out)
    }

    async fn preview_create_table_ddl(&self, req: &CreateTableRequest) -> Result<String, String> {
        create_table_ddl(
            req,
            quote,
            false,
            Some(super::constraints::ConstraintDialect::Sqlite),
        )
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        let sql = create_table_ddl(
            req,
            quote,
            false,
            Some(super::constraints::ConstraintDialect::Sqlite),
        )?;
        self.exec(&sql).await
    }

    async fn explain_query(&self, sql: &str, _analyze: bool) -> Result<Value, String> {
        let outcome = self.query(&format!("EXPLAIN QUERY PLAN {sql}")).await?;
        Ok(Value::Array(rows_to_objects(
            &outcome.columns,
            outcome.rows,
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::http_api::mock;

    #[test]
    fn parses_d1_and_libsql_urls() {
        let d1 =
            SqliteHttpAdapter::new("d1://acc123:tok%2Fen@api.cloudflare.com/shop", None).unwrap();
        assert_eq!(
            d1.backend,
            Backend::D1 {
                api: "https://api.cloudflare.com/client/v4".into(),
                account: "acc123".into(),
                database: Some("shop".into())
            }
        );
        assert_eq!(d1.token, "tok/en");
        let other =
            SqliteHttpAdapter::new("d1://acc123:t@api.cloudflare.com/shop", Some("main")).unwrap();
        assert!(matches!(other.backend, Backend::D1 { database: Some(ref d), .. } if d == "shop"));
        let turso = SqliteHttpAdapter::new("libsql://db-org.turso.io?authToken=abc", None).unwrap();
        assert_eq!(
            turso.backend,
            Backend::Libsql {
                base: "https://db-org.turso.io".into()
            }
        );
        assert_eq!(turso.token, "abc");
        let local = SqliteHttpAdapter::new("libsql://127.0.0.1:8080?tls=false", None).unwrap();
        assert_eq!(
            local.backend,
            Backend::Libsql {
                base: "http://127.0.0.1:8080".into()
            }
        );
        assert!(SqliteHttpAdapter::new("d1://api.cloudflare.com/x", None).is_err());
        assert!(is_uuid("0b2a8e7c-4a3c-4e0f-9f5c-2d7c3b1a9e11"));
        assert!(!is_uuid("shop"));
    }

    #[test]
    fn maps_hrana_values() {
        let outcomes = pipeline_outcomes(&json!({"results": [{"type": "ok", "response": {"type": "batch", "result": {
            "step_results": [{"cols": [{"name": "id"}, {"name": "f"}, {"name": "t"}, {"name": "b"}, {"name": "n"}],
                "rows": [[{"type": "integer", "value": "9007199254740993"}, {"type": "float", "value": 1.5}, {"type": "text", "value": "x"}, {"type": "blob", "base64": "AP8"}, {"type": "null"}]],
                "affected_row_count": 0}],
            "step_errors": [null]
        }}}, {"type": "ok", "response": {"type": "close"}}]}))
        .unwrap();
        assert_eq!(outcomes[0].columns, ["id", "f", "t", "b", "n"]);
        assert_eq!(
            outcomes[0].rows[0],
            vec![
                json!("9007199254740993"),
                json!(1.5),
                json!("x"),
                json!("\\x00ff"),
                Value::Null
            ]
        );
        let err = pipeline_outcomes(
            &json!({"results": [{"type": "ok", "response": {"type": "batch", "result": {
                "step_results": [null], "step_errors": [{"message": "no such table: x"}]
            }}}]}),
        )
        .unwrap_err();
        assert!(err.contains("no such table"));
        let body = pipeline_body(&["SELECT 1".into(), "SELECT 2".into()]);
        assert_eq!(
            body["requests"][0]["batch"]["steps"][1]["condition"]["step"],
            json!(0)
        );
    }

    fn d1_handler(request: &mock::Request) -> (u16, String) {
        let list = json!({"success": true, "errors": [], "result": [
            {"uuid": "0b2a8e7c-4a3c-4e0f-9f5c-2d7c3b1a9e11", "name": "shop"}
        ], "result_info": {"page": 1, "per_page": 100, "count": 1, "total_count": 1}});
        if request.method == "GET"
            && request
                .path
                .starts_with("/client/v4/accounts/acc/d1/database?")
        {
            return (200, list.to_string());
        }
        if request.path
            == "/client/v4/accounts/acc/d1/database/0b2a8e7c-4a3c-4e0f-9f5c-2d7c3b1a9e11/raw"
        {
            let sql = request.json()["sql"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            if sql.contains("broken") {
                return (400, json!({"success": false, "errors": [{"code": 7500, "message": "near \"broken\": syntax error"}], "result": []}).to_string());
            }
            if sql.starts_with("PRAGMA table_info") {
                return (
                    200,
                    json!({"success": true, "errors": [], "result": [{"results": {
                    "columns": ["cid", "name", "type", "notnull", "dflt_value", "pk"],
                    "rows": [[0, "id", "INTEGER", 0, null, 1], [1, "name", "TEXT", 1, null, 0]]
                }, "success": true, "meta": {"changes": 0}}]})
                    .to_string(),
                );
            }
            if sql.starts_with("SELECT name FROM sqlite_master") {
                return (
                    200,
                    json!({"success": true, "errors": [], "result": [{"results": {
                    "columns": ["name"], "rows": [["users"]]
                }, "success": true, "meta": {}}]})
                    .to_string(),
                );
            }
            if sql.starts_with("UPDATE") {
                return (200, json!({"success": true, "errors": [], "result": [{"results": {"columns": [], "rows": []}, "success": true, "meta": {"changes": 2}}]}).to_string());
            }
            return (
                200,
                json!({"success": true, "errors": [], "result": [{"results": {
                "columns": ["id", "name"], "rows": [[1, "ada"], [2, "bob"]]
            }, "success": true, "meta": {"changes": 0}}]})
                .to_string(),
            );
        }
        (
            404,
            json!({"success": false, "errors": [{"code": 7003, "message": "not found"}]})
                .to_string(),
        )
    }

    #[tokio::test]
    async fn d1_requests_and_mapping_against_mock() {
        let (addr, log) = mock::serve(d1_handler).await;
        let url = format!("d1://acc:secret@{addr}/shop?tls=false");
        let adapter = SqliteHttpAdapter::new(&url, None).unwrap();
        assert_eq!(adapter.list_databases().await.unwrap(), ["shop"]);
        let tables = adapter.list_tables(None).await.unwrap();
        assert_eq!(tables[0].name, "users");
        let data = adapter
            .fetch_rows(
                "main",
                "users",
                Some("\"name\" <> 'x'"),
                10,
                0,
                Some("name"),
                true,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(data.columns, ["id", "name"]);
        assert_eq!(data.rows[0]["name"], json!("ada"));
        assert_eq!(data.rows[0]["__ctid__"], json!("{\"id\":1}"));
        let result = adapter
            .execute_query("UPDATE users SET name = 'x'")
            .await
            .unwrap();
        assert_eq!(result.rows_affected, Some(2));
        let error = adapter.execute_query("broken").await.unwrap_err();
        assert!(error.contains("syntax error"), "{error}");
        let requests = log.lock().unwrap().clone();
        assert!(requests
            .iter()
            .all(|r| r.header("authorization") == Some("Bearer secret")));
        let select = requests
            .iter()
            .find(|r| {
                r.json()["sql"]
                    .as_str()
                    .is_some_and(|s| s.starts_with("SELECT * FROM"))
            })
            .unwrap();
        assert_eq!(
            select.json()["sql"],
            json!("SELECT * FROM \"users\" WHERE \"name\" <> 'x' ORDER BY \"name\" DESC LIMIT 10 OFFSET 0")
        );
        assert_eq!(
            requests.iter().filter(|r| r.method == "GET").count(),
            1,
            "database name lookup is cached"
        );
    }

    #[tokio::test]
    async fn libsql_pipeline_against_mock() {
        let (addr, log) = mock::serve(|request: &mock::Request| {
            let steps = request.json()["requests"][0]["batch"]["steps"].as_array().cloned().unwrap_or_default();
            let results: Vec<Value> = steps
                .iter()
                .map(|_| json!({"cols": [{"name": "n", "decltype": "INTEGER"}], "rows": [[{"type": "integer", "value": "42"}]], "affected_row_count": 0}))
                .collect();
            let errors: Vec<Value> = steps.iter().map(|_| Value::Null).collect();
            (200, json!({"baton": null, "base_url": null, "results": [
                {"type": "ok", "response": {"type": "batch", "result": {"step_results": results, "step_errors": errors}}},
                {"type": "ok", "response": {"type": "close"}}
            ]}).to_string())
        })
        .await;
        let adapter =
            SqliteHttpAdapter::new(&format!("libsql://token:tk@{addr}?tls=false"), None).unwrap();
        let result = adapter
            .execute_query("SELECT 1; SELECT 42 AS n")
            .await
            .unwrap();
        assert_eq!(result.columns, ["n"]);
        assert_eq!(result.rows[0]["n"], json!(42));
        let requests = log.lock().unwrap().clone();
        assert_eq!(requests[0].path, "/v2/pipeline");
        assert_eq!(requests[0].header("authorization"), Some("Bearer tk"));
        assert_eq!(
            requests[0].json()["requests"][0]["batch"]["steps"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
}
