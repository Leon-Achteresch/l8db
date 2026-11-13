use super::*;
use crate::db::pool::create_pool_state;
use crate::db::{create_adapter_from_string, ForeignKeyInfo};

#[test]
fn folds_simple_identifiers_to_target_convention() {
    assert_eq!(fold(Dialect::Oracle, "customer_id", true), "CUSTOMER_ID");
    assert_eq!(fold(Dialect::Postgres, "CUSTOMER_ID", true), "customer_id");
    assert_eq!(fold(Dialect::Postgres, "Order Items", true), "Order Items");
    assert_eq!(fold(Dialect::Mysql, "Orders", true), "Orders");
    assert_eq!(fold(Dialect::Oracle, "orders", false), "orders");
}

#[test]
fn names_are_deduplicated_and_truncated() {
    let mut names = Names::new(Dialect::Postgres);
    let long = "x".repeat(80);
    let first = names.take(&long);
    let second = names.take(&long);
    assert_eq!(first.len(), 63);
    assert_eq!(second.len(), 63);
    assert!(second.ends_with("_2"));
    assert_eq!(names.take("Users_pkey"), "Users_pkey");
    assert_eq!(names.take("users_pkey"), "users_pkey_2");
}

#[test]
fn parses_defaults_of_each_family() {
    use DefaultValue::*;
    let pg = DatabaseKind::Postgres;
    assert_eq!(
        parse_default(pg, "'abc'::character varying"),
        Some(Ok(Text("abc".into())))
    );
    assert_eq!(parse_default(pg, "now()"), Some(Ok(Now)));
    assert!(matches!(
        parse_default(pg, "nextval('t_id_seq'::regclass)"),
        Some(Err(_))
    ));
    assert_eq!(
        parse_default(DatabaseKind::Mssql, "((0))"),
        Some(Ok(Number("0".into())))
    );
    assert_eq!(
        parse_default(DatabaseKind::Mssql, "(getdate())"),
        Some(Ok(Now))
    );
    assert_eq!(
        parse_default(DatabaseKind::Mssql, "(N'it''s')"),
        Some(Ok(Text("it's".into())))
    );
    assert_eq!(
        parse_default(DatabaseKind::Oracle, "SYSDATE \n"),
        Some(Ok(Now))
    );
    assert_eq!(
        parse_default(DatabaseKind::Mysql, "open"),
        Some(Ok(Text("open".into())))
    );
    assert_eq!(parse_default(DatabaseKind::Sqlite, "NULL"), None);
    assert_eq!(parse_default(pg, "true"), Some(Ok(Bool(true))));
}

#[test]
fn renders_defaults_per_target() {
    use DefaultValue::*;
    assert_eq!(
        render_default(
            Dialect::Mysql,
            Canonical::Text,
            "LONGTEXT",
            &Text("x".into())
        ),
        Some("('x')".into())
    );
    assert_eq!(
        render_default(
            Dialect::Postgres,
            Canonical::Bool,
            "boolean",
            &Number("1".into())
        ),
        Some("TRUE".into())
    );
    assert_eq!(
        render_default(Dialect::Mysql, Canonical::Timestamp, "DATETIME(6)", &Now),
        Some("CURRENT_TIMESTAMP(6)".into())
    );
    assert_eq!(
        render_default(Dialect::Postgres, Canonical::Int, "integer", &Now),
        None
    );
    assert_eq!(
        render_default(
            Dialect::Mssql,
            Canonical::Varchar(Some(5)),
            "NVARCHAR(5)",
            &Text("a".into())
        ),
        Some("N'a'".into())
    );
}

#[test]
fn groups_composite_foreign_keys_and_reads_actions() {
    let row = |from: &str, to: &str| ForeignKeyInfo {
        constraint_name: "fk_line_order".into(),
        from_schema: "s".into(),
        from_table: "line".into(),
        from_column: from.into(),
        to_schema: "s".into(),
        to_table: "orders".into(),
        to_column: to.into(),
    };
    let actions = HashMap::from([(
        "fk_line_order".to_string(),
        "FOREIGN KEY (a, b) REFERENCES s.orders(x, y) ON UPDATE NO ACTION ON DELETE CASCADE"
            .to_string(),
    )]);
    let grouped = group_foreign_keys(vec![row("a", "x"), row("b", "y")], &actions);
    assert_eq!(grouped.len(), 1);
    assert_eq!(grouped[0].columns, vec!["a", "b"]);
    assert_eq!(grouped[0].ref_columns, vec!["x", "y"]);
    assert_eq!(grouped[0].on_delete.as_deref(), Some("CASCADE"));
    assert_eq!(grouped[0].on_update, None);
    let mut warnings = Vec::new();
    assert_eq!(
        action_sql(Dialect::Oracle, &grouped[0], &mut warnings),
        " ON DELETE CASCADE"
    );
    assert_eq!(action_sql(Dialect::Duckdb, &grouped[0], &mut warnings), "");
    assert_eq!(warnings.len(), 1);
}

fn table(name: &str, parents: &[&str]) -> SourceTable {
    SourceTable {
        pair: SchemaPair {
            source: "s".into(),
            target: "t".into(),
            tables: None,
        },
        name: name.into(),
        columns: Vec::new(),
        identity: HashSet::new(),
        generated: HashSet::new(),
        primary_key: Vec::new(),
        indexes: Vec::new(),
        constraints: Vec::new(),
        foreign_keys: parents
            .iter()
            .map(|parent| ForeignKey {
                name: format!("{name}_{parent}"),
                columns: vec!["p".into()],
                ref_schema: "s".into(),
                ref_table: parent.to_string(),
                ref_columns: vec!["id".into()],
                on_delete: None,
                on_update: None,
            })
            .collect(),
        partitioned: false,
    }
}

#[test]
fn loads_parents_before_children_and_survives_cycles() {
    let tables = vec![
        table("line", &["orders", "product"]),
        table("orders", &["customer"]),
        table("customer", &["customer"]),
        table("product", &[]),
    ];
    let names: Vec<&str> = load_order(&tables)
        .into_iter()
        .map(|i| tables[i].name.as_str())
        .collect();
    assert_eq!(names, vec!["customer", "orders", "product", "line"]);
    let cycle = vec![table("a", &["b"]), table("b", &["a"]), table("c", &[])];
    let order = load_order(&cycle);
    assert_eq!(order.len(), 3);
    assert_eq!(cycle[order[0]].name, "c");
}

fn quadratic_order(tables: &[SourceTable]) -> Vec<usize> {
    let index: HashMap<(&str, &str), usize> = tables
        .iter()
        .enumerate()
        .map(|(i, t)| ((t.pair.source.as_str(), t.name.as_str()), i))
        .collect();
    let parents: Vec<HashSet<usize>> = tables
        .iter()
        .enumerate()
        .map(|(i, t)| {
            t.foreign_keys
                .iter()
                .filter_map(|fk| index.get(&(fk.ref_schema.as_str(), fk.ref_table.as_str())))
                .copied()
                .filter(|parent| *parent != i)
                .collect()
        })
        .collect();
    let mut placed = vec![false; tables.len()];
    let mut order = Vec::new();
    while order.len() < tables.len() {
        let next = (0..tables.len())
            .find(|i| !placed[*i] && parents[*i].iter().all(|p| placed[*p]))
            .or_else(|| (0..tables.len()).find(|i| !placed[*i]))
            .unwrap_or_default();
        placed[next] = true;
        order.push(next);
    }
    order
}

#[test]
fn selected_partitioned_parents_bring_their_partitions() {
    let partitions: HashMap<String, String> = [
        ("umsatz_2025", "umsatz"),
        ("umsatz_2026", "umsatz"),
        ("umsatz_2026_q1", "umsatz_2026"),
        ("log_alt", "log"),
    ]
    .into_iter()
    .map(|(child, parent)| (child.to_string(), parent.to_string()))
    .collect();
    let chosen: HashSet<&str> = ["umsatz", "kunde"].into_iter().collect();
    let kept: Vec<&str> = [
        "umsatz",
        "umsatz_2025",
        "umsatz_2026",
        "umsatz_2026_q1",
        "log",
        "log_alt",
        "kunde",
    ]
    .into_iter()
    .filter(|name| within(&partitions, &chosen, name))
    .collect();
    assert_eq!(
        kept,
        [
            "umsatz",
            "umsatz_2025",
            "umsatz_2026",
            "umsatz_2026_q1",
            "kunde"
        ]
    );
    let looped: HashMap<String, String> = [("a", "b"), ("b", "a")]
        .into_iter()
        .map(|(child, parent)| (child.to_string(), parent.to_string()))
        .collect();
    assert!(!within(&looped, &chosen, "a"));
}

#[test]
fn load_order_matches_reference_and_scales_to_huge_schemas() {
    let mut seed = 7u64;
    let mut next = move || {
        seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (seed >> 33) as usize
    };
    for size in [1, 2, 5, 30, 200, 1000] {
        let names: Vec<String> = (0..size).map(|i| format!("t{i}")).collect();
        let tables: Vec<SourceTable> = (0..size)
            .map(|i| {
                let parents: Vec<&str> = (0..next() % 4)
                    .map(|_| names[next() % size].as_str())
                    .collect();
                table(&names[i], &parents)
            })
            .collect();
        assert_eq!(load_order(&tables), quadratic_order(&tables), "size {size}");
    }
    let size = 50_000;
    let names: Vec<String> = (0..size).map(|i| format!("t{i}")).collect();
    let tables: Vec<SourceTable> = (0..size)
        .map(|i| {
            let parents: Vec<&str> = names.get(i + 1).map(String::as_str).into_iter().collect();
            table(&names[i], &parents)
        })
        .collect();
    let started = std::time::Instant::now();
    let order = load_order(&tables);
    let elapsed = started.elapsed();
    eprintln!("load order for {size} chained tables: {elapsed:?}");
    assert_eq!(order.first(), Some(&(size - 1)));
    assert_eq!(order.last(), Some(&0));
    assert!(elapsed < std::time::Duration::from_secs(1), "{elapsed:?}");
}

#[test]
fn plan_requests_default_to_everything() {
    let request: PlanRequest = serde_json::from_value(serde_json::json!({
        "source": { "kind": "sqlite", "connectionString": "sqlite://x", "database": null },
        "schemas": [{ "source": "main", "target": "main" }],
    }))
    .unwrap();
    assert_eq!(request.content, Content::All);
    assert_eq!(request.schemas[0].tables, None);
    let scoped: PlanRequest = serde_json::from_value(serde_json::json!({
        "source": { "kind": "sqlite", "connectionString": "sqlite://x", "database": null },
        "schemas": [{ "source": "main", "target": "main", "tables": ["a"] }],
        "content": "data",
    }))
    .unwrap();
    assert_eq!(scoped.content, Content::Data);
    assert_eq!(scoped.schemas[0].tables, Some(vec!["a".to_string()]));
    let plan: TransferPlan = serde_json::from_value(serde_json::json!({
        "native": true, "atomic": true, "schemas": [], "createSchemas": [], "tables": [],
        "preData": [], "beforeLoad": [], "postData": [], "finalize": [], "sequences": [],
        "manual": [], "warnings": [], "conflicts": [],
    }))
    .unwrap();
    assert_eq!(plan.content, Content::All);
}

