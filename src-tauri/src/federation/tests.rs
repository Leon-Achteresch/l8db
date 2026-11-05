use std::sync::Arc;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::protection::Protection;
use super::sandbox::{Definition, Sandbox};
use super::*;
use crate::automation::model::AutomationConnection;
use crate::automation::store::Store;
use crate::db::TableData;
use crate::mcp::config::{McpConfig, RedactRule};

fn source(alias: &str, table: &str) -> FederationSource {
    FederationSource {
        connection_id: alias.into(),
        database: None,
        schema: "main".into(),
        table: table.into(),
        alias: alias.into(),
    }
}

fn definition(alias: &str, table: &str, columns: &[&str]) -> Definition {
    Definition {
        source: source(alias, table),
        columns: columns
            .iter()
            .map(|column| ColumnInfo {
                schema: "main".into(),
                table: table.into(),
                name: (*column).into(),
                data_type: "text".into(),
            })
            .collect(),
    }
}

fn sandbox(definitions: &[Definition]) -> Sandbox {
    Sandbox::new(
        definitions,
        CancellationToken::new(),
        Instant::now() + Duration::from_secs(30),
    )
    .unwrap()
}

fn data(columns: &[&str], rows: Vec<Value>) -> TableData {
    TableData {
        columns: columns.iter().map(|column| (*column).into()).collect(),
        rows,
    }
}

fn config() -> McpConfig {
    let mut config = McpConfig::default();
    config.redaction.columns.clear();
    config.redaction.values.clear();
    config
}

#[test]
fn joins_ctes_aggregates_and_set_operations_are_read_only() {
    let engine = sandbox(&[
        definition("crm", "customers", &["id", "name"]),
        definition("sales", "orders", &["customer_id", "amount"]),
    ]);
    engine
        .load(
            &source("crm", "customers"),
            data(
                &["id", "name"],
                vec![json!({"id":1,"name":"Ada"}), json!({"id":2,"name":"Lin"})],
            ),
        )
        .unwrap();
    engine
        .load(
            &source("sales", "orders"),
            data(
                &["customer_id", "amount"],
                vec![
                    json!({"customer_id":1,"amount":7}),
                    json!({"customer_id":1,"amount":5}),
                    json!({"customer_id":2,"amount":3}),
                ],
            ),
        )
        .unwrap();
    let sql = "WITH totals AS (SELECT customer_id, sum(amount) total FROM sales.orders GROUP BY customer_id) SELECT c.name, t.total FROM crm.customers c JOIN totals t ON c.id=t.customer_id UNION ALL SELECT 'all', sum(amount) FROM sales.orders ORDER BY total DESC";
    let references = engine.references(sql).unwrap();
    assert_eq!(references.len(), 2);
    assert!(references.contains(&("crm".into(), "customers".into())));
    let result = engine.execute(sql).unwrap();
    assert_eq!(
        result.rows,
        vec![
            json!({"name":"all","total":15}),
            json!({"name":"Ada","total":12}),
            json!({"name":"Lin","total":3})
        ]
    );
    assert!(!result.truncated);
}

#[test]
fn refuses_writes_metadata_file_access_extra_statements_and_parameters() {
    let engine = sandbox(&[definition("crm", "customers", &["id"])]);
    for sql in [
        "DELETE FROM crm.customers RETURNING id",
        "UPDATE crm.customers SET id=1 RETURNING id",
        "INSERT INTO crm.customers VALUES (1) RETURNING id",
        "CREATE TABLE crm.other (id)",
        "DROP TABLE crm.customers",
        "PRAGMA database_list",
        "ATTACH DATABASE '/tmp/private.db' AS other",
        "SELECT * FROM crm.sqlite_master",
        "SELECT readfile('/etc/passwd')",
        "SELECT load_extension('/tmp/x')",
        "SELECT writefile('/tmp/x', 'secret')",
        "SELECT * FROM pragma_database_list",
        "SELECT 1; SELECT 2",
        "SELECT 1; DELETE FROM crm.customers",
        "SELECT ?",
        "WITH x AS (SELECT 1) DELETE FROM crm.customers RETURNING id",
    ] {
        assert!(engine.references(sql).is_err(), "must reject {sql}");
    }
    assert!(engine.references("SELECT 1; -- trailing comment").is_ok());
    assert_eq!(
        engine.execute("SELECT ';DELETE' AS text").unwrap().rows[0]["text"],
        ";DELETE"
    );
}

