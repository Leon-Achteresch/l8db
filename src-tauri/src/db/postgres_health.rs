use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::Instant;

use super::provider::DatabaseKind;
use super::{create_adapter_from_string, pool::PoolState, DatabaseAdapter};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Warning,
    Critical,
}

impl Severity {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "info" => Some(Self::Info),
            "warning" => Some(Self::Warning),
            "critical" => Some(Self::Critical),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Security,
    Performance,
    Schema,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Issue,
    Ok,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthObject {
    pub name: String,
    pub detail: Option<String>,
    pub fix_sql: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckResult {
    pub id: String,
    pub category: Category,
    pub title: String,
    pub explanation: String,
    pub status: CheckStatus,
    pub severity: Option<Severity>,
    pub objects: Vec<HealthObject>,
    pub fix_sql: Option<String>,
    pub skipped_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub checks: Vec<HealthCheckResult>,
    pub duration_ms: u64,
}

struct Check {
    id: &'static str,
    category: Category,
    severity: Severity,
    title: &'static str,
    explanation: &'static str,
    sql: &'static str,
}

const USER_SCHEMA: &str = "n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname NOT LIKE 'pg\\_%'";

const RLS_SQL: &str = "WITH rls AS (SELECT DISTINCT c.relnamespace AS nsp FROM pg_class c WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity) \
SELECT format('%I.%I', n.nspname, c.relname) AS object, \
CASE WHEN r.nsp IS NOT NULL THEN 'RLS wird in diesem Schema genutzt, ist für diese Tabelle aber aus' ELSE 'Tabelle im Schema public ohne RLS' END AS detail, \
format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;', n.nspname, c.relname) AS fix, \
CASE WHEN r.nsp IS NOT NULL THEN 'warning' ELSE 'info' END AS severity \
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN rls r ON r.nsp = n.oid \
WHERE c.relkind IN ('r', 'p') AND NOT c.relrowsecurity AND NOT c.relispartition AND {USER} AND (r.nsp IS NOT NULL OR n.nspname = 'public') \
AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e') \
ORDER BY 1 LIMIT 200";

const SECDEF_SQL: &str = "SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS object, \
format('Läuft mit den Rechten von %s', pg_get_userbyid(p.proowner)) AS detail, \
format('REVOKE EXECUTE ON ROUTINE %I.%I(%s) FROM PUBLIC;', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS fix, \
NULL AS severity \
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace \
WHERE p.prosecdef AND {USER} \
AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) \
AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e') \
ORDER BY 1 LIMIT 200";

const SEARCH_PATH_SQL: &str = "SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS object, \
CASE WHEN p.prosecdef THEN 'SECURITY DEFINER ohne festen search_path' ELSE 'Kein fester search_path gesetzt' END AS detail, \
format('ALTER ROUTINE %I.%I(%s) SET search_path = pg_catalog, %I;', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), n.nspname) AS fix, \
CASE WHEN p.prosecdef THEN 'warning' ELSE 'info' END AS severity \
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang \
WHERE p.prokind IN ('f', 'p') AND l.lanname NOT IN ('c', 'internal') AND {USER} \
AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg WHERE cfg LIKE 'search\\_path=%') \
AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e') \
ORDER BY p.prosecdef DESC, 1 LIMIT 200";

const SUPERUSER_SQL: &str = "SELECT quote_ident(r.rolname) AS object, \
CASE WHEN r.rolcanlogin THEN 'Superuser mit Login' ELSE 'Superuser ohne Login' END AS detail, \
format('ALTER ROLE %I NOSUPERUSER;', r.rolname) AS fix, \
CASE WHEN r.rolcanlogin THEN 'warning' ELSE 'info' END AS severity \
FROM pg_roles r WHERE r.rolsuper AND r.oid <> 10 AND r.rolname NOT LIKE 'pg\\_%' \
AND r.rolname NOT IN ('postgres', 'rdsadmin', 'supabase_admin', 'cloudsqladmin', 'azure_superuser') \
ORDER BY 1 LIMIT 200";

const NO_PK_SQL: &str = "SELECT format('%I.%I', n.nspname, c.relname) AS object, \
format('ca. %s Zeilen', greatest(c.reltuples, 0)::bigint) AS detail, NULL AS fix, NULL AS severity \
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND {USER} \
AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p') \
AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e') \
ORDER BY 1 LIMIT 200";

const FK_INDEX_SQL: &str = "SELECT format('%I.%I', n.nspname, t.relname) AS object, \
format('%s (%s) → %s', k.conname, cols.list, k.confrelid::regclass) AS detail, \
format('CREATE INDEX CONCURRENTLY ON %I.%I (%s);', n.nspname, t.relname, cols.list) AS fix, NULL AS severity \
FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace \
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord) AS list FROM unnest(k.conkey) WITH ORDINALITY u(attnum, ord) JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum) cols \
WHERE k.contype = 'f' AND {USER} \
AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = k.conrelid AND i.indpred IS NULL \
AND (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(k.conkey)] @> k.conkey \
AND (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(k.conkey)] <@ k.conkey) \
ORDER BY 1 LIMIT 200";

const INDEX_LIST_SQL: &str = "SELECT format('%I.%I', n.nspname, t.relname) AS table_name, format('%I.%I', n.nspname, ic.relname) AS index_name, \
am.amname AS method, i.indkey::text AS keys, i.indclass::text AS opclasses, \
coalesce(pg_get_expr(i.indexprs, i.indrelid), '') AS exprs, coalesce(pg_get_expr(i.indpred, i.indrelid), '') AS pred, \
i.indisunique::text AS is_unique, i.indisprimary::text AS is_primary, \
EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)::text AS backs_constraint, \
pg_size_pretty(pg_relation_size(i.indexrelid)) AS size \
FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid \
JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_am am ON am.oid = ic.relam \
WHERE {USER} ORDER BY 1, 2";

const INVALID_INDEX_SQL: &str = "SELECT format('%I.%I', n.nspname, ic.relname) AS object, \
format('auf %I.%I', n.nspname, t.relname) AS detail, \
format('REINDEX INDEX CONCURRENTLY %I.%I;', n.nspname, ic.relname) AS fix, NULL AS severity \
FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace \
WHERE NOT i.indisvalid AND {USER} ORDER BY 1 LIMIT 200";

const UNUSED_INDEX_SQL: &str = "SELECT format('%I.%I', s.schemaname, s.indexrelname) AS object, \
format('auf %I.%I, %s, 0 Scans seit Statistik-Reset', s.schemaname, s.relname, pg_size_pretty(pg_relation_size(s.indexrelid))) AS detail, \
format('DROP INDEX CONCURRENTLY %I.%I;', s.schemaname, s.indexrelname) AS fix, NULL AS severity \
FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid \
WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary AND i.indisvalid \
AND pg_relation_size(s.indexrelid) > 2097152 \
AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = s.indexrelid) \
ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 200";

const BLOAT_SQL: &str = "SELECT format('%I.%I', s.schemaname, s.relname) AS object, \
format('%s tote von %s Tupeln (%s %%)', s.n_dead_tup, s.n_live_tup + s.n_dead_tup, round(100.0 * s.n_dead_tup / (s.n_live_tup + s.n_dead_tup), 1)) AS detail, \
format('VACUUM (ANALYZE) %I.%I;', s.schemaname, s.relname) AS fix, \
CASE WHEN s.n_dead_tup::float8 / (s.n_live_tup + s.n_dead_tup) > 0.5 THEN 'warning' ELSE 'info' END AS severity \
FROM pg_stat_user_tables s \
WHERE s.n_dead_tup > 10000 AND s.n_dead_tup::float8 / nullif(s.n_live_tup + s.n_dead_tup, 0) > 0.2 \
ORDER BY s.n_dead_tup DESC LIMIT 200";

const CACHE_SQL: &str = "SELECT current_database()::text AS object, \
format('Cache-Trefferquote %s %% (%s Treffer, %s Lesezugriffe)', round(100.0 * blks_hit / (blks_hit + blks_read), 2), blks_hit, blks_read) AS detail, \
NULL AS fix, \
CASE WHEN blks_hit::float8 / (blks_hit + blks_read) < 0.95 THEN 'warning' ELSE 'info' END AS severity \
FROM pg_stat_database WHERE datname = current_database() AND blks_hit + blks_read > 10000 \
AND blks_hit::float8 / (blks_hit + blks_read) < 0.99";

const SEQUENCE_SQL: &str = "SELECT format('%I.%I', s.schemaname, s.sequencename) AS object, \
format('%s von %s verbraucht (%s %%), Typ %s', s.last_value, s.max_value, round(100.0 * s.last_value / s.max_value, 1), format_type(s.data_type, NULL)) AS detail, \
CASE WHEN s.data_type <> 'bigint'::regtype THEN format('ALTER SEQUENCE %I.%I AS bigint;', s.schemaname, s.sequencename) END AS fix, \
CASE WHEN s.last_value::float8 / s.max_value > 0.95 THEN 'critical' ELSE 'warning' END AS severity \
FROM pg_sequences s \
WHERE s.increment_by > 0 AND s.last_value IS NOT NULL AND NOT s.cycle AND s.last_value::float8 / s.max_value > 0.75 \
ORDER BY s.last_value::float8 / s.max_value DESC LIMIT 200";

const NEVER_VACUUMED_SQL: &str = "SELECT format('%I.%I', s.schemaname, s.relname) AS object, \
concat_ws(', ', CASE WHEN s.last_vacuum IS NULL AND s.last_autovacuum IS NULL THEN format('nie gevacuumt (%s tote Tupel)', s.n_dead_tup) END, \
CASE WHEN s.last_analyze IS NULL AND s.last_autoanalyze IS NULL THEN 'nie analysiert' END) AS detail, \
format('VACUUM (ANALYZE) %I.%I;', s.schemaname, s.relname) AS fix, NULL AS severity \
FROM pg_stat_user_tables s \
WHERE (s.last_vacuum IS NULL AND s.last_autovacuum IS NULL AND s.n_dead_tup > 1000) \
OR (s.last_analyze IS NULL AND s.last_autoanalyze IS NULL AND s.n_live_tup > 1000) \
ORDER BY s.n_dead_tup DESC LIMIT 200";

const SLOW_QUERY_SQL: &str = "SELECT left(regexp_replace(s.query, '\\s+', ' ', 'g'), 300) AS object, \
format('%s Aufrufe, Ø %s ms, gesamt %s s', s.calls, round(s.{MEAN}::numeric, 1), round((s.{TOTAL} / 1000)::numeric, 1)) AS detail, \
NULL AS fix, CASE WHEN s.{MEAN} > 1000 THEN 'warning' ELSE 'info' END AS severity \
FROM {SCHEMA}.pg_stat_statements s \
WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) \
AND s.query NOT LIKE '<insufficient privilege>%' AND s.{MEAN} > 100 \
ORDER BY s.{TOTAL} DESC LIMIT 10";

const SLOW_QUERY_ID: &str = "slow_queries";
const DUPLICATE_INDEX_ID: &str = "duplicate_indexes";

fn checks() -> Vec<Check> {
    vec![
        Check {
            id: "rls_disabled",
            category: Category::Security,
            severity: Severity::Info,
            title: "Tabellen ohne Row Level Security",
            explanation: "Ohne RLS sieht jede Rolle mit SELECT-Recht alle Zeilen. Relevant, wenn Clients direkt auf die Datenbank zugreifen (z.B. über PostgREST) oder RLS bereits für andere Tabellen genutzt wird.",
            sql: RLS_SQL,
        },
        Check {
            id: "security_definer_public",
            category: Category::Security,
            severity: Severity::Critical,
            title: "SECURITY DEFINER-Funktionen für PUBLIC ausführbar",
            explanation: "Diese Funktionen laufen mit den Rechten ihres Besitzers und können von jeder Rolle aufgerufen werden. Das ermöglicht Rechteausweitung.",
            sql: SECDEF_SQL,
        },
        Check {
            id: "mutable_search_path",
            category: Category::Security,
            severity: Severity::Info,
            title: "Funktionen mit veränderlichem search_path",
            explanation: "Ohne festen search_path kann ein Aufrufer Objekte mit gleichem Namen unterschieben. Besonders kritisch bei SECURITY DEFINER.",
            sql: SEARCH_PATH_SQL,
        },
        Check {
            id: "superuser_roles",
            category: Category::Security,
            severity: Severity::Warning,
            title: "Zusätzliche Superuser-Rollen",
            explanation: "Superuser umgehen alle Rechteprüfungen. Anwendungs- und Personenrollen sollten ohne SUPERUSER auskommen.",
            sql: SUPERUSER_SQL,
        },
        Check {
            id: "missing_primary_key",
            category: Category::Schema,
            severity: Severity::Warning,
            title: "Tabellen ohne Primärschlüssel",
            explanation: "Ohne Primärschlüssel lassen sich Zeilen nicht eindeutig adressieren; logische Replikation, Updates aus Tools und Deduplizierung werden schwierig.",
            sql: NO_PK_SQL,
        },
        Check {
            id: "fk_without_index",
            category: Category::Schema,
            severity: Severity::Warning,
            title: "Fremdschlüssel ohne passenden Index",
            explanation: "Beim Löschen oder Ändern in der referenzierten Tabelle muss die abhängige Tabelle vollständig gescannt werden. Joins über den Fremdschlüssel werden langsam.",
            sql: FK_INDEX_SQL,
        },
        Check {
            id: DUPLICATE_INDEX_ID,
            category: Category::Schema,
            severity: Severity::Warning,
            title: "Doppelte Indizes",
            explanation: "Mehrere Indizes mit identischen Spalten, Ausdrücken und Prädikat kosten Speicher und verlangsamen jeden Schreibzugriff, ohne Lesezugriffe zu beschleunigen.",
            sql: INDEX_LIST_SQL,
        },
        Check {
            id: "invalid_indexes",
            category: Category::Schema,
            severity: Severity::Critical,
            title: "Ungültige Indizes",
            explanation: "Ein abgebrochenes CREATE INDEX CONCURRENTLY hinterlässt einen ungültigen Index. Er wird nicht für Abfragen genutzt, aber bei jedem Schreibzugriff gepflegt.",
            sql: INVALID_INDEX_SQL,
        },
        Check {
            id: "unused_indexes",
            category: Category::Performance,
            severity: Severity::Info,
            title: "Unbenutzte Indizes",
            explanation: "Diese Indizes wurden seit dem letzten Statistik-Reset nie gelesen. Prüfe auch Replikas, bevor du sie entfernst.",
            sql: UNUSED_INDEX_SQL,
        },
        Check {
            id: "table_bloat",
            category: Category::Performance,
            severity: Severity::Info,
            title: "Tabellen mit vielen toten Tupeln",
            explanation: "Ein hoher Anteil toter Tupel deutet auf Bloat hin: Scans lesen unnötig viele Seiten. Autovacuum hält eventuell nicht Schritt.",
            sql: BLOAT_SQL,
        },
        Check {
            id: "cache_hit_ratio",
            category: Category::Performance,
            severity: Severity::Info,
            title: "Niedrige Cache-Trefferquote",
            explanation: "Ein großer Teil der Blöcke wird von der Platte statt aus shared_buffers gelesen. Mehr Speicher oder bessere Indizes können helfen.",
            sql: CACHE_SQL,
        },
        Check {
            id: "sequence_exhaustion",
            category: Category::Performance,
            severity: Severity::Warning,
            title: "Sequenzen kurz vor dem Maximum",
            explanation: "Erreicht eine Sequenz ihren Höchstwert, schlagen Inserts fehl. Die zugehörige Spalte muss eventuell ebenfalls auf bigint umgestellt werden.",
            sql: SEQUENCE_SQL,
        },
        Check {
            id: "never_vacuumed",
            category: Category::Performance,
            severity: Severity::Info,
            title: "Nie gevacuumte oder analysierte Tabellen",
            explanation: "Ohne VACUUM wachsen tote Tupel an, ohne ANALYZE plant der Optimierer mit falschen Schätzungen.",
            sql: NEVER_VACUUMED_SQL,
        },
        Check {
            id: SLOW_QUERY_ID,
            category: Category::Performance,
            severity: Severity::Info,
            title: "Langsame Abfragen (pg_stat_statements)",
            explanation: "Die Abfragen mit der höchsten Gesamtlaufzeit und mehr als 100 ms im Mittel. Ein EXPLAIN zeigt fehlende Indizes oder ungünstige Pläne.",
            sql: SLOW_QUERY_SQL,
        },
    ]
}

fn text(row: &Value, key: &str) -> Option<String> {
    match row.get(key)? {
        Value::Null => None,
        Value::String(value) => Some(value.clone()),
        other => Some(other.to_string()),
    }
}

fn flag(row: &Value, key: &str) -> bool {
    matches!(text(row, key).as_deref(), Some("true" | "t"))
}

fn result(check: &Check, objects: Vec<HealthObject>, severity: Severity) -> HealthCheckResult {
    let fixes: Vec<&str> = objects
        .iter()
        .filter_map(|object| object.fix_sql.as_deref())
        .collect();
    HealthCheckResult {
        id: check.id.to_string(),
        category: check.category,
        title: check.title.to_string(),
        explanation: check.explanation.to_string(),
        status: if objects.is_empty() {
            CheckStatus::Ok
        } else {
            CheckStatus::Issue
        },
        severity: (!objects.is_empty()).then_some(severity),
        fix_sql: (!fixes.is_empty()).then(|| fixes.join("\n")),
        objects,
        skipped_reason: None,
    }
}

fn skipped(check: &Check, reason: String) -> HealthCheckResult {
    HealthCheckResult {
        id: check.id.to_string(),
        category: check.category,
        title: check.title.to_string(),
        explanation: check.explanation.to_string(),
        status: CheckStatus::Skipped,
        severity: None,
        objects: Vec::new(),
        fix_sql: None,
        skipped_reason: Some(reason),
    }
}

fn map_rows(check: &Check, rows: &[Value]) -> HealthCheckResult {
    let mut severity: Option<Severity> = None;
    let objects = rows
        .iter()
        .filter_map(|row| {
            let name = text(row, "object")?;
            let row_severity = text(row, "severity")
                .and_then(|value| Severity::parse(&value))
                .unwrap_or(check.severity);
            severity = Some(severity.map_or(row_severity, |s| s.max(row_severity)));
            Some(HealthObject {
                name,
                detail: text(row, "detail").filter(|value| !value.is_empty()),
                fix_sql: text(row, "fix"),
            })
        })
        .collect();
    result(check, objects, severity.unwrap_or(check.severity))
}

pub fn duplicate_indexes(rows: &[Value]) -> Vec<HealthObject> {
    let mut groups: BTreeMap<(String, String, String, String, String, String), Vec<&Value>> =
        BTreeMap::new();
    for row in rows {
        let key = (
            text(row, "table_name").unwrap_or_default(),
            text(row, "method").unwrap_or_default(),
            text(row, "keys").unwrap_or_default(),
            text(row, "opclasses").unwrap_or_default(),
            text(row, "exprs").unwrap_or_default(),
            text(row, "pred").unwrap_or_default(),
        );
        groups.entry(key).or_default().push(row);
    }
    let mut objects = Vec::new();
    for ((table, ..), mut members) in groups {
        if members.len() < 2 {
            continue;
        }
        members.sort_by_key(|row| {
            (
                !flag(row, "is_primary"),
                !flag(row, "backs_constraint"),
                !flag(row, "is_unique"),
                text(row, "index_name").unwrap_or_default(),
            )
        });
        let keep = text(members[0], "index_name").unwrap_or_default();
        for row in &members[1..] {
            let name = text(row, "index_name").unwrap_or_default();
            let droppable = !flag(row, "is_primary")
                && !flag(row, "backs_constraint")
                && (!flag(row, "is_unique") || flag(members[0], "is_unique"));
            objects.push(HealthObject {
                detail: Some(format!(
                    "auf {table}, identisch mit {keep}{}",
                    text(row, "size")
                        .map(|size| format!(", {size}"))
                        .unwrap_or_default()
                )),
                fix_sql: droppable.then(|| format!("DROP INDEX CONCURRENTLY {name};")),
                name,
            });
        }
    }
    objects
}

fn quote_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

async fn slow_query_sql(adapter: &dyn DatabaseAdapter) -> Result<String, String> {
    let ext = adapter
        .execute_query("SELECT n.nspname AS schema_name, e.extversion AS version FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_stat_statements'")
        .await?;
    let row = ext
        .rows
        .first()
        .ok_or("Erweiterung pg_stat_statements ist nicht installiert")?;
    let schema = text(row, "schema_name").unwrap_or_else(|| "public".into());
    let columns = adapter
        .execute_query(&format!(
            "SELECT count(*)::text AS n FROM pg_attribute WHERE attrelid = '{}.pg_stat_statements'::regclass AND attname = 'mean_exec_time'",
            quote_ident(&schema).replace('\'', "''")
        ))
        .await?;
    let modern = columns
        .rows
        .first()
        .and_then(|row| text(row, "n"))
        .is_some_and(|n| n != "0");
    let (mean, total) = if modern {
        ("mean_exec_time", "total_exec_time")
    } else {
        ("mean_time", "total_time")
    };
    Ok(SLOW_QUERY_SQL
        .replace("{SCHEMA}", &quote_ident(&schema))
        .replace("{MEAN}", mean)
        .replace("{TOTAL}", total))
}

fn skip_reason(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("permission denied") || lower.contains("keine berechtigung") {
        format!("Keine Berechtigung: {error}")
    } else {
        error.to_string()
    }
}

async fn run_check(adapter: &dyn DatabaseAdapter, check: &Check) -> HealthCheckResult {
    let sql = if check.id == SLOW_QUERY_ID {
        match slow_query_sql(adapter).await {
            Ok(sql) => sql,
            Err(reason) => return skipped(check, reason),
        }
    } else {
        check.sql.replace("{USER}", USER_SCHEMA)
    };
    match adapter.execute_query(&sql).await {
        Ok(data) if check.id == DUPLICATE_INDEX_ID => {
            result(check, duplicate_indexes(&data.rows), check.severity)
        }
        Ok(data) => map_rows(check, &data.rows),
        Err(error) => skipped(check, skip_reason(&error)),
    }
}

pub async fn run_health_checks(adapter: &dyn DatabaseAdapter) -> HealthReport {
    let started = Instant::now();
    let mut results = Vec::new();
    for check in checks() {
        results.push(run_check(adapter, &check).await);
    }
    HealthReport {
        checks: results,
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

#[tauri::command]
pub async fn run_database_health_checks(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<HealthReport, String> {
    if !kind.capabilities().health_advisor {
        return Err("Health-Checks werden für diese Verbindung nicht unterstützt.".into());
    }
    let adapter = create_adapter_from_string(
        kind,
        &connection_string,
        database.as_deref(),
        pool_state.inner().clone(),
    )?;
    Ok(run_health_checks(adapter.as_ref()).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn index(name: &str, keys: &str, unique: bool, primary: bool) -> Value {
        json!({
            "table_name": "public.orders",
            "index_name": name,
            "method": "btree",
            "keys": keys,
            "opclasses": "1978",
            "exprs": "",
            "pred": "",
            "is_unique": unique.to_string(),
            "is_primary": primary.to_string(),
            "backs_constraint": primary.to_string(),
            "size": "8192 bytes",
        })
    }

    #[test]
    fn duplicate_indexes_keep_primary_and_drop_plain_copies() {
        let rows = vec![
            index("public.orders_b", "1", false, false),
            index("public.orders_pkey", "1", true, true),
            index("public.orders_a", "1", false, false),
            index("public.orders_other", "2", false, false),
        ];
        let found = duplicate_indexes(&rows);
        let names: Vec<&str> = found.iter().map(|o| o.name.as_str()).collect();
        assert_eq!(names, vec!["public.orders_a", "public.orders_b"]);
        assert_eq!(
            found[0].fix_sql.as_deref(),
            Some("DROP INDEX CONCURRENTLY public.orders_a;")
        );
        assert!(found[0]
            .detail
            .as_deref()
            .unwrap()
            .contains("public.orders_pkey"));
    }

    #[test]
    fn duplicate_indexes_respect_predicate_and_keep_unique_droppable_only_when_safe() {
        let mut partial = index("public.orders_partial", "1", false, false);
        partial["pred"] = json!("(status = 'open'::text)");
        let rows = vec![
            index("public.orders_plain", "1", false, false),
            partial,
            index("public.orders_uniq", "3", true, false),
            index("public.orders_uniq2", "3", true, false),
        ];
        let found = duplicate_indexes(&rows);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "public.orders_uniq2");
        assert!(found[0].fix_sql.is_some());
    }

    #[test]
    fn map_rows_takes_highest_row_severity_and_joins_fixes() {
        let check = checks()
            .into_iter()
            .find(|c| c.id == "table_bloat")
            .unwrap();
        let rows = vec![
            json!({"object": "public.a", "detail": "x", "fix": "VACUUM a;", "severity": "info"}),
            json!({"object": "public.b", "detail": "", "fix": "VACUUM b;", "severity": "warning"}),
            json!({"object": null, "fix": "ignored"}),
        ];
        let result = map_rows(&check, &rows);
        assert_eq!(result.status, CheckStatus::Issue);
        assert_eq!(result.severity, Some(Severity::Warning));
        assert_eq!(result.objects.len(), 2);
        assert_eq!(result.objects[1].detail, None);
        assert_eq!(result.fix_sql.as_deref(), Some("VACUUM a;\nVACUUM b;"));
    }

    #[test]
    fn map_rows_without_rows_is_ok() {
        let check = checks().into_iter().next().unwrap();
        let result = map_rows(&check, &[]);
        assert_eq!(result.status, CheckStatus::Ok);
        assert_eq!(result.severity, None);
        assert_eq!(result.fix_sql, None);
    }

    #[test]
    fn every_check_sql_is_read_only() {
        for check in checks() {
            let sql = check.sql.replace("{USER}", USER_SCHEMA).to_uppercase();
            let head = sql.trim_start();
            assert!(
                head.starts_with("SELECT") || head.starts_with("WITH"),
                "{}",
                check.id
            );
        }
    }
}
