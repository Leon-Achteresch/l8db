use super::{deployment, ConvexDeploymentAccess};
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;
use tokio_util::io::ReaderStream;

const PAGE_SIZE: u32 = 50;
const MAX_UPLOAD_FILES: usize = 50;
const MAX_DELETE_FILES: usize = 200;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConvexStoredFile {
    pub id: String,
    pub creation_time: f64,
    pub size: u64,
    pub content_type: Option<String>,
    pub sha256: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexFilesPage {
    pub files: Vec<ConvexStoredFile>,
    pub cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexUploadedFile {
    pub name: String,
    pub storage_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexUploadFailure {
    pub name: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexUploadResult {
    pub uploaded: Vec<ConvexUploadedFile>,
    pub failed: Vec<ConvexUploadFailure>,
}

fn validate_storage_id(id: &str) -> Result<&str, String> {
    let id = id.trim();
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Ungültige Storage-ID.".into());
    }
    Ok(id)
}

fn validate_cursor(cursor: Option<String>) -> Result<Option<String>, String> {
    match cursor {
        Some(cursor) if cursor.len() > 4096 || cursor.chars().any(char::is_control) => {
            Err("Ungültiger Seiten-Cursor.".into())
        }
        other => Ok(other),
    }
}

fn hex_sha256(raw: &str) -> String {
    base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map(|bytes| bytes.iter().map(|byte| format!("{byte:02x}")).collect())
        .unwrap_or_else(|_| raw.to_string())
}

fn resolve_url(base: &reqwest::Url, raw: &str) -> Result<reqwest::Url, String> {
    let url = base
        .join(raw)
        .map_err(|_| "Ungültige Convex-Storage-URL.".to_string())?;
    let same_origin = url.origin() == base.origin();
    if !same_origin && url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Convex-Storage-URL nicht freigegeben.".into());
    }
    Ok(url)
}

fn parse_file(base: &reqwest::Url, value: &Value) -> Option<ConvexStoredFile> {
    let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
    Some(ConvexStoredFile {
        id: text("_id")?,
        creation_time: value
            .get("_creationTime")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
        size: value
            .get("size")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .max(0.0) as u64,
        content_type: text("contentType").filter(|value| !value.is_empty()),
        sha256: text("sha256").map(|raw| hex_sha256(&raw)),
        url: text("url")
            .and_then(|raw| resolve_url(base, &raw).ok())
            .map(|url| url.to_string()),
    })
}

fn file_name(file: &ConvexStoredFile) -> String {
    let extension = file
        .content_type
        .as_deref()
        .and_then(|mime| mime.split(';').next())
        .and_then(|mime| mime_guess::get_mime_extensions_str(mime.trim()))
        .and_then(|extensions| extensions.first());
    match extension {
        Some(extension) => format!("{}.{extension}", file.id),
        None => file.id.clone(),
    }
}

async fn list_page(
    access: &ConvexDeploymentAccess,
    cursor: Option<String>,
    order: &str,
    min_creation_time: Option<f64>,
    max_creation_time: Option<f64>,
) -> Result<ConvexFilesPage, String> {
    let order = match order {
        "asc" | "desc" => order,
        _ => return Err("Ungültige Sortierung.".into()),
    };
    let mut filters = json!({"order": order});
    if let Some(min) = min_creation_time.filter(|value| value.is_finite()) {
        filters["minCreationTime"] = json!(min);
    }
    if let Some(max) = max_creation_time.filter(|value| value.is_finite()) {
        filters["maxCreationTime"] = json!(max);
    }
    let result = access
        .run_function(
            "query",
            "_system/frontend/fileStorageV2:fileMetadata",
            json!({
                "paginationOpts": {"numItems": PAGE_SIZE, "cursor": validate_cursor(cursor)?},
                "filters": filters,
            }),
        )
        .await?;
    let files = result
        .get("page")
        .and_then(Value::as_array)
        .map(|page| {
            page.iter()
                .filter_map(|item| parse_file(&access.url, item))
                .collect()
        })
        .unwrap_or_default();
    let has_more = !result
        .get("isDone")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    Ok(ConvexFilesPage {
        files,
        cursor: result
            .get("continueCursor")
            .and_then(Value::as_str)
            .filter(|_| has_more)
            .map(str::to_string),
        has_more,
    })
}

async fn get_file(
    access: &ConvexDeploymentAccess,
    storage_id: &str,
) -> Result<Option<ConvexStoredFile>, String> {
    let storage_id = validate_storage_id(storage_id)?;
    let value = access
        .run_function(
            "query",
            "_system/frontend/fileStorageV2:getFile",
            json!({"storageId": storage_id}),
        )
        .await?;
    Ok(parse_file(&access.url, &value))
}

pub(crate) async fn file_response(
    access: &ConvexDeploymentAccess,
    storage_id: &str,
) -> Result<(ConvexStoredFile, reqwest::Response), String> {
    let file = get_file(access, storage_id)
        .await?
        .ok_or_else(|| "Datei nicht gefunden.".to_string())?;
    let response = fetch_file(&file).await?;
    Ok((file, response))
}

async fn fetch_file(file: &ConvexStoredFile) -> Result<reqwest::Response, String> {
    let url = file
        .url
        .as_deref()
        .ok_or_else(|| "Für diese Datei liefert Convex keine URL.".to_string())?;
    let response = crate::baas_file::download_client()
        .get(url)
        .send()
        .await
        .map_err(|_| "Convex Storage ist nicht erreichbar.".to_string())?;
    Ok(response)
}

async fn upload_path(
    access: &ConvexDeploymentAccess,
    path: &std::path::Path,
) -> Result<String, String> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|_| "Datei konnte nicht gelesen werden.".to_string())?;
    if !metadata.is_file() {
        return Err("Keine Datei.".into());
    }
    let raw = access
        .run_function(
            "mutation",
            "_system/frontend/fileStorageV2:generateUploadUrl",
            json!({}),
        )
        .await?;
    let url = resolve_url(
        &access.url,
        raw.as_str()
            .ok_or_else(|| "Convex hat keine Upload-URL geliefert.".to_string())?,
    )?;
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "Datei konnte nicht geöffnet werden.".to_string())?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let response = crate::baas_file::upload_client()
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, mime.as_ref())
        .header(reqwest::header::CONTENT_LENGTH, metadata.len())
        .body(reqwest::Body::wrap_stream(ReaderStream::new(file)))
        .send()
        .await
        .map_err(|_| "Convex Storage ist beim Upload nicht erreichbar.".to_string())?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|_| "Convex hat keine Antwort geliefert.".to_string())?;
    if !status.is_success() {
        return Err(super::convex_error(status.as_u16(), &text));
    }
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| {
            value
                .get("storageId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .ok_or_else(|| "Convex hat keine Storage-ID geliefert.".to_string())
}

pub(crate) async fn upload_paths(
    access: &ConvexDeploymentAccess,
    paths: Vec<PathBuf>,
) -> Result<ConvexUploadResult, String> {
    if paths.len() > MAX_UPLOAD_FILES {
        return Err(format!("Höchstens {MAX_UPLOAD_FILES} Dateien pro Upload."));
    }
    let mut result = ConvexUploadResult {
        uploaded: Vec::new(),
        failed: Vec::new(),
    };
    for path in paths {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        match upload_path(access, &path).await {
            Ok(storage_id) => result
                .uploaded
                .push(ConvexUploadedFile { name, storage_id }),
            Err(error) => result.failed.push(ConvexUploadFailure { name, error }),
        }
    }
    Ok(result)
}

async fn delete_files(
    access: &ConvexDeploymentAccess,
    storage_ids: &[String],
) -> Result<u32, String> {
    if storage_ids.is_empty() {
        return Ok(0);
    }
    if storage_ids.len() > MAX_DELETE_FILES {
        return Err(format!(
            "Höchstens {MAX_DELETE_FILES} Dateien pro Löschvorgang."
        ));
    }
    let ids = storage_ids
        .iter()
        .map(|id| validate_storage_id(id).map(str::to_string))
        .collect::<Result<Vec<_>, _>>()?;
    access
        .run_function(
            "mutation",
            "_system/frontend/fileStorageV2:deleteFiles",
            json!({"storageIds": ids}),
        )
        .await?;
    Ok(ids.len() as u32)
}

async fn pick_files(app: tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_files(move |paths| {
        let _ = sender.send(paths);
    });
    receiver
        .await
        .map_err(|_| "Dateidialog wurde unterbrochen.".to_string())?
        .unwrap_or_default()
        .into_iter()
        .map(|path| {
            path.into_path()
                .map_err(|_| "Dateipfad konnte nicht gelesen werden.".to_string())
        })
        .collect()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn convex_studio_files_list(
    id: String,
    project_id: u64,
    deployment_name: String,
    cursor: Option<String>,
    order: String,
    min_creation_time: Option<f64>,
    max_creation_time: Option<f64>,
) -> Result<ConvexFilesPage, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    list_page(
        &access,
        cursor,
        &order,
        min_creation_time,
        max_creation_time,
    )
    .await
}

#[tauri::command]
pub async fn convex_studio_files_count(
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<u64, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    let value = access
        .run_function(
            "query",
            "_system/frontend/fileStorageV2:numFiles",
            json!({}),
        )
        .await?;
    Ok(value.as_f64().unwrap_or(0.0).max(0.0) as u64)
}

#[tauri::command]
pub async fn convex_studio_files_get(
    id: String,
    project_id: u64,
    deployment_name: String,
    storage_id: String,
) -> Result<Option<ConvexStoredFile>, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    get_file(&access, &storage_id).await
}

