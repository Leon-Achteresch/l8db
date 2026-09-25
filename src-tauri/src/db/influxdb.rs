use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use async_trait::async_trait;
use serde_json::{json, Map, Value};

use super::filter_expr::{self, Cmp, Expr, LikePart, Literal};
use super::http_api::{self, text};
use super::{
    validate_table_filter, ColumnInfo, DatabaseAdapter, DetailedColumnInfo, QueryResult, TableData,
    TableInfo,
};

const SQL_WORDS: [&str; 14] = [
    "SELECT", "SHOW", "WITH", "EXPLAIN", "DROP", "CREATE", "DELETE", "INSERT", "UPDATE", "ALTER",
    "IMPORT", "FROM", "OPTION", "GRANT",
];
const INFLUXQL_SHOW: [&str; 7] = [
    "MEASUREMENTS",
    "TAG",
    "FIELD",
    "SERIES",
    "RETENTION",
    "DATABASES",
    "MEASUREMENT",
];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Version {
    V2,
    V3,
}

pub struct InfluxAdapter {
    base: String,
    token: String,
    insecure: bool,
    database: Option<String>,
    org: Option<String>,
    forced: Option<Version>,
    range: Option<i64>,
}

fn versions() -> &'static Mutex<HashMap<String, Version>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Version>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn orgs() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn parse_range(value: &str) -> Result<Option<i64>, String> {
    let value = value.trim().trim_start_matches('-').to_ascii_lowercase();
    if matches!(value.as_str(), "all" | "0" | "none") {
        return Ok(None);
    }
    let digits: String = value.chars().take_while(char::is_ascii_digit).collect();
    let unit = &value[digits.len()..];
    let amount: i64 = digits
        .parse()
        .map_err(|_| format!("Ungültiger Zeitraum '{value}', z. B. 1h, 7d oder all"))?;
    let factor = match unit {
        "s" => 1,
        "m" => 60,
        "h" | "" => 3600,
        "d" => 86_400,
        "w" => 604_800,
        _ => {
            return Err(format!(
                "Ungültige Zeiteinheit '{unit}', erlaubt: s, m, h, d, w"
            ))
        }
    };
    Ok(Some(amount * factor))
}

fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn flux_string(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace("${", "\\${")
    )
}

fn flux_regex(pattern: &str, escape: Option<char>, insensitive: bool) -> String {
    let mut out = String::from(if insensitive { "/(?i)^" } else { "/^" });
    for part in filter_expr::like_parts(pattern, escape) {
        match part {
            LikePart::Any => out.push_str(".*"),
            LikePart::One => out.push('.'),
            LikePart::Text(t) => {
                for c in t.chars() {
                    if "\\.+*?()|[]{}^$/".contains(c) {
                        out.push('\\');
                    }
                    out.push(c);
                }
            }
        }
    }
    out.push_str("$/");
    out
}

fn flux_literal(field: &str, value: &Literal) -> String {
    match value {
        Literal::Text(t) if field == "_time" => format!("time(v: {})", flux_string(t)),
        Literal::Text(t) => flux_string(t),
        Literal::Number(n) => n.clone(),
        Literal::Bool(b) => b.to_string(),
        Literal::Null => "\"\"".into(),
    }
}

fn flux_field(field: &str) -> String {
    format!("r[{}]", flux_string(field))
}

