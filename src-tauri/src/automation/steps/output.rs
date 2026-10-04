use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::automation::model::{Cleanup, IfExists, OutputSpec, RunOutput};
use crate::automation::runtime::StepContext;

pub fn target_path(
    ctx: &StepContext<'_>,
    spec: &OutputSpec,
    extension: &str,
) -> Result<PathBuf, String> {
    let rendered = ctx.vars.render(&spec.path)?;
    let stamp = if spec.append_timestamp {
        Some(ctx.vars.render("${timestamp}")?)
    } else {
        None
    };
    let base = output_dir(ctx)?;
    plan_target(
        &rendered,
        base.as_deref(),
        extension,
        stamp.as_deref(),
        spec.if_exists,
        spec.zip,
    )
}

pub fn finish(
    ctx: &StepContext<'_>,
    spec: &OutputSpec,
    written: PathBuf,
    format: &str,
) -> Result<Vec<RunOutput>, String> {
    let extension = written
        .extension()
        .map(|ext| ext.to_string_lossy().to_string())
        .unwrap_or_default();
    let pattern = match &spec.cleanup {
        Some(_) => {
            let template = ctx.vars.render(&wildcard_template(&spec.path))?;
            let stamp = spec.append_timestamp.then_some("*");
            let name = file_name_for(Path::new(&template), &extension, stamp);
            Some(
                name.file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default(),
            )
        }
        None => None,
    };
    let path = finalize(
        &written,
        spec.zip,
        spec.cleanup.as_ref(),
        pattern.as_deref(),
    )?;
    let bytes = std::fs::metadata(&path).ok().map(|meta| meta.len());
    Ok(vec![RunOutput {
        step_id: ctx.step.id.clone(),
        path: path.display().to_string(),
        bytes,
        format: if spec.zip {
            "zip".into()
        } else {
            format.into()
        },
    }])
}

pub fn path(ctx: &StepContext<'_>, template: &str) -> Result<PathBuf, String> {
    let rendered = ctx.vars.render(template)?;
    absolute(&rendered, output_dir(ctx)?.as_deref())
}

fn output_dir(ctx: &StepContext<'_>) -> Result<Option<PathBuf>, String> {
    let dir = ctx.vars.render("${output_dir:-}")?;
    Ok(Some(dir.trim())
        .filter(|dir| !dir.is_empty())
        .map(expand_home))
}

