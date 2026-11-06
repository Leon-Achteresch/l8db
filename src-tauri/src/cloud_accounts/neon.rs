use super::http::{self, ApiError, Auth, Body};
use super::store::{self, Account, AuthMethod, CreatedConnection, Keychain, Provider, Vault};
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

pub(crate) const API: &str = "https://console.neon.tech/api/v2/";
const LABEL: &str = "Neon";
pub(crate) const PROJECT_PAGE: usize = 100;
pub(crate) const FUNCTION_PAGE: usize = 50;
pub(crate) const OBJECT_PAGE: usize = 100;
pub(crate) const AUTH_USER_PAGE: i64 = 50;
pub(crate) const AUTH_KEYS: &str = "auth-keys";

pub(crate) struct Client {
    pub base: url::Url,
    pub auth: Auth,
    pub custom: bool,
}

pub(crate) fn validate_id<'a>(value: &'a str, what: &str) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return Err(format!("Ungültige {what}."));
    }
    Ok(value)
}

pub(crate) fn validate_name<'a>(value: &'a str, what: &str) -> Result<&'a str, String> {
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(format!("Ungültiger Name für {what}."));
    }
    Ok(value)
}

fn beta(error: ApiError, feature: &str) -> String {
    if error.is(403) || error.is(404) {
        format!(
            "{feature} ist für dieses Konto oder diesen Branch nicht verfügbar (Beta-Funktion oder fehlende Berechtigung). {}",
            error.message
        )
    } else {
        error.message
    }
}

impl Client {
    pub(crate) fn new(base: url::Url, token: String) -> Self {
        Self {
            custom: http::is_custom(API, &base),
            base,
            auth: Auth::Bearer(token),
        }
    }

    fn url(&self, segments: &[&str], query: &[(&str, String)]) -> Result<url::Url, ApiError> {
        http::endpoint(&self.base, segments, query).map_err(ApiError::local)
    }

    async fn get<T: DeserializeOwned>(
        &self,
        segments: &[&str],
        query: &[(&str, String)],
    ) -> Result<T, ApiError> {
        http::json(
            LABEL,
            &self.auth,
            Method::GET,
            self.url(segments, query)?,
            Body::Empty,
        )
        .await
    }

    async fn send<T: DeserializeOwned>(
        &self,
        method: Method,
        segments: &[&str],
        body: Value,
    ) -> Result<T, ApiError> {
        http::json(
            LABEL,
            &self.auth,
            method,
            self.url(segments, &[])?,
            Body::Json(body),
        )
        .await
    }

    async fn send_empty(
        &self,
        method: Method,
        segments: &[&str],
        body: Option<Value>,
    ) -> Result<(), ApiError> {
        let body = body.map(Body::Json).unwrap_or(Body::Empty);
        http::send(
            LABEL,
            &self.auth,
            method,
            self.url(segments, &[])?,
            body,
            http::DEFAULT_LIMIT,
        )
        .await
        .map(|_| ())
    }

    pub(crate) async fn verify(&self) -> Result<(), String> {
        let _: Value = self.get(&["projects"], &[("limit", "1".into())]).await?;
        Ok(())
    }
}

pub(crate) async fn client(vault: &dyn Vault, account: &Account) -> Result<Client, String> {
    let base = http::base_url(API, account.endpoint.as_deref())?;
    let token = match account.auth {
        AuthMethod::ApiKey => store::credential(vault, account).await?,
        AuthMethod::Oauth => super::oauth::access_token(vault, account).await?,
        _ => return Err("Unbekannte Anmeldeart für Neon.".into()),
    };
    Ok(Client::new(base, token))
}

async fn open(account_id: &str) -> Result<Client, String> {
    let account = store::find_for(&Keychain, account_id, Provider::Neon).await?;
    client(&Keychain, &account).await
}

pub(crate) fn validate_api_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if key.is_empty() || key.len() > 512 || key.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Bitte einen gültigen Neon-API-Schlüssel eingeben.".into());
    }
    Ok(key)
}

pub(crate) fn custom_endpoint(
    official: &str,
    endpoint: Option<&str>,
) -> Result<Option<String>, String> {
    let base = http::base_url(official, endpoint)?;
    Ok(http::is_custom(official, &base).then(|| base.to_string()))
}

