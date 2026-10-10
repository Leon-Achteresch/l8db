use std::collections::{BTreeMap, HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

use crate::automation::connection::ConnectionCache;
use crate::automation::model::{
    secret_account, Action, Flow, LogLevel, LogLine, LoopSource, NotifyWhen, Retention,
    RetryPolicy, RunStatus, RunSummary, Severity, Step, StepRun, Task, TriggerKind,
    ValidationIssue, VariableKind,
};
use crate::automation::runtime::{
    new_run_id, now, AutomationEvent, RunRequest, Services, StartError, StepContext, StepOutcome,
};
use crate::automation::vars::{valid_name, Vars};
use crate::db::execution::{self, ExecutionOptions};

const MAX_DEPTH: u8 = 5;
const MAX_EXECUTIONS: u32 = 10_000;
const MAX_LOG_LINES: u32 = 5_000;
const MAX_LOG_CHARS: usize = 4_000;
const DEFAULT_MAX_DELAY: u64 = 3_600;
const GRACE: Duration = Duration::from_secs(5);
const HEARTBEAT: Duration = Duration::from_secs(30);

type Boxed<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Default)]
struct LogBuffer {
    pending: Vec<LogLine>,
    count: u32,
    truncated: bool,
}

struct Runner {
    services: Services,
    task: Task,
    run_id: String,
    token: CancellationToken,
    deadline: OnceLock<tokio::time::Instant>,
    timed_out: AtomicBool,
    seq: AtomicU32,
    executions: AtomicU32,
    current_depth: AtomicU8,
    task_depth: u8,
    path: Vec<String>,
    active_job: Mutex<Option<String>>,
    logs: Mutex<LogBuffer>,
    masker: OnceLock<Vars>,
    warning: AtomicBool,
    pending: Mutex<Vec<NotifyWhen>>,
    summary: Mutex<RunSummary>,
}

enum LevelEnd {
    Success,
    Failure(String),
    Stopped,
}

enum StepEnd {
    Done,
    Failed(String),
    Stopped,
}

enum Attempt {
    Finished(Result<StepOutcome, String>),
    StepTimeout(u64),
    Stopped,
}

struct Prepared {
    runner: Arc<Runner>,
    vars: Result<Vars, String>,
    start: usize,
}

fn registry() -> &'static Mutex<HashMap<String, Arc<Runner>>> {
    static RUNS: OnceLock<Mutex<HashMap<String, Arc<Runner>>>> = OnceLock::new();
    RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn runner(run_id: &str) -> Option<Arc<Runner>> {
    registry().lock().ok()?.get(run_id).cloned()
}

fn slots(limit: u32) -> Arc<Semaphore> {
    static SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();
    SLOTS
        .get_or_init(|| Arc::new(Semaphore::new(limit.max(1) as usize)))
        .clone()
}

fn enum_text<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

pub fn retry_delay(policy: &RetryPolicy, attempt: u32) -> Duration {
    let cap = policy.max_delay_seconds.unwrap_or(DEFAULT_MAX_DELAY);
    let seconds = match policy.backoff {
        crate::automation::model::Backoff::Fixed => policy.delay_seconds,
        crate::automation::model::Backoff::Exponential => policy
            .delay_seconds
            .saturating_mul(1u64 << attempt.saturating_sub(1).min(32)),
    };
    Duration::from_secs(seconds.min(cap))
}

impl Runner {
    fn mask(&self, text: &str) -> String {
        match self.masker.get() {
            Some(vars) => vars.mask(text),
            None => text.to_string(),
        }
    }

    fn log(&self, level: LogLevel, step_id: Option<&str>, message: String) {
        let mut message = self.mask(&message);
        if message.chars().count() > MAX_LOG_CHARS {
            message = message.chars().take(MAX_LOG_CHARS).collect::<String>() + " …";
        }
        let line = {
            let Ok(mut buffer) = self.logs.lock() else {
                return;
            };
            if buffer.count >= MAX_LOG_LINES {
                if buffer.truncated {
                    return;
                }
                buffer.truncated = true;
                message = "Log gekürzt.".into();
            }
            let line = LogLine {
                seq: buffer.count,
                at: now(),
                level,
                step_id: step_id.map(str::to_string),
                message,
            };
            buffer.count += 1;
            buffer.pending.push(line.clone());
            line
        };
        self.services.emit(AutomationEvent::RunLog {
            run_id: self.run_id.clone(),
            line,
        });
    }

    async fn flush_logs(&self) {
        let lines = match self.logs.lock() {
            Ok(mut buffer) => std::mem::take(&mut buffer.pending),
            Err(_) => return,
        };
        let _ = self.services.store.append_logs(&self.run_id, &lines).await;
    }

    async fn record(&self, step: &StepRun) {
        let _ = self.services.store.upsert_step(&self.run_id, step).await;
        self.services.emit(AutomationEvent::RunStep {
            run_id: self.run_id.clone(),
            task_id: self.task.id.clone(),
            step: step.clone(),
        });
    }

    async fn stopped(&self) {
        match self.deadline.get() {
            Some(deadline) => {
                tokio::select! {
                    _ = self.token.cancelled() => {}
                    _ = tokio::time::sleep_until(*deadline) => {
                        self.timed_out.store(true, Ordering::SeqCst);
                        self.token.cancel();
                    }
                }
            }
            None => self.token.cancelled().await,
        }
    }

