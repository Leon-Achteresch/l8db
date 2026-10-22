use crate::supabase::{
    client, cloud_ref, database_execute, database_query, quote_identifier, response_json, token,
    validate_ref,
};
use serde::Serialize;
use serde_json::Value;

const SESSION_LIMIT: usize = 200;
const LIST_LIMIT: usize = 100;
const LOG_LIMIT_MAX: u32 = 500;
const ADVISOR_LIMIT: usize = 500;
const MAX_SEARCH_CHARS: usize = 200;
const MAX_WINDOW_MINUTES: u32 = 7 * 24 * 60;

pub(crate) const LOG_SOURCES: &[&str] = &[
    "edge_logs",
    "postgres_logs",
    "auth_logs",
    "function_edge_logs",
    "function_logs",
    "storage_logs",
    "realtime_logs",
];

const USAGE_INTERVALS: &[&str] = &["15min", "30min", "1hr", "3hr", "1day", "3day", "7day"];

#[derive(Debug, Serialize, PartialEq)]
pub struct ObservabilityPage {
    pub rows: Vec<Value>,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
pub struct ObservabilityLocks {
    pub blocked: ObservabilityPage,
    pub locks: ObservabilityPage,
}

#[derive(Debug, Serialize)]
pub struct ObservabilityStatements {
    pub installed: bool,
    pub available: bool,
    pub schema: Option<String>,
    pub page: ObservabilityPage,
}

#[derive(Debug, Serialize)]
pub struct ObservabilityHealth {
    pub database_size: Option<i64>,
    pub max_connections: Option<i64>,
    pub table_hit_ratio: Option<f64>,
    pub index_hit_ratio: Option<f64>,
    pub connections: ObservabilityPage,
    pub long_transactions: ObservabilityPage,
    pub replication_slots: ObservabilityPage,
}

#[derive(Debug, Serialize)]
pub struct ObservabilitySizes {
    pub tables: ObservabilityPage,
    pub indexes: ObservabilityPage,
    pub unused_indexes: ObservabilityPage,
}

pub(crate) fn page(value: Option<&Value>, limit: usize) -> ObservabilityPage {
    let mut rows = value.and_then(Value::as_array).cloned().unwrap_or_default();
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    ObservabilityPage { rows, has_more }
}

async fn json_data(reference: &str, sql: &str, parameters: &[Value]) -> Result<Value, String> {
    let mut rows: Vec<Value> = database_query(reference, sql, parameters).await?;
    if rows.is_empty() {
        return Ok(Value::Null);
    }
    Ok(rows
        .swap_remove(0)
        .get_mut("data")
        .map(Value::take)
        .unwrap_or(Value::Null))
}

const SESSIONS_SQL: &str = "select coalesce(json_agg(t), '[]'::json) as data from (\
    select a.pid, a.usename, a.datname, a.application_name, host(a.client_addr) as client_addr, \
    a.backend_type, a.state, a.wait_event_type, a.wait_event, left(a.query, 2000) as query, \
    a.backend_start, a.query_start, a.xact_start, \
    round((extract(epoch from now() - a.query_start) * 1000)::numeric)::bigint as duration_ms, \
    round((extract(epoch from now() - a.xact_start) * 1000)::numeric)::bigint as xact_ms, \
    pg_blocking_pids(a.pid) as blocked_by \
    from pg_stat_activity a \
    where a.pid <> pg_backend_pid() and ($1::bool or coalesce(a.state, '') not in ('idle', '')) \
    order by a.query_start asc nulls last limit 201) t";

#[tauri::command]
pub async fn supabase_studio_observability_sessions(
    reference: String,
    include_idle: bool,
) -> Result<ObservabilityPage, String> {
    let reference = validate_ref(&reference)?;
    let data = json_data(reference, SESSIONS_SQL, &[Value::Bool(include_idle)]).await?;
    Ok(page(Some(&data), SESSION_LIMIT))
}

pub(crate) fn signal_sql(terminate: bool) -> &'static str {
    if terminate {
        "select pg_terminate_backend(pid) as ok from pg_stat_activity where pid = $1::int and pid <> pg_backend_pid()"
    } else {
        "select pg_cancel_backend(pid) as ok from pg_stat_activity where pid = $1::int and pid <> pg_backend_pid()"
    }
}