pub(crate) async fn add_api_key(
    vault: &dyn Vault,
    label: &str,
    api_key: &str,
    endpoint: Option<&str>,
) -> Result<Account, String> {
    let key = validate_api_key(api_key)?;
    let endpoint = custom_endpoint(API, endpoint)?;
    let neon = Client::new(http::base_url(API, endpoint.as_deref())?, key.to_string());
    neon.verify().await?;
    let label = store::clean_label(label, "Neon")?;
    store::insert(
        vault,
        store::new_account(Provider::Neon, label, AuthMethod::ApiKey, endpoint, None),
        key,
    )
    .await
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonOrganization {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub handle: Option<String>,
    #[serde(default)]
    pub plan: Option<String>,
}

#[derive(Deserialize)]
struct OrganizationList {
    #[serde(default)]
    organizations: Vec<NeonOrganization>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonProject {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub region_id: Option<String>,
    #[serde(default)]
    pub pg_version: Option<i64>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Deserialize, Default)]
struct Pagination {
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    next: Option<String>,
}

#[derive(Deserialize)]
struct ProjectList {
    #[serde(default)]
    projects: Vec<NeonProject>,
    #[serde(default)]
    pagination: Option<Pagination>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonBranch {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub current_state: Option<String>,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub protected: bool,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Deserialize)]
struct BranchList {
    #[serde(default)]
    branches: Vec<NeonBranch>,
    #[serde(default)]
    pagination: Option<Pagination>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonDatabase {
    pub name: String,
    pub owner_name: String,
}

#[derive(Deserialize)]
struct DatabaseList {
    #[serde(default)]
    databases: Vec<NeonDatabase>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonRole {
    pub name: String,
    #[serde(default)]
    pub protected: bool,
}

#[derive(Deserialize)]
struct RoleList {
    #[serde(default)]
    roles: Vec<NeonRole>,
}

#[derive(Deserialize)]
struct ConnectionUri {
    uri: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonAuthConfig {
    pub auth_provider: String,
    #[serde(default)]
    pub branch_id: Option<String>,
    #[serde(default)]
    pub db_name: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub owned_by: Option<String>,
    #[serde(default)]
    pub jwks_url: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct NeonAuthState {
    pub enabled: bool,
    pub config: Option<NeonAuthConfig>,
}

#[derive(Deserialize)]
struct AuthEnabled {
    #[serde(default)]
    pub_client_key: String,
    #[serde(default)]
    secret_server_key: String,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    jwks_url: Option<String>,
    #[serde(default)]
    schema_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct NeonAuthEnabled {
    pub base_url: Option<String>,
    pub jwks_url: Option<String>,
    pub schema_name: Option<String>,
    pub stored_keys: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct NeonAuthUser {
    pub id: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub created_at: Option<String>,
    pub role: Option<String>,
    pub banned: Option<bool>,
    pub email_verified: Option<bool>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct NeonAuthUsersPage {
    pub schema: &'static str,
    pub users: Vec<NeonAuthUser>,
    pub has_more: bool,
}

#[derive(Deserialize)]
struct CreatedId {
    id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonStorage {
    pub enabled: bool,
    #[serde(default)]
    pub s3_endpoint: Option<String>,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub force_path_style: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonBucket {
    pub name: String,
    #[serde(default)]
    pub access_level: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Deserialize)]
struct BucketList {
    #[serde(default)]
    buckets: Vec<NeonBucket>,
}

#[derive(Deserialize)]
struct BucketCreated {
    bucket: NeonBucket,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonObject {
    pub key: String,
    #[serde(default)]
    pub size: Option<i64>,
    #[serde(default)]
    pub last_modified: Option<String>,
    #[serde(default)]
    pub etag: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonObjectPage {
    #[serde(default)]
    pub folders: Vec<String>,
    #[serde(default)]
    pub objects: Vec<NeonObject>,
    #[serde(default)]
    pub prefix: Option<String>,
    #[serde(default)]
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub is_truncated: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonDeployment {
    #[serde(default)]
    pub id: Value,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub memory_mib: Option<i64>,
    #[serde(default)]
    pub runtime: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct NeonFunction {
    pub id: String,
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub invocation_url: Option<String>,
    #[serde(default)]
    pub current_deployment: Option<NeonDeployment>,
    #[serde(default)]
    pub active_deployment: Option<NeonDeployment>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Deserialize)]
struct FunctionList {
    #[serde(default)]
    functions: Vec<NeonFunction>,
    #[serde(default)]
    pagination: Option<Pagination>,
}

#[derive(Deserialize)]
struct FunctionDetail {
    function: NeonFunction,
}

fn cursor_param(cursor: Option<&str>) -> Result<Option<String>, String> {
    match cursor.map(str::trim).filter(|cursor| !cursor.is_empty()) {
        Some(cursor) if cursor.len() <= 1024 && !cursor.chars().any(char::is_control) => {
            Ok(Some(cursor.to_string()))
        }
        Some(_) => Err("Ungültiger Seiten-Cursor.".into()),
        None => Ok(None),
    }
}

pub(crate) fn validate_bucket(name: &str) -> Result<&str, String> {
    let valid = (3..=63).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
        && name.as_bytes()[0].is_ascii_alphanumeric()
        && name.as_bytes()[name.len() - 1].is_ascii_alphanumeric()
        && !name.contains("..");
    if valid {
        Ok(name)
    } else {
        Err("Bucket-Namen: 3–63 Zeichen, Kleinbuchstaben, Ziffern, Punkt und Bindestrich.".into())
    }
}

fn validate_email(email: &str) -> Result<&str, String> {
    let email = email.trim();
    let valid = email.len() <= 254
        && !email.chars().any(|c| c.is_whitespace() || c.is_control())
        && email
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.'));
    if valid {
        Ok(email)
    } else {
        Err("Bitte eine gültige E-Mail-Adresse eingeben.".into())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Transport {
    Tcp,
    WebSocket,
}

impl Transport {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "" | "tcp" => Ok(Transport::Tcp),
            "neon-ws" => Ok(Transport::WebSocket),
            _ => Err("Unbekannter Transport. Erlaubt sind tcp und neon-ws.".into()),
        }
    }
}

fn ssl_mode_of(value: &str) -> &'static str {
    match value {
        "verify-full" => "verify-full",
        "verify-ca" => "verify-ca",
        "disable" => "disable",
        "prefer" => "prefer",
        _ => "require",
    }
}

pub(crate) fn split_password(
    uri: &str,
    transport: Transport,
    custom: bool,
) -> Result<(String, String, &'static str), String> {
    let mut url = url::Url::parse(uri.trim())
        .map_err(|_| "Neon hat eine ungültige Verbindungs-URL geliefert.".to_string())?;
    if !matches!(url.scheme(), "postgres" | "postgresql") {
        return Err("Neon hat keine PostgreSQL-URL geliefert.".into());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if host.is_empty()
        || (!custom && !host.ends_with(".neon.tech") && !host.ends_with(".neon.build"))
    {
        return Err("Neon hat einen unerwarteten Datenbank-Host geliefert.".into());
    }
    if url.username().is_empty() {
        return Err("Neon hat keinen Datenbankbenutzer geliefert.".into());
    }
    let password = percent_encoding::percent_decode_str(url.password().unwrap_or(""))
        .decode_utf8()
        .map_err(|_| "Neon hat ein ungültiges Passwort geliefert.".to_string())?
        .into_owned();
    if password.is_empty() {
        return Err(
            "Neon hat kein Passwort geliefert. Bei Projekten ohne gespeicherte Passwörter das Rollenpasswort in Neon zurücksetzen."
                .into(),
        );
    }
    url.set_password(None)
        .map_err(|_| "Verbindungs-URL konnte nicht bereinigt werden.".to_string())?;
    let mut pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| !matches!(key.as_ref(), "l8db_transport" | "password"))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    let mut ssl_mode = "require";
    match pairs.iter_mut().find(|(key, _)| key == "sslmode") {
        Some((_, value)) => {
            if !custom && matches!(value.as_str(), "disable" | "prefer" | "allow") {
                *value = "require".into();
            }
            ssl_mode = ssl_mode_of(value);
        }
        None => pairs.push(("sslmode".into(), "require".into())),
    }
    if transport == Transport::WebSocket {
        pairs.retain(|(key, _)| key != "channel_binding");
        pairs.push(("channel_binding".into(), "disable".into()));
        pairs.push(("l8db_transport".into(), "neon-ws".into()));
    }
    url.set_query(None);
    if !pairs.is_empty() {
        url.query_pairs_mut().extend_pairs(pairs);
    }
    Ok((url.to_string(), password, ssl_mode))
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionRequest {
    pub project_id: String,
    pub branch_id: String,
    pub database: String,
    pub role: String,
    #[serde(default)]
    pub pooled: bool,
    #[serde(default)]
    pub transport: String,
    pub name: String,
}

#[derive(Debug, PartialEq)]
pub(crate) struct AuthLayout {
    pub schema: &'static str,
    pub table: &'static str,
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub created: Option<String>,
    pub role: Option<String>,
    pub banned: Option<String>,
    pub verified: Option<String>,
    pub deleted: Option<String>,
}

fn quoted(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

pub(crate) fn auth_layout(columns: &[(String, String)]) -> Result<AuthLayout, String> {
    let has = |table: &str, column: &str| columns.iter().any(|(t, c)| t == table && c == column);
    let pick = |table: &str, names: &[&str]| {
        names
            .iter()
            .find(|name| has(table, name))
            .map(|name| name.to_string())
    };
    if has("user", "id") && has("user", "email") {
        return Ok(AuthLayout {
            schema: "better_auth",
            table: "user",
            id: "id".into(),
            email: "email".into(),
            name: pick("user", &["name"]),
            created: pick("user", &["createdAt", "created_at"]),
            role: pick("user", &["role"]),
            banned: pick("user", &["banned"]),
            verified: pick("user", &["emailVerified", "email_verified"]),
            deleted: None,
        });
    }
    if has("users_sync", "id") && has("users_sync", "email") {
        return Ok(AuthLayout {
            schema: "stack",
            table: "users_sync",
            id: "id".into(),
            email: "email".into(),
            name: pick("users_sync", &["name"]),
            created: pick("users_sync", &["created_at"]),
            role: None,
            banned: None,
            verified: None,
            deleted: pick("users_sync", &["deleted_at"]),
        });
    }
    let mut tables: Vec<&str> = columns.iter().map(|(table, _)| table.as_str()).collect();
    tables.sort_unstable();
    tables.dedup();
    let found = if tables.is_empty() {
        "keine".to_string()
    } else {
        tables.into_iter().take(10).collect::<Vec<_>>().join(", ")
    };
    Err(format!(
        "Unbekanntes Neon-Auth-Schema. Gefundene Tabellen in neon_auth: {found}. Diese Auth-Version wird noch nicht unterstützt; Nutzer können weiterhin angelegt werden."
    ))
}

impl AuthLayout {
    pub(crate) fn select_sql(&self) -> String {
        let column = |name: &Option<String>| {
            name.as_deref()
                .map(|name| format!("{}::text", quoted(name)))
                .unwrap_or_else(|| "NULL::text".into())
        };
        let mut filters = vec![format!(
            "(coalesce({}::text, '') ILIKE $1 ESCAPE '\\' OR coalesce({}, '') ILIKE $1 ESCAPE '\\')",
            quoted(&self.email),
            column(&self.name)
        )];
        if let Some(deleted) = &self.deleted {
            filters.push(format!("{} IS NULL", quoted(deleted)));
        }
        let order = self
            .created
            .as_deref()
            .map(|created| format!("{} DESC NULLS LAST, ", quoted(created)))
            .unwrap_or_default();
        format!(
            "SELECT {}::text, {}::text, {}, {}, {}, {}, {} FROM neon_auth.{} WHERE {} ORDER BY {order}{} LIMIT {} OFFSET $2",
            quoted(&self.id),
            quoted(&self.email),
            column(&self.name),
            column(&self.created),
            column(&self.role),
            column(&self.banned),
            column(&self.verified),
            quoted(self.table),
            filters.join(" AND "),
            quoted(&self.id),
            AUTH_USER_PAGE + 1
        )
    }
}

pub(crate) fn like_pattern(search: Option<&str>) -> String {
    match search.map(str::trim).filter(|search| !search.is_empty()) {
        Some(search) => {
            let escaped: String = search
                .chars()
                .take(100)
                .flat_map(|c| match c {
                    '\\' | '%' | '_' => vec!['\\', c],
                    c => vec![c],
                })
                .collect();
            format!("%{escaped}%")
        }
        None => "%".into(),
    }
}

fn truthy(value: Option<&str>) -> Option<bool> {
    value.map(|value| matches!(value, "true" | "t" | "1"))
}

async fn query_auth_users(
    uri: &str,
    offset: i64,
    search: Option<&str>,
) -> Result<NeonAuthUsersPage, String> {
    let secret = url::Url::parse(uri)
        .ok()
        .and_then(|url| url.password().map(str::to_string));
    let fail = |error: tokio_postgres::Error| {
        http::redact(&format!("Neon-Datenbank: {error}"), secret.as_deref())
    };
    let connector = native_tls::TlsConnector::new()
        .map_err(|_| "TLS ist auf diesem System nicht verfügbar.".to_string())?;
    let tls = postgres_native_tls::MakeTlsConnector::new(connector);
    let (client, connection) =
        tokio::time::timeout(Duration::from_secs(30), tokio_postgres::connect(uri, tls))
            .await
            .map_err(|_| "Zeitüberschreitung beim Verbinden mit der Neon-Datenbank.".to_string())?
            .map_err(fail)?;
    let task = tokio::spawn(connection);
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        client
            .batch_execute("SET statement_timeout = '15s'; SET default_transaction_read_only = on")
            .await
            .map_err(fail)?;
        let found: Vec<(String, String)> = client
            .query(
                "SELECT table_name::text, column_name::text FROM information_schema.columns WHERE table_schema = 'neon_auth' ORDER BY table_name, ordinal_position",
                &[],
            )
            .await
            .map_err(fail)?
            .into_iter()
            .map(|row| (row.get::<_, String>(0), row.get::<_, String>(1)))
            .collect();
        let layout = auth_layout(&found)?;
        let pattern = like_pattern(search);
        let rows = client
            .query(&layout.select_sql(), &[&pattern, &offset])
            .await
            .map_err(fail)?;
        let has_more = rows.len() as i64 > AUTH_USER_PAGE;
        let users = rows
            .into_iter()
            .take(AUTH_USER_PAGE as usize)
            .map(|row| NeonAuthUser {
                id: row.get::<_, Option<String>>(0).unwrap_or_default(),
                email: row.get(1),
                name: row.get(2),
                created_at: row.get(3),
                role: row.get(4),
                banned: truthy(row.get::<_, Option<String>>(5).as_deref()),
                email_verified: truthy(row.get::<_, Option<String>>(6).as_deref()),
            })
            .collect();
        Ok::<_, String>(NeonAuthUsersPage {
            schema: layout.schema,
            users,
            has_more,
        })
    })
    .await
    .map_err(|_| "Zeitüberschreitung beim Lesen der Neon-Auth-Nutzer.".to_string())
    .and_then(|result| result);
    drop(client);
    task.abort();
    result
}

impl Client {
    pub(crate) async fn organizations(&self) -> Result<Vec<NeonOrganization>, String> {
        match self
            .get::<OrganizationList>(&["users", "me", "organizations"], &[])
            .await
        {
            Ok(list) => Ok(list.organizations),
            Err(error) if error.is(403) || error.is(404) => Ok(Vec::new()),
            Err(error) => Err(error.message),
        }
    }

    pub(crate) async fn projects(
        &self,
        org_id: Option<&str>,
        cursor: Option<&str>,
        search: Option<&str>,
    ) -> Result<Page<NeonProject>, String> {
        let mut query = vec![("limit", PROJECT_PAGE.to_string())];
        if let Some(org) = org_id.map(str::trim).filter(|org| !org.is_empty()) {
            query.push(("org_id", validate_id(org, "Organisations-ID")?.to_string()));
        }
        if let Some(cursor) = cursor_param(cursor)? {
            query.push(("cursor", cursor));
        }
        if let Some(search) = search.map(str::trim).filter(|search| !search.is_empty()) {
            query.push(("search", search.chars().take(100).collect()));
        }
        let list: ProjectList = self.get(&["projects"], &query).await?;
        let next_cursor = if list.projects.len() >= PROJECT_PAGE {
            list.pagination
                .and_then(|pagination| pagination.cursor)
                .filter(|cursor| !cursor.is_empty())
        } else {
            None
        };
        Ok(Page {
            items: list.projects,
            next_cursor,
        })
    }

    pub(crate) async fn branches(
        &self,
        project: &str,
        cursor: Option<&str>,
    ) -> Result<Page<NeonBranch>, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let mut query = vec![("limit", "100".to_string())];
        if let Some(cursor) = cursor_param(cursor)? {
            query.push(("cursor", cursor));
        }
        let list: BranchList = self.get(&["projects", project, "branches"], &query).await?;
        Ok(Page {
            next_cursor: list
                .pagination
                .and_then(|pagination| pagination.next)
                .filter(|next| !next.is_empty()),
            items: list.branches,
        })
    }

    pub(crate) async fn databases(
        &self,
        project: &str,
        branch: &str,
    ) -> Result<Vec<NeonDatabase>, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let list: DatabaseList = self
            .get(&["projects", project, "branches", branch, "databases"], &[])
            .await?;
        Ok(list.databases)
    }

    pub(crate) async fn roles(&self, project: &str, branch: &str) -> Result<Vec<NeonRole>, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let list: RoleList = self
            .get(&["projects", project, "branches", branch, "roles"], &[])
            .await?;
        Ok(list.roles)
    }

    async fn connection_uri(
        &self,
        project: &str,
        branch: &str,
        database: &str,
        role: &str,
        pooled: bool,
    ) -> Result<String, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let database = validate_name(database, "die Datenbank")?;
        let role = validate_name(role, "die Rolle")?;
        let uri: ConnectionUri = self
            .get(
                &["projects", project, "connection_uri"],
                &[
                    ("branch_id", branch.to_string()),
                    ("database_name", database.to_string()),
                    ("role_name", role.to_string()),
                    ("pooled", pooled.to_string()),
                ],
            )
            .await?;
        Ok(uri.uri)
    }

    pub(crate) async fn create_connection(
        &self,
        vault: &dyn Vault,
        request: &ConnectionRequest,
    ) -> Result<CreatedConnection, String> {
        let name = store::validate_connection_name(&request.name)?;
        let transport = Transport::parse(request.transport.trim())?;
        let uri = self
            .connection_uri(
                &request.project_id,
                &request.branch_id,
                &request.database,
                &request.role,
                request.pooled,
            )
            .await?;
        let (connection_string, password, ssl_mode) = split_password(&uri, transport, self.custom)?;
        let id = store::store_connection_password(vault, &password).await?;
        Ok(CreatedConnection {
            id,
            name,
            kind: "postgres",
            provider_id: "neon",
            connection_string,
            ssl_mode,
        })
    }

    async fn auth_config(
        &self,
        project: &str,
        branch: &str,
    ) -> Result<Option<NeonAuthConfig>, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        match self
            .get::<NeonAuthConfig>(&["projects", project, "branches", branch, "auth"], &[])
            .await
        {
            Ok(config) => Ok(Some(config)),
            Err(error) if error.is(404) => Ok(None),
            Err(error) => Err(beta(error, "Neon Auth")),
        }
    }

    pub(crate) async fn auth_state(
        &self,
        project: &str,
        branch: &str,
    ) -> Result<NeonAuthState, String> {
        let config = self.auth_config(project, branch).await?;
        Ok(NeonAuthState {
            enabled: config.is_some(),
            config,
        })
    }

    pub(crate) async fn auth_enable(
        &self,
        vault: &dyn Vault,
        account: &Account,
        project: &str,
        branch: &str,
        database: Option<&str>,
        confirmed: bool,
    ) -> Result<NeonAuthEnabled, String> {
        if !confirmed {
            return Err(
                "Neon Auth legt das Schema neon_auth an. Bitte die Aktion bestätigen.".into(),
            );
        }
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let mut body = json!({ "auth_provider": "better_auth" });
        if let Some(database) = database.map(str::trim).filter(|db| !db.is_empty()) {
            body["database_name"] = json!(validate_name(database, "die Datenbank")?);
        }
        let enabled: AuthEnabled = self
            .send(
                Method::POST,
                &["projects", project, "branches", branch, "auth"],
                body,
            )
            .await
            .map_err(|error| beta(error, "Neon Auth"))?;
        let stored_keys =
            !enabled.pub_client_key.is_empty() || !enabled.secret_server_key.is_empty();
        if stored_keys {
            let slot = store::secret_account(account, AUTH_KEYS);
            let mut keys: serde_json::Map<String, Value> = vault
                .get(&slot)
                .await?
                .and_then(|raw| serde_json::from_str(&raw).ok())
                .unwrap_or_default();
            keys.insert(
                format!("{project}:{branch}"),
                json!({
                    "pub_client_key": enabled.pub_client_key,
                    "secret_server_key": enabled.secret_server_key,
                }),
            );
            vault.set(&slot, &Value::Object(keys).to_string()).await?;
        }
        Ok(NeonAuthEnabled {
            base_url: enabled.base_url,
            jwks_url: enabled.jwks_url,
            schema_name: enabled.schema_name,
            stored_keys,
        })
    }

    pub(crate) async fn auth_users(
        &self,
        project: &str,
        branch: &str,
        offset: i64,
        search: Option<&str>,
    ) -> Result<NeonAuthUsersPage, String> {
        if !(0..=100_000).contains(&offset) {
            return Err("Ungültiger Seiten-Offset.".into());
        }
        let config = self
            .auth_config(project, branch)
            .await?
            .ok_or("Neon Auth ist auf diesem Branch nicht aktiviert.")?;
        let databases = self.databases(project, branch).await?;
        let database = match config.db_name.as_deref() {
            Some(name) => databases.iter().find(|database| database.name == name),
            None => databases.first(),
        }
        .ok_or("Die Auth-Datenbank wurde auf dem Branch nicht gefunden.")?;
        let uri = self
            .connection_uri(project, branch, &database.name, &database.owner_name, false)
            .await?;
        split_password(&uri, Transport::Tcp, self.custom)?;
        query_auth_users(&uri, offset, search).await
    }

    pub(crate) async fn auth_create_user(
        &self,
        project: &str,
        branch: &str,
        email: &str,
        name: Option<&str>,
    ) -> Result<String, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let mut body = json!({ "email": validate_email(email)? });
        if let Some(name) = name.map(str::trim).filter(|name| !name.is_empty()) {
            body["name"] = json!(validate_name(name, "den Nutzer")?);
        }
        let created: CreatedId = self
            .send(
                Method::POST,
                &["projects", project, "branches", branch, "auth", "users"],
                body,
            )
            .await
            .map_err(|error| beta(error, "Neon Auth"))?;
        Ok(created.id)
    }

    pub(crate) async fn auth_delete_user(
        &self,
        project: &str,
        branch: &str,
        user_id: &str,
        confirmed: bool,
    ) -> Result<(), String> {
        if !confirmed {
            return Err("Das Löschen eines Nutzers muss bestätigt werden.".into());
        }
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let user = validate_name(user_id.trim(), "den Nutzer")?;
        self.send_empty(
            Method::DELETE,
            &[
                "projects", project, "branches", branch, "auth", "users", user,
            ],
            None,
        )
        .await
        .map_err(|error| beta(error, "Neon Auth"))
    }

    pub(crate) async fn auth_set_roles(
        &self,
        project: &str,
        branch: &str,
        user_id: &str,
        roles: &[String],
    ) -> Result<(), String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let user = validate_name(user_id.trim(), "den Nutzer")?;
        if roles.is_empty() || roles.len() > 10 {
            return Err("Bitte 1 bis 10 Rollen angeben.".into());
        }
        for role in roles {
            validate_id(role, "Rolle")?;
        }
        let _: Value = self
            .send(
                Method::PUT,
                &[
                    "projects", project, "branches", branch, "auth", "users", user, "role",
                ],
                json!({ "roles": roles }),
            )
            .await
            .map_err(|error| beta(error, "Neon Auth"))?;
        Ok(())
    }

    pub(crate) async fn storage(&self, project: &str, branch: &str) -> Result<NeonStorage, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        self.get(&["projects", project, "branches", branch, "storage"], &[])
            .await
            .map_err(|error| beta(error, "Neon Storage"))
    }

    pub(crate) async fn buckets(
        &self,
        project: &str,
        branch: &str,
    ) -> Result<Vec<NeonBucket>, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let list: BucketList = self
            .get(&["projects", project, "branches", branch, "buckets"], &[])
            .await
            .map_err(|error| beta(error, "Neon Storage"))?;
        Ok(list.buckets)
    }

    pub(crate) async fn create_bucket(
        &self,
        project: &str,
        branch: &str,
        name: &str,
        public_read: bool,
    ) -> Result<NeonBucket, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let name = validate_bucket(name.trim())?;
        let created: BucketCreated = self
            .send(
                Method::POST,
                &["projects", project, "branches", branch, "buckets"],
                json!({
                    "name": name,
                    "access_level": if public_read { "public_read" } else { "private" },
                }),
            )
            .await
            .map_err(|error| beta(error, "Neon Storage"))?;
        Ok(created.bucket)
    }

    pub(crate) async fn objects(
        &self,
        project: &str,
        branch: &str,
        bucket: &str,
        prefix: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<NeonObjectPage, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let bucket = validate_bucket(bucket)?;
        let mut query = vec![
            ("limit", OBJECT_PAGE.to_string()),
            ("delimiter", "/".to_string()),
        ];
        if let Some(prefix) = prefix.filter(|prefix| !prefix.is_empty()) {
            if prefix.len() > 1024 || prefix.chars().any(char::is_control) {
                return Err("Ungültiges Präfix.".into());
            }
            query.push(("prefix", prefix.to_string()));
        }
        if let Some(cursor) = cursor_param(cursor)? {
            query.push(("cursor", cursor));
        }
        let mut page: NeonObjectPage = self
            .get(
                &[
                    "projects", project, "branches", branch, "buckets", bucket, "objects",
                ],
                &query,
            )
            .await
            .map_err(|error| beta(error, "Neon Storage"))?;
        if !page.is_truncated {
            page.next_cursor = None;
        }
        Ok(page)
    }

    pub(crate) async fn functions(
        &self,
        project: &str,
        branch: &str,
        cursor: Option<&str>,
    ) -> Result<Page<NeonFunction>, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let mut query = vec![("limit", FUNCTION_PAGE.to_string())];
        if let Some(cursor) = cursor_param(cursor)? {
            query.push(("cursor", cursor));
        }
        let list: FunctionList = self
            .get(
                &["projects", project, "branches", branch, "functions"],
                &query,
            )
            .await
            .map_err(|error| beta(error, "Neon Functions"))?;
        Ok(Page {
            next_cursor: list
                .pagination
                .and_then(|pagination| pagination.next)
                .filter(|next| !next.is_empty()),
            items: list.functions,
        })
    }

    pub(crate) async fn function(
        &self,
        project: &str,
        branch: &str,
        slug: &str,
    ) -> Result<NeonFunction, String> {
        let project = validate_id(project, "Projekt-ID")?;
        let branch = validate_id(branch, "Branch-ID")?;
        let slug = validate_id(slug, "Funktionskennung")?;
        let detail: FunctionDetail = self
            .get(
                &["projects", project, "branches", branch, "functions", slug],
                &[],
            )
            .await
            .map_err(|error| beta(error, "Neon Functions"))?;
        Ok(detail.function)
    }
}