fn to_flux(expr: &Expr) -> String {
    match expr {
        Expr::And(parts) => format!(
            "({})",
            parts.iter().map(to_flux).collect::<Vec<_>>().join(" and ")
        ),
        Expr::Or(parts) => format!(
            "({})",
            parts.iter().map(to_flux).collect::<Vec<_>>().join(" or ")
        ),
        Expr::Not(inner) => format!("not ({})", to_flux(inner)),
        Expr::IsNull(field) | Expr::Compare(field, Cmp::Eq, Literal::Null) => {
            format!("not exists {}", flux_field(field))
        }
        Expr::Compare(field, Cmp::Ne, Literal::Null) => format!("exists {}", flux_field(field)),
        Expr::Compare(field, op, value) => {
            let op = match op {
                Cmp::Eq => "==",
                Cmp::Ne => "!=",
                Cmp::Lt => "<",
                Cmp::Le => "<=",
                Cmp::Gt => ">",
                Cmp::Ge => ">=",
            };
            format!("{} {op} {}", flux_field(field), flux_literal(field, value))
        }
        Expr::In(field, values) => format!(
            "({})",
            values
                .iter()
                .map(|v| format!("{} == {}", flux_field(field), flux_literal(field, v)))
                .collect::<Vec<_>>()
                .join(" or ")
        ),
        Expr::Like {
            field,
            pattern,
            escape,
            insensitive,
        } => format!(
            "{} =~ {}",
            flux_field(field),
            flux_regex(pattern, *escape, *insensitive)
        ),
    }
}

fn csv_records(input: &str) -> Vec<Vec<String>> {
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = input.chars().peekable();
    let mut touched = false;
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' => {
                quoted = true;
                touched = true;
            }
            ',' => {
                record.push(std::mem::take(&mut field));
                touched = true;
            }
            '\r' => {}
            '\n' => {
                if touched || !field.is_empty() {
                    record.push(std::mem::take(&mut field));
                }
                records.push(std::mem::take(&mut record));
                touched = false;
            }
            other => {
                field.push(other);
                touched = true;
            }
        }
    }
    if touched || !field.is_empty() {
        record.push(field);
    }
    if !record.is_empty() {
        records.push(record);
    }
    records
}

fn typed(value: &str, datatype: &str) -> Value {
    if value.is_empty() && datatype != "string" {
        return Value::Null;
    }
    match datatype {
        "long" | "unsignedLong" => value
            .parse::<i64>()
            .map(Value::from)
            .unwrap_or_else(|_| Value::String(value.into())),
        "double" => value
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or_else(|| Value::String(value.into())),
        "boolean" => Value::Bool(value == "true"),
        _ => Value::String(value.into()),
    }
}

type Table = (Vec<String>, Vec<Map<String, Value>>);

fn parse_flux_csv(body: &str) -> Result<Table, String> {
    let mut columns: Vec<String> = Vec::new();
    let mut rows = Vec::new();
    let mut header: Option<Vec<String>> = None;
    let mut types: Vec<String> = Vec::new();
    for record in csv_records(body) {
        if record.is_empty() || record.iter().all(String::is_empty) {
            header = None;
            types.clear();
            continue;
        }
        if record[0] == "#datatype" {
            types = record.clone();
            header = None;
            continue;
        }
        if record[0].starts_with('#') {
            continue;
        }
        let Some(names) = &header else {
            if record.iter().any(|c| c == "error") && record.iter().any(|c| c == "reference") {
                header = Some(record);
                continue;
            }
            for name in record.iter().skip(1) {
                if !matches!(name.as_str(), "result" | "table") && !columns.contains(name) {
                    columns.push(name.clone());
                }
            }
            header = Some(record);
            continue;
        };
        if names.iter().any(|c| c == "error") && names.iter().any(|c| c == "reference") {
            let at = names.iter().position(|c| c == "error").unwrap_or(1);
            return Err(format!(
                "Flux-Fehler: {}",
                record.get(at).cloned().unwrap_or_default()
            ));
        }
        let mut row = Map::new();
        for (i, name) in names.iter().enumerate().skip(1) {
            if matches!(name.as_str(), "result" | "table") {
                continue;
            }
            let raw = record.get(i).map(String::as_str).unwrap_or("");
            let datatype = types.get(i).map(String::as_str).unwrap_or("string");
            row.insert(name.clone(), typed(raw, datatype));
        }
        rows.push(row);
    }
    Ok((columns, rows))
}

fn objects(base: Vec<String>, objects: Vec<Map<String, Value>>) -> (Vec<String>, Vec<Value>) {
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
            Value::Object(
                columns
                    .iter()
                    .map(|c| (c.clone(), object.remove(c).unwrap_or(Value::Null)))
                    .collect(),
            )
        })
        .collect();
    (columns, rows)
}

