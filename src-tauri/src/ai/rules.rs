use super::knowledge::{self, Invariant, MAX_INVARIANTS};
use super::runtime::Run;
use crate::mcp::config::{McpConfig, McpConnection};
use crate::mcp::sandbox::{NamedSql, RuleStatus};
use crate::mcp::server::Server;
use serde_json::{json, Value};

const MAX_PER_CALL: usize = 20;

pub fn tool_definition() -> Value {
    json!({
        "name": "rules",
        "description": "Data rules: business invariants the data must satisfy, each written as a read-only query that returns the violating rows (empty result = rule holds). check verifies candidate rules and shows violation counts with sample rows, nothing is saved. save stores confirmed rules for the connection after user approval; saved rules appear in every chat and sandbox re-checks them automatically. list re-checks all saved rules. delete removes rules by name. To discover rules, profile tables with aggregate queries (null rates, uniqueness, value ranges, status/date dependencies, totals that must match child rows), check the candidates, then present the ones that hold or almost hold and save only those the user confirms. For ongoing monitoring build a workflow with a set_variable row_count step per rule, a condition and notify.",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "action": {"type": "string", "enum": ["check", "save", "list", "delete"]},
            "rules": {"type": "array", "maxItems": MAX_PER_CALL, "description": "For check and save", "items": {"type": "object", "properties": {
                "name": {"type": "string", "description": "Short name in the user's language"},
                "description": {"type": "string", "description": "The rule in plain words"},
                "sql": {"type": "string", "description": "SELECT returning violating rows with identifying columns, no ORDER BY or LIMIT"}
            }, "required": ["name", "sql"]}},
            "names": {"type": "array", "items": {"type": "string"}, "description": "For delete"}
        }, "required": ["connection", "action"]}
    })
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

pub fn describe(statuses: &[RuleStatus]) -> String {
    let holding = statuses
        .iter()
        .filter(|status| status.count == Ok(0))
        .count();
    let mut lines = vec![format!("{holding} von {} Regeln erfüllt.", statuses.len())];
    for status in statuses {
        match &status.count {
            Ok(0) => lines.push(format!("✓ {}: keine Verletzungen", status.name)),
            Ok(count) => {
                lines.push(format!("✗ {}: {count} verletzende Zeilen", status.name));
                if let Some(sample) = &status.sample {
                    lines.extend(sample.lines().map(|line| format!("    {line}")));
                }
            }
            Err(error) => lines.push(format!("? {}: nicht prüfbar: {error}", status.name)),
        }
    }
    lines.join("\n")
}

fn candidates(args: &Value) -> Result<Vec<(NamedSql, String)>, String> {
    let list: Vec<(NamedSql, String)> = args["rules"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let name = entry["name"].as_str()?.trim();
            let sql = entry["sql"].as_str()?.trim();
            (!name.is_empty() && !sql.is_empty()).then(|| {
                (
                    NamedSql {
                        name: name.into(),
                        sql: sql.into(),
                    },
                    entry["description"]
                        .as_str()
                        .unwrap_or("")
                        .trim()
                        .to_string(),
                )
            })
        })
        .collect();
    if list.is_empty() || list.len() > MAX_PER_CALL {
        return Err(format!(
            "1 bis {MAX_PER_CALL} rules mit name und sql angeben."
        ));
    }
    Ok(list)
}

pub fn merge(mut saved: Vec<Invariant>, added: Vec<Invariant>) -> Result<Vec<Invariant>, String> {
    for rule in added {
        let name = rule.name.trim().to_lowercase();
        saved.retain(|existing| existing.name.trim().to_lowercase() != name);
        saved.push(rule);
    }
    if saved.len() > MAX_INVARIANTS {
        return Err(format!(
            "Höchstens {MAX_INVARIANTS} Datenregeln pro Verbindung."
        ));
    }
    Ok(saved)
}

pub fn saved_rules(connection_id: &str) -> Vec<NamedSql> {
    knowledge::load(connection_id)
        .invariants
        .into_iter()
        .map(|rule| NamedSql {
            name: rule.name,
            sql: rule.sql,
        })
        .collect()
}

