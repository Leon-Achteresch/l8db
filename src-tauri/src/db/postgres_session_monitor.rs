use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;
use tokio_postgres::{error::SqlState, Row};

use super::{is_cockroach, map_pg_err, PostgresAdapter, COCKROACH_SESSIONS_SQL};
use crate::db::{IndexBuildProgress, IndexPhaseCounter, IndexProgressUnit, SessionInfo};

macro_rules! sessions_sql {
    ($columns:literal, $join:literal) => {
        concat!(
            "SELECT a.pid, a.usename, a.datname, COALESCE(a.application_name, ''), \
                    a.client_addr::text, a.state, COALESCE(left(a.query, 4000), ''), \
                    a.query_start::text, a.xact_start::text, a.wait_event, \
                    a.pid = pg_backend_pid(), pg_blocking_pids(a.pid), a.client_port, \
                    a.backend_start::text, a.state_change::text, a.backend_xid::text, \
                    a.wait_event_type, a.backend_type",
            $columns,
            " FROM pg_catalog.pg_stat_activity a ",
            $join,
            " WHERE a.datname IS NOT NULL ORDER BY a.query_start NULLS LAST",
        )
    };
}

const SESSIONS_SQL: &str = sessions_sql!("", "");
const SESSIONS_WITH_PROGRESS_SQL: &str = sessions_sql!(
    ", CASE WHEN p.pid IS NOT NULL THEN to_jsonb(p) END AS index_progress",
    "LEFT JOIN pg_catalog.pg_stat_progress_create_index p \
       ON p.pid = a.pid AND p.datid = a.datid AND a.state = 'active'"
);

fn unavailable(code: &SqlState) -> bool {
    matches!(
        *code,
        SqlState::UNDEFINED_TABLE
            | SqlState::UNDEFINED_COLUMN
            | SqlState::UNDEFINED_FUNCTION
            | SqlState::INSUFFICIENT_PRIVILEGE
            | SqlState::FEATURE_NOT_SUPPORTED
    )
}

pub(super) async fn list_sessions(adapter: &PostgresAdapter) -> Result<Vec<SessionInfo>, String> {
    let conn = adapter.get_meta().await?;
    adapter
        .timed(conn.cancel_token(), async {
            let availability = if adapter.pool_key.is_empty() {
                None
            } else {
                adapter
                    .pool_state
                    .shared(
                        &format!("{}#pg-index-progress", adapter.pool_key),
                        || async { Ok(AtomicBool::new(true)) },
                    )
                    .await
                    .ok()
            };
            if let Some(available) = availability.filter(|value| value.load(Ordering::Relaxed)) {
                match conn.query(SESSIONS_WITH_PROGRESS_SQL, &[]).await {
                    Ok(rows) => return Ok(rows.into_iter().map(decode_session).collect()),
                    Err(error) if error.code().is_some_and(unavailable) => {
                        available.store(false, Ordering::Relaxed);
                    }
                    Err(error) => return Err(map_pg_err(error)),
                }
            }

            let rows = match conn.query(SESSIONS_SQL, &[]).await {
                Err(_) if is_cockroach(&conn).await => {
                    conn.query(COCKROACH_SESSIONS_SQL, &[]).await
                }
                rows => rows,
            };
            rows.map_err(map_pg_err)
                .map(|rows| rows.into_iter().map(decode_session).collect())
        })
        .await
}

fn decode_session(row: Row) -> SessionInfo {
    let index_progress = row.columns().get(18).and_then(|_| {
        let value = row.try_get::<_, Option<Value>>(18).ok().flatten()?;
        decode_progress(&value)
    });
    SessionInfo {
        pid: row.get(0),
        user: row.get(1),
        database: row.get(2),
        application: row.get(3),
        client_addr: row.get(4),
        state: row.get(5),
        query: row.get(6),
        query_start: row.get(7),
        transaction_start: row.get(8),
        wait_event: row.get(9),
        is_self: row.get(10),
        blocked_by: row.get(11),
        client_port: row.get(12),
        backend_start: row.get(13),
        state_change: row.get(14),
        backend_xid: row.get(15),
        wait_event_type: row.get(16),
        backend_type: row.get(17),
        index_progress,
    }
}

