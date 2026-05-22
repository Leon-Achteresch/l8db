mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
            db::commands::update_view_definition,
            db::commands::begin_transaction,
            db::commands::execute_in_transaction,
            db::commands::update_row_in_transaction,
            db::commands::insert_row_in_transaction,
            db::commands::duplicate_row_in_transaction,
            db::commands::delete_row_in_transaction,
            db::commands::commit_transaction,
            db::commands::rollback_transaction,
            db::commands::list_transactions,
            db::commands::list_functions,
            db::commands::get_function_definition,
            db::commands::list_extensions,
            db::commands::validate_sql,
            db::commands::list_roles,
            db::commands::create_role,
            db::commands::alter_role,
            db::commands::drop_role,
            db::commands::list_role_privileges,
            db::commands::modify_privilege,
            db::commands::list_foreign_keys,
            db::commands::get_er_schema,
            db::commands::list_triggers,
            db::commands::drop_table,
            db::commands::truncate_table,
            db::commands::list_table_columns_detailed,
            db::commands::add_column,
            db::commands::alter_column,
            db::commands::drop_column
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