#[test]
fn reads_exact_numerics_as_text() {
    assert_eq!(
        read_expr(Dialect::Mysql, "amount", "decimal(30,10)"),
        "CAST(`amount` AS CHAR)"
    );
    assert_eq!(read_expr(Dialect::Mysql, "ratio", "double"), "`ratio`");
    assert_eq!(
        read_expr(Dialect::Mssql, "price", "money"),
        "CONVERT(NVARCHAR(100), CAST([price] AS DECIMAL(19,4)))"
    );
    assert_eq!(read_expr(Dialect::Mssql, "id", "bigint"), "[id]");
    assert_eq!(
        read_expr(Dialect::Oracle, "ID", "NUMBER"),
        "TO_CHAR(\"ID\", 'TM9', 'NLS_NUMERIC_CHARACTERS=''.,''')"
    );
    assert_eq!(
        read_expr(Dialect::Oracle, "CREATED", "DATE"),
        "TO_CHAR(\"CREATED\", 'YYYY-MM-DD HH24:MI:SS')"
    );
    assert_eq!(read_expr(Dialect::Oracle, "R", "BINARY_DOUBLE"), "\"R\"");
    assert_eq!(read_expr(Dialect::Postgres, "n", "numeric"), "\"n\"");
    assert_eq!(
        read_expr(Dialect::Clickhouse, "n", "UInt64"),
        "toString(`n`)"
    );
}

#[test]
fn normalizes_values_for_the_target() {
    assert_eq!(
        normalize(
            Dialect::Oracle,
            TypeClass::Bool,
            TypeClass::Decimal,
            Some("t".into())
        ),
        Some("1".into())
    );
    assert_eq!(
        normalize(
            Dialect::Mysql,
            TypeClass::TimestampTz,
            TypeClass::Timestamp,
            Some("2024-03-01 10:30:00+02".into())
        ),
        Some("2024-03-01 08:30:00.000000".into())
    );
    assert_eq!(
        normalize(Dialect::Postgres, TypeClass::Text, TypeClass::Text, None),
        None
    );
}

#[test]
fn compensation_drops_only_journaled_objects() {
    let statement = |kind: &str, name: &str| Statement::object("", kind, "APP", name);
    assert_eq!(
        drop_sql(Dialect::Oracle, &statement("table", "T")).as_deref(),
        Some("DROP TABLE \"APP\".\"T\" CASCADE CONSTRAINTS PURGE")
    );
    assert_eq!(
        drop_sql(Dialect::Oracle, &statement("package", "PKG")).as_deref(),
        Some("DROP PACKAGE \"APP\".\"PKG\"")
    );
    assert_eq!(
        drop_sql(Dialect::Oracle, &statement("package_body", "PKG")),
        None
    );
    assert_eq!(drop_sql(Dialect::Oracle, &statement("index", "IX")), None);
    assert_eq!(
        drop_sql(Dialect::Mysql, &statement("procedure", "p")).as_deref(),
        Some("DROP PROCEDURE IF EXISTS `APP`.`p`")
    );
    assert_eq!(drop_sql(Dialect::Oracle, &Statement::plain("x")), None);
}

struct Lab {
    dir: std::path::PathBuf,
}

impl Lab {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("l8db-transfer-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self { dir }
    }

    fn url(&self, scheme: &str, file: &str) -> String {
        format!("{scheme}://{}?mode=rwc", self.dir.join(file).display())
    }
}

