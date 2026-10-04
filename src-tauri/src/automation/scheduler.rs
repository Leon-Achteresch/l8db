use std::collections::HashSet;
use std::future::Future;
use std::pin::Pin;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, Timelike, Utc};
use rusqlite::params;
use serde::Serialize;
use tokio::sync::Notify;

use crate::automation::engine;
use crate::automation::model::{
    AfterOutcome, MissedRunPolicy, RunStatus, RunSummary, Schedule, Task, Trigger, TriggerKind,
};
use crate::automation::runtime::{
    new_run_id, rfc3339, AutomationEvent, RunRequest, Services, StartError,
};
use crate::automation::schedule::{next_run, next_runs};
use crate::automation::store::Store;

pub const APP_HEARTBEAT: &str = "app_heartbeat";
pub const LAST_TICK: &str = "last_tick";
const ALIVE_SECONDS: i64 = 90;
const MISSED_SECONDS: i64 = 120;
const HEARTBEAT_SECONDS: u64 = 30;
const SKIPPED: &str = "Vorheriger Lauf noch aktiv.";
const CAUGHT_UP: &str = "nachgeholt";

static WAKE: Notify = Notify::const_new();

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickReport {
    pub app_running: bool,
    pub started: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<String>,
}

type Started = Pin<Box<dyn Future<Output = Result<String, StartError>> + Send>>;
type Starter = dyn Fn(Services, RunRequest) -> Started + Send + Sync;

fn engine_start(services: Services, request: RunRequest) -> Started {
    if services.headless {
        Box::pin(async move { engine::execute(services, request).await.map(|run| run.id) })
    } else {
        Box::pin(engine::start(services, request))
    }
}

fn active(task: &Task) -> bool {
    task.enabled && !task.needs_review
}

fn parse(at: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(at)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

fn is_event(schedule: &Schedule) -> bool {
    matches!(
        schedule.trigger,
        Trigger::AppStart { .. } | Trigger::AfterTask { .. }
    )
}

async fn set_next_run(
    store: &Store,
    task_id: &str,
    next: Option<DateTime<Utc>>,
) -> Result<(), String> {
    let path = store.path().to_path_buf();
    let task_id = task_id.to_string();
    let next = next.map(rfc3339);
    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO task_state (task_id, next_run_at) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ?1)
             ON CONFLICT(task_id) DO UPDATE SET next_run_at = excluded.next_run_at",
            params![task_id, next],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: String| format!("Automatisierungsdatenbank: {e}"))
}

fn due_schedule(task: &Task, due: DateTime<Utc>) -> Option<&Schedule> {
    let mut timed = task
        .schedules
        .iter()
        .filter(|schedule| schedule.enabled && !is_event(schedule));
    let before = due - Duration::milliseconds(1);
    timed
        .clone()
        .find(|schedule| {
            next_runs(schedule, before, 1)
                .ok()
                .and_then(|runs| runs.first().copied())
                == Some(due)
        })
        .or_else(|| timed.next())
}

fn request(task: &Task, schedule: &Schedule, trigger: TriggerKind, detail: String) -> RunRequest {
    RunRequest {
        task_id: task.id.clone(),
        trigger,
        trigger_detail: Some(detail),
        vars: schedule.vars.clone(),
        environment: schedule.environment.clone(),
        ..RunRequest::default()
    }
}

async fn record_skipped(
    services: &Services,
    task: &Task,
    request: &RunRequest,
    now: DateTime<Utc>,
) -> Result<String, String> {
    let run = RunSummary {
        id: new_run_id(),
        task_id: task.id.clone(),
        task_name: task.name.clone(),
        trigger: request.trigger,
        trigger_detail: request.trigger_detail.clone(),
        status: RunStatus::Skipped,
        started_at: rfc3339(now),
        finished_at: Some(rfc3339(now)),
        duration_ms: Some(0),
        error: Some(SKIPPED.into()),
        environment: request.environment.clone(),
        steps_total: task.steps.len() as u32,
        ..RunSummary::default()
    };
    services
        .store
        .insert_run(&run, &Default::default(), task)
        .await?;
    services.emit(AutomationEvent::RunFinished { run: run.clone() });
    Ok(run.id)
}

