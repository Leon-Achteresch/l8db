use super::pool::PoolState;
use super::transaction::TransactionState;
use super::{
    create_adapter, create_adapter_from_string, AddColumnRequest, AlterColumnRequest,
    AlterRoleOptions, AlterSequenceRequest, AvailableExtensionInfo, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateMatviewRequest, CreatePolicyRequest, CreatePublicationRequest,
    CreateRoleOptions, CreateSubscriptionRequest, CreateTableRequest, DatabaseKind, DetailedColumnInfo,
    ERSchema, ExtensionInfo, ForeignKeyInfo, FunctionInfo, IndexInfo, PrivilegeChange, QueryResult,
    RoleInfo, RolePrivileges, ScriptStatementResult, SequenceInfo, TableData, TableInfo, TriggerInfo,
};

#[tauri::command]
pub async fn test_connection(
    config: ConnectionConfig,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter(config, pool_state.inner().clone())?
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
    allow_raw: Option<bool>,
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
            allow_raw.unwrap_or(true),
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
    allow_raw: Option<bool>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<i64, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .count_rows(&schema, &table, filter.as_deref(), allow_raw.unwrap_or(true))
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
pub async fn insert_row_in_transaction(
    tx_id: String,
    schema: String,
    table: String,
    values: std::collections::HashMap<String, Option<String>>,
    tx_state: tauri::State<'_, TransactionState>,
) -> Result<serde_json::Value, String> {
    tx_state
        .insert_row(&tx_id, &schema, &table, &values)
        .await
}

#[tauri::command]
pub async fn duplicate_row_in_transaction(
    tx_id: String,
    schema: String,
    table: String,
    ctid: String,
    tx_state: tauri::State<'_, TransactionState>,
) -> Result<serde_json::Value, String> {
    tx_state
        .duplicate_row(&tx_id, &schema, &table, &ctid)
        .await
}

#[tauri::command]
pub async fn delete_row_in_transaction(
    tx_id: String,
    schema: String,
    table: String,
    ctid: String,
    tx_state: tauri::State<'_, TransactionState>,
) -> Result<(), String> {
    tx_state
        .delete_row(&tx_id, &schema, &table, &ctid)
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
pub async fn drop_table(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .drop_table(&schema, &table)
        .await
}

#[tauri::command]
pub async fn truncate_table(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .truncate_table(&schema, &table)
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

#[tauri::command]
pub async fn list_table_columns_detailed(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<DetailedColumnInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_table_columns_detailed(&schema, &table)
        .await
}

#[tauri::command]
pub async fn add_column(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    column: AddColumnRequest,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .add_column(&schema, &table, &column)
        .await
}

#[tauri::command]
pub async fn alter_column(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    changes: AlterColumnRequest,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .alter_column(&schema, &table, &changes)
        .await
}

#[tauri::command]
pub async fn drop_column(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    column: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .drop_column(&schema, &table, &column)
        .await
}

#[tauri::command]
pub async fn list_sequences(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<SequenceInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_sequences(schema.as_deref())
        .await
}

#[tauri::command]
pub async fn alter_sequence(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    name: String,
    changes: AlterSequenceRequest,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .alter_sequence(&schema, &name, &changes)
        .await
}

#[tauri::command]
pub async fn list_indexes(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<IndexInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_indexes(&schema, &table)
        .await
}

#[tauri::command]
pub async fn list_constraints(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<ConstraintInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_constraints(&schema, &table)
        .await
}

#[tauri::command]
pub async fn install_extension(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    name: String,
    schema: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .install_extension(&name, schema.as_deref())
        .await
}

#[tauri::command]
pub async fn uninstall_extension(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    name: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .uninstall_extension(&name)
        .await
}

#[tauri::command]
pub async fn list_available_extensions(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<AvailableExtensionInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_available_extensions()
        .await
}

#[tauri::command]
pub async fn execute_script(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    sql: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<ScriptStatementResult>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .execute_script(&sql)
        .await
}

#[tauri::command]
pub async fn create_table(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    request: CreateTableRequest,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .create_table(&request)
        .await
}

#[tauri::command]
pub async fn explain_query(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    sql: String,
    analyze: bool,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<serde_json::Value, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .explain_query(&sql, analyze)
        .await
}

#[tauri::command]
pub async fn list_materialized_views(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<super::MatviewInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_materialized_views(schema.as_deref())
        .await
}

#[tauri::command]
pub async fn refresh_materialized_view(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    name: String,
    concurrently: bool,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .refresh_materialized_view(&schema, &name, concurrently)
        .await
}

#[tauri::command]
pub async fn drop_materialized_view(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    name: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .drop_materialized_view(&schema, &name)
        .await
}

#[tauri::command]
pub async fn create_materialized_view(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    request: CreateMatviewRequest,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .create_materialized_view(&request)
        .await
}

#[tauri::command]
pub async fn get_table_rls(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<super::TableRlsInfo, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .get_table_rls(&schema, &table)
        .await
}

#[tauri::command]
pub async fn set_table_rls(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    enabled: bool,
    force: bool,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .set_table_rls(&schema, &table, enabled, force)
        .await
}

#[tauri::command]
pub async fn create_policy(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    policy: CreatePolicyRequest,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .create_policy(&schema, &table, &policy)
        .await
}

#[tauri::command]
pub async fn drop_policy(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    name: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .drop_policy(&schema, &table, &name)
        .await
}

#[tauri::command]
pub async fn get_partition_info(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<super::PartitionInfo, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .get_partition_info(&schema, &table)
        .await
}

#[tauri::command]
pub async fn detach_partition(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    parent_schema: String,
    parent_table: String,
    child_schema: String,
    child_table: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .detach_partition(&parent_schema, &parent_table, &child_schema, &child_table)
        .await
}

#[tauri::command]
pub async fn attach_partition(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    parent_schema: String,
    parent_table: String,
    child_schema: String,
    child_table: String,
    bound: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .attach_partition(&parent_schema, &parent_table, &child_schema, &child_table, &bound)
        .await
}

#[tauri::command]
pub async fn list_publications(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<super::PublicationInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_publications()
        .await
}

#[tauri::command]
pub async fn create_publication(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    request: CreatePublicationRequest,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .create_publication(&request)
        .await
}

#[tauri::command]
pub async fn drop_publication(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    name: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .drop_publication(&name)
        .await
}

#[tauri::command]
pub async fn list_subscriptions(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<super::SubscriptionInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_subscriptions()
        .await
}

#[tauri::command]
pub async fn create_subscription(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    request: CreateSubscriptionRequest,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .create_subscription(&request)
        .await
}

#[tauri::command]
pub async fn drop_subscription(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    name: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .drop_subscription(&name)
        .await
}

#[tauri::command]
pub async fn list_sessions(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<super::SessionInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_sessions()
        .await
}

#[tauri::command]
pub async fn cancel_session(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pid: i32,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<bool, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .cancel_session(pid)
        .await
}

#[tauri::command]
pub async fn terminate_session(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pid: i32,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<bool, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .terminate_session(pid)
        .await
}

#[tauri::command]
pub async fn list_locks(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<super::LockInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_locks()
        .await
}

#[tauri::command]
pub async fn list_enums(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<super::EnumInfo>, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .list_enums(schema.as_deref())
        .await
}

#[tauri::command]
pub async fn create_schema(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    name: String,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .create_schema(&name)
        .await
}

#[tauri::command]
pub async fn drop_schema(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    name: String,
    cascade: bool,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .drop_schema(&name, cascade)
        .await
}

#[tauri::command]
pub async fn get_database_overview(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<super::DatabaseOverview, String> {
    create_adapter_from_string(kind, &connection_string, database.as_deref(), pool_state.inner().clone())?
        .get_database_overview()
        .await
}
