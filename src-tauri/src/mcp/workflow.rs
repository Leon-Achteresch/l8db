use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use crate::automation::model::{
    Action, AiActivity, RunDetail, RunFilter, RunStatus, Severity, Step, Task, TriggerKind,
    ValidationIssue,
};
use crate::automation::runtime::{new_id, AutomationEvent, RunRequest, Services};
use crate::automation::store::Store;
use crate::automation::{engine, schedule, scheduler};

const ACTIONS: &[&str] = &[
    "list",
    "get",
    "connections",
    "step_types",
    "validate",
    "runs",
    "run_detail",
    "create",
    "update",
    "add_step",
    "update_step",
    "remove_step",
    "duplicate",
    "delete",
    "enable",
    "disable",
    "run",
    "cancel",
];
const RUN_WAIT: Duration = Duration::from_secs(120);
const LOG_LINES: usize = 30;

const STEP_TYPES: &str = r#"Workflow (task) fields: name (unique), description, folder, tags[], enabled (default true), steps[Step], schedules[Schedule], variables[Variable], environments[{"name","variables":{}}], defaultEnvironment, notifications[{"when":"success|failure|always|warning|alert_triggered|alert_resolved","channel":Channel,"title"?,"body"?,"attachOutputs"?,"skipIfEmpty"?}], timeoutSeconds, retry Retry, maxConsecutiveFailures, missedRuns "skip|run_once", background (run via OS scheduler when the app is closed), retention {"keepDays"?,"keepRuns"?}.
Step: {"name","enabled"?,"action":{"type":...},"onSuccess"?:Flow,"onFailure"?:Flow,"retry"?:Retry,"timeoutSeconds"?}. Ids are generated when omitted.
Flow: {"type":"next"} (default onSuccess) | {"type":"goto","stepId"} | {"type":"end_success"} | {"type":"end_failure"} (default onFailure).
Retry: {"attempts","delaySeconds","backoff":"fixed|exponential","maxDelaySeconds"?}.
Connections: name or id from action=connections. Text fields accept templates: {{var}}, {{var|sql}} (filters sql json url upper lower trim filename), {{date}}, {{time}}, {{timestamp}}, {{now}}, {{date-1d:%Y-%m-%d}} (offsets s m h d w M y), {{task}}, {{run_id}}, {{user}}, {{home}}, {{item}} inside loops.
Actions:
sql: connections[], database?, sql | file
export: connection, database?, source {"type":"query","sql"} | {"type":"table","schema","table","filter"?}, format csv|tsv|json|jsonl|xlsx|xml|html|parquet|markdown|sql, output Output, csv? {"delimiter","quote","header","nullText","lineEnding","bom"}, sheetName?, maxRows?
backup: connection, database?, output Output, options?
restore: connection, database?, path, options?, allowProduction?
transfer: source, sourceDatabase?, target, targetDatabase?, schemas[{"source","target"}], foldNames?
table_copy: source, sourceDatabase?, target, targetDatabase?, tables[{"schema","table","targetSchema","targetTable"}], mode create|truncate|append, includePrimaryKey?, includeIndexes?
datagen: connection, database?, schema, table, rows, seed?, locale de|en, transaction?
import: connection, database?, schema, table, file, format csv|json|ndjson|xlsx|parquet, delimiter?, hasHeader?, sheet?, columns[{"source":columnIndex,"target"}], conflict? {"constraint","updateColumns"[]}
compare: left/right {"connection","database"?,"schema","table","filter"?}, keyColumns[], compareColumns?, failIfDifferent?, report? Output
check: connection, database?, severity warning|error, check {"type":"row_count","schema"?,"table"?,"sql"?,"op","value"} | {"type":"value","sql","op","value","tolerance"?} | {"type":"not_null","schema","table","column"} | {"type":"unique","schema","table","columns"[]} | {"type":"accepted_values","schema","table","column","values"[]} | {"type":"freshness","schema","table","column","warnAfterMinutes"?,"errorAfterMinutes"} | {"type":"query","sql"}
alert: connection, database?, sql, condition {"type":"has_rows"} | {"type":"no_rows"} | {"type":"value","column"?,"op","threshold"} | {"type":"error"}, rearmMinutes?, notifyOnResolve?
shell: program, args[], cwd?, env{}, successCodes?, capture? (variable name)
http: method get|post|put|patch|delete, url, headers{}, body?, expectStatus?, capture?
file_copy | file_move: from, to, overwrite?
file_delete | mkdir: path
file_exists: path, failIfMissing?, capture?
zip: sources[], output Output
unzip: archive, target, overwrite?
cleanup: dir, pattern, cleanup {"olderThanDays"?,"keepLast"?}
notify: channel Channel, title, body, attachOutputs?
wait: seconds? | until? (HH:MM)
set_variable: name, value?, calculate?, query? {"connection","database"?,"sql","mode":"first_value|row_count|column_list|json","separator"?}
condition: left, op, right?, then Flow, otherwise Flow
loop: over {"type":"query","connection","database"?,"sql"} | {"type":"connections","connections"?[],"tag"?} | {"type":"list","values"} | {"type":"files","dir","pattern"}, steps[Step], item? (default item), maxIterations?, continueOnError?
run_task: task, wait?, vars{}, environment?
log: level debug|info|warn|error, message
fail: message
op: eq ne gt gte lt lte contains not_contains matches empty not_empty
Output: {"path","appendTimestamp"?,"ifExists":"overwrite|append|rename|fail","zip"?,"cleanup"?}
Channel: {"type":"native"} | {"type":"email","profileId","to"[],"cc"?} | {"type":"webhook","webhookId"}
Schedule: {"trigger":Trigger,"enabled"?,"timezone"?,"startAt"?,"endAt"?,"exclusions"?[],"window"?{"from","to"},"vars"?{},"environment"?}
Trigger: {"type":"interval","every","unit":"minutes|hours|days"} | {"type":"daily","times":["HH:MM"]} | {"type":"weekly","weekdays":[1-7, Monday=1],"times"} | {"type":"monthly","days":[1-31],"lastDay"?,"times"} | {"type":"monthly_nth","nth":1-5 or -1,"weekday":1-7,"times"} | {"type":"cron","expression"} | {"type":"once","at":"RFC 3339"} | {"type":"app_start","delaySeconds"?} | {"type":"after_task","taskId","on":"success|failure|always"}
Variable: {"name","kind":"text|number|boolean|date|choice|secret","defaultValue"?,"choices"?[],"prompt"?,"description"?}"#;

