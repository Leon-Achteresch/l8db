use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use async_trait::async_trait;
use base64::Engine;
use serde_json::{json, Map, Value};

use super::filter_expr::{self, Cmp, Expr, LikePart, Literal};
use super::http_api::{self, text, Reply};
use super::{
    unsupported, ColumnInfo, DatabaseAdapter, DetailedColumnInfo, QueryResult, TableData, TableInfo,
};

const WINDOW: i64 = 10_000;
const CLOUD_HOSTS: [&str; 5] = [
    ".elastic-cloud.com",
    ".found.io",
    ".elastic.cloud",
    ".es.amazonaws.com",
    ".aoss.amazonaws.com",
];
const METHODS: [&str; 6] = ["GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"];
const READ_ENDPOINTS: [&str; 11] = [
    "_search",
    "_count",
    "_msearch",
    "_sql",
    "_mget",
    "_field_caps",
    "_validate",
    "_explain",
    "_termvectors",
    "_mtermvectors",
    "_pit",
];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Flavor {
    Elastic,
    OpenSearch,
}

#[derive(Clone, Debug, PartialEq)]
enum Auth {
    None,
    Basic(String, String),
    ApiKey(String),
    Bearer(String),
}

pub struct ElasticAdapter {
    base: String,
    auth: Auth,
    insecure: bool,
    hint: Option<Flavor>,
}

#[derive(Clone, Debug)]
struct Field {
    name: String,
    kind: String,
    keyword: Option<String>,
}

fn flavors() -> &'static Mutex<HashMap<String, Flavor>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Flavor>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn encode_segment(name: &str) -> String {
    let mut out = String::new();
    for b in name.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.*,+:@".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn literal_json(value: &Literal) -> Value {
    match value {
        Literal::Text(t) => Value::String(t.clone()),
        Literal::Number(n) => serde_json::from_str::<serde_json::Number>(n)
            .map(Value::Number)
            .unwrap_or_else(|_| Value::String(n.clone())),
        Literal::Bool(b) => Value::Bool(*b),
        Literal::Null => Value::Null,
    }
}

fn wildcard(pattern: &str, escape: Option<char>) -> String {
    let mut out = String::new();
    for part in filter_expr::like_parts(pattern, escape) {
        match part {
            LikePart::Any => out.push('*'),
            LikePart::One => out.push('?'),
            LikePart::Text(t) => {
                for c in t.chars() {
                    if matches!(c, '*' | '?' | '\\') {
                        out.push('\\');
                    }
                    out.push(c);
                }
            }
        }
    }
    out
}

fn flatten_fields(properties: &Map<String, Value>, prefix: &str, out: &mut Vec<Field>) {
    for (name, def) in properties {
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}.{name}")
        };
        let kind = def.get("type").and_then(Value::as_str);
        match def.get("properties").and_then(Value::as_object) {
            Some(children) if kind != Some("nested") => flatten_fields(children, &path, out),
            _ => {
                let keyword = def
                    .get("fields")
                    .and_then(Value::as_object)
                    .and_then(|fields| {
                        fields.iter().find(|(_, sub)| {
                            sub.get("type").and_then(Value::as_str) == Some("keyword")
                        })
                    })
                    .map(|(sub, _)| format!("{path}.{sub}"));
                if out.iter().all(|f| f.name != path) {
                    out.push(Field {
                        name: path,
                        kind: kind.unwrap_or("object").to_string(),
                        keyword,
                    });
                }
            }
        }
    }
}

fn mapping_fields(mapping: &Value) -> Vec<Field> {
    let mut out = Vec::new();
    if let Some(indices) = mapping.as_object() {
        for index in indices.values() {
            let mappings = &index["mappings"];
            let properties = mappings
                .get("properties")
                .or_else(|| {
                    mappings
                        .as_object()
                        .and_then(|m| m.values().find_map(|t| t.get("properties")))
                })
                .and_then(Value::as_object);
            if let Some(properties) = properties {
                flatten_fields(properties, "", &mut out);
            }
        }
    }
    out
}

fn flatten_value(
    value: &Value,
    prefix: &str,
    leaves: &HashSet<String>,
    out: &mut Map<String, Value>,
) {
    match value {
        Value::Object(map) if !prefix.is_empty() && leaves.contains(prefix) => {
            out.insert(prefix.to_string(), Value::Object(map.clone()));
        }
        Value::Object(map) if !map.is_empty() || prefix.is_empty() => {
            for (key, child) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten_value(child, &path, leaves, out);
            }
        }
        other => {
            out.insert(prefix.to_string(), other.clone());
        }
    }
}

