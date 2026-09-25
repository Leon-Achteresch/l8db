use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use super::config::{McpConfig, McpConnection};
use super::nosql;
use super::redact::{self, Redactor};
use super::server::{self, Server};
use crate::db::{DatabaseAdapter, DatabaseKind};

pub const MAX_REPEATS: u64 = 500;
pub const MAX_CONCURRENCY: u64 = 16;
const DEFAULT_REPEATS: u64 = 5;
const MAX_STATEMENTS: usize = 200;
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

pub fn tool_definition() -> Value {
    json!({
        "name": "benchmark",
        "description": "Measure read-only statements. Runs sql, or every statement of a saved l8db file (.l8perf.json or .l8workload.json), repeats times with up to concurrency parallel executions. Returns JSON per statement: runs, errors, min/median/p95/max/avg ms and throughput per second. No row data is returned. Same read-only rules as query.",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": server::database_arg(),
            "sql": {"type": "string"},
            "file": {"type": "string", "description": "Absolute path to a .l8perf.json or .l8workload.json file saved by l8db"},
            "repeats": {"type": "integer", "minimum": 1, "maximum": MAX_REPEATS},
            "concurrency": {"type": "integer", "minimum": 1, "maximum": MAX_CONCURRENCY}
        }, "required": ["connection"]}
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct Statement {
    pub sql: String,
    pub params: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Stats {
    pub min: f64,
    pub median: f64,
    pub p95: f64,
    pub max: f64,
    pub avg: f64,
}

pub fn stats(samples: &[f64]) -> Option<Stats> {
    let mut sorted: Vec<f64> = samples.iter().copied().filter(|v| v.is_finite()).collect();
    if sorted.is_empty() {
        return None;
    }
    sorted.sort_by(|a, b| a.total_cmp(b));
    let n = sorted.len();
    let median = if n.is_multiple_of(2) {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    } else {
        sorted[n / 2]
    };
    let rank = ((0.95 * n as f64).ceil() as usize).clamp(1, n) - 1;
    Some(Stats {
        min: sorted[0],
        median,
        p95: sorted[rank],
        max: sorted[n - 1],
        avg: sorted.iter().sum::<f64>() / n as f64,
    })
}

fn round(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

type ParsedFile = (Vec<Statement>, Option<u64>, Option<u64>);

pub fn statements_from_file(path: &str) -> Result<ParsedFile, String> {
    let path = std::path::Path::new(path.trim());
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !name.ends_with(".json") {
        return Err(
            "file muss eine mit l8db gespeicherte .l8perf.json- oder .l8workload.json-Datei sein."
                .into(),
        );
    }
    let size = std::fs::metadata(path)
        .map_err(|_| "file konnte nicht gelesen werden.".to_string())?
        .len();
    if size > MAX_FILE_BYTES {
        return Err("file ist zu groß.".into());
    }
    let text = std::fs::read_to_string(path)
        .map_err(|_| "file konnte nicht gelesen werden.".to_string())?;
    parse_file(&text)
}

pub fn parse_file(text: &str) -> Result<ParsedFile, String> {
    let data: Value = serde_json::from_str(text)
        .map_err(|_| "file ist keine gültige l8db-Datei (JSON erwartet).".to_string())?;
    match data.get("kind").and_then(Value::as_str) {
        Some("l8db.perf-test") => {
            let sql = data
                .get("sql")
                .and_then(Value::as_str)
                .filter(|sql| !sql.trim().is_empty())
                .ok_or("Die Perf-Datei enthält keinen SQL-Text.")?;
            let definition = data.get("definition");
            let repeats = definition
                .and_then(|d| d.get("repeats"))
                .and_then(Value::as_u64);
            let concurrency = data.get("concurrency").and_then(Value::as_u64).or_else(|| {
                definition
                    .and_then(|d| d.get("concurrency"))
                    .and_then(Value::as_u64)
            });
            Ok((
                vec![Statement {
                    sql: sql.to_string(),
                    params: None,
                }],
                repeats,
                concurrency,
            ))
        }
        Some("l8db.workload") => {
            let list = data
                .get("statements")
                .and_then(Value::as_array)
                .filter(|list| !list.is_empty())
                .ok_or("Die Workload-Datei enthält keine Statements.")?;
            if list.len() > MAX_STATEMENTS {
                return Err(format!(
                    "Die Workload-Datei enthält mehr als {MAX_STATEMENTS} Statements."
                ));
            }
            let statements = list
                .iter()
                .map(|entry| {
                    let sql = entry
                        .get("sql")
                        .and_then(Value::as_str)
                        .filter(|sql| !sql.trim().is_empty())
                        .ok_or("Ein Statement der Workload-Datei hat keinen SQL-Text.")?;
                    let params = entry.get("params").and_then(Value::as_array).map(|params| {
                        params
                            .iter()
                            .map(|param| match param {
                                Value::String(text) => text.clone(),
                                Value::Null => String::new(),
                                other => other.to_string(),
                            })
                            .collect::<Vec<_>>()
                    });
                    Ok(Statement {
                        sql: sql.to_string(),
                        params: params.filter(|params| !params.is_empty()),
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            Ok((statements, None, None))
        }
        _ => Err("file ist keine l8db-Perf- oder Workload-Datei.".into()),
    }
}

fn clamp_arg(args: &Value, key: &str, fallback: u64, max: u64) -> u64 {
    args.get(key)
        .and_then(Value::as_u64)
        .unwrap_or(fallback)
        .clamp(1, max)
}

fn preview(sql: &str) -> String {
    let flat = sql.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > 200 {
        format!("{}…", flat.chars().take(200).collect::<String>())
    } else {
        flat
    }
}

pub struct Sample {
    pub ms: f64,
    pub error: Option<String>,
}

async fn measure(
    config: &McpConfig,
    kind: DatabaseKind,
    adapter: &dyn DatabaseAdapter,
    statement: &Statement,
    repeats: u64,
    concurrency: u64,
) -> (Vec<Sample>, f64) {
    let next = AtomicUsize::new(0);
    let samples = Mutex::new(Vec::with_capacity(repeats as usize));
    let started = Instant::now();
    let worker = || async {
        loop {
            if next.fetch_add(1, Ordering::Relaxed) >= repeats as usize {
                return;
            }
            let run_started = Instant::now();
            let outcome = server::run(config, kind, async {
                match &statement.params {
                    Some(params) => {
                        let values: Vec<Option<String>> =
                            params.iter().map(|value| Some(value.clone())).collect();
                        adapter
                            .execute_query_with_params(&statement.sql, &values)
                            .await
                    }
                    None => adapter.execute_query(&statement.sql).await,
                }
            })
            .await;
            let ms = run_started.elapsed().as_secs_f64() * 1000.0;
            let sample = match outcome {
                Ok(_) => Sample { ms, error: None },
                Err(error) => Sample {
                    ms,
                    error: Some(server::scrub_error(&error)),
                },
            };
            let failed_first = sample.error.is_some()
                && samples
                    .lock()
                    .map(|list| list.iter().all(|s: &Sample| s.error.is_some()))
                    .unwrap_or(true);
            if let Ok(mut list) = samples.lock() {
                list.push(sample);
            }
            if failed_first {
                next.store(repeats as usize, Ordering::Relaxed);
                return;
            }
        }
    };
    let workers: Vec<_> = (0..concurrency.min(repeats)).map(|_| worker()).collect();
    futures_util::future::join_all(workers).await;
    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
    (samples.into_inner().unwrap_or_default(), elapsed)
}

pub fn statement_report(sql: &str, samples: &[Sample], elapsed_ms: f64) -> Value {
    let ok: Vec<f64> = samples
        .iter()
        .filter(|s| s.error.is_none())
        .map(|s| s.ms)
        .collect();
    let errors = samples.len() - ok.len();
    let first_error = samples.iter().find_map(|s| s.error.clone());
    let summary = stats(&ok);
    let throughput = if elapsed_ms > 0.0 && !ok.is_empty() {
        Some(round(ok.len() as f64 / (elapsed_ms / 1000.0)))
    } else {
        None
    };
    json!({
        "sql": preview(sql),
        "runs": samples.len(),
        "errors": errors,
        "first_error": first_error,
        "min_ms": summary.as_ref().map(|s| round(s.min)),
        "median_ms": summary.as_ref().map(|s| round(s.median)),
        "p95_ms": summary.as_ref().map(|s| round(s.p95)),
        "max_ms": summary.as_ref().map(|s| round(s.max)),
        "avg_ms": summary.as_ref().map(|s| round(s.avg)),
        "throughput_per_sec": throughput,
    })
}

impl Server {
    fn read_check(
        connection: &McpConnection,
        sql: &str,
        index: &redact::SchemaIndex,
        redactor: &Redactor,
    ) -> Result<(), String> {
        match connection.kind {
            DatabaseKind::Mongodb => {
                nosql::mongo_check(&nosql::mongo_command(sql)?, false, false, redactor, index)
            }
            DatabaseKind::Redis => nosql::redis_check(sql, false),
            _ => server::check_read_sql(sql, connection, index),
        }
    }

    pub(super) async fn benchmark(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        args: &Value,
    ) -> Result<String, String> {
        let sql = server::arg_str(args, "sql").trim();
        let file = server::arg_str(args, "file").trim();
        let (statements, file_repeats, file_concurrency) = match (sql.is_empty(), file.is_empty()) {
            (false, true) => (
                vec![Statement {
                    sql: sql.to_string(),
                    params: None,
                }],
                None,
                None,
            ),
            (true, false) => statements_from_file(file)?,
            (false, false) => return Err("Entweder sql oder file angeben, nicht beides.".into()),
            (true, true) => return Err("sql oder file fehlt".into()),
        };
        let repeats = clamp_arg(
            args,
            "repeats",
            file_repeats.unwrap_or(DEFAULT_REPEATS),
            MAX_REPEATS,
        );
        let concurrency = clamp_arg(
            args,
            "concurrency",
            file_concurrency.unwrap_or(1),
            MAX_CONCURRENCY,
        );
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let columns = self.columns_for(config, connection).await?;
        let index = redact::SchemaIndex::new(&columns, &redactor, &connection.schemas);
        let adapter = server::adapter(connection, &self.pool)?;
        let mut reports = Vec::new();
        let mut skipped = Vec::new();
        for statement in &statements {
            let text = statement.sql.trim().trim_end_matches(';').trim();
            if let Err(reason) = Self::read_check(connection, text, &index, &redactor) {
                skipped.push(json!({"sql": preview(text), "reason": server::scrub_error(&reason)}));
                continue;
            }
            let prepared = Statement {
                sql: text.to_string(),
                params: statement.params.clone(),
            };
            let (samples, elapsed) = measure(
                config,
                connection.kind,
                adapter.as_ref(),
                &prepared,
                repeats,
                concurrency,
            )
            .await;
            reports.push(statement_report(text, &samples, elapsed));
        }
        if reports.is_empty() {
            let reasons: Vec<String> = skipped
                .iter()
                .filter_map(|entry| entry["reason"].as_str().map(str::to_string))
                .collect();
            return Err(format!("Kein Statement messbar: {}", reasons.join("; ")));
        }
        Ok(serde_json::to_string_pretty(&json!({
            "connection": connection.name,
            "repeats": repeats,
            "concurrency": concurrency,
            "statements": reports,
            "skipped": skipped,
        }))
        .unwrap_or_default())
    }
}

#[derive(Debug)]
pub struct CliArgs {
    pub connection: String,
    pub sql: Option<String>,
    pub file: Option<String>,
    pub repeats: Option<u64>,
    pub concurrency: Option<u64>,
    pub max_median_ms: Option<f64>,
}

pub const CLI_USAGE: &str = "Aufruf: l8db --benchmark --connection <Name|ID> (--sql <SQL> | --file <Pfad>) [--repeats N] [--concurrency N] [--max-median-ms X]";

pub fn parse_cli(args: &[String]) -> Result<CliArgs, String> {
    let mut parsed = CliArgs {
        connection: String::new(),
        sql: None,
        file: None,
        repeats: None,
        concurrency: None,
        max_median_ms: None,
    };
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        let mut value = |name: &str| {
            iter.next()
                .cloned()
                .ok_or_else(|| format!("{name} braucht einen Wert. {CLI_USAGE}"))
        };
        match arg.as_str() {
            "--benchmark" => {}
            "--connection" => parsed.connection = value("--connection")?,
            "--sql" => parsed.sql = Some(value("--sql")?),
            "--file" => parsed.file = Some(value("--file")?),
            "--repeats" => {
                parsed.repeats = Some(
                    value("--repeats")?
                        .parse()
                        .map_err(|_| "--repeats erwartet eine Zahl".to_string())?,
                )
            }
            "--concurrency" => {
                parsed.concurrency = Some(
                    value("--concurrency")?
                        .parse()
                        .map_err(|_| "--concurrency erwartet eine Zahl".to_string())?,
                )
            }
            "--max-median-ms" => {
                parsed.max_median_ms = Some(
                    value("--max-median-ms")?
                        .parse()
                        .map_err(|_| "--max-median-ms erwartet eine Zahl".to_string())?,
                )
            }
            other => return Err(format!("Unbekanntes Argument {other}. {CLI_USAGE}")),
        }
    }
    if parsed.connection.trim().is_empty() {
        return Err(format!("--connection fehlt. {CLI_USAGE}"));
    }
    if parsed.sql.is_some() == parsed.file.is_some() {
        return Err(format!(
            "Genau eines von --sql oder --file angeben. {CLI_USAGE}"
        ));
    }
    Ok(parsed)
}

pub fn verdict(report: &Value, max_median_ms: Option<f64>) -> Result<(), String> {
    let statements = report["statements"].as_array().cloned().unwrap_or_default();
    let mut problems = Vec::new();
    if let Some(skipped) = report["skipped"].as_array() {
        for entry in skipped {
            problems.push(format!(
                "übersprungen: {} ({})",
                entry["sql"].as_str().unwrap_or(""),
                entry["reason"].as_str().unwrap_or("")
            ));
        }
    }
    for statement in &statements {
        let sql = statement["sql"].as_str().unwrap_or("");
        if statement["errors"].as_u64().unwrap_or(0) > 0 {
            problems.push(format!(
                "Fehler: {sql} ({})",
                statement["first_error"].as_str().unwrap_or("")
            ));
        }
        if let (Some(limit), Some(median)) = (max_median_ms, statement["median_ms"].as_f64()) {
            if median > limit {
                problems.push(format!("Median {median} ms > {limit} ms: {sql}"));
            }
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems.join("\n"))
    }
}

pub fn cli(args: &[String]) -> i32 {
    let parsed = match parse_cli(args) {
        Ok(parsed) => parsed,
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
        Err(error) => {
            eprintln!("Tokio-Runtime: {error}");
            return 2;
        }
    };
    let mut server = Server {
        pool: crate::db::pool::create_pool_state(),
        columns: std::collections::HashMap::new(),
    };
    let mut arguments = json!({"connection": parsed.connection});
    if let Some(sql) = &parsed.sql {
        arguments["sql"] = json!(sql);
    }
    if let Some(file) = &parsed.file {
        arguments["file"] = json!(file);
    }
    if let Some(repeats) = parsed.repeats {
        arguments["repeats"] = json!(repeats);
    }
    if let Some(concurrency) = parsed.concurrency {
        arguments["concurrency"] = json!(concurrency);
    }
    let reply =
        runtime.block_on(server.call(&json!({"name": "benchmark", "arguments": arguments})));
    let text = reply["content"][0]["text"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if reply["isError"].as_bool().unwrap_or(true) {
        eprintln!("{text}");
        return 1;
    }
    println!("{text}");
    let report: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    match verdict(&report, parsed.max_median_ms) {
        Ok(()) => 0,
        Err(problems) => {
            eprintln!("{problems}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::config::McpConfig;
    use crate::mcp::TEST_ENV_LOCK;
    use std::collections::HashMap;

    fn sample(ms: f64, error: Option<&str>) -> Sample {
        Sample {
            ms,
            error: error.map(str::to_string),
        }
    }

    #[test]
    fn stats_match_frontend_percentiles() {
        let s = stats(&[30.0, 10.0, 20.0]).unwrap();
        assert_eq!(
            (s.min, s.median, s.p95, s.max, s.avg),
            (10.0, 20.0, 30.0, 30.0, 20.0)
        );
        assert_eq!(stats(&[10.0, 20.0, 30.0, 40.0]).unwrap().median, 25.0);
        let twenty: Vec<f64> = (1..=20).map(f64::from).collect();
        assert_eq!(stats(&twenty).unwrap().p95, 19.0);
        let hundred: Vec<f64> = (1..=100).map(f64::from).collect();
        assert_eq!(stats(&hundred).unwrap().p95, 95.0);
        assert_eq!(stats(&[7.0]).unwrap().p95, 7.0);
        assert!(stats(&[]).is_none());
        assert!(stats(&[f64::NAN, f64::INFINITY]).is_none());
    }

    #[test]
    fn parses_perf_and_workload_files() {
        let (perf, repeats, concurrency) = parse_file(
            r#"{"kind":"l8db.perf-test","version":2,"mode":"TIMED","sql":"select 1","concurrency":4,"definition":{"table":"t","repeats":9}}"#,
        )
        .unwrap();
        assert_eq!(
            perf,
            vec![Statement {
                sql: "select 1".into(),
                params: None
            }]
        );
        assert_eq!((repeats, concurrency), (Some(9), Some(4)));

        let (old, repeats, concurrency) =
            parse_file(r#"{"kind":"l8db.perf-test","version":1,"sql":"select 2","runs":[]}"#)
                .unwrap();
        assert_eq!(old[0].sql, "select 2");
        assert_eq!((repeats, concurrency), (None, None));

        let (workload, _, _) = parse_file(
            r#"{"kind":"l8db.workload","version":1,"statements":[{"sql":"select $1, $2, $3","params":["a",null,3]},{"sql":"select 1","params":[]},{"sql":"select 2"}]}"#,
        )
        .unwrap();
        assert_eq!(
            workload[0].params,
            Some(vec!["a".to_string(), String::new(), "3".to_string()])
        );
        assert_eq!(workload[1].params, None);
        assert_eq!(workload[2].params, None);

        assert!(parse_file("{}").unwrap_err().contains("keine l8db"));
        assert!(parse_file("nope").unwrap_err().contains("JSON"));
        assert!(parse_file(r#"{"kind":"l8db.workload","statements":[]}"#)
            .unwrap_err()
            .contains("keine Statements"));
        assert!(
            parse_file(r#"{"kind":"l8db.workload","statements":[{"sql":"  "}]}"#)
                .unwrap_err()
                .contains("keinen SQL-Text")
        );
        let many: Vec<Value> = (0..=MAX_STATEMENTS)
            .map(|i| json!({"sql": format!("select {i}")}))
            .collect();
        let big = json!({"kind": "l8db.workload", "statements": many}).to_string();
        assert!(parse_file(&big).unwrap_err().contains("mehr als"));
    }

    #[test]
    fn file_reader_rejects_foreign_paths_without_leaking_content() {
        let dir = std::env::temp_dir().join(format!("l8db-bench-file-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let secret = dir.join("secret.txt");
        std::fs::write(&secret, "top secret password").unwrap();
        let error = statements_from_file(secret.to_str().unwrap()).unwrap_err();
        assert!(!error.contains("secret password"));
        let json_file = dir.join("other.json");
        std::fs::write(&json_file, r#"{"password":"hunter2"}"#).unwrap();
        let error = statements_from_file(json_file.to_str().unwrap()).unwrap_err();
        assert!(!error.contains("hunter2"));
        let missing = statements_from_file(dir.join("missing.json").to_str().unwrap()).unwrap_err();
        assert!(missing.contains("nicht gelesen"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_cli_arguments() {
        let args: Vec<String> = [
            "--benchmark",
            "--connection",
            "Prod",
            "--sql",
            "select 1",
            "--repeats",
            "20",
            "--concurrency",
            "4",
            "--max-median-ms",
            "12.5",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let parsed = parse_cli(&args).unwrap();
        assert_eq!(parsed.connection, "Prod");
        assert_eq!(parsed.sql.as_deref(), Some("select 1"));
        assert_eq!((parsed.repeats, parsed.concurrency), (Some(20), Some(4)));
        assert_eq!(parsed.max_median_ms, Some(12.5));

        let to_args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(parse_cli(&to_args(&["--benchmark", "--sql", "x"]))
            .unwrap_err()
            .contains("--connection"));
        assert!(parse_cli(&to_args(&["--connection", "a"]))
            .unwrap_err()
            .contains("Genau eines"));
        assert!(parse_cli(&to_args(&[
            "--connection",
            "a",
            "--sql",
            "x",
            "--file",
            "y"
        ]))
        .unwrap_err()
        .contains("Genau eines"));
        assert!(
            parse_cli(&to_args(&["--connection", "a", "--sql", "x", "--wat"]))
                .unwrap_err()
                .contains("Unbekanntes Argument")
        );
        assert!(parse_cli(&to_args(&[
            "--connection",
            "a",
            "--sql",
            "x",
            "--repeats",
            "viele"
        ]))
        .unwrap_err()
        .contains("Zahl"));
        assert!(parse_cli(&to_args(&["--connection", "a", "--sql"]))
            .unwrap_err()
            .contains("braucht einen Wert"));
    }

    #[test]
    fn report_and_verdict() {
        let samples = vec![
            sample(10.0, None),
            sample(30.0, None),
            sample(5.0, Some("boom")),
        ];
        let report = statement_report("select\n  1", &samples, 1000.0);
        assert_eq!(report["sql"], "select 1");
        assert_eq!(report["runs"], 3);
        assert_eq!(report["errors"], 1);
        assert_eq!(report["first_error"], "boom");
        assert_eq!(report["median_ms"], 20.0);
        assert_eq!(report["throughput_per_sec"], 2.0);

        let failed = statement_report("select 2", &[sample(1.0, Some("x"))], 5.0);
        assert!(failed["median_ms"].is_null());
        assert!(failed["throughput_per_sec"].is_null());

        let ok =
            json!({"statements": [{"sql": "a", "errors": 0, "median_ms": 5.0}], "skipped": []});
        assert!(verdict(&ok, None).is_ok());
        assert!(verdict(&ok, Some(10.0)).is_ok());
        assert!(verdict(&ok, Some(4.0)).unwrap_err().contains("Median 5"));
        let with_errors = json!({"statements": [{"sql": "a", "errors": 2, "first_error": "kaputt", "median_ms": 1.0}], "skipped": []});
        assert!(verdict(&with_errors, None).unwrap_err().contains("kaputt"));
        let with_skip =
            json!({"statements": [], "skipped": [{"sql": "delete", "reason": "read-only"}]});
        assert!(verdict(&with_skip, None)
            .unwrap_err()
            .contains("übersprungen"));
    }

    struct Lab {
        dir: std::path::PathBuf,
        server: Server,
        runtime: tokio::runtime::Runtime,
        db: std::path::PathBuf,
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    impl Drop for Lab {
        fn drop(&mut self) {
            std::env::remove_var("L8DB_MCP_CONFIG");
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    impl Lab {
        fn call(&mut self, arguments: Value) -> (bool, String) {
            let reply = self.runtime.block_on(
                self.server
                    .call(&json!({"name": "benchmark", "arguments": arguments})),
            );
            (
                reply["isError"].as_bool().unwrap(),
                reply["content"][0]["text"].as_str().unwrap().to_string(),
            )
        }

        fn order_count(&self) -> i64 {
            rusqlite::Connection::open(&self.db)
                .unwrap()
                .query_row("SELECT count(*) FROM orders", [], |row| row.get(0))
                .unwrap()
        }

        fn file(&self, name: &str, content: &Value) -> String {
            let path = self.dir.join(name);
            std::fs::write(&path, content.to_string()).unwrap();
            path.to_str().unwrap().to_string()
        }
    }

    fn lab() -> Lab {
        let guard = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("l8db-bench-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("shop.db");
        rusqlite::Connection::open(&db)
            .unwrap()
            .execute_batch(
                "CREATE TABLE orders(id INTEGER PRIMARY KEY, status TEXT, amount REAL);
                 INSERT INTO orders VALUES (1,'open',10),(2,'paid',20),(3,'paid',30),(4,'open',40),(5,'paid',50);",
            )
            .unwrap();
        let url = format!("sqlite:{}", db.display());
        let connection = |id: &str, name: &str, exposed: bool| McpConnection {
            id: id.into(),
            name: name.into(),
            kind: DatabaseKind::Sqlite,
            connection_string: url.clone(),
            schemas: vec![],
            ssh: false,
            exposed,
            read_only: false,
            allow_ddl: false,
            redact_columns: vec![],
            mask_rules: vec![],
            environment: None,
            allow_production_writes: false,
            database: None,
        };
        let config = McpConfig {
            enabled: true,
            connections: vec![
                connection("shop", "Shop", true),
                connection("hidden", "Hidden", false),
            ],
            ..McpConfig::default()
        };
        let config_path = dir.join("mcp.json");
        std::fs::write(&config_path, serde_json::to_vec(&config).unwrap()).unwrap();
        std::env::set_var("L8DB_MCP_CONFIG", &config_path);
        Lab {
            dir,
            server: Server {
                pool: crate::db::pool::create_pool_state(),
                columns: HashMap::new(),
            },
            runtime: tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap(),
            db,
            _guard: guard,
        }
    }

    #[test]
    fn benchmark_tool_measures_sqlite_statements() {
        let mut lab = lab();
        let (error, text) = lab.call(json!({
            "connection": "Shop",
            "sql": "SELECT status, sum(amount) FROM orders GROUP BY status;",
            "repeats": 7,
            "concurrency": 3
        }));
        assert!(!error, "{text}");
        let report: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(report["repeats"], 7);
        assert_eq!(report["concurrency"], 3);
        let statement = &report["statements"][0];
        assert_eq!(statement["runs"], 7);
        assert_eq!(statement["errors"], 0);
        let median = statement["median_ms"].as_f64().unwrap();
        let p95 = statement["p95_ms"].as_f64().unwrap();
        assert!(median >= 0.0 && p95 >= median && statement["max_ms"].as_f64().unwrap() >= p95);
        assert!(statement["throughput_per_sec"].as_f64().unwrap() > 0.0);
        assert!(!text.contains("paid"), "benchmark must not return row data");

        let (error, text) = lab.call(
            json!({"connection": "Shop", "sql": "SELECT 1", "repeats": 9999, "concurrency": 999}),
        );
        assert!(!error, "{text}");
        let report: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(report["repeats"], MAX_REPEATS);
        assert_eq!(report["concurrency"], MAX_CONCURRENCY);

        let audit = std::fs::read_to_string(crate::mcp::config::audit_path()).unwrap_or_default();
        assert!(
            audit.contains("\"benchmark\""),
            "audit log misses benchmark: {audit}"
        );
    }

    #[test]
    fn benchmark_tool_refuses_writes_and_hidden_connections() {
        let mut lab = lab();
        let (error, text) =
            lab.call(json!({"connection": "Shop", "sql": "DELETE FROM orders", "repeats": 3}));
        assert!(error);
        assert!(text.contains("Kein Statement messbar"), "{text}");
        let (error, _) =
            lab.call(json!({"connection": "Shop", "sql": "SELECT 1; DELETE FROM orders"}));
        assert!(error);
        assert_eq!(lab.order_count(), 5);

        let (error, text) = lab.call(json!({"connection": "Hidden", "sql": "SELECT 1"}));
        assert!(error);
        assert!(text.contains("nicht freigegeben"), "{text}");

        let (error, text) = lab.call(json!({"connection": "Shop"}));
        assert!(error && text.contains("fehlt"), "{text}");
        let path = lab.file(
            "x.l8workload.json",
            &json!({"kind": "l8db.workload", "statements": [{"sql": "select 1"}]}),
        );
        let (error, text) =
            lab.call(json!({"connection": "Shop", "sql": "SELECT 1", "file": path}));
        assert!(error && text.contains("nicht beides"), "{text}");
    }

    #[test]
    fn benchmark_tool_stops_after_failing_first_run() {
        let mut lab = lab();
        let (error, text) = lab.call(json!({"connection": "Shop", "sql": "SELECT * FROM orders WHERE nope = 1", "repeats": 50}));
        assert!(!error, "{text}");
        let statement = &serde_json::from_str::<Value>(&text).unwrap()["statements"][0];
        assert_eq!(statement["runs"], 1);
        assert_eq!(statement["errors"], 1);
        assert!(statement["first_error"].as_str().unwrap().contains("nope"));
        assert!(statement["median_ms"].is_null());

        let (_, text) = lab.call(json!({"connection": "Shop", "sql": "SELECT * FROM orders WHERE nope = 1", "repeats": 50, "concurrency": 4}));
        let statement = &serde_json::from_str::<Value>(&text).unwrap()["statements"][0];
        let runs = statement["runs"].as_u64().unwrap();
        assert!((1..=4).contains(&runs), "runs {runs}");
        assert_eq!(statement["errors"].as_u64().unwrap(), runs);
    }

    #[test]
    fn benchmark_tool_replays_saved_files() {
        let mut lab = lab();
        let workload = lab.file(
            "shop.l8workload.json",
            &json!({
                "kind": "l8db.workload",
                "version": 1,
                "statements": [
                    {"sql": "SELECT count(*) FROM orders WHERE status = 'paid'"},
                    {"sql": "DELETE FROM orders"},
                    {"sql": "SELECT max(amount) FROM orders"}
                ]
            }),
        );
        let (error, text) = lab.call(json!({"connection": "Shop", "file": workload, "repeats": 4}));
        assert!(!error, "{text}");
        let report: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(report["statements"].as_array().unwrap().len(), 2);
        assert_eq!(report["skipped"].as_array().unwrap().len(), 1);
        assert!(report["skipped"][0]["sql"]
            .as_str()
            .unwrap()
            .starts_with("DELETE"));
        assert_eq!(report["statements"][1]["runs"], 4);
        assert_eq!(lab.order_count(), 5);

        let perf = lab.file(
            "orders.l8perf.json",
            &json!({"kind": "l8db.perf-test", "version": 2, "mode": "TIMED", "sql": "SELECT * FROM orders", "concurrency": 2, "definition": {"table": "orders", "repeats": 6}, "runs": []}),
        );
        let (error, text) = lab.call(json!({"connection": "Shop", "file": perf}));
        assert!(!error, "{text}");
        let report: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(report["repeats"], 6);
        assert_eq!(report["concurrency"], 2);
        assert_eq!(report["statements"][0]["runs"], 6);

        let (error, text) = lab.call(
            json!({"connection": "Shop", "file": lab.dir.join("mcp.json").to_str().unwrap()}),
        );
        assert!(error);
        assert!(!text.contains("Shop"), "config content leaked: {text}");
    }
}
