use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::db::DatabaseKind;

pub const APP_IDENTIFIER: &str = "com.leon.l8db";
pub const KEYCHAIN_SERVICE: &str = "l8db";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RedactRule {
    pub name: String,
    pub pattern: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Redaction {
    pub columns: Vec<RedactRule>,
    pub values: Vec<RedactRule>,
    pub replacement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpConnection {
    pub id: String,
    pub name: String,
    pub kind: DatabaseKind,
    pub connection_string: String,
    #[serde(default)]
    pub schemas: Vec<String>,
    #[serde(default)]
    pub ssh: bool,
    #[serde(default)]
    pub exposed: bool,
    #[serde(default = "yes")]
    pub read_only: bool,
    #[serde(default)]
    pub allow_ddl: bool,
    #[serde(default)]
    pub redact_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_max_rows")]
    pub max_rows: usize,
    #[serde(default = "default_max_cell_chars")]
    pub max_cell_chars: usize,
    #[serde(default = "default_max_chars")]
    pub max_chars: usize,
    #[serde(default = "default_query_timeout")]
    pub query_timeout: u64,
    #[serde(default = "default_redaction")]
    pub redaction: Redaction,
    #[serde(default)]
    pub connections: Vec<McpConnection>,
}

fn yes() -> bool {
    true
}
fn default_max_rows() -> usize {
    50
}
fn default_max_cell_chars() -> usize {
    200
}
fn default_max_chars() -> usize {
    20_000
}
fn default_query_timeout() -> u64 {
    30
}

const COLUMN_RULES: &[(&str, &str)] = &[
    ("Passwörter", r"pass(word|wd|phrase)?|pwd|kennwort"),
    (
        "Secrets & Tokens",
        r"secret|token|api[_-]?key|apikey|auth|credential|private[_-]?key|session|cookie|otp|pin\b",
    ),
    ("Hashes & Salts", r"\bhash|salt"),
    (
        "Sozialversicherung",
        r"\bssn\b|social[_-]?security|sozialversicherung|svnr",
    ),
    (
        "Bankdaten",
        r"\biban\b|\bbic\b|swift|kontonummer|account[_-]?number|routing",
    ),
    (
        "Kartendaten",
        r"credit[_-]?card|card[_-]?number|cardnumber|\bpan\b|cvv|cvc|expir",
    ),
    ("E-Mail", r"e[_-]?mail"),
    ("Telefon", r"phone|mobile|\btel\b|telefon|\bfax\b|handy"),
    (
        "Adresse",
        r"address|adresse|street|stra(ss|ß)e|\bzip\b|postal|\bplz\b|hausnummer",
    ),
    ("Geburtsdatum", r"birth|\bdob\b|geburt"),
    (
        "Personennamen",
        r"first[_-]?name|last[_-]?name|surname|vorname|nachname|full[_-]?name",
    ),
    ("Finanzen", r"salary|income|gehalt|\btax|steuer|lohn"),
    (
        "Ausweise",
        r"passport|licen[cs]e|national[_-]?id|ausweis|personalausweis|reisepass",
    ),
    ("Gesundheit", r"diagnos|medical|health|krankheit|gesundheit"),
];

const VALUE_RULES: &[(&str, &str)] = &[
    (
        "E-Mail-Adressen",
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
    ),
    (
        "IBAN",
        r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b",
    ),
    ("Kreditkartennummern", r"\b(?:\d[ -]?){12,18}\d\b"),
    ("Telefonnummern", r"(?:\+|\b0)\d[\d\s/().-]{6,}\d"),
    ("US-SSN", r"\b\d{3}-\d{2}-\d{4}\b"),
    (
        "JWT",
        r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
    ),
    ("AWS-Schlüssel", r"\bAKIA[0-9A-Z]{16}\b"),
    (
        "API-Tokens",
        r"\b(?:sk|pk|ghp|gho|glpat|xox[abp])[-_][A-Za-z0-9_-]{16,}",
    ),
    ("Bearer-Tokens", r"(?i)bearer\s+[A-Za-z0-9._~+/-]{16,}=*"),
    (
        "Passwort-Hashes",
        r"\$(?:2[aby]|argon2(?:id|i|d)|pbkdf2|scrypt)\$[^\s]{20,}|\b[a-f0-9]{32}\b|\b[a-f0-9]{40}\b|\b[a-f0-9]{64}\b",
    ),
    ("IPv4-Adressen", r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
];

fn rules(list: &[(&str, &str)]) -> Vec<RedactRule> {
    list.iter()
        .map(|(name, pattern)| RedactRule {
            name: (*name).into(),
            pattern: (*pattern).into(),
            enabled: true,
        })
        .collect()
}

fn default_redaction() -> Redaction {
    Redaction {
        columns: rules(COLUMN_RULES),
        values: rules(VALUE_RULES),
        replacement: "[redacted]".into(),
    }
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            max_rows: default_max_rows(),
            max_cell_chars: default_max_cell_chars(),
            max_chars: default_max_chars(),
            query_timeout: default_query_timeout(),
            redaction: default_redaction(),
            connections: Vec::new(),
        }
    }
}

pub fn config_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    if cfg!(target_os = "macos") {
        home.join("Library/Application Support")
            .join(APP_IDENTIFIER)
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Roaming"))
            .join(APP_IDENTIFIER)
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"))
            .join(APP_IDENTIFIER)
    }
}

