mod oracle;
mod postgres;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

use super::DatabaseKind;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub available: bool,
    pub engine: Option<String>,
    pub message: String,
    pub step_out: bool,
}

pub fn unsupported(kind: DatabaseKind) -> Availability {
    let message = match kind {
        DatabaseKind::Postgres => "Die Server-Erweiterung pldbgapi wird benötigt.",
        DatabaseKind::Oracle => "Der Oracle-Debug-Adapter ist noch nicht verfügbar.",
        DatabaseKind::Mysql => "MySQL stellt keine native Schnittstelle für schrittweises Routine-Debugging bereit.",
        DatabaseKind::Mssql => "T-SQL-Debugging benötigt einen separaten SQL-Server-Debug-Adapter; SSDT ist keine portable Datenbank-Schnittstelle.",
        DatabaseKind::Odbc => "ODBC standardisiert keine Debug-Schnittstelle. Verwenden Sie den nativen Provider der Datenbank.",
        DatabaseKind::Redis => "Redis-Lua-Debugging benötigt einen eigenen LDB-Adapter und ist kein Stored-Routine-Debugging.",
        DatabaseKind::Sqlite | DatabaseKind::Duckdb | DatabaseKind::SqliteHttp => "Dieser Provider bietet keine serverseitigen prozeduralen Routinen mit einer Debug-Schnittstelle.",
        DatabaseKind::Clickhouse | DatabaseKind::Mongodb | DatabaseKind::Cassandra | DatabaseKind::Elasticsearch | DatabaseKind::Influxdb | DatabaseKind::Dynamodb | DatabaseKind::Athena | DatabaseKind::Bigquery | DatabaseKind::Snowflake => "Für diesen Provider ist keine unterstützte Stored-Routine-Debug-Schnittstelle verfügbar.",
    };
    Availability {
        available: false,
        engine: None,
        message: message.into(),
        step_out: false,
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Launch {
    pub id: String,
    pub oid: String,
    pub sql: String,
    pub breakpoints: Vec<Breakpoint>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Breakpoint {
    pub oid: String,
    pub line: i32,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Frame {
    pub id: i32,
    pub oid: String,
    pub name: String,
    pub line: i32,
}

#[derive(Clone, Serialize)]
pub struct Variable {
    pub name: String,
    pub value: Option<String>,
    pub datatype: String,
}

#[derive(Clone, Serialize)]
pub struct Watch {
    pub name: String,
    pub value: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub status: String,
    pub message: Option<String>,
    pub frames: Vec<Frame>,
    pub variables: Vec<Variable>,
    pub source: String,
    pub selected_frame: i32,
    pub watches: Vec<Watch>,
}

impl Snapshot {
    fn new(id: String) -> Self {
        Self {
            id,
            status: "starting".into(),
            message: None,
            frames: vec![],
            variables: vec![],
            source: String::new(),
            selected_frame: 0,
            watches: vec![],
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    Continue,
    StepInto,
    StepOver,
    StepOut,
    SelectFrame { frame: i32 },
    Breakpoints { breakpoints: Vec<Breakpoint> },
    Watches { names: Vec<String> },
}

#[async_trait]
trait Backend: Send {
    async fn action(&mut self, action: Action, state: &mut Snapshot) -> Result<(), String>;
    async fn stop(&mut self) -> Result<(), String>;
}

struct Session {
    owner: String,
    state: RwLock<Snapshot>,
    backend: Mutex<Option<Box<dyn Backend>>>,
    cancel: CancellationToken,
    busy: std::sync::atomic::AtomicBool,
    last_action: std::sync::Mutex<std::time::Instant>,
}

fn expire_idle_session(id: String, entry: Arc<Session>) {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = entry.cancel.cancelled() => return,
                _ = tokio::time::sleep(Duration::from_secs(10)) => {}
            }
            let idle = entry
                .last_action
                .lock()
                .map(|time| time.elapsed() > Duration::from_secs(240))
                .unwrap_or(true);
            if !idle || entry.busy.load(std::sync::atomic::Ordering::Acquire) {
                continue;
            }
            entry.cancel.cancel();
            let mut backend = entry.backend.lock().await;
            if let Some(backend) = backend.as_mut() {
                let _ = backend.stop().await;
            }
            backend.take();
            let mut state = entry.state.write().await;
            state.status = "stopped".into();
            state.message = Some("Debug-Sitzung nach vier Minuten ohne Bedienung beendet.".into());
            drop(state);
            drop(backend);
            tokio::time::sleep(Duration::from_secs(60)).await;
            let mut entries = sessions().lock().await;
            if entries
                .get(&id)
                .is_some_and(|value| Arc::ptr_eq(value, &entry))
            {
                entries.remove(&id);
            }
            return;
        }
    });
}

type Sessions = Mutex<HashMap<String, Arc<Session>>>;

fn sessions() -> &'static Sessions {
    static SESSIONS: OnceLock<Sessions> = OnceLock::new();
    SESSIONS.get_or_init(Mutex::default)
}

fn validate_launch(request: &Launch) -> Result<(), String> {
    if request.id.len() < 16
        || request.id.len() > 100
        || !request
            .id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Ungültige Debug-Sitzungs-ID".into());
    }
    if request.sql.trim().is_empty() || request.sql.len() > 1_000_000 {
        return Err("Ein Aufrufskript mit maximal 1 MB ist erforderlich.".into());
    }
    validate_breakpoints(&request.breakpoints)
}

