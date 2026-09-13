use std::sync::Arc;

use serde_json::{json, Value};

use super::{create_adapter_from_string, DatabaseAdapter, DatabaseKind};

struct Lab {
    kind: DatabaseKind,
    schema: String,
    adapter: Arc<dyn DatabaseAdapter>,
}

impl Lab {
    async fn create(kind: DatabaseKind) -> Self {
        let (variable, schema) = match kind {
            DatabaseKind::Postgres => ("L8DB_MD_POSTGRES_URL", "public"),
            DatabaseKind::Oracle => ("L8DB_MD_ORACLE_URL", "L8DB_MD_LAB"),
            _ => panic!("Unsupported lab provider"),
        };
        let connection = std::env::var(variable).expect("Master-detail lab connection missing");
        let url = url::Url::parse(&connection).unwrap();
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        assert!(url.username().eq_ignore_ascii_case("l8db_md") || url.username() == "L8DB_MD_LAB");
        let adapter =
            create_adapter_from_string(kind, &connection, None, super::pool::create_pool_state())
                .unwrap();
        let lab = Self {
            kind,
            schema: schema.into(),
            adapter: Arc::from(adapter),
        };
        lab.adapter.test_connection().await.unwrap();
        lab.reset().await;
        lab
    }

    fn table(&self, name: &str) -> String {
        format!("\"{}\".\"{name}\"", self.schema)
    }

    async fn exec(&self, sql: &str) {
        self.adapter.execute_query(sql).await.unwrap();
    }

    async fn reset(&self) {
        for name in ["MD_ITEMS", "MD_ORDERS", "MD_CUSTOMERS", "MD_TENANTS"] {
            let _ = self
                .adapter
                .execute_query(&format!("DROP TABLE {}", self.table(name)))
                .await;
        }
        let integer = if self.kind == DatabaseKind::Oracle {
            "NUMBER(10)"
        } else {
            "INTEGER"
        };
        let text = if self.kind == DatabaseKind::Oracle {
            "VARCHAR2(120)"
        } else {
            "VARCHAR(120)"
        };
        self.exec(&format!(
            "CREATE TABLE {} (\"REF\" {integer} PRIMARY KEY, \"NAME\" {text})",
            self.table("MD_CUSTOMERS")
        ))
        .await;
        self.exec(&format!("CREATE TABLE {} (\"TENANT\" {text}, \"CODE\" {integer}, \"NAME\" {text}, PRIMARY KEY (\"TENANT\", \"CODE\"))", self.table("MD_TENANTS"))).await;
        self.exec(&format!("CREATE TABLE {} (\"REF\" {integer} PRIMARY KEY, \"REF_CUSTOMER\" {integer}, \"LABEL\" {text}, \"REF_TENANT\" {text}, \"REF_CODE\" {integer}, CONSTRAINT \"MD_CUSTOMER_FK\" FOREIGN KEY (\"REF_CUSTOMER\") REFERENCES {} (\"REF\"), CONSTRAINT \"MD_TENANT_FK\" FOREIGN KEY (\"REF_TENANT\", \"REF_CODE\") REFERENCES {} (\"TENANT\", \"CODE\"))", self.table("MD_ORDERS"), self.table("MD_CUSTOMERS"), self.table("MD_TENANTS"))).await;
        self.exec(&format!("CREATE TABLE {} (\"REF\" {integer} PRIMARY KEY, \"REF_AUF_KOPF\" {integer}, \"ARTICLE\" {text}, CONSTRAINT \"MD_ORDER_FK\" FOREIGN KEY (\"REF_AUF_KOPF\") REFERENCES {} (\"REF\"))", self.table("MD_ITEMS"), self.table("MD_ORDERS"))).await;
        for (table, values) in [
            ("MD_CUSTOMERS", "(1, 'O''Reilly')"),
            ("MD_CUSTOMERS", "(2, 'Müller')"),
            ("MD_TENANTS", "('A', 1, 'Tenant A')"),
            ("MD_TENANTS", "('B', 1, 'Tenant B')"),
            ("MD_ORDERS", "(101, 1, 'Erster Auftrag', 'A', 1)"),
            ("MD_ORDERS", "(102, 2, 'Zweiter Auftrag', 'B', 1)"),
            ("MD_ORDERS", "(103, NULL, 'Ohne Kunde', NULL, NULL)"),
            ("MD_ORDERS", "(104, 1, 'Großer Auftrag', 'A', 1)"),
            ("MD_ITEMS", "(1001, 101, 'Schrauben')"),
            ("MD_ITEMS", "(1002, 101, 'Muttern')"),
            ("MD_ITEMS", "(1003, 102, 'Dichtung')"),
        ] {
            self.exec(&format!(
                "INSERT INTO {} VALUES {values}",
                self.table(table)
            ))
            .await;
        }
        for index in 0..105 {
            self.exec(&format!(
                "INSERT INTO {} VALUES ({}, 104, 'Position {}')",
                self.table("MD_ITEMS"),
                2000 + index,
                index
            ))
            .await;
        }
    }

