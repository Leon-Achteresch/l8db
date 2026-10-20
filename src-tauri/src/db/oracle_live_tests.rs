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
    result.rows[0][column]
        .as_str()
        .unwrap_or_default()
        .to_string()
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
    let next = db
        .execute_query("SELECT 42 AS answer FROM dual")
        .await
        .unwrap();
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
    assert!(
        error.contains("Sitzung wurde beendet") || error.contains("vom Benutzer abgebrochen"),
        "{error}"
    );
    assert!(escalated < Duration::from_secs(15), "{escalated:?}");
    let again = sys
        .execute_query("SELECT 42 AS answer FROM dual")
        .await
        .unwrap();
    assert_eq!(again.rows.len(), 1);
    eprintln!(
        "cancel: break after {broken:?}; sleep stopped after {escalated:?} ({})",
        error.lines().next().unwrap_or("")
    );
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
    assert!(
        error.starts_with("Query-Timeout nach 5 Sekunden"),
        "{error}"
    );
    assert!(
        started.elapsed() < Duration::from_secs(12),
        "{:?}",
        started.elapsed()
    );
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
    assert!(
        median * 5.0 < full_ms,
        "median {median} ms vs full {full_ms} ms"
    );
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
    println!(
        "oracle server output: 2000 lines in {:.1} ms",
        elapsed.as_secs_f64() * 1000.0
    );
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
        &db.execute_query("SELECT USER AS u FROM dual")
            .await
            .unwrap(),
        "U",
    );
    let oid = format!("{owner}\u{1f}L8DB_WARN_PROC\u{1f}PROCEDURE");
    let result = db.compile_object(&oid, "procedure").await.unwrap();
    assert_eq!(result.status, "VALID", "{result:?}");
    assert!(
        result.message.as_deref().unwrap_or("").contains("PLW-"),
        "{result:?}"
    );
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
    db.execute_query("DROP PROCEDURE l8db_warn_proc")
        .await
        .unwrap();
    db.execute_query("DROP PROCEDURE l8db_err_proc")
        .await
        .unwrap();
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
        .execute_query(
            "SELECT value AS v FROM nls_session_parameters WHERE parameter = 'NLS_DATE_LANGUAGE'",
        )
        .await
        .unwrap();
    assert_eq!(text(&language, "V"), "GERMAN");
    db.execute_query("BEGIN DBMS_OUTPUT.PUT_LINE('after reconnect'); END;")
        .await
        .unwrap();
    let output = db.take_server_output().await.unwrap();
    assert!(
        output.iter().any(|m| m.message == "after reconnect"),
        "{output:?}"
    );
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
    db.execute_query(
        "CREATE OR REPLACE PACKAGE BODY l8db_syn_pkg IS PROCEDURE p IS BEGIN NULL; END; END;",
    )
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
    db.execute_query("CREATE TABLE l8db_bin_t (id NUMBER)")
        .await
        .unwrap();
    db.execute_query("DROP TABLE l8db_bin_t").await.unwrap();
    let synonyms = db.list_synonyms(None).await.unwrap();
    let matches: Vec<_> = synonyms
        .iter()
        .filter(|s| s.name == "L8DB_PKG_SYN")
        .collect();
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
    assert!(
        tables
            .iter()
            .all(|t| !t.starts_with("BIN$") && !t.starts_with("MLOG$_")),
        "{tables:?}"
    );
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
        &db.execute_query("SELECT USER AS u FROM dual")
            .await
            .unwrap(),
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
        .explain_query(
            "SELECT * FROM l8db_plan_t a JOIN l8db_plan_t b ON b.grp = a.id",
            false,
        )
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

fn sys_url() -> Option<String> {
    let admin = std::env::var("L8DB_SMOKE_ORACLE_ADMIN_URL").ok()?;
    let rest = admin.split_once('@')?.1;
    Some(format!(
        "oracle://sys:{}@{rest}?privilege=sysdba",
        admin
            .split_once("://")?
            .1
            .split_once('@')?
            .0
            .split_once(':')?
            .1
    ))
}

