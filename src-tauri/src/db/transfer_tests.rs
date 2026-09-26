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
        format!("{scheme}://{}", self.dir.join(file).display())
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
        }],
        fold_names: true,
    };
    let plan = plan(&target, &request, pool.clone()).await.unwrap();
    assert!(!plan.native);
    assert!(plan.atomic);
    assert_eq!(plan.create_schemas, vec!["shop"]);
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
    let duck =
        create_adapter_from_string(DatabaseKind::Duckdb, &target_url, None, create_pool_state())
            .unwrap();
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
        }],
        fold_names: true,
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
                })
                .collect(),
            fold_names: true,
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
    let Some(pg_url) = live_url("PG") else { return };
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
    native_plan.create_schemas = vec!["tr_native".into()];
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
        let Some(url) = live_url(name) else { continue };
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
                }],
                fold_names: true,
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
    let (Some(url), Some(system)) = (live_url("ORACLE"), live_url("ORACLE_SYSTEM")) else {
        return;
    };
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
        }],
        fold_names: true,
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
        }],
        fold_names: true,
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
