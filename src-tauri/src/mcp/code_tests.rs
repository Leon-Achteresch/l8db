use super::catalog::Catalog;
use super::code::{compose, probe, Limits};
use super::config::{McpConfig, McpConnection, RedactRule};
use super::server::{cache_key, Server};
use crate::db::{self, ColumnInfo, DatabaseKind};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, MutexGuard};
use std::time::{Duration, Instant};

const SHOP: &str = "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total REAL);
INSERT INTO customers VALUES (1, 'Alice', 'alice@example.com'), (2, 'Bob', 'bob@example.com'), (3, 'O''Brien', 'ob@example.com');
INSERT INTO orders VALUES (1, 1, 10.0), (2, 1, 15.5), (3, 2, 11.0), (4, 9, 3.0);";

struct Fixture {
    server: Server,
    config: McpConfig,
    runtime: tokio::runtime::Runtime,
    dir: tempfile::TempDir,
    _guard: MutexGuard<'static, ()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        std::env::remove_var("L8DB_MCP_CONFIG");
    }
}

fn connection(id: &str, name: &str, kind: DatabaseKind, url: &str) -> McpConnection {
    McpConnection {
        id: id.into(),
        name: name.into(),
        kind,
        connection_string: url.into(),
        schemas: vec![],
        ssh: false,
        exposed: true,
        read_only: false,
        allow_ddl: false,
        allow_scripts: false,
        redact_columns: vec![],
        mask_rules: vec![],
        environment: None,
        allow_production_writes: false,
        database: None,
    }
}

fn fixture() -> Fixture {
    let guard = crate::mcp::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("L8DB_MCP_CONFIG", dir.path().join("mcp.json"));
    let shop = dir.path().join("shop.db");
    rusqlite::Connection::open(&shop)
        .unwrap()
        .execute_batch(SHOP)
        .unwrap();
    let mut masked = connection(
        "code-masked",
        "Masked",
        DatabaseKind::Sqlite,
        &format!("sqlite:{}", shop.display()),
    );
    masked.redact_columns = vec!["email".into()];
    let lake = dir.path().join("lake.duckdb");
    {
        let duck = duckdb::Connection::open(&lake).unwrap();
        duck.execute_batch(
            "CREATE SCHEMA app; CREATE SCHEMA secret;
             CREATE TABLE app.items (id INTEGER, label VARCHAR);
             INSERT INTO app.items VALUES (1, 'a'), (2, 'b');
             CREATE TABLE secret.keys (id INTEGER, token VARCHAR);
             INSERT INTO secret.keys VALUES (1, 'top-secret-token');
             CREATE VIEW app.leak AS SELECT k.token FROM secret.keys k;",
        )
        .unwrap();
    }
    let mut lake = connection(
        "code-lake",
        "Lake",
        DatabaseKind::Duckdb,
        &format!("duckdb:{}", lake.display()),
    );
    lake.schemas = vec!["app".into()];
    let config = McpConfig {
        enabled: true,
        connections: vec![
            connection(
                "code-shop",
                "Shop",
                DatabaseKind::Sqlite,
                &format!("sqlite:{}", shop.display()),
            ),
            masked,
            lake,
        ],
        ..McpConfig::default()
    };
    Fixture {
        server: Server {
            pool: db::pool::create_pool_state(),
            columns: HashMap::new(),
        },
        config,
        runtime: tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap(),
        dir,
        _guard: guard,
    }
}

impl Fixture {
    fn code(&mut self, connection: &str, code: &str) -> (bool, String) {
        let reply = self.runtime.block_on(self.server.call_with_config(
            &json!({"name": "code", "arguments": {"connection": connection, "code": code}}),
            &self.config,
        ));
        (
            reply["isError"] == true,
            reply["content"][0]["text"]
                .as_str()
                .unwrap_or("")
                .to_string(),
        )
    }

    fn ok(&mut self, connection: &str, code: &str) -> String {
        let (error, text) = self.code(connection, code);
        assert!(!error, "{text}");
        text
    }

    fn limited(&mut self, connection: &str, code: &str, limits: &Limits) -> Result<String, String> {
        let home = self
            .config
            .connections
            .iter()
            .find(|entry| entry.name == connection)
            .unwrap()
            .clone();
        self.runtime
            .block_on(self.server.code_with(&self.config, &home, code, limits))
    }
}

