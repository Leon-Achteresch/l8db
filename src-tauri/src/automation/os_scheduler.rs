use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use crate::automation::model::{BackgroundStatus, Task};
use crate::automation::store::Store;

const LABEL: &str = "com.leon.l8db.automation";
const UNIT: &str = "l8db-automation";
const CRON_MARK: &str = "# l8db-automation";
const TASK_NAME: &str = "l8db\\Automatisierung";
const TICK: &str = "--automation-tick";
const DEBUG_ONLY: &str = "Nur in installierten Versionen verfügbar.";
const PATH_CHANGED: &str = "Pfad hat sich geändert – bitte neu einrichten.";
const CRON_HINT: &str = "Unter cron ist der Schlüsselbund ggf. nicht erreichbar.";

pub fn posix_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn windows_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn systemd_quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('%', "%%")
            .replace('$', "$$")
    )
}

fn cron_exe(exe: &str) -> String {
    posix_quote(exe).replace('%', "\\%")
}

pub fn launchd_plist(exe: &str, log: &str) -> String {
    let (exe, log) = (xml_escape(exe), xml_escape(log));
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{exe}</string>
    <string>{TICK}</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{log}</string>
</dict>
</plist>
"#
    )
}

pub fn systemd_units(exe: &str) -> (String, String) {
    (
        format!(
            "[Unit]\nDescription=l8db Automatisierung\n\n[Service]\nType=oneshot\nExecStart={} {TICK}\n",
            systemd_quote(exe)
        ),
        "[Unit]\nDescription=l8db Automatisierung (minütlich)\n\n[Timer]\nOnCalendar=*-*-* *:*:00\nAccuracySec=10s\nPersistent=false\n\n[Install]\nWantedBy=timers.target\n"
            .to_string(),
    )
}

pub fn cron_line(exe: &str) -> String {
    format!("* * * * * {} {TICK} {CRON_MARK}", cron_exe(exe))
}

pub fn crontab_with(current: &str, line: Option<&str>) -> String {
    let mut lines: Vec<&str> = current
        .lines()
        .filter(|existing| !existing.trim_end().ends_with(CRON_MARK))
        .collect();
    lines.extend(line);
    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

pub fn schtasks_create_args(exe: &str) -> Vec<String> {
    [
        "/Create",
        "/F",
        "/TN",
        TASK_NAME,
        "/SC",
        "MINUTE",
        "/MO",
        "1",
        "/TR",
        &format!("{} {TICK}", windows_quote(exe)),
        "/IT",
    ]
    .iter()
    .map(|arg| arg.to_string())
    .collect()
}

fn command_line_for(exe: &str, task_id: &str, windows: bool) -> String {
    if windows {
        format!(
            "{} --run-task {}",
            windows_quote(exe),
            windows_quote(task_id)
        )
    } else {
        format!("{} --run-task {}", posix_quote(exe), posix_quote(task_id))
    }
}

pub fn command_line(task: &Task) -> String {
    command_line_for(&current_exe(), &task.id, cfg!(windows))
}

fn current_exe() -> String {
    std::env::current_exe()
        .map(|path| path.display().to_string())
        .unwrap_or_default()
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn plist_path() -> PathBuf {
    home()
        .join("Library/LaunchAgents")
        .join(format!("{LABEL}.plist"))
}

fn systemd_dir() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".config"))
        .join("systemd/user")
}

fn run<const N: usize>(program: &str, args: [&str; N]) -> Result<String, String> {
    run_args(program, &args.map(str::to_string))
}

fn run_args(program: &str, args: &[String]) -> Result<String, String> {
    let output = crate::process::std_command(program)
        .args(args)
        .output()
        .map_err(|error| format!("{program} konnte nicht gestartet werden: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let message = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        Err(format!("{program} meldete: {}", message.trim()))
    }
}

fn write_file(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(path, content).map_err(|e| format!("{}: {e}", path.display()))
}

fn remove_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("{}: {error}", path.display()))
        }
        _ => Ok(()),
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Mechanism {
    Launchd,
    Systemd,
    Cron,
    Schtasks,
}

fn systemd_usable() -> bool {
    run("systemctl", ["--user", "show-environment"]).is_ok()
}

