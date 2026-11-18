use super::*;
use crate::db::http_api::mock;
use std::time::Instant;

#[tokio::test]
async fn header_context_uses_one_qualified_request_and_tolerates_missing_engine() {
    for engine in [None, Some("ReplacingMergeTree")] {
        let (host, log) = mock::serve(move |request| {
            assert_eq!(request.method, "POST");
            assert!(request.body.contains(
                "FROM system.tables WHERE database = 'analytics' AND name = 'shared' AND NOT is_temporary"
            ));
            assert!(request.body.contains(
                "FROM system.columns WHERE database = 'analytics' AND table = 'shared' ORDER BY position"
            ));
            let mut body = "[\"name\",\"type\",\"default_expression\",\"is_in_primary_key\",\"position\",\"comment\"".to_string();
            if engine.is_some() {
                body.push_str(",\"relation_engine\"");
            }
            body.push_str("]\n[\"String\",\"String\",\"String\",\"UInt8\",\"UInt64\",\"String\"");
            if engine.is_some() {
                body.push_str(",\"String\"");
            }
            body.push_str("]\n[\"id\",\"UInt64\",\"\",1,1,\"fixture\"");
            if let Some(engine) = engine {
                body.push_str(&format!(",\"{engine}\""));
            }
            body.push_str("]\n");
            (200, body)
        })
        .await;
        let adapter =
            ClickhouseAdapter::new(&format!("clickhouse://{host}/default"), None).unwrap();
        let result = adapter
            .describe_table_columns("analytics", "shared")
            .await
            .unwrap();
        assert_eq!(result.clickhouse_engine.as_deref(), engine);
        assert_eq!(result.columns[0].column.name, "id");
        assert_eq!(result.columns[0].column.comment.as_deref(), Some("fixture"));
        assert!(result.columns[0].column.is_primary_key);
        assert_eq!(log.lock().unwrap().len(), 1);
        assert_eq!(
            serde_json::to_value(result)
                .unwrap()
                .get("clickhouse_engine")
                .is_some(),
            engine.is_some()
        );
    }
}

