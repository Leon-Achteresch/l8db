use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_postgres::{AsyncMessage, Client, Config, Connection};

use super::{map_pg_err, QueryResult};

const MAX_MESSAGES: usize = 2000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMessage {
    pub level: String,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Clone, Default)]
pub struct Messages(Arc<Mutex<VecDeque<ServerMessage>>>);

impl Messages {
    pub fn push(&self, message: ServerMessage) {
        let mut entries = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if entries.len() >= MAX_MESSAGES {
            entries.pop_front();
        }
        entries.push_back(message);
    }

    pub fn take(&self) -> Vec<ServerMessage> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain(..)
            .collect()
    }
}

tokio::task_local! {
    static SINK: Messages;
}

thread_local! {
    static DRIVER_LOG: std::cell::RefCell<Option<Messages>> = const { std::cell::RefCell::new(None) };
}

#[derive(Default)]
struct Registry {
    enabled: HashSet<String>,
    buffers: HashMap<String, Messages>,
    sessions: HashMap<String, Arc<super::execution::PgSession>>,
}

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}

pub fn messages(key: &str) -> Messages {
    let mut reg = registry().lock().expect("server output registry");
    reg.buffers.entry(key.to_string()).or_default().clone()
}

pub async fn capture<F: Future>(sink: Messages, future: F) -> F::Output {
    SINK.scope(sink, future).await
}

pub fn sink() -> Option<Messages> {
    SINK.try_with(Clone::clone).ok()
}

pub fn emit(message: ServerMessage) {
    let _ = SINK.try_with(|sink| sink.push(message));
}

pub fn capture_driver_log<T>(f: impl FnOnce() -> T) -> (T, Vec<ServerMessage>) {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            DRIVER_LOG.with(|log| log.borrow_mut().take());
        }
    }
    let messages = Messages::default();
    DRIVER_LOG.with(|log| *log.borrow_mut() = Some(messages.clone()));
    let _reset = Reset;
    let value = f();
    (value, messages.take())
}

pub fn capture_log_record(record: &log::Record) -> bool {
    if !record.target().starts_with("odbc_api") {
        return false;
    }
    let Some(messages) = DRIVER_LOG.with(|log| log.borrow().clone()) else {
        return false;
    };
    match odbc_diagnostic(&record.args().to_string()) {
        Some(message) => {
            messages.push(message);
            true
        }
        None => false,
    }
}

fn odbc_diagnostic(text: &str) -> Option<ServerMessage> {
    let (state, rest) = text
        .strip_prefix("State: ")?
        .split_once(", Native error: ")?;
    let (native, message) = rest.split_once(", Message: ")?;
    state.starts_with("01").then(|| ServerMessage {
        level: "INFO".to_string(),
        message: message.to_string(),
        detail: Some(format!("SQLSTATE {state}, nativer Fehler {native}")),
    })
}

pub fn is_enabled(key: &str) -> bool {
    registry()
        .lock()
        .map(|reg| reg.enabled.contains(key))
        .unwrap_or(false)
}

pub fn peek_pg_session(key: &str) -> Option<Arc<super::execution::PgSession>> {
    let reg = registry().lock().ok()?;
    if !reg.enabled.contains(key) {
        return None;
    }
    reg.sessions.get(key).cloned()
}

pub fn set_enabled(key: &str, enabled: bool) {
    let mut reg = registry().lock().expect("server output registry");
    if enabled {
        reg.enabled.insert(key.to_string());
    } else {
        reg.enabled.remove(key);
        reg.sessions.remove(key);
    }
}

pub fn take(key: &str) -> Vec<ServerMessage> {
    let buffer = registry()
        .lock()
        .expect("server output registry")
        .buffers
        .get(key)
        .cloned();
    buffer.map(|buffer| buffer.take()).unwrap_or_default()
}

pub(crate) async fn forward_notices<S, T>(mut connection: Connection<S, T>, sink: Option<Messages>)
where
    S: AsyncRead + AsyncWrite + Unpin,
    T: AsyncRead + AsyncWrite + Unpin,
{
    loop {
        let message =
            std::future::poll_fn(|cx| std::pin::Pin::new(&mut connection).poll_message(cx)).await;
        match message {
            Some(Ok(AsyncMessage::Notice(notice))) => {
                if let Some(sink) = &sink {
                    sink.push(ServerMessage {
                        level: notice.severity().to_string(),
                        message: notice.message().to_string(),
                        detail: notice.detail().map(|d| d.to_string()),
                    });
                }
            }
            Some(Ok(_)) => {}
            Some(Err(_)) | None => break,
        }
    }
}

pub async fn pg_session(
    key: &str,
    config: &Config,
    ssl: &super::connection::PgTls,
) -> Result<Option<Arc<super::execution::PgSession>>, String> {
    if !is_enabled(key) {
        return Ok(None);
    }
    let existing = {
        let reg = registry().lock().expect("server output registry");
        reg.sessions.get(key).cloned()
    };
    if let Some(client) = existing {
        if client.available().await {
            return Ok(Some(client));
        }
        let mut reg = registry().lock().expect("server output registry");
        reg.sessions.remove(key);
    }

    let client = capture(
        messages(key),
        super::execution::connect_postgres(config, ssl),
    )
    .await
    .map_err(|e| format!("Verbindung für Server-Ausgabe fehlgeschlagen: {e}"))?;
    let client = Arc::new(super::execution::PgSession::new(client));
    let mut reg = registry().lock().expect("server output registry");
    reg.sessions.insert(key.to_string(), client.clone());
    Ok(Some(client))
}

