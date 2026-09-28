use std::borrow::Cow;
use std::sync::{Arc, LazyLock, Mutex};

use regex::Regex;
use tauri::Runtime;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

const SENTRY_DSN: &str = "https://a0ed238540409e2a6ac907ef008a6ecd@o4512165553635328.ingest.de.sentry.io/4512165557436496";

static SENTRY: Mutex<Option<sentry::ClientInitGuard>> = Mutex::new(None);

static URL_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)[a-z][a-z0-9+.-]*://[^\s"']+"#).expect("url pattern"));

static SECRET_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(password|passwd|pwd|token|secret|api[_-]?key|apikey|authorization|bearer|passphrase)\s*[:=]\s*\S+",
    )
    .expect("secret pattern")
});

pub fn log_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir { file_name: None }))
        .target(Target::new(TargetKind::Stdout))
        .level(log::LevelFilter::Warn)
        .level_for("l8db_lib", log::LevelFilter::Info)
        .max_file_size(5_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(5))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
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
    SECRET_PATTERN
        .replace_all(&text, |caps: &regex::Captures| {
            format!("{}=<redacted>", &caps[1])
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

#[tauri::command]
pub async fn set_crash_reporting(enabled: bool) {
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
    options.max_breadcrumbs = 0;
    options.before_send = Some(Arc::new(scrub));
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
    use super::redact;

    #[test]
    fn redact_strips_urls_and_secrets() {
        let text =
            redact("connect postgres://admin:hunter2@db.example.com/prod failed, password=hunter2");
        assert!(!text.contains("hunter2"));
        assert!(!text.contains("db.example.com"));
        assert!(text.contains("<url>"));
        assert!(text.contains("password=<redacted>"));
    }
}
