use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;
use tokio_tungstenite::tungstenite::{protocol::WebSocketConfig, Message};
use tokio_util::sync::CancellationToken;

const MAX_LISTENERS: usize = 16;
const MAX_CONNECTIONS: usize = 32;
const MAX_QUERIES: usize = 16;
const MAX_CANCELS: usize = 4;
const MAX_GLOBAL_CONNECTIONS: usize = 80;
const MAX_MESSAGE: usize = 4 * 1024 * 1024;
const CHUNK: usize = 64 * 1024;
const IDLE: Duration = Duration::from_secs(60);
const CHECK_IDLE: Duration = Duration::from_secs(15);
const HANDSHAKE: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Target {
    url: String,
}

pub(crate) fn target(url: &url::Url) -> Result<Option<Target>, String> {
    let values = url
        .query_pairs()
        .filter(|(key, _)| key == "l8db_transport")
        .map(|(_, value)| value.into_owned())
        .collect::<Vec<_>>();
    if values.is_empty() {
        return Ok(None);
    }
    if values.len() != 1 || values[0] != "neon-ws" {
        return Err("Unbekannter PostgreSQL-Transport. Erlaubt ist l8db_transport=neon-ws.".into());
    }
    if !matches!(url.scheme(), "postgres" | "postgresql") {
        return Err("Neon-WebSocket erwartet eine PostgreSQL-URL.".into());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if ![".neon.tech", ".neon.build"].iter().any(|suffix| {
        host.strip_suffix(suffix)
            .is_some_and(|prefix| !prefix.is_empty() && !prefix.starts_with('.'))
    }) {
        return Err("Neon-WebSocket-Transport benötigt einen gehosteten *.neon.tech- oder *.neon.build-Host. SSH-/Proxy-Tunnel können damit nicht kombiniert werden.".into());
    }
    if url.port().is_some_and(|port| !matches!(port, 443 | 5432)) {
        return Err("Neon-WebSocket-Transport verwendet Port 443. Abweichende PostgreSQL-Ports sind nicht unterstützt.".into());
    }
    for (key, value) in url.query_pairs() {
        if matches!(key.as_ref(), "host" | "hostaddr" | "port") {
            return Err("Neon-WebSocket-Transport kann nicht mit Host-Overrides, SSH- oder Proxy-Tunneln kombiniert werden.".into());
        }
        if matches!(key.as_ref(), "sslcert" | "sslkey" | "sslpassword")
            || (key == "sslrootcert" && value != "system")
        {
            return Err("Neon-WebSocket-Transport verwendet den System-Zertifikatsspeicher. Eigene TLS-Zertifikate werden nicht unterstützt.".into());
        }
        if (key == "channel_binding" && value == "require")
            || (key == "sslnegotiation" && value == "direct")
        {
            return Err("PostgreSQL-Channel-Binding und direkte PostgreSQL-TLS-Aushandlung sind über Neon-WebSocket nicht verfügbar. Für WSS channel_binding=disable verwenden oder den direkten PostgreSQL-Transport wählen.".into());
        }
    }
    Ok(Some(Target {
        url: format!("wss://{host}/v2"),
    }))
}

#[cfg(test)]
fn test_target(value: &str) -> Target {
    let parsed = url::Url::parse(value).unwrap();
    assert_eq!(parsed.scheme(), "ws");
    assert!(matches!(
        parsed.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]")
    ));
    assert_eq!(parsed.path(), "/v2");
    Target { url: value.into() }
}

#[derive(Default)]
struct Stats {
    accepted: AtomicU64,
    opened: AtomicU64,
    active: AtomicUsize,
    peak: AtomicUsize,
    sent: AtomicU64,
    received: AtomicU64,
    failures: AtomicU64,
}

struct ListenerState {
    port: u16,
    touched: Mutex<Instant>,
    cancel: CancellationToken,
    connections: Arc<Semaphore>,
    queries: Arc<Semaphore>,
    cancels: Arc<Semaphore>,
    stats: Stats,
}

type Listeners = HashMap<String, Arc<ListenerState>>;

fn listeners() -> &'static Mutex<Listeners> {
    static LISTENERS: OnceLock<Mutex<Listeners>> = OnceLock::new();
    LISTENERS.get_or_init(Default::default)
}

fn global_connections() -> &'static Arc<Semaphore> {
    static CONNECTIONS: OnceLock<Arc<Semaphore>> = OnceLock::new();
    CONNECTIONS.get_or_init(|| Arc::new(Semaphore::new(MAX_GLOBAL_CONNECTIONS)))
}

fn global_queries() -> &'static Arc<Semaphore> {
    static QUERIES: OnceLock<Arc<Semaphore>> = OnceLock::new();
    QUERIES.get_or_init(|| Arc::new(Semaphore::new(64)))
}

fn global_cancels() -> &'static Arc<Semaphore> {
    static CANCELS: OnceLock<Arc<Semaphore>> = OnceLock::new();
    CANCELS.get_or_init(|| Arc::new(Semaphore::new(8)))
}

