use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use bb8::Pool;
use bb8_postgres::PostgresConnectionManager;
use postgres_native_tls::MakeTlsConnector;
use tokio::sync::{Mutex, OnceCell};

use super::{connection::tls_connector, SslMode};

pub type PgPool = Pool<PostgresConnectionManager<MakeTlsConnector>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PoolUse {
    Query,
    Metadata,
}

type PoolEntry = Arc<OnceCell<PgPool>>;
type SharedEntry = Arc<OnceCell<Arc<dyn Any + Send + Sync>>>;

pub struct PoolManager {
    pools: Mutex<HashMap<(String, PoolUse, u64), PoolEntry>>,
    shared: Mutex<HashMap<String, SharedEntry>>,
}

impl Default for PoolManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PoolManager {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
            shared: Mutex::new(HashMap::new()),
        }
    }

    pub async fn get_pool(
        &self,
        connection_key: &str,
        config: tokio_postgres::Config,
        ssl: SslMode,
        pool_use: PoolUse,
    ) -> Result<PgPool, String> {
        let timeout = super::execution::connection_duration();
        let entry = {
            let secs = timeout.as_secs();
            let mut pools = self.pools.lock().await;
            pools.retain(|(key, _, entry_secs), _| key != connection_key || *entry_secs == secs);
            pools
                .entry((connection_key.to_string(), pool_use, secs))
                .or_default()
                .clone()
        };
        entry
            .get_or_try_init(|| async {
                let manager = PostgresConnectionManager::new(config, tls_connector(ssl)?);
                Pool::builder()
                    .max_size(if pool_use == PoolUse::Query { 8 } else { 2 })
                    .min_idle(Some(0))
                    .connection_timeout(timeout)
                    .idle_timeout(Some(Duration::from_secs(60)))
                    .build(manager)
                    .await
                    .map_err(|e| format!("Connection Pool konnte nicht erstellt werden: {e}"))
            })
            .await
            .cloned()
    }

    pub async fn shared<T, F, Fut>(&self, connection_key: &str, init: F) -> Result<Arc<T>, String>
    where
        T: Send + Sync + 'static,
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        let cell = {
            let mut shared = self.shared.lock().await;
            shared
                .entry(connection_key.to_string())
                .or_default()
                .clone()
        };
        cell.get_or_try_init(|| async {
            let created: Arc<dyn Any + Send + Sync> = Arc::new(init().await?);
            Ok::<_, String>(created)
        })
        .await?
        .clone()
        .downcast::<T>()
        .map_err(|_| "Shared State hat einen anderen Typ".to_string())
    }

    pub async fn remove_pool(&self, connection_key: &str) {
        self.pools
            .lock()
            .await
            .retain(|(key, _, _), _| key != connection_key);
        let prefix = format!("{connection_key}#");
        self.shared
            .lock()
            .await
            .retain(|key, _| key != connection_key && !key.starts_with(&prefix));
    }
}

pub const IDLE_CHECK_AFTER: Duration = Duration::from_secs(30);

pub struct BlockingPool<T> {
    permits: tokio::sync::Semaphore,
    idle: std::sync::Mutex<Vec<(T, std::time::Instant)>>,
}

impl<T: Send + 'static> BlockingPool<T> {
    pub fn new(capacity: usize) -> Self {
        Self {
            permits: tokio::sync::Semaphore::new(capacity),
            idle: std::sync::Mutex::new(Vec::with_capacity(capacity)),
        }
    }

    pub async fn run<R, F, O, Fut, C>(&self, open: O, check: C, f: F) -> Result<R, String>
    where
        R: Send + 'static,
        F: FnOnce(&T) -> Result<R, String> + Send + 'static,
        O: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
        C: FnOnce(&T) -> bool + Send + 'static,
    {
        let _permit = self
            .permits
            .acquire()
            .await
            .map_err(|_| "Verbindungspool geschlossen".to_string())?;
        let idle = self
            .idle
            .lock()
            .map_err(|_| "Verbindungspool blockiert".to_string())?
            .pop();
        let idle = match idle {
            Some((conn, last_used)) if last_used.elapsed() > IDLE_CHECK_AFTER => {
                tokio::task::spawn_blocking(move || check(&conn).then_some(conn))
                    .await
                    .map_err(|e| format!("Datenbank-Task fehlgeschlagen: {e}"))?
            }
            Some((conn, _)) => Some(conn),
            None => None,
        };
        let conn = match idle {
            Some(conn) => conn,
            None => open().await?,
        };
        let (result, conn) = tokio::task::spawn_blocking(move || {
            let result = f(&conn);
            (result, conn)
        })
        .await
        .map_err(|e| format!("Datenbank-Task fehlgeschlagen: {e}"))?;
        if result.is_ok() {
            if let Ok(mut idle) = self.idle.lock() {
                idle.push((conn, std::time::Instant::now()));
            }
        }
        result
    }
}

