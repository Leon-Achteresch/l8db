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
    create_adapter_from_string(kind, &connection_string, None)?
        .test_connection()
        .await
}

#[tauri::command]
pub async fn list_databases(
    kind: DatabaseKind,
    connection_string: String,
) -> Result<Vec<String>, String> {
    create_adapter_from_string(kind, &connection_string, None)?
        .list_databases()
        .await
}

#[tauri::command]
pub async fn list_schemas(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref())?
        .list_schemas()
        .await
}

#[tauri::command]
pub async fn list_tables(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref())?
        .list_tables(schema.as_deref())
        .await
}

#[tauri::command]
pub async fn fetch_table_rows(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    filter: Option<String>,
    limit: Option<i64>,
    order_by: Option<String>,
    order_desc: Option<bool>,
) -> Result<TableData, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref())?
        .fetch_rows(
            &schema,
            &table,
            filter.as_deref(),
            limit.unwrap_or(100),
            order_by.as_deref(),
            order_desc.unwrap_or(false),
        )
        .await
}
