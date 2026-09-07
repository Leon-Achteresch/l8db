use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

const MAX_PACKAGE: u64 = 8 * 1024 * 1024;
#[derive(Default)]
pub struct ExtensionStoreLock(pub Mutex<()>);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Installed {
    archive: Value,
    enabled: bool,
    grants: Vec<String>,
    configuration: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    development_path: Option<String>,
}
fn safe_id(id: &str) -> bool {
    let parts: Vec<_> = id.split('.').collect();
    id.len() <= 160
        && parts.len() == 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.as_bytes()[0].is_ascii_alphanumeric()
                && part
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        })
}
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 240
        && path
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_./-".contains(&c))
        && path.split('/').all(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_lowercase();
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with('.')
                && !["con", "prn", "aux", "nul"].contains(&stem.as_str())
                && !(stem.len() == 4
                    && (stem.starts_with("com") || stem.starts_with("lpt"))
                    && stem.as_bytes()[3].is_ascii_digit())
        })
}
fn read_json(path: &Path, limit: u64) -> Result<Value, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > limit {
        return Err("Invalid or oversized extension file".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Extension file exceeds limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}
fn validate_archive(archive: &Value) -> Result<String, String> {
    let id = archive["manifest"]["id"]
        .as_str()
        .ok_or("Missing extension id")?;
    if archive["format"] != 1 || !safe_id(id) {
        return Err("Invalid extension archive".into());
    }
    let main = archive["manifest"]["main"]
        .as_str()
        .ok_or("Missing entry point")?
        .trim_start_matches("./");
    let files = archive["files"].as_object().ok_or("Missing files")?;
    if files.len() > 256
        || !safe_path(main)
        || !main.ends_with(".js")
        || !files.contains_key(main)
        || files
            .iter()
            .any(|(path, value)| !safe_path(path) || !value.is_string())
    {
        return Err("Invalid extension file paths or entry point".into());
    }
    if serde_json::to_vec(archive)
        .map_err(|e| e.to_string())?
        .len() as u64
        > MAX_PACKAGE
    {
        return Err("Extension archive exceeds 8 MiB".into());
    }
    Ok(id.into())
}
fn ensure_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Extension directory must not be a symlink".into());
    }
    Ok(())
}
fn location(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !safe_id(id) {
        return Err("Invalid extension id".into());
    }
    let path = root.join(id);
    if path.exists()
        && fs::symlink_metadata(&path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Extension directory must not be a symlink".into());
    }
    Ok(path)
}
fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("pending");
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|e| e.to_string())?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    use std::io::Write;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}
fn read_installed(root: &Path, id: &str) -> Result<Installed, String> {
    let installed: Installed = serde_json::from_value(read_json(
        &location(root, id)?.join("package.json"),
        MAX_PACKAGE + 65536,
    )?)
    .map_err(|e| e.to_string())?;
    if installed.archive["manifest"]["id"] != id {
        return Err("Extension directory and id mismatch".into());
    }
    Ok(installed)
}
fn import_directory(path: &Path) -> Result<Value, String> {
    let root = path.canonicalize().map_err(|e| e.to_string())?;
    let mut manifest = read_json(&root.join("l8db-extension.json"), 65536)?;
    let main = manifest["main"]
        .as_str()
        .ok_or("Missing main")?
        .strip_prefix("./")
        .unwrap_or(manifest["main"].as_str().unwrap())
        .to_owned();
    if !safe_path(&main) {
        return Err("Invalid main path".into());
    }
    manifest["main"] = json!(main);
    let mut files = serde_json::Map::new();
    let mut paths = vec![main];
    if root.join("assets").exists() {
        collect_assets(&root, Path::new("assets"), &mut paths, &mut 0)?;
    }
    let mut total = 0;
    for relative in paths {
        let file = root
            .join(&relative)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !file.starts_with(&root) || !safe_path(&relative) {
            return Err("Extension path escapes development directory".into());
        }
        let metadata = fs::metadata(&file).map_err(|e| e.to_string())?;
        total += metadata.len();
        if !metadata.is_file() || total > MAX_PACKAGE {
            return Err("Development extension exceeds size limit".into());
        }
        let content = fs::read_to_string(file)
            .map_err(|e| format!("Only UTF-8 package files are supported: {e}"))?;
        files.insert(relative, json!(content));
    }
    let archive = json!({"format": 1, "manifest": manifest, "files": files});
    validate_archive(&archive)?;
    Ok(archive)
}
fn collect_assets(
    root: &Path,
    relative: &Path,
    paths: &mut Vec<String>,
    visited: &mut usize,
) -> Result<(), String> {
    *visited += 1;
    if *visited > 512 || relative.components().count() > 16 {
        return Err("Too many asset entries or nesting levels".into());
    }
    let metadata = fs::symlink_metadata(root.join(relative)).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Asset symlinks are forbidden".into());
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(root.join(relative)).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            collect_assets(root, &relative.join(entry.file_name()), paths, visited)?;
        }
    } else {
        paths.push(relative.to_string_lossy().replace('\\', "/"));
        if paths.len() > 256 {
            return Err("Too many extension files".into());
        }
    }
    Ok(())
}
fn operate(root: &Path, operation: &str, id: &str, value: Value) -> Result<Value, String> {
    ensure_directory(root)?;
    match operation {
        "list" => {
            let mut result = Vec::new();
            for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let id = entry.file_name().to_string_lossy().to_string();
                if !safe_id(&id) {
                    continue;
                }
                match read_installed(root, &id) {
                    Ok(installed) => {
                        result.push(serde_json::to_value(installed).map_err(|e| e.to_string())?)
                    }
                    Err(error) => eprintln!("[extension:{id}] discovery: {error}"),
                }
            }
            Ok(json!(result))
        }
        "install" => {
            let archive = &value["archive"];
            let extension_id = validate_archive(archive)?;
            let directory = location(root, &extension_id)?;
            if directory.exists() {
                return Err("Extension already installed; uninstall before replacing".into());
            }
            let staging = root.join(format!("{extension_id}.installing"));
            if staging.exists() {
                fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
            }
            ensure_directory(&staging)?;
            let installed = json!({"archive": archive, "enabled": false, "grants": [], "configuration": {}, "developmentPath": value["developmentPath"]});
            write_json(&staging.join("package.json"), &installed)?;
            fs::rename(staging, directory).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "replace" => {
            let archive = &value["archive"];
            let extension_id = validate_archive(archive)?;
            if extension_id != id {
                return Err("Update must keep the extension id".into());
            }
            let mut installed = read_installed(root, id)?;
            let declared = archive["manifest"]["permissions"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            installed
                .grants
                .retain(|grant| declared.contains(&json!(grant)));
            installed.archive = archive.clone();
            installed.development_path = value["developmentPath"].as_str().map(str::to_string);
            write_json(
                &location(root, id)?.join("package.json"),
                &serde_json::to_value(installed).map_err(|e| e.to_string())?,
            )?;
            Ok(Value::Null)
        }
        "remove" => {
            read_installed(root, id)?;
            fs::remove_dir_all(location(root, id)?).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "update" => {
            let mut installed = read_installed(root, id)?;
            installed.enabled = value["enabled"].as_bool().ok_or("Missing enabled")?;
            installed.grants =
                serde_json::from_value(value["grants"].clone()).map_err(|e| e.to_string())?;
            if installed.grants.iter().any(|p| {
                !["database:read", "filesystem:extension-storage"].contains(&p.as_str())
                    || !installed.archive["manifest"]["permissions"]
                        .as_array()
                        .is_some_and(|permissions| permissions.contains(&json!(p)))
            }) {
                return Err("Unsupported or undeclared permission".into());
            }
            if !value["configuration"].is_object()
                || value["configuration"].to_string().len() > 65536
            {
                return Err("Invalid configuration".into());
            }
            installed.configuration = value["configuration"].clone();
            write_json(
                &location(root, id)?.join("package.json"),
                &serde_json::to_value(installed).map_err(|e| e.to_string())?,
            )?;
            Ok(Value::Null)
        }
        "get" | "set" => {
            let installed = read_installed(root, id)?;
            if !installed.enabled
                || !installed
                    .grants
                    .iter()
                    .any(|p| p == "filesystem:extension-storage")
            {
                return Err("PermissionDeniedError: filesystem:extension-storage".into());
            }
            let key = value["key"].as_str().ok_or("Missing storage key")?;
            if key.is_empty()
                || key.len() > 80
                || !key
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
            {
                return Err("Invalid storage key".into());
            }
            let path = location(root, id)?.join("storage.json");
            let mut storage = if path.exists() {
                read_json(&path, 1024 * 1024)?
            } else {
                json!({})
            };
            if operation == "get" {
                return Ok(storage[key].clone());
            }
            storage[key] = value["value"].clone();
            if storage.to_string().len() > 1024 * 1024 {
                return Err("Extension storage quota exceeded (1 MiB)".into());
            }
            write_json(&path, &storage)?;
            Ok(Value::Null)
        }
        _ => Err("Unknown extension store operation".into()),
    }
}
#[tauri::command(async)]
pub fn community_extension_store(
    app: tauri::AppHandle,
    lock: tauri::State<'_, ExtensionStoreLock>,
    operation: String,
    id: String,
    value: Value,
) -> Result<Value, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("community-extensions");
    operate(&root, &operation, &id, value)
}
#[tauri::command(async)]
pub fn read_community_extension(path: String, development: bool) -> Result<Value, String> {
    if development {
        import_directory(Path::new(&path))
    } else {
        let archive = read_json(Path::new(&path), MAX_PACKAGE)?;
        validate_archive(&archive)?;
        Ok(archive)
    }
}

#[cfg(test)]
#[path = "community_extensions_tests.rs"]
mod tests;