fn first_word(statement: &str) -> String {
    statement
        .trim_start()
        .split(|c: char| c.is_whitespace() || c == ',' || c == '(')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase()
}

pub fn is_line_protocol(statement: &str) -> bool {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r#"^[^\s,#"(=]+(,[^\s]+)?\s+[^\s=]+=\S.*$"#).expect("regex")
    });
    let lines: Vec<&str> = statement
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();
    !lines.is_empty()
        && lines.iter().all(|line| {
            re.is_match(line)
                && !SQL_WORDS.contains(&first_word(line).as_str())
                && !line.contains("|>")
        })
}

fn is_flux(statement: &str) -> bool {
    let trimmed = statement.trim_start();
    trimmed.contains("|>")
        || trimmed.starts_with("from(")
        || trimmed.starts_with("import ")
        || trimmed.starts_with("buckets(")
        || trimmed.starts_with("option ")
}

pub fn read_only_statement(statement: &str) -> Option<bool> {
    if is_line_protocol(statement) {
        return Some(false);
    }
    if is_flux(statement) {
        let compact: String = statement.chars().filter(|c| !c.is_whitespace()).collect();
        return Some(
            !(compact.contains("|>to(") || compact.contains("wideTo(") || compact.contains(".to(")),
        );
    }
    None
}

fn is_influxql(statement: &str) -> bool {
    let words: Vec<String> = statement
        .split_whitespace()
        .take(2)
        .map(str::to_ascii_uppercase)
        .collect();
    words.first().map(String::as_str) == Some("SHOW")
        && words
            .get(1)
            .is_some_and(|w| INFLUXQL_SHOW.contains(&w.as_str()))
}

