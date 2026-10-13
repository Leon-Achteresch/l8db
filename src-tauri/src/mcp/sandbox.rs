use super::config::{McpConfig, McpConnection};
use super::redact::{self, Redactor};
use super::server::{adapter, check_read_sql, check_write_sql, format_result, run, Server};
use crate::db::{self, DatabaseKind, QueryResult, TxSession};
use serde_json::{json, Value};

pub const MAX_STATEMENTS: usize = 20;
pub const MAX_PROBES: usize = 8;
const PROBE_ROWS: usize = 15;
const PROBE_CHARS: usize = 2_500;
const SAMPLE_ROWS: usize = 3;
const BLOCKED_LEAD: &[&str] = &[
    "commit",
    "rollback",
    "end",
    "begin",
    "start",
    "savepoint",
    "release",
    "abort",
    "prepare",
    "set",
    "vacuum",
    "checkpoint",
    "attach",
    "detach",
    "pragma",
    "copy",
    "load",
    "install",
    "export",
    "import",
    "use",
    "go",
];

pub fn tool_definition() -> Value {
    json!({
        "name": "sandbox",
        "description": "Try changes on the real data without keeping them. Runs the statements in one transaction, measures probes before and after, re-checks every saved data rule and always rolls back; nothing is ever committed. Use it to test migrations, backfills and fixes before proposing them, and for what-if questions (e.g. raise prices 10 %, cancel a supplier's open orders, then measure margin and open orders). Needs write access; DDL only where DDL is allowed. CALL/EXEC, DO blocks, COPY, sequences and transaction control are rejected because they can act outside the transaction. Supported: PostgreSQL, SQLite, DuckDB, SQL Server.",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": super::server::database_arg(),
            "title": {"type": "string", "description": "Short scenario name in the user's language"},
            "statements": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": MAX_STATEMENTS, "description": "Changes in order, one statement each"},
            "probes": {"type": "array", "maxItems": MAX_PROBES, "description": "Read-only queries measured before and after, e.g. KPIs or affected rows. Aggregate to a few rows", "items": {"type": "object", "properties": {
                "name": {"type": "string"},
                "sql": {"type": "string"}
            }, "required": ["name", "sql"]}},
            "rules": {"type": "boolean", "description": "Re-check saved data rules before and after. Default true"}
        }, "required": ["connection", "statements"]}
    })
}

pub fn supported(kind: DatabaseKind) -> bool {
    matches!(
        kind,
        DatabaseKind::Postgres | DatabaseKind::Sqlite | DatabaseKind::Duckdb | DatabaseKind::Mssql
    )
}

#[derive(Clone, Debug)]
pub struct NamedSql {
    pub name: String,
    pub sql: String,
}

pub fn named(list: &Value) -> Vec<NamedSql> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let sql = entry["sql"].as_str()?.trim();
            (!sql.is_empty()).then(|| NamedSql {
                name: entry["name"].as_str().unwrap_or("Messung").trim().into(),
                sql: sql.into(),
            })
        })
        .collect()
}

pub fn violation_count_sql(sql: &str) -> String {
    format!(
        "SELECT COUNT(*) FROM ({}) l8db_violations",
        sql.trim().trim_end_matches(';').trim_end()
    )
}

pub fn transaction_control(sql: &str) -> Option<String> {
    let words = redact::sql_words(sql);
    if let Some(lead) = words
        .first()
        .filter(|word| BLOCKED_LEAD.contains(&word.as_str()))
    {
        return Some(lead.clone());
    }
    if !super::insight::dry_run_statement(&words) {
        return words.first().cloned();
    }
    words.into_iter().find(|word| {
        matches!(
            word.as_str(),
            "commit" | "rollback" | "exec" | "execute" | "sp_executesql" | "xact_abort"
        )
    })
}

async fn transaction_marker(
    config: &McpConfig,
    kind: DatabaseKind,
    session: &mut dyn TxSession,
) -> Result<Option<String>, String> {
    let sql = match kind {
        DatabaseKind::Postgres => "SELECT txid_current()",
        DatabaseKind::Mssql => "SELECT @@TRANCOUNT",
        _ => return Ok(None),
    };
    let result = run(config, kind, session.execute(sql))
        .await
        .map_err(|error| {
            format!(
                "Sandbox nicht startbar: {}",
                super::server::scrub_error(&error)
            )
        })?;
    let value = match result.rows.first() {
        Some(Value::Array(list)) => list.first().cloned(),
        Some(Value::Object(map)) => map.values().next().cloned(),
        _ => None,
    };
    match value {
        Some(value) if value != Value::Null && value != json!(0) && value != json!("0") => {
            Ok(Some(value.to_string()))
        }
        _ => Err("Sandbox nicht startbar: keine offene Transaktion.".into()),
    }
}

