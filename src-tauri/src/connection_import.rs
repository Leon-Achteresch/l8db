use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use base64::Engine;
use blowfish::cipher::{Array, BlockCipherDecrypt, BlockCipherEncrypt, KeyInit};
use blowfish::Blowfish;
use serde::Serialize;
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Manager, Runtime};

const DBEAVER_DATA_SOURCES: &str = "data-sources.json";
const DBEAVER_CREDENTIALS: &str = "credentials-config.json";
const DBEAVER_WORKSPACE: &str = "DBeaverData/workspace6/General/.dbeaver";
const MAX_CONFIG_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq)]
pub struct DbeaverWorkspace {
    pub data_sources_path: String,
    pub data_sources: String,
    pub credentials: Option<String>,
}

fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let metadata =
        std::fs::metadata(path).map_err(|error| format!("{}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} ist keine Datei.", path.display()));
    }
    if metadata.len() > MAX_CONFIG_BYTES {
        return Err(format!("{} ist größer als 32 MB.", path.display()));
    }
    std::fs::read(path).map_err(|error| format!("{}: {error}", path.display()))
}

pub fn is_dbeaver_data_sources(name: &str) -> bool {
    name == DBEAVER_DATA_SOURCES
        || name
            .strip_prefix("data-sources-")
            .and_then(|rest| rest.strip_suffix(".json"))
            .is_some_and(|middle| {
                !middle.is_empty()
                    && middle
                        .chars()
                        .all(|char| char.is_ascii_alphanumeric() || matches!(char, '-' | '_'))
            })
}

pub fn load_dbeaver_workspace(data_sources: &Path) -> Result<DbeaverWorkspace, String> {
    let name = data_sources.file_name().and_then(|name| name.to_str());
    if !name.is_some_and(is_dbeaver_data_sources) {
        return Err(
            "Bitte data-sources.json oder data-sources-*.json aus dem DBeaver-Workspace wählen."
                .to_string(),
        );
    }
    let text = String::from_utf8(read_limited(data_sources)?)
        .map_err(|_| "data-sources.json ist kein gültiges UTF-8.".to_string())?;
    let credentials_path = data_sources.with_file_name(DBEAVER_CREDENTIALS);
    let credentials = if credentials_path.is_file() {
        Some(base64::engine::general_purpose::STANDARD.encode(read_limited(&credentials_path)?))
    } else {
        None
    };
    Ok(DbeaverWorkspace {
        data_sources_path: data_sources.display().to_string(),
        data_sources: text,
        credentials,
    })
}

pub fn dbeaver_workspace_candidates(home: &Path, data_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = [
        ".local/share",
        "Library",
        "AppData/Roaming",
        ".var/app/io.dbeaver.DBeaverCommunity/data",
        "snap/dbeaver-ce/current/.local/share",
    ]
    .iter()
    .map(|base| home.join(base).join(DBEAVER_WORKSPACE))
    .collect();
    if let Some(data_dir) = data_dir {
        let path = data_dir.join(DBEAVER_WORKSPACE);
        if !candidates.contains(&path) {
            candidates.push(path);
        }
    }
    candidates
        .into_iter()
        .map(|directory| directory.join(DBEAVER_DATA_SOURCES))
        .collect()
}

