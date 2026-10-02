use std::collections::HashMap;

use super::{create_transaction_state, DatabaseKind, TransactionManager};
use crate::db::{create_adapter_from_string, pool::create_pool_state, DatabaseAdapter};

fn identity(rows: &[serde_json::Value], id: i64) -> String {
    rows.iter().find(|row| row["id"] == id).unwrap()["__ctid__"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn grid_rows(adapter: &dyn DatabaseAdapter, table: &str) -> Vec<serde_json::Value> {
    adapter
        .fetch_rows(
            "public",
            table,
            None,
            100,
            0,
            Some("id"),
            false,
            false,
            false,
        )
        .await
        .unwrap()
        .rows
}

async fn snapshot(manager: &TransactionManager, tx: &str, table: &str) -> Vec<String> {
    manager
        .execute(
            tx,
            &format!("SELECT id::text || ':' || name AS v FROM {table} ORDER BY id, name"),
        )
        .await
        .unwrap()
        .rows
        .iter()
        .map(|row| row["v"].as_str().unwrap().to_string())
        .collect()
}

fn update(column: &str, value: &str) -> HashMap<String, Option<String>> {
    HashMap::from([(column.to_string(), Some(value.to_string()))])
}

#[tokio::test]
#[ignore]
async fn postgres_row_edits_stay_inside_one_partition_or_child() {
    let url = std::env::var("L8DB_SMOKE_POSTGRES_URL")
        .expect("Set L8DB_SMOKE_POSTGRES_URL to run this ignored test");
    let pool = create_pool_state();
    let adapter =
        create_adapter_from_string(DatabaseKind::Postgres, &url, None, pool.clone()).unwrap();
    let part = format!("l8_ctid_part_{}", std::process::id());
    let inh = format!("l8_ctid_inh_{}", std::process::id());
    let plain = format!("l8_ctid_plain_{}", std::process::id());
    let _ = adapter
        .execute_query(&format!(
            "DROP TABLE IF EXISTS {part}, {inh}, {plain} CASCADE"
        ))
        .await;
    for statement in [
        format!("CREATE TABLE {part} (id int, region text, name text) PARTITION BY LIST (region)"),
        format!("CREATE TABLE {part}_a PARTITION OF {part} FOR VALUES IN ('a')"),
        format!("CREATE TABLE {part}_b PARTITION OF {part} FOR VALUES IN ('b')"),
        format!("INSERT INTO {part} VALUES (1, 'a', 'one'), (2, 'b', 'two')"),
        format!("CREATE TABLE {inh} (id int, name text)"),
        format!("CREATE TABLE {inh}_c () INHERITS ({inh})"),
        format!("INSERT INTO {inh} VALUES (1, 'parent')"),
        format!("INSERT INTO {inh}_c VALUES (2, 'child')"),
        format!("CREATE TABLE {plain} (id int, name text)"),
        format!("INSERT INTO {plain} VALUES (1, 'only')"),
    ] {
        adapter.execute_query(&statement).await.unwrap();
    }

    let rows = grid_rows(adapter.as_ref(), &part).await;
    assert_eq!(rows.len(), 2);
    assert_ne!(identity(&rows, 1), identity(&rows, 2));
    let (first, second) = (identity(&rows, 1), identity(&rows, 2));

    let manager = create_transaction_state();
    let tx = manager
        .begin(DatabaseKind::Postgres, &url, None, &pool)
        .await
        .unwrap();

    let dup = manager
        .duplicate_row(&tx, "public", &part, &second)
        .await
        .unwrap();
    assert_eq!(dup["id"], 2);
    assert_eq!(
        snapshot(&manager, &tx, &part).await,
        vec!["1:one", "2:two", "2:two"]
    );

    let moved = manager
        .update_row(&tx, "public", &part, &first, &update("name", "uno"))
        .await
        .unwrap();
    assert_eq!(
        snapshot(&manager, &tx, &part).await,
        vec!["1:uno", "2:two", "2:two"]
    );

    let moved = manager
        .update_row(&tx, "public", &part, &moved, &update("region", "b"))
        .await
        .unwrap();
    manager
        .update_row(&tx, "public", &part, &moved, &update("name", "eins"))
        .await
        .unwrap();
    assert_eq!(
        snapshot(&manager, &tx, &part).await,
        vec!["1:eins", "2:two", "2:two"]
    );

    let dup_identity = dup["__ctid__"].as_str().unwrap().to_string();
    manager
        .delete_row(&tx, "public", &part, &dup_identity)
        .await
        .unwrap();
    manager
        .delete_row(&tx, "public", &part, &moved)
        .await
        .unwrap_err();
    assert_eq!(
        snapshot(&manager, &tx, &part).await,
        vec!["1:eins", "2:two"]
    );

    assert!(manager
        .delete_row(&tx, "public", &part, "(0,1)")
        .await
        .is_err());
    assert_eq!(
        snapshot(&manager, &tx, &part).await,
        vec!["1:eins", "2:two"]
    );

    let inserted = manager
        .insert_row(
            &tx,
            "public",
            &part,
            &HashMap::from([
                ("id".to_string(), Some("3".to_string())),
                ("region".to_string(), Some("a".to_string())),
                ("name".to_string(), Some("drei".to_string())),
            ]),
        )
        .await
        .unwrap();
    manager
        .update_row(
            &tx,
            "public",
            &part,
            inserted["__ctid__"].as_str().unwrap(),
            &update("name", "three"),
        )
        .await
        .unwrap();
    assert_eq!(
        snapshot(&manager, &tx, &part).await,
        vec!["1:eins", "2:two", "3:three"]
    );

    let inh_rows = grid_rows(adapter.as_ref(), &inh).await;
    assert_eq!(inh_rows.len(), 2);
    manager
        .delete_row(&tx, "public", &inh, &identity(&inh_rows, 1))
        .await
        .unwrap();
    assert_eq!(snapshot(&manager, &tx, &inh).await, vec!["2:child"]);
    manager.rollback(&tx).await.unwrap();

    adapter
        .update_row(
            "public",
            &inh,
            &identity(&inh_rows, 2),
            &update("name", "kind"),
        )
        .await
        .unwrap();
    let names = adapter
        .execute_query(&format!("SELECT id, name FROM {inh} ORDER BY id"))
        .await
        .unwrap()
        .rows;
    assert_eq!(names[0]["name"], "parent");
    assert_eq!(names[1]["name"], "kind");

    let tx = manager
        .begin(DatabaseKind::Postgres, &url, None, &pool)
        .await
        .unwrap();
    manager
        .delete_row(&tx, "public", &plain, "(0,1)")
        .await
        .unwrap();
    assert!(snapshot(&manager, &tx, &plain).await.is_empty());
    manager.rollback(&tx).await.unwrap();

    adapter
        .execute_query(&format!("DROP TABLE {part}, {inh}, {plain} CASCADE"))
        .await
        .unwrap();
}
