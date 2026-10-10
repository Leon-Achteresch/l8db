use serde_json::{json, Value};
use std::collections::HashMap;

use super::config::{McpConfig, McpConnection};
use super::redact::{self, Redactor};
use super::server::{
    adapter, arg_str, cap, check_read_sql, check_write_sql, connection_url, format_result, run,
    Server, SQL_KINDS,
};
use crate::db::{self, DatabaseAdapter, DatabaseKind, QueryResult, TxSession};

pub fn tool_definition() -> Value {
    json!({
        "name": "script",
        "description": "Run many statements in one call (only on connections with scripts enabled). Every statement is checked like query/execute before anything runs; writes need confirm=true and a writable connection, DDL needs DDL enabled. Runs on one dedicated session inside a transaction: commits at the end, rolls back on the first error; commit=false always rolls back (dry run). Do not write BEGIN/ROLLBACK/SAVEPOINT; COMMIT lines are skipped. Oracle takes SQL*Plus scripts: / terminators, DEFINE x = v with &x/&&x, SET DEFINE OFF, PROMPT, EXEC, SET SERVEROUTPUT ON (DBMS_OUTPUT shown as |), WHENEVER SQLERROR EXIT|CONTINUE, EXIT [ROLLBACK]; other SQL*Plus settings are ignored, @file is rejected. Oracle DDL commits implicitly. Output: one line per statement, result rows as TSV.",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": super::server::database_arg(),
            "sql": {"type": "string"},
            "confirm": {"type": "boolean", "description": "Required when the script writes"},
            "commit": {"type": "boolean", "description": "false = roll back at the end (dry run). Default true"},
            "onError": {"type": "string", "enum": ["stop", "continue"], "description": "Default stop (rolls back)"},
            "limit": {"type": "integer", "minimum": 1, "description": "Rows shown per result, default 20"}
        }, "required": ["connection", "sql"]}
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

fn substitute(
    text: &str,
    defines: &HashMap<String, String>,
    marker: Option<char>,
) -> Result<String, String> {
    let Some(marker) = marker else {
        return Ok(text.to_string());
    };
    let chars: Vec<char> = text.chars().collect();
    let ident = |c: char| c.is_alphanumeric() || matches!(c, '_' | '$' | '#');
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] != marker {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let mut start = i + 1;
        if chars.get(start) == Some(&marker) {
            start += 1;
        }
        let mut end = start;
        while end < chars.len() && ident(chars[end]) {
            end += 1;
        }
        if end == start {
            out.push(chars[i]);
            i += 1;
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

fn sqlplus(
    line: &str,
    plan: &mut Plan,
    defines: &mut HashMap<String, String>,
    marker: &mut Option<char>,
) -> Result<bool, String> {
    let words = words(line);
    let rest = |n: usize| {
        line.split_whitespace()
            .skip(n)
            .collect::<Vec<_>>()
            .join(" ")
    };
    let arg = |n: usize| words.get(n).map(String::as_str).unwrap_or("");
    match arg(0) {
        "DEFINE" | "DEF" => define(&rest(1), defines),
        "UNDEFINE" | "UNDEF" => {
            for name in &words[1..] {
                defines.remove(name);
            }
        }
        "PROMPT" | "PRO" => plan
            .steps
            .push(Step::Prompt(substitute(&rest(1), defines, *marker)?)),
        "SET" if arg(1).starts_with("DEF") => {
            *marker = match arg(2) {
                "OFF" => None,
                "ON" | "" => Some('&'),
                other => other.chars().next(),
            }
        }
        "SET" if arg(1).starts_with("SERVEROUT") => plan.steps.push(Step::Output(arg(2) == "ON")),
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
    if kind == DatabaseKind::Oracle
        && (text.starts_with('@') || words(&text).first().is_some_and(|word| word == "START"))
    {
        return Err("Skriptdateien (@, @@, START) werden über den MCP nicht ausgeführt.".into());
    }
    plan.steps.push(Step::Sql(text));
    Ok(())
}

fn plan(kind: DatabaseKind, sql: &str) -> Result<Plan, String> {
    let mut plan = Plan::default();
    let items: Vec<(bool, String)> = match kind {
        DatabaseKind::Oracle => db::oracle::script_items(sql),
        DatabaseKind::Postgres => db::sql_script::split_postgres(sql)
            .into_iter()
            .map(|statement| (false, statement))
            .collect(),
        _ => db::sql_script::split(sql)
            .into_iter()
            .map(|statement| (false, statement))
            .collect(),
    };
    let mut defines = HashMap::new();
    let mut marker = Some('&');
    for (is_sqlplus, text) in items {
        if is_sqlplus {
            if !sqlplus(&text, &mut plan, &mut defines, &mut marker)? {
                break;
            }
            continue;
        }
        let text = match kind {
            DatabaseKind::Oracle => substitute(&text, &defines, marker)?,
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
    Direct(Box<dyn DatabaseAdapter>),
}

impl Runner {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        match self {
            Runner::Session(session) => session.execute(sql).await,
            Runner::Direct(adapter) => adapter.execute_query(sql).await,
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
            Runner::Direct(adapter) => adapter.set_server_output(enabled).await,
        }
    }

    async fn take_output(&mut self) -> Result<Vec<String>, String> {
        match self {
            Runner::Session(session) => session.server_output().await,
            Runner::Direct(adapter) => Ok(adapter
                .take_server_output()
                .await?
                .into_iter()
                .map(|message| message.message)
                .collect()),
        }
    }

    async fn finish(&mut self, commit: bool) -> Result<(), String> {
        match self {
            Runner::Session(session) if commit => session.commit().await,
            Runner::Session(session) => session.rollback().await,
            Runner::Direct(_) => Ok(()),
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
        if !SQL_KINDS.contains(&connection.kind) {
            return Err("script unterstützt nur SQL-Datenbanken.".into());
        }
        let sql = arg_str(args, "sql").trim();
        if sql.is_empty() {
            return Err("sql fehlt".into());
        }
        let plan = plan(connection.kind, sql)?;
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let columns = self.columns_for(config, connection).await?;
        let index = redact::SchemaIndex::new(&columns, &redactor, connection.allowed_schemas());
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
            checked.map_err(|e| format!("#{} {}: {e}", number + 1, preview(statement)))?;
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
            Runner::Direct(adapter(connection, &self.pool)?)
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
                    Runner::Direct(adapter(connection, &self.pool)?)
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
                            lines.push(format!(
                                "#{number} ERR {} [{}]",
                                super::server::scrub_error(&error),
                                preview(statement)
                            ));
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
            self.columns.remove(&super::server::cache_key(connection));
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
    fn rejects_undefined_variables_files_and_transaction_control() {
        assert!(plan(DatabaseKind::Oracle, "SELECT &x FROM dual;")
            .unwrap_err()
            .contains("&x"));
        assert!(plan(DatabaseKind::Oracle, "@install.sql").is_err());
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
    fn splits_generic_scripts() {
        let plan = plan(
            DatabaseKind::Postgres,
            "CREATE TEMP TABLE t (x int); INSERT INTO t VALUES (1); DO $$ BEGIN PERFORM 1; END $$; SELECT 'a&b' FROM t; COMMIT;",
        )
        .unwrap();
        assert_eq!(sqls(&plan).len(), 4);
        assert_eq!(plan.skipped, 1);
    }
}
