use super::*;
use serde_json::json;
use std::time::Instant;

#[test]
fn explicit_debug_entry_and_window_only() {
    assert!(selected(&["--array-editor-development".into()]));
    assert!(!selected(&[]));
    assert!(!selected(&[
        "--array-editor-development".into(),
        "--mcp".into()
    ]));
    assert!(!selected(&[
        "--array-editor-development".into(),
        "--csv-check-development".into()
    ]));
    assert_eq!(
        development_url("http://127.0.0.1:54321/other?foreign=1#x")
            .unwrap()
            .as_str(),
        "http://127.0.0.1:54321/?array-editor-development=1"
    );
    for candidate in [
        "https://127.0.0.1:1234",
        "http://localhost:1234",
        "http://external.invalid:1234",
        "http://user@127.0.0.1:1234",
        "http://127.0.0.1",
    ] {
        assert!(development_url(candidate).is_err());
    }
    assert!(window_allowed(LABEL).is_ok());
    assert!(window_allowed("main").is_err());
    assert!(window_allowed("csv-check-development").is_err());
}

async fn change(fixture: &Fixture, column: &str, value: Option<&str>) -> Result<(), String> {
    let before = fixture.read().await?;
    fixture
        .write(
            DatabaseKind::Postgres,
            &fixture.token,
            None,
            SCHEMA,
            TABLE,
            before.data.rows[0]["__ctid__"].as_str().unwrap(),
            &HashMap::from([(column.to_owned(), value.map(str::to_owned))]),
        )
        .await
}

#[tokio::test]
#[ignore]
async fn isolated_fixture_editor_contract() {
    let fixture = Fixture::open().await.unwrap();
    let metadata = fixture
        .adapter
        .list_table_columns_detailed(SCHEMA, TABLE)
        .await
        .unwrap();
    assert!(metadata
        .iter()
        .any(|column| column.name == "items" && column.data_type == "text[]"));
    assert!(metadata
        .iter()
        .any(|column| column.name == "nums" && column.data_type == "numeric[]"));
    let initial = serde_json::to_value(fixture.read().await.unwrap()).unwrap();
    assert!(initial["data"]["rows"][0]["null_items"].is_null());
    assert_eq!(initial["data"]["rows"][0]["empty_items"], json!([]));
    assert_eq!(initial["details"]["items_bounds"], "[-2:-1][5:6]");
    assert_eq!(
        initial["data"]["rows"][0]["nums"],
        "[9007199254740993.1234500,0.1234567890123456789000]"
    );
    let ctid = initial["data"]["rows"][0]["__ctid__"].as_str().unwrap();
    let updates = HashMap::from([("items".into(), Some("[]".into()))]);
    for (kind, token, database, schema, table, id, values) in [
        (
            DatabaseKind::Sqlite,
            fixture.token.as_str(),
            None,
            SCHEMA,
            TABLE,
            ctid,
            updates.clone(),
        ),
        (
            DatabaseKind::Postgres,
            "postgresql://outside",
            None,
            SCHEMA,
            TABLE,
            ctid,
            updates.clone(),
        ),
        (
            DatabaseKind::Postgres,
            fixture.token.as_str(),
            Some("other"),
            SCHEMA,
            TABLE,
            ctid,
            updates.clone(),
        ),
        (
            DatabaseKind::Postgres,
            fixture.token.as_str(),
            None,
            "public",
            TABLE,
            ctid,
            updates.clone(),
        ),
        (
            DatabaseKind::Postgres,
            fixture.token.as_str(),
            None,
            SCHEMA,
            "other",
            ctid,
            updates.clone(),
        ),
        (
            DatabaseKind::Postgres,
            fixture.token.as_str(),
            None,
            SCHEMA,
            TABLE,
            ctid,
            HashMap::from([("id".into(), Some("2".into()))]),
        ),
        (
            DatabaseKind::Postgres,
            fixture.token.as_str(),
            None,
            SCHEMA,
            TABLE,
            "(999,1)",
            updates.clone(),
        ),
        (
            DatabaseKind::Postgres,
            fixture.token.as_str(),
            None,
            SCHEMA,
            TABLE,
            ctid,
            HashMap::from([("items".into(), Some("x".repeat(512 * 1024 + 1)))]),
        ),
    ] {
        assert!(fixture
            .write(kind, token, database, schema, table, id, &values)
            .await
            .is_err());
    }
    {
        let _busy = fixture.gate.lock().await;
        assert!(fixture.read().await.is_err());
        assert!(fixture
            .write(
                DatabaseKind::Postgres,
                &fixture.token,
                None,
                SCHEMA,
                TABLE,
                ctid,
                &updates
            )
            .await
            .is_err());
    }
    for invalid in [r#"[["x"],["y","z"]]"#, r#"["unfinished"#, r#"[["x"],[]]"#] {
        assert!(change(&fixture, "items", Some(invalid)).await.is_err());
    }
    assert_eq!(
        serde_json::to_value(fixture.read().await.unwrap()).unwrap(),
        initial
    );
    let text = r#"[["雪 O'Reilly",null],["say\"hi","a\\b"]]"#;
    change(&fixture, "items", Some(text)).await.unwrap();
    let edited = fixture.read().await.unwrap();
    assert_eq!(
        edited.data.rows[0]["items"],
        serde_json::from_str::<serde_json::Value>(text).unwrap()
    );
    assert_eq!(edited.details["items_bounds"], "[-2:-1][5:6]");
    let exact = "[9007199254740995.1234500,0.1234567890123456789001,null]";
    change(&fixture, "nums", Some(exact)).await.unwrap();
    let precise = fixture.read().await.unwrap();
    assert_eq!(precise.data.rows[0]["nums"], exact);
    assert_eq!(precise.details["nums_bounds"], "[0:2]");
    change(&fixture, "null_items", Some("[]")).await.unwrap();
    assert_eq!(
        fixture.read().await.unwrap().data.rows[0]["null_items"],
        json!([])
    );
    change(&fixture, "empty_items", None).await.unwrap();
    assert!(fixture.read().await.unwrap().data.rows[0]["empty_items"].is_null());
    let cancelled = serde_json::to_value(fixture.read().await.unwrap()).unwrap();
    assert_eq!(
        serde_json::to_value(fixture.read().await.unwrap()).unwrap(),
        cancelled
    );
    let input = serde_json::to_string(&vec!["雪"; 512]).unwrap();
    let mut times = Vec::new();
    for i in 0..11 {
        let start = Instant::now();
        change(&fixture, "items", Some(&input)).await.unwrap();
        let result = serde_json::to_vec(&fixture.read().await.unwrap()).unwrap();
        assert!(result.len() < 64 * 1024);
        if i >= 2 {
            times.push(start.elapsed().as_secs_f64() * 1000.0);
        }
    }
    times.sort_by(f64::total_cmp);
    println!("A01 isolated fixture512 elements;9 samples after2 warmups; median {:.3}ms p95 {:.3}ms; serial, <=64KiB snapshot, no fixture polling/background jobs", times[4], times[8]);
    assert!(times[4] < 250.0);
    assert!(times[8] < 500.0);
    println!("A01 fixture actual native provider guards/metadata/read/write/error/bounds/precision passed; this is not WebView IPC or visual acceptance.");
}