    async fn query(&self, sql: &str, values: &[Option<&str>]) -> super::QueryResult {
        self.adapter
            .execute_query_with_params(
                sql,
                &values
                    .iter()
                    .map(|value| value.map(str::to_string))
                    .collect::<Vec<_>>(),
            )
            .await
            .unwrap()
    }

    async fn verify(&self) {
        assert!(self.kind.capabilities().bind_parameters);
        let fk = self
            .adapter
            .list_foreign_keys(&self.schema, "MD_ORDERS")
            .await
            .unwrap();
        assert_eq!(
            fk.iter()
                .filter(|entry| entry.constraint_name == "MD_CUSTOMER_FK")
                .count(),
            1
        );
        assert_eq!(
            fk.iter()
                .filter(|entry| entry.constraint_name == "MD_TENANT_FK")
                .count(),
            2
        );
        assert_eq!(
            fk.iter()
                .filter(|entry| entry.constraint_name == "MD_ORDER_FK")
                .count(),
            1
        );
        let limit = if self.kind == DatabaseKind::Oracle {
            "FETCH FIRST 100 ROWS ONLY"
        } else {
            "LIMIT 100"
        };
        let sql = format!(
            "SELECT * FROM {} WHERE \"REF_AUF_KOPF\" = $1 {limit}",
            self.table("MD_ITEMS")
        );
        assert_eq!(self.query(&sql, &[Some("101")]).await.rows.len(), 2);
        assert_eq!(
            self.query(&sql, &[Some("102")]).await.rows[0]["ARTICLE"],
            "Dichtung"
        );
        assert_eq!(self.query(&sql, &[Some("103")]).await.rows.len(), 0);
        assert_eq!(self.query(&sql, &[Some("104")]).await.rows.len(), 100);
        assert_eq!(self.query(&sql, &[None]).await.rows.len(), 0);
        let composite = format!(
            "SELECT * FROM {} WHERE \"TENANT\" = $1 AND \"CODE\" = $2",
            self.table("MD_TENANTS")
        );
        assert_eq!(
            self.query(&composite, &[Some("B"), Some("1")]).await.rows[0]["NAME"],
            "Tenant B"
        );
        let customer = format!(
            "SELECT * FROM {} WHERE \"NAME\" = $1 OR \"NAME\" = $1",
            self.table("MD_CUSTOMERS")
        );
        assert_eq!(
            self.query(&customer, &[Some("O'Reilly")]).await.rows[0]["REF"],
            1
        );
        assert_eq!(
            self.query(&customer, &[Some("x' OR '1'='1")])
                .await
                .rows
                .len(),
            0
        );
        assert!(self
            .adapter
            .execute_query_with_params(&sql, &[Some("not-a-number".into())])
            .await
            .is_err());
        assert_eq!(self.query(&sql, &[Some("101")]).await.rows.len(), 2);
        if self.kind == DatabaseKind::Postgres {
            let types = self.query(
                "SELECT $1::uuid AS \"KEY\", $2::date AS \"DAY\", $3::boolean AS \"FLAG\", $4::numeric AS \"AMOUNT\"",
                &[Some("12345678-1234-1234-1234-123456789abc"), Some("2026-09-13"), Some("true"), Some("1234.56")],
            ).await;
            assert_eq!(types.rows[0]["KEY"], "12345678-1234-1234-1234-123456789abc");
            assert_eq!(types.rows[0]["DAY"], "2026-09-13");
            assert_eq!(types.rows[0]["FLAG"], true);
            assert_eq!(types.rows[0]["AMOUNT"], json!(1234.56));
        }
        let error = format!(
            "SELECT \"MISSING_COLUMN\" FROM {} WHERE \"REF\" = $1",
            self.table("MD_ORDERS")
        );
        assert!(self
            .adapter
            .execute_query_with_params(&error, &[Some("101".into())])
            .await
            .is_err());
        assert_eq!(self.query(&sql, &[Some("102")]).await.rows.len(), 1);
    }
}

