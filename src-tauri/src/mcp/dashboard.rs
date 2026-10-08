use serde_json::{json, Map, Value};
use std::collections::hash_map::{DefaultHasher, RandomState};
use std::hash::{BuildHasher, Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use super::config::{self, McpConfig, McpConnection};
use super::dashboard_builder as builder;
use super::redact::{self, Redactor};
use super::server::{self, Server, SQL_KINDS};
use crate::db::QueryResult;

const GRID_COLS: i64 = 12;
const MAX_H: i64 = 40;
const MAX_Y: i64 = 1000;
const MAX_CHARTS: usize = 60;
const MAX_SQL_CHARS: usize = 20_000;
const MAX_CSS_BYTES: usize = 256 * 1024;
const MAX_NAME_CHARS: usize = 120;
const PERIODS: &[&str] = &["all", "7d", "30d", "90d", "quarter", "year", "12m"];
const REFRESH_HINT: &str = "refreshSec muss 0 (aus) oder 10 bis 86400 sein";
const SERIES_KINDS: &[&str] = &["column", "line", "area", "radar", "sankey", "heatmap"];
const DATA_KEYS: &[&str] = &[
    "sql",
    "builder",
    "dimension",
    "dimension2",
    "metrics",
    "dateColumn",
];
const SPEC_KEYS: &[&str] = &[
    "type",
    "title",
    "subtitle",
    "sql",
    "builder",
    "dimension",
    "dimension2",
    "metrics",
    "dateColumn",
    "period",
    "options",
    "x",
    "y",
    "w",
    "h",
];
const SPEC_ALIASES: &[(&str, &str)] = &[
    ("chart", "type"),
    ("chartType", "type"),
    ("kind", "type"),
    ("query", "sql"),
    ("name", "title"),
    ("description", "subtitle"),
    ("metric", "metrics"),
    ("measures", "metrics"),
    ("values", "metrics"),
    ("category", "dimension"),
    ("groupBy", "dimension"),
    ("series", "dimension2"),
    ("date", "dateColumn"),
];

struct Kind {
    name: &'static str,
    dim: &'static str,
    metrics: (usize, usize),
    size: (i64, i64),
    options: &'static str,
    hint: &'static str,
}

const KINDS: &[Kind] = &[
    Kind { name: "kpi", dim: "optional", metrics: (1, 1), size: (3, 4), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta curve", hint: "Big number with sparkline and trend %, never a bare number, so it needs a time dimension or a dateColumn. Time dimension (day/week/month, ORDER BY it): latest value (headline auto), trend vs. the previous bucket or comparison period. No dimension + dateColumn: period total, sparkline grouped by dateColumn per day/week/month (return rows per date, not one sum row), trend vs. the comparison period." },
    Kind { name: "area", dim: "required", metrics: (1, 6), size: (6, 7), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta showLegend stacked curve showGrid", hint: "Filled areas over the dimension (usually time). dimension2 splits into series." },
    Kind { name: "line", dim: "required", metrics: (1, 6), size: (6, 7), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta showLegend curve showGrid labels", hint: "One line per metric over the dimension. dimension2 splits into series." },
    Kind { name: "column", dim: "required", metrics: (1, 6), size: (6, 7), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta showLegend stacked showGrid labels sortBy horizontal", hint: "Vertical columns per category (horizontal: bars to the right). Several metrics or dimension2 give grouped/stacked columns." },
    Kind { name: "bars", dim: "required", metrics: (1, 1), size: (4, 8), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta showLegend showPercent sortBy", hint: "Horizontal bars with share of total (ranking, pipeline). Keep it to 12 bars or fewer." },
    Kind { name: "funnel", dim: "required", metrics: (1, 1), size: (6, 7), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta showLegend showPercent sortBy", hint: "Funnel stages in row order with conversion percent." },
    Kind { name: "donut", dim: "required", metrics: (1, 1), size: (4, 8), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta showLegend showPercent sortBy", hint: "Shares of a whole as ring. Keep it to 6 categories or fewer." },
    Kind { name: "rings", dim: "required", metrics: (1, 1), size: (4, 9), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta showLegend sortBy", hint: "Concentric rings per category, relative to the largest." },
    Kind { name: "radar", dim: "required", metrics: (1, 3), size: (4, 9), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta showLegend sortBy", hint: "Spider net, one axis per category, one polygon per metric or dimension2 value." },
    Kind { name: "scatter", dim: "optional", metrics: (2, 3), size: (6, 8), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta showLegend showGrid", hint: "Bubbles: metrics are x, y and optional size; dimension colors groups." },
    Kind { name: "sankey", dim: "two", metrics: (1, 1), size: (6, 9), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta", hint: "Flows from dimension (source) to dimension2 (target) weighted by the metric." },
    Kind { name: "score", dim: "required", metrics: (2, 2), size: (4, 7), options: "showValue showDelta showPeriod colorOffset unit decimals showLegend", hint: "Achieved vs. maximum points per category: metrics = [value, max]." },
    Kind { name: "gauge", dim: "none", metrics: (2, 2), size: (3, 5), options: "showValue showDelta showPeriod colorOffset unit decimals", hint: "Half-circle gauge: metrics = [value, target], summed over all rows; with period quarter or year a pace marker shows the expected progress." },
    Kind { name: "treemap", dim: "required", metrics: (1, 1), size: (6, 7), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta showLegend labels sortBy", hint: "Rectangles sized by the metric per category." },
    Kind { name: "heatmap", dim: "two", metrics: (1, 1), size: (6, 7), options: "showValue showDelta showPeriod colorOffset compare headline unit decimals invertDelta labels", hint: "Matrix dimension (rows) x dimension2 (columns), colored by the metric." },
    Kind { name: "table", dim: "optional", metrics: (0, 6), size: (6, 7), options: "showValue showPeriod compare unit decimals invertDelta", hint: "Raw result rows as table; mapping is optional." },
];

fn kind(name: &str) -> Result<&'static Kind, String> {
    let lower = name.trim().to_lowercase();
    let wanted = match lower
        .trim_end_matches("chart")
        .trim_end_matches(['_', '-', ' '])
    {
        "pie" | "doughnut" => "donut",
        "bar" | "vertical_bar" | "histogram" => "column",
        "hbar" | "horizontal_bar" | "horizontal_bars" => "bars",
        "number" | "stat" | "metric" | "single_value" | "big_number" => "kpi",
        "scatterplot" | "bubble" => "scatter",
        "timeseries" | "time_series" => "line",
        other => other,
    };
    KINDS
        .iter()
        .find(|kind| kind.name == wanted)
        .ok_or_else(|| {
            let names: Vec<&str> = KINDS.iter().map(|kind| kind.name).collect();
            format!("type '{name}' unbekannt. Möglich: {}", names.join(", "))
        })
}

fn min_size(kind: &Kind) -> (i64, i64) {
    if matches!(kind.name, "kpi" | "gauge") {
        (2, 3)
    } else {
        (3, 5)
    }
}

pub fn tool_definition() -> Value {
    let kinds: Vec<&str> = KINDS.iter().map(|kind| kind.name).collect();
    let nullable =
        |description: &str| json!({"type": ["string", "null"], "description": description});
    let spec = json!({
        "type": "object",
        "properties": {
            "type": {"type": "string", "enum": kinds},
            "title": {"type": "string"},
            "subtitle": nullable("Line under the title that says what is measured, e.g. 'Summe pro Monat' (max 120 chars, null removes it)"),
            "sql": {"type": "string", "description": "One read-only SELECT. Column aliases are the names used by the mapping fields and become legend/axis labels, so alias readably (AS \"Umsatz\"). Use {{variable}} for dashboard filters."},
            "builder": {"type": "object", "description": "Instead of sql: visual dataset the user can keep editing in the l8db chart studio. See action=chart_types for the format (table, joins, fields, dimension, dimension2, metrics, filters, dateColumn, sort, limit)."},
            "dimension": nullable("Result column for categories / x-axis"),
            "dimension2": nullable("Second category column: series split (column, line, area, radar), target (sankey), columns (heatmap)"),
            "metrics": {"type": "array", "items": {"type": "string"}, "description": "Numeric result columns"},
            "dateColumn": nullable("Date result column; enables the period filter"),
            "period": {"type": "string", "enum": PERIODS},
            "options": {
                "type": "object",
                "description": "Display options per type, see chart_types. null removes an option.",
                "properties": {
                    "compare": nullable("none|previous|year: comparison period (default previous, needs dateColumn and period != all)"),
                    "headline": nullable("auto|total|last|average|max|min: value of the big number"),
                    "unit": nullable("Unit after values, 1-8 chars, e.g. €, %, ms, Stk."),
                    "decimals": {"type": ["integer", "null"], "minimum": 0, "maximum": 4},
                    "invertDelta": {"type": ["boolean", "null"], "description": "true when lower is better (costs, latency)"}
                }
            },
            "x": {"type": "integer", "minimum": 0},
            "y": {"type": "integer", "minimum": 0},
            "w": {"type": "integer", "minimum": 2, "maximum": GRID_COLS},
            "h": {"type": "integer", "minimum": 3, "maximum": MAX_H}
        }
    });
    json!({
        "name": "dashboard",
        "description": "Build dashboards that appear live in the l8db app (Dashboard view of the connection). Each chart gets either its own read-only SQL plus a mapping of result columns (dimension, dimension2, metrics, dateColumn; omitted ones are inferred from the result) or a visual builder dataset (tables, joins, calculated fields, filters) that stays editable in the app's chart studio. Dashboards can have variables: filters shown above the charts, referenced as {{name}} in SQL, builder filters and builder fields. Use table names exactly as search shows them. Charts are validated by running the SQL, so fix reported errors and retry. Actions: list, get, create (connection, name, variables, charts), update (name, refreshSec, variables, design), delete, add_charts (charts), update_chart (chart + spec with changed fields only; for builder charts spec.builder is merged key by key into the current builder, and dimension/dimension2/metrics/dateColumn edit the builder directly), remove_chart, preview (dashboard+chart or connection+spec, shows rows; values sets variables), run (dashboard, optional chart and values: runs every chart and returns rows or errors, use it to check plausibility), arrange (dashboard: re-lays out all charts into a clean grid, kpi/gauge tiles on top, order kept), joins (connection + table, optional tables: suggests how other tables join to it, with measured match rate and row multiplication; every builder join is measured the same way when a chart is saved), chart_types (chart types, builder and variable format, options). Layout is a 12-column grid; omit x/y for automatic placement. Design: 2-4 kpi tiles on top (a kpi always shows sparkline and trend, never a bare number: give it a time dimension for the latest value, or no dimension plus dateColumn for the period total), then a wide trend (area/line) next to a donut or bars, then details; alias metrics readably, give every chart a title and subtitle, set options.unit/decimals, dateColumn + period for comparisons; after adding charts call arrange, then run. chart_types has the full design guide.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "get", "create", "update", "delete", "add_charts", "update_chart", "remove_chart", "preview", "run", "arrange", "joins", "chart_types"]},
                "connection": {"type": "string", "description": "Connection name or id (create, list filter, preview without dashboard)"},
                "dashboard": {"type": "string", "description": "Dashboard id or name"},
                "name": {"type": "string"},
                "refreshSec": {"type": "integer", "description": "Auto refresh in seconds, 0 = off"},
                "design": {"type": ["object", "null"], "description": "create/update: free dashboard CSS (max 256 KiB). null resets. Scoped to this dashboard, all CSS properties supported. Stable selectors: .dashboard-surface (:root/:scope), .dashboard-toolbar, .dashboard-filters, .dashboard-canvas, .dashboard-grid, .dashboard-widget, .dashboard-widget-header, .dashboard-widget-title, .dashboard-widget-subtitle, .dashboard-widget-summary, .dashboard-widget-content, [data-widget-id=\"chart-id\"], [data-chart-type=\"kpi\"]. Theme variables: --background, --foreground, --card, --border, --muted-foreground. Chart colors: --dash-accent, --dash-color-1 through --dash-color-8, --dash-compare. Use unique @keyframes/font names. @import is not loaded; external URLs follow app CSP. CSS-only updates do not execute database queries.", "properties": {"css": {"type": "string"}, "enabled": {"type": "boolean"}}, "required": ["css", "enabled"], "additionalProperties": false},
                "chart": {"type": "string", "description": "Chart id or title"},
                "limit": {"type": "integer", "minimum": 1, "description": "Rows per chart for preview (default 20) and run (default 5)"},
                "variables": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "label": {"type": "string"}, "type": {"type": "string", "enum": ["select", "text", "number", "date"]}, "default": {"type": ["string", "number"]}, "options": {"type": "array", "items": {"type": "string"}}, "optionsSql": {"type": "string"}}, "required": ["name"]}, "description": "Dashboard filters (create, update replaces the list). Empty value means no filter: builder filters bound to it are skipped, in SQL it becomes NULL."},
                "table": {"type": "string", "description": "joins: table to find join partners for (schema.table)"},
                "tables": {"type": "array", "items": {"type": "string"}, "description": "joins: only consider these tables"},
                "values": {"type": "object", "description": "Variable values for preview and run, e.g. {\"mandant\": \"Nordfrost\"}"},
                "charts": {"type": "array", "items": spec},
                "spec": spec
            },
            "required": ["action"]
        }
    })
}

pub fn dir() -> PathBuf {
    config::config_path().with_file_name("mcp-dashboards")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn path_of(id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("Ungültige Dashboard-Id '{id}'"));
    }
    Ok(dir().join(format!("{id}.json")))
}

fn stamp(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}-{}", hasher.finish(), bytes.len())
}

fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let part = || {
        let mut hasher = RandomState::new().build_hasher();
        std::time::SystemTime::now().hash(&mut hasher);
        COUNTER.fetch_add(1, Ordering::Relaxed).hash(&mut hasher);
        hasher.finish()
    };
    let hex = format!("{:016x}{:016x}", part(), part());
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn read_all() -> Vec<(Value, String)> {
    let Ok(entries) = std::fs::read_dir(dir()) else {
        return Vec::new();
    };
    let mut list: Vec<(Value, String)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let id = path.file_stem()?.to_str()?.to_string();
            if path.extension()? != "json" || !valid_id(&id) {
                return None;
            }
            let bytes = std::fs::read(&path).ok()?;
            let value: Value = serde_json::from_slice(&bytes).ok()?;
            (value.get("id").and_then(Value::as_str) == Some(id.as_str())
                && value["datasets"].is_array()
                && value["widgets"].is_array())
            .then(|| (value, stamp(&bytes)))
        })
        .collect();
    list.sort_by_key(|(value, _)| value["createdAt"].as_i64().unwrap_or(0));
    list
}

fn write(dashboard: &Value) -> Result<String, String> {
    let id = dashboard["id"].as_str().unwrap_or("");
    let path = path_of(id)?;
    std::fs::create_dir_all(dir()).map_err(|e| format!("Dashboard-Ordner: {e}"))?;
    let mut bytes = serde_json::to_vec_pretty(dashboard).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    let temp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&temp, &bytes).map_err(|e| format!("Dashboard schreiben: {e}"))?;
    config::restrict(&temp);
    std::fs::rename(&temp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        format!("Dashboard schreiben: {e}")
    })?;
    Ok(stamp(&bytes))
}

fn remove_file(id: &str) -> Result<(), String> {
    match std::fs::remove_file(path_of(id)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Dashboard löschen: {e}")),
    }
}

fn trusted(dashboard: &Value, config: &McpConfig) -> bool {
    let Some(connection) = dashboard["connectionId"]
        .as_str()
        .and_then(|id| config.connections.iter().find(|c| c.id == id))
    else {
        return false;
    };
    let redactor = Redactor::new(&config.redaction, &[]);
    let index = redact::SchemaIndex::new(&[], &redactor, &[]);
    let variables = variables_of(dashboard);
    let empty = Map::new();
    let sql_of = |dataset: &Value| -> String {
        if dataset["mode"] == "expert" {
            builder::substitute(
                dataset["sql"].as_str().unwrap_or(""),
                &variables,
                &empty,
                connection.kind,
            )
        } else {
            builder::builder_sql(&dataset["simple"], connection.kind, &variables, &empty)
        }
    };
    dashboard["datasets"]
        .as_array()
        .into_iter()
        .flatten()
        .map(sql_of)
        .chain(
            variables
                .iter()
                .filter_map(|v| v["optionsSql"].as_str().map(str::to_string)),
        )
        .map(|sql| {
            sql.trim()
                .trim_end_matches(|c: char| c == ';' || c.is_whitespace())
                .to_string()
        })
        .filter(|sql| !sql.is_empty())
        .all(|sql| server::check_read_sql(&sql, connection, &index).is_ok())
}

fn variables_of(dashboard: &Value) -> Vec<Value> {
    dashboard["variables"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

pub fn list_dashboards() -> Vec<Value> {
    let config = config::load();
    read_all()
        .into_iter()
        .map(|(mut value, stamp)| {
            value["trusted"] = json!(trusted(&value, &config));
            value["stamp"] = json!(stamp);
            value
        })
        .collect()
}

#[tauri::command]
pub async fn mcp_dashboards() -> Vec<Value> {
    list_dashboards()
}

#[tauri::command]
pub fn mcp_dashboard_save(dashboard: Value) -> Result<String, String> {
    let id = dashboard["id"].as_str().unwrap_or("");
    let connection_id = dashboard["connectionId"].as_str().unwrap_or("");
    if connection_id.is_empty()
        || !dashboard["datasets"].is_array()
        || !dashboard["widgets"].is_array()
    {
        return Err("Ungültiges Dashboard-Format".into());
    }
    let created = std::fs::read(path_of(id)?)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|old| old["createdAt"].as_i64())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    let design = validate_design(dashboard.get("design"))?;
    write(&json!({
        "id": id,
        "connectionId": connection_id,
        "name": dashboard["name"].as_str().unwrap_or("Dashboard"),
        "refreshSec": dashboard["refreshSec"].as_u64().unwrap_or(0),
        "createdAt": created,
        "design": design,
        "datasets": dashboard["datasets"],
        "widgets": dashboard["widgets"],
        "variables": dashboard["variables"].as_array().cloned().unwrap_or_default(),
    }))
}

#[tauri::command]
pub fn mcp_dashboard_delete(id: String) -> Result<(), String> {
    remove_file(&id)
}

fn validate_design(value: Option<&Value>) -> Result<Value, String> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(Value::Null);
    };
    let css = value["css"]
        .as_str()
        .ok_or("design.css muss ein Text sein.")?;
    let enabled = value["enabled"]
        .as_bool()
        .ok_or("design.enabled muss true/false sein.")?;
    if css.len() > MAX_CSS_BYTES {
        return Err("Das Dashboard-CSS darf höchstens 256 KiB groß sein.".into());
    }
    Ok(json!({"css": css, "enabled": enabled}))
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn find_dashboard<'a>(
    config: &'a McpConfig,
    target: &str,
) -> Result<(Value, &'a McpConnection), String> {
    let wanted = target.trim().to_lowercase();
    if wanted.is_empty() {
        return Err("dashboard fehlt".into());
    }
    let visible: Vec<(Value, &McpConnection)> = read_all()
        .into_iter()
        .filter_map(|(value, _)| {
            let connection = dashboard_connection(config, &value)?;
            Some((value, connection))
        })
        .collect();
    if let Some(found) = visible
        .iter()
        .find(|(value, _)| value["id"].as_str() == Some(target.trim()))
    {
        return Ok(found.clone());
    }
    let mut named: Vec<(Value, &McpConnection)> = visible
        .into_iter()
        .filter(|(value, _)| value["name"].as_str().map(str::to_lowercase) == Some(wanted.clone()))
        .collect();
    match named.len() {
        0 => Err(format!(
            "Dashboard '{target}' nicht gefunden. action=list nutzen."
        )),
        1 => Ok(named.remove(0)),
        _ => Err(format!(
            "Name '{target}' ist mehrdeutig, Id angeben: {}",
            named
                .iter()
                .map(|(value, connection)| format!(
                    "{} ({})",
                    value["id"].as_str().unwrap_or(""),
                    connection.name
                ))
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

fn dashboard_connection<'a>(config: &'a McpConfig, value: &Value) -> Option<&'a McpConnection> {
    let id = value["connectionId"].as_str()?;
    server::exposed(config).find(|connection| connection.id == id)
}

fn sql_connection<'a>(config: &'a McpConfig, target: &str) -> Result<&'a McpConnection, String> {
    let connection = server::find_connection(config, target)?;
    if !SQL_KINDS.contains(&connection.kind) {
        return Err(format!(
            "Dashboards brauchen eine SQL-Verbindung, '{}' ist keine.",
            connection.name
        ));
    }
    Ok(connection)
}

