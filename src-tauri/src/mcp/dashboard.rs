use serde_json::{json, Map, Value};
use std::collections::hash_map::{DefaultHasher, RandomState};
use std::hash::{BuildHasher, Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use super::config::{self, McpConfig, McpConnection};
use super::redact::{self, Redactor};
use super::server::{self, Server, SQL_KINDS};
use crate::db::QueryResult;

const GRID_COLS: i64 = 12;
const MAX_H: i64 = 40;
const MAX_Y: i64 = 1000;
const MAX_CHARTS: usize = 60;
const MAX_SQL_CHARS: usize = 20_000;
const MAX_NAME_CHARS: usize = 120;
const PERIODS: &[&str] = &["all", "7d", "30d", "90d", "quarter", "year"];
const REFRESH_HINT: &str = "refreshSec muss 0 (aus) oder 10 bis 86400 sein";
const SERIES_KINDS: &[&str] = &["column", "line", "area", "radar", "sankey", "heatmap"];
const DATA_KEYS: &[&str] = &["sql", "dimension", "dimension2", "metrics", "dateColumn"];
const SPEC_KEYS: &[&str] = &[
    "type",
    "title",
    "sql",
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

struct Kind {
    name: &'static str,
    dim: &'static str,
    metrics: (usize, usize),
    size: (i64, i64),
    options: &'static str,
    hint: &'static str,
}

const KINDS: &[Kind] = &[
    Kind { name: "kpi", dim: "optional", metrics: (1, 1), size: (3, 4), options: "showValue showDelta showPeriod colorOffset curve", hint: "Big number. Without dimension: first row's metric. With a time dimension (ordered): sum plus sparkline and trend vs. previous row." },
    Kind { name: "area", dim: "required", metrics: (1, 6), size: (6, 7), options: "showValue showDelta showPeriod colorOffset showLegend stacked curve showGrid", hint: "Filled areas over the dimension (usually time). dimension2 splits into series." },
    Kind { name: "line", dim: "required", metrics: (1, 6), size: (6, 7), options: "showValue showDelta showPeriod colorOffset showLegend curve showGrid labels", hint: "One line per metric over the dimension. dimension2 splits into series." },
    Kind { name: "column", dim: "required", metrics: (1, 6), size: (6, 7), options: "showValue showDelta showPeriod colorOffset showLegend stacked showGrid labels sortBy", hint: "Vertical columns per category. Several metrics or dimension2 give grouped/stacked columns." },
    Kind { name: "bars", dim: "required", metrics: (1, 1), size: (4, 8), options: "showValue showDelta showPeriod colorOffset showLegend showPercent sortBy", hint: "Horizontal bars with share of total (ranking, pipeline)." },
    Kind { name: "funnel", dim: "required", metrics: (1, 1), size: (6, 7), options: "showValue showDelta showPeriod colorOffset showLegend showPercent sortBy", hint: "Funnel stages in row order with conversion percent." },
    Kind { name: "donut", dim: "required", metrics: (1, 1), size: (4, 8), options: "showValue showDelta showPeriod colorOffset showLegend showPercent sortBy", hint: "Shares of a whole as ring. Keep categories below ~8." },
    Kind { name: "rings", dim: "required", metrics: (1, 1), size: (4, 9), options: "showValue showDelta showPeriod colorOffset showLegend sortBy", hint: "Concentric rings per category, relative to the largest." },
    Kind { name: "radar", dim: "required", metrics: (1, 3), size: (4, 9), options: "showValue showDelta showPeriod colorOffset showLegend sortBy", hint: "Spider net, one axis per category, one polygon per metric or dimension2 value." },
    Kind { name: "scatter", dim: "optional", metrics: (2, 3), size: (6, 8), options: "showValue showDelta showPeriod colorOffset showLegend showGrid", hint: "Bubbles: metrics are x, y and optional size; dimension colors groups." },
    Kind { name: "sankey", dim: "two", metrics: (1, 1), size: (6, 9), options: "showValue showDelta showPeriod colorOffset", hint: "Flows from dimension (source) to dimension2 (target) weighted by the metric." },
    Kind { name: "score", dim: "required", metrics: (2, 2), size: (4, 7), options: "showValue showDelta showPeriod colorOffset showLegend", hint: "Achieved vs. maximum points per category: metrics = [value, max]." },
    Kind { name: "gauge", dim: "none", metrics: (2, 2), size: (3, 5), options: "showValue showDelta showPeriod colorOffset", hint: "Half-circle gauge: metrics = [value, target], summed over all rows." },
    Kind { name: "treemap", dim: "required", metrics: (1, 1), size: (6, 7), options: "showValue showDelta showPeriod colorOffset showLegend labels sortBy", hint: "Rectangles sized by the metric per category." },
    Kind { name: "heatmap", dim: "two", metrics: (1, 1), size: (6, 7), options: "showValue showDelta showPeriod colorOffset labels", hint: "Matrix dimension (rows) x dimension2 (columns), colored by the metric." },
    Kind { name: "table", dim: "optional", metrics: (0, 6), size: (6, 7), options: "showValue showPeriod", hint: "Raw result rows as table; mapping is optional." },
];

fn kind(name: &str) -> Result<&'static Kind, String> {
    KINDS.iter().find(|kind| kind.name == name).ok_or_else(|| {
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
            "sql": {"type": "string", "description": "One read-only SELECT. Column aliases are the names used by the mapping fields."},
            "dimension": nullable("Result column for categories / x-axis"),
            "dimension2": nullable("Second category column: series split (column, line, area, radar), target (sankey), columns (heatmap)"),
            "metrics": {"type": "array", "items": {"type": "string"}, "description": "Numeric result columns"},
            "dateColumn": nullable("Date result column; enables the period filter"),
            "period": {"type": "string", "enum": PERIODS},
            "options": {"type": "object", "description": "Display options per type, see chart_types. null removes an option."},
            "x": {"type": "integer", "minimum": 0},
            "y": {"type": "integer", "minimum": 0},
            "w": {"type": "integer", "minimum": 2, "maximum": GRID_COLS},
            "h": {"type": "integer", "minimum": 3, "maximum": MAX_H}
        }
    });
    json!({
        "name": "dashboard",
        "description": "Build dashboards that appear live in the l8db app (Dashboard view of the connection). Each chart has its own read-only SQL plus a mapping of result columns (dimension, dimension2, metrics, dateColumn). Charts are validated by running the SQL, so fix reported errors and retry. Actions: list, get, create (connection, name, charts), update (name, refreshSec), delete, add_charts (charts), update_chart (chart + spec with changed fields only), remove_chart, preview (dashboard+chart or connection+spec, shows rows), chart_types (chart types, mapping rules, options). Layout is a 12-column grid; omit x/y for automatic placement.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "get", "create", "update", "delete", "add_charts", "update_chart", "remove_chart", "preview", "chart_types"]},
                "connection": {"type": "string", "description": "Connection name or id (create, list filter, preview without dashboard)"},
                "dashboard": {"type": "string", "description": "Dashboard id or name"},
                "name": {"type": "string"},
                "refreshSec": {"type": "integer", "description": "Auto refresh in seconds, 0 = off"},
                "chart": {"type": "string", "description": "Chart id or title"},
                "limit": {"type": "integer", "minimum": 1, "description": "Preview rows, default 20"},
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

#[tauri::command]
pub fn mcp_dashboards() -> Vec<Value> {
    read_all()
        .into_iter()
        .map(|(mut value, stamp)| {
            value["stamp"] = json!(stamp);
            value
        })
        .collect()
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
    write(&json!({
        "id": id,
        "connectionId": connection_id,
        "name": dashboard["name"].as_str().unwrap_or("Dashboard"),
        "refreshSec": dashboard["refreshSec"].as_u64().unwrap_or(0),
        "createdAt": created,
        "datasets": dashboard["datasets"],
        "widgets": dashboard["widgets"],
    }))
}

#[tauri::command]
pub fn mcp_dashboard_delete(id: String) -> Result<(), String> {
    remove_file(&id)
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
}

fn shape_of(dataset: &Value) -> Shape {
    if dataset["mode"] == "expert" {
        let mapping = &dataset["mapping"];
        return Shape {
            dimension: text(mapping, "dimension").map(str::to_string),
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
    Shape {
        dimension: simple["dimension"]["column"]
            .as_str()
            .map(|_| "dim".to_string()),
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
    for (key, value) in patch {
        if value.is_null() {
            options.remove(&key);
            continue;
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
    match dataset {
        Some(dataset) if dataset["mode"] == "expert" => {
            let mapping = &dataset["mapping"];
            out.insert("sql".into(), dataset["sql"].clone());
            for key in ["dimension", "dimension2", "metrics", "dateColumn"] {
                out.insert(key.into(), mapping[key].clone());
            }
        }
        Some(dataset) => {
            out.insert("builder".into(), dataset["simple"].clone());
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

fn spec_object(value: &Value) -> Result<&Map<String, Value>, String> {
    let map = value
        .as_object()
        .ok_or("Chart-Spezifikation muss ein Objekt sein.")?;
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
            "update" | "delete" | "add_charts" | "update_chart" | "remove_chart" => {
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
        });
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
                .build(config, connection, spec, None, &others)
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
        let (dataset, shape) = if data_change {
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
                "Chart nutzt den Baukasten der App. Zum Umstellen auf SQL sql mitgeben."
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
            let shape = mapping.shape();
            check_shape(kind, &shape, &period)?;
            let (sql, rows) = self
                .check_sql(config, connection, &sql, &mut mapping, &mut notes)
                .await?;
            preview = rows;
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
        let dataset_id = dataset
            .as_ref()
            .map(|d| d["id"].clone())
            .or_else(|| base_widget.map(|w| w["datasetId"].clone()))
            .unwrap_or(Value::Null);
        let id = base_widget
            .and_then(|w| w["id"].as_str())
            .map(str::to_string)
            .unwrap_or_else(new_id);
        let widget = json!({
            "id": id,
            "chart": kind.name,
            "datasetId": dataset_id,
            "title": title,
            "period": period,
            "options": options,
            "x": x, "y": y, "w": w, "h": h,
        });
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
        sql: &str,
        mapping: &mut Mapping,
        notes: &mut Vec<String>,
    ) -> Result<(String, String), String> {
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
        let redactor = Redactor::new(&config.redaction, &connection.redact_columns);
        let columns = self.columns_for(config, connection).await?;
        let index = redact::SchemaIndex::new(&columns, &redactor, &connection.schemas);
        server::check_read_sql(&sql, connection, &index)?;
        let result = self.run_sql(config, connection, &sql).await?;
        mapping.resolve(&result.columns, notes)?;
        check_numeric(&result, &mapping.metrics)?;
        if result.rows.is_empty() {
            notes.push("Ergebnis ist aktuell leer".into());
        } else if result.rows.len() > 500 {
            notes.push(format!(
                "{} Zeilen, GROUP BY/LIMIT empfohlen",
                result.rows.len()
            ));
        }
        Ok((sql, server::format_result(&result, config, &redactor, 3)))
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
                if changed.is_empty() {
                    return Err("update braucht name und/oder refreshSec.".into());
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
                        spec,
                        Some((&widget, base.as_ref())),
                        &others,
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
            let dataset = dataset_of(&dashboard, widget)
                .filter(|d| d["mode"] == "expert")
                .ok_or("Chart nutzt den Baukasten der App, Vorschau nur für SQL-Charts.")?;
            let sql = dataset["sql"].as_str().unwrap_or("").to_string();
            let mut mapping = Mapping::from(&dataset["mapping"]);
            return self
                .run_preview(config, connection, &sql, &mut mapping, limit)
                .await;
        }
        let connection = sql_connection(config, server::arg_str(args, "connection"))?;
        let spec = spec_object(args.get("spec").unwrap_or(&Value::Null))?;
        let sql = optional_text(spec, "sql")?.ok_or("spec.sql fehlt.")?;
        let mut mapping = Mapping {
            dimension: optional_text(spec, "dimension")?,
            dimension2: optional_text(spec, "dimension2")?,
            metrics: strings(spec.get("metrics").unwrap_or(&Value::Null)),
            date_column: optional_text(spec, "dateColumn")?,
        };
        let mut problems = Vec::new();
        if let Some(name) = optional_text(spec, "type")? {
            let kind = kind(&name)?;
            let period = optional_text(spec, "period")?.unwrap_or_else(|| "all".into());
            if let Err(e) = check_shape(kind, &mapping.shape(), &period) {
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

    async fn run_preview(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        sql: &str,
        mapping: &mut Mapping,
        limit: usize,
    ) -> Result<String, String> {
        let redactor = Redactor::new(&config.redaction, &connection.redact_columns);
        let columns = self.columns_for(config, connection).await?;
        let index = redact::SchemaIndex::new(&columns, &redactor, &connection.schemas);
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
}

fn check_numeric(result: &QueryResult, metrics: &[String]) -> Result<(), String> {
    for metric in metrics {
        let index = result.columns.iter().position(|c| c == metric);
        let bad = result.rows.iter().take(200).find_map(|row| {
            let value = match row {
                Value::Object(map) => map.get(metric).cloned(),
                Value::Array(list) => index.and_then(|i| list.get(i).cloned()),
                _ => None,
            }?;
            match &value {
                Value::Null | Value::Number(_) => None,
                Value::String(s) if s.trim().parse::<f64>().is_ok() => None,
                other => Some(other.to_string()),
            }
        });
        if let Some(value) = bad {
            return Err(format!(
                "metric '{metric}' ist nicht numerisch (Wert {}). In SQL casten oder als dimension nutzen.",
                value.chars().take(40).collect::<String>()
            ));
        }
    }
    Ok(())
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
        "charts": charts,
    });
    serde_json::to_string_pretty(&out).unwrap_or_default()
}

fn chart_types() -> String {
    let mut lines = vec![
        "Mapping names columns of the chart's SQL result. dimension = category or x-axis (ORDER BY it for time series), dimension2 = second category, metrics = numeric columns, dateColumn = date column that the period filter (7d, 30d, 90d, quarter, year) applies to.".to_string(),
        "Options (booleans unless noted): showValue headline number, showDelta trend badge, showPeriod period picker, colorOffset 0-7 start color, showLegend, stacked, curve monotone|linear, showGrid, labels values on chart, showPercent, sortBy none|asc|desc (by first metric), metricKeys subset of metrics to show.".to_string(),
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
