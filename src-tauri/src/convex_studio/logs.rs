use super::{convex_error, deployment};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tokio::sync::Notify;

const MAX_ENTRIES: usize = 1000;
const MAX_LINES: usize = 200;
const MAX_MESSAGE: usize = 4000;
const MAX_ERROR: usize = 16000;
const MAX_BODY: usize = 32 * 1024 * 1024;

static STREAMS: LazyLock<Mutex<HashMap<String, Arc<Notify>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConvexLogLine {
    pub level: String,
    pub message: String,
    pub timestamp_ms: Option<f64>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexLogEntry {
    pub kind: String,
    pub execution_id: String,
    pub request_id: String,
    pub identifier: String,
    pub udf_type: String,
    pub component_path: Option<String>,
    pub timestamp_ms: f64,
    pub cached: bool,
    pub caller: Option<String>,
    pub parent_execution_id: Option<String>,
    pub execution_time_ms: Option<f64>,
    pub user_execution_time_ms: Option<f64>,
    pub success: Option<bool>,
    pub error: Option<String>,
    pub lines: Vec<ConvexLogLine>,
    pub lines_dropped: usize,
    pub usage: Option<Value>,
    pub return_bytes: Option<f64>,
    pub environment: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexLogBatch {
    pub entries: Vec<ConvexLogEntry>,
    pub new_cursor: f64,
    pub timed_out: bool,
    pub dropped: usize,
}

fn truncate(text: &str, limit: usize) -> (String, bool) {
    match text.char_indices().nth(limit) {
        Some((index, _)) => (text[..index].to_string(), true),
        None => (text.to_string(), false),
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn parse_line(value: &Value) -> Option<ConvexLogLine> {
    let (level, raw, timestamp_ms, truncated) = match value {
        Value::String(line) => {
            let (level, rest) = line
                .strip_prefix('[')
                .and_then(|rest| rest.split_once("] "))
                .filter(|(level, _)| level.chars().all(|c| c.is_ascii_uppercase()))
                .unwrap_or(("LOG", line.as_str()));
            (level.to_string(), rest.to_string(), None, false)
        }
        Value::Object(_) => {
            let messages = value
                .get("messages")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .map(|item| {
                            item.as_str()
                                .map(str::to_string)
                                .unwrap_or_else(|| item.to_string())
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            (
                text(value, "level").unwrap_or_else(|| "LOG".into()),
                messages,
                value.get("timestamp").and_then(Value::as_f64),
                value
                    .get("isTruncated")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )
        }
        _ => return None,
    };
    let (message, cut) = truncate(&raw, MAX_MESSAGE);
    Some(ConvexLogLine {
        level: level.to_ascii_uppercase(),
        message,
        timestamp_ms,
        truncated: truncated || cut,
    })
}

fn milliseconds(value: &Value, key: &str) -> Option<f64> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .map(|seconds| seconds * 1000.0)
}

pub(crate) fn parse_entry(value: &Value) -> Option<ConvexLogEntry> {
    let kind = match value.get("kind").and_then(Value::as_str)? {
        "Completion" => "completion",
        "Progress" => "progress",
        _ => return None,
    };
    let all_lines = value
        .get("logLines")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let skip = all_lines.len().saturating_sub(MAX_LINES);
    let lines = all_lines[skip..].iter().filter_map(parse_line).collect();
    let error = text(value, "error").map(|error| truncate(&error, MAX_ERROR).0);
    let completion = kind == "completion";
    Some(ConvexLogEntry {
        kind: kind.into(),
        execution_id: text(value, "executionId").unwrap_or_default(),
        request_id: text(value, "requestId").unwrap_or_default(),
        identifier: text(value, "identifier").unwrap_or_default(),
        udf_type: text(value, "udfType").unwrap_or_default(),
        component_path: text(value, "componentPath"),
        timestamp_ms: milliseconds(value, "timestamp").unwrap_or(0.0),
        cached: value
            .get("cachedResult")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        caller: text(value, "caller"),
        parent_execution_id: text(value, "parentExecutionId"),
        execution_time_ms: milliseconds(value, "executionTime"),
        user_execution_time_ms: milliseconds(value, "userExecutionTime"),
        success: completion.then_some(error.is_none()),
        error,
        lines,
        lines_dropped: skip,
        usage: value
            .get("usageStats")
            .filter(|usage| usage.is_object())
            .cloned(),
        return_bytes: value.get("returnBytes").and_then(Value::as_f64),
        environment: text(value, "environment"),
    })
}

pub(crate) fn parse_batch(body: &Value, cursor: f64) -> ConvexLogBatch {
    let raw = body
        .get("entries")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let dropped = raw.len().saturating_sub(MAX_ENTRIES);
    ConvexLogBatch {
        entries: raw[dropped..].iter().filter_map(parse_entry).collect(),
        new_cursor: body
            .get("newCursor")
            .and_then(Value::as_f64)
            .filter(|next| next.is_finite() && *next >= cursor)
            .unwrap_or(cursor),
        timed_out: false,
        dropped,
    }
}

fn validate_stream_id(stream_id: &str) -> Result<(), String> {
    if stream_id.is_empty()
        || stream_id.len() > 64
        || !stream_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Ungültige Log-Stream-ID.".into());
    }
    Ok(())
}

const MAX_CANCELLED: usize = 256;

fn register(stream_id: &str) -> Arc<Notify> {
    let mut streams = STREAMS.lock().unwrap();
    if let Some(previous) = streams.remove(stream_id) {
        if Arc::strong_count(&previous) == 1 {
            streams.insert(stream_id.to_string(), previous.clone());
            return previous;
        }
        previous.notify_one();
    }
    let notify = Arc::new(Notify::new());
    streams.insert(stream_id.to_string(), notify.clone());
    notify
}

fn unregister(stream_id: &str, notify: &Arc<Notify>) {
    let mut streams = STREAMS.lock().unwrap();
    if streams
        .get(stream_id)
        .is_some_and(|current| Arc::ptr_eq(current, notify))
    {
        streams.remove(stream_id);
    }
}

fn empty(cursor: f64) -> ConvexLogBatch {
    ConvexLogBatch {
        entries: Vec::new(),
        new_cursor: cursor,
        timed_out: true,
        dropped: 0,
    }
}

async fn read_logs(
    access: &super::ConvexDeploymentAccess,
    cursor: f64,
    wait_ms: u64,
) -> Result<ConvexLogBatch, String> {
    let path = format!("api/stream_function_logs?cursor={cursor}");
    let response = match access
        .request(reqwest::Method::GET, &path)?
        .timeout(Duration::from_millis(wait_ms))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) if error.is_timeout() => return Ok(empty(cursor)),
        Err(_) => return Err("Convex-Deployment ist nicht erreichbar.".into()),
    };
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_BODY)
    {
        return Err("Convex-Logantwort ist zu groß.".into());
    }
    let body = match response.bytes().await {
        Ok(body) => body,
        Err(error) if error.is_timeout() => return Ok(empty(cursor)),
        Err(_) => return Err("Convex hat keine Antwort geliefert.".into()),
    };
    if body.len() > MAX_BODY {
        return Err("Convex-Logantwort ist zu groß.".into());
    }
    if !status.is_success() {
        return Err(convex_error(
            status.as_u16(),
            &String::from_utf8_lossy(&body),
        ));
    }
    let value: Value = serde_json::from_slice(&body)
        .map_err(|_| "Convex hat unerwartete Daten geliefert.".to_string())?;
    Ok(parse_batch(&value, cursor))
}

#[tauri::command]
pub async fn convex_studio_logs_fetch(
    id: String,
    project_id: u64,
    deployment_name: String,
    stream_id: String,
    cursor: f64,
    wait_ms: Option<u64>,
) -> Result<ConvexLogBatch, String> {
    validate_stream_id(&stream_id)?;
    if !cursor.is_finite() || cursor < 0.0 {
        return Err("Ungültiger Log-Cursor.".into());
    }
    let wait_ms = wait_ms.unwrap_or(5_000).clamp(500, 30_000);
    let notify = register(&stream_id);
    let result = tokio::select! {
        result = async {
            let access = deployment(&id, project_id, &deployment_name).await?;
            read_logs(&access, cursor, wait_ms).await
        } => result,
        _ = notify.notified() => Ok(empty(cursor)),
    };
    unregister(&stream_id, &notify);
    result
}

#[tauri::command]
pub async fn convex_studio_logs_cancel(stream_id: String) -> Result<(), String> {
    validate_stream_id(&stream_id)?;
    let mut streams = STREAMS.lock().unwrap();
    if let Some(notify) = streams.remove(&stream_id) {
        notify.notify_one();
        return Ok(());
    }
    if streams.len() >= MAX_CANCELLED {
        streams.retain(|_, notify| Arc::strong_count(notify) > 1);
    }
    let cancelled = Arc::new(Notify::new());
    cancelled.notify_one();
    streams.insert(stream_id, cancelled);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_progress_and_completion_entries() {
        let progress = parse_entry(&json!({
            "kind": "Progress", "udfType": "Action", "identifier": "actions:logSomething",
            "timestamp": 1.5, "logLines": ["[WARN] 'warn'", "plain"],
            "requestId": "r1", "executionId": "e1"
        }))
        .unwrap();
        assert_eq!(progress.kind, "progress");
        assert_eq!(progress.timestamp_ms, 1500.0);
        assert_eq!(progress.success, None);
        assert_eq!(progress.lines[0].level, "WARN");
        assert_eq!(progress.lines[0].message, "'warn'");
        assert_eq!(progress.lines[1].level, "LOG");

        let completion = parse_entry(&json!({
            "kind": "Completion", "udfType": "Action", "identifier": "actions:fail",
            "timestamp": 2.0, "executionTime": 0.25, "cachedResult": true,
            "error": "Uncaught Error: x", "requestId": "r1", "executionId": "e1",
            "logLines": [{"messages": ["'a'", "1"], "level": "ERROR", "timestamp": 9.0, "isTruncated": true}],
            "usageStats": {"databaseReadBytes": 1}
        }))
        .unwrap();
        assert_eq!(completion.success, Some(false));
        assert!(completion.cached);
        assert_eq!(completion.execution_time_ms, Some(250.0));
        assert_eq!(
            completion.lines[0],
            ConvexLogLine {
                level: "ERROR".into(),
                message: "'a' 1".into(),
                timestamp_ms: Some(9.0),
                truncated: true
            }
        );
        assert!(parse_entry(&json!({"kind": "Other"})).is_none());
    }

    #[test]
    fn batches_are_bounded_and_cursor_monotonic() {
        let entries: Vec<Value> = (0..MAX_ENTRIES + 5)
            .map(|index| json!({"kind": "Completion", "timestamp": index as f64, "logLines": []}))
            .collect();
        let batch = parse_batch(&json!({"entries": entries, "newCursor": 5.0}), 10.0);
        assert_eq!(batch.entries.len(), MAX_ENTRIES);
        assert_eq!(batch.dropped, 5);
        assert_eq!(batch.entries[0].timestamp_ms, 5000.0);
        assert_eq!(batch.new_cursor, 10.0);
        let lines: Vec<Value> = (0..MAX_LINES + 3)
            .map(|i| json!(format!("[LOG] {i}")))
            .collect();
        let entry = parse_entry(&json!({"kind": "Progress", "logLines": lines})).unwrap();
        assert_eq!(entry.lines.len(), MAX_LINES);
        assert_eq!(entry.lines_dropped, 3);
        let (long, cut) = truncate(&"ä".repeat(MAX_MESSAGE + 1), MAX_MESSAGE);
        assert!(cut);
        assert_eq!(long.chars().count(), MAX_MESSAGE);
    }

    #[tokio::test]
    async fn cancel_before_register_stops_the_late_fetch() {
        convex_studio_logs_cancel("early-cancel".into())
            .await
            .unwrap();
        let notify = register("early-cancel");
        tokio::time::timeout(Duration::from_millis(100), notify.notified())
            .await
            .unwrap();
        unregister("early-cancel", &notify);
        assert!(!STREAMS.lock().unwrap().contains_key("early-cancel"));
        let running = register("running");
        convex_studio_logs_cancel("running".into()).await.unwrap();
        tokio::time::timeout(Duration::from_millis(100), running.notified())
            .await
            .unwrap();
        unregister("running", &running);
        assert!(!STREAMS.lock().unwrap().contains_key("running"));
    }

    #[test]
    fn stream_ids_are_validated() {
        assert!(validate_stream_id("logs-1_a").is_ok());
        assert!(validate_stream_id("").is_err());
        assert!(validate_stream_id("a/b").is_err());
        assert!(validate_stream_id(&"a".repeat(65)).is_err());
    }

    #[tokio::test]
    #[ignore]
    async fn convex_studio_logs_live() {
        use crate::baas_self_hosted_live_tests::{env, isolate_secrets, latency};
        let (Some(url), Some(key)) = (env("L8DB_E2E_CONVEX_URL"), env("L8DB_E2E_CONVEX_KEY"))
        else {
            return;
        };
        let _secrets = isolate_secrets();
        let profile = crate::convex::convex_connect_self_hosted(url, key)
            .await
            .unwrap();
        let id = profile.id.clone();

        assert!(
            convex_studio_logs_fetch(id.clone(), 0, String::new(), "x/y".into(), 0.0, None)
                .await
                .is_err()
        );
        assert!(
            convex_studio_logs_fetch(id.clone(), 0, String::new(), "live".into(), -1.0, None)
                .await
                .is_err()
        );

        let access = deployment(&id, 0, "").await.unwrap();
        access
            .run_function(
                "action",
                "actions:logSomething",
                json!({"note": "l8db-logs"}),
            )
            .await
            .unwrap();

        let initial =
            convex_studio_logs_fetch(id.clone(), 0, String::new(), "live".into(), 0.0, Some(5000))
                .await
                .unwrap();
        assert!(!initial.timed_out);
        assert!(initial.entries.len() <= MAX_ENTRIES);
        assert!(initial
            .entries
            .iter()
            .any(|entry| entry.identifier == "actions:logSomething"
                && entry.lines.iter().any(|line| line.level == "WARN")));
        assert!(initial
            .entries
            .iter()
            .all(|entry| entry.kind != "completion" || entry.success.is_some()));

        latency("convex logs initial read", 500, || {
            let id = id.clone();
            async move {
                convex_studio_logs_fetch(id, 0, String::new(), "latency".into(), 0.0, Some(5000))
                    .await
                    .unwrap();
            }
        })
        .await;

        let cursor = initial.new_cursor;
        let waiter = tokio::spawn(convex_studio_logs_fetch(
            id.clone(),
            0,
            String::new(),
            "live".into(),
            cursor,
            Some(20_000),
        ));
        tokio::time::sleep(Duration::from_millis(300)).await;
        let _ = access
            .run_function("action", "actions:fail", json!({}))
            .await;
        let started = std::time::Instant::now();
        let mut woken = waiter.await.unwrap().unwrap();
        println!(
            "convex logs long-poll wake: {} ms",
            started.elapsed().as_millis()
        );
        assert!(woken.new_cursor >= cursor);
        let failed = |batch: &ConvexLogBatch| {
            batch.entries.iter().any(|entry| {
                entry.identifier == "actions:fail"
                    && entry.success == Some(false)
                    && entry
                        .error
                        .as_deref()
                        .is_some_and(|e| e.contains("intentional failure"))
            })
        };
        let mut seen = failed(&woken);
        while !seen && started.elapsed() < Duration::from_secs(10) {
            let previous = woken.new_cursor;
            woken = convex_studio_logs_fetch(
                id.clone(),
                0,
                String::new(),
                "live".into(),
                previous,
                Some(5000),
            )
            .await
            .unwrap();
            assert!(woken.new_cursor >= previous);
            seen = failed(&woken);
        }
        assert!(seen);

        let cursor = woken.new_cursor;
        let pending = tokio::spawn(convex_studio_logs_fetch(
            id.clone(),
            0,
            String::new(),
            "cancel".into(),
            cursor,
            Some(30_000),
        ));
        tokio::time::sleep(Duration::from_millis(300)).await;
        let started = std::time::Instant::now();
        convex_studio_logs_cancel("cancel".into()).await.unwrap();
        let cancelled = pending.await.unwrap().unwrap();
        assert!(cancelled.timed_out);
        assert_eq!(cancelled.new_cursor, cursor);
        assert!(started.elapsed() < Duration::from_secs(2));

        let started = std::time::Instant::now();
        let first = tokio::spawn(convex_studio_logs_fetch(
            id.clone(),
            0,
            String::new(),
            "single".into(),
            cursor,
            Some(30_000),
        ));
        tokio::time::sleep(Duration::from_millis(300)).await;
        let second = convex_studio_logs_fetch(
            id.clone(),
            0,
            String::new(),
            "single".into(),
            cursor,
            Some(1000),
        )
        .await
        .unwrap();
        let first = first.await.unwrap().unwrap();
        assert!(first.timed_out);
        assert!(second.timed_out || !second.entries.is_empty());
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(STREAMS.lock().unwrap().is_empty());

        crate::convex::convex_disconnect(id).await.unwrap();
    }
}