fn lock_guard(kind: DatabaseKind) -> Option<&'static str> {
    match kind {
        DatabaseKind::Postgres => Some("SET LOCAL lock_timeout = '5s'"),
        DatabaseKind::Mssql => Some("SET LOCK_TIMEOUT 5000"),
        _ => None,
    }
}

fn scalar(result: &QueryResult) -> Option<f64> {
    if result.columns.len() != 1 || result.rows.len() != 1 {
        return None;
    }
    let value = match &result.rows[0] {
        Value::Array(list) => list.first().cloned()?,
        Value::Object(map) => map.values().next().cloned()?,
        other => other.clone(),
    };
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

fn amount(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{value:.0}")
    } else {
        format!("{value:.2}")
    }
}

pub fn compare(before: f64, after: f64) -> String {
    let delta = after - before;
    if delta == 0.0 {
        return format!("{} → {} (unverändert)", amount(before), amount(after));
    }
    let sign = if delta > 0.0 { "+" } else { "" };
    if before == 0.0 {
        format!(
            "{} → {} ({sign}{})",
            amount(before),
            amount(after),
            amount(delta)
        )
    } else {
        format!(
            "{} → {} ({sign}{}, {sign}{:.1} %)",
            amount(before),
            amount(after),
            amount(delta),
            delta / before.abs() * 100.0
        )
    }
}

pub fn rule_line(name: &str, before: &Result<f64, String>, after: &Result<f64, String>) -> String {
    match (before, after) {
        (Ok(before), Ok(after)) if after > before => format!(
            "✗ {name}: {} → {} Verletzungen, NEU VERLETZT",
            amount(*before),
            amount(*after)
        ),
        (Ok(before), Ok(after)) if *after == 0.0 => {
            format!("✓ {name}: {} → 0 Verletzungen", amount(*before))
        }
        (Ok(before), Ok(after)) => format!(
            "• {name}: {} → {} Verletzungen, keine neuen",
            amount(*before),
            amount(*after)
        ),
        (_, Err(error)) | (Err(error), _) => format!("? {name}: nicht prüfbar ({error})"),
    }
}

struct Measured {
    result: Result<QueryResult, String>,
}

impl Measured {
    fn value(&self) -> Result<f64, String> {
        match &self.result {
            Ok(result) => scalar(result).ok_or_else(|| "kein Zahlenwert".into()),
            Err(error) => Err(super::server::scrub_error(error)),
        }
    }
}

pub struct RuleStatus {
    pub name: String,
    pub count: Result<u64, String>,
    pub sample: Option<String>,
}

impl Server {
    pub(crate) async fn check_rules(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        rules: &[NamedSql],
        samples: bool,
    ) -> Result<Vec<RuleStatus>, String> {
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let columns = self.columns_for(config, connection).await?;
        let index = redact::SchemaIndex::new(&columns, &redactor, connection.allowed_schemas());
        let adapter = adapter(connection, &self.pool)?;
        let mut out = Vec::new();
        for rule in rules {
            let count_sql = violation_count_sql(&rule.sql);
            let count = match check_read_sql(&count_sql, connection, &index) {
                Err(error) => Err(error),
                Ok(()) => run(config, connection.kind, async {
                    adapter.execute_query(&count_sql).await
                })
                .await
                .map_err(|error| super::server::scrub_error(&error))
                .and_then(|result| {
                    scalar(&result)
                        .map(|value| value as u64)
                        .ok_or_else(|| "Zählung lieferte keine Zahl".into())
                }),
            };
            let sample = match (&count, samples) {
                (Ok(found), true) if *found > 0 => run(config, connection.kind, async {
                    adapter
                        .execute_query(rule.sql.trim().trim_end_matches(';'))
                        .await
                })
                .await
                .ok()
                .map(|result| {
                    let small = McpConfig {
                        max_chars: PROBE_CHARS,
                        ..config.clone()
                    };
                    format_result(&result, &small, &redactor, SAMPLE_ROWS)
                }),
                _ => None,
            };
            out.push(RuleStatus {
                name: rule.name.clone(),
                count,
                sample,
            });
        }
        Ok(out)
    }

