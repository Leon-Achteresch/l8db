use tauri::Manager;

use crate::array_editor_target::open_owned_fixture;
use crate::db::{DatabaseAdapter, QueryResult};

const LABEL: &str = "routine-result-development";

pub(crate) fn selected(args: &[String]) -> bool {
    args == ["--routine-result-development"]
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum Routine {
    Fast,
    Slow,
}

struct Fixture {
    adapter: Box<dyn DatabaseAdapter>,
    gate: tokio::sync::Mutex<()>,
}

impl Fixture {
    async fn open() -> Result<(Self, std::path::PathBuf), String> {
        let (adapter, root, _) = open_owned_fixture().await?;
        for sql in [
            "CREATE SCHEMA a16",
            "CREATE SEQUENCE a16.completed",
            r#"CREATE PROCEDURE a16.fast(OUT details text, OUT missing text, OUT completed bigint)
               LANGUAGE plpgsql AS $$ BEGIN
                 details := repeat('Schnee 雪 · ', 4096) || 'END-A16';
                 missing := NULL;
                 completed := nextval('a16.completed');
               END $$"#,
            r#"CREATE PROCEDURE a16.slow(OUT details text, OUT missing text, OUT completed bigint)
               LANGUAGE plpgsql AS $$ BEGIN
                 PERFORM pg_sleep(6);
                 details := 'SLOW-A16';
                 missing := NULL;
                 completed := nextval('a16.completed');
               END $$"#,
        ] {
            adapter.execute_query(sql).await?;
        }
        Ok((
            Self {
                adapter,
                gate: tokio::sync::Mutex::new(()),
            },
            root,
        ))
    }

    async fn call(&self, routine: Routine) -> Result<QueryResult, String> {
        let _guard = self
            .gate
            .try_lock()
            .map_err(|_| "Fixture-Aufruf läuft bereits.")?;
        let sql = match routine {
            Routine::Fast => r#"CALL "a16"."fast"(NULL, NULL, NULL)"#,
            Routine::Slow => r#"CALL "a16"."slow"(NULL, NULL, NULL)"#,
        };
        self.adapter.execute_query(sql).await
    }
}

fn window_allowed(label: &str) -> Result<(), String> {
    if label == LABEL {
        Ok(())
    } else {
        Err("Kein isoliertes Routinenfenster.".into())
    }
}

#[tauri::command]
fn routine_result_development_ready(window: tauri::WebviewWindow) -> Result<bool, String> {
    window_allowed(window.label())?;
    Ok(true)
}

#[tauri::command]
async fn routine_result_development_call(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Fixture>,
    routine: Routine,
) -> Result<QueryResult, String> {
    window_allowed(window.label())?;
    state.call(routine).await
}

pub(crate) fn run(
    mut context: tauri::Context<tauri::Wry>,
) -> Result<(), Box<dyn std::error::Error>> {
    let url = crate::array_editor_development::development_url(
        &std::env::var("L8DB_A01_EDITOR_DEV_URL")?,
        LABEL,
    )?;
    let origin = url.origin();
    let (fixture, root) = tauri::async_runtime::block_on(Fixture::open())?;
    let directory = tempfile::Builder::new()
        .prefix("l8db-routine-result-")
        .tempdir_in(root)?;
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = format!(
        "com.leon.l8db.routineresult.{}",
        directory.path().file_name().unwrap().to_string_lossy()
    );
    context.config_mut().build.dev_url = Some(url.clone());
    let data_directory = directory.path().join("webview");
    eprintln!("routine-result-development: {}", directory.path().display());
    tauri::Builder::default()
        .manage(fixture)
        .setup(move |app| {
            app.add_capability(r#"{"identifier":"routine-result-development","windows":["routine-result-development"],"permissions":["core:window:allow-close"]}"#)?;
            tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::External(url))
                .title("l8db · Routine Result Development")
                .inner_size(1000.0, 720.0)
                .data_directory(data_directory)
                .incognito(true)
                .on_navigation(move |next| next.origin() == origin)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) { window.app_handle().exit(0); }
        })
        .invoke_handler(tauri::generate_handler![
            routine_result_development_ready,
            routine_result_development_call
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
    fn routine_development_guards() {
        assert!(selected(&["--routine-result-development".into()]));
        assert!(!selected(&[]));
        assert!(!selected(&[
            "--routine-result-development".into(),
            "--mcp".into()
        ]));
        assert!(window_allowed("main").is_err());
        assert!(window_allowed("array-editor-development").is_err());
        assert!(window_allowed(LABEL).is_ok());
        assert!(serde_json::from_str::<Routine>(r#""CALL public.example()""#).is_err());
    }

    #[tokio::test]
    #[ignore]
    async fn routine_development_provider_contract() {
        let (fixture, _) = Fixture::open().await.unwrap();
        let first = fixture.call(Routine::Fast).await.unwrap();
        assert_eq!(first.columns, ["details", "missing", "completed"]);
        assert_eq!(first.rows.len(), 1);
        assert_eq!(
            first.rows[0]["details"].as_str().unwrap(),
            format!("{}END-A16", "Schnee 雪 · ".repeat(4096))
        );
        assert!(first.rows[0]["missing"].is_null());
        assert_eq!(first.rows[0]["completed"], "1");

        let slow = async { fixture.call(Routine::Slow).await.unwrap() };
        let overlapping = async {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            assert_eq!(
                fixture.call(Routine::Fast).await.unwrap_err(),
                "Fixture-Aufruf läuft bereits."
            );
        };
        let (slow, _) = tokio::join!(slow, overlapping);
        assert_eq!(slow.rows[0]["details"], "SLOW-A16");
        assert_eq!(slow.rows[0]["completed"], "2");

        let mut times = Vec::new();
        for i in 0..11 {
            let start = std::time::Instant::now();
            let result = fixture.call(Routine::Fast).await.unwrap();
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            assert_eq!(result.rows[0]["completed"], (i + 3).to_string());
            assert!(serde_json::to_vec(&result).unwrap().len() < 64 * 1024);
            if i >= 2 {
                times.push(elapsed);
            }
        }
        times.sort_by(f64::total_cmp);
        println!("A16 PostgreSQL CALL: 9 samples after 2 warmups, median {:.3} ms, p95 {:.3} ms, one row under 64 KiB, serial CALLs and one overlap rejected", times[4], times[8]);
        assert!(times[4] < 150.0 && times[8] < 300.0);
    }
}
