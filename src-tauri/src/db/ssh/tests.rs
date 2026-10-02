use super::proxy::ProxyKind;
use super::{
    ProxyRequest, ProxyTunnelRequest, SshAuthRequest, SshHopRequest, SshTunnelManager,
    SshTunnelRequest,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn manager() -> SshTunnelManager {
    SshTunnelManager {
        tunnels: Default::default(),
        notifier: Default::default(),
    }
}

fn lab_host() -> String {
    std::env::var("L8DB_E2E_SSH_HOST").unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn lab_port() -> u16 {
    std::env::var("L8DB_E2E_SSH_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2222)
}

fn lab_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} is required for this lab test"))
}

fn lab_key() -> String {
    let key_file =
        std::env::var("L8DB_E2E_KEY_FILE").unwrap_or_else(|_| "/tmp/l8db-e2e-client".to_string());
    assert!(
        std::path::Path::new(&key_file).exists(),
        "SSH test key is required"
    );
    key_file
}

fn lab_password() -> SshAuthRequest {
    SshAuthRequest::Password {
        password: "sshtestpw".to_string(),
    }
}

fn request(id: &str, auth: SshAuthRequest) -> SshTunnelRequest {
    SshTunnelRequest {
        id: id.to_string(),
        host: lab_host(),
        port: lab_port(),
        user: "root".to_string(),
        auth,
        jump_hosts: Vec::new(),
        proxy: None,
        remote_host: "l8db-pg".to_string(),
        remote_port: 5432,
        accept_new_host_key: true,
    }
}

fn lab_proxy(kind: ProxyKind, variable: &str) -> ProxyRequest {
    let address = lab_env(variable);
    let (host, port) = address.rsplit_once(':').expect("host:port");
    ProxyRequest {
        kind,
        host: host.to_string(),
        port: port.parse().expect("port"),
        username: Some("proxyuser".to_string()),
        password: Some("proxypw".to_string()),
    }
}

fn lab_socks() -> ProxyRequest {
    lab_proxy(ProxyKind::Socks5, "L8DB_E2E_SOCKS_ADDR")
}

fn lab_http_proxy() -> ProxyRequest {
    lab_proxy(ProxyKind::Http, "L8DB_E2E_HTTP_PROXY_ADDR")
}

fn local_proxy(kind: ProxyKind, port: u16) -> ProxyRequest {
    ProxyRequest {
        kind,
        host: "127.0.0.1".to_string(),
        port,
        username: None,
        password: None,
    }
}

async fn query_through_tunnel(port: u16) -> Result<i32, String> {
    let mut config = tokio_postgres::Config::new();
    config
        .host("127.0.0.1")
        .port(port)
        .user("postgres")
        .password("testpw")
        .dbname("testdb");
    let (client, connection) = config
        .connect(tokio_postgres::NoTls)
        .await
        .map_err(|e| format!("PG connect: {e}"))?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    client
        .query_one("SELECT 41 + 1", &[])
        .await
        .map_err(|e| format!("PG query: {e}"))
        .map(|row| row.get(0))
}

fn lab_known_hosts() -> std::path::PathBuf {
    std::env::var_os("L8DB_KNOWN_HOSTS")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::temp_dir().join(format!("l8db-e2e-known-hosts-{}", std::process::id()))
        })
}

async fn closed_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    listener.local_addr().unwrap().port()
}

async fn fake_socks5_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut client, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut greeting = [0u8; 3];
                client.read_exact(&mut greeting).await.unwrap();
                client.write_all(&[5, 0]).await.unwrap();
                let mut head = [0u8; 4];
                client.read_exact(&mut head).await.unwrap();
                let mut addr = [0u8; 4];
                client.read_exact(&mut addr).await.unwrap();
                let mut port = [0u8; 2];
                client.read_exact(&mut port).await.unwrap();
                let target = std::net::SocketAddr::from((addr, u16::from_be_bytes(port)));
                let Ok(mut upstream) = tokio::net::TcpStream::connect(target).await else {
                    let _ = client.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]).await;
                    return;
                };
                client
                    .write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0])
                    .await
                    .unwrap();
                let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
            });
        }
    });
    port
}

