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
    let adapter = create_adapter_from_string(
        DatabaseKind::Clickhouse,
        uri,
        args["database"].as_str(),
        pool,
    )?;
    let schema = args["schema"].as_str().unwrap_or("shop");
    let table = args["table"].as_str().unwrap_or("customers");
    match command {
        "test_connection_string" => adapter.test_connection().await.map(|_| Value::Null),
        "list_databases" => adapter.list_databases().await.map(|v| json!(v)),
        "list_schemas" => adapter.list_schemas().await.map(|v| json!(v)),
        "list_tables" => adapter.list_tables(Some(schema)).await.map(|v| json!(v)),
        "list_views" => adapter.list_views(Some(schema)).await.map(|v| json!(v)),
        "list_functions" => adapter.list_functions(Some(schema)).await.map(|v| json!(v)),
        "get_function_definition" => adapter
            .get_function_definition(args["oid"].as_str().unwrap_or(""))
            .await
            .map(|v| json!(v)),
        "get_view_definition" => adapter
            .get_view_definition(schema, args["view"].as_str().unwrap_or(table))
            .await
            .map(|v| json!(v)),
        "update_view_definition" => adapter
            .update_view_definition(
                schema,
                args["view"].as_str().unwrap_or(table),
                args["definition"].as_str().unwrap_or(""),
                args["dryRun"].as_bool().unwrap_or(false),
            )
            .await
            .map(|_| Value::Null),
        "list_all_columns" => adapter
            .list_columns(Some(schema), None, None)
            .await
            .map(|v| json!(v)),
        "list_table_columns_detailed" => adapter
            .list_table_columns_detailed(schema, table)
            .await
            .map(|v| json!(v)),
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
        "execute_query" => adapter
            .execute_query(args["sql"].as_str().unwrap_or(""))
            .await
            .map(|v| json!(v)),
        "explain_query" => adapter
            .explain_query(
                args["sql"].as_str().unwrap_or(""),
                args["analyze"].as_bool().unwrap_or(false),
            )
            .await
            .map(|v| json!(v)),
        "get_database_overview" => adapter.get_database_overview().await.map(|v| json!(v)),
        "preview_create_table_ddl" => adapter
            .preview_create_table_ddl(
                &serde_json::from_value(args["request"].clone()).map_err(|e| e.to_string())?,
            )
            .await
            .map(|v| json!(v)),
        "list_indexes" => adapter.list_indexes(schema, table).await.map(|v| json!(v)),
        "list_constraints" => adapter
            .list_constraints(schema, table)
            .await
            .map(|v| json!(v)),
        "list_foreign_keys" => adapter
            .list_foreign_keys(schema, table)
            .await
            .map(|v| json!(v)),
        "list_materialized_views" => adapter
            .list_materialized_views(Some(schema))
            .await
            .map(|v| json!(v)),
        "create_table" => adapter
            .create_table(
                &serde_json::from_value(args["request"].clone()).map_err(|e| e.to_string())?,
            )
            .await
            .map(|_| Value::Null),
        "add_column" => adapter
            .add_column(
                schema,
                table,
                &serde_json::from_value(args["column"].clone()).map_err(|e| e.to_string())?,
            )
            .await
            .map(|_| Value::Null),
        "alter_column" => adapter
            .alter_column(
                schema,
                table,
                &serde_json::from_value(args["changes"].clone()).map_err(|e| e.to_string())?,
            )
            .await
            .map(|_| Value::Null),
        "drop_column" => adapter
            .drop_column(schema, table, args["column"].as_str().unwrap_or(""))
            .await
            .map(|_| Value::Null),
        "truncate_table" => adapter
            .truncate_table(schema, table)
            .await
            .map(|_| Value::Null),
        "drop_table" => adapter.drop_table(schema, table).await.map(|_| Value::Null),
        "create_schema" => adapter
            .create_schema(args["name"].as_str().unwrap_or(""))
            .await
            .map(|_| Value::Null),
        "drop_schema" => adapter
            .drop_schema(args["name"].as_str().unwrap_or(""), false)
            .await
            .map(|_| Value::Null),
        _ => Err(format!("Unsupported browser lab command: {command}")),
    }
}

#[tokio::test]
#[ignore = "isolated browser lab bridge; requires L8DB_E2E_CLICKHOUSE_URL"]
async fn clickhouse_browser_bridge() {
    if std::env::var("L8DB_CLICKHOUSE_BROWSER").as_deref() != Ok("1") {
        return;
    }
    let uri = std::env::var("L8DB_E2E_CLICKHOUSE_URL").expect("L8DB_E2E_CLICKHOUSE_URL required");
    let pool = create_pool_state();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:27021")
        .await
        .unwrap();
    println!("ClickHouse browser bridge ready on 127.0.0.1:27021");
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
        stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", response.len(), response).as_bytes()).await.unwrap();
    }
}