#[test]
fn large_integer_null_json_and_duplicate_column_names_keep_their_values() {
    let engine = sandbox(&[definition(
        "src",
        "values_table",
        &["id", "payload", "empty"],
    )]);
    engine
        .load(
            &source("src", "values_table"),
            data(
                &["id", "payload", "empty"],
                vec![json!({"id":"18446744073709551615","payload":{"key":"value"},"empty":null})],
            ),
        )
        .unwrap();
    let result = engine
        .execute("SELECT id, payload, empty, 1 AS x, 2 AS x, 3 AS \"x (2)\" FROM src.values_table")
        .unwrap();
    assert_eq!(result.rows[0]["id"], "18446744073709551615");
    assert_eq!(result.rows[0]["payload"], "{\"key\":\"value\"}");
    assert!(result.rows[0]["empty"].is_null());
    assert_eq!(result.columns.iter().collect::<HashSet<_>>().len(), 6);
    assert_eq!(result.rows[0]["x"], 1);
    assert_eq!(result.rows[0]["x (2)"], 2);
    assert_eq!(result.rows[0]["x (2) (2)"], 3);
    assert_eq!(
        engine
            .execute("SELECT 9223372036854775807 AS n")
            .unwrap()
            .rows[0]["n"],
        "9223372036854775807"
    );
}

#[test]
fn source_and_result_limits_reject_oversized_values_and_bound_result_rows() {
    let engine = sandbox(&[definition("src", "items", &["id", "payload"])]);
    assert!(engine
        .load(
            &source("src", "items"),
            data(
                &["id", "payload"],
                vec![json!({"id":1,"payload":"x".repeat(MAX_CELL_BYTES + 1)})]
            )
        )
        .is_err());
    let engine = sandbox(&[definition("src", "items", &["id", "payload"])]);
    engine
        .load(
            &source("src", "items"),
            data(
                &["id", "payload"],
                (0..MAX_RESULT_ROWS + 1)
                    .map(|id| json!({"id":id,"payload":"x"}))
                    .collect(),
            ),
        )
        .unwrap();
    let result = engine
        .execute("SELECT id FROM src.items ORDER BY id")
        .unwrap();
    assert_eq!(result.rows.len(), MAX_RESULT_ROWS);
    assert!(result.truncated);
    let engine = sandbox(&[definition("src", "items", &["id", "payload"])]);
    engine
        .load(
            &source("src", "items"),
            data(
                &["id", "payload"],
                (0..2_000)
                    .map(|id| json!({"id":id,"payload":"x".repeat(5_000)}))
                    .collect(),
            ),
        )
        .unwrap();
    assert!(engine
        .execute("SELECT payload FROM src.items")
        .unwrap_err()
        .contains("8 MiB"));
}

#[test]
fn exact_and_case_folded_schema_allowlists_match_connection_visibility() {
    let names = vec!["APP".into(), "app".into(), "public".into()];
    assert_eq!(
        visible_schemas(names.clone(), Some(&["APP".into()])),
        vec!["APP"]
    );
    assert_eq!(
        visible_schemas(names.clone(), Some(&["Public".into()])),
        vec!["public"]
    );
    assert_eq!(visible_schemas(names.clone(), Some(&[])), names);
    assert!(visible_schemas(vec!["private".into()], Some(&["public".into()])).is_empty());
}

#[test]
fn validates_source_aliases_collisions_and_quotas_before_database_work() {
    let mut request = FederationRequest {
        sources: vec![source("crm", "customers")],
        sql: "SELECT 1".into(),
    };
    assert!(validate(&request).is_ok());
    for alias in [
        "main",
        "temp",
        "sqlite_master",
        "1crm",
        "x; DROP TABLE y",
        "",
        "contains-dash",
    ] {
        request.sources[0].alias = alias.into();
        assert!(validate(&request).is_err());
    }
    request.sources = vec![source("crm", "customers"), source("CRM", "customers")];
    assert!(validate(&request).is_err());
    request.sources = vec![source("crm", "customers"); MAX_SOURCES + 1];
    assert!(validate(&request).is_err());
    request.sources = vec![source("crm", "customers")];
    request.sql = "x".repeat(MAX_SQL_BYTES + 1);
    assert!(validate(&request).is_err());
}

