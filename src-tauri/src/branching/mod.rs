mod audit;
mod crypto;
mod jobs;
mod mask;
mod ops;
mod pg;
mod pipeline;
mod vault;

use std::collections::HashMap;
use std::sync::Arc;

use crate::db::pool::PoolState;

fn emitter(app: tauri::AppHandle) -> jobs::Emit {
    use tauri::Emitter;
    Arc::new(move |status: &jobs::JobStatus| {
        let _ = app.emit("branching-job", status);
    })
}

fn context(
    app: &tauri::AppHandle,
    connection_string: String,
    tool_paths: Option<HashMap<String, String>>,
    pool: &tauri::State<'_, PoolState>,
) -> Result<ops::Context, String> {
    Ok(ops::Context {
        connection_string,
        root: vault::default_root(Some(app))?,
        tool_paths: tool_paths.unwrap_or_default(),
        pool: pool.inner().clone(),
    })
}

#[tauri::command]
pub async fn branching_overview(
    connection_string: String,
    database: String,
    tool_paths: Option<HashMap<String, String>>,
    app: tauri::AppHandle,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<ops::Overview, String> {
    ops::overview(
        &context(&app, connection_string, tool_paths, &pool_state)?,
        &database,
    )
    .await
}

#[tauri::command]
pub async fn branching_columns(
    connection_string: String,
    database: String,
) -> Result<Vec<mask::Column>, String> {
    ops::columns(&connection_string, &database).await
}

#[tauri::command]
pub async fn branching_schema(
    connection_string: String,
    source: ops::SchemaSource,
    tool_paths: Option<HashMap<String, String>>,
    app: tauri::AppHandle,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<String, String> {
    ops::schema(
        &context(&app, connection_string, tool_paths, &pool_state)?,
        source,
    )
    .await
}

#[tauri::command]
pub async fn branching_snapshot(
    connection_string: String,
    request: ops::SnapshotRequest,
    tool_paths: Option<HashMap<String, String>>,
    app: tauri::AppHandle,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<String, String> {
    let ctx = context(&app, connection_string, tool_paths, &pool_state)?;
    ops::start_snapshot(ctx, request, emitter(app)).await
}

#[tauri::command]
pub async fn branching_run(
    connection_string: String,
    request: ops::Run,
    tool_paths: Option<HashMap<String, String>>,
    app: tauri::AppHandle,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<String, String> {
    let ctx = context(&app, connection_string, tool_paths, &pool_state)?;
    ops::start_run(ctx, request, emitter(app)).await
}

#[tauri::command]
pub async fn branching_update(
    connection_string: String,
    request: ops::Update,
    app: tauri::AppHandle,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<(), String> {
    ops::update(
        &context(&app, connection_string, None, &pool_state)?,
        request,
    )
    .await
}

#[tauri::command]
pub async fn branching_verify(id: String, app: tauri::AppHandle) -> Result<String, String> {
    ops::start_verify(vault::default_root(Some(&app))?, id, emitter(app)).await
}

#[tauri::command]
pub async fn branching_local(request: ops::Local, app: tauri::AppHandle) -> Result<(), String> {
    ops::local(&vault::default_root(Some(&app))?, request).await
}

#[tauri::command]
pub async fn branching_schedules(app: tauri::AppHandle) -> Result<Vec<ops::ScheduleEntry>, String> {
    ops::schedules(&vault::default_root(Some(&app))?).await
}

#[tauri::command]
pub fn branching_jobs() -> Vec<jobs::JobStatus> {
    jobs::list()
}

#[tauri::command]
pub async fn branching_audit(
    limit: Option<usize>,
    app: tauri::AppHandle,
) -> Result<audit::Journal, String> {
    let vault = vault::Vault::open(&vault::default_root(Some(&app))?).await?;
    audit::journal(&vault, limit.unwrap_or(500).min(5000)).await
}

#[tauri::command]
pub async fn branching_audit_export(app: tauri::AppHandle) -> Result<String, String> {
    let vault = vault::Vault::open(&vault::default_root(Some(&app))?).await?;
    audit::export(&vault)
}

#[tauri::command]
pub async fn branching_vault(app: tauri::AppHandle) -> Result<vault::VaultStatus, String> {
    Ok(vault::status(&vault::default_root(Some(&app))?).await)
}

#[tauri::command]
pub async fn branching_recovery_key(app: tauri::AppHandle) -> Result<String, String> {
    let vault = vault::Vault::open(&vault::default_root(Some(&app))?).await?;
    audit::append(
        &vault,
        audit::Actor::local(None),
        "vault.recovery_export",
        "ok",
        &format!("vault/{}", vault.info.id),
        None,
        serde_json::Value::Null,
    )
    .await?;
    Ok(vault.recovery_key())
}

#[tauri::command]
pub async fn branching_recovery_import(
    key: String,
    app: tauri::AppHandle,
) -> Result<vault::VaultStatus, String> {
    let root = vault::default_root(Some(&app))?;
    let status = vault::import_recovery(&root, &key).await?;
    let vault = vault::Vault::open(&root).await?;
    audit::recovered(&vault, audit::Actor::local(None))
        .await
        .map_err(|error| format!("Schlüssel importiert, aber nicht protokolliert: {error}"))?;
    Ok(status)
}
