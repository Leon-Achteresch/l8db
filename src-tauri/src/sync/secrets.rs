use super::crypto;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ring::hmac;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use zeroize::Zeroizing;

const SECRET_SUFFIXES: [&str; 5] = ["", ":ssh", ":ssh-jumps", ":proxy", ":params"];
const MAX_SECRET_ACCOUNTS: usize = 50_000;
const DEVICE_KEY_ACCOUNT: &str = "l8db-sync:device-key";
const DELETED: &str = "-";
pub const TOMBSTONE_TTL_MS: u64 = 90 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RemoteSecret {
    pub v: Option<String>,
    pub t: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BaseEntry(pub String, pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Sync,
    Upload,
    Download,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Resolution {
    Local,
    Remote,
}

#[derive(Debug, Default)]
pub struct MergeOutput {
    pub conflicts: Vec<String>,
    pub previous: Vec<(String, Option<String>)>,
    pub merged: BTreeMap<String, RemoteSecret>,
    pub base: BTreeMap<String, BaseEntry>,
    pub agreed: BTreeMap<String, BaseEntry>,
    pub writes: Vec<(String, Option<String>)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretMerge {
    pub conflicts: Vec<String>,
    pub backup: Option<String>,
    pub sealed: Option<crypto::Sealed>,
    pub base: BTreeMap<String, BaseEntry>,
    pub agreed: BTreeMap<String, BaseEntry>,
    pub updated: Vec<String>,
}

pub fn valid_secret_account(account: &str) -> bool {
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

pub fn checked_accounts(accounts: Vec<String>) -> Result<Vec<String>, String> {
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

pub fn parse_remote(plaintext: &str) -> Result<BTreeMap<String, RemoteSecret>, String> {
    if let Ok(entries) = serde_json::from_str::<BTreeMap<String, RemoteSecret>>(plaintext) {
        return Ok(entries);
    }
    serde_json::from_str::<BTreeMap<String, String>>(plaintext)
        .map(|legacy| {
            legacy
                .into_iter()
                .map(|(account, value)| {
                    (
                        account,
                        RemoteSecret {
                            v: Some(value),
                            t: 0,
                        },
                    )
                })
                .collect()
        })
        .map_err(|_| "Synchronisierte Secrets sind beschädigt.".to_string())
}

pub fn digester(key: &[u8]) -> impl Fn(&str) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, key);
    move |value: &str| {
        hmac::sign(&key, value.as_bytes())
            .as_ref()
            .iter()
            .take(16)
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

fn state_of(entry: Option<&RemoteSecret>, digest: &impl Fn(&str) -> String) -> Option<String> {
    entry.map(|entry| {
        entry
            .v
            .as_deref()
            .map(digest)
            .unwrap_or_else(|| DELETED.into())
    })
}

pub fn merge(
    accounts: &[String],
    base: &BTreeMap<String, BaseEntry>,
    remote: Option<&BTreeMap<String, RemoteSecret>>,
    mode: Mode,
    now: u64,
    resolutions: &BTreeMap<String, Resolution>,
    read: impl Fn(&str) -> Result<Option<String>, String>,
    digest: impl Fn(&str) -> String,
) -> Result<MergeOutput, String> {
    let mut local = Vec::with_capacity(accounts.len());
    for account in accounts {
        local.push(read(account)?.filter(|value| !value.is_empty()));
    }
    let mut output = MergeOutput::default();
    let mut seen = HashSet::new();
    for (account, value) in accounts.iter().zip(local) {
        if !seen.insert(account.as_str()) {
            continue;
        }
        let known = base.get(account);
        let ours = match &value {
            Some(value) => Some(digest(value)),
            None => known.map(|_| DELETED.to_string()),
        };
        let ours_at = match (known, &ours) {
            (Some(BaseEntry(hash, at)), Some(state)) if hash == state => *at,
            _ => now,
        };
        let remote_entry = remote.and_then(|remote| remote.get(account));
        let theirs = state_of(remote_entry, &digest);
        let known_hash = known.map(|entry| entry.0.clone());
        let first_contact = known.is_none() && ours.is_some() && theirs.is_some() && ours != theirs;
        let take_remote = match mode {
            Mode::Upload => false,
            Mode::Download => theirs.is_some(),
            Mode::Sync if first_contact => match resolutions.get(account) {
                Some(Resolution::Local) => false,
                Some(Resolution::Remote) => true,
                None => {
                    output.conflicts.push(account.clone());
                    if let Some(entry) = remote_entry {
                        output.merged.insert(account.clone(), entry.clone());
                    }
                    continue;
                }
            },
            Mode::Sync => {
                if ours == theirs || theirs.is_none() || theirs == known_hash {
                    false
                } else if ours.is_none() || ours == known_hash {
                    true
                } else {
                    remote_entry.is_some_and(|entry| entry.t > ours_at)
                }
            }
        };
        let (entry, state) = if take_remote {
            let entry = remote_entry
                .cloned()
                .unwrap_or(RemoteSecret { v: None, t: now });
            if entry.v != value {
                output.writes.push((account.clone(), entry.v.clone()));
                output.previous.push((account.clone(), value.clone()));
            }
            (entry, theirs.clone())
        } else {
            let at = if ours == theirs {
                remote_entry.map(|entry| entry.t).unwrap_or(ours_at)
            } else if first_contact {
                remote_entry.map_or(ours_at, |entry| ours_at.max(entry.t + 1))
            } else {
                ours_at
            };
            (
                RemoteSecret {
                    v: value.clone(),
                    t: at,
                },
                ours,
            )
        };
        let Some(state) = state else { continue };
        if theirs.as_deref() == Some(state.as_str()) {
            output
                .agreed
                .insert(account.clone(), BaseEntry(state.clone(), entry.t));
        } else if let Some(known) = known {
            output.agreed.insert(account.clone(), known.clone());
        }
        if state == DELETED && now.saturating_sub(entry.t) > TOMBSTONE_TTL_MS {
            continue;
        }
        output
            .base
            .insert(account.clone(), BaseEntry(state, entry.t));
        output.merged.insert(account.clone(), entry);
    }
    Ok(output)
}

fn device_key() -> Result<Zeroizing<Vec<u8>>, String> {
    if let Some(stored) = crate::db::secrets::read_secret(DEVICE_KEY_ACCOUNT)? {
        if let Ok(bytes) = STANDARD.decode(stored) {
            if bytes.len() == 32 {
                return Ok(Zeroizing::new(bytes));
            }
        }
    }
    let fresh: [u8; 32] = rand::random();
    crate::db::secrets::write_secret(DEVICE_KEY_ACCOUNT, &STANDARD.encode(fresh))?;
    Ok(Zeroizing::new(fresh.to_vec()))
}

pub struct Request<'a> {
    pub envelope: Option<&'a str>,
    pub accounts: Vec<String>,
    pub base: BTreeMap<String, BaseEntry>,
    pub mode: Mode,
    pub now: u64,
    pub salt: Option<&'a str>,
    pub resolutions: BTreeMap<String, Resolution>,
    pub backup_dir: Option<&'a Path>,
    pub backup_id: Option<String>,
}

fn backup_id_valid(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn write_backup(
    passphrase: &str,
    dir: &Path,
    id: &str,
    previous: &[(String, Option<String>)],
    salt: Option<&str>,
) -> Result<(), String> {
    if !backup_id_valid(id) {
        return Err("Ungültige Sicherung.".into());
    }
    let mut map: BTreeMap<String, Option<String>> = if dir.join(format!("{id}.secrets")).exists() {
        read_backup(passphrase, dir, id)?
    } else {
        BTreeMap::new()
    };
    for (account, value) in previous {
        map.entry(account.clone()).or_insert_with(|| value.clone());
    }
    let plaintext = Zeroizing::new(serde_json::to_string(&map).map_err(|e| e.to_string())?);
    let sealed = crypto::seal(passphrase, &plaintext, crypto::kdf_for_salt(salt))?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Sicherung fehlgeschlagen: {e}"))?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    use std::io::Write;
    options
        .open(dir.join(format!("{id}.secrets")))
        .and_then(|mut file| file.write_all(sealed.envelope.as_bytes()))
        .map_err(|e| format!("Passwort-Sicherung fehlgeschlagen: {e}"))
}

pub fn read_backup(
    passphrase: &str,
    dir: &Path,
    id: &str,
) -> Result<BTreeMap<String, Option<String>>, String> {
    if !backup_id_valid(id) {
        return Err("Ungültige Sicherung.".into());
    }
    let envelope = std::fs::read_to_string(dir.join(format!("{id}.secrets")))
        .map_err(|e| format!("Passwort-Sicherung konnte nicht gelesen werden: {e}"))?;
    let plaintext = Zeroizing::new(crypto::open(passphrase, &envelope)?);
    let map: BTreeMap<String, Option<String>> = serde_json::from_str(&plaintext)
        .map_err(|_| "Passwort-Sicherung ist beschädigt.".to_string())?;
    Ok(map
        .into_iter()
        .filter(|(account, _)| valid_secret_account(account))
        .collect())
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored: Vec<String>,
    pub failed: Vec<String>,
    pub backup: Option<String>,
}

pub fn restore_backup(
    passphrase: &str,
    dir: &Path,
    id: &str,
    now: u64,
) -> Result<RestoreResult, String> {
    let entries = read_backup(passphrase, dir, id)?;
    let mut current = Vec::with_capacity(entries.len());
    for account in entries.keys() {
        current.push((
            account.clone(),
            crate::db::secrets::read_secret(account)?.filter(|value| !value.is_empty()),
        ));
    }
    let changed: Vec<(String, Option<String>)> = current
        .into_iter()
        .filter(|(account, value)| entries.get(account) != Some(value))
        .collect();
    let mut result = RestoreResult::default();
    if !changed.is_empty() {
        let backup = format!("{now}-wiederherstellung");
        write_backup(passphrase, dir, &backup, &changed, None)?;
        result.backup = Some(backup);
    }
    for (account, value) in entries {
        if !changed.iter().any(|(candidate, _)| candidate == &account) {
            continue;
        }
        let written = match &value {
            Some(value) => crate::db::secrets::write_secret(&account, value),
            None => crate::db::secrets::remove_secret(&account),
        };
        match written {
            Ok(()) => result.restored.push(account),
            Err(_) => result.failed.push(account),
        }
    }
    Ok(result)
}

pub fn run(passphrase: &str, request: Request<'_>) -> Result<SecretMerge, String> {
    let accounts = checked_accounts(request.accounts)?;
    let mode = request.mode;
    let remote = match request.envelope.filter(|_| mode != Mode::Upload) {
        Some(envelope) => Some(parse_remote(&Zeroizing::new(crypto::open(
            passphrase, envelope,
        )?))?),
        None => None,
    };
    let key = device_key()?;
    let output = merge(
        &accounts,
        &request.base,
        remote.as_ref(),
        mode,
        request.now,
        &request.resolutions,
        crate::db::secrets::read_secret,
        digester(&key),
    )?;
    let mut backup = None;
    if !output.previous.is_empty() {
        let dir = request
            .backup_dir
            .ok_or_else(|| "Kein Ordner für Sicherungen verfügbar.".to_string())?;
        let id = request
            .backup_id
            .filter(|id| backup_id_valid(id))
            .unwrap_or_else(|| format!("{}-passwoerter", request.now));
        write_backup(passphrase, dir, &id, &output.previous, request.salt)?;
        backup = Some(id);
    }
    let mut updated = Vec::new();
    for (account, value) in &output.writes {
        match value {
            Some(value) => crate::db::secrets::write_secret(account, value)?,
            None => crate::db::secrets::remove_secret(account)?,
        }
        updated.push(account.clone());
    }
    let sealed = if output.merged.is_empty() || mode == Mode::Download {
        None
    } else {
        let plaintext =
            Zeroizing::new(serde_json::to_string(&output.merged).map_err(|e| e.to_string())?);
        Some(crypto::seal(
            passphrase,
            &plaintext,
            crypto::kdf_for_salt(request.salt),
        )?)
    };
    Ok(SecretMerge {
        conflicts: output.conflicts,
        backup,
        sealed,
        base: output.base,
        agreed: output.agreed,
        updated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn digest() -> impl Fn(&str) -> String {
        digester(b"0123456789abcdef0123456789abcdef")
    }

    fn keychain(entries: &[(&str, &str)]) -> Mutex<BTreeMap<String, String>> {
        Mutex::new(
            entries
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        )
    }

    fn run_merge(
        store: &Mutex<BTreeMap<String, String>>,
        accounts: &[&str],
        base: &BTreeMap<String, BaseEntry>,
        remote: Option<&BTreeMap<String, RemoteSecret>>,
        mode: Mode,
        now: u64,
    ) -> MergeOutput {
        let accounts: Vec<String> = accounts.iter().map(|a| a.to_string()).collect();
        merge(
            &accounts,
            base,
            remote,
            mode,
            now,
            &BTreeMap::new(),
            |account| Ok(store.lock().unwrap().get(account).cloned()),
            digest(),
        )
        .unwrap()
    }

    fn apply(store: &Mutex<BTreeMap<String, String>>, output: &MergeOutput) {
        let mut map = store.lock().unwrap();
        for (account, value) in &output.writes {
            match value {
                Some(value) => map.insert(account.clone(), value.clone()),
                None => map.remove(account),
            };
        }
    }

    #[test]
    fn accounts_are_restricted_to_connection_secrets() {
        assert!(valid_secret_account("3f1c-uuid"));
        assert!(valid_secret_account("3f1c-uuid:ssh-jumps"));
        assert!(!valid_secret_account("l8db-sync:passphrase"));
        assert!(!valid_secret_account("automation:smtp:x"));
        assert!(!valid_secret_account(":ssh"));
        assert!(checked_accounts(vec!["a:params".into(), "l8db-sync:github".into()]).is_err());
    }

    #[test]
    fn newer_local_password_is_never_overwritten_by_stale_remote() {
        let a = keychain(&[("c1", "alt")]);
        let first = run_merge(&a, &["c1"], &BTreeMap::new(), None, Mode::Sync, 100);
        let base = first.base.clone();
        let remote = first.merged.clone();
        a.lock().unwrap().insert("c1".into(), "neu".into());
        let second = run_merge(&a, &["c1"], &base, Some(&remote), Mode::Sync, 200);
        assert!(second.writes.is_empty());
        assert_eq!(
            second.merged["c1"],
            RemoteSecret {
                v: Some("neu".into()),
                t: 200
            }
        );
        assert_eq!(a.lock().unwrap()["c1"], "neu");
    }

    #[test]
    fn remote_change_applies_when_local_is_unchanged() {
        let b = keychain(&[("c1", "alt")]);
        let synced = run_merge(&b, &["c1"], &BTreeMap::new(), None, Mode::Sync, 100);
        let mut remote = synced.merged.clone();
        remote.insert(
            "c1".into(),
            RemoteSecret {
                v: Some("neu".into()),
                t: 150,
            },
        );
        let pulled = run_merge(&b, &["c1"], &synced.base, Some(&remote), Mode::Sync, 200);
        assert_eq!(
            pulled.writes,
            vec![("c1".to_string(), Some("neu".to_string()))]
        );
        apply(&b, &pulled);
        let again = run_merge(
            &b,
            &["c1"],
            &pulled.base,
            Some(&pulled.merged),
            Mode::Sync,
            300,
        );
        assert!(again.writes.is_empty());
        assert_eq!(again.merged, pulled.merged);
        assert_eq!(again.base, pulled.base);
    }

    #[test]
    fn cleared_password_becomes_tombstone_and_propagates() {
        let a = keychain(&[("c1", "pw")]);
        let b = keychain(&[("c1", "pw")]);
        let first = run_merge(&a, &["c1"], &BTreeMap::new(), None, Mode::Sync, 100);
        let b_first = run_merge(
            &b,
            &["c1"],
            &BTreeMap::new(),
            Some(&first.merged),
            Mode::Sync,
            110,
        );
        a.lock().unwrap().remove("c1");
        let cleared = run_merge(
            &a,
            &["c1"],
            &first.base,
            Some(&first.merged),
            Mode::Sync,
            200,
        );
        assert_eq!(cleared.merged["c1"], RemoteSecret { v: None, t: 200 });
        let pulled = run_merge(
            &b,
            &["c1"],
            &b_first.base,
            Some(&cleared.merged),
            Mode::Sync,
            300,
        );
        assert_eq!(pulled.writes, vec![("c1".to_string(), None)]);
        let expired = run_merge(
            &a,
            &["c1"],
            &cleared.base,
            Some(&cleared.merged),
            Mode::Sync,
            200 + TOMBSTONE_TTL_MS + 1,
        );
        assert!(expired.merged.is_empty());
    }

    #[test]
    fn concurrent_edits_pick_newest_and_reads_happen_before_writes() {
        let b = keychain(&[("c1", "basis")]);
        let synced = run_merge(&b, &["c1"], &BTreeMap::new(), None, Mode::Sync, 100);
        b.lock().unwrap().insert("c1".into(), "lokal".into());
        let mut remote = synced.merged.clone();
        remote.insert(
            "c1".into(),
            RemoteSecret {
                v: Some("remote".into()),
                t: 900,
            },
        );
        let reads = Mutex::new(0);
        let output = merge(
            &["c1".to_string(), "c2".to_string()],
            &synced.base,
            Some(&remote),
            Mode::Sync,
            500,
            &BTreeMap::new(),
            |account| {
                *reads.lock().unwrap() += 1;
                Ok(b.lock().unwrap().get(account).cloned())
            },
            digest(),
        )
        .unwrap();
        assert_eq!(*reads.lock().unwrap(), 2);
        assert_eq!(
            output.writes,
            vec![("c1".to_string(), Some("remote".to_string()))]
        );
        let older = run_merge(&b, &["c1"], &synced.base, Some(&remote), Mode::Sync, 1000);
        assert!(older.writes.is_empty());
    }

    #[test]
    fn removed_connections_and_foreign_accounts_are_ignored() {
        let store = keychain(&[("c1", "pw")]);
        let mut remote = BTreeMap::new();
        remote.insert(
            "gone".to_string(),
            RemoteSecret {
                v: Some("x".into()),
                t: 1,
            },
        );
        remote.insert(
            "l8db-sync:github".to_string(),
            RemoteSecret {
                v: Some("x".into()),
                t: 1,
            },
        );
        let output = run_merge(
            &store,
            &["c1"],
            &BTreeMap::new(),
            Some(&remote),
            Mode::Download,
            5,
        );
        assert_eq!(output.merged.keys().collect::<Vec<_>>(), vec!["c1"]);
        assert!(output.writes.is_empty());
    }

    #[test]
    fn first_contact_differences_become_conflicts_until_resolved() {
        let joining = keychain(&[("c1", "lokal"), ("c2", "gleich")]);
        let mut remote = BTreeMap::new();
        remote.insert(
            "c1".to_string(),
            RemoteSecret {
                v: Some("server".into()),
                t: 10,
            },
        );
        remote.insert(
            "c2".to_string(),
            RemoteSecret {
                v: Some("gleich".into()),
                t: 10,
            },
        );
        let accounts = vec!["c1".to_string(), "c2".to_string()];
        let read = |account: &str| Ok(joining.lock().unwrap().get(account).cloned());
        let open = merge(
            &accounts,
            &BTreeMap::new(),
            Some(&remote),
            Mode::Sync,
            500,
            &BTreeMap::new(),
            read,
            digest(),
        )
        .unwrap();
        assert_eq!(open.conflicts, vec!["c1".to_string()]);
        assert!(open.writes.is_empty());
        assert_eq!(open.merged["c1"], remote["c1"]);
        assert!(!open.base.contains_key("c1"));
        assert!(open.base.contains_key("c2"));
        let keep_local = BTreeMap::from([("c1".to_string(), Resolution::Local)]);
        let local = merge(
            &accounts,
            &BTreeMap::new(),
            Some(&remote),
            Mode::Sync,
            500,
            &keep_local,
            read,
            digest(),
        )
        .unwrap();
        assert!(local.writes.is_empty());
        assert_eq!(local.merged["c1"].v.as_deref(), Some("lokal"));
        let take_remote = BTreeMap::from([("c1".to_string(), Resolution::Remote)]);
        let pulled = merge(
            &accounts,
            &BTreeMap::new(),
            Some(&remote),
            Mode::Sync,
            500,
            &take_remote,
            read,
            digest(),
        )
        .unwrap();
        assert_eq!(
            pulled.writes,
            vec![("c1".to_string(), Some("server".to_string()))]
        );
        assert_eq!(
            pulled.previous,
            vec![("c1".to_string(), Some("lokal".to_string()))]
        );
    }

    #[test]
    fn password_backups_are_encrypted_on_disk_and_restorable() {
        let dir = tempfile::tempdir().unwrap();
        let previous = vec![
            ("c1".to_string(), Some("geheim-alt".to_string())),
            ("c2".to_string(), None),
        ];
        let kdf_salt = crypto::fresh_kdf().salt;
        write_backup("pass", dir.path(), "123-sync", &previous, Some(&kdf_salt)).unwrap();
        let raw = std::fs::read_to_string(dir.path().join("123-sync.secrets")).unwrap();
        assert!(!raw.contains("geheim-alt"));
        let restored = read_backup("pass", dir.path(), "123-sync").unwrap();
        assert_eq!(restored["c1"].as_deref(), Some("geheim-alt"));
        assert_eq!(restored["c2"], None);
        assert!(read_backup("falsch", dir.path(), "123-sync").is_err());
        let later = vec![
            ("c1".to_string(), Some("zwischenstand".to_string())),
            ("c3".to_string(), Some("drei".to_string())),
        ];
        write_backup("pass", dir.path(), "123-sync", &later, Some(&kdf_salt)).unwrap();
        let merged = read_backup("pass", dir.path(), "123-sync").unwrap();
        assert_eq!(merged["c1"].as_deref(), Some("geheim-alt"));
        assert_eq!(merged["c3"].as_deref(), Some("drei"));
        assert!(read_backup("pass", dir.path(), "../x").is_err());
        assert!(restore_backup("pass", dir.path(), "../x", 1).is_err());
    }

    #[test]
    fn agreed_base_only_covers_states_shared_with_the_server() {
        let store = keychain(&[("c1", "alt"), ("c2", "x")]);
        let first = run_merge(
            &store,
            &["c1", "c2"],
            &BTreeMap::new(),
            None,
            Mode::Sync,
            100,
        );
        store.lock().unwrap().insert("c1".into(), "neu".into());
        let mut remote = first.merged.clone();
        remote.insert(
            "c2".to_string(),
            RemoteSecret {
                v: Some("y".into()),
                t: 150,
            },
        );
        let output = run_merge(
            &store,
            &["c1", "c2"],
            &first.base,
            Some(&remote),
            Mode::Sync,
            200,
        );
        assert_eq!(output.agreed["c1"], first.base["c1"]);
        assert_eq!(output.agreed["c2"].1, 150);
        assert_ne!(output.base["c1"], first.base["c1"]);
    }

    #[test]
    fn legacy_plain_maps_still_parse() {
        let parsed = parse_remote("{\"c1\":\"pw\"}").unwrap();
        assert_eq!(
            parsed["c1"],
            RemoteSecret {
                v: Some("pw".into()),
                t: 0
            }
        );
    }
}
