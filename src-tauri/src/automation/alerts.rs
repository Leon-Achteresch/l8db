use chrono::{DateTime, Duration, Utc};
use serde_json::Value;

use crate::automation::model::{AlertCondition, AlertState, AlertStatus, NotifyWhen};
use crate::automation::runtime::rfc3339;
use crate::automation::vars;
use crate::db::QueryResult;

pub struct AlertEvaluation {
    pub status: AlertStatus,
    pub value: Option<String>,
    pub message: String,
}

fn text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn first_value(result: &QueryResult, column: Option<&str>) -> Result<String, String> {
    let index = match column.filter(|column| !column.is_empty()) {
        Some(column) => result
            .columns
            .iter()
            .position(|name| name == column)
            .ok_or_else(|| format!("Spalte „{column}“ fehlt im Ergebnis."))?,
        None => 0,
    };
    let row = result
        .rows
        .first()
        .ok_or("Die Abfrage lieferte keine Zeile.")?;
    let cell = match row {
        Value::Array(cells) => cells.get(index),
        Value::Object(cells) => result.columns.get(index).and_then(|name| cells.get(name)),
        other => Some(other),
    };
    cell.map(text)
        .ok_or_else(|| "Die Abfrage lieferte keine Spalte.".into())
}

fn evaluation(status: AlertStatus, value: Option<String>, message: String) -> AlertEvaluation {
    AlertEvaluation {
        status,
        value,
        message,
    }
}

pub fn evaluate(
    condition: &AlertCondition,
    result: &Result<QueryResult, String>,
) -> AlertEvaluation {
    let result = match (condition, result) {
        (AlertCondition::Error, Err(error)) => {
            return evaluation(AlertStatus::Triggered, None, error.clone())
        }
        (_, Err(error)) => return evaluation(AlertStatus::Error, None, error.clone()),
        (_, Ok(result)) => result,
    };
    let rows = result.rows.len();
    let count = Some(rows.to_string());
    let status = |triggered: bool| {
        if triggered {
            AlertStatus::Triggered
        } else {
            AlertStatus::Ok
        }
    };
    match condition {
        AlertCondition::HasRows => evaluation(
            status(rows > 0),
            count,
            format!("{rows} Zeile(n) gefunden."),
        ),
        AlertCondition::NoRows => evaluation(
            status(rows == 0),
            count,
            format!("{rows} Zeile(n) gefunden."),
        ),
        AlertCondition::Error => evaluation(AlertStatus::Ok, count, "Abfrage erfolgreich.".into()),
        AlertCondition::Value {
            column,
            op,
            threshold,
        } => {
            let value = match first_value(result, column.as_deref()) {
                Ok(value) => value,
                Err(error) => return evaluation(AlertStatus::Error, None, error),
            };
            match vars::compare(&value, *op, threshold) {
                Ok(triggered) => {
                    let message = format!("Wert {value}, Schwelle {threshold}.");
                    evaluation(status(triggered), Some(value), message)
                }
                Err(error) => evaluation(AlertStatus::Error, Some(value), error),
            }
        }
    }
}

fn parse(at: &Option<String>) -> Option<DateTime<Utc>> {
    at.as_deref()
        .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
        .map(|at| at.with_timezone(&Utc))
}

