use super::config::{McpConfig, McpConnection};
use super::server::{self, cache_key, Server};
use crate::db::{self, ColumnInfo, DatabaseKind};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Instant;

pub(super) const BASELINE: &[(&str, usize)] = &[
    ("tools/list", 28_737),
    ("instructions", 1_324),
    ("byok start catalog", 12_201),
    ("shop.revenue_per_customer", 1_392),
    ("shop.overview", 939),
    ("huge.overview", 2_073),
    ("huge.tenant_id_tables", 20_030),
    ("huge.wide_table_column", 12_223),
    ("huge.revenue_per_customer", 21_960),
];

fn baseline(id: &str) -> String {
    BASELINE
        .iter()
        .find(|(name, _)| *name == id)
        .map_or("–".into(), |(_, bytes)| bytes.to_string())
}

pub(super) const TENANTS: usize = 300;
pub(super) const TENANT_TABLES: usize = 150;

const ENTITIES: [(&str, &str); 50] = [
    ("customers", "customer"),
    ("customer_addresses", "customer_address"),
    ("customer_contacts", "customer_contact"),
    ("customer_segments", "customer_segment"),
    ("orders", "order"),
    ("order_items", "order_item"),
    ("order_status_history", "order_status"),
    ("order_discounts", "order_discount"),
    ("invoices", "invoice"),
    ("invoice_lines", "invoice_line"),
    ("payments", "payment"),
    ("payment_methods", "payment_method"),
    ("refunds", "refund"),
    ("credit_notes", "credit_note"),
    ("products", "product"),
    ("product_prices", "product_price"),
    ("product_variants", "product_variant"),
    ("product_categories", "product_category"),
    ("inventory_levels", "inventory_level"),
    ("inventory_movements", "inventory_movement"),
    ("warehouses", "warehouse"),
    ("shipments", "shipment"),
    ("shipment_items", "shipment_item"),
    ("carriers", "carrier"),
    ("suppliers", "supplier"),
    ("supplier_contacts", "supplier_contact"),
    ("purchase_orders", "purchase_order"),
    ("purchase_order_lines", "purchase_order_line"),
    ("employees", "employee"),
    ("departments", "department"),
    ("cost_centers", "cost_center"),
    ("ledger_accounts", "ledger_account"),
    ("journal_entries", "journal_entry"),
    ("journal_lines", "journal_line"),
    ("tax_rates", "tax_rate"),
    ("currencies", "currency"),
    ("exchange_rates", "exchange_rate"),
    ("contracts", "contract"),
    ("contract_terms", "contract_term"),
    ("subscriptions", "subscription"),
    ("subscription_events", "subscription_event"),
    ("tickets", "ticket"),
    ("ticket_comments", "ticket_comment"),
    ("campaigns", "campaign"),
    ("campaign_members", "campaign_member"),
    ("leads", "lead"),
    ("opportunities", "opportunity"),
    ("quotes", "quote"),
    ("quote_lines", "quote_line"),
    ("price_lists", "price_list"),
];

const ATTRIBUTES: [&str; 60] = [
    "code",
    "label",
    "category",
    "priority",
    "channel",
    "region",
    "country_code",
    "city",
    "postal_code",
    "street",
    "notes",
    "valid_from",
    "valid_to",
    "quantity",
    "unit_price",
    "discount_pct",
    "tax_rate",
    "amount",
    "currency_code",
    "source_system",
    "owner_id",
    "assigned_to",
    "due_date",
    "closed_at",
    "score",
    "rating",
    "version",
    "checksum",
    "locale",
    "timezone",
    "reference_no",
    "batch_no",
    "approved_by",
    "approved_at",
    "cancelled_at",
    "cancel_reason",
    "weight_kg",
    "volume_m3",
    "is_active",
    "is_default",
    "sort_order",
    "color",
    "size",
    "material",
    "language",
    "segment",
    "tier",
    "margin_pct",
    "cost_amount",
    "list_price",
    "net_amount",
    "gross_amount",
    "booked_at",
    "period",
    "fiscal_year",
    "external_id",
    "sync_status",
    "synced_at",
    "metadata",
    "comment",
];

const TYPES: [&str; 10] = [
    "bigint",
    "text",
    "varchar(255)",
    "numeric(12,2)",
    "timestamptz",
    "boolean",
    "integer",
    "date",
    "uuid",
    "jsonb",
];