    fn run_steps<'a>(
        &'a self,
        vars: &'a mut Vars,
        connections: &'a mut ConnectionCache,
        steps: &'a [Step],
        start: usize,
        depth: u8,
        iteration: Option<u32>,
    ) -> Boxed<'a, LevelEnd> {
        Box::pin(async move {
            let top = depth == 0;
            let mut pc = start;
            while pc < steps.len() {
                if self.token.is_cancelled() {
                    return LevelEnd::Stopped;
                }
                if self.executions.fetch_add(1, Ordering::SeqCst) + 1 > MAX_EXECUTIONS {
                    return LevelEnd::Failure(format!(
                        "Abbruch: mehr als {} Schrittausführungen.",
                        "10 000"
                    ));
                }
                let step = &steps[pc];
                let position = if top { pc + 1 } else { 0 };
                let mut step_error = None;
                let flow = if !step.enabled {
                    self.skip(step, depth, iteration).await;
                    step.on_success.clone()
                } else {
                    match self
                        .run_step(vars, connections, step, position, depth, iteration)
                        .await
                    {
                        (StepEnd::Done, flow) => flow.unwrap_or_else(|| step.on_success.clone()),
                        (StepEnd::Failed(error), _) => {
                            step_error = Some(error);
                            step.on_failure.clone()
                        }
                        (StepEnd::Stopped, _) => return LevelEnd::Stopped,
                    }
                };
                if top {
                    let summary = {
                        let mut summary = self.summary.lock().expect("Laufzusammenfassung");
                        summary.steps_done += 1;
                        summary.clone()
                    };
                    let _ = self.services.store.update_run(&summary).await;
                }
                match flow {
                    Flow::Next => pc += 1,
                    Flow::Goto { step_id } => match steps.iter().position(|s| s.id == step_id) {
                        Some(index) => pc = index,
                        None => {
                            return LevelEnd::Failure(format!(
                                "Sprungziel „{step_id}“ wurde nicht gefunden."
                            ))
                        }
                    },
                    Flow::EndSuccess => return LevelEnd::Success,
                    Flow::EndFailure => {
                        return LevelEnd::Failure(step_error.unwrap_or_else(|| {
                            format!(
                                "Schritt „{}“ hat den Lauf als fehlgeschlagen beendet.",
                                step.name
                            )
                        }))
                    }
                }
            }
            LevelEnd::Success
        })
    }

    fn step_run(&self, step: &Step, depth: u8, iteration: Option<u32>, attempt: u32) -> StepRun {
        StepRun {
            seq: self.seq.fetch_add(1, Ordering::SeqCst),
            step_id: step.id.clone(),
            step_name: step.name.clone(),
            kind: step.action.kind().to_string(),
            depth,
            iteration,
            attempt,
            status: RunStatus::Running,
            started_at: now(),
            ..StepRun::default()
        }
    }

    async fn skip(&self, step: &Step, depth: u8, iteration: Option<u32>) {
        let mut record = self.step_run(step, depth, iteration, 1);
        record.status = RunStatus::Skipped;
        record.finished_at = Some(record.started_at.clone());
        record.duration_ms = Some(0);
        record.message = Some("Schritt ist deaktiviert.".into());
        self.record(&record).await;
    }

    async fn attempt(
        &self,
        vars: &mut Vars,
        connections: &mut ConnectionCache,
        step: &Step,
        job_id: &str,
    ) -> Attempt {
        let token = self.token.child_token();
        let step_id = step.id.clone();
        let log = move |level: LogLevel, message: String| self.log(level, Some(&step_id), message);
        let mut ctx = StepContext {
            services: &self.services,
            run_id: &self.run_id,
            task: &self.task,
            step,
            vars,
            connections,
            cancel: token.clone(),
            job_id: job_id.to_string(),
            log: &log,
        };
        let options = ExecutionOptions {
            job_id: Some(job_id.to_string()),
            query_timeout: step
                .timeout_seconds
                .or(self.task.timeout_seconds)
                .filter(|seconds| *seconds > 0)
                .or(Some(execution::UNCLAMPED_MAX_SECONDS)),
            connection_timeout: None,
            max_rows: None,
            cancel_mode: None,
        };
        let work: Boxed<'_, Result<StepOutcome, String>> =
            Box::pin(crate::automation::steps::run(&mut ctx));
        let fut = execution::without_query_limit(execution::run(Some(options), true, work));
        tokio::pin!(fut);
        let limit = step.timeout_seconds;
        let step_timeout = async move {
            match limit {
                Some(seconds) => tokio::time::sleep(Duration::from_secs(seconds)).await,
                None => std::future::pending::<()>().await,
            }
        };
        tokio::select! {
            biased;
            _ = self.stopped() => {
                token.cancel();
                let _ = execution::cancel(job_id);
                let _ = tokio::time::timeout(GRACE, &mut fut).await;
                Attempt::Stopped
            }
            result = &mut fut => Attempt::Finished(result),
            _ = step_timeout => {
                token.cancel();
                let _ = execution::cancel(job_id);
                let _ = tokio::time::timeout(GRACE, &mut fut).await;
                Attempt::StepTimeout(limit.unwrap_or_default())
            }
        }
    }

    async fn run_step(
        &self,
        vars: &mut Vars,
        connections: &mut ConnectionCache,
        step: &Step,
        position: usize,
        depth: u8,
        iteration: Option<u32>,
    ) -> (StepEnd, Option<Flow>) {
        let policy = step.retry.as_ref().or(self.task.retry.as_ref());
        let retryable = !matches!(step.action, Action::Fail { .. } | Action::Condition { .. });
        let attempts = 1 + policy.filter(|_| retryable).map_or(0, |p| p.attempts);
        for attempt in 1..=attempts {
            self.current_depth.store(depth, Ordering::SeqCst);
            let mut record = self.step_run(step, depth, iteration, attempt);
            self.record(&record).await;
            let short: String = step.id.chars().take(64).collect();
            let job_id = format!("automation:{}:{short}:{attempt}", self.run_id);
            if let Ok(mut active) = self.active_job.lock() {
                *active = Some(job_id.clone());
            }
            let started = Instant::now();
            let result = self.attempt(vars, connections, step, &job_id).await;
            if let Ok(mut active) = self.active_job.lock() {
                *active = None;
            }
            self.current_depth.store(depth, Ordering::SeqCst);
            let elapsed = started.elapsed().as_millis() as u64;
            record.finished_at = Some(now());
            record.duration_ms = Some(elapsed);
            let set_duration = |vars: &mut Vars| {
                for prefix in [format!("step.{}", step.id), "last".to_string()]
                    .into_iter()
                    .chain((position > 0).then(|| format!("step.{position}")))
                {
                    vars.set(&format!("{prefix}.duration_ms"), elapsed.to_string());
                }
            };
            let (status, error) = match result {
                Attempt::Finished(Ok(outcome)) => {
                    let status = if outcome.warning.is_some() {
                        RunStatus::Warning
                    } else {
                        RunStatus::Success
                    };
                    if let Some(warning) = &outcome.warning {
                        self.warning.store(true, Ordering::SeqCst);
                        self.log(LogLevel::Warn, Some(&step.id), warning.clone());
                    }
                    vars.set_step(position, &step.id, &outcome, status, None);
                    set_duration(vars);
                    for (name, value) in &outcome.vars {
                        vars.set(name, value.clone());
                    }
                    if !outcome.outputs.is_empty() {
                        let _ = self
                            .services
                            .store
                            .add_outputs(&self.run_id, &outcome.outputs)
                            .await;
                        if let Ok(mut summary) = self.summary.lock() {
                            summary.outputs += outcome.outputs.len() as u32;
                        }
                    }
                    record.status = status;
                    record.rows = outcome.rows;
                    record.rows_affected = outcome.rows_affected;
                    record.message = outcome
                        .message
                        .clone()
                        .or_else(|| outcome.warning.clone())
                        .map(|m| self.mask(&m));
                    self.record(&record).await;
                    self.flush_logs().await;
                    return (StepEnd::Done, outcome.flow);
                }
                Attempt::Finished(Err(error)) => (RunStatus::Failed, self.mask(&error)),
                Attempt::StepTimeout(seconds) => (
                    RunStatus::Timeout,
                    format!("Zeitüberschreitung des Schritts nach {seconds} s."),
                ),
                Attempt::Stopped => {
                    let (status, error) = if self.timed_out.load(Ordering::SeqCst) {
                        (RunStatus::Timeout, "Zeitüberschreitung des Tasks.")
                    } else {
                        (RunStatus::Cancelled, "Abgebrochen.")
                    };
                    record.status = status;
                    record.error = Some(error.into());
                    vars.set_step(
                        position,
                        &step.id,
                        &StepOutcome::default(),
                        status,
                        Some(error),
                    );
                    set_duration(vars);
                    self.record(&record).await;
                    self.flush_logs().await;
                    return (StepEnd::Stopped, None);
                }
            };
            record.status = status;
            record.error = Some(error.clone());
            vars.set_step(
                position,
                &step.id,
                &StepOutcome::default(),
                status,
                Some(&error),
            );
            set_duration(vars);
            self.log(LogLevel::Error, Some(&step.id), error.clone());
            self.record(&record).await;
            if attempt < attempts {
                let delay = retry_delay(policy.expect("Retry-Policy"), attempt);
                self.log(
                    LogLevel::Info,
                    Some(&step.id),
                    format!(
                        "Neuer Versuch {} von {attempts} in {} s.",
                        attempt + 1,
                        delay.as_secs()
                    ),
                );
                self.flush_logs().await;
                tokio::select! {
                    _ = tokio::time::sleep(delay) => {}
                    _ = self.stopped() => return (StepEnd::Stopped, None),
                }
                continue;
            }
            self.flush_logs().await;
            return (StepEnd::Failed(error), None);
        }
        (StepEnd::Failed("Keine Versuche ausgeführt.".into()), None)
    }
}

pub(crate) fn depth(run_id: &str) -> u8 {
    runner(run_id).map_or(0, |r| r.task_depth)
}

pub(crate) fn call_path(run_id: &str) -> Vec<String> {
    runner(run_id).map(|r| r.path.clone()).unwrap_or_default()
}

pub(crate) fn queue_notification(run_id: &str, event: NotifyWhen) {
    if let Some(runner) = runner(run_id) {
        if let Ok(mut pending) = runner.pending.lock() {
            pending.push(event);
        }
    }
}

pub(crate) async fn run_nested(
    ctx: &mut StepContext<'_>,
    steps: &[Step],
    iteration: u32,
) -> Result<(), String> {
    let runner = runner(ctx.run_id).ok_or("Lauf ist nicht mehr aktiv.")?;
    let outer = runner.current_depth.load(Ordering::SeqCst);
    let end = runner
        .run_steps(
            ctx.vars,
            ctx.connections,
            steps,
            0,
            outer.saturating_add(1),
            Some(iteration),
        )
        .await;
    runner.current_depth.store(outer, Ordering::SeqCst);
    match end {
        LevelEnd::Success => Ok(()),
        LevelEnd::Failure(error) => Err(error),
        LevelEnd::Stopped => Err(if runner.timed_out.load(Ordering::SeqCst) {
            "Zeitüberschreitung des Tasks.".into()
        } else {
            "Abgebrochen.".into()
        }),
    }
}

async fn read_secret(account: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || crate::db::secrets::read_secret(&account))
        .await
        .map_err(|error| format!("Schlüsselbund-Zugriff fehlgeschlagen: {error}"))?
}

