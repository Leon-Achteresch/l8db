use super::{
    create_adapter, create_adapter_from_string, ConnectionConfig, DatabaseKind, TableData,
    TableInfo,
};

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<(), String> {
    create_adapter(config).test_connection().await
}

#[tauri::command]
pub async fn test_connection_string(
    kind: DatabaseKind,
    connection_string: String,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string)?
        .test_connection()
        .await
}

#[tauri::command]
pub async fn list_tables(
    kind: DatabaseKind,
    connection_string: String,
) -> Result<Vec<TableInfo>, String> {
    create_adapter_from_string(kind, &connection_string)?
        .list_tables()
        .await
}

#[tauri::command]
pub async fn fetch_table_rows(
    kind: DatabaseKind,
    connection_string: String,
    schema: String,
    table: String,
    limit: Option<i64>,
) -> Result<TableData, String> {
    create_adapter_from_string(kind, &connection_string)?
        .fetch_rows(&schema, &table, limit.unwrap_or(100))
        .await
}