const MODULES: [&str; 39] = [
    "crm",
    "erp",
    "wms",
    "hr",
    "fin",
    "bi",
    "ops",
    "mkt",
    "sales",
    "support",
    "billing",
    "pricing",
    "catalog",
    "logistics",
    "procurement",
    "payroll",
    "legal",
    "audit",
    "risk",
    "planning",
    "service",
    "field",
    "fleet",
    "energy",
    "quality",
    "maint",
    "assets",
    "treasury",
    "tax",
    "portal",
    "shop",
    "loyalty",
    "survey",
    "docs",
    "events",
    "travel",
    "training",
    "facility",
    "security",
];

const METRICS: [&str; 56] = [
    "orders_count",
    "orders_amount",
    "revenue",
    "margin",
    "returns_count",
    "returns_amount",
    "visits",
    "sessions",
    "page_views",
    "cart_adds",
    "cart_abandons",
    "checkouts",
    "tickets_opened",
    "tickets_closed",
    "nps_score",
    "csat_score",
    "emails_sent",
    "emails_opened",
    "emails_clicked",
    "push_sent",
    "push_opened",
    "sms_sent",
    "coupons_used",
    "discount_amount",
    "shipping_amount",
    "late_deliveries",
    "payments_failed",
    "payments_amount",
    "refunds_count",
    "refunds_amount",
    "invoices_open",
    "invoices_overdue",
    "dunning_level",
    "credit_used",
    "points_earned",
    "points_redeemed",
    "app_logins",
    "web_logins",
    "search_count",
    "wishlist_adds",
    "reviews_written",
    "review_avg",
    "calls_inbound",
    "calls_outbound",
    "chat_sessions",
    "store_visits",
    "store_amount",
    "online_amount",
    "basket_avg",
    "items_avg",
    "churn_risk",
    "clv_estimate",
    "upsell_score",
    "cross_sell_score",
    "engagement_score",
    "fraud_score",
];

const WINDOWS: [&str; 8] = ["1d", "7d", "30d", "90d", "180d", "365d", "ytd", "lifetime"];

fn specific(entity: &str) -> &'static [&'static str] {
    match entity {
        "customers" => &[
            "customer_number",
            "email",
            "phone",
            "first_name",
            "last_name",
            "company_name",
            "vat_id",
            "segment_id",
            "credit_limit",
        ],
        "orders" => &["order_number", "customer_id", "ordered_at", "total_amount"],
        "order_items" => &["order_id", "product_id", "quantity", "unit_price"],
        "invoices" => &[
            "invoice_number",
            "customer_id",
            "invoice_date",
            "due_date",
            "amount_net",
            "amount_tax",
            "amount_gross",
            "currency_code",
        ],
        "payments" => &["invoice_id", "paid_at", "amount_paid", "method"],
        _ => &[],
    }
}

fn push(out: &mut Vec<ColumnInfo>, schema: &str, table: &str, name: &str, data_type: &str) {
    out.push(ColumnInfo {
        schema: schema.into(),
        table: table.into(),
        name: name.into(),
        data_type: data_type.into(),
    });
}

fn entity_table(out: &mut Vec<ColumnInfo>, schema: &str, table: &str, entity: usize, tenant: bool) {
    let (plural, _) = ENTITIES[entity];
    let mut names: Vec<String> = vec!["id".into()];
    if tenant {
        names.push("tenant_id".into());
    }
    names.extend(specific(plural).iter().map(|name| name.to_string()));
    for step in [1, 3, 5] {
        names.push(format!(
            "{}_id",
            ENTITIES[(entity * 7 + step) % ENTITIES.len()].1
        ));
    }
    names.extend((0..30).map(|k| ATTRIBUTES[(entity * 3 + k) % ATTRIBUTES.len()].to_string()));
    names.extend(["created_at", "updated_at", "created_by", "updated_by"].map(String::from));
    let mut seen = std::collections::HashSet::new();
    for (index, name) in names.iter().enumerate() {
        if seen.insert(name.as_str()) {
            push(
                out,
                schema,
                table,
                name,
                TYPES[(entity + index) % TYPES.len()],
            );
        }
    }
}

