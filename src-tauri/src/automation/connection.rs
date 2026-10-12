use std::collections::HashMap;
use std::sync::Arc;

use regex::Regex;

use crate::automation::model::{AutomationConnection, ProxyDescriptor, SshAuthKind};
use crate::automation::runtime::Services;
use crate::db::ssh::{
    ProxyRequest, ProxyTunnelRequest, SshAuthRequest, SshHopRequest, SshTunnelRequest,
};
use crate::db::DatabaseKind;

#[derive(Debug)]
pub struct Resolved {
    pub id: String,
    pub name: String,
    pub kind: DatabaseKind,
    pub url: String,
    pub database: Option<String>,
    pub read_only: bool,
    pub environment: Option<String>,
    pub via: Via,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Via {
    Direct,
    Ssh(u16),
    Proxy(u16),
    Command(u16),
}

impl Via {
    pub fn label(self) -> &'static str {
        match self {
            Via::Direct => "direkt",
            Via::Ssh(_) => "SSH-Tunnel",
            Via::Proxy(_) => "Proxy",
            Via::Command(_) => "Befehls-Tunnel",
        }
    }
}

pub type ConnectionCache = HashMap<String, Arc<Resolved>>;

pub fn tunnel_id(connection_id: &str) -> String {
    format!("automation:{connection_id}")
}

pub fn unsupported_reason(connection: &AutomationConnection) -> Option<String> {
    if connection.vault {
        return Some("Verbindungen aus dem Passwortmanager können nicht unbeaufsichtigt laufen, weil ihr Passwort nur während der Sitzung vorliegt.".into());
    }
    if connection.kind == DatabaseKind::S3 {
        return Some(
            "Objektspeicher-Verbindungen unterstützen keine Automatisierungsschritte.".into(),
        );
    }
    None
}

fn lookup<'a>(
    list: &'a [AutomationConnection],
    reference: &str,
) -> Result<&'a AutomationConnection, String> {
    let reference = reference.trim();
    if let Some(found) = list.iter().find(|connection| connection.id == reference) {
        return Ok(found);
    }
    let lowered = reference.to_lowercase();
    let matches: Vec<_> = list
        .iter()
        .filter(|connection| connection.name.trim().to_lowercase() == lowered)
        .collect();
    match matches.as_slice() {
        [single] => Ok(single),
        [] => Err(format!("Verbindung „{reference}“ ist für die Automatisierung nicht verfügbar. Öffne l8db einmal, damit Verbindungen synchronisiert werden.")),
        _ => Err(format!("Verbindungsname „{reference}“ ist nicht eindeutig.")),
    }
}

