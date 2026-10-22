use super::{checked, management, MANAGEMENT_API};
use crate::supabase::{
    client, cloud_ref, database_execute, database_query, management_get, project_api_auth,
    project_secret_key, project_url, quote_identifier, token, validate_ref,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 5 * 1024 * 1024;
const MAX_SOURCE_BYTES: usize = 20 * 1024 * 1024;
const MAX_DEPLOY_FILES: usize = 1000;
const MAX_DEPLOY_BYTES: u64 = 20 * 1024 * 1024;
const MAX_SECRETS: usize = 1000;
const MAX_REALTIME_MESSAGE: usize = 1024 * 1024;
const MAX_REALTIME_PUSH: usize = 256 * 1024;
const PUBLICATION_PAGE: u32 = 100;
const HEARTBEAT: Duration = Duration::from_secs(25);
const SKIPPED_SCHEMAS: &str = "'pg_catalog','information_schema','auth','storage','realtime','_realtime','supabase_functions','supabase_migrations','extensions','graphql','graphql_public','vault','pgsodium','pgsodium_masks','net','cron','pgbouncer','_analytics','pgmq','_supavisor'";

struct RealtimeSession {
    topic: String,
    sender: mpsc::Sender<String>,
}

static SESSIONS: LazyLock<Mutex<HashMap<String, RealtimeSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PUSH_REF: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseEdgeSecret {
    pub name: String,
    pub value: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SupabaseEdgeSourceFile {
    pub path: String,
    pub content: Option<String>,
    pub size: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct SupabaseEdgeSource {
    pub format: String,
    pub files: Vec<SupabaseEdgeSourceFile>,
    pub size: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct SupabaseEdgeInvokeResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub size: usize,
    pub truncated: bool,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseRealtimeChange {
    pub event: String,
    pub schema: String,
    pub table: Option<String>,
    pub filter: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SupabaseRealtimeEvent {
    Status {
        status: String,
        detail: Option<String>,
    },
    Message {
        event: String,
        payload: Value,
        received_at: u64,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseRealtimePublication {
    pub all_tables: bool,
    pub insert: bool,
    pub update: bool,
    pub delete: bool,
    pub truncate: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseRealtimeTable {
    pub schema: String,
    pub name: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseRealtimeTablesPage {
    pub publication: Option<SupabaseRealtimePublication>,
    pub tables: Vec<SupabaseRealtimeTable>,
    #[serde(default)]
    pub has_more: bool,
}

fn validate_slug(slug: &str) -> Result<&str, String> {
    if slug.is_empty()
        || slug.len() > 128
        || !slug
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Ungültiger Supabase-Function-Slug.".into());
    }
    Ok(slug)
}

fn validate_secret_name(name: &str) -> Result<&str, String> {
    let mut bytes = name.bytes();
    let valid = name.len() <= 256
        && bytes
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic() || first == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
    if !valid {
        return Err("Secret-Namen bestehen aus Buchstaben, Ziffern und _ und beginnen nicht mit einer Ziffer.".into());
    }
    if name.to_ascii_uppercase().starts_with("SUPABASE_") {
        return Err("Secrets mit dem Präfix SUPABASE_ sind reserviert.".into());
    }
    Ok(name)
}

fn validate_relative_path(raw: &str) -> Result<String, String> {
    let parts = raw
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != ".")
        .collect::<Vec<_>>();
    if parts.is_empty()
        || raw.len() > 512
        || parts
            .iter()
            .any(|part| *part == ".." || part.contains(':') || part.contains('\0'))
    {
        return Err(format!("Ungültiger relativer Pfad: {raw}"));
    }
    Ok(parts.join("/"))
}

fn source_path(raw: &str) -> Option<String> {
    validate_relative_path(raw.strip_prefix("file://").unwrap_or(raw)).ok()
}

fn validate_session(session: &str) -> Result<&str, String> {
    if session.is_empty()
        || session.len() > 64
        || !session
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Ungültige Realtime-Sitzung.".into());
    }
    Ok(session)
}

fn validate_channel(channel: &str) -> Result<&str, String> {
    let channel = channel.trim();
    if channel.is_empty()
        || channel.chars().count() > 200
        || channel.chars().any(char::is_control)
        || channel.starts_with("realtime:")
    {
        return Err("Ungültiger Kanalname.".into());
    }
    Ok(channel)
}

fn validate_event_name(event: &str) -> Result<&str, String> {
    if event.is_empty() || event.chars().count() > 200 || event.chars().any(char::is_control) {
        return Err("Ungültiger Event-Name.".into());
    }
    Ok(event)
}

fn validate_changes(changes: &[SupabaseRealtimeChange]) -> Result<Vec<Value>, String> {
    if changes.len() > 20 {
        return Err("Höchstens 20 Postgres-Change-Filter.".into());
    }
    changes
        .iter()
        .map(|change| {
            if !matches!(change.event.as_str(), "*" | "INSERT" | "UPDATE" | "DELETE") {
                return Err("Ungültiges Postgres-Event.".to_string());
            }
            quote_identifier(&change.schema)?;
            let mut entry = json!({"event": change.event, "schema": change.schema});
            if let Some(table) = change.table.as_deref().filter(|table| !table.is_empty()) {
                quote_identifier(table)?;
                entry["table"] = json!(table);
            }
            if let Some(filter) = change.filter.as_deref().map(str::trim) {
                if filter.len() > 300 || filter.chars().any(char::is_control) {
                    return Err("Ungültiger Realtime-Filter.".to_string());
                }
                if !filter.is_empty() {
                    entry["filter"] = json!(filter);
                }
            }
            Ok(entry)
        })
        .collect()
}

fn is_jwt(key: &str) -> bool {
    key.starts_with("eyJ") && key.split('.').count() == 3
}

fn join_message(
    topic: &str,
    changes: Vec<Value>,
    presence_key: &str,
    private: bool,
    key: &str,
) -> Value {
    let mut payload = json!({
        "config": {
            "broadcast": {"self": true, "ack": true},
            "presence": {"key": presence_key, "enabled": true},
            "postgres_changes": changes,
            "private": private
        }
    });
    if is_jwt(key) {
        payload["access_token"] = json!(key);
    }
    json!({"topic": topic, "event": "phx_join", "payload": payload, "ref": "1", "join_ref": "1"})
}

fn push_message(topic: &str, kind: &str, event: &str, payload: Value) -> Result<Value, String> {
    let reference = PUSH_REF.fetch_add(1, Ordering::Relaxed).to_string();
    let (event_name, body) = match kind {
        "broadcast" => (
            "broadcast",
            json!({"type": "broadcast", "event": validate_event_name(event)?, "payload": payload}),
        ),
        "track" => (
            "presence",
            json!({"type": "presence", "event": "track", "payload": payload}),
        ),
        "untrack" => ("presence", json!({"type": "presence", "event": "untrack"})),
        _ => return Err("Unbekannte Realtime-Aktion.".into()),
    };
    Ok(
        json!({"topic": topic, "event": event_name, "payload": body, "ref": reference, "join_ref": "1"}),
    )
}

fn split_multipart<'a>(body: &'a [u8], boundary: &str) -> Vec<(String, &'a [u8])> {
    let delimiter = format!("--{boundary}").into_bytes();
    let mut positions = Vec::new();
    let mut index = 0;
    while let Some(found) = find(&body[index..], &delimiter) {
        positions.push(index + found);
        index += found + delimiter.len();
    }
    positions
        .windows(2)
        .filter_map(|pair| {
            let part = &body[pair[0] + delimiter.len()..pair[1]];
            let part = part.strip_prefix(b"\r\n").unwrap_or(part);
            let part = part.strip_suffix(b"\r\n").unwrap_or(part);
            let split = find(part, b"\r\n\r\n")?;
            Some((
                String::from_utf8_lossy(&part[..split]).into_owned(),
                &part[split + 4..],
            ))
        })
        .collect()
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn part_path(headers: &str) -> Option<String> {
    let mut filename = None;
    for line in headers.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        if name == "supabase-path" {
            return source_path(value.trim());
        }
        if name == "content-disposition" {
            filename = value.split(';').find_map(|item| {
                item.trim()
                    .strip_prefix("filename=")
                    .map(|value| value.trim_matches('"').to_string())
            });
        }
    }
    filename.and_then(|value| source_path(&value))
}

fn source_parts<'a>(content_type: &str, body: &'a [u8]) -> Option<Vec<(String, &'a [u8])>> {
    let boundary = content_type
        .split(';')
        .find_map(|item| item.trim().strip_prefix("boundary="))
        .map(|value| value.trim_matches('"'))
        .filter(|_| content_type.starts_with("multipart/"))?;
    Some(
        split_multipart(body, boundary)
            .into_iter()
            .filter_map(|(headers, data)| Some((part_path(&headers)?, data)))
            .collect(),
    )
}

fn parse_source(content_type: &str, body: &[u8]) -> SupabaseEdgeSource {
    match source_parts(content_type, body) {
        Some(parts) => SupabaseEdgeSource {
            format: "files".into(),
            files: parts
                .into_iter()
                .map(|(path, data)| SupabaseEdgeSourceFile {
                    path,
                    content: std::str::from_utf8(data).ok().map(str::to_string),
                    size: data.len(),
                })
                .collect(),
            size: body.len(),
        },
        None => SupabaseEdgeSource {
            format: "eszip".into(),
            files: Vec::new(),
            size: body.len(),
        },
    }
}

fn publication_sql() -> String {
    format!(
        "select json_build_object(
            'publication', (select json_build_object('all_tables', p.puballtables, 'insert', p.pubinsert, 'update', p.pubupdate, 'delete', p.pubdelete, 'truncate', p.pubtruncate) from pg_publication p where p.pubname = 'supabase_realtime'),
            'tables', coalesce((select json_agg(t) from (
                select n.nspname as schema, c.relname as name,
                    exists(select 1 from pg_publication p where p.pubname = 'supabase_realtime' and p.puballtables)
                    or exists(select 1 from pg_publication_rel r join pg_publication p on p.oid = r.prpubid where p.pubname = 'supabase_realtime' and r.prrelid = c.oid) as enabled
                from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where c.relkind in ('r', 'p') and not c.relispartition
                    and n.nspname not in ({SKIPPED_SCHEMAS}) and n.nspname not like 'pg\\_%'
                    and ($1 = '' or n.nspname || '.' || c.relname ilike '%' || $1 || '%')
                order by 1, 2 limit {} offset $2
            ) t), '[]'::json)
        ) as page",
        PUBLICATION_PAGE + 1
    )
}

fn publication_toggle_sql(
    schema: &str,
    table: &str,
    enabled: bool,
    exists: bool,
) -> Result<String, String> {
    let target = format!("{}.{}", quote_identifier(schema)?, quote_identifier(table)?);
    Ok(match (enabled, exists) {
        (true, false) => format!("create publication supabase_realtime for table {target}"),
        (true, true) => format!("alter publication supabase_realtime add table {target}"),
        (false, _) => format!("alter publication supabase_realtime drop table {target}"),
    })
}

fn publication_actions_sql(insert: bool, update: bool, delete: bool, truncate: bool) -> String {
    let actions = [
        ("insert", insert),
        ("update", update),
        ("delete", delete),
        ("truncate", truncate),
    ]
    .into_iter()
    .filter(|(_, enabled)| *enabled)
    .map(|(name, _)| name)
    .collect::<Vec<_>>()
    .join(", ");
    format!("alter publication supabase_realtime set (publish = '{actions}')")
}

async fn read_bounded(
    response: &mut reqwest::Response,
    limit: usize,
) -> Result<(Vec<u8>, usize, bool), String> {
    let mut body = Vec::new();
    let mut size = 0;
    let mut truncated = false;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Antwort konnte nicht vollständig gelesen werden.".to_string())?
    {
        size += chunk.len();
        let room = limit.saturating_sub(body.len());
        if chunk.len() > room {
            body.extend_from_slice(&chunk[..room]);
            truncated = true;
            break;
        }
        body.extend_from_slice(&chunk);
    }
    Ok((body, size, truncated))
}

async fn fetch_source(reference: &str, slug: &str) -> Result<(String, Vec<u8>), String> {
    let reference = cloud_ref(reference)?;
    let slug = validate_slug(slug)?;
    let response = crate::baas_file::download_client()
        .get(format!(
            "{MANAGEMENT_API}/projects/{reference}/functions/{slug}/body"
        ))
        .bearer_auth(token().await?)
        .header(reqwest::header::ACCEPT, "multipart/form-data")
        .send()
        .await
        .map_err(|error| format!("Supabase ist nicht erreichbar: {error}"))?;
    let mut response = checked(response, "Quellcode konnte nicht geladen werden.").await?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let (body, _, truncated) = read_bounded(&mut response, MAX_SOURCE_BYTES).await?;
    if truncated {
        return Err("Der Quellcode ist größer als 20 MB.".into());
    }
    Ok((content_type, body))
}

async fn pick_folder(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = sender.send(path);
    });
    receiver
        .await
        .map_err(|_| "Ordnerdialog wurde unterbrochen.".to_string())?
        .map(|path| {
            path.into_path()
                .map_err(|_| "Ordnerpfad konnte nicht gelesen werden.".to_string())
        })
        .transpose()
}

fn collect_files(root: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let mut files = Vec::new();
    let mut total = 0;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let entries = std::fs::read_dir(&directory)
            .map_err(|_| "Ordner konnte nicht gelesen werden.".to_string())?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if name.starts_with('.') || name == "node_modules" || kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                pending.push(path);
                continue;
            }
            total += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            if files.len() >= MAX_DEPLOY_FILES || total > MAX_DEPLOY_BYTES {
                return Err("Der Ordner enthält mehr als 1000 Dateien oder 20 MB.".into());
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "Ungültiger Dateipfad.".to_string())?
                .components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            files.push((relative, path));
        }
    }
    files.sort();
    Ok(files)
}

