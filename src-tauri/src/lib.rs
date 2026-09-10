mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db::pool::create_pool_state())
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
            db::commands::get_view_definition
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
