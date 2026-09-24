use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use super::provider::DatabaseKind;

#[derive(Debug, Clone, Serialize)]
pub struct ToolCandidate {
    pub path: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolInfo {
    pub name: &'static str,
    pub path: Option<String>,
    pub version: Option<String>,
    pub major: Option<u32>,
    pub banner: Option<String>,
    pub custom: bool,
    pub candidates: Vec<ToolCandidate>,
    pub error: Option<String>,
}

impl ToolInfo {
    pub fn is_mariadb(&self) -> bool {
        self.banner
            .as_deref()
            .is_some_and(|banner| banner.to_lowercase().contains("mariadb"))
            || self
                .path
                .as_deref()
                .and_then(|path| Path::new(path).file_stem())
                .is_some_and(|stem| stem.to_string_lossy().starts_with("mariadb"))
    }
}

pub fn tool_names(kind: DatabaseKind) -> &'static [&'static str] {
    match kind {
        DatabaseKind::Postgres => &["pg_dump", "pg_restore", "psql", "pg_dumpall"],
        DatabaseKind::Mysql => &["mysqldump", "mysql"],
        DatabaseKind::Mongodb => &["mongodump", "mongorestore"],
        _ => &[],
    }
}

fn binary_names(tool: &str) -> &[&str] {
    match tool {
        "mysqldump" => &["mysqldump", "mariadb-dump"],
        "mysql" => &["mysql", "mariadb"],
        "pg_dump" => &["pg_dump"],
        "pg_restore" => &["pg_restore"],
        "psql" => &["psql"],
        "pg_dumpall" => &["pg_dumpall"],
        "mongodump" => &["mongodump"],
        "mongorestore" => &["mongorestore"],
        _ => &[],
    }
}

pub fn install_hint(kind: DatabaseKind) -> Option<&'static str> {
    let hint = match (kind, std::env::consts::OS) {
        (DatabaseKind::Postgres, "macos") => "brew install libpq (oder Postgres.app)",
        (DatabaseKind::Postgres, "windows") => {
            "PostgreSQL-Installer von postgresql.org (Command Line Tools)"
        }
        (DatabaseKind::Postgres, _) => "sudo apt install postgresql-client",
        (DatabaseKind::Mysql, "macos") => "brew install mysql-client (oder mariadb)",
        (DatabaseKind::Mysql, "windows") => "MySQL Installer oder MariaDB MSI",
        (DatabaseKind::Mysql, _) => "sudo apt install default-mysql-client",
        (DatabaseKind::Mongodb, "macos") => "brew install mongodb/brew/mongodb-database-tools",
        (DatabaseKind::Mongodb, "windows") => "MongoDB Database Tools (MSI) von mongodb.com",
        (DatabaseKind::Mongodb, _) => "MongoDB Database Tools von mongodb.com",
        _ => return None,
    };
    Some(hint)
}

#[cfg(windows)]
const SEARCH_PATTERNS: &[&str] = &[
    r"C:\Program Files\PostgreSQL\*\bin",
    r"C:\Program Files\MySQL\MySQL Server *\bin",
    r"C:\Program Files\MariaDB *\bin",
    r"C:\Program Files\MongoDB\Tools\*\bin",
    r"C:\Program Files\MongoDB\Server\*\bin",
];

#[cfg(not(windows))]
const SEARCH_PATTERNS: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/homebrew/opt/libpq/bin",
    "/usr/local/opt/libpq/bin",
    "/opt/homebrew/opt/postgresql@*/bin",
    "/usr/local/opt/postgresql@*/bin",
    "/opt/homebrew/opt/mysql-client*/bin",
    "/usr/local/opt/mysql-client*/bin",
    "/opt/homebrew/opt/mariadb*/bin",
    "/usr/local/opt/mariadb*/bin",
    "/opt/homebrew/opt/mongodb-database-tools/bin",
    "/Applications/Postgres.app/Contents/Versions/*/bin",
    "/usr/lib/postgresql/*/bin",
    "/usr/pgsql-*/bin",
    "/usr/local/pgsql/bin",
    "/usr/local/mysql/bin",
    "/usr/bin",
];

fn version_key(text: &str) -> Vec<u64> {
    text.split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect()
}

fn glob_match(pattern: &str, name: &str) -> bool {
    match pattern.split_once('*') {
        Some((prefix, suffix)) => {
            name.len() >= prefix.len() + suffix.len()
                && name.starts_with(prefix)
                && name.ends_with(suffix)
        }
        None => pattern == name,
    }
}

