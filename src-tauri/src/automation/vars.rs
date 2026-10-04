use std::collections::BTreeMap;

use chrono::{DateTime, Duration, Local, Months, Utc};
use chrono_tz::Tz;
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use regex::Regex;

use crate::automation::connection::Resolved;
use crate::automation::model::{Comparator, RunStatus, Task, VariableKind};
use crate::automation::runtime::StepOutcome;
use crate::db::DatabaseKind;

const MASK: &str = "••••";
const URL_SAFE: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

#[derive(Clone)]
pub struct Vars {
    values: BTreeMap<String, String>,
    builtins: BTreeMap<String, String>,
    secrets: Vec<String>,
    clock: Option<DateTime<Utc>>,
    timezone: Option<Tz>,
}

pub fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

fn os_user() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
}

fn os_home() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default()
}

#[cfg(unix)]
fn os_hostname() -> String {
    let mut buffer = [0u8; 256];
    let result = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) };
    if result != 0 {
        return String::new();
    }
    let end = buffer.iter().position(|b| *b == 0).unwrap_or(buffer.len());
    String::from_utf8_lossy(&buffer[..end]).into_owned()
}

#[cfg(not(unix))]
fn os_hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_default()
}

pub fn value_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

pub fn format_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

pub fn sql_literal(value: &str, kind: Option<DatabaseKind>) -> String {
    let escaped = value.replace('\'', "''");
    match kind {
        Some(DatabaseKind::Mysql | DatabaseKind::Clickhouse) => escaped.replace('\\', "\\\\"),
        _ => escaped,
    }
}

fn status_text(status: RunStatus) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

