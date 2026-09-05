use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use bb8::Pool;
use bb8_postgres::PostgresConnectionManager;
use postgres_native_tls::MakeTlsConnector;
use tokio::sync::Mutex;

pub type PgPool = Pool<PostgresConnectionManager<MakeTlsConnector>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoolUse {
    Query,
    Metadata,
}

struct Pools {
    query: PgPool,
    metadata: PgPool,
}

pub struct PoolManager {
    pools: Mutex<HashMap<String, Pools>>,
}

impl PoolManager {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }

    fn make_tls() -> Result<MakeTlsConnector, String> {
        let connector = native_tls::TlsConnector::new()
            .map_err(|e| format!("TLS-Connector konnte nicht erstellt werden: {e}"))?;
        Ok(MakeTlsConnector::new(connector))
    }

    async fn build_pool(
        config: tokio_postgres::Config,
        max_size: u32,
    ) -> Result<PgPool, String> {
        let manager = PostgresConnectionManager::new(config, Self::make_tls()?);
        Pool::builder()
            .max_size(max_size)
            .min_idle(Some(1))
            .connection_timeout(Duration::from_secs(10))
            .idle_timeout(Some(Duration::from_secs(300)))
            .build(manager)
            .await
            .map_err(|e| format!("Connection Pool konnte nicht erstellt werden: {e}"))
    }

    pub async fn get_pool(
        &self,
        connection_key: &str,
        config: tokio_postgres::Config,
        pool_use: PoolUse,
    ) -> Result<PgPool, String> {
        let mut pools = self.pools.lock().await;

        if let Some(entry) = pools.get(connection_key) {
            return Ok(match pool_use {
                PoolUse::Query => entry.query.clone(),
                PoolUse::Metadata => entry.metadata.clone(),
            });
        }

        let query = Self::build_pool(config.clone(), 8).await?;
        let metadata = Self::build_pool(config, 4).await?;
        pools.insert(
            connection_key.to_string(),
            Pools {
                query: query.clone(),
                metadata: metadata.clone(),
            },
        );
        Ok(match pool_use {
            PoolUse::Query => query,
            PoolUse::Metadata => metadata,
        })
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
