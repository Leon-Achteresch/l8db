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

pub fn endpoint(value: &str) -> Result<super::endpoint::EndpointIdentity, String> {
    let adapter = ClickhouseAdapter::new(value, None)?;
    let base =
        url::Url::parse(&adapter.base).map_err(|_| "Ungültige ClickHouse-URL".to_string())?;
    let tls = base.scheme() == "https";
    Ok(super::endpoint::EndpointIdentity {
        host: super::endpoint::host_of(&base),
        port: base.port_or_known_default(),
        transport: base.scheme().to_string(),
        tls,
        verify: tls,
        database: adapter.database,
        schema: String::new(),
        user: adapter.user,
        params: Vec::new(),
    })
}

impl ClickhouseAdapter {
    pub fn new(connection_string: &str, database: Option<&str>) -> Result<Self, String> {
        let url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige ClickHouse-URL".to_string())?;
        if !matches!(url.scheme(), "clickhouse" | "http" | "https") {
            return Err("Eine clickhouse:// URL ist erforderlich".to_string());
        }
        let host = url.host_str().ok_or("Host fehlt")?;
        let explicit = super::http_api::explicit_port(connection_string, &url);
        let mut secure = url.scheme() == "https" || matches!(explicit, Some(8443) | Some(443));
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
        let port = explicit.unwrap_or(if secure { 8443 } else { 8123 });
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
        let reason = if timed_out {
            format!(
                "Query-Timeout nach {} Sekunden: ",
                super::execution::query_duration().as_secs()
            )
        } else {
            String::new()
        };
        Err(match self.kill(&query_id).await {
            Ok(()) => format!("{reason}Abfrage vom Server abgebrochen."),
            Err(error) => format!("{reason}{error}"),
        })
    }

