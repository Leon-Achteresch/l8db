use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use regex::Regex;
use sentry::integrations::log::LogFilter;
use tauri::{Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

const SENTRY_DSN: &str = "https://a0ed238540409e2a6ac907ef008a6ecd@o4512165553635328.ingest.de.sentry.io/4512165557436496";

static SENTRY: Mutex<Option<sentry::ClientInitGuard>> = Mutex::new(None);

static URL_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)[a-z][a-z0-9+.-]*://[^\s"']+"#).expect("url pattern"));

static SECRET_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)(password|passwd|pwd|token|secret|api[_-]?key|apikey|authorization|bearer|passphrase)["']?\s*[:=]\s*(?:(?:bearer|basic|digest|token)\s+)?(?:"[^"]*"?|'[^']*'?|\{[^}]*\}?|\S+)"#,
    )
    .expect("secret pattern")
});

static BEARER_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]+").expect("bearer pattern"));

pub fn install_logger<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    let (plugin, level, logger) = tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir { file_name: None }))
        .target(Target::new(TargetKind::Stdout))
        .level(log::LevelFilter::Warn)
        .level_for("l8db_lib", log::LevelFilter::Info)
        .max_file_size(5_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(5))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .split(app)?;
    app.plugin(plugin)?;
    if let Ok(dir) = app.path().app_log_dir() {
        crate::issues::set_log_dir(dir);
    }
    let logger =
        sentry::integrations::log::SentryLogger::with_dest(logger).filter(
            |metadata| match metadata.level() {
                log::Level::Error | log::Level::Warn => LogFilter::Log | LogFilter::Breadcrumb,
                log::Level::Info => LogFilter::Breadcrumb,
                _ => LogFilter::Ignore,
            },
        );
    log::set_boxed_logger(Box::new(ServerOutputLogger(logger)))?;
    log::set_max_level(level);
    Ok(())
}

struct ServerOutputLogger<L>(L);

impl<L: log::Log> log::Log for ServerOutputLogger<L> {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        self.0.enabled(metadata)
    }

    fn log(&self, record: &log::Record) {
        if !crate::db::server_output::capture_log_record(record) {
            self.0.log(record);
        }
    }

    fn flush(&self) {
        self.0.flush();
    }
}

static PROCESS_STARTED: OnceLock<(Instant, f64)> = OnceLock::new();
static WINDOW_CREATED: OnceLock<f64> = OnceLock::new();
static SETUP_FINISHED: OnceLock<f64> = OnceLock::new();
static STARTUP_REPORTED: AtomicBool = AtomicBool::new(false);

pub fn mark_process_start() {
    if let Ok(elapsed) = SystemTime::now().duration_since(UNIX_EPOCH) {
        let _ = PROCESS_STARTED.set((Instant::now(), elapsed.as_secs_f64() * 1000.0));
    }
}

fn since_process_start() -> Option<f64> {
    PROCESS_STARTED
        .get()
        .map(|(started, _)| started.elapsed().as_secs_f64() * 1000.0)
}

pub fn mark_window_created() {
    if let Some(elapsed) = since_process_start() {
        let _ = WINDOW_CREATED.set(elapsed);
    }
}

pub fn mark_setup_finished() {
    if let Some(elapsed) = since_process_start() {
        let _ = SETUP_FINISHED.set(elapsed);
    }
}

fn startup_line(
    started: f64,
    navigation: f64,
    shell: f64,
    ready: f64,
    window: Option<f64>,
    setup: Option<f64>,
) -> Option<String> {
    let native = navigation - started;
    let plausible = |value: f64| value.is_finite() && (0.0..=600_000.0).contains(&value);
    if !plausible(native) || !plausible(shell) || !plausible(ready) {
        return None;
    }
    let phases = match (window, setup) {
        (Some(window), Some(setup)) if setup >= window => {
            format!(" (window {window:.0} ms, setup {:.0} ms)", setup - window)
        }
        _ => String::new(),
    };
    Some(format!(
        "startup: native {native:.0} ms{phases}, shell {shell:.0} ms, app {ready:.0} ms, total {:.0} ms",
        native + ready
    ))
}