fn alive(pid: u32) -> bool {
    pid != 0 && unsafe { libc::kill(pid as i32, 0) } == 0
}

fn gone(pid: u32) -> bool {
    let started = Instant::now();
    while alive(pid) {
        if started.elapsed() > Duration::from_secs(5) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    true
}

fn short(seconds: u64) -> Limits {
    Limits {
        time: Duration::from_secs(seconds),
        ..Limits::new(&McpConfig::default())
    }
}

fn spread(mut times: Vec<Duration>) -> (Duration, Duration) {
    times.sort();
    let p95 = (times.len() * 95).div_ceil(100).max(1) - 1;
    (times[times.len() / 2], times[p95])
}

#[test]
fn values_become_dialect_literals_and_names_only_come_from_id() {
    let template = |values: Value| json!({"parts": ["SELECT ", " AS v"], "values": [values]});
    let sql = |kind, values| compose(kind, &template(values)).unwrap();
    assert_eq!(
        sql(DatabaseKind::Sqlite, json!({"s": "x'); DELETE FROM t; --"})),
        "SELECT 'x''); DELETE FROM t; --' AS v"
    );
    assert_eq!(
        sql(DatabaseKind::Mysql, json!({"s": "a\\' OR 1=1 -- "})),
        "SELECT 'a\\\\'' OR 1=1 -- ' AS v"
    );
    assert_eq!(
        sql(DatabaseKind::Postgres, json!({"s": "a\\b'"})),
        "SELECT E'a\\\\b''' AS v"
    );
    assert_eq!(
        sql(DatabaseKind::Mssql, json!({"s": "ä'"})),
        "SELECT N'ä''' AS v"
    );
    assert_eq!(
        sql(DatabaseKind::Clickhouse, json!({"s": "a\\'b"})),
        "SELECT 'a\\\\\\'b' AS v"
    );
    assert_eq!(
        sql(DatabaseKind::Sqlite, json!({"n": -5})),
        "SELECT (-5) AS v"
    );
    assert_eq!(
        sql(DatabaseKind::Sqlite, json!({"n": "-90071992547409930"})),
        "SELECT (-90071992547409930) AS v"
    );
    assert_eq!(
        sql(DatabaseKind::Mssql, json!({"b": true})),
        "SELECT 1 AS v"
    );
    assert_eq!(
        sql(DatabaseKind::Duckdb, json!({"b": false})),
        "SELECT FALSE AS v"
    );
    assert_eq!(sql(DatabaseKind::Duckdb, Value::Null), "SELECT NULL AS v");
    assert_eq!(
        sql(
            DatabaseKind::Duckdb,
            json!({"l": [{"n": 1}, {"s": "a"}, null]})
        ),
        "SELECT (1, 'a', NULL) AS v"
    );
    assert_eq!(
        sql(DatabaseKind::Duckdb, json!({"l": []})),
        "SELECT (NULL) AS v"
    );
    assert_eq!(
        sql(
            DatabaseKind::Postgres,
            json!({"i": ["tenant_001", "or\"ders"]})
        ),
        "SELECT \"tenant_001\".\"or\"\"ders\" AS v"
    );
    assert_eq!(
        sql(DatabaseKind::Mysql, json!({"i": ["a`b"]})),
        "SELECT `a``b` AS v"
    );
    assert_eq!(
        sql(DatabaseKind::Mssql, json!({"i": ["a]b"]})),
        "SELECT [a]]b] AS v"
    );
    for bad in [
        json!({"n": "1; DROP"}),
        json!({"x": 1}),
        json!({"s": "a", "n": 1}),
        json!({"l": [{"l": []}]}),
        json!({"l": [{"i": ["t"]}]}),
        json!({"i": []}),
        json!({"s": "nul\u{0}"}),
        json!("raw"),
    ] {
        assert!(
            compose(DatabaseKind::Postgres, &template(bad.clone())).is_err(),
            "{bad}"
        );
    }
    assert!(compose(DatabaseKind::Odbc, &template(json!({"s": "it's"}))).is_err());
    assert!(compose(
        DatabaseKind::Sqlite,
        &json!({"parts": ["a", "b"], "values": []})
    )
    .is_err());
    assert!(compose(
        DatabaseKind::Sqlite,
        &json!({"parts": [null], "values": []})
    )
    .is_err());
}

#[test]
fn code_runs_steps_returns_tsv_logs_and_throws_catchable_sql_errors() {
    let mut lab = fixture();
    let text = lab.ok(
        "Shop",
        "async () => {
  const customers = await sql`SELECT id, name FROM customers ORDER BY id`;
  console.log('customers', customers.length);
  const out = [];
  for (const c of customers) {
    const [r] = await sql`SELECT count(*) AS n, coalesce(sum(total), 0) AS total FROM orders WHERE customer_id = ${c.id}`;
    out.push({name: c.name, orders: r.n, total: r.total});
  }
  return out;
}",
    );
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], "name\torders\ttotal");
    assert_eq!(lines[1], "Alice\t2\t25.5");
    assert_eq!(lines[3], "O'Brien\t0\t0");
    assert!(text.contains("console:\ncustomers 3"), "{text}");
    assert!(
        text.ends_with(" s)") && text.contains("(4 statements, 6 rows read, "),
        "{text}"
    );
    let text = lab.ok(
        "Shop",
        "async () => {
  try { await sql`SELECT nope FROM customers` } catch (e) { return e.name + ': ' + (e.message.length > 0) }
}",
    );
    assert!(text.starts_with("SqlError: true"), "{text}");
    let (error, text) = lab.code(
        "Shop",
        "async () => {
  const a = 1;
  await sql`SELECT broken FROM nowhere`;
}",
    );
    assert!(error, "{text}");
    assert!(
        text.contains("SqlError")
            && text.contains("line 3: await sql`SELECT broken FROM nowhere`;"),
        "{text}"
    );
    let (error, text) = lab.code("Shop", "async () => {\n  null.x;\n}");
    assert!(
        error && text.contains("TypeError") && text.contains("line 2: null.x;"),
        "{text}"
    );
    let text = lab.ok(
        "Shop",
        "const [r] = await query('SELECT 40 + 2 AS answer');\nreturn r.answer;",
    );
    assert!(text.starts_with("42\n"), "{text}");
    let text = lab.ok("Shop", "async () => ({a: 1, b: [1, 2]})");
    assert!(text.starts_with("{\"a\":1,\"b\":[1,2]}"), "{text}");
    let (error, text) = lab.code("Shop", "async () => { return 1 +; }");
    assert!(error && text.contains("SyntaxError"), "{text}");
    let (error, text) = lab.code("Shop", "async () => { await new Promise(() => {}) }");
    assert!(error && text.contains("never settles"), "{text}");
}

