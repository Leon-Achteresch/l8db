use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tokio::io::AsyncReadExt;

const MAX_ARGS: usize = 50;
const MAX_ARG_LEN: usize = 4096;
const MAX_ENV_VARS: usize = 20;
const MAX_OUTPUT: usize = 512 * 1024;
const MAX_SESSIONS: usize = 8;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOptions {
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResult {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

fn valid_binary(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.contains(['/', '\\', '\0'])
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        && name.as_bytes()[0].is_ascii_alphanumeric()
}

pub fn validate(command: &str, options: &ProcessOptions) -> Result<u64, String> {
    if !valid_binary(command) {
        return Err("Invalid process command".into());
    }
    if options.args.len() > MAX_ARGS
        || options
            .args
            .iter()
            .any(|arg| arg.len() > MAX_ARG_LEN || arg.contains('\0'))
    {
        return Err("Invalid process args".into());
    }
    if options.env.len() > MAX_ENV_VARS
        || options
            .env
            .iter()
            .any(|(k, v)| k.is_empty() || k.len() > 256 || v.len() > MAX_ARG_LEN)
    {
        return Err("Invalid process env".into());
    }
    if let Some(cwd) = &options.cwd {
        if cwd.is_empty() || cwd.len() > MAX_ARG_LEN || cwd.contains('\0') {
            return Err("Invalid process cwd".into());
        }
    }
    let timeout = options.timeout_ms.unwrap_or(30_000);
    if !(1..=600_000).contains(&timeout) {
        return Err("Invalid process timeout".into());
    }
    Ok(timeout)
}

fn truncate(mut text: String) -> String {
    text.truncate(text.floor_char_boundary(MAX_OUTPUT));
    text
}

fn dirs() -> Vec<std::path::PathBuf> {
    let mut dirs = crate::db::backup_tools::search_dirs();
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        dirs.push(std::path::PathBuf::from(home).join(".local/bin"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA").map(std::path::PathBuf::from) {
        dirs.push(appdata.join("npm"));
        if let Ok(entries) = std::fs::read_dir(appdata.join("Python")) {
            dirs.extend(entries.flatten().map(|entry| entry.path().join("Scripts")));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from) {
        dirs.push(local.join("Microsoft").join("WinGet").join("Links"));
    }
    dirs
}

fn child_path() -> std::ffi::OsString {
    std::env::join_paths(dirs()).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

fn resolve(command: &str) -> std::path::PathBuf {
    let dirs = dirs();
    let names = if cfg!(windows) {
        vec![
            format!("{command}.exe"),
            format!("{command}.cmd"),
            command.to_string(),
        ]
    } else {
        vec![command.to_string()]
    };
    dirs.iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|path| path.is_file())
        .unwrap_or_else(|| command.into())
}

#[tauri::command(async)]
pub async fn extension_process_run(
    command: String,
    options: ProcessOptions,
) -> Result<ProcessResult, String> {
    let timeout = validate(&command, &options)?;
    let mut child = crate::db::backup_tools::command(std::path::Path::new(&resolve(&command)));
    child
        .args(&options.args)
        .env("PATH", child_path())
        .envs(&options.env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(cwd) = &options.cwd {
        child.current_dir(cwd);
    }
    let mut spawned = child.spawn().map_err(|e| e.to_string())?;
    let mut stdout = spawned.stdout.take();
    let mut stderr = spawned.stderr.take();
    let reader = async {
        let mut out = Vec::new();
        let mut err = Vec::new();
        let read_out = async {
            match stdout.as_mut() {
                Some(handle) => handle.read_to_end(&mut out).await.map(|_| ()),
                None => Ok(()),
            }
        };
        let read_err = async {
            match stderr.as_mut() {
                Some(handle) => handle.read_to_end(&mut err).await.map(|_| ()),
                None => Ok(()),
            }
        };
        let (a, b) = tokio::join!(read_out, read_err);
        a.and(b).map_err(|e| e.to_string())?;
        spawned
            .wait()
            .await
            .map_err(|e| e.to_string())
            .map(|status| (status, out, err))
    };
    match tokio::time::timeout(Duration::from_millis(timeout), reader).await {
        Ok(Ok((status, out, err))) => Ok(ProcessResult {
            status: status.code(),
            stdout: truncate(String::from_utf8_lossy(&out).into_owned()),
            stderr: truncate(String::from_utf8_lossy(&err).into_owned()),
        }),
        Ok(Err(error)) => Err(error),
        Err(_) => {
            let _ = spawned.kill().await;
            Err("Process timed out".into())
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOutput {
    pub output: String,
    pub exited: bool,
    pub status: Option<i32>,
}

#[derive(Default)]
struct Buffer {
    data: Vec<u8>,
    eof: bool,
}

struct Session {
    child: Box<dyn Child + Send + Sync>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    buffer: Arc<Mutex<Buffer>>,
    notify: Arc<tokio::sync::Notify>,
    _master: Box<dyn MasterPty + Send>,
}

static SESSIONS: LazyLock<Mutex<HashMap<u32, Session>>> = LazyLock::new(Default::default);
static NEXT_SESSION: AtomicU32 = AtomicU32::new(1);

fn with_session<T>(
    id: u32,
    f: impl FnOnce(&mut Session) -> Result<T, String>,
) -> Result<T, String> {
    let mut sessions = SESSIONS.lock().map_err(|e| e.to_string())?;
    f(sessions.get_mut(&id).ok_or("Unknown process")?)
}

fn take_session(id: u32) -> Option<Session> {
    SESSIONS.lock().ok()?.remove(&id)
}

#[tauri::command(async)]
pub async fn extension_process_start(
    command: String,
    options: ProcessOptions,
) -> Result<u32, String> {
    let timeout = validate(&command, &options)?;
    if SESSIONS.lock().map_err(|e| e.to_string())?.len() >= MAX_SESSIONS {
        return Err("Too many running processes".into());
    }
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 40,
            cols: 200,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let mut builder = CommandBuilder::new(resolve(&command));
    builder.args(&options.args);
    builder.env("PATH", child_path());
    for (key, value) in &options.env {
        builder.env(key, value);
    }
    if let Some(cwd) = &options.cwd {
        builder.cwd(cwd);
    }
    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let buffer = Arc::new(Mutex::new(Buffer::default()));
    let notify = Arc::new(tokio::sync::Notify::new());
    let (sink, signal) = (buffer.clone(), notify.clone());
    std::thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        loop {
            let read = reader.read(&mut chunk).unwrap_or(0);
            let Ok(mut buffer) = sink.lock() else { break };
            if read == 0 {
                buffer.eof = true;
            } else {
                buffer.data.extend_from_slice(&chunk[..read]);
                let excess = buffer.data.len().saturating_sub(MAX_OUTPUT);
                buffer.data.drain(..excess);
            }
            drop(buffer);
            signal.notify_one();
            if read == 0 {
                break;
            }
        }
    });
    let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    SESSIONS.lock().map_err(|e| e.to_string())?.insert(
        id,
        Session {
            child,
            writer: Arc::new(Mutex::new(writer)),
            buffer,
            notify,
            _master: pair.master,
        },
    );
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(timeout)).await;
        if let Some(mut session) = take_session(id) {
            let _ = session.child.kill();
        }
    });
    Ok(id)
}

#[tauri::command(async)]
pub fn extension_process_write(id: u32, data: String) -> Result<(), String> {
    if data.len() > MAX_ARG_LEN || data.contains('\0') {
        return Err("Invalid process input".into());
    }
    let writer = with_session(id, |session| Ok(session.writer.clone()))?;
    let mut writer = writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub async fn extension_process_read(
    id: u32,
    timeout_ms: Option<u64>,
) -> Result<ProcessOutput, String> {
    let wait = Duration::from_millis(timeout_ms.unwrap_or(1000).clamp(1, 30_000));
    let notify = with_session(id, |session| Ok(session.notify.clone()))?;
    let _ = tokio::time::timeout(wait, notify.notified()).await;
    let (output, finished) = with_session(id, |session| {
        let exited = session
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some();
        let mut buffer = session.buffer.lock().map_err(|e| e.to_string())?;
        let data = std::mem::take(&mut buffer.data);
        let finished = buffer.eof || (exited && data.is_empty());
        Ok((String::from_utf8_lossy(&data).into_owned(), finished))
    })?;
    if !finished {
        return Ok(ProcessOutput {
            output,
            exited: false,
            status: None,
        });
    }
    let mut status = None;
    if let Some(mut session) = take_session(id) {
        for _ in 0..50 {
            if let Some(exit) = session.child.try_wait().map_err(|e| e.to_string())? {
                status = Some(exit.exit_code() as i32);
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        if status.is_none() {
            let _ = session.child.kill();
        }
    }
    Ok(ProcessOutput {
        output,
        exited: true,
        status,
    })
}

#[tauri::command(async)]
pub fn extension_process_stop(id: u32) -> Result<(), String> {
    if let Some(mut session) = take_session(id) {
        session.child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn options() -> ProcessOptions {
        ProcessOptions {
            args: vec![],
            cwd: None,
            env: HashMap::new(),
            timeout_ms: None,
        }
    }
    #[test]
    fn truncate_cuts_at_a_char_boundary() {
        let text = format!("a{}", "ü".repeat(MAX_OUTPUT));
        let cut = truncate(text);
        assert_eq!(cut.len(), MAX_OUTPUT - 1);
        assert!(cut.ends_with('ü'));
        assert_eq!(truncate("äöü".into()), "äöü");
    }
    #[test]
    fn rejects_unknown_or_unsafe_commands() {
        assert!(validate("git", &options()).is_ok());
        assert!(validate("../git", &options()).is_err());
        assert!(validate("git;rm", &options()).is_err());
        assert!(validate("", &options()).is_err());
    }
    #[test]
    fn resolves_binaries_outside_the_inherited_path() {
        assert!(resolve("sh").is_absolute());
        assert_eq!(
            resolve("no-such-binary-l8db"),
            std::path::PathBuf::from("no-such-binary-l8db")
        );
    }
    #[tokio::test]
    async fn runs_a_resolved_binary() {
        let mut opts = options();
        opts.args = vec!["-c".into(), "echo out; echo err >&2".into()];
        let result = extension_process_run("sh".into(), opts).await.unwrap();
        assert_eq!(result.status, Some(0));
        assert_eq!(result.stdout, "out\n");
        assert_eq!(result.stderr, "err\n");
    }
    #[test]
    fn child_path_keeps_inherited_entries_and_adds_tool_dirs() {
        let path = child_path();
        let entries: Vec<_> = std::env::split_paths(&path).collect();
        for inherited in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
            if !inherited.as_os_str().is_empty() {
                assert!(entries.contains(&inherited));
            }
        }
        if cfg!(target_os = "macos") {
            assert!(entries.contains(&std::path::PathBuf::from("/opt/homebrew/bin")));
            assert!(entries.contains(&std::path::PathBuf::from("/usr/local/bin")));
        }
    }
    #[tokio::test]
    async fn scripts_find_their_interpreter_without_an_inherited_path() {
        if !std::path::Path::new("/usr/local/bin/node").is_file()
            && !std::path::Path::new("/opt/homebrew/bin/node").is_file()
        {
            return;
        }
        let mut opts = options();
        opts.args = vec!["-c".into(), "command -v node".into()];
        let result = extension_process_run("sh".into(), opts).await.unwrap();
        assert_eq!(result.status, Some(0), "{}", result.stderr);
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn sessions_run_in_a_terminal_and_take_input() {
        let mut opts = options();
        opts.args = vec![
            "-c".into(),
            "test -t 0 && read x && echo \"got $x $L8DB_TEST\"".into(),
        ];
        opts.env.insert("L8DB_TEST".into(), "env".into());
        let id = extension_process_start("sh".into(), opts).await.unwrap();
        extension_process_write(id, "hi\n".into()).unwrap();
        let mut output = String::new();
        let status = loop {
            let chunk = extension_process_read(id, Some(5000)).await.unwrap();
            output.push_str(&chunk.output);
            if chunk.exited {
                break chunk.status;
            }
        };
        assert_eq!(status, Some(0), "{output}");
        assert!(output.contains("got hi env"), "{output}");
        assert!(extension_process_read(id, Some(1)).await.is_err());
    }
    #[test]
    fn rejects_oversized_inputs() {
        let mut oversized = options();
        oversized.args = vec!["x".to_string(); MAX_ARGS + 1];
        assert!(validate("git", &oversized).is_err());
        let mut bad_timeout = options();
        bad_timeout.timeout_ms = Some(0);
        assert!(validate("git", &bad_timeout).is_err());
    }
}