#[tauri::command]
pub async fn supabase_studio_observability_signal(
    reference: String,
    pid: u32,
    terminate: bool,
) -> Result<bool, String> {
    let reference = validate_ref(&reference)?;
    if pid == 0 || pid > i32::MAX as u32 {
        return Err("Ungültige Prozess-ID.".into());
    }
    let rows = database_execute(reference, signal_sql(terminate), &[Value::from(pid)]).await?;
    let row = rows
        .first()
        .ok_or_else(|| "Sitzung nicht gefunden oder bereits beendet.".to_string())?;
    Ok(row.get("ok").and_then(Value::as_bool).unwrap_or(false))
}

const LOCKS_SQL: &str = "select json_build_object(\
    'blocked', (select coalesce(json_agg(b), '[]'::json) from (\
        select a.pid, a.usename, a.state, a.wait_event_type, a.wait_event, left(a.query, 1000) as query, \
        round((extract(epoch from now() - a.query_start) * 1000)::numeric)::bigint as waiting_ms, \
        pg_blocking_pids(a.pid) as blocked_by, \
        (select coalesce(json_agg(json_build_object('pid', h.pid, 'usename', h.usename, 'state', h.state, 'query', left(h.query, 1000))), '[]'::json) \
            from pg_stat_activity h where h.pid = any(pg_blocking_pids(a.pid))) as blockers \
        from pg_stat_activity a where cardinality(pg_blocking_pids(a.pid)) > 0 \
        order by a.query_start asc nulls last limit 101) b), \
    'locks', (select coalesce(json_agg(l), '[]'::json) from (\
        select l.pid, l.locktype, l.mode, l.granted, l.relation::regclass::text as relation, \
        l.transactionid::text as transaction_id, a.usename, a.state, left(a.query, 500) as query \
        from pg_locks l left join pg_stat_activity a on a.pid = l.pid \
        where l.pid <> pg_backend_pid() and l.locktype <> 'virtualxid' \
        order by l.granted asc, l.pid limit 101) l)\
    ) as data";

#[tauri::command]
pub async fn supabase_studio_observability_locks(
    reference: String,
) -> Result<ObservabilityLocks, String> {
    let reference = validate_ref(&reference)?;
    let data = json_data(reference, LOCKS_SQL, &[]).await?;
    Ok(ObservabilityLocks {
        blocked: page(data.get("blocked"), LIST_LIMIT),
        locks: page(data.get("locks"), LIST_LIMIT),
    })
}

const STATEMENTS_STATE_SQL: &str = "select json_build_object(\
    'schema', (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_stat_statements'), \
    'available', exists(select 1 from pg_available_extensions where name = 'pg_stat_statements')\
    ) as data";

pub(crate) fn statements_sql(schema: &str, order: &str) -> Result<String, String> {
    let column = match order {
        "total" => "total_exec_time",
        "mean" => "mean_exec_time",
        "max" => "max_exec_time",
        "calls" => "calls",
        "rows" => "rows",
        _ => return Err("Ungültige Sortierung.".into()),
    };
    let schema = quote_identifier(schema)?;
    Ok(format!(
        "select coalesce(json_agg(t), '[]'::json) as data from (\
         select s.queryid::text as queryid, left(s.query, 2000) as query, r.rolname as role, s.calls, \
         round(s.total_exec_time::numeric, 2)::float8 as total_ms, \
         round(s.mean_exec_time::numeric, 2)::float8 as mean_ms, \
         round(s.max_exec_time::numeric, 2)::float8 as max_ms, s.rows, \
         s.shared_blks_hit, s.shared_blks_read \
         from {schema}.pg_stat_statements s left join pg_roles r on r.oid = s.userid \
         order by s.{column} desc nulls last limit 101) t"
    ))
}

