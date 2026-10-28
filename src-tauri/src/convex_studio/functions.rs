use super::{convex_error, deployment, ConvexDeploymentAccess};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_FUNCTIONS: usize = 5000;
const MAX_ARGS_BYTES: usize = 1024 * 1024;
const MAX_RESULT_BYTES: usize = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES: usize = 2 * 1024 * 1024;
const MAX_LOG_LINES: usize = 500;
const MAX_HTTP_REQUEST_BYTES: usize = 5 * 1024 * 1024;
const MAX_HTTP_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_HTTP_HEADERS: usize = 50;
const RUN_TIMEOUT: Duration = Duration::from_secs(300);
const HTTP_TIMEOUT: Duration = Duration::from_secs(60);
const STATS_BUCKETS: u64 = 30;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexStudioComponent {
    pub id: String,
    pub name: Option<String>,
    pub path: String,
    pub state: String,
    pub http_prefix: Option<String>,
    pub args: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexStudioFunction {
    pub name: String,
    pub identifier: String,
    pub udf_type: String,
    pub visibility: String,
    pub lineno: Option<u64>,
    pub args: Option<Value>,
    pub returns: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexStudioModule {
    pub path: String,
    pub component_id: Option<String>,
    pub component_path: String,
    pub functions: Vec<ConvexStudioFunction>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexStudioHttpRoute {
    pub method: String,
    pub path: String,
    pub component_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexStudioFunctionCatalog {
    pub components: Vec<ConvexStudioComponent>,
    pub modules: Vec<ConvexStudioModule>,
    pub http_routes: Vec<ConvexStudioHttpRoute>,
    pub site_url: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexStudioFunctionDetail {
    pub args: Option<Value>,
    pub source: Option<String>,
    pub source_truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexStudioFunctionRun {
    pub success: bool,
    pub value: Option<Value>,
    pub error_message: Option<String>,
    pub error_data: Option<Value>,
    pub log_lines: Vec<String>,
    pub log_lines_truncated: bool,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexStudioHttpResponse {
    pub url: String,
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub size: usize,
    pub truncated: bool,
    pub duration_ms: u64,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexStudioStatsBucket {
    pub time: u64,
    pub invocations: f64,
    pub errors: f64,
    pub p50_ms: Option<f64>,
    pub p95_ms: Option<f64>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvexStudioFunctionStats {
    pub window_minutes: u32,
    pub invocations: u64,
    pub errors: u64,
    pub p50_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub buckets: Vec<ConvexStudioStatsBucket>,
}

fn valid_chars(value: &str, extra: &str) -> bool {
    value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || extra.contains(c))
}

fn normalize_identifier(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    let invalid = || "Ungültiger Funktionspfad.".to_string();
    if raw.is_empty() || raw.len() > 256 {
        return Err(invalid());
    }
    let (module, export) = match raw.split_once(':') {
        Some((module, export)) => (module, Some(export)),
        None => (raw, None),
    };
    let module = module.strip_suffix(".js").unwrap_or(module);
    if module.is_empty()
        || module.starts_with(['/', '_', '.'])
        || module.ends_with('/')
        || module.contains("..")
        || module.contains("//")
        || !valid_chars(module, "_-./")
    {
        return Err(invalid());
    }
    match export {
        None => Ok(module.to_string()),
        Some(export) if !export.is_empty() && export.len() <= 128 && valid_chars(export, "_$") => {
            Ok(format!("{module}:{export}"))
        }
        Some(_) => Err(invalid()),
    }
}

fn validate_module_path(raw: &str) -> Result<&str, String> {
    let module = raw.trim();
    if module.is_empty()
        || module.len() > 256
        || module.starts_with(['/', '.'])
        || module.contains("..")
        || !valid_chars(module, "_-./")
    {
        return Err("Ungültiger Modulpfad.".into());
    }
    Ok(module)
}

fn validate_component_id(raw: Option<String>) -> Result<Option<String>, String> {
    match raw.map(|value| value.trim().to_string()) {
        None => Ok(None),
        Some(value) if value.is_empty() => Ok(None),
        Some(value) if value.len() <= 64 && valid_chars(&value, "") => Ok(Some(value)),
        Some(_) => Err("Ungültige Komponenten-ID.".into()),
    }
}

fn validate_component_path(raw: Option<String>) -> Result<Option<String>, String> {
    match raw.map(|value| value.trim().to_string()) {
        None => Ok(None),
        Some(value) if value.is_empty() => Ok(None),
        Some(value)
            if value.len() <= 256 && !value.contains("..") && valid_chars(&value, "_-/") =>
        {
            Ok(Some(value))
        }
        Some(_) => Err("Ungültiger Komponentenpfad.".into()),
    }
}

fn udf_type(raw: &str) -> String {
    match raw {
        "Query" => "query",
        "Mutation" => "mutation",
        "Action" => "action",
        "HttpAction" => "httpAction",
        _ => "unknown",
    }
    .to_string()
}

fn identifier_for(module: &str, name: &str) -> String {
    let module = module.strip_suffix(".js").unwrap_or(module);
    if name == "default" {
        module.to_string()
    } else {
        format!("{module}:{name}")
    }
}

fn parse_validator(value: Option<&Value>) -> Option<Value> {
    match value? {
        Value::Null => None,
        Value::String(text) => serde_json::from_str(text).ok(),
        other => Some(other.clone()),
    }
}

fn parse_components(value: &Value) -> Vec<ConvexStudioComponent> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(ConvexStudioComponent {
                id: item.get("id")?.as_str()?.to_string(),
                name: item.get("name").and_then(Value::as_str).map(str::to_string),
                path: item
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                state: item
                    .get("state")
                    .and_then(Value::as_str)
                    .unwrap_or("active")
                    .to_string(),
                http_prefix: item
                    .get("httpPrefix")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                args: item.get("args").cloned().unwrap_or(Value::Null),
            })
        })
        .collect()
}

fn parse_spec(value: &Value) -> HashMap<String, (Option<Value>, Option<Value>)> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let identifier = item.get("identifier")?.as_str()?;
            let (module, name) = identifier.split_once(':')?;
            Some((
                identifier_for(module, name),
                (
                    parse_validator(item.get("args")),
                    parse_validator(item.get("returns")),
                ),
            ))
        })
        .collect()
}

fn parse_catalog(
    components: &[ConvexStudioComponent],
    all_modules: &Value,
    spec: &HashMap<String, (Option<Value>, Option<Value>)>,
) -> (Vec<ConvexStudioModule>, Vec<ConvexStudioHttpRoute>, bool) {
    let mut modules = Vec::new();
    let mut routes = Vec::new();
    let mut count = 0;
    let mut truncated = false;
    for group in all_modules.as_array().into_iter().flatten() {
        let component_id = group.get(0).and_then(Value::as_str).map(str::to_string);
        let component = components
            .iter()
            .find(|item| Some(&item.id) == component_id.as_ref());
        let component_path = component.map(|item| item.path.clone()).unwrap_or_default();
        let root = component_path.is_empty();
        let http_prefix = component
            .and_then(|item| item.http_prefix.clone())
            .unwrap_or_default();
        for entry in group.get(1).and_then(Value::as_array).into_iter().flatten() {
            let Some(path) = entry.get(0).and_then(Value::as_str) else {
                continue;
            };
            let mut functions = Vec::new();
            for function in entry
                .get(1)
                .and_then(|module| module.get("functions"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(name) = function.get("name").and_then(Value::as_str) else {
                    continue;
                };
                if count >= MAX_FUNCTIONS {
                    truncated = true;
                    break;
                }
                count += 1;
                let kind = udf_type(
                    function
                        .get("udfType")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
                if kind == "httpAction" {
                    if let Some((method, route)) = name.split_once(' ') {
                        routes.push(ConvexStudioHttpRoute {
                            method: method.to_string(),
                            path: format!("{}{route}", http_prefix.trim_end_matches('/')),
                            component_path: component_path.clone(),
                        });
                    }
                }
                let identifier = identifier_for(path, name);
                let (args, returns) = if root {
                    spec.get(&identifier).cloned().unwrap_or((None, None))
                } else {
                    (None, None)
                };
                functions.push(ConvexStudioFunction {
                    name: name.to_string(),
                    identifier,
                    udf_type: kind,
                    visibility: function
                        .pointer("/visibility/kind")
                        .and_then(Value::as_str)
                        .unwrap_or("public")
                        .to_string(),
                    lineno: function
                        .get("lineno")
                        .and_then(Value::as_f64)
                        .map(|line| line as u64),
                    args,
                    returns,
                });
            }
            if !functions.is_empty() {
                modules.push(ConvexStudioModule {
                    path: path.to_string(),
                    component_id: component_id.clone(),
                    component_path: component_path.clone(),
                    functions,
                });
            }
        }
    }
    modules.sort_by(|a, b| (&a.component_path, &a.path).cmp(&(&b.component_path, &b.path)));
    (modules, routes, truncated)
}

fn site_base(deployment_url: &reqwest::Url, configured: &str) -> Result<reqwest::Url, String> {
    let configured = configured.trim();
    if !configured.is_empty() {
        let url = reqwest::Url::parse(configured).map_err(|_| "Ungültige Convex-Site-URL.")?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err("Ungültige Convex-Site-URL.".into());
        }
        let mut url = url;
        if !url.path().ends_with('/') {
            url.set_path(&format!("{}/", url.path()));
        }
        return Ok(url);
    }
    let host = deployment_url.host_str().unwrap_or_default();
    if let Some(name) = host.strip_suffix(".convex.cloud") {
        return reqwest::Url::parse(&format!("https://{name}.convex.site/"))
            .map_err(|_| "Ungültige Convex-Site-URL.".to_string());
    }
    deployment_url
        .join("http/")
        .map_err(|_| "Ungültige Convex-Site-URL.".to_string())
}

fn validate_http_path(raw: &str) -> Result<&str, String> {
    let path = raw.trim();
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.len() > 2048
        || path.contains('#')
        || path.contains("..")
        || path.contains('\\')
        || path.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Ungültiger HTTP-Pfad.".into());
    }
    Ok(path)
}

fn http_method(raw: &str) -> Result<reqwest::Method, String> {
    match raw.trim().to_ascii_uppercase().as_str() {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        "PUT" => Ok(reqwest::Method::PUT),
        "PATCH" => Ok(reqwest::Method::PATCH),
        "DELETE" => Ok(reqwest::Method::DELETE),
        "OPTIONS" => Ok(reqwest::Method::OPTIONS),
        "HEAD" => Ok(reqwest::Method::HEAD),
        _ => Err("Ungültige HTTP-Methode.".into()),
    }
}

async fn read_bounded(
    response: &mut reqwest::Response,
    limit: usize,
) -> Result<(Vec<u8>, usize, bool), String> {
    let mut body = Vec::new();
    let mut size = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Antwort konnte nicht vollständig gelesen werden.".to_string())?
    {
        size += chunk.len();
        let room = limit.saturating_sub(body.len());
        if chunk.len() > room {
            body.extend_from_slice(&chunk[..room]);
            return Ok((body, size, true));
        }
        body.extend_from_slice(&chunk);
    }
    Ok((body, size, false))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

fn series(value: &Value) -> Vec<(u64, Option<f64>)> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|point| {
            Some((
                point.pointer("/0/secs_since_epoch")?.as_u64()?,
                point.get(1).and_then(Value::as_f64),
            ))
        })
        .collect()
}

fn percentile_series(value: &Value, percentile: u64) -> Vec<(u64, Option<f64>)> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .find(|item| item.get(0).and_then(Value::as_f64) == Some(percentile as f64))
        .and_then(|item| item.get(1))
        .map(series)
        .unwrap_or_default()
}