#[tokio::test]
#[ignore]
async fn live_probe_reports_version_rights_and_logins() {
    let (Some(db), Some(sys)) = (adapter("live-probe"), admin("live-probe-admin")) else {
        return;
    };
    let mut samples = Vec::new();
    for round in 0..5 {
        let fresh = adapter(&format!("live-probe-{round}")).unwrap();
        let started = Instant::now();
        fresh.server_info().await.unwrap();
        samples.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    let info = db.server_info().await.unwrap();
    assert!(info.major >= 19, "{info:?}");
    assert_eq!(info.user, "L8DB");
    assert_eq!(info.max_identifier, 128);
    assert!(info.container.is_some() && info.sid.is_some(), "{info:?}");
    let cached = Instant::now();
    assert_eq!(db.server_info().await.unwrap(), info);
    let cached = cached.elapsed();
    let admin_info = sys.server_info().await.unwrap();
    assert!(
        admin_info.reads("V$SESSION") && admin_info.reads("V$LOCK"),
        "{admin_info:?}"
    );
    assert!(
        !admin_info.limits.iter().any(|l| l.contains("V$SESSION")),
        "{admin_info:?}"
    );
    let (median, p95) = (
        percentile(&mut samples.clone(), 0.5),
        percentile(&mut samples, 0.95),
    );
    eprintln!(
        "probe: median {median:.1} ms, p95 {p95:.1} ms, cached {cached:?}; app limits {:?}",
        info.limits
    );
    assert!(cached < Duration::from_millis(5));
    assert!(p95 < 3000.0);
    if let Some(url) = sys_url() {
        let sysdba =
            OracleAdapter::new(&url, super::pool::create_pool_state(), "live-sysdba".into())
                .unwrap();
        assert_eq!(sysdba.server_info().await.unwrap().user, "SYS");
    }
    let sid_url = std::env::var("L8DB_SMOKE_ORACLE_ADMIN_URL").unwrap();
    let sid_url = format!("{}/?sid=FREE", sid_url.rsplit_once('/').unwrap().0);
    let by_sid = OracleAdapter::new(
        &sid_url,
        super::pool::create_pool_state(),
        "live-sid".into(),
    )
    .unwrap();
    assert_eq!(
        by_sid.server_info().await.unwrap().container.as_deref(),
        Some("CDB$ROOT")
    );
    let wrong = OracleAdapter::new(
        &format!(
            "{}/NOPE_SERVICE",
            std::env::var("L8DB_SMOKE_ORACLE_URL")
                .unwrap()
                .rsplit_once('/')
                .unwrap()
                .0
        ),
        super::pool::create_pool_state(),
        "live-wrong-service".into(),
    )
    .unwrap();
    let error = wrong.test_connection().await.unwrap_err();
    assert!(
        error.contains("ORA-12514") && error.contains("Hinweis:"),
        "{error}"
    );
}

#[tokio::test]
#[ignore]
async fn live_locks_list_row_locks_with_their_table() {
    let (Some(db), Some(sys)) = (adapter("live-locks"), admin("live-locks-admin")) else {
        return;
    };
    let _ = db.execute_query("DROP TABLE l8db_lock_t").await;
    db.execute_query("CREATE TABLE l8db_lock_t (id NUMBER PRIMARY KEY)")
        .await
        .unwrap();
    db.execute_query("INSERT INTO l8db_lock_t VALUES (1)")
        .await
        .unwrap();
    let url = std::env::var("L8DB_SMOKE_ORACLE_URL").unwrap();
    let parsed = super::oracle::parse_oracle_url(&url).unwrap();
    let holder =
        oracle::Connection::connect(&parsed.user, &parsed.password, &parsed.connect_string)
            .unwrap();
    holder
        .execute("UPDATE l8db_lock_t SET id = id WHERE id = 1", &[])
        .unwrap();
    let sid: i64 = holder
        .query_row_as::<(i64,)>("SELECT SYS_CONTEXT('USERENV', 'SID') FROM dual", &[])
        .unwrap()
        .0;
    let locks = sys.list_locks().await.unwrap();
    let mine: Vec<_> = locks.iter().filter(|l| l.pid as i64 == sid).collect();
    assert!(
        mine.iter().any(|l| l.lock_type == "TM"
            && l.relation.as_deref() == Some("L8DB.L8DB_LOCK_T")
            && l.granted),
        "{mine:?}"
    );
    assert!(
        mine.iter()
            .any(|l| l.lock_type == "TX" && l.mode.starts_with("Exclusive")),
        "{mine:?}"
    );
    holder.rollback().unwrap();
    db.execute_query("DROP TABLE l8db_lock_t").await.unwrap();
    let denied = db.list_locks().await;
    if let Err(message) = denied {
        assert!(message.contains("V$LOCK"), "{message}");
    }
}

#[tokio::test]
#[ignore]
async fn live_compile_pairs_spec_and_body_and_honours_warnings() {
    let (Some(db), Some(sys)) = (adapter("live-pair"), admin("live-pair-admin")) else {
        return;
    };
    let owner = text(
        &db.execute_query("SELECT USER AS u FROM dual")
            .await
            .unwrap(),
        "U",
    );
    db.execute_query("CREATE OR REPLACE PACKAGE l8db_pair AS PROCEDURE run; END;")
        .await
        .unwrap();
    db.execute_query("CREATE OR REPLACE PACKAGE BODY l8db_pair AS PROCEDURE run IS x NUMBER; BEGIN IF 1 = 2 THEN x := 1; END IF; END; END;").await.unwrap();
    db.execute_query("ALTER SESSION SET PLSQL_WARNINGS = 'DISABLE:ALL'")
        .await
        .unwrap();
    let spec = format!("{owner}\u{1f}L8DB_PAIR\u{1f}PACKAGE");
    super::oracle::PLSQL_WARNINGS.store(true, std::sync::atomic::Ordering::Relaxed);
    let warned = db.compile_object(&spec, "package_spec").await;
    let body_warnings = db.list_compile_errors(None).await.unwrap();
    super::oracle::PLSQL_WARNINGS.store(false, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(warned.unwrap().status, "VALID");
    assert!(
        body_warnings.iter().any(|e| e.name == "L8DB_PAIR"
            && e.object_type == "PACKAGE BODY"
            && e.severity == "WARNING"),
        "{body_warnings:?}"
    );
    let status = text(&db.execute_query("SELECT status AS s FROM user_objects WHERE object_name = 'L8DB_PAIR' AND object_type = 'PACKAGE BODY'").await.unwrap(), "S");
    assert_eq!(status, "VALID");
    db.execute_query("CREATE OR REPLACE PACKAGE BODY l8db_pair AS PROCEDURE run IS BEGIN l8db_missing_proc; END; END;").await.unwrap_err();
    let broken = db.compile_object(&spec, "package_spec").await.unwrap();
    assert_eq!(broken.status, "INVALID", "{broken:?}");
    assert!(
        broken
            .message
            .as_deref()
            .unwrap_or("")
            .contains("Package Body"),
        "{broken:?}"
    );
    db.execute_query(
        "CREATE OR REPLACE PROCEDURE l8db_sleepy IS BEGIN DBMS_SESSION.SLEEP(6); END;",
    )
    .await
    .unwrap();
    let url = std::env::var("L8DB_SMOKE_ORACLE_URL").unwrap();
    let parsed = super::oracle::parse_oracle_url(&url).unwrap();
    let runner = std::thread::spawn(move || {
        let conn =
            oracle::Connection::connect(&parsed.user, &parsed.password, &parsed.connect_string)
                .unwrap();
        conn.execute("BEGIN l8db_sleepy; END;", &[]).map(|_| ())
    });
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let busy = sys
        .compile_object(
            &format!("{owner}\u{1f}L8DB_SLEEPY\u{1f}PROCEDURE"),
            "procedure",
        )
        .await
        .unwrap_err();
    assert!(
        busy.contains("wird gerade ausgeführt") && busy.contains("Sitzung"),
        "{busy}"
    );
    runner.join().unwrap().unwrap();
    db.execute_query("DROP PACKAGE l8db_pair").await.unwrap();
    db.execute_query("DROP PROCEDURE l8db_sleepy")
        .await
        .unwrap();
}

#[tokio::test]
#[ignore]
async fn live_dependencies_debug_check_and_implicit_results() {
    let Some(db) = adapter("live-deps") else {
        return;
    };
    let owner = text(
        &db.execute_query("SELECT USER AS u FROM dual")
            .await
            .unwrap(),
        "U",
    );
    for drop in [
        "DROP VIEW l8db_dep_v2",
        "DROP VIEW l8db_dep_v1",
        "DROP TABLE l8db_dep_t",
        "DROP PROCEDURE l8db_dbg_proc",
    ] {
        let _ = db.execute_query(drop).await;
    }
    db.execute_query("CREATE TABLE l8db_dep_t (id NUMBER)")
        .await
        .unwrap();
    db.execute_query("CREATE VIEW l8db_dep_v1 AS SELECT id FROM l8db_dep_t")
        .await
        .unwrap();
    db.execute_query("CREATE VIEW l8db_dep_v2 AS SELECT id FROM l8db_dep_v1")
        .await
        .unwrap();
    let deps = db.list_used_by(&owner, "L8DB_DEP_T").await.unwrap();
    let v1 = deps
        .iter()
        .find(|d| d.name == "L8DB_DEP_V1")
        .expect("direct view");
    let v2 = deps
        .iter()
        .find(|d| d.name == "L8DB_DEP_V2")
        .expect("indirect view");
    assert_eq!(v1.relation, "Abhängigkeit");
    assert_eq!(v2.relation, "indirekt (Ebene 2)");
    assert_eq!(v2.detail, format!("über {owner}.L8DB_DEP_V1"));
    db.execute_query("CREATE OR REPLACE PROCEDURE l8db_dbg_proc IS BEGIN NULL; END;")
        .await
        .unwrap();
    db.execute_query("ALTER PROCEDURE l8db_dbg_proc COMPILE DEBUG")
        .await
        .unwrap();
    let listed = db.list_invalid_objects(None).await.unwrap();
    assert!(
        listed
            .iter()
            .any(|o| o.name == "L8DB_DBG_PROC" && o.status == "DEBUG"),
        "{listed:?}"
    );
    db.compile_invalid_objects(None).await.unwrap();
    let after = db.list_invalid_objects(None).await.unwrap();
    assert!(
        !after.iter().any(|o| o.name == "L8DB_DBG_PROC"),
        "{after:?}"
    );
    db.take_server_output().await.unwrap();
    let result = db
        .execute_query("DECLARE c SYS_REFCURSOR; BEGIN OPEN c FOR SELECT 1 AS a FROM dual UNION ALL SELECT 2 FROM dual; DBMS_SQL.RETURN_RESULT(c); OPEN c FOR SELECT 3 AS b FROM dual; DBMS_SQL.RETURN_RESULT(c); END;")
        .await
        .unwrap();
    assert_eq!(result.columns, vec!["A".to_string()]);
    assert_eq!(result.rows.len(), 2);
    let notes = db.take_server_output().await.unwrap();
    assert!(
        notes
            .iter()
            .any(|m| m.message.contains("1 weitere Ergebnismenge")),
        "{notes:?}"
    );
    let plain = db.execute_query("BEGIN NULL; END;").await.unwrap();
    assert!(plain.columns.is_empty() && plain.rows_affected.is_none());
    for drop in [
        "DROP VIEW l8db_dep_v2",
        "DROP VIEW l8db_dep_v1",
        "DROP TABLE l8db_dep_t",
        "DROP PROCEDURE l8db_dbg_proc",
    ] {
        db.execute_query(drop).await.unwrap();
    }
}

#[tokio::test]
#[ignore]
async fn live_sql_log_records_metadata_and_counts_roundtrips() {
    let Some(db) = adapter("live-sql-log") else {
        return;
    };
    let owner = text(
        &db.execute_query("SELECT USER AS u FROM dual")
            .await
            .unwrap(),
        "U",
    );
    let _ = db.execute_query("DROP TABLE l8db_trg_t").await;
    let _ = db.execute_query("DROP VIEW l8db_log_v").await;
    db.execute_query("CREATE TABLE l8db_trg_t (id NUMBER)")
        .await
        .unwrap();
    for n in 1..=4 {
        db.execute_query(&format!("CREATE OR REPLACE TRIGGER l8db_trg_{n} BEFORE INSERT ON l8db_trg_t FOR EACH ROW BEGIN :NEW.id := NVL(:NEW.id, {n}); END;")).await.unwrap();
    }
    db.execute_query("CREATE VIEW l8db_log_v AS SELECT id FROM l8db_trg_t")
        .await
        .unwrap();
    super::sql_log::sql_log_clear();
    super::sql_log::sql_log_configure(true);
    let before = super::sql_log::sql_log_entries(0)
        .entries
        .last()
        .map_or(0, |e| e.id);
    let triggers = db.list_triggers(&owner, "L8DB_TRG_T").await.unwrap();
    let mid = super::sql_log::sql_log_entries(before).entries;
    let after_triggers = mid.last().map_or(before, |e| e.id);
    let view = db.get_view_definition(&owner, "L8DB_LOG_V").await.unwrap();
    let view_calls = super::sql_log::sql_log_entries(after_triggers).entries;
    db.list_tables(None).await.unwrap();
    let all = super::sql_log::sql_log_entries(0).entries;
    super::sql_log::sql_log_configure(false);
    assert_eq!(triggers.len(), 4);
    assert!(
        triggers
            .iter()
            .all(|t| t.definition.contains("CREATE OR REPLACE")),
        "{triggers:?}"
    );
    assert_eq!(mid.len(), 2, "trigger list roundtrips: {mid:?}");
    assert!(view.contains("L8DB_LOG_V"), "{view}");
    assert_eq!(
        view_calls.len(),
        2,
        "view definition roundtrips: {view_calls:?}"
    );
    assert!(
        all.iter()
            .any(|e| e.source == "meta" && e.kind == "query" && e.sql.contains("all_tables")),
        "{all:?}"
    );
    eprintln!(
        "sql_log: triggers {} queries, view {} queries, {} entries total",
        mid.len(),
        view_calls.len(),
        all.len()
    );
    super::sql_log::sql_log_clear();
    db.execute_query("DROP VIEW l8db_log_v").await.unwrap();
    db.execute_query("DROP TABLE l8db_trg_t").await.unwrap();
}

#[tokio::test]
#[ignore]
async fn live_data_compare_xplan_and_bulk_compile() {
    let Some(db) = adapter("live-batch3") else {
        return;
    };
    let owner = text(
        &db.execute_query("SELECT USER AS u FROM dual")
            .await
            .unwrap(),
        "U",
    );
    let _ = db.execute_query("DROP TABLE l8db_cmp_t").await;
    db.execute_query("CREATE TABLE l8db_cmp_t AS SELECT level AS id, 'row ' || level AS name, SYSDATE AS at FROM dual CONNECT BY level <= 50000")
        .await
        .unwrap();
    let request = |max_rows| super::snapshot::SnapshotRequest {
        schema: owner.clone(),
        table: "L8DB_CMP_T".into(),
        filter: None,
        allow_raw_filter: false,
        order_by: Some("ID".into()),
        order_desc: false,
        is_view: false,
        max_rows,
    };
    let started = Instant::now();
    let snapshot = db.snapshot_rows(&request(60_000)).await.unwrap();
    let elapsed = started.elapsed();
    assert_eq!(
        snapshot.columns,
        vec!["ID".to_string(), "NAME".into(), "AT".into()]
    );
    assert_eq!(snapshot.rows.len(), 50_000);
    assert_eq!(snapshot.rows[0]["NAME"], "row 1");
    let limited = db.snapshot_rows(&request(10)).await.unwrap_err();
    assert!(limited.contains("Zeilenlimit"), "{limited}");
    eprintln!("oracle snapshot: 50k rows in {elapsed:?}");
    assert!(elapsed < Duration::from_secs(20));

    let plan = db
        .explain_query("SELECT * FROM l8db_cmp_t WHERE id = 7", false)
        .await
        .unwrap();
    let text = plan[0]["Plan"]["Plan Text"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(
        text.contains("Plan hash value") && text.contains("L8DB_CMP_T"),
        "{text}"
    );
    let leftover = db
        .execute_query("SELECT COUNT(*) AS c FROM plan_table")
        .await
        .unwrap();
    assert_eq!(leftover.rows[0]["C"].to_string().trim_matches('"'), "0");

    let error = db.execute_query("DESC l8db_cmp_t").await.unwrap_err();
    assert!(error.contains("SQL*Plus-Befehle"), "{error}");

    for n in 1..=5 {
        db.execute_query(&format!(
            "CREATE OR REPLACE PROCEDURE l8db_bulk_{n} IS BEGIN l8db_bulk_dep; END;"
        ))
        .await
        .unwrap_err();
    }
    db.execute_query("CREATE OR REPLACE PROCEDURE l8db_bulk_dep IS BEGIN NULL; END;")
        .await
        .unwrap();
    super::sql_log::sql_log_clear();
    super::sql_log::sql_log_configure(true);
    let outcomes = db.compile_invalid_objects(None).await.unwrap();
    let calls = super::sql_log::sql_log_entries(0).entries.len();
    super::sql_log::sql_log_configure(false);
    super::sql_log::sql_log_clear();
    let bulk: Vec<_> = outcomes
        .iter()
        .filter(|o| o.name.starts_with("L8DB_BULK_"))
        .collect();
    assert_eq!(bulk.len(), 5, "{outcomes:?}");
    assert!(bulk.iter().all(|o| o.status == "VALID"), "{bulk:?}");
    eprintln!(
        "bulk compile: {} objects, {calls} database calls",
        outcomes.len()
    );
    assert!(
        calls <= 2 * outcomes.len() + 4,
        "{calls} calls for {} objects",
        outcomes.len()
    );
    for n in 1..=5 {
        db.execute_query(&format!("DROP PROCEDURE l8db_bulk_{n}"))
            .await
            .unwrap();
    }
    db.execute_query("DROP PROCEDURE l8db_bulk_dep")
        .await
        .unwrap();
    db.execute_query("DROP TABLE l8db_cmp_t").await.unwrap();
}
