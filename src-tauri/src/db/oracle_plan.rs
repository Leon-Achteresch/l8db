use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use oracle::{Connection, Row};
use serde_json::{json, Map, Value};

use super::{fetch, is_query, map_err, map_sql_err, s};

#[derive(Debug, Clone, Default)]
pub(super) struct PlanStats {
    pub starts: f64,
    pub output_rows: f64,
    pub elapsed_us: f64,
    pub buffer_gets: f64,
    pub disk_reads: f64,
    pub tempseg_size: f64,
    pub memory_used: f64,
    pub execution: String,
}

#[derive(Debug, Clone, Default)]
pub(super) struct PlanRow {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub operation: String,
    pub options: String,
    pub object_owner: String,
    pub object_name: String,
    pub object_alias: String,
    pub object_type: String,
    pub cost: Option<f64>,
    pub cardinality: Option<f64>,
    pub bytes: Option<f64>,
    pub time: Option<f64>,
    pub temp_space: Option<f64>,
    pub access_predicates: String,
    pub filter_predicates: String,
    pub stats: Option<PlanStats>,
}

pub(super) const MISSING_PRIVILEGES: &str = "EXPLAIN ANALYZE benötigt Leserechte auf V$SESSION und V$SQL_PLAN_STATISTICS_ALL (z. B. über SELECT_CATALOG_ROLE oder SELECT ANY DICTIONARY). Die Abfrage wurde nicht ausgeführt. Ohne diese Rechte steht nur der geschätzte Plan (Explain) zur Verfügung.";

const COLUMNS: &str = "id, parent_id, operation, options, object_owner, object_name, object_alias, object_type, cost, cardinality, bytes, time, temp_space, access_predicates, filter_predicates";

const STAT_COLUMNS: &str = "starts, last_output_rows, last_elapsed_time, last_cr_buffer_gets, last_disk_reads, last_tempseg_size, last_memory_used, last_execution";

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn statement_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    format!(
        "L8DB{:X}{:X}",
        nanos & 0xFFFF_FFFF_FFFF,
        COUNTER.fetch_add(1, Ordering::Relaxed) & 0xFFFF
    )
}

fn f_opt(row: &Row, index: usize) -> Option<f64> {
    s(row, index).trim().parse().ok()
}

fn f(row: &Row, index: usize) -> f64 {
    f_opt(row, index).unwrap_or(0.0)
}

fn plan_row(row: &Row) -> PlanRow {
    PlanRow {
        id: f(row, 0) as i64,
        parent_id: f_opt(row, 1).map(|v| v as i64),
        operation: s(row, 2),
        options: s(row, 3),
        object_owner: s(row, 4),
        object_name: s(row, 5),
        object_alias: s(row, 6),
        object_type: s(row, 7),
        cost: f_opt(row, 8),
        cardinality: f_opt(row, 9),
        bytes: f_opt(row, 10),
        time: f_opt(row, 11),
        temp_space: f_opt(row, 12),
        access_predicates: s(row, 13),
        filter_predicates: s(row, 14),
        stats: None,
    }
}

fn stats_row(row: &Row, offset: usize) -> Option<PlanStats> {
    f_opt(row, offset)?;
    Some(PlanStats {
        starts: f(row, offset),
        output_rows: f(row, offset + 1),
        elapsed_us: f(row, offset + 2),
        buffer_gets: f(row, offset + 3),
        disk_reads: f(row, offset + 4),
        tempseg_size: f(row, offset + 5),
        memory_used: f(row, offset + 6),
        execution: s(row, offset + 7),
    })
}

fn is_privilege_error(message: &str) -> bool {
    ["ORA-00942", "ORA-01031", "ORA-04043"]
        .iter()
        .any(|code| message.contains(code))
}

pub(super) fn explain(c: &Connection, statement: &str) -> Result<Value, String> {
    let id = statement_id();
    let sql = format!("EXPLAIN PLAN SET STATEMENT_ID = '{id}' FOR {statement}");
    c.execute(&sql, &[]).map_err(|e| map_sql_err(e, &sql))?;
    let rows = fetch(
        c,
        &format!("SELECT {COLUMNS} FROM plan_table WHERE statement_id = '{id}' ORDER BY id"),
    );
    let cleanup = c
        .execute(
            &format!("DELETE FROM plan_table WHERE statement_id = '{id}'"),
            &[],
        )
        .map(|_| ())
        .map_err(map_err);
    let plan = plan_tree(rows?.iter().map(plan_row).collect(), None)?;
    cleanup?;
    Ok(plan)
}

