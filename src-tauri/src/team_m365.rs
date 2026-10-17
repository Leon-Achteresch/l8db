use base64::Engine;
use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::OnceLock;
use std::time::Duration;
use url::Url;

use crate::db::secrets::{load_secret, store_secret};
use crate::team::{account, browser, loopback_login, managed_hub, TeamLogin, TeamUser, EXPIRED};

pub const HUB: &str = "m365";
pub const CLIENT_ID: &str = "";
pub const CONSENT_REQUIRED: &str = "Deine IT muss l8db einmal für eure Organisation freigeben.";
const DEFAULT_SITE: &str = "l8db";
const SCOPES: &str = "openid profile offline_access https://graph.microsoft.com/Sites.Read.All";
const WRITE_SCOPES: &str =
    "openid profile offline_access https://graph.microsoft.com/Sites.ReadWrite.All";
const SELECTED_SCOPES: &str =
    "openid profile offline_access https://graph.microsoft.com/Sites.Selected";
const MAX_FOLDERS: usize = 200;
const MAX_FILES: usize = 1000;
const MAX_DEPTH: usize = 4;
const MAX_FILE_BYTES: u64 = 256 * 1024;
const DOWNLOADS: usize = 8;

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MicrosoftPolicy {
    client_id: Option<String>,
    tenant: Option<String>,
    site: Option<String>,
    site_url: Option<String>,
    scope: Option<String>,
}

fn site_path(site_url: &str) -> Option<(String, String)> {
    let url = Url::parse(site_url).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    let path = url.path().trim_end_matches('/').to_string();
    (url.scheme() == "https"
        && path.starts_with("/sites/")
        && path.len() > "/sites/".len()
        && url.query().is_none()
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.')))
    .then_some((host, path))
}

fn is_guid(value: &str) -> bool {
    value.len() == 36
        && value.chars().enumerate().all(|(index, c)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

fn is_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

impl MicrosoftPolicy {
    pub fn validate(self) -> Result<Self, String> {
        if self.client_id.as_deref().is_some_and(|id| !is_guid(id)) {
            return Err("microsoft.clientId muss eine Anwendungs-ID (GUID) sein".into());
        }
        if self
            .tenant
            .as_deref()
            .is_some_and(|tenant| !is_name(tenant))
        {
            return Err("microsoft.tenant muss eine Verzeichnis-ID oder Domain sein".into());
        }
        if self.site.as_deref().is_some_and(|site| !is_name(site)) {
            return Err("microsoft.site darf nur Buchstaben, Ziffern, - und _ enthalten".into());
        }
        if self
            .site_url
            .as_deref()
            .is_some_and(|url| site_path(url).is_none())
        {
            return Err("microsoft.siteUrl muss eine https-Adresse wie https://firma.sharepoint.com/sites/l8db sein".into());
        }
        match self.scope.as_deref() {
            None | Some("all") => {}
            Some("selected") if self.site_url.is_some() => {}
            Some("selected") => {
                return Err("microsoft.scope \"selected\" braucht microsoft.siteUrl".into())
            }
            Some(_) => return Err("microsoft.scope muss \"all\" oder \"selected\" sein".into()),
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, PartialEq)]
struct Settings {
    client_id: String,
    tenant: String,
    site: String,
    site_url: Option<String>,
    scopes: &'static str,
    authority: String,
    graph: String,
}

impl Settings {
    fn new(policy: Option<MicrosoftPolicy>, authority: &str, graph: &str) -> Result<Self, String> {
        let policy = policy.unwrap_or_default();
        let client_id = policy.client_id.unwrap_or_else(|| CLIENT_ID.into());
        if client_id.is_empty() {
            return Err("In dieser l8db-Version ist keine Microsoft-App hinterlegt. Die IT kann in hub.json unter \"microsoft\" eine eigene \"clientId\" angeben.".into());
        }
        Ok(Self {
            client_id,
            tenant: policy.tenant.unwrap_or_else(|| "organizations".into()),
            site: policy.site.unwrap_or_else(|| DEFAULT_SITE.into()),
            scopes: if policy.scope.as_deref() == Some("selected") {
                SELECTED_SCOPES
            } else {
                SCOPES
            },
            site_url: policy.site_url,
            authority: authority.trim_end_matches('/').into(),
            graph: graph.trim_end_matches('/').into(),
        })
    }

    fn site_key(&self) -> String {
        self.site_url.clone().unwrap_or_else(|| self.site.clone())
    }

    fn token_url(&self, tenant: &str) -> String {
        format!("{}/{tenant}/oauth2/v2.0/token", self.authority)
    }
}

fn endpoints() -> (String, String) {
    let pick = |key: &str, default: &str| {
        if cfg!(debug_assertions) {
            std::env::var(key).unwrap_or_else(|_| default.into())
        } else {
            default.into()
        }
    };
    (
        pick("L8DB_ENTRA_AUTHORITY", "https://login.microsoftonline.com"),
        pick("L8DB_GRAPH_URL", "https://graph.microsoft.com"),
    )
}

fn settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    let managed = managed_hub(app)?;
    if managed
        .as_ref()
        .is_some_and(|managed| managed.microsoft_disabled)
    {
        return Err(
            "Die Microsoft-Anmeldung ist durch eine Richtlinie deiner IT abgeschaltet.".into(),
        );
    }
    let policy = managed.and_then(|managed| managed.microsoft);
    let (authority, graph) = endpoints();
    Settings::new(policy, &authority, &graph)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Stored {
    refresh: String,
    tenant: String,
    user: TeamUser,
    #[serde(default)]
    site: Option<(String, String)>,
}

#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("Microsoft HTTP client")
    })
}

fn consent_needed(text: &str) -> bool {
    [
        "AADSTS65001",
        "AADSTS90094",
        "AADSTS90095",
        "consent_required",
    ]
    .iter()
    .any(|marker| text.contains(marker))
}

fn explain(error: String) -> String {
    if consent_needed(&error) {
        return format!("{CONSENT_REQUIRED} Wer dort Administratorrechte hat, klickt auf „Für die Organisation freigeben“.");
    }
    let known = [
        ("AADSTS50105", "Dein Konto ist für l8db nicht freigeschaltet. Bitte wende dich an deine IT."),
        ("AADSTS53003", "Eine Zugriffsrichtlinie deiner Organisation blockiert die Anmeldung auf diesem Gerät."),
        ("AADSTS50020", "Dieses Konto gehört nicht zur vorgegebenen Organisation."),
        ("AADSTS700016", "l8db ist in deiner Organisation nicht bekannt. Die IT muss l8db zuerst freigeben."),
        ("AADSTS50076", "Deine Organisation verlangt eine zusätzliche Bestätigung (MFA). Bitte erneut anmelden."),
        ("AADSTS50079", "Deine Organisation verlangt eine zusätzliche Bestätigung (MFA). Bitte erneut anmelden."),
        ("AADSTS50011", "Die Rückleitungsadresse ist in der App-Registrierung nicht eingetragen. Die IT muss http://127.0.0.1 als Umleitungs-URI für mobile und Desktopanwendungen ergänzen."),
        ("AADSTS7000218", "In der App-Registrierung sind öffentliche Clientflows nicht erlaubt. Die IT muss „Öffentliche Clientflows zulassen“ aktivieren."),
        ("AADSTS65004", "Die Zustimmung zu l8db wurde abgelehnt."),
        ("AADSTS90072", "Dieses Konto ist in der Organisation nicht vorhanden (Gastkonto?). Die IT kann die Organisation per Richtlinie festlegen."),
    ];
    if let Some((code, text)) = known.iter().find(|(code, _)| error.contains(code)) {
        return format!("{text} ({code})");
    }
    if error.starts_with("access_denied") {
        return "Die Anmeldung bei Microsoft wurde abgebrochen oder abgelehnt.".into();
    }
    error
}

fn claims(id_token: &str) -> Value {
    id_token
        .split('.')
        .nth(1)
        .and_then(|payload| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(payload)
                .ok()
        })
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null)
}

