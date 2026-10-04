use super::{
    integrations::{self, External},
    runtime::Run,
    types::{Profile, RunRequest},
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;

pub async fn limited_body(response: reqwest::Response, limit: usize) -> Result<String, String> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        bytes.extend_from_slice(&chunk.map_err(|_| "HTTP-Antwort unterbrochen")?);
        if bytes.len() > limit {
            return Err("HTTP-Antwort überschreitet das Größenlimit".into());
        }
    }
    String::from_utf8(bytes).map_err(|_| "HTTP-Antwort ist kein UTF-8".into())
}

fn base(profile: &Profile) -> Result<String, String> {
    let endpoint = if !profile.endpoint.trim().is_empty() {
        profile.endpoint.trim()
    } else {
        match profile.provider.as_str() {
            "openai" => "https://api.openai.com/v1",
            "anthropic" => "https://api.anthropic.com/v1",
            "google" => "https://generativelanguage.googleapis.com/v1beta",
            "ollama" => "http://localhost:11434/v1",
            "lmstudio" => "http://localhost:1234/v1",
            "compatible" => return Err("API-Endpunkt fehlt".into()),
            _ => return Err("Unbekannter API-Provider".into()),
        }
    };
    Ok(integrations::endpoint(endpoint)?
        .to_string()
        .trim_end_matches('/')
        .into())
}

pub fn keyless(provider: &str) -> bool {
    matches!(provider, "compatible" | "ollama" | "lmstudio")
}

pub fn local(provider: &str) -> bool {
    matches!(provider, "ollama" | "lmstudio")
}

pub async fn reachable(profile: &Profile) -> bool {
    let Ok(base) = base(profile) else {
        return false;
    };
    let Ok(client) = integrations::client() else {
        return false;
    };
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        client.get(format!("{base}/models")).send(),
    )
    .await
    .is_ok_and(|response| response.is_ok_and(|response| response.status().is_success()))
}

pub fn pick_model(provider: &str, ids: &[String]) -> Option<String> {
    const SKIP: [&str; 18] = [
        "embed",
        "audio",
        "realtime",
        "transcribe",
        "tts",
        "image",
        "dall-e",
        "whisper",
        "moderation",
        "search",
        "instruct",
        "babbage",
        "davinci",
        "computer-use",
        "live",
        "lite",
        "nano",
        "guard",
    ];
    let usable: Vec<&String> = ids
        .iter()
        .filter(|id| {
            let id = id.to_ascii_lowercase();
            if local(provider) {
                !id.contains("embed")
            } else {
                !SKIP.iter().any(|word| id.contains(word))
            }
        })
        .collect();
    let preferred: &[(&str, &str)] = match provider {
        "openai" => &[("gpt-", "mini"), ("gpt-", "")],
        "anthropic" => &[("sonnet", ""), ("opus", ""), ("haiku", "")],
        "google" => &[("gemini", "flash"), ("gemini", "pro")],
        _ => &[],
    };
    for (first, second) in preferred {
        if let Some(id) = usable
            .iter()
            .filter(|id| id.contains(first) && id.contains(second))
            .max()
        {
            return Some(id.to_string());
        }
    }
    usable.first().map(|id| id.to_string())
}

