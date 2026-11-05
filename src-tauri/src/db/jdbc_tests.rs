use super::*;
use serde_json::json;

static LIFECYCLE: Mutex<()> = Mutex::const_new(());

fn input() -> JdbcProfileInput {
    JdbcProfileInput {
        id: None,
        name: "Test".into(),
        driver_class: "org.h2.Driver".into(),
        jars: vec!["abc123".into()],
        url: "jdbc:h2:mem:test".into(),
        username: "sa".into(),
        password: None,
        read_only: true,
    }
}

#[test]
fn validates_profiles_and_rejects_inline_secrets_and_path_traversal() {
    assert!(validate(&input()).is_ok());
    for url in [
        "jdbc:h2:mem:test;PASSWORD=secret",
        "jdbc:postgresql://name:secret@host/db",
        "jdbc:postgresql://host/db?token=secret",
        "jdbc:postgresql://host/db?pass%77ord=secret",
        "jdbc:oracle:thin:user/secret@host:1521/db",
        "jdbc:h2:mem:test\n",
    ] {
        let mut profile = input();
        profile.url = url.into();
        assert!(validate(&profile).is_err(), "{url}");
    }
    for id in ["", "../outside", "file.jar", "a/b", "a\\b", "a:b"] {
        assert!(!valid_id(id));
    }
    assert!(valid_id("driver_123-abc"));
    let temporary = tempfile::tempdir().unwrap();
    assert!(jar_path(temporary.path(), "../outside").is_err());
}

#[test]
fn detects_supported_jdk_without_accepting_jre_or_java_11() {
    assert!(supported_java_modules(
        "java.base@17.0.1\njdk.compiler@17.0.1\n"
    ));
    assert!(supported_java_modules(
        "java.base@21.0.13\njdk.compiler@21.0.13\n"
    ));
    assert!(!supported_java_modules(
        "java.base@11.0.20\njdk.compiler@11.0.20\n"
    ));
    assert!(!supported_java_modules("java.base@21.0.13\n"));
    assert!(!supported_java_modules("unrecognized java output"));
}

#[test]
fn frames_preserve_tabs_newlines_unicode_and_bound_requests() {
    let fields = vec![
        "query".into(),
        "SELECT '\t\n🚲'".into(),
        "Ssecret\nvalue".into(),
    ];
    let frame = encode_request(&fields).unwrap();
    assert_eq!(frame.iter().filter(|byte| **byte == b'\n').count(), 1);
    let decoded = std::str::from_utf8(&frame)
        .unwrap()
        .trim_end_matches('\n')
        .split('\t')
        .map(|field| {
            String::from_utf8(
                base64::engine::general_purpose::STANDARD
                    .decode(field)
                    .unwrap(),
            )
            .unwrap()
        })
        .collect::<Vec<_>>();
    assert_eq!(decoded, fields);
    assert!(!String::from_utf8_lossy(&frame).contains("secret"));
    assert!(encode_request(&vec![String::new(); 4097]).is_err());
    assert!(encode_request(&["x".repeat(MAX_REQUEST)]).is_err());
}

#[tokio::test]
async fn response_framing_rejects_oversize_incomplete_and_malformed_frames() {
    let valid = b"{\"ok\":true}\n{\"ok\":false}\n";
    let mut reader = BufReader::new(&valid[..]);
    assert_eq!(
        read_frame(&mut reader).await.unwrap(),
        json!({ "ok": true })
    );
    assert_eq!(
        read_frame(&mut reader).await.unwrap(),
        json!({ "ok": false })
    );
    assert!(read_frame(&mut BufReader::new(&b"not-json\n"[..]))
        .await
        .is_err());
    assert!(read_frame(&mut BufReader::new(&b"{\"ok\":true}"[..]))
        .await
        .is_err());
    let oversized = vec![b'a'; MAX_FRAME + 1];
    assert!(read_frame(&mut BufReader::new(&oversized[..]))
        .await
        .unwrap_err()
        .contains("8 MiB"));
}

#[test]
fn result_decoding_keeps_duplicate_columns_and_rejects_misaligned_rows() {
    let result = decode_result(json!({ "columns": ["id", "id"], "rows": [[1, 2]], "rows_affected": null, "execution_time_ms": 2, "truncated": false })).unwrap();
    assert_eq!(result.columns, ["id", "id1"]);
    assert_eq!(result.rows, [json!({ "id": 1, "id1": 2 })]);
    assert!(decode_result(json!({ "columns": ["id"], "rows": [[1, 2]], "rows_affected": null, "execution_time_ms": 0, "truncated": false })).is_err());
}

