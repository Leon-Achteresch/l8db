use super::catalog::{
    allowed, fresh, now, Catalog, Keys, Kind, Objects, Relation, Routine, Trigger,
};
use super::config::{McpConfig, McpConnection};
use super::discovery::{mask_hidden, Notes, View};
use super::insight::{bulk_query, edges_from, keys_from, number, text_cell};
use super::redact::Redactor;
use super::server::{adapter, arg_str, run, Server};
use crate::db::{DatabaseAdapter, DatabaseKind, QueryResult};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::Instant;

const MAX_RELATIONS: usize = 200_000;
const MAX_ROUTINES: usize = 100_000;
const SOURCE_HITS: i64 = 200;
const SNIPPET: usize = 120;
const MAX_TERMS: usize = 5;

#[cfg(test)]
thread_local! {
    pub(crate) static CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

pub(super) fn count() {
    #[cfg(test)]
    CALLS.with(|calls| calls.set(calls.get() + 1));
}

async fn fetch(adapter: &dyn DatabaseAdapter, sql: &str) -> Result<Vec<Vec<String>>, String> {
    count();
    let result = adapter.execute_query(sql).await?;
    Ok(cells(&result))
}

fn cells(result: &QueryResult) -> Vec<Vec<String>> {
    result
        .rows
        .iter()
        .map(|row| {
            (0..result.columns.len())
                .map(|index| text_cell(row, &result.columns[index], index))
                .collect()
        })
        .collect()
}

fn int(text: &str) -> Option<i64> {
    number(&serde_json::Value::String(text.to_string()))
        .filter(|value| *value >= 0.0)
        .map(|value| value as i64)
}

fn literal(text: &str) -> Option<String> {
    (!text.contains(['\\', '\0'])).then(|| format!("'{}'", text.replace('\'', "''")))
}

const SYSTEM_MYSQL: &str = "('mysql', 'sys', 'performance_schema', 'information_schema')";

fn within(column: &str, allowlist: &[String]) -> String {
    if allowlist.is_empty() || allowlist.len() > 1000 {
        return String::new();
    }
    let names: Vec<String> = allowlist
        .iter()
        .filter_map(|schema| literal(schema))
        .collect();
    if names.is_empty() {
        return " AND 1 = 0".into();
    }
    format!(" AND {column} IN ({})", names.join(", "))
}

fn relations_sql(kind: DatabaseKind, schemas: &[String], allowlist: &[String]) -> Option<String> {
    Some(match kind {
        DatabaseKind::Postgres => format!(
            "SELECT n.nspname AS a, c.relname AS b, c.relkind::text AS c, \
             CASE WHEN c.relkind = 'p' THEN (SELECT sum(greatest(ch.reltuples, 0))::bigint FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class ch ON ch.oid = i.inhrelid WHERE i.inhparent = c.oid) \
                  WHEN c.reltuples >= 0 AND c.relkind IN ('r', 'm', 'f') THEN c.reltuples::bigint END AS d, \
             CASE WHEN c.relkind IN ('r', 'm') THEN c.relpages::bigint * current_setting('block_size')::bigint END AS e, \
             d.description AS f \
             FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             LEFT JOIN pg_catalog.pg_description d ON d.objoid = c.oid AND d.classoid = 'pg_catalog.pg_class'::regclass AND d.objsubid = 0 \
             WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'{} \
             ORDER BY 1, 2 LIMIT {MAX_RELATIONS}",
            within("n.nspname", allowlist)
        ),
        DatabaseKind::Mysql => format!(
            "SELECT TABLE_SCHEMA AS a, TABLE_NAME AS b, TABLE_TYPE AS c, TABLE_ROWS AS d, DATA_LENGTH + INDEX_LENGTH AS e, TABLE_COMMENT AS f \
             FROM information_schema.TABLES WHERE TABLE_SCHEMA NOT IN {SYSTEM_MYSQL}{} ORDER BY 1, 2 LIMIT {MAX_RELATIONS}",
            within("TABLE_SCHEMA", allowlist)
        ),
        DatabaseKind::Mssql => format!(
            "SELECT TOP {MAX_RELATIONS} s.name AS a, o.name AS b, RTRIM(o.type) AS c, \
             (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)) AS d, \
             (SELECT SUM(u.total_pages) * 8192 FROM sys.partitions p JOIN sys.allocation_units u ON u.container_id = p.partition_id WHERE p.object_id = o.object_id) AS e, \
             CAST(x.value AS nvarchar(2000)) AS f \
             FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id \
             LEFT JOIN sys.extended_properties x ON x.class = 1 AND x.major_id = o.object_id AND x.minor_id = 0 AND x.name = 'MS_Description' \
             WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0{} ORDER BY 1, 2",
            within("s.name", allowlist)
        ),
        DatabaseKind::Oracle => {
            let owners: Vec<String> = schemas.iter().take(1000).filter_map(|schema| literal(schema)).collect();
            if owners.is_empty() {
                return None;
            }
            let owners = owners.join(", ");
            format!(
                "SELECT * FROM (SELECT owner AS a, table_name AS b, 'TABLE' AS c, num_rows AS d, blocks * 8192 AS e, \
                 (SELECT comments FROM all_tab_comments m WHERE m.owner = t.owner AND m.table_name = t.table_name) AS f \
                 FROM all_tables t WHERE owner IN ({owners}) \
                 UNION ALL SELECT owner, view_name, 'VIEW', NULL, NULL, NULL FROM all_views WHERE owner IN ({owners}) \
                 UNION ALL SELECT owner, mview_name, 'MVIEW', NULL, NULL, NULL FROM all_mviews WHERE owner IN ({owners})) \
                 WHERE ROWNUM <= {MAX_RELATIONS}"
            )
        }
        DatabaseKind::Clickhouse => format!(
            "SELECT database AS a, name AS b, engine AS c, total_rows AS d, total_bytes AS e, comment AS f FROM system.tables \
             WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') AND NOT is_temporary{} ORDER BY 1, 2 LIMIT {MAX_RELATIONS}",
            within("database", allowlist)
        ),
        DatabaseKind::Sqlite => "SELECT 'main' AS a, name AS b, type AS c, NULL AS d, NULL AS e, NULL AS f FROM sqlite_master \
             WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY 2"
            .to_string(),
        DatabaseKind::Duckdb => "SELECT schema_name AS a, table_name AS b, 'table' AS c, estimated_size AS d, NULL AS e, comment AS f FROM duckdb_tables() WHERE NOT internal \
             UNION ALL SELECT schema_name, view_name, 'view', NULL, NULL, comment FROM duckdb_views() WHERE NOT internal ORDER BY 1, 2"
            .to_string(),
        _ => return None,
    })
}

fn relation_kind(kind: DatabaseKind, code: &str) -> Option<Kind> {
    Some(match (kind, code) {
        (DatabaseKind::Postgres, "v") => Kind::View,
        (DatabaseKind::Postgres, "m") => Kind::Matview,
        (DatabaseKind::Postgres, "f") => Kind::Foreign,
        (DatabaseKind::Postgres, "p") => Kind::Partitioned,
        (DatabaseKind::Postgres, _) => Kind::Table,
        (_, "SYSTEM VIEW") => return None,
        (_, "VIEW" | "V" | "view" | "View") => Kind::View,
        (_, "MVIEW" | "MaterializedView") => Kind::Matview,
        _ => Kind::Table,
    })
}

const POSTGRES_ROUTINES: &str = "SELECT n.nspname AS a, p.proname AS b, p.prokind::text AS c, \
     pg_catalog.pg_get_function_identity_arguments(p.oid) AS d, \
     CASE WHEN p.prokind = 'p' THEN '' ELSE pg_catalog.pg_get_function_result(p.oid) END AS e, \
     l.lanname AS f, p.oid::text AS g, length(p.prosrc) - length(replace(p.prosrc, chr(10), '')) + 1 AS h \
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace JOIN pg_catalog.pg_language l ON l.oid = p.prolang \
     WHERE p.prokind IN ('f', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%' \
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e WHERE e.classid = 'pg_catalog.pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e'){filter} \
     ORDER BY 1, 2 LIMIT 100000";

const MYSQL_ROUTINES: &str = "SELECT ROUTINE_SCHEMA AS a, ROUTINE_NAME AS b, ROUTINE_TYPE AS c, '' AS d, COALESCE(DTD_IDENTIFIER, '') AS e, 'SQL' AS f, '' AS g, \
     LENGTH(ROUTINE_DEFINITION) - LENGTH(REPLACE(ROUTINE_DEFINITION, CHAR(10), '')) + 1 AS h \
     FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema'){filter} ORDER BY 1, 2 LIMIT 100000";

const POSTGRES_TRIGGERS: &str = "SELECT n.nspname AS a, t.tgname AS b, c.relname AS c, pn.nspname AS d, p.proname AS e \
     FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
     JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace \
     WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'{filter} ORDER BY 1, 3, 2 LIMIT 50000";

const SQLITE_TRIGGERS: &str =
    "SELECT 'main' AS a, name AS b, tbl_name AS c, '' AS d, '' AS e FROM sqlite_master WHERE type = 'trigger' ORDER BY 3, 2";

async fn routines(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    allowlist: &[String],
) -> Vec<Routine> {
    if matches!(kind, DatabaseKind::Sqlite | DatabaseKind::Duckdb) {
        return Vec::new();
    }
    let sql = match kind {
        DatabaseKind::Postgres => {
            Some(POSTGRES_ROUTINES.replace("{filter}", &within("n.nspname", allowlist)))
        }
        DatabaseKind::Mysql => {
            Some(MYSQL_ROUTINES.replace("{filter}", &within("ROUTINE_SCHEMA", allowlist)))
        }
        _ => None,
    };
    if let Some(sql) = sql {
        return fetch(adapter, &sql)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|row| {
                let procedure = matches!(row[2].as_str(), "p" | "PROCEDURE");
                Routine {
                    id: if kind == DatabaseKind::Mysql {
                        format!("{}\u{1f}{}\u{1f}{}", row[0], row[1], row[2])
                    } else {
                        row[6].clone()
                    },
                    schema: row[0].clone(),
                    name: row[1].clone(),
                    kind: if procedure {
                        Kind::Procedure
                    } else {
                        Kind::Function
                    },
                    args: row[3].clone(),
                    returns: row[4].clone(),
                    language: row[5].clone(),
                    lines: int(&row[7]).map(|lines| lines as u32),
                }
            })
            .collect();
    }
    let mut out = Vec::new();
    count();
    for (procedures, list) in [
        (false, adapter.list_functions(None).await),
        (true, {
            count();
            adapter.list_procedures(None).await
        }),
    ] {
        out.extend(list.unwrap_or_default().into_iter().map(|info| {
            let procedure =
                procedures || info.return_type.to_ascii_uppercase().contains("PROCEDURE");
            Routine {
                kind: if procedure {
                    Kind::Procedure
                } else {
                    Kind::Function
                },
                schema: info.schema,
                name: info.name,
                args: info.identity_args,
                returns: if procedure {
                    String::new()
                } else {
                    info.return_type
                },
                language: info.language,
                id: info.oid,
                lines: None,
            }
        }));
    }
    out.truncate(MAX_ROUTINES);
    out
}

