use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::backup::{backup, probe, restore, BackupOptions, BackupRequest, Emit};
use super::pool::create_pool_state;
use super::{create_adapter_from_string, DatabaseKind, QueryResult};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn tool_paths() -> HashMap<String, String> {
    let Some(dir) = env("L8DB_BACKUP_TOOL_DIR") else {
        return HashMap::new();
    };
    [
        "pg_dump",
        "pg_restore",
        "psql",
        "pg_dumpall",
        "mysqldump",
        "mysql",
        "mongodump",
        "mongorestore",
    ]
    .into_iter()
    .map(|tool| (tool.to_string(), dir.clone()))
    .collect()
}

fn out_dir() -> std::path::PathBuf {
    let dir = std::path::PathBuf::from(env("L8DB_BACKUP_DIR").unwrap_or_else(|| {
        std::env::temp_dir()
            .join("l8db-backup-live")
            .display()
            .to_string()
    }));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn recorder() -> (Emit, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = lines.clone();
    let emit: Emit = Arc::new(move |event: &str, payload: serde_json::Value| {
        if event == "backup-log" {
            for line in payload["lines"].as_array().into_iter().flatten() {
                let line = line.as_str().unwrap_or_default().to_string();
                println!("  | {line}");
                sink.lock().unwrap().push(line);
            }
        }
    });
    (emit, lines)
}

fn request(path: &std::path::Path, options: BackupOptions) -> BackupRequest {
    BackupRequest {
        path: path.display().to_string(),
        options,
        tool_paths: tool_paths(),
    }
}

fn count(result: &QueryResult) -> i64 {
    let row = &result.rows[0];
    let value = match row {
        serde_json::Value::Object(map) => map.values().next().unwrap().clone(),
        serde_json::Value::Array(cells) => cells[0].clone(),
        other => other.clone(),
    };
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        .unwrap()
}

#[tokio::test]
#[ignore]
async fn postgres_backup_restore_round_trips() {
    let Some(url) = env("L8DB_BACKUP_PG_URL") else {
        return;
    };
    let pool = create_pool_state();
    let adapter =
        create_adapter_from_string(DatabaseKind::Postgres, &url, None, pool.clone()).unwrap();
    adapter
        .execute_query("DROP SCHEMA IF EXISTS bk CASCADE; CREATE SCHEMA bk; CREATE TABLE bk.items (id int PRIMARY KEY, label text); INSERT INTO bk.items SELECT g, 'item ' || g FROM generate_series(1, 1000) g; CREATE VIEW bk.even AS SELECT * FROM bk.items WHERE id % 2 = 0")
        .await
        .unwrap();
    let probed = probe(
        DatabaseKind::Postgres,
        &url,
        None,
        &tool_paths(),
        pool.clone(),
    )
    .await;
    println!("{probed:#?}");
    assert!(probed.tools.iter().all(|tool| tool.path.is_some()));
    assert!(probed.server_version.as_deref().unwrap().starts_with("18"));
    assert!(probed.warnings.is_empty());
    let dir = out_dir();
    let password = url::Url::parse(&url)
        .unwrap()
        .password()
        .map(|value| {
            url::form_urlencoded::parse(format!("v={value}").as_bytes())
                .next()
                .unwrap()
                .1
                .into_owned()
        })
        .unwrap();

    for (format, name, restore_options) in [
        ("custom", "pg.dump", BackupOptions::default()),
        (
            "plain",
            "pg.sql",
            BackupOptions {
                exit_on_error: true,
                single_transaction: true,
                ..BackupOptions::default()
            },
        ),
        (
            "directory",
            "pg-dir",
            BackupOptions {
                jobs: Some(2),
                ..BackupOptions::default()
            },
        ),
        ("tar", "pg.tar", BackupOptions::default()),
    ] {
        let target = dir.join(name);
        let _ = std::fs::remove_file(&target);
        let _ = std::fs::remove_dir_all(&target);
        let (emit, lines) = recorder();
        let outcome = backup(
            DatabaseKind::Postgres,
            &url,
            None,
            &request(
                &target,
                BackupOptions {
                    format: format.into(),
                    include_schemas: vec!["bk".into()],
                    jobs: Some(2),
                    ..BackupOptions::default()
                },
            ),
            emit.clone(),
            Some(format!("pg-{format}")),
            pool.clone(),
        )
        .await
        .unwrap();
        println!(
            "{format}: {} bytes, {}",
            outcome.bytes.unwrap(),
            outcome.command
        );
        assert!(outcome.bytes.unwrap() > 0);
        assert!(!outcome.command.contains(&password));
        assert!(lines
            .lock()
            .unwrap()
            .iter()
            .all(|line| !line.contains(&password)));
        adapter
            .execute_query("DROP SCHEMA bk CASCADE")
            .await
            .unwrap();
        let restored = restore(
            DatabaseKind::Postgres,
            &url,
            None,
            &request(&target, restore_options),
            emit,
            None,
            pool.clone(),
        )
        .await
        .unwrap();
        println!("restored {format} via {}", restored.command);
        let rows = adapter
            .execute_query("SELECT count(*) FROM bk.even")
            .await
            .unwrap();
        assert_eq!(count(&rows), 500, "{format}");
    }

    let globals = dir.join("pg-globals.sql");
    let (emit, _) = recorder();
    backup(
        DatabaseKind::Postgres,
        &url,
        None,
        &request(
            &globals,
            BackupOptions {
                format: "globals".into(),
                ..BackupOptions::default()
            },
        ),
        emit.clone(),
        None,
        pool.clone(),
    )
    .await
    .unwrap();
    assert!(std::fs::read_to_string(&globals)
        .unwrap()
        .contains("CREATE ROLE"));

    let read_only = format!(
        "{url}{}options=-c%20default_transaction_read_only%3Don",
        if url.contains('?') { "&" } else { "?" }
    );
    let blocked = restore(
        DatabaseKind::Postgres,
        &read_only,
        None,
        &request(&dir.join("pg.dump"), BackupOptions::default()),
        emit.clone(),
        None,
        pool.clone(),
    )
    .await
    .unwrap_err();
    assert!(blocked.contains("Lesemodus"));

    let _ = std::fs::remove_file(dir.join("pg-fail.dump"));
    let failed = backup(
        DatabaseKind::Postgres,
        &url,
        Some("l8db_missing_database"),
        &request(&dir.join("pg-fail.dump"), BackupOptions::default()),
        emit,
        None,
        pool,
    )
    .await
    .unwrap_err();
    println!("{failed}");
    assert!(failed.contains("pg_dump"));
    assert!(failed.contains("l8db_missing_database"));
    assert!(!failed.contains(&password));
    assert!(!dir.join("pg-fail.dump").exists());
    adapter
        .execute_query("DROP SCHEMA IF EXISTS bk CASCADE")
        .await
        .unwrap();
}

#[tokio::test]
#[ignore]
async fn postgres_old_pg_dump_is_flagged() {
    let (Some(url), Some(old)) = (env("L8DB_BACKUP_PG_URL"), env("L8DB_BACKUP_OLD_PG_DUMP")) else {
        return;
    };
    let pool = create_pool_state();
    let paths: HashMap<String, String> = [("pg_dump".to_string(), old)].into();
    let probed = probe(DatabaseKind::Postgres, &url, None, &paths, pool.clone()).await;
    println!("{:?}", probed.warnings);
    assert!(probed
        .warnings
        .iter()
        .any(|warning| warning.contains("mindestens Version")));
    let (emit, _) = recorder();
    let error = backup(
        DatabaseKind::Postgres,
        &url,
        None,
        &BackupRequest {
            path: out_dir().join("pg-old.dump").display().to_string(),
            options: BackupOptions::default(),
            tool_paths: paths,
        },
        emit,
        None,
        pool,
    )
    .await
    .unwrap_err();
    println!("{error}");
    assert!(error.contains("version mismatch"));
}

#[tokio::test]
#[ignore]
async fn mysql_backup_restore_round_trips() {
    let Some(url) = env("L8DB_BACKUP_MYSQL_URL") else {
        return;
    };
    let pool = create_pool_state();
    let adapter =
        create_adapter_from_string(DatabaseKind::Mysql, &url, None, pool.clone()).unwrap();
    for sql in [
        "DROP TABLE IF EXISTS bk_orders",
        "DROP PROCEDURE IF EXISTS bk_total",
        "CREATE TABLE bk_orders (id INT PRIMARY KEY, amount DECIMAL(10,2))",
        "INSERT INTO bk_orders VALUES (1, 10.5), (2, 20), (3, 30.25)",
        "CREATE PROCEDURE bk_total() SELECT SUM(amount) FROM bk_orders",
    ] {
        adapter.execute_query(sql).await.unwrap();
    }
    let probed = probe(DatabaseKind::Mysql, &url, None, &tool_paths(), pool.clone()).await;
    println!("{probed:#?}");
    assert!(probed.tools.iter().all(|tool| tool.path.is_some()));
    assert!(probed.warnings.is_empty());
    let target = out_dir().join("mysql.sql");
    let (emit, lines) = recorder();
    let outcome = backup(
        DatabaseKind::Mysql,
        &url,
        None,
        &request(
            &target,
            BackupOptions {
                single_transaction: true,
                routines: true,
                triggers: true,
                ..BackupOptions::default()
            },
        ),
        emit.clone(),
        Some("my".into()),
        pool.clone(),
    )
    .await
    .unwrap();
    println!("{} bytes via {}", outcome.bytes.unwrap(), outcome.command);
    assert!(!outcome.command.contains("p@ss"));
    assert!(lines
        .lock()
        .unwrap()
        .iter()
        .all(|line| !line.contains("p@ss")));
    let dump = std::fs::read_to_string(&target).unwrap();
    assert!(dump.contains("CREATE TABLE `bk_orders`"));
    assert!(dump.contains("PROCEDURE `bk_total`"));
    adapter.execute_query("DROP TABLE bk_orders").await.unwrap();
    adapter
        .execute_query("DROP PROCEDURE bk_total")
        .await
        .unwrap();
    restore(
        DatabaseKind::Mysql,
        &url,
        None,
        &request(
            &target,
            BackupOptions {
                exit_on_error: true,
                ..BackupOptions::default()
            },
        ),
        emit,
        Some("my-restore".into()),
        pool.clone(),
    )
    .await
    .unwrap();
    let rows = adapter
        .execute_query("SELECT COUNT(*) FROM bk_orders")
        .await
        .unwrap();
    assert_eq!(count(&rows), 3);
    let routines = adapter
        .execute_query(
            "SELECT COUNT(*) FROM information_schema.routines WHERE routine_name = 'bk_total'",
        )
        .await
        .unwrap();
    assert_eq!(count(&routines), 1);
    adapter.execute_query("DROP TABLE bk_orders").await.unwrap();
    adapter
        .execute_query("DROP PROCEDURE bk_total")
        .await
        .unwrap();
}

#[tokio::test]
#[ignore]
async fn mongodb_backup_restore_round_trips() {
    let Some(url) = env("L8DB_BACKUP_MONGO_URL") else {
        return;
    };
    let pool = create_pool_state();
    let adapter =
        create_adapter_from_string(DatabaseKind::Mongodb, &url, Some("bkdb"), pool.clone())
            .unwrap();
    let _ = adapter.execute_query("db.bk_items.drop()").await;
    adapter
        .execute_query("db.bk_items.insertMany([{a: 1}, {a: 2}, {a: 3}])")
        .await
        .unwrap();
    let target = out_dir().join("mongo.archive.gz");
    let (emit, lines) = recorder();
    let outcome = backup(
        DatabaseKind::Mongodb,
        &url,
        Some("bkdb"),
        &request(
            &target,
            BackupOptions {
                gzip: true,
                ..BackupOptions::default()
            },
        ),
        emit.clone(),
        Some("mongo".into()),
        pool.clone(),
    )
    .await
    .unwrap();
    println!("{} bytes via {}", outcome.bytes.unwrap(), outcome.command);
    assert!(lines
        .lock()
        .unwrap()
        .iter()
        .all(|line| !line.contains("p@ss")));
    adapter.execute_query("db.bk_items.drop()").await.unwrap();
    restore(
        DatabaseKind::Mongodb,
        &url,
        Some("bkdb"),
        &request(
            &target,
            BackupOptions {
                gzip: true,
                drop: true,
                ..BackupOptions::default()
            },
        ),
        emit,
        Some("mongo-restore".into()),
        pool.clone(),
    )
    .await
    .unwrap();
    let result = adapter
        .execute_query("db.bk_items.countDocuments({})")
        .await
        .unwrap();
    println!("{result:?}");
    assert!(serde_json::to_string(&result.rows).unwrap().contains('3'));
    adapter.execute_query("db.bk_items.drop()").await.unwrap();
}