async fn launch(
    services: &Services,
    task: &Task,
    request: RunRequest,
    now: DateTime<Utc>,
    starter: &Starter,
    report: &mut TickReport,
) {
    match starter(services.clone(), request.clone()).await {
        Ok(run_id) => report.started.push(run_id),
        Err(StartError::AlreadyRunning(_)) => {
            match record_skipped(services, task, &request, now).await {
                Ok(run_id) => report.skipped.push(run_id),
                Err(error) => report.failed.push(format!("{}: {error}", task.name)),
            }
        }
        Err(error) => {
            log::warn!("Automatisierung „{}“ nicht gestartet: {error}", task.name);
            report.failed.push(format!("{}: {error}", task.name));
        }
    }
}

async fn run_due(
    services: &Services,
    now: DateTime<Utc>,
    background_only: bool,
    starter: &Starter,
) -> TickReport {
    let mut report = TickReport::default();
    let tasks = match services.store.settings().await {
        Ok(settings) if !settings.scheduler_enabled => return report,
        Ok(_) => services.store.all_tasks().await,
        Err(error) => Err(error),
    };
    let tasks = match tasks {
        Ok(tasks) => tasks,
        Err(error) => {
            report.failed.push(error);
            return report;
        }
    };
    let trigger = if background_only {
        TriggerKind::Background
    } else {
        TriggerKind::Schedule
    };
    for task in tasks
        .iter()
        .filter(|task| active(task) && (!background_only || task.background))
    {
        let state = match services.store.task_state(&task.id).await {
            Ok(state) => state,
            Err(error) => {
                report.failed.push(format!("{}: {error}", task.name));
                continue;
            }
        };
        let Some(due) = state.next_run_at.as_deref().and_then(parse) else {
            if let Some(next) = next_run(task, now) {
                if let Err(error) = set_next_run(&services.store, &task.id, Some(next)).await {
                    report.failed.push(format!("{}: {error}", task.name));
                }
            }
            continue;
        };
        if due > now {
            continue;
        }
        if let Err(error) = set_next_run(&services.store, &task.id, next_run(task, now)).await {
            report.failed.push(format!("{}: {error}", task.name));
            continue;
        }
        let missed = due < now - Duration::seconds(MISSED_SECONDS);
        if missed && task.missed_runs == MissedRunPolicy::Skip {
            continue;
        }
        let Some(schedule) = due_schedule(task, due) else {
            continue;
        };
        let detail = if missed {
            CAUGHT_UP.to_string()
        } else {
            schedule.id.clone()
        };
        let request = request(task, schedule, trigger, detail);
        launch(services, task, request, now, starter, &mut report).await;
    }
    report
}

fn next_wake(now: DateTime<Utc>) -> StdDuration {
    let minute = now
        .with_second(0)
        .and_then(|at| at.with_nanosecond(0))
        .unwrap_or(now);
    let mut target = minute + Duration::seconds(2);
    if target <= now {
        target += Duration::minutes(1);
    }
    (target - now)
        .to_std()
        .unwrap_or(StdDuration::from_secs(60))
}

fn start_app_triggers(services: &Services, tasks: Vec<Task>) {
    for task in tasks.into_iter().filter(active) {
        for schedule in task.schedules.iter().filter(|schedule| schedule.enabled) {
            let Trigger::AppStart { delay_seconds } = schedule.trigger else {
                continue;
            };
            let (services, task) = (services.clone(), task.clone());
            let request = request(&task, schedule, TriggerKind::AppStart, schedule.id.clone());
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(StdDuration::from_secs(delay_seconds as u64)).await;
                let mut report = TickReport::default();
                launch(
                    &services,
                    &task,
                    request,
                    Utc::now(),
                    &engine_start,
                    &mut report,
                )
                .await;
            });
        }
    }
}

pub fn spawn(services: Services) {
    tauri::async_runtime::spawn(async move {
        let heartbeat = services.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if let Err(error) = heartbeat.store.beat(APP_HEARTBEAT).await {
                    log::warn!("Automatisierung: Heartbeat fehlgeschlagen: {error}");
                }
                tokio::time::sleep(StdDuration::from_secs(HEARTBEAT_SECONDS)).await;
            }
        });
        if let Err(error) = services.store.mark_interrupted().await {
            log::warn!("Automatisierung: {error}");
        }
        if let Ok(tasks) = services.store.all_tasks().await {
            start_app_triggers(&services, tasks);
        }
        loop {
            run_due(&services, Utc::now(), false, &engine_start).await;
            tokio::select! {
                _ = tokio::time::sleep(next_wake(Utc::now())) => {}
                _ = WAKE.notified() => {}
            }
        }
    });
}

