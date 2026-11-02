use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedSettings {
    pub production_read_only: Option<bool>,
    pub production_confirm_commit: Option<bool>,
    pub production_auto_rollback: Option<bool>,
    pub confirm_destructive_queries: Option<bool>,
    pub ssh_trust_new_hosts: Option<bool>,
    pub ssl_default_mode: Option<String>,
    pub crash_reports: Option<bool>,
    pub usage_metrics: Option<bool>,
    pub auto_update_check: Option<bool>,
    pub auto_update_install: Option<bool>,
    pub update_channel: Option<String>,
}

fn yes() -> bool {
    true
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    pub format: u8,
    #[serde(default)]
    pub organization: String,
    #[serde(default)]
    pub support: String,
    #[serde(default)]
    pub settings: ManagedSettings,
    #[serde(default = "yes")]
    pub allow_ai: bool,
    #[serde(default = "yes")]
    pub allow_extensions: bool,
    #[serde(default = "yes")]
    pub allow_personal_sync: bool,
    #[serde(default = "yes")]
    pub allow_mcp: bool,
    #[serde(default, skip_serializing)]
    pub connections: Vec<Value>,
    #[serde(default)]
    pub trusted_release_signers: Vec<String>,
    #[serde(default)]
    pub require_signed_releases: bool,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            format: 1,
            organization: String::new(),
            support: String::new(),
            settings: ManagedSettings::default(),
            allow_ai: true,
            allow_extensions: true,
            allow_personal_sync: true,
            allow_mcp: true,
            connections: Vec::new(),
            trusted_release_signers: Vec::new(),
            require_signed_releases: false,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub path: PathBuf,
    pub managed: bool,
    #[serde(flatten)]
    pub policy: Policy,
}

#[cfg(windows)]
fn known_folder(id: &windows_core::GUID) -> Result<PathBuf, String> {
    use ::windows::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    let folder = unsafe { SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None) }
        .map_err(|_| "Der geschützte Windows-Programmordner konnte nicht ermittelt werden")?;
    let decoded = unsafe { folder.to_string() };
    unsafe {
        ::windows::Win32::System::Com::CoTaskMemFree(Some(folder.0.cast()));
    }
    decoded
        .map(PathBuf::from)
        .map_err(|_| "Windows-Programmordner enthält ungültiges UTF-16".into())
}

pub fn policy_path() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        known_folder(&::windows::Win32::UI::Shell::FOLDERID_ProgramData)
            .map(|base| base.join("l8db/policy.json"))
    }
    #[cfg(target_os = "macos")]
    {
        Ok(PathBuf::from(
            "/Library/Application Support/com.leon.l8db/policy.json",
        ))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Ok(PathBuf::from("/etc/l8db/policy.json"))
    }
}

fn trusted(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        for entry in path.ancestors() {
            let metadata =
                std::fs::symlink_metadata(entry).map_err(|_| "IT-Richtlinie nicht lesbar")?;
            if metadata.file_type().is_symlink()
                || metadata.uid() != 0
                || metadata.mode() & 0o022 != 0
            {
                return Err("IT-Richtlinie und übergeordnete Ordner müssen root gehören und dürfen nicht durch andere Benutzer beschreibbar sein.".into());
            }
        }
    }
    #[cfg(windows)]
    {
        let script = "$ErrorActionPreference='Stop'; $p=$env:L8DB_POLICY_ACL; foreach($f in @($p,(Split-Path -Parent $p))) { $a=Get-Acl -LiteralPath $f; $o=([System.Security.Principal.NTAccount]$a.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value; if($o -notin @('S-1-5-18','S-1-5-32-544')) { exit 1 }; foreach($r in $a.Access) { if($r.AccessControlType -eq 'Allow' -and (($r.FileSystemRights.value__ -band 852310) -ne 0)) { $s=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($s -notin @('S-1-5-18','S-1-5-32-544')) { exit 1 } } } }; exit 0";
        let powershell = known_folder(&::windows::Win32::UI::Shell::FOLDERID_System)?
            .join("WindowsPowerShell/v1.0/powershell.exe");
        let status = crate::process::std_command(powershell)
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("L8DB_POLICY_ACL", path)
            .output()
            .map_err(|_| "Windows-Zugriffsrechte der IT-Richtlinie konnten nicht geprüft werden")?;
        if !status.status.success() {
            return Err("IT-Richtlinie und Ordner dürfen nur durch SYSTEM und Administratoren beschreibbar sein.".into());
        }
    }
    Ok(())
}

fn read(path: &Path, check_permissions: bool) -> Result<Status, String> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Status {
                path: path.into(),
                managed: false,
                policy: Policy::default(),
            })
        }
        Err(_) => return Err("IT-Richtlinie nicht lesbar. Bitte die IT kontaktieren.".into()),
    };
    if !metadata.is_file() || metadata.len() > 4 * 1024 * 1024 {
        return Err("IT-Richtlinie muss eine Datei mit höchstens 4 MB sein.".into());
    }
    if check_permissions {
        trusted(path)?;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|file| file.take(4 * 1024 * 1024 + 1).read_to_end(&mut bytes))
        .map_err(|_| "IT-Richtlinie nicht lesbar")?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("IT-Richtlinie ist zu groß.".into());
    }
    let policy: Policy = serde_json::from_slice(&bytes).map_err(|_| {
        "IT-Richtlinie enthält ungültige oder unbekannte Felder. Bitte die IT kontaktieren."
    })?;
    if policy.format != 1
        || policy.connections.len() > 2000
        || policy.organization.len() > 200
        || policy.support.len() > 1000
        || policy.trusted_release_signers.len() > 32
        || (policy.require_signed_releases && policy.trusted_release_signers.is_empty())
        || policy.trusted_release_signers.iter().any(|signer| {
            signer.is_empty() || signer.len() > 200 || signer.contains(['\0', '\n', '\r'])
        })
        || policy
            .settings
            .ssl_default_mode
            .as_deref()
            .is_some_and(|mode| {
                !["disable", "prefer", "require", "verify-ca", "verify-full"].contains(&mode)
            })
        || policy
            .settings
            .update_channel
            .as_deref()
            .is_some_and(|channel| !["stable", "canary"].contains(&channel))
    {
        return Err("IT-Richtlinie enthält ungültige Werte.".into());
    }
    Ok(Status {
        path: path.into(),
        managed: true,
        policy,
    })
}

