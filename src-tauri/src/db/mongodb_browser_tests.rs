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
    let adapter =
        create_adapter_from_string(DatabaseKind::Mongodb, uri, args["database"].as_str(), pool)?;
    let schema = args["schema"]
        .as_str()
        .unwrap_or("l8db_browser_integration_long_database_name");
    let table = args["table"].as_str().unwrap_or("items");
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

#[tokio::test]
#[ignore = "isolated browser lab bridge; requires L8DB_E2E_MONGODB_URL"]
async fn mongodb_browser_bridge() {
    if std::env::var("L8DB_MONGODB_BROWSER").as_deref() != Ok("1") {
        return;
    }
    let uri = std::env::var("L8DB_E2E_MONGODB_URL").expect("L8DB_E2E_MONGODB_URL required");
    let pool = create_pool_state();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:27019")
        .await
        .unwrap();
    println!("MongoDB browser bridge ready on 127.0.0.1:27019");
    loop {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0; 8192];
        let (head, size) = loop {
            let count = stream.read(&mut buffer).await.unwrap();
            if count == 0 {
                return;
            }
            bytes.extend_from_slice(&buffer[..count]);
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
                break (head + 4, size);
            }
        };
        while bytes.len() < head + size {
            let count = stream.read(&mut buffer).await.unwrap();
            if count == 0 {
                return;
            }
            bytes.extend_from_slice(&buffer[..count]);
        }
        let response = if size == 0 {
            json!(null)
        } else {
            let request: Value = serde_json::from_slice(&bytes[head..head + size]).unwrap();
            match dispatch(
                request["command"].as_str().unwrap(),
                &request["args"],
                &uri,
                pool.clone(),
            )
            .await
            {
                Ok(value) => json!({"result": value}),
                Err(error) => json!({"error": error}),
            }
        }
        .to_string();
        stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: http://localhost:1420\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", response.len(), response).as_bytes()).await.unwrap();
    }
}