fn crontab() -> String {
    run("crontab", ["-l"]).unwrap_or_default()
}

fn write_crontab(content: &str) -> Result<(), String> {
    let mut child = crate::process::std_command("crontab")
        .arg("-")
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("crontab konnte nicht gestartet werden: {error}"))?;
    child
        .stdin
        .take()
        .ok_or("crontab: keine Eingabe möglich.")?
        .write_all(content.as_bytes())
        .map_err(|error| format!("crontab: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("crontab: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "crontab meldete: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn uid() -> Result<String, String> {
    Ok(run("id", ["-u"])?.trim().to_string())
}

impl Mechanism {
    fn detect() -> Mechanism {
        if cfg!(target_os = "macos") {
            Mechanism::Launchd
        } else if cfg!(windows) {
            Mechanism::Schtasks
        } else if systemd_dir().join(format!("{UNIT}.timer")).exists() {
            Mechanism::Systemd
        } else if crontab().contains(CRON_MARK) {
            Mechanism::Cron
        } else if systemd_usable() {
            Mechanism::Systemd
        } else {
            Mechanism::Cron
        }
    }

    fn name(self) -> &'static str {
        match self {
            Mechanism::Launchd => "launchd",
            Mechanism::Systemd => "systemd",
            Mechanism::Cron => "cron",
            Mechanism::Schtasks => "schtasks",
        }
    }

    fn location(self) -> String {
        match self {
            Mechanism::Launchd => plist_path().display().to_string(),
            Mechanism::Systemd => systemd_dir()
                .join(format!("{UNIT}.timer"))
                .display()
                .to_string(),
            Mechanism::Cron => "crontab".into(),
            Mechanism::Schtasks => TASK_NAME.into(),
        }
    }

    fn definition(self) -> Option<String> {
        match self {
            Mechanism::Launchd => std::fs::read_to_string(plist_path()).ok(),
            Mechanism::Systemd => {
                std::fs::read_to_string(systemd_dir().join(format!("{UNIT}.service"))).ok()
            }
            Mechanism::Cron => crontab()
                .lines()
                .find(|line| line.trim_end().ends_with(CRON_MARK))
                .map(str::to_string),
            Mechanism::Schtasks => run("schtasks", ["/Query", "/TN", TASK_NAME, "/XML"]).ok(),
        }
    }

    fn mentions(self, definition: &str, exe: &str) -> bool {
        definition.contains(&match self {
            Mechanism::Launchd => format!("<string>{}</string>", xml_escape(exe)),
            Mechanism::Systemd => format!("ExecStart={} ", systemd_quote(exe)),
            Mechanism::Cron => format!(" {} ", cron_exe(exe)),
            Mechanism::Schtasks => xml_escape(exe),
        })
    }

    fn active(self) -> bool {
        match self {
            Mechanism::Launchd => uid()
                .and_then(|uid| run("launchctl", ["print", &format!("gui/{uid}/{LABEL}")]))
                .is_ok(),
            Mechanism::Systemd => run(
                "systemctl",
                ["--user", "is-enabled", &format!("{UNIT}.timer")],
            )
            .is_ok(),
            Mechanism::Cron | Mechanism::Schtasks => true,
        }
    }

    fn install(self, exe: &str) -> Result<(), String> {
        match self {
            Mechanism::Launchd => {
                let log = crate::mcp::config::config_dir().join("automation-tick.log");
                let plist = plist_path();
                write_file(&plist, &launchd_plist(exe, &log.display().to_string()))?;
                let domain = format!("gui/{}", uid()?);
                let _ = run("launchctl", ["bootout", &format!("{domain}/{LABEL}")]);
                run(
                    "launchctl",
                    ["bootstrap", &domain, &plist.display().to_string()],
                )?;
            }
            Mechanism::Systemd => {
                let (service, timer) = systemd_units(exe);
                write_file(&systemd_dir().join(format!("{UNIT}.service")), &service)?;
                write_file(&systemd_dir().join(format!("{UNIT}.timer")), &timer)?;
                run("systemctl", ["--user", "daemon-reload"])?;
                run(
                    "systemctl",
                    ["--user", "enable", "--now", &format!("{UNIT}.timer")],
                )?;
            }
            Mechanism::Cron => write_crontab(&crontab_with(&crontab(), Some(&cron_line(exe))))?,
            Mechanism::Schtasks => {
                run_args("schtasks", &schtasks_create_args(exe))?;
            }
        }
        Ok(())
    }

    fn uninstall(self) -> Result<(), String> {
        match self {
            Mechanism::Launchd => {
                let _ = uid()
                    .and_then(|uid| run("launchctl", ["bootout", &format!("gui/{uid}/{LABEL}")]));
                remove_file(&plist_path())?;
            }
            Mechanism::Systemd => {
                let _ = run(
                    "systemctl",
                    ["--user", "disable", "--now", &format!("{UNIT}.timer")],
                );
                remove_file(&systemd_dir().join(format!("{UNIT}.timer")))?;
                remove_file(&systemd_dir().join(format!("{UNIT}.service")))?;
                let _ = run("systemctl", ["--user", "daemon-reload"]);
            }
            Mechanism::Cron => {
                let current = crontab();
                if current.contains(CRON_MARK) {
                    write_crontab(&crontab_with(&current, None))?;
                }
            }
            Mechanism::Schtasks => {
                if self.definition().is_some() {
                    run("schtasks", ["/Delete", "/F", "/TN", TASK_NAME])?;
                }
            }
        }
        Ok(())
    }
}

