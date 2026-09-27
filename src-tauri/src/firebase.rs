use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;
use tokio_util::io::ReaderStream;

const PROFILES_ACCOUNT: &str = "baas:firebase:profiles";
const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("Firebase HTTP client")
    })
}

fn validate_project_id(id: &str) -> Result<&str, String> {
    if id.len() < 6
        || id.len() > 30
        || !id
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase())
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("Ungültige Firebase-Projekt-ID.".into());
    }
    Ok(id)
}

fn validate_bucket(name: &str) -> Result<&str, String> {
    if name.len() < 3
        || name.len() > 222
        || !name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b".-_".contains(&byte)
        })
    {
        return Err("Ungültiger Firebase-Bucket-Name.".into());
    }
    Ok(name)
}

fn validate_object_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.len() > 1024 || name.contains('\0') {
        return Err("Ungültiger Firebase-Dateipfad.".into());
    }
    Ok(name)
}

fn validate_page_token(token: &str) -> Result<&str, String> {
    if token.len() > 4096 || token.chars().any(char::is_control) {
        return Err("Ungültiger Firebase-Seitentoken.".into());
    }
    Ok(token)
}

fn credential_account(project_id: &str) -> String {
    format!("baas:firebase:{project_id}:service-account")
}

#[derive(Deserialize)]
struct ServiceAccount {
    #[serde(rename = "type")]
    kind: String,
    project_id: String,
    client_email: String,
    private_key: String,
    token_uri: String,
}

fn parse_service_account(raw: &str) -> Result<ServiceAccount, String> {
    let account: ServiceAccount = serde_json::from_str(raw)
        .map_err(|_| "Die ausgewählte Datei ist kein Service-Account-JSON.".to_string())?;
    if account.kind != "service_account"
        || account.client_email.is_empty()
        || account.private_key.is_empty()
        || account.token_uri != GOOGLE_TOKEN_URI
    {
        return Err("Ungültige Firebase-Service-Account-Datei.".into());
    }
    validate_project_id(&account.project_id)?;
    Ok(account)
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
}

async fn service_token(raw: &str) -> Result<String, String> {
    let account = parse_service_account(raw)?;
    let cache_key =
        crate::db::warehouse_auth::digest_key(&format!("firebase:{GOOGLE_SCOPE}:{raw}"));
    if let Some(token) = crate::db::warehouse_auth::cached(&cache_key) {
        return Ok(token);
    }
    let key = crate::db::warehouse_auth::load_rsa_key(&account.private_key, None)?;
    let now = crate::db::warehouse_auth::now_secs();
    let assertion = crate::db::warehouse_auth::sign_rs256(
        &key,
        &serde_json::json!({
            "iss": account.client_email,
            "scope": GOOGLE_SCOPE,
            "aud": GOOGLE_TOKEN_URI,
            "iat": now,
            "exp": now + 3600,
        }),
    )?;
    let form = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs([
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", assertion.as_str()),
        ])
        .finish();
    let response = client()
        .post(GOOGLE_TOKEN_URI)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(form)
        .send()
        .await
        .map_err(|_| "Google OAuth ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Google-Anmeldung fehlgeschlagen (HTTP {}).",
            response.status().as_u16()
        ));
    }
    let data: TokenResponse = response
        .json()
        .await
        .map_err(|_| "Google hat einen ungültigen Zugangstoken geliefert.".to_string())?;
    if data.access_token.is_empty() {
        return Err("Google hat einen leeren Zugangstoken geliefert.".into());
    }
    crate::db::warehouse_auth::remember(
        &cache_key,
        &data.access_token,
        data.expires_in.unwrap_or(3600),
    );
    Ok(data.access_token)
}

