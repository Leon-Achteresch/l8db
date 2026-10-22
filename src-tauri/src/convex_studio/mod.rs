pub mod data;
pub mod files;
pub mod functions;
pub mod logs;
pub mod schedules;
pub mod settings;

use crate::convex::{client, deployment_endpoint, profile_and_token};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

pub(crate) const CONVEX_CLIENT: &str = concat!("l8db-", env!("CARGO_PKG_VERSION"));
const ACCESS_TTL: Duration = Duration::from_secs(300);
const MAX_CACHED_ACCESS: usize = 64;

type AccessKey = (String, u64, String);

static ACCESS: LazyLock<Mutex<HashMap<AccessKey, (Instant, ConvexDeploymentAccess)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone)]
pub(crate) struct ConvexDeploymentAccess {
    pub url: reqwest::Url,
    pub token: String,
}

pub(crate) async fn deployment(
    id: &str,
    project_id: u64,
    deployment_name: &str,
) -> Result<ConvexDeploymentAccess, String> {
    let key = (id.to_string(), project_id, deployment_name.to_string());
    if let Some((at, access)) = ACCESS.lock().unwrap().get(&key) {
        if at.elapsed() < ACCESS_TTL {
            return Ok(access.clone());
        }
    }
    let (profile, token) = profile_and_token(id).await?;
    let url = deployment_endpoint(&profile, &token, project_id, deployment_name).await?;
    let access = ConvexDeploymentAccess { url, token };
    let mut cache = ACCESS.lock().unwrap();
    cache.retain(|_, (at, _)| at.elapsed() < ACCESS_TTL);
    if cache.len() >= MAX_CACHED_ACCESS {
        cache.clear();
    }
    cache.insert(key, (Instant::now(), access.clone()));
    Ok(access)
}

pub(crate) fn forget_access(id: &str) {
    ACCESS
        .lock()
        .unwrap()
        .retain(|(cached, _, _), _| cached != id);
}

impl ConvexDeploymentAccess {
    pub(crate) fn endpoint(&self, path: &str) -> Result<reqwest::Url, String> {
        self.url
            .join(path)
            .map_err(|_| "Ungültiger Convex-Pfad.".to_string())
    }

    pub(crate) fn request(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> Result<reqwest::RequestBuilder, String> {
        Ok(client()
            .request(method, self.endpoint(path)?)
            .header("Authorization", format!("Convex {}", self.token))
            .header("Convex-Client", CONVEX_CLIENT))
    }

    pub(crate) async fn json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, String> {
        let mut request = self.request(method, path)?;
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Convex-Deployment ist nicht erreichbar.".to_string())?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|_| "Convex hat keine Antwort geliefert.".to_string())?;
        if !status.is_success() {
            return Err(convex_error(status.as_u16(), &text));
        }
        if text.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text).map_err(|_| "Convex hat unerwartete Daten geliefert.".into())
    }

    pub(crate) async fn run_function(
        &self,
        kind: &str,
        path: &str,
        args: Value,
    ) -> Result<Value, String> {
        if !matches!(kind, "query" | "mutation" | "action") {
            return Err("Ungültige Convex-Funktionsart.".into());
        }
        let body = serde_json::json!({"path": path, "args": args, "format": "json"});
        let result = self
            .json(reqwest::Method::POST, &format!("api/{kind}"), Some(&body))
            .await?;
        match result.get("status").and_then(Value::as_str) {
            Some("success") => Ok(result.get("value").cloned().unwrap_or(Value::Null)),
            _ => Err(result
                .get("errorMessage")
                .and_then(Value::as_str)
                .unwrap_or("Convex-Funktion fehlgeschlagen.")
                .to_string()),
        }
    }
}

pub(crate) fn convex_error(status: u16, body: &str) -> String {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .or_else(|| value.get("errorMessage"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(300).collect());
    if message.trim().is_empty() {
        format!("Convex HTTP {status}: Anfrage fehlgeschlagen.")
    } else {
        format!("Convex HTTP {status}: {message}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cached_access_is_reused_and_forgotten_per_profile() {
        let access = ConvexDeploymentAccess {
            url: reqwest::Url::parse("https://cached.convex.cloud/").unwrap(),
            token: "token".into(),
        };
        for id in ["cached-a", "cached-b"] {
            ACCESS.lock().unwrap().insert(
                (id.into(), 7, "dep".into()),
                (Instant::now(), access.clone()),
            );
        }
        let hit = deployment("cached-a", 7, "dep").await.unwrap();
        assert_eq!(hit.url.as_str(), "https://cached.convex.cloud/");
        forget_access("cached-a");
        let cache = ACCESS.lock().unwrap();
        assert!(!cache.contains_key(&("cached-a".into(), 7, "dep".into())));
        assert!(cache.contains_key(&("cached-b".into(), 7, "dep".into())));
    }

    #[test]
    fn convex_errors_prefer_message_fields() {
        assert_eq!(
            convex_error(400, r#"{"code":"BadRequest","message":"Nope"}"#),
            "Convex HTTP 400: Nope"
        );
        assert_eq!(
            convex_error(500, ""),
            "Convex HTTP 500: Anfrage fehlgeschlagen."
        );
        assert_eq!(
            convex_error(502, "bad gateway"),
            "Convex HTTP 502: bad gateway"
        );
    }
}