fn find_widget(dashboard: &Value, target: &str) -> Result<usize, String> {
    let widgets = dashboard["widgets"].as_array().cloned().unwrap_or_default();
    let target = target.trim();
    if target.is_empty() {
        return Err("chart fehlt".into());
    }
    if let Some(index) = widgets
        .iter()
        .position(|w| w["id"].as_str() == Some(target))
    {
        return Ok(index);
    }
    let wanted = target.to_lowercase();
    let titled: Vec<usize> = widgets
        .iter()
        .enumerate()
        .filter(|(_, w)| widget_title(dashboard, w).to_lowercase() == wanted)
        .map(|(index, _)| index)
        .collect();
    match titled.as_slice() {
        [index] => Ok(*index),
        [] => Err(format!(
            "Chart '{target}' nicht gefunden. action=get zeigt alle Charts."
        )),
        _ => Err(format!(
            "Titel '{target}' ist mehrdeutig, Chart-Id angeben."
        )),
    }
}

fn dataset_of<'a>(dashboard: &'a Value, widget: &Value) -> Option<&'a Value> {
    let id = widget["datasetId"].as_str()?;
    dashboard["datasets"]
        .as_array()?
        .iter()
        .find(|dataset| dataset["id"].as_str() == Some(id))
}

fn widget_title(dashboard: &Value, widget: &Value) -> String {
    text(widget, "title")
        .or_else(|| dataset_of(dashboard, widget).and_then(|d| text(d, "name")))
        .unwrap_or("")
        .to_string()
}

