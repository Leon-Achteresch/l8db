use crate::db::{self, create_adapter_from_string, provider::DatabaseKind};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

struct Lab {
    root: std::path::PathBuf,
    urls: HashMap<String, String>,
    pool: db::pool::PoolState,
    transactions: db::transaction::TransactionState,
}

impl Lab {
    async fn dispatch(&self, command: &str, args: &Value) -> Result<Value, String> {
        if command == "versioning_repository" {
            let request: super::Request =
                serde_json::from_value(args["request"].clone()).map_err(|e| e.to_string())?;
            let repo = std::fs::canonicalize(&request.repo).map_err(|e| e.to_string())?;
            if !repo.starts_with(&self.root) {
                return Err("Only isolated lab repositories are accessible".into());
            }
            return super::handle(request).await;
        }
        if command == "versioning_run_status" {
            return super::runner::status(args["id"].as_str().ok_or("id missing")?)
                .await
                .map(|s| json!(s));
        }
        if command == "versioning_run_fleet" {
            let mut requests: Vec<super::runner::Request> =
                serde_json::from_value(args["requests"].clone()).map_err(|e| e.to_string())?;
            for request in &mut requests {
                let root = std::fs::canonicalize(&request.repo).map_err(|e| e.to_string())?;
                if !root.starts_with(&self.root) {
                    return Err("Only isolated repositories allowed".into());
                }
                let key = if request.connection.kind == DatabaseKind::Oracle {
                    "oracle"
                } else {
                    "postgres"
                };
                if key == "postgres"
                    && ![
                        "l8db_versioning_dev",
                        "l8db_versioning_a",
                        "l8db_versioning_b",
                        "l8db_versioning_edge",
                    ]
                    .contains(&request.connection.database.as_deref().unwrap_or(""))
                {
                    return Err("Only isolated databases allowed".into());
                }
                request.connection.connection_string =
                    self.urls.get(key).ok_or("Lab provider missing")?.clone();
            }
            return super::runner::start_fleet(
                requests,
                self.pool.clone(),
                self.transactions.clone(),
            )
            .await
            .map(|s| json!(s));
        }
        if command == "versioning_run" {
            let mut request: super::runner::Request =
                serde_json::from_value(args["request"].clone()).map_err(|e| e.to_string())?;
            let root = std::fs::canonicalize(&request.repo).map_err(|e| e.to_string())?;
            if !root.starts_with(&self.root) {
                return Err("Only isolated repositories allowed".into());
            }
            let key = if request.connection.kind == DatabaseKind::Oracle {
                "oracle"
            } else {
                "postgres"
            };
            if key == "postgres"
                && ![
                    "l8db_versioning_dev",
                    "l8db_versioning_a",
                    "l8db_versioning_b",
                    "l8db_versioning_edge",
                ]
                .contains(&request.connection.database.as_deref().unwrap_or(""))
            {
                return Err("Only isolated databases allowed".into());
            }
            request.connection.connection_string =
                self.urls.get(key).ok_or("Lab provider missing")?.clone();
            return super::runner::start(request, self.pool.clone(), self.transactions.clone())
                .await
                .map(|s| json!(s));
        }
        if command == "versioning_control" {
            let mut request: super::control::Request =
                serde_json::from_value(args["request"].clone()).map_err(|e| e.to_string())?;
            let key = if request.connection.kind == DatabaseKind::Oracle {
                "oracle"
            } else {
                "postgres"
            };
            if key == "postgres"
                && ![
                    "l8db_versioning_dev",
                    "l8db_versioning_a",
                    "l8db_versioning_b",
                    "l8db_versioning_edge",
                ]
                .contains(&request.connection.database.as_deref().unwrap_or(""))
            {
                return Err("Only isolated databases allowed".into());
            }
            request.connection.connection_string =
                self.urls.get(key).ok_or("Lab provider missing")?.clone();
            return super::control::handle(request, self.pool.clone(), self.transactions.clone())
                .await;
        }
        if command == "list_providers" {
            return Ok(json!(db::provider::list_providers()));
        }
        let tx = args["txId"].as_str().unwrap_or("");
        let sql = args["sql"].as_str().unwrap_or("");
        match command {
            "versioning_metadata" => {
                let adapter = self
                    .transactions
                    .versioning_adapter(tx, self.pool.clone())
                    .await?;
                return super::metadata::read(
                    adapter.as_ref(),
                    args["operation"].as_str().ok_or("operation missing")?,
                    args["schema"].as_str().ok_or("schema missing")?,
                    args["name"].as_str().ok_or("name missing")?,
                )
                .await;
            }
            "versioning_oracle_timeout" => {
                return self
                    .transactions
                    .versioning_oracle_timeout(
                        tx,
                        args["milliseconds"].as_u64().ok_or("Timeout missing")?,
                    )
                    .await
                    .map(|_| Value::Null)
            }
            "execute_in_transaction" => {
                return self.transactions.execute(tx, sql).await.map(|v| json!(v))
            }
            "commit_transaction" => return self.transactions.commit(tx).await.map(|_| Value::Null),
            "rollback_transaction" => {
                return self.transactions.rollback(tx).await.map(|_| Value::Null)
            }
            "list_transactions" => return Ok(json!(self.transactions.list_active_ids().await)),
            _ => {}
        }
        let kind = if args["kind"] == "oracle" {
            DatabaseKind::Oracle
        } else {
            DatabaseKind::Postgres
        };
        let key = if kind == DatabaseKind::Oracle {
            "oracle"
        } else {
            "postgres"
        };
        let url = self.urls.get(key).ok_or("Lab provider missing")?;
        let database = args["database"].as_str().unwrap_or("l8db_versioning_dev");
        if kind == DatabaseKind::Postgres
            && ![
                "l8db_versioning_dev",
                "l8db_versioning_a",
                "l8db_versioning_b",
                "l8db_versioning_edge",
            ]
            .contains(&database)
        {
            return Err("Only isolated databases allowed".into());
        }
        let database = if kind == DatabaseKind::Oracle {
            None
        } else {
            Some(database)
        };
        let adapter = create_adapter_from_string(kind, url, database, self.pool.clone())?;
        let schema = args["schema"]
            .as_str()
            .unwrap_or(if kind == DatabaseKind::Oracle {
                "L8DB_VCS_DEV"
            } else {
                "public"
            });
        let table = args["table"].as_str().unwrap_or("invoices");
        match command {
            "begin_transaction" => self
                .transactions
                .begin(kind, url, database, &self.pool)
                .await
                .map(|v| json!(v)),
            "test_connection_string" => adapter.test_connection().await.map(|_| Value::Null),
            "list_databases" => Ok(json!([
                "l8db_versioning_dev",
                "l8db_versioning_a",
                "l8db_versioning_b",
                "l8db_versioning_edge"
            ])),
            "list_schemas" => adapter.list_schemas().await.map(|v| json!(v)),
            "list_tables" => adapter.list_tables(Some(schema)).await.map(|v| json!(v)),
            "list_all_columns" => adapter
                .list_columns(Some(schema), None, None)
                .await
                .map(|v| json!(v)),
            "list_views" => adapter.list_views(Some(schema)).await.map(|v| json!(v)),
            "list_functions" => adapter.list_functions(Some(schema)).await.map(|v| json!(v)),
            "list_procedures" => adapter
                .list_procedures(Some(schema))
                .await
                .map(|v| json!(v)),
            "list_sequences" => adapter.list_sequences(Some(schema)).await.map(|v| json!(v)),
            "get_function_definition" => adapter
                .get_function_definition(args["oid"].as_str().ok_or("oid missing")?)
                .await
                .map(|v| json!(v)),
            "get_view_definition" => adapter
                .get_view_definition(schema, args["view"].as_str().unwrap_or("invoice_totals"))
                .await
                .map(|v| json!(v)),
            "list_table_columns_detailed" => adapter
                .list_table_columns_detailed(schema, table)
                .await
                .map(|v| json!(v)),
            "list_constraints" => adapter
                .list_constraints(schema, table)
                .await
                .map(|v| json!(v)),
            "list_indexes" => adapter.list_indexes(schema, table).await.map(|v| json!(v)),
            "list_triggers" => adapter.list_triggers(schema, table).await.map(|v| json!(v)),
            "list_compile_errors" => adapter
                .list_compile_errors(Some(schema))
                .await
                .map(|v| json!(v)),
            "list_invalid_objects" => adapter
                .list_invalid_objects(Some(schema))
                .await
                .map(|v| json!(v)),
            "execute_script" => adapter.execute_script(sql).await.map(|v| json!(v)),
            "execute_query" => adapter.execute_query(sql).await.map(|v| json!(v)),
            "validate_sql" => adapter.validate_sql(sql).await.map(|_| Value::Null),
            _ => Err(format!("Unsupported lab command: {command}")),
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
            size = value.trim().parse().map_err(|_| "Invalid length")?;
        }
        if size > 20 * 1024 * 1024 {
            return Err("Request too large".into());
        }
    }
    let value = if first.starts_with("GET /health ") {
        json!({"providers": db::provider::list_providers(),"ready":true})
    } else if first.starts_with("OPTIONS ") {
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
            Ok(result) => json!({"result":result}),
            Err(error) => json!({"error":error}),
        }
    };
    let body = value.to_string();
    let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: http://localhost:1420\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, GET, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
    socket
        .write_all(response.as_bytes())
        .await
        .map_err(|e| e.to_string())
}

