use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};

use crate::automation::model::{
    Action, AiActivity, AlertState, AutomationConnection, AutomationSettings, ChannelRef, Flow,
    ImportReport, LogLevel, LogLine, Retention, RunDetail, RunFilter, RunOutput, RunStatus,
    RunSummary, Step, StepRun, Task, TaskExportFile, TaskState, TaskStats, TaskSummary,
    TriggerKind, VariableKind, EXPORT_FORMAT,
};
use crate::automation::runtime::{new_id, now, rfc3339, StartError};

const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE task_state (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  next_run_at TEXT,
  last_run_at TEXT,
  last_run_id TEXT,
  last_status TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,
  schedule_marks TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  trigger_detail TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  error TEXT,
  environment TEXT,
  rerun_of TEXT,
  parent_run_id TEXT,
  steps_total INTEGER NOT NULL,
  steps_done INTEGER NOT NULL DEFAULT 0,
  vars_json TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  pid INTEGER NOT NULL
);
CREATE INDEX runs_task_started ON runs(task_id, started_at DESC);
CREATE INDEX runs_started ON runs(started_at DESC);
CREATE TABLE run_steps (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE run_logs (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  at TEXT NOT NULL,
  level TEXT NOT NULL,
  step_id TEXT,
  message TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE run_outputs (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  path TEXT NOT NULL,
  bytes INTEGER,
  format TEXT NOT NULL
);
CREATE TABLE alerts (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (task_id, step_id)
);
CREATE TABLE leases (
  task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  pid INTEGER NOT NULL,
  heartbeat_at TEXT NOT NULL
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
"#];

pub const NEWER_SCHEMA: &str =
    "Die Automatisierungsdatenbank stammt von einer neueren l8db-Version.";
pub const INTERRUPTED: &str = "Lauf wurde unterbrochen (App oder Prozess beendet).";
const REVISION_CONFLICT: &str =
    "Der Task wurde inzwischen geändert (z. B. in einem anderen Fenster). Lade ihn neu.";
const LEASE_SECONDS: i64 = 90;
const MAX_LOG_LINES: i64 = 5_000;
const MAX_LOG_CHARS: usize = 4_000;
const TRUNCATED_SEQ: u32 = u32::MAX;
const SETTINGS_KEY: &str = "settings";
const CONNECTIONS_HASH_KEY: &str = "connections_hash";
const ACTIVITY_KEY: &str = "ai_activity";
const MAX_ACTIVITY: usize = 50;
const RUN_COLUMNS: &str = "id, task_id, task_name, trigger, trigger_detail, status, started_at, finished_at, duration_ms, error, environment, rerun_of, parent_run_id, steps_total, steps_done, (SELECT COUNT(*) FROM run_outputs o WHERE o.run_id = runs.id)";

pub struct Store {
    connection: Arc<Mutex<Connection>>,
    path: PathBuf,
}

fn sql_error(error: rusqlite::Error) -> String {
    format!("Automatisierungsdatenbank: {error}")
}

fn json_error(error: serde_json::Error) -> String {
    format!("Automatisierungsdatenbank: ungültige Daten ({error})")
}

fn enum_text<T: serde::Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(text)) => text,
        _ => String::new(),
    }
}

fn enum_parse<T: serde::de::DeserializeOwned + Default>(text: &str) -> T {
    serde_json::from_value(serde_json::Value::String(text.to_string())).unwrap_or_default()
}

fn lease_threshold() -> String {
    rfc3339(Utc::now() - chrono::Duration::seconds(LEASE_SECONDS))
}

fn read_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunSummary> {
    Ok(RunSummary {
        id: row.get(0)?,
        task_id: row.get(1)?,
        task_name: row.get(2)?,
        trigger: enum_parse::<TriggerKind>(&row.get::<_, String>(3)?),
        trigger_detail: row.get(4)?,
        status: enum_parse::<RunStatus>(&row.get::<_, String>(5)?),
        started_at: row.get(6)?,
        finished_at: row.get(7)?,
        duration_ms: row
            .get::<_, Option<i64>>(8)?
            .map(|value| value.max(0) as u64),
        error: row.get(9)?,
        environment: row.get(10)?,
        rerun_of: row.get(11)?,
        parent_run_id: row.get(12)?,
        steps_total: row.get(13)?,
        steps_done: row.get(14)?,
        outputs: row.get(15)?,
    })
}

