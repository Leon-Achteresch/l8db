use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;

use russh::client::{self, Handle};
use russh::keys::known_hosts::{check_known_hosts_path, learn_known_hosts_path};
use russh::keys::{HashAlg, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

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
#[serde(rename_all = "snake_case")]
pub enum SshAuthRequest {
    Password { password: String },
    Key { key_file: String, passphrase: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelRequest {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuthRequest,
    pub remote_host: String,
    pub remote_port: u16,
    pub accept_new_host_key: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshTunnelInfo {
    pub id: String,
    pub local_port: u16,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub remote_host: String,
    pub remote_port: u16,
}

struct ActiveTunnel {
    info: SshTunnelInfo,
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

fn known_hosts_path() -> Option<PathBuf> {
    if let Some(custom) = std::env::var_os("L8DB_KNOWN_HOSTS") {
        return Some(PathBuf::from(custom));
    }
    dirs_home().map(|home| home.join(".ssh").join("known_hosts"))
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
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
                    "SSH-Zertifikate werden in Phase 2 nicht unterstützt, nur Host-Keys.".to_string(),
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

async fn authenticate(
    handle: &mut Handle<TunnelHandler>,
    user: &str,
    auth: &SshAuthRequest,
) -> Result<(), String> {
    let result = match auth {
        SshAuthRequest::Password { password } => handle
            .authenticate_password(user, password.as_str())
            .await
            .map_err(|e| format!("SSH-Verbindung fehlgeschlagen: {e}"))?,
        SshAuthRequest::Key { key_file, passphrase } => {
            let key = russh::keys::load_secret_key(key_file, passphrase.as_deref()).map_err(|e| {
                format!("SSH-Key {key_file} konnte nicht geladen werden: {e}")
            })?;
            handle
                .authenticate_publickey(
                    user,
                    PrivateKeyWithHashAlg::new(Arc::new(key), None),
                )
                .await
                .map_err(|e| format!("SSH-Verbindung fehlgeschlagen: {e}"))?
        }
    };
    match result {
        russh::client::AuthResult::Success => Ok(()),
        _ => Err("SSH-Authentifizierung abgelehnt (Benutzer, Passwort oder Key prüfen).".to_string()),
    }
}

async fn run_forwarder(
    listener: TcpListener,
    handle: Arc<Mutex<Handle<TunnelHandler>>>,
    remote_host: String,
    remote_port: u16,
) {
    loop {
        let (socket, _) = match listener.accept().await {
            Ok(pair) => pair,
            Err(_) => break,
        };
        let handle = handle.clone();
        let remote_host = remote_host.clone();
        tokio::spawn(async move {
            let channel = {
                let h = handle.lock().await;
                h.channel_open_direct_tcpip(&remote_host, remote_port as u32, "127.0.0.1", 0)
                    .await
            };
            let channel = match channel {
                Ok(channel) => channel,
                Err(_) => return,
            };
            let mut stream = channel.into_stream();
            let mut socket = socket;
            let _ = tokio::io::copy_bidirectional(&mut stream, &mut socket).await;
        });
    }
}

impl SshTunnelManager {
    pub async fn open(&self, request: SshTunnelRequest) -> Result<SshTunnelInfo, String> {
        if request.id.trim().is_empty() {
            return Err("Tunnel-ID fehlt.".to_string());
        }
        if request.host.trim().is_empty() || request.user.trim().is_empty() {
            return Err("SSH-Host und -Benutzer sind erforderlich.".to_string());
        }
        if let Some(existing) = self.tunnels.lock().await.get(&request.id) {
            if existing.info.ssh_host == request.host
                && existing.info.ssh_port == request.port
                && existing.info.ssh_user == request.user
                && existing.info.remote_host == request.remote_host
                && existing.info.remote_port == request.remote_port
            {
                return Ok(existing.info.clone());
            }
            self.close(&request.id).await?;
        }

        let addr = tokio::net::lookup_host(format!("{}:{}", request.host, request.port))
            .await
            .map_err(|e| format!("SSH-Host {} konnte nicht aufgelöst werden: {e}", request.host))?
            .next()
            .ok_or_else(|| format!("SSH-Host {} konnte nicht aufgelöst werden.", request.host))?;

        let config = Arc::new(client::Config {
            inactivity_timeout: Some(std::time::Duration::from_secs(300)),
            ..Default::default()
        });
        let handler = TunnelHandler {
            host: request.host.clone(),
            port: request.port,
            accept_new_host_key: request.accept_new_host_key,
        };
        let mut handle = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            client::connect(config, addr, handler),
        )
        .await
        .map_err(|_| "SSH-Verbindung hat länger als 15 Sekunden gedauert.".to_string())?
        .map_err(|e| {
            format!("SSH-Verbindung zu {}:{} fehlgeschlagen: {e}", request.host, request.port)
        })?;

        authenticate(&mut handle, &request.user, &request.auth).await?;

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Lokaler Tunnel-Port konnte nicht geöffnet werden: {e}"))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| format!("Lokaler Tunnel-Port konnte nicht ermittelt werden: {e}"))?
            .port();

        let info = SshTunnelInfo {
            id: request.id.clone(),
            local_port,
            ssh_host: request.host.clone(),
            ssh_port: request.port,
            ssh_user: request.user.clone(),
            remote_host: request.remote_host.clone(),
            remote_port: request.remote_port,
        };
        let shared = Arc::new(Mutex::new(handle));
        let task = tokio::spawn(run_forwarder(
            listener,
            shared,
            request.remote_host.clone(),
            request.remote_port,
        ));
        self.tunnels
            .lock()
            .await
            .insert(request.id.clone(), ActiveTunnel { info: info.clone(), task });
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
        self.tunnels.lock().await.values().map(|t| t.info.clone()).collect()
    }
}

#[tauri::command]
pub async fn open_ssh_tunnel(
    request: SshTunnelRequest,
    ssh_state: tauri::State<'_, SshState>,
) -> Result<SshTunnelInfo, String> {
    ssh_state.open(request).await
}

#[tauri::command]
pub async fn close_ssh_tunnel(id: String, ssh_state: tauri::State<'_, SshState>) -> Result<(), String> {
    ssh_state.close(&id).await
}

#[tauri::command]
pub async fn list_ssh_tunnels(ssh_state: tauri::State<'_, SshState>) -> Result<Vec<SshTunnelInfo>, String> {
    Ok(ssh_state.list().await)
}

#[cfg(test)]
mod tests {
    use super::{SshAuthRequest, SshTunnelManager, SshTunnelRequest};

    fn lab_host() -> String {
        std::env::var("L8DB_E2E_SSH_HOST").unwrap_or_else(|_| "127.0.0.1".to_string())
    }

    fn lab_port() -> u16 {
        std::env::var("L8DB_E2E_SSH_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(2222)
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
        std::env::temp_dir().join("l8db-e2e-known-hosts")
    }

    #[tokio::test]
    #[ignore]
    async fn tunnel_password_auth_end_to_end() {
        std::env::set_var("L8DB_KNOWN_HOSTS", lab_known_hosts());
        let manager = SshTunnelManager {
            tunnels: Default::default(),
        };
        let info = manager
            .open(SshTunnelRequest {
                id: "e2e-pw".to_string(),
                host: lab_host(),
                port: lab_port(),
                user: "root".to_string(),
                auth: SshAuthRequest::Password {
                    password: "sshtestpw".to_string(),
                },
                remote_host: "l8db-pg".to_string(),
                remote_port: 5432,
                accept_new_host_key: true,
            })
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
        let key_file = std::env::var("L8DB_E2E_KEY_FILE")
            .unwrap_or_else(|_| "/tmp/l8db-e2e-client".to_string());
        if !std::path::Path::new(&key_file).exists() {
            return;
        }
        let manager = SshTunnelManager {
            tunnels: Default::default(),
        };
        let info = manager
            .open(SshTunnelRequest {
                id: "e2e-key".to_string(),
                host: lab_host(),
                port: lab_port(),
                user: "root".to_string(),
                auth: SshAuthRequest::Key {
                    key_file,
                    passphrase: None,
                },
                remote_host: "l8db-pg".to_string(),
                remote_port: 5432,
                accept_new_host_key: true,
            })
            .await
            .expect("tunnel open");
        let value = query_through_tunnel(info.local_port).await.expect("query");
        assert_eq!(value, 42);
        manager.close("e2e-key").await.expect("close");
    }

    #[tokio::test]
    #[ignore]
    async fn tunnel_wrong_password_fails() {
        std::env::set_var("L8DB_KNOWN_HOSTS", lab_known_hosts());
        let manager = SshTunnelManager {
            tunnels: Default::default(),
        };
        let err = manager
            .open(SshTunnelRequest {
                id: "e2e-bad".to_string(),
                host: lab_host(),
                port: lab_port(),
                user: "root".to_string(),
                auth: SshAuthRequest::Password {
                    password: "falsch".to_string(),
                },
                remote_host: "l8db-pg".to_string(),
                remote_port: 5432,
                accept_new_host_key: true,
            })
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
        let fresh = std::env::temp_dir().join("l8db-e2e-known-hosts-fresh");
        let _ = std::fs::remove_file(&fresh);
        std::env::set_var("L8DB_KNOWN_HOSTS", &fresh);
        let manager = SshTunnelManager {
            tunnels: Default::default(),
        };
        let err = manager
            .open(SshTunnelRequest {
                id: "e2e-key".to_string(),
                host: lab_host(),
                port: lab_port(),
                user: "root".to_string(),
                auth: SshAuthRequest::Password {
                    password: "sshtestpw".to_string(),
                },
                remote_host: "l8db-pg".to_string(),
                remote_port: 5432,
                accept_new_host_key: false,
            })
            .await
            .expect_err("must fail");
        assert!(err.contains("Host-Key"), "{err}");
    }
}
