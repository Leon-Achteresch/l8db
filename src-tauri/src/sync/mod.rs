mod coordinator;
mod crypto;
mod remote;

use remote::{Gist, Precondition, RemoteFile, StoreResult, WebDav, GITHUB_API};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tokio::sync::Notify;
use zeroize::Zeroizing;

pub use coordinator::forget_window;

const WEBDAV_ACCOUNT: &str = "l8db-sync:webdav";
const GITHUB_ACCOUNT: &str = "l8db-sync:github";
const PASSPHRASE_ACCOUNT: &str = "l8db-sync:passphrase";
const BACKUP_LIMIT: usize = 10;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "provider", rename_all = "camelCase")]
pub enum SyncTarget {
    #[serde(rename = "webdav", rename_all = "camelCase")]
    Webdav {
        url: String,
        username: String,
        path: String,
        #[serde(default)]
        allow_insecure: bool,
    },
    #[serde(rename = "gist", rename_all = "camelCase")]
    Gist { gist_id: Option<String> },
}

static OPERATIONS: Mutex<Option<HashMap<String, Arc<Notify>>>> = Mutex::new(None);

struct Operation(String);

impl Operation {
    fn start(id: &str) -> (Self, Arc<Notify>) {
        let notify = Arc::new(Notify::new());
        if let Ok(mut map) = OPERATIONS.lock() {
            map.get_or_insert_with(HashMap::new)
                .insert(id.to_string(), notify.clone());
        }
        (Self(id.to_string()), notify)
    }
}

impl Drop for Operation {
    fn drop(&mut self) {
        if let Ok(mut map) = OPERATIONS.lock() {
            if let Some(map) = map.as_mut() {
                map.remove(&self.0);
            }
        }
    }
}

async fn cancellable<T>(
    op_id: &str,
    work: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let (_operation, notify) = Operation::start(op_id);
    tokio::select! {
        result = work => result,
        _ = notify.notified() => Err("Synchronisierung abgebrochen.".into()),
    }
}

async fn secret(account: &'static str) -> Result<String, String> {
    let value = tokio::task::spawn_blocking(move || crate::db::secrets::read_secret(account))
        .await
        .map_err(|e| format!("Keychain-Task fehlgeschlagen: {e}"))??;
    Ok(value.unwrap_or_default())
}

async fn test_target(target: &SyncTarget) -> Result<String, String> {
    let client = remote::client()?;
    match target {
        SyncTarget::Webdav {
            url,
            username,
            path,
            allow_insecure,
        } => {
            let password = secret(WEBDAV_ACCOUNT).await?;
            WebDav {
                url,
                username,
                password: &password,
                path,
                allow_insecure: *allow_insecure,
            }
            .test(&client)
            .await
        }
        SyncTarget::Gist { gist_id } => {
            let token = secret(GITHUB_ACCOUNT).await?;
            Gist {
                api: GITHUB_API,
                token: &token,
                gist_id: gist_id.as_deref().filter(|id| !id.is_empty()),
            }
            .test(&client)
            .await
        }
    }
}

async fn fetch_target(target: &SyncTarget) -> Result<RemoteFile, String> {
    let client = remote::client()?;
    match target {
        SyncTarget::Webdav {
            url,
            username,
            path,
            allow_insecure,
        } => {
            let password = secret(WEBDAV_ACCOUNT).await?;
            WebDav {
                url,
                username,
                password: &password,
                path,
                allow_insecure: *allow_insecure,
            }
            .fetch(&client)
            .await
        }
        SyncTarget::Gist { gist_id } => {
            let token = secret(GITHUB_ACCOUNT).await?;
            Gist {
                api: GITHUB_API,
                token: &token,
                gist_id: gist_id.as_deref().filter(|id| !id.is_empty()),
            }
            .fetch(&client)
            .await
        }
    }
}

async fn store_target(
    target: &SyncTarget,
    content: &str,
    precondition: Precondition,
) -> Result<StoreResult, String> {
    let client = remote::client()?;
    match target {
        SyncTarget::Webdav {
            url,
            username,
            path,
            allow_insecure,
        } => {
            let password = secret(WEBDAV_ACCOUNT).await?;
            WebDav {
                url,
                username,
                password: &password,
                path,
                allow_insecure: *allow_insecure,
            }
            .store(&client, content, precondition)
            .await
        }
        SyncTarget::Gist { gist_id } => {
            let token = secret(GITHUB_ACCOUNT).await?;
            Gist {
                api: GITHUB_API,
                token: &token,
                gist_id: gist_id.as_deref().filter(|id| !id.is_empty()),
            }
            .store(&client, content)
            .await
        }
    }
}

