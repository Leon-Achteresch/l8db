pub mod alerts;
pub mod cli;
pub mod connection;
pub mod engine;
pub mod model;
pub mod notify;
pub mod os_scheduler;
pub mod runtime;
pub mod schedule;
pub mod scheduler;
pub mod steps;
pub mod store;
pub mod vars;

use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use model::{
    AiActivity, AlertState, AutomationConnection, AutomationSettings, BackgroundStatus, ChannelRef,
    ConnectionCheck, ImportReport, RunDetail, RunFilter, RunSummary, Schedule, Severity, Task,
    TaskSummary, TriggerKind, ValidationIssue,
};
use runtime::{rfc3339, AutomationEvent, RunRequest, Services};
use store::Store;

pub static APP_SERVICES: OnceLock<Services> = OnceLock::new();

#[derive(Default)]
pub struct AutomationState {
    pub services: OnceLock<Services>,
    pub failure: OnceLock<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTaskInput {
    pub task_id: String,
    #[serde(default)]
    pub vars: BTreeMap<String, String>,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub from_step: Option<String>,
    #[serde(default)]
    pub rerun_of: Option<String>,
    #[serde(default)]
    pub use_original_definition: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedRun {
    pub task_id: String,
    pub at: String,
}

pub fn services_from_app(app: &AppHandle) -> Result<Services, String> {
    let store = Store::open_default()?;
    let emitter = app.clone();
    Ok(Services {
        store: Arc::new(store),
        pool: app.state::<crate::db::pool::PoolState>().inner().clone(),
        ssh: app.state::<crate::db::ssh::SshState>().inner().clone(),
        transactions: app
            .state::<crate::db::transaction::TransactionState>()
            .inner()
            .clone(),
        sink: Arc::new(move |event| {
            let _ = emitter.emit("automation-event", event);
        }),
        headless: false,
        require_password: true,
    })
}

pub fn init(app: &AppHandle) {
    let state = app.state::<AutomationState>();
    match services_from_app(app) {
        Ok(services) => {
            if state.services.set(services.clone()).is_ok() {
                let _ = APP_SERVICES.set(services.clone());
                scheduler::spawn(services);
            }
        }
        Err(error) => {
            log::error!("Automatisierung nicht verfügbar: {error}");
            let _ = state.failure.set(error);
        }
    }
}

fn services(state: &tauri::State<'_, AutomationState>) -> Result<Services, String> {
    if let Some(services) = state.services.get() {
        return Ok(services.clone());
    }
    Err(state
        .failure
        .get()
        .cloned()
        .unwrap_or_else(|| "Automatisierung wird gestartet. Bitte gleich erneut versuchen.".into()))
}

async fn summaries(services: &Services, ids: &[String]) -> Result<Vec<TaskSummary>, String> {
    Ok(services
        .store
        .list_tasks()
        .await?
        .into_iter()
        .filter(|summary| ids.contains(&summary.task.id))
        .collect())
}

async fn summary(services: &Services, id: &str) -> Result<TaskSummary, String> {
    summaries(services, &[id.to_string()])
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "Task nicht gefunden.".into())
}

fn changed(services: &Services, ids: Vec<String>) {
    services.emit(AutomationEvent::TasksChanged { ids });
}

fn first_error(issues: &[ValidationIssue]) -> Option<&ValidationIssue> {
    issues
        .iter()
        .find(|issue| issue.severity == Severity::Error)
}

async fn write_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| format!("Datei {path} konnte nicht geschrieben werden: {error}"))
}

