use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use super::config::{McpConfig, McpConnection};
use super::redact::{self, Redactor};
use super::server::{
    adapter, arg_str, cache_key, cap, check_read_sql, check_write_sql, qualified, run, Server,
};
use crate::db::{self, DatabaseKind, ForeignKeyInfo, QueryResult};

const GRAPH_TTL: Duration = Duration::from_secs(120);
const GRAPH_TABLE_LIMIT: usize = 1_500;
const MAX_DESCRIBE: usize = 10;
const MAX_HOPS: usize = 6;
const LARGE_SCAN_ROWS: f64 = 100_000.0;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Edge {
    pub from: (String, String),
    pub to: (String, String),
    pub pairs: Vec<(String, String)>,
}

#[derive(Default, Debug)]
pub(super) struct Graph {
    pub nodes: Vec<(String, String)>,
    pub edges: Vec<Edge>,
    pub unread: usize,
}

static GRAPHS: LazyLock<Mutex<HashMap<String, (Instant, Arc<Graph>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn graph_key(connection: &McpConnection) -> String {
    format!(
        "{}|{}",
        cache_key(connection),
        connection.allowed_schemas().join("\u{1f}")
    )
}

pub(super) fn forget(connection: &McpConnection) {
    let prefix = format!("{}|", cache_key(connection));
    if let Ok(mut graphs) = GRAPHS.lock() {
        graphs.retain(|key, _| !key.starts_with(&prefix));
    }
}

fn cached(connection: &McpConnection) -> Option<Arc<Graph>> {
    let graphs = GRAPHS.lock().ok()?;
    let (at, graph) = graphs.get(&graph_key(connection))?;
    (at.elapsed() < GRAPH_TTL).then(|| graph.clone())
}

fn visible_schema(connection: &McpConnection, schema: &str) -> bool {
    let allowed = connection.allowed_schemas();
    allowed.is_empty() || allowed.iter().any(|entry| entry == schema)
}

pub(super) fn top_level_where(sql: &str) -> bool {
    let mut depth = 0i32;
    let mut quoted = false;
    let mut word = String::new();
    for character in sql.chars().chain(std::iter::once(' ')) {
        if quoted {
            quoted = character != '\'';
            continue;
        }
        if character.is_alphanumeric() || character == '_' {
            word.push(character.to_ascii_lowercase());
            continue;
        }
        if depth == 0 && word == "where" {
            return true;
        }
        word.clear();
        match character {
            '\'' => quoted = true,
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
    }
    false
}

const NO_DRY_RUN: &[&str] = &[
    "call",
    "exec",
    "execute",
    "begin",
    "do",
    "declare",
    "copy",
    "export",
    "import",
    "attach",
    "detach",
    "install",
    "load",
    "pragma",
    "checkpoint",
    "vacuum",
    "analyze",
    "reindex",
    "cluster",
    "set",
    "reset",
    "grant",
    "revoke",
    "notify",
    "listen",
    "lock",
    "refresh",
    "comment",
];

pub(crate) fn dry_run_statement(words: &[String]) -> bool {
    !words
        .first()
        .is_some_and(|word| NO_DRY_RUN.contains(&word.as_str()))
        && !words.iter().any(|word| {
            matches!(
                word.as_str(),
                "concurrently"
                    | "database"
                    | "tablespace"
                    | "subscription"
                    | "publication"
                    | "nextval"
            )
        })
}

fn not_transactional(error: &str) -> bool {
    let error = error.to_lowercase();
    error.contains("transaction block")
        || error.contains("inside a transaction")
        || error.contains("within a transaction")
        || error.contains("multi-statement transaction")
}

pub fn explain_definition() -> Value {
    json!({
        "name": "explain",
        "description": "Compact execution plan with warnings for full scans and bad estimates; PostgreSQL adds index suggestions. Use before heavy queries; analyze=true times read-only statements.",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": super::server::database_arg(),
            "sql": {"type": "string"},
            "analyze": {"type": "boolean"}
        }, "required": ["connection", "sql"]}
    })
}

pub fn relations_definition() -> Value {
    json!({
        "name": "relations",
        "description": "JOIN conditions along foreign keys: from and to gives the shortest path, only from lists referenced and referencing tables.",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": super::server::database_arg(),
            "from": {"type": "string"},
            "to": {"type": "string"}
        }, "required": ["connection", "from"]}
    })
}

fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
}

fn rows(value: f64) -> String {
    match value {
        v if v >= 1e9 => format!("{:.1}B", v / 1e9),
        v if v >= 1e6 => format!("{:.1}M", v / 1e6),
        v if v >= 1e4 => format!("{:.0}k", v / 1e3),
        v => format!("{v:.0}"),
    }
}

fn flat(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > max {
        format!("{}…", flat.chars().take(max).collect::<String>())
    } else {
        flat
    }
}

fn pg_node(node: &Value, depth: usize, lines: &mut Vec<String>, warnings: &mut Vec<String>) {
    if depth > 40 || lines.len() > 400 {
        return;
    }
    let kind = node["Node Type"].as_str().unwrap_or("?");
    let mut line = format!("{}- {kind}", "  ".repeat(depth));
    if let Some(join) = node["Join Type"].as_str() {
        line.push_str(&format!(" ({join})"));
    }
    let relation = node["Relation Name"].as_str().map(|name| {
        node["Schema"]
            .as_str()
            .map(|schema| format!("{schema}.{name}"))
            .unwrap_or_else(|| name.to_string())
    });
    if let Some(relation) = &relation {
        line.push_str(&format!(" on {relation}"));
        if let Some(alias) = node["Alias"]
            .as_str()
            .filter(|alias| !relation.ends_with(alias))
        {
            line.push_str(&format!(" {alias}"));
        }
    }
    if let Some(index) = node["Index Name"].as_str() {
        line.push_str(&format!(" using {index}"));
    }
    let estimate = number(&node["Plan Rows"]);
    if let Some(estimate) = estimate {
        line.push_str(&format!(" rows≈{}", rows(estimate)));
    }
    if let Some(cost) = number(&node["Total Cost"]) {
        line.push_str(&format!(" cost={}", rows(cost)));
    }
    let actual = number(&node["Actual Rows"])
        .map(|actual| actual * number(&node["Actual Loops"]).unwrap_or(1.0).max(1.0));
    if let Some(actual) = actual {
        line.push_str(&format!(" actual={}", rows(actual)));
        if let Some(time) = number(&node["Actual Total Time"]) {
            line.push_str(&format!(" {time:.1}ms"));
        }
    }
    for key in [
        "Index Cond",
        "Hash Cond",
        "Merge Cond",
        "Join Filter",
        "Filter",
        "Recheck Cond",
    ] {
        if let Some(condition) = node[key].as_str() {
            line.push_str(&format!(
                " | {}: {}",
                key.to_lowercase(),
                flat(condition, 160)
            ));
        }
    }
    if let Some(removed) = number(&node["Rows Removed by Filter"]) {
        line.push_str(&format!(" removed={}", rows(removed)));
    }
    for key in ["Sort Key", "Group Key"] {
        if let Some(keys) = node[key].as_array() {
            let keys: Vec<&str> = keys.iter().filter_map(Value::as_str).collect();
            line.push_str(&format!(
                " | {}: {}",
                key.to_lowercase(),
                flat(&keys.join(", "), 120)
            ));
        }
    }
    if node["Sort Space Type"].as_str() == Some("Disk") {
        warnings.push(format!(
            "{kind} spills to disk; raise work_mem or sort fewer rows"
        ));
    }
    lines.push(line);
    let table_rows =
        estimate.unwrap_or(0.0) + number(&node["Rows Removed by Filter"]).unwrap_or(0.0);
    if kind == "Seq Scan" && table_rows >= LARGE_SCAN_ROWS {
        if let Some(relation) = &relation {
            warnings.push(format!(
                "full scan of {relation} (≈{} rows){}",
                rows(table_rows),
                if node["Filter"].is_string() {
                    "; an index on the filter columns may help"
                } else {
                    ""
                }
            ));
        }
    }
    if let (Some(estimate), Some(actual)) = (estimate, actual) {
        let (low, high) = (estimate.min(actual).max(1.0), estimate.max(actual));
        if high / low >= 10.0 && high >= 1_000.0 {
            warnings.push(format!(
                "{kind}{} estimated {} rows but got {}; run ANALYZE on the table",
                relation
                    .map(|name| format!(" on {name}"))
                    .unwrap_or_default(),
                rows(estimate),
                rows(actual)
            ));
        }
    }
    for child in node["Plans"].as_array().into_iter().flatten() {
        pg_node(child, depth + 1, lines, warnings);
    }
}

