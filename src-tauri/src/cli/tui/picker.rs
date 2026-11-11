use iocraft::prelude::*;

use super::grid::{fit, width};
use super::keys::{pasted, translate};
use super::model::Key;

#[derive(Clone, Default)]
pub struct Entry {
    pub name: String,
    pub kind: String,
    pub environment: String,
    pub production: bool,
    pub read_only: bool,
    pub mark: &'static str,
}

pub enum Picked {
    Index(usize),
    Dismissed,
    Interrupted,
}

pub fn matches(entries: &[Entry], filter: &str) -> Vec<usize> {
    let terms: Vec<String> = filter
        .split_whitespace()
        .map(|term| term.to_lowercase())
        .collect();
    entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| {
            let text =
                format!("{} {} {}", entry.name, entry.kind, entry.environment).to_lowercase();
            terms.iter().all(|term| text.contains(term))
        })
        .map(|(index, _)| index)
        .collect()
}

#[derive(Default, Props)]
pub struct ConnectionPickerProps {
    pub entries: Vec<Entry>,
    pub preselect: usize,
    pub has_focus: bool,
    pub rows: usize,
    pub on_pick: Handler<Picked>,
}

#[component]
pub fn ConnectionPicker(
    mut hooks: Hooks,
    props: &mut ConnectionPickerProps,
) -> impl Into<AnyElement<'static>> {
    let preselect = props.preselect;
    let mut filter = hooks.use_state(String::new);
    let mut cursor = hooks.use_state(move || preselect);
    let found = matches(&props.entries, &filter.read());
    let rows = props.rows.max(1);
    let position = cursor.get().min(found.len().saturating_sub(1));

    hooks.use_terminal_events({
        let has_focus = props.has_focus;
        let on_pick = props.on_pick.clone();
        let entries = props.entries.clone();
        move |event| {
            if !has_focus {
                return;
            }
            if let Some(text) = pasted(&event) {
                filter.write().push_str(&text);
                cursor.set(0);
                return;
            }
            let Some(key) = translate(&event) else {
                return;
            };
            let found = matches(&entries, &filter.read());
            let position = cursor.get().min(found.len().saturating_sub(1));
            match key {
                Key::Interrupt => on_pick(Picked::Interrupted),
                Key::Esc => on_pick(Picked::Dismissed),
                Key::Enter => {
                    if let Some(index) = found.get(position) {
                        on_pick(Picked::Index(*index));
                    }
                }
                Key::Char(c) => {
                    filter.write().push(c);
                    cursor.set(0);
                }
                Key::Backspace => {
                    filter.write().pop();
                    cursor.set(0);
                }
                Key::Up => cursor.set(position.saturating_sub(1)),
                Key::Down => cursor.set((position + 1).min(found.len().saturating_sub(1))),
                Key::PageUp => cursor.set(position.saturating_sub(rows)),
                Key::PageDown => cursor.set((position + rows).min(found.len().saturating_sub(1))),
                Key::Home => cursor.set(0),
                Key::End => cursor.set(found.len().saturating_sub(1)),
                _ => {}
            }
        }
    });

    let widest = |pick: fn(&Entry) -> &str| {
        props
            .entries
            .iter()
            .map(|entry| width(pick(entry)))
            .max()
            .unwrap_or(0)
            .min(32)
    };
    let (name_width, kind_width) = (widest(|entry| &entry.name), widest(|entry| &entry.kind));
    let first = (position + 1).saturating_sub(rows);
    let lines = found
        .iter()
        .enumerate()
        .skip(first)
        .take(rows)
        .map(|(row, index)| {
            let entry = &props.entries[*index];
            let active = row == position;
            let mut parts = vec![
                MixedTextContent::new(if active { "› " } else { "  " }).color(Color::Cyan),
                MixedTextContent::new(fit(&entry.name, name_width)).weight(if active {
                    Weight::Bold
                } else {
                    Weight::Normal
                }),
                MixedTextContent::new(format!("  {}", fit(&entry.kind, kind_width)))
                    .color(Color::DarkGrey),
            ];
            if entry.production {
                parts.push(
                    MixedTextContent::new("  PRODUKTION")
                        .color(Color::Red)
                        .weight(Weight::Bold),
                );
            } else if !entry.environment.is_empty() {
                parts.push(
                    MixedTextContent::new(format!("  {}", entry.environment))
                        .color(Color::DarkGrey),
                );
            }
            if entry.read_only {
                parts.push(MixedTextContent::new("  nur lesen").color(Color::Yellow));
            }
            if !entry.mark.is_empty() {
                parts.push(
                    MixedTextContent::new(format!("  {}", entry.mark)).color(Color::DarkGrey),
                );
            }
            element! {
                View(key: *index, height: 1) {
                    MixedText(contents: parts, wrap: TextWrap::NoWrap)
                }
            }
        });
    let empty = found.is_empty();

    element! {
        View(flex_direction: FlexDirection::Column) {
            View(height: 1) {
                MixedText(
                    contents: vec![
                        MixedTextContent::new("Verbindung › ").color(Color::Cyan),
                        MixedTextContent::new(filter.read().as_str()),
                        MixedTextContent::new("▏").color(Color::DarkGrey),
                    ],
                    wrap: TextWrap::NoWrap,
                )
            }
            #(lines)
            #(empty.then(|| element! {
                View(height: 1) {
                    Text(content: "  Keine Treffer", color: Color::DarkGrey)
                }
            }))
        }
    }
}