async fn echo_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut buf = [0u8; 64];
                while let Ok(n) = socket.read(&mut buf).await {
                    if n == 0 || socket.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
            });
        }
    });
    port
}

#[tokio::test]
async fn proxy_tunnel_forwards_through_socks5() {
    let echo_port = echo_server().await;
    let proxy_port = fake_socks5_server().await;
    let manager = manager();
    let info = manager
        .open_proxy(ProxyTunnelRequest {
            id: "proxy".to_string(),
            proxy: local_proxy(ProxyKind::Socks5, proxy_port),
            remote_host: "127.0.0.1".to_string(),
            remote_port: echo_port,
        })
        .await
        .expect("proxy tunnel");
    let mut local = tokio::net::TcpStream::connect(("127.0.0.1", info.local_port))
        .await
        .unwrap();
    local.write_all(b"ping").await.unwrap();
    let mut reply = [0u8; 4];
    local.read_exact(&mut reply).await.unwrap();
    assert_eq!(&reply, b"ping");
    assert_eq!(manager.list().await.len(), 1);
    manager.close("proxy").await.unwrap();
    assert!(manager.list().await.is_empty());
}

#[tokio::test]
async fn proxy_tunnel_fails_loudly_when_target_is_refused() {
    let target = closed_port().await;
    let proxy_port = fake_socks5_server().await;
    let err = manager()
        .open_proxy(ProxyTunnelRequest {
            id: "refused".to_string(),
            proxy: local_proxy(ProxyKind::Socks5, proxy_port),
            remote_host: "127.0.0.1".to_string(),
            remote_port: target,
        })
        .await
        .expect_err("must fail");
    assert!(err.contains("SOCKS5-Proxy"), "{err}");
    assert!(err.contains("Verbindung verweigert"), "{err}");
}

#[tokio::test]
async fn proxy_tunnel_fails_loudly_when_proxy_is_down() {
    let proxy_port = closed_port().await;
    let manager = manager();
    let err = manager
        .open_proxy(ProxyTunnelRequest {
            id: "down".to_string(),
            proxy: local_proxy(ProxyKind::Http, proxy_port),
            remote_host: "db".to_string(),
            remote_port: 5432,
        })
        .await
        .expect_err("must fail");
    assert!(
        err.contains("HTTP-Proxy") && err.contains("nicht erreichbar"),
        "{err}"
    );
    assert!(manager.list().await.is_empty());
}

#[tokio::test]
async fn ssh_via_unreachable_proxy_fails_loudly() {
    let proxy_port = closed_port().await;
    let mut proxied = request("proxied", lab_password());
    proxied.proxy = Some(local_proxy(ProxyKind::Socks5, proxy_port));
    let err = manager().open(proxied).await.expect_err("must fail");
    assert!(
        err.contains("SSH-Server") && err.contains("SOCKS5-Proxy"),
        "{err}"
    );
}

#[tokio::test]
async fn jump_chain_requires_complete_hops() {
    let mut bad = request("incomplete", lab_password());
    bad.jump_hosts.push(SshHopRequest {
        host: "bastion".to_string(),
        port: 22,
        user: String::new(),
        auth: lab_password(),
    });
    let err = manager().open(bad).await.expect_err("must fail");
    assert!(err.contains("Sprung-Host"), "{err}");
}

struct LocalSshServer {
    password: std::sync::Arc<std::sync::Mutex<String>>,
    password_attempts: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl russh::server::Handler for LocalSshServer {
    type Error = russh::Error;

    async fn auth_password(
        &mut self,
        _user: &str,
        password: &str,
    ) -> Result<russh::server::Auth, Self::Error> {
        self.password_attempts
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if password == *self.password.lock().unwrap() {
            Ok(russh::server::Auth::Accept)
        } else {
            Ok(russh::server::Auth::reject())
        }
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: russh::Channel<russh::server::Msg>,
        host_to_connect: &str,
        port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut russh::server::Session,
    ) -> Result<(), Self::Error> {
        let target = format!("{host_to_connect}:{port_to_connect}");
        let Ok(mut upstream) = tokio::net::TcpStream::connect(target).await else {
            reply.reject(russh::ChannelOpenFailure::ConnectFailed).await;
            return Ok(());
        };
        reply.accept().await;
        tokio::spawn(async move {
            let mut stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut stream, &mut upstream).await;
        });
        Ok(())
    }
}

