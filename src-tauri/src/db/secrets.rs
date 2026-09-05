const SERVICE: &str = "l8db";

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(|e| format!("Keychain-Zugriff fehlgeschlagen: {e}"))
}

#[tauri::command]
pub async fn store_secret(account: String, secret: String) -> Result<(), String> {
    entry(&account)?
        .set_password(&secret)
        .map_err(|e| format!("Secret konnte nicht gespeichert werden: {e}"))
}

#[tauri::command]
pub async fn load_secret(account: String) -> Result<Option<String>, String> {
    let entry = entry(&account)?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Secret konnte nicht geladen werden: {e}")),
    }
}

#[tauri::command]
pub async fn delete_secret(account: String) -> Result<(), String> {
    let entry = entry(&account)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Secret konnte nicht gelöscht werden: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::{delete_secret, load_secret, store_secret};

    #[tokio::test]
    async fn secret_roundtrip() {
        let account = format!("l8db-test-{}", std::process::id());
        if store_secret(account.clone(), "s3cret-pw".to_string()).await.is_err() {
            return;
        }
        let loaded = load_secret(account.clone()).await.unwrap();
        assert_eq!(loaded.as_deref(), Some("s3cret-pw"));
        delete_secret(account.clone()).await.unwrap();
        let gone = load_secret(account).await.unwrap();
        assert_eq!(gone, None);
    }
}
