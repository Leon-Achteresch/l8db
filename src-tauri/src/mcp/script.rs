use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use super::config::{McpConfig, McpConnection};
use super::redact::Redactor;
use super::server::{
    adapter, arg_str, cap, check_read_sql, check_write_sql, connection_url, format_result, run,
    Server,
};
use crate::db::{self, DatabaseAdapter, DatabaseKind, QueryResult, TxSession};

pub fn tool_definition() -> Value {
    json!({
        "name": "script",
        "description": "Multi-statement script (if enabled); statements are checked like query/execute. One transaction (rollback on the first error, commit=false is a dry run); writes need confirm=true. No BEGIN/ROLLBACK/SAVEPOINT. Oracle SQL*Plus: / terminators, DEFINE and &x, SET DEFINE OFF, SET ESCAPE, PROMPT, EXEC, SET SERVEROUTPUT ON, WHENEVER SQLERROR, EXIT. Pass sql or file; @file inside a script is refused.",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": super::server::database_arg(),
            "sql": {"type": "string"},
            "file": {"type": "string", "description": "Absolute path to a local .sql file (max 4 MB) instead of sql"},
            "confirm": {"type": "boolean"},
            "commit": {"type": "boolean"},
            "onError": {"type": "string", "enum": ["stop", "continue"]},
            "limit": {"type": "integer", "minimum": 1, "description": "Rows per result, default 20"}
        }}
    })
}

const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

fn read_file(path: &str) -> Result<String, String> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("file braucht einen absoluten Pfad.".into());
    }
    let unreadable = |_| "file: Datei nicht gefunden oder nicht lesbar.".to_string();
    let path = std::fs::canonicalize(path).map_err(unreadable)?;
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("sql"))
    {
        return Err("file muss auf eine .sql-Datei zeigen (auch nach Auflösen von Links).".into());
    }
    let meta = std::fs::metadata(&path).map_err(unreadable)?;
    if !meta.is_file() {
        return Err("file ist keine reguläre Datei.".into());
    }
    let too_big = || format!("file ist größer als {} MB.", MAX_FILE_BYTES >> 20);
    if meta.len() > MAX_FILE_BYTES {
        return Err(too_big());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .and_then(|file| file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes))
        .map_err(unreadable)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(too_big());
    }
    let text = String::from_utf8(bytes).map_err(|_| "file ist kein gültiges UTF-8.".to_string())?;
    Ok(match text.strip_prefix('\u{feff}') {
        Some(rest) => rest.to_string(),
        None => text,
    })
}

fn source(args: &Value) -> Result<(String, bool), String> {
    match (arg_str(args, "sql").trim(), arg_str(args, "file").trim()) {
        ("", "") => Err("sql oder file angeben.".into()),
        (sql, "") => Ok((sql.to_string(), false)),
        ("", file) => Ok((read_file(file)?, true)),
        _ => Err("Nur eines von sql und file angeben.".into()),
    }
}

fn plan_file(kind: DatabaseKind, sql: &str) -> Result<Plan, String> {
    plan(kind, sql).map_err(|e| {
        if e.starts_with('\'') {
            "Skriptdatei steuert die Transaktion selbst (commit=false für einen Probelauf).".into()
        } else if e.starts_with("Substitutionsvariable") {
            "Skriptdatei nutzt eine nicht definierte Substitutionsvariable (DEFINE … oder SET DEFINE OFF).".into()
        } else {
            e
        }
    })
}

#[derive(Debug, PartialEq)]
enum Step {
    Sql(String),
    Prompt(String),
    Output(bool),
    Continue(bool),
    Exit { rollback: bool },
}

#[derive(Debug, Default)]
struct Plan {
    steps: Vec<Step>,
    skipped: usize,
}

fn words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|word| word.trim_end_matches(';').to_ascii_uppercase())
        .collect()
}

fn transaction_control(kind: DatabaseKind, sql: &str) -> Option<bool> {
    let words = words(sql);
    let first = words.first()?.as_str();
    let second = words.get(1).map(String::as_str);
    match first {
        "COMMIT" => Some(true),
        "ROLLBACK" | "SAVEPOINT" | "RELEASE" => Some(false),
        "BEGIN" | "START" | "END" if kind != DatabaseKind::Oracle => match second {
            None
            | Some(
                "TRANSACTION" | "TRAN" | "WORK" | "ISOLATION" | "DEFERRED" | "IMMEDIATE"
                | "EXCLUSIVE" | "DISTRIBUTED",
            ) => Some(false),
            _ => None,
        },
        _ => None,
    }
}

#[derive(Clone, Copy)]
struct Markers {
    define: Option<char>,
    escape: Option<char>,
}

fn substitute(
    text: &str,
    defines: &HashMap<String, String>,
    markers: Markers,
) -> Result<String, String> {
    let Some(marker) = markers.define.filter(|m| text.contains(*m)) else {
        return Ok(text.to_string());
    };
    let chars: Vec<char> = text.chars().collect();
    let ident = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '$' | '#');
    let mut out = String::with_capacity(text.len());
    let mut close: Option<Vec<char>> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(seq) = &close {
            if chars[i..].starts_with(seq) {
                out.extend(seq.iter());
                i += seq.len();
                close = None;
                continue;
            }
        } else {
            let end = match (c, chars.get(i + 1)) {
                ('-', Some('-')) => (i..chars.len()).find(|&n| chars[n] == '\n'),
                ('/', Some('*')) => (i + 2..chars.len().saturating_sub(1))
                    .find(|&n| chars[n] == '*' && chars[n + 1] == '/')
                    .map(|n| n + 2),
                _ => Some(i),
            };
            if end != Some(i) {
                let end = end.unwrap_or(chars.len());
                out.extend(chars[i..end].iter());
                i = end;
                continue;
            }
            let q = if matches!(c, 'n' | 'N') && matches!(chars.get(i + 1), Some('q' | 'Q')) {
                i + 1
            } else {
                i
            };
            if matches!(chars.get(q), Some('q' | 'Q'))
                && chars.get(q + 1) == Some(&'\'')
                && chars.get(q + 2).is_some_and(|o| !o.is_whitespace())
                && !(i > 0 && ident(chars[i - 1]))
            {
                let closing = match chars[q + 2] {
                    '[' => ']',
                    '{' => '}',
                    '(' => ')',
                    '<' => '>',
                    other => other,
                };
                close = Some(vec![closing, '\'']);
                out.extend(chars[i..q + 3].iter());
                i = q + 3;
                continue;
            }
            if c == '\'' || c == '"' {
                close = Some(vec![c]);
                out.push(c);
                i += 1;
                continue;
            }
        }
        if markers.escape == Some(c) && chars.get(i + 1) == Some(&marker) {
            out.push(marker);
            i += 2;
            continue;
        }
        if c != marker {
            out.push(c);
            i += 1;
            continue;
        }
        let start = if chars.get(i + 1) == Some(&marker) {
            i + 2
        } else {
            i + 1
        };
        let mut end = start;
        while end < chars.len() && ident(chars[end]) {
            end += 1;
        }
        if end == start {
            out.extend(chars[i..start].iter());
            i = start;
            continue;
        }
        let name: String = chars[start..end].iter().collect();
        let value = defines.get(&name.to_ascii_uppercase()).ok_or_else(|| {
            format!("Substitutionsvariable {marker}{name} ist nicht definiert (DEFINE {name} = … oder SET DEFINE OFF).")
        })?;
        out.push_str(value);
        i = if chars.get(end) == Some(&'.') {
            end + 1
        } else {
            end
        };
    }
    Ok(out)
}

