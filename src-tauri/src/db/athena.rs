use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde_json::{json, Value};

use super::aws::{self, quote_ident, AwsClient, AwsConnection, Service};
use super::server_output::{self, ServerMessage};
use super::{
    rows_to_objects, timed, where_clause, ColumnInfo, DatabaseAdapter, DetailedColumnInfo,
    QueryResult, TableData, TableInfo,
};

static SERVICE: Service = Service {
    label: "Athena",
    signing_name: "athena",
    host_prefix: "athena",
    target_prefix: "AmazonAthena",
    content_type: "application/x-amz-json-1.1",
};

const DEFAULT_CATALOG: &str = "AwsDataCatalog";
const USD_PER_TB: f64 = 5.0;
const MIN_BILLED_BYTES: i64 = 10 * 1024 * 1024;

pub struct AthenaAdapter {
    conn: AwsConnection,
    catalog: String,
    key: String,
}

pub struct AthenaResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub statement_type: String,
    pub scanned_bytes: i64,
    pub engine_ms: i64,
    pub query_id: String,
}

pub fn convert_value(data_type: &str, value: Option<&str>) -> Value {
    let Some(text) = value else {
        return Value::Null;
    };
    let base = data_type
        .split('(')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    match base.as_str() {
        "tinyint" | "smallint" | "integer" | "int" | "bigint" => text
            .parse::<i64>()
            .map(Value::from)
            .unwrap_or_else(|_| Value::String(text.to_string())),
        "float" | "real" | "double" => match text.parse::<f64>() {
            Ok(f) if f.is_finite() => Value::from(f),
            _ => Value::String(text.to_string()),
        },
        "boolean" => match text {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            other => Value::String(other.to_string()),
        },
        "json" => serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string())),
        _ => Value::String(text.to_string()),
    }
}

pub fn cost_notice(scanned_bytes: i64, engine_ms: i64, query_id: &str) -> String {
    let billed = scanned_bytes.max(MIN_BILLED_BYTES) as f64;
    let cost = billed / 1024f64.powi(4) * USD_PER_TB;
    format!(
        "Athena: {} gescannt, ca. {cost:.6} USD (5 USD/TB, mind. 10 MB), Engine {engine_ms} ms, Query-ID {query_id}",
        super::pretty_bytes(scanned_bytes)
    )
}

fn rows_of(page: &Value) -> Vec<Vec<Option<String>>> {
    page.get("ResultSet")
        .and_then(|r| r.get("Rows"))
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .map(|row| {
                    row.get("Data")
                        .and_then(Value::as_array)
                        .map(|cells| {
                            cells
                                .iter()
                                .map(|c| {
                                    c.get("VarCharValue")
                                        .and_then(Value::as_str)
                                        .map(str::to_string)
                                })
                                .collect()
                        })
                        .unwrap_or_default()
                })
                .collect()
        })
        .unwrap_or_default()
}

