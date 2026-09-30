mod appwrite;
mod baas_file;
mod check_cli;
mod community_extensions;
mod convex;
mod db;
mod desktop;
mod extension_process;
mod file_open;
mod firebase;
mod index_advisor;
mod mcp;
mod pocketbase;
mod supabase;
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
    #[cfg(feature = "odbc")]
    db::configure_odbc();
    if std::env::args().any(|arg| arg == "--mcp") {
        mcp::serve();
        return;
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--check") {
        std::process::exit(check_cli::cli(&args));
    }
    if args.iter().any(|arg| arg == "--benchmark") {
        std::process::exit(mcp::benchmark::cli(&args));
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
            file_open::enqueue(app, actions);
        }));
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.menu(desktop::app_menu).on_menu_event(|app, event| {
            use tauri::{Emitter, Manager};
            let label = app
                .webview_windows()
                .into_iter()
                .find(|(_, window)| window.is_focused().unwrap_or(false))
                .map(|(label, _)| label)
                .unwrap_or_else(|| "main".to_string());
            let _ = app.emit_to(label.as_str(), "menu-action", event.id().0.clone());
        });
    }
    builder
        .plugin(desktop::log_plugin())
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
        .on_window_event(|_window, _event| {
            #[cfg(target_os = "windows")]
            if let tauri::WindowEvent::Focused(focused) = _event {
                set_memory_target(_window, !focused);
            }
        })
        .manage(community_extensions::ExtensionStoreLock::default())
        .manage(file_open::PendingOpenFiles::new(initial_files))
        .manage(db::pool::create_pool_state())
        .manage(db::transaction::create_transaction_state())
        .manage(db::ssh::create_ssh_state())
        .invoke_handler(tauri::generate_handler![
            desktop::set_crash_reporting,
            convex::convex_connect,
            convex::convex_profiles,
            convex::convex_disconnect,
            convex::convex_projects,
            convex::convex_deployments,
            convex::convex_environment_variables,
            convex::convex_set_environment_variable,
            convex::convex_delete_environment_variable,
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
            versioning::metadata::versioning_metadata,
            versioning::control::versioning_control,
            versioning::runner::versioning_run,
            versioning::runner::versioning_run_fleet,
            versioning::runner::versioning_run_status,
            versioning::versioning_oracle_timeout,
            community_extensions::community_extension_store,
            community_extensions::read_community_extension,
            extension_process::extension_process_run,
            extension_process::extension_process_start,
            extension_process::extension_process_write,
            extension_process::extension_process_read,
            extension_process::extension_process_stop,
            file_open::take_pending_open_files,
            file_open::resolve_open_files,
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
            db::commands::list_views,
            db::commands::get_view_definition,
            db::commands::get_table_ddl,
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
            db::ssh::open_ssh_tunnel,
            db::ssh::open_proxy_tunnel,
            db::ssh::config::list_ssh_config_hosts,
            db::ssh::close_ssh_tunnel,
            db::ssh::list_ssh_tunnels,
            db::commands::explain_query,
            index_advisor::advise_indexes,
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
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
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