fn read_state(conn: &Connection, task_id: &str) -> Result<TaskState, String> {
    conn.query_row(
        "SELECT next_run_at, last_run_at, last_run_id, last_status, consecutive_failures, disabled_reason FROM task_state WHERE task_id = ?1",
        [task_id],
        |row| {
            Ok(TaskState {
                task_id: task_id.to_string(),
                next_run_at: row.get(0)?,
                last_run_at: row.get(1)?,
                last_run_id: row.get(2)?,
                last_status: row
                    .get::<_, Option<String>>(3)?
                    .map(|status| enum_parse::<RunStatus>(&status)),
                consecutive_failures: row.get(4)?,
                disabled_reason: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(sql_error)
    .map(|state| {
        state.unwrap_or_else(|| TaskState {
            task_id: task_id.to_string(),
            ..TaskState::default()
        })
    })
}

fn read_task(conn: &Connection, id: &str) -> Result<Option<Task>, String> {
    let json: Option<String> = conn
        .query_row("SELECT json FROM tasks WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(sql_error)?;
    json.map(|json| serde_json::from_str(&json).map_err(json_error))
        .transpose()
}

fn read_tasks(conn: &Connection) -> Result<Vec<Task>, String> {
    let mut statement = conn.prepare("SELECT json FROM tasks").map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(sql_error)?;
    let mut tasks = Vec::new();
    for json in rows {
        tasks.push(serde_json::from_str(&json.map_err(sql_error)?).map_err(json_error)?);
    }
    Ok(tasks)
}

fn write_task(conn: &Connection, task: &Task) -> Result<(), String> {
    let json = serde_json::to_string(task).map_err(json_error)?;
    conn.execute(
        "INSERT INTO tasks (id, name, json, revision, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json, revision = excluded.revision, updated_at = excluded.updated_at",
        params![task.id, task.name, json, task.revision as i64, task.updated_at],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            format!("Ein Task mit dem Namen „{}“ existiert bereits.", task.name)
        }
        other => sql_error(other),
    })?;
    conn.execute(
        "INSERT OR IGNORE INTO task_state (task_id) VALUES (?1)",
        [&task.id],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn read_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT json FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(sql_error)
}

fn write_setting(conn: &Connection, key: &str, json: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, json) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET json = excluded.json",
        params![key, json],
    )
    .map_err(sql_error)?;
    Ok(())
}

fn truncate(message: &str) -> String {
    if message.chars().count() <= MAX_LOG_CHARS {
        return message.to_string();
    }
    let mut cut: String = message.chars().take(MAX_LOG_CHARS).collect();
    cut.push('…');
    cut
}

fn existing_names(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut statement = conn.prepare("SELECT name FROM tasks").map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(sql_error)?;
    rows.map(|name| name.map(|name| name.to_lowercase()).map_err(sql_error))
        .collect()
}

pub fn unique_name(base: &str, suffix: &str, taken: &HashSet<String>) -> String {
    let mut candidate = format!("{base} ({suffix})");
    let mut index = 2;
    while taken.contains(&candidate.to_lowercase()) {
        candidate = format!("{base} ({suffix} {index})");
        index += 1;
    }
    candidate
}

fn collect_step_ids(steps: &mut [Step], ids: &mut HashMap<String, String>) {
    for step in steps {
        let fresh = new_id();
        ids.insert(step.id.clone(), fresh.clone());
        step.id = fresh;
        if let Action::Loop { steps, .. } = &mut step.action {
            collect_step_ids(steps, ids);
        }
    }
}

fn remap_flow(flow: &mut Flow, ids: &HashMap<String, String>) {
    if let Flow::Goto { step_id } = flow {
        if let Some(fresh) = ids.get(step_id) {
            *step_id = fresh.clone();
        }
    }
}

fn remap_steps(steps: &mut [Step], ids: &HashMap<String, String>) {
    for step in steps {
        remap_flow(&mut step.on_success, ids);
        remap_flow(&mut step.on_failure, ids);
        match &mut step.action {
            Action::Condition {
                then, otherwise, ..
            } => {
                remap_flow(then, ids);
                remap_flow(otherwise, ids);
            }
            Action::Loop { steps, .. } => remap_steps(steps, ids),
            _ => {}
        }
    }
}

pub fn renew_ids(task: &mut Task) {
    task.id = new_id();
    let mut ids = HashMap::new();
    collect_step_ids(&mut task.steps, &mut ids);
    remap_steps(&mut task.steps, &ids);
    for schedule in &mut task.schedules {
        schedule.id = new_id();
    }
    for rule in &mut task.notifications {
        rule.id = new_id();
    }
    task.revision = 0;
    task.created_at = String::new();
    task.updated_at = String::new();
}

fn risky_steps(steps: &[Step]) -> bool {
    steps.iter().any(|step| match &step.action {
        Action::Shell { .. }
        | Action::Http { .. }
        | Action::FileDelete { .. }
        | Action::Cleanup { .. }
        | Action::Restore { .. }
        | Action::RunTask { .. } => true,
        Action::Notify { channel, .. } => !matches!(channel, ChannelRef::Native),
        Action::Loop { steps, .. } => risky_steps(steps),
        _ => false,
    })
}

pub fn requires_review(task: &Task) -> bool {
    !task.schedules.is_empty()
        || risky_steps(&task.steps)
        || task
            .notifications
            .iter()
            .any(|rule| matches!(rule.channel, ChannelRef::Email { .. }))
}

pub fn export_file(mut tasks: Vec<Task>) -> TaskExportFile {
    for task in &mut tasks {
        for variable in &mut task.variables {
            if variable.kind == VariableKind::Secret {
                variable.default_value.clear();
            }
        }
    }
    TaskExportFile {
        format: EXPORT_FORMAT,
        exported_at: now(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        tasks,
    }
}

pub fn parse_import(bytes: &[u8]) -> Result<Vec<Task>, String> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("Die Datei ist kein gültiges JSON: {error}"))?;
    if value.get("tasks").is_some() {
        let format = value.get("format").and_then(|f| f.as_u64()).unwrap_or(0);
        if format > EXPORT_FORMAT as u64 {
            return Err("Die Datei stammt von einer neueren l8db-Version.".into());
        }
        let file: TaskExportFile = serde_json::from_value(value)
            .map_err(|error| format!("Die Datei enthält keine gültigen Tasks: {error}"))?;
        return Ok(file.tasks);
    }
    serde_json::from_value::<Task>(value)
        .map(|task| vec![task])
        .map_err(|error| format!("Die Datei enthält keinen gültigen Task: {error}"))
}

fn stamp_task(conn: &Connection, task: &mut Task, expected: Option<u64>) -> Result<(), String> {
    if task.id.trim().is_empty() {
        task.id = new_id();
    }
    task.name = task.name.trim().to_string();
    if task.name.is_empty() {
        return Err("Der Task braucht einen Namen.".into());
    }
    let current: Option<(i64, String)> = conn
        .query_row(
            "SELECT revision, json FROM tasks WHERE id = ?1",
            [&task.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(sql_error)?;
    let stamp = now();
    match current {
        Some((revision, json)) => {
            if expected != Some(revision as u64) {
                return Err(REVISION_CONFLICT.into());
            }
            let stored: Task = serde_json::from_str(&json).map_err(json_error)?;
            task.revision = revision as u64 + 1;
            task.created_at = if stored.created_at.is_empty() {
                stamp.clone()
            } else {
                stored.created_at
            };
        }
        None => {
            task.revision = 1;
            if task.created_at.is_empty() {
                task.created_at = stamp.clone();
            }
        }
    }
    task.updated_at = stamp;
    Ok(())
}

fn migrate(conn: &mut Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(sql_error)?;
    if version > MIGRATIONS.len() as i64 {
        return Err(NEWER_SCHEMA.into());
    }
    conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get::<_, String>(0))
        .map_err(sql_error)?;
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;")
        .map_err(sql_error)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    let version: i64 = tx
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(sql_error)?;
    if version > MIGRATIONS.len() as i64 {
        return Err(NEWER_SCHEMA.into());
    }
    if version == MIGRATIONS.len() as i64 {
        return Ok(());
    }
    for migration in &MIGRATIONS[version.max(0) as usize..] {
        tx.execute_batch(migration).map_err(sql_error)?;
    }
    tx.pragma_update(None, "user_version", MIGRATIONS.len() as i64)
        .map_err(sql_error)?;
    tx.commit().map_err(sql_error)
}

impl Store {
    pub fn open_default() -> Result<Self, String> {
        let path = match std::env::var_os("L8DB_AUTOMATION_DB") {
            Some(path) => {
                let path = PathBuf::from(path);
                if !path.is_absolute() {
                    return Err("L8DB_AUTOMATION_DB muss ein absoluter Pfad sein.".into());
                }
                path
            }
            None => crate::mcp::config::config_dir().join("automation.db"),
        };
        Self::open(&path)
    }

    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Ordner {} konnte nicht angelegt werden: {error}",
                    parent.display()
                )
            })?;
        }
        let mut conn = Connection::open(path).map_err(sql_error)?;
        crate::mcp::config::restrict(path);
        conn.busy_timeout(Duration::from_millis(5_000))
            .map_err(sql_error)?;
        let mut attempt = 0;
        while let Err(error) = migrate(&mut conn) {
            attempt += 1;
            if attempt >= 100 || !error.contains("database is locked") {
                return Err(error);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Ok(Store {
            connection: Arc::new(Mutex::new(conn)),
            path: path.to_path_buf(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    async fn call<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, String> + Send + 'static,
    {
        let connection = self.connection.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = connection
                .lock()
                .map_err(|_| "Automatisierungsdatenbank ist gesperrt.".to_string())?;
            f(&mut conn)
        })
        .await
        .map_err(|error| format!("Automatisierungsdatenbank: {error}"))?
    }

    async fn write<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    {
        self.call(move |conn| {
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(sql_error)?;
            let value = f(&tx)?;
            tx.commit().map_err(sql_error)?;
            Ok(value)
        })
        .await
    }

    pub async fn list_tasks(&self) -> Result<Vec<TaskSummary>, String> {
        self.call(|conn| {
            let tasks = read_tasks(conn)?;
            let threshold = lease_threshold();
            let mut running: HashMap<String, String> = HashMap::new();
            {
                let mut statement = conn
                    .prepare("SELECT task_id, run_id FROM leases WHERE heartbeat_at >= ?1")
                    .map_err(sql_error)?;
                let rows = statement
                    .query_map([&threshold], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map_err(sql_error)?;
                for row in rows {
                    let (task, run): (String, String) = row.map_err(sql_error)?;
                    running.insert(task, run);
                }
            }
            let mut history: HashMap<String, Vec<(RunStatus, Option<i64>)>> = HashMap::new();
            {
                let mut statement = conn
                    .prepare(
                        "SELECT task_id, status, duration_ms FROM (
                           SELECT task_id, status, duration_ms,
                                  ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY started_at DESC) AS position
                           FROM runs WHERE status NOT IN ('running', 'skipped')
                         ) WHERE position <= 50",
                    )
                    .map_err(sql_error)?;
                let rows = statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<i64>>(2)?,
                        ))
                    })
                    .map_err(sql_error)?;
                for row in rows {
                    let (task, status, duration) = row.map_err(sql_error)?;
                    history
                        .entry(task)
                        .or_default()
                        .push((enum_parse(&status), duration));
                }
            }
            let mut alerts: HashMap<String, Vec<AlertState>> = HashMap::new();
            {
                let mut statement = conn
                    .prepare("SELECT task_id, json FROM alerts ORDER BY step_id")
                    .map_err(sql_error)?;
                let rows = statement
                    .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                    .map_err(sql_error)?;
                for row in rows {
                    let (task, json) = row.map_err(sql_error)?;
                    alerts
                        .entry(task)
                        .or_default()
                        .push(serde_json::from_str(&json).map_err(json_error)?);
                }
            }
            let mut summaries = Vec::with_capacity(tasks.len());
            for task in tasks {
                let runs = history.remove(&task.id).unwrap_or_default();
                let successes = runs
                    .iter()
                    .filter(|(status, _)| matches!(status, RunStatus::Success | RunStatus::Warning))
                    .count();
                let durations: Vec<i64> = runs.iter().filter_map(|(_, duration)| *duration).collect();
                let stats = TaskStats {
                    runs: runs.len() as u32,
                    success_rate: (!runs.is_empty())
                        .then(|| successes as f64 / runs.len() as f64),
                    average_ms: (!durations.is_empty()).then(|| {
                        (durations.iter().sum::<i64>() / durations.len() as i64).max(0) as u64
                    }),
                };
                summaries.push(TaskSummary {
                    state: read_state(conn, &task.id)?,
                    running_run_id: running.remove(&task.id),
                    alerts: alerts.remove(&task.id).unwrap_or_default(),
                    stats,
                    task,
                });
            }
            summaries.sort_by_key(|summary| {
                (
                    summary.task.folder.to_lowercase(),
                    summary.task.name.to_lowercase(),
                )
            });
            Ok(summaries)
        })
        .await
    }

    pub async fn all_tasks(&self) -> Result<Vec<Task>, String> {
        self.call(|conn| read_tasks(conn)).await
    }

    pub async fn get_task(&self, id: &str) -> Result<Option<Task>, String> {
        let id = id.to_string();
        self.call(move |conn| read_task(conn, &id)).await
    }

    pub async fn find_task(&self, id_or_name: &str) -> Result<Task, StartError> {
        let reference = id_or_name.trim().to_string();
        self.call(move |conn| {
            if let Some(task) = read_task(conn, &reference)? {
                return Ok(Ok(task));
            }
            let mut statement = conn
                .prepare("SELECT json FROM tasks WHERE name = ?1 COLLATE NOCASE")
                .map_err(sql_error)?;
            let rows: Vec<String> = statement
                .query_map([&reference], |row| row.get(0))
                .map_err(sql_error)?
                .collect::<Result<_, _>>()
                .map_err(sql_error)?;
            Ok(match rows.as_slice() {
                [json] => Ok(serde_json::from_str(json).map_err(json_error)?),
                [] => Err(StartError::NotFound(reference.clone())),
                _ => Err(StartError::Ambiguous(reference.clone())),
            })
        })
        .await
        .map_err(StartError::Store)?
    }

    pub async fn save_task(
        &self,
        task: Task,
        expected_revision: Option<u64>,
    ) -> Result<Task, String> {
        self.write(move |conn| {
            let mut task = task;
            stamp_task(conn, &mut task, expected_revision)?;
            write_task(conn, &task)?;
            Ok(task)
        })
        .await
    }

    pub async fn duplicate_task(&self, id: &str) -> Result<Task, String> {
        let id = id.to_string();
        self.write(move |conn| {
            let mut task = read_task(conn, &id)?.ok_or("Task nicht gefunden.")?;
            let taken = existing_names(conn)?;
            let base = task.name.clone();
            renew_ids(&mut task);
            task.name = unique_name(&base, "Kopie", &taken);
            task.enabled = false;
            task.needs_review = false;
            stamp_task(conn, &mut task, None)?;
            write_task(conn, &task)?;
            Ok(task)
        })
        .await
    }

    pub async fn import_tasks(&self, tasks: Vec<Task>) -> Result<ImportReport, String> {
        self.write(move |conn| {
            let mut taken = existing_names(conn)?;
            let mut report = ImportReport {
                imported: Vec::new(),
                renamed: Vec::new(),
                needs_review: Vec::new(),
            };
            for mut task in tasks {
                renew_ids(&mut task);
                task.name = task.name.trim().to_string();
                if taken.contains(&task.name.to_lowercase()) {
                    task.name = unique_name(&task.name, "importiert", &taken);
                    report.renamed.push(task.name.clone());
                }
                if task.needs_review || requires_review(&task) {
                    task.enabled = false;
                    task.needs_review = true;
                    report.needs_review.push(task.name.clone());
                }
                stamp_task(conn, &mut task, None)?;
                write_task(conn, &task)?;
                taken.insert(task.name.to_lowercase());
                report.imported.push(task.name.clone());
            }
            Ok(report)
        })
        .await
    }

    pub async fn delete_tasks(&self, ids: &[String]) -> Result<(), String> {
        let ids = ids.to_vec();
        self.write(move |conn| {
            for id in &ids {
                conn.execute("DELETE FROM tasks WHERE id = ?1", [id])
                    .map_err(sql_error)?;
                conn.execute("DELETE FROM leases WHERE task_id = ?1", [id])
                    .map_err(sql_error)?;
            }
            Ok(())
        })
        .await
    }

    pub async fn set_enabled(
        &self,
        id: &str,
        enabled: bool,
        reason: Option<String>,
    ) -> Result<(), String> {
        let id = id.to_string();
        self.write(move |conn| {
            let mut task = read_task(conn, &id)?.ok_or("Task nicht gefunden.")?;
            task.enabled = enabled;
            task.revision += 1;
            task.updated_at = now();
            write_task(conn, &task)?;
            let updated = if enabled {
                conn.execute(
                    "UPDATE task_state SET consecutive_failures = 0, disabled_reason = NULL WHERE task_id = ?1",
                    [&id],
                )
            } else {
                conn.execute(
                    "UPDATE task_state SET disabled_reason = ?2 WHERE task_id = ?1",
                    params![id, reason],
                )
            };
            updated.map_err(sql_error)?;
            Ok(())
        })
        .await
    }

    pub async fn connections(&self) -> Result<Vec<AutomationConnection>, String> {
        self.call(|conn| {
            let mut statement = conn
                .prepare("SELECT json FROM connections ORDER BY id")
                .map_err(sql_error)?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(sql_error)?;
            let mut list = Vec::new();
            for json in rows {
                list.push(serde_json::from_str(&json.map_err(sql_error)?).map_err(json_error)?);
            }
            Ok(list)
        })
        .await
    }

    pub async fn replace_connections(
        &self,
        connections: Vec<AutomationConnection>,
    ) -> Result<Vec<String>, String> {
        self.write(move |conn| {
            let json = serde_json::to_string(&connections).map_err(json_error)?;
            let digest: String = Sha256::digest(json.as_bytes())
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            let hash = format!("\"{digest}\"");
            if read_setting(conn, CONNECTIONS_HASH_KEY)?.as_deref() == Some(hash.as_str()) {
                return Ok(Vec::new());
            }
            let mut old: BTreeMap<String, String> = BTreeMap::new();
            {
                let mut statement = conn
                    .prepare("SELECT id, json FROM connections")
                    .map_err(sql_error)?;
                let rows = statement
                    .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map_err(sql_error)?;
                for row in rows {
                    let (id, json): (String, String) = row.map_err(sql_error)?;
                    old.insert(id, json);
                }
            }
            conn.execute("DELETE FROM connections", [])
                .map_err(sql_error)?;
            let stamp = now();
            let mut fresh: BTreeMap<String, String> = BTreeMap::new();
            for connection in &connections {
                let json = serde_json::to_string(connection).map_err(json_error)?;
                conn.execute(
                    "INSERT OR REPLACE INTO connections (id, json, updated_at) VALUES (?1, ?2, ?3)",
                    params![connection.id, json, stamp],
                )
                .map_err(sql_error)?;
                fresh.insert(connection.id.clone(), json);
            }
            write_setting(conn, CONNECTIONS_HASH_KEY, &hash)?;
            Ok(old
                .into_iter()
                .filter(|(id, json)| fresh.get(id) != Some(json))
                .map(|(id, _)| id)
                .collect())
        })
        .await
    }

    pub async fn settings(&self) -> Result<AutomationSettings, String> {
        self.call(|conn| match read_setting(conn, SETTINGS_KEY)? {
            Some(json) => serde_json::from_str(&json).map_err(json_error),
            None => Ok(AutomationSettings::default()),
        })
        .await
    }

    pub async fn save_settings(&self, settings: &AutomationSettings) -> Result<(), String> {
        let json = serde_json::to_string(settings).map_err(json_error)?;
        self.write(move |conn| write_setting(conn, SETTINGS_KEY, &json))
            .await
    }

    pub async fn take_lease(&self, task_id: &str, run_id: &str) -> Result<bool, String> {
        let (task_id, run_id) = (task_id.to_string(), run_id.to_string());
        self.write(move |conn| {
            let changed = conn
                .execute(
                    "INSERT INTO leases (task_id, run_id, pid, heartbeat_at) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(task_id) DO UPDATE SET run_id = excluded.run_id, pid = excluded.pid, heartbeat_at = excluded.heartbeat_at
                     WHERE leases.heartbeat_at < ?5",
                    params![task_id, run_id, std::process::id(), now(), lease_threshold()],
                )
                .map_err(sql_error)?;
            Ok(changed == 1)
        })
        .await
    }

    pub async fn renew_lease(&self, task_id: &str, run_id: &str) -> Result<(), String> {
        let (task_id, run_id) = (task_id.to_string(), run_id.to_string());
        self.write(move |conn| {
            conn.execute(
                "UPDATE leases SET heartbeat_at = ?3 WHERE task_id = ?1 AND run_id = ?2",
                params![task_id, run_id, now()],
            )
            .map_err(sql_error)?;
            Ok(())
        })
        .await
    }

    pub async fn release_lease(&self, task_id: &str, run_id: &str) -> Result<(), String> {
        let (task_id, run_id) = (task_id.to_string(), run_id.to_string());
        self.write(move |conn| {
            conn.execute(
                "DELETE FROM leases WHERE task_id = ?1 AND run_id = ?2",
                params![task_id, run_id],
            )
            .map_err(sql_error)?;
            Ok(())
        })
        .await
    }

    pub async fn running_run(&self, task_id: &str) -> Result<Option<String>, String> {
        let task_id = task_id.to_string();
        self.call(move |conn| {
            conn.query_row(
                "SELECT run_id FROM leases WHERE task_id = ?1 AND heartbeat_at >= ?2",
                params![task_id, lease_threshold()],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql_error)
        })
        .await
    }

    pub async fn insert_run(
        &self,
        run: &RunSummary,
        vars: &BTreeMap<String, String>,
        definition: &Task,
    ) -> Result<(), String> {
        let run = run.clone();
        let vars = serde_json::to_string(vars).map_err(json_error)?;
        let definition = serde_json::to_string(definition).map_err(json_error)?;
        self.write(move |conn| {
            conn.execute(
                "INSERT INTO runs (id, task_id, task_name, trigger, trigger_detail, status, started_at, finished_at, duration_ms, error, environment, rerun_of, parent_run_id, steps_total, steps_done, vars_json, definition_json, pid)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    run.id,
                    run.task_id,
                    run.task_name,
                    enum_text(&run.trigger),
                    run.trigger_detail,
                    enum_text(&run.status),
                    run.started_at,
                    run.finished_at,
                    run.duration_ms.map(|value| value as i64),
                    run.error,
                    run.environment,
                    run.rerun_of,
                    run.parent_run_id,
                    run.steps_total,
                    run.steps_done,
                    vars,
                    definition,
                    std::process::id(),
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
        .await
    }

    pub async fn update_run(&self, run: &RunSummary) -> Result<(), String> {
        let run = run.clone();
        self.write(move |conn| {
            conn.execute(
                "UPDATE runs SET status = ?2, finished_at = ?3, duration_ms = ?4, error = ?5, environment = ?6, trigger_detail = ?7, steps_total = ?8, steps_done = ?9 WHERE id = ?1",
                params![
                    run.id,
                    enum_text(&run.status),
                    run.finished_at,
                    run.duration_ms.map(|value| value as i64),
                    run.error,
                    run.environment,
                    run.trigger_detail,
                    run.steps_total,
                    run.steps_done,
                ],
            )
            .map_err(sql_error)?;
            Ok(())
        })
        .await
    }

    pub async fn upsert_step(&self, run_id: &str, step: &StepRun) -> Result<(), String> {
        let run_id = run_id.to_string();
        let seq = step.seq;
        let json = serde_json::to_string(step).map_err(json_error)?;
        self.write(move |conn| {
            conn.execute(
                "INSERT INTO run_steps (run_id, seq, json) VALUES (?1, ?2, ?3)
                 ON CONFLICT(run_id, seq) DO UPDATE SET json = excluded.json",
                params![run_id, seq, json],
            )
            .map_err(sql_error)?;
            Ok(())
        })
        .await
    }

    pub async fn append_logs(&self, run_id: &str, lines: &[LogLine]) -> Result<(), String> {
        if lines.is_empty() {
            return Ok(());
        }
        let run_id = run_id.to_string();
        let lines = lines.to_vec();
        self.write(move |conn| {
            let mut count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM run_logs WHERE run_id = ?1 AND seq != ?2",
                    params![run_id, TRUNCATED_SEQ],
                    |row| row.get(0),
                )
                .map_err(sql_error)?;
            for line in lines {
                if count >= MAX_LOG_LINES {
                    conn.execute(
                        "INSERT OR IGNORE INTO run_logs (run_id, seq, at, level, step_id, message) VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
                        params![run_id, TRUNCATED_SEQ, line.at, enum_text(&LogLevel::Warn), "Log gekürzt."],
                    )
                    .map_err(sql_error)?;
                    break;
                }
                let inserted = conn
                    .execute(
                        "INSERT OR REPLACE INTO run_logs (run_id, seq, at, level, step_id, message) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![run_id, line.seq, line.at, enum_text(&line.level), line.step_id, truncate(&line.message)],
                    )
                    .map_err(sql_error)?;
                count += inserted as i64;
            }
            Ok(())
        })
        .await
    }

    pub async fn add_outputs(&self, run_id: &str, outputs: &[RunOutput]) -> Result<(), String> {
        let run_id = run_id.to_string();
        let outputs = outputs.to_vec();
        self.write(move |conn| {
            for output in outputs {
                conn.execute(
                    "INSERT INTO run_outputs (run_id, step_id, path, bytes, format) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![run_id, output.step_id, output.path, output.bytes.map(|b| b as i64), output.format],
                )
                .map_err(sql_error)?;
            }
            Ok(())
        })
        .await
    }

    pub async fn list_runs(&self, filter: &RunFilter) -> Result<Vec<RunSummary>, String> {
        let filter = filter.clone();
        self.call(move |conn| {
            let mut clauses: Vec<String> = Vec::new();
            let mut values: Vec<String> = Vec::new();
            if let Some(task_id) = filter.task_id.filter(|id| !id.is_empty()) {
                values.push(task_id);
                clauses.push(format!("task_id = ?{}", values.len()));
            }
            for (column, items) in [
                ("status", filter.statuses.iter().map(enum_text).collect::<Vec<_>>()),
                ("trigger", filter.triggers.iter().map(enum_text).collect::<Vec<_>>()),
            ] {
                if items.is_empty() {
                    continue;
                }
                let mut slots = Vec::new();
                for item in items {
                    values.push(item);
                    slots.push(format!("?{}", values.len()));
                }
                clauses.push(format!("{column} IN ({})", slots.join(", ")));
            }
            if let Some(from) = filter.from.filter(|value| !value.is_empty()) {
                values.push(from);
                clauses.push(format!("started_at >= ?{}", values.len()));
            }
            if let Some(to) = filter.to.filter(|value| !value.is_empty()) {
                values.push(to);
                clauses.push(format!("started_at <= ?{}", values.len()));
            }
            if let Some(text) = filter.text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
                let escaped = text.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
                values.push(format!("%{escaped}%"));
                let slot = values.len();
                clauses.push(format!(
                    "(task_name LIKE ?{slot} ESCAPE '\\' OR id LIKE ?{slot} ESCAPE '\\' OR IFNULL(error, '') LIKE ?{slot} ESCAPE '\\' OR IFNULL(trigger_detail, '') LIKE ?{slot} ESCAPE '\\')"
                ));
            }
            let limit = filter.limit.unwrap_or(200).clamp(1, 1_000);
            let offset = filter.offset.unwrap_or(0);
            let condition = if clauses.is_empty() {
                String::new()
            } else {
                format!("WHERE {}", clauses.join(" AND "))
            };
            let sql = format!(
                "SELECT {RUN_COLUMNS} FROM runs {condition} ORDER BY started_at DESC, id DESC LIMIT {limit} OFFSET {offset}"
            );
            let mut statement = conn.prepare(&sql).map_err(sql_error)?;
            let rows = statement
                .query_map(params_from_iter(values.iter()), read_run)
                .map_err(sql_error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)
        })
        .await
    }

    pub async fn get_run(&self, run_id: &str) -> Result<Option<RunDetail>, String> {
        let run_id = run_id.to_string();
        self.call(move |conn| {
            let row = conn
                .query_row(
                    &format!("SELECT {RUN_COLUMNS}, vars_json, definition_json FROM runs WHERE id = ?1"),
                    [&run_id],
                    |row| Ok((read_run(row)?, row.get::<_, String>(16)?, row.get::<_, String>(17)?)),
                )
                .optional()
                .map_err(sql_error)?;
            let Some((summary, vars, definition)) = row else {
                return Ok(None);
            };
            let mut steps = Vec::new();
            {
                let mut statement = conn
                    .prepare("SELECT json FROM run_steps WHERE run_id = ?1 ORDER BY seq")
                    .map_err(sql_error)?;
                let rows = statement
                    .query_map([&run_id], |row| row.get::<_, String>(0))
                    .map_err(sql_error)?;
                for json in rows {
                    steps.push(serde_json::from_str(&json.map_err(sql_error)?).map_err(json_error)?);
                }
            }
            let logs = {
                let mut statement = conn
                    .prepare("SELECT seq, at, level, step_id, message FROM run_logs WHERE run_id = ?1 ORDER BY seq")
                    .map_err(sql_error)?;
                let rows = statement
                    .query_map([&run_id], |row| {
                        Ok(LogLine {
                            seq: row.get(0)?,
                            at: row.get(1)?,
                            level: enum_parse(&row.get::<_, String>(2)?),
                            step_id: row.get(3)?,
                            message: row.get(4)?,
                        })
                    })
                    .map_err(sql_error)?;
                rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)?
            };
            let outputs = {
                let mut statement = conn
                    .prepare("SELECT step_id, path, bytes, format FROM run_outputs WHERE run_id = ?1 ORDER BY rowid")
                    .map_err(sql_error)?;
                let rows = statement
                    .query_map([&run_id], |row| {
                        Ok(RunOutput {
                            step_id: row.get(0)?,
                            path: row.get(1)?,
                            bytes: row.get::<_, Option<i64>>(2)?.map(|b| b.max(0) as u64),
                            format: row.get(3)?,
                        })
                    })
                    .map_err(sql_error)?;
                rows.collect::<Result<Vec<_>, _>>().map_err(sql_error)?
            };
            Ok(Some(RunDetail {
                summary,
                steps,
                logs,
                outputs,
                vars: serde_json::from_str(&vars).map_err(json_error)?,
                definition: serde_json::from_str(&definition).map_err(json_error)?,
            }))
        })
        .await
    }

    pub async fn delete_runs(&self, ids: &[String]) -> Result<u64, String> {
        let ids = ids.to_vec();
        self.write(move |conn| {
            let mut deleted = 0u64;
            for id in &ids {
                deleted += conn
                    .execute(
                        "DELETE FROM runs WHERE id = ?1 AND status != 'running'",
                        [id],
                    )
                    .map_err(sql_error)? as u64;
            }
            Ok(deleted)
        })
        .await
    }

    pub async fn apply_retention(
        &self,
        task_id: &str,
        retention: &Retention,
    ) -> Result<u64, String> {
        let task_id = task_id.to_string();
        let keep_runs = retention.keep_runs.unwrap_or(200) as i64;
        let keep_days = retention.keep_days.unwrap_or(30) as i64;
        self.write(move |conn| {
            let cutoff = rfc3339(Utc::now() - chrono::Duration::days(keep_days));
            let deleted = conn
                .execute(
                    "DELETE FROM runs WHERE task_id = ?1 AND status != 'running' AND (
                       started_at < ?2 OR id IN (
                         SELECT id FROM runs WHERE task_id = ?1 AND status != 'running'
                         ORDER BY started_at DESC, id DESC LIMIT -1 OFFSET ?3
                       )
                     )",
                    params![task_id, cutoff, keep_runs],
                )
                .map_err(sql_error)?;
            Ok(deleted as u64)
        })
        .await
    }

    pub async fn mark_interrupted(&self) -> Result<u32, String> {
        self.write(|conn| {
            let threshold = lease_threshold();
            let changed = conn
                .execute(
                    "UPDATE runs SET status = 'interrupted', error = ?2, finished_at = COALESCE(finished_at, ?3)
                     WHERE status = 'running' AND NOT EXISTS (
                       SELECT 1 FROM leases l WHERE l.run_id = runs.id AND l.heartbeat_at >= ?1
                     )",
                    params![threshold, INTERRUPTED, now()],
                )
                .map_err(sql_error)?;
            conn.execute("DELETE FROM leases WHERE heartbeat_at < ?1", [&threshold])
                .map_err(sql_error)?;
            Ok(changed as u32)
        })
        .await
    }

    pub async fn task_state(&self, task_id: &str) -> Result<TaskState, String> {
        let task_id = task_id.to_string();
        self.call(move |conn| read_state(conn, &task_id)).await
    }

    pub async fn record_finish(&self, run: &RunSummary) -> Result<TaskState, String> {
        let run = run.clone();
        self.write(move |conn| {
            let failed = matches!(run.status, RunStatus::Failed | RunStatus::Timeout);
            conn.execute(
                "INSERT INTO task_state (task_id, last_run_at, last_run_id, last_status, consecutive_failures)
                 VALUES (?1, ?2, ?3, ?4, CASE WHEN ?5 THEN 1 ELSE 0 END)
                 ON CONFLICT(task_id) DO UPDATE SET last_run_at = excluded.last_run_at,
                   last_run_id = excluded.last_run_id, last_status = excluded.last_status,
                   consecutive_failures = CASE WHEN ?5 THEN task_state.consecutive_failures + 1 ELSE 0 END",
                params![
                    run.task_id,
                    run.finished_at
                        .clone()
                        .unwrap_or_else(|| run.started_at.clone()),
                    run.id,
                    enum_text(&run.status),
                    failed,
                ],
            )
            .map_err(sql_error)?;
            read_state(conn, &run.task_id)
        })
        .await
    }

    pub async fn alert(&self, task_id: &str, step_id: &str) -> Result<Option<AlertState>, String> {
        let (task_id, step_id) = (task_id.to_string(), step_id.to_string());
        self.call(move |conn| {
            let json: Option<String> = conn
                .query_row(
                    "SELECT json FROM alerts WHERE task_id = ?1 AND step_id = ?2",
                    params![task_id, step_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(sql_error)?;
            json.map(|json| serde_json::from_str(&json).map_err(json_error))
                .transpose()
        })
        .await
    }

    pub async fn save_alert(&self, state: &AlertState) -> Result<(), String> {
        let state = state.clone();
        let json = serde_json::to_string(&state).map_err(json_error)?;
        self.write(move |conn| {
            conn.execute(
                "INSERT INTO alerts (task_id, step_id, json) VALUES (?1, ?2, ?3)
                 ON CONFLICT(task_id, step_id) DO UPDATE SET json = excluded.json",
                params![state.task_id, state.step_id, json],
            )
            .map_err(sql_error)?;
            Ok(())
        })
        .await
    }

    pub async fn beat(&self, key: &str) -> Result<(), String> {
        let key = key.to_string();
        let json = serde_json::json!({ "at": now(), "pid": std::process::id() }).to_string();
        self.write(move |conn| write_setting(conn, &key, &json))
            .await
    }

    pub async fn beat_at(&self, key: &str) -> Result<Option<DateTime<Utc>>, String> {
        let key = key.to_string();
        self.call(move |conn| {
            Ok(read_setting(conn, &key)?
                .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
                .and_then(|value| value.get("at")?.as_str().map(str::to_string))
                .and_then(|at| DateTime::parse_from_rfc3339(&at).ok())
                .map(|at| at.with_timezone(&Utc)))
        })
        .await
    }

    pub async fn record_activity(&self, mut entry: AiActivity) -> Result<(), String> {
        self.write(move |conn| {
            let mut list = read_activity(conn)?;
            entry.seq = list.last().map_or(1, |last| last.seq + 1);
            entry.at = now();
            list.push(entry);
            let skip = list.len().saturating_sub(MAX_ACTIVITY);
            let json = serde_json::to_string(&list[skip..]).map_err(json_error)?;
            write_setting(conn, ACTIVITY_KEY, &json)
        })
        .await
    }

    pub async fn activity(&self, after: u64) -> Result<Vec<AiActivity>, String> {
        self.call(move |conn| {
            Ok(read_activity(conn)?
                .into_iter()
                .filter(|entry| entry.seq > after)
                .collect())
        })
        .await
    }
}

fn read_activity(conn: &Connection) -> Result<Vec<AiActivity>, String> {
    Ok(read_setting(conn, ACTIVITY_KEY)?
        .map(|json| serde_json::from_str(&json).map_err(json_error))
        .transpose()?
        .unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(name: &str) -> Task {
        serde_json::from_value(serde_json::json!({ "id": new_id(), "name": name })).unwrap()
    }

    fn run(task: &Task, id: &str, started_at: String, status: RunStatus) -> RunSummary {
        RunSummary {
            id: id.into(),
            task_id: task.id.clone(),
            task_name: task.name.clone(),
            status,
            started_at,
            steps_total: 1,
            ..RunSummary::default()
        }
    }

    fn open() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("automation.db")).unwrap();
        (dir, store)
    }

    #[tokio::test]
    async fn migrates_fresh_db() {
        let (dir, store) = open();
        let conn = Connection::open(dir.path().join("automation.db")).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        for table in [
            "connections",
            "tasks",
            "task_state",
            "runs",
            "run_steps",
            "run_logs",
            "run_outputs",
            "alerts",
            "leases",
            "settings",
        ] {
            let found: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(found, 1, "{table}");
        }
        assert!(store.list_tasks().await.unwrap().is_empty());
        assert!(store.settings().await.unwrap().scheduler_enabled);
        drop(store);
        Store::open(&dir.path().join("automation.db")).unwrap();
    }

    #[test]
    fn rejects_newer_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("automation.db");
        Connection::open(&path)
            .unwrap()
            .pragma_update(None, "user_version", 99)
            .unwrap();
        assert_eq!(Store::open(&path).err().as_deref(), Some(NEWER_SCHEMA));
    }

    #[tokio::test]
    async fn record_finish_upserts_task_state() {
        let (dir, store) = open();
        let saved = store.save_task(task("Bericht"), None).await.unwrap();
        Connection::open(dir.path().join("automation.db"))
            .unwrap()
            .execute("DELETE FROM task_state WHERE task_id = ?1", [&saved.id])
            .unwrap();
        let first = run(&saved, "r1", now(), RunStatus::Failed);
        let state = store.record_finish(&first).await.unwrap();
        assert_eq!(state.last_run_id.as_deref(), Some("r1"));
        assert_eq!(state.last_status, Some(RunStatus::Failed));
        assert_eq!(state.consecutive_failures, 1);
        let second = run(&saved, "r2", now(), RunStatus::Timeout);
        assert_eq!(
            store
                .record_finish(&second)
                .await
                .unwrap()
                .consecutive_failures,
            2
        );
        let third = run(&saved, "r3", now(), RunStatus::Success);
        let state = store.record_finish(&third).await.unwrap();
        assert_eq!(state.consecutive_failures, 0);
        assert_eq!(state.last_run_id.as_deref(), Some("r3"));
    }

    #[tokio::test]
    async fn revision_conflict() {
        let (_dir, store) = open();
        let saved = store.save_task(task("Bericht"), None).await.unwrap();
        assert_eq!(saved.revision, 1);
        assert!(!saved.created_at.is_empty());
        let mut edited = saved.clone();
        edited.description = "neu".into();
        let second = store.save_task(edited.clone(), Some(1)).await.unwrap();
        assert_eq!(second.revision, 2);
        assert_eq!(second.created_at, saved.created_at);
        assert_eq!(
            store.save_task(edited.clone(), Some(1)).await.unwrap_err(),
            REVISION_CONFLICT
        );
        assert_eq!(
            store.save_task(edited, None).await.unwrap_err(),
            REVISION_CONFLICT
        );
        let clash = store.save_task(task("BERICHT"), None).await.unwrap_err();
        assert!(clash.contains("existiert bereits"), "{clash}");
        let found = store.find_task("bericht").await.unwrap();
        assert_eq!(found.id, saved.id);
        assert!(matches!(
            store.find_task("fehlt").await,
            Err(StartError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn lease_blocks_second_run() {
        let (_dir, store) = open();
        assert!(store.take_lease("t", "run-1").await.unwrap());
        assert!(!store.take_lease("t", "run-2").await.unwrap());
        assert_eq!(
            store.running_run("t").await.unwrap().as_deref(),
            Some("run-1")
        );
        store.renew_lease("t", "run-1").await.unwrap();
        store.release_lease("t", "run-2").await.unwrap();
        assert!(!store.take_lease("t", "run-2").await.unwrap());
        store.release_lease("t", "run-1").await.unwrap();
        assert_eq!(store.running_run("t").await.unwrap(), None);
        assert!(store.take_lease("t", "run-2").await.unwrap());
    }

    #[tokio::test]
    async fn expired_lease_is_taken_over() {
        let (_dir, store) = open();
        assert!(store.take_lease("t", "run-1").await.unwrap());
        let stale = rfc3339(Utc::now() - chrono::Duration::seconds(LEASE_SECONDS + 5));
        store
            .call(move |conn| {
                conn.execute("UPDATE leases SET heartbeat_at = ?1", [stale])
                    .map_err(sql_error)
            })
            .await
            .unwrap();
        assert_eq!(store.running_run("t").await.unwrap(), None);
        assert!(store.take_lease("t", "run-2").await.unwrap());
        assert_eq!(
            store.running_run("t").await.unwrap().as_deref(),
            Some("run-2")
        );
    }

    #[tokio::test]
    async fn retention_keeps_last_n_and_days() {
        let (_dir, store) = open();
        let task = store.save_task(task("Aufbewahrung"), None).await.unwrap();
        let definition = task.clone();
        let vars = BTreeMap::new();
        for index in 0..6 {
            let started = rfc3339(Utc::now() - chrono::Duration::minutes(10 - index));
            store
                .insert_run(
                    &run(&task, &format!("r{index}"), started, RunStatus::Success),
                    &vars,
                    &definition,
                )
                .await
                .unwrap();
        }
        let old = rfc3339(Utc::now() - chrono::Duration::days(40));
        store
            .insert_run(
                &run(&task, "old", old, RunStatus::Failed),
                &vars,
                &definition,
            )
            .await
            .unwrap();
        store
            .insert_run(
                &run(
                    &task,
                    "active",
                    rfc3339(Utc::now() - chrono::Duration::days(50)),
                    RunStatus::Running,
                ),
                &vars,
                &definition,
            )
            .await
            .unwrap();
        store
            .append_logs(
                "r0",
                &[LogLine {
                    seq: 1,
                    at: now(),
                    level: LogLevel::Info,
                    step_id: None,
                    message: "x".into(),
                }],
            )
            .await
            .unwrap();
        let deleted = store
            .apply_retention(
                &task.id,
                &Retention {
                    keep_days: Some(30),
                    keep_runs: Some(4),
                },
            )
            .await
            .unwrap();
        assert_eq!(deleted, 3);
        let ids: Vec<String> = store
            .list_runs(&RunFilter::default())
            .await
            .unwrap()
            .into_iter()
            .map(|run| run.id)
            .collect();
        assert_eq!(ids, vec!["r5", "r4", "r3", "r2", "active"]);
        assert!(store.get_run("r0").await.unwrap().is_none());
        let orphan_logs: i64 = store
            .call(|conn| {
                conn.query_row("SELECT COUNT(*) FROM run_logs", [], |row| row.get(0))
                    .map_err(sql_error)
            })
            .await
            .unwrap();
        assert_eq!(orphan_logs, 0);
    }

    #[tokio::test]
    async fn mark_interrupted_sets_status() {
        let (_dir, store) = open();
        let task = store.save_task(task("Absturz"), None).await.unwrap();
        let vars = BTreeMap::new();
        store
            .insert_run(&run(&task, "dead", now(), RunStatus::Running), &vars, &task)
            .await
            .unwrap();
        store
            .insert_run(
                &run(&task, "alive", now(), RunStatus::Running),
                &vars,
                &task,
            )
            .await
            .unwrap();
        assert!(store.take_lease(&task.id, "alive").await.unwrap());
        assert_eq!(store.mark_interrupted().await.unwrap(), 1);
        let dead = store.get_run("dead").await.unwrap().unwrap().summary;
        assert_eq!(dead.status, RunStatus::Interrupted);
        assert_eq!(dead.error.as_deref(), Some(INTERRUPTED));
        assert!(dead.finished_at.is_some());
        let alive = store.get_run("alive").await.unwrap().unwrap().summary;
        assert_eq!(alive.status, RunStatus::Running);
    }

    #[test]
    fn concurrent_writers_do_not_fail() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("automation.db");
        let handles: Vec<_> = (0..2)
            .map(|worker| {
                let path = path.clone();
                std::thread::spawn(move || {
                    let runtime = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .unwrap();
                    runtime.block_on(async move {
                        let store = Store::open(&path).unwrap();
                        let task = store
                            .save_task(task(&format!("Worker {worker}")), None)
                            .await
                            .unwrap();
                        for index in 0..100 {
                            let id = format!("w{worker}-{index}");
                            store
                                .insert_run(
                                    &run(&task, &id, now(), RunStatus::Running),
                                    &BTreeMap::new(),
                                    &task,
                                )
                                .await
                                .unwrap();
                            store.take_lease(&task.id, &id).await.unwrap();
                            store.release_lease(&task.id, &id).await.unwrap();
                            store.beat("app_heartbeat").await.unwrap();
                        }
                    });
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let store = Store::open(&path).unwrap();
            let runs = store
                .list_runs(&RunFilter {
                    limit: Some(1_000),
                    ..RunFilter::default()
                })
                .await
                .unwrap();
            assert_eq!(runs.len(), 200);
            assert!(store.beat_at("app_heartbeat").await.unwrap().is_some());
        });
    }

    #[tokio::test]
    async fn import_renames_and_flags_risky_tasks() {
        let (_dir, store) = open();
        let fixture: Task = serde_json::from_str(include_str!("fixtures/task-v1.json")).unwrap();
        store.save_task(fixture.clone(), None).await.unwrap();
        let bytes = serde_json::to_vec(&export_file(vec![fixture.clone()])).unwrap();
        let report = store
            .import_tasks(parse_import(&bytes).unwrap())
            .await
            .unwrap();
        assert_eq!(report.renamed, vec!["Alle Schritttypen (importiert)"]);
        assert_eq!(report.needs_review, report.renamed);
        let imported = store
            .find_task("Alle Schritttypen (importiert)")
            .await
            .unwrap();
        assert_ne!(imported.id, fixture.id);
        assert!(!imported.enabled && imported.needs_review);
        let Action::Condition {
            then: Flow::Goto { step_id },
            ..
        } = &imported.steps[34].action
        else {
            panic!("Bedingung erwartet");
        };
        assert_eq!(step_id, &imported.steps[0].id);
        let copy = store.duplicate_task(&fixture.id).await.unwrap();
        assert_eq!(copy.name, "Alle Schritttypen (Kopie)");
        assert!(!copy.enabled);
        let copy = store.duplicate_task(&fixture.id).await.unwrap();
        assert_eq!(copy.name, "Alle Schritttypen (Kopie 2)");
    }
}