    async fn send(
        &self,
        sql: &str,
        extra: &[(&str, &str)],
        query_id: &str,
    ) -> Result<(String, Option<serde_json::Value>), String> {
        let mut response = http()
            .post(&self.base)
            .query(&[
                ("database", self.database.as_str()),
                ("query_id", query_id),
                ("default_format", OUTPUT_FORMAT),
                ("output_format_json_quote_64bit_integers", "0"),
                ("output_format_json_quote_decimals", "1"),
                ("output_format_json_quote_denormals", "1"),
                ("http_write_exception_in_output_format", "0"),
            ])
            .query(extra)
            .header("X-ClickHouse-User", &self.user)
            .header("X-ClickHouse-Key", &self.password)
            .body(sql.to_string())
            .send()
            .await
            .map_err(|e| self.unreachable(e))?;
        let summary = response
            .headers()
            .get("X-ClickHouse-Summary")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| serde_json::from_str(s).ok());
        let status = response.status();
        let max_lines = super::execution::row_limit().checked_add(2);
        let mut body = Vec::new();
        let mut lines = 0usize;
        let mut stopped = false;
        let mut broken = None;
        loop {
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(e) => {
                    broken = Some(format!(
                        "Antwort konnte nicht gelesen werden: {}",
                        e.without_url()
                    ));
                    break;
                }
            };
            body.extend_from_slice(&chunk);
            if let Some(max) = max_lines.filter(|_| status.is_success()) {
                lines += chunk.iter().filter(|b| **b == b'\n').count();
                if lines >= max {
                    stopped = true;
                    break;
                }
            }
        }
        if stopped {
            drop(response);
            if let Some(end) = max_lines.and_then(|max| {
                body.iter()
                    .enumerate()
                    .filter(|(_, b)| **b == b'\n')
                    .nth(max - 1)
                    .map(|(i, _)| i + 1)
            }) {
                body.truncate(end);
            }
            let _ = self.kill(query_id).await;
        }
        let body = lossless_text(body);
        if !status.is_success() {
            return Err(self.server_error(status.as_u16(), &body));
        }
        if let Some(error) = broken {
            return Err(parse_body(&body).err().unwrap_or(error));
        }
        Ok((body, summary))
    }

    fn unreachable(&self, error: reqwest::Error) -> String {
        let base = url::Url::parse(&self.base).ok();
        let host = base
            .as_ref()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_default();
        let port = base
            .as_ref()
            .and_then(url::Url::port_or_known_default)
            .unwrap_or(0);
        let tls = self.base.starts_with("https");
        let timeout = error.is_timeout();
        let error = error.without_url();
        let mut chain = error.to_string();
        let mut source = std::error::Error::source(&error);
        while let Some(inner) = source {
            chain.push_str(": ");
            chain.push_str(&inner.to_string());
            source = inner.source();
        }
        let lower = chain.to_ascii_lowercase();
        let tls_failed = ["tls", "ssl", "certificate", "handshake"]
            .iter()
            .any(|w| lower.contains(w));
        let reason = if timeout {
            "Zeitüberschreitung beim Verbindungsaufbau".to_string()
        } else if lower.contains("refused") {
            "Verbindung abgelehnt".to_string()
        } else if lower.contains("dns")
            || lower.contains("lookup")
            || lower.contains("nodename")
            || lower.contains("not known")
        {
            "Host nicht gefunden".to_string()
        } else if tls_failed || tls {
            "TLS-Verbindung fehlgeschlagen".to_string()
        } else {
            chain
        };
        let hint = if matches!(port, 9000 | 9440) {
            format!(" Port {port} ist der native ClickHouse-Port; l8db nutzt die HTTP-Schnittstelle (8123, mit TLS 8443).")
        } else if tls && (tls_failed || !lower.contains("refused")) {
            format!(" Spricht Port {port} HTTPS? Sonst ohne ?secure=1 verbinden (HTTP-Port 8123).")
        } else {
            String::new()
        };
        format!("ClickHouse unter {host}:{port} nicht erreichbar: {reason}.{hint}")
    }

    fn server_error(&self, status: u16, body: &str) -> String {
        let body = body.trim();
        if body.contains("is for clickhouse-client program") {
            let port = url::Url::parse(&self.base)
                .ok()
                .and_then(|u| u.port_or_known_default())
                .unwrap_or(0);
            return format!("Port {port} ist der native ClickHouse-Port. l8db nutzt die HTTP-Schnittstelle (8123, mit TLS 8443).");
        }
        let message = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|v| {
                v.get("exception")
                    .and_then(|e| e.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| body.to_string());
        if message.is_empty() {
            return format!("ClickHouse antwortet mit HTTP {status}.");
        }
        explain_exception(&message)
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
            .map_err(|e| {
                format!(
                    "Abbruch nicht bestätigt: {}. Serverzustand prüfen.",
                    e.without_url()
                )
            })
    }

    async fn query(
        &self,
        sql: &str,
    ) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>, Option<u64>), String> {
        let sql = match output_format(sql) {
            Some((start, end, name)) if !name.eq_ignore_ascii_case("Null") => {
                format!("{}{}", &sql[..start], &sql[end..])
            }
            _ => sql.to_string(),
        };
        let (body, summary) = self.raw(&sql).await?;
        let written = summary
            .as_ref()
            .and_then(|s| s.get("written_rows"))
            .map(int)
            .map(|n| n as u64);
        let (columns, rows) = parse_body(&body)?;
        Ok((columns, rows, written))
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Vec<serde_json::Value>>, String> {
        self.query(sql).await.map(|(_, rows, _)| rows)
    }

    async fn exec(&self, sql: &str) -> Result<(), String> {
        self.raw(sql).await.map(|_| ())
    }
}

const OUTPUT_FORMAT: &str = "JSONCompactEachRowWithNamesAndTypes";

const AGGREGATE_STATE: &str = "‹Aggregationszustand›";

const MUTATION_STARTED: &str = "Mutation gestartet, läuft asynchron (system.mutations)";

fn lossless_text(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => {
            let bytes = error.into_bytes();
            let mut out = String::with_capacity(bytes.len() + 16);
            for chunk in bytes.utf8_chunks() {
                out.push_str(chunk.valid());
                for byte in chunk.invalid() {
                    out.push_str(&format!("\\\\x{byte:02X}"));
                }
            }
            out
        }
    }
}

