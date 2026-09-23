use std::future::Future;
use std::time::{Duration, Instant};

use super::execution::{self, ExecutionOptions};
use super::pool::create_pool_state;
use super::{create_adapter_from_string, DatabaseAdapter, DatabaseKind};

fn perf_url() -> String {
    std::env::var("L8DB_PERF_PG_URL")
        .unwrap_or_else(|_| "postgresql://leon@127.0.0.1:5432/l8db_perf".to_string())
}

async fn median<F, Fut, T>(runs: usize, mut run: F) -> Duration
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let mut samples = Vec::with_capacity(runs);
    for _ in 0..runs {
        let start = Instant::now();
        run().await.expect("query failed");
        samples.push(start.elapsed());
    }
    samples.sort();
    samples[runs / 2]
}

async fn table_open(adapter: &dyn DatabaseAdapter, table: &str) -> Result<(), String> {
    let (rows, count, columns, keys, views) = tokio::join!(
        adapter.fetch_rows("public", table, None, 100, 0, None, false, false, false),
        adapter.count_rows_capped("public", table, None, true, 100_000),
        adapter.list_table_columns_detailed("public", table),
        adapter.list_foreign_keys("public", table),
        adapter.list_views(Some("public")),
    );
    rows?;
    count?;
    columns?;
    keys?;
    views?;
    Ok(())
}

fn report(name: &str, duration: Duration) {
    println!("{name:<44} {:>10.1} ms", duration.as_secs_f64() * 1000.0);
}

#[tokio::test]
#[ignore]
async fn perf_table_loading() {
    let adapter = create_adapter_from_string(
        DatabaseKind::Postgres,
        &perf_url(),
        None,
        create_pool_state(),
    )
    .expect("adapter");
    let adapter = adapter.as_ref();
    let options = ExecutionOptions {
        query_timeout: Some(300),
        ..Default::default()
    };
    execution::run(Some(options), true, async {
        adapter.list_schemas().await?;
        report(
            "open big (parallel like frontend)",
            median(5, || table_open(adapter, "big")).await,
        );
        report(
            "open t_1 (parallel like frontend)",
            median(5, || table_open(adapter, "t_1")).await,
        );
        report(
            "rows big page 1 unsorted",
            median(7, || {
                adapter.fetch_rows("public", "big", None, 100, 0, None, false, false, false)
            })
            .await,
        );
        report(
            "rows big page 1 sorted by id (indexed)",
            median(7, || {
                adapter.fetch_rows(
                    "public",
                    "big",
                    None,
                    100,
                    0,
                    Some("id"),
                    false,
                    false,
                    false,
                )
            })
            .await,
        );
        report(
            "rows big page 1 sorted by name",
            median(3, || {
                adapter.fetch_rows(
                    "public",
                    "big",
                    None,
                    100,
                    0,
                    Some("name"),
                    false,
                    false,
                    false,
                )
            })
            .await,
        );
        report(
            "rows big offset 1M unsorted",
            median(3, || {
                adapter.fetch_rows(
                    "public", "big", None, 100, 1_000_000, None, false, false, false,
                )
            })
            .await,
        );
        report(
            "rows big offset 1M sorted by name",
            median(1, || {
                adapter.fetch_rows(
                    "public",
                    "big",
                    None,
                    100,
                    1_000_000,
                    Some("name"),
                    false,
                    false,
                    false,
                )
            })
            .await,
        );
        report(
            "rows t_1 page 1 unsorted",
            median(7, || {
                adapter.fetch_rows("public", "t_1", None, 100, 0, None, false, false, false)
            })
            .await,
        );
        report(
            "count big exact",
            median(3, || adapter.count_rows("public", "big", None, false)).await,
        );
        report(
            "count big filtered exact",
            median(3, || {
                adapter.count_rows("public", "big", Some("amount > 500"), false)
            })
            .await,
        );
        report(
            "count big capped 100k",
            median(3, || {
                adapter.count_rows_capped("public", "big", None, false, 100_000)
            })
            .await,
        );
        report(
            "count big filtered capped 100k",
            median(3, || {
                adapter.count_rows_capped("public", "big", Some("amount > 500"), false, 100_000)
            })
            .await,
        );
        report(
            "columns detailed big",
            median(7, || adapter.list_table_columns_detailed("public", "big")).await,
        );
        report(
            "foreign keys big",
            median(7, || adapter.list_foreign_keys("public", "big")).await,
        );
        report(
            "list tables public",
            median(5, || adapter.list_tables(Some("public"))).await,
        );
        report(
            "list views public",
            median(5, || adapter.list_views(Some("public"))).await,
        );
        Ok::<_, String>(())
    })
    .await
    .expect("perf run");
}

fn guard_url() -> String {
    std::env::var("L8DB_GUARD_PG_URL")
        .unwrap_or_else(|_| "postgresql://leon@127.0.0.1:5432/l8db_small".to_string())
}

async fn probe_count(probe: &tokio_postgres::Client, sql: &str) -> i64 {
    probe.query_one(sql, &[]).await.expect("probe").get(0)
}

