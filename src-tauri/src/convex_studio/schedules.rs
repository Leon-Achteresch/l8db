use super::{deployment, ConvexDeploymentAccess};
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};

const MAX_PAGE_SIZE: u32 = 100;
const MAX_CRON_RUNS: usize = 200;
const MAX_LOG_LINES: usize = 50;
const MAX_ARGS_BYTES: usize = 1_000_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexScheduledJob {
    pub id: String,
    pub udf_path: String,
    pub function: String,
    pub state: String,
    pub error: Option<String>,
    pub scheduled_ms: Option<f64>,
    pub original_scheduled_ms: Option<f64>,
    pub completed_ms: Option<f64>,
    pub created_ms: Option<f64>,
    pub args_id: Option<String>,
    pub args: Option<Value>,
    pub attempts: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexScheduledJobPage {
    pub jobs: Vec<ConvexScheduledJob>,
    pub cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexCronRun {
    pub id: String,
    pub name: String,
    pub function: String,
    pub ts_ms: Option<f64>,
    pub status: String,
    pub error: Option<String>,
    pub execution_ms: Option<f64>,
    pub log_lines: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexCronJob {
    pub name: String,
    pub udf_path: String,
    pub function: String,
    pub schedule: Value,
    pub description: String,
    pub args: Value,
    pub next_run_ms: Option<f64>,
    pub last_run: Option<ConvexCronRun>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexSchedulableFunction {
    pub udf_path: String,
    pub function: String,
    pub kind: String,
    pub internal: bool,
}

fn int(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|n| n as i64)),
        Value::String(text) => text.parse().ok(),
        _ => None,
    }
}

fn ns_to_ms(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::String(text) => text.parse::<u64>().ok().map(|ns| ns as f64 / 1e6),
        Value::Number(number) => number.as_f64().map(|ns| ns / 1e6),
        _ => None,
    }
}

fn text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

pub(crate) fn display_path(udf_path: &str) -> String {
    let (module, export) = udf_path.split_once(':').unwrap_or((udf_path, "default"));
    let module = module.strip_suffix(".js").unwrap_or(module);
    if export == "default" {
        module.to_string()
    } else {
        format!("{module}:{export}")
    }
}

pub(crate) fn canonical_udf_path(path: &str) -> Result<String, String> {
    let path = path.trim();
    let invalid = || "Ungültiger Funktionspfad.".to_string();
    if path.is_empty() || path.len() > 512 {
        return Err(invalid());
    }
    let (module, export) = path.split_once(':').unwrap_or((path, "default"));
    let module = module.strip_suffix(".js").unwrap_or(module);
    let module_ok = !module.is_empty()
        && module.split('/').all(|segment| {
            !segment.is_empty()
                && segment != ".."
                && segment
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        });
    let export_ok = !export.is_empty()
        && export
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
    if !module_ok || !export_ok {
        return Err(invalid());
    }
    Ok(format!("{module}.js:{export}"))
}

fn validate_id(id: &str) -> Result<&str, String> {
    let id = id.trim();
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Ungültige Convex-ID.".into());
    }
    Ok(id)
}

pub(crate) fn decode_args(encoded: &str) -> Value {
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded.trim()) else {
        return Value::Null;
    };
    if bytes.len() > MAX_ARGS_BYTES {
        return Value::String("Argumente sind zu groß für die Anzeige.".into());
    }
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Array(mut items)) if items.len() == 1 => items.remove(0),
        Ok(value) => value,
        Err(_) => Value::Null,
    }
}

fn two(n: i64) -> String {
    format!("{n:02}")
}

fn weekday(day: i64) -> Option<&'static str> {
    [
        "Sonntag",
        "Montag",
        "Dienstag",
        "Mittwoch",
        "Donnerstag",
        "Freitag",
        "Samstag",
        "Sonntag",
    ]
    .get(usize::try_from(day).ok()?)
    .copied()
}

