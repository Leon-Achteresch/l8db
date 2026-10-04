use super::runtime::Run;
use crate::mcp::{config::McpConfig, server::Server};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

#[derive(Serialize, Deserialize)]
struct Address {
    port: u16,
    token: String,
}

pub struct Bridge {
    pub file: tempfile::NamedTempFile,
    task: tokio::task::JoinHandle<()>,
}

async fn dispatch(
    request: Value,
    server: &tokio::sync::Mutex<Server>,
    config: &McpConfig,
    run: &Run,
    external: &tokio::sync::Mutex<super::integrations::External>,
) -> Value {
    let id = request["id"].clone();
    let result = match request["method"].as_str().unwrap_or("") {
        "initialize" => {
            json!({"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "l8db_ai", "version": env!("CARGO_PKG_VERSION")}, "instructions": format!("Use l8db_ai tools for database access and respect their policies. Only selected connections are available; the first is the primary database. Current connections: {}", config.connections.iter().map(|connection| json!({"id": connection.id, "name": connection.name, "kind": connection.kind, "database": connection.database, "schemas": connection.schemas})).collect::<Vec<_>>().iter().map(Value::to_string).collect::<Vec<_>>().join(", "))})
        }
        "tools/list" => {
            let mut tools = super::context::tool_definitions();
            tools.extend(external.lock().await.tools.clone());
            json!({"tools": tools})
        }
        "tools/call" => {
            let name = request["params"]["name"].as_str().unwrap_or("");
            let args = request["params"]["arguments"].clone();
            if name.starts_with("ext_") {
                external.lock().await.call(name, args, run).await
            } else {
                super::context::call(server, config, run, name, args).await
            }
        }
        "ping" => json!({}),
        "resources/list" => json!({"resources": []}),
        "prompts/list" => json!({"prompts": []}),
        _ => {
            return json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "Method not found"}})
        }
    };
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

async fn handle(
    stream: TcpStream,
    token: &str,
    server: &tokio::sync::Mutex<Server>,
    config: &McpConfig,
    run: &Run,
    external: &tokio::sync::Mutex<super::integrations::External>,
) -> Result<(), String> {
    let mut reader = BufReader::new(stream);
    let mut first = String::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        (&mut reader).take(8193).read_line(&mut first),
    )
    .await
    .map_err(|_| "Bridge-Handshake abgelaufen")?
    .map_err(|_| "Bridge geschlossen")?;
    if first.len() > 8192 {
        return Err("Ungültige Bridge-Anfrage".into());
    }
    if first.trim() != "POST /rpc HTTP/1.1" {
        return Err("Ungültige Bridge-Anfrage".into());
    }
    let mut authorized = false;
    let mut length = None;
    let mut header_size = first.len();
    loop {
        let mut line = String::new();
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            (&mut reader).take(8193).read_line(&mut line),
        )
        .await
        .map_err(|_| "Bridge-Handshake abgelaufen")?
        .map_err(|_| "Bridge geschlossen")?;
        header_size += line.len();
        if header_size > 8192 || line.is_empty() {
            return Err("Ungültige Bridge-Header".into());
        }
        if line == "\r\n" {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            match key.to_ascii_lowercase().as_str() {
                "authorization" => authorized = value.trim() == format!("Bearer {token}"),
                "content-length" => length = value.trim().parse::<usize>().ok(),
                _ => {}
            }
        }
    }
    let length = length
        .filter(|length| *length <= 1_048_576)
        .ok_or("Ungültige Bridge-Länge")?;
    if !authorized {
        return Err("Bridge-Zugriff abgelehnt".into());
    }
    let mut bytes = vec![0; length];
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        reader.read_exact(&mut bytes),
    )
    .await
    .map_err(|_| "Bridge-Handshake abgelaufen")?
    .map_err(|_| "Bridge geschlossen")?;
    let request = serde_json::from_slice(&bytes).map_err(|_| "Ungültiges JSON")?;
    let result = dispatch(request, server, config, run, external).await;
    let body = serde_json::to_vec(&result).map_err(|_| "Ungültige Bridge-Antwort")?;
    let mut stream = reader.into_inner();
    stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.map_err(|_| "Bridge geschlossen")?;
    stream
        .write_all(&body)
        .await
        .map_err(|_| "Bridge geschlossen".into())
}