impl Vars {
    pub fn new(
        task: &Task,
        run_id: &str,
        environment: Option<&str>,
        overrides: &BTreeMap<String, String>,
        secrets: &BTreeMap<String, String>,
    ) -> Result<Self, String> {
        let env_values = match environment {
            Some(name) => Some(
                task.environments
                    .iter()
                    .find(|env| env.name == name)
                    .map(|env| env.variables.clone())
                    .ok_or_else(|| format!("Umgebung „{name}“ existiert nicht."))?,
            ),
            None => None,
        };
        let mut values = BTreeMap::new();
        let mut masked = Vec::new();
        for variable in &task.variables {
            let value = overrides
                .get(&variable.name)
                .or_else(|| secrets.get(&variable.name))
                .or_else(|| env_values.as_ref().and_then(|env| env.get(&variable.name)))
                .cloned()
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| variable.default_value.clone());
            let value = if value.is_empty() && variable.kind == VariableKind::Boolean {
                "false".to_string()
            } else {
                value
            };
            if value.is_empty() {
                return Err(format!("Variable „{}“ hat keinen Wert.", variable.name));
            }
            if variable.kind == VariableKind::Secret {
                masked.push(value.clone());
            }
            values.insert(variable.name.clone(), value);
        }
        if let Some(env) = &env_values {
            for (name, value) in env {
                values.entry(name.clone()).or_insert_with(|| value.clone());
            }
        }
        for (name, value) in overrides {
            values.insert(name.clone(), value.clone());
        }
        let mut builtins = BTreeMap::new();
        builtins.insert("task".into(), task.name.clone());
        builtins.insert("task_id".into(), task.id.clone());
        builtins.insert("run_id".into(), run_id.to_string());
        builtins.insert("trigger".into(), String::new());
        builtins.insert(
            "environment".into(),
            environment.unwrap_or_default().to_string(),
        );
        builtins.insert("user".into(), os_user());
        builtins.insert("hostname".into(), os_hostname());
        builtins.insert("home".into(), os_home());
        builtins.insert("output_dir".into(), String::new());
        masked.retain(|secret: &String| secret.chars().count() >= 4);
        masked.sort_by_key(|secret| std::cmp::Reverse(secret.len()));
        masked.dedup();
        Ok(Vars {
            values,
            builtins,
            secrets: masked,
            clock: None,
            timezone: None,
        })
    }

    #[cfg(test)]
    pub fn with_clock(mut self, clock: DateTime<Utc>) -> Self {
        self.clock = Some(clock);
        self
    }

    pub fn set_timezone(&mut self, timezone: Option<Tz>) {
        self.timezone = timezone;
    }

    pub fn set_builtin(&mut self, name: &str, value: String) {
        self.builtins.insert(name.to_string(), value);
    }

    pub fn get(&self, name: &str) -> Option<String> {
        self.lookup(name).ok().flatten()
    }

    pub fn render(&self, template: &str) -> Result<String, String> {
        self.expand(template, None)
    }

    pub fn render_sql(&self, template: &str, kind: DatabaseKind) -> Result<String, String> {
        self.expand(template, Some(kind))
    }

    pub fn set(&mut self, name: &str, value: String) {
        self.values.insert(name.to_string(), value);
    }

    pub fn set_step(
        &mut self,
        index: usize,
        step_id: &str,
        outcome: &StepOutcome,
        status: RunStatus,
        error: Option<&str>,
    ) {
        let fields = [
            (
                "rows",
                outcome.rows.map(|v| v.to_string()).unwrap_or_default(),
            ),
            (
                "rows_affected",
                outcome
                    .rows_affected
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
            ),
            (
                "value",
                outcome.value.as_ref().map(value_text).unwrap_or_default(),
            ),
            ("status", status_text(status)),
            ("error", error.unwrap_or_default().to_string()),
            (
                "output",
                outcome
                    .outputs
                    .iter()
                    .map(|output| output.path.clone())
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
        ];
        let mut prefixes = vec![format!("step.{step_id}"), "last".to_string()];
        if index > 0 {
            prefixes.push(format!("step.{index}"));
        }
        for prefix in &prefixes {
            for (field, value) in &fields {
                self.values
                    .insert(format!("{prefix}.{field}"), value.clone());
            }
        }
    }

    pub fn set_connection(&mut self, resolved: &Resolved) {
        let host = url::Url::parse(&resolved.url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_string))
            .unwrap_or_default();
        self.builtins
            .insert("connection".into(), resolved.name.clone());
        self.builtins
            .insert("connection_id".into(), resolved.id.clone());
        self.builtins.insert(
            "database".into(),
            resolved.database.clone().unwrap_or_default(),
        );
        self.builtins.insert("host".into(), host);
    }

    pub fn mask(&self, text: &str) -> String {
        let mut text = text.to_string();
        for secret in &self.secrets {
            if text.contains(secret.as_str()) {
                text = text.replace(secret.as_str(), MASK);
            }
        }
        text
    }

    pub fn snapshot(&self) -> BTreeMap<String, String> {
        self.values
            .iter()
            .map(|(name, value)| (name.clone(), self.mask(value)))
            .collect()
    }

    fn now(&self) -> DateTime<Utc> {
        self.clock.unwrap_or_else(Utc::now)
    }

    fn format_time(&self, at: DateTime<Utc>, format: &str) -> Result<String, String> {
        use std::fmt::Write;
        let mut out = String::new();
        let result = match self.timezone {
            Some(tz) => write!(out, "{}", at.with_timezone(&tz).format(format)),
            None => write!(out, "{}", at.with_timezone(&Local).format(format)),
        };
        result.map_err(|_| format!("Ungültiges Datumsformat „{format}“."))?;
        Ok(out)
    }

    fn date_expression(&self, expr: &str) -> Option<Result<String, String>> {
        static PATTERN: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        let pattern = PATTERN.get_or_init(|| {
            Regex::new(r"^date((?:[+-]\d+[smhdwMy])*)(?::(.+))?$").expect("gültiges Muster")
        });
        let caps = pattern.captures(expr)?;
        let mut at = self.now();
        static OFFSET: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        let offset =
            OFFSET.get_or_init(|| Regex::new(r"([+-])(\d+)([smhdwMy])").expect("gültiges Muster"));
        for part in offset.captures_iter(caps.get(1).map_or("", |m| m.as_str())) {
            let Ok(amount) = part[2].parse::<i64>() else {
                return Some(Err(format!("Ungültige Datumsangabe „{expr}“.")));
            };
            let amount = if &part[1] == "-" { -amount } else { amount };
            let shifted = match &part[3] {
                "s" => Some(at + Duration::seconds(amount)),
                "m" => Some(at + Duration::minutes(amount)),
                "h" => Some(at + Duration::hours(amount)),
                "d" => Some(at + Duration::days(amount)),
                "w" => Some(at + Duration::weeks(amount)),
                unit => {
                    let months = if unit == "y" { amount * 12 } else { amount };
                    let delta = Months::new(months.unsigned_abs() as u32);
                    if months >= 0 {
                        at.checked_add_months(delta)
                    } else {
                        at.checked_sub_months(delta)
                    }
                }
            };
            match shifted {
                Some(value) => at = value,
                None => return Some(Err(format!("Ungültige Datumsangabe „{expr}“."))),
            }
        }
        let format = caps.get(2).map_or("%Y-%m-%d", |m| m.as_str());
        Some(self.format_time(at, format))
    }

    fn lookup(&self, name: &str) -> Result<Option<String>, String> {
        match name {
            "date" | "time" | "timestamp" | "now" => {
                let at = self.now();
                return Ok(Some(match name {
                    "date" => self.format_time(at, "%Y-%m-%d")?,
                    "time" => self.format_time(at, "%H-%M-%S")?,
                    "timestamp" => self.format_time(at, "%Y%m%d-%H%M%S")?,
                    _ => crate::automation::runtime::rfc3339(at),
                }));
            }
            _ => {}
        }
        if let Some(value) = self.builtins.get(name) {
            return Ok(Some(value.clone()));
        }
        if let Some(result) = self.date_expression(name) {
            return result.map(Some);
        }
        Ok(self.values.get(name).cloned())
    }

    fn apply_filter(
        &self,
        value: String,
        filter: &str,
        kind: Option<DatabaseKind>,
    ) -> Result<String, String> {
        Ok(match filter {
            "sql" => sql_literal(&value, kind),
            "json" => {
                let quoted = serde_json::to_string(&value).map_err(|e| e.to_string())?;
                quoted[1..quoted.len() - 1].to_string()
            }
            "url" => utf8_percent_encode(&value, URL_SAFE).to_string(),
            "upper" => value.to_uppercase(),
            "lower" => value.to_lowercase(),
            "trim" => value.trim().to_string(),
            "filename" => value
                .chars()
                .map(|c| {
                    if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                        '_'
                    } else {
                        c
                    }
                })
                .collect(),
            other => return Err(format!("Unbekannter Filter „{other}“.")),
        })
    }

    fn placeholder(&self, content: &str, kind: Option<DatabaseKind>) -> Result<String, String> {
        let mut parts = content.split('|');
        let expression = parts.next().unwrap_or_default().trim();
        let (name, default) = match expression.split_once(":-") {
            Some((name, default)) => (name.trim(), Some(default)),
            None => (expression, None),
        };
        let is_date = self.date_expression(name).is_some();
        if !is_date && !valid_name(name) {
            return Err(format!("Ungültiger Platzhalter „${{{content}}}“."));
        }
        let mut value = match (self.lookup(name)?, default) {
            (Some(value), Some(default)) if value.is_empty() => default.to_string(),
            (Some(value), _) => value,
            (None, Some(default)) => default.to_string(),
            (None, None) => return Err(format!("Unbekannte Variable „{name}“.")),
        };
        for filter in parts {
            value = self.apply_filter(value, filter.trim(), kind)?;
        }
        Ok(value)
    }

    fn expand(&self, template: &str, kind: Option<DatabaseKind>) -> Result<String, String> {
        let mut out = String::with_capacity(template.len());
        let mut rest = template;
        while let Some(position) = rest.find('$') {
            out.push_str(&rest[..position]);
            let tail = &rest[position..];
            if tail.starts_with("$${") {
                out.push_str("${");
                rest = &tail[3..];
            } else if let Some(body) = tail.strip_prefix("${") {
                let end = body
                    .find('}')
                    .ok_or_else(|| "Platzhalter ohne schließende Klammer „}“.".to_string())?;
                out.push_str(&self.placeholder(&body[..end], kind)?);
                rest = &body[end + 1..];
            } else {
                out.push('$');
                rest = &tail[1..];
            }
        }
        out.push_str(rest);
        Ok(out)
    }
}