impl InfluxAdapter {
    pub fn new(connection_string: &str, database: Option<&str>) -> Result<Self, String> {
        let url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige InfluxDB-URL".to_string())?;
        if !matches!(url.scheme(), "influxdb" | "http" | "https") {
            return Err("Eine influxdb:// URL ist erforderlich".into());
        }
        let host = url
            .host_str()
            .ok_or("Host fehlt in der URL")?
            .to_lowercase();
        let tls = http_api::tls(&url, host.ends_with(".influxdata.com"));
        let port = url.port().unwrap_or(if tls.secure { 443 } else { 8086 });
        let token = http_api::param(&url, &["token", "authToken", "auth_token"])
            .unwrap_or_else(|| http_api::decode(url.password().unwrap_or("")));
        let path_db = http_api::decode(url.path().trim_matches('/'));
        let database = database
            .filter(|d| !d.is_empty())
            .map(str::to_string)
            .or(http_api::param(&url, &["db", "bucket", "database"]))
            .or(Some(path_db).filter(|d| !d.is_empty()));
        let forced = match http_api::param(&url, &["version"]).as_deref() {
            Some(v) if v.starts_with('3') => Some(Version::V3),
            Some(v) if v.starts_with('2') || v.starts_with('1') => Some(Version::V2),
            _ => None,
        };
        let range = match http_api::param(&url, &["range"]) {
            Some(r) => parse_range(&r)?,
            None => Some(3600),
        };
        Ok(Self {
            base: http_api::base_url(&url, tls.secure, Some(port))?,
            token,
            insecure: tls.insecure,
            database,
            org: http_api::param(&url, &["org", "orgID", "org_id"]),
            forced,
            range,
        })
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        version: Version,
    ) -> reqwest::RequestBuilder {
        let request =
            http_api::client(self.insecure).request(method, format!("{}{path}", self.base));
        if self.token.is_empty() {
            return request;
        }
        let scheme = if version == Version::V3 {
            "Bearer"
        } else {
            "Token"
        };
        request.header("Authorization", format!("{scheme} {}", self.token))
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> Result<String, String> {
        let reply = http_api::send("InfluxDB", request).await?;
        if !reply.ok() {
            return Err(format!(
                "InfluxDB {}: {}",
                reply.status,
                http_api::error_message(&reply.body)
            ));
        }
        Ok(reply.body)
    }

    async fn version(&self) -> Result<Version, String> {
        if let Some(v) = self.forced {
            return Ok(v);
        }
        if let Some(v) = versions()
            .lock()
            .ok()
            .and_then(|c| c.get(&self.base).copied())
        {
            return Ok(v);
        }
        let reply = http_api::send(
            "InfluxDB",
            self.request(reqwest::Method::GET, "/ping", Version::V2),
        )
        .await?;
        let reported = reply
            .header("x-influxdb-version")
            .map(str::to_string)
            .or_else(|| reply.json().map(|v| text(&v["version"])))
            .unwrap_or_default();
        if reply.status == 401 && reported.is_empty() {
            return Err("InfluxDB 401: Token ungültig oder fehlt".into());
        }
        let version = if reported.trim_start_matches('v').starts_with('3') {
            Version::V3
        } else {
            Version::V2
        };
        if let Ok(mut cache) = versions().lock() {
            cache.insert(self.base.clone(), version);
        }
        Ok(version)
    }

    async fn org(&self) -> Result<String, String> {
        if let Some(org) = &self.org {
            return Ok(org.clone());
        }
        let key = format!("{}#{}", self.base, self.token);
        if let Some(org) = orgs().lock().ok().and_then(|c| c.get(&key).cloned()) {
            return Ok(org);
        }
        let body = self
            .send(self.request(reqwest::Method::GET, "/api/v2/orgs", Version::V2))
            .await?;
        let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        let org = value
            .pointer("/orgs/0/name")
            .map(text)
            .filter(|o| !o.is_empty())
            .ok_or("Keine Organisation gefunden. Setze ?org= in der URL.")?;
        if let Ok(mut cache) = orgs().lock() {
            cache.insert(key, org.clone());
        }
        Ok(org)
    }

    async fn databases(&self) -> Result<Vec<String>, String> {
        let mut names: Vec<String> = match self.version().await? {
            Version::V3 => {
                let body = self
                    .send(self.request(
                        reqwest::Method::GET,
                        "/api/v3/configure/database?format=json",
                        Version::V3,
                    ))
                    .await?;
                serde_json::from_str::<Value>(&body)
                    .ok()
                    .and_then(|v| v.as_array().cloned())
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|d| d.as_object()?.values().next().map(text))
                    .collect()
            }
            Version::V2 => {
                let body = self
                    .send(self.request(
                        reqwest::Method::GET,
                        "/api/v2/buckets?limit=100",
                        Version::V2,
                    ))
                    .await?;
                serde_json::from_str::<Value>(&body)
                    .ok()
                    .and_then(|v| v["buckets"].as_array().cloned())
                    .unwrap_or_default()
                    .iter()
                    .map(|b| text(&b["name"]))
                    .collect()
            }
        };
        names.sort_by_key(|n| (n.starts_with('_'), n.clone()));
        Ok(names)
    }

    async fn database(&self) -> Result<String, String> {
        if let Some(db) = &self.database {
            return Ok(db.clone());
        }
        self.databases()
            .await?
            .into_iter()
            .find(|d| !d.starts_with('_'))
            .ok_or_else(|| "Kein Bucket bzw. keine Datenbank gefunden".to_string())
    }

    async fn sql_v3(
        &self,
        db: &str,
        sql: &str,
        influxql: bool,
    ) -> Result<Vec<Map<String, Value>>, String> {
        let path = if influxql {
            "/api/v3/query_influxql"
        } else {
            "/api/v3/query_sql"
        };
        let body = self
            .send(
                self.request(reqwest::Method::POST, path, Version::V3).json(
                    &json!({"db": db, "q": sql.trim().trim_end_matches(';'), "format": "json"}),
                ),
            )
            .await?;
        if body.trim().is_empty() {
            return Ok(vec![]);
        }
        let value: Value = serde_json::from_str(&body)
            .map_err(|e| format!("Antwort von InfluxDB ist kein JSON: {e}"))?;
        Ok(value
            .as_array()
            .map(|rows| rows.iter().filter_map(|r| r.as_object().cloned()).collect())
            .unwrap_or_default())
    }

