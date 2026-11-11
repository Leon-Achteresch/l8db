use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CliState {
    Ready,
    Missing,
    NotOnPath,
    Other,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub state: CliState,
    pub command: String,
    pub location: Option<String>,
    pub target: String,
}

const NAMES: &[&str] = if cfg!(windows) {
    &["l8db.com", "l8db.exe", "l8db.bat", "l8db.cmd"]
} else {
    &["l8db"]
};

#[cfg(windows)]
const SHIM: &str = include_str!("../../windows/l8db.cmd");

#[cfg(windows)]
fn entry(target: &Path) -> PathBuf {
    target.with_file_name("bin").join("l8db.cmd")
}

#[cfg(not(windows))]
fn entry(target: &Path) -> PathBuf {
    target.to_path_buf()
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
        home().join(".local/bin/l8db")
    }
}

fn same(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn resolve(dirs: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    dirs.into_iter()
        .flat_map(|dir| NAMES.iter().map(move |name| dir.join(name)))
        .find(|candidate| candidate.is_file())
}

fn classify(found: Option<&Path>, target: &Path, linked: bool) -> CliState {
    match found {
        Some(path) if same(path, target) => CliState::Ready,
        Some(_) => CliState::Other,
        None if linked => CliState::NotOnPath,
        None => CliState::Missing,
    }
}

#[cfg(not(windows))]
fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
}

#[cfg(not(windows))]
fn process_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn search_dirs() -> Result<Vec<PathBuf>, String> {
    let mut dirs = process_dirs();
    dirs.extend(link().parent().map(Path::to_path_buf));
    Ok(dirs)
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn search_dirs() -> Result<Vec<PathBuf>, String> {
    let mut dirs = process_dirs();
    let shell = std::env::var("SHELL").unwrap_or_default();
    if rc_has(&rc_file(&home(), &shell)) {
        dirs.extend(link().parent().map(Path::to_path_buf));
    }
    Ok(dirs)
}

#[cfg(windows)]
fn search_dirs() -> Result<Vec<PathBuf>, String> {
    let paths = powershell_text(
        "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
    )?;
    Ok(std::env::split_paths(&paths).collect())
}

#[cfg(not(windows))]
fn linked(target: &Path) -> bool {
    same(&link(), target)
}

#[cfg(windows)]
fn linked(_: &Path) -> bool {
    false
}

fn status() -> Result<CliStatus, String> {
    let target = target()?;
    let entry = entry(&target);
    let found = resolve(search_dirs()?).filter(|path| same(path, &entry) || !same(path, &target));
    let state = classify(found.as_deref(), &entry, linked(&target));
    Ok(CliStatus {
        installed: state == CliState::Ready,
        state,
        command: "l8db".into(),
        location: found.map(|p| p.display().to_string()),
        target: target.display().to_string(),
    })
}

#[cfg(any(all(not(windows), not(target_os = "macos")), all(test, unix)))]
const RC_MARK: &str = "# added by l8db";

#[cfg(any(all(not(windows), not(target_os = "macos")), all(test, unix)))]
fn rc_files(home: &Path) -> [PathBuf; 4] {
    [
        home.join(".bashrc"),
        home.join(".zshrc"),
        home.join(".config/fish/config.fish"),
        home.join(".profile"),
    ]
}

#[cfg(any(all(not(windows), not(target_os = "macos")), all(test, unix)))]
fn rc_file(home: &Path, shell: &str) -> PathBuf {
    let [bash, zsh, fish, profile] = rc_files(home);
    match Path::new(shell).file_name().and_then(|name| name.to_str()) {
        Some("bash") => bash,
        Some("zsh") => zsh,
        Some("fish") => fish,
        _ => profile,
    }
}

#[cfg(any(all(not(windows), not(target_os = "macos")), all(test, unix)))]
fn rc_read(file: &Path) -> Result<String, String> {
    match std::fs::read_to_string(file) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("{}: {error}", file.display())),
    }
}

#[cfg(any(all(not(windows), not(target_os = "macos")), all(test, unix)))]
fn rc_marked(text: &str) -> bool {
    text.lines().any(|line| line.trim_end().ends_with(RC_MARK))
}

