use super::{
    byok, context, integrations,
    runtime::{AiState, Run},
    types::RunRequest,
};
use crate::mcp::{config::McpConfig, server::Server};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

async fn provider_request(listener: &TcpListener) -> (tokio::net::TcpStream, Value) {
    let (stream, _) = listener.accept().await.unwrap();
    let mut reader = BufReader::new(stream);
    let mut first = String::new();
    reader.read_line(&mut first).await.unwrap();
    assert_eq!(first.trim(), "POST /v1/chat/completions HTTP/1.1");
    let mut length = None;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        if line == "\r\n" {
            break;
        }
        assert!(!line.is_empty());
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = Some(value.trim().parse::<usize>().unwrap());
            }
            assert!(!name.eq_ignore_ascii_case("authorization"));
        }
    }
    let mut bytes = vec![0; length.unwrap()];
    reader.read_exact(&mut bytes).await.unwrap();
    (reader.into_inner(), serde_json::from_slice(&bytes).unwrap())
}

async fn provider_stream(mut stream: tokio::net::TcpStream, frames: Vec<Value>) {
    let mut body = frames
        .into_iter()
        .map(|frame| format!("data: {frame}\r\n\r\n"))
        .collect::<String>();
    body.push_str("data: [DONE]\r\n\r\n");
    let header = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    stream.write_all(header.as_bytes()).await.unwrap();
    for bytes in body.as_bytes().chunks(17) {
        stream.write_all(bytes).await.unwrap();
        tokio::task::yield_now().await;
    }
    stream.shutdown().await.unwrap();
}

fn captured_run(allowed: bool) -> (Run, Arc<Mutex<Vec<Value>>>) {
    let state = Arc::new(AiState::default());
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let approval_state = state.clone();
    let channel = Channel::new(move |body| {
        let InvokeResponseBody::Json(body) = body else {
            panic!("expected JSON event")
        };
        let event: Value = serde_json::from_str(&body).unwrap();
        if event["kind"] == "approval" {
            assert_eq!(
                event["data"]["details"]["sql"],
                "UPDATE inventory SET quantity=9 WHERE id=1"
            );
            let key = format!(
                "byok-e2e-window:byok-e2e-run:{}",
                event["data"]["id"].as_str().unwrap()
            );
            approval_state
                .approvals
                .lock()
                .unwrap()
                .remove(&key)
                .unwrap()
                .send(json!(allowed))
                .unwrap();
        }
        captured.lock().unwrap().push(event);
        Ok(())
    });
    (
        Run {
            scope: Default::default(),
            id: "byok-e2e-run".into(),
            owner: "byok-e2e-window".into(),
            plan_only: false,
            approval: String::new(),
            state,
            channel,
        },
        events,
    )
}

