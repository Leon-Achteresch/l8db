use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use url::Url;

const PROFILES_ACCOUNT: &str = "baas:appwrite:profiles";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AppwriteProfile {
    pub id: String,
    pub endpoint: String,
    pub project_id: String,
    pub name: String,
    pub region: Option<String>,
}

#[derive(Deserialize)]
struct RemoteProject {
    #[serde(rename = "$id")]
    id: String,
    name: String,
    region: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AppwritePage<T> {
    pub total: u64,
    pub items: Vec<T>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AppwriteBucket {
    #[serde(rename = "$id")]
    pub id: String,
    pub name: String,
    pub enabled: bool,
    #[serde(rename = "totalSize")]
    pub total_size: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AppwriteFile {
    #[serde(rename = "$id")]
    pub id: String,
    pub name: String,
    #[serde(rename = "sizeOriginal")]
    pub size_original: Option<u64>,
    #[serde(rename = "mimeType")]
    pub mime_type: Option<String>,
    #[serde(rename = "$createdAt")]
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AppwriteNamedResource {
    #[serde(rename = "$id")]
    pub id: String,
    pub name: String,
    pub enabled: Option<bool>,
    #[serde(rename = "$createdAt")]
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AppwriteUser {
    #[serde(rename = "$id")]
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub status: Option<bool>,
    #[serde(rename = "$createdAt")]
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AppwriteRow {
    #[serde(rename = "$id")]
    pub id: String,
    #[serde(flatten)]
    pub fields: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AppwriteColumn {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub array: bool,
    pub status: Option<String>,
}

#[derive(Deserialize)]
struct BucketList {
    total: u64,
    buckets: Vec<AppwriteBucket>,
}

#[derive(Deserialize)]
struct FileList {
    total: u64,
    files: Vec<AppwriteFile>,
}

#[derive(Deserialize)]
struct UploadedFile {
    #[serde(rename = "$id")]
    id: String,
    #[serde(rename = "chunksUploaded")]
    chunks_uploaded: Option<u64>,
    #[serde(rename = "chunksTotal")]
    chunks_total: Option<u64>,
}

#[derive(Deserialize)]
struct DatabaseList {
    total: u64,
    databases: Vec<AppwriteNamedResource>,
}

#[derive(Deserialize)]
struct TableList {
    total: u64,
    tables: Vec<AppwriteNamedResource>,
}

#[derive(Deserialize)]
struct RowList {
    total: u64,
    rows: Vec<AppwriteRow>,
}

#[derive(Deserialize)]
struct ColumnList {
    total: u64,
    columns: Vec<AppwriteColumn>,
}

#[derive(Deserialize)]
struct FunctionList {
    total: u64,
    functions: Vec<AppwriteNamedResource>,
}

#[derive(Deserialize)]
struct UserList {
    total: u64,
    users: Vec<AppwriteUser>,
}

#[derive(Deserialize)]
struct SiteList {
    total: u64,
    sites: Vec<AppwriteNamedResource>,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("Appwrite HTTP client")
    })
}

fn validate_endpoint(raw: &str) -> Result<String, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "Ungültiger Appwrite-Endpunkt.")?;
    let localhost = match url.host() {
        Some(url::Host::Domain("localhost")) => true,
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        _ => false,
    };
    if (url.scheme() != "https" && !(url.scheme() == "http" && localhost))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path().trim_end_matches('/') != "/v1"
    {
        return Err(
            "Appwrite-Endpunkt muss HTTPS und den Pfad /v1 verwenden (HTTP nur für localhost)."
                .into(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn validate_id(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 36
        || !value.as_bytes()[0].is_ascii_alphanumeric()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("Ungültige Appwrite-ID.".into());
    }
    Ok(value)
}

fn key_account(id: &str) -> String {
    format!("baas:appwrite:{id}:api-key")
}

fn profile_id(endpoint: &str, project_id: &str) -> String {
    let digest = Sha256::digest(format!("{endpoint}\n{project_id}").as_bytes());
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

async fn profiles() -> Result<Vec<AppwriteProfile>, String> {
    let raw = crate::db::secrets::load_secret(PROFILES_ACCOUNT.to_string()).await?;
    raw.map(|value| {
        serde_json::from_str(&value).map_err(|_| "Ungültiger Appwrite-Projektindex.".into())
    })
    .unwrap_or_else(|| Ok(Vec::new()))
}

async fn save_profiles(items: &[AppwriteProfile]) -> Result<(), String> {
    crate::db::secrets::store_secret(
        PROFILES_ACCOUNT.to_string(),
        serde_json::to_string(items)
            .map_err(|_| "Appwrite-Projekte konnten nicht gespeichert werden.")?,
    )
    .await
}

async fn profile_and_key(id: &str) -> Result<(AppwriteProfile, String), String> {
    let id = validate_id(id)?;
    let profile = profiles()
        .await?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| "Appwrite-Projekt nicht gefunden.".to_string())?;
    let key = crate::db::secrets::load_secret(key_account(id))
        .await?
        .ok_or_else(|| "Appwrite API-Schlüssel nicht gefunden.".to_string())?;
    Ok((profile, key))
}

async fn get<T: serde::de::DeserializeOwned>(
    endpoint: &str,
    project_id: &str,
    api_key: &str,
    path: &str,
    offset: Option<u32>,
) -> Result<T, String> {
    let base = validate_endpoint(endpoint)?;
    let mut url =
        Url::parse(&format!("{base}/{path}")).map_err(|_| "Ungültige Appwrite-Anfrage.")?;
    if let Some(offset) = offset {
        url.query_pairs_mut()
            .append_pair("queries[]", r#"{"method":"limit","values":[100]}"#)
            .append_pair(
                "queries[]",
                &format!(r#"{{"method":"offset","values":[{offset}]}}"#),
            );
    }
    let response = client()
        .get(url)
        .header("X-Appwrite-Project", project_id)
        .header("X-Appwrite-Key", api_key)
        .header("X-Appwrite-Response-Format", "2.3.0")
        .send()
        .await
        .map_err(|error| format!("Appwrite ist nicht erreichbar: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 => "API-Schlüssel oder Projekt-ID ungültig.",
            403 => "Für diese Ressource fehlt dem API-Schlüssel die Berechtigung.",
            404 => "Ressource oder API-Endpunkt nicht gefunden.",
            429 => "Appwrite-Limit erreicht. Bitte später erneut versuchen.",
            _ => "Anfrage fehlgeschlagen.",
        };
        return Err(format!("Appwrite HTTP {}: {hint}", status.as_u16()));
    }
    response
        .json::<T>()
        .await
        .map_err(|_| "Appwrite hat unerwartete Daten geliefert.".into())
}

async fn project_get<T: serde::de::DeserializeOwned>(
    id: &str,
    path: &str,
    offset: Option<u32>,
) -> Result<T, String> {
    let (profile, key) = profile_and_key(id).await?;
    get(&profile.endpoint, &profile.project_id, &key, path, offset).await
}

#[tauri::command]
pub async fn appwrite_connect(
    endpoint: String,
    project_id: String,
    api_key: String,
) -> Result<AppwriteProfile, String> {
    let endpoint = validate_endpoint(&endpoint)?;
    let project_id = validate_id(project_id.trim())?.to_string();
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("Appwrite API-Schlüssel fehlt.".into());
    }
    let remote: RemoteProject = get(&endpoint, &project_id, api_key, "project", None).await?;
    if remote.id != project_id {
        return Err("Appwrite hat eine andere Projekt-ID zurückgegeben.".into());
    }
    let profile = AppwriteProfile {
        id: profile_id(&endpoint, &project_id),
        endpoint,
        project_id,
        name: remote.name,
        region: remote.region,
    };
    let mut items = profiles().await?;
    crate::db::secrets::store_secret(key_account(&profile.id), api_key.to_string()).await?;
    items.retain(|item| item.id != profile.id);
    items.push(profile.clone());
    save_profiles(&items).await?;
    Ok(profile)
}

#[tauri::command]
pub async fn appwrite_profiles() -> Result<Vec<AppwriteProfile>, String> {
    profiles().await
}

#[tauri::command]
pub async fn appwrite_disconnect(id: String) -> Result<(), String> {
    let id = validate_id(&id)?;
    let mut items = profiles().await?;
    if !items.iter().any(|item| item.id == id) {
        return Err("Appwrite-Projekt nicht gefunden.".into());
    }
    crate::db::secrets::delete_secret(key_account(id)).await?;
    items.retain(|item| item.id != id);
    save_profiles(&items).await
}

#[tauri::command]
pub async fn appwrite_buckets(
    id: String,
    offset: u32,
) -> Result<AppwritePage<AppwriteBucket>, String> {
    let page: BucketList = project_get(&id, "storage/buckets", Some(offset)).await?;
    Ok(AppwritePage {
        total: page.total,
        items: page.buckets,
    })
}

#[tauri::command]
pub async fn appwrite_files(
    id: String,
    bucket_id: String,
    offset: u32,
) -> Result<AppwritePage<AppwriteFile>, String> {
    let bucket_id = validate_id(&bucket_id)?;
    let page: FileList = project_get(
        &id,
        &format!("storage/buckets/{bucket_id}/files"),
        Some(offset),
    )
    .await?;
    Ok(AppwritePage {
        total: page.total,
        items: page.files,
    })
}

async fn upload_path(
    path: &std::path::Path,
    profile: &AppwriteProfile,
    api_key: &str,
    bucket_id: &str,
    http_client: &reqwest::Client,
) -> Result<String, String> {
    const CHUNK_SIZE: u64 = 5 * 1024 * 1024;
    let bucket_id = validate_id(bucket_id)?;
    let endpoint = validate_endpoint(&profile.endpoint)?;
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|_| "Datei konnte nicht gelesen werden.".to_string())?;
    if !metadata.is_file() {
        return Err("Bitte eine Datei auswählen.".into());
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Dateiname konnte nicht gelesen werden.".to_string())?;
    let mime_type = mime_guess::from_path(path).first_or_octet_stream();
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "Datei konnte nicht geöffnet werden.".to_string())?;
    let mut offset = 0;
    let mut file_id: Option<String> = None;
    loop {
        let size = (metadata.len() - offset).min(CHUNK_SIZE) as usize;
        let mut bytes = vec![0_u8; size];
        file.read_exact(&mut bytes)
            .await
            .map_err(|_| "Datei hat sich während des Uploads geändert.".to_string())?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(name.to_string())
            .mime_str(mime_type.as_ref())
            .map_err(|_| "Ungültiger Dateityp.".to_string())?;
        let form = reqwest::multipart::Form::new()
            .text(
                "fileId",
                file_id.as_deref().unwrap_or("unique()").to_string(),
            )
            .part("file", part);
        let mut request = http_client
            .post(format!("{endpoint}/storage/buckets/{bucket_id}/files"))
            .header("X-Appwrite-Project", &profile.project_id)
            .header("X-Appwrite-Key", api_key)
            .header("X-Appwrite-Response-Format", "2.3.0")
            .multipart(form);
        if metadata.len() > 0 {
            request = request.header(
                reqwest::header::CONTENT_RANGE,
                format!(
                    "bytes {offset}-{}/{total}",
                    offset + size as u64 - 1,
                    total = metadata.len()
                ),
            );
        }
        if let Some(id) = &file_id {
            request = request.header("X-Appwrite-ID", id);
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Appwrite Storage ist beim Upload nicht erreichbar.".to_string())?;
        if !response.status().is_success() {
            let hint = match response.status().as_u16() {
                401 => "API-Schlüssel oder Projekt-ID ungültig.",
                403 => "Für den Upload fehlt files.write oder eine Bucket-Berechtigung.",
                413 => "Datei überschreitet das Größenlimit des Buckets.",
                _ => "Upload fehlgeschlagen.",
            };
            return Err(format!(
                "Appwrite HTTP {}: {hint}",
                response.status().as_u16()
            ));
        }
        let uploaded: UploadedFile = response
            .json()
            .await
            .map_err(|_| "Appwrite hat unerwartete Upload-Daten geliefert.".to_string())?;
        let id = validate_id(&uploaded.id)?.to_string();
        if file_id.as_ref().is_some_and(|previous| previous != &id) {
            return Err("Appwrite hat die Datei-ID während des Uploads geändert.".into());
        }
        file_id = Some(id);
        offset += size as u64;
        if offset == metadata.len() {
            if uploaded
                .chunks_uploaded
                .zip(uploaded.chunks_total)
                .is_some_and(|(done, total)| done != total)
            {
                return Err("Appwrite hat den Upload nicht vollständig bestätigt.".into());
            }
            return Ok(file_id.unwrap());
        }
    }
}

#[tauri::command]
pub async fn appwrite_upload_file(
    app: tauri::AppHandle,
    id: String,
    bucket_id: String,
) -> Result<Option<String>, String> {
    validate_id(&bucket_id)?;
    let (profile, api_key) = profile_and_key(&id).await?;
    let Some(path) = crate::baas_file::pick_open_path(app).await? else {
        return Ok(None);
    };
    let file_id = upload_path(
        &path,
        &profile,
        &api_key,
        &bucket_id,
        crate::baas_file::upload_client(),
    )
    .await?;
    Ok(Some(file_id))
}

async fn file_response(
    id: &str,
    bucket_id: &str,
    file_id: &str,
    http_client: &reqwest::Client,
) -> Result<reqwest::Response, String> {
    let bucket_id = validate_id(bucket_id)?;
    let file_id = validate_id(file_id)?;
    let (profile, key) = profile_and_key(id).await?;
    http_client
        .get(format!(
            "{}/storage/buckets/{bucket_id}/files/{file_id}/download",
            profile.endpoint
        ))
        .header("X-Appwrite-Project", &profile.project_id)
        .header("X-Appwrite-Key", &key)
        .header("X-Appwrite-Response-Format", "2.3.0")
        .send()
        .await
        .map_err(|_| "Appwrite Storage ist nicht erreichbar.".to_string())
}

#[tauri::command]
pub async fn appwrite_preview_file(
    id: String,
    bucket_id: String,
    file_id: String,
) -> Result<crate::baas_file::BaasFilePreview, String> {
    crate::baas_file::preview_response(file_response(&id, &bucket_id, &file_id, client()).await?)
        .await
}

#[tauri::command]
pub async fn appwrite_download_file(
    app: tauri::AppHandle,
    id: String,
    bucket_id: String,
    file_id: String,
    name: String,
) -> Result<bool, String> {
    let Some(path) = crate::baas_file::pick_save_path(app, &name).await? else {
        return Ok(false);
    };
    let response = file_response(
        &id,
        &bucket_id,
        &file_id,
        crate::baas_file::download_client(),
    )
    .await?;
    crate::baas_file::save_response(response, path).await?;
    Ok(true)
}

#[tauri::command]
pub async fn appwrite_databases(
    id: String,
    offset: u32,
) -> Result<AppwritePage<AppwriteNamedResource>, String> {
    let page: DatabaseList = project_get(&id, "tablesdb", Some(offset)).await?;
    Ok(AppwritePage {
        total: page.total,
        items: page.databases,
    })
}

#[tauri::command]
pub async fn appwrite_tables(
    id: String,
    database_id: String,
    offset: u32,
) -> Result<AppwritePage<AppwriteNamedResource>, String> {
    let database_id = validate_id(&database_id)?;
    let page: TableList =
        project_get(&id, &format!("tablesdb/{database_id}/tables"), Some(offset)).await?;
    Ok(AppwritePage {
        total: page.total,
        items: page.tables,
    })
}

#[tauri::command]
pub async fn appwrite_rows(
    id: String,
    database_id: String,
    table_id: String,
    offset: u32,
) -> Result<AppwritePage<AppwriteRow>, String> {
    let database_id = validate_id(&database_id)?;
    let table_id = validate_id(&table_id)?;
    let page: RowList = project_get(
        &id,
        &format!("tablesdb/{database_id}/tables/{table_id}/rows"),
        Some(offset),
    )
    .await?;
    Ok(AppwritePage {
        total: page.total,
        items: page.rows,
    })
}

#[tauri::command]
pub async fn appwrite_columns(
    id: String,
    database_id: String,
    table_id: String,
    offset: u32,
) -> Result<AppwritePage<AppwriteColumn>, String> {
    let database_id = validate_id(&database_id)?;
    let table_id = validate_id(&table_id)?;
    let page: ColumnList = project_get(
        &id,
        &format!("tablesdb/{database_id}/tables/{table_id}/columns"),
        Some(offset),
    )
    .await?;
    Ok(AppwritePage {
        total: page.total,
        items: page.columns,
    })
}

#[tauri::command]
pub async fn appwrite_functions(
    id: String,
    offset: u32,
) -> Result<AppwritePage<AppwriteNamedResource>, String> {
    let page: FunctionList = project_get(&id, "functions", Some(offset)).await?;
    Ok(AppwritePage {
        total: page.total,
        items: page.functions,
    })
}

#[tauri::command]
pub async fn appwrite_users(id: String, offset: u32) -> Result<AppwritePage<AppwriteUser>, String> {
    let page: UserList = project_get(&id, "users", Some(offset)).await?;
    Ok(AppwritePage {
        total: page.total,
        items: page.users,
    })
}

#[tauri::command]
pub async fn appwrite_sites(
    id: String,
    offset: u32,
) -> Result<AppwritePage<AppwriteNamedResource>, String> {
    let page: SiteList = project_get(&id, "sites", Some(offset)).await?;
    Ok(AppwritePage {
        total: page.total,
        items: page.sites,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        client, get, profile_id, upload_path, validate_endpoint, validate_id, AppwriteProfile,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn endpoint_rejects_credentials_and_insecure_hosts() {
        assert!(validate_endpoint("https://fra.cloud.appwrite.io/v1").is_ok());
        assert!(validate_endpoint("http://localhost:8080/v1").is_ok());
        assert!(validate_endpoint("http://[::1]:8080/v1").is_ok());
        assert!(validate_endpoint("http://example.com/v1").is_err());
        assert!(validate_endpoint("https://key@example.com/v1").is_err());
        assert!(validate_endpoint("https://example.com/v1?next=evil").is_err());
        assert!(validate_endpoint("https://example.com/other").is_err());
    }

    #[test]
    fn resource_ids_cannot_escape_path() {
        assert!(validate_id("project_123.abc").is_ok());
        assert!(validate_id("../files").is_err());
        assert!(validate_id("a/b").is_err());
        assert_ne!(
            profile_id("https://a/v1", "p"),
            profile_id("https://b/v1", "p")
        );
    }

    #[tokio::test]
    async fn get_sends_scoped_headers_and_json_pagination() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0_u8; 4096];
            let read = stream.read(&mut buffer).await.unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(request.starts_with("GET /v1/storage/buckets?"));
            let query = request.split_whitespace().nth(1).unwrap();
            let url = url::Url::parse(&format!("http://localhost{query}")).unwrap();
            let values = url
                .query_pairs()
                .filter(|(key, _)| key == "queries[]")
                .map(|(_, value)| value.into_owned())
                .collect::<Vec<_>>();
            assert_eq!(values[0], r#"{"method":"limit","values":[100]}"#);
            assert_eq!(values[1], r#"{"method":"offset","values":[100]}"#);
            assert!(request
                .to_ascii_lowercase()
                .contains("x-appwrite-project: project_1"));
            assert!(request
                .to_ascii_lowercase()
                .contains("x-appwrite-key: secret"));
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}")
                .await
                .unwrap();
        });
        let response: serde_json::Value = get(
            &format!("http://127.0.0.1:{}/v1", address.port()),
            "project_1",
            "secret",
            "storage/buckets",
            Some(100),
        )
        .await
        .unwrap();
        assert_eq!(response, serde_json::json!({}));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn upload_sends_two_multipart_chunks_with_scoped_credentials() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for index in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0_u8; 8192];
                let headers_end = loop {
                    let read = stream.read(&mut buffer).await.unwrap();
                    assert!(read > 0);
                    request.extend_from_slice(&buffer[..read]);
                    if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                        break end + 4;
                    }
                };
                let headers = String::from_utf8_lossy(&request[..headers_end]).to_ascii_lowercase();
                assert!(headers.starts_with("post /v1/storage/buckets/bucket_1/files "));
                assert!(headers.contains("x-appwrite-project: project_1"));
                assert!(headers.contains("x-appwrite-key: secret"));
                assert!(headers.contains("content-type: multipart/form-data; boundary="));
                let content_length = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .unwrap()
                    .parse::<usize>()
                    .unwrap();
                while request.len() < headers_end + content_length {
                    let read = stream.read(&mut buffer).await.unwrap();
                    assert!(read > 0);
                    request.extend_from_slice(&buffer[..read]);
                }
                let body = &request[headers_end..headers_end + content_length];
                assert!(body
                    .windows(b"name=\"fileId\"\r\n\r\n".len())
                    .any(|part| part == b"name=\"fileId\"\r\n\r\n"));
                assert!(body
                    .windows(b"filename=\"upload.txt\"\r\n".len())
                    .any(|part| part == b"filename=\"upload.txt\"\r\n"));
                let file_header = body
                    .windows(b"filename=\"upload.txt\"".len())
                    .position(|part| part == b"filename=\"upload.txt\"")
                    .unwrap();
                let data_start = file_header
                    + body[file_header..]
                        .windows(4)
                        .position(|part| part == b"\r\n\r\n")
                        .unwrap()
                    + 4;
                if index == 0 {
                    assert!(headers.contains("content-range: bytes 0-5242879/5242882"));
                    assert!(!headers.contains("x-appwrite-id:"));
                    assert!(body.windows(8).any(|part| part == b"unique()"));
                    assert!(body[data_start..data_start + 5 * 1024 * 1024]
                        .iter()
                        .all(|byte| *byte == b'a'));
                } else {
                    assert!(headers.contains("content-range: bytes 5242880-5242881/5242882"));
                    assert!(headers.contains("x-appwrite-id: uploaded_1"));
                    assert!(body.windows(10).any(|part| part == b"uploaded_1"));
                    assert_eq!(&body[data_start..data_start + 2], b"Za");
                }
                let payload = format!(
                    "{{\"$id\":\"uploaded_1\",\"chunksUploaded\":{},\"chunksTotal\":2}}",
                    index + 1
                );
                let response = format!(
                    "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                    payload.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("upload.txt");
        let mut bytes = vec![b'a'; 5 * 1024 * 1024 + 2];
        bytes[5 * 1024 * 1024] = b'Z';
        std::fs::write(&path, bytes).unwrap();
        let profile = AppwriteProfile {
            id: "profile_1".into(),
            endpoint: format!("http://127.0.0.1:{}/v1", address.port()),
            project_id: "project_1".into(),
            name: "Test".into(),
            region: None,
        };
        let id = upload_path(&path, &profile, "secret", "bucket_1", client())
            .await
            .unwrap();
        assert_eq!(id, "uploaded_1");
        server.await.unwrap();
    }
}