fn validate_breakpoints(breakpoints: &[Breakpoint]) -> Result<(), String> {
    if breakpoints.len() > 1000 || breakpoints.iter().any(|b| b.line < 1 || b.oid.is_empty()) {
        return Err("Ungültige Breakpoints (maximal 1000, Zeilen ab 1).".into());
    }
    Ok(())
}

async fn session(
    id: &str,
    connection_string: &str,
    database: Option<&str>,
) -> Result<Arc<Session>, String> {
    let entry = sessions()
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or("Debug-Sitzung nicht gefunden")?;
    if entry.owner != super::connection::connection_key(connection_string, database) {
        return Err("Debug-Sitzung gehört zu einer anderen Verbindung.".into());
    }
    Ok(entry)
}

#[tauri::command]
pub async fn debug_availability(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
) -> Result<Availability, String> {
    match kind {
        DatabaseKind::Oracle => oracle::availability(&connection_string).await,
        DatabaseKind::Postgres => {
            postgres::availability(&connection_string, database.as_deref()).await
        }
        _ => Ok(unsupported(kind)),
    }
}

#[tauri::command]
pub async fn debug_launch(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    request: Launch,
) -> Result<Snapshot, String> {
    validate_launch(&request)?;
    if super::connection::connection_string_is_read_only(&connection_string) {
        return Err("Lesemodus: Debug-Ausführung ist nicht erlaubt.".into());
    }
    if !matches!(kind, DatabaseKind::Postgres | DatabaseKind::Oracle) {
        return Err(unsupported(kind).message);
    }
    let snapshot = Snapshot::new(request.id.clone());
    let entry = Arc::new(Session {
        owner: super::connection::connection_key(&connection_string, database.as_deref()),
        state: RwLock::new(snapshot.clone()),
        backend: Mutex::new(None),
        cancel: CancellationToken::new(),
        busy: std::sync::atomic::AtomicBool::new(true),
        last_action: std::sync::Mutex::new(std::time::Instant::now()),
    });
    {
        let mut entries = sessions().lock().await;
        if entries.len() >= 16 {
            return Err("Maximal 16 Debug-Sitzungen. Beenden Sie eine bestehende Sitzung.".into());
        }
        if entries.contains_key(&request.id) {
            return Err("Debug-Sitzung existiert bereits.".into());
        }
        entries.insert(request.id.clone(), entry.clone());
    }
    let initial = snapshot.clone();
    expire_idle_session(request.id.clone(), entry.clone());
    tokio::spawn(async move {
        let mut state = snapshot;
        let result: Result<Box<dyn Backend>, String> = match kind {
            DatabaseKind::Oracle => oracle::launch(
                &connection_string,
                &request,
                &mut state,
                entry.cancel.clone(),
            )
            .await
            .map(|backend| Box::new(backend) as Box<dyn Backend>),
            _ => postgres::launch(
                &connection_string,
                database.as_deref(),
                &request,
                &mut state,
                entry.cancel.clone(),
            )
            .await
            .map(|backend| Box::new(backend) as Box<dyn Backend>),
        };
        match result {
            Ok(mut backend) => {
                if entry.cancel.is_cancelled() {
                    let _ = backend.stop().await;
                } else {
                    *entry.backend.lock().await = Some(backend);
                }
            }
            Err(error) => {
                state.status = "error".into();
                state.message = Some(error);
            }
        }
        if entry.cancel.is_cancelled() {
            state.status = "stopped".into();
        }
        *entry.state.write().await = state;
        entry
            .busy
            .store(false, std::sync::atomic::Ordering::Release);
    });
    Ok(initial)
}