async fn build_vars(
    services: &Services,
    task: &Task,
    run_id: &str,
    environment: Option<&str>,
    overrides: &BTreeMap<String, String>,
    trigger: TriggerKind,
    timezone: Option<chrono_tz::Tz>,
) -> Result<Vars, String> {
    let mut secrets = BTreeMap::new();
    for variable in &task.variables {
        if variable.kind != VariableKind::Secret || overrides.contains_key(&variable.name) {
            continue;
        }
        let scoped = match environment
            .and_then(|name| task.environments.iter().find(|env| env.name == name))
        {
            Some(env) => read_secret(secret_account(&task.id, Some(env), variable)).await?,
            None => None,
        };
        let value = match scoped {
            Some(value) => Some(value),
            None => read_secret(secret_account(&task.id, None, variable)).await?,
        };
        if let Some(value) = value {
            secrets.insert(variable.name.clone(), value);
        }
    }
    let mut vars = Vars::new(task, run_id, environment, overrides, &secrets)?;
    vars.set_builtin("trigger", enum_text(&trigger));
    vars.set_timezone(timezone);
    let settings = services.store.settings().await?;
    vars.set_builtin(
        "output_dir",
        settings.default_output_dir.unwrap_or_default(),
    );
    Ok(vars)
}

async fn prepare(services: Services, request: RunRequest) -> Result<Prepared, StartError> {
    let store = services.store.clone();
    let task = match (&request.rerun_of, request.use_original_definition) {
        (Some(rerun_of), true) => {
            store
                .get_run(rerun_of)
                .await
                .map_err(StartError::Store)?
                .ok_or_else(|| StartError::NotFound(rerun_of.clone()))?
                .definition
        }
        _ => store.find_task(&request.task_id).await?,
    };
    if task.needs_review {
        return Err(StartError::NeedsReview);
    }
    if !task.enabled
        && !matches!(
            request.trigger,
            TriggerKind::Manual | TriggerKind::Cli | TriggerKind::Rerun
        )
    {
        return Err(StartError::Disabled);
    }
    let all = store.all_tasks().await.map_err(StartError::Store)?;
    if let Some(issue) = validate(&task, &all)
        .into_iter()
        .find(|issue| issue.severity == Severity::Error)
    {
        return Err(StartError::Invalid(issue.message));
    }
    if request.depth > MAX_DEPTH {
        return Err(StartError::Invalid(
            "Zu tiefe Verschachtelung von Tasks (max. 5).".into(),
        ));
    }
    let parent = request.parent_run_id.as_deref().and_then(runner);
    let mut path = parent.as_ref().map(|p| p.path.clone()).unwrap_or_default();
    if path.contains(&task.id) {
        return Err(StartError::Invalid(format!(
            "Zyklus: Task „{}“ ist bereits im Aufrufpfad.",
            task.name
        )));
    }
    path.push(task.id.clone());
    let schedule = request
        .trigger_detail
        .as_deref()
        .and_then(|detail| task.schedules.iter().find(|s| s.id == detail))
        .filter(|_| {
            matches!(
                request.trigger,
                TriggerKind::Schedule | TriggerKind::Background
            )
        });
    let environment = request
        .environment
        .clone()
        .or_else(|| schedule.and_then(|s| s.environment.clone()))
        .or_else(|| task.default_environment.clone())
        .filter(|env| !env.trim().is_empty());
    let mut overrides = schedule.map(|s| s.vars.clone()).unwrap_or_default();
    overrides.extend(request.vars.clone());
    let timezone = schedule
        .and_then(|s| s.timezone.as_deref())
        .and_then(|tz| tz.parse::<chrono_tz::Tz>().ok());
    let run_id = new_run_id();
    if !store
        .take_lease(&task.id, &run_id)
        .await
        .map_err(StartError::Store)?
    {
        let running = store
            .running_run(&task.id)
            .await
            .ok()
            .flatten()
            .unwrap_or_default();
        return Err(StartError::AlreadyRunning(running));
    }
    let vars = build_vars(
        &services,
        &task,
        &run_id,
        environment.as_deref(),
        &overrides,
        request.trigger,
        timezone,
    )
    .await;
    let summary = RunSummary {
        id: run_id.clone(),
        task_id: task.id.clone(),
        task_name: task.name.clone(),
        trigger: request.trigger,
        trigger_detail: request.trigger_detail.clone(),
        status: RunStatus::Running,
        started_at: now(),
        environment: environment.clone(),
        rerun_of: request.rerun_of.clone(),
        parent_run_id: request.parent_run_id.clone(),
        steps_total: task.steps.len() as u32,
        ..RunSummary::default()
    };
    let snapshot = match &vars {
        Ok(vars) => vars.snapshot(),
        Err(_) => overrides.clone(),
    };
    if let Err(error) = store.insert_run(&summary, &snapshot, &task).await {
        let _ = store.release_lease(&task.id, &run_id).await;
        return Err(StartError::Store(error));
    }
    let start = request
        .from_step
        .as_deref()
        .and_then(|id| task.steps.iter().position(|s| s.id == id))
        .unwrap_or(0);
    let token = parent
        .as_ref()
        .map(|p| p.token.child_token())
        .unwrap_or_default();
    let runner = Arc::new(Runner {
        services: services.clone(),
        task,
        run_id: run_id.clone(),
        token,
        deadline: OnceLock::new(),
        timed_out: AtomicBool::new(false),
        seq: AtomicU32::new(0),
        executions: AtomicU32::new(0),
        current_depth: AtomicU8::new(0),
        task_depth: request.depth,
        path,
        active_job: Mutex::new(None),
        logs: Mutex::new(LogBuffer::default()),
        masker: OnceLock::new(),
        warning: AtomicBool::new(false),
        pending: Mutex::new(Vec::new()),
        summary: Mutex::new(summary.clone()),
    });
    if let Ok(vars) = &vars {
        let _ = runner.masker.set(vars.clone());
    }
    if let Ok(mut runs) = registry().lock() {
        runs.insert(run_id, runner.clone());
    }
    services.emit(AutomationEvent::RunStarted { run: summary });
    Ok(Prepared {
        runner,
        vars,
        start,
    })
}

async fn drive(prepared: Prepared) -> RunSummary {
    let Prepared {
        runner,
        vars,
        start,
    } = prepared;
    let services = runner.services.clone();
    let heartbeat = {
        let services = services.clone();
        let (task_id, run_id) = (runner.task.id.clone(), runner.run_id.clone());
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(HEARTBEAT).await;
                let _ = services.store.renew_lease(&task_id, &run_id).await;
            }
        })
    };
    let mut permit = None;
    let mut stopped_early = false;
    if runner.task_depth == 0 {
        let limit = services
            .store
            .settings()
            .await
            .ok()
            .and_then(|s| s.max_parallel_runs)
            .unwrap_or(4);
        let semaphore = slots(limit);
        permit = match semaphore.clone().try_acquire_owned() {
            Ok(permit) => Some(permit),
            Err(_) => {
                runner.log(
                    LogLevel::Info,
                    None,
                    "Wartet auf freien Ausführungsplatz.".into(),
                );
                runner.flush_logs().await;
                tokio::select! {
                    permit = semaphore.acquire_owned() => permit.ok(),
                    _ = runner.token.cancelled() => {
                        stopped_early = true;
                        None
                    }
                }
            }
        };
    }
    if let Some(seconds) = runner.task.timeout_seconds.filter(|s| *s > 0) {
        let _ = runner
            .deadline
            .set(tokio::time::Instant::now() + Duration::from_secs(seconds));
    }
    let started = Instant::now();
    let end = match vars {
        _ if stopped_early => LevelEnd::Stopped,
        Err(error) => LevelEnd::Failure(error),
        Ok(mut vars) => {
            let mut connections = ConnectionCache::new();
            let steps = runner.task.steps.clone();
            let end = runner
                .run_steps(&mut vars, &mut connections, &steps, start, 0, None)
                .await;
            if matches!(end, LevelEnd::Stopped) && !runner.timed_out.load(Ordering::SeqCst) {
                if let Some(deadline) = runner.deadline.get() {
                    if tokio::time::Instant::now() >= *deadline {
                        runner.timed_out.store(true, Ordering::SeqCst);
                    }
                }
            }
            end
        }
    };
    drop(permit);
    let summary = finalize(&runner, end, started).await;
    heartbeat.abort();
    summary
}

