use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use reqwest::header::HeaderMap;
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const MAX_PAYLOAD_BYTES: usize = 32 * 1024 * 1024;
pub const GIST_FILE: &str = "l8db-sync.json";
pub const GITHUB_API: &str = "https://api.github.com";

const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    pub content: Option<String>,
    pub version: Option<String>,
    pub gist_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoreResult {
    pub version: Option<String>,
    pub gist_id: Option<String>,
    pub conflict: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Precondition {
    None,
    Match(String),
    Absent,
}

pub fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent(concat!("l8db/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP-Client konnte nicht erstellt werden: {e}"))
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Zeitüberschreitung bei der Verbindung zum Sync-Server.".into()
    } else if error.is_connect() {
        format!("Sync-Server nicht erreichbar: {error}")
    } else {
        format!("Netzwerkfehler: {error}")
    }
}

async fn bounded_text(response: reqwest::Response) -> Result<String, String> {
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_PAYLOAD_BYTES)
    {
        return Err("Die Sync-Datei ist größer als 32 MiB.".into());
    }
    let bytes = response.bytes().await.map_err(network_error)?;
    if bytes.len() > MAX_PAYLOAD_BYTES {
        return Err("Die Sync-Datei ist größer als 32 MiB.".into());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "Die Sync-Datei ist kein gültiges UTF-8.".into())
}

fn header(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

pub struct WebDav<'a> {
    pub url: &'a str,
    pub username: &'a str,
    pub password: &'a str,
    pub path: &'a str,
    pub allow_insecure: bool,
}

