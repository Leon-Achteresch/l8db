use async_trait::async_trait;
use serde::{Deserialize, Serialize};

const INDEX_ACCOUNT: &str = "backend:cloud:accounts";
const MAX_ACCOUNTS: usize = 50;
const MAX_LABEL_CHARS: usize = 80;

#[async_trait]
pub(crate) trait Vault: Send + Sync {
    async fn get(&self, account: &str) -> Result<Option<String>, String>;
    async fn set(&self, account: &str, value: &str) -> Result<(), String>;
    async fn remove(&self, account: &str) -> Result<(), String>;
    async fn connection_secret_exists(&self, connection_id: &str) -> Result<bool, String>;
    async fn set_connection_secret(&self, connection_id: &str, value: &str) -> Result<(), String>;
}

pub(crate) struct Keychain;

#[async_trait]
impl Vault for Keychain {
    async fn get(&self, account: &str) -> Result<Option<String>, String> {
        crate::db::secrets::backend_secret(account.to_string()).await
    }

    async fn set(&self, account: &str, value: &str) -> Result<(), String> {
        crate::db::secrets::set_backend_secret(account.to_string(), value.to_string()).await
    }

    async fn remove(&self, account: &str) -> Result<(), String> {
        crate::db::secrets::remove_backend_secret(account.to_string()).await
    }

    async fn connection_secret_exists(&self, connection_id: &str) -> Result<bool, String> {
        Ok(crate::db::secrets::load_secret(connection_id.to_string())
            .await?
            .is_some())
    }

    async fn set_connection_secret(&self, connection_id: &str, value: &str) -> Result<(), String> {
        crate::db::secrets::store_secret(connection_id.to_string(), value.to_string()).await
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Provider {
    Neon,
    Planetscale,
    Spacetimedb,
}

impl Provider {
    pub(crate) fn slug(self) -> &'static str {
        match self {
            Provider::Neon => "neon",
            Provider::Planetscale => "planetscale",
            Provider::Spacetimedb => "spacetimedb",
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Provider::Neon => "Neon",
            Provider::Planetscale => "PlanetScale",
            Provider::Spacetimedb => "SpacetimeDB",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AuthMethod {
    ApiKey,
    Oauth,
    ServiceToken,
    Token,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Account {
    pub id: String,
    pub provider: Provider,
    pub label: String,
    pub auth: AuthMethod,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub identity: Option<String>,
    pub created_at: String,
}

pub(crate) fn secret_account(account: &Account, part: &str) -> String {
    format!(
        "backend:cloud:{}:{}:{part}",
        account.provider.slug(),
        account.id
    )
}

pub(crate) fn credential_account(account: &Account) -> String {
    secret_account(account, "credential")
}

fn lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

pub(crate) fn clean_label(label: &str, fallback: &str) -> Result<String, String> {
    let label: String = label
        .trim()
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    if label.chars().count() > MAX_LABEL_CHARS {
        return Err(format!(
            "Der Name darf höchstens {MAX_LABEL_CHARS} Zeichen lang sein."
        ));
    }
    Ok(if label.is_empty() {
        fallback.to_string()
    } else {
        label
    })
}

async fn read_index(vault: &dyn Vault) -> Result<Vec<Account>, String> {
    match vault.get(INDEX_ACCOUNT).await? {
        Some(raw) if !raw.trim().is_empty() => serde_json::from_str(&raw)
            .map_err(|_| "Der Index der Cloud-Konten ist beschädigt.".to_string()),
        _ => Ok(Vec::new()),
    }
}

async fn write_index(vault: &dyn Vault, accounts: &[Account]) -> Result<(), String> {
    let raw = serde_json::to_string(accounts)
        .map_err(|_| "Cloud-Konten konnten nicht gespeichert werden.".to_string())?;
    vault.set(INDEX_ACCOUNT, &raw).await
}

pub(crate) async fn list(vault: &dyn Vault) -> Result<Vec<Account>, String> {
    let _guard = lock().lock().await;
    read_index(vault).await
}

pub(crate) async fn find(vault: &dyn Vault, id: &str) -> Result<Account, String> {
    list(vault)
        .await?
        .into_iter()
        .find(|account| account.id == id)
        .ok_or_else(|| "Cloud-Konto nicht gefunden. Bitte erneut hinzufügen.".to_string())
}

pub(crate) async fn find_for(
    vault: &dyn Vault,
    id: &str,
    provider: Provider,
) -> Result<Account, String> {
    let account = find(vault, id).await?;
    if account.provider != provider {
        return Err(format!("Das Konto gehört nicht zu {}.", provider.label()));
    }
    Ok(account)
}

pub(crate) async fn credential(vault: &dyn Vault, account: &Account) -> Result<String, String> {
    vault
        .get(&credential_account(account))
        .await?
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "Für das {}-Konto „{}“ ist kein Zugang im Schlüsselbund gespeichert. Bitte das Konto neu hinzufügen.",
                account.provider.label(),
                account.label
            )
        })
}

pub(crate) fn new_account(
    provider: Provider,
    label: String,
    auth: AuthMethod,
    endpoint: Option<String>,
    identity: Option<String>,
) -> Account {
    Account {
        id: super::http::random_hex(8),
        provider,
        label,
        auth,
        endpoint,
        identity,
        created_at: chrono::Utc::now().to_rfc3339(),
    }
}

pub(crate) async fn insert(
    vault: &dyn Vault,
    account: Account,
    credential: &str,
) -> Result<Account, String> {
    let _guard = lock().lock().await;
    let mut accounts = read_index(vault).await?;
    if accounts.len() >= MAX_ACCOUNTS {
        return Err(format!(
            "Es sind höchstens {MAX_ACCOUNTS} Cloud-Konten möglich."
        ));
    }
    if accounts.iter().any(|existing| existing.id == account.id) {
        return Err("Konto-ID ist bereits vergeben. Bitte erneut versuchen.".into());
    }
    vault.set(&credential_account(&account), credential).await?;
    accounts.push(account.clone());
    if let Err(error) = write_index(vault, &accounts).await {
        let _ = vault.remove(&credential_account(&account)).await;
        return Err(error);
    }
    Ok(account)
}

pub(crate) async fn update_credential(
    vault: &dyn Vault,
    account: &Account,
    credential: &str,
) -> Result<(), String> {
    vault.set(&credential_account(account), credential).await
}

pub(crate) async fn remove(vault: &dyn Vault, id: &str, parts: &[&str]) -> Result<(), String> {
    let _guard = lock().lock().await;
    let mut accounts = read_index(vault).await?;
    let Some(position) = accounts.iter().position(|account| account.id == id) else {
        return Err("Cloud-Konto nicht gefunden.".into());
    };
    let account = accounts.remove(position);
    write_index(vault, &accounts).await?;
    vault.remove(&credential_account(&account)).await?;
    for part in parts {
        vault.remove(&secret_account(&account, part)).await?;
    }
    Ok(())
}

pub(crate) fn validate_connection_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Bitte einen Namen für die Verbindung angeben.".into());
    }
    if name.chars().count() > 120 || name.chars().any(char::is_control) {
        return Err("Der Verbindungsname ist zu lang oder enthält Steuerzeichen.".into());
    }
    Ok(name.to_string())
}