struct Parser<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
}

impl Parser<'_> {
    fn skip(&mut self) {
        while self.chars.peek().is_some_and(|c| c.is_whitespace()) {
            self.chars.next();
        }
    }

    fn expression(&mut self) -> Result<f64, String> {
        let mut value = self.term()?;
        loop {
            self.skip();
            match self.chars.peek() {
                Some('+') => {
                    self.chars.next();
                    value += self.term()?;
                }
                Some('-') => {
                    self.chars.next();
                    value -= self.term()?;
                }
                _ => return Ok(value),
            }
        }
    }

    fn term(&mut self) -> Result<f64, String> {
        let mut value = self.factor()?;
        loop {
            self.skip();
            let op = match self.chars.peek() {
                Some(c @ ('*' | '/' | '%')) => *c,
                _ => return Ok(value),
            };
            self.chars.next();
            let right = self.factor()?;
            if op != '*' && right == 0.0 {
                return Err("Division durch 0.".into());
            }
            value = match op {
                '*' => value * right,
                '/' => value / right,
                _ => value % right,
            };
        }
    }

    fn factor(&mut self) -> Result<f64, String> {
        self.skip();
        match self.chars.peek() {
            Some('-') => {
                self.chars.next();
                Ok(-self.factor()?)
            }
            Some('+') => {
                self.chars.next();
                self.factor()
            }
            Some('(') => {
                self.chars.next();
                let value = self.expression()?;
                self.skip();
                if self.chars.next() != Some(')') {
                    return Err("Schließende Klammer fehlt.".into());
                }
                Ok(value)
            }
            Some(c) if c.is_ascii_digit() || *c == '.' => {
                let mut number = String::new();
                while let Some(c) = self.chars.peek() {
                    if c.is_ascii_digit() || *c == '.' {
                        number.push(*c);
                        self.chars.next();
                    } else {
                        break;
                    }
                }
                number
                    .parse()
                    .map_err(|_| format!("Ungültige Zahl „{number}“."))
            }
            Some(c) => Err(format!("Unerwartetes Zeichen „{c}“.")),
            None => Err("Ausdruck endet unerwartet.".into()),
        }
    }
}

