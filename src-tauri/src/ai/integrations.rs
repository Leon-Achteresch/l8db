use super::{rpc::Rpc, runtime::Run, types::ExternalServer};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

pub fn endpoint(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw).map_err(|_| "Ungültiger API-Endpunkt")?;
    let local = matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
    );
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("Endpunkt muss HTTPS verwenden. HTTP ist nur lokal erlaubt.".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Zugangsdaten und Query-Parameter gehören nicht in die Endpunkt-URL".into());
    }
    Ok(url)
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(660))
        .build()
        .map_err(|_| "HTTP-Client nicht verfügbar".into())
}

enum Transport {
    Stdio(Rpc),
    Http {
        url: String,
        client: reqwest::Client,
        session: Option<String>,
        key: Option<String>,
    },
}

pub struct External {
    servers: Vec<Transport>,
    pub tools: Vec<Value>,
    routes: std::collections::HashMap<String, (usize, String)>,
}

async fn http_result(response: reqwest::Response) -> Result<Value, String> {
    let streaming = response
        .headers()
        .get("Content-Type")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/event-stream"));
    if !streaming {
        let body = super::byok::limited_body(response, 2_097_152).await?;
        let value: Value = serde_json::from_str(&body).map_err(|_| "Ungültige MCP-Antwort")?;
        return response_result(value);
    }
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    let mut total = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "MCP-Stream unterbrochen")?;
        total += chunk.len();
        if total > 2_097_152 {
            return Err("MCP-Antwort überschreitet das Größenlimit".into());
        }
        buffer.extend_from_slice(&chunk);
        while let Some(frame) = super::byok::frame(&mut buffer) {
            let text = std::str::from_utf8(&frame).map_err(|_| "Ungültiger MCP-Stream")?;
            let data = text
                .lines()
                .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
                .collect::<Vec<_>>()
                .join("\n");
            if data.is_empty() {
                continue;
            }
            let value: Value = serde_json::from_str(&data).map_err(|_| "Ungültige MCP-Antwort")?;
            if value["id"] == 1 {
                return response_result(value);
            }
        }
    }
    Err("MCP-Stream enthält keine abgeschlossene Antwort".into())
}

fn response_result(value: Value) -> Result<Value, String> {
    if value["jsonrpc"] != "2.0" || value["id"] != 1 {
        return Err("MCP-Antwort passt nicht zur Anfrage".into());
    }
    if value.get("error").is_some() {
        return Err("MCP-Server hat die Anfrage abgelehnt".into());
    }
    value
        .get("result")
        .cloned()
        .ok_or("MCP-Antwort enthält kein Ergebnis".into())
}

async fn request(transport: &mut Transport, method: &str, params: Value) -> Result<Value, String> {
    match transport {
        Transport::Stdio(rpc) => {
            let mut response = rpc.begin(method, params).await?;
            tokio::time::timeout(Duration::from_secs(660), async {
                loop {
                    tokio::select! {
                        result = &mut response => return result.map_err(|_| "MCP-Verbindung geschlossen")?,
                        event = rpc.events.recv() => {
                            let event = event.ok_or("MCP-Prozess beendet")?;
                            if let Some(id) = event.get("id") { rpc.send(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "Client capability unavailable"}})).await?; }
                        }
                    }
                }
            }).await.map_err(|_| "MCP-Anfrage hat das Zeitlimit überschritten")?
        }
        Transport::Http {
            url,
            client,
            session,
            key,
        } => {
            let mut builder = client
                .post(url.as_str())
                .header("Accept", "application/json, text/event-stream")
                .header("MCP-Protocol-Version", "2025-06-18")
                .json(&json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}));
            if let Some(session) = session {
                builder = builder.header("Mcp-Session-Id", session.as_str());
            }
            if let Some(key) = key {
                builder = builder.bearer_auth(key.as_str());
            }
            let response = builder
                .send()
                .await
                .map_err(|_| "MCP-Server nicht erreichbar")?;
            if !response.status().is_success() {
                return Err(format!(
                    "MCP-Server antwortet mit HTTP {}",
                    response.status().as_u16()
                ));
            }
            if let Some(id) = response
                .headers()
                .get("Mcp-Session-Id")
                .and_then(|value| value.to_str().ok())
            {
                *session = Some(id.to_string());
            }
            http_result(response).await
        }
    }
}