#[tokio::test]
#[ignore]
async fn database_load_guards() {
    let url = guard_url();
    let pool = create_pool_state();
    let adapter = create_adapter_from_string(DatabaseKind::Postgres, &url, None, pool.clone())
        .expect("adapter");
    let (probe, connection) = tokio_postgres::connect(&url, tokio_postgres::NoTls)
        .await
        .expect("probe connection");
    tokio::spawn(connection);
    let table = format!("l8db_guard_{}", std::process::id());
    let target = format!("public.{table}");
    probe
        .batch_execute(&format!(
            "DROP TABLE IF EXISTS {target}; CREATE TABLE {target} (id int)"
        ))
        .await
        .expect("create table");
    let short = || {
        Some(ExecutionOptions {
            query_timeout: Some(5),
            ..Default::default()
        })
    };

    adapter.list_schemas().await.expect("schemas");
    assert!(
        probe_count(
            &probe,
            "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'l8db'"
        )
        .await
            > 0
    );
    let started = Instant::now();
    let error = execution::run(short(), true, adapter.execute_query("SELECT pg_sleep(60)"))
        .await
        .expect_err("timeout");
    assert!(error.contains("Query-Timeout"), "{error}");
    assert!(started.elapsed() < Duration::from_secs(15));
    assert_eq!(
        probe_count(&probe, "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query = 'SELECT pg_sleep(60)'").await,
        0
    );

    let (holder, connection) = tokio_postgres::connect(&url, tokio_postgres::NoTls)
        .await
        .expect("lock holder");
    tokio::spawn(connection);
    holder
        .batch_execute(&format!("BEGIN; LOCK TABLE {target} IN ACCESS SHARE MODE"))
        .await
        .expect("hold lock");
    let started = Instant::now();
    let error = execution::run(
        Some(ExecutionOptions {
            query_timeout: Some(60),
            ..Default::default()
        }),
        true,
        adapter.add_column(
            "public",
            &table,
            &super::AddColumnRequest {
                name: "blocked".into(),
                data_type: "int".into(),
                is_nullable: true,
                default_value: None,
            },
        ),
    )
    .await
    .expect_err("lock timeout");
    assert!(error.contains("55P03"), "{error}");
    assert!(started.elapsed() < Duration::from_secs(10));
    holder
        .batch_execute("ROLLBACK")
        .await
        .expect("release lock");

    adapter
        .validate_sql(&format!("INSERT INTO {target} VALUES (1)"))
        .await
        .expect("validate");
    assert!(adapter
        .validate_sql(&format!("INSERT INTO {target} VALUES (2); COMMIT"))
        .await
        .is_err());
    adapter
        .explain_query(&format!("INSERT INTO {target} VALUES (3)"), true)
        .await
        .expect("explain analyze");
    assert_eq!(
        probe_count(&probe, &format!("SELECT count(*) FROM {target}")).await,
        0
    );
    assert_eq!(
        probe_count(&probe, "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'l8db' AND state LIKE 'idle in transaction%'").await,
        0
    );

    probe
        .batch_execute(&format!(
            "INSERT INTO {target} SELECT g FROM generate_series(1, 50) g; ANALYZE {target}"
        ))
        .await
        .expect("seed");
    let capped = adapter
        .count_rows_capped("public", &table, None, false, 10)
        .await
        .expect("capped");
    assert_eq!(
        (capped.count, capped.exact, capped.estimate),
        (11, false, Some(50))
    );
    assert_eq!(
        adapter
            .count_rows_capped("public", &table, Some("id <= 5"), false, 10)
            .await
            .expect("filtered exact"),
        super::RowCount::exact(5)
    );
    let filtered = adapter
        .count_rows_capped("public", &table, Some("id > 5"), false, 10)
        .await
        .expect("filtered capped");
    assert_eq!(
        (filtered.count, filtered.exact, filtered.estimate),
        (11, false, None)
    );

    let transactions = super::transaction::create_transaction_state();
    let tx = transactions
        .begin(DatabaseKind::Postgres, &url, None, &pool)
        .await
        .expect("begin");
    let setting = transactions
        .execute(&tx, "SHOW idle_in_transaction_session_timeout")
        .await
        .expect("show");
    assert!(
        setting.rows[0].to_string().contains("30min"),
        "{:?}",
        setting.rows
    );
    let pid = transactions
        .execute(&tx, "SELECT pg_backend_pid()::text AS pid")
        .await
        .expect("pid");
    let pid = pid.rows[0]["pid"].as_str().expect("pid text").to_string();
    probe
        .batch_execute(&format!("SELECT pg_terminate_backend({pid})"))
        .await
        .expect("terminate");
    tokio::time::sleep(Duration::from_millis(300)).await;
    let error = transactions
        .commit(&tx)
        .await
        .expect_err("commit after kill");
    assert!(error.contains("Sitzung beendet"), "{error}");
    transactions.rollback(&tx).await.expect("rollback clears");

    probe
        .batch_execute(&format!("DROP TABLE {target}"))
        .await
        .expect("drop table");
}