fn switch(value: &str, fallback: char) -> Option<char> {
    let value = value.trim_matches(|c| c == '\'' || c == '"');
    match value.to_ascii_uppercase().as_str() {
        "OFF" => None,
        "ON" | "" => Some(fallback),
        _ => value.chars().next(),
    }
}

fn define(rest: &str, defines: &mut HashMap<String, String>) {
    let Some((name, value)) = rest.split_once('=') else {
        return;
    };
    let value = value.trim().trim_end_matches(';').trim();
    let value = value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
        .unwrap_or(value);
    defines.insert(name.trim().to_ascii_uppercase(), value.to_string());
}

const COMMANDS: &[(&str, usize)] = &[
    ("DEFINE", 3),
    ("UNDEFINE", 5),
    ("PROMPT", 3),
    ("SET", 3),
    ("WHENEVER", 8),
    ("EXIT", 4),
    ("QUIT", 4),
    ("START", 3),
];

const SET_OPTIONS: &[(&str, usize)] = &[
    ("DEFINE", 3),
    ("SCAN", 4),
    ("ESCAPE", 3),
    ("CONCAT", 3),
    ("SERVEROUTPUT", 9),
    ("VERIFY", 3),
    ("AUTOPRINT", 5),
    ("EXITCOMMIT", 5),
    ("AUTOCOMMIT", 4),
    ("SQLTERMINATOR", 4),
    ("BLOCKTERMINATOR", 3),
    ("CMDSEP", 4),
    ("SQLPREFIX", 6),
];

fn set_options(words: &[&str]) -> Vec<(usize, usize)> {
    let mut starts = vec![1];
    let mut quote = None;
    for (index, word) in words.iter().enumerate().skip(1) {
        if index + 1 >= words.len() {
            break;
        }
        if let Some(open) = quote {
            if word.ends_with(open) {
                quote = None;
            }
            continue;
        }
        let first = word.chars().next().filter(|c| matches!(c, '\'' | '"'));
        if let Some(open) = first.filter(|open| word.len() == 1 || !word.ends_with(*open)) {
            quote = Some(open);
        } else if index - starts[starts.len() - 1] > 1
            && db::sql_script::abbreviates(&word.to_ascii_uppercase(), SET_OPTIONS)
        {
            starts.push(index);
        }
    }
    starts
        .iter()
        .enumerate()
        .map(|(at, start)| (*start, starts.get(at + 1).copied().unwrap_or(words.len())))
        .filter(|(start, end)| start < end)
        .collect()
}

fn sqlplus(
    line: &str,
    plan: &mut Plan,
    defines: &mut HashMap<String, String>,
    markers: &mut Markers,
) -> Result<bool, String> {
    let words = words(line);
    let rest = |n: usize| {
        line.split_whitespace()
            .skip(n)
            .collect::<Vec<_>>()
            .join(" ")
    };
    let arg = |n: usize| words.get(n).map(String::as_str).unwrap_or("");
    let command = COMMANDS
        .iter()
        .find(|form| db::sql_script::abbreviates(arg(0), &[**form]))
        .map_or("", |form| form.0);
    if line.starts_with('@') || command == "START" {
        return Err(
            "Skriptdateien (@, @@, START) werden im Skript nicht ausgeführt; eine Datei über den Parameter file übergeben."
                .into(),
        );
    }
    if db::sql_script::is_connect_command(line) {
        return Err(db::sql_script::CONNECT_UNSUPPORTED.into());
    }
    match command {
        "DEFINE" => define(&rest(1), defines),
        "UNDEFINE" => {
            for name in &words[1..] {
                defines.remove(name);
            }
        }
        "PROMPT" => plan
            .steps
            .push(Step::Prompt(substitute(&rest(1), defines, *markers)?)),
        "SET" => {
            let raw: Vec<&str> = line.split_whitespace().collect();
            let mut handled = false;
            for (start, end) in set_options(&raw) {
                let value = if start + 1 < end { raw[start + 1] } else { "" };
                let value = value.trim_end_matches(';');
                match SET_OPTIONS
                    .iter()
                    .find(|form| db::sql_script::abbreviates(&words[start], &[**form]))
                    .map(|form| form.0)
                {
                    Some("DEFINE") => markers.define = switch(value, '&'),
                    Some("SCAN") => {
                        markers.define = (!value.eq_ignore_ascii_case("OFF")).then_some('&')
                    }
                    Some("ESCAPE") => markers.escape = switch(value, '\\'),
                    Some("SERVEROUTPUT") => plan
                        .steps
                        .push(Step::Output(value.eq_ignore_ascii_case("ON"))),
                    _ => continue,
                }
                handled = true;
            }
            if !handled {
                plan.skipped += 1;
            }
        }
        "WHENEVER" if arg(1) == "SQLERROR" => plan.steps.push(Step::Continue(arg(2) == "CONTINUE")),
        "EXIT" | "QUIT" => {
            plan.steps.push(Step::Exit {
                rollback: words.iter().any(|word| word == "ROLLBACK"),
            });
            return Ok(false);
        }
        _ => plan.skipped += 1,
    }
    Ok(true)
}

fn statement(kind: DatabaseKind, text: String, plan: &mut Plan) -> Result<(), String> {
    match transaction_control(kind, &text) {
        Some(true) => {
            plan.skipped += 1;
            return Ok(());
        }
        Some(false) => {
            return Err(format!(
                "'{}': script steuert die Transaktion selbst (commit=false für einen Probelauf).",
                preview(&text)
            ))
        }
        None => {}
    }
    plan.steps.push(Step::Sql(text));
    Ok(())
}

fn plan(kind: DatabaseKind, sql: &str) -> Result<Plan, String> {
    let mut plan = Plan::default();
    let items: Vec<(bool, String)> = match kind {
        DatabaseKind::Oracle => db::oracle::script_items(sql),
        _ => db::sql_script::split_for(kind, sql)
            .into_iter()
            .map(|statement| (false, statement))
            .collect(),
    };
    let mut defines = HashMap::new();
    let mut markers = Markers {
        define: Some('&'),
        escape: None,
    };
    for (is_sqlplus, text) in items {
        if is_sqlplus {
            if !sqlplus(&text, &mut plan, &mut defines, &mut markers)? {
                break;
            }
            continue;
        }
        let text = match kind {
            DatabaseKind::Oracle => substitute(&text, &defines, markers)?,
            _ => text,
        };
        statement(kind, text, &mut plan)?;
    }
    if !plan.steps.iter().any(|step| matches!(step, Step::Sql(_))) {
        return Err("Skript enthält keine Statements.".into());
    }
    Ok(plan)
}

fn preview(sql: &str) -> String {
    let flat = sql.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > 80 {
        format!("{}…", flat.chars().take(80).collect::<String>())
    } else {
        flat
    }
}

enum Runner {
    Session(Box<dyn TxSession>),
    Direct(Box<dyn DatabaseAdapter>, db::server_output::Messages),
}

impl Runner {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        match self {
            Runner::Session(session) => session.execute(sql).await,
            Runner::Direct(adapter, sink) => {
                db::server_output::capture(sink.clone(), adapter.execute_query(sql)).await
            }
        }
    }

    async fn output(&mut self, enabled: bool) -> Result<(), String> {
        match self {
            Runner::Session(session) => session
                .execute(if enabled {
                    "BEGIN DBMS_OUTPUT.ENABLE(NULL); END;"
                } else {
                    "BEGIN DBMS_OUTPUT.DISABLE; END;"
                })
                .await
                .map(|_| ()),
            Runner::Direct(adapter, _) => adapter.set_server_output(enabled).await,
        }
    }

    async fn take_output(&mut self) -> Result<Vec<String>, String> {
        match self {
            Runner::Session(session) => session.server_output().await,
            Runner::Direct(adapter, sink) => Ok(sink
                .take()
                .into_iter()
                .chain(adapter.take_server_output().await?)
                .map(|message| message.message)
                .collect()),
        }
    }

    async fn finish(&mut self, commit: bool) -> Result<(), String> {
        match self {
            Runner::Session(session) if commit => session.commit().await,
            Runner::Session(session) => session.rollback().await,
            Runner::Direct(..) => Ok(()),
        }
    }
}