fn interval_text(seconds: i64) -> String {
    let units = [
        (86_400, "Tag", "Tage"),
        (3_600, "Stunde", "Stunden"),
        (60, "Minute", "Minuten"),
        (1, "Sekunde", "Sekunden"),
    ];
    for (size, one, many) in units {
        if seconds >= size && seconds % size == 0 {
            let count = seconds / size;
            return if count == 1 {
                let article = if one == "Tag" { "Jeden" } else { "Jede" };
                format!("{article} {one}")
            } else {
                format!("Alle {count} {many}")
            };
        }
    }
    format!("Alle {seconds} Sekunden")
}

fn cron_expr_text(expr: &str) -> String {
    let fallback = format!("Cron-Ausdruck „{expr}“ (UTC)");
    let fields: Vec<&str> = expr.split_whitespace().collect();
    let [minute, hour, day, month, dow] = fields.as_slice() else {
        return fallback;
    };
    let num = |field: &str| field.parse::<i64>().ok();
    let step = |field: &str| field.strip_prefix("*/").and_then(|n| n.parse::<i64>().ok());
    if *month != "*" {
        return fallback;
    }
    match (num(minute), num(hour), *day, *dow) {
        (None, None, "*", "*") if *minute == "*" && *hour == "*" => "Jede Minute".into(),
        (None, None, "*", "*") if *hour == "*" => match step(minute) {
            Some(n) => format!("Alle {n} Minuten"),
            None => fallback,
        },
        (Some(m), None, "*", "*") if *hour == "*" => format!("Stündlich um :{} UTC", two(m)),
        (Some(m), None, "*", "*") => match step(hour) {
            Some(n) => format!("Alle {n} Stunden um :{} UTC", two(m)),
            None => fallback,
        },
        (Some(m), Some(h), "*", "*") => format!("Täglich um {}:{} UTC", two(h), two(m)),
        (Some(m), Some(h), "*", dow) => match num(dow).and_then(weekday) {
            Some(name) => format!("Jeden {name} um {}:{} UTC", two(h), two(m)),
            None => fallback,
        },
        (Some(m), Some(h), day, "*") => match num(day) {
            Some(d) => format!("Monatlich am {d}. um {}:{} UTC", two(h), two(m)),
            None => fallback,
        },
        _ => fallback,
    }
}

pub(crate) fn describe_schedule(schedule: &Value) -> String {
    let minute = int(schedule.get("minuteUTC")).unwrap_or(0);
    let hour = int(schedule.get("hourUTC")).unwrap_or(0);
    let time = format!("{}:{} UTC", two(hour), two(minute));
    match schedule.get("type").and_then(Value::as_str) {
        Some("interval") => interval_text(int(schedule.get("seconds")).unwrap_or(0)),
        Some("hourly") => format!("Stündlich um :{} UTC", two(minute)),
        Some("daily") => format!("Täglich um {time}"),
        Some("weekly") => match int(schedule.get("dayOfWeek")).and_then(weekday) {
            Some(name) => format!("Jeden {name} um {time}"),
            None => format!("Wöchentlich um {time}"),
        },
        Some("monthly") => format!(
            "Monatlich am {}. um {time}",
            int(schedule.get("day")).unwrap_or(1)
        ),
        Some("cron") => cron_expr_text(
            schedule
                .get("cronExpr")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ),
        _ => "Unbekannter Zeitplan".into(),
    }
}