fn mysql_tables(value: &Value, lines: &mut Vec<String>, warnings: &mut Vec<String>) {
    if lines.len() > 400 {
        return;
    }
    match value {
        Value::Object(map) => {
            if let Some(table) = map.get("table_name").and_then(Value::as_str) {
                let access = map
                    .get("access_type")
                    .and_then(Value::as_str)
                    .unwrap_or("?");
                let mut line = format!("- {access} on {table}");
                if let Some(key) = map.get("key").and_then(Value::as_str) {
                    line.push_str(&format!(" using {key}"));
                }
                let examined = map.get("rows_examined_per_scan").and_then(number);
                if let Some(examined) = examined {
                    line.push_str(&format!(" rows≈{}", rows(examined)));
                }
                if let Some(condition) = map.get("attached_condition").and_then(Value::as_str) {
                    line.push_str(&format!(" | filter: {}", flat(condition, 160)));
                }
                if access == "ALL" && examined.unwrap_or(0.0) >= LARGE_SCAN_ROWS {
                    warnings.push(format!(
                        "full scan of {table} (≈{} rows)",
                        rows(examined.unwrap_or(0.0))
                    ));
                }
                lines.push(line);
            }
            for (key, child) in map {
                if key != "table" || !child.is_object() || map.get("table_name").is_none() {
                    mysql_tables(child, lines, warnings);
                }
            }
        }
        Value::Array(list) => list
            .iter()
            .for_each(|child| mysql_tables(child, lines, warnings)),
        _ => {}
    }
}

fn sqlite_rows(list: &[Value], lines: &mut Vec<String>, warnings: &mut Vec<String>) -> bool {
    let mut depth: HashMap<i64, usize> = HashMap::new();
    let mut any = false;
    for row in list.iter().take(400) {
        let Some(detail) = row["detail"].as_str() else {
            continue;
        };
        any = true;
        let id = row["id"].as_i64().unwrap_or(0);
        let parent = row["parent"].as_i64().unwrap_or(0);
        let level = depth.get(&parent).map(|level| level + 1).unwrap_or(0);
        depth.insert(id, level);
        if detail.starts_with("SCAN ") && !detail.contains("USING") {
            warnings.push(format!("{detail} reads every row"));
        }
        lines.push(format!("{}- {detail}", "  ".repeat(level)));
    }
    any
}

pub(super) fn compact_plan(plan: &Value, max_chars: usize) -> String {
    let mut lines = Vec::new();
    let mut warnings = Vec::new();
    let mut footer = Vec::new();
    let root = match plan {
        Value::Array(list) => list.first().cloned().unwrap_or(Value::Null),
        other => other.clone(),
    };
    if root.get("Plan").is_some() {
        pg_node(&root["Plan"], 0, &mut lines, &mut warnings);
        for key in ["Planning Time", "Execution Time"] {
            if let Some(time) = number(&root[key]) {
                footer.push(format!("{}: {time:.1}ms", key.to_lowercase()));
            }
        }
    } else if let Some(list) = plan.as_array().filter(|list| !list.is_empty()) {
        if !sqlite_rows(list, &mut lines, &mut warnings) {
            mysql_tables(plan, &mut lines, &mut warnings);
        }
    } else if plan.is_object() {
        mysql_tables(plan, &mut lines, &mut warnings);
    }
    if lines.is_empty() {
        let text = match plan {
            Value::String(text) => text.clone(),
            other => serde_json::to_string(other).unwrap_or_default(),
        };
        return cap(text, max_chars);
    }
    warnings.dedup();
    let mut text = lines.join("\n");
    if !footer.is_empty() {
        text.push_str(&format!("\n{}", footer.join(", ")));
    }
    if !warnings.is_empty() {
        text.push_str("\nwarnings:");
        for warning in warnings.iter().take(12) {
            text.push_str(&format!("\n- {warning}"));
        }
    }
    cap(text, max_chars)
}

