use super::{create_adapter, create_adapter_from_string, ConnectionConfig, DatabaseKind};

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