pub fn expand_home(path: &str) -> PathBuf {
    let home = || {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .filter(|home| !home.is_empty())
            .map(PathBuf::from)
    };
    if path == "~" {
        if let Some(home) = home() {
            return home;
        }
    }
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        if let Some(home) = home() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

pub fn absolute(rendered: &str, base: Option<&Path>) -> Result<PathBuf, String> {
    let trimmed = rendered.trim();
    if trimmed.is_empty() {
        return Err("Pfad fehlt.".into());
    }
    let path = expand_home(trimmed);
    if path.is_absolute() {
        return Ok(path);
    }
    match base {
        Some(base) if base.is_absolute() => Ok(base.join(path)),
        _ => Err("Relativer Pfad ohne Standard-Ausgabeordner.".into()),
    }
}

pub fn file_name_for(path: &Path, extension: &str, stamp: Option<&str>) -> PathBuf {
    let has_extension = path.extension().is_some();
    let stem = if has_extension {
        path.file_stem()
    } else {
        path.file_name()
    }
    .map(|name| name.to_string_lossy().to_string())
    .unwrap_or_default();
    let extension = if has_extension {
        path.extension()
            .map(|ext| ext.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        extension.to_string()
    };
    let mut name = match stamp {
        Some(stamp) => format!("{stem}-{stamp}"),
        None => stem,
    };
    if !extension.is_empty() {
        name.push('.');
        name.push_str(&extension);
    }
    path.with_file_name(name)
}

pub fn plan_target(
    rendered: &str,
    base: Option<&Path>,
    extension: &str,
    stamp: Option<&str>,
    if_exists: IfExists,
    zip: bool,
) -> Result<PathBuf, String> {
    let path = file_name_for(&absolute(rendered, base)?, extension, stamp);
    if path.file_name().is_none() {
        return Err(format!("Ungültiger Dateiname: {}", path.display()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Ordner {} kann nicht angelegt werden: {e}",
                parent.display()
            )
        })?;
    }
    let taken = |candidate: &Path| {
        if zip {
            with_suffix(candidate, ".zip").exists()
        } else {
            candidate.exists()
        }
    };
    match if_exists {
        IfExists::Overwrite | IfExists::Append => Ok(path),
        IfExists::Fail if taken(&path) => Err(format!(
            "Datei existiert bereits: {}",
            if zip {
                with_suffix(&path, ".zip")
            } else {
                path.clone()
            }
            .display()
        )),
        IfExists::Fail => Ok(path),
        IfExists::Rename => {
            if !taken(&path) {
                return Ok(path);
            }
            let stem = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .unwrap_or_default();
            let extension = path
                .extension()
                .map(|ext| format!(".{}", ext.to_string_lossy()))
                .unwrap_or_default();
            (2..100_000)
                .map(|n| path.with_file_name(format!("{stem} ({n}){extension}")))
                .find(|candidate| !taken(candidate))
                .ok_or_else(|| format!("Kein freier Dateiname für {}", path.display()))
        }
    }
}

pub fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

pub fn wildcard_template(template: &str) -> String {
    let pattern = regex::Regex::new(r"\$\{(?:date|time|timestamp|now)(?:[:+\-|][^}]*)?\}")
        .expect("Platzhaltermuster");
    pattern.replace_all(template, "*").into_owned()
}

pub fn finalize(
    written: &Path,
    zip: bool,
    cleanup: Option<&Cleanup>,
    pattern: Option<&str>,
) -> Result<PathBuf, String> {
    let path = if zip {
        let target = with_suffix(written, ".zip");
        zip_files(&[written.to_path_buf()], &target)?;
        std::fs::remove_file(written)
            .map_err(|e| format!("{} kann nicht gelöscht werden: {e}", written.display()))?;
        target
    } else {
        written.to_path_buf()
    };
    if let (Some(cleanup), Some(pattern), Some(dir)) = (cleanup, pattern, path.parent()) {
        let pattern = if zip {
            format!("{pattern}.zip")
        } else {
            pattern.to_string()
        };
        cleanup_dir(dir, &pattern, cleanup, Some(&path))?;
    }
    Ok(path)
}

pub fn wildcard(pattern: &str) -> regex::Regex {
    let mut source = String::from("^");
    for ch in pattern.chars() {
        match ch {
            '*' => source.push_str(".*"),
            '?' => source.push('.'),
            other => source.push_str(&regex::escape(&other.to_string())),
        }
    }
    source.push('$');
    regex::Regex::new(&source).expect("Wildcard-Muster")
}

pub fn has_wildcard(text: &str) -> bool {
    text.contains('*') || text.contains('?')
}

pub fn cleanup_dir(
    dir: &Path,
    pattern: &str,
    cleanup: &Cleanup,
    keep: Option<&Path>,
) -> Result<u64, String> {
    let matcher = wildcard(pattern);
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Ordner {} kann nicht gelesen werden: {e}", dir.display()))?;
    let mut files: Vec<(PathBuf, SystemTime)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() || !matcher.is_match(&name) {
            continue;
        }
        if keep.is_some_and(|keep| keep == entry.path()) {
            continue;
        }
        files.push((
            entry.path(),
            meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        ));
    }
    let mut doomed: Vec<PathBuf> = Vec::new();
    if let Some(days) = cleanup.older_than_days {
        let limit = SystemTime::now()
            .checked_sub(Duration::from_secs(u64::from(days) * 86_400))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        files.retain(|(path, modified)| {
            if *modified < limit {
                doomed.push(path.clone());
                false
            } else {
                true
            }
        });
    }
    if let Some(keep_last) = cleanup.keep_last {
        files.sort_by(|a, b| b.1.cmp(&a.1));
        let slots =
            (keep_last as usize).saturating_sub(usize::from(keep.is_some_and(Path::exists)));
        doomed.extend(files.into_iter().skip(slots).map(|(path, _)| path));
    }
    for path in &doomed {
        std::fs::remove_file(path)
            .map_err(|e| format!("{} kann nicht gelöscht werden: {e}", path.display()))?;
    }
    Ok(doomed.len() as u64)
}

pub fn zip_files(sources: &[PathBuf], target: &Path) -> Result<u64, String> {
    let parent = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Datei kann nicht geschrieben werden: {e}"))?;
    let mut writer = zip::ZipWriter::new(std::io::BufWriter::new(temp));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    let mut count = 0u64;
    for source in sources {
        let root = source.parent().unwrap_or(Path::new(""));
        let mut stack = vec![source.clone()];
        while let Some(current) = stack.pop() {
            let meta = std::fs::metadata(&current)
                .map_err(|e| format!("{} kann nicht gelesen werden: {e}", current.display()))?;
            let name = current
                .strip_prefix(root)
                .unwrap_or(&current)
                .components()
                .map(|part| part.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/");
            if meta.is_dir() {
                writer
                    .add_directory(format!("{name}/"), options)
                    .map_err(zip_error)?;
                let mut children: Vec<PathBuf> = std::fs::read_dir(&current)
                    .map_err(|e| format!("{} kann nicht gelesen werden: {e}", current.display()))?
                    .flatten()
                    .map(|entry| entry.path())
                    .collect();
                children.sort();
                stack.extend(children.into_iter().rev());
                continue;
            }
            writer.start_file(name, options).map_err(zip_error)?;
            let mut file = std::fs::File::open(&current)
                .map_err(|e| format!("{} kann nicht gelesen werden: {e}", current.display()))?;
            std::io::copy(&mut file, &mut writer).map_err(|e| format!("Schreibfehler: {e}"))?;
            count += 1;
        }
    }
    let mut buffered = writer.finish().map_err(zip_error)?;
    buffered
        .flush()
        .map_err(|e| format!("Schreibfehler: {e}"))?;
    let temp = buffered
        .into_inner()
        .map_err(|e| format!("Schreibfehler: {e}"))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| format!("Schreibfehler: {e}"))?;
    temp.persist(target)
        .map_err(|e| format!("ZIP-Datei kann nicht abgelegt werden: {e}"))?;
    Ok(count)
}