async fn response_json<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, String> {
    let status = response.status();
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 => "Anmeldung ungültig.",
            403 => "Für diese Ressource fehlen IAM-Berechtigungen.",
            404 => "Ressource nicht gefunden.",
            429 => "Google-Limit erreicht. Bitte später erneut versuchen.",
            _ => "Anfrage fehlgeschlagen.",
        };
        return Err(format!("Firebase HTTP {}: {hint}", status.as_u16()));
    }
    response
        .json::<T>()
        .await
        .map_err(|_| "Firebase hat unerwartete Daten geliefert.".into())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirebaseProfile {
    pub project_id: String,
    pub project_number: Option<String>,
    pub display_name: Option<String>,
    pub state: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirebaseBucket {
    pub name: String,
    pub location: Option<String>,
    pub storage_class: Option<String>,
    pub time_created: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirebaseBucketPage {
    #[serde(default)]
    pub items: Vec<FirebaseBucket>,
    pub next_page_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirebaseObject {
    pub name: String,
    pub size: Option<String>,
    pub content_type: Option<String>,
    pub time_created: Option<String>,
    pub updated: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirebaseObjectPage {
    #[serde(default)]
    pub items: Vec<FirebaseObject>,
    #[serde(default)]
    pub prefixes: Vec<String>,
    pub next_page_token: Option<String>,
}

async fn profiles() -> Result<Vec<FirebaseProfile>, String> {
    let raw = crate::db::secrets::load_secret(PROFILES_ACCOUNT.to_string()).await?;
    match raw {
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|_| "Gespeicherte Firebase-Projekte sind ungültig.".into()),
        None => Ok(Vec::new()),
    }
}

async fn save_profiles(items: &[FirebaseProfile]) -> Result<(), String> {
    crate::db::secrets::store_secret(
        PROFILES_ACCOUNT.to_string(),
        serde_json::to_string(items)
            .map_err(|_| "Firebase-Projekte konnten nicht gespeichert werden.")?,
    )
    .await
}

async fn access_token(project_id: &str) -> Result<String, String> {
    let project_id = validate_project_id(project_id)?;
    if !profiles()
        .await?
        .iter()
        .any(|item| item.project_id == project_id)
    {
        return Err("Firebase-Projekt ist nicht verbunden.".into());
    }
    let raw = crate::db::secrets::load_secret(credential_account(project_id))
        .await?
        .ok_or_else(|| "Firebase-Service-Account fehlt im Schlüsselbund.".to_string())?;
    service_token(&raw).await
}

fn storage_url(bucket: &str, object: Option<&str>) -> Result<reqwest::Url, String> {
    let bucket = validate_bucket(bucket)?;
    let mut url = reqwest::Url::parse("https://storage.googleapis.com/storage/v1/b")
        .map_err(|_| "Ungültige Firebase-Storage-URL.".to_string())?;
    let mut path = url
        .path_segments_mut()
        .map_err(|_| "Ungültige Firebase-Storage-URL.".to_string())?;
    path.push(bucket).push("o");
    if let Some(object) = object {
        path.push(validate_object_name(object)?);
    }
    drop(path);
    Ok(url)
}

fn upload_url(bucket: &str, object_name: &str) -> Result<reqwest::Url, String> {
    let bucket = validate_bucket(bucket)?;
    let object_name = validate_object_name(object_name)?;
    let mut url = reqwest::Url::parse("https://storage.googleapis.com/upload/storage/v1/b")
        .map_err(|_| "Ungültige Firebase-Upload-URL.".to_string())?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Firebase-Upload-URL.".to_string())?
        .push(bucket)
        .push("o");
    url.query_pairs_mut()
        .append_pair("uploadType", "media")
        .append_pair("name", object_name)
        .append_pair("ifGenerationMatch", "0");
    Ok(url)
}

async fn upload_file(
    path: &std::path::Path,
    url: reqwest::Url,
    token: &str,
    http_client: &reqwest::Client,
) -> Result<FirebaseObject, String> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|_| "Datei konnte nicht gelesen werden.".to_string())?;
    if !metadata.is_file() {
        return Err("Bitte eine Datei auswählen.".into());
    }
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "Datei konnte nicht geöffnet werden.".to_string())?;
    let mime_type = mime_guess::from_path(path).first_or_octet_stream();
    let response = http_client
        .post(url)
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, mime_type.as_ref())
        .header(reqwest::header::CONTENT_LENGTH, metadata.len())
        .body(reqwest::Body::wrap_stream(ReaderStream::new(file)))
        .send()
        .await
        .map_err(|_| "Firebase Storage ist beim Upload nicht erreichbar.".to_string())?;
    if response.status().as_u16() == 412 {
        return Err("Datei existiert bereits. Sie wurde nicht überschrieben.".into());
    }
    response_json(response).await
}