pub fn tool_definition() -> Value {
    json!({
        "name": "workflow",
        "description": "Manage and run l8db automation workflows (tasks built from steps, schedules, variables and notifications). Changes appear live in the l8db app and the touched elements flash. Actions: list, get (task), connections (connections usable in steps), step_types (format reference, call before building steps), validate (task or spec), runs (task?, limit), run_detail (run), create (spec = workflow fields, name required), update (task + spec with changed top-level fields, arrays replace), add_step (task + spec = step, after = step to insert behind or \"start\", parent = loop step), update_step (task + step + spec with changed fields, action fields merge while the type stays), remove_step (task + step), duplicate, delete, enable, disable, run (task, vars, environment, fromStep, wait default true), cancel (run). Workflows are referenced by id or name, steps by id, name or 1-based number. Invalid changes are rejected with the problems to fix.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ACTIONS},
                "task": {"type": "string", "description": "Workflow id or name"},
                "step": {"type": "string", "description": "Step id, name or 1-based number"},
                "after": {"type": "string", "description": "add_step: insert behind this step, \"start\" inserts first, default appends"},
                "parent": {"type": "string", "description": "add_step: loop step that receives the step"},
                "spec": {"type": "object", "description": "Workflow or step fields, see step_types"},
                "run": {"type": "string", "description": "Run id"},
                "vars": {"type": "object", "additionalProperties": {"type": "string"}},
                "environment": {"type": "string"},
                "fromStep": {"type": "string", "description": "run: start at this top-level step"},
                "wait": {"type": "boolean", "description": "run: wait for the result, default true"},
                "limit": {"type": "integer", "minimum": 1}
            },
            "required": ["action"]
        }
    })
}

static HEADLESS: OnceLock<Services> = OnceLock::new();

pub fn services() -> Result<Services, String> {
    if let Some(services) = crate::automation::APP_SERVICES.get().or(HEADLESS.get()) {
        return Ok(services.clone());
    }
    let services = Services::new(Store::open_default()?, Arc::new(|_| {}), true);
    Ok(HEADLESS.get_or_init(|| services).clone())
}