async fn statements_schema(reference: &str) -> Result<(Option<String>, bool), String> {
    let state = json_data(reference, STATEMENTS_STATE_SQL, &[]).await?;
    Ok((
        state
            .get("schema")
            .and_then(Value::as_str)
            .map(str::to_string),
        state
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    ))
}

#[tauri::command]
pub async fn supabase_studio_observability_statements(
    reference: String,
    order: String,
) -> Result<ObservabilityStatements, String> {
    let reference = validate_ref(&reference)?;
    let (schema, available) = statements_schema(reference).await?;
    let Some(schema) = schema else {
        return Ok(ObservabilityStatements {
            installed: false,
            available,
            schema: None,
            page: page(None, LIST_LIMIT),
        });
    };
    let data = json_data(reference, &statements_sql(&schema, &order)?, &[]).await?;
    Ok(ObservabilityStatements {
        installed: true,
        available,
        page: page(Some(&data), LIST_LIMIT),
        schema: Some(schema),
    })
}

#[tauri::command]
pub async fn supabase_studio_observability_statements_enable(
    reference: String,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let schema_exists = json_data(
        reference,
        "select exists(select 1 from pg_namespace where nspname = 'extensions') as data",
        &[],
    )
    .await?;
    let sql = if schema_exists.as_bool() == Some(true) {
        "create extension if not exists pg_stat_statements with schema extensions"
    } else {
        "create extension if not exists pg_stat_statements"
    };
    database_execute(reference, sql, &[]).await?;
    Ok(())
}

#[tauri::command]
pub async fn supabase_studio_observability_statements_reset(
    reference: String,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let (schema, _) = statements_schema(reference).await?;
    let schema = schema.ok_or_else(|| "pg_stat_statements ist nicht installiert.".to_string())?;
    database_execute(
        reference,
        &format!(
            "select {}.pg_stat_statements_reset()",
            quote_identifier(&schema)?
        ),
        &[],
    )
    .await?;
    Ok(())
}

const HEALTH_SQL: &str = "select json_build_object(\
    'database_size', pg_database_size(current_database()), \
    'max_connections', current_setting('max_connections')::int, \
    'table_hit_ratio', (select round((sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0))::numeric, 4)::float8 from pg_statio_user_tables), \
    'index_hit_ratio', (select round((sum(idx_blks_hit) / nullif(sum(idx_blks_hit) + sum(idx_blks_read), 0))::numeric, 4)::float8 from pg_statio_user_indexes), \
    'connections', (select coalesce(json_agg(c), '[]'::json) from (\
        select coalesce(usename, backend_type) as role, coalesce(state, 'unbekannt') as state, count(*) as count \
        from pg_stat_activity group by 1, 2 order by 3 desc limit 101) c), \
    'long_transactions', (select coalesce(json_agg(x), '[]'::json) from (\
        select pid, usename, state, left(query, 1000) as query, xact_start, \
        round((extract(epoch from now() - xact_start) * 1000)::numeric)::bigint as xact_ms \
        from pg_stat_activity where xact_start is not null and pid <> pg_backend_pid() \
        and xact_start < now() - make_interval(secs => $1::int) \
        order by xact_start asc limit 101) x), \
    'replication_slots', (select coalesce(json_agg(s), '[]'::json) from (\
        select slot_name, plugin, slot_type, database, active, active_pid, \
        pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as retained_wal, \
        pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::bigint as retained_bytes \
        from pg_replication_slots order by slot_name limit 101) s)\
    ) as data";