async fn finalize(runner: &Arc<Runner>, end: LevelEnd, started: Instant) -> RunSummary {
    let services = &runner.services;
    let store = &services.store;
    let task = &runner.task;
    let (status, error) = match end {
        LevelEnd::Success if runner.warning.load(Ordering::SeqCst) => (RunStatus::Warning, None),
        LevelEnd::Success => (RunStatus::Success, None),
        LevelEnd::Failure(error) => (RunStatus::Failed, Some(error)),
        LevelEnd::Stopped if runner.timed_out.load(Ordering::SeqCst) => (
            RunStatus::Timeout,
            Some(format!(
                "Zeitüberschreitung des Tasks nach {} s.",
                task.timeout_seconds.unwrap_or_default()
            )),
        ),
        LevelEnd::Stopped => (
            RunStatus::Cancelled,
            Some("Lauf wurde abgebrochen.".to_string()),
        ),
    };
    let summary = {
        let mut summary = runner.summary.lock().expect("Laufzusammenfassung");
        summary.status = status;
        summary.error = error.map(|e| runner.mask(&e));
        summary.finished_at = Some(now());
        summary.duration_ms = Some(started.elapsed().as_millis() as u64);
        summary.clone()
    };
    if let Some(error) = &summary.error {
        if status != RunStatus::Failed {
            runner.log(LogLevel::Warn, None, error.clone());
        }
    }
    runner.flush_logs().await;
    let _ = store.update_run(&summary).await;
    if let Ok(state) = store.record_finish(&summary).await {
        let limit = task.max_consecutive_failures.filter(|n| *n > 0);
        if let Some(limit) = limit {
            let enabled = store
                .get_task(&task.id)
                .await
                .ok()
                .flatten()
                .is_some_and(|t| t.enabled);
            if enabled
                && matches!(status, RunStatus::Failed | RunStatus::Timeout)
                && state.consecutive_failures >= limit
            {
                let reason = format!("Nach {limit} Fehlern in Folge automatisch deaktiviert.");
                if store
                    .set_enabled(&task.id, false, Some(reason.clone()))
                    .await
                    .is_ok()
                {
                    runner.log(LogLevel::Warn, None, reason);
                    services.emit(AutomationEvent::TasksChanged {
                        ids: vec![task.id.clone()],
                    });
                }
            }
        }
    }
    let event = match status {
        RunStatus::Success => Some(NotifyWhen::Success),
        RunStatus::Warning => Some(NotifyWhen::Warning),
        RunStatus::Failed | RunStatus::Timeout => Some(NotifyWhen::Failure),
        _ => None,
    };
    let pending = runner
        .pending
        .lock()
        .map(|mut p| std::mem::take(&mut *p))
        .unwrap_or_default();
    let events: Vec<NotifyWhen> = event.into_iter().chain(pending).collect();
    if !events.is_empty() {
        runner.flush_logs().await;
        if let Ok(Some(detail)) = store.get_run(&summary.id).await {
            for event in events {
                for problem in
                    crate::automation::notify::dispatch(services, task, &detail, event).await
                {
                    runner.log(
                        LogLevel::Warn,
                        None,
                        format!("Benachrichtigung fehlgeschlagen: {problem}"),
                    );
                }
            }
        }
    }
    runner.flush_logs().await;
    let retention = match &task.retention {
        Some(retention) => retention.clone(),
        None => store
            .settings()
            .await
            .ok()
            .and_then(|s| s.default_retention)
            .unwrap_or(Retention {
                keep_days: None,
                keep_runs: None,
            }),
    };
    let _ = store.apply_retention(&task.id, &retention).await;
    let _ = store.release_lease(&task.id, &summary.id).await;
    if let Ok(mut runs) = registry().lock() {
        runs.remove(&summary.id);
    }
    services.emit(AutomationEvent::RunFinished {
        run: summary.clone(),
    });
    crate::automation::scheduler::on_run_finished(services, &summary).await;
    summary
}

pub async fn start(services: Services, request: RunRequest) -> Result<String, StartError> {
    let prepared = prepare(services, request).await?;
    let run_id = prepared.runner.run_id.clone();
    tokio::spawn(drive(prepared));
    Ok(run_id)
}

pub async fn execute(services: Services, request: RunRequest) -> Result<RunSummary, StartError> {
    let prepared = prepare(services, request).await?;
    Ok(drive(prepared).await)
}

pub fn cancel(run_id: &str) -> bool {
    let Some(runner) = runner(run_id) else {
        return false;
    };
    runner.token.cancel();
    let job = runner.active_job.lock().ok().and_then(|job| job.clone());
    if let Some(job) = job {
        let _ = execution::cancel(&job);
    }
    runner.log(LogLevel::Warn, None, "Abbruch angefordert.".into());
    true
}

fn issue(step: Option<&Step>, field: &str, message: String, severity: Severity) -> ValidationIssue {
    ValidationIssue {
        step_id: step.map(|s| s.id.clone()),
        field: field.into(),
        message,
        severity,
    }
}

fn unsafe_placeholders(sql: &str) -> bool {
    static PATTERN: OnceLock<regex::Regex> = OnceLock::new();
    PATTERN
        .get_or_init(|| regex::Regex::new(r"\$\{\s*(?:item|step)[.}][^}|]*\}").expect("Muster"))
        .is_match(sql)
}

fn validate_level(
    task: &Task,
    all: &[Task],
    steps: &[Step],
    seen: &mut HashSet<String>,
    issues: &mut Vec<ValidationIssue>,
) {
    let ids: HashSet<&str> = steps.iter().map(|s| s.id.as_str()).collect();
    for step in steps {
        let mut error = |field: &str, message: &str| {
            issues.push(issue(
                Some(step),
                field,
                message.to_string(),
                Severity::Error,
            ))
        };
        if step.id.trim().is_empty() {
            error("id", "Schritt ohne ID.");
        } else if !seen.insert(step.id.clone()) {
            error("id", &format!("Schritt-ID „{}“ ist doppelt.", step.id));
        }
        let mut flows = vec![
            ("onSuccess", &step.on_success),
            ("onFailure", &step.on_failure),
        ];
        if let Action::Condition {
            then, otherwise, ..
        } = &step.action
        {
            flows.push(("then", then));
            flows.push(("otherwise", otherwise));
        }
        for (field, flow) in flows {
            if let Flow::Goto { step_id } = flow {
                if !ids.contains(step_id.as_str()) {
                    error(
                        field,
                        &format!("Sprungziel „{step_id}“ liegt nicht auf derselben Ebene."),
                    );
                }
            }
        }
        let blank = |value: &str| value.trim().is_empty();
        match &step.action {
            Action::Sql {
                connections,
                sql,
                file,
                ..
            } => {
                if connections.iter().all(|c| blank(c)) {
                    error("connections", "Verbindung fehlt.");
                }
                if blank(sql) && file.as_deref().is_none_or(blank) {
                    error("sql", "SQL fehlt.");
                }
                if unsafe_placeholders(sql) {
                    issues.push(issue(
                        Some(step),
                        "sql",
                        "Wert wird ungeprüft eingesetzt. Nutze |sql in String-Literalen.".into(),
                        Severity::Warning,
                    ));
                }
            }
            Action::Export {
                connection,
                format,
                output,
                ..
            } => {
                if blank(connection) {
                    error("connection", "Verbindung fehlt.");
                }
                if blank(&output.path) {
                    error("output.path", "Zielpfad fehlt.");
                }
                use crate::automation::model::{ExportFormat, IfExists};
                if output.if_exists == IfExists::Append
                    && !matches!(
                        format,
                        ExportFormat::Csv
                            | ExportFormat::Tsv
                            | ExportFormat::Jsonl
                            | ExportFormat::Markdown
                            | ExportFormat::Sql
                    )
                {
                    error(
                        "output.ifExists",
                        "Anhängen ist nur für CSV, TSV, JSONL, Markdown und SQL möglich.",
                    );
                }
            }
            Action::Backup {
                connection, output, ..
            } => {
                if blank(connection) {
                    error("connection", "Verbindung fehlt.");
                }
                if blank(&output.path) {
                    error("output.path", "Zielpfad fehlt.");
                }
            }
            Action::Restore {
                connection, path, ..
            } => {
                if blank(connection) {
                    error("connection", "Verbindung fehlt.");
                }
                if blank(path) {
                    error("path", "Pfad fehlt.");
                }
            }
            Action::Datagen { connection, .. }
            | Action::Import { connection, .. }
            | Action::Check { connection, .. }
            | Action::Alert { connection, .. } => {
                if blank(connection) {
                    error("connection", "Verbindung fehlt.");
                }
                if let Action::Check {
                    check: crate::automation::model::CheckSpec::AcceptedValues { values, .. },
                    ..
                } = &step.action
                {
                    if values.is_empty() {
                        error("check.values", "Keine erlaubten Werte angegeben.");
                    }
                }
            }
            Action::Transfer { source, target, .. } | Action::TableCopy { source, target, .. } => {
                if blank(source) {
                    error("source", "Quellverbindung fehlt.");
                }
                if blank(target) {
                    error("target", "Zielverbindung fehlt.");
                }
            }
            Action::Compare {
                left,
                right,
                key_columns,
                ..
            } => {
                if blank(&left.connection) || blank(&right.connection) {
                    error("connection", "Verbindung fehlt.");
                }
                if key_columns.is_empty() {
                    error("keyColumns", "Schlüsselspalten fehlen.");
                }
            }
            Action::Shell { program, .. } => {
                if blank(program) {
                    error("program", "Programm fehlt.");
                }
            }
            Action::Http {
                url, expect_status, ..
            } => {
                if blank(url) {
                    error("url", "URL fehlt.");
                }
                if let Some(spec) = expect_status.as_deref().filter(|s| !blank(s)) {
                    if let Err(message) = crate::automation::steps::http::parse_expect(spec) {
                        error("expectStatus", &message);
                    }
                }
            }
            Action::FileCopy { from, to, .. } | Action::FileMove { from, to, .. } => {
                if blank(from) || blank(to) {
                    error("path", "Quelle und Ziel sind Pflichtfelder.");
                }
            }
            Action::FileDelete { path }
            | Action::Mkdir { path }
            | Action::FileExists { path, .. } => {
                if blank(path) {
                    error("path", "Pfad fehlt.");
                }
            }
            Action::Zip { sources, output } => {
                if sources.iter().all(|s| blank(s)) {
                    error("sources", "Quellen fehlen.");
                }
                if blank(&output.path) {
                    error("output.path", "Zielpfad fehlt.");
                }
            }
            Action::Unzip {
                archive, target, ..
            } => {
                if blank(archive) || blank(target) {
                    error("archive", "Archiv und Zielordner sind Pflichtfelder.");
                }
            }
            Action::Cleanup { dir, .. } => {
                if blank(dir) {
                    error("dir", "Ordner fehlt.");
                }
            }
            Action::Wait { seconds, until } => {
                match (seconds, until.as_deref().filter(|u| !blank(u))) {
                    (_, Some(until)) => {
                        if !until.contains("${")
                            && chrono::NaiveTime::parse_from_str(until.trim(), "%H:%M").is_err()
                        {
                            error("until", "Uhrzeit im Format HH:MM angeben.");
                        }
                    }
                    (Some(seconds), None) => {
                        if *seconds > 24 * 3600 {
                            error("seconds", "Wartezeit ist länger als 24 Stunden.");
                        }
                    }
                    (None, None) => error("seconds", "Wartezeit fehlt."),
                }
            }
            Action::SetVariable { name, query, .. } => {
                if !valid_name(name) {
                    error("name", &format!("Ungültiger Variablenname „{name}“."));
                }
                if query
                    .as_ref()
                    .is_some_and(|q| blank(&q.connection) || blank(&q.sql))
                {
                    error("query", "Verbindung und SQL sind Pflichtfelder.");
                }
            }
            Action::Loop { over, steps, .. } => {
                if let LoopSource::Query {
                    connection, sql, ..
                } = over
                {
                    if blank(connection) || blank(sql) {
                        error("over", "Verbindung und SQL sind Pflichtfelder.");
                    }
                }
                if steps.is_empty() {
                    issues.push(issue(
                        Some(step),
                        "steps",
                        "Schleife enthält keine Schritte.".into(),
                        Severity::Warning,
                    ));
                }
                validate_level(task, all, steps, seen, issues);
            }
            Action::RunTask { task: target, .. } => {
                let target = target.trim();
                if target.is_empty() {
                    error("task", "Task fehlt.");
                } else if !target.contains("${") {
                    let found = all.iter().find(|t| t.id == target).or_else(|| {
                        all.iter()
                            .find(|t| t.name.trim().eq_ignore_ascii_case(target))
                    });
                    let is_self = target == task.id
                        || target.eq_ignore_ascii_case(task.name.trim())
                        || found.is_some_and(|t| t.id == task.id);
                    if is_self {
                        error("task", "Ein Task kann sich nicht selbst starten.");
                    } else if found.is_none() {
                        error("task", &format!("Task „{target}“ existiert nicht."));
                    }
                }
            }
            Action::Notify { .. }
            | Action::Log { .. }
            | Action::Fail { .. }
            | Action::Condition { .. } => {}
        }
    }
}