fn aggregate_stats(
    window_minutes: u32,
    bucket_secs: f64,
    invocations: &Value,
    errors: &Value,
    latency: &Value,
) -> ConvexStudioFunctionStats {
    let errors: HashMap<u64, f64> = series(errors)
        .into_iter()
        .map(|(time, rate)| (time, rate.unwrap_or(0.0) * bucket_secs))
        .collect();
    let p50: HashMap<u64, Option<f64>> = percentile_series(latency, 50).into_iter().collect();
    let p95: HashMap<u64, Option<f64>> = percentile_series(latency, 95).into_iter().collect();
    let latency_ms = |map: &HashMap<u64, Option<f64>>, time: u64, calls: f64| {
        map.get(&time)
            .copied()
            .flatten()
            .filter(|_| calls > 0.0)
            .map(|secs| (secs * 1000.0 * 10.0).round() / 10.0)
    };
    let buckets: Vec<ConvexStudioStatsBucket> = series(invocations)
        .into_iter()
        .map(|(time, rate)| {
            let calls = rate.unwrap_or(0.0) * bucket_secs;
            ConvexStudioStatsBucket {
                time,
                invocations: (calls * 100.0).round() / 100.0,
                errors: (errors.get(&time).copied().unwrap_or(0.0) * 100.0).round() / 100.0,
                p50_ms: latency_ms(&p50, time, calls),
                p95_ms: latency_ms(&p95, time, calls),
            }
        })
        .collect();
    let total: f64 = buckets.iter().map(|bucket| bucket.invocations).sum();
    let weighted = |pick: fn(&ConvexStudioStatsBucket) -> Option<f64>| {
        let (sum, weight) = buckets
            .iter()
            .filter_map(|bucket| {
                pick(bucket).map(|value| (value * bucket.invocations, bucket.invocations))
            })
            .fold((0.0, 0.0), |acc, item| (acc.0 + item.0, acc.1 + item.1));
        (weight > 0.0).then(|| (sum / weight * 10.0).round() / 10.0)
    };
    ConvexStudioFunctionStats {
        window_minutes,
        invocations: total.round() as u64,
        errors: buckets
            .iter()
            .map(|bucket| bucket.errors)
            .sum::<f64>()
            .round() as u64,
        p50_ms: weighted(|bucket| bucket.p50_ms),
        p95_ms: weighted(|bucket| bucket.p95_ms),
        buckets,
    }
}