impl Server {
    pub(super) async fn script(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        args: &Value,
    ) -> Result<String, String> {
        if !connection.allow_scripts {
            return Err(format!(
                "Skripte sind für '{}' nicht freigegeben. In l8db unter MCP › Verbindung „Skripte erlauben“ aktivieren.",
                connection.name
            ));
        }
        if !super::server::sql_family(connection.kind) {
            return Err("script unterstützt nur SQL-Datenbanken.".into());
        }
        let (sql, from_file) = source(args)?;
        let plan = if from_file {
            plan_file(connection.kind, &sql)?
        } else {
            plan(connection.kind, &sql)?
        };
        let label = |statement: &str| {
            if from_file {
                String::new()
            } else {
                format!(" {}", preview(statement))
            }
        };
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let index = self.schema_index(config, connection, &redactor).await?;
        let mut writes = false;
        for (number, step) in plan.steps.iter().enumerate() {
            let Step::Sql(statement) = step else { continue };
            if check_read_sql(statement, connection, &index).is_ok() {
                continue;
            }
            let checked = if connection.writes_blocked() {
                check_read_sql(statement, connection, &index)
            } else {
                check_write_sql(statement, connection, &index)
            };
            checked.map_err(|e| format!("#{}{}: {e}", number + 1, label(statement)))?;
            writes = true;
        }
        if writes
            && !args
                .get("confirm")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        {
            return Err("Skript schreibt, script braucht confirm=true.".into());
        }
        let commit = args.get("commit").and_then(Value::as_bool).unwrap_or(true);
        let mut keep_going = arg_str(args, "onError") == "continue";
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(20)
            .clamp(1, config.max_rows.max(1));

        let mut runner = if connection.writes_blocked() {
            Runner::Direct(adapter(connection, &self.pool)?, Default::default())
        } else {
            let url = connection_url(connection)?;
            match db::import::open_session(
                connection.kind,
                &url,
                connection.database.as_deref(),
                self.pool.clone(),
            )
            .await
            {
                Ok(session) => Runner::Session(session),
                Err(e) if e.contains("nicht unterstützt") => {
                    Runner::Direct(adapter(connection, &self.pool)?, Default::default())
                }
                Err(e) => return Err(e),
            }
        };
        let transactional = matches!(runner, Runner::Session(_));
        let savepoints = transactional && connection.kind == DatabaseKind::Postgres;

        let mut lines = Vec::new();
        let (mut ok, mut failed) = (0usize, 0usize);
        let mut stopped = None;
        let mut exit_rollback = false;
        let mut output = false;
        let mut number = 0usize;
        for step in &plan.steps {
            match step {
                Step::Prompt(text) => lines.push(format!("> {text}")),
                Step::Continue(value) => keep_going = *value,
                Step::Exit { rollback } => {
                    exit_rollback = *rollback;
                    break;
                }
                Step::Output(enabled) => {
                    if let Err(e) = runner.output(*enabled).await {
                        lines.push(format!("SERVEROUTPUT: {e}"));
                    }
                    output = *enabled;
                }
                Step::Sql(statement) => {
                    number += 1;
                    if savepoints && keep_going {
                        if let Err(e) = runner.execute("SAVEPOINT l8db_script").await {
                            let _ = runner.finish(false).await;
                            return Err(e);
                        }
                    }
                    let result = run(config, connection.kind, runner.execute(statement)).await;
                    if output {
                        for line in runner.take_output().await.unwrap_or_default() {
                            let text = redactor.redact_cell("dbms_output", &Value::String(line));
                            lines.push(format!("| {}", text.as_str().unwrap_or_default()));
                        }
                    }
                    match result {
                        Ok(result) if result.columns.is_empty() => {
                            ok += 1;
                            lines.push(match result.rows_affected {
                                Some(rows) if rows > 0 => format!("#{number} ok {rows}"),
                                _ => format!("#{number} ok"),
                            });
                        }
                        Ok(result) => {
                            ok += 1;
                            lines.push(format!("#{number}"));
                            lines.push(format_result(&result, config, &redactor, limit));
                        }
                        Err(e) => {
                            failed += 1;
                            let error = e
                                .lines()
                                .filter(|line| !line.starts_with("Help:"))
                                .collect::<Vec<_>>()
                                .join(" ");
                            let error = super::server::scrub_error(&error);
                            lines.push(if from_file {
                                format!("#{number} ERR {error}")
                            } else {
                                format!("#{number} ERR {error} [{}]", preview(statement))
                            });
                            if !keep_going {
                                stopped = Some(number);
                                break;
                            }
                            if savepoints {
                                if let Err(e) =
                                    runner.execute("ROLLBACK TO SAVEPOINT l8db_script").await
                                {
                                    let _ = runner.finish(false).await;
                                    return Err(e);
                                }
                            }
                        }
                    }
                }
            }
        }
        let total = plan
            .steps
            .iter()
            .filter(|step| matches!(step, Step::Sql(_)))
            .count();
        let commit = commit && stopped.is_none() && !exit_rollback;
        if let Err(e) = runner.finish(commit).await {
            if commit {
                let _ = runner.finish(false).await;
            }
            return Err(e);
        }
        if writes {
            self.forget_catalog(connection);
        }
        let state = match (transactional, commit, stopped) {
            (false, _, Some(n)) => {
                format!("stopped at #{n}, no transaction: earlier statements stay applied")
            }
            (false, _, None) if writes => "no transaction (autocommit)".to_string(),
            (false, _, None) => "read-only".to_string(),
            (true, _, Some(n)) => format!("rolled back after #{n}"),
            (true, true, None) => "committed".to_string(),
            (true, false, None) => "rolled back".to_string(),
        };
        let mut footer = format!("-- {state}: {ok}/{total} ok");
        if failed > 0 {
            footer.push_str(&format!(", {failed} failed"));
        }
        if number < total {
            footer.push_str(&format!(", {} not run", total - number));
        }
        if plan.skipped > 0 {
            footer.push_str(&format!(", {} lines skipped", plan.skipped));
        }
        lines.push(footer);
        let text = cap(lines.join("\n"), config.max_chars);
        if stopped.is_some() {
            Err(text)
        } else {
            Ok(text)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sqls(plan: &Plan) -> Vec<&str> {
        plan.steps
            .iter()
            .filter_map(|step| match step {
                Step::Sql(sql) => Some(sql.as_str()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn sqlplus_script_is_planned() {
        let script = "SET ECHO ON\nWHENEVER SQLERROR CONTINUE\nDEFINE tab = 'emp'\nDEFINE n = 5\nPROMPT loading &tab\nSET SERVEROUTPUT ON SIZE UNLIMITED\nINSERT INTO &tab._log VALUES (&&n);\nEXEC dbms_output.put_line('x');\nBEGIN\n  NULL;\nEND;\n/\nSET DEFINE OFF\nSELECT 'a&b' FROM dual;\nCOMMIT;\nEXIT ROLLBACK\nSELECT 1 FROM dual;";
        let plan = plan(DatabaseKind::Oracle, script).unwrap();
        assert_eq!(
            sqls(&plan),
            vec![
                "INSERT INTO emp_log VALUES (5);",
                "BEGIN dbms_output.put_line('x'); END;",
                "BEGIN\n  NULL;\nEND;",
                "SELECT 'a&b' FROM dual;",
            ]
        );
        assert!(plan.steps.contains(&Step::Prompt("loading emp".into())));
        assert!(plan.steps.contains(&Step::Output(true)));
        assert!(plan.steps.contains(&Step::Continue(true)));
        assert_eq!(plan.steps.last(), Some(&Step::Exit { rollback: true }));
        assert_eq!(plan.skipped, 2);
    }

    #[test]
    fn combined_set_lines_and_abbreviations_apply_every_option() {
        let script = "set verify off define off serverout on;\nSELECT 'a&b' FROM dual;\nSET SQLPROMPT \"my def \" SCAN ON\ndefi n = 5;\nprom value &n\nSELECT &n FROM dual;\nexit;\nDROP TABLE t;";
        let planned = plan(DatabaseKind::Oracle, script).unwrap();
        assert_eq!(
            sqls(&planned),
            vec!["SELECT 'a&b' FROM dual;", "SELECT 5 FROM dual;"]
        );
        assert_eq!(
            planned.steps,
            vec![
                Step::Output(true),
                Step::Sql("SELECT 'a&b' FROM dual;".into()),
                Step::Prompt("value 5".into()),
                Step::Sql("SELECT 5 FROM dual;".into()),
                Step::Exit { rollback: false },
            ]
        );
        assert_eq!(planned.skipped, 0);
        assert!(plan(DatabaseKind::Oracle, "star x.sql\nSELECT 1 FROM dual;").is_err());
        assert!(plan(DatabaseKind::Oracle, "disco\nSELECT 1 FROM dual;").is_err());
    }

    #[test]
    fn rejects_undefined_variables_files_and_transaction_control() {
        assert!(plan(DatabaseKind::Oracle, "SELECT &x FROM dual;")
            .unwrap_err()
            .contains("&x"));
        assert!(plan(DatabaseKind::Oracle, "@install.sql").is_err());
        assert!(plan(DatabaseKind::Oracle, "SELECT 1 FROM dual;\n  @@sub.sql").is_err());
        assert!(plan(DatabaseKind::Oracle, "SELECT 1 FROM dual;\nSTART x.sql").is_err());
        assert!(plan(DatabaseKind::Oracle, "CONN hr/hr@db\nDROP TABLE t;")
            .unwrap_err()
            .contains("CONNECT"));
        assert!(plan(DatabaseKind::Oracle, "SELECT 1 FROM dual;\nROLLBACK;").is_err());
        for sql in [
            "BEGIN; DELETE FROM t;",
            "START TRANSACTION; DELETE FROM t;",
            "SAVEPOINT a;",
        ] {
            assert!(plan(DatabaseKind::Postgres, sql).is_err(), "{sql}");
        }
        assert!(plan(DatabaseKind::Postgres, "COMMIT;").is_err());
    }

    #[test]
    fn substitution_matches_the_shared_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/sqlplus-substitution.json"
        ))
        .unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let defines: HashMap<String, String> = case["defines"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string()))
                .collect();
            let char_of = |key: &str, fallback: Option<char>| match case.get(key) {
                Some(Value::Null) => None,
                Some(value) => value.as_str().and_then(|s| s.chars().next()),
                None => fallback,
            };
            let markers = Markers {
                define: char_of("marker", Some('&')),
                escape: char_of("escape", None),
            };
            let result = substitute(case["sql"].as_str().unwrap(), &defines, markers);
            match case.get("missing") {
                Some(missing) => {
                    let error = result.unwrap_err().to_ascii_uppercase();
                    assert!(
                        error.contains(&format!("&{}", missing[0].as_str().unwrap())),
                        "{}",
                        case["name"]
                    );
                }
                None => assert_eq!(result.unwrap(), case["expected"], "{}", case["name"]),
            }
        }
    }

    #[test]
    fn set_escape_and_comments_in_scripts() {
        let script = "DEFINE x = 1\nSET ESCAPE ON\nSELECT 'R\\&D', &x FROM dual; -- &y\nSET DEFINE ^\nSELECT ^x, '&z' FROM dual;";
        let plan = plan(DatabaseKind::Oracle, script).unwrap();
        assert_eq!(
            sqls(&plan),
            vec!["SELECT 'R&D', 1 FROM dual;", "SELECT 1, '&z' FROM dual;"]
        );
    }

    #[test]
    fn splits_generic_scripts() {
        let plan = plan(
            DatabaseKind::Postgres,
            "CREATE TEMP TABLE t (x int); INSERT INTO t VALUES (1); DO $$ BEGIN PERFORM 1; END $$; SELECT 'a&b' FROM t; COMMIT;",
        )
        .unwrap();
        assert_eq!(sqls(&plan).len(), 4);
        assert_eq!(plan.skipped, 1);
    }

    fn issue_272_check(script: &str) -> Result<(), String> {
        let connection = McpConnection {
            id: "o1".into(),
            name: "Oracle".into(),
            kind: DatabaseKind::Oracle,
            connection_string: String::new(),
            schemas: vec!["app".into()],
            ssh: false,
            exposed: true,
            read_only: false,
            allow_ddl: false,
            allow_scripts: true,
            redact_columns: vec![],
            mask_rules: vec![],
            environment: None,
            allow_production_writes: false,
            database: None,
        };
        let redactor = Redactor::new(
            &McpConfig::default().redaction,
            &connection.sensitive_columns(),
        );
        let index = super::super::redact::SchemaIndex::from_parts(
            ["id", "name", "password", "id"].into_iter(),
            [("app", "kunden"), ("gesperrt", "tabelle")].into_iter(),
            &redactor,
            &connection.schemas,
        );
        assert!(!index.sensitive_columns.is_empty());
        for step in &plan(connection.kind, script)?.steps {
            let Step::Sql(statement) = step else { continue };
            if check_read_sql(statement, &connection, &index).is_ok() {
                continue;
            }
            check_write_sql(statement, &connection, &index)?;
        }
        Ok(())
    }

    #[test]
    fn issue_272_plsql_blocks_from_the_report_pass() {
        for script in [
            "declare\n  c clob;\nbegin\n  for r in (select line, text from user_source where name='X' order by line) loop\n    c := c || r.text;\n  end loop;\nend;\n/",
            "declare\n  type tn is table of number;\n  type tt is table of varchar2(4000);\n  vl tn;\n  vt tt;\nbegin\n  select line, text bulk collect into vl, vt from user_source where name='X' order by line;\nend;\n/",
            "declare\n  c clob;\n  type tt is table of clob;\n  vt tt;\nbegin\n  select text bulk collect into vt from user_source where name='X' order by line;\n  for i in 1 .. cardinality(vt) loop\n    c := c || vt(i);\n  end loop;\nend;\n/",
            "declare\n  c clob;\nbegin\n  for r in (select k.id, k.name from app.kunden k) loop\n    c := c || r.name;\n  end loop;\nend;\n/",
        ] {
            assert_eq!(issue_272_check(script), Ok(()), "{script}");
        }
    }

    #[test]
    fn issue_272_plsql_blocks_keep_the_protection() {
        for (script, expected) in [
            (
                "declare c clob;\nbegin\n  for r in (select * from gesperrt.tabelle) loop\n    c := c || r.id;\n  end loop;\nend;\n/",
                "gesperrt",
            ),
            (
                "declare c clob;\nbegin\n  for r in (select id from tabelle) loop\n    c := c || r.id;\n  end loop;\nend;\n/",
                "tabelle",
            ),
            (
                "declare c clob;\nbegin\n  for r in (select password from app.kunden) loop\n    c := c || r.password;\n  end loop;\nend;\n/",
                "password",
            ),
        ] {
            let error = issue_272_check(script).expect_err(script);
            assert!(error.contains(expected), "{script}: {error}");
        }
    }

    fn issue_275_oracle() -> McpConnection {
        McpConnection {
            id: "o1".into(),
            name: "Oracle".into(),
            kind: DatabaseKind::Oracle,
            connection_string: String::new(),
            schemas: vec![],
            ssh: false,
            exposed: true,
            read_only: false,
            allow_ddl: true,
            allow_scripts: true,
            redact_columns: vec![],
            mask_rules: vec![],
            environment: None,
            allow_production_writes: false,
            database: None,
        }
    }

    fn issue_275_check(connection: &McpConnection, plan: &Plan) -> Result<(), String> {
        let redactor = Redactor::new(&McpConfig::default().redaction, &[]);
        let index = super::super::redact::SchemaIndex::new(&[], &redactor, &[]);
        for step in &plan.steps {
            let Step::Sql(statement) = step else { continue };
            if check_read_sql(statement, connection, &index).is_ok() {
                continue;
            }
            check_write_sql(statement, connection, &index)?;
        }
        Ok(())
    }

    fn issue_275_file(args: Value) -> Result<String, String> {
        source(&args).map(|(sql, from_file)| {
            assert!(from_file);
            sql
        })
    }

    #[test]
    fn issue_275_file_is_planned_like_sql() {
        let dir = tempfile::tempdir().unwrap();
        let script = "DEFINE n = 5\nINSERT INTO t VALUES (&n);\nBEGIN\n  NULL;\nEND;\n/\nSELECT 1 FROM dual;";
        let path = dir.path().join("Skript.SQL");
        std::fs::write(&path, format!("\u{feff}{script}\n")).unwrap();
        let text = issue_275_file(json!({"file": path.to_str().unwrap(), "sql": "  "})).unwrap();
        assert_eq!(
            sqls(&plan_file(DatabaseKind::Oracle, &text).unwrap()),
            sqls(&plan(DatabaseKind::Oracle, script).unwrap())
        );
        assert_eq!(
            source(&json!({"sql": " SELECT 1 "})),
            Ok(("SELECT 1".to_string(), false))
        );
    }

    #[test]
    fn issue_275_large_package_body_from_file_is_one_statement() {
        let dir = tempfile::tempdir().unwrap();
        let mut body = String::from("CREATE OR REPLACE PACKAGE BODY app_pkg AS\n");
        let mut procedures = 0;
        while body.len() < 240 * 1024 {
            procedures += 1;
            body.push_str(&format!(
                "  PROCEDURE p{procedures}(a IN NUMBER, b OUT NUMBER) IS\n    v NUMBER := 0;\n    s VARCHAR2(100) := 'x;y / z';\n  BEGIN\n    -- step; /\n    FOR i IN 1 .. a LOOP\n      IF MOD(i, 2) = 0 THEN\n        v := v + i;\n      ELSE\n        v := v - 1;\n      END IF;\n    END LOOP;\n    b := v + LENGTH(s);\n  END p{procedures};\n\n"
            ));
        }
        body.push_str("END app_pkg;\n/\n");
        let path = dir.path().join("app_pkg.sql");
        std::fs::write(&path, &body).unwrap();
        let started = std::time::Instant::now();
        let text = issue_275_file(json!({"file": path.to_str().unwrap()})).unwrap();
        let plan = plan_file(DatabaseKind::Oracle, &text).unwrap();
        issue_275_check(&issue_275_oracle(), &plan).unwrap();
        let elapsed = started.elapsed();
        let statements = sqls(&plan);
        assert_eq!(statements.len(), 1);
        assert!(statements[0].starts_with("CREATE OR REPLACE PACKAGE BODY app_pkg"));
        assert!(statements[0].trim_end().ends_with("END app_pkg;"));
        println!(
            "issue_275: {} bytes, {procedures} procedures, {elapsed:?}",
            body.len()
        );
        assert!(elapsed < std::time::Duration::from_secs(5), "{elapsed:?}");
    }

    #[test]
    fn issue_275_rejects_unsafe_files_without_echoing_content() {
        let dir = tempfile::tempdir().unwrap();
        let secret = "TOPSECRET_hunter2";
        let file = |name: &str, bytes: &[u8]| {
            let path = dir.path().join(name);
            std::fs::write(&path, bytes).unwrap();
            path.to_str().unwrap().to_string()
        };
        let text = file("secret.txt", secret.as_bytes());
        let sql = file("ok.sql", b"SELECT 1 FROM dual;");
        let binary = file("binary.sql", &[0xff, 0xfe, 0x00, b'T', b'O', b'P']);
        let big = dir.path().join("big.sql");
        std::fs::File::create(&big)
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        let folder = dir.path().join("folder.sql");
        std::fs::create_dir(&folder).unwrap();
        let link = dir.path().join("link.sql");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&text, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&text, &link).unwrap();
        for (args, expected) in [
            (json!({}), "sql oder file"),
            (json!({"sql": " ", "file": " "}), "sql oder file"),
            (json!({"sql": "SELECT 1", "file": sql}), "Nur eines"),
            (json!({"file": "ok.sql"}), "absoluten Pfad"),
            (
                json!({"file": dir.path().join("fehlt.sql")}),
                "nicht gefunden",
            ),
            (json!({"file": folder}), "keine reguläre Datei"),
            (json!({"file": text}), ".sql-Datei"),
            (json!({"file": link}), ".sql-Datei"),
            (json!({"file": big}), "größer als 4 MB"),
            (json!({"file": binary}), "UTF-8"),
        ] {
            let error = issue_275_file(args.clone()).expect_err(&args.to_string());
            assert!(error.contains(expected), "{args}: {error}");
            assert!(
                !error.contains("hunter2") && !error.contains("TOP"),
                "{error}"
            );
        }
    }