#[tauri::command]
pub async fn supabase_studio_edge_function(
    reference: String,
    slug: String,
) -> Result<Value, String> {
    let reference = cloud_ref(&reference)?;
    let slug = validate_slug(&slug)?;
    management_get(
        &token().await?,
        &format!("projects/{reference}/functions/{slug}"),
    )
    .await
}

#[tauri::command]
pub async fn supabase_studio_edge_function_source(
    reference: String,
    slug: String,
) -> Result<SupabaseEdgeSource, String> {
    let (content_type, body) = fetch_source(&reference, &slug).await?;
    Ok(parse_source(&content_type, &body))
}

#[tauri::command]
pub async fn supabase_studio_edge_function_download(
    app: tauri::AppHandle,
    reference: String,
    slug: String,
) -> Result<Option<String>, String> {
    let (content_type, body) = fetch_source(&reference, &slug).await?;
    let Some(folder) = pick_folder(&app).await? else {
        return Ok(None);
    };
    let target = folder.join(&slug);
    let files = source_parts(&content_type, &body)
        .unwrap_or_else(|| vec![(format!("{slug}.eszip"), body.as_slice())]);
    for (relative, data) in files {
        let path = target.join(relative);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|_| "Zielordner konnte nicht erstellt werden.".to_string())?;
        }
        tokio::fs::write(&path, data)
            .await
            .map_err(|_| "Datei konnte nicht geschrieben werden.".to_string())?;
    }
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn supabase_studio_edge_function_deploy(
    app: tauri::AppHandle,
    reference: String,
    slug: String,
    name: String,
    entrypoint: String,
    import_map: Option<String>,
    verify_jwt: bool,
) -> Result<Option<Value>, String> {
    let reference = cloud_ref(&reference)?.to_string();
    let slug = validate_slug(&slug)?.to_string();
    let entrypoint = validate_relative_path(entrypoint.trim())?;
    let import_map = import_map
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(validate_relative_path)
        .transpose()?;
    let name = name.trim();
    if name.chars().count() > 100 {
        return Err("Der Name darf höchstens 100 Zeichen lang sein.".into());
    }
    let access_token = token().await?;
    let Some(folder) = pick_folder(&app).await? else {
        return Ok(None);
    };
    let files = tokio::task::spawn_blocking(move || collect_files(&folder))
        .await
        .map_err(|_| "Ordner konnte nicht gelesen werden.".to_string())??;
    for required in std::iter::once(&entrypoint).chain(import_map.as_ref()) {
        if !files.iter().any(|(relative, _)| relative == required) {
            return Err(format!(
                "{required} wurde im gewählten Ordner nicht gefunden."
            ));
        }
    }
    let metadata = json!({
        "entrypoint_path": entrypoint,
        "import_map_path": import_map,
        "name": if name.is_empty() { slug.as_str() } else { name },
        "verify_jwt": verify_jwt
    });
    let mut form = reqwest::multipart::Form::new().text("metadata", metadata.to_string());
    for (relative, path) in files {
        let data = tokio::fs::read(&path)
            .await
            .map_err(|_| format!("{relative} konnte nicht gelesen werden."))?;
        let mime = mime_guess::from_path(&path).first_or_octet_stream();
        form = form.part(
            "file",
            reqwest::multipart::Part::bytes(data)
                .file_name(relative)
                .mime_str(mime.as_ref())
                .map_err(|_| "Ungültiger Dateityp.".to_string())?,
        );
    }
    let mut url = reqwest::Url::parse(&format!(
        "{MANAGEMENT_API}/projects/{reference}/functions/deploy"
    ))
    .map_err(|_| "Ungültige Supabase-URL.".to_string())?;
    url.query_pairs_mut().append_pair("slug", &slug);
    let response = crate::baas_file::upload_client()
        .post(url)
        .bearer_auth(access_token)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Supabase ist nicht erreichbar: {error}"))?;
    let response = checked(response, "Deployment fehlgeschlagen.").await?;
    response
        .json()
        .await
        .map(Some)
        .map_err(|_| "Supabase hat unerwartete Daten geliefert.".into())
}