#[tauri::command]
pub async fn cloud_neon_add_api_key(
    label: String,
    api_key: String,
    endpoint: Option<String>,
) -> Result<Account, String> {
    add_api_key(&Keychain, &label, &api_key, endpoint.as_deref()).await
}

#[tauri::command]
pub async fn cloud_neon_organizations(account_id: String) -> Result<Vec<NeonOrganization>, String> {
    open(&account_id).await?.organizations().await
}

#[tauri::command]
pub async fn cloud_neon_projects(
    account_id: String,
    org_id: Option<String>,
    cursor: Option<String>,
    search: Option<String>,
) -> Result<Page<NeonProject>, String> {
    open(&account_id)
        .await?
        .projects(org_id.as_deref(), cursor.as_deref(), search.as_deref())
        .await
}

#[tauri::command]
pub async fn cloud_neon_branches(
    account_id: String,
    project_id: String,
    cursor: Option<String>,
) -> Result<Page<NeonBranch>, String> {
    open(&account_id)
        .await?
        .branches(&project_id, cursor.as_deref())
        .await
}

#[tauri::command]
pub async fn cloud_neon_databases(
    account_id: String,
    project_id: String,
    branch_id: String,
) -> Result<Vec<NeonDatabase>, String> {
    open(&account_id)
        .await?
        .databases(&project_id, &branch_id)
        .await
}