impl Drop for Lab {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn endpoint(kind: DatabaseKind, url: &str) -> Endpoint {
    Endpoint {
        kind,
        connection_string: url.into(),
        database: None,
    }
}

async fn seed_source(url: &str) {
    let source =
        create_adapter_from_string(DatabaseKind::Sqlite, url, None, create_pool_state()).unwrap();
    let script = [
        "CREATE TABLE customer (id INTEGER PRIMARY KEY, name VARCHAR(40) NOT NULL, email VARCHAR(80) UNIQUE, vip BOOLEAN DEFAULT 0, created TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customer(id) ON DELETE CASCADE, total NUMERIC(18,4), note TEXT, payload BLOB, CHECK (total >= 0))",
        "CREATE INDEX orders_customer ON orders(customer_id)",
        "CREATE TABLE tag (label TEXT, weight REAL)",
        "CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 100",
    ];
    for sql in script {
        source.execute_query(sql).await.unwrap();
    }
    let customers: Vec<String> = (1..=50)
        .map(|i| {
            format!(
                "({i}, 'Kunde {i}', 'k{i}@example.com', {}, '2024-01-{:02} 10:00:00')",
                i % 2,
                i % 28 + 1
            )
        })
        .collect();
    source
        .execute_query(&format!(
            "INSERT INTO customer VALUES {}",
            customers.join(", ")
        ))
        .await
        .unwrap();
    for chunk in (1..=12_345).collect::<Vec<i64>>().chunks(1000) {
        let rows: Vec<String> = chunk
            .iter()
            .map(|i| {
                format!(
                    "({i}, {}, {}.{:04}, 'Notiz ''{i}''', X'00ff{:02x}')",
                    i % 50 + 1,
                    i,
                    i % 10_000,
                    i % 256
                )
            })
            .collect();
        source
            .execute_query(&format!("INSERT INTO orders VALUES {}", rows.join(", ")))
            .await
            .unwrap();
    }
    source
        .execute_query("INSERT INTO tag VALUES ('a', 1.5), ('a', 1.5), (NULL, NULL)")
        .await
        .unwrap();
}

fn no_progress(_: Progress) {}

async fn count(url: &str, kind: DatabaseKind, table: &str) -> i64 {
    let adapter = create_adapter_from_string(kind, url, None, create_pool_state()).unwrap();
    let result = adapter
        .execute_query(&format!("SELECT COUNT(*) AS n FROM {table}"))
        .await
        .unwrap();
    super::super::export::value_text(&result.rows[0]["n"])
        .unwrap()
        .parse()
        .unwrap()
}

#[cfg(feature = "duckdb")]
#[tokio::test]
async fn sqlite_to_duckdb_transfers_structure_and_data() {
    let lab = Lab::new("duck");
    let source_url = lab.url("sqlite", "source.sqlite");
    let target_url = lab.url("duckdb", "target.duckdb");
    seed_source(&source_url).await;
    let pool = create_pool_state();
    let target = endpoint(DatabaseKind::Duckdb, &target_url);
    let request = PlanRequest {
        source: endpoint(DatabaseKind::Sqlite, &source_url),
        schemas: vec![SchemaPair {
            source: "main".into(),
            target: "shop".into(),
            tables: None,
        }],
        fold_names: true,
        replace: false,
        mirror: false,
        content: Content::All,
    };
    let absent = plan(&target, &request, pool.clone()).await.unwrap_err();
    assert!(
        absent.contains("Zielschema shop existiert nicht"),
        "{absent}"
    );
    let duck =
        create_adapter_from_string(DatabaseKind::Duckdb, &target_url, None, pool.clone()).unwrap();
    duck.execute_query("CREATE SCHEMA shop").await.unwrap();
    let plan = plan(&target, &request, pool.clone()).await.unwrap();
    assert!(!plan.native);
    assert!(plan.atomic);
    let order: Vec<&str> = plan.tables.iter().map(|t| t.target_name.as_str()).collect();
    assert!(
        order.iter().position(|t| *t == "customer") < order.iter().position(|t| *t == "orders")
    );
    assert!(plan
        .manual
        .iter()
        .any(|m| m.object_type == "view" && m.name == "big_orders"));
    assert!(plan.manual.iter().any(|m| m.object_type == "check"));
    assert!(plan.conflicts.is_empty());
    let orders_ddl = plan
        .pre_data
        .iter()
        .find(|s| s.name.as_deref() == Some("orders"))
        .unwrap();
    assert!(
        orders_ddl
            .sql
            .contains("FOREIGN KEY (\"customer_id\") REFERENCES \"shop\".\"customer\" (\"id\")"),
        "{}",
        orders_ddl.sql
    );
    assert!(plan
        .post_data
        .iter()
        .any(|s| s.sql.starts_with("CREATE INDEX")));

    let outcome = run(
        &target,
        &RunRequest {
            source: request.source.clone(),
            plan: plan.clone(),
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert_eq!(outcome.error, None, "{outcome:?}");
    assert!(outcome.committed);
    assert_eq!(outcome.rows, 12_345 + 50 + 3);
    assert_eq!(
        count(&target_url, DatabaseKind::Duckdb, "shop.orders").await,
        12_345
    );
    let row = duck
        .execute_query("SELECT CAST(total AS VARCHAR) AS total, note, hex(payload) AS payload FROM shop.orders WHERE id = 12345")
        .await
        .unwrap();
    assert_eq!(row.rows[0]["total"], "12345.2345");
    assert_eq!(row.rows[0]["note"], "Notiz '12345'");
    assert_eq!(row.rows[0]["payload"], "00FF39");
    let rejected = duck
        .execute_query("INSERT INTO shop.orders (id, customer_id) VALUES (999999, 4242)")
        .await;
    assert!(rejected.is_err(), "foreign key must exist in the target");

    duck.execute_query("CREATE TABLE shop.extra (id INTEGER)")
        .await
        .unwrap();
    duck.execute_query("DELETE FROM shop.orders WHERE id > 100")
        .await
        .unwrap();
    let conflicting = super::plan(&target, &request, pool.clone()).await.unwrap();
    assert!(!conflicting.conflicts.is_empty());
    let mirror = PlanRequest {
        replace: true,
        mirror: true,
        ..request.clone()
    };
    let mirrored = super::plan(&target, &mirror, pool.clone()).await.unwrap();
    assert!(mirrored.conflicts.is_empty());
    assert!(
        mirrored.replaced.contains(&"TABLE shop.extra".to_string()),
        "{:?}",
        mirrored.replaced
    );
    let outcome = run(
        &target,
        &RunRequest {
            source: request.source.clone(),
            plan: mirrored,
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert_eq!(outcome.error, None, "{outcome:?}");
    assert_eq!(
        count(&target_url, DatabaseKind::Duckdb, "shop.orders").await,
        12_345
    );
    let tables: Vec<String> = duck
        .list_tables(Some("shop"))
        .await
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert!(!tables.contains(&"extra".to_string()), "{tables:?}");
    let schemas = duck.list_schemas().await.unwrap();
    assert!(schemas.contains(&"shop".to_string()));
}

#[cfg(feature = "duckdb")]
#[tokio::test]
async fn sqlite_to_duckdb_selected_tables_structure_then_data() {
    let lab = Lab::new("scope");
    let source_url = lab.url("sqlite", "source.sqlite");
    let target_url = lab.url("duckdb", "target.duckdb");
    seed_source(&source_url).await;
    let pool = create_pool_state();
    let target = endpoint(DatabaseKind::Duckdb, &target_url);
    let duck =
        create_adapter_from_string(DatabaseKind::Duckdb, &target_url, None, pool.clone()).unwrap();
    let rows = |table: &'static str| {
        let duck = &duck;
        async move {
            let result = duck
                .execute_query(&format!("SELECT COUNT(*) AS n FROM shop.{table}"))
                .await
                .unwrap();
            super::super::export::value_text(&result.rows[0]["n"]).unwrap()
        }
    };
    let source = endpoint(DatabaseKind::Sqlite, &source_url);
    let request = |content: Content, tables: &[&str]| PlanRequest {
        source: source.clone(),
        schemas: vec![SchemaPair {
            source: "main".into(),
            target: "shop".into(),
            tables: Some(tables.iter().map(|t| t.to_string()).collect()),
        }],
        fold_names: true,
        replace: false,
        mirror: false,
        content,
    };
    let empty = plan(&target, &request(Content::All, &[]), pool.clone())
        .await
        .unwrap_err();
    assert!(empty.contains("keine Tabelle ausgewählt"), "{empty}");
    let missing = plan(
        &target,
        &request(Content::Data, &["customer"]),
        pool.clone(),
    )
    .await
    .unwrap_err();
    assert!(
        missing.contains("Zielschema shop existiert nicht"),
        "{missing}"
    );
    duck.execute_query("CREATE SCHEMA shop").await.unwrap();

    let structure = plan(
        &target,
        &request(Content::Structure, &["orders", "customer", "gone"]),
        pool.clone(),
    )
    .await
    .unwrap();
    assert_eq!(structure.content, Content::Structure);
    let names: Vec<&str> = structure
        .tables
        .iter()
        .map(|t| t.target_name.as_str())
        .collect();
    assert_eq!(names, vec!["customer", "orders"]);
    assert!(structure.manual.iter().all(|m| m.object_type != "view"));
    assert!(
        structure.warnings.iter().any(|w| w.contains("gone")),
        "{:?}",
        structure.warnings
    );
    let built = run(
        &target,
        &RunRequest {
            source: source.clone(),
            plan: structure,
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert_eq!(built.error, None, "{built:?}");
    assert!(built.committed);
    assert_eq!(built.rows, 0);
    assert_eq!(rows("orders").await, "0");

    let absent = plan(
        &target,
        &request(Content::Data, &["customer", "tag"]),
        pool.clone(),
    )
    .await
    .unwrap_err();
    assert!(absent.contains("shop.tag"), "{absent}");

    let data = plan(
        &target,
        &request(Content::Data, &["orders", "customer"]),
        pool.clone(),
    )
    .await
    .unwrap();
    assert!(data.pre_data.is_empty() && data.post_data.is_empty());
    assert!(data.conflicts.is_empty() && data.manual.is_empty());
    let names: Vec<&str> = data.tables.iter().map(|t| t.target_name.as_str()).collect();
    assert_eq!(names, vec!["customer", "orders"]);
    let loaded = run(
        &target,
        &RunRequest {
            source: source.clone(),
            plan: data.clone(),
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert_eq!(loaded.error, None, "{loaded:?}");
    assert_eq!(loaded.rows, 12_345 + 50);
    assert_eq!(rows("orders").await, "12345");
    let refused = run(
        &target,
        &RunRequest {
            source: source.clone(),
            plan: data,
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap_err();
    assert!(refused.contains("enthält bereits Zeilen"), "{refused}");
    assert_eq!(rows("customer").await, "50");

    duck.execute_query("DELETE FROM shop.orders WHERE id > 10")
        .await
        .unwrap();
    let overwrite = PlanRequest {
        replace: true,
        ..request(Content::Data, &["orders", "customer"])
    };
    let refill = plan(&target, &overwrite, pool.clone()).await.unwrap();
    assert_eq!(refill.replaced.len(), 2);
    let replaced = run(
        &target,
        &RunRequest {
            source: source.clone(),
            plan: refill,
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert_eq!(replaced.error, None, "{replaced:?}");
    assert_eq!(rows("orders").await, "12345");
    assert_eq!(rows("customer").await, "50");

    let partial = PlanRequest {
        replace: true,
        ..request(Content::All, &["orders"])
    };
    let rebuild = plan(&target, &partial, pool.clone()).await.unwrap();
    assert_eq!(rebuild.replaced, vec!["TABLE shop.orders".to_string()]);
    let rebuilt = run(
        &target,
        &RunRequest {
            source,
            plan: rebuild,
        },
        pool,
        &no_progress,
    )
    .await
    .unwrap();
    assert_eq!(rebuilt.error, None, "{rebuilt:?}");
    assert_eq!(rows("orders").await, "12345");
    assert_eq!(rows("customer").await, "50");
}

#[tokio::test]
async fn sqlite_native_transfer_rolls_back_completely_on_failure() {
    let lab = Lab::new("rollback");
    let source_url = lab.url("sqlite", "source.sqlite");
    let target_url = lab.url("sqlite", "target.sqlite");
    seed_source(&source_url).await;
    let pool = create_pool_state();
    let target = endpoint(DatabaseKind::Sqlite, &target_url);
    let source = endpoint(DatabaseKind::Sqlite, &source_url);
    let request = PlanRequest {
        source: source.clone(),
        schemas: vec![SchemaPair {
            source: "main".into(),
            target: "main".into(),
            tables: None,
        }],
        fold_names: true,
        replace: false,
        mirror: false,
        content: Content::All,
    };
    let mut plan = plan(&target, &request, pool.clone()).await.unwrap();
    assert!(plan.native);
    let adapter =
        create_adapter_from_string(DatabaseKind::Sqlite, &source_url, None, pool.clone()).unwrap();
    let ddl = adapter
        .execute_query(
            "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .await
        .unwrap();
    plan.pre_data = ddl
        .rows
        .iter()
        .map(|row| {
            let name = row["name"].as_str().unwrap();
            Statement::object(row["sql"].as_str().unwrap(), "table", "main", name)
        })
        .collect();

    let mut broken = plan.clone();
    broken.post_data = vec![Statement::plain("CREATE INDEX broken ON no_such_table (x)")];
    let failed = run(
        &target,
        &RunRequest {
            source: source.clone(),
            plan: broken,
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert!(failed.error.is_some());
    assert!(failed.rolled_back);
    assert!(!failed.committed);
    let target_adapter =
        create_adapter_from_string(DatabaseKind::Sqlite, &target_url, None, pool.clone()).unwrap();
    assert!(target_adapter
        .list_tables(Some("main"))
        .await
        .unwrap()
        .is_empty());

    let done = run(
        &target,
        &RunRequest {
            source: source.clone(),
            plan: plan.clone(),
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert_eq!(done.error, None);
    assert_eq!(
        count(&target_url, DatabaseKind::Sqlite, "orders").await,
        12_345
    );
    assert_eq!(count(&target_url, DatabaseKind::Sqlite, "tag").await, 3);

    let again = run(&target, &RunRequest { source, plan }, pool, &no_progress)
        .await
        .unwrap_err();
    assert!(again.contains("existieren bereits"), "{again}");
    assert_eq!(
        count(&target_url, DatabaseKind::Sqlite, "orders").await,
        12_345
    );
}

fn live_url(name: &str) -> Option<String> {
    std::env::var(format!("L8DB_TR_{name}_URL"))
        .ok()
        .filter(|v| !v.is_empty())
}

fn required_url(name: &str) -> String {
    live_url(name).unwrap_or_else(|| panic!("Lab fehlt: L8DB_TR_{name}_URL ist nicht gesetzt"))
}

async fn exec_all(adapter: &dyn DatabaseAdapter, script: &[&str]) {
    for sql in script {
        if let Err(error) = adapter.execute_query(sql).await {
            panic!("{sql}: {error}");
        }
    }
}

async fn scalar(adapter: &dyn DatabaseAdapter, sql: &str) -> Option<String> {
    let result = adapter
        .execute_query(sql)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
    let column = result.columns.first()?.clone();
    result
        .rows
        .first()?
        .get(&column)
        .and_then(super::super::export::value_text)
}

async fn seed_postgres(url: &str) {
    let pg =
        create_adapter_from_string(DatabaseKind::Postgres, url, None, create_pool_state()).unwrap();
    for schema in [
        "tr_src",
        "tr_back_mysql",
        "tr_back_oracle",
        "tr_back_mssql",
        "tr_native",
    ] {
        pg.execute_query(&format!("DROP SCHEMA IF EXISTS {schema} CASCADE"))
            .await
            .unwrap();
    }
    exec_all(pg.as_ref(), &[
        "CREATE SCHEMA tr_src",
        "CREATE SCHEMA tr_native",
        "CREATE TABLE tr_src.customer (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name varchar(40) NOT NULL, email varchar(80) UNIQUE, vip boolean DEFAULT false, balance numeric(20,6) DEFAULT 0, created timestamptz DEFAULT now(), meta jsonb, tags text[])",
        "CREATE TABLE tr_src.orders (id bigserial PRIMARY KEY, customer_id integer NOT NULL REFERENCES tr_src.customer(id) ON DELETE CASCADE, total numeric(18,4) CHECK (total >= 0), note text, payload bytea, placed date)",
        "CREATE INDEX orders_customer_ix ON tr_src.orders(customer_id)",
        "CREATE TABLE tr_src.emp (id integer PRIMARY KEY, boss integer REFERENCES tr_src.emp(id), name varchar(20))",
        "CREATE VIEW tr_src.big AS SELECT * FROM tr_src.orders WHERE total > 100",
        "CREATE FUNCTION tr_src.answer() RETURNS integer LANGUAGE sql AS 'SELECT 42'",
        "CREATE SEQUENCE tr_src.invoice_seq START 1000",
        "SELECT nextval('tr_src.invoice_seq') FROM generate_series(1, 5)",
        "INSERT INTO tr_src.customer (name, email, vip, balance, created, meta, tags) SELECT 'Kunde ' || g, 'k' || g || '@example.com', g % 3 = 0, g::numeric * 1000000007 / 1000000 + 0.123456, timestamptz '2024-01-01 12:00:00+02' + g * interval '1 hour', jsonb_build_object('n', g), ARRAY['a', 'b' || g] FROM generate_series(1, 200) g",
        "INSERT INTO tr_src.orders (customer_id, total, note, payload, placed) SELECT g % 200 + 1, g + 0.0001 * (g % 10000), CASE WHEN g % 7 = 0 THEN NULL ELSE 'Notiz ''' || g || ''' äöü' END, decode(lpad(to_hex(g % 65536), 4, '0') || '00ff', 'hex'), date '2024-01-01' + g % 400 FROM generate_series(1, 12000) g",
        "INSERT INTO tr_src.emp VALUES (1, NULL, 'Chefin'), (2, 1, 'A'), (3, 2, 'B'), (4, 2, 'C')",
    ]).await;
}

struct Live {
    pool: PoolState,
}

impl Live {
    async fn transfer(
        &self,
        source: &Endpoint,
        target: &Endpoint,
        pairs: &[(&str, &str)],
    ) -> (TransferPlan, TransferOutcome) {
        let request = PlanRequest {
            source: source.clone(),
            schemas: pairs
                .iter()
                .map(|(s, t)| SchemaPair {
                    source: s.to_string(),
                    target: t.to_string(),
                    tables: None,
                })
                .collect(),
            fold_names: true,
            replace: false,
            mirror: false,
            content: Content::All,
        };
        let plan = plan(target, &request, self.pool.clone())
            .await
            .unwrap_or_else(|e| panic!("plan {:?} -> {:?}: {e}", source.kind, target.kind));
        assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
        let outcome = self.run(source, target, plan.clone()).await;
        (plan, outcome)
    }

    async fn run(
        &self,
        source: &Endpoint,
        target: &Endpoint,
        plan: TransferPlan,
    ) -> TransferOutcome {
        run(
            target,
            &RunRequest {
                source: source.clone(),
                plan,
            },
            self.pool.clone(),
            &no_progress,
        )
        .await
        .unwrap()
    }
}

async fn assert_round_trip(pg: &dyn DatabaseAdapter, schema: &str, customers: u64) {
    for (table, expected) in [("customer", customers), ("orders", 12000), ("emp", 4)] {
        let n = scalar(pg, &format!("SELECT COUNT(*) FROM {schema}.{table}"))
            .await
            .unwrap();
        assert_eq!(n, expected.to_string(), "{schema}.{table}");
    }
    let diff = scalar(pg, &format!(
        "SELECT COUNT(*) FROM tr_src.orders o JOIN {schema}.orders c ON c.id = o.id WHERE c.total::numeric <> o.total OR c.customer_id::bigint <> o.customer_id OR COALESCE(c.note::text, '<null>') <> COALESCE(o.note, '<null>')"
    )).await.unwrap();
    assert_eq!(diff, "0", "{schema}.orders values differ");
    let balance = scalar(pg, &format!(
        "SELECT COUNT(*) FROM tr_src.customer o JOIN {schema}.customer c ON c.id = o.id WHERE c.balance::numeric <> o.balance OR c.name::text <> o.name"
    )).await.unwrap();
    assert_eq!(balance, "0", "{schema}.customer values differ");
}

#[tokio::test]
#[ignore]
async fn transfer_live_matrix() {
    let pg_url = required_url("PG");
    seed_postgres(&pg_url).await;
    let live = Live {
        pool: create_pool_state(),
    };
    let pg = endpoint(DatabaseKind::Postgres, &pg_url);
    let pg_adapter =
        create_adapter_from_string(DatabaseKind::Postgres, &pg_url, None, live.pool.clone())
            .unwrap();

    let (plan_pg, native) = live.transfer(&pg, &pg, &[("tr_src", "tr_native")]).await;
    assert!(plan_pg.native);
    assert!(
        native.error.is_some(),
        "native plan without structure must fail loudly"
    );
    assert!(native.rolled_back);
    let catalog = pg_adapter
        .schema_catalog(
            "tr_src",
            &[
                "sequence".into(),
                "table".into(),
                "constraint".into(),
                "index".into(),
            ],
        )
        .await
        .unwrap();
    let requalify = |ddl: &str| {
        ddl.replace("tr_src.", "tr_native.")
            .replace("\"tr_src\".", "\"tr_native\".")
    };
    let mut native_plan = plan_pg.clone();
    native_plan.pre_data = catalog
        .iter()
        .filter(|o| o.object_type == "sequence" || o.object_type == "table")
        .map(|o| Statement::object(requalify(&o.ddl), &o.object_type, "tr_native", &o.name))
        .collect();
    let mut post: Vec<&crate::db::schema_catalog::CatalogObject> = catalog
        .iter()
        .filter(|o| o.object_type == "constraint" || o.object_type == "index")
        .filter(|o| !o.ddl.is_empty())
        .collect();
    post.sort_by_key(|o| o.ddl.contains("FOREIGN KEY"));
    native_plan.post_data = post
        .iter()
        .map(|o| Statement::plain(requalify(&o.ddl)))
        .collect();
    let done = live.run(&pg, &pg, native_plan).await;
    assert_eq!(done.error, None, "{done:?}");
    assert_round_trip(pg_adapter.as_ref(), "tr_native", 200).await;
    exec_all(
        pg_adapter.as_ref(),
        &["INSERT INTO tr_native.customer (name) VALUES ('neu')"],
    )
    .await;
    assert_eq!(
        scalar(
            pg_adapter.as_ref(),
            "SELECT MAX(id) FROM tr_native.customer"
        )
        .await
        .unwrap(),
        "201"
    );
    assert_eq!(
        scalar(
            pg_adapter.as_ref(),
            "SELECT nextval('tr_native.invoice_seq')"
        )
        .await
        .unwrap(),
        "1005"
    );

    let targets = [
        ("MYSQL", DatabaseKind::Mysql, "tr_copy", "tr_back_mysql"),
        ("ORACLE", DatabaseKind::Oracle, "L8DB", "tr_back_oracle"),
        ("MSSQL", DatabaseKind::Mssql, "tr_copy", "tr_back_mssql"),
    ];
    for (name, kind, schema, back) in targets {
        let Some(url) = live_url(name) else {
            eprintln!("transfer matrix: {name} übersprungen, L8DB_TR_{name}_URL fehlt");
            continue;
        };
        let target = endpoint(kind, &url);
        let adapter = create_adapter_from_string(kind, &url, None, live.pool.clone()).unwrap();
        match kind {
            DatabaseKind::Mysql => {
                let _ = adapter
                    .execute_query("DROP DATABASE IF EXISTS tr_copy")
                    .await;
            }
            DatabaseKind::Oracle => {
                for t in ["ORDERS", "EMP", "CUSTOMER"] {
                    let _ = adapter
                        .execute_query(&format!("DROP TABLE L8DB.{t} CASCADE CONSTRAINTS PURGE"))
                        .await;
                }
                let _ = adapter
                    .execute_query("DROP SEQUENCE L8DB.INVOICE_SEQ")
                    .await;
            }
            _ => {
                for t in ["orders", "emp", "customer"] {
                    let _ = adapter
                        .execute_query(&format!("DROP TABLE IF EXISTS tr_copy.{t}"))
                        .await;
                }
                let _ = adapter
                    .execute_query("DROP SEQUENCE IF EXISTS tr_copy.invoice_seq")
                    .await;
                let _ = adapter.execute_query("DROP SCHEMA IF EXISTS tr_copy").await;
            }
        }

        let (plan, broken_first) = {
            let request = PlanRequest {
                source: pg.clone(),
                schemas: vec![SchemaPair {
                    source: "tr_src".into(),
                    target: schema.into(),
                    tables: None,
                }],
                fold_names: true,
                replace: false,
                mirror: false,
                content: Content::All,
            };
            let plan = plan(&target, &request, live.pool.clone())
                .await
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            let mut broken = plan.clone();
            broken.post_data.push(Statement::plain(
                "CREATE INDEX l8db_broken ON l8db_missing_table (x)",
            ));
            (plan, live.run(&pg, &target, broken).await)
        };
        assert!(broken_first.error.is_some(), "{name}");
        assert!(broken_first.rolled_back, "{name}: {broken_first:?}");
        assert!(
            broken_first.leftovers.is_empty(),
            "{name}: {:?}",
            broken_first.leftovers
        );
        let remaining = adapter.list_tables(Some(schema)).await.unwrap_or_default();
        assert!(
            !remaining
                .iter()
                .any(|t| ["customer", "orders", "emp"]
                    .contains(&t.name.to_ascii_lowercase().as_str())),
            "{name}: {remaining:?}"
        );

        let outcome = live.run(&pg, &target, plan.clone()).await;
        assert_eq!(outcome.error, None, "{name}: {outcome:?}");
        assert_eq!(outcome.rows, 12_204, "{name}");
        let q = |t: &str| {
            Dialect::from_kind(kind)
                .unwrap()
                .target(schema, &fold(Dialect::from_kind(kind).unwrap(), t, true))
        };
        let orphan = adapter
            .execute_query(&format!(
                "INSERT INTO {} ({}, {}) VALUES (999999, 424242)",
                q("orders"),
                fold(Dialect::from_kind(kind).unwrap(), "id", true),
                fold(Dialect::from_kind(kind).unwrap(), "customer_id", true)
            ))
            .await;
        assert!(orphan.is_err(), "{name}: foreign key missing");
        let name_column = fold(Dialect::from_kind(kind).unwrap(), "name", true);
        adapter
            .execute_query(&format!(
                "INSERT INTO {} ({name_column}) VALUES ('neu')",
                q("customer")
            ))
            .await
            .unwrap_or_else(|e| panic!("{name}: identity insert: {e}"));

        let (_, returned) = live.transfer(&target, &pg, &[(schema, back)]).await;
        assert_eq!(returned.error, None, "{name} back: {returned:?}");
        assert_round_trip(pg_adapter.as_ref(), back, 201).await;
    }
}

#[test]
fn oracle_integer_numbers_map_to_integer_types() {
    let ora = DatabaseKind::Oracle;
    assert_eq!(
        column_canonical(ora, "NUMBER(10,0)", None, false),
        Canonical::BigInt
    );
    assert_eq!(
        column_canonical(ora, "NUMBER(5)", None, false),
        Canonical::Int
    );
    assert_eq!(
        column_canonical(ora, "NUMBER(4)", None, false),
        Canonical::SmallInt
    );
    assert_eq!(
        column_canonical(ora, "NUMBER(19)", None, false),
        Canonical::Decimal(Some((19, 0)))
    );
    assert_eq!(
        column_canonical(ora, "NUMBER", None, true),
        Canonical::BigInt
    );
    assert_eq!(
        column_canonical(ora, "NUMBER(12,2)", None, false),
        Canonical::Decimal(Some((12, 2)))
    );
    assert_eq!(
        column_canonical(DatabaseKind::Postgres, "numeric(10,0)", None, false),
        Canonical::Decimal(Some((10, 0)))
    );
}

#[tokio::test]
#[ignore]
async fn transfer_live_oracle_native_packages() {
    let (url, system) = (required_url("ORACLE"), required_url("ORACLE_SYSTEM"));
    let pool = create_pool_state();
    let admin =
        create_adapter_from_string(DatabaseKind::Oracle, &system, None, pool.clone()).unwrap();
    for user in ["TR_SRC", "TR_DST"] {
        let _ = admin
            .execute_query(&format!("DROP USER {user} CASCADE"))
            .await;
        exec_all(admin.as_ref(), &[
            &format!("CREATE USER {user} IDENTIFIED BY l8dbtest QUOTA UNLIMITED ON USERS"),
            &format!("GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE, CREATE PROCEDURE, CREATE VIEW TO {user}"),
        ]).await;
    }
    exec_all(admin.as_ref(), &[
        "CREATE TABLE TR_SRC.KUNDE (ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, NAME VARCHAR2(40) NOT NULL, SALDO NUMBER(14,4), ANGELEGT DATE DEFAULT SYSDATE)",
        "CREATE TABLE TR_SRC.AUFTRAG (ID NUMBER(10) PRIMARY KEY, KUNDE_ID NUMBER NOT NULL REFERENCES TR_SRC.KUNDE(ID), BETRAG NUMBER(12,2))",
        "INSERT INTO TR_SRC.KUNDE (NAME, SALDO, ANGELEGT) SELECT 'Kunde ' || LEVEL, LEVEL * 1.2345, DATE '2024-01-01' + LEVEL FROM DUAL CONNECT BY LEVEL <= 300",
        "INSERT INTO TR_SRC.AUFTRAG SELECT LEVEL, MOD(LEVEL, 300) + 1, LEVEL / 7 FROM DUAL CONNECT BY LEVEL <= 2500",
        "CREATE SEQUENCE TR_SRC.BELEG_SEQ START WITH 500",
        "CREATE OR REPLACE VIEW TR_SRC.GROSSE_AUFTRAEGE AS SELECT * FROM TR_SRC.AUFTRAG WHERE BETRAG > 100",
    ]).await;
    let src = create_adapter_from_string(
        DatabaseKind::Oracle,
        &url.replace("l8db:l8dbtest", "TR_SRC:l8dbtest"),
        None,
        pool.clone(),
    )
    .unwrap();
    for sql in [
        "CREATE OR REPLACE PACKAGE TR_SRC.KONTO AS\n  FUNCTION SALDO_VON(P_ID NUMBER) RETURN NUMBER;\n  ZAEHLER NUMBER := 0;\nEND KONTO;",
        "CREATE OR REPLACE PACKAGE BODY TR_SRC.KONTO AS\n  FUNCTION SALDO_VON(P_ID NUMBER) RETURN NUMBER IS\n    V NUMBER;\n  BEGIN\n    ZAEHLER := ZAEHLER + 1;\n    SELECT SALDO INTO V FROM TR_SRC.KUNDE WHERE ID = P_ID;\n    RETURN V;\n  END;\nEND KONTO;",
    ] {
        let results = src.execute_script(sql).await.unwrap();
        assert!(results.iter().all(|r| r.success), "{results:?}");
    }
    let _ = scalar(src.as_ref(), "SELECT TR_SRC.BELEG_SEQ.NEXTVAL FROM DUAL").await;

    let source = endpoint(
        DatabaseKind::Oracle,
        &url.replace("l8db:l8dbtest", "TR_SRC:l8dbtest"),
    );
    let target = endpoint(
        DatabaseKind::Oracle,
        &url.replace("l8db:l8dbtest", "TR_DST:l8dbtest"),
    );
    let request = PlanRequest {
        source: source.clone(),
        schemas: vec![SchemaPair {
            source: "TR_SRC".into(),
            target: "TR_DST".into(),
            tables: None,
        }],
        fold_names: true,
        replace: false,
        mirror: false,
        content: Content::All,
    };
    let mut plan = plan(&target, &request, pool.clone()).await.unwrap();
    assert!(plan.native && !plan.atomic);
    assert_eq!(plan.before_load.len(), 1, "{:?}", plan.before_load);
    let catalog = src
        .schema_catalog(
            "TR_SRC",
            &[
                "table",
                "constraint",
                "sequence",
                "view",
                "package",
                "package_body",
            ]
            .map(String::from),
        )
        .await
        .unwrap();
    let requalify = |ddl: &str| {
        ddl.replace("\"TR_SRC\"", "\"TR_DST\"")
            .replace("TR_SRC.", "TR_DST.")
    };
    let pick = |kinds: &[&str]| -> Vec<Statement> {
        let mut objects: Vec<_> = catalog
            .iter()
            .filter(|o| kinds.contains(&o.object_type.as_str()))
            .collect();
        objects.sort_by_key(|o| {
            (
                kinds.iter().position(|k| *k == o.object_type),
                o.ddl.contains("FOREIGN KEY"),
            )
        });
        objects
            .into_iter()
            .map(|o| match o.object_type.as_str() {
                "constraint" | "package_body" => Statement::plain(requalify(&o.ddl)),
                kind => Statement::object(requalify(&o.ddl), kind, "TR_DST", &o.name),
            })
            .collect()
    };
    plan.pre_data = pick(&["sequence", "table"]);
    plan.post_data = pick(&["constraint", "view", "package", "package_body"]);

    let mut broken = plan.clone();
    broken.post_data.push(Statement::plain(
        "CREATE INDEX TR_DST.KAPUTT ON TR_DST.GIBTSNICHT (X)",
    ));
    let failed = run(
        &target,
        &RunRequest {
            source: source.clone(),
            plan: broken,
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert!(failed.rolled_back, "{failed:?}");
    assert!(failed.leftovers.is_empty(), "{:?}", failed.leftovers);
    let left = scalar(
        admin.as_ref(),
        "SELECT COUNT(*) FROM all_objects WHERE owner = 'TR_DST'",
    )
    .await
    .unwrap();
    assert_eq!(
        left, "0",
        "compensation must remove tables, views, sequences and packages"
    );

    let done = run(
        &target,
        &RunRequest { source, plan },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert_eq!(done.error, None, "{done:?}");
    assert_eq!(done.rows, 2800);
    let dst = create_adapter_from_string(
        DatabaseKind::Oracle,
        &target.connection_string,
        None,
        pool.clone(),
    )
    .unwrap();
    assert_eq!(
        scalar(
            dst.as_ref(),
            "SELECT TO_CHAR(TR_DST.KONTO.SALDO_VON(7)) FROM DUAL"
        )
        .await
        .unwrap(),
        "8.6415"
    );
    assert_eq!(
        scalar(dst.as_ref(), "SELECT COUNT(*) FROM TR_DST.GROSSE_AUFTRAEGE")
            .await
            .unwrap(),
        scalar(src.as_ref(), "SELECT COUNT(*) FROM TR_SRC.GROSSE_AUFTRAEGE")
            .await
            .unwrap()
    );
    assert_eq!(
        scalar(admin.as_ref(), "SELECT generation_type FROM all_tab_identity_cols WHERE owner = 'TR_DST' AND table_name = 'KUNDE'").await.unwrap(),
        "ALWAYS"
    );
    exec_all(
        dst.as_ref(),
        &["INSERT INTO TR_DST.KUNDE (NAME) VALUES ('neu')"],
    )
    .await;
    assert_eq!(
        scalar(dst.as_ref(), "SELECT MAX(ID) FROM TR_DST.KUNDE")
            .await
            .unwrap(),
        "301"
    );
    let next: i64 = scalar(dst.as_ref(), "SELECT TR_DST.BELEG_SEQ.NEXTVAL FROM DUAL")
        .await
        .unwrap()
        .parse()
        .unwrap();
    assert!(next > 500, "{next}");
    assert_eq!(
        scalar(
            dst.as_ref(),
            "SELECT TO_CHAR(ANGELEGT, 'YYYY-MM-DD') FROM TR_DST.KUNDE WHERE ID = 1"
        )
        .await
        .unwrap(),
        "2024-01-02"
    );
    for user in ["TR_SRC", "TR_DST"] {
        let _ = admin
            .execute_query(&format!("DROP USER {user} CASCADE"))
            .await;
    }
}

#[tokio::test]
#[ignore]
async fn transfer_live_mssql_snapshot_source() {
    let Some(url) = live_url("MSSQL") else { return };
    let pool = create_pool_state();
    let master = create_adapter_from_string(DatabaseKind::Mssql, &url, None, pool.clone()).unwrap();
    let _ = master
        .execute_query("DROP DATABASE IF EXISTS tr_snap")
        .await;
    exec_all(
        master.as_ref(),
        &[
            "CREATE DATABASE tr_snap",
            "ALTER DATABASE tr_snap SET ALLOW_SNAPSHOT_ISOLATION ON",
        ],
    )
    .await;
    let snap_url = url.replace("/master", "/tr_snap");
    let snap =
        create_adapter_from_string(DatabaseKind::Mssql, &snap_url, None, pool.clone()).unwrap();
    exec_all(snap.as_ref(), &[
        "CREATE TABLE dbo.konto (id INT IDENTITY(1,1) PRIMARY KEY, betrag MONEY NOT NULL, wert DECIMAL(28,10), stempel DATETIMEOFFSET, flag BIT)",
        "INSERT INTO dbo.konto (betrag, wert, stempel, flag) SELECT TOP 7000 1234.5678, 123456789012345678.0123456789, '2024-05-01T10:00:00+02:00', 1 FROM sys.all_objects a CROSS JOIN sys.all_objects b",
    ]).await;
    let lab = Lab::new("mssql-snap");
    let target_url = lab.url("sqlite", "target.sqlite");
    let source = endpoint(DatabaseKind::Mssql, &snap_url);
    let target = endpoint(DatabaseKind::Sqlite, &target_url);
    let request = PlanRequest {
        source: source.clone(),
        schemas: vec![SchemaPair {
            source: "dbo".into(),
            target: "main".into(),
            tables: None,
        }],
        fold_names: true,
        replace: false,
        mirror: false,
        content: Content::All,
    };
    let plan = plan(&target, &request, pool.clone()).await.unwrap();
    let outcome = run(
        &target,
        &RunRequest { source, plan },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert_eq!(outcome.error, None, "{outcome:?}");
    assert!(
        !outcome.warnings.iter().any(|w| w.contains("SNAPSHOT")),
        "{:?}",
        outcome.warnings
    );
    assert_eq!(
        count(&target_url, DatabaseKind::Sqlite, "konto").await,
        7000
    );
    let sqlite =
        create_adapter_from_string(DatabaseKind::Sqlite, &target_url, None, pool.clone()).unwrap();
    assert_eq!(
        scalar(
            sqlite.as_ref(),
            "SELECT CAST(betrag AS TEXT) FROM konto WHERE id = 1"
        )
        .await
        .unwrap(),
        "1234.5678"
    );
    assert_eq!(
        scalar(sqlite.as_ref(), "SELECT stempel FROM konto WHERE id = 1")
            .await
            .unwrap(),
        "2024-05-01 08:00:00.000000"
    );
    let _ = master
        .execute_query("DROP DATABASE IF EXISTS tr_snap")
        .await;
}

#[test]
fn oracle_copy_keeps_exotic_values_lossless() {
    use super::oracle_copy::{bind_type, drop_statement, insert_expr, select_expr, unsupported};
    use oracle::sql_type::OracleType;
    assert_eq!(
        select_expr("T", "TIMESTAMP(6) WITH TIME ZONE"),
        "TO_CHAR(\"T\", 'SYYYY-MM-DD HH24:MI:SS.FF9 TZR TZD')"
    );
    assert_eq!(
        select_expr("T", "TIMESTAMP(6) WITH LOCAL TIME ZONE"),
        "\"T\""
    );
    assert_eq!(
        insert_expr(3, "TIMESTAMP(9) WITH TIME ZONE"),
        "TO_TIMESTAMP_TZ(:3, 'SYYYY-MM-DD HH24:MI:SS.FF9 TZR TZD')"
    );
    assert_eq!(
        select_expr("X", "XMLTYPE"),
        "XMLSERIALIZE(CONTENT \"X\" AS CLOB)"
    );
    assert_eq!(
        insert_expr(1, "XMLTYPE"),
        "XMLPARSE(DOCUMENT :1 WELLFORMED)"
    );
    assert_eq!(insert_expr(2, "JSON"), "JSON(:2)");
    assert_eq!(insert_expr(2, "NUMBER(12,2)"), ":2");
    assert_eq!(
        bind_type(&OracleType::Number(12, 2)),
        Some(OracleType::Number(0, 0))
    );
    assert_eq!(bind_type(&OracleType::BLOB), Some(OracleType::LongRaw));
    assert_eq!(bind_type(&OracleType::Varchar2(10)), None);
    for kind in ["BFILE", "ANYDATA", "VECTOR(3, FLOAT32)", "REF T_ADRESSE"] {
        assert!(unsupported(kind), "{kind}");
    }
    for kind in [
        "T_ADRESSE",
        "SDO_GEOMETRY",
        "XMLTYPE",
        "LONG RAW",
        "INTERVAL DAY(5) TO SECOND(9)",
    ] {
        assert!(!unsupported(kind), "{kind}");
    }
    assert_eq!(
        drop_statement("S", "TABLE", "T"),
        "DROP TABLE \"S\".\"T\" CASCADE CONSTRAINTS PURGE"
    );
    assert_eq!(
        drop_statement("S", "TYPE", "T"),
        "DROP TYPE \"S\".\"T\" FORCE"
    );
    assert_eq!(
        drop_statement("S", "PACKAGE", "P"),
        "DROP PACKAGE \"S\".\"P\""
    );
    assert_eq!(
        drop_statement("S", "JOB", "J"),
        "BEGIN DBMS_SCHEDULER.DROP_JOB('\"S\".\"J\"', TRUE); END;"
    );
}

fn resident_kib() -> u64 {
    std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .and_then(|text| text.trim().parse().ok())
        .unwrap_or(0)
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn transfer_live_oracle_bulk_budget() {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    let (url, system) = (required_url("ORACLE"), required_url("ORACLE_SYSTEM"));
    let rows: u64 = std::env::var("L8DB_TR_ORACLE_PERF_ROWS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(100_000);
    let pool = create_pool_state();
    let admin =
        create_adapter_from_string(DatabaseKind::Oracle, &system, None, pool.clone()).unwrap();
    let columns = "(ID NUMBER(12) PRIMARY KEY, WERT NUMBER, NAME VARCHAR2(60), ZEIT TIMESTAMP(6), ZONE TIMESTAMP WITH TIME ZONE, ROH RAW(16), NOTIZ CLOB)";
    for user in ["TR_PERF_SRC", "TR_PERF_DST"] {
        let _ = admin
            .execute_query(&format!("DROP USER {user} CASCADE"))
            .await;
        exec_all(
            admin.as_ref(),
            &[
                &format!("CREATE USER {user} IDENTIFIED BY l8dbtest QUOTA UNLIMITED ON USERS"),
                &format!("GRANT CREATE SESSION, CREATE TABLE TO {user}"),
            ],
        )
        .await;
    }
    exec_all(admin.as_ref(), &[
        &format!("CREATE TABLE TR_PERF_SRC.MESSUNG {columns}"),
        &format!("INSERT INTO TR_PERF_SRC.MESSUNG SELECT LEVEL, LEVEL / 7, 'Messung ' || LEVEL, TIMESTAMP '2024-01-01 00:00:00' + NUMTODSINTERVAL(LEVEL, 'SECOND'), FROM_TZ(TIMESTAMP '2024-01-01 00:00:00', 'Europe/Berlin') + NUMTODSINTERVAL(LEVEL, 'MINUTE'), HEXTORAW(LPAD(TO_CHAR(LEVEL, 'FMXXXXXXXX'), 32, '0')), CASE WHEN MOD(LEVEL, 10) = 0 THEN TO_CLOB(RPAD('x', 4000, 'y')) END FROM DUAL CONNECT BY LEVEL <= {rows}"),
    ]).await;
    let user = |name: &str| url.replace("l8db:l8dbtest", &format!("{name}:l8dbtest"));
    let source = endpoint(DatabaseKind::Oracle, &user("TR_PERF_SRC"));
    let target = endpoint(DatabaseKind::Oracle, &user("TR_PERF_DST"));
    let request = PlanRequest {
        source: source.clone(),
        schemas: vec![SchemaPair {
            source: "TR_PERF_SRC".into(),
            target: "TR_PERF_DST".into(),
            tables: None,
        }],
        fold_names: true,
        replace: false,
        mirror: false,
        content: Content::All,
    };
    let mut plan = plan(&target, &request, pool.clone()).await.unwrap();
    plan.pre_data = vec![Statement::object(
        format!("CREATE TABLE TR_PERF_DST.MESSUNG {columns}"),
        "table",
        "TR_PERF_DST",
        "MESSUNG",
    )];
    let inserts = || async {
        scalar(
            admin.as_ref(),
            "SELECT TO_CHAR(NVL(SUM(executions), 0)) FROM v$sql WHERE parsing_schema_name = 'TR_PERF_DST' AND sql_text LIKE 'INSERT INTO \"TR_PERF_DST\".\"MESSUNG\"%'",
        )
        .await
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
    };
    let objects = || async {
        scalar(
            admin.as_ref(),
            "SELECT TO_CHAR(COUNT(*)) FROM all_objects WHERE owner = 'TR_PERF_DST'",
        )
        .await
        .unwrap_or_default()
    };

    let cancelled_at = Mutex::new(None::<Instant>);
    let cancelled = crate::db::execution::run(
        Some(crate::db::execution::ExecutionOptions {
            job_id: Some("tr-perf-cancel".into()),
            ..Default::default()
        }),
        true,
        run(
            &target,
            &RunRequest {
                source: source.clone(),
                plan: plan.clone(),
            },
            pool.clone(),
            &|progress: Progress| {
                if progress.phase == "data" && progress.rows > 0 {
                    let mut at = cancelled_at.lock().unwrap();
                    if at.is_none() {
                        *at = Some(Instant::now());
                        let _ = crate::db::execution::cancel("tr-perf-cancel");
                    }
                }
            },
        ),
    )
    .await
    .unwrap();
    let reaction = cancelled_at
        .lock()
        .unwrap()
        .expect("data progress before cancel")
        .elapsed();
    assert!(
        cancelled
            .error
            .as_deref()
            .is_some_and(|e| e.contains("abgebrochen")),
        "{cancelled:?}"
    );
    assert!(
        cancelled.rolled_back && cancelled.leftovers.is_empty(),
        "{cancelled:?}"
    );
    assert_eq!(objects().await, "0");
    assert!(
        reaction < Duration::from_secs(2),
        "cancel took {reaction:?}"
    );

    let before = inserts().await;
    let stamps = Mutex::new(Vec::new());
    let baseline = resident_kib();
    let peak = Arc::new(AtomicU64::new(baseline));
    let stop = Arc::new(AtomicBool::new(false));
    let sampler = std::thread::spawn({
        let (peak, stop) = (peak.clone(), stop.clone());
        move || {
            while !stop.load(Ordering::Relaxed) {
                peak.fetch_max(resident_kib(), Ordering::Relaxed);
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    });
    let started = Instant::now();
    let done = run(
        &target,
        &RunRequest { source, plan },
        pool.clone(),
        &|progress: Progress| {
            if progress.phase == "data" && progress.rows > 0 {
                stamps.lock().unwrap().push(Instant::now());
            }
        },
    )
    .await
    .unwrap();
    let elapsed = started.elapsed();
    stop.store(true, Ordering::Relaxed);
    sampler.join().unwrap();
    assert!(done.error.is_none(), "{done:?}");
    assert_eq!(done.rows, rows);

    let digest = |owner: &str| {
        format!(
            "SELECT TO_CHAR(COUNT(*)) || '/' || TO_CHAR(SUM(ID)) || '/' || TO_CHAR(SUM(DBMS_LOB.GETLENGTH(NOTIZ))) || '/' || \
             TO_CHAR(SUM(ORA_HASH(DBMS_LOB.SUBSTR(NOTIZ, 4000, 1)))) || '/' || \
             TO_CHAR(SUM(ORA_HASH(TO_CHAR(WERT) || NAME || TO_CHAR(ZEIT, 'YYYYMMDDHH24MISSFF6') || TO_CHAR(ZONE, 'YYYYMMDDHH24MISSFF6 TZR TZD') || RAWTOHEX(ROH)))) FROM {owner}.MESSUNG"
        )
    };
    assert_eq!(
        scalar(admin.as_ref(), &digest("TR_PERF_SRC")).await,
        scalar(admin.as_ref(), &digest("TR_PERF_DST")).await
    );

    let executions = inserts().await - before;
    let stamps = stamps.into_inner().unwrap();
    let mut gaps: Vec<u128> = stamps
        .windows(2)
        .map(|pair| pair[1].duration_since(pair[0]).as_millis())
        .collect();
    gaps.sort_unstable();
    let pick = |q: f64| {
        gaps.get(((gaps.len().saturating_sub(1)) as f64 * q).round() as usize)
            .copied()
            .unwrap_or_default()
    };
    let (median, p95) = (pick(0.5), pick(0.95));
    let grown = peak.load(Ordering::Relaxed).saturating_sub(baseline) / 1024;
    let throughput = rows as f64 / elapsed.as_secs_f64();
    eprintln!(
        "oracle bulk transfer: {rows} rows in {:.2}s ({throughput:.0} rows/s), batch median {median} ms, p95 {p95} ms, {executions} array inserts, peak RSS +{grown} MiB, cancel reaction {reaction:?}",
        elapsed.as_secs_f64()
    );
    assert!(executions <= rows.div_ceil(500) + 1, "{executions} inserts");
    assert!(grown < 64, "peak RSS grew by {grown} MiB");
    assert!(p95 < 500, "batch p95 {p95} ms");
    assert!(throughput > 5_000.0, "{throughput:.0} rows/s");

    for user in ["TR_PERF_SRC", "TR_PERF_DST"] {
        let _ = admin
            .execute_query(&format!("DROP USER {user} CASCADE"))
            .await;
    }
}

fn shape(table: &SourceTable, defaults: bool) -> String {
    let mut identity: Vec<&String> = table.identity.iter().collect();
    identity.sort();
    let mut generated: Vec<&String> = table.generated.iter().collect();
    generated.sort();
    let mut ordered: Vec<&DetailedColumnInfo> = table.columns.iter().collect();
    ordered.sort_by_key(|c| (c.ordinal_position == 0).then(|| c.name.clone()));
    let columns: Vec<String> = ordered
        .into_iter()
        .map(|c| {
            format!(
                "{}|{}|{}|{:?}|{}|{}|{:?}",
                c.name,
                c.data_type,
                c.is_nullable,
                if defaults {
                    c.column_default.clone()
                } else {
                    None
                },
                c.is_primary_key,
                c.ordinal_position,
                c.character_maximum_length
            )
        })
        .collect();
    let mut constraints: Vec<String> = table
        .constraints
        .iter()
        .map(|c| {
            format!(
                "{}|{}|{:?}|{}",
                c.name, c.constraint_type, c.columns, c.definition
            )
        })
        .collect();
    constraints.sort();
    let indexes: Vec<String> = table
        .indexes
        .iter()
        .map(|i| {
            format!(
                "{}|{}|{}|{:?}|{}|{}",
                i.name, i.is_unique, i.is_primary, i.columns, i.index_type, i.definition
            )
        })
        .collect();
    format!(
        "{}\n{columns:?}\n{identity:?}\n{generated:?}\n{:?}\n{indexes:?}\n{constraints:?}\n{:?}",
        table.name, table.primary_key, table.foreign_keys
    )
}

async fn per_table(
    source: &dyn DatabaseAdapter,
    pair: &SchemaPair,
    names: &[String],
    need: Need,
) -> Vec<SourceTable> {
    let mut actions: HashMap<String, HashMap<String, String>> = HashMap::new();
    if need.details {
        for object in source
            .schema_catalog(&pair.source, &["constraint".to_string()])
            .await
            .unwrap()
        {
            if let Some(definition) = object.attributes.get("definition").cloned() {
                actions
                    .entry(object.parent.unwrap_or_default())
                    .or_default()
                    .insert(object.name, definition);
            }
        }
    }
    let none = HashMap::new();
    let mut out = Vec::new();
    for name in names {
        let meta = fetch_meta(source, Dialect::Oracle, &pair.source, name.clone(), need)
            .await
            .unwrap();
        let actions = actions.get(name).unwrap_or(&none);
        out.extend(assemble(
            DatabaseKind::Oracle,
            pair,
            meta,
            actions,
            false,
            need,
        ));
    }
    out
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn transfer_live_oracle_plan_budget() {
    use std::time::{Duration, Instant};

    let (url, system) = (required_url("ORACLE"), required_url("ORACLE_SYSTEM"));
    let count: usize = std::env::var("L8DB_TR_ORACLE_PLAN_TABLES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(1500);
    assert!(
        count >= 1500,
        "L8DB_TR_ORACLE_PLAN_TABLES={count}: der Abbruch-Teil braucht mindestens 1500 Tabellen"
    );
    let pool = create_pool_state();
    let admin =
        create_adapter_from_string(DatabaseKind::Oracle, &system, None, pool.clone()).unwrap();
    for user in ["TR_BIG_SRC", "TR_BIG_DST"] {
        let _ = admin
            .execute_query(&format!("DROP USER {user} CASCADE"))
            .await;
        exec_all(
            admin.as_ref(),
            &[
                &format!("CREATE USER {user} IDENTIFIED BY l8dbtest QUOTA UNLIMITED ON USERS"),
                &format!(
                    "GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE, CREATE VIEW TO {user}"
                ),
            ],
        )
        .await;
    }
    let started = Instant::now();
    let script = format!(
        "BEGIN
  FOR i IN 1 .. {count} LOOP
    EXECUTE IMMEDIATE 'CREATE TABLE TR_BIG_SRC.T_' || i || ' (ID NUMBER(10) PRIMARY KEY, PARENT_ID NUMBER(10)'
      || CASE WHEN i > 1 THEN ' REFERENCES TR_BIG_SRC.T_' || (i - 1) || ' (ID) ON DELETE CASCADE' END
      || ', NAME VARCHAR2(40 CHAR) DEFAULT ''neu'' NOT NULL, BETRAG NUMBER(12,2) CHECK (BETRAG >= 0), ZEIT TIMESTAMP(6), KURZ CHAR(3), NOTIZ VARCHAR2(200), MENGE NUMBER, FLAG NUMBER(1), CODE NVARCHAR2(20)'
      || ', CONSTRAINT T_' || i || '_UK UNIQUE (NAME, KURZ))';
    EXECUTE IMMEDIATE 'CREATE INDEX TR_BIG_SRC.T_' || i || '_IX ON TR_BIG_SRC.T_' || i || ' (ZEIT, MENGE)';
  END LOOP;
END;"
    );
    let results = admin.execute_script(&script).await.unwrap();
    assert!(results.iter().all(|r| r.success), "{results:?}");
    exec_all(admin.as_ref(), &[
        "CREATE TABLE TR_BIG_SRC.SPEZIAL (ID NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, NAME VARCHAR2(30) NOT NULL, GEHEIM VARCHAR2(10) INVISIBLE, BRUTTO NUMBER GENERATED ALWAYS AS (ID * 1.19) VIRTUAL, NETTO NUMBER INVISIBLE GENERATED ALWAYS AS (ID * 2) VIRTUAL, NOTE CLOB)",
        "CREATE INDEX TR_BIG_SRC.SPEZIAL_UPPER_IX ON TR_BIG_SRC.SPEZIAL (UPPER(NAME))",
        "CREATE TABLE TR_BIG_SRC.ZWEI (A NUMBER, B VARCHAR2(5), C DATE, CONSTRAINT ZWEI_PK PRIMARY KEY (B, A))",
        "CREATE TABLE TR_BIG_DST.T_1 (ID NUMBER(10) PRIMARY KEY, PARENT_ID NUMBER(10), NAME VARCHAR2(40 CHAR) DEFAULT 'neu' NOT NULL, BETRAG NUMBER(12,2) CHECK (BETRAG >= 0), ZEIT TIMESTAMP(6), KURZ CHAR(3), NOTIZ VARCHAR2(200), MENGE NUMBER, FLAG NUMBER(1), CODE NVARCHAR2(20))",
        "CREATE TABLE TR_BIG_DST.T_2 (ID NUMBER(10) PRIMARY KEY, PARENT_ID NUMBER(10) REFERENCES TR_BIG_DST.T_1 (ID), NAME VARCHAR2(40 CHAR) DEFAULT 'neu' NOT NULL, BETRAG NUMBER(12,2), ZEIT TIMESTAMP(6), KURZ CHAR(3), NOTIZ VARCHAR2(200), MENGE NUMBER, FLAG NUMBER(1), CODE NVARCHAR2(20))",
        "CREATE TABLE TR_BIG_DST.T_3 (ID NUMBER(10) PRIMARY KEY, PARENT_ID NUMBER(10) REFERENCES TR_BIG_DST.T_2 (ID), NAME VARCHAR2(40 CHAR) DEFAULT 'neu' NOT NULL, BETRAG NUMBER(12,2) CONSTRAINT T3_KLEIN CHECK (BETRAG < 900), ZEIT TIMESTAMP(6), KURZ CHAR(3), NOTIZ VARCHAR2(200), MENGE NUMBER, FLAG NUMBER(1), CODE NVARCHAR2(20))",
        "CREATE TABLE TR_BIG_DST.SPEZIAL (ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, NAME VARCHAR2(30) NOT NULL, GEHEIM VARCHAR2(10) INVISIBLE, BRUTTO NUMBER GENERATED ALWAYS AS (ID * 1.19) VIRTUAL, NETTO NUMBER INVISIBLE GENERATED ALWAYS AS (ID * 2) VIRTUAL, NOTE CLOB)",
        "INSERT INTO TR_BIG_SRC.T_1 (ID, NAME, BETRAG, KURZ) SELECT LEVEL, 'Eins ' || LEVEL, LEVEL, 'A' FROM DUAL CONNECT BY LEVEL <= 800",
        "INSERT INTO TR_BIG_SRC.T_2 (ID, PARENT_ID, NAME, BETRAG, KURZ) SELECT LEVEL, MOD(LEVEL, 800) + 1, 'Zwei ' || LEVEL, LEVEL, 'B' FROM DUAL CONNECT BY LEVEL <= 1200",
        "INSERT INTO TR_BIG_SRC.T_3 (ID, PARENT_ID, NAME, BETRAG, KURZ) SELECT LEVEL, MOD(LEVEL, 1200) + 1, 'Drei ' || LEVEL, LEVEL, 'C' FROM DUAL CONNECT BY LEVEL <= 1000",
        "INSERT INTO TR_BIG_SRC.SPEZIAL (NAME, GEHEIM, NOTE) SELECT 'S' || LEVEL, 'g', RPAD('n', 50, 'x') FROM DUAL CONNECT BY LEVEL <= 40",
        "COMMIT",
    ])
    .await;
    eprintln!(
        "oracle plan lab: {count} tables created in {:.1}s",
        started.elapsed().as_secs_f64()
    );
    let user = |name: &str| url.replace("l8db:l8dbtest", &format!("{name}:l8dbtest"));
    let source = endpoint(DatabaseKind::Oracle, &user("TR_BIG_SRC"));
    let target = endpoint(DatabaseKind::Oracle, &user("TR_BIG_DST"));
    let src = create_adapter_from_string(
        DatabaseKind::Oracle,
        &source.connection_string,
        None,
        pool.clone(),
    )
    .unwrap();
    let pair = SchemaPair {
        source: "TR_BIG_SRC".into(),
        target: "TR_BIG_DST".into(),
        tables: None,
    };
    let names: Vec<String> = src
        .list_tables(Some("TR_BIG_SRC"))
        .await
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert_eq!(names.len(), count + 2);

    let mut sample: Vec<String> = names.iter().step_by(25).cloned().collect();
    sample.extend(["SPEZIAL".to_string(), "ZWEI".to_string(), "T_2".to_string()]);
    sample.sort();
    sample.dedup();
    for (need, defaults) in [
        (
            Need {
                details: false,
                foreign_keys: false,
            },
            false,
        ),
        (
            Need {
                details: false,
                foreign_keys: true,
            },
            false,
        ),
        (
            Need {
                details: true,
                foreign_keys: false,
            },
            true,
        ),
    ] {
        let subset = SchemaPair {
            tables: Some(sample.clone()),
            ..pair.clone()
        };
        let mut warnings = Vec::new();
        let bulk = read_tables(src.as_ref(), &source, &pool, &subset, need, &mut warnings)
            .await
            .unwrap();
        let ordered: Vec<String> = names
            .iter()
            .filter(|n| sample.contains(n))
            .cloned()
            .collect();
        let reference = per_table(src.as_ref(), &subset, &ordered, need).await;
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(bulk.len(), reference.len());
        for (mut left, right) in bulk.into_iter().zip(&reference) {
            if left.name == "SPEZIAL" {
                assert!(left.generated.remove("NETTO"), "{need:?}");
            }
            assert_eq!(shape(&left, defaults), shape(right, defaults), "{need:?}");
        }
    }
    let spezial = read_tables(
        src.as_ref(),
        &source,
        &pool,
        &SchemaPair {
            tables: Some(vec!["SPEZIAL".into()]),
            ..pair.clone()
        },
        Need {
            details: true,
            foreign_keys: true,
        },
        &mut Vec::new(),
    )
    .await
    .unwrap();
    assert!(spezial[0].identity.contains("ID"));
    assert!(spezial[0].generated.contains("BRUTTO"));
    assert!(spezial[0].generated.contains("NETTO"));
    assert!(spezial[0].columns.iter().any(|c| c.name == "GEHEIM"));
    assert!(spezial[0]
        .columns
        .iter()
        .all(|c| !c.name.starts_with("SYS_")));

    let baseline_started = Instant::now();
    let baseline = per_table(
        src.as_ref(),
        &pair,
        &names,
        Need {
            details: false,
            foreign_keys: false,
        },
    )
    .await;
    let baseline_time = baseline_started.elapsed();
    assert_eq!(baseline.len(), names.len());

    let request = |content: Content, tables: Option<Vec<&str>>| PlanRequest {
        source: source.clone(),
        schemas: vec![SchemaPair {
            tables: tables.map(|t| t.into_iter().map(String::from).collect()),
            ..pair.clone()
        }],
        fold_names: true,
        replace: false,
        mirror: false,
        content,
    };
    let full = request(Content::All, None);
    let mut times = Vec::new();
    let baseline_rss = resident_kib();
    let mut peak = baseline_rss;
    let mut planned = None;
    for _ in 0..5 {
        let started = Instant::now();
        let result = plan(&target, &full, pool.clone()).await.unwrap();
        times.push(started.elapsed());
        peak = peak.max(resident_kib());
        planned = Some(result);
    }
    let planned = planned.unwrap();
    assert_eq!(planned.tables.len(), count + 2);
    assert_eq!(planned.conflicts.len(), 4, "{:?}", planned.conflicts);
    times.sort();
    let (median, p95) = (times[2], times[4]);
    let grown = peak.saturating_sub(baseline_rss) / 1024;

    let subset_started = Instant::now();
    let small = plan(
        &target,
        &request(Content::All, Some(vec!["T_7", "T_8"])),
        pool.clone(),
    )
    .await
    .unwrap();
    let subset_time = subset_started.elapsed();
    assert_eq!(small.tables.len(), 2);
    assert!(small.sequences.is_empty());

    let job = "tr-plan-cancel";
    let cancel = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        let at = Instant::now();
        while crate::db::execution::cancel(job).ok() != Some(true) && at.elapsed().as_secs() < 5 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        at
    });
    let cancelled = crate::db::execution::run(
        Some(crate::db::execution::ExecutionOptions {
            job_id: Some(job.into()),
            ..Default::default()
        }),
        true,
        plan(&target, &full, pool.clone()),
    )
    .await;
    let reaction = cancel.await.unwrap().elapsed();
    assert_eq!(cancelled.err().as_deref(), Some(PLAN_CANCELLED));

    eprintln!(
        "oracle plan: {} tables, per-table read (old path) {:.2}s, full plan median {:.2}s p95 {:.2}s, 2-table plan {:.2}s, peak RSS +{grown} MiB, cancel reaction {reaction:?}",
        count + 2,
        baseline_time.as_secs_f64(),
        median.as_secs_f64(),
        p95.as_secs_f64(),
        subset_time.as_secs_f64()
    );
    assert!(
        median * 5 < baseline_time,
        "plan {median:?} vs old read {baseline_time:?}"
    );
    assert!(subset_time < Duration::from_secs(3), "{subset_time:?}");
    assert!(grown < 128, "peak RSS grew by {grown} MiB");
    assert!(
        reaction < Duration::from_secs(2),
        "cancel took {reaction:?}"
    );

    let data = plan(
        &target,
        &request(Content::Data, Some(vec!["T_3", "SPEZIAL", "T_1", "T_2"])),
        pool.clone(),
    )
    .await
    .unwrap();
    let order: Vec<&str> = data.tables.iter().map(|t| t.target_name.as_str()).collect();
    let at = |name: &str| order.iter().position(|t| *t == name).unwrap();
    assert!(at("T_1") < at("T_2") && at("T_2") < at("T_3"), "{order:?}");
    assert!(data.pre_data.is_empty() && data.post_data.is_empty());
    assert_eq!(data.before_load.len(), 1, "{:?}", data.before_load);
    let missing = plan(
        &target,
        &request(Content::Data, Some(vec!["T_4"])),
        pool.clone(),
    )
    .await
    .unwrap_err();
    assert!(missing.contains("TR_BIG_DST.T_4"), "{missing}");

    let live = Live { pool: pool.clone() };
    let failed = live.run(&source, &target, data.clone()).await;
    assert!(
        failed
            .error
            .as_deref()
            .is_some_and(|e| e.contains("ORA-02290")),
        "{failed:?}"
    );
    assert!(failed.rolled_back, "{failed:?}");
    for table in ["T_1", "T_2", "T_3", "SPEZIAL"] {
        assert_eq!(
            scalar(
                admin.as_ref(),
                &format!("SELECT TO_CHAR(COUNT(*)) FROM TR_BIG_DST.{table}")
            )
            .await
            .as_deref(),
            Some("0"),
            "{table} after rollback"
        );
    }
    assert_eq!(
        scalar(admin.as_ref(), "SELECT generation_type FROM all_tab_identity_cols WHERE owner = 'TR_BIG_DST' AND table_name = 'SPEZIAL'").await.as_deref(),
        Some("ALWAYS")
    );
    exec_all(
        admin.as_ref(),
        &["ALTER TABLE TR_BIG_DST.T_3 DROP CONSTRAINT T3_KLEIN"],
    )
    .await;
    let done = live.run(&source, &target, data.clone()).await;
    assert_eq!(done.error, None, "{done:?}");
    assert_eq!(done.rows, 800 + 1200 + 1000 + 40);
    let digest = |owner: &str| {
        format!(
            "SELECT TO_CHAR(COUNT(*)) || '/' || TO_CHAR(SUM(ORA_HASH(ID || NAME || PARENT_ID || BETRAG || KURZ))) FROM {owner}.T_3"
        )
    };
    assert_eq!(
        scalar(admin.as_ref(), &digest("TR_BIG_SRC")).await,
        scalar(admin.as_ref(), &digest("TR_BIG_DST")).await
    );
    assert_eq!(
        scalar(admin.as_ref(), "SELECT generation_type FROM all_tab_identity_cols WHERE owner = 'TR_BIG_DST' AND table_name = 'SPEZIAL'").await.as_deref(),
        Some("ALWAYS")
    );
    exec_all(
        admin.as_ref(),
        &[
            "INSERT INTO TR_BIG_DST.SPEZIAL (NAME) VALUES ('neu')",
            "COMMIT",
        ],
    )
    .await;
    assert_eq!(
        scalar(
            admin.as_ref(),
            "SELECT TO_CHAR(MAX(ID)) FROM TR_BIG_DST.SPEZIAL WHERE NAME = 'neu'"
        )
        .await
        .as_deref(),
        Some("41")
    );
    let again = run(
        &target,
        &RunRequest {
            source: source.clone(),
            plan: data,
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap_err();
    assert!(
        again.contains("TR_BIG_DST.SPEZIAL enthält bereits Zeilen"),
        "{again}"
    );
    for user in ["TR_BIG_SRC", "TR_BIG_DST"] {
        let _ = admin
            .execute_query(&format!("DROP USER {user} CASCADE"))
            .await;
    }
}

#[tokio::test]
#[ignore]
async fn postgres_replace_mirrors_and_overwrites_selection() {
    let url = std::env::var("L8DB_E2E_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:testpw@127.0.0.1:5433/testdb".into());
    let lab = Lab::new("pg-replace");
    let source_url = lab.url("sqlite", "source.sqlite");
    seed_source(&source_url).await;
    let pool = create_pool_state();
    let pg = create_adapter_from_string(DatabaseKind::Postgres, &url, None, pool.clone()).unwrap();
    exec_all(
        pg.as_ref(),
        &[
            "DROP SCHEMA IF EXISTS tr_rep CASCADE",
            "CREATE SCHEMA tr_rep",
            "CREATE EXTENSION IF NOT EXISTS citext SCHEMA tr_rep",
            "CREATE TABLE tr_rep.extra (id integer)",
            "CREATE TABLE tr_rep.orders (legacy text)",
            "CREATE VIEW tr_rep.v AS SELECT * FROM tr_rep.extra",
            "CREATE FUNCTION tr_rep.f(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'",
            "CREATE FUNCTION tr_rep.f(text) RETURNS integer LANGUAGE sql AS 'SELECT 2'",
        ],
    )
    .await;
    let target = endpoint(DatabaseKind::Postgres, &url);
    let source = endpoint(DatabaseKind::Sqlite, &source_url);
    let request = |replace: bool, mirror: bool, tables: Option<Vec<String>>| PlanRequest {
        source: source.clone(),
        schemas: vec![SchemaPair {
            source: "main".into(),
            target: "tr_rep".into(),
            tables,
        }],
        fold_names: true,
        replace,
        mirror,
        content: Content::All,
    };
    let blocked = plan(&target, &request(false, false, None), pool.clone())
        .await
        .unwrap();
    assert!(blocked.conflicts.contains(&"tr_rep.orders".to_string()));

    let mirrored = plan(&target, &request(true, true, None), pool.clone())
        .await
        .unwrap();
    for label in [
        "TABLE tr_rep.extra",
        "VIEW tr_rep.v",
        "FUNCTION tr_rep.f(integer)",
        "FUNCTION tr_rep.f(text)",
    ] {
        assert!(
            mirrored.replaced.contains(&label.to_string()),
            "{label}: {:?}",
            mirrored.replaced
        );
    }
    assert!(
        !mirrored.replaced.iter().any(|l| l.contains("citext")),
        "{:?}",
        mirrored.replaced
    );
    let outcome = run(
        &target,
        &RunRequest {
            source: source.clone(),
            plan: mirrored,
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert_eq!(outcome.error, None, "{outcome:?}");
    assert_eq!(
        scalar(pg.as_ref(), "SELECT count(*) FROM tr_rep.orders")
            .await
            .as_deref(),
        Some("12345")
    );
    assert_eq!(
        scalar(
            pg.as_ref(),
            "SELECT count(*) FROM pg_tables WHERE schemaname = 'tr_rep' AND tablename = 'extra'"
        )
        .await
        .as_deref(),
        Some("0")
    );
    assert_eq!(
        scalar(pg.as_ref(), "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'tr_rep' AND p.proname = 'f'").await.as_deref(),
        Some("0")
    );

    pg.execute_query("DELETE FROM tr_rep.orders WHERE id > 5")
        .await
        .unwrap();
    let partial = plan(
        &target,
        &request(true, false, Some(vec!["orders".into()])),
        pool.clone(),
    )
    .await
    .unwrap();
    assert_eq!(partial.replaced, vec!["TABLE tr_rep.orders".to_string()]);
    let outcome = run(
        &target,
        &RunRequest {
            source: source.clone(),
            plan: partial,
        },
        pool.clone(),
        &no_progress,
    )
    .await
    .unwrap();
    assert_eq!(outcome.error, None, "{outcome:?}");
    assert_eq!(
        scalar(pg.as_ref(), "SELECT count(*) FROM tr_rep.orders")
            .await
            .as_deref(),
        Some("12345")
    );
    assert_eq!(
        scalar(pg.as_ref(), "SELECT count(*) FROM tr_rep.customer")
            .await
            .as_deref(),
        Some("50")
    );

    let missing = plan(
        &target,
        &PlanRequest {
            schemas: vec![SchemaPair {
                source: "main".into(),
                target: "tr_rep_missing".into(),
                tables: None,
            }],
            ..request(false, false, None)
        },
        pool.clone(),
    )
    .await
    .unwrap_err();
    assert!(missing.contains("existiert nicht"), "{missing}");
    assert_eq!(
        scalar(
            pg.as_ref(),
            "SELECT count(*) FROM pg_namespace WHERE nspname = 'tr_rep_missing'"
        )
        .await
        .as_deref(),
        Some("0")
    );
    pg.execute_query("DROP SCHEMA tr_rep CASCADE")
        .await
        .unwrap();
}

#[test]
fn overwrite_failures_are_collected_instead_of_aborting() {
    let mut failed = Vec::new();
    assert!(skip(true, &mut failed, Err("ORA-00942".into())).is_ok());
    assert!(skip(true, &mut failed, Ok(())).is_ok());
    assert_eq!(failed, vec!["ORA-00942".to_string()]);
    assert!(skip(false, &mut failed, Err("x".into())).is_err());
    assert_eq!(failed.len(), 1);
    let many: Vec<String> = (0..25).map(|n| format!("Fehler {n}")).collect();
    let summary = failure_summary(&many);
    assert!(summary.starts_with("Fehlgeschlagene Schritte: 25."));
    assert!(summary.contains("Fehler 19") && !summary.contains("Fehler 20"));
    assert!(summary.ends_with("… und 5 weitere"));
}