#[tauri::command]
pub async fn supabase_studio_observability_health(
    reference: String,
    long_running_seconds: u32,
) -> Result<ObservabilityHealth, String> {
    let reference = validate_ref(&reference)?;
    let seconds = long_running_seconds.clamp(1, 86_400);
    let data = json_data(reference, HEALTH_SQL, &[Value::from(seconds)]).await?;
    Ok(ObservabilityHealth {
        database_size: data.get("database_size").and_then(Value::as_i64),
        max_connections: data.get("max_connections").and_then(Value::as_i64),
        table_hit_ratio: data.get("table_hit_ratio").and_then(Value::as_f64),
        index_hit_ratio: data.get("index_hit_ratio").and_then(Value::as_f64),
        connections: page(data.get("connections"), LIST_LIMIT),
        long_transactions: page(data.get("long_transactions"), LIST_LIMIT),
        replication_slots: page(data.get("replication_slots"), LIST_LIMIT),
    })
}

const SIZES_SQL: &str = "select json_build_object(\
    'tables', (select coalesce(json_agg(t), '[]'::json) from (\
        select n.nspname as schema, c.relname as name, c.reltuples::bigint as estimated_rows, \
        pg_total_relation_size(c.oid) as total_bytes, pg_relation_size(c.oid) as table_bytes, \
        pg_indexes_size(c.oid) as index_bytes \
        from pg_class c join pg_namespace n on n.oid = c.relnamespace \
        where c.relkind in ('r', 'p', 'm') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%' \
        order by pg_total_relation_size(c.oid) desc limit 101) t), \
    'indexes', (select coalesce(json_agg(i), '[]'::json) from (\
        select s.schemaname as schema, s.relname as table, s.indexrelname as name, \
        pg_relation_size(s.indexrelid) as bytes, s.idx_scan as scans \
        from pg_stat_user_indexes s order by pg_relation_size(s.indexrelid) desc limit 101) i), \
    'unused_indexes', (select coalesce(json_agg(u), '[]'::json) from (\
        select s.schemaname as schema, s.relname as table, s.indexrelname as name, \
        pg_relation_size(s.indexrelid) as bytes, s.idx_scan as scans, pg_get_indexdef(s.indexrelid) as definition \
        from pg_stat_user_indexes s join pg_index x on x.indexrelid = s.indexrelid \
        where s.idx_scan = 0 and not x.indisunique and not x.indisprimary \
        order by pg_relation_size(s.indexrelid) desc limit 101) u)\
    ) as data";

#[tauri::command]
pub async fn supabase_studio_observability_sizes(
    reference: String,
) -> Result<ObservabilitySizes, String> {
    let reference = validate_ref(&reference)?;
    let data = json_data(reference, SIZES_SQL, &[]).await?;
    Ok(ObservabilitySizes {
        tables: page(data.get("tables"), LIST_LIMIT),
        indexes: page(data.get("indexes"), LIST_LIMIT),
        unused_indexes: page(data.get("unused_indexes"), LIST_LIMIT),
    })
}

fn bigquery_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

