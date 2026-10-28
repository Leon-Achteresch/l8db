use super::catalog::{allowed, Kind};
use super::config::{McpConfig, McpConnection};
use super::discovery::{glob, mask_hidden, resolve, Found, Missing, Notes, View};
use super::insight::{cached_source, Excerpt};
use super::redact::Redactor;
use super::server::{
    adapter, arg_str, audit, cap, check_read_sql, database_arg, find_connection, format_result,
    qualified, run, scrub_error, with_database, Server, SQL_KINDS,
};
use crate::db::{self, DatabaseAdapter, DatabaseKind, QueryResult};
use futures_util::{future::BoxFuture, stream::FuturesUnordered, StreamExt};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdout, Command};

const MAX_CODE: usize = 64 << 10;
const MAX_MESSAGE: usize = 4 << 20;
const MAX_REPLY: usize = 8 << 20;
const MAX_CALLS: usize = 5_000;
const MAX_SENT: usize = 64 << 20;
const PREAMBLE: usize = 16 << 10;
const STDERR: usize = 2 << 10;
const GRACE: Duration = Duration::from_secs(2);
const RESULT_CHARS: u32 = 200_000;
const RESULT_ITEMS: u32 = 10_000;
const CATALOG_LIMIT: u64 = 1_000;
const LOG_CHARS: usize = 3_000;

const DTS: &str = "type On={connection?:string;database?:string};type P=string|RegExp;type Row=Record<string,any>;type F={schema?:P;name?:P;limit?:number};
declare const sql:{(s:TemplateStringsArray,...v:unknown[]):Promise<Row[]>;with(o:On):typeof sql},
query:(sql:string,o?:On&{limit?:number})=>Promise<Row[]>,
explain:(sql:string,o?:On)=>Promise<string>,
id:(...name:string[])=>unknown,
catalog:{with(o:On):typeof catalog;
schemas():Promise<{name;tables;rows?;bytes?}[]>;
tables(f?:F&{column?:P;kind?:string;minRows?:number}):Promise<{schema;name;kind;rows?;bytes?;columns}[]>;
columns(f?:F&{table?:P;type?:P}):Promise<{schema;table;name;type}[]>;
routines(f?:F&{kind?:string}):Promise<{schema;name;kind;args;returns;lines?}[]>;
source(name:string,lines?:string):Promise<{text;from;to;total}>;
grep(term:string,f?:{kind?:string;limit?:number}):Promise<{object;kind;line;text}[]>;
references(table:string):Promise<{from;to;on}[]>;
path(from:string,to:string):Promise<string>};";

pub fn tool_definition() -> Value {
    json!({
        "name": "code",
        "description": format!("Read-only JS `async () => {{…}}` for multi-step work: loops over schemas or tables, many statements, comparing connections. Sandboxed (no network, files, env); only the return value (array of flat objects as TSV) and console.log come back. Statements are checked like query; errors throw. ${{v}} in sql is a literal (array: (a,b)); names only via id(). P: glob (orders_*) or RegExp; tables largest first. Max 500 statements, 4 parallel, 10000 rows each.\n{DTS}"),
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": database_arg(),
            "code": {"type": "string"}
        }, "required": ["connection", "code"]}
    })
}

pub(super) struct Limits {
    pub time: Duration,
    pub statements: usize,
    pub parallel: usize,
    pub rows: usize,
    pub total_rows: usize,
    pub memory: usize,
    pub stack: usize,
}

impl Limits {
    pub fn new(config: &McpConfig) -> Self {
        Self {
            time: Duration::from_secs(config.query_timeout.saturating_mul(4).max(120)),
            statements: 500,
            parallel: 4,
            rows: 10_000,
            total_rows: 250_000,
            memory: 64 << 20,
            stack: 1 << 20,
        }
    }
}

pub(super) fn supported(connection: &McpConnection) -> Result<(), String> {
    if SQL_KINDS.contains(&connection.kind) {
        Ok(())
    } else {
        Err(format!(
            "code unterstützt nur SQL-Verbindungen; für '{}' query nutzen.",
            connection.name
        ))
    }
}

#[derive(Default)]
struct Session {
    calls: usize,
    statements: usize,
    lookups: usize,
    rows: usize,
    notes: Vec<String>,
    stderr: Vec<u8>,
    sent: usize,
    touched: Vec<McpConnection>,
}

fn deliver(
    tx: &tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    session: &mut Session,
    id: u64,
    result: Result<String, String>,
) {
    let line = match result {
        Ok(json) if session.sent + json.len() > MAX_SENT => reply(
            id,
            Err(format!(
                "Datenbudget von {} MB pro code-Lauf erschöpft; aggregieren statt Daten laden.",
                MAX_SENT >> 20
            )),
        ),
        other => reply(id, other),
    };
    session.sent += line.len();
    let _ = tx.send(line);
}

struct Prepared {
    id: u64,
    number: usize,
    connection: McpConnection,
    sql: String,
    adapter: Box<dyn DatabaseAdapter>,
    redactor: Redactor,
    limit: usize,
}

struct Finished {
    prepared: Prepared,
    result: Result<QueryResult, String>,
    started: Instant,
}

enum Step {
    Reply(Result<Value, String>),
    Run(Box<Prepared>),
}

#[cfg(test)]
pub(super) mod probe {
    use std::cell::Cell;
    thread_local! {
        pub static RUNNING: Cell<usize> = const { Cell::new(0) };
        pub static PEAK: Cell<usize> = const { Cell::new(0) };
        pub static EXECUTED: Cell<usize> = const { Cell::new(0) };
        pub static PID: Cell<u32> = const { Cell::new(0) };
    }