pub(super) fn analyze(c: &mut Connection, statement: &str) -> Result<Value, String> {
    for probe in [
        "SELECT prev_sql_id FROM v$session WHERE ROWNUM = 0",
        "SELECT sql_id FROM v$sql_plan_statistics_all WHERE ROWNUM = 0",
    ] {
        if let Err(e) = fetch(c, probe) {
            return Err(if is_privilege_error(&e) {
                MISSING_PRIVILEGES.to_string()
            } else {
                e
            });
        }
    }
    c.execute("ALTER SESSION SET STATISTICS_LEVEL = ALL", &[])
        .map_err(map_err)?;
    c.set_autocommit(false);
    let result = run_measured(c, statement);
    let _ = c.rollback();
    result
}

fn run_measured(c: &Connection, statement: &str) -> Result<Value, String> {
    let start = Instant::now();
    if is_query(statement) {
        let mut stmt = c
            .statement(statement)
            .fetch_array_size(1000)
            .build()
            .map_err(map_err)?;
        for row in stmt.query(&[]).map_err(|e| map_sql_err(e, statement))? {
            row.map_err(map_err)?;
        }
    } else {
        c.execute(statement, &[])
            .map_err(|e| map_sql_err(e, statement))?;
    }
    let execution_ms = start.elapsed().as_secs_f64() * 1000.0;
    let cursor = fetch(
        c,
        "SELECT prev_sql_id, prev_child_number FROM v$session WHERE sid = SYS_CONTEXT('USERENV', 'SID')",
    )?;
    let cursor = cursor
        .first()
        .ok_or("Eigene Sitzung in V$SESSION nicht gefunden.")?;
    let (sql_id, child) = (s(cursor, 0), s(cursor, 1));
    if sql_id.is_empty() {
        return Err("Ausgeführter Cursor konnte nicht ermittelt werden.".to_string());
    }
    let rows = fetch(
        c,
        &format!(
            "SELECT {COLUMNS}, {STAT_COLUMNS} FROM v$sql_plan_statistics_all WHERE sql_id = '{}' AND child_number = {} ORDER BY id",
            sql_id.replace('\'', ""),
            child.trim().parse::<i64>().unwrap_or(0)
        ),
    )?;
    let rows: Vec<PlanRow> = rows
        .iter()
        .map(|r| PlanRow {
            stats: stats_row(r, 15),
            ..plan_row(r)
        })
        .collect();
    plan_tree(rows, Some(execution_ms))
}

fn put(map: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    if let Some(v) = value.filter(|v| v.is_finite()) {
        map.insert(key.into(), json!(v));
    }
}

fn put_text(map: &mut Map<String, Value>, key: &str, value: &str) {
    if !value.trim().is_empty() {
        map.insert(key.into(), json!(value.trim()));
    }
}

fn apply_stats(map: &mut Map<String, Value>, stats: &PlanStats) {
    let loops = stats.starts.max(0.0);
    let per = |value: f64| if loops > 0.0 { value / loops } else { 0.0 };
    map.insert("Actual Loops".into(), json!(loops));
    map.insert("Actual Rows".into(), json!(per(stats.output_rows)));
    map.insert(
        "Actual Total Time".into(),
        json!(per(stats.elapsed_us / 1000.0)),
    );
    map.insert("Shared Hit Blocks".into(), json!(stats.buffer_gets));
    map.insert("Shared Read Blocks".into(), json!(stats.disk_reads));
    if stats.memory_used > 0.0 {
        map.insert("Memory Used".into(), json!(stats.memory_used));
    }
    if stats.tempseg_size > 0.0 {
        map.insert("Temp Space Used".into(), json!(stats.tempseg_size));
    }
    put_text(map, "Workarea Execution", &stats.execution);
    let execution = stats.execution.trim();
    if stats.tempseg_size > 0.0 || (!execution.is_empty() && execution != "OPTIMAL") {
        map.insert("Sort Space Type".into(), json!("Disk"));
    }
}

