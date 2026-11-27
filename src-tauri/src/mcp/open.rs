use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::config::{self, McpConfig, McpConnection};
use super::redact::Redactor;
use super::redact::SchemaIndex;
use super::server::{
    adapter, arg_str, check_read_sql, find_connection, run, with_database, Server,
};
use crate::db::{self, datagen::qualified, validate_table_filter_in, DatabaseKind};

const MAX_AGE_MS: u128 = 60_000;
const MAX_SPLIT: usize = 3;
const TEST_ROWS: usize = 20;
const TEST_MASTERS: usize = 3;
const AUTO_REFRESH_SECONDS: [u64; 4] = [0, 5, 15, 30];

fn auto_refresh_arg() -> Value {
    json!({"type": "integer", "enum": AUTO_REFRESH_SECONDS, "description": "Auto-refresh seconds, 0 off; table only"})
}

pub fn tool_definition() -> Value {
    json!({
        "name": "open",
        "description": "Show in the user's l8db window: a table (filter, saved view, auto-refresh), SQL in a new editor tab (not run), or a split view of tables/SQL with master-detail links. Only when asked; use query for answers.",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": super::server::database_arg(),
            "table": {"type": "string"},
            "filter": {"type": "string", "description": "WHERE condition; empty clears"},
            "saveAs": {"type": "string", "description": "View name, only when asked"},
            "sql": {"type": "string"},
            "autoRefresh": auto_refresh_arg(),
            "split": {"type": "array", "maxItems": MAX_SPLIT, "description": "Extra panes, numbered 2.. in order", "items": {"type": "object", "properties": {
                "table": {"type": "string"},
                "sql": {"type": "string"},
                "filter": {"type": "string"},
                "autoRefresh": {"type": "integer", "enum": AUTO_REFRESH_SECONDS},
                "master": {"type": "integer", "description": "Earlier pane whose selected row drives this one"},
                "link": {"type": "string", "description": "Detail SELECT using :master.COLUMN; omit for table panes (foreign key) or sql using :master.COLUMN"}
            }}},
            "orientation": {"type": "string", "enum": ["horizontal", "vertical"]},
            "test": {"type": "boolean", "description": "Dry run, opens nothing: runs each pane and its link with the first master rows; returns rows, columns, errors. Use before opening master-detail"}
        }}
    })
}

pub(crate) fn gated(mut tools: Vec<Value>, config: &McpConfig) -> Vec<Value> {
    if !config.test_views {
        for tool in tools.iter_mut().filter(|tool| tool["name"] == "open") {
            if let Some(properties) = tool["inputSchema"]["properties"].as_object_mut() {
                properties.remove("test");
            }
        }
    }
    tools
}

fn queue_path() -> PathBuf {
    config::config_path().with_file_name("mcp-open.jsonl")
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

fn push(request: Value) -> Result<(), String> {
    let path = queue_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{request}").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mcp_take_open_requests() -> Vec<Value> {
    let path = queue_path();
    let taken = path.with_extension(format!("{}.take", std::process::id()));
    if fs::rename(&path, &taken).is_err() {
        return Vec::new();
    }
    let text = fs::read_to_string(&taken).unwrap_or_default();
    let _ = fs::remove_file(&taken);
    let fresh = now_ms().saturating_sub(MAX_AGE_MS);
    text.lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|request| request["at"].as_u64().is_some_and(|at| at as u128 >= fresh))
        .collect()
}

fn auto_refresh(args: &Value) -> Result<Option<u64>, String> {
    match args.get("autoRefresh") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .filter(|seconds| AUTO_REFRESH_SECONDS.contains(seconds))
            .map(Some)
            .ok_or_else(|| "autoRefresh muss 0, 5, 15 oder 30 sein.".into()),
    }
}

fn clean_filter(filter: &str, kind: DatabaseKind) -> Result<String, String> {
    let filter = filter.trim();
    let filter = filter
        .get(..6)
        .filter(|head| head.eq_ignore_ascii_case("where "))
        .map_or(filter, |_| filter[6..].trim());
    validate_table_filter_in(filter, kind != DatabaseKind::Postgres)?;
    Ok(filter.to_string())
}

fn check_link(link: &str) -> Result<(), String> {
    let head = link.trim_start().to_lowercase();
    let body = link.trim().trim_end_matches(';');
    if !(head.starts_with("select") || head.starts_with("with"))
        || body.contains(';')
        || !link.contains(":master.")
    {
        return Err("link muss ein einzelnes SELECT mit :master.SPALTE sein.".into());
    }
    Ok(())
}

struct MasterRef {
    start: usize,
    end: usize,
    column: String,
}

