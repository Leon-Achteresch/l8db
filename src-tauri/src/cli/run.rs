use serde_json::{json, Value};
use std::io::{BufRead, IsTerminal, Read, Write};
use std::time::Instant;

use super::connect::{self, Session, Source, Target};
use super::output::{self, Format};
use super::store;
use super::{Cli, Command, ConnCommand, Global, Limit, QueryArgs, TableCommand, TaskCommand};
use crate::automation::model::{AutomationConnection, ProxyKind};
use crate::db::execution::{self, ExecutionOptions};
use crate::db::{self, DatabaseKind, QueryResult, TxSession};
use crate::mcp::{nosql, redact};

const CANCELLED: i32 = 130;

pub fn dispatch(cli: Cli) -> i32 {
    let Cli {
        global, command, ..
    } = cli;
    match command {
        Command::Help { command } => super::help_for(&command),
        Command::Completions { shell } => super::completions(shell),
        Command::Mcp => {
            crate::mcp::serve();
            0
        }
        Command::Check {
            config,
            url_env,
            report,
        } => {
            let mut args = vec![
                "--check".into(),
                "--config".into(),
                config,
                "--url-env".into(),
                url_env,
            ];
            if let Some(report) = report {
                args.extend(["--output".into(), report]);
            }
            crate::check_cli::cli(&args)
        }
        Command::Task { command } => crate::automation::cli::cli(&task_args(command, &global)),
        command => block_on(&global, command),
    }
}

pub(super) fn task_args(command: TaskCommand, global: &Global) -> Vec<String> {
    let mut args: Vec<String> = match command {
        TaskCommand::List => vec!["--list-tasks".into()],
        TaskCommand::Tick => vec!["--automation-tick".into()],
        TaskCommand::Run {
            task,
            vars,
            env,
            from_step,
            quiet,
        } => {
            let mut args = vec!["--run-task".into(), task];
            for var in vars {
                args.extend(["--var".into(), var]);
            }
            if let Some(env) = env {
                args.extend(["--env".into(), env]);
            }
            if let Some(step) = from_step {
                args.extend(["--from-step".into(), step]);
            }
            if quiet {
                args.push("--quiet".into());
            }
            args
        }
    };
    if global.output == Some(Format::Json) {
        args.push("--json".into());
    }
    args
}

fn block_on(global: &Global, command: Command) -> i32 {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("Fehler: Laufzeit konnte nicht gestartet werden: {error}");
            return 1;
        }
    };
    let job = format!("cli-{}", std::process::id());
    let code = runtime.block_on(async {
        let work = execute(global, command, &job);
        tokio::pin!(work);
        tokio::select! {
            result = &mut work => match result {
                Ok(()) => 0,
                Err(error) => {
                    eprintln!("Fehler: {error}");
                    1
                }
            },
            _ = tokio::signal::ctrl_c() => {
                if matches!(execution::cancel(&job), Ok(true)) {
                    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), &mut work).await;
                }
                eprintln!("\nAbgebrochen.");
                CANCELLED
            }
        }
    });
    if code == CANCELLED {
        runtime.shutdown_background();
    } else {
        runtime.shutdown_timeout(std::time::Duration::from_secs(2));
    }
    code
}

async fn saved_connections() -> Result<Vec<AutomationConnection>, String> {
    let services = connect::services()?;
    let mut list = services.store.connections().await?;
    list.sort_by_key(|c| c.name.to_lowercase());
    Ok(list)
}

const NO_CONNECTIONS: &str = "Noch keine Verbindungen gefunden.\n  Öffne l8db einmal, dann übernimmt die CLI deine gespeicherten Verbindungen automatisch.\n  Ohne App: --url postgres://user@host/db";

