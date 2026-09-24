use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};

use super::backup_tools::{self, ToolInfo};
use super::pool::PoolState;
use super::provider::DatabaseKind;
use super::SslMode;

pub type Emit = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;
pub type EnvVars = Vec<(String, String)>;

const CANCELLED: &str = "Vorgang vom Benutzer abgebrochen.";
const TAIL_LINES: usize = 60;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupOptions {
    pub format: String,
    pub content: String,
    pub include_schemas: Vec<String>,
    pub exclude_schemas: Vec<String>,
    pub include_tables: Vec<String>,
    pub exclude_tables: Vec<String>,
    pub clean: bool,
    pub if_exists: bool,
    pub no_owner: bool,
    pub no_privileges: bool,
    pub jobs: Option<u32>,
    pub single_transaction: bool,
    pub routines: bool,
    pub triggers: bool,
    pub events: bool,
    pub gzip: bool,
    pub copy_only: bool,
    pub compression: bool,
    pub exit_on_error: bool,
    pub drop: bool,
    pub replace: bool,
    pub close_connections: bool,
    pub source_database: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRequest {
    pub path: String,
    #[serde(default)]
    pub options: BackupOptions,
    #[serde(default)]
    pub tool_paths: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOutcome {
    pub path: String,
    pub format: String,
    pub command: String,
    pub bytes: Option<u64>,
    pub duration_ms: u64,
    pub log_tail: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupProbe {
    pub tools: Vec<ToolInfo>,
    pub server_version: Option<String>,
    pub warnings: Vec<String>,
    pub install_hint: Option<&'static str>,
    pub search_dirs: Vec<String>,
}

pub struct Invocation {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub stdin_file: Option<PathBuf>,
    pub secrets: Vec<String>,
}

impl Invocation {
    fn display(&self) -> String {
        std::iter::once(self.program.display().to_string())
            .chain(self.args.iter().map(|arg| {
                if arg.contains(char::is_whitespace) {
                    format!("\"{arg}\"")
                } else {
                    arg.clone()
                }
            }))
            .chain(
                self.stdin_file
                    .iter()
                    .map(|path| format!("< \"{}\"", path.display())),
            )
            .collect::<Vec<_>>()
            .join(" ")
    }
}

fn decode(value: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", value.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| value.to_string())
}

fn clean_list(values: &[String]) -> impl Iterator<Item = &str> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
}

fn plain_name(value: &str, label: &str) -> Result<(), String> {
    if value.starts_with('-') {
        return Err(format!("{label} darf nicht mit '-' beginnen: {value}"));
    }
    Ok(())
}

pub fn pg_env(
    connection_string: &str,
    database: Option<&str>,
) -> Result<(EnvVars, Vec<String>), String> {
    let (config, ssl) = super::connection::parse_connection(connection_string, database)?;
    let mut env = Vec::new();
    let mut secrets = Vec::new();
    if let Some(host) = config.get_hosts().first() {
        let host = match host {
            tokio_postgres::config::Host::Tcp(host) => host.clone(),
            #[cfg(unix)]
            tokio_postgres::config::Host::Unix(path) => path.display().to_string(),
        };
        env.push(("PGHOST".into(), host));
    }
    env.push((
        "PGPORT".into(),
        config
            .get_ports()
            .first()
            .copied()
            .unwrap_or(5432)
            .to_string(),
    ));
    if let Some(user) = config.get_user() {
        env.push(("PGUSER".into(), user.to_string()));
    }
    if let Some(password) = config.get_password() {
        let password = String::from_utf8_lossy(password).to_string();
        if !password.is_empty() {
            secrets.push(password.clone());
            env.push(("PGPASSWORD".into(), password));
        }
    }
    if let Some(dbname) = config.get_dbname() {
        env.push(("PGDATABASE".into(), dbname.to_string()));
    }
    if let Some(options) = config
        .get_options()
        .filter(|value| !value.trim().is_empty())
    {
        env.push(("PGOPTIONS".into(), options.to_string()));
    }
    env.push(("PGSSLMODE".into(), ssl.as_url_param().to_string()));
    env.push(("PGAPPNAME".into(), "l8db".into()));
    env.push(("PGCONNECT_TIMEOUT".into(), "15".into()));
    Ok((env, secrets))
}

pub fn pg_dump_args(options: &BackupOptions, path: &str) -> Result<Vec<String>, String> {
    let format = match options.format.as_str() {
        "" | "plain" => "p",
        "custom" => "c",
        "directory" => "d",
        "tar" => "t",
        other => return Err(format!("Unbekanntes pg_dump-Format: {other}")),
    };
    let mut args = vec![
        "--verbose".to_string(),
        format!("--format={format}"),
        format!("--file={path}"),
    ];
    if format == "d" {
        if let Some(jobs) = options.jobs.filter(|jobs| *jobs > 1) {
            args.push(format!("--jobs={}", jobs.min(64)));
        }
    }
    match options.content.as_str() {
        "schema" => args.push("--schema-only".into()),
        "data" => args.push("--data-only".into()),
        _ => {}
    }
    args.extend(clean_list(&options.include_schemas).map(|s| format!("--schema={s}")));
    args.extend(clean_list(&options.exclude_schemas).map(|s| format!("--exclude-schema={s}")));
    args.extend(clean_list(&options.include_tables).map(|t| format!("--table={t}")));
    args.extend(clean_list(&options.exclude_tables).map(|t| format!("--exclude-table={t}")));
    if options.clean && format == "p" {
        args.push("--clean".into());
        if options.if_exists {
            args.push("--if-exists".into());
        }
    }
    if options.no_owner {
        args.push("--no-owner".into());
    }
    if options.no_privileges {
        args.push("--no-privileges".into());
    }
    Ok(args)
}

pub fn detect_pg_format(path: &Path) -> Result<&'static str, String> {
    if path.is_dir() {
        return if path.join("toc.dat").is_file() {
            Ok("directory")
        } else {
            Err("Das Verzeichnis enthält keine pg_dump-Sicherung (toc.dat fehlt).".into())
        };
    }
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Sicherung konnte nicht geöffnet werden: {e}"))?;
    let mut head = [0u8; 512];
    let mut read = 0;
    while read < head.len() {
        match std::io::Read::read(&mut file, &mut head[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(e) => return Err(e.to_string()),
        }
    }
    let head = &head[..read];
    if head.starts_with(b"PGDMP") {
        Ok("custom")
    } else if head.len() >= 262 && &head[257..262] == b"ustar" {
        Ok("tar")
    } else if head.starts_with(&[0x1f, 0x8b]) {
        Err("Gzip-komprimierte SQL-Dateien vor der Wiederherstellung entpacken.".into())
    } else {
        Ok("plain")
    }
}

pub fn pg_restore_args(
    options: &BackupOptions,
    format: &str,
    database: &str,
    path: &str,
) -> Vec<String> {
    let mut args = vec!["--verbose".to_string(), format!("--dbname={database}")];
    args.push(
        match format {
            "directory" => "--format=d",
            "tar" => "--format=t",
            _ => "--format=c",
        }
        .into(),
    );
    match options.content.as_str() {
        "schema" => args.push("--schema-only".into()),
        "data" => args.push("--data-only".into()),
        _ => {}
    }
    if options.clean {
        args.push("--clean".into());
        if options.if_exists {
            args.push("--if-exists".into());
        }
    }
    if options.no_owner {
        args.push("--no-owner".into());
    }
    if options.no_privileges {
        args.push("--no-privileges".into());
    }
    if options.single_transaction {
        args.push("--single-transaction".into());
    } else if let Some(jobs) = options.jobs.filter(|jobs| *jobs > 1 && format != "tar") {
        args.push(format!("--jobs={}", jobs.min(64)));
    }
    if options.exit_on_error {
        args.push("--exit-on-error".into());
    }
    args.push(path.into());
    args
}

pub fn psql_args(options: &BackupOptions, database: &str, path: &str) -> Vec<String> {
    let mut args = vec![
        "--no-psqlrc".to_string(),
        format!("--dbname={database}"),
        format!("--file={path}"),
    ];
    if options.exit_on_error || options.single_transaction {
        args.push("--set=ON_ERROR_STOP=1".into());
    }
    if options.single_transaction {
        args.push("--single-transaction".into());
    }
    args
}

#[derive(Debug, Clone)]
pub struct MysqlTarget {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: Option<String>,
    pub ssl: Option<SslMode>,
}

pub fn mysql_target(
    connection_string: &str,
    database: Option<&str>,
) -> Result<MysqlTarget, String> {
    let url =
        url::Url::parse(connection_string.trim()).map_err(|_| "Ungültige MySQL-URL".to_string())?;
    if !matches!(url.scheme(), "mysql" | "mariadb") {
        return Err("Eine mysql:// URL ist erforderlich".into());
    }
    let mut ssl = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "sslmode" => {
                ssl = Some(
                    serde_json::from_value(serde_json::Value::String(value.into_owned()))
                        .map_err(|_| "Ungültiger SSL-Modus".to_string())?,
                )
            }
            "ssl-mode" | "ssl_mode" => {
                ssl = Some(match value.to_lowercase().as_str() {
                    "disabled" => SslMode::Disable,
                    "preferred" => SslMode::Prefer,
                    "required" => SslMode::Require,
                    "verify_ca" => SslMode::VerifyCa,
                    "verify_identity" => SslMode::VerifyFull,
                    _ => return Err("Ungültiger SSL-Modus".into()),
                })
            }
            _ => {}
        }
    }
    let path_db = decode(url.path().trim_start_matches('/'));
    Ok(MysqlTarget {
        host: url
            .host_str()
            .unwrap_or("127.0.0.1")
            .trim_matches(['[', ']'])
            .to_string(),
        port: url.port().unwrap_or(3306),
        user: decode(url.username()),
        password: url.password().map(decode).unwrap_or_default(),
        database: database
            .filter(|db| !db.is_empty())
            .map(str::to_string)
            .or_else(|| (!path_db.is_empty()).then_some(path_db)),
        ssl,
    })
}

