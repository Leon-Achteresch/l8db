use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::crypto::{self, Secret};
use super::mask::MaskRule;

pub static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

const FORMAT: u32 = 1;
const RECOVERY_PREFIX: &str = "l8dbvk1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub format: u32,
    pub id: String,
    pub created_at: String,
    pub key_id: String,
}

pub struct Keys {
    pub key_id: [u8; 16],
    pub file: Secret,
    pub mac: Secret,
    pub mask: Secret,
    pub audit: Secret,
    master: Secret,
}

impl Keys {
    pub fn from_master(master: &[u8; 32]) -> Result<Self, String> {
        let mac = crypto::derive(master, b"l8db-vault", "mac")?;
        let mut key_id = [0u8; 16];
        key_id.copy_from_slice(&crypto::mac(mac.as_ref(), b"key-id")[..16]);
        Ok(Self {
            key_id,
            file: crypto::derive(master, b"l8db-vault", "file")?,
            mask: crypto::derive(master, b"l8db-vault", "mask")?,
            audit: crypto::derive(master, b"l8db-vault", "audit")?,
            mac,
            master: Zeroizing::new(*master),
        })
    }

    pub fn fingerprint(&self) -> String {
        let hex = crypto::hex(&self.key_id[..8]);
        hex.as_bytes()
            .chunks(4)
            .map(|part| String::from_utf8_lossy(part).to_uppercase())
            .collect::<Vec<_>>()
            .join("-")
    }
}

pub struct Vault {
    pub root: PathBuf,
    pub info: VaultInfo,
    pub keys: Keys,
    pub anchor: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub path: String,
    pub id: Option<String>,
    pub fingerprint: Option<String>,
    pub ready: bool,
    pub problem: Option<String>,
    pub snapshots: usize,
    pub bytes: u64,
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn default_root(app: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("L8DB_VAULT_DIR").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(path);
        return if path.is_absolute() {
            Ok(path)
        } else {
            Err("L8DB_VAULT_DIR muss ein absoluter Pfad sein.".into())
        };
    }
    use tauri::Manager;
    let app = app.ok_or("Tresor-Pfad nicht verfügbar")?;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("App-Datenordner nicht verfügbar: {error}"))?
        .join("versioning-vault"))
}

pub fn private_dir(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|error| format!("Tresor-Ordner konnte nicht angelegt werden: {error}"))?;
    let meta = std::fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("Der Tresor-Pfad muss ein echter Ordner sein.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("Ungültiger Tresor-Pfad")?;
    let mut file = tempfile::Builder::new()
        .prefix(".l8db-")
        .tempfile_in(parent)
        .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(file.path(), std::fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    file.write_all(bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    file.persist(path).map_err(|error| {
        format!(
            "Tresor-Datei konnte nicht gespeichert werden: {}",
            error.error
        )
    })?;
    Ok(())
}

pub fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > limit {
        return Err(format!("Ungültige Tresor-Datei: {}", path.display()));
    }
    std::fs::read(path).map_err(|error| error.to_string())
}

fn account(id: &str) -> String {
    format!("versioning-vault:{id}")
}

pub fn valid_id(id: &str) -> Result<&str, String> {
    if id.len() == 32
        && id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(id)
    } else {
        Err("Ungültige Kennung".into())
    }
}

pub fn new_id() -> Result<String, String> {
    Ok(crypto::hex(&crypto::random::<16>()?))
}

impl Vault {
    pub fn with_master(root: &Path, master: &[u8; 32]) -> Result<Self, String> {
        private_dir(root)?;
        private_dir(&root.join("snapshots"))?;
        let keys = Keys::from_master(master)?;
        let info_path = root.join("vault.json");
        let info = if info_path.exists() {
            let info: VaultInfo = serde_json::from_slice(&read_limited(&info_path, 64 * 1024)?)
                .map_err(|error| format!("vault.json ist ungültig: {error}"))?;
            if info.key_id != crypto::hex(&keys.key_id) {
                return Err("Der Schlüssel passt nicht zu diesem Tresor.".into());
            }
            info
        } else {
            let info = VaultInfo {
                format: FORMAT,
                id: new_id()?,
                created_at: now(),
                key_id: crypto::hex(&keys.key_id),
            };
            write_private(
                &info_path,
                &serde_json::to_vec_pretty(&info).map_err(|error| error.to_string())?,
            )?;
            info
        };
        Ok(Self {
            root: root.to_path_buf(),
            info,
            keys,
            anchor: false,
        })
    }

