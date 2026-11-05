use super::{crypto, model::*};
use crate::db::secrets::{backend_secret, remove_backend_secret, set_backend_secret};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const PROFILE_ACCOUNT: &str = "backend:workspace:profiles";

#[derive(Serialize, Deserialize)]
struct StoredProfile {
    #[serde(flatten)]
    profile: WorkspaceProfile,
    token: String,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(35))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("Workspace HTTP client")
    })
}

pub fn validate_endpoint(endpoint: &str) -> Result<url::Url, String> {
    if endpoint.len() > 4096 {
        return Err("Workspace-Adresse ist zu lang.".into());
    }
    let mut url = url::Url::parse(endpoint.trim()).map_err(|_| "Workspace-Adresse ist ungültig")?;
    let localhost = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if url.scheme() != "https" && !(url.scheme() == "http" && localhost) {
        return Err(
            "Entfernte Workspaces benötigen HTTPS. HTTP ist nur auf diesem Rechner erlaubt.".into(),
        );
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Workspace-Adresse darf keine Zugangsdaten oder URL-Parameter enthalten.".into(),
        );
    }
    if url.host_str().is_none() {
        return Err("Workspace-Host fehlt.".into());
    }
    let path = format!("{}/", url.path().trim_end_matches('/'));
    url.set_path(&path);
    Ok(url)
}

async fn profiles() -> Result<Vec<StoredProfile>, String> {
    backend_secret(PROFILE_ACCOUNT.into())
        .await?
        .map(|text| {
            serde_json::from_str(&text)
                .map_err(|_| "Gespeicherte Workspaces sind beschädigt.".into())
        })
        .unwrap_or_else(|| Ok(Vec::new()))
}

async fn store_profiles(profiles: Vec<StoredProfile>) -> Result<(), String> {
    set_backend_secret(
        PROFILE_ACCOUNT.into(),
        serde_json::to_string(&profiles)
            .map_err(|_| "Workspaces konnten nicht gespeichert werden")?,
    )
    .await
}

fn profile_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

pub async fn http(
    endpoint: &str,
    token: Option<&str>,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let base = validate_endpoint(endpoint)?;
    if path.starts_with('/')
        || path.contains("..")
        || path.contains('?')
        || path.contains('#')
        || path.contains('%')
        || path.chars().any(char::is_control)
        || !path.starts_with("api/")
    {
        return Err("Workspace-API-Pfad ist ungültig.".into());
    }
    let method =
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "HTTP-Methode ist ungültig")?;
    if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE") {
        return Err("HTTP-Methode ist nicht erlaubt.".into());
    }
    let mut url = base
        .join(path)
        .map_err(|_| "Workspace-API-Pfad ist ungültig")?;
    if method == reqwest::Method::GET {
        if let Some(Value::Object(fields)) = &body {
            for (key, value) in fields {
                let value = value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string());
                url.query_pairs_mut().append_pair(key, &value);
            }
        }
    }
    let mut request = client().request(method.clone(), url);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    if method != reqwest::Method::GET {
        if let Some(body) = body {
            request = request.json(&body);
        }
    }
    let response = request.send().await.map_err(|_| {
        "Workspace nicht erreichbar. Netzwerk, HTTPS-Zertifikat und Server prüfen.".to_string()
    })?;
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESULT_BYTES as u64)
    {
        return Err("Workspace-Antwort überschreitet 4 MB.".into());
    }
    let mut data = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Workspace-Verbindung wurde unterbrochen")?;
        if data.len() + chunk.len() > MAX_RESULT_BYTES {
            return Err("Workspace-Antwort überschreitet 4 MB.".into());
        }
        data.extend_from_slice(&chunk);
    }
    let result: Value =
        serde_json::from_slice(&data).map_err(|_| "Workspace hat ungültige Daten gesendet")?;
    if !status.is_success() || result.get("error").is_some() {
        if status.as_u16() == 401 {
            return Err(
                "Workspace-Sitzung ist abgelaufen oder wurde widerrufen. Bitte neu anmelden."
                    .into(),
            );
        }
        return Err(result["error"]
            .as_str()
            .map(|error| error.chars().take(1000).collect())
            .unwrap_or_else(|| format!("Workspace HTTP {}", status.as_u16())));
    }
    Ok(result)
}

pub async fn remote(
    profile: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let profile = profiles()
        .await?
        .into_iter()
        .find(|item| item.profile.id == profile)
        .ok_or("Workspace ist nicht angemeldet.")?;
    http(
        &profile.profile.endpoint,
        Some(&profile.token),
        method,
        path,
        body,
    )
    .await
}

#[tauri::command]
pub async fn workspace_profiles() -> Result<Vec<WorkspaceProfile>, String> {
    Ok(profiles()
        .await?
        .into_iter()
        .map(|item| item.profile)
        .collect())
}