fn hit_row(hit: &Value, with_index: bool, leaves: &HashSet<String>) -> Map<String, Value> {
    let mut row = Map::new();
    if with_index {
        row.insert("_index".into(), hit["_index"].clone());
    }
    row.insert("_id".into(), hit["_id"].clone());
    if let Some(source) = hit.get("_source") {
        flatten_value(source, "", leaves, &mut row);
    }
    if let Some(fields) = hit.get("fields").and_then(Value::as_object) {
        for (key, value) in fields {
            row.entry(key.clone()).or_insert_with(|| match value {
                Value::Array(items) if items.len() == 1 => items[0].clone(),
                other => other.clone(),
            });
        }
    }
    row
}

fn objects_result(
    objects: Vec<Map<String, Value>>,
    base: Vec<String>,
) -> (Vec<String>, Vec<Value>) {
    let mut columns = base;
    for object in &objects {
        for key in object.keys() {
            if !columns.contains(key) {
                columns.push(key.clone());
            }
        }
    }
    let rows = objects
        .into_iter()
        .map(|mut object| {
            let mut row = Map::with_capacity(columns.len());
            for column in &columns {
                row.insert(column.clone(), object.remove(column).unwrap_or(Value::Null));
            }
            Value::Object(row)
        })
        .collect();
    (columns, rows)
}

fn flat(value: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    flatten_value(value, "", &HashSet::new(), &mut out);
    out
}

fn response_rows(value: &Value) -> (Vec<String>, Vec<Value>) {
    if let Some(items) = value.as_array() {
        if items.iter().all(Value::is_object) {
            return objects_result(items.iter().map(flat).collect(), vec![]);
        }
        return objects_result(
            items
                .iter()
                .map(|v| Map::from_iter([("value".to_string(), v.clone())]))
                .collect(),
            vec![],
        );
    }
    let hits = value
        .pointer("/hits/hits")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let aggregations = value.get("aggregations").and_then(Value::as_object);
    if !hits.is_empty() || (value.get("hits").is_some() && aggregations.is_none()) {
        let indices: HashSet<&str> = hits.iter().filter_map(|h| h["_index"].as_str()).collect();
        let with_index = indices.len() > 1;
        let base = if with_index {
            vec!["_index".to_string(), "_id".to_string()]
        } else {
            vec!["_id".to_string()]
        };
        return objects_result(
            hits.iter()
                .map(|h| hit_row(h, with_index, &HashSet::new()))
                .collect(),
            base,
        );
    }
    if let Some(aggregations) = aggregations {
        for agg in aggregations.values() {
            if let Some(buckets) = agg.get("buckets") {
                let objects: Vec<Map<String, Value>> = match buckets {
                    Value::Array(items) => items.iter().map(flat).collect(),
                    Value::Object(map) => map
                        .iter()
                        .map(|(key, bucket)| {
                            let mut row = Map::from_iter([("key".to_string(), json!(key))]);
                            row.extend(flat(bucket));
                            row
                        })
                        .collect(),
                    _ => vec![],
                };
                return objects_result(objects, vec![]);
            }
        }
        return objects_result(vec![flat(&Value::Object(aggregations.clone()))], vec![]);
    }
    objects_result(vec![flat(value)], vec![])
}

struct ConsoleRequest {
    method: String,
    path: String,
    body: Option<String>,
}

fn console_requests(input: &str) -> Option<Vec<ConsoleRequest>> {
    let mut requests: Vec<ConsoleRequest> = Vec::new();
    let mut body = String::new();
    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with("//") {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let head = parts.next().unwrap_or_default().to_ascii_uppercase();
        let rest = parts.next().map(str::trim).unwrap_or_default();
        if METHODS.contains(&head.as_str()) && !rest.is_empty() && !rest.starts_with('{') {
            if let Some(last) = requests.last_mut() {
                last.body = Some(std::mem::take(&mut body)).filter(|b| !b.trim().is_empty());
            }
            requests.push(ConsoleRequest {
                method: head,
                path: rest.trim_start_matches('/').to_string(),
                body: None,
            });
            continue;
        }
        if requests.is_empty() {
            if trimmed.is_empty() {
                continue;
            }
            return None;
        }
        body.push_str(line);
        body.push('\n');
    }
    if let Some(last) = requests.last_mut() {
        last.body = Some(body).filter(|b| !b.trim().is_empty());
    }
    (!requests.is_empty()).then_some(requests)
}

pub fn read_only_request(statement: &str) -> Option<bool> {
    let requests = console_requests(statement)?;
    Some(requests.iter().all(|r| {
        let path = r.path.split('?').next().unwrap_or_default();
        matches!(r.method.as_str(), "GET" | "HEAD")
            || (r.method == "POST"
                && path
                    .split('/')
                    .any(|segment| READ_ENDPOINTS.contains(&segment)))
    }))
}

