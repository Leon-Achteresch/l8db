use super::*;
use crate::db::{create_adapter_from_string, pool::create_pool_state, provider::DatabaseKind};

#[test]
fn extended_json_filters_preserve_bson_types() {
    let document = parse_document(r#"{"_id":{"$oid":"507f1f77bcf86cd799439011"},"date":{"$date":"2024-01-01T00:00:00Z"},"long":{"$numberLong":"9007199254740993"},"decimal":{"$numberDecimal":"12.50"},"binary":{"$binary":{"base64":"AQID","subType":"00"}}}"#, "Filter").unwrap();
    assert!(matches!(document.get("_id"), Some(Bson::ObjectId(_))));
    assert!(matches!(document.get("date"), Some(Bson::DateTime(_))));
    assert_eq!(document.get_i64("long").unwrap(), 9007199254740993);
    assert!(matches!(document.get("decimal"), Some(Bson::Decimal128(_))));
    assert!(matches!(document.get("binary"), Some(Bson::Binary(_))));
    for invalid in [
        "[]",
        "null",
        "true",
        "42",
        "{",
        r#"{"_id":{"$oid":"invalid"}}"#,
    ] {
        assert!(parse_document(invalid, "Filter").is_err(), "{invalid}");
    }
    let command =
        parse_document(r#"{"find":"items","batchSize":2,"filter":{}}"#, "Command").unwrap();
    assert_eq!(command.keys().next().unwrap(), "find");
}

#[test]
fn large_integers_round_trip_without_javascript_precision_loss() {
    let document =
        doc! { "large": i64::MAX, "nested": { "values": [i64::MIN, 9007199254740991i64] } };
    let json = to_json(Bson::Document(document.clone()));
    assert_eq!(json["large"]["$numberLong"], i64::MAX.to_string());
    assert_eq!(
        json["nested"]["values"][0]["$numberLong"],
        i64::MIN.to_string()
    );
    assert_eq!(json["nested"]["values"][1], 9007199254740991i64);
    assert_eq!(
        parse_document(&json.to_string(), "Filter").unwrap(),
        document
    );
}

#[tokio::test]
#[ignore = "requires L8DB_E2E_MONGODB_URL pointing to the isolated Docker lab"]
async fn mongodb_docker_integration() {
    let uri = std::env::var("L8DB_E2E_MONGODB_URL").expect("L8DB_E2E_MONGODB_URL required");
    let pool = create_pool_state();
    let db = format!(
        "l8db_e2e_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let adapter =
        create_adapter_from_string(DatabaseKind::Mongodb, &uri, Some(&db), pool.clone()).unwrap();
    adapter.test_connection().await.unwrap();
    assert_eq!(adapter.list_schemas().await.unwrap(), vec![db.clone()]);
    let request = CreateTableRequest {
        schema: db.clone(),
        name: "items".into(),
        columns: vec![],
        if_not_exists: false,
    };
    adapter.create_table(&request).await.unwrap();
    adapter.create_table(&request).await.unwrap();
    assert!(adapter.list_databases().await.unwrap().contains(&db));
    assert_eq!(adapter.list_tables(None).await.unwrap()[0].name, "items");
    assert_eq!(adapter.list_tables(Some(&db)).await.unwrap()[0].schema, db);
    let empty = adapter
        .fetch_rows(&db, "items", None, 10, 0, None, false, false, false)
        .await
        .unwrap();
    assert!(empty.rows.is_empty());
    assert_eq!(empty.columns, vec!["_id"]);
    let seed = serde_json::json!({"insert":"items", "documents": (0..257).map(|n| serde_json::json!({"_id": n, "n": n, "group": n % 2, "nested": {"value": n}, "tags": ["a", "b"], "nullable": null, "text": "UNION; -- literal"})).collect::<Vec<_>>()});
    assert_eq!(
        adapter
            .execute_query(&seed.to_string())
            .await
            .unwrap()
            .rows_affected,
        Some(257)
    );
    assert_eq!(
        adapter.count_rows(&db, "items", None, false).await.unwrap(),
        257
    );
    assert_eq!(
        adapter
            .count_rows(&db, "items", Some(r#"{"group":1}"#), false)
            .await
            .unwrap(),
        128
    );
    assert_eq!(
        adapter
            .count_rows(&db, "items", Some(r#"{"text":"UNION; -- literal"}"#), false)
            .await
            .unwrap(),
        257
    );
    let page = adapter
        .fetch_rows(
            &db,
            "items",
            Some(r#"{"n":{"$gte":10}}"#),
            7,
            3,
            Some("n"),
            false,
            false,
            false,
        )
        .await
        .unwrap();
    assert_eq!(page.rows.len(), 7);
    assert_eq!(page.rows[0]["n"], 13);
    assert_eq!(page.rows[6]["n"], 19);
    let page = adapter
        .fetch_rows(&db, "items", None, 5, 1, Some("n"), true, false, false)
        .await
        .unwrap();
    assert_eq!(page.rows[0]["n"], 255);
    for limit in [0, -1] {
        assert!(adapter
            .fetch_rows(&db, "items", None, limit, 0, None, false, false, false)
            .await
            .unwrap()
            .rows
            .is_empty());
    }
    let no_match = adapter
        .fetch_rows(
            &db,
            "items",
            Some(r#"{"n":999}"#),
            10,
            0,
            None,
            false,
            false,
            false,
        )
        .await
        .unwrap();
    assert!(no_match.rows.is_empty());
    assert!(no_match.columns.contains(&"nested".into()));
    assert!(adapter
        .list_columns(None, Some("items"), None)
        .await
        .unwrap()
        .iter()
        .any(|c| c.name == "nested" && c.data_type == "object" && c.schema == db));
    assert!(!adapter
        .list_columns(Some(&db), None, None)
        .await
        .unwrap()
        .is_empty());
    assert!(adapter
        .list_columns(Some(&db), None, Some("VIEW"))
        .await
        .unwrap()
        .is_empty());
    let columns = adapter
        .list_table_columns_detailed(&db, "items")
        .await
        .unwrap();
    assert!(columns[0].is_primary_key);
    assert!(
        columns
            .iter()
            .find(|c| c.name == "nullable")
            .unwrap()
            .is_nullable
    );
    let find = adapter
        .execute_query(r#"{"find":"items","batchSize":2,"sort":{"n":1}}"#)
        .await
        .unwrap();
    assert_eq!(find.rows.len(), 257);
    assert_eq!(find.rows[256]["n"], 256);
    assert_eq!(find.rows_affected, None);
    let aggregate = adapter.execute_query(r#"{"aggregate":"items","pipeline":[{"$match":{"n":{"$gte":100}}}],"cursor":{"batchSize":3}}"#).await.unwrap();
    assert_eq!(aggregate.rows.len(), 157);
    assert_eq!(
        adapter
            .execute_query(r#"{"aggregate":"items","pipeline":[{"$count":"total"}]}"#)
            .await
            .unwrap()
            .rows[0]["total"],
        257
    );
    assert_eq!(
        adapter
            .execute_query(r#"{"count":"items","query":{"group":1}}"#)
            .await
            .unwrap()
            .rows[0]["n"],
        128
    );
    assert_eq!(
        adapter
            .execute_query(r#"{"distinct":"items","key":"group"}"#)
            .await
            .unwrap()
            .rows[0]["values"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        adapter
            .execute_query(
                r#"{"update":"items","updates":[{"q":{"_id":0},"u":{"$set":{"changed":true}}}]}"#
            )
            .await
            .unwrap()
            .rows_affected,
        Some(1)
    );
    assert_eq!(
        adapter
            .fetch_rows(
                &db,
                "items",
                Some(r#"{"_id":0}"#),
                1,
                0,
                None,
                false,
                false,
                false
            )
            .await
            .unwrap()
            .rows[0]["changed"],
        true
    );
    assert!(
        adapter
            .list_table_columns_detailed(&db, "items")
            .await
            .unwrap()
            .iter()
            .find(|c| c.name == "changed")
            .unwrap()
            .is_nullable
    );
    adapter.execute_query(r#"{"createIndexes":"items","indexes":[{"key":{"n":1},"name":"n_unique","unique":true}]}"#).await.unwrap();
    let indexes = adapter.list_indexes(&db, "items").await.unwrap();
    assert!(indexes
        .iter()
        .any(|i| i.name == "_id_" && i.is_primary && i.is_unique));
    assert!(indexes.iter().any(|i| i.name == "n_unique" && i.is_unique));
    assert_eq!(
        adapter
            .execute_query(r#"{"listIndexes":"items","cursor":{"batchSize":1}}"#)
            .await
            .unwrap()
            .rows
            .len(),
        2
    );
    assert!(adapter
        .execute_query(r#"{"insert":"items","documents":[{"_id":0,"n":0}]}"#)
        .await
        .unwrap_err()
        .contains("11000"));
    for invalid in ["", "select * from items", "[]", r#"{"nonsense":1}"#] {
        assert!(adapter.execute_query(invalid).await.is_err(), "{invalid}");
    }
    assert!(adapter
        .fetch_rows(
            &db,
            "items",
            Some("n = 1"),
            10,
            0,
            None,
            false,
            false,
            false
        )
        .await
        .is_err());
    assert!(adapter
        .count_rows(&db, "items", Some("[]"), false)
        .await
        .is_err());
    adapter.execute_query(r#"{"insert":"typed","documents":[{"_id":{"$oid":"507f1f77bcf86cd799439011"},"date":{"$date":"2024-01-01T00:00:00Z"},"decimal":{"$numberDecimal":"12.50"},"binary":{"$binary":{"base64":"AQID","subType":"00"}}}]}"#).await.unwrap();
    let typed = adapter
        .fetch_rows(
            &db,
            "typed",
            Some(r#"{"_id":{"$oid":"507f1f77bcf86cd799439011"}}"#),
            1,
            0,
            None,
            false,
            false,
            false,
        )
        .await
        .unwrap();
    assert_eq!(typed.rows.len(), 1);
    assert_eq!(typed.rows[0]["_id"]["$oid"], "507f1f77bcf86cd799439011");
    assert_eq!(typed.rows[0]["date"]["$date"], "2024-01-01T00:00:00Z");
    assert_eq!(typed.rows[0]["decimal"]["$numberDecimal"], "12.50");
    assert_eq!(
        adapter
            .count_rows(
                &db,
                "typed",
                Some(r#"{"date":{"$gte":{"$date":"2023-01-01T00:00:00Z"}}}"#),
                false
            )
            .await
            .unwrap(),
        1
    );
    adapter.execute_query(r#"{"update":"typed","updates":[{"q":{},"u":{"$set":{"long":{"$numberLong":"9223372036854775807"}}}}]}"#).await.unwrap();
    let large = adapter
        .fetch_rows(
            &db,
            "typed",
            Some(r#"{"long":{"$numberLong":"9223372036854775807"}}"#),
            1,
            0,
            None,
            false,
            false,
            false,
        )
        .await
        .unwrap();
    assert_eq!(large.rows[0]["long"]["$numberLong"], "9223372036854775807");
    assert_eq!(large.rows[0]["binary"]["$binary"]["base64"], "AQID");
    adapter.execute_query(r#"{"createIndexes":"typed","indexes":[{"key":{"long":"hashed"},"name":"long_hashed"}]}"#).await.unwrap();
    assert!(adapter
        .list_indexes(&db, "typed")
        .await
        .unwrap()
        .iter()
        .any(|index| index.name == "long_hashed" && index.index_type == "hashed"));
    let mut default_uri = url::Url::parse(&uri).unwrap();
    default_uri.set_path(&db);
    let default_adapter = create_adapter_from_string(
        DatabaseKind::Mongodb,
        default_uri.as_str(),
        None,
        pool.clone(),
    )
    .unwrap();
    assert_eq!(
        default_adapter.list_schemas().await.unwrap(),
        vec![db.clone()]
    );
    assert_eq!(default_adapter.list_tables(None).await.unwrap().len(), 2);
    default_uri.set_path("");
    let no_database = create_adapter_from_string(
        DatabaseKind::Mongodb,
        default_uri.as_str(),
        None,
        pool.clone(),
    )
    .unwrap();
    assert!(no_database
        .list_schemas()
        .await
        .unwrap_err()
        .contains("Kein Datenbankname"));
    let other = format!("{db}_other");
    let switched =
        create_adapter_from_string(DatabaseKind::Mongodb, &uri, Some(&other), pool.clone())
            .unwrap();
    assert!(switched.list_tables(None).await.unwrap().is_empty());
    switched
        .execute_query(r#"{"insert":"isolated","documents":[{"value":true}]}"#)
        .await
        .unwrap();
    assert_eq!(switched.list_schemas().await.unwrap(), vec![other.clone()]);
    assert_eq!(adapter.list_tables(None).await.unwrap().len(), 2);
    assert_eq!(
        adapter
            .execute_query(r#"{"listCollections":1,"cursor":{"batchSize":1}}"#)
            .await
            .unwrap()
            .rows
            .len(),
        2
    );
    assert_eq!(
        adapter
            .execute_query(r#"{"delete":"items","deletes":[{"q":{"_id":0},"limit":1}]}"#)
            .await
            .unwrap()
            .rows_affected,
        Some(1)
    );
    adapter.truncate_table(&db, "items").await.unwrap();
    assert_eq!(
        adapter.count_rows(&db, "items", None, false).await.unwrap(),
        0
    );
    assert_eq!(adapter.list_indexes(&db, "items").await.unwrap().len(), 2);
    adapter.drop_table(&db, "items").await.unwrap();
    assert_eq!(adapter.list_tables(None).await.unwrap().len(), 1);
    assert!(adapter.create_schema("unused").await.is_err());
    switched.drop_schema(&other, true).await.unwrap();
    adapter.drop_schema(&db, true).await.unwrap();
    assert!(!adapter.list_databases().await.unwrap().contains(&db));
    let mut wrong_uri = url::Url::parse(&uri).unwrap();
    wrong_uri.set_password(Some("wrong-password")).unwrap();
    let wrong =
        create_adapter_from_string(DatabaseKind::Mongodb, wrong_uri.as_str(), None, pool).unwrap();
    assert!(wrong.test_connection().await.is_err());
}