    async fn flux(&self, query: &str) -> Result<(Vec<String>, Vec<Map<String, Value>>), String> {
        let org = self.org().await?;
        let body = self
            .send(
                self.request(reqwest::Method::POST, "/api/v2/query", Version::V2)
                    .query(&[("org", org.as_str())])
                    .header("Accept", "application/csv")
                    .json(&json!({
                        "query": query,
                        "type": "flux",
                        "dialect": {"annotations": ["datatype"], "header": true, "delimiter": ",", "dateTimeFormat": "RFC3339Nano"}
                    })),
            )
            .await?;
        parse_flux_csv(&body)
    }

    async fn influxql_v2(
        &self,
        db: &str,
        statement: &str,
    ) -> Result<(Vec<String>, Vec<Map<String, Value>>), String> {
        let body = self
            .send(
                self.request(reqwest::Method::POST, "/query", Version::V2)
                    .query(&[("db", db), ("q", statement)])
                    .header("Accept", "application/json"),
            )
            .await?;
        let value: Value = serde_json::from_str(&body)
            .map_err(|e| format!("Antwort von InfluxDB ist kein JSON: {e}"))?;
        let mut columns = Vec::new();
        let mut rows = Vec::new();
        for result in value["results"].as_array().cloned().unwrap_or_default() {
            if let Some(error) = result.get("error") {
                return Err(format!("InfluxQL-Fehler: {}", text(error)));
            }
            let series = result["series"].as_array().cloned().unwrap_or_default();
            let multi = series.len() > 1;
            for s in series {
                let names: Vec<String> = s["columns"]
                    .as_array()
                    .map(|c| c.iter().map(text).collect())
                    .unwrap_or_default();
                for value in s["values"].as_array().cloned().unwrap_or_default() {
                    let mut row = Map::new();
                    if multi {
                        row.insert("name".into(), s["name"].clone());
                    }
                    if let Some(tags) = s["tags"].as_object() {
                        row.extend(tags.clone());
                    }
                    for (i, name) in names.iter().enumerate() {
                        row.insert(name.clone(), value.get(i).cloned().unwrap_or(Value::Null));
                    }
                    for key in row.keys() {
                        if !columns.contains(key) {
                            columns.push(key.clone());
                        }
                    }
                    rows.push(row);
                }
            }
        }
        Ok((columns, rows))
    }

    async fn write(&self, lines: &str) -> Result<u64, String> {
        let db = self.database().await?;
        let request = match self.version().await? {
            Version::V3 => self
                .request(reqwest::Method::POST, "/api/v3/write_lp", Version::V3)
                .query(&[("db", db.as_str())]),
            Version::V2 => {
                let org = self.org().await?;
                self.request(reqwest::Method::POST, "/api/v2/write", Version::V2)
                    .query(&[
                        ("org", org.as_str()),
                        ("bucket", db.as_str()),
                        ("precision", "ns"),
                    ])
            }
        };
        self.send(
            request
                .header("Content-Type", "text/plain; charset=utf-8")
                .body(lines.trim().to_string()),
        )
        .await?;
        Ok(lines
            .lines()
            .filter(|l| !l.trim().is_empty() && !l.trim().starts_with('#'))
            .count() as u64)
    }

    fn start(&self) -> String {
        match self.range {
            Some(secs) => format!("-{secs}s"),
            None => "time(v: 0)".into(),
        }
    }

    fn flux_filter(filter: Option<&str>, allow_raw: bool) -> Result<Option<String>, String> {
        let Some(filter) = filter.map(str::trim).filter(|f| !f.is_empty()) else {
            return Ok(None);
        };
        match filter_expr::parse(filter) {
            Ok(expr) => Ok(Some(to_flux(&expr))),
            Err(_) if allow_raw => Ok(Some(filter.to_string())),
            Err(e) => Err(format!("Filter kann nicht nach Flux übersetzt werden: {e}")),
        }
    }

