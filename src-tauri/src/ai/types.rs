use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub provider: String,
    #[serde(default)]
    pub binary: String,
    #[serde(default)]
    pub home: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub approval: String,
    #[serde(default)]
    pub config: std::collections::HashMap<String, Value>,
    #[serde(default)]
    pub pricing: Option<Pricing>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pricing {
    pub model: String,
    pub input_usd: Option<f64>,
    pub output_usd: Option<f64>,
    pub cached_input_usd: Option<f64>,
    pub cache_write_usd: Option<f64>,
    pub context_window: Option<u64>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionContext {
    pub id: String,
    pub name: String,
    pub kind: crate::db::DatabaseKind,
    pub connection_string: String,
    pub database: Option<String>,
    #[serde(default)]
    pub schemas: Vec<String>,
    #[serde(default)]
    pub read_only: bool,
    pub environment: Option<String>,
    #[serde(default)]
    pub mask_rules: Vec<crate::mcp::config::RedactRule>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Message {
    pub role: String,
    pub text: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalServer {
    pub id: String,
    pub name: String,
    pub transport: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub url: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub run_id: String,
    pub profile: Profile,
    pub cwd: String,
    pub session_id: Option<String>,
    pub messages: Vec<Message>,
    pub connections: Vec<ConnectionContext>,
    pub active_id: Option<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub servers: Vec<ExternalServer>,
    #[serde(default)]
    pub allow_writes: bool,
    #[serde(default)]
    pub allow_ddl: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub kind: String,
    pub data: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: String,
    pub installed: bool,
    pub version: Option<String>,
    pub key_stored: bool,
}

#[derive(Serialize)]
pub struct Skill {
    pub name: String,
    pub path: String,
}
