mod connect;
pub mod install;
mod output;
mod run;
pub mod store;

use clap::{ArgAction, Args, CommandFactory, Parser, Subcommand};
use output::Format;

const ROOT_HELP: &str = "\
l8db {version} – Datenbanken im Terminal steuern

Aufruf:
  l8db <befehl> [optionen]
  l8db                     ohne Befehl startet die App

Verbindungen
  conn list                Gespeicherte Verbindungen anzeigen
  conn use <name>          Standardverbindung festlegen
  conn test [name]         Verbindung prüfen
  conn show <name>         Details einer Verbindung
  open [name]              Verbindung in der App öffnen

Daten
  query [sql]              SQL ausführen (kurz: q)
  db list                  Datenbanken auflisten
  schema list              Schemas auflisten
  table list               Tabellen auflisten
  table describe <tabelle> Spalten einer Tabelle
  table rows <tabelle>     Zeilen anzeigen
  table count <tabelle>    Zeilen zählen

Automatisierung
  task list                Gespeicherte Aufgaben anzeigen
  task run <name>          Aufgabe ausführen
  check                    SQL-Prüfungen für CI ausführen
  mcp                      MCP-Server für KI-Clients starten

Shell
  completions <shell>      Tab-Vervollständigung (bash, zsh, fish, powershell)
  help [befehl]            Hilfe zu einem Befehl

Globale Optionen
{options}

Beispiele
  l8db conn list
  l8db conn use prod
  l8db q \"select count(*) from users\"
  l8db table rows users --where \"active\" --limit 20
  l8db query -c staging -f bericht.sql -o csv > bericht.csv
  echo \"select 1\" | l8db query --url postgres://localhost/app

Mehr zu einem Befehl: l8db <befehl> --help
";

const SUB_HELP: &str = "\
{about-with-newline}
Aufruf:
  {usage}

{all-args}{after-help}
";

#[derive(Parser, Debug)]
#[command(
    name = "l8db",
    version = env!("CARGO_PKG_VERSION"),
    help_template = ROOT_HELP,
    override_usage = "l8db <befehl> [optionen]",
    disable_help_flag = true,
    disable_version_flag = true,
    disable_help_subcommand = true,
    subcommand_required = true,
    arg_required_else_help = true,
    subcommand_help_heading = "Befehle",
)]
pub struct Cli {
    #[command(flatten)]
    global: Global,
    #[arg(short = 'V', long, action = ArgAction::Version, help = "Version anzeigen")]
    version: Option<bool>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Args, Debug, Clone, Default)]
#[command(next_help_heading = "Globale Optionen")]
pub struct Global {
    #[arg(
        short = 'c',
        long,
        global = true,
        value_name = "NAME",
        help = "Verbindung (Name oder ID). Sonst $L8DB_CONNECTION oder der Standard aus „conn use“"
    )]
    connection: Option<String>,
    #[arg(
        long,
        global = true,
        value_name = "URL",
        conflicts_with = "connection",
        help = "Ohne gespeicherte Verbindung direkt verbinden (auch $L8DB_URL), z. B. postgres://user@host/db oder datei.sqlite"
    )]
    url: Option<String>,
    #[arg(
        short = 'd',
        long,
        global = true,
        value_name = "NAME",
        help = "Datenbank wechseln"
    )]
    database: Option<String>,
    #[arg(
        short = 'o',
        long,
        global = true,
        value_enum,
        value_name = "FORMAT",
        help = "Ausgabe: table, json, ndjson, csv, tsv (Standard: table im Terminal, sonst tsv)",
        hide_possible_values = true
    )]
    output: Option<Format>,
    #[arg(short = 'h', long, global = true, action = ArgAction::Help, help = "Hilfe anzeigen")]
    help: Option<bool>,
}

