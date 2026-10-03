mod bridge;
mod byok;
#[cfg(test)]
mod byok_e2e_tests;
mod cli;
mod context;
mod integrations;
mod rpc;
mod runtime;
mod types;

pub use runtime::AiState;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;
use types::{Event, Profile, ProviderStatus, RunRequest, Skill};

pub fn new_id() -> String {
    format!("{:032x}", rand::random::<u128>())
}

pub fn relay(path: &str) {
    if bridge::relay(path).is_err() {
        eprintln!("l8db KI-MCP-Sitzung nicht verfügbar");
    }
}

pub fn is_cli(provider: &str) -> bool {
    matches!(
        provider,
        "codex" | "claude" | "gemini-cli" | "opencode" | "copilot"
    )
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Ungültige KI-ID".into());
    }
    Ok(())
}

pub fn command(profile: &Profile) -> Result<tokio::process::Command, String> {
    let default = match profile.provider.as_str() {
        "codex" => "codex",
        "claude" => "claude",
        "gemini-cli" => "gemini",
        "opencode" => "opencode",
        "copilot" => "copilot",
        _ => return Err("Unbekannte CLI".into()),
    };
    let program = if profile.binary.trim().is_empty() {
        default
    } else {
        profile.binary.trim()
    };
    let mut command = tokio::process::Command::new(program);
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    paths.extend([
        home.join(".local/bin"),
        home.join(".bun/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    if let Ok(path) = std::env::join_paths(paths) {
        command.env("PATH", path);
    }
    if !profile.home.trim().is_empty() {
        let variable = match profile.provider.as_str() { "codex" => "CODEX_HOME", "claude" => "CLAUDE_CONFIG_DIR", "gemini-cli" => "GEMINI_CLI_HOME", "copilot" => "COPILOT_HOME", _ => return Err("OpenCode verwendet seine native XDG-Konfiguration. Kein separates Home-Feld unterstützt.".into()) };
        command.env(variable, &profile.home);
    }
    command.env_remove("CLAUDECODE");
    Ok(command)
}

#[tauri::command]
pub async fn ai_environment() -> Result<Value, String> {
    let cwd = crate::mcp::config::config_dir().join("ai-workspace");
    std::fs::create_dir_all(&cwd).map_err(|_| "KI-Arbeitsordner konnte nicht erstellt werden")?;
    Ok(json!({"cwd": cwd}))
}

#[tauri::command]
pub async fn ai_status(profile: Profile) -> Result<ProviderStatus, String> {
    validate_id(&profile.id)?;
    let key_stored = crate::db::secrets::load_secret(format!("ai:{}:key", profile.id))
        .await?
        .is_some();
    if !is_cli(&profile.provider) {
        return Ok(ProviderStatus {
            provider: profile.provider,
            installed: true,
            version: None,
            key_stored,
        });
    }
    let mut command = command(&profile)?;
    command.arg("--version").kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(8), command.output()).await;
    let version = output
        .ok()
        .and_then(Result::ok)
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .chars()
                .take(160)
                .collect::<String>()
                .trim()
                .to_string()
        });
    Ok(ProviderStatus {
        provider: profile.provider,
        installed: version.is_some(),
        version,
        key_stored,
    })
}

#[tauri::command]
pub async fn ai_set_key(id: String, key: String) -> Result<(), String> {
    validate_id(&id)?;
    if key.trim().is_empty() {
        crate::db::secrets::delete_secret(format!("ai:{id}:key")).await
    } else {
        crate::db::secrets::store_secret(format!("ai:{id}:key"), key).await
    }
}

#[tauri::command]
pub async fn ai_models(profile: Profile, cwd: Option<String>) -> Result<Value, String> {
    validate_id(&profile.id)?;
    if is_cli(&profile.provider) {
        cli::models(&profile, cwd.as_deref()).await
    } else {
        byok::models(&profile).await
    }
}

fn skill_roots(cwd: &Path, profile: &Profile) -> Vec<PathBuf> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let mut roots = Vec::new();
    for base in [cwd, home.as_path()] {
        for directory in [
            ".agents/skills",
            ".codex/skills",
            ".claude/skills",
            ".gemini/skills",
            ".github/skills",
            ".copilot/skills",
            ".config/opencode/skills",
        ] {
            roots.push(base.join(directory));
        }
    }
    if !profile.home.is_empty() {
        roots.push(PathBuf::from(&profile.home).join("skills"));
    }
    roots
}