    pub fn reset() {
        RUNNING.set(0);
        PEAK.set(0);
        EXECUTED.set(0);
    }
}

fn execute(prepared: Prepared, config: McpConfig) -> BoxFuture<'static, Finished> {
    Box::pin(async move {
        #[cfg(test)]
        {
            probe::RUNNING.set(probe::RUNNING.get() + 1);
            probe::PEAK.set(probe::PEAK.get().max(probe::RUNNING.get()));
            probe::EXECUTED.set(probe::EXECUTED.get() + 1);
        }
        let started = Instant::now();
        let result = db::execution::with_row_limit(
            prepared.limit + 1,
            run(
                &config,
                prepared.connection.kind,
                prepared.adapter.execute_query(&prepared.sql),
            ),
        )
        .await;
        #[cfg(test)]
        probe::RUNNING.set(probe::RUNNING.get() - 1);
        Finished {
            prepared,
            result,
            started,
        }
    })
}

fn worker() -> Result<Command, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Sandbox nicht gefunden: {e}"))?;
    #[cfg(test)]
    let exe = std::env::var_os("L8DB_TEST_SANDBOX_EXE").map_or(exe, std::path::PathBuf::from);
    let mut command = crate::process::command(&exe);
    command.env_clear();
    #[cfg(windows)]
    if let Some(root) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", root);
    }
    #[cfg(target_os = "linux")]
    if let Some(path) = std::env::var_os("LD_LIBRARY_PATH") {
        command.env("LD_LIBRARY_PATH", path);
    }
    #[cfg(test)]
    if std::env::var_os("L8DB_TEST_SANDBOX_EXE").is_none() {
        command.env("L8DB_CODE_WORKER", "1").args([
            "mcp::code_worker::tests::worker_entry",
            "--exact",
            "--ignored",
            "--nocapture",
            "--test-threads=1",
            "-q",
        ]);
        return Ok(command);
    }
    command.arg("--mcp-sandbox");
    Ok(command)
}

fn spawn() -> Result<Child, String> {
    let child = worker()?
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Sandbox konnte nicht starten: {e}"))?;
    #[cfg(test)]
    probe::PID.set(child.id().unwrap_or(0));
    Ok(child)
}

async fn next_line(
    reader: &mut BufReader<ChildStdout>,
    buf: &mut Vec<u8>,
) -> Result<Option<Vec<u8>>, String> {
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|e| format!("Sandbox-Ausgabe nicht lesbar: {e}"))?;
        if available.is_empty() {
            return Ok(None);
        }
        let (taken, done) = match available.iter().position(|byte| *byte == b'\n') {
            Some(at) => (at, true),
            None => (available.len(), false),
        };
        buf.extend_from_slice(&available[..taken]);
        reader.consume(taken + usize::from(done));
        if buf.len() > MAX_MESSAGE {
            return Err("Sandbox-Nachricht zu groß; Lauf abgebrochen.".into());
        }
        if done {
            return Ok(Some(std::mem::take(buf)));
        }
    }
}

fn reply(id: u64, result: Result<String, String>) -> Vec<u8> {
    let mut line = match result {
        Ok(json) => format!("{id}\t{json}"),
        Err(error) => format!("{id}\t!{}", Value::String(scrub_error(&error))),
    };
    line.push('\n');
    line.into_bytes()
}

fn column_names(result: &QueryResult) -> Vec<String> {
    let mut names: Vec<String> = Vec::with_capacity(result.columns.len());
    for column in &result.columns {
        let mut name = column.clone();
        let mut suffix = 2;
        while names.contains(&name) {
            name = format!("{column}_{suffix}");
            suffix += 1;
        }
        names.push(name);
    }
    names
}

fn rows_json(result: &QueryResult, redactor: &Redactor, limit: usize) -> (String, usize) {
    let names = column_names(result);
    let mut out = String::from("[");
    let mut shown = 0;
    for row in result.rows.iter().take(limit) {
        let mut object = Map::new();
        for (index, column) in result.columns.iter().enumerate() {
            let value = match row {
                Value::Object(map) => map.get(column).cloned().unwrap_or(Value::Null),
                Value::Array(list) => list.get(index).cloned().unwrap_or(Value::Null),
                other => other.clone(),
            };
            object.insert(names[index].clone(), redactor.redact_cell(column, &value));
        }
        let text = Value::Object(object).to_string();
        if out.len() + text.len() + 2 > MAX_REPLY {
            break;
        }
        if shown > 0 {
            out.push(',');
        }
        out.push_str(&text);
        shown += 1;
    }
    out.push(']');
    (out, shown)
}

fn string_literal(kind: DatabaseKind, text: &str) -> Result<String, String> {
    if text.contains('\0') {
        return Err("sql: Zeichenkette mit NUL-Zeichen".into());
    }
    let doubled = || format!("'{}'", text.replace('\'', "''"));
    let backslashed = || format!("'{}'", text.replace('\\', "\\\\").replace('\'', "\\'"));
    Ok(match kind {
        DatabaseKind::Postgres if text.contains('\\') => {
            format!("E'{}'", text.replace('\\', "\\\\").replace('\'', "''"))
        }
        DatabaseKind::Mysql => format!("'{}'", text.replace('\\', "\\\\").replace('\'', "''")),
        DatabaseKind::Mssql => format!("N{}", doubled()),
        DatabaseKind::Clickhouse | DatabaseKind::Snowflake | DatabaseKind::Bigquery => {
            backslashed()
        }
        DatabaseKind::Postgres
        | DatabaseKind::Sqlite
        | DatabaseKind::SqliteHttp
        | DatabaseKind::Duckdb
        | DatabaseKind::Oracle
        | DatabaseKind::Athena
        | DatabaseKind::Cassandra => doubled(),
        _ if text.contains(['\'', '\\']) => return Err(
            "sql: Werte mit ' oder \\ werden für diese Verbindung nicht eingesetzt; query nutzen."
                .into(),
        ),
        _ => doubled(),
    })
}