pub type PoolState = Arc<PoolManager>;

pub fn create_pool_state() -> PoolState {
    Arc::new(PoolManager::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn blocking_pool_limits_concurrency_and_reuses_connections() {
        let pool = Arc::new(BlockingPool::<usize>::new(2));
        let opened = Arc::new(AtomicUsize::new(0));
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let (pool, opened, active, peak) =
                (pool.clone(), opened.clone(), active.clone(), peak.clone());
            tasks.push(tokio::spawn(async move {
                pool.run(
                    || async { Ok(opened.fetch_add(1, Ordering::SeqCst)) },
                    |_| true,
                    move |_conn| {
                        let now = active.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(now, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(20));
                        active.fetch_sub(1, Ordering::SeqCst);
                        Ok::<(), String>(())
                    },
                )
                .await
            }));
        }
        for task in tasks {
            task.await.expect("join").expect("run");
        }
        assert!(peak.load(Ordering::SeqCst) <= 2);
        assert!(opened.load(Ordering::SeqCst) <= 2);
        let failed = pool
            .run(
                || async { Ok(99usize) },
                |_| true,
                |_| Err::<(), String>("kaputt".into()),
            )
            .await;
        assert_eq!(failed, Err("kaputt".to_string()));
    }

    #[tokio::test]
    async fn blocking_pool_replaces_stale_connections_that_fail_check() {
        let pool = BlockingPool::<usize>::new(1);
        pool.run(|| async { Ok(1) }, |_| true, |_| Ok::<(), String>(()))
            .await
            .unwrap();
        if let Ok(mut idle) = pool.idle.lock() {
            idle[0].1 = std::time::Instant::now() - IDLE_CHECK_AFTER * 2;
        }
        let seen = pool
            .run(|| async { Ok(2) }, |_| false, |c| Ok::<usize, String>(*c))
            .await
            .unwrap();
        assert_eq!(seen, 2);
        let reused = pool
            .run(|| async { Ok(3) }, |_| false, |c| Ok::<usize, String>(*c))
            .await
            .unwrap();
        assert_eq!(reused, 2);
    }

    #[tokio::test]
    async fn get_pool_evicts_entries_with_stale_connection_timeout() {
        let manager = PoolManager::new();
        let config: tokio_postgres::Config = "host=127.0.0.1 port=1 user=x dbname=x"
            .parse()
            .expect("config");
        manager
            .get_pool("key", config.clone(), SslMode::Disable, PoolUse::Query)
            .await
            .expect("pool");
        {
            let mut pools = manager.pools.lock().await;
            let entry = pools
                .keys()
                .next()
                .cloned()
                .map(|(key, use_, secs)| (key, use_, secs + 1))
                .expect("entry");
            pools.clear();
            pools.insert(entry, PoolEntry::default());
            pools.insert(
                ("other".to_string(), PoolUse::Query, 1),
                PoolEntry::default(),
            );
        }
        manager
            .get_pool("key", config, SslMode::Disable, PoolUse::Query)
            .await
            .expect("pool");
        let pools = manager.pools.lock().await;
        assert_eq!(pools.keys().filter(|(key, _, _)| key == "key").count(), 1);
        assert_eq!(pools.len(), 2);
    }
}