pub fn mysql_option_file(password: &str) -> String {
    let escaped = password
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t");
    let quoted = if !escaped.contains('"') {
        format!("\"{escaped}\"")
    } else if !escaped.contains('\'') {
        format!("'{escaped}'")
    } else {
        format!("\"{}\"", escaped.replace('"', "\\\""))
    };
    format!("[client]\npassword={quoted}\n")
}

pub fn mysql_connection_args(
    target: &MysqlTarget,
    mariadb: bool,
    option_file: Option<&Path>,
) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(file) = option_file {
        args.push(format!("--defaults-extra-file={}", file.display()));
    }
    args.push(format!("--host={}", target.host));
    args.push(format!("--port={}", target.port));
    if !target.user.is_empty() {
        args.push(format!("--user={}", target.user));
    }
    args.push("--protocol=TCP".into());
    if let Some(ssl) = target.ssl {
        if mariadb {
            match ssl {
                SslMode::Disable => args.push("--skip-ssl".into()),
                SslMode::Prefer => {}
                SslMode::Require => {
                    args.push("--ssl".into());
                    args.push("--skip-ssl-verify-server-cert".into());
                }
                SslMode::VerifyCa | SslMode::VerifyFull => {
                    args.push("--ssl".into());
                    args.push("--ssl-verify-server-cert".into());
                }
            }
        } else {
            args.push(format!(
                "--ssl-mode={}",
                match ssl {
                    SslMode::Disable => "DISABLED",
                    SslMode::Prefer => "PREFERRED",
                    SslMode::Require => "REQUIRED",
                    SslMode::VerifyCa => "VERIFY_CA",
                    SslMode::VerifyFull => "VERIFY_IDENTITY",
                }
            ));
        }
    }
    args
}

pub fn mysqldump_args(
    options: &BackupOptions,
    database: &str,
    mariadb: bool,
    path: &str,
) -> Result<Vec<String>, String> {
    plain_name(database, "Datenbankname")?;
    let mut args = vec!["--verbose".to_string(), format!("--result-file={path}")];
    if options.single_transaction {
        args.push("--single-transaction".into());
    }
    if options.routines {
        args.push("--routines".into());
    }
    args.push(
        if options.triggers {
            "--triggers"
        } else {
            "--skip-triggers"
        }
        .into(),
    );
    if options.events {
        args.push("--events".into());
    }
    match options.content.as_str() {
        "schema" => args.push("--no-data".into()),
        "data" => args.push("--no-create-info".into()),
        _ => {}
    }
    if !mariadb {
        args.push("--set-gtid-purged=OFF".into());
    }
    for table in clean_list(&options.exclude_tables) {
        args.push(format!("--ignore-table={database}.{table}"));
    }
    args.push(database.to_string());
    for table in clean_list(&options.include_tables) {
        plain_name(table, "Tabellenname")?;
        args.push(table.to_string());
    }
    Ok(args)
}

pub fn mongo_uri_for_database(uri: &str, database: Option<&str>) -> Result<String, String> {
    let Some(database) = database.filter(|db| !db.is_empty()) else {
        return Ok(uri.to_string());
    };
    let mut url = url::Url::parse(uri.trim()).map_err(|_| "Ungültige MongoDB-URL".to_string())?;
    let original = decode(url.path().trim_start_matches('/'));
    if original == database {
        return Ok(url.to_string());
    }
    let has_auth_source = url
        .query_pairs()
        .any(|(key, _)| key.eq_ignore_ascii_case("authSource"));
    let has_credentials = !url.username().is_empty();
    let encoded: String = url::form_urlencoded::byte_serialize(database.as_bytes()).collect();
    url.set_path(&format!("/{}", encoded.replace('+', "%20")));
    if has_credentials && !has_auth_source {
        let source = if original.is_empty() {
            "admin".to_string()
        } else {
            original
        };
        url.query_pairs_mut().append_pair("authSource", &source);
    }
    Ok(url.to_string())
}

