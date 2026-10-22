use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use std::time::Duration;
use tokio_util::io::ReaderStream;

const TOKEN_ACCOUNT: &str = "baas:supabase:access-token";
const KEY_INDEX_ACCOUNT: &str = "baas:supabase:project-key-index";
const SELF_HOSTED_ACCOUNT: &str = "baas:supabase:self-hosted";
const SELF_HOSTED_PREFIX: &str = "self-";
const PUBLIC_REST_HEALTH: &str = "rest/v1/l8db_health_probe?limit=0";
const PUBLIC_TABLE_LIST: &str = "Mit Publishable/anon Key oder über eine Supabase-Cloud-URL gibt Supabase keine Tabellenliste heraus. Öffne eine Tabelle über ihren Namen, verbinde selbst gehostet mit einem Secret Key oder Supabase Cloud mit einem Zugangstoken.";
const SELF_HOSTED_HEALTH: [(&str, &str); 5] = [
    ("auth", "auth/v1/health"),
    ("db", "pg/health"),
    ("realtime", "realtime/v1/api/ping"),
    ("rest", "rest/v1/"),
    ("storage", "storage/v1/status"),
];

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("Supabase HTTP client")
    })
}

fn project_api_auth(request: reqwest::RequestBuilder, api_key: &str) -> reqwest::RequestBuilder {
    let request = request.header("apikey", api_key);
    if api_key.starts_with("eyJ") && api_key.split('.').count() == 3 {
        request.bearer_auth(api_key)
    } else {
        request
    }
}

fn jwt_role(api_key: &str) -> Option<String> {
    let parts = api_key.split('.').collect::<Vec<_>>();
    if parts.len() != 3 || !parts[0].starts_with("eyJ") || parts[2].is_empty() {
        return None;
    }
    let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())?;
    claims["role"].as_str().map(str::to_string)
}

fn validate_project_secret_key(api_key: &str) -> Result<(), String> {
    if api_key.starts_with("sb_secret_") && api_key.len() > "sb_secret_".len()
        || jwt_role(api_key).as_deref() == Some("service_role")
    {
        Ok(())
    } else {
        Err("Ein Supabase Secret API Key oder service_role Key wird benötigt.".into())
    }
}

fn project_key_is_secret(api_key: &str) -> Result<bool, String> {
    if validate_project_secret_key(api_key).is_ok() {
        return Ok(true);
    }
    if api_key.starts_with("sb_publishable_") && api_key.len() > "sb_publishable_".len()
        || jwt_role(api_key).as_deref() == Some("anon")
    {
        return Ok(false);
    }
    Err("Erwartet wird ein Publishable Key, anon Key, Secret API Key oder service_role Key.".into())
}

fn env_value(raw: &str) -> &str {
    let raw = raw.trim();
    let value = match raw.split_once('=') {
        Some((name, value))
            if !name.is_empty()
                && name.bytes().all(|byte| {
                    byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'
                }) =>
        {
            value.trim()
        }
        _ => raw,
    };
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(value)
}

fn validate_ref(reference: &str) -> Result<&str, String> {
    if reference.is_empty()
        || reference.len() > 80
        || !reference
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("Ungültige Supabase-Projektreferenz.".into());
    }
    Ok(reference)
}

fn is_self_hosted(reference: &str) -> bool {
    reference.starts_with(SELF_HOSTED_PREFIX)
}

fn self_hosted_base_url(raw: &str) -> Result<reqwest::Url, String> {
    crate::baas_file::origin_url(raw, "Supabase", "https://supabase.example.com")
}

fn cloud_ref(reference: &str) -> Result<&str, String> {
    let reference = validate_ref(reference)?;
    if is_self_hosted(reference) {
        return Err("Bei selbst gehosteten Supabase-Instanzen nicht verfügbar.".into());
    }
    Ok(reference)
}

fn self_hosted_reference(url: &reqwest::Url) -> String {
    let digest = Sha256::digest(url.as_str().as_bytes());
    let hex: String = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("{SELF_HOSTED_PREFIX}{hex}")
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SelfHostedProject {
    reference: String,
    name: String,
    url: String,
    #[serde(default = "secret_key_default")]
    secret_key: bool,
}

fn secret_key_default() -> bool {
    true
}

impl From<SelfHostedProject> for SupabaseProject {
    fn from(project: SelfHostedProject) -> Self {
        SupabaseProject {
            id: project.reference.clone(),
            reference: project.reference,
            name: project.name,
            region: None,
            status: Some(
                if project.secret_key {
                    "Secret Key"
                } else {
                    "Publishable Key"
                }
                .into(),
            ),
            organization_id: None,
            database: None,
            self_hosted: true,
            api_url: Some(project.url),
            secret_key: project.secret_key,
        }
    }
}

async fn self_hosted_projects() -> Result<Vec<SelfHostedProject>, String> {
    match crate::db::secrets::load_secret(SELF_HOSTED_ACCOUNT.to_string()).await? {
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|_| "Ungültiger Index selbst gehosteter Supabase-Instanzen.".into()),
        None => Ok(Vec::new()),
    }
}

async fn save_self_hosted_projects(projects: &[SelfHostedProject]) -> Result<(), String> {
    crate::db::secrets::store_secret(
        SELF_HOSTED_ACCOUNT.to_string(),
        serde_json::to_string(projects)
            .map_err(|_| "Supabase-Instanzen konnten nicht gespeichert werden.")?,
    )
    .await
}

async fn self_hosted_project(reference: &str) -> Result<SelfHostedProject, String> {
    self_hosted_projects()
        .await?
        .into_iter()
        .find(|project| project.reference == reference)
        .ok_or_else(|| "Selbst gehostete Supabase-Instanz nicht gefunden.".to_string())
}

impl SelfHostedProject {
    fn pg_meta(&self) -> bool {
        self.secret_key
            && self_hosted_base_url(&self.url)
                .map(|base| cloud_reference_of(&base).is_none())
                .unwrap_or(false)
    }
}

async fn uses_pg_meta(reference: &str) -> Result<bool, String> {
    Ok(!is_self_hosted(reference) || self_hosted_project(reference).await?.pg_meta())
}

