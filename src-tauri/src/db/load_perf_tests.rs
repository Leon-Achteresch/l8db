use std::future::Future;
use std::time::{Duration, Instant};

use super::execution::{self, ExecutionOptions};
use super::pool::create_pool_state;
use super::{create_adapter_from_string, DatabaseAdapter, DatabaseKind};

fn perf_url() -> String {
    std::env::var("L8DB_PERF_PG_URL")
        .unwrap_or_else(|_| "postgresql://leon@127.0.0.1:5432/l8db_perf".to_string())
}

async fn report<F, Fut, T>(name: &str, mut run: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    const RUNS: usize = 21;
    run().await.expect("warmup failed");
    let mut samples = Vec::with_capacity(RUNS);
    for _ in 0..RUNS {
        let start = Instant::now();
        run().await.expect("query failed");
        samples.push(start.elapsed());
    }
    samples.sort();
    println!(
        "{name:<44} median {:>8.2} ms, p95 {:>8.2} ms ({RUNS} runs)",
        samples[RUNS / 2].as_secs_f64() * 1000.0,
        samples[(RUNS * 95).div_ceil(100) - 1].as_secs_f64() * 1000.0,
    );
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
        report("open big (parallel like frontend)", || {
            table_open(adapter, "big")
        })
        .await;
        report("open t_1 (parallel like frontend)", || {
            table_open(adapter, "t_1")
        })
        .await;
        report("rows big page 1 unsorted", || {
            adapter.fetch_rows("public", "big", None, 100, 0, None, false, false, false)
        })
        .await;
        report("rows big page 1 sorted by id (indexed)", || {
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
        .await;
        report("rows big page 1 sorted by name", || {
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
        .await;
        report("rows big offset 1M unsorted", || {
            adapter.fetch_rows(
                "public", "big", None, 100, 1_000_000, None, false, false, false,
            )
        })
        .await;
        report("rows big offset 1M sorted by name", || {
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
        .await;
        report("rows t_1 page 1 unsorted", || {
            adapter.fetch_rows("public", "t_1", None, 100, 0, None, false, false, false)
        })
        .await;
        report("count big exact", || {
            adapter.count_rows("public", "big", None, false)
        })
        .await;
        report("count big filtered exact", || {
            adapter.count_rows("public", "big", Some("amount > 500"), false)
        })
        .await;
        report("count big capped 100k", || {
            adapter.count_rows_capped("public", "big", None, false, 100_000)
        })
        .await;
        report("count big filtered capped 100k", || {
            adapter.count_rows_capped("public", "big", Some("amount > 500"), false, 100_000)
        })
        .await;
        report("columns detailed big", || {
            adapter.list_table_columns_detailed("public", "big")
        })
        .await;
        report("foreign keys big", || {
            adapter.list_foreign_keys("public", "big")
        })
        .await;
        report("list tables public", || adapter.list_tables(Some("public"))).await;
        report("list views public", || adapter.list_views(Some("public"))).await;
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

async fn deep_forward_pages(
    kind: DatabaseKind,
    url_env: &str,
    schema: &str,
    table: &str,
    id: &str,
    name: &str,
) {
    let url = std::env::var(url_env).expect("set fixture URL");
    let adapter = create_adapter_from_string(kind, &url, None, create_pool_state()).unwrap();
    let make_request = |order: &str, offset| super::transaction::TransactionTableRead {
        schema: schema.into(),
        table: table.into(),
        filter: None,
        limit: 100,
        offset,
        order_by: Some(order.into()),
        order_desc: false,
        is_view: false,
        allow_raw: false,
    };
    for (col, desc) in [(name, false), (id, false), (id, true), (name, true)] {
        let mut request = make_request(col, 1_000_000);
        request.order_desc = desc;
        let before = adapter
            .fetch_rows(
                schema,
                table,
                None,
                100,
                request.offset - 100,
                Some(col),
                desc,
                false,
                false,
            )
            .await
            .unwrap();
        let last = before.rows.last().unwrap();
        let anchor = super::PageBoundary {
            key: id.into(),
            value: last[id].as_i64().unwrap(),
            sort_text: (col != id).then(|| last[col].as_str().unwrap().into()),
        };
        let expected = adapter
            .fetch_rows(
                schema,
                table,
                None,
                100,
                request.offset,
                Some(col),
                desc,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(expected.rows.len(), 100);
        assert!(expected.rows.iter().all(|row| row["__ctid__"].is_string()));
        let mut jumps = Vec::new();
        let mut forward = Vec::new();
        for n in 0..22 {
            for pass in 0..2 {
                let seek = (pass + n) % 2 == 0;
                let start = Instant::now();
                let page = if seek {
                    adapter.fetch_rows_after(&request, &anchor).await
                } else {
                    adapter
                        .fetch_rows(
                            schema,
                            table,
                            None,
                            100,
                            request.offset,
                            Some(col),
                            desc,
                            false,
                            false,
                        )
                        .await
                }
                .unwrap();
                let elapsed = start.elapsed();
                assert_eq!(page.rows, expected.rows);
                assert_eq!(page.columns, expected.columns);
                if n > 0 {
                    if seek {
                        forward.push(elapsed);
                    } else {
                        jumps.push(elapsed);
                    }
                }
            }
        }
        for (mode, mut samples, budget) in [("jump", jumps, 300), ("forward", forward, 20)] {
            samples.sort();
            println!(
                "{kind:?} {mode} {col} desc={desc} median {:?} p95 {:?}",
                samples[10], samples[19]
            );
            assert!(
                samples[19] < Duration::from_millis(budget),
                "{kind:?} {mode} {col}: {samples:?}"
            );
        }
        let invalid = super::PageBoundary {
            key: "missing".into(),
            value: -1,
            sort_text: None,
        };
        let fallback = adapter.fetch_rows_after(&request, &invalid).await.unwrap();
        assert_eq!(fallback.rows, expected.rows);
    }
}

#[tokio::test]
#[ignore = "requires indexed two-million-row BIG fixture"]
async fn deep_forward_postgres() {
    deep_forward_pages(
        DatabaseKind::Postgres,
        "L8DB_PERF_PG_URL",
        "public",
        "big",
        "id",
        "name",
    )
    .await;
}

#[tokio::test]
#[ignore = "requires indexed two-million-row BIG fixture and Oracle Instant Client"]
async fn deep_forward_oracle() {
    deep_forward_pages(
        DatabaseKind::Oracle,
        "L8DB_PERF_ORACLE_URL",
        "L8DB",
        "BIG",
        "ID",
        "NAME",
    )
    .await;
}
