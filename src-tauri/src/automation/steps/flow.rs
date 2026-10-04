use std::collections::BTreeMap;
use std::time::Duration;

use chrono::{Local, NaiveTime};

use crate::automation::engine;
use crate::automation::model::{
    Action, LogLevel, LoopSource, RunStatus, TriggerKind, VarQueryMode,
};
use crate::automation::runtime::{RunRequest, StepContext, StepOutcome};
use crate::automation::steps::{cell, first_cell, open, resolve_path, wrong_action};
use crate::automation::vars::{calculate, compare, format_number, value_text};

const MAX_WAIT: u64 = 24 * 3600;
const MAX_LOOP_ROWS: usize = 10_000;

fn cancelled() -> String {
    "Abgebrochen.".into()
}

fn seconds_until(until: &str) -> Result<u64, String> {
    let time = NaiveTime::parse_from_str(until.trim(), "%H:%M")
        .map_err(|_| format!("Ungültige Uhrzeit „{until}“ (erwartet HH:MM)."))?;
    let now = Local::now();
    let today = now.date_naive().and_time(time);
    let target = if today > now.naive_local() {
        today
    } else {
        today + chrono::Duration::days(1)
    };
    Ok((target - now.naive_local()).num_seconds().max(0) as u64)
}

pub async fn wait(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Wait { seconds, until } = config else {
        return Err(wrong_action());
    };
    let total = match (seconds, until.as_deref().filter(|u| !u.trim().is_empty())) {
        (_, Some(until)) => seconds_until(&ctx.vars.render(until)?)?,
        (Some(seconds), None) => *seconds,
        (None, None) => return Err("Wartezeit fehlt.".into()),
    };
    if total > MAX_WAIT {
        return Err("Wartezeit ist länger als 24 Stunden.".into());
    }
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_secs(total)) => Ok(StepOutcome {
            message: Some(format!("{total} s gewartet")),
            ..StepOutcome::default()
        }),
        _ = ctx.cancel.cancelled() => Err(cancelled()),
    }
}

pub async fn set_variable(
    ctx: &mut StepContext<'_>,
    config: &Action,
) -> Result<StepOutcome, String> {
    let Action::SetVariable {
        name,
        value,
        query,
        calculate: calc,
    } = config
    else {
        return Err(wrong_action());
    };
    if !crate::automation::vars::valid_name(name) {
        return Err(format!("Ungültiger Variablenname „{name}“."));
    }
    let mut outcome = StepOutcome::default();
    let mut result = match query {
        Some(query) => {
            let (resolved, adapter) =
                open(ctx, &query.connection, query.database.as_deref()).await?;
            let sql = ctx.vars.render_sql(&query.sql, resolved.kind)?;
            let data = adapter
                .execute_query(&sql)
                .await
                .map_err(|error| format!("{}: {error}", resolved.name))?;
            outcome.rows = Some(data.rows.len() as u64);
            match query.mode {
                VarQueryMode::FirstValue => first_cell(&data)
                    .as_ref()
                    .map(value_text)
                    .unwrap_or_default(),
                VarQueryMode::RowCount => data.rows.len().to_string(),
                VarQueryMode::ColumnList => data
                    .rows
                    .iter()
                    .map(|row| {
                        value_text(&cell(
                            row,
                            data.columns.first().map_or("", String::as_str),
                            0,
                        ))
                    })
                    .collect::<Vec<_>>()
                    .join(query.separator.as_deref().unwrap_or(",")),
                VarQueryMode::Json => {
                    serde_json::to_string(&data.rows).map_err(|e| e.to_string())?
                }
            }
        }
        None => ctx.vars.render(value)?,
    };
    if *calc {
        result = format_number(calculate(&result)?);
    }
    outcome.value = Some(serde_json::Value::String(result.clone()));
    outcome.vars.insert(name.clone(), result);
    Ok(outcome)
}

pub async fn condition(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Condition {
        left,
        op,
        right,
        then,
        otherwise,
    } = config
    else {
        return Err(wrong_action());
    };
    let left = ctx.vars.render(left)?;
    let right = ctx.vars.render(right)?;
    let matched = compare(&left, *op, &right)?;
    Ok(StepOutcome {
        value: Some(serde_json::Value::Bool(matched)),
        flow: Some(if matched {
            then.clone()
        } else {
            otherwise.clone()
        }),
        message: Some(
            if matched {
                "Bedingung erfüllt"
            } else {
                "Bedingung nicht erfüllt"
            }
            .into(),
        ),
        ..StepOutcome::default()
    })
}

struct Item {
    value: String,
    fields: BTreeMap<String, String>,
}

