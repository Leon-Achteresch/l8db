use serde_json::{json, Value};
use std::io::{BufRead, IsTerminal, Read, Write};
use std::time::Instant;

use super::connect::{self, Session, Source, Target};
use super::output::{self, Format};
use super::store;
use super::{
    Cli, Command, ConnCommand, Global, Limit, PolicyCommand, QueryArgs, TableCommand, TaskCommand,
};
use crate::automation::model::{AutomationConnection, ProxyKind};
use crate::db::execution::{self, ExecutionOptions};
use crate::db::{self, DatabaseKind, QueryResult, TxSession};
use crate::mcp::{nosql, redact};

const CANCELLED: i32 = 130;
pub(super) const ABORTED: &str = "Abgebrochen.";
pub(super) const CONFIRM_REQUIRED: &str = "Bestätigung für Produktion erforderlich.";

pub fn dispatch(cli: Cli) -> i32 {
    let Cli {
        global, command, ..
    } = cli;
    match command {
        Command::Doctor {
            test_keychain,
            strict,
        } => {
            let rows = super::doctor::report(test_keychain);
            let failed = rows
                .iter()
                .any(|row| row["status"] == "error" || (strict && row["status"] != "ok"));
            match output::write_rows(
                &mut std::io::stdout(),
                Format::resolve(global.output),
                &["check".into(), "status".into(), "detail".into()],
                &rows,
            ) {
                Ok(()) => i32::from(failed),
                Err(_) => 1,
            }
        }
        Command::Policy {
            command: PolicyCommand::Templates { directory },
        } => {
            let files = [
                ("l8db.admx", include_str!("../../policy/l8db.admx")),
                (
                    "de-DE/l8db.adml",
                    include_str!("../../policy/de-DE/l8db.adml"),
                ),
                (
                    "en-US/l8db.adml",
                    include_str!("../../policy/en-US/l8db.adml"),
                ),
            ];
            for (name, contents) in files {
                let path = name
                    .split('/')
                    .fold(directory.clone(), |path, part| path.join(part));
                let written = path
                    .parent()
                    .map_or(Ok(()), std::fs::create_dir_all)
                    .and_then(|()| std::fs::write(&path, contents));
                if let Err(error) = written {
                    eprintln!("Fehler: {} nicht schreibbar: {error}", path.display());
                    return 1;
                }
                println!("{}", path.display());
            }
            0
        }
        Command::Help { command } => super::help_for(&command),
        Command::Version => {
            println!("l8db {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Command::Completions { shell } => super::completions(shell),
        Command::Mcp => {
            if let Err(error) = mcp_scope(&global) {
                eprintln!("Fehler: {error}");
                return 2;
            }
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
        Command::Tui => super::tui::run(&global),
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

pub(super) fn runtime() -> Option<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|error| eprintln!("Fehler: Laufzeit konnte nicht gestartet werden: {error}"))
        .ok()
}

fn block_on(global: &Global, command: Command) -> i32 {
    let Some(runtime) = runtime() else {
        return 1;
    };
    let job = format!("cli-{}", std::process::id());
    let code = runtime.block_on(async {
        let work = execute(global, command, &job);
        tokio::pin!(work);
        tokio::select! {
            result = &mut work => match result {
                Ok(()) => 0,
                Err(error) if error == ABORTED => {
                    eprintln!("{ABORTED}");
                    CANCELLED
                }
                Err(error) => {
                    eprintln!("Fehler: {error}");
                    1
                }
            },
            _ = tokio::signal::ctrl_c() => {
                if matches!(execution::cancel(&job), Ok(true)) {
                    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), &mut work).await;
                }
                eprintln!("\n{ABORTED}");
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

pub(super) async fn saved_connections() -> Result<Vec<AutomationConnection>, String> {
    let services = connect::services()?;
    let mut list = services.store.connections().await?;
    list.sort_by_key(|c| c.name.to_lowercase());
    Ok(list)
}

const NO_CONNECTIONS: &str = "Noch keine Verbindungen gefunden.\n  Öffne l8db einmal, dann übernimmt die CLI deine gespeicherten Verbindungen automatisch.\n  Ohne App: --url postgres://user@host/db";

pub(super) async fn named(
    global: &Global,
    explicit: Option<&str>,
) -> Result<(Vec<AutomationConnection>, Option<Source>), String> {
    let env = |name: &str| std::env::var(name).ok().filter(|v| !v.trim().is_empty());
    if explicit.is_none() && global.connection.is_none() {
        if let Some(url) = global.url.clone().or_else(|| env("L8DB_URL")) {
            return Ok((Vec::new(), Some(connect::ad_hoc(&url)?)));
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
    let source = match wanted {
        Some(wanted) => Some(Source::Saved(Target::saved(store::find(&list, &wanted)?))),
        None => None,
    };
    Ok((list, source))
}

fn mcp_scope(global: &Global) -> Result<(), String> {
    use crate::mcp::config;
    let env_url = std::env::var("L8DB_URL")
        .ok()
        .filter(|v| !v.trim().is_empty());
    if let Some(wanted) = &global.connection {
        config::pin(config::only(config::load(), wanted)?);
    } else if let Some(url) = global.url.clone().or(env_url) {
        let target = connect::ad_hoc(&url)?;
        let Source::Url { url, target } = target else {
            unreachable!()
        };
        config::pin(config::for_url(target.kind, &url, global.database.clone()));
    }
    Ok(())
}

pub(super) fn interactive() -> bool {
    std::io::stdin().is_terminal() && std::io::stderr().is_terminal()
}

async fn resolve(global: &Global, explicit: Option<&str>) -> Result<Source, String> {
    let (list, source) = named(global, explicit).await?;
    if let Some(source) = source {
        return Ok(source);
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
    let open = store::active_connection();
    if let Some(found) = list.iter().find(|c| Some(&c.id) == open.as_ref()) {
        eprintln!("Verbindung: {} (in der App geöffnet)", found.name);
        return Ok(Source::Saved(Target::saved(found)));
    }
    if interactive() {
        return match super::tui::pick(&list, 0)
            .await?
            .and_then(|index| list.get(index))
        {
            Some(found) => Ok(Source::Saved(Target::saved(found))),
            None => Err("Keine Verbindung gewählt.".into()),
        };
    }
    Err(format!(
        "Welche Verbindung? Mit -c <name> angeben oder einmal festlegen: l8db conn use <name>\n  Verfügbar: {}",
        names(&list)
    ))
}

fn names(list: &[AutomationConnection]) -> String {
    list.iter()
        .map(|c| c.name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
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
        max_rows: None,
        no_time_limit: false,
    }
}

pub(super) async fn guarded<T, F>(
    job: &str,
    kind: DatabaseKind,
    timeout: u64,
    future: F,
) -> Result<T, String>
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
            scope_level(session.target.kind.capabilities().databases, "Datenbanken")?;
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
            scope_level(session.target.kind.capabilities().schemas, "Schemas")?;
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
                return inner.replace(&format!("{close}{close}"), &close.to_string());
            }
        }
        part.to_string()
    };
    let mut quote: Option<char> = None;
    let mut dot = None;
    for (index, ch) in name.char_indices() {
        match (quote, ch) {
            (Some(close), _) if ch == close => quote = None,
            (Some(_), _) => {}
            (None, '"') => quote = Some('"'),
            (None, '`') => quote = Some('`'),
            (None, '[') => quote = Some(']'),
            (None, '.') => dot = Some(index),
            _ => {}
        }
    }
    match dot.map(|index| (&name[..index], &name[index + 1..])) {
        Some((schema, table)) if !schema.trim().is_empty() && !table.trim().is_empty() => {
            (Some(unquote(schema)), unquote(table))
        }
        _ => (None, unquote(name)),
    }
}

pub(super) struct Relation {
    pub(super) schema: String,
    pub(super) name: String,
    pub(super) view: bool,
}

pub(super) async fn relations(
    session: &Session,
    schema: Option<&str>,
    job: &str,
) -> Result<Vec<Relation>, String> {
    let kind = session.target.kind;
    let mut found: Vec<Relation> = guarded(job, kind, 60, session.adapter.list_tables(schema))
        .await?
        .into_iter()
        .map(|t| Relation {
            schema: t.schema,
            name: t.name,
            view: false,
        })
        .collect();
    if let Ok(views) = guarded(job, kind, 60, session.adapter.list_views(schema)).await {
        for v in views {
            if !found
                .iter()
                .any(|t| t.schema == v.schema && t.name == v.name)
            {
                found.push(Relation {
                    schema: v.schema,
                    name: v.name,
                    view: true,
                });
            }
        }
    }
    if kind == DatabaseKind::Postgres {
        if let Ok(views) = guarded(
            job,
            kind,
            60,
            session.adapter.list_materialized_views(schema),
        )
        .await
        {
            for v in views {
                if !found
                    .iter()
                    .any(|t| t.schema == v.schema && t.name == v.name)
                {
                    found.push(Relation {
                        schema: v.schema,
                        name: v.name,
                        view: true,
                    });
                }
            }
        }
    }
    Ok(found)
}

fn first_dot(name: &str) -> Option<(String, String)> {
    let name = name.trim();
    if name.contains(['"', '`', '[']) {
        return None;
    }
    name.split_once('.')
        .map(|(schema, table)| (schema.to_string(), table.to_string()))
}

async fn search_path_first<'a>(
    session: &Session,
    found: &[&'a Relation],
    job: &str,
) -> Option<&'a Relation> {
    let result = guarded(
        job,
        DatabaseKind::Postgres,
        60,
        session.adapter.execute_query(
            "SELECT s::text AS s FROM unnest(current_schemas(false)) WITH ORDINALITY AS u(s, i) ORDER BY i",
        ),
    )
    .await
    .ok()?;
    result
        .rows
        .iter()
        .filter_map(|row| row["s"].as_str())
        .find_map(|schema| found.iter().find(|t| t.schema == schema).copied())
}

pub(super) fn unquoted_column(name: String) -> String {
    match name
        .trim()
        .strip_prefix('"')
        .and_then(|n| n.strip_suffix('"'))
    {
        Some(inner) if !inner.is_empty() => inner.replace("\"\"", "\""),
        _ => name,
    }
}

fn pick<'a>(all: &'a [Relation], schema: Option<&str>, table: &str) -> Vec<&'a Relation> {
    let exact: Vec<_> = all
        .iter()
        .filter(|t| t.name == table && schema.is_none_or(|s| t.schema == s))
        .collect();
    if !exact.is_empty() {
        return exact;
    }
    all.iter()
        .filter(|t| {
            t.name.eq_ignore_ascii_case(table)
                && schema.is_none_or(|s| t.schema.eq_ignore_ascii_case(s))
        })
        .collect()
}

fn oracle_case(
    kind: DatabaseKind,
    raw: &str,
    (schema, table): (Option<String>, String),
) -> (Option<String>, String) {
    if kind != DatabaseKind::Oracle {
        return (schema, table);
    }
    let raw = raw.trim();
    let schema = schema.map(|s| {
        if raw.starts_with('"') {
            s
        } else {
            s.to_uppercase()
        }
    });
    let table = if raw.ends_with('"') {
        table
    } else {
        table.to_uppercase()
    };
    (schema, table)
}

async fn synonym_target(
    session: &Session,
    schema: Option<&str>,
    table: &str,
    job: &str,
) -> Option<Relation> {
    let synonyms = guarded(
        job,
        session.target.kind,
        60,
        session.adapter.list_synonyms(schema),
    )
    .await
    .ok()?;
    let found = synonyms
        .iter()
        .filter(|s| s.db_link.is_none())
        .find(|s| s.name == table)
        .or_else(|| {
            synonyms
                .iter()
                .find(|s| s.db_link.is_none() && s.name.eq_ignore_ascii_case(table))
        })?;
    Some(Relation {
        schema: found.target_owner.clone(),
        name: found.target_name.clone(),
        view: found.target_type.contains("view"),
    })
}

async fn locate(session: &Session, name: &str, job: &str) -> Result<Relation, String> {
    let (schema, table) = oracle_case(session.target.kind, name, split_table(name));
    let mut all = relations(session, schema.as_deref(), job).await?;
    let mut candidates = pick(&all, schema.as_deref(), &table).len();
    if candidates == 0 && schema.is_some() {
        all = relations(session, None, job).await?;
        candidates = pick(&all, schema.as_deref(), &table).len();
    }
    let (schema, table) = if candidates == 0 && schema.is_some() {
        match first_dot(name).filter(|(s, t)| !pick(&all, Some(s), t).is_empty()) {
            Some((schema, table)) => (Some(schema), table),
            None => (None, name.trim().to_string()),
        }
    } else {
        (schema, table)
    };
    let mut found = pick(&all, schema.as_deref(), &table);
    if schema.is_none()
        && session.target.kind == DatabaseKind::Postgres
        && found.iter().any(|t| t.schema != found[0].schema)
    {
        if let Some(first) = search_path_first(session, &found, job).await {
            found = vec![first];
        }
    }
    if found.is_empty() && session.target.kind == DatabaseKind::Oracle {
        if let Some(target) = synonym_target(session, schema.as_deref(), &table, job).await {
            return Ok(target);
        }
    }
    match found.len() {
        1 => {
            let one = found.remove(0);
            Ok(Relation {
                schema: one.schema.clone(),
                name: one.name.clone(),
                view: one.view,
            })
        }
        0 => Err(format!(
            "Tabelle „{name}“ nicht gefunden.\n  Alle Tabellen: l8db table list"
        )),
        _ if found.iter().all(|t| t.schema == found[0].schema) => Err(format!(
            "„{name}“ ist nicht eindeutig: {} (Schema {}). Bitte die genaue Schreibweise in Anführungszeichen angeben, z. B. '\"{}\"'.",
            found.iter().map(|t| t.name.as_str()).collect::<Vec<_>>().join(", "),
            found[0].schema,
            found[0].name.replace('"', "\"\""),
        )),
        _ => Err(format!(
            "„{name}“ gibt es in mehreren Schemas: {}. Bitte als schema.tabelle angeben.",
            found
                .iter()
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
        db::validate_table_filter_in(&filter, kind != DatabaseKind::Postgres).map_err(|e| {
            format!(
                "--where darf nur eine Bedingung enthalten. {}\n  Für eigenes SQL: l8db q \"select … where …\"",
                e.replace(" Nutze den SQL-Modus für eigene Ausdrücke.", "")
            )
        })?;
        if writes(kind, &filter) {
            allow_write(&session.target, &Approval::Flag(false)).await?;
        }
    }
    match command {
        TableCommand::List { schema } => {
            let tables = relations(session, schema.as_deref(), job).await?;
            let mut rows: Vec<Value> = tables
                .iter()
                .map(|t| json!([t.schema, t.name, if t.view { "view" } else { "table" }]))
                .collect();
            if kind == DatabaseKind::Oracle {
                if let Ok(synonyms) =
                    guarded(job, kind, 60, adapter.list_synonyms(schema.as_deref())).await
                {
                    rows.extend(synonyms.iter().map(|s| {
                        let link = s
                            .db_link
                            .as_deref()
                            .map(|l| format!("@{l}"))
                            .unwrap_or_default();
                        json!([
                            s.owner,
                            s.name,
                            format!("synonym → {}.{}{link}", s.target_owner, s.target_name)
                        ])
                    }));
                }
            }
            if rows.is_empty() {
                eprintln!("Keine Tabellen gefunden, auf die diese Verbindung zugreifen darf.");
            }
            write(output::write_rows(
                out,
                format,
                &["schema".into(), "table".into(), "type".into()],
                &rows,
            ))
        }
        TableCommand::Describe { table } => {
            let Relation { schema, name, .. } = locate(session, &table, job).await?;
            if kind == DatabaseKind::Postgres {
                let rows: Vec<Value> = guarded(
                    job,
                    kind,
                    60,
                    adapter.list_table_columns_detailed(&schema, &name),
                )
                .await?
                .iter()
                .map(|c| {
                    let data_type = match c.character_maximum_length {
                        Some(length) => format!("{}({length})", c.data_type),
                        None => c.data_type.clone(),
                    };
                    json!([
                        c.name,
                        data_type,
                        c.is_nullable,
                        c.column_default,
                        c.is_primary_key
                    ])
                })
                .collect();
                return write(output::write_rows(
                    out,
                    format,
                    &[
                        "column".into(),
                        "type".into(),
                        "nullable".into(),
                        "default".into(),
                        "primary_key".into(),
                    ],
                    &rows,
                ));
            }
            let rows: Vec<Value> = if kind == DatabaseKind::Oracle {
                guarded(
                    job,
                    kind,
                    60,
                    adapter.list_table_columns_detailed(&schema, &name),
                )
                .await?
                .iter()
                .map(|c| match c.ordinal_position {
                    0 => json!([c.name, format!("{} unsichtbar", c.data_type)]),
                    _ => json!([c.name, c.data_type]),
                })
                .collect()
            } else {
                guarded(
                    job,
                    kind,
                    60,
                    adapter.list_columns(Some(&schema), Some(&name), None),
                )
                .await?
                .iter()
                .map(|c| json!([c.name, c.data_type]))
                .collect()
            };
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
            let order_by = order_by.map(unquoted_column);
            let Relation { schema, name, view } = locate(session, &table, job).await?;
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
                    view,
                    false,
                ),
            )
            .await?;
            if let Some(column) = order_by.filter(|c| {
                !data
                    .columns
                    .iter()
                    .any(|d| d == c || (kind == DatabaseKind::Oracle && d.eq_ignore_ascii_case(c)))
            }) {
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
            let Relation { schema, name, .. } = locate(session, &table, job).await?;
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

#[cfg(test)]
pub(super) fn statements(kind: DatabaseKind, sql: &str) -> Result<Vec<String>, String> {
    split_statements(kind, sql, &mut |note| eprintln!("{note}"))
}

fn split_statements(
    kind: DatabaseKind,
    sql: &str,
    note: &mut dyn FnMut(String),
) -> Result<Vec<String>, String> {
    let parts: Vec<String> = match kind {
        DatabaseKind::Oracle => {
            let mut parts = Vec::new();
            for (sqlplus, text) in db::oracle::script_items(sql) {
                if !sqlplus {
                    parts.push(text);
                } else if db::sql_script::is_connect_command(&text) {
                    return Err(db::sql_script::CONNECT_UNSUPPORTED.into());
                } else if text.split_whitespace().next().is_some_and(|word| {
                    db::sql_script::abbreviates(
                        &word.trim_end_matches(';').to_ascii_uppercase(),
                        &[("EXIT", 4), ("QUIT", 4)],
                    )
                }) {
                    break;
                } else if !text
                    .trim()
                    .to_ascii_uppercase()
                    .starts_with("SET SERVEROUT")
                {
                    note(format!(
                        "Hinweis: SQL*Plus-Befehl übersprungen: {}",
                        text.trim()
                    ));
                }
            }
            parts
        }
        kind if is_sql(kind) => db::sql_script::split_for(kind, sql),
        _ => vec![sql.to_string()],
    };
    Ok(parts.into_iter().filter(|s| !s.trim().is_empty()).collect())
}

fn scope_level(present: bool, label: &str) -> Result<(), String> {
    if present {
        Ok(())
    } else {
        Err(format!(
            "Dieser Datenbanktyp kennt keine {label}.\n  Objekte: l8db table list"
        ))
    }
}

pub(super) fn writes(kind: DatabaseKind, statement: &str) -> bool {
    match kind {
        DatabaseKind::Redis => nosql::redis_check(statement, false).is_err(),
        DatabaseKind::Mongodb => nosql::mongo_command(statement)
            .map(|doc| nosql::mongo_writes(&doc))
            .unwrap_or(true),
        DatabaseKind::Elasticsearch => {
            db::elasticsearch::read_only_request(statement) != Some(true)
        }
        DatabaseKind::Influxdb => db::influxdb::read_only_statement(statement) != Some(true),
        DatabaseKind::S3 => false,
        _ => redact::write_word(statement).is_some() || redact::is_ddl(statement),
    }
}

pub(super) enum Approval {
    Flag(bool),
    Typed(Option<String>),
}

fn confirmed(name: &str, answer: &str) -> Result<(), String> {
    if answer.trim() == name {
        Ok(())
    } else {
        Err("Nicht bestätigt, nichts ausgeführt.".into())
    }
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
    confirmed(name, &answer)
}

pub(super) struct Prepared {
    parts: Vec<String>,
    writing: bool,
    approval: Approval,
}

pub(super) async fn prepare(
    target: &Target,
    sql: &str,
    approval: Approval,
    note: &mut (dyn FnMut(String) + Send),
) -> Result<Prepared, String> {
    let parts = split_statements(target.kind, sql, note)?;
    if parts.is_empty() {
        return Err("Das SQL enthält keine Anweisung.".into());
    }
    let writing = parts.iter().any(|statement| writes(target.kind, statement));
    if writing {
        allow_write(target, &approval).await?;
    }
    Ok(Prepared {
        parts,
        writing,
        approval,
    })
}

pub(super) struct RunOptions {
    pub(super) limit: Limit,
    pub(super) timeout: u64,
    pub(super) no_transaction: bool,
    pub(super) typed: bool,
}

pub(super) enum Step {
    Result {
        result: QueryResult,
        started: Instant,
        script: bool,
    },
    Note(String),
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
    let prepared = prepare(
        source.target(),
        &sql,
        Approval::Flag(args.yes),
        &mut |note| eprintln!("{note}"),
    )
    .await?;
    let session = connect::open(source, global.database.as_deref()).await?;
    let options = RunOptions {
        limit: args.limit,
        timeout: args.timeout,
        no_transaction: args.no_transaction,
        typed: matches!(format, Format::Json | Format::Ndjson),
    };
    run_prepared(
        &session,
        global.database.as_deref(),
        &prepared,
        &options,
        job,
        &mut |step| match step {
            Step::Result {
                result,
                started,
                script,
            } => print_result(out, format, &result, args.limit, started, script),
            Step::Note(note) => {
                eprintln!("{note}");
                Ok(())
            }
        },
    )
    .await
}

pub(super) async fn run_prepared(
    session: &Session,
    database: Option<&str>,
    prepared: &Prepared,
    options: &RunOptions,
    job: &str,
    emit: &mut impl FnMut(Step) -> Result<(), String>,
) -> Result<(), String> {
    if session.target.kind == DatabaseKind::Postgres && db::server_output::sink().is_none() {
        return db::server_output::capture(
            db::server_output::Messages::default(),
            Box::pin(run_prepared(
                session, database, prepared, options, job, emit,
            )),
        )
        .await;
    }
    let Prepared {
        parts,
        writing,
        approval,
    } = prepared;
    let (writing, limit, timeout) = (*writing, options.limit, options.timeout);
    let kind = session.target.kind;
    let mut transaction: Option<Box<dyn TxSession>> = None;
    if parts.len() > 1 && writing && !options.no_transaction {
        match db::import::open_session(kind, &session.url, database, session.services.pool.clone())
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
        match postgres_cursor(session, statement, rows, database, job, timeout).await? {
            Cursor::Done(mut result) => {
                if options.typed {
                    typed_postgres(session, statement, &mut result).await;
                }
                notices(emit)?;
                return emit(Step::Result {
                    result,
                    started,
                    script: false,
                });
            }
            Cursor::Writes => allow_write(&session.target, approval).await?,
            Cursor::Skip => {}
        }
    }
    let total = parts.len();
    let output = kind == DatabaseKind::Oracle && parts.iter().any(|p| plsql_call(p));
    if output && transaction.is_none() {
        let _ = session.adapter.set_server_output(true).await;
    }
    for (index, statement) in parts.iter().enumerate() {
        let started = Instant::now();
        let result = match transaction.as_mut() {
            Some(tx) => guarded(job, kind, timeout, limited(limit, tx.execute(statement))).await,
            None => {
                guarded(
                    job,
                    kind,
                    timeout,
                    limited(limit, session.adapter.execute_query(statement)),
                )
                .await
            }
        };
        let mut result = match result {
            Ok(result) => result,
            Err(error) => {
                let _ = notices(emit);
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
        if kind == DatabaseKind::Postgres && options.typed {
            typed_postgres(session, statement, &mut result).await;
        }
        notices(emit)?;
        if output {
            let lines = match transaction.as_mut() {
                Some(tx) => tx.server_output().await.unwrap_or_default(),
                None => session
                    .adapter
                    .take_server_output()
                    .await
                    .map(|m| m.into_iter().map(|m| m.message).collect())
                    .unwrap_or_default(),
            };
            for line in lines {
                emit(Step::Note(line))?;
            }
        }
        emit(Step::Result {
            result,
            started,
            script: total > 1,
        })?;
    }
    if let Some(mut tx) = transaction {
        if open_at_end(kind, parts) {
            let _ = tx.rollback().await;
            return Err(format!(
                "Das Skript endet mit BEGIN ohne COMMIT.{}",
                rollback_note(kind, parts)
            ));
        }
        tx.commit().await?;
        emit(Step::Note(format!(
            "✓ {total} Anweisungen in einer Transaktion übernommen."
        )))?;
    }
    Ok(())
}

fn notices(emit: &mut impl FnMut(Step) -> Result<(), String>) -> Result<(), String> {
    let messages = db::server_output::sink()
        .map(|sink| sink.take())
        .unwrap_or_default();
    for message in messages {
        emit(Step::Note(format!(
            "{}: {}",
            message.level, message.message
        )))?;
    }
    Ok(())
}

fn plsql_call(statement: &str) -> bool {
    let word = statement
        .split(|c: char| c.is_whitespace() || c == '(')
        .find(|w| !w.is_empty())
        .unwrap_or("")
        .to_ascii_uppercase();
    matches!(word.as_str(), "BEGIN" | "DECLARE" | "CALL")
}

async fn typed_postgres(session: &Session, statement: &str, result: &mut QueryResult) {
    if result.rows.is_empty() {
        return;
    }
    let Ok(columns) = session.adapter.describe_query_columns(statement).await else {
        return;
    };
    if columns.len() != result.columns.len() {
        return;
    }
    for row in &mut result.rows {
        if let Value::Object(map) = row {
            for (name, column) in result.columns.iter().zip(&columns) {
                if let Some(value) = map.get_mut(name) {
                    *value = postgres_json(&column.data_type, std::mem::take(value));
                }
            }
        }
    }
}

pub(super) fn postgres_json(data_type: &str, value: Value) -> Value {
    let Value::String(text) = value else {
        return value;
    };
    match data_type {
        "int2" | "int4" | "int8" | "oid" => text
            .parse::<i64>()
            .map(db::exact_number::int)
            .unwrap_or(Value::String(text)),
        "numeric" => db::exact_number::json_number(&text),
        "json" | "jsonb" => db::exact_number::json_text(&text),
        "float4" | "float8" => text
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::String(text)),
        "bool" => match text.as_str() {
            "t" => Value::Bool(true),
            "f" => Value::Bool(false),
            _ => Value::String(text),
        },
        _ => Value::String(text),
    }
}

async fn allow_write(target: &Target, approval: &Approval) -> Result<(), String> {
    if target.read_only {
        return Err(format!(
            "„{}“ ist schreibgeschützt, das SQL würde schreiben.\n  Schreibschutz oder Produktionssperre lassen sich nur in der App ändern.",
            target.name
        ));
    }
    if !target.production {
        return Ok(());
    }
    match approval {
        Approval::Flag(true) => Ok(()),
        Approval::Flag(false) => {
            let name = target.name.clone();
            blocking(move || ask_production(&name)).await
        }
        Approval::Typed(None) => Err(CONFIRM_REQUIRED.into()),
        Approval::Typed(Some(answer)) => confirmed(&target.name, answer),
    }
}

#[derive(PartialEq)]
enum Control {
    Open,
    Commit,
    Close,
}

fn control(kind: DatabaseKind, statement: &str) -> Option<Control> {
    let words = redact::sql_words(statement);
    let first = words.first().map(String::as_str).unwrap_or("");
    let second = words.get(1).map(String::as_str).unwrap_or("");
    match (kind, first) {
        (DatabaseKind::Oracle, "begin" | "declare" | "start" | "end") => None,
        (DatabaseKind::Mssql, "begin")
            if !matches!(second, "tran" | "transaction" | "distributed") =>
        {
            None
        }
        (DatabaseKind::Mssql | DatabaseKind::Mysql, "end") => None,
        (_, "begin" | "start") => Some(Control::Open),
        (_, "commit" | "end") => Some(Control::Commit),
        (_, "rollback") if second == "to" => None,
        (_, "rollback" | "abort") => Some(Control::Close),
        _ => None,
    }
}

pub(super) fn open_at_end(kind: DatabaseKind, ran: &[String]) -> bool {
    ran.iter()
        .filter_map(|statement| control(kind, statement))
        .last()
        == Some(Control::Open)
}

pub(super) fn rollback_note(kind: DatabaseKind, ran: &[String]) -> &'static str {
    let controls =
        ran.iter()
            .enumerate()
            .any(|(index, statement)| match control(kind, statement) {
                Some(Control::Commit) => true,
                Some(Control::Open) => kind == DatabaseKind::Mysql && index > 0,
                _ => false,
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
    database: Option<&str>,
    job: &str,
    timeout: u64,
) -> Result<Cursor, String> {
    if !cursor_safe(statement) {
        return Ok(Cursor::Skip);
    }
    let Ok(mut tx) = db::import::open_session(
        DatabaseKind::Postgres,
        &session.url,
        database,
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
        tx.execute(&format!("{CURSOR_PREFIX}{body}")),
    )
    .await;
    if let Err(error) = declared {
        let _ = tx.rollback().await;
        let leading = statement.chars().take_while(|c| c.is_whitespace()).count();
        return read_only_violation(shift_position(
            error,
            CURSOR_PREFIX.chars().count(),
            leading,
        ));
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

const CURSOR_PREFIX: &str = "DECLARE l8db_cli NO SCROLL CURSOR FOR ";

pub(super) fn shift_position(error: String, prefix: usize, leading: usize) -> String {
    const LABEL: &str = "\nPosition: ";
    let Some(start) = error.rfind(LABEL).map(|at| at + LABEL.len()) else {
        return error;
    };
    let end = error[start..]
        .find('\n')
        .map_or(error.len(), |offset| start + offset);
    match error[start..end].parse::<usize>() {
        Ok(position) if position > prefix => format!(
            "{}{}{}",
            &error[..start],
            position - prefix + leading,
            &error[end..]
        ),
        _ => error,
    }
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

pub(super) fn changed(result: &QueryResult) -> String {
    match result.rows_affected {
        Some(1) => "1 Zeile geändert".to_string(),
        Some(rows) => format!("{rows} Zeilen geändert"),
        None => "OK".to_string(),
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
        eprintln!("✓ {} ({elapsed} ms)", changed(result));
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
    let found = match name {
        Some(name) => store::find(&list, name)?,
        None if interactive() => {
            let current = list
                .iter()
                .position(|c| Some(&c.id) == settings.default_connection.as_ref())
                .unwrap_or(0);
            super::tui::pick(&list, current)
                .await?
                .and_then(|index| list.get(index))
                .ok_or("Keine Verbindung gewählt.")?
        }
        None => {
            return Err(format!(
                "Welche Verbindung? l8db conn use <name>\n  Verfügbar: {}",
                names(&list)
            ))
        }
    };
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

pub(super) fn kind_name(kind: DatabaseKind) -> String {
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
