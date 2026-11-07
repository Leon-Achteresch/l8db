use super::http::{self, Auth, Body};
use super::store::{self, Account, AuthMethod, CreatedConnection, Keychain, Provider, Vault};
use crate::db::spacetimedb::{self as stdb, ModuleSchema, Target};
use base64::Engine;
use futures_util::StreamExt;
use reqwest::Method;
use serde::Serialize;
use serde_json::Value;

const LABEL: &str = "SpacetimeDB";
pub(crate) const MAX_DATABASES: usize = 100;
const NAME_CONCURRENCY: usize = 4;
const LIST_LIMIT: usize = 512 * 1024;
const REDUCER_ARGS_LIMIT: usize = 64 * 1024;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct SpacetimeDatabase {
    pub identity: String,
    pub names: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct DatabaseList {
    pub databases: Vec<SpacetimeDatabase>,
    pub truncated: bool,
}

pub(crate) fn normalize_identity(raw: &str) -> Result<String, String> {
    let identity = raw.trim().trim_start_matches("0x").to_ascii_lowercase();
    if identity.len() != 64 || !identity.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Die SpacetimeDB-Identität muss aus 64 Hex-Zeichen bestehen.".into());
    }
    Ok(identity)
}

pub(crate) fn token_identity(token: &str, fallback: Option<&str>) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty() || token.len() > 8192 || token.chars().any(char::is_whitespace) {
        return Err("Bitte ein gültiges SpacetimeDB-Token eingeben.".into());
    }
    let fallback = fallback.map(str::trim).filter(|value| !value.is_empty());
    let payload = token
        .split('.')
        .nth(1)
        .ok_or("Das SpacetimeDB-Token ist kein JWT. Nutze `spacetime login show --token`.")?;
    let claims: Value = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .ok_or("Das SpacetimeDB-Token konnte nicht gelesen werden.")?;
    match (claims["hex_identity"].as_str(), fallback) {
        (Some(claimed), Some(given)) => {
            let claimed = normalize_identity(claimed)?;
            if claimed != normalize_identity(given)? {
                return Err("Die angegebene Identität passt nicht zum Token.".into());
            }
            Ok(claimed)
        }
        (Some(claimed), None) => normalize_identity(claimed),
        (None, Some(given)) => normalize_identity(given),
        (None, None) => Err(
            "Das Token enthält keine SpacetimeDB-Identität (hex_identity). Bitte die Identität aus `spacetime login show` angeben."
                .into(),
        ),
    }
}

fn base_of(account: &Account) -> Result<url::Url, String> {
    http::base_url(stdb::MAINCLOUD, account.endpoint.as_deref())
}

pub(crate) fn target(base: &url::Url, database: &str, token: &str) -> Result<Target, String> {
    Ok(Target {
        base: base.clone(),
        database: stdb::validate_database(database)?.to_string(),
        token: token.to_string(),
    })
}

pub(crate) async fn verify(base: &url::Url, identity: &str, token: &str) -> Result<(), String> {
    let url = http::endpoint(base, &["v1", "identity", identity, "verify"], &[])?;
    http::send(
        LABEL,
        &Auth::Bearer(token.to_string()),
        Method::GET,
        url,
        Body::Empty,
        16 * 1024,
    )
    .await
    .map(|_| ())
    .map_err(|error| {
        if error.is(400) || error.is(401) || error.is(403) {
            "SpacetimeDB hat das Token für diese Identität nicht bestätigt.".to_string()
        } else {
            error.message
        }
    })
}

pub(crate) async fn add(
    vault: &dyn Vault,
    label: &str,
    token: &str,
    endpoint: Option<&str>,
    identity: Option<&str>,
) -> Result<Account, String> {
    let token = token.trim();
    let identity = token_identity(token, identity)?;
    let endpoint = super::neon::custom_endpoint(stdb::MAINCLOUD, endpoint)?;
    let base = http::base_url(stdb::MAINCLOUD, endpoint.as_deref())?;
    verify(&base, &identity, token).await?;
    let label = store::clean_label(label, "SpacetimeDB")?;
    store::insert(
        vault,
        store::new_account(
            Provider::Spacetimedb,
            label,
            AuthMethod::Token,
            endpoint,
            Some(identity),
        ),
        token,
    )
    .await
}

