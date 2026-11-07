use super::config::{self, McpConfig, McpConnection, Redaction};
use super::redact::Redactor;
use super::server::{
    arg_str, audit, connection_url, database_arg, exposed, find_connection, scrub_error,
    with_database,
};
use crate::db::{connection, execution, map_pg_err, quote_ident, DatabaseKind};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::Notify;
use tokio_postgres::{Client, SimpleQueryMessage};

const MAX_WATCHES: usize = 20;
const MAX_IDS: usize = 100;
const MAX_COLUMNS: usize = 100;
const SLOTS: usize = 4;
const DEFAULT_MINUTES: f64 = 60.0;
const MAX_MINUTES: f64 = 480.0;
const PREVIEW: usize = 60;
const WINDOW: usize = 256;
const BUFFERED: usize = 200;
const LINES_PER_PUSH: usize = 5;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const QUERY_TIMEOUT: Duration = Duration::from_secs(5);
const TIMED_OUT: &str = "Datenbank antwortet nicht innerhalb von 5 s.";
const GUARD: &str =
    "BEGIN READ ONLY; SET LOCAL statement_timeout = 2000; SET LOCAL lock_timeout = 500;";

type Sink = Arc<dyn Fn(Value) + Send + Sync>;
type Rows = Vec<Vec<Option<String>>>;
type Settings = (McpConnection, Redaction);
type Lookup = Arc<dyn Fn(&str) -> Option<Settings> + Send + Sync>;
type Found = Option<(Vec<String>, HashMap<String, Row>)>;

#[derive(Clone, Copy)]
struct Timing {
    min: Duration,
    max: Duration,
    push_min: Duration,
    push_max: Duration,
}

const TIMING: Timing = Timing {
    min: Duration::from_secs(1),
    max: Duration::from_secs(10),
    push_min: Duration::from_secs(5),
    push_max: Duration::from_secs(300),
};

struct Table {
    sql: String,
    key: String,
    cast: String,
    columns: Vec<String>,
    redactor: Redactor,
}

#[derive(Clone, PartialEq)]
struct Cell {
    preview: Option<String>,
    hash: Option<String>,
}

#[derive(Clone)]
struct Row {
    version: String,
    cells: Vec<Cell>,
}

struct Pending {
    before: Option<Row>,
    after: Option<Row>,
}

struct Watch {
    name: String,
    key: String,
    label: String,
    table: Arc<Table>,
    ids: Vec<String>,
    rows: HashMap<String, Row>,
    pending: BTreeMap<String, Pending>,
    until: Instant,
    last_push: Option<Instant>,
    gap: Duration,
    failure: Option<String>,
    settings: Settings,
}

#[derive(Default)]
struct State {
    next: u64,
    watches: BTreeMap<String, Watch>,
    pollers: HashSet<String>,
    buffered: VecDeque<String>,
    dropped: usize,
}

struct Inner {
    state: Mutex<State>,
    sink: Sink,
    timing: Timing,
    lookup: Lookup,
    slots: std::path::PathBuf,
    wake: Notify,
    queries: AtomicU64,
}

struct Link {
    client: Client,
    config: tokio_postgres::Config,
    ssl: connection::PgTls,
    broken: bool,
    _slot: File,
}

struct Watches(Arc<Inner>);

pub(super) fn tool_definition() -> Value {
    json!({
        "name": "watch",
        "description": "Watch PostgreSQL rows by primary key; changes arrive as short diffs (channel messages, else action=changes). action: add (table, ids, columns, minutes ≤480, default 60), list, changes, remove (id or all).",
        "inputSchema": {"type": "object", "properties": {
            "action": {"type": "string", "enum": ["add", "list", "changes", "remove"]},
            "connection": {"type": "string"},
            "database": database_arg(),
            "table": {"type": "string"},
            "ids": {"type": "array", "items": {"type": "string"}},
            "columns": {"type": "array", "items": {"type": "string"}},
            "minutes": {"type": "number"},
            "watch": {"type": "string"}
        }}
    })
}

