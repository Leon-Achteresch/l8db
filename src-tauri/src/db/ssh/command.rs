use std::collections::HashSet;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};

use super::{SshTunnelInfo, TunnelFailure, TunnelKind, TunnelNotifier};

pub const PORT_PLACEHOLDER: &str = "{localPort}";
const DEFAULT_TIMEOUT_SECS: u64 = 20;
const STDERR_LIMIT: usize = 8 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandTunnelRequest {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub local_port: Option<u16>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

fn live_pids() -> &'static StdMutex<HashSet<u32>> {
    static PIDS: OnceLock<StdMutex<HashSet<u32>>> = OnceLock::new();
    PIDS.get_or_init(|| StdMutex::new(HashSet::new()))
}

fn kill_pid(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
        libc::kill(pid as i32, libc::SIGTERM);
    }
    #[cfg(windows)]
    {
        let _ = crate::process::std_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

pub fn kill_all() {
    let pids: Vec<u32> = live_pids()
        .lock()
        .map(|mut set| set.drain().collect())
        .unwrap_or_default();
    for pid in pids {
        kill_pid(pid);
    }
}

pub struct ProcessGuard {
    child: Child,
    pid: Option<u32>,
}

impl ProcessGuard {
    fn new(child: Child) -> Self {
        let pid = child.id();
        if let (Some(pid), Ok(mut set)) = (pid, live_pids().lock()) {
            set.insert(pid);
        }
        Self { child, pid }
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        if let Some(pid) = self.pid.take() {
            if let Ok(mut set) = live_pids().lock() {
                set.remove(&pid);
            }
            if matches!(self.child.try_wait(), Ok(None)) {
                kill_pid(pid);
            }
        }
        let _ = self.child.start_kill();
    }
}

pub fn render_command(template: &str, port: u16) -> String {
    template.replace(PORT_PLACEHOLDER, &port.to_string())
}

pub fn validate(request: &CommandTunnelRequest) -> Result<(), String> {
    if request.command.trim().is_empty() {
        return Err("Befehl für den Befehls-Tunnel fehlt.".to_string());
    }
    if !request.command.contains(PORT_PLACEHOLDER) && request.local_port.unwrap_or(0) == 0 {
        return Err(format!(
            "Der Befehl muss {PORT_PLACEHOLDER} enthalten oder es muss ein fester lokaler Port angegeben werden."
        ));
    }
    Ok(())
}

async fn choose_port(fixed: Option<u16>) -> Result<u16, String> {
    match fixed.filter(|port| *port != 0) {
        Some(port) => {
            drop(TcpListener::bind(("127.0.0.1", port)).await.map_err(|e| {
                format!("Lokaler Port {port} ist bereits belegt oder nicht verfügbar: {e}")
            })?);
            Ok(port)
        }
        None => {
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("Lokaler Tunnel-Port konnte nicht geöffnet werden: {e}"))?;
            listener
                .local_addr()
                .map(|addr| addr.port())
                .map_err(|e| format!("Lokaler Tunnel-Port konnte nicht ermittelt werden: {e}"))
        }
    }
}

fn shell_command(script: &str) -> Command {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "/bin/sh".to_string());
        let mut command = crate::process::command(shell);
        command.arg("-lc").arg(script);
        if let Ok(path) = std::env::join_paths(crate::db::backup_tools::search_dirs()) {
            command.env("PATH", path);
        }
        command.process_group(0);
        command
    }
    #[cfg(windows)]
    {
        let mut command = crate::process::command("cmd");
        command.arg("/C").arg(script);
        command
    }
}

fn tail(buffer: &StdMutex<Vec<u8>>) -> String {
    let bytes = buffer.lock().map(|b| b.clone()).unwrap_or_default();
    String::from_utf8_lossy(&bytes).trim().to_string()
}

fn spawn_stderr_reader(child: &mut Child) -> Arc<StdMutex<Vec<u8>>> {
    let buffer = Arc::new(StdMutex::new(Vec::new()));
    if let Some(mut stderr) = child.stderr.take() {
        let sink = buffer.clone();
        tokio::spawn(async move {
            let mut chunk = [0u8; 2048];
            while let Ok(read) = stderr.read(&mut chunk).await {
                if read == 0 {
                    break;
                }
                if let Ok(mut data) = sink.lock() {
                    data.extend_from_slice(&chunk[..read]);
                    if data.len() > STDERR_LIMIT {
                        let excess = data.len() - STDERR_LIMIT;
                        data.drain(..excess);
                    }
                }
            }
        });
    }
    buffer
}

