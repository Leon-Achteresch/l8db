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
