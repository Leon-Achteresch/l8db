use std::panic::PanicHookInfo;
use std::sync::{Arc, Mutex};

static WORKER_PANIC: Mutex<Option<String>> = Mutex::new(None);

pub fn worker_panic() -> Option<String> {
    WORKER_PANIC.lock().ok()?.take()
}

type Hook = Arc<dyn Fn(&PanicHookInfo<'_>) + Send + Sync>;

pub struct Guard {
    previous: Hook,
}

pub fn guard(fullscreen: bool) -> Result<Guard, String> {
    crossterm::terminal::enable_raw_mode()
        .and_then(|()| crossterm::terminal::disable_raw_mode())
        .map_err(|error| {
            format!(
                "Das Terminal lässt sich nicht in den interaktiven Modus schalten: {error}\n  Unter Windows über den Starter l8db.cmd in cmd, PowerShell oder Windows Terminal aufrufen."
            )
        })?;
    let previous: Hook = Arc::from(std::panic::take_hook());
    let (earlier, owner) = (previous.clone(), std::thread::current().id());
    std::panic::set_hook(Box::new(move |info| {
        if std::thread::current().id() == owner {
            let _ = crossterm::terminal::disable_raw_mode();
            let mut out = std::io::stderr();
            if fullscreen {
                let _ = crossterm::execute!(out, crossterm::terminal::LeaveAlternateScreen);
            }
            let _ = crossterm::execute!(out, crossterm::cursor::Show);
            earlier(info);
        } else if let Ok(mut slot) = WORKER_PANIC.lock() {
            *slot = Some(info.to_string());
        }
    }));
    Ok(Guard { previous })
}

pub fn pastes() -> bool {
    #[cfg(windows)]
    return crossterm::ansi_support::supports_ansi();
    #[cfg(not(windows))]
    true
}

impl Drop for Guard {
    fn drop(&mut self) {
        if std::thread::panicking() {
            return;
        }
        let previous = self.previous.clone();
        std::panic::set_hook(Box::new(move |info| previous(info)));
    }
}