impl WebDav<'_> {
    fn base(&self) -> Result<url::Url, String> {
        let parsed =
            url::Url::parse(self.url.trim()).map_err(|_| "Ungültige WebDAV-URL.".to_string())?;
        match parsed.scheme() {
            "https" => {}
            "http" if self.allow_insecure => {}
            "http" => {
                return Err(
                    "Die WebDAV-URL nutzt unverschlüsseltes HTTP. Bitte HTTPS verwenden oder die unsichere Verbindung ausdrücklich bestätigen."
                        .into(),
                )
            }
            _ => return Err("Die WebDAV-URL muss mit https:// beginnen.".into()),
        }
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err("Zugangsdaten gehören nicht in die WebDAV-URL.".into());
        }
        Ok(parsed)
    }

    fn segments(&self) -> Result<Vec<String>, String> {
        let segments: Vec<String> = self
            .path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .map(str::to_string)
            .collect();
        if segments.is_empty() {
            return Err("Bitte einen Dateipfad auf dem WebDAV-Server angeben.".into());
        }
        if segments
            .iter()
            .any(|segment| segment == "." || segment == ".." || segment.contains('\\'))
        {
            return Err("Der WebDAV-Pfad darf keine relativen Segmente enthalten.".into());
        }
        Ok(segments)
    }

    fn join(&self, segments: &[String], collection: bool) -> Result<String, String> {
        let base = self.base()?;
        let mut out = base.as_str().trim_end_matches('/').to_string();
        for segment in segments {
            out.push('/');
            out.push_str(&utf8_percent_encode(segment, SEGMENT).to_string());
        }
        if collection {
            out.push('/');
        }
        Ok(out)
    }

    pub fn file_url(&self) -> Result<String, String> {
        self.join(&self.segments()?, false)
    }

    fn request(&self, client: &Client, method: Method, url: &str) -> reqwest::RequestBuilder {
        client
            .request(method, url)
            .basic_auth(self.username, Some(self.password))
    }

    fn error(status: StatusCode, action: &str) -> String {
        match status.as_u16() {
            401 => "WebDAV-Anmeldung fehlgeschlagen (401). Benutzername und App-Passwort prüfen."
                .into(),
            403 => format!("WebDAV-Zugriff verweigert (403) beim {action}."),
            404 => format!("WebDAV-Pfad nicht gefunden (404) beim {action}."),
            405 => format!(
                "Der Server erlaubt das {action} nicht (405). Ist die URL ein WebDAV-Endpunkt?"
            ),
            423 => "Die Sync-Datei ist auf dem Server gesperrt (423).".into(),
            507 => "Kein Speicherplatz mehr auf dem WebDAV-Server (507).".into(),
            code => format!("WebDAV-Fehler {code} beim {action}."),
        }
    }

    pub async fn test(&self, client: &Client) -> Result<String, String> {
        self.segments()?;
        let url = self.join(&[], true)?;
        let response = self
            .request(client, Method::from_bytes(b"PROPFIND").unwrap(), &url)
            .header("Depth", "0")
            .header("Content-Type", "application/xml")
            .body("<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>")
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        if status.as_u16() == 207 || status.is_success() {
            Ok("WebDAV-Verbindung erfolgreich.".into())
        } else {
            Err(Self::error(status, "Verbindungstest"))
        }
    }

    pub async fn fetch(&self, client: &Client) -> Result<RemoteFile, String> {
        let url = self.file_url()?;
        let response = self
            .request(client, Method::GET, &url)
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(RemoteFile::default());
        }
        if !status.is_success() {
            return Err(Self::error(status, "Herunterladen"));
        }
        let version = header(response.headers(), "etag");
        Ok(RemoteFile {
            content: Some(bounded_text(response).await?),
            version,
            gist_id: None,
        })
    }

    async fn ensure_collections(&self, client: &Client) -> Result<(), String> {
        let segments = self.segments()?;
        for depth in 1..segments.len() {
            let url = self.join(&segments[..depth], true)?;
            let response = self
                .request(client, Method::from_bytes(b"MKCOL").unwrap(), &url)
                .send()
                .await
                .map_err(network_error)?;
            let status = response.status().as_u16();
            if !(matches!(status, 201 | 405 | 301 | 302) || (200..300).contains(&status)) {
                return Err(Self::error(response.status(), "Anlegen des Ordners"));
            }
        }
        Ok(())
    }

    async fn put(
        &self,
        client: &Client,
        content: &str,
        precondition: &Precondition,
    ) -> Result<reqwest::Response, String> {
        let mut request = self
            .request(client, Method::PUT, &self.file_url()?)
            .header("Content-Type", "application/json; charset=utf-8")
            .body(content.to_string());
        request = match precondition {
            Precondition::None => request,
            Precondition::Match(etag) => request.header("If-Match", etag),
            Precondition::Absent => request.header("If-None-Match", "*"),
        };
        request.send().await.map_err(network_error)
    }

    pub async fn store(
        &self,
        client: &Client,
        content: &str,
        precondition: Precondition,
    ) -> Result<StoreResult, String> {
        if content.len() > MAX_PAYLOAD_BYTES {
            return Err("Die Sync-Datei ist größer als 32 MiB.".into());
        }
        let mut response = self.put(client, content, &precondition).await?;
        if matches!(response.status().as_u16(), 404 | 409) {
            self.ensure_collections(client).await?;
            response = self.put(client, content, &precondition).await?;
        }
        let status = response.status();
        if status == StatusCode::PRECONDITION_FAILED {
            return Ok(StoreResult {
                conflict: true,
                ..StoreResult::default()
            });
        }
        if !status.is_success() {
            return Err(Self::error(status, "Hochladen"));
        }
        Ok(StoreResult {
            version: header(response.headers(), "etag")
                .or_else(|| header(response.headers(), "oc-etag")),
            gist_id: None,
            conflict: false,
        })
    }
}

pub struct Gist<'a> {
    pub api: &'a str,
    pub token: &'a str,
    pub gist_id: Option<&'a str>,
}

fn gist_error(status: StatusCode, headers: &HeaderMap) -> String {
    let remaining = header(headers, "x-ratelimit-remaining");
    if status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN && remaining.as_deref() == Some("0"))
    {
        let reset = header(headers, "x-ratelimit-reset")
            .and_then(|value| value.parse::<i64>().ok())
            .and_then(|seconds| chrono::DateTime::from_timestamp(seconds, 0))
            .map(|time| {
                format!(
                    " Wieder möglich ab {} Uhr.",
                    time.with_timezone(&chrono::Local).format("%H:%M")
                )
            })
            .or_else(|| {
                header(headers, "retry-after").map(|secs| format!(" Erneut versuchen in {secs} s."))
            })
            .unwrap_or_default();
        return format!("GitHub-Ratenlimit erreicht.{reset}");
    }
    match status.as_u16() {
        401 => "GitHub-Token ungültig oder abgelaufen (401).".into(),
        403 => "GitHub verweigert den Zugriff (403). Das Token benötigt den Scope „gist“.".into(),
        404 => "Gist nicht gefunden (404). Gist-ID prüfen und sicherstellen, dass das Token Zugriff hat.".into(),
        422 => "GitHub hat die Sync-Datei abgelehnt (422).".into(),
        code => format!("GitHub-Fehler {code}."),
    }
}