fn explain_exception(message: &str) -> String {
    let message = message.trim();
    let code = message
        .strip_prefix("Code: ")
        .and_then(|rest| rest.split('.').next())
        .and_then(|c| c.trim().parse::<u32>().ok());
    let detail = message
        .split_once("DB::Exception: ")
        .map_or(message, |(_, d)| d);
    let detail = detail.split(" (version ").next().unwrap_or(detail).trim();
    let detail = match detail.rfind(" (") {
        Some(i)
            if detail.ends_with(')')
                && detail[i + 2..detail.len() - 1]
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c == '_') =>
        {
            detail[..i].trim()
        }
        _ => detail,
    };
    let detail = detail.trim_end_matches('.');
    match code {
        Some(62) => syntax_error(detail),
        Some(60) => format!("Tabelle nicht gefunden: {detail}."),
        Some(81) => detail
            .strip_prefix("Database ")
            .and_then(|rest| rest.strip_suffix(" does not exist"))
            .map(|name| format!("Datenbank „{}“ existiert nicht.", name.trim_matches('`')))
            .unwrap_or_else(|| format!("Datenbank nicht gefunden: {detail}.")),
        Some(192 | 193 | 194 | 516) => {
            "Anmeldung fehlgeschlagen: Benutzer oder Passwort falsch.".to_string()
        }
        Some(497) => format!("Keine Berechtigung: {detail}."),
        Some(47) => format!("Unbekannte Spalte oder Bezeichner: {detail}."),
        Some(46) => format!("Unbekannte Funktion: {detail}."),
        Some(48)
            if detail.contains("Lightweight updates")
                || detail.contains("DELETE query is not supported") =>
        {
            format!("UPDATE und DELETE gehen nur bei MergeTree-Tabellen: {detail}.")
        }
        Some(48) => format!("Nicht unterstützt: {detail}."),
        Some(43 | 53) => format!("Typfehler: {detail}."),
        Some(57) => format!("Tabelle existiert bereits: {detail}."),
        Some(82) => format!("Datenbank existiert bereits: {detail}."),
        Some(159) => format!("Zeitlimit des Servers überschritten: {detail}."),
        Some(164) => format!("Nur Lesezugriff erlaubt: {detail}."),
        Some(241) => format!("Speicherlimit des Servers überschritten: {detail}."),
        Some(394) => "Abfrage abgebrochen.".to_string(),
        Some(_) => format!("{detail}."),
        None => message.to_string(),
    }
}

fn syntax_error(detail: &str) -> String {
    let Some(rest) = detail
        .split_once("failed at position ")
        .map(|(_, rest)| rest)
    else {
        return format!("Syntaxfehler: {detail}.");
    };
    let position: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let near = rest
        .split_once(" (")
        .and_then(|(_, r)| r.split_once("):"))
        .map(|(token, _)| format!(" bei „{token}“"))
        .unwrap_or_default();
    let expected = rest
        .split_once("Expected ")
        .map(|(_, e)| {
            let items: Vec<&str> = e
                .trim_start_matches("one of: ")
                .trim_end_matches('.')
                .split(", ")
                .collect();
            let more = if items.len() > 8 { ", …" } else { "" };
            format!(
                "\nErwartet: {}{more}",
                items[..items.len().min(8)].join(", ")
            )
        })
        .unwrap_or_default();
    format!("Syntaxfehler an Position {position}{near}.{expected}")
}

fn base_type(column_type: &str) -> &str {
    let mut current = column_type.trim();
    loop {
        let inner = ["Nullable(", "LowCardinality(", "Array("]
            .iter()
            .find_map(|prefix| current.strip_prefix(prefix))
            .and_then(|rest| rest.strip_suffix(')'));
        match inner {
            Some(inner) => current = inner.trim(),
            None => return current,
        }
    }
}

fn quote_unsafe_integers(line: &str) -> std::borrow::Cow<'_, str> {
    let bytes = line.as_bytes();
    let mut out: Option<String> = None;
    let mut copied = 0;
    let mut i = 0;
    let mut in_string = false;
    while i < bytes.len() {
        let c = bytes[i];
        if in_string {
            match c {
                b'\\' => i += 2,
                b'"' => {
                    in_string = false;
                    i += 1;
                }
                _ => i += 1,
            }
            continue;
        }
        if c == b'"' {
            in_string = true;
            i += 1;
            continue;
        }
        if c == b'-' || c.is_ascii_digit() {
            let start = i;
            i += 1;
            while i < bytes.len()
                && matches!(bytes[i], b'0'..=b'9' | b'.' | b'e' | b'E' | b'+' | b'-')
            {
                i += 1;
            }
            let token = &line[start..i];
            if !token.contains(['.', 'e', 'E']) && !super::exact_number::is_exact_in_js(token) {
                let o = out.get_or_insert_with(|| String::with_capacity(line.len() + 8));
                o.push_str(&line[copied..start]);
                o.push('"');
                o.push_str(token);
                o.push('"');
                copied = i;
            }
            continue;
        }
        i += 1;
    }
    match out {
        Some(mut o) => {
            o.push_str(&line[copied..]);
            std::borrow::Cow::Owned(o)
        }
        None => std::borrow::Cow::Borrowed(line),
    }
}

type Rows = Vec<Vec<serde_json::Value>>;

