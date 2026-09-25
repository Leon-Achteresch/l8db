use std::io::Write;

use super::csv_stream::CsvFileSource;
use super::import_source::ImportFormat;
use super::pool::create_pool_state;
use super::provider::DatabaseKind;
use super::table_copy::{copy_table, CopyMode, CopySource, TableCopyRequest};
use super::{create_adapter_from_string, CsvConflict, CsvImportRequest};

struct Target {
    kind: DatabaseKind,
    url: String,
    schema: &'static str,
    ddl: &'static str,
}

fn targets(sqlite: &str) -> Vec<Target> {
    let mut targets = vec![Target {
        kind: DatabaseKind::Sqlite,
        url: sqlite.to_string(),
        schema: "main",
        ddl: "CREATE TABLE ie_items (id INTEGER PRIMARY KEY, name VARCHAR(50) NOT NULL, amount DECIMAL(10,2), flag BOOLEAN, created TIMESTAMP)",
    }];
    if let Ok(url) = std::env::var("L8DB_IE_PG_URL") {
        targets.push(Target {
            kind: DatabaseKind::Postgres,
            url,
            schema: "public",
            ddl: "CREATE TABLE ie_items (id int PRIMARY KEY, name varchar(50) NOT NULL, amount numeric(10,2), flag boolean, created timestamp)",
        });
    }
    if let Ok(url) = std::env::var("L8DB_IE_MYSQL_URL") {
        targets.push(Target {
            kind: DatabaseKind::Mysql,
            url,
            schema: "testdb",
            ddl: "CREATE TABLE ie_items (id int PRIMARY KEY, name varchar(50) NOT NULL, amount decimal(10,2), flag tinyint(1), created datetime)",
        });
    }
    targets
}

async fn import(target: &Target, request: &CsvImportRequest) -> super::CsvImportOutcome {
    let pool = create_pool_state();
    if target.kind == DatabaseKind::Postgres {
        return create_adapter_from_string(target.kind, &target.url, None, pool)
            .unwrap()
            .csv_import(request)
            .await
            .unwrap();
    }
    super::import::import(target.kind, &target.url, None, pool, request)
        .await
        .unwrap()
}

async fn scalar(target: &Target, sql: &str) -> String {
    let result = create_adapter_from_string(target.kind, &target.url, None, create_pool_state())
        .unwrap()
        .execute_query(sql)
        .await
        .unwrap();
    let column = &result.columns[0];
    super::export::value_text(&result.rows[0][column]).unwrap_or_default()
}

async fn exec(target: &Target, sql: &str) {
    let _ = create_adapter_from_string(target.kind, &target.url, None, create_pool_state())
        .unwrap()
        .execute_query(sql)
        .await;
}

fn csv_file(rows: usize, bad_at: Option<usize>, suffix: &str) -> tempfile::NamedTempFile {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    writeln!(file, "id;name;amount;flag;created").unwrap();
    for n in 1..=rows {
        let amount = if Some(n) == bad_at {
            "kaputt".to_string()
        } else {
            format!("{}.25", n)
        };
        writeln!(
            file,
            "{n};\"name {n}{suffix}; \"\"q\"\"\";{amount};{};2024-01-02 03:04:05",
            if n % 2 == 0 { "true" } else { "false" }
        )
        .unwrap();
    }
    file
}

fn request(target: &Target, path: &str, conflict: Option<CsvConflict>) -> CsvImportRequest {
    CsvImportRequest {
        file: Some(CsvFileSource {
            path: path.into(),
            delimiter: ";".into(),
            quote: "\"".into(),
            has_header: true,
            empty_as_null: true,
            indices: vec![0, 1, 2, 3, 4],
            ..Default::default()
        }),
        conflict,
        schema: target.schema.into(),
        table: "ie_items".into(),
        columns: ["id", "name", "amount", "flag", "created"]
            .map(String::from)
            .to_vec(),
        rows: vec![],
    }
}

async fn primary_key(target: &Target) -> String {
    create_adapter_from_string(target.kind, &target.url, None, create_pool_state())
        .unwrap()
        .list_constraints(target.schema, "ie_items")
        .await
        .unwrap()
        .into_iter()
        .find(|c| c.constraint_type == "PRIMARY KEY")
        .unwrap()
        .name
}

