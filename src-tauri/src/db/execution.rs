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
    pub max_rows: Option<usize>,
    pub cancel_mode: Option<String>,
}

pub struct Interruption<'a> {
    session: Option<&'a AtomicBool>,
    context: Option<Arc<AtomicBool>>,
}

impl<'a> Interruption<'a> {
    pub fn arm(session: Option<&'a AtomicBool>, context: Option<Arc<AtomicBool>>) -> Self {
        if let Some(flag) = session {
            flag.store(true, Ordering::Release);
        }
        if let Some(flag) = &context {
            flag.store(true, Ordering::Release);
        }
        Self { session, context }
    }

    pub fn clear(self) {
        if let Some(flag) = self.session {
            flag.store(false, Ordering::Release);
        }
        if let Some(flag) = &self.context {
            flag.store(false, Ordering::Release);
        }
    }
}

pub fn is_cancellation(error: &str) -> bool {
    error.contains("57014")
        || error.contains("canceling statement")
        || error.contains("user request")
        || error.contains("statement timeout")
}

pub const DRAIN_PROBES: usize = 2;

pub async fn drain_late_cancel<F, Fut>(mut probe: F) -> bool
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    for _ in 0..DRAIN_PROBES {
        match tokio::time::timeout(connection_duration(), probe()).await {
            Ok(Ok(())) => return true,
            Ok(Err(error)) if error.contains("25P02") => return true,
            Ok(Err(error)) if is_cancellation(&error) => continue,
            _ => return false,
        }
    }
    false
}

pub fn statement_cancel() -> bool {
    CONTEXT
        .try_with(|ctx| ctx.options.cancel_mode.as_deref() == Some("statement"))
        .unwrap_or(false)
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
    static SESSION: Option<String>;
    static DEADLINE: Duration;
    static UNCLAMPED: ();
    static ROW_LIMIT: usize;
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

pub fn interrupted() -> bool {
    CONTEXT
        .try_with(|ctx| ctx.interrupted.load(Ordering::Acquire))
        .unwrap_or(false)
}

pub fn session_id() -> Option<String> {
    SESSION.try_with(Clone::clone).ok().flatten()
}

pub async fn with_session<T, F>(session: Option<String>, future: F) -> T
where
    F: Future<Output = T>,
{
    let session = session.filter(|id| !id.is_empty() && id.len() <= 128);
    SESSION.scope(session, future).await
}

pub fn row_limit() -> usize {
    ROW_LIMIT.try_with(|limit| *limit).unwrap_or(usize::MAX)
}

pub async fn with_row_limit<T, F>(limit: usize, future: F) -> T
where
    F: Future<Output = T>,
{
    ROW_LIMIT.scope(limit, future).await
}

pub fn result_row_cap(maximum: usize) -> usize {
    CONTEXT
        .try_with(|ctx| ctx.options.max_rows)
        .ok()
        .flatten()
        .map_or(maximum, |rows| rows.clamp(1, maximum))
}

pub fn query_duration() -> Duration {
    let max = if UNCLAMPED.try_with(|_| ()).is_ok() {
        UNCLAMPED_MAX_SECONDS
    } else {
        300
    };
    Duration::from_secs(
        CONTEXT
            .try_with(|ctx| {
                ctx.options
                    .query_timeout
                    .unwrap_or_else(|| DEFAULT_QUERY_SECONDS.load(Ordering::Relaxed))
            })
            .unwrap_or_else(|_| DEFAULT_QUERY_SECONDS.load(Ordering::Relaxed))
            .clamp(5, max),
    )
}

pub const UNCLAMPED_MAX_SECONDS: u64 = 30 * 24 * 60 * 60;

pub async fn without_query_limit<T, F>(future: F) -> T
where
    F: Future<Output = T>,
{
    UNCLAMPED.scope((), future).await
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
            let deadline = query_duration();
            tokio::time::timeout(deadline, DEADLINE.scope(deadline, future))
                .await
                .map_err(|_| timeout_message())?
        }
    })
    .await
}

