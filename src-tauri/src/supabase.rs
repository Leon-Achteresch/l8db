use base64::Engine;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

const TOKEN_ACCOUNT: &str = "baas:supabase:access-token";
const KEY_INDEX_ACCOUNT: &str = "baas:supabase:project-key-index";

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

fn validate_project_secret_key(api_key: &str) -> Result<(), String> {
    if api_key.starts_with("sb_secret_") && api_key.len() > "sb_secret_".len() {
        return Ok(());
    }
    let parts = api_key.split('.').collect::<Vec<_>>();
    if parts.len() != 3 || !parts[0].starts_with("eyJ") || parts[2].is_empty() {
        return Err("Ein Supabase Secret API Key oder service_role Key wird benötigt.".into());
    }
    let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
    if claims.as_ref().and_then(|value| value["role"].as_str()) == Some("service_role") {
        Ok(())
    } else {
        Err("Ein Supabase Secret API Key oder service_role Key wird benötigt.".into())
    }
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

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseDatabase {
    pub host: Option<String>,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseProject {
    pub id: String,
    #[serde(rename = "ref")]
    pub reference: String,
    pub name: String,
    pub region: Option<String>,
    pub status: Option<String>,
    pub organization_id: Option<String>,
    pub database: Option<SupabaseDatabase>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseBucket {
    pub id: String,
    pub name: String,
    pub public: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseFunction {
    pub id: Option<String>,
    pub slug: String,
    pub name: Option<String>,
    pub status: Option<String>,
    pub version: Option<i64>,
    pub verify_jwt: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseObject {
    pub name: String,
    pub id: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseServiceHealth {
    pub name: String,
    pub healthy: bool,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseAuthUser {
    pub id: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub created_at: Option<String>,
    pub last_sign_in_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseAuthUsersPage {
    pub users: Vec<SupabaseAuthUser>,
}

#[derive(Deserialize)]
struct SupabaseApiKey {
    api_key: Option<String>,
    #[serde(rename = "type")]
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
pub async fn supabase_disconnect() -> Result<(), String> {
    for reference in project_key_index().await? {
        crate::db::secrets::delete_secret(project_key_account(&reference)).await?;
    }
    crate::db::secrets::delete_secret(KEY_INDEX_ACCOUNT.to_string()).await?;
    crate::db::secrets::delete_secret(TOKEN_ACCOUNT.to_string()).await
}

#[tauri::command]
pub async fn supabase_is_connected() -> Result<bool, String> {
    Ok(crate::db::secrets::load_secret(TOKEN_ACCOUNT.to_string())
        .await?
        .is_some())
}

#[tauri::command]
pub async fn supabase_projects() -> Result<Vec<SupabaseProject>, String> {
    management_get(&token().await?, "projects").await
}

#[tauri::command]
pub async fn supabase_buckets(reference: String) -> Result<Vec<SupabaseBucket>, String> {
    let reference = validate_ref(&reference)?;
    management_get(
        &token().await?,
        &format!("projects/{reference}/storage/buckets"),
    )
    .await
}

#[tauri::command]
pub async fn supabase_functions(reference: String) -> Result<Vec<SupabaseFunction>, String> {
    let reference = validate_ref(&reference)?;
    management_get(&token().await?, &format!("projects/{reference}/functions")).await
}

#[tauri::command]
pub async fn supabase_health(reference: String) -> Result<Vec<SupabaseServiceHealth>, String> {
    let reference = validate_ref(&reference)?;
    management_get(
        &token().await?,
        &format!("projects/{reference}/health?services=auth&services=db&services=pooler&services=realtime&services=rest&services=storage"),
    )
    .await
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
        client().get(format!("https://{reference}.supabase.co/storage/v1/bucket")),
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
    let reference = validate_ref(&reference)?;
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
    if bucket.is_empty() || bucket.len() > 256 || bucket.contains('/') {
        return Err("Ungültiger Bucket-Name.".into());
    }
    let api_key = crate::db::secrets::load_secret(project_key_account(reference))
        .await?
        .ok_or_else(|| {
            "Für die Dateiliste wird ein Supabase Secret API Key benötigt.".to_string()
        })?;
    let mut url = reqwest::Url::parse(&format!(
        "https://{reference}.supabase.co/storage/v1/object/list"
    ))
    .map_err(|_| "Ungültige Supabase-URL.".to_string())?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Supabase-URL.".to_string())?
        .push(&bucket);
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
    if bucket.is_empty()
        || bucket.len() > 256
        || bucket.contains('/')
        || bucket.contains('\\')
        || bucket == "."
        || bucket == ".."
    {
        return Err("Ungültiger Bucket-Name.".into());
    }
    let object_key = validate_object_key(object_key)?;
    let api_key = crate::db::secrets::load_secret(project_key_account(reference))
        .await?
        .ok_or_else(|| {
            "Für die Dateivorschau wird ein Supabase Secret API Key benötigt.".to_string()
        })?;
    let mut url = reqwest::Url::parse(&format!(
        "https://{reference}.supabase.co/storage/v1/object/authenticated"
    ))
    .map_err(|_| "Ungültige Supabase-URL.".to_string())?;
    url.path_segments_mut()
        .map_err(|_| "Ungültige Supabase-URL.".to_string())?
        .push(bucket)
        .extend(object_key.split('/'));
    project_api_auth(http_client.get(url), &api_key)
        .send()
        .await
        .map_err(|_| "Supabase Storage ist nicht erreichbar.".to_string())
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
        client().get(format!(
            "https://{reference}.supabase.co/auth/v1/admin/users"
        )),
        &api_key,
    )
    .query(&[("page", page), ("per_page", 50)])
    .send()
    .await
    .map_err(|error| format!("Supabase Auth ist nicht erreichbar: {error}"))?;
    response_json(response).await
}

#[cfg(test)]
mod tests {
    use super::{
        client, project_api_auth, select_project_key, validate_object_key,
        validate_project_secret_key, validate_ref, SupabaseApiKey, SupabaseAuthUsersPage,
        SupabaseBucket, SupabaseFunction, SupabaseObject, SupabaseProject, SupabaseServiceHealth,
    };

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
    fn object_keys_cannot_escape_storage_path() {
        assert!(validate_object_key("folder/image.png").is_ok());
        assert!(validate_object_key("../auth/users").is_err());
        assert!(validate_object_key("folder//image.png").is_err());
        assert!(validate_object_key("folder\\image.png").is_err());
    }

    #[test]
    fn management_and_project_api_payloads_decode() {
        let projects: Vec<SupabaseProject> = serde_json::from_str(
            r#"[{"id":"1","ref":"abcdefghijklmnopqrst","name":"Demo","region":"eu-central-1","status":"ACTIVE_HEALTHY","database":{"host":"db.example.supabase.co","version":"17"}}]"#,
        )
        .unwrap();
        assert_eq!(projects[0].reference, "abcdefghijklmnopqrst");
        let buckets: Vec<SupabaseBucket> =
            serde_json::from_str(r#"[{"id":"avatars","name":"avatars","public":true}]"#).unwrap();
        assert!(buckets[0].public);
        let functions: Vec<SupabaseFunction> =
            serde_json::from_str(r#"[{"slug":"send-mail","status":"ACTIVE","version":2}]"#)
                .unwrap();
        assert_eq!(functions[0].slug, "send-mail");
        let health: Vec<SupabaseServiceHealth> = serde_json::from_str(
            r#"[{"name":"storage","healthy":true,"status":"ACTIVE_HEALTHY"}]"#,
        )
        .unwrap();
        assert!(health[0].healthy);
        let objects: Vec<SupabaseObject> =
            serde_json::from_str(r#"[{"name":"photos","id":null,"metadata":null}]"#).unwrap();
        assert!(objects[0].id.is_none());
        let users: SupabaseAuthUsersPage =
            serde_json::from_str(r#"{"users":[{"id":"a","email":"user@example.com"}],"total":1}"#)
                .unwrap();
        assert_eq!(users.users[0].email.as_deref(), Some("user@example.com"));
    }
}
