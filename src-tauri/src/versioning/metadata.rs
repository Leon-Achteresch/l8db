use crate::db::{self, DatabaseAdapter};
use serde_json::{json, Value};

pub async fn read(
    adapter: &dyn DatabaseAdapter,
    operation: &str,
    schema: &str,
    name: &str,
) -> Result<Value, String> {
    match operation {
        "columns" => adapter
            .list_table_columns_detailed(schema, name)
            .await
            .map(|v| json!(v)),
        "constraints" => adapter
            .list_constraints(schema, name)
            .await
            .map(|v| json!(v)),
        "indexes" => adapter.list_indexes(schema, name).await.map(|v| json!(v)),
        "triggers" => adapter.list_triggers(schema, name).await.map(|v| json!(v)),
        "view" => adapter
            .get_view_definition(schema, name)
            .await
            .map(|v| json!(v)),
        "routine" | "procedure" => {
            let items = if operation == "procedure" {
                adapter.list_procedures(Some(schema)).await?
            } else {
                adapter.list_functions(Some(schema)).await?
            };
            let matches: Vec<_> = items
                .iter()
                .filter(|item| format!("{}({})", item.name, item.identity_args) == name)
                .collect();
            if matches.len() != 1 {
                return Err("Routine fehlt oder ist nicht eindeutig".into());
            }
            adapter
                .get_function_definition(&matches[0].oid)
                .await
                .map(|v| json!(v))
        }
        "sequences" => adapter.list_sequences(Some(schema)).await.map(|v| json!(v)),
        _ => Err("Nicht unterstützte Metadatenoperation".into()),
    }
}

#[tauri::command]
pub async fn versioning_metadata(
    tx_id: String,
    operation: String,
    schema: String,
    name: String,
    transactions: tauri::State<'_, db::transaction::TransactionState>,
    pool: tauri::State<'_, db::pool::PoolState>,
) -> Result<Value, String> {
    let adapter = transactions
        .versioning_adapter(&tx_id, pool.inner().clone())
        .await?;
    read(adapter.as_ref(), &operation, &schema, &name).await
}
