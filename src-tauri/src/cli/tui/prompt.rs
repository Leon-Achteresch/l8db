use iocraft::prelude::*;
use std::sync::{Arc, Mutex};

use super::picker::{ConnectionPicker, Entry, Picked};

#[derive(Default, Props)]
pub struct PromptProps {
    pub entries: Vec<Entry>,
    pub preselect: usize,
    pub outcome: Option<Arc<Mutex<Option<Picked>>>>,
}

#[component]
pub fn Prompt(mut hooks: Hooks, props: &mut PromptProps) -> impl Into<AnyElement<'static>> {
    let mut system = hooks.use_context_mut::<SystemContext>();
    let done = hooks.use_state(|| None::<String>);
    if let Some(line) = done.read().clone() {
        system.exit();
        return element! {
            View(height: 1) {
                Text(content: line, wrap: TextWrap::NoWrap)
            }
        }
        .into_any();
    }
    let outcome = props.outcome.clone();
    let names: Vec<String> = props
        .entries
        .iter()
        .map(|entry| entry.name.clone())
        .collect();
    element! {
        ConnectionPicker(
            entries: props.entries.clone(),
            preselect: props.preselect,
            has_focus: true,
            rows: 10usize,
            on_pick: move |picked: Picked| {
                let line = match &picked {
                    Picked::Index(index) => format!(
                        "Verbindung: {}",
                        names.get(*index).map(String::as_str).unwrap_or_default()
                    ),
                    _ => "Verbindung: –".to_string(),
                };
                let Some(mut slot) = outcome.as_ref().and_then(|slot| slot.lock().ok()) else {
                    return;
                };
                if slot.is_none() {
                    *slot = Some(picked);
                    let mut done = done;
                    done.set(Some(line));
                }
            },
        )
    }
    .into_any()
}
