use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
};

pub const PATH: &str = "database/team.json";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    format: u8,
    pub project_id: String,
    connections: Vec<Connection>,
    pub targets: Vec<Target>,
    branches: HashMap<String, Branch>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Connection {
    id: String,
    name: String,
    kind: String,
    host: String,
    port: String,
    service: Option<String>,
    ssl_mode: String,
    requires_tunnel: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub id: String,
    pub name: String,
    pub customer: Option<String>,
    environment: Option<String>,
    pub stage: Option<String>,
    connection_ref: String,
    pub database: Option<String>,
    pub schema: String,
    pub production: bool,
    track: Option<String>,
    pinned_release: Option<String>,
    paused: Option<bool>,
    pub ledger_schema: Option<String>,
    pub expected_physical_key: Option<String>,
    require_approval: Option<bool>,
    operators: Option<Vec<String>>,
    administrators: Option<Vec<String>>,
    reviewers: Option<Vec<String>>,
}

pub async fn committed(root: &Path) -> Result<Option<String>, String> {
    let current = super::read(&super::safe_file(root, PATH)?)?;
    let files = if super::git(root, &["rev-parse", "--verify", "--quiet", "HEAD"])
        .await
        .is_ok()
    {
        super::git(root, &["ls-tree", "-r", "--name-only", "HEAD", "--", PATH]).await?
    } else {
        String::new()
    };
    let committed = if files.lines().any(|path| path == PATH) {
        Some(super::git(root, &["show", &format!("HEAD:{PATH}")]).await?)
    } else {
        None
    };
    if current != committed {
        return Err("Teamkonfiguration enthält offene Git-Änderungen. Vor der Ausführung prüfen und committen.".into());
    }
    Ok(current)
}

pub struct Verified {
    pub target: Target,
    pub team: Configuration,
}

pub async fn verify_request(request: &super::runner::Request) -> Result<Option<Verified>, String> {
    let directory = fs::canonicalize(&request.repo).map_err(|e| e.to_string())?;
    let root = std::path::PathBuf::from(
        super::git(&directory, &["rev-parse", "--show-toplevel"])
            .await?
            .trim(),
    );
    let Some(content) = committed(&root).await? else {
        return Ok(None);
    };
    let team = parse(&content)?;
    let artifact: Value =
        serde_json::from_str(&request.artifact).map_err(|_| "Freigabeartefakt ist ungültig")?;
    let target = team
        .targets
        .iter()
        .find(|target| target.id == request.target_id)
        .cloned()
        .ok_or("Rollout-Ziel fehlt in der Git-Teamkonfiguration")?;
    let c = &request.connection;
    let physical = super::seeds::physical_key(c.kind, &c.schema, &artifact["execution"]["context"]);
    if team.project_id != c.project_id
        || target.database != c.database
        || target.ledger_schema.as_deref().unwrap_or(&target.schema) != c.schema
        || artifact["teamHash"]
            != super::control::hash(content.replace("\r\n", "\n").replace('\r', "\n").trim_end())
        || target.expected_physical_key.as_deref() != Some(physical.as_str())
    {
        return Err("Rollout-Ziel, Datenbankidentität oder Teamkonfiguration wurde seit der Planung geändert.".into());
    }
    Ok(Some(Verified { target, team }))
}