#[test]
fn catalog_bindings_return_structured_data_and_never_show_hidden_schemas() {
    let mut lab = fixture();
    let text = lab.ok(
        "Lake",
        "async () => {
  const schemas = (await catalog.schemas()).map(s => s.name);
  const tables = (await catalog.tables()).map(t => t.schema + '.' + t.name + ':' + t.kind);
  const columns = (await catalog.columns({name: /^(token|label)$/})).map(c => c.table + '.' + c.name);
  const view = await catalog.source('app.leak');
  const grep = await catalog.grep('token');
  return {schemas, tables, columns, view, grep};
}",
    );
    let value: Value = serde_json::from_str(text.lines().next().unwrap()).unwrap();
    assert_eq!(value["schemas"], json!(["app"]), "{text}");
    assert!(
        !text.contains("secret") && !text.contains("top-secret"),
        "{text}"
    );
    assert!(
        value["tables"]
            .as_array()
            .unwrap()
            .contains(&json!("app.items:T")),
        "{text}"
    );
    assert!(
        value["tables"]
            .as_array()
            .unwrap()
            .contains(&json!("app.leak:V")),
        "{text}"
    );
    assert_eq!(
        value["view"]["text"], "[line references a hidden schema]",
        "{text}"
    );
    let (error, text) = lab.code(
        "Lake",
        "async () => { const r = await sql`SELECT token FROM ${id('secret', 'keys')}`; return r }",
    );
    assert!(error && !text.contains("top-secret"), "{text}");
    let (error, text) = lab.code("Lake", "async () => catalog.source('secret.keys')");
    assert!(error && text.contains("nicht gefunden"), "{text}");
    let text = lab.ok(
        "Lake",
        "async () => (await catalog.tables({schema: 'secret'})).length + (await catalog.columns({table: 'keys'})).length",
    );
    assert!(text.starts_with("0\n"), "{text}");
}

