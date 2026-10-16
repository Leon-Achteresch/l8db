use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Notify;
use url::Url;

use crate::db::secrets::{delete_secret, load_secret, store_secret};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
const REQUEST_LIMIT: usize = 8192;
const READ_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const EXPIRED: &str = "Team-Anmeldung abgelaufen. Bitte erneut anmelden.";

static LOGIN: Mutex<Option<Arc<Notify>>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TeamUser {
    pub email: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ManagedHub {
    pub url: String,
    pub source: String,
    #[serde(skip)]
    pub microsoft_disabled: bool,
    #[serde(rename = "allowedHosts")]
    pub allowed_hosts: Vec<String>,
    #[serde(skip)]
    pub microsoft: Option<crate::team_m365::MicrosoftPolicy>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TeamLogin {
    pub hub: String,
    pub user: TeamUser,
}

#[derive(Deserialize)]
struct HubFile {
    url: Option<String>,
    #[serde(default, rename = "microsoftDisabled")]
    microsoft_disabled: bool,
    #[serde(default, rename = "allowedHosts")]
    allowed_hosts: Vec<String>,
    microsoft: Option<crate::team_m365::MicrosoftPolicy>,
}

pub(crate) struct Loopback {
    pub params: std::collections::HashMap<String, String>,
    pub verifier: String,
    pub port: u16,
}

impl Loopback {
    pub fn code(&self) -> Result<String, String> {
        self.params
            .get("code")
            .cloned()
            .ok_or_else(|| "Es wurde kein Anmeldecode geliefert.".into())
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    token: String,
    user: TeamUser,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("Team-Hub HTTP client")
    })
}

pub(crate) fn account(hub: &str) -> String {
    format!("l8db-team:{hub}")
}

pub(crate) fn base64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn challenge(verifier: &str) -> String {
    base64url(&Sha256::digest(verifier.as_bytes()))
}

pub fn normalize_hub(raw: &str) -> Result<String, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "Ungültige Team-Hub-Adresse.")?;
    let loopback = match url.host() {
        Some(url::Host::Domain("localhost")) => true,
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        _ => false,
    };
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Der Team-Hub muss per https:// erreichbar sein (ohne Zugangsdaten oder Parameter)."
                .into(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

async fn respond(stream: &mut tokio::net::TcpStream, status: &str, message: &str) {
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>l8db</title><body style=\"font-family:system-ui;padding:3rem;text-align:center\"><p>{message}</p>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn wait_for_code(
    listener: TcpListener,
    state: &str,
    path: &str,
) -> Result<std::collections::HashMap<String, String>, String> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 1024];
        let read_head = async {
            while buffer.len() < REQUEST_LIMIT && !buffer.windows(4).any(|w| w == b"\r\n\r\n") {
                match stream.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(read) => buffer.extend_from_slice(&chunk[..read]),
                }
            }
        };
        if tokio::time::timeout(READ_TIMEOUT, read_head).await.is_err() {
            continue;
        }
        let head = String::from_utf8_lossy(&buffer);
        let target = head
            .lines()
            .next()
            .and_then(|line| line.strip_prefix("GET "))
            .and_then(|line| line.split(' ').next())
            .unwrap_or("");
        let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
            respond(&mut stream, "400 Bad Request", "Ungültige Anfrage.").await;
            continue;
        };
        if url.path() != path {
            respond(&mut stream, "404 Not Found", "Nicht gefunden.").await;
            continue;
        }
        let param = |key: &str| {
            url.query_pairs()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.into_owned())
        };
        if param("state").as_deref() != Some(state) {
            respond(
                &mut stream,
                "400 Bad Request",
                "Diese Anmeldung gehört nicht zu l8db.",
            )
            .await;
            continue;
        }
        if param("code").is_none() && param("admin_consent").is_none() {
            respond(
                &mut stream,
                "400 Bad Request",
                "Anmeldung nicht abgeschlossen. Details stehen in l8db.",
            )
            .await;
            return Err(match param("error") {
                Some(error) => format!(
                    "{error}: {}",
                    param("error_description").unwrap_or_default()
                ),
                None => "Es wurde kein Anmeldecode geliefert.".into(),
            });
        }
        respond(
            &mut stream,
            "200 OK",
            "Erledigt. Du kannst dieses Fenster schließen und zu l8db zurückkehren.",
        )
        .await;
        return Ok(url.query_pairs().into_owned().collect());
    }
}

