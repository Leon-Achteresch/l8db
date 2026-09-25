use std::time::Instant;

use async_trait::async_trait;
use serde_json::{json, Value};

use super::warehouse_auth;
use super::{
    rows_to_objects, timed, where_clause, ColumnInfo, DatabaseAdapter, DetailedColumnInfo,
    ProxyUserInfo, QueryResult, TableData, TableInfo,
};

const MAX_ROWS: usize = 1000;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Auth {
    KeyPair {
        pem: String,
        passphrase: Option<String>,
    },
    KeyFile {
        path: String,
        passphrase: Option<String>,
    },
    Token {
        token: String,
        kind: &'static str,
    },
}

pub struct SnowflakeAdapter {
    account: String,
    endpoint: String,
    user: String,
    auth: Auth,
    database: Option<String>,
    schema: Option<String>,
    warehouse: Option<String>,
    role: Option<String>,
}

pub fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
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

fn safe_int(text: &str) -> Value {
    match text.parse::<i64>() {
        Ok(n) if n.unsigned_abs() <= (1u64 << 53) => Value::from(n),
        _ => Value::String(text.to_string()),
    }
}

fn epoch_parts(text: &str) -> Option<(i64, u32)> {
    let text = text.trim();
    let negative = text.starts_with('-');
    let body = text.trim_start_matches(['-', '+']);
    let (whole, frac) = body.split_once('.').unwrap_or((body, ""));
    if whole.is_empty() && frac.is_empty() {
        return None;
    }
    let whole: i128 = if whole.is_empty() {
        0
    } else {
        whole.parse().ok()?
    };
    let mut digits: String = frac.chars().take(9).collect();
    if !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    while digits.len() < 9 {
        digits.push('0');
    }
    let nanos: i128 = digits.parse().ok()?;
    let mut total = whole * 1_000_000_000 + nanos;
    if negative {
        total = -total;
    }
    Some((
        total.div_euclid(1_000_000_000) as i64,
        total.rem_euclid(1_000_000_000) as u32,
    ))
}

fn fraction(nanos: u32, scale: usize) -> String {
    let scale = scale.min(9);
    if scale == 0 {
        return String::new();
    }
    format!(".{}", &format!("{nanos:09}")[..scale])
}

fn scale_of(column: &Value) -> usize {
    column["scale"].as_u64().unwrap_or(9) as usize
}

pub(crate) fn convert(column: &Value, value: &Value) -> Value {
    let text = match value {
        Value::Null => return Value::Null,
        Value::String(s) => s.as_str(),
        other => return other.clone(),
    };
    let raw = || Value::String(text.to_string());
    match str_of(&column["type"]).to_ascii_lowercase().as_str() {
        "fixed" => {
            if column["scale"].as_i64().unwrap_or(0) == 0 {
                safe_int(text)
            } else {
                raw()
            }
        }
        "real" | "float" | "double" => match text.parse::<f64>() {
            Ok(f) if f.is_finite() => json!(f),
            _ => raw(),
        },
        "boolean" => match text.to_ascii_lowercase().as_str() {
            "true" | "1" => Value::Bool(true),
            "false" | "0" => Value::Bool(false),
            _ => raw(),
        },
        "date" => text
            .parse::<i64>()
            .ok()
            .and_then(|days| {
                chrono::NaiveDate::from_ymd_opt(1970, 1, 1)?
                    .checked_add_signed(chrono::Duration::days(days))
            })
            .map(|d| Value::String(d.format("%Y-%m-%d").to_string()))
            .unwrap_or_else(raw),
        "time" => epoch_parts(text)
            .and_then(|(secs, nanos)| {
                chrono::NaiveTime::from_num_seconds_from_midnight_opt(
                    secs.rem_euclid(86_400) as u32,
                    0,
                )
                .map(|t| {
                    Value::String(format!(
                        "{}{}",
                        t.format("%H:%M:%S"),
                        fraction(nanos, scale_of(column))
                    ))
                })
            })
            .unwrap_or_else(raw),
        "timestamp_ntz" | "timestamp_ltz" => epoch_parts(text)
            .and_then(|(secs, nanos)| {
                chrono::DateTime::from_timestamp(secs, 0).map(|dt| (dt, nanos))
            })
            .map(|(dt, nanos)| {
                let suffix = if str_of(&column["type"]).eq_ignore_ascii_case("timestamp_ltz") {
                    " +00:00"
                } else {
                    ""
                };
                Value::String(format!(
                    "{}{}{suffix}",
                    dt.format("%Y-%m-%d %H:%M:%S"),
                    fraction(nanos, scale_of(column))
                ))
            })
            .unwrap_or_else(raw),
        "timestamp_tz" => {
            let mut parts = text.split_whitespace();
            let epoch = parts.next().and_then(epoch_parts);
            let offset = parts
                .next()
                .and_then(|o| o.parse::<i64>().ok())
                .map(|o| o - 1440)
                .unwrap_or(0);
            epoch
                .and_then(|(secs, nanos)| {
                    let zone = chrono::FixedOffset::east_opt((offset * 60) as i32)?;
                    let dt = chrono::DateTime::from_timestamp(secs, 0)?.with_timezone(&zone);
                    Some(Value::String(format!(
                        "{}{} {}",
                        dt.format("%Y-%m-%d %H:%M:%S"),
                        fraction(nanos, scale_of(column)),
                        dt.format("%:z")
                    )))
                })
                .unwrap_or_else(raw)
        }
        "variant" | "object" | "array" => serde_json::from_str(text).unwrap_or_else(|_| raw()),
        "binary" => {
            let hex = text.to_ascii_lowercase();
            if hex.len() % 2 == 0 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                Value::String(format!("\\x{hex}"))
            } else {
                raw()
            }
        }
        _ => raw(),
    }
}

