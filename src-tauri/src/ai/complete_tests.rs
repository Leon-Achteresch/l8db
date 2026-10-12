use super::*;
use crate::ai::types::Message;
use std::sync::Mutex;
use std::time::Instant;
use tauri::ipc::InvokeResponseBody;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn profile(provider: &str) -> Profile {
    serde_json::from_value(
        json!({"id": "fixture-profile", "provider": provider, "model": "fixture-model"}),
    )
    .unwrap()
}

fn message(role: &str, text: &str) -> Message {
    Message {
        role: role.into(),
        text: text.into(),
    }
}

fn request(provider: &str) -> CompleteRequest {
    CompleteRequest {
        run_id: "fixture-run".into(),
        profile: profile(provider),
        cached: "Schema: users(id, name)".into(),
        system: "Cursor at line 3".into(),
        messages: vec![message("user", "SELECT * FROM ")],
        max_tokens: 64,
        stop: vec![";".into()],
        cache_key: "editor-ghost".into(),
    }
}

fn sink(state: &Arc<AiState>, key: &str) -> (Sink, Arc<Mutex<Vec<Value>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let channel = Channel::new(move |body| {
        let InvokeResponseBody::Json(body) = body else {
            panic!("expected JSON event")
        };
        captured
            .lock()
            .unwrap()
            .push(serde_json::from_str::<Value>(&body).unwrap());
        Ok(())
    });
    (
        Sink {
            channel,
            state: state.clone(),
            key: key.into(),
        },
        events,
    )
}

fn percentile(samples: &mut [f64], fraction: f64) -> f64 {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    samples[((samples.len() - 1) as f64 * fraction).round() as usize]
}

#[test]
fn validation_rejects_invalid_requests_and_clamps_tokens() {
    let mut fixture = request("openai");
    fixture.max_tokens = 1;
    assert_eq!(validate(fixture).unwrap().max_tokens, 16);
    let mut fixture = request("openai");
    fixture.max_tokens = 100_000;
    assert_eq!(validate(fixture).unwrap().max_tokens, 8192);
    let cases: Vec<Box<dyn Fn(&mut CompleteRequest)>> = vec![
        Box::new(|request| request.run_id = "bad id".into()),
        Box::new(|request| request.profile.id = String::new()),
        Box::new(|request| request.stop = vec!["a".into(); 5]),
        Box::new(|request| request.stop = vec!["x".repeat(33)]),
        Box::new(|request| request.stop = vec![String::new()]),
        Box::new(|request| request.cached = "x".repeat(MAX_CONTEXT + 1)),
        Box::new(|request| {
            request.messages = (0..41)
                .map(|index| message(if index % 2 == 0 { "user" } else { "assistant" }, "x"))
                .collect()
        }),
        Box::new(|request| request.messages = vec![message("user", &"x".repeat(MAX_CONTEXT + 1))]),
        Box::new(|request| request.messages = vec![]),
        Box::new(|request| {
            request.messages = vec![message("user", "a"), message("assistant", "b")]
        }),
        Box::new(|request| request.messages = vec![message("system", "a")]),
        Box::new(|request| {
            request.messages = vec![
                message("user", "a"),
                message("user", "b"),
                message("user", "c"),
            ]
        }),
        Box::new(|request| request.messages = vec![message("user", "  ")]),
        Box::new(|request| request.cache_key = "x".repeat(65)),
        Box::new(|request| request.cache_key = "a b".into()),
    ];
    for change in cases {
        let mut fixture = request("openai");
        change(&mut fixture);
        assert!(validate(fixture).is_err());
    }
    let mut fixture = request("openai");
    fixture.messages = vec![
        message("user", "a"),
        message("assistant", "b"),
        message("user", "c"),
    ];
    fixture.stop = vec!["ä".repeat(32)];
    assert!(validate(fixture).is_ok());
}

