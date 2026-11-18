use super::{cell, quote, timestamp_on_update, MysqlAdapter};
use crate::db::{pool::create_pool_state, DatabaseAdapter};
use std::time::Instant;

#[test]
fn admits_only_supported_update_metadata() {
    assert_eq!(
        timestamp_on_update("timestamp", "DEFAULT_GENERATED on update CURRENT_TIMESTAMP")
            .as_deref(),
        Some("CURRENT_TIMESTAMP"),
    );
    for precision in 0..=6 {
        let expression = format!("CURRENT_TIMESTAMP({precision})");
        assert_eq!(
            timestamp_on_update("datetime(6)", &format!("On Update {expression}")).as_deref(),
            Some(expression.as_str()),
        );
    }
    for (data_type, extra) in [
        ("timestamp", ""),
        ("timestamp", "DEFAULT_GENERATED"),
        ("varchar(80)", "on update CURRENT_TIMESTAMP"),
        ("timestamp", "STORED GENERATED on update CURRENT_TIMESTAMP"),
        ("timestamp", "on update current_timestamp(7)"),
        ("timestamp", "on update current_timestamp()"),
        ("timestamp", "on update now()"),
    ] {
        assert_eq!(timestamp_on_update(data_type, extra), None);
    }
}

#[tokio::test]
#[ignore = "run via scripts/test-mysql-column-update-local.sh"]
async fn local_mysql_catalog_roundtrip() {
    let dsn = std::env::var("L8DB_A44_LOCAL_MYSQL_URL").expect("isolated fixture URL");
    let url = url::Url::parse(&dsn).expect("fixture URL");
    assert_eq!(url.scheme(), "mysql");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert_ne!(url.port(), None);
    assert_eq!(url.username(), "root");
    let database = url.path().trim_start_matches('/');
    let nonce = database.strip_prefix("l8db_a44_").expect("fixture prefix");
    assert!(nonce.len() == 12 && nonce.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert_eq!(url.password(), Some(format!("a44_{nonce}").as_str()));
    assert_eq!(url.query(), Some("sslmode=disable"));
    let adapter = MysqlAdapter::new(&dsn, None, create_pool_state(), "a44-private".into()).unwrap();
    let identity = adapter
        .rows("SELECT @@hostname, DATABASE(), VERSION()")
        .await
        .unwrap();
    assert_eq!(cell(&identity[0], 0), format!("l8db-a44-{nonce}"));
    assert_eq!(cell(&identity[0], 1), database);
    let version = cell(&identity[0], 2);
    assert!(version.starts_with("8.") && !version.to_ascii_lowercase().contains("mariadb"));
    let other = format!("{database}_other");
    adapter
        .exec(&format!("CREATE DATABASE {}", quote(&other)))
        .await
        .unwrap();
    adapter.exec("CREATE TABLE a44_items (
        id INT NOT NULL PRIMARY KEY,
        default_only DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        changed_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        precise DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'fixture',
        update_only TIMESTAMP(3) NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(3),
        no_rule DATETIME NULL DEFAULT NULL,
        computed INT GENERATED ALWAYS AS (id + 1) STORED
    )").await.unwrap();
    adapter
        .exec(&format!(
            "CREATE TABLE {}.a44_items (changed_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP)",
            quote(&other)
        ))
        .await
        .unwrap();

    let ddl = adapter.rows("SHOW CREATE TABLE a44_items").await.unwrap();
    let columns = adapter
        .list_table_column_metadata(database, "a44_items")
        .await
        .unwrap();
    let rules: Vec<_> = columns
        .iter()
        .map(|entry| (entry.column.name.as_str(), entry.on_update.as_deref()))
        .collect();
    assert_eq!(
        rules,
        vec![
            ("id", None),
            ("default_only", None),
            ("changed_at", Some("CURRENT_TIMESTAMP")),
            ("precise", Some("CURRENT_TIMESTAMP(6)")),
            ("update_only", Some("CURRENT_TIMESTAMP(3)")),
            ("no_rule", None),
            ("computed", None),
        ]
    );
    assert_eq!(
        columns[1].column.column_default.as_deref(),
        Some("CURRENT_TIMESTAMP(3)")
    );
    assert_eq!(columns[3].column.comment.as_deref(), Some("fixture"));
    assert_eq!(columns[4].column.column_default, None);
    let legacy = adapter
        .list_table_columns_detailed(database, "a44_items")
        .await
        .unwrap();
    assert_eq!(legacy.len(), columns.len());
    for (column, entry) in legacy.iter().zip(columns.iter()) {
        assert_eq!(
            serde_json::to_value(column).unwrap(),
            serde_json::to_value(&entry.column).unwrap()
        );
        let wire = serde_json::to_value(entry).unwrap();
        assert_eq!(
            wire.get("on_update").and_then(serde_json::Value::as_str),
            entry.on_update.as_deref()
        );
    }
    let same_name = adapter
        .list_table_column_metadata(&other, "a44_items")
        .await
        .unwrap();
    assert_eq!(same_name.len(), 1);
    assert_eq!(same_name[0].column.name, "changed_at");
    assert_eq!(same_name[0].on_update, None);
    assert_eq!(
        adapter.rows("SHOW CREATE TABLE a44_items").await.unwrap(),
        ddl
    );

    let wide = (0..250)
        .map(|index| format!("c{index} DATETIME(6) ON UPDATE CURRENT_TIMESTAMP(6)"))
        .collect::<Vec<_>>()
        .join(", ");
    adapter
        .exec(&format!("CREATE TABLE a44_wide ({wide})"))
        .await
        .unwrap();
    let mut samples = Vec::new();
    for _ in 0..10 {
        let start = Instant::now();
        let result = adapter
            .list_table_column_metadata(database, "a44_wide")
            .await
            .unwrap();
        samples.push(start.elapsed().as_secs_f64() * 1_000.0);
        assert_eq!(result.len(), 250);
        assert!(result
            .iter()
            .all(|column| column.on_update.as_deref() == Some("CURRENT_TIMESTAMP(6)")));
    }
    samples.sort_by(f64::total_cmp);
    let median = (samples[4] + samples[5]) / 2.0;
    let p95 = samples[9];
    assert!(p95 < 250.0, "{samples:?}");
    println!("MySQL {version}, 250 columns, 10 scoped catalog reads: median {median:.3} ms, p95 {p95:.3} ms");
}