#[derive(Subcommand, Debug)]
enum Command {
    #[command(
        about = "Gespeicherte Verbindungen anzeigen, prüfen und als Standard festlegen",
        alias = "connection",
        help_template = SUB_HELP,
        override_usage = "l8db conn <befehl>",
        after_help = "Beispiele:\n  l8db conn list\n  l8db conn use prod\n  l8db conn test\n\nVerbindungen legst du in der App an; die CLI übernimmt sie automatisch."
    )]
    Conn {
        #[command(subcommand)]
        command: Option<ConnCommand>,
    },
    #[command(
        about = "SQL ausführen (kurz: q)",
        alias = "q",
        help_template = SUB_HELP,
        override_usage = "l8db query [SQL] [-f DATEI] [-c NAME] [-o FORMAT]",
        after_help = "SQL kommt als Argument, mit -f aus einer Datei oder über die Standardeingabe.\nMehrere Anweisungen werden nacheinander ausgeführt; beim ersten Fehler stoppt l8db.\n\nBeispiele:\n  l8db q \"select * from users limit 5\"\n  l8db query -f migration.sql --yes\n  cat bericht.sql | l8db query -o csv > bericht.csv\n  l8db query --all -o ndjson \"select * from events\" | jq .id"
    )]
    Query(QueryArgs),
    #[command(
        about = "Datenbanken auflisten",
        help_template = SUB_HELP,
        override_usage = "l8db db [list]"
    )]
    Db {
        #[command(subcommand)]
        command: Option<ListOnly>,
    },
    #[command(
        about = "Schemas auflisten",
        help_template = SUB_HELP,
        override_usage = "l8db schema [list]"
    )]
    Schema {
        #[command(subcommand)]
        command: Option<ListOnly>,
    },
    #[command(
        about = "Tabellen auflisten, beschreiben, anzeigen und zählen",
        alias = "tables",
        help_template = SUB_HELP,
        override_usage = "l8db table <befehl>",
        after_help = "Tabellen gibst du als name oder schema.name an.\n\nBeispiele:\n  l8db table list -s public\n  l8db table describe public.users\n  l8db table rows users --where \"created_at > now() - interval '1 day'\" --order-by id --desc\n  l8db table count orders --where \"status = 'open'\""
    )]
    Table {
        #[command(subcommand)]
        command: Option<TableCommand>,
    },
    #[command(
        about = "Verbindung in der App öffnen",
        help_template = SUB_HELP,
        override_usage = "l8db open [NAME]"
    )]
    Open {
        #[arg(value_name = "NAME", help = "Verbindung (Standard: wie bei -c)")]
        name: Option<String>,
    },
    #[command(
        about = "Gespeicherte Aufgaben anzeigen und ausführen",
        help_template = SUB_HELP,
        override_usage = "l8db task <befehl>"
    )]
    Task {
        #[command(subcommand)]
        command: TaskCommand,
    },
    #[command(
        about = "SQL-Prüfungen aus einer Prüfdatei ausführen (für CI)",
        help_template = SUB_HELP,
        override_usage = "l8db check --config <DATEI> --url-env <VARIABLE> [--report <DATEI>]"
    )]
    Check {
        #[arg(long, value_name = "DATEI", help = "Prüfdatei (checks.json)")]
        config: String,
        #[arg(
            long,
            value_name = "VARIABLE",
            help = "Umgebungsvariable mit der Datenbank-URL"
        )]
        url_env: String,
        #[arg(long, value_name = "DATEI", help = "Bericht als JSON schreiben")]
        report: Option<String>,
    },
    #[command(
        about = "MCP-Server über stdin/stdout starten (für KI-Clients)",
        help_template = SUB_HELP,
        override_usage = "l8db mcp"
    )]
    Mcp,
    #[command(
        about = "Tab-Vervollständigung für deine Shell ausgeben",
        help_template = SUB_HELP,
        override_usage = "l8db completions <SHELL>",
        after_help = "Einrichten:\n  zsh:        l8db completions zsh > ~/.zfunc/_l8db   (fpath+=~/.zfunc in ~/.zshrc)\n  bash:       l8db completions bash > ~/.local/share/bash-completion/completions/l8db\n  fish:       l8db completions fish > ~/.config/fish/completions/l8db.fish\n  PowerShell: l8db completions powershell >> $PROFILE"
    )]
    Completions {
        #[arg(value_enum, value_name = "SHELL")]
        shell: clap_complete::Shell,
    },
    #[command(
        about = "Hilfe zu einem Befehl anzeigen",
        help_template = SUB_HELP,
        override_usage = "l8db help [BEFEHL]..."
    )]
    Help {
        #[arg(value_name = "BEFEHL")]
        command: Vec<String>,
    },
}