pub(crate) fn logs_sql(
    source: &str,
    search: &str,
    level: &str,
    limit: u32,
) -> Result<String, String> {
    if !LOG_SOURCES.contains(&source) {
        return Err("Unbekannte Log-Quelle.".into());
    }
    let search = search.trim();
    if search.chars().count() > MAX_SEARCH_CHARS || search.chars().any(char::is_control) {
        return Err("Suchtext ist zu lang oder enthält Steuerzeichen.".into());
    }
    let limit = limit.clamp(1, LOG_LIMIT_MAX);
    let mut joins = String::new();
    let mut conditions = Vec::new();
    if !search.is_empty() {
        conditions.push(format!(
            "regexp_contains(t.event_message, {})",
            bigquery_literal(&format!("(?i){}", regex::escape(search)))
        ));
    }
    if !level.is_empty() {
        let (join, condition) = match (source, level) {
            ("postgres_logs", _) => (
                "cross join unnest(t.metadata) as m cross join unnest(m.parsed) as p",
                match level {
                    "error" => "p.error_severity in ('ERROR', 'FATAL', 'PANIC')",
                    "warning" => "p.error_severity = 'WARNING'",
                    "info" => "p.error_severity in ('LOG', 'INFO', 'NOTICE', 'DEBUG')",
                    _ => return Err("Ungültiges Level.".into()),
                },
            ),
            ("edge_logs" | "function_edge_logs", _) => (
                "cross join unnest(t.metadata) as m cross join unnest(m.response) as r",
                match level {
                    "error" => "r.status_code >= 500",
                    "warning" => "r.status_code between 400 and 499",
                    "info" => "r.status_code < 400",
                    _ => return Err("Ungültiges Level.".into()),
                },
            ),
            ("auth_logs" | "function_logs", _) => (
                "cross join unnest(t.metadata) as m",
                match level {
                    "error" => "m.level in ('error', 'fatal', 'panic')",
                    "warning" => "m.level in ('warning', 'warn')",
                    "info" => "m.level in ('info', 'log', 'debug')",
                    _ => return Err("Ungültiges Level.".into()),
                },
            ),
            _ => return Err("Für diese Quelle ist kein Level-Filter verfügbar.".into()),
        };
        joins = format!(" {join}");
        conditions.push(condition.to_string());
    }
    let filter = if conditions.is_empty() {
        String::new()
    } else {
        format!(" where {}", conditions.join(" and "))
    };
    Ok(format!(
        "select t.id, t.timestamp, t.event_message, t.metadata from {source} as t{joins}{filter} order by t.timestamp desc limit {}",
        limit + 1
    ))
}

async fn management_request(path: &str, query: &[(&str, String)]) -> Result<Value, String> {
    let response = client()
        .get(format!("https://api.supabase.com/v1/{path}"))
        .bearer_auth(token().await?)
        .query(query)
        .send()
        .await
        .map_err(|error| format!("Supabase ist nicht erreichbar: {error}"))?;
    response_json(response).await
}

fn analytics_error(body: &Value) -> Option<String> {
    match body.get("error")? {
        Value::Null => None,
        Value::String(message) => Some(message.clone()),
        error => Some(
            error
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| error.to_string()),
        ),
    }
}

#[tauri::command]
pub async fn supabase_studio_observability_logs(
    reference: String,
    source: String,
    minutes: u32,
    search: String,
    level: String,
    limit: u32,
) -> Result<ObservabilityPage, String> {
    let reference = cloud_ref(&reference)?;
    let sql = logs_sql(&source, &search, &level, limit)?;
    let end = chrono::Utc::now();
    let start = end - chrono::Duration::minutes(minutes.clamp(1, MAX_WINDOW_MINUTES).into());
    let format = |time: chrono::DateTime<chrono::Utc>| {
        time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    };
    let body = management_request(
        &format!("projects/{reference}/analytics/endpoints/logs.all"),
        &[
            ("sql", sql),
            ("iso_timestamp_start", format(start)),
            ("iso_timestamp_end", format(end)),
        ],
    )
    .await?;
    if let Some(error) = analytics_error(&body) {
        return Err(format!("Logabfrage fehlgeschlagen: {error}"));
    }
    Ok(page(
        body.get("result"),
        limit.clamp(1, LOG_LIMIT_MAX) as usize,
    ))
}

#[tauri::command]
pub async fn supabase_studio_observability_advisors(
    reference: String,
    kind: String,
) -> Result<ObservabilityPage, String> {
    let reference = cloud_ref(&reference)?;
    if kind != "security" && kind != "performance" {
        return Err("Unbekannter Advisor.".into());
    }
    let body = management_request(&format!("projects/{reference}/advisors/{kind}"), &[]).await?;
    Ok(page(body.get("lints"), ADVISOR_LIMIT))
}

