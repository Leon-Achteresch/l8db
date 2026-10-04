use serde_json::{json, Value};

use super::config::McpConnection;
use super::server;
use crate::db::{pool::PoolState, postgres_health};

pub fn tool_definition() -> Value {
    json!({
        "name": "health",
        "description": "Run the read-only health and advisor rule catalog on a PostgreSQL connection: security (RLS, SECURITY DEFINER, search_path, superusers), schema (missing primary keys, unindexed foreign keys, duplicate and invalid indexes) and performance (unused indexes, dead tuples, cache hit ratio, sequences near exhaustion, vacuum/analyze, slow queries from pg_stat_statements). Returns JSON per check with status, severity, affected objects and suggested fix SQL. Fix SQL is never executed.",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": server::database_arg(),
            "category": {"type": "string", "enum": ["security", "performance", "schema"]}
        }, "required": ["connection"]}
    })
}

pub async fn call(
    connection: &McpConnection,
    pool: &PoolState,
    args: &Value,
) -> Result<String, String> {
    if !connection.kind.capabilities().health_advisor {
        return Err("Health-Checks werden nur für PostgreSQL unterstützt.".into());
    }
    let adapter = server::adapter(connection, pool)?;
    let mut report = postgres_health::run_health_checks(adapter.as_ref()).await;
    let category = server::arg_str(args, "category");
    if !category.is_empty() {
        report.checks.retain(|check| {
            serde_json::to_value(check.category)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                == Some(category.to_string())
        });
    }
    Ok(serde_json::to_string_pretty(&json!({
        "connection": connection.name,
        "durationMs": report.duration_ms,
        "checks": report.checks,
    }))
    .unwrap_or_default())
}