pub(crate) async fn loopback_login(
    path: &str,
    authorize: impl FnOnce(u16, &str, &str) -> Result<Url, String>,
    open: impl FnOnce(Url) -> Result<(), String>,
) -> Result<Loopback, String> {
    let verifier = base64url(&rand::random::<[u8; 32]>());
    let state = base64url(&rand::random::<[u8; 24]>());
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Anmeldung konnte nicht vorbereitet werden: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let target = authorize(port, &state, &challenge(&verifier))?;
    let cancel = Arc::new(Notify::new());
    if let Some(previous) = LOGIN
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .replace(cancel.clone())
    {
        previous.notify_one();
    }
    let outcome = match open(target) {
        Err(error) => Err(error),
        Ok(()) => tokio::select! {
            code = wait_for_code(listener, &state, path) => code,
            _ = cancel.notified() => Err("Anmeldung abgebrochen.".into()),
            _ = tokio::time::sleep(LOGIN_TIMEOUT) => Err("Anmeldung nicht rechtzeitig abgeschlossen.".into()),
        },
    };
    {
        let mut current = LOGIN.lock().unwrap_or_else(|e| e.into_inner());
        if current
            .as_ref()
            .is_some_and(|active| Arc::ptr_eq(active, &cancel))
        {
            *current = None;
        }
    }
    Ok(Loopback {
        params: outcome?,
        verifier,
        port,
    })
}

async fn login_with(
    hub: &str,
    open: impl FnOnce(Url) -> Result<(), String>,
) -> Result<(String, TeamUser), String> {
    let loopback = loopback_login(
        "/callback",
        |port, state, code_challenge| {
            let mut login = Url::parse(&format!("{hub}/auth/login")).map_err(|e| e.to_string())?;
            login
                .query_pairs_mut()
                .append_pair("port", &port.to_string())
                .append_pair("state", state)
                .append_pair("code_challenge", code_challenge);
            Ok(login)
        },
        open,
    )
    .await?;
    let response = client()
        .post(format!("{hub}/auth/token"))
        .json(&serde_json::json!({ "code": loopback.code()?, "code_verifier": loopback.verifier }))
        .send()
        .await
        .map_err(|e| format!("Team-Hub nicht erreichbar: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Team-Hub lehnte die Anmeldung ab ({}).",
            response.status()
        ));
    }
    let body: TokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Ungültige Antwort vom Team-Hub: {e}"))?;
    Ok((body.token, body.user))
}

async fn fetch_connections(hub: &str, token: &str) -> Result<serde_json::Value, String> {
    let response = client()
        .get(format!("{hub}/api/connections"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Team-Hub nicht erreichbar: {e}"))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(EXPIRED.into());
    }
    if !response.status().is_success() {
        return Err(format!("Team-Hub antwortete mit {}.", response.status()));
    }
    response
        .json()
        .await
        .map_err(|e| format!("Ungültige Antwort vom Team-Hub: {e}"))
}

fn managed_hub_paths(local_data: Option<PathBuf>) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = std::env::var_os("L8DB_HUB_FILE")
        .map(PathBuf::from)
        .into_iter()
        .collect();
    #[cfg(target_os = "macos")]
    paths.push(PathBuf::from("/Library/Application Support/l8db/hub.json"));
    #[cfg(all(unix, not(target_os = "macos")))]
    paths.push(PathBuf::from("/etc/l8db/hub.json"));
    paths.extend(local_data.map(|dir| dir.join("hub.json")));
    paths
}

