use std::time::{Duration, Instant};

use tokio::time::{sleep, timeout};
use tokio_postgres::{Client, NoTls};

use super::{PostgresAdapter, SESSIONS_SQL};
use crate::array_editor_target::{open_owned_fixture, owned_url};
use crate::db::pool::create_pool_state;
use crate::db::{DatabaseAdapter, SessionInfo};

async fn connect(url: &str) -> Client {
    let (client, connection) = tokio_postgres::connect(url, NoTls).await.unwrap();
    tokio::spawn(async move { connection.await.unwrap() });
    client
}

async fn pid(client: &Client) -> i32 {
    client
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .unwrap()
        .get(0)
}

fn session(rows: &[SessionInfo], pid: i32) -> &SessionInfo {
    rows.iter().find(|row| row.pid == pid).unwrap()
}

async fn until_progress(monitor: &PostgresAdapter, target: i32, phase: &str) -> Vec<SessionInfo> {
    timeout(Duration::from_secs(5), async {
        loop {
            let rows = monitor.list_sessions().await.unwrap();
            if session(&rows, target)
                .index_progress
                .as_ref()
                .is_some_and(|progress| progress.phase == phase)
            {
                return rows;
            }
            sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("PID {target} did not report {phase}"))
}

#[tokio::test]
#[ignore = "scripts/test-postgres-arrays-local.sh --index-progress-test creates a private PostgreSQL lab"]
async fn a27_index_progress_matches_native_session_and_disappears() {
    let (_, _, database) = open_owned_fixture().await.unwrap();
    let url = owned_url(&std::env::var("L8DB_A01_LOCAL_PG_URL").unwrap(), &database).unwrap();
    let admin = connect(&url).await;
    admin
        .batch_execute(
            "CREATE SCHEMA a27;
             CREATE TABLE a27.items (value integer, padding text);
             INSERT INTO a27.items SELECT i, repeat('x', 64) FROM generate_series(1, 2000) i;
             CREATE ROLE a27_observer;",
        )
        .await
        .unwrap();

    let monitor = PostgresAdapter::from_connection_string(&url, None, create_pool_state()).unwrap();
    let observer_url = format!("{url}&options=-c%20role%3Da27_observer");
    let observer =
        PostgresAdapter::from_connection_string(&observer_url, None, create_pool_state()).unwrap();

    let writer = connect(&url).await;
    let writer_pid = pid(&writer).await;
    writer
        .batch_execute("BEGIN; UPDATE a27.items SET value = value WHERE value = 1")
        .await
        .unwrap();
    let builder = connect(&url).await;
    let builder_pid = pid(&builder).await;
    builder
        .batch_execute("SET statement_timeout = '15s'")
        .await
        .unwrap();
    let build = tokio::spawn(async move {
        builder
            .batch_execute("CREATE INDEX CONCURRENTLY a27_value ON a27.items (value)")
            .await
            .unwrap();
        builder
    });

    let rows = until_progress(&monitor, builder_pid, "waiting for writers before build").await;
    let build_row = session(&rows, builder_pid);
    let progress = build_row.index_progress.as_ref().unwrap();
    assert_eq!(build_row.database, database);
    assert_eq!(
        progress.command.as_deref(),
        Some("CREATE INDEX CONCURRENTLY")
    );
    assert_eq!(progress.counters.len(), 1);
    assert_eq!(progress.counters[0].done, "0");
    assert_eq!(progress.counters[0].total.as_deref(), Some("1"));
    assert!(matches!(
        progress.counters[0].unit,
        crate::db::IndexProgressUnit::Lockers
    ));
    assert!(session(&rows, writer_pid).index_progress.is_none());
    assert!(
        session(&observer.list_sessions().await.unwrap(), builder_pid)
            .index_progress
            .is_none()
    );

    let serialized = serde_json::to_value(build_row).unwrap();
    let full_size = serde_json::to_vec(&serialized).unwrap().len();
    let mut base = serialized;
    base.as_object_mut().unwrap().remove("index_progress");
    let progress_bytes = full_size - serde_json::to_vec(&base).unwrap().len();
    assert!(progress_bytes <= 320);

    admin
        .batch_execute("REVOKE SELECT ON pg_catalog.pg_stat_progress_create_index FROM PUBLIC")
        .await
        .unwrap();
    for _ in 0..2 {
        let restricted = observer.list_sessions().await.unwrap();
        assert!(session(&restricted, builder_pid).index_progress.is_none());
        assert!(restricted.iter().any(|row| row.is_self));
    }
    admin
        .batch_execute("GRANT SELECT ON pg_catalog.pg_stat_progress_create_index TO PUBLIC")
        .await
        .unwrap();

    writer.batch_execute("COMMIT").await.unwrap();
    let finished = timeout(Duration::from_secs(6), build)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pid(&finished).await, builder_pid);
    let finished_rows = monitor.list_sessions().await.unwrap();
    assert!(session(&finished_rows, builder_pid)
        .index_progress
        .is_none());

    admin
        .batch_execute(
            "ALTER VIEW pg_catalog.pg_stat_progress_create_index RENAME TO a27_progress_hidden",
        )
        .await
        .unwrap();
    for _ in 0..2 {
        let fallback = monitor.list_sessions().await.unwrap();
        assert!(session(&fallback, builder_pid).index_progress.is_none());
        assert!(fallback.iter().any(|row| row.is_self));
    }
    admin
        .batch_execute(
            "ALTER VIEW pg_catalog.a27_progress_hidden RENAME TO pg_stat_progress_create_index",
        )
        .await
        .unwrap();

    let monitor = PostgresAdapter::from_connection_string(&url, None, create_pool_state()).unwrap();
    monitor.list_sessions().await.unwrap();
    let mut plain = Vec::new();
    let mut enriched = Vec::new();
    for _ in 0..10 {
        let start = Instant::now();
        assert!(!admin.query(SESSIONS_SQL, &[]).await.unwrap().is_empty());
        plain.push(start.elapsed().as_secs_f64() * 1000.0);
        let start = Instant::now();
        assert!(!monitor.list_sessions().await.unwrap().is_empty());
        enriched.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    plain.sort_by(f64::total_cmp);
    enriched.sort_by(f64::total_cmp);
    assert!(enriched[9] < 120.0);
    println!(
        "A27 PostgreSQL sessions, baseline SQL median {:.3} ms/p95 {:.3} ms, adapter median {:.3} ms/p95 {:.3} ms, active IPC enrichment {progress_bytes} bytes",
        plain[5], plain[9], enriched[5], enriched[9]
    );
}