#[tauri::command]
pub async fn supabase_studio_observability_usage(
    reference: String,
    interval: String,
) -> Result<ObservabilityPage, String> {
    let reference = cloud_ref(&reference)?;
    if !USAGE_INTERVALS.contains(&interval.as_str()) {
        return Err("Ungültiges Intervall.".into());
    }
    let body = management_request(
        &format!("projects/{reference}/analytics/endpoints/usage.api-counts"),
        &[("interval", interval)],
    )
    .await?;
    if let Some(error) = analytics_error(&body) {
        return Err(format!("Nutzungsabfrage fehlgeschlagen: {error}"));
    }
    Ok(page(body.get("result"), ADVISOR_LIMIT))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_trims_and_flags_more() {
        let rows = Value::Array((0..5).map(Value::from).collect());
        let bounded = page(Some(&rows), 3);
        assert_eq!(bounded.rows.len(), 3);
        assert!(bounded.has_more);
        assert!(!page(Some(&rows), 5).has_more);
        assert_eq!(
            page(None, 3),
            ObservabilityPage {
                rows: vec![],
                has_more: false
            }
        );
    }

    #[test]
    fn statements_sql_whitelists_order_and_quotes_schema() {
        let sql = statements_sql("extensions", "mean").unwrap();
        assert!(sql.contains("\"extensions\".pg_stat_statements"));
        assert!(sql.contains("order by s.mean_exec_time desc"));
        assert!(statements_sql("extensions", "query; drop").is_err());
        assert!(statements_sql("a\"b", "calls")
            .unwrap()
            .contains("\"a\"\"b\".pg_stat_statements"));
    }

    #[test]
    fn signal_sql_never_targets_own_backend() {
        assert!(signal_sql(true).contains("pg_terminate_backend"));
        assert!(signal_sql(false).contains("pg_cancel_backend"));
        assert!(signal_sql(false).contains("pid <> pg_backend_pid()"));
    }

    #[test]
    fn logs_sql_escapes_search_and_bounds_limit() {
        let sql = logs_sql("edge_logs", "it's a.b\\", "", 5000).unwrap();
        assert!(sql.contains("from edge_logs as t"));
        assert!(sql.contains(r"'(?i)it\'s a\\.b\\\\'"));
        assert!(sql.ends_with("limit 501"));
        assert!(logs_sql("pg_catalog", "", "", 10).is_err());
        assert!(logs_sql("edge_logs", "a\nb", "", 10).is_err());
        assert!(logs_sql("edge_logs", &"x".repeat(201), "", 10).is_err());
        assert!(logs_sql("edge_logs", "", "", 0)
            .unwrap()
            .ends_with("limit 2"));
    }

    #[test]
    fn logs_sql_level_filters_per_source() {
        let pg = logs_sql("postgres_logs", "", "error", 100).unwrap();
        assert!(pg.contains("unnest(m.parsed) as p"));
        assert!(pg.contains("p.error_severity in ('ERROR', 'FATAL', 'PANIC')"));
        let edge = logs_sql("function_edge_logs", "x", "warning", 100).unwrap();
        assert!(edge.contains("r.status_code between 400 and 499 order by"));
        assert!(edge.contains(" and "));
        assert!(logs_sql("auth_logs", "", "info", 100)
            .unwrap()
            .contains("m.level in ('info'"));
        assert!(logs_sql("storage_logs", "", "error", 100).is_err());
        assert!(logs_sql("auth_logs", "", "trace", 100).is_err());
    }

    #[test]
    fn analytics_error_reads_string_and_object() {
        assert_eq!(analytics_error(&serde_json::json!({"result": []})), None);
        assert_eq!(analytics_error(&serde_json::json!({"error": null})), None);
        assert_eq!(
            analytics_error(&serde_json::json!({"error": "boom"})).as_deref(),
            Some("boom")
        );
        assert_eq!(
            analytics_error(&serde_json::json!({"error": {"message": "bad sql"}})).as_deref(),
            Some("bad sql")
        );
    }

    #[tokio::test]
    #[ignore]
    async fn observability_self_hosted_live() {
        use crate::baas_self_hosted_live_tests::{env, isolate_secrets, latency};
        let (Some(url), Some(key)) = (env("L8DB_E2E_SUPABASE_URL"), env("L8DB_E2E_SUPABASE_KEY"))
        else {
            return;
        };
        let _secrets = isolate_secrets();
        let project = crate::supabase::supabase_connect_self_hosted(url, key, "Obs".into())
            .await
            .unwrap();
        let reference = project.reference.clone();

        let sleeper = {
            let reference = reference.clone();
            tokio::spawn(async move {
                database_execute(&reference, "select pg_sleep(30), 'l8db_obs_sleep'", &[]).await
            })
        };
        let mut target = None;
        for _ in 0..50 {
            let sessions = supabase_studio_observability_sessions(reference.clone(), false)
                .await
                .unwrap();
            target = sessions.rows.iter().find_map(|row| {
                let query = row.get("query")?.as_str()?;
                (query.contains("l8db_obs_sleep") && !query.contains("pg_stat_activity"))
                    .then(|| row.get("pid")?.as_u64())
                    .flatten()
            });
            if target.is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        let pid = target.expect("pg_sleep session visible") as u32;
        assert!(
            supabase_studio_observability_signal(reference.clone(), pid, false)
                .await
                .unwrap()
        );
        assert!(sleeper.await.unwrap().is_err());
        assert!(
            supabase_studio_observability_signal(reference.clone(), 0, true)
                .await
                .is_err()
        );

        supabase_studio_observability_statements_enable(reference.clone())
            .await
            .unwrap();
        let statements =
            supabase_studio_observability_statements(reference.clone(), "total".into())
                .await
                .unwrap();
        assert!(statements.installed);
        assert!(statements.page.rows.len() <= LIST_LIMIT);
        assert!(statements
            .page
            .rows
            .first()
            .is_some_and(|row| row.get("calls").is_some()));
        assert!(
            supabase_studio_observability_statements(reference.clone(), "bogus".into())
                .await
                .is_err()
        );

        let health = supabase_studio_observability_health(reference.clone(), 1)
            .await
            .unwrap();
        assert!(health.database_size.unwrap_or(0) > 0);
        assert!(health.max_connections.unwrap_or(0) > 0);
        assert!(!health.connections.rows.is_empty());

        let sizes = supabase_studio_observability_sizes(reference.clone())
            .await
            .unwrap();
        assert!(!sizes.tables.rows.is_empty());
        assert!(sizes.tables.rows.len() <= LIST_LIMIT);

        let locks = supabase_studio_observability_locks(reference.clone())
            .await
            .unwrap();
        assert!(locks.locks.rows.len() <= LIST_LIMIT);

        assert!(supabase_studio_observability_logs(
            reference.clone(),
            "edge_logs".into(),
            60,
            "".into(),
            "".into(),
            100
        )
        .await
        .is_err());
        assert!(
            supabase_studio_observability_advisors(reference.clone(), "security".into())
                .await
                .is_err()
        );

        latency("observability sessions", 500, || {
            let reference = reference.clone();
            async move {
                supabase_studio_observability_sessions(reference, true)
                    .await
                    .unwrap();
            }
        })
        .await;
        latency("observability locks", 500, || {
            let reference = reference.clone();
            async move {
                supabase_studio_observability_locks(reference)
                    .await
                    .unwrap();
            }
        })
        .await;
        latency("observability statements", 500, || {
            let reference = reference.clone();
            async move {
                supabase_studio_observability_statements(reference, "mean".into())
                    .await
                    .unwrap();
            }
        })
        .await;
        latency("observability health", 500, || {
            let reference = reference.clone();
            async move {
                supabase_studio_observability_health(reference, 60)
                    .await
                    .unwrap();
            }
        })
        .await;
        latency("observability sizes", 500, || {
            let reference = reference.clone();
            async move {
                supabase_studio_observability_sizes(reference)
                    .await
                    .unwrap();
            }
        })
        .await;

        crate::supabase::supabase_disconnect_self_hosted(reference)
            .await
            .unwrap();
    }
}
