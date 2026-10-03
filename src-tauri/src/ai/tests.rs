use super::{
    byok, context, integrations,
    runtime::{AiState, Run},
    types::{ConnectionContext, Profile, RunRequest},
};
use crate::db::DatabaseKind;
use crate::mcp::{
    config::{McpConfig, McpConnection, RedactRule},
    server::Server,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

fn profile(provider: &str) -> Profile {
    serde_json::from_value(
        json!({"id":"fixture-profile","provider":provider,"model":"fixture-model"}),
    )
    .unwrap()
}

fn selected(id: &str) -> ConnectionContext {
    serde_json::from_value(json!({"id":id,"name":id,"kind":"sqlite","connectionString":"file:fixture.sqlite","database":null,"environment":null})).unwrap()
}

fn request() -> RunRequest {
    RunRequest {
        run_id: "fixture-run".into(),
        profile: profile("compatible"),
        cwd: ".".into(),
        session_id: None,
        messages: vec![],
        connections: vec![selected("active"), selected("mentioned")],
        active_id: Some("active".into()),
        skills: vec![],
        servers: vec![],
        allow_writes: true,
        allow_ddl: true,
    }
}

fn policy(id: &str) -> McpConnection {
    serde_json::from_value(json!({"id":id,"name":id,"kind":"sqlite","connectionString":"file:fixture.sqlite","readOnly":false,"allowDdl":true})).unwrap()
}

fn run(allow: Option<bool>) -> (Run, Arc<Mutex<Vec<Value>>>) {
    let state = Arc::new(AiState::default());
    let events = Arc::new(Mutex::new(vec![]));
    let captured = events.clone();
    let approval_state = state.clone();
    let channel = Channel::new(move |body| {
        let InvokeResponseBody::Json(body) = body else {
            panic!("expected JSON event")
        };
        let event: Value = serde_json::from_str(&body).unwrap();
        if event["kind"] == "approval" {
            if let Some(allow) = allow {
                let key = format!(
                    "fixture-window:fixture-run:{}",
                    event["data"]["id"].as_str().unwrap()
                );
                let sender = approval_state
                    .approvals
                    .lock()
                    .unwrap()
                    .remove(&key)
                    .unwrap();
                sender.send(json!(allow)).unwrap();
            }
        }
        captured.lock().unwrap().push(event);
        Ok(())
    });
    (
        Run {
            id: "fixture-run".into(),
            owner: "fixture-window".into(),
            plan_only: false,
            approval: String::new(),
            state,
            channel,
        },
        events,
    )
}

async fn read_fixture_request(socket: &mut tokio::net::TcpStream) {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
    let mut reader = BufReader::new(socket);
    let mut length = 0;
    loop {
        let mut line = String::new();
        assert!(reader.read_line(&mut line).await.unwrap() > 0);
        if line == "\r\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse::<usize>().unwrap();
            }
        }
    }
    assert!(length <= 65_536);
    reader.read_exact(&mut vec![0; length]).await.unwrap();
}

#[test]
fn scope_is_private_and_only_exposes_active_and_mentions() {
    let mut config = McpConfig::default();
    config.connections = vec![policy("active"), policy("unselected")];
    let before = config.clone();
    let scoped = context::scoped_config(&request(), config.clone()).unwrap();
    assert_eq!(config, before);
    assert!(!config.enabled);
    assert!(scoped.enabled);
    assert_eq!(
        scoped
            .connections
            .iter()
            .map(|connection| connection.id.as_str())
            .collect::<Vec<_>>(),
        ["active", "mentioned"]
    );
    assert!(scoped
        .connections
        .iter()
        .all(|connection| connection.exposed));
    assert!(!scoped
        .connections
        .iter()
        .any(|connection| connection.id == "unselected"));
}