#[tokio::test]
#[ignore = "isolated PostgreSQL and Oracle browser lab"]
async fn versioning_browser_bridge() {
    let path =
        std::env::var("L8DB_VERSIONING_LAB").expect("L8DB_VERSIONING_LAB settings path required");
    let settings: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let pool = db::pool::create_pool_state();
    let pg = settings["postgresUrl"].as_str().unwrap();
    let oracle = settings["oracleUrl"].as_str();
    let mut providers = vec![(DatabaseKind::Postgres, pg)];
    if let Some(url) = oracle {
        providers.push((DatabaseKind::Oracle, url));
    }
    for (kind, url) in providers {
        let parsed = url::Url::parse(url).unwrap();
        assert_eq!(parsed.host_str(), Some("127.0.0.1"));
        assert!([Some(55440), Some(55441)].contains(&parsed.port()));
        let adapter = create_adapter_from_string(kind, url, None, pool.clone()).unwrap();
        adapter
            .test_connection()
            .await
            .expect("Isolated lab provider unavailable");
        if kind == DatabaseKind::Postgres {
            for db in [
                "l8db_versioning_dev",
                "l8db_versioning_a",
                "l8db_versioning_b",
                "l8db_versioning_edge",
            ] {
                let _ = adapter
                    .execute_query(&format!("CREATE DATABASE {db}"))
                    .await;
                let target = create_adapter_from_string(kind, url, Some(db), pool.clone()).unwrap();
                target.execute_query("CREATE TABLE IF NOT EXISTS public.invoices (id integer PRIMARY KEY, amount numeric NOT NULL)").await.unwrap();
                target.execute_query("CREATE OR REPLACE FUNCTION public.invoice_total(value numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT value $$").await.unwrap();
            }
        } else {
            for schema in ["L8DB_VCS_DEV", "L8DB_VCS_A", "L8DB_VCS_B"] {
                let _ = adapter
                    .execute_query(&format!("CREATE USER {schema} NO AUTHENTICATION"))
                    .await;
                adapter
                    .execute_query(&format!("ALTER USER {schema} QUOTA UNLIMITED ON USERS"))
                    .await
                    .unwrap();
                adapter.execute_query(&format!("CREATE OR REPLACE PACKAGE {schema}.ORDER_SERVICE AS FUNCTION calculate_total(value NUMBER) RETURN NUMBER; END ORDER_SERVICE;")).await.unwrap();
                adapter.execute_query(&format!("CREATE OR REPLACE PACKAGE BODY {schema}.ORDER_SERVICE AS FUNCTION calculate_total(value NUMBER) RETURN NUMBER IS BEGIN RETURN value; END; END ORDER_SERVICE;")).await.unwrap();
            }
        }
    }
    let mut urls = HashMap::from([("postgres".into(), pg.into())]);
    if let Some(url) = oracle {
        urls.insert("oracle".into(), url.into());
    }
    let lab = Arc::new(Lab {
        root: std::fs::canonicalize(settings["root"].as_str().unwrap()).unwrap(),
        urls,
        pool,
        transactions: db::transaction::create_transaction_state(),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:55449")
        .await
        .unwrap();
    println!("Versioning lab bridge ready on 127.0.0.1:55449");
    loop {
        let (socket, _) = listener.accept().await.unwrap();
        let lab = lab.clone();
        tokio::spawn(async move {
            let _ = respond(socket, lab).await;
        });
    }
}