fn resolve<'a>(
    nodes: &'a [(String, String)],
    wanted: &str,
) -> Result<&'a (String, String), String> {
    let wanted = wanted.trim().trim_matches('"');
    if wanted.is_empty() {
        return Err("Tabelle fehlt".into());
    }
    let exact: Vec<_> = nodes
        .iter()
        .filter(|node| qualified(&node.0, &node.1) == wanted || node.1 == wanted)
        .collect();
    let matches: Vec<_> = if exact.is_empty() {
        nodes
            .iter()
            .filter(|node| {
                qualified(&node.0, &node.1).eq_ignore_ascii_case(wanted)
                    || node.1.eq_ignore_ascii_case(wanted)
            })
            .collect()
    } else {
        exact
    };
    match matches.as_slice() {
        [] => Err(format!("Tabelle '{wanted}' nicht gefunden. search nutzen.")),
        [one] => Ok(one),
        many => Err(format!(
            "Tabelle '{wanted}' ist mehrdeutig: {}",
            many.iter()
                .take(10)
                .map(|node| qualified(&node.0, &node.1))
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

fn condition(edge: &Edge) -> String {
    let from = qualified(&edge.from.0, &edge.from.1);
    let to = qualified(&edge.to.0, &edge.to.1);
    edge.pairs
        .iter()
        .map(|(left, right)| format!("{from}.{left} = {to}.{right}"))
        .collect::<Vec<_>>()
        .join(" AND ")
}

pub(super) fn neighbours(graph: &Graph, table: &(String, String), max_chars: usize) -> String {
    let name = qualified(&table.0, &table.1);
    let outgoing: Vec<String> = graph
        .edges
        .iter()
        .filter(|edge| &edge.from == table)
        .map(|edge| {
            format!(
                "{} -> {}: {}",
                name,
                qualified(&edge.to.0, &edge.to.1),
                condition(edge)
            )
        })
        .collect();
    let incoming: Vec<String> = graph
        .edges
        .iter()
        .filter(|edge| &edge.to == table && &edge.from != table)
        .map(|edge| {
            format!(
                "{} -> {}: {}",
                qualified(&edge.from.0, &edge.from.1),
                name,
                condition(edge)
            )
        })
        .collect();
    if outgoing.is_empty() && incoming.is_empty() {
        return format!("{name} has no foreign keys and is not referenced.");
    }
    let mut text = String::new();
    if !outgoing.is_empty() {
        text.push_str(&format!("{name} references:\n{}", outgoing.join("\n")));
    }
    if !incoming.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        let shown = incoming.len().min(60);
        text.push_str(&format!("referenced by:\n{}", incoming[..shown].join("\n")));
        if incoming.len() > shown {
            text.push_str(&format!("\n[{} more]", incoming.len() - shown));
        }
    }
    cap(text, max_chars)
}

pub(super) fn join_path(
    graph: &Graph,
    from: &(String, String),
    to: &(String, String),
    max_chars: usize,
) -> String {
    let start = qualified(&from.0, &from.1);
    if from == to {
        return format!("{start} is the same table.");
    }
    let mut adjacency: HashMap<&(String, String), Vec<(usize, bool)>> = HashMap::new();
    for (index, edge) in graph.edges.iter().enumerate() {
        if edge.from == edge.to {
            continue;
        }
        adjacency.entry(&edge.from).or_default().push((index, true));
        adjacency.entry(&edge.to).or_default().push((index, false));
    }
    let mut previous: HashMap<&(String, String), (&(String, String), usize)> = HashMap::new();
    let mut depth: HashMap<&(String, String), usize> = HashMap::from([(from, 0)]);
    let mut queue = VecDeque::from([from]);
    while let Some(node) = queue.pop_front() {
        if node == to {
            break;
        }
        let level = depth[node];
        if level >= MAX_HOPS {
            continue;
        }
        let mut next: Vec<(usize, bool)> = adjacency.get(node).cloned().unwrap_or_default();
        next.sort_by_key(|(index, _)| *index);
        for (index, outgoing) in next {
            let edge = &graph.edges[index];
            let other = if outgoing { &edge.to } else { &edge.from };
            if depth.contains_key(other) {
                continue;
            }
            depth.insert(other, level + 1);
            previous.insert(other, (node, index));
            queue.push_back(other);
        }
    }
    let target = qualified(&to.0, &to.1);
    if !previous.contains_key(to) {
        return format!(
            "No foreign key path from {start} to {target} within {MAX_HOPS} hops. Join on matching columns only after checking them with describe."
        );
    }
    let mut hops = Vec::new();
    let mut node = to;
    while let Some((parent, index)) = previous.get(node) {
        hops.push((*parent, node, *index));
        node = parent;
    }
    hops.reverse();
    let mut lines = vec![format!("FROM {start}")];
    for (parent, node, index) in &hops {
        let edge = &graph.edges[*index];
        let alternatives: Vec<String> = graph
            .edges
            .iter()
            .filter(|other| {
                other != &edge
                    && ((&other.from == *parent && &other.to == *node)
                        || (&other.to == *parent && &other.from == *node))
            })
            .map(condition)
            .collect();
        let mut line = format!(
            "JOIN {} ON {}",
            qualified(&node.0, &node.1),
            condition(edge)
        );
        if !alternatives.is_empty() {
            line.push_str(&format!(
                "  -- other foreign keys between these tables: {}",
                alternatives.join(" | ")
            ));
        }
        lines.push(line);
    }
    lines.push(format!(
        "({} hops; each hop to a referencing table can multiply rows, aggregate before summing)",
        hops.len()
    ));
    cap(lines.join("\n"), max_chars)
}

pub(super) fn edges_from(keys: Vec<ForeignKeyInfo>) -> Vec<Edge> {
    let mut grouped: BTreeMap<(String, String, String, String, String), Edge> = BTreeMap::new();
    for key in keys {
        let id = (
            key.constraint_name.clone(),
            key.from_schema.clone(),
            key.from_table.clone(),
            key.to_schema.clone(),
            key.to_table.clone(),
        );
        let edge = grouped.entry(id).or_insert_with(|| Edge {
            from: (key.from_schema.clone(), key.from_table.clone()),
            to: (key.to_schema.clone(), key.to_table.clone()),
            pairs: Vec::new(),
        });
        let pair = (key.from_column, key.to_column);
        if !edge.pairs.contains(&pair) {
            edge.pairs.push(pair);
        }
    }
    grouped.into_values().collect()
}

fn text_cell(row: &Value, column: &str, index: usize) -> String {
    let value = match row {
        Value::Object(map) => map.get(column).cloned().unwrap_or(Value::Null),
        Value::Array(list) => list.get(index).cloned().unwrap_or(Value::Null),
        _ => Value::Null,
    };
    match value {
        Value::String(text) => text,
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn keys_from(result: &QueryResult) -> Vec<ForeignKeyInfo> {
    let column = |row: &Value, index: usize| {
        let name = result.columns.get(index).map(String::as_str).unwrap_or("");
        text_cell(row, name, index)
    };
    result
        .rows
        .iter()
        .map(|row| ForeignKeyInfo {
            constraint_name: column(row, 0),
            from_schema: column(row, 1),
            from_table: column(row, 2),
            from_column: column(row, 3),
            to_schema: column(row, 4),
            to_table: column(row, 5),
            to_column: column(row, 6),
        })
        .collect()
}

const POSTGRES_KEYS: &str =
    "SELECT con.conname, n1.nspname, c1.relname, a1.attname, n2.nspname, c2.relname, a2.attname \
FROM pg_constraint con \
JOIN pg_class c1 ON c1.oid = con.conrelid JOIN pg_namespace n1 ON n1.oid = c1.relnamespace \
JOIN pg_class c2 ON c2.oid = con.confrelid JOIN pg_namespace n2 ON n2.oid = c2.relnamespace \
CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(f, t, o) \
JOIN pg_attribute a1 ON a1.attrelid = con.conrelid AND a1.attnum = u.f \
JOIN pg_attribute a2 ON a2.attrelid = con.confrelid AND a2.attnum = u.t \
WHERE con.contype = 'f' ORDER BY 1, 2, 3, u.o LIMIT 50000";

const MYSQL_KEYS: &str = "SELECT CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME \
FROM information_schema.KEY_COLUMN_USAGE \
WHERE REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_SCHEMA NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema') \
ORDER BY CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION LIMIT 50000";

const MSSQL_KEYS: &str = "SELECT TOP 50000 fk.name, SCHEMA_NAME(t1.schema_id), t1.name, c1.name, SCHEMA_NAME(t2.schema_id), t2.name, c2.name \
FROM sys.foreign_key_columns fkc \
JOIN sys.foreign_keys fk ON fk.object_id = fkc.constraint_object_id \
JOIN sys.tables t1 ON t1.object_id = fkc.parent_object_id \
JOIN sys.columns c1 ON c1.object_id = fkc.parent_object_id AND c1.column_id = fkc.parent_column_id \
JOIN sys.tables t2 ON t2.object_id = fkc.referenced_object_id \
JOIN sys.columns c2 ON c2.object_id = fkc.referenced_object_id AND c2.column_id = fkc.referenced_column_id \
ORDER BY fk.name, fkc.constraint_column_id";

fn bulk_query(kind: DatabaseKind) -> Option<&'static str> {
    match kind {
        DatabaseKind::Postgres => Some(POSTGRES_KEYS),
        DatabaseKind::Mysql => Some(MYSQL_KEYS),
        DatabaseKind::Mssql => Some(MSSQL_KEYS),
        _ => None,
    }
}

pub(super) fn build_graph(nodes: Vec<(String, String)>, keys: Vec<ForeignKeyInfo>) -> Graph {
    let known: HashSet<&(String, String)> = nodes.iter().collect();
    let edges = edges_from(keys)
        .into_iter()
        .filter(|edge| known.contains(&edge.from) && known.contains(&edge.to))
        .collect();
    Graph {
        nodes,
        edges,
        unread: 0,
    }
}

fn estimate_query(kind: DatabaseKind, tables: &[(String, String)]) -> Option<String> {
    let literal = |text: &str| format!("'{}'", text.replace('\'', "''"));
    let pairs = tables
        .iter()
        .map(|(schema, table)| format!("({}, {})", literal(schema), literal(table)))
        .collect::<Vec<_>>()
        .join(", ");
    match kind {
        DatabaseKind::Postgres => Some(format!(
            "SELECT n.nspname, c.relname, c.reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE (n.nspname, c.relname) IN ({pairs})"
        )),
        DatabaseKind::Mysql => Some(format!(
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE (TABLE_SCHEMA, TABLE_NAME) IN ({pairs})"
        )),
        _ => None,
    }
}

pub struct DryRun {
    pub summary: String,
    pub failed: bool,
}

fn dry_run_supported(kind: DatabaseKind) -> bool {
    matches!(
        kind,
        DatabaseKind::Postgres | DatabaseKind::Sqlite | DatabaseKind::Duckdb | DatabaseKind::Mssql
    )
}

impl Server {
    async fn graph(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
    ) -> Result<Arc<Graph>, String> {
        if let Some(graph) = cached(connection) {
            return Ok(graph);
        }
        let catalog = self.catalog(config, connection).await?;
        let tables = catalog.tables();
        let nodes: Vec<(String, String)> = tables
            .list
            .iter()
            .filter(|table| tables.visible(table, connection.allowed_schemas()))
            .map(|table| {
                (
                    tables.schema(table).to_string(),
                    tables.name(table).to_string(),
                )
            })
            .collect();
        let adapter = adapter(connection, &self.pool)?;
        let mut unread = 0;
        let keys = match bulk_query(connection.kind) {
            Some(sql) => {
                let result = run(config, connection.kind, async {
                    adapter.execute_query(sql).await
                })
                .await?;
                keys_from(&result)
            }
            None => {
                if nodes.len() > GRAPH_TABLE_LIMIT {
                    return Err(format!(
                        "{} Tabellen: zu viele für eine Fremdschlüsselsuche bei diesem Datenbanktyp. describe für einzelne Tabellen nutzen.",
                        nodes.len()
                    ));
                }
                use futures_util::StreamExt;
                let adapter = adapter.as_ref();
                let lists: Vec<Result<Vec<ForeignKeyInfo>, String>> =
                    run(config, connection.kind, async {
                        Ok(futures_util::stream::iter(nodes.iter().cloned())
                            .map(|(schema, table)| async move {
                                adapter.list_foreign_keys(&schema, &table).await
                            })
                            .buffered(8)
                            .collect()
                            .await)
                    })
                    .await?;
                let mut keys = Vec::new();
                for list in lists {
                    match list {
                        Ok(list) => keys.extend(list),
                        Err(e) if e.contains("nicht unterstützt") => {
                            return Err(format!(
                                "Fremdschlüssel werden für '{}' nicht unterstützt.",
                                connection.name
                            ))
                        }
                        Err(_) => unread += 1,
                    }
                }
                keys
            }
        };
        let mut graph = build_graph(nodes, keys);
        graph.unread = unread;
        let graph = Arc::new(graph);
        if unread == 0 {
            if let Ok(mut graphs) = GRAPHS.lock() {
                graphs.retain(|_, (at, _)| at.elapsed() < GRAPH_TTL);
                graphs.insert(graph_key(connection), (Instant::now(), graph.clone()));
            }
        }
        Ok(graph)
    }

    pub(super) async fn relations(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        args: &Value,
    ) -> Result<String, String> {
        let graph = self.graph(config, connection).await?;
        let from = resolve(&graph.nodes, arg_str(args, "from"))?;
        let to = arg_str(args, "to").trim();
        let mut text = if to.is_empty() {
            neighbours(&graph, from, config.max_chars)
        } else {
            join_path(&graph, from, resolve(&graph.nodes, to)?, config.max_chars)
        };
        if graph.unread > 0 {
            text.push_str(&format!(
                "\n[foreign keys of {} tables could not be read; the result may be incomplete]",
                graph.unread
            ));
        }
        Ok(text)
    }

    pub(super) async fn explain(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        args: &Value,
    ) -> Result<String, String> {
        let sql = arg_str(args, "sql").trim().trim_end_matches(';').trim();
        if sql.is_empty() {
            return Err("sql fehlt".into());
        }
        if !super::server::SQL_KINDS.contains(&connection.kind) {
            return Err("explain unterstützt nur SQL-Datenbanken.".into());
        }
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let index = self.schema_index(config, connection, &redactor).await?;
        let analyze = args
            .get("analyze")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if let Err(read) = check_read_sql(sql, connection, &index) {
            if analyze || connection.writes_blocked() || redact::write_word(sql).is_none() {
                return Err(read);
            }
            check_write_sql(sql, connection, &index)?;
            if redact::is_ddl(sql) {
                return Err("explain zeigt keine Pläne für DDL.".into());
            }
        }
        let adapter = adapter(connection, &self.pool)?;
        let plan = run(config, connection.kind, async {
            adapter.explain_query(sql, analyze).await
        })
        .await?;
        let mut text = compact_plan(&plan, config.max_chars.saturating_sub(1_500).max(2_000));
        if connection.kind == DatabaseKind::Postgres {
            let advice = run(config, connection.kind, async {
                crate::index_advisor::advise(adapter.as_ref(), &plan).await
            })
            .await
            .unwrap_or_default();
            if !advice.is_empty() {
                text.push_str("\nindex suggestions (not created):");
                for item in advice.iter().take(5) {
                    text.push_str(&format!(
                        "\n- {} (filter keeps ≈{:.1}% of {} rows)",
                        item.sql,
                        item.selectivity * 100.0,
                        rows(item.estimated_table_rows as f64)
                    ));
                }
            }
        }
        Ok(cap(text, config.max_chars))
    }

    pub(super) async fn describe_tables(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        args: &Value,
    ) -> Result<String, String> {
        let mut names: Vec<String> = args["tables"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        let single = arg_str(args, "table").trim();
        if !single.is_empty() && !names.iter().any(|name| name == single) {
            names.insert(0, single.to_string());
        }
        if names.is_empty() {
            return Err("table fehlt".into());
        }
        if names.len() > MAX_DESCRIBE {
            return Err(format!("Höchstens {MAX_DESCRIBE} Tabellen pro describe."));
        }
        let catalog = self.catalog(config, connection).await?;
        let mut found = Vec::new();
        let mut sections = Vec::new();
        for name in &names {
            match super::discovery::describe(
                &catalog,
                connection.allowed_schemas(),
                name,
                config.max_chars,
            ) {
                Ok((line, table)) => {
                    sections.push(line);
                    found.push((sections.len() - 1, table));
                }
                Err(error) => sections.push(error),
            }
        }
        let detail = args.get("details").and_then(Value::as_bool).unwrap_or(true);
        if detail && super::server::SQL_KINDS.contains(&connection.kind) && !found.is_empty() {
            let adapter = adapter(connection, &self.pool)?;
            let adapter = adapter.as_ref();
            let tables: Vec<(String, String)> =
                found.iter().map(|(_, table)| table.clone()).collect();
            let estimates: HashMap<(String, String), f64> =
                match estimate_query(connection.kind, &tables) {
                    Some(sql) => run(config, connection.kind, async {
                        adapter.execute_query(&sql).await
                    })
                    .await
                    .map(|result| {
                        result
                            .rows
                            .iter()
                            .filter_map(|row| {
                                let count = number(&Value::String(text_cell(
                                    row,
                                    result.columns.get(2).map(String::as_str).unwrap_or(""),
                                    2,
                                )))?;
                                Some((
                                    (
                                        text_cell(
                                            row,
                                            result
                                                .columns
                                                .first()
                                                .map(String::as_str)
                                                .unwrap_or(""),
                                            0,
                                        ),
                                        text_cell(
                                            row,
                                            result.columns.get(1).map(String::as_str).unwrap_or(""),
                                            1,
                                        ),
                                    ),
                                    count,
                                ))
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                    None => HashMap::new(),
                };
            let graph = cached(connection);
            for (position, (schema, table)) in &found {
                let mut extra = Vec::new();
                let (keys, indexes) = run(config, connection.kind, async {
                    Ok(tokio::join!(
                        adapter.list_foreign_keys(schema, table),
                        adapter.list_indexes(schema, table)
                    ))
                })
                .await
                .unwrap_or((Err(String::new()), Err(String::new())));
                if let Ok(indexes) = &indexes {
                    if let Some(primary) = indexes.iter().find(|index| index.is_primary) {
                        extra.push(format!("  primary key: ({})", primary.columns.join(", ")));
                    }
                    let other: Vec<String> = indexes
                        .iter()
                        .filter(|index| !index.is_primary)
                        .take(20)
                        .map(|index| {
                            format!(
                                "{}{}({})",
                                if index.is_unique { "unique " } else { "" },
                                index.name,
                                index.columns.join(", ")
                            )
                        })
                        .collect();
                    if !other.is_empty() {
                        extra.push(format!("  indexes: {}", other.join("; ")));
                    }
                }
                let me = (schema.clone(), table.clone());
                if let Ok(keys) = keys {
                    let outgoing: Vec<String> = edges_from(keys)
                        .iter()
                        .filter(|edge| edge.from == me && visible_schema(connection, &edge.to.0))
                        .map(|edge| {
                            format!(
                                "({}) -> {}({})",
                                edge.pairs
                                    .iter()
                                    .map(|pair| pair.0.as_str())
                                    .collect::<Vec<_>>()
                                    .join(", "),
                                qualified(&edge.to.0, &edge.to.1),
                                edge.pairs
                                    .iter()
                                    .map(|pair| pair.1.as_str())
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            )
                        })
                        .collect();
                    if !outgoing.is_empty() {
                        extra.push(format!("  references: {}", outgoing.join("; ")));
                    }
                }
                if let Some(graph) = &graph {
                    let incoming: Vec<String> = graph
                        .edges
                        .iter()
                        .filter(|edge| edge.to == me && edge.from != me)
                        .take(20)
                        .map(|edge| qualified(&edge.from.0, &edge.from.1))
                        .collect();
                    if !incoming.is_empty() {
                        extra.push(format!("  referenced by: {}", incoming.join(", ")));
                    }
                }
                if let Some(count) = estimates.get(&me).filter(|count| **count >= 0.0) {
                    extra.push(format!("  rows: ≈{}", rows(*count)));
                }
                if !extra.is_empty() {
                    sections[*position].push('\n');
                    sections[*position].push_str(&extra.join("\n"));
                }
            }
        }
        if found.is_empty() {
            return Err(sections.join("\n"));
        }
        Ok(cap(sections.join("\n"), config.max_chars))
    }

    pub(crate) async fn prepare_dry_run(
        &mut self,
        config: &McpConfig,
        params: &Value,
    ) -> Option<DryRunStep> {
        let args = &params["arguments"];
        let sql = arg_str(args, "sql").trim().to_string();
        let connection = super::server::find_connection(config, arg_str(args, "connection"))
            .and_then(|connection| super::server::with_database(connection, args))
            .ok()?;
        if sql.is_empty() || connection.writes_blocked() || !dry_run_supported(connection.kind) {
            return None;
        }
        let ddl = redact::is_ddl(&sql);
        let words = redact::sql_words(&sql);
        if (ddl && !connection.allow_ddl)
            || (redact::write_word(&sql).is_none() && !ddl)
            || !dry_run_statement(&words)
        {
            return None;
        }
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let index = self
            .schema_index(config, &connection, &redactor)
            .await
            .ok()?;
        if let Err(error) = check_write_sql(&sql, &connection, &index) {
            return Some(DryRunStep::Done(DryRun {
                summary: error,
                failed: true,
            }));
        }
        let url = super::server::connection_url(&connection).ok()?;
        Some(DryRunStep::Ready(PendingDryRun {
            unfiltered: matches!(words.first().map(String::as_str), Some("update" | "delete"))
                && !top_level_where(&sql),
            ddl,
            sql,
            url,
            connection,
            config: config.clone(),
            pool: self.pool.clone(),
        }))
    }

    #[cfg(test)]
    pub(crate) async fn dry_run(&mut self, config: &McpConfig, params: &Value) -> Option<DryRun> {
        Some(self.prepare_dry_run(config, params).await?.finish().await)
    }
}

pub enum DryRunStep {
    Ready(PendingDryRun),
    Done(DryRun),
}

pub struct PendingDryRun {
    sql: String,
    url: String,
    ddl: bool,
    unfiltered: bool,
    connection: McpConnection,
    config: McpConfig,
    pool: db::pool::PoolState,
}

impl DryRunStep {
    pub async fn finish(self) -> DryRun {
        let job = match self {
            DryRunStep::Done(result) => return result,
            DryRunStep::Ready(job) => job,
        };
        let connection = &job.connection;
        let mut session = match db::import::open_session(
            connection.kind,
            &job.url,
            connection.database.as_deref(),
            job.pool.clone(),
        )
        .await
        {
            Ok(session) => session,
            Err(_) => {
                return DryRun {
                    summary: "Probelauf nicht möglich, Auswirkung unbekannt".into(),
                    failed: false,
                }
            }
        };
        let outcome = run(&job.config, connection.kind, session.execute(&job.sql)).await;
        let _ = session.rollback().await;
        match outcome {
            Ok(result) => DryRun {
                summary: match (job.ddl, result.rows_affected) {
                    (false, Some(count)) => format!(
                        "Probelauf: {count} {} betroffen, zurückgerollt{}",
                        if count == 1 { "Zeile" } else { "Zeilen" },
                        if job.unfiltered {
                            ". Ohne WHERE: betrifft alle Zeilen"
                        } else {
                            ""
                        }
                    ),
                    _ => "Probelauf erfolgreich, zurückgerollt".into(),
                },
                failed: false,
            },
            Err(error)
                if error.contains("Timeout")
                    || error.contains("abgebrochen")
                    || not_transactional(&error) =>
            {
                DryRun {
                    summary: if not_transactional(&error) {
                        "Kein Probelauf möglich: Anweisung läuft nicht in einer Transaktion. Auswirkung unbekannt".into()
                    } else {
                        "Probelauf am Zeitlimit abgebrochen, Auswirkung unbekannt".into()
                    },
                    failed: false,
                }
            }
            Err(error) => DryRun {
                summary: format!(
                    "Probelauf fehlgeschlagen: {}",
                    flat(&super::server::scrub_error(&error), 600)
                ),
                failed: true,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(name: &str, from: (&str, &str, &str), to: (&str, &str, &str)) -> ForeignKeyInfo {
        ForeignKeyInfo {
            constraint_name: name.into(),
            from_schema: from.0.into(),
            from_table: from.1.into(),
            from_column: from.2.into(),
            to_schema: to.0.into(),
            to_table: to.1.into(),
            to_column: to.2.into(),
        }
    }

    fn node(table: &str) -> (String, String) {
        ("public".into(), table.into())
    }

    fn shop() -> Graph {
        build_graph(
            [
                "customers",
                "orders",
                "order_items",
                "products",
                "addresses",
                "audit",
            ]
            .iter()
            .map(|table| node(table))
            .collect(),
            vec![
                key(
                    "o_c",
                    ("public", "orders", "customer_id"),
                    ("public", "customers", "id"),
                ),
                key(
                    "i_o",
                    ("public", "order_items", "order_id"),
                    ("public", "orders", "id"),
                ),
                key(
                    "i_p",
                    ("public", "order_items", "product_id"),
                    ("public", "products", "id"),
                ),
                key(
                    "o_bill",
                    ("public", "orders", "billing_id"),
                    ("public", "addresses", "id"),
                ),
                key(
                    "o_ship",
                    ("public", "orders", "shipping_id"),
                    ("public", "addresses", "id"),
                ),
                key(
                    "i_pk",
                    ("public", "order_items", "tenant"),
                    ("public", "products", "tenant"),
                ),
                key("x", ("public", "orders", "id"), ("public", "missing", "id")),
            ],
        )
    }

    #[test]
    fn join_path_walks_foreign_keys_in_both_directions() {
        let graph = shop();
        let text = join_path(&graph, &node("customers"), &node("products"), 20_000);
        assert!(text.starts_with("FROM public.customers"), "{text}");
        assert!(
            text.contains("JOIN public.orders ON public.orders.customer_id = public.customers.id"),
            "{text}"
        );
        assert!(
            text.contains(
                "JOIN public.order_items ON public.order_items.order_id = public.orders.id"
            ),
            "{text}"
        );
        assert!(
            text.contains(
                "JOIN public.products ON public.order_items.product_id = public.products.id"
            ),
            "{text}"
        );
        assert!(text.contains("other foreign keys between these tables: public.order_items.tenant = public.products.tenant"), "{text}");
        assert!(text.contains("(3 hops"), "{text}");
        assert!(!text.contains("missing"));
        let alternatives = join_path(&graph, &node("orders"), &node("addresses"), 20_000);
        assert!(
            alternatives.contains("billing_id") && alternatives.contains("shipping_id"),
            "{alternatives}"
        );
        let none = join_path(&graph, &node("audit"), &node("orders"), 20_000);
        assert!(none.starts_with("No foreign key path"), "{none}");
    }

    #[test]
    fn composite_keys_join_with_and_and_neighbours_list_both_sides() {
        let graph = build_graph(
            vec![node("a"), node("b")],
            vec![
                key("ab", ("public", "a", "x"), ("public", "b", "x")),
                key("ab", ("public", "a", "y"), ("public", "b", "y")),
            ],
        );
        assert_eq!(graph.edges.len(), 1);
        let text = neighbours(&graph, &node("b"), 20_000);
        assert!(
            text.contains(
                "public.a -> public.b: public.a.x = public.b.x AND public.a.y = public.b.y"
            ),
            "{text}"
        );
        assert!(text.starts_with("referenced by:"), "{text}");
    }

    #[test]
    fn resolve_requires_unique_names() {
        let nodes = vec![
            node("orders"),
            ("sales".into(), "orders".into()),
            node("items"),
        ];
        assert!(resolve(&nodes, "orders")
            .unwrap_err()
            .contains("mehrdeutig"));
        assert_eq!(resolve(&nodes, "sales.orders").unwrap().0, "sales");
        assert_eq!(resolve(&nodes, "ITEMS").unwrap().1, "items");
        assert!(resolve(&nodes, "nope")
            .unwrap_err()
            .contains("nicht gefunden"));
    }

    #[test]
    fn postgres_plans_become_a_compact_tree_with_warnings() {
        let plan = json!([{
            "Plan": {
                "Node Type": "Hash Join", "Join Type": "Inner", "Plan Rows": 50, "Total Cost": 30123.5,
                "Actual Rows": 48000, "Actual Loops": 1, "Actual Total Time": 812.4,
                "Hash Cond": "(o.customer_id = c.id)",
                "Plans": [
                    {"Node Type": "Seq Scan", "Relation Name": "orders", "Schema": "public", "Alias": "o",
                     "Plan Rows": 2000, "Rows Removed by Filter": 1_200_000, "Total Cost": 25000.0,
                     "Filter": "(status = 'paid'::text)"},
                    {"Node Type": "Index Scan", "Relation Name": "customers", "Schema": "public", "Alias": "c",
                     "Index Name": "customers_pkey", "Plan Rows": 1, "Total Cost": 8.3}
                ]
            },
            "Planning Time": 0.4, "Execution Time": 815.2
        }]);
        let text = compact_plan(&plan, 20_000);
        assert!(text.starts_with("- Hash Join (Inner) rows≈50 cost=30k actual=48k 812.4ms | hash cond: (o.customer_id = c.id)"), "{text}");
        assert!(text.contains("  - Seq Scan on public.orders o rows≈2000 cost=25k | filter: (status = 'paid'::text) removed=1.2M"), "{text}");
        assert!(
            text.contains("  - Index Scan on public.customers c using customers_pkey"),
            "{text}"
        );
        assert!(
            text.contains(
                "full scan of public.orders (≈1.2M rows); an index on the filter columns may help"
            ),
            "{text}"
        );
        assert!(text.contains("estimated 50 rows but got 48k"), "{text}");
        assert!(text.contains("execution time: 815.2ms"), "{text}");
    }

    #[test]
    fn sqlite_and_mysql_plans_are_compacted_and_unknown_plans_capped() {
        let sqlite = json!([
            {"id": 2, "parent": 0, "notused": 0, "detail": "SCAN orders"},
            {"id": 5, "parent": 2, "notused": 0, "detail": "SEARCH customers USING INTEGER PRIMARY KEY (rowid=?)"}
        ]);
        let text = compact_plan(&sqlite, 20_000);
        assert_eq!(text, "- SCAN orders\n  - SEARCH customers USING INTEGER PRIMARY KEY (rowid=?)\nwarnings:\n- SCAN orders reads every row");
        let mysql = json!({"query_block": {"nested_loop": [
            {"table": {"table_name": "orders", "access_type": "ALL", "rows_examined_per_scan": 250000, "attached_condition": "(`shop`.`orders`.`status` = 'paid')"}},
            {"table": {"table_name": "customers", "access_type": "eq_ref", "key": "PRIMARY", "rows_examined_per_scan": 1}}
        ]}});
        let text = compact_plan(&mysql, 20_000);
        assert!(
            text.contains("- ALL on orders rows≈250k | filter:"),
            "{text}"
        );
        assert!(
            text.contains("- eq_ref on customers using PRIMARY rows≈1"),
            "{text}"
        );
        assert!(text.contains("full scan of orders"), "{text}");
        let other = compact_plan(&json!({"steps": "x".repeat(5_000)}), 300);
        assert!(other.contains("[truncated at 300 chars"), "{other}");
    }

    #[test]
    fn dry_runs_only_where_rollback_is_reliable() {
        assert!(dry_run_supported(DatabaseKind::Postgres));
        assert!(dry_run_supported(DatabaseKind::Sqlite));
        assert!(!dry_run_supported(DatabaseKind::Oracle));
        assert!(!dry_run_supported(DatabaseKind::Mysql));
        assert!(!dry_run_supported(DatabaseKind::Clickhouse));
        assert!(!dry_run_supported(DatabaseKind::Mongodb));
        let words = |sql: &str| redact::sql_words(sql);
        assert!(dry_run_statement(&words("UPDATE orders SET a = 1")));
        assert!(dry_run_statement(&words(
            "ALTER TABLE orders ADD COLUMN b int"
        )));
        for sql in [
            "CALL archive_orders()",
            "BEGIN UPDATE t SET a = 1; COMMIT; END;",
            "DO $$ BEGIN PERFORM 1; END $$",
            "COPY orders TO 'out.csv'",
            "CREATE INDEX CONCURRENTLY i ON orders(a)",
            "VACUUM orders",
            "INSERT INTO t SELECT nextval('s')",
        ] {
            assert!(!dry_run_statement(&words(sql)), "{sql}");
        }
        assert!(top_level_where("DELETE FROM t WHERE a = 1"));
        assert!(!top_level_where(
            "UPDATE t SET total = (SELECT max(x) FROM s WHERE s.id = t.id)"
        ));
        assert!(!top_level_where("UPDATE t SET note = 'where (x'"));
        assert!(top_level_where("UPDATE t SET note = 'a)' WHERE id = 1"));
        assert!(not_transactional(
            "ERROR: CREATE DATABASE cannot run inside a transaction block"
        ));
    }

    fn shop_lab(name: &str) -> (Server, McpConfig, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("l8db-insight-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("shop.db");
        rusqlite::Connection::open(&db)
            .unwrap()
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE customers(id INTEGER PRIMARY KEY, email TEXT UNIQUE);
                 CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), status TEXT);
                 CREATE TABLE items(id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id), sku TEXT);
                 CREATE INDEX orders_status ON orders(status);
                 INSERT INTO customers VALUES (1,'a@x'),(2,'b@x');
                 INSERT INTO orders VALUES (1,1,'open'),(2,1,'paid'),(3,2,'open');
                 INSERT INTO items VALUES (1,1,'s1'),(2,3,'s2');",
            )
            .unwrap();
        let connection = McpConnection {
            id: format!("shop-{name}"),
            name: "Shop".into(),
            kind: DatabaseKind::Sqlite,
            connection_string: format!("sqlite:{}", db.display()),
            schemas: vec![],
            ssh: false,
            exposed: true,
            read_only: false,
            allow_ddl: true,
            allow_scripts: false,
            redact_columns: vec![],
            mask_rules: vec![],
            environment: None,
            allow_production_writes: false,
            database: None,
        };
        let config = McpConfig {
            enabled: true,
            connections: vec![connection],
            ..McpConfig::default()
        };
        let server = Server {
            pool: crate::db::pool::create_pool_state(),
            columns: HashMap::new(),
        };
        (server, config, db)
    }

    async fn call(
        server: &mut Server,
        config: &McpConfig,
        name: &str,
        args: Value,
    ) -> (bool, String) {
        let reply = server
            .call_with_config(&json!({"name": name, "arguments": args}), config)
            .await;
        (
            reply["isError"].as_bool().unwrap(),
            reply["content"][0]["text"].as_str().unwrap().to_string(),
        )
    }

    #[tokio::test]
    async fn sqlite_relations_explain_and_describe_work_end_to_end() {
        let (mut server, config, _) = shop_lab("tools");
        let (error, text) = call(
            &mut server,
            &config,
            "relations",
            json!({"connection": "Shop", "from": "customers", "to": "items"}),
        )
        .await;
        assert!(!error, "{text}");
        assert!(
            text.contains("JOIN main.orders ON main.orders.customer_id = main.customers.id"),
            "{text}"
        );
        assert!(
            text.contains("JOIN main.items ON main.items.order_id = main.orders.id"),
            "{text}"
        );
        let (error, text) = call(
            &mut server,
            &config,
            "relations",
            json!({"connection": "Shop", "from": "orders"}),
        )
        .await;
        assert!(
            !error && text.contains("referenced by:") && text.contains("main.items -> main.orders"),
            "{text}"
        );
        let (error, text) = call(&mut server, &config, "explain", json!({"connection": "Shop", "sql": "SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status = 'open'"})).await;
        assert!(!error, "{text}");
        assert!(
            text.contains("orders_status") || text.contains("SCAN"),
            "{text}"
        );
        let (error, text) = call(
            &mut server,
            &config,
            "explain",
            json!({"connection": "Shop", "sql": "DROP TABLE orders"}),
        )
        .await;
        assert!(error, "{text}");
        let (error, text) = call(
            &mut server,
            &config,
            "describe",
            json!({"connection": "Shop", "tables": ["orders", "customers"]}),
        )
        .await;
        assert!(!error, "{text}");
        assert!(
            text.contains("main.orders(id INTEGER, customer_id INTEGER, status TEXT)"),
            "{text}"
        );
        assert!(
            text.contains("references: (customer_id) -> main.customers(id)"),
            "{text}"
        );
        assert!(text.contains("orders_status(status)"), "{text}");
        assert!(text.contains("referenced by: main.orders"), "{text}");
    }

    #[tokio::test]
    async fn dry_runs_report_impact_roll_back_and_catch_errors() {
        let (mut server, config, db) = shop_lab("dry");
        let count = || {
            rusqlite::Connection::open(&db)
                .unwrap()
                .query_row(
                    "SELECT count(*) FROM orders WHERE status = 'open'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap()
        };
        let preview = server
            .dry_run(&config, &json!({"arguments": {"connection": "Shop", "sql": "UPDATE orders SET status = 'paid' WHERE status = 'open'"}}))
            .await
            .unwrap();
        assert!(!preview.failed);
        assert_eq!(
            preview.summary,
            "Probelauf: 2 Zeilen betroffen, zurückgerollt"
        );
        assert_eq!(count(), 2);
        let all = server
            .dry_run(
                &config,
                &json!({"arguments": {"connection": "Shop", "sql": "DELETE FROM items"}}),
            )
            .await
            .unwrap();
        assert!(all.summary.contains("Ohne WHERE"), "{}", all.summary);
        let nested = server
            .dry_run(&config, &json!({"arguments": {"connection": "Shop", "sql": "UPDATE orders SET status = (SELECT sku FROM items WHERE items.order_id = orders.id)"}}))
            .await
            .unwrap();
        assert!(
            nested.summary.contains("3 Zeilen") && nested.summary.contains("Ohne WHERE"),
            "{}",
            nested.summary
        );
        let broken = server
            .dry_run(
                &config,
                &json!({"arguments": {"connection": "Shop", "sql": "UPDATE orders SET nope = 1"}}),
            )
            .await
            .unwrap();
        assert!(
            broken.failed && broken.summary.starts_with("Probelauf fehlgeschlagen"),
            "{}",
            broken.summary
        );
        let ddl = server
            .dry_run(&config, &json!({"arguments": {"connection": "Shop", "sql": "ALTER TABLE orders ADD COLUMN note TEXT"}}))
            .await
            .unwrap();
        assert!(!ddl.failed, "{}", ddl.summary);
        let columns: i64 = rusqlite::Connection::open(&db)
            .unwrap()
            .query_row(
                "SELECT count(*) FROM pragma_table_info('orders') WHERE name = 'note'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(columns, 0);
        assert!(server
            .dry_run(
                &config,
                &json!({"arguments": {"connection": "Shop", "sql": "SELECT 1"}})
            )
            .await
            .is_none());
        let mut blocked = config.clone();
        blocked.connections[0].read_only = true;
        assert!(server
            .dry_run(
                &blocked,
                &json!({"arguments": {"connection": "Shop", "sql": "DELETE FROM items"}})
            )
            .await
            .is_none());
    }

    #[test]
    fn large_schema_graphs_stay_fast_and_bounded() {
        let tables = 5_000;
        let nodes: Vec<(String, String)> = (0..tables)
            .map(|index| node(&format!("t{index}")))
            .collect();
        let keys: Vec<ForeignKeyInfo> = (1..tables)
            .flat_map(|index| {
                let table = format!("t{index}");
                let parent = format!("t{}", (index - 1) / 3);
                let other = format!("t{}", index / 7);
                [
                    key(
                        &format!("p{index}"),
                        ("public", &table, "parent_id"),
                        ("public", &parent, "id"),
                    ),
                    key(
                        &format!("o{index}"),
                        ("public", &table, "other_id"),
                        ("public", &other, "id"),
                    ),
                ]
            })
            .collect();
        let mut builds = Vec::new();
        let mut paths = Vec::new();
        let mut graph = Graph::default();
        for _ in 0..7 {
            let started = Instant::now();
            graph = build_graph(nodes.clone(), keys.clone());
            builds.push(started.elapsed());
            let started = Instant::now();
            let text = join_path(&graph, &node("t4999"), &node("t1"), 20_000);
            paths.push(started.elapsed());
            assert!(text.contains("JOIN"), "{text}");
            assert!(text.chars().count() <= 20_100);
        }
        builds.sort();
        paths.sort();
        let neighbours = neighbours(&graph, &node("t0"), 20_000);
        assert!(neighbours.chars().count() <= 20_100);
        println!(
            "relations graph 5000 tables/{} edges: build median {:?} p95 {:?}, path median {:?} p95 {:?}",
            graph.edges.len(),
            builds[3],
            builds[6],
            paths[3],
            paths[6]
        );
        assert!(builds[6] < Duration::from_millis(400), "{:?}", builds[6]);
        assert!(paths[6] < Duration::from_millis(100), "{:?}", paths[6]);
    }

    #[test]
    fn large_plans_are_compacted_quickly_and_bounded() {
        fn deep(level: usize) -> Value {
            let mut node = json!({"Node Type": "Nested Loop", "Join Type": "Inner", "Plan Rows": 10, "Total Cost": 1.0, "Filter": "(a = b)".repeat(20)});
            if level < 60 {
                node["Plans"] = json!([deep(level + 1), {"Node Type": "Seq Scan", "Relation Name": format!("t{level}"), "Plan Rows": 200000, "Total Cost": 5.0, "Filter": "(x > 1)"}]);
            }
            node
        }
        let plan = json!([{"Plan": deep(0)}]);
        let mut times = Vec::new();
        for _ in 0..7 {
            let started = Instant::now();
            let text = compact_plan(&plan, 20_000);
            times.push(started.elapsed());
            assert!(text.chars().count() <= 20_100, "{}", text.len());
            assert!(text.contains("warnings:"));
        }
        times.sort();
        println!(
            "explain compact 60-level plan: median {:?} p95 {:?}",
            times[3], times[6]
        );
        assert!(times[6] < Duration::from_millis(50), "{:?}", times[6]);
    }
}
