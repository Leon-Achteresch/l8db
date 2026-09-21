use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Deserialize;
use tokio_util::sync::CancellationToken;

static DEFAULT_QUERY_SECONDS: AtomicU64 = AtomicU64::new(30);
static DEFAULT_CONNECTION_SECONDS: AtomicU64 = AtomicU64::new(15);

pub fn configure_defaults(query_timeout: u64, connection_timeout: u64) {
    DEFAULT_QUERY_SECONDS.store(query_timeout.clamp(5, 300), Ordering::Relaxed);
    DEFAULT_CONNECTION_SECONDS.store(connection_timeout.clamp(3, 60), Ordering::Relaxed);
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionOptions {
    pub job_id: Option<String>,
    pub query_timeout: Option<u64>,
    pub connection_timeout: Option<u64>,
}

#[derive(Clone)]
struct Context {
    options: ExecutionOptions,
    cancel: CancellationToken,
    interrupted: Arc<AtomicBool>,
}

tokio::task_local! {
    static CONTEXT: Context;
    static PROGRESS: Arc<dyn Fn(u64) + Send + Sync>;
}

type Registry = HashMap<String, (CancellationToken, bool)>;

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

struct Registration(Option<String>);

impl Drop for Registration {
    fn drop(&mut self) {
        if let Some(id) = &self.0 {
            if let Ok(mut entries) = registry().lock() {
                entries.remove(id);
            }
        }
    }
}

pub fn progress(rows: u64) {
    let _ = PROGRESS.try_with(|callback| callback(rows));
}

pub async fn with_progress<T, F>(callback: impl Fn(u64) + Send + Sync + 'static, future: F) -> T
where
    F: Future<Output = T>,
{
    PROGRESS.scope(Arc::new(callback), future).await
}

pub fn cancellation_token() -> CancellationToken {
    CONTEXT
        .try_with(|ctx| ctx.cancel.clone())
        .unwrap_or_default()
}

pub fn query_duration() -> Duration {
    Duration::from_secs(
        CONTEXT
            .try_with(|ctx| {
                ctx.options
                    .query_timeout
                    .unwrap_or_else(|| DEFAULT_QUERY_SECONDS.load(Ordering::Relaxed))
            })
            .unwrap_or_else(|_| DEFAULT_QUERY_SECONDS.load(Ordering::Relaxed))
            .clamp(5, 300),
    )
}

pub fn connection_duration() -> Duration {
    Duration::from_secs(
        CONTEXT
            .try_with(|ctx| {
                ctx.options
                    .connection_timeout
                    .unwrap_or_else(|| DEFAULT_CONNECTION_SECONDS.load(Ordering::Relaxed))
            })
            .unwrap_or_else(|_| DEFAULT_CONNECTION_SECONDS.load(Ordering::Relaxed))
            .clamp(3, 60),
    )
}

pub fn timeout_message() -> String {
    format!(
        "Query-Timeout nach {} Sekunden. Der Serverabschluss ist nicht bestätigt; vor erneutem Schreiben den Zustand prüfen.",
        query_duration().as_secs()
    )
}

pub fn cancel(id: &str) -> Result<bool, String> {
    let entries = registry()
        .lock()
        .map_err(|_| "Aufgabenverwaltung blockiert")?;
    let Some((token, supported)) = entries.get(id) else {
        return Ok(false);
    };
    if !supported {
        return Err("Dieser Treiber unterstützt keinen bestätigten Abfrageabbruch.".into());
    }
    token.cancel();
    Ok(true)
}

pub async fn run<T, F>(
    options: Option<ExecutionOptions>,
    native_cancel: bool,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    let options = options.unwrap_or_default();
    let cancel = CancellationToken::new();
    if let Some(id) = &options.job_id {
        if id.is_empty() || id.len() > 128 {
            return Err("Ungültige Aufgaben-ID".into());
        }
        let mut entries = registry()
            .lock()
            .map_err(|_| "Aufgabenverwaltung blockiert")?;
        if entries.contains_key(id) {
            return Err("Aufgabe wird bereits ausgeführt".into());
        }
        entries.insert(id.clone(), (cancel.clone(), native_cancel));
    }
    let _registration = Registration(options.job_id.clone());
    CONTEXT
        .scope(
            Context {
                options,
                cancel,
                interrupted: Arc::new(AtomicBool::new(false)),
            },
            future,
        )
        .await
}

pub async fn run_query<T, F>(
    options: Option<ExecutionOptions>,
    native_cancel: bool,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    run(options, native_cancel, async {
        if native_cancel {
            future.await
        } else {
            tokio::time::timeout(query_duration(), future)
                .await
                .map_err(|_| timeout_message())?
        }
    })
    .await
}

pub async fn connect<T, F>(future: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    tokio::time::timeout(connection_duration(), future)
        .await
        .map_err(|_| {
            format!(
                "Verbindungs-Timeout nach {} Sekunden",
                connection_duration().as_secs()
            )
        })?
}

pub struct PgSession {
    client: Arc<tokio::sync::Mutex<tokio_postgres::Client>>,
    interrupted: AtomicBool,
}

impl PgSession {
    pub fn new(client: tokio_postgres::Client) -> Self {
        Self {
            client: Arc::new(tokio::sync::Mutex::new(client)),
            interrupted: AtomicBool::new(false),
        }
    }

    pub async fn metadata_lock(
        &self,
    ) -> Result<tokio::sync::OwnedMutexGuard<tokio_postgres::Client>, String> {
        let guard = self.client.clone().lock_owned().await;
        if self.interrupted.load(Ordering::Acquire) {
            return Err("Sitzung wurde unterbrochen".into());
        }
        Ok(guard)
    }

    pub async fn available(&self) -> bool {
        let client = self.client.lock().await;
        !self.interrupted.load(Ordering::Acquire) && !client.is_closed()
    }

    pub async fn lock(
        &self,
    ) -> Result<tokio::sync::MutexGuard<'_, tokio_postgres::Client>, String> {
        let client = self.client.lock().await;
        if self.interrupted.load(Ordering::Acquire) {
            return Err("Diese Sitzung wurde abgebrochen. Offene Transaktion zurückrollen; weitere Abfragen erst danach starten.".into());
        }
        Ok(client)
    }

    pub async fn lock_for_cleanup(&self) -> tokio::sync::MutexGuard<'_, tokio_postgres::Client> {
        self.client.lock().await
    }

    pub fn finish<T>(&self, result: Result<T, String>) -> Result<T, String> {
        if self.interrupted.load(Ordering::Acquire)
            || CONTEXT
                .try_with(|ctx| ctx.interrupted.load(Ordering::Acquire))
                .unwrap_or(false)
        {
            self.interrupted.store(true, Ordering::Release);
            if result.is_ok() {
                return Err("Abfrage abgeschlossen, während ihr Abbruch angefordert wurde. Die Sitzung wird nicht weiterverwendet; offene Transaktion zurückrollen.".into());
            }
        }
        result
    }
}