fn last_tick(path: &Path) -> Option<String> {
    let conn =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    let json: String = conn
        .query_row(
            "SELECT json FROM settings WHERE key = ?1",
            [crate::automation::scheduler::LAST_TICK],
            |row| row.get(0),
        )
        .ok()?;
    serde_json::from_str::<serde_json::Value>(&json)
        .ok()?
        .get("at")?
        .as_str()
        .map(str::to_string)
}

fn default_db() -> PathBuf {
    std::env::var_os("L8DB_AUTOMATION_DB")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| crate::mcp::config::config_dir().join("automation.db"))
}

fn current_status(db: &Path) -> BackgroundStatus {
    let mechanism = Mechanism::detect();
    let exe = current_exe();
    let definition = mechanism.definition();
    let installed = definition.is_some() && mechanism.active();
    let detail = if cfg!(debug_assertions) {
        Some(DEBUG_ONLY.to_string())
    } else if definition.is_some_and(|definition| !mechanism.mentions(&definition, &exe)) {
        Some(PATH_CHANGED.to_string())
    } else if mechanism == Mechanism::Cron {
        Some(CRON_HINT.to_string())
    } else {
        None
    };
    BackgroundStatus {
        supported: !cfg!(debug_assertions),
        installed,
        mechanism: mechanism.name().into(),
        location: Some(mechanism.location()),
        binary: exe,
        last_tick_at: last_tick(db),
        detail,
    }
}

pub fn status(store: &Store) -> BackgroundStatus {
    current_status(store.path())
}

pub fn install() -> Result<BackgroundStatus, String> {
    if cfg!(debug_assertions) {
        return Err(DEBUG_ONLY.into());
    }
    let exe = current_exe();
    if exe.is_empty() {
        return Err("Pfad der l8db-Programmdatei ist unbekannt.".into());
    }
    Mechanism::detect().install(&exe)?;
    Ok(current_status(&default_db()))
}

