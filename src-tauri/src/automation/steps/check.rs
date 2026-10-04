use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};

use crate::automation::engine;
use crate::automation::model::{
    Action, AlertStatus, CheckSpec, Comparator, LogLevel, NotifyWhen, Severity,
};
use crate::automation::runtime::{rfc3339, AutomationEvent, StepContext, StepOutcome};
use crate::automation::steps::{first_cell, open, wrong_action};
use crate::automation::vars::{compare, format_number, sql_literal, value_text};
use crate::db::import::Dialect;
use crate::db::DatabaseAdapter;

fn op_text(op: Comparator) -> &'static str {
    match op {
        Comparator::Eq => "=",
        Comparator::Ne => "≠",
        Comparator::Gt => ">",
        Comparator::Gte => "≥",
        Comparator::Lt => "<",
        Comparator::Lte => "≤",
        Comparator::Contains => "enthält",
        Comparator::NotContains => "enthält nicht",
        Comparator::Matches => "passt auf",
        Comparator::Empty => "leer",
        Comparator::NotEmpty => "nicht leer",
    }
}

fn table(dialect: Dialect, schema: &str, table: &str) -> String {
    if schema.trim().is_empty() {
        dialect.quote(table)
    } else {
        format!("{}.{}", dialect.quote(schema), dialect.quote(table))
    }
}

async fn scalar(adapter: &dyn DatabaseAdapter, name: &str, sql: &str) -> Result<String, String> {
    let result = adapter
        .execute_query(sql)
        .await
        .map_err(|error| format!("{name}: {error}"))?;
    Ok(first_cell(&result)
        .as_ref()
        .map(value_text)
        .unwrap_or_default())
}

async fn count(adapter: &dyn DatabaseAdapter, name: &str, sql: &str) -> Result<u64, String> {
    let text = scalar(adapter, name, sql).await?;
    text.trim()
        .parse::<f64>()
        .map(|value| value as u64)
        .map_err(|_| format!("Unerwartetes Zählergebnis „{text}“."))
}

pub fn parse_timestamp(text: &str) -> Option<DateTime<Utc>> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(at) = DateTime::parse_from_rfc3339(text) {
        return Some(at.with_timezone(&Utc));
    }
    for format in ["%Y-%m-%d %H:%M:%S%.f%#z", "%Y-%m-%d %H:%M:%S%#z"] {
        if let Ok(at) = DateTime::parse_from_str(text, format) {
            return Some(at.with_timezone(&Utc));
        }
    }
    for format in [
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(at) = NaiveDateTime::parse_from_str(text, format) {
            return Some(at.and_utc());
        }
    }
    if let Ok(date) = NaiveDate::parse_from_str(text, "%Y-%m-%d") {
        return date.and_hms_opt(0, 0, 0).map(|at| at.and_utc());
    }
    let number = text.parse::<f64>().ok()?;
    let seconds = if number > 1e11 {
        number / 1000.0
    } else {
        number
    };
    DateTime::from_timestamp(seconds as i64, 0)
}