pub enum Plan {
    Done(String),
    Save {
        task: Task,
        revision: Option<u64>,
        title: &'static str,
        steps: Vec<String>,
    },
    Duplicate(Task),
    Delete(Task),
    Enable(Task, bool),
    Run {
        task: Task,
        request: RunRequest,
        wait: bool,
    },
    Cancel(String),
}

impl Plan {
    pub fn approval(&self) -> Option<(&'static str, bool, Value)> {
        let mut all = Vec::new();
        let (title, task, steps) = match self {
            Plan::Done(_) => return None,
            Plan::Cancel(run) => {
                return Some(("Workflow-Lauf abbrechen", false, json!({"name": run})))
            }
            Plan::Save {
                task, title, steps, ..
            } => {
                flatten(&task.steps, &mut all);
                all.retain(|step| steps.contains(&step.id));
                (*title, task, all)
            }
            Plan::Run { task, .. } => {
                flatten(&task.steps, &mut all);
                ("Workflow ausführen", task, all)
            }
            Plan::Enable(task, true) => {
                flatten(&task.steps, &mut all);
                ("Workflow aktivieren", task, all)
            }
            Plan::Enable(task, false) => ("Workflow pausieren", task, all),
            Plan::Duplicate(task) => ("Workflow duplizieren", task, all),
            Plan::Delete(task) => ("Workflow löschen", task, all),
        };
        let mut details = json!({"name": format!("„{}“", task.name)});
        let mut sql = Vec::new();
        let mut command = Vec::new();
        let mut url = Vec::new();
        for step in &steps {
            match &step.action {
                Action::Sql {
                    sql: text, file, ..
                } => sql.push(file.clone().unwrap_or_else(|| text.clone())),
                Action::Shell { program, args, .. } => {
                    command.push(format!("{program} {}", args.join(" ")).trim().to_string())
                }
                Action::Http { url: target, .. } => url.push(target.clone()),
                _ => {}
            }
        }
        for (key, list, separator) in [
            ("sql", sql, ";\n\n"),
            ("command", command, "\n"),
            ("url", url, "\n"),
        ] {
            if !list.is_empty() {
                details[key] = json!(list.join(separator));
            }
        }
        Some((title, steps.iter().any(|step| risky(&step.action)), details))
    }
}

pub async fn call(args: &Value, source: &str) -> Result<String, String> {
    let services = services()?;
    let plan = plan(&services, args).await?;
    apply(&services, plan, source).await
}