#[cfg(any(all(not(windows), not(target_os = "macos")), all(test, unix)))]
fn rc_has(file: &Path) -> bool {
    rc_read(file).is_ok_and(|text| rc_marked(&text))
}

#[cfg(any(all(not(windows), not(target_os = "macos")), all(test, unix)))]
fn rc_add(file: &Path, dir: &Path) -> Result<(), String> {
    let mut text = rc_read(file)?;
    if rc_marked(&text) {
        return Ok(());
    }
    let quoted = shell_quote(&dir.display().to_string());
    let line = if file.ends_with("config.fish") {
        format!("fish_add_path {quoted} {RC_MARK}")
    } else {
        format!("export PATH={quoted}:\"$PATH\" {RC_MARK}")
    };
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&line);
    text.push('\n');
    file.parent()
        .map(std::fs::create_dir_all)
        .transpose()
        .and_then(|_| std::fs::write(file, text))
        .map_err(|error| format!("{}: {error}", file.display()))
}

#[cfg(any(all(not(windows), not(target_os = "macos")), all(test, unix)))]
fn rc_remove(home: &Path) -> Result<(), String> {
    for file in rc_files(home) {
        let Ok(text) = rc_read(&file) else {
            continue;
        };
        if !rc_marked(&text) {
            continue;
        }
        let kept: String = text
            .split_inclusive('\n')
            .filter(|line| !line.trim_end().ends_with(RC_MARK))
            .collect();
        std::fs::write(&file, kept).map_err(|error| format!("{}: {error}", file.display()))?;
    }
    Ok(())
}

#[cfg(any(windows, test))]
fn same_entry(a: &str, b: &str) -> bool {
    let trim = |entry: &str| entry.trim().trim_end_matches('\\').to_lowercase();
    trim(a) == trim(b)
}

#[cfg(any(windows, test))]
fn with_entries(path: &str, dirs: &[&str]) -> String {
    let mut entries: Vec<&str> = path
        .split(';')
        .filter(|e| !e.trim().is_empty() && !dirs.iter().any(|dir| same_entry(e, dir)))
        .collect();
    entries.extend(dirs);
    entries.join(";")
}

#[cfg(any(windows, test))]
fn without_entries(path: &str, dirs: &[&str]) -> String {
    path.split(';')
        .filter(|e| !e.trim().is_empty() && !dirs.iter().any(|dir| same_entry(e, dir)))
        .collect::<Vec<_>>()
        .join(";")
}

async fn off_main_thread<T: Send + 'static>(work: fn() -> Result<T, String>) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cli_status() -> Result<CliStatus, String> {
    off_main_thread(repaired).await
}

#[cfg(not(windows))]
fn repaired() -> Result<CliStatus, String> {
    status()
}

#[cfg(windows)]
fn repaired() -> Result<CliStatus, String> {
    let found = status()?;
    let [_, dir] = path_dirs()?;
    let listed = user_path()?.split(';').any(|entry| same_entry(entry, &dir));
    if found.installed || !listed {
        return Ok(found);
    }
    install().or(Ok(found))
}

#[tauri::command]
pub async fn cli_install() -> Result<CliStatus, String> {
    off_main_thread(install).await
}

#[tauri::command]
pub async fn cli_uninstall() -> Result<CliStatus, String> {
    off_main_thread(uninstall).await
}

#[cfg(not(windows))]
fn ours(link: &Path, target: &Path) -> bool {
    match std::fs::read_link(link) {
        Ok(points) => {
            same(link, target)
                || (!link.exists() && points.to_string_lossy().to_lowercase().contains("l8db"))
        }
        Err(_) => std::fs::symlink_metadata(link).is_err(),
    }
}