#[test]
fn anthropic_payload_caches_the_stable_prefix_only() {
    let mut fixture = request("anthropic");
    fixture.profile.effort = "low".into();
    let (url, body) = complete_payload(&fixture.profile, &fixture).unwrap();
    assert_eq!(url, "https://api.anthropic.com/v1/messages");
    assert_eq!(body["system"][0]["text"], fixture.cached);
    assert_eq!(body["system"][0]["cache_control"]["type"], "ephemeral");
    assert_eq!(body["system"][1]["text"], fixture.system);
    assert!(body["system"][1].get("cache_control").is_none());
    assert_eq!(body["messages"][0]["content"], "SELECT * FROM ");
    assert_eq!(body["stop_sequences"][0], ";");
    assert_eq!(body["max_tokens"], 64);
    assert_eq!(body["stream"], true);
    assert_eq!(body["output_config"]["effort"], "low");
    assert!(body.get("tools").is_none());
    fixture.cached.clear();
    fixture.system.clear();
    fixture.stop.clear();
    let (_, body) = complete_payload(&fixture.profile, &fixture).unwrap();
    assert!(body.get("system").is_none());
    assert!(body.get("stop_sequences").is_none());
    fixture.profile.effort = "extreme".into();
    assert!(complete_payload(&fixture.profile, &fixture).is_err());
}

#[test]
fn openai_style_payloads_respect_provider_quirks() {
    let fixture = request("openai");
    let (url, body) = complete_payload(&fixture.profile, &fixture).unwrap();
    assert_eq!(url, "https://api.openai.com/v1/chat/completions");
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(
        body["messages"][0]["content"],
        "Schema: users(id, name)\n\nCursor at line 3"
    );
    assert_eq!(body["messages"][1]["role"], "user");
    assert_eq!(body["max_completion_tokens"], 64);
    assert!(body.get("max_tokens").is_none());
    assert!(body.get("stop").is_none());
    assert_eq!(body["prompt_cache_key"], "editor-ghost");
    assert_eq!(body["stream_options"]["include_usage"], true);
    for provider in ["compatible", "ollama", "lmstudio"] {
        let mut fixture = request(provider);
        fixture.profile.endpoint = "http://127.0.0.1:1/v1".into();
        fixture.profile.effort = "medium".into();
        fixture.system.clear();
        let (url, body) = complete_payload(&fixture.profile, &fixture).unwrap();
        assert_eq!(url, "http://127.0.0.1:1/v1/chat/completions");
        assert_eq!(body["messages"][0]["content"], "Schema: users(id, name)");
        assert_eq!(body["max_tokens"], 64);
        assert_eq!(body["stop"][0], ";");
        assert!(body.get("prompt_cache_key").is_none());
        assert!(body.get("max_completion_tokens").is_none());
        assert_eq!(body["reasoning_effort"], "medium");
    }
    let mut fixture = request("openai");
    fixture.cache_key.clear();
    let (_, body) = complete_payload(&fixture.profile, &fixture).unwrap();
    assert!(body.get("prompt_cache_key").is_none());
}

#[test]
fn google_payload_maps_roles_and_generation_config() {
    let mut fixture = request("google");
    fixture.profile.effort = "low".into();
    fixture.messages = vec![
        message("user", "a"),
        message("assistant", "b"),
        message("user", "c"),
    ];
    let (url, body) = complete_payload(&fixture.profile, &fixture).unwrap();
    assert!(url.ends_with("/models/fixture-model:streamGenerateContent?alt=sse"));
    assert_eq!(
        body["systemInstruction"]["parts"][0]["text"],
        "Schema: users(id, name)\n\nCursor at line 3"
    );
    assert_eq!(body["contents"][1]["role"], "model");
    assert_eq!(body["contents"][2]["parts"][0]["text"], "c");
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 64);
    assert_eq!(body["generationConfig"]["stopSequences"][0], ";");
    assert_eq!(
        body["generationConfig"]["thinkingConfig"]["thinkingLevel"],
        "LOW"
    );
    fixture.profile.model = "bad/model".into();
    assert!(complete_payload(&fixture.profile, &fixture).is_err());
    let mut fixture = request("anthropic");
    fixture.profile.model.clear();
    assert!(complete_payload(&fixture.profile, &fixture).is_err());
}