#[tokio::test]
#[ignore]
async fn file_import_batches_conflicts_and_failures_across_families() {
    let directory = tempfile::tempdir().unwrap();
    let sqlite = directory.path().join("ie.db");
    for target in targets(sqlite.to_str().unwrap()) {
        exec(&target, "DROP TABLE ie_items").await;
        exec(&target, target.ddl).await;
        let file = csv_file(2500, None, "");
        let outcome = import(
            &target,
            &request(&target, file.path().to_str().unwrap(), None),
        )
        .await;
        assert_eq!(outcome.error, None, "{:?}", target.kind);
        assert_eq!(outcome.inserted_rows, 2500);
        assert_eq!(
            scalar(&target, "SELECT COUNT(*) FROM ie_items").await,
            "2500"
        );
        let name = scalar(&target, "SELECT name FROM ie_items WHERE id = 7").await;
        assert_eq!(name, "name 7; \"q\"");
        let pk = primary_key(&target).await;
        let skip = import(
            &target,
            &request(
                &target,
                file.path().to_str().unwrap(),
                Some(CsvConflict {
                    constraint: pk.clone(),
                    update_columns: vec![],
                }),
            ),
        )
        .await;
        assert_eq!(
            (skip.inserted_rows, skip.skipped_rows, skip.error.clone()),
            (0, 2500, None),
            "{:?}",
            target.kind
        );
        let changed = csv_file(2600, None, "x");
        let upsert = import(
            &target,
            &request(
                &target,
                changed.path().to_str().unwrap(),
                Some(CsvConflict {
                    constraint: pk,
                    update_columns: vec!["name".into()],
                }),
            ),
        )
        .await;
        assert_eq!(
            (
                upsert.inserted_rows,
                upsert.updated_rows,
                upsert.error.clone()
            ),
            (100, 2500, None),
            "{:?}",
            target.kind
        );
        assert_eq!(
            scalar(&target, "SELECT name FROM ie_items WHERE id = 7").await,
            "name 7x; \"q\""
        );
        exec(&target, "DELETE FROM ie_items").await;
        let broken = csv_file(2500, Some(1700), "");
        let failed = import(
            &target,
            &request(&target, broken.path().to_str().unwrap(), None),
        )
        .await;
        if target.kind != DatabaseKind::Sqlite {
            assert_eq!(failed.failed_row, Some(1700), "{:?}", target.kind);
            assert!(failed.error.unwrap().contains("zurückgerollt"));
            assert_eq!(scalar(&target, "SELECT COUNT(*) FROM ie_items").await, "0");
        }
        exec(&target, "DELETE FROM ie_items").await;
        let mut json = tempfile::NamedTempFile::new().unwrap();
        write!(
            json,
            "[{{\"id\": 1, \"name\": \"j\", \"flag\": true, \"amount\": 2.5}}, {{\"id\": 2, \"name\": \"k\", \"created\": \"2024-05-06T07:08:09\"}}]"
        )
        .unwrap();
        let json_request = CsvImportRequest {
            file: Some(CsvFileSource {
                path: json.path().to_str().unwrap().into(),
                format: ImportFormat::Json,
                keys: ["id", "name", "flag", "amount", "created"]
                    .map(String::from)
                    .to_vec(),
                indices: vec![0, 1, 2, 3, 4],
                ..Default::default()
            }),
            conflict: None,
            schema: target.schema.into(),
            table: "ie_items".into(),
            columns: ["id", "name", "flag", "amount", "created"]
                .map(String::from)
                .to_vec(),
            rows: vec![],
        };
        let outcome = import(&target, &json_request).await;
        assert_eq!(
            (outcome.inserted_rows, outcome.error),
            (2, None),
            "{:?}",
            target.kind
        );
    }
}