struct Shape {
    dimension: Option<String>,
    dimension2: Option<String>,
    metrics: Vec<String>,
    date: bool,
    timed: bool,
}

fn shape_of(dataset: &Value) -> Shape {
    if dataset["mode"] == "expert" {
        let mapping = &dataset["mapping"];
        let dimension = text(mapping, "dimension").map(str::to_string);
        return Shape {
            timed: dimension.is_some(),
            dimension,
            dimension2: text(mapping, "dimension2").map(str::to_string),
            metrics: strings(&mapping["metrics"]),
            date: text(mapping, "dateColumn").is_some(),
        };
    }
    let simple = &dataset["simple"];
    let count = simple["metrics"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter(|m| m["agg"] == "count" || text(m, "column").is_some())
                .count()
        })
        .unwrap_or(0);
    let dimension = simple["dimension"]["column"]
        .as_str()
        .map(|_| "dim".to_string());
    Shape {
        timed: dimension.is_some()
            && text(&simple["dimension"], "bucket").is_some_and(|bucket| bucket != "none"),
        dimension,
        dimension2: text(simple, "dimension2").map(|_| "dim2".to_string()),
        metrics: (0..count).map(|i| format!("m{i}")).collect(),
        date: text(simple, "dateColumn").is_some(),
    }
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn check_shape(kind: &Kind, shape: &Shape, period: &str) -> Result<(), String> {
    let name = kind.name;
    match kind.dim {
        "required" if shape.dimension.is_none() => {
            return Err(format!(
                "'{name}' braucht dimension (Kategorie-/Zeitspalte)."
            ))
        }
        "two" if shape.dimension.is_none() || shape.dimension2.is_none() => {
            return Err(format!(
                "'{name}' braucht dimension und dimension2 ({}).",
                if name == "sankey" {
                    "Quelle und Ziel"
                } else {
                    "Zeilen und Spalten"
                }
            ))
        }
        "none" if shape.dimension.is_some() => {
            return Err(format!("'{name}' funktioniert nur ohne dimension."))
        }
        _ => {}
    }
    if name == "kpi" && !shape.timed && !shape.date {
        return Err(
            "'kpi' zeigt immer Sparkline und Trend: setze dimension auf eine Zeitspalte (Tag/Woche/Monat, ORDER BY; im builder {field, bucket}) oder dateColumn. Eine Einzelzahl allein ist nicht erlaubt."
                .into(),
        );
    }
    if shape.dimension2.is_some() && !SERIES_KINDS.contains(&name) {
        return Err(format!(
            "dimension2 wirkt nur bei {}, nicht bei '{name}'.",
            SERIES_KINDS.join(", ")
        ));
    }
    let (min, max) = kind.metrics;
    let count = shape.metrics.len();
    if count < min || count > max {
        return Err(format!(
            "'{name}' braucht {} metrics, erhalten {count}.",
            if min == max {
                min.to_string()
            } else {
                format!("{min} bis {max}")
            }
        ));
    }
    if period != "all" && !shape.date {
        return Err(format!(
            "period '{period}' braucht dateColumn (Datumsspalte im Ergebnis)."
        ));
    }
    Ok(())
}

fn check_options(
    kind: &Kind,
    base: &Map<String, Value>,
    patch: Option<&Value>,
    metrics: &[String],
) -> Result<Map<String, Value>, String> {
    let allowed: Vec<&str> = kind.options.split(' ').collect();
    let valid = |key: &str| key == "metricKeys" || allowed.contains(&key);
    let mut options: Map<String, Value> = base
        .iter()
        .filter(|(key, _)| valid(key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let patch = match patch {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(map)) => map.clone(),
        Some(_) => return Err("options muss ein Objekt sein.".into()),
    };
    for (key, mut value) in patch {
        if value.is_null() {
            options.remove(&key);
            continue;
        }
        if key == "unit" {
            if let Some(unit) = value.as_str() {
                value = json!(unit.trim());
            }
        }
        if !valid(&key) {
            return Err(format!(
                "Option '{key}' gibt es bei '{}' nicht. Möglich: {}, metricKeys",
                kind.name,
                allowed.join(", ")
            ));
        }
        let ok = match key.as_str() {
            "colorOffset" => value.as_i64().is_some_and(|n| (0..=7).contains(&n)),
            "curve" => matches!(value.as_str(), Some("monotone" | "linear")),
            "sortBy" => matches!(value.as_str(), Some("none" | "asc" | "desc")),
            "compare" => matches!(value.as_str(), Some("none" | "previous" | "year")),
            "headline" => matches!(
                value.as_str(),
                Some("auto" | "total" | "last" | "average" | "max" | "min")
            ),
            "unit" => value
                .as_str()
                .is_some_and(|unit| (1..=8).contains(&unit.chars().count())),
            "decimals" => value.as_i64().is_some_and(|n| (0..=4).contains(&n)),
            "metricKeys" => value
                .as_array()
                .is_some_and(|list| !list.is_empty() && list.iter().all(|v| v.is_string())),
            _ => value.is_boolean(),
        };
        if !ok {
            return Err(format!(
                "Option '{key}': {}",
                match key.as_str() {
                    "colorOffset" => "Ganzzahl 0 bis 7 (Startfarbe der Palette)",
                    "curve" => "'monotone' oder 'linear'",
                    "sortBy" => "'none', 'asc' oder 'desc'",
                    "compare" => "'none', 'previous' oder 'year'",
                    "headline" => "'auto', 'total', 'last', 'average', 'max' oder 'min'",
                    "unit" => "Text mit 1 bis 8 Zeichen",
                    "decimals" => "Ganzzahl 0 bis 4",
                    "metricKeys" => "nicht-leere Liste von metrics",
                    _ => "true oder false",
                }
            ));
        }
        options.insert(key, value);
    }
    if let Some(keys) = options.get("metricKeys") {
        if let Some(missing) = strings(keys).into_iter().find(|k| !metrics.contains(k)) {
            return Err(format!("metricKeys: '{missing}' ist keine der metrics."));
        }
    }
    Ok(options)
}

fn rect(widget: &Value) -> (i64, i64, i64, i64) {
    let n = |key: &str| widget[key].as_i64().unwrap_or(0);
    (n("x"), n("y"), n("w"), n("h"))
}

fn overlaps(a: (i64, i64, i64, i64), b: (i64, i64, i64, i64)) -> bool {
    a.0 < b.0 + b.2 && a.0 + a.2 > b.0 && a.1 < b.1 + b.3 && a.1 + a.3 > b.1
}

fn free(others: &[Value], area: (i64, i64, i64, i64)) -> bool {
    others.iter().all(|other| !overlaps(area, rect(other)))
}

fn place(others: &[Value], w: i64, h: i64) -> (i64, i64) {
    let bottom = others
        .iter()
        .map(|o| rect(o).1 + rect(o).3)
        .max()
        .unwrap_or(0);
    for y in 0..=bottom {
        for x in 0..=GRID_COLS - w {
            if free(others, (x, y, w, h)) {
                return (x, y);
            }
        }
    }
    (0, bottom)
}

fn layout(
    kind: &Kind,
    spec: &Map<String, Value>,
    others: &[Value],
    notes: &mut Vec<String>,
) -> Result<(i64, i64, i64, i64), String> {
    let int = |key: &str| -> Result<Option<i64>, String> {
        match spec.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => value
                .as_i64()
                .map(Some)
                .ok_or_else(|| format!("{key} muss eine Ganzzahl sein.")),
        }
    };
    let (min_w, min_h) = min_size(kind);
    let w = int("w")?.unwrap_or(kind.size.0);
    let h = int("h")?.unwrap_or(kind.size.1);
    if !(min_w..=GRID_COLS).contains(&w) {
        return Err(format!(
            "w für '{}' muss {min_w} bis {GRID_COLS} sein.",
            kind.name
        ));
    }
    if !(min_h..=MAX_H).contains(&h) {
        return Err(format!(
            "h für '{}' muss {min_h} bis {MAX_H} sein.",
            kind.name
        ));
    }
    let (x, y) = match (int("x")?, int("y")?) {
        (None, None) => place(others, w, h),
        (x, y) => {
            let x = x.unwrap_or(0);
            let mut y = y.unwrap_or(0);
            if x < 0 || x + w > GRID_COLS {
                return Err(format!(
                    "x muss 0 bis {} sein (Raster hat {GRID_COLS} Spalten, w={w}).",
                    GRID_COLS - w
                ));
            }
            if !(0..=MAX_Y).contains(&y) {
                return Err(format!("y muss 0 bis {MAX_Y} sein."));
            }
            let wanted = y;
            while !free(others, (x, y, w, h)) {
                y += 1;
            }
            if y != wanted {
                notes.push(format!("überlappte, nach y={y} verschoben"));
            }
            (x, y)
        }
    };
    Ok((x, y, w, h))
}

fn technical(name: &str) -> bool {
    let numbered = name
        .strip_prefix('m')
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()));
    numbered
        || name.contains('_')
        || ["count", "sum", "avg", "min", "max"]
            .iter()
            .any(|word| name.eq_ignore_ascii_case(word))
}

fn design_notes(
    kind: &Kind,
    rows: Option<usize>,
    expert: bool,
    shape: &Shape,
    period: &str,
    options: &Map<String, Value>,
) -> Vec<String> {
    let mut notes = Vec::new();
    let name = kind.name;
    match rows {
        Some(n) if n > 8 && matches!(name, "donut" | "funnel" | "rings") => notes.push(format!(
            "{n} Kategorien sind für {name} zu viele – besser bars oder Top 6 plus „Sonstige“."
        )),
        Some(n) if n > 15 && name == "bars" => notes.push(format!(
            "{n} Balken sind zu viele – besser Top 12 plus „Sonstige“."
        )),
        _ => {}
    }
    if expert {
        let names: Vec<&str> = shape
            .metrics
            .iter()
            .map(String::as_str)
            .filter(|metric| technical(metric))
            .collect();
        if !names.is_empty() {
            notes.push(format!(
                "Spaltennamen {} wirken technisch – lesbare Aliase wie AS \"Umsatz\" werden zu Legende und Achsen.",
                names.join(", ")
            ));
        }
    }
    if matches!(
        options.get("compare").and_then(Value::as_str),
        Some("previous" | "year")
    ) && (!shape.date || period == "all")
    {
        notes.push("compare wirkt nur mit dateColumn und period ≠ all.".into());
    }
    notes
}