fn parse_policy(raw: &str, source: &str) -> Result<ManagedHub, String> {
    let file = serde_json::from_str::<HubFile>(raw.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("{source}: {e}"))?;
    if let Some(pattern) = file.allowed_hosts.iter().find(|pattern| {
        let host = pattern.strip_prefix("*.").unwrap_or(pattern);
        host.is_empty()
            || !host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'))
    }) {
        return Err(format!(
            "{source}: allowedHosts enthält ungültigen Eintrag „{pattern}“"
        ));
    }
    let allowed_hosts: Vec<String> = file
        .allowed_hosts
        .iter()
        .map(|pattern| pattern.to_ascii_lowercase())
        .collect();
    let managed = match (file.microsoft, file.url) {
        (Some(policy), _) => policy.validate().map(|policy| ManagedHub {
            url: crate::team_m365::HUB.into(),
            source: source.into(),
            allowed_hosts: allowed_hosts.clone(),
            microsoft_disabled: false,
            microsoft: Some(policy),
        }),
        (None, Some(url)) => normalize_hub(&url).map(|url| ManagedHub {
            url,
            source: source.into(),
            allowed_hosts: allowed_hosts.clone(),
            microsoft_disabled: file.microsoft_disabled,
            microsoft: None,
        }),
        (None, None) if !allowed_hosts.is_empty() || file.microsoft_disabled => Ok(ManagedHub {
            url: String::new(),
            source: source.into(),
            allowed_hosts: allowed_hosts.clone(),
            microsoft_disabled: file.microsoft_disabled,
            microsoft: None,
        }),
        (None, None) => Err("\"url\", \"microsoft\" oder \"allowedHosts\" fehlt".into()),
    };
    managed.map_err(|error| format!("{source}: {error}"))
}

pub(crate) fn registry_policy_json(output: &str) -> Option<String> {
    let mut values = std::collections::HashMap::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 && parts[1].starts_with("REG_") {
            values.insert(parts[0].to_ascii_lowercase(), parts[2..].join(" "));
        }
    }
    if values.is_empty() {
        return None;
    }
    let get = |key: &str| values.get(key).cloned();
    let enabled = match values.get("microsoft") {
        Some(value) => value == "0x1" || value == "1",
        None => values.keys().any(|key| key.starts_with("microsoft")),
    };
    let microsoft = enabled.then(|| {
        let mut policy = serde_json::Map::new();
        for (key, field) in [
            ("microsoftclientid", "clientId"),
            ("microsofttenant", "tenant"),
            ("microsoftsite", "site"),
            ("microsoftsiteurl", "siteUrl"),
            ("microsoftscope", "scope"),
        ] {
            if let Some(value) = get(key) {
                policy.insert(field.into(), value.into());
            }
        }
        serde_json::Value::Object(policy)
    });
    let allowed: Vec<String> = get("allowedhosts")
        .map(|value| {
            value
                .split([';', ','])
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Some(
        serde_json::json!({
            "url": get("huburl"),
            "microsoft": microsoft,
            "microsoftDisabled": values.get("microsoft").is_some_and(|value| value == "0x0" || value == "0"),
            "allowedHosts": allowed,
        })
            .to_string(),
    )
}

fn registry_policy() -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Ok(None);
    }
    let output = crate::process::std_command("reg")
        .args(["query", "HKLM\\SOFTWARE\\Policies\\l8db"])
        .output()
        .map_err(|e| format!("HKLM\\SOFTWARE\\Policies\\l8db konnte nicht gelesen werden: {e}"))?;
    Ok(output
        .status
        .success()
        .then(|| registry_policy_json(&String::from_utf8_lossy(&output.stdout)))
        .flatten())
}