#[test]
fn truncation_is_only_accepted_for_editor_completions() {
    let cases = [
        (
            "anthropic",
            json!({"type":"message_delta","delta":{"stop_reason":"max_tokens"}}),
            true,
        ),
        (
            "anthropic",
            json!({"type":"message_delta","delta":{"stop_reason":"stop_sequence"}}),
            false,
        ),
        (
            "openai",
            json!({"choices":[{"delta":{},"finish_reason":"length"}]}),
            true,
        ),
        (
            "google",
            json!({"candidates":[{"finishReason":"MAX_TOKENS","content":{"parts":[{"text":"x"}]}}]}),
            true,
        ),
    ];
    for (provider, value, truncated) in cases {
        let mut chat = StreamResult::default();
        assert!(chat.feed(provider, &value).is_err());
        let mut editor = StreamResult::truncatable();
        editor.feed(provider, &value).unwrap();
        assert_eq!(editor.truncated, truncated);
    }
    let mut editor = StreamResult::truncatable();
    assert!(editor
        .feed(
            "openai",
            &json!({"choices":[{"delta":{},"finish_reason":"content_filter"}]})
        )
        .is_err());
}

#[test]
fn gate_cuts_at_stop_sequences_across_deltas_and_limits() {
    let mut gate = Gate::new(&["\n\n".into(), "END".into()], None);
    let mut out = gate.push("SELECT id");
    out.push_str(&gate.push(" FROM users\n"));
    assert!(!gate.done);
    out.push_str(&gate.push("\nignored"));
    assert!(gate.done && !gate.truncated);
    out.push_str(&gate.flush());
    assert_eq!(out, "SELECT id FROM users");
    assert_eq!(gate.text, out);
    let mut gate = Gate::new(&["EN".into()], None);
    let mut out = gate.push("abcE");
    assert_eq!(out, "abc");
    out.push_str(&gate.push("x"));
    out.push_str(&gate.flush());
    assert_eq!(out, "abcEx");
    let mut gate = Gate::new(&[], Some(5));
    let out = gate.push("ääää");
    assert!(gate.done && gate.truncated);
    assert_eq!(out, "ää");
    assert_eq!(gate.push("more"), "");
    let mut gate = Gate::new(&[], None);
    assert_eq!(gate.push("plain"), "plain");
    assert_eq!(gate.flush(), "");
}

#[test]
fn cli_arguments_disable_tools_sessions_and_user_settings() {
    let mut fixture = profile("claude");
    fixture.model = "claude-haiku-4-5".into();
    fixture.effort = "low".into();
    let args = claude_args(&fixture, "system text", None);
    let position = |name: &str| args.iter().position(|arg| arg == name).unwrap();
    assert_eq!(args[position("--tools") + 1], "");
    assert_eq!(args[position("--input-format") + 1], "text");
    assert_eq!(args[position("--output-format") + 1], "stream-json");
    assert_eq!(args[position("--system-prompt") + 1], "system text");
    assert_eq!(args[position("--model") + 1], "claude-haiku-4-5");
    assert_eq!(args[position("--effort") + 1], "low");
    for flag in [
        "--print",
        "--verbose",
        "--include-partial-messages",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--setting-sources=",
    ] {
        assert!(args.iter().any(|arg| arg == flag), "{flag}");
    }
    assert!(!args.iter().any(|arg| arg == "--bare"));
    let mut bare = profile("claude");
    bare.model.clear();
    let args = claude_args(&bare, "ignored", Some("/tmp/prompt.txt"));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["--system-prompt-file", "/tmp/prompt.txt"]));
    assert!(!args
        .iter()
        .any(|arg| arg == "--system-prompt" || arg == "--model"));
    let mut fixture = profile("codex");
    fixture.model = "gpt-5.6-luna".into();
    fixture.effort = "low".into();
    let args = codex_args(&fixture, Some("Say \"pong\"\nnow"));
    assert_eq!(&args[..2], ["exec", "--json"]);
    assert!(args
        .windows(2)
        .any(|pair| pair == ["--sandbox", "read-only"]));
    assert!(args.iter().any(|arg| arg == "--ephemeral"));
    assert!(args.iter().any(|arg| arg == "--skip-git-repo-check"));
    assert!(args
        .iter()
        .any(|arg| arg == "developer_instructions=\"Say \\\"pong\\\"\\nnow\""));
    assert!(args.windows(2).any(|pair| pair == ["-m", "gpt-5.6-luna"]));
    assert!(args.iter().any(|arg| arg == "model_reasoning_effort=low"));
    assert_eq!(args.last().unwrap(), "-");
    let args = codex_args(&profile("codex"), None);
    assert!(!args
        .iter()
        .any(|arg| arg.starts_with("developer_instructions")));
    let mut fixture = request("codex");
    assert_eq!(codex_prompt(&fixture, true), "SELECT * FROM ");
    fixture.messages = vec![
        message("user", "a"),
        message("assistant", "b"),
        message("user", "c"),
    ];
    assert_eq!(
        codex_prompt(&fixture, true),
        "User: a\n\nAssistant: b\n\nUser: c"
    );
    assert!(codex_prompt(&fixture, false).starts_with(
        "Instructions:\nSchema: users(id, name)\n\nCursor at line 3\n\nConversation:\nUser: a"
    ));
}

