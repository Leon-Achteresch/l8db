use super::management;
use crate::supabase::{
    cloud_ref, database_query, is_self_hosted, management_get, project_secret_key,
    self_hosted_project, supabase_connect_self_hosted, supabase_functions, token, uses_pg_meta,
    validate_ref, SupabaseProject,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

const STAT_LIMIT: i64 = 10_000;
const MAX_ROWS_LIMIT: u32 = 1_000_000;
const SIZE_SETTINGS: [&str; 6] = [
    "effective_cache_size",
    "maintenance_work_mem",
    "shared_buffers",
    "work_mem",
    "max_wal_size",
    "wal_keep_size",
];
const TIME_SETTINGS: [&str; 3] = [
    "statement_timeout",
    "checkpoint_timeout",
    "wal_sender_timeout",
];
const INT_SETTINGS: [&str; 9] = [
    "max_connections",
    "max_locks_per_transaction",
    "max_parallel_maintenance_workers",
    "max_parallel_workers",
    "max_parallel_workers_per_gather",
    "max_replication_slots",
    "max_slot_wal_keep_size",
    "max_wal_senders",
    "max_worker_processes",
];
const REPLICATION_ROLES: [&str; 3] = ["origin", "replica", "local"];

#[derive(Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct SettingsOverviewStats {
    pub database_size: Option<f64>,
    pub table_count: Option<i64>,
    pub auth_user_count: Option<i64>,
    pub bucket_count: Option<i64>,
    pub function_count: Option<i64>,
    pub limit: i64,
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct StatsRow {
    database_size: Option<f64>,
    table_count: Option<i64>,
    auth_user_count: Option<i64>,
    bucket_count: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SettingsApiKey {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PostgrestUpdate {
    pub db_schema: String,
    pub max_rows: u32,
    pub db_extra_search_path: String,
}

fn stats_sql() -> String {
    let limit = STAT_LIMIT + 1;
    format!(
        "select pg_database_size(current_database())::float8 as database_size, \
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace \
          where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema', \
          'auth', 'storage', 'realtime', '_realtime', 'supabase_functions', 'supabase_migrations', \
          'extensions', 'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks', 'vault', \
          'cron', 'pgbouncer', '_analytics', '_supavisor') and n.nspname not like 'pg\\_%')::int as table_count, \
         (select count(*) from (select 1 from auth.users limit {limit}) s)::int as auth_user_count, \
         (select count(*) from (select 1 from storage.buckets limit {limit}) s)::int as bucket_count"
    )
}

fn validate_name_list(raw: &str, label: &str, allow_empty: bool) -> Result<String, String> {
    let names = raw
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    if names.is_empty() && !allow_empty {
        return Err(format!("{label}: mindestens ein Schema angeben."));
    }
    if names.len() > 50
        || names.iter().any(|name| {
            name.len() > 63
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$')
        })
    {
        return Err(format!(
            "{label}: nur Schemanamen aus Buchstaben, Ziffern, _ und $ durch Komma getrennt."
        ));
    }
    Ok(names.join(","))
}

fn postgrest_body(update: &PostgrestUpdate) -> Result<Value, String> {
    if update.max_rows == 0 || update.max_rows > MAX_ROWS_LIMIT {
        return Err(format!(
            "Maximale Zeilen müssen zwischen 1 und {MAX_ROWS_LIMIT} liegen."
        ));
    }
    Ok(serde_json::json!({
        "db_schema": validate_name_list(&update.db_schema, "Exponierte Schemas", false)?,
        "max_rows": update.max_rows,
        "db_extra_search_path": validate_name_list(&update.db_extra_search_path, "Zusätzlicher Suchpfad", true)?,
    }))
}

fn unit_value(value: &str, units: &[&str]) -> bool {
    let digits = value.trim_end_matches(|c: char| c.is_ascii_alphabetic());
    let unit = &value[digits.len()..];
    !digits.is_empty()
        && digits.len() <= 12
        && digits.bytes().all(|byte| byte.is_ascii_digit())
        && (unit.is_empty() || units.contains(&unit))
}

fn postgres_config_body(
    settings: &HashMap<String, String>,
    restart_database: bool,
) -> Result<Value, String> {
    if settings.is_empty() {
        return Err("Keine Einstellung geändert.".into());
    }
    let mut body = Map::new();
    for (key, raw) in settings {
        let value = raw.trim();
        let invalid = || format!("Ungültiger Wert für {key}.");
        let json = if SIZE_SETTINGS.contains(&key.as_str()) {
            unit_value(value, &["kB", "MB", "GB", "TB"])
                .then(|| Value::String(value.to_string()))
                .ok_or_else(invalid)?
        } else if TIME_SETTINGS.contains(&key.as_str()) {
            unit_value(value, &["ms", "s", "min", "h", "d"])
                .then(|| Value::String(value.to_string()))
                .ok_or_else(invalid)?
        } else if INT_SETTINGS.contains(&key.as_str()) {
            let number = value
                .parse::<i64>()
                .ok()
                .filter(|number| (-1..=1_000_000_000).contains(number))
                .ok_or_else(invalid)?;
            Value::from(number)
        } else if key == "session_replication_role" {
            REPLICATION_ROLES
                .contains(&value)
                .then(|| Value::String(value.to_string()))
                .ok_or_else(invalid)?
        } else {
            return Err(format!("Einstellung {key} wird nicht unterstützt."));
        };
        body.insert(key.clone(), json);
    }
    body.insert("restart_database".into(), Value::Bool(restart_database));
    Ok(Value::Object(body))
}

async fn management_send(
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let text = management(method, path, body, "")
        .await?
        .text()
        .await
        .map_err(|_| "Supabase hat unerwartete Daten geliefert.".to_string())?;
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|_| "Supabase hat unerwartete Daten geliefert.".into())
}

async fn cloud_get(reference: &str, path: &str) -> Result<Value, String> {
    let reference = cloud_ref(reference)?;
    management_get(&token().await?, &format!("projects/{reference}/{path}")).await
}

#[tauri::command]
pub async fn supabase_studio_settings_overview_stats(
    reference: String,
) -> Result<SettingsOverviewStats, String> {
    let reference = validate_ref(&reference)?.to_string();
    let mut stats = SettingsOverviewStats {
        limit: STAT_LIMIT,
        ..Default::default()
    };
    let sql = async {
        if uses_pg_meta(&reference).await? {
            database_query::<StatsRow>(&reference, &stats_sql(), &[])
                .await
                .map(|rows| rows.into_iter().next())
        } else {
            Ok(None)
        }
    };
    let functions = async {
        if is_self_hosted(&reference) {
            Ok(None)
        } else {
            supabase_functions(reference.clone())
                .await
                .map(|items| Some(items.len() as i64))
        }
    };
    let (sql, functions) = tokio::join!(sql, functions);
    match sql {
        Ok(Some(row)) => {
            stats.database_size = row.database_size;
            stats.table_count = row.table_count;
            stats.auth_user_count = row.auth_user_count;
            stats.bucket_count = row.bucket_count;
        }
        Ok(None) => {}
        Err(error) => stats.errors.push(error),
    }
    match functions {
        Ok(count) => stats.function_count = count,
        Err(error) => stats.errors.push(error),
    }
    Ok(stats)
}

#[tauri::command]
pub async fn supabase_studio_settings_reveal_key(reference: String) -> Result<String, String> {
    let reference = validate_ref(&reference)?;
    let key = project_secret_key(reference).await?;
    let secret = !is_self_hosted(reference) || self_hosted_project(reference).await?.secret_key;
    Ok(if secret { mask_key(&key) } else { key })
}

fn mask_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() < 24 {
        return "•".repeat(12);
    }
    let start: String = chars[..8].iter().collect();
    let end: String = chars[chars.len() - 4..].iter().collect();
    format!("{start}{}{end}", "•".repeat(12))
}

#[tauri::command]
pub async fn supabase_studio_settings_api_keys(
    reference: String,
) -> Result<Vec<SettingsApiKey>, String> {
    let keys: Vec<SettingsApiKey> =
        serde_json::from_value(cloud_get(&reference, "api-keys").await?)
            .map_err(|_| "Supabase hat unerwartete Daten geliefert.".to_string())?;
    Ok(keys
        .into_iter()
        .take(50)
        .map(|key| {
            let public = matches!(key.kind.as_deref(), Some("publishable"))
                || key.name.as_deref() == Some("anon");
            SettingsApiKey {
                api_key: key.api_key.filter(|_| public),
                ..key
            }
        })
        .collect())
}

#[tauri::command]
pub async fn supabase_studio_settings_replace_self_hosted_key(
    reference: String,
    api_key: String,
) -> Result<SupabaseProject, String> {
    let reference = validate_ref(&reference)?;
    if !is_self_hosted(reference) {
        return Err("Nur für selbst gehostete Supabase-Instanzen.".into());
    }
    let project = self_hosted_project(reference).await?;
    let updated = supabase_connect_self_hosted(project.url, api_key, project.name).await?;
    if updated.reference != reference {
        return Err("Die Projekt-URL hat sich unerwartet geändert.".into());
    }
    Ok(updated)
}

#[tauri::command]
pub async fn supabase_studio_settings_postgrest(reference: String) -> Result<Value, String> {
    cloud_get(&reference, "postgrest").await
}

#[tauri::command]
pub async fn supabase_studio_settings_update_postgrest(
    reference: String,
    update: PostgrestUpdate,
) -> Result<Value, String> {
    let reference = cloud_ref(&reference)?;
    let body = postgrest_body(&update)?;
    management_send(
        reqwest::Method::PATCH,
        &format!("projects/{reference}/postgrest"),
        Some(body),
    )
    .await
}

#[tauri::command]
pub async fn supabase_studio_settings_postgres_config(reference: String) -> Result<Value, String> {
    cloud_get(&reference, "config/database/postgres").await
}

#[tauri::command]
pub async fn supabase_studio_settings_update_postgres_config(
    reference: String,
    settings: HashMap<String, String>,
    restart_database: bool,
) -> Result<Value, String> {
    let reference = cloud_ref(&reference)?;
    let body = postgres_config_body(&settings, restart_database)?;
    management_send(
        reqwest::Method::PUT,
        &format!("projects/{reference}/config/database/postgres"),
        Some(body),
    )
    .await
}

#[tauri::command]
pub async fn supabase_studio_settings_pooler(reference: String) -> Result<Value, String> {
    cloud_get(&reference, "config/database/pooler").await
}

#[tauri::command]
pub async fn supabase_studio_settings_ssl_enforcement(reference: String) -> Result<Value, String> {
    cloud_get(&reference, "ssl-enforcement").await
}

#[tauri::command]
pub async fn supabase_studio_settings_update_ssl_enforcement(
    reference: String,
    enabled: bool,
) -> Result<Value, String> {
    let reference = cloud_ref(&reference)?;
    management_send(
        reqwest::Method::PUT,
        &format!("projects/{reference}/ssl-enforcement"),
        Some(serde_json::json!({ "requestedConfig": { "database": enabled } })),
    )
    .await
}

#[tauri::command]
pub async fn supabase_studio_settings_network_restrictions(
    reference: String,
) -> Result<Value, String> {
    cloud_get(&reference, "network-restrictions").await
}

#[tauri::command]
pub async fn supabase_studio_settings_set_paused(
    reference: String,
    paused: bool,
    confirm_name: String,
) -> Result<(), String> {
    let reference = cloud_ref(&reference)?;
    let project: Value = management_get(&token().await?, &format!("projects/{reference}")).await?;
    if project["name"].as_str() != Some(confirm_name.trim()) {
        return Err("Der eingegebene Projektname stimmt nicht überein.".into());
    }
    let action = if paused { "pause" } else { "restore" };
    management_send(
        reqwest::Method::POST,
        &format!("projects/{reference}/{action}"),
        None,
    )
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_secret_keys() {
        let key = "sb_secret_abcdefghijklmnopqrstuvwxyz1234";
        let masked = mask_key(key);
        assert!(masked.starts_with("sb_secre"));
        assert!(masked.ends_with("1234"));
        assert!(!masked.contains("abcdefghijklmnop"));
        assert_eq!(mask_key("short"), "•".repeat(12));
    }

    #[test]
    fn validates_postgrest_update() {
        let body = postgrest_body(&PostgrestUpdate {
            db_schema: " public, graphql_public ".into(),
            max_rows: 1000,
            db_extra_search_path: "".into(),
        })
        .unwrap();
        assert_eq!(body["db_schema"], "public,graphql_public");
        assert_eq!(body["db_extra_search_path"], "");
        for (schema, rows) in [
            ("", 10),
            ("public;drop", 10),
            ("public", 0),
            ("public", 2_000_000),
        ] {
            assert!(postgrest_body(&PostgrestUpdate {
                db_schema: schema.into(),
                max_rows: rows,
                db_extra_search_path: "extensions".into(),
            })
            .is_err());
        }
    }

    #[test]
    fn validates_postgres_config() {
        let settings = HashMap::from([
            ("work_mem".to_string(), "64MB".to_string()),
            ("statement_timeout".to_string(), "8s".to_string()),
            ("max_connections".to_string(), "120".to_string()),
            (
                "session_replication_role".to_string(),
                "replica".to_string(),
            ),
        ]);
        let body = postgres_config_body(&settings, true).unwrap();
        assert_eq!(body["work_mem"], "64MB");
        assert_eq!(body["max_connections"], 120);
        assert_eq!(body["restart_database"], true);
        for (key, value) in [
            ("work_mem", "64XB"),
            ("work_mem", "MB"),
            ("statement_timeout", "1; drop"),
            ("max_connections", "lots"),
            ("session_replication_role", "admin"),
            ("listen_addresses", "*"),
        ] {
            let settings = HashMap::from([(key.to_string(), value.to_string())]);
            assert!(
                postgres_config_body(&settings, false).is_err(),
                "{key}={value}"
            );
        }
        assert!(postgres_config_body(&HashMap::new(), false).is_err());
    }

    #[test]
    fn bounds_stats_sql() {
        let sql = stats_sql();
        assert!(sql.contains("limit 10001"));
        assert!(!sql.contains(';'));
    }

    #[tokio::test]
    #[ignore]
    async fn supabase_studio_settings_live() {
        use crate::baas_self_hosted_live_tests::{env, isolate_secrets, latency};
        let (Some(url), Some(key)) = (env("L8DB_E2E_SUPABASE_URL"), env("L8DB_E2E_SUPABASE_KEY"))
        else {
            return;
        };
        let _secrets = isolate_secrets();
        let reference = supabase_connect_self_hosted(url, key.clone(), "Lab".into())
            .await
            .unwrap()
            .reference;
        let stats = supabase_studio_settings_overview_stats(reference.clone())
            .await
            .unwrap();
        assert!(stats.errors.is_empty(), "{:?}", stats.errors);
        assert!(stats.database_size.unwrap() > 0.0);
        assert!(stats.table_count.is_some());
        assert!(stats.auth_user_count.unwrap() <= STAT_LIMIT + 1);
        assert!(stats.bucket_count.is_some());
        assert_eq!(stats.function_count, None);
        latency("settings overview stats", 500, || {
            let reference = reference.clone();
            async move {
                supabase_studio_settings_overview_stats(reference)
                    .await
                    .unwrap();
            }
        })
        .await;
        assert_eq!(
            supabase_studio_settings_reveal_key(reference.clone())
                .await
                .unwrap(),
            mask_key(&key)
        );
        assert!(supabase_studio_settings_postgrest(reference.clone())
            .await
            .unwrap_err()
            .contains("selbst gehosteten"));
        assert!(
            supabase_studio_settings_set_paused(reference.clone(), true, "Lab".into())
                .await
                .is_err()
        );
        assert!(supabase_studio_settings_replace_self_hosted_key(
            reference.clone(),
            "sb_publishable_invalid".into()
        )
        .await
        .is_err());
        assert_eq!(
            supabase_studio_settings_reveal_key(reference.clone())
                .await
                .unwrap(),
            mask_key(&key)
        );
        if let Some(public) = env("L8DB_E2E_SUPABASE_PUBLIC_KEYS")
            .and_then(|keys| keys.split(',').next().map(str::to_string))
        {
            let project =
                supabase_studio_settings_replace_self_hosted_key(reference.clone(), public.clone())
                    .await
                    .unwrap();
            assert!(!project.secret_key);
            assert_eq!(project.name, "Lab");
            assert_eq!(
                supabase_studio_settings_reveal_key(reference.clone())
                    .await
                    .unwrap(),
                public
            );
            let stats = supabase_studio_settings_overview_stats(reference.clone())
                .await
                .unwrap();
            assert_eq!(stats.database_size, None);
            let project =
                supabase_studio_settings_replace_self_hosted_key(reference.clone(), key.clone())
                    .await
                    .unwrap();
            assert!(project.secret_key);
        }
        crate::supabase::supabase_disconnect_self_hosted(reference)
            .await
            .unwrap();
    }
}