fn cloud_reference_of(base: &reqwest::Url) -> Option<&str> {
    base.host_str()?
        .strip_suffix(".supabase.co")
        .filter(|reference| {
            reference.len() == 20
                && reference
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn cloud_project_url(reference: &str) -> Result<reqwest::Url, String> {
    reqwest::Url::parse(&format!("https://{reference}.supabase.co/"))
        .map_err(|_| "Ungültige Supabase-URL.".to_string())
}

async fn project_url(reference: &str, path: &str) -> Result<reqwest::Url, String> {
    let reference = validate_ref(reference)?;
    let base = if is_self_hosted(reference) {
        self_hosted_base_url(&self_hosted_project(reference).await?.url)?
    } else {
        cloud_project_url(reference)?
    };
    base.join(path)
        .map_err(|_| "Ungültige Supabase-URL.".to_string())
}

fn project_key_account(reference: &str) -> String {
    format!("baas:supabase:{reference}:project-key")
}

fn validate_object_key(key: &str) -> Result<&str, String> {
    if key.is_empty()
        || key.len() > 1024
        || key.contains('\\')
        || key
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("Ungültiger Storage-Dateipfad.".into());
    }
    Ok(key)
}

fn validate_bucket(bucket: &str) -> Result<&str, String> {
    if bucket.is_empty()
        || bucket.len() > 256
        || bucket.contains('/')
        || bucket.contains('\\')
        || bucket == "."
        || bucket == ".."
    {
        return Err("Ungültiger Bucket-Name.".into());
    }
    Ok(bucket)
}

async fn project_key_index() -> Result<Vec<String>, String> {
    let raw = crate::db::secrets::load_secret(KEY_INDEX_ACCOUNT.to_string()).await?;
    match raw {
        Some(raw) => {
            serde_json::from_str(&raw).map_err(|_| "Ungültiger Supabase-Schlüsselindex.".into())
        }
        None => Ok(Vec::new()),
    }
}

async fn save_project_key_index(references: &[String]) -> Result<(), String> {
    crate::db::secrets::store_secret(
        KEY_INDEX_ACCOUNT.to_string(),
        serde_json::to_string(references)
            .map_err(|_| "Schlüsselindex konnte nicht gespeichert werden.")?,
    )
    .await
}

async fn token() -> Result<String, String> {
    crate::db::secrets::load_secret(TOKEN_ACCOUNT.to_string())
        .await?
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Supabase ist noch nicht verbunden.".to_string())
}

async fn response_json<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, String> {
    let status = response.status();
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 => "Zugangstoken oder API-Schlüssel ungültig.",
            403 => "Für diese Ressource fehlen Berechtigungen.",
            404 => "Ressource nicht gefunden.",
            429 => "Supabase-Limit erreicht. Bitte später erneut versuchen.",
            _ => "Anfrage fehlgeschlagen.",
        };
        return Err(format!("Supabase HTTP {}: {hint}", status.as_u16()));
    }
    response
        .json::<T>()
        .await
        .map_err(|_| "Supabase hat unerwartete Daten geliefert.".into())
}

async fn management_get<T: serde::de::DeserializeOwned>(
    access_token: &str,
    path: &str,
) -> Result<T, String> {
    let url = format!("https://api.supabase.com/v1/{path}");
    let response = client()
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("Supabase ist nicht erreichbar: {error}"))?;
    response_json(response).await
}

async fn database_query<T: serde::de::DeserializeOwned>(
    reference: &str,
    query: &str,
    parameters: &[serde_json::Value],
) -> Result<Vec<T>, String> {
    let reference = validate_ref(reference)?;
    if is_self_hosted(reference) {
        let response = project_api_auth(
            client().post(project_url(reference, "pg/query").await?),
            &project_secret_key(reference).await?,
        )
        .json(&serde_json::json!({"query": query, "parameters": parameters}))
        .send()
        .await
        .map_err(|error| format!("Supabase-Datenbank ist nicht erreichbar: {error}"))?;
        return response_json(response).await;
    }
    let response = client()
        .post(format!(
            "https://api.supabase.com/v1/projects/{reference}/database/query"
        ))
        .bearer_auth(token().await?)
        .json(&serde_json::json!({
            "query": query,
            "parameters": parameters,
            "read_only": true
        }))
        .send()
        .await
        .map_err(|error| format!("Supabase-Datenbank ist nicht erreichbar: {error}"))?;
    response_json(response).await
}

fn quote_identifier(value: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 128 || value.contains('\0') {
        return Err("Ungültiger Datenbankname.".into());
    }
    Ok(format!("\"{}\"", value.replace('"', "\"\"")))
}

