use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Local};

use crate::automation::engine;
use crate::automation::model::{AlertStatus, LogLevel, RunDetail, RunStatus, Task, TriggerKind};
use crate::automation::runtime::{AutomationEvent, RunRequest, Services, Sink, StartError};
use crate::automation::scheduler;
use crate::automation::store::Store;

const USAGE: &str = "Aufruf:\n  l8db --run-task <id|name> [--var NAME=WERT]... [--env NAME] [--from-step <id|nummer>] [--json] [--quiet]\n  l8db --list-tasks [--json]\n  l8db --automation-tick [--json]";
const CANCEL_GRACE: Duration = Duration::from_secs(10);

static INTERRUPTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Default, PartialEq)]
struct RunArgs {
    task: String,
    vars: BTreeMap<String, String>,
    env: Option<String>,
    from_step: Option<String>,
    json: bool,
    quiet: bool,
}

#[derive(Debug, PartialEq)]
enum Command {
    Run(RunArgs),
    List { json: bool },
    Tick { json: bool },
}

fn value<'a>(args: &mut impl Iterator<Item = &'a String>, name: &str) -> Result<String, String> {
    args.next()
        .filter(|value| !value.starts_with("--"))
        .cloned()
        .ok_or_else(|| format!("{name} braucht einen Wert."))
}

fn parse(args: &[String]) -> Result<Command, String> {
    let mut modes = Vec::new();
    let mut run = RunArgs::default();
    let mut run_only = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--run-task" => {
                modes.push("--run-task");
                run.task = value(&mut iter, arg)?;
            }
            "--list-tasks" => modes.push("--list-tasks"),
            "--automation-tick" => modes.push("--automation-tick"),
            "--var" => {
                let pair = value(&mut iter, arg)?;
                let (name, value) = pair
                    .split_once('=')
                    .filter(|(name, _)| !name.trim().is_empty())
                    .ok_or_else(|| format!("--var erwartet NAME=WERT, erhalten „{pair}“."))?;
                run.vars.insert(name.trim().to_string(), value.to_string());
                run_only.get_or_insert("--var");
            }
            "--env" => {
                run.env = Some(value(&mut iter, arg)?);
                run_only.get_or_insert("--env");
            }
            "--from-step" => {
                run.from_step = Some(value(&mut iter, arg)?);
                run_only.get_or_insert("--from-step");
            }
            "--quiet" => {
                run.quiet = true;
                run_only.get_or_insert("--quiet");
            }
            "--json" => run.json = true,
            other => return Err(format!("Unbekanntes Argument „{other}“.")),
        }
    }
    match modes.as_slice() {
        [] => Err("Keine Aktion angegeben.".into()),
        ["--run-task"] => Ok(Command::Run(run)),
        [mode] => match run_only {
            Some(flag) => Err(format!("{flag} gilt nur für --run-task.")),
            None if *mode == "--list-tasks" => Ok(Command::List { json: run.json }),
            None => Ok(Command::Tick { json: run.json }),
        },
        _ => Err("Bitte genau eine Aktion angeben.".into()),
    }
}

fn status_code(status: RunStatus, alert_triggered: bool) -> i32 {
    match status {
        RunStatus::Success | RunStatus::Warning if alert_triggered => 10,
        RunStatus::Success | RunStatus::Warning => 0,
        RunStatus::Timeout => 7,
        RunStatus::Cancelled => 8,
        RunStatus::Skipped => 5,
        RunStatus::Failed | RunStatus::Interrupted | RunStatus::Running => 1,
    }
}

fn start_error_code(error: &StartError) -> i32 {
    match error {
        StartError::NotFound(_) | StartError::Ambiguous(_) => 3,
        StartError::NeedsReview | StartError::Invalid(_) | StartError::Disabled => 4,
        StartError::AlreadyRunning(_) => 5,
        StartError::Store(_) => 6,
    }
}

fn status_text(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Running => "läuft",
        RunStatus::Success => "erfolgreich",
        RunStatus::Warning => "mit Warnungen",
        RunStatus::Failed => "fehlgeschlagen",
        RunStatus::Cancelled => "abgebrochen",
        RunStatus::Timeout => "Zeitüberschreitung",
        RunStatus::Skipped => "übersprungen",
        RunStatus::Interrupted => "unterbrochen",
    }
}