#[derive(Subcommand, Debug)]
enum ConnCommand {
    #[command(
        about = "Alle gespeicherten Verbindungen anzeigen, * = Standard (kurz: ls)",
        alias = "ls",
        override_usage = "l8db conn list"
    )]
    List,
    #[command(
        about = "Standardverbindung festlegen",
        override_usage = "l8db conn use <NAME>\n  l8db conn use --clear"
    )]
    Use {
        #[arg(value_name = "NAME", required_unless_present = "clear")]
        name: Option<String>,
        #[arg(long, help = "Standard wieder entfernen")]
        clear: bool,
    },
    #[command(about = "Verbindung prüfen", override_usage = "l8db conn test [NAME]")]
    Test {
        #[arg(value_name = "NAME", help = "Verbindung (Standard: wie bei -c)")]
        name: Option<String>,
    },
    #[command(
        about = "Details einer Verbindung anzeigen (ohne Passwort)",
        override_usage = "l8db conn show [NAME]"
    )]
    Show {
        #[arg(value_name = "NAME")]
        name: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
enum ListOnly {
    #[command(about = "Auflisten (kurz: ls)", alias = "ls")]
    List,
}

#[derive(Args, Debug)]
struct QueryArgs {
    #[arg(
        value_name = "SQL",
        help = "SQL-Text; „-“ liest von der Standardeingabe"
    )]
    sql: Option<String>,
    #[arg(
        short = 'f',
        long,
        value_name = "DATEI",
        conflicts_with = "sql",
        help = "SQL aus Datei lesen"
    )]
    file: Option<std::path::PathBuf>,
    #[arg(
        short = 'y',
        long,
        help = "Schreibende Anweisungen auf Produktion ohne Rückfrage ausführen"
    )]
    yes: bool,
    #[arg(
        long,
        help = "Mehrere Anweisungen nicht in einer gemeinsamen Transaktion ausführen"
    )]
    no_transaction: bool,
    #[command(flatten)]
    limit: Limit,
    #[arg(
        long,
        value_name = "SEKUNDEN",
        default_value_t = 300,
        help = "Abbruch nach so vielen Sekunden; 0 = ohne Grenze"
    )]
    timeout: u64,
}

#[derive(Args, Debug, Clone, Copy)]
struct Limit {
    #[arg(
        short = 'n',
        long,
        value_name = "ANZAHL",
        default_value_t = 1000,
        help = "Höchstens so viele Zeilen ausgeben"
    )]
    limit: usize,
    #[arg(long, conflicts_with = "limit", help = "Alle Zeilen ausgeben")]
    all: bool,
}

impl Limit {
    fn rows(self) -> Option<usize> {
        (!self.all).then_some(self.limit)
    }
}

#[derive(Subcommand, Debug)]
enum TableCommand {
    #[command(
        about = "Tabellen und Views auflisten (kurz: ls)",
        alias = "ls",
        override_usage = "l8db table list [-s SCHEMA]"
    )]
    List {
        #[arg(short = 's', long, value_name = "SCHEMA", help = "Nur dieses Schema")]
        schema: Option<String>,
    },
    #[command(
        about = "Spalten und Typen einer Tabelle anzeigen (kurz: desc)",
        alias = "desc",
        override_usage = "l8db table describe <TABELLE>"
    )]
    Describe {
        #[arg(value_name = "TABELLE", help = "Name oder schema.name")]
        table: String,
    },
    #[command(
        about = "Zeilen einer Tabelle anzeigen (auch: show)",
        alias = "show",
        override_usage = "l8db table rows <TABELLE> [--where AUSDRUCK] [--order-by SPALTE] [--desc] [-n ANZAHL]"
    )]
    Rows {
        #[arg(value_name = "TABELLE", help = "Name oder schema.name")]
        table: String,
        #[arg(
            short = 'w',
            long = "where",
            value_name = "AUSDRUCK",
            help = "SQL-Filter, z. B. \"id > 10\""
        )]
        filter: Option<String>,
        #[arg(long, value_name = "SPALTE", help = "Sortieren nach Spalte")]
        order_by: Option<String>,
        #[arg(long, requires = "order_by", help = "Absteigend sortieren")]
        desc: bool,
        #[arg(
            short = 'n',
            long,
            value_name = "ANZAHL",
            default_value_t = 100,
            help = "Anzahl Zeilen"
        )]
        limit: i64,
        #[arg(
            long,
            value_name = "ANZAHL",
            default_value_t = 0,
            help = "Zeilen überspringen"
        )]
        offset: i64,
    },
    #[command(
        about = "Zeilen einer Tabelle zählen",
        override_usage = "l8db table count <TABELLE> [--where AUSDRUCK]"
    )]
    Count {
        #[arg(value_name = "TABELLE", help = "Name oder schema.name")]
        table: String,
        #[arg(
            short = 'w',
            long = "where",
            value_name = "AUSDRUCK",
            help = "SQL-Filter"
        )]
        filter: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
