use crate::automation::model::{Action, LogLevel};
use crate::automation::runtime::{StepContext, StepOutcome};
use crate::automation::steps::{first_cell, open, resolve_path, wrong_action};

pub async fn sql(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Sql {
        connections,
        database,
        sql,
        file,
    } = config
    else {
        return Err(wrong_action());
    };
    if connections.is_empty() {
        return Err("Keine Verbindung gewählt.".into());
    }
    let source = match file.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
        Some(file) => {
            let path = resolve_path(ctx, file).await?;
            tokio::fs::read_to_string(&path).await.map_err(|error| {
                format!(
                    "SQL-Datei {} konnte nicht gelesen werden: {error}",
                    path.display()
                )
            })?
        }
        None => sql.clone(),
    };
    if source.trim().is_empty() {
        return Err("Kein SQL angegeben.".into());
    }
    let mut outcome = StepOutcome::default();
    let mut affected = 0u64;
    let mut any_affected = false;
    for reference in connections {
        let (resolved, adapter) = open(ctx, reference, database.as_deref()).await?;
        let text = ctx.vars.render_sql(&source, resolved.kind)?;
        let statements = crate::db::sql_script::split(&text);
        let name = resolved.name.clone();
        if statements.len() == 1 {
            let result = adapter
                .execute_query(&statements[0])
                .await
                .map_err(|error| format!("{name}: {error}"))?;
            outcome.rows = Some(result.rows.len() as u64);
            outcome.value = first_cell(&result);
            if let Some(count) = result.rows_affected {
                affected += count;
                any_affected = true;
            }
            (ctx.log)(
                LogLevel::Info,
                format!(
                    "{name}: {} Zeilen, {} betroffen ({} ms)",
                    result.rows.len(),
                    result.rows_affected.unwrap_or(0),
                    result.execution_time_ms
                ),
            );
        } else {
            let results = adapter
                .execute_script(&text)
                .await
                .map_err(|error| format!("{name}: {error}"))?;
            for (index, result) in results.iter().enumerate() {
                if !result.success {
                    return Err(format!(
                        "{name}: Anweisung {} fehlgeschlagen: {}",
                        index + 1,
                        result.error.clone().unwrap_or_default()
                    ));
                }
                if let Some(count) = result.rows_affected {
                    affected += count;
                    any_affected = true;
                }
            }
            outcome.rows = None;
            outcome.value = None;
            (ctx.log)(
                LogLevel::Info,
                format!("{name}: {} Anweisungen ausgeführt", results.len()),
            );
        }
    }
    outcome.rows_affected = any_affected.then_some(affected);
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use crate::automation::engine::tests::{harness, step};
    use crate::automation::model::RunStatus;
    use serde_json::json;

    #[tokio::test]
    async fn single_statement_returns_rows_and_script_sums_affected() {
        let h = harness().await;
        let (services, db) = (&h.services, &h.db);
        let run = db
            .run(
                services,
                vec![
                    step("a", json!({ "type": "sql", "connections": ["db"], "sql": "INSERT INTO items (name, qty) VALUES ('x', 1); INSERT INTO items (name, qty) VALUES ('y', 2);" })),
                    step("b", json!({ "type": "sql", "connections": ["Testdb"], "sql": "SELECT name FROM items ORDER BY id" })),
                    step("c", json!({ "type": "set_variable", "name": "r", "value": "${step.1.rows_affected}/${step.2.rows}/${step.b.value}" })),
                    step("d", json!({ "type": "condition", "left": "${r}", "op": "eq", "right": "2/5/a", "then": { "type": "next" }, "otherwise": { "type": "end_failure" } })),
                ],
            )
            .await;
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
    }

    #[tokio::test]
    async fn sql_error_names_connection() {
        let h = harness().await;
        let (services, db) = (&h.services, &h.db);
        let run = db
            .run(
                services,
                vec![step(
                    "a",
                    json!({ "type": "sql", "connections": ["db"], "sql": "SELECT * FROM nope" }),
                )],
            )
            .await;
        assert_eq!(run.status, RunStatus::Failed);
        assert!(run.error.unwrap().starts_with("Testdb:"));
    }

    #[tokio::test]
    #[ignore]
    async fn postgres_sql_and_check() {
        let Ok(url) = std::env::var("L8DB_E2E_PG_URL") else {
            return;
        };
        let h = harness().await;
        let (services, db) = (&h.services, &h.db);
        db.add_connection(
            services,
            "pg",
            "Postgres",
            crate::db::DatabaseKind::Postgres,
            &url,
        )
        .await;
        let run = db
            .run(
                services,
                vec![
                    step("a", json!({ "type": "sql", "connections": ["pg"], "sql": "DROP TABLE IF EXISTS automation_wp2; CREATE TABLE automation_wp2 (id int primary key, name text); INSERT INTO automation_wp2 VALUES (1, 'a'), (2, 'b');" })),
                    step("b", json!({ "type": "check", "connection": "pg", "check": { "type": "row_count", "schema": "public", "table": "automation_wp2", "op": "eq", "value": 2.0 } })),
                    step("c", json!({ "type": "check", "connection": "pg", "check": { "type": "unique", "schema": "public", "table": "automation_wp2", "columns": ["id"] } })),
                    step("d", json!({ "type": "sql", "connections": ["pg"], "sql": "DROP TABLE automation_wp2" })),
                ],
            )
            .await;
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
    }
}
