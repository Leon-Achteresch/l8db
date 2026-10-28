use super::{convex_error, deployment, ConvexDeploymentAccess};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::AsyncReadExt;

const MAX_ENV_TEXT: usize = 256 * 1024;
const MAX_ENV_VARIABLES: usize = 500;
const MAX_ENV_VALUE: usize = 8192;
const MAX_RECENT_ERRORS: usize = 10;
const SCHEDULED_SAMPLE: u32 = 100;
const IMPORT_PART_BYTES: usize = 8 * 1024 * 1024;
const MAX_IMPORT_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexSettingsInfo {
    pub url: String,
    pub site_url: String,
    pub cloud_url: Option<String>,
    pub state: Option<String>,
    pub version: Option<String>,
    pub node_version: Option<String>,
    pub instance_name: Option<String>,
    pub kind: Option<String>,
    pub auth_providers: Vec<Value>,
    pub components: Vec<Value>,
    pub errors: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexSettingsStats {
    pub table_count: Option<u64>,
    pub document_count: Option<u64>,
    pub function_count: Option<u64>,
    pub http_route_count: Option<u64>,
    pub file_count: Option<u64>,
    pub scheduled_pending: Option<u64>,
    pub scheduled_has_more: bool,
    pub cron_count: Option<u64>,
    pub errors: Vec<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexRecentError {
    pub identifier: String,
    pub udf_type: Option<String>,
    pub timestamp: f64,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct ConvexEnvImportResult {
    pub applied: Vec<String>,
    pub skipped: Vec<String>,
}

fn valid_env_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 256
        && name
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn valid_table_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn valid_import_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn unquote_double(raw: &str) -> String {
    let mut result = String::new();
    let mut chars = raw.chars();
    while let Some(char) = chars.next() {
        if char != '\\' {
            result.push(char);
            continue;
        }
        match chars.next() {
            Some('n') => result.push('\n'),
            Some('r') => result.push('\r'),
            Some('t') => result.push('\t'),
            Some(other) => result.push(other),
            None => result.push('\\'),
        }
    }
    result
}

fn closing_quote(text: &str, quote: char) -> Option<usize> {
    let mut escaped = false;
    for (index, char) in text.char_indices() {
        if quote == '"' && char == '\\' && !escaped {
            escaped = true;
            continue;
        }
        if char == quote && !escaped {
            return Some(index);
        }
        escaped = false;
    }
    None
}

pub(crate) fn parse_dotenv(text: &str) -> Result<Vec<(String, String)>, String> {
    if text.len() > MAX_ENV_TEXT {
        return Err("Der .env-Text ist zu groß (maximal 256 KB).".into());
    }
    let lines: Vec<&str> = text.lines().collect();
    let mut result: Vec<(String, String)> = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let number = index + 1;
        let line = lines[index].trim();
        index += 1;
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
        let (name, rest) = line
            .split_once('=')
            .ok_or_else(|| format!("Zeile {number}: „NAME=Wert“ erwartet."))?;
        let name = name.trim();
        if !valid_env_name(name) {
            return Err(format!("Zeile {number}: Ungültiger Variablenname."));
        }
        let rest = rest.trim_start();
        let value = match rest.chars().next() {
            Some(quote @ ('"' | '\'')) => {
                let mut body = rest[1..].to_string();
                let end = loop {
                    if let Some(end) = closing_quote(&body, quote) {
                        break end;
                    }
                    if index >= lines.len() {
                        return Err(format!(
                            "Zeile {number}: Anführungszeichen nicht geschlossen."
                        ));
                    }
                    body.push('\n');
                    body.push_str(lines[index]);
                    index += 1;
                };
                let inner = &body[..end];
                if quote == '"' {
                    unquote_double(inner)
                } else {
                    inner.to_string()
                }
            }
            _ => rest
                .split_once(" #")
                .map_or(rest, |(value, _)| value)
                .trim()
                .to_string(),
        };
        if value.len() > MAX_ENV_VALUE {
            return Err(format!("Zeile {number}: Wert ist zu groß (maximal 8 KB)."));
        }
        result.retain(|(existing, _)| existing != name);
        result.push((name.to_string(), value));
        if result.len() > MAX_ENV_VARIABLES {
            return Err("Zu viele Variablen (maximal 500).".into());
        }
    }
    Ok(result)
}

pub(crate) fn format_dotenv(variables: &BTreeMap<String, String>) -> String {
    variables
        .iter()
        .map(|(name, value)| {
            let plain = !value.is_empty()
                && value
                    .chars()
                    .all(|char| !char.is_whitespace() && !matches!(char, '"' | '\'' | '#' | '\\'));
            if plain {
                format!("{name}={value}\n")
            } else {
                let escaped = value
                    .replace('\\', "\\\\")
                    .replace('"', "\\\"")
                    .replace('\n', "\\n")
                    .replace('\r', "\\r");
                format!("{name}=\"{escaped}\"\n")
            }
        })
        .collect()
}

fn site_url(url: &reqwest::Url, canonical: Option<&str>) -> String {
    if let Some(canonical) = canonical.filter(|value| !value.is_empty()) {
        return canonical.trim_end_matches('/').to_string();
    }
    let base = url.as_str().trim_end_matches('/');
    match url.host_str() {
        Some(host) if host.ends_with(".convex.cloud") => {
            base.replacen(".convex.cloud", ".convex.site", 1)
        }
        _ => format!("{base}/http"),
    }
}

fn recent_errors(entries: &[Value]) -> Vec<ConvexRecentError> {
    let mut errors = Vec::new();
    for entry in entries.iter().rev() {
        if errors.len() >= MAX_RECENT_ERRORS {
            break;
        }
        let identifier = entry
            .get("identifier")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let udf_type = entry
            .get("udfType")
            .and_then(Value::as_str)
            .map(str::to_string);
        let timestamp = entry
            .get("timestamp")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let request_id = entry
            .get("requestId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let mut message = entry
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string);
        if message.is_none() {
            message = entry
                .get("logLines")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find_map(|line| match line {
                    Value::String(text) => text.strip_prefix("[ERROR] ").map(str::to_string),
                    Value::Object(object) if object.get("level") == Some(&json!("ERROR")) => Some(
                        object
                            .get("messages")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(" "),
                    ),
                    _ => None,
                });
        }
        if let Some(message) = message {
            errors.push(ConvexRecentError {
                identifier,
                udf_type,
                timestamp,
                message: message.chars().take(2000).collect(),
                request_id,
            });
        }
    }
    errors
}

async fn query(access: &ConvexDeploymentAccess, path: &str, args: Value) -> Result<Value, String> {
    access.run_function("query", path, args).await
}

pub(crate) async fn environment(
    access: &ConvexDeploymentAccess,
) -> Result<BTreeMap<String, String>, String> {
    let value = access
        .json(
            reqwest::Method::GET,
            "api/v1/list_environment_variables",
            None,
        )
        .await?;
    serde_json::from_value(
        value
            .get("environmentVariables")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .map_err(|_| "Convex hat unerwartete Umgebungsvariablen geliefert.".into())
}

async fn instance_name(access: &ConvexDeploymentAccess) -> Option<String> {
    let response = access
        .request(reqwest::Method::GET, "instance_name")
        .ok()?
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let text = response.text().await.ok()?;
    let text = text.trim();
    (!text.is_empty() && text.len() <= 200).then(|| text.to_string())
}

fn record<T>(errors: &mut Vec<String>, label: &str, result: Result<T, String>) -> Option<T> {
    result
        .map_err(|error| errors.push(format!("{label}: {error}")))
        .ok()
}

pub(crate) async fn info(access: &ConvexDeploymentAccess) -> ConvexSettingsInfo {
    let (state, version, node, name, deployment_info, canonical, providers, components) = tokio::join!(
        query(
            access,
            "_system/frontend/deploymentState:deploymentState",
            json!({})
        ),
        query(access, "_system/frontend/getVersion", json!({})),
        query(access, "_system/frontend/node:version", json!({})),
        instance_name(access),
        access.json(reqwest::Method::GET, "api/v1/deployment_info", None),
        access.json(reqwest::Method::GET, "api/v1/get_canonical_urls", None),
        query(access, "_system/frontend/listAuthProviders", json!({})),
        query(access, "_system/frontend/components:list", json!({})),
    );
    let mut errors = Vec::new();
    let canonical = canonical.ok();
    let text = |value: &Value, key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let array = |value: Option<Value>| match value {
        Some(Value::Array(items)) => items,
        _ => Vec::new(),
    };
    ConvexSettingsInfo {
        url: access.url.as_str().trim_end_matches('/').to_string(),
        site_url: site_url(
            &access.url,
            canonical
                .as_ref()
                .and_then(|value| value.get("convexSiteUrl"))
                .and_then(Value::as_str),
        ),
        cloud_url: canonical
            .as_ref()
            .and_then(|value| text(value, "convexCloudUrl")),
        state: record(&mut errors, "Status", state).and_then(|value| text(&value, "state")),
        version: record(&mut errors, "Version", version)
            .and_then(|value| value.as_str().map(str::to_string)),
        node_version: node
            .ok()
            .and_then(|value| value.as_str().map(str::to_string)),
        instance_name: name,
        kind: deployment_info.ok().and_then(|value| text(&value, "kind")),
        auth_providers: array(record(&mut errors, "Auth-Provider", providers)),
        components: array(record(&mut errors, "Komponenten", components)),
        errors,
    }
}

pub(crate) async fn stats(access: &ConvexDeploymentAccess) -> ConvexSettingsStats {
    let (tables, documents, modules, files, scheduled, crons) = tokio::join!(
        query(access, "_system/frontend/getTableMapping", json!({})),
        query(
            access,
            "_system/frontend/tableSize:sizeOfAllTables",
            json!({})
        ),
        query(access, "_system/frontend/modules:list", json!({})),
        query(access, "_system/frontend/fileStorageV2:numFiles", json!({})),
        query(
            access,
            "_system/frontend/paginatedScheduledJobs",
            json!({"paginationOpts": {"numItems": SCHEDULED_SAMPLE, "cursor": null}}),
        ),
        query(access, "_system/frontend/listCronJobs", json!({})),
    );
    let mut result = ConvexSettingsStats::default();
    let mut errors = Vec::new();
    result.table_count = record(&mut errors, "Tabellen", tables).map(|value| {
        value
            .as_object()
            .map(|map| {
                map.values()
                    .filter_map(Value::as_str)
                    .filter(|name| !name.starts_with('_'))
                    .count() as u64
            })
            .unwrap_or(0)
    });
    result.document_count = record(&mut errors, "Dokumente", documents)
        .and_then(|value| value.as_f64().map(|n| n as u64));
    if let Some(modules) = record(&mut errors, "Funktionen", modules) {
        let functions: Vec<&Value> = modules
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|module| module.get(1)?.get("functions")?.as_array())
            .flatten()
            .collect();
        let http = functions
            .iter()
            .filter(|function| function.get("udfType") == Some(&json!("HttpAction")))
            .count() as u64;
        result.http_route_count = Some(http);
        result.function_count = Some(functions.len() as u64 - http);
    }
    result.file_count =
        record(&mut errors, "Dateien", files).and_then(|value| value.as_f64().map(|n| n as u64));
    if let Some(page) = record(&mut errors, "Geplante Funktionen", scheduled) {
        result.scheduled_pending = page
            .get("page")
            .and_then(Value::as_array)
            .map(|items| items.len() as u64);
        result.scheduled_has_more = page.get("isDone") == Some(&json!(false));
    }
    result.cron_count = record(&mut errors, "Cronjobs", crons)
        .and_then(|value| value.as_array().map(|items| items.len() as u64));
    result.errors = errors;
    result
}

pub(crate) async fn load_recent_errors(
    access: &ConvexDeploymentAccess,
) -> Result<Vec<ConvexRecentError>, String> {
    let response = access
        .request(reqwest::Method::GET, "api/stream_function_logs?cursor=0")?
        .timeout(Duration::from_secs(4))
        .send()
        .await;
    let response = match response {
        Ok(response) => response,
        Err(error) if error.is_timeout() => return Ok(Vec::new()),
        Err(_) => return Err("Convex-Deployment ist nicht erreichbar.".into()),
    };
    let status = response.status();
    let text = match response.text().await {
        Ok(text) => text,
        Err(error) if error.is_timeout() => return Ok(Vec::new()),
        Err(_) => return Err("Convex hat keine Antwort geliefert.".into()),
    };
    if !status.is_success() {
        return Err(convex_error(status.as_u16(), &text));
    }
    let value: Value = serde_json::from_str(&text)
        .map_err(|_| "Convex hat unerwartete Logs geliefert.".to_string())?;
    Ok(recent_errors(
        value
            .get("entries")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default(),
    ))
}

async fn apply_environment(
    access: &ConvexDeploymentAccess,
    changes: &[(String, Option<String>)],
) -> Result<(), String> {
    if changes.is_empty() {
        return Ok(());
    }
    let changes: Vec<Value> = changes
        .iter()
        .map(|(name, value)| json!({"name": name, "value": value}))
        .collect();
    access
        .json(
            reqwest::Method::POST,
            "api/v1/update_environment_variables",
            Some(&json!({ "changes": changes })),
        )
        .await
        .map(|_| ())
}

pub(crate) async fn import_environment(
    access: &ConvexDeploymentAccess,
    text: &str,
    overwrite: bool,
) -> Result<ConvexEnvImportResult, String> {
    let parsed = parse_dotenv(text)?;
    if parsed.is_empty() {
        return Err("Keine Variablen im Text gefunden.".into());
    }
    let existing = if overwrite {
        BTreeMap::new()
    } else {
        environment(access).await?
    };
    let mut result = ConvexEnvImportResult::default();
    let mut changes = Vec::new();
    for (name, value) in parsed {
        if existing.contains_key(&name) {
            result.skipped.push(name);
        } else {
            result.applied.push(name.clone());
            changes.push((name, Some(value)));
        }
    }
    apply_environment(access, &changes).await?;
    Ok(result)
}

pub(crate) async fn request_export(
    access: &ConvexDeploymentAccess,
    include_storage: bool,
) -> Result<(), String> {
    access
        .json(
            reqwest::Method::POST,
            &format!("api/export/request/zip?includeStorage={include_storage}"),
            None,
        )
        .await
        .map(|_| ())
}

pub(crate) async fn export_status(access: &ConvexDeploymentAccess) -> Result<Value, String> {
    query(access, "_system/cli/exports:getLatest", json!({})).await
}

pub(crate) async fn download_export(
    access: &ConvexDeploymentAccess,
    path: PathBuf,
) -> Result<(), String> {
    let latest = export_status(access).await?;
    if latest.get("state").and_then(Value::as_str) != Some("completed") {
        return Err("Es gibt keinen abgeschlossenen Export.".into());
    }
    let start = latest
        .get("start_ts")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty() && value.len() <= 30 && value.bytes().all(|b| b.is_ascii_digit())
        })
        .ok_or_else(|| "Convex hat einen ungültigen Export geliefert.".to_string())?;
    let response = crate::baas_file::download_client()
        .get(access.endpoint(&format!("api/export/zip/{start}"))?)
        .header("Authorization", format!("Convex {}", access.token))
        .header("Convex-Client", super::CONVEX_CLIENT)
        .send()
        .await
        .map_err(|_| "Convex-Deployment ist nicht erreichbar.".to_string())?;
    crate::baas_file::save_response(response, path).await
}