type LocalSessions = std::sync::Arc<std::sync::Mutex<Vec<russh::server::Handle>>>;

fn local_host_key(seed: u8) -> russh::keys::PrivateKey {
    russh::keys::PrivateKey::from(russh::keys::ssh_key::private::Ed25519Keypair::from_seed(
        &[seed; 32],
    ))
}

const LOCAL_ECDSA_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAaAAAABNlY2RzYS
1zaGEyLW5pc3RwMjU2AAAACG5pc3RwMjU2AAAAQQSNha1jlZOqmsdyKfcLs6Mn35cQfhIo
lUjBVsdexMoeAyg3dbcGObQSO3g7vUVjA0i4Od4CM2Xy6tZF2FpsUivKAAAAoJTguUuU4L
lLAAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBI2FrWOVk6qax3Ip
9wuzoyfflxB+EiiVSMFWx17Eyh4DKDd1twY5tBI7eDu9RWMDSLg53gIzZfLq1kXYWmxSK8
oAAAAhANlX1Ygr62VLaQQUTMSiBHL7qpy7CUSN+2WSWKsgNl+cAAAAAAECAwQFBgc=
-----END OPENSSH PRIVATE KEY-----
";

#[derive(Clone)]
struct LocalServerControl {
    port: u16,
    sessions: LocalSessions,
    key: std::sync::Arc<std::sync::Mutex<russh::keys::PrivateKey>>,
    blackhole: std::sync::Arc<std::sync::atomic::AtomicBool>,
    blackholed: std::sync::Arc<std::sync::Mutex<Vec<tokio::net::TcpStream>>>,
    password: std::sync::Arc<std::sync::Mutex<String>>,
    password_attempts: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl LocalServerControl {
    fn set_key(&self, key: russh::keys::PrivateKey) {
        *self.key.lock().unwrap() = key;
    }

    fn set_blackhole(&self, enabled: bool) {
        self.blackhole
            .store(enabled, std::sync::atomic::Ordering::SeqCst);
    }

    fn blackholed_count(&self) -> usize {
        self.blackholed.lock().unwrap().len()
    }

    fn set_password(&self, password: &str) {
        *self.password.lock().unwrap() = password.to_string();
    }

    fn password_attempts(&self) -> usize {
        self.password_attempts
            .load(std::sync::atomic::Ordering::SeqCst)
    }
}

async fn controlled_local_ssh_server(key: russh::keys::PrivateKey) -> LocalServerControl {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let control = LocalServerControl {
        port: listener.local_addr().unwrap().port(),
        sessions: Default::default(),
        key: std::sync::Arc::new(std::sync::Mutex::new(key)),
        blackhole: Default::default(),
        blackholed: Default::default(),
        password: std::sync::Arc::new(std::sync::Mutex::new("local-pw".to_string())),
        password_attempts: Default::default(),
    };
    let server = control.clone();
    tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            if server.blackhole.load(std::sync::atomic::Ordering::SeqCst) {
                server.blackholed.lock().unwrap().push(socket);
                continue;
            }
            let key = server.key.lock().unwrap().clone();
            let config = std::sync::Arc::new(russh::server::Config {
                keys: vec![key],
                auth_rejection_time: std::time::Duration::from_millis(10),
                inactivity_timeout: None,
                ..Default::default()
            });
            let handler = LocalSshServer {
                password: server.password.clone(),
                password_attempts: server.password_attempts.clone(),
            };
            let Ok(running) = russh::server::run_stream(config, socket, handler).await else {
                continue;
            };
            server.sessions.lock().unwrap().push(running.handle());
            tokio::spawn(running);
        }
    });
    control
}