async fn initialized(transport: &mut Transport) -> Result<(), String> {
    let value = json!({"jsonrpc": "2.0", "method": "notifications/initialized"});
    match transport {
        Transport::Stdio(rpc) => rpc.send(value).await,
        Transport::Http {
            url,
            client,
            session,
            key,
        } => {
            let mut builder = client
                .post(url.as_str())
                .header("Accept", "application/json, text/event-stream")
                .header("MCP-Protocol-Version", "2025-06-18")
                .json(&value);
            if let Some(session) = session {
                builder = builder.header("Mcp-Session-Id", session.as_str());
            }
            if let Some(key) = key {
                builder = builder.bearer_auth(key.as_str());
            }
            let response = builder
                .send()
                .await
                .map_err(|_| "MCP-Initialisierung fehlgeschlagen")?;
            if !response.status().is_success() {
                return Err("MCP-Initialisierung abgelehnt".into());
            }
            Ok(())
        }
    }
}

pub async fn connect(
    servers: &[ExternalServer],
    cwd: &Path,
    run: &Run,
) -> Result<External, String> {
    let mut external = External {
        servers: Vec::new(),
        tools: Vec::new(),
        routes: std::collections::HashMap::new(),
    };
    for (index, server) in servers.iter().enumerate() {
        super::validate_id(&server.id)?;
        run.emit(
            "status",
            json!({"status": "connecting", "name": server.name}),
        );
        let mut transport = match server.transport.as_str() {
            "stdio" => {
                if server.command.trim().is_empty() {
                    return Err("MCP-Programm fehlt".into());
                }
                let mut command = tokio::process::Command::new(&server.command);
                command.args(&server.args).current_dir(cwd);
                Transport::Stdio(Rpc::spawn(&mut command)?)
            }
            "http" => Transport::Http {
                url: endpoint(&server.url)?.to_string(),
                client: client()?,
                session: None,
                key: crate::db::secrets::load_secret(format!("ai:mcp-{}:key", server.id)).await?,
            },
            _ => return Err("MCP-Transport muss Stdio oder HTTP sein".into()),
        };
        tokio::time::timeout(Duration::from_secs(30), request(&mut transport, "initialize", json!({"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "l8db-ai", "version": env!("CARGO_PKG_VERSION")}}))).await.map_err(|_| "MCP-Server antwortet nicht")??;
        initialized(&mut transport).await?;
        let mut cursor: Option<String> = None;
        for _ in 0..20 {
            let result = tokio::time::timeout(
                Duration::from_secs(30),
                request(
                    &mut transport,
                    "tools/list",
                    cursor
                        .as_ref()
                        .map(|cursor| json!({"cursor": cursor}))
                        .unwrap_or(json!({})),
                ),
            )
            .await
            .map_err(|_| "MCP-Toolliste antwortet nicht")??;
            for tool in result["tools"].as_array().ok_or("MCP-Toolliste fehlt")? {
                let original = tool["name"].as_str().ok_or("MCP-Toolname fehlt")?;
                let name = format!(
                    "ext_{index}_{}",
                    original
                        .chars()
                        .map(
                            |character| if character.is_ascii_alphanumeric() || character == '_' {
                                character
                            } else {
                                '_'
                            }
                        )
                        .take(48)
                        .collect::<String>()
                );
                if external
                    .routes
                    .insert(name.clone(), (index, original.into()))
                    .is_some()
                {
                    return Err("MCP-Toolnamen sind nicht eindeutig".into());
                }
                external.tools.push(json!({"name": name, "description": format!("{}: {}", server.name, tool["description"].as_str().unwrap_or(original)), "inputSchema": tool["inputSchema"]}));
                if external.tools.len() > 128 {
                    return Err("Mehr als 128 externe Tools. Weniger MCPs auswählen.".into());
                }
            }
            cursor = result["nextCursor"].as_str().map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }
        external.servers.push(transport);
    }
    Ok(external)
}

impl External {
    pub async fn call(&mut self, name: &str, args: Value, run: &Run) -> Value {
        let Some((index, original)) = self.routes.get(name).cloned() else {
            return json!({"content": [{"type": "text", "text": "Unbekanntes externes Tool"}], "isError": true});
        };
        if !run
            .approve(&format!("Externes Tool: {original}"), args.clone())
            .await
            .unwrap_or(false)
        {
            return json!({"content": [{"type": "text", "text": "Tool-Aufruf abgelehnt"}], "isError": true});
        }
        let id = super::new_id();
        run.emit(
            "tool",
            json!({"id": id, "name": name, "arguments": args, "status": "running"}),
        );
        let result = request(
            &mut self.servers[index],
            "tools/call",
            json!({"name": original, "arguments": args}),
        )
        .await
        .unwrap_or_else(
            |error| json!({"content": [{"type": "text", "text": error}], "isError": true}),
        );
        run.emit("tool", json!({"id": id, "name": name, "result": result, "status": if result["isError"] == true { "error" } else { "completed" }}));
        result
    }
}