async fn site_url(access: &ConvexDeploymentAccess) -> Option<reqwest::Url> {
    let configured = access
        .run_function("query", "_system/frontend/convexSiteUrl", json!({}))
        .await
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default();
    site_base(&access.url, &configured).ok()
}

#[tauri::command]
pub async fn convex_studio_functions_list(
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<ConvexStudioFunctionCatalog, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    let (components, all_modules, spec, site) = tokio::join!(
        access.run_function("query", "_system/frontend/components:list", json!({})),
        access.run_function(
            "query",
            "_system/frontend/modules:listForAllComponents",
            json!({})
        ),
        access.run_function("query", "_system/cli/modules:apiSpec", json!({})),
        site_url(&access),
    );
    let components = parse_components(&components.unwrap_or(Value::Null));
    let spec = parse_spec(&spec.unwrap_or(Value::Null));
    let (modules, http_routes, truncated) = parse_catalog(&components, &all_modules?, &spec);
    Ok(ConvexStudioFunctionCatalog {
        components,
        modules,
        http_routes,
        site_url: site.map(|url| url.to_string()),
        truncated,
    })
}

#[tauri::command]
pub async fn convex_studio_functions_detail(
    id: String,
    project_id: u64,
    deployment_name: String,
    identifier: String,
    component_id: Option<String>,
) -> Result<ConvexStudioFunctionDetail, String> {
    let identifier = normalize_identifier(&identifier)?;
    let component_id = validate_component_id(component_id)?;
    let module = format!("{}.js", identifier.split(':').next().unwrap_or_default());
    validate_module_path(&module)?;
    let access = deployment(&id, project_id, &deployment_name).await?;
    let args_request = access.run_function(
        "query",
        "_system/frontend/modules:argsValidator",
        json!({"function": identifier, "componentId": component_id}),
    );
    let source_request = async {
        let mut url = access.endpoint("api/get_source_code").ok()?;
        url.query_pairs_mut().append_pair("path", &module);
        if let Some(component) = &component_id {
            url.query_pairs_mut().append_pair("component", component);
        }
        let mut response = access
            .request(reqwest::Method::GET, url.as_str())
            .ok()?
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let (body, _, truncated) = read_bounded(&mut response, MAX_SOURCE_BYTES).await.ok()?;
        let text = String::from_utf8_lossy(&body).to_string();
        let source = match serde_json::from_str::<Value>(&text) {
            Ok(Value::String(source)) => source,
            Ok(Value::Null) => return None,
            _ => text,
        };
        Some((source, truncated))
    };
    let (args, source) = tokio::join!(args_request, source_request);
    Ok(ConvexStudioFunctionDetail {
        args: parse_validator(args.ok().as_ref()),
        source_truncated: source.as_ref().is_some_and(|(_, truncated)| *truncated),
        source: source.map(|(source, _)| source),
    })
}