pub(super) async fn call(config: &McpConfig, args: &Value) -> Result<String, String> {
    let watches = registry();
    match arg_str(args, "action") {
        "" | "add" => watches.add(config, args).await,
        "remove" => watches.remove(arg_str(args, "watch")),
        "list" => Ok(watches.list()),
        "changes" => Ok(watches.changes()),
        other => Err(format!(
            "Unbekannte action '{other}'. Erlaubt: add, list, changes, remove."
        )),
    }
}

fn registry() -> &'static Watches {
    static WATCHES: OnceLock<Watches> = OnceLock::new();
    WATCHES.get_or_init(|| {
        Watches::new(
            Arc::new(|message: Value| {
                let mut out = std::io::stdout();
                let _ = writeln!(out, "{message}").and_then(|()| out.flush());
            }),
            TIMING,
            Arc::new(current_settings),
            config::config_path().with_file_name("watch-slots"),
        )
    })
}

fn current_settings(connection_id: &str) -> Option<Settings> {
    static LAST: Mutex<Option<McpConfig>> = Mutex::new(None);
    let mut last = LAST.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(config) = std::fs::read(config::config_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<McpConfig>(&bytes).ok())
    {
        *last = Some(config);
    }
    let config = last.as_ref().filter(|config| config.enabled)?;
    let found = exposed(config)
        .find(|connection| connection.id == connection_id)
        .map(|connection| (connection.clone(), config.redaction.clone()));
    found
}

impl Watches {
    fn new(sink: Sink, timing: Timing, lookup: Lookup, slots: std::path::PathBuf) -> Self {
        Self(Arc::new(Inner {
            state: Mutex::default(),
            sink,
            timing,
            lookup,
            slots,
            wake: Notify::new(),
            queries: AtomicU64::new(0),
        }))
    }

    async fn add(&self, config: &McpConfig, args: &Value) -> Result<String, String> {
        let configured = find_connection(config, arg_str(args, "connection"))?;
        let connection = with_database(configured, args)?;
        if connection.kind != DatabaseKind::Postgres {
            return Err("watch unterstützt bisher nur PostgreSQL.".into());
        }
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        redactor.check_valid()?;
        let started = Instant::now();
        let settings = (configured.clone(), config.redaction.clone());
        let result = match connection_url(&connection) {
            Ok(url) => {
                self.start(&connection, &url, args, redactor, settings)
                    .await
            }
            Err(error) => Err(error),
        };
        audit(&connection, "watch", &args.to_string(), &result, started);
        result
    }

    async fn start(
        &self,
        connection: &McpConnection,
        url: &str,
        args: &Value,
        redactor: Redactor,
        settings: Settings,
    ) -> Result<String, String> {
        let name = arg_str(args, "table").trim();
        if name.is_empty() {
            return Err("table fehlt.".into());
        }
        let ids = ids(args)?;
        let wanted: Vec<String> = args["columns"]
            .as_array()
            .map(|items| items.iter().filter_map(scalar).collect())
            .unwrap_or_default();
        let minutes = args["minutes"]
            .as_f64()
            .unwrap_or(DEFAULT_MINUTES)
            .clamp(1.0, MAX_MINUTES);
        let key = format!(
            "{}#{}",
            connection.id,
            connection.database.as_deref().unwrap_or("")
        );
        let running = {
            let state = self.0.lock();
            if state.watches.len() >= MAX_WATCHES {
                return Err(format!(
                    "Höchstens {MAX_WATCHES} Watches gleichzeitig. Erst welche mit action=remove beenden."
                ));
            }
            state.pollers.contains(&key)
        };
        let mut slot = if running {
            None
        } else {
            Some(take_slot(&self.0.slots, &connection.id)?)
        };
        let (pg, ssl) = connection::parse_connection(url, connection.database.as_deref())?;
        let client = open(&pg, &ssl).await?;
        let table = Arc::new(resolve(&self.0, &client, name, &wanted, connection, redactor).await?);
        let ids = canonical(&self.0, &client, &table, &ids).await?;
        let rows = parse_rows(
            self.0.select(&client, &rows_sql(&table, &ids)).await?,
            &table,
        );
        let missing: Vec<&str> = ids
            .iter()
            .filter(|id| !rows.contains_key(*id))
            .map(String::as_str)
            .collect();
        let mut state = self.0.lock();
        if !state.pollers.contains(&key) && slot.is_none() {
            slot = Some(take_slot(&self.0.slots, &connection.id)?);
        }
        state.next += 1;
        let watch = format!("w{}", state.next);
        let mut reply = format!(
            "{watch} watches {name} {} for {minutes} min.",
            ids.join(", ")
        );
        if !missing.is_empty() {
            reply.push_str(&format!(" Not found yet: {}.", missing.join(", ")));
        }
        reply.push_str(
            " Changes arrive as channel messages; without them read watch action=changes.",
        );
        state.watches.insert(
            watch.clone(),
            Watch {
                name: watch,
                key: key.clone(),
                label: name.to_string(),
                table,
                ids,
                rows,
                pending: BTreeMap::new(),
                until: Instant::now() + Duration::from_secs_f64(minutes * 60.0),
                last_push: None,
                gap: Duration::ZERO,
                failure: None,
                settings,
            },
        );
        if let Some(slot) = slot.filter(|_| state.pollers.insert(key.clone())) {
            tokio::spawn(poll(
                self.0.clone(),
                key,
                connection.id.clone(),
                Link {
                    client,
                    config: pg,
                    ssl,
                    broken: false,
                    _slot: slot,
                },
            ));
        }
        Ok(reply)
    }

