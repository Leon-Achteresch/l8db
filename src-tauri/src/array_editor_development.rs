use std::collections::HashMap;
use tauri::Manager;

use crate::db::pool::create_pool_state;
use crate::db::{DatabaseAdapter, DatabaseKind, DetailedColumnInfo, TableData};

const LABEL: &str = "array-editor-development";
const SCHEMA: &str = "a01_editor";
const TABLE: &str = "cells";
const COLUMNS: [&str; 4] = ["items", "nums", "empty_items", "null_items"];

pub fn selected(args: &[String]) -> bool {
    args == ["--array-editor-development"]
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    data: TableData,
    details: serde_json::Value,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DevelopmentContext {
    ephemeral: bool,
    token: String,
    columns: Vec<DetailedColumnInfo>,
    snapshot: Snapshot,
}

struct Fixture {
    adapter: Box<dyn DatabaseAdapter>,
    directory: std::path::PathBuf,
    token: String,
    gate: tokio::sync::Mutex<()>,
}

impl Fixture {
    async fn open() -> Result<Self, String> {
        let database = std::env::var("L8DB_A01_LOCAL_OWNED_DB").map_err(|e| e.to_string())?;
        let candidate = std::env::var("L8DB_A01_LOCAL_PG_URL").map_err(|e| e.to_string())?;
        let url = crate::array_editor_target::owned_url(&candidate, &database)?;
        let directory = std::env::var("L8DB_A01_LOCAL_OWNED_DIR").map_err(|e| e.to_string())?;
        let root = std::path::Path::new(&directory)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let temp = std::env::temp_dir()
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if root.parent() != Some(temp.as_path())
            || !root
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .starts_with("l8db-a01-pg.")
            || std::fs::read_to_string(root.join("a01-owner")).map_err(|e| e.to_string())?
                != database
        {
            return Err("Eigene A01-Clusterdateigrenze fehlt.".into());
        }
        let adapter = crate::db::create_adapter_from_string(
            DatabaseKind::Postgres,
            &url,
            None,
            create_pool_state(),
        )?;
        let identity = adapter.execute_query("SELECT current_database() AS db, current_user AS usr, current_setting('cluster_name') AS marker, inet_server_addr()::text AS host").await?;
        let identity = identity.rows.first().ok_or("Clusterkennung fehlt.")?;
        if identity["db"] != database
            || identity["marker"] != database
            || identity["usr"] != "l8db_a01"
            || identity["host"] != "127.0.0.1/32"
        {
            return Err("Fremder PostgreSQL-Cluster: kein Fixturezugriff.".into());
        }
        for sql in [
            "CREATE SCHEMA a01_editor",
            "CREATE TABLE a01_editor.cells(id integer PRIMARY KEY CHECK(id=1), items text[], nums numeric[], empty_items text[], null_items text[])",
            "INSERT INTO a01_editor.cells VALUES(1,'[-2:-1][5:6]={{a,b},{c,d}}','[0:1]={9007199254740993.1234500,0.1234567890123456789000}','{}',NULL)",
            "CREATE SEQUENCE a01_editor.attempts MINVALUE 0 START 0",
            "CREATE FUNCTION a01_editor.track() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM nextval('a01_editor.attempts'); RETURN NULL; END$$",
            "CREATE TRIGGER track BEFORE UPDATE ON a01_editor.cells FOR EACH STATEMENT EXECUTE FUNCTION a01_editor.track()",
        ] {
            adapter.execute_query(sql).await?;
        }
        Ok(Self {
            adapter,
            directory: root,
            token: database,
            gate: tokio::sync::Mutex::new(()),
        })
    }

    async fn read(&self) -> Result<Snapshot, String> {
        let _guard = self
            .gate
            .try_lock()
            .map_err(|_| "Fixture ist beschäftigt.")?;
        self.snapshot().await
    }

    async fn snapshot(&self) -> Result<Snapshot, String> {
        let data = self
            .adapter
            .fetch_rows(SCHEMA, TABLE, None, 1, 0, None, false, false, false)
            .await?;
        let details = self.adapter.execute_query("SELECT array_dims(items) AS items_bounds, items::text AS items_wire, array_dims(nums) AS nums_bounds, nums::text AS nums_wire, empty_items::text AS empty_wire, null_items::text AS null_wire, (SELECT last_value FROM a01_editor.attempts) AS attempts, (SELECT is_called FROM a01_editor.attempts) AS attempted FROM a01_editor.cells WHERE id=1").await?.rows.remove(0);
        Ok(Snapshot { data, details })
    }

    fn validate(
        &self,
        kind: DatabaseKind,
        token: &str,
        database: Option<&str>,
        schema: &str,
        table: &str,
        ctid: &str,
        updates: &HashMap<String, Option<String>>,
    ) -> Result<(), String> {
        if kind != DatabaseKind::Postgres
            || token != self.token
            || database.is_some()
            || schema != SCHEMA
            || table != TABLE
            || ctid.len() > 128
            || ctid.is_empty()
            || updates.len() != 1
            || updates.keys().any(|key| !COLUMNS.contains(&key.as_str()))
            || updates
                .values()
                .flatten()
                .any(|value| value.len() > 512 * 1024)
        {
            return Err("Nur eine Arrayzelle der eigenen A01-Fixture ist freigegeben.".into());
        }
        Ok(())
    }

    async fn write(
        &self,
        kind: DatabaseKind,
        token: &str,
        database: Option<&str>,
        schema: &str,
        table: &str,
        ctid: &str,
        updates: &HashMap<String, Option<String>>,
    ) -> Result<(), String> {
        self.validate(kind, token, database, schema, table, ctid, updates)?;
        let _guard = self
            .gate
            .try_lock()
            .map_err(|_| "Fixture ist beschäftigt.")?;
        let current = self
            .adapter
            .fetch_rows(SCHEMA, TABLE, None, 1, 0, None, false, false, false)
            .await?;
        if current
            .rows
            .first()
            .and_then(|row| row["__ctid__"].as_str())
            != Some(ctid)
        {
            return Err("Fixture wurde verändert. Bitte neu lesen.".into());
        }
        self.adapter.update_row(SCHEMA, TABLE, ctid, updates).await
    }
}

fn window_allowed(label: &str) -> Result<(), String> {
    if label == LABEL {
        Ok(())
    } else {
        Err("Kein isoliertes Arrayfenster.".into())
    }
}

#[tauri::command]
async fn array_editor_development_context(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Fixture>,
) -> Result<DevelopmentContext, String> {
    window_allowed(window.label())?;
    let columns = state
        .adapter
        .list_table_columns_detailed(SCHEMA, TABLE)
        .await?;
    Ok(DevelopmentContext {
        ephemeral: true,
        token: state.token.clone(),
        columns,
        snapshot: state.read().await?,
    })
}

#[tauri::command]
async fn array_editor_development_read(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Fixture>,
) -> Result<Snapshot, String> {
    window_allowed(window.label())?;
    state.read().await
}

#[tauri::command]
async fn update_row(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Fixture>,
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    table: String,
    ctid: String,
    updates: HashMap<String, Option<String>>,
) -> Result<(), String> {
    window_allowed(window.label())?;
    state
        .write(
            kind,
            &connection_string,
            database.as_deref(),
            &schema,
            &table,
            &ctid,
            &updates,
        )
        .await
}

fn development_url(candidate: &str) -> Result<url::Url, String> {
    let mut url = url::Url::parse(candidate).map_err(|error| error.to_string())?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Arrayeditor benötigt einen eigenen Loopback-Developmentserver.".into());
    }
    url.set_path("/");
    url.set_query(Some("array-editor-development=1"));
    url.set_fragment(None);
    Ok(url)
}

