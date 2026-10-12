use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::execution::{self, ExecutionOptions};
use super::pool::PoolState;
use super::provider::DatabaseKind;
use super::{create_adapter_from_string, QueryResult};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DmlPreviewRequest {
    pub count_sql: String,
    pub sample_sql: String,
    pub limit: usize,
    #[serde(default)]
    pub lock_timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DmlPreviewResponse {
    pub count: QueryResult,
    pub sample: Option<QueryResult>,
    pub read_only: bool,
    pub search_path: Option<String>,
}

pub fn postgres_prelude(timeout: Duration, lock_timeout_ms: Option<u64>) -> String {
    let mut prelude = format!(
        "BEGIN READ ONLY; SET LOCAL statement_timeout = {}",
        timeout.as_millis()
    );
    if let Some(lock) = lock_timeout_ms.filter(|ms| *ms > 0) {
        prelude.push_str(&format!("; SET LOCAL lock_timeout = {lock}"));
    }
    prelude
}

pub fn ensure_single_read(sql: &str, postgres: bool) -> Result<(), String> {
    let rejected =
        || Err("Die Vorschau-Abfrage muss eine einzelne lesende Anweisung sein.".to_string());
    if super::split_statements(sql).len() != 1 {
        return rejected();
    }
    if postgres {
        if !super::postgres::single_read_statement(sql) {
            return rejected();
        }
        super::postgres::read_only_batch_guard(sql)?;
    }
    Ok(())
}

async fn session_search_path(
    connection_string: &str,
    database: Option<&str>,
    config: &tokio_postgres::Config,
    ssl: &super::connection::PgTls,
) -> Option<String> {
    let key = super::cloud_auth::pool_key(connection_string, database);
    if !super::server_output::is_enabled(&key) {
        return None;
    }
    let session = super::server_output::pg_session(&key, config, ssl)
        .await
        .ok()??;
    let client = session.lock().await.ok()?;
    let row = client.query_one("SHOW search_path", &[]).await.ok()?;
    row.try_get::<_, String>(0).ok()
}

pub fn count_of(result: &QueryResult) -> Option<f64> {
    let column = result.columns.first()?;
    let value = result.rows.first()?.get(column)?;
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
}

pub fn bounded(mut result: QueryResult, limit: usize) -> QueryResult {
    result.truncated |= result.rows.len() > limit;
    result.rows.truncate(limit);
    result
}

async fn postgres(
    connection_string: &str,
    database: Option<&str>,
    request: &DmlPreviewRequest,
    limit: usize,
) -> Result<DmlPreviewResponse, String> {
    let (config, ssl) = super::connection::parse_connection(connection_string, database)?;
    let search_path = session_search_path(connection_string, database, &config, &ssl).await;
    let client = execution::connect_postgres(&config, &ssl).await?;
    let outcome = execution::postgres(&client, &ssl, None, async {
        client
            .batch_execute(&postgres_prelude(
                execution::query_duration(),
                request.lock_timeout_ms,
            ))
            .await
            .map_err(super::map_pg_err)?;
        if let Some(path) = &search_path {
            client
                .query("SELECT set_config('search_path', $1, true)", &[path])
                .await
                .map_err(super::map_pg_err)?;
        }
        let count = super::postgres::run_simple_query(&client, &request.count_sql).await?;
        let sample = if count_of(&count) == Some(0.0) {
            None
        } else {
            let rows = execution::with_row_limit(
                limit + 1,
                super::postgres::run_simple_query(&client, &request.sample_sql),
            )
            .await?;
            Some(bounded(rows, limit))
        };
        Ok((count, sample))
    })
    .await;
    drop(client);
    outcome.map(|(count, sample)| DmlPreviewResponse {
        count,
        sample,
        read_only: true,
        search_path,
    })
}

async fn pooled(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    pool_state: PoolState,
    request: &DmlPreviewRequest,
    limit: usize,
) -> Result<DmlPreviewResponse, String> {
    let adapter = create_adapter_from_string(kind, connection_string, database, pool_state)?;
    let count =
        execution::with_row_limit(2, adapter.execute_pooled_query(&request.count_sql)).await?;
    let sample = if count_of(&count) == Some(0.0) {
        None
    } else {
        let rows =
            execution::with_row_limit(limit + 1, adapter.execute_pooled_query(&request.sample_sql))
                .await?;
        Some(bounded(rows, limit))
    };
    Ok(DmlPreviewResponse {
        count,
        sample,
        read_only: false,
        search_path: None,
    })
}

#[tauri::command]
pub async fn preview_dml(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    request: DmlPreviewRequest,
    pool_state: tauri::State<'_, PoolState>,
    options: Option<ExecutionOptions>,
) -> Result<DmlPreviewResponse, String> {
    let capabilities = kind.capabilities();
    if !capabilities.dml_preview {
        return Err("Die DML-Vorschau wird für diese Datenbankfamilie nicht unterstützt.".into());
    }
    let is_postgres = kind == DatabaseKind::Postgres;
    ensure_single_read(&request.count_sql, is_postgres)?;
    ensure_single_read(&request.sample_sql, is_postgres)?;
    let limit = request.limit.clamp(1, super::commands::MAX_RESULT_ROWS);
    execution::run_query(options, capabilities.query_cancel, async {
        match kind {
            DatabaseKind::Postgres => {
                postgres(&connection_string, database.as_deref(), &request, limit).await
            }
            _ => {
                pooled(
                    kind,
                    &connection_string,
                    database.as_deref(),
                    pool_state.inner().clone(),
                    &request,
                    limit,
                )
                .await
            }
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(columns: &[&str], rows: Vec<serde_json::Value>) -> QueryResult {
        QueryResult {
            columns: columns.iter().map(|column| column.to_string()).collect(),
            rows,
            rows_affected: None,
            execution_time_ms: 0,
            truncated: false,
        }
    }

    #[test]
    fn postgres_preview_runs_read_only_with_a_server_timeout() {
        assert_eq!(
            postgres_prelude(Duration::from_secs(10), None),
            "BEGIN READ ONLY; SET LOCAL statement_timeout = 10000"
        );
        assert_eq!(
            postgres_prelude(Duration::from_secs(10), Some(3000)),
            "BEGIN READ ONLY; SET LOCAL statement_timeout = 10000; SET LOCAL lock_timeout = 3000"
        );
    }

    #[test]
    fn final_preview_sql_must_be_one_read_statement() {
        let ok = "WITH recent AS (SELECT 1) SELECT COUNT(*) FROM recent";
        assert!(ensure_single_read(ok, true).is_ok());
        assert!(ensure_single_read("SELECT 1", false).is_ok());
        for bad in [
            "WITH v AS (SELECT 1); COMMIT; DELETE FROM t",
            "SELECT 1; SELECT 2",
            "DELETE FROM t",
            "COMMIT",
        ] {
            assert!(ensure_single_read(bad, true).is_err(), "{bad}");
        }
        assert!(ensure_single_read("SELECT 1; DELETE FROM t", false).is_err());
    }

    #[test]
    fn counts_are_read_from_numbers_and_text() {
        let numeric = result(
            &["affected_rows"],
            vec![serde_json::json!({"affected_rows": 7})],
        );
        let text = result(
            &["affected_rows"],
            vec![serde_json::json!({"affected_rows": "520"})],
        );
        assert_eq!(count_of(&numeric), Some(7.0));
        assert_eq!(count_of(&text), Some(520.0));
        assert_eq!(count_of(&result(&[], vec![])), None);
    }

    #[test]
    fn samples_are_bounded_and_marked_truncated() {
        let rows = (0..5).map(|id| serde_json::json!({ "id": id })).collect();
        let sample = bounded(result(&["id"], rows), 3);
        assert_eq!(sample.rows.len(), 3);
        assert!(sample.truncated);
    }

    #[tokio::test]
    #[ignore]
    async fn postgres_preview_is_isolated_read_only_and_discards_its_connection() {
        let url = std::env::var("L8DB_E2E_PG_URL")
            .unwrap_or_else(|_| "postgresql://postgres:testpw@127.0.0.1:5433/testdb".into());
        let (config, ssl) = super::super::connection::parse_connection(&url, None).unwrap();
        let setup = execution::connect_postgres(&config, &ssl).await.unwrap();
        setup
            .batch_execute(
                "DROP TABLE IF EXISTS l8db_preview_e2e; CREATE TABLE l8db_preview_e2e(id int); \
                 INSERT INTO l8db_preview_e2e SELECT generate_series(1, 25)",
            )
            .await
            .unwrap();
        let request = DmlPreviewRequest {
            count_sql: "SELECT COUNT(*) AS affected_rows FROM l8db_preview_e2e WHERE id > 5".into(),
            sample_sql: "SELECT * FROM l8db_preview_e2e WHERE id > 5 LIMIT 10".into(),
            limit: 10,
            lock_timeout_ms: Some(3000),
        };
        let preview = postgres(&url, None, &request, 10).await.unwrap();
        assert_eq!(count_of(&preview.count), Some(20.0));
        assert_eq!(preview.sample.unwrap().rows.len(), 10);
        let write = DmlPreviewRequest {
            count_sql: "INSERT INTO l8db_preview_e2e VALUES (99) RETURNING 1".into(),
            ..request
        };
        let error = postgres(&url, None, &write, 10).await.unwrap_err();
        assert!(
            error.contains("25006") || error.contains("read-only"),
            "{error}"
        );
        let count: i64 = setup
            .query_one("SELECT count(*) FROM l8db_preview_e2e", &[])
            .await
            .unwrap()
            .get(0);
        assert_eq!(count, 25);
        setup
            .batch_execute("DROP TABLE l8db_preview_e2e")
            .await
            .unwrap();
    }
}