#[test]
fn source_protection_prevents_alias_and_expression_leaks() {
    let rules = vec![RedactRule {
        name: "Email".into(),
        pattern: "email|secret".into(),
        enabled: true,
        mask: None,
    }];
    let protection = Protection::new("crm", &rules, &config()).unwrap();
    let mut page = data(
        &["id", "email", "payload"],
        vec![
            json!({"id":1,"email":"private@example.test","payload":{"secret":"hidden","visible":"okay"}}),
        ],
    );
    assert_eq!(protection.apply(&mut page), vec!["email"]);
    let engine = sandbox(&[definition("crm", "customers", &["id", "email", "payload"])]);
    engine.load(&source("crm", "customers"), page).unwrap();
    let result = engine.execute("SELECT upper(email) disguised, json_extract(payload, '$.secret') nested, json_extract(payload, '$.visible') visible FROM crm.customers").unwrap();
    assert!(result.rows[0]["disguised"].is_null());
    assert!(result.rows[0]["nested"].is_null());
    assert_eq!(result.rows[0]["visible"], "okay");
    assert!(!serde_json::to_string(&result)
        .unwrap()
        .contains("private@example.test"));
    let invalid = vec![RedactRule {
        pattern: "(".into(),
        ..rules[0].clone()
    }];
    assert!(Protection::new("crm", &invalid, &config()).is_err());
}

#[test]
fn cancellation_and_deadlines_stop_local_work_without_background_jobs() {
    let cancel = CancellationToken::new();
    let engine = Sandbox::new(
        &[definition("src", "items", &["id"])],
        cancel.clone(),
        Instant::now() + Duration::from_secs(30),
    )
    .unwrap();
    cancel.cancel();
    assert!(engine
        .execute("SELECT 1")
        .unwrap_err()
        .contains("abgebrochen"));
    let expired = Sandbox::new(
        &[],
        CancellationToken::new(),
        Instant::now() - Duration::from_millis(1),
    )
    .unwrap();
    assert!(expired
        .execute("SELECT 1")
        .unwrap_err()
        .contains("Zeitlimit"));
    let cancel = CancellationToken::new();
    let engine = Sandbox::new(
        &[],
        cancel.clone(),
        Instant::now() + Duration::from_secs(30),
    )
    .unwrap();
    let started = Instant::now();
    let work = std::thread::spawn(move || {
        engine.execute(
            "WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v+1 FROM n) SELECT sum(v) FROM n",
        )
    });
    cancel.cancel();
    assert!(work.join().unwrap().is_err());
    assert!(started.elapsed() < Duration::from_secs(2));
    let engine = sandbox(&[]);
    assert!(engine
        .execute(
            "WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v+1 FROM n) SELECT sum(v) FROM n"
        )
        .is_err());
}

async fn fixture(rows: usize) -> (tempfile::TempDir, Services) {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(&directory.path().join("automation.db")).unwrap();
    let mut connections = Vec::new();
    for (id, table) in [("customers", "customers"), ("orders", "orders")] {
        let path = directory.path().join(format!("{id}.sqlite"));
        let mut database = Connection::open(&path).unwrap();
        database
            .execute_batch(&format!(
                "CREATE TABLE {table}(tenant INTEGER NOT NULL, id INTEGER NOT NULL, label TEXT, amount INTEGER, PRIMARY KEY(tenant, id))"
            ))
            .unwrap();
        let transaction = database.transaction().unwrap();
        {
            let mut insert = transaction
                .prepare(&format!("INSERT INTO {table} VALUES (?1, ?2, ?3, ?4)"))
                .unwrap();
            for index in 0..rows {
                insert
                    .execute(rusqlite::params![
                        (index % 7) as i64,
                        index as i64,
                        format!("item-{index}"),
                        (index % 10) as i64
                    ])
                    .unwrap();
            }
        }
        transaction.commit().unwrap();
        connections.push(serde_json::from_value::<AutomationConnection>(json!({"id":id,"name":id,"kind":"sqlite","connectionString":path.to_string_lossy(),"schemas":["main"]})).unwrap());
    }
    store.replace_connections(connections).await.unwrap();
    let services = Services::new(store, Arc::new(|_| {}), true);
    (directory, services)
}

fn fixture_request() -> FederationRequest {
    FederationRequest { sources: vec![source("customers", "customers"), source("orders", "orders")], sql: "SELECT c.id, c.label, o.amount FROM customers.customers c JOIN orders.orders o ON c.id=o.id WHERE o.amount>=7 ORDER BY c.id".into() }
}