struct ListenerGuard {
    key: String,
    state: Arc<ListenerState>,
}

impl Drop for ListenerGuard {
    fn drop(&mut self) {
        if let Ok(mut listeners) = listeners().lock() {
            self.state.cancel.cancel();
            if listeners
                .get(&self.key)
                .is_some_and(|state| Arc::ptr_eq(state, &self.state))
            {
                listeners.remove(&self.key);
            }
        } else {
            self.state.cancel.cancel();
        }
    }
}

struct ConnectionGuard(Arc<ListenerState>);

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        if let Ok(mut touched) = self.0.touched.lock() {
            *touched = Instant::now();
            self.0.stats.active.fetch_sub(1, Ordering::AcqRel);
        } else {
            self.0.stats.active.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

fn is_idle(state: &ListenerState) -> bool {
    state
        .touched
        .lock()
        .map(|touched| state.stats.active.load(Ordering::Acquire) == 0 && touched.elapsed() >= IDLE)
        .unwrap_or(true)
}

fn retire_idle(target: &Target, state: &Arc<ListenerState>) -> bool {
    let Ok(mut cache) = listeners().lock() else {
        state.cancel.cancel();
        return true;
    };
    if !cache
        .get(&target.url)
        .is_some_and(|cached| Arc::ptr_eq(cached, state))
    {
        state.cancel.cancel();
        return true;
    }
    if !is_idle(state) {
        return false;
    }
    state.cancel.cancel();
    cache.remove(&target.url);
    true
}

fn ensure(target: &Target) -> Result<Arc<ListenerState>, String> {
    let handle = tokio::runtime::Handle::try_current()
        .map_err(|_| "Neon-WebSocket benötigt eine laufende Netzwerk-Laufzeit.".to_string())?;
    let mut cache = listeners()
        .lock()
        .map_err(|_| "Neon-WebSocket-Verwaltung ist blockiert.".to_string())?;
    cache.retain(|_, state| !state.cancel.is_cancelled());
    if let Some(state) = cache.get(&target.url) {
        *state
            .touched
            .lock()
            .map_err(|_| "Neon-WebSocket-Leerlaufverwaltung ist blockiert.".to_string())? =
            Instant::now();
        return Ok(state.clone());
    }
    if cache.len() >= MAX_LISTENERS {
        return Err("Höchstens 16 Neon-WebSocket-Endpunkte können gleichzeitig aktiv sein. Nicht verwendete Verbindungen schließen.".into());
    }
    let listener = std::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .map_err(|_| "Neon-WebSocket konnte keinen lokalen Port reservieren.".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Neon-WebSocket-Port konnte nicht eingerichtet werden.".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Neon-WebSocket-Port ist nicht verfügbar.".to_string())?
        .port();
    let listener = TcpListener::from_std(listener)
        .map_err(|_| "Neon-WebSocket-Port konnte nicht aktiviert werden.".to_string())?;
    let state = Arc::new(ListenerState {
        port,
        touched: Mutex::new(Instant::now()),
        cancel: CancellationToken::new(),
        connections: Arc::new(Semaphore::new(MAX_CONNECTIONS)),
        queries: Arc::new(Semaphore::new(MAX_QUERIES)),
        cancels: Arc::new(Semaphore::new(MAX_CANCELS)),
        stats: Stats::default(),
    });
    cache.insert(target.url.clone(), state.clone());
    drop(cache);
    let guard = ListenerGuard {
        key: target.url.clone(),
        state: state.clone(),
    };
    let target = target.clone();
    handle.spawn(async move {
        serve(listener, target, guard).await;
    });
    Ok(state)
}

async fn serve(listener: TcpListener, target: Target, guard: ListenerGuard) {
    let state = &guard.state;
    let mut cleanup = tokio::time::interval(CHECK_IDLE);
    cleanup.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = state.cancel.cancelled() => break,
            _ = cleanup.tick() => if retire_idle(&target, state) { break; },
            accepted = listener.accept() => {
                let Ok((stream, address)) = accepted else { break; };
                if !address.ip().is_loopback() { continue; }
                let Ok(local_permit) = state.connections.clone().try_acquire_owned() else { continue; };
                let Ok(global_permit) = global_connections().clone().try_acquire_owned() else { continue; };
                let state = state.clone();
                let target = target.clone();
                state.stats.accepted.fetch_add(1, Ordering::Relaxed);
                let active = state.stats.active.fetch_add(1, Ordering::AcqRel) + 1;
                state.stats.peak.fetch_max(active, Ordering::AcqRel);
                let connection_guard = ConnectionGuard(state.clone());
                tokio::spawn(async move {
                    let _permits = (local_permit, global_permit, connection_guard);
                    let result = tokio::select! {
                        _ = state.cancel.cancelled() => Ok(()),
                        result = forward(stream, &target, &state) => result,
                    };
                    if result.is_err() { state.stats.failures.fetch_add(1, Ordering::Relaxed); }
                });
            }
        }
    }
}