pub(super) async fn load(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    schemas: &[String],
    allowlist: &[String],
) -> Objects {
    let started = Instant::now();
    let mut objects = Objects {
        taken: now(),
        ..Objects::default()
    };
    if !super::server::SQL_KINDS.contains(&kind) {
        return objects;
    }
    match relations_sql(kind, schemas, allowlist) {
        Some(sql) => {
            objects.relations = fetch(adapter, &sql)
                .await
                .unwrap_or_default()
                .into_iter()
                .filter_map(|row| {
                    let kind = relation_kind(kind, &row[2])?;
                    let comment = Some(row[5].trim())
                        .filter(|text| !text.is_empty() && !(kind == Kind::View && *text == "VIEW"))
                        .map(|text| text.chars().take(500).collect());
                    Some(Relation {
                        schema: row[0].clone(),
                        name: row[1].clone(),
                        kind,
                        rows: int(&row[3]),
                        bytes: int(&row[4]).filter(|bytes| *bytes > 0),
                        comment,
                    })
                })
                .collect();
        }
        None => {
            count();
            if let Ok(views) = adapter.list_views(None).await {
                objects
                    .relations
                    .extend(views.into_iter().map(|view| Relation {
                        schema: view.schema,
                        name: view.name,
                        kind: Kind::View,
                        rows: None,
                        bytes: None,
                        comment: None,
                    }));
            }
        }
    }
    objects.routines = routines(adapter, kind, allowlist).await;
    for routine in &mut objects.routines {
        routine.args = mask_hidden(&routine.args, allowlist);
        routine.returns = mask_hidden(&routine.returns, allowlist);
    }
    let triggers = match kind {
        DatabaseKind::Postgres => {
            Some(POSTGRES_TRIGGERS.replace("{filter}", &within("n.nspname", allowlist)))
        }
        DatabaseKind::Sqlite => Some(SQLITE_TRIGGERS.to_string()),
        _ => None,
    };
    if let Some(sql) = triggers {
        objects.triggers = fetch(adapter, &sql)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|row| Trigger {
                schema: row[0].clone(),
                name: row[1].clone(),
                table: row[2].clone(),
                routine: match (row[3].as_str(), row[4].as_str()) {
                    (_, "") => String::new(),
                    (schema, name) if allowed(schema, allowlist) => format!("{schema}.{name}"),
                    _ => "[hidden]".into(),
                },
            })
            .collect();
    }
    objects.ms = started.elapsed().as_millis() as u64;
    objects.sort();
    objects
}