pub(super) fn huge_catalog() -> Vec<ColumnInfo> {
    let mut out = Vec::with_capacity(2_000_000);
    let tenant_tables: Vec<(String, usize)> = ["", "_audit", "_import"]
        .iter()
        .flat_map(|suffix| {
            ENTITIES
                .iter()
                .enumerate()
                .map(move |(index, (plural, _))| (format!("{plural}{suffix}"), index))
        })
        .collect();
    assert_eq!(tenant_tables.len(), TENANT_TABLES);
    for (index, (plural, _)) in ENTITIES.iter().enumerate() {
        entity_table(&mut out, "public", plural, index, false);
        for module in MODULES {
            entity_table(
                &mut out,
                "public",
                &format!("{module}_{plural}"),
                index,
                false,
            );
        }
        for period in ["daily", "weekly", "monthly"] {
            for region in 1..=10 {
                entity_table(
                    &mut out,
                    "analytics",
                    &format!("fact_{plural}_{period}_r{region:02}"),
                    index,
                    false,
                );
            }
        }
        for year in 2005..2025 {
            entity_table(
                &mut out,
                "archive",
                &format!("{plural}_{year}"),
                index,
                false,
            );
        }
        for batch in 0..10 {
            entity_table(
                &mut out,
                "staging",
                &format!("stg_{plural}_{batch:02}"),
                index,
                false,
            );
        }
    }
    push(&mut out, "public", "customer_360", "id", "bigint");
    push(&mut out, "public", "customer_360", "customer_id", "bigint");
    for (index, metric) in METRICS.iter().enumerate() {
        for window in WINDOWS {
            let name = if index == 20 && window == "lifetime" {
                "loyalty_tier".to_string()
            } else {
                format!("{metric}_{window}")
            };
            push(
                &mut out,
                "public",
                "customer_360",
                &name,
                TYPES[index % TYPES.len()],
            );
        }
    }
    for index in 0..620 {
        push(
            &mut out,
            "analytics",
            "event_wide",
            &format!("prop_{}_{index:03}", ATTRIBUTES[index % ATTRIBUTES.len()]),
            TYPES[index % TYPES.len()],
        );
    }
    for year in 2019..2024 {
        let table = format!("legacy_orders_{year}");
        for index in 0..410 {
            push(
                &mut out,
                "archive",
                &table,
                &format!("field_{index:03}"),
                "varchar(255)",
            );
        }
    }
    for tenant in 1..=TENANTS {
        let schema = format!("tenant_{tenant:03}");
        for (table, entity) in &tenant_tables {
            entity_table(&mut out, &schema, table, *entity, true);
        }
    }
    out
}

const SHOP: &str = "PRAGMA foreign_keys = ON;
CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT, email TEXT, country TEXT, created_at TEXT);
CREATE TABLE customer_addresses(id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), street TEXT, city TEXT, postal_code TEXT);
CREATE TABLE product_categories(id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE products(id INTEGER PRIMARY KEY, sku TEXT, name TEXT, category_id INTEGER REFERENCES product_categories(id), unit_price REAL);
CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), status TEXT, ordered_at TEXT);
CREATE TABLE order_items(id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id), product_id INTEGER REFERENCES products(id), quantity INTEGER, unit_price REAL);
CREATE TABLE invoices(id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id), amount_gross REAL, issued_at TEXT);
CREATE TABLE payments(id INTEGER PRIMARY KEY, invoice_id INTEGER REFERENCES invoices(id), amount REAL, paid_at TEXT, method TEXT);
CREATE TABLE shipments(id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id), carrier TEXT, shipped_at TEXT);
CREATE TABLE suppliers(id INTEGER PRIMARY KEY, name TEXT, contact_email TEXT);
CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY, supplier_id INTEGER REFERENCES suppliers(id), ordered_at TEXT);
CREATE TABLE employees(id INTEGER PRIMARY KEY, name TEXT, department TEXT, hired_at TEXT);
CREATE TABLE support_tickets(id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), subject TEXT, status TEXT);
CREATE TABLE audit_log(id INTEGER PRIMARY KEY, table_name TEXT, action TEXT, at TEXT);
CREATE INDEX orders_customer ON orders(customer_id);
CREATE INDEX order_items_order ON order_items(order_id);
INSERT INTO customers VALUES (1,'Alice','alice@example.com','DE','2026-01-01'),(2,'Bob','bob@example.com','AT','2026-01-02'),(3,'Carol','carol@example.com','CH','2026-01-03');
INSERT INTO product_categories VALUES (1,'Tools'),(2,'Garden');
INSERT INTO products VALUES (1,'T-1','Hammer',1,10.0),(2,'G-1','Hose',2,5.5);
INSERT INTO orders VALUES (1,1,'paid','2026-02-01'),(2,1,'open','2026-02-03'),(3,2,'paid','2026-02-04');
INSERT INTO order_items VALUES (1,1,1,2,10.0),(2,2,2,1,5.5),(3,3,2,2,5.5);";

