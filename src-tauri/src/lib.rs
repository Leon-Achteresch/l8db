mod community_extensions;
mod db;
mod extension_process;
mod mcp;
mod versioning;

#[cfg(target_os = "windows")]
fn set_memory_target(window: &tauri::Window, low: bool) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;
    let Some(webview) = window.get_webview_window(window.label()) else {
        return;
    };
    let level = if low {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
    } else {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
    };
    let _ = webview.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            if let Ok(core) = core.cast::<ICoreWebView2_19>() {
                let _ = core.SetMemoryUsageTargetLevel(level);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::args().any(|arg| arg == "--mcp") {
        mcp::serve();
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_window_event(|_window, _event| {
            #[cfg(target_os = "windows")]
            if let tauri::WindowEvent::Focused(focused) = _event {
                set_memory_target(_window, !focused);
            }
        })
        .manage(community_extensions::ExtensionStoreLock::default())
        .manage(db::pool::create_pool_state())
        .manage(db::transaction::create_transaction_state())
        .manage(db::ssh::create_ssh_state())
        .invoke_handler(tauri::generate_handler![
            versioning::versioning_repository,
            versioning::metadata::versioning_metadata,
            versioning::control::versioning_control,
            versioning::runner::versioning_run,
            versioning::runner::versioning_run_fleet,
            versioning::runner::versioning_run_status,
            versioning::versioning_oracle_timeout,
            community_extensions::community_extension_store,
            community_extensions::read_community_extension,
            extension_process::extension_process_run,
            mcp::config::mcp_config,
            mcp::config::mcp_save_config,
            mcp::config::mcp_default_redaction,
            mcp::config::mcp_audit_tail,
            mcp::config::mcp_redact_preview,
            mcp::config::mcp_clear_audit,
            mcp::dashboard::mcp_dashboards,
            mcp::dashboard::mcp_dashboard_save,
            mcp::dashboard::mcp_dashboard_delete,
            mcp::clients::mcp_clients,
            mcp::clients::mcp_register,
            mcp::clients::mcp_server_command,
            db::commands::list_providers,
            db::commands::driver_status,
            db::commands::install_driver,
            db::commands::oracle_tns_names,
            db::commands::oracle_open_tnsnames,
            db::commands::test_connection,
            db::commands::test_connection_string,
            db::commands::list_databases,
            db::commands::list_schemas,
            db::commands::list_tables,
            db::commands::fetch_table_rows,
            db::commands::count_table_rows,
            db::commands::update_row,
            db::commands::list_all_columns,
            db::commands::search_columns,
            db::commands::search_source,
            db::commands::list_used_by,
            db::commands::list_object_grants,
            db::commands::list_synonyms,
            db::commands::list_scheduler_jobs,
            db::commands::set_scheduler_job_enabled,
            db::commands::run_scheduler_job,
            db::commands::execute_query,
            db::commands::cancel_execution,
            db::commands::configure_execution_defaults,
            db::commands::execute_query_with_params,
            db::commands::list_views,
            db::commands::get_view_definition,
            db::commands::update_view_definition,
            db::commands::begin_transaction,
            db::commands::execute_in_transaction,
            db::commands::execute_in_transaction_with_params,
            db::commands::update_row_in_transaction,
            db::commands::insert_row_in_transaction,
            db::commands::duplicate_row_in_transaction,
            db::commands::delete_row_in_transaction,
            db::commands::commit_transaction,
            db::commands::rollback_transaction,
            db::commands::list_transactions,
            db::commands::list_functions,
            db::commands::get_function_definition,
            db::commands::list_procedures,
            db::commands::compile_object,
            db::commands::list_invalid_objects,
            db::commands::list_compile_errors,
            db::commands::compile_invalid_objects,
            db::commands::start_debug_session,
            db::debugger::debug_availability,
            db::debugger::debug_launch,
            db::debugger::debug_snapshot,
            db::debugger::debug_action,
            db::debugger::debug_stop,
            db::commands::list_extensions,
            db::commands::validate_sql,
            db::commands::list_roles,
            db::commands::list_proxy_users,
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
            db::commands::list_import_columns,
            db::commands::csv_import,
            db::commands::read_csv_preview,
            db::commands::export_table_csv,
            db::commands::read_table_snapshot,
            db::commands::compare_table_data,
            db::commands::cancel_table_export,
            db::commands::add_column,
            db::commands::alter_column,
            db::commands::drop_column,
            db::commands::list_sequences,
            db::commands::alter_sequence,
            db::commands::list_indexes,
            db::commands::list_constraints,
            db::commands::install_extension,
            db::commands::uninstall_extension,
            db::commands::list_available_extensions,
            db::commands::execute_script,
            db::commands::set_server_output,
            db::commands::take_server_output,
            db::commands::create_table,
            db::commands::preview_create_table_ddl,
            db::commands::list_schema_copy_objects,
            db::commands::preview_schema_object_copy,
            db::commands::execute_schema_object_copy,
            db::commands::copy_schema_table_data,
            db::commands::preview_object_ddl,
            db::commands::execute_object_ddl,
            db::commands::object_audit_info,
            db::secrets::store_secret,
            db::secrets::load_secret,
            db::secrets::delete_secret,
            db::ssh::open_ssh_tunnel,
            db::ssh::close_ssh_tunnel,
            db::ssh::list_ssh_tunnels,
            db::commands::explain_query,
            db::commands::list_materialized_views,
            db::commands::refresh_materialized_view,
            db::commands::drop_materialized_view,
            db::commands::create_materialized_view,
            db::commands::get_table_rls,
            db::commands::set_table_rls,
            db::commands::create_policy,
            db::commands::drop_policy,
            db::commands::get_partition_info,
            db::commands::detach_partition,
            db::commands::attach_partition,
            db::commands::list_publications,
            db::commands::create_publication,
            db::commands::drop_publication,
            db::commands::list_subscriptions,
            db::commands::create_subscription,
            db::commands::drop_subscription,
            db::commands::list_sessions,
            db::commands::cancel_session,
            db::commands::terminate_session,
            db::commands::list_locks,
            db::commands::list_enums,
            db::commands::create_schema,
            db::commands::drop_schema,
            db::commands::get_database_overview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