    fn remove(&self, target: &str) -> Result<String, String> {
        let mut state = self.0.lock();
        let wanted: Vec<String> = if target.trim() == "all" {
            state.watches.keys().cloned().collect()
        } else {
            target
                .split([',', ' '])
                .filter(|id| state.watches.contains_key(*id))
                .map(str::to_string)
                .collect()
        };
        if wanted.is_empty() {
            return Err(format!(
                "Watch '{target}' gibt es nicht. Aktiv: {}",
                state.watches.keys().cloned().collect::<Vec<_>>().join(", ")
            ));
        }
        for id in &wanted {
            state.watches.remove(id);
        }
        drop(state);
        self.0.wake.notify_waiters();
        Ok(format!("Removed {}.", wanted.join(", ")))
    }

    fn list(&self) -> String {
        let state = self.0.lock();
        if state.watches.is_empty() {
            return "No active watches.".into();
        }
        let now = Instant::now();
        let mut lines: Vec<String> = state
            .watches
            .values()
            .map(|watch| {
                format!(
                    "{} {} {} ({} min left)",
                    watch.name,
                    watch.label,
                    watch.ids.join(", "),
                    watch
                        .until
                        .saturating_duration_since(now)
                        .as_secs()
                        .div_ceil(60)
                )
            })
            .collect();
        lines.push(format!(
            "{} database queries so far",
            self.0.queries.load(Ordering::Relaxed)
        ));
        lines.join("\n")
    }

    fn changes(&self) -> String {
        let mut state = self.0.lock();
        let mut lines: Vec<String> = state.buffered.drain(..).collect();
        if state.dropped > 0 {
            lines.insert(0, format!("{} older changes dropped", state.dropped));
            state.dropped = 0;
        }
        if lines.is_empty() {
            "No changes.".into()
        } else {
            lines.join("\n")
        }
    }
}

impl Inner {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn send(&self, messages: Vec<Value>) {
        for message in messages {
            (self.sink)(message);
        }
    }

