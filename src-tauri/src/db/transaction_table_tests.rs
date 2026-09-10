use super::{create_transaction_state, DatabaseKind, TransactionTableRead};
use crate::db::{create_adapter_from_string, pool::create_pool_state};

fn request(schema: &str, table: &str) -> TransactionTableRead {
    TransactionTableRead {
        schema: schema.to_string(),
        table: table.to_string(),
        filter: None,
        limit: 10,
        offset: 0,
        order_by: Some("id".to_string()),
        order_desc: false,
        is_view: false,
        allow_raw: false,
    }
}

#[tokio::test]
async fn sqlite_reads_see_pending_changes_and_preserve_keys() {
    let path = std::env::temp_dir().join(format!("l8db-tx-read-{}.sqlite", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let url = format!("sqlite://{}", path.display());
    let pool = create_pool_state();
    let adapter =
        create_adapter_from_string(DatabaseKind::Sqlite, &url, None, pool.clone()).unwrap();
    adapter
        .execute_query("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
        .await
        .unwrap();
    let manager = create_transaction_state();
    let id = manager
        .begin(DatabaseKind::Sqlite, &url, None, &pool)
        .await
        .unwrap();
    manager
        .execute(&id, "INSERT INTO t VALUES (1, 'one'), (2, 'two')")
        .await
        .unwrap();

    let mut read = request("main", "t");
    read.limit = 1;
    read.order_desc = true;
    let rows = manager.fetch_rows(&id, read.clone()).await.unwrap();
    assert_eq!(rows.columns, vec!["id", "name"]);
    assert_eq!(rows.rows[0]["name"], "two");
    assert_eq!(rows.rows[0]["__ctid__"], r#"{"id":2}"#);
    assert_eq!(
        manager
            .count_rows(&id, "main", "t", Some("id = 2"), false)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        adapter.count_rows("main", "t", None, false).await.unwrap(),
        0
    );
    read.offset = 1;
    assert_eq!(
        manager.fetch_rows(&id, read.clone()).await.unwrap().rows[0]["name"],
        "one"
    );
    read.filter = Some("1=1; DELETE FROM t".to_string());
    assert!(manager.fetch_rows(&id, read).await.is_err());
    assert_eq!(
        manager
            .count_rows(&id, "main", "t", None, false)
            .await
            .unwrap(),
        2
    );
    manager.rollback(&id).await.unwrap();
    assert_eq!(
        adapter.count_rows("main", "t", None, false).await.unwrap(),
        0
    );
    assert!(manager.fetch_rows(&id, request("main", "t")).await.is_err());
    drop(adapter);
    drop(pool);
    let _ = std::fs::remove_file(path);
}

async fn independent_tables(kind: DatabaseKind, variable: &str) {
    let url = std::env::var(variable).expect("Set the test database URL to run this ignored test");
    let pool = create_pool_state();
    let adapter = create_adapter_from_string(kind, &url, None, pool.clone()).unwrap();
    let schema_sql = match kind {
        DatabaseKind::Oracle => "SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS S FROM DUAL",
        DatabaseKind::Postgres => "SELECT current_schema() AS s",
        DatabaseKind::Mysql => "SELECT DATABASE() AS s",
        _ => "SELECT SCHEMA_NAME() AS s",
    };
    let result = adapter.execute_query(schema_sql).await.unwrap();
    let schema = result.rows[0]
        .as_object()
        .unwrap()
        .values()
        .next()
        .unwrap()
        .as_str()
        .unwrap();
    let names: Vec<String> = (0..3)
        .map(|index| format!("L8_SPLIT_{}_{index}", std::process::id()))
        .collect();
    for name in &names {
        adapter
            .execute_query(&format!(
                "CREATE TABLE {name} (id INTEGER PRIMARY KEY, value INTEGER)"
            ))
            .await
            .unwrap();
    }
    let manager = create_transaction_state();
    let mut ids = Vec::new();
    for name in &names {
        let id = manager.begin(kind, &url, None, &pool).await.unwrap();
        manager
            .execute(
                &id,
                &format!("INSERT INTO {name} (id, value) VALUES (1, 10)"),
            )
            .await
            .unwrap();
        ids.push(id);
    }
    let actual_names: Vec<String> = names
        .iter()
        .map(|name| {
            if kind == DatabaseKind::Postgres {
                name.to_lowercase()
            } else {
                name.clone()
            }
        })
        .collect();
    for (index, name) in actual_names.iter().enumerate() {
        assert_eq!(
            manager
                .count_rows(&ids[index], schema, name, None, false)
                .await
                .unwrap(),
            1
        );
        let rows = manager
            .fetch_rows(&ids[index], request(schema, name))
            .await
            .unwrap();
        assert_eq!(rows.rows.len(), 1);
        assert!(rows.rows[0]["__ctid__"].is_string());
        if kind != DatabaseKind::Mssql {
            assert_eq!(
                adapter.count_rows(schema, name, None, false).await.unwrap(),
                0
            );
        }
    }
    manager.commit(&ids[1]).await.unwrap();
    assert_eq!(
        adapter
            .count_rows(schema, &actual_names[1], None, false)
            .await
            .unwrap(),
        1
    );
    assert_eq!(manager.list_active_ids().await.len(), 2);
    for index in [0, 2] {
        assert_eq!(
            manager
                .fetch_rows(&ids[index], request(schema, &actual_names[index]))
                .await
                .unwrap()
                .rows
                .len(),
            1
        );
        manager.rollback(&ids[index]).await.unwrap();
        assert_eq!(
            adapter
                .count_rows(schema, &actual_names[index], None, false)
                .await
                .unwrap(),
            0
        );
    }
    for name in &names {
        adapter
            .execute_query(&format!("DROP TABLE {name}"))
            .await
            .unwrap();
    }
}

#[tokio::test]
#[ignore]
async fn oracle_commits_only_selected_table() {
    independent_tables(DatabaseKind::Oracle, "L8DB_SMOKE_ORACLE_URL").await;
}

#[tokio::test]
#[ignore]
async fn postgres_commits_only_selected_table() {
    independent_tables(DatabaseKind::Postgres, "L8DB_SMOKE_POSTGRES_URL").await;
}

#[tokio::test]
#[ignore]
async fn mysql_commits_only_selected_table() {
    independent_tables(DatabaseKind::Mysql, "L8DB_SMOKE_MYSQL_URL").await;
}

#[tokio::test]
#[ignore]
async fn mssql_commits_only_selected_table() {
    independent_tables(DatabaseKind::Mssql, "L8DB_SMOKE_MSSQL_URL").await;
}