fn key_value_pattern(raw: &str, keys: &str) -> Regex {
    let pattern = if raw.contains(';') {
        format!(
            r#"(?i)(^|;)(\s*(?:{keys})\s*=\s*)(\{{(?:[^}}]|\}}\}})*\}}|"(?:[^"]|"")*"|'[^']*'|[^;]*)"#
        )
    } else {
        format!(r#"(?i)(^|\s)((?:{keys})\s*=\s*)('(?:[^'\\]|\\.)*'|\S*)"#)
    };
    Regex::new(&pattern).expect("gültiges Muster")
}

fn quote_key_value(raw: &str, password: &str) -> String {
    if !raw.contains(';') {
        if !password.is_empty()
            && !password.contains(|c: char| c.is_whitespace() || c == '\'' || c == '\\')
        {
            return password.to_string();
        }
        return format!("'{}'", password.replace('\\', "\\\\").replace('\'', "\\'"));
    }
    let edge = password.starts_with(char::is_whitespace) || password.ends_with(char::is_whitespace);
    if !edge && !password.contains([';', '\'', '"', '{', '}']) {
        return password.to_string();
    }
    if Regex::new(r"(?i)(^|;)\s*(?:driver|dsn)\s*=")
        .expect("gültiges Muster")
        .is_match(raw)
    {
        return format!("{{{}}}", password.replace('}', "}}"));
    }
    format!("\"{}\"", password.replace('"', "\"\""))
}

fn key_value_has_user(raw: &str) -> bool {
    key_value_pattern(raw, "user|uid|user id|username")
        .captures_iter(raw)
        .any(|caps| !caps[3].trim().trim_matches(['\'', '"']).is_empty())
}

fn inject_key_value(raw: &str, password: &str) -> String {
    let quoted = quote_key_value(raw, password);
    if raw.contains("***") {
        return raw.replace("***", &quoted);
    }
    let pattern = key_value_pattern(raw, "password|pwd");
    if let Some(caps) = pattern.captures(raw) {
        let value = caps.get(3).expect("Gruppe");
        if !value.as_str().trim().is_empty() {
            return raw.to_string();
        }
        return format!("{}{}{}", &raw[..value.start()], quoted, &raw[value.end()..]);
    }
    if raw.contains(';') {
        format!("{};Password={quoted}", raw.trim_end().trim_end_matches(';'))
    } else {
        format!("{} password={quoted}", raw.trim_end())
    }
}

fn has_user_without_password(raw: &str) -> bool {
    if !raw.contains("://") {
        return key_value_has_user(raw)
            && !key_value_pattern(raw, "password|pwd")
                .captures(raw)
                .is_some_and(|caps| !caps[3].trim().is_empty() && &caps[3] != "***");
    }
    url::Url::parse(raw)
        .map(|url| {
            !url.username().is_empty()
                && url
                    .password()
                    .is_none_or(|p| p == "***" || p == "%2A%2A%2A")
        })
        .unwrap_or(false)
}

pub fn with_password(raw: &str, password: Option<&str>) -> String {
    let Some(password) = password.filter(|password| !password.is_empty()) else {
        return raw.to_string();
    };
    if !raw.contains("://") {
        return inject_key_value(raw, password);
    }
    let Ok(mut url) = url::Url::parse(raw) else {
        return raw.to_string();
    };
    if crate::db::set_url_password(&mut url, password).is_err() {
        return raw.to_string();
    }
    url.to_string()
}

pub fn with_secret_params(value: &str, secrets: Option<&str>) -> String {
    let Some(secrets) = secrets
        .map(|s| s.trim_start_matches(['?', '&']))
        .filter(|s| !s.is_empty())
    else {
        return value.to_string();
    };
    if !value.contains("://") {
        return value.to_string();
    }
    let (before, hash) = match value.find('#') {
        Some(index) => value.split_at(index),
        None => (value, ""),
    };
    let separator = if !before.contains('?') {
        "?"
    } else if before.ends_with('?') || before.ends_with('&') {
        ""
    } else {
        "&"
    };
    format!("{before}{separator}{secrets}{hash}")
}

pub fn rewrite_host_port(url: &str, host: &str, port: u16) -> String {
    let Some(scheme) = url.find("://") else {
        return url.to_string();
    };
    let (prefix, rest) = url.split_at(scheme + 3);
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(end);
    let userinfo = authority
        .rfind('@')
        .map(|at| &authority[..=at])
        .unwrap_or("");
    format!("{prefix}{userinfo}{host}:{port}{tail}")
}

fn decoded_key(part: &str) -> String {
    let key = part.split('=').next().unwrap_or_default();
    percent_encoding::percent_decode_str(key)
        .decode_utf8_lossy()
        .into_owned()
}

pub fn tunneled(url: &str, port: u16, kind: DatabaseKind) -> Result<String, String> {
    if !url.contains("://") {
        return Err(
            "Für Tunnel-Verbindungen wird eine URL-Verbindungszeichenfolge benötigt.".into(),
        );
    }
    if kind != DatabaseKind::Postgres {
        return Ok(rewrite_host_port(url, "127.0.0.1", port));
    }
    let mut parsed = url::Url::parse(url).map_err(|_| {
        "Für Tunnel-Verbindungen wird eine URL-Verbindungszeichenfolge benötigt.".to_string()
    })?;
    parsed.set_port(Some(port)).map_err(|_| {
        "Für Tunnel-Verbindungen wird eine URL-Verbindungszeichenfolge benötigt.".to_string()
    })?;
    let mut params: Vec<String> = parsed
        .query()
        .unwrap_or_default()
        .split('&')
        .filter(|part| {
            !part.is_empty() && !matches!(decoded_key(part).as_str(), "hostaddr" | "port")
        })
        .map(str::to_string)
        .collect();
    params.push("hostaddr=127.0.0.1".into());
    parsed.set_query(Some(&params.join("&")));
    Ok(parsed.to_string())
}

fn default_port(kind: DatabaseKind) -> Option<u16> {
    crate::db::provider::list_providers()
        .into_iter()
        .find(|provider| provider.kind == kind && provider.default_port.is_some())
        .and_then(|provider| provider.default_port)
}

fn proxy_target(url: &str, kind: DatabaseKind) -> Result<(String, u16), String> {
    let missing = || {
        "Zielhost und -port der Datenbank konnten für den Proxy nicht ermittelt werden.".to_string()
    };
    if !url.contains("://") {
        return Err(
            "Für Tunnel-Verbindungen wird eine URL-Verbindungszeichenfolge benötigt.".into(),
        );
    }
    let parsed = url::Url::parse(url).map_err(|_| missing())?;
    let host = parsed
        .host_str()
        .map(|host| {
            host.trim_start_matches('[')
                .trim_end_matches(']')
                .to_string()
        })
        .filter(|host| !host.is_empty())
        .ok_or_else(missing)?;
    let port = parsed
        .port()
        .or_else(|| default_port(kind))
        .ok_or_else(missing)?;
    Ok((host, port))
}

fn auth_request(
    auth: SshAuthKind,
    key_file: &str,
    agent_socket: Option<&str>,
    secret: Option<String>,
    label: &str,
) -> Result<SshAuthRequest, String> {
    let secret = secret.filter(|secret| !secret.is_empty());
    match auth {
        SshAuthKind::Agent => Ok(SshAuthRequest::Agent {
            agent_socket: agent_socket.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string),
        }),
        SshAuthKind::Key => {
            if key_file.trim().is_empty() {
                return Err(format!("{label}: SSH-Key-Datei fehlt – bitte Verbindung bearbeiten."));
            }
            Ok(SshAuthRequest::Key {
                key_file: key_file.trim().to_string(),
                passphrase: secret,
            })
        }
        SshAuthKind::Password => secret
            .map(|password| SshAuthRequest::Password { password })
            .ok_or_else(|| format!("{label}: SSH-Passwort fehlt – bitte Verbindung bearbeiten und erneut speichern.")),
    }
}

