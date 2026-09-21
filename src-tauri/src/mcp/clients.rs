use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const SERVER_KEY: &str = "l8db";

#[derive(Clone, Copy, PartialEq)]
enum Format {
    Json(&'static str),
    Toml,
}

struct ClientSpec {
    id: &'static str,
    name: &'static str,
    marker: &'static str,
    config: &'static str,
    app_support: bool,
    format: Format,
}

const CLIENTS: &[ClientSpec] = &[
    ClientSpec {
        id: "claude-code",
        name: "Claude Code",
        marker: ".claude",
        config: ".claude.json",
        app_support: false,
        format: Format::Json("mcpServers"),
    },
    ClientSpec {
        id: "claude-desktop",
        name: "Claude Desktop",
        marker: "Claude",
        config: "Claude/claude_desktop_config.json",
        app_support: true,
        format: Format::Json("mcpServers"),
    },
    ClientSpec {
        id: "codex",
        name: "Codex CLI",
        marker: ".codex",
        config: ".codex/config.toml",
        app_support: false,
        format: Format::Toml,
    },
    ClientSpec {
        id: "gemini",
        name: "Gemini CLI",
        marker: ".gemini",
        config: ".gemini/settings.json",
        app_support: false,
        format: Format::Json("mcpServers"),
    },
    ClientSpec {
        id: "cursor",
        name: "Cursor",
        marker: ".cursor",
        config: ".cursor/mcp.json",
        app_support: false,
        format: Format::Json("mcpServers"),
    },
    ClientSpec {
        id: "windsurf",
        name: "Windsurf",
        marker: ".codeium/windsurf",
        config: ".codeium/windsurf/mcp_config.json",
        app_support: false,
        format: Format::Json("mcpServers"),
    },
    ClientSpec {
        id: "opencode",
        name: "opencode",
        marker: ".config/opencode",
        config: ".config/opencode/opencode.json",
        app_support: false,
        format: Format::Json("mcp"),
    },
    ClientSpec {
        id: "vscode",
        name: "VS Code",
        marker: "Code/User",
        config: "Code/User/mcp.json",
        app_support: true,
        format: Format::Json("servers"),
    },
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClient {
    pub id: String,
    pub name: String,
    pub config_path: String,
    pub installed: bool,
    pub registered: bool,
}

pub struct Paths {
    pub home: PathBuf,
    pub app_support: PathBuf,
}

impl Paths {
    pub fn system() -> Self {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let app_support = if cfg!(target_os = "macos") {
            home.join("Library/Application Support")
        } else if cfg!(target_os = "windows") {
            std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join("AppData/Roaming"))
        } else {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"))
        };
        Self { home, app_support }
    }

    fn base(&self, spec: &ClientSpec) -> &Path {
        if spec.app_support {
            &self.app_support
        } else {
            &self.home
        }
    }
}

fn spec(id: &str) -> Result<&'static ClientSpec, String> {
    CLIENTS
        .iter()
        .find(|spec| spec.id == id)
        .ok_or_else(|| format!("Unbekannter Client: {id}"))
}

