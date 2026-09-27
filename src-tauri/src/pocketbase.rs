use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::sync::OnceLock;
use std::time::Duration;
use url::Url;

const PROFILES_ACCOUNT: &str = "baas:pocketbase:profiles";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PocketBaseProfile {
    pub id: String,
    pub endpoint: String,
    pub name: String,
}

#[derive(Deserialize)]
struct PocketBaseSettings {
    meta: PocketBaseMeta,
}

#[derive(Deserialize)]
struct PocketBaseMeta {
    #[serde(rename = "appName")]
    app_name: String,
}

#[derive(Deserialize)]
struct PocketBaseFileToken {
    token: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PocketBaseField {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PocketBaseCollection {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub system: bool,
    pub fields: Vec<PocketBaseField>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PocketBaseRecord {
    pub id: String,
    pub created: Option<String>,
    pub updated: Option<String>,
    #[serde(flatten)]
    pub data: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PocketBasePage<T> {
    pub page: u32,
    #[serde(rename = "perPage")]
    pub per_page: u32,
    #[serde(rename = "totalItems")]
    pub total_items: u64,
    #[serde(rename = "totalPages")]
    pub total_pages: u32,
    pub items: Vec<T>,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("PocketBase HTTP client")
    })
}

fn validate_endpoint(raw: &str) -> Result<String, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "Ungültiger PocketBase-Endpunkt.")?;
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
    {
        return Err("PocketBase-Endpunkt muss HTTPS verwenden (HTTP nur für localhost).".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn validate_id(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 128
        || value == "."
        || value == ".."
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("Ungültige PocketBase-ID.".into());
    }
    Ok(value)
}

fn profile_id(endpoint: &str) -> String {
    let digest = Sha256::digest(endpoint.as_bytes());
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn token_account(id: &str) -> String {
    format!("baas:pocketbase:{id}:token")
}

fn remove_hidden_fields(
    collection: &PocketBaseCollection,
    records: &mut PocketBasePage<PocketBaseRecord>,
) {
    let visible = collection
        .fields
        .iter()
        .filter(|field| !field.hidden)
        .map(|field| field.name.as_str())
        .collect::<HashSet<_>>();
    for record in &mut records.items {
        record
            .data
            .retain(|name, _| visible.contains(name.as_str()));
    }
}

fn file_is_visible(
    collection: &PocketBaseCollection,
    record: &PocketBaseRecord,
    filename: &str,
) -> bool {
    collection
        .fields
        .iter()
        .filter(|field| field.kind == "file" && !field.hidden)
        .any(|field| match record.data.get(&field.name) {
            Some(serde_json::Value::String(value)) => value == filename,
            Some(serde_json::Value::Array(values)) => {
                values.iter().any(|value| value.as_str() == Some(filename))
            }
            _ => false,
        })
}

async fn profiles() -> Result<Vec<PocketBaseProfile>, String> {
    let raw = crate::db::secrets::load_secret(PROFILES_ACCOUNT.to_string()).await?;
    raw.map(|value| {
        serde_json::from_str(&value).map_err(|_| "Ungültiger PocketBase-Projektindex.".into())
    })
    .unwrap_or_else(|| Ok(Vec::new()))
}

async fn save_profiles(items: &[PocketBaseProfile]) -> Result<(), String> {
    crate::db::secrets::store_secret(
        PROFILES_ACCOUNT.to_string(),
        serde_json::to_string(items)
            .map_err(|_| "PocketBase-Projekte konnten nicht gespeichert werden.")?,
    )
    .await
}

async fn profile_and_token(id: &str) -> Result<(PocketBaseProfile, String), String> {
    let id = validate_id(id)?;
    let profile = profiles()
        .await?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| "PocketBase-Projekt nicht gefunden.".to_string())?;
    let token = crate::db::secrets::load_secret(token_account(id))
        .await?
        .ok_or_else(|| "PocketBase-Token nicht gefunden.".to_string())?;
    Ok((profile, token))
}

async fn get<T: serde::de::DeserializeOwned>(
    endpoint: &str,
    token: &str,
    path: &str,
    page: Option<u32>,
) -> Result<T, String> {
    let endpoint = validate_endpoint(endpoint)?;
    let mut url = Url::parse(&format!("{endpoint}/api/{path}"))
        .map_err(|_| "Ungültige PocketBase-Anfrage.")?;
    if let Some(page) = page {
        if page == 0 || page > 10_000 {
            return Err("Ungültige Seitennummer.".into());
        }
        url.query_pairs_mut()
            .append_pair("page", &page.to_string())
            .append_pair("perPage", "100");
    }
    let response = client()
        .get(url)
        .header("Authorization", token)
        .send()
        .await
        .map_err(|error| format!("PocketBase ist nicht erreichbar: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 => "Superuser-Token ungültig oder abgelaufen.",
            403 => "Superuser-Berechtigung fehlt.",
            404 => "Ressource nicht gefunden.",
            429 => "PocketBase-Limit erreicht. Bitte später erneut versuchen.",
            _ => "Anfrage fehlgeschlagen.",
        };
        return Err(format!("PocketBase HTTP {}: {hint}", status.as_u16()));
    }
    response
        .json::<T>()
        .await
        .map_err(|_| "PocketBase hat unerwartete Daten geliefert.".into())
}

#[tauri::command]
pub async fn pocketbase_connect(
    endpoint: String,
    token: String,
) -> Result<PocketBaseProfile, String> {
    let endpoint = validate_endpoint(&endpoint)?;
    let token = token.trim();
    if token.is_empty() {
        return Err("PocketBase Superuser-Token fehlt.".into());
    }
    let settings: PocketBaseSettings = get(&endpoint, token, "settings", None).await?;
    let profile = PocketBaseProfile {
        id: profile_id(&endpoint),
        endpoint,
        name: settings.meta.app_name,
    };
    let mut items = profiles().await?;
    crate::db::secrets::store_secret(token_account(&profile.id), token.to_string()).await?;
    items.retain(|item| item.id != profile.id);
    items.push(profile.clone());
    save_profiles(&items).await?;
    Ok(profile)
}

#[tauri::command]
pub async fn pocketbase_profiles() -> Result<Vec<PocketBaseProfile>, String> {
    profiles().await
}

#[tauri::command]
pub async fn pocketbase_disconnect(id: String) -> Result<(), String> {
    let id = validate_id(&id)?;
    let mut items = profiles().await?;
    if !items.iter().any(|item| item.id == id) {
        return Err("PocketBase-Projekt nicht gefunden.".into());
    }
    crate::db::secrets::delete_secret(token_account(id)).await?;
    items.retain(|item| item.id != id);
    save_profiles(&items).await
}

#[tauri::command]
pub async fn pocketbase_collections(
    id: String,
    page: u32,
) -> Result<PocketBasePage<PocketBaseCollection>, String> {
    let (profile, token) = profile_and_token(&id).await?;
    collections_for(&profile.endpoint, &token, page).await
}

async fn collections_for(
    endpoint: &str,
    token: &str,
    page: u32,
) -> Result<PocketBasePage<PocketBaseCollection>, String> {
    let mut response: PocketBasePage<PocketBaseCollection> = get(
        endpoint,
        token,
        "collections?filter=system%3Dfalse",
        Some(page),
    )
    .await?;
    response
        .items
        .retain(|item| !item.system && item.name != "_superusers");
    Ok(response)
}

#[tauri::command]
pub async fn pocketbase_records(
    id: String,
    collection_id: String,
    page: u32,
) -> Result<PocketBasePage<PocketBaseRecord>, String> {
    validate_id(&collection_id)?;
    let (profile, token) = profile_and_token(&id).await?;
    records_for(&profile.endpoint, &token, &collection_id, page).await
}

async fn records_for(
    endpoint: &str,
    token: &str,
    collection_id: &str,
    page: u32,
) -> Result<PocketBasePage<PocketBaseRecord>, String> {
    let collection_id = validate_id(collection_id)?;
    let collection: PocketBaseCollection = get(
        endpoint,
        token,
        &format!("collections/{collection_id}"),
        None,
    )
    .await?;
    if collection.system || collection.name == "_superusers" {
        return Err("PocketBase-Collection nicht freigegeben.".into());
    }
    let mut records: PocketBasePage<PocketBaseRecord> = get(
        endpoint,
        token,
        &format!("collections/{collection_id}/records"),
        Some(page),
    )
    .await?;
    remove_hidden_fields(&collection, &mut records);
    Ok(records)
}

fn validate_file_request(
    collection_id: &str,
    record_id: &str,
    filename: &str,
) -> Result<(), String> {
    validate_id(collection_id)?;
    validate_id(record_id)?;
    if filename.is_empty()
        || filename.len() > 255
        || filename == "."
        || filename == ".."
        || filename.contains('/')
        || filename.contains('\\')
    {
        return Err("Ungültiger Dateiname.".into());
    }
    Ok(())
}

async fn file_response(
    id: &str,
    collection_id: &str,
    record_id: &str,
    filename: &str,
    http_client: &reqwest::Client,
) -> Result<reqwest::Response, String> {
    validate_file_request(collection_id, record_id, filename)?;
    let (profile, token) = profile_and_token(id).await?;
    file_response_for(
        &profile.endpoint,
        &token,
        collection_id,
        record_id,
        filename,
        http_client,
    )
    .await
}

async fn file_response_for(
    endpoint: &str,
    token: &str,
    collection_id: &str,
    record_id: &str,
    filename: &str,
    http_client: &reqwest::Client,
) -> Result<reqwest::Response, String> {
    let endpoint = validate_endpoint(endpoint)?;
    validate_file_request(collection_id, record_id, filename)?;
    let collection: PocketBaseCollection = get(
        &endpoint,
        token,
        &format!("collections/{collection_id}"),
        None,
    )
    .await?;
    if collection.system || collection.name == "_superusers" {
        return Err("PocketBase-Collection nicht freigegeben.".into());
    }
    let record: PocketBaseRecord = get(
        &endpoint,
        token,
        &format!("collections/{collection_id}/records/{record_id}"),
        None,
    )
    .await?;
    if !file_is_visible(&collection, &record, filename) {
        return Err("Datei ist in diesem Datensatz nicht sichtbar.".into());
    }
    let response = client()
        .post(format!("{endpoint}/api/files/token"))
        .header("Authorization", token)
        .send()
        .await
        .map_err(|_| "PocketBase-Dateizugriff ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "PocketBase HTTP {}: Dateitoken konnte nicht erstellt werden.",
            response.status().as_u16()
        ));
    }
    let file_token: PocketBaseFileToken = response
        .json()
        .await
        .map_err(|_| "PocketBase hat einen ungültigen Dateitoken geliefert.".to_string())?;
    let mut url = Url::parse(&format!("{endpoint}/api/files"))
        .map_err(|_| "Ungültige PocketBase-Datei-URL.".to_string())?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige PocketBase-Datei-URL.".to_string())?
        .push(collection_id)
        .push(record_id)
        .push(filename);
    url.query_pairs_mut()
        .append_pair("token", &file_token.token);
    http_client
        .get(url)
        .send()
        .await
        .map_err(|_| "PocketBase-Datei ist nicht erreichbar.".to_string())
}

