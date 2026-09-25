use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

use crate::db::pool::{create_pool_state, PoolState};
use crate::db::transaction::{create_transaction_state, TransactionState};
use crate::db::{create_adapter_from_string, provider, DatabaseKind};

struct Lab {
    pool: PoolState,
    transactions: TransactionState,
}

fn text<'a>(args: &'a Value, key: &str) -> &'a str {
    args[key].as_str().unwrap_or("")
}

fn lab_url(args: &Value) -> Result<(DatabaseKind, String), String> {
    let kind: DatabaseKind =
        serde_json::from_value(args["kind"].clone()).map_err(|e| e.to_string())?;
    let url = text(args, "connectionString").to_string();
    if kind == DatabaseKind::Sqlite {
        let path = crate::db::sqlite::file_path(&url)?;
        let temp = std::env::temp_dir();
        let allowed = std::path::Path::new(&path).starts_with(&temp)
            || path.starts_with("/tmp/")
            || path.starts_with("/private/tmp/");
        if !allowed || path.contains("..") {
            return Err("Nur SQLite-Dateien im temporären Verzeichnis sind erlaubt".into());
        }
        return Ok((kind, url));
    }
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let redirected = parsed
        .query_pairs()
        .any(|(key, _)| key.to_ascii_lowercase().contains("host"));
    if redirected || !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost")) {
        return Err("Nur lokale Lab-Datenbanken sind erlaubt".into());
    }
    Ok((kind, url))
}

fn local_origin(origin: &str) -> bool {
    ["http://localhost:", "http://127.0.0.1:"]
        .iter()
        .any(|prefix| origin.starts_with(prefix))
}

impl Lab {
    async fn dispatch(&self, command: &str, args: &Value) -> Result<Value, String> {
        let tx = text(args, "txId");
        match command {
            "list_providers" => return Ok(json!(provider::list_providers())),
            "load_secret" => return Ok(Value::Null),
            "execute_in_transaction" => {
                return self
                    .transactions
                    .execute(tx, text(args, "sql"))
                    .await
                    .map(|v| json!(v))
            }
            "commit_transaction" => return self.transactions.commit(tx).await.map(|_| Value::Null),
            "rollback_transaction" => {
                return self.transactions.rollback(tx).await.map(|_| Value::Null)
            }
            "list_transactions" => return Ok(json!(self.transactions.list_active_ids().await)),
            _ => {}
        }
        let (kind, url) = lab_url(args)?;
        let database = args["database"].as_str();
        if command == "begin_transaction" {
            return self
                .transactions
                .begin(kind, &url, database, &self.pool)
                .await
                .map(|v| json!(v));
        }
        let adapter = create_adapter_from_string(kind, &url, database, self.pool.clone())?;
        let schema = text(args, "schema");
        let strings = |key: &str| -> Vec<String> {
            args[key]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default()
        };
        match command {
            "test_connection_string" => adapter.test_connection().await.map(|_| Value::Null),
            "list_databases" => adapter.list_databases().await.map(|v| json!(v)),
            "list_schemas" => adapter.list_schemas().await.map(|v| json!(v)),
            "schema_catalog" => adapter
                .schema_catalog(schema, &strings("types"))
                .await
                .map(|v| json!(v)),
            "schema_partition_ddl" => adapter
                .schema_partition_ddl(schema, &strings("tables"))
                .await
                .map(|v| json!(v)),
            "compile_invalid_objects" => adapter
                .compile_invalid_objects(args["schema"].as_str())
                .await
                .map(|v| json!(v)),
            "execute_script" => adapter
                .execute_script(text(args, "sql"))
                .await
                .map(|v| json!(v)),
            "execute_query" => adapter
                .execute_query(text(args, "sql"))
                .await
                .map(|v| json!(v)),
            _ => Err(format!("Nicht unterstützter Lab-Befehl: {command}")),
        }
    }
}

async fn respond(mut socket: tokio::net::TcpStream, lab: Arc<Lab>) -> Result<(), String> {
    let mut reader = BufReader::new(&mut socket);
    let mut first = String::new();
    reader
        .read_line(&mut first)
        .await
        .map_err(|e| e.to_string())?;
    let mut size = 0usize;
    let mut origin = None;
    loop {
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        if line == "\r\n" || line.is_empty() {
            break;
        }
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            size = value.trim().parse().map_err(|_| "Ungültige Länge")?;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("origin") {
                origin = Some(value.trim().to_string());
            }
        }
    }
    if origin.as_deref().is_some_and(|value| !local_origin(value)) {
        return Err("Fremder Origin".into());
    }
    let value = if first.starts_with("OPTIONS ") {
        Value::Null
    } else {
        let mut body = vec![0; size];
        reader
            .read_exact(&mut body)
            .await
            .map_err(|e| e.to_string())?;
        let request: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
        match lab
            .dispatch(request["command"].as_str().unwrap_or(""), &request["args"])
            .await
        {
            Ok(result) => json!({ "result": result }),
            Err(error) => json!({ "error": error }),
        }
    };
    let body = value.to_string();
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: {}\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nVary: Origin\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        origin.as_deref().unwrap_or("null"),
        body.len(),
        body
    );
    socket
        .write_all(response.as_bytes())
        .await
        .map_err(|e| e.to_string())
}

#[tokio::test]
#[ignore = "Schema-Vergleich-Lab: lokale Datenbank-Container"]
async fn schema_compare_bridge() {
    let port = std::env::var("L8DB_SCHEMA_COMPARE_BRIDGE_PORT").unwrap_or("27041".into());
    let lab = Arc::new(Lab {
        pool: create_pool_state(),
        transactions: create_transaction_state(),
    });
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .unwrap();
    println!("Schema-Vergleich-Bridge bereit auf 127.0.0.1:{port}");
    loop {
        let (socket, _) = listener.accept().await.unwrap();
        let lab = lab.clone();
        tokio::spawn(async move {
            let _ = respond(socket, lab).await;
        });
    }
}