impl Gist<'_> {
    fn request(&self, client: &Client, method: Method, url: &str) -> reqwest::RequestBuilder {
        client
            .request(method, url)
            .bearer_auth(self.token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
    }

    fn require_token(&self) -> Result<(), String> {
        if self.token.trim().is_empty() {
            return Err("Kein GitHub-Token hinterlegt.".into());
        }
        Ok(())
    }

    fn validate_id(id: &str) -> Result<&str, String> {
        if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err("Ungültige Gist-ID.".into());
        }
        Ok(id)
    }

    pub async fn test(&self, client: &Client) -> Result<String, String> {
        self.require_token()?;
        let response = self
            .request(client, Method::GET, &format!("{}/user", self.api))
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            return Err(gist_error(response.status(), response.headers()));
        }
        if let Some(scopes) = header(response.headers(), "x-oauth-scopes") {
            if !scopes.split(',').any(|scope| scope.trim() == "gist") {
                return Err("Dem GitHub-Token fehlt der Scope „gist“.".into());
            }
        }
        if let Some(id) = self.gist_id {
            let id = Self::validate_id(id)?;
            let response = self
                .request(client, Method::GET, &format!("{}/gists/{id}", self.api))
                .send()
                .await
                .map_err(network_error)?;
            if !response.status().is_success() {
                return Err(gist_error(response.status(), response.headers()));
            }
        }
        Ok("GitHub-Verbindung erfolgreich.".into())
    }

    pub async fn fetch(&self, client: &Client) -> Result<RemoteFile, String> {
        self.require_token()?;
        let Some(id) = self.gist_id else {
            return Ok(RemoteFile::default());
        };
        let id = Self::validate_id(id)?;
        let response = self
            .request(client, Method::GET, &format!("{}/gists/{id}", self.api))
            .send()
            .await
            .map_err(network_error)?;
        if !response.status().is_success() {
            return Err(gist_error(response.status(), response.headers()));
        }
        let body: serde_json::Value = serde_json::from_str(&bounded_text(response).await?)
            .map_err(|_| "Ungültige Antwort von GitHub.".to_string())?;
        let version = body["history"][0]["version"]
            .as_str()
            .or_else(|| body["updated_at"].as_str())
            .map(str::to_string);
        let file = &body["files"][GIST_FILE];
        if file.is_null() {
            return Ok(RemoteFile {
                content: None,
                version,
                gist_id: Some(id.to_string()),
            });
        }
        let content = if file["truncated"].as_bool() == Some(true) {
            let raw = file["raw_url"]
                .as_str()
                .ok_or_else(|| "GitHub lieferte keine Rohdaten-URL.".to_string())?;
            let parsed = url::Url::parse(raw).map_err(|_| "Ungültige Rohdaten-URL.".to_string())?;
            let trusted_api = url::Url::parse(self.api).ok();
            let trusted = parsed.scheme() == "https"
                && parsed
                    .host_str()
                    .is_some_and(|host| host == "gist.githubusercontent.com")
                || trusted_api.is_some_and(|api| api.host_str() == parsed.host_str());
            if !trusted {
                return Err("Nicht vertrauenswürdige Rohdaten-URL von GitHub.".into());
            }
            let response = self
                .request(client, Method::GET, raw)
                .send()
                .await
                .map_err(network_error)?;
            if !response.status().is_success() {
                return Err(gist_error(response.status(), response.headers()));
            }
            bounded_text(response).await?
        } else {
            file["content"].as_str().unwrap_or_default().to_string()
        };
        Ok(RemoteFile {
            content: Some(content),
            version,
            gist_id: Some(id.to_string()),
        })
    }

    pub async fn store(&self, client: &Client, content: &str) -> Result<StoreResult, String> {
        self.require_token()?;
        if content.len() > MAX_PAYLOAD_BYTES {
            return Err("Die Sync-Datei ist größer als 32 MiB.".into());
        }
        let files = json!({ GIST_FILE: { "content": content } });
        let request = match self.gist_id {
            Some(id) => {
                let id = Self::validate_id(id)?;
                self.request(client, Method::PATCH, &format!("{}/gists/{id}", self.api))
                    .json(&json!({ "files": files }))
            }
            None => self
                .request(client, Method::POST, &format!("{}/gists", self.api))
                .json(&json!({
                    "description": "l8db Synchronisation",
                    "public": false,
                    "files": files,
                })),
        };
        let response = request.send().await.map_err(network_error)?;
        if !response.status().is_success() {
            return Err(gist_error(response.status(), response.headers()));
        }
        let body: serde_json::Value = serde_json::from_str(&bounded_text(response).await?)
            .map_err(|_| "Ungültige Antwort von GitHub.".to_string())?;
        Ok(StoreResult {
            version: body["history"][0]["version"]
                .as_str()
                .or_else(|| body["updated_at"].as_str())
                .map(str::to_string),
            gist_id: body["id"].as_str().map(str::to_string),
            conflict: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::http_mock::{start_with_headers, MockRequest};
    use std::sync::{Arc, Mutex};

    fn header_pair(name: &str, value: &str) -> (String, String) {
        (name.to_string(), value.to_string())
    }

    fn dav<'a>(url: &'a str, path: &'a str) -> WebDav<'a> {
        WebDav {
            url,
            username: "leon",
            password: "app-pass",
            path,
            allow_insecure: true,
        }
    }

    struct Nextcloud {
        files: Mutex<std::collections::HashMap<String, (String, u32)>>,
        collections: Mutex<std::collections::HashSet<String>>,
    }

    fn nextcloud() -> (crate::db::http_mock::MockServer, Arc<Nextcloud>) {
        let state = Arc::new(Nextcloud {
            files: Mutex::new(Default::default()),
            collections: Mutex::new(["/remote.php/dav/files/leon".to_string()].into()),
        });
        let shared = state.clone();
        let server = start_with_headers(move |request: &MockRequest| {
            if request.header("authorization") != Some("Basic bGVvbjphcHAtcGFzcw==") {
                return (401, vec![], b"".to_vec());
            }
            let path = request.route().trim_end_matches('/').to_string();
            let parent = path
                .rsplit_once('/')
                .map(|(p, _)| p.to_string())
                .unwrap_or_default();
            let mut files = shared.files.lock().unwrap();
            let mut collections = shared.collections.lock().unwrap();
            match request.method.as_str() {
                "PROPFIND" if collections.contains(&path) => {
                    (207, vec![], b"<multistatus/>".to_vec())
                }
                "PROPFIND" => (404, vec![], vec![]),
                "MKCOL" if collections.contains(&path) => (405, vec![], vec![]),
                "MKCOL" if !collections.contains(&parent) => (409, vec![], vec![]),
                "MKCOL" => {
                    collections.insert(path);
                    (201, vec![], vec![])
                }
                "GET" => match files.get(&path) {
                    Some((body, version)) => (
                        200,
                        vec![header_pair("ETag", &format!("\"v{version}\""))],
                        body.clone().into_bytes(),
                    ),
                    None => (404, vec![], vec![]),
                },
                "PUT" => {
                    if !collections.contains(&parent) {
                        return (409, vec![], vec![]);
                    }
                    let current = files.get(&path).map(|(_, v)| format!("\"v{v}\""));
                    if let Some(expected) = request.header("if-match") {
                        if current.as_deref() != Some(expected) {
                            return (412, vec![], vec![]);
                        }
                    }
                    if request.header("if-none-match") == Some("*") && current.is_some() {
                        return (412, vec![], vec![]);
                    }
                    let next = files.get(&path).map(|(_, v)| v + 1).unwrap_or(1);
                    files.insert(path, (request.body.clone(), next));
                    (
                        if next == 1 { 201 } else { 204 },
                        vec![header_pair("ETag", &format!("\"v{next}\""))],
                        vec![],
                    )
                }
                _ => (400, vec![], vec![]),
            }
        });
        (server, state)
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    #[test]
    fn webdav_creates_collections_and_uses_etags() {
        let (server, _) = nextcloud();
        let base = format!("{}/remote.php/dav/files/leon", server.base);
        let dav = dav(&base, "/l8db/sync/l8db-sync.json");
        let client = client().unwrap();
        runtime().block_on(async {
            assert!(dav.test(&client).await.is_ok());
            let empty = dav.fetch(&client).await.unwrap();
            assert_eq!(empty.content, None);
            let first = dav
                .store(&client, "{\"a\":1}", Precondition::Absent)
                .await
                .unwrap();
            assert_eq!(first.version.as_deref(), Some("\"v1\""));
            let fetched = dav.fetch(&client).await.unwrap();
            assert_eq!(fetched.content.as_deref(), Some("{\"a\":1}"));
            assert_eq!(fetched.version.as_deref(), Some("\"v1\""));
            let second = dav
                .store(&client, "{\"a\":2}", Precondition::Match("\"v1\"".into()))
                .await
                .unwrap();
            assert_eq!(second.version.as_deref(), Some("\"v2\""));
            let stale = dav
                .store(&client, "{\"a\":3}", Precondition::Match("\"v1\"".into()))
                .await
                .unwrap();
            assert!(stale.conflict);
            let absent = dav
                .store(&client, "{}", Precondition::Absent)
                .await
                .unwrap();
            assert!(absent.conflict);
        });
        let methods: Vec<String> = server
            .requests()
            .iter()
            .map(|r| format!("{} {}", r.method, r.route()))
            .collect();
        assert_eq!(
            methods[..6],
            [
                "PROPFIND /remote.php/dav/files/leon/",
                "GET /remote.php/dav/files/leon/l8db/sync/l8db-sync.json",
                "PUT /remote.php/dav/files/leon/l8db/sync/l8db-sync.json",
                "MKCOL /remote.php/dav/files/leon/l8db/",
                "MKCOL /remote.php/dav/files/leon/l8db/sync/",
                "PUT /remote.php/dav/files/leon/l8db/sync/l8db-sync.json",
            ]
        );
    }

    #[test]
    fn webdav_reports_bad_credentials_and_rejects_plain_http() {
        let (server, _) = nextcloud();
        let base = format!("{}/remote.php/dav/files/leon", server.base);
        let client = client().unwrap();
        let wrong = WebDav {
            password: "falsch",
            ..dav(&base, "/l8db.json")
        };
        let error = runtime().block_on(wrong.fetch(&client)).unwrap_err();
        assert!(error.contains("401"));
        let insecure = WebDav {
            allow_insecure: false,
            ..dav(&base, "/l8db.json")
        };
        assert!(runtime()
            .block_on(insecure.fetch(&client))
            .unwrap_err()
            .contains("unverschlüsseltes HTTP"));
        assert!(dav(&base, "/../x.json").file_url().is_err());
        assert!(dav("https://user:pw@host/dav", "/x.json")
            .file_url()
            .is_err());
        assert_eq!(
            dav("https://cloud.example/dav/", "/l8db/mein sync.json")
                .file_url()
                .unwrap(),
            "https://cloud.example/dav/l8db/mein%20sync.json"
        );
    }

    fn gist_server(
        rate_limited: bool,
    ) -> (crate::db::http_mock::MockServer, Arc<Mutex<Option<String>>>) {
        let stored = Arc::new(Mutex::new(None::<String>));
        let shared = stored.clone();
        let server =
            start_with_headers(move |request: &MockRequest| {
                if request.header("authorization") != Some("Bearer ghp_test") {
                    return (401, vec![], b"{\"message\":\"Bad credentials\"}".to_vec());
                }
                if rate_limited {
                    return (
                        403,
                        vec![
                            header_pair("X-RateLimit-Remaining", "0"),
                            header_pair("X-RateLimit-Reset", "1900000000"),
                        ],
                        b"{}".to_vec(),
                    );
                }
                let mut content = shared.lock().unwrap();
                match (request.method.as_str(), request.route()) {
                ("GET", "/user") => (
                    200,
                    vec![header_pair("X-OAuth-Scopes", "gist, repo")],
                    b"{\"login\":\"leon\"}".to_vec(),
                ),
                ("POST", "/gists") => {
                    let body = request.json();
                    assert_eq!(body["public"], false);
                    *content = body["files"][GIST_FILE]["content"].as_str().map(str::to_string);
                    (
                        201,
                        vec![],
                        json!({"id": "abc123", "history": [{"version": "h1"}]})
                            .to_string()
                            .into_bytes(),
                    )
                }
                ("PATCH", "/gists/abc123") => {
                    *content = request.json()["files"][GIST_FILE]["content"]
                        .as_str()
                        .map(str::to_string);
                    (
                        200,
                        vec![],
                        json!({"id": "abc123", "history": [{"version": "h2"}]})
                            .to_string()
                            .into_bytes(),
                    )
                }
                ("GET", "/gists/abc123") => (
                    200,
                    vec![],
                    json!({
                        "id": "abc123",
                        "history": [{"version": "h2"}],
                        "files": { GIST_FILE: { "content": content.clone(), "truncated": false } }
                    })
                    .to_string()
                    .into_bytes(),
                ),
                _ => (404, vec![], b"{\"message\":\"Not Found\"}".to_vec()),
            }
            });
        (server, stored)
    }

    #[test]
    fn gist_creates_secret_gist_then_patches() {
        let (server, stored) = gist_server(false);
        let client = client().unwrap();
        runtime().block_on(async {
            let fresh = Gist {
                api: &server.base,
                token: "ghp_test",
                gist_id: None,
            };
            assert!(fresh.test(&client).await.is_ok());
            assert_eq!(fresh.fetch(&client).await.unwrap(), RemoteFile::default());
            let created = fresh.store(&client, "{\"v\":1}").await.unwrap();
            assert_eq!(created.gist_id.as_deref(), Some("abc123"));
            let linked = Gist {
                gist_id: Some("abc123"),
                ..fresh
            };
            let patched = linked.store(&client, "{\"v\":2}").await.unwrap();
            assert_eq!(patched.version.as_deref(), Some("h2"));
            let fetched = linked.fetch(&client).await.unwrap();
            assert_eq!(fetched.content.as_deref(), Some("{\"v\":2}"));
            assert_eq!(fetched.gist_id.as_deref(), Some("abc123"));
            let missing = Gist {
                gist_id: Some("doesnotexist"),
                ..linked
            };
            assert!(missing.fetch(&client).await.unwrap_err().contains("404"));
            let bad = Gist {
                token: "wrong",
                ..linked
            };
            assert!(bad.fetch(&client).await.unwrap_err().contains("401"));
        });
        assert_eq!(stored.lock().unwrap().as_deref(), Some("{\"v\":2}"));
        let routes: Vec<String> = server
            .requests()
            .iter()
            .map(|r| format!("{} {}", r.method, r.route()))
            .collect();
        assert_eq!(
            routes[..4],
            [
                "GET /user",
                "POST /gists",
                "PATCH /gists/abc123",
                "GET /gists/abc123"
            ]
        );
    }

    #[test]
    fn gist_rate_limit_is_explained() {
        let (server, _) = gist_server(true);
        let client = client().unwrap();
        let gist = Gist {
            api: &server.base,
            token: "ghp_test",
            gist_id: Some("abc123"),
        };
        let error = runtime().block_on(gist.fetch(&client)).unwrap_err();
        assert!(error.starts_with("GitHub-Ratenlimit erreicht."), "{error}");
        assert!(error.contains("Wieder möglich ab"));
        assert!(Gist {
            gist_id: Some("../x"),
            ..gist
        }
        .store_id_rejected());
    }

    impl Gist<'_> {
        fn store_id_rejected(&self) -> bool {
            self.gist_id
                .map(Gist::validate_id)
                .is_some_and(|r| r.is_err())
        }
    }
}
