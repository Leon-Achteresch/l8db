use super::run::{address, split_table, statements, writes};
use super::*;
use crate::db::DatabaseKind;

fn args(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut started = false;
    for c in line.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => current.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                started = true;
            }
            (None, c) if c.is_whitespace() => {
                if started || !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            (None, c) => current.push(c),
        }
    }
    if started || !current.is_empty() {
        out.push(current);
    }
    out
}

fn parse(line: &str) -> Result<Cli, clap::Error> {
    let argv = args(line);
    let matches = command().try_get_matches_from(argv)?;
    <Cli as clap::FromArgMatches>::from_arg_matches(&matches)
}

fn help_texts() -> Vec<String> {
    let mut texts = vec![ROOT_HELP.to_string()];
    let mut root = command();
    root.build();
    fn collect(command: &clap::Command, texts: &mut Vec<String>) {
        if let Some(after) = command.get_after_help() {
            texts.push(after.to_string());
        }
        for sub in command.get_subcommands() {
            collect(sub, texts);
        }
    }
    collect(&root, &mut texts);
    texts
}

#[test]
fn command_definition_is_consistent() {
    let mut root = command();
    root.build();
    root.debug_assert();
}

#[test]
fn every_documented_example_parses() {
    let mut checked = 0;
    for text in help_texts() {
        for line in text.lines() {
            let line = line.trim();
            let Some(rest) = line
                .strip_prefix("l8db ")
                .or_else(|| line.split_once("| l8db ").map(|(_, r)| r))
            else {
                continue;
            };
            let command = rest.split([' '].as_ref()).next().unwrap_or_default();
            if command.starts_with('<') || command.is_empty() {
                continue;
            }
            let cut = rest
                .split(" | ")
                .next()
                .unwrap_or_default()
                .split(" > ")
                .next()
                .unwrap_or_default()
                .split(" >> ")
                .next()
                .unwrap_or_default();
            let cut = cut.split("  ").next().unwrap_or_default();
            let full = format!("l8db {cut}");
            if full.contains(['<', '{']) || full.contains("[befehl]") || full.contains("[name]") {
                continue;
            }
            parse(&full).unwrap_or_else(|e| panic!("Beispiel „{full}“ parst nicht: {e}"));
            checked += 1;
        }
    }
    assert!(checked >= 15, "nur {checked} Beispiele geprüft");
}

#[test]
fn cheatsheet_examples_in_the_app_parse() {
    for line in [
        "l8db conn list",
        "l8db conn use prod",
        "l8db conn test",
        "l8db open prod",
        "l8db q \"select * from users limit 5\"",
        "l8db query -f skript.sql",
        "l8db table list",
        "l8db table describe users",
        "l8db table rows users --where \"id > 10\" -n 20",
        "l8db table count users",
        "l8db q -o csv -f bericht.sql",
        "l8db completions zsh",
        "l8db completions bash",
        "l8db completions fish",
        "l8db completions powershell",
    ] {
        parse(line).unwrap_or_else(|e| panic!("„{line}“ parst nicht: {e}"));
    }
}

#[test]
fn global_options_work_before_and_after_the_command() {
    let before = parse("l8db -c prod -o json table list").unwrap();
    let after = parse("l8db table list -c prod -o json").unwrap();
    assert_eq!(before.global.connection.as_deref(), Some("prod"));
    assert_eq!(after.global.connection.as_deref(), Some("prod"));
    assert_eq!(after.global.output, Some(output::Format::Json));
    assert!(parse("l8db q -c a --url postgres://x/y \"select 1\"").is_err());
}

#[test]
fn routes_cli_words_and_keeps_app_arguments() {
    let wants = |line: &str| super::wants(&args(line));
    for cli in [
        "query select",
        "q x",
        "conn",
        "table rows t",
        "help",
        "--help",
        "-h",
        "-V",
        "-c prod q x",
        "--connection=prod q x",
        "--url postgres://x/y q x",
        "quer",
        "tabel list",
    ] {
        assert!(wants(cli), "{cli} sollte die CLI starten");
    }
    for app in [
        "",
        "--new-window",
        "--menu=dock.new-window",
        "--file /tmp/a.sql",
        "/tmp/data.sqlite",
        "notes.sql",
        "./query",
        "-psn_0_12345",
    ] {
        assert!(!wants(app), "{app} sollte die App starten");
    }
}

#[test]
fn errors_are_german_with_suggestions() {
    let error = german(&parse("l8db quer").unwrap_err());
    assert!(
        error.starts_with("Fehler: Unbekannter Befehl „quer“."),
        "{error}"
    );
    assert!(error.contains("Meintest du „query“?"), "{error}");
    let error = german(&parse("l8db table rows").unwrap_err());
    assert!(error.contains("Es fehlt: <TABELLE>"), "{error}");
    assert!(
        error.contains("Aufruf: l8db table rows <TABELLE>"),
        "{error}"
    );
    let error = german(&parse("l8db q --limt 3 x").unwrap_err());
    assert!(error.contains("Unbekannte Option „--limt“"), "{error}");
    assert!(error.contains("Meintest du „--limit“?"), "{error}");
    let error = german(&parse("l8db q -o xml x").unwrap_err());
    assert!(
        error.contains("Möglich: table, json, ndjson, csv, tsv"),
        "{error}"
    );
    for error in [
        german(&parse("l8db quer").unwrap_err()),
        german(&parse("l8db q -n abc x").unwrap_err()),
        german(&parse("l8db q --all -n 3 x").unwrap_err()),
    ] {
        assert!(!error.contains("error:"), "{error}");
        assert!(!error.contains("Usage"), "{error}");
        assert!(error.contains("Hilfe: l8db --help"), "{error}");
    }
}

