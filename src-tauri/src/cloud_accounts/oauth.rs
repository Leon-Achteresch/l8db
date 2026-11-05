use super::http::{self, ApiError, Auth, Body};
use super::store::{self, Account, AuthMethod, Keychain, Provider, Vault};
use base64::Engine;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

pub(crate) const AUTHORIZE_URL: &str = "https://oauth2.neon.tech/oauth2/auth";
pub(crate) const TOKEN_URL: &str = "https://oauth2.neon.tech/oauth2/token";
const DEFAULT_SCOPES: &str = "openid offline offline_access urn:neoncloud:projects:read urn:neoncloud:projects:update urn:neoncloud:orgs:read";
const FLOW_TIMEOUT: Duration = Duration::from_secs(300);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const MAX_CALLBACK_CONNECTIONS: usize = 32;
const REFRESH_MARGIN_SECONDS: i64 = 60;
const LABEL: &str = "Neon-Anmeldung";

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct OAuthConfig {
    pub client_id: String,
    pub client_secret: Option<String>,
    pub authorize_url: url::Url,
    pub token_url: url::Url,
    pub redirect_port: u16,
    pub scopes: String,
}

fn env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn config_from(
    client_id: Option<String>,
    client_secret: Option<String>,
    port: Option<String>,
    scopes: Option<String>,
) -> Result<Option<OAuthConfig>, String> {
    let Some(client_id) = client_id.filter(|id| !id.is_empty()) else {
        return Ok(None);
    };
    if client_id.len() > 256
        || client_id
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Die konfigurierte Neon-OAuth-Client-ID ist ungültig.".into());
    }
    if client_id.eq_ignore_ascii_case("neonctl") {
        return Err("Die Client-ID des Neon-CLI darf nicht verwendet werden. Bitte einen eigenen OAuth-Client registrieren.".into());
    }
    let redirect_port = match port {
        Some(port) => port
            .parse::<u16>()
            .map_err(|_| "L8DB_NEON_OAUTH_REDIRECT_PORT ist kein gültiger Port.".to_string())?,
        None => 0,
    };
    let scopes = scopes.unwrap_or_else(|| DEFAULT_SCOPES.to_string());
    if scopes.len() > 1024 || scopes.chars().any(char::is_control) {
        return Err("Die konfigurierten Neon-OAuth-Scopes sind ungültig.".into());
    }
    Ok(Some(OAuthConfig {
        client_id,
        client_secret,
        authorize_url: url::Url::parse(AUTHORIZE_URL).expect("Neon OAuth URL"),
        token_url: url::Url::parse(TOKEN_URL).expect("Neon OAuth URL"),
        redirect_port,
        scopes,
    }))
}

pub(crate) fn neon_config() -> Result<Option<OAuthConfig>, String> {
    config_from(
        env("L8DB_NEON_OAUTH_CLIENT_ID")
            .or_else(|| option_env!("L8DB_NEON_OAUTH_CLIENT_ID").map(str::to_string)),
        env("L8DB_NEON_OAUTH_CLIENT_SECRET"),
        env("L8DB_NEON_OAUTH_REDIRECT_PORT")
            .or_else(|| option_env!("L8DB_NEON_OAUTH_REDIRECT_PORT").map(str::to_string)),
        env("L8DB_NEON_OAUTH_SCOPES"),
    )
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct OAuthAvailability {
    pub available: bool,
    pub reason: Option<String>,
}

pub(crate) fn availability(config: Result<Option<OAuthConfig>, String>) -> OAuthAvailability {
    match config {
        Ok(Some(_)) => OAuthAvailability {
            available: true,
            reason: None,
        },
        Ok(None) => OAuthAvailability {
            available: false,
            reason: Some("Für diese Version ist kein eigener Neon-OAuth-Client registriert. Melde dich mit einem Neon-API-Schlüssel an (Neon Console → Account settings → API keys).".into()),
        },
        Err(error) => OAuthAvailability {
            available: false,
            reason: Some(error),
        },
    }
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    encode(&digest[..])
}

#[derive(Debug, PartialEq)]
pub(crate) enum CallbackOutcome {
    Code(String),
    Denied(String),
    Ignored,
}

pub(crate) fn parse_callback(head: &str, expected_state: &str) -> (u16, CallbackOutcome) {
    let Some(line) = head.lines().next() else {
        return (400, CallbackOutcome::Ignored);
    };
    let mut parts = line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return (405, CallbackOutcome::Ignored);
    };
    let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{target}")) else {
        return (400, CallbackOutcome::Ignored);
    };
    if url.path() != "/callback" {
        return (404, CallbackOutcome::Ignored);
    }
    let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let state_ok = params.get("state").is_some_and(|state| {
        state.len() == expected_state.len()
            && state
                .bytes()
                .zip(expected_state.bytes())
                .fold(0u8, |acc, (a, b)| acc | (a ^ b))
                == 0
    });
    if !state_ok {
        return (400, CallbackOutcome::Ignored);
    }
    if let Some(error) = params.get("error") {
        let detail = params
            .get("error_description")
            .cloned()
            .unwrap_or_else(|| error.clone());
        return (200, CallbackOutcome::Denied(http::redact(&detail, None)));
    }
    match params
        .get("code")
        .filter(|code| !code.is_empty() && code.len() <= 2048)
    {
        Some(code) => (200, CallbackOutcome::Code(code.clone())),
        None => (400, CallbackOutcome::Ignored),
    }
}