    fn flux_base(&self, bucket: &str, measurement: &str, filter: Option<String>) -> String {
        let mut query = format!(
            "from(bucket: {})\n  |> range(start: {})\n  |> filter(fn: (r) => r._measurement == {})\n  |> pivot(rowKey: [\"_time\"], columnKey: [\"_field\"], valueColumn: \"_value\")\n  |> drop(columns: [\"_start\", \"_stop\", \"_measurement\"])\n  |> group()",
            flux_string(bucket),
            self.start(),
            flux_string(measurement)
        );
        if let Some(filter) = filter {
            query.push_str(&format!("\n  |> filter(fn: (r) => {filter})"));
        }
        query
    }

    fn sql_where(&self, filter: Option<&str>, allow_raw: bool) -> Result<String, String> {
        let mut parts = Vec::new();
        if let Some(secs) = self.range {
            parts.push(format!("time >= now() - INTERVAL '{secs} seconds'"));
        }
        if let Some(filter) = filter.map(str::trim).filter(|f| !f.is_empty()) {
            if !allow_raw {
                validate_table_filter(filter)?;
            }
            parts.push(format!("({filter})"));
        }
        Ok(if parts.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", parts.join(" AND "))
        })
    }

    async fn columns(&self, db: &str, table: &str) -> Result<Vec<(String, String)>, String> {
        match self.version().await? {
            Version::V3 => {
                let rows = self
                    .sql_v3(db, &format!("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'iox' AND table_name = {} ORDER BY ordinal_position", lit(table)), false)
                    .await?;
                Ok(rows
                    .iter()
                    .map(|r| {
                        let data_type = text(&r["data_type"]);
                        (
                            text(&r["column_name"]),
                            if data_type.starts_with("Dictionary") {
                                "tag".to_string()
                            } else {
                                data_type
                            },
                        )
                    })
                    .collect())
            }
            Version::V2 => {
                let (_, tags) = self
                    .flux(&format!(
                        "import \"influxdata/influxdb/schema\"\nschema.measurementTagKeys(bucket: {}, measurement: {}, start: {})",
                        flux_string(db),
                        flux_string(table),
                        self.list_start()
                    ))
                    .await?;
                let (_, fields) = self
                    .flux(&format!(
                        "import \"influxdata/influxdb/schema\"\nschema.measurementFieldKeys(bucket: {}, measurement: {}, start: {})",
                        flux_string(db),
                        flux_string(table),
                        self.list_start()
                    ))
                    .await?;
                let mut out = vec![("_time".to_string(), "time".to_string())];
                out.extend(
                    tags.iter()
                        .map(|r| text(&r["_value"]))
                        .filter(|t| !t.starts_with('_'))
                        .map(|t| (t, "tag".to_string())),
                );
                out.extend(
                    fields
                        .iter()
                        .map(|r| (text(&r["_value"]), "field".to_string())),
                );
                Ok(out)
            }
        }
    }

    fn list_start(&self) -> &'static str {
        "time(v: 0)"
    }
}