pub fn run(mut context: tauri::Context<tauri::Wry>) -> Result<(), Box<dyn std::error::Error>> {
    let url = development_url(&std::env::var("L8DB_A01_EDITOR_DEV_URL")?)?;
    let fixture = tauri::async_runtime::block_on(Fixture::open())?;
    let directory = tempfile::Builder::new()
        .prefix("l8db-array-editor-")
        .tempdir_in(&fixture.directory)?;
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = format!(
        "com.leon.l8db.arrayeditor.{}",
        directory.path().file_name().unwrap().to_string_lossy()
    );
    context.config_mut().build.dev_url = Some(url.clone());
    let data_directory = directory.path().join("webview");
    eprintln!("array-editor-development: {}", directory.path().display());
    tauri::Builder::default()
        .manage(fixture)
        .setup(move |app| {
            app.add_capability(r#"{"identifier":"array-editor-development","windows":["array-editor-development"],"permissions":["core:window:allow-close"]}"#)?;
            tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::External(url))
                .title("l8db · Array Editor Development")
                .inner_size(1000.0, 720.0)
                .data_directory(data_directory).incognito(true).build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) { window.app_handle().exit(0); }
        })
        .invoke_handler(tauri::generate_handler![array_editor_development_context, array_editor_development_read, update_row])
        .build(context)?.run_return(|_, _| {});
    directory.close()?;
    Ok(())
}

#[cfg(test)]
#[path = "array_editor_development_tests.rs"]
mod tests;