#[tauri::command]
pub async fn convex_studio_functions_run(
    id: String,
    project_id: u64,
    deployment_name: String,
    identifier: String,
    args: Value,
    component_path: Option<String>,
) -> Result<ConvexStudioFunctionRun, String> {
    let identifier = normalize_identifier(&identifier)?;
    let component_path = validate_component_path(component_path)?;
    if !args.is_object() {
        return Err("Argumente müssen ein JSON-Objekt sein.".into());
    }
    if serde_json::to_vec(&args)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
        > MAX_ARGS_BYTES
    {
        return Err("Argumente sind größer als 1 MB.".into());
    }
    let access = deployment(&id, project_id, &deployment_name).await?;
    let mut body = json!({"path": identifier, "args": args, "format": "json"});
    if let Some(component_path) = component_path {
        body["componentPath"] = Value::String(component_path);
    }
    let started = Instant::now();
    let mut response = access
        .request(reqwest::Method::POST, "api/function")?
        .timeout(RUN_TIMEOUT)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "Zeitüberschreitung: Die Funktion lief länger als 5 Minuten.".to_string()
            } else {
                "Convex-Deployment ist nicht erreichbar.".to_string()
            }
        })?;
    let status = response.status();
    let (bytes, _, truncated) = read_bounded(&mut response, MAX_RESULT_BYTES).await?;
    let duration_ms = started.elapsed().as_millis() as u64;
    if truncated {
        return Err("Das Ergebnis ist größer als 8 MB und wird nicht angezeigt.".into());
    }
    let text = String::from_utf8_lossy(&bytes);
    if !status.is_success() {
        return Err(convex_error(status.as_u16(), &text));
    }
    let result: Value = serde_json::from_str(&text)
        .map_err(|_| "Convex hat unerwartete Daten geliefert.".to_string())?;
    Ok(parse_run(result, duration_ms))
}

