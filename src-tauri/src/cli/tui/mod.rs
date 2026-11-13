mod app;
mod backend;
mod grid;
mod keys;
mod model;
mod picker;
mod prompt;
mod terminal;

use iocraft::prelude::*;
use std::io::IsTerminal;
use std::sync::{Arc, Mutex};

use super::connect::{Source, Target};
use super::run::{kind_name, named, runtime, ABORTED};
use super::{store, Global};
use crate::automation::model::AutomationConnection;
use app::App;
use backend::Backend;
use model::Model;
use picker::{Entry, Picked};
use prompt::Prompt;

fn entries(list: &[AutomationConnection]) -> (Vec<Entry>, usize) {
    let default = store::load_settings()
        .ok()
        .and_then(|settings| settings.default_connection);
    let open = store::active_connection();
    let position = |id: &Option<String>| list.iter().position(|c| Some(&c.id) == id.as_ref());
    let preselect = position(&default).or_else(|| position(&open)).unwrap_or(0);
    let entries = list
        .iter()
        .map(|connection| {
            let target = Target::saved(connection);
            Entry {
                name: grid::clean(&connection.name),
                kind: kind_name(connection.kind),
                environment: grid::clean(connection.environment.as_deref().unwrap_or_default()),
                production: target.production,
                read_only: target.read_only,
                mark: if Some(&connection.id) == default.as_ref() {
                    "Standard"
                } else if Some(&connection.id) == open.as_ref() {
                    "in der App geöffnet"
                } else {
                    ""
                },
            }
        })
        .collect();
    (entries, preselect)
}

pub(super) async fn pick(
    list: &[AutomationConnection],
    preselect: usize,
) -> Result<Option<usize>, String> {
    let guard = terminal::guard(false)?;
    let outcome = Arc::new(Mutex::new(None));
    let mut prompt = element! {
        Prompt(entries: entries(list).0, preselect, outcome: Some(outcome.clone()))
    };
    let rendered = prompt
        .render_loop()
        .output(Output::Stderr)
        .ignore_ctrl_c()
        .await;
    drop(guard);
    rendered.map_err(|error| format!("Auswahl: {error}"))?;
    let picked = outcome.lock().ok().and_then(|mut slot| slot.take());
    match picked {
        Some(Picked::Index(index)) => Ok(Some(index)),
        Some(Picked::Interrupted) => Err(ABORTED.into()),
        _ => Ok(None),
    }
}

pub(super) fn run(global: &Global) -> i32 {
    if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
        eprintln!(
            "Fehler: „l8db tui“ braucht ein Terminal für Ein- und Ausgabe.\n  In Pipes und Skripten: l8db query, l8db table rows …"
        );
        return 1;
    }
    let Some(runtime) = runtime() else {
        return 1;
    };
    let code = match runtime.block_on(interact(global)) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Fehler: {error}");
            1
        }
    };
    runtime.shutdown_background();
    code
}

async fn interact(global: &Global) -> Result<(), String> {
    let (list, source) = named(global, None).await?;
    let (entries, mut preselect) = entries(&list);
    let backend = Arc::new(Backend::new(global.database.clone(), list.clone()));
    let mut model = Model::new(!list.is_empty());
    if let Some(source) = source {
        if let Source::Saved(target) = &source {
            preselect = list
                .iter()
                .position(|c| c.id == target.id)
                .unwrap_or(preselect);
        }
        model.apply(backend.open(source).await?);
    }
    let guard = terminal::guard(true)?;
    let mut app = element! {
        App(
            backend: Some(backend),
            initial: Some(Arc::new(Mutex::new(Some(model)))),
            entries,
            preselect,
        )
    };
    let screen = app.fullscreen().disable_mouse_capture().ignore_ctrl_c();
    let rendered = if terminal::pastes() {
        screen.enable_bracketed_paste().await
    } else {
        screen.await
    };
    drop(guard);
    rendered.map_err(|error| format!("Terminal: {error}"))
}

#[cfg(test)]
mod tests;
