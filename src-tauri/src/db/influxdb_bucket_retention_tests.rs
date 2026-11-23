use super::*;
use crate::db::http_api::mock;
use std::time::Instant;

const OSS_V2: &str = "x-influxdb-build: OSS\r\nx-influxdb-version: v2.7.12\r\n";

fn rule(seconds: Value) -> Value {
    json!({"type": "expire", "everySeconds": seconds})
}

fn bucket(name: &str, id: &str, org: &str, rules: Value) -> Value {
    json!({"name": name, "id": id, "orgID": org, "retentionRules": rules})
}

#[tokio::test]
async fn catalog_reuses_one_scoped_read_and_keeps_rule_values_exact() {
    let (host, log) = mock::serve_with_headers(OSS_V2, |request| {
        let (org, id, seconds) = match request.path.as_str() {
            "/api/v2/buckets?limit=100&org=Team+A" => ("org-a", "bucket-a", 604_801),
            "/api/v2/buckets?limit=100&orgID=org-b" => ("org-b", "bucket-b", 0),
            _ => panic!("Unexpected path {}", request.path),
        };
        assert_eq!(request.method, "GET");
        assert_eq!(request.header("authorization"), Some("Token synthetic"));
        (
            200,
            json!({"buckets":[bucket("metrics", id, org, json!([rule(json!(seconds))]))]})
                .to_string(),
        )
    })
    .await;
    for (selector, org, id, seconds) in [
        ("org=Team+A", "org-a", "bucket-a", 604_801),
        ("orgID=org-b", "org-b", "bucket-b", 0),
    ] {
        let adapter = InfluxAdapter::new(
            &format!("influxdb://{host}/metrics?version=2&token=synthetic&{selector}"),
            None,
        )
        .unwrap();
        let read = adapter.database_catalog().await.unwrap();
        assert_eq!(read.databases, ["metrics"]);
        let info = &read.bucket_retention["metrics"];
        assert_eq!(
            (&*info.org_id, &*info.bucket_id, info.seconds),
            (org, id, seconds)
        );
    }
    assert_eq!(log.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn catalog_omits_unproven_rules_and_ambiguous_contexts() {
    let mut rows = vec![
        bucket("known", "known-id", "org-a", json!([rule(json!(42))])),
        bucket("empty", "empty-id", "org-a", json!([])),
        bucket(
            "multiple",
            "multi-id",
            "org-a",
            json!([rule(json!(0)), rule(json!(100))]),
        ),
        bucket(
            "unknown",
            "unknown-id",
            "org-a",
            json!([{"type":"custom","everySeconds":0}]),
        ),
        bucket("invalid", "invalid-id", "org-a", json!([rule(json!("0"))])),
        bucket("negative", "negative-id", "org-a", json!([rule(json!(-1))])),
        bucket(
            "too-wide",
            "too-wide-id",
            "org-a",
            json!([rule(json!(9_007_199_254_740_992u64))]),
        ),
        bucket("wrong-org", "wrong-id", "org-b", json!([rule(json!(42))])),
        bucket("no-id", "", "org-a", json!([rule(json!(42))])),
        bucket(
            "duplicate",
            "duplicate-id",
            "org-a",
            json!([rule(json!(0))]),
        ),
        bucket(
            "duplicate",
            "someone-else",
            "org-b",
            json!([rule(json!(30))]),
        ),
        json!({"name": "missing", "id": "missing-id", "orgID": "org-a"}),
        json!({"name": "no-org", "id": "orphan", "retentionRules": [rule(json!(1))]}),
        json!({"id": "bad-name"}),
    ];
    rows.push(bucket(
        "fractional",
        "fractional-id",
        "org-a",
        json!([rule(json!(1.5))]),
    ));
    let (host, log) =
        mock::serve_with_headers(OSS_V2, move |_| (200, json!({"buckets":rows}).to_string())).await;
    for (filter, known) in [
        ("&orgID=org-a", true),
        ("&org=ambiguous", false),
        ("", false),
    ] {
        let adapter =
            InfluxAdapter::new(&format!("influxdb://{host}/known?version=2{filter}"), None)
                .unwrap();
        let result = adapter.database_catalog().await.unwrap();
        assert_eq!(
            result
                .databases
                .iter()
                .filter(|name| *name == "duplicate")
                .count(),
            1
        );
        assert_eq!(result.databases.len(), 13);
        let matched = result
            .bucket_retention
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        assert_eq!(matched, if known { vec!["known"] } else { vec![] });
    }
    assert_eq!(log.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn legacy_unknown_and_failed_responses_keep_their_existing_read_path() {
    for headers in [
        "",
        "x-influxdb-build: OSS\r\nx-influxdb-version: 1.12.2\r\n",
        "x-influxdb-build: Cloud\r\nx-influxdb-version: v2.7.12\r\n",
    ] {
        let (host, log) = mock::serve_with_headers(headers, |_| {
            (
                200,
                json!({"buckets":[bucket("metrics", "old", "org", json!([rule(json!(0))]))]})
                    .to_string(),
            )
        })
        .await;
        let adapter =
            InfluxAdapter::new(&format!("influxdb://{host}?version=2&org=team"), None).unwrap();
        let catalog = adapter.database_catalog().await.unwrap();
        assert_eq!(catalog.databases, ["metrics"]);
        assert!(catalog.bucket_retention.is_empty());
        assert_eq!(adapter.list_databases().await.unwrap(), ["metrics"]);
        let requests = log.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[1].path, "/api/v2/buckets?limit=100");
    }
    let (host, log) = mock::serve(|request| {
        assert_eq!(request.path, "/api/v3/configure/database?format=json");
        (200, r#"[{"name":"metrics","retention_period":0}]"#.into())
    })
    .await;
    let adapter = InfluxAdapter::new(&format!("influxdb://{host}?version=3"), None).unwrap();
    let result = adapter.database_catalog().await.unwrap();
    assert_eq!(result.databases, ["metrics"]);
    assert!(result.bucket_retention.is_empty());
    assert_eq!(log.lock().unwrap().len(), 1);

    for (status, body) in [(200, "{bad"), (403, r#"{"message":"denied"}"#)] {
        let (host, log) = mock::serve_with_headers(OSS_V2, move |_| (status, body.into())).await;
        let adapter =
            InfluxAdapter::new(&format!("influxdb://{host}?version=2&org=team"), None).unwrap();
        match adapter.database_catalog().await {
            Ok(result) => assert!(
                status == 200 && result.databases.is_empty() && result.bucket_retention.is_empty()
            ),
            Err(error) => assert!(status == 403 && error.contains("403"), "{error}"),
        }
        assert_eq!(log.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn full_bucket_page_has_one_bounded_catalog_read_per_refresh() {
    let body = json!({"buckets":(0..100).map(|index|
        bucket(&format!("metrics-{index}"), &format!("id-{index}"), "org-a", json!([rule(json!(86_400))]))
    ).collect::<Vec<_>>()}).to_string();
    let (host, log) = mock::serve_with_headers(OSS_V2, move |_| (200, body.clone())).await;
    let adapter =
        InfluxAdapter::new(&format!("influxdb://{host}?version=2&org=team"), None).unwrap();
    let mut elapsed = Vec::new();
    for _ in 0..10 {
        let start = Instant::now();
        let result = adapter.database_catalog().await.unwrap();
        elapsed.push(start.elapsed().as_secs_f64() * 1_000.0);
        assert_eq!(result.databases.len(), 100);
        assert_eq!(result.bucket_retention.len(), 100);
    }
    elapsed.sort_by(f64::total_cmp);
    let median = (elapsed[4] + elapsed[5]) / 2.0;
    let p95 = elapsed[9];
    assert!(p95 < 250.0, "{elapsed:?}");
    assert_eq!(log.lock().unwrap().len(), 10);
    println!("A45 capped page: 100 buckets, 10 reads, median {median:.3} ms, p95 {p95:.3} ms");
}
