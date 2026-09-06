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
    pools: Mutex<HashMap<(String, PoolUse), PoolEntry>>,
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
        let entry = {
            let mut pools = self.pools.lock().await;
            pools
                .entry((connection_key.to_string(), pool_use))
                .or_default()
                .clone()
        };
        entry
            .get_or_try_init(|| async {
                let manager = PostgresConnectionManager::new(config, tls_connector(ssl)?);
                Pool::builder()
                    .max_size(if pool_use == PoolUse::Query { 8 } else { 4 })
                    .min_idle(Some(0))
                    .connection_timeout(Duration::from_secs(10))
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
            .retain(|(key, _), _| key != connection_key);
        self.shared.lock().await.remove(connection_key);
    }
}

pub type PoolState = Arc<PoolManager>;

pub fn create_pool_state() -> PoolState {
    Arc::new(PoolManager::new())
}