fn master_refs(sql: &str) -> Result<Vec<MasterRef>, String> {
    const STYLE: &str = "Verwende für Master-Spalten die Schreibweise :master.SPALTE.";
    let bytes = sql.as_bytes();
    let word = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_' || byte >= 0x80;
    let mut found = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'-' if bytes.get(i + 1) == Some(&b'-') => {
                i = sql[i..].find('\n').map_or(bytes.len(), |end| i + end);
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i = sql[i + 2..]
                    .find("*/")
                    .map_or(bytes.len(), |end| i + end + 4);
            }
            quote @ (b'\'' | b'"' | b'`') => {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == quote {
                        if bytes.get(i + 1) != Some(&quote) {
                            break;
                        }
                        i += 1;
                    }
                    i += 1;
                }
                i += 1;
            }
            b'$' => {
                let next = bytes.get(i + 1).copied().unwrap_or(0);
                let tag = bytes[i + 1..]
                    .iter()
                    .take_while(|byte| word(**byte))
                    .count();
                if next.is_ascii_digit() || next == b':' {
                    return Err(STYLE.into());
                }
                if bytes.get(i + 1 + tag) == Some(&b'$') {
                    let quote = &sql[i..i + tag + 2];
                    i = sql[i + tag + 2..]
                        .find(quote)
                        .map_or(bytes.len(), |end| i + 2 * (tag + 2) + end);
                } else {
                    i += 1;
                }
            }
            b':' if bytes.get(i + 1) == Some(&b':') => i += 2,
            b':' if i > 0 && (word(bytes[i - 1]) || matches!(bytes[i - 1], b']' | b'"' | b'`')) => {
                i += 1
            }
            b':' => {
                let name = bytes[i + 1..]
                    .iter()
                    .take_while(|byte| word(**byte))
                    .count();
                if name == 0 || bytes[i + 1].is_ascii_digit() {
                    i += 1;
                    continue;
                }
                let dot = i + 1 + name;
                if &sql[i + 1..dot] != "master" {
                    return Err(STYLE.into());
                }
                if bytes.get(dot) != Some(&b'.') {
                    return Err(
                        "Verwende :master.SPALTE für einen Wert aus der Master-Zeile.".into(),
                    );
                }
                let (column, end) = if bytes.get(dot + 1) == Some(&b'"') {
                    let mut end = dot + 2;
                    while end < bytes.len()
                        && (bytes[end] != b'"' || bytes.get(end + 1) == Some(&b'"'))
                    {
                        end += if bytes[end] == b'"' { 2 } else { 1 };
                    }
                    (
                        sql[dot + 2..end.min(bytes.len())].replace("\"\"", "\""),
                        end + 1,
                    )
                } else {
                    let length = bytes[dot + 1..]
                        .iter()
                        .take_while(|byte| word(**byte) || matches!(**byte, b'$' | b'#'))
                        .count();
                    let length = if bytes.get(dot + 1).is_some_and(u8::is_ascii_digit) {
                        0
                    } else {
                        length
                    };
                    (sql[dot + 1..dot + 1 + length].to_string(), dot + 1 + length)
                };
                if column.is_empty() || end > bytes.len() {
                    return Err("Nach :master. fehlt ein gültiger Spaltenname.".into());
                }
                if bytes.get(end) == Some(&b'.') {
                    return Err("Verwende :master.SPALTE ohne weitere Pfadsegmente.".into());
                }
                if bytes.get(end) == Some(&b'$') {
                    return Err(STYLE.into());
                }
                found.push(MasterRef {
                    start: i,
                    end,
                    column,
                });
                i = end;
            }
            _ => i += 1,
        }
    }
    Ok(found)
}

fn master_reference(column: &str) -> String {
    let plain = !column.is_empty()
        && !column.as_bytes()[0].is_ascii_digit()
        && column
            .chars()
            .all(|char| char.is_alphanumeric() || matches!(char, '_' | '$' | '#'));
    if plain {
        format!(":master.{column}")
    } else {
        format!(":master.\"{}\"", column.replace('"', "\"\""))
    }
}

struct Sample {
    columns: Vec<String>,
    rows: Vec<Value>,
}

enum Fail {
    Blocked(String),
    Broken(String),
}

impl From<String> for Fail {
    fn from(error: String) -> Self {
        Fail::Broken(error)
    }
}

fn guard(sql: &str, connection: &McpConnection, index: &SchemaIndex) -> Result<(), Fail> {
    if matches!(connection.kind, DatabaseKind::Mongodb | DatabaseKind::Redis) {
        return Err(Fail::Blocked("Der Probelauf führt nur SQL aus.".into()));
    }
    check_read_sql(sql, connection, index).map_err(Fail::Blocked)
}

fn masked(redactor: &Redactor, column: &str, value: &Value) -> bool {
    let shown = redactor.redact_cell(column, value);
    match value {
        Value::Array(_) | Value::Object(_) => shown != Value::String(value.to_string()),
        _ => shown != *value,
    }
}

#[derive(Default)]
struct Stats {
    queries: usize,
    rows: usize,
}

impl Stats {
    fn sample(&mut self, columns: Vec<String>, rows: Vec<Value>) -> Sample {
        self.rows = self.rows.max(rows.len());
        Sample { columns, rows }
    }
}

impl Sample {
    fn cell<'a>(&'a self, row: &'a Value, column: &str) -> Option<&'a Value> {
        match row {
            Value::Object(map) => map.get(column),
            Value::Array(list) => list.get(self.columns.iter().position(|name| name == column)?),
            _ => None,
        }
    }

    fn label(&self) -> String {
        let count = if self.rows.len() > TEST_ROWS {
            format!("{TEST_ROWS}+")
        } else {
            self.rows.len().to_string()
        };
        format!("{count} Zeilen; Spalten: {}", self.columns.join(", "))
    }
}

fn bind(
    sql: &str,
    refs: &[MasterRef],
    master: &Sample,
    row: &Value,
    redactor: &Redactor,
) -> Result<(String, Vec<Option<String>>), Fail> {
    let mut columns: Vec<&str> = Vec::new();
    let mut params = Vec::new();
    let mut bound = String::with_capacity(sql.len());
    let mut last = 0;
    for reference in refs {
        let column = reference.column.as_str();
        let index = match columns.iter().position(|known| *known == column) {
            Some(index) => index,
            None => {
                let value = master.cell(row, column).ok_or_else(|| {
                    format!(
                        "Die Spalte „{column}“ fehlt in der Master-Zeile. Vorhanden: {}",
                        master.columns.join(", ")
                    )
                })?;
                if masked(redactor, column, value) {
                    return Err(Fail::Blocked(format!(
                        "Die Spalte „{column}“ ist maskiert und kann im Probelauf kein Master-Wert sein."
                    )));
                }
                params.push(match value {
                    Value::Null => None,
                    Value::String(text) => Some(text.clone()),
                    other => Some(other.to_string()),
                });
                columns.push(column);
                columns.len() - 1
            }
        };
        bound += &sql[last..reference.start];
        bound += &format!("${}", index + 1);
        last = reference.end;
    }
    bound += &sql[last..];
    Ok((bound, params))
}

fn foreign_key_link(
    keys: &[db::ForeignKeyInfo],
    kind: DatabaseKind,
    master: (&str, &str),
    detail: (&str, &str),
) -> Option<String> {
    let mut groups: Vec<((bool, &str, &str, &str), Vec<String>)> = Vec::new();
    for key in keys {
        for parent in [true, false] {
            let (own, other, source, target) = if parent {
                (
                    (key.from_schema.as_str(), key.from_table.as_str()),
                    (key.to_schema.as_str(), key.to_table.as_str()),
                    &key.from_column,
                    &key.to_column,
                )
            } else {
                (
                    (key.to_schema.as_str(), key.to_table.as_str()),
                    (key.from_schema.as_str(), key.from_table.as_str()),
                    &key.to_column,
                    &key.from_column,
                )
            };
            if own != master {
                continue;
            }
            let id = (parent, key.constraint_name.as_str(), other.0, other.1);
            let condition = format!(
                "{} = {}",
                qualified(kind, "", target),
                master_reference(source)
            );
            match groups.iter_mut().find(|(known, _)| *known == id) {
                Some((_, conditions)) if !conditions.contains(&condition) => {
                    conditions.push(condition)
                }
                Some(_) => {}
                None => groups.push((id, vec![condition])),
            }
        }
    }
    groups
        .into_iter()
        .find(|((_, _, schema, table), _)| (*schema, *table) == detail)
        .map(|(_, conditions)| {
            format!(
                "SELECT * FROM {} WHERE {}{}",
                qualified(kind, detail.0, detail.1),
                conditions.join(" AND "),
                if kind == DatabaseKind::Oracle {
                    " FETCH FIRST 100 ROWS ONLY"
                } else {
                    " LIMIT 100"
                }
            )
        })
}