    fn message(&self, state: &mut State, watch: &str, label: &str, text: String) -> Value {
        if state.buffered.len() >= BUFFERED {
            state.buffered.pop_front();
            state.dropped += 1;
        }
        state.buffered.push_back(text.clone());
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/claude/channel",
            "params": {"content": text, "meta": {"watch": watch, "table": label}}
        })
    }

    fn status(&self, state: &mut State, key: &str, text: &str) -> Vec<Value> {
        let names: Vec<String> = state
            .watches
            .values()
            .filter(|watch| watch.key == key)
            .map(|watch| watch.name.clone())
            .collect();
        if names.is_empty() {
            return Vec::new();
        }
        let label = names.join(" ");
        vec![self.message(state, &label, "", format!("{label} {text}"))]
    }

    fn expire(
        &self,
        state: &mut State,
        key: &str,
        current: Option<&Settings>,
        now: Instant,
    ) -> Vec<Value> {
        let gone: Vec<(String, &str)> = state
            .watches
            .values()
            .filter(|watch| watch.key == key)
            .filter_map(|watch| {
                let reason = match current {
                    None => "stopped: connection is no longer exposed",
                    Some(settings) if settings != &watch.settings => {
                        "stopped: MCP settings changed, add the watch again"
                    }
                    _ if watch.until <= now => "expired",
                    _ => return None,
                };
                Some((watch.name.clone(), reason))
            })
            .collect();
        let mut messages = Vec::new();
        for (name, reason) in gone {
            if let Some(watch) = state.watches.remove(&name) {
                let text = format!("{name} {} {reason}", watch.label);
                messages.push(self.message(state, &name, &watch.label, text));
            }
        }
        messages
    }

    fn flush(&self, state: &mut State, key: &str, now: Instant) -> Vec<Value> {
        let texts: Vec<(String, String, String)> = state
            .watches
            .values_mut()
            .filter(|watch| watch.key == key)
            .filter_map(|watch| {
                let text = watch.flush(now, &self.timing)?;
                Some((watch.name.clone(), watch.label.clone(), text))
            })
            .collect();
        texts
            .into_iter()
            .map(|(name, label, text)| self.message(state, &name, &label, text))
            .collect()
    }

    async fn select(&self, client: &Client, sql: &str) -> Result<Rows, String> {
        self.queries.fetch_add(1, Ordering::Relaxed);
        let sent = tokio::time::timeout(
            QUERY_TIMEOUT,
            client.simple_query(&format!("{GUARD} {sql}; COMMIT")),
        )
        .await;
        match sent.map_err(|_| TIMED_OUT.to_string())? {
            Ok(messages) => Ok(messages
                .into_iter()
                .filter_map(|message| match message {
                    SimpleQueryMessage::Row(row) => Some(
                        (0..row.len())
                            .map(|index| row.get(index).map(str::to_string))
                            .collect(),
                    ),
                    _ => None,
                })
                .collect()),
            Err(error) => {
                if !client.is_closed() {
                    let _ =
                        tokio::time::timeout(QUERY_TIMEOUT, client.batch_execute("ROLLBACK")).await;
                }
                Err(scrub_error(&map_pg_err(error)))
            }
        }
    }

    async fn cycle(
        &self,
        link: &mut Link,
        jobs: &[(String, Arc<Table>, Vec<String>)],
    ) -> Result<bool, String> {
        if link.broken || link.client.is_closed() {
            link.client = open(&link.config, &link.ssl).await?;
            link.broken = false;
        }
        let mut changed = false;
        for (name, table, ids) in jobs {
            let outcome = self.check(&link.client, name, table, ids).await;
            if let Err(error) = &outcome {
                if error == TIMED_OUT || link.client.is_closed() {
                    link.broken = true;
                    return Err(error.clone());
                }
            }
            let mut state = self.lock();
            let Some(watch) = state.watches.get_mut(name) else {
                continue;
            };
            let text = match outcome {
                Ok(found) => {
                    if let Some((stale, rows)) = found {
                        watch.record(&stale, rows);
                        changed = true;
                    }
                    watch.failure.take().map(|_| "resumed".to_string())
                }
                Err(error) => {
                    let first = watch.failure.replace(error.clone()).is_none();
                    first.then(|| format!("paused: {error}"))
                }
            };
            if let Some(text) = text {
                let label = watch.label.clone();
                let message =
                    self.message(&mut state, name, &label, format!("{name} {label} {text}"));
                drop(state);
                self.send(vec![message]);
            }
        }
        Ok(changed)
    }

    async fn check(
        &self,
        client: &Client,
        name: &str,
        table: &Table,
        ids: &[String],
    ) -> Result<Found, String> {
        let versions: HashMap<String, String> = self
            .select(client, &versions_sql(table, ids))
            .await?
            .into_iter()
            .filter_map(|row| {
                let mut row = row.into_iter();
                Some((row.next()??, row.next()??))
            })
            .collect();
        let stale = match self.lock().watches.get(name) {
            Some(watch) => watch.stale(&versions),
            None => return Ok(None),
        };
        if stale.is_empty() {
            return Ok(None);
        }
        let present: Vec<String> = stale
            .iter()
            .filter(|id| versions.contains_key(*id))
            .cloned()
            .collect();
        let rows = if present.is_empty() {
            HashMap::new()
        } else {
            parse_rows(
                self.select(client, &rows_sql(table, &present)).await?,
                table,
            )
        };
        Ok(Some((stale, rows)))
    }
}

