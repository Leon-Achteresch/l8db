use std::str::FromStr;

use async_trait::async_trait;
use tokio_postgres::{Config, NoTls};

use super::{ConnectionConfig, DatabaseAdapter};

pub struct PostgresAdapter {
    config: Config,
}

impl PostgresAdapter {
    pub fn from_config(config: ConnectionConfig) -> Self {
        let mut pg = Config::new();
        pg.host(&config.host)
            .port(config.port)
            .user(&config.user)
            .password(&config.password)
            .dbname(&config.database);
        Self { config: pg }
    }

    pub fn from_connection_string(connection_string: &str) -> Result<Self, String> {
        let config = Config::from_str(connection_string).map_err(|error| error.to_string())?;
        Ok(Self { config })
    }
}

#[async_trait]
impl DatabaseAdapter for PostgresAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        let (client, connection) = self
            .config
            .connect(NoTls)
            .await
            .map_err(|error| error.to_string())?;

        let handle = tauri::async_runtime::spawn(connection);
        let result = client
            .simple_query("SELECT 1")
            .await
            .map(|_| ())
            .map_err(|error| error.to_string());
        handle.abort();
        result
    }
}
