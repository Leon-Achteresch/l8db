use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::LazyLock;

use crate::db::{self, DatabaseAdapter};

const MIN_TABLE_ROWS: i64 = 10_000;
const MAX_SELECTIVITY: f64 = 0.1;

static SIMPLE_FILTER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)^\(*\s*(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\s*(?:\)::[a-z_][a-z0-9_ ]*)?\s*(?:=|<=|>=|<|>)\s*.+\)*$"#)
        .expect("filter expression")
});
static COMPLEX_FILTER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(and|or|not|any|all|similar|between)\b|[;]|--|/\*")
        .expect("complex filter expression")
});

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexAdvice {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub estimated_table_rows: i64,
    pub estimated_result_rows: i64,
    pub selectivity: f64,
    pub sql: String,
}

#[derive(Debug, Clone)]
struct ScanCandidate {
    schema: Option<String>,
    table: String,
    column: String,
    plan_rows: i64,
}

fn filter_column(filter: &str) -> Option<String> {
    if COMPLEX_FILTER.is_match(filter) {
        return None;
    }
    let captures = SIMPLE_FILTER.captures(filter.trim())?;
    captures
        .get(1)
        .or_else(|| captures.get(2))
        .map(|value| value.as_str().to_string())
}

fn collect_candidates(node: &Value, candidates: &mut Vec<ScanCandidate>) {
    if node.get("Node Type").and_then(Value::as_str) == Some("Seq Scan") {
        if let (Some(table), Some(filter)) = (
            node.get("Relation Name").and_then(Value::as_str),
            node.get("Filter").and_then(Value::as_str),
        ) {
            if let Some(column) = filter_column(filter) {
                candidates.push(ScanCandidate {
                    schema: node
                        .get("Schema")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    table: table.to_string(),
                    column,
                    plan_rows: node.get("Plan Rows").and_then(Value::as_i64).unwrap_or(0),
                });
            }
        }
    }
    if let Some(children) = node.get("Plans").and_then(Value::as_array) {
        for child in children {
            collect_candidates(child, candidates);
        }
    }
}

fn plan_root(plan: &Value) -> Option<&Value> {
    let first = plan
        .as_array()
        .and_then(|items| items.first())
        .unwrap_or(plan);
    first
        .get("Plan")
        .or_else(|| first.get("Node Type").map(|_| first))
}

fn estimate_query(candidate: &ScanCandidate) -> String {
    let table = db::quote_literal(&candidate.table);
    let schema = candidate
        .schema
        .as_deref()
        .map(|value| format!("AND n.nspname = {}", db::quote_literal(value)))
        .unwrap_or_else(|| {
            "AND pg_table_is_visible(c.oid) \
             AND NOT EXISTS (SELECT 1 FROM pg_class other \
             JOIN pg_namespace other_ns ON other_ns.oid = other.relnamespace \
             WHERE other.relname = c.relname AND other.oid <> c.oid \
             AND other.relkind = 'r' AND other_ns.nspname NOT IN ('pg_catalog', 'information_schema'))"
                .to_string()
        });
    format!(
        "SELECT n.nspname AS schema_name, c.reltuples::bigint AS estimated_rows \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE c.relname = {table} AND c.relkind = 'r' \
         AND n.nspname NOT IN ('pg_catalog', 'information_schema') {schema} LIMIT 1"
    )
}

fn index_name(schema: &str, table: &str, column: &str) -> String {
    let stem = |value: &str| {
        value
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() {
                    character.to_ascii_lowercase()
                } else {
                    '_'
                }
            })
            .take(20)
            .collect::<String>()
    };
    let digest = Sha256::digest(format!("{schema}\0{table}\0{column}").as_bytes());
    let suffix = digest[..4]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("l8db_{}_{}_{}", stem(table), stem(column), suffix)
}

pub async fn advise(
    adapter: &dyn DatabaseAdapter,
    plan: &Value,
) -> Result<Vec<IndexAdvice>, String> {
    let root = plan_root(plan).ok_or("Kein PostgreSQL-Ausführungsplan erhalten.")?;
    let mut candidates = Vec::new();
    collect_candidates(root, &mut candidates);
    let mut seen = HashSet::new();
    let mut advice = Vec::new();
    for candidate in candidates.into_iter().take(30) {
        let stats = adapter.execute_query(&estimate_query(&candidate)).await?;
        let Some(row) = stats.rows.first() else {
            continue;
        };
        let Some(schema) = row.get("schema_name").and_then(Value::as_str) else {
            continue;
        };
        let Some(table_rows) = row.get("estimated_rows").and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str()?.parse::<i64>().ok())
        }) else {
            continue;
        };
        if table_rows < MIN_TABLE_ROWS || candidate.plan_rows < 0 {
            continue;
        }
        let selectivity = candidate.plan_rows as f64 / table_rows as f64;
        if selectivity > MAX_SELECTIVITY {
            continue;
        }
        let columns = adapter
            .list_columns(Some(schema), Some(&candidate.table), None)
            .await?;
        if !columns.iter().any(|column| column.name == candidate.column) {
            continue;
        }
        let indexes = adapter.list_indexes(schema, &candidate.table).await?;
        if indexes.iter().any(|index| {
            index.index_type.eq_ignore_ascii_case("btree")
                && index.columns.first() == Some(&candidate.column)
        }) {
            continue;
        }
        let key = (
            schema.to_string(),
            candidate.table.clone(),
            candidate.column.clone(),
        );
        if !seen.insert(key) {
            continue;
        }
        let index_name = index_name(schema, &candidate.table, &candidate.column);
        let sql = format!(
            "CREATE INDEX CONCURRENTLY {} ON {}.{} ({});",
            db::quote_ident(&index_name),
            db::quote_ident(schema),
            db::quote_ident(&candidate.table),
            db::quote_ident(&candidate.column)
        );
        advice.push(IndexAdvice {
            schema: schema.to_string(),
            table: candidate.table,
            column: candidate.column,
            estimated_table_rows: table_rows,
            estimated_result_rows: candidate.plan_rows,
            selectivity,
            sql,
        });
    }
    Ok(advice)
}