#[tokio::test]
async fn profile_cache_is_bounded_and_idle_slots_are_retired_without_database_reads() {
    let _guard = LIFECYCLE.lock().await;
    let temporary = tempfile::tempdir().unwrap();
    let mut slots = Vec::new();
    for index in 0..MAX_WORKERS {
        slots.push(
            worker(temporary.path(), &format!("profile-{index}"))
                .await
                .unwrap(),
        );
    }
    assert!(worker(temporary.path(), "extra").await.is_err());
    assert!(Arc::ptr_eq(
        &worker(temporary.path(), "profile-0").await.unwrap(),
        &slots[0]
    ));
    assert!(!retire_idle(&worker_key(temporary.path(), "profile-0"), &slots[0]).await);
    slots[0].state.lock().await.touched = Instant::now() - IDLE - Duration::from_secs(1);
    assert!(retire_idle(&worker_key(temporary.path(), "profile-0"), &slots[0]).await);
    assert!(slots[0].cancel.is_cancelled());
    assert!(slots[0].state.lock().await.bridge.is_none());
    assert!(worker(temporary.path(), "extra").await.is_ok());
    for index in 0..MAX_WORKERS {
        close_profile(temporary.path(), &format!("profile-{index}")).await;
    }
    close_profile(temporary.path(), "extra").await;
    assert!(workers().lock().await.is_empty());
}

fn live_profile(root: &Path, jar: &Path, driver: &str, url: String, username: &str) -> JdbcProfile {
    let jar = import_jar(root, jar).unwrap();
    JdbcProfile {
        id: format!("test-{:032x}", rand::random::<u128>()),
        name: "JDBC live test".into(),
        driver_class: driver.into(),
        jars: vec![jar.id],
        url,
        username: username.into(),
        read_only: false,
        has_password: false,
    }
}

fn fixture_jar(variable: &str) -> PathBuf {
    PathBuf::from(
        std::env::var_os(variable)
            .unwrap_or_else(|| panic!("{variable} must point to the official test driver JAR")),
    )
}

async fn requests(slot: &Arc<WorkerSlot>) -> u64 {
    slot.state
        .lock()
        .await
        .bridge
        .as_ref()
        .map_or(0, |bridge| bridge.requests)
}

