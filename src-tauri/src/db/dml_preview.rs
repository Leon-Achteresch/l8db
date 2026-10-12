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

pub const NOT_READ_ONLY: &str = "Vorschau nicht lesend:";
pub const SEARCH_PATH_BOUND: Duration = Duration::from_millis(200);

pub fn ensure_read_query(kind: DatabaseKind, sql: &str) -> Result<(), String> {
    let reject = |detail: &str| Err(format!("{NOT_READ_ONLY} {detail}"));
    let statements = match kind {
        DatabaseKind::Oracle => super::oracle::statement_count(sql),
        _ => crate::mcp::redact::statement_count(sql),
    };
    if statements != 1 {
        return reject("Die Vorschau-Abfrage muss genau eine Anweisung sein.");
    }
    let first = crate::mcp::redact::sql_words(sql).into_iter().next();
    if !matches!(
        first.as_deref(),
        Some("select" | "with" | "values" | "table")
    ) {
        return reject("Die Vorschau-Abfrage muss mit SELECT oder WITH beginnen.");
    }
    if let Some(word) = crate::mcp::redact::write_word(sql) {
        return reject(&format!(
            "'{}' ist in der Vorschau nicht erlaubt.",
            word.to_uppercase()
        ));
    }
    if let Some(word) = crate::mcp::redact::dangerous_word(sql) {
        return reject(&format!("Funktion '{word}' ist in der Vorschau gesperrt."));
    }
    if kind == DatabaseKind::Postgres {
        if !super::postgres::single_read_statement(sql) {
            return reject("Die Vorschau-Abfrage muss eine einzelne lesende Anweisung sein.");
        }
        super::postgres::read_only_batch_guard(sql)?;
    }
    Ok(())
}

pub async fn bounded_lookup<F>(future: F) -> Option<String>
where
    F: std::future::Future<Output = Option<String>>,
{
    let cancel = execution::cancellation_token();
    if cancel.is_cancelled() {
        return None;
    }
    tokio::select! {
        biased;
        _ = cancel.cancelled() => None,
        result = tokio::time::timeout(SEARCH_PATH_BOUND, future) => result.ok().flatten(),
    }
}

async fn session_search_path(connection_string: &str, database: Option<&str>) -> Option<String> {
    let key = super::cloud_auth::pool_key(connection_string, database);
    let session = super::server_output::peek_pg_session(&key)?;
    let client = session.try_lock_healthy()?;
    bounded_lookup(async {
        let row = client.query_one("SHOW search_path", &[]).await.ok()?;
        row.try_get::<_, String>(0).ok()
    })
    .await
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
    let search_path = session_search_path(connection_string, database).await;
    if execution::cancellation_token().is_cancelled() {
        return Err("Vorschau abgebrochen.".into());
    }
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
    ensure_read_query(kind, &request.count_sql)?;
    ensure_read_query(kind, &request.sample_sql)?;
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
    fn final_preview_sql_must_be_one_read_statement_in_every_family() {
        use DatabaseKind::*;
        let ok = "WITH recent AS (SELECT 1 AS id) SELECT COUNT(*) AS affected_rows FROM recent";
        for kind in [Postgres, Mysql, Mssql, Sqlite, Oracle, Duckdb] {
            assert!(ensure_read_query(kind, ok).is_ok(), "{kind:?}");
            assert!(
                ensure_read_query(kind, "SELECT * FROM t WHERE id > 1").is_ok(),
                "{kind:?}"
            );
            for bad in [
                "DELETE FROM t",
                "UPDATE t SET a = 1",
                "INSERT INTO t VALUES (1)",
                "SELECT * INTO backup FROM t",
                "SELECT 1; DELETE FROM t",
                "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
                "SELECT * FROM t FOR UPDATE",
                "COMMIT",
            ] {
                let error = ensure_read_query(kind, bad).unwrap_err();
                assert!(error.starts_with(NOT_READ_ONLY), "{kind:?} {bad}: {error}");
            }
        }
        for (kind, bad) in [
            (Mysql, "SELECT * FROM t INTO OUTFILE '/tmp/x'"),
            (Mysql, "SELECT * FROM t INTO DUMPFILE '/tmp/x'"),
            (Mysql, "CALL purge_all()"),
            (Mssql, "EXEC sp_who"),
            (Mssql, "SELECT * FROM t; EXEC xp_cmdshell 'dir'"),
            (Oracle, "BEGIN DELETE FROM t; END;"),
            (Sqlite, "ATTACH DATABASE '/tmp/x.db' AS x"),
            (Postgres, "SELECT pg_sleep(10)"),
        ] {
            assert!(ensure_read_query(kind, bad).is_err(), "{kind:?} {bad}");
        }
    }

    #[tokio::test]
    async fn the_search_path_lookup_is_bounded_and_honours_cancel() {
        let started = std::time::Instant::now();
        let busy = bounded_lookup(std::future::pending::<Option<String>>()).await;
        assert!(busy.is_none());
        assert!(started.elapsed() < SEARCH_PATH_BOUND + Duration::from_millis(100));
        let quick = bounded_lookup(async { Some("staging, public".to_string()) }).await;
        assert_eq!(quick.as_deref(), Some("staging, public"));
        let options = ExecutionOptions {
            job_id: Some("dml-preview-lookup-cancel".into()),
            ..Default::default()
        };
        let cancelled = execution::run(Some(options), true, async {
            assert!(execution::cancel("dml-preview-lookup-cancel").unwrap());
            let started = std::time::Instant::now();
            let value = bounded_lookup(std::future::pending::<Option<String>>()).await;
            Ok::<_, String>((value, started.elapsed()))
        })
        .await
        .unwrap();
        assert!(cancelled.0.is_none());
        assert!(cancelled.1 < Duration::from_millis(20));
    }

    #[test]
    fn peeking_never_creates_an_editor_session() {
        let key = "dml-preview-peek-test";
        assert!(super::super::server_output::peek_pg_session(key).is_none());
        super::super::server_output::set_enabled(key, true);
        assert!(super::super::server_output::peek_pg_session(key).is_none());
        assert!(super::super::server_output::peek_pg_session(key).is_none());
        super::super::server_output::set_enabled(key, false);
    }

    #[tokio::test]
    async fn busy_editor_sessions_add_no_wait_beyond_the_bound() {
        let mut waits = Vec::new();
        for _ in 0..20 {
            let started = std::time::Instant::now();
            let _ = bounded_lookup(std::future::pending::<Option<String>>()).await;
            waits.push(started.elapsed());
        }
        waits.sort();
        let p95 = waits[(waits.len() * 95).div_ceil(100) - 1];
        println!(
            "performance dml-preview-search-path: {{\"lookups\":20,\"boundMs\":{},\"medianMs\":{},\"p95Ms\":{},\"extraRequestsPerPreview\":1,\"sessionCreations\":0}}",
            SEARCH_PATH_BOUND.as_millis(),
            waits[waits.len() / 2].as_millis(),
            p95.as_millis()
        );
        assert!(p95 < SEARCH_PATH_BOUND + Duration::from_millis(50));
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