fn discover_skills(cwd: &Path, profile: &Profile) -> Vec<Skill> {
    let mut skills = HashMap::new();
    for root in skill_roots(cwd, profile) {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten().take(512) {
            let file = entry.path().join("SKILL.md");
            let Ok(path) = file.canonicalize() else {
                continue;
            };
            if !path.is_file() {
                continue;
            }
            let path = path.to_string_lossy().into_owned();
            skills.insert(
                path.clone(),
                Skill {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    path,
                },
            );
        }
    }
    let mut skills: Vec<Skill> = skills.into_values().collect();
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

#[tauri::command]
pub async fn ai_skills(cwd: String, profile: Profile) -> Vec<Skill> {
    discover_skills(Path::new(&cwd), &profile)
}

fn skill_context(request: &RunRequest) -> Result<String, String> {
    let allowed = discover_skills(Path::new(&request.cwd), &request.profile);
    let mut content = String::new();
    for path in &request.skills {
        let skill = allowed
            .iter()
            .find(|skill| &skill.path == path)
            .ok_or("Skill ist in diesem Arbeitsbereich nicht verfügbar")?;
        if std::fs::metadata(path)
            .map_err(|_| "Skill nicht lesbar")?
            .len()
            > 65_536
        {
            return Err("Skill überschreitet 64 KB".into());
        }
        let text = std::fs::read_to_string(path).map_err(|_| "Skill nicht lesbar")?;
        content.push_str(&format!(
            "\nSelected skill {} ({}):\n{}\n",
            skill.name, skill.path, text
        ));
        if content.len() > 131_072 {
            return Err("Ausgewählte Skills überschreiten 128 KB".into());
        }
    }
    Ok(content)
}

#[tauri::command]
pub async fn ai_run(
    window: tauri::Window,
    state: tauri::State<'_, Arc<AiState>>,
    pool: tauri::State<'_, crate::db::pool::PoolState>,
    request: RunRequest,
    events: Channel<Event>,
) -> Result<(), String> {
    validate_id(&request.run_id)?;
    validate_id(&request.profile.id)?;
    if request.messages.is_empty()
        || request
            .messages
            .last()
            .is_none_or(|message| message.role != "user" || message.text.trim().is_empty())
    {
        return Err("Eine Nachricht fehlt".into());
    }
    if request.messages.len() > 200
        || request
            .messages
            .iter()
            .map(|message| message.text.len())
            .sum::<usize>()
            > 512_000
        || request.connections.len() > 20
        || request.servers.len() > 20
        || request.skills.len() > 20
    {
        return Err("Sitzungskontext ist zu groß. Neues Gespräch starten.".into());
    }
    if request
        .messages
        .iter()
        .any(|message| !matches!(message.role.as_str(), "user" | "assistant"))
    {
        return Err("Ungültiger Nachrichtenverlauf".into());
    }
    let cwd = Path::new(&request.cwd)
        .canonicalize()
        .map_err(|_| "Arbeitsordner nicht verfügbar")?;
    if !cwd.is_dir() {
        return Err("Arbeitsordner ist kein Verzeichnis".into());
    }
    let config = context::scoped_config(&request, crate::mcp::config::load())?;
    let instructions = format!(
        "{}{}",
        context::instructions(&request),
        skill_context(&request)?
    );
    let key = format!("{}:{}", window.label(), request.run_id);
    let (cancel, mut cancelled) = tokio::sync::watch::channel(false);
    {
        let mut runs = state.runs.lock().map_err(|_| "KI-Lauf nicht verfügbar")?;
        if runs
            .keys()
            .any(|key| key.starts_with(&format!("{}:", window.label())))
        {
            return Err("In diesem Fenster läuft bereits eine Anfrage".into());
        }
        runs.insert(key, cancel);
    }
    let run = Arc::new(runtime::Run {
        id: request.run_id.clone(),
        owner: window.label().into(),
        plan_only: context::is_plan(&request),
        approval: request.profile.approval.clone(),
        state: state.inner().clone(),
        channel: events,
    });
    let server = Arc::new(tokio::sync::Mutex::new(crate::mcp::server::Server {
        pool: pool.inner().clone(),
        columns: HashMap::new(),
    }));
    run.emit("status", json!({"status": "running"}));
    let work = async {
        let external = integrations::connect(&request.servers, &cwd, &run).await?;
        if is_cli(&request.profile.provider) {
            let bridge =
                bridge::Bridge::start(server.clone(), config.clone(), run.clone(), external)
                    .await?;
            cli::run(&request, &instructions, &bridge, &run).await
        } else {
            byok::run(&request, &instructions, &server, &config, external, &run).await
        }
    };
    let result = tokio::select! { result = work => result, _ = cancelled.changed() => { run.emit("status", json!({"status": "cancelled"})); Ok(()) } };
    if let Err(error) = &result {
        run.emit("error", json!({"message": error}));
    }
    run.emit(
        "status",
        json!({"status": if result.is_ok() { "idle" } else { "error" }}),
    );
    run.finish();
    result
}

#[tauri::command]
pub fn ai_cancel(
    window: tauri::Window,
    state: tauri::State<'_, Arc<AiState>>,
    run_id: String,
) -> Result<(), String> {
    let runs = state.runs.lock().map_err(|_| "KI-Lauf nicht verfügbar")?;
    if let Some(cancel) = runs.get(&format!("{}:{run_id}", window.label())) {
        let _ = cancel.send(true);
    }
    Ok(())
}

#[tauri::command]
pub fn ai_approve(
    window: tauri::Window,
    state: tauri::State<'_, Arc<AiState>>,
    run_id: String,
    approval_id: String,
    allow: bool,
) -> Result<(), String> {
    let sender = state
        .approvals
        .lock()
        .map_err(|_| "Freigabe nicht verfügbar")?
        .remove(&format!("{}:{run_id}:{approval_id}", window.label()))
        .ok_or("Freigabe ist nicht mehr verfügbar")?;
    sender
        .send(json!(allow))
        .map_err(|_| "KI-Anfrage wurde beendet".into())
}

#[cfg(test)]
mod tests;

#[tauri::command]
pub fn ai_respond(
    window: tauri::Window,
    state: tauri::State<'_, Arc<AiState>>,
    run_id: String,
    approval_id: String,
    answer: Value,
) -> Result<(), String> {
    let sender = state
        .approvals
        .lock()
        .map_err(|_| "Rückfrage nicht verfügbar")?
        .remove(&format!("{}:{run_id}:{approval_id}", window.label()))
        .ok_or("Rückfrage ist nicht mehr verfügbar")?;
    sender
        .send(answer)
        .map_err(|_| "KI-Anfrage wurde beendet".into())
}

pub fn close_window(window: &tauri::Window) {
    use tauri::Manager;
    if let Some(state) = window.try_state::<Arc<AiState>>() {
        if let Ok(runs) = state.runs.lock() {
            for (key, cancel) in runs.iter() {
                if key.starts_with(&format!("{}:", window.label())) {
                    let _ = cancel.send(true);
                }
            }
        }
    }
}
