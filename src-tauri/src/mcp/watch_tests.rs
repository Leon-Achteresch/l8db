use super::*;
use std::sync::atomic::AtomicU8;

const FAST: Timing = Timing {
    min: Duration::from_millis(40),
    max: Duration::from_millis(300),
    push_min: Duration::from_millis(200),
    push_max: Duration::from_millis(800),
};

static MODE: AtomicU8 = AtomicU8::new(0);

fn lookup(settings: Settings) -> Lookup {
    Arc::new(move |_: &str| match MODE.load(Ordering::Relaxed) {
        0 => Some(settings.clone()),
        1 => None,
        _ => Some((
            McpConnection {
                redact_columns: vec![],
                ..settings.0.clone()
            },
            settings.1.clone(),
        )),
    })
}

fn redactor(columns: &[&str]) -> Redactor {
    let columns: Vec<String> = columns.iter().map(|column| column.to_string()).collect();
    Redactor::new(&config::mcp_default_redaction(), &columns)
}

fn table(columns: &[&str], sensitive: &[&str]) -> Arc<Table> {
    Arc::new(Table {
        sql: "\"public\".\"orders\"".into(),
        key: "\"id\"".into(),
        cast: "integer".into(),
        columns: columns.iter().map(|column| column.to_string()).collect(),
        redactor: redactor(sensitive),
    })
}

fn row(table: &Table, version: &str, values: &[Option<&str>]) -> Row {
    let found: Rows = vec![[Some("1".to_string()), Some(version.to_string())]
        .into_iter()
        .chain(values.iter().flat_map(|value| {
            [
                value.map(str::to_string),
                value.map(|text| format!("hash:{text}")),
            ]
        }))
        .collect()];
    parse_rows(found, table).remove("1").unwrap()
}

fn watch(table: Arc<Table>, rows: HashMap<String, Row>) -> Watch {
    Watch {
        name: "w1".into(),
        key: "c#".into(),
        label: "orders".into(),
        table,
        ids: vec!["1".into(), "2".into()],
        rows,
        pending: BTreeMap::new(),
        until: Instant::now() + Duration::from_secs(60),
        last_push: None,
        gap: Duration::ZERO,
        failure: None,
        settings: (Lab::connection_for(""), config::mcp_default_redaction()),
    }
}

fn change(watch: &mut Watch, after: Option<Row>) {
    let rows = after
        .into_iter()
        .map(|row| ("1".to_string(), row))
        .collect();
    watch.record(&["1".to_string()], rows);
}

#[test]
fn push_backoff_merges_bursts_and_drops_no_ops() {
    let table = table(&["status"], &[]);
    let start = row(&table, "1", &[Some("a")]);
    let mut watch = watch(table.clone(), HashMap::from([("1".to_string(), start)]));
    let t0 = Instant::now();

    change(&mut watch, Some(row(&table, "2", &[Some("b")])));
    assert_eq!(
        watch.flush(t0, &TIMING).as_deref(),
        Some("w1 orders 1 status: \"a\"→\"b\"")
    );
    change(&mut watch, Some(row(&table, "3", &[Some("c")])));
    assert_eq!(watch.flush(t0 + Duration::from_secs(1), &TIMING), None);
    change(&mut watch, Some(row(&table, "4", &[Some("d")])));
    assert_eq!(watch.flush(t0 + Duration::from_secs(2), &TIMING), None);
    assert_eq!(
        watch.flush(t0 + Duration::from_secs(5), &TIMING).as_deref(),
        Some("w1 orders 1 status: \"b\"→\"d\"")
    );
    assert_eq!(watch.gap, Duration::from_secs(10));

    assert_eq!(watch.flush(t0 + Duration::from_secs(16), &TIMING), None);
    assert_eq!(watch.gap, Duration::ZERO);

    change(&mut watch, Some(row(&table, "5", &[Some("d")])));
    assert_eq!(watch.flush(t0 + Duration::from_secs(17), &TIMING), None);
    change(&mut watch, Some(row(&table, "6", &[Some("x")])));
    change(&mut watch, Some(row(&table, "7", &[Some("d")])));
    assert_eq!(watch.flush(t0 + Duration::from_secs(18), &TIMING), None);
    assert!(watch.pending.is_empty());

    change(&mut watch, None);
    assert_eq!(
        watch
            .flush(t0 + Duration::from_secs(19), &TIMING)
            .as_deref(),
        Some("w1 orders 1 deleted")
    );
    change(&mut watch, Some(row(&table, "8", &[Some("e")])));
    assert_eq!(watch.flush(t0 + Duration::from_secs(20), &TIMING), None);
    assert_eq!(
        watch
            .flush(t0 + Duration::from_secs(30), &TIMING)
            .as_deref(),
        Some("w1 orders 1 inserted")
    );
}