pub async fn plan(services: &Services, args: &Value) -> Result<Plan, String> {
    let store = &services.store;
    let action = text(args, "action");
    match action {
        "list" => Ok(Plan::Done(list(store).await?)),
        "get" => {
            let task = find(store, args).await?;
            Ok(Plan::Done(describe(store, &task).await?))
        }
        "connections" => Ok(Plan::Done(connections(store).await?)),
        "step_types" => Ok(Plan::Done(STEP_TYPES.into())),
        "validate" => {
            let task = match args.get("spec").filter(|spec| spec.is_object()) {
                Some(spec) => parse_task(spec.clone(), None)?,
                None => find(store, args).await?,
            };
            let issues = engine::validate(&task, &store.all_tasks().await?);
            Ok(Plan::Done(if issues.is_empty() {
                "Keine Probleme.".into()
            } else {
                issues_text(&issues)
            }))
        }
        "runs" => {
            let task_id = match text(args, "task") {
                "" => None,
                _ => Some(find(store, args).await?.id),
            };
            let limit = args["limit"].as_u64().unwrap_or(20).clamp(1, 200) as u32;
            let runs = store
                .list_runs(&RunFilter {
                    task_id,
                    limit: Some(limit),
                    ..RunFilter::default()
                })
                .await?;
            let lines: Vec<String> = runs
                .iter()
                .map(|run| {
                    format!(
                        "{}\t{}\t{}\t{}\t{}\t{}",
                        run.id,
                        run.task_name,
                        label(run.status),
                        run.started_at,
                        run.duration_ms
                            .map(|ms| format!("{ms} ms"))
                            .unwrap_or_default(),
                        run.error.clone().unwrap_or_default()
                    )
                })
                .collect();
            Ok(Plan::Done(format!(
                "{} runs\nid\tworkflow\tstatus\tstarted\tduration\terror\n{}",
                lines.len(),
                lines.join("\n")
            )))
        }
        "run_detail" => {
            let run = required(args, "run")?;
            let detail = store
                .get_run(run)
                .await?
                .ok_or_else(|| format!("Lauf '{run}' nicht gefunden."))?;
            Ok(Plan::Done(run_text(&detail)))
        }
        "create" => {
            let task = parse_task(Value::Object(spec(args)?.clone()), None)?;
            save_plan(store, None, task, "Workflow anlegen").await
        }
        "update" => {
            let current = find(store, args).await?;
            let mut value = serde_json::to_value(&current).map_err(|e| e.to_string())?;
            for (key, field) in spec(args)? {
                value[key] = field.clone();
            }
            let task = parse_task(value, Some(&current))?;
            save_plan(store, Some(current), task, "Workflow ändern").await
        }
        "add_step" => {
            let current = find(store, args).await?;
            let mut task = current.clone();
            let step = parse_step(Value::Object(spec(args)?.clone()))?;
            let list = match text(args, "parent") {
                "" => &mut task.steps,
                parent => {
                    let (list, index) = locate(&mut task.steps, parent)
                        .ok_or_else(|| format!("Loop-Schritt '{parent}' nicht gefunden."))?;
                    match &mut list[index].action {
                        Action::Loop { steps, .. } => steps,
                        _ => return Err(format!("Schritt '{parent}' ist kein Loop.")),
                    }
                }
            };
            let index = match text(args, "after") {
                "" => list.len(),
                "start" => 0,
                after => {
                    step_index(list, after)
                        .ok_or_else(|| format!("Schritt '{after}' nicht gefunden."))?
                        + 1
                }
            };
            list.insert(index, step);
            save_plan(store, Some(current), task, "Workflow ändern").await
        }
        "update_step" => {
            let current = find(store, args).await?;
            let mut task = current.clone();
            let target = required(args, "step")?;
            let (list, index) = locate(&mut task.steps, target)
                .ok_or_else(|| format!("Schritt '{target}' nicht gefunden."))?;
            let mut value = serde_json::to_value(&list[index]).map_err(|e| e.to_string())?;
            merge_step(&mut value, spec(args)?);
            list[index] = parse_step(value)?;
            save_plan(store, Some(current), task, "Workflow ändern").await
        }
        "remove_step" => {
            let current = find(store, args).await?;
            let mut task = current.clone();
            let target = required(args, "step")?;
            let (list, index) = locate(&mut task.steps, target)
                .ok_or_else(|| format!("Schritt '{target}' nicht gefunden."))?;
            list.remove(index);
            save_plan(store, Some(current), task, "Workflow ändern").await
        }
        "duplicate" => Ok(Plan::Duplicate(find(store, args).await?)),
        "delete" => Ok(Plan::Delete(find(store, args).await?)),
        "enable" => {
            let task = find(store, args).await?;
            if task.needs_review {
                return Err(
                    "Der Workflow wurde importiert und muss zuerst in l8db geprüft werden.".into(),
                );
            }
            let issues = engine::validate(&task, &store.all_tasks().await?);
            if issues.iter().any(|issue| issue.severity == Severity::Error) {
                return Err(format!(
                    "„{}“ hat ungelöste Fehler:\n{}",
                    task.name,
                    issues_text(&issues)
                ));
            }
            Ok(Plan::Enable(task, true))
        }
        "disable" => Ok(Plan::Enable(find(store, args).await?, false)),
        "run" => {
            let task = find(store, args).await?;
            let from_step = match text(args, "fromStep") {
                "" => None,
                step => Some(
                    task.steps[step_index(&task.steps, step)
                        .ok_or_else(|| format!("Schritt '{step}' nicht gefunden."))?]
                    .id
                    .clone(),
                ),
            };
            let vars: BTreeMap<String, String> = args["vars"]
                .as_object()
                .map(|vars| {
                    vars.iter()
                        .map(|(key, value)| {
                            let value = match value {
                                Value::String(text) => text.clone(),
                                other => other.to_string(),
                            };
                            (key.clone(), value)
                        })
                        .collect()
                })
                .unwrap_or_default();
            let environment = Some(text(args, "environment").trim().to_string())
                .filter(|environment| !environment.is_empty());
            Ok(Plan::Run {
                request: RunRequest {
                    task_id: task.id.clone(),
                    trigger: TriggerKind::Manual,
                    vars,
                    environment,
                    from_step,
                    ..RunRequest::default()
                },
                task,
                wait: args["wait"].as_bool().unwrap_or(true),
            })
        }
        "cancel" => Ok(Plan::Cancel(required(args, "run")?.to_string())),
        "" => Err("action fehlt".into()),
        other => Err(format!(
            "action '{other}' unbekannt. Möglich: {}",
            ACTIONS.join(", ")
        )),
    }
}

