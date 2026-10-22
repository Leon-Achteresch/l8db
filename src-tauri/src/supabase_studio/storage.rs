use crate::supabase::{
    client, project_api_auth, project_secret_key, project_url, validate_bucket,
    validate_object_key, validate_ref, SupabaseBucket, SupabaseObject,
};
use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;
use tokio_util::io::ReaderStream;

const PAGE_SIZE: usize = 100;
const LIST_BATCH: usize = 1000;
const MAX_DELETE: usize = 10_000;
const MAX_TRANSFER: usize = 1000;
const MAX_SIGN_SECONDS: u32 = 10 * 365 * 24 * 60 * 60;
const FOLDER_PLACEHOLDER: &str = ".emptyFolderPlaceholder";

#[derive(Debug, Serialize)]
pub struct StorageBucketsPage {
    pub buckets: Vec<SupabaseBucket>,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
pub struct StorageObjectsPage {
    pub objects: Vec<SupabaseObject>,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
pub struct StorageUploadFailure {
    pub name: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
pub struct StorageUploadResult {
    pub uploaded: Vec<String>,
    pub failed: Vec<StorageUploadFailure>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StorageObjectInfo {
    pub id: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub bucket_id: Option<String>,
    pub size: Option<u64>,
    pub content_type: Option<String>,
    pub cache_control: Option<String>,
    pub content_encoding: Option<String>,
    pub etag: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub last_modified: Option<String>,
    pub created_at: Option<String>,
}

fn take_page<T>(mut items: Vec<T>) -> (Vec<T>, bool) {
    let has_more = items.len() > PAGE_SIZE;
    items.truncate(PAGE_SIZE);
    (items, has_more)
}

fn validate_prefix(prefix: &str) -> Result<&str, String> {
    if prefix.is_empty() {
        return Ok(prefix);
    }
    match prefix.strip_suffix('/') {
        Some(inner) if validate_object_key(inner).is_ok() => Ok(prefix),
        _ => Err("Ungültiger Storage-Ordner.".into()),
    }
}

fn validate_search(search: &str) -> Result<&str, String> {
    let search = search.trim();
    if search.len() > 256 || search.contains('/') || search.contains('\0') {
        return Err("Ungültiger Suchbegriff.".into());
    }
    Ok(search)
}

fn validate_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') || validate_object_key(name).is_err() {
        return Err("Bitte einen gültigen Namen ohne Schrägstrich eingeben.".into());
    }
    Ok(name)
}

fn validate_bucket_id(bucket: &str) -> Result<&str, String> {
    let bucket = validate_bucket(bucket.trim())?;
    if bucket.len() > 100
        || !bucket
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
    {
        return Err(
            "Bucket-Namen dürfen nur Buchstaben, Ziffern, Leerzeichen, '-', '_' und '.' enthalten."
                .into(),
        );
    }
    Ok(bucket)
}

fn validate_mime_types(types: &[String]) -> Result<Option<Vec<String>>, String> {
    let mut cleaned = Vec::new();
    for raw in types {
        let value = raw.trim();
        if value.is_empty() {
            continue;
        }
        let valid = value.len() <= 255
            && value.split_once('/').is_some_and(|(kind, sub)| {
                let token = |part: &str| {
                    !part.is_empty()
                        && part
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || "!#$&^_.+-*".contains(c))
                };
                token(kind) && token(sub)
            });
        if !valid {
            return Err(format!("Ungültiger MIME-Typ: {value}"));
        }
        if !cleaned.iter().any(|existing| existing == value) {
            cleaned.push(value.to_string());
        }
    }
    if cleaned.len() > 100 {
        return Err("Höchstens 100 MIME-Typen erlaubt.".into());
    }
    Ok((!cleaned.is_empty()).then_some(cleaned))
}

fn bucket_settings(
    public: bool,
    file_size_limit: Option<u64>,
    allowed_mime_types: &[String],
) -> Result<serde_json::Value, String> {
    if file_size_limit == Some(0) {
        return Err("Das Größenlimit muss größer als 0 sein.".into());
    }
    Ok(serde_json::json!({
        "public": public,
        "file_size_limit": file_size_limit,
        "allowed_mime_types": validate_mime_types(allowed_mime_types)?,
    }))
}

fn transfer_targets(
    keys: &[String],
    source: &str,
    destination: &str,
) -> Result<Vec<(String, String)>, String> {
    keys.iter()
        .map(|key| {
            let rest = key
                .strip_prefix(source)
                .ok_or_else(|| "Ungültiger Storage-Pfad.".to_string())?;
            let target = format!("{destination}{rest}");
            validate_object_key(&target)?;
            Ok((key.clone(), target))
        })
        .collect()
}

async fn storage_json<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
    action: &str,
) -> Result<T, String> {
    let status = response.status();
    if !status.is_success() {
        let body = response
            .json::<serde_json::Value>()
            .await
            .unwrap_or_default();
        let detail = body["message"]
            .as_str()
            .or_else(|| body["error"].as_str())
            .unwrap_or("")
            .chars()
            .take(300)
            .collect::<String>();
        let hint = match status.as_u16() {
            401 => "API-Schlüssel ungültig.".to_string(),
            403 => "Keine Berechtigung (Storage-Richtlinien prüfen).".to_string(),
            _ if detail.is_empty() => format!("{action} fehlgeschlagen."),
            _ => format!("{action} fehlgeschlagen: {detail}"),
        };
        return Err(format!("Supabase HTTP {}: {hint}", status.as_u16()));
    }
    response
        .json::<T>()
        .await
        .map_err(|_| "Supabase hat unerwartete Daten geliefert.".into())
}