pub fn validate(task: &Task, all: &[Task]) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    if task.name.trim().is_empty() {
        issues.push(issue(None, "name", "Name fehlt.".into(), Severity::Error));
    }
    let mut names = HashSet::new();
    for variable in &task.variables {
        if !valid_name(&variable.name) {
            issues.push(issue(
                None,
                "variables",
                format!("Ungültiger Variablenname „{}“.", variable.name),
                Severity::Error,
            ));
        } else if !names.insert(variable.name.clone()) {
            issues.push(issue(
                None,
                "variables",
                format!("Variable „{}“ ist doppelt.", variable.name),
                Severity::Error,
            ));
        }
    }
    if let Some(env) = task
        .default_environment
        .as_deref()
        .filter(|e| !e.is_empty())
    {
        if !task.environments.iter().any(|e| e.name == env) {
            issues.push(issue(
                None,
                "defaultEnvironment",
                format!("Umgebung „{env}“ existiert nicht."),
                Severity::Error,
            ));
        }
    }
    for schedule in &task.schedules {
        if let Err(message) = crate::automation::schedule::validate(schedule) {
            issues.push(issue(None, "schedules", message, Severity::Error));
        }
    }
    let mut seen = HashSet::new();
    validate_level(task, all, &task.steps, &mut seen, &mut issues);
    issues
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::automation::model::AutomationConnection;
    use crate::automation::store::Store;
    use crate::db::DatabaseKind;
    use serde_json::json;
    use std::path::PathBuf;

    pub struct TestDb {
        pub path: PathBuf,
    }

    pub struct Harness {
        pub dir: tempfile::TempDir,
        pub services: Services,
        pub db: TestDb,
        pub events: Arc<Mutex<Vec<AutomationEvent>>>,
    }

    pub fn step(id: &str, action: serde_json::Value) -> Step {
        serde_json::from_value(json!({ "id": id, "name": id, "action": action })).unwrap()
    }

    pub fn task(id: &str, name: &str, steps: Vec<Step>) -> Task {
        let mut task: Task = serde_json::from_value(json!({ "id": id, "name": name })).unwrap();
        task.steps = steps;
        task
    }

    pub async fn harness() -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("automation.db")).unwrap();
        let path = dir.path().join("test.db");
        let db = TestDb { path };
        db.exec(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER, status TEXT, note TEXT);
             INSERT INTO items (name, qty, status, note) VALUES ('a', 1, 'open', 'x'), ('b', 3, 'open', 'y'), ('c', 6, 'it''s done', NULL);",
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink_events = events.clone();
        let services = Services::new(
            store,
            Arc::new(move |event| sink_events.lock().unwrap().push(event)),
            true,
        );
        db.add_connection(
            &services,
            "db",
            "Testdb",
            DatabaseKind::Sqlite,
            &db.path.to_string_lossy(),
        )
        .await;
        Harness {
            dir,
            services,
            db,
            events,
        }
    }

    impl TestDb {
        pub fn exec(&self, sql: &str) {
            rusqlite::Connection::open(&self.path)
                .unwrap()
                .execute_batch(sql)
                .unwrap();
        }

        pub async fn add_connection(
            &self,
            services: &Services,
            id: &str,
            name: &str,
            kind: DatabaseKind,
            url: &str,
        ) {
            let mut list = services.store.connections().await.unwrap();
            list.push(AutomationConnection {
                id: id.into(),
                name: name.into(),
                kind,
                connection_string: url.into(),
                read_only: false,
                production_locked: false,
                environment: None,
                tags: vec!["lab".into()],
                ssh: None,
                proxy: None,
                command_tunnel: None,
                vault: false,
            });
            services.store.replace_connections(list).await.unwrap();
        }

        pub async fn save_task(&self, services: &Services, task: Task) -> Task {
            let revision = services
                .store
                .get_task(&task.id)
                .await
                .unwrap()
                .map(|t| t.revision);
            services.store.save_task(task, revision).await.unwrap()
        }

        pub async fn save(&self, services: &Services, steps: Vec<Step>) -> Task {
            self.save_task(services, task("task", "Test Task", steps))
                .await
        }

        pub fn request(&self, task: &Task) -> RunRequest {
            RunRequest {
                task_id: task.id.clone(),
                trigger: TriggerKind::Manual,
                ..RunRequest::default()
            }
        }

        pub async fn run(&self, services: &Services, steps: Vec<Step>) -> RunSummary {
            let task = self.save(services, steps).await;
            execute(services.clone(), self.request(&task))
                .await
                .unwrap()
        }

        pub async fn wait_finished(&self, services: &Services, run_id: &str) -> RunSummary {
            for _ in 0..1000 {
                if let Some(detail) = services.store.get_run(run_id).await.unwrap() {
                    if detail.summary.status != RunStatus::Running && runner(run_id).is_none() {
                        return detail.summary;
                    }
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            panic!("Lauf {run_id} endet nicht");
        }
    }

    async fn steps_of(h: &Harness, run_id: &str) -> Vec<StepRun> {
        h.services
            .store
            .get_run(run_id)
            .await
            .unwrap()
            .unwrap()
            .steps
    }

    fn fails() -> serde_json::Value {
        json!({ "type": "sql", "connections": ["db"], "sql": "SELECT * FROM missing_table" })
    }

    fn log(message: &str) -> serde_json::Value {
        json!({ "type": "log", "message": message })
    }

    fn assert_var(name: &str, expected: &str) -> Step {
        step(
            &format!("assert-{name}"),
            json!({ "type": "condition", "left": format!("${{{name}}}"), "op": "eq", "right": expected, "then": { "type": "next" }, "otherwise": { "type": "end_failure" } }),
        )
    }

    #[tokio::test]
    async fn sql_then_csv_export_end_to_end() {
        let h = harness().await;
        let out = h.dir.path().join("out");
        std::fs::create_dir(&out).unwrap();
        let mut settings = h.services.store.settings().await.unwrap();
        settings.default_output_dir = Some(out.to_string_lossy().into_owned());
        h.services.store.save_settings(&settings).await.unwrap();
        let run = h
            .db
            .run(
                &h.services,
                vec![
                    step("create", json!({ "type": "sql", "connections": ["db"], "sql": "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer TEXT, total REAL); INSERT INTO orders (customer, total) VALUES ('Anna', 12.5), ('Ben, B.', 7);" })),
                    step("export", json!({ "type": "export", "connection": "db", "source": { "type": "query", "sql": "SELECT id, customer, total FROM orders ORDER BY id" }, "format": "csv", "output": { "path": "${output_dir}/orders.csv" } })),
                ],
            )
            .await;
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
        let text = std::fs::read_to_string(out.join("orders.csv")).unwrap();
        assert_eq!(text, "id,customer,total\n1,Anna,12.5\n2,\"Ben, B.\",7.0");
    }

    #[tokio::test]
    async fn compare_without_columns_compares_all_non_key_columns() {
        let h = harness().await;
        h.db.exec("CREATE TABLE items2 AS SELECT * FROM items; UPDATE items2 SET note = 'z' WHERE id = 1;");
        let side = |table: &str| json!({ "connection": "db", "schema": "main", "table": table });
        let run = h
            .db
            .run(
                &h.services,
                vec![step("cmp", json!({ "type": "compare", "left": side("items"), "right": side("items2"), "keyColumns": ["id"], "failIfDifferent": true }))],
            )
            .await;
        assert_eq!(run.status, RunStatus::Failed);
        assert!(run.error.unwrap_or_default().contains("1 geändert"));
    }

    #[tokio::test]
    async fn sequence_records_steps_logs_and_events() {
        let h = harness().await;
        let run = h
            .db
            .run(
                &h.services,
                vec![
                    step("a", log("eins ${task}")),
                    step("b", json!({ "type": "sql", "connections": ["db"], "sql": "UPDATE items SET qty = qty + 1" })),
                    step("c", log("zwei ${step.2.rows_affected}")),
                ],
            )
            .await;
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
        assert_eq!(run.steps_total, 3);
        assert_eq!(run.steps_done, 3);
        let detail = h.services.store.get_run(&run.id).await.unwrap().unwrap();
        let finished: Vec<_> = detail
            .steps
            .iter()
            .map(|s| (s.step_id.as_str(), s.status))
            .collect();
        assert_eq!(
            finished,
            vec![
                ("a", RunStatus::Success),
                ("b", RunStatus::Success),
                ("c", RunStatus::Success)
            ]
        );
        assert_eq!(detail.steps[1].rows_affected, Some(3));
        let messages: Vec<_> = detail.logs.iter().map(|l| l.message.as_str()).collect();
        assert!(messages.contains(&"eins Test Task"));
        assert!(messages.contains(&"zwei 3"));
        let events = h.events.lock().unwrap();
        assert!(matches!(
            events.first(),
            Some(AutomationEvent::RunStarted { .. })
        ));
        assert!(events.iter().any(|e| matches!(e, AutomationEvent::RunFinished { run } if run.status == RunStatus::Success)));
    }

    #[tokio::test]
    async fn on_failure_next_continues_and_end_failure_stops() {
        let h = harness().await;
        let mut first = step("a", fails());
        first.on_failure = Flow::Next;
        let run =
            h.db.run(
                &h.services,
                vec![first, step("b", log("weiter ${last.status}"))],
            )
            .await;
        assert_eq!(run.status, RunStatus::Success);
        assert_eq!(run.error, None);
        let steps = steps_of(&h, &run.id).await;
        assert_eq!(steps[0].status, RunStatus::Failed);
        assert!(steps[0].error.as_deref().unwrap().contains("missing_table"));
        let run =
            h.db.run(&h.services, vec![step("a", fails()), step("b", log("nie"))])
                .await;
        assert_eq!(run.status, RunStatus::Failed);
        assert!(run.error.unwrap().contains("missing_table"));
        assert_eq!(steps_of(&h, &run.id).await.len(), 1);
    }

    #[tokio::test]
    async fn goto_forward_backward_and_loop_guard() {
        let h = harness().await;
        let mut jump = step(
            "start",
            json!({ "type": "set_variable", "name": "n", "value": "0" }),
        );
        jump.on_success = Flow::Goto {
            step_id: "inc".into(),
        };
        let run = h
            .db
            .run(
                &h.services,
                vec![
                    jump,
                    step("skipped", json!({ "type": "fail", "message": "übersprungen" })),
                    step("inc", json!({ "type": "set_variable", "name": "n", "value": "${n} + 1", "calculate": true })),
                    step("again", json!({ "type": "condition", "left": "${n}", "op": "lt", "right": "3", "then": { "type": "goto", "stepId": "inc" }, "otherwise": { "type": "next" } })),
                    assert_var("n", "3"),
                ],
            )
            .await;
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
        let mut forever = step(
            "spin",
            json!({ "type": "set_variable", "name": "x", "value": "1" }),
        );
        forever.on_success = Flow::Goto {
            step_id: "spin".into(),
        };
        let run = h.db.run(&h.services, vec![forever]).await;
        assert_eq!(run.status, RunStatus::Failed);
        assert_eq!(
            run.error.as_deref(),
            Some("Abbruch: mehr als 10 000 Schrittausführungen.")
        );
    }

    #[test]
    fn retry_delay_fixed_exponential_and_capped() {
        let policy = |backoff, max| RetryPolicy {
            attempts: 5,
            delay_seconds: 10,
            backoff,
            max_delay_seconds: max,
        };
        use crate::automation::model::Backoff;
        assert_eq!(
            retry_delay(&policy(Backoff::Fixed, None), 3),
            Duration::from_secs(10)
        );
        assert_eq!(
            retry_delay(&policy(Backoff::Exponential, None), 1),
            Duration::from_secs(10)
        );
        assert_eq!(
            retry_delay(&policy(Backoff::Exponential, None), 3),
            Duration::from_secs(40)
        );
        assert_eq!(
            retry_delay(&policy(Backoff::Exponential, Some(25)), 3),
            Duration::from_secs(25)
        );
        assert_eq!(
            retry_delay(&policy(Backoff::Exponential, None), 40),
            Duration::from_secs(3600)
        );
    }

    #[tokio::test]
    async fn retry_records_each_attempt_with_measured_pauses() {
        let h = harness().await;
        let mut failing = step("a", fails());
        failing.retry = Some(RetryPolicy {
            attempts: 2,
            delay_seconds: 0,
            backoff: Default::default(),
            max_delay_seconds: None,
        });
        let run = h.db.run(&h.services, vec![failing.clone()]).await;
        assert_eq!(run.status, RunStatus::Failed);
        let attempts: Vec<_> = steps_of(&h, &run.id)
            .await
            .iter()
            .map(|s| s.attempt)
            .collect();
        assert_eq!(attempts, vec![1, 2, 3]);

        let mut task = task("task", "Test Task", vec![failing.clone()]);
        task.steps[0].retry = None;
        task.retry = Some(RetryPolicy {
            attempts: 1,
            delay_seconds: 1,
            backoff: Default::default(),
            max_delay_seconds: None,
        });
        let task = h.db.save_task(&h.services, task).await;
        let started = Instant::now();
        let run = execute(h.services.clone(), h.db.request(&task))
            .await
            .unwrap();
        assert!(started.elapsed() >= Duration::from_secs(1));
        assert_eq!(steps_of(&h, &run.id).await.len(), 2);

        failing.retry = Some(RetryPolicy {
            attempts: 2,
            delay_seconds: 1,
            backoff: crate::automation::model::Backoff::Exponential,
            max_delay_seconds: None,
        });
        let started = Instant::now();
        let run = h.db.run(&h.services, vec![failing]).await;
        let elapsed = started.elapsed();
        assert!(elapsed >= Duration::from_secs(3), "{elapsed:?}");
        assert!(elapsed < Duration::from_secs(6), "{elapsed:?}");
        assert_eq!(steps_of(&h, &run.id).await.len(), 3);

        let mut no_retry = step("f", json!({ "type": "fail", "message": "Stop ${task}" }));
        no_retry.retry = Some(RetryPolicy {
            attempts: 3,
            delay_seconds: 0,
            backoff: Default::default(),
            max_delay_seconds: None,
        });
        let run = h.db.run(&h.services, vec![no_retry]).await;
        assert_eq!(run.error.as_deref(), Some("Stop Test Task"));
        assert_eq!(steps_of(&h, &run.id).await.len(), 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn retry_succeeds_on_second_attempt() {
        let h = harness().await;
        let marker = h.dir.path().join("marker");
        let mut flaky = step(
            "a",
            json!({ "type": "shell", "program": "sh", "args": ["-c", format!("test -f '{0}' || {{ touch '{0}'; exit 1; }}", marker.display())] }),
        );
        flaky.retry = Some(RetryPolicy {
            attempts: 3,
            delay_seconds: 0,
            backoff: Default::default(),
            max_delay_seconds: None,
        });
        let run = h.db.run(&h.services, vec![flaky]).await;
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
        let statuses: Vec<_> = steps_of(&h, &run.id)
            .await
            .iter()
            .map(|s| s.status)
            .collect();
        assert_eq!(statuses, vec![RunStatus::Failed, RunStatus::Success]);
    }

    #[tokio::test]
    async fn step_timeout_and_task_timeout() {
        let h = harness().await;
        let mut slow = step("w", json!({ "type": "wait", "seconds": 30 }));
        slow.timeout_seconds = Some(1);
        let started = Instant::now();
        let run = h.db.run(&h.services, vec![slow]).await;
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(run.status, RunStatus::Failed);
        assert_eq!(steps_of(&h, &run.id).await[0].status, RunStatus::Timeout);

        let mut task = task(
            "task",
            "Test Task",
            vec![step("w", json!({ "type": "wait", "seconds": 30 }))],
        );
        task.timeout_seconds = Some(1);
        let task = h.db.save_task(&h.services, task).await;
        let started = Instant::now();
        let run = execute(h.services.clone(), h.db.request(&task))
            .await
            .unwrap();
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(run.status, RunStatus::Timeout);
        assert_eq!(steps_of(&h, &run.id).await[0].status, RunStatus::Timeout);
        assert_eq!(
            h.services
                .store
                .task_state("task")
                .await
                .unwrap()
                .consecutive_failures,
            2
        );
    }

    #[tokio::test]
    async fn cancel_during_step_and_during_retry_pause() {
        let h = harness().await;
        let task =
            h.db.save(
                &h.services,
                vec![step("w", json!({ "type": "wait", "seconds": 30 }))],
            )
            .await;
        let started = Instant::now();
        let run_id = start(h.services.clone(), h.db.request(&task))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(cancel(&run_id));
        let run = h.db.wait_finished(&h.services, &run_id).await;
        assert_eq!(run.status, RunStatus::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(!cancel(&run_id));

        let mut failing = step("a", fails());
        failing.retry = Some(RetryPolicy {
            attempts: 3,
            delay_seconds: 30,
            backoff: Default::default(),
            max_delay_seconds: None,
        });
        let task = h.db.save(&h.services, vec![failing]).await;
        let started = Instant::now();
        let run_id = start(h.services.clone(), h.db.request(&task))
            .await
            .unwrap();
        loop {
            let steps = steps_of(&h, &run_id).await;
            if steps.first().is_some_and(|s| s.status == RunStatus::Failed) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(cancel(&run_id));
        let run = h.db.wait_finished(&h.services, &run_id).await;
        assert_eq!(run.status, RunStatus::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(10));
        assert_eq!(steps_of(&h, &run_id).await.len(), 1);
    }

    #[tokio::test]
    async fn from_step_and_disabled_steps() {
        let h = harness().await;
        let mut disabled = step("off", json!({ "type": "fail", "message": "aus" }));
        disabled.enabled = false;
        let task =
            h.db.save(
                &h.services,
                vec![
                    step("a", json!({ "type": "fail", "message": "nie" })),
                    disabled,
                    step("c", log("ok")),
                ],
            )
            .await;
        let mut request = h.db.request(&task);
        request.from_step = Some("off".into());
        let run = execute(h.services.clone(), request).await.unwrap();
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
        let steps = steps_of(&h, &run.id).await;
        let seen: Vec<_> = steps
            .iter()
            .map(|s| (s.step_id.as_str(), s.status))
            .collect();
        assert_eq!(
            seen,
            vec![("off", RunStatus::Skipped), ("c", RunStatus::Success)]
        );
    }

    #[tokio::test]
    async fn lease_prevents_parallel_run() {
        let h = harness().await;
        let task =
            h.db.save(
                &h.services,
                vec![step("w", json!({ "type": "wait", "seconds": 30 }))],
            )
            .await;
        let first = start(h.services.clone(), h.db.request(&task))
            .await
            .unwrap();
        let second = start(h.services.clone(), h.db.request(&task)).await;
        assert_eq!(second, Err(StartError::AlreadyRunning(first.clone())));
        cancel(&first);
        h.db.wait_finished(&h.services, &first).await;
        let again = start(h.services.clone(), h.db.request(&task))
            .await
            .unwrap();
        cancel(&again);
        h.db.wait_finished(&h.services, &again).await;
    }

    #[tokio::test]
    async fn auto_disable_after_consecutive_failures() {
        let h = harness().await;
        let mut task = task("task", "Test Task", vec![step("a", fails())]);
        task.max_consecutive_failures = Some(2);
        let task = h.db.save_task(&h.services, task).await;
        let mut request = h.db.request(&task);
        request.trigger = TriggerKind::Schedule;
        execute(h.services.clone(), request.clone()).await.unwrap();
        assert!(
            h.services
                .store
                .get_task("task")
                .await
                .unwrap()
                .unwrap()
                .enabled
        );
        execute(h.services.clone(), request.clone()).await.unwrap();
        let stored = h.services.store.get_task("task").await.unwrap().unwrap();
        assert!(!stored.enabled);
        let state = h.services.store.task_state("task").await.unwrap();
        assert_eq!(
            state.disabled_reason.as_deref(),
            Some("Nach 2 Fehlern in Folge automatisch deaktiviert.")
        );
        assert!(h.events.lock().unwrap().iter().any(|e| matches!(e, AutomationEvent::TasksChanged { ids } if ids == &vec!["task".to_string()])));
        assert_eq!(
            execute(h.services.clone(), request).await.unwrap_err(),
            StartError::Disabled
        );
        let manual = execute(h.services.clone(), h.db.request(&task))
            .await
            .unwrap();
        assert_eq!(manual.status, RunStatus::Failed);
    }

    #[tokio::test]
    async fn run_task_waits_and_detects_cycles() {
        let h = harness().await;
        h.db.save_task(
            &h.services,
            task(
                "child",
                "Kind",
                vec![step(
                    "k",
                    json!({ "type": "set_variable", "name": "x", "value": "${greeting}" }),
                )],
            ),
        )
        .await;
        let parent = h
            .db
            .save_task(
                &h.services,
                task("parent", "Eltern", vec![step("p", json!({ "type": "run_task", "task": "kind", "vars": { "greeting": "hallo ${task}" } }))]),
            )
            .await;
        let run = execute(h.services.clone(), h.db.request(&parent))
            .await
            .unwrap();
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
        let children = h
            .services
            .store
            .list_runs(&crate::automation::model::RunFilter {
                task_id: Some("child".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].parent_run_id.as_deref(), Some(run.id.as_str()));
        assert_eq!(children[0].trigger, TriggerKind::RunTask);
        let vars = h
            .services
            .store
            .get_run(&children[0].id)
            .await
            .unwrap()
            .unwrap()
            .vars;
        assert_eq!(vars["greeting"], "hallo Eltern");

        h.db.save_task(
            &h.services,
            task(
                "a",
                "A",
                vec![step("x", json!({ "type": "log", "message": "a" }))],
            ),
        )
        .await;
        h.db.save_task(
            &h.services,
            task(
                "b",
                "B",
                vec![step("y", json!({ "type": "run_task", "task": "a" }))],
            ),
        )
        .await;
        let a =
            h.db.save_task(
                &h.services,
                task(
                    "a",
                    "A",
                    vec![step("x", json!({ "type": "run_task", "task": "b" }))],
                ),
            )
            .await;
        let run = execute(h.services.clone(), h.db.request(&a)).await.unwrap();
        assert_eq!(run.status, RunStatus::Failed);
        assert!(run.error.unwrap().contains("Zyklus"));
    }

    #[tokio::test]
    async fn loop_over_query_rows_condition_and_set_variable_from_query() {
        let h = harness().await;
        let run = h
            .db
            .run(
                &h.services,
                vec![
                    step("loop", json!({ "type": "loop", "over": { "type": "query", "connection": "db", "sql": "SELECT name, qty FROM items ORDER BY id" }, "item": "row", "steps": [
                        step("acc", json!({ "type": "set_variable", "name": "acc", "value": "${acc:-}${row.name}${row.qty}@${row.index};" })),
                    ] })),
                    assert_var("acc", "a1@1;b3@2;c6@3;"),
                    assert_var("step.1.rows", "3"),
                    step("count", json!({ "type": "set_variable", "name": "count", "query": { "connection": "db", "sql": "SELECT COUNT(*) FROM items" } })),
                    step("names", json!({ "type": "set_variable", "name": "names", "query": { "connection": "Testdb", "sql": "SELECT name FROM items ORDER BY id", "mode": "column_list", "separator": "|" } })),
                    step("rows", json!({ "type": "set_variable", "name": "total", "query": { "connection": "db", "sql": "SELECT * FROM items WHERE qty > 2", "mode": "row_count" } })),
                    step("js", json!({ "type": "set_variable", "name": "js", "query": { "connection": "db", "sql": "SELECT name FROM items WHERE id = 1", "mode": "json" } })),
                    assert_var("count", "3"),
                    assert_var("names", "a|b|c"),
                    assert_var("total", "2"),
                    assert_var("js", "[{\"name\":\"a\"}]"),
                    step("list", json!({ "type": "loop", "over": { "type": "list", "values": "x, y" }, "continueOnError": true, "steps": [
                        step("only-y", json!({ "type": "condition", "left": "${item}", "op": "eq", "right": "y", "then": { "type": "next" }, "otherwise": { "type": "end_failure" } })),
                    ] })),
                    step("conns", json!({ "type": "loop", "over": { "type": "connections", "tag": "lab" }, "steps": [
                        step("c", json!({ "type": "set_variable", "name": "seen", "value": "${item.name}" })),
                    ] })),
                    assert_var("seen", "Testdb"),
                ],
            )
            .await;
        assert_eq!(run.status, RunStatus::Warning, "{:?}", run.error);
        let steps = steps_of(&h, &run.id).await;
        let nested: Vec<_> = steps
            .iter()
            .filter(|s| s.step_id == "acc")
            .map(|s| (s.depth, s.iteration))
            .collect();
        assert_eq!(nested, vec![(1, Some(1)), (1, Some(2)), (1, Some(3))]);
    }

    #[tokio::test]
    async fn condition_branches() {
        let h = harness().await;
        let run = h
            .db
            .run(
                &h.services,
                vec![
                    step("c", json!({ "type": "condition", "left": "${date}", "op": "matches", "right": "^\\d{4}-\\d{2}-\\d{2}$", "then": { "type": "goto", "stepId": "yes" }, "otherwise": { "type": "end_failure" } })),
                    step("no", json!({ "type": "fail", "message": "falscher Zweig" })),
                    step("yes", json!({ "type": "condition", "left": "1", "op": "gt", "right": "2", "then": { "type": "end_failure" }, "otherwise": { "type": "end_success" } })),
                    step("never", json!({ "type": "fail", "message": "nie" })),
                ],
            )
            .await;
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
        let detail = h.services.store.get_run(&run.id).await.unwrap().unwrap();
        assert_eq!(detail.steps.len(), 2);
    }

    #[tokio::test]
    async fn warning_status_from_check() {
        let h = harness().await;
        let run = h
            .db
            .run(
                &h.services,
                vec![
                    step("c", json!({ "type": "check", "connection": "db", "severity": "warning", "check": { "type": "row_count", "table": "items", "op": "gt", "value": 100.0 } })),
                    step("after", log("weiter")),
                ],
            )
            .await;
        assert_eq!(run.status, RunStatus::Warning);
        let steps = steps_of(&h, &run.id).await;
        assert_eq!(steps[0].status, RunStatus::Warning);
        assert_eq!(steps[1].status, RunStatus::Success);
    }

    #[tokio::test]
    async fn variables_secrets_are_masked_and_missing_fail() {
        let h = harness().await;
        let mut task = task(
            "task",
            "Test Task",
            vec![step("a", log("token=${token} region=${region}"))],
        );
        task.variables = serde_json::from_value(json!([{ "name": "token", "kind": "secret" }, { "name": "region", "defaultValue": "eu" }])).unwrap();
        let task = h.db.save_task(&h.services, task).await;
        let mut request = h.db.request(&task);
        request.vars.insert("token".into(), "very-secret".into());
        let run = execute(h.services.clone(), request).await.unwrap();
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
        let detail = h.services.store.get_run(&run.id).await.unwrap().unwrap();
        assert!(detail
            .logs
            .iter()
            .any(|l| l.message == "token=•••• region=eu"));
        assert_eq!(detail.vars["token"], "••••");
        assert!(!serde_json::to_string(&detail)
            .unwrap()
            .contains("very-secret"));
        let mut request = h.db.request(&task);
        request.vars.insert("token".into(), String::new());
        let run = execute(h.services.clone(), request).await.unwrap();
        assert_eq!(run.status, RunStatus::Failed);
        assert_eq!(
            run.error.as_deref(),
            Some("Variable „token“ hat keinen Wert.")
        );
    }

    #[tokio::test]
    async fn start_checks_review_disabled_invalid_and_depth() {
        let h = harness().await;
        let mut task = task("task", "Test Task", vec![step("a", log("x"))]);
        task.enabled = false;
        let task = h.db.save_task(&h.services, task).await;
        let mut request = h.db.request(&task);
        request.trigger = TriggerKind::Schedule;
        assert_eq!(
            execute(h.services.clone(), request).await.unwrap_err(),
            StartError::Disabled
        );
        let mut request = h.db.request(&task);
        request.depth = 6;
        assert!(
            matches!(execute(h.services.clone(), request).await.unwrap_err(), StartError::Invalid(m) if m.contains("max. 5"))
        );
        let invalid =
            h.db.save(
                &h.services,
                vec![step("a", json!({ "type": "run_task", "task": "fehlt" }))],
            )
            .await;
        assert!(
            matches!(execute(h.services.clone(), h.db.request(&invalid)).await.unwrap_err(), StartError::Invalid(m) if m.contains("fehlt"))
        );
        assert!(matches!(
            execute(
                h.services.clone(),
                RunRequest {
                    task_id: "nope".into(),
                    ..RunRequest::default()
                }
            )
            .await
            .unwrap_err(),
            StartError::NotFound(_)
        ));
    }

    #[test]
    fn validate_reports_structural_problems() {
        let mut inner = step("inner", log("x"));
        inner.on_success = Flow::Goto {
            step_id: "top".into(),
        };
        let t = task(
            "t",
            "T",
            vec![
                step(
                    "top",
                    json!({ "type": "loop", "over": { "type": "list", "values": "a" }, "steps": [inner] }),
                ),
                step("top", json!({ "type": "run_task", "task": "T" })),
                step(
                    "sql",
                    json!({ "type": "sql", "connections": ["db"], "sql": "SELECT '${item.name}'" }),
                ),
                step(
                    "http",
                    json!({ "type": "http", "method": "get", "url": "x", "expectStatus": "abc" }),
                ),
                step("wait", json!({ "type": "wait" })),
            ],
        );
        let issues = validate(&t, std::slice::from_ref(&t));
        let messages: Vec<_> = issues
            .iter()
            .map(|i| {
                (
                    i.step_id.clone().unwrap_or_default(),
                    i.severity,
                    i.message.clone(),
                )
            })
            .collect();
        let has = |id: &str, severity: Severity, needle: &str| {
            assert!(
                messages
                    .iter()
                    .any(|(s, sev, m)| s == id && *sev == severity && m.contains(needle)),
                "{id} {needle}: {messages:?}"
            )
        };
        has("inner", Severity::Error, "derselben Ebene");
        has("top", Severity::Error, "doppelt");
        has("top", Severity::Error, "selbst");
        has("sql", Severity::Warning, "|sql");
        has("http", Severity::Error, "Statusangabe");
        has("wait", Severity::Error, "Wartezeit");
        let ok = task(
            "ok",
            "Ok",
            vec![step(
                "a",
                json!({ "type": "sql", "connections": ["db"], "sql": "SELECT '${item.name|sql}'" }),
            )],
        );
        assert!(validate(&ok, &[]).is_empty());
    }
}