pub fn is_index_ddl(statement: &str) -> bool {
    console_requests(statement).is_some_and(|requests| {
        requests.iter().any(|r| {
            let path = r.path.split('?').next().unwrap_or_default();
            let target = path.split('/').next().unwrap_or_default();
            matches!(r.method.as_str(), "PUT" | "DELETE")
                && (!path.contains('/')
                    || target.starts_with('_')
                    || path.ends_with("/_mapping")
                    || path.ends_with("/_settings")
                    || path.contains("/_alias"))
        })
    })
}

impl ElasticAdapter {
    pub fn new(connection_string: &str) -> Result<Self, String> {
        let url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige Elasticsearch-URL".to_string())?;
        if !matches!(
            url.scheme(),
            "elasticsearch" | "opensearch" | "http" | "https"
        ) {
            return Err("Eine elasticsearch:// oder opensearch:// URL ist erforderlich".into());
        }
        let host = url
            .host_str()
            .ok_or("Host fehlt in der URL")?
            .to_lowercase();
        let tls = http_api::tls(&url, CLOUD_HOSTS.iter().any(|h| host.ends_with(h)));
        let port = url.port().unwrap_or(if tls.secure { 443 } else { 9200 });
        let prefix = url.path().trim_end_matches('/');
        let base = format!(
            "{}{}",
            http_api::base_url(&url, tls.secure, Some(port))?,
            prefix
        );
        let user = http_api::decode(url.username());
        let password = http_api::decode(url.password().unwrap_or(""));
        let auth = if let Some(key) = http_api::param(&url, &["api_key", "apikey"]) {
            Auth::ApiKey(key)
        } else if matches!(
            user.to_ascii_lowercase().as_str(),
            "apikey" | "api_key" | "api-key"
        ) {
            Auth::ApiKey(password)
        } else if user.eq_ignore_ascii_case("bearer") {
            Auth::Bearer(password)
        } else if !user.is_empty() {
            Auth::Basic(user, password)
        } else {
            Auth::None
        };
        let auth = match auth {
            Auth::ApiKey(key) if key.contains(':') => {
                Auth::ApiKey(base64::engine::general_purpose::STANDARD.encode(key))
            }
            other => other,
        };
        let hint = match url.scheme() {
            "opensearch" => Some(Flavor::OpenSearch),
            _ if host.ends_with(".es.amazonaws.com") || host.ends_with(".aoss.amazonaws.com") => {
                Some(Flavor::OpenSearch)
            }
            _ => None,
        };
        Ok(Self {
            base,
            auth,
            insecure: tls.insecure,
            hint,
        })
    }