async fn default_model(profile: &Profile) -> Result<String, String> {
    let list = models(profile).await?;
    let ids: Vec<String> = list["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| model["id"].as_str().map(str::to_string))
        .collect();
    pick_model(&profile.provider, &ids).ok_or_else(|| {
        if local(&profile.provider) {
            "Kein Modell geladen. Im lokalen Server zuerst ein Modell laden.".into()
        } else {
            "Kein passendes Modell gefunden. Modell im Auswahlmenü wählen.".into()
        }
    })
}

async fn key(profile: &Profile) -> Result<Option<String>, String> {
    let key = crate::db::secrets::load_secret(format!("ai:{}:key", profile.id)).await?;
    if key.is_none() && !keyless(&profile.provider) {
        return Err("API-Schlüssel fehlt. Im Provider speichern.".into());
    }
    Ok(key)
}

fn auth(
    builder: reqwest::RequestBuilder,
    profile: &Profile,
    key: Option<&str>,
) -> reqwest::RequestBuilder {
    match profile.provider.as_str() {
        "anthropic" => {
            let builder = builder.header("anthropic-version", "2023-06-01");
            if let Some(key) = key {
                builder.header("x-api-key", key)
            } else {
                builder
            }
        }
        "google" => {
            if let Some(key) = key {
                builder.header("x-goog-api-key", key)
            } else {
                builder
            }
        }
        _ => {
            if let Some(key) = key {
                builder.bearer_auth(key)
            } else {
                builder
            }
        }
    }
}

pub async fn models(profile: &Profile) -> Result<Value, String> {
    let base = base(profile)?;
    let key = key(profile).await?;
    let client = integrations::client()?;
    let response = auth(
        client.get(format!("{base}/models")),
        profile,
        key.as_deref(),
    )
    .send()
    .await
    .map_err(|_| "Modellliste nicht erreichbar")?;
    if !response.status().is_success() {
        return Err(format!(
            "Modellliste: HTTP {}. Schlüssel und Endpunkt prüfen.",
            response.status().as_u16()
        ));
    }
    let body = limited_body(response, 2_097_152).await?;
    let value: Value = serde_json::from_str(&body).map_err(|_| "Ungültige Modellliste")?;
    let items = if profile.provider == "google" {
        &value["models"]
    } else {
        &value["data"]
    };
    let models: Vec<Value> = items.as_array().ok_or("Modellliste fehlt")?.iter().filter(|item| profile.provider != "google" || item["supportedGenerationMethods"].as_array().is_some_and(|methods| methods.iter().any(|method| method == "generateContent"))).filter_map(|item| {
        let id = item["id"].as_str().or_else(|| item["name"].as_str())?.trim_start_matches("models/");
        Some(json!({"id": id, "name": item["displayName"].as_str().or_else(|| item["display_name"].as_str()).unwrap_or(id)}))
    }).collect();
    Ok(json!({"models": models}))
}

#[derive(Default, Clone)]
pub(super) struct Call {
    pub id: String,
    pub name: String,
    pub arguments: String,
    pub signature: Option<Value>,
}

#[derive(Default)]
pub(super) struct StreamResult {
    pub text: String,
    pub calls: BTreeMap<usize, Call>,
    pub complete: bool,
    pub round: usize,
    usage: Value,
    anthropic_blocks: BTreeMap<usize, Value>,
}

impl StreamResult {
    pub(super) fn feed(&mut self, provider: &str, value: &Value) -> Result<String, String> {
        if let Some(usage) = value
            .get("usage")
            .or_else(|| value.get("usageMetadata"))
            .or_else(|| value["message"].get("usage"))
            .and_then(Value::as_object)
        {
            if !self.usage.is_object() {
                self.usage = json!({});
            }
            if let Some(previous) = self.usage.as_object_mut() {
                previous.extend(usage.clone());
            }
        }
        if value.get("error").is_some() || value["type"] == "error" {
            return Err(
                "Provider meldet einen Fehler. Modell, Kontingent und Schlüssel prüfen.".into(),
            );
        }
        let mut delta = String::new();
        match provider {
            "anthropic" => {
                let index = value["index"].as_u64().unwrap_or(0) as usize;
                if value["type"] == "content_block_start" {
                    self.anthropic_blocks
                        .insert(index, value["content_block"].clone());
                }
                if value["type"] == "content_block_delta" {
                    if let Some(block) = self.anthropic_blocks.get_mut(&index) {
                        for field in ["text", "thinking", "signature"] {
                            if let Some(fragment) = value["delta"][field].as_str() {
                                let text =
                                    format!("{}{fragment}", block[field].as_str().unwrap_or(""));
                                block[field] = json!(text);
                            }
                        }
                    }
                }
                if value["type"] == "message_delta" {
                    if let Some(reason) = value["delta"]["stop_reason"].as_str() {
                        if !matches!(reason, "end_turn" | "tool_use") {
                            return Err(
                                "Anthropic hat die Ausgabe nicht vollständig abgeschlossen".into(),
                            );
                        }
                    }
                }
                if value["type"] == "message_stop" {
                    self.complete = true;
                }
                match value["type"].as_str().unwrap_or("") {
                    "content_block_start" if value["content_block"]["type"] == "tool_use" => {
                        let index = value["index"].as_u64().unwrap_or(0) as usize;
                        self.calls.insert(
                            index,
                            Call {
                                id: value["content_block"]["id"].as_str().unwrap_or("").into(),
                                name: value["content_block"]["name"].as_str().unwrap_or("").into(),
                                ..Call::default()
                            },
                        );
                    }
                    "content_block_delta" => {
                        if let Some(text) = value["delta"]["text"].as_str() {
                            delta.push_str(text);
                        }
                        if let Some(partial) = value["delta"]["partial_json"].as_str() {
                            self.calls
                                .entry(value["index"].as_u64().unwrap_or(0) as usize)
                                .or_default()
                                .arguments
                                .push_str(partial);
                        }
                    }
                    _ => {}
                }
            }
            "google" => {
                if let Some(reason) = value["candidates"][0]["finishReason"].as_str() {
                    if reason != "STOP" {
                        return Err("Gemini hat die Ausgabe nicht vollständig abgeschlossen".into());
                    }
                    self.complete = true;
                }
                for part in value["candidates"][0]["content"]["parts"]
                    .as_array()
                    .into_iter()
                    .flatten()
                {
                    if part["thought"] == true {
                        continue;
                    }
                    if let Some(text) = part["text"].as_str() {
                        delta.push_str(text);
                    }
                    if let Some(function) = part.get("functionCall") {
                        let index = self.calls.len();
                        self.calls.insert(
                            index,
                            Call {
                                id: function["id"]
                                    .as_str()
                                    .map(str::to_string)
                                    .unwrap_or_else(super::new_id),
                                name: function["name"].as_str().unwrap_or("").into(),
                                arguments: function.get("args").unwrap_or(&json!({})).to_string(),
                                signature: part.get("thoughtSignature").cloned(),
                            },
                        );
                    }
                }
            }
            _ => {
                if let Some(reason) = value["choices"][0]["finish_reason"].as_str() {
                    if !matches!(reason, "stop" | "tool_calls") {
                        return Err(
                            "Provider hat die Ausgabe nicht vollständig abgeschlossen".into()
                        );
                    }
                    self.complete = true;
                }
                if let Some(text) = value["choices"][0]["delta"]["content"].as_str() {
                    delta.push_str(text);
                }
                for fragment in value["choices"][0]["delta"]["tool_calls"]
                    .as_array()
                    .into_iter()
                    .flatten()
                {
                    let call = self
                        .calls
                        .entry(fragment["index"].as_u64().unwrap_or(0) as usize)
                        .or_default();
                    if let Some(id) = fragment["id"].as_str() {
                        call.id.push_str(id);
                    }
                    if let Some(name) = fragment["function"]["name"].as_str() {
                        call.name.push_str(name);
                    }
                    if let Some(arguments) = fragment["function"]["arguments"].as_str() {
                        call.arguments.push_str(arguments);
                    }
                }
            }
        }
        self.text.push_str(&delta);
        if self.text.len() > 2_097_152
            || self.calls.len() > 32
            || self
                .calls
                .values()
                .any(|call| call.arguments.len() > 65_536)
        {
            return Err("Provider-Ausgabe überschreitet das Größenlimit".into());
        }
        Ok(delta)
    }
}

fn blocks(messages: &[Value], provider: &str) -> Vec<Value> {
    let mut result: Vec<Value> = Vec::new();
    for message in messages {
        let role = message["role"].as_str().unwrap_or("user");
        if role == "system" {
            continue;
        }
        let mut content = Vec::new();
        if role == "tool" {
            if provider == "anthropic" {
                content.push(json!({"type": "tool_result", "tool_use_id": message["tool_call_id"], "content": message["content"]}));
            } else {
                content.push(json!({"functionResponse": {"id": message["tool_call_id"], "name": message["name"], "response": {"result": message["content"]}}}));
            }
        } else {
            if provider == "anthropic" && message["nativeContent"].is_array() {
                let blocks = message["nativeContent"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                result.push(json!({"role": "assistant", "content": blocks}));
                continue;
            }
            if let Some(text) = message["content"].as_str().filter(|text| !text.is_empty()) {
                content.push(if provider == "anthropic" {
                    json!({"type": "text", "text": text})
                } else {
                    json!({"text": text})
                });
            }
            for call in message["tool_calls"].as_array().into_iter().flatten() {
                let args: Value =
                    serde_json::from_str(call["function"]["arguments"].as_str().unwrap_or("{}"))
                        .unwrap_or(json!({}));
                if provider == "anthropic" {
                    content.push(json!({"type": "tool_use", "id": call["id"], "name": call["function"]["name"], "input": args}));
                } else {
                    let mut part = json!({"functionCall": {"id": call["id"], "name": call["function"]["name"], "args": args}});
                    if let Some(signature) = call.get("signature") {
                        part["thoughtSignature"] = signature.clone();
                    }
                    content.push(part);
                }
            }
        }
        let role = if role == "assistant" {
            if provider == "google" {
                "model"
            } else {
                "assistant"
            }
        } else {
            "user"
        };
        let field = if provider == "google" {
            "parts"
        } else {
            "content"
        };
        if result.last().is_some_and(|message| message["role"] == role) {
            if let Some(previous) = result
                .last_mut()
                .and_then(|message| message[field].as_array_mut())
            {
                previous.extend(content);
            }
        } else {
            result.push(json!({"role": role, field: content}));
        }
    }
    result
}

pub(super) fn payload(
    profile: &Profile,
    instructions: &str,
    messages: &[Value],
    tools: &[Value],
) -> Result<(String, Value), String> {
    let base = base(profile)?;
    if profile.model.trim().is_empty() {
        return Err("Ein Modell auswählen oder eingeben".into());
    }
    let mut result = match profile.provider.as_str() {
        "anthropic" => (
            format!("{base}/messages"),
            json!({"model": profile.model, "system": instructions, "messages": blocks(messages, "anthropic"), "max_tokens": 8192, "stream": true, "tools": tools.iter().map(|tool| json!({"name": tool["name"], "description": tool["description"], "input_schema": tool["inputSchema"]})).collect::<Vec<_>>() }),
        ),
        "google" => {
            let model = profile.model.trim_start_matches("models/");
            if !model.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
            }) {
                return Err("Ungültiger Gemini-Modellname".into());
            }
            (
                format!("{base}/models/{model}:streamGenerateContent?alt=sse"),
                json!({"systemInstruction": {"parts": [{"text": instructions}]}, "contents": blocks(messages, "google"), "tools": [{"functionDeclarations": tools.iter().map(|tool| json!({"name": tool["name"], "description": tool["description"], "parametersJsonSchema": tool["inputSchema"]})).collect::<Vec<_>>()}]}),
            )
        }
        _ => {
            let mut messages = messages.to_vec();
            for message in &mut messages {
                if message["role"] == "tool" {
                    if let Some(object) = message.as_object_mut() {
                        object.remove("name");
                    }
                }
            }
            messages.insert(0, json!({"role": "system", "content": instructions}));
            (
                format!("{base}/chat/completions"),
                json!({"model": profile.model, "messages": messages, "stream": true, "stream_options": {"include_usage": true}, "tools": tools.iter().map(|tool| json!({"type": "function", "function": {"name": tool["name"], "description": tool["description"], "parameters": tool["inputSchema"]}})).collect::<Vec<_>>() }),
            )
        }
    };
    if !profile.effort.is_empty() {
        if !matches!(
            profile.effort.as_str(),
            "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
        ) {
            return Err("Ungültige Reasoning-Stufe".into());
        }
        match profile.provider.as_str() {
            "anthropic" => {
                result.1["output_config"] = json!({"effort": profile.effort});
            }
            "google" => {
                result.1["generationConfig"] = json!({"thinkingConfig": {"thinkingLevel": profile.effort.to_ascii_uppercase()}});
            }
            _ => {
                result.1["reasoning_effort"] = json!(profile.effort);
            }
        }
    }
    Ok(result)
}

