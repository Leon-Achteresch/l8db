use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::Stdio,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tokio::process::Command;

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static SERIAL: AtomicU64 = AtomicU64::new(0);
const LIMIT: usize = 16 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub action: String,
    pub repo: String,
    pub path: Option<String>,
    pub content: Option<String>,
    pub expected: Option<String>,
    pub revision: Option<String>,
    pub name: Option<String>,
    pub paths: Option<Vec<String>>,
    pub base: Option<String>,
    pub incoming: Option<String>,
}

async fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .args(["--no-pager", "--literal-pathspecs"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(60), command.output())
        .await
        .map_err(|_| "Git-Zeitlimit erreicht")?
        .map_err(|e| e.to_string())?;
    if output.stdout.len() > LIMIT || output.stderr.len() > LIMIT {
        return Err("Git-Ausgabe zu groß".into());
    }
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    String::from_utf8(output.stdout).map_err(|_| "Git-Ausgabe ist kein UTF-8".into())
}

fn relative(value: &str) -> Result<(), String> {
    if value.len() > 240
        || !value.starts_with("database/")
        || value.contains(['\\', '\0', ':'])
        || value
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == ".." || p.starts_with('.'))
        || Path::new(value)
            .components()
            .any(|p| !matches!(p, Component::Normal(_)))
    {
        return Err("Nur reguläre Dateien unter database/ sind zulässig".into());
    }
    if !["sql", "json", "pks", "pkb", "md"].contains(&value.rsplit('.').next().unwrap_or("")) {
        return Err("Nicht unterstützter Dateityp".into());
    }
    Ok(())
}

fn safe_file(root: &Path, value: &str) -> Result<PathBuf, String> {
    relative(value)?;
    let mut path = root.to_path_buf();
    for part in value.split('/') {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("Symbolische Links sind nicht zulässig".into())
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(path)
}

fn read(path: &Path) -> Result<Option<String>, String> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
        Ok(meta) => {
            if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > LIMIT as u64 {
                return Err("Ungültige oder zu große Datei".into());
            }
            fs::read_to_string(path)
                .map(Some)
                .map_err(|e| e.to_string())
        }
    }
}

fn write(path: &Path, content: &str, expected: Option<&str>) -> Result<(), String> {
    if content.len() > LIMIT || content.contains('\0') {
        return Err("Ungültiger oder zu großer Inhalt".into());
    }
    if read(path)?.as_deref() != expected {
        return Err("Datei wurde inzwischen geändert. Bitte neu laden.".into());
    }
    let parent = path.parent().ok_or("Ungültiger Pfad")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = parent.join(format!(
        ".l8db-{}-{}.tmp",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    let _ = fs::remove_file(temp);
    result
}

fn list(root: &Path, dir: &Path, files: &mut Vec<String>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    if fs::symlink_metadata(dir)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Symbolische Links sind nicht zulässig".into());
    }
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let kind = item.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            return Err("Symbolische Links sind nicht zulässig".into());
        }
        if kind.is_dir() {
            list(root, &item.path(), files)?;
        } else if kind.is_file() {
            let path = item
                .path()
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if relative(&path).is_ok() {
                files.push(path);
            }
        }
        if files.len() > 10000 {
            return Err("Zu viele Projektdateien".into());
        }
    }
    Ok(())
}

async fn revision(root: &Path, value: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 200
        || value.starts_with('-')
        || value.contains(['\0', '\n'])
    {
        return Err("Ungültige Revision".into());
    }
    Ok(git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{value}^{{commit}}"),
        ],
    )
    .await?
    .trim()
    .into())
}