fn import_format(path: &Path) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "zip" => Ok("zip"),
        "jsonl" | "ndjson" => Ok("jsonLines"),
        "json" => Ok("jsonArray"),
        "csv" => Ok("csv"),
        _ => Err("Unterstützt werden .zip, .jsonl, .json und .csv.".into()),
    }
}

fn import_spec(format: &str, mode: &str, table_name: Option<&str>) -> Result<Value, String> {
    if !matches!(mode, "append" | "replace" | "requireEmpty") {
        return Err("Ungültiger Importmodus.".into());
    }
    match (
        format,
        table_name.map(str::trim).filter(|name| !name.is_empty()),
    ) {
        ("zip", None) => Ok(json!({"format": "zip", "mode": mode})),
        ("zip", Some(_)) => Err("Ein ZIP-Snapshot enthält seine Tabellen selbst.".into()),
        (_, Some(name)) if valid_table_name(name) => {
            Ok(json!({"format": format, "mode": mode, "tableName": name}))
        }
        (_, Some(_)) => Err("Ungültiger Tabellenname.".into()),
        (_, None) => Err("Für JSONL, JSON und CSV wird eine Zieltabelle benötigt.".into()),
    }
}

pub(crate) async fn start_import(
    access: &ConvexDeploymentAccess,
    path: &Path,
    mode: &str,
    table_name: Option<&str>,
) -> Result<String, String> {
    let spec = import_spec(import_format(path)?, mode, table_name)?;
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "Datei konnte nicht geöffnet werden.".to_string())?;
    let size = file
        .metadata()
        .await
        .map_err(|_| "Datei konnte nicht gelesen werden.".to_string())?
        .len();
    if size == 0 || size > MAX_IMPORT_BYTES {
        return Err("Die Datei ist leer oder größer als 1 GB.".into());
    }
    let started = access
        .json(
            reqwest::Method::POST,
            "api/import/start_upload",
            Some(&json!({})),
        )
        .await?;
    let token = started
        .get("uploadToken")
        .and_then(Value::as_str)
        .ok_or_else(|| "Convex hat keinen Upload-Token geliefert.".to_string())?
        .to_string();
    let mut parts = Vec::new();
    let mut buffer = vec![0_u8; IMPORT_PART_BYTES];
    loop {
        let mut filled = 0;
        while filled < buffer.len() {
            let read = file
                .read(&mut buffer[filled..])
                .await
                .map_err(|_| "Datei konnte nicht gelesen werden.".to_string())?;
            if read == 0 {
                break;
            }
            filled += read;
        }
        if filled == 0 {
            break;
        }
        let mut url = access.endpoint("api/import/upload_part")?;
        url.query_pairs_mut()
            .append_pair("uploadToken", &token)
            .append_pair("partNumber", &(parts.len() + 1).to_string());
        let response = crate::baas_file::upload_client()
            .post(url)
            .header("Authorization", format!("Convex {}", access.token))
            .header("Convex-Client", super::CONVEX_CLIENT)
            .body(buffer[..filled].to_vec())
            .send()
            .await
            .map_err(|_| "Upload zu Convex fehlgeschlagen.".to_string())?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|_| "Convex hat keine Antwort geliefert.".to_string())?;
        if !status.is_success() {
            return Err(convex_error(status.as_u16(), &text));
        }
        parts.push(
            serde_json::from_str::<Value>(&text)
                .map_err(|_| "Convex hat einen ungültigen Teil-Token geliefert.".to_string())?,
        );
        if filled < buffer.len() {
            break;
        }
    }
    let finished = access
        .json(
            reqwest::Method::POST,
            "api/import/finish_upload",
            Some(&json!({"import": spec, "uploadToken": token, "partTokens": parts})),
        )
        .await?;
    finished
        .get("importId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Convex hat keine Import-ID geliefert.".into())
}