#[tauri::command]
pub async fn debug_snapshot(
    id: String,
    connection_string: String,
    database: Option<String>,
) -> Result<Snapshot, String> {
    Ok(session(&id, &connection_string, database.as_deref())
        .await?
        .state
        .read()
        .await
        .clone())
}

#[tauri::command]
pub async fn debug_action(
    id: String,
    connection_string: String,
    database: Option<String>,
    action: Action,
) -> Result<(), String> {
    if super::connection::connection_string_is_read_only(&connection_string) {
        return Err("Lesemodus: Debug-Ausführung ist nicht erlaubt.".into());
    }
    if let Action::Breakpoints { breakpoints } = &action {
        validate_breakpoints(breakpoints)?;
    }
    if let Action::Watches { names } = &action {
        if names.len() > 100 || names.iter().any(|name| name.is_empty() || name.len() > 256) {
            return Err("Maximal 100 Watches mit jeweils 1–256 Zeichen.".into());
        }
    }
    let entry = session(&id, &connection_string, database.as_deref()).await?;
    if entry
        .busy
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::AcqRel,
            std::sync::atomic::Ordering::Acquire,
        )
        .is_err()
    {
        return Err("Debugger arbeitet noch.".into());
    }
    let mut state = entry.state.read().await.clone();
    if state.status != "paused" {
        entry
            .busy
            .store(false, std::sync::atomic::Ordering::Release);
        return Err("Die Debug-Sitzung ist nicht angehalten.".into());
    }
    entry.state.write().await.status = "running".into();
    if let Ok(mut time) = entry.last_action.lock() {
        *time = std::time::Instant::now();
    }
    tokio::spawn(async move {
        let mut backend = entry.backend.lock().await;
        if let Some(backend) = backend.as_mut() {
            let result = tokio::select! {
                result = backend.action(action, &mut state) => result,
                _ = entry.cancel.cancelled() => Err("Debug-Sitzung abgebrochen.".into()),
                _ = tokio::time::sleep(Duration::from_secs(300)) => Err("Debug-Befehl hat das Zeitlimit überschritten.".into()),
            };
            if let Err(error) = result {
                state.status = "error".into();
                state.message = Some(error);
                let _ = backend.stop().await;
            }
        }
        if entry.cancel.is_cancelled() {
            state.status = "stopped".into();
        }
        if state.status != "paused" {
            backend.take();
        }
        *entry.state.write().await = state;
        entry
            .busy
            .store(false, std::sync::atomic::Ordering::Release);
    });
    Ok(())
}

#[tauri::command]
pub async fn debug_stop(
    id: String,
    connection_string: String,
    database: Option<String>,
) -> Result<(), String> {
    if !sessions().lock().await.contains_key(&id) {
        return Ok(());
    }
    let entry = session(&id, &connection_string, database.as_deref()).await?;
    entry.cancel.cancel();
    let result = match entry.backend.lock().await.as_mut() {
        Some(backend) => backend.stop().await,
        None => Ok(()),
    };
    sessions().lock().await.remove(&id);
    result
}

#[cfg(test)]
mod validation_tests {
    use super::*;

    #[test]
    fn launch_rejects_invalid_input() {
        let mut request = Launch {
            id: "a-valid-session-id".into(),
            oid: "1".into(),
            sql: "SELECT f()".into(),
            breakpoints: vec![],
        };
        assert!(validate_launch(&request).is_ok());
        request.breakpoints.push(Breakpoint {
            oid: "1".into(),
            line: 0,
        });
        assert!(validate_launch(&request).is_err());
        request.breakpoints.clear();
        request.sql.clear();
        assert!(validate_launch(&request).is_err());
    }

    #[test]
    fn unsupported_providers_do_not_claim_debugging() {
        for kind in [
            DatabaseKind::Mysql,
            DatabaseKind::Sqlite,
            DatabaseKind::Mssql,
            DatabaseKind::Clickhouse,
            DatabaseKind::Mongodb,
            DatabaseKind::Redis,
            DatabaseKind::Cassandra,
            DatabaseKind::Duckdb,
            DatabaseKind::Odbc,
        ] {
            let result = unsupported(kind);
            assert!(!result.available);
            assert!(!result.message.is_empty());
        }
    }
}