pub async fn handle(request: Request) -> Result<Value, String> {
    let _lock = LOCK.lock().await;
    let directory = fs::canonicalize(&request.repo).map_err(|e| e.to_string())?;
    if !directory.is_dir() {
        return Err("Bitte einen Repository-Ordner auswählen".into());
    }
    if request.action == "init" {
        git(&directory, &["init"]).await?;
    }
    let root = PathBuf::from(
        git(&directory, &["rev-parse", "--show-toplevel"])
            .await?
            .trim(),
    );
    let common = PathBuf::from(
        git(
            &root,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )
        .await?
        .trim(),
    );
    let lock_path = common.join("l8db-operation.lock");
    if fs::symlink_metadata(&lock_path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Ungültige Repository-Sperre".into());
    }
    let operation_lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)
        .map_err(|e| e.to_string())?;
    operation_lock.try_lock().map_err(|_| {
        "Eine andere l8db-Instanz bearbeitet dieses Repository. Bitte erneut versuchen."
    })?;
    let path = request.path.as_deref().unwrap_or("");
    match request.action.as_str() {
        "files" => {
            let commit =
                revision(&root, request.revision.as_deref().ok_or("Revision fehlt")?).await?;
            let names = git(
                &root,
                &[
                    "ls-tree",
                    "-r",
                    "--name-only",
                    "-z",
                    &commit,
                    "--",
                    "database/",
                ],
            )
            .await?;
            let files: Vec<_> = names
                .split('\0')
                .filter(|path| relative(path).is_ok())
                .collect();
            if files.len() > 10000 {
                return Err("Zu viele Projektdateien".into());
            }
            Ok(json!(files))
        }
        "init" | "status" => {
            let mut files = Vec::new();
            list(&root, &root.join("database"), &mut files)?;
            let tracked = git(&root, &["ls-files", "-z", "--", "database/"]).await?;
            files.extend(
                tracked
                    .split('\0')
                    .filter(|path| relative(path).is_ok())
                    .map(str::to_owned),
            );
            files.sort();
            files.dedup();
            let head = revision(&root, "HEAD").await.ok();
            let branch = git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
                .await
                .ok()
                .map(|v| v.trim().to_string());
            let branches = git(
                &root,
                &["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
            )
            .await?;
            let changes = git(
                &root,
                &[
                    "status",
                    "--porcelain=v1",
                    "-z",
                    "--untracked-files=all",
                    "--",
                    "database/",
                ],
            )
            .await?;
            let history = if head.is_some() {
                git(
                    &root,
                    &["log", "-30", "--format=%H%x09%s", "--", "database/"],
                )
                .await?
            } else {
                String::new()
            };
            Ok(
                json!({"repo":root,"head":head,"branch":branch,"branches":branches.lines().collect::<Vec<_>>(),"files":files,"changes":changes,"history":history}),
            )
        }
        "read" => {
            let file = safe_file(&root, path)?;
            if let Some(value) = request.revision {
                let commit = revision(&root, &value).await?;
                Ok(json!(
                    git(&root, &["show", &format!("{commit}:{path}")]).await?
                ))
            } else {
                Ok(json!(read(&file)?))
            }
        }
        "write" => {
            if path.starts_with("database/releases/")
                && !git(&root, &["log", "-1", "--format=%H", "--", path])
                    .await
                    .unwrap_or_default()
                    .trim()
                    .is_empty()
            {
                return Err(
                    "Commitete Releases sind unveränderlich. Bitte einen neuen Release anlegen."
                        .into(),
                );
            }
            let file = safe_file(&root, path)?;
            write(
                &file,
                request.content.as_deref().ok_or("Inhalt fehlt")?,
                request.expected.as_deref(),
            )?;
            Ok(Value::Null)
        }
        "delete" => {
            if path.starts_with("database/releases/")
                && !git(&root, &["log", "-1", "--format=%H", "--", path])
                    .await
                    .unwrap_or_default()
                    .trim()
                    .is_empty()
            {
                return Err(
                    "Commitete Releases sind unveränderlich. Bitte einen neuen Release anlegen."
                        .into(),
                );
            }
            let file = safe_file(&root, path)?;
            if read(&file)?.as_deref() != request.expected.as_deref() {
                return Err("Datei wurde inzwischen geändert".into());
            }
            fs::remove_file(file).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "diff" => {
            safe_file(&root, path)?;
            let original = if revision(&root, "HEAD").await.is_ok() {
                git(&root, &["show", &format!("HEAD:{path}")]).await.ok()
            } else {
                None
            };
            Ok(
                json!({"original":original.unwrap_or_default(),"modified":read(&safe_file(&root,path)?)?.unwrap_or_default()}),
            )
        }
        "commit" => {
            let paths = request.paths.ok_or("Dateiauswahl fehlt")?;
            if paths.is_empty() || paths.len() > 10000 {
                return Err("Bitte Dateien auswählen".into());
            }
            for path in &paths {
                safe_file(&root, path)?;
            }
            let name = request.name.ok_or("Commit-Nachricht fehlt")?;
            if name.trim().is_empty() || name.len() > 4000 {
                return Err("Ungültige Commit-Nachricht".into());
            }
            let mut args = vec!["add", "--"];
            args.extend(paths.iter().map(String::as_str));
            git(&root, &args).await?;
            let mut args = vec!["commit", "--only", "-m", &name, "--"];
            args.extend(paths.iter().map(String::as_str));
            git(&root, &args).await?;
            Ok(json!(revision(&root, "HEAD").await?))
        }
        "branch" | "checkout" => {
            let name = request.name.ok_or("Branchname fehlt")?;
            if name.starts_with('-') || name == "HEAD" {
                return Err("Ungültiger Branchname".into());
            }
            git(&root, &["check-ref-format", &format!("refs/heads/{name}")]).await?;
            if !git(&root, &["status", "--porcelain"]).await?.is_empty() {
                return Err("Branchwechsel benötigt einen sauberen Arbeitsbaum, einschließlich anderer Projektdateien".into());
            }
            let args = if request.action == "branch" {
                vec!["switch", "-c", &name]
            } else {
                vec!["switch", &name]
            };
            git(&root, &args).await?;
            Ok(Value::Null)
        }
        "fetch" | "pull" | "push" => {
            if request.action != "fetch"
                && !git(&root, &["status", "--porcelain"]).await?.is_empty()
            {
                return Err("Bitte vor der Synchronisierung alle Änderungen committen oder außerhalb von l8db sichern.".into());
            }
            let result = match request.action.as_str() {
                "fetch" => git(&root, &["fetch", "origin"]).await,
                "pull" => git(&root, &["pull", "--ff-only"]).await,
                _ => {
                    let branch =
                        git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await?;
                    git(&root, &["push", "--set-upstream", "origin", branch.trim()]).await
                }
            };
            result.map_err(|_| "Git-Synchronisierung fehlgeschlagen. Remote, Berechtigungen und Git-Anmeldung prüfen; Pull benötigt einen konfliktfreien Fast-forward.".to_string())?;
            Ok(Value::Null)
        }
        "merge" => {
            let values = [
                request.content.ok_or("Kundentext fehlt")?,
                request.base.ok_or("Basis fehlt")?,
                request.incoming.ok_or("Produkttext fehlt")?,
            ];
            if values.iter().any(|v| v.len() > LIMIT || v.contains('\0')) {
                return Err("Ungültiger Merge-Inhalt".into());
            }
            let dir = std::env::temp_dir().join(format!(
                "l8db-merge-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&dir).map_err(|e| e.to_string())?;
            let result = async {
                for (name, value) in ["customer", "base", "product"].iter().zip(values.iter()) {
                    fs::write(dir.join(name), value).map_err(|e| e.to_string())?;
                }
                let output = tokio::time::timeout(
                    Duration::from_secs(30),
                    Command::new("git")
                        .current_dir(&dir)
                        .args([
                            "merge-file",
                            "--diff3",
                            "-p",
                            "-L",
                            "Kunde",
                            "-L",
                            "Basis",
                            "-L",
                            "Produkt",
                            "customer",
                            "base",
                            "product",
                        ])
                        .stdin(Stdio::null())
                        .kill_on_drop(true)
                        .output(),
                )
                .await
                .map_err(|_| "Merge-Zeitlimit erreicht")?
                .map_err(|e| e.to_string())?;
                let code = output.status.code().ok_or("Merge wurde abgebrochen")?;
                if !(0..=127).contains(&code) {
                    return Err(String::from_utf8_lossy(&output.stderr).into_owned());
                }
                let content = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
                Ok(json!({"content":content,"conflicts":code != 0}))
            }
            .await;
            let _ = fs::remove_dir_all(dir);
            result
        }
        "local-read" | "local-write" => {
            let common = PathBuf::from(
                git(
                    &root,
                    &["rev-parse", "--path-format=absolute", "--git-common-dir"],
                )
                .await?
                .trim(),
            );
            let file = common.join("l8db-targets.json");
            if request.action == "local-read" {
                return Ok(json!(read(&file)?));
            }
            let content = request.content.ok_or("Inhalt fehlt")?;
            serde_json::from_str::<Value>(&content).map_err(|e| e.to_string())?;
            write(&file, &content, request.expected.as_deref())?;
            Ok(Value::Null)
        }
        _ => Err("Unbekannte Versionierungsaktion".into()),
    }
}

#[tauri::command]
pub async fn versioning_repository(request: Request) -> Result<Value, String> {
    handle(request).await
}

#[tauri::command]
pub async fn versioning_oracle_timeout(
    tx_id: String,
    milliseconds: u64,
    state: tauri::State<'_, crate::db::transaction::TransactionState>,
) -> Result<(), String> {
    state.versioning_oracle_timeout(&tx_id, milliseconds).await
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod browser_tests;