#[test]
fn scope_intersects_all_connection_policies() {
    let mut request = request();
    request.connections[0].schemas = vec!["main".into(), "private".into()];
    request.connections[0].mask_rules = vec![RedactRule {
        name: "selected".into(),
        pattern: "phone".into(),
        enabled: true,
        mask: None,
    }];
    let mut existing = policy("active");
    existing.schemas = vec!["main".into()];
    existing.read_only = true;
    existing.allow_ddl = false;
    existing.environment = Some("production".into());
    existing.allow_production_writes = true;
    existing.redact_columns = vec!["salary".into()];
    existing.mask_rules = vec![RedactRule {
        name: "existing".into(),
        pattern: "email".into(),
        enabled: true,
        mask: None,
    }];
    let config = McpConfig {
        max_rows: 3,
        max_cell_chars: 17,
        max_chars: 123,
        connections: vec![existing],
        ..McpConfig::default()
    };
    let scoped = context::scoped_config(&request, config).unwrap();
    let connection = &scoped.connections[0];
    assert_eq!(connection.schemas, ["main"]);
    assert!(connection.read_only);
    assert!(!connection.allow_ddl);
    assert!(connection.is_production());
    assert!(connection.writes_blocked());
    assert!(!connection.allow_production_writes);
    assert_eq!(connection.redact_columns, ["salary"]);
    assert_eq!(connection.mask_rules.len(), 2);
    assert_eq!(
        (scoped.max_rows, scoped.max_cell_chars, scoped.max_chars),
        (3, 17, 123)
    );
    request.allow_writes = false;
    assert!(context::scoped_config(&request, McpConfig::default())
        .unwrap()
        .connections
        .iter()
        .all(|connection| connection.read_only));
}

#[test]
fn mongodb_browser_filters_do_not_restrict_private_mcp_scope() {
    let mut request = request();
    request.connections[0].kind = DatabaseKind::Mongodb;
    request.connections[0].schemas = vec!["inventory".into()];
    request.connections[0].database = Some("inventory".into());
    let mut existing = policy("active");
    existing.kind = DatabaseKind::Mongodb;
    existing.schemas = vec!["shop".into()];
    existing.read_only = true;
    let scoped = context::scoped_config(
        &request,
        McpConfig {
            connections: vec![existing],
            ..McpConfig::default()
        },
    )
    .unwrap();
    assert!(scoped.connections[0].schemas.is_empty());
    assert_eq!(scoped.connections[0].database.as_deref(), Some("inventory"));
    assert!(scoped.connections[0].read_only);
}

#[test]
fn scope_rejects_duplicates_missing_active_and_disjoint_schemas() {
    let mut request = request();
    request.connections.push(selected("active"));
    assert!(context::scoped_config(&request, McpConfig::default()).is_err());
    request.connections.pop();
    request.active_id = Some("absent".into());
    assert!(context::scoped_config(&request, McpConfig::default()).is_err());
    request.active_id = Some("active".into());
    request.connections[0].schemas = vec!["private".into()];
    let mut existing = policy("active");
    existing.schemas = vec!["main".into()];
    assert!(context::scoped_config(
        &request,
        McpConfig {
            connections: vec![existing],
            ..McpConfig::default()
        }
    )
    .is_err());
}

#[test]
fn native_plan_keeps_private_database_tools_read_only_even_when_writes_are_selected() {
    for mode in ["plan", "https://agent.example/modes#plan"] {
        let mut request = request();
        request.profile.mode = mode.into();
        let scoped = context::scoped_config(&request, McpConfig::default()).unwrap();
        assert!(scoped
            .connections
            .iter()
            .all(|connection| connection.read_only && !connection.allow_ddl));
    }
}