    pub(crate) async fn sandbox(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        args: &Value,
        rules: &[NamedSql],
    ) -> Result<String, String> {
        if !supported(connection.kind) {
            return Err(
                "Sandbox braucht PostgreSQL, SQLite, DuckDB oder SQL Server; bei dieser Datenbank lassen sich Änderungen nicht sicher zurückrollen."
                    .into(),
            );
        }
        let statements: Vec<String> = args["statements"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(|sql| sql.trim().trim_end_matches(';').trim_end().to_string())
            .filter(|sql| !sql.is_empty())
            .collect();
        if statements.is_empty() || statements.len() > MAX_STATEMENTS {
            return Err(format!("1 bis {MAX_STATEMENTS} statements angeben."));
        }
        let probes = named(&args["probes"]);
        if probes.len() > MAX_PROBES {
            return Err(format!("Höchstens {MAX_PROBES} probes."));
        }
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let columns = self.columns_for(config, connection).await?;
        let index = redact::SchemaIndex::new(&columns, &redactor, connection.allowed_schemas());
        for (position, sql) in statements.iter().enumerate() {
            if let Some(word) = transaction_control(sql) {
                return Err(format!(
                    "Anweisung {}: '{word}' steuert die Transaktion oder kann außerhalb von ihr wirken und ist in der Sandbox gesperrt.",
                    position + 1
                ));
            }
            check_write_sql(sql, connection, &index)
                .map_err(|error| format!("Anweisung {}: {error}", position + 1))?;
        }
        for probe in &probes {
            check_read_sql(&probe.sql, connection, &index)
                .map_err(|error| format!("Messung {}: {error}", probe.name))?;
        }
        let checks: Vec<NamedSql> = if args["rules"].as_bool().unwrap_or(true) {
            rules
                .iter()
                .filter(|rule| {
                    check_read_sql(&violation_count_sql(&rule.sql), connection, &index).is_ok()
                })
                .map(|rule| NamedSql {
                    name: rule.name.clone(),
                    sql: violation_count_sql(&rule.sql),
                })
                .collect()
        } else {
            Vec::new()
        };
        let url = super::server::connection_url(connection)?;
        let mut session = db::import::open_session(
            connection.kind,
            &url,
            connection.database.as_deref(),
            self.pool.clone(),
        )
        .await
        .map_err(|error| {
            format!(
                "Sandbox nicht startbar: {}",
                super::server::scrub_error(&error)
            )
        })?;
        let outcome = self
            .sandbox_steps(
                config,
                connection,
                session.as_mut(),
                &statements,
                &probes,
                &checks,
            )
            .await;
        let rolled_back = session.rollback().await;
        drop(session);
        let mut text = outcome?;
        match rolled_back {
            Ok(()) => text.insert_str(0, "Sandbox: alles zurückgerollt, nichts gespeichert.\n"),
            Err(error) => text.insert_str(
                0,
                &format!("ACHTUNG: Rollback nicht bestätigt ({error}). Die Verbindung wurde geschlossen; die Datenbank verwirft offene Transaktionen dabei.\n"),
            ),
        }
        Ok(super::server::cap(text, config.max_chars))
    }

    async fn sandbox_steps(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        session: &mut dyn TxSession,
        statements: &[String],
        probes: &[NamedSql],
        checks: &[NamedSql],
    ) -> Result<String, String> {
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        if let Some(guard) = lock_guard(connection.kind) {
            run(config, connection.kind, session.execute(guard))
                .await
                .map_err(|error| {
                    format!(
                        "Sandbox nicht startbar: {}",
                        super::server::scrub_error(&error)
                    )
                })?;
        }
        let marker = transaction_marker(config, connection.kind, session).await?;
        let mut before = Vec::new();
        for probe in probes.iter().chain(checks) {
            let result = run(config, connection.kind, session.execute(&probe.sql)).await;
            if let Err(error) = &result {
                return Err(format!(
                    "Messung vorher fehlgeschlagen ({}): {}. Nichts wurde geändert; Messung korrigieren oder rules=false setzen.",
                    probe.name,
                    super::server::scrub_error(error)
                ));
            }
            before.push(Measured { result });
        }
        let mut lines = vec!["Änderungen:".to_string()];
        let mut failed = false;
        for (position, sql) in statements.iter().enumerate() {
            let started = std::time::Instant::now();
            let preview: String = sql
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(90)
                .collect();
            let outcome = run(config, connection.kind, session.execute(sql)).await;
            if marker.is_some()
                && transaction_marker(config, connection.kind, session)
                    .await
                    .ok()
                    .flatten()
                    != marker
            {
                return Err(format!(
                    "ACHTUNG: Die Transaktion wurde bei Anweisung {} beendet. Änderungen ab dort könnten gespeichert sein; Daten prüfen. Sandbox abgebrochen.",
                    position + 1
                ));
            }
            match outcome {
                Ok(result) => lines.push(format!(
                    "{}. ok{}, {} ms: {preview}",
                    position + 1,
                    result
                        .rows_affected
                        .map(|count| format!(
                            ", {count} {}",
                            if count == 1 { "Zeile" } else { "Zeilen" }
                        ))
                        .unwrap_or_default(),
                    started.elapsed().as_millis()
                )),
                Err(error) => {
                    lines.push(format!(
                        "{}. FEHLER: {}\n   {preview}\nAbgebrochen; folgende Anweisungen wurden nicht ausgeführt. Anweisung korrigieren und erneut probieren.",
                        position + 1,
                        super::server::scrub_error(&error)
                    ));
                    failed = true;
                    break;
                }
            }
        }
        if failed {
            return Ok(lines.join("\n"));
        }
        let mut after = Vec::new();
        for probe in probes.iter().chain(checks) {
            after.push(Measured {
                result: run(config, connection.kind, session.execute(&probe.sql)).await,
            });
        }
        let small = McpConfig {
            max_chars: PROBE_CHARS,
            ..config.clone()
        };
        if !probes.is_empty() {
            lines.push("Messungen vorher → nachher:".into());
        }
        for (position, probe) in probes.iter().enumerate() {
            let (old, new) = (&before[position], &after[position]);
            match (old.value(), new.value()) {
                (Ok(old), Ok(new)) => lines.push(format!("{}: {}", probe.name, compare(old, new))),
                _ => {
                    lines.push(format!("{}:", probe.name));
                    for (label, measured) in [("vorher", old), ("nachher", new)] {
                        let body = match &measured.result {
                            Ok(result) => format_result(result, &small, &redactor, PROBE_ROWS),
                            Err(error) => format!("Fehler: {}", super::server::scrub_error(error)),
                        };
                        lines.push(format!("  {label}:\n{}", indent(&body)));
                    }
                }
            }
        }
        if !checks.is_empty() {
            lines.push("Datenregeln:".into());
            let offset = probes.len();
            let mut broken = 0;
            for (position, check) in checks.iter().enumerate() {
                let (old, new) = (
                    before[offset + position].value(),
                    after[offset + position].value(),
                );
                if matches!((&old, &new), (Ok(old), Ok(new)) if new > old) {
                    broken += 1;
                }
                lines.push(rule_line(&check.name, &old, &new));
            }
            lines.push(if broken == 0 {
                "Keine Regel wird durch die Änderung neu verletzt.".into()
            } else {
                format!("{broken} Regel(n) würden neu verletzt. Änderung anpassen oder den Bruch mit dem Benutzer klären.")
            });
        }
        Ok(lines.join("\n"))
    }
}

fn indent(text: &str) -> String {
    text.lines()
        .map(|line| format!("    {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
pub(crate) fn sqlite_fixture(sql: &str) -> (tempfile::TempDir, McpConfig, McpConnection, Server) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fixture.db");
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute_batch(sql)
        .unwrap();
    let connection = McpConnection {
        id: "c".into(),
        name: "shop".into(),
        kind: DatabaseKind::Sqlite,
        connection_string: path.to_string_lossy().into(),
        schemas: Vec::new(),
        ssh: false,
        exposed: true,
        read_only: false,
        allow_ddl: true,
        allow_scripts: false,
        redact_columns: Vec::new(),
        mask_rules: Vec::new(),
        environment: None,
        allow_production_writes: false,
        database: None,
    };
    let config = McpConfig {
        enabled: true,
        connections: vec![connection.clone()],
        ..McpConfig::default()
    };
    let server = Server {
        pool: db::pool::create_pool_state(),
        columns: Default::default(),
    };
    (dir, config, connection, server)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_transaction_control_anywhere() {
        assert_eq!(transaction_control("COMMIT").as_deref(), Some("commit"));
        assert_eq!(transaction_control("end").as_deref(), Some("end"));
        assert_eq!(
            transaction_control("BEGIN UPDATE t SET a = 1; COMMIT TRAN; END").as_deref(),
            Some("begin")
        );
        assert_eq!(
            transaction_control("SET search_path TO x").as_deref(),
            Some("set")
        );
        assert!(transaction_control("UPDATE t SET a = 1 WHERE b = 'commit'").is_none());
        assert!(transaction_control("ALTER TABLE t ADD COLUMN c int").is_none());
        assert_eq!(
            transaction_control("CALL send_mails()").as_deref(),
            Some("call")
        );
        assert!(transaction_control("SELECT nextval('s')").is_some());
        assert!(transaction_control("CREATE INDEX CONCURRENTLY i ON t (a)").is_some());
        assert_eq!(
            transaction_control("DELETE FROM orders EXEC('COMMIT')").as_deref(),
            Some("exec")
        );
        assert!(transaction_control("UPDATE t SET a = '\\'; COMMIT; --'").is_some());
        assert!(transaction_control("UPDATE t SET a = 1 # 2; COMMIT").is_some());
    }

    #[test]
    fn wraps_rule_queries_and_describes_changes() {
        assert_eq!(
            violation_count_sql("SELECT id FROM o WHERE total < 0;\n"),
            "SELECT COUNT(*) FROM (SELECT id FROM o WHERE total < 0) l8db_violations"
        );
        assert_eq!(compare(200.0, 150.0), "200 → 150 (-50, -25.0 %)");
        assert_eq!(compare(0.0, 3.0), "0 → 3 (+3)");
        assert!(rule_line("r", &Ok(0.0), &Ok(4.0)).contains("NEU VERLETZT"));
        assert!(rule_line("r", &Ok(2.0), &Ok(0.0)).starts_with('✓'));
        assert!(rule_line("r", &Ok(2.0), &Ok(1.0)).contains("keine neuen"));
    }

    #[tokio::test]
    async fn sqlite_sandbox_measures_rules_and_never_commits() {
        let (dir, config, connection, mut server) = sqlite_fixture(
            "CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT, total REAL, shipped_at TEXT);
             INSERT INTO orders VALUES (1, 'open', 10, NULL), (2, 'open', 20, NULL), (3, 'shipped', 30, '2026-10-01');",
        );
        let path = dir.path().join("fixture.db");
        let rules = vec![NamedSql {
            name: "Versendet braucht Datum".into(),
            sql: "SELECT id FROM orders WHERE status = 'shipped' AND shipped_at IS NULL".into(),
        }];
        let started = std::time::Instant::now();
        let text = server
            .sandbox(
                &config,
                &connection,
                &json!({
                    "statements": ["UPDATE orders SET status = 'shipped' WHERE status = 'open'", "ALTER TABLE orders ADD COLUMN note TEXT"],
                    "probes": [{"name": "Offen", "sql": "SELECT COUNT(*) FROM orders WHERE status = 'open'"}]
                }),
                &rules,
            )
            .await
            .unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        assert!(text.starts_with("Sandbox: alles zurückgerollt"), "{text}");
        assert!(text.contains("1. ok, 2 Zeilen"), "{text}");
        assert!(text.contains("Offen: 2 → 0"), "{text}");
        assert!(text.contains("✗ Versendet braucht Datum: 0 → 2"), "{text}");
        let check = rusqlite::Connection::open(&path).unwrap();
        let open: i64 = check
            .query_row(
                "SELECT COUNT(*) FROM orders WHERE status = 'open'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(open, 2);
        assert!(check.prepare("SELECT note FROM orders").is_err());
        let blocked = server
            .sandbox(
                &config,
                &connection,
                &json!({"statements": ["UPDATE orders SET total = 0", "COMMIT"]}),
                &[],
            )
            .await
            .unwrap_err();
        assert!(blocked.contains("Anweisung 2"), "{blocked}");
        let statuses = server
            .check_rules(&config, &connection, &rules, true)
            .await
            .unwrap();
        assert_eq!(statuses[0].count, Ok(0));
    }
}
