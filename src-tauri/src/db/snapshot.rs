use super::{connection, execution, map_pg_err, quote_ident, validate_table_filter, TableData};
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRequest {
    pub schema: String,
    pub table: String,
    pub filter: Option<String>,
    pub allow_raw_filter: bool,
    pub order_by: Option<String>,
    pub order_desc: bool,
    pub is_view: bool,
    pub max_rows: usize,
}

pub async fn read(
    connection_string: &str,
    database: Option<&str>,
    request: &SnapshotRequest,
) -> Result<TableData, String> {
    let (config, ssl) = connection::parse_connection(connection_string, database)?;
    let client = execution::connect_postgres(&config, ssl).await?;
    let result = execution::postgres(&client, ssl, None, async {
        client.batch_execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY").await.map_err(map_pg_err)?;
        let columns = client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position", &[&request.schema, &request.table]).await.map_err(map_pg_err)?.iter().map(|row| row.get::<_, String>(0)).collect::<Vec<_>>();
        if columns.is_empty() { return Err("Keine Exportspalten gefunden.".into()); }
        let filter = request.filter.as_deref().map(str::trim).filter(|value| !value.is_empty());
        if !request.allow_raw_filter { if let Some(filter) = filter { validate_table_filter(filter)?; } }
        let mut order = Vec::new();
        if let Some(column) = &request.order_by {
            if !columns.contains(column) { return Err("Unbekannte Sortierspalte.".into()); }
            order.push(format!("{} {}", quote_ident(column), if request.order_desc { "DESC" } else { "ASC" }));
        }
        if !request.is_view { order.push("t.ctid".into()); }
        let sql = format!("DECLARE l8db_snapshot NO SCROLL CURSOR FOR SELECT to_jsonb(t) FROM {}.{} t{}{}", quote_ident(&request.schema), quote_ident(&request.table), filter.map(|value| format!(" WHERE {value}")).unwrap_or_default(), if order.is_empty() { String::new() } else { format!(" ORDER BY {}", order.join(", ")) });
        client.query(&sql, &[]).await.map_err(map_pg_err)?;
        let mut rows = Vec::new();
        let mut bytes = 0;
        loop {
            let page = client.query("FETCH FORWARD 1000 FROM l8db_snapshot", &[]).await.map_err(map_pg_err)?;
            if page.is_empty() { break; }
            for row in page {
                let value: serde_json::Value = row.get(0);
                bytes += serde_json::to_vec(&value).map_err(|error| error.to_string())?.len();
                if bytes > 64 * 1024 * 1024 { return Err("Der Lesevorgang überschreitet 64 MiB Rohdaten je Seite. Filter einschränken oder CSV verwenden.".into()); }
                if rows.len() >= request.max_rows.min(1_048_576) { return Err("Die Daten überschreiten das gewählte Zeilenlimit.".into()); }
                rows.push(value);
            }
            execution::progress(rows.len() as u64);
        }
        Ok(TableData { columns, rows })
    }).await;
    let cleanup = client.batch_execute("ROLLBACK").await.map_err(map_pg_err);
    cleanup?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn snapshot_keeps_rows_during_concurrent_changes() {
        let url = std::env::var("L8DB_E2E_PG_URL").expect("PostgreSQL lab required");
        let (config, ssl) = connection::parse_connection(&url, None).unwrap();
        let client = execution::connect_postgres(&config, ssl).await.unwrap();
        client.batch_execute("DROP TABLE IF EXISTS snapshot_test; CREATE TABLE snapshot_test AS SELECT n AS id FROM generate_series(1, 3000) n").await.unwrap();
        let writer = execution::connect_postgres(&config, ssl).await.unwrap();
        let changed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let signal = changed.clone();
        let request = SnapshotRequest {
            schema: "public".into(),
            table: "snapshot_test".into(),
            filter: None,
            allow_raw_filter: false,
            order_by: Some("id".into()),
            order_desc: false,
            is_view: false,
            max_rows: 4000,
        };
        let snapshot = execution::with_progress(
            move |_| {
                signal.store(true, std::sync::atomic::Ordering::SeqCst);
            },
            read(&url, None, &request),
        );
        let changes = async {
            while !changed.load(std::sync::atomic::Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
            writer.batch_execute("DELETE FROM snapshot_test WHERE id = 2000; UPDATE snapshot_test SET id = 0 WHERE id = 2500; INSERT INTO snapshot_test VALUES (4000)").await.unwrap();
        };
        let (result, _) = tokio::join!(snapshot, changes);
        let rows = result.unwrap().rows;
        assert_eq!(rows.len(), 3000);
        for (index, row) in rows.iter().enumerate() {
            assert_eq!(row["id"], index + 1);
        }
        client
            .batch_execute("DROP TABLE snapshot_test")
            .await
            .unwrap();
    }
}