fn limited(kind: DatabaseKind, sql: &str) -> String {
    let body = sql.trim().trim_end_matches(';').trim_end();
    let head = body.get(..6).unwrap_or("").to_ascii_lowercase();
    let single = !body.contains(';');
    if kind == DatabaseKind::Postgres && single && (head == "select" || head.starts_with("with")) {
        format!(
            "SELECT * FROM (\n{body}\n) l8db_test LIMIT {}",
            TEST_ROWS + 1
        )
    } else {
        sql.to_string()
    }
}

fn pane_table(pane: &Value) -> Option<(&str, &str)> {
    Some((pane["schema"].as_str()?, pane["table"].as_str()?))
}

impl Server {
    async fn test_pane(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        index: &SchemaIndex,
        pane: &Value,
        stats: &mut Stats,
    ) -> Result<Sample, Fail> {
        let adapter = adapter(connection, &self.pool)?;
        stats.queries += 1;
        if let Some((schema, table)) = pane_table(pane) {
            let filter = pane["filter"].as_str().filter(|filter| !filter.is_empty());
            if let Some(filter) = filter {
                guard(
                    &format!(
                        "SELECT * FROM {} WHERE {filter}",
                        qualified(connection.kind, schema, table)
                    ),
                    connection,
                    index,
                )?;
            }
            let data = run(
                config,
                connection.kind,
                adapter.fetch_rows(
                    schema,
                    table,
                    filter,
                    TEST_ROWS as i64 + 1,
                    0,
                    None,
                    false,
                    true,
                    false,
                ),
            )
            .await?;
            return Ok(stats.sample(data.columns, data.rows));
        }
        let sql = limited(connection.kind, pane["sql"].as_str().unwrap_or(""));
        guard(&sql, connection, index)?;
        let result = db::execution::with_row_limit(
            TEST_ROWS + 1,
            run(config, connection.kind, adapter.execute_query(&sql)),
        )
        .await?;
        Ok(stats.sample(result.columns, result.rows))
    }

    async fn test_detail(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        (redactor, index): (&Redactor, &SchemaIndex),
        panes: &[Value],
        master: (usize, &Sample),
        number: usize,
        stats: &mut Stats,
    ) -> Result<(Sample, String), Fail> {
        let pane = &panes[number];
        let caps = connection.kind.capabilities();
        if caps.query_language != "sql" || !caps.bind_parameters {
            return Err(Fail::Broken(
                "Master-Detail läuft nur auf PostgreSQL, Oracle und JDBC; hier ohne master öffnen."
                    .into(),
            ));
        }
        let own = pane["sql"].as_str().unwrap_or("");
        let adapter = adapter(connection, &self.pool)?;
        let link = match pane["link"].as_str() {
            Some(link) => link.to_string(),
            None if own.contains(":master.") => own.to_string(),
            None => {
                let tables = pane_table(&panes[master.0]).zip(pane_table(pane));
                let (from, to) = tables
                    .ok_or_else(|| "Master-Detail ohne SQL braucht zwei Tabellen.".to_string())?;
                stats.queries += 1;
                let keys = run(
                    config,
                    connection.kind,
                    adapter.list_foreign_keys(from.0, from.1),
                )
                .await?;
                foreign_key_link(&keys, connection.kind, from, to).ok_or_else(|| {
                    format!(
                        "Keine Fremdschlüssel-Beziehung zwischen {}.{} und {}.{}. link mit :master.SPALTE angeben.",
                        from.0, from.1, to.0, to.1
                    )
                })?
            }
        };
        let refs = master_refs(&link)?;
        if refs.is_empty() {
            return Err(Fail::Broken("link braucht :master.SPALTE.".into()));
        }
        let mut probe = String::with_capacity(link.len());
        let mut last = 0;
        for reference in &refs {
            probe += &link[last..reference.start];
            probe += "NULL";
            last = reference.end;
        }
        probe += &link[last..];
        guard(&probe, connection, index)?;
        if master.1.rows.is_empty() {
            return Ok((
                Sample {
                    columns: Vec::new(),
                    rows: Vec::new(),
                },
                "nicht prüfbar, Master liefert keine Zeilen".into(),
            ));
        }
        let mut counts = Vec::new();
        let mut best: Option<Sample> = None;
        for row in master.1.rows.iter().take(TEST_MASTERS) {
            let (bound, params) = bind(&link, &refs, master.1, row, redactor)?;
            let bound = limited(connection.kind, &bound);
            guard(&bound, connection, index)?;
            stats.queries += 1;
            let result = db::execution::with_row_limit(
                TEST_ROWS + 1,
                run(
                    config,
                    connection.kind,
                    adapter.execute_query_with_params(&bound, &params),
                ),
            )
            .await?;
            counts.push(if result.rows.len() > TEST_ROWS {
                format!("{TEST_ROWS}+")
            } else {
                result.rows.len().to_string()
            });
            let sample = stats.sample(result.columns, result.rows);
            if best.as_ref().is_none_or(|known| known.rows.is_empty()) {
                best = Some(sample);
            }
        }
        let sample = best.unwrap_or(Sample {
            columns: Vec::new(),
            rows: Vec::new(),
        });
        let mut line = format!(
            "{} Zeilen für die ersten {} Master-Zeilen; Spalten: {}",
            counts.join(", "),
            counts.len(),
            sample.columns.join(", ")
        );
        if sample.rows.is_empty() {
            line += "; kein Treffer, Link-Spalten prüfen";
        }
        Ok((sample, line))
    }

