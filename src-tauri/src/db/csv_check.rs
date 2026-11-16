use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::UNIX_EPOCH;
use tokio_util::sync::CancellationToken;

use super::csv_stream::CsvFileSource;

pub const MAX_ISSUES: usize = 10;

#[derive(Clone, Deserialize)]
pub struct CheckColumn {
    pub index: usize,
    pub name: String,
    pub nullable: bool,
}

#[derive(Clone, Deserialize)]
pub struct CheckRequest {
    pub source: CsvFileSource,
    pub expected_columns: usize,
    pub columns: Vec<CheckColumn>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckIssue {
    pub row: u64,
    pub line: usize,
    pub column: Option<String>,
    pub kind: &'static str,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct CheckReport {
    pub status: &'static str,
    pub checked_rows: u64,
    pub error_count: u64,
    pub issues: Vec<CheckIssue>,
    pub source_size: u64,
    pub source_modified_ms: Option<u64>,
}

fn stamp(path: &str) -> Result<(u64, Option<std::time::SystemTime>), String> {
    let meta = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if !meta.is_file() {
        return Err("Dateiprüfung benötigt eine reguläre Datei.".into());
    }
    Ok((meta.len(), meta.modified().ok()))
}

impl CheckReport {
    fn issue(
        &mut self,
        row: u64,
        line: usize,
        column: Option<&str>,
        kind: &'static str,
        message: impl FnOnce() -> String,
    ) {
        self.error_count += 1;
        if self.issues.len() < MAX_ISSUES {
            self.issues.push(CheckIssue {
                row,
                line,
                column: column.map(str::to_string),
                kind,
                message: message(),
            });
        }
    }
}

pub fn check(
    request: &CheckRequest,
    cancel: CancellationToken,
    progress: impl Fn(u64),
) -> Result<CheckReport, String> {
    let mut names = HashSet::new();
    if request.expected_columns == 0
        || request.expected_columns > 10_000
        || request.columns.is_empty()
        || request.columns.len() > 10_000
    {
        return Err("Ungültige Spaltenzahl für die Dateiprüfung.".into());
    }
    for column in &request.columns {
        if column.index >= request.expected_columns
            || column.name.is_empty()
            || column.name.len() > 1024
            || !names.insert(&column.name)
        {
            return Err("Ungültige oder mehrfache Zielzuordnung für die Dateiprüfung.".into());
        }
    }
    let before = stamp(&request.source.path)?;
    let mut report = CheckReport {
        status: "complete",
        checked_rows: 0,
        error_count: 0,
        issues: Vec::new(),
        source_size: before.0,
        source_modified_ms: before
            .1
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|time| time.as_millis() as u64),
    };
    if cancel.is_cancelled() {
        report.status = "cancelled";
        return Ok(report);
    }
    let mut rows = super::import_source::open_csv_records(&request.source, cancel.clone())?;
    let mut header = request.source.has_header;
    progress(0);
    loop {
        if cancel.is_cancelled() {
            report.status = "cancelled";
            break;
        }
        let (line, values) = match rows.next_record() {
            Ok(Some(row)) => row,
            Ok(None) => break,
            Err(error) => {
                if cancel.is_cancelled() {
                    report.status = "cancelled";
                } else {
                    report.status = "incomplete";
                    report.issue(
                        if header { 0 } else { report.checked_rows + 1 },
                        0,
                        None,
                        "parse",
                        || error,
                    );
                }
                break;
            }
        };
        if header {
            header = false;
            if values.len() != request.expected_columns {
                report.issue(0, line, None, "structure", || {
                    "Kopfzeile hat eine andere Spaltenzahl als die Vorschau.".into()
                });
            }
            continue;
        }
        report.checked_rows += 1;
        let row = report.checked_rows;
        if values.len() != request.expected_columns {
            report.issue(row, line, None, "structure", || {
                format!(
                    "{} statt {} CSV-Spalten.",
                    values.len(),
                    request.expected_columns
                )
            });
        }
        for column in &request.columns {
            if !column.nullable && matches!(values.get(column.index), Some(None)) {
                report.issue(row, line, Some(&column.name), "not_null", || {
                    "Darf nicht NULL sein.".into()
                });
            }
        }
        if row % 8192 == 0 {
            progress(row);
        }
    }
    if header && report.status == "complete" {
        report.issue(0, 1, None, "structure", || {
            "Erwartete Kopfzeile fehlt.".into()
        });
    }
    if cancel.is_cancelled() {
        report.status = "cancelled";
    }
    if stamp(&request.source.path).ok() != Some(before) {
        report.status = "changed";
    }
    progress(report.checked_rows);
    Ok(report)
}