#[tokio::test]
#[ignore]
async fn master_detail_postgres_live() {
    Lab::create(DatabaseKind::Postgres).await.verify().await;
}

#[tokio::test]
#[ignore]
async fn master_detail_oracle_live() {
    Lab::create(DatabaseKind::Oracle).await.verify().await;
}

impl Lab {
    async fn dispatch(&self, command: &str, args: &Value) -> Result<Value, String> {
        let table = args["table"].as_str().unwrap_or("MD_ORDERS");
        if !["MD_ORDERS", "MD_ITEMS", "MD_CUSTOMERS", "MD_TENANTS"].contains(&table) {
            return Err("Only master-detail fixture tables are available".into());
        }
        match command {
            "list_foreign_keys" => {
                serde_json::to_value(self.adapter.list_foreign_keys(&self.schema, table).await?)
                    .map_err(|error| error.to_string())
            }
            "list_table_columns_detailed" => serde_json::to_value(
                self.adapter
                    .list_table_columns_detailed(&self.schema, table)
                    .await?,
            )
            .map_err(|error| error.to_string()),
            "fetch_table_rows" => serde_json::to_value(
                self.adapter
                    .fetch_rows(
                        &self.schema,
                        table,
                        args["filter"].as_str(),
                        args["limit"].as_i64().unwrap_or(100).min(500),
                        args["offset"].as_i64().unwrap_or(0),
                        Some("REF"),
                        false,
                        false,
                        false,
                    )
                    .await?,
            )
            .map_err(|error| error.to_string()),
            "count_table_rows" => Ok(json!(
                self.adapter
                    .count_rows(&self.schema, table, args["filter"].as_str(), false)
                    .await?
            )),
            "execute_query_with_params" => {
                let sql = args["sql"].as_str().ok_or("Missing SQL")?;
                if !sql.trim().to_ascii_uppercase().starts_with("SELECT ") || sql.contains(';') {
                    return Err("Only single SELECT queries are allowed in the browser lab".into());
                }
                let params: Vec<Option<String>> = serde_json::from_value(args["params"].clone())
                    .map_err(|error| error.to_string())?;
                serde_json::to_value(self.adapter.execute_query_with_params(sql, &params).await?)
                    .map_err(|error| error.to_string())
            }
            _ => Err("Unknown lab command".into()),
        }
    }
}

async fn browser_request(mut socket: tokio::net::TcpStream, postgres: Arc<Lab>, oracle: Arc<Lab>) {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    let mut reader = BufReader::new(&mut socket);
    let mut first = String::new();
    reader.read_line(&mut first).await.unwrap();
    let mut length = 0usize;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        if line.trim().is_empty() {
            break;
        }
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            length = value.trim().parse().unwrap_or(0);
        }
    }
    if length > 1024 * 1024 {
        return;
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).await.unwrap();
    let result = if first.starts_with("OPTIONS ") {
        json!({})
    } else if first.starts_with("GET /health ") {
        json!({"ready": true, "providers": super::provider::list_providers()})
    } else {
        let request: Value = serde_json::from_slice(&body).unwrap();
        let lab = if request["kind"] == "oracle" {
            oracle
        } else {
            postgres
        };
        if let Some(delay) = request["delayMs"].as_u64() {
            tokio::time::sleep(std::time::Duration::from_millis(delay.min(1000))).await;
        }
        match lab
            .dispatch(request["command"].as_str().unwrap_or(""), &request["args"])
            .await
        {
            Ok(value) => json!({"result": value}),
            Err(error) => json!({"error": error}),
        }
    };
    let body = serde_json::to_vec(&result).unwrap();
    let header = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, GET, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    socket.write_all(header.as_bytes()).await.unwrap();
    socket.write_all(&body).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn master_detail_browser_bridge() {
    let Ok(port) = std::env::var("L8DB_MD_BROWSER_PORT") else {
        return;
    };
    let postgres = Arc::new(Lab::create(DatabaseKind::Postgres).await);
    let oracle = Arc::new(Lab::create(DatabaseKind::Oracle).await);
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .unwrap();
    eprintln!("Master-detail browser lab ready");
    let deadline = tokio::time::sleep(std::time::Duration::from_secs(900));
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            accepted = listener.accept() => {
                let (socket, _) = accepted.unwrap();
                tokio::spawn(browser_request(socket, postgres.clone(), oracle.clone()));
            }
        }
    }
}