#[tokio::test]
async fn dashboard_mutations_require_approval_and_leave_read_only_database_access_unchanged() {
    struct RestoreConfig(Option<std::ffi::OsString>);
    impl Drop for RestoreConfig {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("L8DB_MCP_CONFIG", value),
                None => std::env::remove_var("L8DB_MCP_CONFIG"),
            }
        }
    }
    let _guard = crate::mcp::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let directory = tempfile::tempdir().unwrap();
    let _restore = RestoreConfig(std::env::var_os("L8DB_MCP_CONFIG"));
    std::env::set_var("L8DB_MCP_CONFIG", directory.path().join("mcp.json"));
    let server = tokio::sync::Mutex::new(Server {
        pool: crate::db::pool::create_pool_state(),
        columns: HashMap::new(),
    });
    let mut connection = policy("active");
    connection.exposed = true;
    connection.read_only = true;
    let config = McpConfig {
        enabled: true,
        connections: vec![connection],
        ..McpConfig::default()
    };
    let (denied, denied_events) = run(Some(false));
    for action in [
        "create",
        "update",
        "delete",
        "add_charts",
        "update_chart",
        "remove_chart",
    ] {
        let result = context::call(&server, &config, &denied, "dashboard", json!({"action": action, "connection": "active", "name": "AI fixture", "dashboard": "AI fixture", "charts": []})).await;
        assert_eq!(result["isError"], true);
        assert!(result["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("abgelehnt"));
    }
    assert_eq!(
        denied_events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event["kind"] == "approval")
            .count(),
        6
    );
    assert!(!directory.path().join("mcp-dashboards").exists());
    let (approved, approved_events) = run(Some(true));
    let result = context::call(
        &server,
        &config,
        &approved,
        "dashboard",
        json!({"action": "create", "connection": "active", "name": "AI fixture", "charts": []}),
    )
    .await;
    assert_eq!(result["isError"], false, "{result}");
    let files = std::fs::read_dir(directory.path().join("mcp-dashboards"))
        .unwrap()
        .flatten()
        .collect::<Vec<_>>();
    assert_eq!(files.len(), 1);
    let value: Value = serde_json::from_slice(&std::fs::read(files[0].path()).unwrap()).unwrap();
    assert_eq!(value["connectionId"], "active");
    let before = approved_events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| event["kind"] == "approval")
        .count();
    let result = context::call(
        &server,
        &config,
        &approved,
        "dashboard",
        json!({"action": "list", "connection": "active"}),
    )
    .await;
    assert_eq!(result["isError"], false);
    assert_eq!(
        approved_events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event["kind"] == "approval")
            .count(),
        before
    );
    let result = context::call(
        &server,
        &config,
        &denied,
        "dashboard",
        json!({"action": "delete", "dashboard": value["id"]}),
    )
    .await;
    assert_eq!(result["isError"], true);
    assert!(files[0].path().exists());
    let (mut plan, plan_events) = run(Some(true));
    plan.plan_only = true;
    let result = context::call(
        &server,
        &config,
        &plan,
        "dashboard",
        json!({"action": "delete", "dashboard": value["id"]}),
    )
    .await;
    assert_eq!(result["isError"], true);
    assert!(result["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("Plan-Modus"));
    assert!(plan_events.lock().unwrap().is_empty());
    assert!(files[0].path().exists());
}

#[test]
fn database_urls_never_enter_model_instructions() {
    let mut request = request();
    request.connections[0].kind = DatabaseKind::Postgres;
    request.connections[0].connection_string =
        "postgres://fixture-user:fixture-secret@example.invalid/private-db?sslmode=require".into();
    let instructions = context::instructions(&request);
    for forbidden in [
        "fixture-user",
        "fixture-secret",
        "example.invalid",
        "postgres://",
        "sslmode",
    ] {
        assert!(!instructions.contains(forbidden));
    }
    assert!(instructions.contains("\"primary\":true"));
    assert!(instructions.contains("mentioned"));
}

#[test]
fn endpoint_requires_tls_or_literal_loopback_and_no_embedded_auth() {
    for endpoint in [
        "https://api.example.invalid/v1",
        "http://127.0.0.1:1234/v1",
        "http://localhost:1234",
        "http://[::1]:1234",
    ] {
        assert!(integrations::endpoint(endpoint).is_ok(), "{endpoint}");
    }
    for endpoint in [
        "http://example.invalid",
        "http://localhost.example.invalid",
        "http://192.168.1.5",
        "file:///tmp/api",
        "https://user:password@example.invalid",
        "https://example.invalid?key=fixture",
        "https://example.invalid#fixture",
    ] {
        assert!(integrations::endpoint(endpoint).is_err(), "{endpoint}");
    }
}

#[test]
fn split_openai_and_anthropic_calls_preserve_arguments() {
    let mut openai = byok::StreamResult::default();
    openai.feed("openai", &json!({"choices":[{"delta":{"content":"Hello ","tool_calls":[{"index":0,"id":"call-1","function":{"name":"query","arguments":"{\"connection\":\"active\","}}]}}]})).unwrap();
    openai.feed("openai", &json!({"choices":[{"delta":{"content":"world","tool_calls":[{"index":0,"function":{"arguments":"\"sql\":\"select 1\"}"}}]}}]})).unwrap();
    assert_eq!(openai.text, "Hello world");
    assert_eq!(openai.calls[&0].id, "call-1");
    assert_eq!(
        serde_json::from_str::<Value>(&openai.calls[&0].arguments).unwrap()["sql"],
        "select 1"
    );
    let mut anthropic = byok::StreamResult::default();
    anthropic.feed("anthropic", &json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-1","name":"describe","input":{}}})).unwrap();
    for partial in ["{\"table\":", "\"users\"}"] {
        anthropic.feed("anthropic", &json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":partial}})).unwrap();
    }
    assert_eq!(anthropic.calls[&1].name, "describe");
    assert_eq!(
        serde_json::from_str::<Value>(&anthropic.calls[&1].arguments).unwrap(),
        json!({"table":"users"})
    );
}

#[test]
fn gemini_hides_thought_text_and_preserves_tool_signature() {
    let mut result = byok::StreamResult::default();
    result.feed("google", &json!({"candidates":[{"content":{"parts":[{"thought":true,"text":"private reasoning"},{"text":"Visible"},{"functionCall":{"id":"g-1","name":"query","args":{"sql":"select 1"}},"thoughtSignature":"fixture-signature"}]}}]})).unwrap();
    assert_eq!(result.text, "Visible");
    assert_eq!(result.calls[&0].signature, Some(json!("fixture-signature")));
    assert_eq!(result.calls[&0].id, "g-1");
}

#[test]
fn tool_history_converts_to_each_provider_protocol() {
    let messages = vec![
        json!({"role":"user","content":"Inspect users"}),
        json!({"role":"assistant","content":"","tool_calls":[{"id":"call-1","function":{"name":"describe","arguments":"{\"table\":\"users\"}"},"signature":"fixture-signature"}]}),
        json!({"role":"tool","tool_call_id":"call-1","name":"describe","content":"id INTEGER"}),
    ];
    let tools = vec![
        json!({"name":"describe","description":"Describe table","inputSchema":{"type":"object"}}),
    ];
    for provider in ["openai", "anthropic", "google"] {
        let (_, payload) =
            byok::payload(&profile(provider), "instructions", &messages, &tools).unwrap();
        match provider {
            "anthropic" => {
                assert_eq!(payload["system"], "instructions");
                assert_eq!(payload["messages"][1]["content"][0]["type"], "tool_use");
                assert_eq!(
                    payload["messages"][2]["content"][0]["tool_use_id"],
                    "call-1"
                );
                assert_eq!(payload["tools"][0]["input_schema"]["type"], "object");
            }
            "google" => {
                assert_eq!(
                    payload["tools"][0]["functionDeclarations"][0]["parametersJsonSchema"],
                    tools[0]["inputSchema"]
                );
                assert!(payload["tools"][0]["functionDeclarations"][0]
                    .get("parameters")
                    .is_none());
                assert_eq!(payload["contents"][1]["role"], "model");
                assert_eq!(
                    payload["contents"][1]["parts"][0]["thoughtSignature"],
                    "fixture-signature"
                );
                assert_eq!(
                    payload["contents"][2]["parts"][0]["functionResponse"]["name"],
                    "describe"
                );
            }
            _ => {
                assert_eq!(payload["messages"][0]["role"], "system");
                assert_eq!(payload["messages"][3]["tool_call_id"], "call-1");
                assert_eq!(payload["tools"][0]["type"], "function");
            }
        }
    }
}

#[test]
fn sse_frames_handle_arbitrary_bytes_crlf_and_done() {
    let (run, events) = run(None);
    let mut buffer = vec![];
    let mut result = byok::StreamResult::default();
    let bytes = "event: message\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"Grüße\"}}]}\r\n\r\ndata: [DONE]\n\n".as_bytes();
    for byte in bytes {
        buffer.push(*byte);
        while let Some(frame) = byok::frame(&mut buffer) {
            byok::consume(&frame, "openai", &mut result, &run).unwrap();
        }
    }
    assert!(buffer.is_empty());
    assert_eq!(result.text, "Grüße");
    assert_eq!(events.lock().unwrap().len(), 1);
    assert!(byok::consume(b"data: malformed\n\n", "openai", &mut result, &run).is_err());
    assert!(result
        .feed("openai", &json!({"error":{"message":"fixture"}}))
        .is_err());
    let first = b"data: {\"choices\":[{\"delta\":{\"content\":\"A\"}}]}\r\n\r\n";
    let second = b"data: {\"choices\":[{\"delta\":{\"content\":\"B\"}}]}\n\n";
    let mut mixed = [first.as_slice(), second.as_slice()].concat();
    let mut mixed_result = byok::StreamResult::default();
    let frame = byok::frame(&mut mixed).unwrap();
    assert_eq!(frame, first);
    byok::consume(&frame, "openai", &mut mixed_result, &run).unwrap();
    let frame = byok::frame(&mut mixed).unwrap();
    assert_eq!(frame, second);
    byok::consume(&frame, "openai", &mut mixed_result, &run).unwrap();
    assert!(mixed.is_empty());
    assert_eq!(mixed_result.text, "AB");
}

#[test]
fn streamed_provider_citations_are_forwarded_without_enabling_search_tools() {
    for (provider, value, url) in [
        (
            "anthropic",
            json!({"type":"content_block_delta","index":0,"delta":{"type":"citations_delta","citation":{"type":"web_search_result_location","url":"https://example.com/anthropic","title":"Native source"}}}),
            "https://example.com/anthropic",
        ),
        (
            "google",
            json!({"candidates":[{"groundingMetadata":{"groundingChunks":[{"web":{"uri":"https://example.com/google","title":"Native source"}}]}}]}),
            "https://example.com/google",
        ),
        (
            "compatible",
            json!({"choices":[{"delta":{"annotations":[{"type":"url_citation","url_citation":{"url":"https://example.com/compatible","title":"Native source"}}]}}]}),
            "https://example.com/compatible",
        ),
    ] {
        let (run, events) = run(None);
        let mut result = byok::StreamResult::default();
        byok::consume(
            format!("data: {value}\n\n").as_bytes(),
            provider,
            &mut result,
            &run,
        )
        .unwrap();
        let captured = events.lock().unwrap();
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0]["kind"], "metadata");
        assert_eq!(captured[0]["data"]["citations"][0]["url"], url);
        assert!(result.text.is_empty());
        let mut fixture = profile(provider);
        if provider == "compatible" {
            fixture.endpoint = "http://127.0.0.1:1/v1".into();
        }
        let (_, payload) = byok::payload(&fixture, "instructions", &[], &[]).unwrap();
        assert!(!payload.to_string().contains("google_search"));
        assert!(!payload.to_string().contains("web_search"));
    }
}

#[tokio::test]
async fn sqlite_tools_query_real_data_and_require_user_write_approval() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("fixture.sqlite");
    let database = rusqlite::Connection::open(&path).unwrap();
    database.execute_batch("CREATE TABLE users(id INTEGER PRIMARY KEY, label TEXT, password TEXT); INSERT INTO users VALUES(1,'alpha','fixture-password'),(2,'beta','fixture-password');").unwrap();
    let mut request = request();
    request.connections.truncate(1);
    request.connections[0].connection_string = path.to_string_lossy().into_owned();
    let config = context::scoped_config(
        &request,
        McpConfig {
            max_rows: 1,
            ..McpConfig::default()
        },
    )
    .unwrap();
    let server = tokio::sync::Mutex::new(Server {
        pool: crate::db::pool::create_pool_state(),
        columns: HashMap::new(),
    });
    let (denied, events) = run(Some(false));
    for (name, args) in [
        ("search", json!({"connection":"active","term":"users"})),
        ("describe", json!({"connection":"active","table":"users"})),
        (
            "query",
            json!({"connection":"active","sql":"select id, label from users order by id"}),
        ),
    ] {
        let result = context::call(&server, &config, &denied, name, args).await;
        assert_eq!(result["isError"], false, "{name}: {result}");
        assert!(!result.to_string().contains("fixture-password"));
        if name == "query" {
            assert!(result.to_string().contains("alpha"));
            assert!(!result.to_string().contains("beta"));
        }
    }
    let result = context::call(
        &server,
        &config,
        &denied,
        "query",
        json!({"connection":"active","sql":"SELECT password FROM users"}),
    )
    .await;
    assert!(!result.to_string().contains("fixture-password"));
    let result = context::call(
        &server,
        &config,
        &denied,
        "search",
        json!({"connection":"unselected","term":""}),
    )
    .await;
    assert_eq!(result["isError"], true);
    let result = context::call(&server, &config, &denied, "execute", json!({"connection":"active","sql":"UPDATE users SET label='changed' WHERE id=1","confirm":true})).await;
    assert_eq!(result["isError"], true);
    assert!(events
        .lock()
        .unwrap()
        .iter()
        .any(|event| event["kind"] == "approval"));
    assert_eq!(
        database
            .query_row("SELECT label FROM users WHERE id=1", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "alpha"
    );
    let (approved, _) = run(Some(true));
    let result = context::call(&server, &config, &approved, "execute", json!({"connection":"active","sql":"UPDATE users SET label='changed' WHERE id=1","confirm":false})).await;
    assert_eq!(result["isError"], false, "{result}");
    assert_eq!(
        database
            .query_row("SELECT label FROM users WHERE id=1", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "changed"
    );
    let result = context::call(
        &server,
        &config,
        &approved,
        "query",
        json!({"connection":"active","sql":"DELETE FROM users"}),
    )
    .await;
    assert_eq!(result["isError"], true);
    let mut blocked = config.clone();
    blocked.connections[0].read_only = true;
    let before = events.lock().unwrap().len();
    let result = context::call(
        &server,
        &blocked,
        &denied,
        "execute",
        json!({"connection":"active","sql":"DELETE FROM users","confirm":true}),
    )
    .await;
    assert_eq!(result["isError"], true);
    assert_eq!(events.lock().unwrap().len(), before);
    blocked.connections[0].read_only = false;
    blocked.connections[0].environment = Some("production".into());
    assert_eq!(
        context::call(
            &server,
            &blocked,
            &denied,
            "execute",
            json!({"connection":"active","sql":"DELETE FROM users","confirm":true})
        )
        .await["isError"],
        true
    );
}

#[test]
fn dropping_run_cleans_only_its_owner_and_pending_approvals() {
    let (run, _) = run(None);
    let (sender, _) = tokio::sync::watch::channel(false);
    run.state
        .runs
        .lock()
        .unwrap()
        .insert("fixture-window:fixture-run".into(), sender.clone());
    run.state
        .runs
        .lock()
        .unwrap()
        .insert("other-window:fixture-run".into(), sender);
    let (sender, _) = tokio::sync::oneshot::channel();
    run.state
        .approvals
        .lock()
        .unwrap()
        .insert("fixture-window:fixture-run:approval".into(), sender);
    let (sender, _) = tokio::sync::oneshot::channel();
    run.state
        .approvals
        .lock()
        .unwrap()
        .insert("other-window:fixture-run:approval".into(), sender);
    let state = run.state.clone();
    drop(run);
    assert_eq!(state.runs.lock().unwrap().len(), 1);
    assert_eq!(state.approvals.lock().unwrap().len(), 1);
    assert!(state
        .runs
        .lock()
        .unwrap()
        .contains_key("other-window:fixture-run"));
}

#[tokio::test]
async fn external_stdio_mcp_initializes_and_requires_every_call_approval() {
    let directory = tempfile::tempdir().unwrap();
    let server = super::types::ExternalServer {
        id: "fixture-mcp".into(),
        name: "Fixture".into(),
        transport: "stdio".into(),
        command: "python3".into(),
        args: vec![
            "-u".into(),
            "-c".into(),
            include_str!("test_mcp_fixture.py").into(),
        ],
        url: String::new(),
    };
    let (denied, denied_events) = run(Some(false));
    let mut external = integrations::connect(&[server], directory.path(), &denied)
        .await
        .unwrap();
    assert_eq!(external.tools[0]["name"], "ext_0_fixture_echo");
    let (mut plan, plan_events) = run(Some(true));
    plan.plan_only = true;
    let result = external
        .call("ext_0_fixture_echo", json!({"value":"plan"}), &plan)
        .await;
    assert_eq!(result["isError"], true);
    assert!(plan_events.lock().unwrap().is_empty());
    let result = external
        .call("ext_0_fixture_echo", json!({"value":"fixture"}), &denied)
        .await;
    assert_eq!(result["isError"], true);
    assert!(!denied_events
        .lock()
        .unwrap()
        .iter()
        .any(|event| event["kind"] == "tool"));
    let (approved, events) = run(Some(true));
    for _ in 0..2 {
        let result = external
            .call("ext_0_fixture_echo", json!({"value":"fixture"}), &approved)
            .await;
        assert_eq!(result["isError"], false, "{result}");
        assert!(result["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("fixture.echo"));
    }
    assert_eq!(
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event["kind"] == "approval")
            .count(),
        2
    );
    assert_eq!(
        external.call("ext_unknown", json!({}), &approved).await["isError"],
        true
    );
}

#[tokio::test]
async fn local_http_sse_stream_handles_transport_fragmentation() {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_fixture_request(&mut socket).await;
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await.unwrap();
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Grüße\"}}]}\n\ndata: [DONE]\n\n"
            .as_bytes();
        for chunk in body.chunks(3) {
            socket
                .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                .await
                .unwrap();
            socket.write_all(chunk).await.unwrap();
            socket.write_all(b"\r\n").await.unwrap();
        }
        socket.write_all(b"0\r\n\r\n").await.unwrap();
    });
    let response = integrations::client()
        .unwrap()
        .get(format!("http://{address}"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["content-type"], "text/event-stream");
    let (run, events) = run(None);
    let mut result = byok::StreamResult::default();
    let mut buffer = vec![];
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        buffer.extend_from_slice(&chunk.unwrap());
        while let Some(frame) = byok::frame(&mut buffer) {
            byok::consume(&frame, "compatible", &mut result, &run).unwrap();
        }
    }
    fixture.await.unwrap();
    assert!(buffer.is_empty());
    assert_eq!(result.text, "Grüße");
    assert_eq!(events.lock().unwrap()[0]["data"]["delta"], "Grüße");
}

#[test]
fn provider_output_and_model_inputs_are_bounded() {
    let mut result = byok::StreamResult::default();
    assert!(result
        .feed(
            "openai",
            &json!({"choices":[{"delta":{"content":"x".repeat(2_097_153)}}]})
        )
        .is_err());
    let mut result = byok::StreamResult::default();
    assert!(result.feed("openai", &json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"x".repeat(65_537)}}]}}]})).is_err());
    let mut profile = profile("google");
    profile.model = "../unexpected?key=fixture".into();
    assert!(byok::payload(&profile, "", &[], &[]).is_err());
    profile.model.clear();
    assert!(byok::payload(&profile, "", &[], &[]).is_err());
}