#[tauri::command]
pub async fn convex_studio_files_preview(
    id: String,
    project_id: u64,
    deployment_name: String,
    storage_id: String,
) -> Result<crate::baas_file::BaasFilePreview, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    let (_, response) = file_response(&access, &storage_id).await?;
    crate::baas_file::preview_response(response).await
}

#[tauri::command]
pub async fn convex_studio_files_download(
    app: tauri::AppHandle,
    id: String,
    project_id: u64,
    deployment_name: String,
    storage_id: String,
) -> Result<bool, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    let file = get_file(&access, &storage_id)
        .await?
        .ok_or_else(|| "Datei nicht gefunden.".to_string())?;
    let Some(path) = crate::baas_file::pick_save_path(app, &file_name(&file)).await? else {
        return Ok(false);
    };
    crate::baas_file::save_response(fetch_file(&file).await?, path).await?;
    Ok(true)
}

#[tauri::command]
pub async fn convex_studio_files_upload(
    app: tauri::AppHandle,
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<ConvexUploadResult, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    let paths = pick_files(app).await?;
    upload_paths(&access, paths).await
}

#[tauri::command]
pub async fn convex_studio_files_delete(
    id: String,
    project_id: u64,
    deployment_name: String,
    storage_ids: Vec<String>,
) -> Result<u32, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    delete_files(&access, &storage_ids).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> reqwest::Url {
        reqwest::Url::parse("http://127.0.0.1:3210/").unwrap()
    }

    #[test]
    fn storage_ids_are_validated() {
        assert_eq!(validate_storage_id(" kg2abc ").unwrap(), "kg2abc");
        assert!(validate_storage_id("f71b7557-bfc1-4bcb-9e61-c39192e6b4e9").is_ok());
        assert!(validate_storage_id("").is_err());
        assert!(validate_storage_id("../x").is_err());
        assert!(validate_storage_id(&"a".repeat(129)).is_err());
    }

    #[test]
    fn storage_urls_resolve_relative_and_reject_foreign_http() {
        assert_eq!(
            resolve_url(&base(), "/api/storage/abc").unwrap().as_str(),
            "http://127.0.0.1:3210/api/storage/abc"
        );
        assert!(resolve_url(&base(), "https://x.convex.cloud/api/storage/abc").is_ok());
        assert!(resolve_url(&base(), "http://evil.example/api").is_err());
        assert!(resolve_url(&base(), "https://user:pw@x.convex.cloud/").is_err());
    }

    #[test]
    fn file_metadata_is_parsed_with_hex_hash_and_absolute_url() {
        let file = parse_file(
            &base(),
            &json!({
                "_id": "kg2a",
                "_creationTime": 1792674390170.412,
                "contentType": "application/json",
                "sha256": "jQAsmDRY2T9fgeC99mwXT0X25uXojG8l1dUKAPBN6p4=",
                "size": 31.0,
                "url": "/api/storage/f71b"
            }),
        )
        .unwrap();
        assert_eq!(file.size, 31);
        assert_eq!(
            file.sha256.as_deref(),
            Some("8d002c983458d93f5f81e0bdf66c174f45f6e6e5e88c6f25d5d50a00f04dea9e")
        );
        assert_eq!(
            file.url.as_deref(),
            Some("http://127.0.0.1:3210/api/storage/f71b")
        );
        assert_eq!(file_name(&file), "kg2a.json");
        assert!(parse_file(&base(), &json!(null)).is_none());
    }

    #[test]
    fn cursors_are_bounded() {
        assert!(validate_cursor(Some("a".repeat(4097))).is_err());
        assert!(validate_cursor(Some("abc\n".into())).is_err());
        assert_eq!(validate_cursor(None).unwrap(), None);
    }

    #[tokio::test]
    #[ignore]
    async fn live_convex_files_round_trip() {
        let (Some(url), Some(key)) = (
            crate::baas_self_hosted_live_tests::env("L8DB_E2E_CONVEX_URL"),
            crate::baas_self_hosted_live_tests::env("L8DB_E2E_CONVEX_KEY"),
        ) else {
            return;
        };
        let _secrets = crate::baas_self_hosted_live_tests::isolate_secrets();
        let profile = crate::convex::convex_connect_self_hosted(url, key)
            .await
            .unwrap();
        let access = deployment(&profile.id, 0, "").await.unwrap();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("l8db-live.txt");
        std::fs::write(&path, b"l8db convex files live test").unwrap();
        let uploaded = upload_paths(&access, vec![path.clone()]).await.unwrap();
        assert!(uploaded.failed.is_empty(), "{:?}", uploaded.failed);
        let storage_id = uploaded.uploaded[0].storage_id.clone();
        let file = get_file(&access, &storage_id).await.unwrap().unwrap();
        assert_eq!(file.size, 27);
        assert_eq!(file.content_type.as_deref(), Some("text/plain"));
        let page = list_page(&access, None, "desc", None, None).await.unwrap();
        assert!(page.files.len() <= PAGE_SIZE as usize);
        assert!(page.files.iter().any(|item| item.id == storage_id));
        let (_, response) = file_response(&access, &storage_id).await.unwrap();
        let preview = crate::baas_file::preview_response(response).await.unwrap();
        assert_eq!(preview.size, 27);
        let target = directory.path().join("download.txt");
        let (_, response) = file_response(&access, &storage_id).await.unwrap();
        crate::baas_file::save_response(response, target.clone())
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"l8db convex files live test"
        );
        crate::baas_self_hosted_live_tests::latency("convex files list", 500, || async {
            list_page(&access, None, "asc", None, None).await.unwrap();
        })
        .await;
        crate::baas_self_hosted_live_tests::latency("convex files get", 500, || async {
            get_file(&access, &storage_id).await.unwrap().unwrap();
        })
        .await;
        crate::baas_self_hosted_live_tests::latency("convex files preview", 500, || async {
            let (_, response) = file_response(&access, &storage_id).await.unwrap();
            crate::baas_file::preview_response(response).await.unwrap();
        })
        .await;
        assert_eq!(
            delete_files(&access, std::slice::from_ref(&storage_id))
                .await
                .unwrap(),
            1
        );
        assert!(get_file(&access, &storage_id).await.unwrap().is_none());
    }
}
