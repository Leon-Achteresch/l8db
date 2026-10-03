use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot};

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;

pub struct Rpc {
    child: Child,
    input: tokio::sync::Mutex<ChildStdin>,
    pending: Pending,
    pub events: mpsc::Receiver<Value>,
    next: AtomicU64,
    reader: tokio::task::JoinHandle<()>,
    stderr: tokio::task::JoinHandle<()>,
}

fn protocol_error(error: &Value) -> String {
    let message = error["message"].as_str().unwrap_or("").to_ascii_lowercase();
    if error["code"] == -32000
        || message.contains("auth")
        || message.contains("login")
        || message.contains("sign in")
    {
        "CLI-Anfrage abgelehnt. Native Anmeldung und Kontoberechtigungen prüfen.".into()
    } else if error["code"] == -32601 {
        "Das CLI-Protokoll unterstützt diese Funktion nicht. CLI aktualisieren.".into()
    } else if error["code"] == -32602 {
        "Die CLI hat die Sitzungseinstellungen abgelehnt. Modell und Modus prüfen.".into()
    } else {
        "CLI-Protokollanfrage abgelehnt. Anmeldung, Modell und CLI-Version prüfen.".into()
    }
}

impl Rpc {
    pub fn spawn(command: &mut Command) -> Result<Self, String> {
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| {
                "CLI konnte nicht gestartet werden. Programmpfad und Installation prüfen."
                    .to_string()
            })?;
        let input = child.stdin.take().ok_or("CLI hat keine Eingabe")?;
        let output = child.stdout.take().ok_or("CLI hat keine Ausgabe")?;
        let errors = child.stderr.take().ok_or("CLI hat keine Fehlerausgabe")?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let waiting = pending.clone();
        let (sender, events) = mpsc::channel(256);
        let reader = tokio::spawn(async move {
            let mut reader = BufReader::new(output);
            loop {
                let mut bytes = Vec::new();
                let Ok(size) = (&mut reader)
                    .take(2_097_153)
                    .read_until(b'\n', &mut bytes)
                    .await
                else {
                    break;
                };
                if size == 0 || bytes.len() > 2_097_152 {
                    break;
                }
                let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                    continue;
                };
                if value.get("method").is_none()
                    && (value.get("result").is_some() || value.get("error").is_some())
                {
                    let key = value.get("id").unwrap_or(&Value::Null).to_string();
                    let reply = waiting.lock().ok().and_then(|mut map| map.remove(&key));
                    if let Some(reply) = reply {
                        let result = if let Some(error) = value.get("error") {
                            Err(protocol_error(error))
                        } else {
                            Ok(value["result"].clone())
                        };
                        let _ = reply.send(result);
                        continue;
                    }
                }
                if sender.send(value).await.is_err() {
                    break;
                }
            }
            if let Ok(mut map) = waiting.lock() {
                map.clear();
            }
        });
        let stderr = tokio::spawn(async move {
            let _ = tokio::io::copy(&mut BufReader::new(errors), &mut tokio::io::sink()).await;
        });
        Ok(Self {
            child,
            input: tokio::sync::Mutex::new(input),
            pending,
            events,
            next: AtomicU64::new(1),
            reader,
            stderr,
        })
    }

    pub async fn send(&self, value: Value) -> Result<(), String> {
        let mut input = self.input.lock().await;
        let mut bytes = serde_json::to_vec(&value).map_err(|_| "Ungültige Protokollnachricht")?;
        bytes.push(b'\n');
        input
            .write_all(&bytes)
            .await
            .map_err(|_| "CLI-Verbindung geschlossen")?;
        input
            .flush()
            .await
            .map_err(|_| "CLI-Verbindung geschlossen".into())
    }

    pub async fn begin(
        &self,
        method: &str,
        params: Value,
    ) -> Result<oneshot::Receiver<Result<Value, String>>, String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        let key = id.to_string();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| "CLI-Protokoll nicht verfügbar")?;
            pending.retain(|_, sender| !sender.is_closed());
            pending.insert(key.clone(), sender);
        }
        if let Err(error) = self
            .send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))
            .await
        {
            self.pending
                .lock()
                .map_err(|_| "CLI-Protokoll nicht verfügbar")?
                .remove(&key);
            return Err(error);
        }
        Ok(receiver)
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let receiver = self.begin(method, params).await?;
        tokio::time::timeout(Duration::from_secs(30), receiver)
            .await
            .map_err(|_| "CLI antwortet nicht (30 Sekunden)")?
            .map_err(|_| "CLI-Verbindung geschlossen")?
    }

    pub async fn reply(&self, id: Value, result: Value) -> Result<(), String> {
        self.send(json!({"jsonrpc": "2.0", "id": id, "result": result}))
            .await
    }
}

impl Drop for Rpc {
    fn drop(&mut self) {
        self.reader.abort();
        self.stderr.abort();
        #[cfg(unix)]
        if let Some(pid) = self.child.id() {
            unsafe {
                libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
            }
        }
        let _ = self.child.start_kill();
    }
}