#[test]
fn claude_stream_events_produce_text_model_and_usage() {
    let lines = [
        r#"{"type":"system","subtype":"init","model":"claude-haiku-4-5","tools":[],"mcp_servers":[],"apiKeySource":"none"}"#,
        r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"po"}}}"#,
        r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ng"}}}"#,
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"pong"}]}}"#,
        r#"{"type":"result","subtype":"success","is_error":false,"result":"pong","usage":{"input_tokens":498,"output_tokens":5,"cache_read_input_tokens":0},"modelUsage":{"claude-haiku-4-5":{"inputTokens":498,"outputTokens":5,"costUSD":0.000838}},"total_cost_usd":0.000838}"#,
    ];
    let mut state = CliStream::default();
    let text: String = lines
        .iter()
        .filter_map(|line| claude_event(&serde_json::from_str(line).unwrap(), &mut state))
        .collect();
    assert_eq!(text, "pong");
    assert_eq!(state.model, "claude-haiku-4-5");
    assert!(state.finished && state.error.is_none());
    let usage = state.usage.unwrap();
    assert_eq!(usage["usage"]["input_tokens"], 498);
    assert_eq!(usage["total_cost_usd"], 0.000838);
    assert_eq!(usage["modelUsage"]["claude-haiku-4-5"]["inputTokens"], 498);
    let mut state = CliStream::default();
    let text = claude_event(
        &json!({"type":"assistant","message":{"content":[{"type":"text","text":"whole"}]}}),
        &mut state,
    );
    assert_eq!(text.as_deref(), Some("whole"));
    claude_event(
        &json!({"type":"result","is_error":true,"result":"Not logged in"}),
        &mut state,
    );
    assert!(state.error.is_some());
}

