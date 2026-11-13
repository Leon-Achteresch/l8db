use serde::{Deserialize, Serialize};
use std::fs::{File, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::automation::model::AutomationConnection;
use crate::mcp::config::restrict;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub default_connection: Option<String>,
}

fn settings_path() -> PathBuf {
    std::env::var_os("L8DB_CLI_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::mcp::config::config_dir().join("cli.json"))
}

const ACTIVE: &str = "cli-active";
const APP_LOCK: &str = "cli-active.lock";

fn publish_in(dir: &Path, held: &mut Option<File>, id: Option<&str>) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    if held.is_none() {
        let lock = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join(APP_LOCK))?;
        if lock.try_lock().is_ok() {
            *held = Some(lock);
        }
    }
    match id {
        Some(id) => std::fs::write(dir.join(ACTIVE), id),
        None => match std::fs::remove_file(dir.join(ACTIVE)) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        },
    }
}

fn active_in(dir: &Path) -> Option<String> {
    let lock = File::open(dir.join(APP_LOCK)).ok()?;
    if !matches!(lock.try_lock_shared(), Err(TryLockError::WouldBlock)) {
        return None;
    }
    std::fs::read_to_string(dir.join(ACTIVE))
        .ok()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
}

fn settings_dir() -> PathBuf {
    settings_path()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default()
}

pub fn publish_active(id: Option<&str>) {
    static HELD: Mutex<Option<File>> = Mutex::new(None);
    if let Ok(mut held) = HELD.lock() {
        let _ = publish_in(&settings_dir(), &mut held, id);
    }
}

pub fn active_connection() -> Option<String> {
    active_in(&settings_dir())
}

pub fn load_settings() -> Result<Settings, String> {
    let path = settings_path();
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("{} ist beschädigt: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(format!("{} lesen: {e}", path.display())),
    }
}

pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| format!("{} schreiben: {e}", tmp.display()))?;
    restrict(&tmp);
    std::fs::rename(&tmp, &path).map_err(|e| format!("{} schreiben: {e}", path.display()))
}

pub fn find<'a>(
    connections: &'a [AutomationConnection],
    wanted: &str,
) -> Result<&'a AutomationConnection, String> {
    let trimmed = wanted.trim();
    let folded = trimmed.to_lowercase();
    if let Some(found) = connections
        .iter()
        .find(|c| c.id == trimmed || c.name == trimmed)
    {
        return Ok(found);
    }
    let matches: Vec<_> = connections
        .iter()
        .filter(|c| c.name.trim().to_lowercase() == folded)
        .collect();
    match matches.as_slice() {
        [one] => return Ok(one),
        [] => {}
        _ => {
            return Err(format!(
                "„{trimmed}“ passt auf mehrere Verbindungen. Bitte die ID angeben (l8db conn list -o json)."
            ))
        }
    }
    let mut message = format!("Verbindung „{trimmed}“ gibt es nicht.");
    if let Some(close) = suggestion(connections, &folded) {
        message.push_str(&format!(" Meintest du „{close}“?"));
    }
    message.push_str("\n  Alle Verbindungen: l8db conn list");
    Err(message)
}

fn suggestion<'a>(connections: &'a [AutomationConnection], folded: &str) -> Option<&'a str> {
    connections
        .iter()
        .map(|c| {
            let name = c.name.to_lowercase();
            let score = if name.contains(folded) || folded.contains(&name) {
                0
            } else {
                distance(&name, folded)
            };
            (score, c.name.as_str())
        })
        .filter(|(score, name)| *score <= (name.chars().count() / 3).max(2))
        .min_by_key(|(score, _)| *score)
        .map(|(_, name)| name)
}

fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut current = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != *cb);
            current.push(
                (previous[j] + cost)
                    .min(previous[j + 1] + 1)
                    .min(current[j] + 1),
            );
        }
        previous = current;
    }
    previous[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection(id: &str, name: &str) -> AutomationConnection {
        serde_json::from_value(serde_json::json!({
            "id": id, "name": name, "kind": "postgres", "connectionString": "postgres://u@h/db"
        }))
        .unwrap()
    }

    fn list() -> Vec<AutomationConnection> {
        vec![
            connection("1", "Produktion"),
            connection("2", "Staging"),
            connection("3", "lokal"),
        ]
    }

    #[test]
    fn finds_by_id_name_and_case_insensitive_name() {
        let list = list();
        assert_eq!(find(&list, "2").unwrap().name, "Staging");
        assert_eq!(find(&list, "Produktion").unwrap().id, "1");
        assert_eq!(find(&list, "LOKAL").unwrap().id, "3");
    }

    #[test]
    fn suggests_close_names_and_rejects_ambiguous_ones() {
        let list = list();
        let error = find(&list, "stagin").unwrap_err();
        assert!(error.contains("Meintest du „Staging“?"), "{error}");
        let error = find(&list, "prod").unwrap_err();
        assert!(error.contains("„Produktion“"), "{error}");
        let error = find(&list, "zzzzzz").unwrap_err();
        assert!(!error.contains("Meintest"), "{error}");
        let twins = vec![connection("a", "Test"), connection("b", "test")];
        assert!(find(&twins, "TEST").unwrap_err().contains("mehrere"));
        assert_eq!(find(&twins, "test").unwrap().id, "b");
    }

    #[test]
    fn the_open_connection_counts_only_while_the_app_runs() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(active_in(dir.path()), None);
        let mut app = None;
        publish_in(dir.path(), &mut app, Some("c-shop")).unwrap();
        assert_eq!(active_in(dir.path()).as_deref(), Some("c-shop"));
        publish_in(dir.path(), &mut app, Some("c-prod")).unwrap();
        assert_eq!(active_in(dir.path()).as_deref(), Some("c-prod"));
        publish_in(dir.path(), &mut app, None).unwrap();
        assert_eq!(active_in(dir.path()), None);
        publish_in(dir.path(), &mut app, Some("c-shop")).unwrap();
        drop(app);
        assert_eq!(active_in(dir.path()), None);
        assert!(dir.path().join(ACTIVE).is_file());
    }

    #[test]
    fn settings_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cli.json");
        std::env::set_var("L8DB_CLI_CONFIG", &path);
        assert_eq!(load_settings().unwrap(), Settings::default());
        let settings = Settings {
            default_connection: Some("abc".into()),
        };
        save_settings(&settings).unwrap();
        assert_eq!(load_settings().unwrap(), settings);
        std::env::remove_var("L8DB_CLI_CONFIG");
    }
}