pub fn transition(
    previous: Option<&AlertState>,
    evaluation: &AlertEvaluation,
    now: DateTime<Utc>,
    rearm_minutes: Option<u32>,
) -> (AlertState, Option<NotifyWhen>) {
    let mut state = previous.cloned().unwrap_or_default();
    let before = state.status;
    let stamp = rfc3339(now);
    state.status = evaluation.status;
    state.checked_at = Some(stamp.clone());
    state.last_value = evaluation.value.clone();
    if before != state.status {
        state.since = Some(stamp.clone());
    }
    let notify = match (before, state.status) {
        (AlertStatus::Triggered, AlertStatus::Triggered) => match rearm_minutes {
            Some(minutes)
                if parse(&state.last_notified_at)
                    .is_none_or(|last| now - last >= Duration::minutes(minutes as i64)) =>
            {
                Some(NotifyWhen::AlertTriggered)
            }
            _ => None,
        },
        (_, AlertStatus::Triggered) => Some(NotifyWhen::AlertTriggered),
        (AlertStatus::Triggered, AlertStatus::Ok) => Some(NotifyWhen::AlertResolved),
        _ => None,
    };
    if parse(&state.muted_until).is_some_and(|until| until > now) {
        return (state, None);
    }
    if notify == Some(NotifyWhen::AlertTriggered) {
        state.last_notified_at = Some(stamp);
    }
    (state, notify)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::model::Comparator;
    use serde_json::json;

    fn at(minutes: i64) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-04T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
            + Duration::minutes(minutes)
    }

    fn result(rows: Vec<Value>) -> Result<QueryResult, String> {
        Ok(QueryResult {
            columns: vec!["id".into(), "total".into()],
            rows,
            rows_affected: None,
            execution_time_ms: 0,
            truncated: false,
        })
    }

    fn eval(status: AlertStatus) -> AlertEvaluation {
        evaluation(status, Some("5".into()), String::new())
    }

    fn state(status: AlertStatus, last_notified: Option<i64>) -> AlertState {
        AlertState {
            task_id: "t".into(),
            step_id: "s".into(),
            status,
            since: Some(rfc3339(at(-60))),
            last_notified_at: last_notified.map(|minutes| rfc3339(at(minutes))),
            ..AlertState::default()
        }
    }

    #[test]
    fn evaluate_row_conditions() {
        let rows = result(vec![json!({"id": 1, "total": 7})]);
        let empty = result(vec![]);
        assert_eq!(
            evaluate(&AlertCondition::HasRows, &rows).status,
            AlertStatus::Triggered
        );
        assert_eq!(
            evaluate(&AlertCondition::HasRows, &empty).status,
            AlertStatus::Ok
        );
        assert_eq!(
            evaluate(&AlertCondition::NoRows, &empty).status,
            AlertStatus::Triggered
        );
        assert_eq!(
            evaluate(&AlertCondition::NoRows, &rows).status,
            AlertStatus::Ok
        );
        assert_eq!(
            evaluate(&AlertCondition::HasRows, &rows).value.as_deref(),
            Some("1")
        );
        let failed: Result<QueryResult, String> = Err("Syntaxfehler".into());
        assert_eq!(
            evaluate(&AlertCondition::Error, &failed).status,
            AlertStatus::Triggered
        );
        assert_eq!(
            evaluate(&AlertCondition::Error, &rows).status,
            AlertStatus::Ok
        );
        let error = evaluate(&AlertCondition::HasRows, &failed);
        assert_eq!(error.status, AlertStatus::Error);
        assert_eq!(error.message, "Syntaxfehler");
    }

    #[test]
    fn evaluate_value_condition() {
        let condition = |column: Option<&str>, threshold: &str| AlertCondition::Value {
            column: column.map(str::to_string),
            op: Comparator::Gt,
            threshold: threshold.into(),
        };
        let rows = result(vec![json!({"id": 1, "total": 120})]);
        let triggered = evaluate(&condition(Some("total"), "100"), &rows);
        assert_eq!(triggered.status, AlertStatus::Triggered);
        assert_eq!(triggered.value.as_deref(), Some("120"));
        assert_eq!(
            evaluate(&condition(None, "100"), &rows).status,
            AlertStatus::Ok
        );
        let arrays = result(vec![json!([1, 120])]);
        assert_eq!(
            evaluate(&condition(Some("total"), "100"), &arrays).status,
            AlertStatus::Triggered
        );
        assert_eq!(
            evaluate(&condition(Some("missing"), "1"), &rows).status,
            AlertStatus::Error
        );
        assert_eq!(
            evaluate(&condition(None, "1"), &result(vec![])).status,
            AlertStatus::Error
        );
    }

    #[test]
    fn value_column_selection() {
        let rows = result(vec![json!({"id": 1, "total": "x"})]).unwrap();
        assert_eq!(first_value(&rows, Some("total")).unwrap(), "x");
        assert_eq!(first_value(&rows, None).unwrap(), "1");
        assert!(first_value(&rows, Some("nope")).is_err());
    }

    #[test]
    fn state_table() {
        let cases: Vec<(
            Option<AlertState>,
            AlertStatus,
            Option<u32>,
            AlertStatus,
            Option<NotifyWhen>,
        )> = vec![
            (
                None,
                AlertStatus::Triggered,
                None,
                AlertStatus::Triggered,
                Some(NotifyWhen::AlertTriggered),
            ),
            (
                Some(state(AlertStatus::Unknown, None)),
                AlertStatus::Triggered,
                None,
                AlertStatus::Triggered,
                Some(NotifyWhen::AlertTriggered),
            ),
            (
                Some(state(AlertStatus::Ok, None)),
                AlertStatus::Triggered,
                None,
                AlertStatus::Triggered,
                Some(NotifyWhen::AlertTriggered),
            ),
            (
                Some(state(AlertStatus::Error, None)),
                AlertStatus::Triggered,
                None,
                AlertStatus::Triggered,
                Some(NotifyWhen::AlertTriggered),
            ),
            (
                Some(state(AlertStatus::Triggered, Some(-10))),
                AlertStatus::Triggered,
                None,
                AlertStatus::Triggered,
                None,
            ),
            (
                Some(state(AlertStatus::Triggered, Some(-10))),
                AlertStatus::Triggered,
                Some(30),
                AlertStatus::Triggered,
                None,
            ),
            (
                Some(state(AlertStatus::Triggered, Some(-30))),
                AlertStatus::Triggered,
                Some(30),
                AlertStatus::Triggered,
                Some(NotifyWhen::AlertTriggered),
            ),
            (
                Some(state(AlertStatus::Triggered, Some(-10))),
                AlertStatus::Ok,
                None,
                AlertStatus::Ok,
                Some(NotifyWhen::AlertResolved),
            ),
            (
                Some(state(AlertStatus::Triggered, Some(-10))),
                AlertStatus::Error,
                None,
                AlertStatus::Error,
                None,
            ),
            (
                Some(state(AlertStatus::Ok, None)),
                AlertStatus::Error,
                None,
                AlertStatus::Error,
                None,
            ),
            (None, AlertStatus::Error, None, AlertStatus::Error, None),
            (
                Some(state(AlertStatus::Ok, None)),
                AlertStatus::Ok,
                None,
                AlertStatus::Ok,
                None,
            ),
            (None, AlertStatus::Ok, None, AlertStatus::Ok, None),
            (
                Some(state(AlertStatus::Error, None)),
                AlertStatus::Ok,
                None,
                AlertStatus::Ok,
                None,
            ),
        ];
        for (index, (previous, status, rearm, expected, notify)) in cases.into_iter().enumerate() {
            let (next, sent) = transition(previous.as_ref(), &eval(status), at(0), rearm);
            assert_eq!(next.status, expected, "Fall {index}");
            assert_eq!(sent, notify, "Fall {index}");
            assert_eq!(next.checked_at, Some(rfc3339(at(0))), "Fall {index}");
            assert_eq!(next.last_value.as_deref(), Some("5"), "Fall {index}");
            let changed = previous.as_ref().map(|p| p.status).unwrap_or_default() != expected;
            let since = if changed {
                Some(rfc3339(at(0)))
            } else {
                previous.as_ref().and_then(|p| p.since.clone())
            };
            assert_eq!(next.since, since, "Fall {index}");
            if sent == Some(NotifyWhen::AlertTriggered) {
                assert_eq!(next.last_notified_at, Some(rfc3339(at(0))), "Fall {index}");
            } else {
                assert_eq!(
                    next.last_notified_at,
                    previous.and_then(|p| p.last_notified_at),
                    "Fall {index}"
                );
            }
        }
    }

    #[test]
    fn rearm_repeats_reminders() {
        let mut current = None;
        let mut sent = Vec::new();
        for minute in [0, 10, 20, 30, 40, 60] {
            let (next, notify) = transition(
                current.as_ref(),
                &eval(AlertStatus::Triggered),
                at(minute),
                Some(30),
            );
            sent.push(notify.is_some());
            current = Some(next);
        }
        assert_eq!(sent, [true, false, false, true, false, true]);
    }

    #[test]
    fn mute_suppresses_but_keeps_state() {
        let mut muted = state(AlertStatus::Ok, None);
        muted.muted_until = Some(rfc3339(at(60)));
        let (next, notify) =
            transition(Some(&muted), &eval(AlertStatus::Triggered), at(0), Some(15));
        assert_eq!(notify, None);
        assert_eq!(next.status, AlertStatus::Triggered);
        assert_eq!(next.since, Some(rfc3339(at(0))));
        assert_eq!(next.last_notified_at, None);
        assert_eq!(next.muted_until, muted.muted_until);
        let (resolved, notify) = transition(Some(&next), &eval(AlertStatus::Ok), at(5), None);
        assert_eq!(notify, None);
        assert_eq!(resolved.status, AlertStatus::Ok);
        let (_, after_mute) =
            transition(Some(&next), &eval(AlertStatus::Triggered), at(61), Some(15));
        assert_eq!(after_mute, Some(NotifyWhen::AlertTriggered));
    }
}