async fn storage_url(
    reference: &str,
    path: &str,
    segments: &[&str],
) -> Result<reqwest::Url, String> {
    let mut url = project_url(reference, path).await?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Supabase-URL.".to_string())?
        .extend(segments.iter().flat_map(|segment| segment.split('/')));
    Ok(url)
}

async fn send(request: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    request
        .send()
        .await
        .map_err(|_| "Supabase Storage ist nicht erreichbar.".to_string())
}

async fn list_page(
    reference: &str,
    key: &str,
    bucket: &str,
    prefix: &str,
    search: &str,
    limit: usize,
    offset: usize,
) -> Result<Vec<SupabaseObject>, String> {
    let url = storage_url(reference, "storage/v1/object/list", &[bucket]).await?;
    let response = send(
        project_api_auth(client().post(url), key).json(&serde_json::json!({
            "prefix": prefix,
            "search": search,
            "limit": limit,
            "offset": offset,
            "sortBy": {"column": "name", "order": "asc"}
        })),
    )
    .await?;
    storage_json(response, "Dateiliste").await
}

async fn collect_keys(
    reference: &str,
    key: &str,
    bucket: &str,
    folder: &str,
    max: usize,
    keys: &mut Vec<String>,
) -> Result<(), String> {
    let mut pending = vec![folder.to_string()];
    while let Some(prefix) = pending.pop() {
        let mut offset = 0;
        loop {
            let page = list_page(reference, key, bucket, &prefix, "", LIST_BATCH, offset).await?;
            let count = page.len();
            for entry in page {
                if entry.id.is_none() {
                    pending.push(format!("{prefix}{}/", entry.name));
                } else {
                    keys.push(format!("{prefix}{}", entry.name));
                }
                if keys.len() + pending.len() > max {
                    return Err(format!(
                        "Der Ordner enthält mehr als {max} Einträge. Bitte in kleineren Teilen bearbeiten."
                    ));
                }
            }
            if count < LIST_BATCH {
                break;
            }
            offset += LIST_BATCH;
        }
    }
    Ok(())
}

async fn expand_paths(
    reference: &str,
    key: &str,
    bucket: &str,
    paths: &[String],
    max: usize,
) -> Result<Vec<String>, String> {
    let mut keys = Vec::new();
    for path in paths {
        if path.ends_with('/') {
            collect_keys(
                reference,
                key,
                bucket,
                validate_prefix(path)?,
                max,
                &mut keys,
            )
            .await?;
        } else {
            keys.push(validate_object_key(path)?.to_string());
            if keys.len() > max {
                return Err(format!("Höchstens {max} Dateien auf einmal."));
            }
        }
    }
    keys.sort_unstable();
    keys.dedup();
    Ok(keys)
}