    async fn rehearse(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        panes: &[Value],
        explicit: bool,
    ) -> (String, bool, Stats) {
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let index = match self.schema_index(config, connection, &redactor).await {
            Ok(index) => index,
            Err(error) => return (format!("Fehler: {error}"), true, Stats::default()),
        };
        let master_of = |pane: &Value| pane["master"].as_u64().map(|master| master as usize);
        let mut samples: Vec<Result<Sample, bool>> = Vec::new();
        let mut lines = Vec::new();
        let mut failed = false;
        let mut stats = Stats::default();
        for (number, pane) in panes.iter().enumerate() {
            let linked = explicit
                || master_of(pane).is_some()
                || panes.iter().any(|other| master_of(other) == Some(number));
            if !linked {
                samples.push(Err(false));
                continue;
            }
            let outcome = match master_of(pane) {
                None => self
                    .test_pane(config, connection, &index, pane, &mut stats)
                    .await
                    .map(|sample| {
                        let label = sample.label();
                        (sample, label)
                    }),
                Some(master) => match samples.get(master) {
                    Some(Ok(sample)) => self
                        .test_detail(
                            config,
                            connection,
                            (&redactor, &index),
                            panes,
                            (master, sample),
                            number,
                            &mut stats,
                        )
                        .await
                        .map(|(sample, line)| {
                            (sample, format!("Detail von {}: {line}", master + 1))
                        }),
                    Some(Err(true)) => Err(Fail::Broken(format!(
                        "Bereich {} ist fehlgeschlagen.",
                        master + 1
                    ))),
                    _ => Err(Fail::Blocked(format!(
                        "Bereich {} wurde nicht geprüft.",
                        master + 1
                    ))),
                },
            };
            match outcome {
                Ok((sample, line)) => {
                    lines.push(format!("{}: {line}", number + 1));
                    samples.push(Ok(sample));
                }
                Err(Fail::Blocked(reason)) => {
                    failed |= explicit;
                    lines.push(format!("{}: nicht prüfbar: {reason}", number + 1));
                    samples.push(Err(false));
                }
                Err(Fail::Broken(error)) => {
                    failed = true;
                    lines.push(format!("{}: Fehler: {error}", number + 1));
                    samples.push(Err(true));
                }
            }
        }
        (lines.join("\n"), failed, stats)
    }

    async fn open_pane(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        args: &Value,
    ) -> Result<(Value, String), String> {
        let sql = arg_str(args, "sql").trim();
        if !sql.is_empty() {
            if args.get("filter").is_some() || args.get("autoRefresh").is_some() {
                return Err("filter und autoRefresh gelten nur für Tabellen.".into());
            }
            return Ok((json!({"sql": sql}), "SQL-Tab (nicht ausgeführt)".into()));
        }
        let wanted = arg_str(args, "table").trim().to_lowercase();
        if wanted.is_empty() {
            return Err("table oder sql angeben.".into());
        }
        let scoped = with_database(connection, args)?;
        let catalog = self.catalog(config, &scoped).await?;
        let tables = catalog.tables();
        let found = tables
            .list
            .iter()
            .filter(|table| {
                tables.visible(table, scoped.allowed_schemas())
                    && (tables.name(table).to_lowercase() == wanted
                        || tables.qualified(table).to_lowercase() == wanted)
            })
            .min_by_key(|table| table.columns[0])
            .ok_or_else(|| format!("Tabelle '{wanted}' nicht gefunden. search nutzen."))?;
        let mut pane = json!({"schema": tables.schema(found), "table": tables.name(found)});
        let mut done = tables.qualified(found);
        if let Some(filter) = args.get("filter").and_then(Value::as_str) {
            let filter = clean_filter(filter, connection.kind)?;
            done += &if filter.is_empty() {
                ", Filter entfernt".to_string()
            } else {
                format!(", Filter: {filter}")
            };
            pane["filter"] = json!(filter);
        }
        if let Some(seconds) = auto_refresh(args)? {
            pane["autoRefresh"] = json!(seconds);
            done += &if seconds == 0 {
                ", Auto-Aktualisierung aus".to_string()
            } else {
                format!(", Auto-Aktualisierung alle {seconds} s")
            };
        }
        Ok((pane, done))
    }