fn read_managed_hub(paths: &[PathBuf]) -> Result<Option<ManagedHub>, String> {
    let mut errors = Vec::new();
    if let Some(raw) = registry_policy()? {
        return parse_policy(&raw, "HKLM\\SOFTWARE\\Policies\\l8db").map(Some);
    }
    if cfg!(windows) {
        let legacy = PathBuf::from(
            std::env::var_os("ProgramData").unwrap_or_else(|| "C:\\ProgramData".into()),
        )
        .join("l8db")
        .join("hub.json");
        if legacy.exists() {
            return Err(format!("{} wird aus Sicherheitsgründen nicht mehr gelesen. Bitte die Richtlinie unter HKLM\\SOFTWARE\\Policies\\l8db setzen (siehe Anleitung für die IT) und die Datei löschen.", legacy.display()));
        }
    }
    for path in paths {
        let raw = match std::fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                errors.push(format!("{}: {error}", path.display()));
                continue;
            }
        };
        match parse_policy(&raw, &path.display().to_string()) {
            Ok(managed) => return Ok(Some(managed)),
            Err(error) => errors.push(error),
        }
    }
    if errors.is_empty() {
        Ok(None)
    } else {
        Err(errors.join("\n"))
    }
}

pub(crate) fn managed_hub(app: &tauri::AppHandle) -> Result<Option<ManagedHub>, String> {
    use tauri::Manager;
    read_managed_hub(&managed_hub_paths(app.path().app_local_data_dir().ok()))
}

#[tauri::command(async)]
pub fn team_managed_hub(app: tauri::AppHandle) -> Result<Option<ManagedHub>, String> {
    managed_hub(&app)
}

pub(crate) fn browser(app: &tauri::AppHandle) -> impl FnOnce(Url) -> Result<(), String> + '_ {
    use tauri_plugin_opener::OpenerExt;
    move |url| {
        app.opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|e| format!("Browser konnte nicht geöffnet werden: {e}"))
    }
}

#[tauri::command]
pub async fn team_login(
    app: tauri::AppHandle,
    hub_url: String,
    admin: Option<bool>,
) -> Result<TeamLogin, String> {
    if hub_url == crate::team_m365::HUB {
        return crate::team_m365::login(&app, admin.unwrap_or(false)).await;
    }
    let hub = normalize_hub(&hub_url)?;
    let (token, user) = login_with(&hub, browser(&app)).await?;
    store_secret(account(&hub), token).await?;
    Ok(TeamLogin { hub, user })
}

#[tauri::command]
pub fn team_cancel_login() {
    if let Some(active) = LOGIN.lock().unwrap_or_else(|e| e.into_inner()).take() {
        active.notify_one();
    }
}

#[tauri::command]
pub async fn team_connections(
    app: tauri::AppHandle,
    hub_url: String,
) -> Result<serde_json::Value, String> {
    let allowed = managed_hub(&app)?
        .map(|managed| managed.allowed_hosts)
        .unwrap_or_default();
    let mut payload = if hub_url == crate::team_m365::HUB {
        crate::team_m365::connections(&app).await?
    } else {
        let hub = normalize_hub(&hub_url)?;
        let token = load_secret(account(&hub)).await?.ok_or(EXPIRED)?;
        fetch_connections(&hub, &token).await?
    };
    enforce_allowed_hosts(&mut payload, &allowed);
    Ok(payload)
}

fn host_allowed(host: &str, patterns: &[String]) -> bool {
    !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'))
        && patterns
            .iter()
            .any(|pattern| match pattern.strip_prefix("*.") {
                Some(suffix) => host.ends_with(&format!(".{suffix}")),
                None => host == pattern,
            })
}