fn scan_slots() -> std::sync::Arc<tokio::sync::Semaphore> {
    static SLOTS: std::sync::OnceLock<std::sync::Arc<tokio::sync::Semaphore>> =
        std::sync::OnceLock::new();
    SLOTS
        .get_or_init(|| std::sync::Arc::new(tokio::sync::Semaphore::new(1)))
        .clone()
}

async fn run_check(
    request: CheckRequest,
    cancel: CancellationToken,
    progress: impl Fn(u64) + Send + Sync + 'static,
) -> Result<CheckReport, String> {
    let progress = std::sync::Arc::new(progress);
    progress(0);
    let permit = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err("Dateiprüfung abgebrochen.".into()),
        permit = scan_slots().acquire_owned() => permit.map_err(|_| "Dateiprüfung nicht verfügbar.")?,
    };
    let updates = progress.clone();
    let report = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let last = std::sync::Mutex::new(std::time::Instant::now());
        check(&request, cancel, |rows| {
            let mut last = last.lock().unwrap_or_else(|error| error.into_inner());
            if rows > 0 && last.elapsed() >= std::time::Duration::from_millis(100) {
                updates(rows);
                *last = std::time::Instant::now();
            }
        })
    })
    .await
    .map_err(|error| format!("Dateiprüfung: {error}"))??;
    progress(report.checked_rows);
    Ok(report)
}