fn grouped(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(' ');
        }
        out.push(digit);
    }
    out
}

fn seconds(ms: u64) -> String {
    format!("{:.1} s", ms as f64 / 1000.0).replace('.', ",")
}

fn clock() -> String {
    Local::now().format("%H:%M:%S").to_string()
}

fn progress_sink(progress: bool, task_id: String, run_id: Arc<Mutex<Option<String>>>) -> Sink {
    let total = Arc::new(AtomicU32::new(0));
    Arc::new(move |event| match event {
        AutomationEvent::RunStarted { run } => {
            if run.task_id == task_id && run.parent_run_id.is_none() {
                if let Ok(mut current) = run_id.lock() {
                    current.get_or_insert(run.id.clone());
                }
                total.store(run.steps_total, Ordering::Relaxed);
            }
            if progress {
                eprintln!(
                    "[{}] Lauf „{}“ gestartet ({})",
                    clock(),
                    run.task_name,
                    run.id
                );
            }
        }
        AutomationEvent::RunStep { step, .. } if progress && step.status != RunStatus::Running => {
            let mut details = Vec::new();
            if let Some(rows) = step.rows {
                details.push(format!("{} Zeilen", grouped(rows)));
            }
            if let Some(ms) = step.duration_ms {
                details.push(seconds(ms));
            }
            let details = if details.is_empty() {
                String::new()
            } else {
                format!(" ({})", details.join(", "))
            };
            let error = step
                .error
                .map(|error| format!(": {error}"))
                .unwrap_or_default();
            eprintln!(
                "[{}] Schritt {}/{} „{}“ {}{details}{error}",
                clock(),
                step.seq,
                total.load(Ordering::Relaxed),
                step.step_name,
                status_text(step.status)
            );
        }
        AutomationEvent::RunLog { line, .. } if progress && line.level > LogLevel::Debug => {
            eprintln!("[{}] {}", clock(), line.message);
        }
        _ => {}
    })
}

fn watch_interrupt() {
    tokio::spawn(async {
        if interrupt().await {
            INTERRUPTED.store(true, Ordering::SeqCst);
        }
    });
}

#[cfg(unix)]
async fn interrupt() -> bool {
    use tokio::signal::unix::{signal, SignalKind};
    match signal(SignalKind::terminate()) {
        Ok(mut terminate) => tokio::select! {
            result = tokio::signal::ctrl_c() => result.is_ok(),
            _ = terminate.recv() => true,
        },
        Err(_) => tokio::signal::ctrl_c().await.is_ok(),
    }
}

#[cfg(not(unix))]
async fn interrupt() -> bool {
    tokio::signal::ctrl_c().await.is_ok()
}

fn resolve_step(task: &Task, step: &str) -> Result<String, String> {
    if let Some(found) = task.steps.iter().find(|candidate| candidate.id == step) {
        return Ok(found.id.clone());
    }
    step.parse::<usize>()
        .ok()
        .and_then(|number| task.steps.get(number.checked_sub(1)?))
        .map(|found| found.id.clone())
        .ok_or_else(|| format!("Schritt „{step}“ gibt es in „{}“ nicht.", task.name))
}

fn check_vars(task: &Task, vars: &BTreeMap<String, String>) -> Result<(), String> {
    let known: Vec<&str> = task
        .variables
        .iter()
        .map(|variable| variable.name.as_str())
        .collect();
    match vars.keys().find(|name| !known.contains(&name.as_str())) {
        Some(name) => Err(format!(
            "Unbekannte Variable „{name}“. Bekannt: {}.",
            if known.is_empty() {
                "keine".to_string()
            } else {
                known.join(", ")
            }
        )),
        None => Ok(()),
    }
}

