use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use std::time::Duration;

const PROFILES_ACCOUNT: &str = "baas:convex:profiles";
const MANAGEMENT_URL: &str = "https://api.convex.dev/v1";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ConvexProfile {
    pub id: String,
    pub team_id: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexProject {
    pub id: u64,
    pub name: String,
    pub slug: String,
    pub team_slug: String,
    pub prod_deployment_name: Option<String>,
    pub dev_deployment_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexPagination {
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ConvexProjects {
    pub items: Vec<ConvexProject>,
    pub pagination: ConvexPagination,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexDeployment {
    pub name: String,
    pub deployment_type: String,
    pub reference: Option<String>,
    pub region: Option<String>,
    pub deployment_url: Option<String>,
    pub kind: String,
    pub is_default: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConvexEnvironmentVariables {
    environment_variables: std::collections::BTreeMap<String, String>,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("Convex HTTP client")
    })
}

fn profile_id(team_id: u64) -> String {
    let digest = Sha256::digest(team_id.to_string().as_bytes());
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn token_account(id: &str) -> String {
    format!("baas:convex:{id}:token")
}

fn validate_id(id: &str) -> Result<&str, String> {
    if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Ungültige Convex-Verbindungs-ID.".into());
    }
    Ok(id)
}

async fn profiles() -> Result<Vec<ConvexProfile>, String> {
    let raw = crate::db::secrets::load_secret(PROFILES_ACCOUNT.to_string()).await?;
    raw.map(|value| {
        serde_json::from_str(&value).map_err(|_| "Ungültiger Convex-Projektindex.".into())
    })
    .unwrap_or_else(|| Ok(Vec::new()))
}

async fn save_profiles(items: &[ConvexProfile]) -> Result<(), String> {
    crate::db::secrets::store_secret(
        PROFILES_ACCOUNT.to_string(),
        serde_json::to_string(items)
            .map_err(|_| "Convex-Verbindungen konnten nicht gespeichert werden.")?,
    )
    .await
}

async fn profile_and_token(id: &str) -> Result<(ConvexProfile, String), String> {
    let id = validate_id(id)?;
    let profile = profiles()
        .await?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "Convex-Team nicht gefunden.".to_string())?;
    let token = crate::db::secrets::load_secret(token_account(id))
        .await?
        .ok_or_else(|| "Convex-Token nicht gefunden.".to_string())?;
    Ok((profile, token))
}

async fn fetch_json<T: serde::de::DeserializeOwned>(
    url: reqwest::Url,
    token: &str,
) -> Result<T, String> {
    let response = client()
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Convex ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Convex HTTP {}: Anfrage fehlgeschlagen.",
            response.status().as_u16()
        ));
    }
    response
        .json()
        .await
        .map_err(|_| "Convex hat unerwartete Daten geliefert.".into())
}

async fn projects_for(
    team_id: u64,
    token: &str,
    cursor: Option<&str>,
) -> Result<ConvexProjects, String> {
    let mut url = reqwest::Url::parse(&format!("{MANAGEMENT_URL}/teams/{team_id}/projects"))
        .map_err(|_| "Ungültige Convex-Projekt-URL.")?;
    url.query_pairs_mut().append_pair("limit", "100");
    if let Some(cursor) = cursor {
        if cursor.len() > 2048 {
            return Err("Ungültiger Convex-Seitenzeiger.".into());
        }
        url.query_pairs_mut().append_pair("cursor", cursor);
    }
    fetch_json(url, token).await
}

#[tauri::command]
pub async fn convex_connect(team_id: u64, token: String) -> Result<ConvexProfile, String> {
    if team_id == 0 || token.trim().is_empty() || token.len() > 8192 {
        return Err("Convex-Team-ID oder Team-Token fehlt.".into());
    }
    let token = token.trim();
    projects_for(team_id, token, None).await?;
    let profile = ConvexProfile {
        id: profile_id(team_id),
        team_id,
    };
    let mut items = profiles().await?;
    crate::db::secrets::store_secret(token_account(&profile.id), token.to_string()).await?;
    items.retain(|item| item.id != profile.id);
    items.push(profile.clone());
    save_profiles(&items).await?;
    Ok(profile)
}

#[tauri::command]
pub async fn convex_profiles() -> Result<Vec<ConvexProfile>, String> {
    profiles().await
}

#[tauri::command]
pub async fn convex_disconnect(id: String) -> Result<(), String> {
    let id = validate_id(&id)?;
    let mut items = profiles().await?;
    if !items.iter().any(|item| item.id == id) {
        return Err("Convex-Team nicht gefunden.".into());
    }
    crate::db::secrets::delete_secret(token_account(id)).await?;
    items.retain(|item| item.id != id);
    save_profiles(&items).await
}

#[tauri::command]
pub async fn convex_projects(id: String, cursor: Option<String>) -> Result<ConvexProjects, String> {
    let (profile, token) = profile_and_token(&id).await?;
    projects_for(profile.team_id, &token, cursor.as_deref()).await
}

