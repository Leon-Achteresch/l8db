pub mod check;
pub mod data;
pub mod export;
pub mod files;
pub mod flow;
pub mod http;
pub mod output;
pub mod shell;
pub mod sql;
pub mod xlsx;

use std::path::PathBuf;
use std::sync::Arc;

use crate::automation::connection::{self, Resolved};
use crate::automation::model::Action;
use crate::automation::runtime::{StepContext, StepOutcome};
use crate::db::{DatabaseAdapter, QueryResult};

pub(crate) fn wrong_action() -> String {
    "Interner Fehler: falscher Schritttyp.".into()
}

pub(crate) async fn open(
    ctx: &mut StepContext<'_>,
    reference: &str,
    database: Option<&str>,
) -> Result<(Arc<Resolved>, Box<dyn DatabaseAdapter>), String> {
    let reference = ctx.vars.render(reference)?;
    let database = match database {
        Some(db) => Some(ctx.vars.render(db)?),
        None => None,
    };
    let resolved = connection::resolve(
        ctx.services,
        ctx.connections,
        &reference,
        database.as_deref(),
    )
    .await?;
    ctx.vars.set_connection(&resolved);
    let adapter = connection::adapter(ctx.services, &resolved)?;
    Ok((resolved, adapter))
}

pub(crate) fn first_cell(result: &QueryResult) -> Option<serde_json::Value> {
    let row = result.rows.first()?;
    match row {
        serde_json::Value::Object(map) => result
            .columns
            .first()
            .and_then(|column| map.get(column))
            .or_else(|| map.values().next())
            .cloned(),
        serde_json::Value::Array(items) => items.first().cloned(),
        other => Some(other.clone()),
    }
}

pub(crate) fn cell(row: &serde_json::Value, column: &str, index: usize) -> serde_json::Value {
    match row {
        serde_json::Value::Object(map) => map.get(column).cloned(),
        serde_json::Value::Array(items) => items.get(index).cloned(),
        _ => None,
    }
    .unwrap_or(serde_json::Value::Null)
}

pub(crate) async fn resolve_path(ctx: &StepContext<'_>, raw: &str) -> Result<PathBuf, String> {
    let rendered = ctx.vars.render(raw)?;
    let rendered = rendered.trim();
    if rendered.is_empty() {
        return Err("Pfad fehlt.".into());
    }
    let expanded = match rendered.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with(['/', '\\']) => {
            let home = ctx.vars.get("home").unwrap_or_default();
            PathBuf::from(format!("{home}{rest}"))
        }
        _ => PathBuf::from(rendered),
    };
    if expanded.is_absolute() {
        return Ok(expanded);
    }
    let base = ctx
        .services
        .store
        .settings()
        .await?
        .default_output_dir
        .filter(|dir| !dir.trim().is_empty())
        .ok_or("Relativer Pfad ohne Standard-Ausgabeordner.")?;
    Ok(PathBuf::from(base).join(expanded))
}

pub async fn run(ctx: &mut StepContext<'_>) -> Result<StepOutcome, String> {
    let action = ctx.step.action.clone();
    match &action {
        Action::Sql { .. } => sql::sql(ctx, &action).await,
        Action::Export { .. } => export::export(ctx, &action).await,
        Action::Backup { .. } => data::backup(ctx, &action).await,
        Action::Restore { .. } => data::restore(ctx, &action).await,
        Action::Transfer { .. } => data::transfer(ctx, &action).await,
        Action::TableCopy { .. } => data::table_copy(ctx, &action).await,
        Action::Datagen { .. } => data::datagen(ctx, &action).await,
        Action::Import { .. } => data::import(ctx, &action).await,
        Action::Compare { .. } => data::compare(ctx, &action).await,
        Action::Check { .. } => check::check(ctx, &action).await,
        Action::Alert { .. } => check::alert(ctx, &action).await,
        Action::Shell { .. } => shell::shell(ctx, &action).await,
        Action::Http { .. } => http::http(ctx, &action).await,
        Action::FileCopy { .. } => files::file_copy(ctx, &action).await,
        Action::FileMove { .. } => files::file_move(ctx, &action).await,
        Action::FileDelete { .. } => files::file_delete(ctx, &action).await,
        Action::Mkdir { .. } => files::mkdir(ctx, &action).await,
        Action::FileExists { .. } => files::file_exists(ctx, &action).await,
        Action::Zip { .. } => files::zip(ctx, &action).await,
        Action::Unzip { .. } => files::unzip(ctx, &action).await,
        Action::Cleanup { .. } => files::cleanup(ctx, &action).await,
        Action::Notify { .. } => crate::automation::notify::notify(ctx, &action).await,
        Action::Wait { .. } => flow::wait(ctx, &action).await,
        Action::SetVariable { .. } => flow::set_variable(ctx, &action).await,
        Action::Condition { .. } => flow::condition(ctx, &action).await,
        Action::Loop { .. } => flow::run_loop(ctx, &action).await,
        Action::RunTask { .. } => flow::run_task(ctx, &action).await,
        Action::Log { .. } => flow::log(ctx, &action).await,
        Action::Fail { .. } => flow::fail(ctx, &action).await,
    }
}