async fn alert_triggered(services: &Services, detail: &RunDetail) -> bool {
    let mut steps: Vec<&str> = detail
        .steps
        .iter()
        .filter(|step| step.kind == "alert")
        .map(|step| step.step_id.as_str())
        .collect();
    steps.dedup();
    for step in steps {
        if let Ok(Some(alert)) = services.store.alert(&detail.summary.task_id, step).await {
            if alert.status == AlertStatus::Triggered {
                return true;
            }
        }
    }
    false
}

fn without_definition(detail: &RunDetail) -> serde_json::Value {
    let mut value = serde_json::to_value(detail).unwrap_or_default();
    if let Some(object) = value.as_object_mut() {
        object.remove("definition");
    }
    value
}

async fn run_task(store: Store, args: RunArgs) -> i32 {
    let run_id = Arc::new(Mutex::new(None));
    let progress = !args.json && !args.quiet;
    let task = match store.find_task(&args.task).await {
        Ok(task) => task,
        Err(error) => {
            eprintln!("{error}");
            return start_error_code(&error);
        }
    };
    let sink = progress_sink(progress, task.id.clone(), run_id.clone());
    let services = Services::new(store, sink, true);
    if let Err(error) = check_vars(&task, &args.vars) {
        eprintln!("{error}");
        return 2;
    }
    let from_step = match args
        .from_step
        .as_deref()
        .map(|step| resolve_step(&task, step))
    {
        Some(Err(error)) => {
            eprintln!("{error}");
            return 2;
        }
        Some(Ok(step)) => Some(step),
        None => None,
    };
    let request = RunRequest {
        task_id: task.id.clone(),
        trigger: TriggerKind::Cli,
        vars: args.vars,
        environment: args.env,
        from_step,
        ..RunRequest::default()
    };
    watch_interrupt();
    let execution = engine::execute(services.clone(), request);
    tokio::pin!(execution);
    let mut cancelled_at: Option<Instant> = None;
    let result = loop {
        tokio::select! {
            result = &mut execution => break result,
            _ = tokio::time::sleep(Duration::from_millis(200)) => {
                if !INTERRUPTED.load(Ordering::SeqCst) {
                    continue;
                }
                let current = run_id.lock().ok().and_then(|id| id.clone());
                match (cancelled_at, current) {
                    (None, Some(id)) => {
                        eprintln!("Abbruch angefordert …");
                        engine::cancel(&id);
                        cancelled_at = Some(Instant::now());
                    }
                    (Some(at), _) if at.elapsed() < CANCEL_GRACE => {}
                    _ => {
                        eprintln!("Abgebrochen.");
                        return 8;
                    }
                }
            }
        }
    };
    let summary = match result {
        Ok(summary) => summary,
        Err(error) => {
            eprintln!("{error}");
            return start_error_code(&error);
        }
    };
    let detail = services.store.get_run(&summary.id).await.ok().flatten();
    let alert = match &detail {
        Some(detail) => alert_triggered(&services, detail).await,
        None => false,
    };
    if args.json {
        let value = match &detail {
            Some(detail) => without_definition(detail),
            None => serde_json::json!({ "summary": summary }),
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&value).unwrap_or_default()
        );
    } else {
        println!(
            "„{}“ {} nach {} (Lauf {}).",
            summary.task_name,
            status_text(summary.status),
            seconds(summary.duration_ms.unwrap_or_default()),
            summary.id
        );
        if let Some(error) = &summary.error {
            println!("Fehler: {error}");
        }
        for output in detail.iter().flat_map(|detail| &detail.outputs) {
            println!("Ausgabe: {}", output.path);
        }
        if alert {
            println!("Alarm ausgelöst.");
        }
    }
    status_code(summary.status, alert)
}