pub fn config_path() -> PathBuf {
    std::env::var_os("L8DB_MCP_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| config_dir().join("mcp.json"))
}

pub fn audit_path() -> PathBuf {
    config_path().with_file_name("mcp-audit.jsonl")
}

pub fn load() -> McpConfig {
    std::fs::read(config_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn restrict(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

pub fn save(config: &McpConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Config-Ordner: {e}"))?;
    }
    let json = serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("mcp.json schreiben: {e}"))?;
    restrict(&path);
    Ok(())
}

#[tauri::command]
pub fn mcp_config() -> McpConfig {
    load()
}

#[tauri::command]
pub fn mcp_save_config(config: McpConfig) -> Result<(), String> {
    for rule in config
        .redaction
        .columns
        .iter()
        .chain(&config.redaction.values)
    {
        regex::Regex::new(&rule.pattern)
            .map_err(|e| format!("Ungültiges Muster „{}“: {e}", rule.name))?;
    }
    save(&config)
}

#[tauri::command]
pub fn mcp_default_redaction() -> Redaction {
    default_redaction()
}

#[tauri::command]
pub fn mcp_redact_preview(config: McpConfig, column: String, text: String) -> String {
    let redactor = super::redact::Redactor::new(&config.redaction, &[]);
    match redactor.redact_cell(&column, &serde_json::Value::String(text)) {
        serde_json::Value::String(out) => out,
        other => other.to_string(),
    }
}

#[tauri::command]
pub fn mcp_audit_tail(lines: usize) -> Vec<serde_json::Value> {
    let Ok(text) = std::fs::read_to_string(audit_path()) else {
        return Vec::new();
    };
    let all: Vec<&str> = text.lines().collect();
    all.iter()
        .rev()
        .take(lines.clamp(1, 500))
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

#[tauri::command]
pub fn mcp_clear_audit() -> Result<(), String> {
    match std::fs::remove_file(audit_path()) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_rules_compile() {
        for rule in default_redaction()
            .columns
            .iter()
            .chain(&default_redaction().values)
        {
            regex::Regex::new(&rule.pattern).unwrap_or_else(|e| panic!("{}: {e}", rule.name));
        }
    }

    #[cfg(unix)]
    #[test]
    fn restrict_sets_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("l8db-perm-{}.json", std::process::id()));
        std::fs::write(&path, "{}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        restrict(&path);
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn config_roundtrip_fills_defaults() {
        let parsed: McpConfig =
            serde_json::from_str(r#"{"connections":[{"id":"a","name":"A","kind":"postgres","connectionString":"postgres://u@h/db"}]}"#)
                .unwrap();
        assert!(!parsed.enabled);
        assert_eq!(parsed.max_rows, 50);
        assert!(parsed.connections[0].read_only);
        assert!(!parsed.connections[0].exposed);
        assert_eq!(parsed.redaction.columns.len(), COLUMN_RULES.len());
        let json = serde_json::to_string(&parsed).unwrap();
        assert_eq!(serde_json::from_str::<McpConfig>(&json).unwrap(), parsed);
    }
}
