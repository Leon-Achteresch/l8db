mod auth;
pub mod command;
pub mod config;
mod proxy;

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use russh::client::{self, Handle};
use russh::keys::known_hosts::{check_known_hosts_path, learn_known_hosts_path};
use russh::keys::{HashAlg, PublicKey, PublicKeyOrCertificate};
use russh::Channel;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;

pub use auth::SshAuthRequest;
pub use proxy::ProxyRequest;

const HOP_TIMEOUT: Duration = Duration::from_secs(15);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);
const RECONNECT_BACKOFF: Duration = Duration::from_secs(3);
const RECONNECT_BACKOFF_MAX: Duration = Duration::from_secs(60);
const PENDING_CLIENT_BYTES: usize = 64 * 1024;

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
    Command,
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
    broken: Option<Arc<OnceLock<String>>>,
}

impl ActiveTunnel {
    fn is_broken(&self) -> bool {
        self.broken
            .as_ref()
            .is_some_and(|broken| broken.get().is_some())
    }
}

pub struct SshTunnelManager {
    tunnels: Mutex<HashMap<String, ActiveTunnel>>,
    notifier: OnceLock<TunnelNotifier>,
}

pub type SshState = Arc<SshTunnelManager>;

pub fn create_ssh_state() -> SshState {
    Arc::new(SshTunnelManager {
        tunnels: Mutex::new(HashMap::new()),
        notifier: OnceLock::new(),
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
    pinned_key: Option<PublicKey>,
    verified_key: Arc<OnceLock<PublicKey>>,
    rejected_key: Arc<OnceLock<()>>,
}

impl TunnelHandler {
    fn verify_server_key(&self, server_key: &PublicKey) -> Result<(), SshError> {
        if let Some(pinned) = &self.pinned_key {
            if pinned.key_data() == server_key.key_data() {
                return Ok(());
            }
            return Err(SshError(format!(
                "SSH-Host-Key von {}:{} hat sich seit dem Öffnen des Tunnels geändert ({} statt {}). Die Verbindung wird nicht automatisch wiederhergestellt; öffne den Tunnel neu.",
                self.host,
                self.port,
                key_fingerprint(server_key),
                key_fingerprint(pinned)
            )));
        }
        let path = known_hosts_path();
        if let Some(ref path) = path {
            if path.exists() {
                match check_known_hosts_path(&self.host, self.port, server_key, path) {
                    Ok(true) => return Ok(()),
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
            return Ok(());
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
        if let Err(e) = self.verify_server_key(server_key) {
            let _ = self.rejected_key.set(());
            return Err(e);
        }
        let _ = self.verified_key.set(server_key.clone());
        Ok(true)
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
    pinned_key: Option<PublicKey>,
) -> Result<(Handle<TunnelHandler>, PublicKey), ChainFailure> {
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
    let verified_key = Arc::new(OnceLock::new());
    let rejected_key = Arc::new(OnceLock::new());
    let handler = TunnelHandler {
        host: hop.host.clone(),
        port: hop.port,
        accept_new_host_key,
        pinned_key,
        verified_key: verified_key.clone(),
        rejected_key: rejected_key.clone(),
    };
    let mut handle = client::connect_stream(config, stream, handler)
        .await
        .map_err(|e| ChainFailure {
            message: format!("SSH-Verbindung fehlgeschlagen: {e}"),
            fatal: rejected_key.get().is_some(),
        })?;
    let host_key = verified_key.get().cloned().ok_or_else(|| ChainFailure {
        message: "SSH-Host-Key wurde nicht geprüft.".to_string(),
        fatal: true,
    })?;
    auth::authenticate(&mut handle, &hop.user, &hop.auth)
        .await
        .map_err(|message| ChainFailure {
            message,
            fatal: true,
        })?;
    Ok((handle, host_key))
}

fn client_config() -> client::Config {
    client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        keepalive_max: 3,
        ..Default::default()
    }
}

#[derive(Debug, Clone)]
struct ChainFailure {
    message: String,
    fatal: bool,
}

impl From<String> for ChainFailure {
    fn from(message: String) -> Self {
        ChainFailure {
            message,
            fatal: false,
        }
    }
}

struct SshChain {
    handles: Vec<Handle<TunnelHandler>>,
    host_keys: Vec<PublicKey>,
}

async fn connect_chain(
    request: &SshTunnelRequest,
    pinned_keys: &[PublicKey],
) -> Result<SshChain, ChainFailure> {
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
        return Err(ChainFailure {
            message: "Host, Port und Benutzer sind für jeden SSH- und Sprung-Host erforderlich."
                .to_string(),
            fatal: true,
        });
    }
    let config = Arc::new(client_config());
    let total = hops.len();
    let mut handles: Vec<Handle<TunnelHandler>> = Vec::with_capacity(total);
    let mut host_keys: Vec<PublicKey> = Vec::with_capacity(total);
    for (index, hop) in hops.iter().enumerate() {
        let label = hop_label(index, total, hop);
        let (handle, host_key) = tokio::time::timeout(
            HOP_TIMEOUT,
            connect_hop(
                config.clone(),
                handles.last(),
                hop,
                request.proxy.as_ref(),
                request.accept_new_host_key,
                pinned_keys.get(index).cloned(),
            ),
        )
        .await
        .map_err(|_| format!("{label}: Verbindung hat länger als 15 Sekunden gedauert."))?
        .map_err(|e| ChainFailure {
            message: format!("{label}: {}", e.message),
            fatal: e.fatal,
        })?;
        handles.push(handle);
        host_keys.push(host_key);
    }
    Ok(SshChain { handles, host_keys })
}

struct ReconnectFailure {
    at: Instant,
    message: String,
    attempts: u32,
}

struct ChainLink {
    handles: Vec<Handle<TunnelHandler>>,
    failure: Option<ReconnectFailure>,
}

fn reconnect_backoff(attempts: u32) -> Duration {
    RECONNECT_BACKOFF
        .saturating_mul(1 << attempts.saturating_sub(1).min(5))
        .min(RECONNECT_BACKOFF_MAX)
}

#[derive(Debug, Clone, Serialize)]
pub struct TunnelFailure {
    pub id: String,
    pub error: String,
    pub fatal: bool,
}

pub type TunnelNotifier = Arc<dyn Fn(TunnelFailure) + Send + Sync>;

struct SshForward {
    request: SshTunnelRequest,
    host_keys: Vec<PublicKey>,
    link: Mutex<ChainLink>,
    broken: Arc<OnceLock<String>>,
    notifier: Option<TunnelNotifier>,
}

fn chain_is_closed(handles: &[Handle<TunnelHandler>]) -> bool {
    handles.is_empty() || handles.iter().any(Handle::is_closed)
}

async fn open_forward_channel(
    handles: &[Handle<TunnelHandler>],
    remote_host: &str,
    remote_port: u16,
) -> Result<Channel<client::Msg>, String> {
    let handle = handles
        .last()
        .ok_or_else(|| "SSH-Verbindung ist nicht aufgebaut.".to_string())?;
    handle
        .channel_open_direct_tcpip(remote_host, u32::from(remote_port), "127.0.0.1", 0)
        .await
        .map_err(|e| format!("Weiterleitung zur Datenbank abgelehnt: {e}"))
}

impl SshForward {
    fn new(request: SshTunnelRequest, chain: SshChain, notifier: Option<TunnelNotifier>) -> Self {
        SshForward {
            request,
            host_keys: chain.host_keys,
            link: Mutex::new(ChainLink {
                handles: chain.handles,
                failure: None,
            }),
            broken: Arc::new(OnceLock::new()),
            notifier,
        }
    }

    fn report(&self, failure: &ChainFailure, attempts: u32) {
        let id = self.request.id.as_str();
        if failure.fatal {
            let _ = self.broken.set(failure.message.clone());
            log::error!("SSH-Tunnel {id} dauerhaft getrennt: {}", failure.message);
        } else {
            log::warn!(
                "SSH-Tunnel {id}: Wiederverbinden fehlgeschlagen (Versuch {attempts}): {}",
                failure.message
            );
        }
        if !failure.fatal && attempts > 1 {
            return;
        }
        if let Some(notify) = &self.notifier {
            notify(TunnelFailure {
                id: id.to_string(),
                error: failure.message.clone(),
                fatal: failure.fatal,
            });
        }
    }

    async fn channel(&self, abandoned: impl Fn() -> bool) -> Result<Channel<client::Msg>, String> {
        let remote_host = self.request.remote_host.as_str();
        let remote_port = self.request.remote_port;
        let mut link = self.link.lock().await;
        if abandoned() {
            return Err("Lokale Verbindung wurde geschlossen.".to_string());
        }
        if let Some(error) = self.broken.get() {
            return Err(error.clone());
        }
        if !chain_is_closed(&link.handles) {
            match open_forward_channel(&link.handles, remote_host, remote_port).await {
                Ok(channel) => return Ok(channel),
                Err(e) if !chain_is_closed(&link.handles) => return Err(e),
                Err(_) => {}
            }
        }
        if let Some(failure) = &link.failure {
            if failure.at.elapsed() < reconnect_backoff(failure.attempts) {
                return Err(failure.message.clone());
            }
        }
        link.handles.clear();
        match connect_chain(&self.request, &self.host_keys).await {
            Ok(chain) => {
                link.handles = chain.handles;
                link.failure = None;
            }
            Err(failure) => {
                let attempts = link.failure.as_ref().map_or(1, |last| last.attempts + 1);
                self.report(&failure, attempts);
                link.failure = Some(ReconnectFailure {
                    at: Instant::now(),
                    message: failure.message.clone(),
                    attempts,
                });
                return Err(failure.message);
            }
        }
        if abandoned() {
            return Err("Lokale Verbindung wurde geschlossen.".to_string());
        }
        open_forward_channel(&link.handles, remote_host, remote_port).await
    }
}

async fn wait_for_channel(
    socket: &mut TcpStream,
    pending: &mut Vec<u8>,
    mut opening: oneshot::Receiver<Result<Channel<client::Msg>, String>>,
) -> Option<Channel<client::Msg>> {
    loop {
        tokio::select! {
            result = &mut opening => return result.ok().and_then(Result::ok),
            read = socket.read_buf(pending), if pending.len() < PENDING_CLIENT_BYTES => {
                if !matches!(read, Ok(n) if n > 0) {
                    return None;
                }
            }
        }
    }
}

async fn serve_ssh_client(mut socket: TcpStream, forward: Arc<SshForward>) {
    let (sender, receiver) = oneshot::channel();
    tokio::spawn(async move {
        let result = forward.channel(|| sender.is_closed()).await;
        let _ = sender.send(result);
    });
    let mut pending = Vec::new();
    let Some(channel) = wait_for_channel(&mut socket, &mut pending, receiver).await else {
        return;
    };
    let mut stream = channel.into_stream();
    if !pending.is_empty() && stream.write_all(&pending).await.is_err() {
        return;
    }
    let _ = tokio::io::copy_bidirectional(&mut stream, &mut socket).await;
}

async fn run_ssh_forwarder(listener: TcpListener, forward: Arc<SshForward>) {
    loop {
        let (socket, _) = match listener.accept().await {
            Ok(pair) => pair,
            Err(_) => break,
        };
        tokio::spawn(serve_ssh_client(socket, forward.clone()));
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
        let existing = self.tunnels.lock().await.get(id).map(|tunnel| {
            (
                tunnel.signature == signature && !tunnel.is_broken(),
                tunnel.info.clone(),
            )
        });
        match existing {
            Some((true, info)) => Ok(Some(info)),
            Some((false, _)) => {
                self.close(id).await?;
                Ok(None)
            }
            None => Ok(None),
        }
    }

    pub fn notify_with(&self, notifier: TunnelNotifier) {
        let _ = self.notifier.set(notifier);
    }

    async fn register(
        &self,
        info: SshTunnelInfo,
        signature: String,
        task: JoinHandle<()>,
        broken: Option<Arc<OnceLock<String>>>,
    ) {
        let replaced = self.tunnels.lock().await.insert(
            info.id.clone(),
            ActiveTunnel {
                info,
                signature,
                task,
                broken,
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
        let chain = connect_chain(&request, &[])
            .await
            .map_err(|failure| failure.message)?;
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
        let forward = SshForward::new(request, chain, self.notifier.get().cloned());
        let broken = forward.broken.clone();
        let task = tokio::spawn(run_ssh_forwarder(listener, Arc::new(forward)));
        self.register(info.clone(), signature, task, Some(broken))
            .await;
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
        self.register(info.clone(), signature, task, None).await;
        Ok(info)
    }

    pub async fn open_command(
        &self,
        request: command::CommandTunnelRequest,
    ) -> Result<SshTunnelInfo, String> {
        let signature = signature(&request);
        if let Some(info) = self.reuse(&request.id, &signature).await? {
            return Ok(info);
        }
        let (guard, port, stderr) = command::start(&request).await?;
        let info = command::info(&request, port);
        let broken = Arc::new(OnceLock::new());
        let task = tokio::spawn(command::supervise(
            request.id.clone(),
            guard,
            stderr,
            broken.clone(),
            self.notifier.get().cloned(),
        ));
        self.register(info.clone(), signature, task, Some(broken))
            .await;
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
            .filter(|t| !t.is_broken())
            .map(|t| t.info.clone())
            .collect()
    }
}

#[tauri::command]
pub async fn open_ssh_tunnel(
    app: tauri::AppHandle,
    request: SshTunnelRequest,
    ssh_state: tauri::State<'_, SshState>,
    options: Option<super::execution::ExecutionOptions>,
) -> Result<SshTunnelInfo, String> {
    ssh_state.notify_with(Arc::new(move |failure| {
        let _ = tauri::Emitter::emit(&app, "ssh-tunnel-failed", failure);
    }));
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
pub async fn open_command_tunnel(
    app: tauri::AppHandle,
    request: command::CommandTunnelRequest,
    ssh_state: tauri::State<'_, SshState>,
    options: Option<super::execution::ExecutionOptions>,
) -> Result<SshTunnelInfo, String> {
    ssh_state.notify_with(Arc::new(move |failure| {
        let _ = tauri::Emitter::emit(&app, "ssh-tunnel-failed", failure);
    }));
    super::execution::run(options, false, ssh_state.open_command(request)).await
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
