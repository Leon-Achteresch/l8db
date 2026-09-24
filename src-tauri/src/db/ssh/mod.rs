mod auth;
pub mod config;
mod proxy;

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::known_hosts::{check_known_hosts_path, learn_known_hosts_path};
use russh::keys::{HashAlg, PublicKey, PublicKeyOrCertificate};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

pub use auth::SshAuthRequest;
pub use proxy::ProxyRequest;

const HOP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone)]
pub struct SshError(pub String);

impl fmt::Display for SshError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for SshError {}

impl From<russh::Error> for SshError {
    fn from(value: russh::Error) -> Self {
        SshError(format!("SSH-Fehler: {value}"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshHopRequest {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuthRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelRequest {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuthRequest,
    #[serde(default)]
    pub jump_hosts: Vec<SshHopRequest>,
    #[serde(default)]
    pub proxy: Option<ProxyRequest>,
    pub remote_host: String,
    pub remote_port: u16,
    pub accept_new_host_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyTunnelRequest {
    pub id: String,
    pub proxy: ProxyRequest,
    pub remote_host: String,
    pub remote_port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelKind {
    Ssh,
    Proxy,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshTunnelInfo {
    pub id: String,
    pub kind: TunnelKind,
    pub local_port: u16,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub jump_hosts: Vec<String>,
    pub proxy: Option<String>,
    pub remote_host: String,
    pub remote_port: u16,
}

struct ActiveTunnel {
    info: SshTunnelInfo,
    signature: String,
    task: JoinHandle<()>,
}

pub struct SshTunnelManager {
    tunnels: Mutex<HashMap<String, ActiveTunnel>>,
}

pub type SshState = Arc<SshTunnelManager>;

pub fn create_ssh_state() -> SshState {
    Arc::new(SshTunnelManager {
        tunnels: Mutex::new(HashMap::new()),
    })
}

trait TunnelStream: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T: AsyncRead + AsyncWrite + Unpin + Send> TunnelStream for T {}

type BoxedStream = Box<dyn TunnelStream + 'static>;

fn known_hosts_path() -> Option<PathBuf> {
    if let Some(custom) = std::env::var_os("L8DB_KNOWN_HOSTS") {
        return Some(PathBuf::from(custom));
    }
    auth::home_dir().map(|home| home.join(".ssh").join("known_hosts"))
}

fn key_fingerprint(key: &PublicKey) -> String {
    format!("{:?} {}", key.algorithm(), key.fingerprint(HashAlg::Sha256))
}

struct TunnelHandler {
    host: String,
    port: u16,
    accept_new_host_key: bool,
}

impl client::Handler for TunnelHandler {
    type Error = SshError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, SshError> {
        let server_key = match server_public_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key,
            PublicKeyOrCertificate::Certificate(_) => {
                return Err(SshError(
                    "SSH-Zertifikate werden in Phase 2 nicht unterstützt, nur Host-Keys."
                        .to_string(),
                ));
            }
        };
        let path = known_hosts_path();
        if let Some(ref path) = path {
            if path.exists() {
                match check_known_hosts_path(&self.host, self.port, server_key, path) {
                    Ok(true) => return Ok(true),
                    Ok(false) => {}
                    Err(e) => {
                        return Err(SshError(format!(
                            "known_hosts konnte nicht geprüft werden ({}): {e}",
                            path.display()
                        )));
                    }
                }
            }
        }
        if self.accept_new_host_key {
            if let Some(ref path) = path {
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                learn_known_hosts_path(&self.host, self.port, server_key, path).map_err(|e| {
                    SshError(format!(
                        "Host-Key konnte nicht in {} gespeichert werden: {e}",
                        path.display()
                    ))
                })?;
            }
            return Ok(true);
        }
        let hint = match path {
            Some(p) => format!(
                "Aktiviere in den Einstellungen „Neue SSH-Host-Keys akzeptieren“, um ihn beim ersten Verbinden in {} zu speichern.",
                p.display()
            ),
            None => "HOME ist nicht gesetzt, known_hosts kann nicht geprüft werden.".to_string(),
        };
        Err(SshError(format!(
            "Unbekannter SSH-Host-Key für {}:{} ({}). {}",
            self.host,
            self.port,
            key_fingerprint(server_key),
            hint
        )))
    }
}

fn hop_label(index: usize, total: usize, hop: &SshHopRequest) -> String {
    if index + 1 == total {
        format!("SSH-Server {}:{}", hop.host, hop.port)
    } else {
        format!("Sprung-Host {} ({}:{})", index + 1, hop.host, hop.port)
    }
}

async fn open_first_stream(
    hop: &SshHopRequest,
    proxy: Option<&ProxyRequest>,
) -> Result<BoxedStream, String> {
    if let Some(proxy) = proxy {
        let stream = proxy::connect(proxy, &hop.host, hop.port).await?;
        return Ok(Box::new(stream));
    }
    let addr = tokio::net::lookup_host((hop.host.as_str(), hop.port))
        .await
        .map_err(|e| format!("Host {} konnte nicht aufgelöst werden: {e}", hop.host))?
        .next()
        .ok_or_else(|| format!("Host {} konnte nicht aufgelöst werden.", hop.host))?;
    let stream = TcpStream::connect(addr)
        .await
        .map_err(|e| format!("TCP-Verbindung fehlgeschlagen: {e}"))?;
    Ok(Box::new(stream))
}

async fn connect_hop(
    config: Arc<client::Config>,
    previous: Option<&Handle<TunnelHandler>>,
    hop: &SshHopRequest,
    proxy: Option<&ProxyRequest>,
    accept_new_host_key: bool,
) -> Result<Handle<TunnelHandler>, String> {
    let stream: BoxedStream = match previous {
        Some(handle) => {
            let channel = handle
                .channel_open_direct_tcpip(hop.host.as_str(), u32::from(hop.port), "127.0.0.1", 0)
                .await
                .map_err(|e| {
                    format!("Weiterleitung über den vorherigen Sprung-Host abgelehnt: {e}")
                })?;
            Box::new(channel.into_stream())
        }
        None => open_first_stream(hop, proxy).await?,
    };
    let handler = TunnelHandler {
        host: hop.host.clone(),
        port: hop.port,
        accept_new_host_key,
    };
    let mut handle = client::connect_stream(config, stream, handler)
        .await
        .map_err(|e| format!("SSH-Verbindung fehlgeschlagen: {e}"))?;
    auth::authenticate(&mut handle, &hop.user, &hop.auth).await?;
    Ok(handle)
}

async fn connect_chain(request: &SshTunnelRequest) -> Result<Vec<Handle<TunnelHandler>>, String> {
    let mut hops = request.jump_hosts.clone();
    hops.push(SshHopRequest {
        host: request.host.clone(),
        port: request.port,
        user: request.user.clone(),
        auth: request.auth.clone(),
    });
    if hops
        .iter()
        .any(|hop| hop.host.trim().is_empty() || hop.user.trim().is_empty() || hop.port == 0)
    {
        return Err(
            "Host, Port und Benutzer sind für jeden SSH- und Sprung-Host erforderlich.".to_string(),
        );
    }
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(300)),
        ..Default::default()
    });
    let total = hops.len();
    let mut handles: Vec<Handle<TunnelHandler>> = Vec::with_capacity(total);
    for (index, hop) in hops.iter().enumerate() {
        let label = hop_label(index, total, hop);
        let handle = tokio::time::timeout(
            HOP_TIMEOUT,
            connect_hop(
                config.clone(),
                handles.last(),
                hop,
                request.proxy.as_ref(),
                request.accept_new_host_key,
            ),
        )
        .await
        .map_err(|_| format!("{label}: Verbindung hat länger als 15 Sekunden gedauert."))?
        .map_err(|e| format!("{label}: {e}"))?;
        handles.push(handle);
    }
    Ok(handles)
}

async fn run_ssh_forwarder(
    listener: TcpListener,
    chain: Arc<Mutex<Vec<Handle<TunnelHandler>>>>,
    remote_host: String,
    remote_port: u16,
) {
    loop {
        let (mut socket, _) = match listener.accept().await {
            Ok(pair) => pair,
            Err(_) => break,
        };
        let chain = chain.clone();
        let remote_host = remote_host.clone();
        tokio::spawn(async move {
            let channel = {
                let handles = chain.lock().await;
                let Some(handle) = handles.last() else {
                    return;
                };
                handle
                    .channel_open_direct_tcpip(&remote_host, u32::from(remote_port), "127.0.0.1", 0)
                    .await
            };
            let Ok(channel) = channel else {
                return;
            };
            let mut stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut stream, &mut socket).await;
        });
    }
}

async fn run_proxy_forwarder(
    listener: TcpListener,
    proxy: ProxyRequest,
    remote_host: String,
    remote_port: u16,
) {
    loop {
        let (mut socket, _) = match listener.accept().await {
            Ok(pair) => pair,
            Err(_) => break,
        };
        let proxy = proxy.clone();
        let remote_host = remote_host.clone();
        tokio::spawn(async move {
            let Ok(mut upstream) = proxy::connect(&proxy, &remote_host, remote_port).await else {
                return;
            };
            let _ = tokio::io::copy_bidirectional(&mut upstream, &mut socket).await;
        });
    }
}

async fn bind_local() -> Result<(TcpListener, u16), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Lokaler Tunnel-Port konnte nicht geöffnet werden: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Lokaler Tunnel-Port konnte nicht ermittelt werden: {e}"))?
        .port();
    Ok((listener, port))
}

fn signature<T: Serialize>(request: &T) -> String {
    serde_json::to_string(request).unwrap_or_default()
}

impl SshTunnelManager {
    async fn reuse(&self, id: &str, signature: &str) -> Result<Option<SshTunnelInfo>, String> {
        if id.trim().is_empty() {
            return Err("Tunnel-ID fehlt.".to_string());
        }
        let existing = self
            .tunnels
            .lock()
            .await
            .get(id)
            .map(|tunnel| (tunnel.signature == signature, tunnel.info.clone()));
        match existing {
            Some((true, info)) => Ok(Some(info)),
            Some((false, _)) => {
                self.close(id).await?;
                Ok(None)
            }
            None => Ok(None),
        }
    }

    async fn register(&self, info: SshTunnelInfo, signature: String, task: JoinHandle<()>) {
        let replaced = self.tunnels.lock().await.insert(
            info.id.clone(),
            ActiveTunnel {
                info,
                signature,
                task,
            },
        );
        if let Some(previous) = replaced {
            previous.task.abort();
        }
    }

    pub async fn open(&self, request: SshTunnelRequest) -> Result<SshTunnelInfo, String> {
        if request.host.trim().is_empty() || request.user.trim().is_empty() {
            return Err("SSH-Host und -Benutzer sind erforderlich.".to_string());
        }
        let signature = signature(&request);
        if let Some(info) = self.reuse(&request.id, &signature).await? {
            return Ok(info);
        }
        let chain = connect_chain(&request).await?;
        let (listener, local_port) = bind_local().await?;
        let info = SshTunnelInfo {
            id: request.id.clone(),
            kind: TunnelKind::Ssh,
            local_port,
            ssh_host: request.host.clone(),
            ssh_port: request.port,
            ssh_user: request.user.clone(),
            jump_hosts: request
                .jump_hosts
                .iter()
                .map(|hop| format!("{}@{}:{}", hop.user, hop.host, hop.port))
                .collect(),
            proxy: request.proxy.as_ref().map(ProxyRequest::label),
            remote_host: request.remote_host.clone(),
            remote_port: request.remote_port,
        };
        let task = tokio::spawn(run_ssh_forwarder(
            listener,
            Arc::new(Mutex::new(chain)),
            request.remote_host.clone(),
            request.remote_port,
        ));
        self.register(info.clone(), signature, task).await;
        Ok(info)
    }

    pub async fn open_proxy(&self, request: ProxyTunnelRequest) -> Result<SshTunnelInfo, String> {
        if request.remote_host.trim().is_empty() || request.remote_port == 0 {
            return Err("Zielhost und -port der Datenbank sind erforderlich.".to_string());
        }
        let signature = signature(&request);
        if let Some(info) = self.reuse(&request.id, &signature).await? {
            return Ok(info);
        }
        drop(proxy::connect(&request.proxy, &request.remote_host, request.remote_port).await?);
        let (listener, local_port) = bind_local().await?;
        let info = SshTunnelInfo {
            id: request.id.clone(),
            kind: TunnelKind::Proxy,
            local_port,
            ssh_host: request.proxy.host.clone(),
            ssh_port: request.proxy.port,
            ssh_user: request.proxy.username.clone().unwrap_or_default(),
            jump_hosts: Vec::new(),
            proxy: Some(request.proxy.label()),
            remote_host: request.remote_host.clone(),
            remote_port: request.remote_port,
        };
        let task = tokio::spawn(run_proxy_forwarder(
            listener,
            request.proxy.clone(),
            request.remote_host.clone(),
            request.remote_port,
        ));
        self.register(info.clone(), signature, task).await;
        Ok(info)
    }

    pub async fn close(&self, id: &str) -> Result<(), String> {
        let removed = self.tunnels.lock().await.remove(id);
        if let Some(tunnel) = removed {
            tunnel.task.abort();
        }
        Ok(())
    }

    pub async fn list(&self) -> Vec<SshTunnelInfo> {
        self.tunnels
            .lock()
            .await
            .values()
            .map(|t| t.info.clone())
            .collect()
    }
}

#[tauri::command]
pub async fn open_ssh_tunnel(
    request: SshTunnelRequest,
    ssh_state: tauri::State<'_, SshState>,
    options: Option<super::execution::ExecutionOptions>,
) -> Result<SshTunnelInfo, String> {
    super::execution::run(
        options,
        false,
        super::execution::connect(ssh_state.open(request)),
    )
    .await
}

#[tauri::command]
pub async fn open_proxy_tunnel(
    request: ProxyTunnelRequest,
    ssh_state: tauri::State<'_, SshState>,
    options: Option<super::execution::ExecutionOptions>,
) -> Result<SshTunnelInfo, String> {
    super::execution::run(
        options,
        false,
        super::execution::connect(ssh_state.open_proxy(request)),
    )
    .await
}

#[tauri::command]
pub async fn close_ssh_tunnel(
    id: String,
    ssh_state: tauri::State<'_, SshState>,
) -> Result<(), String> {
    ssh_state.close(&id).await
}

#[tauri::command]
pub async fn list_ssh_tunnels(
    ssh_state: tauri::State<'_, SshState>,
) -> Result<Vec<SshTunnelInfo>, String> {
    Ok(ssh_state.list().await)
}

#[cfg(test)]
mod tests;