pub fn calculate(expression: &str) -> Result<f64, String> {
    let mut parser = Parser {
        chars: expression.chars().peekable(),
    };
    let value = parser
        .expression()
        .map_err(|error| format!("Rechenausdruck „{expression}“: {error}"))?;
    parser.skip();
    if let Some(c) = parser.chars.next() {
        return Err(format!(
            "Rechenausdruck „{expression}“: Unerwartetes Zeichen „{c}“."
        ));
    }
    Ok(value)
}

pub fn compare(left: &str, op: Comparator, right: &str) -> Result<bool, String> {
    let numbers = left
        .trim()
        .parse::<f64>()
        .ok()
        .zip(right.trim().parse::<f64>().ok());
    let ordering = match numbers {
        Some((a, b)) => a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal),
        None => left.cmp(right),
    };
    use std::cmp::Ordering::*;
    Ok(match op {
        Comparator::Eq => ordering == Equal,
        Comparator::Ne => ordering != Equal,
        Comparator::Gt => ordering == Greater,
        Comparator::Gte => ordering != Less,
        Comparator::Lt => ordering == Less,
        Comparator::Lte => ordering != Greater,
        Comparator::Contains => left.contains(right),
        Comparator::NotContains => !left.contains(right),
        Comparator::Matches => Regex::new(right)
            .map_err(|error| format!("Ungültiger regulärer Ausdruck „{right}“: {error}"))?
            .is_match(left),
        Comparator::Empty => left.trim().is_empty(),
        Comparator::NotEmpty => !left.trim().is_empty(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn task(variables: serde_json::Value) -> Task {
        serde_json::from_value(serde_json::json!({
            "id": "t1",
            "name": "Bericht",
            "variables": variables,
            "environments": [{ "name": "prod", "variables": { "region": "eu" } }]
        }))
        .unwrap()
    }

    fn vars() -> Vars {
        let task = task(serde_json::json!([
            { "name": "name", "defaultValue": "O'Brien" },
            { "name": "path", "defaultValue": "a\\b" },
            { "name": "token", "kind": "secret", "defaultValue": "" },
            { "name": "flag", "kind": "boolean" }
        ]));
        let secrets = BTreeMap::from([("token".to_string(), "s3cr3t-value".to_string())]);
        Vars::new(&task, "run-1", Some("prod"), &BTreeMap::new(), &secrets)
            .unwrap()
            .with_clock(Utc.with_ymd_and_hms(2026, 3, 31, 7, 30, 5).unwrap())
    }

    #[test]
    fn defaults_overrides_and_environment() {
        let v = vars();
        assert_eq!(v.render("${name}").unwrap(), "O'Brien");
        assert_eq!(v.render("${flag}").unwrap(), "false");
        assert_eq!(v.render("${region}").unwrap(), "eu");
        assert_eq!(v.render("${missing:-fallback}").unwrap(), "fallback");
        assert_eq!(v.render("${task}/${run_id}").unwrap(), "Bericht/run-1");
        assert_eq!(v.render("${environment}").unwrap(), "prod");
        let task = task(serde_json::json!([{ "name": "x", "defaultValue": "1" }]));
        let overrides = BTreeMap::from([("x".to_string(), "2".to_string())]);
        let v = Vars::new(&task, "r", None, &overrides, &BTreeMap::new()).unwrap();
        assert_eq!(v.render("${x}").unwrap(), "2");
    }

    #[test]
    fn missing_required_variable_fails() {
        let task = task(serde_json::json!([{ "name": "x" }]));
        let error = Vars::new(&task, "r", None, &BTreeMap::new(), &BTreeMap::new())
            .err()
            .unwrap();
        assert_eq!(error, "Variable „x“ hat keinen Wert.");
        let error = Vars::new(&task, "r", Some("nope"), &BTreeMap::new(), &BTreeMap::new())
            .err()
            .unwrap();
        assert!(error.contains("nope"));
    }

    #[test]
    fn filters() {
        let v = vars();
        assert_eq!(v.render("'${name|sql}'").unwrap(), "'O''Brien'");
        assert_eq!(
            v.render_sql("'${path|sql}'", DatabaseKind::Mysql).unwrap(),
            "'a\\\\b'"
        );
        assert_eq!(
            v.render_sql("'${path|sql}'", DatabaseKind::Postgres)
                .unwrap(),
            "'a\\b'"
        );
        assert_eq!(
            v.render_sql("'${name|sql}'", DatabaseKind::Clickhouse)
                .unwrap(),
            "'O''Brien'"
        );
        assert_eq!(v.render("${path|json}").unwrap(), "a\\\\b");
        assert_eq!(v.render("${name|url}").unwrap(), "O%27Brien");
        assert_eq!(v.render("${name|upper}").unwrap(), "O'BRIEN");
        assert_eq!(v.render("${name | lower}").unwrap(), "o'brien");
        assert_eq!(v.render("${missing:- x |trim}").unwrap(), "x");
        assert_eq!(v.render("${path|filename}").unwrap(), "a_b");
        assert!(v.render("${name|bogus}").is_err());
    }

    #[test]
    fn dates_with_fixed_clock() {
        let mut v = vars();
        v.set_timezone(Some(chrono_tz::UTC));
        assert_eq!(v.render("${date}").unwrap(), "2026-03-31");
        assert_eq!(v.render("${time}").unwrap(), "07-30-05");
        assert_eq!(v.render("${timestamp}").unwrap(), "20260331-073005");
        assert_eq!(v.render("${now}").unwrap(), "2026-03-31T07:30:05.000Z");
        assert_eq!(v.render("${date:%Y/%m}").unwrap(), "2026/03");
        assert_eq!(v.render("${date-1d}").unwrap(), "2026-03-30");
        assert_eq!(v.render("${date+2h:%H}").unwrap(), "09");
        assert_eq!(v.render("${date-1M}").unwrap(), "2026-02-28");
        assert_eq!(v.render("${date+1y-1w}").unwrap(), "2027-03-24");
        v.set_timezone(Some(chrono_tz::Europe::Berlin));
        assert_eq!(v.render("${date:%H:%M}").unwrap(), "09:30");
    }

    #[test]
    fn escape_and_errors() {
        let v = vars();
        assert_eq!(v.render("$${name} costs $5").unwrap(), "${name} costs $5");
        assert_eq!(
            v.render("${unknown}").unwrap_err(),
            "Unbekannte Variable „unknown“."
        );
        assert!(v.render("${name").is_err());
        assert!(v.render("${1bad}").is_err());
    }

    #[test]
    fn step_results_and_masking() {
        let mut v = vars();
        let outcome = StepOutcome {
            rows: Some(3),
            value: Some(serde_json::json!(42)),
            ..StepOutcome::default()
        };
        v.set_step(2, "load", &outcome, RunStatus::Success, None);
        assert_eq!(v.render("${step.2.rows}").unwrap(), "3");
        assert_eq!(v.render("${step.load.value}").unwrap(), "42");
        assert_eq!(v.render("${last.status}").unwrap(), "success");
        assert_eq!(v.render("${last.error}").unwrap(), "");
        assert_eq!(v.render("${token}").unwrap(), "s3cr3t-value");
        assert_eq!(v.mask("Bearer s3cr3t-value failed"), "Bearer •••• failed");
        assert_eq!(v.snapshot()["token"], "••••");
        let task =
            task(serde_json::json!([{ "name": "pin", "kind": "secret", "defaultValue": "abc" }]));
        let v = Vars::new(&task, "r", None, &BTreeMap::new(), &BTreeMap::new()).unwrap();
        assert_eq!(v.mask("abc"), "abc");
    }

    #[test]
    fn calculate_respects_precedence() {
        assert_eq!(calculate("1+2*3").unwrap(), 7.0);
        assert_eq!(calculate("(1+2)*3").unwrap(), 9.0);
        assert_eq!(calculate("10 % 4 - -1").unwrap(), 3.0);
        assert_eq!(calculate("7/2").unwrap(), 3.5);
        assert_eq!(format_number(calculate("1+2*3").unwrap()), "7");
        assert_eq!(format_number(3.5), "3.5");
        assert!(calculate("1/0").unwrap_err().contains("Division durch 0"));
        assert!(calculate("5 % 0").is_err());
        assert!(calculate("2 +").is_err());
        assert!(calculate("2 x").is_err());
    }

    #[test]
    fn compare_numeric_text_regex_empty() {
        assert!(compare("10", Comparator::Gt, "9").unwrap());
        assert!(!compare("10", Comparator::Gt, "9a").unwrap());
        assert!(compare("1.0", Comparator::Eq, "1").unwrap());
        assert!(compare("abc", Comparator::Lt, "abd").unwrap());
        assert!(compare("hello world", Comparator::Contains, "lo w").unwrap());
        assert!(compare("hello", Comparator::NotContains, "x").unwrap());
        assert!(compare("ERR-42", Comparator::Matches, r"^ERR-\d+$").unwrap());
        assert!(compare("x", Comparator::Matches, "(").is_err());
        assert!(compare("  ", Comparator::Empty, "ignored").unwrap());
        assert!(compare("a", Comparator::NotEmpty, "").unwrap());
        assert!(compare("5", Comparator::Lte, "5").unwrap());
        assert!(compare("5", Comparator::Ne, "6").unwrap());
    }
}