#[tauri::command]
pub async fn cloud_neon_roles(
    account_id: String,
    project_id: String,
    branch_id: String,
) -> Result<Vec<NeonRole>, String> {
    open(&account_id)
        .await?
        .roles(&project_id, &branch_id)
        .await
}

#[tauri::command]
pub async fn cloud_neon_create_connection(
    account_id: String,
    request: ConnectionRequest,
) -> Result<CreatedConnection, String> {
    open(&account_id)
        .await?
        .create_connection(&Keychain, &request)
        .await
}

#[tauri::command]
pub async fn cloud_neon_auth(
    account_id: String,
    project_id: String,
    branch_id: String,
) -> Result<NeonAuthState, String> {
    open(&account_id)
        .await?
        .auth_state(&project_id, &branch_id)
        .await
}

#[tauri::command]
pub async fn cloud_neon_auth_enable(
    account_id: String,
    project_id: String,
    branch_id: String,
    database: Option<String>,
    confirmed: bool,
) -> Result<NeonAuthEnabled, String> {
    let account = store::find_for(&Keychain, &account_id, Provider::Neon).await?;
    client(&Keychain, &account)
        .await?
        .auth_enable(
            &Keychain,
            &account,
            &project_id,
            &branch_id,
            database.as_deref(),
            confirmed,
        )
        .await
}

