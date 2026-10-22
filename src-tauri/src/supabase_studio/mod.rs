pub mod auth;
pub mod database;
pub mod edge;
pub mod observability;
pub mod settings;
pub mod sql;
pub mod storage;
pub mod tables;

use crate::supabase::{
    client, is_self_hosted, project_secret_key, quote_identifier, self_hosted_project, token,
    uses_pg_meta, validate_ref,
};
use serde::Serialize;
use serde_json::Value;

pub(crate) const MANAGEMENT_API: &str = "https://api.supabase.com/v1";

#[derive(Clone, Debug, Serialize)]
pub struct SupabaseStudioCapabilities {
    pub self_hosted: bool,
    pub sql: bool,
    pub management: bool,
    pub service_key: bool,
    pub data_api: bool,
}

#[tauri::command]
pub async fn supabase_studio_capabilities(
    reference: String,
) -> Result<SupabaseStudioCapabilities, String> {
    let reference = validate_ref(&reference)?;
    let self_hosted = is_self_hosted(reference);
    let data_api = project_secret_key(reference).await.is_ok();
    let service_key = if self_hosted {
        self_hosted_project(reference).await?.secret_key
    } else {
        data_api
    };
    Ok(SupabaseStudioCapabilities {
        self_hosted,
        sql: uses_pg_meta(reference).await?,
        management: !self_hosted,
        service_key,
        data_api,
    })
}

pub(crate) fn qualified(schema: &str, name: &str) -> Result<String, String> {
    Ok(format!(
        "{}.{}",
        quote_identifier(schema)?,
        quote_identifier(name)?
    ))
}

pub(crate) fn like_pattern(search: &str) -> String {
    let escaped = search
        .trim()
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

pub(crate) fn api_error(status: reqwest::StatusCode, body: &str, action: &str) -> String {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            ["message", "error", "msg"]
                .iter()
                .find_map(|key| value[*key].as_str().map(str::to_string))
        })
        .unwrap_or_else(|| body.to_string());
    let mut message = message.trim().chars().take(300).collect::<String>();
    if message.is_empty() {
        message = match status.as_u16() {
            401 => "Zugangstoken ungültig.",
            403 => "Für diese Aktion fehlen Berechtigungen.",
            404 => "Ressource nicht gefunden.",
            429 => "Supabase-Limit erreicht. Bitte später erneut versuchen.",
            _ => "Anfrage fehlgeschlagen.",
        }
        .to_string();
    }
    let separator = if action.is_empty() { "" } else { " " };
    format!(
        "Supabase HTTP {}: {action}{separator}{message}",
        status.as_u16()
    )
}

pub(crate) async fn checked(
    response: reqwest::Response,
    action: &str,
) -> Result<reqwest::Response, String> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    Err(api_error(status, &body, action))
}

pub(crate) async fn management(
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    action: &str,
) -> Result<reqwest::Response, String> {
    let mut request = client()
        .request(method, format!("{MANAGEMENT_API}/{path}"))
        .bearer_auth(token().await?);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Supabase ist nicht erreichbar: {error}"))?;
    checked(response, action).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_api_errors() {
        let status = reqwest::StatusCode::BAD_REQUEST;
        assert_eq!(
            api_error(status, r#"{"message":"bad max_rows"}"#, ""),
            "Supabase HTTP 400: bad max_rows"
        );
        assert_eq!(
            api_error(
                reqwest::StatusCode::FORBIDDEN,
                " ",
                "Deployment fehlgeschlagen."
            ),
            "Supabase HTTP 403: Deployment fehlgeschlagen. Für diese Aktion fehlen Berechtigungen."
        );
        assert_eq!(api_error(status, "nope", ""), "Supabase HTTP 400: nope");
        assert_eq!(like_pattern(" a%_\\b "), "%a\\%\\_\\\\b%");
    }
}