fn table_rows_sql(schema: &str, table: &str, offset: u32) -> Result<String, String> {
    if offset > 1_000_000 {
        return Err("Ungültiger Zeilen-Offset.".into());
    }
    Ok(format!(
        "SELECT * FROM {}.{} LIMIT 51 OFFSET {offset}",
        quote_identifier(schema)?,
        quote_identifier(table)?
    ))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseDatabase {
    pub host: Option<String>,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseProject {
    pub id: String,
    #[serde(rename(deserialize = "ref"))]
    pub reference: String,
    pub name: String,
    pub region: Option<String>,
    pub status: Option<String>,
    pub organization_id: Option<String>,
    pub database: Option<SupabaseDatabase>,
    #[serde(default)]
    pub self_hosted: bool,
    #[serde(default)]
    pub api_url: Option<String>,
    #[serde(default)]
    pub secret_key: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseBucket {
    pub id: String,
    pub name: String,
    pub public: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    #[serde(rename(deserialize = "type"))]
    pub kind: Option<String>,
    pub file_size_limit: Option<u64>,
    pub allowed_mime_types: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseFunction {
    pub id: Option<String>,
    pub slug: String,
    pub name: Option<String>,
    pub status: Option<String>,
    pub version: Option<i64>,
    pub verify_jwt: Option<bool>,
    pub entrypoint_path: Option<String>,
    pub import_map_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseObject {
    pub name: String,
    pub id: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub last_accessed_at: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseServiceHealth {
    pub name: String,
    pub healthy: bool,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseBackup {
    pub id: Option<i64>,
    pub is_physical_backup: Option<bool>,
    pub status: Option<String>,
    pub inserted_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabasePhysicalBackupData {
    pub earliest_physical_backup_date_unix: Option<i64>,
    pub latest_physical_backup_date_unix: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseBackups {
    pub pitr_enabled: Option<bool>,
    pub backups: Vec<SupabaseBackup>,
    pub physical_backup_data: Option<SupabasePhysicalBackupData>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseAuthUser {
    pub id: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub created_at: Option<String>,
    pub last_sign_in_at: Option<String>,
    pub email_confirmed_at: Option<String>,
    pub phone_confirmed_at: Option<String>,
    pub is_anonymous: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseAuthUsersPage {
    pub users: Vec<SupabaseAuthUser>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseTable {
    pub schema: String,
    pub name: String,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseColumn {
    pub name: String,
    pub data_type: String,
    pub is_nullable: String,
}

#[derive(Serialize)]
pub struct SupabaseTablesPage {
    pub tables: Vec<SupabaseTable>,
    pub has_more: bool,
}

#[derive(Serialize)]
pub struct SupabaseRowsPage {
    pub rows: Vec<SupabaseRow>,
    pub has_more: bool,
}

#[derive(Serialize)]
pub struct SupabaseRow {
    pub ordinal: u32,
    pub values: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize)]
struct SupabaseApiKey {
    api_key: Option<String>,
    #[serde(rename(deserialize = "type"))]
    kind: String,
    name: Option<String>,
}

fn select_project_key(keys: &[SupabaseApiKey]) -> Result<&str, String> {
    let modern = keys
        .iter()
        .filter(|key| key.kind == "secret")
        .filter_map(|key| {
            key.api_key
                .as_deref()
                .filter(|value| value.starts_with("sb_secret_"))
                .map(|value| (key.name.as_deref(), value))
        })
        .collect::<Vec<_>>();
    if let Some((_, value)) = modern.iter().find(|(name, _)| *name == Some("default")) {
        return Ok(value);
    }
    if modern.len() == 1 {
        return Ok(modern[0].1);
    }
    if modern.len() > 1 {
        return Err(
            "Mehrere Secret API Keys vorhanden. Bitte den gewünschten Schlüssel manuell eingeben."
                .into(),
        );
    }
    keys.iter()
        .find(|key| key.kind == "legacy" && key.name.as_deref() == Some("service_role"))
        .and_then(|key| key.api_key.as_deref())
        .filter(|value| validate_project_secret_key(value).is_ok())
        .ok_or_else(|| "Kein verwendbarer Secret API Key gefunden. Das Zugangstoken benötigt API Keys: Read und API Key Secrets: Read; alternativ den Schlüssel manuell eingeben.".into())
}

#[tauri::command]
pub async fn supabase_connect(access_token: String) -> Result<Vec<SupabaseProject>, String> {
    let access_token = access_token.trim();
    if access_token.is_empty() {
        return Err("Zugangstoken fehlt.".into());
    }
    let projects = management_get(access_token, "projects").await?;
    crate::db::secrets::store_secret(TOKEN_ACCOUNT.to_string(), access_token.to_string()).await?;
    Ok(projects)
}

#[tauri::command]
pub async fn supabase_connect_self_hosted(
    url: String,
    api_key: String,
    name: String,
) -> Result<SupabaseProject, String> {
    let base = self_hosted_base_url(env_value(&url))?;
    let api_key = env_value(&api_key);
    let secret_key = project_key_is_secret(api_key)?;
    let response = project_api_auth(
        client().get(
            base.join("auth/v1/settings")
                .map_err(|_| "Ungültige Supabase-URL.".to_string())?,
        ),
        api_key,
    )
    .send()
    .await
    .map_err(|error| format!("Supabase ist nicht erreichbar: {error}"))?;
    let _: serde_json::Value = response_json(response).await?;
    let name = name.trim();
    if name.chars().count() > 100 {
        return Err("Der Name darf höchstens 100 Zeichen lang sein.".into());
    }
    let project = SelfHostedProject {
        reference: self_hosted_reference(&base),
        name: if name.is_empty() {
            format!(
                "Supabase {}",
                &base[url::Position::BeforeHost..url::Position::AfterPort]
            )
        } else {
            name.to_string()
        },
        url: base.to_string(),
        secret_key,
    };
    crate::db::secrets::store_secret(project_key_account(&project.reference), api_key.to_string())
        .await?;
    let mut references = project_key_index().await?;
    if !references.contains(&project.reference) {
        references.push(project.reference.clone());
        save_project_key_index(&references).await?;
    }
    let mut projects = self_hosted_projects().await?;
    projects.retain(|item| item.reference != project.reference);
    projects.push(project.clone());
    save_self_hosted_projects(&projects).await?;
    Ok(project.into())
}

#[tauri::command]
pub async fn supabase_disconnect_self_hosted(reference: String) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    if !is_self_hosted(reference) {
        return Err("Keine selbst gehostete Supabase-Instanz.".into());
    }
    let mut projects = self_hosted_projects().await?;
    if !projects.iter().any(|item| item.reference == reference) {
        return Err("Selbst gehostete Supabase-Instanz nicht gefunden.".into());
    }
    crate::db::secrets::delete_secret(project_key_account(reference)).await?;
    let references = project_key_index().await?;
    save_project_key_index(
        &references
            .into_iter()
            .filter(|entry| entry != reference)
            .collect::<Vec<_>>(),
    )
    .await?;
    projects.retain(|item| item.reference != reference);
    save_self_hosted_projects(&projects).await
}

#[tauri::command]
pub async fn supabase_disconnect() -> Result<(), String> {
    let (self_hosted, cloud): (Vec<_>, Vec<_>) = project_key_index()
        .await?
        .into_iter()
        .partition(|reference| is_self_hosted(reference));
    for reference in cloud {
        crate::db::secrets::delete_secret(project_key_account(&reference)).await?;
    }
    save_project_key_index(&self_hosted).await?;
    crate::db::secrets::delete_secret(TOKEN_ACCOUNT.to_string()).await
}

#[tauri::command]
pub async fn supabase_is_connected() -> Result<bool, String> {
    Ok(crate::db::secrets::load_secret(TOKEN_ACCOUNT.to_string())
        .await?
        .is_some()
        || !self_hosted_projects().await?.is_empty())
}

#[tauri::command]
pub async fn supabase_projects() -> Result<Vec<SupabaseProject>, String> {
    let projects = match crate::db::secrets::load_secret(TOKEN_ACCOUNT.to_string())
        .await?
        .filter(|value| !value.is_empty())
    {
        Some(token) => management_get(&token, "projects").await,
        None => Ok(Vec::new()),
    };
    let self_hosted = self_hosted_projects().await?;
    if self_hosted.is_empty() {
        return projects;
    }
    let mut projects = projects.unwrap_or_default();
    projects.extend(self_hosted.into_iter().map(SupabaseProject::from));
    Ok(projects)
}

#[derive(Deserialize)]
struct SupabasePoolerConfig {
    db_host: String,
    db_user: String,
    db_name: String,
    database_type: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct SupabaseDatabaseEndpoint {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
}

fn database_endpoint(
    reference: &str,
    configs: Vec<SupabasePoolerConfig>,
) -> SupabaseDatabaseEndpoint {
    let valid = |value: &str| {
        !value.is_empty()
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    };
    configs
        .into_iter()
        .find(|config| {
            config.database_type.as_deref().unwrap_or("PRIMARY") == "PRIMARY"
                && valid(&config.db_host)
                && valid(&config.db_user)
                && valid(&config.db_name)
        })
        .map(|config| SupabaseDatabaseEndpoint {
            host: config.db_host,
            port: 5432,
            user: config.db_user,
            database: config.db_name,
        })
        .unwrap_or_else(|| SupabaseDatabaseEndpoint {
            host: format!("db.{reference}.supabase.co"),
            port: 5432,
            user: "postgres".into(),
            database: "postgres".into(),
        })
}

#[tauri::command]
pub async fn supabase_database_endpoint(
    reference: String,
) -> Result<SupabaseDatabaseEndpoint, String> {
    let reference = validate_ref(&reference)?;
    if is_self_hosted(reference) {
        let base = self_hosted_base_url(&self_hosted_project(reference).await?.url)?;
        if let Some(cloud) = cloud_reference_of(&base) {
            return Ok(database_endpoint(cloud, Vec::new()));
        }
        return Ok(SupabaseDatabaseEndpoint {
            host: base.host_str().unwrap_or("localhost").to_string(),
            port: 5432,
            user: "postgres.your-tenant-id".into(),
            database: "postgres".into(),
        });
    }
    let configs = management_get(
        &token().await?,
        &format!("projects/{reference}/config/database/pooler"),
    )
    .await
    .unwrap_or_default();
    Ok(database_endpoint(reference, configs))
}

#[tauri::command]
pub async fn supabase_buckets(reference: String) -> Result<Vec<SupabaseBucket>, String> {
    let reference = validate_ref(&reference)?;
    if is_self_hosted(reference) {
        let response = project_api_auth(
            client().get(project_url(reference, "storage/v1/bucket").await?),
            &project_secret_key(reference).await?,
        )
        .send()
        .await
        .map_err(|_| "Supabase Storage ist nicht erreichbar.".to_string())?;
        return response_json(response).await;
    }
    management_get(
        &token().await?,
        &format!("projects/{reference}/storage/buckets"),
    )
    .await
}

async fn bucket_details_url(reference: &str, bucket: &str) -> Result<reqwest::Url, String> {
    bucket_url(project_url(reference, "storage/v1/bucket").await?, bucket)
}

fn bucket_url(mut url: reqwest::Url, bucket: &str) -> Result<reqwest::Url, String> {
    let bucket = validate_bucket(bucket)?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Supabase-URL.".to_string())?
        .push(bucket);
    Ok(url)
}

#[tauri::command]
pub async fn supabase_bucket_details(
    reference: String,
    bucket: String,
) -> Result<SupabaseBucket, String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let api_key = crate::db::secrets::load_secret(project_key_account(reference))
        .await?
        .ok_or_else(|| {
            "Für Bucket-Details wird ein Supabase Secret API Key benötigt.".to_string()
        })?;
    let response = project_api_auth(
        client().get(bucket_details_url(reference, bucket).await?),
        &api_key,
    )
    .send()
    .await
    .map_err(|_| "Supabase Storage ist nicht erreichbar.".to_string())?;
    let details: SupabaseBucket = response_json(response).await?;
    if details.id != bucket {
        return Err("Supabase hat einen anderen Bucket zurückgegeben.".into());
    }
    Ok(details)
}

async fn project_secret_key(reference: &str) -> Result<String, String> {
    crate::db::secrets::load_secret(project_key_account(reference))
        .await?
        .ok_or_else(|| "Für diese Aktion wird ein Supabase Secret API Key benötigt.".into())
}

#[tauri::command]
pub async fn supabase_create_bucket(
    reference: String,
    name: String,
    public: bool,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let name = validate_bucket(&name)?;
    let key = project_secret_key(reference).await?;
    let response = project_api_auth(
        client().post(project_url(reference, "storage/v1/bucket").await?),
        &key,
    )
    .json(&serde_json::json!({"name": name, "id": name, "public": public}))
    .send()
    .await
    .map_err(|_| "Supabase Storage ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Supabase HTTP {}: Bucket konnte nicht erstellt werden.",
            response.status().as_u16()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn supabase_update_bucket_public(
    reference: String,
    bucket: String,
    public: bool,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let key = project_secret_key(reference).await?;
    let response = project_api_auth(
        client().put(bucket_details_url(reference, bucket).await?),
        &key,
    )
    .json(&serde_json::json!({"public": public}))
    .send()
    .await
    .map_err(|_| "Supabase Storage ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Supabase HTTP {}: Bucket konnte nicht geändert werden.",
            response.status().as_u16()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn supabase_delete_bucket(reference: String, bucket: String) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let key = project_secret_key(reference).await?;
    let response = project_api_auth(
        client().delete(bucket_details_url(reference, bucket).await?),
        &key,
    )
    .send()
    .await
    .map_err(|_| "Supabase Storage ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Supabase HTTP {}: Bucket konnte nicht gelöscht werden. Er muss leer sein.",
            response.status().as_u16()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn supabase_functions(reference: String) -> Result<Vec<SupabaseFunction>, String> {
    let reference = cloud_ref(&reference)?;
    management_get(&token().await?, &format!("projects/{reference}/functions")).await
}

#[tauri::command]
pub async fn supabase_delete_function(reference: String, slug: String) -> Result<(), String> {
    let reference = cloud_ref(&reference)?;
    if slug.is_empty()
        || slug.len() > 128
        || !slug
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Ungültiger Supabase-Function-Slug.".into());
    }
    let response = client()
        .delete(format!(
            "https://api.supabase.com/v1/projects/{reference}/functions/{slug}"
        ))
        .bearer_auth(token().await?)
        .send()
        .await
        .map_err(|_| "Supabase ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Supabase HTTP {}: Edge Function konnte nicht gelöscht werden.",
            response.status().as_u16()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn supabase_health(reference: String) -> Result<Vec<SupabaseServiceHealth>, String> {
    let reference = validate_ref(&reference)?;
    if is_self_hosted(reference) {
        let key = project_secret_key(reference).await?;
        let project = self_hosted_project(reference).await?;
        let base = self_hosted_base_url(&project.url)?;
        let mut checks = Vec::new();
        for (name, path) in SELF_HOSTED_HEALTH {
            if name == "db" && !project.pg_meta() {
                continue;
            }
            let public_rest = name == "rest" && !project.pg_meta();
            let url = base
                .join(if public_rest {
                    PUBLIC_REST_HEALTH
                } else {
                    path
                })
                .map_err(|_| "Ungültige Supabase-URL.".to_string())?;
            let key = key.clone();
            checks.push(async move {
                let status = match project_api_auth(client().get(url), &key).send().await {
                    Ok(response) if response.status().is_success() => None,
                    Ok(response) if public_rest && response.status().as_u16() == 404 => {
                        match response.text().await {
                            Ok(body) if body.contains("PGRST") => None,
                            _ => Some("HTTP 404".to_string()),
                        }
                    }
                    Ok(response) => Some(format!("HTTP {}", response.status().as_u16())),
                    Err(_) => Some("Nicht erreichbar".to_string()),
                };
                SupabaseServiceHealth {
                    name: name.to_string(),
                    healthy: status.is_none(),
                    status: status.unwrap_or_else(|| "ACTIVE_HEALTHY".into()),
                }
            });
        }
        return Ok(futures_util::future::join_all(checks).await);
    }
    management_get(
        &token().await?,
        &format!("projects/{reference}/health?services=auth&services=db&services=pooler&services=realtime&services=rest&services=storage"),
    )
    .await
}

#[tauri::command]
pub async fn supabase_backups(reference: String) -> Result<SupabaseBackups, String> {
    let reference = cloud_ref(&reference)?;
    management_get(
        &token().await?,
        &format!("projects/{reference}/database/backups"),
    )
    .await
}

#[tauri::command]
pub async fn supabase_tables(reference: String, offset: u32) -> Result<SupabaseTablesPage, String> {
    if offset > 100_000 {
        return Err("Ungültiger Tabellen-Offset.".into());
    }
    if !uses_pg_meta(validate_ref(&reference)?).await? {
        return Err(PUBLIC_TABLE_LIST.into());
    }
    let query = format!(
        "SELECT table_schema AS schema, table_name AS name, table_type AS kind FROM information_schema.tables WHERE table_schema <> 'information_schema' AND left(table_schema, 3) <> 'pg_' ORDER BY table_schema, table_name LIMIT 101 OFFSET {offset}"
    );
    let mut tables = database_query(&reference, &query, &[]).await?;
    let has_more = tables.len() > 100;
    tables.truncate(100);
    Ok(SupabaseTablesPage { tables, has_more })
}

#[tauri::command]
pub async fn supabase_table_columns(
    reference: String,
    schema: String,
    table: String,
) -> Result<Vec<SupabaseColumn>, String> {
    quote_identifier(&schema)?;
    quote_identifier(&table)?;
    if !uses_pg_meta(validate_ref(&reference)?).await? {
        return Ok(Vec::new());
    }
    database_query(
        &reference,
        "SELECT column_name AS name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        &[serde_json::json!(schema), serde_json::json!(table)],
    )
    .await
}

#[tauri::command]
pub async fn supabase_table_rows(
    reference: String,
    schema: String,
    table: String,
    offset: u32,
) -> Result<SupabaseRowsPage, String> {
    let query = table_rows_sql(&schema, &table, offset)?;
    let mut rows = if uses_pg_meta(validate_ref(&reference)?).await? {
        database_query(&reference, &query, &[]).await?
    } else {
        data_api_rows(&reference, &schema, &table, offset).await?
    };
    let has_more = rows.len() > 50;
    rows.truncate(50);
    let rows = rows
        .into_iter()
        .enumerate()
        .map(|(index, values)| SupabaseRow {
            ordinal: offset + index as u32 + 1,
            values,
        })
        .collect();
    Ok(SupabaseRowsPage { rows, has_more })
}

async fn data_api_rows(
    reference: &str,
    schema: &str,
    table: &str,
    offset: u32,
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, String> {
    let mut url = project_url(reference, "rest/v1/").await?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Supabase-URL.".to_string())?
        .pop_if_empty()
        .push(table);
    url.query_pairs_mut()
        .append_pair("select", "*")
        .append_pair("limit", "51")
        .append_pair("offset", &offset.to_string());
    let response = project_api_auth(client().get(url), &project_secret_key(reference).await?)
        .header("Accept-Profile", schema)
        .send()
        .await
        .map_err(|error| format!("Supabase Data API ist nicht erreichbar: {error}"))?;
    if matches!(response.status().as_u16(), 404 | 406) {
        return Err(format!(
            "Tabelle {schema}.{table} nicht gefunden oder nicht über die Data API freigegeben."
        ));
    }
    response_json(response).await
}

#[tauri::command]
pub async fn supabase_has_project_key(reference: String) -> Result<bool, String> {
    let reference = validate_ref(&reference)?;
    Ok(
        crate::db::secrets::load_secret(project_key_account(reference))
            .await?
            .is_some(),
    )
}

#[tauri::command]
pub async fn supabase_set_project_key(reference: String, api_key: String) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API-Schlüssel fehlt.".into());
    }
    validate_project_secret_key(api_key)?;
    let response = project_api_auth(
        client().get(project_url(reference, "storage/v1/bucket").await?),
        api_key,
    )
    .send()
    .await
    .map_err(|error| format!("Supabase Storage ist nicht erreichbar: {error}"))?;
    let _: serde_json::Value = response_json(response).await?;
    crate::db::secrets::store_secret(project_key_account(reference), api_key.to_string()).await?;
    let mut references = project_key_index().await?;
    if !references.iter().any(|entry| entry == reference) {
        references.push(reference.to_string());
        save_project_key_index(&references).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn supabase_import_project_key(reference: String) -> Result<(), String> {
    let reference = cloud_ref(&reference)?;
    let keys: Vec<SupabaseApiKey> = management_get(
        &token().await?,
        &format!("projects/{reference}/api-keys?reveal=true"),
    )
    .await?;
    let api_key = select_project_key(&keys)?;
    supabase_set_project_key(reference.to_string(), api_key.to_string()).await
}

#[tauri::command]
pub async fn supabase_delete_project_key(reference: String) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    crate::db::secrets::delete_secret(project_key_account(reference)).await?;
    let references = project_key_index().await?;
    save_project_key_index(
        &references
            .into_iter()
            .filter(|entry| entry != reference)
            .collect::<Vec<_>>(),
    )
    .await
}

#[tauri::command]
pub async fn supabase_objects(
    reference: String,
    bucket: String,
    prefix: String,
    offset: u32,
) -> Result<Vec<SupabaseObject>, String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let api_key = crate::db::secrets::load_secret(project_key_account(reference))
        .await?
        .ok_or_else(|| {
            "Für die Dateiliste wird ein Supabase Secret API Key benötigt.".to_string()
        })?;
    let mut url = project_url(reference, "storage/v1/object/list").await?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Supabase-URL.".to_string())?
        .push(bucket);
    let response = project_api_auth(client().post(url), &api_key)
        .json(&serde_json::json!({
            "prefix": prefix,
            "limit": 100,
            "offset": offset,
            "sortBy": {"column": "name", "order": "asc"}
        }))
        .send()
        .await
        .map_err(|error| format!("Supabase Storage ist nicht erreichbar: {error}"))?;
    response_json(response).await
}

async fn object_response(
    reference: &str,
    bucket: &str,
    object_key: &str,
    http_client: &reqwest::Client,
) -> Result<reqwest::Response, String> {
    let reference = validate_ref(reference)?;
    let bucket = validate_bucket(bucket)?;
    let object_key = validate_object_key(object_key)?;
    let api_key = crate::db::secrets::load_secret(project_key_account(reference))
        .await?
        .ok_or_else(|| {
            "Für die Dateivorschau wird ein Supabase Secret API Key benötigt.".to_string()
        })?;
    let mut url = project_url(reference, "storage/v1/object/authenticated").await?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Supabase-URL.".to_string())?
        .push(bucket)
        .extend(object_key.split('/'));
    project_api_auth(http_client.get(url), &api_key)
        .send()
        .await
        .map_err(|_| "Supabase Storage ist nicht erreichbar.".to_string())
}

async fn upload_file(
    path: &std::path::Path,
    url: reqwest::Url,
    api_key: &str,
    http_client: &reqwest::Client,
) -> Result<(), String> {
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
    let response = project_api_auth(http_client.post(url), api_key)
        .header(reqwest::header::CONTENT_TYPE, mime_type.as_ref())
        .header(reqwest::header::CONTENT_LENGTH, metadata.len())
        .header("x-upsert", "false")
        .body(reqwest::Body::wrap_stream(ReaderStream::new(file)))
        .send()
        .await
        .map_err(|_| "Supabase Storage ist beim Upload nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        let hint = match response.status().as_u16() {
            400 => "Datei existiert bereits oder wird von den Bucket-Regeln abgelehnt.",
            401 => "API-Schlüssel ungültig.",
            403 => "Für den Upload fehlt die Berechtigung.",
            409 => "Datei existiert bereits.",
            413 => "Datei überschreitet das Größenlimit des Buckets.",
            _ => "Upload fehlgeschlagen.",
        };
        return Err(format!(
            "Supabase HTTP {}: {hint}",
            response.status().as_u16()
        ));
    }
    let _: serde_json::Value = response_json(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn supabase_upload_object(
    app: tauri::AppHandle,
    reference: String,
    bucket: String,
    prefix: String,
) -> Result<Option<String>, String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    if !prefix.is_empty() && !prefix.ends_with('/') {
        return Err("Ungültiger Storage-Ordner.".into());
    }
    let api_key = crate::db::secrets::load_secret(project_key_account(reference))
        .await?
        .ok_or_else(|| "Für den Upload wird ein Supabase Secret API Key benötigt.".to_string())?;
    let Some(path) = crate::baas_file::pick_open_path(app).await? else {
        return Ok(None);
    };
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Dateiname konnte nicht gelesen werden.".to_string())?;
    let object_key = validate_object_key(&format!("{prefix}{name}"))?.to_string();
    let mut url = project_url(reference, "storage/v1/object").await?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Supabase-URL.".to_string())?
        .push(bucket)
        .extend(object_key.split('/'));
    upload_file(&path, url, &api_key, crate::baas_file::upload_client()).await?;
    Ok(Some(object_key))
}

#[tauri::command]
pub async fn supabase_delete_object(
    reference: String,
    bucket: String,
    object_key: String,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let object_key = validate_object_key(&object_key)?;
    let api_key = crate::db::secrets::load_secret(project_key_account(reference))
        .await?
        .ok_or_else(|| "Für das Löschen wird ein Supabase Secret API Key benötigt.".to_string())?;
    let mut url = project_url(reference, "storage/v1/object").await?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Supabase-URL.".to_string())?
        .push(bucket)
        .extend(object_key.split('/'));
    let response = project_api_auth(client().delete(url), &api_key)
        .send()
        .await
        .map_err(|_| "Supabase Storage ist nicht erreichbar.".to_string())?;
    let _: serde_json::Value = response_json(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn supabase_move_object(
    reference: String,
    bucket: String,
    source_key: String,
    destination_key: String,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let bucket = validate_bucket(&bucket)?;
    let source_key = validate_object_key(&source_key)?;
    let destination_key = validate_object_key(&destination_key)?;
    if source_key == destination_key {
        return Err("Der neue Dateipfad muss sich unterscheiden.".into());
    }
    let api_key = crate::db::secrets::load_secret(project_key_account(reference))
        .await?
        .ok_or_else(|| {
            "Für das Verschieben wird ein Supabase Secret API Key benötigt.".to_string()
        })?;
    let response = project_api_auth(
        client().post(project_url(reference, "storage/v1/object/move").await?),
        &api_key,
    )
    .json(&serde_json::json!({
        "bucketId": bucket,
        "sourceKey": source_key,
        "destinationKey": destination_key
    }))
    .send()
    .await
    .map_err(|_| "Supabase Storage ist nicht erreichbar.".to_string())?;
    let _: serde_json::Value = response_json(response).await?;
    Ok(())
}

#[tauri::command]
pub async fn supabase_preview_object(
    reference: String,
    bucket: String,
    object_key: String,
) -> Result<crate::baas_file::BaasFilePreview, String> {
    crate::baas_file::preview_response(
        object_response(&reference, &bucket, &object_key, client()).await?,
    )
    .await
}

#[tauri::command]
pub async fn supabase_download_object(
    app: tauri::AppHandle,
    reference: String,
    bucket: String,
    object_key: String,
) -> Result<bool, String> {
    let Some(path) = crate::baas_file::pick_save_path(app, &object_key).await? else {
        return Ok(false);
    };
    let response = object_response(
        &reference,
        &bucket,
        &object_key,
        crate::baas_file::download_client(),
    )
    .await?;
    crate::baas_file::save_response(response, path).await?;
    Ok(true)
}

#[tauri::command]
pub async fn supabase_auth_users(
    reference: String,
    page: u32,
) -> Result<SupabaseAuthUsersPage, String> {
    let reference = validate_ref(&reference)?;
    if page == 0 || page > 10_000 {
        return Err("Ungültige Seitennummer.".into());
    }
    let api_key = crate::db::secrets::load_secret(project_key_account(reference))
        .await?
        .ok_or_else(|| "Für Auth wird ein Supabase Secret API Key benötigt.".to_string())?;
    let response = project_api_auth(
        client().get(project_url(reference, "auth/v1/admin/users").await?),
        &api_key,
    )
    .query(&[("page", page), ("per_page", 50)])
    .send()
    .await
    .map_err(|error| format!("Supabase Auth ist nicht erreichbar: {error}"))?;
    response_json(response).await
}

fn validate_auth_user_id(id: &str) -> Result<&str, String> {
    if id.len() != 36
        || !id.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
    {
        return Err("Ungültige Supabase-Benutzer-ID.".into());
    }
    Ok(id)
}

fn validate_auth_email(email: &str) -> Result<&str, String> {
    if email.is_empty()
        || email.len() > 320
        || email.contains(char::is_whitespace)
        || !email.contains('@')
    {
        return Err("Ungültige E-Mail-Adresse.".into());
    }
    Ok(email)
}

#[tauri::command]
pub async fn supabase_create_auth_user(
    reference: String,
    email: String,
    password: String,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let email = validate_auth_email(email.trim())?;
    if password.len() < 6 || password.len() > 1024 {
        return Err("Passwort muss zwischen 6 und 1024 Zeichen lang sein.".into());
    }
    let key = project_secret_key(reference).await?;
    let response = project_api_auth(
        client().post(project_url(reference, "auth/v1/admin/users").await?),
        &key,
    )
    .json(&serde_json::json!({"email": email, "password": password}))
    .send()
    .await
    .map_err(|_| "Supabase Auth ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Supabase HTTP {}: Benutzer konnte nicht erstellt werden.",
            response.status().as_u16()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn supabase_update_auth_user_email(
    reference: String,
    user_id: String,
    email: String,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let user_id = validate_auth_user_id(&user_id)?;
    let email = validate_auth_email(email.trim())?;
    let key = project_secret_key(reference).await?;
    let response = project_api_auth(
        client().put(project_url(reference, &format!("auth/v1/admin/users/{user_id}")).await?),
        &key,
    )
    .json(&serde_json::json!({"email": email}))
    .send()
    .await
    .map_err(|_| "Supabase Auth ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Supabase HTTP {}: Benutzer konnte nicht geändert werden.",
            response.status().as_u16()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn supabase_delete_auth_user(reference: String, user_id: String) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let user_id = validate_auth_user_id(&user_id)?;
    let key = project_secret_key(reference).await?;
    let response = project_api_auth(
        client().delete(project_url(reference, &format!("auth/v1/admin/users/{user_id}")).await?),
        &key,
    )
    .send()
    .await
    .map_err(|_| "Supabase Auth ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Supabase HTTP {}: Benutzer konnte nicht gelöscht werden.",
            response.status().as_u16()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        bucket_url, client, cloud_project_url, cloud_ref, cloud_reference_of, database_endpoint,
        env_value, is_self_hosted, project_api_auth, project_key_is_secret, select_project_key,
        self_hosted_base_url, self_hosted_reference, table_rows_sql, upload_file,
        validate_auth_email, validate_auth_user_id, validate_object_key,
        validate_project_secret_key, validate_ref, SelfHostedProject, SupabaseApiKey,
        SupabaseAuthUsersPage, SupabaseBackups, SupabaseBucket, SupabaseFunction, SupabaseObject,
        SupabasePoolerConfig, SupabaseProject, SupabaseServiceHealth,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn upload_streams_file_without_overwriting_or_exposing_key_as_bearer() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let read = stream.read(&mut buffer).await.unwrap();
                assert!(read > 0);
                request.extend_from_slice(&buffer[..read]);
                if let Some(headers_end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
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
            assert!(headers.starts_with("post /storage/v1/object/bucket/folder/hello.txt "));
            assert!(headers.contains("apikey: sb_secret_example"));
            assert!(!headers.contains("authorization:"));
            assert!(headers.contains("x-upsert: false"));
            assert!(headers.contains("content-type: text/plain"));
            assert!(headers.contains("content-length: 5"));
            assert_eq!(&request[headers_end + 4..], b"hello");
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}")
                .await
                .unwrap();
        });
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hello.txt");
        std::fs::write(&path, b"hello").unwrap();
        let url = reqwest::Url::parse(&format!(
            "http://{address}/storage/v1/object/bucket/folder/hello.txt"
        ))
        .unwrap();
        upload_file(&path, url, "sb_secret_example", client())
            .await
            .unwrap();
        server.await.unwrap();
    }

    #[test]
    fn table_row_queries_quote_names_and_cap_offsets() {
        assert_eq!(
            table_rows_sql("public", "a\"; DROP TABLE users; --", 50).unwrap(),
            "SELECT * FROM \"public\".\"a\"\"; DROP TABLE users; --\" LIMIT 51 OFFSET 50"
        );
        assert!(table_rows_sql("public", "items", 1_000_001).is_err());
        assert!(table_rows_sql("public", "a\0b", 0).is_err());
    }

    #[test]
    fn project_key_selection_prefers_default_secret_and_rejects_ambiguity() {
        let keys = vec![
            SupabaseApiKey {
                kind: "legacy".into(),
                name: Some("service_role".into()),
                api_key: Some(
                    "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature".into(),
                ),
            },
            SupabaseApiKey {
                kind: "secret".into(),
                name: Some("other".into()),
                api_key: Some("sb_secret_other".into()),
            },
            SupabaseApiKey {
                kind: "secret".into(),
                name: Some("default".into()),
                api_key: Some("sb_secret_default".into()),
            },
        ];
        assert_eq!(select_project_key(&keys).unwrap(), "sb_secret_default");
        assert_eq!(select_project_key(&keys[..2]).unwrap(), "sb_secret_other");
        let more = vec![
            SupabaseApiKey {
                kind: "secret".into(),
                name: Some("one".into()),
                api_key: Some("sb_secret_one".into()),
            },
            SupabaseApiKey {
                kind: "secret".into(),
                name: Some("two".into()),
                api_key: Some("sb_secret_two".into()),
            },
        ];
        assert!(select_project_key(&more).is_err());
        assert_eq!(
            select_project_key(&keys[..1]).unwrap(),
            "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature"
        );
        let hidden: Vec<SupabaseApiKey> = serde_json::from_str(
            r#"[{"type":"secret","name":"default","api_key":null},{"type":"publishable","name":"default","api_key":"sb_publishable_example"}]"#,
        )
        .unwrap();
        assert!(select_project_key(&hidden).is_err());
    }

    #[test]
    fn project_keys_are_classified_and_env_lines_unwrapped() {
        assert_eq!(project_key_is_secret("sb_secret_example"), Ok(true));
        assert_eq!(project_key_is_secret("sb_publishable_example"), Ok(false));
        assert_eq!(
            project_key_is_secret("eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature"),
            Ok(false)
        );
        assert_eq!(
            project_key_is_secret("eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature"),
            Ok(true)
        );
        assert!(project_key_is_secret("sb_publishable_").is_err());
        assert!(project_key_is_secret("random").is_err());
        assert_eq!(
            env_value(" NEXT_PUBLIC_SUPABASE_URL=\"https://abc.supabase.co\" "),
            "https://abc.supabase.co"
        );
        assert_eq!(env_value("KEY='sb_publishable_x'"), "sb_publishable_x");
        assert_eq!(
            env_value("https://abc.supabase.co"),
            "https://abc.supabase.co"
        );
        let cloud = self_hosted_base_url("https://abcdefghijklmnopqrst.supabase.co").unwrap();
        assert_eq!(cloud_reference_of(&cloud), Some("abcdefghijklmnopqrst"));
        assert_eq!(
            cloud_reference_of(&self_hosted_base_url("https://supabase.example.com").unwrap()),
            None
        );
    }

    #[test]
    fn project_key_validation_rejects_public_keys() {
        assert!(validate_project_secret_key("sb_secret_example").is_ok());
        assert!(validate_project_secret_key("sb_publishable_example").is_err());
        assert!(validate_project_secret_key(
            "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature"
        )
        .is_ok());
        assert!(
            validate_project_secret_key("eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature")
                .is_err()
        );
    }

    #[test]
    fn project_api_uses_bearer_only_for_legacy_jwt_keys() {
        let secret = project_api_auth(
            client().get("https://example.supabase.co/storage/v1/bucket"),
            "sb_secret_example",
        )
        .build()
        .unwrap();
        assert_eq!(
            secret.headers().get("apikey").unwrap().to_str().unwrap(),
            "sb_secret_example"
        );
        assert!(secret.headers().get("authorization").is_none());

        let legacy_key = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature";
        let legacy = project_api_auth(
            client().get("https://example.supabase.co/storage/v1/bucket"),
            legacy_key,
        )
        .build()
        .unwrap();
        assert_eq!(
            legacy.headers().get("apikey").unwrap().to_str().unwrap(),
            legacy_key
        );
        assert_eq!(
            legacy
                .headers()
                .get("authorization")
                .unwrap()
                .to_str()
                .unwrap(),
            format!("Bearer {legacy_key}")
        );
    }

    #[test]
    fn project_refs_are_restricted_to_supabase_hosts() {
        assert!(validate_ref("abcdefghijklmnopqrst").is_ok());
        assert!(validate_ref("x-y1").is_ok());
        for invalid in ["", "../other", "a.b", "a/b", "A", "x?redirect=evil"] {
            assert!(validate_ref(invalid).is_err());
        }
    }

    #[test]
    fn auth_user_inputs_cannot_escape_admin_path() {
        assert!(validate_auth_user_id("12345678-1234-1234-1234-123456789abc").is_ok());
        assert!(validate_auth_user_id("../settings").is_err());
        assert!(validate_auth_email("ada@example.com").is_ok());
        assert!(validate_auth_email("ada@example.com\nX-Test: value").is_err());
    }

    #[test]
    fn object_keys_cannot_escape_storage_path() {
        assert!(validate_object_key("folder/image.png").is_ok());
        assert!(validate_object_key("../auth/users").is_err());
        assert!(validate_object_key("folder//image.png").is_err());
        assert!(validate_object_key("folder\\image.png").is_err());
    }

    #[test]
    fn bucket_details_use_project_host_and_encode_bucket_id() {
        let base = cloud_project_url("abcdefghijklmnopqrst")
            .unwrap()
            .join("storage/v1/bucket")
            .unwrap();
        let url = bucket_url(base.clone(), "photos & files").unwrap();
        assert_eq!(url.host_str(), Some("abcdefghijklmnopqrst.supabase.co"));
        assert_eq!(url.path(), "/storage/v1/bucket/photos%20&%20files");
        assert!(bucket_url(base, "../auth").is_err());
    }

    #[test]
    fn self_hosted_urls_are_origin_only_and_get_stable_references() {
        assert!(self_hosted_base_url("http://localhost:8000").is_ok());
        assert!(self_hosted_base_url("http://[::1]:8000").is_ok());
        let base = self_hosted_base_url(" http://127.0.0.1:8000 ").unwrap();
        assert_eq!(base.as_str(), "http://127.0.0.1:8000/");
        assert_eq!(
            base.join("storage/v1/bucket").unwrap().as_str(),
            "http://127.0.0.1:8000/storage/v1/bucket"
        );
        let reference = self_hosted_reference(&base);
        assert!(validate_ref(&reference).is_ok());
        assert!(is_self_hosted(&reference));
        assert!(cloud_ref(&reference).is_err());
        assert!(cloud_ref("abcdefghijklmnopqrst").is_ok());
        assert_eq!(reference, self_hosted_reference(&base));
        assert_ne!(
            reference,
            self_hosted_reference(&self_hosted_base_url("https://supabase.example.com").unwrap())
        );
        for invalid in [
            "ftp://example.com",
            "http://user:pw@example.com",
            "http://example.com/rest/v1",
            "http://supabase.example.com:8000",
            "http://example.com/?x=1",
            "example.com",
        ] {
            assert!(self_hosted_base_url(invalid).is_err(), "{invalid}");
        }
        let project = |url: &str, secret_key| SelfHostedProject {
            reference: String::new(),
            name: String::new(),
            url: url.into(),
            secret_key,
        };
        assert!(project("http://127.0.0.1:8000", true).pg_meta());
        assert!(!project("http://127.0.0.1:8000", false).pg_meta());
        assert!(!project("https://abcdefghijklmnopqrst.supabase.co", true).pg_meta());
    }

    #[test]
    fn database_endpoint_prefers_session_pooler() {
        let configs: Vec<SupabasePoolerConfig> = serde_json::from_str(
            r#"[{"db_host":"aws-1-eu-central-1.pooler.supabase.com","db_user":"postgres.abcdefghijklmnopqrst","db_name":"postgres","db_port":6543,"database_type":"PRIMARY"}]"#,
        )
        .unwrap();
        let endpoint = database_endpoint("abcdefghijklmnopqrst", configs);
        assert_eq!(endpoint.host, "aws-1-eu-central-1.pooler.supabase.com");
        assert_eq!(endpoint.port, 5432);
        assert_eq!(endpoint.user, "postgres.abcdefghijklmnopqrst");
        let unsafe_host: Vec<SupabasePoolerConfig> = serde_json::from_str(
            r#"[{"db_host":"evil.com/x@y","db_user":"postgres","db_name":"postgres"}]"#,
        )
        .unwrap();
        assert_eq!(
            database_endpoint("abcdefghijklmnopqrst", unsafe_host).host,
            "db.abcdefghijklmnopqrst.supabase.co"
        );
    }

    #[test]
    fn management_and_project_api_payloads_decode() {
        let projects: Vec<SupabaseProject> = serde_json::from_str(
            r#"[{"id":"1","ref":"abcdefghijklmnopqrst","name":"Demo","region":"eu-central-1","status":"ACTIVE_HEALTHY","database":{"host":"db.example.supabase.co","version":"17"}}]"#,
        )
        .unwrap();
        assert_eq!(projects[0].reference, "abcdefghijklmnopqrst");
        assert_eq!(
            serde_json::to_value(&projects[0]).unwrap()["reference"],
            "abcdefghijklmnopqrst"
        );
        let buckets: Vec<SupabaseBucket> =
            serde_json::from_str(r#"[{"id":"avatars","name":"avatars","public":true}]"#).unwrap();
        assert!(buckets[0].public);
        let details: SupabaseBucket = serde_json::from_str(
            r#"{"id":"photos","name":"Photos","public":false,"type":"STANDARD","file_size_limit":1048576,"allowed_mime_types":["image/png"]}"#,
        )
        .unwrap();
        assert_eq!(details.file_size_limit, Some(1024 * 1024));
        assert_eq!(details.allowed_mime_types.unwrap(), ["image/png"]);
        let functions: Vec<SupabaseFunction> = serde_json::from_str(
            r#"[{"slug":"send-mail","status":"ACTIVE","version":2,"verify_jwt":true,"entrypoint_path":"index.ts","import_map_path":"import_map.json"}]"#,
        )
        .unwrap();
        assert_eq!(functions[0].slug, "send-mail");
        assert_eq!(functions[0].verify_jwt, Some(true));
        assert_eq!(functions[0].entrypoint_path.as_deref(), Some("index.ts"));
        assert_eq!(
            functions[0].import_map_path.as_deref(),
            Some("import_map.json")
        );
        let health: Vec<SupabaseServiceHealth> = serde_json::from_str(
            r#"[{"name":"storage","healthy":true,"status":"ACTIVE_HEALTHY"}]"#,
        )
        .unwrap();
        assert!(health[0].healthy);
        let backups: SupabaseBackups = serde_json::from_str(
            r#"{"region":"eu-central-1","walg_enabled":true,"pitr_enabled":true,"backups":[{"id":42,"is_physical_backup":true,"status":"COMPLETED","inserted_at":"2026-09-27T12:00:00Z"}],"physical_backup_data":{"earliest_physical_backup_date_unix":1790500000,"latest_physical_backup_date_unix":1790510000}}"#,
        )
        .unwrap();
        assert_eq!(backups.pitr_enabled, Some(true));
        assert_eq!(backups.backups[0].status.as_deref(), Some("COMPLETED"));
        assert_eq!(
            backups
                .physical_backup_data
                .unwrap()
                .latest_physical_backup_date_unix,
            Some(1790510000)
        );
        let objects: Vec<SupabaseObject> = serde_json::from_str(
            r#"[{"name":"photo.png","id":"1","created_at":"2026-09-27T12:00:00Z","updated_at":"2026-09-27T13:00:00Z","last_accessed_at":"2026-09-27T14:00:00Z","metadata":{"size":512,"mimetype":"image/png"}},{"name":"photos","id":null,"metadata":null}]"#,
        )
        .unwrap();
        assert_eq!(
            objects[0].last_accessed_at.as_deref(),
            Some("2026-09-27T14:00:00Z")
        );
        assert!(objects[1].id.is_none());
        let users: SupabaseAuthUsersPage = serde_json::from_str(
            r#"{"users":[{"id":"a","email":"user@example.com","email_confirmed_at":"2026-09-27T12:00:00Z","phone_confirmed_at":null,"is_anonymous":false}],"total":1}"#,
        )
        .unwrap();
        assert_eq!(users.users[0].email.as_deref(), Some("user@example.com"));
        assert_eq!(
            users.users[0].email_confirmed_at.as_deref(),
            Some("2026-09-27T12:00:00Z")
        );
        assert_eq!(users.users[0].phone_confirmed_at, None);
        assert_eq!(users.users[0].is_anonymous, Some(false));
    }
}