pub async fn pg_run_query(
    client: &Client,
    sql: &str,
    read_only: bool,
) -> Result<QueryResult, String> {
    if read_only {
        super::postgres::read_only_batch_guard(sql)?;
        client
            .simple_query(super::postgres::READ_ONLY_BEGIN)
            .await
            .map_err(map_pg_err)?;
    }
    let outcome = super::postgres::run_simple_query(client, sql).await;
    if read_only {
        let _ = client.simple_query("ROLLBACK").await;
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn notice(i: usize) -> ServerMessage {
        ServerMessage {
            level: "NOTICE".to_string(),
            message: format!("notice {i}"),
            detail: None,
        }
    }

    #[test]
    fn buffer_keeps_the_newest_messages_and_takes_them_quickly() {
        let mut push_ms = Vec::new();
        let mut take_ms = Vec::new();
        for _ in 0..21 {
            let messages = Messages::default();
            let started = Instant::now();
            for i in 0..5000 {
                messages.push(notice(i));
            }
            push_ms.push(started.elapsed().as_secs_f64() * 1000.0);
            let started = Instant::now();
            let taken = messages.take();
            take_ms.push(started.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(taken.len(), MAX_MESSAGES);
            assert_eq!(taken[0].message, "notice 3000");
            assert_eq!(taken[MAX_MESSAGES - 1].message, "notice 4999");
            assert!(messages.take().is_empty());
        }
        push_ms.sort_by(f64::total_cmp);
        take_ms.sort_by(f64::total_cmp);
        eprintln!(
            "performance server-output-buffer: notices=5000 retained={MAX_MESSAGES} push_median_ms={:.3} push_p95_ms={:.3} take_median_ms={:.3} take_p95_ms={:.3} runs=21",
            push_ms[10], push_ms[19], take_ms[10], take_ms[19]
        );
        assert!(push_ms[19] < 50.0, "{push_ms:?}");
        assert!(take_ms[19] < 5.0, "{take_ms:?}");
    }

    #[tokio::test]
    async fn emit_reaches_only_an_active_capture() {
        emit(notice(0));
        let sink = Messages::default();
        capture(sink.clone(), async {
            emit(notice(1));
            tokio::task::yield_now().await;
            emit(notice(2));
        })
        .await;
        emit(notice(3));
        let taken: Vec<_> = sink.take().into_iter().map(|m| m.message).collect();
        assert_eq!(taken, ["notice 1", "notice 2"]);
    }

    #[test]
    fn registry_keeps_messages_when_output_is_switched_off() {
        let key = "server-output-registry-test";
        messages(key).push(notice(1));
        set_enabled(key, true);
        set_enabled(key, false);
        assert_eq!(take(key).len(), 1);
        assert!(take(key).is_empty());
        assert!(take("server-output-unknown-key").is_empty());
    }

    #[test]
    fn driver_log_captures_odbc_info_records_on_this_thread_only() {
        let info = "State: 01000, Native error: 0, Message: [Microsoft][ODBC Driver 18 for SQL Server][SQL Server]hallo";
        let record = |text: &str, target: &str, f: &dyn Fn(&log::Record) -> bool| {
            f(&log::Record::builder()
                .target(target)
                .args(format_args!("{text}"))
                .build())
        };
        assert!(!record(
            info,
            "odbc_api::handles::logging",
            &capture_log_record
        ));
        let ((), captured) = capture_driver_log(|| {
            assert!(record(
                info,
                "odbc_api::handles::logging",
                &capture_log_record
            ));
            assert!(!record(
                "State: 42S02, Native error: 208, Message: invalid object",
                "odbc_api::handles::logging",
                &capture_log_record
            ));
            assert!(!record(info, "tiberius", &capture_log_record));
        });
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].level, "INFO");
        assert!(captured[0].message.ends_with("[SQL Server]hallo"));
        assert_eq!(
            captured[0].detail.as_deref(),
            Some("SQLSTATE 01000, nativer Fehler 0")
        );
        assert!(!record(
            info,
            "odbc_api::handles::logging",
            &capture_log_record
        ));
    }

    #[cfg(feature = "odbc")]
    #[test]
    fn odbc_record_display_matches_the_parser() {
        let record = odbc_api::handles::Record {
            state: odbc_api::handles::State(*b"01000"),
            native_error: 5701,
            message: "Kontext geändert".bytes().map(|b| b as _).collect(),
        };
        let parsed = odbc_diagnostic(&record.to_string()).expect("parsed");
        assert_eq!(
            parsed.detail.as_deref(),
            Some("SQLSTATE 01000, nativer Fehler 5701")
        );
    }
}