pub(super) struct Hit {
    pub schema: String,
    pub name: String,
    pub kind: Kind,
    pub line: usize,
    pub snippet: String,
    pub occurrences: usize,
}

pub(super) fn snippet(source: &str, term: &str) -> Option<(usize, String, usize)> {
    let needle = term.to_lowercase();
    if needle.is_empty() {
        return None;
    }
    let mut first = None;
    let mut occurrences = 0;
    for (index, line) in source.lines().enumerate() {
        let hits = line.to_lowercase().matches(&needle).count();
        if hits == 0 {
            continue;
        }
        occurrences += hits;
        first.get_or_insert_with(|| (index + 1, line.trim().chars().take(SNIPPET).collect()));
    }
    first.map(|(line, text)| (line, text, occurrences))
}

pub(super) fn safe_term(term: &str) -> Result<String, String> {
    let term = term.trim();
    if term.is_empty()
        || term.chars().count() > 100
        || !term
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '_' | '.' | '$' | '#'))
    {
        return Err("in=source braucht einen Begriff aus Buchstaben, Ziffern, Leerzeichen und _ . $ # (höchstens 100 Zeichen).".into());
    }
    Ok(term.to_string())
}

fn source_kind(code: &str) -> Kind {
    match code.to_ascii_lowercase().as_str() {
        "view" | "v" => Kind::View,
        "materialized_view" | "materializedview" => Kind::Matview,
        "procedure" | "p" | "pc" | "x" => Kind::Procedure,
        "trigger" | "tr" | "ta" => Kind::Trigger,
        _ => Kind::Function,
    }
}

pub(super) fn source_sql(
    kind: DatabaseKind,
    term: &str,
    schemas: &[String],
    allowlist: &[String],
) -> Option<String> {
    let like = format!("'%{term}%'");
    Some(match kind {
        DatabaseKind::Sqlite => format!(
            "SELECT 'main' AS a, name AS b, type AS c, sql AS d FROM sqlite_master WHERE type IN ('view', 'trigger') AND sql LIKE {like} LIMIT {SOURCE_HITS}"
        ),
        DatabaseKind::Duckdb => format!(
            "SELECT schema_name AS a, view_name AS b, 'view' AS c, sql AS d FROM duckdb_views() WHERE NOT internal AND sql ILIKE {like}{} LIMIT {SOURCE_HITS}",
            within("schema_name", allowlist)
        ),
        DatabaseKind::Mysql => format!(
            "SELECT ROUTINE_SCHEMA AS a, ROUTINE_NAME AS b, ROUTINE_TYPE AS c, ROUTINE_DEFINITION AS d FROM information_schema.ROUTINES \
             WHERE ROUTINE_SCHEMA NOT IN {SYSTEM_MYSQL} AND ROUTINE_DEFINITION LIKE {like}{} \
             UNION ALL SELECT TABLE_SCHEMA, TABLE_NAME, 'VIEW', VIEW_DEFINITION FROM information_schema.VIEWS \
             WHERE TABLE_SCHEMA NOT IN {SYSTEM_MYSQL} AND VIEW_DEFINITION LIKE {like}{} LIMIT {SOURCE_HITS}",
            within("ROUTINE_SCHEMA", allowlist),
            within("TABLE_SCHEMA", allowlist)
        ),
        DatabaseKind::Mssql => format!(
            "SELECT TOP {SOURCE_HITS} s.name AS a, o.name AS b, RTRIM(o.type) AS c, m.definition AS d FROM sys.sql_modules m \
             JOIN sys.objects o ON o.object_id = m.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE m.definition LIKE {like}{}",
            within("s.name", allowlist)
        ),
        DatabaseKind::Clickhouse => format!(
            "SELECT database AS a, name AS b, engine AS c, create_table_query AS d FROM system.tables \
             WHERE engine IN ('View', 'MaterializedView') AND positionCaseInsensitive(create_table_query, '{term}') > 0{} LIMIT {SOURCE_HITS}",
            within("database", allowlist)
        ),
        DatabaseKind::Oracle => {
            let owners: Vec<String> = schemas.iter().take(1000).filter_map(|schema| literal(schema)).collect();
            if owners.is_empty() {
                return None;
            }
            format!(
                "SELECT owner AS a, name AS b, type AS c, line AS d, text AS e FROM all_source \
                 WHERE owner IN ({}) AND UPPER(text) LIKE UPPER({like}) AND ROWNUM <= {}",
                owners.join(", "),
                SOURCE_HITS * 2
            )
        }
        _ => return None,
    })
}

pub(super) async fn search_source(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    term: &str,
    schemas: &[String],
    allowlist: &[String],
) -> Option<Result<Vec<Hit>, String>> {
    if kind == DatabaseKind::Postgres {
        count();
        let schema = match schemas {
            [only] => Some(only.as_str()),
            _ => None,
        };
        let limit = if schema.is_some() {
            SOURCE_HITS
        } else {
            SOURCE_HITS * 3
        };
        return Some(
            adapter
                .search_source(schema, term, limit)
                .await
                .map(|found| {
                    found
                        .into_iter()
                        .map(|hit| Hit {
                            kind: source_kind(&hit.object_type),
                            name: if hit.identity.is_empty() || hit.object_type.contains("view") {
                                hit.name
                            } else {
                                format!("{}({})", hit.name, hit.identity)
                            },
                            schema: hit.schema,
                            line: hit.line.max(1) as usize,
                            snippet: hit.snippet,
                            occurrences: hit.occurrences.max(1) as usize,
                        })
                        .collect()
                }),
        );
    }
    let sql = source_sql(kind, term, schemas, allowlist)?;
    Some(fetch(adapter, &sql).await.map(|rows| {
        if kind == DatabaseKind::Oracle {
            let mut grouped: Vec<Hit> = Vec::new();
            let needle = term.to_lowercase();
            for row in rows
                .into_iter()
                .filter(|row| row[4].to_lowercase().contains(&needle))
            {
                let line = int(&row[3]).unwrap_or(1).max(1) as usize;
                match grouped
                    .iter_mut()
                    .find(|hit| hit.schema == row[0] && hit.name == row[1])
                {
                    Some(hit) => hit.occurrences += 1,
                    None => grouped.push(Hit {
                        schema: row[0].clone(),
                        name: row[1].clone(),
                        kind: source_kind(&row[2].replace("PACKAGE BODY", "procedure")),
                        line,
                        snippet: row[4].trim().chars().take(SNIPPET).collect(),
                        occurrences: 1,
                    }),
                }
            }
            return grouped;
        }
        rows.into_iter()
            .filter_map(|row| {
                let (line, snippet, occurrences) = snippet(&row[3], term)?;
                Some(Hit {
                    schema: row[0].clone(),
                    name: row[1].clone(),
                    kind: source_kind(&row[2]),
                    line,
                    snippet,
                    occurrences,
                })
            })
            .collect()
    }))
}