#[tauri::command]
pub async fn sync_test(target: SyncTarget, op_id: String) -> Result<String, String> {
    cancellable(&op_id, test_target(&target)).await
}

#[tauri::command]
pub async fn sync_fetch(target: SyncTarget, op_id: String) -> Result<RemoteFile, String> {
    cancellable(&op_id, fetch_target(&target)).await
}

#[tauri::command]
pub async fn sync_store(
    target: SyncTarget,
    content: String,
    if_match: Option<String>,
    expect_absent: bool,
    op_id: String,
) -> Result<StoreResult, String> {
    let precondition = match (if_match, expect_absent) {
        (Some(etag), _) if !etag.is_empty() => Precondition::Match(etag),
        (_, true) => Precondition::Absent,
        _ => Precondition::None,
    };
    cancellable(&op_id, store_target(&target, &content, precondition)).await
}

#[tauri::command]
pub fn sync_cancel(op_id: String) -> bool {
    let notify = OPERATIONS
        .lock()
        .ok()
        .and_then(|map| map.as_ref().and_then(|map| map.get(&op_id).cloned()));
    match notify {
        Some(notify) => {
            notify.notify_one();
            true
        }
        None => false,
    }
}

#[tauri::command]
pub async fn sync_encrypt(
    plaintext: String,
    salt: Option<String>,
) -> Result<crypto::Sealed, String> {
    let passphrase = secret(PASSPHRASE_ACCOUNT).await?;
    tokio::task::spawn_blocking(move || {
        crypto::seal(
            &passphrase,
            &plaintext,
            crypto::kdf_for_salt(salt.as_deref()),
        )
    })
    .await
    .map_err(|e| format!("Verschlüsselung fehlgeschlagen: {e}"))?
}

#[tauri::command]
pub async fn sync_decrypt(envelope: String) -> Result<String, String> {
    let passphrase = secret(PASSPHRASE_ACCOUNT).await?;
    tokio::task::spawn_blocking(move || crypto::open(&passphrase, &envelope))
        .await
        .map_err(|e| format!("Entschlüsselung fehlgeschlagen: {e}"))?
}

const SECRET_SUFFIXES: [&str; 5] = ["", ":ssh", ":ssh-jumps", ":proxy", ":params"];
const MAX_SECRET_ACCOUNTS: usize = 50_000;