fn arrange(widgets: &[Value]) -> Vec<Value> {
    let mut sorted = widgets.to_vec();
    sorted.sort_by_key(|widget| {
        let (x, y, _, _) = rect(widget);
        (y, x)
    });
    let chart = |widget: &Value| widget["chart"].as_str().unwrap_or("").to_string();
    let (tiles, rest): (Vec<Value>, Vec<Value>) = sorted
        .into_iter()
        .partition(|widget| matches!(chart(widget).as_str(), "kpi" | "gauge"));
    let narrow = |widget: &Value| {
        matches!(
            chart(widget).as_str(),
            "donut" | "rings" | "radar" | "bars" | "score"
        )
    };
    let mut rows: Vec<(Vec<Value>, Vec<i64>, i64)> = Vec::new();
    let total = tiles.len();
    let tile_rows = total.div_ceil(4);
    let mut queue = tiles.into_iter();
    for row in 0..tile_rows {
        let count = total / tile_rows + usize::from(row < total % tile_rows);
        let group: Vec<Value> = queue.by_ref().take(count).collect();
        let widths = vec![GRID_COLS / count as i64; count];
        rows.push((group, widths, 4));
    }
    let mut index = 0;
    while index < rest.len() {
        let left = rest.len() - index;
        let widths: Vec<i64> = if left >= 3 && rest[index..index + 3].iter().all(narrow) {
            vec![4, 4, 4]
        } else if left >= 2 {
            match (narrow(&rest[index]), narrow(&rest[index + 1])) {
                (false, true) => vec![8, 4],
                (true, false) => vec![4, 8],
                _ => vec![6, 6],
            }
        } else {
            vec![GRID_COLS]
        };
        let group = rest[index..index + widths.len()].to_vec();
        let height = group
            .iter()
            .map(|widget| kind(&chart(widget)).map_or(7, |k| k.size.1))
            .max()
            .unwrap_or(7)
            .clamp(7, 9);
        index += widths.len();
        rows.push((group, widths, height));
    }
    let mut out = Vec::new();
    let mut y = 0;
    for (group, widths, height) in rows {
        let mut x = 0;
        for (mut widget, w) in group.into_iter().zip(widths) {
            widget["x"] = json!(x);
            widget["y"] = json!(y);
            widget["w"] = json!(w);
            widget["h"] = json!(height);
            x += w;
            out.push(widget);
        }
        y += height;
    }
    out
}

fn empty_simple() -> Value {
    json!({
        "schema": "", "table": "", "join": null, "joins": [], "dimension": null,
        "dimension2": null,
        "metrics": [{"id": new_id(), "agg": "count", "column": null, "label": "Anzahl"}],
        "filters": [], "dateColumn": null, "sort": "dimension", "limit": 50
    })
}

fn flatten(dashboard: &Value, widget: &Value) -> Map<String, Value> {
    let dataset = dataset_of(dashboard, widget);
    let mut out = Map::new();
    out.insert("id".into(), widget["id"].clone());
    out.insert("type".into(), widget["chart"].clone());
    out.insert("title".into(), json!(widget_title(dashboard, widget)));
    if let Some(subtitle) = text(widget, "subtitle") {
        out.insert("subtitle".into(), json!(subtitle));
    }
    match dataset {
        Some(dataset) if dataset["mode"] == "expert" => {
            let mapping = &dataset["mapping"];
            out.insert("sql".into(), dataset["sql"].clone());
            for key in ["dimension", "dimension2", "metrics", "dateColumn"] {
                out.insert(key.into(), mapping[key].clone());
            }
        }
        Some(dataset) => {
            out.insert(
                "builder".into(),
                builder::describe_builder(&dataset["simple"]),
            );
        }
        None => {}
    }
    out.insert("period".into(), widget["period"].clone());
    out.insert(
        "options".into(),
        widget.get("options").cloned().unwrap_or(json!({})),
    );
    for key in ["x", "y", "w", "h"] {
        out.insert(key.into(), widget[key].clone());
    }
    out
}

struct Built {
    widget: Value,
    dataset: Option<Value>,
    report: String,
}

fn spec_object(value: &Value) -> Result<Map<String, Value>, String> {
    let mut map = value
        .as_object()
        .cloned()
        .ok_or("Chart-Spezifikation muss ein Objekt sein.")?;
    for (alias, key) in SPEC_ALIASES {
        if !map.contains_key(*key) {
            if let Some(value) = map.remove(*alias) {
                map.insert((*key).into(), value);
            }
        }
    }
    for (axis, key) in [("x", "dimension"), ("y", "metrics")] {
        let named = match map.get(axis) {
            Some(Value::String(name)) => name.trim().parse::<i64>().is_err(),
            Some(Value::Array(list)) => !list.is_empty() && list.iter().all(Value::is_string),
            _ => false,
        };
        if named && !map.contains_key(key) {
            if let Some(value) = map.remove(axis) {
                map.insert(key.into(), value);
            }
        }
    }
    if let Some(metric @ Value::String(_)) = map.get("metrics") {
        let list = json!([metric]);
        map.insert("metrics".into(), list);
    }
    if let Some(key) = map
        .keys()
        .find(|key| !SPEC_KEYS.contains(&key.as_str()) && *key != "id" && *key != "builder")
    {
        return Err(format!(
            "Unbekanntes Feld '{key}'. Erlaubt: {}",
            SPEC_KEYS.join(", ")
        ));
    }
    Ok(map)
}

fn optional_text(spec: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    match spec.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.trim().is_empty() => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.trim().to_string())),
        Some(_) => Err(format!("{key} muss ein Text sein.")),
    }
}

impl Server {
    pub(super) async fn dashboard(
        &mut self,
        config: &McpConfig,
        args: &Value,
    ) -> Result<String, String> {
        let action = server::arg_str(args, "action");
        let started = Instant::now();
        let result = match action {
            "chart_types" => return Ok(chart_types()),
            "list" => return list(config, args),
            "get" => {
                let (dashboard, connection) =
                    find_dashboard(config, server::arg_str(args, "dashboard"))?;
                return Ok(server::cap(
                    describe(&dashboard, connection),
                    config.max_chars,
                ));
            }
            "create" => self.create(config, args).await,
            "preview" => return self.preview(config, args).await,
            "run" => return self.run_all(config, args).await,
            "joins" => return self.joins(config, args).await,
            "update" | "delete" | "add_charts" | "update_chart" | "remove_chart" | "arrange" => {
                self.modify(config, args, action).await
            }
            "" => Err("action fehlt. chart_types zeigt, was möglich ist.".into()),
            other => Err(format!("Unbekannte action '{other}'.")),
        };
        match result {
            Ok((connection, name, text)) => {
                let out = Ok(text);
                server::audit(
                    connection,
                    &format!("dashboard.{action}"),
                    &name,
                    &out,
                    started,
                );
                out
            }
            Err(error) => Err(error),
        }
    }