impl Bridge {
    pub async fn start(
        server: Arc<tokio::sync::Mutex<Server>>,
        config: McpConfig,
        run: Arc<Run>,
        external: super::integrations::External,
    ) -> Result<Self, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|_| "Lokale MCP-Bridge konnte nicht starten")?;
        let address = Address {
            port: listener
                .local_addr()
                .map_err(|_| "Bridge-Adresse fehlt")?
                .port(),
            token: format!("{}{}", super::new_id(), super::new_id()),
        };
        let mut file = tempfile::NamedTempFile::new()
            .map_err(|_| "Bridge-Datei konnte nicht erstellt werden")?;
        crate::mcp::config::restrict(file.path());
        serde_json::to_writer(file.as_file_mut(), &address)
            .map_err(|_| "Bridge-Datei konnte nicht gespeichert werden")?;
        let external = Arc::new(tokio::sync::Mutex::new(external));
        let task = tokio::spawn(async move {
            let mut requests = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { break };
                        if requests.len() >= 16 { continue; }
                        let server = server.clone(); let config = config.clone(); let run = run.clone(); let token = address.token.clone(); let external = external.clone();
                        requests.spawn(async move { let _ = tokio::time::timeout(std::time::Duration::from_secs(660), handle(stream, &token, &server, &config, &run, &external)).await; });
                    }
                    _ = requests.join_next(), if !requests.is_empty() => {}
                }
            }
        });
        Ok(Self { file, task })
    }

    pub fn mcp(&self) -> Result<Value, String> {
        let command = relay_executable()?;
        Ok(json!({"command": command, "args": ["--ai-mcp-relay", self.file.path()], "env": {}}))
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub fn relay(path: &str) -> Result<(), String> {
    use std::io::{BufRead, Read, Write};
    let file = std::fs::File::open(path).map_err(|_| "Bridge-Datei nicht verfügbar")?;
    let address: Address = serde_json::from_reader(file).map_err(|_| "Ungültige Bridge-Datei")?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "Bridge-Runtime nicht verfügbar")?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(660))
        .build()
        .map_err(|_| "Bridge-Client nicht verfügbar")?;
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let mut stdout = std::io::stdout();
    loop {
        let mut line = String::new();
        if (&mut input)
            .take(1_048_577)
            .read_line(&mut line)
            .map_err(|_| "Bridge-Eingabe geschlossen")?
            == 0
        {
            break;
        }
        if line.len() > 1_048_576 {
            return Err("Bridge-Anfrage zu groß".into());
        }
        let request: Value = serde_json::from_str(&line).map_err(|_| "Ungültiges JSON")?;
        if request.get("id").is_none() {
            continue;
        }
        let result: Value = runtime.block_on(async {
            client
                .post(format!("http://127.0.0.1:{}/rpc", address.port))
                .bearer_auth(&address.token)
                .json(&request)
                .send()
                .await
                .map_err(|_| "l8db-Sitzung nicht mehr verfügbar")?
                .json()
                .await
                .map_err(|_| "Ungültige Bridge-Antwort")
        })?;
        writeln!(stdout, "{result}")
            .and_then(|_| stdout.flush())
            .map_err(|_| "Bridge-Ausgabe geschlossen")?;
    }
    Ok(())
}

fn relay_executable() -> Result<std::path::PathBuf, String> {
    #[cfg(test)]
    if let Some(path) = std::env::var_os("L8DB_AI_RELAY_EXECUTABLE") {
        let path = std::path::PathBuf::from(path);
        if path.is_absolute() && path.is_file() {
            return Ok(path);
        }
        return Err("Ungültiges Relay-Testprogramm".into());
    }
    std::env::current_exe().map_err(|_| "l8db-Programmpfad nicht verfügbar".into())
}
