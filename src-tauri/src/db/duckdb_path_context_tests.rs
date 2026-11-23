use super::{file_path_context, lit, FILE_PATH_CONTEXT_MAX_BYTES};
use crate::db::{
    create_adapter_from_string, pool::create_pool_state, DatabaseAdapter, DatabaseKind,
    DuckdbFilePathContext,
};
use serde_json::{json, Value};

async fn cell(adapter: &dyn DatabaseAdapter, sql: &str) -> Value {
    adapter.execute_query(sql).await.unwrap().rows[0]["answer"].clone()
}

#[tokio::test]
async fn embedded_duckdb_resolves_local_inputs_with_the_query_sessions_setting() {
    let pools = create_pool_state();
    let connection = || {
        create_adapter_from_string(DatabaseKind::Duckdb, ":memory:", None, pools.clone()).unwrap()
    };
    let query = connection();
    let another = create_adapter_from_string(
        DatabaseKind::Duckdb,
        ":memory:",
        Some("separate"),
        pools.clone(),
    )
    .unwrap();
    let setting = "SELECT current_setting('file_search_path') AS answer";
    assert_eq!(cell(query.as_ref(), setting).await, json!(""));
    let cwd = std::env::current_dir().unwrap();
    let default_fixture = tempfile::Builder::new()
        .prefix(".a35-")
        .tempdir_in(&cwd)
        .unwrap();
    std::fs::write(default_fixture.path().join("default.csv"), "n\n17\n").unwrap();
    let relative = format!(
        "{}/default.csv",
        default_fixture
            .path()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
    );
    assert_eq!(
        cell(
            query.as_ref(),
            &format!("SELECT n AS answer FROM read_csv({})", lit(&relative))
        )
        .await,
        json!(17),
    );

    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let file = format!(
        "{}.csv",
        default_fixture
            .path()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
    );
    std::fs::write(second.path().join(&file), "n\n23\n").unwrap();
    let configured = format!("{},{}", first.path().display(), second.path().display());
    query
        .execute_query(&format!("SET file_search_path = {}", lit(&configured)))
        .await
        .unwrap();
    let query = connection();
    assert_eq!(cell(query.as_ref(), setting).await, json!(configured));
    assert_eq!(
        cell(
            query.as_ref(),
            &format!("SELECT n AS answer FROM read_csv({})", lit(&file))
        )
        .await,
        json!(23),
    );
    assert_eq!(cell(another.as_ref(), setting).await, json!(""));
    let mut tx = query.begin_transaction().await.unwrap();
    tx.execute("SET file_search_path = 'fixture-transaction'")
        .await
        .unwrap();
    let local = tx.execute(setting).await.unwrap();
    assert_eq!(local.rows[0]["answer"], json!("fixture-transaction"));
    assert_eq!(cell(query.as_ref(), setting).await, json!(configured));
    tx.rollback().await.unwrap();
    println!("DuckDB engine {} used the process directory by default and the configured multi-root path on the shared session", cell(query.as_ref(), "SELECT version() AS answer").await);
}

#[tokio::test]
async fn context_does_not_open_a_file_or_initialize_a_connection() {
    let pools = create_pool_state();
    let directory = tempfile::tempdir().unwrap();
    let unopened = directory.path().join("unopened.duckdb");
    let url = format!("duckdb://{}", unopened.display());
    assert_eq!(
        file_path_context(&pools, &url, None).await,
        DuckdbFilePathContext::NoSession
    );
    assert!(!unopened.exists());

    let adapter =
        create_adapter_from_string(DatabaseKind::Duckdb, ":memory:", None, pools.clone()).unwrap();
    adapter.execute_query("SELECT 1").await.unwrap();
    assert_eq!(
        file_path_context(&pools, ":memory:", None).await,
        DuckdbFilePathContext::Snapshot {
            file_search_path: Some(String::new()),
            working_directory: std::env::current_dir()
                .unwrap()
                .into_os_string()
                .into_string()
                .ok(),
        },
    );
    assert_eq!(
        file_path_context(&pools, ":memory:", Some("other_database")).await,
        DuckdbFilePathContext::NoSession
    );
    let key = crate::db::connection::connection_key(":memory:", None);
    pools.remove_pool(&key).await;
    assert_eq!(
        file_path_context(&pools, ":memory:", None).await,
        DuckdbFilePathContext::NoSession
    );
}

#[tokio::test]
async fn snapshot_is_bounded_uses_the_query_connection_and_does_not_wait_for_its_lock() {
    let pools = create_pool_state();
    let adapter =
        create_adapter_from_string(DatabaseKind::Duckdb, ":memory:", None, pools.clone()).unwrap();
    let configured = "/synthetic/one,/synthetic/two";
    adapter
        .execute_query(&format!("SET file_search_path = {}", lit(configured)))
        .await
        .unwrap();

    let key = crate::db::connection::connection_key(":memory:", None);
    let shared = pools
        .ready_shared::<std::sync::Mutex<duckdb::Connection>>(&key)
        .await
        .unwrap();
    {
        let _guard = shared.lock().unwrap();
        assert_eq!(
            file_path_context(&pools, ":memory:", None).await,
            DuckdbFilePathContext::Busy
        );
    }

    let mut timings = Vec::new();
    for _ in 0..12 {
        let start = std::time::Instant::now();
        let result = file_path_context(&pools, ":memory:", None).await;
        timings.push(start.elapsed().as_secs_f64() * 1_000.0);
        assert!(matches!(
            result,
            DuckdbFilePathContext::Snapshot { file_search_path: Some(ref path), .. } if path == configured
        ));
    }
    timings.sort_by(f64::total_cmp);
    let median = (timings[5] + timings[6]) / 2.0;
    let p95 = timings[11];
    assert!(p95 < 250.0, "{timings:?}");
    println!("A35 DuckDB setting snapshot: 12 reads, median {median:.3} ms, p95 {p95:.3} ms");

    let long_path = "x".repeat(FILE_PATH_CONTEXT_MAX_BYTES + 1);
    adapter
        .execute_query(&format!("SET file_search_path = {}", lit(&long_path)))
        .await
        .unwrap();
    assert!(matches!(
        file_path_context(&pools, ":memory:", None).await,
        DuckdbFilePathContext::Snapshot {
            file_search_path: None,
            ..
        }
    ));
    assert_eq!(
        cell(
            adapter.as_ref(),
            "SELECT current_setting('file_search_path') AS answer"
        )
        .await,
        json!(long_path)
    );
}
