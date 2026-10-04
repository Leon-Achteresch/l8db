use std::collections::BTreeMap;
use std::fmt;
use std::sync::Arc;

use chrono::{DateTime, SecondsFormat, Utc};

use crate::automation::model::{
    AlertState, Flow, LogLevel, LogLine, RunOutput, RunSummary, Step, StepRun, Task, TriggerKind,
};
use crate::automation::store::Store;

pub type Sink = Arc<dyn Fn(AutomationEvent) + Send + Sync>;

#[derive(Clone)]
pub struct Services {
    pub store: Arc<Store>,
    pub pool: crate::db::pool::PoolState,
    pub ssh: crate::db::ssh::SshState,
    pub transactions: crate::db::transaction::TransactionState,
    pub sink: Sink,
    pub headless: bool,
}

impl Services {
    pub fn new(store: Store, sink: Sink, headless: bool) -> Self {
        Services {
            store: Arc::new(store),
            pool: crate::db::pool::create_pool_state(),
            ssh: crate::db::ssh::create_ssh_state(),
            transactions: crate::db::transaction::create_transaction_state(),
            sink,
            headless,
        }
    }

    pub fn emit(&self, event: AutomationEvent) {
        (self.sink)(event);
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(
    tag = "event",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AutomationEvent {
    RunStarted {
        run: RunSummary,
    },
    RunStep {
        run_id: String,
        task_id: String,
        step: StepRun,
    },
    RunLog {
        run_id: String,
        line: LogLine,
    },
    RunFinished {
        run: RunSummary,
    },
    TasksChanged {
        ids: Vec<String>,
    },
    AlertChanged {
        alert: AlertState,
    },
}

#[derive(Debug, Clone, Default)]
pub struct RunRequest {
    pub task_id: String,
    pub trigger: TriggerKind,
    pub trigger_detail: Option<String>,
    pub vars: BTreeMap<String, String>,
    pub environment: Option<String>,
    pub from_step: Option<String>,
    pub rerun_of: Option<String>,
    pub use_original_definition: bool,
    pub parent_run_id: Option<String>,
    pub depth: u8,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StartError {
    NotFound(String),
    Ambiguous(String),
    Disabled,
    NeedsReview,
    AlreadyRunning(String),
    Invalid(String),
    Store(String),
}

impl fmt::Display for StartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StartError::NotFound(name) => write!(f, "Task „{name}“ wurde nicht gefunden."),
            StartError::Ambiguous(name) => write!(f, "Taskname „{name}“ ist nicht eindeutig."),
            StartError::Disabled => write!(f, "Der Task ist deaktiviert."),
            StartError::NeedsReview => write!(
                f,
                "Der Task wurde importiert und muss vor dem Ausführen geprüft und gespeichert werden."
            ),
            StartError::AlreadyRunning(run_id) => {
                write!(f, "Der Task läuft bereits (Lauf {run_id}).")
            }
            StartError::Invalid(message) | StartError::Store(message) => f.write_str(message),
        }
    }
}

pub struct StepContext<'a> {
    pub services: &'a Services,
    pub run_id: &'a str,
    pub task: &'a Task,
    pub step: &'a Step,
    pub vars: &'a mut crate::automation::vars::Vars,
    pub connections: &'a mut crate::automation::connection::ConnectionCache,
    pub cancel: tokio_util::sync::CancellationToken,
    pub job_id: String,
    pub log: &'a (dyn Fn(LogLevel, String) + Send + Sync),
}

#[derive(Debug, Clone, Default)]
pub struct StepOutcome {
    pub rows: Option<u64>,
    pub rows_affected: Option<u64>,
    pub value: Option<serde_json::Value>,
    pub outputs: Vec<RunOutput>,
    pub vars: BTreeMap<String, String>,
    pub flow: Option<Flow>,
    pub warning: Option<String>,
    pub message: Option<String>,
}

pub fn rfc3339(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn now() -> String {
    rfc3339(Utc::now())
}

pub fn new_run_id() -> String {
    format!(
        "{:013x}{:06x}",
        Utc::now().timestamp_millis(),
        rand::random::<u32>() & 0xff_ffff
    )
}

pub fn new_id() -> String {
    let mut b = rand::random::<u128>().to_be_bytes();
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}