fn node(row: &PlanRow) -> Map<String, Value> {
    let mut map = Map::new();
    let node_type = format!("{} {}", row.operation.trim(), row.options.trim());
    map.insert("Node Type".into(), json!(node_type.trim()));
    map.insert("Oracle Id".into(), json!(row.id));
    let object_type = row.object_type.to_ascii_uppercase();
    if !row.object_name.is_empty() {
        let key = if object_type.starts_with("INDEX") || row.operation.starts_with("INDEX") {
            "Index Name"
        } else {
            "Relation Name"
        };
        map.insert(key.into(), json!(row.object_name));
    }
    put_text(&mut map, "Schema", &row.object_owner);
    let alias = row.object_alias.split('@').next().unwrap_or("");
    if !alias.is_empty() && alias != row.object_name {
        map.insert("Alias".into(), json!(alias.trim_matches('"')));
    }
    put(&mut map, "Total Cost", row.cost);
    put(&mut map, "Plan Rows", row.cardinality);
    if let (Some(bytes), Some(rows)) = (row.bytes, row.cardinality) {
        if rows > 0.0 {
            map.insert("Plan Width".into(), json!((bytes / rows).round()));
        }
    }
    put(&mut map, "Estimated Seconds", row.time);
    put(&mut map, "Estimated Temp Space", row.temp_space);
    put_text(&mut map, "Index Cond", &row.access_predicates);
    put_text(&mut map, "Filter", &row.filter_predicates);
    if let Some(stats) = &row.stats {
        apply_stats(&mut map, stats);
    }
    map
}

fn build(
    row: &PlanRow,
    rows: &HashMap<i64, &PlanRow>,
    children: &HashMap<i64, Vec<i64>>,
    depth: usize,
) -> Value {
    let mut map = node(row);
    if depth < 256 {
        let plans: Vec<Value> = children
            .get(&row.id)
            .into_iter()
            .flatten()
            .filter_map(|id| rows.get(id))
            .map(|child| build(child, rows, children, depth + 1))
            .collect();
        if !plans.is_empty() {
            map.insert("Plans".into(), Value::Array(plans));
        }
    }
    Value::Object(map)
}

fn fill_root_stats(root: &mut Value) {
    let Some(obj) = root.as_object_mut() else {
        return;
    };
    if obj.contains_key("Actual Total Time") {
        return;
    }
    let Some(first) = obj
        .get("Plans")
        .and_then(Value::as_array)
        .and_then(|p| p.first())
        .cloned()
    else {
        return;
    };
    let loops = first.get("Actual Loops").and_then(Value::as_f64);
    let time = first.get("Actual Total Time").and_then(Value::as_f64);
    let rows = first.get("Actual Rows").and_then(Value::as_f64);
    if let (Some(loops), Some(time), Some(rows)) = (loops, time, rows) {
        obj.insert("Actual Loops".into(), json!(1.0));
        obj.insert("Actual Total Time".into(), json!(time * loops));
        obj.insert("Actual Rows".into(), json!(rows * loops));
    }
}