pub fn expand_pattern(pattern: &str) -> Vec<PathBuf> {
    let mut current = vec![PathBuf::new()];
    for component in Path::new(pattern).components() {
        let part = component.as_os_str().to_string_lossy().to_string();
        if !matches!(component, Component::Normal(_)) || !part.contains('*') {
            for path in &mut current {
                path.push(component.as_os_str());
            }
            continue;
        }
        let mut next = Vec::new();
        for base in &current {
            let Ok(entries) = std::fs::read_dir(base) else {
                continue;
            };
            let mut names: Vec<String> = entries
                .filter_map(Result::ok)
                .map(|entry| entry.file_name().to_string_lossy().to_string())
                .filter(|name| glob_match(&part, name))
                .collect();
            names.sort_by_key(|name| std::cmp::Reverse(version_key(name)));
            next.extend(names.into_iter().map(|name| base.join(name)));
        }
        current = next;
    }
    current.into_iter().filter(|path| path.is_dir()).collect()
}

pub fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    for pattern in SEARCH_PATTERNS {
        dirs.extend(expand_pattern(pattern));
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|dir| !dir.as_os_str().is_empty() && seen.insert(dir.clone()));
    dirs
}

fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

pub fn find_candidates(tool: &str, dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut found = Vec::new();
    for dir in dirs {
        for name in binary_names(tool) {
            let path = dir.join(executable_name(name));
            if !path.is_file() {
                continue;
            }
            let key = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
            if seen.insert(key) {
                found.push(path);
            }
        }
    }
    found
}

fn leading_version(token: &str) -> Option<String> {
    let token = token.trim_start_matches(['v', 'V']);
    if !token.starts_with(|c: char| c.is_ascii_digit()) {
        return None;
    }
    let version: String = token
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let version = version.trim_end_matches('.').to_string();
    (!version.is_empty()).then_some(version)
}

pub fn parse_version(output: &str) -> Option<String> {
    let line = output.lines().find(|line| !line.trim().is_empty())?;
    for marker in ["Distrib ", " from "] {
        if let Some(version) = line
            .split(marker)
            .nth(1)
            .and_then(|rest| rest.split_whitespace().next())
            .and_then(leading_version)
        {
            return Some(version);
        }
    }
    line.split(|c: char| c.is_whitespace() || matches!(c, ',' | '(' | ')' | ':'))
        .find_map(leading_version)
}

fn release(version: &str) -> String {
    version.split('.').take(2).collect::<Vec<_>>().join(".")
}

pub fn major(version: &str) -> Option<u32> {
    version.split('.').next()?.parse().ok()
}

pub fn command(program: &Path) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut process = tokio::process::Command::new(program);
    #[cfg(windows)]
    process.creation_flags(0x0800_0000);
    process
}

async fn probe_version(path: &Path) -> Result<String, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        command(path)
            .arg("--version")
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Zeitüberschreitung bei --version".to_string())?
    .map_err(|e| e.to_string())?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(text
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .trim()
        .to_string())
}

fn resolve_custom(tool: &str, custom: &str) -> PathBuf {
    let path = PathBuf::from(custom.trim());
    if path.is_dir() {
        binary_names(tool)
            .iter()
            .map(|name| path.join(executable_name(name)))
            .find(|candidate| candidate.is_file())
            .unwrap_or_else(|| path.join(executable_name(tool)))
    } else {
        path
    }
}

pub async fn locate(tool: &'static str, custom: Option<&str>, dirs: &[PathBuf]) -> ToolInfo {
    let mut info = ToolInfo {
        name: tool,
        path: None,
        version: None,
        major: None,
        banner: None,
        custom: false,
        candidates: Vec::new(),
        error: None,
    };
    let custom = custom.map(str::trim).filter(|value| !value.is_empty());
    let paths = match custom {
        Some(custom) => {
            info.custom = true;
            let path = resolve_custom(tool, custom);
            if !path.is_file() {
                info.error = Some(format!("Eigener Pfad nicht gefunden: {}", path.display()));
                return info;
            }
            vec![path]
        }
        None => find_candidates(tool, dirs),
    };
    let mut best: Option<(Vec<u64>, PathBuf, String, Option<String>)> = None;
    for path in paths {
        let banner = probe_version(&path).await;
        let version = banner.as_deref().ok().and_then(parse_version);
        info.candidates.push(ToolCandidate {
            path: path.display().to_string(),
            version: version.clone(),
        });
        let Ok(banner) = banner else {
            if info.custom {
                info.error = Some(format!(
                    "{} konnte nicht ausgeführt werden: {}",
                    path.display(),
                    banner.unwrap_err()
                ));
            }
            continue;
        };
        let key = version.as_deref().map(version_key).unwrap_or_default();
        if best.as_ref().is_none_or(|(current, ..)| key > *current) {
            best = Some((key, path, banner, version));
        }
    }
    if let Some((_, path, banner, version)) = best {
        info.major = version.as_deref().and_then(major);
        info.path = Some(path.display().to_string());
        info.banner = Some(banner);
        info.version = version;
    }
    info
}