#[test]
fn codex_exec_events_produce_text_and_openai_style_usage() {
    let lines = [
        r#"{"type":"thread.started","thread_id":"01a12249-2b4b-7df2-be55-e5662942dde6"}"#,
        r#"{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Under-development features enabled"}}"#,
        r#"{"type":"turn.started"}"#,
        r#"{"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"thinking"}}"#,
        r#"{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"pong"}}"#,
        r#"{"type":"turn.completed","usage":{"input_tokens":16252,"cached_input_tokens":8960,"cache_write_input_tokens":0,"output_tokens":18,"reasoning_output_tokens":11}}"#,
    ];
    let mut state = CliStream::default();
    let text: String = lines
        .iter()
        .filter_map(|line| codex_event(&serde_json::from_str(line).unwrap(), &mut state))
        .collect();
    assert_eq!(text, "pong");
    assert!(state.finished && state.error.is_none());
    let usage = state.usage.unwrap();
    assert_eq!(usage["usage"]["prompt_tokens"], 16252);
    assert_eq!(usage["usage"]["completion_tokens"], 18);
    assert_eq!(
        usage["usage"]["prompt_tokens_details"]["cached_tokens"],
        8960
    );
    let mut state = CliStream::default();
    codex_event(
        &serde_json::from_str(r#"{"type":"turn.failed","error":{"message":"{\"status\":400}"}}"#)
            .unwrap(),
        &mut state,
    );
    assert!(state.finished && state.error.is_some());
}

#[test]
fn registry_limits_parallel_completions_per_window_and_cleans_up() {
    let state = Arc::new(AiState::default());
    let slots: Vec<_> = (0..MAX_PARALLEL)
        .map(|index| register(&state, "main", &format!("run-{index}")).unwrap())
        .collect();
    assert_eq!(
        register(&state, "main", "run-extra").err().unwrap(),
        "Zu viele parallele KI-Anfragen im Editor"
    );
    assert!(register(&state, "win-2", "run-0").is_ok());
    drop(slots);
    let (_slot, _) = register(&state, "main", "run-0").unwrap();
    assert!(register(&state, "main", "run-0").is_err());
    assert!(state.runs.lock().unwrap().is_empty());
    assert_eq!(state.completions.lock().unwrap().len(), 1);
}

#[test]
fn cancel_before_register_is_not_lost_and_stays_bounded() {
    let state = Arc::new(AiState::default());
    cancel_run(
        &mut state.completions.lock().unwrap(),
        "main:early".to_string(),
    );
    assert_eq!(
        register(&state, "main", "early").err().unwrap(),
        "Abgebrochen"
    );
    assert!(state.completions.lock().unwrap().is_empty());
    let slots: Vec<_> = (0..MAX_PARALLEL - 1)
        .map(|index| register(&state, "main", &format!("run-{index}")).unwrap())
        .collect();
    for index in 0..500 {
        cancel_run(
            &mut state.completions.lock().unwrap(),
            format!("main:gone-{index}"),
        );
    }
    assert!(state.completions.lock().unwrap().len() <= MAX_PARALLEL - 1 + 64);
    assert!(register(&state, "main", "run-last").is_ok());
    let (slot, mut cancelled) = register(&state, "win-2", "live").unwrap();
    cancel_run(&mut state.completions.lock().unwrap(), slot.key.clone());
    assert!(*cancelled.borrow_and_update());
    drop(slots);
}

#[tokio::test]
async fn cancel_stops_a_hanging_completion_promptly() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        tokio::time::sleep(Duration::from_secs(30)).await;
        drop(socket);
    });
    let state = Arc::new(AiState::default());
    let mut fixture = request("compatible");
    fixture.profile.endpoint = format!("http://{address}/v1");
    let (slot, cancelled) = register(&state, "main", &fixture.run_id).unwrap();
    let (sink, _) = sink(&state, &slot.key);
    let cancel_state = state.clone();
    let started = Instant::now();
    let (result, _) = tokio::join!(drive(&fixture, &sink, cancelled), async move {
        tokio::time::sleep(Duration::from_millis(200)).await;
        let completions = cancel_state.completions.lock().unwrap();
        completions["main:fixture-run"].send(true).unwrap();
    });
    assert_eq!(result.unwrap_err(), "Abgebrochen");
    assert!(started.elapsed() < Duration::from_secs(2));
    drop(slot);
    assert!(state.completions.lock().unwrap().is_empty());
    server.abort();
}

#[tokio::test]
async fn compatible_stream_emits_text_usage_and_accepts_max_tokens() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buffer = [0; 4096];
        let payload = loop {
            let read = socket.read(&mut buffer).await.unwrap();
            request.extend_from_slice(&buffer[..read]);
            let text = String::from_utf8_lossy(&request);
            if let Some(split) = text.find("\r\n\r\n") {
                let length = text[..split]
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|value| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap();
                if request.len() >= split + 4 + length {
                    break serde_json::from_slice::<Value>(&request[split + 4..split + 4 + length])
                        .unwrap();
                }
            }
        };
        assert_eq!(payload["max_tokens"], 64);
        assert_eq!(payload["stream"], true);
        assert!(payload.get("tools").is_none());
        let frames = [
            json!({"choices":[{"delta":{"content":"id, "}}]}),
            json!({"choices":[{"delta":{"content":"name"}}]}),
            json!({"choices":[{"delta":{},"finish_reason":"length"}]}),
            json!({"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":16,"prompt_tokens_details":{"cached_tokens":100}}}),
        ];
        let mut body: String = frames
            .iter()
            .map(|frame| format!("data: {frame}\n\n"))
            .collect();
        body.push_str("data: [DONE]\n\n");
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
    });
    let state = Arc::new(AiState::default());
    let mut fixture = request("compatible");
    fixture.profile.endpoint = format!("http://{address}/v1");
    fixture.stop.clear();
    let (slot, cancelled) = register(&state, "main", &fixture.run_id).unwrap();
    let (sink, events) = sink(&state, &slot.key);
    let result = drive(&fixture, &sink, cancelled).await.unwrap();
    assert_eq!(
        result,
        json!({"text": "id, name", "truncated": true, "model": "fixture-model"})
    );
    let events = events.lock().unwrap();
    let text: String = events
        .iter()
        .filter(|event| event["kind"] == "text")
        .map(|event| event["data"]["delta"].as_str().unwrap())
        .collect();
    assert_eq!(text, "id, name");
    let usage: Vec<_> = events
        .iter()
        .filter(|event| event["kind"] == "usage")
        .collect();
    assert_eq!(usage.len(), 1);
    assert_eq!(
        usage[0]["data"]["usage"]["prompt_tokens_details"]["cached_tokens"],
        100
    );
    server.await.unwrap();
}

