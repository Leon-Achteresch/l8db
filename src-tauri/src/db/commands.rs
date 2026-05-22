use super::pool::PoolState;
use super::transaction::TransactionState;
use super::{
    create_adapter, create_adapter_from_string, AlterRoleOptions, ColumnInfo, ConnectionConfig,
    CreateRoleOptions, DatabaseKind, ERSchema, ExtensionInfo, ForeignKeyInfo, FunctionInfo, PrivilegeChange,
    QueryResult, RoleInfo, RolePrivileges, TableData, TableInfo, TriggerInfo,
};

#[tauri::command]
pub async fn test_connection(
    config: ConnectionConfig,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter(config, pool_state.inner().clone())
        .test_connection()
        .await
}

#[tauri::command]
pub async fn test_connection_string(
    kind: DatabaseKind,
    connection_string: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, None, pool_state.inner().clone())?
        .test_connection()
        .await
}

#[tauri::command]
pub async fn list_databases(
    kind: DatabaseKind,
    connection_string: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<String>, String> {
    create_adapter_from_string(kind, &connection_string, None, pool_state.inner().clone())?
        .list_databases()
        .await
}

#[tauri::command]
pub async fn list_schemas(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<String>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_schemas()
        .await
}

#[tauri::command]
pub async fn list_tables(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<TableInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
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
    offset: Option<i64>,
    order_by: Option<String>,
    order_desc: Option<bool>,
    is_view: Option<bool>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<TableData, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .fetch_rows(
            &schema,
            &table,
            filter.as_deref(),
            limit.unwrap_or(100),
            offset.unwrap_or(0),
            order_by.as_deref(),
            order_desc.unwrap_or(false),
            is_view.unwrap_or(false),
        )
        .await
}

#[tauri::command]
pub async fn count_table_rows(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    filter: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<i64, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .count_rows(&schema, &table, filter.as_deref())
        .await
}

#[tauri::command]
pub async fn update_row(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    ctid: String,
    updates: std::collections::HashMap<String, Option<String>>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .update_row(&schema, &table, &ctid, &updates)
        .await
}

#[tauri::command]
pub async fn list_all_columns(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: Option<String>,
    table_type: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<ColumnInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_columns(schema.as_deref(), None, table_type.as_deref())
        .await
}

#[tauri::command]
pub async fn execute_query(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    sql: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<QueryResult, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .execute_query(&sql)
        .await
}

#[tauri::command]
pub async fn list_views(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<TableInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_views(schema.as_deref())
        .await
}

#[tauri::command]
pub async fn get_view_definition(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    view: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<String, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .get_view_definition(&schema, &view)
        .await
}

#[tauri::command]
pub async fn update_view_definition(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    view: String,
    body: String,
    dry_run: bool,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .update_view_definition(&schema, &view, &body, dry_run)
        .await
}

#[tauri::command]
pub async fn begin_transaction(
    #[allow(unused_variables)] kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
    tx_state: tauri::State<'_, TransactionState>,
) -> Result<String, String> {
    tx_state
        .begin(&connection_string, database.as_deref(), pool_state.inner())
        .await
}

#[tauri::command]
pub async fn execute_in_transaction(
    tx_id: String,
    sql: String,
    tx_state: tauri::State<'_, TransactionState>,
) -> Result<QueryResult, String> {
    tx_state.execute(&tx_id, &sql).await
}

#[tauri::command]
pub async fn update_row_in_transaction(
    tx_id: String,
    schema: String,
    table: String,
    ctid: String,
    updates: std::collections::HashMap<String, Option<String>>,
    tx_state: tauri::State<'_, TransactionState>,
) -> Result<String, String> {
    tx_state
        .update_row(&tx_id, &schema, &table, &ctid, &updates)
        .await
}

#[tauri::command]
pub async fn commit_transaction(
    tx_id: String,
    tx_state: tauri::State<'_, TransactionState>,
) -> Result<(), String> {
    tx_state.commit(&tx_id).await
}

#[tauri::command]
pub async fn rollback_transaction(
    tx_id: String,
    tx_state: tauri::State<'_, TransactionState>,
) -> Result<(), String> {
    tx_state.rollback(&tx_id).await
}

#[tauri::command]
pub async fn list_transactions(
    tx_state: tauri::State<'_, TransactionState>,
) -> Result<Vec<String>, String> {
    Ok(tx_state.list_active_ids().await)
}

#[tauri::command]
pub async fn list_functions(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<FunctionInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_functions(schema.as_deref())
        .await
}

#[tauri::command]
pub async fn get_function_definition(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    oid: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<String, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .get_function_definition(&oid)
        .await
}

#[tauri::command]
pub async fn list_extensions(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<ExtensionInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_extensions()
        .await
}

#[tauri::command]
pub async fn validate_sql(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    sql: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .validate_sql(&sql)
        .await
}

#[tauri::command]
pub async fn list_roles(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<RoleInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_roles()
        .await
}

#[tauri::command]
pub async fn create_role(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    options: CreateRoleOptions,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .create_role(&options)
        .await
}

#[tauri::command]
pub async fn alter_role(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    options: AlterRoleOptions,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .alter_role(&options)
        .await
}

#[tauri::command]
pub async fn drop_role(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    name: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .drop_role(&name)
        .await
}

#[tauri::command]
pub async fn list_role_privileges(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    role_name: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<RolePrivileges, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_role_privileges(&role_name)
        .await
}

#[tauri::command]
pub async fn modify_privilege(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    change: PrivilegeChange,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .modify_privilege(&change)
        .await
}

#[tauri::command]
pub async fn list_foreign_keys(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<ForeignKeyInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_foreign_keys(&schema, &table)
        .await
}

#[tauri::command]
pub async fn get_er_schema(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<ERSchema, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .get_er_schema(schema.as_deref())
        .await
}

#[tauri::command]
pub async fn list_triggers(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<TriggerInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_triggers(&schema, &table)
        .await
}