#[tauri::command]
pub async fn supabase_studio_storage_buckets(
    reference: String,
    search: String,
    offset: u32,
) -> Result<StorageBucketsPage, String> {
    let reference = validate_ref(&reference)?;
    let search = validate_search(&search)?;
    let key = project_secret_key(reference).await?;
    let mut url = project_url(reference, "storage/v1/bucket").await?;
    url.query_pairs_mut()
        .append_pair("limit", &(PAGE_SIZE + 1).to_string())
        .append_pair("offset", &offset.to_string())
        .append_pair("sortColumn", "name")
        .append_pair("sortOrder", "asc");
    if !search.is_empty() {
        url.query_pairs_mut().append_pair("search", search);
    }
    let response = send(project_api_auth(client().get(url), &key)).await?;
    let (buckets, has_more) = take_page(storage_json(response, "Bucket-Liste").await?);
    Ok(StorageBucketsPage { buckets, has_more })
}

#[tauri::command]
pub async fn supabase_studio_storage_bucket_create(
    reference: String,
    bucket: String,
    public: bool,
    file_size_limit: Option<u64>,
    allowed_mime_types: Vec<String>,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket_id(&bucket)?;
    let mut body = bucket_settings(public, file_size_limit, &allowed_mime_types)?;
    body["id"] = bucket.into();
    body["name"] = bucket.into();
    let key = project_secret_key(reference).await?;
    let url = project_url(reference, "storage/v1/bucket").await?;
    let response = send(project_api_auth(client().post(url), &key).json(&body)).await?;
    let _: serde_json::Value = storage_json(response, "Bucket erstellen").await?;
    Ok(())
}

#[tauri::command]
pub async fn supabase_studio_storage_bucket_update(
    reference: String,
    bucket: String,
    public: bool,
    file_size_limit: Option<u64>,
    allowed_mime_types: Vec<String>,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let body = bucket_settings(public, file_size_limit, &allowed_mime_types)?;
    let key = project_secret_key(reference).await?;
    let url = storage_url(reference, "storage/v1/bucket", &[bucket]).await?;
    let response = send(project_api_auth(client().put(url), &key).json(&body)).await?;
    let _: serde_json::Value = storage_json(response, "Bucket speichern").await?;
    Ok(())
}

#[tauri::command]
pub async fn supabase_studio_storage_bucket_empty(
    reference: String,
    bucket: String,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let key = project_secret_key(reference).await?;
    let mut url = storage_url(reference, "storage/v1/bucket", &[bucket]).await?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Supabase-URL.".to_string())?
        .push("empty");
    let response = send(project_api_auth(client().post(url), &key)).await?;
    let _: serde_json::Value = storage_json(response, "Bucket leeren").await?;
    Ok(())
}

#[tauri::command]
pub async fn supabase_studio_storage_objects(
    reference: String,
    bucket: String,
    prefix: String,
    search: String,
    offset: u32,
) -> Result<StorageObjectsPage, String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let prefix = validate_prefix(&prefix)?;
    let search = validate_search(&search)?;
    let key = project_secret_key(reference).await?;
    let page = list_page(
        reference,
        &key,
        bucket,
        prefix,
        search,
        PAGE_SIZE + 1,
        offset as usize,
    )
    .await?;
    let (mut objects, has_more) = take_page(page);
    objects.retain(|entry| entry.name != FOLDER_PLACEHOLDER);
    Ok(StorageObjectsPage { objects, has_more })
}

async fn upload_path(
    reference: &str,
    key: &str,
    bucket: &str,
    object_key: &str,
    path: &std::path::Path,
    upsert: bool,
) -> Result<(), String> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|_| "Datei konnte nicht gelesen werden.".to_string())?;
    if !metadata.is_file() {
        return Err("Keine Datei.".into());
    }
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "Datei konnte nicht geöffnet werden.".to_string())?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let url = storage_url(reference, "storage/v1/object", &[bucket, object_key]).await?;
    let response = project_api_auth(crate::baas_file::upload_client().post(url), key)
        .header(reqwest::header::CONTENT_TYPE, mime.as_ref())
        .header(reqwest::header::CONTENT_LENGTH, metadata.len())
        .header("x-upsert", if upsert { "true" } else { "false" })
        .body(reqwest::Body::wrap_stream(ReaderStream::new(file)))
        .send()
        .await
        .map_err(|_| "Supabase Storage ist beim Upload nicht erreichbar.".to_string())?;
    let _: serde_json::Value = storage_json(response, "Upload").await?;
    Ok(())
}