#[tauri::command]
async fn deployments_for(
    profile: &ConvexProfile,
    token: &str,
    project_id: u64,
) -> Result<Vec<ConvexDeployment>, String> {
    let mut cursor: Option<String> = None;
    let mut found = false;
    for _ in 0..100 {
        let page = projects_for(profile.team_id, token, cursor.as_deref()).await?;
        if page.items.iter().any(|item| item.id == project_id) {
            found = true;
            break;
        }
        if !page.pagination.has_more {
            break;
        }
        cursor = page.pagination.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    if !found {
        return Err("Convex-Projekt gehört nicht zum verbundenen Team.".into());
    }
    let url = reqwest::Url::parse(&format!(
        "{MANAGEMENT_URL}/projects/{project_id}/list_deployments"
    ))
    .map_err(|_| "Ungültige Convex-Deployment-URL.")?;
    fetch_json(url, token).await
}

#[tauri::command]
pub async fn convex_deployments(
    id: String,
    project_id: u64,
) -> Result<Vec<ConvexDeployment>, String> {
    let (profile, token) = profile_and_token(&id).await?;
    deployments_for(&profile, &token, project_id).await
}

async fn deployment_endpoint(
    profile: &ConvexProfile,
    token: &str,
    project_id: u64,
    deployment_name: &str,
) -> Result<reqwest::Url, String> {
    let deployment = deployments_for(profile, token, project_id)
        .await?
        .into_iter()
        .find(|item| item.name == deployment_name)
        .ok_or_else(|| "Convex-Deployment nicht gefunden.".to_string())?;
    let raw = deployment
        .deployment_url
        .ok_or_else(|| "Dieses Convex-Deployment hat keine Cloud-URL.".to_string())?;
    let url = reqwest::Url::parse(&raw).map_err(|_| "Ungültige Convex-Deployment-URL.")?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || !host.ends_with(".convex.cloud")
        || host == ".convex.cloud"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Convex-Deployment-URL nicht freigegeben.".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn convex_environment_variables(
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<Vec<String>, String> {
    let (profile, token) = profile_and_token(&id).await?;
    let mut url = deployment_endpoint(&profile, &token, project_id, &deployment_name).await?;
    url.set_path("/api/v1/list_environment_variables");
    let response = client()
        .get(url)
        .header("Authorization", format!("Convex {token}"))
        .send()
        .await
        .map_err(|_| "Convex-Deployment ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Convex HTTP {}: Umgebungsvariablen konnten nicht geladen werden.",
            response.status().as_u16()
        ));
    }
    let variables: ConvexEnvironmentVariables = response
        .json()
        .await
        .map_err(|_| "Convex hat unerwartete Umgebungsvariablen geliefert.".to_string())?;
    Ok(variables.environment_variables.into_keys().collect())
}

async fn change_environment_variable(
    id: String,
    project_id: u64,
    deployment_name: String,
    name: String,
    value: Option<String>,
) -> Result<(), String> {
    if !valid_environment_name(&name) {
        return Err("Ungültiger Name der Umgebungsvariable.".into());
    }
    if value.as_ref().is_some_and(|value| value.len() > 8192) {
        return Err("Wert der Umgebungsvariable ist zu groß.".into());
    }
    let (profile, token) = profile_and_token(&id).await?;
    let mut url = deployment_endpoint(&profile, &token, project_id, &deployment_name).await?;
    url.set_path("/api/v1/update_environment_variables");
    let response = client()
        .post(url)
        .header("Authorization", format!("Convex {token}"))
        .json(&serde_json::json!({"changes": [{"name": name, "value": value}]}))
        .send()
        .await
        .map_err(|_| "Convex-Deployment ist nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Convex HTTP {}: Umgebungsvariable konnte nicht geändert werden.",
            response.status().as_u16()
        ));
    }
    Ok(())
}

fn valid_environment_name(name: &str) -> bool {
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

#[tauri::command]
pub async fn convex_set_environment_variable(
    id: String,
    project_id: u64,
    deployment_name: String,
    name: String,
    value: String,
) -> Result<(), String> {
    change_environment_variable(id, project_id, deployment_name, name, Some(value)).await
}

#[tauri::command]
pub async fn convex_delete_environment_variable(
    id: String,
    project_id: u64,
    deployment_name: String,
    name: String,
) -> Result<(), String> {
    change_environment_variable(id, project_id, deployment_name, name, None).await
}

#[cfg(test)]
mod tests {
    use super::{
        profile_id, valid_environment_name, validate_id, ConvexDeployment, ConvexProjects,
    };

    #[test]
    fn profile_ids_are_stable_and_validated() {
        let id = profile_id(42);
        assert_eq!(id.len(), 32);
        assert!(validate_id(&id).is_ok());
        assert_ne!(id, profile_id(43));
        assert!(validate_id("../projects").is_err());
    }

    #[test]
    fn management_resources_match_api_shapes() {
        let projects: ConvexProjects = serde_json::from_value(serde_json::json!({
            "items": [{
                "id": 42, "name": "Workspace", "slug": "workspace", "teamId": 7,
                "teamSlug": "example", "createTime": 0,
                "prodDeploymentName": "happy-otter-123"
            }],
            "pagination": {"hasMore": false}
        }))
        .unwrap();
        assert_eq!(projects.items[0].team_slug, "example");
        let deployment: ConvexDeployment = serde_json::from_value(serde_json::json!({
            "id": 12, "name": "happy-otter-123", "createTime": 0,
            "deploymentType": "prod", "projectId": 42, "region": "aws-us-east-1",
            "isDefault": true, "reference": "prod", "kind": "cloud",
            "deploymentUrl": "https://happy-otter-123.convex.cloud", "class": "s16"
        }))
        .unwrap();
        assert_eq!(
            deployment.deployment_url.as_deref(),
            Some("https://happy-otter-123.convex.cloud")
        );
    }

    #[test]
    fn environment_names_are_limited_to_identifiers() {
        assert!(valid_environment_name("API_KEY_2"));
        assert!(!valid_environment_name("2_API_KEY"));
        assert!(!valid_environment_name("A/B"));
    }
}