pub async fn apply(services: &Services, plan: Plan, source: &str) -> Result<String, String> {
    let store = &services.store;
    match plan {
        Plan::Done(text) => Ok(text),
        Plan::Save {
            task,
            revision,
            steps,
            ..
        } => {
            let saved = store.save_task(task, revision).await?;
            scheduler::reschedule(services, &saved.id).await;
            touched(services, source, "save", &saved.id, steps).await;
            Ok(format!(
                "Gespeichert. {}\n{}",
                describe(store, &saved).await?,
                "Die Änderung ist in l8db unter Automatisierung sichtbar."
            ))
        }
        Plan::Duplicate(task) => {
            let copy = store.duplicate_task(&task.id).await?;
            touched(services, source, "duplicate", &copy.id, Vec::new()).await;
            Ok(format!(
                "Kopie „{}“ angelegt (id {}, pausiert).",
                copy.name, copy.id
            ))
        }
        Plan::Delete(task) => {
            store.delete_tasks(std::slice::from_ref(&task.id)).await?;
            touched(services, source, "delete", &task.id, Vec::new()).await;
            Ok(format!("„{}“ gelöscht.", task.name))
        }
        Plan::Enable(task, enabled) => {
            store.set_enabled(&task.id, enabled, None).await?;
            scheduler::reschedule(services, &task.id).await;
            let action = if enabled { "enable" } else { "disable" };
            touched(services, source, action, &task.id, Vec::new()).await;
            Ok(format!(
                "„{}“ {}.",
                task.name,
                if enabled { "aktiviert" } else { "pausiert" }
            ))
        }
        Plan::Run {
            task,
            mut request,
            wait,
        } => {
            request.trigger_detail = Some(
                if source == "ai" {
                    "KI-Assistent"
                } else {
                    "MCP"
                }
                .into(),
            );
            let run_id = engine::start(services.clone(), request)
                .await
                .map_err(|error| error.to_string())?;
            touched(services, source, "run", &task.id, Vec::new()).await;
            if !wait {
                return Ok(format!(
                    "Lauf {run_id} gestartet. Ergebnis mit run_detail abfragen."
                ));
            }
            let started = Instant::now();
            loop {
                tokio::time::sleep(Duration::from_millis(400)).await;
                let detail = store.get_run(&run_id).await?;
                match detail {
                    Some(detail) if detail.summary.status != RunStatus::Running => {
                        touched(services, source, "run_finished", &task.id, Vec::new()).await;
                        return Ok(run_text(&detail));
                    }
                    _ if started.elapsed() > RUN_WAIT => {
                        return Ok(format!(
                            "Lauf {run_id} läuft noch. Ergebnis später mit run_detail abfragen."
                        ))
                    }
                    _ => {}
                }
            }
        }
        Plan::Cancel(run) => Ok(if engine::cancel(&run) {
            "Abbruch angefordert.".into()
        } else {
            format!("Lauf '{run}' läuft nicht in dieser l8db-Sitzung.")
        }),
    }
}

async fn touched(
    services: &Services,
    source: &str,
    action: &str,
    task_id: &str,
    steps: Vec<String>,
) {
    let entry = AiActivity {
        source: source.into(),
        action: action.into(),
        task_id: task_id.into(),
        step_ids: steps,
        ..AiActivity::default()
    };
    if let Err(error) = services.store.record_activity(entry).await {
        log::warn!("Automatisierung: {error}");
    }
    services.emit(AutomationEvent::TasksChanged {
        ids: vec![task_id.to_string()],
    });
}