pub fn uninstall() -> Result<BackgroundStatus, String> {
    Mechanism::detect().uninstall()?;
    Ok(current_status(&default_db()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "/Applications/Mein l8db's.app/Contents/MacOS/l8db";

    #[test]
    fn plist_snapshot() {
        assert_eq!(
            launchd_plist(
                EXE,
                "/Users/a b/Library/Application Support/com.leon.l8db/automation-tick.log"
            ),
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.leon.l8db.automation</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/Mein l8db&apos;s.app/Contents/MacOS/l8db</string>
    <string>--automation-tick</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/a b/Library/Application Support/com.leon.l8db/automation-tick.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/a b/Library/Application Support/com.leon.l8db/automation-tick.log</string>
</dict>
</plist>
"#
        );
        assert!(launchd_plist("/x/a&b<c>", "/l").contains("<string>/x/a&amp;b&lt;c&gt;</string>"));
    }

    #[test]
    fn systemd_snapshot() {
        let (service, timer) = systemd_units("/opt/My Apps/l8db's \"x\" 100%/l8db");
        assert_eq!(
            service,
            "[Unit]\nDescription=l8db Automatisierung\n\n[Service]\nType=oneshot\nExecStart=\"/opt/My Apps/l8db's \\\"x\\\" 100%%/l8db\" --automation-tick\n"
        );
        assert_eq!(
            timer,
            "[Unit]\nDescription=l8db Automatisierung (minütlich)\n\n[Timer]\nOnCalendar=*-*-* *:*:00\nAccuracySec=10s\nPersistent=false\n\n[Install]\nWantedBy=timers.target\n"
        );
    }

    #[test]
    fn cron_snapshot() {
        assert_eq!(
            cron_line("/opt/My Apps/l8db's/l8db"),
            "* * * * * '/opt/My Apps/l8db'\\''s/l8db' --automation-tick # l8db-automation"
        );
        assert_eq!(
            cron_line("/opt/100%/l8db"),
            "* * * * * '/opt/100\\%/l8db' --automation-tick # l8db-automation"
        );
    }

    #[test]
    fn crontab_replaces_only_marked_line() {
        let current = "MAILTO=a@b\n0 * * * * /bin/backup\n* * * * * '/alt/l8db' --automation-tick # l8db-automation\n";
        let line = cron_line("/neu/l8db");
        assert_eq!(
            crontab_with(current, Some(&line)),
            "MAILTO=a@b\n0 * * * * /bin/backup\n* * * * * '/neu/l8db' --automation-tick # l8db-automation\n"
        );
        assert_eq!(
            crontab_with(current, None),
            "MAILTO=a@b\n0 * * * * /bin/backup\n"
        );
        assert_eq!(crontab_with("", Some("x")), "x\n");
        assert_eq!(crontab_with(&format!("{line}\n"), None), "");
    }

    #[test]
    fn schtasks_snapshot() {
        assert_eq!(
            schtasks_create_args(r"C:\Program Files\l8db\l8db.exe"),
            [
                "/Create",
                "/F",
                "/TN",
                r"l8db\Automatisierung",
                "/SC",
                "MINUTE",
                "/MO",
                "1",
                "/TR",
                r#""C:\Program Files\l8db\l8db.exe" --automation-tick"#,
                "/IT"
            ]
        );
    }

    #[test]
    fn command_line_quoting() {
        assert_eq!(
            command_line_for(EXE, "1234-abcd", false),
            r#"'/Applications/Mein l8db'\''s.app/Contents/MacOS/l8db' --run-task '1234-abcd'"#
        );
        assert_eq!(
            command_line_for(r"C:\Program Files\l8db\l8db.exe", "1234-abcd", true),
            r#""C:\Program Files\l8db\l8db.exe" --run-task "1234-abcd""#
        );
        assert_eq!(posix_quote("it's"), r#"'it'\''s'"#);
    }

    #[test]
    fn definitions_detect_changed_path() {
        let plist = launchd_plist(EXE, "/l");
        assert!(Mechanism::Launchd.mentions(&plist, EXE));
        assert!(!Mechanism::Launchd.mentions(&plist, "/Applications/l8db.app/Contents/MacOS/l8db"));
        let (service, _) = systemd_units(EXE);
        assert!(Mechanism::Systemd.mentions(&service, EXE));
        assert!(!Mechanism::Systemd.mentions(&service, "/usr/bin/l8db"));
        assert!(Mechanism::Cron.mentions(&cron_line(EXE), EXE));
        assert!(!Mechanism::Cron.mentions(&cron_line(EXE), "/usr/bin/l8db"));
    }

    #[test]
    fn last_tick_is_read_from_settings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("automation.db");
        let store = Store::open(&path).unwrap();
        assert_eq!(last_tick(&path), None);
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(store.beat(crate::automation::scheduler::LAST_TICK))
            .unwrap();
        assert!(last_tick(&path).is_some_and(|at| at.ends_with('Z')));
    }
}
