use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::time::{Duration, Instant};

use super::config::{self, McpConfig, McpConnection};
use super::redact::{self, Redactor};
use crate::db::{self, execution::ExecutionOptions, pool::PoolState, ColumnInfo, DatabaseKind, QueryResult};

const PROTOCOL_VERSION: &str = "2025-06-18";
const CACHE_TTL: Duration = Duration::from_secs(60);
const SQL_KINDS: &[DatabaseKind] = &[
    DatabaseKind::Postgres,
    DatabaseKind::Mysql,
    DatabaseKind::Sqlite,
    DatabaseKind::Mssql,
    DatabaseKind::Clickhouse,
    DatabaseKind::Oracle,
    DatabaseKind::Cassandra,
    DatabaseKind::Duckdb,
    DatabaseKind::Odbc,
];

struct Server {
    pool: PoolState,
    columns: HashMap<String, (Instant, Vec<ColumnInfo>)>,
}

pub fn serve() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let mut server = Server {
        pool: db::pool::create_pool_state(),
        columns: HashMap::new(),
    };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Some(response) = runtime.block_on(server.handle_line(&line)) else {
            continue;
        };
        if writeln!(stdout, "{response}").and_then(|_| stdout.flush()).is_err() {
            break;
        }
    }
}

fn rpc_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message.into()}})
}

fn tool_text(text: String, is_error: bool) -> Value {
    json!({"content": [{"type": "text", "text": text}], "isError": is_error})
}

pub fn tool_definitions() -> Value {
    json!([
        {
            "name": "connections",
            "description": "List database connections exposed by l8db with kind and access mode.",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "search",
            "description": "Find tables and columns whose name contains term. Returns schema.table(column type, ...). Empty term lists table names only.",
            "inputSchema": {"type": "object", "properties": {
                "connection": {"type": "string", "description": "Connection name or id"},
                "term": {"type": "string"}
            }, "required": ["connection"]}
        },
        {
            "name": "describe",
            "description": "Columns of one table with types. table may be schema.table.",
            "inputSchema": {"type": "object", "properties": {
                "connection": {"type": "string"},
                "table": {"type": "string"}
            }, "required": ["connection", "table"]}
        },
        {
            "name": "query",
            "description": "Run a read-only SQL statement. Returns TSV, sensitive values redacted. Default limit 50 rows.",
            "inputSchema": {"type": "object", "properties": {
                "connection": {"type": "string"},
                "sql": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1}
            }, "required": ["connection", "sql"]}
        },
        {
            "name": "execute",
            "description": "Run a writing SQL statement on a connection that allows writes. Requires confirm=true. Returns affected rows.",
            "inputSchema": {"type": "object", "properties": {
                "connection": {"type": "string"},
                "sql": {"type": "string"},
                "confirm": {"type": "boolean"}
            }, "required": ["connection", "sql", "confirm"]}
        }
    ])
}