fn column_info(page: &Value) -> Vec<(String, String)> {
    page.get("ResultSet")
        .and_then(|r| r.get("ResultSetMetadata"))
        .and_then(|m| m.get("ColumnInfo"))
        .and_then(Value::as_array)
        .map(|cols| {
            cols.iter()
                .map(|c| {
                    (
                        c.get("Label")
                            .or_else(|| c.get("Name"))
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        c.get("Type")
                            .and_then(Value::as_str)
                            .unwrap_or("varchar")
                            .to_string(),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn table_columns(meta: &Value) -> Vec<DetailedColumnInfo> {
    let mut out = Vec::new();
    for (field, partition) in [("Columns", false), ("PartitionKeys", true)] {
        for column in meta
            .get(field)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let comment = column
                .get("Comment")
                .and_then(Value::as_str)
                .filter(|c| !c.is_empty())
                .map(str::to_string);
            out.push(DetailedColumnInfo {
                name: column
                    .get("Name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                data_type: column
                    .get("Type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                is_nullable: true,
                column_default: None,
                is_primary_key: false,
                ordinal_position: out.len() as i32 + 1,
                character_maximum_length: None,
                comment: if partition {
                    Some(match comment {
                        Some(c) => format!("Partitionsschlüssel · {c}"),
                        None => "Partitionsschlüssel".to_string(),
                    })
                } else {
                    comment
                },
            });
        }
    }
    out
}

impl AthenaAdapter {
    pub fn new(
        connection_string: &str,
        database: Option<&str>,
        key: String,
    ) -> Result<Self, String> {
        let conn = aws::parse_url(connection_string, "athena")?;
        let catalog = database
            .filter(|d| !d.is_empty())
            .map(str::to_string)
            .or_else(|| (!conn.path.is_empty()).then(|| conn.path.clone()))
            .unwrap_or_else(|| DEFAULT_CATALOG.to_string());
        Ok(Self { conn, catalog, key })
    }

    async fn client(&self) -> Result<AwsClient, String> {
        self.conn.client(&SERVICE).await
    }

    async fn paged(&self, action: &str, body: Value, field: &str) -> Result<Vec<Value>, String> {
        let client = self.client().await?;
        timed(async {
            let mut out = Vec::new();
            let mut token: Option<Value> = None;
            loop {
                let mut request = body.clone();
                if let Some(t) = &token {
                    request["NextToken"] = t.clone();
                }
                let response = client.call(action, &request).await?;
                out.extend(
                    response
                        .get(field)
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .cloned(),
                );
                token = response.get("NextToken").filter(|v| !v.is_null()).cloned();
                if token.is_none() || out.len() >= 10_000 {
                    break;
                }
            }
            Ok(out)
        })
        .await
    }

    fn default_schema(&self) -> String {
        self.conn.param("schema").unwrap_or("default").to_string()
    }

    async fn stop(client: &AwsClient, id: &str) -> String {
        match client
            .call("StopQueryExecution", &json!({ "QueryExecutionId": id }))
            .await
        {
            Ok(_) => String::new(),
            Err(e) => format!(" StopQueryExecution fehlgeschlagen: {e}"),
        }
    }

    pub async fn run(&self, sql: &str, max_rows: usize) -> Result<AthenaResult, String> {
        let client = self.client().await?;
        let cancel = super::execution::cancellation_token();
        if cancel.is_cancelled() {
            return Err("Abfrage abgebrochen, bevor sie gestartet wurde.".to_string());
        }
        let deadline = Instant::now() + super::execution::query_duration();
        let mut context = json!({ "Catalog": self.catalog });
        context["Database"] = Value::String(self.default_schema());
        let mut body = json!({
            "QueryString": sql,
            "QueryExecutionContext": context,
            "WorkGroup": self.conn.param("workgroup").unwrap_or("primary"),
        });
        if let Some(output) = self.conn.param("output") {
            body["ResultConfiguration"] = json!({ "OutputLocation": output });
        }
        let started = client.call("StartQueryExecution", &body).await?;
        let id = started
            .get("QueryExecutionId")
            .and_then(Value::as_str)
            .ok_or("Athena lieferte keine QueryExecutionId")?
            .to_string();
        let mut delay = Duration::from_millis(200);
        let execution = loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    let stop = Self::stop(&client, &id).await;
                    return Err(format!("Abfrage abgebrochen (Query-ID {id}).{stop}"));
                }
                _ = tokio::time::sleep(delay) => {}
            }
            if Instant::now() >= deadline {
                let stop = Self::stop(&client, &id).await;
                return Err(format!(
                    "{} Athena-Abfrage {id} wurde gestoppt.{stop}",
                    super::execution::timeout_message()
                ));
            }
            let response = client
                .call("GetQueryExecution", &json!({ "QueryExecutionId": id }))
                .await?;
            let execution = response.get("QueryExecution").cloned().unwrap_or_default();
            let status = execution.get("Status").cloned().unwrap_or_default();
            match status.get("State").and_then(Value::as_str).unwrap_or("") {
                "SUCCEEDED" => break execution,
                "FAILED" => {
                    let reason = status
                        .get("AthenaError")
                        .and_then(|e| e.get("ErrorMessage"))
                        .or_else(|| status.get("StateChangeReason"))
                        .and_then(Value::as_str)
                        .unwrap_or("unbekannter Fehler");
                    return Err(format!("Athena: {reason}"));
                }
                "CANCELLED" => {
                    return Err(format!("Athena-Abfrage {id} wurde abgebrochen."));
                }
                _ => delay = (delay * 2).min(Duration::from_secs(1)),
            }
        };
        let statement_type = execution
            .get("StatementType")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let stats = execution.get("Statistics").cloned().unwrap_or_default();
        let stat = |k: &str| stats.get(k).and_then(Value::as_i64).unwrap_or(0);
        let mut result = AthenaResult {
            columns: Vec::new(),
            rows: Vec::new(),
            statement_type,
            scanned_bytes: stat("DataScannedInBytes"),
            engine_ms: stat("EngineExecutionTimeInMillis"),
            query_id: id.clone(),
        };
        let mut types: Vec<String> = Vec::new();
        let mut token: Option<Value> = None;
        let mut first = true;
        loop {
            if cancel.is_cancelled() {
                return Err("Abruf der Ergebnisse abgebrochen.".to_string());
            }
            let mut request = json!({ "QueryExecutionId": id, "MaxResults": 1000 });
            if let Some(t) = &token {
                request["NextToken"] = t.clone();
            }
            let page = client.call("GetQueryResults", &request).await?;
            let mut rows = rows_of(&page);
            if first {
                let info = column_info(&page);
                result.columns =
                    super::unique_column_names(info.iter().map(|(n, _)| n.clone()).collect());
                types = info.into_iter().map(|(_, t)| t).collect();
                let header: Vec<Option<String>> =
                    result.columns.iter().map(|c| Some(c.clone())).collect();
                if result.statement_type == "DML" && rows.first() == Some(&header) {
                    rows.remove(0);
                }
                first = false;
            }
            for row in rows {
                if result.rows.len() >= max_rows {
                    break;
                }
                result.rows.push(
                    types
                        .iter()
                        .enumerate()
                        .map(|(i, t)| convert_value(t, row.get(i).and_then(|v| v.as_deref())))
                        .collect(),
                );
            }
            token = page.get("NextToken").filter(|v| !v.is_null()).cloned();
            if token.is_none() || result.rows.len() >= max_rows {
                break;
            }
        }
        Ok(result)
    }

    async fn scalar(&self, sql: &str) -> Result<i64, String> {
        let result = self.run(sql, 1).await?;
        result
            .rows
            .first()
            .and_then(|r| r.first())
            .and_then(|v| v.as_i64().or_else(|| v.as_str()?.parse().ok()))
            .ok_or_else(|| "Zeilenanzahl konnte nicht gelesen werden".to_string())
    }

    async fn table_metadata(&self, schema: &str, table: &str) -> Result<Value, String> {
        let client = self.client().await?;
        let response = timed(client.call(
            "GetTableMetadata",
            &json!({"CatalogName": self.catalog, "DatabaseName": schema, "TableName": table}),
        ))
        .await?;
        Ok(response.get("TableMetadata").cloned().unwrap_or_default())
    }

    fn target(schema: &str, table: &str) -> String {
        format!("{}.{}", quote_ident(schema), quote_ident(table))
    }
}

#[async_trait]
impl DatabaseAdapter for AthenaAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        let client = self.client().await?;
        timed(client.call(
            "GetWorkGroup",
            &json!({"WorkGroup": self.conn.param("workgroup").unwrap_or("primary")}),
        ))
        .await
        .map(|_| ())
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let catalogs = self
            .paged("ListDataCatalogs", json!({}), "DataCatalogsSummary")
            .await?;
        let mut names: Vec<String> = catalogs
            .iter()
            .filter_map(|c| c.get("CatalogName").and_then(Value::as_str))
            .map(str::to_string)
            .collect();
        if !names.contains(&self.catalog) {
            names.insert(0, self.catalog.clone());
        }
        Ok(names)
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(self
            .paged(
                "ListDatabases",
                json!({ "CatalogName": self.catalog }),
                "DatabaseList",
            )
            .await?
            .iter()
            .filter_map(|d| d.get("Name").and_then(Value::as_str))
            .map(str::to_string)
            .collect())
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let schema = schema
            .map(str::to_string)
            .unwrap_or_else(|| self.default_schema());
        Ok(self
            .paged(
                "ListTableMetadata",
                json!({"CatalogName": self.catalog, "DatabaseName": schema, "MaxResults": 50}),
                "TableMetadataList",
            )
            .await?
            .iter()
            .filter_map(|t| t.get("Name").and_then(Value::as_str))
            .map(|name| TableInfo {
                schema: schema.clone(),
                name: name.to_string(),
            })
            .collect())
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        _table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let schema = schema
            .map(str::to_string)
            .unwrap_or_else(|| self.default_schema());
        let tables = match table {
            Some(table) => vec![self.table_metadata(&schema, table).await?],
            None => {
                self.paged(
                    "ListTableMetadata",
                    json!({"CatalogName": self.catalog, "DatabaseName": schema, "MaxResults": 50}),
                    "TableMetadataList",
                )
                .await?
            }
        };
        Ok(tables
            .iter()
            .flat_map(|meta| {
                let name = meta
                    .get("Name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                table_columns(meta)
                    .into_iter()
                    .map(|c| ColumnInfo {
                        schema: schema.clone(),
                        table: name.clone(),
                        name: c.name,
                        data_type: c.data_type,
                    })
                    .collect::<Vec<_>>()
            })
            .collect())
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let meta = self.table_metadata(schema, table).await?;
        Ok(table_columns(&meta))
    }

    async fn table_comment(&self, schema: &str, table: &str) -> Result<Option<String>, String> {
        let meta = self.table_metadata(schema, table).await?;
        Ok(meta
            .get("Parameters")
            .and_then(|p| p.get("comment"))
            .and_then(Value::as_str)
            .map(str::to_string))
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
        let order = order_by
            .map(|c| {
                format!(
                    " ORDER BY {} {}",
                    quote_ident(c),
                    if order_desc { "DESC" } else { "ASC" }
                )
            })
            .unwrap_or_default();
        let offset_sql = if offset > 0 {
            format!(" OFFSET {offset}")
        } else {
            String::new()
        };
        let sql = format!(
            "SELECT * FROM {}{where_sql}{order}{offset_sql} LIMIT {}",
            Self::target(schema, table),
            limit.max(0)
        );
        let result = self.run(&sql, limit.max(0) as usize).await?;
        Ok(TableData {
            rows: rows_to_objects(&result.columns, result.rows),
            columns: result.columns,
        })
    }

    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let where_sql = where_clause(filter, allow_raw_filter)?;
        self.scalar(&format!(
            "SELECT COUNT(*) FROM {}{where_sql}",
            Self::target(schema, table)
        ))
        .await
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = Instant::now();
        let statement = sql.trim().trim_end_matches(';').trim();
        let result = self
            .run(statement, super::commands::MAX_RESULT_ROWS)
            .await?;
        if server_output::is_enabled(&self.key) {
            server_output::push(
                &self.key,
                ServerMessage {
                    level: "INFO".to_string(),
                    message: cost_notice(result.scanned_bytes, result.engine_ms, &result.query_id),
                    detail: None,
                },
            );
        }
        let no_result = result.columns.is_empty();
        Ok(QueryResult {
            rows: rows_to_objects(&result.columns, result.rows),
            columns: result.columns,
            rows_affected: no_result.then_some(0),
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn set_server_output(&self, enabled: bool) -> Result<(), String> {
        server_output::set_enabled(&self.key, enabled);
        Ok(())
    }

    async fn take_server_output(&self) -> Result<Vec<ServerMessage>, String> {
        Ok(server_output::take(&self.key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_athena_types() {
        assert_eq!(convert_value("bigint", Some("42")), json!(42));
        assert_eq!(convert_value("double", Some("1.5")), json!(1.5));
        assert_eq!(convert_value("boolean", Some("true")), json!(true));
        assert_eq!(convert_value("decimal(38,2)", Some("1.10")), json!("1.10"));
        assert_eq!(convert_value("json", Some("{\"a\":1}")), json!({"a": 1}));
        assert_eq!(convert_value("varchar", Some("x")), json!("x"));
        assert_eq!(convert_value("integer", None), Value::Null);
    }

    #[test]
    fn parses_result_pages() {
        let page = json!({
            "ResultSet": {
                "Rows": [
                    {"Data": [{"VarCharValue": "id"}, {"VarCharValue": "name"}]},
                    {"Data": [{"VarCharValue": "1"}, {}]}
                ],
                "ResultSetMetadata": {"ColumnInfo": [
                    {"Name": "id", "Label": "id", "Type": "integer"},
                    {"Name": "name", "Label": "name", "Type": "varchar"}
                ]}
            }
        });
        assert_eq!(
            column_info(&page),
            vec![
                ("id".to_string(), "integer".to_string()),
                ("name".to_string(), "varchar".to_string())
            ]
        );
        let rows = rows_of(&page);
        assert_eq!(
            rows[0],
            vec![Some("id".to_string()), Some("name".to_string())]
        );
        assert_eq!(rows[1], vec![Some("1".to_string()), None]);
    }

    #[test]
    fn marks_partition_keys() {
        let columns = table_columns(&json!({
            "Columns": [{"Name": "id", "Type": "bigint", "Comment": "PK"}],
            "PartitionKeys": [{"Name": "dt", "Type": "string"}]
        }));
        assert_eq!(columns.len(), 2);
        assert_eq!(columns[0].comment.as_deref(), Some("PK"));
        assert_eq!(columns[1].comment.as_deref(), Some("Partitionsschlüssel"));
        assert_eq!(columns[1].ordinal_position, 2);
    }

    #[test]
    fn estimates_cost_with_minimum() {
        let notice = cost_notice(512, 12, "q1");
        assert!(notice.contains("512 B gescannt"), "{notice}");
        assert!(notice.contains("0.000048 USD"), "{notice}");
        assert!(cost_notice(1024_i64.pow(4), 1, "q").contains("5.000000 USD"));
    }

    #[test]
    fn catalog_prefers_selected_database() {
        let url = "athena://eu-central-1/MyCatalog?workgroup=wg";
        assert_eq!(
            AthenaAdapter::new(url, None, String::new())
                .unwrap()
                .catalog,
            "MyCatalog"
        );
        assert_eq!(
            AthenaAdapter::new(url, Some("Other"), String::new())
                .unwrap()
                .catalog,
            "Other"
        );
        assert_eq!(
            AthenaAdapter::new("athena://eu-central-1", None, String::new())
                .unwrap()
                .catalog,
            DEFAULT_CATALOG
        );
    }

    type Log = std::sync::Arc<std::sync::Mutex<Vec<String>>>;

    async fn mock_athena(finish_after: Option<usize>) -> (String, Log) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let log: Log = Default::default();
        let calls = log.clone();
        tokio::spawn(async move {
            let mut polls = 0usize;
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                let (head, body) = loop {
                    let n = socket.read(&mut chunk).await.unwrap();
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let length = text[..end]
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if buf.len() >= end + 4 + length {
                            break (text[..end].to_string(), text[end + 4..].to_string());
                        }
                    }
                    if n == 0 {
                        return;
                    }
                };
                let header = |name: &str| {
                    head.lines()
                        .find_map(|l| {
                            let (k, v) = l.split_once(':')?;
                            k.eq_ignore_ascii_case(name).then(|| v.trim().to_string())
                        })
                        .unwrap_or_default()
                };
                assert!(header("authorization").contains("Credential=AKID/"));
                let target = header("x-amz-target");
                let action = target.trim_start_matches("AmazonAthena.").to_string();
                let request: Value = serde_json::from_str(&body).unwrap_or_default();
                calls.lock().unwrap().push(action.clone());
                let response = match action.as_str() {
                    "StartQueryExecution" => {
                        assert_eq!(request["WorkGroup"], "wg");
                        assert_eq!(request["QueryExecutionContext"]["Catalog"], "AwsDataCatalog");
                        assert_eq!(
                            request["ResultConfiguration"]["OutputLocation"],
                            "s3://bucket/out/"
                        );
                        json!({"QueryExecutionId": "q-1"})
                    }
                    "GetQueryExecution" => {
                        polls += 1;
                        let state = match finish_after {
                            Some(n) if polls > n => "SUCCEEDED",
                            _ => "RUNNING",
                        };
                        json!({"QueryExecution": {
                            "StatementType": "DML",
                            "Status": {"State": state},
                            "Statistics": {"DataScannedInBytes": 2048, "EngineExecutionTimeInMillis": 7}
                        }})
                    }
                    "GetQueryResults" if request.get("NextToken").is_none() => json!({
                        "NextToken": "p2",
                        "ResultSet": {
                            "ResultSetMetadata": {"ColumnInfo": [
                                {"Name": "id", "Label": "id", "Type": "bigint"},
                                {"Name": "ok", "Label": "ok", "Type": "boolean"}
                            ]},
                            "Rows": [
                                {"Data": [{"VarCharValue": "id"}, {"VarCharValue": "ok"}]},
                                {"Data": [{"VarCharValue": "1"}, {"VarCharValue": "true"}]}
                            ]
                        }
                    }),
                    "GetQueryResults" => json!({"ResultSet": {
                        "ResultSetMetadata": {"ColumnInfo": [
                            {"Name": "id", "Label": "id", "Type": "bigint"},
                            {"Name": "ok", "Label": "ok", "Type": "boolean"}
                        ]},
                        "Rows": [{"Data": [{"VarCharValue": "2"}, {}]}]
                    }}),
                    _ => json!({}),
                }
                .to_string();
                let reply = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/x-amz-json-1.1\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{response}",
                    response.len()
                );
                let _ = socket.write_all(reply.as_bytes()).await;
            }
        });
        (
            format!(
                "athena://AKID:secret@eu-central-1/AwsDataCatalog?workgroup=wg&output=s3%3A%2F%2Fbucket%2Fout%2F&endpoint=http%3A%2F%2F127.0.0.1%3A{port}"
            ),
            log,
        )
    }

    #[tokio::test]
    async fn runs_query_against_mocked_api() {
        let (url, log) = mock_athena(Some(1)).await;
        let adapter = AthenaAdapter::new(&url, None, "athena-mock".to_string()).unwrap();
        adapter.set_server_output(true).await.unwrap();
        let result = adapter
            .execute_query("SELECT id, ok FROM t;")
            .await
            .unwrap();
        assert_eq!(result.columns, vec!["id", "ok"]);
        assert_eq!(
            result.rows,
            vec![json!({"id": 1, "ok": true}), json!({"id": 2, "ok": null})]
        );
        assert_eq!(
            *log.lock().unwrap(),
            vec![
                "StartQueryExecution",
                "GetQueryExecution",
                "GetQueryExecution",
                "GetQueryResults",
                "GetQueryResults"
            ]
        );
        let output = adapter.take_server_output().await.unwrap();
        assert!(
            output[0].message.contains("2.0 kB gescannt"),
            "{}",
            output[0].message
        );
        adapter.set_server_output(false).await.unwrap();
    }

    #[tokio::test]
    async fn cancel_stops_query_execution() {
        let (url, log) = mock_athena(None).await;
        let adapter = AthenaAdapter::new(&url, None, String::new()).unwrap();
        let options = crate::db::execution::ExecutionOptions {
            job_id: Some("athena-cancel-test".to_string()),
            ..Default::default()
        };
        let canceller = tokio::spawn(async {
            tokio::time::sleep(Duration::from_millis(500)).await;
            crate::db::execution::cancel("athena-cancel-test").unwrap()
        });
        let error =
            crate::db::execution::run(Some(options), true, adapter.execute_query("SELECT 1"))
                .await
                .unwrap_err();
        assert!(canceller.await.unwrap());
        assert!(error.contains("abgebrochen"), "{error}");
        assert_eq!(log.lock().unwrap().last().unwrap(), "StopQueryExecution");
    }
}