#[tauri::command]
pub fn report_startup<R: Runtime>(
    handle: tauri::AppHandle<R>,
    navigation: f64,
    shell: f64,
    ready: f64,
) {
    if STARTUP_REPORTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(line) = PROCESS_STARTED.get().and_then(|(_, started)| {
        startup_line(
            *started,
            navigation,
            shell,
            ready,
            WINDOW_CREATED.get().copied(),
            SETUP_FINISHED.get().copied(),
        )
    }) else {
        return;
    };
    log::info!("{line}");
    if std::env::var_os("L8DB_STARTUP_PROBE").is_some() {
        log::logger().flush();
        handle.exit(0);
    }
}

pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        log::logger().flush();
        previous(info);
    }));
}

pub fn redact(text: &str) -> String {
    let text = URL_PATTERN.replace_all(text, "<url>");
    let text = SECRET_PATTERN.replace_all(&text, |caps: &regex::Captures| {
        format!("{}=<redacted>", &caps[1])
    });
    BEARER_PATTERN
        .replace_all(&text, |caps: &regex::Captures| {
            format!("{} <redacted>", &caps[1])
        })
        .into_owned()
}

fn scrub(mut event: sentry::protocol::Event<'static>) -> Option<sentry::protocol::Event<'static>> {
    event.server_name = None;
    event.user = None;
    event.request = None;
    if let Some(message) = event.message.as_mut() {
        *message = redact(message);
    }
    for exception in event.exception.values.iter_mut() {
        if let Some(value) = exception.value.as_mut() {
            *value = redact(value);
        }
    }
    Some(event)
}

fn scrub_log(mut entry: sentry::protocol::Log) -> Option<sentry::protocol::Log> {
    entry.body = redact(&entry.body);
    Some(entry)
}

fn scrub_breadcrumb(
    mut crumb: sentry::protocol::Breadcrumb,
) -> Option<sentry::protocol::Breadcrumb> {
    crumb.message = crumb.message.map(|message| redact(&message));
    crumb.data.clear();
    Some(crumb)
}

#[tauri::command]
pub async fn set_crash_reporting(enabled: bool) {
    let enabled = crate::organization::current(false)
        .ok()
        .map(|policy| policy.policy.settings.crash_reports.unwrap_or(enabled))
        .unwrap_or(false);
    let mut guard = SENTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !enabled {
        guard.take();
        return;
    }
    if guard.is_some() || cfg!(debug_assertions) {
        return;
    }
    let mut options = sentry::ClientOptions::default();
    options.release = sentry::release_name!();
    options.environment = Some(Cow::Borrowed("production"));
    options.send_default_pii = false;
    options.max_breadcrumbs = 50;
    options.before_send = Some(Arc::new(scrub));
    options.before_send_log = Some(Arc::new(scrub_log));
    options.before_breadcrumb = Some(Arc::new(scrub_breadcrumb));
    *guard = Some(sentry::init((SENTRY_DSN, options)));
}

#[cfg(target_os = "macos")]
pub fn app_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let settings = MenuItemBuilder::with_id("settings.open", "Einstellungen …")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "l8db")
        .text("menu.about", "Über l8db")
        .separator()
        .item(&settings)
        .text("menu.updates", "Nach Updates suchen …")
        .separator()
        .services_with_text("Dienste")
        .separator()
        .hide_with_text("l8db ausblenden")
        .hide_others_with_text("Andere ausblenden")
        .show_all_with_text("Alle einblenden")
        .separator()
        .quit_with_text("l8db beenden")
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "Ablage")
        .text("window.new", "Neues Fenster")
        .text("tab.newQuery", "Neue Abfrage")
        .text("query.openFile", "SQL-Datei öffnen …")
        .separator()
        .text("tab.reopen", "Geschlossenen Tab wiederherstellen")
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Bearbeiten")
        .undo_with_text("Widerrufen")
        .redo_with_text("Wiederholen")
        .separator()
        .cut_with_text("Ausschneiden")
        .copy_with_text("Kopieren")
        .paste_with_text("Einsetzen")
        .select_all_with_text("Alles auswählen")
        .build()?;
    let zoom_in = MenuItemBuilder::with_id("view.zoomIn", "Vergrößern")
        .accelerator("CmdOrCtrl+Plus")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("view.zoomOut", "Verkleinern")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("view.zoomReset", "Originalgröße")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let view_menu = SubmenuBuilder::new(app, "Darstellung")
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .separator()
        .text("sidebar.toggle", "Seitenleiste ein-/ausblenden")
        .separator()
        .fullscreen_with_text("Vollbildmodus")
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Fenster")
        .minimize_with_text("Im Dock ablegen")
        .maximize_with_text("Zoomen")
        .separator()
        .close_window_with_text("Fenster schließen")
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Hilfe")
        .text("menu.docs", "l8db-Dokumentation")
        .text("shortcuts.open", "Tastenkürzel")
        .text("menu.releaseNotes", "Neuigkeiten")
        .text("menu.discover", "Entdecken")
        .text("help.whatsThis", "Was ist das?")
        .text("help.cheatsheet", "Spickzettel")
        .separator()
        .text("menu.bugReport", "Fehler melden …")
        .build()?;
    MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::{redact, startup_line};

    #[test]
    fn startup_line_reports_native_and_total_time_and_rejects_implausible_values() {
        assert_eq!(
            startup_line(1_000.0, 1_412.4, 18.2, 143.3, Some(300.2), Some(341.0)).as_deref(),
            Some(
                "startup: native 412 ms (window 300 ms, setup 41 ms), shell 18 ms, app 143 ms, total 556 ms"
            )
        );
        assert_eq!(
            startup_line(1_000.0, 1_412.4, 18.2, 143.3, None, Some(341.0)).as_deref(),
            Some("startup: native 412 ms, shell 18 ms, app 143 ms, total 556 ms")
        );
        assert_eq!(startup_line(1_000.0, 900.0, 18.0, 143.0, None, None), None);
        assert_eq!(
            startup_line(1_000.0, 1_000_000.0, 18.0, 143.0, None, None),
            None
        );
        assert_eq!(
            startup_line(1_000.0, 1_400.0, f64::NAN, 143.0, None, None),
            None
        );
        assert_eq!(startup_line(1_000.0, 1_400.0, 18.0, -1.0, None, None), None);
    }

    #[test]
    fn redact_strips_urls_and_secrets() {
        let text =
            redact("connect postgres://admin:hunter2@db.example.com/prod failed, password=hunter2");
        assert!(!text.contains("hunter2"));
        assert!(!text.contains("db.example.com"));
        assert!(text.contains("<url>"));
        assert!(text.contains("password=<redacted>"));
    }

    #[test]
    fn redact_strips_bearer_tokens_and_quoted_secrets() {
        let cases = [
            ("Authorization: Bearer abc.def.ghi", "abc.def.ghi"),
            ("authorization=Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"),
            ("header Bearer eyJhbGciOi.payload.sig", "eyJhbGciOi"),
            ("password='correct horse battery'", "horse"),
            ("password=\"correct horse battery\"", "horse"),
            ("{\"password\":\"s3cret value\",\"user\":\"app\"}", "value"),
            ("Server=db;PWD={my secret};Database=x", "secret"),
        ];
        for (input, leaked) in cases {
            let text = redact(input);
            assert!(!text.contains(leaked), "{input} -> {text}");
            assert!(text.contains("<redacted>"), "{input} -> {text}");
        }
        assert_eq!(
            redact("password authentication failed for user \"app\""),
            "password authentication failed for user \"app\""
        );
    }
}
