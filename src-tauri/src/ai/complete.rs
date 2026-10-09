use super::{
    byok::{self, StreamResult},
    integrations,
    runtime::AiState,
    types::{Event, Message, Profile},
};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio::sync::watch;

const MAX_PARALLEL: usize = 6;
const MAX_CONTEXT: usize = 400_000;
const MAX_MESSAGES: usize = 40;
const MAX_STREAM: usize = 4_194_304;
const INLINE_LIMIT: usize = 100_000;
const UNSUPPORTED: &str = "Editor-KI unterstützt diesen CLI-Agenten nicht. Claude Code, Codex oder einen API- bzw. lokalen Provider wählen.";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    pub run_id: String,
    pub profile: Profile,
    #[serde(default)]
    pub cached: String,
    #[serde(default)]
    pub system: String,
    pub messages: Vec<Message>,
    pub max_tokens: u32,
    #[serde(default)]
    pub stop: Vec<String>,
    #[serde(default)]
    pub cache_key: String,
}

pub(super) fn validate(mut request: CompleteRequest) -> Result<CompleteRequest, String> {
    super::validate_id(&request.run_id)?;
    super::validate_id(&request.profile.id)?;
    request.max_tokens = request.max_tokens.clamp(16, 8192);
    if request.stop.len() > 4
        || request
            .stop
            .iter()
            .any(|stop| stop.is_empty() || stop.chars().count() > 32)
    {
        return Err("Höchstens 4 Stoppsequenzen mit je 1 bis 32 Zeichen".into());
    }
    if request.cached.len() + request.system.len() > MAX_CONTEXT
        || request.messages.len() > MAX_MESSAGES
        || request
            .messages
            .iter()
            .map(|message| message.text.len())
            .sum::<usize>()
            > MAX_CONTEXT
    {
        return Err("Kontext für die Editor-KI ist zu groß".into());
    }
    if request.messages.len() % 2 == 0 {
        return Err("Eine Nachricht fehlt".into());
    }
    if request.messages.iter().enumerate().any(|(index, message)| {
        message.role != if index % 2 == 0 { "user" } else { "assistant" }
            || message.text.trim().is_empty()
    }) {
        return Err("Ungültiger Nachrichtenverlauf".into());
    }
    if request.cache_key.len() > 64
        || !request
            .cache_key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Ungültiger Cache-Schlüssel".into());
    }
    Ok(request)
}

fn instructions(request: &CompleteRequest) -> String {
    match (request.cached.is_empty(), request.system.is_empty()) {
        (false, false) => format!("{}\n\n{}", request.cached, request.system),
        (false, true) => request.cached.clone(),
        _ => request.system.clone(),
    }
}