fn parse_body(body: &str) -> Result<(Vec<String>, Rows), String> {
    let mut lines = body.lines().filter(|l| !l.trim().is_empty());
    let Some(first) = lines.next() else {
        return Ok((vec![], vec![]));
    };
    let names = match serde_json::from_str::<serde_json::Value>(first) {
        Ok(serde_json::Value::Array(names)) => names.iter().map(text).collect::<Vec<_>>(),
        _ => {
            return Ok((
                vec!["result".to_string()],
                body.lines()
                    .map(|l| vec![serde_json::Value::String(l.to_string())])
                    .collect(),
            ))
        }
    };
    let types: Vec<String> = lines
        .next()
        .and_then(|l| serde_json::from_str::<Vec<String>>(l).ok())
        .unwrap_or_default();
    let rest: Vec<&str> = lines.collect();
    let mut rows = Vec::with_capacity(rest.len());
    for (i, line) in rest.iter().enumerate() {
        let parsed = serde_json::from_str::<serde_json::Value>(&quote_unsafe_integers(line));
        let Ok(serde_json::Value::Array(mut row)) = parsed else {
            let message = rest[i..]
                .iter()
                .map(|l| l.trim())
                .find(|l| l.starts_with("Code: "))
                .unwrap_or(line);
            return Err(explain_exception(message));
        };
        for (value, column_type) in row.iter_mut().zip(&types) {
            let base = base_type(column_type);
            if base.starts_with("Decimal") {
                unquote_safe_ints(value);
            } else if base.starts_with("AggregateFunction(") && !value.is_null() {
                *value = serde_json::Value::String(AGGREGATE_STATE.to_string());
            }
        }
        rows.push(row);
    }
    Ok((super::unique_column_names(names), rows))
}

struct Token {
    start: usize,
    end: usize,
    word: bool,
    depth: usize,
}

fn tokens(sql: &str) -> Vec<Token> {
    let bytes = sql.as_bytes();
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let start = i;
        match c {
            b'\'' | b'"' | b'`' => {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\\' {
                        i += 2;
                        continue;
                    }
                    if bytes[i] == c {
                        if bytes.get(i + 1) == Some(&c) {
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    i += 1;
                }
                let end = i.min(bytes.len());
                out.push(Token {
                    start,
                    end,
                    word: false,
                    depth,
                });
                i = end;
            }
            b'-' if bytes.get(i + 1) == Some(&b'-') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'#' if matches!(bytes.get(i + 1), Some(b' ' | b'!')) => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i = sql[i + 2..]
                    .find("*/")
                    .map_or(bytes.len(), |p| i + 2 + p + 2);
            }
            b'(' | b'[' => {
                out.push(Token {
                    start,
                    end: i + 1,
                    word: false,
                    depth,
                });
                depth += 1;
                i += 1;
            }
            b')' | b']' => {
                depth = depth.saturating_sub(1);
                out.push(Token {
                    start,
                    end: i + 1,
                    word: false,
                    depth,
                });
                i += 1;
            }
            c if c.is_ascii_alphabetic() || c == b'_' => {
                while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                    i += 1;
                }
                out.push(Token {
                    start,
                    end: i,
                    word: true,
                    depth,
                });
            }
            c if c.is_ascii_whitespace() => i += 1,
            _ => {
                i += sql[i..].chars().next().map_or(1, char::len_utf8);
                out.push(Token {
                    start,
                    end: i,
                    word: false,
                    depth,
                });
            }
        }
    }
    out
}

fn is_word(sql: &str, token: Option<&Token>, word: &str) -> bool {
    token.is_some_and(|t| t.word && sql[t.start..t.end].eq_ignore_ascii_case(word))
}

fn first_word(sql: &str) -> String {
    tokens(sql)
        .iter()
        .find(|t| t.word)
        .map(|t| sql[t.start..t.end].to_ascii_uppercase())
        .unwrap_or_default()
}

fn output_format(sql: &str) -> Option<(usize, usize, String)> {
    let all = tokens(sql);
    if is_word(sql, all.iter().find(|t| t.word), "INSERT") {
        return None;
    }
    let at = all
        .iter()
        .rposition(|t| t.depth == 0 && is_word(sql, Some(t), "FORMAT"))?;
    let after_operand = at.checked_sub(1).map(|i| &all[i]).is_some_and(|t| {
        ["BY", "AS", "SELECT", "DISTINCT"]
            .iter()
            .any(|w| is_word(sql, Some(t), w))
            || matches!(&sql[t.start..t.end], "," | "." | "(")
    });
    let name = all.get(at + 1).filter(|t| {
        t.word
            && t.depth == 0
            && !["ASC", "DESC", "FINAL", "NULLS", "WITH", "COLLATE"]
                .iter()
                .any(|w| is_word(sql, Some(t), w))
    })?;
    if after_operand {
        return None;
    }
    let rest = &all[at + 2..];
    let tail_ok = match rest.first() {
        None => true,
        Some(t) if is_word(sql, Some(t), "SETTINGS") => true,
        Some(_) => rest.iter().all(|t| &sql[t.start..t.end] == ";"),
    };
    tail_ok.then(|| {
        (
            all[at].start,
            name.end,
            sql[name.start..name.end].to_string(),
        )
    })
}