#[tauri::command]
pub async fn check_csv_file(
    request: CheckRequest,
    options: Option<super::execution::ExecutionOptions>,
    app: tauri::AppHandle,
) -> Result<CheckReport, String> {
    use tauri::Emitter;
    use tauri_plugin_fs::FsExt;
    if !app.fs_scope().is_allowed(&request.source.path) {
        return Err("CSV-Datei wurde nicht zum Zugriff freigegeben. Bitte erneut wählen.".into());
    }
    let job = options.as_ref().and_then(|value| value.job_id.clone());
    super::execution::run(options, true, async move {
        run_check(
            request,
            super::execution::cancellation_token(),
            move |rows| {
                let _ = app.emit(
                    "csv-check-progress",
                    serde_json::json!({"jobId": job, "rows": rows}),
                );
            },
        )
        .await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, Instant};

    fn request(path: &str) -> CheckRequest {
        CheckRequest {
            source: CsvFileSource {
                path: path.into(),
                delimiter: ",".into(),
                quote: "\"".into(),
                has_header: true,
                empty_as_null: true,
                indices: vec![0, 1],
                ..Default::default()
            },
            expected_columns: 2,
            columns: vec![
                CheckColumn {
                    index: 0,
                    name: "id".into(),
                    nullable: false,
                },
                CheckColumn {
                    index: 1,
                    name: "label".into(),
                    nullable: false,
                },
            ],
        }
    }

    #[tokio::test]
    async fn queued_cancellation_opens_no_file_and_releases_capacity() {
        let permit = scan_slots().acquire_owned().await.unwrap();
        let token = CancellationToken::new();
        let cancel = token.clone();
        let result = run_check(request("/not-opened.csv"), token, move |_| cancel.cancel()).await;
        assert!(result.unwrap_err().contains("abgebrochen"));
        assert_eq!(scan_slots().available_permits(), 0);
        drop(permit);
        assert_eq!(scan_slots().available_permits(), 1);
    }

    #[tokio::test]
    async fn command_scan_throttles_progress_and_releases_capacity() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "id,label").unwrap();
        for _ in 0..100_000 {
            writeln!(file, "1,ok").unwrap();
        }
        let calls = std::sync::Arc::new(AtomicUsize::new(0));
        let updates = calls.clone();
        let start = Instant::now();
        let report = run_check(
            request(file.path().to_str().unwrap()),
            CancellationToken::new(),
            move |_| {
                updates.fetch_add(1, Ordering::Relaxed);
            },
        )
        .await
        .unwrap();
        assert_eq!(report.checked_rows, 100_000);
        assert!(calls.load(Ordering::Relaxed) <= 2 + start.elapsed().as_millis() as usize / 100);
        assert_eq!(scan_slots().available_permits(), 1);
    }

    #[test]
    fn standalone_cr_lines_and_malformed_header_keep_correct_locations() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        write!(file, "id,label\r1,\"a\rb\"\r2,\r").unwrap();
        let report = check(
            &request(file.path().to_str().unwrap()),
            CancellationToken::new(),
            |_| {},
        )
        .unwrap();
        assert_eq!(report.checked_rows, 2);
        assert_eq!(report.error_count, 1);
        assert_eq!(report.issues[0].line, 4);
        let mut header = tempfile::NamedTempFile::new().unwrap();
        write!(header, "\"unterminated").unwrap();
        let report = check(
            &request(header.path().to_str().unwrap()),
            CancellationToken::new(),
            |_| {},
        )
        .unwrap();
        assert_eq!(report.status, "incomplete");
        assert_eq!(report.issues[0].row, 0);
    }

    #[test]
    fn scans_past_preview_and_counts_all_bounded_issues_without_values() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "id,label").unwrap();
        for _ in 0..20_000 {
            writeln!(file, "1,private-value").unwrap();
        }
        for _ in 0..20 {
            writeln!(file, ",").unwrap();
        }
        writeln!(file, "extra,cell,here").unwrap();
        writeln!(file, "missing").unwrap();
        let report = check(
            &request(file.path().to_str().unwrap()),
            CancellationToken::new(),
            |_| {},
        )
        .unwrap();
        assert_eq!(report.status, "complete");
        assert_eq!(report.checked_rows, 20_022);
        assert_eq!(report.error_count, 42);
        assert_eq!(report.issues.len(), MAX_ISSUES);
        assert_eq!(report.issues[0].row, 20_001);
        assert_eq!(report.issues[0].line, 20_002);
        assert!(!serde_json::to_string(&report)
            .unwrap()
            .contains("private-value"));
    }

    #[test]
    fn preserves_csv_null_quoting_multiline_and_physical_lines() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        write!(file, "id,label\r\n1,\"a\nb\"\r\n2,\"\"\r\n3,NULL\r\n").unwrap();
        let mut request = request(file.path().to_str().unwrap());
        request.source.null_text = Some("NULL".into());
        let report = check(&request, CancellationToken::new(), |_| {}).unwrap();
        assert_eq!(report.checked_rows, 3);
        assert_eq!(report.error_count, 1);
        assert_eq!(report.issues[0].row, 3);
        assert_eq!(report.issues[0].line, 5);
    }

    #[test]
    fn fatal_parse_and_empty_header_are_never_clean_complete() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        write!(file, "id,label\n1,ok\n2,\"unfinished").unwrap();
        let report = check(
            &request(file.path().to_str().unwrap()),
            CancellationToken::new(),
            |_| {},
        )
        .unwrap();
        assert_eq!(report.status, "incomplete");
        assert_eq!(report.checked_rows, 1);
        assert_eq!(report.error_count, 1);
        let empty = tempfile::NamedTempFile::new().unwrap();
        let report = check(
            &request(empty.path().to_str().unwrap()),
            CancellationToken::new(),
            |_| {},
        )
        .unwrap();
        assert_eq!(report.error_count, 1);
        assert_eq!(report.checked_rows, 0);
    }

    #[test]
    fn cancellation_before_and_during_scan_stops_without_further_work() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "id,label").unwrap();
        for _ in 0..30_000 {
            writeln!(file, "1,ok").unwrap();
        }
        let request = request(file.path().to_str().unwrap());
        let token = CancellationToken::new();
        token.cancel();
        let calls = AtomicUsize::new(0);
        let report = check(&request, token, |_| {
            calls.fetch_add(1, Ordering::Relaxed);
        })
        .unwrap();
        assert_eq!(report.status, "cancelled");
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        let token = CancellationToken::new();
        let report = check(&request, token.clone(), |rows| {
            if rows >= 8192 {
                token.cancel();
            }
        })
        .unwrap();
        assert_eq!(report.status, "cancelled");
        assert_eq!(report.checked_rows, 8192);
        let after = calls.load(Ordering::Relaxed);
        std::thread::sleep(Duration::from_millis(10));
        assert_eq!(calls.load(Ordering::Relaxed), after);
    }

    #[test]
    fn cancellation_inside_a_large_record_is_prompt() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "id,label\n1,{}", "x".repeat(1024 * 1024)).unwrap();
        let token = CancellationToken::new();
        let cancel = token.clone();
        let start = Instant::now();
        let worker = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1));
            cancel.cancel();
        });
        let report = check(&request(file.path().to_str().unwrap()), token, |_| {}).unwrap();
        worker.join().unwrap();
        eprintln!(
            "csv-check-large-record cancellation_ms={:.2}",
            start.elapsed().as_secs_f64() * 1000.0
        );
        assert_eq!(report.status, "cancelled");
        assert_eq!(report.checked_rows, 0);
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn changed_file_is_not_approved_and_invalid_mappings_fail() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        write!(file, "id,label\n1,ok\n").unwrap();
        let path = file.path().to_str().unwrap();
        let mut request = request(path);
        let report = check(&request, CancellationToken::new(), |rows| {
            if rows == 0 {
                std::fs::write(path, "id,label\n2,new-content\n").unwrap();
            }
        })
        .unwrap();
        assert_eq!(report.status, "changed");
        request.columns[0].index = 99;
        assert!(check(&request, CancellationToken::new(), |_| {}).is_err());
    }

    #[test]
    fn oversized_record_stops_at_the_existing_parser_bound() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "id,label\n1,{}", "x".repeat(1024 * 1024 + 1)).unwrap();
        let report = check(
            &request(file.path().to_str().unwrap()),
            CancellationToken::new(),
            |_| {},
        )
        .unwrap();
        assert_eq!(report.status, "incomplete");
        assert_eq!(report.checked_rows, 0);
        assert!(report.issues[0].message.contains("1 MiB"));
    }

    #[test]
    fn performance_streams_100k_rows_with_bounded_output_and_progress() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "id,label").unwrap();
        for _ in 0..100_000 {
            writeln!(file, ",").unwrap();
        }
        let request = request(file.path().to_str().unwrap());
        let mut times = Vec::new();
        let mut size = 0;
        for run in 0..7 {
            let calls = AtomicUsize::new(0);
            let start = Instant::now();
            let report = check(&request, CancellationToken::new(), |_| {
                calls.fetch_add(1, Ordering::Relaxed);
            })
            .unwrap();
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            assert_eq!(report.checked_rows, 100_000);
            assert_eq!(report.error_count, 200_000);
            assert_eq!(report.issues.len(), MAX_ISSUES);
            assert!(calls.load(Ordering::Relaxed) <= 15);
            size = serde_json::to_vec(&report).unwrap().len();
            assert!(size < 3000);
            if run >= 2 {
                times.push(elapsed);
            }
        }
        times.sort_by(f64::total_cmp);
        eprintln!("csv-file-check rows=100000 cols=2 errors=200000 median_ms={:.2} p95_ms={:.2} report_bytes={} max_issues={} db_requests=0", times[2], times[4], size, MAX_ISSUES);
        assert!(times[2] < 1500.0);
        assert!(times[4] < 2500.0);
    }
}