fn parse_run(result: Value, duration_ms: u64) -> ConvexStudioFunctionRun {
    let lines: Vec<String> = result
        .get("logLines")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|line| match line {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })
        .collect();
    let log_lines_truncated = lines.len() > MAX_LOG_LINES;
    let success = result.get("status").and_then(Value::as_str) == Some("success");
    ConvexStudioFunctionRun {
        success,
        value: success.then(|| result.get("value").cloned().unwrap_or(Value::Null)),
        error_message: (!success).then(|| {
            result
                .get("errorMessage")
                .and_then(Value::as_str)
                .unwrap_or("Convex-Funktion fehlgeschlagen.")
                .to_string()
        }),
        error_data: result.get("errorData").cloned(),
        log_lines: lines.into_iter().take(MAX_LOG_LINES).collect(),
        log_lines_truncated,
        duration_ms,
    }
}

#[tauri::command]
pub async fn convex_studio_functions_http_request(
    id: String,
    project_id: u64,
    deployment_name: String,
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<ConvexStudioHttpResponse, String> {
    let method = http_method(&method)?;
    let path = validate_http_path(&path)?;
    if headers.len() > MAX_HTTP_HEADERS {
        return Err("Zu viele Header (maximal 50).".into());
    }
    if body
        .as_ref()
        .is_some_and(|body| body.len() > MAX_HTTP_REQUEST_BYTES)
    {
        return Err("Der Body ist größer als 5 MB.".into());
    }
    let mut header_map = reqwest::header::HeaderMap::new();
    for (name, value) in &headers {
        let name = reqwest::header::HeaderName::from_bytes(name.trim().as_bytes())
            .map_err(|_| format!("Ungültiger Header-Name: {name}"))?;
        if name == reqwest::header::HOST || name == reqwest::header::CONTENT_LENGTH {
            return Err(format!("Header {name} wird automatisch gesetzt."));
        }
        let value = reqwest::header::HeaderValue::from_str(value.trim())
            .map_err(|_| format!("Ungültiger Wert für Header {name}."))?;
        header_map.append(name, value);
    }
    let access = deployment(&id, project_id, &deployment_name).await?;
    let base = site_url(&access)
        .await
        .ok_or_else(|| "Convex-Site-URL konnte nicht ermittelt werden.".to_string())?;
    let url = base
        .join(path.trim_start_matches('/'))
        .map_err(|_| "Ungültiger HTTP-Pfad.".to_string())?;
    if url.origin() != base.origin() || !url.path().starts_with(base.path()) {
        return Err("Ungültiger HTTP-Pfad.".into());
    }
    let mut request = crate::convex::client()
        .request(method, url.clone())
        .timeout(HTTP_TIMEOUT)
        .headers(header_map);
    if let Some(body) = body {
        request = request.body(body);
    }
    let started = Instant::now();
    let mut response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "Zeitüberschreitung bei der HTTP-Aktion.".to_string()
        } else {
            "HTTP-Aktion ist nicht erreichbar.".to_string()
        }
    })?;
    let status = response.status().as_u16();
    let response_headers = response
        .headers()
        .iter()
        .take(100)
        .map(|(name, value)| {
            (
                name.to_string(),
                String::from_utf8_lossy(value.as_bytes()).to_string(),
            )
        })
        .collect();
    let (bytes, size, truncated) = read_bounded(&mut response, MAX_HTTP_RESPONSE_BYTES).await?;
    Ok(ConvexStudioHttpResponse {
        url: url.to_string(),
        status,
        headers: response_headers,
        body: String::from_utf8_lossy(&bytes).to_string(),
        size,
        truncated,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn convex_studio_functions_stats(
    id: String,
    project_id: u64,
    deployment_name: String,
    identifier: String,
    window_minutes: u32,
) -> Result<ConvexStudioFunctionStats, String> {
    let identifier = normalize_identifier(&identifier)?;
    if !(5..=10080).contains(&window_minutes) {
        return Err("Zeitraum muss zwischen 5 Minuten und 7 Tagen liegen.".into());
    }
    let access = deployment(&id, project_id, &deployment_name).await?;
    let end = now_secs();
    let span = u64::from(window_minutes) * 60;
    let window = json!({
        "start": {"secs_since_epoch": end - span, "nanos_since_epoch": 0},
        "end": {"secs_since_epoch": end, "nanos_since_epoch": 0},
        "num_buckets": STATS_BUCKETS,
    })
    .to_string();
    let metric_url = |path: &str, params: &[(&str, &str)]| -> Result<String, String> {
        let mut url = access.endpoint(path)?;
        url.query_pairs_mut()
            .append_pair("path", &identifier)
            .append_pair("window", &window)
            .extend_pairs(params);
        Ok(url.to_string())
    };
    let invocations_url = metric_url("api/app_metrics/udf_rate", &[("metric", "invocations")])?;
    let errors_url = metric_url("api/app_metrics/udf_rate", &[("metric", "errors")])?;
    let latency_url = metric_url(
        "api/app_metrics/latency_percentiles",
        &[("percentiles", "[50,95]")],
    )?;
    let (invocations, errors, latency) = tokio::join!(
        access.json(reqwest::Method::GET, &invocations_url, None),
        access.json(reqwest::Method::GET, &errors_url, None),
        access.json(reqwest::Method::GET, &latency_url, None),
    );
    Ok(aggregate_stats(
        window_minutes,
        span as f64 / STATS_BUCKETS as f64,
        &invocations?,
        &errors?,
        &latency.unwrap_or(Value::Null),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_are_normalized_and_validated() {
        assert_eq!(
            normalize_identifier("messages:send").unwrap(),
            "messages:send"
        );
        assert_eq!(
            normalize_identifier(" messages.js:send ").unwrap(),
            "messages:send"
        );
        assert_eq!(
            normalize_identifier("dir/sub-file:fn_1").unwrap(),
            "dir/sub-file:fn_1"
        );
        assert_eq!(normalize_identifier("seed").unwrap(), "seed");
        for bad in [
            "",
            "_system/frontend/modules:list",
            "../x:y",
            "/abs:y",
            "a b:c",
            "a:b:c",
            "a:",
            "a//b:c",
            "a/:c",
        ] {
            assert!(normalize_identifier(bad).is_err(), "{bad}");
        }
        assert!(normalize_identifier(&"a".repeat(300)).is_err());
    }

    #[test]
    fn components_and_paths_are_validated() {
        assert_eq!(
            validate_component_id(Some("m02b07".into())).unwrap(),
            Some("m02b07".into())
        );
        assert_eq!(validate_component_id(Some(" ".into())).unwrap(), None);
        assert!(validate_component_id(Some("a/b".into())).is_err());
        assert_eq!(
            validate_component_path(Some("auth/sub".into())).unwrap(),
            Some("auth/sub".into())
        );
        assert!(validate_component_path(Some("../x".into())).is_err());
        assert!(validate_http_path("/messages?a=1").is_ok());
        for bad in [
            "messages",
            "//evil.com/x",
            "/a/../b",
            "/a b",
            "/a#b",
            "/a\\b",
        ] {
            assert!(validate_http_path(bad).is_err(), "{bad}");
        }
        assert!(http_method("post").is_ok());
        assert!(http_method("TRACE").is_err());
    }

    #[test]
    fn site_base_prefers_configured_then_cloud_then_http_prefix() {
        let lab = reqwest::Url::parse("http://127.0.0.1:3210/").unwrap();
        assert_eq!(
            site_base(&lab, "").unwrap().as_str(),
            "http://127.0.0.1:3210/http/"
        );
        assert_eq!(
            site_base(&lab, "http://127.0.0.1:3211").unwrap().as_str(),
            "http://127.0.0.1:3211/"
        );
        let cloud = reqwest::Url::parse("https://happy-cat-1.convex.cloud/").unwrap();
        assert_eq!(
            site_base(&cloud, "").unwrap().as_str(),
            "https://happy-cat-1.convex.site/"
        );
        assert!(site_base(&lab, "ftp://x").is_err());
        let base = site_base(&lab, "").unwrap();
        assert_eq!(
            base.join("messages?x=1").unwrap().as_str(),
            "http://127.0.0.1:3210/http/messages?x=1"
        );
    }

    #[test]
    fn catalog_merges_modules_spec_components_and_routes() {
        let components = parse_components(&json!([
            {"id": "root1", "name": null, "path": "", "state": "active", "args": {}, "httpPrefix": null},
            {"id": "comp1", "name": "rate", "path": "rate", "state": "active", "args": {}, "httpPrefix": "/rate/"}
        ]));
        let spec = parse_spec(&json!([
            {"identifier": "messages.js:send", "functionType": "Mutation", "visibility": {"kind": "public"},
             "args": {"type": "object", "value": {}}, "returns": null},
            {"functionType": "HttpAction", "method": "GET", "path": "/messages"}
        ]));
        let all = json!([
            [null, [
                ["messages.js", {"functions": [
                    {"name": "send", "udfType": "Mutation", "lineno": 22.0, "visibility": {"kind": "public"}},
                    {"name": "cronTick", "udfType": "Mutation", "visibility": {"kind": "internal"}}
                ]}],
                ["schema.js", {"functions": []}],
                ["http.js", {"functions": [{"name": "GET /messages", "udfType": "HttpAction", "visibility": {"kind": "public"}}]}]
            ]],
            ["comp1", [
                ["lib.js", {"functions": [{"name": "limit", "udfType": "Query", "visibility": {"kind": "public"}}]}],
                ["http.js", {"functions": [{"name": "POST /hook", "udfType": "HttpAction", "visibility": {"kind": "public"}}]}]
            ]]
        ]);
        let (modules, routes, truncated) = parse_catalog(&components, &all, &spec);
        assert!(!truncated);
        assert_eq!(
            modules
                .iter()
                .map(|m| (m.component_path.as_str(), m.path.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("", "http.js"),
                ("", "messages.js"),
                ("rate", "http.js"),
                ("rate", "lib.js")
            ]
        );
        let send = &modules[1].functions[0];
        assert_eq!(send.identifier, "messages:send");
        assert_eq!(send.udf_type, "mutation");
        assert_eq!(send.lineno, Some(22));
        assert!(send.args.is_some());
        assert_eq!(modules[1].functions[1].visibility, "internal");
        assert!(modules[3].functions[0].args.is_none());
        assert_eq!(routes.len(), 2);
        assert_eq!(
            (routes[0].method.as_str(), routes[0].path.as_str()),
            ("GET", "/messages")
        );
        assert_eq!(routes[1].path, "/rate/hook");
        assert_eq!(routes[1].component_path, "rate");
    }

    #[test]
    fn validators_parse_from_strings_and_values() {
        assert_eq!(
            parse_validator(Some(&json!("{\"type\":\"any\"}"))),
            Some(json!({"type": "any"}))
        );
        assert_eq!(parse_validator(Some(&Value::Null)), None);
        assert_eq!(parse_validator(None), None);
        assert_eq!(
            parse_validator(Some(&json!({"type": "string"}))),
            Some(json!({"type": "string"}))
        );
    }

    #[test]
    fn run_results_capture_values_errors_and_bounded_logs() {
        let ok = parse_run(
            json!({"status": "success", "value": {"count": 1}, "logLines": ["[LOG] 'x'"]}),
            12,
        );
        assert!(ok.success);
        assert_eq!(ok.value, Some(json!({"count": 1})));
        assert_eq!(ok.log_lines, vec!["[LOG] 'x'"]);
        let lines: Vec<Value> = (0..600).map(|n| json!(format!("[LOG] {n}"))).collect();
        let failed = parse_run(
            json!({"status": "error", "errorMessage": "Uncaught Error: boom\n at x", "errorData": {"code": 1}, "logLines": lines}),
            5,
        );
        assert!(!failed.success);
        assert_eq!(failed.value, None);
        assert_eq!(
            failed.error_message.as_deref(),
            Some("Uncaught Error: boom\n at x")
        );
        assert_eq!(failed.error_data, Some(json!({"code": 1})));
        assert_eq!(failed.log_lines.len(), MAX_LOG_LINES);
        assert!(failed.log_lines_truncated);
    }

    #[test]
    fn stats_convert_rates_to_counts_and_weight_latency() {
        let point = |t: u64, v: Value| json!([{"secs_since_epoch": t, "nanos_since_epoch": 0}, v]);
        let invocations = json!([
            point(0, json!(0.0)),
            point(60, json!(0.5)),
            point(120, json!(0.25))
        ]);
        let errors = json!([
            point(0, json!(0.0)),
            point(60, json!(0.05)),
            point(120, json!(null))
        ]);
        let latency = json!([
            [
                50,
                [
                    point(0, json!(0.0)),
                    point(60, json!(0.01)),
                    point(120, json!(0.004))
                ]
            ],
            [
                95,
                [
                    point(0, json!(0.0)),
                    point(60, json!(0.02)),
                    point(120, json!(0.004))
                ]
            ]
        ]);
        let stats = aggregate_stats(3, 60.0, &invocations, &errors, &latency);
        assert_eq!(stats.invocations, 45);
        assert_eq!(stats.errors, 3);
        assert_eq!(stats.buckets[0].p50_ms, None);
        assert_eq!(stats.buckets[1].p50_ms, Some(10.0));
        assert_eq!(stats.p50_ms, Some(8.0));
        assert_eq!(stats.p95_ms, Some(14.7));
        let empty = aggregate_stats(5, 10.0, &Value::Null, &Value::Null, &Value::Null);
        assert_eq!(
            (empty.invocations, empty.p50_ms, empty.buckets.len()),
            (0, None, 0)
        );
    }

    #[tokio::test]
    #[ignore]
    async fn live_functions_studio_against_lab() {
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
        let catalog = convex_studio_functions_list(id.clone(), 0, String::new())
            .await
            .unwrap();
        let all: Vec<&ConvexStudioFunction> =
            catalog.modules.iter().flat_map(|m| &m.functions).collect();
        let send = all
            .iter()
            .find(|f| f.identifier == "messages:send")
            .unwrap();
        assert_eq!(send.udf_type, "mutation");
        assert!(send.args.as_ref().unwrap().pointer("/value/body").is_some());
        assert!(all
            .iter()
            .any(|f| f.identifier == "messages:insertInternal" && f.visibility == "internal"));
        assert!(catalog
            .http_routes
            .iter()
            .any(|r| r.method == "GET" && r.path == "/messages"));
        assert!(!catalog.components.is_empty());
        assert_eq!(
            catalog.site_url.as_deref(),
            Some("http://127.0.0.1:3210/http/")
        );

        let detail = convex_studio_functions_detail(
            id.clone(),
            0,
            String::new(),
            "messages:send".into(),
            None,
        )
        .await
        .unwrap();
        assert!(detail.args.unwrap().pointer("/value/author").is_some());

        let listed = convex_studio_functions_run(
            id.clone(),
            0,
            String::new(),
            "users:list".into(),
            json!({}),
            None,
        )
        .await
        .unwrap();
        assert!(listed.success && listed.value.unwrap().is_array());
        let logged = convex_studio_functions_run(
            id.clone(),
            0,
            String::new(),
            "actions:logSomething".into(),
            json!({"note": "l8db"}),
            None,
        )
        .await
        .unwrap();
        assert!(logged
            .log_lines
            .iter()
            .any(|line| line.starts_with("[WARN]")));
        let failed = convex_studio_functions_run(
            id.clone(),
            0,
            String::new(),
            "actions:fail".into(),
            json!({}),
            None,
        )
        .await
        .unwrap();
        assert!(!failed.success);
        assert!(failed
            .error_message
            .unwrap()
            .contains("intentional failure"));
        assert!(convex_studio_functions_run(
            id.clone(),
            0,
            String::new(),
            "_system/frontend/modules:list".into(),
            json!({}),
            None
        )
        .await
        .is_err());
        assert!(convex_studio_functions_run(
            id.clone(),
            0,
            String::new(),
            "users:list".into(),
            json!([1]),
            None
        )
        .await
        .is_err());

        let http = convex_studio_functions_http_request(
            id.clone(),
            0,
            String::new(),
            "GET".into(),
            "/messages".into(),
            vec![("accept".into(), "application/json".into())],
            None,
        )
        .await
        .unwrap();
        assert_eq!(http.status, 200);
        assert!(!http.truncated);

        let stats =
            convex_studio_functions_stats(id.clone(), 0, String::new(), "actions:fail".into(), 60)
                .await
                .unwrap();
        assert!(stats.invocations >= 1 && stats.errors >= 1);
        assert_eq!(stats.buckets.len() as u64, STATS_BUCKETS);

        latency("convex functions list", 500, || async {
            convex_studio_functions_list(id.clone(), 0, String::new())
                .await
                .unwrap();
        })
        .await;
        latency("convex functions detail", 500, || async {
            convex_studio_functions_detail(
                id.clone(),
                0,
                String::new(),
                "messages:send".into(),
                None,
            )
            .await
            .unwrap();
        })
        .await;
        latency("convex functions run query", 500, || async {
            convex_studio_functions_run(
                id.clone(),
                0,
                String::new(),
                "users:list".into(),
                json!({}),
                None,
            )
            .await
            .unwrap();
        })
        .await;
        latency("convex functions stats", 500, || async {
            convex_studio_functions_stats(id.clone(), 0, String::new(), "users:list".into(), 60)
                .await
                .unwrap();
        })
        .await;
        latency("convex functions http GET", 500, || async {
            convex_studio_functions_http_request(
                id.clone(),
                0,
                String::new(),
                "GET".into(),
                "/messages".into(),
                vec![],
                None,
            )
            .await
            .unwrap();
        })
        .await;
        crate::convex::convex_disconnect(id).await.unwrap();
    }
}