#[tokio::test]
async fn other_cli_agents_are_rejected() {
    let state = Arc::new(AiState::default());
    for provider in ["gemini-cli", "opencode", "copilot"] {
        let fixture = request(provider);
        let (slot, cancelled) = register(&state, "main", &fixture.run_id).unwrap();
        let (sink, _) = sink(&state, &slot.key);
        assert_eq!(
            drive(&fixture, &sink, cancelled).await.unwrap_err(),
            UNSUPPORTED
        );
    }
}

#[test]
fn thin_tool_results_keeps_recent_rounds_and_is_idempotent() {
    let mut messages = vec![json!({"role": "user", "content": "start"})];
    for round in 0..5 {
        messages.push(json!({"role": "assistant", "content": "", "tool_calls": [{"id": format!("call-{round}"), "function": {"name": "query", "arguments": "{}"}}]}));
        messages.push(json!({"role": "tool", "tool_call_id": format!("call-{round}"), "content": format!("header {round}\n{}", "x".repeat(1_000))}));
    }
    let original = messages.clone();
    assert_eq!(byok::thin_tool_results(&mut messages, 2, 1_000_000), 0);
    assert_eq!(messages, original);
    assert_eq!(byok::thin_tool_results(&mut messages, 2, 1_000), 3);
    for (index, message) in messages.iter().enumerate() {
        if message["role"] != "tool" {
            assert_eq!(message, &original[index]);
            continue;
        }
        let content = message["content"].as_str().unwrap();
        if index < 7 {
            assert!(content.starts_with(
                "[older tool result omitted to save context: 1009 chars; starts with: header"
            ));
        } else {
            assert_eq!(content, original[index]["content"]);
        }
    }
    let once = messages.clone();
    assert_eq!(byok::thin_tool_results(&mut messages, 2, 1_000), 0);
    assert_eq!(messages, once);
    let mut copy = original.clone();
    byok::thin_tool_results(&mut copy, 2, 1_000);
    assert_eq!(copy, once);
}

#[test]
fn chat_payload_uses_at_most_four_cache_breakpoints_and_openai_cache_key() {
    let messages = vec![
        json!({"role": "user", "content": "Inspect"}),
        json!({"role": "assistant", "content": "", "nativeContent": [{"type": "thinking", "thinking": "x", "signature": "s"}]}),
    ];
    let tools = vec![
        json!({"name": "a", "description": "A", "inputSchema": {"type": "object"}}),
        json!({"name": "b", "description": "B", "inputSchema": {"type": "object"}}),
    ];
    let (_, body) = byok::payload(&profile("anthropic"), "rules", &messages, &tools).unwrap();
    assert!(body.to_string().matches("cache_control").count() <= 4);
    assert!(body["tools"][0].get("cache_control").is_none());
    assert_eq!(body["tools"][1]["cache_control"]["type"], "ephemeral");
    assert!(body["messages"][1]["content"][0]
        .get("cache_control")
        .is_none());
    let (_, body) = byok::payload(
        &profile("anthropic"),
        "",
        &[json!({"role": "user", "content": "x"})],
        &[],
    )
    .unwrap();
    assert!(body.get("system").is_none());
    assert_eq!(
        body["messages"][0]["content"][0]["cache_control"]["type"],
        "ephemeral"
    );
    let (_, first) = byok::payload(&profile("openai"), "rules", &[], &[]).unwrap();
    let (_, second) = byok::payload(&profile("openai"), "rules", &[], &[]).unwrap();
    let (_, other) = byok::payload(&profile("openai"), "other", &[], &[]).unwrap();
    let key = first["prompt_cache_key"].as_str().unwrap();
    assert_eq!(key.len(), 21);
    assert_eq!(key, second["prompt_cache_key"]);
    assert_ne!(key, other["prompt_cache_key"]);
    let mut compatible = profile("compatible");
    compatible.endpoint = "http://127.0.0.1:1/v1".into();
    let (_, body) = byok::payload(&compatible, "rules", &[], &[]).unwrap();
    assert!(body.get("prompt_cache_key").is_none());
    assert_eq!(byok::fnv1a(""), 0xcbf29ce484222325);
    assert_eq!(byok::fnv1a("a"), 0xaf63dc4c8601ec8c);
}