#[test]
fn incomplete_provider_streams_do_not_count_as_completed_turns() {
    for (provider, delta, finish) in [
        (
            "openai",
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"fixture-call","function":{"name":"execute","arguments":"{}"}}]}}]}),
            json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
        ),
        (
            "anthropic",
            json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"fixture-call","name":"execute","input":{}}}),
            json!({"type":"message_stop"}),
        ),
        (
            "google",
            json!({"candidates":[{"content":{"parts":[{"functionCall":{"name":"execute","args":{}}}]}}]}),
            json!({"candidates":[{"finishReason":"STOP"}]}),
        ),
    ] {
        let mut result = byok::StreamResult::default();
        result.feed(provider, &delta).unwrap();
        assert!(!result.complete, "{provider}");
        result.feed(provider, &finish).unwrap();
        assert!(result.complete, "{provider}");
    }
    let mut result = byok::StreamResult::default();
    assert!(result
        .feed("openai", &json!({"choices":[{"finish_reason":"length"}]}))
        .is_err());
    assert!(!result.complete);
    assert!(result
        .feed(
            "google",
            &json!({"candidates":[{"finishReason":"MAX_TOKENS"}]})
        )
        .is_err());
    assert!(!result.complete);
}

#[tokio::test]
async fn abrupt_http_eof_never_executes_a_partially_streamed_tool() {
    use tokio::io::AsyncWriteExt;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_fixture_request(&mut socket).await;
        let body = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"fixture-call\",\"function\":{\"name\":\"execute\",\"arguments\":\"{}\"}}]}}]}\n\n";
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes()).await.unwrap();
    });
    let mut request = request();
    request.profile.id = super::new_id();
    request.profile.endpoint = format!("http://{address}/v1");
    request.messages.push(super::types::Message {
        role: "user".into(),
        text: "Fixture request".into(),
    });
    let (run, events) = run(Some(true));
    let external = integrations::connect(&[], std::path::Path::new("."), &run)
        .await
        .unwrap();
    let server = Arc::new(tokio::sync::Mutex::new(Server {
        pool: crate::db::pool::create_pool_state(),
        columns: HashMap::new(),
    }));
    let result = byok::run(
        &request,
        "fixture",
        &server,
        &McpConfig::default(),
        external,
        &run,
    )
    .await;
    assert!(result.unwrap_err().contains("Abschluss"));
    fixture.await.unwrap();
    assert!(!events
        .lock()
        .unwrap()
        .iter()
        .any(|event| event["kind"] == "tool" || event["kind"] == "approval"));
}