#[tauri::command]
pub async fn firebase_connect(app: tauri::AppHandle) -> Result<Option<FirebaseProfile>, String> {
    let Some(path) = crate::baas_file::pick_open_path(app).await? else {
        return Ok(None);
    };
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|_| "Service-Account-Datei konnte nicht gelesen werden.".to_string())?;
    if bytes.len() > 64 * 1024 {
        return Err("Service-Account-Datei ist zu groß.".into());
    }
    let raw = std::str::from_utf8(&bytes)
        .map_err(|_| "Service-Account-Datei ist kein UTF-8-JSON.".to_string())?;
    let account = parse_service_account(raw)?;
    let token = service_token(raw).await?;
    let remote: FirebaseProfile = response_json(
        client()
            .get(format!(
                "https://firebase.googleapis.com/v1beta1/projects/{}",
                account.project_id
            ))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| "Firebase-Projekt ist nicht erreichbar.".to_string())?,
    )
    .await?;
    if remote.project_id != account.project_id {
        return Err("Firebase hat eine andere Projekt-ID zurückgegeben.".into());
    }
    let mut saved = profiles().await?;
    let key_account = credential_account(&remote.project_id);
    let old_key = crate::db::secrets::load_secret(key_account.clone()).await?;
    crate::db::secrets::store_secret(key_account.clone(), raw.to_string()).await?;
    saved.retain(|item| item.project_id != remote.project_id);
    saved.push(remote.clone());
    if let Err(error) = save_profiles(&saved).await {
        match old_key {
            Some(old_key) => {
                let _ = crate::db::secrets::store_secret(key_account, old_key).await;
            }
            None => {
                let _ = crate::db::secrets::delete_secret(key_account).await;
            }
        }
        return Err(error);
    }
    Ok(Some(remote))
}

#[tauri::command]
pub async fn firebase_profiles() -> Result<Vec<FirebaseProfile>, String> {
    profiles().await
}

