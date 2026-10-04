use std::io::Write;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::crypto;
use super::vault::{self, Vault};

const GENESIS: [u8; 32] = [0u8; 32];
const LIMIT: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    pub os_user: String,
    pub host: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db_user: Option<String>,
}

impl Actor {
    pub fn local(db_user: Option<String>) -> Self {
        Self {
            os_user: std::env::var("USER")
                .or_else(|_| std::env::var("USERNAME"))
                .unwrap_or_else(|_| "unbekannt".into()),
            host: hostname(),
            db_user,
        }
    }
}

#[cfg(unix)]
fn hostname() -> String {
    let mut buffer = [0u8; 256];
    let result = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) };
    if result != 0 {
        return "unbekannt".into();
    }
    let end = buffer
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(buffer.len());
    String::from_utf8_lossy(&buffer[..end]).to_string()
}

#[cfg(not(unix))]
fn hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unbekannt".into())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub seq: u64,
    pub at: String,
    pub actor: Actor,
    pub action: String,
    pub outcome: String,
    pub database: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub detail: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    pub valid: bool,
    pub entries: u64,
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub entries: Vec<Entry>,
    pub verification: Verification,
}

struct Parsed {
    entries: Vec<Entry>,
    last: [u8; 32],
    previous: [u8; 32],
    problem: Option<String>,
}

fn path(vault: &Vault) -> std::path::PathBuf {
    vault.root.join("audit.log")
}

fn link(vault: &Vault, previous: &[u8; 32], json: &[u8]) -> [u8; 32] {
    let mut data = Vec::with_capacity(32 + json.len());
    data.extend_from_slice(previous);
    data.extend_from_slice(json);
    crypto::mac(vault.keys.audit.as_ref(), &data)
}

fn parse(vault: &Vault) -> Result<Parsed, String> {
    let path = path(vault);
    let text = if path.exists() {
        String::from_utf8(vault::read_limited(&path, LIMIT)?)
            .map_err(|_| "Protokoll ist kein UTF-8")?
    } else {
        String::new()
    };
    let mut parsed = Parsed {
        entries: Vec::new(),
        last: GENESIS,
        previous: GENESIS,
        problem: None,
    };
    for (index, line) in text.lines().enumerate() {
        match next(vault, &parsed, line) {
            Ok((entry, mac)) => {
                parsed.previous = parsed.last;
                parsed.last = mac;
                parsed.entries.push(entry);
            }
            Err(reason) => {
                parsed.problem = Some(format!("Zeile {}: {reason}", index + 1));
                break;
            }
        }
    }
    Ok(parsed)
}

fn next(vault: &Vault, parsed: &Parsed, line: &str) -> Result<(Entry, [u8; 32]), &'static str> {
    let (mac, json) = line.split_once(' ').ok_or("unvollständig")?;
    let expected = link(vault, &parsed.last, json.as_bytes());
    if crypto::unhex(mac).ok().as_deref() != Some(expected.as_slice()) {
        return Err("Kette unterbrochen oder verändert");
    }
    let entry = serde_json::from_str::<Entry>(json).map_err(|_| "unlesbar")?;
    if entry.seq != parsed.entries.len() as u64 + 1 {
        return Err("Reihenfolge verändert");
    }
    Ok((entry, expected))
}

fn anchor_account(vault: &Vault) -> String {
    format!("versioning-vault:{}:audit", vault.info.id)
}

fn anchor_value(count: usize, mac: &[u8; 32]) -> String {
    format!("{count}:{}", crypto::hex(mac))
}

fn anchor_mismatch(parsed: &Parsed, stored: Option<&str>) -> Option<String> {
    let count = parsed.entries.len();
    let stored = stored.map_or_else(|| anchor_value(0, &GENESIS), str::to_string);
    if stored == anchor_value(count, &parsed.last)
        || (count > 0 && stored == anchor_value(count - 1, &parsed.previous))
    {
        None
    } else if stored == anchor_value(0, &GENESIS) {
        Some("Prüfanker im Schlüsselbund fehlt".into())
    } else {
        Some("Protokoll wurde gekürzt oder ersetzt (Prüfanker weicht ab)".into())
    }
}

