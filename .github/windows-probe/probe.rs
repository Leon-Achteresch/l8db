#![windows_subsystem = "windows"]
use std::io::Write;

extern "system" {
    fn AttachConsole(id: u32) -> i32;
    fn GetStdHandle(n: u32) -> isize;
    fn GetFileType(h: isize) -> u32;
    fn GetLastError() -> u32;
}

fn snap() -> String {
    let mut text = String::new();
    for (name, n) in [("in", -10i32 as u32), ("out", -11i32 as u32), ("err", -12i32 as u32)] {
        let handle = unsafe { GetStdHandle(n) };
        let kind = unsafe { GetFileType(handle) };
        text += &format!("{name}={handle:#x}/type{kind} ");
    }
    text
}

fn main() {
    let log = std::env::var("PROBE_LOG").unwrap();
    let mode = std::env::args().nth(1).unwrap_or_default();
    let before = snap();
    let (attached, error) = if mode.contains("noattach") {
        (-1, 0)
    } else {
        unsafe {
            let result = AttachConsole(u32::MAX);
            (result, GetLastError())
        }
    };
    let after = snap();
    let wrote = writeln!(std::io::stdout(), "PROBE-STDOUT {mode}").and_then(|_| std::io::stdout().flush());
    let line = format!("{mode}: before[{before}] attach={attached} err={error} after[{after}] write={wrote:?}\n");
    std::fs::OpenOptions::new().create(true).append(true).open(log).unwrap().write_all(line.as_bytes()).unwrap();
}