pub fn mongo_config(uri: &str) -> String {
    format!(
        "uri: {}\n",
        serde_json::to_string(uri).unwrap_or_else(|_| "\"\"".into())
    )
}

pub fn mongodump_args(
    options: &BackupOptions,
    config: &Path,
    path: &str,
) -> Result<Vec<String>, String> {
    let mut args = vec![
        format!("--config={}", config.display()),
        format!("--archive={path}"),
    ];
    if options.gzip {
        args.push("--gzip".into());
    }
    let include: Vec<&str> = clean_list(&options.include_tables).collect();
    match include.as_slice() {
        [] => {}
        [collection] => args.push(format!("--collection={collection}")),
        _ => return Err("mongodump unterstützt nur eine einzelne Collection oder alle.".into()),
    }
    args.extend(clean_list(&options.exclude_tables).map(|c| format!("--excludeCollection={c}")));
    Ok(args)
}

pub fn mongorestore_args(
    options: &BackupOptions,
    config: &Path,
    database: Option<&str>,
    path: &str,
) -> Vec<String> {
    let mut args = vec![
        format!("--config={}", config.display()),
        format!("--archive={path}"),
    ];
    if options.gzip {
        args.push("--gzip".into());
    }
    if options.drop {
        args.push("--drop".into());
    }
    if let Some(target) = database.filter(|db| !db.is_empty()) {
        let source = options
            .source_database
            .as_deref()
            .map(str::trim)
            .filter(|db| !db.is_empty())
            .unwrap_or(target);
        args.push(format!("--nsInclude={source}.*"));
        if source != target {
            args.push(format!("--nsFrom={source}.*"));
            args.push(format!("--nsTo={target}.*"));
        }
    }
    if options.exit_on_error {
        args.push("--stopOnError".into());
    }
    args
}

pub fn mssql_ident(name: &str) -> String {
    format!("[{}]", name.replace(']', "]]"))
}

fn mssql_literal(value: &str) -> String {
    format!("N'{}'", value.replace('\'', "''"))
}

pub fn mssql_backup_sql(database: &str, path: &str, options: &BackupOptions) -> String {
    let mut with = vec!["INIT".to_string(), "STATS = 10".to_string()];
    if options.copy_only {
        with.push("COPY_ONLY".into());
    }
    if options.compression {
        with.push("COMPRESSION".into());
    }
    format!(
        "BACKUP DATABASE {} TO DISK = {} WITH {}",
        mssql_ident(database),
        mssql_literal(path),
        with.join(", ")
    )
}

pub fn mssql_restore_sql(database: &str, path: &str, options: &BackupOptions) -> Vec<String> {
    let db = mssql_ident(database);
    let mut with = vec!["STATS = 10".to_string()];
    if options.replace {
        with.push("REPLACE".into());
    }
    let mut statements = Vec::new();
    if options.close_connections {
        statements.push(format!(
            "IF DB_ID({}) IS NOT NULL ALTER DATABASE {db} SET SINGLE_USER WITH ROLLBACK IMMEDIATE",
            mssql_literal(database)
        ));
    }
    statements.push(format!(
        "RESTORE DATABASE {db} FROM DISK = {} WITH {}",
        mssql_literal(path),
        with.join(", ")
    ));
    statements
}

fn redact(line: &str, secrets: &[String]) -> String {
    secrets
        .iter()
        .filter(|secret| secret.len() >= 3)
        .fold(line.to_string(), |acc, secret| {
            acc.replace(secret.as_str(), "••••")
        })
}

async fn pump<R: AsyncRead + Unpin>(
    reader: R,
    sender: tokio::sync::mpsc::UnboundedSender<String>,
    secrets: Arc<Vec<String>>,
) {
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let text = String::from_utf8_lossy(&buffer);
                for line in text.split('\r') {
                    let line = line.trim_end();
                    if !line.is_empty() && sender.send(redact(line, &secrets)).is_err() {
                        return;
                    }
                }
            }
        }
    }
}

async fn collect_log(
    mut receiver: tokio::sync::mpsc::UnboundedReceiver<String>,
    emit: Emit,
    job_id: Option<String>,
) -> Vec<String> {
    let mut tail = VecDeque::with_capacity(TAIL_LINES);
    let mut batch = Vec::new();
    let mut ticker = tokio::time::interval(Duration::from_millis(250));
    loop {
        tokio::select! {
            line = receiver.recv() => match line {
                Some(line) => {
                    if tail.len() == TAIL_LINES {
                        tail.pop_front();
                    }
                    tail.push_back(line.clone());
                    batch.push(line);
                }
                None => break,
            },
            _ = ticker.tick() => {
                if !batch.is_empty() {
                    emit("backup-log", serde_json::json!({ "jobId": job_id, "lines": std::mem::take(&mut batch) }));
                }
            }
        }
    }
    if !batch.is_empty() {
        emit(
            "backup-log",
            serde_json::json!({ "jobId": job_id, "lines": batch }),
        );
    }
    tail.into_iter().collect()
}

fn emit_progress(emit: &Emit, job_id: &Option<String>, done: u64, total: u64) {
    emit(
        "backup-progress",
        serde_json::json!({ "jobId": job_id, "done": done, "total": total }),
    );
}