fn exit_message(status: std::process::ExitStatus, stderr: &str) -> String {
    let code = status
        .code()
        .map(|code| format!("Exit-Code {code}"))
        .unwrap_or_else(|| "durch Signal beendet".to_string());
    if stderr.is_empty() {
        format!("Tunnel-Befehl wurde vorzeitig beendet ({code}).")
    } else {
        format!("Tunnel-Befehl wurde vorzeitig beendet ({code}): {stderr}")
    }
}

pub async fn start(
    request: &CommandTunnelRequest,
) -> Result<(ProcessGuard, u16, Arc<StdMutex<Vec<u8>>>), String> {
    validate(request)?;
    let port = choose_port(request.local_port).await?;
    let script = render_command(&request.command, port);
    let mut command = shell_command(&script);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Tunnel-Befehl konnte nicht gestartet werden: {e}"))?;
    let stderr = spawn_stderr_reader(&mut child);
    let mut guard = ProcessGuard::new(child);
    let timeout = Duration::from_secs(
        request
            .timeout_secs
            .filter(|secs| *secs > 0)
            .unwrap_or(DEFAULT_TIMEOUT_SECS),
    );
    let deadline = Instant::now() + timeout;
    loop {
        if let Ok(Some(status)) = guard.child.try_wait() {
            tokio::time::sleep(Duration::from_millis(50)).await;
            return Err(exit_message(status, &tail(&stderr)));
        }
        if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return Ok((guard, port, stderr));
        }
        if Instant::now() >= deadline {
            let output = tail(&stderr);
            let detail = if output.is_empty() {
                String::new()
            } else {
                format!(" Ausgabe: {output}")
            };
            return Err(format!(
                "Tunnel-Befehl hat Port {port} nicht innerhalb von {} s geöffnet.{detail}",
                timeout.as_secs()
            ));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

pub fn info(request: &CommandTunnelRequest, port: u16) -> SshTunnelInfo {
    SshTunnelInfo {
        id: request.id.clone(),
        kind: TunnelKind::Command,
        local_port: port,
        ssh_host: request.command.clone(),
        ssh_port: 0,
        ssh_user: String::new(),
        jump_hosts: Vec::new(),
        proxy: None,
        remote_host: "127.0.0.1".to_string(),
        remote_port: port,
    }
}

pub async fn supervise(
    id: String,
    mut guard: ProcessGuard,
    stderr: Arc<StdMutex<Vec<u8>>>,
    broken: Arc<OnceLock<String>>,
    notifier: Option<TunnelNotifier>,
) {
    let status = guard.child.wait().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    let message = match status {
        Ok(status) => exit_message(status, &tail(&stderr)),
        Err(e) => format!("Tunnel-Befehl konnte nicht überwacht werden: {e}"),
    };
    let _ = broken.set(message.clone());
    if let Some(notify) = notifier {
        notify(TunnelFailure {
            id,
            error: message,
            fatal: true,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(
        command: &str,
        local_port: Option<u16>,
        timeout_secs: Option<u64>,
    ) -> CommandTunnelRequest {
        CommandTunnelRequest {
            id: "t".into(),
            command: command.into(),
            local_port,
            timeout_secs,
        }
    }

    fn has(tool: &str) -> bool {
        crate::process::std_command("sh")
            .arg("-c")
            .arg(format!("command -v {tool}"))
            .stdout(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    #[test]
    fn substitutes_port_placeholder() {
        assert_eq!(
            render_command(
                "kubectl port-forward svc/pg {localPort}:5432 -p {localPort}",
                4242
            ),
            "kubectl port-forward svc/pg 4242:5432 -p 4242"
        );
    }

    #[test]
    fn requires_placeholder_or_fixed_port() {
        assert!(validate(&request("cloudflared access tcp", None, None)).is_err());
        assert!(validate(&request("cloudflared access tcp", Some(6000), None)).is_ok());
        assert!(validate(&request("x {localPort}", None, None)).is_ok());
        assert!(validate(&request("  ", Some(1), None)).is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reports_early_exit_with_stderr() {
        let error = start(&request("echo boom-{localPort} >&2; exit 3", None, Some(5)))
            .await
            .err()
            .expect("must fail");
        assert!(error.contains("Exit-Code 3"), "{error}");
        assert!(error.contains("boom-"), "{error}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn times_out_when_port_never_opens() {
        let error = start(&request("sleep 30 # {localPort}", None, Some(1)))
            .await
            .err()
            .expect("must time out");
        assert!(error.contains("nicht innerhalb"), "{error}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn waits_until_port_accepts() {
        if !has("python3") {
            return;
        }
        let script = "python3 -c 'import socket,time;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);time.sleep(0.5);s.bind((\"127.0.0.1\",{localPort}));s.listen();time.sleep(30)'";
        let (guard, port, _) = start(&request(script, None, Some(10)))
            .await
            .expect("tunnel");
        assert!(TcpStream::connect(("127.0.0.1", port)).await.is_ok());
        drop(guard);
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err());
    }
}