async fn save_plan(
    store: &Store,
    previous: Option<Task>,
    mut task: Task,
    title: &'static str,
) -> Result<Plan, String> {
    task.needs_review = previous.as_ref().is_some_and(|task| task.needs_review);
    let all = store.all_tasks().await?;
    let errors = |task: &Task| -> Vec<ValidationIssue> {
        engine::validate(task, &all)
            .into_iter()
            .filter(|issue| issue.severity == Severity::Error)
            .collect()
    };
    let known: HashSet<(Option<String>, String)> = previous
        .as_ref()
        .map(|previous| {
            errors(previous)
                .into_iter()
                .map(|issue| (issue.step_id, issue.field))
                .collect()
        })
        .unwrap_or_default();
    let fresh: Vec<ValidationIssue> = errors(&task)
        .into_iter()
        .filter(|issue| !known.contains(&(issue.step_id.clone(), issue.field.clone())))
        .collect();
    if !fresh.is_empty() {
        return Err(format!(
            "Nicht gespeichert, bitte korrigieren:\n{}",
            issues_text(&fresh)
        ));
    }
    let mut before = Vec::new();
    if let Some(previous) = &previous {
        flatten(&previous.steps, &mut before);
    }
    let mut after = Vec::new();
    flatten(&task.steps, &mut after);
    let steps = after
        .into_iter()
        .filter(|step| !before.iter().any(|old| old == step))
        .map(|step| step.id.clone())
        .collect();
    Ok(Plan::Save {
        revision: previous.map(|previous| previous.revision),
        task,
        title,
        steps,
    })
}

fn risky(action: &Action) -> bool {
    matches!(
        action,
        Action::Restore { .. }
            | Action::Datagen { .. }
            | Action::FileMove { .. }
            | Action::FileDelete { .. }
            | Action::Unzip { .. }
            | Action::Cleanup { .. }
            | Action::Http { .. }
            | Action::Shell { .. }
    )
}

fn flatten<'a>(steps: &'a [Step], out: &mut Vec<&'a Step>) {
    for step in steps {
        out.push(step);
        if let Action::Loop { steps, .. } = &step.action {
            flatten(steps, out);
        }
    }
}

fn step_index(steps: &[Step], target: &str) -> Option<usize> {
    let target = target.trim();
    steps
        .iter()
        .position(|step| step.id == target)
        .or_else(|| {
            target
                .parse::<usize>()
                .ok()
                .filter(|number| (1..=steps.len()).contains(number))
                .map(|number| number - 1)
        })
        .or_else(|| {
            steps
                .iter()
                .position(|step| step.name.eq_ignore_ascii_case(target))
        })
}

fn locate<'a>(steps: &'a mut Vec<Step>, target: &str) -> Option<(&'a mut Vec<Step>, usize)> {
    if let Some(index) = step_index(steps, target) {
        return Some((steps, index));
    }
    for step in steps.iter_mut() {
        if let Action::Loop { steps, .. } = &mut step.action {
            if let Some(found) = locate(steps, target) {
                return Some(found);
            }
        }
    }
    None
}

fn merge_step(step: &mut Value, patch: &Map<String, Value>) {
    for (key, field) in patch {
        if key == "id" {
            continue;
        }
        if key == "action" {
            let same = field
                .get("type")
                .is_none_or(|kind| *kind == step["action"]["type"]);
            if let (true, Some(source), Some(target)) =
                (same, field.as_object(), step["action"].as_object_mut())
            {
                for (name, value) in source {
                    target.insert(name.clone(), value.clone());
                }
                continue;
            }
        }
        step[key] = field.clone();
    }
}

fn fill_id(item: &mut Value) {
    if let Some(object) = item.as_object_mut() {
        if object
            .get("id")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            object.insert("id".into(), json!(new_id()));
        }
    }
}

fn fill_steps(steps: &mut Value) {
    let Some(items) = steps.as_array_mut() else {
        return;
    };
    for item in items {
        fill_id(item);
        if let Some(object) = item.as_object_mut() {
            object.entry("name").or_insert(json!(""));
            if let Some(nested) = object
                .get_mut("action")
                .and_then(|action| action.get_mut("steps"))
            {
                fill_steps(nested);
            }
        }
    }
}

fn parse_step(value: Value) -> Result<Step, String> {
    let mut list = json!([value]);
    fill_steps(&mut list);
    serde_json::from_value(list[0].take())
        .map_err(|error| format!("Ungültiger Schritt: {error}. step_types zeigt das Format."))
}

fn parse_task(mut value: Value, previous: Option<&Task>) -> Result<Task, String> {
    let object = value.as_object_mut().ok_or("spec muss ein Objekt sein")?;
    match previous {
        Some(previous) => {
            object.insert("id".into(), json!(previous.id));
            object.insert("revision".into(), json!(previous.revision));
            object.insert("createdAt".into(), json!(previous.created_at));
        }
        None => {
            object.insert("id".into(), json!(new_id()));
            object.remove("revision");
            object.remove("createdAt");
        }
    }
    if let Some(steps) = object.get_mut("steps") {
        fill_steps(steps);
    }
    for key in ["schedules", "notifications"] {
        if let Some(items) = object.get_mut(key).and_then(Value::as_array_mut) {
            items.iter_mut().for_each(fill_id);
        }
    }
    serde_json::from_value(value).map_err(|error| {
        format!("Ungültige Workflow-Definition: {error}. step_types zeigt das Format.")
    })
}

