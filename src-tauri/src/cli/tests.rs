use super::run::{
    address, allow_write, catalog_timeout, changed, read_only, read_timeout, rollback_note,
    split_table, statement_lines, statements, writes, Approval,
};
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
        "l8db tui",
        "l8db conn test",
        "l8db open prod",
        "l8db q \"select * from users limit 5\"",
        "l8db query -f skript.sql",
        "l8db table list",
        "l8db table describe users",
        "l8db table rows users --where \"id > 10\" -n 20",
        "l8db table count users",
        "l8db q -o csv -f bericht.sql",
        "l8db q -o markdown -f bericht.sql",
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
    for invalid in [
        "l8db table rows t -n 0",
        "l8db table rows t --limit -5",
        "l8db table rows t --offset -1",
        "l8db q -n 0 x",
        "l8db q --timeout 1 x",
    ] {
        assert!(parse(invalid).is_err(), "{invalid}");
    }
    let timeout = german(&parse("l8db q --timeout 1 x").unwrap_err());
    assert!(timeout.contains("mindestens 5 Sekunden"), "{timeout}");
    let limit = german(&parse("l8db table rows t --limit -5").unwrap_err());
    assert!(limit.contains("ab 1"), "{limit}");
    assert!(parse("l8db q --timeout 0 x").is_ok());
    assert!(parse("l8db q --timeout 5 x").is_ok());
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
        "-v",
        "version",
        "-c prod q x",
        "--connection=prod q x",
        "--url postgres://x/y q x",
        "--read-only table list",
        "quer",
        "tabel list",
        "-cprod conn list",
        "-ojson db list",
        "-dapp q x",
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
        "l8db://tab/aWyJ0Il0",
        "L8DB://tab/aWyJ0Il0/",
        "l8db:tab",
    ] {
        assert!(!wants(app), "{app} sollte die App starten");
    }
}

#[test]
fn every_spelling_of_version_prints_it_and_ends() {
    for flag in ["l8db --version", "l8db -V", "l8db -v"] {
        let kind = parse(flag).unwrap_err().kind();
        assert_eq!(kind, clap::error::ErrorKind::DisplayVersion, "{flag}");
    }
    assert!(matches!(
        parse("l8db version").unwrap().command,
        Command::Version
    ));
}