pub async fn connect_postgres(
    config: &tokio_postgres::Config,
    ssl: super::SslMode,
) -> Result<tokio_postgres::Client, String> {
    let (client, connection) = connect(async {
        config
            .connect(super::connection::tls_connector(ssl)?)
            .await
            .map_err(super::map_pg_err)
    })
    .await?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    Ok(client)
}

pub async fn postgres<T, F>(
    client: &tokio_postgres::Client,
    ssl: super::SslMode,
    session: Option<&PgSession>,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    let cancel = CONTEXT
        .try_with(|ctx| ctx.cancel.clone())
        .unwrap_or_default();
    if cancel.is_cancelled() {
        return Err("Abfrage abgebrochen, bevor sie gestartet wurde.".into());
    }
    tokio::pin!(future);
    let timed_out = tokio::select! {
        biased;
        result = &mut future => return result,
        _ = cancel.cancelled() => false,
        _ = tokio::time::sleep(query_duration()) => true,
    };
    if let Some(session) = session {
        session.interrupted.store(true, Ordering::Release);
    }
    let _ = CONTEXT.try_with(|ctx| ctx.interrupted.store(true, Ordering::Release));
    let token = client.cancel_token();
    let cancellation = token.cancel_query(super::connection::tls_connector(ssl)?);
    match tokio::time::timeout(connection_duration(), cancellation).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            return Err(format!(
                "Abbruch nicht bestätigt: {error}. Server- und Transaktionszustand prüfen."
            ))
        }
        Err(error) => {
            return Err(format!(
                "Abbruch nicht bestätigt: {error}. Server- und Transaktionszustand prüfen."
            ))
        }
    }
    match tokio::time::timeout(connection_duration(), &mut future).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(error)) if error.contains("57014") || error.contains("canceling statement") || error.contains("user request") || error.contains("statement timeout") => {
            if timed_out {
                Err(format!("Query-Timeout nach {} Sekunden: Abfrage vom Server abgebrochen. Offene Transaktion gegebenenfalls zurückrollen.", query_duration().as_secs()))
            } else {
                Err("Abfrage vom Server abgebrochen. Offene Transaktion gegebenenfalls zurückrollen.".into())
            }
        }
        Ok(Err(error)) => Err(error),
        Err(_) => Err("Abbruch angefordert, Serverabschluss nicht bestätigt. Server- und Transaktionszustand prüfen.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn options_are_isolated_and_clamped() {
        let a = run(
            Some(ExecutionOptions {
                query_timeout: Some(5),
                connection_timeout: Some(60),
                ..Default::default()
            }),
            false,
            async {
                tokio::task::yield_now().await;
                Ok((query_duration().as_secs(), connection_duration().as_secs()))
            },
        );
        let b = run(
            Some(ExecutionOptions {
                query_timeout: Some(900),
                connection_timeout: Some(1),
                ..Default::default()
            }),
            false,
            async { Ok((query_duration().as_secs(), connection_duration().as_secs())) },
        );
        let (a, b) = tokio::join!(a, b);
        assert_eq!(a.unwrap(), (5, 60));
        assert_eq!(b.unwrap(), (300, 3));
        assert_eq!(query_duration().as_secs(), 30);
    }

    #[tokio::test]
    async fn cancellation_is_scoped_to_live_jobs() {
        run(
            Some(ExecutionOptions {
                job_id: Some("execution-test".into()),
                ..Default::default()
            }),
            true,
            async {
                assert!(cancel("execution-test")?);
                assert!(CONTEXT.with(|ctx| ctx.cancel.is_cancelled()));
                Ok(())
            },
        )
        .await
        .unwrap();
        assert!(!cancel("execution-test").unwrap());
    }
}