#[cfg(not(windows))]
fn foreign(link: &Path) -> String {
    let what = std::fs::read_link(link)
        .map(|points| format!("Verweis auf {}", points.display()))
        .unwrap_or_else(|_| "eine andere Datei".into());
    format!(
        "Unter {} liegt schon {what}, nicht von dieser App. Bitte zuerst selbst entfernen.",
        link.display()
    )
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
    let output = crate::process::std_command("osascript")
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
fn install() -> Result<CliStatus, String> {
    let target = target()?;
    let link = link();
    if !ours(&link, &target) {
        return Err(foreign(&link));
    }
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
    expose(&link)?;
    status()
}

#[cfg(target_os = "macos")]
fn expose(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn expose(link: &Path) -> Result<(), String> {
    let Some(dir) = link.parent() else {
        return Ok(());
    };
    if process_dirs().iter().any(|entry| entry == dir) {
        return Ok(());
    }
    let shell = std::env::var("SHELL").unwrap_or_default();
    rc_add(&rc_file(&home(), &shell), dir)
}

#[cfg(target_os = "macos")]
fn conceal() -> Result<(), String> {
    Ok(())
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn conceal() -> Result<(), String> {
    rc_remove(&home())
}

#[cfg(not(windows))]
fn uninstall() -> Result<CliStatus, String> {
    let link = link();
    if std::fs::symlink_metadata(&link).is_ok() {
        if !ours(&link, &target()?) {
            return Err(foreign(&link));
        }
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
    conceal()?;
    status()
}

#[cfg(windows)]
fn powershell(script: &str) -> Result<String, String> {
    let output = crate::process::std_command("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!("$ErrorActionPreference='Stop'; {script}"),
        ])
        .output()
        .map_err(|e| format!("PowerShell: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(windows)]
fn powershell_text(expression: &str) -> Result<String, String> {
    use base64::Engine;
    let encoded = powershell(&format!(
        "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]({expression})))"
    ))?;
    base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|e| e.to_string())
        .and_then(|bytes| String::from_utf8(bytes).map_err(|e| e.to_string()))
}

#[cfg(windows)]
fn user_path() -> Result<String, String> {
    powershell_text(
        "(Get-Item 'HKCU:\\Environment').GetValue('Path','','DoNotExpandEnvironmentNames')",
    )
}

#[cfg(windows)]
fn set_user_path(path: &str) -> Result<(), String> {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(path);
    powershell(&format!(
        "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}')); $k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true); $kind=if($k.GetValueNames() -contains 'Path'){{$k.GetValueKind('Path')}}else{{[Microsoft.Win32.RegistryValueKind]::ExpandString}}; $k.SetValue('Path',$p,$kind); $k.Close(); [Environment]::SetEnvironmentVariable('L8DB_PATH_REFRESH',$null,'User')"
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
fn path_dirs() -> Result<[String; 2], String> {
    let dir = install_dir()?;
    Ok([format!("{dir}\\bin"), dir])
}

#[cfg(windows)]
fn change_user_path(change: fn(&str, &[&str]) -> String) -> Result<CliStatus, String> {
    let [bin, dir] = path_dirs()?;
    let current = user_path()?;
    let next = change(&current, &[&bin, &dir]);
    if next != current {
        set_user_path(&next)?;
    }
    status()
}

#[cfg(windows)]
fn install() -> Result<CliStatus, String> {
    let shim = entry(&target()?);
    if !shim.is_file() {
        shim.parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|()| std::fs::write(&shim, SHIM))
            .map_err(|error| format!("{}: {error}", shim.display()))?;
    }
    change_user_path(with_entries)
}

#[cfg(windows)]
fn uninstall() -> Result<CliStatus, String> {
    change_user_path(without_entries)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn the_first_l8db_on_the_path_decides_the_state() {
        let exe = std::env::current_exe().unwrap();
        let linked = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(&exe, linked.path().join("l8db")).unwrap();
        let other = tempfile::tempdir().unwrap();
        std::fs::write(other.path().join("l8db"), "#!/bin/sh\n").unwrap();
        let dangling = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("/gone/l8db", dangling.path().join("l8db")).unwrap();
        let dirs = |list: &[&Path]| list.iter().map(|dir| dir.to_path_buf()).collect::<Vec<_>>();

        let ours = resolve(dirs(&[dangling.path(), linked.path(), other.path()]));
        assert_eq!(ours, Some(linked.path().join("l8db")));
        assert_eq!(classify(ours.as_deref(), &exe, true), CliState::Ready);

        let shadowed = resolve(dirs(&[other.path(), linked.path()]));
        assert_eq!(classify(shadowed.as_deref(), &exe, true), CliState::Other);

        let none = resolve(dirs(&[dangling.path()]));
        assert_eq!(none, None);
        assert_eq!(classify(None, &exe, true), CliState::NotOnPath);
        assert_eq!(classify(None, &exe, false), CliState::Missing);
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn the_shell_profile_gets_one_marked_line_and_loses_it_again() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path().join(".local/bin");
        assert_eq!(
            rc_file(home.path(), "/usr/bin/zsh"),
            home.path().join(".zshrc")
        );
        assert_eq!(
            rc_file(home.path(), "/bin/bash"),
            home.path().join(".bashrc")
        );
        assert_eq!(rc_file(home.path(), ""), home.path().join(".profile"));

        let bashrc = home.path().join(".bashrc");
        std::fs::write(&bashrc, "alias ll='ls -l'").unwrap();
        assert!(!rc_has(&bashrc));
        rc_add(&bashrc, &dir).unwrap();
        rc_add(&bashrc, &dir).unwrap();
        let text = std::fs::read_to_string(&bashrc).unwrap();
        assert_eq!(text.matches(RC_MARK).count(), 1);
        assert!(text.starts_with("alias ll='ls -l'\nexport PATH='"));
        assert!(text.contains(":\"$PATH\" # added by l8db\n"));

        let fish = rc_file(home.path(), "/usr/bin/fish");
        rc_add(&fish, &dir).unwrap();
        assert!(std::fs::read_to_string(&fish)
            .unwrap()
            .starts_with("fish_add_path '"));

        let foreign = home.path().join(".zshrc");
        std::fs::write(&foreign, "alias db=psql # l8db\r\nexport A=1").unwrap();
        assert!(!rc_has(&foreign));

        rc_remove(home.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(&foreign).unwrap(),
            "alias db=psql # l8db\r\nexport A=1"
        );
        let binary = home.path().join(".profile");
        std::fs::write(&binary, [b'#', 0xE4, b'\n']).unwrap();
        assert!(rc_add(&binary, &dir).is_err());
        assert_eq!(std::fs::read(&binary).unwrap(), [b'#', 0xE4, b'\n']);
        assert_eq!(
            std::fs::read_to_string(&bashrc).unwrap(),
            "alias ll='ls -l'\n"
        );
        assert_eq!(std::fs::read_to_string(&fish).unwrap(), "");
    }

    #[test]
    fn windows_path_entries_are_added_once_and_removed_exactly() {
        let path = r"%USERPROFILE%\bin;C:\Program Files\l8db;C:\Tools\;";
        let dirs = [r"C:\Program Files\l8db\bin", r"C:\Program Files\l8db"];
        let added = with_entries(path, &dirs);
        assert_eq!(
            added,
            r"%USERPROFILE%\bin;C:\Tools\;C:\Program Files\l8db\bin;C:\Program Files\l8db"
        );
        let shouted = [r"c:\program files\L8DB\BIN\", r"C:\PROGRAM FILES\l8db\"];
        assert_eq!(with_entries(&added, &shouted).split(';').count(), 4);
        assert_eq!(with_entries(&added, &dirs), added);
        assert_eq!(with_entries("", &dirs), dirs.join(";"));
        assert_eq!(
            without_entries(&added, &shouted),
            r"%USERPROFILE%\bin;C:\Tools\"
        );
        assert_eq!(without_entries(r"C:\Tools", &dirs), r"C:\Tools");
    }

    #[test]
    fn only_replaces_links_that_belong_to_this_app() {
        let exe = std::env::current_exe().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let free = dir.path().join("free");
        assert!(ours(&free, &exe));
        let mine = dir.path().join("mine");
        std::os::unix::fs::symlink(&exe, &mine).unwrap();
        assert!(ours(&mine, &exe));
        let moved = dir.path().join("moved");
        std::os::unix::fs::symlink("/Applications/l8db.app/gone/l8db", &moved).unwrap();
        assert!(ours(&moved, &exe));
        let other_link = dir.path().join("other-link");
        std::os::unix::fs::symlink("/bin/sh", &other_link).unwrap();
        assert!(!ours(&other_link, &exe));
        let file = dir.path().join("file");
        std::fs::write(&file, "#!/bin/sh\n").unwrap();
        assert!(!ours(&file, &exe));
        assert!(foreign(&other_link).contains("/bin/sh"));
    }
}
