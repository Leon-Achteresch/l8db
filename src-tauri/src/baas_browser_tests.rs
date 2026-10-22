use crate::convex::*;
use crate::db::pool::create_pool_state;
use crate::db::{create_adapter_from_string, secrets, DatabaseKind};
use crate::supabase::*;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn a<T: DeserializeOwned>(x: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(x.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("{key}: {e}"))
}

fn ok<T: serde::Serialize>(value: Result<T, String>) -> Result<Value, String> {
    value.map(|v| json!(v))
}

fn channel_messages() -> &'static std::sync::Mutex<std::collections::HashMap<String, Vec<Value>>> {
    static MESSAGES: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, Vec<Value>>>,
    > = std::sync::OnceLock::new();
    MESSAGES.get_or_init(Default::default)
}

async fn dispatch(command: &str, x: &Value) -> Result<Value, String> {
    match command {
        "list_providers" => Ok(json!(crate::db::commands::list_providers())),
        "store_secret" => ok(secrets::store_secret(a(x, "account")?, a(x, "secret")?).await),
        "load_secret" => ok(secrets::load_secret(a(x, "account")?).await),
        "delete_secret" => ok(secrets::delete_secret(a(x, "account")?).await),
        "test_connection_string" => {
            let kind: DatabaseKind = a(x, "kind")?;
            let url: String = a(x, "connectionString")?;
            create_adapter_from_string(kind, &url, None, create_pool_state())?
                .test_connection()
                .await
                .map(|_| Value::Null)
        }
        "appwrite_profiles" | "pocketbase_profiles" | "firebase_profiles" => Ok(json!([])),
        "supabase_connect_self_hosted" => {
            ok(supabase_connect_self_hosted(a(x, "url")?, a(x, "apiKey")?, a(x, "name")?).await)
        }
        "supabase_disconnect_self_hosted" => {
            ok(supabase_disconnect_self_hosted(a(x, "reference")?).await)
        }
        "supabase_disconnect" => ok(supabase_disconnect().await),
        "supabase_is_connected" => ok(supabase_is_connected().await),
        "supabase_projects" => ok(supabase_projects().await),
        "supabase_database_endpoint" => ok(supabase_database_endpoint(a(x, "reference")?).await),
        "supabase_buckets" => ok(supabase_buckets(a(x, "reference")?).await),
        "supabase_bucket_details" => {
            ok(supabase_bucket_details(a(x, "reference")?, a(x, "bucket")?).await)
        }
        "supabase_create_bucket" => {
            ok(supabase_create_bucket(a(x, "reference")?, a(x, "name")?, a(x, "public")?).await)
        }
        "supabase_update_bucket_public" => {
            ok(
                supabase_update_bucket_public(a(x, "reference")?, a(x, "bucket")?, a(x, "public")?)
                    .await,
            )
        }
        "supabase_delete_bucket" => {
            ok(supabase_delete_bucket(a(x, "reference")?, a(x, "bucket")?).await)
        }
        "supabase_functions" => ok(supabase_functions(a(x, "reference")?).await),
        "supabase_health" => ok(supabase_health(a(x, "reference")?).await),
        "supabase_studio_capabilities" => {
            ok(crate::supabase_studio::supabase_studio_capabilities(a(x, "reference")?).await)
        }
        "supabase_backups" => ok(supabase_backups(a(x, "reference")?).await),
        "supabase_tables" => ok(supabase_tables(a(x, "reference")?, a(x, "offset")?).await),
        "supabase_table_columns" => {
            ok(supabase_table_columns(a(x, "reference")?, a(x, "schema")?, a(x, "table")?).await)
        }
        "supabase_table_rows" => ok(supabase_table_rows(
            a(x, "reference")?,
            a(x, "schema")?,
            a(x, "table")?,
            a(x, "offset")?,
        )
        .await),
        "supabase_has_project_key" => ok(supabase_has_project_key(a(x, "reference")?).await),
        "supabase_objects" => ok(supabase_objects(
            a(x, "reference")?,
            a(x, "bucket")?,
            a(x, "prefix")?,
            a(x, "offset")?,
        )
        .await),
        "supabase_delete_object" => {
            ok(
                supabase_delete_object(a(x, "reference")?, a(x, "bucket")?, a(x, "objectKey")?)
                    .await,
            )
        }
        "supabase_preview_object" => {
            ok(
                supabase_preview_object(a(x, "reference")?, a(x, "bucket")?, a(x, "objectKey")?)
                    .await,
            )
        }
        "supabase_auth_users" => ok(supabase_auth_users(a(x, "reference")?, a(x, "page")?).await),
        "supabase_create_auth_user" => {
            ok(
                supabase_create_auth_user(a(x, "reference")?, a(x, "email")?, a(x, "password")?)
                    .await,
            )
        }
        "supabase_delete_auth_user" => {
            ok(supabase_delete_auth_user(a(x, "reference")?, a(x, "userId")?).await)
        }
        "convex_connect_self_hosted" => {
            ok(convex_connect_self_hosted(a(x, "url")?, a(x, "adminKey")?).await)
        }
        "convex_profiles" => ok(convex_profiles().await),
        "convex_disconnect" => ok(convex_disconnect(a(x, "id")?).await),
        "convex_projects" => ok(convex_projects(a(x, "id")?, a(x, "cursor")?).await),
        "convex_environment_variables" => ok(convex_environment_variables(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
        )
        .await),
        "convex_set_environment_variable" => ok(convex_set_environment_variable(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "name")?,
            a(x, "value")?,
        )
        .await),
        "convex_delete_environment_variable" => ok(convex_delete_environment_variable(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "name")?,
        )
        .await),
        "supabase_studio_auth_users" => {
            ok(crate::supabase_studio::auth::supabase_studio_auth_users(
                a(x, "reference")?,
                a(x, "page")?,
                a(x, "search")?,
                a(x, "filter")?,
                a(x, "sort")?,
            )
            .await)
        }
        "supabase_studio_auth_user" => ok(crate::supabase_studio::auth::supabase_studio_auth_user(
            a(x, "reference")?,
            a(x, "userId")?,
        )
        .await),
        "supabase_studio_auth_create_user" => ok(
            crate::supabase_studio::auth::supabase_studio_auth_create_user(
                a(x, "reference")?,
                a(x, "attributes")?,
            )
            .await,
        ),
        "supabase_studio_auth_update_user" => ok(
            crate::supabase_studio::auth::supabase_studio_auth_update_user(
                a(x, "reference")?,
                a(x, "userId")?,
                a(x, "attributes")?,
            )
            .await,
        ),
        "supabase_studio_auth_soft_delete_user" => ok(
            crate::supabase_studio::auth::supabase_studio_auth_soft_delete_user(
                a(x, "reference")?,
                a(x, "userId")?,
            )
            .await,
        ),
        "supabase_studio_auth_invite" => {
            ok(crate::supabase_studio::auth::supabase_studio_auth_invite(
                a(x, "reference")?,
                a(x, "email")?,
                a(x, "redirectTo")?,
                a(x, "data")?,
            )
            .await)
        }
        "supabase_studio_auth_generate_link" => ok(
            crate::supabase_studio::auth::supabase_studio_auth_generate_link(
                a(x, "reference")?,
                a(x, "kind")?,
                a(x, "email")?,
                a(x, "newEmail")?,
                a(x, "password")?,
                a(x, "redirectTo")?,
                a(x, "data")?,
            )
            .await,
        ),
        "supabase_studio_auth_sign_out_user" => ok(
            crate::supabase_studio::auth::supabase_studio_auth_sign_out_user(
                a(x, "reference")?,
                a(x, "userId")?,
            )
            .await,
        ),
        "supabase_studio_auth_delete_factor" => ok(
            crate::supabase_studio::auth::supabase_studio_auth_delete_factor(
                a(x, "reference")?,
                a(x, "userId")?,
                a(x, "factorId")?,
            )
            .await,
        ),
        "supabase_studio_auth_settings" => ok(
            crate::supabase_studio::auth::supabase_studio_auth_settings(a(x, "reference")?).await,
        ),
        "supabase_studio_auth_config" => {
            ok(crate::supabase_studio::auth::supabase_studio_auth_config(a(x, "reference")?).await)
        }
        "supabase_studio_auth_update_config" => ok(
            crate::supabase_studio::auth::supabase_studio_auth_update_config(
                a(x, "reference")?,
                a(x, "patch")?,
            )
            .await,
        ),
        "supabase_studio_database_list" => ok(
            crate::supabase_studio::database::supabase_studio_database_list(
                a(x, "reference")?,
                a(x, "kind")?,
                a(x, "schema")?,
                a(x, "parent")?,
                a(x, "search")?,
                a(x, "offset")?,
            )
            .await,
        ),
        "supabase_studio_database_definition" => ok(
            crate::supabase_studio::database::supabase_studio_database_definition(
                a(x, "reference")?,
                a(x, "kind")?,
                a(x, "oid")?,
            )
            .await,
        ),
        "supabase_studio_database_action" => ok(
            crate::supabase_studio::database::supabase_studio_database_action(
                a(x, "reference")?,
                a(x, "action")?,
            )
            .await,
        ),
        "supabase_studio_edge_function" => {
            ok(crate::supabase_studio::edge::supabase_studio_edge_function(
                a(x, "reference")?,
                a(x, "slug")?,
            )
            .await)
        }
        "supabase_studio_edge_function_source" => ok(
            crate::supabase_studio::edge::supabase_studio_edge_function_source(
                a(x, "reference")?,
                a(x, "slug")?,
            )
            .await,
        ),
        "supabase_studio_edge_function_update" => ok(
            crate::supabase_studio::edge::supabase_studio_edge_function_update(
                a(x, "reference")?,
                a(x, "slug")?,
                a(x, "name")?,
                a(x, "verifyJwt")?,
            )
            .await,
        ),
        "supabase_studio_edge_secrets" => ok(
            crate::supabase_studio::edge::supabase_studio_edge_secrets(a(x, "reference")?).await,
        ),
        "supabase_studio_edge_secret_set" => ok(
            crate::supabase_studio::edge::supabase_studio_edge_secret_set(
                a(x, "reference")?,
                a(x, "name")?,
                a(x, "value")?,
            )
            .await,
        ),
        "supabase_studio_edge_secret_delete" => ok(
            crate::supabase_studio::edge::supabase_studio_edge_secret_delete(
                a(x, "reference")?,
                a(x, "name")?,
            )
            .await,
        ),
        "supabase_studio_edge_invoke" => {
            ok(crate::supabase_studio::edge::supabase_studio_edge_invoke(
                a(x, "reference")?,
                a(x, "slug")?,
                a(x, "method")?,
                a(x, "path")?,
                a(x, "query")?,
                a(x, "headers")?,
                a(x, "body")?,
                a(x, "auth")?,
                a(x, "bearer")?,
            )
            .await)
        }
        "supabase_studio_edge_realtime_open" => {
            let id: String = a(x, "events")?;
            let id = id.trim_start_matches("__CHANNEL__:").to_string();
            let key = id.clone();
            let events = tauri::ipc::Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                    let value = serde_json::from_str(&text).unwrap_or(Value::Null);
                    channel_messages()
                        .lock()
                        .unwrap()
                        .entry(key.clone())
                        .or_default()
                        .push(value);
                }
                Ok(())
            });
            ok(
                crate::supabase_studio::edge::supabase_studio_edge_realtime_open(
                    a(x, "reference")?,
                    a(x, "session")?,
                    a(x, "channel")?,
                    a(x, "changes")?,
                    a(x, "presenceKey")?,
                    a(x, "private")?,
                    events,
                )
                .await,
            )
        }
        "__channel_poll" => {
            let id: String = a(x, "id")?;
            Ok(json!(channel_messages()
                .lock()
                .unwrap()
                .remove(&id)
                .unwrap_or_default()))
        }
        "supabase_studio_storage_upload" => {
            let folder = tempfile::tempdir().map_err(|e| e.to_string())?;
            let path = folder.path().join("l8db-upload.txt");
            std::fs::write(&path, "l8db browser upload").map_err(|e| e.to_string())?;
            let reference: String = a(x, "reference")?;
            let bucket: String = a(x, "bucket")?;
            let prefix: String = a(x, "prefix")?;
            ok(crate::supabase_studio::storage::upload_paths(
                &reference,
                &bucket,
                &prefix,
                vec![path],
                a(x, "upsert")?,
            )
            .await)
        }
        "supabase_studio_edge_realtime_push" => ok(
            crate::supabase_studio::edge::supabase_studio_edge_realtime_push(
                a(x, "session")?,
                a(x, "kind")?,
                a(x, "event")?,
                a(x, "payload")?,
            )
            .await,
        ),
        "supabase_studio_edge_realtime_close" => ok(
            crate::supabase_studio::edge::supabase_studio_edge_realtime_close(a(x, "session")?)
                .await,
        ),
        "supabase_studio_edge_realtime_broadcast" => ok(
            crate::supabase_studio::edge::supabase_studio_edge_realtime_broadcast(
                a(x, "reference")?,
                a(x, "channel")?,
                a(x, "event")?,
                a(x, "payload")?,
                a(x, "private")?,
            )
            .await,
        ),
        "supabase_studio_edge_publication_tables" => ok(
            crate::supabase_studio::edge::supabase_studio_edge_publication_tables(
                a(x, "reference")?,
                a(x, "search")?,
                a(x, "offset")?,
            )
            .await,
        ),
        "supabase_studio_edge_publication_toggle" => ok(
            crate::supabase_studio::edge::supabase_studio_edge_publication_toggle(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "enabled")?,
            )
            .await,
        ),
        "supabase_studio_edge_publication_actions" => ok(
            crate::supabase_studio::edge::supabase_studio_edge_publication_actions(
                a(x, "reference")?,
                a(x, "insert")?,
                a(x, "update")?,
                a(x, "delete")?,
                a(x, "truncate")?,
            )
            .await,
        ),
        "supabase_studio_observability_sessions" => ok(
            crate::supabase_studio::observability::supabase_studio_observability_sessions(
                a(x, "reference")?,
                a(x, "includeIdle")?,
            )
            .await,
        ),
        "supabase_studio_observability_signal" => ok(
            crate::supabase_studio::observability::supabase_studio_observability_signal(
                a(x, "reference")?,
                a(x, "pid")?,
                a(x, "terminate")?,
            )
            .await,
        ),
        "supabase_studio_observability_locks" => ok(
            crate::supabase_studio::observability::supabase_studio_observability_locks(a(
                x,
                "reference",
            )?)
            .await,
        ),
        "supabase_studio_observability_statements" => ok(
            crate::supabase_studio::observability::supabase_studio_observability_statements(
                a(x, "reference")?,
                a(x, "order")?,
            )
            .await,
        ),
        "supabase_studio_observability_statements_enable" => ok(
            crate::supabase_studio::observability::supabase_studio_observability_statements_enable(
                a(x, "reference")?,
            )
            .await,
        ),
        "supabase_studio_observability_statements_reset" => ok(
            crate::supabase_studio::observability::supabase_studio_observability_statements_reset(
                a(x, "reference")?,
            )
            .await,
        ),
        "supabase_studio_observability_health" => ok(
            crate::supabase_studio::observability::supabase_studio_observability_health(
                a(x, "reference")?,
                a(x, "longRunningSeconds")?,
            )
            .await,
        ),
        "supabase_studio_observability_sizes" => ok(
            crate::supabase_studio::observability::supabase_studio_observability_sizes(a(
                x,
                "reference",
            )?)
            .await,
        ),
        "supabase_studio_observability_logs" => ok(
            crate::supabase_studio::observability::supabase_studio_observability_logs(
                a(x, "reference")?,
                a(x, "source")?,
                a(x, "minutes")?,
                a(x, "search")?,
                a(x, "level")?,
                a(x, "limit")?,
            )
            .await,
        ),
        "supabase_studio_observability_advisors" => ok(
            crate::supabase_studio::observability::supabase_studio_observability_advisors(
                a(x, "reference")?,
                a(x, "kind")?,
            )
            .await,
        ),
        "supabase_studio_observability_usage" => ok(
            crate::supabase_studio::observability::supabase_studio_observability_usage(
                a(x, "reference")?,
                a(x, "interval")?,
            )
            .await,
        ),
        "supabase_studio_settings_overview_stats" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_overview_stats(a(
                x,
                "reference",
            )?)
            .await,
        ),
        "supabase_studio_settings_reveal_key" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_reveal_key(a(
                x,
                "reference",
            )?)
            .await,
        ),
        "supabase_studio_settings_api_keys" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_api_keys(a(x, "reference")?)
                .await,
        ),
        "supabase_studio_settings_replace_self_hosted_key" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_replace_self_hosted_key(
                a(x, "reference")?,
                a(x, "apiKey")?,
            )
            .await,
        ),
        "supabase_studio_settings_postgrest" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_postgrest(a(
                x,
                "reference",
            )?)
            .await,
        ),
        "supabase_studio_settings_update_postgrest" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_update_postgrest(
                a(x, "reference")?,
                a(x, "update")?,
            )
            .await,
        ),
        "supabase_studio_settings_postgres_config" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_postgres_config(a(
                x,
                "reference",
            )?)
            .await,
        ),
        "supabase_studio_settings_update_postgres_config" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_update_postgres_config(
                a(x, "reference")?,
                a(x, "settings")?,
                a(x, "restartDatabase")?,
            )
            .await,
        ),
        "supabase_studio_settings_pooler" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_pooler(a(x, "reference")?)
                .await,
        ),
        "supabase_studio_settings_ssl_enforcement" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_ssl_enforcement(a(
                x,
                "reference",
            )?)
            .await,
        ),
        "supabase_studio_settings_update_ssl_enforcement" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_update_ssl_enforcement(
                a(x, "reference")?,
                a(x, "enabled")?,
            )
            .await,
        ),
        "supabase_studio_settings_network_restrictions" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_network_restrictions(a(
                x,
                "reference",
            )?)
            .await,
        ),
        "supabase_studio_settings_set_paused" => ok(
            crate::supabase_studio::settings::supabase_studio_settings_set_paused(
                a(x, "reference")?,
                a(x, "paused")?,
                a(x, "confirmName")?,
            )
            .await,
        ),
        "supabase_studio_sql_run" => ok(crate::supabase_studio::sql::supabase_studio_sql_run(
            a(x, "reference")?,
            a(x, "query")?,
            a(x, "readOnly")?,
        )
        .await),
        "supabase_studio_storage_buckets" => ok(
            crate::supabase_studio::storage::supabase_studio_storage_buckets(
                a(x, "reference")?,
                a(x, "search")?,
                a(x, "offset")?,
            )
            .await,
        ),
        "supabase_studio_storage_bucket_create" => ok(
            crate::supabase_studio::storage::supabase_studio_storage_bucket_create(
                a(x, "reference")?,
                a(x, "bucket")?,
                a(x, "public")?,
                a(x, "fileSizeLimit")?,
                a(x, "allowedMimeTypes")?,
            )
            .await,
        ),
        "supabase_studio_storage_bucket_update" => ok(
            crate::supabase_studio::storage::supabase_studio_storage_bucket_update(
                a(x, "reference")?,
                a(x, "bucket")?,
                a(x, "public")?,
                a(x, "fileSizeLimit")?,
                a(x, "allowedMimeTypes")?,
            )
            .await,
        ),
        "supabase_studio_storage_bucket_empty" => ok(
            crate::supabase_studio::storage::supabase_studio_storage_bucket_empty(
                a(x, "reference")?,
                a(x, "bucket")?,
            )
            .await,
        ),
        "supabase_studio_storage_objects" => ok(
            crate::supabase_studio::storage::supabase_studio_storage_objects(
                a(x, "reference")?,
                a(x, "bucket")?,
                a(x, "prefix")?,
                a(x, "search")?,
                a(x, "offset")?,
            )
            .await,
        ),
        "supabase_studio_storage_create_folder" => ok(
            crate::supabase_studio::storage::supabase_studio_storage_create_folder(
                a(x, "reference")?,
                a(x, "bucket")?,
                a(x, "prefix")?,
                a(x, "name")?,
            )
            .await,
        ),
        "supabase_studio_storage_transfer" => ok(
            crate::supabase_studio::storage::supabase_studio_storage_transfer(
                a(x, "reference")?,
                a(x, "bucket")?,
                a(x, "source")?,
                a(x, "destinationBucket")?,
                a(x, "destination")?,
                a(x, "copy")?,
            )
            .await,
        ),
        "supabase_studio_storage_delete" => ok(
            crate::supabase_studio::storage::supabase_studio_storage_delete(
                a(x, "reference")?,
                a(x, "bucket")?,
                a(x, "paths")?,
            )
            .await,
        ),
        "supabase_studio_storage_signed_url" => ok(
            crate::supabase_studio::storage::supabase_studio_storage_signed_url(
                a(x, "reference")?,
                a(x, "bucket")?,
                a(x, "objectKey")?,
                a(x, "expiresIn")?,
                a(x, "download")?,
            )
            .await,
        ),
        "supabase_studio_storage_public_url" => ok(
            crate::supabase_studio::storage::supabase_studio_storage_public_url(
                a(x, "reference")?,
                a(x, "bucket")?,
                a(x, "objectKey")?,
            )
            .await,
        ),
        "supabase_studio_storage_object_info" => ok(
            crate::supabase_studio::storage::supabase_studio_storage_object_info(
                a(x, "reference")?,
                a(x, "bucket")?,
                a(x, "objectKey")?,
            )
            .await,
        ),
        "supabase_studio_tables_schemas" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_schemas(a(x, "reference")?)
                .await,
        ),
        "supabase_studio_tables_list" => {
            ok(crate::supabase_studio::tables::supabase_studio_tables_list(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "search")?,
                a(x, "offset")?,
            )
            .await)
        }
        "supabase_studio_tables_describe" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_describe(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
            )
            .await,
        ),
        "supabase_studio_tables_rows" => {
            ok(crate::supabase_studio::tables::supabase_studio_tables_rows(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "query")?,
            )
            .await)
        }
        "supabase_studio_tables_insert_row" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_insert_row(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "values")?,
            )
            .await,
        ),
        "supabase_studio_tables_update_row" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_update_row(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "key")?,
                a(x, "values")?,
            )
            .await,
        ),
        "supabase_studio_tables_delete_rows" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_delete_rows(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "keys")?,
            )
            .await,
        ),
        "supabase_studio_tables_create_table" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_create_table(
                a(x, "reference")?,
                a(x, "definition")?,
            )
            .await,
        ),
        "supabase_studio_tables_rename_table" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_rename_table(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "newName")?,
            )
            .await,
        ),
        "supabase_studio_tables_drop_table" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_drop_table(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "kind")?,
                a(x, "cascade")?,
            )
            .await,
        ),
        "supabase_studio_tables_truncate" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_truncate(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "restartIdentity")?,
                a(x, "cascade")?,
            )
            .await,
        ),
        "supabase_studio_tables_set_rls" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_set_rls(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "enabled")?,
            )
            .await,
        ),
        "supabase_studio_tables_add_column" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_add_column(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "column")?,
            )
            .await,
        ),
        "supabase_studio_tables_alter_column" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_alter_column(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "column")?,
                a(x, "change")?,
            )
            .await,
        ),
        "supabase_studio_tables_drop_column" => ok(
            crate::supabase_studio::tables::supabase_studio_tables_drop_column(
                a(x, "reference")?,
                a(x, "schema")?,
                a(x, "table")?,
                a(x, "column")?,
                a(x, "cascade")?,
            )
            .await,
        ),
        "convex_studio_data_tables" => ok(crate::convex_studio::data::convex_studio_data_tables(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
        )
        .await),
        "convex_studio_data_documents" => {
            ok(crate::convex_studio::data::convex_studio_data_documents(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "table")?,
                a(x, "filter")?,
                a(x, "cursor")?,
                a(x, "pageSize")?,
            )
            .await)
        }
        "convex_studio_data_resolve" => ok(crate::convex_studio::data::convex_studio_data_resolve(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "documentId")?,
        )
        .await),
        "convex_studio_data_insert" => ok(crate::convex_studio::data::convex_studio_data_insert(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "table")?,
            a(x, "documents")?,
        )
        .await),
        "convex_studio_data_replace" => ok(crate::convex_studio::data::convex_studio_data_replace(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "documentId")?,
            a(x, "document")?,
        )
        .await),
        "convex_studio_data_patch" => ok(crate::convex_studio::data::convex_studio_data_patch(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "table")?,
            a(x, "ids")?,
            a(x, "fields")?,
        )
        .await),
        "convex_studio_data_delete" => ok(crate::convex_studio::data::convex_studio_data_delete(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "table")?,
            a(x, "ids")?,
        )
        .await),
        "convex_studio_data_clear" => ok(crate::convex_studio::data::convex_studio_data_clear(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "table")?,
        )
        .await),
        "convex_studio_data_create_table" => {
            ok(crate::convex_studio::data::convex_studio_data_create_table(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "table")?,
            )
            .await)
        }
        "convex_studio_data_delete_table" => {
            ok(crate::convex_studio::data::convex_studio_data_delete_table(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "table")?,
            )
            .await)
        }
        "convex_studio_data_schema" => ok(crate::convex_studio::data::convex_studio_data_schema(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
        )
        .await),
        "convex_studio_data_infer_schema" => {
            ok(crate::convex_studio::data::convex_studio_data_infer_schema(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "table")?,
            )
            .await)
        }
        "convex_studio_data_import" => ok(crate::convex_studio::data::convex_studio_data_import(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "table")?,
            a(x, "format")?,
            a(x, "mode")?,
            a(x, "content")?,
        )
        .await),
        "convex_studio_files_list" => ok(crate::convex_studio::files::convex_studio_files_list(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "cursor")?,
            a(x, "order")?,
            a(x, "minCreationTime")?,
            a(x, "maxCreationTime")?,
        )
        .await),
        "convex_studio_files_count" => ok(crate::convex_studio::files::convex_studio_files_count(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
        )
        .await),
        "convex_studio_files_get" => ok(crate::convex_studio::files::convex_studio_files_get(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "storageId")?,
        )
        .await),
        "convex_studio_files_preview" => {
            ok(crate::convex_studio::files::convex_studio_files_preview(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "storageId")?,
            )
            .await)
        }
        "convex_studio_files_delete" => {
            ok(crate::convex_studio::files::convex_studio_files_delete(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "storageIds")?,
            )
            .await)
        }
        "convex_studio_functions_list" => ok(
            crate::convex_studio::functions::convex_studio_functions_list(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
            )
            .await,
        ),
        "convex_studio_functions_detail" => ok(
            crate::convex_studio::functions::convex_studio_functions_detail(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "identifier")?,
                a(x, "componentId")?,
            )
            .await,
        ),
        "convex_studio_functions_run" => ok(
            crate::convex_studio::functions::convex_studio_functions_run(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "identifier")?,
                a(x, "args")?,
                a(x, "componentPath")?,
            )
            .await,
        ),
        "convex_studio_functions_http_request" => ok(
            crate::convex_studio::functions::convex_studio_functions_http_request(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "method")?,
                a(x, "path")?,
                a(x, "headers")?,
                a(x, "body")?,
            )
            .await,
        ),
        "convex_studio_functions_stats" => ok(
            crate::convex_studio::functions::convex_studio_functions_stats(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "identifier")?,
                a(x, "windowMinutes")?,
            )
            .await,
        ),
        "convex_studio_logs_fetch" => ok(crate::convex_studio::logs::convex_studio_logs_fetch(
            a(x, "id")?,
            a(x, "projectId")?,
            a(x, "deploymentName")?,
            a(x, "streamId")?,
            a(x, "cursor")?,
            a(x, "waitMs")?,
        )
        .await),
        "convex_studio_logs_cancel" => {
            ok(crate::convex_studio::logs::convex_studio_logs_cancel(a(x, "streamId")?).await)
        }
        "convex_studio_schedules_jobs" => ok(
            crate::convex_studio::schedules::convex_studio_schedules_jobs(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "udfPath")?,
                a(x, "cursor")?,
                a(x, "limit")?,
            )
            .await,
        ),
        "convex_studio_schedules_job_args" => ok(
            crate::convex_studio::schedules::convex_studio_schedules_job_args(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "argsId")?,
            )
            .await,
        ),
        "convex_studio_schedules_cancel_job" => ok(
            crate::convex_studio::schedules::convex_studio_schedules_cancel_job(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "jobId")?,
            )
            .await,
        ),
        "convex_studio_schedules_cancel_all" => ok(
            crate::convex_studio::schedules::convex_studio_schedules_cancel_all(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "udfPath")?,
                a(x, "fromMs")?,
                a(x, "untilMs")?,
            )
            .await,
        ),
        "convex_studio_schedules_functions" => ok(
            crate::convex_studio::schedules::convex_studio_schedules_functions(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
            )
            .await,
        ),
        "convex_studio_schedules_crons" => ok(
            crate::convex_studio::schedules::convex_studio_schedules_crons(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
            )
            .await,
        ),
        "convex_studio_schedules_cron_runs" => ok(
            crate::convex_studio::schedules::convex_studio_schedules_cron_runs(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "name")?,
                a(x, "limit")?,
            )
            .await,
        ),
        "convex_studio_schedules_run_cron" => ok(
            crate::convex_studio::schedules::convex_studio_schedules_run_cron(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "name")?,
            )
            .await,
        ),
        "convex_studio_settings_info" => {
            ok(crate::convex_studio::settings::convex_studio_settings_info(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
            )
            .await)
        }
        "convex_studio_settings_stats" => ok(
            crate::convex_studio::settings::convex_studio_settings_stats(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
            )
            .await,
        ),
        "convex_studio_settings_recent_errors" => ok(
            crate::convex_studio::settings::convex_studio_settings_recent_errors(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
            )
            .await,
        ),
        "convex_studio_settings_env_reveal" => ok(
            crate::convex_studio::settings::convex_studio_settings_env_reveal(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "name")?,
            )
            .await,
        ),
        "convex_studio_settings_env_import" => ok(
            crate::convex_studio::settings::convex_studio_settings_env_import(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "text")?,
                a(x, "overwrite")?,
            )
            .await,
        ),
        "convex_studio_settings_set_paused" => ok(
            crate::convex_studio::settings::convex_studio_settings_set_paused(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "paused")?,
            )
            .await,
        ),
        "convex_studio_settings_export_request" => ok(
            crate::convex_studio::settings::convex_studio_settings_export_request(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "includeStorage")?,
            )
            .await,
        ),
        "convex_studio_settings_export_status" => ok(
            crate::convex_studio::settings::convex_studio_settings_export_status(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
            )
            .await,
        ),
        "convex_studio_settings_import_status" => ok(
            crate::convex_studio::settings::convex_studio_settings_import_status(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "importId")?,
            )
            .await,
        ),
        "convex_studio_settings_import_confirm" => ok(
            crate::convex_studio::settings::convex_studio_settings_import_confirm(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "importId")?,
            )
            .await,
        ),
        "convex_studio_settings_import_cancel" => ok(
            crate::convex_studio::settings::convex_studio_settings_import_cancel(
                a(x, "id")?,
                a(x, "projectId")?,
                a(x, "deploymentName")?,
                a(x, "importId")?,
            )
            .await,
        ),
        "convex_studio_files_upload" => {
            let folder = tempfile::tempdir().map_err(|e| e.to_string())?;
            let path = folder.path().join("l8db-upload.txt");
            std::fs::write(&path, "l8db browser upload").map_err(|e| e.to_string())?;
            let access = crate::convex_studio::deployment(
                &a::<String>(x, "id")?,
                a(x, "projectId")?,
                &a::<String>(x, "deploymentName")?,
            )
            .await?;
            ok(crate::convex_studio::files::upload_paths(&access, vec![path]).await)
        }
        "convex_studio_files_download" => {
            let access = crate::convex_studio::deployment(
                &a::<String>(x, "id")?,
                a(x, "projectId")?,
                &a::<String>(x, "deploymentName")?,
            )
            .await?;
            let storage_id: String = a(x, "storageId")?;
            let (_, response) =
                crate::convex_studio::files::file_response(&access, &storage_id).await?;
            let folder = tempfile::tempdir().map_err(|e| e.to_string())?;
            crate::baas_file::save_response(response, folder.path().join("download")).await?;
            Ok(json!(true))
        }
        "convex_studio_settings_env_export" => {
            let access = crate::convex_studio::deployment(
                &a::<String>(x, "id")?,
                a(x, "projectId")?,
                &a::<String>(x, "deploymentName")?,
            )
            .await?;
            let variables = crate::convex_studio::settings::environment(&access).await?;
            Ok(json!(crate::convex_studio::settings::format_dotenv(
                &variables
            )))
        }
        "convex_studio_settings_export_download" => {
            let access = crate::convex_studio::deployment(
                &a::<String>(x, "id")?,
                a(x, "projectId")?,
                &a::<String>(x, "deploymentName")?,
            )
            .await?;
            let folder = tempfile::tempdir().map_err(|e| e.to_string())?;
            let path = folder.path().join("snapshot.zip");
            crate::convex_studio::settings::download_export(&access, path.clone()).await?;
            Ok(json!(path.to_string_lossy()))
        }
        "convex_studio_settings_import_start" => {
            let access = crate::convex_studio::deployment(
                &a::<String>(x, "id")?,
                a(x, "projectId")?,
                &a::<String>(x, "deploymentName")?,
            )
            .await?;
            let folder = tempfile::tempdir().map_err(|e| e.to_string())?;
            let path = folder.path().join("import.jsonl");
            std::fs::write(&path, "{\"name\":\"l8db\"}\n").map_err(|e| e.to_string())?;
            let mode: String = a(x, "mode")?;
            let table: Option<String> = a(x, "tableName")?;
            ok(crate::convex_studio::settings::start_import(
                &access,
                &path,
                &mode,
                table.as_deref(),
            )
            .await
            .map(Some))
        }
        _ => Err(format!("Unsupported browser lab command: {command}")),
    }
}