#[test]
fn anthropic_native_thinking_blocks_survive_the_next_tool_round() {
    let blocks = json!([
        {"type":"thinking","thinking":"fixture private reasoning","signature":"fixture-signature"},
        {"type":"tool_use","id":"fixture-call","name":"describe","input":{"table":"users"}}
    ]);
    let messages = vec![
        json!({"role":"assistant","content":"","nativeContent":blocks}),
        json!({"role":"tool","tool_call_id":"fixture-call","content":"id INTEGER"}),
    ];
    let (_, payload) = byok::payload(&profile("anthropic"), "fixture", &messages, &[]).unwrap();
    assert_eq!(payload["messages"][0]["content"], blocks);
    assert_eq!(payload["messages"][1]["content"][0]["type"], "tool_result");
    let mut result = byok::StreamResult::default();
    result.feed("anthropic", &json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}})).unwrap();
    result.feed("anthropic", &json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"fixture private reasoning"}})).unwrap();
    assert!(result.text.is_empty());
}

#[tokio::test]
async fn private_bridge_requires_bearer_and_exposes_only_scoped_connections() {
    let public = McpConfig {
        connections: vec![policy("active"), policy("unselected")],
        ..McpConfig::default()
    };
    let scoped = context::scoped_config(&request(), public.clone()).unwrap();
    let (run, _) = run(Some(false));
    let run = Arc::new(run);
    let external = integrations::connect(&[], std::path::Path::new("."), &run)
        .await
        .unwrap();
    let server = Arc::new(tokio::sync::Mutex::new(Server {
        pool: crate::db::pool::create_pool_state(),
        columns: HashMap::new(),
    }));
    let bridge = super::bridge::Bridge::start(server, scoped, run, external)
        .await
        .unwrap();
    let address: Value =
        serde_json::from_slice(&std::fs::read(bridge.file.path()).unwrap()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(bridge.file.path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    let url = format!("http://127.0.0.1:{}/rpc", address["port"].as_u64().unwrap());
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .unwrap();
    for bearer in [None, Some("invalid-fixture-token")] {
        let mut request = client
            .post(&url)
            .json(&json!({"jsonrpc":"2.0","id":1,"method":"initialize"}));
        if let Some(bearer) = bearer {
            request = request.bearer_auth(bearer);
        }
        assert!(request.send().await.is_err());
    }
    let token = address["token"].as_str().unwrap();
    let response: Value = client
        .post(&url)
        .bearer_auth(token)
        .json(&json!({"jsonrpc":"2.0","id":2,"method":"initialize"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(response["result"]["serverInfo"]["name"], "l8db_ai");
    let response: Value = client.post(&url).bearer_auth(token).json(&json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"connections","arguments":{}}})).send().await.unwrap().json().await.unwrap();
    assert_eq!(response["result"]["isError"], false);
    let text = response["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("active"));
    assert!(text.contains("mentioned"));
    assert!(!text.contains("unselected"));
    assert!(!text.contains("fixture.sqlite"));
    assert!(!public.enabled);
    let path = bridge.file.path().to_path_buf();
    drop(bridge);
    assert!(!path.exists());
}

#[tokio::test]
async fn external_http_mcp_returns_matching_sse_response_before_eof() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let observed = Arc::new(Mutex::new(Vec::<String>::new()));
    let captured = observed.clone();
    let fixture = tokio::spawn(async move {
        let mut tasks = vec![];
        for index in 0..4 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let captured = captured.clone();
            tasks.push(tokio::spawn(async move {
                let mut bytes = vec![];
                let mut chunk = [0; 4096];
                let (headers, offset, length) = loop {
                    let count = socket.read(&mut chunk).await.unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&chunk[..count]);
                    if let Some(offset) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                        let headers = String::from_utf8(bytes[..offset].to_vec()).unwrap();
                        let length = headers.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|value| value.trim().parse::<usize>().unwrap())).unwrap();
                        break (headers, offset + 4, length);
                    }
                };
                while bytes.len() < offset + length {
                    let count = socket.read(&mut chunk).await.unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&chunk[..count]);
                }
                let request: Value = serde_json::from_slice(&bytes[offset..offset+length]).unwrap();
                captured.lock().unwrap().push(request["method"].as_str().unwrap().into());
                if index > 0 { assert!(headers.to_ascii_lowercase().contains("mcp-session-id: fixture-session")); }
                if request["method"] == "notifications/initialized" {
                    socket.write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                    return;
                }
                let result = match request["method"].as_str().unwrap() {
                    "initialize" => json!({"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}}),
                    "tools/list" => json!({"tools":[{"name":"echo","inputSchema":{"type":"object"}}]}),
                    "tools/call" => json!({"content":[{"type":"text","text":"fixture response"}],"isError":false}),
                    _ => panic!("unexpected fixture request"),
                };
                let body = format!("data: {{\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{{}}}}\n\ndata: {{\"jsonrpc\":\"2.0\",\"id\":99,\"result\":{{}}}}\n\ndata: {}\n\n", json!({"jsonrpc":"2.0","id":request["id"],"result":result}));
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nMcp-Session-Id: fixture-session\r\nTransfer-Encoding: chunked\r\n\r\n").await.unwrap();
                socket.write_all(format!("{:x}\r\n{}\r\n", body.len(), body).as_bytes()).await.unwrap();
                let mut closed = [0;1];
                let _ = socket.read(&mut closed).await;
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
    });
    let server = super::types::ExternalServer {
        id: super::new_id(),
        name: "HTTP Fixture".into(),
        transport: "http".into(),
        command: String::new(),
        args: vec![],
        url: format!("http://{address}/mcp"),
    };
    let (run, events) = run(Some(true));
    let mut external = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        integrations::connect(&[server], std::path::Path::new("."), &run),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(external.tools[0]["name"], "ext_0_echo");
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        external.call("ext_0_echo", json!({}), &run),
    )
    .await
    .unwrap();
    assert_eq!(result["content"][0]["text"], "fixture response");
    assert_eq!(
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event["kind"] == "approval")
            .count(),
        1
    );
    drop(external);
    tokio::time::timeout(std::time::Duration::from_secs(5), fixture)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        *observed.lock().unwrap(),
        [
            "initialize",
            "notifications/initialized",
            "tools/list",
            "tools/call"
        ]
    );
}
