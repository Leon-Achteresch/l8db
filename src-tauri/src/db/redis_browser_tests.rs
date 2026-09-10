use super::*;
use crate::db::{create_adapter_from_string, pool::create_pool_state, provider::DatabaseKind};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn dispatch(
    command: &str,
    args: &Value,
    uri: &str,
    pool: PoolState,
) -> Result<Value, String> {
    if command == "list_providers" {
        return Ok(json!(crate::db::provider::list_providers()));
    }
    let requested_uri = args["connectionString"].as_str().unwrap_or(uri);
    let address = url::Url::parse(requested_uri).map_err(|e| e.to_string())?;
    if address.host_str() != Some("127.0.0.1")
        || address.port() != Some(6381)
        || !matches!(address.scheme(), "redis" | "valkey")
    {
        return Err("Browser lab only accepts redis://127.0.0.1:6381".into());
    }
    let adapter = create_adapter_from_string(
        DatabaseKind::Redis,
        requested_uri,
        args["database"].as_str(),
        pool,
    )?;
    let schema = args["schema"].as_str().unwrap_or("keys");
    let table = args["table"].as_str().unwrap_or("keys");
    match command {
        "test_connection_string" => adapter.test_connection().await.map(|_| Value::Null),
        "list_databases" => adapter.list_databases().await.map(|v| json!(v)),
        "list_schemas" => adapter.list_schemas().await.map(|v| json!(v)),
        "list_tables" => adapter.list_tables(Some(schema)).await.map(|v| json!(v)),
        "list_all_columns" => adapter
            .list_columns(Some(schema), None, None)
            .await
            .map(|v| json!(v)),
        "list_table_columns_detailed" => adapter
            .list_table_columns_detailed(schema, table)
            .await
            .map(|v| json!(v)),
        "list_indexes" => adapter.list_indexes(schema, table).await.map(|v| json!(v)),
        "fetch_table_rows" => adapter
            .fetch_rows(
                schema,
                table,
                args["filter"].as_str(),
                args["limit"].as_i64().unwrap_or(100),
                args["offset"].as_i64().unwrap_or(0),
                args["orderBy"].as_str(),
                args["orderDesc"].as_bool().unwrap_or(false),
                false,
                true,
            )
            .await
            .map(|v| json!(v)),
        "count_table_rows" => adapter
            .count_rows(schema, table, args["filter"].as_str(), true)
            .await
            .map(|v| json!(v)),
        "create_table" => adapter
            .create_table(
                &serde_json::from_value(args["request"].clone()).map_err(|e| e.to_string())?,
            )
            .await
            .map(|_| Value::Null),
        "truncate_table" => adapter
            .truncate_table(schema, table)
            .await
            .map(|_| Value::Null),
        "drop_table" => adapter.drop_table(schema, table).await.map(|_| Value::Null),
        "execute_query" => adapter
            .execute_query(args["sql"].as_str().unwrap_or(""))
            .await
            .map(|v| json!(v)),
        _ => Err(format!("Unsupported browser lab command: {command}")),
    }
}

async fn serve(
    mut stream: tokio::net::TcpStream,
    uri: String,
    pool: PoolState,
) -> Result<(), String> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 8192];
    let (head, size, permitted, preflight) = loop {
        let count = stream.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if count == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&buffer[..count]);
        if bytes.len() > 65_536 {
            return Err("Request headers too large".into());
        }
        if let Some(head) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..head]);
            let size = headers
                .lines()
                .find_map(|line| {
                    line.to_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|s| s.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            if size > 2_000_000 {
                return Err("Request body too large".into());
            }
            let origin = headers.lines().find_map(|line| {
                line.split_once(':')
                    .filter(|(name, _)| name.eq_ignore_ascii_case("origin"))
                    .map(|(_, value)| value.trim())
            });
            let preflight = headers.starts_with("OPTIONS ");
            let permitted = origin == Some("http://localhost:1420")
                && (preflight || headers.starts_with("POST "));
            break (head + 4, size, permitted, preflight);
        }
    };
    if !permitted {
        stream
            .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    while bytes.len() < head + size {
        let count = stream.read(&mut buffer).await.map_err(|e| e.to_string())?;
        if count == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    let response = if preflight {
        json!(null)
    } else {
        let request: Value =
            serde_json::from_slice(&bytes[head..head + size]).map_err(|e| e.to_string())?;
        match dispatch(
            request["command"].as_str().unwrap_or(""),
            &request["args"],
            &uri,
            pool,
        )
        .await
        {
            Ok(value) => json!({"result": value}),
            Err(error) => json!({"error": error}),
        }
    }
    .to_string();
    stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: http://localhost:1420\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", response.len(), response).as_bytes()).await.map_err(|e| e.to_string())
}

#[tokio::test]
#[ignore = "isolated browser lab bridge; requires L8DB_E2E_REDIS_URL"]
async fn redis_browser_bridge() {
    if std::env::var("L8DB_REDIS_BROWSER").as_deref() != Ok("1") {
        return;
    }
    let uri = std::env::var("L8DB_E2E_REDIS_URL").expect("L8DB_E2E_REDIS_URL required");
    let pool = create_pool_state();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:6382")
        .await
        .unwrap();
    println!("Redis browser bridge ready on 127.0.0.1:6382");
    loop {
        let (stream, _) = listener.accept().await.unwrap();
        let uri = uri.clone();
        let pool = pool.clone();
        tokio::spawn(async move {
            let _ =
                tokio::time::timeout(std::time::Duration::from_secs(60), serve(stream, uri, pool))
                    .await;
        });
    }
}