async fn anchor_problem(vault: &Vault, parsed: &Parsed) -> Option<String> {
    if !vault.anchor {
        return None;
    }
    let stored = crate::db::secrets::load_secret(anchor_account(vault))
        .await
        .ok()
        .flatten();
    anchor_mismatch(parsed, stored.as_deref())
}

async fn checked(vault: &Vault) -> Result<Parsed, String> {
    let parsed = parse(vault)?;
    match parsed
        .problem
        .clone()
        .or(anchor_problem(vault, &parsed).await)
    {
        Some(problem) => Err(format!(
            "Das Protokoll ist nicht intakt ({problem}). Vorgang aus Sicherheitsgründen gesperrt."
        )),
        None => Ok(parsed),
    }
}

pub async fn ensure_intact(vault: &Vault) -> Result<(), String> {
    checked(vault).await.map(|_| ())
}

pub async fn append(
    vault: &Vault,
    actor: Actor,
    action: &str,
    outcome: &str,
    database: &str,
    target: Option<String>,
    detail: Value,
) -> Result<Entry, String> {
    let _guard = vault::LOCK.lock().await;
    let parsed = checked(vault).await?;
    let entry = Entry {
        seq: parsed.entries.len() as u64 + 1,
        at: vault::now(),
        actor,
        action: action.into(),
        outcome: outcome.into(),
        database: database.into(),
        target,
        detail,
    };
    record(vault, &parsed, entry).await
}

pub async fn recovered(vault: &Vault, actor: Actor) -> Result<Entry, String> {
    let _guard = vault::LOCK.lock().await;
    let parsed = parse(vault)?;
    if let Some(problem) = parsed.problem.clone() {
        return Err(format!(
            "Das Protokoll ist nicht intakt ({problem}); der Prüfanker wird nicht erneuert."
        ));
    }
    let detail = match anchor_problem(vault, &parsed).await {
        Some(problem) => json!({ "reanchored": problem, "entries": parsed.entries.len() }),
        None => Value::Null,
    };
    let entry = Entry {
        seq: parsed.entries.len() as u64 + 1,
        at: vault::now(),
        actor,
        action: "vault.recovery_import".into(),
        outcome: "ok".into(),
        database: format!("vault/{}", vault.info.id),
        target: None,
        detail,
    };
    record(vault, &parsed, entry).await
}