pub async fn check(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Check {
        connection,
        database,
        check,
        severity,
    } = config
    else {
        return Err(wrong_action());
    };
    let (resolved, adapter) = open(ctx, connection, database.as_deref()).await?;
    let dialect = Dialect::from_kind(resolved.kind)
        .ok_or("Prüfung für diesen Datenbanktyp nicht verfügbar.")?;
    let kind = resolved.kind;
    let name = resolved.name.clone();
    let adapter = adapter.as_ref();
    let mut warning_only = false;
    let (actual, violation) = match check {
        CheckSpec::RowCount {
            schema,
            table: target,
            sql,
            op,
            value,
        } => {
            let query = match sql.as_deref().filter(|s| !s.trim().is_empty()) {
                Some(sql) => format!(
                    "SELECT COUNT(*) FROM ({}) q",
                    ctx.vars
                        .render_sql(sql.trim().trim_end_matches(';'), kind)?
                ),
                None => {
                    let target = target
                        .as_deref()
                        .filter(|t| !t.trim().is_empty())
                        .ok_or("Tabelle oder SQL fehlt.")?;
                    format!(
                        "SELECT COUNT(*) FROM {}",
                        table(dialect, schema.as_deref().unwrap_or_default(), target)
                    )
                }
            };
            let rows = count(adapter, &name, &query).await?;
            let expected = format_number(*value);
            let ok = compare(&rows.to_string(), *op, &expected)?;
            (
                rows.to_string(),
                (!ok).then(|| {
                    format!(
                        "Zeilenzahl {rows} erfüllt nicht „{} {expected}“.",
                        op_text(*op)
                    )
                }),
            )
        }
        CheckSpec::Value {
            sql,
            op,
            value,
            tolerance,
        } => {
            let actual = scalar(adapter, &name, &ctx.vars.render_sql(sql, kind)?).await?;
            let expected = ctx.vars.render(value)?;
            let numbers = actual
                .trim()
                .parse::<f64>()
                .ok()
                .zip(expected.trim().parse::<f64>().ok());
            let ok = match (tolerance, numbers, op) {
                (Some(tol), Some((a, b)), Comparator::Eq) => (a - b).abs() <= *tol,
                (Some(tol), Some((a, b)), Comparator::Ne) => (a - b).abs() > *tol,
                _ => compare(&actual, *op, &expected)?,
            };
            let tolerance_text = tolerance
                .map(|tol| format!(" ± {}", format_number(tol)))
                .unwrap_or_default();
            (
                actual.clone(),
                (!ok).then(|| {
                    format!(
                        "Wert „{actual}“ erfüllt nicht „{} {expected}{tolerance_text}“.",
                        op_text(*op)
                    )
                }),
            )
        }
        CheckSpec::NotNull {
            schema,
            table: target,
            column,
        } => {
            let nulls = count(
                adapter,
                &name,
                &format!(
                    "SELECT COUNT(*) FROM {} WHERE {} IS NULL",
                    table(dialect, schema, target),
                    dialect.quote(column)
                ),
            )
            .await?;
            (
                nulls.to_string(),
                (nulls > 0).then(|| format!("{nulls} Zeilen mit NULL in „{column}“ (erwartet 0).")),
            )
        }
        CheckSpec::Unique {
            schema,
            table: target,
            columns,
        } => {
            if columns.is_empty() {
                return Err("Keine Spalten für die Eindeutigkeitsprüfung angegeben.".into());
            }
            let list = columns
                .iter()
                .map(|c| dialect.quote(c))
                .collect::<Vec<_>>()
                .join(", ");
            let duplicates = count(
                adapter,
                &name,
                &format!(
                    "SELECT COUNT(*) FROM (SELECT {list} FROM {} GROUP BY {list} HAVING COUNT(*) > 1) d",
                    table(dialect, schema, target)
                ),
            )
            .await?;
            (
                duplicates.to_string(),
                (duplicates > 0).then(|| {
                    format!(
                        "{duplicates} doppelte Werte in „{}“ (erwartet 0).",
                        columns.join(", ")
                    )
                }),
            )
        }
        CheckSpec::AcceptedValues {
            schema,
            table: target,
            column,
            values,
        } => {
            if values.is_empty() {
                return Err("Keine erlaubten Werte angegeben.".into());
            }
            let literals = values
                .iter()
                .map(|value| format!("'{}'", sql_literal(value, Some(kind))))
                .collect::<Vec<_>>()
                .join(", ");
            let invalid = count(
                adapter,
                &name,
                &format!(
                    "SELECT COUNT(*) FROM {} WHERE {col} IS NOT NULL AND {col} NOT IN ({literals})",
                    table(dialect, schema, target),
                    col = dialect.quote(column)
                ),
            )
            .await?;
            (
                invalid.to_string(),
                (invalid > 0).then(|| {
                    format!(
                        "{invalid} Zeilen mit nicht erlaubten Werten in „{column}“ (erlaubt: {}).",
                        values.join(", ")
                    )
                }),
            )
        }
        CheckSpec::Freshness {
            schema,
            table: target,
            column,
            warn_after_minutes,
            error_after_minutes,
        } => {
            let latest = scalar(
                adapter,
                &name,
                &format!(
                    "SELECT MAX({}) FROM {}",
                    dialect.quote(column),
                    table(dialect, schema, target)
                ),
            )
            .await?;
            match parse_timestamp(&latest) {
                None if latest.trim().is_empty() => (
                    String::new(),
                    Some(format!("Keine Zeitstempel in „{column}“ vorhanden.")),
                ),
                None => {
                    return Err(format!(
                        "Zeitstempel „{latest}“ in „{column}“ kann nicht gelesen werden."
                    ))
                }
                Some(at) => {
                    let age = (Utc::now() - at).num_minutes().max(0);
                    let actual = rfc3339(at);
                    if age > *error_after_minutes as i64 {
                        (
                            actual,
                            Some(format!(
                                "Neuester Eintrag ist {age} Minuten alt (erlaubt: {error_after_minutes})."
                            )),
                        )
                    } else if warn_after_minutes.is_some_and(|warn| age > warn as i64) {
                        warning_only = true;
                        (
                            actual,
                            Some(format!(
                                "Neuester Eintrag ist {age} Minuten alt (Warnung ab {}).",
                                warn_after_minutes.unwrap_or_default()
                            )),
                        )
                    } else {
                        (actual, None)
                    }
                }
            }
        }
        CheckSpec::Query { sql } => {
            let result = adapter
                .execute_query(&ctx.vars.render_sql(sql, kind)?)
                .await
                .map_err(|error| format!("{name}: {error}"))?;
            let rows = result.rows.len();
            (
                rows.to_string(),
                (rows > 0).then(|| format!("Prüfabfrage lieferte {rows} Verstöße (erwartet 0).")),
            )
        }
    };
    let mut outcome = StepOutcome {
        value: Some(serde_json::Value::String(actual)),
        ..StepOutcome::default()
    };
    match violation {
        None => {
            outcome.message = Some("Prüfung bestanden".into());
            Ok(outcome)
        }
        Some(message) if warning_only || *severity == Severity::Warning => {
            outcome.warning = Some(message);
            Ok(outcome)
        }
        Some(message) => Err(message),
    }
}