#[tauri::command]
pub async fn advise_indexes(
    kind: db::DatabaseKind,
    connection_string: String,
    database: Option<String>,
    plan: Value,
    pool_state: tauri::State<'_, db::pool::PoolState>,
) -> Result<Vec<IndexAdvice>, String> {
    if kind != db::DatabaseKind::Postgres {
        return Err("Der Index-Berater unterstützt derzeit PostgreSQL.".into());
    }
    let adapter = db::create_adapter_from_string(
        kind,
        &connection_string,
        database.as_deref(),
        pool_state.inner().clone(),
    )?;
    advise(adapter.as_ref(), &plan).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_simple_scan_and_rejects_complex_predicates() {
        let plan = serde_json::json!([{"Plan":{"Node Type":"Nested Loop","Plans":[
            {"Node Type":"Seq Scan","Relation Name":"orders","Filter":"(customer_id = 42)","Plan Rows":50},
            {"Node Type":"Seq Scan","Relation Name":"events","Filter":"(a = 1 AND b = 2)","Plan Rows":1}
        ]}}]);
        let mut candidates = Vec::new();
        collect_candidates(plan_root(&plan).unwrap(), &mut candidates);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].column, "customer_id");
        assert_eq!(candidates[0].table, "orders");
        assert_eq!(
            filter_column("((email)::text = 'a'::text)"),
            Some("email".into())
        );
        assert_eq!(filter_column("(\"odd name\" = 1)"), Some("odd name".into()));
    }

    #[test]
    fn stats_query_quotes_plan_identifiers() {
        let candidate = ScanCandidate {
            schema: Some("s'chema".into()),
            table: "t'able".into(),
            column: "x".into(),
            plan_rows: 1,
        };
        let sql = estimate_query(&candidate);
        assert!(sql.contains("c.relname = 't''able'"));
        assert!(sql.contains("n.nspname = 's''chema'"));
    }

    #[test]
    fn generated_index_name_fits_postgres_limit_and_distinguishes_schema() {
        let name = index_name("one", &"table".repeat(20), &"column".repeat(20));
        assert!(name.len() <= 63);
        assert_ne!(
            name,
            index_name("two", &"table".repeat(20), &"column".repeat(20))
        );
    }

    #[tokio::test]
    #[ignore]
    async fn live_postgres_suggests_missing_index_and_suppresses_existing_one() {
        let url = std::env::var("L8DB_E2E_PG_URL").expect("L8DB_E2E_PG_URL");
        let adapter = db::create_adapter_from_string(
            db::DatabaseKind::Postgres,
            &url,
            None,
            db::pool::create_pool_state(),
        )
        .unwrap();
        let table = format!("l8db_index_advisor_{}", std::process::id());
        adapter
            .execute_query(&format!(
                "CREATE TABLE public.{table} (id integer PRIMARY KEY, customer_id integer NOT NULL); \
                 INSERT INTO public.{table} SELECT g, g % 100 FROM generate_series(1, 20000) g; \
                 ANALYZE public.{table}"
            ))
            .await
            .unwrap();
        let plan = adapter
            .explain_query(
                &format!("SELECT id FROM public.{table} WHERE customer_id = 42"),
                false,
            )
            .await
            .unwrap();
        let advice = advise(adapter.as_ref(), &plan).await.unwrap();
        let result = if let Some(item) = advice.first() {
            assert_eq!(item.table, table);
            assert_eq!(item.column, "customer_id");
            assert!(item.sql.contains("CREATE INDEX CONCURRENTLY"));
            let other_schema = format!("l8db_index_advisor_other_{}", std::process::id());
            adapter
                .execute_query(&format!(
                    "CREATE SCHEMA {other_schema}; CREATE TABLE {other_schema}.{table} (id integer)"
                ))
                .await
                .unwrap();
            assert!(advise(adapter.as_ref(), &plan).await.unwrap().is_empty());
            adapter
                .execute_query(&format!("DROP SCHEMA {other_schema} CASCADE"))
                .await
                .unwrap();
            adapter.execute_query(&item.sql).await.unwrap();
            assert!(advise(adapter.as_ref(), &plan).await.unwrap().is_empty());
            Ok(())
        } else {
            Err(format!("Kein Indexvorschlag für Plan: {plan}"))
        };
        adapter
            .execute_query(&format!("DROP TABLE public.{table}"))
            .await
            .unwrap();
        result.unwrap();
    }
}