fn valid_secret_account(account: &str) -> bool {
    SECRET_SUFFIXES.iter().any(|suffix| {
        account.strip_suffix(suffix).is_some_and(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
    })
}

fn checked_accounts(accounts: Vec<String>) -> Result<Vec<String>, String> {
    if accounts.len() > MAX_SECRET_ACCOUNTS {
        return Err("Zu viele Secrets für die Synchronisierung.".into());
    }
    if let Some(bad) = accounts
        .iter()
        .find(|account| !valid_secret_account(account))
    {
        return Err(format!("Ungültiges Secret-Konto: {bad}"));
    }
    Ok(accounts)
}

fn collect_secrets(
    accounts: &[String],
    read: impl Fn(&str) -> Result<Option<String>, String>,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let mut found = std::collections::BTreeMap::new();
    for account in accounts {
        if let Some(secret) = read(account)? {
            if !secret.is_empty() {
                found.insert(account.clone(), secret);
            }
        }
    }
    Ok(found)
}

fn restore_secrets(
    plaintext: &str,
    allowed: &[String],
    read: impl Fn(&str) -> Result<Option<String>, String>,
    write: impl Fn(&str, &str) -> Result<(), String>,
) -> Result<Vec<String>, String> {
    let secrets: std::collections::BTreeMap<String, String> = serde_json::from_str(plaintext)
        .map_err(|_| "Synchronisierte Secrets sind beschädigt.".to_string())?;
    let allowed: std::collections::HashSet<&str> = allowed.iter().map(String::as_str).collect();
    let mut updated = Vec::new();
    for (account, secret) in secrets {
        if !allowed.contains(account.as_str()) || !valid_secret_account(&account) {
            continue;
        }
        if read(&account)?.as_deref() != Some(secret.as_str()) {
            write(&account, &secret)?;
            updated.push(account);
        }
    }
    Ok(updated)
}

#[tauri::command]
pub async fn sync_seal_secrets(
    accounts: Vec<String>,
    salt: Option<String>,
) -> Result<Option<crypto::Sealed>, String> {
    let accounts = checked_accounts(accounts)?;
    let passphrase = secret(PASSPHRASE_ACCOUNT).await?;
    tokio::task::spawn_blocking(move || {
        let found = collect_secrets(&accounts, crate::db::secrets::read_secret)?;
        if found.is_empty() {
            return Ok(None);
        }
        let plaintext = Zeroizing::new(serde_json::to_string(&found).map_err(|e| e.to_string())?);
        crypto::seal(
            &passphrase,
            &plaintext,
            crypto::kdf_for_salt(salt.as_deref()),
        )
        .map(Some)
    })
    .await
    .map_err(|e| format!("Secrets konnten nicht verschlüsselt werden: {e}"))?
}

#[tauri::command]
pub async fn sync_open_secrets(
    envelope: String,
    accounts: Vec<String>,
) -> Result<Vec<String>, String> {
    let accounts = checked_accounts(accounts)?;
    let passphrase = secret(PASSPHRASE_ACCOUNT).await?;
    tokio::task::spawn_blocking(move || {
        let plaintext = Zeroizing::new(crypto::open(&passphrase, &envelope)?);
        restore_secrets(
            &plaintext,
            &accounts,
            crate::db::secrets::read_secret,
            crate::db::secrets::write_secret,
        )
    })
    .await
    .map_err(|e| format!("Secrets konnten nicht übernommen werden: {e}"))?
}

#[tauri::command]
pub fn sync_claim_leader<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) -> bool {
    coordinator::claim_leader(window.label(), |label| {
        app.get_webview_window(label).is_some()
    })
}

#[tauri::command]
pub fn sync_release_leader<R: Runtime>(window: WebviewWindow<R>) {
    coordinator::release_leader(window.label());
}

#[tauri::command]
pub fn sync_begin<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) -> bool {
    coordinator::begin(window.label(), |label| {
        app.get_webview_window(label).is_some()
    })
}

#[tauri::command]
pub fn sync_end<R: Runtime>(window: WebviewWindow<R>) {
    coordinator::end(window.label());
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub id: String,
    pub created_at: u64,
    pub reason: String,
    pub size: u64,
}

fn backup_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App-Datenordner nicht gefunden: {e}"))?
        .join("sync-backups"))
}

fn valid_backup_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn list_backups_in(dir: &std::path::Path) -> Result<Vec<BackupInfo>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut backups: Vec<BackupInfo> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let id = name.strip_suffix(".json")?.to_string();
            if !valid_backup_id(&id) {
                return None;
            }
            let (created, reason) = id.split_once('-')?;
            Some(BackupInfo {
                created_at: created.parse().ok()?,
                reason: reason.to_string(),
                size: entry.metadata().ok()?.len(),
                id,
            })
        })
        .collect();
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
    Ok(backups)
}

fn save_backup_in(
    dir: &std::path::Path,
    content: &str,
    reason: &str,
) -> Result<BackupInfo, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Sicherung fehlgeschlagen: {e}"))?;
    let reason: String = reason
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(24)
        .collect();
    let reason = if reason.is_empty() {
        "sync".to_string()
    } else {
        reason
    };
    let mut created = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    while dir.join(format!("{created}-{reason}.json")).exists() {
        created += 1;
    }
    let id = format!("{created}-{reason}");
    let path = dir.join(format!("{id}.json"));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    use std::io::Write;
    options
        .open(&path)
        .and_then(|mut file| file.write_all(content.as_bytes()))
        .map_err(|e| format!("Sicherung fehlgeschlagen: {e}"))?;
    for old in list_backups_in(dir)?.into_iter().skip(BACKUP_LIMIT) {
        let _ = std::fs::remove_file(dir.join(format!("{}.json", old.id)));
    }
    Ok(BackupInfo {
        id,
        created_at: created,
        reason,
        size: content.len() as u64,
    })
}