fn decode_progress(value: &Value) -> Option<IndexBuildProgress> {
    let phase = value["phase"].as_str().filter(|phase| !phase.is_empty())?;
    let command = value["command"].as_str().map(str::to_owned);
    let mut counters = Vec::new();
    let mut push_counter = |unit, done: &str, total: &str| {
        let Some(done) = value[done].as_i64().filter(|done| *done >= 0) else {
            return;
        };
        let total = value[total].as_i64().filter(|total| *total > 0);
        if let Some(total) = total {
            if done > total {
                return;
            }
        } else if done == 0 {
            return;
        }
        counters.push(IndexPhaseCounter {
            unit,
            done: done.to_string(),
            total: total.map(|total| total.to_string()),
        });
    };
    match phase {
        "waiting for writers before build"
        | "waiting for writers before validation"
        | "waiting for old snapshots"
        | "waiting for readers before marking dead"
        | "waiting for readers before dropping" => {
            push_counter(IndexProgressUnit::Lockers, "lockers_done", "lockers_total");
        }
        "index validation: scanning index" | "index validation: scanning table" => {
            push_counter(IndexProgressUnit::Blocks, "blocks_done", "blocks_total");
        }
        phase if phase == "building index" || phase.starts_with("building index: ") => {
            push_counter(IndexProgressUnit::Blocks, "blocks_done", "blocks_total");
            push_counter(IndexProgressUnit::Tuples, "tuples_done", "tuples_total");
        }
        _ => {}
    }
    Some(IndexBuildProgress {
        phase: phase.to_owned(),
        command,
        counters,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn index_progress_uses_only_counters_for_the_present_phase() {
        let mut snapshot = json!({
            "phase": "waiting for writers before validation",
            "command": "CREATE INDEX CONCURRENTLY",
            "lockers_done": 0,
            "lockers_total": 2,
            "blocks_done": 20,
            "blocks_total": 20,
            "tuples_done": 80,
            "tuples_total": 80
        });
        for (phase, expected) in [
            (
                "waiting for writers before validation",
                json!([{"unit":"lockers","done":"0","total":"2"}]),
            ),
            (
                "building index: loading tuples in tree",
                json!([
                    {"unit":"blocks","done":"20","total":"20"},
                    {"unit":"tuples","done":"80","total":"80"}
                ]),
            ),
            (
                "index validation: scanning index",
                json!([{"unit":"blocks","done":"20","total":"20"}]),
            ),
            ("index validation: sorting tuples", json!([])),
            ("future phase", json!([])),
        ] {
            snapshot["phase"] = json!(phase);
            let progress = serde_json::to_value(decode_progress(&snapshot)).unwrap();
            assert_eq!(progress["phase"], phase);
            assert_eq!(progress["counters"], expected);
        }
    }

    #[test]
    fn index_progress_preserves_visible_phase_with_missing_or_unknown_fields() {
        let value = json!({
            "phase": "building index",
            "blocks_done": 9007199254740993_i64,
            "blocks_total": null,
            "tuples_done": 0,
            "tuples_total": "unknown",
            "new_field": {}
        });
        let progress = serde_json::to_value(decode_progress(&value)).unwrap();
        assert_eq!(
            progress,
            json!({
                "phase":"building index",
                "counters":[{"unit":"blocks","done":"9007199254740993"}]
            })
        );
        assert!(decode_progress(&json!({"phase":null,"blocks_total":10})).is_none());
        assert!(decode_progress(&Value::Null).is_none());
        assert!(serde_json::to_value(SessionInfo::default())
            .unwrap()
            .get("index_progress")
            .is_none());
    }

    #[test]
    fn index_progress_fallback_leaves_cancellation_and_connection_errors_visible() {
        assert!(unavailable(&SqlState::UNDEFINED_TABLE));
        assert!(unavailable(&SqlState::INSUFFICIENT_PRIVILEGE));
        assert!(!unavailable(&SqlState::QUERY_CANCELED));
        assert!(!unavailable(&SqlState::CONNECTION_FAILURE));
    }
}

#[cfg(all(test, debug_assertions))]
#[path = "postgres_index_progress_live_tests.rs"]
mod live_tests;