fn string_list(value: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| value[*key].as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| match item {
                    Value::String(text) => Some(text.clone()),
                    Value::Object(_) => item["__identity__"].as_str().map(str::to_string),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) async fn databases_at(
    base: &url::Url,
    identity: &str,
    token: &str,
) -> Result<DatabaseList, String> {
    let auth = Auth::Bearer(token.to_string());
    let url = http::endpoint(base, &["v1", "identity", identity, "databases"], &[])?;
    let reply = http::send(LABEL, &auth, Method::GET, url, Body::Empty, LIST_LIMIT).await?;
    let mut identities = string_list(
        &stdb::parse_json(&reply.body)?,
        &["identities", "addresses", "databases"],
    );
    let truncated = identities.len() > MAX_DATABASES;
    identities.truncate(MAX_DATABASES);
    let names = futures_util::stream::iter(identities.into_iter().map(|database| {
        let auth = auth.clone();
        async move {
            let names = match http::endpoint(base, &["v1", "database", &database, "names"], &[]) {
                Ok(url) => http::send(LABEL, &auth, Method::GET, url, Body::Empty, LIST_LIMIT)
                    .await
                    .ok()
                    .and_then(|reply| stdb::parse_json(&reply.body).ok())
                    .map(|value| string_list(&value, &["names"]))
                    .unwrap_or_default(),
                Err(_) => Vec::new(),
            };
            SpacetimeDatabase {
                identity: database,
                names,
            }
        }
    }))
    .buffered(NAME_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    Ok(DatabaseList {
        databases: names,
        truncated,
    })
}

pub(crate) fn connection_string(base: &url::Url, database: &str) -> Result<String, String> {
    let database = stdb::validate_database(database)?;
    let host = base.host_str().ok_or("SpacetimeDB-Adresse ohne Host.")?;
    let port = base
        .port()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    let tls = if base.scheme() == "http" {
        "?tls=false"
    } else {
        ""
    };
    let encoded: String =
        percent_encoding::utf8_percent_encode(database, percent_encoding::NON_ALPHANUMERIC)
            .to_string();
    Ok(format!("spacetimedb://token@{host}{port}/{encoded}{tls}"))
}

pub(crate) async fn create_connection_at(
    vault: &dyn Vault,
    base: &url::Url,
    token: &str,
    database: &str,
    name: &str,
) -> Result<CreatedConnection, String> {
    let name = store::validate_connection_name(name)?;
    let connection_string = connection_string(base, database)?;
    stdb::database_info(&target(base, database, token)?).await?;
    let id = store::store_connection_password(vault, token).await?;
    Ok(CreatedConnection {
        id,
        name,
        kind: "spacetimedb",
        provider_id: "spacetimedb",
        connection_string,
        ssl_mode: if base.scheme() == "http" {
            "disable"
        } else {
            "require"
        },
    })
}

pub(crate) fn check_reducer_call(
    schema: &ModuleSchema,
    reducer: &str,
    args: &Value,
) -> Result<String, String> {
    let definition = schema
        .reducers
        .iter()
        .find(|candidate| candidate.name == reducer)
        .ok_or_else(|| format!("Reducer „{reducer}“ existiert in diesem Modul nicht."))?;
    if definition.lifecycle.is_some() {
        return Err("Lebenszyklus-Reducer (Init, Connect, Disconnect) können nicht manuell aufgerufen werden.".into());
    }
    let values = args
        .as_array()
        .ok_or("Argumente müssen als JSON-Array übergeben werden.")?;
    if values.len() != definition.params.len() {
        return Err(format!(
            "Reducer „{reducer}“ erwartet {} Argument(e), übergeben wurden {}.",
            definition.params.len(),
            values.len()
        ));
    }
    let body = serde_json::to_string(args).map_err(|_| "Argumente sind ungültig.".to_string())?;
    if body.len() > REDUCER_ARGS_LIMIT {
        return Err("Die Argumente sind größer als 64 KB.".into());
    }
    Ok(body)
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct ReducerOutcome {
    pub status: u16,
    pub message: Option<String>,
}

pub(crate) async fn call_reducer_at(
    target: &Target,
    reducer: &str,
    args: &Value,
    confirmed: bool,
) -> Result<ReducerOutcome, String> {
    if !confirmed {
        return Err("Reducer verändern Daten. Bitte den Aufruf bestätigen.".into());
    }
    let schema = stdb::module_schema(target).await?;
    let body = check_reducer_call(&schema, reducer, args)?;
    let url = http::endpoint(
        &target.base,
        &["v1", "database", &target.database, "call", reducer],
        &[],
    )?;
    let value: Value =
        serde_json::from_str(&body).map_err(|_| "Argumente sind ungültig.".to_string())?;
    let reply = http::send(
        LABEL,
        &target.auth(),
        Method::POST,
        url,
        Body::Json(value),
        REDUCER_ARGS_LIMIT,
    )
    .await?;
    let message = String::from_utf8_lossy(&reply.body).trim().to_string();
    Ok(ReducerOutcome {
        status: reply.status,
        message: (!message.is_empty()).then(|| http::redact(&message, Some(&target.token))),
    })
}

async fn open(account_id: &str) -> Result<(Account, url::Url, String), String> {
    let account = store::find_for(&Keychain, account_id, Provider::Spacetimedb).await?;
    let token = store::credential(&Keychain, &account).await?;
    let base = base_of(&account)?;
    Ok((account, base, token))
}

#[tauri::command]
pub async fn cloud_spacetime_add(
    label: String,
    token: String,
    endpoint: Option<String>,
    identity: Option<String>,
) -> Result<Account, String> {
    add(
        &Keychain,
        &label,
        &token,
        endpoint.as_deref(),
        identity.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn cloud_spacetime_databases(account_id: String) -> Result<DatabaseList, String> {
    let (account, base, token) = open(&account_id).await?;
    let identity = account
        .identity
        .ok_or("Für dieses Konto ist keine Identität gespeichert.")?;
    databases_at(&base, &identity, &token).await
}

#[tauri::command]
pub async fn cloud_spacetime_schema(
    account_id: String,
    database: String,
) -> Result<ModuleSchema, String> {
    let (_, base, token) = open(&account_id).await?;
    stdb::module_schema(&target(&base, &database, &token)?).await
}

#[tauri::command]
pub async fn cloud_spacetime_create_connection(
    account_id: String,
    database: String,
    name: String,
) -> Result<CreatedConnection, String> {
    let (_, base, token) = open(&account_id).await?;
    create_connection_at(&Keychain, &base, &token, &database, &name).await
}

#[tauri::command]
pub async fn cloud_spacetime_call_reducer(
    account_id: String,
    database: String,
    reducer: String,
    args: Value,
    confirmed: bool,
) -> Result<ReducerOutcome, String> {
    let (_, base, token) = open(&account_id).await?;
    call_reducer_at(
        &target(&base, &database, &token)?,
        &reducer,
        &args,
        confirmed,
    )
    .await
}