async fn poll(inner: Arc<Inner>, key: String, connection_id: String, mut link: Link) {
    let mut interval = inner.timing.min;
    let mut failure: Option<String> = None;
    loop {
        let pause = interval.mul_f64(0.8 + 0.4 * rand::random::<f64>());
        tokio::select! {
            _ = tokio::time::sleep(pause) => {}
            _ = inner.wake.notified() => {}
        }
        let current = (inner.lookup)(&connection_id);
        let (jobs, messages) = {
            let mut state = inner.lock();
            let messages = inner.expire(&mut state, &key, current.as_ref(), Instant::now());
            let jobs: Vec<(String, Arc<Table>, Vec<String>)> = state
                .watches
                .values()
                .filter(|watch| watch.key == key)
                .map(|watch| (watch.name.clone(), watch.table.clone(), watch.ids.clone()))
                .collect();
            if jobs.is_empty() {
                state.pollers.remove(&key);
            }
            (jobs, messages)
        };
        inner.send(messages);
        if jobs.is_empty() {
            return;
        }
        let outcome = inner.cycle(&mut link, &jobs).await;
        let messages = {
            let mut state = inner.lock();
            let mut messages = match (&outcome, &failure) {
                (Err(error), None) => inner.status(&mut state, &key, &format!("paused: {error}")),
                (Ok(_), Some(_)) => inner.status(&mut state, &key, "resumed"),
                _ => Vec::new(),
            };
            messages.extend(inner.flush(&mut state, &key, Instant::now()));
            messages
        };
        inner.send(messages);
        interval = next_interval(interval, &outcome, &inner.timing);
        failure = outcome.err();
    }
}

fn next_interval(current: Duration, outcome: &Result<bool, String>, timing: &Timing) -> Duration {
    match outcome {
        Ok(true) => timing.min,
        Ok(false) => current.mul_f64(1.5).min(timing.max),
        Err(_) => timing.max,
    }
}

impl Watch {
    fn stale(&self, versions: &HashMap<String, String>) -> Vec<String> {
        self.ids
            .iter()
            .filter(|id| match (self.rows.get(*id), versions.get(*id)) {
                (Some(row), Some(version)) => &row.version != version,
                (None, None) => false,
                _ => true,
            })
            .cloned()
            .collect()
    }

    fn record(&mut self, stale: &[String], mut rows: HashMap<String, Row>) {
        for id in stale {
            let after = rows.remove(id);
            let before = match &after {
                Some(row) => self.rows.insert(id.clone(), row.clone()),
                None => self.rows.remove(id),
            };
            self.pending
                .entry(id.clone())
                .or_insert(Pending {
                    before,
                    after: None,
                })
                .after = after;
        }
    }

    fn flush(&mut self, now: Instant, timing: &Timing) -> Option<String> {
        let waited = self.last_push.map_or(Duration::MAX, |at| now - at);
        if self.pending.is_empty() {
            if waited >= self.gap {
                self.gap = Duration::ZERO;
            }
            return None;
        }
        if waited < self.gap {
            return None;
        }
        let lines: Vec<String> = std::mem::take(&mut self.pending)
            .into_iter()
            .filter_map(|(id, change)| self.describe(&id, change))
            .collect();
        if lines.is_empty() {
            return None;
        }
        self.gap = (self.gap * 2).clamp(timing.push_min, timing.push_max);
        self.last_push = Some(now);
        let mut text = lines[..lines.len().min(LINES_PER_PUSH)].join("\n");
        if lines.len() > LINES_PER_PUSH {
            text.push_str(&format!(
                "\n{} {} +{} more rows changed",
                self.name,
                self.label,
                lines.len() - LINES_PER_PUSH
            ));
        }
        Some(text)
    }