fn type_label(data_type: &Value) -> String {
    let kind = str_of(&data_type["type"]).to_ascii_uppercase();
    match kind.as_str() {
        "FIXED" => format!(
            "NUMBER({},{})",
            data_type["precision"].as_i64().unwrap_or(38),
            data_type["scale"].as_i64().unwrap_or(0)
        ),
        "TEXT" => match data_type["length"].as_i64() {
            Some(n) => format!("VARCHAR({n})"),
            None => "VARCHAR".into(),
        },
        "REAL" => "FLOAT".into(),
        "" => "UNKNOWN".into(),
        other => other.to_string(),
    }
}

struct Statement {
    columns: Vec<Value>,
    rows: Vec<Vec<Value>>,
    rows_affected: Option<u64>,
}

impl Statement {
    fn names(&self) -> Vec<String> {
        super::unique_column_names(
            self.columns
                .iter()
                .map(|c| str_of(&c["name"]).to_string())
                .collect(),
        )
    }

    fn by_name(&self) -> Vec<std::collections::HashMap<String, Value>> {
        let names: Vec<String> = self
            .columns
            .iter()
            .map(|c| str_of(&c["name"]).to_ascii_lowercase())
            .collect();
        self.rows
            .iter()
            .map(|row| names.iter().cloned().zip(row.iter().cloned()).collect())
            .collect()
    }
}