pub fn detect_dbeaver_in(candidates: &[PathBuf]) -> Result<Option<DbeaverWorkspace>, String> {
    match candidates.iter().find(|path| path.is_file()) {
        Some(path) => load_dbeaver_workspace(path).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn read_dbeaver_workspace(path: String) -> Result<DbeaverWorkspace, String> {
    tokio::task::spawn_blocking(move || load_dbeaver_workspace(Path::new(&path)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn detect_dbeaver_workspace<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<DbeaverWorkspace>, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let data_dir = app.path().data_dir().ok();
    let candidates = dbeaver_workspace_candidates(&home, data_dir.as_deref());
    tokio::task::spawn_blocking(move || detect_dbeaver_in(&candidates))
        .await
        .map_err(|error| error.to_string())?
}

const NAVICAT11_SEED: &[u8] = b"3DC5CA39";
const MAX_CIPHER_HEX: usize = 4096;
const MAX_LEGACY_VALUES: usize = 20_000;
const JETBRAINS_SSH_CONFIGS: &str = "sshConfigs.xml";
const MAX_JETBRAINS_PRODUCTS: usize = 64;

#[derive(Debug, Serialize, PartialEq)]
pub struct ImportFile {
    pub name: String,
    pub path: String,
    pub text: String,
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    let value = value.trim();
    if value.is_empty() || value.len() % 2 != 0 || value.len() > MAX_CIPHER_HEX {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(value.get(index..index + 2)?, 16).ok())
        .collect()
}

fn xor8(left: &[u8; 8], right: &[u8]) -> [u8; 8] {
    let mut out = [0u8; 8];
    for index in 0..8 {
        out[index] = left[index] ^ right[index];
    }
    out
}

struct Navicat11 {
    cipher: Blowfish,
    initial_chain: [u8; 8],
}

fn navicat11() -> &'static Navicat11 {
    static CIPHER: OnceLock<Navicat11> = OnceLock::new();
    CIPHER.get_or_init(|| {
        let key = Sha1::digest(NAVICAT11_SEED);
        let cipher = Blowfish::new_from_slice(&key).expect("Blowfish akzeptiert 20-Byte-Schlüssel");
        let initial_chain = encrypt_block(&cipher, [0xFF; 8]);
        Navicat11 {
            cipher,
            initial_chain,
        }
    })
}

fn encrypt_block(cipher: &Blowfish, block: [u8; 8]) -> [u8; 8] {
    let mut buffer = Array::from(block);
    cipher.encrypt_block(&mut buffer);
    buffer.into()
}

fn decrypt_block(cipher: &Blowfish, block: [u8; 8]) -> [u8; 8] {
    let mut buffer = Array::from(block);
    cipher.decrypt_block(&mut buffer);
    buffer.into()
}

pub fn decrypt_navicat11(value: &str) -> Option<String> {
    let bytes = decode_hex(value)?;
    let state = navicat11();
    let cipher = &state.cipher;
    let mut chain = state.initial_chain;
    let mut plain = Vec::with_capacity(bytes.len());
    let mut chunks = bytes.chunks_exact(8);
    for chunk in &mut chunks {
        let block: [u8; 8] = chunk.try_into().ok()?;
        plain.extend_from_slice(&xor8(&decrypt_block(cipher, block), &chain));
        chain = xor8(&chain, &block);
    }
    let rest = chunks.remainder();
    if !rest.is_empty() {
        let stream = encrypt_block(cipher, chain);
        plain.extend(
            rest.iter()
                .zip(stream.iter())
                .map(|(left, right)| left ^ right),
        );
    }
    String::from_utf8(plain)
        .ok()
        .filter(|text| !text.chars().any(char::is_control))
}

pub fn decrypt_navicat11_batch(values: &[String]) -> Result<Vec<Option<String>>, String> {
    if values.len() > MAX_LEGACY_VALUES {
        return Err(format!(
            "Zu viele Navicat-Passwörter ({}, maximal {MAX_LEGACY_VALUES}).",
            values.len()
        ));
    }
    Ok(values
        .iter()
        .map(|value| decrypt_navicat11(value))
        .collect())
}

#[tauri::command]
pub async fn decrypt_navicat_legacy_passwords(
    values: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    tokio::task::spawn_blocking(move || decrypt_navicat11_batch(&values))
        .await
        .map_err(|error| error.to_string())?
}

pub fn jetbrains_config_roots(home: &Path, config_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = config_dir
        .map(|dir| dir.join("JetBrains"))
        .into_iter()
        .collect();
    for base in [".config", "Library/Application Support", "AppData/Roaming"] {
        let root = home.join(base).join("JetBrains");
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    roots
}

fn version_key(path: &Path) -> Vec<u64> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    name.split(|char: char| !char.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect()
}

pub fn find_jetbrains_ssh_configs(roots: &[PathBuf]) -> Vec<ImportFile> {
    let mut products: Vec<PathBuf> = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
            if path.is_dir() && !products.contains(&path) {
                products.push(path);
            }
        }
    }
    products.sort_by(|left, right| {
        version_key(right)
            .cmp(&version_key(left))
            .then_with(|| left.cmp(right))
    });
    let mut files = Vec::new();
    for product in products.into_iter().take(MAX_JETBRAINS_PRODUCTS) {
        let path = product.join("options").join(JETBRAINS_SSH_CONFIGS);
        let Ok(bytes) = read_limited(&path) else {
            continue;
        };
        let Ok(text) = String::from_utf8(bytes) else {
            continue;
        };
        files.push(ImportFile {
            name: JETBRAINS_SSH_CONFIGS.to_string(),
            path: path.display().to_string(),
            text,
        });
    }
    files
}

#[tauri::command]
pub async fn detect_jetbrains_ssh_configs<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<ImportFile>, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let config_dir = app.path().config_dir().ok();
    let roots = jetbrains_config_roots(&home, config_dir.as_deref());
    tokio::task::spawn_blocking(move || find_jetbrains_ssh_configs(&roots))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decrypts_navicat11_vectors() {
        assert_eq!(
            decrypt_navicat11("F7CD9A953A6DFF06206844").as_deref(),
            Some("legacyPw123")
        );
        assert_eq!(decrypt_navicat11("575F213DE2").as_deref(), Some("short"));
        assert_eq!(
            decrypt_navicat11("420875526a0b2512").as_deref(),
            Some("exactly8")
        );
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("l8db-dbeaver-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".local/share").join(DBEAVER_WORKSPACE)).unwrap();
        dir
    }

    #[test]
    fn detects_dbeaver_workspace_in_hidden_directories() {
        let home = scratch("detect");
        let candidates = dbeaver_workspace_candidates(&home, None);
        assert_eq!(detect_dbeaver_in(&candidates), Ok(None));
        let workspace = home.join(".local/share").join(DBEAVER_WORKSPACE);
        std::fs::write(workspace.join(DBEAVER_DATA_SOURCES), "{\"connections\":{}}").unwrap();
        std::fs::write(workspace.join(DBEAVER_CREDENTIALS), [1u8, 2, 3]).unwrap();
        let found = detect_dbeaver_in(&candidates).unwrap().unwrap();
        assert_eq!(found.data_sources, "{\"connections\":{}}");
        assert_eq!(found.credentials.as_deref(), Some("AQID"));
        assert!(found
            .data_sources_path
            .ends_with(".dbeaver/data-sources.json"));
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn reads_only_dbeaver_files_next_to_the_picked_config() {
        let home = scratch("read");
        let workspace = home.join(".local/share").join(DBEAVER_WORKSPACE);
        let picked = workspace.join(DBEAVER_DATA_SOURCES);
        std::fs::write(&picked, "{}").unwrap();
        assert_eq!(load_dbeaver_workspace(&picked).unwrap().credentials, None);
        std::fs::write(workspace.join("secrets.txt"), "x").unwrap();
        assert!(load_dbeaver_workspace(&workspace.join("secrets.txt")).is_err());
        assert!(load_dbeaver_workspace(&workspace.join("missing/data-sources.json")).is_err());
        let second = workspace.join("data-sources-2.json");
        std::fs::write(&second, "{\"connections\":{}}").unwrap();
        assert_eq!(
            load_dbeaver_workspace(&second).unwrap().data_sources,
            "{\"connections\":{}}"
        );
        for name in [
            "data-sources-.json",
            "data-sources-a/b.json",
            "data-sources.txt",
        ] {
            assert!(!is_dbeaver_data_sources(name), "{name}");
        }
        assert!(is_dbeaver_data_sources("data-sources-team_1.json"));
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn rejects_malformed_navicat11_input() {
        assert_eq!(decrypt_navicat11(""), None);
        assert_eq!(decrypt_navicat11("ABC"), None);
        assert_eq!(decrypt_navicat11("ZZZZ"), None);
        assert_eq!(decrypt_navicat11(&"A".repeat(MAX_CIPHER_HEX + 2)), None);
        assert_eq!(
            decrypt_navicat11_batch(&["575F213DE2".into(), "XY".into()]),
            Ok(vec![Some("short".to_string()), None])
        );
        assert!(decrypt_navicat11_batch(&vec![String::new(); MAX_LEGACY_VALUES + 1]).is_err());
        assert_eq!(decrypt_navicat11("45362C45F5"), None);
    }

    #[test]
    fn finds_jetbrains_ssh_configs_in_hidden_config_dirs() {
        let home = scratch("jetbrains");
        let roots = jetbrains_config_roots(&home, None);
        assert!(find_jetbrains_ssh_configs(&roots).is_empty());
        let options = home.join(".config/JetBrains/DataGrip2024.1/options");
        std::fs::create_dir_all(&options).unwrap();
        std::fs::write(options.join(JETBRAINS_SSH_CONFIGS), "<application/>").unwrap();
        std::fs::write(options.join("other.xml"), "<secret/>").unwrap();
        let found = find_jetbrains_ssh_configs(&roots);
        assert_eq!(found.len(), 1);
        for (product, body) in [
            ("DataGrip2024.2", "<v2024-2/>"),
            ("DataGrip2024.10", "<v2024-10/>"),
            ("IntelliJIdea2023.3", "<v2023-3/>"),
        ] {
            let dir = home.join(".config/JetBrains").join(product).join("options");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(JETBRAINS_SSH_CONFIGS), body).unwrap();
        }
        let ordered: Vec<String> = find_jetbrains_ssh_configs(&roots)
            .into_iter()
            .map(|file| file.text)
            .collect();
        assert_eq!(
            ordered,
            vec!["<v2024-10/>", "<v2024-2/>", "<application/>", "<v2023-3/>"]
        );
        assert_eq!(found[0].name, JETBRAINS_SSH_CONFIGS);
        assert_eq!(found[0].text, "<application/>");
        std::fs::remove_dir_all(home).unwrap();
    }
}
