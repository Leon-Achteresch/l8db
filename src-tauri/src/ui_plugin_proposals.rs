use notify::{RecursiveMode, Watcher};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct Proposals {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

fn directory() -> Result<PathBuf, String> {
    let path = super::ui_plugins::plugin_dir()?.join(".proposals");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

struct Pending(PathBuf);
impl Drop for Pending {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn definition() -> Value {
    json!({"name":"ui_plugins", "description":"UI plugins of the l8db app. Call api first for the SDK. write/remove wait up to 120 s for the user's approval in l8db, then return status or compile errors with line. Never grants HTTP.", "inputSchema":{"type":"object","properties":{"action":{"type":"string","enum":["list","read","write","remove","status","api"]},"name":{"type":"string"},"source":{"type":"string"}},"required":["action"]}})
}

pub async fn call(args: &Value) -> Result<String, String> {
    let action = args["action"].as_str().unwrap_or("");
    let root = super::ui_plugins::plugin_dir()?;
    if action == "api" {
        return Ok(format!(
            "{}\n{}",
            include_str!("../../packages/ui-plugin-api/folder-agents.md"),
            include_str!("../../packages/ui-plugin-api/l8db-ui.d.ts")
        ));
    }
    if action == "list" {
        return serde_json::to_string(&super::ui_plugins::scan(&root)?).map_err(|e| e.to_string());
    }
    if action == "status" {
        return fs::read_to_string(root.join(".status.json")).map_err(|e| e.to_string());
    }
    let name = args["name"].as_str().unwrap_or("");
    if !super::ui_plugins::is_plugin_name(name) {
        return Err("Ungültiger Plugin-Dateiname".into());
    }
    if action == "read" {
        return super::ui_plugins::scan(&root)?
            .files
            .into_iter()
            .find(|f| f.name == name)
            .map(|f| f.source)
            .ok_or("Plugin nicht gefunden".into());
    }
    if !matches!(action, "write" | "remove") {
        return Err("Unbekannte Aktion".into());
    }
    let source = args["source"].as_str().unwrap_or("");
    if source.len() > 256 * 1024 {
        return Err("Plugin ist größer als 256 KB".into());
    }
    wait_for_proposal(
        &root,
        &directory()?,
        action,
        name,
        source,
        Duration::from_secs(120),
    )
    .await
}

async fn wait_for_proposal(
    root: &std::path::Path,
    dir: &std::path::Path,
    action: &str,
    name: &str,
    source: &str,
    timeout: Duration,
) -> Result<String, String> {
    let slot = (0..8)
        .find_map(|i| {
            let p = dir.join(i.to_string());
            if fs::metadata(&p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age > Duration::from_secs(130))
            {
                let _ = fs::remove_dir_all(&p);
            }
            fs::create_dir(&p).ok().map(|_| Pending(p))
        })
        .ok_or("Maximal acht ausstehende Vorschläge")?;
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    let mut watcher =
        notify::recommended_watcher(move |_: Result<notify::Event, notify::Error>| {
            let _ = tx.try_send(());
        })
        .map_err(|e| e.to_string())?;
    watcher
        .watch(&slot.0, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    let before = snapshot(root, name)?;
    let request = json!({"action":action,"name":name,"source":source,"before":before,"nonce":format!("{}-{:?}",std::process::id(),std::time::SystemTime::now())});
    super::ui_plugins::write_atomic(&slot.0.join("request.json"), request.to_string().as_bytes())?;
    let wait = async {
        loop {
            if let Ok(response) = fs::read_to_string(slot.0.join("response.json")) {
                return response;
            }
            if rx.recv().await.is_none() {
                return "{\"decision\":\"timeout\"}".into();
            }
        }
    };
    Ok(tokio::time::timeout(timeout, wait)
        .await
        .unwrap_or_else(|_| "{\"decision\":\"timeout\"}".into()))
}

fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Nur das Hauptfenster entscheidet".into());
    }
    Ok(())
}

#[tauri::command]
pub fn ui_plugin_proposals_start(window: tauri::WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    let state = window.state::<Proposals>();
    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        let app = window.app_handle().clone();
        let mut watcher =
            notify::recommended_watcher(move |_: Result<notify::Event, notify::Error>| {
                let _ = app.emit_to("main", "ui-plugin-proposals", ());
            })
            .map_err(|e| e.to_string())?;
        watcher
            .watch(&directory()?, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
        *guard = Some(watcher);
    }
    Ok(())
}

#[tauri::command]
pub fn ui_plugin_proposals_pending(window: tauri::WebviewWindow) -> Result<Vec<Value>, String> {
    main_window(&window)?;
    let dir = directory()?;
    Ok((0..8)
        .filter_map(|i| {
            let slot = dir.join(i.to_string());
            if slot.join("response.json").exists() {
                return None;
            }
            let text = fs::read_to_string(slot.join("request.json")).ok()?;
            let mut request: Value = serde_json::from_str(&text).ok()?;
            request["slot"] = json!(i);
            Some(request)
        })
        .collect())
}

#[tauri::command]
pub fn ui_plugin_proposals_finish(
    window: tauri::WebviewWindow,
    slot: u8,
    request: Value,
    response: Value,
    apply: bool,
) -> Result<(), String> {
    main_window(&window)?;
    if slot >= 8 {
        return Err("Ungültiger Vorschlag".into());
    }
    let dir = directory()?.join(slot.to_string());
    let current: Value = serde_json::from_str(
        &fs::read_to_string(dir.join("request.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let mut expected = request;
    expected
        .as_object_mut()
        .ok_or("Ungültiger Vorschlag")?
        .remove("slot");
    if current != expected || dir.join("response.json").exists() {
        return Err("Vorschlag abgelaufen".into());
    }
    if apply {
        apply_request(&super::ui_plugins::plugin_dir()?, &current)?;
        let _ = window
            .app_handle()
            .emit(super::ui_plugins::CHANGED_EVENT, ());
    }
    super::ui_plugins::write_atomic(&dir.join("response.json"), response.to_string().as_bytes())
}

fn snapshot(root: &std::path::Path, name: &str) -> Result<Option<String>, String> {
    if !super::ui_plugins::is_plugin_name(name) {
        return Err("Ungültiger Dateiname".into());
    }
    let path = root.join(name);
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
        Ok(meta) if !meta.is_file() || meta.len() > 256 * 1024 => {
            Err("Keine reguläre Plugin-Datei bis 256 KB".into())
        }
        Ok(_) => fs::read_to_string(path)
            .map(Some)
            .map_err(|e| e.to_string()),
    }
}

fn apply_request(root: &std::path::Path, current: &Value) -> Result<(), String> {
    let name = current["name"].as_str().ok_or("Dateiname fehlt")?;
    let actual = snapshot(root, name)?;
    if (current["action"] == "write" && actual.as_deref() == current["source"].as_str())
        || (current["action"] == "remove" && actual.is_none())
    {
        return Ok(());
    }
    if actual != current["before"].as_str().map(str::to_owned) {
        return Err("Plugin wurde inzwischen geändert".into());
    }
    match current["action"].as_str() {
        Some("write") => super::ui_plugins::write_plugin(
            root,
            name,
            current["source"].as_str().ok_or("Quelltext fehlt")?,
        ),
        Some("remove") => super::ui_plugins::remove_plugin(root, name),
        _ => Err("Ungültige Aktion".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_plugin_proposals_overwrite_remove_and_traversal() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["gallery.tsx", "other-author.tsx"] {
            fs::write(dir.path().join(name), "old").unwrap();
            let request = json!({"action":"write","name":name,"before":"old","source":"new"});
            apply_request(dir.path(), &request).unwrap();
            assert_eq!(snapshot(dir.path(), name).unwrap().as_deref(), Some("new"));
            apply_request(dir.path(), &request).unwrap();
            apply_request(
                dir.path(),
                &json!({"action":"remove","name":name,"before":"new"}),
            )
            .unwrap();
            assert!(snapshot(dir.path(), name).unwrap().is_none());
        }
        for name in [
            "../evil.tsx",
            "nested/file.tsx",
            "/evil.tsx",
            "a..tsx",
            "types.d.ts",
        ] {
            assert!(snapshot(dir.path(), name).is_err());
        }
    }

    #[tokio::test]
    async fn ui_plugin_proposals_timeout_cancel_capacity_and_latency() {
        let root = tempfile::tempdir().unwrap();
        let queue = tempfile::tempdir().unwrap();
        let source = "x".repeat(256 * 1024);
        let mut samples = Vec::new();
        for _ in 0..30 {
            let started = std::time::Instant::now();
            let response = wait_for_proposal(
                root.path(),
                queue.path(),
                "write",
                "null.tsx",
                &source,
                Duration::from_millis(5),
            )
            .await
            .unwrap();
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
            assert!(response.contains("timeout"));
            assert_eq!(fs::read_dir(queue.path()).unwrap().count(), 0);
        }
        samples.sort_by(f64::total_cmp);
        eprintln!(
            "proposal 256KiB, n=30 median={:.2}ms p95={:.2}ms, timeout=5ms, queue<=8",
            samples[15], samples[28]
        );
        assert!(samples[28] < 250.0);
        let mut futures = Vec::new();
        for _ in 0..8 {
            let mut future = Box::pin(wait_for_proposal(
                root.path(),
                queue.path(),
                "write",
                "null.tsx",
                &source,
                Duration::from_secs(120),
            ));
            assert!(tokio::time::timeout(Duration::from_millis(5), &mut future)
                .await
                .is_err());
            futures.push(future);
        }
        assert_eq!(fs::read_dir(queue.path()).unwrap().count(), 8);
        assert!(wait_for_proposal(
            root.path(),
            queue.path(),
            "write",
            "null.tsx",
            "",
            Duration::ZERO
        )
        .await
        .is_err());
        drop(futures);
        assert_eq!(fs::read_dir(queue.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn ui_plugin_proposals_event_response_and_two_concurrent() {
        let root = tempfile::tempdir().unwrap();
        let queue = tempfile::tempdir().unwrap();
        let mut first = Box::pin(wait_for_proposal(
            root.path(),
            queue.path(),
            "write",
            "null.tsx",
            "source",
            Duration::from_secs(2),
        ));
        let mut second = Box::pin(wait_for_proposal(
            root.path(),
            queue.path(),
            "remove",
            "gallery.tsx",
            "",
            Duration::from_secs(2),
        ));
        assert!(tokio::time::timeout(Duration::from_millis(5), &mut first)
            .await
            .is_err());
        assert!(tokio::time::timeout(Duration::from_millis(5), &mut second)
            .await
            .is_err());
        fs::write(
            queue.path().join("1/response.json"),
            r#"{"decision":"rejected"}"#,
        )
        .unwrap();
        fs::write(
            queue.path().join("0/response.json"),
            r#"{"decision":"accepted","status":{"state":"active"}}"#,
        )
        .unwrap();
        assert!(first.await.unwrap().contains("active"));
        assert!(second.await.unwrap().contains("rejected"));
        assert!(!root.path().join("null.tsx").exists());
        assert_eq!(fs::read_dir(queue.path()).unwrap().count(), 0);
    }
}