fn text(row: &std::collections::HashMap<String, Value>, key: &str) -> String {
    match row.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn api_error(status: u16, body: &Value) -> String {
    let message = body["message"]
        .as_str()
        .map(str::to_string)
        .or_else(|| body.as_str().map(str::to_string))
        .unwrap_or_else(|| body.to_string());
    match body["sqlState"].as_str().or_else(|| body["code"].as_str()) {
        Some(code) if !code.is_empty() => format!("Snowflake {status} ({code}): {message}"),
        _ => format!("Snowflake {status}: {message}"),
    }
}

fn convert_rows(columns: &[Value], data: &Value) -> Vec<Vec<Value>> {
    data.as_array()
        .map(|rows| {
            rows.iter()
                .map(|row| {
                    let cells = row.as_array().map(Vec::as_slice).unwrap_or(&[]);
                    columns
                        .iter()
                        .enumerate()
                        .map(|(i, c)| convert(c, cells.get(i).unwrap_or(&Value::Null)))
                        .collect()
                })
                .collect()
        })
        .unwrap_or_default()
}

fn dml_count(stats: &Value) -> Option<u64> {
    let obj = stats.as_object()?;
    let total: u64 = ["numRowsInserted", "numRowsUpdated", "numRowsDeleted"]
        .iter()
        .filter_map(|k| obj.get(*k).and_then(|v| v.as_u64()))
        .sum();
    Some(total)
}

impl SnowflakeAdapter {
    pub fn new(connection_string: &str, database: Option<&str>) -> Result<Self, String> {
        let url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige Snowflake-URL".to_string())?;
        if url.scheme() != "snowflake" {
            return Err("Eine snowflake:// URL ist erforderlich".to_string());
        }
        let host = percent(url.host_str().unwrap_or(""));
        let account = host.trim_end_matches(".snowflakecomputing.com").to_string();
        let mut user = percent(url.username());
        let secret = percent(url.password().unwrap_or(""));
        let mut segments = url
            .path_segments()
            .map(|s| s.map(percent).collect::<Vec<_>>())
            .unwrap_or_default()
            .into_iter()
            .filter(|s| !s.is_empty());
        let mut path_db = segments.next();
        let mut schema = segments.next();
        let mut warehouse = None;
        let mut role = None;
        let mut proxy_role = None;
        let mut authenticator = String::new();
        let mut key_file = None;
        let mut endpoint = None;
        for (k, v) in url.query_pairs() {
            let v = v.trim().to_string();
            if v.is_empty() {
                continue;
            }
            match k.to_ascii_lowercase().as_str() {
                "warehouse" => warehouse = Some(v),
                "role" => role = Some(v),
                "proxy_user" => proxy_role = Some(v),
                "database" | "db" => path_db = Some(v),
                "schema" => schema = Some(v),
                "user" => user = v,
                "authenticator" | "auth" => authenticator = v.to_ascii_lowercase(),
                "private_key_file" | "private_key_path" => key_file = Some(v),
                "endpoint" | "host" => endpoint = Some(v.trim_end_matches('/').to_string()),
                _ => {}
            }
        }
        if account.is_empty() {
            return Err("Der Account-Identifier fehlt (snowflake://account/…).".into());
        }
        let key_pair = key_file.is_some() || secret.contains("-----BEGIN");
        let auth = match authenticator.as_str() {
            "" if key_pair => Self::key_auth(&secret, key_file)?,
            "snowflake_jwt" | "jwt" | "keypair" | "key_pair" => Self::key_auth(&secret, key_file)?,
            "" | "programmatic_access_token" | "pat" => Auth::Token {
                token: secret,
                kind: "PROGRAMMATIC_ACCESS_TOKEN",
            },
            "oauth" => Auth::Token {
                token: secret,
                kind: "OAUTH",
            },
            other => return Err(format!("Unbekannter Snowflake-Authenticator \"{other}\". Erlaubt: snowflake_jwt, programmatic_access_token, oauth.")),
        };
        if let Auth::Token { token, .. } = &auth {
            if token.trim().is_empty() {
                return Err("Das Snowflake-Token fehlt.".into());
            }
        }
        if matches!(auth, Auth::KeyPair { .. } | Auth::KeyFile { .. }) && user.is_empty() {
            return Err("Für Key-Pair-Anmeldung ist der Benutzer erforderlich.".into());
        }
        Ok(Self {
            endpoint: endpoint.unwrap_or_else(|| {
                format!(
                    "https://{}.snowflakecomputing.com",
                    account.to_ascii_lowercase().replace('_', "-")
                )
            }),
            account,
            user,
            auth,
            database: database
                .filter(|d| !d.is_empty())
                .map(str::to_string)
                .or(path_db),
            schema,
            warehouse,
            role: proxy_role.or(role),
        })
    }

    fn key_auth(secret: &str, key_file: Option<String>) -> Result<Auth, String> {
        if let Some(path) = key_file {
            return Ok(Auth::KeyFile {
                path,
                passphrase: Some(secret.to_string()).filter(|s| !s.is_empty()),
            });
        }
        if !secret.contains("-----BEGIN") {
            return Err("Der private Schlüssel (PEM) fehlt.".into());
        }
        let (pem, passphrase) = warehouse_auth::split_key_secret(secret);
        Ok(Auth::KeyPair { pem, passphrase })
    }

    fn token(&self) -> Result<(String, &'static str), String> {
        let (pem, passphrase) = match &self.auth {
            Auth::Token { token, kind } => return Ok((token.trim().to_string(), kind)),
            Auth::KeyPair { pem, passphrase } => (pem.clone(), passphrase.clone()),
            Auth::KeyFile { path, passphrase } => (
                std::fs::read_to_string(path).map_err(|e| {
                    format!("Schlüsseldatei {path} konnte nicht gelesen werden: {e}")
                })?,
                passphrase.clone(),
            ),
        };
        let cache_key = format!(
            "snowflake:{}",
            warehouse_auth::digest_key(&format!("{}\n{}\n{pem}", self.account, self.user))
        );
        if let Some(jwt) = warehouse_auth::cached(&cache_key) {
            return Ok((jwt, "KEYPAIR_JWT"));
        }
        let key = warehouse_auth::load_rsa_key(&pem, passphrase.as_deref())?;
        let jwt = warehouse_auth::snowflake_jwt(
            &key,
            &self.account,
            &self.user,
            warehouse_auth::now_secs(),
        )?;
        warehouse_auth::remember(&cache_key, &jwt, 3000);
        Ok((jwt, "KEYPAIR_JWT"))
    }

    async fn call(
        &self,
        method: reqwest::Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<Value>,
    ) -> Result<(u16, Value), String> {
        let (token, kind) = self.token()?;
        let mut request = warehouse_auth::http()
            .request(method, format!("{}/api/v2/statements{path}", self.endpoint))
            .query(query)
            .bearer_auth(token)
            .header("X-Snowflake-Authorization-Token-Type", kind)
            .header("Accept", "application/json");
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("Snowflake nicht erreichbar: {e}"))?;
        let (status, body) = warehouse_auth::read_body(response, "Snowflake").await?;
        if !(200..300).contains(&status) {
            return Err(api_error(status, &body));
        }
        Ok((status, body))
    }

    fn statement_body(&self, sql: &str) -> Value {
        let count = super::split_statements(sql).len().max(1);
        let mut body = json!({
            "statement": sql,
            "timeout": super::execution::query_duration().as_secs(),
            "parameters": {"MULTI_STATEMENT_COUNT": count.to_string()},
        });
        for (key, value) in [
            ("database", &self.database),
            ("schema", &self.schema),
            ("warehouse", &self.warehouse),
            ("role", &self.role),
        ] {
            if let Some(value) = value {
                body[key] = json!(value);
            }
        }
        body
    }

    async fn cancel(&self, handle: &str) -> Result<(), String> {
        tokio::time::timeout(
            super::execution::connection_duration(),
            self.call(
                reqwest::Method::POST,
                &format!("/{handle}/cancel"),
                &[],
                None,
            ),
        )
        .await
        .map_err(|_| "Zeitüberschreitung".to_string())?
        .map(|_| ())
    }

    async fn wait(&self, handle: &str, deadline: Instant) -> Result<Value, String> {
        let mut delay = 100u64;
        loop {
            let poll = async {
                tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                self.call(reqwest::Method::GET, &format!("/{handle}"), &[], None)
                    .await
            };
            match warehouse_auth::interruptible(poll, deadline).await {
                Ok(result) => {
                    let (status, body) = result?;
                    if status != 202 {
                        return Ok(body);
                    }
                }
                Err(timed_out) => {
                    let confirmed = self.cancel(handle).await;
                    return Err(warehouse_auth::interrupted_message(timed_out, confirmed));
                }
            }
            delay = (delay * 2).min(1000);
        }
    }

    async fn collect(&self, body: Value) -> Result<Statement, String> {
        let columns = body["resultSetMetaData"]["rowType"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let mut rows = convert_rows(&columns, &body["data"]);
        let handle = str_of(&body["statementHandle"]).to_string();
        let partitions = body["resultSetMetaData"]["partitionInfo"]
            .as_array()
            .map(Vec::len)
            .unwrap_or(1);
        let mut partition = 1;
        while partition < partitions && rows.len() < MAX_ROWS && !handle.is_empty() {
            let (_, page) = timed(self.call(
                reqwest::Method::GET,
                &format!("/{handle}"),
                &[("partition", partition.to_string())],
                None,
            ))
            .await?;
            rows.extend(convert_rows(&columns, &page["data"]));
            partition += 1;
        }
        Ok(Statement {
            columns,
            rows,
            rows_affected: dml_count(&body["stats"]),
        })
    }

    async fn run(&self, sql: &str) -> Result<Statement, String> {
        let deadline = Instant::now() + super::execution::query_duration();
        let (status, mut body) = timed(self.call(
            reqwest::Method::POST,
            "",
            &[("async", "true".to_string())],
            Some(self.statement_body(sql)),
        ))
        .await?;
        if status == 202 || body["resultSetMetaData"].is_null() {
            let handle = str_of(&body["statementHandle"]).to_string();
            if handle.is_empty() {
                return Err(api_error(status, &body));
            }
            body = self.wait(&handle, deadline).await?;
        }
        let children: Vec<String> = body["statementHandles"]
            .as_array()
            .map(|h| h.iter().map(|v| str_of(v).to_string()).collect())
            .unwrap_or_default();
        if let Some(last) = children.last() {
            let mut affected = 0u64;
            let mut any = false;
            for child in &children {
                let result = self.wait(child, deadline).await?;
                if let Some(n) = dml_count(&result["stats"]) {
                    affected += n;
                    any = true;
                }
                if child == last {
                    let mut statement = self.collect(result).await?;
                    statement.rows_affected = any.then_some(affected);
                    return Ok(statement);
                }
            }
        }
        self.collect(body).await
    }

    fn database(&self) -> Result<&str, String> {
        self.database.as_deref().ok_or_else(|| {
            "Keine Datenbank ausgewählt. Lege sie in der Verbindung fest.".to_string()
        })
    }

    fn scope(&self, schema: Option<&str>) -> Result<String, String> {
        let database = quote(self.database()?);
        Ok(match schema.or(self.schema.as_deref()) {
            Some(s) => format!("SCHEMA {database}.{}", quote(s)),
            None => format!("DATABASE {database}"),
        })
    }

    fn qualified(&self, schema: &str, table: &str) -> Result<String, String> {
        Ok(format!(
            "{}.{}.{}",
            quote(self.database()?),
            quote(schema),
            quote(table)
        ))
    }

    async fn show(
        &self,
        sql: &str,
    ) -> Result<Vec<std::collections::HashMap<String, Value>>, String> {
        Ok(self.run(sql).await?.by_name())
    }

    async fn relations(&self, schema: Option<&str>, views: bool) -> Result<Vec<TableInfo>, String> {
        let kind = if views { "VIEWS" } else { "TABLES" };
        let rows = self
            .show(&format!("SHOW TERSE {kind} IN {}", self.scope(schema)?))
            .await?;
        let mut out: Vec<TableInfo> = rows
            .iter()
            .map(|r| TableInfo {
                schema: text(r, "schema_name"),
                name: text(r, "name"),
            })
            .filter(|t| t.schema != "INFORMATION_SCHEMA")
            .collect();
        out.sort_by(|a, b| (&a.schema, &a.name).cmp(&(&b.schema, &b.name)));
        Ok(out)
    }

    async fn columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
    ) -> Result<Vec<std::collections::HashMap<String, Value>>, String> {
        let target = match (table, schema.or(self.schema.as_deref())) {
            (Some(t), Some(s)) => format!("TABLE {}", self.qualified(s, t)?),
            (Some(t), None) => format!("TABLE {}.{}", quote(self.database()?), quote(t)),
            (None, _) => self.scope(schema)?,
        };
        self.show(&format!("SHOW COLUMNS IN {target}")).await
    }
}