pub(super) struct Step {
    pub tool: &'static str,
    pub args: Value,
    pub expect: &'static [&'static str],
}

pub(super) struct Task {
    pub id: &'static str,
    pub steps: Vec<Step>,
}

fn step(tool: &'static str, args: Value, expect: &'static [&'static str]) -> Step {
    Step { tool, args, expect }
}

pub(super) fn tasks() -> Vec<Task> {
    vec![
        Task {
            id: "shop.revenue_per_customer",
            steps: vec![
                step(
                    "search",
                    json!({"connection": "Shop", "term": "customer"}),
                    &["customers", "customer_id"],
                ),
                step(
                    "search",
                    json!({"connection": "Shop", "term": "order"}),
                    &["order_items", "unit_price"],
                ),
                step(
                    "relations",
                    json!({"connection": "Shop", "from": "customers", "to": "order_items"}),
                    &["JOIN main.orders", "JOIN main.order_items"],
                ),
                step(
                    "query",
                    json!({"connection": "Shop", "sql": "SELECT c.name, SUM(oi.quantity * oi.unit_price) AS revenue FROM customers c JOIN orders o ON o.customer_id = c.id JOIN order_items oi ON oi.order_id = o.id GROUP BY c.name ORDER BY revenue DESC"}),
                    &["Alice\t25.5", "Bob\t11"],
                ),
            ],
        },
        Task {
            id: "shop.overview",
            steps: vec![
                step(
                    "search",
                    json!({"connection": "Shop"}),
                    &["14", "customers", "order_items", "audit_log"],
                ),
                step(
                    "describe",
                    json!({"connection": "Shop", "tables": ["customers", "orders", "order_items"]}),
                    &["customer_id", "orders_customer"],
                ),
            ],
        },
        Task {
            id: "huge.overview",
            steps: vec![step(
                "search",
                json!({"connection": "Huge"}),
                &["50007", "public", "tenant_"],
            )],
        },
        Task {
            id: "huge.tenant_id_tables",
            steps: vec![step(
                "search",
                json!({"connection": "Huge", "term": "tenant_id"}),
                &["45000", "tenant_id"],
            )],
        },
        Task {
            id: "huge.wide_table_column",
            steps: vec![step(
                "search",
                json!({"connection": "Huge", "term": "loyalty_tier"}),
                &["public.customer_360", "loyalty_tier"],
            )],
        },
        Task {
            id: "huge.revenue_per_customer",
            steps: vec![
                step(
                    "search",
                    json!({"connection": "Huge", "term": "invoice"}),
                    &["invoices"],
                ),
                step(
                    "describe",
                    json!({"connection": "Huge", "tables": ["public.invoices", "public.customers"], "details": false}),
                    &["public.invoices", "amount_gross", "public.customers"],
                ),
            ],
        },
    ]
}

pub(super) struct Measured {
    pub id: &'static str,
    pub calls: usize,
    pub args: usize,
    pub response: usize,
    pub missing: Vec<String>,
}

impl Measured {
    pub fn total(&self) -> usize {
        self.args + self.response
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
        allow_ddl: true,
        allow_scripts: true,
        redact_columns: vec![],
        mask_rules: vec![],
        environment: None,
        allow_production_writes: false,
        database: None,
    }
}

pub(super) struct Lab {
    pub server: Server,
    pub config: McpConfig,
    pub runtime: tokio::runtime::Runtime,
    _dir: tempfile::TempDir,
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl Drop for Lab {
    fn drop(&mut self) {
        std::env::remove_var("L8DB_MCP_CONFIG");
    }
}

pub(super) fn lab(huge: Vec<ColumnInfo>) -> Lab {
    let guard = crate::mcp::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("L8DB_MCP_CONFIG", dir.path().join("mcp.json"));
    let db_path = dir.path().join("shop.db");
    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute_batch(SHOP)
        .unwrap();
    let shop = connection(
        "bench-shop",
        "Shop",
        DatabaseKind::Sqlite,
        &format!("sqlite:{}", db_path.display()),
    );
    let huge_connection = connection(
        "bench-huge",
        "Huge",
        DatabaseKind::Postgres,
        "postgres://bench@127.0.0.1:1/huge",
    );
    let mut server = Server {
        pool: db::pool::create_pool_state(),
        columns: HashMap::new(),
    };
    server
        .columns
        .insert(cache_key(&huge_connection), (Instant::now(), huge));
    let config = McpConfig {
        enabled: true,
        workflows: true,
        connections: vec![shop, huge_connection],
        ..McpConfig::default()
    };
    Lab {
        server,
        config,
        runtime: tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap(),
        _dir: dir,
        _guard: guard,
    }
}

pub(super) fn run_task(lab: &mut Lab, task: &Task) -> Measured {
    let mut measured = Measured {
        id: task.id,
        calls: 0,
        args: 0,
        response: 0,
        missing: Vec::new(),
    };
    for step in &task.steps {
        let reply = lab.runtime.block_on(lab.server.call_with_config(
            &json!({"name": step.tool, "arguments": step.args}),
            &lab.config,
        ));
        let text = reply["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string();
        if reply["isError"] != false {
            measured
                .missing
                .push(format!("{} error: {text}", step.tool));
        }
        measured.missing.extend(
            step.expect
                .iter()
                .filter(|expected| !text.contains(*expected))
                .map(|expected| format!("{} lacks {expected:?}", step.tool)),
        );
        measured.calls += 1;
        measured.args += serde_json::to_string(&step.args).unwrap().len();
        measured.response += text.len();
    }
    measured
}

pub(super) fn surface(config: &McpConfig) -> Vec<(String, usize)> {
    let listed = server::listed_tools(config);
    let mut rows = vec![
        (
            "tools/list".to_string(),
            serde_json::to_string(&json!({"tools": listed}))
                .unwrap()
                .len(),
        ),
        ("instructions".to_string(), server::INSTRUCTIONS.len()),
        (
            "byok start catalog".to_string(),
            serde_json::to_string(crate::ai::tools::Catalog::new(config, false, &[]).tools())
                .unwrap()
                .len(),
        ),
    ];
    for tool in &listed {
        rows.push((
            format!("tool {}", tool["name"].as_str().unwrap_or("")),
            serde_json::to_string(tool).unwrap().len(),
        ));
    }
    rows
}

fn tokens(bytes: usize) -> usize {
    bytes.div_ceil(4)
}

#[test]
fn token_benchmark_reports_surface_and_task_bytes() {
    let started = Instant::now();
    let catalog = huge_catalog();
    let tables: std::collections::HashSet<(&str, &str)> = catalog
        .iter()
        .map(|column| (column.schema.as_str(), column.table.as_str()))
        .collect();
    println!(
        "huge catalog: {} tables, {} columns, built in {:?}",
        tables.len(),
        catalog.len(),
        started.elapsed()
    );
    assert_eq!(tables.len(), 50_007);
    assert!(
        catalog.len() > 1_900_000 && catalog.len() < 2_100_000,
        "{}",
        catalog.len()
    );
    drop(tables);
    let mut lab = lab(catalog);
    println!("| measure | baseline B | bytes | ≈tokens (bytes/4) |\n|---|---:|---:|---:|");
    for (name, bytes) in surface(&lab.config) {
        println!(
            "| {name} | {} | {bytes} | {} |",
            baseline(&name),
            tokens(bytes)
        );
    }
    println!("| task | calls | baseline B | args B | response B | total B | ≈tokens (bytes/4) | info complete | ms |\n|---|---:|---:|---:|---:|---:|---:|---|---:|");
    let mut incomplete = Vec::new();
    for task in tasks() {
        let started = Instant::now();
        let measured = run_task(&mut lab, &task);
        println!(
            "| {} | {} | {} | {} | {} | {} | {} | {} | {} |",
            measured.id,
            measured.calls,
            baseline(measured.id),
            measured.args,
            measured.response,
            measured.total(),
            tokens(measured.total()),
            if measured.missing.is_empty() {
                "yes".to_string()
            } else {
                measured.missing.join("; ")
            },
            started.elapsed().as_millis()
        );
        if !measured.missing.is_empty() {
            incomplete.push(measured.id);
        }
    }
    println!("incomplete: {incomplete:?}");
}