pub(super) enum Target<'a> {
    Routine(&'a Routine),
    Relation(&'a str, &'a str, Kind),
    Trigger(&'a Trigger),
}

pub(super) async fn source(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    target: &Target<'_>,
) -> Result<String, String> {
    count();
    match target {
        Target::Routine(routine) => adapter.get_function_definition(&routine.id).await,
        Target::Relation(schema, name, _) => adapter.get_view_definition(schema, name).await,
        Target::Trigger(trigger) => {
            let sql = match kind {
                DatabaseKind::Postgres => format!(
                    "SELECT pg_catalog.pg_get_triggerdef(t.oid, true) AS a FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid \
                     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = {} AND c.relname = {} AND t.tgname = {}",
                    literal(&trigger.schema).ok_or("Name nicht unterstützt")?,
                    literal(&trigger.table).ok_or("Name nicht unterstützt")?,
                    literal(&trigger.name).ok_or("Name nicht unterstützt")?
                ),
                DatabaseKind::Sqlite => format!(
                    "SELECT sql AS a FROM sqlite_master WHERE type = 'trigger' AND name = {}",
                    literal(&trigger.name).ok_or("Name nicht unterstützt")?
                ),
                _ => return Err("Trigger-Quelltext wird für diese Datenbank nicht unterstützt.".into()),
            };
            let result = adapter.execute_query(&sql).await?;
            cells(&result)
                .into_iter()
                .next()
                .and_then(|row| row.into_iter().next())
                .ok_or_else(|| "Trigger nicht gefunden".into())
        }
    }
}

pub(super) async fn reported(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    target: &Target<'_>,
) -> Option<Vec<(String, String)>> {
    let sql = match (kind, target) {
        (DatabaseKind::Postgres, Target::Relation(schema, name, _)) => format!(
            "SELECT DISTINCT rn.nspname AS a, rc.relname AS b FROM pg_catalog.pg_rewrite w \
             JOIN pg_catalog.pg_class v ON v.oid = w.ev_class JOIN pg_catalog.pg_namespace vn ON vn.oid = v.relnamespace \
             JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = w.oid AND d.refclassid = 'pg_catalog.pg_class'::regclass \
             JOIN pg_catalog.pg_class rc ON rc.oid = d.refobjid JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace \
             WHERE vn.nspname = {} AND v.relname = {} AND rc.oid <> v.oid ORDER BY 1, 2",
            literal(schema)?,
            literal(name)?
        ),
        (DatabaseKind::Postgres, Target::Routine(routine))
            if !routine.id.is_empty() && routine.id.chars().all(|c| c.is_ascii_digit()) =>
        {
            format!(
                "SELECT rn.nspname AS a, rc.relname AS b FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class rc ON rc.oid = d.refobjid \
                 JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace \
                 WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = {id} AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.deptype = 'n' \
                 UNION SELECT pn.nspname, p.proname FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_proc p ON p.oid = d.refobjid \
                 JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace \
                 WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = {id} AND d.refclassid = 'pg_catalog.pg_proc'::regclass AND d.deptype = 'n'",
                id = routine.id
            )
        }
        (DatabaseKind::Oracle, _) => {
            let (schema, name) = match target {
                Target::Routine(routine) => (routine.schema.as_str(), routine.name.as_str()),
                Target::Relation(schema, name, _) => (*schema, *name),
                Target::Trigger(trigger) => (trigger.schema.as_str(), trigger.name.as_str()),
            };
            format!(
                "SELECT referenced_owner AS a, referenced_name AS b FROM all_dependencies WHERE owner = {} AND name = {} \
                 AND referenced_owner NOT IN ('SYS', 'PUBLIC') AND referenced_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW', 'FUNCTION', 'PROCEDURE', 'PACKAGE', 'SYNONYM')",
                literal(schema)?,
                literal(name)?
            )
        }
        (DatabaseKind::Mssql, _) => {
            let (schema, name) = match target {
                Target::Routine(routine) => (routine.schema.as_str(), routine.name.as_str()),
                Target::Relation(schema, name, _) => (*schema, *name),
                Target::Trigger(trigger) => (trigger.schema.as_str(), trigger.name.as_str()),
            };
            if format!("{schema}{name}").contains([']', '\'']) {
                return None;
            }
            format!(
                "SELECT COALESCE(d.referenced_schema_name, OBJECT_SCHEMA_NAME(d.referencing_id)) AS a, d.referenced_entity_name AS b \
                 FROM sys.sql_expression_dependencies d WHERE d.referencing_id = OBJECT_ID(N'[{schema}].[{name}]')"
            )
        }
        _ => return None,
    };
    let rows = fetch(adapter, &sql).await.ok()?;
    Some(
        rows.into_iter()
            .map(|row| (row[0].clone(), row[1].clone()))
            .collect(),
    )
}

#[derive(Default)]
pub(super) struct Uses {
    pub reads: BTreeSet<String>,
    pub writes: BTreeSet<String>,
    pub calls: BTreeSet<String>,
}

pub(super) struct Names {
    pub relations: HashMap<String, Vec<(String, String)>>,
    pub routines: HashMap<String, Vec<(String, String)>>,
}

impl Names {
    fn resolve(
        list: &HashMap<String, Vec<(String, String)>>,
        chain: &[String],
        home: &str,
    ) -> Option<String> {
        let (schema, name) = match chain {
            [.., schema, name] => (Some(schema.as_str()), name.as_str()),
            [name] => (None, name.as_str()),
            [] => return None,
        };
        let found = list.get(name)?;
        let pick = |wanted: &str| {
            found
                .iter()
                .find(|(entry, _)| entry.eq_ignore_ascii_case(wanted))
                .map(|(schema, name)| super::server::qualified(schema, name))
        };
        match schema {
            Some(schema) => pick(schema),
            None => pick(home).or_else(|| match found.as_slice() {
                [(schema, name)] => Some(super::server::qualified(schema, name)),
                _ => None,
            }),
        }
    }
}

const CLAUSE_END: &[&str] = &[
    "where",
    "group",
    "order",
    "having",
    "limit",
    "on",
    "union",
    "select",
    "into",
    "set",
    "values",
    "returning",
    "window",
    "intersect",
    "except",
    "using",
    "loop",
    "then",
    "begin",
    "end",
    "if",
    "return",
    "when",
    "offset",
    "fetch",
    "for",
];

pub(super) fn lexical(source: &str, names: &Names, home: &str) -> Uses {
    use super::redact::Token;
    let source = regex::Regex::new(r"\$[A-Za-z_0-9]*\$")
        .map(|re| re.replace_all(source, " ").into_owned())
        .unwrap_or_else(|_| source.to_string());
    let tokens = super::redact::tokenize(&source);
    let mut uses = Uses::default();
    let word = |index: usize| match tokens.get(index) {
        Some(Token::Word(word)) => Some(word.as_str()),
        _ => None,
    };
    let chain_at = |start: usize| -> (Vec<String>, usize) {
        let mut parts = Vec::new();
        let mut index = start;
        while let Some(part) = word(index) {
            parts.push(part.to_string());
            if tokens.get(index + 1) == Some(&Token::Dot) && word(index + 2).is_some() {
                index += 2;
            } else {
                index += 1;
                break;
            }
        }
        (parts, index)
    };
    let mut from_list = false;
    let mut index = 0;
    while index < tokens.len() {
        let Some(current) = word(index) else {
            if tokens[index] != Token::Comma {
                from_list = false;
            }
            index += 1;
            continue;
        };
        let previous = index.checked_sub(1).and_then(|at| word(at));
        let before = index.checked_sub(2).and_then(|at| word(at));
        let writes = matches!(
            (before, previous),
            (Some("insert" | "merge"), Some("into"))
                | (Some("delete"), Some("from"))
                | (_, Some("update"))
                | (_, Some("truncate"))
                | (Some("truncate"), Some("table"))
        );
        let (chain, next) = chain_at(index);
        if CLAUSE_END.contains(&current) && chain.len() == 1 {
            from_list = false;
            index = next;
            continue;
        }
        if matches!(current, "from" | "join") {
            from_list = true;
            index = next;
            continue;
        }
        let called = !writes
            && (tokens.get(next) == Some(&Token::Open)
                || matches!(previous, Some("perform" | "call" | "exec" | "execute")));
        if called {
            if let Some(found) = Names::resolve(&names.routines, &chain, home) {
                uses.calls.insert(found);
            }
        } else if let Some(found) = Names::resolve(&names.relations, &chain, home) {
            if writes {
                uses.reads.remove(&found);
                uses.writes.insert(found);
            } else if (from_list || previous == Some("from")) && !uses.writes.contains(&found) {
                uses.reads.insert(found);
            }
        }
        if writes || !from_list {
            from_list = false;
        }
        index = next;
        while from_list
            && word(index).is_some_and(|alias| !CLAUSE_END.contains(&alias) && alias != "join")
        {
            index += 1;
        }
    }
    uses
}

pub(super) fn source_key(kind: Kind, schema: &str, name: &str) -> String {
    format!("{}\u{1f}{schema}\u{1f}{name}", kind.code())
}

fn key_kind(code: &str) -> Kind {
    match code {
        "V" => Kind::View,
        "M" => Kind::Matview,
        "P" => Kind::Procedure,
        "Trg" => Kind::Trigger,
        _ => Kind::Function,
    }
}

pub(super) fn search_loaded(sources: &[(String, Arc<str>)], term: &str) -> Vec<Hit> {
    sources
        .iter()
        .filter_map(|(key, text)| {
            let mut parts = key.split('\u{1f}');
            let kind = key_kind(parts.next()?);
            let schema = parts.next()?.to_string();
            let name = parts.next()?.to_string();
            let (line, snippet, occurrences) = snippet(text, term)?;
            Some(Hit {
                schema,
                name,
                kind,
                line,
                snippet,
                occurrences,
            })
        })
        .collect()
}

impl Server {
    pub(super) async fn objects(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        catalog: &Catalog,
    ) -> Option<Arc<Objects>> {
        if !super::server::SQL_KINDS.contains(&connection.kind) {
            return None;
        }
        if let Some(objects) = catalog.objects().filter(|objects| objects.fresh()) {
            return Some(objects);
        }
        let tables = catalog.tables();
        let schemas: Vec<String> = tables
            .schemas
            .iter()
            .map(|name| name.original.clone())
            .filter(|schema| allowed(schema, connection.allowed_schemas()))
            .collect();
        let adapter = adapter(connection, &self.pool).ok()?;
        let loaded = run(config, connection.kind, async {
            Ok(load(
                adapter.as_ref(),
                connection.kind,
                &schemas,
                connection.allowed_schemas(),
            )
            .await)
        })
        .await;
        let mut objects = loaded.unwrap_or_else(|_| Objects {
            taken: now(),
            ..Objects::default()
        });
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        for relation in &mut objects.relations {
            if let Some(comment) = &mut relation.comment {
                *comment = redactor.redact_text(comment);
            }
        }
        let useful = !objects.relations.is_empty() || !objects.routines.is_empty();
        Some(catalog.set_objects(objects, useful))
    }

    pub(super) async fn keys(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        catalog: &Catalog,
    ) -> Option<Arc<Keys>> {
        if let Some(keys) = catalog.keys().filter(|keys| fresh(keys.taken, keys.ms)) {
            return Some(keys);
        }
        let sql = bulk_query(connection.kind)?;
        let adapter = adapter(connection, &self.pool).ok()?;
        let started = Instant::now();
        count();
        let result = run(config, connection.kind, async {
            adapter.execute_query(sql).await
        })
        .await
        .ok()?;
        Some(catalog.set_keys(Keys {
            taken: now(),
            ms: started.elapsed().as_millis() as u64,
            edges: edges_from(keys_from(&result)),
        }))
    }

    pub(super) async fn list_schemas(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        catalog: &Catalog,
    ) {
        if connection.allowed_schemas().is_empty() || catalog.listed().is_some() {
            return;
        }
        let listed = match adapter(connection, &self.pool) {
            Ok(adapter) => {
                count();
                run(config, connection.kind, async {
                    adapter.list_schemas().await
                })
                .await
                .ok()
            }
            Err(_) => None,
        };
        catalog.set_listed(listed.filter(|schemas| !schemas.is_empty()));
    }

    pub(super) async fn discover(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
    ) -> Result<(Arc<Catalog>, Option<Arc<Objects>>, Notes), String> {
        let catalog = self.catalog(config, connection).await?;
        let objects = self.objects(config, connection, &catalog).await;
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let notes = Notes::new(crate::ai::knowledge::load(&connection.id), &redactor);
        Ok((catalog, objects, notes))
    }

    pub(super) async fn source_search(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        view: &View<'_>,
        args: &Value,
    ) -> Result<String, String> {
        let terms = arg_str(args, "term")
            .split('|')
            .map(safe_term)
            .collect::<Result<Vec<_>, _>>()?;
        if terms.len() > MAX_TERMS {
            return Err(format!(
                "in=source nimmt höchstens {MAX_TERMS} Alternativen (a|b)."
            ));
        }
        let term = terms.join("|");
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let (loaded, complete) = view.catalog.sources();
        let schemas: Vec<String> = view
            .catalog
            .tables()
            .schemas
            .iter()
            .map(|name| name.original.clone())
            .filter(|schema| allowed(schema, view.allowed))
            .collect();
        let mut hits: Vec<Hit> = Vec::new();
        let mut note = None;
        for term in &terms {
            let remote = match (complete, adapter(connection, &self.pool)) {
                (false, Ok(adapter)) => run(config, connection.kind, async {
                    Ok(search_source(
                        adapter.as_ref(),
                        connection.kind,
                        term,
                        &schemas,
                        view.allowed,
                    )
                    .await)
                })
                .await
                .ok()
                .flatten(),
                _ => None,
            };
            match remote {
                Some(Ok(found)) => hits.extend(found),
                Some(Err(_)) => {
                    hits.extend(search_loaded(&loaded, term));
                    note = Some("database-side source search failed; searched only definitions loaded by describe");
                }
                None if complete => hits.extend(search_loaded(&loaded, term)),
                None => {
                    hits.extend(search_loaded(&loaded, term));
                    note = Some("source search is not supported for this database; searched only definitions loaded by describe");
                }
            }
        }
        hits.sort_by(|a, b| {
            (&a.schema, &a.name, a.kind.code(), a.line).cmp(&(
                &b.schema,
                &b.name,
                b.kind.code(),
                b.line,
            ))
        });
        hits.dedup_by(|later, first| {
            let same = later.schema == first.schema
                && later.name == first.name
                && later.kind == first.kind;
            if same {
                first.occurrences += later.occurrences;
            }
            same
        });
        Ok(super::discovery::source_hits(
            view,
            &redactor,
            hits,
            &term,
            args,
            config.max_chars,
            note,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseKind;

    fn names() -> Names {
        let entry = |schema: &str, name: &str| (schema.to_string(), name.to_string());
        Names {
            relations: HashMap::from([
                (
                    "orders".into(),
                    vec![entry("sales", "orders"), entry("archive", "orders")],
                ),
                ("customers".into(), vec![entry("crm", "customers")]),
                ("order_log".into(), vec![entry("sales", "order_log")]),
                ("items".into(), vec![entry("sales", "items")]),
            ]),
            routines: HashMap::from([("calc_tax".into(), vec![entry("sales", "calc_tax")])]),
        }
    }

    #[test]
    fn lexical_dependencies_split_reads_writes_and_calls() {
        let source = "CREATE FUNCTION sales.post(p bigint) RETURNS void AS $body$\n\
            BEGIN\n\
              INSERT INTO order_log (id) SELECT o.id FROM orders o, items i JOIN crm.customers c ON c.id = o.customer_id WHERE o.id = p;\n\
              UPDATE archive.orders SET total = calc_tax(total) WHERE id = p;\n\
              -- DELETE FROM items\n\
              PERFORM 'select * from customers';\n\
            END $body$ LANGUAGE plpgsql";
        let uses = lexical(source, &names(), "sales");
        assert_eq!(
            uses.reads.iter().collect::<Vec<_>>(),
            ["crm.customers", "sales.items", "sales.orders"]
        );
        assert_eq!(
            uses.writes.iter().collect::<Vec<_>>(),
            ["archive.orders", "sales.order_log"]
        );
        assert_eq!(uses.calls.iter().collect::<Vec<_>>(), ["sales.calc_tax"]);
    }

    fn call(server: &mut Server, config: &McpConfig, name: &str, args: Value) -> (bool, String) {
        let reply = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(server.call_with_config(
                &serde_json::json!({"name": name, "arguments": args}),
                config,
            ));
        (
            reply["isError"].as_bool().unwrap(),
            reply["content"][0]["text"].as_str().unwrap().to_string(),
        )
    }

    fn calls() -> usize {
        CALLS.with(|calls| calls.get())
    }

    #[test]
    fn sqlite_objects_load_in_few_queries_and_describe_views_and_triggers() {
        let (_dir, config, _connection, mut server) = super::super::sandbox::sqlite_fixture(
            "CREATE TABLE orders(id INTEGER PRIMARY KEY, status TEXT, total REAL);
             CREATE TABLE audit_log(order_id INTEGER);
             CREATE VIEW open_orders AS
               SELECT id, total
               FROM orders
               WHERE status = 'open';
             CREATE TRIGGER orders_audit AFTER INSERT ON orders BEGIN
               INSERT INTO audit_log(order_id) VALUES (new.id);
             END;
             INSERT INTO orders VALUES (1, 'open', 9.5);",
        );
        let before = calls();
        let (error, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"term": "open"}),
        );
        assert!(!error && text.contains("V main.open_orders"), "{text}");
        assert!(text.contains(" · catalog "), "{text}");
        let first = calls() - before;
        assert!(first <= 3, "catalog build used {first} queries");
        let (error, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"kind": "Trg"}),
        );
        assert!(
            !error && text.contains("Trg main.orders_audit on main.orders"),
            "{text}"
        );
        let (_, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"term": "orders", "kind": "T"}),
        );
        assert!(
            text.contains("T main.orders") && !text.contains("open_orders"),
            "{text}"
        );
        assert_eq!(
            calls() - before,
            first,
            "repeated searches must not query the database"
        );
        let (error, text) = call(
            &mut server,
            &config,
            "describe",
            serde_json::json!({"tables": ["open_orders", "orders_audit"]}),
        );
        assert!(!error, "{text}");
        assert!(text.contains("V main.open_orders (view)"), "{text}");
        assert!(text.contains("reads (from source): main.orders"), "{text}");
        assert!(
            text.contains("source lines 1-4 of 4:\n1 CREATE VIEW open_orders AS\n2 "),
            "{text}"
        );
        assert!(
            text.contains("Trg main.orders_audit on main.orders"),
            "{text}"
        );
        assert!(
            text.contains("writes (from source): main.audit_log"),
            "{text}"
        );
        let (error, text) = call(
            &mut server,
            &config,
            "describe",
            serde_json::json!({"table": "open_orders", "lines": "3-3"}),
        );
        assert!(
            !error
                && text.contains("source lines 3-3 of 4")
                && text.contains("next: lines=\"4-4\""),
            "{text}"
        );
        assert!(!text.contains("SELECT id"), "{text}");
        let (error, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"term": "audit_log", "in": "source"}),
        );
        assert!(
            !error && text.contains("Trg main.orders_audit line 2: INSERT INTO audit_log"),
            "{text}"
        );
        let (error, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"term": "x'; DROP TABLE orders; --", "in": "source"}),
        );
        assert!(error && text.contains("in=source"), "{text}");
        let (error, text) = call(&mut server, &config, "overview", serde_json::json!({}));
        assert!(
            !error
                && text.contains("2 tables in 1 schemas")
                && text.contains("1 views, 1 triggers"),
            "{text}"
        );
    }

    #[test]
    fn duckdb_views_carry_estimates_comments_and_sources() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shop.duckdb");
        {
            let db = duckdb::Connection::open(&path).unwrap();
            db.execute_batch(
                "CREATE TABLE orders(id INTEGER PRIMARY KEY, status VARCHAR, total DOUBLE);
                 COMMENT ON TABLE orders IS 'Bestellungen';
                 INSERT INTO orders SELECT i, 'open', i FROM range(1000) t(i);
                 CREATE VIEW big_orders AS SELECT id FROM orders WHERE total > 500;",
            )
            .unwrap();
        }
        let connection = McpConnection {
            id: "duck".into(),
            name: "duck".into(),
            kind: DatabaseKind::Duckdb,
            connection_string: path.to_string_lossy().into(),
            schemas: Vec::new(),
            ssh: false,
            exposed: true,
            read_only: false,
            allow_ddl: false,
            allow_scripts: false,
            redact_columns: Vec::new(),
            mask_rules: Vec::new(),
            environment: None,
            allow_production_writes: false,
            database: None,
        };
        let config = McpConfig {
            enabled: true,
            connections: vec![connection],
            ..McpConfig::default()
        };
        let mut server = Server {
            pool: crate::db::pool::create_pool_state(),
            columns: Default::default(),
        };
        let (error, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"term": "orders"}),
        );
        assert!(!error, "{text}");
        assert!(
            text.contains("T main.orders ≈1000 rows") && text.contains("— Bestellungen"),
            "{text}"
        );
        assert!(text.contains("V main.big_orders"), "{text}");
        let (error, text) = call(
            &mut server,
            &config,
            "describe",
            serde_json::json!({"table": "big_orders"}),
        );
        assert!(
            !error && text.contains("reads (from source): main.orders"),
            "{text}"
        );
        let (error, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"term": "total", "in": "source"}),
        );
        assert!(
            !error && text.contains("V main.big_orders line 1"),
            "{text}"
        );
    }

    #[test]
    #[ignore]
    fn live_postgres_catalog_stages_use_bulk_queries_and_respect_the_allowlist() {
        let url = std::env::var("L8DB_E2E_PG_URL")
            .unwrap_or_else(|_| "postgres://postgres:testpw@127.0.0.1:5433/testdb".into());
        let schema = format!("l8db_mcp_{}", std::process::id());
        let hidden = format!("{schema}_hidden");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let admin = crate::db::create_adapter_from_string(
            DatabaseKind::Postgres,
            &url,
            None,
            crate::db::pool::create_pool_state(),
        )
        .unwrap();
        let setup = [
            format!("DROP SCHEMA IF EXISTS {schema} CASCADE"),
            format!("DROP SCHEMA IF EXISTS {hidden} CASCADE"),
            format!("CREATE SCHEMA {schema}"),
            format!("CREATE SCHEMA {hidden}"),
            format!("CREATE TABLE {hidden}.secret_table(x int)"),
            format!("CREATE FUNCTION {hidden}.secret_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'"),
            format!("CREATE TYPE {hidden}.secret_type AS (x int)"),
            format!("CREATE FUNCTION {hidden}.secret_audit() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN RETURN NEW; END $body$"),
            format!("CREATE TABLE {schema}.customers(id bigint PRIMARY KEY, email text NOT NULL)"),
            format!("COMMENT ON TABLE {schema}.customers IS 'Kundenstamm'"),
            format!("CREATE TABLE {schema}.orders(id bigint PRIMARY KEY, customer_id bigint REFERENCES {schema}.customers(id), total numeric, status text)"),
            format!("CREATE TABLE {schema}.order_log(order_id bigint, at timestamptz DEFAULT now())"),
            format!("CREATE TABLE {schema}.events(id bigint, at date) PARTITION BY RANGE (at)"),
            format!("CREATE TABLE {schema}.events_2026 PARTITION OF {schema}.events FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')"),
            format!("CREATE VIEW {schema}.open_orders AS SELECT o.id, c.email FROM {schema}.orders o JOIN {schema}.customers c ON c.id = o.customer_id WHERE o.status = 'open'"),
            format!("CREATE VIEW {schema}.leaky AS SELECT x FROM {hidden}.secret_table"),
            format!("CREATE MATERIALIZED VIEW {schema}.order_totals AS SELECT customer_id, sum(total) AS total FROM {schema}.orders GROUP BY 1"),
            format!("CREATE FUNCTION {schema}.order_total(p_id bigint) RETURNS numeric LANGUAGE sql AS $$ SELECT total FROM {schema}.orders WHERE id = p_id $$"),
            format!("CREATE PROCEDURE {schema}.log_order(p_id bigint) LANGUAGE plpgsql AS $body$\nBEGIN\n  INSERT INTO {schema}.order_log(order_id) VALUES (p_id);\n  PERFORM {schema}.order_total(p_id);\nEND $body$"),
            format!("CREATE FUNCTION {schema}.audit_order() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN INSERT INTO {schema}.order_log(order_id) VALUES (NEW.id); RETURN NEW; END $body$"),
            format!("CREATE TRIGGER orders_audit AFTER INSERT ON {schema}.orders FOR EACH ROW EXECUTE FUNCTION {schema}.audit_order()"),
            format!("CREATE TRIGGER customers_audit AFTER INSERT ON {schema}.customers FOR EACH ROW EXECUTE FUNCTION {hidden}.secret_audit()"),
            format!("CREATE FUNCTION {schema}.unpack(p {hidden}.secret_type) RETURNS int LANGUAGE sql AS 'SELECT 1'"),
            format!("INSERT INTO {schema}.customers VALUES (1, 'a@x'), (2, 'b@x')"),
            format!("INSERT INTO {schema}.orders VALUES (1, 1, 10, 'open'), (2, 2, 5, 'paid')"),
            format!("ANALYZE {schema}.customers"),
            format!("ANALYZE {schema}.orders"),
        ];
        for sql in &setup {
            runtime
                .block_on(admin.execute_query(sql))
                .unwrap_or_else(|e| panic!("{sql}: {e}"));
        }
        let connection = McpConnection {
            id: "live-pg".into(),
            name: "pg".into(),
            kind: DatabaseKind::Postgres,
            connection_string: url.clone(),
            schemas: vec![schema.clone()],
            ssh: false,
            exposed: true,
            read_only: true,
            allow_ddl: false,
            allow_scripts: false,
            redact_columns: Vec::new(),
            mask_rules: Vec::new(),
            environment: None,
            allow_production_writes: false,
            database: None,
        };
        let config = McpConfig {
            enabled: true,
            connections: vec![connection],
            ..McpConfig::default()
        };
        let mut server = Server {
            pool: crate::db::pool::create_pool_state(),
            columns: Default::default(),
        };
        let before = calls();
        let (error, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"term": "order"}),
        );
        assert!(!error, "{text}");
        let built = calls() - before;
        println!("search order ({built} queries):\n{text}");
        assert!(built <= 4, "catalog build used {built} queries");
        for expected in [
            format!("T {schema}.orders ≈2 rows"),
            format!("V {schema}.open_orders"),
            format!("M {schema}.order_totals"),
            format!("F {schema}.order_total(p_id bigint) → numeric"),
            format!("P {schema}.log_order(IN p_id bigint)"),
        ] {
            assert!(text.contains(&expected), "{expected}: {text}");
        }
        assert!(!text.contains("hidden"), "{text}");
        let (_, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"term": "secret"}),
        );
        assert!(text.starts_with("No tables"), "{text}");
        let (_, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"kind": "Trg"}),
        );
        assert!(
            text.contains(&format!(
                "Trg {schema}.orders_audit on {schema}.orders → {schema}.audit_order"
            )),
            "{text}"
        );
        assert!(
            text.contains(&format!(
                "Trg {schema}.customers_audit on {schema}.customers → [hidden]"
            )),
            "{text}"
        );
        let (_, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"term": "unpack"}),
        );
        assert!(
            text.contains(&format!("F {schema}.unpack(p [hidden]) → integer"))
                && !text.contains("secret"),
            "{text}"
        );
        let (_, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"term": "customers"}),
        );
        assert!(text.contains("— Kundenstamm"), "{text}");
        assert_eq!(
            calls() - before,
            built,
            "repeated searches must not query the database"
        );
        let before = calls();
        let (error, text) = call(&mut server, &config, "overview", serde_json::json!({}));
        println!("overview ({} queries):\n{text}", calls() - before);
        assert!(
            !error && text.contains("3 functions, 1 procedures, 2 triggers"),
            "{text}"
        );
        assert!(calls() - before <= 1);
        let (error, text) = call(
            &mut server,
            &config,
            "describe",
            serde_json::json!({"tables": [format!("{schema}.log_order"), format!("{schema}.open_orders"), format!("{schema}.orders"), format!("{schema}.leaky")]}),
        );
        println!("describe:\n{text}");
        assert!(!error, "{text}");
        for expected in [
            format!("writes (from source): {schema}.order_log"),
            format!("calls (from source): {schema}.order_total"),
            format!("uses (reported by the database): {schema}.customers, {schema}.orders"),
            format!(" customer_id bigint? → {schema}.customers.id"),
            " id bigint PK".to_string(),
            "[line references a hidden schema]".to_string(),
        ] {
            assert!(text.contains(&expected), "{expected}: {text}");
        }
        assert!(!text.contains(&format!("{hidden}.")), "{text}");
        let key = super::super::server::cache_key(&config.connections[0]);
        let live = server.columns.get(&key).unwrap().clone();
        let visible: Vec<_> = live
            .columns
            .iter()
            .filter(|column| column.schema == schema)
            .cloned()
            .collect();
        let restored = Catalog::restored(
            visible,
            live.taken,
            live.ms,
            super::super::persist::key(&config, &config.connections[0]),
        );
        let objects = live.objects().unwrap();
        restored.set_objects(
            Objects {
                taken: objects.taken,
                ms: objects.ms,
                relations: objects.relations.clone(),
                routines: objects.routines.clone(),
                triggers: objects.triggers.clone(),
                ..Objects::default()
            },
            false,
        );
        let mut cold = Server {
            pool: crate::db::pool::create_pool_state(),
            columns: Default::default(),
        };
        cold.columns.insert(key, Arc::new(restored));
        let (error, text) = call(
            &mut cold,
            &config,
            "describe",
            serde_json::json!({"tables": [format!("{schema}.leaky")]}),
        );
        assert!(
            !error
                && text.contains("[line references a hidden schema]")
                && !text.contains(&format!("{hidden}.")),
            "{text}"
        );
        let (error, text) = call(
            &mut server,
            &config,
            "search",
            serde_json::json!({"term": "order_log", "in": "source"}),
        );
        println!("source search:\n{text}");
        assert!(
            !error
                && text.contains(&format!("P {schema}.log_order(IN p_id bigint)"))
                && text.contains("INSERT INTO"),
            "{text}"
        );
        for sql in [
            format!("DROP SCHEMA {schema} CASCADE"),
            format!("DROP SCHEMA {hidden} CASCADE"),
        ] {
            runtime.block_on(admin.execute_query(&sql)).unwrap();
        }
    }

    #[test]
    fn source_terms_are_whitelisted_and_snippets_report_lines() {
        assert!(safe_term("INSERT INTO sales.orders").is_ok());
        for bad in ["x'; DROP TABLE t; --", "a%b", "a\\b", "", "[x]"] {
            assert!(safe_term(bad).is_err(), "{bad}");
        }
        let (line, text, count) = snippet("a\n  insert into ORDERS x\norders", "orders").unwrap();
        assert_eq!((line, text.as_str(), count), (2, "insert into ORDERS x", 2));
        assert!(literal("o'brien").unwrap() == "'o''brien'" && literal("a\\b").is_none());
    }
}
