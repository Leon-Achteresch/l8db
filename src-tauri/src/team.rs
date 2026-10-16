use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
const EXPIRED: &str = "Team-Anmeldung abgelaufen. Bitte erneut anmelden.";

static LOGIN: Mutex<Option<Arc<Notify>>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TeamUser {
    pub email: String,
    pub name: String,
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

fn account(hub: &str) -> String {
    format!("l8db-team:{hub}")
}

fn base64url(bytes: &[u8]) -> String {
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

async fn wait_for_code(listener: TcpListener, state: &str) -> Result<String, String> {
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
        if url.path() != "/callback" {
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
        let Some(code) = param("code") else {
            respond(&mut stream, "400 Bad Request", "Anmeldung fehlgeschlagen.").await;
            return Err("Der Team-Hub hat keinen Anmeldecode geliefert.".into());
        };
        respond(
            &mut stream,
            "200 OK",
            "Angemeldet. Du kannst dieses Fenster schließen und zu l8db zurückkehren.",
        )
        .await;
        return Ok(code);
    }
}

async fn login_with(
    hub: &str,
    open: impl FnOnce(Url) -> Result<(), String>,
) -> Result<(String, TeamUser), String> {
    let verifier = base64url(&rand::random::<[u8; 32]>());
    let state = base64url(&rand::random::<[u8; 24]>());
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Anmeldung konnte nicht vorbereitet werden: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let mut login = Url::parse(&format!("{hub}/auth/login")).map_err(|e| e.to_string())?;
    login
        .query_pairs_mut()
        .append_pair("port", &port.to_string())
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge(&verifier));
    let cancel = Arc::new(Notify::new());
    if let Some(previous) = LOGIN
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .replace(cancel.clone())
    {
        previous.notify_one();
    }
    let outcome = match open(login) {
        Err(error) => Err(error),
        Ok(()) => tokio::select! {
            code = wait_for_code(listener, &state) => code,
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
    let code = outcome?;
    let response = client()
        .post(format!("{hub}/auth/token"))
        .json(&serde_json::json!({ "code": code, "code_verifier": verifier }))
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

#[tauri::command]
pub async fn team_login(app: tauri::AppHandle, hub_url: String) -> Result<TeamUser, String> {
    use tauri_plugin_opener::OpenerExt;
    let hub = normalize_hub(&hub_url)?;
    let (token, user) = login_with(&hub, |url| {
        app.opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|e| format!("Browser konnte nicht geöffnet werden: {e}"))
    })
    .await?;
    store_secret(account(&hub), token).await?;
    Ok(user)
}

#[tauri::command]
pub fn team_cancel_login() {
    if let Some(active) = LOGIN.lock().unwrap_or_else(|e| e.into_inner()).take() {
        active.notify_one();
    }
}

#[tauri::command]
pub async fn team_connections(hub_url: String) -> Result<serde_json::Value, String> {
    let hub = normalize_hub(&hub_url)?;
    let token = load_secret(account(&hub)).await?.ok_or(EXPIRED)?;
    fetch_connections(&hub, &token).await
}

#[tauri::command]
pub async fn team_logout(hub_url: String) -> Result<(), String> {
    delete_secret(account(&normalize_hub(&hub_url)?)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::http_mock;

    static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