async fn pick_files(app: tauri::AppHandle) -> Result<Vec<std::path::PathBuf>, String> {
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

pub(crate) async fn upload_paths(
    reference: &str,
    bucket: &str,
    prefix: &str,
    paths: Vec<std::path::PathBuf>,
    upsert: bool,
) -> Result<StorageUploadResult, String> {
    if paths.len() > MAX_TRANSFER {
        return Err(format!("Höchstens {MAX_TRANSFER} Dateien pro Upload."));
    }
    let key = project_secret_key(reference).await?;
    let mut result = StorageUploadResult {
        uploaded: Vec::new(),
        failed: Vec::new(),
    };
    for path in paths {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        let object_key = format!("{prefix}{name}");
        let outcome = match validate_object_key(&object_key) {
            Ok(object_key) => upload_path(reference, &key, bucket, object_key, &path, upsert).await,
            Err(error) => Err(error),
        };
        match outcome {
            Ok(()) => result.uploaded.push(object_key),
            Err(error) => result.failed.push(StorageUploadFailure { name, error }),
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn supabase_studio_storage_upload(
    app: tauri::AppHandle,
    reference: String,
    bucket: String,
    prefix: String,
    upsert: bool,
) -> Result<StorageUploadResult, String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let prefix = validate_prefix(&prefix)?;
    project_secret_key(reference).await?;
    let paths = pick_files(app).await?;
    upload_paths(reference, bucket, prefix, paths, upsert).await
}

#[tauri::command]
pub async fn supabase_studio_storage_create_folder(
    reference: String,
    bucket: String,
    prefix: String,
    name: String,
) -> Result<String, String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let prefix = validate_prefix(&prefix)?;
    let folder = format!("{prefix}{}/", validate_name(&name)?);
    let object_key = format!("{folder}{FOLDER_PLACEHOLDER}");
    validate_object_key(&object_key)?;
    let key = project_secret_key(reference).await?;
    let url = storage_url(reference, "storage/v1/object", &[bucket, &object_key]).await?;
    let response = send(
        project_api_auth(client().post(url), &key)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(Vec::new()),
    )
    .await?;
    let _: serde_json::Value = storage_json(response, "Ordner erstellen").await?;
    Ok(folder)
}

#[tauri::command]
pub async fn supabase_studio_storage_transfer(
    reference: String,
    bucket: String,
    source: String,
    destination_bucket: String,
    destination: String,
    copy: bool,
) -> Result<u32, String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let destination_bucket = validate_bucket(&destination_bucket)?;
    let folder = source.ends_with('/');
    if folder != destination.ends_with('/') {
        return Err("Ordner können nur in Ordnerpfade (mit '/' am Ende) übertragen werden.".into());
    }
    if bucket == destination_bucket
        && (source == destination || folder && destination.starts_with(&source))
    {
        return Err("Das Ziel muss außerhalb der Quelle liegen.".into());
    }
    let key = project_secret_key(reference).await?;
    let (keys, source_prefix, target_prefix) = if folder {
        let source = validate_prefix(&source)?;
        let destination = validate_prefix(&destination)?;
        let mut keys = Vec::new();
        collect_keys(reference, &key, bucket, source, MAX_TRANSFER, &mut keys).await?;
        (keys, source, destination)
    } else {
        validate_object_key(&destination)?;
        (
            vec![validate_object_key(&source)?.to_string()],
            source.as_str(),
            destination.as_str(),
        )
    };
    let pairs = if folder {
        transfer_targets(&keys, source_prefix, target_prefix)?
    } else {
        vec![(keys[0].clone(), target_prefix.to_string())]
    };
    let endpoint = if copy {
        "storage/v1/object/copy"
    } else {
        "storage/v1/object/move"
    };
    let url = project_url(reference, endpoint).await?;
    let mut done = 0;
    for (source_key, destination_key) in pairs {
        let response = send(project_api_auth(client().post(url.clone()), &key).json(
            &serde_json::json!({
                "bucketId": bucket,
                "sourceKey": source_key,
                "destinationBucket": destination_bucket,
                "destinationKey": destination_key,
            }),
        ))
        .await?;
        let action = if copy { "Kopieren" } else { "Verschieben" };
        let _: serde_json::Value = storage_json(response, action)
            .await
            .map_err(|error| format!("{source_key}: {error} ({done} bereits übertragen)"))?;
        done += 1;
    }
    Ok(done)
}

#[tauri::command]
pub async fn supabase_studio_storage_delete(
    reference: String,
    bucket: String,
    paths: Vec<String>,
) -> Result<u32, String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    if paths.is_empty() || paths.len() > MAX_DELETE {
        return Err("Bitte zwischen 1 und 10000 Einträge auswählen.".into());
    }
    let key = project_secret_key(reference).await?;
    let keys = expand_paths(reference, &key, bucket, &paths, MAX_DELETE).await?;
    let url = storage_url(reference, "storage/v1/object", &[bucket]).await?;
    let mut deleted = 0;
    for chunk in keys.chunks(LIST_BATCH) {
        let response = send(
            project_api_auth(client().delete(url.clone()), &key)
                .json(&serde_json::json!({ "prefixes": chunk })),
        )
        .await?;
        let removed: Vec<serde_json::Value> = storage_json(response, "Löschen").await?;
        deleted += removed.len() as u32;
    }
    Ok(deleted)
}

