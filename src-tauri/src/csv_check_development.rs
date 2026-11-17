use std::io::Write;
use tauri::Manager;

const LABEL: &str = "csv-check-development";

pub fn selected(args: &[String]) -> bool {
    args == ["--csv-check-development"]
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DevelopmentContext {
    ephemeral: bool,
    directory: String,
}

#[tauri::command]
fn csv_check_development_context(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DevelopmentContext>,
) -> Result<DevelopmentContext, String> {
    if window.label() != LABEL {
        return Err("Kein isoliertes CSV-Prüffenster.".into());
    }
    Ok(state.inner().clone())
}

fn validate_sample(directory: &str, path: &str) -> Result<(), String> {
    let root = std::path::Path::new(directory).join("samples");
    let selected = std::path::Path::new(path);
    let canonical = selected.canonicalize().map_err(|error| error.to_string())?;
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err("Datei liegt nicht im synthetischen Sitzungsverzeichnis.".into());
    }
    Ok(())
}

#[tauri::command(async)]
fn read_csv_preview(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, DevelopmentContext>,
) -> Result<serde_json::Value, String> {
    validate_sample(&state.directory, &path)?;
    crate::db::commands::read_csv_preview(path, app)
}

#[tauri::command]
async fn check_csv_file(
    request: crate::db::csv_check::CheckRequest,
    options: Option<crate::db::execution::ExecutionOptions>,
    app: tauri::AppHandle,
    state: tauri::State<'_, DevelopmentContext>,
) -> Result<crate::db::csv_check::CheckReport, String> {
    validate_sample(&state.directory, &request.source.path)?;
    crate::db::csv_check::check_csv_file(request, options, app).await
}

fn session_directory() -> std::io::Result<tempfile::TempDir> {
    let directory = tempfile::Builder::new()
        .prefix("l8db-csv-check-")
        .tempdir()?;
    let samples = directory.path().join("samples");
    std::fs::create_dir(&samples)?;
    for (name, content) in [
        ("clean.csv", "id,name\n1,Alpha\n2,Beta\n"),
        ("findings.csv", "id,name\n1,Alpha\n2\n3,\n"),
        ("parser-error.csv", "id,name\n1,Alpha\n2,\"unfinished\n"),
    ] {
        let mut file = std::fs::File::create(samples.join(name))?;
        file.write_all(content.as_bytes())?;
    }
    Ok(directory)
}

pub fn run(mut context: tauri::Context<tauri::Wry>) -> Result<(), Box<dyn std::error::Error>> {
    let directory = session_directory()?;
    let session = DevelopmentContext {
        ephemeral: true,
        directory: directory.path().to_string_lossy().into_owned(),
    };
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = format!(
        "com.leon.l8db.csvcheck.{}",
        directory.path().file_name().unwrap().to_string_lossy()
    );
    let mut url = context
        .config()
        .build
        .dev_url
        .clone()
        .ok_or("Development-URL fehlt.")?;
    if url.scheme() != "http" || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
    {
        return Err("CSV-Prüfung benötigt einen lokalen Developmentserver.".into());
    }
    url.set_path("/");
    url.set_query(Some("csv-check-development=1"));
    let data_directory = directory.path().join("webview");
    eprintln!("csv-check-development: {}", directory.path().display());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(session)
        .setup(move |app| {
            use tauri_plugin_fs::FsExt;
            let sample = app.state::<DevelopmentContext>().directory.clone();
            if app
                .fs_scope()
                .is_allowed(std::path::Path::new(&sample).join("samples/clean.csv"))
            {
                return Err("CSV-Testdatei hat unerwartet Zugriff vor dem Dateidialog.".into());
            }
            app.add_capability(
                r#"{
                "identifier":"csv-check-development",
                "windows":["csv-check-development"],
                "permissions":["core:event:default","core:window:allow-close","dialog:allow-open"]
            }"#,
            )?;
            tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::External(url))
                .title("l8db · CSV-Check Development")
                .inner_size(1000.0, 680.0)
                .data_directory(data_directory)
                .incognito(true)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            csv_check_development_context,
            read_csv_preview,
            check_csv_file,
            crate::db::commands::cancel_execution,
        ])
        .build(context)?
        .run_return(|_, _| {});
    directory.close()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_requires_the_exact_explicit_argument() {
        assert!(selected(&["--csv-check-development".into()]));
        for args in [
            vec![],
            vec!["csv-check-development".into()],
            vec!["--csv-check-development".into(), "--mcp".into()],
        ] {
            assert!(!selected(&args));
        }
    }

    #[test]
    fn sessions_are_fresh_and_own_only_synthetic_samples() {
        let first = session_directory().unwrap();
        let second = session_directory().unwrap();
        assert_ne!(first.path(), second.path());
        assert_eq!(
            std::fs::read_to_string(first.path().join("samples/clean.csv")).unwrap(),
            "id,name\n1,Alpha\n2,Beta\n"
        );
        let path = first.path().to_owned();
        first.close().unwrap();
        assert!(!path.exists());
        assert!(second.path().exists());
    }

    #[test]
    fn private_paths_traversal_and_symlinks_cannot_enter_the_reader() {
        let own = session_directory().unwrap();
        let other = session_directory().unwrap();
        let root = own.path().to_str().unwrap();
        assert!(validate_sample(
            root,
            own.path()
                .join("samples/clean.csv")
                .canonicalize()
                .unwrap()
                .to_str()
                .unwrap()
        )
        .is_ok());
        assert!(
            validate_sample(root, own.path().join("samples/clean.csv").to_str().unwrap()).is_ok()
        );
        assert!(validate_sample(
            root,
            other.path().join("samples/clean.csv").to_str().unwrap()
        )
        .is_err());
        assert!(validate_sample(
            root,
            own.path().join("samples/../outside.csv").to_str().unwrap()
        )
        .is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                other.path().join("samples/clean.csv"),
                own.path().join("samples/link.csv"),
            )
            .unwrap();
            assert!(
                validate_sample(root, own.path().join("samples/link.csv").to_str().unwrap())
                    .is_err()
            );
        }
    }
}