pub async fn run_process(
    invocation: &Invocation,
    emit: Emit,
    job_id: Option<String>,
    cancel: tokio_util::sync::CancellationToken,
) -> Result<Vec<String>, String> {
    let name = invocation
        .program
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| invocation.program.display().to_string());
    emit(
        "backup-log",
        serde_json::json!({ "jobId": job_id, "lines": [format!("$ {}", invocation.display())] }),
    );
    let mut command = backup_tools::command(&invocation.program);
    command
        .args(&invocation.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if invocation.stdin_file.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .kill_on_drop(true);
    for (key, value) in &invocation.env {
        command.env(key, value);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("{name} konnte nicht gestartet werden: {e}"))?;
    let secrets = Arc::new(invocation.secrets.clone());
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(tokio::spawn(pump(stdout, sender.clone(), secrets.clone())));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(tokio::spawn(pump(stderr, sender.clone(), secrets.clone())));
    }
    drop(sender);
    let collector = tokio::spawn(collect_log(receiver, emit.clone(), job_id.clone()));
    let feeder = match (child.stdin.take(), &invocation.stdin_file) {
        (Some(mut stdin), Some(path)) => {
            let path = path.clone();
            let emit = emit.clone();
            let job_id = job_id.clone();
            Some(tokio::spawn(async move {
                let mut file = tokio::fs::File::open(&path).await?;
                let total = file.metadata().await.map(|meta| meta.len()).unwrap_or(0);
                let mut buffer = vec![0u8; 256 * 1024];
                let mut done = 0u64;
                let mut last = Instant::now();
                loop {
                    let read = file.read(&mut buffer).await?;
                    if read == 0 {
                        break;
                    }
                    stdin.write_all(&buffer[..read]).await?;
                    done += read as u64;
                    if last.elapsed() > Duration::from_millis(250) {
                        last = Instant::now();
                        emit_progress(&emit, &job_id, done, total);
                    }
                }
                emit_progress(&emit, &job_id, done, total);
                stdin.shutdown().await?;
                Ok::<(), std::io::Error>(())
            }))
        }
        _ => None,
    };
    let status = tokio::select! {
        status = child.wait() => status.map_err(|e| e.to_string())?,
        _ = cancel.cancelled() => {
            let _ = child.kill().await;
            if let Some(feeder) = feeder {
                feeder.abort();
            }
            for reader in readers {
                reader.abort();
            }
            collector.abort();
            return Err(CANCELLED.into());
        }
    };
    let feed_error = match feeder {
        Some(feeder) => feeder.await.ok().and_then(Result::err),
        None => None,
    };
    for reader in readers {
        let _ = reader.await;
    }
    let tail = collector.await.unwrap_or_default();
    if !status.success() {
        let excerpt: Vec<&str> = tail
            .iter()
            .rev()
            .take(15)
            .rev()
            .map(String::as_str)
            .collect();
        let code = status
            .code()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "Signal".into());
        return Err(format!(
            "{name} ist mit Code {code} fehlgeschlagen.\n{}",
            excerpt.join("\n")
        ));
    }
    if let Some(error) = feed_error {
        return Err(format!(
            "Eingabedatei konnte nicht übertragen werden: {error}"
        ));
    }
    Ok(tail)
}

fn size_of(path: &Path) -> Option<u64> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.is_file() {
        return Some(meta.len());
    }
    Some(
        std::fs::read_dir(path)
            .ok()?
            .filter_map(Result::ok)
            .filter_map(|entry| entry.metadata().ok())
            .filter(|meta| meta.is_file())
            .map(|meta| meta.len())
            .sum(),
    )
}

fn secret_file(contents: &str) -> Result<tempfile::NamedTempFile, String> {
    let mut file = tempfile::Builder::new()
        .prefix("l8db-backup-")
        .tempfile()
        .map_err(|e| format!("Temporäre Optionsdatei konnte nicht angelegt werden: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(file.path(), std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    file.write_all(contents.as_bytes())
        .and_then(|_| file.flush())
        .map_err(|e| e.to_string())?;
    Ok(file)
}

fn require_path(path: &str) -> Result<&str, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Zielpfad fehlt.".into());
    }
    Ok(path)
}

fn first_cell(result: &super::QueryResult) -> Option<String> {
    let row = result.rows.first()?;
    let value = match row {
        serde_json::Value::Array(cells) => cells.first()?.clone(),
        serde_json::Value::Object(map) => result
            .columns
            .first()
            .and_then(|column| map.get(column))
            .or_else(|| map.values().next())?
            .clone(),
        other => other.clone(),
    };
    Some(match value {
        serde_json::Value::String(text) => text,
        other => other.to_string(),
    })
}

pub async fn server_version(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    pool: PoolState,
) -> Result<Option<String>, String> {
    let sql = match kind {
        DatabaseKind::Postgres => "SELECT current_setting('server_version')",
        DatabaseKind::Mysql => "SELECT VERSION()",
        DatabaseKind::Mssql => "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128))",
        DatabaseKind::Sqlite => "SELECT sqlite_version()",
        _ => return Ok(None),
    };
    let adapter = super::create_adapter_from_string(kind, connection_string, database, pool)?;
    let result = super::execution::connect(adapter.execute_query(sql)).await?;
    Ok(first_cell(&result))
}

pub async fn probe(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    tool_paths: &HashMap<String, String>,
    pool: PoolState,
) -> BackupProbe {
    let tools = backup_tools::locate_all(kind, tool_paths).await;
    let mut warnings = Vec::new();
    let server_version = match server_version(kind, connection_string, database, pool).await {
        Ok(version) => version,
        Err(error) => {
            warnings.push(format!("Serverversion nicht ermittelbar: {error}"));
            None
        }
    };
    warnings.extend(backup_tools::version_warnings(
        kind,
        &tools,
        server_version.as_deref(),
    ));
    BackupProbe {
        tools,
        server_version,
        warnings,
        install_hint: backup_tools::install_hint(kind),
        search_dirs: if backup_tools::tool_names(kind).is_empty() {
            Vec::new()
        } else {
            backup_tools::search_dirs()
                .iter()
                .map(|dir| dir.display().to_string())
                .collect()
        },
    }
}

struct PartialOutput {
    path: PathBuf,
    existed: bool,
}

impl PartialOutput {
    fn new(path: &str) -> Self {
        let path = PathBuf::from(path);
        let existed = path.exists();
        Self { path, existed }
    }