fn is_mutation(sql: &str) -> bool {
    let all = tokens(sql);
    let mut iter = all.iter().peekable();
    if !is_word(sql, iter.next(), "ALTER") || !is_word(sql, iter.next(), "TABLE") {
        return false;
    }
    iter.next();
    if iter.peek().is_some_and(|t| &sql[t.start..t.end] == ".") {
        iter.next();
        iter.next();
    }
    if is_word(sql, iter.peek().copied(), "ON") {
        iter.next();
        iter.next();
        iter.next();
    }
    let next = iter.next();
    is_word(sql, next, "UPDATE") || is_word(sql, next, "DELETE")
}

fn select_body(definition: &str) -> &str {
    let all = tokens(definition);
    if !matches!(
        first_word(definition).as_str(),
        "CREATE" | "ATTACH" | "REPLACE"
    ) {
        return definition.trim().trim_end_matches(';').trim_end();
    }
    all.iter()
        .enumerate()
        .find(|(i, t)| {
            t.depth == 0
                && is_word(definition, Some(t), "AS")
                && all.get(i + 1).is_some_and(|next| {
                    is_word(definition, Some(next), "SELECT")
                        || is_word(definition, Some(next), "WITH")
                        || &definition[next.start..next.end] == "("
                })
        })
        .map(|(i, _)| {
            definition[all[i + 1].start..]
                .trim()
                .trim_end_matches(';')
                .trim_end()
        })
        .unwrap_or_else(|| definition.trim().trim_end_matches(';').trim_end())
}

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
            .rows("SELECT name FROM system.databases WHERE name != 'INFORMATION_SCHEMA' ORDER BY name")
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
        let engines = match table_type {
            Some(t) if t.eq_ignore_ascii_case("view") => {
                " AND t.engine IN ('View', 'MaterializedView', 'LiveView')"
            }
            None if table.is_some() => "",
            _ => " AND t.engine NOT IN ('View', 'MaterializedView', 'LiveView') AND t.name NOT LIKE '.inner%'",
        };
        let mut sql = format!("SELECT c.database, c.table, c.name, c.type FROM system.columns c JOIN system.tables t ON t.database = c.database AND t.name = c.table WHERE c.database = {}{engines}", lit(db));
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
        let detailed = self.list_table_columns_detailed(schema, table).await?;
        let columns: Vec<String> = detailed.iter().map(|c| c.name.clone()).collect();
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
            detailed
                .iter()
                .map(|c| {
                    if c.data_type.starts_with("AggregateFunction(") {
                        format!("finalizeAggregation({0}) AS {0}", quote(&c.name))
                    } else {
                        quote(&c.name)
                    }
                })
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
        let (mut columns, mut rows, written) = self.query(sql).await?;
        let rows_affected = if columns.is_empty() && first_word(sql) == "INSERT" {
            written
        } else {
            None
        };
        if columns.is_empty() && is_mutation(sql) {
            columns = vec!["status".to_string()];
            rows = vec![vec![MUTATION_STARTED.into()]];
        }
        Ok(QueryResult {
            rows: rows_to_objects(&columns, rows),
            rows_affected,
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
        let select = select_body(body);
        if dry_run {
            return self.exec(&format!("EXPLAIN SYNTAX {select}")).await;
        }
        let engine = self
            .rows(&format!(
                "SELECT engine FROM system.tables WHERE database = {} AND name = {}",
                lit(schema),
                lit(view)
            ))
            .await?
            .first()
            .map(|r| text(&r[0]))
            .unwrap_or_default();
        let target = format!("{}.{}", quote(schema), quote(view));
        self.exec(&match engine.as_str() {
            "MaterializedView" => format!("ALTER TABLE {target} MODIFY QUERY {select}"),
            "View" | "" => format!("CREATE OR REPLACE VIEW {target} AS {select}"),
            other => return Err(format!("{view} ist keine View (Engine {other}).")),
        })
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
                is_nullable: text(&r[1]).starts_with("Nullable(")
                    || text(&r[1]).starts_with("LowCardinality(Nullable("),
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
        let mut sql = format!(
            "ALTER TABLE {}.{} ADD COLUMN {} {}",
            quote(schema),
            quote(table),
            quote(&column.name),
            nullable_type(&column.data_type, column.is_nullable)
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
        let column = quote(&changes.old_name);
        let requested = changes.data_type.as_deref().filter(|t| !t.is_empty());
        let data_type = match (requested, changes.set_not_null) {
            (Some(t), Some(not_null)) => Some(nullable_type(t, !not_null)),
            (Some(t), None) => Some(t.to_string()),
            (None, Some(not_null)) => {
                let current = self
                    .rows(&format!(
                        "SELECT type FROM system.columns WHERE database = {} AND table = {} AND name = {}",
                        lit(schema),
                        lit(table),
                        lit(&changes.old_name)
                    ))
                    .await?
                    .first()
                    .map(|r| text(&r[0]))
                    .ok_or_else(|| format!("Unbekannte Spalte: {}", changes.old_name))?;
                Some(nullable_type(&current, !not_null))
            }
            (None, None) => None,
        };
        let mut statements = Vec::new();
        if let Some(data_type) = data_type {
            statements.push(format!(
                "ALTER TABLE {target} MODIFY COLUMN {column} {data_type}"
            ));
        }
        if changes.drop_default {
            statements.push(format!(
                "ALTER TABLE {target} MODIFY COLUMN {column} REMOVE DEFAULT"
            ));
        } else if let Some(d) = changes.new_default.as_deref().filter(|d| !d.is_empty()) {
            statements.push(format!(
                "ALTER TABLE {target} MODIFY COLUMN {column} DEFAULT {d}"
            ));
        }
        if let Some(new_name) = changes
            .new_name
            .as_deref()
            .filter(|n| !n.is_empty() && *n != changes.old_name)
        {
            statements.push(format!(
                "ALTER TABLE {target} RENAME COLUMN {column} TO {}",
                quote(new_name)
            ));
        }
        let total = statements.len();
        for (applied, sql) in statements.iter().enumerate() {
            self.exec(sql)
                .await
                .map_err(|e| super::partially_applied(e, applied, total))?;
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
        let trimmed = sql.trim().trim_end_matches(';').trim_end();
        let run = match output_format(trimmed) {
            Some((start, end, _)) => {
                format!("{}{} FORMAT Null", &trimmed[..start], &trimmed[end..])
            }
            None => format!("{trimmed} FORMAT Null"),
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
            .rows("SELECT database, countIf(name NOT LIKE '.inner%' AND engine NOT IN ('View', 'MaterializedView', 'LiveView')), sum(total_bytes) FROM system.tables WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') AND NOT is_temporary GROUP BY database ORDER BY database")
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

fn nullable_type(data_type: &str, nullable: bool) -> String {
    let data_type = data_type.trim();
    let inner = data_type
        .strip_prefix("Nullable(")
        .and_then(|t| t.strip_suffix(')'))
        .unwrap_or(data_type);
    if let Some(low) = inner
        .strip_prefix("LowCardinality(")
        .and_then(|t| t.strip_suffix(')'))
    {
        let low = low
            .strip_prefix("Nullable(")
            .and_then(|t| t.strip_suffix(')'))
            .unwrap_or(low);
        return if nullable {
            format!("LowCardinality(Nullable({low}))")
        } else {
            format!("LowCardinality({low})")
        };
    }
    if !nullable || !nullable_allowed(inner) {
        return inner.to_string();
    }
    format!("Nullable({inner})")
}

fn nullable_allowed(data_type: &str) -> bool {
    !["Array(", "Map(", "Tuple(", "Nested(", "Variant(", "Dynamic"]
        .iter()
        .any(|prefix| data_type.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nullable_wrapping_respects_composite_types() {
        assert_eq!(nullable_type("String", true), "Nullable(String)");
        assert_eq!(nullable_type("Nullable(String)", false), "String");
        assert_eq!(nullable_type("Array(String)", true), "Array(String)");
        assert_eq!(
            nullable_type("Map(String, String)", true),
            "Map(String, String)"
        );
        assert_eq!(
            nullable_type("LowCardinality(String)", true),
            "LowCardinality(Nullable(String))"
        );
        assert_eq!(
            nullable_type("LowCardinality(Nullable(String))", false),
            "LowCardinality(String)"
        );
    }

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
                "12.50",
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

    #[test]
    fn strips_user_output_formats_but_keeps_insert_data() {
        let strip = |sql: &str| {
            output_format(sql).map(|(s, e, name)| (format!("{}{}", &sql[..s], &sql[e..]), name))
        };
        for format in ["JSON", "JSONEachRow", "CSV", "TSV", "Pretty", "Vertical"] {
            let sql = format!("SELECT 7 AS x, 'a' AS y FORMAT {format}");
            assert_eq!(
                strip(&sql),
                Some(("SELECT 7 AS x, 'a' AS y ".to_string(), format.to_string()))
            );
        }
        assert_eq!(
            strip("select 1 format csv settings max_threads = 1;").map(|r| r.0),
            Some("select 1  settings max_threads = 1;".to_string())
        );
        assert_eq!(
            strip("SELECT 1 SETTINGS max_threads = 1 FORMAT JSON;").map(|r| r.0),
            Some("SELECT 1 SETTINGS max_threads = 1 ;".to_string())
        );
        assert_eq!(strip("INSERT INTO t FORMAT CSV"), None);
        assert_eq!(strip("SELECT 'x FORMAT JSON'"), None);
        assert_eq!(strip("SELECT 1 -- FORMAT JSON"), None);
        assert_eq!(
            strip("SELECT * FROM format(JSONEachRow, '{\"a\":1}')"),
            None
        );
        assert_eq!(strip("SELECT format FROM t"), None);
        assert_eq!(strip("SELECT * FROM logs ORDER BY format DESC"), None);
        assert_eq!(strip("SELECT * FROM logs ORDER BY a, format ASC"), None);
        assert_eq!(strip("SELECT * FROM logs AS format FINAL"), None);
        assert_eq!(strip("SELECT * FROM logs ORDER BY l.format DESC"), None);
        assert_eq!(
            strip("SELECT 1 FORMAT Null"),
            Some(("SELECT 1 ".to_string(), "Null".to_string()))
        );
        assert_eq!(strip("SELECT (SELECT 1 FORMAT JSON)"), None);
        assert_eq!(
            strip("SELECT 1 FORMAT Null").map(|r| r.1),
            Some("Null".to_string())
        );
    }

    #[test]
    fn recognizes_mutations_and_view_bodies() {
        assert!(is_mutation("ALTER TABLE big DELETE WHERE id < 10"));
        assert!(is_mutation(
            "alter table db.`big` on cluster c update a = 1 where 1"
        ));
        assert!(!is_mutation("ALTER TABLE big ADD COLUMN x UInt8"));
        assert!(!is_mutation("DELETE FROM big WHERE 1"));
        assert_eq!(
            select_body(
                "CREATE VIEW db.v (`id` UInt32, `as` String) AS SELECT id, s AS `as` FROM t;"
            ),
            "SELECT id, s AS `as` FROM t"
        );
        assert_eq!(
            select_body("CREATE MATERIALIZED VIEW db.mv TO db.t (`k` UInt32) AS WITH 1 AS one SELECT k FROM s"),
            "WITH 1 AS one SELECT k FROM s"
        );
        assert_eq!(
            select_body(
                "CREATE MATERIALIZED VIEW db.mv ENGINE = MergeTree ORDER BY id AS SELECT id FROM t"
            ),
            "SELECT id FROM t"
        );
        assert_eq!(select_body(" SELECT 1; "), "SELECT 1");
    }

    #[test]
    fn rows_keep_server_types() {
        let body = concat!(
            "[\"id\", \"v\", \"js\", \"f\", \"d\", \"agg\", \"big\"]\n",
            "[\"UInt8\", \"Variant(String, UInt64)\", \"JSON\", \"Float64\", \"Nullable(Decimal(38, 6))\", \"AggregateFunction(count)\", \"Int256\"]\n",
            "[1, \"123\", {\"a\":1,\"big\":18446744073709551615}, \"nan\", \"42\", \"\\u0005\", -2000000000000000039798268413536]\n",
            "[2, 42, {}, -0.5, \"12.50\", null, 9007199254740991]\n",
        );
        let (columns, rows) = parse_body(body).unwrap();
        assert_eq!(columns, ["id", "v", "js", "f", "d", "agg", "big"]);
        assert_eq!(
            rows[0],
            serde_json::json!([1, "123", {"a": 1, "big": "18446744073709551615"}, "nan", 42, AGGREGATE_STATE, "-2000000000000000039798268413536"])
                .as_array()
                .unwrap()
                .clone()
        );
        assert_eq!(
            rows[1],
            serde_json::json!([2, 42, {}, -0.5, "12.50", null, 9007199254740991_i64])
                .as_array()
                .unwrap()
                .clone()
        );
        assert_eq!(
            quote_unsafe_integers("[\"9007199254740993\", 9007199254740993, 1e300, -12]"),
            "[\"9007199254740993\", \"9007199254740993\", 1e300, -12]"
        );
    }

    #[test]
    fn broken_streams_and_invalid_bytes_are_not_silent() {
        let body = "[\"n\"]\n[\"UInt8\"]\n[0]\n__exception__\nCode: 395. DB::Exception: boom: while executing 'x'. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 25.8.33.6 (official build))\n";
        assert_eq!(parse_body(body).unwrap_err(), "boom: while executing 'x'.");
        let text = lossless_text(b"[\"Hallo \\u0000\xFF\"]".to_vec());
        assert_eq!(text, "[\"Hallo \\u0000\\\\xFF\"]");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&text).unwrap()[0],
            "Hallo \u{0}\\xFF"
        );
    }

    #[test]
    fn server_errors_are_short_and_german() {
        assert_eq!(
            explain_exception("Code: 62. DB::Exception: Syntax error: failed at position 1 (SELEC): SELEC 1. Expected one of: Query, Query with output, EXPLAIN, SELECT, WITH, FROM, SHOW, DESCRIBE, CREATE, ALTER. (SYNTAX_ERROR) (version 25.8.33.6 (official build))"),
            "Syntaxfehler an Position 1 bei „SELEC“.\nErwartet: Query, Query with output, EXPLAIN, SELECT, WITH, FROM, SHOW, DESCRIBE, …"
        );
        assert_eq!(
            explain_exception("Code: 81. DB::Exception: Database gibtsnicht does not exist. (UNKNOWN_DATABASE) (version 25.8.33.6 (official build))"),
            "Datenbank „gibtsnicht“ existiert nicht."
        );
        assert_eq!(
            explain_exception("Code: 516. DB::Exception: l8db: Authentication failed: password is incorrect, or there is no user with such name. (AUTHENTICATION_FAILED) (version 25.8.33.6 (official build))"),
            "Anmeldung fehlgeschlagen: Benutzer oder Passwort falsch."
        );
        let adapter = ClickhouseAdapter::new("clickhouse://localhost:9000/db", None).unwrap();
        assert!(adapter
            .server_error(400, "{\"exception\": \"Code: 60. DB::Exception: Unknown table expression identifier 'nope_tbl' in scope SELECT * FROM nope_tbl. (UNKNOWN_TABLE) (version 25.8.33.6 (official build))\"}")
            .starts_with("Tabelle nicht gefunden: Unknown table expression identifier 'nope_tbl'"));
        assert!(adapter
            .server_error(400, "Port 9000 is for clickhouse-client program.\r\nYou must use port 8123 for HTTP.\r\n")
            .starts_with("Port 9000 ist der native ClickHouse-Port"));
    }

    async fn streaming_server(rows: usize) -> (String, Seen) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Seen::default();
        let log = seen.clone();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let log = log.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 65536];
                    let n = socket.read(&mut buf).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]).to_string();
                    let kill = request.contains("KILL QUERY");
                    log.lock()
                        .unwrap()
                        .push(if kill { "KILL".into() } else { "QUERY".into() });
                    let _ = socket
                        .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
                        .await;
                    let mut chunk = String::from("[\"n\"]\n[\"UInt64\"]\n");
                    let total = if kill { 0 } else { rows };
                    for i in 0..total {
                        chunk.push_str(&format!("[{i}]\n"));
                        if chunk.len() > 4096 || i + 1 == total {
                            let frame = format!("{:x}\r\n{chunk}\r\n", chunk.len());
                            if socket.write_all(frame.as_bytes()).await.is_err() {
                                log.lock().unwrap().push(format!("closed after {i}"));
                                return;
                            }
                            chunk.clear();
                        }
                    }
                    let _ = socket.write_all(b"0\r\n\r\n").await;
                    log.lock().unwrap().push("finished".into());
                });
            }
        });
        (format!("http://{addr}/"), seen)
    }

    #[tokio::test]
    async fn row_limit_stops_reading_and_kills_the_query() {
        let (url, seen) = streaming_server(2_000_000).await;
        let adapter = ClickhouseAdapter::new(&url, None).unwrap();
        let started = std::time::Instant::now();
        let result = super::super::execution::with_row_limit(
            1001,
            adapter.execute_query("SELECT number AS n FROM numbers(2000000)"),
        )
        .await
        .unwrap();
        assert_eq!(result.rows.len(), 1001);
        assert_eq!(result.rows[1000]["n"], 1000);
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        let log = seen.lock().unwrap().clone();
        assert_eq!(log.iter().filter(|l| *l == "QUERY").count(), 1);
        assert_eq!(log.iter().filter(|l| *l == "KILL").count(), 1);
        let (url, seen) = streaming_server(3).await;
        let adapter = ClickhouseAdapter::new(&url, None).unwrap();
        let all = adapter.execute_query("SELECT 1").await.unwrap();
        assert_eq!(all.rows.len(), 3);
        assert!(!seen.lock().unwrap().iter().any(|l| l == "KILL"));
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
