use std::cell::RefCell;
use std::collections::VecDeque;
use std::future::Future;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use regex::{Captures, Regex};
use serde::Serialize;

const CAPACITY: usize = 5000;
const MAX_SQL: usize = 4000;

static ENABLED: AtomicBool = AtomicBool::new(false);
static NEXT: AtomicU64 = AtomicU64::new(1);
static ENTRIES: Mutex<VecDeque<SqlLogEntry>> = Mutex::new(VecDeque::new());

static SECRET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)(\bIDENTIFIED\s+(?:WITH\s+[\w$]+\s+)?BY\s+(?:PASSWORD\s+)?)(?:'(?:[^']|'')*'|"[^"]*"|[^\s;'"]+)(\s+REPLACE\s+(?:'(?:[^']|'')*'|"[^"]*"|[^\s;'"]+))?|(\bPASSWORD\s+)'(?:[^']|'')*'"#,
    )
    .expect("secret pattern")
});

fn mask_secrets(sql: &str) -> std::borrow::Cow<'_, str> {
    SECRET.replace_all(sql, |c: &Captures| {
        let Some(head) = c.get(1) else {
            return format!("{}***", &c[3]);
        };
        let replaced = if c.get(2).is_some() {
            " REPLACE ***"
        } else {
            ""
        };
        format!("{}***{replaced}", head.as_str())
    })
}

thread_local! {
    static SOURCE: RefCell<String> = const { RefCell::new(String::new()) };
}

#[derive(Debug, Clone, Serialize)]
pub struct SqlLogEntry {
    pub id: u64,
    pub at_ms: u64,
    pub kind: &'static str,
    pub source: String,
    pub sql: String,
    pub duration_ms: f64,
    pub rows: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SqlLogPage {
    pub enabled: bool,
    pub entries: Vec<SqlLogEntry>,
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

pub fn with_source<T>(source: &str, f: impl FnOnce() -> T) -> T {
    if !enabled() {
        return f();
    }
    let previous = SOURCE.with(|s| s.replace(source.to_string()));
    let result = f();
    SOURCE.with(|s| *s.borrow_mut() = previous);
    result
}

pub fn record(
    kind: &'static str,
    sql: &str,
    elapsed: Duration,
    rows: Option<u64>,
    error: Option<&str>,
) {
    if !enabled() {
        return;
    }
    let sql = mask_secrets(sql);
    let sql = match sql.char_indices().nth(MAX_SQL) {
        Some((cut, _)) => format!("{}…", &sql[..cut]),
        None => sql.into_owned(),
    };
    let entry = SqlLogEntry {
        id: NEXT.fetch_add(1, Ordering::Relaxed),
        at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64),
        kind,
        source: SOURCE.with(|s| s.borrow().clone()),
        sql,
        duration_ms: elapsed.as_secs_f64() * 1000.0,
        rows,
        error: error.map(str::to_string),
    };
    let mut entries = ENTRIES.lock().unwrap_or_else(|e| e.into_inner());
    if entries.len() == CAPACITY {
        entries.pop_front();
    }
    entries.push_back(entry);
}

pub fn logged<T>(
    kind: &'static str,
    sql: &str,
    rows: impl FnOnce(&T) -> Option<u64>,
    f: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if !enabled() {
        return f();
    }
    let started = Instant::now();
    let result = f();
    finish(kind, sql, started, &result, rows);
    result
}

pub async fn logged_async<T>(
    kind: &'static str,
    sql: &str,
    rows: impl FnOnce(&T) -> Option<u64>,
    future: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    if !enabled() {
        return future.await;
    }
    let started = Instant::now();
    let result = future.await;
    finish(kind, sql, started, &result, rows);
    result
}

fn finish<T>(
    kind: &'static str,
    sql: &str,
    started: Instant,
    result: &Result<T, String>,
    rows: impl FnOnce(&T) -> Option<u64>,
) {
    record(
        kind,
        sql,
        started.elapsed(),
        result.as_ref().ok().and_then(rows),
        result.as_ref().err().map(String::as_str),
    );
}

#[tauri::command]
pub fn sql_log_configure(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn sql_log_entries(after: u64) -> SqlLogPage {
    let entries = ENTRIES.lock().unwrap_or_else(|e| e.into_inner());
    SqlLogPage {
        enabled: enabled(),
        entries: entries.iter().filter(|e| e.id > after).cloned().collect(),
    }
}

#[tauri::command]
pub fn sql_log_clear() {
    ENTRIES.lock().unwrap_or_else(|e| e.into_inner()).clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn percentile(samples: &mut [f64], p: f64) -> f64 {
        samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
        samples[((samples.len() - 1) as f64 * p) as usize]
    }

    #[test]
    fn secrets_are_masked() {
        assert_eq!(
            mask_secrets("ALTER USER app IDENTIFIED BY \"N3u!\" REPLACE alt;"),
            "ALTER USER app IDENTIFIED BY *** REPLACE ***;"
        );
        assert_eq!(
            mask_secrets("CREATE USER 'a'@'%' IDENTIFIED WITH caching_sha2_password BY 'x''y'"),
            "CREATE USER 'a'@'%' IDENTIFIED WITH caching_sha2_password BY ***"
        );
        assert_eq!(
            mask_secrets("ALTER ROLE app WITH PASSWORD 'geheim' VALID UNTIL 'infinity'"),
            "ALTER ROLE app WITH PASSWORD *** VALID UNTIL 'infinity'"
        );
        for plain in [
            "CREATE OR REPLACE PROCEDURE p IS BEGIN NULL; END;",
            "SELECT password FROM users",
        ] {
            assert_eq!(mask_secrets(plain), plain);
        }
    }

    #[test]
    fn log_stays_bounded_and_costs_little() {
        sql_log_clear();
        sql_log_configure(false);
        let sql = "SELECT owner, object_name FROM all_objects WHERE owner = 'HR'".repeat(20);
        let started = Instant::now();
        for _ in 0..100_000 {
            record("query", &sql, Duration::from_millis(3), Some(10), None);
        }
        let disabled = started.elapsed();
        assert!(sql_log_entries(0).entries.is_empty());

        sql_log_configure(true);
        let mut samples = Vec::with_capacity(20_000);
        for i in 0..20_000 {
            let started = Instant::now();
            with_source("meta", || {
                record("query", &sql, Duration::from_millis(3), Some(i), None)
            });
            samples.push(started.elapsed().as_secs_f64() * 1_000_000.0);
        }
        let page = sql_log_entries(0);
        sql_log_configure(false);
        assert_eq!(page.entries.len(), CAPACITY);
        assert!(page
            .entries
            .iter()
            .all(|e| e.source == "meta" && e.sql.chars().count() <= MAX_SQL + 1));
        assert_eq!(page.entries.last().unwrap().rows, Some(19_999));
        let after = page.entries[CAPACITY - 10].id;
        assert_eq!(sql_log_entries(after).entries.len(), 9);
        let (median, p95) = (
            percentile(&mut samples.clone(), 0.5),
            percentile(&mut samples, 0.95),
        );
        eprintln!(
            "sql_log: disabled 100k records in {:?}; enabled median {median:.2} µs, p95 {p95:.2} µs, retained {} entries",
            disabled,
            page.entries.len()
        );
        assert!(disabled < Duration::from_millis(50));
        assert!(p95 < 200.0);
        sql_log_clear();
    }
}