#[test]
fn help_is_german_everywhere() {
    let mut root = command();
    root.build();
    fn walk(command: &mut clap::Command, path: &str) {
        let help = command.render_help().to_string();
        for english in [
            "Usage:",
            "Options:",
            "Arguments:",
            "Commands:",
            "[default:",
            "[possible values",
            "Print help",
        ] {
            assert!(!help.contains(english), "{path}: „{english}“ in\n{help}");
        }
        assert!(help.contains("Aufruf:") || path == "l8db", "{path}");
        let names: Vec<String> = command
            .get_subcommands()
            .map(|s| s.get_name().to_string())
            .collect();
        for name in names {
            let mut sub = command.find_subcommand_mut(&name).unwrap().clone();
            walk(&mut sub, &format!("{path} {name}"));
        }
    }
    walk(&mut root, "l8db");
}

#[test]
fn completions_cover_commands_and_formats() {
    let mut out = Vec::new();
    clap_complete::generate(clap_complete::Shell::Zsh, &mut command(), "l8db", &mut out);
    let script = String::from_utf8(out).unwrap();
    for word in [
        "query",
        "conn",
        "describe",
        "ndjson",
        "--connection",
        "--where",
    ] {
        assert!(
            script.contains(word),
            "{word} fehlt in der Vervollständigung"
        );
    }
}

#[test]
fn scripts_are_split_per_family() {
    let sql = "create table t(a int);\ninsert into t values (1); -- a;b\nselect ';' as x;";
    assert_eq!(statements(DatabaseKind::Postgres, sql).len(), 3);
    assert_eq!(statements(DatabaseKind::Mysql, sql).len(), 3);
    let body = "create function f() returns int as $$ begin return 1; end $$ language plpgsql;\nselect f();";
    assert_eq!(statements(DatabaseKind::Postgres, body).len(), 2);
    assert_eq!(statements(DatabaseKind::Redis, "SET a 1").len(), 1);
    assert!(statements(DatabaseKind::Postgres, " ;\n ; ").is_empty());
}

#[test]
fn write_detection_is_conservative() {
    for (kind, sql) in [
        (DatabaseKind::Postgres, "update users set a = 1"),
        (DatabaseKind::Postgres, "drop table users"),
        (
            DatabaseKind::Postgres,
            "with x as (delete from t returning *) select * from x",
        ),
        (DatabaseKind::Mysql, "truncate t"),
        (DatabaseKind::Redis, "SET a 1"),
        (DatabaseKind::Mongodb, "db.users.deleteMany({})"),
        (DatabaseKind::Mongodb, "nicht parsebar"),
    ] {
        assert!(writes(kind, sql), "{sql} schreibt");
    }
    for (kind, sql) in [
        (
            DatabaseKind::Postgres,
            "select * from users where updated > now()",
        ),
        (DatabaseKind::Postgres, "explain select 1"),
        (DatabaseKind::Redis, "GET a"),
        (DatabaseKind::Mongodb, "db.users.find({})"),
    ] {
        assert!(!writes(kind, sql), "{sql} liest nur");
    }
}

#[test]
fn table_names_accept_schema_and_quotes() {
    assert_eq!(split_table("users"), (None, "users".into()));
    assert_eq!(
        split_table("public.users"),
        (Some("public".into()), "users".into())
    );
    assert_eq!(
        split_table("\"My Schema\".\"Order\""),
        (Some("My Schema".into()), "Order".into())
    );
    assert_eq!(split_table("[dbo].[x]"), (Some("dbo".into()), "x".into()));
}

#[test]
fn addresses_never_show_passwords() {
    assert_eq!(
        address("postgres://alice:geheim@db:5432/app?sslmode=require"),
        "alice@db:5432/app"
    );
    assert_eq!(address("sqlite:///Users/x/a.db"), "sqlite:///Users/x/a.db");
    let kv = address("Server=db;Database=app;User Id=sa;Password=geheim;");
    assert!(!kv.contains("geheim"), "{kv}");
    assert!(kv.contains("Server=db"), "{kv}");
}

#[test]
fn task_subcommands_map_to_the_automation_cli() {
    let cli = parse("l8db task run Bericht --var a=1 --var b=2 --env prod -q").unwrap();
    let Command::Task { command } = cli.command else {
        panic!("kein task");
    };
    assert_eq!(
        super::run::task_args(command, &cli.global),
        [
            "--run-task",
            "Bericht",
            "--var",
            "a=1",
            "--var",
            "b=2",
            "--env",
            "prod",
            "--quiet"
        ]
    );
    let cli = parse("l8db task list -o json").unwrap();
    let Command::Task { command } = cli.command else {
        panic!("kein task");
    };
    assert_eq!(
        super::run::task_args(command, &cli.global),
        ["--list-tasks", "--json"]
    );
}