    pub async fn open(root: &Path) -> Result<Self, String> {
        private_dir(root)?;
        let info_path = root.join("vault.json");
        if !info_path.exists() {
            let master: [u8; 32] = crypto::random()?;
            let mut vault = Self::with_master(root, &master)?;
            crate::db::secrets::store_secret(
                account(&vault.info.id),
                base64::engine::general_purpose::STANDARD.encode(master),
            )
            .await
            .inspect_err(|_| {
                let _ = std::fs::remove_file(&info_path);
            })?;
            vault.anchor = true;
            return Ok(vault);
        }
        let info: VaultInfo = serde_json::from_slice(&read_limited(&info_path, 64 * 1024)?)
            .map_err(|error| format!("vault.json ist ungültig: {error}"))?;
        valid_id(&info.id)?;
        let stored = crate::db::secrets::load_secret(account(&info.id))
            .await?
            .map(Zeroizing::new)
            .ok_or("Der Tresor-Schlüssel fehlt im Schlüsselbund. Wiederherstellungsschlüssel importieren.")?;
        let bytes = Zeroizing::new(
            base64::engine::general_purpose::STANDARD
                .decode(stored.as_bytes())
                .map_err(|_| "Tresor-Schlüssel im Schlüsselbund ist beschädigt.")?,
        );
        let master: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| "Tresor-Schlüssel im Schlüsselbund ist beschädigt.")?;
        let mut vault = Self::with_master(root, &master)?;
        vault.anchor = true;
        Ok(vault)
    }

    pub fn recovery_key(&self) -> String {
        let check = crypto::hex(&crypto::sha256(self.keys.master.as_ref())[..4]);
        format!(
            "{RECOVERY_PREFIX}.{}.{}.{check}",
            self.info.id,
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(self.keys.master.as_ref())
        )
    }

    pub fn snapshot_dir(&self, id: &str) -> Result<PathBuf, String> {
        Ok(self.root.join("snapshots").join(valid_id(id)?))
    }

    pub fn status(&self) -> VaultStatus {
        let (snapshots, bytes) = std::fs::read_dir(self.root.join("snapshots"))
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|entry| valid_id(&entry.file_name().to_string_lossy()).is_ok())
                    .fold((0, 0), |(count, bytes), entry| {
                        let size = std::fs::read_dir(entry.path())
                            .map(|files| {
                                files
                                    .filter_map(Result::ok)
                                    .filter_map(|file| file.metadata().ok())
                                    .map(|meta| meta.len())
                                    .sum::<u64>()
                            })
                            .unwrap_or(0);
                        (count + 1, bytes + size)
                    })
            })
            .unwrap_or((0, 0));
        VaultStatus {
            path: self.root.display().to_string(),
            id: Some(self.info.id.clone()),
            fingerprint: Some(self.keys.fingerprint()),
            ready: true,
            problem: None,
            snapshots,
            bytes,
        }
    }

    pub fn sign(&self, kind: &str, bytes: &[u8]) -> String {
        let mut data = format!("{kind}\0{}\0", self.info.id).into_bytes();
        data.extend_from_slice(bytes);
        crypto::hex(&crypto::mac(self.keys.mac.as_ref(), &data))
    }

    pub fn verify(&self, kind: &str, bytes: &[u8], signature: &str) -> bool {
        let Ok(expected) = crypto::unhex(signature.trim()) else {
            return false;
        };
        let mut data = format!("{kind}\0{}\0", self.info.id).into_bytes();
        data.extend_from_slice(bytes);
        crypto::mac_matches(self.keys.mac.as_ref(), &data, &expected)
    }

    pub fn write_signed(&self, path: &Path, kind: &str, bytes: &[u8]) -> Result<(), String> {
        write_private(path, bytes)?;
        write_private(
            &path.with_extension("mac"),
            self.sign(kind, bytes).as_bytes(),
        )
    }

    pub fn read_signed(&self, path: &Path, kind: &str, limit: u64) -> Result<Vec<u8>, String> {
        let bytes = read_limited(path, limit)?;
        let signature = String::from_utf8(read_limited(&path.with_extension("mac"), 1024)?)
            .map_err(|_| "Signatur ist ungültig")?;
        if !self.verify(kind, &bytes, &signature) {
            return Err(format!(
                "Signaturprüfung fehlgeschlagen: {} wurde außerhalb von l8db verändert.",
                path.file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default()
            ));
        }
        Ok(bytes)
    }

    pub fn load_policy(&self) -> Result<Policy, String> {
        let path = self.root.join("policy.json");
        if !path.exists() {
            return Ok(Policy::default());
        }
        serde_json::from_slice(&self.read_signed(&path, "policy", 8 * 1024 * 1024)?)
            .map_err(|error| format!("Richtlinien sind ungültig: {error}"))
    }

    pub fn save_policy(&self, policy: &Policy) -> Result<(), String> {
        self.write_signed(
            &self.root.join("policy.json"),
            "policy",
            &serde_json::to_vec_pretty(policy).map_err(|error| error.to_string())?,
        )
    }
}

