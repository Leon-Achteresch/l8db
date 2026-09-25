use std::time::Instant;

use async_trait::async_trait;
use base64::Engine;
use serde_json::{json, Value};

use super::warehouse_auth::{self, google_token, GoogleAuth};
use super::{
    rows_to_objects, timed, where_clause, ColumnInfo, DatabaseAdapter, DetailedColumnInfo,
    QueryResult, TableData, TableInfo,
};

const PAGE_SIZE: usize = 1000;
const DEFAULT_ENDPOINT: &str = "https://bigquery.googleapis.com";

pub struct BigqueryAdapter {
    project: String,
    dataset: Option<String>,
    location: Option<String>,
    endpoint: String,
    custom_endpoint: bool,
    auth: GoogleAuth,
}

pub fn quote(ident: &str) -> String {
    format!("`{}`", ident.replace('\\', "\\\\").replace('`', "\\`"))
}

fn percent(value: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", value.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| value.to_string())
}

fn str_of(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

#[derive(Debug, Clone)]
struct Leaf {
    name: String,
    data_type: String,
    nullable: bool,
    description: Option<String>,
}

fn is_record(field: &Value) -> bool {
    matches!(str_of(&field["type"]), "RECORD" | "STRUCT")
}

fn is_repeated(field: &Value) -> bool {
    str_of(&field["mode"]) == "REPEATED"
}

fn subfields(field: &Value) -> &[Value] {
    field["fields"].as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn fields_of(schema: &Value) -> &[Value] {
    schema["fields"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn type_name(field: &Value) -> String {
    let base = str_of(&field["type"]);
    let base = match base {
        "RECORD" => "STRUCT".to_string(),
        "INTEGER" => "INT64".to_string(),
        "FLOAT" => "FLOAT64".to_string(),
        "BOOLEAN" => "BOOL".to_string(),
        "NUMERIC" | "BIGNUMERIC" if field.get("precision").is_some() => format!(
            "{base}({}, {})",
            str_of(&field["precision"]),
            field["scale"].as_str().unwrap_or("0")
        ),
        "STRING" | "BYTES" if field.get("maxLength").is_some() => {
            format!("{base}({})", str_of(&field["maxLength"]))
        }
        other => other.to_string(),
    };
    if is_repeated(field) {
        format!("ARRAY<{base}>")
    } else {
        base
    }
}

fn flatten(fields: &[Value], prefix: &str, out: &mut Vec<Leaf>) {
    for field in fields {
        let name = format!("{prefix}{}", str_of(&field["name"]));
        if is_record(field) && !is_repeated(field) && !subfields(field).is_empty() {
            flatten(subfields(field), &format!("{name}."), out);
        } else {
            out.push(Leaf {
                name,
                data_type: type_name(field),
                nullable: str_of(&field["mode"]) != "REQUIRED",
                description: field["description"]
                    .as_str()
                    .filter(|d| !d.is_empty())
                    .map(str::to_string),
            });
        }
    }
}

fn leaves(schema: &Value) -> Vec<Leaf> {
    let mut out = Vec::new();
    flatten(fields_of(schema), "", &mut out);
    out
}

fn leaf_count(fields: &[Value]) -> usize {
    fields
        .iter()
        .map(|f| {
            if is_record(f) && !is_repeated(f) && !subfields(f).is_empty() {
                leaf_count(subfields(f))
            } else {
                1
            }
        })
        .sum()
}

fn convert_row(fields: &[Value], row: &Value, out: &mut Vec<Value>) {
    let cells = row["f"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    for (index, field) in fields.iter().enumerate() {
        let cell = cells.get(index).map(|c| &c["v"]).unwrap_or(&Value::Null);
        if is_record(field) && !is_repeated(field) && !subfields(field).is_empty() {
            if cell.is_null() {
                out.extend(std::iter::repeat_n(
                    Value::Null,
                    leaf_count(subfields(field)),
                ));
            } else {
                convert_row(subfields(field), cell, out);
            }
        } else {
            out.push(convert_value(field, cell));
        }
    }
}

fn convert_value(field: &Value, value: &Value) -> Value {
    if value.is_null() {
        return Value::Null;
    }
    if is_repeated(field) {
        return Value::Array(
            value
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .map(|item| element(field, &item["v"]))
                        .collect()
                })
                .unwrap_or_default(),
        );
    }
    element(field, value)
}

fn element(field: &Value, value: &Value) -> Value {
    if value.is_null() {
        return Value::Null;
    }
    if is_record(field) {
        let cells = value["f"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        let mut object = serde_json::Map::new();
        for (index, sub) in subfields(field).iter().enumerate() {
            let cell = cells.get(index).map(|c| &c["v"]).unwrap_or(&Value::Null);
            object.insert(str_of(&sub["name"]).to_string(), convert_value(sub, cell));
        }
        return Value::Object(object);
    }
    scalar(str_of(&field["type"]), value)
}

fn safe_int(text: &str) -> Value {
    match text.parse::<i64>() {
        Ok(n) if n.unsigned_abs() <= (1u64 << 53) => Value::from(n),
        _ => Value::String(text.to_string()),
    }
}

pub(crate) fn scalar(data_type: &str, value: &Value) -> Value {
    let text = match value {
        Value::String(s) => s.as_str(),
        Value::Null => return Value::Null,
        other => return other.clone(),
    };
    match data_type {
        "INT64" | "INTEGER" => safe_int(text),
        "FLOAT64" | "FLOAT" => match text.parse::<f64>() {
            Ok(f) if f.is_finite() => json!(f),
            _ => Value::String(text.to_string()),
        },
        "BOOL" | "BOOLEAN" => match text {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            _ => Value::String(text.to_string()),
        },
        "TIMESTAMP" => seconds_to_micros(text)
            .and_then(chrono::DateTime::from_timestamp_micros)
            .map(|ts| Value::String(ts.format("%Y-%m-%d %H:%M:%S%.f UTC").to_string()))
            .unwrap_or_else(|| Value::String(text.to_string())),
        "BYTES" => base64::engine::general_purpose::STANDARD
            .decode(text)
            .map(|bytes| Value::String(super::hex_blob(&bytes)))
            .unwrap_or_else(|_| Value::String(text.to_string())),
        "JSON" => serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string())),
        _ => Value::String(text.to_string()),
    }
}

pub(crate) fn seconds_to_micros(text: &str) -> Option<i64> {
    let text = text.trim();
    let (mantissa, exponent) = match text.find(['e', 'E']) {
        Some(i) => (&text[..i], text[i + 1..].parse::<i64>().ok()?),
        None => (text, 0),
    };
    let negative = mantissa.starts_with('-');
    let mantissa = mantissa.trim_start_matches(['-', '+']);
    let (int, frac) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let digits = format!("{int}{frac}");
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let point = int.len() as i64 + exponent + 6;
    if point <= 0 {
        return Some(0);
    }
    let point = point as usize;
    let (whole, next) = if point >= digits.len() {
        (
            format!("{digits}{}", "0".repeat(point - digits.len())),
            None,
        )
    } else {
        (
            digits[..point].to_string(),
            digits.as_bytes().get(point).copied(),
        )
    };
    let trimmed = whole.trim_start_matches('0');
    let mut micros: i64 = if trimmed.is_empty() {
        0
    } else {
        trimmed.parse().ok()?
    };
    if next.is_some_and(|d| d >= b'5') {
        micros += 1;
    }
    Some(if negative { -micros } else { micros })
}

fn api_error(status: u16, body: &Value) -> String {
    let message = body["error"]["message"]
        .as_str()
        .map(str::to_string)
        .or_else(|| body.as_str().map(str::to_string))
        .unwrap_or_else(|| body.to_string());
    format!("BigQuery {status}: {message}")
}

fn column_names(schema: &Value) -> Vec<String> {
    super::unique_column_names(leaves(schema).into_iter().map(|l| l.name).collect())
}

fn convert_rows(schema: &Value, rows: &Value) -> Vec<Vec<Value>> {
    let fields = fields_of(schema);
    rows.as_array()
        .map(|rows| {
            rows.iter()
                .map(|row| {
                    let mut out = Vec::with_capacity(fields.len());
                    convert_row(fields, row, &mut out);
                    out
                })
                .collect()
        })
        .unwrap_or_default()
}

impl BigqueryAdapter {
    pub fn new(connection_string: &str) -> Result<Self, String> {
        let url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige BigQuery-URL".to_string())?;
        if url.scheme() != "bigquery" {
            return Err("Eine bigquery:// URL ist erforderlich".to_string());
        }
        let mut project = percent(url.host_str().unwrap_or(""));
        let mut location = None;
        let mut endpoint = None;
        let mut credentials_file = None;
        let mut mode = percent(url.username());
        let secret = percent(url.password().unwrap_or(""));
        for (k, v) in url.query_pairs() {
            let v = v.trim().to_string();
            if v.is_empty() {
                continue;
            }
            match k.as_ref() {
                "project" | "project_id" => project = v,
                "location" => location = Some(v),
                "endpoint" | "api_endpoint" => endpoint = Some(v.trim_end_matches('/').to_string()),
                "credentials_file" | "key_file" => credentials_file = Some(v),
                "auth" => mode = v,
                _ => {}
            }
        }
        if project.is_empty() {
            return Err("Die Projekt-ID fehlt (bigquery://projekt-id).".into());
        }
        let dataset = url
            .path_segments()
            .and_then(|mut s| s.next())
            .map(percent)
            .filter(|d| !d.is_empty());
        let auth = match mode.to_ascii_lowercase().as_str() {
            "" | "adc" => match (&credentials_file, secret.trim_start().starts_with('{')) {
                (Some(path), _) => GoogleAuth::File(path.clone()),
                (None, true) => GoogleAuth::Json(secret),
                _ => GoogleAuth::Adc,
            },
            "service_account" | "key" | "json" | "credentials" => {
                if !secret.trim().is_empty() {
                    GoogleAuth::Json(secret)
                } else if let Some(path) = credentials_file {
                    GoogleAuth::File(path)
                } else {
                    return Err("Der Service-Account-Schlüssel (JSON) fehlt.".into());
                }
            }
            "token" | "oauth" | "access_token" => {
                if secret.trim().is_empty() {
                    return Err("Das OAuth-Zugriffstoken fehlt.".into());
                }
                GoogleAuth::Token(secret)
            }
            "none" | "anonymous" => GoogleAuth::Anonymous,
            other => return Err(format!("Unbekannte BigQuery-Anmeldung \"{other}\". Erlaubt: adc, service_account, token, none.")),
        };
        Ok(Self {
            project,
            dataset,
            location,
            custom_endpoint: endpoint.is_some(),
            endpoint: endpoint.unwrap_or_else(|| DEFAULT_ENDPOINT.to_string()),
            auth,
        })
    }

    fn url(&self, segments: &[&str]) -> Result<url::Url, String> {
        let mut url = url::Url::parse(&self.endpoint)
            .map_err(|_| format!("Ungültiger BigQuery-Endpunkt: {}", self.endpoint))?;
        url.path_segments_mut()
            .map_err(|_| "Ungültiger BigQuery-Endpunkt".to_string())?
            .pop_if_empty()
            .extend(["bigquery", "v2", "projects", self.project.as_str()])
            .extend(segments);
        Ok(url)
    }

    async fn call(
        &self,
        method: reqwest::Method,
        segments: &[&str],
        query: &[(&str, String)],
        body: Option<Value>,
    ) -> Result<Value, String> {
        let token = google_token(&self.auth, self.custom_endpoint).await?;
        let mut request = warehouse_auth::http()
            .request(method, self.url(segments)?)
            .query(query);
        if let Some(token) = &token.token {
            request = request.bearer_auth(token);
        }
        if let Some(project) = &token.quota_project {
            request = request.header("x-goog-user-project", project);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("BigQuery nicht erreichbar: {e}"))?;
        let (status, body) = warehouse_auth::read_body(response, "BigQuery").await?;
        if !(200..300).contains(&status) {
            return Err(api_error(status, &body));
        }
        Ok(body)
    }

    async fn get(&self, segments: &[&str], query: &[(&str, String)]) -> Result<Value, String> {
        timed(self.call(reqwest::Method::GET, segments, query, None)).await
    }

    async fn datasets(&self) -> Result<Vec<String>, String> {
        let mut out = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut query = vec![("maxResults", PAGE_SIZE.to_string())];
            if let Some(t) = &token {
                query.push(("pageToken", t.clone()));
            }
            let page = self.get(&["datasets"], &query).await?;
            if let Some(items) = page["datasets"].as_array() {
                out.extend(
                    items
                        .iter()
                        .map(|d| str_of(&d["datasetReference"]["datasetId"]).to_string()),
                );
            }
            token = page["nextPageToken"].as_str().map(str::to_string);
            if token.is_none() {
                break;
            }
        }
        out.sort();
        Ok(out)
    }

    async fn tables(&self, dataset: &str) -> Result<Vec<(String, String)>, String> {
        let mut out = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut query = vec![("maxResults", PAGE_SIZE.to_string())];
            if let Some(t) = &token {
                query.push(("pageToken", t.clone()));
            }
            let page = self.get(&["datasets", dataset, "tables"], &query).await?;
            if let Some(items) = page["tables"].as_array() {
                out.extend(items.iter().map(|t| {
                    (
                        str_of(&t["tableReference"]["tableId"]).to_string(),
                        str_of(&t["type"]).to_string(),
                    )
                }));
            }
            token = page["nextPageToken"].as_str().map(str::to_string);
            if token.is_none() {
                break;
            }
        }
        out.sort();
        Ok(out)
    }

    async fn scoped_datasets(&self, schema: Option<&str>) -> Result<Vec<String>, String> {
        match schema.or(self.dataset.as_deref()) {
            Some(dataset) => Ok(vec![dataset.to_string()]),
            None => self.datasets().await,
        }
    }

    async fn relations(&self, schema: Option<&str>, views: bool) -> Result<Vec<TableInfo>, String> {
        let mut out = Vec::new();
        for dataset in self.scoped_datasets(schema).await? {
            for (name, kind) in self.tables(&dataset).await? {
                if matches!(kind.as_str(), "VIEW" | "MATERIALIZED_VIEW") == views {
                    out.push(TableInfo {
                        schema: dataset.clone(),
                        name,
                    });
                }
            }
        }
        Ok(out)
    }

    async fn table(&self, dataset: &str, table: &str) -> Result<Value, String> {
        self.get(&["datasets", dataset, "tables", table], &[]).await
    }

    fn qualified(&self, dataset: &str, table: &str) -> String {
        format!(
            "{}.{}.{}",
            quote(&self.project),
            quote(dataset),
            quote(table)
        )
    }

    fn query_body(&self, sql: &str, dry_run: bool) -> Value {
        let mut body = json!({
            "query": sql,
            "useLegacySql": false,
            "maxResults": PAGE_SIZE,
            "timeoutMs": 2000,
        });
        if dry_run {
            body["dryRun"] = json!(true);
        }
        if let Some(location) = &self.location {
            body["location"] = json!(location);
        }
        if let Some(dataset) = &self.dataset {
            body["defaultDataset"] = json!({"projectId": self.project, "datasetId": dataset});
        }
        body
    }

    async fn cancel_job(&self, job_id: &str, location: &str) -> Result<(), String> {
        let mut query = Vec::new();
        if !location.is_empty() {
            query.push(("location", location.to_string()));
        }
        tokio::time::timeout(
            super::execution::connection_duration(),
            self.call(
                reqwest::Method::POST,
                &["jobs", job_id, "cancel"],
                &query,
                None,
            ),
        )
        .await
        .map_err(|_| "Zeitüberschreitung".to_string())?
        .map(|_| ())
    }

    async fn run(&self, sql: &str) -> Result<(Value, Vec<Vec<Value>>, Value), String> {
        let started = Instant::now();
        let deadline = started + super::execution::query_duration();
        let mut response = self
            .call(
                reqwest::Method::POST,
                &["queries"],
                &[],
                Some(self.query_body(sql, false)),
            )
            .await?;
        let job_id = str_of(&response["jobReference"]["jobId"]).to_string();
        let location = response["jobReference"]["location"]
            .as_str()
            .map(str::to_string)
            .or_else(|| self.location.clone())
            .unwrap_or_default();
        let mut query = vec![("maxResults", PAGE_SIZE.to_string())];
        if !location.is_empty() {
            query.push(("location", location.clone()));
        }
        while response["jobComplete"] == json!(false) {
            let mut poll = query.clone();
            poll.push(("timeoutMs", "10000".to_string()));
            let segments = ["queries", job_id.as_str()];
            let next = self.call(reqwest::Method::GET, &segments, &poll, None);
            match warehouse_auth::interruptible(next, deadline).await {
                Ok(result) => response = result?,
                Err(timed_out) => {
                    let confirmed = self.cancel_job(&job_id, &location).await;
                    return Err(warehouse_auth::interrupted_message(timed_out, confirmed));
                }
            }
        }
        let schema = response["schema"].clone();
        let mut rows = convert_rows(&schema, &response["rows"]);
        let mut token = response["pageToken"].as_str().map(str::to_string);
        while let Some(page_token) = token.filter(|_| rows.len() < PAGE_SIZE && !job_id.is_empty())
        {
            let mut page = query.clone();
            page.push(("pageToken", page_token));
            let next =
                timed(self.call(reqwest::Method::GET, &["queries", &job_id], &page, None)).await?;
            rows.extend(convert_rows(&schema, &next["rows"]));
            token = next["pageToken"].as_str().map(str::to_string);
        }
        Ok((schema, rows, response))
    }

    async fn select(&self, sql: &str) -> Result<(Vec<String>, Vec<Vec<Value>>), String> {
        let (schema, rows, _) = self.run(sql).await?;
        Ok((column_names(&schema), rows))
    }

    async fn dry_run(&self, sql: &str) -> Result<Value, String> {
        let mut configuration = json!({
            "dryRun": true,
            "query": {"query": sql, "useLegacySql": false},
        });
        if let Some(dataset) = &self.dataset {
            configuration["query"]["defaultDataset"] =
                json!({"projectId": self.project, "datasetId": dataset});
        }
        let mut body = json!({ "configuration": configuration });
        if let Some(location) = &self.location {
            body["jobReference"] = json!({"projectId": self.project, "location": location});
        }
        timed(self.call(reqwest::Method::POST, &["jobs"], &[], Some(body))).await
    }
}