async fn token(settings: &Settings, tenant: &str, form: &[(&str, &str)]) -> Result<Tokens, String> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form)
        .finish();
    let response = http()
        .post(settings.token_url(tenant))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Microsoft nicht erreichbar: {e}"))?;
    if response.status().is_success() {
        return response
            .json()
            .await
            .map_err(|e| format!("Ungültige Antwort von Microsoft: {e}"));
    }
    let body: Value = response.json().await.unwrap_or(Value::Null);
    let error = body["error"].as_str().unwrap_or_default();
    let description = body["error_description"].as_str().unwrap_or_default();
    if consent_needed(description) || error == "consent_required" {
        return Err(explain(description.into()));
    }
    if error == "invalid_grant" || error == "interaction_required" {
        return Err(EXPIRED.into());
    }
    Err(format!(
        "Microsoft lehnte die Anmeldung ab: {error} {description}"
    ))
}

async fn grant_consent(
    settings: &Settings,
    scopes: &str,
    open: impl FnOnce(Url) -> Result<(), String>,
) -> Result<(), String> {
    let loopback = loopback_login(
        "/",
        |port, state, _| {
            let mut target = Url::parse(&format!(
                "{}/{}/v2.0/adminconsent",
                settings.authority, settings.tenant
            ))
            .map_err(|e| e.to_string())?;
            target
                .query_pairs_mut()
                .append_pair("client_id", &settings.client_id)
                .append_pair("scope", scopes)
                .append_pair("redirect_uri", &format!("http://127.0.0.1:{port}"))
                .append_pair("state", state);
            Ok(target)
        },
        open,
    )
    .await
    .map_err(explain)?;
    if loopback.params.get("admin_consent").map(String::as_str) != Some("True") {
        return Err("Die Freigabe für die Organisation wurde nicht erteilt.".into());
    }
    Ok(())
}