async fn tick_at(services: &Services, now: DateTime<Utc>, starter: &Starter) -> TickReport {
    if let Err(error) = services.store.beat(LAST_TICK).await {
        log::warn!("Automatisierung: {error}");
    }
    let app_alive = services
        .store
        .beat_at(APP_HEARTBEAT)
        .await
        .ok()
        .flatten()
        .is_some_and(|at| (now - at).num_seconds().abs() < ALIVE_SECONDS);
    if app_alive {
        return TickReport {
            app_running: true,
            ..TickReport::default()
        };
    }
    if let Err(error) = services.store.mark_interrupted().await {
        log::warn!("Automatisierung: {error}");
    }
    run_due(services, now, true, starter).await
}

pub async fn tick(services: Services) -> TickReport {
    tick_at(&services, Utc::now(), &engine_start).await
}

fn follows(schedule: &Schedule, task_id: &str, success: bool) -> bool {
    schedule.enabled
        && matches!(
            &schedule.trigger,
            Trigger::AfterTask { task_id: source, on }
                if source == task_id
                    && matches!(
                        (on, success),
                        (AfterOutcome::Always, _)
                            | (AfterOutcome::Success, true)
                            | (AfterOutcome::Failure, false)
                    )
        )
}

const MAX_CHAIN: usize = 32;

async fn chain_tasks(services: &Services, run: &RunSummary) -> HashSet<String> {
    let mut tasks = HashSet::from([run.task_id.clone()]);
    let mut current = run.clone();
    for _ in 0..MAX_CHAIN {
        let (TriggerKind::AfterTask, Some(parent)) = (current.trigger, &current.trigger_detail)
        else {
            break;
        };
        let Ok(Some(detail)) = services.store.get_run(parent).await else {
            break;
        };
        current = detail.summary;
        tasks.insert(current.task_id.clone());
    }
    tasks
}

async fn after_run(services: &Services, run: &RunSummary, starter: &Starter) -> TickReport {
    let mut report = TickReport::default();
    let success = match run.status {
        RunStatus::Success | RunStatus::Warning => true,
        RunStatus::Failed | RunStatus::Timeout => false,
        _ => return report,
    };
    if !services
        .store
        .settings()
        .await
        .is_ok_and(|settings| settings.scheduler_enabled)
    {
        return report;
    }
    let Ok(tasks) = services.store.all_tasks().await else {
        return report;
    };
    let mut chain = None;
    for task in tasks.iter().filter(|task| active(task)) {
        if let Some(schedule) = task
            .schedules
            .iter()
            .find(|schedule| follows(schedule, &run.task_id, success))
        {
            if chain.is_none() {
                chain = Some(chain_tasks(services, run).await);
            }
            if chain.as_ref().is_some_and(|chain| chain.contains(&task.id)) {
                log::warn!(
                    "Automatisierung „{}“ nicht gestartet: Zyklus in der Kette „Nach Task“ (Lauf {}).",
                    task.name,
                    run.id
                );
                report.failed.push(format!(
                    "{}: Zyklus in der Kette „Nach Task“, nicht gestartet.",
                    task.name
                ));
                continue;
            }
            let request = request(task, schedule, TriggerKind::AfterTask, run.id.clone());
            launch(services, task, request, Utc::now(), starter, &mut report).await;
        }
    }
    report
}

pub async fn on_run_finished(services: &Services, run: &RunSummary) {
    after_run(services, run, &engine_start).await;
}