async fn sqlite_http_scenario(allowed: bool) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("inventory.sqlite");
    let database = rusqlite::Connection::open(&path).unwrap();
    database.execute_batch("CREATE TABLE inventory(id INTEGER PRIMARY KEY, label TEXT, quantity INTEGER); INSERT INTO inventory VALUES(1,'apples',3),(2,'pears',5);").unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let endpoint = format!(
        "http://127.0.0.1:{}/v1",
        listener.local_addr().unwrap().port()
    );
    let request: RunRequest = serde_json::from_value(json!({
        "runId":"byok-e2e-run", "profile":{"id":format!("byok-e2e-{}", super::new_id()),"provider":"compatible","endpoint":endpoint,"model":"deterministic-local-sse"},
        "cwd":directory.path(), "messages":[{"role":"user","text":"Prüfe inventory und setze die erste Menge nach Freigabe auf 9."}],
        "connections":[{"id":"inventory","name":"inventory","kind":"sqlite","connectionString":path,"database":null,"environment":null}],
        "activeId":"inventory", "allowWrites":true,"allowDdl":false
    })).unwrap();
    let config = context::scoped_config(&request, McpConfig::default()).unwrap();
    let server = Arc::new(tokio::sync::Mutex::new(Server {
        pool: crate::db::pool::create_pool_state(),
        columns: HashMap::new(),
    }));
    let (run, events) = captured_run(allowed);
    let external = integrations::connect(&[], directory.path(), &run)
        .await
        .unwrap();
    let expected_reply = if allowed {
        "Bestand nach Freigabe geändert."
    } else {
        "Änderung abgelehnt; Bestand bleibt unverändert."
    };
    let provider = tokio::spawn(async move {
        let (stream, body) = provider_request(&listener).await;
        assert_eq!(body["model"], "deterministic-local-sse");
        assert_eq!(body["stream"], true);
        let tools = body["tools"].as_array().unwrap();
        assert!(tools.iter().any(|tool| tool["function"]["name"] == "query"));
        assert!(tools
            .iter()
            .any(|tool| tool["function"]["name"] == "execute"));
        let calls = [
            (
                "search",
                json!({"connection":"inventory","term":"inventory"}),
            ),
            (
                "describe",
                json!({"connection":"inventory","table":"inventory"}),
            ),
            (
                "query",
                json!({"connection":"inventory","sql":"SELECT label, quantity FROM inventory ORDER BY id"}),
            ),
            (
                "execute",
                json!({"connection":"inventory","sql":"UPDATE inventory SET quantity=9 WHERE id=1","confirm":true}),
            ),
        ];
        let mut frames = Vec::new();
        for (index, (name, args)) in calls.iter().enumerate() {
            let arguments = args.to_string();
            let split = arguments.len() / 2;
            frames.push(json!({"choices":[{"delta":{"tool_calls":[{"index":index,"id":format!("call_{index}"),"type":"function","function":{"name":name,"arguments":&arguments[..split]}}]},"finish_reason":null}]}));
            frames.push(json!({"choices":[{"delta":{"tool_calls":[{"index":index,"function":{"arguments":&arguments[split..]}}]},"finish_reason":null}]}));
        }
        frames.push(json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}));
        frames.push(json!({"choices":[],"usage":{"prompt_tokens":40,"completion_tokens":12,"total_tokens":52,"prompt_tokens_details":{"cached_tokens":8},"completion_tokens_details":{"reasoning_tokens":2}}}));
        provider_stream(stream, frames).await;
        let (stream, body) = provider_request(&listener).await;
        let messages = body["messages"].as_array().unwrap();
        let results = messages
            .iter()
            .filter(|message| message["role"] == "tool")
            .collect::<Vec<_>>();
        assert_eq!(results.len(), 4);
        for (index, result) in results.iter().enumerate() {
            assert_eq!(result["tool_call_id"], format!("call_{index}"));
            assert!(result.get("name").is_none());
            let content = result["content"].as_str().unwrap();
            assert_eq!(
                content.starts_with("[tool error]"),
                index == 3 && !allowed,
                "{content}"
            );
            if index == 2 {
                assert!(content.contains("apples"));
                assert!(content.contains("pears"));
            }
            if index == 3 && !allowed {
                assert!(content.contains("abgelehnt"));
            }
        }
        provider_stream(stream, vec![
            json!({"choices":[{"delta":{"content":expected_reply},"finish_reason":null}]}),
            json!({"choices":[{"delta":{},"finish_reason":"stop"}]}),
            json!({"choices":[],"usage":{"prompt_tokens":90,"completion_tokens":7,"total_tokens":97,"prompt_tokens_details":{"cached_tokens":32}}}),
        ]).await;
    });
    tokio::time::timeout(
        Duration::from_secs(30),
        byok::run(
            &request,
            &context::instructions(&request),
            &server,
            &config,
            external,
            &run,
        ),
    )
    .await
    .unwrap()
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), provider)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        database
            .query_row("SELECT quantity FROM inventory WHERE id=1", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        if allowed { 9 } else { 3 }
    );
    assert_eq!(
        database
            .query_row("SELECT quantity FROM inventory WHERE id=2", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        5
    );
    let captured = events.lock().unwrap();
    assert_eq!(
        captured
            .iter()
            .filter(|event| event["kind"] == "approval")
            .count(),
        1
    );
    assert!(captured
        .iter()
        .any(|event| event["kind"] == "approvalResolved" && event["data"]["allowed"] == allowed));
    let reply = captured
        .iter()
        .filter(|event| event["kind"] == "text")
        .map(|event| event["data"]["delta"].as_str().unwrap())
        .collect::<String>();
    assert_eq!(reply, expected_reply);
    let rounds = captured
        .iter()
        .filter(|event| event["kind"] == "usage")
        .map(|event| {
            (
                event["data"]["round"].as_u64().unwrap(),
                event["data"]["usage"].clone(),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    assert_eq!(rounds.len(), 2);
    assert_eq!(rounds[&1]["total_tokens"], 52);
    assert_eq!(rounds[&2]["total_tokens"], 97);
    assert_eq!(
        rounds
            .values()
            .map(|usage| usage["prompt_tokens"].as_u64().unwrap())
            .sum::<u64>(),
        130
    );
    assert_eq!(
        rounds
            .values()
            .map(|usage| usage["prompt_tokens_details"]["cached_tokens"]
                .as_u64()
                .unwrap())
            .sum::<u64>(),
        40
    );
    assert!(run.state.approvals.lock().unwrap().is_empty());
}

#[tokio::test]
async fn byok_http_sse_sqlite_approved_write_e2e() {
    sqlite_http_scenario(true).await;
}

#[tokio::test]
async fn byok_http_sse_sqlite_denied_write_e2e() {
    sqlite_http_scenario(false).await;
}