#[tauri::command]
pub async fn supabase_studio_storage_signed_url(
    reference: String,
    bucket: String,
    object_key: String,
    expires_in: u32,
    download: bool,
) -> Result<String, String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let object_key = validate_object_key(&object_key)?;
    if expires_in == 0 || expires_in > MAX_SIGN_SECONDS {
        return Err("Die Gültigkeit muss zwischen 1 Sekunde und 10 Jahren liegen.".into());
    }
    let key = project_secret_key(reference).await?;
    let url = storage_url(reference, "storage/v1/object/sign", &[bucket, object_key]).await?;
    let response = send(
        project_api_auth(client().post(url), &key)
            .json(&serde_json::json!({ "expiresIn": expires_in })),
    )
    .await?;
    let body: serde_json::Value = storage_json(response, "Signierte URL").await?;
    let signed = body["signedURL"]
        .as_str()
        .or_else(|| body["signedUrl"].as_str())
        .ok_or_else(|| "Supabase hat keine signierte URL geliefert.".to_string())?;
    let mut full = if signed.starts_with("http") {
        reqwest::Url::parse(signed).map_err(|_| "Ungültige signierte URL.".to_string())?
    } else {
        project_url(
            reference,
            &format!("storage/v1/{}", signed.trim_start_matches('/')),
        )
        .await?
    };
    if download {
        full.query_pairs_mut().append_pair("download", "");
    }
    Ok(full.to_string())
}

#[tauri::command]
pub async fn supabase_studio_storage_public_url(
    reference: String,
    bucket: String,
    object_key: String,
) -> Result<String, String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let object_key = validate_object_key(&object_key)?;
    Ok(
        storage_url(reference, "storage/v1/object/public", &[bucket, object_key])
            .await?
            .to_string(),
    )
}