#[tauri::command]
pub async fn workspace_login(
    endpoint: String,
    email: String,
    password: String,
) -> Result<WorkspaceProfile, String> {
    let endpoint = validate_endpoint(&endpoint)?.to_string();
    let response = http(
        &endpoint,
        None,
        "POST",
        "api/login",
        Some(json!({"email":email,"password":password})),
    )
    .await?;
    let token = response["token"]
        .as_str()
        .filter(|token| token.len() <= 200)
        .ok_or("Workspace hat keine gültige Sitzung zurückgegeben")?
        .to_string();
    let user: WorkspaceUser = serde_json::from_value(response["user"].clone())
        .map_err(|_| "Workspace hat keine gültige Benutzerkennung zurückgegeben")?;
    let id = crypto::hash_token(&format!("{endpoint}\0{}", user.id));
    let profile = WorkspaceProfile { id, endpoint, user };
    let _guard = profile_lock().lock().await;
    let mut existing = profiles().await?;
    existing.retain(|item| item.profile.id != profile.id);
    if existing.len() >= 20 {
        return Err("Höchstens 20 Workspace-Anmeldungen sind erlaubt.".into());
    }
    existing.push(StoredProfile {
        profile: profile.clone(),
        token,
    });
    store_profiles(existing).await?;
    Ok(profile)
}

#[tauri::command]
pub async fn workspace_accept_invitation(
    endpoint: String,
    token: String,
    email: String,
    password: String,
) -> Result<(), String> {
    http(
        &endpoint,
        None,
        "POST",
        "api/invitations/accept",
        Some(json!({"token":token,"email":email,"password":password})),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn workspace_disconnect(profile: String) -> Result<(), String> {
    let logout = remote(&profile, "POST", "api/logout", None).await;
    let _guard = profile_lock().lock().await;
    let mut items = profiles().await?;
    items.retain(|item| item.profile.id != profile);
    if items.is_empty() {
        remove_backend_secret(PROFILE_ACCOUNT.into()).await?;
    } else {
        store_profiles(items).await?;
    }
    logout.map(|_| ())
}

#[tauri::command]
pub async fn workspace_request(request: RequestInput) -> Result<Value, String> {
    if request.path.starts_with("login") || request.path.starts_with("invitations/accept") {
        return Err("Bitte den Anmeldedialog verwenden.".into());
    }
    remote(
        &request.profile,
        &request.method,
        &format!("api/{}", request.path),
        request.body,
    )
    .await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalServerStatus {
    pub endpoint: String,
    pub root: String,
}

struct RunningServer {
    status: LocalServerStatus,
    shutdown: tokio_util::sync::CancellationToken,
}

fn local_server() -> &'static Mutex<Option<RunningServer>> {
    static SERVER: OnceLock<Mutex<Option<RunningServer>>> = OnceLock::new();
    SERVER.get_or_init(|| Mutex::new(None))
}

fn local_server_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

#[tauri::command]
pub fn workspace_local_status() -> Result<Option<LocalServerStatus>, String> {
    Ok(local_server()
        .lock()
        .map_err(|_| "Workspace-Verwaltung blockiert")?
        .as_ref()
        .map(|server| server.status.clone()))
}

pub fn default_root() -> Result<std::path::PathBuf, String> {
    std::env::var_os("L8DB_WORKSPACE_ROOT")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(|home| {
                    std::path::PathBuf::from(home)
                        .join(".l8db")
                        .join("workspace")
                })
        })
        .filter(|path| path.is_absolute())
        .ok_or("Absoluter Workspace-Datenpfad fehlt.".into())
}

#[tauri::command]
pub async fn workspace_local_start(
    email: String,
    password: String,
) -> Result<LocalServerStatus, String> {
    let _guard = local_server_lock().lock().await;
    if let Some(status) = workspace_local_status()? {
        return Ok(status);
    }
    let root = default_root()?;
    let state = super::server::ServerState::open(&root)?.with_local_files(true);
    let bootstrap_state = state.clone();
    tokio::task::spawn_blocking(move || bootstrap_state.bootstrap(Credentials { email, password }))
        .await
        .map_err(|_| "Workspace konnte nicht initialisiert werden")??;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| "Lokaler Workspace-Port konnte nicht geöffnet werden")?;
    let endpoint = format!(
        "http://{}",
        listener.local_addr().map_err(|_| "Workspace-Port fehlt")?
    );
    let status = LocalServerStatus {
        endpoint,
        root: root.to_string_lossy().into_owned(),
    };
    let shutdown = tokio_util::sync::CancellationToken::new();
    let stopped = shutdown.clone();
    tokio::spawn(async move {
        let _ = axum::serve(listener, super::server::router(state))
            .with_graceful_shutdown(stopped.cancelled_owned())
            .await;
    });
    *local_server()
        .lock()
        .map_err(|_| "Workspace-Verwaltung blockiert")? = Some(RunningServer {
        status: status.clone(),
        shutdown,
    });
    Ok(status)
}

#[tauri::command]
pub async fn workspace_local_stop() -> Result<(), String> {
    let _guard = local_server_lock().lock().await;
    if let Some(server) = local_server()
        .lock()
        .map_err(|_| "Workspace-Verwaltung blockiert")?
        .take()
    {
        server.shutdown.cancel();
    }
    Ok(())
}