async fn record(vault: &Vault, parsed: &Parsed, entry: Entry) -> Result<Entry, String> {
    let json = serde_json::to_string(&entry).map_err(|error| error.to_string())?;
    let mac = link(vault, &parsed.last, json.as_bytes());
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options
        .open(path(vault))
        .map_err(|error| format!("Protokoll nicht beschreibbar: {error}"))?;
    file.write_all(format!("{} {json}\n", crypto::hex(&mac)).as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Protokoll nicht beschreibbar: {error}"))?;
    if vault.anchor {
        crate::db::secrets::store_secret(
            anchor_account(vault),
            anchor_value(entry.seq as usize, &mac),
        )
        .await?;
    }
    Ok(entry)
}

pub async fn journal(vault: &Vault, limit: usize) -> Result<Journal, String> {
    let parsed = parse(vault)?;
    let problem = match parsed.problem.clone() {
        Some(problem) => Some(problem),
        None => anchor_problem(vault, &parsed).await,
    };
    let total = parsed.entries.len() as u64;
    let skip = parsed.entries.len().saturating_sub(limit);
    Ok(Journal {
        entries: parsed.entries.into_iter().skip(skip).rev().collect(),
        verification: Verification {
            valid: problem.is_none(),
            entries: total,
            problem,
        },
    })
}

pub fn export(vault: &Vault) -> Result<String, String> {
    let parsed = parse(vault)?;
    if let Some(problem) = parsed.problem {
        return Err(format!("Protokoll ist nicht intakt: {problem}"));
    }
    String::from_utf8(vault::read_limited(&path(vault), LIMIT).unwrap_or_default())
        .map_err(|_| "Protokoll ist kein UTF-8".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn sample(vault: &Vault, n: usize) {
        for index in 0..n {
            append(
                vault,
                Actor::local(Some("dev".into())),
                "snapshot.create",
                "ok",
                "pg:1/app",
                Some(format!("s{index}")),
                json!({ "bytes": index }),
            )
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn chain_verifies_and_detects_edits() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::with_master(dir.path(), &[5u8; 32]).unwrap();
        sample(&vault, 3).await;
        let journal = journal(&vault, 10).await.unwrap();
        assert!(journal.verification.valid);
        assert_eq!(journal.entries.len(), 3);
        assert_eq!(journal.entries[0].seq, 3);
        let path = dir.path().join("audit.log");
        let text = std::fs::read_to_string(&path).unwrap();
        std::fs::write(&path, text.replace("\"s1\"", "\"sX\"")).unwrap();
        let broken = super::journal(&vault, 10).await.unwrap();
        assert!(!broken.verification.valid);
        assert!(broken.verification.problem.unwrap().contains("Zeile 2"));
        let error = append(
            &vault,
            Actor::local(None),
            "branch.delete",
            "ok",
            "pg:1/app",
            None,
            Value::Null,
        )
        .await
        .unwrap_err();
        assert!(error.contains("gesperrt"));
    }

    #[tokio::test]
    async fn deleting_or_reordering_lines_is_detected() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::with_master(dir.path(), &[6u8; 32]).unwrap();
        sample(&vault, 3).await;
        let path = dir.path().join("audit.log");
        let lines: Vec<String> = std::fs::read_to_string(&path)
            .unwrap()
            .lines()
            .map(str::to_string)
            .collect();
        std::fs::write(&path, format!("{}\n{}\n", lines[0], lines[2])).unwrap();
        assert!(!journal(&vault, 10).await.unwrap().verification.valid);
        std::fs::write(&path, format!("{}\n{}\n{}\n", lines[1], lines[0], lines[2])).unwrap();
        assert!(!journal(&vault, 10).await.unwrap().verification.valid);
        let other_dir = tempfile::tempdir().unwrap();
        let other = Vault::with_master(other_dir.path(), &[7u8; 32]).unwrap();
        std::fs::copy(&path, other.root.join("audit.log")).unwrap();
        assert!(!journal(&other, 10).await.unwrap().verification.valid);
    }

    #[tokio::test]
    async fn anchor_tolerates_only_a_verified_lag_of_one() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::with_master(dir.path(), &[8u8; 32]).unwrap();
        assert!(anchor_mismatch(&parse(&vault).unwrap(), None).is_none());
        sample(&vault, 1).await;
        assert!(anchor_mismatch(&parse(&vault).unwrap(), None).is_none());
        sample(&vault, 2).await;
        let parsed = parse(&vault).unwrap();
        let exact = anchor_value(3, &parsed.last);
        let lagging = anchor_value(2, &parsed.previous);
        assert!(anchor_mismatch(&parsed, Some(&exact)).is_none());
        assert!(anchor_mismatch(&parsed, Some(&lagging)).is_none());
        assert!(anchor_mismatch(&parsed, Some(&anchor_value(2, &parsed.last))).is_some());
        assert!(anchor_mismatch(&parsed, Some(&anchor_value(1, &parsed.previous))).is_some());
        assert!(anchor_mismatch(&parsed, Some(&anchor_value(4, &parsed.last))).is_some());
        assert!(anchor_mismatch(&parsed, None).unwrap().contains("fehlt"));
    }

    #[tokio::test]
    async fn recovery_records_and_refuses_broken_chains() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::with_master(dir.path(), &[4u8; 32]).unwrap();
        sample(&vault, 2).await;
        let entry = recovered(&vault, Actor::local(None)).await.unwrap();
        assert_eq!(entry.seq, 3);
        assert_eq!(entry.action, "vault.recovery_import");
        assert!(journal(&vault, 10).await.unwrap().verification.valid);
        let path = dir.path().join("audit.log");
        let text = std::fs::read_to_string(&path).unwrap();
        std::fs::write(&path, text.replace("\"s0\"", "\"sX\"")).unwrap();
        let error = recovered(&vault, Actor::local(None)).await.unwrap_err();
        assert!(error.contains("nicht erneuert"));
        assert!(ensure_intact(&vault).await.is_err());
    }
}