    #[test]
    fn issue_275_non_sql_file_errors_do_not_echo_content() {
        let dir = tempfile::tempdir().unwrap();
        let connection = issue_275_oracle();
        for (name, content, fails) in [
            (
                "env.sql",
                "AWS_SECRET_ACCESS_KEY=hunter2xyz\nDB_PASSWORD=hunter2xyz\n",
                false,
            ),
            ("begin.sql", "ROLLBACK hunter2xyz;", true),
            ("define.sql", "SELECT '&hunter2xyz' FROM dual;", true),
            ("drop.sql", "DROP TABLE hunter2xyz;", true),
        ] {
            let path = dir.path().join(name);
            std::fs::write(&path, content).unwrap();
            let text = issue_275_file(json!({"file": path})).unwrap();
            let mut connection = connection.clone();
            connection.allow_ddl = name != "drop.sql";
            let result = plan_file(connection.kind, &text)
                .and_then(|plan| issue_275_check(&connection, &plan));
            assert_eq!(result.is_err(), fails, "{name}: {result:?}");
            if let Err(error) = result {
                assert!(!error.contains("hunter2xyz"), "{name}: {error}");
            }
        }
    }

    #[tokio::test]
    async fn issue_275_script_runs_file_through_checks_without_quoting_it() {
        let (dir, config, mut connection, mut server) =
            super::super::sandbox::sqlite_fixture("CREATE TABLE t (id INTEGER, secret TEXT);");
        let file = |name: &str, content: &str| {
            let path = dir.path().join(name);
            std::fs::write(&path, content).unwrap();
            path.to_str().unwrap().to_string()
        };
        let ok = file(
            "ok.sql",
            "INSERT INTO t VALUES (1, 'a');\nINSERT INTO t VALUES (2, 'b');\nSELECT COUNT(*) AS n FROM t;",
        );
        let failing = file(
            "fail.sql",
            "INSERT INTO t VALUES (3, 'hunter2xyz', 'zuviel');",
        );
        let blocked = file("ddl.sql", "DROP TABLE t; -- hunter2xyz");
        let denied = server
            .script(&config, &connection, &json!({"file": ok, "confirm": true}))
            .await
            .unwrap_err();
        assert!(denied.contains("nicht freigegeben"), "{denied}");
        connection.allow_scripts = true;
        let unconfirmed = server
            .script(&config, &connection, &json!({"file": ok}))
            .await
            .unwrap_err();
        assert!(unconfirmed.contains("confirm=true"), "{unconfirmed}");
        let text = server
            .script(
                &config,
                &connection,
                &json!({"file": ok, "confirm": true, "commit": false}),
            )
            .await
            .unwrap();
        assert!(text.contains("rolled back: 3/3 ok"), "{text}");
        assert!(!text.contains("INSERT INTO"), "{text}");
        let error = server
            .script(
                &config,
                &connection,
                &json!({"file": failing, "confirm": true}),
            )
            .await
            .unwrap_err();
        assert!(error.contains("#1 ERR"), "{error}");
        assert!(
            !error.contains("hunter2xyz") && !error.contains("INSERT"),
            "{error}"
        );
        connection.allow_ddl = false;
        let error = server
            .script(
                &config,
                &connection,
                &json!({"file": blocked, "confirm": true}),
            )
            .await
            .unwrap_err();
        assert!(error.starts_with("#1: DDL"), "{error}");
        assert!(!error.contains("hunter2xyz"), "{error}");
        let path = dir.path().join("fixture.db");
        let rows: i64 = rusqlite::Connection::open(path)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM t", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }

    fn issue_278_setup() -> (McpConnection, super::super::redact::SchemaIndex) {
        let column = |schema: &str, table: &str, name: &str| crate::db::ColumnInfo {
            schema: schema.into(),
            table: table.into(),
            name: name.into(),
            data_type: "VARCHAR2".into(),
        };
        let columns = [
            column("APP", "T", "ID"),
            column("APP", "T", "NAME"),
            column("APP", "KUNDEN", "ID"),
            column("APP", "KUNDEN", "EMAIL"),
        ];
        let connection = McpConnection {
            schemas: vec!["APP".into()],
            ..issue_275_oracle()
        };
        let redactor = Redactor::new(&McpConfig::default().redaction, &[]);
        let index =
            super::super::redact::SchemaIndex::new(&columns, &redactor, &connection.schemas)
                .with_listed(&["APP".to_string(), "HR".into()]);
        assert!(index.sensitive_columns.contains("email"));
        (connection, index)
    }

    fn issue_278_package_body(functions: usize) -> String {
        let mut body = String::from("CREATE OR REPLACE PACKAGE BODY app_pkg AS\n");
        for n in 1..=functions {
            body.push_str(&format!(
                "  FUNCTION f{n}(p_id IN NUMBER) RETURN NUMBER IS\n    r T%ROWTYPE;\n    v NUMBER;\n  BEGIN\n    pkg_a.log (p_id, 'f{n}');\n    SELECT * INTO r FROM T WHERE ID = p_id;\n    SELECT COUNT(DISTINCT x.ID) INTO v\n      FROM (SELECT NVL(a.ID, 0) AS ID FROM T a\n            UNION\n            SELECT k.ID FROM KUNDEN k) x;\n    INSERT INTO T (ID, NAME) VALUES (-p_id, r.NAME);\n    FOR c IN (SELECT a.* FROM T a WHERE a.ID < p_id) LOOP\n      v := v + other_pkg.weight(c.ID);\n    END LOOP;\n"
            ));
            for line in 0..48 {
                body.push_str(&format!(
                    "    IF MOD(v, {}) = 0 THEN v := v + NVL(p_id, 0); END IF; -- 16.01.2026 / 128\n",
                    line + 2
                ));
            }
            body.push_str(&format!(
                "    RETURN NVL(v, 0);\n  EXCEPTION\n    WHEN NO_DATA_FOUND THEN\n      RETURN 0;\n  END f{n};\n\n"
            ));
        }
        body.push_str("END app_pkg;\n/\n");
        body
    }

    #[test]
    fn issue_278_plsql_from_the_report_passes_the_precheck() {
        let (connection, index) = issue_278_setup();
        let script = format!(
            "begin\n  pkg_a.log (5, 'x');\nend;\n/\ndeclare\n  r T%rowtype;\nbegin\n  select * into r from T where ID = -1;\nexception when no_data_found then null;\nend;\n/\n{}",
            issue_278_package_body(26)
        );
        let plan = plan(DatabaseKind::Oracle, &script).unwrap();
        let statements = sqls(&plan);
        assert_eq!(statements.len(), 3);
        assert!(statements[2].lines().count() > 1600);
        for statement in statements {
            assert!(check_read_sql(statement, &connection, &index).is_err());
            assert_eq!(check_write_sql(statement, &connection, &index), Ok(()));
        }
    }

    #[test]
    fn issue_278_plsql_keeps_redaction_and_schema_rules() {
        let (connection, index) = issue_278_setup();
        for (sql, expected) in [
            (
                "declare v varchar2(100); begin select k.email into v from kunden k where k.id = 1; dbms_output.put_line(v); end;",
                "redigiert",
            ),
            (
                "create or replace function f return varchar2 is v varchar2(100); begin select max(email) into v from kunden; return v; end;",
                "redigiert",
            ),
            ("begin delete from hr.vault; end;", "Schema 'hr'"),
            (
                "begin for r in (select v.id from hr.vault v) loop dbms_output.put_line(r.id); end loop; end;",
                "Schema 'hr'",
            ),
            (
                "declare v varchar2(4000); begin select json_object(k.*) into v from kunden k; end;",
                "Zeilenexpansion",
            ),
            ("begin dbms_lock.sleep(5); end;", "gesperrt"),
            ("begin null; end; begin null; end;", "Nur ein Statement"),
        ] {
            let error = check_write_sql(sql, &connection, &index).unwrap_err();
            assert!(error.contains(expected), "{sql}: {error}");
        }
        let read_only = McpConnection {
            read_only: true,
            ..connection.clone()
        };
        assert!(check_read_sql("begin pkg_a.log (5, 'x'); end;", &read_only, &index).is_err());
        let no_ddl = McpConnection {
            allow_ddl: false,
            ..connection.clone()
        };
        assert!(check_write_sql(&issue_278_package_body(1), &no_ddl, &index).is_err());
    }

    #[test]
    fn issue_278_only_real_plsql_blocks_use_the_plsql_rules() {
        let (connection, index) = issue_278_setup();
        for sql in [
            "begin null; end;",
            "-- x\n/* y */ DECLARE v number; begin null; end;",
            "create or replace editionable package body p as end;",
            "CREATE TRIGGER trg BEFORE INSERT ON t BEGIN NULL; END;",
            "create type body ty as end;",
        ] {
            assert!(crate::db::oracle::is_plsql_block(sql), "{sql}");
        }
        for sql in [
            "/*! begin */ select * from t union select * from t",
            "/* /* */ select * from t union select * from t --*/ */ begin null; end;",
            "select * from t union select * from t",
            "with function f return number is begin return 1; end; select * from t union select * from t",
            "create table copy as select * from kunden",
            "create view v (a, b) as select * from kunden",
            "create type ty as object (a number)",
            "call pkg_a.log(5, 'x')",
        ] {
            assert!(!crate::db::oracle::is_plsql_block(sql), "{sql}");
        }
        for sql in [
            "/*! begin */ select * from t union select * from t",
            "create table copy as select * from kunden",
            "create view v (a, b) as select * from kunden",
        ] {
            assert!(check_write_sql(sql, &connection, &index).is_err(), "{sql}");
        }
        let postgres = McpConnection {
            kind: DatabaseKind::Postgres,
            ..connection.clone()
        };
        assert!(check_write_sql(
            "declare c cursor for select * from t union select * from t",
            &postgres,
            &index
        )
        .is_err());
    }

    #[test]
    fn issue_278_package_body_precheck_stays_fast() {
        let (connection, index) = issue_278_setup();
        let body = issue_278_package_body(26);
        let plan = plan(DatabaseKind::Oracle, &body).unwrap();
        let statement = sqls(&plan)[0].to_string();
        let mut samples: Vec<std::time::Duration> = (0..40)
            .map(|_| {
                let started = std::time::Instant::now();
                assert!(check_read_sql(&statement, &connection, &index).is_err());
                check_write_sql(&statement, &connection, &index).unwrap();
                started.elapsed()
            })
            .collect();
        samples.sort();
        let median = samples[samples.len() / 2];
        let p95 = samples[samples.len() * 95 / 100];
        println!(
            "issue_278: {} bytes, {} lines, median {median:?}, p95 {p95:?}",
            statement.len(),
            statement.lines().count()
        );
        assert!(p95 < std::time::Duration::from_millis(250), "{p95:?}");
    }

    fn issue_295_package_body(name: &str) -> String {
        format!(
            "CREATE OR REPLACE PACKAGE BODY {name} AS\n  FUNCTION write_line(p_dir IN VARCHAR2, p_text IN VARCHAR2) RETURN NUMBER IS\n    f UTL_FILE.FILE_TYPE;\n  BEGIN\n    f := UTL_FILE.FOPEN(p_dir, 'out.txt', 'w');\n    UTL_FILE.PUT_LINE(f, p_text);\n    UTL_FILE.FCLOSE(f);\n    RETURN 1;\n  END write_line;\nEND {name};\n/\n"
        )
    }

    fn issue_295_296_precheck(
        connection: &McpConnection,
        index: &super::super::redact::SchemaIndex,
        script: &str,
    ) -> Result<usize, String> {
        let plan = plan(DatabaseKind::Oracle, script)?;
        let statements = sqls(&plan);
        for (number, statement) in statements.iter().enumerate() {
            if check_read_sql(statement, connection, index).is_ok() {
                continue;
            }
            check_write_sql(statement, connection, index)
                .map_err(|e| format!("#{}: {e}", number + 1))?;
        }
        Ok(statements.len())
    }

    #[test]
    fn issue_295_compiled_plsql_may_reference_blocked_packages() {
        let (connection, index) = issue_278_setup();
        let script = format!(
            "CREATE OR REPLACE PACKAGE app_files AS\n  g_file UTL_FILE.FILE_TYPE;\n  FUNCTION write_line(p_dir IN VARCHAR2, p_text IN VARCHAR2) RETURN NUMBER;\nEND app_files;\n/\n{}create or replace procedure app_sleep is begin dbms_lock.sleep(1); end;\n/\ncreate or replace editionable function app_host return varchar2 is begin return utl_inaddr.get_host_name; end;\n/\ncreate or replace trigger t_log after insert on T for each row begin utl_file.fremove('D', 'x'); end;\n/\ncreate or replace type body ty as member function f return number is begin dbms_lock.sleep(1); return 1; end; end;\n/\n",
            issue_295_package_body("app_files")
        );
        assert_eq!(issue_295_296_precheck(&connection, &index, &script), Ok(6));
        for (sql, expected) in [
            ("begin utl_file.fremove('D', 'x.txt'); end;", "'utl_file'"),
            ("declare f utl_file.file_type; begin f := utl_file.fopen('D', 'x', 'w'); end;", "'utl_file'"),
            ("call utl_file.fremove('D', 'x')", "'utl_file'"),
            ("update T set NAME = utl_inaddr.get_host_name", "'utl_inaddr'"),
            ("create table t2 as select utl_http.request('http://x') r from dual", "'utl_http'"),
            ("create materialized view mv as select utl_inaddr.get_host_name h from dual", "'utl_inaddr'"),
            ("create view v as select utl_http.request('http://x') r from dual", "'utl_http'"),
            ("with function f return number is begin utl_file.fremove('D', 'x'); return 1; end; select f from dual", "'utl_file'"),
            ("create or replace procedure p is begin null; end;\nbegin utl_file.fremove('D', 'x'); end;", "Nur ein Statement"),
            ("create or replace package body p as procedure w is v varchar2(100); begin select max(email) into v from kunden; utl_file.put_line(g_file, v); end; end p;", "redigiert"),
            ("create or replace procedure p is begin utl_file.fremove('D', 'x'); delete from hr.vault; end;", "Schema 'hr'"),
        ] {
            let error = check_write_sql(sql, &connection, &index).unwrap_err();
            assert!(error.contains(expected), "{sql}: {error}");
        }
        let split = issue_295_296_precheck(
            &connection,
            &index,
            &format!(
                "{}begin utl_file.fremove('D', 'x'); end;\n/\n",
                issue_295_package_body("p")
            ),
        )
        .unwrap_err();
        assert!(
            split.starts_with("#2: ") && split.contains("'utl_file'"),
            "{split}"
        );
        let no_ddl = McpConnection {
            allow_ddl: false,
            ..connection.clone()
        };
        let error = check_write_sql(&issue_295_package_body("p"), &no_ddl, &index).unwrap_err();
        assert!(error.contains("DDL ist"), "{error}");
        let mssql = McpConnection {
            kind: DatabaseKind::Mssql,
            ..connection.clone()
        };
        let error = check_write_sql(
            "create procedure p as exec xp_cmdshell 'dir'",
            &mssql,
            &index,
        )
        .unwrap_err();
        assert!(error.contains("'xp_cmdshell'"), "{error}");
    }

    #[test]
    fn issue_296_alter_table_modify_passes_the_script_precheck() {
        let (connection, index) = issue_278_setup();
        let script = "alter table T modify C varchar2(16);\nalter table T modify (NAME varchar2(16) default 'x');\nalter table T add (C2 varchar2(16 char), N number(10, 2));\nalter table T add constraint T_CK check (C in ('a', 'b'));\nalter table T add constraint T_FK foreign key (ID) references KUNDEN (ID);\n";
        assert_eq!(issue_295_296_precheck(&connection, &index, script), Ok(5));
        for (sql, expected) in [
            ("create table copy as select k.e from kunden k(i, e)", "Spaltenlisten"),
            ("create view v as with x(i, e) as (select k.id, k.id from kunden k) select x.e from x", "Spaltenlisten"),
            ("create table copy (a, b) as select * from kunden", "SELECT *"),
            ("alter table kunden rename column email to mail", "redigiert"),
        ] {
            let error = check_write_sql(sql, &connection, &index).unwrap_err();
            assert!(error.contains(expected), "{sql}: {error}");
        }
    }

    #[test]
    fn issue_295_296_deploy_script_precheck_stays_fast() {
        let (connection, index) = issue_278_setup();
        let mut script = issue_278_package_body(26);
        for n in 0..200 {
            script.push_str(&issue_295_package_body(&format!("app_files_{n}")));
            script.push_str(&format!(
                "alter table T modify C{n} varchar2({});\nalter table T add (D{n} number(10, 2));\n",
                n + 1
            ));
        }
        let mut samples: Vec<std::time::Duration> = (0..20)
            .map(|_| {
                let started = std::time::Instant::now();
                assert_eq!(
                    issue_295_296_precheck(&connection, &index, &script),
                    Ok(601)
                );
                started.elapsed()
            })
            .collect();
        samples.sort();
        let median = samples[samples.len() / 2];
        let p95 = samples[samples.len() * 95 / 100];
        let plan = plan(DatabaseKind::Oracle, &script).unwrap();
        let statements = sqls(&plan);
        let mut checks: Vec<std::time::Duration> = (0..20)
            .map(|_| {
                let started = std::time::Instant::now();
                let compiled = statements
                    .iter()
                    .filter(|statement| crate::db::oracle::is_stored_plsql(statement))
                    .count();
                assert_eq!(compiled, 201);
                started.elapsed()
            })
            .collect();
        checks.sort();
        let unit_check = checks[checks.len() / 2];
        println!(
            "issue_295_296: {} bytes, {} lines, {} statements, median {median:?}, p95 {p95:?}, stored-unit check {unit_check:?}",
            script.len(),
            script.lines().count(),
            statements.len()
        );
        assert!(p95 < std::time::Duration::from_millis(750), "{p95:?}");
        assert!(unit_check * 10 < median, "{unit_check:?} vs {median:?}");
    }

    #[tokio::test]
    #[ignore]
    async fn issue_278_oracle_lab_runs_plsql_from_the_report() {
        let Ok(url) = std::env::var("L8DB_SMOKE_ORACLE_URL") else {
            return;
        };
        let (_dir, mut config, sqlite, mut server) =
            super::super::sandbox::sqlite_fixture("CREATE TABLE t (id INTEGER);");
        let connection = McpConnection {
            id: "issue278".into(),
            kind: DatabaseKind::Oracle,
            connection_string: url,
            schemas: vec!["L8DB".into()],
            allow_scripts: true,
            ..sqlite
        };
        config.connections = vec![connection.clone()];
        let target = (config.clone(), connection.clone());
        async fn run(
            server: &mut Server,
            target: &(McpConfig, McpConnection),
            sql: String,
            commit: bool,
        ) -> Result<String, String> {
            let args = json!({"sql": sql, "confirm": true, "commit": commit});
            server.script(&target.0, &target.1, &args).await
        }
        let cleanup = "begin\n  for o in (select object_type, object_name from user_objects where object_name in ('I278_PKG', 'I278_LOG_PKG', 'I278_T', 'I278_KUNDEN', 'I278_LOG') and object_type in ('PACKAGE', 'TABLE')) loop\n    execute immediate 'drop ' || o.object_type || ' ' || o.object_name;\n  end loop;\nend;\n/";
        run(&mut server, &target, cleanup.into(), true)
            .await
            .unwrap();
        let setup = "create table i278_t (id number, name varchar2(30));\ncreate table i278_kunden (id number, email varchar2(100));\ncreate table i278_log (n number, s varchar2(100));\ninsert into i278_t (id, name) values (1, 'eins');\ninsert into i278_kunden (id, email) values (1, 'max@example.com');\ncreate or replace package i278_log_pkg as\n  procedure log (n number, s varchar2);\nend;\n/\ncreate or replace package body i278_log_pkg as\n  procedure log (n number, s varchar2) is\n  begin\n    insert into i278_log (n, s) values (n, s);\n  end;\nend;\n/\ncreate or replace package i278_pkg as\n  function f (p_id number) return number;\nend;\n/";
        let out = run(&mut server, &target, setup.into(), true).await.unwrap();
        assert!(out.contains("committed: 8/8 ok"), "{out}");

        let step3 = "begin\n  i278_log_pkg.log (5, 'x');\nend;\n/";
        let out = run(&mut server, &target, step3.into(), false)
            .await
            .unwrap();
        assert!(out.contains("rolled back: 1/1 ok"), "{out}");
        let step4 = "declare\n  r i278_t%rowtype;\nbegin\n  select * into r from i278_t where id = -1;\nexception when no_data_found then null;\nend;\n/";
        let out = run(&mut server, &target, step4.into(), false)
            .await
            .unwrap();
        assert!(out.contains("rolled back: 1/1 ok"), "{out}");

        let mut body = String::from("create or replace package body i278_pkg as\n");
        for n in 1..=25 {
            body.push_str(&format!(
                "  function h{n} (p_id number) return number is\n    r i278_t%rowtype;\n    v number;\n  begin\n    i278_log_pkg.log (p_id, 'h{n}');\n    select * into r from i278_t where id = p_id;\n    select count(distinct x.id) into v\n      from (select nvl(a.id, 0) as id from i278_t a\n            union\n            select k.id from i278_kunden k) x;\n    insert into i278_t (id, name) values (-p_id - {n}, r.name);\n    for c in (select a.* from i278_t a where a.id < 0) loop\n      v := v + nvl(c.id, 0);\n    end loop;\n"
            ));
            for line in 0..48 {
                body.push_str(&format!(
                    "    if mod(v, {}) = 0 then v := v + nvl(p_id, 0); end if; -- 16.01.2026 / 128\n",
                    line + 2
                ));
            }
            body.push_str("    return nvl(v, 0);\n  exception\n    when no_data_found then\n      return 0;\n  end;\n\n");
        }
        body.push_str("  function f (p_id number) return number is\n  begin\n    return h1(p_id) + h25(p_id);\n  end;\nend i278_pkg;\n/\n");
        assert!(body.lines().count() > 1600);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("i278_pkg.sql");
        std::fs::write(&path, &body).unwrap();
        let out = server
            .script(
                &config,
                &connection,
                &json!({"file": path.to_str().unwrap(), "confirm": true}),
            )
            .await
            .unwrap();
        assert!(out.contains("committed: 1/1 ok"), "{out}");

        let call = "set serveroutput on\ndeclare\n  v number;\nbegin\n  v := i278_pkg.f(1);\n  dbms_output.put_line('f=' || v);\nend;\n/\nselect status from user_objects where object_name = 'I278_PKG' and object_type = 'PACKAGE BODY';\nselect count(*) as n from i278_log;";
        let out = run(&mut server, &target, call.into(), false).await.unwrap();
        assert!(out.contains("| f="), "{out}");
        assert!(out.contains("VALID") && !out.contains("INVALID"), "{out}");

        let leak = "set serveroutput on\ndeclare\n  v varchar2(100);\nbegin\n  select k.email into v from i278_kunden k where k.id = 1;\n  dbms_output.put_line(v);\nend;\n/";
        let error = run(&mut server, &target, leak.into(), false)
            .await
            .unwrap_err();
        assert!(error.contains("redigiert"), "{error}");
        let schemas = super::super::server::adapter(&connection, &server.pool)
            .unwrap()
            .list_schemas()
            .await
            .unwrap();
        let foreign = schemas
            .iter()
            .find(|schema| !schema.eq_ignore_ascii_case("L8DB"))
            .expect("Lab braucht ein zweites Schema");
        let error = run(
            &mut server,
            &target,
            format!("begin\n  delete from {foreign}.i278_fremd;\nend;\n/"),
            false,
        )
        .await
        .unwrap_err();
        assert!(error.contains("nicht freigegeben"), "{foreign}: {error}");
        let renamed = "create view i278_v (a, b) as select * from i278_kunden;";
        let error = run(&mut server, &target, renamed.into(), false)
            .await
            .unwrap_err();
        assert!(error.contains("gesperrt"), "{error}");

        run(&mut server, &target, cleanup.into(), true)
            .await
            .unwrap();
    }
}