fn page(status: u16, message: &str) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Bad Request",
    };
    let body = format!(
        "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\"><title>l8db</title><body style=\"font-family:system-ui;padding:2rem\"><p>{message}</p></body></html>"
    );
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

async fn read_head(stream: &mut tokio::net::TcpStream) -> Option<String> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let read = async {
        loop {
            let count = stream.read(&mut chunk).await.ok()?;
            if count == 0 {
                return None;
            }
            buffer.extend_from_slice(&chunk[..count]);
            if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                return String::from_utf8(buffer.clone()).ok();
            }
            if buffer.len() > MAX_REQUEST_BYTES {
                return None;
            }
        }
    };
    tokio::time::timeout(REQUEST_TIMEOUT, read)
        .await
        .ok()
        .flatten()
}

pub(crate) async fn serve_callback(
    listener: tokio::net::TcpListener,
    state: String,
    cancel: CancellationToken,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    for _ in 0..MAX_CALLBACK_CONNECTIONS {
        let accepted = tokio::select! {
            _ = cancel.cancelled() => return Err("Neon-Anmeldung abgebrochen.".into()),
            _ = &mut deadline => return Err("Neon-Anmeldung: Zeitüberschreitung, bitte erneut starten.".into()),
            accepted = listener.accept() => accepted,
        };
        let Ok((mut stream, _)) = accepted else {
            continue;
        };
        let Some(head) = read_head(&mut stream).await else {
            continue;
        };
        let (status, outcome) = parse_callback(&head, &state);
        let message = match &outcome {
            CallbackOutcome::Code(_) => "Anmeldung abgeschlossen. Du kannst dieses Fenster schließen und zu l8db zurückkehren.",
            CallbackOutcome::Denied(_) => "Anmeldung abgelehnt. Du kannst dieses Fenster schließen.",
            CallbackOutcome::Ignored => "Ungültige Anfrage.",
        };
        let _ = stream.write_all(&page(status, message)).await;
        let _ = stream.shutdown().await;
        match outcome {
            CallbackOutcome::Code(code) => return Ok(code),
            CallbackOutcome::Denied(reason) => {
                return Err(format!("Neon-Anmeldung abgelehnt: {reason}"))
            }
            CallbackOutcome::Ignored => continue,
        }
    }
    Err("Neon-Anmeldung: zu viele ungültige Rückrufe, Vorgang beendet.".into())
}

struct Flow {
    cancel: CancellationToken,
    result: Option<oneshot::Receiver<Result<String, String>>>,
    verifier: String,
    redirect_uri: String,
    label: String,
    config: OAuthConfig,
}

fn flows() -> &'static Mutex<HashMap<String, Flow>> {
    static FLOWS: OnceLock<Mutex<HashMap<String, Flow>>> = OnceLock::new();
    FLOWS.get_or_init(Default::default)
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct OAuthStart {
    pub flow_id: String,
    pub authorize_url: String,
}