async fn resolve(global: &Global, explicit: Option<&str>) -> Result<Source, String> {
    let env = |name: &str| std::env::var(name).ok().filter(|v| !v.trim().is_empty());
    if explicit.is_none() && global.connection.is_none() {
        if let Some(url) = global.url.clone().or_else(|| env("L8DB_URL")) {
            return connect::ad_hoc(&url);
        }
    }
    let list = saved_connections().await?;
    if list.is_empty() {
        return Err(NO_CONNECTIONS.into());
    }
    let wanted = explicit
        .map(str::to_string)
        .or_else(|| global.connection.clone())
        .or_else(|| env("L8DB_CONNECTION"));
    if let Some(wanted) = wanted {
        return Ok(Source::Saved(Target::saved(store::find(&list, &wanted)?)));
    }
    if let Some(default) = store::load_settings()?.default_connection {
        let found = store::find(&list, &default).map_err(|_| {
            "Die Standardverbindung gibt es nicht mehr.\n  Neu festlegen: l8db conn use <name>"
                .to_string()
        })?;
        return Ok(Source::Saved(Target::saved(found)));
    }
    if let [only] = list.as_slice() {
        return Ok(Source::Saved(Target::saved(only)));
    }
    let names: Vec<&str> = list.iter().map(|c| c.name.as_str()).collect();
    Err(format!(
        "Welche Verbindung? Mit -c <name> angeben oder einmal festlegen: l8db conn use <name>\n  Verfügbar: {}",
        names.join(", ")
    ))
}

async fn session(global: &Global, explicit: Option<&str>) -> Result<Session, String> {
    connect::open(resolve(global, explicit).await?, global.database.as_deref()).await
}

fn options(job: &str, timeout: u64) -> ExecutionOptions {
    ExecutionOptions {
        job_id: Some(job.to_string()),
        query_timeout: Some(if timeout == 0 {
            execution::UNCLAMPED_MAX_SECONDS
        } else {
            timeout
        }),
        connection_timeout: Some(15),
    }
}

async fn guarded<T, F>(job: &str, kind: DatabaseKind, timeout: u64, future: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    execution::without_query_limit(execution::run_query(
        Some(options(job, timeout)),
        matches!(kind, DatabaseKind::Postgres | DatabaseKind::Sqlite),
        future,
    ))
    .await
}

async fn execute(global: &Global, command: Command, job: &str) -> Result<(), String> {
    let format = Format::resolve(global.output);
    let mut out = std::io::stdout().lock();
    match command {
        Command::Conn { command } => match command.unwrap_or(ConnCommand::List) {
            ConnCommand::List => list_connections(format, &mut out).await,
            ConnCommand::Use { name, clear } => use_connection(name.as_deref(), clear).await,
            ConnCommand::Show { name } => {
                show_connection(global, name.as_deref(), format, &mut out).await
            }
            ConnCommand::Test { name } => {
                let started = Instant::now();
                let session = session(global, name.as_deref()).await?;
                guarded(
                    job,
                    session.target.kind,
                    30,
                    session.adapter.test_connection(),
                )
                .await?;
                let via = match session.via.label() {
                    "direkt" => String::new(),
                    label => format!(" über {label}"),
                };
                eprintln!(
                    "✓ Verbunden mit „{}“{via} ({} ms)",
                    session.target.name,
                    started.elapsed().as_millis()
                );
                Ok(())
            }
        },
        Command::Open { name } => open_in_app(global, name.as_deref()).await,
        Command::Db { .. } => {
            let session = session(global, None).await?;
            let names = guarded(
                job,
                session.target.kind,
                60,
                session.adapter.list_databases(),
            )
            .await?;
            write(output::write_list(&mut out, format, "database", &names))
        }
        Command::Schema { .. } => {
            let session = session(global, None).await?;
            let names =
                guarded(job, session.target.kind, 60, session.adapter.list_schemas()).await?;
            write(output::write_list(&mut out, format, "schema", &names))
        }
        Command::Table { command } => {
            let session = session(global, None).await?;
            let command = command.unwrap_or(TableCommand::List { schema: None });
            table(&session, command, format, job, &mut out).await
        }
        Command::Query(args) => query(global, args, format, job, &mut out).await,
        _ => Err("Dieser Befehl wird hier nicht unterstützt.".into()),
    }
}

fn write(result: std::io::Result<()>) -> Result<(), String> {
    match result {
        Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => Ok(()),
        other => other.map_err(|e| format!("Ausgabe fehlgeschlagen: {e}")),
    }
}