#[test]
fn performance_payload_building_with_large_cached_prefix() {
    let mut fixture = request("anthropic");
    fixture.cached = "CREATE TABLE t (id int);\n".repeat(12_000);
    assert!(fixture.cached.len() >= 300_000);
    fixture.messages = (0..39)
        .map(|index| {
            message(
                if index % 2 == 0 { "user" } else { "assistant" },
                &"SELECT 1;\n".repeat(200),
            )
        })
        .collect();
    let fixture = validate(fixture).unwrap();
    for provider in ["anthropic", "openai", "google"] {
        let mut samples = Vec::new();
        let mut profile = fixture.profile.clone();
        profile.provider = provider.into();
        for _ in 0..50 {
            let started = Instant::now();
            let (_, body) = complete_payload(&profile, &fixture).unwrap();
            std::hint::black_box(body);
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        let median = percentile(&mut samples, 0.5);
        let p95 = percentile(&mut samples, 0.95);
        println!("complete_payload {provider}: 300 KB prefix + 39 messages, median {median:.3} ms, p95 {p95:.3} ms");
        assert!(median < 20.0, "{provider} median {median} ms");
    }
}

#[test]
fn performance_thin_tool_results_over_large_history() {
    let mut template = vec![json!({"role": "user", "content": "start"})];
    for round in 0..100 {
        template.push(json!({"role": "assistant", "content": "", "tool_calls": [{"id": format!("call-{round}"), "function": {"name": "query", "arguments": "{\"sql\":\"SELECT 1\"}"}}]}));
        template.push(json!({"role": "tool", "tool_call_id": format!("call-{round}"), "content": format!("id|name\n{}", "1|alpha\n".repeat(3_750))}));
    }
    template.truncate(200);
    let mut samples = Vec::new();
    let mut thinned = 0;
    for _ in 0..50 {
        let mut messages = template.clone();
        let started = Instant::now();
        thinned = byok::thin_tool_results(&mut messages, 2, 120_000);
        samples.push(started.elapsed().as_secs_f64() * 1000.0);
        std::hint::black_box(messages);
    }
    let mut steady = Vec::new();
    let mut messages = template.clone();
    byok::thin_tool_results(&mut messages, 2, 120_000);
    for _ in 0..50 {
        let started = Instant::now();
        std::hint::black_box(byok::thin_tool_results(&mut messages, 2, 120_000));
        steady.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    let median = percentile(&mut samples, 0.5);
    let p95 = percentile(&mut samples, 0.95);
    let steady_median = percentile(&mut steady, 0.5);
    println!("thin_tool_results: 200 messages, 30 KB tool outputs, thinned {thinned}, median {median:.3} ms, p95 {p95:.3} ms, already thinned median {steady_median:.3} ms");
    assert!(thinned >= 95);
    assert!(median < 20.0, "median {median} ms");
    assert!(steady_median < 20.0, "steady median {steady_median} ms");
}

#[tokio::test]
#[ignore]
async fn live_cli_completion_from_env() {
    let Ok(spec) = std::env::var("L8DB_LIVE_EDITOR_AI") else {
        return;
    };
    let (provider, model) = spec.split_once(':').unwrap_or((spec.as_str(), ""));
    let state = Arc::new(AiState::default());
    let mut fixture = request(provider);
    fixture.profile.model = model.into();
    fixture.cached = "Reply with exactly: pong".into();
    fixture.system.clear();
    fixture.stop.clear();
    fixture.messages = vec![message("user", "ping")];
    let (slot, cancelled) = register(&state, "main", &fixture.run_id).unwrap();
    let (sink, events) = sink(&state, &slot.key);
    let started = Instant::now();
    let result = drive(&fixture, &sink, cancelled).await.unwrap();
    println!(
        "live {spec}: {:.2} s, result {result}, events {}",
        started.elapsed().as_secs_f64(),
        serde_json::to_string(&*events.lock().unwrap()).unwrap()
    );
    assert!(result["text"].as_str().unwrap().contains("pong"));
    assert!(events
        .lock()
        .unwrap()
        .iter()
        .any(|event| event["kind"] == "usage"));
}
