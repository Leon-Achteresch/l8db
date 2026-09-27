use std::sync::Arc;

use serde::Serialize;
use tauri::Emitter;

use super::client::S3;
use super::ops::{
    BucketInfo, BucketStats, DeleteOutcome, MultipartUpload, ObjectEntry, ObjectHead,
    ObjectListing, ObjectPreview, ObjectProperties, ObjectRef, TransferItem, VersionListing,
};
use super::transfer::{self, TransferSummary};
use crate::db::QueryResult;

async fn connect(connection_string: &str) -> Result<S3, String> {
    S3::connect(connection_string).await
}

#[derive(Serialize)]
pub struct SearchResult {
    pub objects: Vec<ObjectEntry>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn s3_list_buckets(connection_string: String) -> Result<Vec<BucketInfo>, String> {
    connect(&connection_string).await?.list_buckets().await
}

#[tauri::command]
pub async fn s3_create_bucket(
    connection_string: String,
    bucket: String,
    region: Option<String>,
    object_lock: Option<bool>,
) -> Result<(), String> {
    connect(&connection_string)
        .await?
        .create_bucket(
            bucket.trim(),
            region.as_deref(),
            object_lock.unwrap_or(false),
        )
        .await
}

#[tauri::command]
pub async fn s3_delete_bucket(
    connection_string: String,
    bucket: String,
    force: Option<bool>,
) -> Result<(), String> {
    connect(&connection_string)
        .await?
        .delete_bucket(&bucket, force.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn s3_list_objects(
    connection_string: String,
    bucket: String,
    prefix: Option<String>,
    delimiter: Option<String>,
    continuation_token: Option<String>,
    max_keys: Option<u32>,
) -> Result<ObjectListing, String> {
    connect(&connection_string)
        .await?
        .list_objects(
            &bucket,
            prefix.as_deref().unwrap_or(""),
            delimiter.as_deref(),
            continuation_token.as_deref(),
            max_keys,
        )
        .await
}

#[tauri::command]
pub async fn s3_list_object_versions(
    connection_string: String,
    bucket: String,
    prefix: Option<String>,
    delimiter: Option<String>,
    key_marker: Option<String>,
    version_marker: Option<String>,
    max_keys: Option<u32>,
) -> Result<VersionListing, String> {
    connect(&connection_string)
        .await?
        .list_versions(
            &bucket,
            prefix.as_deref().unwrap_or(""),
            delimiter.as_deref(),
            key_marker.as_deref(),
            version_marker.as_deref(),
            max_keys,
        )
        .await
}

#[tauri::command]
pub async fn s3_head_object(
    connection_string: String,
    bucket: String,
    key: String,
    version_id: Option<String>,
) -> Result<ObjectHead, String> {
    connect(&connection_string)
        .await?
        .head_object(&bucket, &key, version_id.as_deref())
        .await
}

#[tauri::command]
pub async fn s3_preview_object(
    connection_string: String,
    bucket: String,
    key: String,
    version_id: Option<String>,
    max_bytes: Option<u64>,
) -> Result<ObjectPreview, String> {
    connect(&connection_string)
        .await?
        .preview(
            &bucket,
            &key,
            version_id.as_deref(),
            max_bytes.unwrap_or(1024 * 1024),
        )
        .await
}

#[tauri::command]
pub async fn s3_get_object_text(
    connection_string: String,
    bucket: String,
    key: String,
) -> Result<String, String> {
    connect(&connection_string)
        .await?
        .get_text(&bucket, &key)
        .await
}

#[tauri::command]
pub async fn s3_put_object_text(
    connection_string: String,
    bucket: String,
    key: String,
    text: String,
    content_type: Option<String>,
) -> Result<Option<String>, String> {
    let s3 = connect(&connection_string).await?;
    s3.replace_text(
        &bucket,
        &key,
        text,
        content_type,
        transfer::guess_content_type(&key),
    )
    .await
}

#[tauri::command]
pub async fn s3_create_folder(
    connection_string: String,
    bucket: String,
    key: String,
) -> Result<(), String> {
    connect(&connection_string)
        .await?
        .create_folder(&bucket, &key)
        .await
}

#[tauri::command]
pub async fn s3_delete_objects(
    connection_string: String,
    bucket: String,
    objects: Vec<ObjectRef>,
    bypass_governance: Option<bool>,
) -> Result<DeleteOutcome, String> {
    connect(&connection_string)
        .await?
        .delete_objects(&bucket, &objects, bypass_governance.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn s3_delete_prefix(
    connection_string: String,
    bucket: String,
    prefix: String,
    all_versions: Option<bool>,
    bypass_governance: Option<bool>,
) -> Result<DeleteOutcome, String> {
    if prefix.is_empty() {
        return Err("Ein leeres Präfix würde den ganzen Bucket leeren.".to_string());
    }
    connect(&connection_string)
        .await?
        .delete_prefix(
            &bucket,
            &prefix,
            all_versions.unwrap_or(false),
            bypass_governance.unwrap_or(false),
        )
        .await
}

#[tauri::command]
pub async fn s3_copy_objects(
    connection_string: String,
    source_bucket: String,
    items: Vec<TransferItem>,
    bucket: String,
    destination_prefix: String,
    move_items: Option<bool>,
) -> Result<DeleteOutcome, String> {
    let destination = match destination_prefix.trim_start_matches('/') {
        "" => String::new(),
        p if p.ends_with('/') => p.to_string(),
        p => format!("{p}/"),
    };
    connect(&connection_string)
        .await?
        .copy_items(
            &source_bucket,
            &items,
            &bucket,
            &destination,
            move_items.unwrap_or(false),
        )
        .await
}

#[tauri::command]
pub async fn s3_rename_object(
    connection_string: String,
    bucket: String,
    from: String,
    to: String,
) -> Result<DeleteOutcome, String> {
    connect(&connection_string)
        .await?
        .rename(&bucket, &from, &to)
        .await
}

#[tauri::command]
pub async fn s3_restore_version(
    connection_string: String,
    bucket: String,
    key: String,
    version_id: String,
) -> Result<(), String> {
    connect(&connection_string)
        .await?
        .copy_object(&bucket, &key, Some(&version_id), &bucket, &key, None)
        .await
}

#[tauri::command]
pub async fn s3_update_object_properties(
    connection_string: String,
    bucket: String,
    key: String,
    properties: ObjectProperties,
) -> Result<(), String> {
    connect(&connection_string)
        .await?
        .update_properties(&bucket, &key, &properties)
        .await
}

#[tauri::command]
pub async fn s3_get_config(
    connection_string: String,
    bucket: String,
    key: Option<String>,
    version_id: Option<String>,
    resource: String,
) -> Result<Option<String>, String> {
    connect(&connection_string)
        .await?
        .get_config(&bucket, key.as_deref(), version_id.as_deref(), &resource)
        .await
}

#[tauri::command]
pub async fn s3_put_config(
    connection_string: String,
    bucket: String,
    key: Option<String>,
    version_id: Option<String>,
    resource: String,
    body: String,
    bypass_governance: Option<bool>,
) -> Result<(), String> {
    connect(&connection_string)
        .await?
        .put_config(
            &bucket,
            key.as_deref(),
            version_id.as_deref(),
            &resource,
            body,
            bypass_governance.unwrap_or(false),
        )
        .await
}

#[tauri::command]
pub async fn s3_delete_config(
    connection_string: String,
    bucket: String,
    key: Option<String>,
    version_id: Option<String>,
    resource: String,
) -> Result<(), String> {
    connect(&connection_string)
        .await?
        .delete_config(&bucket, key.as_deref(), version_id.as_deref(), &resource)
        .await
}

#[tauri::command]
pub async fn s3_presign(
    connection_string: String,
    bucket: String,
    key: String,
    method: Option<String>,
    expires_secs: Option<u64>,
    version_id: Option<String>,
    download_name: Option<String>,
) -> Result<String, String> {
    let method = method.unwrap_or_else(|| "GET".into()).to_ascii_uppercase();
    if !matches!(method.as_str(), "GET" | "PUT") {
        return Err("Presigned URLs gibt es für GET und PUT.".to_string());
    }
    let mut extra = Vec::new();
    if let Some(v) = version_id.filter(|v| !v.is_empty()) {
        extra.push(("versionId".to_string(), v));
    }
    if let Some(name) = download_name.filter(|n| !n.is_empty()) {
        extra.push((
            "response-content-disposition".to_string(),
            format!("attachment; filename=\"{}\"", name.replace('"', "")),
        ));
    }
    Ok(connect(&connection_string).await?.presign(
        &method,
        &bucket,
        &key,
        expires_secs.unwrap_or(3600),
        &extra,
    ))
}

#[tauri::command]
pub async fn s3_list_multipart_uploads(
    connection_string: String,
    bucket: String,
) -> Result<Vec<MultipartUpload>, String> {
    connect(&connection_string)
        .await?
        .list_multipart_uploads(&bucket)
        .await
}

#[tauri::command]
pub async fn s3_abort_multipart_upload(
    connection_string: String,
    bucket: String,
    key: String,
    upload_id: String,
) -> Result<(), String> {
    connect(&connection_string)
        .await?
        .abort_multipart(&bucket, &key, &upload_id)
        .await
}

#[tauri::command]
pub async fn s3_bucket_stats(
    connection_string: String,
    bucket: String,
    prefix: Option<String>,
) -> Result<BucketStats, String> {
    connect(&connection_string)
        .await?
        .bucket_stats(&bucket, prefix.as_deref().unwrap_or(""))
        .await
}

#[tauri::command]
pub async fn s3_search_objects(
    connection_string: String,
    bucket: String,
    prefix: Option<String>,
    query: String,
    limit: Option<usize>,
) -> Result<SearchResult, String> {
    let (objects, truncated) = connect(&connection_string)
        .await?
        .search(
            &bucket,
            prefix.as_deref().unwrap_or(""),
            query.trim(),
            limit.unwrap_or(500).clamp(1, 5000),
        )
        .await?;
    Ok(SearchResult { objects, truncated })
}

#[tauri::command]
pub async fn s3_select_object(
    connection_string: String,
    bucket: String,
    key: String,
    expression: String,
) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let s3 = connect(&connection_string).await?;
    let records = super::select::select(&s3, &bucket, &key, &expression).await?;
    Ok(super::select::records_to_result(
        &records,
        start.elapsed().as_millis() as u64,
    ))
}

fn emitter(app: tauri::AppHandle) -> transfer::Emit {
    Arc::new(move |event| {
        let _ = app.emit("s3-transfer", event);
    })
}

#[tauri::command]
pub async fn s3_upload(
    app: tauri::AppHandle,
    connection_string: String,
    bucket: String,
    prefix: Option<String>,
    paths: Vec<String>,
    properties: Option<ObjectProperties>,
    transfer_id: String,
) -> Result<TransferSummary, String> {
    let s3 = connect(&connection_string).await?;
    transfer::upload(
        &s3,
        &bucket,
        prefix.as_deref().unwrap_or(""),
        &paths,
        &properties.unwrap_or_default(),
        &transfer_id,
        emitter(app),
    )
    .await
}

#[tauri::command]
pub async fn s3_download(
    app: tauri::AppHandle,
    connection_string: String,
    bucket: String,
    items: Vec<TransferItem>,
    target: String,
    transfer_id: String,
) -> Result<TransferSummary, String> {
    let s3 = connect(&connection_string).await?;
    transfer::download(&s3, &bucket, &items, &target, &transfer_id, emitter(app)).await
}

#[tauri::command]
pub fn s3_cancel_transfer(transfer_id: String) -> bool {
    transfer::cancel(&transfer_id)
}
