use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

pub const CANCELLED: &str = "Vorgang vom Benutzer abgebrochen.";
const LOG_LINES: usize = 200;
const KEEP_FINISHED: Duration = Duration::from_secs(6 * 60 * 60);

pub type Emit = Arc<dyn Fn(&JobStatus) + Send + Sync>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    pub id: String,
    pub operation: String,
    pub label: String,
    pub database: String,
    pub state: String,
    pub phase: String,
    pub done: u64,
    pub total: u64,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub error: Option<String>,
    pub result: Value,
    pub log: VecDeque<String>,
}

struct Entry {
    status: JobStatus,
    finished: Option<Instant>,
    emitted: Instant,
}

fn registry() -> &'static Mutex<HashMap<String, Entry>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone)]
pub struct Job {
    pub id: String,
    emit: Emit,
}

impl Job {
    pub fn detached() -> Self {
        Self {
            id: String::new(),
            emit: Arc::new(|_| {}),
        }
    }

    fn update(&self, force: bool, change: impl FnOnce(&mut JobStatus)) {
        let snapshot = {
            let Ok(mut jobs) = registry().lock() else {
                return;
            };
            let Some(entry) = jobs.get_mut(&self.id) else {
                return;
            };
            change(&mut entry.status);
            if !force && entry.emitted.elapsed() < Duration::from_millis(250) {
                return;
            }
            entry.emitted = Instant::now();
            entry.status.clone()
        };
        (self.emit)(&snapshot);
    }

    pub fn phase(&self, phase: &str) {
        let phase = phase.to_string();
        self.update(true, move |status| {
            status.phase = phase;
            status.done = 0;
            status.total = 0;
        });
    }

    pub fn progress(&self, done: u64, total: u64) {
        self.update(false, move |status| {
            status.done = done;
            status.total = total;
        });
    }

    pub fn log(&self, line: String) {
        self.update(false, move |status| {
            if status.log.len() == LOG_LINES {
                status.log.pop_front();
            }
            status.log.push_back(line);
        });
    }
}

pub fn list() -> Vec<JobStatus> {
    let Ok(mut jobs) = registry().lock() else {
        return Vec::new();
    };
    jobs.retain(|_, entry| entry.finished.is_none_or(|at| at.elapsed() < KEEP_FINISHED));
    let mut out: Vec<JobStatus> = jobs.values().map(|entry| entry.status.clone()).collect();
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    out
}

pub fn start<F, Fut>(
    operation: &str,
    label: String,
    database: String,
    emit: Emit,
    work: F,
) -> Result<String, String>
where
    F: FnOnce(Job) -> Fut + Send + 'static,
    Fut: Future<Output = Result<Value, String>> + Send + 'static,
{
    let id = super::vault::new_id()?;
    let status = JobStatus {
        id: id.clone(),
        operation: operation.into(),
        label,
        database,
        state: "running".into(),
        phase: "Vorbereitung".into(),
        done: 0,
        total: 0,
        started_at: super::vault::now(),
        finished_at: None,
        error: None,
        result: Value::Null,
        log: VecDeque::new(),
    };
    registry()
        .lock()
        .map_err(|_| "Aufgabenverwaltung blockiert")?
        .insert(
            id.clone(),
            Entry {
                status: status.clone(),
                finished: None,
                emitted: Instant::now(),
            },
        );
    emit(&status);
    let job = Job {
        id: id.clone(),
        emit: emit.clone(),
    };
    let options = crate::db::execution::ExecutionOptions {
        job_id: Some(id.clone()),
        ..Default::default()
    };
    tauri::async_runtime::spawn(async move {
        let outcome = crate::db::execution::run(Some(options), true, work(job.clone())).await;
        job.update(true, |status| {
            status.finished_at = Some(super::vault::now());
            match outcome {
                Ok(result) => {
                    status.state = "succeeded".into();
                    status.result = result;
                    status.phase = "Abgeschlossen".into();
                }
                Err(error) => {
                    status.state = if error.starts_with(CANCELLED) {
                        "cancelled"
                    } else {
                        "failed"
                    }
                    .into();
                    status.phase = "Beendet".into();
                    status.error = Some(error);
                }
            }
        });
        if let Ok(mut jobs) = registry().lock() {
            if let Some(entry) = jobs.get_mut(&job.id) {
                entry.finished = Some(Instant::now());
            }
        }
    });
    Ok(id)
}