pub async fn reschedule(services: &Services, task_id: &str) {
    match services.store.get_task(task_id).await {
        Ok(Some(task)) => {
            let next = if active(&task) {
                next_run(&task, Utc::now())
            } else {
                None
            };
            if let Err(error) = set_next_run(&services.store, task_id, next).await {
                log::warn!("Automatisierung: {error}");
            }
        }
        Ok(None) => {}
        Err(error) => log::warn!("Automatisierung: {error}"),
    }
    WAKE.notify_one();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::model::RunFilter;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    struct Fixture {
        _dir: tempfile::TempDir,
        services: Services,
        requests: Arc<Mutex<Vec<RunRequest>>>,
        busy: Arc<Mutex<bool>>,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("automation.db")).unwrap();
            Fixture {
                _dir: dir,
                services: Services::new(store, Arc::new(|_| {}), true),
                requests: Arc::default(),
                busy: Arc::default(),
            }
        }

        fn starter(&self) -> impl Fn(Services, RunRequest) -> Started + Send + Sync {
            let (requests, busy) = (self.requests.clone(), self.busy.clone());
            move |_, request: RunRequest| {
                let result = if *busy.lock().unwrap() {
                    Err(StartError::AlreadyRunning("alt".into()))
                } else {
                    Ok(format!("run-{}", request.task_id))
                };
                requests.lock().unwrap().push(request);
                Box::pin(async move { result })
            }
        }

        async fn task(&self, value: serde_json::Value) -> Task {
            let mut base = json!({ "id": "t", "name": "Bericht", "background": true });
            for (key, field) in value.as_object().unwrap() {
                base[key] = field.clone();
            }
            let task: Task = serde_json::from_value(base).unwrap();
            self.services.store.save_task(task, None).await.unwrap()
        }

        async fn next(&self, task_id: &str) -> Option<String> {
            self.services
                .store
                .task_state(task_id)
                .await
                .unwrap()
                .next_run_at
        }

        async fn set_next(&self, task_id: &str, at: &str) {
            set_next_run(&self.services.store, task_id, Some(time(at)))
                .await
                .unwrap();
        }

        fn started(&self) -> Vec<RunRequest> {
            self.requests.lock().unwrap().clone()
        }

        async fn due(&self, now: &str) -> TickReport {
            run_due(&self.services, time(now), false, &self.starter()).await
        }
    }

    fn time(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn daily() -> serde_json::Value {
        json!([{
            "id": "morgens",
            "trigger": { "type": "daily", "times": ["09:00"] },
            "timezone": "UTC",
            "vars": { "ziel": "a.csv" },
            "environment": "prod"
        }])
    }

    #[tokio::test]
    async fn due_task_starts_and_reschedules() {
        let fx = Fixture::new();
        fx.task(json!({ "schedules": daily() })).await;
        fx.set_next("t", "2026-10-04T09:00:00Z").await;
        let report = fx.due("2026-10-04T08:59:00Z").await;
        assert!(report.started.is_empty() && fx.started().is_empty());
        let report = fx.due("2026-10-04T09:00:02Z").await;
        assert_eq!(report.started, ["run-t"]);
        let request = &fx.started()[0];
        assert_eq!(request.trigger, TriggerKind::Schedule);
        assert_eq!(request.trigger_detail.as_deref(), Some("morgens"));
        assert_eq!(request.vars.get("ziel").map(String::as_str), Some("a.csv"));
        assert_eq!(request.environment.as_deref(), Some("prod"));
        assert_eq!(
            fx.next("t").await.as_deref(),
            Some("2026-10-05T09:00:00.000Z")
        );
        fx.due("2026-10-04T09:01:02Z").await;
        assert_eq!(fx.started().len(), 1);
    }

    #[tokio::test]
    async fn missing_next_run_is_computed_without_running() {
        let fx = Fixture::new();
        fx.task(json!({ "schedules": daily() })).await;
        fx.due("2026-10-04T08:00:00Z").await;
        assert!(fx.started().is_empty());
        assert_eq!(
            fx.next("t").await.as_deref(),
            Some("2026-10-04T09:00:00.000Z")
        );
    }

    #[tokio::test]
    async fn missed_run_is_skipped_with_skip_policy() {
        let fx = Fixture::new();
        fx.task(json!({ "schedules": daily(), "missedRuns": "skip" }))
            .await;
        fx.set_next("t", "2026-10-04T09:00:00Z").await;
        fx.due("2026-10-04T09:05:00Z").await;
        assert!(fx.started().is_empty());
        assert_eq!(
            fx.next("t").await.as_deref(),
            Some("2026-10-05T09:00:00.000Z")
        );
    }

    #[tokio::test]
    async fn missed_run_runs_once_with_run_once_policy() {
        let fx = Fixture::new();
        fx.task(json!({ "schedules": daily(), "missedRuns": "run_once" }))
            .await;
        fx.set_next("t", "2026-10-01T09:00:00Z").await;
        fx.due("2026-10-04T10:00:00Z").await;
        fx.due("2026-10-04T10:01:00Z").await;
        let started = fx.started();
        assert_eq!(started.len(), 1);
        assert_eq!(started[0].trigger_detail.as_deref(), Some("nachgeholt"));
        assert_eq!(started[0].environment.as_deref(), Some("prod"));
        assert_eq!(
            fx.next("t").await.as_deref(),
            Some("2026-10-05T09:00:00.000Z")
        );
    }

    #[tokio::test]
    async fn inactive_tasks_and_paused_scheduler_do_not_run() {
        let fx = Fixture::new();
        fx.task(json!({ "id": "aus", "name": "Aus", "enabled": false, "schedules": daily() }))
            .await;
        fx.task(
            json!({ "id": "pruefen", "name": "Prüfen", "needsReview": true, "schedules": daily() }),
        )
        .await;
        fx.set_next("aus", "2026-10-04T09:00:00Z").await;
        fx.set_next("pruefen", "2026-10-04T09:00:00Z").await;
        fx.due("2026-10-04T09:00:02Z").await;
        assert!(fx.started().is_empty());
        fx.task(json!({ "schedules": daily() })).await;
        fx.set_next("t", "2026-10-04T09:00:00Z").await;
        let mut settings = fx.services.store.settings().await.unwrap();
        settings.scheduler_enabled = false;
        fx.services.store.save_settings(&settings).await.unwrap();
        fx.due("2026-10-04T09:00:02Z").await;
        assert!(fx.started().is_empty());
    }

    #[tokio::test]
    async fn due_schedule_is_identified_among_several() {
        let fx = Fixture::new();
        fx.task(json!({ "schedules": [
            { "id": "frueh", "trigger": { "type": "daily", "times": ["06:00"] }, "timezone": "UTC" },
            { "id": "start", "trigger": { "type": "app_start" } },
            { "id": "mittag", "trigger": { "type": "daily", "times": ["12:00"] }, "timezone": "UTC" }
        ] }))
        .await;
        fx.set_next("t", "2026-10-04T12:00:00Z").await;
        fx.due("2026-10-04T12:00:02Z").await;
        assert_eq!(fx.started()[0].trigger_detail.as_deref(), Some("mittag"));
        assert_eq!(
            fx.next("t").await.as_deref(),
            Some("2026-10-05T06:00:00.000Z")
        );
    }

    #[tokio::test]
    async fn already_running_records_skipped_run() {
        let fx = Fixture::new();
        fx.task(json!({ "schedules": daily() })).await;
        fx.set_next("t", "2026-10-04T09:00:00Z").await;
        *fx.busy.lock().unwrap() = true;
        let report = fx.due("2026-10-04T09:00:02Z").await;
        assert_eq!(report.skipped.len(), 1);
        let runs = fx
            .services
            .store
            .list_runs(&RunFilter::default())
            .await
            .unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].id, report.skipped[0]);
        assert_eq!(runs[0].status, RunStatus::Skipped);
        assert_eq!(runs[0].trigger, TriggerKind::Schedule);
        assert_eq!(runs[0].error.as_deref(), Some(SKIPPED));
    }

    #[tokio::test]
    async fn after_task_follows_outcome() {
        let fx = Fixture::new();
        fx.task(json!({ "id": "quelle", "name": "Quelle" })).await;
        for (id, on, enabled) in [
            ("erfolg", "success", true),
            ("fehler", "failure", true),
            ("immer", "always", true),
            ("aus", "success", false),
        ] {
            fx.task(json!({
                "id": id,
                "name": id,
                "enabled": enabled,
                "schedules": [{ "id": format!("{id}-s"), "trigger": { "type": "after_task", "taskId": "quelle", "on": on } }]
            }))
            .await;
        }
        let cases = [
            (RunStatus::Success, vec!["erfolg", "immer"]),
            (RunStatus::Warning, vec!["erfolg", "immer"]),
            (RunStatus::Failed, vec!["fehler", "immer"]),
            (RunStatus::Timeout, vec!["fehler", "immer"]),
            (RunStatus::Cancelled, vec![]),
            (RunStatus::Skipped, vec![]),
            (RunStatus::Interrupted, vec![]),
        ];
        for (status, expected) in cases {
            fx.requests.lock().unwrap().clear();
            let run = RunSummary {
                id: "lauf-1".into(),
                task_id: "quelle".into(),
                status,
                ..RunSummary::default()
            };
            after_run(&fx.services, &run, &fx.starter()).await;
            let mut started: Vec<String> = fx
                .started()
                .into_iter()
                .map(|request| request.task_id)
                .collect();
            started.sort();
            assert_eq!(started, expected, "{status:?}");
            for request in fx.started() {
                assert_eq!(request.trigger, TriggerKind::AfterTask);
                assert_eq!(request.trigger_detail.as_deref(), Some("lauf-1"));
            }
        }
    }

    #[tokio::test]
    async fn after_task_cycle_stops_after_one_round() {
        let fx = Fixture::new();
        let mut tasks = Vec::new();
        for (id, source) in [("a", "b"), ("b", "a")] {
            tasks.push(
                fx.task(json!({
                    "id": id,
                    "name": id,
                    "schedules": [{ "id": format!("{id}-s"), "trigger": { "type": "after_task", "taskId": source, "on": "success" } }]
                }))
                .await,
            );
        }
        let first = RunSummary {
            id: "lauf-a".into(),
            task_id: "a".into(),
            trigger: TriggerKind::Manual,
            status: RunStatus::Success,
            ..RunSummary::default()
        };
        fx.services
            .store
            .insert_run(&first, &Default::default(), &tasks[0])
            .await
            .unwrap();
        let report = after_run(&fx.services, &first, &fx.starter()).await;
        assert_eq!(report.started, ["run-b"]);
        let follow = RunSummary {
            id: "run-b".into(),
            task_id: "b".into(),
            trigger: TriggerKind::AfterTask,
            trigger_detail: Some("lauf-a".into()),
            status: RunStatus::Success,
            ..RunSummary::default()
        };
        let report = after_run(&fx.services, &follow, &fx.starter()).await;
        assert!(report.started.is_empty());
        assert_eq!(report.failed.len(), 1);
        let started: Vec<String> = fx.started().into_iter().map(|r| r.task_id).collect();
        assert_eq!(started, ["b"]);
    }

    #[tokio::test]
    async fn tick_does_nothing_while_app_heartbeat_is_fresh() {
        let fx = Fixture::new();
        fx.task(json!({ "schedules": daily() })).await;
        fx.set_next("t", "2026-01-01T09:00:00Z").await;
        fx.services.store.beat(APP_HEARTBEAT).await.unwrap();
        let report = tick_at(&fx.services, Utc::now(), &fx.starter()).await;
        assert!(report.app_running);
        assert!(fx.started().is_empty());
        assert!(fx
            .services
            .store
            .beat_at(LAST_TICK)
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn tick_runs_only_background_tasks() {
        let fx = Fixture::new();
        fx.task(
            json!({ "id": "vorne", "name": "Vorne", "background": false, "schedules": daily() }),
        )
        .await;
        fx.task(json!({ "schedules": daily() })).await;
        fx.set_next("vorne", "2026-10-04T09:00:00Z").await;
        fx.set_next("t", "2026-10-04T09:00:00Z").await;
        let report = tick_at(&fx.services, time("2026-10-04T09:00:30Z"), &fx.starter()).await;
        assert!(!report.app_running);
        assert_eq!(report.started, ["run-t"]);
        assert_eq!(fx.started()[0].trigger, TriggerKind::Background);
        assert_eq!(
            fx.next("vorne").await.as_deref(),
            Some("2026-10-04T09:00:00.000Z")
        );
    }

    #[tokio::test]
    async fn stale_heartbeat_lets_tick_run() {
        let fx = Fixture::new();
        fx.task(json!({ "schedules": daily() })).await;
        fx.set_next("t", "2026-01-01T09:00:00Z").await;
        fx.services.store.beat(APP_HEARTBEAT).await.unwrap();
        let later = Utc::now() + Duration::seconds(ALIVE_SECONDS + 5);
        let report = tick_at(&fx.services, later, &fx.starter()).await;
        assert!(!report.app_running);
        assert_eq!(fx.started().len(), 1);
    }

    #[test]
    fn wakes_two_seconds_after_each_minute() {
        assert_eq!(
            next_wake(time("2026-10-04T08:00:30Z")),
            StdDuration::from_secs(32)
        );
        assert_eq!(
            next_wake(time("2026-10-04T08:00:01Z")),
            StdDuration::from_secs(1)
        );
        assert_eq!(
            next_wake(time("2026-10-04T08:00:02Z")),
            StdDuration::from_secs(60)
        );
    }
}
