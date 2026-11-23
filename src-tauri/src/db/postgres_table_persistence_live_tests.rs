use std::time::{Duration, Instant};

use crate::array_editor_target::{open_owned_fixture, owned_url};
use tokio_postgres::NoTls;

#[tokio::test]
#[ignore = "scripts/test-postgres-arrays-local.sh --table-persistence-test creates a private PostgreSQL lab"]
async fn a47_reads_scoped_table_persistence_with_column_details() {
    let (adapter, _, database) = open_owned_fixture().await.unwrap();
    let url = owned_url(&std::env::var("L8DB_A01_LOCAL_PG_URL").unwrap(), &database).unwrap();
    let (client, connection) = tokio_postgres::connect(&url, NoTls).await.unwrap();
    let task = tokio::spawn(connection);
    client
        .batch_execute(
            "CREATE SCHEMA ordinary;
             CREATE UNLOGGED TABLE public.items (id integer PRIMARY KEY, note text DEFAULT 'x');
             COMMENT ON COLUMN public.items.note IS 'synthetic note';
             CREATE TABLE ordinary.items (other_id bigint);
             CREATE UNLOGGED TABLE public.empty_cache ();
             CREATE VIEW public.items_view AS SELECT id FROM public.items;
             CREATE TEMP TABLE items (temp_id integer);",
        )
        .await
        .unwrap();
    let temp_schema: String = client
        .query_one("SELECT pg_my_temp_schema()::regnamespace::text", &[])
        .await
        .unwrap()
        .get(0);

    let details = adapter
        .describe_table_columns("public", "items")
        .await
        .unwrap();
    assert!(details.unlogged);
    assert_eq!(details.columns.len(), 2);
    assert!(details.columns[0].column.is_primary_key);
    let note = &details.columns[1].column;
    assert_eq!(note.comment.as_deref(), Some("synthetic note"));
    assert_eq!(note.column_default.as_deref(), Some("'x'::text"));
    let legacy = adapter
        .list_table_column_metadata("public", "items")
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(&legacy).unwrap(),
        serde_json::to_value(&details.columns).unwrap()
    );

    for (schema, name, first_column) in [
        ("ordinary", "items", "other_id"),
        (temp_schema.as_str(), "items", "temp_id"),
        ("public", "items_view", "id"),
    ] {
        let details = adapter.describe_table_columns(schema, name).await.unwrap();
        assert!(!details.unlogged, "{schema}.{name}");
        assert_eq!(details.columns[0].column.name, first_column);
        assert!(serde_json::to_value(&details)
            .unwrap()
            .get("unlogged")
            .is_none());
    }
    let empty = adapter
        .describe_table_columns("public", "empty_cache")
        .await
        .unwrap();
    assert!(empty.unlogged && empty.columns.is_empty());
    let missing = adapter
        .describe_table_columns("ordinary", "empty_cache")
        .await
        .unwrap();
    assert!(!missing.unlogged && missing.columns.is_empty());

    let columns = (0..250)
        .map(|index| format!("c{index} text"))
        .collect::<Vec<_>>()
        .join(", ");
    client
        .batch_execute(&format!("CREATE UNLOGGED TABLE public.wide ({columns})"))
        .await
        .unwrap();
    let mut durations = Vec::new();
    for _ in 0..10 {
        let start = Instant::now();
        let wide = adapter
            .describe_table_columns("public", "wide")
            .await
            .unwrap();
        durations.push(start.elapsed());
        assert!(wide.unlogged);
        assert_eq!(wide.columns.len(), 250);
    }
    durations.sort_unstable();
    eprintln!(
        "A47 250-column metadata: median {:?}, p95 {:?}",
        durations[5], durations[9]
    );
    assert!(durations[9] < Duration::from_millis(250));

    client
        .batch_execute("ALTER TABLE public.items SET LOGGED")
        .await
        .unwrap();
    assert!(
        !adapter
            .describe_table_columns("public", "items")
            .await
            .unwrap()
            .unlogged
    );
    drop(client);
    task.await.unwrap().unwrap();
}
