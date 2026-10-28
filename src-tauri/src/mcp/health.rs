use serde_json::{json, Value};

use super::config::McpConnection;
use super::server;
use crate::db::{pool::PoolState, postgres_health};

pub fn tool_definition() -> Value {
    json!({
        "name": "health",
        "description": "Read-only PostgreSQL health checks for security, schema and performance (RLS, missing keys, unindexed foreign keys, unused indexes, bloat, slow queries). Returns findings with severity and fix SQL, never executed.",
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