    async fn create<'a>(
        &mut self,
        config: &'a McpConfig,
        args: &Value,
    ) -> Result<(&'a McpConnection, String, String), String> {
        let connection = sql_connection(config, server::arg_str(args, "connection"))?;
        let name = check_name(server::arg_str(args, "name"))?;
        if read_all().iter().any(|(value, _)| {
            value["connectionId"].as_str() == Some(connection.id.as_str())
                && value["name"].as_str().map(str::to_lowercase) == Some(name.to_lowercase())
        }) {
            return Err(format!(
                "Dashboard '{name}' gibt es für '{}' schon. update/add_charts nutzen oder anderen Namen wählen.",
                connection.name
            ));
        }
        let mut dashboard = json!({
            "id": new_id(),
            "connectionId": connection.id,
            "name": name,
            "refreshSec": refresh(args)?.unwrap_or(0),
            "createdAt": chrono::Utc::now().timestamp_millis(),
            "datasets": [],
            "widgets": [],
            "variables": [],
        });
        dashboard["design"] = validate_design(args.get("design"))?;
        dashboard["variables"] = json!(
            self.prepare_variables(config, connection, args.get("variables"))
                .await?
        );
        let reports = self
            .add_all(config, connection, &mut dashboard, args.get("charts"), true)
            .await?;
        write(&dashboard)?;
        Ok((
            connection,
            name.clone(),
            format!(
                "ok, Dashboard '{name}' angelegt (id {}), {} Charts. Sichtbar in l8db unter Dashboard von '{}'.{}",
                dashboard["id"].as_str().unwrap_or(""),
                reports.len(),
                connection.name,
                reports.join("")
            ),
        ))
    }

    async fn add_all(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        dashboard: &mut Value,
        charts: Option<&Value>,
        optional: bool,
    ) -> Result<Vec<String>, String> {
        let specs = match charts {
            None | Some(Value::Null) if optional => Vec::new(),
            Some(Value::Array(list)) if !list.is_empty() || optional => list.clone(),
            _ => {
                return Err(
                    "charts muss eine nicht-leere Liste von Chart-Spezifikationen sein.".into(),
                )
            }
        };
        let current = dashboard["widgets"].as_array().map_or(0, Vec::len);
        if current + specs.len() > MAX_CHARTS {
            return Err(format!("Maximal {MAX_CHARTS} Charts pro Dashboard."));
        }
        let mut reports = Vec::new();
        let variables = variables_of(dashboard);
        for (index, spec) in specs.iter().enumerate() {
            let label = spec
                .get("title")
                .and_then(Value::as_str)
                .filter(|t| !t.trim().is_empty())
                .map(|t| format!("'{t}'"))
                .unwrap_or_else(|| format!("#{}", index + 1));
            let spec = spec_object(spec).map_err(|e| format!("Chart {label}: {e}"))?;
            let others = dashboard["widgets"].as_array().cloned().unwrap_or_default();
            let built = self
                .build(config, connection, &spec, None, &others, &variables)
                .await
                .map_err(|e| format!("Chart {label}: {e}"))?;
            if let Some(dataset) = built.dataset {
                push(dashboard, "datasets", dataset);
            }
            push(dashboard, "widgets", built.widget);
            reports.push(built.report);
        }
        Ok(reports)
    }

    async fn build(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        spec: &Map<String, Value>,
        existing: Option<(&Value, Option<&Value>)>,
        others: &[Value],
        variables: &[Value],
    ) -> Result<Built, String> {
        let base_widget = existing.map(|(widget, _)| widget);
        let base_dataset = existing.and_then(|(_, dataset)| dataset);
        let kind_name = optional_text(spec, "type")?
            .or_else(|| {
                base_widget
                    .and_then(|w| text(w, "chart"))
                    .map(str::to_string)
            })
            .ok_or("type fehlt. chart_types zeigt die Möglichkeiten.")?;
        let kind = kind(&kind_name)?;
        let title = match spec.get("title") {
            Some(_) => optional_text(spec, "title")?.unwrap_or_default(),
            None => base_widget
                .and_then(|w| text(w, "title"))
                .unwrap_or("")
                .to_string(),
        };
        if title.chars().count() > MAX_NAME_CHARS {
            return Err(format!("title ist länger als {MAX_NAME_CHARS} Zeichen."));
        }
        let subtitle = match spec.get("subtitle") {
            Some(_) => optional_text(spec, "subtitle")?,
            None => base_widget
                .and_then(|w| text(w, "subtitle"))
                .map(str::to_string),
        };
        if subtitle
            .as_ref()
            .is_some_and(|s| s.chars().count() > MAX_NAME_CHARS)
        {
            return Err(format!("subtitle ist länger als {MAX_NAME_CHARS} Zeichen."));
        }
        let period = match spec.get("period") {
            None => base_widget
                .and_then(|w| text(w, "period"))
                .unwrap_or("all")
                .to_string(),
            Some(_) => optional_text(spec, "period")?.unwrap_or_else(|| "all".into()),
        };
        if !PERIODS.contains(&period.as_str()) {
            return Err(format!(
                "period '{period}' unbekannt. Möglich: {}",
                PERIODS.join(", ")
            ));
        }
        let data_change = existing.is_none() || DATA_KEYS.iter().any(|key| spec.contains_key(*key));
        let mut notes = Vec::new();
        let mut preview = String::new();
        let mut rows = None;
        let builder_base = base_dataset.filter(|d| {
            d["mode"] == "simple" && d["simple"]["table"].as_str().is_some_and(|t| !t.is_empty())
        });
        let merged = match builder_base {
            Some(base) if !spec.contains_key("sql") && data_change => {
                let mut merged = builder::describe_builder(&base["simple"]);
                if let (Some(target), Some(patch)) = (
                    merged.as_object_mut(),
                    spec.get("builder").and_then(Value::as_object),
                ) {
                    for (key, value) in patch {
                        target.insert(key.clone(), value.clone());
                    }
                }
                for key in ["dimension", "dimension2", "metrics", "dateColumn"] {
                    if let Some(value) = spec.get(key) {
                        merged[key] = value.clone();
                    }
                }
                Some(merged)
            }
            _ => spec
                .get("builder")
                .filter(|value| !value.is_null())
                .cloned(),
        };
        let (dataset, shape) = if let (true, Some(builder_spec)) = (data_change, merged.as_ref()) {
            if spec.contains_key("sql") && spec.contains_key("builder") {
                return Err("Entweder sql oder builder angeben, nicht beides.".into());
            }
            let simple = builder::parse_builder(builder_spec)?;
            let id = base_dataset
                .and_then(|d| d["id"].as_str())
                .map(str::to_string)
                .unwrap_or_else(new_id);
            let dataset = json!({
                "id": id,
                "name": if title.is_empty() { kind.name.to_string() } else { title.clone() },
                "mode": "simple",
                "simple": simple,
                "sql": "",
                "mapping": {"dimension": null, "dimension2": null, "metrics": [], "dateColumn": null},
            });
            check_variables(&builder::dataset_variables(&dataset), variables)?;
            let shape = shape_of(&dataset);
            check_shape(kind, &shape, &period)?;
            let sql =
                builder::builder_sql(&dataset["simple"], connection.kind, variables, &Map::new());
            let mut mapping = Mapping {
                dimension: shape.dimension.clone(),
                dimension2: shape.dimension2.clone(),
                metrics: shape.metrics.clone(),
                date_column: None,
            };
            let (_, shown, count) = self
                .check_sql(
                    config,
                    connection,
                    kind,
                    &sql,
                    &mut mapping,
                    &mut notes,
                    variables,
                )
                .await?;
            preview = shown;
            rows = Some(count);
            for line in self
                .join_report(config, connection, &dataset["simple"])
                .await
            {
                notes.push(line);
            }
            (Some(dataset), shape)
        } else if data_change {
            let base = base_dataset.filter(|d| d["mode"] == "expert");
            let field = |key: &str| -> Result<Option<String>, String> {
                if spec.contains_key(key) {
                    optional_text(spec, key)
                } else {
                    Ok(base
                        .and_then(|d| text(&d["mapping"], key))
                        .map(str::to_string))
                }
            };
            let sql = match spec.get("sql") {
                Some(_) => optional_text(spec, "sql")?,
                None => base.and_then(|d| text(d, "sql")).map(str::to_string),
            }
            .ok_or(if base_dataset.is_some() && base.is_none() {
                "Chart nutzt den Baukasten der App. builder (Format siehe get) oder sql mitgeben."
            } else {
                "sql fehlt."
            })?;
            let metrics = match spec.get("metrics") {
                None => base
                    .map(|d| strings(&d["mapping"]["metrics"]))
                    .unwrap_or_default(),
                Some(Value::Null) => Vec::new(),
                Some(value @ Value::Array(list)) if list.iter().all(Value::is_string) => {
                    strings(value)
                }
                Some(_) => return Err("metrics muss eine Liste von Spaltennamen sein.".into()),
            };
            let mut mapping = Mapping {
                dimension: field("dimension")?,
                dimension2: field("dimension2")?,
                metrics,
                date_column: field("dateColumn")?,
            };
            if !mapping.needs_inference(kind) {
                check_shape(kind, &mapping.shape(), &period)?;
            }
            check_variables(&builder::tokens(&sql), variables)?;
            let (sql, shown, count) = self
                .check_sql(
                    config,
                    connection,
                    kind,
                    &sql,
                    &mut mapping,
                    &mut notes,
                    variables,
                )
                .await?;
            check_shape(kind, &mapping.shape(), &period)?;
            preview = shown;
            rows = Some(count);
            let id = base
                .and_then(|d| d["id"].as_str())
                .map(str::to_string)
                .unwrap_or_else(new_id);
            let dataset = json!({
                "id": id,
                "name": if title.is_empty() { kind.name.to_string() } else { title.clone() },
                "mode": "expert",
                "simple": base.map(|d| d["simple"].clone()).unwrap_or_else(empty_simple),
                "sql": sql,
                "mapping": {
                    "dimension": mapping.dimension,
                    "dimension2": mapping.dimension2,
                    "metrics": mapping.metrics,
                    "dateColumn": mapping.date_column,
                },
            });
            let shape = mapping.shape();
            (Some(dataset), shape)
        } else {
            let dataset = base_dataset.ok_or("Chart hat keinen Datensatz, sql angeben.")?;
            let shape = shape_of(dataset);
            check_shape(kind, &shape, &period)?;
            (None, shape)
        };
        let base_options = base_widget
            .and_then(|w| w["options"].as_object())
            .cloned()
            .unwrap_or_default();
        let options = check_options(kind, &base_options, spec.get("options"), &shape.metrics)?;
        let mut position = spec.clone();
        if let Some(widget) = base_widget {
            let (min_w, min_h) = min_size(kind);
            for (key, min) in [("w", min_w), ("h", min_h)] {
                if !spec.contains_key(key) {
                    let size = widget[key].as_i64().unwrap_or(0).max(min);
                    position.insert(key.into(), json!(size));
                }
            }
            if !spec.contains_key("y") {
                position.insert("y".into(), widget["y"].clone());
            }
            if !spec.contains_key("x") {
                let w = position
                    .get("w")
                    .and_then(Value::as_i64)
                    .unwrap_or(kind.size.0);
                let x = widget["x"].as_i64().unwrap_or(0).min(GRID_COLS - w).max(0);
                position.insert("x".into(), json!(x));
            }
        }
        let (x, y, w, h) = layout(kind, &position, others, &mut notes)?;
        let expert = dataset
            .as_ref()
            .or(base_dataset)
            .is_some_and(|d| d["mode"] == "expert");
        notes.extend(design_notes(kind, rows, expert, &shape, &period, &options));
        let dataset_id = dataset
            .as_ref()
            .map(|d| d["id"].clone())
            .or_else(|| base_widget.map(|w| w["datasetId"].clone()))
            .unwrap_or(Value::Null);
        let id = base_widget
            .and_then(|w| w["id"].as_str())
            .map(str::to_string)
            .unwrap_or_else(new_id);
        let mut widget = json!({
            "id": id,
            "chart": kind.name,
            "datasetId": dataset_id,
            "title": title,
            "period": period,
            "options": options,
            "x": x, "y": y, "w": w, "h": h,
        });
        if let Some(subtitle) = subtitle {
            widget["subtitle"] = json!(subtitle);
        }
        let mut report = format!(
            "\n- chart {id} '{}' {} at x={x} y={y} w={w} h={h}",
            title, kind.name
        );
        if !notes.is_empty() {
            report.push_str(&format!(" [{}]", notes.join("; ")));
        }
        if !preview.is_empty() {
            report.push('\n');
            report.push_str(&indent(&preview));
        }
        Ok(Built {
            widget,
            dataset,
            report,
        })
    }

    async fn check_sql(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        kind: &Kind,
        sql: &str,
        mapping: &mut Mapping,
        notes: &mut Vec<String>,
        variables: &[Value],
    ) -> Result<(String, String, usize), String> {
        let sql = sql
            .trim()
            .trim_end_matches(|c: char| c == ';' || c.is_whitespace())
            .to_string();
        if sql.is_empty() {
            return Err("sql fehlt.".into());
        }
        if sql.chars().count() > MAX_SQL_CHARS {
            return Err(format!("sql ist länger als {MAX_SQL_CHARS} Zeichen."));
        }
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let columns = self.columns_for(config, connection).await?;
        let index = redact::SchemaIndex::new(&columns, &redactor, connection.allowed_schemas());
        let run = builder::substitute(&sql, variables, &Map::new(), connection.kind);
        server::check_read_sql(&run, connection, &index)?;
        let result = self.run_sql(config, connection, &run).await?;
        mapping.resolve(&result.columns, notes)?;
        mapping.infer(kind, &result, notes);
        check_numeric(&result, &mapping.metrics)?;
        check_trend(kind, &result, mapping)?;
        notes.extend(crowding(kind, &result, mapping));
        if result.rows.is_empty() {
            notes.push("Ergebnis ist aktuell leer".into());
        } else if result.rows.len() > 500 {
            notes.push(format!(
                "{} Zeilen, GROUP BY/LIMIT empfohlen",
                result.rows.len()
            ));
        }
        Ok((
            sql,
            server::format_result(&result, config, &redactor, 3),
            result.rows.len(),
        ))
    }

    async fn run_sql(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        sql: &str,
    ) -> Result<QueryResult, String> {
        let started = Instant::now();
        let adapter = server::adapter(connection, &self.pool)?;
        let result = server::run(config, connection.kind, async {
            adapter.execute_query(sql).await
        })
        .await;
        let logged = result.as_ref().map(|_| String::new()).map_err(Clone::clone);
        server::audit(connection, "dashboard", sql, &logged, started);
        result.map_err(|e| format!("SQL-Fehler: {e}"))
    }

    async fn modify<'a>(
        &mut self,
        config: &'a McpConfig,
        args: &Value,
        action: &str,
    ) -> Result<(&'a McpConnection, String, String), String> {
        let (mut dashboard, connection) =
            find_dashboard(config, server::arg_str(args, "dashboard"))?;
        let id = dashboard["id"].as_str().unwrap_or("").to_string();
        let name = dashboard["name"].as_str().unwrap_or("").to_string();
        let message = match action {
            "delete" => {
                remove_file(&id)?;
                return Ok((
                    connection,
                    name.clone(),
                    format!("ok, Dashboard '{name}' gelöscht."),
                ));
            }
            "update" => {
                let mut changed = Vec::new();
                if args.get("name").is_some() {
                    let next = check_name(server::arg_str(args, "name"))?;
                    dashboard["name"] = json!(next);
                    changed.push(format!("name='{next}'"));
                }
                if let Some(seconds) = refresh(args)? {
                    dashboard["refreshSec"] = json!(seconds);
                    changed.push(format!("refreshSec={seconds}"));
                }
                if args.get("variables").is_some() {
                    let next = self
                        .prepare_variables(config, connection, args.get("variables"))
                        .await?;
                    for widget in dashboard["widgets"].as_array().into_iter().flatten() {
                        if let Some(dataset) = dataset_of(&dashboard, widget) {
                            check_variables(&builder::dataset_variables(dataset), &next).map_err(
                                |e| format!("Chart '{}': {e}", widget_title(&dashboard, widget)),
                            )?;
                        }
                    }
                    changed.push(format!("variables={}", next.len()));
                    dashboard["variables"] = json!(next);
                }
                if args.get("design").is_some() {
                    dashboard["design"] = validate_design(args.get("design"))?;
                    changed.push("design".into());
                }
                if changed.is_empty() {
                    return Err(
                        "update braucht name, refreshSec, variables und/oder design.".into(),
                    );
                }
                format!("ok, Dashboard '{name}' geändert: {}", changed.join(", "))
            }
            "add_charts" => {
                let reports = self
                    .add_all(
                        config,
                        connection,
                        &mut dashboard,
                        args.get("charts"),
                        false,
                    )
                    .await?;
                format!(
                    "ok, {} Charts zu '{name}' hinzugefügt.{}",
                    reports.len(),
                    reports.join("")
                )
            }
            "update_chart" => {
                let index = find_widget(&dashboard, server::arg_str(args, "chart"))?;
                let spec = spec_object(args.get("spec").unwrap_or(&Value::Null))?;
                if spec.is_empty() {
                    return Err("spec mit den zu ändernden Feldern fehlt.".into());
                }
                let widgets = dashboard["widgets"].as_array().cloned().unwrap_or_default();
                let widget = widgets[index].clone();
                let dataset = dataset_of(&dashboard, &widget).cloned();
                let others: Vec<Value> = widgets
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != index)
                    .map(|(_, w)| w.clone())
                    .collect();
                let shared = dataset
                    .as_ref()
                    .is_some_and(|d| others.iter().any(|w| w["datasetId"] == d["id"]));
                let mut base = dataset.clone();
                if shared && DATA_KEYS.iter().any(|key| spec.contains_key(*key)) {
                    if let Some(copy) = base.as_mut() {
                        copy["id"] = json!(new_id());
                    }
                }
                let built = self
                    .build(
                        config,
                        connection,
                        &spec,
                        Some((&widget, base.as_ref())),
                        &others,
                        &variables_of(&dashboard),
                    )
                    .await?;
                if let Some(next) = built.dataset {
                    let datasets = dashboard["datasets"]
                        .as_array_mut()
                        .ok_or("datasets fehlt")?;
                    match datasets.iter().position(|d| d["id"] == next["id"]) {
                        Some(i) => datasets[i] = next,
                        None => datasets.push(next),
                    }
                }
                dashboard["widgets"][index] = built.widget;
                prune(&mut dashboard);
                format!("ok, Chart geändert.{}", built.report)
            }
            "arrange" => {
                let widgets = dashboard["widgets"].as_array().cloned().unwrap_or_default();
                if widgets.is_empty() {
                    return Err(format!(
                        "Dashboard '{name}' hat keine Charts. Erst add_charts."
                    ));
                }
                let arranged = arrange(&widgets);
                let lines: Vec<String> = arranged
                    .iter()
                    .map(|widget| {
                        let (x, y, w, h) = rect(widget);
                        format!(
                            "\n- {} '{}' {} x={x} y={y} w={w} h={h}",
                            widget["id"].as_str().unwrap_or(""),
                            widget_title(&dashboard, widget),
                            widget["chart"].as_str().unwrap_or("")
                        )
                    })
                    .collect();
                dashboard["widgets"] = json!(arranged);
                format!(
                    "ok, {} Charts in '{name}' neu angeordnet: Kacheln (kpi, gauge) oben, danach Zeilen aus breiten und schmalen Charts, Reihenfolge beibehalten. Feinschliff mit update_chart (x, y, w, h), Daten prüfen mit action=run.{}",
                    lines.len(),
                    lines.join("")
                )
            }
            _ => {
                let index = find_widget(&dashboard, server::arg_str(args, "chart"))?;
                let title = widget_title(&dashboard, &dashboard["widgets"][index]);
                if let Some(list) = dashboard["widgets"].as_array_mut() {
                    list.remove(index);
                }
                prune(&mut dashboard);
                format!("ok, Chart '{title}' entfernt.")
            }
        };
        write(&dashboard)?;
        Ok((connection, name, message))
    }

    async fn preview(&mut self, config: &McpConfig, args: &Value) -> Result<String, String> {
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .map_or(20, |n| n as usize)
            .clamp(1, config.max_rows.max(1));
        if text(args, "dashboard").is_some() {
            let (dashboard, connection) =
                find_dashboard(config, server::arg_str(args, "dashboard"))?;
            let index = find_widget(&dashboard, server::arg_str(args, "chart"))?;
            let widget = &dashboard["widgets"][index];
            let dataset = dataset_of(&dashboard, widget).ok_or("Chart hat keinen Datensatz.")?;
            let (sql, mut mapping) = dataset_query(
                dataset,
                connection.kind,
                &variables_of(&dashboard),
                &values_of(args),
            );
            return self
                .run_preview(config, connection, &sql, &mut mapping, limit)
                .await;
        }
        let connection = sql_connection(config, server::arg_str(args, "connection"))?;
        let spec = spec_object(args.get("spec").unwrap_or(&Value::Null))?;
        let variables = builder::parse_variables(args.get("variables").unwrap_or(&Value::Null))?;
        let (sql, mut mapping, built) = match spec.get("builder").filter(|v| !v.is_null()) {
            Some(raw) => {
                let dataset = json!({"mode": "simple", "simple": builder::parse_builder(raw)?});
                let (sql, mapping) =
                    dataset_query(&dataset, connection.kind, &variables, &values_of(args));
                (sql, mapping, Some(shape_of(&dataset)))
            }
            None => (
                builder::substitute(
                    &optional_text(&spec, "sql")?.ok_or("spec.sql oder spec.builder fehlt.")?,
                    &variables,
                    &values_of(args),
                    connection.kind,
                ),
                Mapping {
                    dimension: optional_text(&spec, "dimension")?,
                    dimension2: optional_text(&spec, "dimension2")?,
                    metrics: strings(spec.get("metrics").unwrap_or(&Value::Null)),
                    date_column: optional_text(&spec, "dateColumn")?,
                },
                None,
            ),
        };
        let mut problems = Vec::new();
        if let Some(name) = optional_text(&spec, "type")? {
            let kind = kind(&name)?;
            let period = optional_text(&spec, "period")?.unwrap_or_else(|| "all".into());
            let shape = built.unwrap_or_else(|| mapping.shape());
            if let Err(e) = check_shape(kind, &shape, &period) {
                problems.push(e);
            }
        }
        let mut text = self
            .run_preview(config, connection, &sql, &mut mapping, limit)
            .await?;
        if !problems.is_empty() {
            text.push_str(&format!("\nPassung: {}", problems.join(" ")));
        }
        Ok(text)
    }

    async fn prepare_variables(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        raw: Option<&Value>,
    ) -> Result<Vec<Value>, String> {
        let variables = builder::parse_variables(raw.unwrap_or(&Value::Null))?;
        for variable in &variables {
            let Some(sql) = variable["optionsSql"].as_str() else {
                continue;
            };
            let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
            let columns = self.columns_for(config, connection).await?;
            let index = redact::SchemaIndex::new(&columns, &redactor, connection.allowed_schemas());
            let label = variable["name"].as_str().unwrap_or("");
            server::check_read_sql(sql, connection, &index)
                .map_err(|e| format!("variable '{label}' optionsSql: {e}"))?;
            self.run_sql(config, connection, sql)
                .await
                .map_err(|e| format!("variable '{label}' optionsSql: {e}"))?;
        }
        Ok(variables)
    }

    async fn join_stats(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        sql: &str,
    ) -> Result<builder::JoinStats, String> {
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let columns = self.columns_for(config, connection).await?;
        let index = redact::SchemaIndex::new(&columns, &redactor, connection.allowed_schemas());
        server::check_read_sql(sql, connection, &index)?;
        let result = self.run_sql(config, connection, sql).await?;
        result
            .rows
            .first()
            .and_then(|row| builder::read_join_stats(&result.columns, row))
            .ok_or_else(|| "Tabelle ist leer.".to_string())
    }

    async fn join_report(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        simple: &Value,
    ) -> Vec<String> {
        let mut out = Vec::new();
        for check in builder::join_checks(simple, connection.kind) {
            match self.join_stats(config, connection, &check.sql).await {
                Ok(stats) => out.push(format!("Join {}: {}", check.label, stats.summary())),
                Err(e) => out.push(format!(
                    "Join {}: Trefferquote nicht messbar ({e})",
                    check.label
                )),
            }
        }
        out
    }

    async fn joins(&mut self, config: &McpConfig, args: &Value) -> Result<String, String> {
        let connection = sql_connection(config, server::arg_str(args, "connection"))?;
        let target = text(args, "table")
            .ok_or("table fehlt (Tabelle, zu der Verknüpfungen gesucht werden).")?;
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .map_or(6, |n| n as usize)
            .clamp(1, 15);
        let all = self.columns_for(config, connection).await?;
        let visible = Server::visible_columns(&all, connection);
        let mut tables: Vec<(String, String, Vec<String>)> = Vec::new();
        for column in &visible {
            match tables
                .iter_mut()
                .find(|(schema, table, _)| *schema == column.schema && *table == column.table)
            {
                Some((_, _, list)) => list.push(column.name.clone()),
                None => tables.push((
                    column.schema.clone(),
                    column.table.clone(),
                    vec![column.name.clone()],
                )),
            }
        }
        let matches = |schema: &str, table: &str, name: &str| {
            name.eq_ignore_ascii_case(table)
                || name.eq_ignore_ascii_case(&format!("{schema}.{table}"))
        };
        let base = tables
            .iter()
            .find(|(schema, table, _)| matches(schema, table, target))
            .cloned()
            .ok_or_else(|| format!("Tabelle '{target}' nicht gefunden. search zeigt die Namen."))?;
        let wanted: Vec<String> = args["tables"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let candidates: Vec<(String, String, Vec<String>)> = tables
            .iter()
            .filter(|(schema, table, _)| {
                wanted.is_empty() || wanted.iter().any(|name| matches(schema, table, name))
            })
            .cloned()
            .collect();
        let suggestions = builder::suggest_joins((&base.0, &base.1, &base.2), &candidates, limit);
        if suggestions.is_empty() {
            return Ok(format!(
                "Keine Verknüpfung für {}.{} anhand der Spaltennamen gefunden. Joins lassen sich trotzdem frei angeben: {{\"table\": \"...\", \"on\": \"spalte = spalte\"}}.",
                base.0, base.1
            ));
        }
        let mut out = vec![format!(
            "Vorschläge für {}.{} (gemessen an {} Zeilen, bester zuerst). In builder.joins übernehmen:",
            base.0, base.1, 500
        )];
        for suggestion in suggestions {
            let sql = builder::join_stats_sql(
                connection.kind,
                (&base.0, &base.1),
                (&suggestion.schema, &suggestion.table),
                &[(suggestion.from.clone(), suggestion.to.clone())],
            );
            let measured = match self.join_stats(config, connection, &sql).await {
                Ok(stats) => stats.summary(),
                Err(e) => format!("nicht messbar ({e})"),
            };
            let qualified = if suggestion.schema.is_empty() {
                suggestion.table.clone()
            } else {
                format!("{}.{}", suggestion.schema, suggestion.table)
            };
            out.push(format!(
                "- {} · {} · {}",
                json!({"table": qualified, "on": format!("{} = {}", suggestion.from, suggestion.to)}),
                if suggestion.by_name { "Name passt" } else { "gleiche Spalte" },
                measured
            ));
        }
        Ok(server::cap(out.join("\n"), config.max_chars))
    }

    async fn run_all(&mut self, config: &McpConfig, args: &Value) -> Result<String, String> {
        let (dashboard, connection) = find_dashboard(config, server::arg_str(args, "dashboard"))?;
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .map_or(5, |n| n as usize)
            .clamp(1, config.max_rows.max(1));
        let only = match text(args, "chart") {
            Some(target) => Some(find_widget(&dashboard, target)?),
            None => None,
        };
        let variables = variables_of(&dashboard);
        let values = values_of(args);
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let columns = self.columns_for(config, connection).await?;
        let index = redact::SchemaIndex::new(&columns, &redactor, connection.allowed_schemas());
        let widgets = dashboard["widgets"].as_array().cloned().unwrap_or_default();
        let mut out = Vec::new();
        if !variables.is_empty() {
            let shown: Vec<String> = variables
                .iter()
                .map(|v| {
                    let name = v["name"].as_str().unwrap_or("");
                    format!(
                        "{name}='{}'",
                        builder::variable_value(&variables, &values, name).unwrap_or_default()
                    )
                })
                .collect();
            out.push(format!("Variablen: {}", shown.join(", ")));
        }
        let (mut ok, mut failed) = (0, 0);
        for (position, widget) in widgets.iter().enumerate() {
            if only.is_some_and(|i| i != position) {
                continue;
            }
            let title = widget_title(&dashboard, widget);
            let chart = widget["chart"].as_str().unwrap_or("");
            let Some(dataset) = dataset_of(&dashboard, widget) else {
                failed += 1;
                out.push(format!("✗ '{title}' ({chart}): kein Datensatz"));
                continue;
            };
            let (sql, mut mapping) = dataset_query(dataset, connection.kind, &variables, &values);
            let shape_problem = kind(chart)
                .ok()
                .and_then(|k| check_shape(k, &shape_of(dataset), "all").err());
            let result = match server::check_read_sql(sql.trim(), connection, &index) {
                Ok(()) => self.run_sql(config, connection, sql.trim()).await,
                Err(e) => Err(e),
            };
            match result {
                Ok(result) => {
                    let mut notes = Vec::new();
                    let mapping_problem = mapping
                        .resolve(&result.columns, &mut notes)
                        .and_then(|()| check_numeric(&result, &mapping.metrics))
                        .and_then(|()| match kind(chart) {
                            Ok(k) => check_trend(k, &result, &mapping),
                            Err(_) => Ok(()),
                        })
                        .err();
                    let problems: Vec<String> =
                        shape_problem.into_iter().chain(mapping_problem).collect();
                    if problems.is_empty() {
                        ok += 1;
                    } else {
                        failed += 1;
                    }
                    out.push(format!(
                        "{} '{title}' ({chart}, id {}): {} Zeilen{}\n{}",
                        if problems.is_empty() { "✓" } else { "✗" },
                        widget["id"].as_str().unwrap_or(""),
                        result.rows.len(),
                        if problems.is_empty() {
                            String::new()
                        } else {
                            format!(" · {}", problems.join("; "))
                        },
                        indent(&server::format_result(&result, config, &redactor, limit))
                    ));
                }
                Err(error) => {
                    failed += 1;
                    out.push(format!(
                        "✗ '{title}' ({chart}, id {}): {error}",
                        widget["id"].as_str().unwrap_or("")
                    ));
                }
            }
        }
        out.insert(0, format!("{ok} ok, {failed} mit Problemen"));
        Ok(server::cap(out.join("\n"), config.max_chars))
    }

    async fn run_preview(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        sql: &str,
        mapping: &mut Mapping,
        limit: usize,
    ) -> Result<String, String> {
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let columns = self.columns_for(config, connection).await?;
        let index = redact::SchemaIndex::new(&columns, &redactor, connection.allowed_schemas());
        let sql = sql
            .trim()
            .trim_end_matches(|c: char| c == ';' || c.is_whitespace());
        server::check_read_sql(sql, connection, &index)?;
        let result = self.run_sql(config, connection, sql).await?;
        let mut notes = Vec::new();
        let mut checks = Vec::new();
        if let Err(e) = mapping.resolve(&result.columns, &mut notes) {
            checks.push(e);
        } else if let Err(e) = check_numeric(&result, &mapping.metrics) {
            checks.push(e);
        }
        checks.extend(notes);
        let mut text = server::format_result(&result, config, &redactor, limit);
        text.push_str(&format!(
            "\nMapping: {}",
            if checks.is_empty() {
                "ok".to_string()
            } else {
                checks.join("; ")
            }
        ));
        Ok(server::cap(text, config.max_chars))
    }
}