fn identifier(kind: DatabaseKind, parts: &[Value]) -> Result<String, String> {
    let parts: Vec<&str> = parts
        .iter()
        .map(|part| {
            part.as_str()
                .filter(|text| !text.is_empty() && !text.contains('\0'))
        })
        .collect::<Option<_>>()
        .filter(|parts: &Vec<&str>| !parts.is_empty())
        .ok_or("sql: id() braucht nicht-leere Namen")?;
    Ok(parts
        .iter()
        .map(|part| match kind {
            DatabaseKind::Mysql => format!("`{}`", part.replace('`', "``")),
            DatabaseKind::Mssql => format!("[{}]", part.replace(']', "]]")),
            DatabaseKind::Clickhouse | DatabaseKind::Bigquery => {
                format!("`{}`", part.replace('\\', "\\\\").replace('`', "\\`"))
            }
            _ => db::quote_ident(part),
        })
        .collect::<Vec<_>>()
        .join("."))
}

fn literal(kind: DatabaseKind, value: &Value, nested: bool) -> Result<String, String> {
    let bad = || "sql: ungültiger Wert im Template".to_string();
    let object = match value {
        Value::Null => return Ok("NULL".into()),
        Value::Object(object) if object.len() == 1 => object,
        _ => return Err(bad()),
    };
    let Some((tag, inner)) = object.iter().next() else {
        return Err(bad());
    };
    let number = |text: String| {
        if text.starts_with('-') {
            format!("({text})")
        } else {
            text
        }
    };
    match (tag.as_str(), inner) {
        ("s", Value::String(text)) => string_literal(kind, text),
        ("n", Value::Number(value)) => Ok(number(value.to_string())),
        ("n", Value::String(digits))
            if !digits.is_empty()
                && digits
                    .strip_prefix('-')
                    .unwrap_or(digits)
                    .chars()
                    .all(|c| c.is_ascii_digit())
                && digits != "-" =>
        {
            Ok(number(digits.clone()))
        }
        ("b", Value::Bool(flag)) => Ok(match (kind, flag) {
            (DatabaseKind::Mssql | DatabaseKind::Oracle, true) => "1".into(),
            (DatabaseKind::Mssql | DatabaseKind::Oracle, false) => "0".into(),
            (_, true) => "TRUE".into(),
            (_, false) => "FALSE".into(),
        }),
        ("i", Value::Array(parts)) if !nested => identifier(kind, parts),
        ("l", Value::Array(items)) if !nested => {
            if items.is_empty() {
                return Ok("(NULL)".into());
            }
            let items = items
                .iter()
                .map(|item| literal(kind, item, true))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("({})", items.join(", ")))
        }
        _ => Err(bad()),
    }
}