#[tauri::command]
pub async fn cloud_neon_auth_users(
    account_id: String,
    project_id: String,
    branch_id: String,
    offset: i64,
    search: Option<String>,
) -> Result<NeonAuthUsersPage, String> {
    open(&account_id)
        .await?
        .auth_users(&project_id, &branch_id, offset, search.as_deref())
        .await
}

#[tauri::command]
pub async fn cloud_neon_auth_create_user(
    account_id: String,
    project_id: String,
    branch_id: String,
    email: String,
    name: Option<String>,
) -> Result<String, String> {
    open(&account_id)
        .await?
        .auth_create_user(&project_id, &branch_id, &email, name.as_deref())
        .await
}

#[tauri::command]
pub async fn cloud_neon_auth_delete_user(
    account_id: String,
    project_id: String,
    branch_id: String,
    user_id: String,
    confirmed: bool,
) -> Result<(), String> {
    open(&account_id)
        .await?
        .auth_delete_user(&project_id, &branch_id, &user_id, confirmed)
        .await
}

#[tauri::command]
pub async fn cloud_neon_auth_set_roles(
    account_id: String,
    project_id: String,
    branch_id: String,
    user_id: String,
    roles: Vec<String>,
) -> Result<(), String> {
    open(&account_id)
        .await?
        .auth_set_roles(&project_id, &branch_id, &user_id, &roles)
        .await
}