#[test]
fn masked_columns_writes_and_injection_attempts_stay_blocked() {
    let mut lab = fixture();
    let text = lab.ok(
        "Masked",
        "async () => sql`SELECT * FROM customers ORDER BY id`",
    );
    assert!(
        text.contains("Alice") && !text.contains("alice@example.com"),
        "{text}"
    );
    let text = lab.ok(
        "Masked",
        "async () => { const rows = await sql`SELECT * FROM customers`; return rows.map(r => r.email).join(',') }",
    );
    assert!(!text.contains('@'), "{text}");
    for leak in [
        "async () => sql`SELECT id, email FROM customers`",
        "async () => sql`SELECT id FROM customers WHERE email LIKE '%alice%'`",
        "async () => query('SELECT upper(c.email) AS e FROM customers c')",
        "async () => query('SELECT 1 /* /* */ , email AS e FROM customers -- */')",
    ] {
        let (error, text) = lab.code("Masked", leak);
        assert!(
            error && text.contains("redigiert") && !text.contains("alice@"),
            "{leak}: {text}"
        );
    }
    for write in [
        "async () => sql`DELETE FROM orders`",
        "async () => query('DROP TABLE orders')",
        "async () => query(\"INSERT INTO orders VALUES (9, 1, 1)\")",
        "async () => query('SELECT 1; DELETE FROM orders')",
        "async () => sql`UPDATE orders SET total = ${0}`",
        "async () => explain('DELETE FROM orders')",
    ] {
        let (error, text) = lab.code("Shop", write);
        assert!(error, "{write}: {text}");
    }
    let count: i64 = rusqlite::Connection::open(lab.dir.path().join("shop.db"))
        .unwrap()
        .query_row("SELECT count(*) FROM orders", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 4);
    let text = lab.ok(
        "Shop",
        "async () => {
  const evil = \"x' OR '1'='1\";
  const nested = '${sql`DELETE FROM orders`}';
  const [a] = await sql`SELECT count(*) AS n FROM customers WHERE name = ${evil}`;
  const [b] = await sql`SELECT ${nested} AS v, 10-${-5} AS d`;
  let forged = 'blocked';
  try { await sql`SELECT ${{i: ['orders']}} AS x` } catch (e) { forged = e.name }
  let nest = 'blocked';
  try { await sql`SELECT ${sql`SELECT 1`} AS x` } catch (e) { nest = e.name }
  return [a.n, b.v, b.d, forged, nest].join('|');
}",
    );
    assert!(
        text.starts_with("0|${sql`DELETE FROM orders`}|15|TypeError|TypeError\n"),
        "{text}"
    );
    let text = lab.ok(
        "Shop",
        "async () => {
  Object.prototype.toJSON = () => 'pwned';
  Array.prototype.map = function () { return ['tampered'] };
  JSON.parse = () => ({});
  const viaEval = eval('typeof require + typeof process + typeof std + typeof os + typeof fetch + typeof setTimeout + typeof Deno');
  const viaFunction = Function('return typeof globalThis.__host + typeof print')();
  const outer = (async () => {}).constructor('return 1');
  delete Object.prototype.toJSON;
  return [viaEval, viaFunction, typeof outer].join(' ');
}",
    );
    assert!(
        text.starts_with("undefinedundefinedundefinedundefinedundefinedundefinedundefined undefinedundefined function\n"),
        "{text}"
    );
    lab.config.redaction.values.push(RedactRule {
        name: "mail".into(),
        pattern: "[a-z]+@[a-z.]+".into(),
        enabled: true,
        mask: None,
    });
    let text = lab.ok(
        "Shop",
        "async () => { console.log(['bob', 'example.org'].join('@')); return ['carol', 'example.net'].join('@') }",
    );
    assert!(!text.contains('@'), "{text}");
    let (error, text) = lab.code(
        "Shop",
        "async () => { throw new Error(['dave', 'example.com'].join('@')) }",
    );
    assert!(error && !text.contains("dave@"), "{text}");
    lab.config.redaction.values.clear();
}