#[tokio::test]
#[ignore = "run with scripts/test-clickhouse-merge-context-local.sh"]
async fn local_clickhouse_reads_engine_and_preserves_preview_and_count() {
    let dsn = std::env::var("L8DB_A46_LOCAL_CLICKHOUSE_URL").expect("isolated fixture URL");
    let url = url::Url::parse(&dsn).expect("valid fixture URL");
    assert_eq!(url.scheme(), "clickhouse");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert!(url.port().is_some());
    assert_eq!(url.username(), "a46");
    let database = url.path().trim_start_matches('/');
    let nonce = database.strip_prefix("l8db_a46_").expect("fixture prefix");
    assert!(nonce.len() == 12 && nonce.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert_eq!(url.password(), Some(format!("a46_{nonce}").as_str()));
    assert!(url.query().is_none());
    let adapter = ClickhouseAdapter::new(&dsn, None).unwrap();
    let identity = adapter
        .rows("SELECT hostName(), currentDatabase(), version()")
        .await
        .unwrap();
    assert_eq!(text(&identity[0][0]), format!("l8db-a46-{nonce}"));
    assert_eq!(text(&identity[0][1]), database);
    let version = text(&identity[0][2]);
    let other_name = format!("{database}_other");
    let other = quote(&other_name);
    let target = quote(database);
    for sql in [
        format!("CREATE DATABASE {other}"),
        format!("CREATE TABLE {other}.events (id UInt64) ENGINE = MergeTree ORDER BY id"),
        format!("CREATE TABLE {target}.events (id UInt64, version UInt64, label Nullable(String) DEFAULT NULL COMMENT 'display') ENGINE = ReplacingMergeTree(version) ORDER BY id"),
        format!("CREATE TABLE {target}.collapse (id UInt64, sign Int8) ENGINE = CollapsingMergeTree(sign) ORDER BY id"),
        format!("CREATE TABLE {target}.versioned (id UInt64, sign Int8, version UInt64) ENGINE = VersionedCollapsingMergeTree(sign, version) ORDER BY id"),
        format!("CREATE TABLE {target}.totals (id UInt64, amount Int64) ENGINE = SummingMergeTree(amount) ORDER BY id"),
        format!("CREATE TABLE {target}.aggregates (id UInt64, amount AggregateFunction(sum, UInt64)) ENGINE = AggregatingMergeTree ORDER BY id"),
        format!("INSERT INTO {target}.events SETTINGS optimize_on_insert = 0 VALUES (1, 1, 'older'), (1, 2, 'newer')"),
        format!("INSERT INTO {target}.collapse SETTINGS optimize_on_insert = 0 VALUES (1, 1), (1, -1)"),
    ] {
        adapter.exec(&sql).await.unwrap_or_else(|error| panic!("{sql}: {error}"));
    }
    for (schema, table, engine) in [
        (database, "events", "ReplacingMergeTree"),
        (&other_name, "events", "MergeTree"),
        (database, "collapse", "CollapsingMergeTree"),
        (database, "versioned", "VersionedCollapsingMergeTree"),
        (database, "totals", "SummingMergeTree"),
        (database, "aggregates", "AggregatingMergeTree"),
    ] {
        let result = adapter.describe_table_columns(schema, table).await.unwrap();
        assert_eq!(
            result.clickhouse_engine.as_deref(),
            Some(engine),
            "{schema}.{table}"
        );
        let legacy = adapter
            .list_table_columns_detailed(schema, table)
            .await
            .unwrap();
        let columns = result
            .columns
            .iter()
            .map(|column| &column.column)
            .collect::<Vec<_>>();
        assert_eq!(
            serde_json::to_value(columns).unwrap(),
            serde_json::to_value(legacy).unwrap()
        );
    }
    let missing = adapter
        .describe_table_columns(database, "does_not_exist")
        .await
        .unwrap();
    assert!(missing.columns.is_empty());
    assert_eq!(missing.clickhouse_engine, None);

    for (table, logical_count) in [("events", 1), ("collapse", 0)] {
        let preview = adapter
            .fetch_rows(database, table, None, 10, 0, None, false, false, false)
            .await
            .unwrap();
        assert_eq!(preview.rows.len(), 2);
        assert_eq!(
            adapter
                .count_rows(database, table, None, false)
                .await
                .unwrap(),
            2
        );
        let comparison = adapter
            .rows(&format!(
                "SELECT count() FROM {target}.{} FINAL",
                quote(table)
            ))
            .await
            .unwrap();
        assert_eq!(int(&comparison[0][0]), logical_count);
    }

    let extra_columns = (0..249)
        .map(|index| format!("c{index} UInt64"))
        .collect::<Vec<_>>()
        .join(", ");
    adapter.exec(&format!("CREATE TABLE {target}.wide (id UInt64, {extra_columns}) ENGINE = ReplacingMergeTree ORDER BY id")).await.unwrap();
    let mut elapsed = Vec::new();
    for _ in 0..10 {
        let start = Instant::now();
        let result = adapter
            .describe_table_columns(database, "wide")
            .await
            .unwrap();
        elapsed.push(start.elapsed().as_secs_f64() * 1_000.0);
        assert_eq!(result.columns.len(), 250);
        assert_eq!(
            result.clickhouse_engine.as_deref(),
            Some("ReplacingMergeTree")
        );
    }
    elapsed.sort_by(f64::total_cmp);
    let median = (elapsed[4] + elapsed[5]) / 2.0;
    let p95 = elapsed[9];
    assert!(p95 < 250.0, "{elapsed:?}");
    println!("ClickHouse {version}, 250 columns, 10 context metadata requests: median {median:.3} ms, p95 {p95:.3} ms");
}