#[tauri::command]
pub async fn cloud_neon_storage(
    account_id: String,
    project_id: String,
    branch_id: String,
) -> Result<NeonStorage, String> {
    open(&account_id)
        .await?
        .storage(&project_id, &branch_id)
        .await
}

#[tauri::command]
pub async fn cloud_neon_buckets(
    account_id: String,
    project_id: String,
    branch_id: String,
) -> Result<Vec<NeonBucket>, String> {
    open(&account_id)
        .await?
        .buckets(&project_id, &branch_id)
        .await
}

#[tauri::command]
pub async fn cloud_neon_create_bucket(
    account_id: String,
    project_id: String,
    branch_id: String,
    name: String,
    public_read: bool,
) -> Result<NeonBucket, String> {
    open(&account_id)
        .await?
        .create_bucket(&project_id, &branch_id, &name, public_read)
        .await
}

#[tauri::command]
pub async fn cloud_neon_objects(
    account_id: String,
    project_id: String,
    branch_id: String,
    bucket: String,
    prefix: Option<String>,
    cursor: Option<String>,
) -> Result<NeonObjectPage, String> {
    open(&account_id)
        .await?
        .objects(
            &project_id,
            &branch_id,
            &bucket,
            prefix.as_deref(),
            cursor.as_deref(),
        )
        .await
}

#[tauri::command]
pub async fn cloud_neon_functions(
    account_id: String,
    project_id: String,
    branch_id: String,
    cursor: Option<String>,
) -> Result<Page<NeonFunction>, String> {
    open(&account_id)
        .await?
        .functions(&project_id, &branch_id, cursor.as_deref())
        .await
}

#[tauri::command]
pub async fn cloud_neon_function(
    account_id: String,
    project_id: String,
    branch_id: String,
    slug: String,
) -> Result<NeonFunction, String> {
    open(&account_id)
        .await?
        .function(&project_id, &branch_id, &slug)
        .await
}
