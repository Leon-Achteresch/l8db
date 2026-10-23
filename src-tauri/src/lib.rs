mod ai;
mod appwrite;
mod automation;
#[cfg(test)]
mod baas_browser_tests;
mod baas_file;
#[cfg(test)]
mod baas_self_hosted_live_tests;
mod branching;
mod check_cli;
mod cli;
mod community_extensions;
mod connection_import;
mod convex;
mod convex_studio;
mod db;
mod desktop;
mod extension_process;
mod file_open;
mod firebase;
mod index_advisor;
mod mcp;
mod pocketbase;
mod process;
mod supabase;
mod supabase_studio;
mod sync;
mod team;
mod updates;
mod versioning;
mod windows;

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
    #[cfg(feature = "odbc")]
    db::configure_odbc();
    if std::env::args().any(|arg| arg == "--mcp") {
        mcp::serve();
        return;
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    if cli::wants(&args) {
        std::process::exit(cli::main(&args));
    }
    if args.iter().any(|arg| arg == "--check") {
        std::process::exit(check_cli::cli(&args));
    }
    if args
        .iter()
        .any(|arg| arg == "--run-task" || arg == "--list-tasks" || arg == "--automation-tick")
    {
        std::process::exit(automation::cli::cli(&args));
    }
    if args.iter().any(|arg| arg == "--benchmark") {
        std::process::exit(mcp::benchmark::cli(&args));
    }
    if let Some(index) = args.iter().position(|arg| arg == "--ai-mcp-relay") {
        if let Some(path) = args.get(index + 1) {
            ai::relay(path);
        }
        return;
    }
    desktop::install_panic_hook();
    let initial_files = std::env::current_dir()
        .map(|cwd| file_open::actions_from_args(&args, &cwd))
        .unwrap_or_default();
    let mut builder = tauri::Builder::default();
    if !cfg!(debug_assertions) {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let actions = file_open::actions_from_args(
                argv.get(1..).unwrap_or_default(),
                std::path::Path::new(&cwd),
            );
            if !windows::handle_args(app, &argv, true) || !actions.is_empty() {
                file_open::enqueue(app, actions);
            }
        }));
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .menu(desktop::app_menu)
            .on_menu_event(|app, event| windows::handle_menu_event(app, &event.id().0));
    }
    builder
        .setup(move |app| {
            desktop::install_logger(app.handle())?;
            windows::install_quick_menu(app.handle());
            windows::handle_args(app.handle(), &args, false);
            automation::init(app.handle());
            Ok(())
        })
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                ai::close_window(window);
                windows::forget(window);
                sync::forget_window(window);
            }
            #[cfg(target_os = "windows")]
            if let tauri::WindowEvent::Focused(focused) = event {
                set_memory_target(window, !focused);
            }
        })
        .manage(community_extensions::ExtensionStoreLock::default())
        .manage(file_open::PendingOpenFiles::new(initial_files))
        .manage(windows::WindowConnections::default())
        .manage(std::sync::Arc::new(ai::AiState::default()))
        .manage(db::pool::create_pool_state())
        .manage(db::transaction::create_transaction_state())
        .manage(db::ssh::create_ssh_state())
        .manage(automation::AutomationState::default())
        .invoke_handler(tauri::generate_handler![
            ai::ai_environment,
            ai::ai_status,
            ai::ai_set_key,
            ai::ai_models,
            ai::ai_skills,
            ai::ai_run,
            ai::ai_cancel,
            ai::ai_approve,
            ai::ai_respond,
            ai::complete::ai_complete,
            ai::complete::ai_complete_cancel,
            ai::knowledge::ai_knowledge_get,
            ai::knowledge::ai_knowledge_set,
            desktop::set_crash_reporting,
            automation::automation_sync_connections,
            automation::automation_list_tasks,
            automation::automation_get_task,
            automation::automation_save_task,
            automation::automation_delete_tasks,
            automation::automation_duplicate_task,
            automation::automation_set_enabled,
            automation::automation_validate_task,
            automation::automation_export_tasks,
            automation::automation_import_tasks,
            automation::automation_run_task,
            automation::automation_cancel_run,
            automation::automation_list_runs,
            automation::automation_get_run,
            automation::automation_delete_runs,
            automation::automation_export_runs,
            automation::automation_preview_schedule,
            automation::automation_next_runs,
            automation::automation_get_settings,
            automation::automation_save_settings,
            automation::automation_test_channel,
            automation::automation_test_connection,
            automation::automation_set_alert_mute,
            automation::automation_background_status,
            automation::automation_install_background,
            automation::automation_uninstall_background,
            automation::automation_cli_command,
            automation::automation_ai_activity,
            convex::convex_connect,
            convex::convex_connect_self_hosted,
            convex::convex_profiles,
            convex::convex_disconnect,
            convex::convex_projects,
            convex::convex_deployments,
            convex::convex_environment_variables,
            convex::convex_set_environment_variable,
            convex::convex_delete_environment_variable,
            convex_studio::data::convex_studio_data_tables,
            convex_studio::data::convex_studio_data_documents,
            convex_studio::data::convex_studio_data_resolve,
            convex_studio::data::convex_studio_data_insert,
            convex_studio::data::convex_studio_data_replace,
            convex_studio::data::convex_studio_data_patch,
            convex_studio::data::convex_studio_data_delete,
            convex_studio::data::convex_studio_data_clear,
            convex_studio::data::convex_studio_data_create_table,
            convex_studio::data::convex_studio_data_delete_table,
            convex_studio::data::convex_studio_data_schema,
            convex_studio::data::convex_studio_data_infer_schema,
            convex_studio::data::convex_studio_data_import,
            convex_studio::files::convex_studio_files_list,
            convex_studio::files::convex_studio_files_count,
            convex_studio::files::convex_studio_files_get,
            convex_studio::files::convex_studio_files_preview,
            convex_studio::files::convex_studio_files_download,
            convex_studio::files::convex_studio_files_upload,
            convex_studio::files::convex_studio_files_delete,
            convex_studio::functions::convex_studio_functions_list,
            convex_studio::functions::convex_studio_functions_detail,
            convex_studio::functions::convex_studio_functions_run,
            convex_studio::functions::convex_studio_functions_http_request,
            convex_studio::functions::convex_studio_functions_stats,
            convex_studio::logs::convex_studio_logs_fetch,
            convex_studio::logs::convex_studio_logs_cancel,
            convex_studio::schedules::convex_studio_schedules_jobs,
            convex_studio::schedules::convex_studio_schedules_job_args,
            convex_studio::schedules::convex_studio_schedules_cancel_job,
            convex_studio::schedules::convex_studio_schedules_cancel_all,
            convex_studio::schedules::convex_studio_schedules_functions,
            convex_studio::schedules::convex_studio_schedules_crons,
            convex_studio::schedules::convex_studio_schedules_cron_runs,
            convex_studio::schedules::convex_studio_schedules_run_cron,
            convex_studio::settings::convex_studio_settings_info,
            convex_studio::settings::convex_studio_settings_stats,
            convex_studio::settings::convex_studio_settings_recent_errors,
            convex_studio::settings::convex_studio_settings_env_reveal,
            convex_studio::settings::convex_studio_settings_env_import,
            convex_studio::settings::convex_studio_settings_env_export,
            convex_studio::settings::convex_studio_settings_set_paused,
            convex_studio::settings::convex_studio_settings_export_request,
            convex_studio::settings::convex_studio_settings_export_status,
            convex_studio::settings::convex_studio_settings_export_download,
            convex_studio::settings::convex_studio_settings_import_start,
            convex_studio::settings::convex_studio_settings_import_status,
            convex_studio::settings::convex_studio_settings_import_confirm,
            convex_studio::settings::convex_studio_settings_import_cancel,
            pocketbase::pocketbase_connect,
            pocketbase::pocketbase_profiles,
            pocketbase::pocketbase_disconnect,
            pocketbase::pocketbase_collections,
            pocketbase::pocketbase_records,
            pocketbase::pocketbase_create_collection,
            pocketbase::pocketbase_rename_collection,
            pocketbase::pocketbase_delete_collection,
            pocketbase::pocketbase_create_auth_user,
            pocketbase::pocketbase_create_record,
            pocketbase::pocketbase_update_record,
            pocketbase::pocketbase_delete_record,
            pocketbase::pocketbase_upload_file,
            pocketbase::pocketbase_delete_file,
            pocketbase::pocketbase_preview_file,
            pocketbase::pocketbase_download_file,
            appwrite::appwrite_connect,
            appwrite::appwrite_profiles,
            appwrite::appwrite_disconnect,
            appwrite::appwrite_buckets,
            appwrite::appwrite_create_bucket,
            appwrite::appwrite_rename_bucket,
            appwrite::appwrite_delete_bucket,
            appwrite::appwrite_files,
            appwrite::appwrite_upload_file,
            appwrite::appwrite_rename_file,
            appwrite::appwrite_delete_file,
            appwrite::appwrite_preview_file,
            appwrite::appwrite_download_file,
            appwrite::appwrite_databases,
            appwrite::appwrite_tables,
            appwrite::appwrite_rows,
            appwrite::appwrite_columns,
            appwrite::appwrite_functions,
            appwrite::appwrite_users,
            appwrite::appwrite_create_user,
            appwrite::appwrite_update_user_email,
            appwrite::appwrite_delete_user,
            appwrite::appwrite_delete_function,
            appwrite::appwrite_sites,
            supabase::supabase_connect,
            supabase::supabase_connect_self_hosted,
            supabase::supabase_disconnect_self_hosted,
            supabase::supabase_disconnect,
            supabase::supabase_is_connected,
            supabase::supabase_projects,
            supabase::supabase_database_endpoint,
            supabase::supabase_buckets,
            supabase::supabase_bucket_details,
            supabase::supabase_create_bucket,
            supabase::supabase_update_bucket_public,
            supabase::supabase_delete_bucket,
            supabase::supabase_functions,
            supabase::supabase_delete_function,
            supabase::supabase_health,
            supabase_studio::supabase_studio_capabilities,
            supabase_studio::auth::supabase_studio_auth_users,
            supabase_studio::auth::supabase_studio_auth_user,
            supabase_studio::auth::supabase_studio_auth_create_user,
            supabase_studio::auth::supabase_studio_auth_update_user,
            supabase_studio::auth::supabase_studio_auth_soft_delete_user,
            supabase_studio::auth::supabase_studio_auth_invite,
            supabase_studio::auth::supabase_studio_auth_generate_link,
            supabase_studio::auth::supabase_studio_auth_sign_out_user,
            supabase_studio::auth::supabase_studio_auth_delete_factor,
            supabase_studio::auth::supabase_studio_auth_settings,
            supabase_studio::auth::supabase_studio_auth_config,
            supabase_studio::auth::supabase_studio_auth_update_config,
            supabase_studio::database::supabase_studio_database_list,
            supabase_studio::database::supabase_studio_database_definition,
            supabase_studio::database::supabase_studio_database_action,
            supabase_studio::edge::supabase_studio_edge_function,
            supabase_studio::edge::supabase_studio_edge_function_source,
            supabase_studio::edge::supabase_studio_edge_function_download,
            supabase_studio::edge::supabase_studio_edge_function_deploy,
            supabase_studio::edge::supabase_studio_edge_function_update,
            supabase_studio::edge::supabase_studio_edge_secrets,
            supabase_studio::edge::supabase_studio_edge_secret_set,
            supabase_studio::edge::supabase_studio_edge_secret_delete,
            supabase_studio::edge::supabase_studio_edge_invoke,
            supabase_studio::edge::supabase_studio_edge_realtime_open,
            supabase_studio::edge::supabase_studio_edge_realtime_push,
            supabase_studio::edge::supabase_studio_edge_realtime_close,
            supabase_studio::edge::supabase_studio_edge_realtime_broadcast,
            supabase_studio::edge::supabase_studio_edge_publication_tables,
            supabase_studio::edge::supabase_studio_edge_publication_toggle,
            supabase_studio::edge::supabase_studio_edge_publication_actions,
            supabase_studio::observability::supabase_studio_observability_sessions,
            supabase_studio::observability::supabase_studio_observability_signal,
            supabase_studio::observability::supabase_studio_observability_locks,
            supabase_studio::observability::supabase_studio_observability_statements,
            supabase_studio::observability::supabase_studio_observability_statements_enable,
            supabase_studio::observability::supabase_studio_observability_statements_reset,
            supabase_studio::observability::supabase_studio_observability_health,
            supabase_studio::observability::supabase_studio_observability_sizes,
            supabase_studio::observability::supabase_studio_observability_logs,
            supabase_studio::observability::supabase_studio_observability_advisors,
            supabase_studio::observability::supabase_studio_observability_usage,
            supabase_studio::settings::supabase_studio_settings_overview_stats,
            supabase_studio::settings::supabase_studio_settings_reveal_key,
            supabase_studio::settings::supabase_studio_settings_api_keys,
            supabase_studio::settings::supabase_studio_settings_replace_self_hosted_key,
            supabase_studio::settings::supabase_studio_settings_postgrest,
            supabase_studio::settings::supabase_studio_settings_update_postgrest,
            supabase_studio::settings::supabase_studio_settings_postgres_config,
            supabase_studio::settings::supabase_studio_settings_update_postgres_config,
            supabase_studio::settings::supabase_studio_settings_pooler,
            supabase_studio::settings::supabase_studio_settings_ssl_enforcement,
            supabase_studio::settings::supabase_studio_settings_update_ssl_enforcement,
            supabase_studio::settings::supabase_studio_settings_network_restrictions,
            supabase_studio::settings::supabase_studio_settings_set_paused,
            supabase_studio::sql::supabase_studio_sql_run,
            supabase_studio::storage::supabase_studio_storage_buckets,
            supabase_studio::storage::supabase_studio_storage_bucket_create,
            supabase_studio::storage::supabase_studio_storage_bucket_update,
            supabase_studio::storage::supabase_studio_storage_bucket_empty,
            supabase_studio::storage::supabase_studio_storage_objects,
            supabase_studio::storage::supabase_studio_storage_upload,
            supabase_studio::storage::supabase_studio_storage_create_folder,
            supabase_studio::storage::supabase_studio_storage_transfer,
            supabase_studio::storage::supabase_studio_storage_delete,
            supabase_studio::storage::supabase_studio_storage_signed_url,
            supabase_studio::storage::supabase_studio_storage_public_url,
            supabase_studio::storage::supabase_studio_storage_object_info,
            supabase_studio::tables::supabase_studio_tables_schemas,
            supabase_studio::tables::supabase_studio_tables_list,
            supabase_studio::tables::supabase_studio_tables_describe,
            supabase_studio::tables::supabase_studio_tables_rows,
            supabase_studio::tables::supabase_studio_tables_insert_row,
            supabase_studio::tables::supabase_studio_tables_update_row,
            supabase_studio::tables::supabase_studio_tables_delete_rows,
            supabase_studio::tables::supabase_studio_tables_create_table,
            supabase_studio::tables::supabase_studio_tables_rename_table,
            supabase_studio::tables::supabase_studio_tables_drop_table,
            supabase_studio::tables::supabase_studio_tables_truncate,
            supabase_studio::tables::supabase_studio_tables_set_rls,
            supabase_studio::tables::supabase_studio_tables_add_column,
            supabase_studio::tables::supabase_studio_tables_alter_column,
            supabase_studio::tables::supabase_studio_tables_drop_column,
            supabase::supabase_backups,
            supabase::supabase_tables,
            supabase::supabase_table_columns,
            supabase::supabase_table_rows,
            supabase::supabase_has_project_key,
            supabase::supabase_set_project_key,
            supabase::supabase_import_project_key,
            supabase::supabase_delete_project_key,
            supabase::supabase_objects,
            supabase::supabase_upload_object,
            supabase::supabase_delete_object,
            supabase::supabase_move_object,
            supabase::supabase_preview_object,
            supabase::supabase_download_object,
            supabase::supabase_auth_users,
            supabase::supabase_create_auth_user,
            supabase::supabase_update_auth_user_email,
            supabase::supabase_delete_auth_user,
            firebase::firebase_connect,
            firebase::firebase_profiles,
            firebase::firebase_disconnect,
            firebase::firebase_buckets,
            firebase::firebase_objects,
            firebase::firebase_upload_object,
            firebase::firebase_auth_users,
            firebase::firebase_firestore_databases,
            firebase::firebase_firestore_collections,
            firebase::firebase_firestore_documents,
            firebase::firebase_functions,
            firebase::firebase_hosting_sites,
            firebase::firebase_hosting_releases,
            firebase::firebase_preview_object,
            firebase::firebase_download_object,
            versioning::versioning_repository,
            versioning::seeds::versioning_run_seed,
            versioning::metadata::versioning_metadata,
            versioning::control::versioning_control,
            versioning::runner::versioning_run,
            versioning::runner::versioning_run_fleet,
            versioning::runner::versioning_run_status,
            versioning::versioning_oracle_timeout,
            versioning::forge::versioning_forge,
            versioning::delivery::versioning_delivery,
            branching::branching_overview,
            branching::branching_columns,
            branching::branching_schema,
            branching::branching_snapshot,
            branching::branching_run,
            branching::branching_update,
            branching::branching_verify,
            branching::branching_local,
            branching::branching_schedules,
            branching::branching_jobs,
            branching::branching_audit,
            branching::branching_audit_export,
            branching::branching_vault,
            branching::branching_recovery_key,
            branching::branching_recovery_import,
            community_extensions::community_extension_store,
            community_extensions::read_community_extension,
            extension_process::extension_process_run,
            extension_process::extension_process_start,
            extension_process::extension_process_write,
            extension_process::extension_process_read,
            extension_process::extension_process_stop,
            file_open::take_pending_open_files,
            connection_import::decrypt_navicat_legacy_passwords,
            connection_import::read_dbeaver_workspace,
            connection_import::detect_dbeaver_workspace,
            connection_import::detect_jetbrains_ssh_configs,
            connection_import::resolve_connection_endpoints,
            file_open::resolve_open_files,
            updates::check_update,
            windows::open_app_window,
            windows::set_dock_recents,
            windows::set_window_connection,
            windows::connection_in_other_window,
            mcp::config::mcp_config,
            mcp::config::mcp_save_config,
            mcp::config::mcp_default_redaction,
            mcp::config::mcp_audit_tail,
            mcp::config::mcp_redact_preview,
            mcp::config::mcp_clear_audit,
            mcp::dashboard::mcp_dashboards,
            mcp::open::mcp_take_open_requests,
            mcp::dashboard::mcp_dashboard_save,
            mcp::dashboard::mcp_dashboard_delete,
            mcp::clients::mcp_clients,
            mcp::clients::mcp_register,
            mcp::clients::mcp_server_command,
            cli::install::cli_status,
            cli::install::cli_install,
            cli::install::cli_uninstall,
            db::commands::list_providers,
            db::s3::commands::s3_list_buckets,
            db::s3::commands::s3_create_bucket,
            db::s3::commands::s3_delete_bucket,
            db::s3::commands::s3_list_objects,
            db::s3::commands::s3_list_object_versions,
            db::s3::commands::s3_head_object,
            db::s3::commands::s3_preview_object,
            db::s3::commands::s3_get_object_text,
            db::s3::commands::s3_put_object_text,
            db::s3::commands::s3_create_folder,
            db::s3::commands::s3_delete_objects,
            db::s3::commands::s3_delete_prefix,
            db::s3::commands::s3_copy_objects,
            db::s3::commands::s3_rename_object,
            db::s3::commands::s3_restore_version,
            db::s3::commands::s3_update_object_properties,
            db::s3::commands::s3_get_config,
            db::s3::commands::s3_put_config,
            db::s3::commands::s3_delete_config,
            db::s3::commands::s3_presign,
            db::s3::commands::s3_list_multipart_uploads,
            db::s3::commands::s3_abort_multipart_upload,
            db::s3::commands::s3_bucket_stats,
            db::s3::commands::s3_search_objects,
            db::s3::commands::s3_select_object,
            db::s3::commands::s3_upload,
            db::s3::commands::s3_download,
            db::s3::commands::s3_cancel_transfer,
            db::commands::driver_status,
            db::commands::backup_probe,
            db::commands::run_backup,
            db::commands::run_restore,
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
            db::commands::count_table_rows_capped,
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
            db::dml_preview::preview_dml,
            db::commands::describe_query_columns,
            db::commands::list_views,
            db::commands::get_view_definition,
            db::commands::get_table_ddl,
            db::commands::update_view_definition,
            db::commands::begin_transaction,
            db::commands::execute_in_transaction,
            db::commands::execute_in_transaction_with_params,
            db::commands::transaction_database_changes,
            db::commands::transaction_server_output,
            db::commands::update_row_in_transaction,
            db::commands::insert_row_in_transaction,
            db::commands::duplicate_row_in_transaction,
            db::commands::delete_row_in_transaction,
            db::commands::commit_transaction,
            db::commands::rollback_transaction,
            db::commands::list_transactions,
            db::commands::list_functions,
            db::commands::list_package_members,
            db::commands::get_function_definition,
            db::commands::list_procedures,
            db::commands::compile_object,
            db::commands::list_invalid_objects,
            db::commands::list_compile_errors,
            db::commands::compile_invalid_objects,
            db::commands::server_info,
            db::sql_log::sql_log_configure,
            db::sql_log::sql_log_entries,
            db::sql_log::sql_log_clear,
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
            db::commands::table_comment,
            db::commands::drop_table,
            db::commands::truncate_table,
            db::commands::list_table_columns_detailed,
            db::commands::list_import_columns,
            db::commands::csv_import,
            db::commands::read_import_preview,
            db::commands::export_rows_file,
            db::commands::copy_table_to_connection,
            db::transfer::plan_transfer,
            db::transfer::run_transfer,
            db::datagen::datagen_plan,
            db::datagen::datagen_preview,
            db::datagen::datagen_seed_script,
            db::datagen::datagen_run,
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
            db::sql_script::sql_search_path,
            db::commands::set_server_output,
            db::commands::take_server_output,
            db::commands::create_table,
            db::commands::preview_create_table_ddl,
            db::commands::preview_constraint_change,
            db::commands::apply_constraint_change,
            db::commands::column_value_options,
            db::commands::list_schema_copy_objects,
            db::commands::preview_schema_object_copy,
            db::commands::execute_schema_object_copy,
            db::commands::copy_schema_table_data,
            db::schema_catalog::schema_catalog,
            db::schema_catalog::schema_partition_ddl,
            db::commands::preview_object_ddl,
            db::commands::execute_object_ddl,
            db::commands::object_audit_info,
            db::secrets::store_secret,
            db::secrets::load_secret,
            db::secrets::delete_secret,
            team::team_connections,
            sync::sync_test,
            sync::sync_fetch,
            sync::sync_store,
            sync::sync_cancel,
            sync::sync_encrypt,
            sync::sync_decrypt,
            sync::sync_merge_secrets,
            sync::sync_backup_restore_secrets,
            sync::sync_claim_leader,
            sync::sync_release_leader,
            sync::sync_begin,
            sync::sync_end,
            sync::sync_backup_save,
            sync::sync_backup_list,
            sync::sync_backup_load,
            db::ssh::open_ssh_tunnel,
            db::ssh::open_proxy_tunnel,
            db::ssh::open_command_tunnel,
            db::ssh::config::list_ssh_config_hosts,
            db::ssh::close_ssh_tunnel,
            db::ssh::list_ssh_tunnels,
            db::commands::explain_query,
            index_advisor::advise_indexes,
            db::postgres_health::run_database_health_checks,
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
            db::commands::live_metrics,
            db::commands::list_enums,
            db::commands::create_schema,
            db::commands::drop_schema,
            db::commands::get_database_overview,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            if let tauri::RunEvent::Exit = _event {
                db::ssh::command::kill_all();
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let actions = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|path| file_open::action_for_path(&path))
                    .collect();
                file_open::enqueue(_app, actions);
            }
        });
}