#[tokio::test]
#[ignore = "needs JDK17+ in JAVA_HOME and L8DB_JDBC_TEST_JAR pointing to H2"]
async fn live_h2_metadata_prepared_queries_bounded_results_performance_and_idle() {
    let _guard = LIFECYCLE.lock().await;
    assert!(available().await, "JDK17+ with compiler required");
    let temporary = tempfile::tempdir().unwrap();
    let profile = live_profile(
        temporary.path(),
        &fixture_jar("L8DB_JDBC_TEST_JAR"),
        "org.h2.Driver",
        format!("jdbc:h2:mem:l8db_{}", rand::random::<u64>()),
        "sa",
    );
    save_profiles(temporary.path(), std::slice::from_ref(&profile)).unwrap();
    let adapter = JdbcAdapter {
        root: temporary.path().to_path_buf(),
        id: profile.id.clone(),
    };
    adapter.test_connection().await.unwrap();
    adapter
        .execute_query("CREATE SCHEMA \"APP\"")
        .await
        .unwrap();
    adapter.execute_query("CREATE TABLE \"APP\".\"items\" (\"id\" BIGINT PRIMARY KEY, \"label\" VARCHAR(80), \"payload\" CLOB)").await.unwrap();
    adapter.execute_query("INSERT INTO \"APP\".\"items\" SELECT X, 'row-' || X, RPAD('x', 128, 'x') FROM SYSTEM_RANGE(1, 100000)").await.unwrap();
    assert!(adapter
        .list_schemas()
        .await
        .unwrap()
        .iter()
        .any(|schema| schema == "APP"));
    assert!(adapter
        .list_tables(Some("APP"))
        .await
        .unwrap()
        .iter()
        .any(|table| table.name == "items"));
    assert_eq!(
        adapter
            .list_columns(Some("APP"), Some("items"), None)
            .await
            .unwrap()
            .len(),
        3
    );
    assert!(adapter
        .list_table_columns_detailed("APP", "items")
        .await
        .unwrap()
        .iter()
        .any(|column| column.name == "id" && column.is_primary_key));
    assert_eq!(
        adapter
            .count_rows("APP", "items", None, false)
            .await
            .unwrap(),
        100_000
    );
    let page = adapter
        .fetch_rows(
            "APP",
            "items",
            Some("\"id\" > 10"),
            100,
            50,
            Some("id"),
            false,
            false,
            false,
        )
        .await
        .unwrap();
    assert_eq!(page.rows.len(), 100);
    assert_eq!(page.rows[0]["id"], 61);
    let injection = "a'; DROP TABLE items; --\t\n🚲";
    let bound = adapter
        .execute_query_with_params(
            "SELECT CAST(? AS VARCHAR) AS \"value\"",
            &[Some(injection.into())],
        )
        .await
        .unwrap();
    assert_eq!(bound.rows[0]["value"], injection);
    let precise = adapter.execute_query("SELECT CAST('-9223372036854775808' AS BIGINT) AS \"min\", CAST('9223372036854775807' AS BIGINT) AS \"max\", CAST('1234567890.12345678901234567890' AS DECIMAL(30,20)) AS \"decimal\"").await.unwrap();
    assert_eq!(precise.rows[0]["min"], "-9223372036854775808");
    assert_eq!(precise.rows[0]["max"], "9223372036854775807");
    assert_eq!(
        precise.rows[0]["decimal"],
        "1234567890.12345678901234567890"
    );
    let bounded = adapter
        .execute_query("SELECT * FROM \"APP\".\"items\"")
        .await
        .unwrap();
    assert_eq!(bounded.rows.len(), 10_000);
    assert!(bounded.truncated);
    assert!(adapter
        .fetch_rows("APP", "items", None, 50_001, 0, None, false, false, false)
        .await
        .is_err());
    let slot = worker(temporary.path(), &profile.id).await.unwrap();
    let before = requests(&slot).await;
    let mut durations = Vec::new();
    let mut retained = 0;
    for _ in 0..15 {
        let started = Instant::now();
        let page = adapter
            .fetch_rows(
                "APP",
                "items",
                None,
                1_000,
                0,
                Some("id"),
                false,
                false,
                false,
            )
            .await
            .unwrap();
        durations.push(started.elapsed());
        assert_eq!(page.rows.len(), 1_000);
        retained = serde_json::to_vec(&page.rows).unwrap().len();
        assert!(retained < 512 * 1024);
    }
    assert_eq!(requests(&slot).await - before, 15);
    durations.sort();
    eprintln!("JDBC H2: 100000 source rows, 1000 retained rows/{retained} bytes, 15 requests, concurrency 1, median {:?}, p95 {:?}, 192 MiB Java heap, no idle database requests", durations[7], durations[14]);
    assert!(durations[7] < Duration::from_millis(300));
    assert!(durations[14] < Duration::from_secs(1));
    let idle_count = requests(&slot).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(requests(&slot).await, idle_count);
    slot.state.lock().await.touched = Instant::now() - IDLE - Duration::from_secs(1);
    assert!(retire_idle(&worker_key(temporary.path(), &profile.id), &slot).await);
    assert!(slot.state.lock().await.bridge.is_none());
    assert!(!workers()
        .lock()
        .await
        .contains_key(&worker_key(temporary.path(), &profile.id)));
}

