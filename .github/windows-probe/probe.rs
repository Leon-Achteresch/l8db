#![windows_subsystem = "windows"]
use std::io::{Read, Write};

extern "system" {
    fn AttachConsole(id: u32) -> i32;
    fn GetStdHandle(n: u32) -> isize;
    fn SetStdHandle(n: u32, handle: isize) -> i32;
    fn GetFileType(handle: isize) -> u32;
    fn GetConsoleMode(handle: isize, mode: *mut u32) -> i32;
}

const SLOTS: [u32; 3] = [-10i32 as u32, -11i32 as u32, -12i32 as u32];

fn snap() -> String {
    SLOTS
        .iter()
        .map(|slot| unsafe {
            let handle = GetStdHandle(*slot);
            format!("{handle:#x}/t{}", GetFileType(handle))
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn main() {
    let log = std::env::var("PROBE_LOG").unwrap();
    let mode = std::env::args().nth(1).unwrap_or_default();
    let strategy = mode.split('-').next().unwrap_or_default().to_string();
    let before = snap();
    let given: Vec<(isize, u32)> = SLOTS
        .iter()
        .map(|slot| unsafe {
            let handle = GetStdHandle(*slot);
            (handle, GetFileType(handle))
        })
        .collect();
    let attached = if strategy == "none" { -1 } else { unsafe { AttachConsole(u32::MAX) } };
    let mut restored = String::new();
    for (slot, (handle, kind)) in SLOTS.iter().zip(&given) {
        let mut console_mode = 0u32;
        let is_console = unsafe { GetConsoleMode(*handle, &mut console_mode) } != 0;
        let keep = match strategy.as_str() {
            "pipefile" => matches!(kind, 1 | 3),
            "smart" => matches!(kind, 1 | 3) || (*kind == 2 && !is_console),
            "all" => *kind != 0,
            _ => false,
        };
        restored += &format!("{}{} ", if keep { "keep" } else { "new" }, if is_console { "(console)" } else { "" });
        if keep {
            unsafe { SetStdHandle(*slot, *handle) };
        }
    }
    let after = snap();
    let mut input = String::new();
    if mode.contains("stdin") {
        let _ = std::io::stdin().read_to_string(&mut input);
    }
    let out = writeln!(std::io::stdout(), "OUT {mode} {input}").and_then(|_| std::io::stdout().flush());
    let err = writeln!(std::io::stderr(), "ERR {mode}");
    let line = format!("{mode}: before[{before}] attach={attached} [{restored}] after[{after}] out={out:?} err={err:?}\n");
    std::fs::OpenOptions::new().create(true).append(true).open(log).unwrap().write_all(line.as_bytes()).unwrap();
}