pub(crate) async fn free_connection_id(vault: &dyn Vault) -> Result<String, String> {
    for _ in 0..4 {
        let id = super::http::uuid_v4();
        if !vault.connection_secret_exists(&id).await? {
            return Ok(id);
        }
    }
    Err("Für die neue Verbindung konnte keine freie ID erzeugt werden.".into())
}

pub(crate) async fn store_connection_password(
    vault: &dyn Vault,
    password: &str,
) -> Result<String, String> {
    let id = free_connection_id(vault).await?;
    vault.set_connection_secret(&id, password).await?;
    Ok(id)
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct CreatedConnection {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub provider_id: &'static str,
    pub connection_string: String,
    pub ssl_mode: &'static str,
}

#[cfg(test)]
pub(crate) mod memory {
    use super::Vault;
    use async_trait::async_trait;
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    #[derive(Default)]
    pub(crate) struct MemoryVault {
        pub backend: Mutex<BTreeMap<String, String>>,
        pub connections: Mutex<BTreeMap<String, String>>,
    }

    #[async_trait]
    impl Vault for MemoryVault {
        async fn get(&self, account: &str) -> Result<Option<String>, String> {
            assert!(account.starts_with("backend:cloud:"), "{account}");
            Ok(self.backend.lock().unwrap().get(account).cloned())
        }

        async fn set(&self, account: &str, value: &str) -> Result<(), String> {
            assert!(account.starts_with("backend:cloud:"), "{account}");
            self.backend
                .lock()
                .unwrap()
                .insert(account.to_string(), value.to_string());
            Ok(())
        }

        async fn remove(&self, account: &str) -> Result<(), String> {
            self.backend.lock().unwrap().remove(account);
            Ok(())
        }

        async fn connection_secret_exists(&self, connection_id: &str) -> Result<bool, String> {
            Ok(self.connections.lock().unwrap().contains_key(connection_id))
        }

        async fn set_connection_secret(
            &self,
            connection_id: &str,
            value: &str,
        ) -> Result<(), String> {
            self.connections
                .lock()
                .unwrap()
                .insert(connection_id.to_string(), value.to_string());
            Ok(())
        }
    }
}