fn proxy_request(proxy: &ProxyDescriptor, secret: Option<String>) -> Result<ProxyRequest, String> {
    let username = proxy
        .username
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty());
    serde_json::from_value(serde_json::json!({
        "kind": proxy.kind,
        "host": proxy.host.trim(),
        "port": proxy.port,
        "username": username,
        "password": username.map(|_| secret.unwrap_or_default()),
    }))
    .map_err(|error| format!("Proxy-Konfiguration ungültig: {error}"))
}

pub struct NetworkSecrets {
    pub ssh: Option<String>,
    pub jumps: Vec<Option<String>>,
    pub proxy: Option<String>,
}

fn parse_jumps(raw: Option<String>) -> Vec<Option<String>> {
    raw.and_then(|raw| serde_json::from_str::<Vec<Option<String>>>(&raw).ok())
        .unwrap_or_default()
}

pub fn ssh_request(
    connection: &AutomationConnection,
    secrets: NetworkSecrets,
    accept_new_host_key: bool,
) -> Result<Option<SshTunnelRequest>, String> {
    let Some(ssh) = connection
        .ssh
        .as_ref()
        .filter(|ssh| !ssh.host.trim().is_empty())
    else {
        return Ok(None);
    };
    let mut jumps = secrets.jumps.into_iter();
    let jump_hosts = ssh
        .jump_hosts
        .iter()
        .enumerate()
        .map(|(index, jump)| {
            Ok(SshHopRequest {
                host: jump.host.clone(),
                port: jump.port,
                user: jump.user.clone(),
                auth: auth_request(
                    jump.auth,
                    &jump.key_file,
                    jump.agent_socket.as_deref(),
                    jumps.next().flatten(),
                    &format!("Sprung-Host {}", index + 1),
                )?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let proxy = match connection
        .proxy
        .as_ref()
        .filter(|proxy| !proxy.host.trim().is_empty())
    {
        Some(proxy) => Some(proxy_request(proxy, secrets.proxy)?),
        None => None,
    };
    Ok(Some(SshTunnelRequest {
        id: tunnel_id(&connection.id),
        host: ssh.host.clone(),
        port: ssh.port,
        user: ssh.user.clone(),
        auth: auth_request(
            ssh.auth,
            &ssh.key_file,
            ssh.agent_socket.as_deref(),
            secrets.ssh,
            "SSH",
        )?,
        jump_hosts,
        proxy,
        remote_host: if ssh.remote_host.trim().is_empty() {
            "127.0.0.1".into()
        } else {
            ssh.remote_host.clone()
        },
        remote_port: ssh.remote_port,
        accept_new_host_key,
    }))
}

async fn secret(account: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || crate::db::secrets::read_secret(&account))
        .await
        .map_err(|error| format!("Schlüsselbund-Zugriff fehlgeschlagen: {error}"))?
}

pub async fn resolve(
    services: &Services,
    cache: &mut ConnectionCache,
    reference: &str,
    database: Option<&str>,
) -> Result<Arc<Resolved>, String> {
    let database = database.map(str::trim).filter(|db| !db.is_empty());
    let key = format!("{}\u{0}{}", reference.trim(), database.unwrap_or_default());
    if let Some(found) = cache.get(&key) {
        return Ok(found.clone());
    }
    let list = services.store.connections().await?;
    let connection = lookup(&list, reference)?.clone();
    if let Some(reason) = unsupported_reason(&connection) {
        return Err(reason);
    }
    let raw = connection.connection_string.clone();
    let password = if connection.kind.is_file_based() {
        None
    } else {
        secret(connection.id.clone()).await?
    };
    if services.require_password
        && password.is_none()
        && !connection.kind.is_file_based()
        && has_user_without_password(&raw)
    {
        return Err(format!(
            "Für „{}“ ist kein Passwort im Schlüsselbund gespeichert. Speichere das Passwort in der Verbindung, damit geplante Läufe sie nutzen können.",
            connection.name
        ));
    }
    let params = secret(format!("{}:params", connection.id)).await?;
    let base = with_secret_params(&with_password(&raw, password.as_deref()), params.as_deref());
    let settings = services.store.settings().await?;
    let uses_ssh = connection
        .ssh
        .as_ref()
        .is_some_and(|ssh| !ssh.host.trim().is_empty());
    let uses_proxy = connection
        .proxy
        .as_ref()
        .is_some_and(|proxy| !proxy.host.trim().is_empty());
    let command = connection
        .command_tunnel
        .as_ref()
        .filter(|tunnel| !tunnel.command.trim().is_empty());
    let (url, via) = if let Some(command) = command {
        if !base.contains("://") {
            return Err(
                "Für Tunnel-Verbindungen wird eine URL-Verbindungszeichenfolge benötigt.".into(),
            );
        }
        let request = crate::db::ssh::command::CommandTunnelRequest {
            id: tunnel_id(&connection.id),
            command: command.command.trim().to_string(),
            local_port: command.local_port,
            timeout_secs: command.timeout_secs,
        };
        let info = services.ssh.open_command(request).await.map_err(|error| {
            format!(
                "Befehls-Tunnel für „{}“ konnte nicht gestartet werden: {error}",
                connection.name
            )
        })?;
        (
            tunneled(&base, info.local_port, connection.kind)?,
            Via::Command(info.local_port),
        )
    } else if uses_ssh {
        let secrets = NetworkSecrets {
            ssh: secret(format!("{}:ssh", connection.id)).await?,
            jumps: parse_jumps(secret(format!("{}:ssh-jumps", connection.id)).await?),
            proxy: if uses_proxy {
                secret(format!("{}:proxy", connection.id)).await?
            } else {
                None
            },
        };
        let request = ssh_request(&connection, secrets, settings.ssh_trust_new_hosts)?
            .ok_or("SSH-Konfiguration fehlt.")?;
        if !base.contains("://") {
            return Err(
                "Für Tunnel-Verbindungen wird eine URL-Verbindungszeichenfolge benötigt.".into(),
            );
        }
        let info = crate::db::execution::connect(services.ssh.open(request))
            .await
            .map_err(|error| {
                format!(
                    "SSH-Tunnel für „{}“ konnte nicht geöffnet werden: {error}",
                    connection.name
                )
            })?;
        (
            tunneled(&base, info.local_port, connection.kind)?,
            Via::Ssh(info.local_port),
        )
    } else if uses_proxy {
        let proxy = connection.proxy.as_ref().expect("Proxy gesetzt");
        let (remote_host, remote_port) = proxy_target(&base, connection.kind)?;
        let request = ProxyTunnelRequest {
            id: tunnel_id(&connection.id),
            proxy: proxy_request(proxy, secret(format!("{}:proxy", connection.id)).await?)?,
            remote_host,
            remote_port,
        };
        let info = crate::db::execution::connect(services.ssh.open_proxy(request))
            .await
            .map_err(|error| {
                format!(
                    "Proxy-Tunnel für „{}“ konnte nicht geöffnet werden: {error}",
                    connection.name
                )
            })?;
        (
            tunneled(&base, info.local_port, connection.kind)?,
            Via::Proxy(info.local_port),
        )
    } else {
        (base, Via::Direct)
    };
    let resolved = Arc::new(Resolved {
        id: connection.id,
        name: connection.name,
        kind: connection.kind,
        url,
        database: database.map(str::to_string),
        read_only: connection.read_only,
        environment: connection.environment,
        via,
    });
    cache.insert(key, resolved.clone());
    Ok(resolved)
}

pub fn adapter(
    services: &Services,
    resolved: &Resolved,
) -> Result<Box<dyn crate::db::DatabaseAdapter>, String> {
    crate::db::create_adapter_from_string(
        resolved.kind,
        &resolved.url,
        resolved.database.as_deref(),
        services.pool.clone(),
    )
}

pub async fn forget(services: &Services, connection_id: &str) {
    let _ = services.ssh.close(&tunnel_id(connection_id)).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::model::SshDescriptor;
    use crate::automation::store::Store;

    fn connection(id: &str, name: &str, kind: DatabaseKind, url: &str) -> AutomationConnection {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "name": name,
            "kind": kind,
            "connectionString": url,
        }))
        .unwrap()
    }

    fn secrets_file() -> &'static std::path::Path {
        static DIR: std::sync::OnceLock<tempfile::TempDir> = std::sync::OnceLock::new();
        let dir = DIR.get_or_init(|| {
            let dir = tempfile::tempdir().unwrap();
            std::env::set_var("L8DB_DEV_SECRETS", dir.path().join("secrets.json"));
            dir
        });
        dir.path()
    }

    async fn services(list: Vec<AutomationConnection>) -> (tempfile::TempDir, Services) {
        secrets_file();
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("automation.db")).unwrap();
        store.replace_connections(list).await.unwrap();
        (dir, Services::new(store, Arc::new(|_| {}), true))
    }

    fn unique(prefix: &str) -> String {
        format!("{prefix}-{}", crate::automation::runtime::new_id())
    }

    #[tokio::test]
    async fn injects_password_from_secret() {
        let id = unique("pg");
        let (_dir, services) = services(vec![connection(
            &id,
            "Prod",
            DatabaseKind::Postgres,
            "postgres://alice@db.example.com:5432/app?sslmode=require",
        )])
        .await;
        let mut cache = ConnectionCache::new();
        let missing = resolve(&services, &mut cache, &id, None).await.unwrap_err();
        assert!(
            missing.contains("kein Passwort im Schlüsselbund"),
            "{missing}"
        );
        let (_lenient_dir, mut lenient) = self::services(vec![connection(
            &id,
            "Prod",
            DatabaseKind::Postgres,
            "postgres://alice@db.example.com:5432/app?sslmode=require",
        )])
        .await;
        lenient.require_password = false;
        let trusted = resolve(&lenient, &mut ConnectionCache::new(), &id, None)
            .await
            .unwrap();
        assert!(
            trusted.url.starts_with("postgres://alice@db.example.com"),
            "{}",
            trusted.url
        );
        crate::db::secrets::store_secret(id.clone(), "p@ss w".into())
            .await
            .unwrap();
        let resolved = resolve(&services, &mut cache, "prod", Some("app"))
            .await
            .unwrap();
        assert_eq!(
            resolved.url,
            "postgres://alice:p%40ss%20w@db.example.com:5432/app?sslmode=require"
        );
        assert_eq!(resolved.via, Via::Direct);
        assert_eq!(resolved.database.as_deref(), Some("app"));
        assert_eq!(
            with_password(
                "clickhouse://analyst@db.example.com:8123/default",
                Some("a&b%41+c")
            ),
            "clickhouse://analyst:a%26b%2541%2Bc@db.example.com:8123/default"
        );
        assert_eq!(
            with_password("Server=db;User Id=sa;Database=app", Some("x;y")),
            "Server=db;User Id=sa;Database=app;Password=\"x;y\""
        );
        assert_eq!(
            with_password("host=db user=bob password=", Some("it's")),
            "host=db user=bob password='it\\'s'"
        );
        assert_eq!(
            with_password("Driver={X};Uid=a;Pwd=***", Some("a}b")),
            "Driver={X};Uid=a;Pwd={a}}b}"
        );
        assert!(has_user_without_password("Server=db;User Id=sa"));
        assert!(!has_user_without_password(
            "Server=db;User Id=sa;Password=x"
        ));
        assert!(!has_user_without_password("redis://db.example.com:6379"));
    }

    #[tokio::test]
    async fn appends_secret_params() {
        let id = unique("ch");
        let (_dir, services) = services(vec![connection(
            &id,
            "Analytics",
            DatabaseKind::Clickhouse,
            "clickhouse://db.example.com:8123/default?compress=1#frag",
        )])
        .await;
        crate::db::secrets::store_secret(
            format!("{id}:params"),
            "access_token=abc&secret=x".into(),
        )
        .await
        .unwrap();
        let resolved = resolve(&services, &mut ConnectionCache::new(), &id, None)
            .await
            .unwrap();
        assert_eq!(
            resolved.url,
            "clickhouse://db.example.com:8123/default?compress=1&access_token=abc&secret=x#frag"
        );
        assert_eq!(
            with_secret_params("mysql://h/db", Some("ssl-key=k")),
            "mysql://h/db?ssl-key=k"
        );
        assert_eq!(with_secret_params("Server=x", Some("a=b")), "Server=x");
    }

    #[test]
    fn postgres_tunnel_rewrites_hostaddr_and_port() {
        assert_eq!(
            tunneled("postgres://alice:pw@db.internal:5432/app?hostaddr=10.0.0.1&port=6000&sslmode=require", 40123, DatabaseKind::Postgres).unwrap(),
            "postgres://alice:pw@db.internal:40123/app?sslmode=require&hostaddr=127.0.0.1"
        );
        assert_eq!(
            tunneled("postgresql://db.internal/app", 5555, DatabaseKind::Postgres).unwrap(),
            "postgresql://db.internal:5555/app?hostaddr=127.0.0.1"
        );
    }

    #[test]
    fn generic_tunnel_rewrites_authority() {
        assert_eq!(
            tunneled(
                "mysql://root:p%40ss@db.internal:3306/shop?ssl-mode=REQUIRED",
                41000,
                DatabaseKind::Mysql
            )
            .unwrap(),
            "mysql://root:p%40ss@127.0.0.1:41000/shop?ssl-mode=REQUIRED"
        );
        assert_eq!(
            rewrite_host_port("redis://[::1]", "127.0.0.1", 7000),
            "redis://127.0.0.1:7000"
        );
        assert_eq!(
            proxy_target("mysql://u@db.internal/shop", DatabaseKind::Mysql).unwrap(),
            ("db.internal".to_string(), 3306)
        );
        assert_eq!(
            proxy_target("postgres://u@[::1]:6543/x", DatabaseKind::Postgres).unwrap(),
            ("::1".to_string(), 6543)
        );
    }

    #[test]
    fn key_value_string_with_tunnel_is_rejected() {
        let error = tunneled(
            "Server=db;Database=app;User Id=sa",
            4000,
            DatabaseKind::Mssql,
        )
        .unwrap_err();
        assert_eq!(
            error,
            "Für Tunnel-Verbindungen wird eine URL-Verbindungszeichenfolge benötigt."
        );
        assert!(tunneled("host=db user=x", 4000, DatabaseKind::Postgres).is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn command_tunnel_is_used_and_failure_never_falls_back_to_direct() {
        let id = unique("cmd");
        let mut tunneled = connection(
            &id,
            "Hinter Befehl",
            DatabaseKind::Postgres,
            "postgres://db.internal:5432/app",
        );
        tunneled.command_tunnel = Some(crate::automation::model::CommandTunnelDescriptor {
            command: "sh -c 'exit 3' {localPort}".into(),
            local_port: None,
            timeout_secs: Some(2),
        });
        let (_dir, services) = services(vec![tunneled]).await;
        let mut cache = ConnectionCache::new();
        let error = resolve(&services, &mut cache, &id, None).await.unwrap_err();
        assert!(error.contains("Befehls-Tunnel"), "{error}");
        assert!(cache.is_empty());

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let ok = unique("cmd-ok");
        let mut forwarded = connection(
            &ok,
            "Port-Forward",
            DatabaseKind::Postgres,
            "postgres://db.internal:5432/app",
        );
        forwarded.command_tunnel = Some(crate::automation::model::CommandTunnelDescriptor {
            command: "python3 -c \"import socket,time;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('127.0.0.1',{localPort}));s.listen();time.sleep(30)\"".into(),
            local_port: Some(port),
            timeout_secs: Some(10),
        });
        services
            .store
            .replace_connections(vec![forwarded])
            .await
            .unwrap();
        let resolved = resolve(&services, &mut cache, &ok, None).await.unwrap();
        assert_eq!(resolved.via, Via::Command(port));
        assert!(
            resolved.url.contains(&format!(":{port}/app")),
            "{}",
            resolved.url
        );
        assert!(
            resolved.url.contains("hostaddr=127.0.0.1"),
            "{}",
            resolved.url
        );
        forget(&services, &ok).await;
    }

    #[tokio::test]
    async fn tunnel_failure_never_falls_back_to_direct() {
        let id = unique("ssh");
        let mut tunneled = connection(
            &id,
            "Hinter SSH",
            DatabaseKind::Postgres,
            "postgres://db.internal:5432/app",
        );
        tunneled.ssh = Some(SshDescriptor {
            host: "127.0.0.1".into(),
            port: 1,
            user: "root".into(),
            auth: SshAuthKind::Agent,
            key_file: String::new(),
            agent_socket: None,
            jump_hosts: Vec::new(),
            remote_host: String::new(),
            remote_port: 5432,
        });
        let (_dir, services) = services(vec![tunneled.clone()]).await;
        let mut cache = ConnectionCache::new();
        let error = resolve(&services, &mut cache, &id, None).await.unwrap_err();
        assert!(error.contains("SSH-Tunnel"), "{error}");
        assert!(cache.is_empty());
        assert!(services.ssh.list().await.is_empty());
        let mut password = tunneled;
        password.ssh.as_mut().unwrap().auth = SshAuthKind::Password;
        let missing = ssh_request(
            &password,
            NetworkSecrets {
                ssh: None,
                jumps: Vec::new(),
                proxy: None,
            },
            false,
        )
        .unwrap_err();
        assert_eq!(
            missing,
            "SSH: SSH-Passwort fehlt – bitte Verbindung bearbeiten und erneut speichern."
        );
        let request = ssh_request(
            &password,
            NetworkSecrets {
                ssh: Some("pw".into()),
                jumps: Vec::new(),
                proxy: None,
            },
            true,
        )
        .unwrap()
        .unwrap();
        assert_eq!(request.id, format!("automation:{id}"));
        assert_eq!(request.remote_host, "127.0.0.1");
        assert!(request.accept_new_host_key);
    }

    #[test]
    fn vault_and_s3_unsupported() {
        let mut vault = connection("v", "Vault", DatabaseKind::Postgres, "postgres://h/db");
        vault.vault = true;
        assert!(unsupported_reason(&vault)
            .unwrap()
            .contains("Passwortmanager"));
        let s3 = connection("s", "Bucket", DatabaseKind::S3, "s3://bucket");
        assert!(unsupported_reason(&s3).unwrap().contains("Objektspeicher"));
        assert_eq!(
            unsupported_reason(&connection(
                "p",
                "PG",
                DatabaseKind::Postgres,
                "postgres://h/db"
            )),
            None
        );
    }

    #[test]
    fn name_lookup_case_insensitive_and_ambiguous() {
        let list = vec![
            connection("a", "Reporting", DatabaseKind::Postgres, "postgres://h/a"),
            connection("b", "Staging", DatabaseKind::Postgres, "postgres://h/b"),
            connection("c", "staging", DatabaseKind::Mysql, "mysql://h/c"),
        ];
        assert_eq!(lookup(&list, "REPORTING").unwrap().id, "a");
        assert_eq!(lookup(&list, "c").unwrap().id, "c");
        assert_eq!(
            lookup(&list, "Staging").unwrap_err(),
            "Verbindungsname „Staging“ ist nicht eindeutig."
        );
        assert!(lookup(&list, "fehlt")
            .unwrap_err()
            .contains("nicht verfügbar"));
    }
}