#[tauri::command]
pub async fn automation_sync_connections(
    state: tauri::State<'_, AutomationState>,
    connections: Vec<AutomationConnection>,
) -> Result<(), String> {
    let services = services(&state)?;
    let connections = connections
        .into_iter()
        .filter(|connection| !connection.id.trim().is_empty())
        .collect();
    for id in services.store.replace_connections(connections).await? {
        connection::forget(&services, &id).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn automation_list_tasks(
    state: tauri::State<'_, AutomationState>,
) -> Result<Vec<TaskSummary>, String> {
    services(&state)?.store.list_tasks().await
}

#[tauri::command]
pub async fn automation_get_task(
    state: tauri::State<'_, AutomationState>,
    id: String,
) -> Result<Task, String> {
    services(&state)?
        .store
        .get_task(&id)
        .await?
        .ok_or_else(|| "Task nicht gefunden.".into())
}

#[tauri::command]
pub async fn automation_save_task(
    state: tauri::State<'_, AutomationState>,
    mut task: Task,
    expected_revision: Option<u64>,
) -> Result<TaskSummary, String> {
    let services = services(&state)?;
    task.needs_review = false;
    let saved = services.store.save_task(task, expected_revision).await?;
    scheduler::reschedule(&services, &saved.id).await;
    changed(&services, vec![saved.id.clone()]);
    summary(&services, &saved.id).await
}

#[tauri::command]
pub async fn automation_delete_tasks(
    state: tauri::State<'_, AutomationState>,
    ids: Vec<String>,
) -> Result<(), String> {
    let services = services(&state)?;
    services.store.delete_tasks(&ids).await?;
    changed(&services, ids);
    Ok(())
}

#[tauri::command]
pub async fn automation_duplicate_task(
    state: tauri::State<'_, AutomationState>,
    id: String,
) -> Result<TaskSummary, String> {
    let services = services(&state)?;
    let copy = services.store.duplicate_task(&id).await?;
    changed(&services, vec![copy.id.clone()]);
    summary(&services, &copy.id).await
}

#[tauri::command]
pub async fn automation_set_enabled(
    state: tauri::State<'_, AutomationState>,
    ids: Vec<String>,
    enabled: bool,
) -> Result<Vec<TaskSummary>, String> {
    let services = services(&state)?;
    if enabled {
        let all = services.store.all_tasks().await?;
        for task in all.iter().filter(|task| ids.contains(&task.id)) {
            let message = if task.needs_review {
                Some(
                    "Der Task wurde importiert und muss zuerst geprüft und gespeichert werden."
                        .to_string(),
                )
            } else {
                first_error(&engine::validate(task, &all)).map(|issue| issue.message.clone())
            };
            if let Some(message) = message {
                return Err(format!("„{}“ hat ungelöste Fehler: {message}", task.name));
            }
        }
    }
    for id in &ids {
        services.store.set_enabled(id, enabled, None).await?;
        scheduler::reschedule(&services, id).await;
    }
    changed(&services, ids.clone());
    summaries(&services, &ids).await
}

#[tauri::command]
pub async fn automation_validate_task(
    state: tauri::State<'_, AutomationState>,
    task: Task,
) -> Result<Vec<ValidationIssue>, String> {
    let services = services(&state)?;
    let all = services.store.all_tasks().await?;
    Ok(engine::validate(&task, &all))
}

#[tauri::command]
pub async fn automation_export_tasks(
    state: tauri::State<'_, AutomationState>,
    ids: Vec<String>,
    path: String,
) -> Result<u32, String> {
    let services = services(&state)?;
    let tasks: Vec<Task> = services
        .store
        .all_tasks()
        .await?
        .into_iter()
        .filter(|task| ids.contains(&task.id))
        .collect();
    let count = tasks.len() as u32;
    let bytes = serde_json::to_vec_pretty(&store::export_file(tasks)).map_err(|e| e.to_string())?;
    write_file(path, bytes).await?;
    Ok(count)
}

#[tauri::command]
pub async fn automation_import_tasks(
    state: tauri::State<'_, AutomationState>,
    path: String,
) -> Result<ImportReport, String> {
    let services = services(&state)?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|error| format!("Datei {path} konnte nicht gelesen werden: {error}"))?;
    let report = services
        .store
        .import_tasks(store::parse_import(&bytes)?)
        .await?;
    changed(&services, Vec::new());
    Ok(report)
}

#[tauri::command]
pub async fn automation_run_task(
    state: tauri::State<'_, AutomationState>,
    input: RunTaskInput,
) -> Result<String, String> {
    let services = services(&state)?;
    let trigger = if input.rerun_of.is_some() {
        TriggerKind::Rerun
    } else {
        TriggerKind::Manual
    };
    engine::start(
        services,
        RunRequest {
            task_id: input.task_id,
            trigger,
            vars: input.vars,
            environment: input.environment.filter(|env| !env.is_empty()),
            from_step: input.from_step,
            rerun_of: input.rerun_of,
            use_original_definition: input.use_original_definition,
            ..RunRequest::default()
        },
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn automation_cancel_run(run_id: String) -> Result<bool, String> {
    Ok(engine::cancel(&run_id))
}

#[tauri::command]
pub async fn automation_list_runs(
    state: tauri::State<'_, AutomationState>,
    filter: RunFilter,
) -> Result<Vec<RunSummary>, String> {
    services(&state)?.store.list_runs(&filter).await
}

#[tauri::command]
pub async fn automation_get_run(
    state: tauri::State<'_, AutomationState>,
    run_id: String,
) -> Result<RunDetail, String> {
    services(&state)?
        .store
        .get_run(&run_id)
        .await?
        .ok_or_else(|| "Lauf nicht gefunden.".into())
}

#[tauri::command]
pub async fn automation_delete_runs(
    state: tauri::State<'_, AutomationState>,
    ids: Vec<String>,
) -> Result<u64, String> {
    services(&state)?.store.delete_runs(&ids).await
}

fn csv_field(value: &str) -> String {
    if value.contains([';', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[tauri::command]
pub async fn automation_export_runs(
    state: tauri::State<'_, AutomationState>,
    filter: RunFilter,
    format: String,
    path: String,
) -> Result<u32, String> {
    let services = services(&state)?;
    let runs = services.store.list_runs(&filter).await?;
    let count = runs.len() as u32;
    let bytes = match format.as_str() {
        "json" => {
            let mut details = Vec::with_capacity(runs.len());
            for run in &runs {
                if let Some(detail) = services.store.get_run(&run.id).await? {
                    let mut value = serde_json::to_value(detail).map_err(|e| e.to_string())?;
                    if let Some(object) = value.as_object_mut() {
                        object.remove("definition");
                    }
                    details.push(value);
                }
            }
            serde_json::to_vec_pretty(&details).map_err(|e| e.to_string())?
        }
        "csv" => {
            let mut text =
                String::from("id;task;status;trigger;startedAt;finishedAt;durationMs;error\n");
            for run in &runs {
                let enum_text =
                    |value: serde_json::Value| value.as_str().unwrap_or_default().to_string();
                let fields = [
                    run.id.clone(),
                    run.task_name.clone(),
                    enum_text(serde_json::to_value(run.status).unwrap_or_default()),
                    enum_text(serde_json::to_value(run.trigger).unwrap_or_default()),
                    run.started_at.clone(),
                    run.finished_at.clone().unwrap_or_default(),
                    run.duration_ms.map(|ms| ms.to_string()).unwrap_or_default(),
                    run.error.clone().unwrap_or_default(),
                ];
                let line: Vec<String> = fields.iter().map(|field| csv_field(field)).collect();
                text.push_str(&line.join(";"));
                text.push('\n');
            }
            text.into_bytes()
        }
        other => return Err(format!("Unbekanntes Exportformat „{other}“.")),
    };
    write_file(path, bytes).await?;
    Ok(count)
}

#[tauri::command]
pub async fn automation_preview_schedule(
    schedule: Schedule,
    count: usize,
) -> Result<Vec<String>, String> {
    Ok(
        schedule::next_runs(&schedule, Utc::now(), count.clamp(1, 20))?
            .into_iter()
            .map(rfc3339)
            .collect(),
    )
}

#[tauri::command]
pub async fn automation_next_runs(
    state: tauri::State<'_, AutomationState>,
    hours: u32,
) -> Result<Vec<PlannedRun>, String> {
    let services = services(&state)?;
    let now = Utc::now();
    let end = now + chrono::Duration::hours(hours.clamp(1, 168) as i64);
    let mut planned: Vec<(DateTime<Utc>, String)> = Vec::new();
    for task in services.store.all_tasks().await? {
        if !task.enabled || task.needs_review {
            continue;
        }
        for schedule in task.schedules.iter().filter(|schedule| schedule.enabled) {
            let Ok(times) = schedule::next_runs(schedule, now, 1_000) else {
                continue;
            };
            planned.extend(
                times
                    .into_iter()
                    .take_while(|at| *at <= end)
                    .map(|at| (at, task.id.clone())),
            );
        }
    }
    planned.sort();
    planned.dedup();
    Ok(planned
        .into_iter()
        .map(|(at, task_id)| PlannedRun {
            task_id,
            at: rfc3339(at),
        })
        .collect())
}

#[tauri::command]
pub async fn automation_get_settings(
    state: tauri::State<'_, AutomationState>,
) -> Result<AutomationSettings, String> {
    services(&state)?.store.settings().await
}

#[tauri::command]
pub async fn automation_save_settings(
    state: tauri::State<'_, AutomationState>,
    settings: AutomationSettings,
) -> Result<AutomationSettings, String> {
    let services = services(&state)?;
    services.store.save_settings(&settings).await?;
    services.store.settings().await
}

#[tauri::command]
pub async fn automation_test_channel(
    state: tauri::State<'_, AutomationState>,
    channel: ChannelRef,
) -> Result<(), String> {
    let services = services(&state)?;
    let message = notify::Message {
        title: "Testnachricht von l8db".into(),
        body: "Diese Nachricht wurde aus der l8db-Automatisierung gesendet.".into(),
        attachments: Vec::new(),
        payload: serde_json::json!({
            "event": "test",
            "title": "Testnachricht von l8db",
            "body": "Diese Nachricht wurde aus der l8db-Automatisierung gesendet.",
        }),
    };
    notify::send(&services, &channel, &message).await
}

#[tauri::command]
pub async fn automation_test_connection(
    state: tauri::State<'_, AutomationState>,
    connection: String,
) -> Result<ConnectionCheck, String> {
    let services = services(&state)?;
    let mut cache = connection::ConnectionCache::new();
    let resolved = match connection::resolve(&services, &mut cache, &connection, None).await {
        Ok(resolved) => resolved,
        Err(message) => {
            return Ok(ConnectionCheck {
                ok: false,
                via: String::new(),
                message,
            })
        }
    };
    let via = resolved.via.label().to_string();
    let result = match connection::adapter(&services, &resolved) {
        Ok(adapter) => crate::db::execution::connect(adapter.test_connection()).await,
        Err(error) => Err(error),
    };
    Ok(match result {
        Ok(()) => ConnectionCheck {
            ok: true,
            via,
            message: "Verbindung erfolgreich.".into(),
        },
        Err(message) => ConnectionCheck {
            ok: false,
            via,
            message,
        },
    })
}

#[tauri::command]
pub async fn automation_set_alert_mute(
    state: tauri::State<'_, AutomationState>,
    task_id: String,
    step_id: String,
    until: Option<String>,
) -> Result<AlertState, String> {
    let services = services(&state)?;
    let mut alert = services
        .store
        .alert(&task_id, &step_id)
        .await?
        .unwrap_or_else(|| AlertState {
            task_id: task_id.clone(),
            step_id: step_id.clone(),
            ..AlertState::default()
        });
    alert.muted_until = until.filter(|value| !value.is_empty());
    services.store.save_alert(&alert).await?;
    services.emit(AutomationEvent::AlertChanged {
        alert: alert.clone(),
    });
    Ok(alert)
}

#[tauri::command]
pub async fn automation_background_status(
    state: tauri::State<'_, AutomationState>,
) -> Result<BackgroundStatus, String> {
    let services = services(&state)?;
    tokio::task::spawn_blocking(move || os_scheduler::status(&services.store))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn automation_install_background() -> Result<BackgroundStatus, String> {
    tokio::task::spawn_blocking(os_scheduler::install)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn automation_uninstall_background() -> Result<BackgroundStatus, String> {
    tokio::task::spawn_blocking(os_scheduler::uninstall)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn automation_ai_activity(
    state: tauri::State<'_, AutomationState>,
    after: u64,
) -> Result<Vec<AiActivity>, String> {
    services(&state)?.store.activity(after).await
}

#[tauri::command]
pub async fn automation_cli_command(
    state: tauri::State<'_, AutomationState>,
    task_id: String,
) -> Result<String, String> {
    let task = services(&state)?
        .store
        .get_task(&task_id)
        .await?
        .ok_or("Task nicht gefunden.")?;
    Ok(os_scheduler::command_line(&task))
}
