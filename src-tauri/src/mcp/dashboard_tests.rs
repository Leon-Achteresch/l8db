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
                "sql": "SELECT SUM(amount) AS revenue FROM orders",
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
        KINDS.len()
    );
    assert_eq!(schema["action"]["enum"].as_array().unwrap().len(), 13);
    assert!(definition["description"]
        .as_str()
        .unwrap()
        .contains("arrange"));
    let help = chart_types();
    assert!(help.contains("\nDesign (professional dashboards):\n- Layout"));
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
            {"type": "kpi", "title": "Orders", "sql": "SELECT COUNT(*) AS order_count FROM orders", "metrics": ["order_count"]},
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
    assert!(text.contains("  order_count\n  5\n  (1 rows)"), "{text}");
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
                {"type": "kpi", "title": "Fine", "sql": "SELECT 1 AS one", "metrics": ["one"]},
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
    assert!(text.starts_with("revenue\n1055.75"), "{text}");
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
        {"type": "number", "title": "Total", "sql": "SELECT SUM(amount) AS total FROM orders"},
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
    assert_eq!(mapping("Trend")["dimension"], "day");
    assert_eq!(mapping("Trend")["dateColumn"], "day");
    assert_eq!(mapping("Trend")["metrics"], json!(["orders", "revenue"]));
    assert_eq!(mapping("Matrix")["dimension2"], "status");
    assert_eq!(mapping("Matrix")["metrics"], json!(["n"]));
    lab.ok(json!({"action": "add_charts", "dashboard": "Loose", "charts": {"type": "kpi", "title": "Single", "sql": "SELECT COUNT(*) AS n FROM orders"}}));
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
    let sql = lab.err(json!({"action": "create", "connection": "Shop", "name": "X", "charts": [{"type": "kpi", "sql": "SELECT COUNT(*) AS n FROM orders WHERE region = {{land}}"}]}));
    assert!(sql.contains("{{land}}"), "{sql}");
    let bad_join = lab.err(json!({"action": "create", "connection": "Shop", "name": "X", "charts": [{"type": "kpi", "builder": {"table": "orders", "joins": [{"table": "regions", "on": "region"}]}}]}));
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
            {"type": "kpi", "title": "Menge", "builder": {"table": "orders", "joins": [{"table": "order_items", "as": "i", "on": "id = order_id"}], "metrics": ["sum(i.qty)"]}}
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
        _ => "SELECT SUM(amount) AS total FROM orders",
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
        let spec = json!({"type": kind, "sql": sql_for(kind), "options": options});
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
        {"type": "kpi", "title": "Umsatz", "sql": "SELECT SUM(amount) AS \"Umsatz\" FROM orders", "x": 0, "y": 0},
        {"type": "area", "title": "Verlauf", "sql": "SELECT created_at AS tag, SUM(amount) AS \"Umsatz\" FROM orders GROUP BY 1 ORDER BY 1", "dimension": "tag", "metrics": ["Umsatz"], "x": 0, "y": 10},
        {"type": "kpi", "title": "Bestellungen", "sql": "SELECT COUNT(*) AS \"Bestellungen\" FROM orders", "x": 3, "y": 0},
        {"type": "donut", "title": "Status", "sql": "SELECT status, COUNT(*) AS \"Anzahl\" FROM orders GROUP BY status", "x": 6, "y": 10},
        {"type": "kpi", "title": "Schnitt", "sql": "SELECT AVG(amount) AS \"Schnitt\" FROM orders", "x": 6, "y": 0},
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
        {"type": "kpi", "title": "Vergleich", "sql": "SELECT COUNT(*) AS \"Bestellungen\" FROM orders", "options": {"compare": "previous"}},
        {"type": "column", "title": "Baukasten", "builder": {"table": "orders", "dimension": "status", "metrics": ["sum(amount)"]}},
        {"type": "line", "title": "Sauber", "sql": "SELECT created_at AS \"Tag\", SUM(amount) AS \"Umsatz\" FROM orders GROUP BY 1 ORDER BY 1", "dimension": "Tag", "metrics": ["Umsatz"], "dateColumn": "Tag", "period": "30d", "options": {"compare": "year"}}
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
    assert!(compare.contains("kpi ohne dimension"), "{compare}");
    assert!(!compare.contains("technisch"), "{compare}");
    assert!(!report("Baukasten").contains("technisch"), "{text}");
    let clean = report("Sauber");
    assert!(
        !clean.contains("compare wirkt")
            && !clean.contains("technisch")
            && !clean.contains("Kategorien"),
        "{clean}"
    );
    assert_eq!(lab.only()["widgets"].as_array().unwrap().len(), 5);
}

#[test]
fn design_notes_flag_crowded_and_technical_charts() {
    let shape = |metrics: &[&str], dimension: bool, date: bool| Shape {
        dimension: dimension.then(|| "d".to_string()),
        dimension2: None,
        metrics: metrics.iter().map(|m| m.to_string()).collect(),
        date,
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
