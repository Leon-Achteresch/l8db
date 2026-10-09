use super::*;
use crate::db::{self, DatabaseKind};
use crate::mcp::TEST_ENV_LOCK;
use std::collections::HashMap;
use std::sync::MutexGuard;

struct Lab {
    dir: PathBuf,
    server: Server,
    runtime: tokio::runtime::Runtime,
    _guard: MutexGuard<'static, ()>,
}

impl Drop for Lab {
    fn drop(&mut self) {
        std::env::remove_var("L8DB_MCP_CONFIG");
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn connection(id: &str, name: &str, kind: DatabaseKind, url: &str, exposed: bool) -> McpConnection {
    McpConnection {
        id: id.into(),
        name: name.into(),
        kind,
        connection_string: url.into(),
        schemas: vec![],
        ssh: false,
        exposed,
        read_only: true,
        allow_ddl: false,
        allow_scripts: false,
        redact_columns: vec![],
        mask_rules: vec![],
        environment: None,
        allow_production_writes: false,
        database: None,
    }
}

fn lab() -> Lab {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let guard = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = std::env::temp_dir().join(format!(
        "l8db-dash-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("shop.db");
    let db = rusqlite::Connection::open(&db_path).unwrap();
    db.execute_batch(
        "CREATE TABLE orders(id INTEGER PRIMARY KEY, created_at TEXT, status TEXT, region TEXT, amount REAL, target REAL, customer_email TEXT);
         INSERT INTO orders VALUES
           (1, '2026-01-05', 'open', 'EU', 120.5, 200, 'a@b.de'),
           (2, '2026-01-20', 'paid', 'US', 80, 200, 'c@d.de'),
           (3, '2026-02-03', 'paid', 'EU', 300, 250, 'e@f.de'),
           (4, '2026-02-17', 'shipped', 'APAC', 45.25, 250, 'g@h.de'),
           (5, '2026-03-01', 'paid', 'US', 510, 300, 'i@j.de');",
    )
    .unwrap();
    let mut config = McpConfig {
        enabled: true,
        ..McpConfig::default()
    };
    let url = format!("sqlite:{}", db_path.display());
    config.connections = vec![
        connection("shop", "Shop", DatabaseKind::Sqlite, &url, true),
        connection("shop2", "Shop Copy", DatabaseKind::Sqlite, &url, true),
        connection("hidden", "Hidden", DatabaseKind::Sqlite, &url, false),
        connection(
            "mongo",
            "Mongo",
            DatabaseKind::Mongodb,
            "mongodb://localhost/x",
            true,
        ),
    ];
    let config_path = dir.join("mcp.json");
    std::fs::write(&config_path, serde_json::to_vec(&config).unwrap()).unwrap();
    std::env::set_var("L8DB_MCP_CONFIG", &config_path);
    Lab {
        dir,
        server: Server {
            pool: db::pool::create_pool_state(),
            columns: HashMap::new(),
        },
        runtime: tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap(),
        _guard: guard,
    }
}

impl Lab {
    fn call(&mut self, args: Value) -> Result<String, String> {
        let reply = self.runtime.block_on(
            self.server
                .call(&json!({"name": "dashboard", "arguments": args})),
        );
        let text = reply["content"][0]["text"].as_str().unwrap().to_string();
        if reply["isError"] == true {
            Err(text)
        } else {
            Ok(text)
        }
    }

    fn ok(&mut self, args: Value) -> String {
        self.call(args.clone())
            .unwrap_or_else(|e| panic!("{args} failed: {e}"))
    }

    fn err(&mut self, args: Value) -> String {
        match self.call(args.clone()) {
            Ok(text) => panic!("{args} should fail but returned {text}"),
            Err(e) => e,
        }
    }

    fn only(&self) -> Value {
        let all = read_all();
        assert_eq!(all.len(), 1, "expected exactly one dashboard file");
        all[0].0.clone()
    }

    fn create_sales(&mut self) -> String {
        let text = self.ok(json!({
            "action": "create",
            "connection": "Shop",
            "name": "Sales",
            "charts": [{
                "type": "kpi",
                "title": "Revenue",
                "sql": "SELECT substr(created_at, 1, 7) AS month, SUM(amount) AS revenue FROM orders GROUP BY 1 ORDER BY 1",
                "dimension": "month",
                "metrics": ["revenue"]
            }]
        }));
        text.split("(id ")
            .nth(1)
            .unwrap()
            .split(')')
            .next()
            .unwrap()
            .to_string()
    }
}

fn widget<'a>(dashboard: &'a Value, title: &str) -> &'a Value {
    dashboard["widgets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["title"] == title)
        .unwrap_or_else(|| panic!("widget {title} missing"))
}

#[test]
fn dashboard_css_design_lifecycle_preserves_charts_without_querying() {
    let mut lab = lab();
    let id = lab.create_sales();
    let original = lab.only();
    let design = json!({"css": ":root { --dash-color-1: #c084fc; } .dashboard-widget::before { content: 'CSS'; }", "enabled": true});
    lab.ok(json!({"action": "update", "dashboard": id, "design": design}));
    let styled = lab.only();
    assert_eq!(styled["design"], design);
    assert_eq!(styled["datasets"], original["datasets"]);
    assert_eq!(styled["widgets"], original["widgets"]);
    let described: Value =
        serde_json::from_str(&lab.ok(json!({"action": "get", "dashboard": id}))).unwrap();
    assert_eq!(described["design"], design);
    let mut disconnected = config::load();
    for connection in &mut disconnected.connections {
        connection.connection_string = "sqlite:/missing/directory/no.db".into();
    }
    std::fs::write(
        config::config_path(),
        serde_json::to_vec(&disconnected).unwrap(),
    )
    .unwrap();
    lab.ok(json!({"action": "update", "dashboard": id, "design": {"css": "* { color: purple; }", "enabled": false}}));
    assert_eq!(lab.only()["design"]["enabled"], false);
    lab.ok(json!({"action": "update", "dashboard": id, "design": null}));
    assert!(lab.only()["design"].is_null());
}

#[test]
fn dashboard_css_design_validates_bytes_and_desktop_save_roundtrip() {
    let mut lab = lab();
    let id = lab.create_sales();
    for design in [
        json!({"css": {}, "enabled": true}),
        json!({"css": "", "enabled": "yes"}),
        json!({"css": "ü".repeat(MAX_CSS_BYTES / 2 + 1), "enabled": true}),
    ] {
        assert!(!lab
            .err(json!({"action": "update", "dashboard": id, "design": design}))
            .is_empty());
    }
    let mut saved = lab.only();
    saved["design"] = json!({"css": "@keyframes fixture { to { opacity: 0.5; } } .dashboard-widget { animation: fixture 2s; }", "enabled": true});
    mcp_dashboard_save(saved.clone()).unwrap();
    assert_eq!(lab.only()["design"], saved["design"]);
    assert_eq!(lab.only()["datasets"], saved["datasets"]);
    lab.ok(json!({"action": "create", "connection": "Shop", "name": "Styled", "charts": [], "design": {"css": ".dashboard-widget { padding: 20px; }", "enabled": false}}));
    let created = read_all()
        .into_iter()
        .find(|(value, _)| value["name"] == "Styled")
        .unwrap()
        .0;
    assert_eq!(created["design"]["enabled"], false);
}

#[test]
fn dashboard_css_design_large_update_performance() {
    let mut lab = lab();
    let id = lab.create_sales();
    let css = (0..5000)
        .map(|i| format!(".dashboard-widget.r{i}{{color:#abcdef}}\n"))
        .collect::<String>();
    assert!(css.len() <= MAX_CSS_BYTES);
    let original = lab.only();
    let mut samples = Vec::new();
    for iteration in 0..22 {
        let started = Instant::now();
        lab.ok(json!({"action": "update", "dashboard": id, "design": {"css": css, "enabled": iteration % 2 == 0}}));
        if iteration >= 2 {
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
        }
    }
    samples.sort_by(f64::total_cmp);
    let median = samples[10];
    let p95 = samples[18];
    println!(
        "dashboard CSS: 5000 rules, {} source bytes, median {median:.2} ms, p95 {p95:.2} ms",
        css.len()
    );
    assert!(median < 50.0, "median {median} ms exceeds 50 ms");
    assert!(p95 < 100.0, "p95 {p95} ms exceeds 100 ms");
    assert_eq!(lab.only()["datasets"], original["datasets"]);
    assert_eq!(lab.only()["widgets"], original["widgets"]);
    assert_eq!(read_all().len(), 1);
    assert!(std::fs::metadata(path_of(&id).unwrap()).unwrap().len() < 512 * 1024);
}

fn dataset_for<'a>(dashboard: &'a Value, title: &str) -> &'a Value {
    dataset_of(dashboard, widget(dashboard, title)).unwrap()
}

fn assert_grid(dashboard: &Value) {
    let widgets = dashboard["widgets"].as_array().unwrap();
    for (i, a) in widgets.iter().enumerate() {
        let (x, y, w, h) = rect(a);
        assert!(
            x >= 0 && y >= 0 && x + w <= GRID_COLS && w > 0 && h > 0,
            "{a}"
        );
        for b in &widgets[i + 1..] {
            assert!(!overlaps(rect(a), rect(b)), "{a} overlaps {b}");
        }
    }
}

#[test]
fn tool_definition_matches_kinds() {
    let definition = tool_definition();
    assert_eq!(definition["name"], "dashboard");
    let schema = &definition["inputSchema"]["properties"];
    assert_eq!(
        schema["charts"]["items"]["properties"]["type"]["enum"]
            .as_array()
            .unwrap()
            .len(),
        KINDS.len() + BLOCKS.len()
    );
    assert_eq!(schema["action"]["enum"].as_array().unwrap().len(), 13);
    let description = definition["description"].as_str().unwrap();
    assert!(description.contains("arrange"));
    assert!(description.contains("never a bare number"));
    let help = chart_types();
    assert!(help.contains("\nDesign (professional dashboards):\n- Layout"));
    assert_eq!(help.matches("never a bare number").count(), 2);
    assert!(help.contains("invertDelta for metrics where lower is better"));
    for kind in KINDS {
        assert!(
            help.contains(&format!("\n{}\t{}", kind.name, kind.dim)),
            "{}",
            kind.name
        );
        for option in kind.options.split(' ') {
            assert!(help.contains(option));
        }
    }
}

#[test]
fn creates_dashboard_with_many_chart_types() {
    let mut lab = lab();
    let text = lab.ok(json!({
        "action": "create",
        "connection": "shop",
        "name": "Operations",
        "refreshSec": 60,
        "charts": [
            {"type": "kpi", "title": "Orders", "sql": "SELECT created_at AS day, COUNT(*) AS order_count FROM orders GROUP BY 1 ORDER BY 1", "metrics": ["order_count"], "dateColumn": "day"},
            {"type": "kpi", "title": "Revenue trend", "sql": "SELECT substr(created_at, 1, 7) AS month, SUM(amount) AS revenue FROM orders GROUP BY 1 ORDER BY 1", "dimension": "month", "metrics": ["revenue"], "options": {"curve": "linear", "colorOffset": 2}},
            {"type": "line", "title": "Daily", "sql": "SELECT created_at AS day, SUM(amount) AS revenue, COUNT(*) AS order_count FROM orders GROUP BY 1 ORDER BY 1;", "dimension": "day", "metrics": ["revenue", "order_count"], "dateColumn": "day", "period": "90d", "options": {"showGrid": false, "labels": true}},
            {"type": "donut", "title": "Status", "sql": "SELECT status, COUNT(*) AS n FROM orders GROUP BY status", "dimension": "status", "metrics": ["n"], "options": {"showPercent": true, "sortBy": "desc"}},
            {"type": "column", "title": "Region per month", "sql": "SELECT substr(created_at, 1, 7) AS month, region, SUM(amount) AS revenue FROM orders GROUP BY 1, 2 ORDER BY 1", "dimension": "month", "dimension2": "region", "metrics": ["revenue"], "options": {"stacked": false}},
            {"type": "gauge", "title": "Target", "sql": "SELECT SUM(amount) AS value, MAX(target) * 3 AS goal FROM orders", "metrics": ["value", "goal"]},
            {"type": "heatmap", "title": "Matrix", "sql": "SELECT region, status, COUNT(*) AS n FROM orders GROUP BY 1, 2", "dimension": "region", "dimension2": "status", "metrics": ["n"]},
            {"type": "scatter", "title": "Bubbles", "sql": "SELECT region, amount, target FROM orders", "dimension": "region", "metrics": ["amount", "target"]},
            {"type": "table", "title": "Latest", "sql": "SELECT id, status, amount FROM orders ORDER BY id DESC LIMIT 3", "w": 12, "h": 6}
        ]
    }));
    assert!(text.contains("9 Charts"), "{text}");
    assert!(text.contains("Sichtbar in l8db"));
    assert!(
        text.contains("  day\torder_count\n  2026-01-05\t1\n"),
        "{text}"
    );
    let dashboard = lab.only();
    assert_eq!(dashboard["connectionId"], "shop");
    assert_eq!(dashboard["refreshSec"], 60);
    assert_eq!(dashboard["widgets"].as_array().unwrap().len(), 9);
    assert_eq!(dashboard["datasets"].as_array().unwrap().len(), 9);
    assert_grid(&dashboard);
    for dataset in dashboard["datasets"].as_array().unwrap() {
        assert_eq!(dataset["mode"], "expert");
        assert!(dataset["simple"]["metrics"].is_array());
        assert!(dataset["simple"]["filters"].is_array());
        assert!(!dataset["sql"].as_str().unwrap().ends_with(';'));
    }
    let daily = widget(&dashboard, "Daily");
    assert_eq!(daily["chart"], "line");
    assert_eq!(daily["period"], "90d");
    assert_eq!(daily["options"], json!({"showGrid": false, "labels": true}));
    assert_eq!(
        dataset_for(&dashboard, "Daily")["mapping"]["dateColumn"],
        "day"
    );
    let column = dataset_for(&dashboard, "Region per month");
    assert_eq!(column["mapping"]["dimension2"], "region");
    let table = widget(&dashboard, "Latest");
    assert_eq!(
        (table["x"].as_i64(), table["w"].as_i64()),
        (Some(0), Some(12))
    );
    let orders = widget(&dashboard, "Orders");
    assert_eq!(rect(orders), (0, 0, 3, 4));
    assert_eq!(rect(widget(&dashboard, "Revenue trend")), (3, 0, 3, 4));
    assert_eq!(rect(widget(&dashboard, "Daily")), (6, 0, 6, 7));

    let listed = lab.ok(json!({"action": "list"}));
    assert!(listed.contains("Operations\tShop\t9\t60"), "{listed}");
    assert!(lab
        .ok(json!({"action": "list", "connection": "Shop Copy"}))
        .contains("Keine"));
    let got: Value =
        serde_json::from_str(&lab.ok(json!({"action": "get", "dashboard": "operations"}))).unwrap();
    assert_eq!(got["connection"], "Shop");
    assert_eq!(got["charts"].as_array().unwrap().len(), 9);
    let donut = got["charts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["title"] == "Status")
        .unwrap();
    assert_eq!(donut["type"], "donut");
    assert_eq!(donut["dimension"], "status");
    assert_eq!(donut["metrics"], json!(["n"]));
    assert!(donut["sql"].as_str().unwrap().contains("GROUP BY status"));
}

#[test]
fn rejects_invalid_charts_without_touching_the_file() {
    let mut lab = lab();
    lab.create_sales();
    let before =
        std::fs::read(dir().join(format!("{}.json", lab.only()["id"].as_str().unwrap()))).unwrap();
    let base = |extra: Value| {
        let mut spec = json!({"type": "column", "sql": "SELECT status, COUNT(*) AS n FROM orders GROUP BY status", "dimension": "status", "metrics": ["n"]});
        for (key, value) in extra.as_object().unwrap() {
            spec[key] = value.clone();
        }
        spec
    };
    let cases = [
        (base(json!({"type": "spaghetti"})), "unbekannt"),
        (base(json!({"type": null})), "type fehlt"),
        (
            base(
                json!({"type": "donut", "dimension": null, "sql": "SELECT COUNT(*) AS n FROM orders"}),
            ),
            "braucht dimension",
        ),
        (base(json!({"type": "gauge"})), "nur ohne dimension"),
        (base(json!({"type": "sankey"})), "dimension und dimension2"),
        (
            base(json!({"type": "donut", "dimension2": "status"})),
            "wirkt nur bei",
        ),
        (
            base(json!({"metrics": ["a", "b", "c", "d", "e", "f", "g"]})),
            "1 bis 6 metrics",
        ),
        (base(json!({"type": "score"})), "braucht 2 metrics"),
        (base(json!({"period": "30d"})), "braucht dateColumn"),
        (
            base(json!({"period": "decade"})),
            "period 'decade' unbekannt",
        ),
        (base(json!({"sql": "DELETE FROM orders"})), "read-only"),
        (
            base(json!({"sql": "SELECT 1 AS n; SELECT 2 AS n"})),
            "Nur ein Statement",
        ),
        (
            base(
                json!({"sql": "SELECT status, COUNT(customer_email) AS n FROM orders GROUP BY status"}),
            ),
            "redigiert",
        ),
        (
            base(json!({"sql": "SELECT status, COUNT(*) AS total FROM orders GROUP BY status"})),
            "Spalte 'n' fehlt im Ergebnis. Spalten: status, total",
        ),
        (
            base(json!({"metrics": ["status"], "dimension": "n"})),
            "nicht numerisch",
        ),
        (base(json!({"metrics": ["n", "n"]})), "doppelt"),
        (base(json!({"sql": "SELEC broken"})), "SQL-Fehler"),
        (base(json!({"sql": "  "})), "sql fehlt"),
        (
            base(json!({"type": "donut", "options": {"stacked": true}})),
            "Option 'stacked' gibt es bei 'donut' nicht",
        ),
        (base(json!({"options": {"colorOffset": 9}})), "0 bis 7"),
        (
            base(json!({"options": {"curve": "smooth"}})),
            "Option 'curve' gibt es bei 'column' nicht",
        ),
        (
            base(json!({"type": "line", "options": {"curve": "smooth"}})),
            "'monotone' oder 'linear'",
        ),
        (
            base(json!({"options": {"sortBy": "random"}})),
            "'none', 'asc' oder 'desc'",
        ),
        (
            base(json!({"options": {"labels": "yes"}})),
            "true oder false",
        ),
        (
            base(json!({"options": {"metricKeys": ["x"]}})),
            "keine der metrics",
        ),
        (base(json!({"options": "wide"})), "options muss ein Objekt"),
        (base(json!({"x": 10})), "x muss 0 bis 6"),
        (base(json!({"w": 2})), "w für 'column' muss 3 bis 12"),
        (base(json!({"h": 99})), "h für 'column' muss 5 bis 40"),
        (base(json!({"y": "top"})), "y muss eine Ganzzahl"),
        (base(json!({"colour": "red"})), "Unbekanntes Feld 'colour'"),
        (
            base(json!({"metrics": {"a": 1}})),
            "metrics muss eine Liste",
        ),
        (base(json!({"title": {"a": 1}})), "title muss ein Text"),
        (json!("column"), "muss ein Objekt sein"),
    ];
    for (spec, expected) in cases {
        let error = lab.err(
            json!({"action": "add_charts", "dashboard": "Sales", "charts": [
                {"type": "kpi", "title": "Fine", "sql": "SELECT created_at, 1 AS one FROM orders", "metrics": ["one"], "dateColumn": "created_at"},
                spec.clone()
            ]}),
        );
        assert!(
            error.contains(expected),
            "{spec}: expected '{expected}' in '{error}'"
        );
        assert!(error.starts_with("Chart "), "{error}");
    }
    let after =
        std::fs::read(dir().join(format!("{}.json", lab.only()["id"].as_str().unwrap()))).unwrap();
    assert_eq!(before, after);
    assert!(lab
        .err(json!({"action": "add_charts", "dashboard": "Sales", "charts": []}))
        .contains("nicht-leere Liste"));
    let many: Vec<Value> = (0..MAX_CHARTS)
        .map(|_| json!({"type": "table", "sql": "SELECT 1 AS one"}))
        .collect();
    assert!(lab
        .err(json!({"action": "add_charts", "dashboard": "Sales", "charts": many}))
        .contains("Maximal 60"));
}

#[test]
fn corrects_column_case_and_reports_notes() {
    let mut lab = lab();
    lab.create_sales();
    let text = lab.ok(json!({"action": "add_charts", "dashboard": "Sales", "charts": [
        {"type": "bars", "title": "By region", "sql": "SELECT region AS Region, SUM(amount) AS Revenue FROM orders GROUP BY 1", "dimension": "region", "metrics": ["REVENUE"]},
        {"type": "table", "title": "Empty", "sql": "SELECT * FROM orders WHERE 1 = 0"}
    ]}));
    assert!(text.contains("'region' als 'Region' übernommen"), "{text}");
    assert!(
        text.contains("'REVENUE' als 'Revenue' übernommen"),
        "{text}"
    );
    assert!(text.contains("Ergebnis ist aktuell leer"), "{text}");
    let dashboard = lab.only();
    let mapping = &dataset_for(&dashboard, "By region")["mapping"];
    assert_eq!(mapping["dimension"], "Region");
    assert_eq!(mapping["metrics"], json!(["Revenue"]));
    assert_grid(&dashboard);
}

#[test]
fn updates_charts_incrementally() {
    let mut lab = lab();
    lab.create_sales();
    lab.ok(json!({"action": "add_charts", "dashboard": "Sales", "charts": [
        {"type": "column", "title": "Status", "sql": "SELECT status, COUNT(*) AS n FROM orders GROUP BY status", "dimension": "status", "metrics": ["n"], "options": {"sortBy": "desc", "stacked": false}, "w": 5, "h": 6}
    ]}));
    let before = lab.only();
    let status = widget(&before, "Status").clone();
    let dataset_id = status["datasetId"].clone();

    lab.ok(json!({"action": "update_chart", "dashboard": "Sales", "chart": "status", "spec": {"title": "Status mix", "options": {"labels": true, "stacked": null}}}));
    let after = lab.only();
    let changed = widget(&after, "Status mix");
    assert_eq!(changed["id"], status["id"]);
    assert_eq!(
        changed["options"],
        json!({"sortBy": "desc", "labels": true})
    );
    assert_eq!(rect(changed), rect(&status));
    assert_eq!(changed["datasetId"], dataset_id);

    let text = lab.ok(json!({"action": "update_chart", "dashboard": "Sales", "chart": status["id"], "spec": {"type": "line"}}));
    assert!(text.contains(" line at"), "{text}");
    let line = widget(&lab.only(), "Status mix").clone();
    assert_eq!(line["options"], json!({"labels": true}));
    assert_eq!((line["w"].as_i64(), line["h"].as_i64()), (Some(5), Some(6)));
    lab.ok(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Revenue", "spec": {"type": "table"}}));
    assert_eq!(rect(widget(&lab.only(), "Revenue")), (0, 0, 3, 5));

    lab.ok(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Status mix", "spec": {"x": 0, "y": 0}}));
    let moved = lab.only();
    assert_grid(&moved);
    assert_eq!(rect(widget(&moved, "Status mix")).0, 0);
    assert!(rect(widget(&moved, "Status mix")).1 >= 4);

    let text = lab.ok(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Status mix", "spec": {"sql": "SELECT status, SUM(amount) AS total FROM orders GROUP BY status", "metrics": ["total"]}}));
    assert!(text.contains("total"), "{text}");
    let data = lab.only();
    let dataset = dataset_for(&data, "Status mix");
    assert_eq!(dataset["id"], dataset_id);
    assert_eq!(dataset["mapping"]["dimension"], "status");
    assert_eq!(dataset["mapping"]["metrics"], json!(["total"]));
    assert_eq!(data["datasets"].as_array().unwrap().len(), 2);

    let error = lab.err(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Status mix", "spec": {"type": "gauge"}}));
    assert!(error.contains("nur ohne dimension"), "{error}");
    let error = lab.err(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Status mix", "spec": {"metrics": ["n"]}}));
    assert!(error.contains("Spalte 'n' fehlt"), "{error}");
    assert!(lab.err(json!({"action": "update_chart", "dashboard": "Sales", "chart": "nope", "spec": {"title": "x"}})).contains("nicht gefunden"));
    assert!(lab.err(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Status mix", "spec": {}})).contains("spec"));
    assert_eq!(lab.only(), data);
}

#[test]
fn keeps_app_edits_shared_datasets_and_builder_charts() {
    let mut lab = lab();
    let stamp = mcp_dashboard_save(json!({
        "id": "app-made",
        "connectionId": "shop",
        "name": "From app",
        "refreshSec": 30,
        "datasets": [
            {"id": "shared", "name": "Shared", "mode": "expert", "simple": empty_simple(), "sql": "SELECT status, COUNT(*) AS n FROM orders GROUP BY status", "mapping": {"dimension": "status", "dimension2": null, "metrics": ["n"], "dateColumn": null}},
            {"id": "builder", "name": "Builder", "mode": "simple", "simple": {"schema": "", "table": "orders", "join": null, "joins": [], "dimension": {"column": "status", "bucket": "none"}, "dimension2": null, "metrics": [{"id": "m", "agg": "sum", "column": "amount", "label": ""}], "filters": [], "dateColumn": null, "sort": "dimension", "limit": 50}, "sql": "", "mapping": {"dimension": null, "dimension2": null, "metrics": [], "dateColumn": null}}
        ],
        "widgets": [
            {"id": "w1", "chart": "donut", "datasetId": "shared", "title": "One", "period": "all", "x": 0, "y": 0, "w": 4, "h": 8},
            {"id": "w2", "chart": "bars", "datasetId": "shared", "title": "Two", "period": "all", "x": 4, "y": 0, "w": 4, "h": 8},
            {"id": "w3", "chart": "column", "datasetId": "builder", "title": "Three", "period": "all", "x": 8, "y": 0, "w": 4, "h": 8}
        ]
    }))
    .unwrap();
    let listed = list_dashboards();
    assert_eq!(listed[0]["stamp"], stamp);

    lab.ok(json!({"action": "update_chart", "dashboard": "From app", "chart": "Two", "spec": {"sql": "SELECT status, SUM(amount) AS total FROM orders GROUP BY status", "metrics": ["total"]}}));
    let dashboard = lab.only();
    assert_eq!(dataset_for(&dashboard, "One")["id"], "shared");
    assert_eq!(
        dataset_for(&dashboard, "One")["mapping"]["metrics"],
        json!(["n"])
    );
    assert_ne!(dataset_for(&dashboard, "Two")["id"], "shared");
    assert_eq!(
        dataset_for(&dashboard, "Two")["mapping"]["metrics"],
        json!(["total"])
    );
    assert_eq!(dashboard["refreshSec"], 30);

    lab.ok(json!({"action": "update_chart", "dashboard": "From app", "chart": "Three", "spec": {"type": "treemap", "title": "Treemap"}}));
    let treemap = widget(&lab.only(), "Treemap").clone();
    assert_eq!(treemap["chart"], "treemap");
    assert_eq!(rect(&treemap), (8, 0, 4, 8));
    lab.ok(json!({"action": "update_chart", "dashboard": "From app", "chart": "Treemap", "spec": {"w": 6}}));
    assert_eq!(rect(widget(&lab.only(), "Treemap")), (6, 8, 6, 8));
    assert_grid(&lab.only());
    assert!(lab
        .err(json!({"action": "update_chart", "dashboard": "From app", "chart": "Treemap", "spec": {"x": 8}}))
        .contains("x muss 0 bis 6"));
    assert!(lab
        .err(json!({"action": "update_chart", "dashboard": "From app", "chart": "Treemap", "spec": {"type": "gauge"}}))
        .contains("nur ohne dimension"));
    let error = lab.err(json!({"action": "update_chart", "dashboard": "From app", "chart": "Treemap", "spec": {"metrics": ["n"]}}));
    assert!(error.contains("nicht numerisch"), "{error}");
    lab.ok(json!({"action": "update_chart", "dashboard": "From app", "chart": "Treemap", "spec": {"metrics": ["avg(amount)"]}}));
    let simple = dataset_for(&lab.only(), "Treemap")["simple"].clone();
    assert_eq!(simple["dimension"]["column"], "status");
    assert_eq!(simple["metrics"][0]["agg"], "avg");
    let got = lab.ok(json!({"action": "get", "dashboard": "app-made"}));
    assert!(got.contains("\"builder\""), "{got}");
    let preview = lab.ok(json!({"action": "preview", "dashboard": "From app", "chart": "Treemap"}));
    assert!(preview.contains("Mapping: ok"), "{preview}");

    lab.ok(json!({"action": "remove_chart", "dashboard": "From app", "chart": "One"}));
    let dashboard = lab.only();
    let ids: Vec<&str> = dashboard["datasets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), 2);
    assert!(!ids.contains(&"shared"));
    assert!(ids.contains(&"builder"));
}

#[test]
fn manages_dashboard_lifecycle() {
    let mut lab = lab();
    let id = lab.create_sales();
    assert!(lab
        .err(json!({"action": "create", "connection": "Shop", "name": "sales"}))
        .contains("gibt es für 'Shop' schon"));
    lab.ok(json!({"action": "create", "connection": "Shop Copy", "name": "Sales"}));
    let ambiguous = lab.err(json!({"action": "get", "dashboard": "Sales"}));
    assert!(
        ambiguous.contains("mehrdeutig") && ambiguous.contains(&id),
        "{ambiguous}"
    );
    assert!(lab
        .ok(json!({"action": "get", "dashboard": id}))
        .contains("\"Revenue\""));

    let text = lab.ok(
        json!({"action": "update", "dashboard": id, "name": "Revenue board", "refreshSec": 300}),
    );
    assert!(
        text.contains("name='Revenue board'") && text.contains("refreshSec=300"),
        "{text}"
    );
    for (args, expected) in [
        (
            json!({"action": "update", "dashboard": id, "refreshSec": 5}),
            "refreshSec muss",
        ),
        (
            json!({"action": "update", "dashboard": id, "refreshSec": -1}),
            "refreshSec muss",
        ),
        (json!({"action": "update", "dashboard": id}), "braucht name"),
        (
            json!({"action": "update", "dashboard": id, "name": " "}),
            "name fehlt",
        ),
        (
            json!({"action": "update", "dashboard": id, "name": "x".repeat(121)}),
            "länger als 120",
        ),
        (
            json!({"action": "create", "connection": "Shop"}),
            "name fehlt",
        ),
        (
            json!({"action": "create", "connection": "Hidden", "name": "x"}),
            "nicht freigegeben",
        ),
        (
            json!({"action": "create", "connection": "Mongo", "name": "x"}),
            "brauchen eine SQL-Verbindung",
        ),
        (
            json!({"action": "create", "connection": "Shop", "name": "x", "charts": "all"}),
            "nicht-leere Liste",
        ),
        (
            json!({"action": "delete", "dashboard": ""}),
            "dashboard fehlt",
        ),
        (
            json!({"action": "remove_chart", "dashboard": id, "chart": ""}),
            "chart fehlt",
        ),
        (json!({"action": "launch"}), "Unbekannte action"),
        (json!({}), "action fehlt"),
    ] {
        let error = lab.err(args.clone());
        assert!(error.contains(expected), "{args}: {error}");
    }

    lab.ok(json!({"action": "remove_chart", "dashboard": "Revenue board", "chart": "revenue"}));
    let board = read_all()
        .into_iter()
        .find(|(d, _)| d["id"] == id.as_str())
        .unwrap()
        .0;
    assert_eq!(board["widgets"], json!([]));
    assert_eq!(board["datasets"], json!([]));
    assert_eq!(board["refreshSec"], 300);

    assert!(lab
        .ok(json!({"action": "delete", "dashboard": id}))
        .contains("gelöscht"));
    assert_eq!(read_all().len(), 1);
    assert!(lab
        .err(json!({"action": "get", "dashboard": id}))
        .contains("nicht gefunden"));
}

#[test]
fn hides_dashboards_of_unexposed_connections() {
    let mut lab = lab();
    mcp_dashboard_save(json!({"id": "secret", "connectionId": "hidden", "name": "Secret", "datasets": [], "widgets": []})).unwrap();
    mcp_dashboard_save(json!({"id": "gone", "connectionId": "deleted", "name": "Gone", "datasets": [], "widgets": []})).unwrap();
    assert!(lab.ok(json!({"action": "list"})).contains("Keine"));
    assert!(lab
        .err(json!({"action": "get", "dashboard": "secret"}))
        .contains("nicht gefunden"));
    assert!(lab
        .err(json!({"action": "delete", "dashboard": "Secret"}))
        .contains("nicht gefunden"));
    assert_eq!(list_dashboards().len(), 2);
}

#[test]
fn previews_specs_and_existing_charts() {
    let mut lab = lab();
    lab.create_sales();
    let text = lab.ok(json!({"action": "preview", "connection": "Shop", "limit": 2, "spec": {
        "type": "donut", "sql": "SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY status", "dimension": "status", "metrics": ["n"]
    }}));
    assert!(
        text.starts_with("status\tn\nopen\t1\npaid\t3\n(2 rows, 1 more"),
        "{text}"
    );
    assert!(text.ends_with("Mapping: ok"), "{text}");
    let text = lab.ok(json!({"action": "preview", "connection": "Shop", "spec": {
        "type": "gauge", "sql": "SELECT status, id FROM orders", "dimension": "status", "metrics": ["status", "x"]
    }}));
    assert!(text.contains("Mapping: Spalte 'x' fehlt"), "{text}");
    assert!(
        text.contains("Passung: 'gauge' funktioniert nur ohne dimension"),
        "{text}"
    );
    let text = lab.ok(
        json!({"action": "preview", "connection": "Shop", "spec": {"sql": "SELECT * FROM orders"}}),
    );
    assert!(
        text.contains("[redacted]") && text.contains("cells redacted"),
        "{text}"
    );
    let text = lab.ok(json!({"action": "preview", "dashboard": "Sales", "chart": "Revenue"}));
    assert!(
        text.starts_with("month\trevenue\n2026-01\t200.5\n2026-02\t345.25\n2026-03\t510"),
        "{text}"
    );
    assert!(lab
        .err(json!({"action": "preview", "connection": "Shop", "spec": {"sql": "UPDATE orders SET amount = 0"}}))
        .contains("read-only"));
    assert!(lab
        .err(json!({"action": "preview", "connection": "Shop", "spec": {"type": "donut"}}))
        .contains("spec.sql oder spec.builder fehlt"));
}

#[test]
fn app_commands_guard_paths_and_keep_created_at() {
    let _lab = lab();
    for bad in ["../evil", "", "a/b", "x.json", &"a".repeat(65)] {
        assert!(
            mcp_dashboard_save(
                json!({"id": bad, "connectionId": "shop", "datasets": [], "widgets": []})
            )
            .is_err(),
            "{bad}"
        );
        assert!(mcp_dashboard_delete(bad.to_string()).is_err(), "{bad}");
    }
    assert!(mcp_dashboard_save(json!({"id": "ok", "datasets": [], "widgets": []})).is_err());
    assert!(
        mcp_dashboard_save(json!({"id": "ok", "connectionId": "shop", "widgets": []})).is_err()
    );
    let first = mcp_dashboard_save(
        json!({"id": "ok", "connectionId": "shop", "name": "A", "datasets": [], "widgets": []}),
    )
    .unwrap();
    let created = list_dashboards()[0]["createdAt"].as_i64().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    let second = mcp_dashboard_save(json!({"id": "ok", "connectionId": "shop", "name": "B", "datasets": [], "widgets": [], "extra": "dropped"})).unwrap();
    assert_ne!(first, second);
    let listed = list_dashboards();
    assert_eq!(listed[0]["createdAt"].as_i64().unwrap(), created);
    assert_eq!(listed[0]["name"], "B");
    assert_eq!(listed[0]["stamp"], second);
    assert!(listed[0].get("extra").is_none());
    std::fs::write(dir().join("broken.json"), "{nope").unwrap();
    std::fs::write(
        dir().join("mismatch.json"),
        r#"{"id":"other","datasets":[],"widgets":[]}"#,
    )
    .unwrap();
    std::fs::write(dir().join("notes.txt"), "x").unwrap();
    assert_eq!(list_dashboards().len(), 1);
    mcp_dashboard_delete("ok".into()).unwrap();
    mcp_dashboard_delete("ok".into()).unwrap();
    assert!(list_dashboards().is_empty());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        mcp_dashboard_save(
            json!({"id": "perm", "connectionId": "shop", "datasets": [], "widgets": []}),
        )
        .unwrap();
        let mode = std::fs::metadata(dir().join("perm.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn works_over_json_rpc_and_writes_audit() {
    let mut lab = lab();
    let line = json!({"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "dashboard", "arguments": {
        "action": "create", "connection": "Shop", "name": "RPC",
        "charts": [{"type": "funnel", "title": "Funnel", "sql": "SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY n DESC", "dimension": "status", "metrics": ["n"]}]
    }}});
    let reply = lab
        .runtime
        .block_on(lab.server.handle_line(&line.to_string()))
        .unwrap();
    assert_eq!(reply["id"], 7);
    assert_eq!(reply["result"]["isError"], false, "{reply}");
    let tools = lab
        .runtime
        .block_on(
            lab.server
                .handle_line(r#"{"jsonrpc":"2.0","id":8,"method":"tools/list"}"#),
        )
        .unwrap();
    assert!(tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["name"] == "dashboard"));
    lab.err(json!({"action": "add_charts", "dashboard": "RPC", "charts": [{"type": "table", "sql": "SELECT nope FROM orders"}]}));
    let audit = std::fs::read_to_string(config::audit_path()).unwrap();
    let entries: Vec<Value> = audit
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert!(entries.iter().any(|e| e["tool"] == "dashboard"
        && e["ok"] == true
        && e["sql"].as_str().unwrap().contains("ORDER BY n DESC")));
    assert!(entries
        .iter()
        .any(|e| e["tool"] == "dashboard.create" && e["sql"] == "RPC"));
    assert!(entries.iter().any(|e| e["tool"] == "dashboard"
        && e["ok"] == false
        && e["sql"].as_str().unwrap().contains("nope")));
}

#[test]
fn places_widgets_in_free_slots() {
    let widget = |x: i64, y: i64, w: i64, h: i64| json!({"x": x, "y": y, "w": w, "h": h});
    assert_eq!(place(&[], 6, 7), (0, 0));
    assert_eq!(place(&[widget(0, 0, 6, 7)], 6, 7), (6, 0));
    assert_eq!(
        place(&[widget(0, 0, 6, 7), widget(6, 0, 6, 3)], 6, 7),
        (6, 3)
    );
    assert_eq!(place(&[widget(0, 0, 12, 4)], 3, 4), (0, 4));
    let full: Vec<Value> = (0..4).map(|i| widget(i * 3, 0, 3, 4)).collect();
    assert_eq!(place(&full, 12, 2), (0, 4));
}

#[test]
fn only_read_only_expert_sql_of_known_connections_is_trusted() {
    let config = McpConfig {
        connections: vec![
            connection(
                "pg",
                "PG",
                DatabaseKind::Postgres,
                "postgres://u@h/db",
                true,
            ),
            connection("my", "My", DatabaseKind::Mysql, "mysql://u@h/db", false),
        ],
        ..McpConfig::default()
    };
    let board = |connection: &str, sqls: &[&str]| {
        let datasets: Vec<Value> = sqls
            .iter()
            .map(|sql| json!({"id": "d", "mode": "expert", "sql": sql}))
            .chain([json!({"id": "s", "mode": "simple", "sql": "DELETE FROM x"})])
            .collect();
        json!({"id": "m1", "connectionId": connection, "datasets": datasets, "widgets": [], "trusted": true})
    };
    for (connection, sqls) in [
        (
            "pg",
            vec!["SELECT status, count(*) AS n FROM orders GROUP BY status"],
        ),
        ("my", vec!["select 1 as n", "  "]),
        ("pg", vec![]),
    ] {
        assert!(trusted(&board(connection, &sqls), &config), "{sqls:?}");
    }
    for (connection, sqls) in [
        ("pg", vec!["DELETE FROM orders RETURNING status, 1 AS n"]),
        (
            "pg",
            vec![
                "select 1 as n",
                "UPDATE orders SET status = 'x' RETURNING status",
            ],
        ),
        ("pg", vec!["select 1 as n; drop table orders"]),
        (
            "pg",
            vec!["select set_config('default_transaction_read_only', 'off', false)"],
        ),
        ("my", vec!["insert into orders values (1)"]),
        ("unknown", vec!["select 1 as n"]),
    ] {
        assert!(!trusted(&board(connection, &sqls), &config), "{sqls:?}");
    }
}

#[test]
fn accepts_loose_llm_arguments_and_infers_mappings() {
    let mut lab = lab();
    let charts = json!([
        {"chart": "pie", "title": "Status", "query": "SELECT status, COUNT(*) AS orders FROM orders GROUP BY status"},
        {"type": "bar", "title": "Regions", "sql": "SELECT region, SUM(amount) AS revenue FROM orders GROUP BY region", "x": "region", "y": "revenue", "w": "6"},
        {"type": "number", "title": "Total", "sql": "SELECT created_at, SUM(amount) AS total FROM orders GROUP BY created_at", "date": "created_at"},
        {"type": "line_chart", "title": "Trend", "sql": "SELECT created_at AS day, COUNT(*) AS orders, SUM(amount) AS revenue FROM orders GROUP BY day ORDER BY day", "date_column": "day", "options": "{\"showLegend\": true}"},
        {"type": "heatmap", "title": "Matrix", "sql": "SELECT region, status, COUNT(*) AS n FROM orders GROUP BY region, status"}
    ]);
    let text = lab.ok(json!({
        "action": "create",
        "connection": "Shop",
        "name": "Loose",
        "refresh_sec": "60",
        "charts": charts.to_string()
    }));
    assert!(
        text.contains("Mapping ergänzt: dimension=status, metrics=orders"),
        "{text}"
    );
    let board = lab.only();
    assert_eq!(board["refreshSec"], 60);
    assert_eq!(widget(&board, "Status")["chart"], "donut");
    assert_eq!(widget(&board, "Regions")["chart"], "column");
    assert_eq!(widget(&board, "Regions")["w"], 6);
    assert_eq!(widget(&board, "Total")["chart"], "kpi");
    assert_eq!(widget(&board, "Trend")["options"]["showLegend"], true);
    let mapping = |title: &str| dataset_for(&board, title)["mapping"].clone();
    assert_eq!(mapping("Regions")["dimension"], "region");
    assert_eq!(mapping("Regions")["metrics"], json!(["revenue"]));
    assert_eq!(mapping("Total")["metrics"], json!(["total"]));
    assert_eq!(mapping("Total")["dimension"], Value::Null);
    assert_eq!(mapping("Total")["dateColumn"], "created_at");
    assert_eq!(mapping("Trend")["dimension"], "day");
    assert_eq!(mapping("Trend")["dateColumn"], "day");
    assert_eq!(mapping("Trend")["metrics"], json!(["orders", "revenue"]));
    assert_eq!(mapping("Matrix")["dimension2"], "status");
    assert_eq!(mapping("Matrix")["metrics"], json!(["n"]));
    lab.ok(json!({"action": "add_charts", "dashboard": "Loose", "charts": {"type": "kpi", "title": "Single", "sql": "SELECT created_at, COUNT(*) AS n FROM orders GROUP BY created_at", "dateColumn": "created_at"}}));
    lab.ok(json!({"action": "update_chart", "dashboard": "Loose", "chart": "Single", "spec": "{\"title\": \"Renamed\"}"}));
    assert_eq!(widget(&lab.only(), "Renamed")["chart"], "kpi");
}

fn add_regions(lab: &Lab) {
    let db = rusqlite::Connection::open(lab.dir.join("shop.db")).unwrap();
    db.execute_batch(
        "CREATE TABLE regions(code TEXT, name TEXT, tier TEXT);
         INSERT INTO regions VALUES ('EU', 'Europa', 'A'), ('US', 'Amerika', 'B'), ('APAC', 'Asien', 'B');",
    )
    .unwrap();
}

fn regional_chart() -> Value {
    json!({
        "type": "column",
        "title": "Umsatz je Region",
        "builder": {
            "table": "orders",
            "joins": [{"table": "regions", "as": "r", "on": "region = code", "kind": "inner"}],
            "fields": [{"name": "Schnitt", "expr": "sum([amount]) / nullif(count(*), 0)"}],
            "dimension": "r.name",
            "metrics": ["sum(amount)", "Schnitt"],
            "filters": [{"field": "region", "op": "eq", "value": "{{region}}"}],
            "sort": "metric_desc"
        }
    })
}

#[test]
fn builds_editable_builder_charts_with_joins_fields_and_variables() {
    let mut lab = lab();
    add_regions(&lab);
    let text = lab.ok(json!({
        "action": "create",
        "connection": "Shop",
        "name": "Regionen",
        "variables": [{"name": "region", "label": "Region", "type": "select", "optionsSql": "SELECT DISTINCT region FROM orders"}],
        "charts": [regional_chart()]
    }));
    assert!(text.contains("Europa"), "{text}");
    let dashboard = lab.only();
    assert_eq!(dashboard["variables"][0]["name"], "region");
    let dataset = dataset_for(&dashboard, "Umsatz je Region");
    assert_eq!(dataset["mode"], "simple");
    let simple = &dataset["simple"];
    let join_id = simple["joins"][0]["id"].as_str().unwrap();
    assert_eq!(join_id, ".regions.region.code");
    assert_eq!(simple["joins"][0]["kind"], "inner");
    assert_eq!(simple["joins"][0]["manual"], true);
    assert_eq!(
        simple["dimension"]["column"],
        format!("join:{join_id}:name")
    );
    assert_eq!(simple["calculated"][0]["aggregate"], true);
    assert_eq!(
        simple["calculated"][0]["expr"],
        "sum([[amount]]) / nullif(count(*), 0)"
    );
    assert_eq!(
        simple["metrics"][1]["column"],
        format!("calc:{}", simple["calculated"][0]["id"].as_str().unwrap())
    );
    assert_eq!(simple["filters"][0]["value"], "{{region}}");

    let got = lab.ok(json!({"action": "get", "dashboard": "Regionen"}));
    assert!(
        got.contains("\"field\": \"r.name\"") || got.contains("\"field\": \"regions.name\""),
        "{got}"
    );
    assert!(got.contains("sum([amount])"), "{got}");
    assert!(got.contains("\"variables\""), "{got}");

    let all = lab.ok(json!({"action": "run", "dashboard": "Regionen"}));
    assert!(all.starts_with("1 ok, 0 mit Problemen"), "{all}");
    assert!(all.contains("Amerika") && all.contains("Europa"), "{all}");
    let eu = lab.ok(json!({"action": "run", "dashboard": "Regionen", "values": {"region": "EU"}}));
    assert!(eu.contains("Europa") && !eu.contains("Amerika"), "{eu}");
    assert!(eu.contains("region='EU'"), "{eu}");

    let preview = lab.ok(json!({"action": "preview", "dashboard": "Regionen", "chart": "Umsatz je Region", "values": {"region": "US"}}));
    assert!(
        preview.contains("Amerika") && !preview.contains("Europa"),
        "{preview}"
    );

    assert_eq!(list_dashboards()[0]["trusted"], true);
}

#[test]
fn rejects_unknown_variables_and_bad_builder_specs() {
    let mut lab = lab();
    add_regions(&lab);
    let missing = lab.err(json!({"action": "create", "connection": "Shop", "name": "X", "charts": [regional_chart()]}));
    assert!(
        missing.contains("{{region}} ist nicht definiert"),
        "{missing}"
    );
    let sql = lab.err(json!({"action": "create", "connection": "Shop", "name": "X", "charts": [{"type": "kpi", "sql": "SELECT created_at, COUNT(*) AS n FROM orders WHERE region = {{land}} GROUP BY created_at", "dateColumn": "created_at"}]}));
    assert!(sql.contains("{{land}}"), "{sql}");
    let bad_join = lab.err(json!({"action": "create", "connection": "Shop", "name": "X", "charts": [{"type": "kpi", "builder": {"table": "orders", "joins": [{"table": "regions", "on": "region"}], "dateColumn": "created_at"}}]}));
    assert!(bad_join.contains("spalte = spalte"), "{bad_join}");
    let bad_var = lab.err(json!({"action": "create", "connection": "Shop", "name": "X", "variables": [{"name": "1x"}]}));
    assert!(bad_var.contains("ungültig"), "{bad_var}");
    let write = lab.err(json!({"action": "create", "connection": "Shop", "name": "X", "variables": [{"name": "r", "type": "select", "optionsSql": "DELETE FROM orders"}]}));
    assert!(write.contains("optionsSql"), "{write}");

    lab.ok(json!({"action": "create", "connection": "Shop", "name": "Regionen", "variables": [{"name": "region", "type": "text"}], "charts": [regional_chart()]}));
    let removed = lab.err(json!({"action": "update", "dashboard": "Regionen", "variables": []}));
    assert!(removed.contains("Umsatz je Region"), "{removed}");
    lab.ok(json!({"action": "update", "dashboard": "Regionen", "variables": [{"name": "region", "type": "text", "default": "APAC"}]}));
    let run = lab.ok(json!({"action": "run", "dashboard": "Regionen"}));
    assert!(run.contains("Asien") && !run.contains("Europa"), "{run}");
}

#[test]
fn builder_sql_and_variables_quote_per_dialect() {
    let variables = vec![
        json!({"name": "m", "type": "text", "defaultValue": "a'b\\c"}),
        json!({"name": "n", "type": "number", "defaultValue": "1; DROP"}),
        json!({"name": "d", "type": "date", "defaultValue": "2026-10-06"}),
    ];
    let empty = Map::new();
    assert_eq!(
        builder::substitute(
            "{{m}} {{n}} {{d}} {{x}}",
            &variables,
            &empty,
            DatabaseKind::Clickhouse
        ),
        "'a''b\\\\c' NULL '2026-10-06' {{x}}"
    );
    assert_eq!(
        builder::substitute("{{ d }}", &variables, &empty, DatabaseKind::Oracle),
        "DATE '2026-10-06'"
    );
    assert_eq!(
        builder::substitute(
            "SELECT '{{d}}', 'it''s {{d}}', 'x\\'{{d}}', \"{{d}}\", {{d}}, {x}",
            &variables,
            &empty,
            DatabaseKind::Postgres
        ),
        "SELECT '{{d}}', 'it''s {{d}}', 'x\\'{{d}}', \"{{d}}\", '2026-10-06', {x}"
    );
    let simple = builder::parse_builder(&json!({
        "table": "wms.bestand",
        "joins": [{"table": "artikel", "on": [["artikel_id", "id"], ["mandant", "mandant"]]}],
        "dimension": {"field": "eingelagert", "bucket": "month"},
        "metrics": ["count"],
        "limit": 10
    }))
    .unwrap();
    assert_eq!(
        builder::builder_sql(&simple, DatabaseKind::Mssql, &[], &empty),
        "SELECT TOP 10 CAST(DATEADD(month, DATEDIFF(month, 0, t1.[eingelagert]), 0) AS date) AS [dim], COUNT(*) AS [m0]\nFROM [wms].[bestand] AS t1\nLEFT JOIN [wms].[artikel] AS t2 ON t2.[id] = t1.[artikel_id] AND t2.[mandant] = t1.[mandant]\nGROUP BY CAST(DATEADD(month, DATEDIFF(month, 0, t1.[eingelagert]), 0) AS date)\nORDER BY [dim] ASC"
    );
}

fn add_items(lab: &Lab) {
    let db = rusqlite::Connection::open(lab.dir.join("shop.db")).unwrap();
    db.execute_batch(
        "CREATE TABLE order_items(item_id INTEGER, order_id INTEGER, sku TEXT, qty INTEGER);
         INSERT INTO order_items VALUES (1, 1, 'A', 2), (2, 1, 'B', 1), (3, 1, 'C', 4), (4, 2, 'A', 1);",
    )
    .unwrap();
}

#[test]
fn suggests_and_measures_joins_like_the_studio() {
    let mut lab = lab();
    add_regions(&lab);
    add_items(&lab);
    let text = lab.ok(json!({"action": "joins", "connection": "Shop", "table": "orders"}));
    let line = text
        .lines()
        .find(|l| l.contains("order_items"))
        .unwrap_or_else(|| panic!("{text}"));
    assert!(line.contains("\"on\":\"id = order_id\""), "{line}");
    assert!(line.contains("40 % Treffer"), "{line}");
    assert!(line.contains("2.0 Zeilen je Treffer"), "{line}");
    let only = lab.ok(
        json!({"action": "joins", "connection": "Shop", "table": "orders", "tables": ["regions"]}),
    );
    assert!(only.starts_with("Keine Verknüpfung"), "{only}");
    assert!(lab
        .err(json!({"action": "joins", "connection": "Shop", "table": "nope"}))
        .contains("nicht gefunden"));

    let created = lab.ok(json!({
        "action": "create",
        "connection": "Shop",
        "name": "Joins",
        "charts": [
            {"type": "column", "title": "Regionen", "builder": {"table": "orders", "joins": [{"table": "regions", "on": "region = code"}], "dimension": "regions.name", "metrics": ["sum(amount)"]}},
            {"type": "kpi", "title": "Menge", "builder": {"table": "orders", "joins": [{"table": "order_items", "as": "i", "on": "id = order_id"}], "metrics": ["sum(i.qty)"], "dateColumn": "created_at"}}
        ]
    }));
    assert!(
        created.contains("Join orders → regions (region = code): 100 % Treffer"),
        "{created}"
    );
    assert!(
        created.contains("Join orders → order_items (id = order_id): 40 % Treffer"),
        "{created}"
    );
    assert!(
        created.contains("kind=inner") && created.contains("Summen werden vervielfacht"),
        "{created}"
    );

    let patched = lab.ok(json!({"action": "update_chart", "dashboard": "Joins", "chart": "Regionen", "spec": {"builder": {"joins": [{"table": "regions", "on": "region = code", "kind": "inner"}], "dimension2": "status"}}}));
    assert!(patched.contains("100 % Treffer"), "{patched}");
    let simple = dataset_for(&lab.only(), "Regionen")["simple"].clone();
    assert_eq!(simple["joins"][0]["kind"], "inner");
    assert_eq!(simple["metrics"][0]["agg"], "sum");
    assert_eq!(simple["dimension2"], "status");
    assert!(simple["dimension"]["column"]
        .as_str()
        .unwrap()
        .ends_with(":name"));
}

#[test]
fn validates_comparison_and_number_options() {
    let mut lab = lab();
    lab.create_sales();
    lab.ok(json!({"action": "add_charts", "dashboard": "Sales", "charts": [
        {"type": "kpi", "title": "Umsatz", "sql": "SELECT substr(created_at, 1, 7) AS monat, SUM(amount) AS \"Umsatz\" FROM orders GROUP BY 1 ORDER BY 1", "dimension": "monat", "metrics": ["Umsatz"], "options": {"compare": "year", "headline": "last", "unit": " € ", "decimals": 2, "invertDelta": false}},
        {"type": "column", "title": "Status", "sql": "SELECT status, COUNT(*) AS \"Anzahl\" FROM orders GROUP BY status", "options": {"horizontal": true, "compare": "none", "headline": "max", "unit": "Stk.", "decimals": "0", "invert_delta": true}},
        {"type": "table", "title": "Liste", "sql": "SELECT id, amount FROM orders", "options": {"compare": "previous", "unit": "€", "decimals": 4, "invertDelta": true}},
        {"type": "gauge", "title": "Ziel", "sql": "SELECT SUM(amount) AS value, MAX(target) AS goal FROM orders", "options": {"unit": "%", "decimals": 1}}
    ]}));
    let board = lab.only();
    assert_eq!(
        widget(&board, "Umsatz")["options"],
        json!({"compare": "year", "headline": "last", "unit": "€", "decimals": 2, "invertDelta": false})
    );
    assert_eq!(
        widget(&board, "Status")["options"],
        json!({"horizontal": true, "compare": "none", "headline": "max", "unit": "Stk.", "decimals": 0, "invertDelta": true})
    );
    assert_eq!(widget(&board, "Liste")["options"]["decimals"], 4);
    assert_eq!(widget(&board, "Ziel")["options"]["unit"], "%");
    lab.ok(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Umsatz", "spec": {"options": {"unit": null, "decimals": "null", "headline": "average"}}}));
    assert_eq!(
        widget(&lab.only(), "Umsatz")["options"],
        json!({"compare": "year", "headline": "average", "invertDelta": false})
    );

    let sql_for = |kind: &str| match kind {
        "gauge" => "SELECT SUM(amount) AS value, MAX(target) AS goal FROM orders",
        "score" => {
            "SELECT region, SUM(amount) AS value, MAX(target) AS goal FROM orders GROUP BY region"
        }
        "bars" => "SELECT region, SUM(amount) AS total FROM orders GROUP BY region",
        "table" => "SELECT id FROM orders",
        _ => "SELECT created_at, SUM(amount) AS total FROM orders GROUP BY created_at",
    };
    for (kind, options, expected) in [
        (
            "kpi",
            json!({"compare": "last_week"}),
            "Option 'compare': 'none', 'previous' oder 'year'",
        ),
        (
            "kpi",
            json!({"compare": true}),
            "'none', 'previous' oder 'year'",
        ),
        (
            "kpi",
            json!({"headline": "median"}),
            "Option 'headline': 'auto', 'total', 'last', 'average', 'max' oder 'min'",
        ),
        (
            "kpi",
            json!({"unit": ""}),
            "Option 'unit': Text mit 1 bis 8 Zeichen",
        ),
        ("kpi", json!({"unit": "  "}), "Text mit 1 bis 8 Zeichen"),
        (
            "kpi",
            json!({"unit": "Kilogramm"}),
            "Text mit 1 bis 8 Zeichen",
        ),
        ("kpi", json!({"unit": 5}), "Text mit 1 bis 8 Zeichen"),
        (
            "kpi",
            json!({"decimals": 5}),
            "Option 'decimals': Ganzzahl 0 bis 4",
        ),
        ("kpi", json!({"decimals": -1}), "Ganzzahl 0 bis 4"),
        ("kpi", json!({"decimals": 1.5}), "Ganzzahl 0 bis 4"),
        (
            "kpi",
            json!({"invertDelta": "yes"}),
            "Option 'invertDelta': true oder false",
        ),
        (
            "gauge",
            json!({"compare": "previous"}),
            "Option 'compare' gibt es bei 'gauge' nicht",
        ),
        (
            "gauge",
            json!({"invertDelta": true}),
            "Option 'invertDelta' gibt es bei 'gauge' nicht",
        ),
        (
            "score",
            json!({"headline": "total"}),
            "Option 'headline' gibt es bei 'score' nicht",
        ),
        (
            "table",
            json!({"headline": "total"}),
            "Option 'headline' gibt es bei 'table' nicht",
        ),
        (
            "bars",
            json!({"horizontal": true}),
            "Option 'horizontal' gibt es bei 'bars' nicht",
        ),
    ] {
        let mut spec = json!({"type": kind, "sql": sql_for(kind), "options": options});
        if kind == "kpi" {
            spec["dateColumn"] = json!("created_at");
        }
        let error =
            lab.err(json!({"action": "add_charts", "dashboard": "Sales", "charts": [spec]}));
        assert!(
            error.contains(expected),
            "{kind} {options}: expected '{expected}' in '{error}'"
        );
    }
    assert_eq!(lab.only()["widgets"].as_array().unwrap().len(), 5);
}

#[test]
fn stores_subtitles_and_twelve_month_periods() {
    let mut lab = lab();
    lab.create_sales();
    lab.ok(json!({"action": "add_charts", "dashboard": "Sales", "charts": [
        {"type": "line", "title": "Umsatz", "subtitle": "  Summe pro Tag  ", "sql": "SELECT created_at AS tag, SUM(amount) AS \"Umsatz\" FROM orders GROUP BY 1 ORDER BY 1", "dimension": "tag", "metrics": ["Umsatz"], "dateColumn": "tag", "period": "12m"},
        {"type": "column", "title": "Status", "description": "Anzahl Bestellungen", "builder": {"table": "orders", "dimension": "status", "metrics": ["count"]}}
    ]}));
    let board = lab.only();
    assert_eq!(widget(&board, "Umsatz")["subtitle"], "Summe pro Tag");
    assert_eq!(widget(&board, "Umsatz")["period"], "12m");
    assert_eq!(widget(&board, "Status")["subtitle"], "Anzahl Bestellungen");
    assert!(widget(&board, "Revenue").get("subtitle").is_none());
    let got: Value =
        serde_json::from_str(&lab.ok(json!({"action": "get", "dashboard": "Sales"}))).unwrap();
    let chart = |title: &str| {
        got["charts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["title"] == title)
            .unwrap()
            .clone()
    };
    assert_eq!(chart("Umsatz")["subtitle"], "Summe pro Tag");
    assert_eq!(chart("Umsatz")["period"], "12m");
    assert_eq!(chart("Status")["subtitle"], "Anzahl Bestellungen");
    assert!(chart("Revenue").get("subtitle").is_none());

    lab.ok(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Umsatz", "spec": {"title": "Umsatz je Tag", "options": {"unit": "€"}}}));
    assert_eq!(
        widget(&lab.only(), "Umsatz je Tag")["subtitle"],
        "Summe pro Tag"
    );
    lab.ok(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Umsatz je Tag", "spec": {"subtitle": null}}));
    assert!(widget(&lab.only(), "Umsatz je Tag")
        .get("subtitle")
        .is_none());
    lab.ok(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Status", "spec": {"subtitle": ""}}));
    assert!(widget(&lab.only(), "Status").get("subtitle").is_none());
    lab.ok(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Status", "spec": {"description": "Neu"}}));
    assert_eq!(widget(&lab.only(), "Status")["subtitle"], "Neu");
    let before = lab.only();
    let long = lab.err(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Status", "spec": {"subtitle": "x".repeat(121)}}));
    assert!(long.contains("subtitle ist länger als 120"), "{long}");
    let bad = lab.err(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Status", "spec": {"subtitle": 5}}));
    assert!(bad.contains("subtitle muss ein Text"), "{bad}");
    let period = lab.err(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Revenue", "spec": {"period": "12m"}}));
    assert!(
        period.contains("period '12m' braucht dateColumn"),
        "{period}"
    );
    assert_eq!(lab.only(), before);
}

#[test]
fn arranges_tiles_on_top_and_pairs_the_rest() {
    let at = |id: &str, chart: &str, x: i64, y: i64| json!({"id": id, "chart": chart, "x": x, "y": y, "w": 3, "h": 5});
    let layout = |widgets: Vec<Value>| -> Vec<(String, (i64, i64, i64, i64))> {
        arrange(&widgets)
            .iter()
            .map(|w| (w["id"].as_str().unwrap().to_string(), rect(w)))
            .collect()
    };
    let expect = |list: &[(&str, (i64, i64, i64, i64))]| -> Vec<(String, (i64, i64, i64, i64))> {
        list.iter().map(|(id, r)| (id.to_string(), *r)).collect()
    };
    let tiles = |n: i64| -> Vec<Value> {
        (0..n)
            .map(|i| {
                at(
                    &format!("k{i}"),
                    if i % 2 == 1 { "gauge" } else { "kpi" },
                    0,
                    i,
                )
            })
            .collect()
    };
    assert_eq!(layout(tiles(1)), expect(&[("k0", (0, 0, 12, 4))]));
    assert_eq!(
        layout(tiles(5)),
        expect(&[
            ("k0", (0, 0, 4, 4)),
            ("k1", (4, 0, 4, 4)),
            ("k2", (8, 0, 4, 4)),
            ("k3", (0, 4, 6, 4)),
            ("k4", (6, 4, 6, 4)),
        ])
    );
    let seven: Vec<i64> = layout(tiles(7)).iter().map(|(_, r)| r.2).collect();
    assert_eq!(seven, vec![3, 3, 3, 3, 4, 4, 4]);
    let eight: Vec<i64> = layout(tiles(8)).iter().map(|(_, r)| r.2).collect();
    assert_eq!(eight, vec![3; 8]);
    let nine: Vec<(i64, i64)> = layout(tiles(9)).iter().map(|(_, r)| (r.1, r.2)).collect();
    assert_eq!(
        nine,
        [(0, 4); 3]
            .iter()
            .chain(&[(4, 4); 3])
            .chain(&[(8, 4); 3])
            .copied()
            .collect::<Vec<_>>()
    );

    let mut mixed = vec![
        at("line", "line", 0, 0),
        at("donut", "donut", 6, 0),
        at("bars", "bars", 0, 10),
        at("radar", "radar", 4, 10),
        at("rings", "rings", 8, 10),
        at("table", "table", 0, 20),
        at("column", "column", 0, 30),
        at("scatter", "scatter", 0, 40),
        at("kpi", "kpi", 9, 50),
    ];
    mixed.reverse();
    assert_eq!(
        layout(mixed),
        expect(&[
            ("kpi", (0, 0, 12, 4)),
            ("line", (0, 4, 8, 8)),
            ("donut", (8, 4, 4, 8)),
            ("bars", (0, 12, 4, 9)),
            ("radar", (4, 12, 4, 9)),
            ("rings", (8, 12, 4, 9)),
            ("table", (0, 21, 6, 7)),
            ("column", (6, 21, 6, 7)),
            ("scatter", (0, 28, 12, 8)),
        ])
    );
    assert_eq!(
        layout(vec![
            at("donut", "donut", 0, 0),
            at("score", "score", 0, 1),
            at("area", "area", 0, 2),
        ]),
        expect(&[
            ("donut", (0, 0, 6, 8)),
            ("score", (6, 0, 6, 8)),
            ("area", (0, 8, 12, 7)),
        ])
    );
}

#[test]
fn arrange_action_lays_out_a_typical_dashboard() {
    let mut lab = lab();
    lab.ok(json!({"action": "create", "connection": "Shop", "name": "Board", "charts": [
        {"type": "table", "title": "Liste", "sql": "SELECT id, amount FROM orders", "x": 0, "y": 30, "w": 12},
        {"type": "kpi", "title": "Umsatz", "sql": "SELECT created_at, SUM(amount) AS \"Umsatz\" FROM orders GROUP BY created_at", "dateColumn": "created_at", "x": 0, "y": 0},
        {"type": "area", "title": "Verlauf", "sql": "SELECT created_at AS tag, SUM(amount) AS \"Umsatz\" FROM orders GROUP BY 1 ORDER BY 1", "dimension": "tag", "metrics": ["Umsatz"], "x": 0, "y": 10},
        {"type": "kpi", "title": "Bestellungen", "sql": "SELECT created_at, COUNT(*) AS \"Bestellungen\" FROM orders GROUP BY created_at", "dateColumn": "created_at", "x": 3, "y": 0},
        {"type": "donut", "title": "Status", "sql": "SELECT status, COUNT(*) AS \"Anzahl\" FROM orders GROUP BY status", "x": 6, "y": 10},
        {"type": "kpi", "title": "Schnitt", "sql": "SELECT substr(created_at, 1, 7) AS \"Monat\", AVG(amount) AS \"Schnitt\" FROM orders GROUP BY 1 ORDER BY 1", "dimension": "Monat", "x": 6, "y": 0},
        {"type": "bars", "title": "Regionen", "sql": "SELECT region, SUM(amount) AS \"Umsatz\" FROM orders GROUP BY region", "x": 0, "y": 20}
    ]}));
    let text = lab.ok(json!({"action": "arrange", "dashboard": "Board"}));
    assert!(
        text.starts_with("ok, 7 Charts in 'Board' neu angeordnet"),
        "{text}"
    );
    assert!(text.contains("'Verlauf' area x=0 y=4 w=8 h=8"), "{text}");
    let board = lab.only();
    assert_grid(&board);
    for (title, expected) in [
        ("Umsatz", (0, 0, 4, 4)),
        ("Bestellungen", (4, 0, 4, 4)),
        ("Schnitt", (8, 0, 4, 4)),
        ("Verlauf", (0, 4, 8, 8)),
        ("Status", (8, 4, 4, 8)),
        ("Regionen", (0, 12, 4, 8)),
        ("Liste", (4, 12, 8, 8)),
    ] {
        assert_eq!(rect(widget(&board, title)), expected, "{title}");
    }
    let order: Vec<&str> = board["widgets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["title"].as_str().unwrap())
        .collect();
    assert_eq!(
        order,
        [
            "Umsatz",
            "Bestellungen",
            "Schnitt",
            "Verlauf",
            "Status",
            "Regionen",
            "Liste"
        ]
    );
    assert_eq!(board["datasets"].as_array().unwrap().len(), 7);
    let again = lab.ok(json!({"action": "arrange", "dashboard": "Board"}));
    assert_eq!(again, text);
    lab.ok(json!({"action": "create", "connection": "Shop", "name": "Leer"}));
    assert!(lab
        .err(json!({"action": "arrange", "dashboard": "Leer"}))
        .contains("hat keine Charts"));
}

#[test]
fn reports_design_notes_without_failing() {
    let mut lab = lab();
    lab.create_sales();
    let text = lab.ok(json!({"action": "add_charts", "dashboard": "Sales", "charts": [
        {"type": "donut", "title": "Viele", "sql": "SELECT status || id AS kat, amount AS sum_amount FROM orders UNION ALL SELECT region || id, target FROM orders", "dimension": "kat", "metrics": ["sum_amount"]},
        {"type": "kpi", "title": "Vergleich", "sql": "SELECT substr(created_at, 1, 7) AS \"Monat\", COUNT(*) AS \"Bestellungen\" FROM orders GROUP BY 1 ORDER BY 1", "dimension": "Monat", "options": {"compare": "previous"}},
        {"type": "column", "title": "Baukasten", "builder": {"table": "orders", "dimension": "status", "metrics": ["sum(amount)"]}},
        {"type": "line", "title": "Sauber", "sql": "SELECT created_at AS \"Tag\", SUM(amount) AS \"Umsatz\" FROM orders GROUP BY 1 ORDER BY 1", "dimension": "Tag", "metrics": ["Umsatz"], "dateColumn": "Tag", "period": "30d", "options": {"compare": "year"}},
        {"type": "kpi", "title": "Pro Tag", "sql": "SELECT created_at AS \"Tag\", SUM(amount) AS \"Umsatz\" FROM orders GROUP BY 1", "metrics": ["Umsatz"], "dateColumn": "Tag"}
    ]}));
    let report = |title: &str| {
        text.split("\n- chart ")
            .find(|part| part.contains(&format!("'{title}'")))
            .unwrap_or_else(|| panic!("{title} missing in {text}"))
            .to_string()
    };
    let many = report("Viele");
    assert!(
        many.contains(
            "10 Kategorien sind für donut zu viele – besser bars oder Top 6 plus „Sonstige“."
        ),
        "{many}"
    );
    assert!(
        many.contains("Spaltennamen sum_amount wirken technisch"),
        "{many}"
    );
    let compare = report("Vergleich");
    assert!(
        compare.contains("compare wirkt nur mit dateColumn und period ≠ all."),
        "{compare}"
    );
    assert!(!compare.contains("technisch"), "{compare}");
    assert!(!report("Baukasten").contains("technisch"), "{text}");
    let clean = report("Sauber");
    assert!(
        !clean.contains("compare wirkt")
            && !clean.contains("technisch")
            && !clean.contains("Kategorien"),
        "{clean}"
    );
    assert!(!report("Pro Tag").contains("Verlauf"), "{text}");
    assert_eq!(lab.only()["widgets"].as_array().unwrap().len(), 6);
}

#[test]
fn kpi_needs_a_time_dimension_or_date_column() {
    let rule = "'kpi' zeigt immer Sparkline und Trend: setze dimension auf eine Zeitspalte (Tag/Woche/Monat, ORDER BY; im builder {field, bucket}) oder dateColumn. Eine Einzelzahl allein ist nicht erlaubt.";
    let mut lab = lab();
    lab.create_sales();
    let before = lab.only();
    for spec in [
        json!({"type": "kpi", "title": "Zahl", "sql": "SELECT COUNT(*) AS n FROM orders", "metrics": ["n"]}),
        json!({"type": "kpi", "title": "Zahl", "sql": "SELECT COUNT(*) AS n FROM orders"}),
        json!({"type": "kpi", "title": "Zahl", "builder": {"table": "orders", "metrics": ["count"]}}),
        json!({"type": "kpi", "title": "Zahl", "builder": {"table": "orders", "dimension": "status", "metrics": ["count"]}}),
        json!({"type": "kpi", "title": "Zahl", "builder": {"table": "orders", "dimension": {"field": "created_at", "bucket": "none"}, "metrics": ["count"]}}),
    ] {
        let error = lab
            .err(json!({"action": "add_charts", "dashboard": "Sales", "charts": [spec.clone()]}));
        assert!(error.contains(rule), "{spec}: {error}");
    }
    let error = lab.err(json!({"action": "update_chart", "dashboard": "Sales", "chart": "Revenue", "spec": {"dimension": null}}));
    assert!(error.contains(rule), "{error}");
    let preview = lab.ok(json!({"action": "preview", "connection": "Shop", "spec": {"type": "kpi", "sql": "SELECT COUNT(*) AS n FROM orders", "metrics": ["n"]}}));
    assert!(preview.contains(&format!("Passung: {rule}")), "{preview}");
    assert_eq!(lab.only(), before);
    for spec in [
        json!({"type": "kpi", "title": "Summenzeile", "sql": "SELECT MAX(created_at) AS \"Tag\", SUM(amount) AS \"Umsatz\" FROM orders", "metrics": ["Umsatz"], "dateColumn": "Tag"}),
        json!({"type": "kpi", "title": "Ein Monat", "sql": "SELECT '2026-10' AS \"Monat\", COUNT(*) AS n FROM orders", "dimension": "Monat"}),
    ] {
        let error = lab
            .err(json!({"action": "add_charts", "dashboard": "Sales", "charts": [spec.clone()]}));
        assert!(
            error
                .contains("'kpi' braucht einen Verlauf, das Ergebnis hat aber nur einen Zeitpunkt"),
            "{spec}: {error}"
        );
    }
    assert_eq!(lab.only(), before);

    let text = lab.ok(json!({"action": "add_charts", "dashboard": "Sales", "charts": [
        {"type": "kpi", "title": "Bestellungen", "sql": "SELECT created_at AS \"Tag\", COUNT(*) AS \"Bestellungen\" FROM orders GROUP BY 1", "dateColumn": "Tag", "period": "30d"},
        {"type": "kpi", "title": "Umsatz", "sql": "SELECT substr(created_at, 1, 7) AS \"Monat\", SUM(amount) AS \"Umsatz\" FROM orders GROUP BY 1 ORDER BY 1", "dimension": "Monat"},
        {"type": "kpi", "title": "Menge", "builder": {"table": "orders", "metrics": ["sum(amount)"], "dateColumn": "created_at"}, "period": "90d"},
        {"type": "kpi", "title": "Monatlich", "builder": {"table": "orders", "dimension": {"field": "created_at", "bucket": "month"}, "metrics": ["count"]}}
    ]}));
    assert!(!text.contains("Verlauf"), "{text}");
    let board = lab.only();
    let mapping = |title: &str| dataset_for(&board, title)["mapping"].clone();
    assert_eq!(mapping("Bestellungen")["dateColumn"], "Tag");
    assert_eq!(mapping("Bestellungen")["dimension"], Value::Null);
    assert_eq!(mapping("Bestellungen")["metrics"], json!(["Bestellungen"]));
    assert_eq!(mapping("Umsatz")["dimension"], "Monat");
    assert_eq!(mapping("Umsatz")["dateColumn"], Value::Null);
    let menge = &dataset_for(&board, "Menge")["simple"];
    assert_eq!(menge["dateColumn"], "created_at");
    assert_eq!(menge["dimension"], Value::Null);
    assert_eq!(widget(&board, "Menge")["period"], "90d");
    assert_eq!(
        dataset_for(&board, "Monatlich")["simple"]["dimension"]["bucket"],
        "month"
    );
    let run = lab.ok(json!({"action": "run", "dashboard": "Sales"}));
    assert!(run.starts_with("5 ok, 0 mit Problemen"), "{run}");
    let preview = lab.ok(json!({"action": "preview", "connection": "Shop", "spec": {"type": "kpi", "builder": {"table": "orders", "metrics": ["count"], "dateColumn": "created_at"}, "period": "30d"}}));
    assert!(!preview.contains("Passung"), "{preview}");

    mcp_dashboard_save(json!({
        "id": "legacy",
        "connectionId": "shop",
        "name": "Alt",
        "datasets": [{"id": "d", "name": "Zahl", "mode": "expert", "simple": empty_simple(), "sql": "SELECT COUNT(*) AS n FROM orders", "mapping": {"dimension": null, "dimension2": null, "metrics": ["n"], "dateColumn": null}}],
        "widgets": [{"id": "w", "chart": "kpi", "datasetId": "d", "title": "Zahl", "period": "all", "x": 0, "y": 0, "w": 3, "h": 4}]
    }))
    .unwrap();
    let run = lab.ok(json!({"action": "run", "dashboard": "Alt"}));
    assert!(
        run.starts_with("0 ok, 1 mit Problemen") && run.contains(rule),
        "{run}"
    );
    let error = lab.err(json!({"action": "update_chart", "dashboard": "Alt", "chart": "Zahl", "spec": {"title": "Neu"}}));
    assert!(error.contains(rule), "{error}");
    lab.ok(json!({"action": "update_chart", "dashboard": "Alt", "chart": "Zahl", "spec": {"sql": "SELECT created_at, COUNT(*) AS n FROM orders GROUP BY created_at", "dateColumn": "created_at"}}));
    let run = lab.ok(json!({"action": "run", "dashboard": "Alt"}));
    assert!(run.starts_with("1 ok, 0 mit Problemen"), "{run}");
}

#[test]
fn design_notes_flag_crowded_and_technical_charts() {
    let shape = |metrics: &[&str], dimension: bool, date: bool| Shape {
        dimension: dimension.then(|| "d".to_string()),
        dimension2: None,
        metrics: metrics.iter().map(|m| m.to_string()).collect(),
        date,
        timed: dimension,
    };
    let none = Map::new();
    let notes = |name: &str, rows: usize| {
        design_notes(
            kind(name).unwrap(),
            Some(rows),
            false,
            &shape(&["Wert"], true, false),
            "all",
            &none,
        )
    };
    assert!(notes("bars", 16)[0].starts_with("16 Balken sind zu viele"));
    assert!(notes("bars", 15).is_empty());
    assert!(notes("rings", 9)[0].contains("für rings zu viele"));
    assert!(notes("funnel", 8).is_empty());
    assert!(notes("column", 40).is_empty());
    let technical_names = design_notes(
        kind("column").unwrap(),
        None,
        true,
        &shape(&["m0", "Umsatz", "COUNT", "net_total"], true, false),
        "all",
        &none,
    );
    assert_eq!(technical_names.len(), 1);
    assert!(technical_names[0].starts_with("Spaltennamen m0, COUNT, net_total wirken technisch"));
    let compare: Map<String, Value> = [("compare".to_string(), json!("year"))]
        .into_iter()
        .collect();
    let dated = shape(&["Umsatz"], true, true);
    assert!(design_notes(kind("line").unwrap(), None, true, &dated, "90d", &compare).is_empty());
    assert_eq!(
        design_notes(kind("line").unwrap(), None, true, &dated, "all", &compare),
        vec!["compare wirkt nur mit dateColumn und period ≠ all.".to_string()]
    );
    let off: Map<String, Value> = [("compare".to_string(), json!("none"))]
        .into_iter()
        .collect();
    assert!(design_notes(kind("line").unwrap(), None, true, &dated, "all", &off).is_empty());
    for name in [
        "m0",
        "m12",
        "order_count",
        "Sum",
        "avg",
        "MAX",
        "min",
        "count",
    ] {
        assert!(technical(name), "{name}");
    }
    for name in ["Umsatz", "m", "mx1", "M1", "Menge", "maximum", "Anzahl"] {
        assert!(!technical(name), "{name}");
    }
}

const SVG_LOGO: &str = "data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox='0 0 40 40'><circle cx='20' cy='20' r='18' fill='%230f766e'/></svg>";

fn company_board(lab: &mut Lab) -> String {
    lab.ok(json!({
        "action": "create",
        "connection": "Shop",
        "name": "Firma",
        "variables": [{"name": "region", "type": "text"}],
        "pages": [{"name": "Übersicht"}, {"name": "Vertrieb"}, {"id": "fin", "name": "Finanzen", "hidden": true}],
        "theme": {"brand": "Nordfrost GmbH", "primary": "#0f766e", "palette": ["#0f766e", "oklch(0.7 0.1 200)"], "font": "inter", "radius": 12, "header": true, "nav": "tabs"},
        "charts": [
            {"type": "text", "title": "Intro", "markdown": "# Willkommen\nZahlen für **{{region}}**."},
            {"type": "kpi", "title": "Umsatz", "sql": "SELECT created_at AS \"Tag\", SUM(amount) AS \"Umsatz\" FROM orders GROUP BY 1", "dateColumn": "Tag"},
            {"type": "image", "title": "Logo", "src": SVG_LOGO, "fit": "contain", "w": 2, "h": 2},
            {"type": "link", "title": "Zum Vertrieb", "label": "Zu Vertrieb", "targetPage": "Vertrieb"},
            {"type": "divider", "title": "Regionen", "text": "Regionen", "page": "vertrieb"},
            {"type": "column", "title": "Umsatz je Region", "sql": "SELECT region, SUM(amount) AS \"Umsatz\" FROM orders GROUP BY region", "page": "Vertrieb", "options": {"crossFilter": true, "target": 250, "targetLabel": "Ziel"}},
            {"type": "pivot", "title": "Matrix", "sql": "SELECT region, status, SUM(amount) AS \"Umsatz\" FROM orders GROUP BY 1, 2", "dimension": "region", "dimension2": "status", "page": "fin", "options": {"totals": true, "dataBars": true}}
        ]
    }))
}

fn assert_pages_grid(dashboard: &Value) {
    let pages = pages_of(dashboard);
    let widgets = dashboard["widgets"].as_array().unwrap();
    for (i, a) in widgets.iter().enumerate() {
        let (x, y, w, h) = rect(a);
        assert!(
            x >= 0 && y >= 0 && x + w <= GRID_COLS && w > 0 && h > 0,
            "{a}"
        );
        for b in &widgets[i + 1..] {
            if page_of(a, &pages) == page_of(b, &pages) {
                assert!(!overlaps(rect(a), rect(b)), "{a} overlaps {b}");
            }
        }
    }
}

#[test]
fn pages_and_theme_roundtrip_through_desktop_save() {
    let mut lab = lab();
    let theme = json!({
        "brand": "  Nordfrost  ", "tagline": "Kennzahlen", "logo": SVG_LOGO, "primary": "#0F766E",
        "background": "rgb(250 250 250)", "surface": "hsla(0, 0%, 100%, 0.9)", "text": "#111", "muted": "oklab(0.5 0 0)",
        "border": "#e5e7eb80", "palette": ["#0f766e", "#f59e0b"], "font": "serif", "radius": 8, "card": "glass",
        "density": "compact", "header": true, "nav": "sidebar", "unknown": "dropped"
    });
    mcp_dashboard_save(json!({
        "id": "branded", "connectionId": "shop", "name": "Marke", "datasets": [], "widgets": [
            {"id": "b1", "chart": "table", "datasetId": null, "title": "", "period": "all", "x": 0, "y": 0, "w": 12, "h": 2, "page": "home", "block": {"type": "text", "text": "# Hallo"}}
        ],
        "pages": [{"id": "home", "name": " Start "}, {"id": "sales_2", "name": "Vertrieb", "hidden": false}],
        "theme": theme
    }))
    .unwrap();
    let saved = lab.only();
    assert_eq!(
        saved["pages"],
        json!([{"id": "home", "name": "Start"}, {"id": "sales_2", "name": "Vertrieb", "hidden": false}])
    );
    assert_eq!(saved["theme"]["brand"], "Nordfrost");
    assert_eq!(saved["theme"]["logo"], SVG_LOGO);
    assert_eq!(saved["theme"]["radius"], 8);
    assert!(saved["theme"].get("unknown").is_none());
    assert_eq!(saved["widgets"][0]["block"]["type"], "text");
    assert_eq!(list_dashboards()[0]["pages"].as_array().unwrap().len(), 2);
    let got: Value =
        serde_json::from_str(&lab.ok(json!({"action": "get", "dashboard": "Marke"}))).unwrap();
    assert_eq!(got["pages"][1]["id"], "sales_2");
    assert_eq!(got["theme"]["font"], "serif");
    assert_eq!(got["charts"][0]["type"], "text");
    assert_eq!(got["charts"][0]["title"], "Hallo");
    assert_eq!(got["charts"][0]["page"], "home");
    assert!(got["charts"][0].get("sql").is_none());
    assert!(lab
        .ok(json!({"action": "list"}))
        .contains("Marke\tShop\t1\t0\t2"));

    let base = json!({"id": "branded", "connectionId": "shop", "datasets": [], "widgets": []});
    let with = |key: &str, value: Value| {
        let mut board = base.clone();
        board[key] = value;
        mcp_dashboard_save(board)
    };
    for (key, value, expected) in [
        (
            "theme",
            json!({"primary": "red; background:url(x)"}),
            "keine erlaubte Farbe",
        ),
        ("theme", json!({"primary": "red"}), "keine erlaubte Farbe"),
        (
            "theme",
            json!({"background": "rgb(1 2 3)) ; x: url(y"}),
            "keine erlaubte Farbe",
        ),
        (
            "theme",
            json!({"palette": ["#fff", "url(x)"]}),
            "keine erlaubte Farbe",
        ),
        ("theme", json!({"palette": []}), "1 bis 8 Farben"),
        (
            "theme",
            json!({"logo": "http://example.com/logo.png"}),
            "data:image",
        ),
        (
            "theme",
            json!({"logo": "data:text/html,<script>"}),
            "data:image",
        ),
        (
            "theme",
            json!({"logo": "data:image/bmp;base64,AAAA"}),
            "data:image",
        ),
        (
            "theme",
            json!({"logo": format!("data:image/png;base64,{}", "A".repeat(MAX_IMAGE_CHARS))}),
            "512 KiB",
        ),
        ("theme", json!({"brand": "x".repeat(81)}), "80 Zeichen"),
        ("theme", json!({"radius": 33}), "0 bis 32"),
        ("theme", json!({"font": "comic"}), "theme.font muss"),
        ("theme", json!({"header": "yes"}), "true/false"),
        ("theme", json!("dark"), "Objekt oder null"),
        (
            "pages",
            json!([{"id": "a", "name": "A"}, {"id": "a", "name": "B"}]),
            "doppelt",
        ),
        ("pages", json!([{"id": "a b", "name": "A"}]), "ungültig"),
        ("pages", json!([{"id": "a", "name": " "}]), "1 bis 60"),
        (
            "pages",
            json!([{"id": "a", "name": "A", "hidden": "no"}]),
            "hidden",
        ),
        (
            "pages",
            json!((0..31)
                .map(|i| json!({"id": format!("p{i}"), "name": "P"}))
                .collect::<Vec<_>>()),
            "Höchstens 30",
        ),
    ] {
        let error = with(key, value.clone()).unwrap_err();
        assert!(error.contains(expected), "{key} {value}: {error}");
    }
    assert_eq!(lab.only()["pages"].as_array().unwrap().len(), 2);
    for logo in [
        "data:image/PNG;base64,iVBORw0KGgo=",
        "data:image/svg+xml;charset=utf-8,<svg xmlns=\"http://www.w3.org/2000/svg\">\n<rect width=\"1\" height=\"1\"/></svg>",
        "data:image/webp;base64,UklGRg==",
    ] {
        with("theme", json!({"logo": logo})).unwrap_or_else(|e| panic!("{logo}: {e}"));
    }
    with("theme", json!({"brand": " ", "primary": null})).unwrap();
    assert!(lab.only()["theme"].is_null());
    assert_eq!(lab.only()["pages"], json!([]));
}

#[test]
fn creates_pages_with_branded_blocks_and_skips_blocks_in_run() {
    let mut lab = lab();
    let text = company_board(&mut lab);
    assert!(
        text.contains(
            "7 Charts, 3 Seiten (Übersicht (uebersicht), Vertrieb (vertrieb), Finanzen (fin))"
        ),
        "{text}"
    );
    assert!(
        text.contains(" text at ") && text.contains(" auf Seite 'Vertrieb'"),
        "{text}"
    );
    let board = lab.only();
    assert_eq!(
        board["pages"],
        json!([{"id": "uebersicht", "name": "Übersicht"}, {"id": "vertrieb", "name": "Vertrieb"}, {"id": "fin", "name": "Finanzen", "hidden": true}])
    );
    assert_eq!(board["theme"]["brand"], "Nordfrost GmbH");
    assert_eq!(board["datasets"].as_array().unwrap().len(), 3);
    let intro = widget(&board, "Intro");
    assert_eq!(intro["chart"], "table");
    assert_eq!(intro["datasetId"], Value::Null);
    assert_eq!(intro["period"], "all");
    assert_eq!(intro["page"], "uebersicht");
    assert_eq!(
        intro["block"],
        json!({"type": "text", "text": "# Willkommen\nZahlen für **{{region}}**."})
    );
    assert_eq!(
        (intro["w"].as_i64(), intro["h"].as_i64()),
        (Some(12), Some(2))
    );
    let link = widget(&board, "Zum Vertrieb");
    assert_eq!(
        link["block"],
        json!({"type": "link", "text": "Zu Vertrieb", "page": "vertrieb"})
    );
    assert_eq!((link["w"].as_i64(), link["h"].as_i64()), (Some(3), Some(1)));
    assert_eq!(widget(&board, "Logo")["block"]["src"], SVG_LOGO);
    assert_eq!(rect(widget(&board, "Regionen")), (0, 0, 12, 1));
    assert_eq!(widget(&board, "Regionen")["page"], "vertrieb");
    let column = widget(&board, "Umsatz je Region");
    assert_eq!(column["page"], "vertrieb");
    assert_eq!(rect(column).1, 1);
    assert_eq!(
        column["options"],
        json!({"crossFilter": true, "target": 250, "targetLabel": "Ziel"})
    );
    assert_eq!(widget(&board, "Matrix")["chart"], "pivot");
    assert_eq!(widget(&board, "Matrix")["page"], "fin");
    assert_eq!(rect(widget(&board, "Matrix")), (0, 0, 6, 8));
    assert_pages_grid(&board);

    let got: Value =
        serde_json::from_str(&lab.ok(json!({"action": "get", "dashboard": "Firma"}))).unwrap();
    let chart = |title: &str| {
        got["charts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["title"] == title)
            .unwrap()
            .clone()
    };
    assert_eq!(chart("Zum Vertrieb")["type"], "link");
    assert_eq!(chart("Zum Vertrieb")["targetPage"], "vertrieb");
    assert!(chart("Zum Vertrieb").get("options").is_none());
    assert_eq!(chart("Matrix")["page"], "fin");
    assert_eq!(chart("Matrix")["dimension2"], "status");

    let run = lab.ok(json!({"action": "run", "dashboard": "Firma"}));
    assert!(run.starts_with("3 ok, 0 mit Problemen"), "{run}");
    assert!(run.contains("· 'Intro' (Inhaltsblock text, id "), "{run}");
    assert!(run.contains("(Inhaltsblock divider"), "{run}");
    let only = lab.ok(json!({"action": "run", "dashboard": "Firma", "chart": "Logo"}));
    assert!(
        only.starts_with("0 ok, 0 mit Problemen") && only.contains("keine Abfrage"),
        "{only}"
    );
    assert!(lab
        .err(json!({"action": "preview", "dashboard": "Firma", "chart": "Intro"}))
        .contains("Inhaltsblock (text) ohne Abfrage"));
    assert!(lab
        .err(json!({"action": "preview", "connection": "Shop", "spec": {"type": "divider"}}))
        .contains("keine Daten"));

    let before = lab.only();
    for (spec, expected) in [
        (
            json!({"type": "text", "text": "x", "sql": "SELECT 1"}),
            "zeigt keine Daten: sql weglassen",
        ),
        (
            json!({"type": "image", "src": SVG_LOGO, "metrics": ["n"], "options": {"unit": "€"}}),
            "metrics, options weglassen",
        ),
        (
            json!({"type": "text", "text": "x", "page": "Lager"}),
            "Seite 'Lager' gibt es nicht. Seiten: Übersicht (uebersicht)",
        ),
        (
            json!({"type": "link", "text": "Los"}),
            "braucht text (Beschriftung) und targetPage",
        ),
        (
            json!({"type": "link", "text": "Los", "targetPage": "Nirgendwo"}),
            "targetPage: Seite 'Nirgendwo'",
        ),
        (
            json!({"type": "link", "text": "Los", "href": "http://example.com"}),
            "mit https beginnt",
        ),
        (
            json!({"type": "link", "text": "Los", "href": "javascript:alert(1)"}),
            "mit https beginnt",
        ),
        (
            json!({"type": "image", "src": "https://example.com/logo.png"}),
            "data:image",
        ),
        (json!({"type": "image"}), "braucht src"),
        (json!({"type": "text"}), "braucht text"),
        (
            json!({"type": "text", "text": "{{mandant}}"}),
            "{{mandant}} ist nicht definiert",
        ),
        (
            json!({"type": "text", "text": "x".repeat(MAX_BLOCK_TEXT + 1)}),
            "länger als 20000",
        ),
        (
            json!({"type": "text", "text": "x", "src": SVG_LOGO}),
            "Feld 'src' gibt es bei Inhaltsblock 'text' nicht",
        ),
        (
            json!({"type": "text", "text": "x", "align": "justify"}),
            "align muss left, center, right",
        ),
        (
            json!({"type": "divider", "w": 1}),
            "w für 'divider' muss 2 bis 12",
        ),
        (
            json!({"type": "column", "sql": "SELECT region, COUNT(*) AS n FROM orders GROUP BY 1", "text": "x"}),
            "nur bei Inhaltsblöcken",
        ),
        (
            json!({"type": "pivot", "sql": "SELECT region, COUNT(*) AS n FROM orders GROUP BY 1", "dimension": "region", "metrics": ["n"]}),
            "'pivot' braucht dimension und dimension2 (Zeilen und Spalten)",
        ),
        (
            json!({"type": "pivot", "sql": "SELECT region, status, COUNT(*) AS n FROM orders GROUP BY 1, 2", "options": {"target": 5}}),
            "Option 'target' gibt es bei 'pivot' nicht",
        ),
        (
            json!({"type": "sankey", "sql": "SELECT region, status, COUNT(*) AS n FROM orders GROUP BY 1, 2", "options": {"crossFilter": true}}),
            "Option 'crossFilter' gibt es bei 'sankey' nicht",
        ),
        (
            json!({"type": "line", "sql": "SELECT created_at, COUNT(*) AS n FROM orders GROUP BY 1", "options": {"target": "viel"}}),
            "Option 'target': Zahl",
        ),
        (
            json!({"type": "line", "sql": "SELECT created_at, COUNT(*) AS n FROM orders GROUP BY 1", "options": {"targetLabel": "x".repeat(41)}}),
            "höchstens 40 Zeichen",
        ),
        (
            json!({"type": "bars", "sql": "SELECT region, COUNT(*) AS n FROM orders GROUP BY 1", "options": {"crossFilter": "yes"}}),
            "Option 'crossFilter': true oder false",
        ),
        (
            json!({"type": "table", "sql": "SELECT id FROM orders", "options": {"dataBars": 1}}),
            "Option 'dataBars': true oder false",
        ),
        (
            json!({"type": "kpi", "sql": "SELECT created_at, COUNT(*) AS n FROM orders GROUP BY 1", "dateColumn": "created_at", "options": {"crossFilter": true}}),
            "Option 'crossFilter' gibt es bei 'kpi' nicht",
        ),
    ] {
        let error = lab
            .err(json!({"action": "add_charts", "dashboard": "Firma", "charts": [spec.clone()]}));
        assert!(
            error.contains(expected),
            "{spec}: expected '{expected}' in '{error}'"
        );
    }
    assert_eq!(lab.only(), before);
    lab.ok(json!({"action": "add_charts", "dashboard": "Firma", "charts": [
        {"type": "kpi", "title": "Ziel-KPI", "sql": "SELECT created_at, COUNT(*) AS n FROM orders GROUP BY 1", "dateColumn": "created_at", "options": {"drill": false, "target": 2.5, "targetLabel": " Plan "}},
        {"type": "table", "title": "Liste", "sql": "SELECT id, amount FROM orders", "page": "fin", "options": {"totals": false, "dataBars": true, "crossFilter": false, "drill": true}},
        {"type": "line", "title": "Linie", "sql": "SELECT created_at, COUNT(*) AS n FROM orders GROUP BY 1", "options": {"target": -1e6, "targetLabel": ""}}
    ]}));
    let board = lab.only();
    assert_eq!(
        widget(&board, "Ziel-KPI")["options"],
        json!({"drill": false, "target": 2.5, "targetLabel": "Plan"})
    );
    assert_eq!(widget(&board, "Ziel-KPI")["page"], "uebersicht");
    assert_eq!(widget(&board, "Liste")["options"]["dataBars"], true);
    assert_eq!(widget(&board, "Linie")["options"]["targetLabel"], "");
    assert_pages_grid(&board);
}

#[test]
fn update_chart_moves_between_pages_and_switches_blocks_and_charts() {
    let mut lab = lab();
    company_board(&mut lab);
    let text = lab.ok(json!({"action": "update_chart", "dashboard": "Firma", "chart": "Umsatz", "spec": {"page": "Finanzen"}}));
    assert!(text.contains("auf Seite 'Finanzen'"), "{text}");
    let board = lab.only();
    let moved = widget(&board, "Umsatz");
    assert_eq!(moved["page"], "fin");
    assert_eq!(moved["options"], json!({}));
    assert_pages_grid(&board);
    assert!(lab
        .err(json!({"action": "update_chart", "dashboard": "Firma", "chart": "Umsatz", "spec": {"page": "Lager"}}))
        .contains("Seiten: Übersicht"));

    lab.ok(json!({"action": "update_chart", "dashboard": "Firma", "chart": "Zum Vertrieb", "spec": {"text": "Finanzen ansehen", "targetPage": "fin", "variant": "accent"}}));
    assert_eq!(
        widget(&lab.only(), "Zum Vertrieb")["block"],
        json!({"type": "link", "text": "Finanzen ansehen", "page": "fin", "variant": "accent"})
    );
    lab.ok(json!({"action": "update_chart", "dashboard": "Firma", "chart": "Zum Vertrieb", "spec": {"targetPage": null, "url": "https://example.com/bericht"}}));
    assert_eq!(
        widget(&lab.only(), "Zum Vertrieb")["block"],
        json!({"type": "link", "text": "Finanzen ansehen", "href": "https://example.com/bericht", "variant": "accent"})
    );
    lab.ok(json!({"action": "update_chart", "dashboard": "Firma", "chart": "Zum Vertrieb", "spec": {"type": "divider"}}));
    assert_eq!(
        widget(&lab.only(), "Zum Vertrieb")["block"],
        json!({"type": "divider", "text": "Finanzen ansehen", "variant": "accent"})
    );

    let error = lab.err(json!({"action": "update_chart", "dashboard": "Firma", "chart": "Intro", "spec": {"type": "bars"}}));
    assert!(error.contains("sql oder builder"), "{error}");
    lab.ok(json!({"action": "update_chart", "dashboard": "Firma", "chart": "Intro", "spec": {"type": "bars", "sql": "SELECT region, COUNT(*) AS \"Anzahl\" FROM orders GROUP BY region"}}));
    let board = lab.only();
    let bars = widget(&board, "Intro");
    assert_eq!(bars["chart"], "bars");
    assert!(bars.get("block").is_none());
    assert_eq!(bars["page"], "uebersicht");
    assert!(dataset_of(&board, bars).is_some());
    assert_eq!(board["datasets"].as_array().unwrap().len(), 4);
    assert_pages_grid(&board);

    lab.ok(json!({"action": "update_chart", "dashboard": "Firma", "chart": "Matrix", "spec": {"type": "text", "text": "Matrix folgt"}}));
    let board = lab.only();
    assert_eq!(widget(&board, "Matrix")["datasetId"], Value::Null);
    assert_eq!(widget(&board, "Matrix")["block"]["type"], "text");
    assert_eq!(board["datasets"].as_array().unwrap().len(), 3);
    lab.ok(json!({"action": "remove_chart", "dashboard": "Firma", "chart": "Logo"}));
    assert_eq!(lab.only()["widgets"].as_array().unwrap().len(), 6);
}

#[test]
fn update_merges_theme_and_reassigns_widgets_of_removed_pages() {
    let mut lab = lab();
    company_board(&mut lab);
    let text = lab.ok(json!({"action": "update", "dashboard": "Firma", "theme": {"primary": "#e11d48", "font": null, "tagline": "Live", "nav": "", "colour": "x"}}));
    assert!(
        text.contains("unbekannte theme-Felder ignoriert: colour"),
        "{text}"
    );
    let theme = lab.only()["theme"].clone();
    assert_eq!(theme["primary"], "#e11d48");
    assert_eq!(theme["tagline"], "Live");
    assert_eq!(theme["brand"], "Nordfrost GmbH");
    assert!(theme.get("font").is_none() && theme.get("nav").is_none());
    let before = lab.only();
    assert!(lab
        .err(json!({"action": "update", "dashboard": "Firma", "theme": {"primary": "red; background:url(x)"}}))
        .contains("keine erlaubte Farbe"));
    assert!(lab
        .err(json!({"action": "update", "dashboard": "Firma", "theme": {"logo": "http://example.com/x.png"}}))
        .contains("data:image"));
    assert_eq!(lab.only(), before);
    lab.ok(json!({"action": "update", "dashboard": "Firma", "theme": null}));
    assert!(lab.only()["theme"].is_null());

    let text = lab.ok(json!({"action": "update", "dashboard": "Firma", "pages": [{"id": "uebersicht", "name": "Start"}, {"name": "Lager"}, {"name": "Lager"}]}));
    assert!(
        text.contains("pages=3 (Start (uebersicht), Lager (lager), Lager (lager-2))"),
        "{text}"
    );
    assert!(
        text.contains("3 Charts auf Seite 'Start' verschoben"),
        "{text}"
    );
    let board = lab.only();
    for widget in board["widgets"].as_array().unwrap() {
        assert_eq!(widget["page"], "uebersicht", "{widget}");
    }
    assert_eq!(
        widget(&board, "Zum Vertrieb")["block"]["page"],
        "uebersicht"
    );
    assert_pages_grid(&board);
    let arranged = lab.ok(json!({"action": "arrange", "dashboard": "Firma"}));
    assert!(arranged.contains("Jede Seite für sich"), "{arranged}");
    assert_pages_grid(&lab.only());

    lab.ok(json!({"action": "update_chart", "dashboard": "Firma", "chart": "Matrix", "spec": {"page": "lager-2"}}));
    lab.ok(json!({"action": "update", "dashboard": "Firma", "pages": []}));
    let board = lab.only();
    assert_eq!(board["pages"], json!([]));
    assert!(board["widgets"]
        .as_array()
        .unwrap()
        .iter()
        .all(|w| w.get("page").is_none()));
    assert!(widget(&board, "Zum Vertrieb")["block"]
        .get("page")
        .is_none());
    assert_grid(&board);
    assert!(lab
        .err(
            json!({"action": "update", "dashboard": "Firma", "pages": [{"id": "x y", "name": "X"}]})
        )
        .contains("ungültig"));
    assert!(lab
        .err(json!({"action": "update", "dashboard": "Firma", "pages": [{"hidden": true}]}))
        .contains("braucht name"));
}

#[test]
fn arranges_each_page_with_blocks_as_sections() {
    let item = |id: &str, chart: &str, page: &str, y: i64| json!({"id": id, "chart": chart, "page": page, "x": 0, "y": y, "w": 6, "h": 7});
    let block = |id: &str, kind: &str, page: &str, y: i64, w: i64, h: i64| json!({"id": id, "chart": "table", "datasetId": null, "page": page, "x": 0, "y": y, "w": w, "h": h, "block": {"type": kind}});
    let pages = vec![
        json!({"id": "a", "name": "A"}),
        json!({"id": "b", "name": "B"}),
    ];
    let widgets = vec![
        block("hero", "text", "a", 0, 12, 3),
        item("k1", "kpi", "a", 3),
        block("go", "link", "a", 3, 3, 1),
        item("k2", "kpi", "a", 4),
        block("sec", "divider", "a", 10, 12, 1),
        item("line", "line", "a", 11),
        item("donut", "donut", "a", 12),
        item("other", "column", "b", 0),
        block("img", "image", "missing", 0, 3, 3),
    ];
    let out = arrange_pages(&widgets, &pages);
    assert_eq!(out.len(), widgets.len());
    let at = |id: &str| rect(out.iter().find(|w| w["id"] == id).unwrap());
    assert_eq!(at("hero"), (0, 0, 12, 3));
    assert_eq!(at("img"), (0, 3, 3, 4));
    assert_eq!(at("k1"), (3, 3, 3, 4));
    assert_eq!(at("go"), (6, 3, 3, 4));
    assert_eq!(at("k2"), (9, 3, 3, 4));
    assert_eq!(at("sec"), (0, 7, 12, 1));
    assert_eq!(at("line"), (0, 8, 8, 8));
    assert_eq!(at("donut"), (8, 8, 4, 8));
    assert_eq!(at("other"), (0, 0, 12, 7));
    let order: Vec<&str> = out.iter().map(|w| w["id"].as_str().unwrap()).collect();
    assert_eq!(
        order,
        ["hero", "img", "k1", "go", "k2", "sec", "line", "donut", "other"]
    );
    assert_pages_grid(&json!({"pages": pages, "widgets": out}));
    let plain = vec![item("x", "kpi", "a", 0), item("y", "line", "a", 1)];
    assert_eq!(arrange_pages(&plain, &[]), arrange(&plain));
}

#[test]
fn arrange_and_theme_validation_stay_fast() {
    let pages: Vec<Value> = (0..6)
        .map(|i| json!({"id": format!("p{i}"), "name": format!("Seite {i}")}))
        .collect();
    let kinds = ["kpi", "line", "donut", "bars", "table", "pivot"];
    let widgets: Vec<Value> = (0..60)
        .map(|i| {
            let mut widget = json!({"id": format!("w{i}"), "chart": kinds[i % kinds.len()], "page": format!("p{}", i % 6), "x": (i % 3) * 4, "y": i, "w": 4, "h": 7});
            if i % 10 == 0 {
                widget["block"] = json!({"type": if i % 20 == 0 { "divider" } else { "link" }});
            }
            widget
        })
        .collect();
    let mut samples = Vec::new();
    for _ in 0..21 {
        let started = Instant::now();
        let out = arrange_pages(&widgets, &pages);
        samples.push(started.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(out.len(), 60);
    }
    samples.sort_by(f64::total_cmp);
    let (median, worst) = (samples[10], samples[20]);
    let out = arrange_pages(&widgets, &pages);
    assert_pages_grid(&json!({"pages": pages, "widgets": out}));
    let logo = format!(
        "data:image/png;base64,{}",
        "QUJD".repeat((MAX_IMAGE_CHARS - 32) / 4)
    );
    assert!(logo.len() > 512 * 1024);
    let theme =
        json!({"logo": logo, "primary": "#0f766e", "palette": ["#0f766e", "#f59e0b", "#6366f1"]});
    let mut theme_samples = Vec::new();
    for _ in 0..21 {
        let started = Instant::now();
        let clean = validate_theme(Some(&theme)).unwrap();
        theme_samples.push(started.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(clean["logo"].as_str().unwrap().len(), logo.len());
    }
    theme_samples.sort_by(f64::total_cmp);
    let (theme_median, theme_worst) = (theme_samples[10], theme_samples[20]);
    println!(
        "dashboard arrange: 60 widgets on 6 pages, median {median:.3} ms, max {worst:.3} ms; theme with {} byte logo: median {theme_median:.3} ms, max {theme_worst:.3} ms",
        logo.len()
    );
    assert!(worst < 50.0, "arrange took {worst} ms");
    assert!(theme_worst < 20.0, "theme validation took {theme_worst} ms");
}

#[test]
fn compacted_images_from_get_keep_the_stored_image() {
    let logo = format!("data:image/png;base64,{}", "A".repeat(4096));
    let shown = compact_image(&logo);
    let current = json!({"brand": "ACME", "logo": logo});
    let (merged, _) = merge_theme(&current, &json!({"brand": "ACME 2", "logo": shown})).unwrap();
    assert_eq!(merged["logo"], json!(logo));
    assert_eq!(merged["brand"], json!("ACME 2"));
    let error = merge_theme(&json!({}), &json!({"logo": shown})).unwrap_err();
    assert!(error.contains("gekürzte Anzeige"), "{error}");
    assert!(check_image(&json!(shown), "src").is_err());
    assert!(check_image(&json!(logo), "src").is_ok());
}

#[test]
fn overlong_colors_are_rejected() {
    assert!(valid_color("#123456"));
    assert!(!valid_color(&format!("rgb({})", "1".repeat(80))));
}