pub(super) fn compose(kind: DatabaseKind, args: &Value) -> Result<String, String> {
    let parts = args["parts"].as_array().ok_or("sql: Template fehlt")?;
    let values = args["values"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    if parts.len() != values.len() + 1 {
        return Err("sql: Template ungültig".into());
    }
    let mut out = String::new();
    for (index, part) in parts.iter().enumerate() {
        out.push_str(
            part.as_str()
                .ok_or("sql: ungültige Escape-Sequenz im Template")?,
        );
        if let Some(value) = values.get(index) {
            out.push_str(&literal(kind, value, false)?);
        }
    }
    Ok(out)
}

enum Matcher {
    Any,
    Glob(String),
    Pattern(regex::Regex),
}

impl Matcher {
    fn new(value: &Value) -> Result<Self, String> {
        match value {
            Value::Null => Ok(Self::Any),
            Value::String(text) if text.trim().is_empty() => Ok(Self::Any),
            Value::String(text) => Ok(Self::Glob(text.trim().to_string())),
            Value::Object(object) => {
                let source = object["re"].as_str().ok_or("Filter: RegExp ungültig")?;
                regex::RegexBuilder::new(source)
                    .case_insensitive(object["i"] == true)
                    .size_limit(1 << 20)
                    .build()
                    .map(Self::Pattern)
                    .map_err(|e| format!("Filter-RegExp wird nicht unterstützt (Rust-Syntax, ohne Lookaround): {e}"))
            }
            _ => Err("Filter: Text oder RegExp erwartet".into()),
        }
    }

    fn any(&self) -> bool {
        matches!(self, Self::Any)
    }

    fn hit(&self, text: &str) -> bool {
        match self {
            Self::Any => true,
            Self::Glob(pattern) => glob(pattern, text),
            Self::Pattern(re) => re.is_match(text),
        }
    }
}

fn limit_of(args: &Value) -> usize {
    args["limit"]
        .as_u64()
        .unwrap_or(CATALOG_LIMIT)
        .clamp(1, RESULT_ITEMS as u64) as usize
}

fn capped(
    mut items: Vec<Value>,
    total: usize,
    what: &str,
    limit: usize,
    args: &Value,
) -> (Value, Option<String>) {
    items.truncate(limit);
    let note = (total > limit && args["limit"].is_null()).then(|| {
        format!("catalog.{what}: {limit} of {total} returned; pass limit or narrow the filter")
    });
    (Value::Array(items), note)
}

fn target(config: &McpConfig, home: &McpConnection, args: &Value) -> Result<McpConnection, String> {
    let name = arg_str(args, "c").trim();
    let base = if name.is_empty() {
        home.clone()
    } else {
        find_connection(config, name)?.clone()
    };
    let connection = match arg_str(args, "d").trim() {
        "" => base,
        database => with_database(&base, &json!({"database": database}))?,
    };
    supported(&connection)?;
    Ok(connection)
}

impl Server {
    pub(super) async fn code(
        &mut self,
        config: &McpConfig,
        args: &Value,
    ) -> Result<String, String> {
        let code = arg_str(args, "code");
        if code.trim().is_empty() {
            return Err("code fehlt: async () => { … }".into());
        }
        if code.len() > MAX_CODE {
            return Err(format!(
                "code ist zu lang (höchstens {} KB).",
                MAX_CODE >> 10
            ));
        }
        let home = find_connection(config, arg_str(args, "connection"))
            .and_then(|connection| with_database(connection, args))?;
        supported(&home)?;
        self.code_with(config, &home, code, &Limits::new(config))
            .await
    }

    pub(super) async fn code_with(
        &mut self,
        config: &McpConfig,
        home: &McpConnection,
        code: &str,
        limits: &Limits,
    ) -> Result<String, String> {
        let started = Instant::now();
        let mut session = Session::default();
        let mut child = spawn()?;
        let outcome = self
            .drive(config, home, code, limits, &mut child, &mut session)
            .await;
        let settled =
            matches!(&outcome, Ok(message) if message["t"] == "done" || message["t"] == "error");
        if !settled
            || tokio::time::timeout(Duration::from_secs(1), child.wait())
                .await
                .is_err()
        {
            let _ = child.kill().await;
        }
        for connection in std::mem::take(&mut session.touched) {
            self.flush(config, &connection);
        }
        render(config, code, outcome, &session, started)
    }

    async fn drive(
        &mut self,
        config: &McpConfig,
        home: &McpConnection,
        code: &str,
        limits: &Limits,
        child: &mut Child,
        session: &mut Session,
    ) -> Result<Value, String> {
        let deadline = tokio::time::Instant::now() + limits.time + GRACE;
        let mut reader =
            BufReader::with_capacity(64 << 10, child.stdout.take().ok_or("Sandbox ohne Ausgabe")?);
        let mut stdin = child.stdin.take().ok_or("Sandbox ohne Eingabe")?;
        let mut stderr = child.stderr.take().ok_or("Sandbox ohne Fehlerkanal")?;
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let writer = async move {
            while let Some(line) = rx.recv().await {
                if stdin.write_all(&line).await.is_err() || stdin.flush().await.is_err() {
                    break;
                }
            }
        };
        tokio::pin!(writer);
        let mut init = serde_json::to_vec(&json!({
            "code": code,
            "ms": limits.time.as_millis() as u64,
            "memory": limits.memory,
            "stack": limits.stack,
            "chars": RESULT_CHARS,
            "items": RESULT_ITEMS,
        }))
        .map_err(|e| e.to_string())?;
        init.push(b'\n');
        let _ = tx.send(init);
        let mut buf = Vec::new();
        let mut chunk = [0u8; 512];
        let mut running: FuturesUnordered<BoxFuture<'static, Finished>> = FuturesUnordered::new();
        let mut queue: VecDeque<Prepared> = VecDeque::new();
        let mut written = false;
        let mut stderr_open = true;
        let mut ready = false;
        let mut preamble = 0usize;
        loop {
            tokio::select! {
                _ = tokio::time::sleep_until(deadline) => {
                    return Err(format!("Zeitlimit von {} s überschritten; Sandbox beendet.", limits.time.as_secs()));
                }
                _ = &mut writer, if !written => written = true,
                read = stderr.read(&mut chunk), if stderr_open => match read {
                    Ok(0) | Err(_) => stderr_open = false,
                    Ok(n) => {
                        let room = STDERR.saturating_sub(session.stderr.len());
                        session.stderr.extend_from_slice(&chunk[..n.min(room)]);
                    }
                },
                Some(done) = running.next() => {
                    let (id, result) = finished(done, session);
                    deliver(&tx, session, id, result);
                    while running.len() < limits.parallel {
                        let Some(next) = queue.pop_front() else { break };
                        if session.rows >= limits.total_rows {
                            deliver(&tx, session, next.id, Err(rows_spent(limits)));
                            continue;
                        }
                        running.push(execute(next, config.clone()));
                    }
                }
                line = next_line(&mut reader, &mut buf) => {
                    let Some(line) = line? else {
                        let detail = String::from_utf8_lossy(&session.stderr).trim().to_string();
                        return Err(if detail.is_empty() {
                            "Sandbox wurde unerwartet beendet.".into()
                        } else {
                            format!("Sandbox wurde unerwartet beendet: {}", detail.chars().take(500).collect::<String>())
                        });
                    };
                    let message = serde_json::from_slice::<Value>(&line).ok().filter(Value::is_object);
                    if !ready {
                        ready = message.as_ref().is_some_and(|message| message["t"] == "ready");
                        preamble += line.len() + 1;
                        if !ready && preamble > PREAMBLE {
                            return Err("Sandbox-Protokoll verletzt; Lauf abgebrochen.".into());
                        }
                        continue;
                    }
                    let Some(message) = message else {
                        return Err("Sandbox-Protokoll verletzt; Lauf abgebrochen.".into());
                    };
                    match message["t"].as_str() {
                        Some("done" | "error") => return Ok(message),
                        Some("call") => {
                            let (Some(id), Some(op), Some(args)) = (
                                message["id"].as_u64(),
                                message["op"].as_str(),
                                message.get("a").filter(|args| args.is_object()),
                            ) else {
                                return Err("Sandbox-Protokoll verletzt; Lauf abgebrochen.".into());
                            };
                            session.calls += 1;
                            let step = if session.calls > MAX_CALLS {
                                Step::Reply(Err(format!("Höchstens {MAX_CALLS} Aufrufe pro code-Lauf.")))
                            } else {
                                match tokio::time::timeout_at(deadline, self.step(config, home, id, op, args, session, limits)).await {
                                    Ok(step) => step,
                                    Err(_) => return Err(format!("Zeitlimit von {} s überschritten; Sandbox beendet.", limits.time.as_secs())),
                                }
                            };
                            match step {
                                Step::Reply(result) => {
                                    deliver(&tx, session, id, result.map(|value| value.to_string()));
                                }
                                Step::Run(prepared) if running.len() < limits.parallel => {
                                    running.push(execute(*prepared, config.clone()));
                                }
                                Step::Run(prepared) => queue.push_back(*prepared),
                            }
                        }
                        _ => return Err("Sandbox-Protokoll verletzt; Lauf abgebrochen.".into()),
                    }
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn step(
        &mut self,
        config: &McpConfig,
        home: &McpConnection,
        id: u64,
        op: &str,
        args: &Value,
        session: &mut Session,
        limits: &Limits,
    ) -> Step {
        let connection = match target(config, home, args) {
            Ok(connection) => connection,
            Err(error) => return Step::Reply(Err(error)),
        };
        match op {
            "sql" | "query" | "explain" => {
                if session.statements >= limits.statements {
                    return Step::Reply(Err(format!(
                        "Höchstens {} Statements pro code-Lauf.",
                        limits.statements
                    )));
                }
                if session.rows >= limits.total_rows {
                    return Step::Reply(Err(rows_spent(limits)));
                }
                let sql = match op {
                    "sql" => compose(connection.kind, args),
                    _ => Ok(arg_str(args, "text").trim().to_string()),
                };
                let sql = match sql {
                    Ok(sql) if !sql.trim().is_empty() => sql,
                    Ok(_) => return Step::Reply(Err("sql fehlt".into())),
                    Err(error) => return Step::Reply(Err(error)),
                };
                session.statements += 1;
                let guarded = McpConnection {
                    read_only: true,
                    ..connection
                };
                let started = Instant::now();
                if op == "explain" {
                    let result = self
                        .explain(config, &guarded, &json!({"sql": sql, "analyze": false}))
                        .await;
                    audit(&guarded, "code", &sql, &result, started);
                    return Step::Reply(result.map(Value::String));
                }
                match self.prepare(config, &guarded, &sql).await {
                    Ok((adapter, redactor)) => Step::Run(Box::new(Prepared {
                        id,
                        number: session.statements,
                        connection: guarded,
                        sql,
                        adapter,
                        redactor,
                        limit: args["limit"]
                            .as_u64()
                            .map_or(limits.rows, |limit| limit as usize)
                            .clamp(1, limits.rows),
                    })),
                    Err(error) => {
                        audit(&guarded, "code", &sql, &Err(error.clone()), started);
                        Step::Reply(Err(error))
                    }
                }
            }
            "schemas" | "tables" | "columns" | "routines" | "source" | "grep" | "references"
            | "path" => {
                if session.lookups >= limits.statements {
                    return Step::Reply(Err(format!(
                        "Höchstens {} Katalogaufrufe pro code-Lauf.",
                        limits.statements
                    )));
                }
                session.lookups += 1;
                if !session
                    .touched
                    .iter()
                    .any(|seen| seen.id == connection.id && seen.database == connection.database)
                {
                    session.touched.push(connection.clone());
                }
                match self.catalog_call(config, &connection, op, args).await {
                    Ok((value, note)) => {
                        session.notes.extend(note);
                        Step::Reply(Ok(value))
                    }
                    Err(error) => Step::Reply(Err(error)),
                }
            }
            other => Step::Reply(Err(format!("Unbekannte Funktion '{other}'."))),
        }
    }

    async fn prepare(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        sql: &str,
    ) -> Result<(Box<dyn DatabaseAdapter>, Redactor), String> {
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let index = self.schema_index(config, connection, &redactor).await?;
        check_read_sql(sql, connection, &index)?;
        Ok((adapter(connection, &self.pool)?, redactor))
    }

    async fn catalog_call(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        op: &str,
        args: &Value,
    ) -> Result<(Value, Option<String>), String> {
        if op == "path" {
            let text = self
                .relations(
                    config,
                    connection,
                    &json!({"from": args["from"], "to": args["to"]}),
                )
                .await?;
            return Ok((Value::String(text), None));
        }
        let catalog = self.catalog(config, connection).await?;
        let objects = self.objects(config, connection, &catalog).await;
        if matches!(op, "source" | "grep") {
            self.list_schemas(config, connection, &catalog).await;
        }
        let keys = match op {
            "references" => self.keys(config, connection, &catalog).await,
            _ => None,
        };
        let view = View::with(
            &catalog,
            connection.allowed_schemas(),
            objects,
            Notes::default(),
        );
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        match op {
            "schemas" => Ok((schemas(&view), None)),
            "tables" => tables(&view, args),
            "columns" => columns(&view, args),
            "routines" => routines(&view, args),
            "references" => {
                let graph = keys
                    .is_none()
                    .then(|| super::insight::cached(connection))
                    .flatten();
                let edges = match (&keys, &graph) {
                    (Some(keys), _) => keys.edges.as_slice(),
                    (None, Some(graph)) => graph.edges.as_slice(),
                    _ => {
                        return Err(
                            "Fremdschlüssel sind für diese Verbindung nicht verfügbar.".into()
                        )
                    }
                };
                references(&view, edges, arg_str(args, "table"), config.max_chars)
            }
            "source" => {
                let excerpt = Excerpt::parse(arg_str(args, "lines"))?;
                let objects = view.objects.clone();
                let target = source_target(
                    &view,
                    objects.as_deref(),
                    arg_str(args, "name"),
                    config.max_chars,
                )?;
                let adapter = adapter(connection, &self.pool)?;
                let text = cached_source(
                    config,
                    connection.kind,
                    view.catalog,
                    adapter.as_ref(),
                    &target,
                )
                .await?;
                let lines: Vec<&str> = text.lines().collect();
                let (from, to) = excerpt.range(lines.len());
                let shown: Vec<String> = lines
                    .iter()
                    .take(to)
                    .skip(from.saturating_sub(1))
                    .map(|line| {
                        if view.hides(line) {
                            "[line references a hidden schema]".to_string()
                        } else {
                            redactor.redact_text(line.trim_end())
                        }
                    })
                    .collect();
                Ok((
                    json!({"text": shown.join("\n"), "from": from, "to": to, "total": lines.len()}),
                    None,
                ))
            }
            _ => {
                let (hits, _, note) = self
                    .source_matches(config, connection, &view, arg_str(args, "term"))
                    .await?;
                let kinds = Kind::filter(arg_str(args, "kind"))?;
                let limit = args["limit"].as_u64().unwrap_or(200).clamp(1, 2_000) as usize;
                let mut hits: Vec<_> = hits
                    .into_iter()
                    .filter(|hit| allowed(&hit.schema, view.allowed))
                    .filter(|hit| kinds.is_empty() || kinds.contains(&hit.kind))
                    .collect();
                hits.sort_by(|a, b| {
                    (&a.schema, &a.name, a.line).cmp(&(&b.schema, &b.name, b.line))
                });
                let total = hits.len();
                let items = hits
                    .into_iter()
                    .take(limit)
                    .map(|hit| {
                        let text = if view.hides(&hit.snippet) {
                            "[line references a hidden schema]".to_string()
                        } else {
                            redactor.redact_text(&hit.snippet)
                        };
                        json!({"object": qualified(&hit.schema, hit.name.split('(').next().unwrap_or("")), "kind": hit.kind.code(), "line": hit.line, "text": text, "count": hit.occurrences})
                    })
                    .collect();
                let (value, capped_note) = capped(items, total, "grep", limit, args);
                Ok((value, capped_note.or(note.map(str::to_string))))
            }
        }
    }
}

fn source_target<'a>(
    view: &'a View,
    objects: Option<&'a super::catalog::Objects>,
    name: &str,
    max_chars: usize,
) -> Result<super::objects::Target<'a>, String> {
    use super::objects::Target;
    let found = resolve(view, name, max_chars).map_err(|missing| match missing {
        Missing::Unknown(text) | Missing::Ambiguous(text) => text,
    })?;
    let tables = view.catalog.tables();
    match (found, objects) {
        (Found::Table(index), _) => {
            let table = &tables.list[index];
            let (schema, name) = (tables.schema(table), tables.name(table));
            match view.kind(schema, name) {
                kind @ (Kind::View | Kind::Matview) => Ok(Target::Relation(schema, name, kind)),
                _ => Err(format!(
                    "{} ist eine Tabelle ohne Quelltext.",
                    qualified(schema, name)
                )),
            }
        }
        (Found::Relation(index), Some(objects)) => {
            let entry = &objects.relations[index];
            Ok(Target::Relation(&entry.schema, &entry.name, entry.kind))
        }
        (Found::Routine(index), Some(objects)) => Ok(Target::Routine(&objects.routines[index])),
        (Found::Trigger(index), Some(objects)) => Ok(Target::Trigger(&objects.triggers[index])),
        _ => Err(format!("Objekt '{name}' nicht gefunden.")),
    }
}

fn schemas(view: &View) -> Value {
    let tables = view.catalog.tables();
    let stats = super::overview::stats(view);
    Value::Array(
        tables
            .schemas
            .iter()
            .zip(&stats)
            .filter(|(name, stat)| {
                allowed(&name.original, view.allowed)
                    && (stat.tables > 0 || stat.views > 0 || stat.routines > 0)
            })
            .map(|(name, stat)| {
                let mut entry = Map::new();
                entry.insert("name".into(), json!(name.original));
                entry.insert("tables".into(), json!(stat.tables));
                for (key, value) in [
                    ("rows", stat.rows),
                    ("bytes", stat.bytes),
                    ("views", stat.views as i64),
                    ("routines", stat.routines as i64),
                ] {
                    if value > 0 {
                        entry.insert(key.into(), json!(value));
                    }
                }
                Value::Object(entry)
            })
            .collect(),
    )
}

fn tables(view: &View, args: &Value) -> Result<(Value, Option<String>), String> {
    let tables = view.catalog.tables();
    let schema = Matcher::new(&args["schema"])?;
    let name = Matcher::new(&args["name"])?;
    let column = Matcher::new(&args["column"])?;
    let kinds = Kind::filter(arg_str(args, "kind"))?;
    let min_rows = args["minRows"].as_f64();
    let limit = limit_of(args);
    let mut found: Vec<(Option<i64>, usize)> = Vec::new();
    for (index, table) in tables.list.iter().enumerate() {
        if !tables.visible(table, view.allowed) {
            continue;
        }
        let (schema_name, table_name) = (tables.schema(table), tables.name(table));
        if !schema.hit(schema_name) || !name.hit(table_name) {
            continue;
        }
        let relation = view.relation(schema_name, table_name);
        let kind = relation.map_or(Kind::Table, |entry| entry.kind);
        if !kinds.is_empty() && !kinds.contains(&kind) {
            continue;
        }
        let rows = relation.and_then(|entry| entry.rows);
        if min_rows.is_some_and(|min| rows.is_none_or(|rows| (rows as f64) < min)) {
            continue;
        }
        if !column.any()
            && !table
                .columns
                .iter()
                .any(|&at| column.hit(&view.catalog.columns[at as usize].name))
        {
            continue;
        }
        found.push((rows, index));
    }
    found.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let total = found.len();
    let items = found
        .into_iter()
        .take(limit)
        .map(|(rows, index)| {
            let table = &tables.list[index];
            let (schema_name, table_name) = (tables.schema(table), tables.name(table));
            let relation = view.relation(schema_name, table_name);
            let mut entry = Map::new();
            entry.insert("schema".into(), json!(schema_name));
            entry.insert("name".into(), json!(table_name));
            entry.insert(
                "kind".into(),
                json!(relation.map_or(Kind::Table, |entry| entry.kind).code()),
            );
            if let Some(rows) = rows {
                entry.insert("rows".into(), json!(rows));
            }
            if let Some(bytes) = relation.and_then(|entry| entry.bytes) {
                entry.insert("bytes".into(), json!(bytes));
            }
            entry.insert("columns".into(), json!(table.columns.len()));
            Value::Object(entry)
        })
        .collect();
    Ok(capped(items, total, "tables", limit, args))
}

fn columns(view: &View, args: &Value) -> Result<(Value, Option<String>), String> {
    let tables = view.catalog.tables();
    let schema = Matcher::new(&args["schema"])?;
    let table_name = Matcher::new(&args["table"])?;
    let name = Matcher::new(&args["name"])?;
    let data_type = Matcher::new(&args["type"])?;
    let limit = limit_of(args);
    let mut total = 0;
    let mut items = Vec::new();
    for table in &tables.list {
        if !tables.visible(table, view.allowed)
            || !schema.hit(tables.schema(table))
            || !table_name.hit(tables.name(table))
        {
            continue;
        }
        for &at in &table.columns {
            let column = &view.catalog.columns[at as usize];
            if !name.hit(&column.name) || !data_type.hit(&column.data_type) {
                continue;
            }
            total += 1;
            if items.len() < limit {
                items.push(json!({"schema": column.schema, "table": column.table, "name": column.name, "type": column.data_type}));
            }
        }
    }
    Ok(capped(items, total, "columns", limit, args))
}

fn routines(view: &View, args: &Value) -> Result<(Value, Option<String>), String> {
    let schema = Matcher::new(&args["schema"])?;
    let name = Matcher::new(&args["name"])?;
    let kinds = Kind::filter(arg_str(args, "kind"))?;
    let limit = limit_of(args);
    let Some(objects) = &view.objects else {
        return Ok((json!([]), None));
    };
    let found: Vec<&super::catalog::Routine> = objects
        .routines
        .iter()
        .filter(|entry| allowed(&entry.schema, view.allowed))
        .filter(|entry| schema.hit(&entry.schema) && name.hit(&entry.name))
        .filter(|entry| kinds.is_empty() || kinds.contains(&entry.kind))
        .collect();
    let total = found.len();
    let items = found
        .into_iter()
        .take(limit)
        .map(|entry| {
            let mut item = Map::new();
            item.insert("schema".into(), json!(entry.schema));
            item.insert("name".into(), json!(entry.name));
            item.insert("kind".into(), json!(entry.kind.code()));
            item.insert("args".into(), json!(mask_hidden(&entry.args, view.allowed)));
            item.insert(
                "returns".into(),
                json!(mask_hidden(&entry.returns, view.allowed)),
            );
            if !entry.language.is_empty() {
                item.insert("language".into(), json!(entry.language));
            }
            if let Some(lines) = entry.lines {
                item.insert("lines".into(), json!(lines));
            }
            Value::Object(item)
        })
        .collect();
    Ok(capped(items, total, "routines", limit, args))
}

fn references(
    view: &View,
    edges: &[super::insight::Edge],
    table: &str,
    max_chars: usize,
) -> Result<(Value, Option<String>), String> {
    let tables = view.catalog.tables();
    let me = match resolve(view, table, max_chars) {
        Ok(Found::Table(index)) => {
            let entry = &tables.list[index];
            (
                tables.schema(entry).to_string(),
                tables.name(entry).to_string(),
            )
        }
        Ok(_) => return Err(format!("'{table}' ist keine Tabelle.")),
        Err(Missing::Unknown(text) | Missing::Ambiguous(text)) => return Err(text),
    };
    let items = edges
        .iter()
        .filter(|edge| edge.from == me || edge.to == me)
        .filter(|edge| allowed(&edge.from.0, view.allowed) && allowed(&edge.to.0, view.allowed))
        .map(|edge| {
            let from = qualified(&edge.from.0, &edge.from.1);
            let to = qualified(&edge.to.0, &edge.to.1);
            let on = edge
                .pairs
                .iter()
                .map(|(left, right)| format!("{from}.{left} = {to}.{right}"))
                .collect::<Vec<_>>()
                .join(" AND ");
            json!({"from": from, "to": to, "on": on})
        })
        .collect();
    Ok((Value::Array(items), None))
}

fn rows_spent(limits: &Limits) -> String {
    format!(
        "Zeilenbudget von {} gelesenen Zeilen pro code-Lauf erschöpft; aggregieren statt Zeilen laden.",
        limits.total_rows
    )
}

fn finished(done: Finished, session: &mut Session) -> (u64, Result<String, String>) {
    let Finished {
        prepared,
        result,
        started,
    } = done;
    let logged = result
        .as_ref()
        .map(|result| format!("{} rows", result.rows.len()))
        .map_err(Clone::clone);
    audit(
        &prepared.connection,
        "code",
        &prepared.sql,
        &logged,
        started,
    );
    let result = match result {
        Ok(result) => result,
        Err(error) => return (prepared.id, Err(error)),
    };
    session.rows += result.rows.len();
    let (json, shown) = rows_json(&result, &prepared.redactor, prepared.limit);
    if shown < result.rows.len() || result.truncated {
        session.notes.push(format!(
            "statement {}: only the first {shown} rows passed to code; filter or aggregate in SQL",
            prepared.number
        ));
    }
    (prepared.id, Ok(json))
}

fn flat(value: &Value) -> bool {
    value.as_object().is_some_and(|object| {
        !object.is_empty()
            && object
                .values()
                .all(|cell| !cell.is_object() && !cell.is_array())
    })
}

fn result_text(message: &Value, config: &McpConfig, room: usize) -> String {
    if let Some(text) = message["s"].as_str() {
        return format!(
            "{text}\n[result cut at {} of {} chars]",
            text.chars().count(),
            message["n"]
        );
    }
    let value = &message["v"];
    let mut text = match value {
        Value::String(text) => text.clone(),
        Value::Array(items) if !items.is_empty() && items.iter().all(flat) => {
            let mut columns: Vec<String> = Vec::new();
            for item in items {
                for key in item
                    .as_object()
                    .into_iter()
                    .flat_map(|object| object.keys())
                {
                    if columns.len() < 200 && !columns.contains(key) {
                        columns.push(key.clone());
                    }
                }
            }
            let table = QueryResult {
                columns,
                rows: items.clone(),
                rows_affected: None,
                execution_time_ms: 0,
                truncated: false,
            };
            let config = McpConfig {
                max_chars: room,
                ..config.clone()
            };
            format_result(
                &table,
                &config,
                &Redactor::new(&config.redaction, &[]),
                items.len(),
            )
        }
        other => other.to_string(),
    };
    if let Some(total) = message["n"].as_u64() {
        let shown = value.as_array().map_or(0, Vec::len);
        text.push_str(&format!(
            "\n[the returned array had {total} items; the first {shown} came back, aggregate or slice in code]"
        ));
    }
    text
}

fn render(
    config: &McpConfig,
    code: &str,
    outcome: Result<Value, String>,
    session: &Session,
    started: Instant,
) -> Result<String, String> {
    let footer = format!(
        "({} statements, {} rows read, {:.1} s)",
        session.statements,
        session.rows,
        started.elapsed().as_secs_f64()
    );
    let mut extra = String::new();
    for note in &session.notes {
        extra.push_str(&format!("\n[{note}]"));
    }
    let values = Redactor::new(&config.redaction, &[]);
    let message = outcome.as_ref().ok();
    let logs: Vec<&str> = message
        .and_then(|message| message["log"].as_array())
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    if !logs.is_empty() {
        let mut section = format!("\nconsole:\n{}", values.redact_text(&logs.join("\n")));
        if let Some(dropped) = message.and_then(|message| message["dropped"].as_u64()) {
            section.push_str(&format!("\n[{dropped} more console lines dropped]"));
        }
        extra.push_str(&cap(section, LOG_CHARS));
    }
    let room = config
        .max_chars
        .saturating_sub(extra.chars().count() + footer.len() + 2)
        .max(500);
    match outcome {
        Err(error) => Err(cap(format!("{error}{extra}\n{footer}"), config.max_chars)),
        Ok(message) if message["t"] == "error" => {
            let mut text =
                values.redact_text(&scrub_error(message["e"].as_str().unwrap_or("Fehler")));
            if let Some(line) = message["line"].as_u64() {
                let source = code
                    .lines()
                    .nth(line.saturating_sub(1) as usize)
                    .unwrap_or("")
                    .trim()
                    .chars()
                    .take(160)
                    .collect::<String>();
                text.push_str(&format!("\nline {line}: {source}"));
            }
            Err(cap(format!("{text}{extra}\n{footer}"), config.max_chars))
        }
        Ok(message) => Ok(format!(
            "{}{extra}\n{footer}",
            cap(
                values.redact_text(&result_text(&message, config, room)),
                room
            )
        )),
    }
}
