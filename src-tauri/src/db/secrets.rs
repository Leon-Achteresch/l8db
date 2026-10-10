#[cfg(not(debug_assertions))]
mod backend {
    const SERVICE: &str = "l8db";

    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, account)
            .map_err(|e| format!("Keychain-Zugriff fehlgeschlagen: {e}"))
    }

    pub fn set(account: &str, secret: &str) -> Result<(), String> {
        entry(account)?
            .set_password(secret)
            .map_err(|e| format!("Secret konnte nicht gespeichert werden: {e}"))
    }

    pub fn get(account: &str) -> Result<Option<String>, String> {
        match entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Secret konnte nicht geladen werden: {e}")),
        }
    }

    pub fn delete(account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Secret konnte nicht gelöscht werden: {e}")),
        }
    }
}

#[cfg(debug_assertions)]
mod backend {
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::sync::Mutex;

    static LOCK: Mutex<()> = Mutex::new(());

    fn path() -> Result<PathBuf, String> {
        let path = match std::env::var_os("L8DB_DEV_SECRETS") {
            Some(path) => PathBuf::from(path),
            None => PathBuf::from(std::env::var_os("HOME").ok_or("HOME ist nicht gesetzt")?)
                .join(".l8db-dev-secrets.json"),
        };
        if path.is_absolute() {
            Ok(path)
        } else {
            Err(format!(
                "Secrets-Pfad ist nicht absolut: {}",
                path.display()
            ))
        }
    }

    fn read() -> Result<BTreeMap<String, String>, String> {
        match std::fs::read(path()?) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(e.to_string()),
        }
    }

    fn write(map: &BTreeMap<String, String>) -> Result<(), String> {
        use std::io::Write;
        let path = path()?;
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(map).map_err(|e| e.to_string())?;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
    }

    pub fn set(account: &str, secret: &str) -> Result<(), String> {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let mut map = read()?;
        map.insert(account.to_string(), secret.to_string());
        write(&map)
    }

    pub fn get(account: &str) -> Result<Option<String>, String> {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let mut map = read()?;
        if let Some(secret) = map.remove(account) {
            return Ok(Some(secret));
        }
        let secret = match keyring::Entry::new("l8db", account).and_then(|e| e.get_password()) {
            Ok(secret) => secret,
            Err(_) => return Ok(None),
        };
        map.insert(account.to_string(), secret.clone());
        write(&map)?;
        Ok(Some(secret))
    }

    pub fn delete(account: &str) -> Result<(), String> {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let mut map = read()?;
        if map.remove(account).is_some() {
            write(&map)?;
        }
        Ok(())
    }
}

pub use backend::delete as remove_secret;
pub use backend::get as read_secret;
pub use backend::set as write_secret;

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("Keychain-Task fehlgeschlagen: {e}"))?
}

#[tauri::command]
pub async fn store_secret(account: String, secret: String) -> Result<(), String> {
    blocking(move || backend::set(&account, &secret)).await
}

#[tauri::command]
pub async fn load_secret(account: String) -> Result<Option<String>, String> {
    blocking(move || backend::get(&account)).await
}

#[tauri::command]
pub async fn delete_secret(account: String) -> Result<(), String> {
    blocking(move || backend::delete(&account)).await
}

#[cfg(test)]
mod tests {
    use super::{delete_secret, load_secret, store_secret};

    #[tokio::test]
    async fn secret_roundtrip() {
        let account = format!("l8db-test-{}", std::process::id());
        if store_secret(account.clone(), "s3cret-pw".to_string())
            .await
            .is_err()
        {
            return;
        }
        let loaded = load_secret(account.clone()).await.unwrap();
        assert_eq!(loaded.as_deref(), Some("s3cret-pw"));
        delete_secret(account.clone()).await.unwrap();
        let gone = load_secret(account).await.unwrap();
        assert_eq!(gone, None);
    }
}