    fn describe(&self, id: &str, change: Pending) -> Option<String> {
        let head = format!("{} {} {id}", self.name, self.label);
        match (change.before, change.after) {
            (None, Some(_)) => Some(format!("{head} inserted")),
            (Some(_), None) => Some(format!("{head} deleted")),
            (None, None) => None,
            (Some(before), Some(after)) => {
                let diffs: Vec<String> = self
                    .table
                    .columns
                    .iter()
                    .zip(before.cells.iter().zip(&after.cells))
                    .filter(|(_, (old, new))| old != new)
                    .map(|(column, (old, new))| {
                        if old.preview == new.preview {
                            format!("{column}: changed")
                        } else {
                            format!("{column}: {}→{}", show(&old.preview), show(&new.preview))
                        }
                    })
                    .collect();
                (!diffs.is_empty()).then(|| format!("{head} {}", diffs.join(", ")))
            }
        }
    }
}

fn show(value: &Option<String>) -> String {
    let Some(text) = value else {
        return "null".into();
    };
    let clipped: String = text.chars().take(PREVIEW).collect();
    let more = if text.chars().count() > PREVIEW {
        "…"
    } else {
        ""
    };
    format!("{}{more}", Value::String(clipped))
}

async fn open(config: &tokio_postgres::Config, ssl: &connection::PgTls) -> Result<Client, String> {
    let mut config = config.clone();
    config.application_name("l8db-watch");
    tokio::time::timeout(CONNECT_TIMEOUT, execution::connect_postgres(&config, ssl))
        .await
        .map_err(|_| "Verbindungsaufbau dauert länger als 10 s.".to_string())?
        .map_err(|error| scrub_error(&error))
}

fn take_slot(dir: &Path, connection_id: &str) -> Result<File, String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let stem: String = connection_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    for slot in 0..SLOTS {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(dir.join(format!("{stem}-{slot}.lock")))
            .map_err(|error| error.to_string())?;
        if file.try_lock().is_ok() {
            return Ok(file);
        }
    }
    Err(format!(
        "Auf dieser Verbindung beobachten schon {SLOTS} Sitzungen Datensätze. Erst dort Watches beenden, damit die Datenbank nicht mehr Last bekommt."
    ))
}

async fn resolve(
    inner: &Inner,
    client: &Client,
    name: &str,
    wanted: &[String],
    connection: &McpConnection,
    redactor: Redactor,
) -> Result<Table, String> {
    let reg = format!("to_regclass({})", literal(name));
    let found = inner
        .select(client, &format!("select n.nspname, c.relname, c.relkind::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = {reg}"))
        .await?;
    let allowed = connection.allowed_schemas();
    let (schema, relname) = match found.first().map(Vec::as_slice) {
        Some([Some(schema), Some(relname), Some(kind)])
            if allowed.is_empty() || allowed.iter().any(|s| s.eq_ignore_ascii_case(schema)) =>
        {
            if !matches!(kind.as_str(), "r" | "p") {
                return Err(format!(
                    "'{name}' ist keine Tabelle; watch braucht eine Tabelle mit Primärschlüssel."
                ));
            }
            (schema.clone(), relname.clone())
        }
        _ => return Err(format!("Tabelle '{name}' nicht gefunden.")),
    };
    let found = inner
        .select(client, &format!("select a.attname, format_type(a.atttypid, a.atttypmod), coalesce((select true from pg_index i where i.indrelid = a.attrelid and i.indisprimary and coalesce((to_jsonb(i) ->> 'indnkeyatts')::int, i.indnatts) = 1 and i.indkey[0] = a.attnum), false)::text from pg_attribute a where a.attrelid = {reg} and a.attnum > 0 and not a.attisdropped order by a.attnum"))
        .await?;
    let mut key = None;
    let mut columns = Vec::new();
    for row in &found {
        if let [Some(column), Some(kind), Some(primary)] = row.as_slice() {
            if primary == "true" {
                key = Some((column.clone(), kind.clone()));
            }
            columns.push(column.clone());
        }
    }
    let (key, cast) =
        key.ok_or_else(|| format!("'{name}' hat keinen einspaltigen Primärschlüssel."))?;
    if redactor.column_is_sensitive(&key) {
        return Err(format!(
            "Der Primärschlüssel '{key}' von '{name}' ist geschwärzt; watch ist dafür gesperrt."
        ));
    }
    if let Some(missing) = wanted.iter().find(|column| !columns.contains(column)) {
        return Err(format!("Spalte '{missing}' gibt es in '{name}' nicht."));
    }
    if !wanted.is_empty() {
        columns = wanted.to_vec();
    }
    if columns.len() > MAX_COLUMNS {
        return Err(format!(
            "'{name}' hat {} Spalten; columns auf höchstens {MAX_COLUMNS} begrenzen.",
            columns.len()
        ));
    }
    Ok(Table {
        sql: format!("{}.{}", quote_ident(&schema), quote_ident(&relname)),
        key: quote_ident(&key),
        cast,
        columns,
        redactor,
    })
}

