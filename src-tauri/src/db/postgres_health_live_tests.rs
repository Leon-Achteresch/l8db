use std::time::Instant;

use super::*;
use crate::array_editor_target::{open_owned_fixture, owned_url};
use crate::db::pool::create_pool_state;

fn index_check(report: &HealthReport) -> &HealthCheckResult {
    report
        .checks
        .iter()
        .find(|check| check.id == UNUSED_INDEX_ID)
        .unwrap()
}

#[tokio::test]
#[ignore = "scripts/test-postgres-arrays-local.sh --index-observation-test creates a private PostgreSQL lab"]
async fn a25_index_check_reports_real_database_reset_without_changing_candidates() {
    let (adapter, _, database) = open_owned_fixture().await.unwrap();
    adapter
        .execute_query(
            "CREATE SCHEMA a25;
             CREATE TABLE a25.items (
                code text PRIMARY KEY,
                lookup text NOT NULL,
                period int8range,
                CONSTRAINT items_period_guard EXCLUDE USING gist (period WITH &&)
             );
             INSERT INTO a25.items
             SELECT repeat(md5(i::text), 3),
                    repeat(md5((i+65000)::text), 3),
                    int8range(2*i, 2*i+1)
             FROM generate_series(1,65000) AS source(i);
             CREATE INDEX items_lookup ON a25.items (lookup);
             CREATE TABLE a25.small (value integer);
             CREATE INDEX small_value ON a25.small (value);",
        )
        .await
        .unwrap();

    let before = run_health_checks(adapter.as_ref()).await;
    let check = index_check(&before);
    let observation = check.index_observation.as_ref().unwrap();
    assert_eq!(observation.database_stats_reset_at, None);
    assert_eq!(observation.tracks_counts, Some(true));
    assert_eq!(check.status, CheckStatus::Issue);
    assert_eq!(check.objects.len(), 1);
    assert_eq!(check.objects[0].name, "a25.items_lookup");
    assert!(check.objects[0]
        .detail
        .as_deref()
        .unwrap()
        .ends_with("0 gemeldete Scans"));
    assert_eq!(
        check.fix_sql.as_deref(),
        Some("DROP INDEX CONCURRENTLY a25.items_lookup;")
    );
    adapter
        .execute_query("SELECT pg_stat_reset()")
        .await
        .unwrap();
    let excluded = adapter
        .execute_query(
            "SELECT count(*)::text AS protected FROM pg_stat_user_indexes s
             JOIN pg_index i ON i.indexrelid = s.indexrelid
             WHERE s.schemaname = 'a25' AND s.indexrelname = 'items_period_guard'
             AND s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary AND i.indisvalid
             AND pg_relation_size(s.indexrelid) > 2097152",
        )
        .await
        .unwrap();
    assert_eq!(excluded.rows[0]["protected"], "1");

    let expected = adapter.execute_query(INDEX_OBSERVATION_SQL).await.unwrap();
    let expected = expected.rows[0]["database_stats_reset_at"]
        .as_str()
        .unwrap();
    assert!(expected.ends_with('Z'));
    let report = run_health_checks(adapter.as_ref()).await;
    let check = index_check(&report);
    assert_eq!(check.objects, index_check(&before).objects);
    assert_eq!(
        check
            .index_observation
            .as_ref()
            .unwrap()
            .database_stats_reset_at
            .as_deref(),
        Some(expected)
    );
    assert_eq!(
        serde_json::to_value(check).unwrap()["indexObservation"]["databaseStatsResetAt"],
        expected
    );
    assert!(report
        .checks
        .iter()
        .filter(|check| check.id != UNUSED_INDEX_ID)
        .all(|check| check.index_observation.is_none()));

    adapter
        .execute_query("SELECT pg_stat_reset_single_table_counters('a25.items_lookup'::regclass)")
        .await
        .unwrap();
    let reset = read_index_observation(adapter.as_ref()).await;
    let after_single_reset = reset.database_stats_reset_at.as_deref().unwrap();
    println!(
        "A25 object reset changed the database statistics timestamp: {}",
        after_single_reset != expected
    );

    let url = owned_url(&std::env::var("L8DB_A01_LOCAL_PG_URL").unwrap(), &database).unwrap();
    let tracking_off_url = format!("{url}&options=-c%20track_counts%3Doff");
    let tracking_off = create_adapter_from_string(
        DatabaseKind::Postgres,
        &tracking_off_url,
        None,
        create_pool_state(),
    )
    .unwrap();
    let check_spec = checks()
        .into_iter()
        .find(|check| check.id == UNUSED_INDEX_ID)
        .unwrap();
    let tracking_off = run_check(tracking_off.as_ref(), &check_spec).await;
    let observation = tracking_off.index_observation.unwrap();
    assert_eq!(observation.tracks_counts, Some(false));
    assert_eq!(
        observation.database_stats_reset_at.as_deref(),
        Some(after_single_reset)
    );

    let mut plain = Vec::with_capacity(10);
    let mut enriched = Vec::with_capacity(10);
    for _ in 0..10 {
        let started = Instant::now();
        assert_eq!(
            adapter
                .execute_query(UNUSED_INDEX_SQL)
                .await
                .unwrap()
                .rows
                .len(),
            1
        );
        plain.push(started.elapsed().as_secs_f64() * 1000.0);
        let started = Instant::now();
        assert_eq!(
            run_check(adapter.as_ref(), &check_spec).await.objects.len(),
            1
        );
        enriched.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    plain.sort_by(f64::total_cmp);
    enriched.sort_by(f64::total_cmp);
    assert!(enriched[9] < 150.0);
    println!(
        "A25 live index check, baseline median {:.3} ms/p95 {:.3} ms, enriched median {:.3} ms/p95 {:.3} ms, 1 additional metadata read",
        plain[5], plain[9], enriched[5], enriched[9]
    );

    adapter
        .execute_query(
            "CREATE ROLE a25_observer;
             GRANT USAGE ON SCHEMA a25 TO a25_observer;
             GRANT SELECT ON ALL TABLES IN SCHEMA a25 TO a25_observer;
             REVOKE SELECT ON pg_catalog.pg_stat_database FROM PUBLIC;",
        )
        .await
        .unwrap();
    let denied_url = format!("{url}&options=-c%20role%3Da25_observer");
    let denied = create_adapter_from_string(
        DatabaseKind::Postgres,
        &denied_url,
        None,
        create_pool_state(),
    )
    .unwrap();
    assert!(denied.execute_query(INDEX_OBSERVATION_SQL).await.is_err());
    let available_candidates = run_check(denied.as_ref(), &check_spec).await;
    assert_eq!(available_candidates.status, CheckStatus::Issue);
    assert_eq!(available_candidates.objects, check.objects);
    let unknown = available_candidates.index_observation.unwrap();
    assert_eq!(unknown.database_stats_reset_at, None);
    assert_eq!(unknown.tracks_counts, None);
}