#[test]
fn push_rate_for_a_constantly_changing_row_is_capped() {
    let table = table(&["n"], &[]);
    let mut watch = watch(
        table.clone(),
        HashMap::from([("1".to_string(), row(&table, "0", &[Some("0")]))]),
    );
    let t0 = Instant::now();
    let mut pushes = 0;
    for second in 1..=3600u64 {
        let value = second.to_string();
        change(
            &mut watch,
            Some(row(&table, &value, &[Some(value.as_str())])),
        );
        pushes += usize::from(
            watch
                .flush(t0 + Duration::from_secs(second), &TIMING)
                .is_some(),
        );
    }
    assert!(pushes <= 18, "{pushes} pushes per hour");
}

#[test]
fn diff_hides_sensitive_values_and_clips_long_ones() {
    let table = table(&["secret", "body", "note"], &["^secret$"]);
    let long_old = "x".repeat(1_000_000);
    let long_new = "y".repeat(1_000_000);
    let before = row(
        &table,
        "1",
        &[Some("hunter2"), Some(long_old.as_str()), None],
    );
    let after = row(
        &table,
        "2",
        &[Some("hunter3"), Some(long_new.as_str()), Some("ok")],
    );
    assert!(before.cells[0].preview.is_none());
    assert!(before.cells[1].preview.as_ref().unwrap().len() <= PREVIEW + 1);
    let mut watch = watch(table, HashMap::from([("1".to_string(), before)]));
    change(&mut watch, Some(after));
    let text = watch.flush(Instant::now(), &TIMING).unwrap();
    assert!(text.contains("secret: changed"), "{text}");
    assert!(!text.contains("hunter"), "{text}");
    assert!(
        text.contains(&format!(
            "body: \"{}\"…→\"{}\"…",
            "x".repeat(PREVIEW),
            "y".repeat(PREVIEW)
        )),
        "{text}"
    );
    assert!(text.contains("note: null→\"ok\""), "{text}");
    assert!(text.len() < 220, "{} bytes", text.len());
}

#[test]
fn stale_ids_cover_updates_inserts_and_deletes() {
    let table = table(&["status"], &[]);
    let mut watch = watch(
        table.clone(),
        HashMap::from([("1".to_string(), row(&table, "7", &[Some("a")]))]),
    );
    watch.ids.push("4".into());
    let versions = HashMap::from([
        ("1".to_string(), "7".to_string()),
        ("4".to_string(), "9".to_string()),
    ]);
    assert_eq!(watch.stale(&versions), vec!["4".to_string()]);
    let versions = HashMap::from([("1".to_string(), "8".to_string())]);
    assert_eq!(watch.stale(&versions), vec!["1".to_string()]);
    assert_eq!(watch.stale(&HashMap::new()), vec!["1".to_string()]);
}