    fn discard(&self) {
        if self.existed {
            return;
        }
        if self.path.is_dir() {
            let _ = std::fs::remove_dir_all(&self.path);
        } else {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

async fn run_tool(
    invocation: Invocation,
    emit: Emit,
    job_id: Option<String>,
    output: Option<PartialOutput>,
) -> Result<(String, Vec<String>), String> {
    let command = invocation.display();
    let result = run_process(
        &invocation,
        emit,
        job_id,
        super::execution::cancellation_token(),
    )
    .await;
    match result {
        Ok(tail) => Ok((command, tail)),
        Err(error) => {
            if let Some(output) = output {
                output.discard();
            }
            Err(error)
        }
    }
}

async fn cancellable<T>(
    future: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let token = super::execution::cancellation_token();
    tokio::select! {
        result = future => result,
        _ = token.cancelled() => Err(format!("{CANCELLED} Der Server kann den Vorgang dennoch abschließen.")),
    }
}

fn sqlite_copy(
    source: &Path,
    target: &Path,
    source_flags: rusqlite::OpenFlags,
    emit: &Emit,
    job_id: &Option<String>,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let source = rusqlite::Connection::open_with_flags(source, source_flags)
        .map_err(|e| format!("Quelle konnte nicht geöffnet werden: {e}"))?;
    source
        .query_row("PRAGMA schema_version", [], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("Quelle ist keine gültige SQLite-Datenbank: {e}"))?;
    let mut destination = rusqlite::Connection::open(target)
        .map_err(|e| format!("Ziel konnte nicht geöffnet werden: {e}"))?;
    destination
        .busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let backup = rusqlite::backup::Backup::new(&source, &mut destination)
        .map_err(|e| format!("SQLite-Sicherung konnte nicht gestartet werden: {e}"))?;
    let mut last = Instant::now();
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        let step = backup.step(256).map_err(|e| e.to_string())?;
        let progress = backup.progress();
        if last.elapsed() > Duration::from_millis(200) {
            last = Instant::now();
            emit_progress(
                emit,
                job_id,
                (progress.pagecount - progress.remaining).max(0) as u64,
                progress.pagecount.max(0) as u64,
            );
        }
        match step {
            rusqlite::backup::StepResult::Done => {
                emit_progress(
                    emit,
                    job_id,
                    progress.pagecount.max(0) as u64,
                    progress.pagecount.max(0) as u64,
                );
                return Ok(());
            }
            rusqlite::backup::StepResult::More => {}
            _ => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

async fn sqlite_task(
    source: PathBuf,
    target: PathBuf,
    source_flags: rusqlite::OpenFlags,
    emit: Emit,
    job_id: Option<String>,
) -> Result<(), String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    let token = super::execution::cancellation_token();
    let flag = cancelled.clone();
    let watcher = tokio::spawn(async move {
        token.cancelled().await;
        flag.store(true, Ordering::Relaxed);
    });
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        sqlite_copy(&source, &target, source_flags, &emit, &job_id, &cancelled)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    watcher.abort();
    result
}

pub async fn backup(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    request: &BackupRequest,
    emit: Emit,
    job_id: Option<String>,
    pool: PoolState,
) -> Result<BackupOutcome, String> {
    let started = Instant::now();
    let path = require_path(&request.path)?.to_string();
    let options = &request.options;
    let (format, command, tail) = match kind {
        DatabaseKind::Postgres => {
            let (env, secrets) = pg_env(connection_string, database)?;
            let globals = options.format == "globals";
            let tool = backup_tools::locate_one(
                if globals { "pg_dumpall" } else { "pg_dump" },
                &request.tool_paths,
            )
            .await?;
            let args = if globals {
                let db = env
                    .iter()
                    .find(|(key, _)| key == "PGDATABASE")
                    .map(|(_, value)| value.clone())
                    .unwrap_or_else(|| "postgres".into());
                vec![
                    "--verbose".into(),
                    "--globals-only".into(),
                    format!("--database={db}"),
                    format!("--file={path}"),
                ]
            } else {
                pg_dump_args(options, &path)?
            };
            let invocation = Invocation {
                program: tool.path.clone().unwrap_or_default().into(),
                args,
                env,
                stdin_file: None,
                secrets,
            };
            let (command, tail) =
                run_tool(invocation, emit, job_id, Some(PartialOutput::new(&path))).await?;
            (
                if options.format.is_empty() {
                    "plain".to_string()
                } else {
                    options.format.clone()
                },
                command,
                tail,
            )
        }
        DatabaseKind::Mysql => {
            let target = mysql_target(connection_string, database)?;
            let db = target
                .database
                .clone()
                .ok_or("Für mysqldump muss eine Datenbank gewählt sein.")?;
            let tool = backup_tools::locate_one("mysqldump", &request.tool_paths).await?;
            let mariadb = tool.is_mariadb();
            let option_file = secret_file(&mysql_option_file(&target.password))?;
            let mut args = mysql_connection_args(&target, mariadb, Some(option_file.path()));
            args.extend(mysqldump_args(options, &db, mariadb, &path)?);
            let invocation = Invocation {
                program: tool.path.clone().unwrap_or_default().into(),
                args,
                env: Vec::new(),
                stdin_file: None,
                secrets: vec![target.password.clone()],
            };
            let (command, tail) =
                run_tool(invocation, emit, job_id, Some(PartialOutput::new(&path))).await?;
            drop(option_file);
            ("sql".to_string(), command, tail)
        }
        DatabaseKind::Mongodb => {
            let uri = mongo_uri_for_database(connection_string, database)?;
            let tool = backup_tools::locate_one("mongodump", &request.tool_paths).await?;
            let config = secret_file(&mongo_config(&uri))?;
            let secrets = url::Url::parse(&uri)
                .ok()
                .and_then(|url| url.password().map(decode))
                .into_iter()
                .collect();
            let invocation = Invocation {
                program: tool.path.clone().unwrap_or_default().into(),
                args: mongodump_args(options, config.path(), &path)?,
                env: Vec::new(),
                stdin_file: None,
                secrets,
            };
            let (command, tail) =
                run_tool(invocation, emit, job_id, Some(PartialOutput::new(&path))).await?;
            drop(config);
            ("archive".to_string(), command, tail)
        }
        DatabaseKind::Sqlite => {
            let source = super::sqlite::file_path(connection_string)?;
            if source == ":memory:" {
                return Err("In-Memory-Datenbanken können nicht gesichert werden.".into());
            }
            let target = PathBuf::from(&path);
            let parent = target
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or(Path::new("."));
            let temp = tempfile::Builder::new()
                .prefix(".l8db-backup-")
                .tempfile_in(parent)
                .map_err(|e| format!("Zielverzeichnis nicht beschreibbar: {e}"))?;
            sqlite_task(
                PathBuf::from(&source),
                temp.path().to_path_buf(),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
                emit,
                job_id,
            )
            .await?;
            temp.persist(&target)
                .map_err(|e| format!("Sicherung konnte nicht abgelegt werden: {}", e.error))?;
            (
                "sqlite".to_string(),
                format!("SQLite Backup API: {source} → {path}"),
                Vec::new(),
            )
        }
        DatabaseKind::Mssql => {
            let db = mssql_database(connection_string, database)?;
            let sql = mssql_backup_sql(&db, &path, options);
            emit(
                "backup-log",
                serde_json::json!({ "jobId": job_id, "lines": [sql.clone()] }),
            );
            let adapter =
                super::create_adapter_from_string(kind, connection_string, Some("master"), pool)?;
            cancellable(adapter.execute_query(&sql)).await?;
            ("bak".to_string(), sql, Vec::new())
        }
        DatabaseKind::Redis => {
            let adapter =
                super::create_adapter_from_string(kind, connection_string, database, pool)?;
            let result = cancellable(adapter.execute_query("BGSAVE")).await?;
            let message = first_cell(&result).unwrap_or_else(|| "BGSAVE ausgelöst".into());
            emit(
                "backup-log",
                serde_json::json!({ "jobId": job_id, "lines": [message.clone()] }),
            );
            return Ok(BackupOutcome {
                path: String::new(),
                format: "bgsave".into(),
                command: "BGSAVE".into(),
                bytes: None,
                duration_ms: started.elapsed().as_millis() as u64,
                log_tail: vec![message],
            });
        }
        _ => return Err(super::unsupported("Sicherung")),
    };
    Ok(BackupOutcome {
        bytes: if kind == DatabaseKind::Mssql {
            None
        } else {
            size_of(Path::new(&path))
        },
        path,
        format,
        command,
        duration_ms: started.elapsed().as_millis() as u64,
        log_tail: tail,
    })
}

fn mssql_database(connection_string: &str, database: Option<&str>) -> Result<String, String> {
    if let Some(db) = database.filter(|db| !db.is_empty()) {
        return Ok(db.to_string());
    }
    let url = url::Url::parse(connection_string.trim())
        .map_err(|_| "Ungültige SQL-Server-URL".to_string())?;
    let db = decode(url.path().trim_start_matches('/'));
    if db.is_empty() {
        return Err("Für SQL Server muss eine Datenbank gewählt sein.".into());
    }
    Ok(db)
}

pub async fn restore(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    request: &BackupRequest,
    emit: Emit,
    job_id: Option<String>,
    pool: PoolState,
) -> Result<BackupOutcome, String> {
    let started = Instant::now();
    let path = require_path(&request.path)?.to_string();
    let options = &request.options;
    if kind != DatabaseKind::Mssql && !Path::new(&path).exists() {
        return Err(format!("Sicherung nicht gefunden: {path}"));
    }
    let (format, command, tail) = match kind {
        DatabaseKind::Postgres => {
            if super::connection::connection_string_is_read_only(connection_string) {
                return Err(
                    "Lesemodus: Wiederherstellung ist für diese Verbindung gesperrt.".into(),
                );
            }
            let (env, secrets) = pg_env(connection_string, database)?;
            let db = env
                .iter()
                .find(|(key, _)| key == "PGDATABASE")
                .map(|(_, value)| value.clone())
                .ok_or("Für die Wiederherstellung muss eine Datenbank gewählt sein.")?;
            let format = detect_pg_format(Path::new(&path))?;
            let (tool, args) = if format == "plain" {
                (
                    backup_tools::locate_one("psql", &request.tool_paths).await?,
                    psql_args(options, &db, &path),
                )
            } else {
                (
                    backup_tools::locate_one("pg_restore", &request.tool_paths).await?,
                    pg_restore_args(options, format, &db, &path),
                )
            };
            let invocation = Invocation {
                program: tool.path.clone().unwrap_or_default().into(),
                args,
                env,
                stdin_file: None,
                secrets,
            };
            let (command, tail) = run_tool(invocation, emit, job_id, None).await?;
            (format.to_string(), command, tail)
        }
        DatabaseKind::Mysql => {
            let target = mysql_target(connection_string, database)?;
            let db = target
                .database
                .clone()
                .ok_or("Für die Wiederherstellung muss eine Datenbank gewählt sein.")?;
            plain_name(&db, "Datenbankname")?;
            if detect_pg_format(Path::new(&path))? != "plain" {
                return Err("Für MySQL werden nur SQL-Dateien unterstützt.".into());
            }
            let tool = backup_tools::locate_one("mysql", &request.tool_paths).await?;
            let option_file = secret_file(&mysql_option_file(&target.password))?;
            let mut args =
                mysql_connection_args(&target, tool.is_mariadb(), Some(option_file.path()));
            if !options.exit_on_error {
                args.push("--force".into());
            }
            args.push(format!("--database={db}"));
            let invocation = Invocation {
                program: tool.path.clone().unwrap_or_default().into(),
                args,
                env: Vec::new(),
                stdin_file: Some(PathBuf::from(&path)),
                secrets: vec![target.password.clone()],
            };
            let (command, tail) = run_tool(invocation, emit, job_id, None).await?;
            drop(option_file);
            ("sql".to_string(), command, tail)
        }
        DatabaseKind::Mongodb => {
            let tool = backup_tools::locate_one("mongorestore", &request.tool_paths).await?;
            let config = secret_file(&mongo_config(connection_string))?;
            let secrets = url::Url::parse(connection_string)
                .ok()
                .and_then(|url| url.password().map(decode))
                .into_iter()
                .collect();
            let invocation = Invocation {
                program: tool.path.clone().unwrap_or_default().into(),
                args: mongorestore_args(options, config.path(), database, &path),
                env: Vec::new(),
                stdin_file: None,
                secrets,
            };
            let (command, tail) = run_tool(invocation, emit, job_id, None).await?;
            drop(config);
            ("archive".to_string(), command, tail)
        }
        DatabaseKind::Sqlite => {
            let target = super::sqlite::file_path(connection_string)?;
            if target == ":memory:" {
                return Err("In-Memory-Datenbanken können nicht wiederhergestellt werden.".into());
            }
            if std::fs::canonicalize(&target).ok() == std::fs::canonicalize(&path).ok() {
                return Err("Quelle und Ziel sind dieselbe Datei.".into());
            }
            sqlite_task(
                PathBuf::from(&path),
                PathBuf::from(&target),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
                emit,
                job_id,
            )
            .await?;
            (
                "sqlite".to_string(),
                format!("SQLite Backup API: {path} → {target}"),
                Vec::new(),
            )
        }
        DatabaseKind::Mssql => {
            let db = mssql_database(connection_string, database)?;
            let statements = mssql_restore_sql(&db, &path, options);
            let adapter =
                super::create_adapter_from_string(kind, connection_string, Some("master"), pool)?;
            let mut result = Ok(());
            for sql in &statements {
                emit(
                    "backup-log",
                    serde_json::json!({ "jobId": job_id, "lines": [sql.clone()] }),
                );
                if let Err(error) = cancellable(adapter.execute_query(sql)).await {
                    result = Err(error);
                    break;
                }
            }
            if options.close_connections {
                let _ = adapter
                    .execute_query(&format!(
                        "IF DB_ID({}) IS NOT NULL ALTER DATABASE {} SET MULTI_USER",
                        mssql_literal(&db),
                        mssql_ident(&db)
                    ))
                    .await;
            }
            result?;
            ("bak".to_string(), statements.join(";\n"), Vec::new())
        }
        _ => return Err(super::unsupported("Wiederherstellung")),
    };
    Ok(BackupOutcome {
        path,
        format,
        command,
        bytes: None,
        duration_ms: started.elapsed().as_millis() as u64,
        log_tail: tail,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> BackupOptions {
        BackupOptions::default()
    }

    #[test]
    fn pg_env_keeps_password_out_of_arguments() {
        let (env, secrets) = pg_env(
            "postgresql://alice:s%40cret@db.example.com:6543/app?sslmode=require&options=-c%20default_transaction_read_only%3Don",
            Some("other"),
        )
        .unwrap();
        let get = |key: &str| {
            env.iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(get("PGHOST"), Some("db.example.com"));
        assert_eq!(get("PGPORT"), Some("6543"));
        assert_eq!(get("PGUSER"), Some("alice"));
        assert_eq!(get("PGPASSWORD"), Some("s@cret"));
        assert_eq!(get("PGDATABASE"), Some("other"));
        assert_eq!(get("PGSSLMODE"), Some("require"));
        assert!(get("PGOPTIONS")
            .unwrap()
            .contains("default_transaction_read_only=on"));
        assert_eq!(secrets, ["s@cret"]);
        let args = pg_dump_args(&options(), "/tmp/out.sql").unwrap();
        assert!(args.iter().all(|arg| !arg.contains("s@cret")));
    }

    #[test]
    fn builds_pg_dump_arguments() {
        let request = BackupOptions {
            format: "directory".into(),
            content: "schema".into(),
            include_schemas: vec!["public".into(), " ".into()],
            exclude_tables: vec!["public.logs".into()],
            clean: true,
            if_exists: true,
            no_owner: true,
            jobs: Some(4),
            ..options()
        };
        let args = pg_dump_args(&request, "/tmp/dump").unwrap();
        assert_eq!(
            args,
            [
                "--verbose",
                "--format=d",
                "--file=/tmp/dump",
                "--jobs=4",
                "--schema-only",
                "--schema=public",
                "--exclude-table=public.logs",
                "--no-owner"
            ]
        );
        let plain = pg_dump_args(
            &BackupOptions {
                clean: true,
                if_exists: true,
                jobs: Some(4),
                ..options()
            },
            "/tmp/a.sql",
        )
        .unwrap();
        assert!(plain.contains(&"--clean".to_string()));
        assert!(plain.contains(&"--if-exists".to_string()));
        assert!(!plain.iter().any(|arg| arg.starts_with("--jobs")));
        assert!(pg_dump_args(
            &BackupOptions {
                format: "zip".into(),
                ..options()
            },
            "/tmp/x"
        )
        .is_err());
    }

    #[test]
    fn detects_pg_restore_formats() {
        let dir = tempfile::tempdir().unwrap();
        let custom = dir.path().join("a.dump");
        std::fs::write(&custom, b"PGDMP\x01\x0f").unwrap();
        assert_eq!(detect_pg_format(&custom).unwrap(), "custom");
        let plain = dir.path().join("a.sql");
        std::fs::write(&plain, b"-- PostgreSQL database dump\n").unwrap();
        assert_eq!(detect_pg_format(&plain).unwrap(), "plain");
        let mut tar = vec![0u8; 512];
        tar[257..262].copy_from_slice(b"ustar");
        let tar_path = dir.path().join("a.tar");
        std::fs::write(&tar_path, tar).unwrap();
        assert_eq!(detect_pg_format(&tar_path).unwrap(), "tar");
        let gz = dir.path().join("a.sql.gz");
        std::fs::write(&gz, [0x1f, 0x8b, 8, 0]).unwrap();
        assert!(detect_pg_format(&gz).is_err());
        let directory = dir.path().join("dir");
        std::fs::create_dir(&directory).unwrap();
        assert!(detect_pg_format(&directory).is_err());
        std::fs::write(directory.join("toc.dat"), b"PGDMP").unwrap();
        assert_eq!(detect_pg_format(&directory).unwrap(), "directory");
    }

    #[test]
    fn builds_pg_restore_and_psql_arguments() {
        let request = BackupOptions {
            clean: true,
            if_exists: true,
            single_transaction: true,
            jobs: Some(4),
            exit_on_error: true,
            ..options()
        };
        let args = pg_restore_args(&request, "custom", "app", "/tmp/a.dump");
        assert!(args.contains(&"--single-transaction".to_string()));
        assert!(!args.iter().any(|arg| arg.starts_with("--jobs")));
        assert_eq!(args.last().unwrap(), "/tmp/a.dump");
        let parallel = pg_restore_args(
            &BackupOptions {
                jobs: Some(3),
                ..options()
            },
            "directory",
            "app",
            "/tmp/d",
        );
        assert!(parallel.contains(&"--jobs=3".to_string()));
        assert!(parallel.contains(&"--format=d".to_string()));
        let psql = psql_args(&request, "app", "/tmp/a.sql");
        assert!(psql.contains(&"--set=ON_ERROR_STOP=1".to_string()));
        assert!(psql.contains(&"--single-transaction".to_string()));
    }

    #[test]
    fn mysql_target_and_arguments() {
        let target = mysql_target(
            "mysql://root:p%40ss@127.0.0.1:3307/shop?sslmode=require",
            None,
        )
        .unwrap();
        assert_eq!(target.host, "127.0.0.1");
        assert_eq!(target.port, 3307);
        assert_eq!(target.password, "p@ss");
        assert_eq!(target.database.as_deref(), Some("shop"));
        let file = Path::new("/tmp/opt.cnf");
        let args = mysql_connection_args(&target, false, Some(file));
        assert_eq!(args[0], "--defaults-extra-file=/tmp/opt.cnf");
        assert!(args.contains(&"--ssl-mode=REQUIRED".to_string()));
        assert!(args.iter().all(|arg| !arg.contains("p@ss")));
        let maria = mysql_connection_args(&target, true, None);
        assert!(maria.contains(&"--ssl".to_string()));
        let dump = mysqldump_args(
            &BackupOptions {
                single_transaction: true,
                routines: true,
                triggers: true,
                content: "schema".into(),
                include_tables: vec!["orders".into()],
                exclude_tables: vec!["logs".into()],
                ..options()
            },
            "shop",
            false,
            "/tmp/shop.sql",
        )
        .unwrap();
        assert!(dump.contains(&"--no-data".to_string()));
        assert!(dump.contains(&"--ignore-table=shop.logs".to_string()));
        assert!(dump.contains(&"--set-gtid-purged=OFF".to_string()));
        assert_eq!(&dump[dump.len() - 2..], ["shop", "orders"]);
        assert!(mysqldump_args(&options(), "-x", false, "/tmp/a").is_err());
        let other = mysql_target("mysql://u@host/db", Some("other")).unwrap();
        assert_eq!(other.database.as_deref(), Some("other"));
        assert!(other.ssl.is_none());
    }

    #[test]
    fn mysql_option_file_quotes_passwords() {
        assert_eq!(mysql_option_file("abc"), "[client]\npassword=\"abc\"\n");
        assert_eq!(
            mysql_option_file("a\"b\\c"),
            "[client]\npassword='a\"b\\\\c'\n"
        );
    }

    #[test]
    fn mongo_uri_targets_database_and_keeps_auth_source() {
        assert_eq!(
            mongo_uri_for_database("mongodb://u:p@h:27017/admin", Some("shop")).unwrap(),
            "mongodb://u:p@h:27017/shop?authSource=admin"
        );
        assert_eq!(
            mongo_uri_for_database("mongodb://u:p@h:27017", Some("shop")).unwrap(),
            "mongodb://u:p@h:27017/shop?authSource=admin"
        );
        assert_eq!(
            mongo_uri_for_database("mongodb://h:27017/?tls=true", Some("shop")).unwrap(),
            "mongodb://h:27017/shop?tls=true"
        );
        assert_eq!(
            mongo_uri_for_database("mongodb://u:p@h/x?authSource=auth", Some("shop")).unwrap(),
            "mongodb://u:p@h/shop?authSource=auth"
        );
        assert_eq!(
            mongo_uri_for_database("mongodb://u:p@h/x", None).unwrap(),
            "mongodb://u:p@h/x"
        );
        assert_eq!(
            mongo_config("mongodb://u:p\"w@h"),
            "uri: \"mongodb://u:p\\\"w@h\"\n"
        );
    }

    #[test]
    fn mongo_arguments() {
        let config = Path::new("/tmp/c.yaml");
        let args = mongodump_args(
            &BackupOptions {
                gzip: true,
                exclude_tables: vec!["logs".into()],
                ..options()
            },
            config,
            "/tmp/a.archive",
        )
        .unwrap();
        assert_eq!(
            args,
            [
                "--config=/tmp/c.yaml",
                "--archive=/tmp/a.archive",
                "--gzip",
                "--excludeCollection=logs"
            ]
        );
        assert!(mongodump_args(
            &BackupOptions {
                include_tables: vec!["a".into(), "b".into()],
                ..options()
            },
            config,
            "/tmp/a"
        )
        .is_err());
        let restore = mongorestore_args(
            &BackupOptions {
                drop: true,
                source_database: Some("prod".into()),
                ..options()
            },
            config,
            Some("staging"),
            "/tmp/a",
        );
        assert!(restore.contains(&"--drop".to_string()));
        assert!(restore.contains(&"--nsFrom=prod.*".to_string()));
        assert!(restore.contains(&"--nsTo=staging.*".to_string()));
    }

    #[test]
    fn mssql_statements_quote_names_and_paths() {
        let sql = mssql_backup_sql(
            "Sh]op",
            "C:\\b\\o'k.bak",
            &BackupOptions {
                copy_only: true,
                ..options()
            },
        );
        assert_eq!(
            sql,
            "BACKUP DATABASE [Sh]]op] TO DISK = N'C:\\b\\o''k.bak' WITH INIT, STATS = 10, COPY_ONLY"
        );
        let restore = mssql_restore_sql(
            "shop",
            "/var/opt/mssql/shop.bak",
            &BackupOptions {
                replace: true,
                close_connections: true,
                ..options()
            },
        );
        assert_eq!(restore.len(), 2);
        assert!(restore[0].contains("SINGLE_USER WITH ROLLBACK IMMEDIATE"));
        assert!(restore[1].ends_with("WITH STATS = 10, REPLACE"));
    }

    #[test]
    fn redacts_secrets_in_log_lines() {
        assert_eq!(
            redact("connect to mongodb://u:hunter2@h", &["hunter2".into()]),
            "connect to mongodb://u:••••@h"
        );
    }

    #[cfg(unix)]
    type Events = Arc<std::sync::Mutex<Vec<(String, serde_json::Value)>>>;

    #[cfg(unix)]
    fn collecting_emit() -> (Emit, Events) {
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = events.clone();
        (
            Arc::new(move |name: &str, payload: serde_json::Value| {
                sink.lock().unwrap().push((name.to_string(), payload));
            }),
            events,
        )
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn process_streams_log_redacts_and_reports_failures() {
        let (emit, events) = collecting_emit();
        let invocation = Invocation {
            program: "/bin/sh".into(),
            args: vec![
                "-c".into(),
                "echo \"pg_dump: reading $SECRET_VALUE\" >&2; echo done; exit 3".into(),
            ],
            env: vec![("SECRET_VALUE".into(), "topsecret".into())],
            stdin_file: None,
            secrets: vec!["topsecret".into()],
        };
        let error = run_process(
            &invocation,
            emit,
            Some("job".into()),
            tokio_util::sync::CancellationToken::new(),
        )
        .await
        .unwrap_err();
        assert!(error.contains("Code 3"));
        assert!(error.contains("pg_dump: reading ••••"));
        let logged = serde_json::to_string(&*events.lock().unwrap()).unwrap();
        assert!(!logged.contains("topsecret"));
        assert!(!invocation.display().contains("topsecret"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn process_feeds_stdin_and_can_be_cancelled() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("in.sql");
        std::fs::write(&input, "line one\nline two\n").unwrap();
        let (emit, events) = collecting_emit();
        let invocation = Invocation {
            program: "/bin/cat".into(),
            args: Vec::new(),
            env: Vec::new(),
            stdin_file: Some(input),
            secrets: Vec::new(),
        };
        let tail = run_process(
            &invocation,
            emit.clone(),
            Some("job".into()),
            tokio_util::sync::CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(tail, ["line one", "line two"]);
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .any(|(name, payload)| name == "backup-progress" && payload["done"] == 18));
        let token = tokio_util::sync::CancellationToken::new();
        let sleeper = Invocation {
            program: "/bin/sleep".into(),
            args: vec!["30".into()],
            env: Vec::new(),
            stdin_file: None,
            secrets: Vec::new(),
        };
        let trigger = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            trigger.cancel();
        });
        let started = Instant::now();
        let error = run_process(&sleeper, emit, None, token).await.unwrap_err();
        assert!(error.contains("vom Benutzer abgebrochen"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[tokio::test]
    async fn sqlite_backup_and_restore_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("app.sqlite");
        {
            let conn = rusqlite::Connection::open(&db).unwrap();
            conn.execute_batch(
                "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('a'), ('b');",
            )
            .unwrap();
        }
        let (emit, _) = {
            let events = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
            let sink = events.clone();
            let emit: Emit = Arc::new(move |name: &str, _| sink.lock().unwrap().push(name.into()));
            (emit, events)
        };
        let target = dir.path().join("backup.sqlite");
        let request = BackupRequest {
            path: target.display().to_string(),
            options: options(),
            tool_paths: HashMap::new(),
        };
        let pool = super::super::pool::create_pool_state();
        let outcome = backup(
            DatabaseKind::Sqlite,
            &db.display().to_string(),
            None,
            &request,
            emit.clone(),
            None,
            pool.clone(),
        )
        .await
        .unwrap();
        assert!(outcome.bytes.unwrap() > 0);
        {
            let conn = rusqlite::Connection::open(&db).unwrap();
            conn.execute("DELETE FROM t", []).unwrap();
        }
        restore(
            DatabaseKind::Sqlite,
            &db.display().to_string(),
            None,
            &request,
            emit,
            None,
            pool,
        )
        .await
        .unwrap();
        let conn = rusqlite::Connection::open(&db).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM t", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }
}
