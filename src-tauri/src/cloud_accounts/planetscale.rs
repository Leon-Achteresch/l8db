use super::http::{self, ApiError, Auth, Body};
use super::neon::validate_id;
use super::store::{self, Account, AuthMethod, CreatedConnection, Keychain, Provider, Vault};
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub(crate) const API: &str = "https://api.planetscale.com/v1/";
const LABEL: &str = "PlanetScale";
pub(crate) const PAGE_SIZE: usize = 50;
pub(crate) const ISSUED: &str = "issued";
const MAX_ISSUED: usize = 500;

pub(crate) struct Client {
    pub base: url::Url,
    pub auth: Auth,
    pub custom: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct PsOrganization {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct PsRegion {
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct PsDatabase {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default = "mysql")]
    pub kind: String,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub ready: bool,
    #[serde(default)]
    pub default_branch: Option<String>,
    #[serde(default)]
    pub region: Option<PsRegion>,
}

fn mysql() -> String {
    "mysql".into()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct PsBranch {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub production: bool,
    #[serde(default)]
    pub ready: bool,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Deserialize)]
struct Paginated<T> {
    #[serde(default = "Vec::new")]
    data: Vec<T>,
    #[serde(default)]
    next_page: Option<i64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct Paged<T> {
    pub items: Vec<T>,
    pub next_page: Option<i64>,
}

#[derive(Deserialize)]
struct PasswordCreated {
    id: String,
    username: String,
    plain_text: String,
    access_host_url: String,
}

#[derive(Deserialize)]
struct RoleCreated {
    id: String,
    username: String,
    #[serde(default)]
    password: Option<String>,
    access_host_url: String,
    #[serde(default)]
    database_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct Issued {
    pub id: String,
    pub kind: String,
    pub organization: String,
    pub database: String,
    pub branch: String,
    pub name: String,
    pub username: String,
    pub connection_id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct IssuedConnection {
    pub connection: CreatedConnection,
    pub credential: Issued,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CredentialRequest {
    pub organization: String,
    pub database: String,
    pub branch: String,
    #[serde(default)]
    pub credential_name: Option<String>,
    pub connection_name: String,
    pub confirmed: bool,
}

fn page_param(page: Option<i64>) -> Result<String, String> {
    match page.unwrap_or(1) {
        page @ 1..=10_000 => Ok(page.to_string()),
        _ => Err("Ungültige Seitennummer.".into()),
    }
}

pub(crate) fn validate_token_parts<'a>(
    id: &'a str,
    token: &'a str,
) -> Result<(&'a str, &'a str), String> {
    let id = id.trim();
    let token = token.trim();
    let bad = |value: &str, max: usize| {
        value.is_empty()
            || value.len() > max
            || value
                .chars()
                .any(|c| c.is_whitespace() || c.is_control() || c == ':')
    };
    if bad(id, 128) || bad(token, 512) {
        return Err("Bitte Service-Token-ID und Service-Token vollständig eingeben.".into());
    }
    Ok((id, token))
}

pub(crate) fn credential_name(name: Option<&str>) -> Result<String, String> {
    match name.map(str::trim).filter(|name| !name.is_empty()) {
        Some(name)
            if name.len() <= 63
                && name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') =>
        {
            Ok(name.to_string())
        }
        Some(_) => {
            Err("Namen für Zugangsdaten: bis 63 Zeichen, Buchstaben, Ziffern, - und _.".into())
        }
        None => Ok(format!("l8db-{}", http::random_hex(3))),
    }
}

pub(crate) fn split_host(
    access: &str,
    default_port: u16,
    custom: bool,
) -> Result<(String, u16, Option<String>), String> {
    let access = access.trim();
    let (host, port, database) = if access.contains("://") {
        let url = url::Url::parse(access)
            .map_err(|_| "PlanetScale hat eine ungültige Host-Adresse geliefert.".to_string())?;
        let database = url.path().trim_matches('/');
        (
            url.host_str().unwrap_or_default().to_string(),
            url.port().unwrap_or(default_port),
            (!database.is_empty()).then(|| database.to_string()),
        )
    } else {
        match access.rsplit_once(':') {
            Some((host, port)) if port.bytes().all(|b| b.is_ascii_digit()) && !port.is_empty() => (
                host.to_string(),
                port.parse::<u16>()
                    .map_err(|_| "PlanetScale hat einen ungültigen Port geliefert.".to_string())?,
                None,
            ),
            _ => (access.to_string(), default_port, None),
        }
    };
    let host = host.to_ascii_lowercase();
    let trusted = host.ends_with(".psdb.cloud") || host.ends_with(".planetscale.com");
    if host.is_empty() || host.contains(['/', '@', ' ']) || (!custom && !trusted) {
        return Err("PlanetScale hat einen unerwarteten Datenbank-Host geliefert.".into());
    }
    Ok((host, port, database))
}

pub(crate) fn connection_url(
    scheme: &str,
    user: &str,
    host: &str,
    port: u16,
    database: &str,
    query: &str,
) -> Result<String, String> {
    let mut url = url::Url::parse(&format!("{scheme}://{host}:{port}/"))
        .map_err(|_| "Verbindungs-URL konnte nicht gebaut werden.".to_string())?;
    url.set_username(user)
        .map_err(|_| "Ungültiger Datenbankbenutzer.".to_string())?;
    {
        let mut path = url
            .path_segments_mut()
            .map_err(|_| "Verbindungs-URL konnte nicht gebaut werden.".to_string())?;
        path.clear();
        path.push(database);
    }
    url.set_query(Some(query));
    Ok(url.to_string())
}

impl Client {
    pub(crate) fn new(base: url::Url, token_id: &str, token: &str) -> Self {
        Self {
            custom: http::is_custom(API, &base),
            base,
            auth: Auth::Header(format!("{token_id}:{token}")),
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

    async fn paged<T: DeserializeOwned>(
        &self,
        segments: &[&str],
        page: Option<i64>,
    ) -> Result<Paged<T>, String> {
        let list: Paginated<T> = self
            .get(
                segments,
                &[
                    ("page", page_param(page)?),
                    ("per_page", PAGE_SIZE.to_string()),
                ],
            )
            .await?;
        Ok(Paged {
            next_page: list.next_page.filter(|next| *next > page.unwrap_or(1)),
            items: list.data,
        })
    }

    pub(crate) async fn verify(&self) -> Result<(), String> {
        let _: Value = self
            .get(&["organizations"], &[("per_page", "1".into())])
            .await?;
        Ok(())
    }

    pub(crate) async fn organizations(
        &self,
        page: Option<i64>,
    ) -> Result<Paged<PsOrganization>, String> {
        self.paged(&["organizations"], page).await
    }

    pub(crate) async fn databases(
        &self,
        organization: &str,
        page: Option<i64>,
    ) -> Result<Paged<PsDatabase>, String> {
        let organization = validate_id(organization, "Organisation")?;
        self.paged(&["organizations", organization, "databases"], page)
            .await
    }

    pub(crate) async fn branches(
        &self,
        organization: &str,
        database: &str,
        page: Option<i64>,
    ) -> Result<Paged<PsBranch>, String> {
        let organization = validate_id(organization, "Organisation")?;
        let database = validate_id(database, "Datenbank")?;
        self.paged(
            &[
                "organizations",
                organization,
                "databases",
                database,
                "branches",
            ],
            page,
        )
        .await
    }

    async fn database(&self, organization: &str, database: &str) -> Result<PsDatabase, String> {
        Ok(self
            .get(&["organizations", organization, "databases", database], &[])
            .await?)
    }

    async fn delete_credential(&self, issued: &Issued) -> Result<(), ApiError> {
        let collection = if issued.kind == "postgresql" {
            "roles"
        } else {
            "passwords"
        };
        let url = self.url(
            &[
                "organizations",
                &issued.organization,
                "databases",
                &issued.database,
                "branches",
                &issued.branch,
                collection,
                &issued.id,
            ],
            &[],
        )?;
        match http::send(
            LABEL,
            &self.auth,
            Method::DELETE,
            url,
            Body::Empty,
            http::DEFAULT_LIMIT,
        )
        .await
        {
            Ok(_) => Ok(()),
            Err(error) if error.is(404) => Ok(()),
            Err(error) => Err(error),
        }
    }

    pub(crate) async fn create_credential(
        &self,
        vault: &dyn Vault,
        account: &Account,
        request: &CredentialRequest,
    ) -> Result<IssuedConnection, String> {
        if !request.confirmed {
            return Err(
                "Das Anlegen neuer Zugangsdaten bei PlanetScale muss bestätigt werden.".into(),
            );
        }
        let organization = validate_id(&request.organization, "Organisation")?.to_string();
        let database = validate_id(&request.database, "Datenbank")?.to_string();
        let branch = validate_id(&request.branch, "Branch")?.to_string();
        let connection_name = store::validate_connection_name(&request.connection_name)?;
        let name = credential_name(request.credential_name.as_deref())?;
        let info = self.database(&organization, &database).await?;
        let segments = |collection: &'static str| {
            vec![
                "organizations".to_string(),
                organization.clone(),
                "databases".to_string(),
                database.clone(),
                "branches".to_string(),
                branch.clone(),
                collection.to_string(),
            ]
        };
        let post = |collection: &'static str, body: Value| {
            let segments = segments(collection);
            async move {
                let borrowed: Vec<&str> = segments.iter().map(String::as_str).collect();
                http::json::<Value>(
                    LABEL,
                    &self.auth,
                    Method::POST,
                    self.url(&borrowed, &[])?,
                    Body::Json(body),
                )
                .await
            }
        };
        let (issued, password, connection_string, kind, provider_id) = match info.kind.as_str() {
            "mysql" => {
                let raw = post("passwords", json!({ "name": name, "role": "reader" })).await?;
                let created: PasswordCreated = serde_json::from_value(raw).map_err(|_| {
                    "PlanetScale hat unerwartete Zugangsdaten geliefert.".to_string()
                })?;
                let issued = Issued {
                    id: created.id,
                    kind: "mysql".into(),
                    organization: organization.clone(),
                    database: database.clone(),
                    branch: branch.clone(),
                    name: name.clone(),
                    username: created.username.clone(),
                    connection_id: String::new(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                };
                let url = split_host(&created.access_host_url, 3306, self.custom).and_then(
                    |(host, port, _)| {
                        connection_url(
                            "mysql",
                            &created.username,
                            &host,
                            port,
                            &database,
                            "ssl-mode=required",
                        )
                    },
                );
                (issued, Ok(created.plain_text), url, "mysql", "planetscale")
            }
            "postgresql" => {
                let raw = post(
                    "roles",
                    json!({ "name": name, "inherited_roles": ["pg_read_all_data"] }),
                )
                .await?;
                let created: RoleCreated = serde_json::from_value(raw).map_err(|_| {
                    "PlanetScale hat unerwartete Zugangsdaten geliefert.".to_string()
                })?;
                let issued = Issued {
                    id: created.id,
                    kind: "postgresql".into(),
                    organization: organization.clone(),
                    database: database.clone(),
                    branch: branch.clone(),
                    name: name.clone(),
                    username: created.username.clone(),
                    connection_id: String::new(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                };
                let url = split_host(&created.access_host_url, 5432, self.custom).and_then(
                    |(host, port, path_db)| {
                        let db = created
                            .database_name
                            .clone()
                            .filter(|db| !db.is_empty())
                            .or(path_db)
                            .unwrap_or_else(|| "postgres".into());
                        connection_url(
                            "postgresql",
                            &created.username,
                            &host,
                            port,
                            &db,
                            "sslmode=require",
                        )
                    },
                );
                let password = created
                    .password
                    .filter(|password| !password.is_empty())
                    .ok_or_else(|| "PlanetScale hat kein Passwort geliefert.".to_string());
                (issued, password, url, "postgres", "planetscale-postgres")
            }
            other => {
                return Err(format!(
                "Datenbanktyp „{other}“ wird für automatische Zugangsdaten noch nicht unterstützt."
            ))
            }
        };
        let mut issued = issued;
        let rollback = |issued: Issued, error: String| async move {
            match self.delete_credential(&issued).await {
                Ok(()) => error,
                Err(revoke) => format!(
                    "{error} Die bei PlanetScale angelegten Zugangsdaten „{}“ konnten nicht widerrufen werden: {}",
                    issued.name, revoke.message
                ),
            }
        };
        let (password, connection_string) = match (password, connection_string) {
            (Ok(password), Ok(url)) => (password, url),
            (Err(error), _) | (_, Err(error)) => return Err(rollback(issued, error).await),
        };
        let connection_id = match store::free_connection_id(vault).await {
            Ok(id) => id,
            Err(error) => return Err(rollback(issued, error).await),
        };
        issued.connection_id = connection_id.clone();
        if let Err(error) = record(vault, account, issued.clone()).await {
            return Err(rollback(issued, error).await);
        }
        if let Err(error) = vault.set_connection_secret(&connection_id, &password).await {
            let _ = forget(vault, account, &issued.id).await;
            return Err(rollback(issued, error).await);
        }
        Ok(IssuedConnection {
            connection: CreatedConnection {
                id: connection_id,
                name: connection_name,
                kind,
                provider_id,
                connection_string,
                ssl_mode: "require",
            },
            credential: issued,
        })
    }

    pub(crate) async fn revoke(
        &self,
        vault: &dyn Vault,
        account: &Account,
        credential_id: &str,
        confirmed: bool,
    ) -> Result<Vec<Issued>, String> {
        if !confirmed {
            return Err("Das Widerrufen von Zugangsdaten muss bestätigt werden.".into());
        }
        let list = issued(vault, account).await?;
        let target = list
            .iter()
            .find(|entry| entry.id == credential_id)
            .cloned()
            .ok_or("Diese Zugangsdaten wurden nicht von l8db ausgestellt und können hier nicht widerrufen werden.")?;
        self.delete_credential(&target).await?;
        forget(vault, account, &target.id).await
    }
}

fn issued_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

async fn read_issued(vault: &dyn Vault, account: &Account) -> Result<Vec<Issued>, String> {
    match vault.get(&store::secret_account(account, ISSUED)).await? {
        Some(raw) if !raw.trim().is_empty() => serde_json::from_str(&raw)
            .map_err(|_| "Liste der ausgestellten Zugangsdaten ist beschädigt.".to_string()),
        _ => Ok(Vec::new()),
    }
}

async fn write_issued(vault: &dyn Vault, account: &Account, list: &[Issued]) -> Result<(), String> {
    let raw = serde_json::to_string(list)
        .map_err(|_| "Zugangsdaten konnten nicht gespeichert werden.".to_string())?;
    vault
        .set(&store::secret_account(account, ISSUED), &raw)
        .await
}

pub(crate) async fn issued(vault: &dyn Vault, account: &Account) -> Result<Vec<Issued>, String> {
    let _guard = issued_lock().lock().await;
    read_issued(vault, account).await
}

async fn record(vault: &dyn Vault, account: &Account, entry: Issued) -> Result<(), String> {
    let _guard = issued_lock().lock().await;
    let mut list = read_issued(vault, account).await?;
    if list.len() >= MAX_ISSUED {
        return Err(format!(
            "Es werden höchstens {MAX_ISSUED} ausgestellte Zugangsdaten pro Konto verwaltet. Bitte alte widerrufen."
        ));
    }
    list.push(entry);
    write_issued(vault, account, &list).await
}

async fn forget(vault: &dyn Vault, account: &Account, id: &str) -> Result<Vec<Issued>, String> {
    let _guard = issued_lock().lock().await;
    let mut list = read_issued(vault, account).await?;
    list.retain(|entry| entry.id != id);
    write_issued(vault, account, &list).await?;
    Ok(list)
}

pub(crate) async fn client(vault: &dyn Vault, account: &Account) -> Result<Client, String> {
    let base = http::base_url(API, account.endpoint.as_deref())?;
    let credential = store::credential(vault, account).await?;
    let (id, token) = credential.split_once(':').ok_or(
        "Gespeicherter PlanetScale-Zugang ist beschädigt. Bitte das Konto neu hinzufügen.",
    )?;
    Ok(Client::new(base, id, token))
}

pub(crate) async fn add_token(
    vault: &dyn Vault,
    label: &str,
    token_id: &str,
    token: &str,
    endpoint: Option<&str>,
) -> Result<Account, String> {
    let (id, token) = validate_token_parts(token_id, token)?;
    let endpoint = super::neon::custom_endpoint(API, endpoint)?;
    let client = Client::new(http::base_url(API, endpoint.as_deref())?, id, token);
    client.verify().await?;
    let label = store::clean_label(label, "PlanetScale")?;
    store::insert(
        vault,
        store::new_account(
            Provider::Planetscale,
            label,
            AuthMethod::ServiceToken,
            endpoint,
            None,
        ),
        &format!("{id}:{token}"),
    )
    .await
}

async fn open(account_id: &str) -> Result<(Account, Client), String> {
    let account = store::find_for(&Keychain, account_id, Provider::Planetscale).await?;
    let client = client(&Keychain, &account).await?;
    Ok((account, client))
}

#[tauri::command]
pub async fn cloud_planetscale_add_token(
    label: String,
    token_id: String,
    token: String,
    endpoint: Option<String>,
) -> Result<Account, String> {
    add_token(&Keychain, &label, &token_id, &token, endpoint.as_deref()).await
}

#[tauri::command]
pub async fn cloud_planetscale_organizations(
    account_id: String,
    page: Option<i64>,
) -> Result<Paged<PsOrganization>, String> {
    open(&account_id).await?.1.organizations(page).await
}

#[tauri::command]
pub async fn cloud_planetscale_databases(
    account_id: String,
    organization: String,
    page: Option<i64>,
) -> Result<Paged<PsDatabase>, String> {
    open(&account_id)
        .await?
        .1
        .databases(&organization, page)
        .await
}

#[tauri::command]
pub async fn cloud_planetscale_branches(
    account_id: String,
    organization: String,
    database: String,
    page: Option<i64>,
) -> Result<Paged<PsBranch>, String> {
    open(&account_id)
        .await?
        .1
        .branches(&organization, &database, page)
        .await
}

#[tauri::command]
pub async fn cloud_planetscale_create_credential(
    account_id: String,
    request: CredentialRequest,
) -> Result<IssuedConnection, String> {
    let (account, client) = open(&account_id).await?;
    client
        .create_credential(&Keychain, &account, &request)
        .await
}

#[tauri::command]
pub async fn cloud_planetscale_credentials(account_id: String) -> Result<Vec<Issued>, String> {
    let account = store::find_for(&Keychain, &account_id, Provider::Planetscale).await?;
    issued(&Keychain, &account).await
}

#[tauri::command]
pub async fn cloud_planetscale_revoke_credential(
    account_id: String,
    credential_id: String,
    confirmed: bool,
) -> Result<Vec<Issued>, String> {
    let (account, client) = open(&account_id).await?;
    client
        .revoke(&Keychain, &account, &credential_id, confirmed)
        .await
}