#[tokio::test]
#[ignore]
async fn copy_table_between_families() {
    let directory = tempfile::tempdir().unwrap();
    let sqlite = directory.path().join("copy.db");
    let all = targets(sqlite.to_str().unwrap());
    if all.len() < 3 {
        return;
    }
    let (sqlite, pg, mysql) = (&all[0], &all[1], &all[2]);
    exec(pg, "DROP TABLE IF EXISTS ie_source").await;
    exec(pg, "CREATE TABLE ie_source (id bigint PRIMARY KEY, title varchar(80) NOT NULL, price numeric(12,3), active boolean, born date, at timestamptz, payload jsonb, raw bytea, note text)").await;
    exec(pg, "CREATE INDEX ie_source_title ON ie_source (title)").await;
    exec(pg, "INSERT INTO ie_source SELECT g, 'Titel ' || g || ' ''x''', g * 1.5, g % 2 = 0, DATE '2024-01-01' + g, TIMESTAMPTZ '2024-01-01 10:00:00+00' + g * interval '1 hour', jsonb_build_object('n', g), decode('deadbeef', 'hex'), CASE WHEN g % 3 = 0 THEN NULL ELSE repeat('ä', 10) END FROM generate_series(1, 2345) g").await;
    for (source, target, schema, table) in [
        (pg, mysql, "testdb", "ie_copy"),
        (mysql, sqlite, "main", "ie_copy"),
        (sqlite, pg, "public", "ie_copy_back"),
    ] {
        exec(target, &format!("DROP TABLE {table}")).await;
        let source_table = if source.kind == DatabaseKind::Postgres {
            "ie_source"
        } else {
            "ie_copy"
        };
        let outcome = copy_table(
            target.kind,
            &target.url,
            None,
            create_pool_state(),
            &TableCopyRequest {
                source: CopySource {
                    kind: source.kind,
                    connection_string: source.url.clone(),
                    database: None,
                    schema: source.schema.into(),
                    table: source_table.into(),
                },
                target_schema: schema.into(),
                target_table: table.into(),
                mode: CopyMode::Create,
                include_primary_key: true,
                include_indexes: true,
                dry_run: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            outcome.error, None,
            "{:?} -> {:?}: {outcome:?}",
            source.kind, target.kind
        );
        assert_eq!(outcome.rows, 2345);
        assert_eq!(
            scalar(target, &format!("SELECT COUNT(*) FROM {table}")).await,
            "2345"
        );
        let title = scalar(target, &format!("SELECT title FROM {table} WHERE id = 5")).await;
        assert_eq!(title, "Titel 5 'x'");
        println!(
            "{:?} -> {:?}: {:?} {:?}",
            source.kind, target.kind, outcome.statements, outcome.warnings
        );
    }
    let back = scalar(pg, "SELECT count(*) FROM ie_copy_back b JOIN ie_source s USING (id) WHERE b.price = s.price AND b.active = s.active AND b.born = s.born").await;
    assert_eq!(back, "2345");
    let append = copy_table(
        pg.kind,
        &pg.url,
        None,
        create_pool_state(),
        &TableCopyRequest {
            source: CopySource {
                kind: mysql.kind,
                connection_string: mysql.url.clone(),
                database: None,
                schema: mysql.schema.into(),
                table: "ie_copy".into(),
            },
            target_schema: "public".into(),
            target_table: "ie_copy_back".into(),
            mode: CopyMode::Truncate,
            include_primary_key: true,
            include_indexes: false,
            dry_run: false,
        },
    )
    .await
    .unwrap();
    assert_eq!((append.rows, append.error), (2345, None));
    let failing = copy_table(
        pg.kind,
        &pg.url,
        None,
        create_pool_state(),
        &TableCopyRequest {
            source: CopySource {
                kind: mysql.kind,
                connection_string: mysql.url.clone(),
                database: None,
                schema: mysql.schema.into(),
                table: "ie_copy".into(),
            },
            target_schema: "public".into(),
            target_table: "ie_copy_back".into(),
            mode: CopyMode::Append,
            include_primary_key: true,
            include_indexes: false,
            dry_run: false,
        },
    )
    .await
    .unwrap();
    assert!(failing.error.is_some());
    assert_eq!(
        scalar(pg, "SELECT count(*) FROM ie_copy_back").await,
        "2345"
    );
    exec(pg, "DROP TABLE ie_source").await;
    exec(pg, "DROP TABLE ie_copy_back").await;
    exec(mysql, "DROP TABLE ie_copy").await;
}
