use std::path::{Component, Path, PathBuf};

use crate::automation::model::{Action, LogLevel};
use crate::automation::runtime::{StepContext, StepOutcome};

use super::output;

pub async fn file_copy(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::FileCopy {
        from,
        to,
        overwrite,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    transfer_step(ctx, from, to, *overwrite, false)
}

pub async fn file_move(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::FileMove {
        from,
        to,
        overwrite,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    transfer_step(ctx, from, to, *overwrite, true)
}

fn transfer_step(
    ctx: &mut StepContext<'_>,
    from: &str,
    to: &str,
    overwrite: bool,
    remove: bool,
) -> Result<StepOutcome, String> {
    let source = output::path(ctx, from)?;
    let rendered_to = ctx.vars.render(to)?;
    let target = output::path(ctx, to)?;
    let into_dir = rendered_to.trim_end().ends_with(['/', '\\']);
    let count = transfer_files(&source, &target, into_dir, overwrite, remove)?;
    Ok(StepOutcome {
        rows: Some(count),
        ..Default::default()
    })
}

pub async fn file_delete(
    ctx: &mut StepContext<'_>,
    config: &Action,
) -> Result<StepOutcome, String> {
    let Action::FileDelete { path } = config else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let path = output::path(ctx, path)?;
    let count = delete_files(&path)?;
    if count == 0 {
        (ctx.log)(
            LogLevel::Info,
            format!("Keine Datei gefunden: {}", path.display()),
        );
    }
    Ok(StepOutcome {
        rows: Some(count),
        ..Default::default()
    })
}

pub async fn mkdir(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Mkdir { path } = config else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let path = output::path(ctx, path)?;
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Ordner {} kann nicht angelegt werden: {e}", path.display()))?;
    Ok(StepOutcome::default())
}

pub async fn file_exists(
    ctx: &mut StepContext<'_>,
    config: &Action,
) -> Result<StepOutcome, String> {
    let Action::FileExists {
        path,
        fail_if_missing,
        capture,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let path = output::path(ctx, path)?;
    let found = !matches(&path, false)?.is_empty();
    if !found && *fail_if_missing {
        return Err(format!("Datei nicht gefunden: {}", path.display()));
    }
    let mut outcome = StepOutcome {
        value: Some(serde_json::Value::Bool(found)),
        ..Default::default()
    };
    if let Some(name) = capture.as_deref().filter(|name| !name.trim().is_empty()) {
        outcome
            .vars
            .insert(name.trim().to_string(), found.to_string());
    }
    Ok(outcome)
}

pub async fn zip(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Zip {
        sources,
        output: spec,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let mut files = Vec::new();
    for source in sources {
        let path = output::path(ctx, source)?;
        let found = matches(&path, false)?;
        if found.is_empty() {
            return Err(format!("Keine Datei gefunden: {}", path.display()));
        }
        files.extend(found);
    }
    let mut plain = spec.clone();
    plain.zip = false;
    let target = output::target_path(ctx, &plain, "zip")?;
    let count = output::zip_files(&files, &target)?;
    let outputs = output::finish(ctx, &plain, target, "zip")?;
    Ok(StepOutcome {
        rows: Some(count),
        outputs,
        ..Default::default()
    })
}

pub async fn unzip(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Unzip {
        archive,
        target,
        overwrite,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let archive = output::path(ctx, archive)?;
    let target = output::path(ctx, target)?;
    let count = unzip_archive(&archive, &target, *overwrite)?;
    Ok(StepOutcome {
        rows: Some(count),
        ..Default::default()
    })
}

pub async fn cleanup(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Cleanup {
        dir,
        pattern,
        cleanup,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let dir = output::path(ctx, dir)?;
    let pattern = ctx.vars.render(pattern)?;
    if pattern.contains(['/', '\\']) {
        return Err("Das Muster darf keinen Ordner enthalten.".into());
    }
    let deleted = output::cleanup_dir(&dir, &pattern, cleanup, None)?;
    Ok(StepOutcome {
        rows: Some(deleted),
        ..Default::default()
    })
}

pub fn matches(path: &Path, files_only: bool) -> Result<Vec<PathBuf>, String> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    if !output::has_wildcard(&name) {
        let keep = if files_only {
            path.is_file()
        } else {
            path.exists()
        };
        return Ok(if keep {
            vec![path.to_path_buf()]
        } else {
            Vec::new()
        });
    }
    let parent = path.parent().unwrap_or(Path::new("."));
    if output::has_wildcard(&parent.to_string_lossy()) {
        return Err("Platzhalter (* ?) sind nur im Dateinamen erlaubt.".into());
    }
    let matcher = output::wildcard(&name);
    let entries = match std::fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(format!(
                "Ordner {} kann nicht gelesen werden: {e}",
                parent.display()
            ))
        }
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| matcher.is_match(&entry.file_name().to_string_lossy()))
        .filter(|entry| !files_only || entry.path().is_file())
        .map(|entry| entry.path())
        .collect();
    found.sort();
    Ok(found)
}

pub fn transfer_files(
    source: &Path,
    target: &Path,
    into_dir: bool,
    overwrite: bool,
    remove: bool,
) -> Result<u64, String> {
    let sources = matches(source, true)?;
    if sources.is_empty() {
        return Err(format!("Keine Datei gefunden: {}", source.display()));
    }
    let into_dir = into_dir || sources.len() > 1 || target.is_dir();
    let plan: Vec<(PathBuf, PathBuf)> = sources
        .into_iter()
        .map(|from| {
            let to = if into_dir {
                target.join(from.file_name().unwrap_or_default())
            } else {
                target.to_path_buf()
            };
            (from, to)
        })
        .collect();
    for (from, to) in &plan {
        if to.exists() && !overwrite {
            return Err(format!("Ziel existiert bereits: {}", to.display()));
        }
        if same_file(from, to) {
            return Err(format!("Quelle und Ziel sind identisch: {}", to.display()));
        }
    }
    let dir = if into_dir {
        Some(target)
    } else {
        target.parent()
    };
    if let Some(dir) = dir.filter(|dir| !dir.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Ordner {} kann nicht angelegt werden: {e}", dir.display()))?;
    }
    for (from, to) in &plan {
        let failure = |e: std::io::Error| format!("{} → {}: {e}", from.display(), to.display());
        if remove {
            match std::fs::rename(from, to) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::CrossesDevices => {
                    std::fs::copy(from, to).map_err(failure)?;
                    std::fs::remove_file(from).map_err(failure)?;
                }
                Err(e) => return Err(failure(e)),
            }
        } else {
            std::fs::copy(from, to).map_err(failure)?;
        }
    }
    Ok(plan.len() as u64)
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

pub fn delete_files(path: &Path) -> Result<u64, String> {
    let files = matches(path, true)?;
    for file in &files {
        std::fs::remove_file(file)
            .map_err(|e| format!("{} kann nicht gelöscht werden: {e}", file.display()))?;
    }
    Ok(files.len() as u64)
}

pub fn safe_entry_path(name: &str) -> Option<PathBuf> {
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains(':') {
        return None;
    }
    let path = PathBuf::from(&normalized);
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!clean.as_os_str().is_empty()).then_some(clean)
}

pub fn unzip_archive(archive: &Path, target: &Path, overwrite: bool) -> Result<u64, String> {
    let file = std::fs::File::open(archive)
        .map_err(|e| format!("{} kann nicht gelesen werden: {e}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(file).map_err(output::zip_error)?;
    let mut plan = Vec::with_capacity(zip.len());
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(output::zip_error)?;
        let relative = safe_entry_path(entry.name())
            .filter(|_| entry.enclosed_name().is_some())
            .ok_or_else(|| format!("Unsicherer Pfad im Archiv abgelehnt: {}", entry.name()))?;
        let destination = target.join(relative);
        if !entry.is_dir() && destination.exists() && !overwrite {
            return Err(format!("Ziel existiert bereits: {}", destination.display()));
        }
        plan.push((index, destination, entry.is_dir()));
    }
    std::fs::create_dir_all(target).map_err(|e| {
        format!(
            "Ordner {} kann nicht angelegt werden: {e}",
            target.display()
        )
    })?;
    let mut count = 0u64;
    for (index, destination, is_dir) in plan {
        if is_dir {
            std::fs::create_dir_all(&destination).map_err(|e| {
                format!(
                    "Ordner {} kann nicht angelegt werden: {e}",
                    destination.display()
                )
            })?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Ordner {} kann nicht angelegt werden: {e}",
                    parent.display()
                )
            })?;
        }
        if destination.is_symlink() {
            std::fs::remove_file(&destination)
                .map_err(|e| format!("{} kann nicht ersetzt werden: {e}", destination.display()))?;
        }
        let mut entry = zip.by_index(index).map_err(output::zip_error)?;
        let mut out = std::fs::File::create(&destination).map_err(|e| {
            format!(
                "{} kann nicht geschrieben werden: {e}",
                destination.display()
            )
        })?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("{} kann nicht entpackt werden: {e}", destination.display()))?;
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn wildcards_copy_into_directory() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("in/a.csv"), "a");
        write(&dir.path().join("in/b.csv"), "b");
        write(&dir.path().join("in/c.txt"), "c");
        std::fs::create_dir_all(dir.path().join("in/sub.csv")).unwrap();
        let count = transfer_files(
            &dir.path().join("in/*.csv"),
            &dir.path().join("out"),
            false,
            false,
            false,
        )
        .unwrap();
        assert_eq!(count, 2);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("out/b.csv")).unwrap(),
            "b"
        );
        assert!(!dir.path().join("out/c.txt").exists());
        assert_eq!(
            matches(&dir.path().join("in/?.csv"), true).unwrap(),
            vec![dir.path().join("in/a.csv"), dir.path().join("in/b.csv")]
        );
        assert!(matches(&dir.path().join("*/?.csv"), true).is_err());
        let single = transfer_files(
            &dir.path().join("in/c.txt"),
            &dir.path().join("renamed/neu.txt"),
            false,
            false,
            false,
        )
        .unwrap();
        assert_eq!(single, 1);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("renamed/neu.txt")).unwrap(),
            "c"
        );
        assert!(transfer_files(
            &dir.path().join("in/missing*.csv"),
            &dir.path().join("out"),
            false,
            false,
            false
        )
        .unwrap_err()
        .starts_with("Keine Datei gefunden"));
    }

    #[test]
    fn overwrite_and_move() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("a.txt"), "neu");
        write(&dir.path().join("t/a.txt"), "alt");
        let error = transfer_files(
            &dir.path().join("a.txt"),
            &dir.path().join("t/"),
            true,
            false,
            true,
        )
        .unwrap_err();
        assert!(error.starts_with("Ziel existiert bereits"), "{error}");
        assert!(dir.path().join("a.txt").exists());
        transfer_files(
            &dir.path().join("a.txt"),
            &dir.path().join("t/"),
            true,
            true,
            true,
        )
        .unwrap();
        assert!(!dir.path().join("a.txt").exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("t/a.txt")).unwrap(),
            "neu"
        );
        assert!(transfer_files(
            &dir.path().join("t/a.txt"),
            &dir.path().join("t/a.txt"),
            false,
            true,
            false
        )
        .is_err());
    }

    #[test]
    fn delete_only_files_and_zero_matches_ok() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("x.log"), "1");
        write(&dir.path().join("y.log"), "2");
        std::fs::create_dir_all(dir.path().join("z.log")).unwrap();
        assert_eq!(delete_files(&dir.path().join("*.log")).unwrap(), 2);
        assert!(dir.path().join("z.log").is_dir());
        assert_eq!(delete_files(&dir.path().join("*.log")).unwrap(), 0);
    }

    #[test]
    fn zip_roundtrip_with_directory() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("src/a.txt"), "A");
        write(&dir.path().join("src/nested/b.txt"), "B");
        write(&dir.path().join("c.txt"), "C");
        let archive = dir.path().join("out.zip");
        let count = output::zip_files(
            &[dir.path().join("src"), dir.path().join("c.txt")],
            &archive,
        )
        .unwrap();
        assert_eq!(count, 3);
        let target = dir.path().join("restored");
        assert_eq!(unzip_archive(&archive, &target, false).unwrap(), 3);
        assert_eq!(
            std::fs::read_to_string(target.join("src/nested/b.txt")).unwrap(),
            "B"
        );
        assert_eq!(std::fs::read_to_string(target.join("c.txt")).unwrap(), "C");
        let again = unzip_archive(&archive, &target, false).unwrap_err();
        assert!(again.starts_with("Ziel existiert bereits"), "{again}");
        assert_eq!(unzip_archive(&archive, &target, true).unwrap(), 3);
    }

    fn evil_zip(path: &Path, name: &str) {
        let file = std::fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        writer.start_file("ok.txt", options).unwrap();
        writer.write_all(b"ok").unwrap();
        writer.start_file(name, options).unwrap();
        writer.write_all(b"evil").unwrap();
        writer.finish().unwrap();
    }

    #[test]
    fn zip_slip_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "../evil.txt",
            "a/../../evil.txt",
            "/tmp/evil.txt",
            "..\\evil.txt",
            "C:\\evil.txt",
        ] {
            let archive = dir.path().join("evil.zip");
            evil_zip(&archive, name);
            let target = dir.path().join("t");
            let error = unzip_archive(&archive, &target, true).unwrap_err();
            assert!(
                error.starts_with("Unsicherer Pfad im Archiv"),
                "{name}: {error}"
            );
            assert!(!target.join("ok.txt").exists(), "{name}");
            assert!(!dir.path().join("evil.txt").exists());
        }
        assert_eq!(safe_entry_path("./a/b.txt"), Some(PathBuf::from("a/b.txt")));
        assert_eq!(safe_entry_path("a/../b.txt"), None);
    }

    #[test]
    fn cleanup_order_old_first_then_keep_last() {
        let dir = tempfile::tempdir().unwrap();
        let now = std::time::SystemTime::now();
        for (name, hours) in [
            ("d1.bak", 100),
            ("d2.bak", 30),
            ("d3.bak", 20),
            ("d4.bak", 10),
            ("d5.bak", 1),
        ] {
            let path = dir.path().join(name);
            write(&path, name);
            std::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(now - std::time::Duration::from_secs(hours * 3600))
                .unwrap();
        }
        let deleted = output::cleanup_dir(
            dir.path(),
            "d*.bak",
            &crate::automation::model::Cleanup {
                older_than_days: Some(2),
                keep_last: Some(2),
            },
            None,
        )
        .unwrap();
        assert_eq!(deleted, 3);
        assert!(dir.path().join("d4.bak").exists());
        assert!(dir.path().join("d5.bak").exists());
        assert!(!dir.path().join("d3.bak").exists());
    }
}
