use std::time::{Duration, Instant};

use super::execution::{self, ExecutionOptions};
use super::oracle::OracleAdapter;
use super::DatabaseAdapter;

fn adapter(key: &str) -> Option<OracleAdapter> {
    let url = std::env::var("L8DB_SMOKE_ORACLE_URL").ok()?;
    Some(OracleAdapter::new(&url, super::pool::create_pool_state(), key.into()).unwrap())
}

fn admin(key: &str) -> Option<OracleAdapter> {
    let url = std::env::var("L8DB_SMOKE_ORACLE_ADMIN_URL").ok()?;
    Some(OracleAdapter::new(&url, super::pool::create_pool_state(), key.into()).unwrap())
}

fn options(job: Option<&str>, timeout: u64) -> Option<ExecutionOptions> {
    Some(ExecutionOptions {
        job_id: job.map(str::to_string),
        query_timeout: Some(timeout),
        ..Default::default()
    })
}

fn text(result: &super::QueryResult, column: &str) -> String {
    result.rows[0][column].as_str().unwrap_or_default().to_string()
}

fn percentile(samples: &mut [f64], p: f64) -> f64 {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    samples[((samples.len() - 1) as f64 * p).round() as usize]
}

#[tokio::test]
#[ignore]
async fn live_user_cancel_stops_the_running_statement() {
    let Some(db) = adapter("live-cancel") else {
        return;
    };
    db.execute_query("SELECT 1 FROM dual").await.unwrap();
    let job = "live-cancel-job";
    let started = Instant::now();
    let canceller = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(800)).await;
        execution::cancel(job)
    });
    let result = execution::run_query(
        options(Some(job), 60),
        true,
        db.execute_query("SELECT COUNT(*) AS c FROM all_objects a, all_objects b, all_objects c"),
    )
    .await;
    assert_eq!(canceller.await.unwrap(), Ok(true));
    assert_eq!(result.unwrap_err(), "Abfrage vom Benutzer abgebrochen.");
    let broken = started.elapsed();
    assert!(broken < Duration::from_secs(10), "{broken:?}");
    let next = db.execute_query("SELECT 42 AS answer FROM dual").await.unwrap();
    assert_eq!(next.rows.len(), 1);
    let Some(sys) = admin("live-cancel-kill") else {
        return;
    };
    sys.execute_query("SELECT 1 FROM dual").await.unwrap();
    let job = "live-cancel-kill-job";
    let started = Instant::now();
    let canceller = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(800)).await;
        execution::cancel(job)
    });
    let killed = execution::run_query(
        Some(ExecutionOptions {
            job_id: Some(job.into()),
            query_timeout: Some(60),
            connection_timeout: Some(3),
            ..Default::default()
        }),
        true,
        sys.execute_query("BEGIN DBMS_SESSION.SLEEP(30); END;"),
    )
    .await;
    assert_eq!(canceller.await.unwrap(), Ok(true));
    let error = killed.unwrap_err();
    let escalated = started.elapsed();
    assert!(error.contains("Sitzung wurde beendet") || error.contains("vom Benutzer abgebrochen"), "{error}");
    assert!(escalated < Duration::from_secs(15), "{escalated:?}");
    let again = sys.execute_query("SELECT 42 AS answer FROM dual").await.unwrap();
    assert_eq!(again.rows.len(), 1);
    eprintln!("cancel: break after {broken:?}; sleep stopped after {escalated:?} ({})", error.lines().next().unwrap_or(""));
}

#[tokio::test]
#[ignore]
async fn live_native_cancel_keeps_the_query_deadline() {
    let Some(db) = adapter("live-deadline") else {
        return;
    };
    let started = Instant::now();
    let result = execution::run_query(
        options(None, 5),
        true,
        db.execute_query("BEGIN DBMS_SESSION.SLEEP(40); END;"),
    )
    .await;
    let error = result.unwrap_err();
    assert!(error.starts_with("Query-Timeout nach 5 Sekunden"), "{error}");
    assert!(started.elapsed() < Duration::from_secs(12), "{:?}", started.elapsed());
    assert!(db.execute_query("SELECT 1 FROM dual").await.is_ok());
}

