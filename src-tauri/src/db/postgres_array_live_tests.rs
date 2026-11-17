use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::db::pool::create_pool_state;
use crate::db::postgres::PostgresAdapter;
use crate::db::transaction::create_transaction_state;
use crate::db::{DatabaseAdapter, DatabaseKind};

use crate::array_editor_target::owned_url;

#[test]
fn local_array_target_rejects_ambient_external_or_unowned_databases() {
    let db = "l8db_a01_012345abcdef";
    let valid = format!("postgresql://l8db_a01@127.0.0.1:54321/{db}?sslmode=disable");
    assert!(owned_url(&valid, db).is_ok());
    for value in [
        valid.replace("127.0.0.1", "localhost"),
        valid.replace("127.0.0.1", "db.example.invalid"),
        valid.replace(db, "postgres"),
        valid.replace("l8db_a01@", "postgres@"),
        format!("{valid}&host=external"),
        valid.replace(":54321", ""),
    ] {
        assert!(owned_url(&value, db).is_err());
    }
    assert!(owned_url(&valid, "postgres").is_err());
}

async fn query(adapter: &PostgresAdapter, sql: &str) -> Value {
    adapter.execute_query(sql).await.unwrap().rows.remove(0)
}

async fn row(adapter: &PostgresAdapter, id: i32) -> Value {
    adapter
        .fetch_rows(
            "a01",
            "cells",
            Some(&format!("id = {id}")),
            1,
            0,
            None,
            false,
            false,
            false,
        )
        .await
        .unwrap()
        .rows
        .remove(0)
}

async fn snapshot(adapter: &PostgresAdapter, id: i32, column: &str) -> Value {
    query(adapter, &format!("SELECT {column}::text AS wire, array_dims({column}) AS dims, array_to_json({column})::text AS value FROM a01.cells WHERE id={id}")).await
}

struct Case {
    column: &'static str,
    seed: &'static str,
    input: Option<&'static str>,
    value: &'static str,
    dims: Option<&'static str>,
}