fn wildcard(pattern: &str) -> Result<regex::Regex, String> {
    let mut expression = String::from("^");
    for c in pattern.chars() {
        match c {
            '*' => expression.push_str(".*"),
            '?' => expression.push('.'),
            other => expression.push_str(&regex::escape(&other.to_string())),
        }
    }
    expression.push('$');
    regex::Regex::new(&expression).map_err(|error| error.to_string())
}

async fn loop_items(ctx: &mut StepContext<'_>, over: &LoopSource) -> Result<Vec<Item>, String> {
    Ok(match over {
        LoopSource::Query {
            connection,
            database,
            sql,
        } => {
            let (resolved, adapter) = open(ctx, connection, database.as_deref()).await?;
            let sql = ctx.vars.render_sql(sql, resolved.kind)?;
            let data = adapter
                .execute_query(&sql)
                .await
                .map_err(|error| format!("{}: {error}", resolved.name))?;
            if data.rows.len() > MAX_LOOP_ROWS {
                return Err(format!(
                    "Schleifenquelle hat mehr als {MAX_LOOP_ROWS} Zeilen."
                ));
            }
            data.rows
                .iter()
                .map(|row| Item {
                    value: first_cell_of(row, &data.columns),
                    fields: data
                        .columns
                        .iter()
                        .enumerate()
                        .map(|(index, column)| {
                            (column.clone(), value_text(&cell(row, column, index)))
                        })
                        .collect(),
                })
                .collect()
        }
        LoopSource::Connections { connections, tag } => {
            let all = ctx.services.store.connections().await?;
            let tag = tag.as_deref().map(str::trim).filter(|t| !t.is_empty());
            let mut selected = Vec::new();
            for reference in connections {
                let reference = ctx.vars.render(reference)?;
                let found = all
                    .iter()
                    .find(|c| c.id == reference)
                    .or_else(|| all.iter().find(|c| c.name.eq_ignore_ascii_case(&reference)))
                    .ok_or_else(|| {
                        format!(
                            "Verbindung „{reference}“ ist für die Automatisierung nicht verfügbar."
                        )
                    })?;
                selected.push(found.clone());
            }
            if let Some(tag) = tag {
                selected.extend(
                    all.iter()
                        .filter(|c| c.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)))
                        .cloned(),
                );
            }
            let mut seen = std::collections::HashSet::new();
            selected
                .into_iter()
                .filter(|c| seen.insert(c.id.clone()))
                .map(|c| Item {
                    value: c.id.clone(),
                    fields: BTreeMap::from([
                        ("id".to_string(), c.id),
                        ("name".to_string(), c.name),
                        ("environment".to_string(), c.environment.unwrap_or_default()),
                    ]),
                })
                .collect()
        }
        LoopSource::List { values } => {
            let rendered = ctx.vars.render(values)?;
            let parts: Vec<&str> = if rendered.contains('\n') {
                rendered.lines().collect()
            } else {
                rendered.split(',').collect()
            };
            parts
                .into_iter()
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .map(|part| Item {
                    value: part.to_string(),
                    fields: BTreeMap::new(),
                })
                .collect()
        }
        LoopSource::Files { dir, pattern } => {
            let dir = resolve_path(ctx, dir).await?;
            let matcher = wildcard(&ctx.vars.render(pattern)?)?;
            let mut entries = tokio::fs::read_dir(&dir).await.map_err(|error| {
                format!(
                    "Ordner {} konnte nicht gelesen werden: {error}",
                    dir.display()
                )
            })?;
            let mut files = Vec::new();
            while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
                let name = entry.file_name().to_string_lossy().into_owned();
                if matcher.is_match(&name) && entry.file_type().await.is_ok_and(|t| t.is_file()) {
                    files.push((entry.path(), name));
                }
            }
            files.sort();
            files
                .into_iter()
                .map(|(path, name)| Item {
                    value: path.to_string_lossy().into_owned(),
                    fields: BTreeMap::from([("name".to_string(), name)]),
                })
                .collect()
        }
    })
}

fn first_cell_of(row: &serde_json::Value, columns: &[String]) -> String {
    value_text(&cell(row, columns.first().map_or("", String::as_str), 0))
}

