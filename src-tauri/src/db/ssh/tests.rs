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