enum TaskCommand {
    #[command(about = "Gespeicherte Aufgaben anzeigen (kurz: ls)", alias = "ls")]
    List,
    #[command(
        about = "Aufgabe ausführen",
        override_usage = "l8db task run <NAME> [--var NAME=WERT]... [--env NAME] [--from-step SCHRITT]"
    )]
    Run {
        #[arg(value_name = "NAME", help = "Aufgabe (Name oder ID)")]
        task: String,
        #[arg(
            long = "var",
            value_name = "NAME=WERT",
            help = "Variable setzen (mehrfach möglich)"
        )]
        vars: Vec<String>,
        #[arg(long, value_name = "NAME", help = "Umgebung der Aufgabe")]
        env: Option<String>,
        #[arg(
            long,
            value_name = "SCHRITT",
            help = "Ab diesem Schritt (ID oder Nummer) starten"
        )]
        from_step: Option<String>,
        #[arg(short, long, help = "Nur Fehler ausgeben")]
        quiet: bool,
    },
    #[command(about = "Fällige geplante Aufgaben einmal ausführen", hide = true)]
    Tick,
}

const COMMANDS: &[&str] = &[
    "conn",
    "connection",
    "query",
    "q",
    "db",
    "schema",
    "table",
    "tables",
    "open",
    "task",
    "check",
    "mcp",
    "completions",
    "help",
    "-h",
    "--help",
    "-V",
    "--version",
    "-c",
    "-d",
    "-o",
];
const GLOBAL_FLAGS: &[&str] = &["--connection", "--url", "--database", "--output"];

pub fn wants(args: &[String]) -> bool {
    args.first().is_some_and(|first| {
        COMMANDS.contains(&first.as_str())
            || GLOBAL_FLAGS
                .iter()
                .any(|flag| first == flag || first.starts_with(&format!("{flag}=")))
            || (!first.starts_with('-')
                && !first.contains(['/', '\\', '.'])
                && !std::path::Path::new(first).exists())
    })
}

fn command() -> clap::Command {
    let root = Cli::command();
    let template = ROOT_HELP.replace("{version}", env!("CARGO_PKG_VERSION"));
    localize(
        root.help_template(template)
            .mut_subcommands(|sub| sub.mut_subcommands(|leaf| leaf.help_template(SUB_HELP))),
    )
}

fn localize(command: clap::Command) -> clap::Command {
    let ids: Vec<clap::Id> = command
        .get_arguments()
        .map(|arg| arg.get_id().clone())
        .collect();
    let mut command = ids.into_iter().fold(command, |command, id| {
        command.mut_arg(id, |arg| {
            let mut help = arg.get_help().map(ToString::to_string).unwrap_or_default();
            let defaults: Vec<String> = arg
                .get_default_values()
                .iter()
                .map(|value| value.to_string_lossy().into_owned())
                .collect();
            if !defaults.is_empty() && arg.get_action().takes_values() && !help.contains("Standard")
            {
                help.push_str(&format!(" (Standard: {})", defaults.join(", ")));
            }
            let heading = arg
                .get_help_heading()
                .is_none()
                .then_some(if arg.is_positional() {
                    "Argumente"
                } else {
                    "Optionen"
                });
            let takes_values = arg.get_action().takes_values();
            let arg = arg.help(help);
            let arg = if takes_values {
                arg.hide_default_value(true).hide_possible_values(true)
            } else {
                arg
            };
            match heading {
                Some(heading) => arg.help_heading(heading),
                None => arg,
            }
        })
    });
    command = command.subcommand_help_heading("Befehle");
    let names: Vec<String> = command
        .get_subcommands()
        .map(|sub| sub.get_name().to_string())
        .collect();
    for name in names {
        command = command.mut_subcommand(name, localize);
    }
    command
}