pub(super) fn split_table(name: &str) -> (Option<String>, String) {
    let unquote = |part: &str| {
        let part = part.trim();
        for (open, close) in [('"', '"'), ('`', '`'), ('[', ']')] {
            if let Some(inner) = part.strip_prefix(open).and_then(|s| s.strip_suffix(close)) {
                return inner.to_string();
            }
        }
        part.to_string()
    };
    match name.rsplit_once('.') {
        Some((schema, table)) if !schema.trim().is_empty() && !table.trim().is_empty() => {
            (Some(unquote(schema)), unquote(table))
        }
        _ => (None, unquote(name)),
    }
}

async fn locate(session: &Session, name: &str, job: &str) -> Result<(String, String), String> {
    let (schema, table) = split_table(name);
    let tables = guarded(
        job,
        session.target.kind,
        60,
        session.adapter.list_tables(schema.as_deref()),
    )
    .await?;
    let exact: Vec<_> = tables
        .iter()
        .filter(|t| t.name == table && schema.as_ref().is_none_or(|s| &t.schema == s))
        .collect();
    let candidates = if exact.is_empty() {
        tables
            .iter()
            .filter(|t| {
                t.name.eq_ignore_ascii_case(&table)
                    && schema
                        .as_ref()
                        .is_none_or(|s| t.schema.eq_ignore_ascii_case(s))
            })
            .collect()
    } else {
        exact
    };
    match candidates.as_slice() {
        [one] => Ok((one.schema.clone(), one.name.clone())),
        [] => Err(format!(
            "Tabelle „{name}“ nicht gefunden.\n  Alle Tabellen: l8db table list"
        )),
        many => Err(format!(
            "„{name}“ gibt es in mehreren Schemas: {}. Bitte als schema.tabelle angeben.",
            many.iter()
                .map(|t| format!("{}.{}", t.schema, t.name))
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

async fn table(
    session: &Session,
    command: TableCommand,
    format: Format,
    job: &str,
    out: &mut impl Write,
) -> Result<(), String> {
    let kind = session.target.kind;
    let adapter = &session.adapter;
    let filter = match &command {
        TableCommand::Rows { filter, .. } | TableCommand::Count { filter, .. } => filter.clone(),
        _ => None,
    };
    if let Some(filter) = filter.filter(|_| is_sql(kind)) {
        db::validate_table_filter(&filter)
            .map_err(|_| "--where darf nur eine Bedingung enthalten (ohne ; -- /* UNION INTO RETURNING).\n  Für eigenes SQL: l8db q \"select … where …\"".to_string())?;
        if writes(kind, &filter) {
            allow_write(&session.target, false).await?;
        }
    }
    match command {
        TableCommand::List { schema } => {
            let tables = guarded(job, kind, 60, adapter.list_tables(schema.as_deref())).await?;
            let rows: Vec<Value> = tables.iter().map(|t| json!([t.schema, t.name])).collect();
            write(output::write_rows(
                out,
                format,
                &["schema".into(), "table".into()],
                &rows,
            ))
        }
        TableCommand::Describe { table } => {
            let (schema, name) = locate(session, &table, job).await?;
            let columns = guarded(
                job,
                kind,
                60,
                adapter.list_columns(Some(&schema), Some(&name), None),
            )
            .await?;
            let rows: Vec<Value> = columns
                .iter()
                .map(|c| json!([c.name, c.data_type]))
                .collect();
            write(output::write_rows(
                out,
                format,
                &["column".into(), "type".into()],
                &rows,
            ))
        }
        TableCommand::Rows {
            table,
            filter,
            order_by,
            desc,
            limit,
            offset,
        } => {
            let (schema, name) = locate(session, &table, job).await?;
            let limit = limit.max(1);
            let data = guarded(
                job,
                kind,
                300,
                adapter.fetch_rows(
                    &schema,
                    &name,
                    filter.as_deref(),
                    limit,
                    offset.max(0),
                    order_by.as_deref(),
                    desc,
                    false,
                    false,
                ),
            )
            .await?;
            if let Some(column) = order_by.filter(|c| !data.columns.contains(c)) {
                eprintln!("Hinweis: Spalte „{column}“ gibt es nicht, Sortierung ignoriert.");
            }
            write(output::write_rows(out, format, &data.columns, &data.rows))?;
            if data.rows.len() as i64 >= limit && format == Format::Table {
                eprintln!(
                    "{} Zeilen angezeigt. Weiter: --offset {} oder mehr mit -n <anzahl>",
                    data.rows.len(),
                    offset.max(0) + limit
                );
            }
            Ok(())
        }
        TableCommand::Count { table, filter } => {
            let (schema, name) = locate(session, &table, job).await?;
            let count = guarded(
                job,
                kind,
                300,
                adapter.count_rows(&schema, &name, filter.as_deref(), false),
            )
            .await?;
            match format {
                Format::Table | Format::Tsv => write(writeln!(out, "{count}")),
                _ => write(output::write_rows(
                    out,
                    format,
                    &["count".into()],
                    &[json!([count])],
                )),
            }
        }
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

fn read_sql(sql: Option<String>, file: Option<std::path::PathBuf>) -> Result<String, String> {
    let sql = match (&sql, &file) {
        (_, Some(path)) => {
            std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?
        }
        (Some(sql), None) if sql != "-" => sql.clone(),
        (sql, None) => {
            let stdin = std::io::stdin();
            if sql.is_none() && stdin.is_terminal() {
                return Err("Kein SQL angegeben.\n  Beispiel: l8db q \"select 1\"\n  Aus Datei: l8db query -f skript.sql".into());
            }
            let mut text = String::new();
            stdin
                .lock()
                .read_to_string(&mut text)
                .map_err(|e| format!("Standardeingabe: {e}"))?;
            text
        }
    };
    if sql.trim().is_empty() {
        return Err("Das SQL ist leer.".into());
    }
    Ok(sql)
}

fn is_sql(kind: DatabaseKind) -> bool {
    !matches!(
        kind,
        DatabaseKind::Mongodb
            | DatabaseKind::Redis
            | DatabaseKind::Elasticsearch
            | DatabaseKind::Influxdb
            | DatabaseKind::S3
    )
}

pub(super) fn statements(kind: DatabaseKind, sql: &str) -> Vec<String> {
    let parts: Vec<String> = match kind {
        DatabaseKind::Oracle => db::oracle::script_items(sql)
            .into_iter()
            .filter_map(|(sqlplus, text)| {
                if sqlplus {
                    eprintln!("Hinweis: SQL*Plus-Befehl übersprungen: {}", text.trim());
                    None
                } else {
                    Some(text)
                }
            })
            .collect(),
        DatabaseKind::Postgres => db::sql_script::split_postgres(sql),
        kind if is_sql(kind) => db::sql_script::split(sql),
        _ => vec![sql.to_string()],
    };
    parts.into_iter().filter(|s| !s.trim().is_empty()).collect()
}

const MONGO_READ: &[&str] = &[
    "find",
    "aggregate",
    "count",
    "distinct",
    "listCollections",
    "listIndexes",
];

pub(super) fn writes(kind: DatabaseKind, statement: &str) -> bool {
    match kind {
        DatabaseKind::Redis => nosql::redis_check(statement, false).is_err(),
        DatabaseKind::Mongodb => nosql::mongo_command(statement)
            .ok()
            .and_then(|doc| doc.keys().next().cloned())
            .is_none_or(|op| !MONGO_READ.contains(&op.as_str())),
        DatabaseKind::Elasticsearch => {
            db::elasticsearch::read_only_request(statement) != Some(true)
        }
        DatabaseKind::Influxdb => db::influxdb::read_only_statement(statement) != Some(true),
        DatabaseKind::S3 => false,
        _ => redact::write_word(statement).is_some() || redact::is_ddl(statement),
    }
}

async fn confirm_production(target: &Target, yes: bool) -> Result<(), String> {
    if yes {
        return Ok(());
    }
    let name = target.name.clone();
    blocking(move || ask_production(&name)).await
}

fn ask_production(name: &str) -> Result<(), String> {
    let stdin = std::io::stdin();
    if !stdin.is_terminal() || !std::io::stderr().is_terminal() {
        return Err(format!(
            "„{name}“ ist eine Produktionsverbindung und das SQL schreibt.\n  Zum Bestätigen --yes anhängen."
        ));
    }
    eprint!(
        "⚠ „{name}“ ist Produktion und das SQL schreibt.\n  Zum Ausführen den Verbindungsnamen eintippen: "
    );
    let _ = std::io::stderr().flush();
    let mut answer = String::new();
    stdin
        .lock()
        .read_line(&mut answer)
        .map_err(|e| e.to_string())?;
    if answer.trim() == name {
        Ok(())
    } else {
        Err("Nicht bestätigt, nichts ausgeführt.".into())
    }
}

async fn query(
    global: &Global,
    args: QueryArgs,
    format: Format,
    job: &str,
    out: &mut impl Write,
) -> Result<(), String> {
    let (sql, file) = (args.sql.clone(), args.file.clone());
    let sql = blocking(move || read_sql(sql, file)).await?;
    let source = resolve(global, None).await?;
    let target = source.target();
    let parts = statements(target.kind, &sql);
    if parts.is_empty() {
        return Err("Das SQL enthält keine Anweisung.".into());
    }
    let writing = parts.iter().any(|statement| writes(target.kind, statement));
    if writing {
        allow_write(target, args.yes).await?;
    }
    let session = connect::open(source, global.database.as_deref()).await?;
    let kind = session.target.kind;
    let limit = args.limit;
    let mut transaction: Option<Box<dyn TxSession>> = None;
    if parts.len() > 1 && writing && !args.no_transaction {
        match db::import::open_session(
            kind,
            &session.url,
            global.database.as_deref(),
            session.services.pool.clone(),
        )
        .await
        {
            Ok(tx) => transaction = Some(tx),
            Err(e) if e.contains("nicht unterstützt") => {}
            Err(e) => return Err(e),
        }
    }
    if let (DatabaseKind::Postgres, [statement], false, Some(rows)) =
        (kind, parts.as_slice(), writing, limit.rows())
    {
        let started = Instant::now();
        match postgres_cursor(&session, statement, rows, global, job, args.timeout).await? {
            Cursor::Done(result) => {
                return print_result(out, format, &result, limit, started, false)
            }
            Cursor::Writes => allow_write(&session.target, args.yes).await?,
            Cursor::Skip => {}
        }
    }
    let total = parts.len();
    for (index, statement) in parts.iter().enumerate() {
        let started = Instant::now();
        let result = match transaction.as_mut() {
            Some(tx) => {
                guarded(
                    job,
                    kind,
                    args.timeout,
                    limited(limit, tx.execute(statement)),
                )
                .await
            }
            None => {
                guarded(
                    job,
                    kind,
                    args.timeout,
                    limited(limit, session.adapter.execute_query(statement)),
                )
                .await
            }
        };
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                let mut message = if total > 1 {
                    format!("Anweisung {} von {total}: {error}", index + 1)
                } else {
                    error
                };
                if let Some(mut tx) = transaction.take() {
                    let _ = tx.rollback().await;
                    message.push_str(rollback_note(kind, &parts[..=index]));
                } else if index > 0 && writing {
                    message.push_str(&format!(
                        "\n  Die {index} Anweisung(en) davor sind bereits ausgeführt."
                    ));
                }
                return Err(message);
            }
        };
        print_result(out, format, &result, limit, started, total > 1)?;
    }
    if let Some(mut tx) = transaction {
        tx.commit().await?;
        eprintln!("✓ {total} Anweisungen in einer Transaktion übernommen.");
    }
    Ok(())
}

async fn allow_write(target: &Target, yes: bool) -> Result<(), String> {
    if target.read_only {
        return Err(format!(
            "„{}“ ist schreibgeschützt, das SQL würde schreiben.\n  Schreibschutz oder Produktionssperre lassen sich nur in der App ändern.",
            target.name
        ));
    }
    if target.production {
        confirm_production(target, yes).await?;
    }
    Ok(())
}

pub(super) fn rollback_note(kind: DatabaseKind, ran: &[String]) -> &'static str {
    let controls = ran.iter().any(|statement| {
        redact::sql_words(statement).first().is_some_and(|word| {
            matches!(
                word.as_str(),
                "begin" | "start" | "commit" | "end" | "rollback" | "savepoint" | "release"
            )
        })
    });
    let implicit = matches!(kind, DatabaseKind::Mysql | DatabaseKind::Oracle)
        && ran.iter().any(|statement| redact::is_ddl(statement));
    if controls {
        "\n  Transaktion zurückgerollt. Achtung: Das Skript steuert Transaktionen selbst (BEGIN/COMMIT), bereits festgeschriebene Teile bleiben bestehen."
    } else if implicit {
        "\n  Transaktion zurückgerollt. Achtung: CREATE/ALTER/DROP schreibt diese Datenbank sofort fest, solche Anweisungen davor bleiben bestehen."
    } else {
        "\n  Nichts geändert: das Skript wurde komplett zurückgerollt."
    }
}

enum Cursor {
    Done(QueryResult),
    Writes,
    Skip,
}

const READ_ONLY_VIOLATION: &str = "SQLSTATE 25006";

fn cursor_safe(statement: &str) -> bool {
    redact::sql_words(statement)
        .first()
        .is_some_and(|word| matches!(word.as_str(), "select" | "with" | "values" | "table"))
}

async fn postgres_cursor(
    session: &Session,
    statement: &str,
    rows: usize,
    global: &Global,
    job: &str,
    timeout: u64,
) -> Result<Cursor, String> {
    if !cursor_safe(statement) {
        return Ok(Cursor::Skip);
    }
    let Ok(mut tx) = db::import::open_session(
        DatabaseKind::Postgres,
        &session.url,
        global.database.as_deref(),
        session.services.pool.clone(),
    )
    .await
    else {
        return Ok(Cursor::Skip);
    };
    if tx.execute("SET TRANSACTION READ ONLY").await.is_err() {
        let _ = tx.rollback().await;
        return Ok(Cursor::Skip);
    }
    let body = statement.trim().trim_end_matches(';');
    let declared = guarded(
        job,
        DatabaseKind::Postgres,
        timeout,
        tx.execute(&format!("DECLARE l8db_cli NO SCROLL CURSOR FOR {body}")),
    )
    .await;
    if let Err(error) = declared {
        let _ = tx.rollback().await;
        return read_only_violation(error);
    }
    let fetched = guarded(
        job,
        DatabaseKind::Postgres,
        timeout,
        tx.execute(&format!(
            "FETCH FORWARD {} FROM l8db_cli",
            rows.saturating_add(1)
        )),
    )
    .await;
    let _ = tx.rollback().await;
    let mut result = match fetched {
        Ok(result) => result,
        Err(error) => return read_only_violation(error),
    };
    result.truncated |= result.rows.len() > rows;
    result.rows.truncate(rows);
    Ok(Cursor::Done(result))
}

fn read_only_violation(error: String) -> Result<Cursor, String> {
    if error.contains(READ_ONLY_VIOLATION) {
        Ok(Cursor::Writes)
    } else {
        Err(error)
    }
}

async fn limited<F>(limit: Limit, future: F) -> Result<QueryResult, String>
where
    F: std::future::Future<Output = Result<QueryResult, String>>,
{
    match limit.rows() {
        Some(rows) => {
            let mut result = execution::with_row_limit(rows.saturating_add(1), future).await?;
            result.truncated |= result.rows.len() > rows;
            result.rows.truncate(rows);
            Ok(result)
        }
        None => future.await,
    }
}

fn print_result(
    out: &mut impl Write,
    format: Format,
    result: &QueryResult,
    limit: Limit,
    started: Instant,
    script: bool,
) -> Result<(), String> {
    let elapsed = started.elapsed().as_millis();
    if result.columns.is_empty() {
        let message = match result.rows_affected {
            Some(1) => "1 Zeile geändert".to_string(),
            Some(rows) => format!("{rows} Zeilen geändert"),
            None => "OK".to_string(),
        };
        eprintln!("✓ {message} ({elapsed} ms)");
        return Ok(());
    }
    write(output::write_rows(
        out,
        format,
        &result.columns,
        &result.rows,
    ))?;
    let _ = out.flush();
    if result.truncated {
        eprintln!(
            "Nur die ersten {} Zeilen. Mehr: -n <anzahl> oder --all",
            limit.rows().unwrap_or(result.rows.len())
        );
    } else if format == Format::Table || script {
        let rows = result.rows.len();
        eprintln!(
            "({rows} {}, {elapsed} ms)",
            if rows == 1 { "Zeile" } else { "Zeilen" }
        );
    }
    Ok(())
}

async fn use_connection(name: Option<&str>, clear: bool) -> Result<(), String> {
    let mut settings = store::load_settings()?;
    if clear {
        settings.default_connection = None;
        store::save_settings(&settings)?;
        eprintln!("Standardverbindung entfernt.");
        return Ok(());
    }
    let list = saved_connections().await?;
    if list.is_empty() {
        return Err(NO_CONNECTIONS.into());
    }
    let found = store::find(&list, name.unwrap_or_default())?;
    settings.default_connection = Some(found.id.clone());
    store::save_settings(&settings)?;
    eprintln!("✓ Standardverbindung ist jetzt „{}“.", found.name);
    Ok(())
}

pub(super) fn address(raw: &str) -> String {
    if !raw.contains("://") {
        return raw
            .split(';')
            .filter(|part| {
                let key = part
                    .split('=')
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_lowercase();
                !matches!(key.as_str(), "password" | "pwd")
            })
            .collect::<Vec<_>>()
            .join(";");
    }
    let Ok(url) = url::Url::parse(raw) else {
        return raw.split('?').next().unwrap_or_default().to_string();
    };
    let host = url.host_str().unwrap_or_default();
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    let user = match url.username() {
        "" => String::new(),
        user => format!("{user}@"),
    };
    let path = url.path().trim_end_matches('/');
    if host.is_empty() {
        format!("{}://{path}", url.scheme())
    } else {
        format!("{user}{host}{port}{path}")
    }
}

fn tunnel(connection: &AutomationConnection) -> String {
    if let Some(command) = connection
        .command_tunnel
        .as_ref()
        .filter(|c| !c.command.trim().is_empty())
    {
        let program = command
            .command
            .split_whitespace()
            .next()
            .unwrap_or_default();
        return format!("Befehl ({program})");
    }
    if let Some(ssh) = connection
        .ssh
        .as_ref()
        .filter(|s| !s.host.trim().is_empty())
    {
        return format!("SSH {}@{}", ssh.user, ssh.host);
    }
    if let Some(proxy) = connection
        .proxy
        .as_ref()
        .filter(|p| !p.host.trim().is_empty())
    {
        let kind = match proxy.kind {
            ProxyKind::Socks5 => "SOCKS5",
            ProxyKind::Http => "HTTP-Proxy",
        };
        return format!("{kind} {}:{}", proxy.host, proxy.port);
    }
    String::new()
}

fn kind_name(kind: DatabaseKind) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn notes(connection: &AutomationConnection) -> String {
    [
        connection.read_only.then_some("schreibgeschützt"),
        (connection.production_locked && !connection.read_only).then_some("Produktionssperre"),
        connection
            .vault
            .then_some("Passwortmanager, nur in der App"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(", ")
}

fn describe(connection: &AutomationConnection, is_default: bool) -> Value {
    json!({
        "id": connection.id,
        "name": connection.name,
        "kind": kind_name(connection.kind),
        "environment": connection.environment,
        "address": address(&connection.connection_string),
        "tunnel": tunnel(connection),
        "readOnly": connection.read_only || connection.production_locked,
        "tags": connection.tags,
        "default": is_default,
    })
}

async fn list_connections(format: Format, out: &mut impl Write) -> Result<(), String> {
    let list = saved_connections().await?;
    let default = store::load_settings()?.default_connection;
    if list.is_empty() && format == Format::Table {
        eprintln!("{NO_CONNECTIONS}");
        return Ok(());
    }
    let is_default = |c: &AutomationConnection| default.as_deref() == Some(c.id.as_str());
    match format {
        Format::Json | Format::Ndjson => {
            let rows: Vec<Value> = list.iter().map(|c| describe(c, is_default(c))).collect();
            let columns: Vec<String> = [
                "id",
                "name",
                "kind",
                "environment",
                "address",
                "tunnel",
                "readOnly",
                "tags",
                "default",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect();
            write(output::write_rows(out, format, &columns, &rows))
        }
        _ => {
            let rows: Vec<Value> = list
                .iter()
                .map(|c| {
                    json!([
                        if is_default(c) { "*" } else { "" },
                        c.name,
                        kind_name(c.kind),
                        c.environment.clone().unwrap_or_default(),
                        address(&c.connection_string),
                        tunnel(c),
                        notes(c)
                    ])
                })
                .collect();
            let columns: Vec<String> = [
                "", "name", "typ", "umgebung", "adresse", "tunnel", "hinweis",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect();
            write(output::write_rows(out, format, &columns, &rows))?;
            if format == Format::Table && default.is_none() && list.len() > 1 {
                eprintln!("Tipp: Mit „l8db conn use <name>“ eine Standardverbindung festlegen, dann entfällt -c.");
            }
            Ok(())
        }
    }
}

async fn show_connection(
    global: &Global,
    name: Option<&str>,
    format: Format,
    out: &mut impl Write,
) -> Result<(), String> {
    let source = resolve(global, name).await?;
    let Source::Saved(target) = source else {
        return Err(
            "show zeigt gespeicherte Verbindungen. Für --url gibt es nichts anzuzeigen.".into(),
        );
    };
    let list = saved_connections().await?;
    let connection = store::find(&list, &target.id)?;
    let default = store::load_settings()?.default_connection;
    let details = describe(
        connection,
        default.as_deref() == Some(connection.id.as_str()),
    );
    if matches!(format, Format::Json | Format::Ndjson) {
        return write(writeln!(
            out,
            "{}",
            serde_json::to_string_pretty(&details).unwrap_or_default()
        ));
    }
    let yes_no = |flag: bool| if flag { "ja" } else { "nein" };
    let dash = |text: String| {
        if text.is_empty() {
            "–".to_string()
        } else {
            text
        }
    };
    let fields = [
        ("Name", connection.name.clone()),
        ("ID", connection.id.clone()),
        ("Typ", kind_name(connection.kind)),
        ("Adresse", address(&connection.connection_string)),
        (
            "Umgebung",
            dash(connection.environment.clone().unwrap_or_default()),
        ),
        ("Tunnel", dash(tunnel(connection))),
        ("Tags", dash(connection.tags.join(", "))),
        ("Schreibgeschützt", yes_no(connection.read_only).into()),
        (
            "Produktionssperre",
            yes_no(connection.production_locked).into(),
        ),
        ("Standard", yes_no(details["default"] == json!(true)).into()),
    ];
    let width = fields
        .iter()
        .map(|(k, _)| k.chars().count())
        .max()
        .unwrap_or(0);
    for (key, value) in fields {
        write(writeln!(out, "{key:<width$}  {value}"))?;
    }
    Ok(())
}

async fn open_in_app(global: &Global, name: Option<&str>) -> Result<(), String> {
    let Source::Saved(target) = resolve(global, name).await? else {
        return Err("open braucht eine gespeicherte Verbindung, keine --url.".into());
    };
    let exe = std::env::current_exe().map_err(|e| format!("Programmpfad unbekannt: {e}"))?;
    let mut command = crate::process::std_command(exe);
    command
        .arg(format!("--menu=dock.connection:{}", target.id))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    command
        .spawn()
        .map_err(|e| format!("App konnte nicht gestartet werden: {e}"))?;
    eprintln!("Öffne „{}“ in l8db …", target.name);
    Ok(())
}