fn column_type(row: &std::collections::HashMap<String, Value>) -> Value {
    serde_json::from_str(&text(row, "data_type")).unwrap_or(Value::Null)
}

#[async_trait]
impl DatabaseAdapter for SnowflakeAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.run("SELECT 1").await.map(|_| ())
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let mut names: Vec<String> = self
            .show("SHOW TERSE DATABASES")
            .await?
            .iter()
            .map(|r| text(r, "name"))
            .collect();
        names.sort();
        Ok(names)
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        let sql = match &self.database {
            Some(db) => format!("SHOW TERSE SCHEMAS IN DATABASE {}", quote(db)),
            None => "SHOW TERSE SCHEMAS".to_string(),
        };
        let mut names: Vec<String> = self
            .show(&sql)
            .await?
            .iter()
            .map(|r| text(r, "name"))
            .filter(|n| n != "INFORMATION_SCHEMA")
            .collect();
        names.sort();
        Ok(names)
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        self.relations(schema, false).await
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        self.relations(schema, true).await
    }

    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let rows = self
            .show(&format!(
                "SHOW VIEWS LIKE {} IN SCHEMA {}.{}",
                lit(view),
                quote(self.database()?),
                quote(schema)
            ))
            .await?;
        rows.iter()
            .find(|r| text(r, "name") == view)
            .map(|r| text(r, "text"))
            .ok_or_else(|| format!("View {schema}.{view} nicht gefunden"))
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        _table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        Ok(self
            .columns(schema, table)
            .await?
            .iter()
            .map(|r| ColumnInfo {
                schema: text(r, "schema_name"),
                table: text(r, "table_name"),
                name: text(r, "column_name"),
                data_type: type_label(&column_type(r)),
            })
            .collect())
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        Ok(self
            .columns(Some(schema), Some(table))
            .await?
            .iter()
            .enumerate()
            .map(|(index, r)| {
                let data_type = column_type(r);
                DetailedColumnInfo {
                    name: text(r, "column_name"),
                    data_type: type_label(&data_type),
                    is_nullable: data_type["nullable"].as_bool().unwrap_or(true),
                    column_default: Some(text(r, "default")).filter(|d| !d.is_empty()),
                    is_primary_key: false,
                    ordinal_position: index as i32 + 1,
                    character_maximum_length: data_type["length"]
                        .as_i64()
                        .and_then(|n| i32::try_from(n).ok()),
                    comment: Some(text(r, "comment")).filter(|c| !c.is_empty()),
                }
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
        let order_sql = order_by
            .map(|col| {
                format!(
                    " ORDER BY {} {}",
                    quote(col),
                    if order_desc { "DESC" } else { "ASC" }
                )
            })
            .unwrap_or_default();
        let sql = format!(
            "SELECT * FROM {}{where_sql}{order_sql} LIMIT {} OFFSET {}",
            self.qualified(schema, table)?,
            limit.max(0),
            offset.max(0)
        );
        let statement = self.run(&sql).await?;
        let columns = statement.names();
        Ok(TableData {
            rows: rows_to_objects(&columns, statement.rows),
            columns,
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
            let rows = self
                .show(&format!(
                    "SHOW TABLES LIKE {} IN SCHEMA {}.{}",
                    lit(table),
                    quote(self.database()?),
                    quote(schema)
                ))
                .await?;
            if let Some(count) = rows
                .iter()
                .find(|r| text(r, "name") == table)
                .and_then(|r| text(r, "rows").parse::<i64>().ok())
            {
                return Ok(count);
            }
        }
        let statement = self
            .run(&format!(
                "SELECT COUNT(*) FROM {}{where_sql}",
                self.qualified(schema, table)?
            ))
            .await?;
        statement
            .rows
            .first()
            .and_then(|r| r.first())
            .and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            })
            .ok_or_else(|| "COUNT lieferte kein Ergebnis".to_string())
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let started = Instant::now();
        let statement = self.run(sql).await?;
        let columns = statement.names();
        Ok(QueryResult {
            rows: rows_to_objects(&columns, statement.rows),
            columns,
            rows_affected: statement.rows_affected,
            execution_time_ms: started.elapsed().as_millis() as u64,
        })
    }

    async fn explain_query(&self, sql: &str, _analyze: bool) -> Result<Value, String> {
        let statement = self.run(&format!("EXPLAIN USING TEXT {sql}")).await?;
        let lines: Vec<String> = statement
            .rows
            .iter()
            .filter_map(|r| r.first())
            .map(|v| {
                v.as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| v.to_string())
            })
            .collect();
        Ok(Value::String(lines.join("\n")))
    }

    async fn list_proxy_users(&self) -> Result<Vec<ProxyUserInfo>, String> {
        let mut names: Vec<String> = self
            .show("SHOW ROLES")
            .await?
            .iter()
            .map(|r| text(r, "name"))
            .filter(|n| !n.is_empty())
            .collect();
        names.sort();
        names.dedup();
        Ok(names
            .into_iter()
            .map(|name| ProxyUserInfo {
                name,
                category: "role",
                bypasses_rls: false,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::execution::{self, ExecutionOptions};
    use crate::db::http_mock;
    use crate::db::warehouse_auth::tests::test_key_pem;

    fn encode(value: &str) -> String {
        url::form_urlencoded::byte_serialize(value.as_bytes())
            .collect::<String>()
            .replace('+', "%20")
    }

    fn pat_adapter(base: &str) -> SnowflakeAdapter {
        SnowflakeAdapter::new(
            &format!(
                "snowflake://svc:pat123@acme-main/SALES/PUBLIC?warehouse=WH&role=ANALYST&endpoint={}",
                encode(base)
            ),
            None,
        )
        .unwrap()
    }

    fn col(name: &str, kind: &str, scale: i64) -> Value {
        json!({"name": name, "type": kind, "scale": scale, "nullable": true})
    }

    #[test]
    fn parses_urls_and_authenticators() {
        let pem = test_key_pem();
        let a = SnowflakeAdapter::new(
            &format!(
                "snowflake://svc:{}@xy12345.eu-central-1/DB/S?warehouse=WH&role=R&proxy_user=ADMIN",
                encode(&format!("{pem}geheim"))
            ),
            None,
        )
        .unwrap();
        assert_eq!(a.account, "xy12345.eu-central-1");
        assert_eq!(
            a.endpoint,
            "https://xy12345.eu-central-1.snowflakecomputing.com"
        );
        assert_eq!(a.database.as_deref(), Some("DB"));
        assert_eq!(a.schema.as_deref(), Some("S"));
        assert_eq!(a.warehouse.as_deref(), Some("WH"));
        assert_eq!(a.role.as_deref(), Some("ADMIN"));
        match &a.auth {
            Auth::KeyPair { passphrase, .. } => assert_eq!(passphrase.as_deref(), Some("geheim")),
            other => panic!("{other:?}"),
        }
        let a = SnowflakeAdapter::new(
            "snowflake://u:tok@my_org-acct.snowflakecomputing.com",
            Some("OTHER"),
        )
        .unwrap();
        assert_eq!(a.endpoint, "https://my-org-acct.snowflakecomputing.com");
        assert_eq!(a.database.as_deref(), Some("OTHER"));
        assert_eq!(
            a.auth,
            Auth::Token {
                token: "tok".into(),
                kind: "PROGRAMMATIC_ACCESS_TOKEN"
            }
        );
        let a = SnowflakeAdapter::new("snowflake://:tok@acct?authenticator=oauth", None).unwrap();
        assert_eq!(
            a.auth,
            Auth::Token {
                token: "tok".into(),
                kind: "OAUTH"
            }
        );
        let a = SnowflakeAdapter::new(
            "snowflake://u:pw@acct?private_key_file=%2Fkeys%2Frsa.p8",
            None,
        )
        .unwrap();
        assert_eq!(
            a.auth,
            Auth::KeyFile {
                path: "/keys/rsa.p8".into(),
                passphrase: Some("pw".into())
            }
        );
        assert!(SnowflakeAdapter::new("snowflake://u@acct", None).is_err());
        assert!(SnowflakeAdapter::new("snowflake://u:x@acct?authenticator=jwt", None).is_err());
        assert!(
            SnowflakeAdapter::new("snowflake://u:x@acct?authenticator=externalbrowser", None)
                .is_err()
        );
    }

    #[test]
    fn converts_result_types() {
        assert_eq!(convert(&col("n", "fixed", 0), &json!("42")), json!(42));
        assert_eq!(
            convert(&col("n", "fixed", 0), &json!("99999999999999999999")),
            json!("99999999999999999999")
        );
        assert_eq!(
            convert(&col("n", "fixed", 2), &json!("12.50")),
            json!("12.50")
        );
        assert_eq!(convert(&col("r", "real", 0), &json!("1.5")), json!(1.5));
        assert_eq!(
            convert(&col("b", "boolean", 0), &json!("true")),
            json!(true)
        );
        assert_eq!(
            convert(&col("d", "date", 0), &json!("18262")),
            json!("2020-01-01")
        );
        assert_eq!(
            convert(&col("d", "date", 0), &json!("-1")),
            json!("1969-12-31")
        );
        assert_eq!(
            convert(&col("t", "time", 3), &json!("3723.500000000")),
            json!("01:02:03.500")
        );
        assert_eq!(
            convert(
                &col("ts", "timestamp_ntz", 9),
                &json!("1577836800.123456789")
            ),
            json!("2020-01-01 00:00:00.123456789")
        );
        assert_eq!(
            convert(&col("ts", "timestamp_ntz", 1), &json!("-1.500000000")),
            json!("1969-12-31 23:59:58.5")
        );
        assert_eq!(
            convert(
                &col("ts", "timestamp_ltz", 0),
                &json!("1577836800.000000000")
            ),
            json!("2020-01-01 00:00:00 +00:00")
        );
        assert_eq!(
            convert(
                &col("ts", "timestamp_tz", 3),
                &json!("1577836800.250000000 1500")
            ),
            json!("2020-01-01 01:00:00.250 +01:00")
        );
        assert_eq!(
            convert(
                &col("ts", "timestamp_tz", 0),
                &json!("1577836800.000000000 1140")
            ),
            json!("2019-12-31 19:00:00 -05:00")
        );
        assert_eq!(
            convert(&col("v", "variant", 0), &json!("{\n  \"a\": [1, 2]\n}")),
            json!({"a": [1, 2]})
        );
        assert_eq!(convert(&col("a", "array", 0), &json!("[1]")), json!([1]));
        assert_eq!(
            convert(&col("bin", "binary", 0), &json!("DEADBEEF")),
            json!("\\xdeadbeef")
        );
        assert_eq!(convert(&col("s", "text", 0), &json!("x")), json!("x"));
        assert_eq!(convert(&col("s", "text", 0), &Value::Null), Value::Null);
        assert_eq!(
            type_label(&json!({"type": "FIXED", "precision": 10, "scale": 2})),
            "NUMBER(10,2)"
        );
        assert_eq!(
            type_label(&json!({"type": "TEXT", "length": 16777216})),
            "VARCHAR(16777216)"
        );
    }

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        use std::io::Write;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    #[tokio::test]
    async fn async_statement_polls_and_reads_partitions_with_jwt() {
        let polls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = polls.clone();
        let server = http_mock::start(move |req| {
            assert!(req
                .header("authorization")
                .is_some_and(|h| h.starts_with("Bearer ey")));
            assert_eq!(
                req.header("x-snowflake-authorization-token-type"),
                Some("KEYPAIR_JWT")
            );
            match (req.method.as_str(), req.route()) {
                ("POST", "/api/v2/statements") => {
                    assert_eq!(req.query("async").as_deref(), Some("true"));
                    let body = req.json();
                    assert_eq!(body["statement"], json!("SELECT * FROM T"));
                    assert_eq!(body["warehouse"], json!("WH"));
                    assert_eq!(body["role"], json!("ANALYST"));
                    assert_eq!(body["database"], json!("SALES"));
                    assert_eq!(body["schema"], json!("PUBLIC"));
                    assert_eq!(body["parameters"]["MULTI_STATEMENT_COUNT"], json!("1"));
                    (202, json!({"statementHandle": "h1", "statementStatusUrl": "/api/v2/statements/h1"}).to_string().into())
                }
                ("GET", "/api/v2/statements/h1") => {
                    if req.query("partition").as_deref() == Some("1") {
                        return (200, gzip(br#"{"data": [["3", "c"]]}"#));
                    }
                    if counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                        return (
                            202,
                            json!({"message": "Asynchronous execution in progress."})
                                .to_string()
                                .into(),
                        );
                    }
                    (
                        200,
                        json!({
                            "statementHandle": "h1",
                            "resultSetMetaData": {
                                "numRows": 3,
                                "partitionInfo": [{"rowCount": 2}, {"rowCount": 1}],
                                "rowType": [col("ID", "fixed", 0), col("NAME", "text", 0)]
                            },
                            "data": [["1", "a"], ["2", null]]
                        })
                        .to_string()
                        .into(),
                    )
                }
                _ => (404, "{}".into()),
            }
        });
        let a = SnowflakeAdapter::new(
            &format!(
                "snowflake://svc:{}@acme/SALES/PUBLIC?warehouse=WH&role=ANALYST&endpoint={}",
                encode(&test_key_pem()),
                encode(&server.base)
            ),
            None,
        )
        .unwrap();
        let result = a.execute_query("SELECT * FROM T").await.unwrap();
        assert_eq!(result.columns, ["ID", "NAME"]);
        assert_eq!(result.rows.len(), 3);
        assert_eq!(result.rows[1]["NAME"], Value::Null);
        assert_eq!(result.rows[2]["ID"], json!(3));
        assert_eq!(polls.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn multi_statement_returns_last_result_and_dml_counts() {
        let server = http_mock::start(|req| {
            assert_eq!(
                req.header("x-snowflake-authorization-token-type"),
                Some("PROGRAMMATIC_ACCESS_TOKEN")
            );
            assert_eq!(req.header("authorization"), Some("Bearer pat123"));
            let body = match (req.method.as_str(), req.route()) {
                ("POST", "/api/v2/statements") => {
                    assert_eq!(
                        req.json()["parameters"]["MULTI_STATEMENT_COUNT"],
                        json!("2")
                    );
                    json!({
                        "statementHandle": "parent",
                        "statementHandles": ["c1", "c2"],
                        "resultSetMetaData": {"rowType": [col("status", "text", 0)]},
                        "data": [["Multiple statements executed successfully."]]
                    })
                }
                ("GET", "/api/v2/statements/c1") => json!({
                    "statementHandle": "c1",
                    "resultSetMetaData": {"rowType": [col("number of rows updated", "fixed", 0)]},
                    "data": [["4"]],
                    "stats": {"numRowsUpdated": 4}
                }),
                ("GET", "/api/v2/statements/c2") => json!({
                    "statementHandle": "c2",
                    "resultSetMetaData": {"rowType": [col("X", "fixed", 0)]},
                    "data": [["1"]]
                }),
                _ => return (404, "{}".into()),
            };
            (200, body.to_string().into())
        });
        let result = pat_adapter(&server.base)
            .execute_query("UPDATE T SET A = 1; SELECT 1 AS X")
            .await
            .unwrap();
        assert_eq!(result.columns, ["X"]);
        assert_eq!(result.rows[0]["X"], json!(1));
        assert_eq!(result.rows_affected, Some(4));
    }

    fn show(columns: &[&str], rows: Value) -> Vec<u8> {
        json!({
            "statementHandle": "s",
            "resultSetMetaData": {"rowType": columns.iter().map(|c| col(c, "text", 0)).collect::<Vec<_>>()},
            "data": rows
        })
        .to_string()
        .into()
    }

    #[tokio::test]
    async fn catalog_uses_show_commands() {
        let server = http_mock::start(|req| {
            let statement = req.json()["statement"].as_str().unwrap_or("").to_string();
            let response = match statement.as_str() {
                "SHOW TERSE DATABASES" => show(&["created_on", "name"], json!([["0", "SALES"], ["0", "ANALYTICS"]])),
                "SHOW TERSE SCHEMAS IN DATABASE \"SALES\"" => show(&["name"], json!([["PUBLIC"], ["INFORMATION_SCHEMA"]])),
                "SHOW TERSE TABLES IN SCHEMA \"SALES\".\"PUBLIC\"" => show(&["name", "kind", "database_name", "schema_name"], json!([["ORDERS", "TABLE", "SALES", "PUBLIC"]])),
                "SHOW TERSE VIEWS IN SCHEMA \"SALES\".\"PUBLIC\"" => show(&["name", "kind", "database_name", "schema_name"], json!([["V1", "VIEW", "SALES", "PUBLIC"]])),
                "SHOW VIEWS LIKE 'V1' IN SCHEMA \"SALES\".\"PUBLIC\"" => show(&["name", "text"], json!([["V1", "create view V1 as select 1"]])),
                "SHOW COLUMNS IN TABLE \"SALES\".\"PUBLIC\".\"ORDERS\"" => show(
                    &["table_name", "schema_name", "column_name", "data_type", "null?", "default", "comment"],
                    json!([
                        ["ORDERS", "PUBLIC", "ID", "{\"type\":\"FIXED\",\"precision\":38,\"scale\":0,\"nullable\":false}", "NOT_NULL", "", ""],
                        ["ORDERS", "PUBLIC", "NOTE", "{\"type\":\"TEXT\",\"length\":100,\"nullable\":true}", "true", "'x'", "Hinweis"]
                    ]),
                ),
                "SHOW TABLES LIKE 'ORDERS' IN SCHEMA \"SALES\".\"PUBLIC\"" => show(&["name", "rows"], json!([["ORDERS", "77"]])),
                "SHOW ROLES" => show(&["name"], json!([["SYSADMIN"], ["ANALYST"]])),
                "SELECT * FROM \"SALES\".\"PUBLIC\".\"ORDERS\" WHERE ID > 1 ORDER BY \"ID\" DESC LIMIT 5 OFFSET 10" => json!({
                    "statementHandle": "s",
                    "resultSetMetaData": {"rowType": [col("ID", "fixed", 0)]},
                    "data": [["2"]]
                }).to_string().into(),
                "SELECT COUNT(*) FROM \"SALES\".\"PUBLIC\".\"ORDERS\" WHERE ID > 1" => json!({
                    "statementHandle": "s",
                    "resultSetMetaData": {"rowType": [col("COUNT(*)", "fixed", 0)]},
                    "data": [["12"]]
                }).to_string().into(),
                "EXPLAIN USING TEXT SELECT 1" => show(&["content"], json!([["GlobalStats:"], ["Result"]])),
                other => return (422, json!({"code": "002003", "sqlState": "42S02", "message": format!("unbekannt: {other}")}).to_string().into()),
            };
            (200, response)
        });
        let a = pat_adapter(&server.base);
        assert_eq!(a.list_databases().await.unwrap(), ["ANALYTICS", "SALES"]);
        assert_eq!(a.list_schemas().await.unwrap(), ["PUBLIC"]);
        let tables = a.list_tables(Some("PUBLIC")).await.unwrap();
        assert_eq!(
            (tables[0].schema.as_str(), tables[0].name.as_str()),
            ("PUBLIC", "ORDERS")
        );
        assert_eq!(a.list_views(Some("PUBLIC")).await.unwrap()[0].name, "V1");
        assert_eq!(
            a.get_view_definition("PUBLIC", "V1").await.unwrap(),
            "create view V1 as select 1"
        );
        let columns = a
            .list_columns(Some("PUBLIC"), Some("ORDERS"), None)
            .await
            .unwrap();
        assert_eq!(columns[0].data_type, "NUMBER(38,0)");
        let detailed = a
            .list_table_columns_detailed("PUBLIC", "ORDERS")
            .await
            .unwrap();
        assert!(!detailed[0].is_nullable);
        assert_eq!(detailed[1].column_default.as_deref(), Some("'x'"));
        assert_eq!(detailed[1].character_maximum_length, Some(100));
        assert_eq!(detailed[1].comment.as_deref(), Some("Hinweis"));
        assert_eq!(
            a.count_rows("PUBLIC", "ORDERS", None, false).await.unwrap(),
            77
        );
        assert_eq!(
            a.count_rows("PUBLIC", "ORDERS", Some("ID > 1"), false)
                .await
                .unwrap(),
            12
        );
        let data = a
            .fetch_rows(
                "PUBLIC",
                "ORDERS",
                Some("ID > 1"),
                5,
                10,
                Some("ID"),
                true,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(data.rows[0]["ID"], json!(2));
        let roles = a.list_proxy_users().await.unwrap();
        assert_eq!(roles[0].name, "ANALYST");
        assert_eq!(roles[0].category, "role");
        assert_eq!(
            a.explain_query("SELECT 1", false).await.unwrap(),
            json!("GlobalStats:\nResult")
        );
        let err = a.execute_query("SELECT * FROM MISSING").await.unwrap_err();
        assert!(err.starts_with("Snowflake 422 (42S02): unbekannt"), "{err}");
    }

    #[tokio::test]
    async fn cancel_posts_cancel_endpoint() {
        let server = http_mock::start(|req| match (req.method.as_str(), req.route()) {
            ("POST", "/api/v2/statements") => {
                (202, json!({"statementHandle": "slow"}).to_string().into())
            }
            ("GET", "/api/v2/statements/slow") => {
                (202, json!({"message": "running"}).to_string().into())
            }
            ("POST", "/api/v2/statements/slow/cancel") => {
                (200, json!({"message": "cancelled"}).to_string().into())
            }
            _ => (404, "{}".into()),
        });
        let a = pat_adapter(&server.base);
        let run = execution::run(
            Some(ExecutionOptions {
                job_id: Some("sf-cancel-test".into()),
                ..Default::default()
            }),
            true,
            a.execute_query("SELECT SYSTEM$WAIT(60)"),
        );
        let cancel = async {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            assert!(execution::cancel("sf-cancel-test").unwrap());
        };
        let (result, _) = tokio::join!(run, cancel);
        assert_eq!(result.unwrap_err(), "Abfrage vom Server abgebrochen.");
        assert!(server
            .requests()
            .iter()
            .any(|r| r.route() == "/api/v2/statements/slow/cancel"));
    }
}