#[tokio::test]
#[ignore]
async fn a01_local_postgresql_provider_roundtrip() {
    let database = std::env::var("L8DB_A01_LOCAL_OWNED_DB")
        .expect("run scripts/test-postgres-arrays-local.sh");
    let url = owned_url(
        &std::env::var("L8DB_A01_LOCAL_PG_URL").expect("explicit loopback DSN required"),
        &database,
    )
    .unwrap();
    let pool = create_pool_state();
    let adapter = PostgresAdapter::from_connection_string(&url, None, pool.clone()).unwrap();
    let identity = query(&adapter, "SELECT current_database() AS db, current_user AS usr, current_setting('cluster_name') AS marker, inet_server_addr()::text AS host, version() AS version").await;
    assert_eq!(identity["db"], database);
    assert_eq!(identity["marker"], database);
    assert_eq!(identity["usr"], "l8db_a01");
    assert_eq!(identity["host"], "127.0.0.1/32");
    println!(
        "A01 real native PostgreSQL provider: {}",
        identity["version"]
    );
    for sql in [
        "CREATE SCHEMA a01",
        "CREATE TYPE a01.mood AS ENUM ('red','green','O''Reilly')",
        "CREATE TYPE a01.pair AS (x integer, label text)",
        "CREATE DOMAIN a01.positive AS integer CHECK (VALUE > 0)",
        "CREATE DOMAIN a01.texts AS text[]",
        "CREATE TABLE a01.cells(id integer PRIMARY KEY, items text[], ints integer[], nums numeric[], flags boolean[], moods a01.mood[], docs jsonb[], plain_docs json[], pairs a01.pair[], domains a01.positive[], array_domain a01.texts, note text DEFAULT 'original')",
        "CREATE SEQUENCE a01.attempts MINVALUE 0 START 0",
        "CREATE FUNCTION a01.track() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM nextval('a01.attempts'); RETURN NULL; END$$",
        "CREATE TRIGGER track BEFORE UPDATE ON a01.cells FOR EACH STATEMENT EXECUTE FUNCTION a01.track()",
    ] { adapter.execute_query(sql).await.unwrap(); }
    {
        let connection = adapter.get_conn().await.unwrap();
        let metadata = connection
            .query(super::COLUMNS_SQL, &[&"a01", &"cells"])
            .await
            .unwrap();
        let metadata = super::columns(&metadata);
        let kind = |name: &str| metadata.iter().find(|column| column.name == name).unwrap();
        assert_eq!(kind("items").delimiter.as_deref(), Some(","));
        assert_eq!(kind("moods").element_kind.as_deref(), Some("e"));
        assert_eq!(kind("domains").element_kind.as_deref(), Some("d"));
        assert_eq!(kind("pairs").element_kind.as_deref(), Some("c"));
        assert_eq!(kind("docs").element_type.as_deref(), Some("jsonb"));
        assert_eq!(kind("array_domain").type_name, "texts");
    }
    let cases = [
        Case {
            column: "items",
            seed: "NULL",
            input: Some(r#"["",null,"NULL","a,b","a\\b","say\"hi","O'Reilly","雪"]"#),
            value: r#"["",null,"NULL","a,b","a\\b","say\"hi","O'Reilly","雪"]"#,
            dims: Some("[1:8]"),
        },
        Case {
            column: "items",
            seed: "'[0:1]={x,y}'",
            input: Some(r#"["a","b","c"]"#),
            value: r#"["a","b","c"]"#,
            dims: Some("[0:2]"),
        },
        Case {
            column: "items",
            seed: "'[-3:-2]={x,y}'",
            input: Some(r#"["",null]"#),
            value: r#"["",null]"#,
            dims: Some("[-3:-2]"),
        },
        Case {
            column: "items",
            seed: "'[0:1][-2:-1]={{a,b},{c,d}}'",
            input: Some(r#"[["a","b","c"],["d",null,""]]"#),
            value: r#"[["a","b","c"],["d",null,""]]"#,
            dims: Some("[0:1][-2:0]"),
        },
        Case {
            column: "ints",
            seed: "'[7:8]={1,2}'",
            input: Some("[[1,2],[3,4]]"),
            value: "[[1,2],[3,4]]",
            dims: Some("[7:8][1:2]"),
        },
        Case {
            column: "items",
            seed: "'[-2:-1][5:6]={{a,b},{c,d}}'",
            input: Some("[]"),
            value: "[]",
            dims: None,
        },
        Case {
            column: "items",
            seed: "'[0:1]={x,y}'",
            input: None,
            value: "null",
            dims: None,
        },
        Case {
            column: "flags",
            seed: "NULL",
            input: Some("[true,false,null]"),
            value: "[true,false,null]",
            dims: Some("[1:3]"),
        },
        Case {
            column: "moods",
            seed: "NULL",
            input: Some(r#"["red","O'Reilly",null]"#),
            value: r#"["red","O'Reilly",null]"#,
            dims: Some("[1:3]"),
        },
        Case {
            column: "moods",
            seed: "'[-1:0][4:5]={{red,red},{red,red}}'",
            input: Some(r#"[["green",null],["red","O'Reilly"]]"#),
            value: r#"[["green",null],["red","O'Reilly"]]"#,
            dims: Some("[-1:0][4:5]"),
        },
        Case {
            column: "nums",
            seed: "NULL",
            input: Some("[9007199254740993.1234500,0.1234567890123456789000,null]"),
            value: "[9007199254740993.1234500,0.1234567890123456789000,null]",
            dims: Some("[1:3]"),
        },
        Case {
            column: "array_domain",
            seed: "'[-2:-1]={x,y}'",
            input: Some(r#"["alpha",null]"#),
            value: r#"["alpha",null]"#,
            dims: Some("[-2:-1]"),
        },
        Case {
            column: "items",
            seed: "'[1:2]={x,y}'",
            input: Some("[-5:-4]={left,right}"),
            value: r#"["left","right"]"#,
            dims: Some("[-5:-4]"),
        },
    ];
    let transactions = create_transaction_state();
    let mut id = 0;
    for transactional in [false, true] {
        for case in &cases {
            id += 1;
            adapter
                .execute_query(&format!(
                    "INSERT INTO a01.cells(id,{}) VALUES({id},{})",
                    case.column, case.seed
                ))
                .await
                .unwrap();
            let original = row(&adapter, id).await;
            let updates = HashMap::from([(case.column.to_owned(), case.input.map(str::to_owned))]);
            if transactional {
                let tx = transactions
                    .begin(DatabaseKind::Postgres, &url, None, &pool)
                    .await
                    .unwrap();
                transactions
                    .update_row(
                        &tx,
                        "a01",
                        "cells",
                        original["__ctid__"].as_str().unwrap(),
                        &updates,
                    )
                    .await
                    .unwrap();
                let inside = transactions
                    .execute(
                        &tx,
                        &format!(
                            "SELECT array_dims({}) AS dims FROM a01.cells WHERE id={id}",
                            case.column
                        ),
                    )
                    .await
                    .unwrap();
                assert_eq!(inside.rows[0]["dims"], json!(case.dims));
                assert_eq!(row(&adapter, id).await[case.column], original[case.column]);
                transactions.commit(&tx).await.unwrap();
            } else {
                adapter
                    .update_row(
                        "a01",
                        "cells",
                        original["__ctid__"].as_str().unwrap(),
                        &updates,
                    )
                    .await
                    .unwrap();
            }
            let actual = snapshot(&adapter, id, case.column).await;
            assert_eq!(
                actual["dims"],
                json!(case.dims),
                "{} tx={transactional}",
                case.column
            );
            if case.column == "nums" {
                assert_eq!(actual["value"], case.value);
                let grid = row(&adapter, id).await;
                let raw = grid["nums"]
                    .as_str()
                    .expect("precise arrays retain raw JSON text");
                let elements: Vec<&serde_json::value::RawValue> =
                    serde_json::from_str(raw).unwrap();
                assert_eq!(elements[0].get(), "9007199254740993.1234500");
                assert_eq!(elements[1].get(), "0.1234567890123456789000");
            } else {
                let parsed = actual["value"]
                    .as_str()
                    .map(|text| serde_json::from_str::<Value>(text).unwrap())
                    .unwrap_or(Value::Null);
                assert_eq!(parsed, serde_json::from_str::<Value>(case.value).unwrap());
                assert_eq!(row(&adapter, id).await[case.column], parsed);
            }
        }
    }
    let before = row(&adapter, 1).await;
    let old_bounds = snapshot(&adapter, 1, "items").await;
    let tx = transactions
        .begin(DatabaseKind::Postgres, &url, None, &pool)
        .await
        .unwrap();
    transactions
        .update_row(
            &tx,
            "a01",
            "cells",
            before["__ctid__"].as_str().unwrap(),
            &HashMap::from([(
                "items".into(),
                Some(r#"[["changed",null],["x",""]]"#.into()),
            )]),
        )
        .await
        .unwrap();
    transactions.rollback(&tx).await.unwrap();
    assert_eq!(row(&adapter, 1).await, before);
    assert_eq!(snapshot(&adapter, 1, "items").await, old_bounds);
    for transactional in [false, true] {
        for (column, input) in [
            ("items", "[[1],[2,3]]"),
            ("items", "[[]]"),
            ("items", "["),
            ("items", r#"["\u0000"]"#),
            ("docs", "[null]"),
            ("plain_docs", "[null]"),
            ("pairs", "[null]"),
            ("domains", "[null]"),
        ] {
            let original = row(&adapter, 1).await;
            let attempts = query(&adapter, "SELECT last_value::text AS n FROM a01.attempts").await;
            let updates = HashMap::from([
                ("note".into(), Some("must not change".into())),
                (column.into(), Some(input.into())),
            ]);
            if transactional {
                let tx = transactions
                    .begin(DatabaseKind::Postgres, &url, None, &pool)
                    .await
                    .unwrap();
                assert!(transactions
                    .update_row(
                        &tx,
                        "a01",
                        "cells",
                        original["__ctid__"].as_str().unwrap(),
                        &updates
                    )
                    .await
                    .is_err());
                assert_eq!(
                    transactions
                        .execute(&tx, "SELECT 1 AS healthy")
                        .await
                        .unwrap()
                        .rows[0]["healthy"],
                    "1"
                );
                transactions.rollback(&tx).await.unwrap();
            } else {
                assert!(adapter
                    .update_row(
                        "a01",
                        "cells",
                        original["__ctid__"].as_str().unwrap(),
                        &updates
                    )
                    .await
                    .is_err());
            }
            assert_eq!(
                query(&adapter, "SELECT last_value::text AS n FROM a01.attempts").await,
                attempts,
                "UPDATE attempted: {column} {input}"
            );
            assert_eq!(
                row(&adapter, 1).await,
                original,
                "partial mutation: {column} {input}"
            );
        }
    }
    let input = serde_json::to_string(
        &(0..512)
            .map(|i| format!("item-{i},\\\"雪"))
            .collect::<Vec<_>>(),
    )
    .unwrap();
    let mut durations = Vec::new();
    for iteration in 0..11 {
        let original = row(&adapter, 1).await;
        let started = Instant::now();
        adapter
            .update_row(
                "a01",
                "cells",
                original["__ctid__"].as_str().unwrap(),
                &HashMap::from([("items".into(), Some(input.clone()))]),
            )
            .await
            .unwrap();
        assert_eq!(
            row(&adapter, 1).await["items"],
            serde_json::from_str::<Value>(&input).unwrap()
        );
        if iteration >= 2 {
            durations.push(started.elapsed());
        }
    }
    durations.sort();
    println!("A01 provider live update+grid-read:512 elements, median_ms={:.3}, p95_ms={:.3}, samples=9; valid cases={}, rejected-before-UPDATE={}, transactions_active={}",durations[4].as_secs_f64()*1000.0,durations[8].as_secs_f64()*1000.0,cases.len()*2,16,transactions.list_active_ids().await.len());
    assert!(durations[4] < Duration::from_millis(250));
    assert!(durations[8] < Duration::from_millis(500));
    assert!(transactions.list_active_ids().await.is_empty());
    assert_eq!(query(&adapter,"SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'").await["n"],"0");
}