fn text<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or("")
}

fn required<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    Some(text(args, key).trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{key} fehlt"))
}

fn spec(args: &Value) -> Result<&Map<String, Value>, String> {
    args.get("spec")
        .and_then(Value::as_object)
        .ok_or_else(|| "spec fehlt oder ist kein Objekt".into())
}

async fn find(store: &Store, args: &Value) -> Result<Task, String> {
    store
        .find_task(required(args, "task")?)
        .await
        .map_err(|error| format!("{error} list zeigt alle Workflows."))
}

fn label(value: impl Serialize) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn issues_text(issues: &[ValidationIssue]) -> String {
    issues
        .iter()
        .map(|issue| {
            format!(
                "- {}{} ({}): {}",
                if issue.severity == Severity::Error {
                    "Fehler"
                } else {
                    "Hinweis"
                },
                issue
                    .step_id
                    .as_ref()
                    .map(|step| format!(" in Schritt {step}"))
                    .unwrap_or_default(),
                issue.field,
                issue.message
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn list(store: &Store) -> Result<String, String> {
    let tasks = store.list_tasks().await?;
    let lines: Vec<String> = tasks
        .iter()
        .map(|summary| {
            let task = &summary.task;
            format!(
                "{}\t{}\t{}\t{}\t{}\t{}\t{}",
                task.id,
                task.name,
                if summary.running_run_id.is_some() {
                    "läuft"
                } else if task.enabled {
                    "aktiv"
                } else {
                    "pausiert"
                },
                task.steps.len(),
                task.schedules.len(),
                summary.state.last_status.map(label).unwrap_or_default(),
                summary.state.next_run_at.clone().unwrap_or_default()
            )
        })
        .collect();
    Ok(format!(
        "{} workflows\nid\tname\tstate\tsteps\tschedules\tlast run\tnext run\n{}",
        lines.len(),
        lines.join("\n")
    ))
}

async fn describe(store: &Store, task: &Task) -> Result<String, String> {
    let all = store.all_tasks().await?;
    let issues = engine::validate(task, &all);
    let next: Vec<String> = task
        .schedules
        .iter()
        .filter(|schedule| schedule.enabled)
        .filter_map(|schedule| schedule::next_runs(schedule, chrono::Utc::now(), 3).ok())
        .flatten()
        .map(crate::automation::runtime::rfc3339)
        .collect();
    let mut definition = serde_json::to_value(task).map_err(|e| e.to_string())?;
    if let Some(object) = definition.as_object_mut() {
        for key in ["createdAt", "updatedAt", "needsReview"] {
            object.remove(key);
        }
    }
    Ok(format!(
        "„{}“ (id {}, revision {}, {})\nNext runs: {}\n{}\n{}",
        task.name,
        task.id,
        task.revision,
        if task.enabled { "aktiv" } else { "pausiert" },
        if next.is_empty() {
            "keine".into()
        } else {
            next.join(", ")
        },
        if issues.is_empty() {
            "Keine Probleme.".into()
        } else {
            issues_text(&issues)
        },
        definition
    ))
}

async fn connections(store: &Store) -> Result<String, String> {
    let list = store.connections().await?;
    let lines: Vec<String> = list
        .iter()
        .map(|connection| {
            format!(
                "{}\t{}\t{}\t{}\t{}\t{}",
                connection.id,
                connection.name,
                label(connection.kind),
                connection.environment.as_deref().unwrap_or("-"),
                if connection.read_only {
                    "read-only"
                } else {
                    "read-write"
                },
                connection.tags.join(",")
            )
        })
        .collect();
    Ok(format!(
        "{} connections\nid\tname\tkind\tenvironment\taccess\ttags\n{}",
        lines.len(),
        lines.join("\n")
    ))
}

fn run_text(detail: &RunDetail) -> String {
    let summary = &detail.summary;
    let mut out = format!(
        "Lauf {} von „{}“: {}{}",
        summary.id,
        summary.task_name,
        label(summary.status),
        summary
            .duration_ms
            .map(|ms| format!(" nach {ms} ms"))
            .unwrap_or_default()
    );
    if let Some(error) = &summary.error {
        out.push_str(&format!("\nFehler: {error}"));
    }
    for step in &detail.steps {
        let mut facts = Vec::new();
        if let Some(rows) = step.rows {
            facts.push(format!("{rows} rows"));
        }
        if let Some(rows) = step.rows_affected {
            facts.push(format!("{rows} affected"));
        }
        if let Some(message) = &step.message {
            facts.push(message.clone());
        }
        if let Some(error) = &step.error {
            facts.push(format!("error: {error}"));
        }
        out.push_str(&format!(
            "\n{}{}. {} [{}] {}{}",
            "  ".repeat(step.depth as usize),
            step.seq,
            step.step_name,
            step.kind,
            label(step.status),
            if facts.is_empty() {
                String::new()
            } else {
                format!(" – {}", facts.join(", "))
            }
        ));
    }
    for output in &detail.outputs {
        out.push_str(&format!("\nAusgabe: {}", output.path));
    }
    let logs: Vec<String> = detail
        .logs
        .iter()
        .rev()
        .take(LOG_LINES)
        .rev()
        .map(|line| format!("{} {}: {}", line.at, label(line.level), line.message))
        .collect();
    if !logs.is_empty() {
        out.push_str(&format!("\nLog:\n{}", logs.join("\n")));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, Services) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("automation.db")).unwrap();
        (dir, Services::new(store, Arc::new(|_| {}), true))
    }

    async fn act(services: &Services, args: Value) -> Result<String, String> {
        let plan = plan(services, &args).await?;
        apply(services, plan, "mcp").await
    }

    #[tokio::test]
    async fn builds_edits_and_records_activity() {
        let (_dir, services) = fixture();
        act(
            &services,
            json!({"action": "create", "spec": {"name": "Nightly", "enabled": false, "steps": [
                {"name": "Hallo", "action": {"type": "log", "message": "start"}}
            ]}}),
        )
        .await
        .unwrap();
        let task = services.store.find_task("nightly").await.unwrap();
        assert_eq!(task.steps.len(), 1);
        assert!(!task.steps[0].id.is_empty());

        act(
            &services,
            json!({"action": "add_step", "task": "Nightly", "after": "start", "spec": {"name": "Zuerst", "action": {"type": "log", "message": "a"}}}),
        )
        .await
        .unwrap();
        act(
            &services,
            json!({"action": "update_step", "task": "Nightly", "step": "2", "spec": {"action": {"message": "geändert"}}}),
        )
        .await
        .unwrap();
        let task = services.store.find_task("Nightly").await.unwrap();
        assert_eq!(task.steps[0].name, "Zuerst");
        assert!(
            matches!(&task.steps[1].action, Action::Log { message, .. } if message == "geändert")
        );

        let activity = services.store.activity(0).await.unwrap();
        assert_eq!(activity.len(), 3);
        assert_eq!(activity[2].step_ids, vec![task.steps[1].id.clone()]);
        assert!(activity.windows(2).all(|pair| pair[0].seq < pair[1].seq));
        assert_eq!(
            services
                .store
                .activity(activity[1].seq)
                .await
                .unwrap()
                .len(),
            1
        );

        act(
            &services,
            json!({"action": "remove_step", "task": "Nightly", "step": "Zuerst"}),
        )
        .await
        .unwrap();
        assert_eq!(
            services
                .store
                .find_task("Nightly")
                .await
                .unwrap()
                .steps
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn rejects_new_errors_and_flags_risky_steps() {
        let (_dir, services) = fixture();
        let error = act(
            &services,
            json!({"action": "create", "spec": {"name": "Kaputt", "steps": [
                {"name": "Springen", "action": {"type": "log", "message": "x"}, "onSuccess": {"type": "goto", "stepId": "fehlt"}}
            ]}}),
        )
        .await
        .unwrap_err();
        assert!(error.starts_with("Nicht gespeichert"), "{error}");
        assert!(services.store.find_task("Kaputt").await.is_err());

        let plan = plan(
            &services,
            &json!({"action": "create", "spec": {"name": "Shell", "steps": [
                {"name": "ls", "action": {"type": "shell", "program": "ls", "args": ["-la"]}}
            ]}}),
        )
        .await
        .unwrap();
        let (_, risky, details) = plan.approval().unwrap();
        assert!(risky);
        assert_eq!(details["command"], "ls -la");
    }
}