fn parse_job(raw: &Value) -> ConvexScheduledJob {
    let udf_path = raw
        .get("udfPath")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let state = raw.get("state");
    ConvexScheduledJob {
        id: text(raw.get("_id")).unwrap_or_default(),
        function: display_path(&udf_path),
        udf_path,
        state: state
            .and_then(|s| s.get("type"))
            .and_then(Value::as_str)
            .unwrap_or("pending")
            .to_string(),
        error: state.and_then(|s| text(s.get("error"))),
        scheduled_ms: ns_to_ms(raw.get("nextTs")),
        original_scheduled_ms: ns_to_ms(raw.get("originalScheduledTs")),
        completed_ms: ns_to_ms(raw.get("completedTs")),
        created_ms: raw.get("_creationTime").and_then(Value::as_f64),
        args_id: text(raw.get("argsId")),
        args: raw.get("udfArgs").and_then(Value::as_str).map(decode_args),
        attempts: raw.get("attempts").cloned().unwrap_or(Value::Null),
    }
}

fn parse_run(raw: &Value) -> ConvexCronRun {
    let status = raw.get("status");
    let lines = raw
        .get("logLines")
        .and_then(|l| l.get("logLines"))
        .and_then(Value::as_array);
    let total = lines.map_or(0, Vec::len);
    ConvexCronRun {
        id: text(raw.get("_id")).unwrap_or_default(),
        name: text(raw.get("name")).unwrap_or_default(),
        function: display_path(
            raw.get("udfPath")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ),
        ts_ms: ns_to_ms(raw.get("ts")),
        status: status
            .and_then(|s| s.get("type"))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        error: status.and_then(|s| text(s.get("error"))),
        execution_ms: raw
            .get("executionTime")
            .and_then(Value::as_f64)
            .map(|s| s * 1000.0),
        log_lines: lines
            .into_iter()
            .flatten()
            .take(MAX_LOG_LINES)
            .filter_map(|line| text(Some(line)))
            .collect(),
        truncated: total > MAX_LOG_LINES
            || raw
                .get("logLines")
                .and_then(|l| l.get("isTruncated"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
    }
}

fn parse_cron(raw: &Value) -> ConvexCronJob {
    let spec = raw.get("cronSpec").cloned().unwrap_or(Value::Null);
    let udf_path = spec
        .get("udfPath")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let schedule = spec.get("cronSchedule").cloned().unwrap_or(Value::Null);
    ConvexCronJob {
        name: text(raw.get("name")).unwrap_or_default(),
        function: display_path(&udf_path),
        udf_path,
        description: describe_schedule(&schedule),
        schedule,
        args: spec
            .get("udfArgs")
            .and_then(Value::as_str)
            .map_or(Value::Null, decode_args),
        next_run_ms: raw.get("nextRun").and_then(|n| ns_to_ms(n.get("nextTs"))),
        last_run: raw.get("lastRun").filter(|r| !r.is_null()).map(parse_run),
    }
}

async fn query(access: &ConvexDeploymentAccess, path: &str, args: Value) -> Result<Value, String> {
    access.run_function("query", path, args).await
}

async fn list_crons(access: &ConvexDeploymentAccess) -> Result<Vec<ConvexCronJob>, String> {
    let raw = query(access, "_system/frontend/listCronJobs", json!({})).await?;
    let mut crons: Vec<ConvexCronJob> = raw
        .as_array()
        .map(|items| items.iter().map(parse_cron).collect())
        .unwrap_or_default();
    crons.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(crons)
}

async fn list_functions(
    access: &ConvexDeploymentAccess,
) -> Result<Vec<ConvexSchedulableFunction>, String> {
    let raw = query(access, "_system/cli/modules:apiSpec", json!({})).await?;
    let mut functions: Vec<ConvexSchedulableFunction> = raw
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let kind = match item.get("functionType").and_then(Value::as_str)? {
                "Mutation" => "mutation",
                "Action" => "action",
                _ => return None,
            };
            let udf_path = item.get("identifier").and_then(Value::as_str)?.to_string();
            Some(ConvexSchedulableFunction {
                function: display_path(&udf_path),
                udf_path,
                kind: kind.into(),
                internal: item
                    .get("visibility")
                    .and_then(|v| v.get("kind"))
                    .and_then(Value::as_str)
                    == Some("internal"),
            })
        })
        .collect();
    functions.sort_by(|a, b| a.function.cmp(&b.function));
    Ok(functions)
}