#[tauri::command]
pub async fn firebase_disconnect(project_id: String) -> Result<(), String> {
    let project_id = validate_project_id(&project_id)?;
    let mut saved = profiles().await?;
    if !saved.iter().any(|item| item.project_id == project_id) {
        return Err("Firebase-Projekt ist nicht verbunden.".into());
    }
    let key_account = credential_account(project_id);
    let old_key = crate::db::secrets::load_secret(key_account.clone()).await?;
    crate::db::secrets::delete_secret(key_account.clone()).await?;
    saved.retain(|item| item.project_id != project_id);
    if let Err(error) = save_profiles(&saved).await {
        if let Some(old_key) = old_key {
            let _ = crate::db::secrets::store_secret(key_account, old_key).await;
        }
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn firebase_buckets(
    project_id: String,
    page_token: Option<String>,
) -> Result<FirebaseBucketPage, String> {
    let project_id = validate_project_id(&project_id)?;
    let token = access_token(project_id).await?;
    let mut request = client()
        .get("https://storage.googleapis.com/storage/v1/b")
        .bearer_auth(token)
        .query(&[("project", project_id), ("maxResults", "100")]);
    if let Some(page_token) = page_token.filter(|value| !value.is_empty()) {
        request = request.query(&[("pageToken", validate_page_token(&page_token)?)]);
    }
    response_json(
        request
            .send()
            .await
            .map_err(|_| "Firebase Storage ist nicht erreichbar.".to_string())?,
    )
    .await
}

#[tauri::command]
pub async fn firebase_objects(
    project_id: String,
    bucket: String,
    prefix: String,
    page_token: Option<String>,
) -> Result<FirebaseObjectPage, String> {
    let project_id = validate_project_id(&project_id)?;
    if prefix.len() > 1024
        || prefix.contains('\0')
        || (!prefix.is_empty() && !prefix.ends_with('/'))
    {
        return Err("Ungültiger Firebase-Storage-Ordner.".into());
    }
    let token = access_token(project_id).await?;
    let mut request = client()
        .get(storage_url(&bucket, None)?)
        .bearer_auth(token)
        .query(&[
            ("prefix", prefix.as_str()),
            ("delimiter", "/"),
            ("maxResults", "100"),
        ]);
    if let Some(page_token) = page_token.filter(|value| !value.is_empty()) {
        request = request.query(&[("pageToken", validate_page_token(&page_token)?)]);
    }
    response_json(
        request
            .send()
            .await
            .map_err(|_| "Firebase Storage ist nicht erreichbar.".to_string())?,
    )
    .await
}

#[tauri::command]
pub async fn firebase_upload_object(
    app: tauri::AppHandle,
    project_id: String,
    bucket: String,
    prefix: String,
) -> Result<Option<String>, String> {
    validate_project_id(&project_id)?;
    validate_bucket(&bucket)?;
    if prefix.len() > 1024
        || prefix.contains('\0')
        || (!prefix.is_empty() && !prefix.ends_with('/'))
    {
        return Err("Ungültiger Firebase-Storage-Ordner.".into());
    }
    let Some(path) = crate::baas_file::pick_open_path(app).await? else {
        return Ok(None);
    };
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Dateiname konnte nicht gelesen werden.".to_string())?;
    let object_name = validate_object_name(&format!("{prefix}{name}"))?.to_string();
    let token = access_token(&project_id).await?;
    let object = upload_file(
        &path,
        upload_url(&bucket, &object_name)?,
        &token,
        crate::baas_file::upload_client(),
    )
    .await?;
    if object.name != object_name {
        return Err("Firebase hat einen anderen Dateinamen zurückgegeben.".into());
    }
    Ok(Some(object_name))
}

async fn object_response(
    project_id: &str,
    bucket: &str,
    object_name: &str,
    http_client: &reqwest::Client,
) -> Result<reqwest::Response, String> {
    let token = access_token(project_id).await?;
    http_client
        .get(storage_url(bucket, Some(object_name))?)
        .query(&[("alt", "media")])
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Firebase-Datei ist nicht erreichbar.".to_string())
}

#[tauri::command]
pub async fn firebase_preview_object(
    project_id: String,
    bucket: String,
    object_name: String,
) -> Result<crate::baas_file::BaasFilePreview, String> {
    crate::baas_file::preview_response(
        object_response(&project_id, &bucket, &object_name, client()).await?,
    )
    .await
}

#[tauri::command]
pub async fn firebase_download_object(
    app: tauri::AppHandle,
    project_id: String,
    bucket: String,
    object_name: String,
) -> Result<bool, String> {
    let Some(path) = crate::baas_file::pick_save_path(app, &object_name).await? else {
        return Ok(false);
    };
    let response = object_response(
        &project_id,
        &bucket,
        &object_name,
        crate::baas_file::download_client(),
    )
    .await?;
    crate::baas_file::save_response(response, path).await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_service_account, storage_url, upload_file, upload_url, validate_project_id,
        FirebaseBucketPage, FirebaseObjectPage,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn upload_streams_file_and_requires_absent_generation() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for status in ["200 OK", "412 Precondition Failed"] {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0_u8; 4096];
                loop {
                    let read = stream.read(&mut buffer).await.unwrap();
                    assert!(read > 0);
                    request.extend_from_slice(&buffer[..read]);
                    if let Some(headers_end) =
                        request.windows(4).position(|part| part == b"\r\n\r\n")
                    {
                        if request.len() >= headers_end + 4 + 5 {
                            break;
                        }
                    }
                }
                let headers_end = request
                    .windows(4)
                    .position(|part| part == b"\r\n\r\n")
                    .unwrap();
                let headers = String::from_utf8_lossy(&request[..headers_end]).to_ascii_lowercase();
                assert!(headers.starts_with("post /upload/storage/v1/b/example/o?uploadtype=media&name=folder%2fhello.txt&ifgenerationmatch=0 "));
                assert!(headers.contains("authorization: bearer test-token"));
                assert!(headers.contains("content-type: text/plain"));
                assert!(headers.contains("content-length: 5"));
                assert_eq!(&request[headers_end + 4..], b"hello");
                let body = r#"{"name":"folder/hello.txt"}"#;
                stream
                    .write_all(format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes())
                    .await
                    .unwrap();
            }
        });
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hello.txt");
        std::fs::write(&path, b"hello").unwrap();
        let url = reqwest::Url::parse(&format!("http://{address}/upload/storage/v1/b/example/o?uploadType=media&name=folder%2Fhello.txt&ifGenerationMatch=0")).unwrap();
        let first = upload_file(&path, url.clone(), "test-token", super::client())
            .await
            .unwrap();
        assert_eq!(first.name, "folder/hello.txt");
        let second = upload_file(&path, url, "test-token", super::client())
            .await
            .unwrap_err();
        assert!(second.contains("nicht überschrieben"));
        server.await.unwrap();
    }

    #[test]
    fn service_account_restricts_token_exchange_to_google() {
        let valid = r#"{"type":"service_account","project_id":"example-project","client_email":"service@example.iam.gserviceaccount.com","private_key":"key","token_uri":"https://oauth2.googleapis.com/token"}"#;
        assert_eq!(
            parse_service_account(valid).unwrap().project_id,
            "example-project"
        );
        assert!(parse_service_account(&valid.replace(
            "https://oauth2.googleapis.com/token",
            "https://example.com/token"
        ))
        .is_err());
        assert!(validate_project_id("../project").is_err());
    }

    #[test]
    fn storage_paths_encode_object_names_and_pages_decode() {
        let url = storage_url(
            "example-project.firebasestorage.app",
            Some("folder/é #.png"),
        )
        .unwrap();
        assert_eq!(url.host_str(), Some("storage.googleapis.com"));
        assert!(url.as_str().contains("folder%2F%C3%A9%20%23.png"));
        let buckets: FirebaseBucketPage = serde_json::from_str(r#"{"items":[{"name":"example-project.firebasestorage.app","location":"EU","storageClass":"STANDARD"}],"nextPageToken":"next"}"#).unwrap();
        assert_eq!(buckets.items[0].location.as_deref(), Some("EU"));
        let objects: FirebaseObjectPage = serde_json::from_str(r#"{"items":[{"name":"folder/a.txt","size":"42","contentType":"text/plain"}],"prefixes":["folder/sub/"],"nextPageToken":"next"}"#).unwrap();
        assert_eq!(objects.items[0].name, "folder/a.txt");
        assert_eq!(objects.prefixes, ["folder/sub/"]);
        let upload = upload_url("example-project.firebasestorage.app", "folder/new.txt").unwrap();
        assert_eq!(upload.host_str(), Some("storage.googleapis.com"));
        let query: std::collections::HashMap<_, _> = upload.query_pairs().collect();
        assert_eq!(
            query.get("uploadType").map(|value| value.as_ref()),
            Some("media")
        );
        assert_eq!(
            query.get("name").map(|value| value.as_ref()),
            Some("folder/new.txt")
        );
        assert_eq!(
            query.get("ifGenerationMatch").map(|value| value.as_ref()),
            Some("0")
        );
    }
}