fn number(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}

fn dry_run_plan(job: &Value) -> Value {
    let stats = &job["statistics"]["query"];
    let bytes = number(&stats["totalBytesProcessed"])
        .or_else(|| number(&job["statistics"]["totalBytesProcessed"]))
        .unwrap_or(0);
    let tables: Vec<String> = stats["referencedTables"]
        .as_array()
        .map(|t| {
            t.iter()
                .map(|r| {
                    format!(
                        "{}.{}.{}",
                        str_of(&r["projectId"]),
                        str_of(&r["datasetId"]),
                        str_of(&r["tableId"])
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let mut node = json!({
        "Node Type": "BigQuery Dry Run",
        "Bytes Processed": bytes,
        "Estimated Bytes": super::pretty_bytes(bytes),
    });
    if let Some(kind) = stats["statementType"].as_str() {
        node["Statement Type"] = json!(kind);
    }
    if !tables.is_empty() {
        node["Relation Name"] = json!(tables.join(", "));
    }
    json!([{ "Plan": node }])
}

fn job_plan(job: &Value, elapsed_ms: f64) -> Value {
    let stats = &job["statistics"]["query"];
    let stages: Vec<Value> = stats["queryPlan"]
        .as_array()
        .map(|stages| {
            stages
                .iter()
                .map(|stage| {
                    let steps: Vec<String> = stage["steps"]
                        .as_array()
                        .map(|steps| {
                            steps
                                .iter()
                                .map(|s| {
                                    let sub: Vec<&str> = s["substeps"]
                                        .as_array()
                                        .map(|x| x.iter().filter_map(|v| v.as_str()).collect())
                                        .unwrap_or_default();
                                    format!("{}: {}", str_of(&s["kind"]), sub.join("; "))
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let ms = number(&stage["endMs"])
                        .zip(number(&stage["startMs"]))
                        .map(|(end, start)| (end - start) as f64)
                        .unwrap_or(0.0);
                    json!({
                        "Node Type": str_of(&stage["name"]),
                        "Plan Rows": number(&stage["recordsRead"]).unwrap_or(0),
                        "Actual Rows": number(&stage["recordsWritten"]).unwrap_or(0),
                        "Actual Total Time": ms,
                        "Actual Startup Time": 0.0,
                        "Steps": steps.join("\n"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let bytes = number(&stats["totalBytesProcessed"]).unwrap_or(0);
    json!([{
        "Plan": {
            "Node Type": "BigQuery Job",
            "Bytes Processed": bytes,
            "Estimated Bytes": super::pretty_bytes(bytes),
            "Slot Milliseconds": number(&stats["totalSlotMs"]).unwrap_or(0),
            "Cache Hit": stats["cacheHit"].as_bool().unwrap_or(false),
            "Actual Total Time": elapsed_ms,
            "Actual Startup Time": 0.0,
            "Plans": stages,
        },
        "Execution Time": elapsed_ms,
        "Planning Time": 0.0,
    }])
}

#[async_trait]
impl DatabaseAdapter for BigqueryAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.get(&["datasets"], &[("maxResults", "1".to_string())])
            .await
            .map(|_| ())
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(vec![self.project.clone()])
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        self.datasets().await
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        self.relations(schema, false).await
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        self.relations(schema, true).await
    }

    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let table = self.table(schema, view).await?;
        Ok(table["view"]["query"]
            .as_str()
            .or_else(|| table["materializedView"]["query"].as_str())
            .unwrap_or("")
            .to_string())
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let views = table_type.is_some_and(|t| t.eq_ignore_ascii_case("view"));
        let mut targets = Vec::new();
        match table {
            Some(t) => {
                for dataset in self.scoped_datasets(schema).await? {
                    targets.push((dataset, t.to_string()));
                }
            }
            None => {
                for relation in self.relations(schema, views).await? {
                    targets.push((relation.schema, relation.name));
                }
            }
        }
        use futures_util::StreamExt;
        let tables: Vec<Result<(String, String, Value), String>> =
            futures_util::stream::iter(targets)
                .map(|(dataset, name)| async move {
                    self.table(&dataset, &name)
                        .await
                        .map(|t| (dataset, name, t))
                })
                .buffered(8)
                .collect()
                .await;
        let mut out = Vec::new();
        for entry in tables {
            let (dataset, name, meta) = entry?;
            out.extend(leaves(&meta["schema"]).into_iter().map(|leaf| ColumnInfo {
                schema: dataset.clone(),
                table: name.clone(),
                name: leaf.name,
                data_type: leaf.data_type,
            }));
        }
        Ok(out)
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let meta = self.table(schema, table).await?;
        Ok(leaves(&meta["schema"])
            .into_iter()
            .enumerate()
            .map(|(index, leaf)| DetailedColumnInfo {
                name: leaf.name,
                data_type: leaf.data_type,
                is_nullable: leaf.nullable,
                column_default: None,
                is_primary_key: false,
                ordinal_position: index as i32 + 1,
                character_maximum_length: None,
                comment: leaf.description,
            })
            .collect())
    }

    async fn table_comment(&self, schema: &str, table: &str) -> Result<Option<String>, String> {
        let meta = self.table(schema, table).await?;
        Ok(meta["description"]
            .as_str()
            .filter(|d| !d.is_empty())
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
        is_view: bool,
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let where_sql = where_clause(filter, allow_raw_filter)?;
        let limit = limit.max(0) as usize;
        let meta = self.table(schema, table).await?;
        let columns = column_names(&meta["schema"]);
        let view = is_view || matches!(str_of(&meta["type"]), "VIEW" | "MATERIALIZED_VIEW");
        let order = order_by.filter(|col| columns.iter().any(|c| c == col));
        if where_sql.is_empty() && order.is_none() && !view {
            let mut rows = Vec::new();
            let mut token: Option<String> = None;
            while rows.len() < limit {
                let mut query = vec![("maxResults", (limit - rows.len()).to_string())];
                match &token {
                    Some(t) => query.push(("pageToken", t.clone())),
                    None => query.push(("startIndex", offset.max(0).to_string())),
                }
                let page = self
                    .get(&["datasets", schema, "tables", table, "data"], &query)
                    .await?;
                let converted = convert_rows(&meta["schema"], &page["rows"]);
                let empty = converted.is_empty();
                rows.extend(converted);
                token = page["pageToken"].as_str().map(str::to_string);
                if token.is_none() || empty {
                    break;
                }
            }
            rows.truncate(limit);
            return Ok(TableData {
                rows: rows_to_objects(&columns, rows),
                columns,
            });
        }
        let order_sql = order
            .map(|col| {
                format!(
                    " ORDER BY {} {}",
                    col.split('.').map(quote).collect::<Vec<_>>().join("."),
                    if order_desc { "DESC" } else { "ASC" }
                )
            })
            .unwrap_or_default();
        let sql = format!(
            "SELECT * FROM {}{where_sql}{order_sql} LIMIT {limit} OFFSET {}",
            self.qualified(schema, table),
            offset.max(0)
        );
        let (cols, rows) = self.select(&sql).await?;
        Ok(TableData {
            rows: rows_to_objects(&cols, rows),
            columns: cols,
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
        if where_sql.is_empty() {
            let meta = self.table(schema, table).await?;
            if let Some(count) = number(&meta["numRows"]) {
                return Ok(count);
            }
        }
        let sql = format!(
            "SELECT COUNT(*) FROM {}{where_sql}",
            self.qualified(schema, table)
        );
        let (_, rows) = self.select(&sql).await?;
        rows.first()
            .and_then(|r| r.first())
            .and_then(number)
            .ok_or_else(|| "COUNT lieferte kein Ergebnis".to_string())
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let started = Instant::now();
        let (schema, rows, response) = self.run(sql).await?;
        let columns = column_names(&schema);
        Ok(QueryResult {
            rows: rows_to_objects(&columns, rows),
            columns,
            rows_affected: number(&response["numDmlAffectedRows"]).map(|n| n as u64),
            execution_time_ms: started.elapsed().as_millis() as u64,
        })
    }

    async fn explain_query(&self, sql: &str, analyze: bool) -> Result<Value, String> {
        if !analyze {
            return Ok(dry_run_plan(&self.dry_run(sql).await?));
        }
        let started = Instant::now();
        let (_, _, response) = self.run(sql).await?;
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        let job_id = str_of(&response["jobReference"]["jobId"]).to_string();
        if job_id.is_empty() {
            return Ok(job_plan(&Value::Null, elapsed));
        }
        let mut query = Vec::new();
        if let Some(location) = response["jobReference"]["location"].as_str() {
            query.push(("location", location.to_string()));
        }
        let job = self.get(&["jobs", &job_id], &query).await?;
        Ok(job_plan(&job, elapsed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::execution::{self, ExecutionOptions};
    use crate::db::http_mock;

    fn encode(value: &str) -> String {
        url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
    }

    fn adapter(base: &str, extra: &str) -> BigqueryAdapter {
        BigqueryAdapter::new(&format!(
            "bigquery://none@proj/ds?endpoint={}{extra}",
            encode(base)
        ))
        .unwrap()
    }

    fn schema() -> Value {
        json!({"fields": [
            {"name": "id", "type": "INTEGER", "mode": "REQUIRED"},
            {"name": "info", "type": "RECORD", "fields": [
                {"name": "city", "type": "STRING"},
                {"name": "geo", "type": "RECORD", "fields": [{"name": "lat", "type": "FLOAT"}]}
            ]},
            {"name": "tags", "type": "STRING", "mode": "REPEATED"},
            {"name": "items", "type": "RECORD", "mode": "REPEATED", "fields": [
                {"name": "sku", "type": "STRING"}, {"name": "qty", "type": "INT64"}
            ]},
            {"name": "raw", "type": "BYTES"}
        ]})
    }

    fn row(id: &str) -> Value {
        json!({"f": [
            {"v": id},
            {"v": {"f": [{"v": "Berlin"}, {"v": {"f": [{"v": "52.5"}]}}]}},
            {"v": [{"v": "a"}, {"v": "b"}]},
            {"v": [{"v": {"f": [{"v": "x1"}, {"v": "2"}]}}]},
            {"v": "AAH/"}
        ]})
    }

    #[test]
    fn parses_urls_and_auth_modes() {
        let a = BigqueryAdapter::new("bigquery://my-project/sales?location=EU").unwrap();
        assert_eq!(a.project, "my-project");
        assert_eq!(a.dataset.as_deref(), Some("sales"));
        assert_eq!(a.location.as_deref(), Some("EU"));
        assert_eq!(a.endpoint, DEFAULT_ENDPOINT);
        assert_eq!(a.auth, GoogleAuth::Adc);
        let key = encode(r#"{"type":"service_account"}"#);
        let a = BigqueryAdapter::new(&format!("bigquery://service_account:{key}@p")).unwrap();
        assert_eq!(
            a.auth,
            GoogleAuth::Json(r#"{"type":"service_account"}"#.into())
        );
        let a = BigqueryAdapter::new("bigquery://p?credentials_file=%2Ftmp%2Fk.json").unwrap();
        assert_eq!(a.auth, GoogleAuth::File("/tmp/k.json".into()));
        let a = BigqueryAdapter::new("bigquery://token:ya29.abc@p").unwrap();
        assert_eq!(a.auth, GoogleAuth::Token("ya29.abc".into()));
        let a =
            BigqueryAdapter::new("bigquery://p?auth=none&endpoint=http://localhost:9050/").unwrap();
        assert_eq!(a.auth, GoogleAuth::Anonymous);
        assert_eq!(a.endpoint, "http://localhost:9050");
        assert!(a.custom_endpoint);
        assert!(BigqueryAdapter::new("bigquery://service_account@p").is_err());
        assert!(BigqueryAdapter::new("bigquery://token@p").is_err());
        assert!(BigqueryAdapter::new("bigquery://magic@p").is_err());
        assert!(BigqueryAdapter::new("postgres://p").is_err());
    }

    #[test]
    fn converts_float_seconds_exactly() {
        assert_eq!(
            seconds_to_micros("1.577836800E9"),
            Some(1_577_836_800_000_000)
        );
        assert_eq!(
            seconds_to_micros("1.5778368001234559E9"),
            Some(1_577_836_800_123_456)
        );
        assert_eq!(
            seconds_to_micros("1577836800.123456"),
            Some(1_577_836_800_123_456)
        );
        assert_eq!(seconds_to_micros("-1.5"), Some(-1_500_000));
        assert_eq!(seconds_to_micros("0"), Some(0));
        assert_eq!(seconds_to_micros("1.0E-7"), Some(0));
        assert_eq!(seconds_to_micros("abc"), None);
    }

    #[test]
    fn converts_scalar_types() {
        assert_eq!(scalar("INT64", &json!("42")), json!(42));
        assert_eq!(
            scalar("INTEGER", &json!("9223372036854775807")),
            json!("9223372036854775807")
        );
        assert_eq!(scalar("FLOAT64", &json!("1.5")), json!(1.5));
        assert_eq!(scalar("FLOAT", &json!("NaN")), json!("NaN"));
        assert_eq!(scalar("BOOL", &json!("true")), json!(true));
        assert_eq!(
            scalar("NUMERIC", &json!("12345678901234567890.123456789")),
            json!("12345678901234567890.123456789")
        );
        assert_eq!(scalar("BIGNUMERIC", &json!("1e38")), json!("1e38"));
        assert_eq!(
            scalar("TIMESTAMP", &json!("1.577836800E9")),
            json!("2020-01-01 00:00:00 UTC")
        );
        assert_eq!(
            scalar("TIMESTAMP", &json!("1577836800.123456")),
            json!("2020-01-01 00:00:00.123456 UTC")
        );
        assert_eq!(scalar("DATE", &json!("2020-01-01")), json!("2020-01-01"));
        assert_eq!(
            scalar("DATETIME", &json!("2020-01-01T10:00:00")),
            json!("2020-01-01T10:00:00")
        );
        assert_eq!(scalar("TIME", &json!("10:00:00.5")), json!("10:00:00.5"));
        assert_eq!(
            scalar("GEOGRAPHY", &json!("POINT(1 2)")),
            json!("POINT(1 2)")
        );
        assert_eq!(scalar("JSON", &json!("{\"a\":[1]}")), json!({"a": [1]}));
        assert_eq!(scalar("BYTES", &json!("AAH/")), json!("\\x0001ff"));
        assert_eq!(scalar("STRING", &Value::Null), Value::Null);
    }

    #[test]
    fn flattens_records_and_keeps_repeated_as_json() {
        let leaves = leaves(&schema());
        let names: Vec<&str> = leaves.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(
            names,
            ["id", "info.city", "info.geo.lat", "tags", "items", "raw"]
        );
        assert_eq!(leaves[0].data_type, "INT64");
        assert!(!leaves[0].nullable);
        assert_eq!(leaves[3].data_type, "ARRAY<STRING>");
        assert_eq!(leaves[4].data_type, "ARRAY<STRUCT>");
        let rows = convert_rows(&schema(), &json!([row("7")]));
        assert_eq!(
            rows[0],
            vec![
                json!(7),
                json!("Berlin"),
                json!(52.5),
                json!(["a", "b"]),
                json!([{"sku": "x1", "qty": 2}]),
                json!("\\x0001ff"),
            ]
        );
        let nulls = convert_rows(
            &schema(),
            &json!([{"f": [{"v": "1"}, {"v": null}, {"v": []}, {"v": []}, {"v": null}]}]),
        );
        assert_eq!(nulls[0][1], Value::Null);
        assert_eq!(nulls[0][2], Value::Null);
        assert_eq!(nulls[0][3], json!([]));
    }

    fn catalog_server() -> http_mock::MockServer {
        http_mock::start(|req| {
            let route = req.route().to_string();
            let body = match route.as_str() {
                "/bigquery/v2/projects/proj/datasets" => {
                    if req.query("pageToken").is_none() {
                        json!({"datasets": [{"datasetReference": {"datasetId": "zeta"}}], "nextPageToken": "p2"})
                    } else {
                        json!({"datasets": [{"datasetReference": {"datasetId": "alpha"}}]})
                    }
                }
                "/bigquery/v2/projects/proj/datasets/ds/tables" => json!({"tables": [
                    {"tableReference": {"tableId": "orders"}, "type": "TABLE"},
                    {"tableReference": {"tableId": "v_orders"}, "type": "VIEW"},
                    {"tableReference": {"tableId": "ext"}, "type": "EXTERNAL"}
                ]}),
                "/bigquery/v2/projects/proj/datasets/ds/tables/orders" => {
                    json!({"type": "TABLE", "numRows": "1234", "schema": schema(), "description": "Bestellungen"})
                }
                "/bigquery/v2/projects/proj/datasets/ds/tables/ext" => {
                    json!({"type": "EXTERNAL", "schema": {"fields": [{"name": "x", "type": "STRING"}]}})
                }
                "/bigquery/v2/projects/proj/datasets/ds/tables/v_orders" => {
                    json!({"type": "VIEW", "schema": {"fields": [{"name": "id", "type": "INT64"}]}, "view": {"query": "SELECT 1 AS id"}})
                }
                "/bigquery/v2/projects/proj/datasets/ds/tables/orders/data" => {
                    if req.query("pageToken").is_none() {
                        assert_eq!(req.query("startIndex").as_deref(), Some("5"));
                        json!({"totalRows": "1234", "rows": [row("1")], "pageToken": "t2"})
                    } else {
                        json!({"rows": [row("2"), row("3")]})
                    }
                }
                _ => {
                    return (
                        404,
                        json!({"error": {"message": format!("unbekannt {route}")}})
                            .to_string()
                            .into(),
                    )
                }
            };
            (200, body.to_string().into())
        })
    }

    #[tokio::test]
    async fn catalog_uses_rest_metadata_with_paging() {
        let server = catalog_server();
        let a = adapter(&server.base, "");
        assert_eq!(a.list_schemas().await.unwrap(), ["alpha", "zeta"]);
        let tables = a.list_tables(Some("ds")).await.unwrap();
        let names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["ext", "orders"]);
        let views = a.list_views(None).await.unwrap();
        assert_eq!(views[0].name, "v_orders");
        assert_eq!(
            a.get_view_definition("ds", "v_orders").await.unwrap(),
            "SELECT 1 AS id"
        );
        let columns = a
            .list_columns(Some("ds"), Some("orders"), None)
            .await
            .unwrap();
        assert_eq!(columns[1].name, "info.city");
        let all = a.list_columns(Some("ds"), None, None).await.unwrap();
        assert_eq!(all.len(), 7);
        let detailed = a.list_table_columns_detailed("ds", "orders").await.unwrap();
        assert_eq!(detailed.len(), 6);
        assert_eq!(detailed[5].ordinal_position, 6);
        assert_eq!(
            a.table_comment("ds", "orders").await.unwrap().as_deref(),
            Some("Bestellungen")
        );
        assert_eq!(
            a.count_rows("ds", "orders", None, false).await.unwrap(),
            1234
        );
        let data = a
            .fetch_rows("ds", "orders", None, 3, 5, None, false, false, false)
            .await
            .unwrap();
        assert_eq!(data.rows.len(), 3);
        assert_eq!(data.columns[2], "info.geo.lat");
        assert_eq!(data.rows[2]["id"], json!(3));
        assert_eq!(data.rows[0]["items"], json!([{"sku": "x1", "qty": 2}]));
        let requests = server.requests();
        assert!(requests.iter().all(|r| r.header("authorization").is_none()));
        assert!(!requests.iter().any(|r| r.route().ends_with("/queries")));
    }

    #[tokio::test]
    async fn filtered_reads_and_queries_poll_and_page() {
        let server = http_mock::start(|req| {
            let route = req.route().to_string();
            let body = match (req.method.as_str(), route.as_str()) {
                ("GET", "/bigquery/v2/projects/proj/datasets/ds/tables/orders") => {
                    json!({"type": "TABLE", "schema": schema()})
                }
                ("POST", "/bigquery/v2/projects/proj/queries") => {
                    let body = req.json();
                    assert_eq!(body["useLegacySql"], json!(false));
                    assert_eq!(body["location"], json!("EU"));
                    assert_eq!(body["defaultDataset"]["datasetId"], json!("ds"));
                    let sql = body["query"].as_str().unwrap().to_string();
                    if sql.starts_with("UPDATE") {
                        json!({"jobComplete": true, "jobReference": {"jobId": "j2", "location": "EU"}, "numDmlAffectedRows": "5"})
                    } else {
                        assert!(
                            sql.contains("FROM `proj`.`ds`.`orders` WHERE id > 1 ORDER BY `info`.`city` DESC LIMIT 10 OFFSET 0")
                                || sql == "SELECT 1",
                            "{sql}"
                        );
                        json!({"jobComplete": false, "jobReference": {"jobId": "j1", "location": "EU"}})
                    }
                }
                ("GET", "/bigquery/v2/projects/proj/queries/j1") => {
                    assert_eq!(req.query("location").as_deref(), Some("EU"));
                    if req.query("pageToken").is_none() {
                        json!({"jobComplete": true, "schema": schema(), "rows": [row("1")], "pageToken": "n"})
                    } else {
                        json!({"jobComplete": true, "schema": schema(), "rows": [row("2")]})
                    }
                }
                _ => return (404, "{}".into()),
            };
            (200, body.to_string().into())
        });
        let a = adapter(&server.base, "&location=EU");
        let data = a
            .fetch_rows(
                "ds",
                "orders",
                Some("id > 1"),
                10,
                0,
                Some("info.city"),
                true,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(data.rows.len(), 2);
        assert_eq!(data.rows[1]["id"], json!(2));
        let result = a.execute_query("SELECT 1").await.unwrap();
        assert_eq!(result.columns.len(), 6);
        assert_eq!(result.rows.len(), 2);
        let dml = a.execute_query("UPDATE t SET x = 1").await.unwrap();
        assert_eq!(dml.rows_affected, Some(5));
        assert!(dml.columns.is_empty());
    }

    #[tokio::test]
    async fn dry_run_explain_reports_bytes() {
        let server = http_mock::start(|req| {
            assert_eq!(req.route(), "/bigquery/v2/projects/proj/jobs");
            assert_eq!(req.header("authorization"), Some("Bearer tok"));
            let body = req.json();
            assert_eq!(body["configuration"]["dryRun"], json!(true));
            (
                200,
                json!({"statistics": {"totalBytesProcessed": "2048", "query": {
                    "totalBytesProcessed": "2048", "statementType": "SELECT",
                    "referencedTables": [{"projectId": "proj", "datasetId": "ds", "tableId": "orders"}]
                }}})
                .to_string()
                .into(),
            )
        });
        let a = BigqueryAdapter::new(&format!(
            "bigquery://token:tok@proj/ds?endpoint={}",
            encode(&server.base)
        ))
        .unwrap();
        let plan = a
            .explain_query("SELECT * FROM orders", false)
            .await
            .unwrap();
        assert_eq!(plan[0]["Plan"]["Bytes Processed"], json!(2048));
        assert_eq!(plan[0]["Plan"]["Estimated Bytes"], json!("2.0 kB"));
        assert_eq!(plan[0]["Plan"]["Relation Name"], json!("proj.ds.orders"));
    }

    #[tokio::test]
    async fn cancel_calls_jobs_cancel() {
        let server = http_mock::start(|req| {
            let body = match (req.method.as_str(), req.route()) {
                ("POST", "/bigquery/v2/projects/proj/queries") => {
                    json!({"jobComplete": false, "jobReference": {"jobId": "slow", "location": "US"}})
                }
                ("GET", "/bigquery/v2/projects/proj/queries/slow") => {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    json!({"jobComplete": false})
                }
                ("POST", "/bigquery/v2/projects/proj/jobs/slow/cancel") => {
                    assert_eq!(req.query("location").as_deref(), Some("US"));
                    json!({"job": {}})
                }
                _ => return (404, "{}".into()),
            };
            (200, body.to_string().into())
        });
        let a = adapter(&server.base, "");
        let run = execution::run(
            Some(ExecutionOptions {
                job_id: Some("bq-cancel-test".into()),
                ..Default::default()
            }),
            true,
            a.execute_query("SELECT slow"),
        );
        let cancel = async {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            assert!(execution::cancel("bq-cancel-test").unwrap());
        };
        let (result, _) = tokio::join!(run, cancel);
        let err = result.unwrap_err();
        assert!(err.contains("abgebrochen"), "{err}");
        assert!(server
            .requests()
            .iter()
            .any(|r| r.route() == "/bigquery/v2/projects/proj/jobs/slow/cancel"));
    }

    #[tokio::test]
    async fn api_errors_surface_message() {
        let server = http_mock::start(|_| {
            (
                403,
                json!({"error": {"code": 403, "message": "Access Denied: Project proj"}})
                    .to_string()
                    .into(),
            )
        });
        let err = adapter(&server.base, "")
            .test_connection()
            .await
            .unwrap_err();
        assert_eq!(err, "BigQuery 403: Access Denied: Project proj");
    }

    #[tokio::test]
    #[ignore]
    async fn emulator_end_to_end() {
        let Ok(url) = std::env::var("L8DB_E2E_BIGQUERY_URL") else {
            return;
        };
        let a = BigqueryAdapter::new(&url).unwrap();
        a.test_connection().await.unwrap();
        let schemas = a.list_schemas().await.unwrap();
        assert!(schemas.contains(&"dataset1".to_string()), "{schemas:?}");
        let tables = a.list_tables(Some("dataset1")).await.unwrap();
        assert!(tables.iter().any(|t| t.name == "table_a"), "{tables:?}");
        let columns = a
            .list_columns(Some("dataset1"), Some("table_a"), None)
            .await
            .unwrap();
        eprintln!("columns: {columns:?}");
        let data = a
            .fetch_rows(
                "dataset1", "table_a", None, 10, 0, None, false, false, false,
            )
            .await
            .unwrap();
        eprintln!("tabledata: {:?}", data.rows);
        assert!(!data.rows.is_empty());
        let count = a
            .count_rows("dataset1", "table_a", None, false)
            .await
            .unwrap();
        eprintln!("count: {count}");
        let filtered = a
            .fetch_rows(
                "dataset1",
                "table_a",
                Some("id = 1"),
                10,
                0,
                Some("id"),
                false,
                false,
                false,
            )
            .await
            .unwrap();
        eprintln!("filtered: {:?}", filtered.rows);
        assert_eq!(filtered.rows.len(), 1);
        let result = a
            .execute_query("SELECT 1 AS one, 'x' AS s, TIMESTAMP '2020-01-01 00:00:00.123456 UTC' AS ts, b'\\x00\\xff' AS b, [1, 2] AS arr, STRUCT(1 AS a, 'z' AS b) AS st, NUMERIC '1.25' AS n, DATE '2020-02-03' AS d")
            .await
            .unwrap();
        eprintln!("query: {:?} {:?}", result.columns, result.rows);
        assert_eq!(result.rows[0]["one"], json!(1));
        assert_eq!(
            result.rows[0]["ts"],
            json!("2020-01-01 00:00:00.123456 UTC")
        );
        assert_eq!(result.rows[0]["b"], json!("\\x00ff"));
        assert_eq!(result.rows[0]["arr"], json!([1, 2]));
        assert_eq!(result.rows[0]["st.a"], json!(1));
        let dml = a
            .execute_query("INSERT INTO dataset1.table_a (id, name) VALUES (99, 'neu')")
            .await
            .unwrap();
        eprintln!("dml: {:?}", dml.rows_affected);
    }
}