pub async fn run_loop(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Loop {
        over,
        steps,
        item,
        max_iterations,
        continue_on_error,
    } = config
    else {
        return Err(wrong_action());
    };
    let items = loop_items(ctx, over).await?;
    let limit = max_iterations.unwrap_or(MAX_LOOP_ROWS as u32) as usize;
    if items.len() > limit {
        return Err(format!(
            "Schleife hat {} Elemente, erlaubt sind höchstens {limit}.",
            items.len()
        ));
    }
    let prefix = if item.trim().is_empty() {
        "item"
    } else {
        item.trim()
    };
    let mut failures = 0usize;
    for (index, entry) in items.iter().enumerate() {
        if ctx.cancel.is_cancelled() {
            return Err(cancelled());
        }
        ctx.vars.set(prefix, entry.value.clone());
        ctx.vars
            .set(&format!("{prefix}.index"), (index + 1).to_string());
        for (field, value) in &entry.fields {
            ctx.vars.set(&format!("{prefix}.{field}"), value.clone());
        }
        if let Err(error) = engine::run_nested(ctx, steps, index as u32 + 1).await {
            if ctx.cancel.is_cancelled() || !continue_on_error {
                return Err(format!("Durchlauf {}: {error}", index + 1));
            }
            failures += 1;
            (ctx.log)(LogLevel::Warn, format!("Durchlauf {}: {error}", index + 1));
        }
    }
    Ok(StepOutcome {
        rows: Some(items.len() as u64),
        warning: (failures > 0)
            .then(|| format!("{failures} von {} Durchläufen fehlgeschlagen.", items.len())),
        ..StepOutcome::default()
    })
}

pub async fn run_task(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::RunTask {
        task,
        wait,
        vars,
        environment,
    } = config
    else {
        return Err(wrong_action());
    };
    let reference = ctx.vars.render(task)?;
    let target = ctx
        .services
        .store
        .find_task(&reference)
        .await
        .map_err(|error| error.to_string())?;
    let path = engine::call_path(ctx.run_id);
    if path.contains(&target.id) {
        return Err(format!(
            "Zyklus: Task „{}“ ist bereits im Aufrufpfad.",
            target.name
        ));
    }
    let mut rendered = BTreeMap::new();
    for (name, value) in vars {
        rendered.insert(name.clone(), ctx.vars.render(value)?);
    }
    let environment = match environment.as_deref().filter(|e| !e.trim().is_empty()) {
        Some(env) => Some(ctx.vars.render(env)?),
        None => None,
    };
    let request = RunRequest {
        task_id: target.id.clone(),
        trigger: TriggerKind::RunTask,
        trigger_detail: Some(ctx.task.name.clone()),
        vars: rendered,
        environment,
        parent_run_id: Some(ctx.run_id.to_string()),
        depth: engine::depth(ctx.run_id).saturating_add(1),
        ..RunRequest::default()
    };
    if !*wait {
        let run_id = engine::start(ctx.services.clone(), request)
            .await
            .map_err(|error| error.to_string())?;
        return Ok(StepOutcome {
            value: Some(serde_json::Value::String(run_id.clone())),
            message: Some(format!("„{}“ gestartet ({run_id})", target.name)),
            ..StepOutcome::default()
        });
    }
    let summary = Box::pin(engine::execute(ctx.services.clone(), request))
        .await
        .map_err(|error| error.to_string())?;
    if !matches!(summary.status, RunStatus::Success | RunStatus::Warning) {
        let status = serde_json::to_value(summary.status)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default();
        return Err(format!(
            "Task „{}“ endete mit Status „{status}“{}",
            target.name,
            summary.error.map(|e| format!(": {e}")).unwrap_or_default()
        ));
    }
    Ok(StepOutcome {
        value: Some(serde_json::Value::String(summary.id.clone())),
        warning: (summary.status == RunStatus::Warning)
            .then(|| format!("Task „{}“ endete mit Warnungen.", target.name)),
        ..StepOutcome::default()
    })
}

pub async fn log(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Log { level, message } = config else {
        return Err(wrong_action());
    };
    let message = ctx.vars.render(message)?;
    (ctx.log)(*level, message.clone());
    Ok(StepOutcome {
        message: Some(message),
        ..StepOutcome::default()
    })
}

pub async fn fail(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Fail { message } = config else {
        return Err(wrong_action());
    };
    Err(ctx.vars.render(message).unwrap_or_else(|_| message.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcard_matches_last_segment() {
        let re = wildcard("report-*.csv").unwrap();
        assert!(re.is_match("report-2026.csv"));
        assert!(!re.is_match("report-2026.csv.bak"));
        assert!(wildcard("a?c").unwrap().is_match("abc"));
        assert!(!wildcard("a.c").unwrap().is_match("abc"));
    }

    #[test]
    fn until_is_within_a_day() {
        let seconds = seconds_until("00:00").unwrap();
        assert!(seconds <= 24 * 3600);
        assert!(seconds_until("25:00").is_err());
    }
}