pub fn zip_error(error: zip::result::ZipError) -> String {
    format!("ZIP-Fehler: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path, age_days: u64) {
        std::fs::write(path, path.display().to_string()).unwrap();
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(age_days * 86_400 + 60))
            .unwrap();
    }

    #[test]
    fn timestamp_and_extension_are_applied() {
        let dir = tempfile::tempdir().unwrap();
        let path = plan_target(
            "reports/bericht",
            Some(dir.path()),
            "csv",
            Some("20261004-073000"),
            IfExists::Overwrite,
            false,
        )
        .unwrap();
        assert_eq!(path, dir.path().join("reports/bericht-20261004-073000.csv"));
        assert!(dir.path().join("reports").is_dir());
        let kept = plan_target(
            "/tmp/x/daten.txt",
            None,
            "csv",
            None,
            IfExists::Overwrite,
            false,
        )
        .unwrap();
        assert_eq!(kept, PathBuf::from("/tmp/x/daten.txt"));
        assert_eq!(
            plan_target("relativ.csv", None, "csv", None, IfExists::Overwrite, false).unwrap_err(),
            "Relativer Pfad ohne Standard-Ausgabeordner."
        );
    }

    #[test]
    fn rename_counts_up_and_fail_rejects() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("a.csv");
        std::fs::write(&base, "x").unwrap();
        std::fs::write(dir.path().join("a (2).csv"), "x").unwrap();
        let next = plan_target(
            &base.display().to_string(),
            None,
            "csv",
            None,
            IfExists::Rename,
            false,
        )
        .unwrap();
        assert_eq!(next, dir.path().join("a (3).csv"));
        let error = plan_target(
            &base.display().to_string(),
            None,
            "csv",
            None,
            IfExists::Fail,
            false,
        )
        .unwrap_err();
        assert!(error.starts_with("Datei existiert bereits:"), "{error}");
        let free = plan_target(
            &base.display().to_string(),
            None,
            "csv",
            None,
            IfExists::Fail,
            true,
        )
        .unwrap();
        assert_eq!(free, base);
    }

    #[test]
    fn zip_replaces_original() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("daten.csv");
        std::fs::write(&file, "a,b\n1,2").unwrap();
        let zipped = finalize(&file, true, None, None).unwrap();
        assert_eq!(zipped, dir.path().join("daten.csv.zip"));
        assert!(!file.exists());
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&zipped).unwrap()).unwrap();
        assert_eq!(archive.len(), 1);
        let mut entry = archive.by_index(0).unwrap();
        assert_eq!(entry.name(), "daten.csv");
        let mut text = String::new();
        std::io::Read::read_to_string(&mut entry, &mut text).unwrap();
        assert_eq!(text, "a,b\n1,2");
    }

    #[test]
    fn cleanup_deletes_old_then_keeps_last() {
        let dir = tempfile::tempdir().unwrap();
        for (name, age) in [
            ("r-1.csv", 40),
            ("r-2.csv", 5),
            ("r-3.csv", 3),
            ("r-4.csv", 2),
            ("other.csv", 90),
        ] {
            touch(&dir.path().join(name), age);
        }
        let current = dir.path().join("r-5.csv");
        touch(&current, 0);
        let pattern = wildcard_template("r-${timestamp}.csv");
        assert_eq!(pattern, "r-*.csv");
        let deleted = cleanup_dir(
            dir.path(),
            &pattern,
            &Cleanup {
                older_than_days: Some(30),
                keep_last: Some(3),
            },
            Some(&current),
        )
        .unwrap();
        assert_eq!(deleted, 2);
        let mut left: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        left.sort();
        assert_eq!(left, ["other.csv", "r-3.csv", "r-4.csv", "r-5.csv"]);
        assert_eq!(
            wildcard_template("x-${date:%Y}-${date-1d}-${run_id}"),
            "x-*-*-${run_id}"
        );
    }

    #[test]
    fn cleanup_after_finalize_keeps_written_file() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("b-1.csv"), 3);
        touch(&dir.path().join("b-2.csv"), 2);
        let written = dir.path().join("b-3.csv");
        touch(&written, 9);
        let result = finalize(
            &written,
            false,
            Some(&Cleanup {
                older_than_days: Some(1),
                keep_last: None,
            }),
            Some("b-*.csv"),
        )
        .unwrap();
        assert_eq!(result, written);
        assert!(written.exists());
        assert!(!dir.path().join("b-1.csv").exists());
    }
}