struct Mapping {
    dimension: Option<String>,
    dimension2: Option<String>,
    metrics: Vec<String>,
    date_column: Option<String>,
}

impl Mapping {
    fn from(value: &Value) -> Self {
        Self {
            dimension: text(value, "dimension").map(str::to_string),
            dimension2: text(value, "dimension2").map(str::to_string),
            metrics: strings(&value["metrics"]),
            date_column: text(value, "dateColumn").map(str::to_string),
        }
    }

    fn shape(&self) -> Shape {
        Shape {
            dimension: self.dimension.clone(),
            dimension2: self.dimension2.clone(),
            metrics: self.metrics.clone(),
            date: self.date_column.is_some(),
            timed: self.dimension.is_some(),
        }
    }

    fn resolve(&mut self, columns: &[String], notes: &mut Vec<String>) -> Result<(), String> {
        let fix = |name: &mut String, notes: &mut Vec<String>| -> Result<(), String> {
            if columns.contains(name) {
                return Ok(());
            }
            let matches: Vec<&String> = columns
                .iter()
                .filter(|c| c.eq_ignore_ascii_case(name))
                .collect();
            if let [only] = matches.as_slice() {
                notes.push(format!("'{name}' als '{only}' übernommen"));
                *name = (*only).clone();
                return Ok(());
            }
            Err(format!(
                "Spalte '{name}' fehlt im Ergebnis. Spalten: {}",
                columns.join(", ")
            ))
        };
        for name in [
            &mut self.dimension,
            &mut self.dimension2,
            &mut self.date_column,
        ]
        .into_iter()
        .flatten()
        {
            fix(name, notes)?;
        }
        for name in &mut self.metrics {
            fix(name, notes)?;
        }
        let mut seen = std::collections::HashSet::new();
        if let Some(dup) = self.metrics.iter().find(|m| !seen.insert(m.as_str())) {
            return Err(format!("metrics enthält '{dup}' doppelt."));
        }
        Ok(())
    }