pub async fn locate_all(kind: DatabaseKind, custom: &HashMap<String, String>) -> Vec<ToolInfo> {
    let dirs = search_dirs();
    let mut tools = Vec::new();
    for tool in tool_names(kind) {
        tools.push(locate(tool, custom.get(*tool).map(String::as_str), &dirs).await);
    }
    tools
}

pub async fn locate_one(
    tool: &'static str,
    custom: &HashMap<String, String>,
) -> Result<ToolInfo, String> {
    let info = locate(tool, custom.get(tool).map(String::as_str), &search_dirs()).await;
    if info.path.is_some() {
        return Ok(info);
    }
    Err(info.error.unwrap_or_else(|| {
        format!("{tool} wurde nicht gefunden. Werkzeug installieren oder Pfad in den Sicherungs-Werkzeugen setzen.")
    }))
}

pub fn version_warnings(
    kind: DatabaseKind,
    tools: &[ToolInfo],
    server_version: Option<&str>,
) -> Vec<String> {
    let Some(server) = server_version else {
        return Vec::new();
    };
    let server_major = server
        .split_whitespace()
        .next()
        .and_then(leading_version)
        .as_deref()
        .and_then(major);
    let mut warnings = Vec::new();
    match kind {
        DatabaseKind::Postgres => {
            let Some(server_major) = server_major else {
                return warnings;
            };
            for tool in tools {
                if !matches!(tool.name, "pg_dump" | "pg_dumpall" | "pg_restore") {
                    continue;
                }
                if let Some(tool_major) = tool.major.filter(|major| *major < server_major) {
                    warnings.push(format!(
                        "{} {tool_major} ist älter als der Server ({server_major}). {} muss mindestens Version {server_major} haben.",
                        tool.name, tool.name
                    ));
                }
            }
        }
        DatabaseKind::Mysql => {
            let server_maria = server.to_lowercase().contains("mariadb");
            for tool in tools.iter().filter(|tool| tool.path.is_some()) {
                let tool_maria = tool.is_mariadb();
                if tool_maria != server_maria {
                    warnings.push(format!(
                        "{} stammt von {}, der Server ist {}. Einzelne Optionen können abweichen.",
                        tool.name,
                        if tool_maria { "MariaDB" } else { "MySQL" },
                        if server_maria { "MariaDB" } else { "MySQL" }
                    ));
                } else if !server_maria {
                    let tool_release = tool.version.as_deref().map(release);
                    let server_release = server
                        .split_whitespace()
                        .next()
                        .and_then(leading_version)
                        .map(|version| release(&version));
                    if let (Some(tool_release), Some(server_release)) =
                        (tool_release, server_release)
                    {
                        if tool_release != server_release {
                            warnings.push(format!(
                                "{} {tool_release} weicht von der Serverversion {server_release} ab.",
                                tool.name
                            ));
                        }
                    }
                }
            }
        }
        _ => {}
    }
    warnings
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(name: &'static str, version: &str, banner: &str) -> ToolInfo {
        ToolInfo {
            name,
            path: Some(format!("/usr/bin/{name}")),
            version: Some(version.into()),
            major: major(version),
            banner: Some(banner.into()),
            custom: false,
            candidates: Vec::new(),
            error: None,
        }
    }

    #[test]
    fn parses_tool_versions() {
        assert_eq!(
            parse_version("pg_dump (PostgreSQL) 18.0").as_deref(),
            Some("18.0")
        );
        assert_eq!(
            parse_version("pg_dump (PostgreSQL) 16.4 (Homebrew)").as_deref(),
            Some("16.4")
        );
        assert_eq!(
            parse_version("pg_dump (PostgreSQL) 18beta1").as_deref(),
            Some("18")
        );
        assert_eq!(
            parse_version(
                "mysqldump  Ver 8.4.2 for Linux on x86_64 (MySQL Community Server - GPL)"
            )
            .as_deref(),
            Some("8.4.2")
        );
        assert_eq!(
            parse_version("mysqldump  Ver 10.19 Distrib 10.11.6-MariaDB, for debian-linux-gnu")
                .as_deref(),
            Some("10.11.6")
        );
        assert_eq!(
            parse_version("mariadb-dump from 11.4.2-MariaDB, client 10.19 for Linux (x86_64)")
                .as_deref(),
            Some("11.4.2")
        );
        assert_eq!(
            parse_version("\nmongodump version: 100.10.0\ngit version: abc").as_deref(),
            Some("100.10.0")
        );
        assert_eq!(parse_version("no version here"), None);
        assert_eq!(major("9.6.24"), Some(9));
    }

    #[test]
    fn matches_single_star_globs() {
        assert!(glob_match("postgresql@*", "postgresql@17"));
        assert!(glob_match("MySQL Server *", "MySQL Server 8.4"));
        assert!(!glob_match("postgresql@*", "libpq"));
        assert!(glob_match("bin", "bin"));
    }

    #[test]
    fn expands_patterns_newest_first() {
        let root = tempfile::tempdir().unwrap();
        for version in ["9.6", "16", "18"] {
            std::fs::create_dir_all(root.path().join(format!("pg-{version}/bin"))).unwrap();
        }
        std::fs::create_dir_all(root.path().join("other/bin")).unwrap();
        let pattern = root.path().join("pg-*").join("bin");
        let found = expand_pattern(&pattern.to_string_lossy());
        let names: Vec<String> = found
            .iter()
            .map(|path| {
                path.parent()
                    .unwrap()
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        assert_eq!(names, ["pg-18", "pg-16", "pg-9.6"]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn locates_newest_candidate_and_custom_paths() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let mut dirs = Vec::new();
        for version in ["16.4", "18.0"] {
            let dir = root.path().join(version);
            std::fs::create_dir_all(&dir).unwrap();
            let script = dir.join("pg_dump");
            std::fs::write(
                &script,
                format!("#!/bin/sh\necho 'pg_dump (PostgreSQL) {version}'\n"),
            )
            .unwrap();
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            dirs.push(dir);
        }
        let found = locate("pg_dump", None, &dirs).await;
        assert_eq!(found.version.as_deref(), Some("18.0"));
        assert_eq!(found.major, Some(18));
        assert_eq!(found.candidates.len(), 2);
        let custom_dir = dirs[0].to_string_lossy().to_string();
        let custom = locate("pg_dump", Some(&custom_dir), &dirs).await;
        assert!(custom.custom);
        assert_eq!(custom.version.as_deref(), Some("16.4"));
        let missing = locate("pg_dump", Some("/nonexistent/pg_dump"), &dirs).await;
        assert!(missing.path.is_none());
        assert!(missing.error.unwrap().contains("nicht gefunden"));
    }

    #[test]
    fn warns_on_old_pg_dump_and_mysql_flavor_mismatch() {
        let tools = [
            tool("pg_dump", "16.4", "pg_dump (PostgreSQL) 16.4"),
            tool("psql", "16.4", "psql (PostgreSQL) 16.4"),
            tool("pg_restore", "18.0", "pg_restore (PostgreSQL) 18.0"),
        ];
        let warnings = version_warnings(
            DatabaseKind::Postgres,
            &tools,
            Some("18.0 (Debian 18.0-1.pgdg13+3)"),
        );
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("pg_dump 16"));
        assert!(version_warnings(DatabaseKind::Postgres, &tools, Some("16.2")).is_empty());
        let mysql = [tool(
            "mysqldump",
            "8.4.2",
            "mysqldump  Ver 8.4.2 for Linux on x86_64",
        )];
        assert!(version_warnings(DatabaseKind::Mysql, &mysql, Some("8.4.6")).is_empty());
        assert_eq!(
            version_warnings(DatabaseKind::Mysql, &mysql, Some("11.4.2-MariaDB-ubu2404")).len(),
            1
        );
        assert_eq!(
            version_warnings(DatabaseKind::Mysql, &mysql, Some("8.0.40")).len(),
            1
        );
    }
}