fn transcript(request: &CompleteRequest) -> String {
    if let [message] = request.messages.as_slice() {
        return message.text.clone();
    }
    request
        .messages
        .iter()
        .map(|message| {
            format!(
                "{}: {}",
                if message.role == "assistant" {
                    "Assistant"
                } else {
                    "User"
                },
                message.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(super) fn complete_payload(
    profile: &Profile,
    request: &CompleteRequest,
) -> Result<(String, Value), String> {
    let base = byok::base(profile)?;
    if profile.model.trim().is_empty() {
        return Err("Ein Modell auswählen oder eingeben".into());
    }
    if !profile.effort.is_empty() {
        byok::valid_effort(&profile.effort)?;
    }
    let effort = (!profile.effort.is_empty()).then_some(profile.effort.as_str());
    match profile.provider.as_str() {
        "anthropic" => {
            let mut system = Vec::new();
            if !request.cached.is_empty() {
                system.push(json!({"type": "text", "text": request.cached, "cache_control": byok::ephemeral()}));
            }
            if !request.system.is_empty() {
                system.push(json!({"type": "text", "text": request.system}));
            }
            let mut body = json!({
                "model": profile.model,
                "max_tokens": request.max_tokens,
                "stream": true,
                "messages": request.messages.iter().map(|message| json!({"role": message.role, "content": message.text})).collect::<Vec<_>>(),
            });
            if !system.is_empty() {
                body["system"] = json!(system);
            }
            if !request.stop.is_empty() {
                body["stop_sequences"] = json!(request.stop);
            }
            if let Some(effort) = effort {
                body["output_config"] = json!({"effort": effort});
            }
            Ok((format!("{base}/messages"), body))
        }
        "google" => {
            let model = byok::gemini_model(profile)?;
            let mut config = json!({"maxOutputTokens": request.max_tokens});
            if !request.stop.is_empty() {
                config["stopSequences"] = json!(request.stop);
            }
            if let Some(effort) = effort {
                config["thinkingConfig"] = json!({"thinkingLevel": effort.to_ascii_uppercase()});
            }
            let mut body = json!({
                "contents": request.messages.iter().map(|message| json!({"role": if message.role == "assistant" { "model" } else { "user" }, "parts": [{"text": message.text}]})).collect::<Vec<_>>(),
                "generationConfig": config,
            });
            let instructions = instructions(request);
            if !instructions.is_empty() {
                body["systemInstruction"] = json!({"parts": [{"text": instructions}]});
            }
            Ok((
                format!("{base}/models/{model}:streamGenerateContent?alt=sse"),
                body,
            ))
        }
        "openai" | "compatible" | "ollama" | "lmstudio" => {
            let instructions = instructions(request);
            let mut messages = Vec::with_capacity(request.messages.len() + 1);
            if !instructions.is_empty() {
                messages.push(json!({"role": "system", "content": instructions}));
            }
            messages.extend(
                request
                    .messages
                    .iter()
                    .map(|message| json!({"role": message.role, "content": message.text})),
            );
            let mut body = json!({"model": profile.model, "messages": messages, "stream": true, "stream_options": {"include_usage": true}});
            if profile.provider == "openai" {
                body["max_completion_tokens"] = json!(request.max_tokens);
                if !request.cache_key.is_empty() {
                    body["prompt_cache_key"] = json!(request.cache_key);
                }
            } else {
                body["max_tokens"] = json!(request.max_tokens);
                if !request.stop.is_empty() {
                    body["stop"] = json!(request.stop);
                }
            }
            if let Some(effort) = effort {
                body["reasoning_effort"] = json!(effort);
            }
            Ok((format!("{base}/chat/completions"), body))
        }
        _ => Err("Unbekannter API-Provider".into()),
    }
}

pub(super) struct Gate {
    stop: Vec<String>,
    limit: Option<usize>,
    pub text: String,
    emitted: usize,
    pub done: bool,
    pub truncated: bool,
}

fn floor_boundary(text: &str, mut index: usize) -> usize {
    index = index.min(text.len());
    while !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

impl Gate {
    pub(super) fn new(stop: &[String], limit: Option<usize>) -> Self {
        Self {
            stop: stop.to_vec(),
            limit,
            text: String::new(),
            emitted: 0,
            done: false,
            truncated: false,
        }
    }

    pub(super) fn push(&mut self, delta: &str) -> String {
        if self.done || delta.is_empty() {
            return String::new();
        }
        self.text.push_str(delta);
        let from = self.emitted;
        let found = self
            .stop
            .iter()
            .filter_map(|stop| self.text[from..].find(stop.as_str()))
            .min();
        if let Some(position) = found {
            self.text.truncate(from + position);
            self.done = true;
            return self.flush();
        }
        if let Some(limit) = self.limit.filter(|limit| self.text.len() > *limit) {
            let end = floor_boundary(&self.text, limit).max(self.emitted);
            self.text.truncate(end);
            self.done = true;
            self.truncated = true;
            return self.flush();
        }
        let hold = self
            .stop
            .iter()
            .map(String::len)
            .max()
            .unwrap_or(0)
            .saturating_sub(1);
        let end =
            floor_boundary(&self.text, self.text.len().saturating_sub(hold)).max(self.emitted);
        let out = self.text[self.emitted..end].to_string();
        self.emitted = end;
        out
    }

    pub(super) fn flush(&mut self) -> String {
        let out = self.text[self.emitted..].to_string();
        self.emitted = self.text.len();
        out
    }
}

pub(super) struct Sink {
    pub channel: Channel<Event>,
    pub state: Arc<AiState>,
    pub key: String,
}

impl Sink {
    pub(super) fn emit(&self, kind: &str, data: Value) {
        if self
            .channel
            .send(Event {
                kind: kind.into(),
                data,
            })
            .is_err()
        {
            if let Ok(completions) = self.state.completions.lock() {
                if let Some(cancel) = completions.get(&self.key) {
                    let _ = cancel.send(true);
                }
            }
        }
    }

    fn text(&self, delta: String) {
        if !delta.is_empty() {
            self.emit("text", json!({"delta": delta}));
        }
    }
}

pub(super) struct Slot {
    state: Arc<AiState>,
    pub key: String,
}

impl Drop for Slot {
    fn drop(&mut self) {
        if let Ok(mut completions) = self.state.completions.lock() {
            completions.remove(&self.key);
        }
    }
}

pub(super) fn register(
    state: &Arc<AiState>,
    window: &str,
    run_id: &str,
) -> Result<(Slot, watch::Receiver<bool>), String> {
    let key = format!("{window}:{run_id}");
    let prefix = format!("{window}:");
    let mut completions = state
        .completions
        .lock()
        .map_err(|_| "KI-Anfrage nicht verfügbar")?;
    if let Some(existing) = completions.get(&key) {
        if *existing.borrow() {
            completions.remove(&key);
            return Err("Abgebrochen".into());
        }
        return Err("Diese KI-Anfrage läuft bereits".into());
    }
    if completions
        .iter()
        .filter(|(existing, cancel)| existing.starts_with(&prefix) && !*cancel.borrow())
        .count()
        >= MAX_PARALLEL
    {
        return Err("Zu viele parallele KI-Anfragen im Editor".into());
    }
    let (cancel, cancelled) = watch::channel(false);
    completions.insert(key.clone(), cancel);
    Ok((
        Slot {
            state: state.clone(),
            key,
        },
        cancelled,
    ))
}

const MAX_EARLY_CANCELS: usize = 64;

pub(super) fn cancel_run(completions: &mut HashMap<String, watch::Sender<bool>>, key: String) {
    if let Some(cancel) = completions.get(&key) {
        cancel.send_replace(true);
        return;
    }
    let early: Vec<String> = completions
        .iter()
        .filter(|(_, cancel)| *cancel.borrow() && cancel.receiver_count() == 0)
        .map(|(key, _)| key.clone())
        .collect();
    if early.len() >= MAX_EARLY_CANCELS {
        for stale in early {
            completions.remove(&stale);
        }
    }
    completions.insert(key, watch::channel(true).0);
}

async fn cancellation(cancelled: &mut watch::Receiver<bool>) {
    loop {
        if *cancelled.borrow_and_update() {
            return;
        }
        if cancelled.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

pub(super) async fn drive(
    request: &CompleteRequest,
    sink: &Sink,
    mut cancelled: watch::Receiver<bool>,
) -> Result<Value, String> {
    tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(120), execute(request, sink)) => {
            result.map_err(|_| "KI-Anfrage im Editor überschreitet 120 Sekunden".to_string())?
        }
        _ = cancellation(&mut cancelled) => Err("Abgebrochen".into()),
    }
}

async fn execute(request: &CompleteRequest, sink: &Sink) -> Result<Value, String> {
    match request.profile.provider.as_str() {
        "claude" => claude(request, sink).await,
        "codex" => codex(request, sink).await,
        provider if super::is_cli(provider) => Err(UNSUPPORTED.into()),
        _ => api(request, sink).await,
    }
}

fn frame_delta(bytes: &[u8], provider: &str, result: &mut StreamResult) -> Result<String, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Ungültiger UTF-8-Stream")?;
    let data = text
        .lines()
        .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() || data == "[DONE]" {
        return Ok(String::new());
    }
    let value: Value = serde_json::from_str(&data).map_err(|_| "Ungültiger Provider-Stream")?;
    result.feed(provider, &value)
}

async fn api(request: &CompleteRequest, sink: &Sink) -> Result<Value, String> {
    let key = byok::key(&request.profile).await?;
    let client = integrations::client()?;
    let mut profile = request.profile.clone();
    if profile.model.trim().is_empty() {
        profile.model = byok::default_model(&profile).await?;
        sink.emit("metadata", json!({"model": profile.model}));
    }
    let (url, body) = complete_payload(&profile, request)?;
    let response = byok::auth(client.post(url).json(&body), &profile, key.as_deref())
        .send()
        .await
        .map_err(|_| "Provider nicht erreichbar. Netzwerk und API-Endpunkt prüfen.")?;
    if !response.status().is_success() {
        return Err(format!(
            "Provider: HTTP {}. Anmeldung, Modell und Kontingent prüfen.",
            response.status().as_u16()
        ));
    }
    if !response
        .headers()
        .get("Content-Type")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/event-stream"))
    {
        return Err("Provider unterstützt diesen Streaming-Endpunkt nicht".into());
    }
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    let mut result = StreamResult::truncatable();
    let mut gate = Gate::new(&request.stop, None);
    let mut total = 0;
    'stream: while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Provider-Stream unterbrochen")?;
        total += chunk.len();
        if total > MAX_STREAM {
            return Err("Provider-Stream überschreitet 4 MB".into());
        }
        buffer.extend_from_slice(&chunk);
        while let Some(bytes) = byok::frame(&mut buffer) {
            let delta = frame_delta(&bytes, &profile.provider, &mut result)?;
            sink.text(gate.push(&delta));
            if gate.done {
                break 'stream;
            }
        }
    }
    if !gate.done && !buffer.is_empty() {
        let delta = frame_delta(&buffer, &profile.provider, &mut result)?;
        sink.text(gate.push(&delta));
    }
    if !gate.done && !result.complete {
        return Err("Provider-Stream wurde vor dem Abschluss unterbrochen".into());
    }
    sink.text(gate.flush());
    if result.usage.is_object() {
        sink.emit("usage", json!({"usage": result.usage}));
    }
    Ok(
        json!({"text": gate.text, "truncated": result.truncated || gate.truncated, "model": profile.model}),
    )
}

fn workspace() -> Result<std::path::PathBuf, String> {
    let path = crate::mcp::config::config_dir().join("ai-workspace");
    std::fs::create_dir_all(&path).map_err(|_| "KI-Arbeitsordner konnte nicht erstellt werden")?;
    Ok(path)
}

pub(super) fn claude_args(profile: &Profile, system: &str, file: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = [
        "--print",
        "--input-format",
        "text",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--setting-sources=",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    match file {
        Some(path) => args.extend(["--system-prompt-file".into(), path.into()]),
        None => args.extend(["--system-prompt".into(), system.into()]),
    }
    if !profile.model.is_empty() {
        args.extend(["--model".into(), profile.model.clone()]);
    }
    if !profile.effort.is_empty() {
        args.extend(["--effort".into(), profile.effort.clone()]);
    }
    args
}

pub(super) fn codex_args(profile: &Profile, instructions: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = [
        "exec",
        "--json",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
        "-c",
        "project_doc_max_bytes=0",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    if let Some(instructions) = instructions.filter(|text| !text.is_empty()) {
        args.extend([
            "-c".into(),
            format!(
                "developer_instructions={}",
                serde_json::to_string(instructions).unwrap_or_default()
            ),
        ]);
    }
    if !profile.model.is_empty() {
        args.extend(["-m".into(), profile.model.clone()]);
    }
    if !profile.effort.is_empty() {
        args.extend([
            "-c".into(),
            format!("model_reasoning_effort={}", profile.effort),
        ]);
    }
    args.push("-".into());
    args
}

pub(super) fn codex_prompt(request: &CompleteRequest, inline: bool) -> String {
    let conversation = transcript(request);
    let instructions = instructions(request);
    if inline || instructions.is_empty() {
        conversation
    } else {
        format!("Instructions:\n{instructions}\n\nConversation:\n{conversation}")
    }
}

#[derive(Default)]
pub(super) struct CliStream {
    pub partial: bool,
    pub model: String,
    pub usage: Option<Value>,
    pub result: Option<String>,
    pub finished: bool,
    pub error: Option<String>,
    pub messages: usize,
}

pub(super) fn claude_event(event: &Value, state: &mut CliStream) -> Option<String> {
    if let Some(text) = super::cli::delta(event) {
        state.partial = true;
        return Some(text);
    }
    match event["type"].as_str().unwrap_or("") {
        "system" if event["subtype"] == "init" => {
            if let Some(model) = event["model"].as_str() {
                state.model = model.into();
            }
            None
        }
        "assistant" => {
            let partial = std::mem::take(&mut state.partial);
            if partial {
                return None;
            }
            let text: String = event["message"]["content"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|block| block["type"] == "text")
                .filter_map(|block| block["text"].as_str())
                .collect();
            (!text.is_empty()).then_some(text)
        }
        "result" => {
            state.usage = Some(
                json!({"usage": event["usage"], "modelUsage": event["modelUsage"], "total_cost_usd": event["total_cost_usd"]}),
            );
            state.result = event["result"].as_str().map(str::to_string);
            state.finished = true;
            if event["is_error"] == true {
                state.error = Some(
                    "Claude Code konnte die Anfrage nicht abschließen. Anmeldung und Kontingent prüfen."
                        .into(),
                );
            }
            None
        }
        _ => None,
    }
}

pub(super) fn codex_event(event: &Value, state: &mut CliStream) -> Option<String> {
    match event["type"].as_str().unwrap_or("") {
        "item.completed" if event["item"]["type"] == "agent_message" => {
            let text = event["item"]["text"].as_str()?;
            let separator = if state.messages > 0 { "\n\n" } else { "" };
            state.messages += 1;
            Some(format!("{separator}{text}"))
        }
        "turn.completed" => {
            let usage = &event["usage"];
            state.usage = Some(json!({"usage": {
                "prompt_tokens": usage["input_tokens"],
                "completion_tokens": usage["output_tokens"],
                "prompt_tokens_details": {"cached_tokens": usage["cached_input_tokens"]},
                "completion_tokens_details": {"reasoning_tokens": usage["reasoning_output_tokens"]},
            }}));
            state.finished = true;
            None
        }
        "turn.failed" => {
            state.finished = true;
            state.error = Some(
                "Codex konnte die Anfrage nicht abschließen. Modell, Anmeldung und Kontingent prüfen."
                    .into(),
            );
            None
        }
        _ => None,
    }
}

async fn cli_stream(
    mut command: tokio::process::Command,
    prompt: String,
    request: &CompleteRequest,
    sink: &Sink,
    parse: fn(&Value, &mut CliStream) -> Option<String>,
    name: &str,
) -> Result<Value, String> {
    command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|_| format!("{name} konnte nicht gestartet werden. Installation prüfen."))?;
    let mut stdin = child.stdin.take().ok_or("CLI-Eingabe nicht verfügbar")?;
    let writer = tokio::spawn(async move {
        let _ = stdin.write_all(prompt.as_bytes()).await;
        let _ = stdin.shutdown().await;
    });
    let stdout = child.stdout.take().ok_or("CLI-Ausgabe nicht verfügbar")?;
    let mut reader = tokio::io::BufReader::new(stdout);
    let mut gate = Gate::new(&request.stop, Some(request.max_tokens as usize * 8));
    let mut state = CliStream::default();
    let mut announced = !request.profile.model.is_empty();
    let mut line = String::new();
    let mut total = 0;
    while !state.finished && !gate.done {
        line.clear();
        let read = reader
            .read_line(&mut line)
            .await
            .map_err(|_| format!("{name}-Ausgabe unterbrochen"))?;
        if read == 0 {
            writer.abort();
            return Err(format!(
                "{name} wurde ohne Ergebnis beendet. Anmeldung und CLI-Version prüfen."
            ));
        }
        total += read;
        if total > MAX_STREAM {
            return Err(format!("{name}-Ausgabe überschreitet 4 MB"));
        }
        let Ok(event) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if let Some(delta) = parse(&event, &mut state) {
            sink.text(gate.push(&delta));
        }
        if !announced && !state.model.is_empty() {
            announced = true;
            sink.emit("metadata", json!({"model": state.model}));
        }
    }
    writer.abort();
    if let Some(error) = state.error {
        return Err(error);
    }
    if gate.text.is_empty() && !gate.done {
        if let Some(result) = state.result.take() {
            sink.text(gate.push(&result));
        }
    }
    sink.text(gate.flush());
    if let Some(usage) = state.usage {
        sink.emit("usage", usage);
    }
    let model = if request.profile.model.is_empty() {
        state.model
    } else {
        request.profile.model.clone()
    };
    Ok(json!({"text": gate.text, "truncated": gate.truncated, "model": model}))
}

async fn claude(request: &CompleteRequest, sink: &Sink) -> Result<Value, String> {
    if !request.profile.effort.is_empty() {
        byok::valid_effort(&request.profile.effort)?;
    }
    let cwd = workspace()?;
    let system = instructions(request);
    let file = if system.len() > INLINE_LIMIT {
        let mut file = tempfile::Builder::new()
            .prefix("l8db-editor-")
            .suffix(".txt")
            .tempfile_in(&cwd)
            .map_err(|_| "Systemprompt konnte nicht vorbereitet werden")?;
        std::io::Write::write_all(&mut file, system.as_bytes())
            .map_err(|_| "Systemprompt konnte nicht vorbereitet werden")?;
        Some(file)
    } else {
        None
    };
    let path = file
        .as_ref()
        .map(|file| file.path().to_string_lossy().into_owned());
    let mut command = super::command(&request.profile)?;
    command
        .current_dir(&cwd)
        .args(claude_args(&request.profile, &system, path.as_deref()));
    let result = cli_stream(
        command,
        transcript(request),
        request,
        sink,
        claude_event,
        "Claude Code",
    )
    .await;
    drop(file);
    result
}

async fn codex(request: &CompleteRequest, sink: &Sink) -> Result<Value, String> {
    if !request.profile.effort.is_empty() {
        byok::valid_effort(&request.profile.effort)?;
    }
    let cwd = workspace()?;
    let system = instructions(request);
    let inline = system.len() <= INLINE_LIMIT;
    let mut command = super::command(&request.profile)?;
    command.current_dir(&cwd).args(codex_args(
        &request.profile,
        inline.then_some(system.as_str()),
    ));
    cli_stream(
        command,
        codex_prompt(request, inline),
        request,
        sink,
        codex_event,
        "Codex",
    )
    .await
}

#[tauri::command]
pub async fn ai_complete(
    window: tauri::Window,
    state: tauri::State<'_, Arc<AiState>>,
    request: CompleteRequest,
    events: Channel<Event>,
) -> Result<Value, String> {
    let request = validate(request)?;
    let (slot, cancelled) = register(state.inner(), window.label(), &request.run_id)?;
    let sink = Sink {
        channel: events,
        state: state.inner().clone(),
        key: slot.key.clone(),
    };
    let result = drive(&request, &sink, cancelled).await;
    drop(slot);
    result
}

#[tauri::command]
pub fn ai_complete_cancel(
    window: tauri::Window,
    state: tauri::State<'_, Arc<AiState>>,
    run_id: String,
) -> Result<(), String> {
    let mut completions = state
        .completions
        .lock()
        .map_err(|_| "KI-Anfrage nicht verfügbar")?;
    cancel_run(&mut completions, format!("{}:{run_id}", window.label()));
    Ok(())
}

#[cfg(test)]
#[path = "complete_tests.rs"]
mod tests;
