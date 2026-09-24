use std::collections::BTreeMap;

use serde::Serialize;

use super::pool::PoolState;
use super::{create_adapter_from_string, DatabaseKind};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CatalogObject {
    pub object_type: String,
    pub name: String,
    pub parent: Option<String>,
    pub ddl: String,
    pub attributes: BTreeMap<String, String>,
}

impl CatalogObject {
    pub fn new(
        object_type: &str,
        name: impl Into<String>,
        parent: Option<String>,
        ddl: impl Into<String>,
    ) -> Self {
        Self {
            object_type: object_type.to_string(),
            name: name.into(),
            parent,
            ddl: ddl.into(),
            attributes: BTreeMap::new(),
        }
    }

    pub fn attr(mut self, key: &str, value: impl Into<String>) -> Self {
        self.attributes.insert(key.to_string(), value.into());
        self
    }
}

#[tauri::command]
pub async fn schema_catalog(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    types: Vec<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<CatalogObject>, String> {
    if schema.trim().is_empty() {
        return Err("Bitte ein Schema wählen.".to_string());
    }
    create_adapter_from_string(
        kind,
        &connection_string,
        database.as_deref(),
        pool_state.inner().clone(),
    )?
    .schema_catalog(&schema, &types)
    .await
}

#[tauri::command]
pub async fn schema_partition_ddl(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    tables: Vec<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<BTreeMap<String, String>, String> {
    create_adapter_from_string(
        kind,
        &connection_string,
        database.as_deref(),
        pool_state.inner().clone(),
    )?
    .schema_partition_ddl(&schema, &tables)
    .await
}
