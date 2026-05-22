mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db::pool::create_pool_state())
        .manage(db::transaction::create_transaction_state())
        .invoke_handler(tauri::generate_handler![
            db::commands::test_connection,
            db::commands::test_connection_string,
            db::commands::list_databases,
            db::commands::list_schemas,
            db::commands::list_tables,
            db::commands::fetch_table_rows,
            db::commands::count_table_rows,
            db::commands::update_row,
            db::commands::list_all_columns,
            db::commands::execute_query,
            db::commands::list_views,
            db::commands::get_view_definition,
            db::commands::begin_transaction,
            db::commands::execute_in_transaction,
            db::commands::update_row_in_transaction,
            db::commands::commit_transaction,
            db::commands::rollback_transaction,
            db::commands::list_transactions,
            db::commands::list_functions,
            db::commands::get_function_definition,
            db::commands::list_extensions,
            db::commands::validate_sql
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
