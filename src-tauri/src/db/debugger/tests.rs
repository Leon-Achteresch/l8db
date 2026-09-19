use super::*;

async fn paused(url: &str, id: &str) -> Snapshot {
    tokio::time::timeout(Duration::from_secs(45), async {
        loop {
            let state = debug_snapshot(id.into(), url.into(), None)
                .await
                .expect("snapshot");
            if !matches!(state.status.as_str(), "starting" | "running") {
                assert_eq!(state.status, "paused", "{:?}", state.message);
                return state;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("debugger did not pause")
}

async fn settled(url: &str, id: &str) -> Snapshot {
    tokio::time::timeout(Duration::from_secs(45), async {
        loop {
            let state = debug_snapshot(id.into(), url.into(), None).await.unwrap();
            if !matches!(state.status.as_str(), "starting" | "running") {
                return state;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("debug command timed out")
}

#[tokio::test]
#[ignore]
async fn postgres_debugger_live_steps_breakpoints_variables_and_stop() {
    let url = std::env::var("L8DB_DEBUG_PG_URL").expect("L8DB_DEBUG_PG_URL required");
    let (config, ssl) = crate::db::connection::parse_connection(&url, None).unwrap();
    let client = crate::db::execution::connect_postgres(&config, ssl)
        .await
        .unwrap();
    client.batch_execute("CREATE OR REPLACE FUNCTION public.l8db_debug_test(n integer) RETURNS integer LANGUAGE plpgsql AS $body$\nDECLARE value integer := n;\nBEGIN\nvalue := value + 1;\nvalue := value * 2;\nRETURN value;\nEND;\n$body$;").await.unwrap();
    let oid: u32 = client
        .query_one(
            "SELECT 'public.l8db_debug_test(integer)'::regprocedure::oid",
            &[],
        )
        .await
        .unwrap()
        .get(0);
    assert!(
        debug_availability(DatabaseKind::Postgres, url.clone(), None)
            .await
            .unwrap()
            .available
    );
    let id = "postgres-live-debug-session";
    debug_launch(
        DatabaseKind::Postgres,
        url.clone(),
        None,
        Launch {
            id: id.into(),
            oid: oid.to_string(),
            sql: "SELECT public.l8db_debug_test(4)".into(),
            breakpoints: vec![],
        },
    )
    .await
    .unwrap();
    let first = paused(&url, id).await;
    assert!(!first.source.is_empty());
    assert!(first.frames.iter().any(|f| f.oid == oid.to_string()));
    debug_action(id.into(), url.clone(), None, Action::StepOver)
        .await
        .unwrap();
    let next = paused(&url, id).await;
    assert!(next.frames[0].line > first.frames[0].line);
    assert!(next.variables.iter().any(|v| v.name == "value"));
    debug_action(
        id.into(),
        url.clone(),
        None,
        Action::Watches {
            names: vec!["value".into(), "missing_variable".into()],
        },
    )
    .await
    .unwrap();
    let watched = paused(&url, id).await;
    assert!(watched.watches[0].error.is_none());
    assert!(watched.watches[1].error.is_some());
    debug_action(
        id.into(),
        url.clone(),
        None,
        Action::Breakpoints {
            breakpoints: vec![Breakpoint {
                oid: oid.to_string(),
                line: 6,
            }],
        },
    )
    .await
    .unwrap();
    paused(&url, id).await;
    debug_action(id.into(), url.clone(), None, Action::Continue)
        .await
        .unwrap();
    let breakpoint = paused(&url, id).await;
    assert_eq!(breakpoint.frames[0].line, 6);
    assert!(debug_snapshot(
        id.into(),
        "postgresql://other@localhost/postgres".into(),
        None
    )
    .await
    .is_err());
    debug_stop(id.into(), url.clone(), None).await.unwrap();
    assert!(debug_snapshot(id.into(), url.clone(), None).await.is_err());
    client
        .batch_execute("DROP FUNCTION public.l8db_debug_test(integer)")
        .await
        .unwrap();
}

#[tokio::test]
#[ignore]
async fn oracle_debugger_live_steps_variables_and_stop() {
    let url = std::env::var("L8DB_DEBUG_ORACLE_URL").expect("L8DB_DEBUG_ORACLE_URL required");
    let adapter = crate::db::oracle::OracleAdapter::new(
        &url,
        crate::db::pool::create_pool_state(),
        "debug-test".into(),
    )
    .unwrap();
    let conn = adapter
        .open_connection()
        .await
        .unwrap()
        .into_inner()
        .unwrap();
    tokio::task::spawn_blocking(move || {
        conn.execute("CREATE OR REPLACE PROCEDURE l8db_debug_test(n IN NUMBER) AS\nvalue NUMBER := n;\nBEGIN\nvalue := value + 1;\nvalue := value * 2;\nNULL;\nEND;", &[]).unwrap();
    }).await.unwrap();
    assert!(
        debug_availability(DatabaseKind::Oracle, url.clone(), None)
            .await
            .unwrap()
            .available
    );
    let id = "oracle-live-debug-session";
    debug_launch(
        DatabaseKind::Oracle,
        url.clone(),
        None,
        Launch {
            id: id.into(),
            oid: "L8DB_DEBUG\u{1f}L8DB_DEBUG_TEST\u{1f}PROCEDURE".into(),
            sql: "BEGIN l8db_debug_test(4); END;".into(),
            breakpoints: vec![],
        },
    )
    .await
    .unwrap();
    let first = paused(&url, id).await;
    assert!(!first.source.is_empty());
    let mut inside = false;
    for _ in 0..8 {
        debug_action(id.into(), url.clone(), None, Action::StepInto)
            .await
            .unwrap();
        let next = paused(&url, id).await;
        if next
            .variables
            .iter()
            .any(|v| v.name.eq_ignore_ascii_case("value"))
        {
            inside = true;
            break;
        }
    }
    assert!(inside, "routine variables should be visible");
    debug_action(
        id.into(),
        url.clone(),
        None,
        Action::Watches {
            names: vec!["value".into()],
        },
    )
    .await
    .unwrap();
    assert!(paused(&url, id).await.watches[0].error.is_none());
    debug_stop(id.into(), url.clone(), None).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn postgres_debugger_live_finish_rollback_error_and_running_cancel() {
    let url = std::env::var("L8DB_DEBUG_PG_URL").unwrap();
    let (config, ssl) = crate::db::connection::parse_connection(&url, None).unwrap();
    let client = crate::db::execution::connect_postgres(&config, ssl)
        .await
        .unwrap();
    client.batch_execute("CREATE TABLE IF NOT EXISTS public.l8db_debug_writes(value integer); CREATE OR REPLACE FUNCTION public.l8db_debug_write() RETURNS void LANGUAGE plpgsql AS $body$\nBEGIN\nINSERT INTO public.l8db_debug_writes VALUES (1);\nEND;\n$body$;").await.unwrap();
    let oid: u32 = client
        .query_one("SELECT 'public.l8db_debug_write()'::regprocedure::oid", &[])
        .await
        .unwrap()
        .get(0);
    for (id, sql, status) in [
        (
            "postgres-finish-session",
            "SELECT public.l8db_debug_write()",
            "finished",
        ),
        (
            "postgres-error-session",
            "SELECT public.l8db_debug_write(); SELECT 1/0",
            "error",
        ),
    ] {
        debug_launch(
            DatabaseKind::Postgres,
            url.clone(),
            None,
            Launch {
                id: id.into(),
                oid: oid.to_string(),
                sql: sql.into(),
                breakpoints: vec![],
            },
        )
        .await
        .unwrap();
        paused(&url, id).await;
        debug_action(id.into(), url.clone(), None, Action::Continue)
            .await
            .unwrap();
        let final_state = settled(&url, id).await;
        assert_eq!(final_state.status, status, "{:?}", final_state.message);
        debug_stop(id.into(), url.clone(), None).await.unwrap();
    }
    assert_eq!(
        client
            .query_one("SELECT count(*) FROM public.l8db_debug_writes", &[])
            .await
            .unwrap()
            .get::<_, i64>(0),
        0
    );
    client.batch_execute("CREATE OR REPLACE FUNCTION public.l8db_debug_sleep() RETURNS void LANGUAGE plpgsql AS $body$\nBEGIN\nPERFORM pg_sleep(60);\nEND;\n$body$;").await.unwrap();
    let oid: u32 = client
        .query_one("SELECT 'public.l8db_debug_sleep()'::regprocedure::oid", &[])
        .await
        .unwrap()
        .get(0);
    let id = "postgres-cancel-running-session";
    debug_launch(
        DatabaseKind::Postgres,
        url.clone(),
        None,
        Launch {
            id: id.into(),
            oid: oid.to_string(),
            sql: "SELECT public.l8db_debug_sleep()".into(),
            breakpoints: vec![],
        },
    )
    .await
    .unwrap();
    paused(&url, id).await;
    debug_action(id.into(), url.clone(), None, Action::Continue)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    tokio::time::timeout(
        Duration::from_secs(15),
        debug_stop(id.into(), url.clone(), None),
    )
    .await
    .expect("stop blocked on running query")
    .unwrap();
    client.batch_execute("DROP FUNCTION public.l8db_debug_write(); DROP FUNCTION public.l8db_debug_sleep(); DROP TABLE public.l8db_debug_writes").await.unwrap();
}

#[tokio::test]
#[ignore]
async fn oracle_debugger_live_package_breakpoint_finish() {
    let url = std::env::var("L8DB_DEBUG_ORACLE_URL").unwrap();
    let adapter = crate::db::oracle::OracleAdapter::new(
        &url,
        crate::db::pool::create_pool_state(),
        "debug-package".into(),
    )
    .unwrap();
    let conn = adapter
        .open_connection()
        .await
        .unwrap()
        .into_inner()
        .unwrap();
    tokio::task::spawn_blocking(move || {
        conn.execute("CREATE OR REPLACE PACKAGE l8db_debug_pkg AS FUNCTION calculate(n NUMBER) RETURN NUMBER; END;", &[]).unwrap();
        conn.execute("CREATE OR REPLACE PACKAGE BODY l8db_debug_pkg AS\nFUNCTION calculate(n NUMBER) RETURN NUMBER AS\nvalue NUMBER := n;\nBEGIN\nvalue := value + 1;\nRETURN value;\nEND;\nEND;", &[]).unwrap();
    }).await.unwrap();
    let id = "oracle-package-debug-session";
    let oid = "L8DB_DEBUG\u{1f}L8DB_DEBUG_PKG\u{1f}PACKAGE BODY";
    debug_launch(DatabaseKind::Oracle, url.clone(), None, Launch { id: id.into(), oid: oid.into(), sql: "DECLARE result_value NUMBER; BEGIN result_value := l8db_debug_pkg.calculate(8); END;".into(), breakpoints: vec![Breakpoint { oid: oid.into(), line: 5 }] }).await.unwrap();
    paused(&url, id).await;
    debug_action(id.into(), url.clone(), None, Action::Continue)
        .await
        .unwrap();
    let breakpoint = paused(&url, id).await;
    assert_eq!(breakpoint.frames[0].line, 5);
    assert!(breakpoint.source.contains("FUNCTION calculate"));
    debug_action(id.into(), url.clone(), None, Action::StepOver)
        .await
        .unwrap();
    let value = paused(&url, id).await;
    assert!(value
        .variables
        .iter()
        .any(|v| v.name.eq_ignore_ascii_case("value") && v.value.as_deref() == Some("9")));
    debug_action(id.into(), url.clone(), None, Action::Continue)
        .await
        .unwrap();
    let finished = settled(&url, id).await;
    assert_eq!(finished.status, "finished", "{:?}", finished.message);
    debug_stop(id.into(), url.clone(), None).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn postgres_debugger_live_nested_frames_and_step_out() {
    let url = std::env::var("L8DB_DEBUG_PG_URL").unwrap();
    let (config, ssl) = crate::db::connection::parse_connection(&url, None).unwrap();
    let client = crate::db::execution::connect_postgres(&config, ssl)
        .await
        .unwrap();
    client.batch_execute("CREATE OR REPLACE FUNCTION public.l8db_debug_child(n integer) RETURNS integer LANGUAGE plpgsql AS $body$\nBEGIN\nRETURN n + 1;\nEND;\n$body$; CREATE OR REPLACE FUNCTION public.l8db_debug_parent(n integer) RETURNS integer LANGUAGE plpgsql AS $body$\nDECLARE value integer;\nBEGIN\nvalue := public.l8db_debug_child(n);\nRETURN value;\nEND;\n$body$;").await.unwrap();
    let oid: u32 = client
        .query_one(
            "SELECT 'public.l8db_debug_parent(integer)'::regprocedure::oid",
            &[],
        )
        .await
        .unwrap()
        .get(0);
    let id = "postgres-nested-debug-session";
    debug_launch(
        DatabaseKind::Postgres,
        url.clone(),
        None,
        Launch {
            id: id.into(),
            oid: oid.to_string(),
            sql: "SELECT public.l8db_debug_parent(4)".into(),
            breakpoints: vec![],
        },
    )
    .await
    .unwrap();
    let mut state = paused(&url, id).await;
    for _ in 0..5 {
        if state.frames.len() > 1 {
            break;
        }
        debug_action(id.into(), url.clone(), None, Action::StepInto)
            .await
            .unwrap();
        state = paused(&url, id).await;
    }
    assert!(state.frames.len() > 1);
    let parent_frame = state
        .frames
        .iter()
        .find(|frame| frame.oid == oid.to_string())
        .unwrap()
        .id;
    debug_action(
        id.into(),
        url.clone(),
        None,
        Action::SelectFrame {
            frame: parent_frame,
        },
    )
    .await
    .unwrap();
    assert_eq!(paused(&url, id).await.selected_frame, parent_frame);
    debug_action(id.into(), url.clone(), None, Action::StepOut)
        .await
        .unwrap();
    let outer = paused(&url, id).await;
    assert_eq!(outer.frames.len(), 1);
    assert_eq!(outer.frames[0].oid, oid.to_string());
    debug_stop(id.into(), url.clone(), None).await.unwrap();
    client.batch_execute("DROP FUNCTION public.l8db_debug_parent(integer); DROP FUNCTION public.l8db_debug_child(integer)").await.unwrap();
}

#[tokio::test]
#[ignore]
async fn oracle_debugger_live_cancel_before_start_does_not_compile_or_execute() {
    let url = std::env::var("L8DB_DEBUG_ORACLE_URL").unwrap();
    let adapter = crate::db::oracle::OracleAdapter::new(
        &url,
        crate::db::pool::create_pool_state(),
        "debug-cancel".into(),
    )
    .unwrap();
    let conn = adapter
        .open_connection()
        .await
        .unwrap()
        .into_inner()
        .unwrap();
    let conn = tokio::task::spawn_blocking(move || {
        conn.execute(
            "CREATE OR REPLACE PROCEDURE l8db_debug_cancel AS BEGIN NULL; END;",
            &[],
        )
        .unwrap();
        conn.execute(
            "ALTER PROCEDURE l8db_debug_cancel COMPILE PLSQL_DEBUG=FALSE",
            &[],
        )
        .unwrap();
        conn
    })
    .await
    .unwrap();
    let id = "oracle-cancel-before-start-session";
    debug_launch(
        DatabaseKind::Oracle,
        url.clone(),
        None,
        Launch {
            id: id.into(),
            oid: "L8DB_DEBUG\u{1f}L8DB_DEBUG_CANCEL\u{1f}PROCEDURE".into(),
            sql: "BEGIN l8db_debug_cancel; END;".into(),
            breakpoints: vec![],
        },
    )
    .await
    .unwrap();
    debug_stop(id.into(), url.clone(), None).await.unwrap();
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(debug_snapshot(id.into(), url.clone(), None).await.is_err());
    tokio::task::spawn_blocking(move || {
        let debug: (String,) = conn.query_row_as("SELECT plsql_debug FROM user_plsql_object_settings WHERE name = 'L8DB_DEBUG_CANCEL' AND type = 'PROCEDURE'", &[]).unwrap();
        assert_eq!(debug.0, "FALSE");
        conn.execute("DROP PROCEDURE l8db_debug_cancel", &[]).unwrap();
    }).await.unwrap();
}