impl Server {
    async fn handle_line(&mut self, line: &str) -> Option<Value> {
        let request: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(e) => return Some(rpc_error(Value::Null, -32700, format!("Parse error: {e}"))),
        };
        let id = request.get("id").cloned();
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        let params = request.get("params").cloned().unwrap_or(Value::Null);
        let id = id?;
        let result = match method {
            "initialize" => Ok(json!({
                "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSION),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "l8db", "version": env!("CARGO_PKG_VERSION")},
                "instructions": "Call search before query to learn table and column names. Results are TSV; sensitive columns and values are redacted."
            })),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({"tools": tool_definitions()})),
            "tools/call" => Ok(self.call(&params).await),
            "resources/list" => Ok(json!({"resources": []})),
            "prompts/list" => Ok(json!({"prompts": []})),
            _ => Err(rpc_error(id.clone(), -32601, format!("Method not found: {method}"))),
        };
        Some(match result {
            Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
            Err(error) => error,
        })
    }

    async fn call(&mut self, params: &Value) -> Value {
        let name = params.get("name").and_then(Value::as_str).unwrap_or("");
        let args = params.get("arguments").cloned().unwrap_or(json!({}));
        let config = config::load();
        if !config.enabled {
            return tool_text("l8db MCP ist deaktiviert. In l8db unter MCP aktivieren.".into(), true);
        }
        let started = Instant::now();
        let outcome = match name {
            "connections" => Ok(list_connections(&config)),
            "search" | "describe" | "query" | "execute" => {
                let target = args.get("connection").and_then(Value::as_str).unwrap_or("");
                match find_connection(&config, target) {
                    Err(e) => Err(e),
                    Ok(connection) => {
                        let result = match name {
                            "search" => self.search(&config, connection, arg_str(&args, "term")).await,
                            "describe" => self.describe(&config, connection, arg_str(&args, "table")).await,
                            "query" => self.query(&config, connection, &args).await,
                            _ => self.execute(&config, connection, &args).await,
                        };
                        if matches!(name, "query" | "execute") {
                            audit(connection, name, arg_str(&args, "sql"), &result, started);
                        }
                        result
                    }
                }
            }
            _ => Err(format!("Unbekanntes Tool: {name}")),
        };
        match outcome {
            Ok(text) => tool_text(text, false),
            Err(error) => tool_text(scrub_error(&error), true),
        }
    }

    async fn columns_for(&mut self, config: &McpConfig, connection: &McpConnection) -> Result<Vec<ColumnInfo>, String> {
        if let Some((at, columns)) = self.columns.get(&connection.id) {
            if at.elapsed() < CACHE_TTL {
                return Ok(columns.clone());
            }
        }
        let adapter = adapter(connection, &self.pool)?;
        let columns = run(config, async { adapter.list_columns(None, None, None).await }).await?;
        let columns: Vec<ColumnInfo> = columns
            .into_iter()
            .filter(|column| connection.schemas.is_empty() || connection.schemas.contains(&column.schema))
            .collect();
        self.columns.insert(connection.id.clone(), (Instant::now(), columns.clone()));
        Ok(columns)
    }

    async fn search(&mut self, config: &McpConfig, connection: &McpConnection, term: &str) -> Result<String, String> {
        let columns = self.columns_for(config, connection).await?;
        let term = term.trim().to_lowercase();
        let mut tables: Vec<(String, Vec<&ColumnInfo>)> = Vec::new();
        for column in &columns {
            let key = qualified(&column.schema, &column.table);
            match tables.last_mut() {
                Some((last, list)) if *last == key => list.push(column),
                _ => tables.push((key, vec![column])),
            }
        }
        if term.is_empty() {
            let names: Vec<&str> = tables.iter().map(|(name, _)| name.as_str()).collect();
            return Ok(cap(format!("{} tables\n{}", names.len(), names.join("\n")), config.max_chars));
        }
        let matching: Vec<String> = tables
            .iter()
            .filter(|(name, list)| {
                name.to_lowercase().contains(&term)
                    || list.iter().any(|column| column.name.to_lowercase().contains(&term))
            })
            .map(|(name, list)| table_line(name, list))
            .collect();
        if matching.is_empty() {
            return Ok(format!("No tables or columns match '{term}'"));
        }
        Ok(cap(format!("{} matches\n{}", matching.len(), matching.join("\n")), config.max_chars))
    }

    async fn describe(&mut self, config: &McpConfig, connection: &McpConnection, table: &str) -> Result<String, String> {
        let table = table.trim();
        if table.is_empty() {
            return Err("table fehlt".into());
        }
        let columns = self.columns_for(config, connection).await?;
        let wanted = table.to_lowercase();
        let list: Vec<&ColumnInfo> = columns
            .iter()
            .filter(|column| {
                column.table.to_lowercase() == wanted
                    || qualified(&column.schema, &column.table).to_lowercase() == wanted
            })
            .collect();
        if list.is_empty() {
            return Err(format!("Tabelle '{table}' nicht gefunden. search nutzen."));
        }
        let name = qualified(&list[0].schema, &list[0].table);
        Ok(cap(table_line(&name, &list), config.max_chars))
    }

    async fn query(&mut self, config: &McpConfig, connection: &McpConnection, args: &Value) -> Result<String, String> {
        let sql = arg_str(args, "sql").trim();
        if sql.is_empty() {
            return Err("sql fehlt".into());
        }
        if redact::statement_count(sql) > 1 {
            return Err("Nur ein Statement pro Aufruf.".into());
        }
        if let Some(word) = redact::write_word(sql) {
            return Err(format!(
                "query ist read-only, '{word}' ist nicht erlaubt.{}",
                if connection.read_only { "" } else { " Für Schreibzugriffe execute nutzen." }
            ));
        }
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(config.max_rows)
            .clamp(1, db::commands::MAX_RESULT_ROWS);
        let adapter = adapter(connection, &self.pool)?;
        let result = run(config, async { adapter.execute_query(sql).await }).await?;
        let redactor = Redactor::new(&config.redaction, &connection.redact_columns);
        Ok(format_result(&result, config, &redactor, limit))
    }

    async fn execute(&mut self, config: &McpConfig, connection: &McpConnection, args: &Value) -> Result<String, String> {
        if connection.read_only {
            return Err(format!("Verbindung '{}' ist read-only.", connection.name));
        }
        if !args.get("confirm").and_then(Value::as_bool).unwrap_or(false) {
            return Err("execute braucht confirm=true.".into());
        }
        let sql = arg_str(args, "sql").trim();
        if sql.is_empty() {
            return Err("sql fehlt".into());
        }
        if redact::statement_count(sql) > 1 {
            return Err("Nur ein Statement pro Aufruf.".into());
        }
        if !connection.allow_ddl && redact::is_ddl(sql) {
            return Err(format!("DDL ist für '{}' nicht freigegeben.", connection.name));
        }
        let adapter = adapter(connection, &self.pool)?;
        let result = run(config, async { adapter.execute_query(sql).await }).await?;
        self.columns.remove(&connection.id);
        let redactor = Redactor::new(&config.redaction, &connection.redact_columns);
        let mut text = format!("ok, {} rows affected", result.rows_affected.unwrap_or(0));
        if !result.rows.is_empty() {
            text.push('\n');
            text.push_str(&format_result(&result, config, &redactor, config.max_rows));
        }
        Ok(text)
    }
}