pub async fn import_recovery(root: &Path, recovery: &str) -> Result<VaultStatus, String> {
    let parts: Vec<&str> = recovery.trim().split('.').collect();
    let [prefix, id, key, check] = parts.as_slice() else {
        return Err("Ungültiger Wiederherstellungsschlüssel".into());
    };
    if *prefix != RECOVERY_PREFIX {
        return Err("Unbekanntes Format des Wiederherstellungsschlüssels".into());
    }
    valid_id(id)?;
    let bytes = Zeroizing::new(
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(key.as_bytes())
            .map_err(|_| "Ungültiger Wiederherstellungsschlüssel")?,
    );
    let master: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| "Ungültiger Wiederherstellungsschlüssel")?;
    if crypto::hex(&crypto::sha256(&master)[..4]) != *check {
        return Err("Prüfsumme des Wiederherstellungsschlüssels stimmt nicht.".into());
    }
    let info_path = root.join("vault.json");
    if info_path.exists() {
        let info: VaultInfo = serde_json::from_slice(&read_limited(&info_path, 64 * 1024)?)
            .map_err(|error| format!("vault.json ist ungültig: {error}"))?;
        if info.id != *id {
            return Err("Der Schlüssel gehört zu einem anderen Tresor.".into());
        }
    } else {
        private_dir(root)?;
        let keys = Keys::from_master(&master)?;
        write_private(
            &info_path,
            &serde_json::to_vec_pretty(&VaultInfo {
                format: FORMAT,
                id: id.to_string(),
                created_at: now(),
                key_id: crypto::hex(&keys.key_id),
            })
            .map_err(|error| error.to_string())?,
        )?;
    }
    let vault = Vault::with_master(root, &master)?;
    crate::db::secrets::store_secret(
        account(id),
        base64::engine::general_purpose::STANDARD.encode(master),
    )
    .await?;
    Ok(vault.status())
}

pub fn unavailable(root: &Path, problem: String) -> VaultStatus {
    VaultStatus {
        path: root.display().to_string(),
        id: None,
        fingerprint: None,
        ready: false,
        problem: Some(problem),
        snapshots: 0,
        bytes: 0,
    }
}

pub async fn status(root: &Path) -> VaultStatus {
    match Vault::open(root).await {
        Ok(vault) => vault.status(),
        Err(problem) => unavailable(root, problem),
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Schedule {
    pub every_hours: u32,
    pub keep: u32,
    pub connection_id: String,
    pub last_run_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DatabasePolicy {
    pub label: String,
    pub masking: Vec<MaskRule>,
    pub schedule: Option<Schedule>,
    pub branch_ttl_hours: Option<u32>,
    pub snapshot_ttl_days: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Policy {
    pub databases: BTreeMap<String, DatabasePolicy>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_files_reject_external_changes() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::with_master(dir.path(), &[3u8; 32]).unwrap();
        let mut policy = Policy::default();
        policy.databases.insert(
            "pg:1/app".into(),
            DatabasePolicy {
                branch_ttl_hours: Some(24),
                ..Default::default()
            },
        );
        vault.save_policy(&policy).unwrap();
        assert_eq!(
            vault.load_policy().unwrap().databases["pg:1/app"].branch_ttl_hours,
            Some(24)
        );
        let path = dir.path().join("policy.json");
        let text = std::fs::read_to_string(&path).unwrap().replace("24", "99");
        std::fs::write(&path, text).unwrap();
        assert!(vault.load_policy().unwrap_err().contains("verändert"));
    }

    #[test]
    fn reopening_requires_the_same_key() {
        let dir = tempfile::tempdir().unwrap();
        let first = Vault::with_master(dir.path(), &[1u8; 32]).unwrap();
        let again = Vault::with_master(dir.path(), &[1u8; 32]).unwrap();
        assert_eq!(first.info.id, again.info.id);
        assert!(Vault::with_master(dir.path(), &[2u8; 32]).is_err());
        let recovery = first.recovery_key();
        assert!(recovery.starts_with("l8dbvk1."));
        assert!(recovery.contains(&first.info.id));
        assert_eq!(first.keys.fingerprint().len(), 19);
    }

    #[test]
    fn ids_are_strict() {
        assert!(valid_id(&"a".repeat(32)).is_ok());
        assert!(valid_id("../../etc/passwd").is_err());
        assert!(valid_id(&"A".repeat(32)).is_err());
        assert!(valid_id(&"a".repeat(31)).is_err());
    }
}