fn status_text(status: AlertStatus) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

pub async fn alert(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Alert {
        connection,
        database,
        sql,
        condition,
        rearm_minutes,
        notify_on_resolve,
    } = config
    else {
        return Err(wrong_action());
    };
    let (resolved, adapter) = open(ctx, connection, database.as_deref()).await?;
    let query = ctx.vars.render_sql(sql, resolved.kind)?;
    let result = adapter.execute_query(&query).await;
    let evaluation = crate::automation::alerts::evaluate(condition, &result);
    let previous = ctx.services.store.alert(&ctx.task.id, &ctx.step.id).await?;
    let now = Utc::now();
    let (mut state, event) =
        crate::automation::alerts::transition(previous.as_ref(), &evaluation, now, *rearm_minutes);
    state.task_id = ctx.task.id.clone();
    state.step_id = ctx.step.id.clone();
    ctx.services.store.save_alert(&state).await?;
    ctx.services.emit(AutomationEvent::AlertChanged {
        alert: state.clone(),
    });
    if evaluation.status == AlertStatus::Error {
        (ctx.log)(LogLevel::Warn, evaluation.message.clone());
    }
    let muted = state
        .muted_until
        .as_deref()
        .and_then(parse_timestamp)
        .is_some_and(|until| until > now);
    match event {
        Some(NotifyWhen::AlertResolved) if !notify_on_resolve => {}
        Some(event) if !muted => engine::queue_notification(ctx.run_id, event),
        _ => {}
    }
    let value = evaluation.value.clone().unwrap_or_default();
    ctx.vars.set("alert.status", status_text(state.status));
    ctx.vars.set("alert.value", value.clone());
    ctx.vars
        .set("alert.since", state.since.clone().unwrap_or_default());
    Ok(StepOutcome {
        value: Some(serde_json::Value::String(value)),
        message: Some(evaluation.message),
        ..StepOutcome::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::engine::tests::{harness, step, Harness};
    use crate::automation::model::RunStatus;
    use serde_json::json;

    async fn run_check(
        h: &Harness,
        check: serde_json::Value,
        severity: &str,
    ) -> (RunStatus, Option<String>) {
        let run = h
            .db
            .run(
                &h.services,
                vec![step("c", json!({ "type": "check", "connection": "db", "check": check, "severity": severity }))],
            )
            .await;
        (run.status, run.error)
    }

    #[tokio::test]
    async fn every_check_kind() {
        let h = harness().await;
        let ok = |r: (RunStatus, Option<String>)| assert_eq!(r.0, RunStatus::Success, "{:?}", r.1);
        let fails = |r: (RunStatus, Option<String>), needle: &str| {
            assert_eq!(r.0, RunStatus::Failed);
            assert!(
                r.1.as_deref().unwrap_or_default().contains(needle),
                "{:?}",
                r.1
            );
        };
        ok(run_check(&h, json!({ "type": "row_count", "schema": "main", "table": "items", "op": "eq", "value": 3.0 }), "error").await);
        fails(
            run_check(
                &h,
                json!({ "type": "row_count", "table": "items", "op": "gt", "value": 5.0 }),
                "error",
            )
            .await,
            "Zeilenzahl 3",
        );
        ok(run_check(&h, json!({ "type": "row_count", "sql": "SELECT * FROM items WHERE qty > 1;", "op": "eq", "value": 2.0 }), "error").await);
        ok(run_check(&h, json!({ "type": "value", "sql": "SELECT SUM(qty) FROM items", "op": "eq", "value": "10.2", "tolerance": 0.5 }), "error").await);
        fails(run_check(&h, json!({ "type": "value", "sql": "SELECT SUM(qty) FROM items", "op": "eq", "value": "11" }), "error").await, "„10“");
        ok(run_check(&h, json!({ "type": "value", "sql": "SELECT name FROM items WHERE id = 1", "op": "matches", "value": "^a$" }), "error").await);
        fails(
            run_check(
                &h,
                json!({ "type": "not_null", "schema": "main", "table": "items", "column": "note" }),
                "error",
            )
            .await,
            "1 Zeilen mit NULL",
        );
        ok(run_check(
            &h,
            json!({ "type": "not_null", "schema": "main", "table": "items", "column": "name" }),
            "error",
        )
        .await);
        ok(run_check(
            &h,
            json!({ "type": "unique", "schema": "main", "table": "items", "columns": ["name"] }),
            "error",
        )
        .await);
        fails(run_check(&h, json!({ "type": "unique", "schema": "main", "table": "items", "columns": ["status"] }), "error").await, "doppelte");
        ok(run_check(&h, json!({ "type": "accepted_values", "schema": "main", "table": "items", "column": "status", "values": ["open", "it's done"] }), "error").await);
        fails(run_check(&h, json!({ "type": "accepted_values", "schema": "main", "table": "items", "column": "status", "values": ["open"] }), "error").await, "1 Zeilen");
        ok(run_check(
            &h,
            json!({ "type": "query", "sql": "SELECT * FROM items WHERE qty < 0" }),
            "error",
        )
        .await);
        fails(
            run_check(
                &h,
                json!({ "type": "query", "sql": "SELECT * FROM items WHERE qty > 5" }),
                "error",
            )
            .await,
            "1 Verstöße",
        );
        let warn = run_check(
            &h,
            json!({ "type": "query", "sql": "SELECT * FROM items" }),
            "warning",
        )
        .await;
        assert_eq!(warn.0, RunStatus::Warning);
    }

    #[tokio::test]
    async fn freshness_with_fixed_timestamps() {
        let h = harness().await;
        let fresh = (Utc::now() - chrono::Duration::minutes(10))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let stale = (Utc::now() - chrono::Duration::hours(3)).to_rfc3339();
        h.db.exec(&format!("CREATE TABLE fresh (at TEXT); INSERT INTO fresh VALUES ('{fresh}'); CREATE TABLE stale (at TEXT); INSERT INTO stale VALUES ('{stale}'); CREATE TABLE empty_t (at TEXT);"));
        let spec = |t: &str, warn: Option<u32>, error: u32| json!({ "type": "freshness", "schema": "main", "table": t, "column": "at", "warnAfterMinutes": warn, "errorAfterMinutes": error });
        assert_eq!(
            run_check(&h, spec("fresh", None, 30), "error").await.0,
            RunStatus::Success
        );
        assert_eq!(
            run_check(&h, spec("fresh", Some(5), 30), "error").await.0,
            RunStatus::Warning
        );
        let failed = run_check(&h, spec("stale", Some(5), 60), "error").await;
        assert_eq!(failed.0, RunStatus::Failed);
        assert!(failed.1.unwrap().contains("Minuten alt"));
        assert_eq!(
            run_check(&h, spec("stale", None, 60), "warning").await.0,
            RunStatus::Warning
        );
        assert!(run_check(&h, spec("empty_t", None, 60), "error")
            .await
            .1
            .unwrap()
            .contains("Keine Zeitstempel"));
    }

    #[test]
    fn timestamps_parse_with_and_without_zone() {
        let expected = Utc.with_ymd_and_hms(2026, 10, 4, 7, 30, 0).unwrap();
        use chrono::TimeZone;
        assert_eq!(parse_timestamp("2026-10-04T07:30:00Z"), Some(expected));
        assert_eq!(parse_timestamp("2026-10-04 07:30:00"), Some(expected));
        assert_eq!(parse_timestamp("2026-10-04 09:30:00+02:00"), Some(expected));
        assert_eq!(parse_timestamp("1791099000"), Some(expected));
        assert_eq!(parse_timestamp("nope"), None);
    }
}
