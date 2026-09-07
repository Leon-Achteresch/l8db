use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tokio::io::AsyncReadExt;

const MAX_ARGS: usize = 50;
const MAX_ARG_LEN: usize = 4096;
const MAX_ENV_VARS: usize = 20;
const MAX_OUTPUT: usize = 512 * 1024;

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
    if !(1..=120_000).contains(&timeout) {
        return Err("Invalid process timeout".into());
    }
    Ok(timeout)
}

fn truncate(mut text: String) -> String {
    if text.len() > MAX_OUTPUT {
        text.truncate(MAX_OUTPUT);
    }
    text
}

#[tauri::command(async)]
pub async fn extension_process_run(
    command: String,
    options: ProcessOptions,
) -> Result<ProcessResult, String> {
    let timeout = validate(&command, &options)?;
    let mut child = tokio::process::Command::new(&command);
    child
        .args(&options.args)
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
        if let Some(handle) = stdout.as_mut() {
            handle
                .read_to_end(&mut out)
                .await
                .map_err(|e| e.to_string())?;
        }
        if let Some(handle) = stderr.as_mut() {
            handle
                .read_to_end(&mut err)
                .await
                .map_err(|e| e.to_string())?;
        }
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
    fn rejects_unknown_or_unsafe_commands() {
        assert!(validate("git", &options()).is_ok());
        assert!(validate("../git", &options()).is_err());
        assert!(validate("git;rm", &options()).is_err());
        assert!(validate("", &options()).is_err());
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