    fn label(&self) -> &'static str {
        match self
            .hint
            .or_else(|| flavors().lock().ok()?.get(&self.base).copied())
        {
            Some(Flavor::OpenSearch) => "OpenSearch",
            _ => "Elasticsearch",
        }
    }

    async fn send(
        &self,
        method: &str,
        path: &str,
        body: Option<String>,
        ndjson: bool,
    ) -> Result<Reply, String> {
        let method = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| format!("Unbekannte HTTP-Methode {method}"))?;
        let url = format!("{}/{}", self.base, path.trim_start_matches('/'));
        let mut request = http_api::client(self.insecure).request(method, url);
        request = match &self.auth {
            Auth::None => request,
            Auth::Basic(user, password) => request.basic_auth(user, Some(password)),
            Auth::ApiKey(key) => request.header("Authorization", format!("ApiKey {key}")),
            Auth::Bearer(token) => request.bearer_auth(token),
        };
        if let Some(body) = body {
            let (content_type, body) = if ndjson {
                (
                    "application/x-ndjson",
                    if body.ends_with('\n') {
                        body
                    } else {
                        format!("{body}\n")
                    },
                )
            } else {
                ("application/json", body)
            };
            request = request.header("Content-Type", content_type).body(body);
        }
        http_api::send(self.label(), request).await
    }

    async fn call(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        let reply = self
            .send(method, path, body.map(|b| b.to_string()), false)
            .await?;
        if !reply.ok() {
            return Err(format!(
                "{} {}: {}",
                self.label(),
                reply.status,
                http_api::error_message(&reply.body)
            ));
        }
        Ok(reply.json().unwrap_or(Value::Null))
    }

    async fn flavor(&self) -> Result<Flavor, String> {
        if let Some(hint) = self.hint {
            return Ok(hint);
        }
        if let Some(known) = flavors()
            .lock()
            .ok()
            .and_then(|c| c.get(&self.base).copied())
        {
            return Ok(known);
        }
        let info = self.call("GET", "", None).await?;
        let flavor = if info
            .pointer("/version/distribution")
            .and_then(Value::as_str)
            == Some("opensearch")
        {
            Flavor::OpenSearch
        } else {
            Flavor::Elastic
        };
        if let Ok(mut cache) = flavors().lock() {
            cache.insert(self.base.clone(), flavor);
        }
        Ok(flavor)
    }

    async fn fields(&self, table: &str) -> Result<Vec<Field>, String> {
        let mapping = self
            .call("GET", &format!("{}/_mapping", encode_segment(table)), None)
            .await?;
        Ok(mapping_fields(&mapping))
    }

    fn exact(field: &str, value: &Literal, fields: &[Field]) -> Value {
        if field == "_id" {
            return json!({"ids": {"values": [literal_json(value)]}});
        }
        match fields.iter().find(|f| f.name == field) {
            Some(Field {
                kind,
                keyword: None,
                ..
            }) if kind == "text" => json!({"match_phrase": {field: literal_json(value)}}),
            Some(Field {
                keyword: Some(k), ..
            }) => json!({"term": {k: literal_json(value)}}),
            _ => json!({"term": {field: literal_json(value)}}),
        }
    }

    fn term_field(field: &str, fields: &[Field]) -> String {
        fields
            .iter()
            .find(|f| f.name == field)
            .and_then(|f| f.keyword.clone())
            .unwrap_or_else(|| field.to_string())
    }

    fn to_dsl(expr: &Expr, fields: &[Field]) -> Value {
        match expr {
            Expr::And(parts) => {
                json!({"bool": {"filter": parts.iter().map(|p| Self::to_dsl(p, fields)).collect::<Vec<_>>()}})
            }
            Expr::Or(parts) => json!({"bool": {
                "should": parts.iter().map(|p| Self::to_dsl(p, fields)).collect::<Vec<_>>(),
                "minimum_should_match": 1
            }}),
            Expr::Not(inner) => json!({"bool": {"must_not": [Self::to_dsl(inner, fields)]}}),
            Expr::IsNull(field) => json!({"bool": {"must_not": [{"exists": {"field": field}}]}}),
            Expr::Compare(field, Cmp::Eq, Literal::Null) => {
                Self::to_dsl(&Expr::IsNull(field.clone()), fields)
            }
            Expr::Compare(field, Cmp::Ne, Literal::Null) => {
                json!({"exists": {"field": field}})
            }
            Expr::Compare(field, Cmp::Eq, value) => Self::exact(field, value, fields),
            Expr::Compare(field, Cmp::Ne, value) => {
                json!({"bool": {"must_not": [Self::exact(field, value, fields)]}})
            }
            Expr::Compare(field, op, value) => {
                let key = match op {
                    Cmp::Lt => "lt",
                    Cmp::Le => "lte",
                    Cmp::Gt => "gt",
                    _ => "gte",
                };
                json!({"range": {Self::term_field(field, fields): {key: literal_json(value)}}})
            }
            Expr::In(field, values) => {
                if field == "_id" {
                    return json!({"ids": {"values": values.iter().map(literal_json).collect::<Vec<_>>()}});
                }
                let text_only = fields
                    .iter()
                    .any(|f| f.name == *field && f.kind == "text" && f.keyword.is_none());
                if text_only {
                    json!({"bool": {
                        "should": values.iter().map(|v| Self::exact(field, v, fields)).collect::<Vec<_>>(),
                        "minimum_should_match": 1
                    }})
                } else {
                    json!({"terms": {Self::term_field(field, fields): values.iter().map(literal_json).collect::<Vec<_>>()}})
                }
            }
            Expr::Like {
                field,
                pattern,
                escape,
                insensitive,
            } => {
                let mut spec = json!({"value": wildcard(pattern, *escape)});
                if *insensitive {
                    spec["case_insensitive"] = json!(true);
                }
                json!({"wildcard": {Self::term_field(field, fields): spec}})
            }
        }
    }

    fn build_query(filter: Option<&str>, fields: &[Field]) -> Result<Value, String> {
        let Some(filter) = filter.map(str::trim).filter(|f| !f.is_empty()) else {
            return Ok(json!({"match_all": {}}));
        };
        if filter.starts_with('{') {
            let value: Value = serde_json::from_str(filter)
                .map_err(|e| format!("Query-DSL ist kein gültiges JSON: {e}"))?;
            return Ok(value.get("query").cloned().unwrap_or(value));
        }
        Ok(match filter_expr::parse(filter) {
            Ok(expr) => Self::to_dsl(&expr, fields),
            Err(_) => json!({"query_string": {"query": filter}}),
        })
    }

    fn sort_spec(order_by: Option<&str>, desc: bool, fields: &[Field]) -> Vec<Value> {
        let Some(column) = order_by else {
            return vec![];
        };
        let Some(field) = fields.iter().find(|f| f.name == column) else {
            return vec![];
        };
        if matches!(field.kind.as_str(), "object" | "nested")
            || (field.kind == "text" && field.keyword.is_none())
        {
            return vec![];
        }
        let target = field.keyword.clone().unwrap_or_else(|| field.name.clone());
        vec![
            json!({target: {"order": if desc { "desc" } else { "asc" }, "unmapped_type": "keyword"}}),
        ]
    }

    async fn deep_hits(
        &self,
        table: &str,
        query: &Value,
        sort: &[Value],
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Value>, String> {
        let mut hits = Vec::new();
        match self.flavor().await? {
            Flavor::Elastic => {
                let pit = self
                    .call(
                        "POST",
                        &format!("{}/_pit?keep_alive=1m", encode_segment(table)),
                        None,
                    )
                    .await?;
                let id = pit["id"].clone();
                let mut sort = sort.to_vec();
                sort.push(json!({"_shard_doc": "asc"}));
                let mut after: Option<Value> = None;
                let mut skipped = 0;
                let outcome: Result<(), String> = async {
                    loop {
                        let skipping = skipped < offset;
                        let size = if skipping {
                            (offset - skipped).min(WINDOW)
                        } else {
                            (limit - hits.len() as i64).min(WINDOW)
                        };
                        if size <= 0 {
                            return Ok(());
                        }
                        let mut body = json!({
                            "size": size,
                            "query": query,
                            "sort": sort,
                            "pit": {"id": id, "keep_alive": "1m"},
                            "track_total_hits": false,
                        });
                        if skipping {
                            body["_source"] = json!(false);
                        }
                        if let Some(after) = &after {
                            body["search_after"] = after.clone();
                        }
                        let page = self.call("POST", "_search", Some(body)).await?;
                        let batch = page
                            .pointer("/hits/hits")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default();
                        let Some(last) = batch.last() else {
                            return Ok(());
                        };
                        after = Some(last["sort"].clone());
                        if skipping {
                            skipped += batch.len() as i64;
                        } else {
                            hits.extend(batch);
                        }
                    }
                }
                .await;
                let _ = self.call("DELETE", "_pit", Some(json!({"id": id}))).await;
                outcome?;
            }
            Flavor::OpenSearch => {
                let mut body = json!({"size": WINDOW, "query": query});
                if !sort.is_empty() {
                    body["sort"] = json!(sort);
                } else {
                    body["sort"] = json!(["_doc"]);
                }
                let mut page = self
                    .call(
                        "POST",
                        &format!("{}/_search?scroll=1m", encode_segment(table)),
                        Some(body),
                    )
                    .await?;
                let mut seen = 0i64;
                let outcome: Result<(), String> = async {
                    loop {
                        let batch = page
                            .pointer("/hits/hits")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default();
                        if batch.is_empty() {
                            return Ok(());
                        }
                        for hit in batch {
                            if seen >= offset && (hits.len() as i64) < limit {
                                hits.push(hit);
                            }
                            seen += 1;
                        }
                        if hits.len() as i64 >= limit {
                            return Ok(());
                        }
                        page = self
                            .call(
                                "POST",
                                "_search/scroll",
                                Some(json!({"scroll": "1m", "scroll_id": page["_scroll_id"]})),
                            )
                            .await?;
                    }
                }
                .await;
                if let Some(id) = page.get("_scroll_id") {
                    let _ = self
                        .call("DELETE", "_search/scroll", Some(json!({"scroll_id": [id]})))
                        .await;
                }
                outcome?;
            }
        }
        Ok(hits)
    }

    async fn sql(&self, sql: &str) -> Result<(Vec<String>, Vec<Vec<Value>>), String> {
        let statement = sql.trim().trim_end_matches(';');
        match self.flavor().await? {
            Flavor::Elastic => {
                let result = self
                    .call(
                        "POST",
                        "_sql?format=json",
                        Some(json!({"query": statement, "fetch_size": 1000})),
                    )
                    .await?;
                if let Some(cursor) = result.get("cursor").filter(|c| !c.is_null()) {
                    let _ = self
                        .call("POST", "_sql/close", Some(json!({"cursor": cursor})))
                        .await;
                }
                let columns = result["columns"]
                    .as_array()
                    .map(|c| c.iter().map(|c| text(&c["name"])).collect())
                    .unwrap_or_default();
                let rows = result["rows"]
                    .as_array()
                    .map(|r| {
                        r.iter()
                            .map(|row| row.as_array().cloned().unwrap_or_default())
                            .collect()
                    })
                    .unwrap_or_default();
                Ok((columns, rows))
            }
            Flavor::OpenSearch => {
                let result = self
                    .call(
                        "POST",
                        "_plugins/_sql?format=jdbc",
                        Some(json!({"query": statement})),
                    )
                    .await?;
                if let Some(cursor) = result.get("cursor").filter(|c| !c.is_null()) {
                    let _ = self
                        .call(
                            "POST",
                            "_plugins/_sql/close",
                            Some(json!({"cursor": cursor})),
                        )
                        .await;
                }
                let columns = result["schema"]
                    .as_array()
                    .map(|c| {
                        c.iter()
                            .map(|c| {
                                c.get("alias")
                                    .filter(|a| !a.is_null())
                                    .map(text)
                                    .unwrap_or_else(|| text(&c["name"]))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let rows = result["datarows"]
                    .as_array()
                    .map(|r| {
                        r.iter()
                            .map(|row| row.as_array().cloned().unwrap_or_default())
                            .collect()
                    })
                    .unwrap_or_default();
                Ok((columns, rows))
            }
        }
    }

    async fn console(
        &self,
        requests: Vec<ConsoleRequest>,
    ) -> Result<(Vec<String>, Vec<Value>), String> {
        let mut last = (vec![], vec![]);
        for request in requests {
            let mut path = request.path;
            if path.starts_with("_cat/") && !path.contains("format=") {
                path.push_str(if path.contains('?') {
                    "&format=json"
                } else {
                    "?format=json"
                });
            }
            let ndjson = path.contains("_bulk") || path.contains("_msearch");
            let reply = self
                .send(&request.method, &path, request.body, ndjson)
                .await?;
            if !reply.ok() {
                return Err(format!(
                    "{} {}: {}",
                    self.label(),
                    reply.status,
                    http_api::error_message(&reply.body)
                ));
            }
            last = match reply.json() {
                Some(value) => response_rows(&value),
                None if reply.body.trim().is_empty() => (
                    vec!["status".to_string()],
                    vec![json!({"status": reply.status})],
                ),
                None => (
                    vec!["result".to_string()],
                    reply.body.lines().map(|l| json!({"result": l})).collect(),
                ),
            };
        }
        Ok(last)
    }
}

#[async_trait]
impl DatabaseAdapter for ElasticAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.call("GET", "", None).await.map(|_| ())
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let info = self.call("GET", "", None).await?;
        Ok(vec![info
            .get("cluster_name")
            .map(text)
            .unwrap_or_else(|| self.label().to_string())])
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(vec![
            "indices".to_string(),
            "data_streams".to_string(),
            "aliases".to_string(),
        ])
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let schema = schema
            .filter(|s| matches!(*s, "data_streams" | "aliases"))
            .unwrap_or("indices");
        let mut names: Vec<String> = match schema {
            "data_streams" => match self.call("GET", "_data_stream", None).await {
                Ok(value) => value["data_streams"]
                    .as_array()
                    .map(|a| a.iter().map(|d| text(&d["name"])).collect())
                    .unwrap_or_default(),
                Err(e) if e.contains(" 404:") || e.contains(" 400:") => vec![],
                Err(e) => return Err(e),
            },
            "aliases" => {
                let value = self.call("GET", "_alias", None).await?;
                let mut set: Vec<String> = value
                    .as_object()
                    .map(|indices| {
                        indices
                            .values()
                            .filter_map(|i| i["aliases"].as_object())
                            .flat_map(|a| a.keys().cloned())
                            .collect()
                    })
                    .unwrap_or_default();
                set.sort();
                set.dedup();
                set
            }
            _ => {
                let value = self
                    .call("GET", "_cat/indices?format=json&h=index", None)
                    .await?;
                value
                    .as_array()
                    .map(|a| a.iter().map(|i| text(&i["index"])).collect())
                    .unwrap_or_default()
            }
        };
        names.retain(|n| !n.starts_with('.'));
        names.sort();
        Ok(names
            .into_iter()
            .map(|name| TableInfo {
                schema: schema.to_string(),
                name,
            })
            .collect())
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        _table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let schema_name = schema.unwrap_or("indices").to_string();
        let tables: Vec<String> = match table {
            Some(t) => vec![t.to_string()],
            None => self
                .list_tables(schema)
                .await?
                .into_iter()
                .map(|t| t.name)
                .collect(),
        };
        let mut out = Vec::new();
        for table in tables {
            let fields = self.fields(&table).await?;
            out.push(ColumnInfo {
                schema: schema_name.clone(),
                table: table.clone(),
                name: "_id".into(),
                data_type: "_id".into(),
            });
            out.extend(fields.into_iter().map(|f| ColumnInfo {
                schema: schema_name.clone(),
                table: table.clone(),
                name: f.name,
                data_type: f.kind,
            }));
        }
        Ok(out)
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
        _allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let fields = self.fields(table).await?;
        let query = Self::build_query(filter, &fields)?;
        let sort = Self::sort_spec(order_by, order_desc, &fields);
        let (limit, offset) = (limit.max(0), offset.max(0));
        let hits = if offset + limit <= WINDOW {
            let mut body = json!({
                "from": offset,
                "size": limit,
                "query": query,
                "track_total_hits": false,
            });
            if !sort.is_empty() {
                body["sort"] = json!(sort);
            }
            let result = self
                .call(
                    "POST",
                    &format!("{}/_search", encode_segment(table)),
                    Some(body),
                )
                .await?;
            result
                .pointer("/hits/hits")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        } else {
            self.deep_hits(table, &query, &sort, offset, limit).await?
        };
        let with_index = schema != "indices" || table.contains('*') || table.contains(',');
        let leaves: HashSet<String> = fields.iter().map(|f| f.name.clone()).collect();
        let mut base = Vec::new();
        if with_index {
            base.push("_index".to_string());
        }
        base.push("_id".to_string());
        base.extend(fields.iter().map(|f| f.name.clone()));
        let (columns, rows) = objects_result(
            hits.iter()
                .map(|h| hit_row(h, with_index, &leaves))
                .collect(),
            base,
        );
        Ok(TableData { columns, rows })
    }

    async fn count_rows(
        &self,
        _schema: &str,
        table: &str,
        filter: Option<&str>,
        _allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let fields = if filter.is_some_and(|f| !f.trim().is_empty()) {
            self.fields(table).await?
        } else {
            vec![]
        };
        let query = Self::build_query(filter, &fields)?;
        let result = self
            .call(
                "POST",
                &format!("{}/_count", encode_segment(table)),
                Some(json!({"query": query})),
            )
            .await?;
        Ok(result["count"].as_i64().unwrap_or(0))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let (columns, rows) = match console_requests(sql) {
            Some(requests) => self.console(requests).await?,
            None => {
                let (columns, rows) = self.sql(sql).await?;
                let columns = super::unique_column_names(columns);
                let rows = super::rows_to_objects(&columns, rows);
                (columns, rows)
            }
        };
        Ok(QueryResult {
            columns,
            rows,
            rows_affected: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn list_table_columns_detailed(
        &self,
        _schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let fields = self.fields(table).await?;
        let mut out = vec![DetailedColumnInfo {
            name: "_id".into(),
            data_type: "_id".into(),
            is_nullable: false,
            column_default: None,
            is_primary_key: true,
            ordinal_position: 1,
            character_maximum_length: None,
            comment: None,
        }];
        out.extend(
            fields
                .into_iter()
                .enumerate()
                .map(|(i, f)| DetailedColumnInfo {
                    name: f.name,
                    data_type: f.kind,
                    is_nullable: true,
                    column_default: None,
                    is_primary_key: false,
                    ordinal_position: i as i32 + 2,
                    character_maximum_length: None,
                    comment: f.keyword.map(|k| format!("Keyword-Feld: {k}")),
                }),
        );
        Ok(out)
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let path = match schema {
            "data_streams" => format!("_data_stream/{}", encode_segment(table)),
            "aliases" => return Err(unsupported("Löschen von Aliasen")),
            _ => encode_segment(table),
        };
        self.call("DELETE", &path, None).await.map(|_| ())
    }

    async fn truncate_table(&self, _schema: &str, table: &str) -> Result<(), String> {
        self.call(
            "POST",
            &format!(
                "{}/_delete_by_query?refresh=true&conflicts=proceed",
                encode_segment(table)
            ),
            Some(json!({"query": {"match_all": {}}})),
        )
        .await
        .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields() -> Vec<Field> {
        mapping_fields(&json!({"logs": {"mappings": {"properties": {
            "message": {"type": "text"},
            "user": {"properties": {"name": {"type": "text", "fields": {"keyword": {"type": "keyword"}}}}},
            "age": {"type": "long"},
            "tags": {"type": "nested", "properties": {"k": {"type": "keyword"}}},
            "location": {"type": "geo_point"}
        }}}}))
    }

    #[test]
    fn parses_urls_and_auth() {
        let a = ElasticAdapter::new("elasticsearch://elastic:p%40ss@localhost:9200").unwrap();
        assert_eq!(a.base, "http://localhost:9200");
        assert_eq!(a.auth, Auth::Basic("elastic".into(), "p@ss".into()));
        let b =
            ElasticAdapter::new("elasticsearch://apikey:id:key@x.es.io:9243/proxy?sslmode=require")
                .unwrap();
        assert_eq!(b.base, "https://x.es.io:9243/proxy");
        assert!(b.insecure);
        assert_eq!(b.auth, Auth::ApiKey("aWQ6a2V5".into()));
        let c = ElasticAdapter::new("opensearch://search.eu.es.amazonaws.com").unwrap();
        assert_eq!(c.base, "https://search.eu.es.amazonaws.com:443");
        assert_eq!(c.hint, Some(Flavor::OpenSearch));
        assert_eq!(c.auth, Auth::None);
    }

    #[test]
    fn flattens_mapping_and_sources() {
        let f = fields();
        let names: Vec<&str> = f.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["message", "user.name", "age", "tags", "location"]);
        assert_eq!(f[1].keyword.as_deref(), Some("user.name.keyword"));
        let leaves: HashSet<String> = f.iter().map(|f| f.name.clone()).collect();
        let row = hit_row(
            &json!({"_index": "logs", "_id": "1", "_source": {"user": {"name": "a"}, "location": {"lat": 1, "lon": 2}}}),
            false,
            &leaves,
        );
        assert_eq!(row["user.name"], json!("a"));
        assert_eq!(row["location"], json!({"lat": 1, "lon": 2}));
    }

    #[test]
    fn translates_sql_filters_to_dsl() {
        let f = fields();
        let q = ElasticAdapter::build_query(
            Some("\"user.name\" = 'bob' AND \"age\" >= 21 AND \"message\" LIKE '%err!_x%' ESCAPE '!'"),
            &f,
        )
        .unwrap();
        assert_eq!(
            q,
            json!({"bool": {"filter": [
                {"term": {"user.name.keyword": "bob"}},
                {"range": {"age": {"gte": 21}}},
                {"wildcard": {"message": {"value": "*err_x*"}}}
            ]}})
        );
        assert_eq!(
            ElasticAdapter::build_query(Some("status:active"), &f).unwrap(),
            json!({"query_string": {"query": "status:active"}})
        );
        assert_eq!(
            ElasticAdapter::build_query(Some("{\"query\": {\"match\": {\"a\": 1}}}"), &f).unwrap(),
            json!({"match": {"a": 1}})
        );
        assert_eq!(
            ElasticAdapter::build_query(Some("\"message\" = 'x y'"), &f).unwrap(),
            json!({"match_phrase": {"message": "x y"}})
        );
    }

    #[test]
    fn parses_console_requests() {
        let requests = console_requests(
            "# Kommentar\nGET /logs/_search\n{\n  \"query\": {\"match_all\": {}}\n}\n\nPOST logs/_doc/1\n{\"a\": 1}\nDELETE logs",
        )
        .unwrap();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0].path, "logs/_search");
        assert!(requests[0].body.as_deref().unwrap().contains("match_all"));
        assert_eq!(requests[2].method, "DELETE");
        assert!(requests[2].body.is_none());
        assert!(console_requests("SELECT * FROM logs").is_none());
        assert_eq!(read_only_request("GET logs/_search"), Some(true));
        assert_eq!(read_only_request("POST logs/_search\n{}"), Some(true));
        assert_eq!(read_only_request("POST logs/_doc\n{}"), Some(false));
        assert_eq!(read_only_request("DELETE logs"), Some(false));
        assert_eq!(read_only_request("SELECT 1"), None);
        assert!(is_index_ddl("DELETE logs"));
        assert!(is_index_ddl("PUT logs\n{\"mappings\": {}}"));
        assert!(!is_index_ddl("PUT logs/_doc/1\n{}"));
        assert!(!is_index_ddl("DELETE logs/_doc/1"));
    }

    #[test]
    fn maps_search_and_aggregation_responses() {
        let (columns, rows) = response_rows(&json!({"hits": {"hits": [
            {"_index": "a", "_id": "1", "_source": {"x": {"y": 1}}},
            {"_index": "b", "_id": "2", "_source": {"z": true}}
        ]}}));
        assert_eq!(columns, ["_index", "_id", "x.y", "z"]);
        assert_eq!(rows[1]["x.y"], Value::Null);
        let (columns, rows) = response_rows(
            &json!({"hits": {"hits": []}, "aggregations": {"by": {"buckets": [
                {"key": "a", "doc_count": 3, "avg": {"value": 1.5}}
            ]}}}),
        );
        assert_eq!(columns, ["key", "doc_count", "avg.value"]);
        assert_eq!(rows[0]["avg.value"], json!(1.5));
        let (columns, _) = response_rows(&json!({"acknowledged": true}));
        assert_eq!(columns, ["acknowledged"]);
    }
}