async fn login_with(
    settings: &Settings,
    scopes: &str,
    hint: Option<&Stored>,
    open: impl FnOnce(Url) -> Result<(), String>,
) -> Result<(Stored, String), String> {
    let tenant = hint.map_or(settings.tenant.as_str(), |known| known.tenant.as_str());
    let loopback = loopback_login(
        "/",
        |port, state, code_challenge| {
            let mut target = Url::parse(&format!(
                "{}/{}/oauth2/v2.0/authorize",
                settings.authority, tenant
            ))
            .map_err(|e| e.to_string())?;
            target
                .query_pairs_mut()
                .append_pair("client_id", &settings.client_id)
                .append_pair("response_type", "code")
                .append_pair("response_mode", "query")
                .append_pair("redirect_uri", &format!("http://127.0.0.1:{port}"))
                .append_pair("scope", scopes)
                .append_pair("state", state)
                .append_pair("code_challenge", code_challenge)
                .append_pair("code_challenge_method", "S256");
            match hint {
                Some(known) => {
                    target
                        .query_pairs_mut()
                        .append_pair("login_hint", &known.user.email);
                }
                None => {
                    target
                        .query_pairs_mut()
                        .append_pair("prompt", "select_account");
                }
            }
            Ok(target)
        },
        open,
    )
    .await
    .map_err(explain)?;
    let code = loopback.code()?;
    let verifier = loopback.verifier;
    let redirect = format!("http://127.0.0.1:{}", loopback.port);
    let tokens = token(
        settings,
        tenant,
        &[
            ("client_id", settings.client_id.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("code_verifier", verifier.as_str()),
            ("scope", scopes),
        ],
    )
    .await?;
    let claims = claims(tokens.id_token.as_deref().unwrap_or_default());
    let tenant = claims["tid"]
        .as_str()
        .filter(|tid| is_guid(tid))
        .ok_or("Microsoft lieferte keine Organisation. Private Microsoft-Konten werden nicht unterstützt.")?
        .to_string();
    let email = ["email", "preferred_username", "upn"]
        .iter()
        .find_map(|key| claims[*key].as_str())
        .unwrap_or_default()
        .to_string();
    let user = TeamUser {
        name: claims["name"].as_str().unwrap_or(&email).to_string(),
        email,
    };
    if let Some(known) = hint {
        if !known.tenant.eq_ignore_ascii_case(&tenant)
            || !known.user.email.eq_ignore_ascii_case(&user.email)
        {
            return Err(format!(
                "Bitte mit demselben Konto anmelden ({}).",
                known.user.email
            ));
        }
    }
    let refresh = tokens
        .refresh_token
        .ok_or("Microsoft lieferte kein Refresh-Token.")?;
    Ok((
        Stored {
            refresh,
            tenant,
            user,
            site: None,
        },
        tokens.access_token,
    ))
}

#[tauri::command(async)]
pub fn team_microsoft_available(app: tauri::AppHandle) -> bool {
    settings(&app).is_ok()
}

pub async fn login(app: &tauri::AppHandle, admin: bool) -> Result<TeamLogin, String> {
    let settings = settings(app)?;
    if admin {
        grant_consent(&settings, settings.scopes, browser(app)).await?;
    }
    let (stored, _) = login_with(&settings, settings.scopes, None, browser(app)).await?;
    save(&stored).await?;
    Ok(TeamLogin {
        hub: HUB.into(),
        user: stored.user,
    })
}

async fn save(stored: &Stored) -> Result<(), String> {
    store_secret(
        account(HUB),
        serde_json::to_string(stored).map_err(|e| e.to_string())?,
    )
    .await
}

async fn graph_get(settings: &Settings, access: &str, url: &str) -> Result<Option<Value>, String> {
    if !url.starts_with(&format!("{}/", settings.graph)) {
        return Err("Unerwartete Weiterleitung von Microsoft Graph.".into());
    }
    let response = http()
        .get(url)
        .bearer_auth(access)
        .send()
        .await
        .map_err(|e| format!("Microsoft Graph nicht erreichbar: {e}"))?;
    match response.status().as_u16() {
        200 => response
            .json()
            .await
            .map(Some)
            .map_err(|e| format!("Ungültige Antwort von Microsoft Graph: {e}")),
        401 => Err(EXPIRED.into()),
        403 | 404 => Ok(None),
        status => Err(format!("Microsoft Graph antwortete mit {status}.")),
    }
}

struct Listing {
    site: Option<(String, String, String)>,
    files: Vec<(String, String, String)>,
    warnings: Vec<String>,
    complete: bool,
}

async fn resolve_site(settings: &Settings, access: &str) -> Result<Option<Value>, String> {
    let (host, path) = match settings.site_url.as_deref().and_then(site_path) {
        Some(found) => found,
        None => {
            let root = graph_get(
                settings,
                access,
                &format!("{}/v1.0/sites/root?$select=siteCollection", settings.graph),
            )
            .await?
            .ok_or("Die SharePoint-Startseite ist nicht erreichbar. Die IT kann in der Richtlinie microsoft.siteUrl angeben.")?;
            let host = root["siteCollection"]["hostname"]
                .as_str()
                .ok_or("SharePoint lieferte keinen Hostnamen.")?
                .to_string();
            (host, format!("/sites/{}", settings.site))
        }
    };
    graph_get(
        settings,
        access,
        &format!(
            "{}/v1.0/sites/{host}:{path}?$select=id,displayName,webUrl",
            settings.graph
        ),
    )
    .await
}

async fn list_files(settings: &Settings, access: &str, pinned: bool) -> Result<Listing, String> {
    let mut warnings = Vec::new();
    let Some(site) = resolve_site(settings, access).await? else {
        warnings.push(if pinned {
            format!("Die SharePoint-Website „{}“ ist gerade nicht erreichbar. Deine Team-Verbindungen bleiben erhalten.", settings.site_key())
        } else {
            format!("Keine Freigaben gefunden: Die SharePoint-Website „{}“ existiert nicht oder ist für dich nicht freigegeben.", settings.site_key())
        });
        return Ok(Listing {
            site: None,
            files: Vec::new(),
            warnings,
            complete: !pinned,
        });
    };
    let site_id = site["id"]
        .as_str()
        .ok_or("SharePoint-Website ohne ID.")?
        .to_string();
    let mut folders = VecDeque::from([(
        format!(
            "{}/v1.0/sites/{site_id}/drive/root/children?$top=200",
            settings.graph
        ),
        String::new(),
        0usize,
    )]);
    let mut visited = 0;
    let mut complete = true;
    let mut files = Vec::new();
    while let Some((mut next, folder, depth)) = folders.pop_front() {
        visited += 1;
        if visited > MAX_FOLDERS {
            warnings.push(format!(
                "Mehr als {MAX_FOLDERS} Ordner: Weitere Ordner wurden nicht gelesen."
            ));
            complete = false;
            break;
        }
        let mut first = true;
        loop {
            let page = graph_get(settings, access, &next).await?;
            let Some(page) = page else {
                if first {
                    break;
                }
                return Err(
                    "SharePoint brach die Auflistung ab. Bitte später erneut abgleichen.".into(),
                );
            };
            first = false;
            for item in page["value"].as_array().into_iter().flatten() {
                let name = item["name"].as_str().unwrap_or_default();
                let id = item["id"].as_str().unwrap_or_default();
                let shown = if folder.is_empty() {
                    name.to_string()
                } else {
                    format!("{folder}/{name}")
                };
                if item.get("folder").is_some() {
                    if depth >= MAX_DEPTH {
                        warnings.push(format!("{shown}: zu tief verschachtelt (mehr als {MAX_DEPTH} Ebenen), nicht gelesen"));
                        complete = false;
                    } else if !id.is_empty() {
                        folders.push_back((
                            format!(
                                "{}/v1.0/sites/{site_id}/drive/items/{id}/children?$top=200",
                                settings.graph
                            ),
                            shown,
                            depth + 1,
                        ));
                    }
                } else if item.get("file").is_some() && name.to_ascii_lowercase().ends_with(".json")
                {
                    if item["size"].as_u64().unwrap_or(u64::MAX) > MAX_FILE_BYTES {
                        warnings.push(format!("{shown}: größer als 256 KB, nicht gelesen"));
                        complete = false;
                    } else if files.len() >= MAX_FILES {
                        warnings.push(format!(
                            "Mehr als {MAX_FILES} Dateien: {shown} und weitere nicht gelesen"
                        ));
                        complete = false;
                    } else if let Some(download) = item["@microsoft.graph.downloadUrl"].as_str() {
                        files.push((id.to_string(), download.to_string(), shown));
                    } else {
                        warnings.push(format!("{shown}: kein Download möglich, nicht gelesen"));
                        complete = false;
                    }
                }
            }
            match page["@odata.nextLink"].as_str() {
                Some(link) => next = link.to_string(),
                None => break,
            }
        }
    }
    Ok(Listing {
        site: Some((
            site_id,
            site["displayName"]
                .as_str()
                .unwrap_or(&settings.site)
                .to_string(),
            site["webUrl"].as_str().unwrap_or_default().to_string(),
        )),
        files,
        warnings,
        complete,
    })
}

fn has_password(connection_string: &str) -> bool {
    match Url::parse(connection_string) {
        Ok(url) => {
            url.password().is_some()
                || url.query_pairs().any(|(key, _)| {
                    matches!(
                        key.to_ascii_lowercase().as_str(),
                        "password" | "pwd" | "passwd"
                    )
                })
        }
        Err(_) => connection_string.split(';').any(|part| {
            matches!(
                part.split('=')
                    .next()
                    .map(|key| key.trim().to_ascii_lowercase())
                    .as_deref(),
                Some("password" | "pwd")
            )
        }),
    }
}

fn short_hash(value: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in value.bytes() {
        hash = (hash ^ byte as u32).wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

fn safe_id(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .take(40)
        .collect()
}

fn connections_from_file(
    item_id: &str,
    file_name: &str,
    raw: &str,
    warnings: &mut Vec<String>,
    complete: &mut bool,
) -> Vec<Value> {
    let parsed: Value = match serde_json::from_str(raw.trim_start_matches('\u{feff}')) {
        Ok(value) => value,
        Err(error) => {
            warnings.push(format!(
                "{file_name}: kein gültiges JSON ({error}). Bis zur Korrektur bleiben bestehende Verbindungen erhalten."
            ));
            *complete = false;
            return Vec::new();
        }
    };
    let entries = match parsed.get("connections") {
        Some(Value::Array(entries)) => entries.clone(),
        _ => vec![parsed],
    };
    let base = file_name.rsplit('/').next().unwrap_or(file_name);
    let stem = base
        .strip_suffix(".json")
        .or_else(|| base.strip_suffix(".JSON"))
        .unwrap_or(base);
    let prefix = short_hash(item_id);
    entries
        .into_iter()
        .enumerate()
        .filter_map(|(index, mut entry)| {
            let connection_string = entry["connectionString"].as_str().unwrap_or_default();
            if connection_string.is_empty() || entry["kind"].as_str().is_none() {
                warnings.push(format!(
                    "{file_name}: Eintrag {} ohne kind oder connectionString",
                    index + 1
                ));
                *complete = false;
                return None;
            }
            if has_password(connection_string) {
                warnings.push(format!(
                    "{file_name}: Eintrag {} enthält ein Passwort und wird ignoriert",
                    index + 1
                ));
                return None;
            }
            let local = entry["id"]
                .as_str()
                .map(safe_id)
                .filter(|id| !id.is_empty())
                .unwrap_or_else(|| format!("{}-{index}", safe_id(stem)));
            if entry["name"].as_str().is_none_or(str::is_empty) {
                entry["name"] = json!(stem);
            }
            entry["id"] = json!(format!("{prefix}-{local}"));
            Some(entry)
        })
        .collect()
}

async fn read_limited(mut response: reqwest::Response) -> Result<String, String> {
    if response.content_length().unwrap_or(0) > MAX_FILE_BYTES {
        return Err("größer als 256 KB".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        body.extend_from_slice(&chunk);
        if body.len() as u64 > MAX_FILE_BYTES {
            return Err("größer als 256 KB".into());
        }
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

async fn fetch(settings: &Settings, stored: &mut Stored) -> Result<Value, String> {
    let tokens = token(
        settings,
        &stored.tenant,
        &[
            ("client_id", settings.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", stored.refresh.as_str()),
            ("scope", settings.scopes),
        ],
    )
    .await?;
    if let Some(refresh) = tokens.refresh_token {
        stored.refresh = refresh;
    }
    let pinned = stored
        .site
        .as_ref()
        .is_some_and(|(key, _)| *key == settings.site_key());
    let listing = list_files(settings, &tokens.access_token, pinned).await?;
    if let Some((site_id, _, _)) = &listing.site {
        check_pin(settings, stored, site_id)?;
    }
    let downloads: Vec<_> = stream::iter(listing.files)
        .map(|(id, url, name)| async move {
            let valid = Url::parse(&url).is_ok_and(|parsed| {
                parsed.scheme() == "https"
                    || (cfg!(debug_assertions) && parsed.host_str() == Some("127.0.0.1"))
            });
            if !valid {
                return (id, name, Err("ungültige Download-Adresse".to_string()));
            }
            let body = match http().get(&url).send().await {
                Ok(response) if response.status().is_success() => read_limited(response).await,
                Ok(response) => Err(format!("HTTP {}", response.status())),
                Err(error) => Err(error.to_string()),
            };
            (id, name, body)
        })
        .buffer_unordered(DOWNLOADS)
        .collect()
        .await;
    let mut downloads = downloads;
    downloads.sort_by(|left, right| left.1.cmp(&right.1));
    let mut warnings = listing.warnings;
    let mut complete = listing.complete;
    let mut connections = Vec::new();
    for (id, name, body) in downloads {
        match body {
            Ok(raw) => connections.extend(connections_from_file(
                &id,
                &name,
                &raw,
                &mut warnings,
                &mut complete,
            )),
            Err(error) => return Err(format!("{name} konnte nicht geladen werden: {error}")),
        }
    }
    Ok(json!({
        "name": listing.site.as_ref().map(|site| &site.1),
        "url": listing.site.as_ref().map(|site| &site.2),
        "user": stored.user,
        "connections": connections,
        "warnings": warnings,
        "complete": complete,
    }))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ShareFolder {
    id: String,
    name: String,
    #[serde(rename = "webUrl")]
    web_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Shared {
    #[serde(rename = "entryId")]
    entry_id: String,
    #[serde(rename = "webUrl")]
    web_url: String,
}

async fn stored_session(settings: &Settings) -> Result<Stored, String> {
    let raw = load_secret(account(HUB)).await?.ok_or(EXPIRED)?;
    let stored: Stored = serde_json::from_str(&raw).map_err(|_| EXPIRED.to_string())?;
    if is_guid(&settings.tenant) && !stored.tenant.eq_ignore_ascii_case(&settings.tenant) {
        return Err(EXPIRED.into());
    }
    Ok(stored)
}

async fn refreshed(
    settings: &Settings,
    stored: &mut Stored,
    scopes: &str,
) -> Result<String, String> {
    let tokens = token(
        settings,
        &stored.tenant,
        &[
            ("client_id", settings.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", stored.refresh.as_str()),
            ("scope", scopes),
        ],
    )
    .await?;
    if let Some(refresh) = tokens.refresh_token {
        stored.refresh = refresh;
        save(stored).await?;
    }
    Ok(tokens.access_token)
}

fn write_scopes(settings: &Settings) -> &'static str {
    if settings.scopes == SELECTED_SCOPES {
        SELECTED_SCOPES
    } else {
        WRITE_SCOPES
    }
}

async fn folders_with(
    settings: &Settings,
    access: &str,
) -> Result<(String, Vec<ShareFolder>), String> {
    let site = resolve_site(settings, access)
        .await?
        .ok_or("Die SharePoint-Website für Team-Verbindungen ist nicht erreichbar.")?;
    let site_id = site["id"]
        .as_str()
        .ok_or("SharePoint-Website ohne ID.")?
        .to_string();
    let mut folders = vec![ShareFolder {
        id: "root".into(),
        name: "Oberste Ebene".into(),
        web_url: site["webUrl"].as_str().unwrap_or_default().into(),
    }];
    let mut next = format!(
        "{}/v1.0/sites/{site_id}/drive/root/children?$top=200",
        settings.graph
    );
    loop {
        let Some(page) = graph_get(settings, access, &next).await? else {
            break;
        };
        for item in page["value"].as_array().into_iter().flatten() {
            if item.get("folder").is_some() {
                folders.push(ShareFolder {
                    id: item["id"].as_str().unwrap_or_default().into(),
                    name: item["name"].as_str().unwrap_or_default().into(),
                    web_url: item["webUrl"].as_str().unwrap_or_default().into(),
                });
            }
        }
        match page["@odata.nextLink"].as_str() {
            Some(link) => next = link.to_string(),
            None => break,
        }
    }
    Ok((site_id, folders))
}

async fn upload(
    settings: &Settings,
    access: &str,
    site_id: &str,
    folder: &str,
    stem: &str,
    content: &Value,
) -> Result<Shared, String> {
    let raw = serde_json::to_string_pretty(content).map_err(|e| e.to_string())?;
    let mut warnings = Vec::new();
    let mut complete = true;
    if connections_from_file("check", "check.json", &raw, &mut warnings, &mut complete).len() != 1 {
        return Err(warnings
            .join(" ")
            .trim()
            .to_string()
            .replace("check.json: ", ""));
    }
    let local = content["id"].as_str().map(safe_id).unwrap_or_default();
    for attempt in 1..=20 {
        let name = if attempt == 1 {
            format!("{stem}.json")
        } else {
            format!("{stem}-{attempt}.json")
        };
        let target = if folder == "root" {
            format!(
                "{}/v1.0/sites/{site_id}/drive/root:/{name}:/content",
                settings.graph
            )
        } else {
            format!(
                "{}/v1.0/sites/{site_id}/drive/items/{folder}:/{name}:/content",
                settings.graph
            )
        };
        let response = http()
            .put(format!("{target}?@microsoft.graph.conflictBehavior=fail"))
            .bearer_auth(access)
            .header("content-type", "application/json")
            .body(raw.clone())
            .send()
            .await
            .map_err(|e| format!("Microsoft Graph nicht erreichbar: {e}"))?;
        match response.status().as_u16() {
            200 | 201 => {
                let item: Value = response.json().await.map_err(|e| e.to_string())?;
                let item_id = item["id"].as_str().ok_or("SharePoint lieferte keine Datei-ID.")?;
                return Ok(Shared {
                    entry_id: format!("{}-{local}", short_hash(item_id)),
                    web_url: item["webUrl"].as_str().unwrap_or_default().into(),
                });
            }
            409 => continue,
            401 => return Err(EXPIRED.into()),
            403 => return Err("Du darfst in diesem Ordner nichts ablegen. Schreibrechte vergibt die IT in SharePoint.".into()),
            status => return Err(format!("Microsoft Graph antwortete mit {status}.")),
        }
    }
    Err("Es gibt bereits zu viele Dateien mit diesem Namen.".into())
}

fn check_pin(settings: &Settings, stored: &mut Stored, site_id: &str) -> Result<(), String> {
    let key = settings.site_key();
    match &stored.site {
        Some((known_key, known_id)) if *known_key == key && known_id != site_id => Err(format!("Die SharePoint-Website „{key}“ wurde durch eine andere ersetzt. l8db übernimmt aus Sicherheitsgründen nichts. Bitte die IT prüfen lassen und dann ab- und wieder anmelden.")),
        _ => {
            stored.site = Some((key, site_id.to_string()));
            Ok(())
        }
    }
}

async fn write_access(
    app: &tauri::AppHandle,
    settings: &Settings,
) -> Result<(String, Stored), String> {
    let mut stored = stored_session(settings).await?;
    let scopes = write_scopes(settings);
    match refreshed(settings, &mut stored, scopes).await {
        Ok(access) => Ok((access, stored)),
        Err(error) if error == EXPIRED || error.starts_with(CONSENT_REQUIRED) => {
            let (mut fresh, access) =
                login_with(settings, scopes, Some(&stored), browser(app)).await?;
            fresh.site = stored.site;
            save(&fresh).await?;
            Ok((access, fresh))
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub async fn team_share_folders(app: tauri::AppHandle) -> Result<Vec<ShareFolder>, String> {
    let settings = settings(&app)?;
    let mut stored = stored_session(&settings).await?;
    let access = refreshed(&settings, &mut stored, settings.scopes).await?;
    let (site_id, folders) = folders_with(&settings, &access).await?;
    check_pin(&settings, &mut stored, &site_id)?;
    save(&stored).await?;
    Ok(folders)
}

#[tauri::command]
pub async fn team_share(
    app: tauri::AppHandle,
    folder: String,
    name: String,
    content: Value,
) -> Result<Shared, String> {
    let settings = settings(&app)?;
    let stem = safe_id(&name.to_lowercase());
    if stem.is_empty() {
        return Err("Ungültiger Dateiname.".into());
    }
    let (access, mut stored) = write_access(&app, &settings).await?;
    let (site_id, folders) = folders_with(&settings, &access).await?;
    check_pin(&settings, &mut stored, &site_id)?;
    if !folders.iter().any(|entry| entry.id == folder) {
        return Err("Der gewählte Ordner existiert nicht mehr.".into());
    }
    upload(&settings, &access, &site_id, &folder, &stem, &content).await
}

#[tauri::command]
pub async fn team_share_consent(app: tauri::AppHandle) -> Result<(), String> {
    let settings = settings(&app)?;
    grant_consent(&settings, write_scopes(&settings), browser(&app)).await
}

pub async fn connections(app: &tauri::AppHandle) -> Result<Value, String> {
    let settings = settings(app)?;
    let raw = load_secret(account(HUB)).await?.ok_or(EXPIRED)?;
    let mut stored: Stored = serde_json::from_str(&raw).map_err(|_| EXPIRED.to_string())?;
    if is_guid(&settings.tenant) && !stored.tenant.eq_ignore_ascii_case(&settings.tenant) {
        return Err(EXPIRED.into());
    }
    let previous = (stored.refresh.clone(), stored.site.clone());
    let result = fetch(&settings, &mut stored).await;
    if (stored.refresh.clone(), stored.site.clone()) != previous {
        save(&stored).await?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::http_mock;
    use crate::team::tests::SERIAL;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex as StdMutex, OnceLock};

    const TENANT: &str = "11111111-2222-3333-4444-555555555555";

    fn id_token(tid: &str) -> String {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
            json!({ "tid": tid, "name": "Max Muster", "preferred_username": "max@firma.de" })
                .to_string(),
        );
        format!("e30.{payload}.sig")
    }

    fn settings_with(base: &str, policy: MicrosoftPolicy) -> Settings {
        Settings::new(
            Some(MicrosoftPolicy {
                client_id: Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into()),
                ..policy
            }),
            base,
            base,
        )
        .unwrap()
    }

    fn settings(base: &str) -> Settings {
        settings_with(base, MicrosoftPolicy::default())
    }

    fn stored(refresh: &str) -> Stored {
        Stored {
            refresh: refresh.into(),
            tenant: TENANT.into(),
            user: TeamUser {
                email: "max@firma.de".into(),
                name: "Max".into(),
            },
            site: None,
        }
    }

    struct Mock {
        server: http_mock::MockServer,
        site_status: Arc<StdMutex<u16>>,
        site_id: Arc<StdMutex<&'static str>>,
        broken_page: Arc<StdMutex<bool>>,
    }

    fn graph_mock() -> Mock {
        let base = Arc::new(OnceLock::<String>::new());
        let site_status = Arc::new(StdMutex::new(200u16));
        let site_id = Arc::new(StdMutex::new("site-1"));
        let broken_page = Arc::new(StdMutex::new(false));
        let (shared, status, id, broken) = (
            base.clone(),
            site_status.clone(),
            site_id.clone(),
            broken_page.clone(),
        );
        let server = http_mock::start(move |request| {
            let base = shared.get().cloned().unwrap_or_default();
            let route = request.route().to_string();
            let site = *id.lock().unwrap();
            if request.method == "PUT" {
                return match route.as_str() {
                    "/v1.0/sites/site-1/drive/items/folder-1:/crm.json:/content" => (409, b"{}".to_vec()),
                    "/v1.0/sites/site-1/drive/items/folder-1:/crm-2.json:/content" => (
                        201,
                        json!({ "id": "new-item", "webUrl": "https://firma.sharepoint.com/sites/l8db/Vertrieb/crm-2.json" })
                            .to_string()
                            .into_bytes(),
                    ),
                    "/v1.0/sites/site-1/drive/items/locked:/crm.json:/content" => (403, b"{}".to_vec()),
                    _ => (404, b"{}".to_vec()),
                };
            }
            let body = match route.as_str() {
                path if path.ends_with("/oauth2/v2.0/token") => {
                    if request.form("refresh_token").as_deref() == Some("stale") {
                        return (
                            400,
                            json!({ "error": "invalid_grant" }).to_string().into_bytes(),
                        );
                    }
                    json!({ "access_token": "access", "refresh_token": "rotated", "id_token": id_token(TENANT) })
                }
                "/v1.0/sites/root" => {
                    json!({ "siteCollection": { "hostname": "firma.sharepoint.com" } })
                }
                "/v1.0/sites/firma.sharepoint.com:/sites/l8db"
                | "/v1.0/sites/firma.sharepoint.com:/sites/it-l8db" => {
                    let code = *status.lock().unwrap();
                    if code != 200 {
                        return (code, b"{}".to_vec());
                    }
                    json!({ "id": site, "displayName": "l8db Verbindungen", "webUrl": "https://firma.sharepoint.com/sites/l8db" })
                }
                path if path == format!("/v1.0/sites/{site}/drive/root/children")
                    && request.query("page").is_none() =>
                {
                    json!({
                        "value": [
                            { "id": "folder-1", "name": "Vertrieb", "folder": {}, "webUrl": "https://firma.sharepoint.com/sites/l8db/Vertrieb" },
                            { "id": "file-1", "name": "kunden.json", "file": {}, "size": 100,
                              "@microsoft.graph.downloadUrl": format!("{base}/download/kunden") },
                            { "id": "file-big", "name": "riesig.json", "file": {}, "size": 999999 },
                            { "id": "file-x", "name": "notiz.txt", "file": {}, "size": 10 }
                        ],
                        "@odata.nextLink": format!("{base}/v1.0/sites/{site}/drive/root/children?page=2")
                    })
                }
                path if path == format!("/v1.0/sites/{site}/drive/root/children") => {
                    if *broken.lock().unwrap() {
                        return (404, b"{}".to_vec());
                    }
                    json!({
                        "value": [{ "id": "file-2", "name": "lager.json", "file": {}, "size": 100,
                                    "@microsoft.graph.downloadUrl": format!("{base}/download/lager") }]
                    })
                }
                path if path == format!("/v1.0/sites/{site}/drive/items/folder-1/children") => {
                    json!({
                        "value": [{ "id": "file-3", "name": "crm.json", "file": {}, "size": 100,
                                    "@microsoft.graph.downloadUrl": format!("{base}/download/crm") }]
                    })
                }
                "/download/kunden" => {
                    json!({ "name": "Kunden", "kind": "postgres", "connectionString": "postgres://kunden.intern/db" })
                }
                "/download/lager" => json!({ "connections": [
                    { "id": "lager", "name": "Lager", "kind": "mysql", "connectionString": "mysql://lager.intern/db" },
                    { "id": "geheim", "name": "Geheim", "kind": "postgres", "connectionString": "postgres://h/db?password=x" }
                ] }),
                "/download/crm" => {
                    json!({ "kind": "mssql", "connectionString": "mssql://crm.intern:1433/crm" })
                }
                _ => return (404, b"{}".to_vec()),
            };
            (200, body.to_string().into_bytes())
        });
        base.set(server.base.clone()).unwrap();
        Mock {
            server,
            site_status,
            site_id,
            broken_page,
        }
    }

    fn query(url: &Url) -> HashMap<String, String> {
        url.query_pairs().into_owned().collect()
    }

    #[tokio::test]
    async fn login_uses_pkce_loopback_and_reads_the_organisation_from_the_id_token() {
        let _serial = SERIAL.lock().await;
        let mock = graph_mock();
        let settings = settings(&mock.server.base);
        let (stored, access) = login_with(&settings, settings.scopes, None, |url| {
            let query = query(&url);
            assert_eq!(url.path(), "/organizations/oauth2/v2.0/authorize");
            assert_eq!(query["prompt"], "select_account");
            assert_eq!(query["code_challenge_method"], "S256");
            assert!(query["scope"].contains("Sites.Read.All"));
            let callback = format!(
                "{}/?code=abc&state={}",
                query["redirect_uri"], query["state"]
            );
            tokio::spawn(async move { reqwest::get(callback).await.unwrap() });
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(access, "access");
        assert_eq!(stored.tenant, TENANT);
        assert_eq!(stored.refresh, "rotated");
        assert_eq!(stored.user.email, "max@firma.de");
        let exchange = mock
            .server
            .requests()
            .into_iter()
            .find(|request| request.form("grant_type").as_deref() == Some("authorization_code"))
            .unwrap();
        assert_eq!(exchange.form("code").as_deref(), Some("abc"));
        assert_eq!(exchange.form("code_verifier").map(|v| v.len()), Some(43));
        assert!(exchange
            .form("redirect_uri")
            .unwrap()
            .starts_with("http://127.0.0.1:"));
        assert!(exchange.form("client_secret").is_none());
    }

    #[tokio::test]
    async fn admin_consent_uses_the_documented_endpoint_and_missing_consent_is_explained() {
        let _serial = SERIAL.lock().await;
        let mock = graph_mock();
        let settings = settings(&mock.server.base);
        grant_consent(&settings, settings.scopes, |url| {
            let query = query(&url);
            assert_eq!(url.path(), "/organizations/v2.0/adminconsent");
            assert!(query["scope"].ends_with("Sites.Read.All"));
            let callback = format!(
                "{}/?admin_consent=True&tenant={TENANT}&state={}",
                query["redirect_uri"], query["state"]
            );
            tokio::spawn(async move { reqwest::get(callback).await.unwrap() });
            Ok(())
        })
        .await
        .unwrap();
        let error = login_with(&settings, settings.scopes, None, |url| {
            let query = query(&url);
            let callback = format!(
                "{}/?error=consent_required&error_description=AADSTS65001+needs+admin&state={}",
                query["redirect_uri"], query["state"]
            );
            tokio::spawn(async move { reqwest::get(callback).await.unwrap() });
            Ok(())
        })
        .await
        .unwrap_err();
        assert!(error.starts_with(CONSENT_REQUIRED), "{error}");
    }

    #[tokio::test]
    async fn sync_reads_every_permitted_file_and_rotates_the_refresh_token() {
        let mock = graph_mock();
        let mut stored = stored("first");
        let payload = fetch(&settings(&mock.server.base), &mut stored)
            .await
            .unwrap();
        assert_eq!(stored.refresh, "rotated");
        assert_eq!(stored.site, Some(("l8db".into(), "site-1".into())));
        assert_eq!(payload["name"], "l8db Verbindungen");
        assert_eq!(payload["url"], "https://firma.sharepoint.com/sites/l8db");
        assert_eq!(payload["complete"], false);
        let entries = payload["connections"].as_array().unwrap();
        let names: Vec<_> = entries
            .iter()
            .map(|entry| entry["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["crm", "Kunden", "Lager"]);
        assert!(entries.iter().all(|entry| {
            let id = entry["id"].as_str().unwrap();
            id.len() <= 64
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        }));
        let warnings = payload["warnings"].to_string();
        assert!(warnings.contains("riesig.json"), "{warnings}");
        assert!(warnings.contains("Passwort"), "{warnings}");
        let downloads: Vec<_> = mock
            .server
            .requests()
            .into_iter()
            .filter(|r| r.route().starts_with("/download/"))
            .collect();
        assert_eq!(downloads.len(), 3);
        assert!(downloads
            .iter()
            .all(|r| r.header("authorization").is_none()));
    }

    #[tokio::test]
    async fn a_replaced_site_is_refused_and_a_broken_listing_is_an_error() {
        let mock = graph_mock();
        let settings = settings(&mock.server.base);
        let mut stored = stored("first");
        fetch(&settings, &mut stored).await.unwrap();
        *mock.site_id.lock().unwrap() = "site-evil";
        let error = fetch(&settings, &mut stored).await.unwrap_err();
        assert!(error.contains("ersetzt"), "{error}");
        *mock.site_id.lock().unwrap() = "site-1";
        *mock.site_status.lock().unwrap() = 403;
        let payload = fetch(&settings, &mut stored).await.unwrap();
        assert_eq!(payload["complete"], false);
        assert!(payload["warnings"][0]
            .as_str()
            .unwrap()
            .contains("bleiben erhalten"));
        *mock.site_status.lock().unwrap() = 200;
        *mock.broken_page.lock().unwrap() = true;
        let error = fetch(&settings, &mut stored).await.unwrap_err();
        assert!(error.contains("Auflistung"), "{error}");
    }

    #[tokio::test]
    async fn a_pinned_site_url_skips_the_root_lookup() {
        let mock = graph_mock();
        let settings = settings_with(
            &mock.server.base,
            MicrosoftPolicy {
                site_url: Some("https://firma.sharepoint.com/sites/it-l8db/".into()),
                scope: Some("selected".into()),
                ..Default::default()
            },
        );
        assert!(settings.scopes.contains("Sites.Selected"));
        let payload = fetch(&settings, &mut stored("first")).await.unwrap();
        assert_eq!(payload["connections"].as_array().unwrap().len(), 3);
        assert!(!mock
            .server
            .requests()
            .iter()
            .any(|r| r.route() == "/v1.0/sites/root"));
    }

    #[tokio::test]
    async fn users_without_access_to_the_site_get_no_connections_with_a_hint() {
        for status in [403, 404] {
            let mock = graph_mock();
            *mock.site_status.lock().unwrap() = status;
            let payload = fetch(&settings(&mock.server.base), &mut stored("first"))
                .await
                .unwrap();
            assert_eq!(payload["connections"], json!([]));
            assert_eq!(payload["complete"], true);
            assert!(payload["warnings"][0]
                .as_str()
                .unwrap()
                .contains("Keine Freigaben"));
        }
    }

    #[tokio::test]
    async fn revoked_sessions_ask_for_a_new_login() {
        let mock = graph_mock();
        assert_eq!(
            fetch(&settings(&mock.server.base), &mut stored("stale"))
                .await
                .unwrap_err(),
            EXPIRED
        );
    }

    #[tokio::test]
    async fn graph_links_to_other_hosts_are_refused() {
        let settings = settings("https://graph.example");
        assert!(graph_get(&settings, "token", "https://evil.example/v1.0/x")
            .await
            .is_err());
        assert!(
            graph_get(&settings, "token", "https://graph.example.evil/v1.0/x")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn the_write_login_must_stay_with_the_same_account_and_tenant() {
        let _serial = SERIAL.lock().await;
        let mock = graph_mock();
        let settings = settings(&mock.server.base);
        let known = Stored {
            user: TeamUser {
                email: "erika@firma.de".into(),
                name: "Erika".into(),
            },
            ..stored("first")
        };
        let error = login_with(&settings, WRITE_SCOPES, Some(&known), |url| {
            let query = query(&url);
            assert_eq!(url.path(), format!("/{TENANT}/oauth2/v2.0/authorize"));
            assert_eq!(query["login_hint"], "erika@firma.de");
            assert!(!query.contains_key("prompt"));
            assert!(query["scope"].contains("Sites.ReadWrite.All"));
            let callback = format!(
                "{}/?code=abc&state={}",
                query["redirect_uri"], query["state"]
            );
            tokio::spawn(async move { reqwest::get(callback).await.unwrap() });
            Ok(())
        })
        .await
        .unwrap_err();
        assert!(error.contains("demselben Konto"), "{error}");
    }

    #[tokio::test]
    async fn sharing_lists_folders_and_uploads_without_overwriting() {
        let mock = graph_mock();
        let settings = settings(&mock.server.base);
        let (site_id, folders) = folders_with(&settings, "access").await.unwrap();
        assert_eq!(site_id, "site-1");
        assert_eq!(
            folders.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
            ["root", "folder-1"]
        );
        assert_eq!(
            folders[1].web_url,
            "https://firma.sharepoint.com/sites/l8db/Vertrieb"
        );
        let content = json!({ "id": "crm", "name": "CRM", "kind": "mssql", "connectionString": "mssql://crm.firma.intern:1433/crm" });
        let shared = upload(&settings, "access", &site_id, "folder-1", "crm", &content)
            .await
            .unwrap();
        assert_eq!(shared.entry_id, format!("{}-crm", short_hash("new-item")));
        let puts: Vec<_> = mock
            .server
            .requests()
            .into_iter()
            .filter(|r| r.method == "PUT")
            .collect();
        assert_eq!(puts.len(), 2);
        assert!(puts
            .iter()
            .all(|r| r.path.contains("conflictBehavior=fail")));
        assert_eq!(
            serde_json::from_str::<Value>(&puts[1].body).unwrap(),
            content
        );
        let locked = upload(&settings, "access", &site_id, "locked", "crm", &content)
            .await
            .unwrap_err();
        assert!(locked.contains("Schreibrechte"), "{locked}");
        let secret = json!({ "id": "x", "name": "X", "kind": "postgres", "connectionString": "postgres://u:pw@h/db" });
        let refused = upload(&settings, "access", &site_id, "folder-1", "x", &secret)
            .await
            .unwrap_err();
        assert!(refused.contains("Passwort"), "{refused}");
        assert_eq!(
            mock.server
                .requests()
                .iter()
                .filter(|r| r.method == "PUT")
                .count(),
            3
        );
    }

    #[test]
    fn policy_and_files_are_validated() {
        let invalid = [
            MicrosoftPolicy {
                client_id: Some("nope".into()),
                ..Default::default()
            },
            MicrosoftPolicy {
                site: Some("a/b".into()),
                ..Default::default()
            },
            MicrosoftPolicy {
                site_url: Some("http://firma.sharepoint.com/sites/x".into()),
                ..Default::default()
            },
            MicrosoftPolicy {
                site_url: Some("https://firma.sharepoint.com/teams".into()),
                ..Default::default()
            },
            MicrosoftPolicy {
                scope: Some("selected".into()),
                ..Default::default()
            },
            MicrosoftPolicy {
                scope: Some("everything".into()),
                ..Default::default()
            },
        ];
        for policy in invalid {
            assert!(policy.clone().validate().is_err(), "{policy:?}");
        }
        assert!(MicrosoftPolicy {
            tenant: Some("firma.onmicrosoft.com".into()),
            site_url: Some("https://firma.sharepoint.com/sites/l8db".into()),
            scope: Some("selected".into()),
            ..Default::default()
        }
        .validate()
        .is_ok());
        assert_eq!(
            Settings::new(None, "https://a", "https://b").is_err(),
            CLIENT_ID.is_empty()
        );
        let mut warnings = Vec::new();
        let mut complete = true;
        assert!(
            connections_from_file("x", "a.json", "kaputt", &mut warnings, &mut complete).is_empty()
        );
        assert!(!complete);
        for secret in [
            "Server=h;Password=x",
            "postgres://u:pw@h/db",
            "postgres://h/db?sslmode=disable&PASSWORD=x",
        ] {
            let raw = json!({ "kind": "postgres", "connectionString": secret }).to_string();
            assert!(
                connections_from_file("x", "b.json", &raw, &mut warnings, &mut complete).is_empty(),
                "{secret}"
            );
        }
        assert_eq!(warnings.len(), 4);
    }
}