fn arg_str<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or("")
}

fn qualified(schema: &str, table: &str) -> String {
    if schema.is_empty() {
        table.to_string()
    } else {
        format!("{schema}.{table}")
    }
}

fn table_line(name: &str, columns: &[&ColumnInfo]) -> String {
    let cols: Vec<String> = columns
        .iter()
        .map(|column| format!("{} {}", column.name, column.data_type))
        .collect();
    format!("{name}({})", cols.join(", "))
}

fn cap(text: String, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text;
    }
    let cut: String = text.chars().take(max_chars).collect();
    format!("{cut}\n[truncated at {max_chars} chars, narrow the request]")
}

pub fn exposed(config: &McpConfig) -> impl Iterator<Item = &McpConnection> {
    config
        .connections
        .iter()
        .filter(|connection| connection.exposed && !connection.ssh && SQL_KINDS.contains(&connection.kind))
}

fn list_connections(config: &McpConfig) -> String {
    let lines: Vec<String> = exposed(config)
        .map(|connection| {
            format!(
                "{}\t{}\t{}",
                connection.name,
                serde_json::to_value(connection.kind)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_string))
                    .unwrap_or_default(),
                if connection.read_only { "read-only" } else { "read-write" }
            )
        })
        .collect();
    if lines.is_empty() {
        return "No connections exposed. Enable them in l8db under MCP.".into();
    }
    format!("name\tkind\taccess\n{}", lines.join("\n"))
}

fn find_connection<'a>(config: &'a McpConfig, target: &str) -> Result<&'a McpConnection, String> {
    let wanted = target.trim().to_lowercase();
    if wanted.is_empty() {
        return Err("connection fehlt".into());
    }
    exposed(config)
        .find(|connection| connection.id == target || connection.name.to_lowercase() == wanted)
        .ok_or_else(|| format!("Verbindung '{target}' ist nicht freigegeben. connections aufrufen."))
}

fn keychain_password(id: &str) -> Result<Option<String>, String> {
    match keyring::Entry::new(config::KEYCHAIN_SERVICE, id)
        .map_err(|e| format!("Keychain: {e}"))?
        .get_password()
    {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keychain: {e}")),
    }
}

pub fn with_password(connection: &McpConnection, password: Option<&str>) -> String {
    let raw = &connection.connection_string;
    if !raw.contains("://") {
        return match password {
            Some(password) if raw.contains("***") => raw.replace("***", password),
            _ => raw.clone(),
        };
    }
    let Ok(mut url) = url::Url::parse(raw) else {
        return raw.clone();
    };
    if let Some(password) = password {
        let _ = url.set_password(Some(password));
    }
    if connection.read_only && connection.kind == DatabaseKind::Postgres {
        let mut params: Vec<String> = url
            .query()
            .unwrap_or_default()
            .split('&')
            .filter(|part| !part.is_empty() && !part.starts_with("options="))
            .map(str::to_string)
            .collect();
        params.push("options=-c%20default_transaction_read_only%3Don".into());
        url.set_query(Some(&params.join("&")));
    }
    url.to_string()
}