#[tauri::command]
pub async fn sync_backup_save<R: Runtime>(
    app: AppHandle<R>,
    content: String,
    reason: String,
) -> Result<BackupInfo, String> {
    let dir = backup_dir(&app)?;
    tokio::task::spawn_blocking(move || save_backup_in(&dir, &content, &reason))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sync_backup_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<BackupInfo>, String> {
    let dir = backup_dir(&app)?;
    tokio::task::spawn_blocking(move || list_backups_in(&dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sync_backup_load<R: Runtime>(app: AppHandle<R>, id: String) -> Result<String, String> {
    if !valid_backup_id(&id) {
        return Err("Ungültige Sicherung.".into());
    }
    let path = backup_dir(&app)?.join(format!("{id}.json"));
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("Sicherung konnte nicht gelesen werden: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_deserializes_from_frontend_shape() {
        let webdav: SyncTarget = serde_json::from_value(serde_json::json!({
            "provider": "webdav",
            "url": "https://cloud.example/remote.php/dav/files/leon",
            "username": "leon",
            "path": "/l8db/l8db-sync.json",
            "allowInsecure": false
        }))
        .unwrap();
        assert!(matches!(
            webdav,
            SyncTarget::Webdav {
                allow_insecure: false,
                ..
            }
        ));
        let gist: SyncTarget =
            serde_json::from_value(serde_json::json!({"provider": "gist", "gistId": null}))
                .unwrap();
        assert!(matches!(gist, SyncTarget::Gist { gist_id: None }));
    }

    #[test]
    fn secret_accounts_are_restricted_to_connection_secrets() {
        assert!(valid_secret_account("3f1c-uuid"));
        assert!(valid_secret_account("3f1c-uuid:ssh-jumps"));
        assert!(!valid_secret_account("l8db-sync:passphrase"));
        assert!(!valid_secret_account("automation:smtp:x"));
        assert!(!valid_secret_account(":ssh"));
        assert!(checked_accounts(vec!["a:params".into(), "l8db-sync:github".into()]).is_err());
    }

    #[test]
    fn secrets_round_trip_only_touches_allowed_changed_accounts() {
        let store = Mutex::new(std::collections::BTreeMap::from([
            ("a".to_string(), "pw-a".to_string()),
            ("a:ssh".to_string(), "ssh-a".to_string()),
            ("b".to_string(), "pw-b".to_string()),
        ]));
        let read = |account: &str| Ok(store.lock().unwrap().get(account).cloned());
        let accounts = vec![
            "a".to_string(),
            "a:ssh".to_string(),
            "b".to_string(),
            "c".to_string(),
        ];
        let found = collect_secrets(&accounts, read).unwrap();
        assert_eq!(found.len(), 3);
        let mut incoming = found.clone();
        incoming.insert("b".into(), "pw-b-neu".into());
        incoming.insert("c".into(), "pw-c".into());
        incoming.insert("l8db-sync:github".into(), "boese".into());
        let plaintext = serde_json::to_string(&incoming).unwrap();
        let writes = Mutex::new(Vec::new());
        let updated = restore_secrets(
            &plaintext,
            &[
                "a".into(),
                "a:ssh".into(),
                "b".into(),
                "l8db-sync:github".into(),
            ],
            |account| Ok(store.lock().unwrap().get(account).cloned()),
            |account, secret| {
                writes
                    .lock()
                    .unwrap()
                    .push((account.to_string(), secret.to_string()));
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(updated, vec!["b".to_string()]);
        assert_eq!(writes.lock().unwrap().len(), 1);
    }

    #[test]
    fn backups_rotate_and_reject_traversal() {
        let dir = tempfile::tempdir().unwrap();
        for index in 0..(BACKUP_LIMIT + 3) {
            save_backup_in(dir.path(), &format!("{{\"n\":{index}}}"), "download").unwrap();
        }
        let backups = list_backups_in(dir.path()).unwrap();
        assert_eq!(backups.len(), BACKUP_LIMIT);
        assert!(backups
            .windows(2)
            .all(|pair| pair[0].created_at >= pair[1].created_at));
        assert!(!valid_backup_id("../secret"));
        assert!(valid_backup_id(&backups[0].id));
    }

    #[test]
    fn cancel_aborts_pending_operation() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(async {
            let pending = cancellable("op-test", async {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                Ok::<_, String>(())
            });
            let cancel = async {
                tokio::task::yield_now().await;
                assert!(sync_cancel("op-test".into()));
            };
            let (result, _) = tokio::join!(pending, cancel);
            result
        });
        assert_eq!(result.unwrap_err(), "Synchronisierung abgebrochen.");
        assert!(!sync_cancel("op-test".into()));
    }
}
