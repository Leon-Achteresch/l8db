use iocraft::prelude::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers, TerminalEvent};

use super::model::Key;

pub fn pasted(event: &TerminalEvent) -> Option<String> {
    match event {
        TerminalEvent::BracketedPaste(text) => Some(
            text.lines()
                .next()
                .unwrap_or_default()
                .chars()
                .filter(|c| !c.is_control())
                .collect(),
        ),
        _ => None,
    }
}

pub fn translate(event: &TerminalEvent) -> Option<Key> {
    let TerminalEvent::Key(KeyEvent {
        code,
        modifiers,
        kind,
        ..
    }) = event
    else {
        return None;
    };
    if *kind == KeyEventKind::Release {
        return None;
    }
    let control = modifiers.contains(KeyModifiers::CONTROL);
    let alt = modifiers.contains(KeyModifiers::ALT);
    Some(match *code {
        KeyCode::Char('c' | 'C') if control && !alt => Key::Interrupt,
        KeyCode::Char('r' | 'R') if control && !alt => Key::Run,
        KeyCode::F(5 | 9) => Key::Run,
        KeyCode::Char('j' | 'J') if control && !alt => Key::Enter,
        KeyCode::Char(c)
            if !c.is_control()
                && (!(control || alt) || (control && alt && !c.is_ascii_alphanumeric())) =>
        {
            Key::Char(c)
        }
        KeyCode::Enter => Key::Enter,
        KeyCode::Esc => Key::Esc,
        KeyCode::Tab => Key::Tab,
        KeyCode::Backspace => Key::Backspace,
        KeyCode::Up => Key::Up,
        KeyCode::Down => Key::Down,
        KeyCode::Left => Key::Left,
        KeyCode::Right => Key::Right,
        KeyCode::PageUp => Key::PageUp,
        KeyCode::PageDown => Key::PageDown,
        KeyCode::Home => Key::Home,
        KeyCode::End => Key::End,
        _ => return None,
    })
}