#[test]
fn limits_stop_runaway_code_and_leave_no_worker_behind() {
    let mut lab = fixture();
    let started = Instant::now();
    let error = lab
        .limited("Shop", "async () => { while (true) {} }", &short(1))
        .unwrap_err();
    let pid = probe::PID.get();
    assert!(error.contains("time limit"), "{error}");
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "{:?}",
        started.elapsed()
    );
    assert!(gone(pid), "worker {pid} still exists");
    let error = lab
        .limited(
            "Shop",
            "async () => { try { while (true) {} } catch (e) { return 'caught' } }",
            &short(1),
        )
        .unwrap_err();
    assert!(error.contains("time limit"), "{error}");
    let started = Instant::now();
    let error = lab
        .limited(
            "Shop",
            "async () => { const a = []; while (true) a.push(new Array(100000).fill(a.length)); }",
            &short(20),
        )
        .unwrap_err();
    assert!(error.contains("memory limit of 64 MB"), "{error}");
    assert!(started.elapsed() < Duration::from_secs(10));
    assert!(gone(probe::PID.get()));
    let error = lab
        .limited(
            "Shop",
            "async () => { const f = (n) => f(n + 1) + 1; return f(0) }",
            &short(20),
        )
        .unwrap_err();
    assert!(error.contains("call stack"), "{error}");
    let text = lab.ok("Shop", "async () => 'x'.repeat(5000000)");
    assert!(
        text.chars().count() <= lab.config.max_chars + 200,
        "{}",
        text.len()
    );
    assert!(
        text.contains("result cut at") || text.contains("truncated"),
        "{}",
        &text[text.len() - 300..]
    );
    let text = lab.ok(
        "Shop",
        "async () => Array.from({length: 50000}, (_, i) => ({i, label: 'row ' + i}))",
    );
    assert!(text.chars().count() <= lab.config.max_chars + 200);
    assert!(
        text.contains("50000 items"),
        "{}",
        &text[text.len() - 400..]
    );
    let text = lab.ok(
        "Shop",
        "async () => { for (let i = 0; i < 5000; i++) console.log('line', i); return 1 }",
    );
    assert!(
        text.contains("more console lines dropped") && text.chars().count() < 6_000,
        "{text}"
    );
    assert!(gone(probe::PID.get()));
    let error = lab
        .limited(
            "Shop",
            "async () => { const out = []; for (let i = 0; i < 6; i++) out.push(await sql`SELECT ${i} AS i`); return out }",
            &Limits { statements: 5, ..short(20) },
        )
        .unwrap_err();
    assert!(error.contains("Höchstens 5 Statements"), "{error}");
    let error = lab
        .limited(
            "Shop",
            "async () => { for (let i = 0; i < 6; i++) await catalog.tables(); }",
            &Limits {
                statements: 5,
                ..short(20)
            },
        )
        .unwrap_err();
    assert!(error.contains("Höchstens 5 Katalogaufrufe"), "{error}");
    probe::reset();
    let error = lab
        .limited(
            "Shop",
            "async () => Promise.all([1, 2, 3].map(() => sql`SELECT * FROM orders`))",
            &Limits {
                parallel: 1,
                total_rows: 2,
                ..short(20)
            },
        )
        .unwrap_err();
    assert!(
        error.contains("Zeilenbudget") && probe::EXECUTED.get() == 1,
        "{error}"
    );
    let text = lab.ok(
        "Shop",
        "async () => (await query('SELECT * FROM orders', { limit: 2 })).length",
    );
    assert!(
        text.starts_with("2\n") && text.contains("(1 statements, 3 rows read"),
        "{text}"
    );
    let started = Instant::now();
    let runtime = &lab.runtime;
    let home = lab.config.connections[0].clone();
    let dropped = runtime.block_on(async {
        tokio::time::timeout(
            Duration::from_millis(400),
            lab.server.code_with(
                &lab.config,
                &home,
                "async () => { for (;;) { await sql`SELECT count(*) FROM customers`; } }",
                &short(30),
            ),
        )
        .await
    });
    assert!(dropped.is_err());
    let pid = probe::PID.get();
    runtime.block_on(async {
        let started = Instant::now();
        while alive(pid) && started.elapsed() < Duration::from_secs(5) {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    });
    assert!(!alive(pid), "cancelled worker {pid} still exists");
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn statements_run_at_most_four_at_once_without_duplicate_requests() {
    let running = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let seen = Arc::new(AtomicUsize::new(0));
    let (r, p, s) = (running.clone(), peak.clone(), seen.clone());
    let mock = db::http_mock::start(move |request| {
        if !request.body.contains("probe") {
            return (500, b"unexpected".to_vec());
        }
        s.fetch_add(1, Ordering::SeqCst);
        let now = r.fetch_add(1, Ordering::SeqCst) + 1;
        p.fetch_max(now, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(40));
        r.fetch_sub(1, Ordering::SeqCst);
        (
            200,
            br#"{"meta":[{"name":"n","type":"UInt8"}],"data":[[1]],"rows":1}"#.to_vec(),
        )
    });
    let mut lab = fixture();
    let clickhouse = connection(
        "code-ch",
        "Click",
        DatabaseKind::Clickhouse,
        &mock.base.replace("http://", "clickhouse://bench@"),
    );
    let catalog = Catalog::new(Arc::new(vec![ColumnInfo {
        schema: "default".into(),
        table: "probe".into(),
        name: "n".into(),
        data_type: "UInt8".into(),
    }]));
    lab.server
        .columns
        .insert(cache_key(&clickhouse), Arc::new(catalog));
    lab.config.connections.push(clickhouse);
    probe::reset();
    let started = Instant::now();
    let text = lab.ok(
        "Click",
        "async () => {
  const all = await Promise.all(Array.from({length: 24}, (_, i) => sql`SELECT n FROM probe WHERE n <> ${-i}`));
  return all.length;
}",
    );
    let elapsed = started.elapsed();
    assert!(text.starts_with("24\n"), "{text}");
    assert_eq!(seen.load(Ordering::SeqCst), 24);
    assert_eq!(probe::EXECUTED.get(), 24);
    assert_eq!(peak.load(Ordering::SeqCst), 4);
    assert_eq!(probe::PEAK.get(), 4);
    assert!(mock
        .requests()
        .iter()
        .all(|request| request.body.contains("probe")));
    assert!(elapsed >= Duration::from_millis(6 * 40), "{elapsed:?}");
    println!("24 statements against a 40 ms server, 4 at once: {elapsed:?}");
    assert!(gone(probe::PID.get()));
}