#[tauri::command]
pub async fn pocketbase_preview_file(
    id: String,
    collection_id: String,
    record_id: String,
    filename: String,
) -> Result<crate::baas_file::BaasFilePreview, String> {
    crate::baas_file::preview_response(
        file_response(&id, &collection_id, &record_id, &filename, client()).await?,
    )
    .await
}

#[tauri::command]
pub async fn pocketbase_download_file(
    app: tauri::AppHandle,
    id: String,
    collection_id: String,
    record_id: String,
    filename: String,
) -> Result<bool, String> {
    let Some(path) = crate::baas_file::pick_save_path(app, &filename).await? else {
        return Ok(false);
    };
    let response = file_response(
        &id,
        &collection_id,
        &record_id,
        &filename,
        crate::baas_file::download_client(),
    )
    .await?;
    crate::baas_file::save_response(response, path).await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{
        file_is_visible, get, profile_id, remove_hidden_fields, validate_endpoint, validate_id,
    };
    use base64::Engine;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn endpoint_requires_tls_outside_loopback() {
        assert!(validate_endpoint("https://pb.example.com").is_ok());
        assert!(validate_endpoint("http://localhost:8090").is_ok());
        assert!(validate_endpoint("http://[::1]:8090").is_ok());
        assert!(validate_endpoint("http://example.com").is_err());
        assert!(validate_endpoint("https://user@example.com").is_err());
        assert!(validate_endpoint("https://example.com?token=x").is_err());
        assert_ne!(profile_id("https://a"), profile_id("https://b"));
    }

    #[test]
    fn collection_ids_cannot_escape_api_path() {
        assert!(validate_id("_pbc_123").is_ok());
        assert!(validate_id("../settings").is_err());
        assert!(validate_id("..").is_err());
        assert!(validate_id("a/b").is_err());
    }

    #[test]
    fn hidden_record_fields_never_reach_frontend() {
        let collection = serde_json::from_value(serde_json::json!({
            "id": "users",
            "name": "users",
            "type": "auth",
            "system": false,
            "fields": [
                {"name": "email", "type": "email", "hidden": false},
                {"name": "tokenKey", "type": "text", "hidden": true}
            ]
        }))
        .unwrap();
        let mut records = serde_json::from_value(serde_json::json!({
            "page": 1,
            "perPage": 100,
            "totalItems": 1,
            "totalPages": 1,
            "items": [{"id": "u1", "email": "ada@example.com", "tokenKey": "secret", "expand": {"private": "secret"}}]
        }))
        .unwrap();
        remove_hidden_fields(&collection, &mut records);
        assert_eq!(records.items[0].data.len(), 1);
        assert_eq!(records.items[0].data["email"], "ada@example.com");
    }

    #[test]
    fn preview_only_accepts_visible_file_fields() {
        let collection = serde_json::from_value(serde_json::json!({
            "id": "posts", "name": "posts", "type": "base", "system": false,
            "fields": [
                {"name": "image", "type": "file", "hidden": false},
                {"name": "private", "type": "file", "hidden": true}
            ]
        }))
        .unwrap();
        let record = serde_json::from_value(serde_json::json!({
            "id": "p1", "image": "hero.webp", "private": "secret.webp"
        }))
        .unwrap();
        assert!(file_is_visible(&collection, &record, "hero.webp"));
        assert!(!file_is_visible(&collection, &record, "secret.webp"));
    }

    #[tokio::test]
    async fn get_uses_superuser_token_and_page() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0_u8; 4096];
            let read = stream.read(&mut buffer).await.unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(request.starts_with("GET /api/collections?page=2&perPage=100"));
            assert!(request
                .to_ascii_lowercase()
                .contains("authorization: secret"));
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}")
                .await
                .unwrap();
        });
        let response: serde_json::Value = get(
            &format!("http://127.0.0.1:{}", address.port()),
            "secret",
            "collections",
            Some(2),
        )
        .await
        .unwrap();
        assert_eq!(response, serde_json::json!({}));
        server.await.unwrap();
    }

    #[tokio::test]
    #[ignore]
    async fn live_lab_reads_collection_records_and_protected_file() {
        let Ok(endpoint) = std::env::var("L8DB_E2E_POCKETBASE_URL") else {
            return;
        };
        let token = std::env::var("L8DB_E2E_POCKETBASE_TOKEN").unwrap();
        let collection_id = std::env::var("L8DB_E2E_POCKETBASE_COLLECTION_ID").unwrap();
        let record_id = std::env::var("L8DB_E2E_POCKETBASE_RECORD_ID").unwrap();
        let filename = std::env::var("L8DB_E2E_POCKETBASE_FILENAME").unwrap();
        let settings: super::PocketBaseSettings =
            get(&endpoint, &token, "settings", None).await.unwrap();
        assert!(!settings.meta.app_name.is_empty());
        let collections = super::collections_for(&endpoint, &token, 1).await.unwrap();
        let collection = collections
            .items
            .iter()
            .find(|item| item.id == collection_id)
            .unwrap();
        let records = super::records_for(&endpoint, &token, &collection_id, 1)
            .await
            .unwrap();
        let record = records
            .items
            .iter()
            .find(|item| item.id == record_id)
            .unwrap();
        assert!(collection
            .fields
            .iter()
            .all(|field| !field.hidden || !record.data.contains_key(&field.name)));
        assert!(file_is_visible(collection, record, &filename));
        let response = super::file_response_for(
            &endpoint,
            &token,
            &collection_id,
            &record_id,
            &filename,
            super::client(),
        )
        .await
        .unwrap();
        let preview = crate::baas_file::preview_response(response).await.unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(preview.base64)
            .unwrap();
        assert!(!bytes.is_empty());
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("download.txt");
        let response = super::file_response_for(
            &endpoint,
            &token,
            &collection_id,
            &record_id,
            &filename,
            crate::baas_file::download_client(),
        )
        .await
        .unwrap();
        crate::baas_file::save_response(response, path.clone())
            .await
            .unwrap();
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}
