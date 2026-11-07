pub(crate) mod http;
pub mod neon;
pub mod oauth;
pub mod planetscale;
pub mod spacetime;
pub(crate) mod store;

#[cfg(test)]
mod tests;

use store::{Account, Keychain, Provider, Vault};

pub(crate) async fn remove_account(
    vault: &dyn Vault,
    account_id: &str,
    forget_issued: bool,
) -> Result<(), String> {
    let account = store::find(vault, account_id).await?;
    let parts: &[&str] = match account.provider {
        Provider::Neon => &[neon::AUTH_KEYS],
        Provider::Planetscale => {
            let issued = planetscale::issued(vault, &account).await?;
            if !issued.is_empty() && !forget_issued {
                return Err(format!(
                    "Für dieses Konto sind noch {} von l8db ausgestellte Zugangsdaten aktiv. Bitte zuerst widerrufen oder das Vergessen ausdrücklich bestätigen; die Zugangsdaten bleiben sonst bei PlanetScale gültig.",
                    issued.len()
                ));
            }
            &[planetscale::ISSUED]
        }
        Provider::Spacetimedb => &[],
    };
    store::remove(vault, &account.id, parts).await
}

#[tauri::command]
pub async fn cloud_accounts() -> Result<Vec<Account>, String> {
    store::list(&Keychain).await
}

#[tauri::command]
pub async fn cloud_account_remove(account_id: String, forget_issued: bool) -> Result<(), String> {
    remove_account(&Keychain, &account_id, forget_issued).await
}