    fn needs_inference(&self, kind: &Kind) -> bool {
        (self.metrics.is_empty() && kind.metrics.0 > 0)
            || (self.dimension.is_none() && matches!(kind.dim, "required" | "two"))
            || (self.dimension2.is_none() && kind.dim == "two")
    }

    fn uses(&self, column: &str) -> bool {
        [&self.dimension, &self.dimension2, &self.date_column]
            .into_iter()
            .any(|name| name.as_deref() == Some(column))
            || self.metrics.iter().any(|metric| metric == column)
    }

    fn infer(&mut self, kind: &Kind, result: &QueryResult, notes: &mut Vec<String>) {
        let numeric_column = |column: &str| {
            let mut values = column_values(result, column)
                .filter(|value| !value.is_null())
                .peekable();
            values.peek().is_some() && values.all(numeric)
        };
        let mut free: Vec<&String> = result
            .columns
            .iter()
            .filter(|column| !self.uses(column))
            .collect();
        let take_category = |free: &mut Vec<&String>| {
            let at = free
                .iter()
                .position(|column| !numeric_column(column))
                .or((!free.is_empty()).then_some(0))?;
            Some(free.remove(at).clone())
        };
        let mut filled = Vec::new();
        if matches!(kind.dim, "required" | "two") && self.dimension.is_none() {
            self.dimension = self
                .date_column
                .clone()
                .or_else(|| take_category(&mut free));
            filled.extend(self.dimension.as_ref().map(|c| format!("dimension={c}")));
        }
        if kind.dim == "two" && self.dimension2.is_none() {
            self.dimension2 = take_category(&mut free);
            filled.extend(self.dimension2.as_ref().map(|c| format!("dimension2={c}")));
        }
        if self.metrics.is_empty() && kind.metrics.0 > 0 {
            self.metrics = free
                .into_iter()
                .filter(|column| numeric_column(column))
                .take(kind.metrics.1)
                .cloned()
                .collect();
            if !self.metrics.is_empty() {
                filled.push(format!("metrics={}", self.metrics.join(",")));
            }
        }
        if !filled.is_empty() {
            notes.push(format!("Mapping ergänzt: {}", filled.join(", ")));
        }
    }
}

fn column_values<'a>(result: &'a QueryResult, column: &'a str) -> impl Iterator<Item = &'a Value> {
    let index = result.columns.iter().position(|c| c == column);
    result
        .rows
        .iter()
        .take(200)
        .filter_map(move |row| match row {
            Value::Object(map) => map.get(column),
            Value::Array(list) => index.and_then(|i| list.get(i)),
            _ => None,
        })
}

fn numeric(value: &Value) -> bool {
    match value {
        Value::Null | Value::Number(_) => true,
        Value::String(s) => s.trim().parse::<f64>().is_ok(),
        _ => false,
    }
}

fn check_numeric(result: &QueryResult, metrics: &[String]) -> Result<(), String> {
    for metric in metrics {
        if let Some(value) = column_values(result, metric).find(|value| !numeric(value)) {
            return Err(format!(
                "metric '{metric}' ist nicht numerisch (Wert {}). In SQL casten oder als dimension nutzen.",
                value.to_string().chars().take(40).collect::<String>()
            ));
        }
    }
    Ok(())
}

fn distinct(result: &QueryResult, column: Option<&String>, chars: usize) -> usize {
    column.map_or(0, |column| {
        column_values(result, column)
            .map(|value| match value {
                Value::String(text) => text.chars().take(chars).collect(),
                other => other.to_string(),
            })
            .collect::<std::collections::HashSet<String>>()
            .len()
    })
}