#[test]
fn idle_polling_backs_off_to_a_fixed_hourly_budget() {
    let mut interval = TIMING.min;
    let mut elapsed = Duration::ZERO;
    let mut polls = 0;
    while elapsed < Duration::from_secs(3600) {
        elapsed += interval.mul_f64(0.8);
        polls += 1;
        interval = next_interval(interval, &Ok(false), &TIMING);
    }
    assert!(polls <= 460, "{polls} polls per idle hour");
    assert_eq!(next_interval(TIMING.max, &Ok(true), &TIMING), TIMING.min);
    assert_eq!(
        next_interval(TIMING.min, &Err("x".into()), &TIMING),
        TIMING.max
    );
}

#[test]
fn buffered_changes_are_bounded() {
    let watches = Watches::new(
        Arc::new(|_: Value| {}),
        FAST,
        Arc::new(|_: &str| None),
        std::env::temp_dir(),
    );
    {
        let mut state = watches.0.lock();
        for index in 0..BUFFERED + 50 {
            watches.0.message(
                &mut state,
                "w1",
                "orders",
                format!("w1 orders {index} deleted"),
            );
        }
        assert_eq!(state.buffered.len(), BUFFERED);
    }
    let text = watches.changes();
    assert!(
        text.starts_with("50 older changes dropped\nw1 orders 50 deleted"),
        "{}",
        &text[..60]
    );
    assert_eq!(watches.changes(), "No changes.");
}

#[test]
fn slots_cap_sessions_per_connection() {
    let dir = tempfile::tempdir().unwrap();
    let held: Vec<File> = (0..SLOTS)
        .map(|_| take_slot(dir.path(), "conn/1").unwrap())
        .collect();
    assert!(take_slot(dir.path(), "conn/1").is_err());
    assert!(take_slot(dir.path(), "other").is_ok());
    drop(held);
    assert!(take_slot(dir.path(), "conn/1").is_ok());
}

#[test]
fn ids_and_sql_are_validated_and_quoted() {
    assert_eq!(ids(&json!({"ids": [1, "a", " "]})).unwrap(), vec!["1", "a"]);
    assert_eq!(ids(&json!({"id": 5})).unwrap(), vec!["5"]);
    assert_eq!(ids(&json!({"ids": "7"})).unwrap(), vec!["7"]);
    assert!(ids(&json!({})).is_err());
    assert!(ids(&json!({"ids": (0..=MAX_IDS).collect::<Vec<_>>()})).is_err());
    assert!(ids(&json!({"ids": ["a\u{0}b"]})).is_err());
    assert_eq!(literal("a'b\\c"), "E'a''b\\\\c'");
    let table = table(&["status"], &[]);
    assert_eq!(
        versions_sql(&table, &["1".into(), "x'); drop table t; --".into()]),
        "select \"id\"::text, xmin::text from \"public\".\"orders\" where \"id\" = any(array[E'1',E'x''); drop table t; --']::integer[])"
    );
    assert!(rows_sql(&table, &["1".into()])
        .contains(", left(\"status\"::text, 256), md5(\"status\"::text) from"));
}

struct Lab {
    url: String,
    admin: Client,
}

impl Lab {
    async fn new() -> Self {
        let url = std::env::var("L8DB_E2E_PG_URL")
            .unwrap_or_else(|_| "postgres://postgres:testpw@127.0.0.1:5433/testdb".into());
        let (config, ssl) = connection::parse_connection(&url, None).unwrap();
        let admin = execution::connect_postgres(&config, &ssl).await.unwrap();
        Self { url, admin }
    }

    async fn run(&self, sql: &str) {
        self.admin.batch_execute(sql).await.unwrap();
    }

    async fn watchers(&self) -> i64 {
        self.admin
            .query_one("select count(*) from pg_stat_activity where application_name = 'l8db-watch' and datname = current_database()", &[])
            .await
            .unwrap()
            .get(0)
    }

    fn connection(&self) -> McpConnection {
        Self::connection_for(&self.url)
    }