#[async_trait]
impl DatabaseAdapter for InfluxAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.databases().await.map(|_| ())
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        self.databases().await
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(vec![self.database().await?])
    }

    async fn list_tables(&self, _schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let db = self.database().await?;
        let mut names: Vec<String> = match self.version().await? {
            Version::V3 => self
                .sql_v3(&db, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'iox' ORDER BY table_name", false)
                .await?
                .iter()
                .map(|r| text(&r["table_name"]))
                .collect(),
            Version::V2 => self
                .flux(&format!(
                    "import \"influxdata/influxdb/schema\"\nschema.measurements(bucket: {}, start: {})",
                    flux_string(&db),
                    self.list_start()
                ))
                .await?
                .1
                .iter()
                .map(|r| text(&r["_value"]))
                .collect(),
        };
        names.sort();
        names.dedup();
        Ok(names
            .into_iter()
            .map(|name| TableInfo {
                schema: db.clone(),
                name,
            })
            .collect())
    }

    async fn list_columns(
        &self,
        _schema: Option<&str>,
        table: Option<&str>,
        _table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let db = self.database().await?;
        let tables = match table {
            Some(t) => vec![t.to_string()],
            None => self
                .list_tables(None)
                .await?
                .into_iter()
                .map(|t| t.name)
                .collect(),
        };
        let mut out = Vec::new();
        for table in tables {
            for (name, data_type) in self.columns(&db, &table).await? {
                out.push(ColumnInfo {
                    schema: db.clone(),
                    table: table.clone(),
                    name,
                    data_type,
                });
            }
        }
        Ok(out)
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
        let db = self.database().await?;
        let columns: Vec<String> = self
            .columns(&db, table)
            .await?
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        let (limit, offset) = (limit.max(0), offset.max(0));
        let (names, rows) = match self.version().await? {
            Version::V3 => {
                let order = match order_by {
                    Some(col) if columns.iter().any(|c| c == col) => {
                        format!("{} {}", quote(col), if order_desc { "DESC" } else { "ASC" })
                    }
                    _ => "time DESC".to_string(),
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
                    "SELECT {select} FROM {}{} ORDER BY {order} LIMIT {limit} OFFSET {offset}",
                    quote(table),
                    self.sql_where(filter, allow_raw_filter)?
                );
                objects(columns, self.sql_v3(&db, &sql, false).await?)
            }
            Version::V2 => {
                let (sort, desc) = match order_by {
                    Some(col) if columns.iter().any(|c| c == col) => (col.to_string(), order_desc),
                    _ => ("_time".to_string(), true),
                };
                let query = format!(
                    "{}\n  |> sort(columns: [{}], desc: {desc})\n  |> limit(n: {limit}, offset: {offset})",
                    self.flux_base(&db, table, Self::flux_filter(filter, allow_raw_filter)?),
                    flux_string(&sort)
                );
                let (_, rows) = self.flux(&query).await?;
                objects(columns, rows)
            }
        };
        Ok(TableData {
            columns: names,
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
        let db = self.database().await?;
        match self.version().await? {
            Version::V3 => {
                let rows = self
                    .sql_v3(
                        &db,
                        &format!(
                            "SELECT count(*) AS n FROM {}{}",
                            quote(table),
                            self.sql_where(filter, allow_raw_filter)?
                        ),
                        false,
                    )
                    .await?;
                Ok(rows.first().and_then(|r| r["n"].as_i64()).unwrap_or(0))
            }
            Version::V2 => {
                let query = format!(
                    "{}\n  |> reduce(fn: (r, accumulator) => ({{_value: accumulator._value + 1}}), identity: {{_value: 0}})",
                    self.flux_base(&db, table, Self::flux_filter(filter, allow_raw_filter)?)
                );
                let (_, rows) = self.flux(&query).await?;
                Ok(rows.first().and_then(|r| r["_value"].as_i64()).unwrap_or(0))
            }
        }
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        if is_line_protocol(sql) {
            let written = self.write(sql).await?;
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: Some(written),
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }
        let (columns, rows) = match self.version().await? {
            Version::V3 => {
                let db = self.database().await?;
                let rows = if is_influxql(sql) {
                    self.sql_v3(&db, sql, true).await?
                } else {
                    match self.sql_v3(&db, sql, false).await {
                        Ok(rows) => rows,
                        Err(error) if first_word(sql) == "SELECT" => {
                            self.sql_v3(&db, sql, true).await.map_err(|_| error)?
                        }
                        Err(error) => return Err(error),
                    }
                };
                objects(vec![], rows)
            }
            Version::V2 => {
                if is_flux(sql) || !matches!(first_word(sql).as_str(), "SELECT" | "SHOW") {
                    let (columns, rows) = self.flux(sql).await?;
                    objects(columns, rows)
                } else {
                    let db = self.database().await?;
                    let (columns, rows) = self.influxql_v2(&db, sql).await?;
                    objects(columns, rows)
                }
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
        let db = self.database().await?;
        Ok(self
            .columns(&db, table)
            .await?
            .into_iter()
            .enumerate()
            .map(|(i, (name, data_type))| DetailedColumnInfo {
                is_primary_key: name == "time" || name == "_time" || data_type == "tag",
                is_nullable: !(name == "time" || name == "_time"),
                name,
                data_type,
                column_default: None,
                ordinal_position: i as i32 + 1,
                character_maximum_length: None,
                comment: None,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_urls() {
        let a = InfluxAdapter::new(
            "influxdb://token:abc%3D@localhost:8086/metrics?org=acme&range=7d",
            None,
        )
        .unwrap();
        assert_eq!(a.base, "http://localhost:8086");
        assert_eq!(a.token, "abc=");
        assert_eq!(a.database.as_deref(), Some("metrics"));
        assert_eq!(a.org.as_deref(), Some("acme"));
        assert_eq!(a.range, Some(7 * 86_400));
        let b = InfluxAdapter::new(
            "influxdb://eu-central-1-1.aws.cloud2.influxdata.com?version=3&range=all",
            Some("other"),
        )
        .unwrap();
        assert_eq!(
            b.base,
            "https://eu-central-1-1.aws.cloud2.influxdata.com:443"
        );
        assert_eq!(b.forced, Some(Version::V3));
        assert_eq!(b.range, None);
        assert_eq!(b.database.as_deref(), Some("other"));
        assert!(InfluxAdapter::new("influxdb://h?range=5x", None).is_err());
    }

    #[test]
    fn detects_statement_kinds() {
        assert!(is_line_protocol(
            "cpu,host=a usage=1.5 1700000000000000000\nmem free=3i"
        ));
        assert!(is_line_protocol(
            "weather,city=Berlin note=\"sonnig und warm\""
        ));
        assert!(!is_line_protocol("SELECT * FROM cpu"));
        assert!(!is_line_protocol(
            "from(bucket: \"b\") |> range(start: -1h)"
        ));
        assert!(!is_line_protocol("SHOW MEASUREMENTS"));
        assert!(is_influxql("SHOW TAG KEYS FROM cpu"));
        assert!(!is_influxql("SHOW TABLES"));
        assert_eq!(read_only_statement("cpu v=1"), Some(false));
        assert_eq!(
            read_only_statement("from(bucket:\"a\") |> range(start: -1h) |> to(bucket: \"b\")"),
            Some(false)
        );
        assert_eq!(
            read_only_statement("from(bucket:\"a\") |> range(start: -1h)"),
            Some(true)
        );
        assert_eq!(read_only_statement("SELECT 1"), None);
    }

    #[test]
    fn translates_filters_to_flux() {
        let expr = filter_expr::parse(
            "\"host\" = 'a\"b' AND (\"usage\" > 50 OR \"region\" IS NULL) AND \"name\" ILIKE 'we%' ESCAPE '!'",
        )
        .unwrap();
        assert_eq!(
            to_flux(&expr),
            "(r[\"host\"] == \"a\\\"b\" and (r[\"usage\"] > 50 or not exists r[\"region\"]) and r[\"name\"] =~ /(?i)^we.*$/)"
        );
        assert_eq!(
            to_flux(&filter_expr::parse("\"_time\" >= '2024-01-01T00:00:00Z'").unwrap()),
            "r[\"_time\"] >= time(v: \"2024-01-01T00:00:00Z\")"
        );
    }

    #[test]
    fn parses_annotated_flux_csv() {
        let body = "#datatype,string,long,dateTime:RFC3339,string,double,boolean\n,result,table,_time,host,usage,ok\n,_result,0,2024-01-01T00:00:00Z,a,1.5,true\n,_result,0,2024-01-01T00:00:01Z,\"b,c\",,false\n\n#datatype,string,long,string,long\n,result,table,host,extra\n,_result,1,d,7\n";
        let (columns, rows) = parse_flux_csv(body).unwrap();
        assert_eq!(columns, ["_time", "host", "usage", "ok", "extra"]);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["usage"], json!(1.5));
        assert_eq!(rows[1]["host"], json!("b,c"));
        assert_eq!(rows[1]["usage"], Value::Null);
        assert_eq!(rows[2]["extra"], json!(7));
        let error = "#datatype,string,string\n,error,reference\n,failed to parse,\n";
        assert!(parse_flux_csv(error)
            .unwrap_err()
            .contains("failed to parse"));
    }
}