pub fn verify_policy(target: &Target, policy: &Value) -> Result<(), String> {
    for (field, expected) in [
        ("production", Some(json!(target.production))),
        ("track", target.track.as_ref().map(|value| json!(value))),
        ("pinnedRelease", Some(json!(target.pinned_release))),
        ("paused", target.paused.map(|value| json!(value))),
        (
            "requireApproval",
            target.require_approval.map(|value| json!(value)),
        ),
        (
            "operators",
            target.operators.as_ref().map(|value| json!(value)),
        ),
        (
            "reviewers",
            target.reviewers.as_ref().map(|value| json!(value)),
        ),
        (
            "administrators",
            target.administrators.as_ref().map(|value| json!(value)),
        ),
    ] {
        if expected.is_some_and(|value| policy[field] != value) {
            return Err("Git-Update-Regeln und gemeinsame Datenbankregeln unterscheiden sich. Regeln vor dem Rollout abgleichen.".into());
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Branch {
    target_id: Option<String>,
    source: Option<Source>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    connection_ref: String,
    database: Option<String>,
    schema: Option<String>,
}

fn valid(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 2000 && !value.contains('\0')
}

pub fn parse(content: &str) -> Result<Configuration, String> {
    let config: Configuration = serde_json::from_str(content)
        .map_err(|_| "Ungültige Git-Teamkonfiguration. Zugangsdaten und lokale Profile sind darin nicht zulässig.")?;
    let refs: HashSet<_> = config
        .connections
        .iter()
        .map(|entry| entry.id.as_str())
        .collect();
    let ids: HashSet<_> = config
        .targets
        .iter()
        .map(|entry| entry.id.as_str())
        .collect();
    if config.format != 1
        || !valid(&config.project_id)
        || refs.len() != config.connections.len()
        || ids.len() != config.targets.len()
        || config.connections.iter().any(|entry| {
            let _ = entry.requires_tunnel;
            [&entry.id, &entry.name, &entry.kind, &entry.host]
                .iter()
                .any(|value| !valid(value))
                || ![
                    "postgres",
                    "oracle",
                    "mysql",
                    "mssql",
                    "sqlite",
                    "duckdb",
                    "clickhouse",
                ]
                .contains(&entry.kind.as_str())
                || if ["sqlite", "duckdb"].contains(&entry.kind.as_str()) {
                    !entry.port.is_empty()
                } else {
                    entry
                        .port
                        .parse::<u16>()
                        .ok()
                        .filter(|port| *port > 0)
                        .is_none()
                }
                || entry.service.as_deref().is_some_and(|value| !valid(value))
                || !["disable", "prefer", "require", "verify-ca", "verify-full"]
                    .contains(&entry.ssl_mode.as_str())
        })
        || config.targets.iter().any(|entry| {
            let _ = (entry.production, entry.paused, entry.require_approval);
            !valid(&entry.id)
                || !valid(&entry.name)
                || !valid(&entry.schema)
                || !refs.contains(entry.connection_ref.as_str())
                || entry.stage.as_deref().is_some_and(|stage| {
                    !["development", "test", "production"].contains(&stage)
                        || (stage == "production") != entry.production
                })
                || [
                    &entry.customer,
                    &entry.environment,
                    &entry.database,
                    &entry.track,
                    &entry.pinned_release,
                    &entry.ledger_schema,
                ]
                .iter()
                .any(|value| value.as_deref().is_some_and(|value| !valid(value)))
                || entry.expected_physical_key.as_deref().is_some_and(|key| {
                    key.len() != 64
                        || !key
                            .bytes()
                            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
                })
                || [&entry.operators, &entry.administrators, &entry.reviewers]
                    .iter()
                    .any(|values| {
                        values
                            .as_ref()
                            .is_some_and(|values| values.iter().any(|value| !valid(value)))
                    })
        })
        || config.branches.iter().any(|(name, entry)| {
            !valid(name)
                || entry
                    .target_id
                    .as_deref()
                    .is_some_and(|id| !ids.contains(id))
                || entry.source.as_ref().is_some_and(|source| {
                    !refs.contains(source.connection_ref.as_str())
                        || [&source.database, &source.schema]
                            .iter()
                            .any(|value| value.as_deref().is_some_and(|value| !valid(value)))
                })
        })
    {
        return Err("Ungültige Git-Teamkonfiguration oder fehlende Verbindungsreferenz.".into());
    }
    Ok(config)
}

pub fn write(
    root: &Path,
    common: &Path,
    content: &str,
    expected: Option<&str>,
) -> Result<(), String> {
    let data: Value = serde_json::from_str(content).map_err(|_| "Ungültige Zielkonfiguration")?;
    let previous: Value =
        serde_json::from_str(expected.ok_or("Erwartete Zielkonfiguration fehlt")?)
            .map_err(|_| "Ungültige erwartete Zielkonfiguration")?;
    let local = data["local"].as_str().ok_or("Lokale Zuordnung fehlt")?;
    let team = data["team"].as_str().ok_or("Git-Teamkonfiguration fehlt")?;
    let config = parse(team)?;
    let local_data: Value =
        serde_json::from_str(local).map_err(|_| "Ungültige lokale Zuordnung")?;
    if local_data["projectId"] != config.project_id || local_data["format"] != 1 {
        return Err("Lokale und gemeinsame Projektidentität unterscheiden sich.".into());
    }
    let local_path = common.join("l8db-targets.json");
    let team_path = super::safe_file(root, PATH)?;
    let local_before = super::read(&local_path)?;
    let team_before = super::read(&team_path)?;
    if previous != json!({"local": local_before, "team": team_before}) {
        return Err(
            "Teamkonfiguration oder lokale Zuordnung wurde inzwischen geändert. Bitte neu laden."
                .into(),
        );
    }
    let changed = team_before
        .as_ref()
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        != serde_json::from_str::<Value>(team).ok();
    if changed {
        super::write(&team_path, team, team_before.as_deref())?;
    }
    if let Err(error) = super::write(&local_path, local, local_before.as_deref()) {
        if changed && super::read(&team_path)?.as_deref() == Some(team) {
            match team_before {
                Some(previous) => super::write(&team_path, &previous, Some(team))?,
                None => fs::remove_file(team_path).map_err(|e| e.to_string())?,
            }
        }
        return Err(error);
    }
    Ok(())
}