fn websocket_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .read_buffer_size(CHUNK)
        .write_buffer_size(CHUNK)
        .max_write_buffer_size(CHUNK * 3)
        .max_message_size(Some(MAX_MESSAGE))
        .max_frame_size(Some(MAX_MESSAGE))
}

async fn forward(mut stream: TcpStream, target: &Target, state: &ListenerState) -> Result<(), ()> {
    stream.set_nodelay(true).map_err(|_| ())?;
    let mut header = [0u8; 8];
    tokio::time::timeout(HANDSHAKE, stream.read_exact(&mut header))
        .await
        .map_err(|_| ())?
        .map_err(|_| ())?;
    let length = u32::from_be_bytes(header[..4].try_into().map_err(|_| ())?);
    let protocol = u32::from_be_bytes(header[4..].try_into().map_err(|_| ())?);
    let cancel = protocol == 80_877_102 && length == 16;
    if !cancel && (protocol != 196_608 || !(8..=1024 * 1024).contains(&length)) {
        return Err(());
    }
    let _permit = if cancel {
        state.cancels.clone().try_acquire_owned()
    } else {
        state.queries.clone().try_acquire_owned()
    }
    .map_err(|_| ())?;
    let _global = if cancel {
        global_cancels().clone().try_acquire_owned()
    } else {
        global_queries().clone().try_acquire_owned()
    }
    .map_err(|_| ())?;
    let (websocket, _) = tokio::time::timeout(
        HANDSHAKE,
        tokio_tungstenite::connect_async_with_config(
            target.url.as_str(),
            Some(websocket_config()),
            true,
        ),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())?;
    state.stats.opened.fetch_add(1, Ordering::Relaxed);
    let (mut sender, mut receiver) = websocket.split();
    sender
        .send(Message::Binary(header.to_vec().into()))
        .await
        .map_err(|_| ())?;
    state
        .stats
        .sent
        .fetch_add(header.len() as u64, Ordering::Relaxed);
    let (mut read, mut write) = stream.into_split();
    let (controls, mut control) = tokio::sync::mpsc::channel(1);
    let upload = async {
        let mut buffer = vec![0; CHUNK];
        loop {
            tokio::select! {
                message = control.recv() => if let Some(message) = message { sender.send(message).await.map_err(|_| ())?; },
                result = read.read(&mut buffer) => {
                    let count = result.map_err(|_| ())?;
                    if count == 0 { return Ok::<_, ()>(()); }
                    sender.send(Message::Binary(buffer[..count].to_vec().into())).await.map_err(|_| ())?;
                    state.stats.sent.fetch_add(count as u64, Ordering::Relaxed);
                }
            }
        }
    };
    let download = async {
        while let Some(message) = receiver.next().await {
            match message.map_err(|_| ())? {
                Message::Binary(bytes) => {
                    write.write_all(&bytes).await.map_err(|_| ())?;
                    state
                        .stats
                        .received
                        .fetch_add(bytes.len() as u64, Ordering::Relaxed);
                }
                Message::Ping(bytes) => {
                    let _ = controls.try_send(Message::Pong(bytes));
                }
                Message::Pong(_) => {}
                Message::Close(_) => return Ok(()),
                _ => return Err(()),
            }
        }
        Ok::<_, ()>(())
    };
    tokio::select! {
        _ = state.cancel.cancelled() => Ok(()),
        result = upload => result,
        result = download => result,
    }
}

pub(crate) fn rewrite_connection_url(value: &str) -> Result<Option<String>, String> {
    let url = url::Url::parse(value).map_err(|_| "Ungültige PostgreSQL-URL".to_string())?;
    let Some(target) = target(&url)? else {
        return Ok(None);
    };
    let state = ensure(&target)?;
    rewrite_with_port(url, state.port).map(Some)
}

fn rewrite_with_port(mut url: url::Url, port: u16) -> Result<String, String> {
    let mut pairs = url
        .query_pairs()
        .filter(|(key, _)| !matches!(key.as_ref(), "l8db_transport" | "sslmode" | "sslrootcert"))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    pairs.push(("sslmode".into(), "disable".into()));
    url.set_host(Some("127.0.0.1"))
        .map_err(|_| "Neon-WebSocket-Port konnte nicht eingesetzt werden.".to_string())?;
    url.set_port(Some(port))
        .map_err(|_| "Neon-WebSocket-Port konnte nicht eingesetzt werden.".to_string())?;
    url.set_query(None);
    url.query_pairs_mut().extend_pairs(pairs);
    Ok(url.into())
}

pub(crate) fn managed_port(config: &tokio_postgres::Config) -> u16 {
    if !matches!(config.get_hosts(), [tokio_postgres::config::Host::Tcp(host)] if host == "127.0.0.1")
    {
        return 0;
    }
    let port = config.get_ports().first().copied().unwrap_or_default();
    listeners()
        .lock()
        .ok()
        .filter(|cache| {
            cache
                .values()
                .any(|state| state.port == port && !state.cancel.is_cancelled())
        })
        .map_or(0, |_| port)
}

#[cfg(test)]
#[path = "neon_websocket_tests.rs"]
mod tests;
