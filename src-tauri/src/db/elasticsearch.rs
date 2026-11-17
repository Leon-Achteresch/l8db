use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use async_trait::async_trait;
use base64::Engine;
use serde_json::{json, Map, Value};

use super::column_metadata::{
    ColumnMetadata, ExactFilterMetadata, ExactStrategy, KeywordLimit, MappingScope,
};
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
const GROUPS: [&str; 4] = ["indices", "data_streams", "aliases", "hidden"];
const METHODS: [&str; 6] = ["GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"];
const SQL_PAGE: usize = 1000;
const PLUGIN_PREFIXES: [&str; 2] = ["_plugins", "_opendistro"];
const READ_ENDPOINTS: [&str; 12] = [
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
    "_ppl",
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
    exact_filter: Option<ExactFilterMetadata>,
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
                    let exact_filter = exact_filter_metadata(
                        &path,
                        kind.unwrap_or("object"),
                        keyword.as_deref(),
                        def,
                    );
                    out.push(Field {
                        name: path,
                        kind: kind.unwrap_or("object").to_string(),
                        exact_filter,
                        keyword,
                    });
                }
            }
        }
    }
}

fn exact_filter_metadata(
    path: &str,
    kind: &str,
    keyword: Option<&str>,
    def: &Value,
) -> Option<ExactFilterMetadata> {
    if kind != "keyword" && kind != "text" {
        return None;
    }
    let target = keyword.unwrap_or(path).to_string();
    let keyword_def = match keyword {
        Some(name) => name
            .strip_prefix(&format!("{path}."))
            .and_then(|sub| def.get("fields").and_then(|fields| fields.get(sub))),
        None if kind == "keyword" => Some(def),
        _ => None,
    };
    let ignore_above = match keyword_def.and_then(|value| value.get("ignore_above")) {
        Some(value) => match value.as_u64() {
            Some(value) => KeywordLimit::Configured { value },
            None => KeywordLimit::Unknown,
        },
        None => KeywordLimit::NotDeclared,
    };
    Some(ExactFilterMetadata {
        target,
        strategy: if keyword.is_some() || kind == "keyword" {
            ExactStrategy::Keyword
        } else {
            ExactStrategy::MatchPhrase
        },
        ignore_above,
        scope: MappingScope::SingleIndex,
        index_mode: "unverified",
    })
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
    if mapping.as_object().is_some_and(|indices| indices.len() > 1) {
        for field in &mut out {
            if let Some(exact) = &mut field.exact_filter {
                exact.scope = MappingScope::MultipleIndices;
                exact.ignore_above = KeywordLimit::Unknown;
            }
        }
    }
    out
}

fn detailed_columns(fields: Vec<Field>) -> Vec<ColumnMetadata> {
    let mut out = vec![DetailedColumnInfo {
        name: "_id".into(),
        data_type: "_id".into(),
        is_nullable: false,
        column_default: None,
        is_primary_key: true,
        ordinal_position: 1,
        character_maximum_length: None,
        comment: None,
    }
    .into()];
    out.extend(
        fields
            .into_iter()
            .enumerate()
            .map(|(index, field)| ColumnMetadata {
                column: DetailedColumnInfo {
                    name: field.name,
                    data_type: field.kind,
                    is_nullable: true,
                    column_default: None,
                    is_primary_key: false,
                    ordinal_position: index as i32 + 2,
                    character_maximum_length: None,
                    comment: field.keyword.map(|key| format!("Keyword-Feld: {key}")),
                },
                exact_filter: field.exact_filter,
            }),
    );
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
    row.retain(|key, value| {
        !value.is_null()
            || leaves.contains(key)
            || !leaves.iter().any(|leaf| {
                leaf.strip_prefix(key.as_str())
                    .is_some_and(|rest| rest.starts_with('.'))
            })
    });
    if let Some(fields) = hit.get("fields").and_then(Value::as_object) {
        for (key, value) in fields {
            let value = match value {
                Value::Array(items) if items.len() == 1 => items[0].clone(),
                other => other.clone(),
            };
            if leaves.contains(key) && row.contains_key(key) {
                row.insert(key.clone(), value);
            } else {
                row.entry(key.clone()).or_insert(value);
            }
        }
    }
    row
}

fn date_fields(fields: &[Field]) -> Option<Value> {
    let dates: Vec<Value> = fields
        .iter()
        .filter(|f| matches!(f.kind.as_str(), "date" | "date_nanos"))
        .map(|f| json!({"field": f.name, "format": "strict_date_optional_time_nanos"}))
        .collect();
    (!dates.is_empty()).then(|| Value::Array(dates))
}

fn sql_columns(result: &Value) -> Option<Vec<String>> {
    if let Some(columns) = result["columns"].as_array() {
        return Some(columns.iter().map(|c| text(&c["name"])).collect());
    }
    result["schema"].as_array().map(|columns| {
        columns
            .iter()
            .map(|c| {
                c.get("alias")
                    .filter(|a| !a.is_null())
                    .map(text)
                    .unwrap_or_else(|| text(&c["name"]))
            })
            .collect()
    })
}

