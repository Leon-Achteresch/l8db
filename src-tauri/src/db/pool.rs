use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use bb8::Pool;
use bb8_postgres::PostgresConnectionManager;
use tokio::sync::Mutex;
use tokio_postgres::NoTls;

pub type PgPool = Pool<PostgresConnectionManager<NoTls>>;

pub struct PoolManager {
    pools: Mutex<HashMap<String, PgPool>>,
}

impl PoolManager {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }

    pub async fn get_pool(&self, connection_key: &str, config: tokio_postgres::Config) -> Result<PgPool, String> {
        let mut pools = self.pools.lock().await;

        if let Some(pool) = pools.get(connection_key) {
            return Ok(pool.clone());
        }

        let manager = PostgresConnectionManager::new(config, NoTls);
        let pool = Pool::builder()
            .max_size(5)
            .min_idle(Some(1))
            .connection_timeout(Duration::from_secs(10))
            .idle_timeout(Some(Duration::from_secs(300)))
            .build(manager)
            .await
            .map_err(|e| format!("Connection Pool konnte nicht erstellt werden: {e}"))?;

        pools.insert(connection_key.to_string(), pool.clone());
        Ok(pool)
    }

    pub async fn remove_pool(&self, connection_key: &str) {
        let mut pools = self.pools.lock().await;
        pools.remove(connection_key);
    }
}

pub type PoolState = Arc<PoolManager>;

pub fn create_pool_state() -> PoolState {
    Arc::new(PoolManager::new())
}