fn checked_import_id(import_id: &str) -> Result<&str, String> {
    valid_import_id(import_id)
        .then_some(import_id)
        .ok_or_else(|| "Ungültige Import-ID.".into())
}

async fn studio(
    id: &str,
    project_id: u64,
    deployment_name: &str,
) -> Result<ConvexDeploymentAccess, String> {
    deployment(id, project_id, deployment_name).await
}

#[tauri::command]
pub async fn convex_studio_settings_info(
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<ConvexSettingsInfo, String> {
    Ok(info(&studio(&id, project_id, &deployment_name).await?).await)
}

#[tauri::command]
pub async fn convex_studio_settings_stats(
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<ConvexSettingsStats, String> {
    Ok(stats(&studio(&id, project_id, &deployment_name).await?).await)
}

#[tauri::command]
pub async fn convex_studio_settings_recent_errors(
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<Vec<ConvexRecentError>, String> {
    load_recent_errors(&studio(&id, project_id, &deployment_name).await?).await
}

#[tauri::command]
pub async fn convex_studio_settings_env_reveal(
    id: String,
    project_id: u64,
    deployment_name: String,
    name: String,
) -> Result<Option<String>, String> {
    if !valid_env_name(&name) {
        return Err("Ungültiger Name der Umgebungsvariable.".into());
    }
    let access = studio(&id, project_id, &deployment_name).await?;
    Ok(environment(&access).await?.remove(&name))
}

#[tauri::command]
pub async fn convex_studio_settings_env_import(
    id: String,
    project_id: u64,
    deployment_name: String,
    text: String,
    overwrite: bool,
) -> Result<ConvexEnvImportResult, String> {
    let access = studio(&id, project_id, &deployment_name).await?;
    import_environment(&access, &text, overwrite).await
}

#[tauri::command]
pub async fn convex_studio_settings_env_export(
    app: tauri::AppHandle,
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<Option<String>, String> {
    let access = studio(&id, project_id, &deployment_name).await?;
    let variables = environment(&access).await?;
    let Some(path) = crate::baas_file::pick_save_path(app, ".env").await? else {
        return Ok(None);
    };
    tokio::fs::write(&path, format_dotenv(&variables))
        .await
        .map_err(|_| "Datei konnte nicht geschrieben werden.".to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn convex_studio_settings_set_paused(
    id: String,
    project_id: u64,
    deployment_name: String,
    paused: bool,
) -> Result<(), String> {
    let access = studio(&id, project_id, &deployment_name).await?;
    let path = if paused {
        "api/v1/pause_deployment"
    } else {
        "api/v1/unpause_deployment"
    };
    access
        .json(reqwest::Method::POST, path, Some(&json!({})))
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn convex_studio_settings_export_request(
    id: String,
    project_id: u64,
    deployment_name: String,
    include_storage: bool,
) -> Result<(), String> {
    request_export(
        &studio(&id, project_id, &deployment_name).await?,
        include_storage,
    )
    .await
}

#[tauri::command]
pub async fn convex_studio_settings_export_status(
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<Value, String> {
    export_status(&studio(&id, project_id, &deployment_name).await?).await
}

#[tauri::command]
pub async fn convex_studio_settings_export_download(
    app: tauri::AppHandle,
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<Option<String>, String> {
    let access = studio(&id, project_id, &deployment_name).await?;
    let name = format!(
        "convex-snapshot-{}.zip",
        access.url.host_str().unwrap_or("deployment")
    );
    let Some(path) = crate::baas_file::pick_save_path(app, &name).await? else {
        return Ok(None);
    };
    download_export(&access, path.clone()).await?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn convex_studio_settings_import_start(
    app: tauri::AppHandle,
    id: String,
    project_id: u64,
    deployment_name: String,
    mode: String,
    table_name: Option<String>,
) -> Result<Option<String>, String> {
    let access = studio(&id, project_id, &deployment_name).await?;
    let Some(path) = crate::baas_file::pick_open_path(app).await? else {
        return Ok(None);
    };
    start_import(&access, &path, &mode, table_name.as_deref())
        .await
        .map(Some)
}

#[tauri::command]
pub async fn convex_studio_settings_import_status(
    id: String,
    project_id: u64,
    deployment_name: String,
    import_id: String,
) -> Result<Value, String> {
    let import_id = checked_import_id(&import_id)?;
    let access = studio(&id, project_id, &deployment_name).await?;
    query(
        &access,
        "_system/cli/queryImport",
        json!({ "importId": import_id }),
    )
    .await
}

#[tauri::command]
pub async fn convex_studio_settings_import_confirm(
    id: String,
    project_id: u64,
    deployment_name: String,
    import_id: String,
) -> Result<(), String> {
    let import_id = checked_import_id(&import_id)?;
    let access = studio(&id, project_id, &deployment_name).await?;
    access
        .json(
            reqwest::Method::POST,
            "api/perform_import",
            Some(&json!({ "importId": import_id })),
        )
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn convex_studio_settings_import_cancel(
    id: String,
    project_id: u64,
    deployment_name: String,
    import_id: String,
) -> Result<(), String> {
    let import_id = checked_import_id(&import_id)?;
    let access = studio(&id, project_id, &deployment_name).await?;
    access
        .json(
            reqwest::Method::POST,
            "api/cancel_import",
            Some(&json!({ "importId": import_id })),
        )
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dotenv_parses_common_syntax() {
        let parsed = parse_dotenv(
            "# comment\n\nexport A=1\nB = two words # note\nC=\"line\\nnext \\\"q\\\"\"\nD='lit $x'\nE=\"multi\nline\"\nA=3\nF=\n",
        )
        .unwrap();
        assert_eq!(
            parsed,
            vec![
                ("B".into(), "two words".into()),
                ("C".into(), "line\nnext \"q\"".into()),
                ("D".into(), "lit $x".into()),
                ("E".into(), "multi\nline".into()),
                ("A".into(), "3".into()),
                ("F".into(), "".into()),
            ]
        );
    }

    #[test]
    fn dotenv_rejects_invalid_input() {
        assert!(parse_dotenv("1A=x").unwrap_err().contains("Zeile 1"));
        assert!(parse_dotenv("A=1\nnoequals")
            .unwrap_err()
            .contains("Zeile 2"));
        assert!(parse_dotenv("A=\"open").is_err());
        assert!(parse_dotenv(&format!("A={}", "x".repeat(MAX_ENV_VALUE + 1))).is_err());
        assert!(parse_dotenv(&"A=1\n".repeat(MAX_ENV_TEXT)).is_err());
    }

    #[test]
    fn dotenv_round_trips() {
        let variables = BTreeMap::from([
            ("A".to_string(), "plain".to_string()),
            (
                "B".to_string(),
                "with space # and \"quote\" \\ back".to_string(),
            ),
            ("C".to_string(), "multi\nline".to_string()),
            ("D".to_string(), String::new()),
        ]);
        let text = format_dotenv(&variables);
        let parsed: BTreeMap<String, String> = parse_dotenv(&text).unwrap().into_iter().collect();
        assert_eq!(parsed, variables);
    }

    #[test]
    fn site_urls_follow_deployment_kind() {
        let cloud = reqwest::Url::parse("https://happy-otter-123.convex.cloud/").unwrap();
        assert_eq!(
            site_url(&cloud, None),
            "https://happy-otter-123.convex.site"
        );
        let local = reqwest::Url::parse("http://127.0.0.1:3210/").unwrap();
        assert_eq!(site_url(&local, Some("")), "http://127.0.0.1:3210/http");
        assert_eq!(
            site_url(&local, Some("https://site.example/")),
            "https://site.example"
        );
    }

    #[test]
    fn recent_errors_are_bounded_and_newest_first() {
        let mut entries: Vec<Value> = (0..30)
            .map(|index| {
                json!({"kind": "Completion", "identifier": format!("f{index}"), "timestamp": index,
                    "error": format!("boom {index}"), "logLines": []})
            })
            .collect();
        entries.push(json!({"identifier": "ok", "error": null, "logLines": ["[LOG] fine"]}));
        entries.push(json!({"identifier": "logged", "error": null,
            "logLines": [{"level": "ERROR", "messages": ["'bad'", "'x'"]}]}));
        entries.push(json!({"identifier": "plain", "logLines": ["[ERROR] 'oops'"]}));
        let errors = recent_errors(&entries);
        assert_eq!(errors.len(), MAX_RECENT_ERRORS);
        assert_eq!(errors[0].message, "'oops'");
        assert_eq!(errors[1].message, "'bad' 'x'");
        assert_eq!(errors[2].identifier, "f29");
    }

    #[test]
    fn import_specs_are_validated() {
        assert_eq!(import_format(Path::new("/x/a.ZIP")).unwrap(), "zip");
        assert_eq!(import_format(Path::new("a.ndjson")).unwrap(), "jsonLines");
        assert!(import_format(Path::new("a.txt")).is_err());
        assert!(import_spec("zip", "append", None).is_ok());
        assert!(import_spec("zip", "append", Some("t")).is_err());
        assert!(import_spec("csv", "replace", None).is_err());
        assert!(import_spec("csv", "replace", Some("_storage")).is_err());
        assert!(import_spec("csv", "drop", Some("t")).is_err());
        assert_eq!(
            import_spec("jsonLines", "requireEmpty", Some(" users ")).unwrap()["tableName"],
            "users"
        );
        assert!(valid_import_id("km292dnhtxttyqqe0zcyz3zefd8gs14f"));
        assert!(!valid_import_id("../x"));
    }

    async fn live_access() -> Option<(tempfile::TempDir, String, ConvexDeploymentAccess)> {
        let (Some(url), Some(key)) = (
            crate::baas_self_hosted_live_tests::env("L8DB_E2E_CONVEX_URL"),
            crate::baas_self_hosted_live_tests::env("L8DB_E2E_CONVEX_KEY"),
        ) else {
            return None;
        };
        let secrets = crate::baas_self_hosted_live_tests::isolate_secrets();
        let profile = crate::convex::convex_connect_self_hosted(url, key)
            .await
            .unwrap();
        let access = deployment(&profile.id, 0, "").await.unwrap();
        Some((secrets, profile.id, access))
    }

    async fn wait_import(access: &ConvexDeploymentAccess, import_id: &str, want: &str) -> Value {
        for _ in 0..120 {
            let status = query(
                access,
                "_system/cli/queryImport",
                json!({ "importId": import_id }),
            )
            .await
            .unwrap();
            let state = status["state"]["state"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            if state == want {
                return status;
            }
            assert_ne!(state, "failed", "{status}");
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        panic!("import did not reach {want}");
    }

    #[tokio::test]
    #[ignore]
    async fn live_convex_settings_round_trip() {
        let Some((_secrets, id, access)) = live_access().await else {
            return;
        };
        let info = convex_studio_settings_info(id.clone(), 0, String::new())
            .await
            .unwrap();
        assert_eq!(info.state.as_deref(), Some("running"));
        assert!(info.version.is_some(), "{:?}", info.errors);
        assert!(info.errors.is_empty(), "{:?}", info.errors);
        assert_eq!(info.site_url, format!("{}/http", info.url));
        let stats = convex_studio_settings_stats(id.clone(), 0, String::new())
            .await
            .unwrap();
        assert!(stats.errors.is_empty(), "{:?}", stats.errors);
        assert!(stats.table_count.unwrap() >= 4);
        assert!(stats.function_count.unwrap() >= 10);
        assert!(stats.cron_count.unwrap() >= 2);
        let _ = access
            .run_function("action", "actions:fail", json!({}))
            .await;
        let errors = load_recent_errors(&access).await.unwrap();
        assert!(errors.len() <= MAX_RECENT_ERRORS);
        assert!(errors
            .iter()
            .any(|error| error.identifier == "actions:fail"));

        crate::baas_self_hosted_live_tests::latency("convex settings info", 500, || async {
            assert!(super::info(&access).await.errors.is_empty());
        })
        .await;
        crate::baas_self_hosted_live_tests::latency("convex settings stats", 500, || async {
            assert!(super::stats(&access).await.errors.is_empty());
        })
        .await;
        crate::baas_self_hosted_live_tests::latency(
            "convex settings recent errors",
            500,
            || async {
                load_recent_errors(&access).await.unwrap();
            },
        )
        .await;

        apply_environment(
            &access,
            &[("L8DB_SETTINGS_B".into(), Some("bleibt".into()))],
        )
        .await
        .unwrap();
        let result = convex_studio_settings_env_import(
            id.clone(),
            0,
            String::new(),
            "L8DB_SETTINGS_A=\"eins zwei\"\nL8DB_SETTINGS_B=overwritten\n".into(),
            false,
        )
        .await
        .unwrap();
        assert_eq!(result.applied, vec!["L8DB_SETTINGS_A".to_string()]);
        assert_eq!(result.skipped, vec!["L8DB_SETTINGS_B".to_string()]);
        assert_eq!(
            convex_studio_settings_env_reveal(
                id.clone(),
                0,
                String::new(),
                "L8DB_SETTINGS_A".into()
            )
            .await
            .unwrap()
            .as_deref(),
            Some("eins zwei")
        );
        assert!(format_dotenv(&environment(&access).await.unwrap())
            .contains("L8DB_SETTINGS_A=\"eins zwei\"\n"));
        apply_environment(
            &access,
            &[
                ("L8DB_SETTINGS_A".into(), None),
                ("L8DB_SETTINGS_B".into(), None),
            ],
        )
        .await
        .unwrap();
        assert_eq!(
            convex_studio_settings_env_reveal(
                id.clone(),
                0,
                String::new(),
                "L8DB_SETTINGS_A".into()
            )
            .await
            .unwrap(),
            None
        );

        let table = "l8db_settings_live";
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("rows.jsonl");
        tokio::fs::write(&file, "{\"n\":1}\n{\"n\":2}\n")
            .await
            .unwrap();
        let cancelled = start_import(&access, &file, "append", Some(table))
            .await
            .unwrap();
        let waiting = wait_import(&access, &cancelled, "waiting_for_confirmation").await;
        assert_eq!(waiting["checkpoints"][0]["total_num_rows_to_write"], "2");
        convex_studio_settings_import_cancel(id.clone(), 0, String::new(), cancelled.clone())
            .await
            .unwrap();
        wait_import(&access, &cancelled, "failed").await;
        let import_id = start_import(&access, &file, "append", Some(table))
            .await
            .unwrap();
        wait_import(&access, &import_id, "waiting_for_confirmation").await;
        convex_studio_settings_import_confirm(id.clone(), 0, String::new(), import_id.clone())
            .await
            .unwrap();
        wait_import(&access, &import_id, "completed").await;
        let count = query(
            &access,
            "_system/frontend/tableSize:default",
            json!({"tableName": table}),
        )
        .await
        .unwrap();
        assert_eq!(count.as_f64(), Some(2.0));
        access
            .json(
                reqwest::Method::POST,
                "api/delete_tables",
                Some(&json!({"tableNames": [table], "componentId": null})),
            )
            .await
            .unwrap();

        request_export(&access, false).await.unwrap();
        let mut completed = false;
        for _ in 0..120 {
            let status = export_status(&access).await.unwrap();
            if status["state"] == "completed" {
                completed = true;
                break;
            }
            assert_ne!(status["state"], "failed", "{status}");
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        assert!(completed);
        let target = directory.path().join("snapshot.zip");
        download_export(&access, target.clone()).await.unwrap();
        let bytes = tokio::fs::read(&target).await.unwrap();
        assert!(bytes.starts_with(b"PK"));

        if crate::baas_self_hosted_live_tests::env("L8DB_E2E_CONVEX_PAUSE").is_some() {
            convex_studio_settings_set_paused(id.clone(), 0, String::new(), true)
                .await
                .unwrap();
            let paused = super::info(&access).await.state;
            convex_studio_settings_set_paused(id.clone(), 0, String::new(), false)
                .await
                .unwrap();
            assert_eq!(paused.as_deref(), Some("paused"));
            assert_eq!(super::info(&access).await.state.as_deref(), Some("running"));
        }
        crate::convex::convex_disconnect(id).await.unwrap();
    }
}