#[tokio::test]
#[ignore = "needs JDK17+ in JAVA_HOME and L8DB_JDBC_TEST_JAR pointing to H2"]
async fn live_h2_read_only_cancellation_disconnect_and_oversized_cells() {
    let _guard = LIFECYCLE.lock().await;
    let temporary = tempfile::tempdir().unwrap();
    let mut profile = live_profile(
        temporary.path(),
        &fixture_jar("L8DB_JDBC_TEST_JAR"),
        "org.h2.Driver",
        format!("jdbc:h2:mem:l8db_{}", rand::random::<u64>()),
        "sa",
    );
    save_profiles(temporary.path(), std::slice::from_ref(&profile)).unwrap();
    let adapter = JdbcAdapter {
        root: temporary.path().into(),
        id: profile.id.clone(),
    };
    adapter
        .execute_query("CREATE TABLE \"items\" (\"id\" INTEGER)")
        .await
        .unwrap();
    let slot = worker(temporary.path(), &profile.id).await.unwrap();
    let before = requests(&slot).await;
    profile.read_only = true;
    save_profiles(temporary.path(), std::slice::from_ref(&profile)).unwrap();
    assert!(adapter
        .execute_query("DELETE FROM \"items\"")
        .await
        .unwrap_err()
        .contains("Lesemodus"));
    assert!(adapter
        .fetch_rows(
            "PUBLIC",
            "items",
            Some("1=1; DELETE FROM \"items\""),
            10,
            0,
            None,
            false,
            false,
            true
        )
        .await
        .is_err());
    assert_eq!(requests(&slot).await, before);
    profile.read_only = false;
    save_profiles(temporary.path(), std::slice::from_ref(&profile)).unwrap();
    let job = format!("jdbc-cancel-{}", rand::random::<u64>());
    let options = super::super::execution::ExecutionOptions {
        job_id: Some(job.clone()),
        ..Default::default()
    };
    let cancel = async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let started = Instant::now();
        assert!(super::super::execution::cancel(&job).unwrap());
        started
    };
    let run = super::super::execution::run(
        Some(options),
        true,
        adapter.execute_query("SELECT SUM(SIN(X)) FROM SYSTEM_RANGE(1, 1000000000)"),
    );
    let (outcome, cancelled) = tokio::join!(run, cancel);
    assert!(outcome.unwrap_err().contains("abgebrochen"));
    assert!(cancelled.elapsed() < Duration::from_millis(500));
    assert!(slot.state.lock().await.bridge.is_none());
    let oversized = adapter
        .execute_query("SELECT SPACE(300000) AS \"oversized\"")
        .await;
    assert!(oversized.is_err());
    assert!(slot.state.lock().await.bridge.is_none());
    adapter.test_connection().await.unwrap();
    let run = adapter.execute_query("SELECT SUM(SIN(X)) FROM SYSTEM_RANGE(1, 1000000000)");
    let disconnect = async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let started = Instant::now();
        close_profile(temporary.path(), &profile.id).await;
        started.elapsed()
    };
    let (outcome, elapsed) = tokio::join!(run, disconnect);
    assert!(outcome.unwrap_err().contains("getrennt"));
    assert!(elapsed < Duration::from_millis(500));
    assert!(!workers()
        .lock()
        .await
        .contains_key(&worker_key(temporary.path(), &profile.id)));
    let started = Instant::now();
    let timeout = super::super::execution::ExecutionOptions {
        query_timeout: Some(5),
        ..Default::default()
    };
    let outcome = super::super::execution::run(
        Some(timeout),
        true,
        adapter.execute_query("SELECT SUM(SIN(X)) FROM SYSTEM_RANGE(1, 1000000000)"),
    )
    .await;
    assert!(outcome.is_err());
    assert!(started.elapsed() < Duration::from_secs(7));
    let slot = worker(temporary.path(), &profile.id).await.unwrap();
    assert!(slot.state.lock().await.bridge.is_none());
    close_profile(temporary.path(), &profile.id).await;
}

#[tokio::test]
#[ignore = "needs JDK17+, L8DB_JDBC_POSTGRES_JAR and L8DB_E2E_PG_URL"]
async fn live_postgres_jdbc_metadata_parameters_paging_and_memory_budget() {
    let _guard = LIFECYCLE.lock().await;
    let temporary = tempfile::tempdir().unwrap();
    let mut url =
        url::Url::parse(&std::env::var("L8DB_E2E_PG_URL").expect("L8DB_E2E_PG_URL required"))
            .unwrap();
    let username = url.username().to_string();
    let password = url.password().unwrap_or("").to_string();
    url.set_username("").unwrap();
    url.set_password(None).unwrap();
    let profile = live_profile(
        temporary.path(),
        &fixture_jar("L8DB_JDBC_POSTGRES_JAR"),
        "org.postgresql.Driver",
        format!(
            "jdbc:postgresql:{}",
            url.as_str().split_once(':').unwrap().1
        ),
        &username,
    );
    let mut bridge = start(temporary.path(), &profile, &password).await.unwrap();
    let mut fields = vec!["query".into(), "1000".into(), "30".into(), "SELECT CAST(? AS integer) AS id, repeat('x', 128) AS payload FROM generate_series(1, 100000)".into(), "S42".into()];
    let before = bridge.requests;
    let mut durations = Vec::new();
    for _ in 0..9 {
        let started = Instant::now();
        let result = decode_result(bridge.request(&fields).await.unwrap()).unwrap();
        durations.push(started.elapsed());
        assert_eq!(result.rows.len(), 1000);
        assert_eq!(result.rows[0]["id"], 42);
        assert!(result.truncated);
        assert!(serde_json::to_vec(&result.rows).unwrap().len() < 256 * 1024);
    }
    assert_eq!(bridge.requests - before, 9);
    fields = vec!["schemas".into(), "50000".into(), "30".into()];
    let schemas = bridge.request(&fields).await.unwrap();
    assert!(schemas["rows"].as_array().unwrap().iter().any(|row| row
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "public")));
    durations.sort();
    eprintln!("JDBC PostgreSQL: 100000 generated source rows, 1000 retained rows/<256KiB, 9 requests, concurrency 1, median {:?}, p95 {:?}", durations[4], durations[8]);
    assert!(durations[4] < Duration::from_millis(500));
    assert!(durations[8] < Duration::from_secs(2));
    let sent = bridge.requests;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(bridge.requests, sent);
}