async fn canonical(
    inner: &Inner,
    client: &Client,
    table: &Table,
    ids: &[String],
) -> Result<Vec<String>, String> {
    let found = inner
        .select(
            client,
            &format!(
                "select x::text from unnest({}) with ordinality u(x, n) order by n",
                id_array(table, ids)
            ),
        )
        .await?;
    let mut seen = HashSet::new();
    Ok(found
        .into_iter()
        .filter_map(|row| row.into_iter().next().flatten())
        .filter(|id| seen.insert(id.clone()))
        .collect())
}

fn ids(args: &Value) -> Result<Vec<String>, String> {
    let ids: Vec<String> = match (&args["ids"], &args["id"]) {
        (Value::Array(items), _) => items.iter().filter_map(scalar).collect(),
        (Value::Null, value) => scalar(value).into_iter().collect(),
        (value, _) => scalar(value).into_iter().collect(),
    };
    if ids.is_empty() {
        return Err("ids fehlt (Primärschlüsselwerte der Zeilen).".into());
    }
    if ids.len() > MAX_IDS {
        return Err(format!("Höchstens {MAX_IDS} ids pro Watch."));
    }
    if ids
        .iter()
        .any(|id| id.len() > 200 || id.chars().any(char::is_control))
    {
        return Err("Ungültiger Schlüsselwert in ids.".into());
    }
    Ok(ids)
}

fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.trim().to_string()).filter(|text| !text.is_empty()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn literal(value: &str) -> String {
    format!("E'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
}

fn id_array(table: &Table, ids: &[String]) -> String {
    let items: Vec<String> = ids.iter().map(|id| literal(id)).collect();
    format!("array[{}]::{}[]", items.join(","), table.cast)
}

fn versions_sql(table: &Table, ids: &[String]) -> String {
    format!(
        "select {key}::text, xmin::text from {} where {key} = any({})",
        table.sql,
        id_array(table, ids),
        key = table.key
    )
}

fn rows_sql(table: &Table, ids: &[String]) -> String {
    let cells: String = table
        .columns
        .iter()
        .map(|column| {
            let column = quote_ident(column);
            format!(", left({column}::text, {WINDOW}), md5({column}::text)")
        })
        .collect();
    format!(
        "select {key}::text, xmin::text{cells} from {} where {key} = any({})",
        table.sql,
        id_array(table, ids),
        key = table.key
    )
}

fn parse_rows(found: Rows, table: &Table) -> HashMap<String, Row> {
    found
        .into_iter()
        .filter_map(|mut values| {
            let cells = values
                .split_off(values.len().min(2))
                .chunks(2)
                .zip(&table.columns)
                .map(|(pair, column)| Cell {
                    preview: pair[0]
                        .as_deref()
                        .filter(|_| !table.redactor.column_is_sensitive(column))
                        .map(|text| {
                            table
                                .redactor
                                .redact_text(text)
                                .chars()
                                .take(PREVIEW + 1)
                                .collect()
                        }),
                    hash: pair.get(1).cloned().flatten(),
                })
                .collect();
            let mut head = values.into_iter();
            let key = head.next()??;
            let version = head.next()??;
            Some((key, Row { version, cells }))
        })
        .collect()
}

#[cfg(test)]
#[path = "watch_tests.rs"]
mod tests;
