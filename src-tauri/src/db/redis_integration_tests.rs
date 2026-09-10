use super::*;
use serde_json::json;

fn adapter(database: &str) -> RedisAdapter {
    RedisAdapter::new(
        &std::env::var("L8DB_E2E_REDIS_URL").expect("L8DB_E2E_REDIS_URL required"),
        Some(database),
        super::super::pool::create_pool_state(),
        format!("redis-test-{database}"),
    )
    .unwrap()
}

async fn run(adapter: &RedisAdapter, command: &str) -> serde_json::Value {
    adapter
        .execute_query(command)
        .await
        .unwrap()
        .rows
        .last()
        .unwrap()["result"]
        .clone()
}

#[tokio::test]
#[ignore = "requires isolated L8DB_E2E_REDIS_URL; clears databases 13 and 14"]
async fn redis_full_integration() {
    let a = adapter("13");
    let b = adapter("14");
    a.test_connection().await.unwrap();
    assert!(a.list_databases().await.unwrap().contains(&"13".into()));
    assert_eq!(a.list_schemas().await.unwrap(), vec!["keys"]);
    assert_eq!(a.list_tables(None).await.unwrap()[0].name, "keys");
    assert_eq!(
        a.list_columns(None, None, None).await.unwrap().len(),
        COLUMNS.len()
    );
    assert!(a.list_table_columns_detailed("keys", "keys").await.unwrap()[0].is_primary_key);
    a.truncate_table("keys", "keys").await.unwrap();
    b.truncate_table("keys", "keys").await.unwrap();
    run(&a, "SET text \"Grüße 🌍\"\nHSET hash name Ada role admin\nRPUSH list a b\nSADD set a b\nZADD zset 1 one 2 two\nXADD stream 1-0 event created\nSET expiry soon EX 600\nSET binary \"\\x00\\xff\"\nSET \"\\xffkey\" binary-key").await;
    assert_eq!(run(&a, "GET text").await, "Grüße 🌍");
    assert_eq!(run(&a, "HGET hash name").await, "Ada");
    assert_eq!(run(&a, "LRANGE list 0 -1").await, json!(["a", "b"]));
    assert_eq!(run(&a, "SCARD set").await, 2);
    assert_eq!(run(&a, "ZSCORE zset two").await, "2");
    assert_eq!(run(&a, "XLEN stream").await, 1);
    assert_eq!(run(&a, "GET binary").await, r"\x00ff");
    let rows = a
        .fetch_rows("keys", "keys", None, 100, 0, None, false, false, true)
        .await
        .unwrap();
    assert_eq!(rows.rows.len(), 9);
    assert!(rows
        .rows
        .iter()
        .any(|row| row["type"] == "stream" && row["value"].is_array()));
    assert!(rows
        .rows
        .iter()
        .any(|row| row["key"] == "expiry" && row["ttl"].as_i64().unwrap() > 0));
    assert_eq!(
        a.count_rows("keys", "keys", Some("*ary*"), true)
            .await
            .unwrap(),
        1
    );
    assert_eq!(a.count_rows("keys", "keys", None, true).await.unwrap(), 9);
    assert_eq!(b.count_rows("keys", "keys", None, true).await.unwrap(), 0);
    run(
        &a,
        "SELECT 14\nSET isolated yes\nMULTI\nSET transaction yes\nEXEC",
    )
    .await;
    assert_eq!(run(&b, "GET isolated").await, "yes");
    assert_eq!(run(&a, "GET isolated").await, serde_json::Value::Null);
    assert!(a
        .execute_query("MULTI\nSET abandoned yes")
        .await
        .unwrap_err()
        .contains("EXEC"));
    assert!(a.execute_query("SUBSCRIBE channel").await.is_err());
    assert_eq!(run(&a, "GET abandoned").await, serde_json::Value::Null);
    a.test_connection().await.unwrap();
    assert!(a
        .execute_query("SET must-not-exist yes\nSET broken \"unterminated")
        .await
        .is_err());
    assert_eq!(run(&a, "EXISTS must-not-exist").await, 0);
    assert!(a
        .execute_query("GET hash")
        .await
        .unwrap_err()
        .contains("WRONGTYPE"));
    run(&a, "SET text changed KEEPTTL\nHDEL hash role\nLPOP list\nSREM set b\nZREM zset one\nXDEL stream 1-0\nRENAMENX text renamed\nEXPIRE renamed 600").await;
    assert_eq!(run(&a, "GET renamed").await, "changed");
    assert_eq!(run(&a, "PERSIST renamed").await, 1);
    assert_eq!(run(&a, "TTL renamed").await, -1);
    assert_eq!(run(&a, "UNLINK renamed").await, 1);
    let mut conn = a.conn().await.unwrap();
    let mut pipeline = redis::pipe();
    for index in 0..2505 {
        pipeline
            .cmd("SET")
            .arg(format!("page:{index:04}"))
            .arg(index)
            .ignore();
    }
    pipeline.query_async::<()>(&mut conn).await.unwrap();
    for (offset, desc, expected) in [
        (0, false, "page:0000"),
        (1000, false, "page:1000"),
        (0, true, "page:2504"),
        (2000, true, "page:0504"),
    ] {
        let page = a
            .fetch_rows(
                "keys",
                "keys",
                Some("page:*"),
                100,
                offset,
                Some("key"),
                desc,
                false,
                true,
            )
            .await
            .unwrap();
        assert_eq!(page.rows.len(), 100);
        assert_eq!(page.rows[0]["key"], expected);
    }
    assert_eq!(
        a.count_rows("keys", "keys", Some("page:*"), true)
            .await
            .unwrap(),
        2505
    );
    assert_eq!(
        a.fetch_rows(
            "keys",
            "keys",
            Some("no-match:*"),
            100,
            0,
            None,
            false,
            false,
            true
        )
        .await
        .unwrap()
        .rows
        .len(),
        0
    );
    assert!(a.drop_table("keys", "keys").await.is_err());
    a.truncate_table("keys", "keys").await.unwrap();
    b.truncate_table("keys", "keys").await.unwrap();
}