pub(crate) async fn start(config: OAuthConfig, label: &str) -> Result<OAuthStart, String> {
    let label = store::clean_label(label, "Neon")?;
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", config.redirect_port))
        .await
        .map_err(|_| "Der lokale Anmelde-Port ist belegt. Bitte erneut versuchen oder einen anderen Port konfigurieren.".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Lokaler Anmelde-Port nicht verfügbar.".to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let verifier = encode(&http::random_bytes::<32>());
    let state = encode(&http::random_bytes::<16>());
    let mut authorize = config.authorize_url.clone();
    authorize
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &config.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", &config.scopes)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge(&verifier))
        .append_pair("code_challenge_method", "S256");
    let cancel = CancellationToken::new();
    let (sender, receiver) = oneshot::channel();
    let flow_id = http::random_hex(16);
    {
        let mut flows = flows()
            .lock()
            .map_err(|_| "Anmeldestatus nicht verfügbar.")?;
        for (_, previous) in flows.drain() {
            previous.cancel.cancel();
        }
        flows.insert(
            flow_id.clone(),
            Flow {
                cancel: cancel.clone(),
                result: Some(receiver),
                verifier,
                redirect_uri,
                label,
                config,
            },
        );
    }
    tokio::spawn(async move {
        let outcome = serve_callback(listener, state, cancel, FLOW_TIMEOUT).await;
        let _ = sender.send(outcome);
    });
    Ok(OAuthStart {
        flow_id,
        authorize_url: authorize.to_string(),
    })
}

pub(crate) fn cancel(flow_id: &str) -> bool {
    let Ok(mut flows) = flows().lock() else {
        return false;
    };
    match flows.remove(flow_id) {
        Some(flow) => {
            flow.cancel.cancel();
            true
        }
        None => false,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct Tokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub expires_at: i64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

async fn token_request(
    config: &OAuthConfig,
    mut form: Vec<(String, String)>,
) -> Result<TokenResponse, ApiError> {
    form.push(("client_id".into(), config.client_id.clone()));
    if let Some(secret) = &config.client_secret {
        form.push(("client_secret".into(), secret.clone()));
    }
    let reply = http::send(
        LABEL,
        &Auth::None,
        Method::POST,
        config.token_url.clone(),
        Body::Form(form),
        256 * 1024,
    )
    .await?;
    let response: TokenResponse = http::decode(LABEL, &reply.body)?;
    if response.access_token.is_empty() {
        return Err(ApiError::local("Neon hat kein Zugriffstoken geliefert."));
    }
    Ok(response)
}

fn tokens_from(response: TokenResponse, previous_refresh: Option<String>) -> Tokens {
    Tokens {
        access_token: response.access_token,
        refresh_token: response
            .refresh_token
            .filter(|token| !token.is_empty())
            .or(previous_refresh),
        expires_at: now() + response.expires_in.unwrap_or(3600).clamp(60, 86_400 * 30),
    }
}

pub(crate) async fn finish_with(
    vault: &dyn Vault,
    flow_id: &str,
    api_base: url::Url,
) -> Result<Account, String> {
    let (receiver, verifier, redirect_uri, label, config, cancel) = {
        let mut flows = flows()
            .lock()
            .map_err(|_| "Anmeldestatus nicht verfügbar.")?;
        let flow = flows
            .get_mut(flow_id)
            .ok_or("Kein laufender Neon-Anmeldevorgang. Bitte erneut starten.")?;
        let receiver = flow
            .result
            .take()
            .ok_or("Der Anmeldevorgang wird bereits abgeschlossen.")?;
        (
            receiver,
            flow.verifier.clone(),
            flow.redirect_uri.clone(),
            flow.label.clone(),
            flow.config.clone(),
            flow.cancel.clone(),
        )
    };
    let outcome = receiver
        .await
        .unwrap_or_else(|_| Err("Neon-Anmeldung abgebrochen.".into()));
    let cleanup = || {
        if let Ok(mut flows) = flows().lock() {
            flows.remove(flow_id);
        }
    };
    let code = match outcome {
        Ok(code) if !cancel.is_cancelled() => code,
        Ok(_) => {
            cleanup();
            return Err("Neon-Anmeldung abgebrochen.".into());
        }
        Err(error) => {
            cleanup();
            return Err(error);
        }
    };
    let exchanged = token_request(
        &config,
        vec![
            ("grant_type".into(), "authorization_code".into()),
            ("code".into(), code),
            ("redirect_uri".into(), redirect_uri),
            ("code_verifier".into(), verifier),
        ],
    )
    .await;
    cleanup();
    if cancel.is_cancelled() {
        return Err("Neon-Anmeldung abgebrochen.".into());
    }
    let tokens = tokens_from(exchanged?, None);
    let neon = super::neon::Client::new(api_base.clone(), tokens.access_token.clone());
    neon.verify().await?;
    let raw =
        serde_json::to_string(&tokens).map_err(|_| "Token konnte nicht gespeichert werden.")?;
    let endpoint = if api_base.as_str() == super::neon::API {
        None
    } else {
        super::neon::custom_endpoint(super::neon::API, Some(api_base.as_str()))?
    };
    store::insert(
        vault,
        store::new_account(Provider::Neon, label, AuthMethod::Oauth, endpoint, None),
        &raw,
    )
    .await
}

fn refresh_locks() -> &'static Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(Default::default)
}

pub(crate) async fn access_token_with(
    vault: &dyn Vault,
    account: &Account,
    config: Option<&OAuthConfig>,
) -> Result<String, String> {
    let lock = refresh_locks()
        .lock()
        .map_err(|_| "Anmeldestatus nicht verfügbar.")?
        .entry(account.id.clone())
        .or_default()
        .clone();
    let _guard = lock.lock().await;
    let raw = store::credential(vault, account).await?;
    let tokens: Tokens = serde_json::from_str(&raw).map_err(|_| {
        "Gespeicherte Neon-Anmeldung ist beschädigt. Bitte neu anmelden.".to_string()
    })?;
    if tokens.expires_at - REFRESH_MARGIN_SECONDS > now() {
        return Ok(tokens.access_token);
    }
    let expired = || "Neon-Anmeldung abgelaufen. Bitte erneut mit Neon anmelden.".to_string();
    let config = config.ok_or_else(|| {
        "Neon-Anmeldung abgelaufen und kein OAuth-Client konfiguriert. Bitte mit einem API-Schlüssel anmelden.".to_string()
    })?;
    let refresh = tokens.refresh_token.clone().ok_or_else(expired)?;
    let response = token_request(
        config,
        vec![
            ("grant_type".into(), "refresh_token".into()),
            ("refresh_token".into(), refresh.clone()),
        ],
    )
    .await
    .map_err(|error| {
        if error.is(400) || error.is(401) {
            expired()
        } else {
            error.message
        }
    })?;
    let rotated = tokens_from(response, Some(refresh));
    let raw =
        serde_json::to_string(&rotated).map_err(|_| "Token konnte nicht gespeichert werden.")?;
    store::update_credential(vault, account, &raw).await?;
    Ok(rotated.access_token)
}

pub(crate) async fn access_token(vault: &dyn Vault, account: &Account) -> Result<String, String> {
    let config = neon_config().ok().flatten();
    access_token_with(vault, account, config.as_ref()).await
}

#[tauri::command]
pub fn cloud_neon_oauth_config() -> OAuthAvailability {
    availability(neon_config())
}

#[tauri::command]
pub async fn cloud_neon_oauth_start(label: String) -> Result<OAuthStart, String> {
    let config = neon_config()?.ok_or_else(|| {
        availability(Ok(None))
            .reason
            .unwrap_or_else(|| "Neon-OAuth ist nicht verfügbar.".into())
    })?;
    start(config, &label).await
}

#[tauri::command]
pub async fn cloud_neon_oauth_finish(flow_id: String) -> Result<Account, String> {
    finish_with(
        &Keychain,
        &flow_id,
        url::Url::parse(super::neon::API).expect("Neon API"),
    )
    .await
}

#[tauri::command]
pub fn cloud_neon_oauth_cancel(flow_id: String) -> bool {
    cancel(&flow_id)
}
