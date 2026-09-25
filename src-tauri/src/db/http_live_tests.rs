use std::collections::HashMap;

use serde_json::json;

use super::pool::create_pool_state;
use super::{create_adapter_from_string, DatabaseAdapter, DatabaseKind};

fn adapter(kind: DatabaseKind, url: &str) -> Box<dyn DatabaseAdapter> {
    create_adapter_from_string(kind, url, None, create_pool_state()).unwrap()
}

fn urls(vars: &[&str]) -> Vec<(String, String)> {
    vars.iter()
        .filter_map(|v| std::env::var(v).ok().map(|url| (v.to_string(), url)))
        .collect()
}

#[tokio::test]
#[ignore]
async fn elasticsearch_and_opensearch_live() {
    for (var, url) in urls(&["L8DB_SMOKE_ELASTICSEARCH_URL", "L8DB_E2E_OPENSEARCH_URL"]) {
        let db = adapter(DatabaseKind::Elasticsearch, &url);
        let tables: Vec<String> = db
            .list_tables(Some("indices"))
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert!(tables.contains(&"logs".to_string()), "{var}: {tables:?}");
        let aliases = db.list_tables(Some("aliases")).await.unwrap();
        assert!(aliases.iter().any(|t| t.name == "logs_alias"), "{var}");
        let columns = db.list_columns(None, Some("logs"), None).await.unwrap();
        assert!(columns
            .iter()
            .any(|c| c.name == "user.name" && c.data_type == "text"));
        let rows = db
            .fetch_rows(
                "indices",
                "logs",
                Some("\"user.name\" = 'Ada Lovelace'"),
                10,
                0,
                None,
                false,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(rows.rows.len(), 1, "{var}");
        assert_eq!(rows.rows[0]["_id"], json!("1"));
        assert_eq!(rows.rows[0]["user.age"], json!(36));
        let sorted = db
            .fetch_rows(
                "indices",
                "logs",
                None,
                10,
                0,
                Some("user.age"),
                true,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(sorted.rows[0]["user.name"], json!("Carol"), "{var}");
        let by_alias = db
            .fetch_rows(
                "aliases",
                "logs_alias",
                Some("\"message\" LIKE '%err%' ESCAPE '!'"),
                10,
                0,
                None,
                false,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(by_alias.rows.len(), 1, "{var}");
        assert_eq!(by_alias.columns[0], "_index");
        assert_eq!(
            db.count_rows("indices", "logs", Some("level:warn"), false)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            db.count_rows(
                "indices",
                "logs",
                Some("{\"range\": {\"user.age\": {\"gte\": 30}}}"),
                false
            )
            .await
            .unwrap(),
            2
        );
        assert_eq!(
            db.count_rows("indices", "big", None, false).await.unwrap(),
            10050
        );
        let deep = db
            .fetch_rows(
                "indices",
                "big",
                None,
                5,
                10010,
                Some("n"),
                false,
                false,
                false,
            )
            .await
            .unwrap();
        let ns: Vec<i64> = deep.rows.iter().map(|r| r["n"].as_i64().unwrap()).collect();
        assert_eq!(ns, vec![10010, 10011, 10012, 10013, 10014], "{var}");
        let sql = db
            .execute_query("SELECT level, COUNT(*) AS c FROM logs GROUP BY level ORDER BY level")
            .await
            .unwrap();
        assert_eq!(sql.rows.len(), 3, "{var}: {sql:?}");
        let aggs = db
            .execute_query("GET logs/_search\n{\"size\": 0, \"aggs\": {\"by\": {\"terms\": {\"field\": \"level\"}}}}")
            .await
            .unwrap();
        assert_eq!(aggs.columns, ["key", "doc_count"], "{var}");
        assert_eq!(aggs.rows.len(), 3);
        let search = db
            .execute_query(
                "POST logs/_search\n{\"query\": {\"match\": {\"message\": \"warning\"}}}",
            )
            .await
            .unwrap();
        assert_eq!(search.rows[0]["user.name"], json!("Carol"));
        db.execute_query("PUT l8db_tmp/_doc/1?refresh=true\n{\"a\": 1}")
            .await
            .unwrap();
        let cat = db.execute_query("GET _cat/indices/l8db_tmp").await.unwrap();
        assert_eq!(cat.rows[0]["index"], json!("l8db_tmp"));
        db.drop_table("indices", "l8db_tmp").await.unwrap();
        let error = db
            .execute_query("GET missing_index/_search")
            .await
            .unwrap_err();
        assert!(error.contains("404"), "{error}");
        eprintln!("{var}: ok");
    }
}

#[tokio::test]
#[ignore]
async fn influxdb_v2_and_v3_live() {
    for (var, url) in urls(&["L8DB_SMOKE_INFLUXDB_URL", "L8DB_E2E_INFLUXDB3_URL"]) {
        let db = adapter(DatabaseKind::Influxdb, &url);
        assert!(
            db.list_databases()
                .await
                .unwrap()
                .contains(&"metrics".to_string()),
            "{var}"
        );
        let tables: Vec<String> = db
            .list_tables(None)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert!(
            tables.contains(&"cpu".to_string()) && tables.contains(&"mem".to_string()),
            "{var}: {tables:?}"
        );
        let columns = db.list_columns(None, Some("cpu"), None).await.unwrap();
        assert!(
            columns
                .iter()
                .any(|c| c.name == "host" && c.data_type == "tag"),
            "{var}: {columns:?}"
        );
        assert!(columns.iter().any(|c| c.name == "usage"), "{var}");
        let rows = db
            .fetch_rows("", "cpu", None, 100, 0, None, false, false, false)
            .await
            .unwrap();
        assert_eq!(rows.rows.len(), 3, "{var}: {rows:?}");
        assert_eq!(rows.rows[0]["usage"], json!(70.25), "{var}");
        let filtered = db
            .fetch_rows(
                "",
                "cpu",
                Some("\"host\" = 'web1' AND \"usage\" > 20"),
                100,
                0,
                Some("usage"),
                false,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(filtered.rows.len(), 1, "{var}: {filtered:?}");
        let like = db
            .count_rows(
                "",
                "cpu",
                Some("CAST(\"region\" AS VARCHAR) ILIKE 'E%' ESCAPE '\\'"),
                false,
            )
            .await
            .unwrap();
        assert_eq!(like, 2, "{var}");
        let written = db
            .execute_query("cpu,host=web3,region=ap usage=1.5,cores=2i")
            .await
            .unwrap();
        assert_eq!(written.rows_affected, Some(1));
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        assert_eq!(
            db.count_rows("", "cpu", None, false).await.unwrap(),
            4,
            "{var}"
        );
        let native = if var.contains("INFLUXDB3") {
            "SELECT host, usage FROM cpu ORDER BY time DESC"
        } else {
            "from(bucket: \"metrics\") |> range(start: -1h) |> filter(fn: (r) => r._measurement == \"cpu\" and r._field == \"usage\")"
        };
        let result = db.execute_query(native).await.unwrap();
        assert_eq!(result.rows.len(), 4, "{var}: {result:?}");
        let influxql = db
            .execute_query("SELECT usage FROM cpu WHERE host = 'web1'")
            .await
            .unwrap();
        assert_eq!(influxql.rows.len(), 2, "{var}: {influxql:?}");
        let show = db.execute_query("SHOW MEASUREMENTS").await.unwrap();
        assert!(!show.rows.is_empty(), "{var}");
        eprintln!("{var}: ok");
    }
}

#[tokio::test]
#[ignore]
async fn libsql_live() {
    let Ok(url) = std::env::var("L8DB_SMOKE_SQLITEHTTP_URL") else {
        return;
    };
    let db = adapter(DatabaseKind::SqliteHttp, &url);
    db.execute_query("DROP TABLE IF EXISTS l8db_people; CREATE TABLE l8db_people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, avatar BLOB); INSERT INTO l8db_people (name, avatar) VALUES ('ada', x'00ff'), ('bob', NULL)")
        .await
        .unwrap();
    let tables = db.list_tables(None).await.unwrap();
    assert!(tables.iter().any(|t| t.name == "l8db_people"));
    let all_columns = db.list_columns(None, None, None).await.unwrap();
    assert!(all_columns
        .iter()
        .any(|c| c.table == "l8db_people" && c.name == "avatar"));
    let rows = db
        .fetch_rows(
            "main",
            "l8db_people",
            Some("\"name\" = 'ada'"),
            10,
            0,
            Some("id"),
            false,
            false,
            false,
        )
        .await
        .unwrap();
    assert_eq!(rows.rows[0]["avatar"], json!("\\x00ff"));
    let ctid = rows.rows[0]["__ctid__"].as_str().unwrap().to_string();
    let manager = super::transaction::create_transaction_state();
    let pool = create_pool_state();
    let tx = manager
        .begin(DatabaseKind::SqliteHttp, &url, None, &pool)
        .await
        .unwrap();
    let updates = HashMap::from([("name".to_string(), Some("ada2".to_string()))]);
    manager
        .update_row(&tx, "main", "l8db_people", &ctid, &updates)
        .await
        .unwrap();
    let inserted = manager
        .insert_row(
            &tx,
            "main",
            "l8db_people",
            &HashMap::from([("name".to_string(), Some("carol".to_string()))]),
        )
        .await
        .unwrap();
    assert_eq!(inserted["name"], json!("carol"));
    let new_ctid = inserted["__ctid__"].as_str().unwrap().to_string();
    manager
        .delete_row(&tx, "main", "l8db_people", &new_ctid)
        .await
        .unwrap();
    manager.commit(&tx).await.unwrap();
    assert_eq!(
        db.count_rows("main", "l8db_people", None, false)
            .await
            .unwrap(),
        2
    );
    let check = db
        .execute_query("SELECT name FROM l8db_people ORDER BY id")
        .await
        .unwrap();
    assert_eq!(check.rows[0]["name"], json!("ada2"));
    let ddl = db.get_table_ddl("main", "l8db_people").await.unwrap();
    assert!(ddl.contains("CREATE TABLE l8db_people"));
    let error = db
        .execute_query("SELECT * FROM missing_table")
        .await
        .unwrap_err();
    assert!(error.contains("no such table"), "{error}");
    db.drop_table("main", "l8db_people").await.unwrap();
}