pub async fn call(
    server: &tokio::sync::Mutex<Server>,
    config: &McpConfig,
    run: &Run,
    args: Value,
) -> Result<String, String> {
    let connection: McpConnection =
        crate::mcp::server::find_connection(config, args["connection"].as_str().unwrap_or(""))
            .and_then(|connection| crate::mcp::server::with_database(connection, &args))?;
    match args["action"].as_str().unwrap_or("") {
        "check" => {
            let rules: Vec<NamedSql> = candidates(&args)?
                .into_iter()
                .map(|(rule, _)| rule)
                .collect();
            let statuses = server
                .lock()
                .await
                .check_rules(config, &connection, &rules, true)
                .await?;
            Ok(format!(
                "Nur geprüft, nichts gespeichert.\n{}",
                describe(&statuses)
            ))
        }
        "save" => {
            if run.plan_only {
                return Err("Datenregeln speichern ist im Plan-Modus gesperrt.".into());
            }
            let list = candidates(&args)?;
            let rules: Vec<NamedSql> = list.iter().map(|(rule, _)| rule.clone()).collect();
            let statuses = server
                .lock()
                .await
                .check_rules(config, &connection, &rules, false)
                .await?;
            if let Some(broken) = statuses.iter().find(|status| status.count.is_err()) {
                return Err(format!(
                    "Regel {} ist nicht ausführbar, nichts gespeichert: {}",
                    broken.name,
                    broken.count.clone().unwrap_err()
                ));
            }
            let details = json!({
                "connection": connection.name,
                "rules": list.iter().zip(&statuses).map(|((rule, description), status)| json!({
                    "name": rule.name, "description": description, "sql": rule.sql,
                    "violations": status.count.clone().unwrap_or(0)
                })).collect::<Vec<_>>()
            });
            if !run
                .approve_tool(true, "Datenregeln speichern", details)
                .await
                .unwrap_or(false)
            {
                return Err("Benutzer hat das Speichern der Datenregeln abgelehnt.".into());
            }
            let checked = now();
            let added: Vec<Invariant> = list
                .into_iter()
                .zip(&statuses)
                .map(|((rule, description), status)| Invariant {
                    name: rule.name,
                    description,
                    sql: rule.sql,
                    violations: status.count.clone().ok(),
                    checked_at: Some(checked),
                })
                .collect();
            let count = added.len();
            let saved = knowledge::update_invariants(&connection.id, |saved| merge(saved, added))?;
            Ok(format!(
                "ok, {count} Datenregeln gespeichert ({} insgesamt). Sie gelten ab jetzt in jedem Gespräch, die Sandbox prüft sie automatisch.\n{}",
                saved.len(),
                describe(&statuses)
            ))
        }
        "list" => {
            let rules = saved_rules(&connection.id);
            if rules.is_empty() {
                return Ok("Keine Datenregeln gespeichert. Mit check Kandidaten prüfen und mit save speichern.".into());
            }
            let statuses = server
                .lock()
                .await
                .check_rules(config, &connection, &rules, true)
                .await?;
            let checked = now();
            let _ = knowledge::update_invariants(&connection.id, |mut saved| {
                for rule in &mut saved {
                    if let Some(status) = statuses.iter().find(|status| status.name == rule.name) {
                        if let Ok(count) = status.count {
                            rule.violations = Some(count);
                            rule.checked_at = Some(checked);
                        }
                    }
                }
                Ok(saved)
            });
            Ok(describe(&statuses))
        }
        "delete" => {
            if run.plan_only {
                return Err("Datenregeln löschen ist im Plan-Modus gesperrt.".into());
            }
            let names: Vec<String> = args["names"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_lowercase)
                .collect();
            if names.is_empty() {
                return Err("names angeben.".into());
            }
            if !run
                .approve_tool(
                    true,
                    "Datenregeln löschen",
                    json!({"connection": connection.name, "names": args["names"]}),
                )
                .await
                .unwrap_or(false)
            {
                return Err("Benutzer hat das Löschen abgelehnt.".into());
            }
            let mut removed = 0;
            knowledge::update_invariants(&connection.id, |mut saved| {
                let before = saved.len();
                saved.retain(|rule| !names.contains(&rule.name.to_lowercase()));
                removed = before - saved.len();
                Ok(saved)
            })?;
            Ok(format!("ok, {removed} Datenregeln gelöscht."))
        }
        _ => Err("action muss check, save, list oder delete sein.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(name: &str, sql: &str) -> Invariant {
        Invariant {
            name: name.into(),
            sql: sql.into(),
            ..Invariant::default()
        }
    }

    #[test]
    fn merge_replaces_by_name_and_respects_the_limit() {
        let merged = merge(
            vec![rule("Summe passt", "SELECT 1"), rule("Datum", "SELECT 2")],
            vec![rule(" SUMME passt ", "SELECT 3")],
        )
        .unwrap();
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].sql, "SELECT 3");
        let many = (0..MAX_INVARIANTS + 1)
            .map(|index| rule(&format!("r{index}"), "SELECT 1"))
            .collect();
        assert!(merge(Vec::new(), many).is_err());
    }

    #[test]
    fn describes_holding_broken_and_failing_rules() {
        let text = describe(&[
            RuleStatus {
                name: "a".into(),
                count: Ok(0),
                sample: None,
            },
            RuleStatus {
                name: "b".into(),
                count: Ok(3),
                sample: Some("id\n7".into()),
            },
            RuleStatus {
                name: "c".into(),
                count: Err("Syntax".into()),
                sample: None,
            },
        ]);
        assert!(text.starts_with("1 von 3 Regeln erfüllt."));
        assert!(text.contains("✗ b: 3 verletzende Zeilen\n    id\n    7"));
        assert!(text.contains("? c: nicht prüfbar: Syntax"));
    }

    #[test]
    fn candidates_keep_descriptions_aligned() {
        let list = candidates(&json!({"rules": [
            {"name": "a", "description": "erste", "sql": "SELECT 1"},
            {"name": "b", "sql": "SELECT 2"}
        ]}))
        .unwrap();
        assert_eq!(list[0].1, "erste");
        assert_eq!(list[1].0.name, "b");
        assert!(candidates(&json!({"rules": []})).is_err());
    }
}