async fn local_ssh_server() -> (u16, LocalSessions) {
    let control = controlled_local_ssh_server(local_host_key(7)).await;
    (control.port, control.sessions)
}

fn local_tunnel_request(
    id: &str,
    ssh_port: u16,
    remote_port: u16,
    jumps: usize,
) -> SshTunnelRequest {
    let auth = SshAuthRequest::Password {
        password: "local-pw".to_string(),
    };
    SshTunnelRequest {
        id: id.to_string(),
        host: "127.0.0.1".to_string(),
        port: ssh_port,
        user: "tester".to_string(),
        auth: auth.clone(),
        jump_hosts: (0..jumps)
            .map(|_| SshHopRequest {
                host: "127.0.0.1".to_string(),
                port: ssh_port,
                user: "tester".to_string(),
                auth: auth.clone(),
            })
            .collect(),
        proxy: None,
        remote_host: "127.0.0.1".to_string(),
        remote_port,
        accept_new_host_key: true,
    }
}

async fn echo_roundtrip(port: u16, payload: &[u8]) -> Result<Vec<u8>, String> {
    echo_roundtrip_within(port, payload, std::time::Duration::from_secs(10)).await
}

async fn echo_roundtrip_within(
    port: u16,
    payload: &[u8],
    limit: std::time::Duration,
) -> Result<Vec<u8>, String> {
    let exchange = async {
        let mut socket = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .map_err(|e| e.to_string())?;
        socket.write_all(payload).await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; payload.len()];
        socket
            .read_exact(&mut buf)
            .await
            .map_err(|e| e.to_string())?;
        Ok::<_, String>(buf)
    };
    tokio::time::timeout(limit, exchange)
        .await
        .map_err(|_| "timeout".to_string())?
}

async fn disconnect_sessions(sessions: &LocalSessions) {
    let handles: Vec<_> = sessions.lock().unwrap().drain(..).collect();
    for handle in handles {
        let _ = handle
            .disconnect(
                russh::Disconnect::ByApplication,
                String::new(),
                String::new(),
            )
            .await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
}

fn use_local_known_hosts() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("l8db-local-known-hosts-{}", std::process::id()));
    std::env::set_var("L8DB_KNOWN_HOSTS", &path);
    path
}

async fn assert_tunnel_survives_session_loss(id: &str, jumps: usize) {
    use_local_known_hosts();
    let echo_port = echo_server().await;
    let (ssh_port, sessions) = local_ssh_server().await;
    let manager = manager();
    let info = manager
        .open(local_tunnel_request(id, ssh_port, echo_port, jumps))
        .await
        .expect("tunnel open");
    assert_eq!(
        echo_roundtrip(info.local_port, b"first").await.unwrap(),
        b"first"
    );
    assert_eq!(sessions.lock().unwrap().len(), jumps + 1);

    disconnect_sessions(&sessions).await;
    assert_eq!(
        echo_roundtrip(info.local_port, b"after-loss")
            .await
            .unwrap(),
        b"after-loss"
    );
    assert_eq!(sessions.lock().unwrap().len(), jumps + 1);

    disconnect_sessions(&sessions).await;
    assert_eq!(
        echo_roundtrip(info.local_port, b"again").await.unwrap(),
        b"again"
    );
    manager.close(id).await.expect("close");
}

#[tokio::test]
async fn ssh_tunnel_reconnects_after_session_loss() {
    assert_tunnel_survives_session_loss("local-reconnect", 0).await;
}

#[tokio::test]
async fn ssh_tunnel_reconnects_jump_chain_after_session_loss() {
    assert_tunnel_survives_session_loss("local-reconnect-jump", 1).await;
}

fn recording_manager() -> (
    SshTunnelManager,
    std::sync::Arc<std::sync::Mutex<Vec<super::TunnelFailure>>>,
) {
    let manager = manager();
    let failures: std::sync::Arc<std::sync::Mutex<Vec<super::TunnelFailure>>> = Default::default();
    let sink = failures.clone();
    manager.notify_with(std::sync::Arc::new(move |failure| {
        sink.lock().unwrap().push(failure);
    }));
    (manager, failures)
}