type Cached = Option<(Instant, Result<Arc<Status>, String>)>;

fn cached_status(
    cache: &mut Cached,
    refresh: bool,
    read: impl FnOnce() -> Result<Arc<Status>, String>,
) -> Result<Arc<Status>, String> {
    if !refresh {
        if let Some((at, status)) = cache.as_ref() {
            if at.elapsed() < Duration::from_secs(60) {
                return status.clone();
            }
        }
    }
    let result = read();
    *cache = Some((Instant::now(), result.clone()));
    result
}

pub fn current(refresh: bool) -> Result<Arc<Status>, String> {
    static CACHE: OnceLock<Mutex<Cached>> = OnceLock::new();
    let mut cache = CACHE
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "IT-Richtlinie nicht verfügbar")?;
    cached_status(&mut cache, refresh, || {
        policy_path()
            .and_then(|path| read(&path, true))
            .map(Arc::new)
    })
}

pub fn authorize(command: &str) -> Result<(), String> {
    if command == "organization_policy" {
        return Ok(());
    }
    let status = current(false)?;
    let policy = &status.policy;
    let denied = (!policy.allow_ai && command.starts_with("ai_") && !command.ends_with("cancel"))
        || (!policy.allow_extensions
            && (command.starts_with("community_extension")
                || command == "read_community_extension"
                || command.starts_with("extension_")
                || command.starts_with("ui_plugin")))
        || (!policy.allow_personal_sync && command.starts_with("sync_"))
        || (!policy.allow_mcp && command.starts_with("mcp_") && command != "mcp_clear_audit");
    if denied {
        Err(
            "Diese Funktion ist durch die IT-Richtlinie gesperrt. Bitte die IT kontaktieren."
                .into(),
        )
    } else {
        Ok(())
    }
}

pub fn guard<R: tauri::Runtime, F>(
    handler: F,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static
where
    F: Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
{
    move |invoke| {
        if let Err(error) = authorize(invoke.message.command()) {
            invoke.resolver.reject(error);
            return true;
        }
        handler(invoke)
    }
}

#[tauri::command]
pub fn organization_policy() -> Result<Status, String> {
    current(true).map(|status| (*status).clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn organization_policy_rejects_unknown_fields_invalid_values_and_oversized_files() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("policy.json");
        assert!(!read(&path, false).unwrap().managed);
        for text in [
            r#"{"format":2}"#,
            r#"{"format":1,"bypass":true}"#,
            r#"{"format":1,"settings":{"updateChannel":"nightly"}}"#,
            r#"{"format":1,"settings":{"sslDefaultMode":"trust-all"}}"#,
        ] {
            std::fs::write(&path, text).unwrap();
            assert!(read(&path, false).is_err());
        }
        std::fs::write(
            &path,
            r#"{"format":1,"allowAi":false,"settings":{"productionReadOnly":true}}"#,
        )
        .unwrap();
        let status = read(&path, false).unwrap();
        assert!(status.managed && !status.policy.allow_ai);
        assert_eq!(status.policy.settings.production_read_only, Some(true));
        std::fs::write(&path, vec![b' '; 4 * 1024 * 1024 + 1]).unwrap();
        assert!(read(&path, false).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn organization_policy_rejects_a_user_writable_policy() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("policy.json");
        std::fs::write(&path, r#"{"format":1}"#).unwrap();
        assert!(read(&path, true).is_err());
    }

    #[test]
    fn organization_policy_large_profile_and_cached_access_are_bounded() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("policy.json");
        let profiles: Vec<_> = (0..2000).map(|index| serde_json::json!({"id":format!("connection-{index}"),"name":format!("Database {index}"),"kind":"postgres","connectionString":"postgres://database.example.invalid/app","readOnly":true})).collect();
        let source =
            serde_json::to_vec(&serde_json::json!({"format":1,"connections":profiles})).unwrap();
        std::fs::write(&path, &source).unwrap();
        let mut samples = Vec::new();
        for _ in 0..15 {
            let start = Instant::now();
            let status = read(&path, false).unwrap();
            assert_eq!(status.policy.connections.len(), 2000);
            assert!(serde_json::to_vec(&status).unwrap().len() < 2048);
            samples.push(start.elapsed());
        }
        samples.sort();
        assert!(samples[7] < Duration::from_millis(100));
        let cached = Arc::new(read(&path, false).unwrap());
        let mut cache = Some((Instant::now(), Ok(cached.clone())));
        let start = Instant::now();
        for _ in 0..10000 {
            assert!(Arc::ptr_eq(
                &cached,
                &cached_status(&mut cache, false, || panic!(
                    "cached access read the file again"
                ))
                .unwrap()
            ));
        }
        let cached_time = start.elapsed();
        assert!(cached_time < Duration::from_millis(100));
        eprintln!("organization policy: 2000 profiles, {} bytes, median {:?}, p95 {:?}; 10000 cached accesses {:?}, shared Arc, no database requests or background tasks", source.len(), samples[7], samples[14], cached_time);
    }
}