#[tauri::command]
pub async fn convex_studio_schedules_jobs(
    id: String,
    project_id: u64,
    deployment_name: String,
    udf_path: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<ConvexScheduledJobPage, String> {
    let udf_path = udf_path
        .filter(|p| !p.trim().is_empty())
        .map(|p| canonical_udf_path(&p))
        .transpose()?;
    if cursor.as_ref().is_some_and(|c| c.len() > 4096) {
        return Err("Ungültiger Cursor.".into());
    }
    let limit = limit.unwrap_or(50).clamp(1, MAX_PAGE_SIZE);
    let access = deployment(&id, project_id, &deployment_name).await?;
    let mut args = json!({"paginationOpts": {"numItems": limit, "cursor": cursor}});
    if let Some(path) = udf_path {
        args["udfPath"] = Value::String(path);
    }
    let raw = query(&access, "_system/frontend/paginatedScheduledJobs", args).await?;
    let is_done = raw.get("isDone").and_then(Value::as_bool).unwrap_or(true);
    Ok(ConvexScheduledJobPage {
        jobs: raw
            .get("page")
            .and_then(Value::as_array)
            .map(|items| items.iter().map(parse_job).collect())
            .unwrap_or_default(),
        cursor: if is_done {
            None
        } else {
            text(raw.get("continueCursor"))
        },
        has_more: !is_done,
    })
}

#[tauri::command]
pub async fn convex_studio_schedules_job_args(
    id: String,
    project_id: u64,
    deployment_name: String,
    args_id: String,
) -> Result<Value, String> {
    let args_id = validate_id(&args_id)?.to_string();
    let access = deployment(&id, project_id, &deployment_name).await?;
    let raw = query(
        &access,
        "_system/frontend/scheduler:getArgs",
        json!({"argsId": args_id}),
    )
    .await?;
    Ok(raw
        .get("args")
        .and_then(Value::as_str)
        .map_or(Value::Null, decode_args))
}

#[tauri::command]
pub async fn convex_studio_schedules_cancel_job(
    id: String,
    project_id: u64,
    deployment_name: String,
    job_id: String,
) -> Result<(), String> {
    let job_id = validate_id(&job_id)?.to_string();
    let access = deployment(&id, project_id, &deployment_name).await?;
    access
        .json(
            reqwest::Method::POST,
            "api/cancel_job",
            Some(&json!({"id": job_id, "componentId": null})),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn convex_studio_schedules_cancel_all(
    id: String,
    project_id: u64,
    deployment_name: String,
    udf_path: Option<String>,
    from_ms: Option<f64>,
    until_ms: Option<f64>,
) -> Result<(), String> {
    let udf_path = udf_path
        .filter(|p| !p.trim().is_empty())
        .map(|p| canonical_udf_path(&p))
        .transpose()?;
    let to_ns = |ms: Option<f64>| -> Result<Option<u64>, String> {
        match ms {
            None => Ok(None),
            Some(ms) if ms.is_finite() && (0.0..1e13).contains(&ms) => Ok(Some((ms * 1e6) as u64)),
            Some(_) => Err("Ungültiger Zeitraum.".into()),
        }
    };
    let mut body = json!({"componentId": null});
    if let Some(path) = udf_path {
        body["udfPath"] = Value::String(path);
    }
    if let Some(ns) = to_ns(from_ms)? {
        body["startNextTs"] = json!(ns);
    }
    if let Some(ns) = to_ns(until_ms)? {
        body["endNextTs"] = json!(ns);
    }
    let access = deployment(&id, project_id, &deployment_name).await?;
    access
        .json(reqwest::Method::POST, "api/cancel_all_jobs", Some(&body))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn convex_studio_schedules_functions(
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<Vec<ConvexSchedulableFunction>, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    list_functions(&access).await
}

#[tauri::command]
pub async fn convex_studio_schedules_crons(
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<Vec<ConvexCronJob>, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    list_crons(&access).await
}

#[tauri::command]
pub async fn convex_studio_schedules_cron_runs(
    id: String,
    project_id: u64,
    deployment_name: String,
    name: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ConvexCronRun>, String> {
    if name.as_ref().is_some_and(|n| n.len() > 256) {
        return Err("Ungültiger Cron-Name.".into());
    }
    let limit = (limit.unwrap_or(50) as usize).clamp(1, MAX_CRON_RUNS);
    let access = deployment(&id, project_id, &deployment_name).await?;
    let raw = query(&access, "_system/frontend/listCronJobRuns", json!({})).await?;
    let mut runs: Vec<ConvexCronRun> = raw
        .as_array()
        .into_iter()
        .flatten()
        .filter(|run| {
            name.as_deref()
                .is_none_or(|name| run.get("name").and_then(Value::as_str) == Some(name))
        })
        .map(parse_run)
        .collect();
    runs.sort_by(|a, b| b.ts_ms.unwrap_or(0.0).total_cmp(&a.ts_ms.unwrap_or(0.0)));
    runs.truncate(limit);
    Ok(runs)
}

#[tauri::command]
pub async fn convex_studio_schedules_run_cron(
    id: String,
    project_id: u64,
    deployment_name: String,
    name: String,
) -> Result<Value, String> {
    if name.trim().is_empty() || name.len() > 256 {
        return Err("Ungültiger Cron-Name.".into());
    }
    let access = deployment(&id, project_id, &deployment_name).await?;
    let cron = list_crons(&access)
        .await?
        .into_iter()
        .find(|cron| cron.name == name)
        .ok_or("Cron-Job nicht gefunden.")?;
    let kind = list_functions(&access)
        .await?
        .into_iter()
        .find(|f| f.udf_path == cron.udf_path)
        .map(|f| f.kind)
        .ok_or("Funktion des Cron-Jobs nicht gefunden.")?;
    let args = if cron.args.is_object() {
        cron.args
    } else {
        json!({})
    };
    access.run_function(&kind, &cron.function, args).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_canonicalized_and_validated() {
        assert_eq!(
            canonical_udf_path("messages:send").unwrap(),
            "messages.js:send"
        );
        assert_eq!(
            canonical_udf_path("dir/file.js:run").unwrap(),
            "dir/file.js:run"
        );
        assert_eq!(canonical_udf_path("cleanup").unwrap(), "cleanup.js:default");
        for bad in ["", "../x:y", "a b:c", "a:b:c", "a:", ":b", "a//b:c"] {
            assert!(canonical_udf_path(bad).is_err(), "{bad}");
        }
        assert_eq!(display_path("messages.js:send"), "messages:send");
        assert_eq!(display_path("dir/file.js:default"), "dir/file");
    }

    #[test]
    fn ids_are_validated() {
        assert!(validate_id("kc25wqr7znayf26gtew8ech7bd8gr5vy").is_ok());
        assert!(validate_id("").is_err());
        assert!(validate_id("x\"}").is_err());
        assert!(validate_id(&"a".repeat(65)).is_err());
    }

    #[test]
    fn args_are_decoded() {
        assert_eq!(decode_args("W3t9XQ=="), json!({}));
        let encoded = base64::engine::general_purpose::STANDARD.encode(r#"[{"a":1}]"#);
        assert_eq!(decode_args(&encoded), json!({"a": 1}));
        assert_eq!(decode_args("%%%"), Value::Null);
    }

    #[test]
    fn schedules_are_described_in_german() {
        let cases = [
            (json!({"type":"interval","seconds":"60"}), "Jede Minute"),
            (json!({"type":"interval","seconds":"300"}), "Alle 5 Minuten"),
            (
                json!({"type":"interval","seconds":"7200"}),
                "Alle 2 Stunden",
            ),
            (json!({"type":"interval","seconds":"86400"}), "Jeden Tag"),
            (
                json!({"type":"interval","seconds":"90"}),
                "Alle 90 Sekunden",
            ),
            (
                json!({"type":"hourly","minuteUTC":"5"}),
                "Stündlich um :05 UTC",
            ),
            (
                json!({"type":"daily","hourUTC":"3","minuteUTC":"0"}),
                "Täglich um 03:00 UTC",
            ),
            (
                json!({"type":"weekly","dayOfWeek":"1","hourUTC":"9"}),
                "Jeden Montag um 09:00 UTC",
            ),
            (
                json!({"type":"monthly","day":"15","hourUTC":"12","minuteUTC":"30"}),
                "Monatlich am 15. um 12:30 UTC",
            ),
            (
                json!({"type":"cron","cronExpr":"*/15 * * * *"}),
                "Alle 15 Minuten",
            ),
            (
                json!({"type":"cron","cronExpr":"0 */6 * * *"}),
                "Alle 6 Stunden um :00 UTC",
            ),
            (
                json!({"type":"cron","cronExpr":"30 8 * * 5"}),
                "Jeden Freitag um 08:30 UTC",
            ),
            (
                json!({"type":"cron","cronExpr":"0 0 1 * *"}),
                "Monatlich am 1. um 00:00 UTC",
            ),
            (
                json!({"type":"cron","cronExpr":"0 0 * 1 *"}),
                "Cron-Ausdruck „0 0 * 1 *“ (UTC)",
            ),
        ];
        for (schedule, expected) in cases {
            assert_eq!(describe_schedule(&schedule), expected);
        }
    }

    #[test]
    fn jobs_and_crons_are_parsed() {
        let job = parse_job(&json!({
            "_id":"kc2","udfPath":"messages.js:insertInternal","nextTs":"1792677973559999943",
            "state":{"type":"failed","error":"boom"},"argsId":"mr2","udfArgs":null,"completedTs":null
        }));
        assert_eq!(job.function, "messages:insertInternal");
        assert_eq!(job.state, "failed");
        assert_eq!(job.error.as_deref(), Some("boom"));
        assert!((job.scheduled_ms.unwrap() - 1_792_677_973_560.0).abs() < 1.0);
        assert!(job.args.is_none());

        let cron = parse_cron(&json!({
            "name":"tick","cronSpec":{"cronSchedule":{"type":"interval","seconds":"60"},
            "udfPath":"messages.js:cronTick","udfArgs":"W3t9XQ=="},
            "lastRun":{"_id":"jm","name":"tick","udfPath":"messages.js:cronTick","ts":"1000000",
              "executionTime":0.005,"status":{"type":"err","error":"x"},
              "logLines":{"logLines":["[LOG] 'a'"],"isTruncated":false}},
            "nextRun":{"nextTs":"2000000"}
        }));
        assert_eq!(cron.description, "Jede Minute");
        assert_eq!(cron.args, json!({}));
        assert_eq!(cron.next_run_ms, Some(2.0));
        let last = cron.last_run.unwrap();
        assert_eq!(last.status, "err");
        assert_eq!(last.error.as_deref(), Some("x"));
        assert_eq!(last.log_lines, vec!["[LOG] 'a'"]);
        assert!((last.execution_ms.unwrap() - 5.0).abs() < 1e-9);
    }

    #[tokio::test]
    #[ignore]
    async fn convex_schedules_live() {
        use crate::baas_self_hosted_live_tests::{env, isolate_secrets, latency};
        let (Some(url), Some(key)) = (env("L8DB_E2E_CONVEX_URL"), env("L8DB_E2E_CONVEX_KEY"))
        else {
            return;
        };
        let _secrets = isolate_secrets();
        let profile = crate::convex::convex_connect_self_hosted(url, key)
            .await
            .unwrap();
        let id = profile.id.clone();
        let access = deployment(&id, 0, "").await.unwrap();

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as f64;
        let far = 400.0 * 86_400_000.0;
        for delay in [far, far + 1000.0] {
            access
                .run_function(
                    "mutation",
                    "messages:sendLater",
                    json!({"author": "l8db-schedules-test", "body": "x", "delayMs": delay}),
                )
                .await
                .unwrap();
        }

        let page = convex_studio_schedules_jobs(
            id.clone(),
            0,
            String::new(),
            Some("messages:insertInternal".into()),
            None,
            Some(100),
        )
        .await
        .unwrap();
        let mine: Vec<&ConvexScheduledJob> = page
            .jobs
            .iter()
            .filter(|job| job.scheduled_ms.unwrap_or(0.0) > now_ms + far - 60_000.0)
            .collect();
        assert_eq!(mine.len(), 2);
        assert_eq!(mine[0].state, "pending");
        let args = convex_studio_schedules_job_args(
            id.clone(),
            0,
            String::new(),
            mine[0].args_id.clone().unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(args["author"], "l8db-schedules-test");

        convex_studio_schedules_cancel_job(id.clone(), 0, String::new(), mine[0].id.clone())
            .await
            .unwrap();
        convex_studio_schedules_cancel_all(
            id.clone(),
            0,
            String::new(),
            Some("messages:insertInternal".into()),
            Some(now_ms + far - 60_000.0),
            None,
        )
        .await
        .unwrap();
        let mut remaining = usize::MAX;
        for _ in 0..20 {
            let page = convex_studio_schedules_jobs(
                id.clone(),
                0,
                String::new(),
                Some("messages:insertInternal".into()),
                None,
                Some(100),
            )
            .await
            .unwrap();
            remaining = page
                .jobs
                .iter()
                .filter(|job| job.scheduled_ms.unwrap_or(0.0) > now_ms + far - 60_000.0)
                .count();
            if remaining == 0 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        assert_eq!(remaining, 0);

        let crons = convex_studio_schedules_crons(id.clone(), 0, String::new())
            .await
            .unwrap();
        let tick = crons
            .iter()
            .find(|cron| cron.name == "tick every minute")
            .unwrap();
        assert_eq!(tick.description, "Jede Minute");
        assert_eq!(tick.function, "messages:cronTick");
        assert!(tick.next_run_ms.is_some());
        let daily = crons
            .iter()
            .find(|cron| cron.name == "daily cleanup")
            .unwrap();
        assert_eq!(daily.description, "Täglich um 03:00 UTC");

        let functions = convex_studio_schedules_functions(id.clone(), 0, String::new())
            .await
            .unwrap();
        assert!(functions
            .iter()
            .any(|f| f.function == "messages:cronTick" && f.internal && f.kind == "mutation"));
        assert!(functions.iter().any(|f| f.kind == "action"));

        convex_studio_schedules_run_cron(id.clone(), 0, String::new(), "tick every minute".into())
            .await
            .unwrap();
        assert!(
            convex_studio_schedules_run_cron(id.clone(), 0, String::new(), "missing".into())
                .await
                .is_err()
        );
        assert!(
            convex_studio_schedules_cancel_job(id.clone(), 0, String::new(), "bad\"id".into())
                .await
                .is_err()
        );

        latency("convex schedules jobs", 500, || async {
            convex_studio_schedules_jobs(id.clone(), 0, String::new(), None, None, Some(50))
                .await
                .unwrap();
        })
        .await;
        latency("convex schedules crons", 500, || async {
            convex_studio_schedules_crons(id.clone(), 0, String::new())
                .await
                .unwrap();
        })
        .await;
        latency("convex schedules cron runs", 500, || async {
            let runs =
                convex_studio_schedules_cron_runs(id.clone(), 0, String::new(), None, Some(20))
                    .await
                    .unwrap();
            assert!(runs.len() <= 20);
        })
        .await;
        crate::convex::convex_disconnect(id).await.unwrap();
    }
}