pub(super) fn plan_tree(rows: Vec<PlanRow>, execution_ms: Option<f64>) -> Result<Value, String> {
    if rows.is_empty() {
        return Err("Oracle hat keinen Ausführungsplan geliefert.".to_string());
    }
    let by_id: HashMap<i64, &PlanRow> = rows.iter().map(|r| (r.id, r)).collect();
    let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut roots = Vec::new();
    for row in &rows {
        match row
            .parent_id
            .filter(|p| *p != row.id && by_id.contains_key(p))
        {
            Some(parent) => children.entry(parent).or_default().push(row.id),
            None => roots.push(row),
        }
    }
    let mut plans: Vec<Value> = roots
        .iter()
        .map(|root| build(root, &by_id, &children, 0))
        .collect();
    let mut root = if plans.len() == 1 {
        plans.remove(0)
    } else {
        json!({ "Node Type": "PLAN", "Plans": plans })
    };
    let mut entry = Map::new();
    if let Some(ms) = execution_ms {
        fill_root_stats(&mut root);
        entry.insert("Execution Time".into(), json!(ms));
    }
    entry.insert("Plan".into(), root);
    Ok(Value::Array(vec![Value::Object(entry)]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: i64, parent: Option<i64>, operation: &str, options: &str) -> PlanRow {
        PlanRow {
            id,
            parent_id: parent,
            operation: operation.into(),
            options: options.into(),
            ..Default::default()
        }
    }

    #[test]
    fn builds_hierarchy_from_parent_ids() {
        let mut scan = row(2, Some(1), "TABLE ACCESS", "FULL");
        scan.object_name = "EMP".into();
        scan.object_owner = "HR".into();
        scan.object_alias = "E@SEL$1".into();
        scan.object_type = "TABLE".into();
        scan.cost = Some(3.0);
        scan.cardinality = Some(14.0);
        scan.bytes = Some(532.0);
        scan.filter_predicates = "\"SAL\">1000".into();
        let mut index = row(3, Some(1), "INDEX", "UNIQUE SCAN");
        index.object_name = "PK_DEPT".into();
        index.object_type = "INDEX (UNIQUE)".into();
        index.access_predicates = "\"D\".\"ID\"=\"E\".\"DEPT_ID\"".into();
        let mut select = row(0, None, "SELECT STATEMENT", "");
        select.cost = Some(5.0);
        let plan = plan_tree(
            vec![select, row(1, Some(0), "NESTED LOOPS", ""), scan, index],
            None,
        )
        .unwrap();
        let root = &plan[0]["Plan"];
        assert_eq!(root["Node Type"], "SELECT STATEMENT");
        assert_eq!(root["Total Cost"], 5.0);
        let join = &root["Plans"][0];
        assert_eq!(join["Node Type"], "NESTED LOOPS");
        let scan = &join["Plans"][0];
        assert_eq!(scan["Node Type"], "TABLE ACCESS FULL");
        assert_eq!(scan["Relation Name"], "EMP");
        assert_eq!(scan["Schema"], "HR");
        assert_eq!(scan["Alias"], "E");
        assert_eq!(scan["Plan Rows"], 14.0);
        assert_eq!(scan["Plan Width"], 38.0);
        assert_eq!(scan["Filter"], "\"SAL\">1000");
        let index = &join["Plans"][1];
        assert_eq!(index["Index Name"], "PK_DEPT");
        assert!(index.get("Relation Name").is_none());
        assert!(index["Index Cond"].as_str().unwrap().contains("DEPT_ID"));
        assert!(plan[0].get("Execution Time").is_none());
    }

    #[test]
    fn maps_runtime_statistics_per_start() {
        let mut select = row(0, None, "SELECT STATEMENT", "");
        select.stats = None;
        let mut sort = row(1, Some(0), "SORT", "ORDER BY");
        sort.stats = Some(PlanStats {
            starts: 1.0,
            output_rows: 100.0,
            elapsed_us: 2500.0,
            tempseg_size: 1048576.0,
            execution: "1 PASS".into(),
            ..Default::default()
        });
        let mut scan = row(2, Some(1), "TABLE ACCESS", "FULL");
        scan.stats = Some(PlanStats {
            starts: 4.0,
            output_rows: 400.0,
            elapsed_us: 2000.0,
            buffer_gets: 12.0,
            ..Default::default()
        });
        let plan = plan_tree(vec![select, sort, scan], Some(3.5)).unwrap();
        assert_eq!(plan[0]["Execution Time"], 3.5);
        let root = &plan[0]["Plan"];
        assert_eq!(root["Actual Total Time"], 2.5);
        assert_eq!(root["Actual Rows"], 100.0);
        let sort = &root["Plans"][0];
        assert_eq!(sort["Sort Space Type"], "Disk");
        assert_eq!(sort["Workarea Execution"], "1 PASS");
        let scan = &sort["Plans"][0];
        assert_eq!(scan["Actual Loops"], 4.0);
        assert_eq!(scan["Actual Rows"], 100.0);
        assert_eq!(scan["Actual Total Time"], 0.5);
        assert_eq!(scan["Shared Hit Blocks"], 12.0);
        assert!(scan.get("Sort Space Type").is_none());
    }

    #[test]
    fn wraps_multiple_roots_and_rejects_empty_plans() {
        let plan = plan_tree(vec![row(1, None, "A", ""), row(2, Some(9), "B", "")], None).unwrap();
        assert_eq!(plan[0]["Plan"]["Node Type"], "PLAN");
        assert_eq!(plan[0]["Plan"]["Plans"].as_array().unwrap().len(), 2);
        assert!(plan_tree(Vec::new(), None).is_err());
    }

    #[test]
    fn statement_ids_are_unique_and_short() {
        let a = statement_id();
        let b = statement_id();
        assert_ne!(a, b);
        assert!(a.len() <= 30, "{a}");
    }
}
