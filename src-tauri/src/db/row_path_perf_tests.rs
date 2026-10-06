use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use super::commands::{capped_query, MAX_RESULT_ROWS};
use super::pool::create_pool_state;
use super::{create_adapter_from_string, DatabaseAdapter, DatabaseKind, QueryResult};

struct Counting;

static ALLOCATIONS: AtomicU64 = AtomicU64::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        System.realloc(ptr, layout, size)
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

const ROWS: usize = 100_000;

const SEED: &str = "CREATE TABLE wide (id INTEGER PRIMARY KEY, i1 INTEGER, i2 INTEGER, i3 INTEGER, i4 INTEGER, r1 REAL, r2 REAL, r3 REAL, t1 TEXT, t2 TEXT, t3 TEXT, t4 TEXT, t5 TEXT, b1 BLOB, n1 TEXT, n2 INTEGER, d1 TEXT, d2 TEXT, big INTEGER, flag INTEGER);
WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < 100000)
INSERT INTO wide SELECT i, i * 3, i % 97, -i, i * i, i * 0.5, i / 7.0, 1.0 / i, 'name_' || i, 'user' || i || '@example.com', printf('%08d', i), 'lorem ipsum dolor sit amet', upper(hex(i)), CAST('blob' || i AS BLOB), NULL, CASE WHEN i % 2 = 0 THEN i END, date('2024-01-01', '+' || (i % 365) || ' days'), '2024-01-01T00:00:00Z', 9007199254740993 + i, i % 2 FROM s;";

async fn seeded_sqlite(rows: usize) -> Box<dyn DatabaseAdapter> {
    let adapter =
        create_adapter_from_string(DatabaseKind::Sqlite, ":memory:", None, create_pool_state())
            .expect("adapter");
    for statement in SEED.replace("100000", &rows.to_string()).split(";\n") {
        adapter.execute_query(statement).await.expect("seed");
    }
    adapter
}

struct Sample {
    time: Duration,
    allocations: u64,
    bytes: usize,
    rows: usize,
}

async fn measure<F, Fut, T>(runs: usize, mut run: F) -> Sample
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
    T: serde::Serialize,
{
    let mut best: Option<Sample> = None;
    for _ in 0..runs {
        let before = ALLOCATIONS.load(Ordering::Relaxed);
        let start = Instant::now();
        let value = run().await.expect("query");
        let json = serde_json::to_vec(&value).expect("json");
        let time = start.elapsed();
        let allocations = ALLOCATIONS.load(Ordering::Relaxed) - before;
        let rows = serde_json::from_slice::<serde_json::Value>(&json)
            .ok()
            .and_then(|v| v.get("rows").and_then(|r| r.as_array()).map(Vec::len))
            .unwrap_or(0);
        let sample = Sample {
            time,
            allocations,
            bytes: json.len(),
            rows,
        };
        if best.as_ref().is_none_or(|b| sample.time < b.time) {
            best = Some(sample);
        }
    }
    best.expect("runs")
}

fn report(name: &str, sample: &Sample) {
    println!(
        "{name:<46} {:>9.2} ms {:>10} allocs {:>10} bytes {:>7} rows",
        sample.time.as_secs_f64() * 1000.0,
        sample.allocations,
        sample.bytes,
        sample.rows
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn perf_row_path() {
    let sqlite = seeded_sqlite(ROWS).await;
    let sqlite = sqlite.as_ref();
    report(
        "sqlite execute_query SELECT * (100k x 20)",
        &measure(5, || {
            capped_query(sqlite.execute_query("SELECT * FROM wide"))
        })
        .await,
    );
    report(
        "sqlite fetch_rows page 5000",
        &measure(5, || {
            sqlite.fetch_rows("main", "wide", None, 5000, 0, None, false, false, false)
        })
        .await,
    );
    report(
        "sqlite fetch_rows page 100",
        &measure(5, || {
            sqlite.fetch_rows("main", "wide", None, 100, 0, None, false, false, false)
        })
        .await,
    );
    report(
        "sqlite count_rows",
        &measure(5, || sqlite.count_rows("main", "wide", None, false)).await,
    );

    #[cfg(feature = "duckdb")]
    {
        let duck =
            create_adapter_from_string(DatabaseKind::Duckdb, ":memory:", None, create_pool_state())
                .expect("duckdb");
        duck.execute_query(&format!(
            "CREATE TABLE wide AS SELECT i AS id, i * 3 AS i1, i % 97 AS i2, -i AS i3, i * i AS i4, i * 0.5 AS r1, i / 7.0 AS r2, 1.0 / i AS r3, 'name_' || i AS t1, 'user' || i || '@example.com' AS t2, printf('%08d', i) AS t3, 'lorem ipsum dolor sit amet' AS t4, upper(hex(i)) AS t5, ('blob' || i)::BLOB AS b1, NULL::VARCHAR AS n1, CASE WHEN i % 2 = 0 THEN i END AS n2, DATE '2024-01-01' + (i % 365)::INTEGER AS d1, TIMESTAMP '2024-01-01 00:00:00' AS d2, 9007199254740993 + i AS big, i % 2 = 0 AS flag FROM range(1, {}) t(i)",
            ROWS + 1
        ))
        .await
        .expect("seed duckdb");
        let duck = duck.as_ref();
        report(
            "duckdb execute_query SELECT * (100k x 20)",
            &measure(5, || capped_query(duck.execute_query("SELECT * FROM wide"))).await,
        );
    }
}

#[tokio::test]
async fn execute_query_stops_reading_after_the_result_cap() {
    let sqlite = seeded_sqlite(1).await;
    let probe = format!(
        "WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < 100000) SELECT CASE WHEN i > {} THEN abs(-9223372036854775807 - 1 + 0 * i) ELSE i END AS v, 'x' AS w FROM s",
        MAX_RESULT_ROWS + 1
    );
    let result: QueryResult = capped_query(sqlite.execute_query(&probe))
        .await
        .expect("capped query must not evaluate rows past the cap");
    assert!(result.truncated);
    assert_eq!(result.rows.len(), MAX_RESULT_ROWS);
    assert_eq!(
        result.rows[MAX_RESULT_ROWS - 1]["v"],
        MAX_RESULT_ROWS as i64
    );
    assert!(sqlite.execute_query(&probe).await.is_err());

    let small = capped_query(sqlite.execute_query("SELECT * FROM wide"))
        .await
        .expect("small query");
    assert!(!small.truncated);
    assert_eq!(small.rows.len(), 1);
}