fn adapter(connection: &McpConnection, pool: &PoolState) -> Result<Box<dyn db::DatabaseAdapter>, String> {
    let password = keychain_password(&connection.id)?;
    let url = with_password(connection, password.as_deref());
    db::create_adapter_from_string(connection.kind, &url, None, pool.clone())
}

async fn run<T, F>(config: &McpConfig, future: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    db::execution::run_query(
        Some(ExecutionOptions {
            job_id: None,
            query_timeout: Some(config.query_timeout),
            connection_timeout: Some(10),
        }),
        false,
        future,
    )
    .await
}

fn cell_text(value: &Value, max_chars: usize) -> String {
    let text = match value {
        Value::Null => return "NULL".into(),
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    let flat = text.replace(['\t', '\n', '\r'], " ");
    if flat.chars().count() > max_chars {
        let cut: String = flat.chars().take(max_chars).collect();
        format!("{cut}…")
    } else {
        flat
    }
}

pub fn format_result(result: &QueryResult, config: &McpConfig, redactor: &Redactor, limit: usize) -> String {
    let mut lines = vec![result.columns.join("\t")];
    let mut redacted = 0usize;
    for row in result.rows.iter().take(limit) {
        let cells: Vec<String> = result
            .columns
            .iter()
            .enumerate()
            .map(|(index, column)| {
                let value = match row {
                    Value::Object(map) => map.get(column).cloned().unwrap_or(Value::Null),
                    Value::Array(list) => list.get(index).cloned().unwrap_or(Value::Null),
                    other => other.clone(),
                };
                let masked = redactor.redact_cell(column, &value);
                if masked != value {
                    redacted += 1;
                }
                cell_text(&masked, config.max_cell_chars)
            })
            .collect();
        lines.push(cells.join("\t"));
    }
    let shown = result.rows.len().min(limit);
    let mut footer = format!("({shown} rows");
    if result.rows.len() > limit {
        footer.push_str(&format!(", {} more not shown; raise limit or add WHERE", result.rows.len() - limit));
    } else if result.rows.len() >= db::commands::MAX_RESULT_ROWS {
        footer.push_str(", result capped by server; add WHERE");
    }
    if redacted > 0 {
        footer.push_str(&format!(", {redacted} cells redacted"));
    }
    footer.push(')');
    lines.push(footer);
    cap(lines.join("\n"), config.max_chars)
}

fn scrub_error(error: &str) -> String {
    let re = regex::Regex::new(r"[a-z][a-z0-9+.-]*://[^\s]+").unwrap();
    re.replace_all(error, "[connection-url]").into_owned()
}

fn audit(connection: &McpConnection, tool: &str, sql: &str, result: &Result<String, String>, started: Instant) {
    let entry = json!({
        "ts": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "connection": connection.name,
        "tool": tool,
        "sql": sql.chars().take(500).collect::<String>(),
        "ok": result.is_ok(),
        "ms": started.elapsed().as_millis() as u64,
        "error": result.as_ref().err().map(|e| scrub_error(e)),
    });
    let path = config::audit_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{entry}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection(read_only: bool) -> McpConnection {
        McpConnection {
            id: "c1".into(),
            name: "Prod".into(),
            kind: DatabaseKind::Postgres,
            connection_string: "postgres://alice@db.example.com:5432/app?sslmode=require".into(),
            schemas: vec![],
            ssh: false,
            exposed: true,
            read_only,
            allow_ddl: false,
            redact_columns: vec![],
        }
    }

    #[test]
    fn injects_password_and_read_only_option() {
        let url = with_password(&connection(true), Some("p@ss w"));
        assert_eq!(
            url,
            "postgres://alice:p%40ss%20w@db.example.com:5432/app?sslmode=require&options=-c%20default_transaction_read_only%3Don"
        );
        assert!(url.contains("default_transaction_read_only%3Don"));
        let rw = with_password(&connection(false), None);
        assert_eq!(rw, "postgres://alice@db.example.com:5432/app?sslmode=require");
        let mut sqlite = connection(true);
        sqlite.kind = DatabaseKind::Sqlite;
        sqlite.connection_string = "sqlite:/tmp/x.db".into();
        assert_eq!(with_password(&sqlite, Some("x")), "sqlite:/tmp/x.db");
    }

    #[test]
    fn formats_tsv_with_redaction_and_limits() {
        let config = McpConfig {
            max_cell_chars: 5,
            ..McpConfig::default()
        };
        let redactor = Redactor::new(&config.redaction, &[]);
        let result = QueryResult {
            columns: vec!["id".into(), "email".into(), "note".into()],
            rows: vec![
                json!({"id": 1, "email": "a@b.de", "note": "call +49 170 1234567 now"}),
                json!({"id": 2, "email": null, "note": "short"}),
                json!({"id": 3, "email": "c@d.de", "note": null}),
            ],
            rows_affected: None,
            execution_time_ms: 1,
        };
        let text = format_result(&result, &config, &redactor, 2);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], "id\temail\tnote");
        assert_eq!(lines[1], "1\t[reda…\tcall …");
        assert_eq!(lines[2], "2\tNULL\tshort");
        assert_eq!(lines[3], "(2 rows, 1 more not shown; raise limit or add WHERE, 2 cells redacted)");
    }

    #[test]
    fn exposure_rules() {
        let mut config = McpConfig::default();
        config.connections.push(connection(true));
        let mut hidden = connection(true);
        hidden.id = "c2".into();
        hidden.name = "Hidden".into();
        hidden.exposed = false;
        config.connections.push(hidden);
        let mut tunnel = connection(true);
        tunnel.id = "c3".into();
        tunnel.name = "Tunnel".into();
        tunnel.ssh = true;
        config.connections.push(tunnel);
        let mut mongo = connection(true);
        mongo.id = "c4".into();
        mongo.name = "Mongo".into();
        mongo.kind = DatabaseKind::Mongodb;
        config.connections.push(mongo);
        assert_eq!(exposed(&config).count(), 1);
        assert!(find_connection(&config, "prod").is_ok());
        assert!(find_connection(&config, "c1").is_ok());
        assert!(find_connection(&config, "Hidden").is_err());
        assert!(find_connection(&config, "Tunnel").is_err());
        assert!(list_connections(&config).contains("Prod\tpostgres\tread-only"));
    }

    #[test]
    fn rpc_protocol_shapes() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let mut server = Server { pool: db::pool::create_pool_state(), columns: HashMap::new() };
        let init = runtime
            .block_on(server.handle_line(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}"#))
            .unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(init["result"]["serverInfo"]["name"], "l8db");
        assert!(runtime
            .block_on(server.handle_line(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#))
            .is_none());
        let tools = runtime
            .block_on(server.handle_line(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#))
            .unwrap();
        assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 5);
        let unknown = runtime
            .block_on(server.handle_line(r#"{"jsonrpc":"2.0","id":3,"method":"nope"}"#))
            .unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
        let broken = runtime.block_on(server.handle_line("{nope")).unwrap();
        assert_eq!(broken["error"]["code"], -32700);
    }

    #[test]
    fn disabled_server_rejects_calls() {
        let dir = std::env::temp_dir().join(format!("l8db-mcp-test-{}", std::process::id()));
        std::env::set_var("L8DB_MCP_CONFIG", dir.join("mcp.json"));
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let mut server = Server { pool: db::pool::create_pool_state(), columns: HashMap::new() };
        let reply = runtime
            .block_on(server.handle_line(r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"connections","arguments":{}}}"#))
            .unwrap();
        assert_eq!(reply["result"]["isError"], true);
        assert!(reply["result"]["content"][0]["text"].as_str().unwrap().contains("deaktiviert"));
        let mut config = McpConfig::default();
        config.enabled = true;
        config::save(&config).unwrap();
        let reply = runtime
            .block_on(server.handle_line(r#"{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"query","arguments":{"connection":"x","sql":"select 1"}}}"#))
            .unwrap();
        assert_eq!(reply["result"]["isError"], true);
        assert!(reply["result"]["content"][0]["text"].as_str().unwrap().contains("nicht freigegeben"));
        let _ = std::fs::remove_dir_all(dir);
        std::env::remove_var("L8DB_MCP_CONFIG");
    }
}
