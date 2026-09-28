use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

use crate::db::{self, DatabaseAdapter};
use crate::index_advisor::{self, IndexAdvice};
use crate::mcp::redact::{self, Token};

const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_CHECKS: usize = 100;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckFile {
    format: u8,
    checks: Vec<CheckSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum CheckSpec {
    ScalarEquals {
        id: String,
        sql: String,
        expected: Value,
    },
    Plan {
        id: String,
        sql: String,
        max_cost: Option<f64>,
        max_seq_scans: Option<usize>,
        max_index_suggestions: Option<usize>,
    },
}

impl CheckSpec {
    fn id(&self) -> &str {
        match self {
            Self::ScalarEquals { id, .. } | Self::Plan { id, .. } => id,
        }
    }

    fn sql(&self) -> &str {
        match self {
            Self::ScalarEquals { sql, .. } | Self::Plan { sql, .. } => sql,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckResult {
    id: String,
    kind: &'static str,
    status: &'static str,
    message: String,
    total_cost: Option<f64>,
    seq_scans: Option<usize>,
    index_suggestions: Vec<IndexAdvice>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckReport {
    format: u8,
    passed: bool,
    checks: Vec<CheckResult>,
}

#[derive(Debug)]
struct CliArgs {
    config: String,
    url_env: String,
    output: Option<String>,
}

const USAGE: &str =
    "Aufruf: l8db --check --config <checks.json> --url-env <NAME> [--output <report.json>]";

fn parse_args(args: &[String]) -> Result<CliArgs, String> {
    let mut config = None;
    let mut url_env = None;
    let mut output = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        let mut value = || iter.next().cloned().ok_or_else(|| USAGE.to_string());
        match arg.as_str() {
            "--check" => {}
            "--config" => config = Some(value()?),
            "--url-env" => url_env = Some(value()?),
            "--output" => output = Some(value()?),
            _ => return Err(format!("Unbekanntes Argument. {USAGE}")),
        }
    }
    let config = config
        .filter(|s: &String| !s.trim().is_empty())
        .ok_or(USAGE)?;
    let url_env = url_env
        .filter(|s: &String| !s.trim().is_empty())
        .ok_or(USAGE)?;
    if !url_env
        .bytes()
        .enumerate()
        .all(|(i, b)| b == b'_' || b.is_ascii_uppercase() || (i > 0 && b.is_ascii_digit()))
    {
        return Err("--url-env erwartet einen Namen aus A-Z, 0-9 und _.".into());
    }
    Ok(CliArgs {
        config,
        url_env,
        output,
    })
}

fn validate_sql(sql: &str) -> Result<(), String> {
    let first = redact::tokenize(sql)
        .into_iter()
        .find_map(|token| match token {
            Token::Word(word) => Some(word),
            _ => None,
        });
    if !matches!(first.as_deref(), Some("select" | "with")) {
        return Err("Nur SELECT- und WITH-Abfragen sind erlaubt.".into());
    }
    if redact::statement_count(sql) != 1 {
        return Err("Jede Prüfung muss genau ein Statement enthalten.".into());
    }
    if let Some(word) = redact::write_word(sql).or_else(|| redact::dangerous_word(sql)) {
        return Err(format!(
            "SQL enthält eine nicht erlaubte Operation: {word}."
        ));
    }
    let tokens = redact::tokenize(sql);
    if tokens
        .windows(2)
        .any(|pair| pair[0] == Token::Word("set_config".into()) && pair[1] == Token::Open)
    {
        return Err("set_config ist im Prüfmodus nicht erlaubt.".into());
    }
    Ok(())
}

fn load_config(path: &str) -> Result<CheckFile, String> {
    let path = Path::new(path);
    let size = std::fs::metadata(path)
        .map_err(|_| "Prüfdatei nicht lesbar.".to_string())?
        .len();
    if size > MAX_CONFIG_BYTES {
        return Err("Prüfdatei ist zu groß.".into());
    }
    let data = std::fs::read(path).map_err(|_| "Prüfdatei nicht lesbar.".to_string())?;
    let config: CheckFile =
        serde_json::from_slice(&data).map_err(|error| format!("Ungültige Prüfdatei: {error}"))?;
    if config.format != 1 || config.checks.is_empty() || config.checks.len() > MAX_CHECKS {
        return Err(format!(
            "Prüfdatei braucht Format 1 und 1–{MAX_CHECKS} Prüfungen."
        ));
    }
    let mut ids = HashSet::new();
    for check in &config.checks {
        if check.id().trim().is_empty() || !ids.insert(check.id()) || check.sql().len() > 100_000 {
            return Err(
                "Prüf-IDs müssen eindeutig und SQL-Texte höchstens 100 KB lang sein.".into(),
            );
        }
        validate_sql(check.sql())?;
        if let CheckSpec::ScalarEquals { expected, .. } = check {
            if expected.is_array() || expected.is_object() {
                return Err("expected muss ein skalarer JSON-Wert sein.".into());
            }
        }
        if let CheckSpec::Plan { max_cost, .. } = check {
            if max_cost.is_some_and(|cost| !cost.is_finite() || cost < 0.0) {
                return Err("max_cost muss eine nichtnegative Zahl sein.".into());
            }
        }
    }
    Ok(config)
}

fn read_only_url(raw: &str) -> Result<String, String> {
    let mut url = url::Url::parse(raw).map_err(|_| "Ungültige Datenbank-URL.".to_string())?;
    if !matches!(url.scheme(), "postgres" | "postgresql") {
        return Err("Der Prüfmodus unterstützt derzeit PostgreSQL-URLs.".into());
    }
    let mut parameters = Vec::new();
    let mut previous_options = Vec::new();
    for part in url.query().unwrap_or_default().split('&') {
        if part.is_empty() {
            continue;
        }
        let (key, value) = part.split_once('=').unwrap_or((part, ""));
        if percent_decode_str(key).decode_utf8_lossy() == "options" {
            previous_options.push(percent_decode_str(value).decode_utf8_lossy().into_owned());
        } else {
            parameters.push(part.to_string());
        }
    }
    let options = previous_options.join(" ");
    let enforced = "-c default_transaction_read_only=on -c statement_timeout=30000";
    let options = if options.trim().is_empty() {
        enforced.to_string()
    } else {
        format!("{options} {enforced}")
    };
    parameters.push(format!(
        "options={}",
        utf8_percent_encode(&options, NON_ALPHANUMERIC)
    ));
    url.set_query(Some(&parameters.join("&")));
    Ok(url.to_string())
}

fn root(plan: &Value) -> Option<&Value> {
    let first = plan
        .as_array()
        .and_then(|items| items.first())
        .unwrap_or(plan);
    first.get("Plan")
}

fn count_seq_scans(node: &Value) -> usize {
    usize::from(node.get("Node Type").and_then(Value::as_str) == Some("Seq Scan"))
        + node
            .get("Plans")
            .and_then(Value::as_array)
            .map_or(0, |children| children.iter().map(count_seq_scans).sum())
}

fn scalar_matches(actual: Option<&Value>, expected: &Value) -> bool {
    match (actual, expected) {
        (Some(Value::Null), Value::Null) => true,
        (Some(Value::String(actual)), Value::String(expected)) => actual == expected,
        (Some(Value::String(actual)), Value::Bool(expected)) => {
            matches!(actual.as_str(), "t" | "true") == *expected
                && matches!(actual.as_str(), "t" | "true" | "f" | "false")
        }
        (Some(Value::String(actual)), Value::Number(_)) => {
            serde_json::from_str::<Value>(actual).ok().as_ref() == Some(expected)
        }
        (Some(actual), expected) => actual == expected,
        _ => false,
    }
}

fn scalar_query(sql: &str) -> String {
    let statement = sql.trim().trim_end_matches(';').trim();
    format!("SELECT * FROM ({statement}) AS l8db_check LIMIT 1")
}

async fn run_check(adapter: &dyn DatabaseAdapter, check: &CheckSpec) -> CheckResult {
    match check {
        CheckSpec::ScalarEquals { id, sql, expected } => {
            let outcome = adapter.execute_query(&scalar_query(sql)).await;
            let (status, message) = match outcome {
                Ok(result) => {
                    let actual = result
                        .rows
                        .first()
                        .and_then(|row| result.columns.first().and_then(|column| row.get(column)));
                    if scalar_matches(actual, expected) {
                        ("passed", "Erwarteter Skalarwert bestätigt.".to_string())
                    } else {
                        (
                            "failed",
                            "Skalarwert weicht vom erwarteten Wert ab.".to_string(),
                        )
                    }
                }
                Err(_) => ("error", "Abfrage fehlgeschlagen.".to_string()),
            };
            CheckResult {
                id: id.clone(),
                kind: "scalar_equals",
                status,
                message,
                total_cost: None,
                seq_scans: None,
                index_suggestions: Vec::new(),
            }
        }
        CheckSpec::Plan {
            id,
            sql,
            max_cost,
            max_seq_scans,
            max_index_suggestions,
        } => match adapter.explain_query(sql, false).await {
            Ok(plan) => {
                let Some(node) = root(&plan) else {
                    return CheckResult {
                        id: id.clone(),
                        kind: "plan",
                        status: "error",
                        message: "Kein gültiger Plan erhalten.".into(),
                        total_cost: None,
                        seq_scans: None,
                        index_suggestions: Vec::new(),
                    };
                };
                let cost = node.get("Total Cost").and_then(Value::as_f64);
                let seq_scans = count_seq_scans(node);
                let advice = index_advisor::advise(adapter, &plan).await;
                let (status, message, index_suggestions) = match advice {
                    Ok(index_suggestions) => {
                        let mut failures = Vec::new();
                        if max_cost.is_some_and(|limit| cost.is_none_or(|value| value > limit)) {
                            failures.push("Plankosten über Grenzwert");
                        }
                        if max_seq_scans.is_some_and(|limit| seq_scans > limit) {
                            failures.push("zu viele Seq Scans");
                        }
                        if max_index_suggestions
                            .is_some_and(|limit| index_suggestions.len() > limit)
                        {
                            failures.push("zu viele Indexkandidaten");
                        }
                        let status = if failures.is_empty() {
                            "passed"
                        } else {
                            "failed"
                        };
                        let message = if failures.is_empty() {
                            "Plangrenzwerte eingehalten.".into()
                        } else {
                            failures.join(", ")
                        };
                        (status, message, index_suggestions)
                    }
                    Err(_) => ("error", "Indexanalyse fehlgeschlagen.".into(), Vec::new()),
                };
                CheckResult {
                    id: id.clone(),
                    kind: "plan",
                    status,
                    message,
                    total_cost: cost,
                    seq_scans: Some(seq_scans),
                    index_suggestions,
                }
            }
            Err(_) => CheckResult {
                id: id.clone(),
                kind: "plan",
                status: "error",
                message: "EXPLAIN fehlgeschlagen.".into(),
                total_cost: None,
                seq_scans: None,
                index_suggestions: Vec::new(),
            },
        },
    }
}

async fn run_checks(config: &CheckFile, url: &str) -> Result<CheckReport, String> {
    let pool = db::pool::create_pool_state();
    let adapter = db::create_adapter_from_string(db::DatabaseKind::Postgres, url, None, pool)
        .map_err(|_| "Datenbankadapter konnte nicht erstellt werden.".to_string())?;
    adapter
        .test_connection()
        .await
        .map_err(|_| "Datenbankverbindung fehlgeschlagen.".to_string())?;
    let mut checks = Vec::new();
    for check in &config.checks {
        checks.push(run_check(adapter.as_ref(), check).await);
    }
    let passed = checks.iter().all(|check| check.status == "passed");
    Ok(CheckReport {
        format: 1,
        passed,
        checks,
    })
}

pub fn cli(args: &[String]) -> i32 {
    let parsed = match parse_args(args) {
        Ok(parsed) => parsed,
        Err(error) => {
            eprintln!("{error}");
            return 2;
        }
    };
    if let Some(path) = &parsed.output {
        let same_path = Path::new(path) == Path::new(&parsed.config)
            || std::fs::canonicalize(path)
                .ok()
                .zip(std::fs::canonicalize(&parsed.config).ok())
                .is_some_and(|(output, config)| output == config);
        if same_path {
            eprintln!("Bericht und Prüfdatei müssen verschiedene Dateien sein.");
            return 2;
        }
        if let Err(error) = std::fs::remove_file(path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!("Alter Bericht konnte nicht entfernt werden: {error}");
                return 2;
            }
        }
    }
    let config = match load_config(&parsed.config) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            return 2;
        }
    };
    let url = match std::env::var(&parsed.url_env)
        .map_err(|_| "Datenbank-URL fehlt in der angegebenen Umgebungsvariable.".to_string())
        .and_then(|url| read_only_url(&url))
    {
        Ok(url) => url,
        Err(error) => {
            eprintln!("{error}");
            return 2;
        }
    };
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => {
            eprintln!("Tokio-Runtime konnte nicht gestartet werden.");
            return 2;
        }
    };
    let report = match runtime.block_on(run_checks(&config, &url)) {
        Ok(report) => report,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let json = match serde_json::to_string_pretty(&report) {
        Ok(json) => json,
        Err(_) => {
            eprintln!("Bericht konnte nicht serialisiert werden.");
            return 1;
        }
    };
    if let Some(path) = parsed.output {
        if let Err(error) = std::fs::write(&path, &json) {
            eprintln!("Bericht konnte nicht geschrieben werden: {error}");
            return 1;
        }
    }
    println!("{json}");
    i32::from(!report.passed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_write_statements_and_multiple_queries() {
        for sql in [
            "DELETE FROM users",
            "WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x",
            "SELECT 1; SELECT 2",
            "SELECT pg_read_file('/tmp/a')",
            "SELECT pg_catalog.set_config('default_transaction_read_only', 'off', false)",
        ] {
            assert!(validate_sql(sql).is_err(), "{sql}");
        }
        assert!(validate_sql("SELECT ';' AS value").is_ok());
    }

    #[test]
    fn preserves_connection_options_and_forces_read_only() {
        use std::str::FromStr;

        let url = read_only_url(
            "postgres://u:p@localhost/db?sslmode=require&application_name=a+b&options=-c%20search_path%3Dapp",
        )
        .unwrap();
        let parsed = url::Url::parse(&url).unwrap();
        assert_eq!(
            parsed
                .query_pairs()
                .find(|(key, _)| key == "sslmode")
                .unwrap()
                .1,
            "require"
        );
        assert!(parsed.query_pairs().any(|(key, value)| key == "options"
            && value.contains("default_transaction_read_only=on")
            && value.contains("statement_timeout=30000")));
        assert!(parsed
            .query_pairs()
            .any(|(key, value)| key == "options" && value.contains("search_path=app")));
        let parsable =
            read_only_url("postgres://u:p@localhost/db?options=-c%20search_path%3Dapp").unwrap();
        let config = tokio_postgres::Config::from_str(&parsable).unwrap();
        assert!(config
            .get_options()
            .is_some_and(|options| options.contains("-c default_transaction_read_only=on")));
        let plus = read_only_url("postgres://u:p@localhost/db?application_name=a+b").unwrap();
        let config = tokio_postgres::Config::from_str(&plus).unwrap();
        assert_eq!(config.get_application_name(), Some("a+b"));
    }

    #[test]
    fn plan_counts_nested_scans() {
        let plan = serde_json::json!({"Node Type":"Nested Loop","Plans":[{"Node Type":"Seq Scan"},{"Node Type":"Index Scan"},{"Node Type":"Seq Scan"}]});
        assert_eq!(count_seq_scans(&plan), 2);
    }

    #[test]
    fn compares_text_encoded_postgres_scalars_by_expected_type() {
        assert!(scalar_matches(
            Some(&Value::String("42".into())),
            &serde_json::json!(42)
        ));
        assert!(scalar_matches(
            Some(&Value::String("t".into())),
            &serde_json::json!(true)
        ));
        assert!(scalar_matches(
            Some(&Value::String("f".into())),
            &serde_json::json!(false)
        ));
        assert!(scalar_matches(Some(&Value::Null), &Value::Null));
        assert!(!scalar_matches(
            Some(&Value::String("42".into())),
            &serde_json::json!(43)
        ));
    }

    #[test]
    fn scalar_query_caps_returned_rows_and_accepts_trailing_semicolon() {
        assert_eq!(
            scalar_query(" SELECT generate_series(1, 100000); "),
            "SELECT * FROM (SELECT generate_series(1, 100000)) AS l8db_check LIMIT 1"
        );
    }
}
