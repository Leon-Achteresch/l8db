use std::path::PathBuf;
use std::sync::Arc;

use russh::client::{AuthResult, Handle, Handler};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::agent::AgentIdentity;
use russh::keys::{Algorithm, HashAlg, PrivateKeyWithHashAlg};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum SshAuthRequest {
    Password {
        password: String,
    },
    Key {
        key_file: String,
        #[serde(default)]
        passphrase: Option<String>,
    },
    Agent {
        #[serde(default)]
        agent_socket: Option<String>,
    },
}

type DynAgent = AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>;

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub fn expand_home(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" {
        if let Some(home) = home_dir() {
            return home;
        }
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn rejected() -> String {
    "SSH-Authentifizierung abgelehnt (Benutzer, Passwort oder Key prüfen).".to_string()
}

fn failed(error: impl std::fmt::Display) -> String {
    format!("SSH-Verbindung fehlgeschlagen: {error}")
}

async fn rsa_hash<H: Handler>(handle: &Handle<H>, algorithm: &Algorithm) -> Option<HashAlg> {
    if !matches!(algorithm, Algorithm::Rsa { .. }) {
        return None;
    }
    handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten()
}

pub async fn authenticate<H: Handler>(
    handle: &mut Handle<H>,
    user: &str,
    auth: &SshAuthRequest,
) -> Result<(), String> {
    let result = match auth {
        SshAuthRequest::Password { password } => handle
            .authenticate_password(user, password.as_str())
            .await
            .map_err(failed)?,
        SshAuthRequest::Key {
            key_file,
            passphrase,
        } => {
            let path = expand_home(key_file);
            let key = russh::keys::load_secret_key(&path, passphrase.as_deref()).map_err(|e| {
                format!(
                    "SSH-Key {} konnte nicht geladen werden: {e}",
                    path.display()
                )
            })?;
            let hash = rsa_hash(handle, &key.algorithm()).await;
            handle
                .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await
                .map_err(failed)?
        }
        SshAuthRequest::Agent { agent_socket } => {
            return authenticate_agent(handle, user, agent_socket.as_deref()).await;
        }
    };
    match result {
        AuthResult::Success => Ok(()),
        _ => Err(rejected()),
    }
}

async fn authenticate_agent<H: Handler>(
    handle: &mut Handle<H>,
    user: &str,
    socket: Option<&str>,
) -> Result<(), String> {
    let (mut agent, location) = connect_agent(socket).await?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("SSH-Agent ({location}) hat keine Schlüssel geliefert: {e}"))?;
    if identities.is_empty() {
        return Err(format!(
            "SSH-Agent ({location}) enthält keine Schlüssel. Füge einen Key mit ssh-add hinzu oder gib ihn in 1Password für SSH frei."
        ));
    }
    let count = identities.len();
    for identity in identities {
        let result = match identity {
            AgentIdentity::PublicKey { key, .. } => {
                let hash = rsa_hash(handle, &key.algorithm()).await;
                handle
                    .authenticate_publickey_with(user, key, hash, &mut agent)
                    .await
            }
            AgentIdentity::Certificate { certificate, .. } => {
                let hash = rsa_hash(handle, &certificate.algorithm()).await;
                handle
                    .authenticate_certificate_with(user, certificate, hash, &mut agent)
                    .await
            }
        };
        match result {
            Ok(AuthResult::Success) => return Ok(()),
            Ok(_) => continue,
            Err(e) => {
                return Err(format!(
                "SSH-Agent ({location}) konnte nicht signieren: {e}. Wurde die Freigabe abgelehnt?"
            ))
            }
        }
    }
    Err(format!(
        "SSH-Authentifizierung abgelehnt: keiner der {count} Schlüssel im SSH-Agent ({location}) wurde für {user} akzeptiert."
    ))
}

fn custom_socket(socket: Option<&str>) -> Option<&str> {
    socket.map(str::trim).filter(|value| !value.is_empty())
}

#[cfg(unix)]
async fn connect_agent(socket: Option<&str>) -> Result<(DynAgent, String), String> {
    let path = match custom_socket(socket) {
        Some(custom) => expand_home(custom),
        None => std::env::var_os("SSH_AUTH_SOCK")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| {
                "SSH_AUTH_SOCK ist nicht gesetzt. Starte einen SSH-Agent oder gib den Agent-Socket an."
                    .to_string()
            })?,
    };
    let location = path.display().to_string();
    let client = AgentClient::connect_uds(&path)
        .await
        .map_err(|e| format!("SSH-Agent unter {location} ist nicht erreichbar: {e}"))?;
    Ok((client.dynamic(), location))
}

#[cfg(windows)]
async fn connect_agent(socket: Option<&str>) -> Result<(DynAgent, String), String> {
    let pipe = custom_socket(socket)
        .map(str::to_string)
        .or_else(|| {
            std::env::var("SSH_AUTH_SOCK")
                .ok()
                .filter(|v| !v.is_empty())
        })
        .unwrap_or_else(|| r"\\.\pipe\openssh-ssh-agent".to_string());
    if pipe.eq_ignore_ascii_case("pageant") {
        let client = AgentClient::connect_pageant()
            .await
            .map_err(|e| format!("Pageant ist nicht erreichbar: {e}"))?;
        return Ok((client.dynamic(), "Pageant".to_string()));
    }
    let client = AgentClient::connect_named_pipe(&pipe)
        .await
        .map_err(|e| format!("SSH-Agent unter {pipe} ist nicht erreichbar: {e}"))?;
    Ok((client.dynamic(), pipe))
}

#[cfg(test)]
mod tests {
    use super::{expand_home, SshAuthRequest};

    #[test]
    fn auth_request_matches_frontend_shape() {
        let password: SshAuthRequest =
            serde_json::from_str(r#"{"method":"password","password":"pw"}"#).unwrap();
        assert!(matches!(password, SshAuthRequest::Password { password } if password == "pw"));
        let key: SshAuthRequest =
            serde_json::from_str(r#"{"method":"key","key_file":"/k"}"#).unwrap();
        assert!(matches!(
            key,
            SshAuthRequest::Key {
                passphrase: None,
                ..
            }
        ));
        let agent: SshAuthRequest = serde_json::from_str(r#"{"method":"agent"}"#).unwrap();
        assert!(matches!(
            agent,
            SshAuthRequest::Agent { agent_socket: None }
        ));
        let custom: SshAuthRequest =
            serde_json::from_str(r#"{"method":"agent","agent_socket":"~/a.sock"}"#).unwrap();
        assert!(
            matches!(custom, SshAuthRequest::Agent { agent_socket: Some(ref s) } if s == "~/a.sock")
        );
    }

    #[test]
    fn expands_tilde_paths() {
        let home = super::home_dir().expect("home");
        assert_eq!(
            expand_home("~/.1password/agent.sock"),
            home.join(".1password/agent.sock")
        );
        assert_eq!(
            expand_home("/abs/path"),
            std::path::PathBuf::from("/abs/path")
        );
    }
}