#[tauri::command]
pub async fn supabase_studio_edge_function_update(
    reference: String,
    slug: String,
    name: String,
    verify_jwt: bool,
) -> Result<Value, String> {
    let reference = cloud_ref(&reference)?;
    let slug = validate_slug(&slug)?;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err("Der Name muss 1 bis 100 Zeichen lang sein.".into());
    }
    management(
        reqwest::Method::PATCH,
        &format!("projects/{reference}/functions/{slug}"),
        Some(json!({"name": name, "verify_jwt": verify_jwt})),
        "Einstellungen konnten nicht gespeichert werden.",
    )
    .await?
    .json()
    .await
    .map_err(|_| "Supabase hat unerwartete Daten geliefert.".into())
}

#[tauri::command]
pub async fn supabase_studio_edge_secrets(
    reference: String,
) -> Result<Vec<SupabaseEdgeSecret>, String> {
    let reference = cloud_ref(&reference)?;
    let mut secrets: Vec<SupabaseEdgeSecret> =
        management_get(&token().await?, &format!("projects/{reference}/secrets")).await?;
    secrets.sort_by(|left, right| left.name.cmp(&right.name));
    secrets.truncate(MAX_SECRETS);
    Ok(secrets)
}

#[tauri::command]
pub async fn supabase_studio_edge_secret_set(
    reference: String,
    name: String,
    value: String,
) -> Result<(), String> {
    let reference = cloud_ref(&reference)?;
    let name = validate_secret_name(name.trim())?;
    if value.is_empty() || value.len() > 64 * 1024 {
        return Err("Der Wert muss 1 Byte bis 64 KB groß sein.".into());
    }
    management(
        reqwest::Method::POST,
        &format!("projects/{reference}/secrets"),
        Some(json!([{"name": name, "value": value}])),
        "Secret konnte nicht gespeichert werden.",
    )
    .await
    .map(|_| ())
}