pub fn query_deadline() -> Option<Duration> {
    DEADLINE.try_with(|deadline| *deadline).ok()
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
        if self.interrupted.load(Ordering::Acquire) || interrupted() {
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
    ssl: &super::connection::PgTls,
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
    ssl: &super::connection::PgTls,
    session: Option<&PgSession>,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    guarded_with_drain(client.cancel_token(), ssl, session, Some(client), future).await
}

pub async fn guarded<T, F>(
    token: tokio_postgres::CancelToken,
    ssl: &super::connection::PgTls,
    session: Option<&PgSession>,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    guarded_with_drain(token, ssl, session, None, future).await
}

pub async fn guarded_with_drain<T, F>(
    token: tokio_postgres::CancelToken,
    ssl: &super::connection::PgTls,
    session: Option<&PgSession>,
    drain: Option<&tokio_postgres::Client>,
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
    let statement_only = statement_cancel();
    let interruption = Interruption::arm(
        session.map(|session| &session.interrupted),
        CONTEXT.try_with(|ctx| ctx.interrupted.clone()).ok(),
    );
    let cancellation = token.cancel_query(super::connection::tls_connector(ssl)?);
    let confirmed = match tokio::time::timeout(connection_duration(), cancellation).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(error.to_string()),
        Err(error) => Err(error.to_string()),
    };
    if let Err(error) = confirmed {
        return Err(format!(
            "Abbruch nicht bestätigt: {error}. Server- und Transaktionszustand prüfen."
        ));
    }
    let Ok(settled) = tokio::time::timeout(connection_duration(), &mut future).await else {
        return Err("Abbruch angefordert, Serverabschluss nicht bestätigt. Server- und Transaktionszustand prüfen.".into());
    };
    let consumed = matches!(&settled, Err(error) if is_cancellation(error));
    if statement_only {
        let clean = if consumed {
            true
        } else if let Some(client) = drain {
            drain_late_cancel(|| async {
                client
                    .simple_query("SELECT 1")
                    .await
                    .map(|_| ())
                    .map_err(super::map_pg_err)
            })
            .await
        } else {
            false
        };
        if clean {
            interruption.clear();
        }
    }
    match settled {
        Ok(result) => Ok(result),
        Err(_) if consumed => {
            if timed_out {
                Err(format!("Query-Timeout nach {} Sekunden: Abfrage vom Server abgebrochen. Offene Transaktion gegebenenfalls zurückrollen.", query_duration().as_secs()))
            } else {
                Err("Abfrage vom Server abgebrochen. Offene Transaktion gegebenenfalls zurückrollen.".into())
            }
        }
        Err(error) => Err(error),
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
        let unclamped = without_query_limit(run(
            Some(ExecutionOptions {
                query_timeout: Some(900),
                ..Default::default()
            }),
            false,
            async { Ok(query_duration().as_secs()) },
        ))
        .await;
        assert_eq!(unclamped.unwrap(), 900);
        assert_eq!(query_duration().as_secs(), 30);
    }

    #[test]
    fn interruption_stays_marked_on_every_early_exit() {
        let session = AtomicBool::new(false);
        let context = Arc::new(AtomicBool::new(false));
        {
            let _armed = Interruption::arm(Some(&session), Some(context.clone()));
        }
        assert!(session.load(Ordering::Acquire));
        assert!(context.load(Ordering::Acquire));
        Interruption::arm(Some(&session), Some(context.clone())).clear();
        assert!(!session.load(Ordering::Acquire));
        assert!(!context.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn a_dropped_statement_future_leaves_the_session_marked() {
        let session = AtomicBool::new(false);
        let pending = async {
            let armed = Interruption::arm(Some(&session), None);
            std::future::pending::<()>().await;
            armed.clear();
        };
        assert!(futures_util::FutureExt::now_or_never(pending).is_none());
        assert!(session.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn an_early_error_return_leaves_the_session_marked() {
        let session = AtomicBool::new(false);
        let failing = || -> Result<(), String> {
            let _armed = Interruption::arm(Some(&session), None);
            Err::<(), String>("TLS-Konfiguration ungültig".into())?;
            Ok(())
        };
        assert!(failing().is_err());
        assert!(session.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn the_drain_absorbs_a_late_cancel_with_bounded_probes() {
        use std::sync::atomic::AtomicUsize;
        let run = |answers: Vec<Result<(), String>>| async move {
            let calls = AtomicUsize::new(0);
            let answers = std::sync::Mutex::new(answers.into_iter());
            let clean = drain_late_cancel(|| {
                calls.fetch_add(1, Ordering::Relaxed);
                let next = answers.lock().unwrap().next().unwrap_or(Ok(()));
                async move { next }
            })
            .await;
            (clean, calls.load(Ordering::Relaxed))
        };
        let late = "ERROR: canceling statement due to user request (SQLSTATE 57014)".to_string();
        assert_eq!(run(vec![Ok(())]).await, (true, 1));
        assert_eq!(run(vec![Err(late.clone()), Ok(())]).await, (true, 2));
        assert_eq!(
            run(vec![
                Err(late.clone()),
                Err("current transaction is aborted (SQLSTATE 25P02)".into())
            ])
            .await,
            (true, 2)
        );
        assert_eq!(
            run(vec![Err(late.clone()), Err(late.clone())]).await,
            (false, DRAIN_PROBES)
        );
        assert_eq!(run(vec![Err("connection closed".into())]).await, (false, 1));
    }

    #[tokio::test]
    #[ignore]
    async fn statement_cancel_keeps_the_editor_session_and_transaction_usable() {
        let url = std::env::var("L8DB_E2E_PG_URL")
            .unwrap_or_else(|_| "postgresql://postgres:testpw@127.0.0.1:5433/testdb".into());
        let (config, ssl) = super::super::connection::parse_connection(&url, None).unwrap();
        let session = PgSession::new(connect_postgres(&config, &ssl).await.unwrap());
        session
            .lock()
            .await
            .unwrap()
            .batch_execute(
                "BEGIN; CREATE TEMP TABLE l8db_soft_cancel(id int); \
                 INSERT INTO l8db_soft_cancel VALUES (1); \
                 SET LOCAL search_path TO pg_temp, public; SAVEPOINT l8db_preview_e2e",
            )
            .await
            .unwrap();
        let job = "statement-cancel-e2e".to_string();
        let options = ExecutionOptions {
            job_id: Some(job.clone()),
            cancel_mode: Some("statement".into()),
            query_timeout: Some(30),
            ..Default::default()
        };
        let query = run(Some(options), true, async {
            let client = session.lock().await?;
            let outcome = postgres(&client, &ssl, Some(&session), async {
                client
                    .simple_query("SELECT pg_sleep(20)")
                    .await
                    .map(|_| ())
                    .map_err(super::super::map_pg_err)
            })
            .await;
            session.finish(outcome)
        });
        let canceller = async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            assert!(cancel(&job).unwrap());
        };
        let (result, _) = tokio::join!(query, canceller);
        assert!(result.unwrap_err().contains("abgebrochen"));
        assert!(session.available().await);
        let client = session.lock().await.unwrap();
        client
            .batch_execute("ROLLBACK TO SAVEPOINT l8db_preview_e2e")
            .await
            .unwrap();
        let count: i64 = client
            .query_one("SELECT count(*) FROM l8db_soft_cancel", &[])
            .await
            .unwrap()
            .get(0);
        assert_eq!(count, 1);
        let path: String = client
            .query_one("SHOW search_path", &[])
            .await
            .unwrap()
            .get(0);
        assert!(path.starts_with("pg_temp"), "{path}");
        client
            .batch_execute("SAVEPOINT still_in_transaction; ROLLBACK")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn statement_cancel_mode_is_scoped_to_its_request() {
        let soft = run(
            Some(ExecutionOptions {
                cancel_mode: Some("statement".into()),
                ..Default::default()
            }),
            false,
            async { Ok(statement_cancel()) },
        );
        let hard = run(None, false, async { Ok(statement_cancel()) });
        let (soft, hard) = tokio::join!(soft, hard);
        assert!(soft.unwrap());
        assert!(!hard.unwrap());
        assert!(!statement_cancel());
    }

    #[tokio::test]
    async fn result_row_cap_is_scoped_and_bounded() {
        let capped = |max_rows| {
            run(
                Some(ExecutionOptions {
                    max_rows,
                    ..Default::default()
                }),
                false,
                async { Ok(result_row_cap(1000)) },
            )
        };
        let (small, zero, large, unset) = tokio::join!(
            capped(Some(25)),
            capped(Some(0)),
            capped(Some(5000)),
            capped(None)
        );
        assert_eq!(small.unwrap(), 25);
        assert_eq!(zero.unwrap(), 1);
        assert_eq!(large.unwrap(), 1000);
        assert_eq!(unset.unwrap(), 1000);
        assert_eq!(result_row_cap(1000), 1000);
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
