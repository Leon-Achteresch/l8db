use iocraft::prelude::*;
use std::sync::{Arc, Mutex};

use super::backend::Backend;
use super::grid::{clean, fit, Grid};
use super::keys::{pasted, translate};
use super::model::{Effect, Model, Request, Screen};
use super::picker::{ConnectionPicker, Entry, Picked};

const EDITOR: usize = 5;

#[derive(Default, Props)]
pub struct AppProps {
    pub backend: Option<Arc<Backend>>,
    pub initial: Option<Arc<Mutex<Option<Model>>>>,
    pub entries: Vec<Entry>,
    pub preselect: usize,
}

fn line(content: String, color: Option<Color>, bold: bool) -> AnyElement<'static> {
    let weight = if bold { Weight::Bold } else { Weight::Normal };
    element! {
        View(height: 1) {
            Text(content, color, weight, wrap: TextWrap::NoWrap)
        }
    }
    .into_any()
}

fn grid_lines(grid: &Grid, width: usize, page: usize) -> Vec<AnyElement<'static>> {
    let mut lines = vec![line(grid.header(width), Some(Color::Cyan), true)];
    lines.extend(
        grid.body(width, page)
            .into_iter()
            .map(|row| line(row, None, false)),
    );
    lines
}

fn hints(model: &Model) -> &'static str {
    if model.busy.is_some() {
        return "Strg+C abbrechen";
    }
    match model.screen {
        Screen::Connections => "Tippen filtert · ↑↓ wählen · Enter öffnen · Esc beenden",
        Screen::Objects if model.filtering => "Tippen filtert · Enter Zeilen · Esc Filter löschen",
        Screen::Objects => {
            "↑↓ wählen · Enter Zeilen · d Spalten · s SQL · / Filter · Esc zurück · q beenden"
        }
        Screen::Table if model.more => {
            "↑↓ ←→ Bild↑↓ blättern · m mehr laden · d Spalten · s SQL · Esc zurück · q beenden"
        }
        Screen::Table => "↑↓ ←→ Bild↑↓ blättern · d Spalten · s SQL · Esc zurück · q beenden",
        Screen::Sql if model.editing && model.result.is_some() => {
            "Strg+R ausführen · Tab Ergebnis · Esc zurück"
        }
        Screen::Sql if model.editing => "Strg+R ausführen · Esc zurück",
        Screen::Sql => "↑↓ ←→ Bild↑↓ blättern · Tab SQL bearbeiten · Strg+R ausführen · q beenden",
        Screen::Confirm => "Verbindungsnamen eintippen · Enter ausführen · Esc abbrechen",
    }
}