#[tauri::command]
pub async fn supabase_studio_edge_secret_delete(
    reference: String,
    name: String,
) -> Result<(), String> {
    let reference = cloud_ref(&reference)?;
    let name = validate_secret_name(&name)?;
    management(
        reqwest::Method::DELETE,
        &format!("projects/{reference}/secrets"),
        Some(json!([name])),
        "Secret konnte nicht gelöscht werden.",
    )
    .await
    .map(|_| ())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn supabase_studio_edge_invoke(
    reference: String,
    slug: String,
    method: String,
    path: String,
    query: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    auth: String,
    bearer: Option<String>,
) -> Result<SupabaseEdgeInvokeResponse, String> {
    let reference = validate_ref(&reference)?;
    let slug = validate_slug(&slug)?;
    let method = match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD" => {
            reqwest::Method::from_bytes(method.as_bytes())
                .map_err(|_| "Ungültige HTTP-Methode.".to_string())?
        }
        _ => return Err("Ungültige HTTP-Methode.".into()),
    };
    if headers.len() > 50 || query.len() > 4096 || query.contains('#') {
        return Err("Zu viele Header oder ungültiger Query-String.".into());
    }
    if body
        .as_ref()
        .is_some_and(|body| body.len() > MAX_REQUEST_BYTES)
    {
        return Err("Der Request-Body darf höchstens 5 MB groß sein.".into());
    }
    let mut url = project_url(reference, "functions/v1/").await?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "Ungültige Supabase-URL.".to_string())?;
        segments.pop_if_empty().push(slug);
        for segment in path.split('/').filter(|segment| !segment.is_empty()) {
            if segment == "." || segment == ".." || segment.contains(['?', '#', '\\']) {
                return Err("Ungültiger Pfad.".into());
            }
            segments.push(segment);
        }
    }
    let query = query.trim().trim_start_matches('?');
    if !query.is_empty() {
        url.set_query(Some(query));
    }
    let mut request = crate::baas_file::upload_client().request(method, url);
    request = match auth.as_str() {
        "project" => project_api_auth(request, &project_secret_key(reference).await?),
        "bearer" => {
            let bearer = bearer
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Bitte einen Bearer-Token angeben.".to_string())?;
            let request = match project_secret_key(reference).await {
                Ok(key) => request.header("apikey", key),
                Err(_) => request,
            };
            request.bearer_auth(bearer)
        }
        "none" => request,
        _ => return Err("Unbekannte Authentifizierung.".into()),
    };
    for (name, value) in &headers {
        let name = reqwest::header::HeaderName::from_bytes(name.trim().as_bytes())
            .map_err(|_| format!("Ungültiger Header: {name}"))?;
        if matches!(
            name.as_str(),
            "host" | "content-length" | "connection" | "transfer-encoding"
        ) {
            return Err(format!("Der Header {name} kann nicht gesetzt werden."));
        }
        let value = reqwest::header::HeaderValue::from_str(value)
            .map_err(|_| format!("Ungültiger Wert für Header {name}."))?;
        request = request.header(name, value);
    }
    if let Some(body) = body.filter(|body| !body.is_empty()) {
        request = request.body(body);
    }
    let started = Instant::now();
    let mut response = request
        .send()
        .await
        .map_err(|error| format!("Edge Function ist nicht erreichbar: {error}"))?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .take(100)
        .map(|(name, value)| {
            (
                name.to_string(),
                String::from_utf8_lossy(value.as_bytes()).into_owned(),
            )
        })
        .collect();
    let (body, size, truncated) = read_bounded(&mut response, MAX_RESPONSE_BYTES).await?;
    Ok(SupabaseEdgeInvokeResponse {
        status,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
        size,
        truncated,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

async fn realtime_url(reference: &str, key: &str) -> Result<reqwest::Url, String> {
    let mut url = project_url(reference, "realtime/v1/websocket").await?;
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    url.set_scheme(scheme)
        .map_err(|_| "Ungültige Realtime-URL.".to_string())?;
    url.query_pairs_mut()
        .append_pair("apikey", key)
        .append_pair("vsn", "1.0.0");
    Ok(url)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn release_session(session: &str, sender: &mpsc::Sender<String>) {
    if let Ok(mut sessions) = SESSIONS.lock() {
        if sessions
            .get(session)
            .is_some_and(|current| current.sender.same_channel(sender))
        {
            sessions.remove(session);
        }
    }
}

pub(crate) async fn run_realtime<F>(
    reference: &str,
    session: &str,
    channel: &str,
    changes: &[SupabaseRealtimeChange],
    presence_key: &str,
    private: bool,
    emit: F,
) -> Result<(), String>
where
    F: Fn(SupabaseRealtimeEvent) -> bool,
{
    let reference = validate_ref(reference)?;
    let session = validate_session(session)?;
    let topic = format!("realtime:{}", validate_channel(channel)?);
    let changes = validate_changes(changes)?;
    if presence_key.chars().count() > 200 {
        return Err("Ungültiger Presence-Key.".into());
    }
    let (sender, mut receiver) = mpsc::channel::<String>(64);
    SESSIONS
        .lock()
        .map_err(|_| "Realtime nicht verfügbar.".to_string())?
        .insert(
            session.to_string(),
            RealtimeSession {
                topic: topic.clone(),
                sender: sender.clone(),
            },
        );
    let weak = sender.downgrade();
    drop(sender);
    let release = || {
        if let Some(sender) = weak.upgrade() {
            release_session(session, &sender);
        }
    };
    let closed = || weak.strong_count() == 0;
    emit(SupabaseRealtimeEvent::Status {
        status: "connecting".into(),
        detail: None,
    });
    let key = match project_secret_key(reference).await {
        Ok(key) => key,
        Err(error) => {
            release();
            return Err(error);
        }
    };
    let url = match realtime_url(reference, &key).await {
        Ok(url) => url,
        Err(error) => {
            release();
            return Err(error);
        }
    };
    if closed() {
        emit(SupabaseRealtimeEvent::Status {
            status: "closed".into(),
            detail: None,
        });
        return Ok(());
    }
    let config = WebSocketConfig::default().max_message_size(Some(MAX_REALTIME_MESSAGE));
    let connected = tokio::time::timeout(
        Duration::from_secs(15),
        tokio_tungstenite::connect_async_with_config(url.as_str(), Some(config), true),
    )
    .await;
    let socket = match connected {
        Ok(Ok((socket, _))) => socket,
        Ok(Err(error)) => {
            release();
            return Err(format!("Realtime-Verbindung fehlgeschlagen: {error}"));
        }
        Err(_) => {
            release();
            return Err("Realtime-Verbindung: Zeitüberschreitung.".into());
        }
    };
    let (mut writer, mut reader) = socket.split();
    let join = join_message(&topic, changes, presence_key, private, &key);
    if let Err(error) = writer.send(Message::text(join.to_string())).await {
        release();
        return Err(format!("Realtime-Kanal konnte nicht beitreten: {error}"));
    }
    emit(SupabaseRealtimeEvent::Status {
        status: "open".into(),
        detail: None,
    });
    let mut heartbeat =
        tokio::time::interval_at(tokio::time::Instant::now() + HEARTBEAT, HEARTBEAT);
    let mut detail = None;
    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                let beat = json!({"topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": PUSH_REF.fetch_add(1, Ordering::Relaxed).to_string()});
                if writer.send(Message::text(beat.to_string())).await.is_err() {
                    detail = Some("Heartbeat fehlgeschlagen.".to_string());
                    break;
                }
            }
            outgoing = receiver.recv() => {
                let Some(outgoing) = outgoing else {
                    let leave = json!({"topic": topic, "event": "phx_leave", "payload": {}, "ref": "leave", "join_ref": "1"});
                    let _ = writer.send(Message::text(leave.to_string())).await;
                    let _ = writer.send(Message::Close(None)).await;
                    break;
                };
                if writer.send(Message::text(outgoing)).await.is_err() {
                    detail = Some("Nachricht konnte nicht gesendet werden.".to_string());
                    break;
                }
            }
            incoming = reader.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else {
                            continue;
                        };
                        if value["topic"] == "phoenix" {
                            continue;
                        }
                        let event = value["event"].as_str().unwrap_or_default().to_string();
                        let delivered = emit(SupabaseRealtimeEvent::Message {
                            event,
                            payload: value["payload"].clone(),
                            received_at: now_ms(),
                        });
                        if !delivered {
                            break;
                        }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = writer.send(Message::Pong(data)).await;
                    }
                    Some(Ok(Message::Close(frame))) => {
                        detail = frame.map(|frame| frame.reason.to_string()).filter(|reason| !reason.is_empty());
                        break;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        detail = Some(error.to_string());
                        break;
                    }
                    None => break,
                }
            }
        }
    }
    release();
    emit(SupabaseRealtimeEvent::Status {
        status: "closed".into(),
        detail,
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn supabase_studio_edge_realtime_open(
    reference: String,
    session: String,
    channel: String,
    changes: Vec<SupabaseRealtimeChange>,
    presence_key: String,
    private: bool,
    events: Channel<SupabaseRealtimeEvent>,
) -> Result<(), String> {
    run_realtime(
        &reference,
        &session,
        &channel,
        &changes,
        &presence_key,
        private,
        |event| events.send(event).is_ok(),
    )
    .await
}

#[tauri::command]
pub async fn supabase_studio_edge_realtime_push(
    session: String,
    kind: String,
    event: String,
    payload: Value,
) -> Result<(), String> {
    let session = validate_session(&session)?;
    if payload.to_string().len() > MAX_REALTIME_PUSH {
        return Err("Die Nachricht darf höchstens 256 KB groß sein.".into());
    }
    let (topic, sender) = {
        let sessions = SESSIONS
            .lock()
            .map_err(|_| "Realtime nicht verfügbar.".to_string())?;
        let current = sessions
            .get(session)
            .ok_or_else(|| "Realtime-Kanal ist nicht verbunden.".to_string())?;
        (current.topic.clone(), current.sender.clone())
    };
    let message = push_message(&topic, &kind, &event, payload)?;
    sender
        .try_send(message.to_string())
        .map_err(|_| "Realtime-Kanal ist ausgelastet oder geschlossen.".into())
}

#[tauri::command]
pub async fn supabase_studio_edge_realtime_close(session: String) -> Result<(), String> {
    let session = validate_session(&session)?;
    SESSIONS
        .lock()
        .map_err(|_| "Realtime nicht verfügbar.".to_string())?
        .remove(session);
    Ok(())
}

#[tauri::command]
pub async fn supabase_studio_edge_realtime_broadcast(
    reference: String,
    channel: String,
    event: String,
    payload: Value,
    private: bool,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let channel = validate_channel(&channel)?;
    let event = validate_event_name(&event)?;
    if payload.to_string().len() > MAX_REALTIME_PUSH {
        return Err("Die Nachricht darf höchstens 256 KB groß sein.".into());
    }
    let response = project_api_auth(
        client().post(project_url(reference, "realtime/v1/api/broadcast").await?),
        &project_secret_key(reference).await?,
    )
    .json(&json!({"messages": [{"topic": channel, "event": event, "payload": payload, "private": private}]}))
    .send()
    .await
    .map_err(|error| format!("Supabase Realtime ist nicht erreichbar: {error}"))?;
    checked(response, "Broadcast fehlgeschlagen.")
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn supabase_studio_edge_publication_tables(
    reference: String,
    search: String,
    offset: u32,
) -> Result<SupabaseRealtimeTablesPage, String> {
    let reference = validate_ref(&reference)?;
    if offset > 1_000_000 || search.len() > 200 {
        return Err("Ungültige Seite oder Suche.".into());
    }
    let rows: Vec<Value> = database_query(
        reference,
        &publication_sql(),
        &[json!(search.trim()), json!(offset)],
    )
    .await?;
    let mut page: SupabaseRealtimeTablesPage = rows
        .into_iter()
        .next()
        .and_then(|row| serde_json::from_value(row["page"].clone()).ok())
        .ok_or_else(|| "Supabase hat unerwartete Daten geliefert.".to_string())?;
    page.has_more = page.tables.len() > PUBLICATION_PAGE as usize;
    page.tables.truncate(PUBLICATION_PAGE as usize);
    Ok(page)
}

#[tauri::command]
pub async fn supabase_studio_edge_publication_toggle(
    reference: String,
    schema: String,
    table: String,
    enabled: bool,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let rows = database_execute(
        reference,
        "select puballtables from pg_publication where pubname = 'supabase_realtime'",
        &[],
    )
    .await?;
    if rows
        .first()
        .is_some_and(|row| row["puballtables"] == json!(true))
    {
        return Err("Die Publikation umfasst alle Tabellen (FOR ALL TABLES).".into());
    }
    let sql = publication_toggle_sql(&schema, &table, enabled, !rows.is_empty())?;
    database_execute(reference, &sql, &[]).await.map(|_| ())
}

#[tauri::command]
pub async fn supabase_studio_edge_publication_actions(
    reference: String,
    insert: bool,
    update: bool,
    delete: bool,
    truncate: bool,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    database_execute(
        reference,
        &publication_actions_sql(insert, update, delete, truncate),
        &[],
    )
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_slugs_and_secret_names() {
        assert!(validate_slug("hello-world_1").is_ok());
        assert!(validate_slug("../x").is_err());
        assert!(validate_slug("").is_err());
        assert!(validate_secret_name("STRIPE_KEY").is_ok());
        assert!(validate_secret_name("_x1").is_ok());
        assert!(validate_secret_name("1X").is_err());
        assert!(validate_secret_name("A-B").is_err());
        assert!(validate_secret_name("supabase_url").is_err());
    }

    #[test]
    fn validates_relative_paths() {
        assert_eq!(
            validate_relative_path("./src//index.ts").unwrap(),
            "src/index.ts"
        );
        assert!(validate_relative_path("../index.ts").is_err());
        assert!(validate_relative_path("C:/x.ts").is_err());
        assert!(validate_relative_path("").is_err());
        assert_eq!(
            source_path("file:///tmp/a/index.ts").unwrap(),
            "tmp/a/index.ts"
        );
    }

    #[test]
    fn parses_multipart_source() {
        let body = b"--b1\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{\"entrypoint_path\":\"index.ts\"}\r\n--b1\r\nContent-Disposition: form-data; name=\"file\"; filename=\"source/index.ts\"\r\n\r\nDeno.serve(() => new Response('hi'))\r\n--b1\r\nSupabase-Path: lib/util.ts\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x\"\r\n\r\nexport {}\r\n--b1--\r\n";
        let source = parse_source("multipart/form-data; boundary=b1", body);
        assert_eq!(source.format, "files");
        assert_eq!(source.files.len(), 2);
        assert_eq!(source.files[0].path, "source/index.ts");
        assert_eq!(
            source.files[0].content.as_deref(),
            Some("Deno.serve(() => new Response('hi'))")
        );
        assert_eq!(source.files[1].path, "lib/util.ts");
        assert_eq!(
            parse_source("application/octet-stream", b"ESZIP").format,
            "eszip"
        );
    }

    #[test]
    fn builds_realtime_messages() {
        let changes = validate_changes(&[SupabaseRealtimeChange {
            event: "INSERT".into(),
            schema: "public".into(),
            table: Some("todos".into()),
            filter: Some("id=eq.1".into()),
        }])
        .unwrap();
        let join = join_message("realtime:room", changes, "me", false, "sb_publishable_x");
        assert_eq!(join["event"], "phx_join");
        assert_eq!(
            join["payload"]["config"]["postgres_changes"][0]["table"],
            "todos"
        );
        assert!(join["payload"].get("access_token").is_none());
        assert!(
            join_message("realtime:room", vec![], "", true, "eyJa.b.c")["payload"]["access_token"]
                .is_string()
        );
        assert!(validate_changes(&[SupabaseRealtimeChange {
            event: "TRUNCATE".into(),
            schema: "public".into(),
            table: None,
            filter: None,
        }])
        .is_err());
        let push = push_message("realtime:room", "broadcast", "ping", json!({"a": 1})).unwrap();
        assert_eq!(push["payload"]["event"], "ping");
        assert_eq!(
            push_message("realtime:room", "track", "", json!({})).unwrap()["event"],
            "presence"
        );
        assert!(push_message("realtime:room", "nope", "", json!({})).is_err());
        assert!(validate_channel("realtime:x").is_err());
        assert!(validate_session("abc-123").is_ok());
        assert!(validate_session("a b").is_err());
    }

    #[test]
    fn builds_publication_sql() {
        assert_eq!(
            publication_toggle_sql("public", "a\"b", true, true).unwrap(),
            "alter publication supabase_realtime add table \"public\".\"a\"\"b\""
        );
        assert!(publication_toggle_sql("public", "t", true, false)
            .unwrap()
            .starts_with("create publication"));
        assert!(publication_toggle_sql("public", "", false, true).is_err());
        assert_eq!(
            publication_actions_sql(true, false, true, false),
            "alter publication supabase_realtime set (publish = 'insert, delete')"
        );
        assert!(publication_sql().contains("limit 101 offset $2"));
    }

    async fn wait_for(
        receiver: &mut mpsc::UnboundedReceiver<SupabaseRealtimeEvent>,
        predicate: impl Fn(&str, &Value) -> bool,
    ) -> (String, Value) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        let mut seen = Vec::new();
        loop {
            match tokio::time::timeout_at(deadline, receiver.recv()).await {
                Ok(Some(SupabaseRealtimeEvent::Message { event, payload, .. })) => {
                    if predicate(&event, &payload) {
                        return (event, payload);
                    }
                    seen.push(format!("{event} {payload}"));
                }
                Ok(Some(SupabaseRealtimeEvent::Status { status, detail })) => {
                    assert_ne!(status, "closed", "{detail:?} {seen:?}");
                }
                _ => panic!("timeout, seen {seen:?}"),
            }
        }
    }

    #[tokio::test]
    #[ignore]
    async fn supabase_studio_edge_live() {
        use crate::baas_self_hosted_live_tests::{env, isolate_secrets, latency};
        let (Some(url), Some(key)) = (env("L8DB_E2E_SUPABASE_URL"), env("L8DB_E2E_SUPABASE_KEY"))
        else {
            return;
        };
        let _secrets = isolate_secrets();
        let project =
            crate::supabase::supabase_connect_self_hosted(url.clone(), key, "Edge".into())
                .await
                .unwrap();
        let reference = project.reference.clone();

        assert!(supabase_studio_edge_secrets(reference.clone())
            .await
            .is_err());
        assert!(
            supabase_studio_edge_function(reference.clone(), "hello".into())
                .await
                .is_err()
        );

        let none = supabase_studio_edge_invoke(
            reference.clone(),
            "hello".into(),
            "POST".into(),
            "".into(),
            "".into(),
            vec![],
            Some("{}".into()),
            "none".into(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(none.status, 401);
        latency("edge invoke hello", 500, || async {
            let response = supabase_studio_edge_invoke(
                reference.clone(),
                "hello".into(),
                "POST".into(),
                "sub/path".into(),
                "a=1".into(),
                vec![("content-type".into(), "application/json".into())],
                Some("{\"name\":\"l8db\"}".into()),
                "project".into(),
                None,
            )
            .await
            .unwrap();
            assert!(response.status > 0 && response.size <= MAX_RESPONSE_BYTES);
        })
        .await;
        assert!(supabase_studio_edge_invoke(
            reference.clone(),
            "hello".into(),
            "TRACE".into(),
            "".into(),
            "".into(),
            vec![],
            None,
            "project".into(),
            None,
        )
        .await
        .is_err());

        let table = "l8db_edge_rt_live";
        database_execute(
            &reference,
            &format!("drop table if exists public.{table}; create table public.{table} (id bigint generated always as identity primary key, note text)"),
            &[],
        )
        .await
        .unwrap();
        supabase_studio_edge_publication_toggle(
            reference.clone(),
            "public".into(),
            table.into(),
            true,
        )
        .await
        .unwrap();
        let page = supabase_studio_edge_publication_tables(reference.clone(), table.into(), 0)
            .await
            .unwrap();
        assert!(page.publication.is_some());
        assert!(page
            .tables
            .iter()
            .any(|row| row.name == table && row.enabled));
        latency("edge publication tables", 500, || async {
            let page = supabase_studio_edge_publication_tables(reference.clone(), String::new(), 0)
                .await
                .unwrap();
            assert!(page.tables.len() <= PUBLICATION_PAGE as usize);
        })
        .await;

        let (sender, mut receiver) = mpsc::unbounded_channel();
        let socket_reference = reference.clone();
        let socket = tokio::spawn(async move {
            run_realtime(
                &socket_reference,
                "live-test",
                "l8db-live",
                &[SupabaseRealtimeChange {
                    event: "*".into(),
                    schema: "public".into(),
                    table: Some(table.into()),
                    filter: None,
                }],
                "tester",
                false,
                move |event| sender.send(event).is_ok(),
            )
            .await
        });
        let (_, reply) = wait_for(&mut receiver, |event, payload| {
            event == "phx_reply" && payload["response"]["postgres_changes"].is_array()
        })
        .await;
        assert_eq!(reply["status"], "ok", "{reply}");
        wait_for(&mut receiver, |event, payload| {
            event == "system" && payload["status"] == "ok"
        })
        .await;

        database_execute(
            &reference,
            &format!("insert into public.{table} (note) values ('hi')"),
            &[],
        )
        .await
        .unwrap();
        let (_, change) = wait_for(&mut receiver, |event, _| event == "postgres_changes").await;
        assert_eq!(change["data"]["record"]["note"], "hi");

        supabase_studio_edge_realtime_push(
            "live-test".into(),
            "broadcast".into(),
            "ping".into(),
            json!({"n": 1}),
        )
        .await
        .unwrap();
        let (_, broadcast) = wait_for(&mut receiver, |event, payload| {
            event == "broadcast" && payload["event"] == "ping"
        })
        .await;
        assert_eq!(broadcast["payload"]["n"], 1);

        supabase_studio_edge_realtime_broadcast(
            reference.clone(),
            "l8db-live".into(),
            "rest".into(),
            json!({"n": 2}),
            false,
        )
        .await
        .unwrap();
        wait_for(&mut receiver, |event, payload| {
            event == "broadcast" && payload["event"] == "rest"
        })
        .await;

        supabase_studio_edge_realtime_push(
            "live-test".into(),
            "track".into(),
            "".into(),
            json!({"user": "tester"}),
        )
        .await
        .unwrap();
        wait_for(&mut receiver, |event, payload| {
            event == "presence_diff" && payload["joins"]["tester"].is_object()
        })
        .await;

        supabase_studio_edge_realtime_close("live-test".into())
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(10), socket)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(supabase_studio_edge_realtime_push(
            "live-test".into(),
            "broadcast".into(),
            "x".into(),
            json!({})
        )
        .await
        .is_err());

        let (early_sender, mut early) = mpsc::unbounded_channel();
        let early_reference = reference.clone();
        let early_socket = tokio::spawn(async move {
            run_realtime(
                &early_reference,
                "early-close",
                "l8db-early",
                &[],
                "",
                false,
                move |event| early_sender.send(event).is_ok(),
            )
            .await
        });
        assert!(matches!(
            early.recv().await,
            Some(SupabaseRealtimeEvent::Status { status, .. }) if status == "connecting"
        ));
        supabase_studio_edge_realtime_close("early-close".into())
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(20), early_socket)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let mut statuses = Vec::new();
        while let Ok(event) = early.try_recv() {
            if let SupabaseRealtimeEvent::Status { status, .. } = event {
                statuses.push(status);
            }
        }
        assert_eq!(statuses.last().map(String::as_str), Some("closed"));
        assert!(!SESSIONS.lock().unwrap().contains_key("early-close"));

        supabase_studio_edge_publication_toggle(
            reference.clone(),
            "public".into(),
            table.into(),
            false,
        )
        .await
        .unwrap();
        let page = supabase_studio_edge_publication_tables(reference.clone(), table.into(), 0)
            .await
            .unwrap();
        assert!(page
            .tables
            .iter()
            .any(|row| row.name == table && !row.enabled));
        database_execute(&reference, &format!("drop table public.{table}"), &[])
            .await
            .unwrap();
    }
}