pub(super) fn frame(buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    let delimiter = buffer
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|index| (index, 2))
        .into_iter()
        .chain({
            buffer
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .map(|index| (index, 4))
        })
        .min_by_key(|delimiter| delimiter.0)?;
    Some(buffer.drain(..delimiter.0 + delimiter.1).collect())
}

pub(super) fn consume(
    bytes: &[u8],
    provider: &str,
    result: &mut StreamResult,
    run: &Run,
) -> Result<(), String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Ungültiger UTF-8-Stream")?;
    let data = text
        .lines()
        .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() || data == "[DONE]" {
        return Ok(());
    }
    let value: Value = serde_json::from_str(&data).map_err(|_| "Ungültiger Provider-Stream")?;
    let delta = result.feed(provider, &value)?;
    if !delta.is_empty() {
        run.emit("text", json!({"delta": delta}));
    }
    let mut citations = Vec::new();
    if provider == "anthropic" && value["delta"]["type"] == "citations_delta" {
        citations.push(value["delta"]["citation"].clone());
    }
    if provider == "google" {
        for chunk in value["candidates"][0]["groundingMetadata"]["groundingChunks"]
            .as_array()
            .into_iter()
            .flatten()
            .take(100)
        {
            if let Some(web) = chunk.get("web") {
                citations.push(json!({"url": web["uri"], "title": web["title"]}));
            }
        }
    }
    for annotation in value["choices"][0]["delta"]["annotations"]
        .as_array()
        .into_iter()
        .flatten()
        .take(100)
    {
        if annotation["type"] == "url_citation" {
            citations.push(annotation["url_citation"].clone());
        }
    }
    if !citations.is_empty() {
        run.emit("metadata", json!({"citations": citations}));
    }
    if result.usage.is_object() {
        run.emit(
            "usage",
            json!({"round": result.round, "usage": result.usage}),
        );
    }
    Ok(())
}