#[tokio::test]
async fn ssh_reconnect_rejects_host_key_of_other_algorithm() {
    let known_hosts = use_local_known_hosts();
    let echo_port = echo_server().await;
    let server = controlled_local_ssh_server(local_host_key(11)).await;
    let (manager, failures) = recording_manager();
    let info = manager
        .open(local_tunnel_request(
            "local-reconnect-pin",
            server.port,
            echo_port,
            0,
        ))
        .await
        .expect("tunnel open");
    assert_eq!(
        echo_roundtrip(info.local_port, b"first").await.unwrap(),
        b"first"
    );

    server.set_key(russh::keys::PrivateKey::from_openssh(LOCAL_ECDSA_KEY).unwrap());
    disconnect_sessions(&server.sessions).await;
    assert!(echo_roundtrip(info.local_port, b"mitm").await.is_err());

    let entry = format!("[127.0.0.1]:{} ", server.port);
    let learned: Vec<String> = std::fs::read_to_string(&known_hosts)
        .unwrap_or_default()
        .lines()
        .filter(|line| line.starts_with(&entry))
        .map(str::to_string)
        .collect();
    assert_eq!(learned.len(), 1, "{learned:?}");
    assert!(learned[0].contains("ssh-ed25519"), "{learned:?}");

    let reported = failures.lock().unwrap().clone();
    assert_eq!(reported.len(), 1, "{reported:?}");
    assert_eq!(reported[0].id, "local-reconnect-pin");
    assert!(reported[0].fatal, "{reported:?}");
    assert!(reported[0].error.contains("geändert"), "{reported:?}");
    assert!(manager.list().await.is_empty());

    manager.close("local-reconnect-pin").await.expect("close");
}