fn check_trend(kind: &Kind, result: &QueryResult, mapping: &Mapping) -> Result<(), String> {
    let time = mapping.dimension.as_ref().or(mapping.date_column.as_ref());
    if kind.name != "kpi" || time.is_none() || result.rows.is_empty() {
        return Ok(());
    }
    if distinct(result, time, 10) >= 2 {
        return Ok(());
    }
    Err(format!(
        "'kpi' braucht einen Verlauf, das Ergebnis hat aber nur einen Zeitpunkt in '{}'. Liefere eine Zeile pro Tag/Woche/Monat (GROUP BY über die Zeitspalte) statt eines vorab berechneten Gesamt- oder Durchschnittswerts; die Kopfzahl rechnet l8db selbst (für Durchschnitte options.headline 'average').",
        time.map(String::as_str).unwrap_or_default()
    ))
}

fn crowding(kind: &Kind, result: &QueryResult, mapping: &Mapping) -> Vec<String> {
    let series = distinct(result, mapping.dimension2.as_ref(), usize::MAX);
    match kind.name {
        "column" | "line" | "area" | "radar" if series > 8 => vec![format!(
            "dimension2 hat {series} Werte: Die App zeigt die 7 größten als eigene Serie und fasst den Rest zu „Weitere“ zusammen. Besser in SQL auf die wichtigsten Gruppen begrenzen."
        )],
        "sankey" => {
            let nodes = series.max(distinct(result, mapping.dimension.as_ref(), usize::MAX));
            if nodes > 12 {
                vec![format!(
                    "{nodes} Knoten auf einer Seite: Fluss zeigt je Seite nur so viele, wie in die Kartenhöhe passen, der Rest wird zu „Weitere“. Besser auf die wichtigsten Quellen/Ziele begrenzen oder die Karte höher machen."
                )]
            } else {
                Vec::new()
            }
        }
        _ => Vec::new(),
    }
}

fn values_of(args: &Value) -> Map<String, Value> {
    args["values"].as_object().cloned().unwrap_or_default()
}

fn dataset_query(
    dataset: &Value,
    kind: crate::db::DatabaseKind,
    variables: &[Value],
    values: &Map<String, Value>,
) -> (String, Mapping) {
    if dataset["mode"] == "expert" {
        return (
            builder::substitute(
                dataset["sql"].as_str().unwrap_or(""),
                variables,
                values,
                kind,
            ),
            Mapping::from(&dataset["mapping"]),
        );
    }
    let shape = shape_of(dataset);
    (
        builder::builder_sql(&dataset["simple"], kind, variables, values),
        Mapping {
            dimension: shape.dimension,
            dimension2: shape.dimension2,
            metrics: shape.metrics,
            date_column: None,
        },
    )
}

fn check_variables(used: &[String], variables: &[Value]) -> Result<(), String> {
    match used
        .iter()
        .find(|name| !variables.iter().any(|v| v["name"] == name.as_str()))
    {
        Some(name) => Err(format!(
            "Variable {{{{{name}}}}} ist nicht definiert. Erst mit variables anlegen (create/update)."
        )),
        None => Ok(()),
    }
}

fn push(dashboard: &mut Value, key: &str, value: Value) {
    if let Some(list) = dashboard[key].as_array_mut() {
        list.push(value);
    }
}

fn prune(dashboard: &mut Value) {
    let used: Vec<Value> = dashboard["widgets"]
        .as_array()
        .map(|list| list.iter().map(|w| w["datasetId"].clone()).collect())
        .unwrap_or_default();
    if let Some(list) = dashboard["datasets"].as_array_mut() {
        list.retain(|d| used.contains(&d["id"]));
    }
}

fn indent(text: &str) -> String {
    text.lines()
        .map(|line| format!("  {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn check_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("name fehlt.".into());
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("name ist länger als {MAX_NAME_CHARS} Zeichen."));
    }
    Ok(name.to_string())
}

fn refresh(args: &Value) -> Result<Option<u64>, String> {
    match args.get("refreshSec") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => match value.as_u64() {
            Some(n) if n == 0 || (10..=86_400).contains(&n) => Ok(Some(n)),
            _ => Err(REFRESH_HINT.into()),
        },
    }
}

fn list(config: &McpConfig, args: &Value) -> Result<String, String> {
    let filter = match text(args, "connection") {
        Some(target) => Some(sql_connection(config, target)?.id.clone()),
        None => None,
    };
    let lines: Vec<String> = read_all()
        .into_iter()
        .filter_map(|(value, _)| {
            let connection = dashboard_connection(config, &value)?;
            if filter.as_ref().is_some_and(|id| *id != connection.id) {
                return None;
            }
            Some(format!(
                "{}\t{}\t{}\t{}\t{}",
                value["id"].as_str().unwrap_or(""),
                value["name"].as_str().unwrap_or(""),
                connection.name,
                value["widgets"].as_array().map_or(0, Vec::len),
                value["refreshSec"].as_u64().unwrap_or(0)
            ))
        })
        .collect();
    if lines.is_empty() {
        return Ok("Keine MCP-Dashboards. action=create legt eins an.".into());
    }
    Ok(server::cap(
        format!(
            "id\tname\tconnection\tcharts\trefreshSec\n{}",
            lines.join("\n")
        ),
        config.max_chars,
    ))
}

fn describe(dashboard: &Value, connection: &McpConnection) -> String {
    let charts: Vec<Value> = dashboard["widgets"]
        .as_array()
        .map(|list| {
            list.iter()
                .map(|w| Value::Object(flatten(dashboard, w)))
                .collect()
        })
        .unwrap_or_default();
    let out = json!({
        "id": dashboard["id"],
        "name": dashboard["name"],
        "connection": connection.name,
        "refreshSec": dashboard["refreshSec"],
        "variables": variables_of(dashboard),
        "design": dashboard["design"],
        "charts": charts,
    });
    serde_json::to_string_pretty(&out).unwrap_or_default()
}

fn chart_types() -> String {
    let mut lines = vec![
        "Mapping names columns of the chart's SQL result. dimension = category or x-axis (ORDER BY it for time series), dimension2 = second category, metrics = numeric columns, dateColumn = date column that the period filter (7d, 30d, 90d, quarter, year, 12m) applies to. subtitle = line under the title.".to_string(),
        "Options (booleans unless noted): showValue headline number, showDelta trend badge, showPeriod period picker, colorOffset 0-7 start color, compare none|previous|year comparison period (default previous, needs dateColumn and period != all), headline auto|total|last|average|max|min value of the big number, unit text of 1-8 chars after values, decimals 0-4 (default auto), invertDelta lower is better (a falling value shows green), showLegend, stacked, curve monotone|linear, showGrid, labels values on chart, showPercent, sortBy none|asc|desc (by first metric), horizontal bars to the right (column), metricKeys subset of metrics to show.".to_string(),
        "Builder (spec.builder instead of sql, editable in the app): {table, schema?, joins?: [{table, as?, on: \"artikel_id = id AND mandant = mandant\" (left side = parent table, right side = joined table), kind: left|inner, from?: alias of an earlier join for chains}], fields?: [{name, expr, type?: number|text|date, aggregate?}], dimension?: field or {field, bucket: none|day|week|month|quarter|year}, dimension2?, metrics: [\"count\" | \"sum(menge)\" | \"count_distinct(artikel.id)\" | \"<field name>\" | {agg, field, label}], filters?: [{field, op: eq|neq|gt|gte|lt|lte|contains|startsWith|endsWith|in|notIn|isNull|isNotNull, value}], dateColumn?, sort?: dimension|metric_desc|metric_asc, limit?}. Fields are referenced as column (base table), alias.column (joined table, alias defaults to the table name) or the name of a calculated field. In fields.expr write SQL of the connection with [column] / [alias.column] placeholders, e.g. sum([menge]) / nullif(sum([artikel.palettenfaktor]), 0); expressions with sum/avg/count/... are aggregates and become metrics as they are. Result columns are dim, dim2, m0, m1, ... A bare field name in metrics means the raw value (agg none), useful for table charts. Unsure how tables relate? action=joins suggests join columns with measured match rate; every saved join reports its match rate and warns when it multiplies rows. update_chart merges spec.builder into the existing builder, so send only the keys you change (e.g. joins, filters, fields).".to_string(),
        "Variables (create/update variables): [{name, label, type: select|text|number|date, default, options | optionsSql}]. They appear as filter controls above the dashboard. Use {{name}} in sql (replaced by a typed literal, empty = NULL, so write ({{mandant}} IS NULL OR mandant = {{mandant}})) and as builder filter value {\"field\": \"mandant\", \"op\": \"eq\", \"value\": \"{{mandant}}\"} (skipped while empty) or inside fields.expr. preview/run take values: {name: value}.".to_string(),
        "Design (professional dashboards):".to_string(),
        "- Layout: 2-4 kpi tiles on top, then one wide trend (area/line, w 8) next to a part-of-whole or ranking (donut with <= 6 categories or bars, w 4), then details (column, bars, table). A kpi always shows a sparkline and a trend %, never a bare number, so it needs a time dimension or a dateColumn: time dimension bucketed by day/week/month (ORDER BY it) → big number is the latest value; no dimension + dateColumn → big number is the period total, the sparkline groups by dateColumn (return rows per date, not one sum row). Add a period for the comparison. Call action=arrange after adding charts, then action=run to check plausibility.".to_string(),
        "- Labels: column aliases become legend and axis labels, so alias metrics with readable names in the user's language (SUM(amount) AS \"Umsatz\"). Give every chart a title and a subtitle that says what is measured (\"Summe pro Monat\", \"Anzahl Bestellungen\").".to_string(),
        "- Units: set options.unit (\"€\", \"%\", \"ms\", \"Stk.\") and decimals where it helps; never encode units in titles only. Set invertDelta for metrics where lower is better (costs, latency, cancellations).".to_string(),
        "- Comparison: set dateColumn and a period (7d, 30d, 90d, quarter, year, 12m) so charts compare against the previous period (options.compare previous|year|none, default previous). options.headline picks the big number (auto|total|last|average|max|min): average for averages, last for current state values (stock level, latency).".to_string(),
        "- Categories: keep them few (donut/funnel <= 6, bars <= 12) and fold the rest into \"Sonstige\" in SQL. ORDER BY the date dimension for time series.".to_string(),
        "- Colors: leave colorOffset alone; single-series charts use the connection accent, multi-series charts use a validated palette in fixed order.".to_string(),
        "Grid: 12 columns, row height ~44px. type\tdimension\tmetrics\tdefault w x h\toptions\thint".to_string(),
    ];
    for kind in KINDS {
        let (min, max) = kind.metrics;
        lines.push(format!(
            "{}\t{}\t{}\t{}x{}\t{}\t{}",
            kind.name,
            kind.dim,
            if min == max {
                min.to_string()
            } else {
                format!("{min}-{max}")
            },
            kind.size.0,
            kind.size.1,
            kind.options.replace(' ', ","),
            kind.hint
        ));
    }
    lines.join("\n")
}

#[cfg(test)]
#[path = "dashboard_tests.rs"]
mod tests;