async fn serve(mut stream: tokio::net::TcpStream) -> Result<(), String> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 8192];
    let (head, size) = loop {
        let count = stream.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if count == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(head) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            let size = String::from_utf8_lossy(&bytes[..head])
                .lines()
                .find_map(|line| {
                    line.to_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|s| s.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            break (head + 4, size);
        }
    };
    while bytes.len() < head + size {
        let count = stream.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if count == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    let response = if size == 0 {
        json!(null)
    } else {
        let request: Value =
            serde_json::from_slice(&bytes[head..head + size]).map_err(|e| e.to_string())?;
        match dispatch(request["command"].as_str().unwrap_or(""), &request["args"]).await {
            Ok(value) => json!({"result": value}),
            Err(error) => json!({"error": error}),
        }
    }
    .to_string();
    stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", response.len(), response).as_bytes()).await.map_err(|e| e.to_string())
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "isolated browser lab bridge; requires the BaaS labs and L8DB_BAAS_BROWSER=1"]
async fn baas_browser_bridge() {
    if std::env::var("L8DB_BAAS_BROWSER").as_deref() != Ok("1") {
        return;
    }
    let secrets = tempfile::tempdir().unwrap();
    std::env::set_var("L8DB_DEV_SECRETS", secrets.path().join("secrets.json"));
    let port = std::env::var("L8DB_BAAS_BRIDGE_PORT").unwrap_or_else(|_| "27032".into());
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .unwrap();
    println!("BaaS browser bridge ready on 127.0.0.1:{port}");
    loop {
        let (stream, _) = listener.accept().await.unwrap();
        tokio::spawn(async move {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(120), serve(stream)).await;
        });
    }
}