    fn connection_for(url: &str) -> McpConnection {
        McpConnection {
            id: "lab".into(),
            name: "lab".into(),
            kind: DatabaseKind::Postgres,
            connection_string: url.into(),
            schemas: vec![],
            ssh: false,
            exposed: true,
            read_only: true,
            allow_ddl: false,
            allow_scripts: false,
            redact_columns: vec!["^secret$".into()],
            mask_rules: vec![],
            environment: None,
            allow_production_writes: false,
            database: None,
        }
    }
}

type Seen = Arc<Mutex<Vec<(Instant, String)>>>;

fn collector() -> (Sink, Seen) {
    let seen: Seen = Arc::default();
    let sink = seen.clone();
    (
        Arc::new(move |message: Value| {
            let text = message["params"]["content"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            sink.lock().unwrap().push((Instant::now(), text));
        }),
        seen,
    )
}

async fn wait_for(seen: &Seen, from: usize, needle: &str, limit: Duration) -> Option<Instant> {
    let deadline = Instant::now() + limit;
    while Instant::now() < deadline {
        if let Some((at, _)) = seen.lock().unwrap()[from..]
            .iter()
            .find(|(_, text)| text.contains(needle))
        {
            return Some(*at);
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    None
}

async fn until(limit: Duration, mut done: impl AsyncFnMut() -> bool) -> bool {
    let deadline = Instant::now() + limit;
    while Instant::now() < deadline {
        if done().await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    false
}

fn percentile(samples: &mut [Duration], p: f64) -> Duration {
    samples.sort();
    samples[((samples.len() - 1) as f64 * p).round() as usize]
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore]
async fn watch_pushes_row_changes_with_bounded_database_load() {
    let lab = Lab::new().await;
    lab.run("drop table if exists l8db_watch_e2e; create table l8db_watch_e2e (id int primary key, status text, secret text, body text); insert into l8db_watch_e2e select g, 'pending', 's', repeat('x', 1000000) from generate_series(1, 3) g").await;
    let slots = tempfile::tempdir().unwrap();
    let (sink, seen) = collector();
    let connection = lab.connection();
    let settings: Settings = (connection.clone(), config::mcp_default_redaction());
    let watches = Watches::new(
        sink,
        FAST,
        lookup(settings.clone()),
        slots.path().to_path_buf(),
    );
    let redactor = Redactor::new(
        &config::mcp_default_redaction(),
        &connection.sensitive_columns(),
    );
    let reply = watches
        .start(
            &connection,
            &lab.url,
            &json!({"table": "l8db_watch_e2e", "ids": ["1", "2", "04"]}),
            redactor.clone(),
            settings.clone(),
        )
        .await
        .unwrap();
    assert!(
        reply.starts_with("w1 watches l8db_watch_e2e 1, 2, 4 for 60 min. Not found yet: 4."),
        "{reply}"
    );
    assert_eq!(lab.watchers().await, 1);
    let second = watches
        .start(
            &connection,
            &lab.url,
            &json!({"table": "l8db_watch_e2e", "id": 3, "columns": ["status"]}),
            redactor.clone(),
            settings.clone(),
        )
        .await
        .unwrap();
    assert!(second.starts_with("w2 "), "{second}");
    assert!(until(Duration::from_secs(2), async || lab.watchers().await == 1).await);

    let mut latencies = Vec::new();
    for sample in 0..10 {
        tokio::time::sleep(FAST.push_max + Duration::from_millis(100 * (sample % 4))).await;
        let from = seen.lock().unwrap().len();
        let committed = Instant::now();
        lab.run(&format!(
            "update l8db_watch_e2e set status = 's{sample}' where id = 1"
        ))
        .await;
        let at = wait_for(
            &seen,
            from,
            &format!("→\"s{sample}\""),
            Duration::from_secs(5),
        )
        .await
        .expect("push");
        latencies.push(at - committed);
    }
    let median = percentile(&mut latencies, 0.5);
    let p95 = percentile(&mut latencies, 0.95);
    println!(
        "watch latency median {median:?} p95 {p95:?} (poll {:?}..{:?})",
        FAST.min, FAST.max
    );
    assert!(p95 < Duration::from_secs(1), "p95 {p95:?}");

    tokio::time::sleep(FAST.push_max).await;
    let quiet = seen.lock().unwrap().len();
    lab.run("update l8db_watch_e2e set status = status where id = 1; begin; update l8db_watch_e2e set status = 'rolled back' where id = 2; rollback").await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(
        seen.lock().unwrap().len(),
        quiet,
        "{:?}",
        &seen.lock().unwrap()[quiet..]
    );

    lab.run(
        "update l8db_watch_e2e set secret = 'hunter2', body = repeat('y', 1000000) where id = 2",
    )
    .await;
    wait_for(&seen, quiet, "w1 l8db_watch_e2e 2 ", Duration::from_secs(5))
        .await
        .expect("push");
    let text = seen.lock().unwrap().last().unwrap().1.clone();
    assert!(
        text.contains("secret: changed") && !text.contains("hunter2"),
        "{text}"
    );
    assert!(text.contains("body: \"xxxx") && text.len() < 220, "{text}");

    tokio::time::sleep(FAST.push_max).await;
    let before_burst = seen.lock().unwrap().len();
    let queries_before = watches.0.queries.load(Ordering::Relaxed);
    let burst_started = Instant::now();
    let mut writes = 0;
    while burst_started.elapsed() < Duration::from_secs(2) {
        lab.run(&format!(
            "update l8db_watch_e2e set status = 'b{writes}' where id = 1"
        ))
        .await;
        writes += 1;
    }
    let last = format!("→\"b{}\"", writes - 1);
    wait_for(&seen, before_burst, &last, Duration::from_secs(3))
        .await
        .expect("final burst value");
    let pushes = seen.lock().unwrap().len() - before_burst;
    let queries = watches.0.queries.load(Ordering::Relaxed) - queries_before;
    let cycles = burst_started.elapsed().as_millis() as u64 / 32 + 2;
    println!("burst {writes} writes in 2 s -> {pushes} pushes, {queries} queries");
    assert!(pushes <= 6, "{pushes} pushes");
    assert!(
        queries <= 3 * cycles,
        "{queries} queries for at most {cycles} poll cycles"
    );

    lab.run("insert into l8db_watch_e2e values (4, 'new', 's', 'b')")
        .await;
    wait_for(
        &seen,
        0,
        "w1 l8db_watch_e2e 4 inserted",
        Duration::from_secs(5),
    )
    .await
    .expect("insert");
    lab.run("delete from l8db_watch_e2e where id = 4").await;
    wait_for(
        &seen,
        0,
        "w1 l8db_watch_e2e 4 deleted",
        Duration::from_secs(5),
    )
    .await
    .expect("delete");

    lab.run("select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'l8db-watch'").await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    let from = seen.lock().unwrap().len();
    lab.run("update l8db_watch_e2e set status = 'after kill' where id = 1")
        .await;
    wait_for(&seen, from, "→\"after kill\"", Duration::from_secs(5))
        .await
        .expect("change across reconnect");
    assert_eq!(lab.watchers().await, 1);

    lab.run("drop table if exists l8db_watch_e2e_b; create table l8db_watch_e2e_b (id int primary key, v text); insert into l8db_watch_e2e_b values (1, 'a')").await;
    let third = watches
        .start(
            &connection,
            &lab.url,
            &json!({"table": "l8db_watch_e2e_b", "id": 1}),
            redactor.clone(),
            settings.clone(),
        )
        .await
        .unwrap();
    assert!(third.starts_with("w3 "), "{third}");
    lab.run("drop table l8db_watch_e2e_b").await;
    wait_for(
        &seen,
        0,
        "w3 l8db_watch_e2e_b paused: ",
        Duration::from_secs(3),
    )
    .await
    .expect("pause of the broken watch");
    let from = seen.lock().unwrap().len();
    lab.run("update l8db_watch_e2e set status = 'still delivered' where id = 1")
        .await;
    wait_for(&seen, from, "→\"still delivered\"", Duration::from_secs(5))
        .await
        .expect("healthy watch keeps working");
    assert_eq!(
        seen.lock()
            .unwrap()
            .iter()
            .filter(|(_, text)| text.contains("w3 l8db_watch_e2e_b paused"))
            .count(),
        1
    );
    watches.remove("w2,w3").unwrap();
    tokio::time::sleep(FAST.max * 5).await;
    let idle_from = watches.0.queries.load(Ordering::Relaxed);
    tokio::time::sleep(Duration::from_secs(3)).await;
    let idle = watches.0.queries.load(Ordering::Relaxed) - idle_from;
    println!("idle 3 s with 1 watch -> {idle} queries");
    assert!(idle <= 3000 / 240 + 2, "{idle} idle queries");

    let session = || {
        Watches::new(
            Arc::new(|_: Value| {}),
            FAST,
            lookup(settings.clone()),
            slots.path().to_path_buf(),
        )
    };
    let sessions: Vec<Watches> = (0..SLOTS - 1).map(|_| session()).collect();
    for session in &sessions {
        session
            .start(
                &connection,
                &lab.url,
                &json!({"table": "l8db_watch_e2e", "id": 1}),
                redactor.clone(),
                settings.clone(),
            )
            .await
            .unwrap();
    }
    let refused = session()
        .start(
            &connection,
            &lab.url,
            &json!({"table": "l8db_watch_e2e", "id": 1}),
            redactor.clone(),
            settings.clone(),
        )
        .await;
    assert!(refused.unwrap_err().contains("schon 4 Sitzungen"));
    assert_eq!(lab.watchers().await, SLOTS as i64);
    for session in &sessions {
        session.remove("all").unwrap();
    }
    assert!(until(Duration::from_secs(1), async || lab.watchers().await == 1).await);

    watches.0.lock().watches.get_mut("w1").unwrap().until = Instant::now();
    wait_for(
        &seen,
        0,
        "w1 l8db_watch_e2e expired",
        Duration::from_secs(2),
    )
    .await
    .expect("expiry");
    assert!(until(Duration::from_secs(1), async || lab.watchers().await == 0).await);
    assert!(watches.0.lock().pollers.is_empty());

    for (mode, reason) in [
        (1, "stopped: connection is no longer exposed"),
        (2, "stopped: MCP settings changed"),
    ] {
        watches
            .start(
                &connection,
                &lab.url,
                &json!({"table": "l8db_watch_e2e", "id": 1}),
                redactor.clone(),
                settings.clone(),
            )
            .await
            .unwrap();
        MODE.store(mode, Ordering::Relaxed);
        let stopped = wait_for(&seen, 0, reason, Duration::from_secs(2)).await;
        MODE.store(0, Ordering::Relaxed);
        assert!(stopped.is_some(), "{reason}");
        assert!(until(Duration::from_secs(1), async || lab.watchers().await == 0).await);
    }

    let keyed = Redactor::new(&config::mcp_default_redaction(), &["^id$".to_string()]);
    let refused = watches
        .start(
            &connection,
            &lab.url,
            &json!({"table": "l8db_watch_e2e", "id": 1}),
            keyed,
            settings.clone(),
        )
        .await;
    assert!(refused.unwrap_err().contains("ist geschwärzt"));

    let hidden = McpConnection {
        schemas: vec!["sales".into()],
        ..connection.clone()
    };
    let refused = watches
        .start(
            &hidden,
            &lab.url,
            &json!({"table": "l8db_watch_e2e", "id": 1}),
            Redactor::new(&config::mcp_default_redaction(), &[]),
            settings,
        )
        .await;
    assert_eq!(
        refused.unwrap_err(),
        "Tabelle 'l8db_watch_e2e' nicht gefunden."
    );
    lab.run("drop table l8db_watch_e2e").await;
}