fn read_json(path: &Path) -> Result<Value, String> {
    match std::fs::read(path) {
        Ok(bytes) if bytes.iter().all(u8::is_ascii_whitespace) => Ok(json!({})),
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

fn is_registered(spec: &ClientSpec, path: &Path) -> bool {
    match spec.format {
        Format::Json(key) => read_json(path)
            .ok()
            .and_then(|root| root.get(key)?.get(SERVER_KEY).cloned())
            .is_some(),
        Format::Toml => std::fs::read_to_string(path)
            .ok()
            .and_then(|text| text.parse::<toml_edit::DocumentMut>().ok())
            .and_then(|doc| doc.get("mcp_servers")?.get(SERVER_KEY).map(|_| ()))
            .is_some(),
    }
}

pub fn list(paths: &Paths) -> Vec<McpClient> {
    CLIENTS
        .iter()
        .map(|spec| {
            let base = paths.base(spec);
            let config = base.join(spec.config);
            McpClient {
                id: spec.id.into(),
                name: spec.name.into(),
                config_path: config.display().to_string(),
                installed: base.join(spec.marker).exists() || config.exists(),
                registered: is_registered(spec, &config),
            }
        })
        .collect()
}

fn write_with_backup(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    if path.exists() {
        let backup = path.with_extension(format!(
            "{}.bak",
            path.extension().and_then(|ext| ext.to_str()).unwrap_or("")
        ));
        std::fs::copy(path, &backup).map_err(|e| format!("Backup {}: {e}", backup.display()))?;
    }
    std::fs::write(path, content).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn register(paths: &Paths, id: &str, on: bool, exe: &Path) -> Result<(), String> {
    let spec = spec(id)?;
    let path = paths.base(spec).join(spec.config);
    let command = exe.display().to_string();
    match spec.format {
        Format::Json(key) => {
            let mut root = read_json(&path)?;
            if !root.is_object() {
                return Err(format!("{} ist kein JSON-Objekt", path.display()));
            }
            let servers = root
                .as_object_mut()
                .unwrap()
                .entry(key)
                .or_insert_with(|| json!({}));
            if !servers.is_object() {
                *servers = json!({});
            }
            let servers = servers.as_object_mut().unwrap();
            if on {
                let mut entry = if spec.id == "opencode" {
                    json!({"type": "local", "command": [command, "--mcp"], "enabled": true})
                } else {
                    json!({"command": command, "args": ["--mcp"]})
                };
                if spec.id == "vscode" {
                    entry["type"] = json!("stdio");
                }
                servers.insert(SERVER_KEY.into(), entry);
            } else {
                servers.remove(SERVER_KEY);
            }
            let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
            write_with_backup(&path, format!("{text}\n").as_bytes())
        }
        Format::Toml => {
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let mut doc = text
                .parse::<toml_edit::DocumentMut>()
                .map_err(|e| format!("{}: {e}", path.display()))?;
            if on {
                let mut table = toml_edit::Table::new();
                table["command"] = toml_edit::value(command);
                let mut args = toml_edit::Array::new();
                args.push("--mcp");
                table["args"] = toml_edit::value(args);
                if doc.get("mcp_servers").is_none() {
                    let mut parent = toml_edit::Table::new();
                    parent.set_implicit(true);
                    doc["mcp_servers"] = toml_edit::Item::Table(parent);
                }
                doc["mcp_servers"][SERVER_KEY] = toml_edit::Item::Table(table);
            } else if let Some(servers) = doc
                .get_mut("mcp_servers")
                .and_then(|item| item.as_table_mut())
            {
                servers.remove(SERVER_KEY);
            }
            write_with_backup(&path, doc.to_string().as_bytes())
        }
    }
}

pub fn current_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("Programmpfad unbekannt: {e}"))
}

#[tauri::command]
pub fn mcp_clients() -> Vec<McpClient> {
    list(&Paths::system())
}

#[tauri::command]
pub fn mcp_register(id: String, on: bool) -> Result<Vec<McpClient>, String> {
    let paths = Paths::system();
    register(&paths, &id, on, &current_exe()?)?;
    Ok(list(&paths))
}

#[tauri::command]
pub fn mcp_server_command() -> Result<String, String> {
    Ok(format!("{} --mcp", current_exe()?.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths() -> Paths {
        let root = std::env::temp_dir().join(format!(
            "l8db-clients-{}-{}",
            std::process::id(),
            rand_suffix()
        ));
        std::fs::create_dir_all(&root).unwrap();
        Paths {
            home: root.join("home"),
            app_support: root.join("support"),
        }
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }

    #[test]
    fn detects_installed_and_registers_json_clients() {
        let paths = temp_paths();
        std::fs::create_dir_all(paths.home.join(".claude")).unwrap();
        std::fs::write(
            paths.home.join(".claude.json"),
            r#"{"numStartups": 3, "mcpServers": {"other": {"command": "x"}}}"#,
        )
        .unwrap();
        let before = list(&paths);
        let claude = before.iter().find(|c| c.id == "claude-code").unwrap();
        assert!(claude.installed && !claude.registered);
        assert!(!before.iter().find(|c| c.id == "cursor").unwrap().installed);

        register(
            &paths,
            "claude-code",
            true,
            Path::new("/Applications/l8db.app/Contents/MacOS/l8db"),
        )
        .unwrap();
        let root: Value = serde_json::from_str(
            &std::fs::read_to_string(paths.home.join(".claude.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(root["numStartups"], 3);
        assert_eq!(root["mcpServers"]["other"]["command"], "x");
        assert_eq!(
            root["mcpServers"]["l8db"]["command"],
            "/Applications/l8db.app/Contents/MacOS/l8db"
        );
        assert_eq!(root["mcpServers"]["l8db"]["args"][0], "--mcp");
        assert!(paths.home.join(".claude.json.bak").exists());
        assert!(
            list(&paths)
                .iter()
                .find(|c| c.id == "claude-code")
                .unwrap()
                .registered
        );

        register(&paths, "claude-code", false, Path::new("/x")).unwrap();
        let root: Value = serde_json::from_str(
            &std::fs::read_to_string(paths.home.join(".claude.json")).unwrap(),
        )
        .unwrap();
        assert!(root["mcpServers"].get("l8db").is_none());
        assert_eq!(root["mcpServers"]["other"]["command"], "x");

        register(&paths, "vscode", true, Path::new("/x")).unwrap();
        let root: Value = serde_json::from_str(
            &std::fs::read_to_string(paths.app_support.join("Code/User/mcp.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(root["servers"]["l8db"]["type"], "stdio");
        register(&paths, "opencode", true, Path::new("/opt/l8db")).unwrap();
        let root: Value = serde_json::from_str(
            &std::fs::read_to_string(paths.home.join(".config/opencode/opencode.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(root["mcp"]["l8db"]["type"], "local");
        assert_eq!(root["mcp"]["l8db"]["command"][0], "/opt/l8db");
        assert_eq!(root["mcp"]["l8db"]["command"][1], "--mcp");
        assert_eq!(root["mcp"]["l8db"]["enabled"], true);
        assert!(
            list(&paths)
                .iter()
                .find(|c| c.id == "opencode")
                .unwrap()
                .registered
        );
        register(&paths, "cursor", true, Path::new("/x")).unwrap();
        assert!(paths.home.join(".cursor/mcp.json").exists());
    }

    #[test]
    fn registers_codex_toml_preserving_content() {
        let paths = temp_paths();
        std::fs::create_dir_all(paths.home.join(".codex")).unwrap();
        std::fs::write(
            paths.home.join(".codex/config.toml"),
            "# my config\nmodel = \"o3\"\n\n[mcp_servers.other]\ncommand = \"y\"\n",
        )
        .unwrap();
        register(&paths, "codex", true, Path::new("/opt/l8db")).unwrap();
        let text = std::fs::read_to_string(paths.home.join(".codex/config.toml")).unwrap();
        assert!(text.contains("# my config"));
        assert!(text.contains("model = \"o3\""));
        assert!(text.contains("[mcp_servers.other]"));
        assert!(text.contains("[mcp_servers.l8db]"));
        assert!(text.contains("command = \"/opt/l8db\""));
        assert!(text.contains("args = [\"--mcp\"]"));
        assert!(
            list(&paths)
                .iter()
                .find(|c| c.id == "codex")
                .unwrap()
                .registered
        );
        register(&paths, "codex", false, Path::new("/opt/l8db")).unwrap();
        let text = std::fs::read_to_string(paths.home.join(".codex/config.toml")).unwrap();
        assert!(!text.contains("l8db"));
        assert!(text.contains("[mcp_servers.other]"));

        std::fs::remove_file(paths.home.join(".codex/config.toml")).unwrap();
        register(&paths, "codex", true, Path::new("/opt/l8db")).unwrap();
        let text = std::fs::read_to_string(paths.home.join(".codex/config.toml")).unwrap();
        assert!(
            text.trim_start().starts_with("[mcp_servers.l8db]"),
            "{text}"
        );
    }

    #[test]
    fn rejects_unknown_client_and_broken_json() {
        let paths = temp_paths();
        assert!(register(&paths, "nope", true, Path::new("/x")).is_err());
        std::fs::create_dir_all(&paths.home).unwrap();
        std::fs::write(paths.home.join(".gemini"), "").ok();
        std::fs::remove_file(paths.home.join(".gemini")).ok();
        std::fs::create_dir_all(paths.home.join(".gemini")).unwrap();
        std::fs::write(paths.home.join(".gemini/settings.json"), "{broken").unwrap();
        assert!(register(&paths, "gemini", true, Path::new("/x")).is_err());
        assert_eq!(
            std::fs::read_to_string(paths.home.join(".gemini/settings.json")).unwrap(),
            "{broken"
        );
    }
}