#[test]
fn worker_start_and_statement_overhead_stay_small() {
    let mut lab = fixture();
    let mut starts = Vec::new();
    for _ in 0..15 {
        let started = Instant::now();
        let text = lab.ok("Shop", "async () => 1");
        starts.push(started.elapsed());
        assert!(text.starts_with("1\n"));
        assert!(gone(probe::PID.get()));
    }
    let (start_median, start_p95) = spread(starts);
    let mut direct = Vec::new();
    for index in 0..30 {
        let started = Instant::now();
        let reply = lab.runtime.block_on(lab.server.call_with_config(
            &json!({"name": "query", "arguments": {"connection": "Shop", "sql": format!("SELECT {index} AS i")}}),
            &lab.config,
        ));
        direct.push(started.elapsed());
        assert_eq!(reply["isError"], false);
    }
    let (direct_median, _) = spread(direct);
    let mut runs = Vec::new();
    for _ in 0..3 {
        probe::reset();
        let started = Instant::now();
        let text = lab.ok(
            "Shop",
            "async () => { let s = 0; for (let i = 0; i < 200; i++) { const [r] = await sql`SELECT ${i} AS i`; s += r.i } return s }",
        );
        runs.push(started.elapsed());
        assert!(text.starts_with("19900\n"), "{text}");
        assert_eq!(probe::EXECUTED.get(), 200);
    }
    let (run_median, _) = spread(runs);
    let per_statement = run_median.saturating_sub(start_median) / 200;
    println!(
        "worker start median {start_median:?} p95 {start_p95:?}; query tool median {direct_median:?}; 200 sequential sql in code median {run_median:?}, ≈{per_statement:?} per statement"
    );
    assert!(
        start_median < Duration::from_millis(400),
        "{start_median:?}"
    );
    assert!(start_p95 < Duration::from_millis(800), "{start_p95:?}");
    assert!(
        per_statement < direct_median.max(Duration::from_millis(1)) * 3,
        "{per_statement:?} vs {direct_median:?}"
    );
    assert!(
        per_statement < Duration::from_millis(10),
        "{per_statement:?}"
    );
}
