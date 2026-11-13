use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::db::provider::DatabaseKind;

pub const OPEN_FILES_EVENT: &str = "open-files";
pub const SHARED_TAB_PREFIX: &str = "l8db://tab/";
pub const MAX_SHARED_TAB_LINK: usize = 1_000_000;

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
    Link {
        link: String,
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

pub fn is_app_url(arg: &str) -> bool {
    arg.get(..5)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("l8db:"))
}

pub fn shared_tab_link(arg: &str) -> Option<String> {
    if arg.len() > MAX_SHARED_TAB_LINK + 1 {
        return None;
    }
    let prefix = arg.get(..SHARED_TAB_PREFIX.len())?;
    if !prefix.eq_ignore_ascii_case(SHARED_TAB_PREFIX) {
        return None;
    }
    let body = arg[SHARED_TAB_PREFIX.len()..].trim_end_matches('/');
    let valid = !body.is_empty()
        && body.len() + SHARED_TAB_PREFIX.len() <= MAX_SHARED_TAB_LINK
        && body
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    valid.then(|| format!("{SHARED_TAB_PREFIX}{body}"))
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
        if value.is_empty() || is_app_url(value) {
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
    let mut actions: Vec<OpenFileAction> = paths_from_args(args, cwd)
        .iter()
        .map(|path| action_for_path(path))
        .collect();
    actions.extend(link_action(args.iter().map(String::as_str)));
    actions
}

pub fn link_action<'a>(args: impl IntoIterator<Item = &'a str>) -> Option<OpenFileAction> {
    args.into_iter()
        .find_map(shared_tab_link)
        .map(|link| OpenFileAction::Link { link })
}

pub fn enqueue<R: Runtime>(app: &AppHandle<R>, actions: Vec<OpenFileAction>) {
    let queued = !actions.is_empty();
    if queued {
        if let Ok(mut pending) = app.state::<PendingOpenFiles>().0.lock() {
            pending.extend(actions);
        }
    }
    let window = crate::windows::main_window(app);
    if queued {
        let _ = app.emit_to(crate::windows::MAIN_LABEL, OPEN_FILES_EVENT, ());
    }
    if let Some(window) = window {
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

    #[test]
    fn accepts_only_shared_tab_links() {
        assert_eq!(
            shared_tab_link("l8db://tab/aWyJ0Il0").as_deref(),
            Some("l8db://tab/aWyJ0Il0")
        );
        assert_eq!(
            shared_tab_link("L8DB://TAB/aWyJ0Il0/").as_deref(),
            Some("l8db://tab/aWyJ0Il0")
        );
        for rejected in [
            "l8db://tab/",
            "l8db://tab//",
            "l8db://conn/abc",
            "l8db://tab/abc?x=1",
            "l8db://tab/a%20b",
            "l8db://tab/../x",
            "http://tab/abc",
            "l8dbx://tab/abc",
            "javascript:alert(1)",
            "l8db://täb/abc",
        ] {
            assert_eq!(shared_tab_link(rejected), None, "{rejected}");
        }
    }

    #[test]
    fn limits_link_size_before_frontend() {
        let fits = format!(
            "{SHARED_TAB_PREFIX}a{}",
            "A".repeat(MAX_SHARED_TAB_LINK - SHARED_TAB_PREFIX.len() - 1)
        );
        assert_eq!(fits.len(), MAX_SHARED_TAB_LINK);
        assert!(shared_tab_link(&fits).is_some());
        assert!(shared_tab_link(&format!("{fits}A")).is_none());
        assert!(shared_tab_link(&format!("{fits}/")).is_some());
        assert!(shared_tab_link(&"A".repeat(MAX_SHARED_TAB_LINK * 2)).is_none());
    }

    #[test]
    fn links_in_args_become_one_link_action_and_no_path() {
        let actions = actions_from_args(
            &args(&["l8db://tab/aFirst", "l8db://tab/aSecond", "l8db://evil/x"]),
            Path::new("/w"),
        );
        assert_eq!(
            actions,
            vec![OpenFileAction::Link {
                link: "l8db://tab/aFirst".into()
            }]
        );
        assert_eq!(
            serde_json::to_value(&actions[0]).unwrap(),
            serde_json::json!({ "action": "link", "link": "l8db://tab/aFirst" })
        );
    }

    #[test]
    fn rejects_link_look_alikes_with_spaces_escapes_and_fragments() {
        for rejected in [
            "l8db://tab/a b",
            " l8db://tab/abc",
            "l8db://tab/abc\n",
            "l8db://tab/a/../b",
            "l8db://tab/a%2Fb",
            "l8db://tab/a\\b",
            "l8db://tab/abc#x",
            "xl8db://tab/abc",
        ] {
            assert_eq!(shared_tab_link(rejected), None, "{rejected:?}");
        }
    }

    #[test]
    fn drops_trailing_slashes_and_folds_scheme_case() {
        assert_eq!(
            shared_tab_link("l8db://tab/abc/").as_deref(),
            Some("l8db://tab/abc")
        );
        assert_eq!(
            shared_tab_link("l8db://tab/abc//").as_deref(),
            Some("l8db://tab/abc")
        );
        assert_eq!(
            shared_tab_link("L8db://Tab/abc").as_deref(),
            Some("l8db://tab/abc")
        );
    }

    #[test]
    fn link_next_to_a_file_path_keeps_both_actions() {
        let actions = actions_from_args(
            &args(&["/w/data.sqlite", "l8db://tab/aFirst"]),
            Path::new("/w"),
        );
        assert_eq!(actions.len(), 2, "{actions:?}");
        assert!(matches!(
            actions.last(),
            Some(OpenFileAction::Link { link }) if link == "l8db://tab/aFirst"
        ));
        assert!(matches!(
            actions.first(),
            Some(OpenFileAction::Connection { .. })
        ));
    }

    #[test]
    fn app_urls_without_double_slash_never_become_paths_or_links() {
        assert_eq!(shared_tab_link("l8db:tab/abc"), None);
        assert_eq!(link_action(["l8db:tab/abc"]), None);
        assert!(actions_from_args(&args(&["l8db:tab/abc"]), Path::new("/w")).is_empty());
        assert!(paths_from_args(&args(&["l8db:tab/abc"]), Path::new("/w")).is_empty());
    }
}