#[component]
pub fn App(mut hooks: Hooks, props: &mut AppProps) -> impl Into<AnyElement<'static>> {
    let (columns, lines) = match hooks.use_terminal_size() {
        (0, _) | (_, 0) => (80, 24),
        size => size,
    };
    let mut system = hooks.use_context_mut::<SystemContext>();
    let initial = props.initial.clone();
    let model = hooks.use_state(move || {
        initial
            .and_then(|slot| slot.lock().ok()?.take())
            .unwrap_or_else(|| Model::new(true))
    });
    let quit = hooks.use_state(|| false);
    let request = hooks.use_async_handler({
        let backend = props.backend.clone();
        move |request: Request| {
            let backend = backend.clone();
            let mut model = model;
            async move {
                if let Some(backend) = backend {
                    let response = backend.perform(request).await;
                    model.write().apply(response);
                }
            }
        }
    });
    let perform = {
        let backend = props.backend.clone();
        move |effect: Option<Effect>| match effect {
            Some(Effect::Request(wanted)) => request(wanted),
            Some(Effect::Cancel) => {
                if let Some(backend) = &backend {
                    backend.cancel();
                }
            }
            Some(Effect::Quit) => {
                let mut quit = quit;
                quit.set(true);
            }
            None => {}
        }
    };

    let width = (columns as usize).saturating_sub(2).max(10);
    let height = lines as usize;
    let state = model.read();
    let page = match state.screen {
        Screen::Sql => height.saturating_sub(5 + EDITOR),
        _ => height.saturating_sub(5),
    }
    .max(1);

    hooks.use_terminal_events({
        let perform = perform.clone();
        let mut model = model;
        move |event| {
            if let Some(text) = pasted(&event) {
                model.write().paste(&text);
            } else if let Some(key) = translate(&event) {
                let effect = model.write().key(key, page);
                perform(effect);
            }
        }
    });

    if quit.get() {
        system.exit();
    }

    let idle = state.busy.is_none();
    let mut header = vec![MixedTextContent::new("l8db").weight(Weight::Bold)];
    if state.screen != Screen::Connections {
        header
            .push(MixedTextContent::new(format!(" › {}", state.banner.name)).weight(Weight::Bold));
        header
            .push(MixedTextContent::new(format!("  {}", state.banner.kind)).color(Color::DarkGrey));
        if state.banner.production {
            header.push(
                MixedTextContent::new("  PRODUKTION")
                    .color(Color::Red)
                    .weight(Weight::Bold),
            );
        }
        if state.banner.read_only {
            header.push(MixedTextContent::new("  nur lesen").color(Color::Yellow));
        }
    }

    let mut body: Vec<AnyElement<'static>> = Vec::new();
    let mut position = String::new();
    match state.screen {
        Screen::Connections => {
            let perform = perform.clone();
            body.push(
                element! {
                    ConnectionPicker(
                        entries: props.entries.clone(),
                        preselect: props.preselect,
                        has_focus: idle,
                        rows: page,
                        on_pick: move |picked: Picked| match picked {
                            Picked::Index(index) => {
                                let mut model = model;
                                let effect = model.write().open(index);
                                perform(effect);
                            }
                            _ => perform(Some(Effect::Quit)),
                        },
                    )
                }
                .into_any(),
            );
        }
        Screen::Objects => {
            let visible = state.visible();
            let title = if state.filtering || !state.filter.is_empty() {
                format!(
                    "/ {}{}",
                    state.filter,
                    if state.filtering { "▏" } else { "" }
                )
            } else {
                "Tabellen".to_string()
            };
            body.push(line(title, Some(Color::Cyan), true));
            let first = (state.cursor + 1).saturating_sub(page);
            for (row, index) in visible.iter().enumerate().skip(first).take(page) {
                let active = row == state.cursor;
                let mut parts = vec![
                    MixedTextContent::new(if active { "› " } else { "  " }).color(Color::Cyan),
                    MixedTextContent::new(state.labels[*index].as_str()).weight(if active {
                        Weight::Bold
                    } else {
                        Weight::Normal
                    }),
                ];
                if state.objects[*index].view {
                    parts.push(MixedTextContent::new("  View").color(Color::DarkGrey));
                }
                body.push(
                    element! {
                        View(height: 1) {
                            MixedText(contents: parts, wrap: TextWrap::NoWrap)
                        }
                    }
                    .into_any(),
                );
            }
            position = match (visible.len(), state.objects.len()) {
                (0, 0) => "Keine Tabellen".to_string(),
                (shown, all) if shown == all => format!("{all} Tabellen"),
                (shown, all) => format!("{shown} von {all} Tabellen"),
            };
        }
        Screen::Table => {
            body.push(line(state.title.clone(), None, true));
            body.extend(grid_lines(&state.table, width, page));
            position = state.table.position(page);
            if state.more {
                position.push_str(" · mehr mit m");
            }
        }
        Screen::Sql => {
            let mut model = model;
            body.push(
                element! {
                    View(height: EDITOR as u32, background_color: Color::AnsiValue(236)) {
                        TextInput(
                            has_focus: idle && state.editing,
                            value: state.sql.clone(),
                            multiline: true,
                            on_change: move |value| model.write().sql = value,
                        )
                    }
                }
                .into_any(),
            );
            if let Some(result) = &state.result {
                body.extend(grid_lines(result, width, page));
                position = result.position(page);
            }
        }
        Screen::Confirm => {
            body.push(line(
                format!(
                    "⚠ „{}“ ist Produktion und das SQL schreibt.",
                    state.banner.name
                ),
                Some(Color::Red),
                true,
            ));
            let shown = page.saturating_sub(3).max(1);
            let statement: Vec<String> = state.sql.trim().lines().map(clean).collect();
            for text in statement.iter().take(shown) {
                body.push(line(fit(text, width), Some(Color::DarkGrey), false));
            }
            if statement.len() > shown {
                body.push(line(
                    format!(
                        "… {} weitere Zeilen, mit Esc zurück zum SQL",
                        statement.len() - shown
                    ),
                    Some(Color::Yellow),
                    false,
                ));
            }
            body.push(line(
                format!("Verbindungsname › {}▏", state.answer),
                None,
                false,
            ));
        }
    }

    let (status, color) = match state.busy {
        Some(label) if state.status.is_empty() => (label.to_string(), Some(Color::Cyan)),
        Some(_) => (state.status.clone(), Some(Color::Cyan)),
        None if state.failed => (state.status.clone(), Some(Color::Red)),
        None => (
            [position, state.status.clone()]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" · "),
            None,
        ),
    };
    let footer = hints(&state).to_string();

    element! {
        View(
            width: columns,
            height: lines,
            flex_direction: FlexDirection::Column,
            padding_left: 1,
            padding_right: 1,
        ) {
            View(height: 1) {
                MixedText(contents: header, wrap: TextWrap::NoWrap)
            }
            View(flex_direction: FlexDirection::Column, flex_grow: 1.0_f32, overflow: Overflow::Hidden) {
                #(body)
            }
            View(max_height: 4, flex_shrink: 0.0_f32, overflow: Overflow::Hidden) {
                Text(content: status, color, wrap: TextWrap::Wrap)
            }
            #(std::iter::once(line(footer, Some(Color::DarkGrey), false)))
        }
    }
}