#[test]
fn redis_parser_rejects_partial_input_and_handles_binary() {
    assert!(split_command("SET a \"unterminated").is_err());
    assert!(split_command("SET a \"x\"suffix").is_err());
    assert!(split_command(r#"SET a "\xzz""#).is_err());
    assert_eq!(
        split_command(r#"SET "" "\x00\xff\r\n\t""#).unwrap()[2],
        vec![0, 255, 13, 10, 9]
    );
    assert_eq!(split_command(r#"SET a 'it\'s'"#).unwrap()[2], b"it's");
    assert_eq!(split_command("SET a \"\"").unwrap()[2], b"");
}

#[tokio::test]
#[ignore = "requires isolated L8DB_E2E_REDIS_URL with ACL administration"]
async fn redis_auth_and_reconnect() {
    let admin = adapter("12");
    run(
        &admin,
        "ACL SETUSER l8db_test_reader reset on >l8db_reader_only ~* +@read +ping +select",
    )
    .await;
    let base = std::env::var("L8DB_E2E_REDIS_URL").unwrap();
    let mut uri = url::Url::parse(&base).unwrap();
    uri.set_username("l8db_test_reader").unwrap();
    uri.set_password(Some("l8db_reader_only")).unwrap();
    let reader = RedisAdapter::new(
        uri.as_str(),
        Some("12"),
        super::super::pool::create_pool_state(),
        "reader".into(),
    )
    .unwrap();
    reader.test_connection().await.unwrap();
    assert!(reader
        .list_databases()
        .await
        .unwrap()
        .contains(&"12".into()));
    let denied = reader
        .execute_query("SET forbidden value")
        .await
        .unwrap_err();
    assert!(denied.contains("NOPERM"), "{denied}");
    uri.set_password(Some("wrong_test_password")).unwrap();
    let wrong = RedisAdapter::new(
        uri.as_str(),
        None,
        super::super::pool::create_pool_state(),
        "wrong".into(),
    )
    .unwrap();
    assert!(wrong.test_connection().await.is_err());
    let mut conn = admin.conn().await.unwrap();
    let id: i64 = redis::cmd("CLIENT")
        .arg("ID")
        .query_async(&mut conn)
        .await
        .unwrap();
    run(&admin, &format!("CLIENT KILL ID {id}")).await;
    admin.test_connection().await.unwrap();
    run(&admin, "ACL DELUSER l8db_test_reader").await;
}

#[tokio::test]
#[ignore = "requires isolated L8DB_E2E_REDIS_URL; clears database 11"]
async fn redis_resp3_and_previews() {
    let mut uri = url::Url::parse(&std::env::var("L8DB_E2E_REDIS_URL").unwrap()).unwrap();
    uri.query_pairs_mut().append_pair("protocol", "resp3");
    let a = RedisAdapter::new(
        uri.as_str(),
        Some("11"),
        super::super::pool::create_pool_state(),
        "resp3".into(),
    )
    .unwrap();
    a.truncate_table("keys", "keys").await.unwrap();
    assert_eq!(
        a.list_databases().await.unwrap().len(),
        adapter("11").list_databases().await.unwrap().len()
    );
    let mut conn = a.conn().await.unwrap();
    let mut pipeline = redis::pipe();
    pipeline
        .cmd("SET")
        .arg("large:string")
        .arg("x".repeat(5000))
        .ignore();
    for index in 0..120 {
        for (command, key) in [("RPUSH", "large:list"), ("SADD", "large:set")] {
            pipeline.cmd(command).arg(key).arg(index).ignore();
        }
        pipeline
            .cmd("HSET")
            .arg("large:hash")
            .arg(index)
            .arg(index)
            .ignore();
        pipeline
            .cmd("ZADD")
            .arg("large:zset")
            .arg(index)
            .arg(index)
            .ignore();
        pipeline
            .cmd("XADD")
            .arg("large:stream")
            .arg("*")
            .arg("field")
            .arg(index)
            .ignore();
    }
    pipeline
        .cmd("ZADD")
        .arg("small:zset")
        .arg(1)
        .arg("member")
        .ignore();
    pipeline.query_async::<()>(&mut conn).await.unwrap();
    let rows = a
        .fetch_rows(
            "keys",
            "keys",
            Some("large:*"),
            100,
            0,
            None,
            false,
            false,
            true,
        )
        .await
        .unwrap();
    assert_eq!(rows.rows.len(), 6);
    for row in &rows.rows {
        assert_eq!(row["truncated"], true, "{row:?}");
        assert_eq!(
            row["size"],
            if row["type"] == "string" { 5000 } else { 120 }
        );
    }
    let rows = a
        .fetch_rows(
            "keys",
            "keys",
            Some("small:*"),
            100,
            0,
            None,
            false,
            false,
            true,
        )
        .await
        .unwrap();
    assert_eq!(rows.rows[0]["truncated"], false);
    assert_eq!(
        run(&a, "HGETALL large:hash")
            .await
            .as_object()
            .unwrap()
            .len(),
        120
    );
    assert_eq!(
        run(&a, "LRANGE large:list 0 -1")
            .await
            .as_array()
            .unwrap()
            .len(),
        120
    );
    a.truncate_table("keys", "keys").await.unwrap();
}