pub fn main(args: &[String]) -> i32 {
    attach_console();
    let argv = std::iter::once("l8db".to_string()).chain(args.iter().cloned());
    let matches = match command().try_get_matches_from(argv) {
        Ok(matches) => matches,
        Err(error) => return report(error),
    };
    let cli = match <Cli as clap::FromArgMatches>::from_arg_matches(&matches) {
        Ok(cli) => cli,
        Err(error) => return report(error),
    };
    run::dispatch(cli)
}

fn report(error: clap::Error) -> i32 {
    use clap::error::ErrorKind;
    let code = error.exit_code();
    if matches!(
        error.kind(),
        ErrorKind::DisplayHelp
            | ErrorKind::DisplayVersion
            | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand
    ) {
        let _ = error.print();
        return 0;
    }
    eprintln!("{}", german(&error));
    code
}

fn german(error: &clap::Error) -> String {
    use clap::error::{ContextKind, ContextValue, ErrorKind};
    let value = |kind| match error.get(kind) {
        Some(ContextValue::String(text)) => Some(text.clone()),
        Some(ContextValue::Strings(list)) => Some(list.join(", ")),
        _ => None,
    };
    let invalid = value(ContextKind::InvalidSubcommand)
        .or_else(|| value(ContextKind::InvalidArg))
        .unwrap_or_default();
    let suggested = |kind| match error.get(kind) {
        Some(ContextValue::String(text)) => Some(text.clone()),
        Some(ContextValue::Strings(list)) => list.iter().max_by_key(|s| s.len()).cloned(),
        _ => None,
    };
    let suggestion = suggested(ContextKind::SuggestedSubcommand)
        .or_else(|| suggested(ContextKind::SuggestedArg))
        .map(|s| format!("\n  Meintest du „{s}“?"))
        .unwrap_or_default();
    let usage = match error.get(ContextKind::Usage) {
        Some(ContextValue::StyledStr(usage)) => usage
            .to_string()
            .replace("Usage: ", "")
            .replace("Aufruf:", "")
            .trim()
            .to_string(),
        _ => String::new(),
    };
    let usage = if usage.is_empty() {
        String::new()
    } else {
        format!("\n\nAufruf: {usage}")
    };
    let help = "\nHilfe: l8db --help";
    let message = match error.kind() {
        ErrorKind::InvalidSubcommand => format!("Unbekannter Befehl „{invalid}“.{suggestion}"),
        ErrorKind::UnknownArgument => format!("Unbekannte Option „{invalid}“.{suggestion}"),
        ErrorKind::MissingRequiredArgument => format!("Es fehlt: {invalid}"),
        ErrorKind::MissingSubcommand => "Es fehlt ein Befehl.".to_string(),
        ErrorKind::InvalidValue => {
            let actual = value(ContextKind::InvalidValue).unwrap_or_default();
            let valid = value(ContextKind::ValidValue)
                .map(|v| format!(" Möglich: {v}."))
                .unwrap_or_default();
            format!("Ungültiger Wert „{actual}“ für {invalid}.{valid}{suggestion}")
        }
        ErrorKind::ValueValidation => {
            let actual = value(ContextKind::InvalidValue).unwrap_or_default();
            format!("Ungültiger Wert „{actual}“ für {invalid}.")
        }
        ErrorKind::ArgumentConflict => {
            let other = value(ContextKind::PriorArg).unwrap_or_default();
            format!("{invalid} und {other} schließen sich aus.")
        }
        ErrorKind::TooManyValues | ErrorKind::NoEquals => {
            format!("Unerwartetes Argument „{invalid}“.")
        }
        _ => return error.render().to_string(),
    };
    format!("Fehler: {message}{usage}{help}")
}

pub fn help_for(path: &[String]) -> i32 {
    let mut current = command();
    current.build();
    for name in path {
        let Some(found) = current.find_subcommand(name).cloned() else {
            eprintln!("Unbekannter Befehl „{name}“.\nAlle Befehle: l8db --help");
            return 2;
        };
        let bin = format!(
            "{} {}",
            current.get_bin_name().unwrap_or("l8db"),
            found.get_name()
        );
        current = found.bin_name(bin);
    }
    let _ = current.print_help();
    0
}

pub fn completions(shell: clap_complete::Shell) -> i32 {
    clap_complete::generate(shell, &mut command(), "l8db", &mut std::io::stdout());
    0
}

#[cfg(windows)]
fn attach_console() {
    use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
    unsafe {
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg(not(windows))]
fn attach_console() {}

#[cfg(test)]
mod tests;