#[tokio::test]
async fn ssh_reconnect_failure_is_shared_and_skips_abandoned_clients() {
    use_local_known_hosts();
    let echo_port = echo_server().await;
    let server = controlled_local_ssh_server(local_host_key(13)).await;
    let (manager, failures) = recording_manager();
    let info = manager
        .open(local_tunnel_request(
            "local-reconnect-blackhole",
            server.port,
            echo_port,
            0,
        ))
        .await
        .expect("tunnel open");
    assert_eq!(
        echo_roundtrip(info.local_port, b"first").await.unwrap(),
        b"first"
    );

    server.set_blackhole(true);
    disconnect_sessions(&server.sessions).await;
    let port = info.local_port;
    let waiting = tokio::spawn(async move {
        echo_roundtrip_within(port, b"waiting", std::time::Duration::from_secs(40)).await
    });
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    for _ in 0..2 {
        let socket = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        drop(socket);
    }
    assert!(waiting.await.unwrap().is_err());

    let started = std::time::Instant::now();
    assert!(echo_roundtrip(port, b"late").await.is_err());
    assert!(
        started.elapsed() < std::time::Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    assert_eq!(server.blackholed_count(), 1);
    let reported = failures.lock().unwrap().clone();
    assert_eq!(reported.len(), 1, "{reported:?}");
    assert!(!reported[0].fatal, "{reported:?}");
    assert_eq!(manager.list().await.len(), 1);

    server.set_blackhole(false);
    tokio::time::sleep(super::RECONNECT_BACKOFF).await;
    assert_eq!(echo_roundtrip(port, b"back").await.unwrap(), b"back");
    manager
        .close("local-reconnect-blackhole")
        .await
        .expect("close");
}

#[test]
fn ssh_client_config_keeps_idle_sessions_alive() {
    let config = super::client_config();
    let interval = config.keepalive_interval.expect("keepalive interval");
    assert!(interval <= std::time::Duration::from_secs(60));
    assert!(config.keepalive_max > 0);
    if let Some(timeout) = config.inactivity_timeout {
        assert!(timeout > interval * (config.keepalive_max as u32 + 1));
    }
}

#[test]
fn tunnel_request_accepts_payload_without_network_fields() {
    let request: SshTunnelRequest = serde_json::from_str(
        r#"{"id":"a","host":"h","port":22,"user":"u","auth":{"method":"key","key_file":"/k"},"remote_host":"db","remote_port":5432,"accept_new_host_key":false}"#,
    )
    .unwrap();
    assert!(request.jump_hosts.is_empty());
    assert!(request.proxy.is_none());
}

#[tokio::test]
#[ignore]
async fn tunnel_password_auth_end_to_end() {
    std::env::set_var("L8DB_KNOWN_HOSTS", lab_known_hosts());
    let manager = manager();
    let info = manager
        .open(request("e2e-pw", lab_password()))
        .await
        .expect("tunnel open");
    let value = query_through_tunnel(info.local_port).await.expect("query");
    assert_eq!(value, 42);
    manager.close("e2e-pw").await.expect("close");
    assert!(manager.list().await.is_empty());
}

#[tokio::test]
#[ignore]
async fn tunnel_key_auth_end_to_end() {
    std::env::set_var("L8DB_KNOWN_HOSTS", lab_known_hosts());
    let manager = manager();
    let info = manager
        .open(request(
            "e2e-key",
            SshAuthRequest::Key {
                key_file: lab_key(),
                passphrase: None,
            },
        ))
        .await
        .expect("tunnel open");
    let value = query_through_tunnel(info.local_port).await.expect("query");
    assert_eq!(value, 42);
    manager.close("e2e-key").await.expect("close");
}

#[tokio::test]
#[ignore]
async fn tunnel_agent_auth_end_to_end() {
    std::env::set_var("L8DB_KNOWN_HOSTS", lab_known_hosts());
    let manager = manager();
    let info = manager
        .open(request(
            "e2e-agent",
            SshAuthRequest::Agent {
                agent_socket: Some(lab_env("L8DB_E2E_AGENT_SOCK")),
            },
        ))
        .await
        .expect("tunnel open");
    let value = query_through_tunnel(info.local_port).await.expect("query");
    assert_eq!(value, 42);
    manager.close("e2e-agent").await.expect("close");
}

#[tokio::test]
#[ignore]
async fn tunnel_agent_with_foreign_keys_is_rejected() {
    std::env::set_var("L8DB_KNOWN_HOSTS", lab_known_hosts());
    let err = manager()
        .open(request(
            "e2e-agent-foreign",
            SshAuthRequest::Agent {
                agent_socket: Some(lab_env("L8DB_E2E_FOREIGN_AGENT_SOCK")),
            },
        ))
        .await
        .expect_err("must fail");
    assert!(err.contains("SSH-Agent"), "{err}");
}

#[tokio::test]
#[ignore]
async fn tunnel_jump_host_end_to_end() {
    std::env::set_var("L8DB_KNOWN_HOSTS", lab_known_hosts());
    let jump_port: u16 = lab_env("L8DB_E2E_JUMP_PORT").parse().expect("port");
    let manager = manager();
    let mut chained = request("e2e-jump", lab_password());
    chained.host = "l8db-ssh".to_string();
    chained.port = 22;
    chained.jump_hosts.push(SshHopRequest {
        host: lab_host(),
        port: jump_port,
        user: "root".to_string(),
        auth: SshAuthRequest::Key {
            key_file: lab_key(),
            passphrase: None,
        },
    });
    let info = manager.open(chained).await.expect("tunnel open");
    assert_eq!(info.jump_hosts.len(), 1);
    let value = query_through_tunnel(info.local_port).await.expect("query");
    assert_eq!(value, 42);
    manager.close("e2e-jump").await.expect("close");
}

#[tokio::test]
#[ignore]
async fn tunnel_jump_host_unknown_inner_key_rejected() {
    let original = lab_known_hosts();
    let fresh = original.with_extension("jump-fresh");
    let _ = std::fs::remove_file(&fresh);
    std::env::set_var("L8DB_KNOWN_HOSTS", &fresh);
    let jump_port: u16 = lab_env("L8DB_E2E_JUMP_PORT").parse().expect("port");
    let mut learn = request("e2e-jump-learn", lab_password());
    learn.port = jump_port;
    let manager = manager();
    manager.open(learn).await.expect("learn jump host key");
    manager.close("e2e-jump-learn").await.expect("close");
    let mut chained = request("e2e-jump-strict", lab_password());
    chained.host = "l8db-ssh".to_string();
    chained.port = 22;
    chained.accept_new_host_key = false;
    chained.jump_hosts.push(SshHopRequest {
        host: lab_host(),
        port: jump_port,
        user: "root".to_string(),
        auth: lab_password(),
    });
    let err = manager.open(chained).await.expect_err("must fail");
    let _ = std::fs::remove_file(&fresh);
    std::env::set_var("L8DB_KNOWN_HOSTS", &original);
    assert!(err.contains("SSH-Server l8db-ssh:22"), "{err}");
    assert!(err.contains("Host-Key"), "{err}");
}

#[tokio::test]
#[ignore]
async fn tunnel_via_socks_proxy_end_to_end() {
    std::env::set_var("L8DB_KNOWN_HOSTS", lab_known_hosts());
    let manager = manager();
    let mut proxied = request("e2e-socks", lab_password());
    proxied.host = "l8db-ssh".to_string();
    proxied.port = 22;
    proxied.proxy = Some(lab_socks());
    let info = manager.open(proxied).await.expect("tunnel open");
    let value = query_through_tunnel(info.local_port).await.expect("query");
    assert_eq!(value, 42);
    manager.close("e2e-socks").await.expect("close");
}

#[tokio::test]
#[ignore]
async fn tunnel_via_http_proxy_end_to_end() {
    std::env::set_var("L8DB_KNOWN_HOSTS", lab_known_hosts());
    let manager = manager();
    let mut proxied = request("e2e-http", lab_password());
    proxied.host = "l8db-ssh".to_string();
    proxied.port = 22;
    proxied.proxy = Some(lab_http_proxy());
    let info = manager.open(proxied).await.expect("tunnel open");
    let value = query_through_tunnel(info.local_port).await.expect("query");
    assert_eq!(value, 42);
    manager.close("e2e-http").await.expect("close");
}

#[tokio::test]
#[ignore]
async fn tunnel_proxy_direct_database_end_to_end() {
    for (id, proxy) in [
        ("e2e-direct-socks", lab_socks()),
        ("e2e-direct-http", lab_http_proxy()),
    ] {
        let manager = manager();
        let info = manager
            .open_proxy(ProxyTunnelRequest {
                id: id.to_string(),
                proxy,
                remote_host: "l8db-pg".to_string(),
                remote_port: 5432,
            })
            .await
            .expect("proxy tunnel");
        let value = query_through_tunnel(info.local_port).await.expect("query");
        assert_eq!(value, 42);
        manager.close(id).await.expect("close");
    }
}

#[tokio::test]
#[ignore]
async fn tunnel_proxy_wrong_credentials_fail() {
    let mut socks = lab_socks();
    socks.password = Some("falsch".to_string());
    let err = manager()
        .open_proxy(ProxyTunnelRequest {
            id: "e2e-socks-bad".to_string(),
            proxy: socks,
            remote_host: "l8db-pg".to_string(),
            remote_port: 5432,
        })
        .await
        .expect_err("must fail");
    assert!(err.contains("Anmeldung abgelehnt"), "{err}");
    let mut http = lab_http_proxy();
    http.password = Some("falsch".to_string());
    let err = manager()
        .open_proxy(ProxyTunnelRequest {
            id: "e2e-http-bad".to_string(),
            proxy: http,
            remote_host: "l8db-pg".to_string(),
            remote_port: 5432,
        })
        .await
        .expect_err("must fail");
    assert!(err.contains("407"), "{err}");
}

#[tokio::test]
#[ignore]
async fn ssh_idle_tunnel_survives_end_to_end() {
    std::env::set_var("L8DB_KNOWN_HOSTS", lab_known_hosts());
    let idle = std::env::var("L8DB_E2E_SSH_IDLE_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(320);
    let manager = manager();
    let info = manager
        .open(request("e2e-idle", lab_password()))
        .await
        .expect("tunnel open");
    assert_eq!(
        query_through_tunnel(info.local_port).await.expect("query"),
        42
    );
    tokio::time::sleep(std::time::Duration::from_secs(idle)).await;
    assert_eq!(
        query_through_tunnel(info.local_port)
            .await
            .expect("query after idle"),
        42
    );
    if let Ok(command) = std::env::var("L8DB_E2E_SSH_DROP_CMD") {
        let status = std::process::Command::new("sh")
            .arg("-c")
            .arg(command)
            .status()
            .expect("drop command");
        assert!(status.success());
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        assert_eq!(
            query_through_tunnel(info.local_port)
                .await
                .expect("query after dropped session"),
            42
        );
    }
    manager.close("e2e-idle").await.expect("close");
}

#[tokio::test]
#[ignore]
async fn tunnel_wrong_password_fails() {
    std::env::set_var("L8DB_KNOWN_HOSTS", lab_known_hosts());
    let err = manager()
        .open(request(
            "e2e-bad",
            SshAuthRequest::Password {
                password: "falsch".to_string(),
            },
        ))
        .await
        .expect_err("must fail");
    assert!(
        err.contains("abgelehnt") || err.contains("Authentifizierung"),
        "{err}"
    );
}

#[tokio::test]
#[ignore]
async fn tunnel_unknown_host_key_rejected_without_consent() {
    let original = lab_known_hosts();
    let fresh = original.with_extension("fresh");
    let _ = std::fs::remove_file(&fresh);
    std::env::set_var("L8DB_KNOWN_HOSTS", &fresh);
    let mut strict = request("e2e-key", lab_password());
    strict.accept_new_host_key = false;
    let err = manager().open(strict).await.expect_err("must fail");
    std::env::set_var("L8DB_KNOWN_HOSTS", &original);
    assert!(err.contains("Host-Key"), "{err}");
}

#[tokio::test]
async fn ssh_reconnect_stops_after_rejected_login() {
    use_local_known_hosts();
    let echo_port = echo_server().await;
    let server = controlled_local_ssh_server(local_host_key(17)).await;
    let (manager, failures) = recording_manager();
    let info = manager
        .open(local_tunnel_request(
            "local-reconnect-auth",
            server.port,
            echo_port,
            0,
        ))
        .await
        .expect("tunnel open");
    assert_eq!(
        echo_roundtrip(info.local_port, b"first").await.unwrap(),
        b"first"
    );
    let logins = server.password_attempts();

    server.set_password("rotated-pw");
    disconnect_sessions(&server.sessions).await;
    for _ in 0..4 {
        assert!(echo_roundtrip(info.local_port, b"retry").await.is_err());
    }
    tokio::time::sleep(super::RECONNECT_BACKOFF + std::time::Duration::from_millis(200)).await;
    assert!(echo_roundtrip(info.local_port, b"later").await.is_err());
    assert_eq!(server.password_attempts(), logins + 1);

    let reported = failures.lock().unwrap().clone();
    assert_eq!(reported.len(), 1, "{reported:?}");
    assert!(reported[0].fatal, "{reported:?}");
    assert!(manager.list().await.is_empty());
    manager.close("local-reconnect-auth").await.expect("close");
}

#[test]
fn ssh_reconnect_backoff_grows_and_is_capped() {
    assert_eq!(super::reconnect_backoff(1), super::RECONNECT_BACKOFF);
    assert_eq!(super::reconnect_backoff(2), super::RECONNECT_BACKOFF * 2);
    assert_eq!(super::reconnect_backoff(3), super::RECONNECT_BACKOFF * 4);
    assert_eq!(super::reconnect_backoff(40), super::RECONNECT_BACKOFF_MAX);
}
