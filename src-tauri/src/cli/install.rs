use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub command: String,
    pub location: Option<String>,
    pub target: String,
}

fn target() -> Result<PathBuf, String> {
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return Ok(PathBuf::from(appimage));
    }
    std::env::current_exe().map_err(|e| format!("Programmpfad unbekannt: {e}"))
}

#[cfg(not(windows))]
fn link() -> PathBuf {
    if cfg!(target_os = "macos") {
        PathBuf::from("/usr/local/bin/l8db")
    } else {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".local/bin/l8db")
    }
}

fn same(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn on_path(target: &Path) -> Option<PathBuf> {
    find_in(std::env::var_os("PATH"), target)
}

fn find_in(path: Option<std::ffi::OsString>, target: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) { "l8db.exe" } else { "l8db" };
    path.into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .chain(extra_dirs())
        .map(|dir| dir.join(name))
        .find(|candidate| same(candidate, target))
}

#[cfg(not(windows))]
fn extra_dirs() -> Vec<PathBuf> {
    link().parent().map(Path::to_path_buf).into_iter().collect()
}

#[cfg(windows)]
fn extra_dirs() -> Vec<PathBuf> {
    user_path()
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn cli_status() -> Result<CliStatus, String> {
    let target = target()?;
    let location = on_path(&target);
    Ok(CliStatus {
        installed: location.is_some(),
        command: "l8db".into(),
        location: location.map(|p| p.display().to_string()),
        target: target.display().to_string(),
    })
}

#[cfg(not(windows))]
fn shell_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn as_admin(script: &str) -> Result<(), String> {
    let apple = format!(
        "do shell script \"{}\" with administrator privileges",
        script.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let output = std::process::Command::new("osascript")
        .args(["-e", &apple])
        .output()
        .map_err(|e| format!("osascript: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let error = String::from_utf8_lossy(&output.stderr);
        if error.contains("-128") {
            Err("Abgebrochen.".into())
        } else {
            Err(error.trim().to_string())
        }
    }
}

#[cfg(not(target_os = "macos"))]
#[cfg(not(windows))]
fn as_admin(_: &str) -> Result<(), String> {
    Err("Keine Schreibrechte.".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn cli_install() -> Result<CliStatus, String> {
    let target = target()?;
    let link = link();
    let direct = link
        .parent()
        .map(std::fs::create_dir_all)
        .transpose()
        .and_then(|_| match std::fs::symlink_metadata(&link) {
            Ok(_) => std::fs::remove_file(&link),
            Err(_) => Ok(()),
        })
        .and_then(|_| std::os::unix::fs::symlink(&target, &link));
    if let Err(error) = direct {
        if error.kind() != std::io::ErrorKind::PermissionDenied {
            return Err(format!("{}: {error}", link.display()));
        }
        let dir = link.parent().unwrap_or(Path::new("/"));
        as_admin(&format!(
            "mkdir -p {} && ln -sfn {} {}",
            shell_quote(&dir.display().to_string()),
            shell_quote(&target.display().to_string()),
            shell_quote(&link.display().to_string())
        ))?;
    }
    cli_status()
}

#[cfg(not(windows))]
#[tauri::command]
pub fn cli_uninstall() -> Result<CliStatus, String> {
    let link = link();
    if std::fs::read_link(&link).is_ok() {
        if let Err(error) = std::fs::remove_file(&link) {
            if error.kind() != std::io::ErrorKind::PermissionDenied {
                return Err(format!("{}: {error}", link.display()));
            }
            as_admin(&format!(
                "rm -f {}",
                shell_quote(&link.display().to_string())
            ))?;
        }
    }
    cli_status()
}

#[cfg(windows)]
fn powershell(script: &str) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|e| format!("PowerShell: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(windows)]
fn user_path() -> Option<String> {
    powershell("[Environment]::GetEnvironmentVariable('Path','User')").ok()
}

#[cfg(windows)]
fn set_user_path(entries: &[String]) -> Result<(), String> {
    let joined = entries.join(";").replace('\'', "''");
    powershell(&format!(
        "[Environment]::SetEnvironmentVariable('Path','{joined}','User')"
    ))
    .map(|_| ())
}

#[cfg(windows)]
fn install_dir() -> Result<String, String> {
    target()?
        .parent()
        .map(|dir| dir.display().to_string())
        .ok_or_else(|| "Programmordner unbekannt.".into())
}

#[cfg(windows)]
fn entries() -> Vec<String> {
    user_path()
        .unwrap_or_default()
        .split(';')
        .filter(|entry| !entry.trim().is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(windows)]
#[tauri::command]
pub fn cli_install() -> Result<CliStatus, String> {
    let dir = install_dir()?;
    let mut entries = entries();
    if !entries.iter().any(|entry| entry.eq_ignore_ascii_case(&dir)) {
        entries.push(dir);
        set_user_path(&entries)?;
    }
    cli_status()
}

#[cfg(windows)]
#[tauri::command]
pub fn cli_uninstall() -> Result<CliStatus, String> {
    let dir = install_dir()?;
    let entries = entries();
    let kept: Vec<String> = entries
        .iter()
        .filter(|entry| !entry.eq_ignore_ascii_case(&dir))
        .cloned()
        .collect();
    if kept.len() != entries.len() {
        set_user_path(&kept)?;
    }
    cli_status()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn finds_a_link_on_the_path_that_points_to_this_binary() {
        let exe = std::env::current_exe().unwrap();
        let linked = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(&exe, linked.path().join("l8db")).unwrap();
        let other = tempfile::tempdir().unwrap();
        std::fs::write(other.path().join("l8db"), "#!/bin/sh\n").unwrap();
        let path = std::env::join_paths([other.path(), linked.path()]).unwrap();
        assert_eq!(find_in(Some(path), &exe), Some(linked.path().join("l8db")));
        let only_other = std::env::join_paths([other.path()]).unwrap();
        let found = find_in(Some(only_other), &exe);
        assert!(found.is_none_or(|p| p.starts_with(link().parent().unwrap())));
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }
}