fn sql_rows(result: &Value) -> Vec<Vec<Value>> {
    result
        .get("rows")
        .or_else(|| result.get("datarows"))
        .and_then(Value::as_array)
        .map(|r| {
            r.iter()
                .map(|row| row.as_array().cloned().unwrap_or_default())
                .collect()
        })
        .unwrap_or_default()
}

fn sql_cursor(result: &Value) -> Option<Value> {
    result
        .get("cursor")
        .filter(|c| c.as_str().is_some_and(|c| !c.is_empty()))
        .cloned()
}

fn opensearch_unpaged(statement: &str) -> bool {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(
            r"(?i)\b(group\s+by|having|distinct|join|union)\b|\b(count|sum|avg|min|max|stddev\w*|var\w*|percentiles?)\s*\(",
        )
        .expect("regex")
    })
    .is_match(statement)
}

fn looks_like_sql(filter: &str) -> bool {
    let mut quoted = false;
    let mut colon = false;
    let mut operator = false;
    for c in filter.chars() {
        match c {
            '\'' | '"' => quoted = !quoted,
            ';' => return true,
            ':' if !quoted => colon = true,
            '=' | '<' | '>' if !quoted => operator = true,
            _ => {}
        }
    }
    operator && !colon
}

fn friendly_error(label: &str, status: u16, body: &str) -> String {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let mut reason = http_api::error_message(body);
    if let Some(details) = value
        .pointer("/error/details")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        reason = if reason.trim().is_empty() || reason == "Invalid SQL query" {
            details.to_string()
        } else {
            format!("{reason}: {details}")
        };
    }
    if let Some(at) = reason
        .find(" expecting {")
        .filter(|at| reason.len() - at > 80)
    {
        reason.truncate(at);
    }
    let kind = value
        .pointer("/error/root_cause/0/type")
        .or_else(|| value.pointer("/error/type"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let hint = match status {
        401 => Some("Anmeldung abgelehnt: Benutzer, Passwort oder API-Key prüfen.".to_string()),
        403 => Some("Keine Berechtigung für diese Anfrage.".to_string()),
        404 if kind == "index_not_found_exception" => Some(format!(
            "Index „{}“ nicht gefunden.",
            value.pointer("/error/index").map(text).unwrap_or_default()
        )),
        405 => Some(
            "Methode für diesen Pfad nicht erlaubt. Den Body in die nächste Zeile schreiben."
                .to_string(),
        ),
        429 => Some("Server überlastet. Später erneut versuchen.".to_string()),
        502..=504 => Some("Server nicht verfügbar. Später erneut versuchen.".to_string()),
        _ if reason.contains("Result window is too large") => {
            Some("Mehr als 10 000 Treffer: mit „table rows --offset“ blättern.".to_string())
        }
        400 if kind.contains("parsing")
            || kind.contains("verification")
            || kind.contains("Semantic")
            || kind.contains("Syntax") =>
        {
            Some("Abfrage ungültig.".to_string())
        }
        _ => None,
    };
    match hint {
        Some(hint) => format!("{label} {status}: {hint}\n  {reason}"),
        None => format!("{label} {status}: {reason}"),
    }
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
    if let Some(columns) = sql_columns(value).filter(|_| {
        value
            .get("rows")
            .or_else(|| value.get("datarows"))
            .is_some_and(Value::is_array)
    }) {
        let columns = super::unique_column_names(columns);
        let rows = super::rows_to_objects(&columns, sql_rows(value));
        return (columns, rows);
    }
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
            let (path, inline) = match rest.split_once(char::is_whitespace) {
                Some((path, tail)) if tail.trim_start().starts_with(['{', '[']) => (path, tail),
                _ => (rest, ""),
            };
            if !inline.is_empty() {
                body.push_str(inline);
                body.push('\n');
            }
            requests.push(ConsoleRequest {
                method: head,
                path: path.trim_start_matches('/').to_string(),
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
    Some(requests.iter().all(request_reads))
}

fn request_reads(request: &ConsoleRequest) -> bool {
    let Some(endpoint) = request_endpoint(&request.path) else {
        return false;
    };
    match endpoint.as_deref() {
        Some(kind @ ("_sql" | "_ppl")) => sql_request_reads(kind, request),
        endpoint => {
            matches!(request.method.as_str(), "GET" | "HEAD")
                || (request.method == "POST"
                    && endpoint.is_some_and(|endpoint| READ_ENDPOINTS.contains(&endpoint)))
        }
    }
}

fn sql_request_reads(kind: &str, request: &ConsoleRequest) -> bool {
    let Ok(url) = url::Url::parse("http://l8db.invalid/").and_then(|base| base.join(&request.path))
    else {
        return false;
    };
    if url
        .query_pairs()
        .any(|(key, _)| key == "sql" || key == "query")
    {
        return false;
    }
    let Some(query) = request
        .body
        .as_deref()
        .and_then(|body| serde_json::from_str::<Value>(body).ok())
        .and_then(|body| {
            body.get("query")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
    else {
        return false;
    };
    let query = query.trim().trim_end_matches(';');
    if query.contains(';') {
        return false;
    }
    let word = query
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reads: &[&str] = if kind == "_ppl" {
        &["SOURCE", "SEARCH", "DESCRIBE", "SHOW"]
    } else {
        &["SELECT", "SHOW", "DESCRIBE", "DESC"]
    };
    reads.contains(&word.as_str())
}

fn request_endpoint(path: &str) -> Option<Option<String>> {
    let url = url::Url::parse("http://l8db.invalid/")
        .and_then(|base| base.join(path))
        .ok()?;
    let raw = path.split(['?', '#']).next().unwrap_or_default();
    let segments: Vec<String> = url
        .path_segments()
        .into_iter()
        .flatten()
        .map(|segment| {
            percent_encoding::percent_decode_str(segment)
                .decode_utf8_lossy()
                .into_owned()
        })
        .collect();
    let dotted = raw
        .split(['/', '\\'])
        .chain(segments.iter().map(String::as_str))
        .any(|segment| {
            let decoded = percent_encoding::percent_decode_str(segment).decode_utf8_lossy();
            decoded == "." || decoded == ".." || decoded.contains(['/', '\\'])
        });
    (!dotted).then(|| {
        segments.into_iter().find(|segment| {
            segment.starts_with('_') && !PLUGIN_PREFIXES.contains(&segment.as_str())
        })
    })
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

pub fn endpoint(value: &str) -> Result<super::endpoint::EndpointIdentity, String> {
    let adapter = ElasticAdapter::new(value)?;
    let base =
        url::Url::parse(&adapter.base).map_err(|_| "Ungültige Elasticsearch-URL".to_string())?;
    let tls = base.scheme() == "https";
    let user = match &adapter.auth {
        Auth::Basic(user, _) => user.clone(),
        Auth::ApiKey(_) => "apikey".to_string(),
        Auth::Bearer(_) => "bearer".to_string(),
        Auth::None => String::new(),
    };
    Ok(super::endpoint::EndpointIdentity {
        host: super::endpoint::host_of(&base),
        port: base.port_or_known_default(),
        transport: base.scheme().to_string(),
        tls,
        verify: tls && !adapter.insecure,
        database: base.path().trim_matches('/').to_string(),
        schema: String::new(),
        user,
        params: Vec::new(),
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
        let port = super::http_api::explicit_port(connection_string, &url)
            .unwrap_or(if tls.secure { 443 } else { 9200 });
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
        let reply = http_api::send(self.label(), request).await?;
        for warning in reply.headers.get_all("warning") {
            if let Some(message) = warning.to_str().ok().and_then(warning_text) {
                super::server_output::emit(super::server_output::ServerMessage {
                    level: "WARNING".to_string(),
                    message,
                    detail: None,
                });
            }
        }
        Ok(reply)
    }

    async fn call(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        let reply = self
            .send(method, path, body.map(|b| b.to_string()), false)
            .await?;
        if !reply.ok() {
            return Err(friendly_error(self.label(), reply.status, &reply.body));
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
            Err(e) if looks_like_sql(filter) => return Err(format!("Bedingung ungültig: {e}")),
            Err(_) => json!({"query_string": {"query": filter}}),
        })
    }

    fn sort_spec(
        order_by: Option<&str>,
        desc: bool,
        fields: &[Field],
    ) -> Result<Vec<Value>, String> {
        let Some(column) = order_by else {
            return Ok(vec![]);
        };
        let Some(field) = fields.iter().find(|f| f.name == column) else {
            return Ok(vec![]);
        };
        if matches!(field.kind.as_str(), "object" | "nested")
            || (field.kind == "text" && field.keyword.is_none())
        {
            return Err(format!(
                "Nach „{column}“ kann nicht sortiert werden: Feldtyp {} ohne Keyword-Unterfeld.",
                field.kind
            ));
        }
        let target = field.keyword.clone().unwrap_or_else(|| field.name.clone());
        Ok(vec![
            json!({target: {"order": if desc { "desc" } else { "asc" }, "unmapped_type": "keyword"}}),
        ])
    }

    async fn deep_hits(
        &self,
        table: &str,
        query: &Value,
        sort: &[Value],
        dates: Option<&Value>,
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
                        } else if let Some(dates) = dates {
                            body["fields"] = dates.clone();
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
                if let Some(dates) = dates {
                    body["fields"] = dates.clone();
                }
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

    async fn sql(
        &self,
        sql: &str,
        limit: usize,
    ) -> Result<(Vec<String>, Vec<Vec<Value>>, bool), String> {
        let statement = sql.trim().trim_end_matches(';');
        let flavor = self.flavor().await?;
        let (endpoint, close) = match flavor {
            Flavor::Elastic => ("_sql?format=json", "_sql/close"),
            Flavor::OpenSearch => ("_plugins/_sql?format=jdbc", "_plugins/_sql/close"),
        };
        let paged = flavor == Flavor::Elastic || !opensearch_unpaged(statement);
        let mut body = json!({"query": statement});
        if paged {
            body["fetch_size"] = json!(SQL_PAGE.min(limit.max(1)));
        }
        let first = self.call("POST", endpoint, Some(body)).await?;
        let columns = sql_columns(&first).unwrap_or_default();
        let mut rows = sql_rows(&first);
        let mut cursor = sql_cursor(&first);
        let outcome: Result<(), String> = async {
            while rows.len() < limit {
                let Some(next) = cursor.clone() else {
                    return Ok(());
                };
                if super::execution::cancellation_token().is_cancelled() {
                    return Err("Abfrage abgebrochen.".into());
                }
                let page = self
                    .call("POST", endpoint, Some(json!({"cursor": next})))
                    .await?;
                let more = sql_rows(&page);
                cursor = sql_cursor(&page);
                if more.is_empty() || cursor.as_ref() == Some(&next) {
                    return Ok(());
                }
                rows.extend(more);
            }
            Ok(())
        }
        .await;
        if let Some(open) = &cursor {
            let _ = self
                .call("POST", close, Some(json!({"cursor": open})))
                .await;
        }
        outcome?;
        let truncated =
            rows.len() > limit || cursor.is_some() || (!paged && rows.len() >= WINDOW as usize);
        rows.truncate(limit);
        Ok((columns, rows, truncated))
    }

    async fn group_names(&self, schema: &str) -> Result<Vec<String>, String> {
        Ok(match schema {
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
            _ => self
                .call(
                    "GET",
                    "_cat/indices?format=json&h=index&expand_wildcards=all",
                    None,
                )
                .await?
                .as_array()
                .map(|a| a.iter().map(|i| text(&i["index"])).collect())
                .unwrap_or_default(),
        })
    }

    async fn console(
        &self,
        requests: Vec<ConsoleRequest>,
    ) -> Result<(Vec<String>, Vec<Value>), String> {
        let many = requests.len() > 1;
        let mut columns = vec![];
        let mut rows = vec![];
        for request in requests {
            let label = format!("{} {}", request.method, request.path);
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
                return Err(friendly_error(self.label(), reply.status, &reply.body));
            }
            let result = match reply.json() {
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
            if !many {
                return Ok(result);
            }
            if columns.is_empty() {
                columns.push("request".to_string());
            }
            for column in result.0 {
                if !columns.contains(&column) {
                    columns.push(column);
                }
            }
            rows.extend(result.1.into_iter().map(|row| {
                let mut object = Map::from_iter([("request".to_string(), json!(label))]);
                if let Value::Object(map) = row {
                    object.extend(map);
                }
                object
            }));
        }
        let rows = rows
            .into_iter()
            .map(|mut object| {
                Value::Object(
                    columns
                        .iter()
                        .map(|c| (c.clone(), object.remove(c).unwrap_or(Value::Null)))
                        .collect(),
                )
            })
            .collect();
        Ok((columns, rows))
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
        Ok(GROUPS.iter().map(|g| g.to_string()).collect())
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let groups: Vec<(&str, Vec<String>)> = match schema {
            Some(schema) => {
                let schema = GROUPS
                    .into_iter()
                    .find(|g| *g == schema)
                    .unwrap_or("indices");
                vec![(schema, self.group_names(schema).await?)]
            }
            None => {
                let indices = self.group_names("indices").await?;
                vec![
                    ("indices", indices.clone()),
                    (
                        "data_streams",
                        self.group_names("data_streams").await.unwrap_or_default(),
                    ),
                    (
                        "aliases",
                        self.group_names("aliases").await.unwrap_or_default(),
                    ),
                    ("hidden", indices),
                ]
            }
        };
        let mut out = Vec::new();
        for (schema, mut names) in groups {
            names.retain(|n| n.starts_with('.') == (schema == "hidden"));
            names.sort();
            out.extend(names.into_iter().map(|name| TableInfo {
                schema: schema.to_string(),
                name,
            }));
        }
        Ok(out)
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
                .list_tables(Some(&schema_name))
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
        let sort = Self::sort_spec(order_by, order_desc, &fields)?;
        let dates = date_fields(&fields);
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
            if let Some(dates) = &dates {
                body["fields"] = dates.clone();
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
            self.deep_hits(table, &query, &sort, dates.as_ref(), offset, limit)
                .await?
        };
        let with_index =
            !matches!(schema, "indices" | "hidden") || table.contains('*') || table.contains(',');
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
        let (columns, rows, truncated) = match console_requests(sql) {
            Some(requests) => {
                let (columns, rows) = self.console(requests).await?;
                (columns, rows, false)
            }
            None => {
                let (columns, rows, truncated) =
                    self.sql(sql, super::execution::row_limit()).await?;
                let columns = super::unique_column_names(columns);
                let rows = super::rows_to_objects(&columns, rows);
                (columns, rows, truncated)
            }
        };
        Ok(QueryResult {
            columns,
            rows,
            rows_affected: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            truncated,
        })
    }

    async fn list_table_columns_detailed(
        &self,
        _schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        Ok(detailed_columns(self.fields(table).await?)
            .into_iter()
            .map(|metadata| metadata.column)
            .collect())
    }

    async fn list_table_column_metadata(
        &self,
        _schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnMetadata>, String> {
        Ok(detailed_columns(self.fields(table).await?))
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

fn warning_text(header: &str) -> Option<String> {
    let mut chars = header.split_once('"')?.1.chars();
    let mut text = String::new();
    while let Some(c) = chars.next() {
        match c {
            '\\' => text.push(chars.next()?),
            '"' => return Some(text),
            c => text.push(c),
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keyword_mapping_fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../tests/fixtures/elastic-keyword-mapping.json"
        ))
        .unwrap()
    }

    #[test]
    fn keyword_hints_follow_existing_exact_routes_and_explicit_limits() {
        let fields = mapping_fields(&keyword_mapping_fixture());
        let columns = serde_json::to_value(detailed_columns(fields.clone())).unwrap();
        let find = |name: &str| {
            columns
                .as_array()
                .unwrap()
                .iter()
                .find(|column| column["name"] == name)
                .unwrap()
        };
        assert_eq!(find("message")["exact_filter"]["target"], "message.keyword");
        assert_eq!(
            find("message")["exact_filter"]["ignore_above"],
            json!({"state":"configured", "value":256})
        );
        assert_eq!(
            find("tag")["exact_filter"]["ignore_above"],
            json!({"state":"configured", "value":20})
        );
        assert_eq!(find("name")["exact_filter"]["target"], "name.raw");
        assert_eq!(
            find("name")["exact_filter"]["ignore_above"],
            json!({"state":"configured", "value":0})
        );
        assert_eq!(
            find("no_limit")["exact_filter"]["ignore_above"]["state"],
            "not_declared"
        );
        assert_eq!(
            find("invalid")["exact_filter"]["ignore_above"]["state"],
            "unknown"
        );
        assert_eq!(find("analyzed")["exact_filter"]["strategy"], "match_phrase");
        for name in ["_id", "count", "nested", "wild"] {
            assert!(find(name).get("exact_filter").is_none());
        }
        for column in columns.as_array().unwrap() {
            if column.get("exact_filter").is_some() {
                assert_eq!(column["exact_filter"]["index_mode"], "unverified");
            }
        }
        assert_eq!(
            ElasticAdapter::build_query(Some("message = 'long value'"), &fields).unwrap(),
            json!({"term":{"message.keyword":"long value"}})
        );
        assert_eq!(
            ElasticAdapter::build_query(Some("name = 'x'"), &fields).unwrap(),
            json!({"term":{"name.raw":"x"}})
        );
        assert_eq!(
            ElasticAdapter::build_query(Some("analyzed = 'x'"), &fields).unwrap(),
            json!({"match_phrase":{"analyzed":"x"}})
        );
        let legacy: Vec<_> = detailed_columns(fields)
            .into_iter()
            .map(|column| ColumnMetadata::from(column.column))
            .collect();
        assert!(serde_json::to_value(legacy)
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .all(|column| column.get("exact_filter").is_none()));
    }

    #[test]
    fn keyword_hints_do_not_claim_shared_limits_or_index_mode_support() {
        let mut mapping = keyword_mapping_fixture();
        mapping["logs"]["settings"] = json!({"index":{"mode":"logsdb"}});
        let single = serde_json::to_value(detailed_columns(mapping_fields(&mapping))).unwrap();
        assert_eq!(single[1]["exact_filter"]["index_mode"], "unverified");
        mapping["other"] = json!({"mappings":{"properties":{"message":{"type":"text"}}}});
        let columns = serde_json::to_value(detailed_columns(mapping_fields(&mapping))).unwrap();
        for column in columns.as_array().unwrap() {
            if let Some(exact) = column.get("exact_filter") {
                assert_eq!(exact["scope"], "multiple_indices");
                assert_eq!(exact["ignore_above"]["state"], "unknown");
            }
        }
        let typed = json!({"logs":{"mappings":{"_doc":{"properties":{"value":{"type":"keyword", "ignore_above":12}}}}}});
        assert_eq!(
            serde_json::to_value(detailed_columns(mapping_fields(&typed))).unwrap()[1]
                ["exact_filter"]["ignore_above"]["value"],
            12
        );
        for value in [json!(-1), json!(1.5), Value::Null] {
            let def = json!({"type":"keyword","ignore_above":value});
            assert_eq!(
                serde_json::to_value(exact_filter_metadata("x", "keyword", None, &def)).unwrap()
                    ["ignore_above"]["state"],
                "unknown"
            );
        }
    }

    #[test]
    fn keyword_hints_mapping_performance_is_bounded() {
        let properties: Map<String, Value> = (0..2_000).map(|index| (format!("field_{index}"), json!({"type":"text", "fields":{"keyword":{"type":"keyword", "ignore_above":256}}}))).collect();
        let mapping = json!({"logs":{"mappings":{"properties":properties}}});
        let run = || {
            let columns = detailed_columns(mapping_fields(&mapping));
            assert_eq!(columns.len(), 2_001);
            let bytes = serde_json::to_vec(&columns).unwrap().len();
            assert!(bytes < 2 * 1024 * 1024);
            bytes
        };
        run();
        run();
        let mut times = Vec::new();
        let mut bytes = 0;
        for _ in 0..7 {
            let start = std::time::Instant::now();
            bytes = run();
            times.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(f64::total_cmp);
        eprintln!(
            "keyword metadata: fields=2000 median={:.3}ms p95={:.3}ms bytes={bytes} requests=0",
            times[3], times[6]
        );
        assert!(times[3] < 250.0);
        assert!(times[6] < 500.0);
    }

    #[tokio::test]
    async fn keyword_metadata_uses_one_existing_mapping_read_and_no_follow_up() {
        let server = super::super::http_mock::start(|request| {
            assert_eq!(request.method, "GET");
            assert_eq!(request.path, "/logs/_mapping");
            (200, serde_json::to_vec(&keyword_mapping_fixture()).unwrap())
        });
        let adapter = ElasticAdapter::new(&server.base).unwrap();
        let columns = adapter
            .list_table_column_metadata("indices", "logs")
            .await
            .unwrap();
        assert!(columns.iter().any(|column| column.exact_filter.is_some()));
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert_eq!(server.requests().len(), 1);
    }

    #[test]
    fn warning_headers_yield_their_quoted_text() {
        assert_eq!(
            warning_text(r#"299 Elasticsearch-8.11.0-abc "[types removal] \"_type\" is deprecated" "Mon, 01 Jan 2026 00:00:00 GMT""#)
                .as_deref(),
            Some(r#"[types removal] "_type" is deprecated"#)
        );
        assert_eq!(warning_text("299 OpenSearch-2.11.0 \"unterminated"), None);
        assert_eq!(warning_text("299 -"), None);
    }

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
        for path in [
            "_search/../logs/_delete_by_query",
            "_search/%2e%2e/logs/_delete_by_query",
            "_search/%2E%2E/logs/_delete_by_query",
            "_search\\..\\logs\\_delete_by_query",
            "_search/./../logs/_update_by_query",
            "logs/_search%2F..%2F_delete_by_query",
            "logs/_doc/_search",
            "logs/_delete_by_query#/_search",
            "logs/_delete_by_query?x=/_search",
            "_search_x",
        ] {
            assert_eq!(
                read_only_request(&format!("POST {path}\n{{}}")),
                Some(false),
                "{path}"
            );
        }
        for path in [
            "_search",
            "logs/_search?size=1",
            "_search/scroll",
            "logs/_explain/1",
        ] {
            assert_eq!(
                read_only_request(&format!("POST {path}\n{{}}")),
                Some(true),
                "{path}"
            );
        }
        for (path, query) in [
            ("_sql?format=txt", "SELECT * FROM logs"),
            ("_plugins/_sql?format=jdbc", "select count(*) from logs;"),
            ("_opendistro/_sql", "SHOW TABLES LIKE %"),
            ("_plugins/_sql", "DESCRIBE TABLES LIKE logs"),
            ("_plugins/_ppl", "source=logs | where a > 1"),
        ] {
            let request = format!("POST {path}\n{{\"query\": \"{query}\"}}");
            assert_eq!(read_only_request(&request), Some(true), "{request}");
        }
        for request in [
            "POST _plugins/_sql\n{\"query\": \"DELETE FROM logs\"}",
            "POST _opendistro/_sql\n{\"query\": \"SELECT 1; DELETE FROM logs\"}",
            "POST _plugins/_sql\n{}",
            "POST _plugins/_ppl",
            "GET _plugins/_sql\n{\"query\": \"DELETE FROM logs\"}",
            "GET _opendistro/_sql?sql=DELETE%20FROM%20logs",
            "GET logs/../_plugins/_sql\n{\"query\": \"SELECT 1\"}",
            "POST _sql/close\n{\"cursor\": \"x\"}",
        ] {
            assert_eq!(read_only_request(request), Some(false), "{request}");
        }
        assert_eq!(
            read_only_request("POST _plugins/_security/api/x\n{}"),
            Some(false)
        );
        let inline = console_requests("GET big/_search {\"size\": 3}").unwrap();
        assert_eq!(inline[0].path, "big/_search");
        assert_eq!(
            inline[0].body.as_deref().map(str::trim),
            Some("{\"size\": 3}")
        );
        assert_eq!(
            read_only_request("POST logs/_search {\"size\": 1}"),
            Some(true)
        );
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

    #[test]
    fn rejects_broken_sql_filters_but_keeps_lucene() {
        let f = fields();
        for bad in ["user.age >", "level = 'warn'; DROP x", "\"age\" >= "] {
            assert!(
                ElasticAdapter::build_query(Some(bad), &f)
                    .unwrap_err()
                    .starts_with("Bedingung ungültig"),
                "{bad}"
            );
        }
        for lucene in ["status:active AND age:>21", "error", "message:\"a = b\""] {
            assert!(
                ElasticAdapter::build_query(Some(lucene), &f).is_ok(),
                "{lucene}"
            );
        }
        assert!(ElasticAdapter::sort_spec(Some("message"), true, &f)
            .unwrap_err()
            .contains("„message“"));
        assert_eq!(
            ElasticAdapter::sort_spec(Some("user.name"), true, &f).unwrap(),
            vec![json!({"user.name.keyword": {"order": "desc", "unmapped_type": "keyword"}})]
        );
    }

    #[test]
    fn errors_are_short_and_keep_the_reason() {
        let os = r#"{"error":{"reason":"Invalid SQL query","details":"can't resolve Symbol(namespace=FIELD_NAME, name=nope) in type env","type":"SemanticCheckException"},"status":400}"#;
        let message = friendly_error("OpenSearch", 400, os);
        assert!(
            message.starts_with("OpenSearch 400: Abfrage ungültig."),
            "{message}"
        );
        assert!(message.contains("name=nope"), "{message}");
        let auth = r#"{"error":{"root_cause":[{"type":"security_exception","reason":"unable to authenticate user [elastic]"}],"type":"security_exception"},"status":401}"#;
        assert!(friendly_error("Elasticsearch", 401, auth).contains("Passwort"));
        let missing = r#"{"error":{"root_cause":[{"type":"index_not_found_exception","reason":"no such index [nope]","index":"nope"}],"type":"index_not_found_exception","index":"nope"},"status":404}"#;
        assert!(friendly_error("Elasticsearch", 404, missing)
            .starts_with("Elasticsearch 404: Index „nope“ nicht gefunden."));
        let tokens = format!(
            r#"{{"error":{{"root_cause":[{{"type":"parsing_exception","reason":"line 1:1: mismatched input 'SELEC' expecting {{{}}}"}}],"type":"parsing_exception"}},"status":400}}"#,
            "'(', 'DEBUG', 'DESC', 'DESCRIBE', 'EXPLAIN', 'SELECT', 'SHOW', 'SYS', 'WITH', 'X', 'Y', 'Z'"
        );
        let message = friendly_error("Elasticsearch", 400, &tokens);
        assert!(message.ends_with("mismatched input 'SELEC'"), "{message}");
        assert!(
            friendly_error("Elasticsearch", 429, "rejected execution").contains("Später erneut")
        );
    }

    #[test]
    fn hides_null_objects_and_reads_sql_responses() {
        let leaves: HashSet<String> = ["nested_obj.a", "created"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let row = hit_row(
            &json!({"_id": "2", "_source": {"nested_obj": null, "created": 1709251200000i64}, "fields": {"created": ["2024-03-01T00:00:00.000Z"]}}),
            false,
            &leaves,
        );
        assert!(!row.contains_key("nested_obj"));
        assert_eq!(row["created"], json!("2024-03-01T00:00:00.000Z"));
        let (columns, rows) = response_rows(
            &json!({"schema": [{"name": "COUNT(*)", "type": "long"}], "datarows": [[3]], "total": 1, "size": 1, "status": 200}),
        );
        assert_eq!(columns, ["COUNT(*)"]);
        assert_eq!(rows[0]["COUNT(*)"], json!(3));
        let (columns, _) =
            response_rows(&json!({"columns": [{"name": "n", "type": "long"}], "rows": [[1], [2]]}));
        assert_eq!(columns, ["n"]);
    }

    fn sql_server(total: usize, opensearch: bool) -> super::super::http_mock::MockServer {
        super::super::http_mock::start(move |request| {
            let route = request.route().to_string();
            if request.method == "GET" && route == "/" {
                return (200, br#"{"version":{"number":"8.19.4"}}"#.to_vec());
            }
            if route.ends_with("/close") {
                return (200, br#"{"succeeded":true}"#.to_vec());
            }
            if route == "/_cat/indices" {
                return (200, br#"[{"index":"logs"},{"index":".hidden"}]"#.to_vec());
            }
            if route == "/_data_stream" {
                return (200, br#"{"data_streams":[{"name":"ds"}]}"#.to_vec());
            }
            if route == "/_alias" {
                return (200, br#"{"logs":{"aliases":{"logs_alias":{}}}}"#.to_vec());
            }
            let body = request.json();
            let (start, size) = match body.get("cursor").and_then(Value::as_str) {
                Some(cursor) => {
                    let (start, size) = cursor.split_once(':').unwrap();
                    (
                        start.parse::<usize>().unwrap(),
                        size.parse::<usize>().unwrap(),
                    )
                }
                None => (0, body["fetch_size"].as_u64().unwrap() as usize),
            };
            let end = (start + size).min(total);
            let rows: Vec<Value> = (start..end).map(|n| json!([n])).collect();
            let mut out = if opensearch {
                json!({"datarows": rows})
            } else {
                json!({"rows": rows})
            };
            if start == 0 {
                if opensearch {
                    out["schema"] = json!([{"name": "n", "type": "long"}]);
                } else {
                    out["columns"] = json!([{"name": "n", "type": "long"}]);
                }
            }
            if end < total {
                out["cursor"] = json!(format!("{end}:{size}"));
            }
            (200, out.to_string().into_bytes())
        })
    }

    #[tokio::test]
    async fn sql_cursor_stops_on_empty_or_repeated_pages() {
        for (name, empty) in [("empty", true), ("repeated", false)] {
            let server = super::super::http_mock::start(move |request| {
                let route = request.route().to_string();
                if request.method == "GET" && route == "/" {
                    return (200, br#"{"version":{"number":"8.19.4"}}"#.to_vec());
                }
                if route.ends_with("/close") {
                    return (200, br#"{"succeeded":true}"#.to_vec());
                }
                let rows = if empty && request.json().get("cursor").is_some() {
                    json!([])
                } else {
                    json!([[1]])
                };
                let page = json!({"columns": [{"name": "n", "type": "long"}], "rows": rows, "cursor": "same"});
                (200, page.to_string().into_bytes())
            });
            let url = format!(
                "elasticsearch://{}",
                server.base.trim_start_matches("http://")
            );
            let result = ElasticAdapter::new(&url)
                .unwrap()
                .execute_query("SELECT n FROM loop")
                .await
                .unwrap();
            assert_eq!(result.rows.len(), 1, "{name}");
            assert!(result.truncated, "{name}");
            let calls: Vec<bool> = server
                .requests()
                .iter()
                .filter(|r| r.route().contains("_sql"))
                .map(|r| r.route().ends_with("/close"))
                .collect();
            assert_eq!(calls, [false, false, true], "{name}");
        }
    }

    #[tokio::test]
    async fn sql_follows_the_cursor_up_to_the_row_limit() {
        for opensearch in [false, true] {
            let server = sql_server(2500, opensearch);
            let scheme = if opensearch {
                "opensearch"
            } else {
                "elasticsearch"
            };
            let url = format!("{scheme}://{}", server.base.trim_start_matches("http://"));
            let adapter = ElasticAdapter::new(&url).unwrap();
            let capped = crate::db::execution::with_row_limit(
                1201,
                adapter.execute_query("SELECT n FROM big"),
            )
            .await
            .unwrap();
            assert_eq!(capped.rows.len(), 1201);
            assert!(capped.truncated);
            assert_eq!(capped.rows[1200]["n"], json!(1200));
            let sql_calls = |server: &super::super::http_mock::MockServer| {
                server
                    .requests()
                    .iter()
                    .filter(|r| r.route().contains("_sql"))
                    .map(|r| r.route().ends_with("/close"))
                    .collect::<Vec<_>>()
            };
            assert_eq!(sql_calls(&server), [false, false, true]);
            let server = sql_server(2500, opensearch);
            let url = format!("{scheme}://{}", server.base.trim_start_matches("http://"));
            let all = ElasticAdapter::new(&url)
                .unwrap()
                .execute_query("SELECT n FROM big")
                .await
                .unwrap();
            assert_eq!(all.rows.len(), 2500);
            assert!(!all.truncated);
            assert_eq!(sql_calls(&server), [false, false, false]);
            let server = sql_server(5, opensearch);
            let url = format!("{scheme}://{}", server.base.trim_start_matches("http://"));
            let small = crate::db::execution::with_row_limit(
                501,
                ElasticAdapter::new(&url)
                    .unwrap()
                    .execute_query("SELECT n FROM big"),
            )
            .await
            .unwrap();
            assert_eq!(small.rows.len(), 5);
            assert!(!small.truncated);
            let first = server
                .requests()
                .into_iter()
                .find(|r| r.route().contains("_sql"))
                .unwrap();
            assert_eq!(first.json()["fetch_size"], json!(501));
        }
    }

    #[test]
    fn opensearch_pages_only_plain_selects() {
        assert!(!opensearch_unpaged(
            "SELECT n FROM big WHERE n > 3 ORDER BY n"
        ));
        assert!(!opensearch_unpaged("SELECT counter FROM big"));
        for sql in [
            "SELECT level, COUNT(*) FROM logs GROUP BY level",
            "SELECT DISTINCT level FROM logs",
            "SELECT max(n) FROM big",
            "SELECT a.x FROM a JOIN b ON a.id = b.id",
        ] {
            assert!(opensearch_unpaged(sql), "{sql}");
        }
    }

    #[tokio::test]
    async fn opensearch_aggregations_skip_the_cursor_and_report_the_cap() {
        let server = super::super::http_mock::start(|request| {
            assert!(request.json().get("fetch_size").is_none());
            let rows: Vec<Value> = (0..10_000).map(|n| json!([n, 1])).collect();
            let body = json!({"schema": [{"name": "n"}, {"name": "COUNT(*)", "alias": "c"}], "datarows": rows});
            (200, body.to_string().into_bytes())
        });
        let url = format!("opensearch://{}", server.base.trim_start_matches("http://"));
        let result = ElasticAdapter::new(&url)
            .unwrap()
            .execute_query("SELECT n, COUNT(*) AS c FROM big GROUP BY n")
            .await
            .unwrap();
        assert_eq!(result.columns, ["n", "c"]);
        assert_eq!(result.rows.len(), 10_000);
        assert!(result.truncated);
        assert_eq!(server.requests().len(), 1);
    }

    #[tokio::test]
    async fn lists_every_group_and_shows_every_console_answer() {
        let server = sql_server(0, false);
        let url = format!(
            "elasticsearch://{}",
            server.base.trim_start_matches("http://")
        );
        let adapter = ElasticAdapter::new(&url).unwrap();
        let tables: Vec<(String, String)> = adapter
            .list_tables(None)
            .await
            .unwrap()
            .into_iter()
            .map(|t| (t.schema, t.name))
            .collect();
        assert_eq!(
            tables,
            [
                ("indices".to_string(), "logs".to_string()),
                ("data_streams".to_string(), "ds".to_string()),
                ("aliases".to_string(), "logs_alias".to_string()),
                ("hidden".to_string(), ".hidden".to_string()),
            ]
        );
        let result = adapter
            .execute_query("GET _data_stream\n\nGET _alias")
            .await
            .unwrap();
        assert_eq!(result.columns[0], "request");
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0]["request"], json!("GET _data_stream"));
        assert_eq!(result.rows[1]["request"], json!("GET _alias"));
    }
}