#[tokio::test]
#[ignore]
async fn live_sessions_are_tagged_with_module_and_action() {
    let Some(db) = adapter("live-module") else {
        return;
    };
    let result = execution::run_query(
        options(None, 30),
        true,
        db.execute_query(
            "SELECT SYS_CONTEXT('USERENV', 'MODULE') AS module, SYS_CONTEXT('USERENV', 'ACTION') AS action FROM dual",
        ),
    )
    .await
    .unwrap();
    assert_eq!(text(&result, "MODULE"), "l8db");
    assert!(text(&result, "ACTION").starts_with("editor "), "{result:?}");
}

#[tokio::test]
#[ignore]
async fn live_row_limit_stops_reading_large_results() {
    let Some(db) = adapter("live-row-limit") else {
        return;
    };
    let sql = "SELECT LEVEL AS n, RPAD('x', 100, 'x') AS pad FROM dual CONNECT BY LEVEL <= 100000";
    db.execute_query("SELECT 1 FROM dual").await.unwrap();
    let mut capped = Vec::new();
    for _ in 0..7 {
        let started = Instant::now();
        let result = super::commands::capped_query(db.execute_query(sql))
            .await
            .unwrap();
        capped.push(started.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(result.rows.len(), 1000);
        assert!(result.truncated);
    }
    let started = Instant::now();
    let full = db.execute_query(sql).await.unwrap();
    let full_ms = started.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(full.rows.len(), 100_000);
    let (median, p95) = (percentile(&mut capped, 0.5), percentile(&mut capped, 0.95));
    println!("oracle row limit: 100k rows x 100 B, capped median {median:.1} ms p95 {p95:.1} ms, uncapped {full_ms:.1} ms");
    assert!(p95 < 2_000.0, "p95 {p95} ms");
    assert!(median * 5.0 < full_ms, "median {median} ms vs full {full_ms} ms");
}

#[tokio::test]
#[ignore]
async fn live_server_output_is_read_in_one_roundtrip() {
    let Some(db) = adapter("live-output") else {
        return;
    };
    db.set_server_output(true).await.unwrap();
    db.execute_query(
        "BEGIN FOR i IN 1 .. 2500 LOOP DBMS_OUTPUT.PUT_LINE('line ' || i); END LOOP; DBMS_OUTPUT.PUT_LINE(NULL); END;",
    )
    .await
    .unwrap();
    let started = Instant::now();
    let first = db.take_server_output().await.unwrap();
    let elapsed = started.elapsed();
    assert_eq!(first.len(), 2000);
    assert_eq!(first[0].message, "line 1");
    assert_eq!(first[1999].message, "line 2000");
    let rest = db.take_server_output().await.unwrap();
    assert_eq!(rest.len(), 501);
    assert_eq!(rest[499].message, "line 2500");
    assert_eq!(rest[500].message, "");
    assert!(db.take_server_output().await.unwrap().is_empty());
    println!("oracle server output: 2000 lines in {:.1} ms", elapsed.as_secs_f64() * 1000.0);
    assert!(elapsed < Duration::from_secs(2), "{elapsed:?}");
}

#[tokio::test]
#[ignore]
async fn live_compile_reports_warnings_without_invalidating() {
    let Some(db) = adapter("live-compile") else {
        return;
    };
    let _ = db.execute_query("DROP PROCEDURE l8db_warn_proc").await;
    let _ = db.execute_query("DROP PROCEDURE l8db_err_proc").await;
    db.execute_query("ALTER SESSION SET PLSQL_WARNINGS = 'ENABLE:ALL'")
        .await
        .unwrap();
    db.execute_query(
        "CREATE OR REPLACE PROCEDURE l8db_warn_proc IS\n  x NUMBER;\nBEGIN\n  IF 1 = 2 THEN\n    x := 1;\n  END IF;\nEND;",
    )
    .await
    .unwrap();
    let owner = text(
        &db.execute_query("SELECT USER AS u FROM dual").await.unwrap(),
        "U",
    );
    let oid = format!("{owner}\u{1f}L8DB_WARN_PROC\u{1f}PROCEDURE");
    let result = db.compile_object(&oid, "procedure").await.unwrap();
    assert_eq!(result.status, "VALID", "{result:?}");
    assert!(result.message.as_deref().unwrap_or("").contains("PLW-"), "{result:?}");
    let error = db
        .execute_query(
            "CREATE OR REPLACE\nPROCEDURE l8db_err_proc IS\nBEGIN\n  l8db_missing_proc;\nEND;",
        )
        .await
        .unwrap_err();
    assert!(error.contains("Zeile 3, Spalte 3: PLS-00201"), "{error}");
    assert!(!error.contains("Statement ignored"), "{error}");
    let oid = format!("{owner}\u{1f}L8DB_ERR_PROC\u{1f}PROCEDURE");
    let invalid = db.compile_object(&oid, "procedure").await.unwrap();
    assert_eq!(invalid.status, "INVALID");
    assert_eq!((invalid.line, invalid.position), (Some(3), Some(3)));
    let errors = db.list_compile_errors(None).await.unwrap();
    assert!(errors
        .iter()
        .any(|e| e.name == "L8DB_WARN_PROC" && e.severity == "WARNING"));
    assert!(errors
        .iter()
        .any(|e| e.name == "L8DB_ERR_PROC" && e.severity == "ERROR"));
    assert!(errors.iter().all(|e| !e.name.starts_with("BIN$")));
    db.execute_query("DROP PROCEDURE l8db_warn_proc").await.unwrap();
    db.execute_query("DROP PROCEDURE l8db_err_proc").await.unwrap();
}

#[tokio::test]
#[ignore]
async fn live_reconnect_restores_session_settings() {
    let (Some(db), Some(sys)) = (adapter("live-reconnect"), admin("live-reconnect-admin")) else {
        return;
    };
    db.set_server_output(true).await.unwrap();
    db.execute_query("ALTER SESSION SET NLS_DATE_LANGUAGE = 'GERMAN'")
        .await
        .unwrap();
    let action = text(
        &db.execute_query("SELECT SYS_CONTEXT('USERENV', 'SID') AS sid FROM dual")
            .await
            .unwrap(),
        "SID",
    );
    sys.execute_query(&format!(
        "BEGIN FOR s IN (SELECT sid, serial# FROM v$session WHERE sid = {action}) LOOP EXECUTE IMMEDIATE 'ALTER SYSTEM KILL SESSION ''' || s.sid || ',' || s.serial# || ''' IMMEDIATE'; END LOOP; END;"
    ))
    .await
    .unwrap();
    let failed = db.execute_query("SELECT 1 FROM dual").await.unwrap_err();
    assert!(failed.contains("neu aufgebaut"), "{failed}");
    let language = db
        .execute_query("SELECT value AS v FROM nls_session_parameters WHERE parameter = 'NLS_DATE_LANGUAGE'")
        .await
        .unwrap();
    assert_eq!(text(&language, "V"), "GERMAN");
    db.execute_query("BEGIN DBMS_OUTPUT.PUT_LINE('after reconnect'); END;")
        .await
        .unwrap();
    let output = db.take_server_output().await.unwrap();
    assert!(output.iter().any(|m| m.message == "after reconnect"), "{output:?}");
}

#[tokio::test]
#[ignore]
async fn live_metadata_lists_skip_noise_and_duplicates() {
    let Some(db) = adapter("live-noise") else {
        return;
    };
    for sql in [
        "DROP SYNONYM l8db_pkg_syn",
        "DROP PACKAGE l8db_syn_pkg",
        "DROP MATERIALIZED VIEW LOG ON l8db_noise_t",
        "DROP TABLE l8db_noise_t PURGE",
        "DROP TABLE l8db_bin_t",
        "PURGE RECYCLEBIN",
    ] {
        let _ = db.execute_query(sql).await;
    }
    db.execute_query("CREATE OR REPLACE PACKAGE l8db_syn_pkg IS PROCEDURE p; END;")
        .await
        .unwrap();
    db.execute_query("CREATE OR REPLACE PACKAGE BODY l8db_syn_pkg IS PROCEDURE p IS BEGIN NULL; END; END;")
        .await
        .unwrap();
    db.execute_query("CREATE SYNONYM l8db_pkg_syn FOR l8db_syn_pkg")
        .await
        .unwrap();
    db.execute_query("CREATE TABLE l8db_noise_t (id NUMBER PRIMARY KEY)")
        .await
        .unwrap();
    db.execute_query("CREATE MATERIALIZED VIEW LOG ON l8db_noise_t")
        .await
        .unwrap();
    db.execute_query("CREATE TABLE l8db_bin_t (id NUMBER)").await.unwrap();
    db.execute_query("DROP TABLE l8db_bin_t").await.unwrap();
    let synonyms = db.list_synonyms(None).await.unwrap();
    let matches: Vec<_> = synonyms.iter().filter(|s| s.name == "L8DB_PKG_SYN").collect();
    assert_eq!(matches.len(), 1, "{matches:?}");
    assert_eq!(matches[0].target_type, "package");
    let tables: Vec<String> = db
        .list_tables(None)
        .await
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert!(tables.contains(&"L8DB_NOISE_T".to_string()));
    assert!(tables.iter().all(|t| !t.starts_with("BIN$") && !t.starts_with("MLOG$_")), "{tables:?}");
    for sql in [
        "DROP SYNONYM l8db_pkg_syn",
        "DROP PACKAGE l8db_syn_pkg",
        "DROP TABLE l8db_noise_t PURGE",
        "PURGE RECYCLEBIN",
    ] {
        let _ = db.execute_query(sql).await;
    }
}

#[tokio::test]
#[ignore]
async fn live_plans_and_view_validation() {
    let (Some(db), Some(sys)) = (adapter("live-plan"), admin("live-plan-admin")) else {
        return;
    };
    let _ = db.execute_query("DROP VIEW l8db_plan_v").await;
    db.execute_query("CREATE VIEW l8db_plan_v AS SELECT 1 AS n FROM dual")
        .await
        .unwrap();
    let owner = text(
        &db.execute_query("SELECT USER AS u FROM dual").await.unwrap(),
        "U",
    );
    let before = db
        .execute_query("SELECT COUNT(*) AS c FROM plan_table")
        .await
        .unwrap();
    db.update_view_definition(&owner, "L8DB_PLAN_V", "SELECT 2 AS n FROM dual", true)
        .await
        .unwrap();
    let broken = db
        .update_view_definition(&owner, "L8DB_PLAN_V", "SELECT nope FROM dual", true)
        .await
        .unwrap_err();
    assert!(broken.contains("ORA-00904"), "{broken}");
    let after = db
        .execute_query("SELECT COUNT(*) AS c FROM plan_table")
        .await
        .unwrap();
    assert_eq!(before.rows, after.rows);
    let _ = db.execute_query("DROP TABLE l8db_plan_t").await;
    db.execute_query("CREATE TABLE l8db_plan_t AS SELECT level AS id, MOD(level, 7) AS grp FROM dual CONNECT BY level <= 2000")
        .await
        .unwrap();
    let plan = db
        .explain_query("SELECT * FROM l8db_plan_t a JOIN l8db_plan_t b ON b.grp = a.id", false)
        .await
        .unwrap();
    assert!(plan[0]["Plan"]["Node Type"].is_string(), "{plan}");
    let analyzed = sys
        .explain_query(&format!("SELECT COUNT(*) FROM {owner}.l8db_plan_t a JOIN {owner}.l8db_plan_t b ON b.grp = a.id"), true)
        .await
        .unwrap();
    assert!(analyzed[0]["Execution Time"].is_number(), "{analyzed}");
    db.execute_query("DROP TABLE l8db_plan_t").await.unwrap();
    db.execute_query("DROP VIEW l8db_plan_v").await.unwrap();
}

#[tokio::test]
#[ignore]
async fn live_session_list_reports_module_and_blockers() {
    let Some(sys) = admin("live-sessions") else {
        return;
    };
    sys.execute_query("SELECT 1 FROM dual").await.unwrap();
    let sessions = sys.list_sessions().await.unwrap();
    let me = sessions.iter().find(|s| s.is_self).expect("own session");
    assert!(me.application.contains("l8db"), "{me:?}");
    assert!(me.backend_start.is_some());
}
