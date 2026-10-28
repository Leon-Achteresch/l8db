use super::{pool::create_pool_state, transaction::create_transaction_state};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn a<T: DeserializeOwned>(x: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(x.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("{key}: {e}"))
}

const _: () = assert!(
    std::mem::size_of::<tauri::State<'static, super::PoolState>>()
        == std::mem::size_of::<&super::PoolState>()
);

fn st<T: Send + Sync + 'static>(value: &T) -> tauri::State<'_, T> {
    unsafe { std::mem::transmute_copy::<&T, tauri::State<'_, T>>(&value) }
}

async fn dispatch(
    command: &str,
    x: &Value,
    pool: &super::PoolState,
    tx: &super::transaction::TransactionState,
) -> Result<Value, String> {
    match command {
        "list_providers" => Ok(json!(crate::db::commands::list_providers())),
        "list_schemas" => crate::db::commands::list_schemas(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            st(&pool),
            a(x, "options")?,
        )
        .await
        .map(|v| json!(v)),
        "list_tables" => crate::db::commands::list_tables(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            st(&pool),
            a(x, "options")?,
        )
        .await
        .map(|v| json!(v)),
        "list_all_columns" => crate::db::commands::list_all_columns(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            a(x, "tableType")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "execute_query" => crate::db::commands::execute_query(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "sql")?,
            st(&pool),
            a(x, "options")?,
            a(x, "session")?,
            a(x, "pooled")?,
        )
        .await
        .map(|v| json!(v)),
        "cancel_execution" => {
            crate::db::commands::cancel_execution(a(x, "jobId")?).map(|v| json!(v))
        }
        "configure_execution_defaults" => {
            crate::db::commands::configure_execution_defaults(
                a(x, "queryTimeout")?,
                a(x, "connectionTimeout")?,
                a(x, "plsqlWarnings")?,
            );
            Ok(Value::Null)
        }
        "list_views" => crate::db::commands::list_views(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            st(&pool),
            a(x, "options")?,
        )
        .await
        .map(|v| json!(v)),
        "begin_transaction" => crate::db::commands::begin_transaction(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            st(&pool),
            st(&tx),
            a(x, "options")?,
        )
        .await
        .map(|v| json!(v)),
        "execute_in_transaction" => crate::db::commands::execute_in_transaction(
            a(x, "txId")?,
            a(x, "sql")?,
            st(&tx),
            a(x, "options")?,
        )
        .await
        .map(|v| json!(v)),
        "transaction_database_changes" => {
            crate::db::commands::transaction_database_changes(a(x, "txId")?, st(&tx))
                .await
                .map(|v| json!(v))
        }
        "transaction_server_output" => {
            crate::db::commands::transaction_server_output(a(x, "txId")?, st(&tx))
                .await
                .map(|v| json!(v))
        }
        "commit_transaction" => crate::db::commands::commit_transaction(a(x, "txId")?, st(&tx))
            .await
            .map(|v| json!(v)),
        "rollback_transaction" => crate::db::commands::rollback_transaction(a(x, "txId")?, st(&tx))
            .await
            .map(|v| json!(v)),
        "list_transactions" => crate::db::commands::list_transactions(st(&tx))
            .await
            .map(|v| json!(v)),
        "list_functions" => crate::db::commands::list_functions(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            st(&pool),
            a(x, "options")?,
        )
        .await
        .map(|v| json!(v)),
        "get_function_definition" => crate::db::commands::get_function_definition(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "oid")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "list_procedures" => crate::db::commands::list_procedures(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            st(&pool),
            a(x, "options")?,
        )
        .await
        .map(|v| json!(v)),
        "compile_object" => crate::db::commands::compile_object(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "oid")?,
            a(x, "objectType")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "list_invalid_objects" => crate::db::commands::list_invalid_objects(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            a(x, "includeDebug")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "list_compile_errors" => crate::db::commands::list_compile_errors(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "compile_invalid_objects" => crate::db::commands::compile_invalid_objects(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "server_info" => crate::db::commands::server_info(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "sql_log_configure" => {
            crate::db::sql_log::sql_log_configure(a(x, "enabled")?);
            Ok(Value::Null)
        }
        "sql_log_entries" => Ok(json!(crate::db::sql_log::sql_log_entries(a(x, "after")?))),
        "debug_availability" => crate::db::debugger::debug_availability(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
        )
        .await
        .map(|v| json!(v)),
        "debug_launch" => crate::db::debugger::debug_launch(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "request")?,
        )
        .await
        .map(|v| json!(v)),
        "debug_snapshot" => crate::db::debugger::debug_snapshot(
            a(x, "id")?,
            a(x, "connectionString")?,
            a(x, "database")?,
        )
        .await
        .map(|v| json!(v)),
        "debug_action" => crate::db::debugger::debug_action(
            a(x, "id")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "action")?,
        )
        .await
        .map(|v| json!(v)),
        "debug_stop" => crate::db::debugger::debug_stop(
            a(x, "id")?,
            a(x, "connectionString")?,
            a(x, "database")?,
        )
        .await
        .map(|v| json!(v)),
        "list_foreign_keys" => crate::db::commands::list_foreign_keys(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            a(x, "table")?,
            st(&pool),
            a(x, "options")?,
        )
        .await
        .map(|v| json!(v)),
        "list_table_columns_detailed" => crate::db::commands::list_table_columns_detailed(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            a(x, "table")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "list_sequences" => crate::db::commands::list_sequences(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "execute_script" => crate::db::commands::execute_script(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "sql")?,
            st(&pool),
            a(x, "options")?,
        )
        .await
        .map(|v| json!(v)),
        "sql_search_path" => Ok(json!(crate::db::sql_script::sql_search_path())),
        "set_server_output" => crate::db::commands::set_server_output(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "enabled")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "take_server_output" => crate::db::commands::take_server_output(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "schema_catalog" => crate::db::schema_catalog::schema_catalog(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "schema")?,
            a(x, "types")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "explain_query" => crate::db::commands::explain_query(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "sql")?,
            a(x, "analyze")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "list_sessions" => crate::db::commands::list_sessions(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "terminate_session" => crate::db::commands::terminate_session(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            a(x, "pid")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "list_locks" => crate::db::commands::list_locks(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        "get_database_overview" => crate::db::commands::get_database_overview(
            a(x, "kind")?,
            a(x, "connectionString")?,
            a(x, "database")?,
            st(&pool),
        )
        .await
        .map(|v| json!(v)),
        _ => Err(format!("Unsupported browser lab command: {command}")),
    }
}

async fn serve(
    mut stream: tokio::net::TcpStream,
    pool: super::PoolState,
    tx: super::transaction::TransactionState,
) -> Result<(), String> {
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
        match dispatch(
            request["command"].as_str().unwrap_or(""),
            &request["args"],
            &pool,
            &tx,
        )
        .await
        {
            Ok(value) => json!({"result": value}),
            Err(error) => json!({"error": error}),
        }
    }
    .to_string();
    stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", response.len(), response).as_bytes()).await.map_err(|e| e.to_string())
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "isolated browser lab bridge; requires the Oracle lab and L8DB_ORACLE_BROWSER=1"]
async fn oracle_browser_bridge() {
    if std::env::var("L8DB_ORACLE_BROWSER").as_deref() != Ok("1") {
        return;
    }
    let port = std::env::var("L8DB_ORACLE_BRIDGE_PORT").unwrap_or_else(|_| "27031".into());
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .unwrap();
    println!("Oracle browser bridge ready on 127.0.0.1:{port}");
    let pool = create_pool_state();
    let tx = create_transaction_state();
    loop {
        let (stream, _) = listener.accept().await.unwrap();
        let pool = pool.clone();
        let tx = tx.clone();
        tokio::spawn(async move {
            let _ =
                tokio::time::timeout(std::time::Duration::from_secs(120), serve(stream, pool, tx))
                    .await;
        });
    }
}
