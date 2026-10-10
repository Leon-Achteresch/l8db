use super::crypto;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ring::hmac;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
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

#[derive(Debug, Default)]
pub struct MergeOutput {
    pub merged: BTreeMap<String, RemoteSecret>,
    pub base: BTreeMap<String, BaseEntry>,
    pub agreed: BTreeMap<String, BaseEntry>,
    pub writes: Vec<(String, Option<String>)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretMerge {
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
        let take_remote = match mode {
            Mode::Upload => false,
            Mode::Download => theirs.is_some(),
            Mode::Sync => {
                if ours == theirs || theirs.is_none() || theirs == known_hash {
                    false
                } else if ours.is_none() || ours == known_hash || known.is_none() {
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
            }
            (entry, theirs.clone())
        } else {
            let at = if ours == theirs {
                remote_entry.map(|entry| entry.t).unwrap_or(ours_at)
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

pub fn run(
    passphrase: &str,
    envelope: Option<&str>,
    accounts: Vec<String>,
    base: BTreeMap<String, BaseEntry>,
    mode: Mode,
    now: u64,
    salt: Option<&str>,
) -> Result<SecretMerge, String> {
    let accounts = checked_accounts(accounts)?;
    let remote = match envelope.filter(|_| mode != Mode::Upload) {
        Some(envelope) => Some(parse_remote(&Zeroizing::new(crypto::open(
            passphrase, envelope,
        )?))?),
        None => None,
    };
    let key = device_key()?;
    let output = merge(
        &accounts,
        &base,
        remote.as_ref(),
        mode,
        now,
        crate::db::secrets::read_secret,
        digester(&key),
    )?;
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
            crypto::kdf_for_salt(salt),
        )?)
    };
    Ok(SecretMerge {
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
    fn a_device_without_base_adopts_the_server_password() {
        let joining = keychain(&[("c1", "veraltet")]);
        let mut remote = BTreeMap::new();
        remote.insert(
            "c1".to_string(),
            RemoteSecret {
                v: Some("aktuell".into()),
                t: 10,
            },
        );
        let output = run_merge(
            &joining,
            &["c1"],
            &BTreeMap::new(),
            Some(&remote),
            Mode::Sync,
            500,
        );
        assert_eq!(
            output.writes,
            vec![("c1".to_string(), Some("aktuell".to_string()))]
        );
        assert_eq!(output.merged["c1"].t, 10);
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