fn endpoint_hosts(entry: &serde_json::Value) -> Result<Vec<String>, String> {
    let kind = serde_json::from_value::<crate::db::provider::DatabaseKind>(entry["kind"].clone())
        .map_err(|_| "unbekannter Typ".to_string())?;
    let identity =
        crate::db::endpoint::resolve(kind, entry["connectionString"].as_str().unwrap_or_default())?;
    let url = entry["connectionString"].as_str().unwrap_or_default();
    let mut hosts = vec![identity.host];
    match kind {
        crate::db::provider::DatabaseKind::Postgres => {
            for host in crate::db::connection::parse_pg_url(url.trim())?
                .config
                .get_hosts()
            {
                if let tokio_postgres::config::Host::Tcp(host) = host {
                    hosts.push(host.trim_matches(['[', ']']).to_ascii_lowercase());
                } else {
                    return Err("Unix-Sockets sind für Team-Verbindungen nicht erlaubt".into());
                }
            }
        }
        crate::db::provider::DatabaseKind::Mongodb => {
            use mongodb::options::{ConnectionString, HostInfo, ServerAddress};
            match ConnectionString::parse(url.trim())
                .map_err(|e| e.to_string())?
                .host_info
            {
                HostInfo::HostIdentifiers(list) => {
                    for address in list {
                        match address {
                            ServerAddress::Tcp { host, .. } => {
                                hosts.push(host.to_ascii_lowercase())
                            }
                            _ => {
                                return Err(
                                    "Unix-Sockets sind für Team-Verbindungen nicht erlaubt".into()
                                )
                            }
                        }
                    }
                }
                HostInfo::DnsRecord(record) => hosts.push(record.to_ascii_lowercase()),
                _ => return Err("unbekannte Host-Angabe".into()),
            }
        }
        _ => {}
    }
    for (key, value) in identity.params {
        match key.as_str() {
            "hostaddr" => hosts.push(value.to_ascii_lowercase()),
            "nodes" => hosts.extend(value.split(',').map(|node| {
                let node = node.trim().to_ascii_lowercase();
                node.rsplit_once(':')
                    .filter(|(_, port)| port.chars().all(|c| c.is_ascii_digit()))
                    .map(|(host, _)| host.to_string())
                    .unwrap_or(node)
            })),
            _ => {}
        }
    }
    let structured = [
        &entry["ssh"]["host"],
        &entry["ssh"]["remoteHost"],
        &entry["proxy"]["host"],
    ];
    hosts.extend(
        structured
            .into_iter()
            .filter_map(|value| value.as_str())
            .map(str::to_ascii_lowercase),
    );
    hosts.extend(
        entry["ssh"]["jumpHosts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|hop| hop["host"].as_str())
            .map(str::to_ascii_lowercase),
    );
    Ok(hosts)
}

pub(crate) fn enforce_allowed_hosts(payload: &mut serde_json::Value, patterns: &[String]) {
    if patterns.is_empty() {
        return;
    }
    let mut warnings = Vec::new();
    if let Some(entries) = payload["connections"].as_array_mut() {
        entries.retain(|entry| {
            let name = entry["name"].as_str().unwrap_or("?");
            let verdict = endpoint_hosts(entry).and_then(|hosts| {
                match hosts.iter().find(|host| !host_allowed(host, patterns)) {
                    Some(host) => Err(format!("Host „{host}“ ist von der IT nicht freigegeben")),
                    None => Ok(()),
                }
            });
            if let Err(error) = &verdict {
                warnings.push(serde_json::Value::String(format!(
                    "„{name}“: {error}, übersprungen"
                )));
            }
            verdict.is_ok()
        });
    }
    if !warnings.is_empty() {
        match payload["warnings"].as_array_mut() {
            Some(existing) => existing.extend(warnings),
            None => payload["warnings"] = serde_json::Value::Array(warnings),
        }
    }
}

#[tauri::command]
pub async fn team_logout(hub_url: String) -> Result<(), String> {
    if hub_url == crate::team_m365::HUB {
        return delete_secret(account(crate::team_m365::HUB)).await;
    }
    delete_secret(account(&normalize_hub(&hub_url)?)).await
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::http_mock;

    pub(crate) static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[test]
    fn managed_hub_file_is_found_in_order_and_validated() {
        let dir = std::env::temp_dir().join(format!("l8db-hub-file-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        let machine = dir.join("machine.json");
        let user = dir.join("user.json");
        let paths = [machine.clone(), user.clone()];
        assert_eq!(read_managed_hub(&paths).unwrap(), None);
        std::fs::write(&user, "\u{feff}{\"url\":\"https://l8db.firma.de/\"}").unwrap();
        assert_eq!(
            read_managed_hub(&paths).unwrap().unwrap().url,
            "https://l8db.firma.de"
        );
        std::fs::write(&machine, r#"{"url":"https://zentral.firma.de"}"#).unwrap();
        assert_eq!(
            read_managed_hub(&paths).unwrap().unwrap().url,
            "https://zentral.firma.de"
        );
        std::fs::write(&machine, r#"{"url":"http://unsicher.firma.de"}"#).unwrap();
        assert_eq!(
            read_managed_hub(&paths).unwrap().unwrap().url,
            "https://l8db.firma.de"
        );
        std::fs::write(&machine, "kein json").unwrap();
        std::fs::remove_file(&user).unwrap();
        assert!(read_managed_hub(&paths)
            .unwrap_err()
            .contains("machine.json"));
        assert_eq!(
            normalize_hub("https://L8DB.Firma.de:443/").unwrap(),
            normalize_hub("https://l8db.firma.de").unwrap()
        );
        std::fs::remove_dir_all(&dir).unwrap();
        let dir = std::env::temp_dir().join(format!("l8db-hub-ms-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("hub.json");
        std::fs::write(&file, r#"{"microsoft":{}}"#).unwrap();
        let managed = read_managed_hub(std::slice::from_ref(&file))
            .unwrap()
            .unwrap();
        assert_eq!(managed.url, "m365");
        assert!(managed.microsoft.is_some());
        std::fs::write(&file, r#"{"microsoft":{"clientId":"kaputt"}}"#).unwrap();
        assert!(read_managed_hub(std::slice::from_ref(&file)).is_err());
        std::fs::write(&file, r#"{"microsoft":{"secret":"x"}}"#).unwrap();
        assert!(read_managed_hub(std::slice::from_ref(&file)).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
        let defaults = managed_hub_paths(Some(PathBuf::from("/data")));
        assert_eq!(defaults.last().unwrap(), &PathBuf::from("/data/hub.json"));
    }

    #[test]
    fn windows_registry_policy_is_parsed_like_a_hub_file() {
        let output = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\l8db\r\n    Microsoft    REG_DWORD    0x1\r\n    MicrosoftSiteUrl    REG_SZ    https://firma.sharepoint.com/sites/l8db\r\n    MicrosoftScope    REG_SZ    selected\r\n";
        let raw = registry_policy_json(output).unwrap();
        let managed = parse_policy(&raw, "HKLM").unwrap();
        assert_eq!(managed.url, "m365");
        assert_eq!(managed.source, "HKLM");
        let allowed = registry_policy_json(
            "    Microsoft    REG_DWORD    0x1\r\n    AllowedHosts    REG_SZ    *.Firma.intern; db01\r\n",
        )
        .unwrap();
        assert_eq!(
            parse_policy(&allowed, "HKLM").unwrap().allowed_hosts,
            ["*.firma.intern", "db01"]
        );
        assert!(parse_policy(r#"{"microsoft":{},"allowedHosts":["*"]}"#, "f").is_err());
        let only = parse_policy(r#"{"allowedHosts":["*.firma.intern"]}"#, "f").unwrap();
        assert_eq!(only.url, "");
        let hub =
            registry_policy_json("    HubUrl    REG_SZ    https://l8db.firma.de\r\n").unwrap();
        assert_eq!(
            parse_policy(&hub, "HKLM").unwrap().url,
            "https://l8db.firma.de"
        );
        assert!(registry_policy_json("ERROR: not found").is_none());
        let off = registry_policy_json(
            "    Microsoft    REG_DWORD    0x0\r\n    MicrosoftSiteUrl    REG_SZ    https://firma.sharepoint.com/sites/l8db\r\n",
        )
        .unwrap();
        let disabled = parse_policy(&off, "HKLM").unwrap();
        assert_eq!(disabled.url, "");
        assert!(disabled.microsoft_disabled);
        assert!(parse_policy(r#"{}"#, "f").unwrap_err().contains("fehlt"));
    }

    #[test]
    fn the_allowlist_is_enforced_on_the_host_the_driver_actually_uses() {
        let patterns = vec!["*.firma.intern".to_string(), "db01".to_string()];
        let entry = |kind: &str, url: &str| serde_json::json!({ "name": url, "kind": kind, "connectionString": url });
        let mut payload = serde_json::json!({ "connections": [
            entry("postgres", "postgres://db.firma.intern:5432/app"),
            entry("postgres", "postgres://db.firma.intern/x@evil.com/app"),
            entry("postgres", "postgres://db.firma.intern/app?hostaddr=203.0.113.5"),
            entry("oracle", "oracle://u@db.firma.intern/?connect_string=(DESCRIPTION=(ADDRESS=(HOST=evil.com)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=x)))"),
            entry("oracle", "oracle://u@db.firma.intern/?tns=evil.com:1521/x"),
            entry("snowflake", "snowflake://evil.com%2F.firma.intern/db"),
            entry("mssql", "mssql://db01:1433/erp"),
            entry("mysql", "mysql://evil.com/x"),
            entry("sqlite", "sqlite:///etc/passwd"),
            entry("postgres", "postgres://db.firma.intern,evil.com/app"),
            entry("mongodb", "mongodb://m1.firma.intern:27017,evil.com:27017/app"),
            entry("mongodb", "mongodb://m1.firma.intern:27017,m2.firma.intern:27017/app"),
            serde_json::json!({ "name": "tunnel", "kind": "postgres", "connectionString": "postgres://db.firma.intern/app",
                "ssh": { "host": "bastion.firma.intern", "remoteHost": "evil.com", "port": 22, "remotePort": 5432 } }),
            serde_json::json!({ "name": "proxy", "kind": "postgres", "connectionString": "postgres://db.firma.intern/app",
                "proxy": { "type": "socks5", "host": "evil.com", "port": 1080 } }),
        ] });
        enforce_allowed_hosts(&mut payload, &patterns);
        let kept: Vec<_> = payload["connections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["connectionString"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            kept,
            [
                "postgres://db.firma.intern:5432/app",
                "mssql://db01:1433/erp",
                "mongodb://m1.firma.intern:27017,m2.firma.intern:27017/app"
            ]
        );
        assert_eq!(payload["warnings"].as_array().unwrap().len(), 11);
        let mut open = serde_json::json!({ "connections": [entry("mysql", "mysql://evil.com/x")] });
        enforce_allowed_hosts(&mut open, &[]);
        assert_eq!(open["connections"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn pkce_challenge_matches_rfc_7636() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn hub_address_requires_tls_outside_loopback() {
        assert_eq!(
            normalize_hub("https://hub.firma.de/").unwrap(),
            "https://hub.firma.de"
        );
        assert_eq!(
            normalize_hub("https://firma.de/l8db/").unwrap(),
            "https://firma.de/l8db"
        );
        assert_eq!(
            normalize_hub("http://127.0.0.1:8080").unwrap(),
            "http://127.0.0.1:8080"
        );
        for bad in [
            "http://hub.firma.de",
            "https://u:p@hub.firma.de",
            "https://hub.firma.de?x=1",
            "hub",
        ] {
            assert!(normalize_hub(bad).is_err(), "{bad}");
        }
    }

    #[tokio::test]
    async fn login_ignores_foreign_requests_and_exchanges_the_code_with_its_verifier() {
        let _serial = SERIAL.lock().await;
        let hub = http_mock::start(|request| {
            if request.route() == "/auth/token" {
                let body = request.json();
                let verifier = body["code_verifier"].as_str().unwrap_or_default();
                if body["code"] == "app-code" && !verifier.is_empty() {
                    return (200, br#"{"token":"hub-token","expiresAt":1,"user":{"email":"max@firma.de","name":"Max"}}"#.to_vec());
                }
            }
            (401, b"{}".to_vec())
        });
        let (token, user) = login_with(&hub.base, |url| {
            let port = url
                .query_pairs()
                .find(|(k, _)| k == "port")
                .unwrap()
                .1
                .into_owned();
            let state = url
                .query_pairs()
                .find(|(k, _)| k == "state")
                .unwrap()
                .1
                .into_owned();
            assert_eq!(url.path(), "/auth/login");
            assert_eq!(
                url.query_pairs()
                    .find(|(k, _)| k == "code_challenge")
                    .unwrap()
                    .1
                    .len(),
                43
            );
            tokio::spawn(async move {
                let base = format!("http://127.0.0.1:{port}");
                let _idle = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}"))
                    .await
                    .unwrap();
                let plain = reqwest::Client::new();
                assert_eq!(
                    plain
                        .get(format!("{base}/favicon.ico"))
                        .send()
                        .await
                        .unwrap()
                        .status(),
                    404
                );
                assert_eq!(
                    plain
                        .get(format!("{base}/callback?code=evil&state=other"))
                        .send()
                        .await
                        .unwrap()
                        .status(),
                    400
                );
                assert_eq!(
                    plain
                        .get(format!("{base}/callback?code=app-code&state={state}"))
                        .send()
                        .await
                        .unwrap()
                        .status(),
                    200
                );
            });
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(token, "hub-token");
        assert_eq!(user.email, "max@firma.de");
        let exchanges: Vec<_> = hub
            .requests()
            .into_iter()
            .filter(|r| r.route() == "/auth/token")
            .collect();
        assert_eq!(exchanges.len(), 1);
        let verifier = exchanges[0].json()["code_verifier"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(verifier.len(), 43);
    }

    #[tokio::test]
    async fn cancelling_a_login_releases_the_waiting_listener() {
        let _serial = SERIAL.lock().await;
        let started = std::time::Instant::now();
        let login = tokio::spawn(login_with("http://127.0.0.1:9", |_| Ok(())));
        tokio::time::sleep(Duration::from_millis(50)).await;
        team_cancel_login();
        let outcome = login.await.unwrap();
        assert_eq!(outcome.unwrap_err(), "Anmeldung abgebrochen.");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn expired_hub_tokens_ask_for_a_new_login() {
        let hub = http_mock::start(|request| match request.header("authorization") {
            Some("Bearer good") => (200, br#"{"connections":[]}"#.to_vec()),
            _ => (401, b"{}".to_vec()),
        });
        assert_eq!(
            fetch_connections(&hub.base, "good").await.unwrap()["connections"],
            serde_json::json!([])
        );
        assert_eq!(
            fetch_connections(&hub.base, "stale").await.unwrap_err(),
            EXPIRED
        );
    }

    #[tokio::test]
    #[ignore]
    async fn e2e_login_through_hub_and_identity_provider() {
        let _serial = SERIAL.lock().await;
        let hub =
            normalize_hub(&std::env::var("L8DB_TEAM_E2E_HUB").expect("L8DB_TEAM_E2E_HUB")).unwrap();
        let browser = std::env::var("L8DB_TEAM_E2E_BROWSER").expect("L8DB_TEAM_E2E_BROWSER");
        let expected = std::env::var("L8DB_TEAM_E2E_EXPECT").unwrap_or_default();
        let (token, user) = login_with(&hub, |url| {
            std::process::Command::new("bun")
                .args([browser.as_str(), url.as_str()])
                .spawn()
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
        .await
        .unwrap();
        let listed = fetch_connections(&hub, &token).await.unwrap();
        let ids: Vec<&str> = listed["connections"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|entry| entry["id"].as_str())
            .collect();
        println!("team e2e: {} {:?}", user.email, ids);
        assert_eq!(ids.join(","), expected);
        assert_eq!(
            fetch_connections(&hub, "forged.token").await.unwrap_err(),
            EXPIRED
        );
    }
}
