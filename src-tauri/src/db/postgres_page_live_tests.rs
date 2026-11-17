use std::time::Instant;

use crate::array_editor_target::{open_owned_fixture, owned_url};
use crate::db::pool::create_pool_state;
use crate::db::transaction::{create_transaction_state, TransactionTableRead};
use crate::db::{DatabaseAdapter, DatabaseKind, TableData};

const SCORE: &str = "Score Value";
const ITEM: &str = "Key\"Part";
const LOW_FIRST: &[(i64, i64)] = &[
    (1, 1),
    (2, 1),
    (2, 3),
    (1, 3),
    (3, 2),
    (1, 2),
    (2, 2),
    (3, 1),
];
const HIGH_FIRST: &[(i64, i64)] = &[
    (1, 2),
    (2, 2),
    (3, 1),
    (1, 3),
    (3, 2),
    (1, 1),
    (2, 1),
    (2, 3),
];

fn keys(page: &TableData) -> Vec<(i64, i64)> {
    page.rows
        .iter()
        .map(|row| {
            (
                row["Tenant ID"].as_i64().unwrap(),
                row[ITEM].as_i64().unwrap(),
            )
        })
        .collect()
}

async fn check_paging(adapter: &dyn DatabaseAdapter) {
    for (order, desc, expected) in [
        (SCORE, false, LOW_FIRST),
        (SCORE, true, HIGH_FIRST),
        (
            ITEM,
            true,
            &[
                (1, 3),
                (2, 3),
                (1, 2),
                (2, 2),
                (3, 2),
                (1, 1),
                (2, 1),
                (3, 1),
            ],
        ),
    ] {
        for _ in 0..2 {
            let mut rows = Vec::new();
            for offset in (0..expected.len()).step_by(2) {
                let page = adapter
                    .fetch_rows(
                        "a21",
                        "ordered rows",
                        None,
                        2,
                        offset as i64,
                        Some(order),
                        desc,
                        false,
                        false,
                    )
                    .await
                    .unwrap();
                assert_eq!(page.rows.len(), 2);
                rows.extend(keys(&page));
            }
            assert_eq!(rows, expected, "{order} desc={desc}");
        }
    }

    for order in [None, Some("unknown")] {
        let page = adapter
            .fetch_rows("a21", "plain", None, 2, 2, order, true, false, false)
            .await
            .unwrap();
        assert_eq!(keys(&page), [(1, 3), (2, 1)]);
    }
    let page = adapter
        .fetch_rows(
            "a21",
            "unkeyed",
            None,
            3,
            0,
            Some(SCORE),
            true,
            false,
            false,
        )
        .await
        .unwrap();
    let values: Vec<_> = page.rows.iter().map(|row| row[SCORE].as_i64()).collect();
    assert_eq!(values, [None, Some(3), Some(1)]);
}

async fn check_active_transaction(database: &str) {
    let url = owned_url(&std::env::var("L8DB_A01_LOCAL_PG_URL").unwrap(), database).unwrap();
    let tx = create_transaction_state();
    let id = tx
        .begin(DatabaseKind::Postgres, &url, None, &create_pool_state())
        .await
        .unwrap();
    let mut keys_in_transaction = Vec::new();
    for offset in (0..8).step_by(2) {
        let page = tx
            .fetch_rows(
                &id,
                TransactionTableRead {
                    schema: "a21".into(),
                    table: "ordered rows".into(),
                    filter: Some("\"Tenant ID\" > 0".into()),
                    order_by: Some(SCORE.into()),
                    order_desc: true,
                    offset,
                    limit: 2,
                    is_view: false,
                    allow_raw: false,
                },
            )
            .await
            .unwrap();
        keys_in_transaction.extend(keys(&page));
    }
    tx.rollback(&id).await.unwrap();
    assert_eq!(keys_in_transaction, HIGH_FIRST);
}

async fn check_page_latency(adapter: &dyn DatabaseAdapter) {
    let mut samples = Vec::with_capacity(11);
    for run in 0..13 {
        let started = Instant::now();
        let result = adapter
            .fetch_rows(
                "a21",
                "load_rows",
                None,
                100,
                25_000,
                Some("grade"),
                false,
                false,
                false,
            )
            .await
            .unwrap();
        let elapsed = started.elapsed().as_secs_f64() * 1_000.0;
        assert_eq!(result.rows.len(), 100);
        assert!(serde_json::to_vec(&result.rows).unwrap().len() < 10_000);
        if run >= 2 {
            samples.push(elapsed);
        }
    }
    samples.sort_by(f64::total_cmp);
    let median = samples[5];
    let p95 = samples[10];
    println!("A21 PostgreSQL: 50000 fixture rows, offset 25000, 100 returned, 11 samples, median={median:.3}ms p95={p95:.3}ms");
    assert!(median < 100.0 && p95 < 250.0, "{samples:?}");
}

#[tokio::test]
#[ignore = "requires scripts/test-postgres-arrays-local.sh --paging-test"]
async fn a21_postgres_table_paging() {
    let (adapter, _, database) = open_owned_fixture().await.unwrap();
    adapter
        .execute_query(
            r#"CREATE SCHEMA a21;
           CREATE TABLE a21."ordered rows" (
               "Tenant ID" integer, "Key""Part" integer, "Score Value" integer, note json,
               PRIMARY KEY ("Tenant ID", "Key""Part") INCLUDE (note)
           );
           INSERT INTO a21."ordered rows" ("Tenant ID", "Key""Part", "Score Value") VALUES
               (2,2,NULL),(2,1,10),(1,3,20),(1,1,10),(3,1,NULL),(2,3,10),(1,2,NULL),(3,2,20);
           CREATE TABLE a21.plain (
               "Tenant ID" integer, "Key""Part" integer, PRIMARY KEY ("Key""Part", "Tenant ID")
           );
           INSERT INTO a21.plain SELECT "Tenant ID", "Key""Part" FROM a21."ordered rows";
           CREATE TABLE a21.unkeyed ("Score Value" integer);
           INSERT INTO a21.unkeyed VALUES (1), (NULL), (3);
           CREATE TABLE a21.load_rows (id integer PRIMARY KEY, grade integer);
           INSERT INTO a21.load_rows SELECT n, CASE WHEN n % 11 > 0 THEN n % 10 END
               FROM generate_series(50000, 1, -1) n;
           ANALYZE a21.load_rows;"#,
        )
        .await
        .unwrap();

    check_paging(adapter.as_ref()).await;
    check_active_transaction(&database).await;
    check_page_latency(adapter.as_ref()).await;
}