#[tokio::test]
async fn real_sqlite_sources_join_through_saved_connection_resolution_and_remain_unchanged() {
    let (directory, services) = fixture(1_100).await;
    let report = run_with_config(&services, fixture_request(), 30, &config())
        .await
        .unwrap();
    assert_eq!(report.result.rows.len(), 330);
    assert_eq!(report.source_rows, 2_200);
    assert_eq!(report.source_reads, 8);
    assert_eq!(report.sources.len(), 2);
    let database = Connection::open(directory.path().join("customers.sqlite")).unwrap();
    assert_eq!(
        database
            .query_row("SELECT count(*) FROM customers", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1_100
    );
    let mut request = fixture_request();
    request.sql = "SELECT count(*) n FROM customers.customers".into();
    let report = run_with_config(&services, request, 30, &config())
        .await
        .unwrap();
    assert_eq!(report.source_rows, 1_100);
    assert_eq!(report.source_reads, 4);
    assert_eq!(report.result.rows[0]["n"], 1_100);
}

#[tokio::test]
async fn saved_mask_rules_apply_before_source_sql_evaluation() {
    let (_directory, services) = fixture(5).await;
    let mut saved = services.store.connections().await.unwrap();
    saved[0].mask_rules = vec![RedactRule {
        name: "Label".into(),
        pattern: "^label$".into(),
        enabled: true,
        mask: None,
    }];
    services.store.replace_connections(saved).await.unwrap();
    let mut request = fixture_request();
    request.sources.truncate(1);
    request.sql = "SELECT count(*) rows_read, count(label) disclosed, upper(label) renamed FROM customers.customers".into();
    let report = run_with_config(&services, request.clone(), 30, &config())
        .await
        .unwrap();
    assert_eq!(
        report.result.rows[0],
        json!({"rows_read":5,"disclosed":0,"renamed":null})
    );
    assert_eq!(report.sources[0].masked_columns, vec!["label"]);
    request.sources[0].connection_id = "not-a-saved-id".into();
    assert!(run_with_config(&services, request, 30, &config())
        .await
        .unwrap_err()
        .contains("nicht gefunden"));
}

#[tokio::test]
async fn oversized_sources_and_forbidden_schemas_never_return_partial_aggregates() {
    let (_directory, services) = fixture(MAX_SOURCE_ROWS + 1).await;
    let error = run_with_config(&services, fixture_request(), 30, &config())
        .await
        .unwrap_err();
    assert!(error.contains("50000"));
    let mut saved = services.store.connections().await.unwrap();
    saved[0].schemas = Some(vec!["hidden".into()]);
    services.store.replace_connections(saved).await.unwrap();
    let error = run_with_config(&services, fixture_request(), 30, &config())
        .await
        .unwrap_err();
    assert!(error.contains("nicht freigegeben"));
}

#[tokio::test]
async fn job_cancellation_is_registered_and_released_after_completion() {
    let (_directory, services) = fixture(2).await;
    let mut request = fixture_request();
    request.sql =
        "WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v+1 FROM n) SELECT sum(v) FROM n".into();
    let id = format!("federation-cancel-{}", crate::automation::runtime::new_id());
    let job_id = id.clone();
    let cancel = async move {
        for _ in 0..100 {
            if execution::cancel(&job_id).unwrap_or(false) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        panic!("federation job was not registered");
    };
    let options = Some(ExecutionOptions {
        job_id: Some(id.clone()),
        ..ExecutionOptions::default()
    });
    let run_config = config();
    let (result, ()) = tokio::join!(
        execution::run(
            options,
            true,
            run_with_config(&services, request, 30, &run_config)
        ),
        cancel
    );
    assert!(result.is_err());
    assert!(!execution::cancel(&id).unwrap());
}

#[cfg(feature = "duckdb")]
#[tokio::test]
async fn sqlite_and_duckdb_sources_join_through_their_real_adapters() {
    let (directory, services) = fixture(10).await;
    let path = directory.path().join("analytics.duckdb");
    let database = duckdb::Connection::open(&path).unwrap();
    database.execute_batch("CREATE TABLE facts(id BIGINT, score DOUBLE); INSERT INTO facts VALUES (1, 9.5), (2, 8.0)").unwrap();
    drop(database);
    let mut saved = services.store.connections().await.unwrap();
    saved.push(serde_json::from_value(json!({"id":"analytics","name":"analytics","kind":"duckdb","connectionString":path.to_string_lossy()})).unwrap());
    services.store.replace_connections(saved).await.unwrap();
    let request = FederationRequest { sources: vec![source("customers", "customers"), source("analytics", "facts")], sql: "SELECT c.label, f.score FROM customers.customers c JOIN analytics.facts f ON c.id=f.id ORDER BY f.score DESC".into() };
    let report = run_with_config(&services, request, 30, &config())
        .await
        .unwrap();
    assert_eq!(
        report.result.rows,
        vec![
            json!({"label":"item-1","score":9.5}),
            json!({"label":"item-2","score":8.0})
        ]
    );
}

#[tokio::test]
async fn perf_federation_40000_source_rows_has_bounded_reads_memory_and_no_idle_work() {
    let (_directory, services) = fixture(20_000).await;
    let mut request = fixture_request();
    request.sql = "SELECT count(*) n, sum(o.amount) total FROM customers.customers c JOIN orders.orders o ON c.id=o.id".into();
    let mut samples = Vec::new();
    for _ in 0..5 {
        let started = Instant::now();
        let report = run_with_config(&services, request.clone(), 30, &config())
            .await
            .unwrap();
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
        assert_eq!(report.result.rows, vec![json!({"n":20_000,"total":90_000})]);
        assert_eq!(report.source_rows, 40_000);
        assert_eq!(report.source_reads, 82);
        assert!(report.source_bytes < 8 * 1024 * 1024);
    }
    samples.sort_by(f64::total_cmp);
    eprintln!("federation: SQLite sources 2 × 20000 rows, composite PRIMARY KEY(tenant,id), explicit full-key ordering, page <= 512, source bytes < 8 MiB, reads=82, concurrent source reads=1, retained result=1 row; median {:.1} ms, p95 {:.1} ms; limits 3000/5000 ms; no polling/background jobs", samples[2], samples[4]);
    assert!(samples[2] < 3_000.0);
    assert!(samples[4] < 5_000.0);
    tokio::time::sleep(Duration::from_millis(20)).await;
    let engine = sandbox(&[definition("src", "items", &["id", "label"])]);
    engine
        .load(
            &source("src", "items"),
            data(
                &["id", "label"],
                (0..40_000)
                    .map(|id| json!({"id":id,"label":format!("item-{id}")}))
                    .collect(),
            ),
        )
        .unwrap();
    assert!(engine.allocated_pages().unwrap() * sandbox::DATABASE_PAGE_BYTES < 8 * 1024 * 1024);
}

#[tokio::test]
async fn keyless_tables_and_views_fit_one_page_or_fail_before_an_aggregate() {
    for rows in [0_usize, MAX_PAGE_ROWS, MAX_PAGE_ROWS + 1] {
        let (directory, services) = fixture(1).await;
        let mut database = Connection::open(directory.path().join("customers.sqlite")).unwrap();
        database.execute_batch("CREATE TABLE keyless(id INTEGER); CREATE VIEW visible_keyless AS SELECT id FROM keyless").unwrap();
        let transaction = database.transaction().unwrap();
        for id in 0..rows {
            transaction
                .execute("INSERT INTO keyless VALUES (?1)", [id as i64])
                .unwrap();
        }
        transaction.commit().unwrap();
        for table in ["keyless", "visible_keyless"] {
            let request = FederationRequest {
                sources: vec![source("customers", table)],
                sql: format!("SELECT count(*) n FROM customers.{table}"),
            };
            let result = run_with_config(&services, request, 30, &config()).await;
            if rows <= MAX_PAGE_ROWS {
                let report = result.unwrap();
                assert_eq!(report.result.rows, vec![json!({"n":rows})]);
                assert_eq!(report.source_reads, 2);
            } else {
                let error = result.unwrap_err();
                assert!(error.contains("mehr als 512") && error.contains("Primärschlüssel"));
            }
        }
    }
}

#[tokio::test]
async fn composite_primary_keys_keep_pages_stable_when_unordered_scan_direction_changes() {
    let (_directory, services) = fixture(1536).await;
    let source = source("customers", "customers");
    let mut cache = ConnectionCache::new();
    let resolved = connection::resolve(&services, &mut cache, &source.connection_id, None)
        .await
        .unwrap();
    let adapter = connection::adapter(&services, &resolved).unwrap();
    let columns = adapter
        .list_columns(Some("main"), Some("customers"), None)
        .await
        .unwrap()
        .into_iter()
        .map(|column| column.name)
        .collect();
    let mut plan = paging::PagePlan::prepare(
        adapter.as_ref(),
        resolved.kind,
        &source,
        1536,
        &columns,
        &CancellationToken::new(),
        Instant::now() + Duration::from_secs(30),
    )
    .await
    .unwrap();
    let mut observed = Vec::new();
    for (index, offset) in (0..1536).step_by(MAX_PAGE_ROWS).enumerate() {
        adapter
            .execute_query(if index % 2 == 0 {
                "PRAGMA reverse_unordered_selects=ON"
            } else {
                "PRAGMA reverse_unordered_selects=OFF"
            })
            .await
            .unwrap();
        let page = plan
            .fetch(
                adapter.as_ref(),
                resolved.kind,
                &source,
                MAX_PAGE_ROWS,
                offset,
            )
            .await
            .unwrap();
        assert_eq!(page.rows.len(), MAX_PAGE_ROWS);
        plan.accept(&source, &page).unwrap();
        observed.extend(
            page.rows
                .iter()
                .map(|row| (row["tenant"].as_i64().unwrap(), row["id"].as_i64().unwrap())),
        );
    }
    let mut expected = (0_i64..1536).map(|id| (id % 7, id)).collect::<Vec<_>>();
    expected.sort();
    assert_eq!(observed, expected);
    assert_eq!(observed.into_iter().collect::<HashSet<_>>().len(), 1536);
}

#[tokio::test]
async fn sqlite_nullable_composite_primary_keys_cannot_hide_nonunique_page_order() {
    let (directory, services) = fixture(1).await;
    let mut database = Connection::open(directory.path().join("customers.sqlite")).unwrap();
    database
        .execute_batch(
            "CREATE TABLE nullable_key(tenant INTEGER, id INTEGER, PRIMARY KEY(tenant,id))",
        )
        .unwrap();
    let transaction = database.transaction().unwrap();
    for id in 0..513_i64 {
        transaction
            .execute("INSERT INTO nullable_key VALUES (NULL, ?1)", [id])
            .unwrap();
    }
    transaction.commit().unwrap();
    let request = FederationRequest {
        sources: vec![source("customers", "nullable_key")],
        sql: "SELECT count(*) n FROM customers.nullable_key".into(),
    };
    let error = run_with_config(&services, request, 30, &config())
        .await
        .unwrap_err();
    assert!(
        error.contains("NULL-Primärschlüssel") && error.contains("kein unvollständiges Ergebnis")
    );
}

#[test]
fn sqlite_full_preserves_the_alias_page_budget_and_reports_the_actual_limit() {
    assert_eq!(sandbox::DATABASE_PAGE_BYTES, 4096);
    assert_eq!(sandbox::MAX_DATABASE_PAGES, 8192);
    assert_eq!(sandbox::MAX_ALIAS_DATABASE_BYTES, 32 * 1024 * 1024);
    assert_eq!(MAX_INPUT_BYTES, 64 * 1024 * 1024);
    let engine = sandbox(&[definition("src", "items", &["id", "payload"])]);
    let payload = "x".repeat(64 * 1024);
    let mut loaded = 0_usize;
    let mut input_bytes = 0_usize;
    let mut full = None;
    for batch in 0..8 {
        let page = data(
            &["id", "payload"],
            (0..128)
                .map(|id| json!({"id":batch * 128 + id,"payload":payload.clone()}))
                .collect(),
        );
        assert!(page.rows.len() <= MAX_PAGE_ROWS);
        input_bytes += page.rows.iter().map(sandbox::value_bytes).sum::<usize>();
        match engine.load(&source("src", "items"), page) {
            Ok(()) => loaded += 128,
            Err(cause) => {
                full = Some(cause);
                break;
            }
        }
    }
    let error = full.expect("The unchanged 8192-page alias limit must be enforced");
    assert!(error.contains("Quelle src.items"));
    assert!(error.contains("32 MiB") && error.contains("8192") && error.contains("4096"));
    assert!(error.contains("64 MiB") && error.contains("Alias"));
    assert!(input_bytes < MAX_INPUT_BYTES);
    assert!(
        engine.allocated_pages().unwrap() * sandbox::DATABASE_PAGE_BYTES
            <= sandbox::MAX_ALIAS_DATABASE_BYTES
    );
    assert_eq!(
        engine
            .execute("SELECT count(*) n FROM src.items")
            .unwrap()
            .rows,
        vec![json!({"n":loaded})]
    );
}