fn local_time(at: &str) -> String {
    DateTime::parse_from_rfc3339(at)
        .map(|at| {
            at.with_timezone(&Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|_| at.to_string())
}

fn table(rows: Vec<[String; 5]>) -> String {
    let mut widths = [0usize; 5];
    for row in &rows {
        for (width, cell) in widths.iter_mut().zip(row) {
            *width = (*width).max(cell.chars().count());
        }
    }
    rows.iter()
        .map(|row| {
            row.iter()
                .zip(widths)
                .map(|(cell, width)| format!("{cell}{}", " ".repeat(width - cell.chars().count())))
                .collect::<Vec<_>>()
                .join("  ")
                .trim_end()
                .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn list_tasks(store: Store, json: bool) -> i32 {
    let tasks = match store.list_tasks().await {
        Ok(tasks) => tasks,
        Err(error) => {
            eprintln!("{error}");
            return 6;
        }
    };
    if json {
        println!("{}", serde_json::to_string(&tasks).unwrap_or_default());
        return 0;
    }
    if tasks.is_empty() {
        println!("Keine Tasks vorhanden.");
        return 0;
    }
    let mut rows =
        vec![["ID", "Name", "Aktiv", "Nächster Lauf", "Letzter Status"].map(String::from)];
    rows.extend(tasks.iter().map(|summary| {
        [
            summary.task.id.clone(),
            summary.task.name.clone(),
            if summary.task.enabled { "ja" } else { "nein" }.to_string(),
            summary
                .state
                .next_run_at
                .as_deref()
                .map(local_time)
                .unwrap_or_else(|| "–".into()),
            summary
                .state
                .last_status
                .map(status_text)
                .unwrap_or("–")
                .to_string(),
        ]
    }));
    println!("{}", table(rows));
    0
}

async fn tick(store: Store, json: bool) -> i32 {
    let sink = progress_sink(!json, String::new(), Arc::default());
    let report = scheduler::tick(Services::new(store, sink, true)).await;
    if json {
        println!("{}", serde_json::to_string(&report).unwrap_or_default());
    } else if report.app_running {
        println!("l8db läuft – die App führt die Zeitpläne aus.");
    } else {
        println!(
            "Tick: {} gestartet, {} übersprungen, {} Fehler.",
            report.started.len(),
            report.skipped.len(),
            report.failed.len()
        );
    }
    for failure in &report.failed {
        eprintln!("{failure}");
    }
    0
}

pub fn cli(args: &[String]) -> i32 {
    let command = match parse(args) {
        Ok(command) => command,
        Err(error) => {
            eprintln!("{error}\n{USAGE}");
            return 2;
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("Laufzeit konnte nicht gestartet werden: {error}");
            return 1;
        }
    };
    runtime.block_on(async move {
        let store = match Store::open_default() {
            Ok(store) => store,
            Err(error) => {
                eprintln!("{error}");
                return 6;
            }
        };
        match command {
            Command::Run(args) => run_task(store, args).await,
            Command::List { json } => list_tasks(store, json).await,
            Command::Tick { json } => tick(store, json).await,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn args(text: &str) -> Vec<String> {
        text.split_whitespace().map(str::to_string).collect()
    }

    #[test]
    fn parses_run_task_with_options() {
        let parsed = parse(&args(
            "--run-task Bericht --var ziel=a=b.csv --var n=3 --env prod --from-step 2 --json --quiet",
        ))
        .unwrap();
        assert_eq!(
            parsed,
            Command::Run(RunArgs {
                task: "Bericht".into(),
                vars: [("ziel", "a=b.csv"), ("n", "3")]
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .into(),
                env: Some("prod".into()),
                from_step: Some("2".into()),
                json: true,
                quiet: true,
            })
        );
        assert_eq!(
            parse(&args("--list-tasks --json")).unwrap(),
            Command::List { json: true }
        );
        assert_eq!(
            parse(&args("--list-tasks")).unwrap(),
            Command::List { json: false }
        );
        assert_eq!(
            parse(&args("--automation-tick")).unwrap(),
            Command::Tick { json: false }
        );
        assert_eq!(
            parse(&args("--run-task x --var leer=")).unwrap(),
            Command::Run(RunArgs {
                task: "x".into(),
                vars: [("leer".to_string(), String::new())].into(),
                ..RunArgs::default()
            })
        );
    }

    #[test]
    fn parser_errors() {
        for (input, message) in [
            ("", "Keine Aktion angegeben."),
            ("--run-task", "--run-task braucht einen Wert."),
            ("--run-task --json", "--run-task braucht einen Wert."),
            ("--run-task x --var", "--var braucht einen Wert."),
            (
                "--run-task x --var name",
                "--var erwartet NAME=WERT, erhalten „name“.",
            ),
            (
                "--run-task x --var =1",
                "--var erwartet NAME=WERT, erhalten „=1“.",
            ),
            ("--run-task x --env", "--env braucht einen Wert."),
            ("--run-task x --bogus", "Unbekanntes Argument „--bogus“."),
            (
                "--list-tasks --automation-tick",
                "Bitte genau eine Aktion angeben.",
            ),
            ("--list-tasks --var a=1", "--var gilt nur für --run-task."),
            (
                "--automation-tick --quiet",
                "--quiet gilt nur für --run-task.",
            ),
        ] {
            assert_eq!(parse(&args(input)).unwrap_err(), message, "{input}");
        }
    }

    #[test]
    fn invalid_arguments_exit_with_two() {
        assert_eq!(cli(&args("--run-task")), 2);
        assert_eq!(cli(&args("--list-tasks --bogus")), 2);
    }

    #[test]
    fn exit_codes_from_status() {
        assert_eq!(status_code(RunStatus::Success, false), 0);
        assert_eq!(status_code(RunStatus::Warning, false), 0);
        assert_eq!(status_code(RunStatus::Success, true), 10);
        assert_eq!(status_code(RunStatus::Warning, true), 10);
        assert_eq!(status_code(RunStatus::Failed, true), 1);
        assert_eq!(status_code(RunStatus::Interrupted, false), 1);
        assert_eq!(status_code(RunStatus::Timeout, false), 7);
        assert_eq!(status_code(RunStatus::Cancelled, false), 8);
        assert_eq!(status_code(RunStatus::Skipped, false), 5);
    }

    #[test]
    fn exit_codes_from_start_errors() {
        assert_eq!(start_error_code(&StartError::NotFound("x".into())), 3);
        assert_eq!(start_error_code(&StartError::Ambiguous("x".into())), 3);
        assert_eq!(start_error_code(&StartError::NeedsReview), 4);
        assert_eq!(start_error_code(&StartError::Invalid("x".into())), 4);
        assert_eq!(start_error_code(&StartError::Disabled), 4);
        assert_eq!(start_error_code(&StartError::AlreadyRunning("r".into())), 5);
        assert_eq!(start_error_code(&StartError::Store("x".into())), 6);
    }

    fn task() -> Task {
        serde_json::from_value(json!({
            "id": "t",
            "name": "Bericht",
            "variables": [{ "name": "ziel" }, { "name": "tage" }],
            "steps": [
                { "id": "a", "name": "A", "action": { "type": "log", "message": "x" } },
                { "id": "b", "name": "B", "action": { "type": "log", "message": "y" } }
            ]
        }))
        .unwrap()
    }

    #[test]
    fn unknown_variables_are_listed() {
        let task = task();
        assert!(check_vars(&task, &[("ziel".to_string(), "x".to_string())].into()).is_ok());
        assert_eq!(
            check_vars(&task, &[("zeil".to_string(), "x".to_string())].into()).unwrap_err(),
            "Unbekannte Variable „zeil“. Bekannt: ziel, tage."
        );
    }

    #[test]
    fn from_step_accepts_id_or_number() {
        let task = task();
        assert_eq!(resolve_step(&task, "b").unwrap(), "b");
        assert_eq!(resolve_step(&task, "1").unwrap(), "a");
        assert!(resolve_step(&task, "0").is_err());
        assert!(resolve_step(&task, "3").is_err());
        assert!(resolve_step(&task, "c").is_err());
    }

    #[test]
    fn formats_numbers_and_tables() {
        assert_eq!(grouped(1234), "1 234");
        assert_eq!(grouped(1234567), "1 234 567");
        assert_eq!(grouped(12), "12");
        assert_eq!(seconds(800), "0,8 s");
        assert_eq!(
            table(vec![
                ["ID", "Name", "Aktiv", "Nächster Lauf", "Letzter Status"].map(String::from),
                ["1", "Länger", "ja", "–", "–"].map(String::from),
            ]),
            "ID  Name    Aktiv  Nächster Lauf  Letzter Status\n1   Länger  ja     –              –"
        );
    }
}