#[tauri::command]
pub async fn supabase_studio_storage_object_info(
    reference: String,
    bucket: String,
    object_key: String,
) -> Result<StorageObjectInfo, String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let object_key = validate_object_key(&object_key)?;
    let key = project_secret_key(reference).await?;
    let url = storage_url(
        reference,
        "storage/v1/object/info/authenticated",
        &[bucket, object_key],
    )
    .await?;
    let response = send(project_api_auth(client().get(url), &key)).await?;
    storage_json(response, "Datei-Details").await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_validation() {
        assert_eq!(validate_prefix("").unwrap(), "");
        assert_eq!(validate_prefix("a/b/").unwrap(), "a/b/");
        for bad in ["a", "/", "a//", "../", "a/../", "a\\b/"] {
            assert!(validate_prefix(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn name_and_search_validation() {
        assert_eq!(validate_name(" docs ").unwrap(), "docs");
        for bad in ["", "a/b", "..", ".", "a\\b"] {
            assert!(validate_name(bad).is_err(), "{bad}");
        }
        assert_eq!(validate_search(" foo ").unwrap(), "foo");
        assert!(validate_search("a/b").is_err());
        assert!(validate_search(&"x".repeat(257)).is_err());
    }

    #[test]
    fn bucket_id_validation() {
        assert!(validate_bucket_id("avatars-1").is_ok());
        assert!(validate_bucket_id("my bucket.v2").is_ok());
        for bad in ["", "a/b", "ä", "a;drop", ".."] {
            assert!(validate_bucket_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn mime_types_are_cleaned_and_validated() {
        assert_eq!(validate_mime_types(&[]).unwrap(), None);
        assert_eq!(
            validate_mime_types(&[
                " image/* ".into(),
                "".into(),
                "image/*".into(),
                "application/vnd.api+json".into()
            ])
            .unwrap(),
            Some(vec!["image/*".into(), "application/vnd.api+json".into()])
        );
        for bad in [
            "image",
            "/png",
            "text/",
            "text/plain; charset=utf-8",
            "a/b/c",
        ] {
            assert!(validate_mime_types(&[bad.into()]).is_err(), "{bad}");
        }
    }

    #[test]
    fn bucket_settings_body() {
        let body = bucket_settings(true, Some(1024), &["text/plain".into()]).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"public": true, "file_size_limit": 1024, "allowed_mime_types": ["text/plain"]})
        );
        let cleared = bucket_settings(false, None, &[]).unwrap();
        assert!(cleared["file_size_limit"].is_null() && cleared["allowed_mime_types"].is_null());
        assert!(bucket_settings(false, Some(0), &[]).is_err());
    }

    #[test]
    fn page_split() {
        let (items, more) = take_page((0..101).collect::<Vec<_>>());
        assert_eq!((items.len(), more), (100, true));
        let (items, more) = take_page((0..7).collect::<Vec<_>>());
        assert_eq!((items.len(), more), (7, false));
    }

    #[test]
    fn folder_transfer_targets() {
        let keys = vec!["a/x.txt".to_string(), "a/sub/y.txt".to_string()];
        assert_eq!(
            transfer_targets(&keys, "a/", "b/c/").unwrap(),
            vec![
                ("a/x.txt".to_string(), "b/c/x.txt".to_string()),
                ("a/sub/y.txt".to_string(), "b/c/sub/y.txt".to_string())
            ]
        );
        assert_eq!(transfer_targets(&keys, "a/", "").unwrap()[0].1, "x.txt");
        assert!(transfer_targets(&keys, "z/", "b/").is_err());
    }
}

#[cfg(test)]
mod live {
    use super::*;
    use crate::baas_self_hosted_live_tests::{env, isolate_secrets, latency};
    use crate::supabase::{supabase_connect_self_hosted, supabase_delete_bucket};

    #[tokio::test]
    #[ignore]
    async fn supabase_studio_storage_live() {
        let (Some(url), Some(secret)) =
            (env("L8DB_E2E_SUPABASE_URL"), env("L8DB_E2E_SUPABASE_KEY"))
        else {
            return;
        };
        let _secrets = isolate_secrets();
        let project = supabase_connect_self_hosted(url.clone(), secret, "Storage".into())
            .await
            .unwrap();
        let reference = project.reference.clone();
        let bucket = format!("l8db-studio-{}", std::process::id());
        let other = format!("{bucket}-b");
        for name in [&bucket, &other] {
            let _ = supabase_studio_storage_bucket_empty(reference.clone(), name.clone()).await;
            let _ = supabase_delete_bucket(reference.clone(), name.clone()).await;
        }

        assert!(supabase_studio_storage_bucket_create(
            reference.clone(),
            "bad/name".into(),
            false,
            None,
            vec![]
        )
        .await
        .is_err());
        supabase_studio_storage_bucket_create(
            reference.clone(),
            bucket.clone(),
            false,
            Some(1024 * 1024),
            vec!["text/plain".into(), "application/json".into()],
        )
        .await
        .unwrap();
        supabase_studio_storage_bucket_create(reference.clone(), other.clone(), true, None, vec![])
            .await
            .unwrap();

        let page = supabase_studio_storage_buckets(reference.clone(), bucket.clone(), 0)
            .await
            .unwrap();
        let created = page.buckets.iter().find(|b| b.id == bucket).unwrap();
        assert!(!created.public);
        assert_eq!(created.file_size_limit, Some(1024 * 1024));
        assert_eq!(created.allowed_mime_types.as_ref().unwrap().len(), 2);

        supabase_studio_storage_bucket_update(
            reference.clone(),
            bucket.clone(),
            true,
            Some(2048),
            vec![],
        )
        .await
        .unwrap();
        let page = supabase_studio_storage_buckets(reference.clone(), bucket.clone(), 0)
            .await
            .unwrap();
        let updated = page.buckets.iter().find(|b| b.id == bucket).unwrap();
        assert!(updated.public);
        assert_eq!(updated.file_size_limit, Some(2048));
        assert!(updated.allowed_mime_types.is_none());

        let dir = tempfile::tempdir().unwrap();
        let mut paths = Vec::new();
        for index in 0..105 {
            let path = dir.path().join(format!("f{index:03}.txt"));
            std::fs::write(&path, format!("hello {index}")).unwrap();
            paths.push(path);
        }
        let result = upload_paths(&reference, &bucket, "docs/", paths.clone(), false)
            .await
            .unwrap();
        assert_eq!((result.uploaded.len(), result.failed.len()), (105, 0));
        let again = upload_paths(&reference, &bucket, "docs/", paths[..1].to_vec(), false)
            .await
            .unwrap();
        assert_eq!(again.failed.len(), 1);
        let upserted = upload_paths(&reference, &bucket, "docs/", paths[..1].to_vec(), true)
            .await
            .unwrap();
        assert_eq!(upserted.uploaded.len(), 1);

        let folder = supabase_studio_storage_create_folder(
            reference.clone(),
            bucket.clone(),
            "".into(),
            "leer".into(),
        )
        .await
        .unwrap();
        assert_eq!(folder, "leer/");
        let root = supabase_studio_storage_objects(
            reference.clone(),
            bucket.clone(),
            "".into(),
            "".into(),
            0,
        )
        .await
        .unwrap();
        let names = root
            .objects
            .iter()
            .map(|o| o.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["docs", "leer"]);
        let leer = supabase_studio_storage_objects(
            reference.clone(),
            bucket.clone(),
            "leer/".into(),
            "".into(),
            0,
        )
        .await
        .unwrap();
        assert!(leer.objects.is_empty());

        let first = supabase_studio_storage_objects(
            reference.clone(),
            bucket.clone(),
            "docs/".into(),
            "".into(),
            0,
        )
        .await
        .unwrap();
        assert_eq!((first.objects.len(), first.has_more), (100, true));
        let second = supabase_studio_storage_objects(
            reference.clone(),
            bucket.clone(),
            "docs/".into(),
            "".into(),
            100,
        )
        .await
        .unwrap();
        assert_eq!((second.objects.len(), second.has_more), (5, false));
        let found = supabase_studio_storage_objects(
            reference.clone(),
            bucket.clone(),
            "docs/".into(),
            "f10".into(),
            0,
        )
        .await
        .unwrap();
        assert_eq!(found.objects.len(), 5);

        let info = supabase_studio_storage_object_info(
            reference.clone(),
            bucket.clone(),
            "docs/f001.txt".into(),
        )
        .await
        .unwrap();
        assert_eq!(info.size, Some(7));
        assert_eq!(info.content_type.as_deref(), Some("text/plain"));

        let signed = supabase_studio_storage_signed_url(
            reference.clone(),
            bucket.clone(),
            "docs/f001.txt".into(),
            60,
            false,
        )
        .await
        .unwrap();
        assert_eq!(
            reqwest::get(&signed).await.unwrap().text().await.unwrap(),
            "hello 1"
        );
        assert!(supabase_studio_storage_signed_url(
            reference.clone(),
            bucket.clone(),
            "docs/f001.txt".into(),
            0,
            false
        )
        .await
        .is_err());
        let public = supabase_studio_storage_public_url(
            reference.clone(),
            bucket.clone(),
            "docs/f001.txt".into(),
        )
        .await
        .unwrap();
        assert_eq!(
            reqwest::get(&public).await.unwrap().text().await.unwrap(),
            "hello 1"
        );

        assert_eq!(
            supabase_studio_storage_transfer(
                reference.clone(),
                bucket.clone(),
                "docs/f000.txt".into(),
                bucket.clone(),
                "kopie/a.txt".into(),
                true
            )
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            supabase_studio_storage_transfer(
                reference.clone(),
                bucket.clone(),
                "kopie/a.txt".into(),
                bucket.clone(),
                "kopie/b.txt".into(),
                false
            )
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            supabase_studio_storage_transfer(
                reference.clone(),
                bucket.clone(),
                "kopie/".into(),
                other.clone(),
                "ziel/".into(),
                true
            )
            .await
            .unwrap(),
            1
        );
        assert!(supabase_studio_storage_transfer(
            reference.clone(),
            bucket.clone(),
            "docs/".into(),
            bucket.clone(),
            "docs/sub/".into(),
            false
        )
        .await
        .is_err());
        let moved = supabase_studio_storage_objects(
            reference.clone(),
            other.clone(),
            "ziel/".into(),
            "".into(),
            0,
        )
        .await
        .unwrap();
        assert_eq!(moved.objects[0].name, "b.txt");

        let bucket_ref = bucket.clone();
        let reference_ref = reference.clone();
        latency("storage objects", 500, || {
            let (reference, bucket) = (reference_ref.clone(), bucket_ref.clone());
            async move {
                supabase_studio_storage_objects(reference, bucket, "docs/".into(), "".into(), 0)
                    .await
                    .unwrap();
            }
        })
        .await;
        latency("storage buckets", 500, || {
            let reference = reference_ref.clone();
            async move {
                supabase_studio_storage_buckets(reference, "".into(), 0)
                    .await
                    .unwrap();
            }
        })
        .await;
        latency("storage object info", 500, || {
            let (reference, bucket) = (reference_ref.clone(), bucket_ref.clone());
            async move {
                supabase_studio_storage_object_info(reference, bucket, "docs/f001.txt".into())
                    .await
                    .unwrap();
            }
        })
        .await;

        let deleted = supabase_studio_storage_delete(
            reference.clone(),
            bucket.clone(),
            vec!["docs/".into(), "kopie/b.txt".into(), "leer/".into()],
        )
        .await
        .unwrap();
        assert_eq!(deleted, 107);
        let root = supabase_studio_storage_objects(
            reference.clone(),
            bucket.clone(),
            "".into(),
            "".into(),
            0,
        )
        .await
        .unwrap();
        assert!(root.objects.is_empty(), "{:?}", root.objects);

        supabase_studio_storage_bucket_empty(reference.clone(), other.clone())
            .await
            .unwrap();
        let _ =
            supabase_studio_storage_delete(reference.clone(), other.clone(), vec!["ziel/".into()])
                .await;
        supabase_delete_bucket(reference.clone(), other.clone())
            .await
            .unwrap();
        supabase_delete_bucket(reference.clone(), bucket.clone())
            .await
            .unwrap();
        let rest = supabase_studio_storage_buckets(reference.clone(), "l8db-studio-".into(), 0)
            .await
            .unwrap();
        assert!(!rest.buckets.iter().any(|b| b.id == bucket || b.id == other));

        if let Some(public_key) = env("L8DB_E2E_SUPABASE_PUBLIC_KEYS")
            .and_then(|keys| keys.split(',').next().map(str::to_string))
        {
            let _secrets = isolate_secrets();
            let anon = supabase_connect_self_hosted(url, public_key, "Anon".into())
                .await
                .unwrap();
            supabase_studio_storage_buckets(anon.reference.clone(), "".into(), 0)
                .await
                .unwrap();
            assert!(supabase_studio_storage_bucket_create(
                anon.reference,
                format!("{bucket}-anon"),
                false,
                None,
                vec![]
            )
            .await
            .is_err());
        }
    }
}