#[test]
fn shared_tab_links_named_like_cli_commands_stay_app_arguments() {
    let wants = |line: &str| super::wants(&args(line));
    for app in [
        "l8db://tab/abc",
        "l8db://tab/query",
        "l8db://tab/conn",
        "l8db://tab/table",
        "l8db://tab/help",
        "L8DB://TAB/query/",
        "l8db://tab/query?x=1",
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
        error.contains("Möglich: table, json, ndjson, csv, tsv, markdown"),
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
        "markdown",
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
    assert_eq!(statements(DatabaseKind::Postgres, sql).unwrap().len(), 3);
    assert_eq!(statements(DatabaseKind::Mysql, sql).unwrap().len(), 3);
    let body = "create function f() returns int as $$ begin return 1; end $$ language plpgsql;\nselect f();";
    assert_eq!(statements(DatabaseKind::Postgres, body).unwrap().len(), 2);
    assert_eq!(statements(DatabaseKind::Redis, "SET a 1").unwrap().len(), 1);
    assert_eq!(
        statements(DatabaseKind::Elasticsearch, "GET a/_search\nGET b/_search").unwrap(),
        ["GET a/_search", "GET b/_search"]
    );
    assert!(statements(DatabaseKind::Postgres, " ;\n ; ")
        .unwrap()
        .is_empty());
    let batch = "CREATE PROCEDURE dbo.p AS\nBEGIN\n  SELECT 1;\nEND\nGO\nSELECT 2";
    assert_eq!(statements(DatabaseKind::Mssql, batch).unwrap().len(), 2);
    assert!(statements(DatabaseKind::Oracle, "CONN hr/hr\nDROP TABLE t;").is_err());
    assert!(statements(DatabaseKind::Oracle, "disco\nDROP TABLE t;").is_err());
    assert_eq!(
        statements(
            DatabaseKind::Oracle,
            "SELECT 1 FROM dual;\nEXIT;\nDROP TABLE t;"
        )
        .unwrap(),
        vec!["SELECT 1 FROM dual;"]
    );
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
        (
            DatabaseKind::Mongodb,
            r#"db.src.aggregate([{$match:{}},{$out:"copy"}])"#,
        ),
        (
            DatabaseKind::Mongodb,
            r#"db.src.aggregate([{$merge:{into:"copy"}}])"#,
        ),
        (
            DatabaseKind::Mongodb,
            r#"{"aggregate":"src","pipeline":[{"$out":"copy"}],"cursor":{}}"#,
        ),
        (
            DatabaseKind::Mongodb,
            r#"{"mapReduce":"src","map":"function(){}","reduce":"function(){}","out":"copy"}"#,
        ),
        (DatabaseKind::S3, "DELETE FROM demo"),
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
        (
            DatabaseKind::Mongodb,
            r#"db.src.aggregate([{$match:{status:"$out"}},{$count:"n"}])"#,
        ),
        (DatabaseKind::S3, "SELECT * FROM s3://demo/a.csv"),
        (DatabaseKind::S3, "SELECT * FROM 'data/a.csv'"),
        (DatabaseKind::S3, "LIST s3://demo/"),
        (DatabaseKind::S3, "SHOW BUCKETS"),
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
    assert_eq!(
        split_table("\"Weird.Schema\".\"a.b\""),
        (Some("Weird.Schema".into()), "a.b".into())
    );
    assert_eq!(split_table("\"a.b\""), (None, "a.b".into()));
    assert_eq!(
        split_table("\"Mixed\"\"Case.Tbl\""),
        (None, "Mixed\"Case.Tbl".into())
    );
    assert_eq!(split_table("`a.b`"), (None, "a.b".into()));
    assert_eq!(split_table("[a.b].[c]"), (Some("a.b".into()), "c".into()));
}

#[test]
fn postgres_text_values_become_json_types() {
    use super::run::postgres_json;
    use serde_json::json;
    assert_eq!(postgres_json("int4", json!("1")), json!(1));
    assert_eq!(
        postgres_json("int8", json!("9007199254740993")),
        json!("9007199254740993")
    );
    assert_eq!(postgres_json("numeric", json!("1.5000")), json!("1.5000"));
    assert_eq!(postgres_json("numeric", json!("2.5")), json!(2.5));
    assert_eq!(
        postgres_json("jsonb", json!(r#"{"a":[1]}"#)),
        json!({"a": [1]})
    );
    assert_eq!(
        postgres_json("json", json!(r#"{"big":9007199254740993}"#)),
        json!(r#"{"big":9007199254740993}"#)
    );
    assert_eq!(postgres_json("float8", json!("1.1")), json!(1.1));
    assert_eq!(postgres_json("float8", json!("NaN")), json!("NaN"));
    assert_eq!(postgres_json("bool", json!("t")), json!(true));
    assert_eq!(postgres_json("text", json!("1")), json!("1"));
    assert_eq!(postgres_json("int4", json!(null)), json!(null));
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
    for (line, expected) in [
        (
            "l8db --read-only task run Bericht",
            vec!["--run-task", "Bericht", "--read-only"],
        ),
        (
            "l8db task tick --read-only",
            vec!["--automation-tick", "--read-only"],
        ),
        ("l8db --read-only task list", vec!["--list-tasks"]),
    ] {
        let cli = parse(line).unwrap();
        let Command::Task { command } = cli.command else {
            panic!("kein task");
        };
        assert_eq!(
            super::run::task_args(command, &cli.global),
            expected,
            "{line}"
        );
    }
}

#[test]
fn rollback_message_only_promises_what_the_database_keeps() {
    let ran = |sql: &[&str]| sql.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let clean = ran(&["insert into t values (1)", "update t set a = 2"]);
    assert!(rollback_note(DatabaseKind::Postgres, &clean, true).contains("Nichts geändert"));
    assert!(rollback_note(DatabaseKind::Mysql, &clean, true).contains("Nichts geändert"));
    let ddl = ran(&["create table t(a int)", "insert into t values ('x')"]);
    assert!(rollback_note(DatabaseKind::Postgres, &ddl, true).contains("Nichts geändert"));
    assert!(rollback_note(DatabaseKind::Mysql, &ddl, true).contains("sofort fest"));
    assert!(rollback_note(DatabaseKind::Oracle, &ddl, true).contains("sofort fest"));
    let own = ran(&[
        "insert into t values (1)",
        "commit",
        "insert into t values (2)",
    ]);
    assert!(rollback_note(DatabaseKind::Postgres, &own, true).contains("BEGIN/COMMIT"));
    assert!(rollback_note(DatabaseKind::Mssql, &own, true).contains("BEGIN/COMMIT"));
    let nested = ran(&[
        "BEGIN TRAN",
        "insert into t values (1)",
        "COMMIT",
        "insert into t values (1)",
    ]);
    assert!(rollback_note(DatabaseKind::Mssql, &nested, true).contains("Nichts geändert"));
    assert!(rollback_note(DatabaseKind::Postgres, &nested, true).contains("BEGIN/COMMIT"));
}

#[test]
fn open_transactions_and_rollback_notes_follow_each_family() {
    let ran = |sql: &[&str]| sql.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let open = ran(&[
        "BEGIN",
        "insert into t values (99)",
        "select count(*) from t",
    ]);
    assert!(super::run::open_at_end(DatabaseKind::Postgres, &open));
    assert!(rollback_note(DatabaseKind::Postgres, &open, false).contains("Nichts geändert"));
    let closed = ran(&["begin", "insert into t values (1)", "commit"]);
    assert!(!super::run::open_at_end(DatabaseKind::Postgres, &closed));
    let reopened = ran(&[
        "begin",
        "insert into t values (1)",
        "end",
        "start transaction",
        "select 1",
    ]);
    assert!(super::run::open_at_end(DatabaseKind::Postgres, &reopened));
    assert!(rollback_note(DatabaseKind::Postgres, &reopened, false).contains("BEGIN/COMMIT"));
    let savepoint = ran(&["begin", "savepoint a", "rollback to savepoint a"]);
    assert!(super::run::open_at_end(DatabaseKind::Postgres, &savepoint));
    let plsql = ran(&["begin null; end;", "insert into t values (1)"]);
    assert!(!super::run::open_at_end(DatabaseKind::Oracle, &plsql));
    assert!(rollback_note(DatabaseKind::Oracle, &plsql, true).contains("Nichts geändert"));
    let block = ran(&["begin print 1 end", "insert into t values (1)"]);
    assert!(!super::run::open_at_end(DatabaseKind::Mssql, &block));
    assert!(super::run::open_at_end(
        DatabaseKind::Mssql,
        &ran(&["begin tran", "select 1"])
    ));
    let mysql = ran(&[
        "insert into t values (1)",
        "begin",
        "insert into t values (2)",
    ]);
    assert!(rollback_note(DatabaseKind::Mysql, &mysql, true).contains("BEGIN/COMMIT"));
}

#[test]
fn changed_uses_the_family_terms() {
    let result = |n| crate::db::QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: Some(n),
        execution_time_ms: 0,
        truncated: false,
    };
    assert_eq!(
        changed(DatabaseKind::Postgres, &result(1)),
        "1 Zeile geändert"
    );
    assert_eq!(
        changed(DatabaseKind::Mongodb, &result(3)),
        "3 Dokumente geändert"
    );
    assert_eq!(
        changed(DatabaseKind::Influxdb, &result(2)),
        "2 Punkte geschrieben"
    );
}

#[test]
fn repeated_statements_get_their_own_line() {
    let sql = "select 1;\nselect 1;\n\nselect 1;";
    let parts = statements(DatabaseKind::Postgres, sql).unwrap();
    assert_eq!(statement_lines(sql, &parts), vec![0, 1, 3]);
}

#[test]
fn rollback_note_names_statements_that_ddl_already_committed() {
    let ran = |sql: &[&str]| sql.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let mid = ran(&[
        "insert into p values (52)",
        "create table d (id int)",
        "insert into p values (52)",
    ]);
    for kind in [DatabaseKind::Mysql, DatabaseKind::Oracle] {
        let note = rollback_note(kind, &mid, true);
        assert!(
            note.contains("Anweisungen 1 bis 2 bleiben bestehen"),
            "{note}"
        );
        assert!(!note.contains("Nichts geändert"), "{note}");
    }
    let failed_ddl = ran(&["insert into p values (1)", "create table p (id int)"]);
    assert!(rollback_note(DatabaseKind::Mysql, &failed_ddl, true).contains("Anweisung 1 bleibt"));
    assert!(rollback_note(DatabaseKind::Mysql, &failed_ddl, false).contains("1 bis 2"));
    assert!(rollback_note(
        DatabaseKind::Mysql,
        &ran(&["create table p (id int)", "x"]),
        true
    )
    .contains("Anweisung 1 bleibt"));
    assert!(rollback_note(
        DatabaseKind::Mysql,
        &ran(&["create table p (id int)"]),
        true
    )
    .contains("Nichts geändert"));
    for kind in [
        DatabaseKind::Postgres,
        DatabaseKind::Sqlite,
        DatabaseKind::Mssql,
        DatabaseKind::SqliteHttp,
    ] {
        assert!(
            rollback_note(kind, &mid, true).contains("Nichts geändert"),
            "{kind:?}"
        );
    }
}

#[test]
fn mssql_scripts_keep_variables_in_one_batch() {
    assert_eq!(
        statements(DatabaseKind::Mssql, "DECLARE @x INT = 5; SELECT @x AS v").unwrap(),
        ["DECLARE @x INT = 5; SELECT @x AS v"]
    );
    let open = statements(DatabaseKind::Mssql, "BEGIN TRAN; INSERT INTO t VALUES (1);").unwrap();
    assert_eq!(open.len(), 2);
    assert!(super::run::open_at_end(DatabaseKind::Mssql, &open));
    assert!(writes(
        DatabaseKind::Mssql,
        "DECLARE @x INT = 1; INSERT INTO t VALUES (@x)"
    ));
    let line = super::run::script_line;
    assert_eq!(
        line("SQL Server 8134: Divide by zero (Zeile 1)".into(), 2),
        "SQL Server 8134: Divide by zero (Zeile 3)"
    );
    assert_eq!(line("ohne Zeile".into(), 2), "ohne Zeile");
}

#[test]
fn cursor_errors_point_into_the_typed_statement() {
    let shift = super::run::shift_position;
    assert_eq!(
        shift("Datenbankfehler: x\nPosition: 53".into(), 38, 0),
        "Datenbankfehler: x\nPosition: 15"
    );
    assert_eq!(
        shift("a\nPosition: 49\nSQLSTATE 1".into(), 38, 2),
        "a\nPosition: 13\nSQLSTATE 1"
    );
    assert_eq!(shift("ohne".into(), 38, 0), "ohne");
    assert_eq!(super::run::unquoted_column("\"into\"".into()), "into");
    assert_eq!(super::run::unquoted_column("\"a\"\"b\"".into()), "a\"b");
    assert_eq!(super::run::unquoted_column("plain".into()), "plain");
}

#[test]
fn sql_starting_with_a_comment_is_not_an_option() {
    let sql = super::sql_comment_arg("-- Kommentar\nselect 1 as x");
    assert_eq!(sql, " -- Kommentar\nselect 1 as x");
    assert_eq!(super::sql_comment_arg("--limit"), "--limit");
    assert_eq!(
        super::sql_comment_arg("--x\nselect 6 as v"),
        " --x\nselect 6 as v"
    );
    assert_eq!(
        super::sql_comment_arg("--where=a = 1\nAND b = 2"),
        "--where=a = 1\nAND b = 2"
    );
    assert_eq!(super::sql_comment_arg("--"), "--");
    let argv = [
        "l8db",
        "--url",
        "a.sqlite",
        "query",
        sql.as_str(),
        "-o",
        "json",
    ];
    let matches = super::command().try_get_matches_from(argv).unwrap();
    assert!(<super::Cli as clap::FromArgMatches>::from_arg_matches(&matches).is_ok());
}

#[tokio::test]
async fn read_only_flag_names_itself_on_saved_connections() {
    let target = |read_only, read_only_flag| connect::Target {
        id: "c1".into(),
        name: "Prod".into(),
        kind: DatabaseKind::Postgres,
        read_only,
        read_only_flag,
        production: false,
    };
    let flagged = allow_write(&target(true, true), &Approval::Flag(true))
        .await
        .unwrap_err();
    assert!(flagged.starts_with("--read-only"), "{flagged}");
    let saved = allow_write(&target(true, false), &Approval::Flag(true))
        .await
        .unwrap_err();
    assert!(saved.contains("nur in der App"), "{saved}");
}

#[tokio::test]
async fn read_only_names_unknown_redis_commands() {
    let target = connect::Target {
        id: String::new(),
        name: "redis".into(),
        kind: DatabaseKind::Redis,
        read_only: true,
        read_only_flag: true,
        production: false,
    };
    let reject = |sql: &'static str| {
        let target = &target;
        async move {
            match super::run::prepare(target, sql, Approval::Flag(false), &mut |_| {}).await {
                Err(error) => error,
                Ok(_) => panic!("{sql} darf nicht laufen"),
            }
        }
    };
    let unknown = reject("FOOBAR x").await;
    assert!(unknown.contains("„FOOBAR“ ist l8db unbekannt"), "{unknown}");
    let known = reject("FLUSHDB").await;
    assert_eq!(known, "--read-only: die Anweisung würde schreiben.");
}

#[test]
fn read_only_flag_protects_ad_hoc_urls() {
    let flagged = parse("l8db --url postgres://u@h/db --read-only query \"select 1\"").unwrap();
    let plain = parse("l8db --url postgres://u@h/db query \"select 1\"").unwrap();
    let url = || connect::ad_hoc("postgres://u@h/db").unwrap();
    assert!(read_only(&flagged.global, url()).target().read_only);
    assert!(!read_only(&plain.global, url()).target().read_only);
    assert_eq!(
        read_timeout(
            "Query-Timeout nach 300 Sekunden. Der Serverabschluss ist nicht bestätigt.".into()
        ),
        "Query-Timeout nach 300 Sekunden. Es wurde nur gelesen; Filter enger setzen."
    );
    assert_eq!(read_timeout("anderer Fehler".into()), "anderer Fehler");
    assert_eq!(
        read_timeout("BigQuery: keine Antwort von http://127.0.0.1:9 nach 5 Sekunden. Der Serverabschluss ist nicht bestätigt.".into()),
        "BigQuery: keine Antwort von http://127.0.0.1:9 nach 5 Sekunden. Es wurde nur gelesen; Filter enger setzen."
    );
    assert_eq!(
        catalog_timeout(
            "Query-Timeout nach 60 Sekunden. Der Serverabschluss ist nicht bestätigt.".into()
        ),
        "Query-Timeout nach 60 Sekunden beim Lesen der Tabellenliste. Es wurde nur gelesen."
    );
}

#[test]
fn shared_write_cases_match_the_app() {
    let cases: serde_json::Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/write-detection-cases.json"
    ))
    .unwrap();
    for (family, lists) in cases.as_object().unwrap() {
        let kind: DatabaseKind =
            serde_json::from_value(serde_json::Value::String(family.clone())).unwrap();
        for (list, expected) in [("writes", true), ("reads", false)] {
            for sql in lists[list].as_array().unwrap() {
                let sql = sql.as_str().unwrap();
                assert_eq!(writes(kind, sql), expected, "{family}: {sql}");
            }
        }
    }
}

#[test]
fn begin_options_carry_into_the_script_transaction() {
    let ran = |sql: &[&str]| sql.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let carried = |kind, sql: &[&str]| super::run::carried_begin(kind, &ran(sql));
    let pg = DatabaseKind::Postgres;
    assert_eq!(
        carried(
            pg,
            &[
                "BEGIN ISOLATION LEVEL SERIALIZABLE",
                "update t set a = 1",
                "COMMIT"
            ]
        )
        .as_deref(),
        Some("BEGIN ISOLATION LEVEL SERIALIZABLE\n")
    );
    assert_eq!(
        carried(
            pg,
            &[
                "set search_path = s",
                "START TRANSACTION READ ONLY -- ro",
                "update t set a = 1"
            ]
        )
        .as_deref(),
        Some("START TRANSACTION READ ONLY -- ro\n")
    );
    for bare in [
        "BEGIN",
        "begin work",
        "BEGIN TRANSACTION",
        "start transaction",
    ] {
        assert_eq!(
            carried(pg, &[bare, "update t set a = 1", "commit"]),
            None,
            "{bare}"
        );
    }
    assert_eq!(
        carried(pg, &["update t set a = 1", "commit", "begin read only"]),
        None
    );
    assert_eq!(
        carried(
            DatabaseKind::Mysql,
            &["start transaction read only", "select 1"]
        ),
        None
    );
}

#[test]
fn rollback_inside_a_script_is_not_reported_as_one_transaction() {
    let ran = |sql: &[&str]| sql.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let split = |kind, sql: &[&str]| super::run::split_by_script(kind, &ran(sql));
    for kind in [DatabaseKind::Postgres, DatabaseKind::Mysql] {
        assert!(split(
            kind,
            &[
                "insert into t values ('a')",
                "rollback",
                "insert into t values ('b')",
                "commit"
            ]
        ));
        assert!(split(
            kind,
            &[
                "insert into t values ('a')",
                "commit",
                "insert into t values ('b')"
            ]
        ));
        assert!(!split(
            kind,
            &["begin", "insert into t values ('a')", "commit"]
        ));
        assert!(!split(
            kind,
            &["begin", "savepoint a", "rollback to savepoint a", "commit"]
        ));
    }
    let mid = ran(&[
        "insert into t values ('a')",
        "rollback",
        "insert into t values ('b')",
        "insert into t values (x)",
    ]);
    assert!(rollback_note(DatabaseKind::Postgres, &mid, true).contains("bereits festgeschriebene"));
}
