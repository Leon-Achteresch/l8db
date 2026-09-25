use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::db::provider::DatabaseKind;

pub const OPEN_FILES_EVENT: &str = "open-files";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum OpenFileAction {
    Connection {
        kind: DatabaseKind,
        path: String,
        name: String,
    },
    Sql {
        path: String,
    },
    Notebook {
        path: String,
    },
    Unsupported {
        path: String,
    },
}

pub struct PendingOpenFiles(Mutex<Vec<OpenFileAction>>);

impl PendingOpenFiles {
    pub fn new(actions: Vec<OpenFileAction>) -> Self {
        Self(Mutex::new(actions))
    }
}

pub fn action_for_path(path: &Path) -> OpenFileAction {
    let text = path.to_string_lossy().into_owned();
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let kind = match extension.as_str() {
        "sqlite" | "sqlite3" | "db" | "db3" => Some(DatabaseKind::Sqlite),
        "duckdb" | "ddb" | "parquet" | "csv" => Some(DatabaseKind::Duckdb),
        "sql" => return OpenFileAction::Sql { path: text },
        "l8nb" => return OpenFileAction::Notebook { path: text },
        _ => None,
    };
    match kind {
        Some(kind) => OpenFileAction::Connection {
            kind,
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| text.clone()),
            path: text,
        },
        None => OpenFileAction::Unsupported { path: text },
    }
}

fn file_url_path(arg: &str) -> Option<PathBuf> {
    if !arg.starts_with("file://") {
        return None;
    }
    url::Url::parse(arg).ok()?.to_file_path().ok()
}

pub fn paths_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        let value = if arg == "--file" {
            match iter.next() {
                Some(value) => value.as_str(),
                None => break,
            }
        } else if let Some(value) = arg.strip_prefix("--file=") {
            value
        } else if arg.starts_with('-') || arg.is_empty() {
            continue;
        } else {
            arg.as_str()
        };
        if value.is_empty() {
            continue;
        }
        let path = file_url_path(value).unwrap_or_else(|| PathBuf::from(value));
        paths.push(if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        });
    }
    paths
}

pub fn actions_from_args(args: &[String], cwd: &Path) -> Vec<OpenFileAction> {
    paths_from_args(args, cwd)
        .iter()
        .map(|path| action_for_path(path))
        .collect()
}

pub fn enqueue<R: Runtime>(app: &AppHandle<R>, actions: Vec<OpenFileAction>) {
    if !actions.is_empty() {
        if let Ok(mut pending) = app.state::<PendingOpenFiles>().0.lock() {
            pending.extend(actions);
        }
        let _ = app.emit_to("main", OPEN_FILES_EVENT, ());
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn take_pending_open_files(state: State<'_, PendingOpenFiles>) -> Vec<OpenFileAction> {
    state
        .0
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

#[tauri::command]
pub fn resolve_open_files(paths: Vec<String>) -> Vec<OpenFileAction> {
    paths
        .iter()
        .map(|path| action_for_path(Path::new(path)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn connection(kind: DatabaseKind, path: &str, name: &str) -> OpenFileAction {
        OpenFileAction::Connection {
            kind,
            path: path.to_string(),
            name: name.to_string(),
        }
    }

    #[test]
    fn maps_extensions_to_actions() {
        for (path, kind) in [
            ("/d/a.sqlite", DatabaseKind::Sqlite),
            ("/d/a.SQLITE3", DatabaseKind::Sqlite),
            ("/d/a.db", DatabaseKind::Sqlite),
            ("/d/a.db3", DatabaseKind::Sqlite),
            ("/d/a.duckdb", DatabaseKind::Duckdb),
            ("/d/a.ddb", DatabaseKind::Duckdb),
            ("/d/a.parquet", DatabaseKind::Duckdb),
            ("/d/a.csv", DatabaseKind::Duckdb),
        ] {
            let name = Path::new(path).file_name().unwrap().to_str().unwrap();
            assert_eq!(
                action_for_path(Path::new(path)),
                connection(kind, path, name)
            );
        }
        assert_eq!(
            action_for_path(Path::new("/d/q.sql")),
            OpenFileAction::Sql {
                path: "/d/q.sql".into()
            }
        );
        assert_eq!(
            action_for_path(Path::new("/d/n.L8NB")),
            OpenFileAction::Notebook {
                path: "/d/n.L8NB".into()
            }
        );
        assert_eq!(
            action_for_path(Path::new("/d/readme")),
            OpenFileAction::Unsupported {
                path: "/d/readme".into()
            }
        );
    }

    #[test]
    fn serializes_tagged_actions() {
        let value =
            serde_json::to_value(connection(DatabaseKind::Duckdb, "/d/a.csv", "a.csv")).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "action": "connection", "kind": "duckdb", "path": "/d/a.csv", "name": "a.csv" })
        );
    }

    #[cfg(unix)]
    #[test]
    fn parses_positional_and_file_flags() {
        let cwd = Path::new("/work");
        assert_eq!(
            paths_from_args(
                &args(&[
                    "data.db",
                    "--file",
                    "/abs/q.sql",
                    "--file=n.l8nb",
                    "-psn_0_1234"
                ]),
                cwd
            ),
            vec![
                PathBuf::from("/work/data.db"),
                PathBuf::from("/abs/q.sql"),
                PathBuf::from("/work/n.l8nb"),
            ]
        );
    }

    #[test]
    fn ignores_flags_and_incomplete_file_option() {
        let cwd = Path::new("/work");
        assert!(paths_from_args(&args(&["--verbose", "--file"]), cwd).is_empty());
        assert!(paths_from_args(&args(&["", "--file="]), cwd).is_empty());
        assert!(paths_from_args(&[], cwd).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn decodes_file_urls() {
        assert_eq!(
            paths_from_args(&args(&["file:///tmp/a%20b.duckdb"]), Path::new("/work")),
            vec![PathBuf::from("/tmp/a b.duckdb")]
        );
    }

    #[test]
    fn actions_from_args_resolve_relative_paths() {
        let actions = actions_from_args(&args(&["--file", "x.parquet"]), Path::new("/w"));
        assert_eq!(
            actions,
            vec![connection(
                DatabaseKind::Duckdb,
                &Path::new("/w").join("x.parquet").to_string_lossy(),
                "x.parquet"
            )]
        );
    }
}
