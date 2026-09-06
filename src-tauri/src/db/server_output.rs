use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tokio_postgres::{AsyncMessage, Client, Config, SimpleQueryMessage};

use super::connection::tls_connector;
use super::{map_pg_err, QueryResult, ScriptStatementResult, SslMode};

const MAX_MESSAGES: usize = 2000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMessage {
    pub level: String,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Default)]
struct Registry {
    enabled: HashSet<String>,
    buffers: HashMap<String, Arc<Mutex<Vec<ServerMessage>>>>,
    sessions: HashMap<String, Arc<Client>>,
}

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}

fn buffer_for(key: &str) -> Arc<Mutex<Vec<ServerMessage>>> {
    let mut reg = registry().lock().expect("server output registry");
    reg.buffers.entry(key.to_string()).or_default().clone()
}

pub fn is_enabled(key: &str) -> bool {
    registry()
        .lock()
        .map(|reg| reg.enabled.contains(key))
        .unwrap_or(false)
}

pub fn set_enabled(key: &str, enabled: bool) {
    let mut reg = registry().lock().expect("server output registry");
    if enabled {
        reg.enabled.insert(key.to_string());
    } else {
        reg.enabled.remove(key);
        reg.sessions.remove(key);
        reg.buffers.remove(key);
    }
}

pub fn push(key: &str, message: ServerMessage) {
    let buffer = buffer_for(key);
    let mut entries = buffer.lock().expect("server output buffer");
    if entries.len() >= MAX_MESSAGES {
        entries.remove(0);
    }
    entries.push(message);
}

pub fn take(key: &str) -> Vec<ServerMessage> {
    let buffer = buffer_for(key);
    let mut entries = buffer.lock().expect("server output buffer");
    std::mem::take(&mut *entries)
}

pub async fn pg_session(
    key: &str,
    config: &Config,
    ssl: SslMode,
) -> Result<Option<Arc<Client>>, String> {
    if !is_enabled(key) {
        return Ok(None);
    }
    let existing = {
        let reg = registry().lock().expect("server output registry");
        reg.sessions.get(key).cloned()
    };
    if let Some(client) = existing {
        if !client.is_closed() {
            return Ok(Some(client));
        }
        let mut reg = registry().lock().expect("server output registry");
        reg.sessions.remove(key);
    }

    let (client, mut connection) = config
        .connect(tls_connector(ssl)?)
        .await
        .map_err(|e| format!("Verbindung für Server-Ausgabe fehlgeschlagen: {e}"))?;
    let buffer_key = key.to_string();
    tokio::spawn(async move {
        loop {
            let message = std::future::poll_fn(|cx| {
                std::pin::Pin::new(&mut connection).poll_message(cx)
            })
            .await;
            match message {
                Some(Ok(AsyncMessage::Notice(notice))) => push(
                    &buffer_key,
                    ServerMessage {
                        level: notice.severity().to_string(),
                        message: notice.message().to_string(),
                        detail: notice.detail().map(|d| d.to_string()),
                    },
                ),
                Some(Ok(_)) => {}
                Some(Err(_)) | None => break,
            }
        }
    });
    let client = Arc::new(client);
    let mut reg = registry().lock().expect("server output registry");
    reg.sessions.insert(key.to_string(), client.clone());
    Ok(Some(client))
}

pub async fn pg_run_query(
    client: &Client,
    sql: &str,
    read_only: bool,
) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    if read_only {
        client
            .simple_query("BEGIN TRANSACTION READ ONLY")
            .await
            .map_err(map_pg_err)?;
    }
    let outcome = async {
        let messages = client.simple_query(sql).await.map_err(map_pg_err)?;
        let elapsed = start.elapsed().as_millis() as u64;

        let mut columns: Vec<String> = Vec::new();
        let mut rows: Vec<serde_json::Value> = Vec::new();
        let mut rows_affected: Option<u64> = None;

        for msg in messages {
            match msg {
                SimpleQueryMessage::Row(row) => {
                    if columns.is_empty() {
                        columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                    }
                    let mut obj = serde_json::Map::new();
                    for (i, col) in columns.iter().enumerate() {
                        let val = row
                            .get(i)
                            .map(|v| serde_json::Value::String(v.to_string()))
                            .unwrap_or(serde_json::Value::Null);
                        obj.insert(col.clone(), val);
                    }
                    rows.push(serde_json::Value::Object(obj));
                }
                SimpleQueryMessage::CommandComplete(count) => {
                    rows_affected = Some(count);
                }
                _ => {}
            }
        }

        Ok(QueryResult {
            columns,
            rows,
            rows_affected,
            execution_time_ms: elapsed,
        })
    }
    .await;
    if read_only {
        let _ = client.simple_query("ROLLBACK").await;
    }
    outcome
}

pub async fn pg_run_script(
    client: &Client,
    sql: &str,
    read_only: bool,
) -> Result<Vec<ScriptStatementResult>, String> {
    let statements: Vec<&str> = sql
        .split(';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    if read_only {
        client
            .simple_query("BEGIN TRANSACTION READ ONLY")
            .await
            .map_err(map_pg_err)?;
    }
    let mut results = Vec::new();
    for stmt in statements {
        let full = format!("{};", stmt);
        match client.execute(stmt, &[]).await {
            Ok(n) => results.push(ScriptStatementResult {
                statement: full,
                success: true,
                rows_affected: Some(n),
                error: None,
            }),
            Err(e) => results.push(ScriptStatementResult {
                statement: full,
                success: false,
                rows_affected: None,
                error: Some(map_pg_err(e)),
            }),
        }
    }
    if read_only {
        let _ = client.simple_query("ROLLBACK").await;
    }
    Ok(results)
}