    pub(super) async fn open(
        &mut self,
        config: &McpConfig,
        args: &Value,
    ) -> Result<String, String> {
        let connection = find_connection(config, arg_str(args, "connection"))?;
        let database = arg_str(args, "database").trim();
        let test = args["test"] == true;
        if test && !config.test_views {
            return Err("Probelauf ist aus. In l8db unter MCP › Sandbox aktivieren.".into());
        }
        let mut request = json!({
            "at": now_ms() as u64,
            "connectionId": connection.id,
            "database": (!database.is_empty()).then_some(database),
        });
        let split = match args.get("split") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(list)) if list.len() <= MAX_SPLIT => list.clone(),
            Some(_) => {
                return Err(format!(
                    "split erlaubt höchstens {MAX_SPLIT} weitere Bereiche."
                ))
            }
        };
        if split.is_empty() && !arg_str(args, "sql").trim().is_empty() {
            request["sql"] = json!(arg_str(args, "sql").trim());
            if test {
                let scoped = with_database(connection, args)?;
                return self.rehearsed(config, &scoped, &[request], true).await;
            }
            push(request)?;
            return Ok(format!(
                "SQL wird in l8db ({}) in einem neuen Editor-Tab geöffnet, nicht ausgeführt.",
                connection.name
            ));
        }
        let (main, mut done) = self.open_pane(config, connection, args).await?;
        let main_is_table = main.get("table").is_some();
        for (key, value) in main.as_object().into_iter().flatten() {
            request[key] = value.clone();
        }
        done = format!("{done} wird in l8db ({}) geöffnet", connection.name);
        let save_as = arg_str(args, "saveAs").trim();
        if !save_as.is_empty() {
            if request["filter"].as_str().unwrap_or("").is_empty() {
                return Err("saveAs braucht einen filter.".into());
            }
            request["saveAs"] = json!(save_as);
            done += &format!(", gespeichert als Ansicht '{save_as}'");
        }
        if !split.is_empty() {
            let mut panes = Vec::new();
            let mut tables = vec![main_is_table];
            for (index, entry) in split.iter().enumerate() {
                let number = index + 2;
                let scoped = match entry {
                    Value::Object(_) => {
                        let mut merged = entry.clone();
                        merged["database"] = json!(database);
                        merged
                    }
                    _ => return Err(format!("Bereich {number}: Objekt erwartet.")),
                };
                let (mut pane, label) = self.open_pane(config, connection, &scoped).await?;
                let mut line = format!("\n{number}: {label}");
                if let Some(master) = entry.get("master").filter(|value| !value.is_null()) {
                    let master = master
                        .as_u64()
                        .filter(|master| *master >= 1 && (*master as usize) < number)
                        .ok_or_else(|| {
                            format!(
                                "Bereich {number}: master muss ein früherer Bereich (1–{}) sein.",
                                number - 1
                            )
                        })?;
                    let link = arg_str(entry, "link").trim();
                    let own = arg_str(entry, "sql").trim();
                    if link.is_empty() && own.contains(":master.") {
                        check_link(own).map_err(|error| format!("Bereich {number}: {error}"))?;
                        line += &format!(", Detail von {master}");
                    } else if link.is_empty() {
                        if !(tables[master as usize - 1] && pane.get("table").is_some()) {
                            return Err(format!(
                                "Bereich {number}: link mit :master.SPALTE angeben (Fremdschlüssel nur zwischen Tabellen)."
                            ));
                        }
                        line += &format!(", Detail von {master} über Fremdschlüssel");
                    } else {
                        check_link(link).map_err(|error| format!("Bereich {number}: {error}"))?;
                        pane["link"] = json!(link);
                        line += &format!(", Detail von {master}");
                    }
                    pane["master"] = json!(master - 1);
                } else if !arg_str(entry, "link").trim().is_empty() {
                    return Err(format!("Bereich {number}: link braucht master."));
                }
                tables.push(pane.get("table").is_some());
                panes.push(pane);
                done += &line;
            }
            request["split"] = json!(panes);
            if let Some(orientation) = args.get("orientation").and_then(Value::as_str) {
                if !matches!(orientation, "horizontal" | "vertical") {
                    return Err("orientation muss horizontal oder vertical sein.".into());
                }
                request["orientation"] = json!(orientation);
            }
            done = format!("Split-Ansicht: 1: {done}");
        }
        let linked = request["split"]
            .as_array()
            .is_some_and(|panes| panes.iter().any(|pane| !pane["master"].is_null()));
        if test || (config.test_views && linked) {
            let scoped = with_database(connection, args)?;
            let mut panes = vec![request.clone()];
            panes.extend(request["split"].as_array().cloned().unwrap_or_default());
            if test {
                return self.rehearsed(config, &scoped, &panes, true).await;
            }
            let report = self
                .rehearsed(config, &scoped, &panes, false)
                .await
                .map_err(|error| format!("Nicht geöffnet. {error}"))?;
            done += &format!("\n{report}");
            request["at"] = json!(now_ms() as u64);
        }
        push(request)?;
        Ok(format!(
            "{done}\nLäuft l8db nicht, verfällt die Anfrage nach 60 s."
        ))
    }

    async fn rehearsed(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        panes: &[Value],
        explicit: bool,
    ) -> Result<String, String> {
        let (report, failed, _) = self.rehearse(config, connection, panes, explicit).await;
        let title = if explicit {
            "Probelauf, nichts geöffnet"
        } else {
            "Probelauf"
        };
        let report = format!("{title}:\n{report}");
        if failed {
            Err(report)
        } else {
            Ok(report)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_split_arguments() {
        assert_eq!(auto_refresh(&json!({})), Ok(None));
        assert_eq!(auto_refresh(&json!({"autoRefresh": 15})), Ok(Some(15)));
        assert!(auto_refresh(&json!({"autoRefresh": 7})).is_err());
        assert!(check_link("SELECT * FROM orders WHERE customer_id = :master.id").is_ok());
        assert!(check_link("delete from orders where id = :master.id").is_err());
        assert!(check_link("select 1; select :master.id").is_err());
        assert!(check_link("select * from orders").is_err());
        assert_eq!(
            clean_filter("WHERE id = 1", DatabaseKind::Postgres).unwrap(),
            "id = 1"
        );
        assert!(clean_filter("1=1; drop table x", DatabaseKind::Postgres).is_err());
    }

    #[test]
    fn reads_master_references_like_the_app() {
        let refs = master_refs(
            "SELECT ':master.no' AS t -- :master.no\nFROM o WHERE a = :master.id AND b::text = :master.\"Kunden Nr\" /* :x */",
        )
        .unwrap();
        let columns: Vec<&str> = refs.iter().map(|entry| entry.column.as_str()).collect();
        assert_eq!(columns, ["id", "Kunden Nr"]);
        assert!(master_refs("select :master").is_err());
        assert!(master_refs("select :master.a.b").is_err());
        assert!(master_refs("select :other, :master.a").is_err());
        assert!(master_refs("select $1, :master.a").is_err());
        assert!(master_refs("select $:master.\"id\"$ a $$ , :master.id").is_err());
        assert!(master_refs("select :master.\"id\"$ a $$").is_err());
        assert_eq!(
            master_refs("select $q$ :master.no $q$, $$ :x $$, :master.id")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            limited(DatabaseKind::Postgres, "SELECT 1; -- x"),
            "SELECT 1; -- x"
        );
        assert_eq!(
            limited(
                DatabaseKind::Postgres,
                "WITH a AS (SELECT 1) SELECT * FROM a;"
            ),
            "SELECT * FROM (\nWITH a AS (SELECT 1) SELECT * FROM a\n) l8db_test LIMIT 21"
        );
        assert_eq!(limited(DatabaseKind::Postgres, "SHOW x"), "SHOW x");
        assert_eq!(limited(DatabaseKind::Oracle, "SELECT 1"), "SELECT 1");
        assert_eq!(master_reference("id"), ":master.id");
        assert_eq!(master_reference("Kunden Nr"), ":master.\"Kunden Nr\"");
    }

    #[test]
    fn binds_master_values_and_derives_foreign_key_links() {
        let config = McpConfig::default();
        let redactor = Redactor::new(&config.redaction, &["iban".to_string()]);
        let master = Sample {
            columns: vec!["id".into(), "note".into(), "iban".into()],
            rows: vec![
                json!({"id": 7, "note": null, "iban": "DE00"}),
                json!([8, "x", "DE01"]),
            ],
        };
        let sql = "SELECT * FROM o WHERE a = :master.id AND b = :master.note OR c = :master.id";
        let refs = master_refs(sql).unwrap();
        let bind = |sql: &str, refs: &[MasterRef], row: &Value| {
            bind(sql, refs, &master, row, &redactor).map_err(|fail| match fail {
                Fail::Blocked(error) => format!("blocked: {error}"),
                Fail::Broken(error) => format!("broken: {error}"),
            })
        };
        assert!(!masked(&redactor, "tags", &json!({"a": [1, "x"]})));
        assert!(masked(&redactor, "iban", &json!(1)));
        let (bound, params) = bind(sql, &refs, &master.rows[0]).unwrap();
        assert_eq!(bound, "SELECT * FROM o WHERE a = $1 AND b = $2 OR c = $1");
        assert_eq!(params, [Some("7".to_string()), None]);
        let (_, params) = bind(sql, &refs, &master.rows[1]).unwrap();
        assert_eq!(params, [Some("8".to_string()), Some("x".to_string())]);
        for (sql, expected) in [
            (
                "SELECT :master.kunde",
                "broken: Die Spalte „kunde“ fehlt in der Master-Zeile. Vorhanden: id, note, iban",
            ),
            (
                "SELECT :master.iban",
                "blocked: Die Spalte „iban“ ist maskiert",
            ),
        ] {
            let refs = master_refs(sql).unwrap();
            let error = bind(sql, &refs, &master.rows[0]).unwrap_err();
            assert!(error.contains(expected), "{error}");
        }

        let key = |name: &str, from: (&str, &str), to: (&str, &str)| db::ForeignKeyInfo {
            constraint_name: name.into(),
            from_schema: "s".into(),
            from_table: from.0.into(),
            from_column: from.1.into(),
            to_schema: "s".into(),
            to_table: to.0.into(),
            to_column: to.1.into(),
        };
        let keys = [
            key("o_c", ("orders", "tenant"), ("customers", "tenant")),
            key("o_c", ("orders", "customer id"), ("customers", "id")),
        ];
        let link = |master: &str, detail: &str| {
            foreign_key_link(&keys, DatabaseKind::Postgres, ("s", master), ("s", detail))
        };
        assert_eq!(
            link("customers", "orders").unwrap(),
            "SELECT * FROM \"s\".\"orders\" WHERE \"tenant\" = :master.tenant AND \"customer id\" = :master.id LIMIT 100"
        );
        assert_eq!(
            link("orders", "customers").unwrap(),
            "SELECT * FROM \"s\".\"customers\" WHERE \"tenant\" = :master.tenant AND \"id\" = :master.\"customer id\" LIMIT 100"
        );
        assert!(link("customers", "notes").is_none());
    }

    #[tokio::test]
    async fn dry_run_is_optional_and_names_unsupported_links() {
        let (_dir, mut config, _, mut server) = super::super::sandbox::sqlite_fixture(
            "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id));
             INSERT INTO customers VALUES (1, 'a'), (2, 'b');
             INSERT INTO orders VALUES (1, 1);",
        );
        let args = |split: Value| json!({"table": "customers", "filter": "id > 0", "test": true, "split": split});
        let off = server.open(&config, &args(json!([]))).await.unwrap_err();
        assert!(off.contains("MCP › Sandbox"), "{off}");
        let listed = |config: &McpConfig| {
            gated(vec![tool_definition()], config)[0]["inputSchema"]["properties"]["test"]
                .is_object()
        };
        assert!(!listed(&config));
        config.test_views = true;
        assert!(listed(&config));

        let report = server
            .open(
                &config,
                &args(json!([{"sql": "SELECT count(*) AS n FROM orders"}])),
            )
            .await
            .unwrap();
        assert_eq!(
            report,
            "Probelauf, nichts geöffnet:\n1: 2 Zeilen; Spalten: id, name\n2: 1 Zeilen; Spalten: n"
        );
        let write = server
            .open(&config, &json!({"sql": "DELETE FROM orders", "test": true}))
            .await
            .unwrap_err();
        assert!(write.contains("1: nicht prüfbar"), "{write}");
        let drafts = [
            json!({"schema": "main", "table": "customers"}),
            json!({"sql": "DELETE FROM orders"}),
        ];
        let connection = config.connections[0].clone();
        let (report, failed, stats) = server.rehearse(&config, &connection, &drafts, false).await;
        assert!(
            !failed && report.is_empty() && stats.queries == 0,
            "{report}"
        );
        for kind in [DatabaseKind::Redis, DatabaseKind::Mongodb] {
            let other = McpConnection {
                kind,
                ..connection.clone()
            };
            let redactor = Redactor::new(&config.redaction, &[]);
            let index = server
                .schema_index(&config, &connection, &redactor)
                .await
                .unwrap();
            assert!(matches!(
                guard("FLUSHALL", &other, &index),
                Err(Fail::Blocked(_))
            ));
        }
        for args in [
            args(json!([{"table": "orders", "master": 1}])),
            json!({"table": "customers", "split": [{"table": "orders", "master": 1}]}),
        ] {
            let error = server.open(&config, &args).await.unwrap_err();
            assert!(
                error.contains("2: Fehler: Master-Detail läuft nur auf PostgreSQL"),
                "{error}"
            );
        }
    }

    #[tokio::test]
    #[ignore]
    async fn live_oracle_split_opens_tables_from_other_granted_schemas() {
        const SCHEMAS: usize = 40;
        const TABLES: usize = 25;
        let admin_url = std::env::var("L8DB_E2E_ORACLE_ADMIN_URL")
            .unwrap_or_else(|_| "oracle://system:testpw@127.0.0.1:11521/FREEPDB1".into());
        let app = format!("L8DB_OPEN_{}", std::process::id());
        let other = format!("{app}_B");
        let (_dir, mut config, mut connection, mut server) =
            super::super::sandbox::sqlite_fixture("");
        connection.kind = DatabaseKind::Oracle;
        connection.connection_string = admin_url.clone();
        let system = adapter(&connection, &server.pool).unwrap();
        let cleanup = format!(
            "BEGIN
  FOR s IN (SELECT sid, serial# AS serial FROM v$session WHERE username LIKE '{app}%') LOOP
    BEGIN EXECUTE IMMEDIATE 'ALTER SYSTEM KILL SESSION ''' || s.sid || ',' || s.serial || ''' IMMEDIATE'; EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  FOR u IN (SELECT username FROM dba_users WHERE username LIKE '{app}%') LOOP
    EXECUTE IMMEDIATE 'DROP USER ' || u.username || ' CASCADE';
  END LOOP;
END;"
        );
        let bulk = format!(
            "BEGIN
  FOR s IN 1..{SCHEMAS} LOOP
    EXECUTE IMMEDIATE 'CREATE USER {app}_S' || s || ' IDENTIFIED BY \"Pw_l8db1\" QUOTA UNLIMITED ON USERS';
    FOR t IN 1..{TABLES} LOOP
      EXECUTE IMMEDIATE 'CREATE TABLE {app}_S' || s || '.T' || t || '(id NUMBER PRIMARY KEY, c1 VARCHAR2(20), c2 VARCHAR2(20), c3 NUMBER, c4 DATE, c5 NUMBER(10, 2), c6 VARCHAR2(40), c7 TIMESTAMP)';
      EXECUTE IMMEDIATE 'GRANT SELECT ON {app}_S' || s || '.T' || t || ' TO {app}';
    END LOOP;
  END LOOP;
END;"
        );
        for sql in [
            cleanup.clone(),
            format!("CREATE USER {app} IDENTIFIED BY \"Pw_l8db1\" QUOTA UNLIMITED ON USERS"),
            format!("CREATE USER {other} IDENTIFIED BY \"Pw_l8db1\" QUOTA UNLIMITED ON USERS"),
            format!("GRANT CREATE SESSION TO {app}"),
            format!("CREATE TABLE {app}.t(id NUMBER PRIMARY KEY)"),
            format!("INSERT INTO {app}.t VALUES (1)"),
            format!("CREATE TABLE {other}.t2(id NUMBER PRIMARY KEY, name VARCHAR2(20))"),
            format!("INSERT INTO {other}.t2 VALUES (1, 'b')"),
            "COMMIT".into(),
            format!("GRANT SELECT ON {other}.t2 TO {app}"),
            bulk,
        ] {
            system
                .execute_query(&sql)
                .await
                .unwrap_or_else(|e| panic!("{sql}: {e}"));
        }
        let mut url = url::Url::parse(&admin_url).unwrap();
        url.set_username(&app.to_lowercase()).unwrap();
        url.set_password(Some("Pw_l8db1")).unwrap();
        connection.connection_string = url.to_string();
        config.test_views = true;
        let args = json!({"table": "t", "split": [{"table": format!("{other}.t2")}], "test": true});
        let mut outcomes = Vec::new();
        for schemas in [vec![], vec![app.clone(), other.clone()], vec![app.clone()]] {
            connection.schemas = schemas;
            config.connections = vec![connection.clone()];
            server.forget_catalog(&connection);
            outcomes.push(server.open(&config, &args).await);
        }
        connection.schemas = Vec::new();
        config.connections = vec![connection.clone()];
        let reader = adapter(&connection, &server.pool).unwrap();
        let spread = |mut times: Vec<std::time::Duration>| {
            times.sort();
            (times[times.len() / 2], times[times.len() * 95 / 100])
        };
        let (mut narrow, mut prints, mut loads) = (Vec::new(), Vec::new(), Vec::new());
        let (mut stages, mut tables, mut retained) = (0, 0, 0);
        for _ in 0..9 {
            let started = std::time::Instant::now();
            reader.list_columns(None, None, None).await.unwrap();
            narrow.push(started.elapsed());
            let started = std::time::Instant::now();
            reader.catalog_fingerprint().await.unwrap();
            prints.push(started.elapsed());
            server.forget_catalog(&connection);
            let before = super::super::objects::CALLS.with(|calls| calls.get());
            let started = std::time::Instant::now();
            let catalog = server.catalog(&config, &connection).await.unwrap();
            loads.push(started.elapsed());
            stages = super::super::objects::CALLS.with(|calls| calls.get()) - before;
            tables = catalog.tables().list.len();
            retained = catalog.retained_bytes();
        }
        std::mem::drop((reader, server));
        let _ = system.execute_query(&cleanup).await;
        let ((narrow_median, narrow_p95), (print_median, print_p95), (median, p95)) =
            (spread(narrow), spread(prints), spread(loads));
        eprintln!(
            "oracle mcp catalog, {} granted schemas, {tables} tables, {} columns: load median {median:?} p95 {p95:?}, {stages} query stage, {retained} bytes retained; fingerprint median {print_median:?} p95 {print_p95:?}; current schema only (old scope) median {narrow_median:?} p95 {narrow_p95:?}",
            SCHEMAS + 2,
            8 * SCHEMAS * TABLES + 3
        );
        for outcome in &outcomes[..2] {
            let report = outcome.as_ref().unwrap();
            assert!(report.contains("1: 1 Zeilen; Spalten: ID"), "{report}");
            assert!(
                report.contains("2: 1 Zeilen; Spalten: ID, NAME"),
                "{report}"
            );
        }
        let hidden = outcomes[2].as_ref().unwrap_err();
        assert!(hidden.contains("nicht gefunden"), "{hidden}");
        assert!(tables >= SCHEMAS * TABLES + 2, "{tables} tables");
        assert_eq!(stages, 1);
        assert!(retained < 2 << 20, "{retained} bytes");
        assert!(median.as_millis() < 1500, "median {median:?}");
        assert!(p95.as_millis() < 3000, "p95 {p95:?}");
        assert!(print_p95.as_millis() < 500, "fingerprint p95 {print_p95:?}");
    }

    #[tokio::test]
    #[ignore]
    async fn live_postgres_dry_run_checks_links_and_stays_bounded() {
        let url = std::env::var("L8DB_E2E_PG_URL")
            .unwrap_or_else(|_| "postgres://postgres:testpw@127.0.0.1:5433/testdb".into());
        let schema = format!("l8db_open_{}", std::process::id());
        let (_dir, mut config, mut connection, mut server) =
            super::super::sandbox::sqlite_fixture("");
        connection.kind = DatabaseKind::Postgres;
        connection.connection_string = url;
        connection.schemas = vec![schema.clone()];
        config.connections = vec![connection.clone()];
        config.test_views = true;
        let admin = adapter(&connection, &server.pool).unwrap();
        for sql in [
            format!("DROP SCHEMA IF EXISTS {schema} CASCADE"),
            format!("CREATE SCHEMA {schema}"),
            format!("CREATE TABLE {schema}.customers(id bigint PRIMARY KEY, name text, password text)"),
            format!("CREATE TABLE {schema}.orders(id bigint PRIMARY KEY, customer_id bigint REFERENCES {schema}.customers(id), total numeric)"),
            format!("CREATE TABLE {schema}.notes(id bigint PRIMARY KEY, customer text)"),
            format!("INSERT INTO {schema}.customers SELECT i, 'Kunde ' || i, 'geheim' || i FROM generate_series(1, 100000) i"),
            format!("INSERT INTO {schema}.orders SELECT i, CASE WHEN i % 10 < 4 THEN 1 ELSE 2 + i % 99999 END, i * 1.5 FROM generate_series(1, 500000) i"),
            format!("CREATE INDEX ON {schema}.orders (customer_id)"),
            format!("ANALYZE {schema}.customers"),
            format!("ANALYZE {schema}.orders"),
        ] {
            admin.execute_query(&sql).await.unwrap_or_else(|e| panic!("{sql}: {e}"));
        }
        let args = |split: Value| json!({"table": format!("{schema}.customers"), "test": true, "split": split});

        let report = server
            .open(
                &config,
                &args(json!([
                    {"table": format!("{schema}.orders"), "master": 1},
                    {"sql": format!("SELECT name FROM {schema}.customers WHERE id = :master.customer_id"), "master": 2}
                ])),
            )
            .await
            .unwrap();
        assert!(
            report.contains("1: 20+ Zeilen; Spalten: id, name, password"),
            "{report}"
        );
        assert!(report.contains("2: Detail von 1: 20+, "), "{report}");
        assert!(
            report.contains("Spalten: id, customer_id, total"),
            "{report}"
        );
        assert!(
            report.contains("3: Detail von 2: 1, 1, 1 Zeilen"),
            "{report}"
        );
        assert!(!report.contains("geheim"), "{report}");

        for (split, expected) in [
            (
                json!([{"table": format!("{schema}.notes"), "master": 1}]),
                "Keine Fremdschlüssel-Beziehung".to_string(),
            ),
            (
                json!([{"sql": format!("SELECT * FROM {schema}.orders WHERE customer_id = :master.kunde"), "master": 1}]),
                "Die Spalte „kunde“ fehlt in der Master-Zeile. Vorhanden: id, name, password"
                    .to_string(),
            ),
            (
                json!([{"sql": format!("SELECT * FROM {schema}.orders WHERE kunde = :master.id"), "master": 1}]),
                "kunde".to_string(),
            ),
            (
                json!([{"sql": format!("SELECT * FROM {schema}.notes WHERE customer = :master.password"), "master": 1}]),
                "password".to_string(),
            ),
            (
                json!([{"sql": "SELECT * FROM pg_catalog.pg_authid WHERE oid = :master.id", "master": 1}]),
                "2: nicht prüfbar".to_string(),
            ),
            (
                json!([{"sql": format!("SELECT $:master.\"id\"$ A $$ AS a, (SELECT string_agg(password, ',') FROM {schema}.customers)::int AS b, $:master.\"id\"$ , $$ AS c -- $$\nFROM {schema}.orders WHERE customer_id = :master.\"id\""), "master": 1}]),
                "Schreibweise :master.SPALTE".to_string(),
            ),
        ] {
            let error = server.open(&config, &args(split)).await.unwrap_err();
            assert!(error.contains(&expected), "{expected}: {error}");
            assert!(!error.contains("geheim"), "{error}");
        }
        let empty = server
            .open(
                &config,
                &args(json!([{"sql": format!("SELECT * FROM {schema}.notes WHERE customer = :master.name"), "master": 1}])),
            )
            .await
            .unwrap();
        assert!(
            empty.contains("kein Treffer, Link-Spalten prüfen"),
            "{empty}"
        );
        let refused = server
            .open(
                &config,
                &json!({"table": format!("{schema}.customers"), "split": [{"table": format!("{schema}.notes"), "master": 1}]}),
            )
            .await
            .unwrap_err();
        assert!(
            refused.starts_with("Nicht geöffnet. Probelauf:"),
            "{refused}"
        );

        let masked = [
            json!({"schema": schema, "table": "customers"}),
            json!({"sql": format!("SELECT * FROM {schema}.notes WHERE customer = :master.password"), "master": 0}),
        ];
        let (report, failed, _) = server.rehearse(&config, &connection, &masked, false).await;
        assert!(!failed && report.contains("2: nicht prüfbar"), "{report}");
        let (_, failed, _) = server.rehearse(&config, &connection, &masked, true).await;
        assert!(failed);

        let panes = [
            json!({"schema": schema, "table": "customers"}),
            json!({"schema": schema, "table": "orders", "master": 0}),
            json!({"sql": format!("SELECT * FROM {schema}.orders WHERE customer_id = :master.customer_id"), "master": 1}),
        ];
        let (report, failed, stats) = server.rehearse(&config, &connection, &panes, true).await;
        assert!(!failed, "{report}");
        assert!(
            stats.queries <= 2 + 2 * TEST_MASTERS,
            "{} queries",
            stats.queries
        );
        assert!(stats.rows <= TEST_ROWS + 1, "{} rows held", stats.rows);
        assert!(report.len() < 600, "{} chars", report.len());
        let mut times = Vec::new();
        for _ in 0..20 {
            let started = std::time::Instant::now();
            server.rehearse(&config, &connection, &panes, true).await;
            times.push(started.elapsed());
        }
        times.sort();
        let (median, p95) = (times[times.len() / 2], times[times.len() * 95 / 100]);
        eprintln!(
            "open dry run, 100k customers, 500k orders, 3 panes: median {median:?}, p95 {p95:?}, {} queries, {} rows held",
            stats.queries, stats.rows
        );
        admin
            .execute_query(&format!("DROP SCHEMA {schema} CASCADE"))
            .await
            .unwrap();
        assert!(median.as_millis() < 150, "median {median:?}");
        assert!(p95.as_millis() < 400, "p95 {p95:?}");
    }

    #[test]
    fn takes_only_fresh_requests_once() {
        let _guard = super::super::TEST_ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("l8db-open-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("L8DB_MCP_CONFIG", dir.join("mcp.json"));
        push(json!({"at": now_ms() as u64, "table": "a"})).unwrap();
        push(json!({"at": 1, "table": "old"})).unwrap();
        let taken = mcp_take_open_requests();
        assert_eq!(taken.len(), 1);
        assert_eq!(taken[0]["table"], "a");
        assert!(mcp_take_open_requests().is_empty());
        std::env::remove_var("L8DB_MCP_CONFIG");
        let _ = fs::remove_dir_all(dir);
    }
}
