use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Runtime, State};

const MAX_FILE_BYTES: u64 = 256 * 1024;
const MAX_FILES: usize = 200;
const MAX_SUPPORT_BYTES: usize = 512 * 1024;
const DEBOUNCE: Duration = Duration::from_millis(120);
const SUPPORT_FILES: [&str; 5] = [
    "AGENTS.md",
    "CLAUDE.md",
    "l8db-ui.d.ts",
    "tsconfig.json",
    ".status.json",
];
pub const CHANGED_EVENT: &str = "ui-plugins-changed";

#[derive(Default)]
pub struct UiPluginWatcher(Mutex<Option<RecommendedWatcher>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginFile {
    name: String,
    source: String,
    modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    name: String,
    reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginScan {
    dir: String,
    files: Vec<PluginFile>,
    skipped: Vec<SkippedFile>,
}

fn plugin_dir() -> Result<PathBuf, String> {
    crate::team::team_file()
        .and_then(|file| file.parent().map(|dir| dir.join("ui")))
        .ok_or_else(|| "Benutzerordner konnte nicht ermittelt werden.".to_string())
}

fn is_plugin_name(name: &str) -> bool {
    let valid_chars = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-');
    let first = name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
    let extension = [".tsx", ".ts", ".jsx", ".js"]
        .iter()
        .any(|ext| name.ends_with(ext));
    valid_chars
        && first
        && extension
        && name.len() <= 85
        && !name.contains("..")
        && !name.ends_with(".d.ts")
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Ungültiger Dateiname")?;
    let temporary = path.with_file_name(format!(".{name}.pending"));
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|e| e.to_string())?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(&temporary, path).map_err(|e| e.to_string())
}

fn scan(dir: &Path) -> Result<PluginScan, String> {
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut entries = fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok().map(|name| (name, entry)))
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut files = Vec::new();
    let mut skipped = Vec::new();
    for (name, entry) in entries {
        if name.starts_with('.') || !is_plugin_name(&name) {
            continue;
        }
        let skip = |reason: &str| SkippedFile {
            name: name.clone(),
            reason: reason.to_string(),
        };
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !meta.is_file() {
            skipped.push(skip("keine normale Datei"));
            continue;
        }
        if meta.len() > MAX_FILE_BYTES {
            skipped.push(skip("größer als 256 KB"));
            continue;
        }
        if files.len() >= MAX_FILES {
            skipped.push(skip("mehr als 200 Plugins"));
            continue;
        }
        let Ok(bytes) = fs::read(entry.path()) else {
            skipped.push(skip("nicht lesbar"));
            continue;
        };
        let Ok(source) = String::from_utf8(bytes) else {
            skipped.push(skip("kein gültiges UTF-8"));
            continue;
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        files.push(PluginFile {
            name,
            source: source.trim_start_matches('\u{feff}').to_string(),
            modified,
        });
    }
    Ok(PluginScan {
        dir: dir.display().to_string(),
        files,
        skipped,
    })
}

fn write_plugin(dir: &Path, name: &str, source: &str) -> Result<(), String> {
    if !is_plugin_name(name) {
        return Err(format!("Ungültiger Dateiname: {name}"));
    }
    if source.len() as u64 > MAX_FILE_BYTES {
        return Err("Plugin ist größer als 256 KB.".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(name), source.as_bytes())
}

fn remove_plugin(dir: &Path, name: &str) -> Result<(), String> {
    if !is_plugin_name(name) {
        return Err(format!("Ungültiger Dateiname: {name}"));
    }
    match fs::remove_file(dir.join(name)) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}

fn write_support(dir: &Path, name: &str, contents: &str) -> Result<(), String> {
    if !SUPPORT_FILES.contains(&name) {
        return Err(format!("Ungültige Hilfsdatei: {name}"));
    }
    if contents.len() > MAX_SUPPORT_BYTES {
        return Err("Hilfsdatei ist zu groß.".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    if fs::read(&path).is_ok_and(|current| current == contents.as_bytes()) {
        return Ok(());
    }
    write_atomic(&path, contents.as_bytes())
}

#[tauri::command(async)]
pub fn ui_plugins_scan() -> Result<PluginScan, String> {
    scan(&plugin_dir()?)
}

#[tauri::command(async)]
pub fn ui_plugins_write(name: String, source: String) -> Result<(), String> {
    write_plugin(&plugin_dir()?, &name, &source)
}

#[tauri::command(async)]
pub fn ui_plugins_remove(name: String) -> Result<(), String> {
    remove_plugin(&plugin_dir()?, &name)
}

#[tauri::command(async)]
pub fn ui_plugins_write_support(name: String, contents: String) -> Result<(), String> {
    write_support(&plugin_dir()?, &name, &contents)
}

#[tauri::command]
pub fn ui_plugins_watch<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, UiPluginWatcher>,
) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Ok(());
    }
    let dir = plugin_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let pending = Arc::new(AtomicBool::new(false));
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        let relevant = event.paths.iter().any(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_plugin_name)
        });
        if !relevant || pending.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        let pending = pending.clone();
        std::thread::spawn(move || {
            std::thread::sleep(DEBOUNCE);
            pending.store(false, Ordering::SeqCst);
            let _ = app.emit(CHANGED_EVENT, ());
        });
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    *slot = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("l8db-ui-{}", rand::random::<u64>()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn plugin_names_are_restricted_to_flat_source_files() {
        for name in ["status.tsx", "a-b_c.1.ts", "x.jsx", "y.js"] {
            assert!(is_plugin_name(name), "{name}");
        }
        for name in [
            "../x.tsx",
            "a/b.tsx",
            ".hidden.tsx",
            "l8db-ui.d.ts",
            "notes.md",
            "a..b.tsx",
            "x.tsx.bak",
            "",
            "ä.tsx",
        ] {
            assert!(!is_plugin_name(name), "{name}");
        }
    }

    #[test]
    fn scan_reads_plugins_in_name_order_and_skips_everything_else() {
        let dir = temp_dir();
        fs::write(dir.join("b.tsx"), "export default 2;").unwrap();
        fs::write(dir.join("a.ts"), "\u{feff}export default 1;").unwrap();
        fs::write(dir.join("AGENTS.md"), "x").unwrap();
        fs::write(dir.join("l8db-ui.d.ts"), "x").unwrap();
        fs::write(dir.join(".status.json"), "{}").unwrap();
        fs::write(dir.join("big.tsx"), vec![b'a'; MAX_FILE_BYTES as usize + 1]).unwrap();
        fs::write(dir.join("binary.tsx"), [0xff, 0xfe, 0x00]).unwrap();
        fs::create_dir_all(dir.join("folder.tsx")).unwrap();
        let result = scan(&dir).unwrap();
        let names = result
            .files
            .iter()
            .map(|file| file.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, ["a.ts", "b.tsx"]);
        assert_eq!(result.files[0].source, "export default 1;");
        let skipped = result
            .skipped
            .iter()
            .map(|file| file.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(skipped, ["big.tsx", "binary.tsx", "folder.tsx"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn writes_are_atomic_validated_and_removable() {
        let dir = temp_dir();
        write_plugin(&dir, "one.tsx", "export default 1;").unwrap();
        write_plugin(&dir, "one.tsx", "export default 2;").unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("one.tsx")).unwrap(),
            "export default 2;"
        );
        assert!(write_plugin(&dir, "../evil.tsx", "x").is_err());
        assert!(write_plugin(&dir, "big.tsx", &"x".repeat(MAX_FILE_BYTES as usize + 1)).is_err());
        assert!(write_support(&dir, "evil.sh", "x").is_err());
        write_support(&dir, "AGENTS.md", "hallo").unwrap();
        assert_eq!(fs::read_to_string(dir.join("AGENTS.md")).unwrap(), "hallo");
        remove_plugin(&dir, "one.tsx").unwrap();
        remove_plugin(&dir, "one.tsx").unwrap();
        assert!(!dir.join("one.tsx").exists());
        assert!(fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .all(|entry| !entry.file_name().to_string_lossy().ends_with(".pending")));
        fs::remove_dir_all(dir).unwrap();
    }
}