pub async fn run(
    request: &RunRequest,
    instructions: &str,
    server: &Arc<tokio::sync::Mutex<crate::mcp::server::Server>>,
    config: &crate::mcp::config::McpConfig,
    mut external: External,
    run: &Run,
) -> Result<(), String> {
    let key = key(&request.profile).await?;
    let client = integrations::client()?;
    let mut profile = request.profile.clone();
    if profile.model.trim().is_empty() {
        profile.model = default_model(&profile).await?;
        run.emit("metadata", json!({"model": profile.model}));
    }
    let profile = &profile;
    let mut messages: Vec<Value> = request
        .messages
        .iter()
        .map(|message| json!({"role": message.role, "content": message.text}))
        .collect();
    let mut tools = super::context::tool_definitions();
    tools.extend(external.tools.clone());
    for round in 1..=12 {
        let (url, body) = payload(profile, instructions, &messages, &tools)?;
        let response = auth(client.post(url).json(&body), profile, key.as_deref())
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
        let mut result = StreamResult {
            round,
            ..StreamResult::default()
        };
        let mut total = 0;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "Provider-Stream unterbrochen")?;
            total += chunk.len();
            if total > 4_194_304 {
                return Err("Provider-Stream überschreitet 4 MB".into());
            }
            buffer.extend_from_slice(&chunk);
            while let Some(bytes) = frame(&mut buffer) {
                consume(&bytes, &profile.provider, &mut result, run)?;
            }
        }
        if !buffer.is_empty() {
            consume(&buffer, &profile.provider, &mut result, run)?;
        }
        if !result.complete {
            return Err("Provider-Stream wurde vor dem Abschluss unterbrochen. Es wurden keine weiteren Tools ausgeführt.".into());
        }
        if result.calls.is_empty() {
            if result.text.is_empty() {
                return Err("Provider hat keine Antwort geliefert".into());
            }
            return Ok(());
        }
        for (index, call) in &result.calls {
            if let Some(block) = result.anthropic_blocks.get_mut(index) {
                block["input"] = serde_json::from_str(if call.arguments.is_empty() {
                    "{}"
                } else {
                    &call.arguments
                })
                .map_err(|_| "Provider lieferte ungültige Tool-Argumente")?;
            }
        }
        let native_content: Vec<Value> = result.anthropic_blocks.into_values().collect();
        let calls: Vec<Call> = result.calls.into_values().collect();
        let tool_calls: Vec<Value> = calls.iter().map(|call| { let mut value = json!({"id": call.id, "type": "function", "function": {"name": call.name, "arguments": if call.arguments.is_empty() { "{}" } else { &call.arguments }}}); if let Some(signature) = &call.signature { value["signature"] = signature.clone(); } value }).collect();
        let mut assistant =
            json!({"role": "assistant", "content": result.text, "tool_calls": tool_calls});
        if profile.provider == "anthropic" {
            assistant["nativeContent"] = json!(native_content);
        }
        if profile.provider != "google" {
            for call in assistant["tool_calls"].as_array_mut().into_iter().flatten() {
                if let Some(object) = call.as_object_mut() {
                    object.remove("signature");
                }
            }
        }
        messages.push(assistant);
        for call in calls {
            let arguments: Value = serde_json::from_str(if call.arguments.is_empty() {
                "{}"
            } else {
                &call.arguments
            })
            .map_err(|_| "Provider lieferte ungültige Tool-Argumente")?;
            let result = if call.name.starts_with("ext_") {
                external.call(&call.name, arguments, run).await
            } else {
                super::context::call(server, config, run, &call.name, arguments).await
            };
            messages.push(json!({"role": "tool", "tool_call_id": call.id, "name": call.name, "content": result.to_string()}));
        }
    }
    Err("Maximal 12 Tool-Runden erreicht. Mit einer neuen Nachricht fortsetzen.".into())
}
