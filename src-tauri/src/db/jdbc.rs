use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

use super::{ColumnInfo, DatabaseAdapter, DetailedColumnInfo, QueryResult, TableData, TableInfo};

const MAX_FRAME: usize = 8 * 1024 * 1024;
const MAX_REQUEST: usize = 2 * 1024 * 1024;
const MAX_JAR: u64 = 256 * 1024 * 1024;
const MAX_ROWS: usize = 50_000;
const MAX_WORKERS: usize = 4;
const IDLE: Duration = Duration::from_secs(60);
const SOURCE: &str = include_str!("../../jdbc/L8dbJdbcBridge.java");
static ROOT: OnceLock<PathBuf> = OnceLock::new();
static PROFILE_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JdbcProfile {
    pub id: String,
    pub name: String,
    pub driver_class: String,
    pub jars: Vec<String>,
    pub url: String,
    pub username: String,
    pub read_only: bool,
    #[serde(default)]
    pub has_password: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JdbcProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub driver_class: String,
    pub jars: Vec<String>,
    pub url: String,
    pub username: String,
    pub read_only: bool,
    pub password: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JdbcJar {
    pub id: String,
    pub name: String,
    pub bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JdbcStatus {
    pub available: bool,
    pub detail: String,
    pub jars: Vec<JdbcJar>,
    pub active_processes: usize,
    pub max_processes: usize,
    pub idle_seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JdbcCatalogEntry {
    pub id: &'static str,
    pub name: &'static str,
    pub driver_class: &'static str,
    pub url_template: &'static str,
    pub documentation: &'static str,
}

pub fn catalog() -> Vec<JdbcCatalogEntry> {
    [
        ("h2", "H2", "org.h2.Driver", "jdbc:h2:~/l8db-test", "https://h2database.github.io/html/main.html"),
        ("postgres", "PostgreSQL", "org.postgresql.Driver", "jdbc:postgresql://localhost:5432/postgres", "https://jdbc.postgresql.org/download/"),
        ("mysql", "MySQL", "com.mysql.cj.jdbc.Driver", "jdbc:mysql://localhost:3306/mysql", "https://dev.mysql.com/downloads/connector/j/"),
        ("mariadb", "MariaDB", "org.mariadb.jdbc.Driver", "jdbc:mariadb://localhost:3306/mysql", "https://mariadb.com/docs/connectors/mariadb-connector-j"),
        ("mssql", "SQL Server", "com.microsoft.sqlserver.jdbc.SQLServerDriver", "jdbc:sqlserver://localhost:1433;databaseName=master;encrypt=true", "https://learn.microsoft.com/sql/connect/jdbc/download-microsoft-jdbc-driver-for-sql-server"),
        ("oracle", "Oracle", "oracle.jdbc.OracleDriver", "jdbc:oracle:thin:@//localhost:1521/FREEPDB1", "https://www.oracle.com/database/technologies/appdev/jdbc-downloads.html"),
        ("sqlite", "SQLite", "org.sqlite.JDBC", "jdbc:sqlite:/path/database.sqlite", "https://github.com/xerial/sqlite-jdbc"),
        ("trino", "Trino", "io.trino.jdbc.TrinoDriver", "jdbc:trino://localhost:8080/catalog/schema", "https://trino.io/docs/current/client/jdbc.html"),
        ("clickhouse", "ClickHouse", "com.clickhouse.jdbc.ClickHouseDriver", "jdbc:clickhouse://localhost:8123/default", "https://clickhouse.com/docs/integrations/java/jdbc"),
        ("db2", "IBM Db2", "com.ibm.db2.jcc.DB2Driver", "jdbc:db2://localhost:50000/database", "https://www.ibm.com/docs/en/db2/11.5.x?topic=jdbc-drivers"),
        ("derby", "Apache Derby", "org.apache.derby.client.ClientAutoloadedDriver", "jdbc:derby://localhost:1527/database", "https://db.apache.org/derby/derby_downloads.html"),
        ("custom", "Anderer JDBC-Treiber", "", "jdbc:", "https://docs.oracle.com/en/java/javase/17/docs/api/java.sql/java/sql/DriverManager.html"),
    ]
    .into_iter()
    .map(|(id, name, driver_class, url_template, documentation)| JdbcCatalogEntry { id, name, driver_class, url_template, documentation })
    .collect()
}

fn root() -> Result<PathBuf, String> {
    if let Some(root) = ROOT.get() {
        return Ok(root.clone());
    }
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support"));
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));
    base.map(|base| base.join("com.leon.l8db/jdbc"))
        .ok_or_else(|| "JDBC-Datenverzeichnis ist nicht verfügbar.".into())
}

fn initialize(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("jdbc");
    let _ = ROOT.set(directory);
    root()
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn load_profiles(root: &Path) -> Result<Vec<JdbcProfile>, String> {
    let path = root.join("profiles.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    if path.metadata().map_err(|error| error.to_string())?.len() > 1024 * 1024 {
        return Err("JDBC-Profile überschreiten 1 MiB.".into());
    }
    let profiles: Vec<JdbcProfile> =
        serde_json::from_slice(&std::fs::read(path).map_err(|error| error.to_string())?)
            .map_err(|_| "JDBC-Profile sind ungültig.".to_string())?;
    if profiles.len() > 64 || profiles.iter().any(|profile| !valid_id(&profile.id)) {
        return Err("JDBC-Profile sind ungültig.".into());
    }
    Ok(profiles)
}

fn save_profiles(root: &Path, profiles: &[JdbcProfile]) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(profiles).map_err(|error| error.to_string())?;
    temporary
        .write_all(&bytes)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(root.join("profiles.json"))
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

fn jar_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Ungültige JDBC-JAR-Kennung.".into());
    }
    let path = root.join("jars").join(format!("{id}.jar"));
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| "JDBC-JAR fehlt. Treiber erneut importieren.".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_JAR {
        return Err("JDBC-JAR ist keine gültige lokale Datei.".into());
    }
    Ok(path)
}

fn validate(input: &JdbcProfileInput) -> Result<(), String> {
    if input.name.trim().is_empty() || input.name.len() > 120 || input.username.len() > 512 {
        return Err("JDBC-Profil benötigt einen gültigen Namen und Benutzer.".into());
    }
    if input.driver_class.is_empty()
        || input.driver_class.len() > 200
        || !input
            .driver_class
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'$'))
    {
        return Err("Ungültige JDBC-Treiberklasse.".into());
    }
    if !input.url.starts_with("jdbc:")
        || input.url.len() > 8192
        || input.url.chars().any(char::is_control)
    {
        return Err("Eine JDBC-URL ohne Steuerzeichen wird benötigt.".into());
    }
    let lowered = percent_encoding::percent_decode_str(&input.url)
        .decode_utf8_lossy()
        .to_ascii_lowercase();
    if [
        "password=",
        "pwd=",
        "token=",
        "secret=",
        "apikey=",
        "access_key=",
    ]
    .iter()
    .any(|marker| lowered.contains(marker))
    {
        return Err(
            "Passwörter und Tokens gehören ins Passwortfeld, nicht in die JDBC-URL.".into(),
        );
    }
    if let Some((_, host)) = lowered.split_once("://") {
        if host
            .split('/')
            .next()
            .is_some_and(|authority| authority.contains('@'))
        {
            return Err("Anmeldedaten in der JDBC-URL sind nicht erlaubt.".into());
        }
    }
    if lowered
        .strip_prefix("jdbc:oracle:thin:")
        .is_some_and(|rest| !rest.starts_with('@'))
    {
        return Err(
            "Oracle-JDBC-URL ohne Benutzer und Passwort verwenden: jdbc:oracle:thin:@…".into(),
        );
    }
    if input.jars.is_empty()
        || input.jars.len() > 16
        || input
            .password
            .as_ref()
            .is_some_and(|password| password.len() > 16 * 1024)
    {
        return Err("Ein bis 16 JDBC-JARs und ein begrenztes Passwort werden benötigt.".into());
    }
    Ok(())
}

fn java_path() -> PathBuf {
    std::env::var_os("JAVA_HOME")
        .map(|home| {
            PathBuf::from(home)
                .join("bin")
                .join(if cfg!(windows) { "java.exe" } else { "java" })
        })
        .unwrap_or_else(|| PathBuf::from("java"))
}

pub async fn available() -> bool {
    let output = tokio::time::timeout(
        Duration::from_secs(3),
        crate::process::command(java_path())
            .arg("--list-modules")
            .kill_on_drop(true)
            .output(),
    )
    .await;
    matches!(output, Ok(Ok(output)) if output.status.success() && supported_java_modules(&String::from_utf8_lossy(&output.stdout)))
}

fn supported_java_modules(modules: &str) -> bool {
    modules
        .lines()
        .any(|line| line.starts_with("jdk.compiler@"))
        && modules
            .lines()
            .find_map(|line| {
                line.strip_prefix("java.base@")
                    .and_then(|version| version.split('.').next())
                    .and_then(|major| major.parse::<u32>().ok())
            })
            .is_some_and(|major| major >= 17)
}

fn jars(root: &Path) -> Result<Vec<JdbcJar>, String> {
    let directory = root.join("jars");
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut jars = Vec::new();
    for entry in std::fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .take(128)
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("jar")
            || !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
        {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("")
            .to_string();
        if !valid_id(&id) {
            continue;
        }
        let name = std::fs::read_to_string(root.join("jars").join(format!("{id}.name")))
            .unwrap_or_else(|_| format!("{id}.jar"));
        jars.push(JdbcJar {
            id,
            name: name.chars().take(200).collect(),
            bytes: entry.metadata().map_err(|error| error.to_string())?.len(),
        });
    }
    jars.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(jars)
}

#[tauri::command]
pub async fn jdbc_status(app: tauri::AppHandle) -> Result<JdbcStatus, String> {
    let root = initialize(&app)?;
    let ready = available().await;
    Ok(JdbcStatus { available: ready, detail: if ready { "JDK mit Java-Compiler gefunden. Ausgewählte JDBC-JARs werden lokal ausgeführt." } else { "JDK 17 oder neuer installieren und JAVA_HOME setzen. Ein JRE ohne Compiler reicht nicht aus." }.into(), jars: jars(&root)?, active_processes: workers().lock().await.len(), max_processes: MAX_WORKERS, idle_seconds: IDLE.as_secs() })
}

#[tauri::command]
pub fn jdbc_catalog() -> Vec<JdbcCatalogEntry> {
    catalog()
}

#[tauri::command]
pub fn jdbc_profiles(app: tauri::AppHandle) -> Result<Vec<JdbcProfile>, String> {
    load_profiles(&initialize(&app)?)
}

#[tauri::command]
pub async fn jdbc_import_jar(app: tauri::AppHandle) -> Result<Option<JdbcJar>, String> {
    let root = initialize(&app)?;
    let Some(path) = crate::baas_file::pick_open_path(app).await? else {
        return Ok(None);
    };
    tokio::task::spawn_blocking(move || import_jar(&root, &path))
        .await
        .map_err(|error| error.to_string())?
        .map(Some)
}

#[tauri::command]
pub async fn jdbc_remove_jar(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = initialize(&app)?;
    let _guard = PROFILE_LOCK.lock().await;
    if load_profiles(&root)?
        .iter()
        .any(|profile| profile.jars.contains(&id))
    {
        return Err("JDBC-JAR wird noch von einem Profil verwendet. Zuerst dessen Treiber ändern oder das Profil entfernen.".into());
    }
    let path = jar_path(&root, &id)?;
    std::fs::remove_file(path).map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(root.join("jars").join(format!("{id}.name")));
    Ok(())
}

fn import_jar(root: &Path, path: &Path) -> Result<JdbcJar, String> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|value| !value.eq_ignore_ascii_case("jar"))
        || path.metadata().map_err(|error| error.to_string())?.len() > MAX_JAR
    {
        return Err("Eine JAR-Datei mit höchstens 256 MiB auswählen.".into());
    }
    let directory = root.join("jars");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    if jars(root)?.len() >= 64 {
        return Err("Höchstens 64 JDBC-JARs können importiert werden.".into());
    }
    let mut source = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut target =
        tempfile::NamedTempFile::new_in(&directory).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut bytes = 0;
    loop {
        let count = source
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > MAX_JAR {
            return Err("JDBC-JAR überschreitet 256 MiB.".into());
        }
        digest.update(&buffer[..count]);
        target
            .write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
    }
    let archive = zip::ZipArchive::new(target.reopen().map_err(|error| error.to_string())?)
        .map_err(|_| "Die Datei ist kein gültiges JDBC-JAR.".to_string())?;
    if archive.len() > 100_000 {
        return Err("JDBC-JAR enthält zu viele Einträge.".into());
    }
    let id = digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "Treiber.jar".into());
    let destination = directory.join(format!("{id}.jar"));
    if !destination.exists() {
        target
            .persist(destination)
            .map_err(|error| error.error.to_string())?;
    }
    std::fs::write(directory.join(format!("{id}.name")), &name)
        .map_err(|error| error.to_string())?;
    Ok(JdbcJar { id, name, bytes })
}

#[tauri::command]
pub async fn jdbc_save_profile(
    app: tauri::AppHandle,
    input: JdbcProfileInput,
) -> Result<JdbcProfile, String> {
    let root = initialize(&app)?;
    validate(&input)?;
    for jar in &input.jars {
        jar_path(&root, jar)?;
    }
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("{:032x}", rand::random::<u128>()));
    if !valid_id(&id) {
        return Err("Ungültige JDBC-Profilkennung.".into());
    }
    let _guard = PROFILE_LOCK.lock().await;
    let mut profiles = load_profiles(&root)?;
    if profiles.len() >= 64 && !profiles.iter().any(|profile| profile.id == id) {
        return Err("Höchstens 64 JDBC-Profile können gespeichert werden.".into());
    }
    let account = format!("backend:jdbc:{id}");
    let old_password = super::secrets::backend_secret(account.clone()).await?;
    if let Some(password) = &input.password {
        super::secrets::set_backend_secret(account.clone(), password.clone()).await?;
    }
    let profile = JdbcProfile {
        id: id.clone(),
        name: input.name.trim().into(),
        driver_class: input.driver_class,
        jars: input.jars,
        url: input.url,
        username: input.username,
        read_only: input.read_only,
        has_password: input
            .password
            .as_ref()
            .or(old_password.as_ref())
            .is_some_and(|password| !password.is_empty()),
    };
    if let Some(current) = profiles.iter_mut().find(|current| current.id == id) {
        *current = profile.clone();
    } else {
        profiles.push(profile.clone());
    }
    let saved = save_profiles(&root, &profiles);
    if let Err(error) = saved {
        let rollback = if let Some(password) = old_password {
            super::secrets::set_backend_secret(account, password).await
        } else {
            super::secrets::remove_backend_secret(account).await
        };
        if rollback.is_err() {
            return Err(format!("{error} Das bisherige JDBC-Passwort konnte im Schlüsselbund nicht wiederhergestellt werden. Profil erneut speichern."));
        }
        return Err(error);
    }
    close_profile(&root, &id).await;
    Ok(profile)
}

#[tauri::command]
pub async fn jdbc_remove_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = initialize(&app)?;
    if !valid_id(&id) {
        return Err("Ungültige JDBC-Profilkennung.".into());
    }
    let _guard = PROFILE_LOCK.lock().await;
    {
        let mut profiles = load_profiles(&root)?;
        profiles.retain(|profile| profile.id != id);
        save_profiles(&root, &profiles)?;
    }
    close_profile(&root, &id).await;
    super::secrets::remove_backend_secret(format!("backend:jdbc:{id}")).await
}

#[tauri::command]
pub async fn jdbc_close_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    close_profile(&initialize(&app)?, &id).await;
    Ok(())
}

struct Bridge {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    requests: u64,
}

impl Drop for Bridge {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

impl Bridge {
    async fn request(&mut self, fields: &[String]) -> Result<Value, String> {
        let request = encode_request(fields)?;
        self.input
            .write_all(&request)
            .await
            .map_err(|_| "JDBC-Prozess ist nicht erreichbar.".to_string())?;
        self.requests += 1;
        self.input
            .flush()
            .await
            .map_err(|_| "JDBC-Prozess ist nicht erreichbar.".to_string())?;
        let response = read_frame(&mut self.output).await?;
        if let Some(error) = response.get("error").and_then(Value::as_str) {
            let state = response
                .get("state")
                .and_then(Value::as_str)
                .unwrap_or("unbekannt");
            return Err(format!(
                "{error} (SQLState {state}). URL, Treiber, Rechte und SQL prüfen."
            ));
        }
        Ok(response)
    }
}

fn encode_request(fields: &[String]) -> Result<Vec<u8>, String> {
    if fields.len() > 4096
        || fields.iter().map(|field| field.len()).sum::<usize>() > MAX_REQUEST / 2
    {
        return Err("JDBC-Anfrage ist zu groß.".into());
    }
    let mut output = fields
        .iter()
        .map(|field| base64::engine::general_purpose::STANDARD.encode(field.as_bytes()))
        .collect::<Vec<_>>()
        .join("\t")
        .into_bytes();
    output.push(b'\n');
    if output.len() > MAX_REQUEST {
        return Err("JDBC-Anfrage überschreitet 2 MiB.".into());
    }
    Ok(output)
}

async fn read_frame(reader: &mut (impl tokio::io::AsyncBufRead + Unpin)) -> Result<Value, String> {
    let mut bytes = Vec::new();
    loop {
        let buffer = reader
            .fill_buf()
            .await
            .map_err(|_| "JDBC-Antwort konnte nicht gelesen werden.".to_string())?;
        if buffer.is_empty() {
            return Err("JDBC-Prozess wurde beendet. JDK und Treiber prüfen.".into());
        }
        let end = buffer.iter().position(|byte| *byte == b'\n');
        let take = end.map_or(buffer.len(), |index| index + 1);
        if bytes.len() + take > MAX_FRAME {
            return Err("JDBC-Antwort überschreitet 8 MiB.".into());
        }
        bytes.extend_from_slice(&buffer[..take]);
        reader.consume(take);
        if end.is_some() {
            break;
        }
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| "JDBC-Prozess hat eine ungültige Antwort geliefert.".into())
}

struct Worker {
    bridge: Option<Bridge>,
    touched: Instant,
}

struct WorkerSlot {
    state: Mutex<Worker>,
    cancel: tokio_util::sync::CancellationToken,
}

type Workers = HashMap<String, Arc<WorkerSlot>>;

fn workers() -> &'static Mutex<Workers> {
    static WORKERS: OnceLock<Mutex<Workers>> = OnceLock::new();
    WORKERS.get_or_init(Default::default)
}

fn worker_key(root: &Path, id: &str) -> String {
    format!("{}:{id}", root.display())
}

async fn close_profile(root: &Path, id: &str) {
    let worker = workers().lock().await.remove(&worker_key(root, id));
    if let Some(worker) = worker {
        worker.cancel.cancel();
        worker.state.lock().await.bridge.take();
    }
}

async fn retire_idle(key: &str, worker: &Arc<WorkerSlot>) -> bool {
    let mut current = worker.state.lock().await;
    if current.touched.elapsed() < IDLE {
        return false;
    }
    worker.cancel.cancel();
    current.bridge.take();
    drop(current);
    let mut cache = workers().lock().await;
    if cache
        .get(key)
        .is_some_and(|cached| Arc::ptr_eq(cached, worker))
    {
        cache.remove(key);
    }
    true
}

async fn worker(root: &Path, id: &str) -> Result<Arc<WorkerSlot>, String> {
    let key = worker_key(root, id);
    let mut cache = workers().lock().await;
    if let Some(worker) = cache.get(&key) {
        return Ok(worker.clone());
    }
    if cache.len() >= MAX_WORKERS {
        return Err("Vier JDBC-Profile sind aktiv. Ein Profil in der Treiberverwaltung trennen oder den Leerlauf abwarten.".into());
    }
    let worker = Arc::new(WorkerSlot {
        state: Mutex::new(Worker {
            bridge: None,
            touched: Instant::now(),
        }),
        cancel: tokio_util::sync::CancellationToken::new(),
    });
    cache.insert(key.clone(), worker.clone());
    let weak = Arc::downgrade(&worker);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(IDLE).await;
            let Some(worker) = weak.upgrade() else {
                break;
            };
            if retire_idle(&key, &worker).await {
                break;
            }
        }
    });
    Ok(worker)
}

async fn start(root: &Path, profile: &JdbcProfile, password: &str) -> Result<Bridge, String> {
    let directory = root.join("bridge");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let source_path = directory.join("L8dbJdbcBridge.java");
    if std::fs::read_to_string(&source_path).ok().as_deref() != Some(SOURCE) {
        let mut temporary =
            tempfile::NamedTempFile::new_in(&directory).map_err(|error| error.to_string())?;
        temporary
            .write_all(SOURCE.as_bytes())
            .map_err(|error| error.to_string())?;
        temporary
            .persist(&source_path)
            .map_err(|error| error.error.to_string())?;
    }
    let paths = profile
        .jars
        .iter()
        .map(|id| jar_path(root, id))
        .collect::<Result<Vec<_>, _>>()?;
    let classpath =
        std::env::join_paths(paths).map_err(|_| "JDBC-Klassenpfad ist ungültig.".to_string())?;
    let mut child = crate::process::command(java_path())
        .arg("-Xms16m")
        .arg("-Xmx192m")
        .arg("-XX:+ExitOnOutOfMemoryError")
        .arg("--class-path")
        .arg(classpath)
        .arg(source_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "JDK 17 oder neuer fehlt. JAVA_HOME und JDBC-Treiber prüfen.".to_string())?;
    let input = child.stdin.take().ok_or("JDBC-Eingabekanal fehlt")?;
    let output = BufReader::new(child.stdout.take().ok_or("JDBC-Ausgabekanal fehlt")?);
    let mut bridge = Bridge {
        child,
        input,
        output,
        requests: 0,
    };
    bridge
        .request(&[
            "open".into(),
            profile.driver_class.clone(),
            profile.url.clone(),
            profile.username.clone(),
            password.into(),
            profile.read_only.to_string(),
        ])
        .await?;
    Ok(bridge)
}

pub struct JdbcAdapter {
    root: PathBuf,
    id: String,
}

impl JdbcAdapter {
    pub fn new(connection_string: &str) -> Result<Self, String> {
        let id = connection_string.strip_prefix("jdbc:l8db:").ok_or(
            "JDBC-Profil in der Treiberverwaltung anlegen und dessen Verbindung verwenden.",
        )?;
        if !valid_id(id) {
            return Err("Ungültiges JDBC-Profil.".into());
        }
        Ok(Self {
            root: root()?,
            id: id.into(),
        })
    }

    async fn request(
        &self,
        operation: &str,
        arguments: Vec<String>,
        maximum: usize,
    ) -> Result<Value, String> {
        let token = super::execution::cancellation_token();
        let deadline = super::execution::query_duration();
        let ready = worker(&self.root, &self.id).await?;
        let operation_future = async {
            let mut worker = ready.state.lock().await;
            let profile = load_profiles(&self.root)?
                .into_iter()
                .find(|profile| profile.id == self.id)
                .ok_or("JDBC-Profil fehlt")?;
            if profile.read_only {
                let sql = match operation {
                    "query" => arguments.first().cloned(),
                    "fetch" | "count" => arguments
                        .get(2)
                        .filter(|filter| !filter.is_empty())
                        .map(|filter| format!("SELECT 1 WHERE {filter}")),
                    _ => None,
                };
                if let Some(sql) = sql {
                    crate::mcp::server::validate_read_query(
                        super::provider::DatabaseKind::Jdbc,
                        sql,
                    )?;
                }
            }
            let mut bridge = match worker.bridge.take() {
                Some(bridge) => bridge,
                None => {
                    let password =
                        super::secrets::backend_secret(format!("backend:jdbc:{}", self.id))
                            .await?
                            .unwrap_or_default();
                    start(&self.root, &profile, &password).await?
                }
            };
            let mut fields = vec![operation.into()];
            if operation != "ping" {
                fields.push(maximum.clamp(1, MAX_ROWS).to_string());
                fields.push(deadline.as_secs().clamp(1, 300).to_string());
            }
            fields.extend(arguments);
            let response = bridge.request(&fields).await;
            worker.touched = Instant::now();
            if response.is_ok() {
                worker.bridge = Some(bridge);
            }
            response
        };
        tokio::select! {
            _ = token.cancelled() => Err("JDBC-Abfrage wurde abgebrochen.".into()),
            _ = ready.cancel.cancelled() => Err("JDBC-Profil wurde getrennt.".into()),
            response = tokio::time::timeout(deadline, operation_future) => response.map_err(|_| "JDBC-Abfrage hat das Zeitlimit überschritten.".to_string())?,
        }
    }

    async fn metadata(
        &self,
        operation: &str,
        arguments: Vec<String>,
    ) -> Result<Vec<Value>, String> {
        let value = self.request(operation, arguments, MAX_ROWS).await?;
        if value["truncated"].as_bool() == Some(true) {
            return Err(
                "JDBC-Metadaten überschreiten 50.000 Einträge. Schema oder Tabelle eingrenzen."
                    .into(),
            );
        }
        let columns = value["columns"].as_array().ok_or("JDBC-Spalten fehlen")?;
        Ok(value["rows"]
            .as_array()
            .ok_or("JDBC-Zeilen fehlen")?
            .iter()
            .map(|row| {
                let mut object = serde_json::Map::new();
                for (index, column) in columns.iter().enumerate() {
                    object.insert(
                        column.as_str().unwrap_or("").to_string(),
                        row[index].clone(),
                    );
                }
                Value::Object(object)
            })
            .collect())
    }

    async fn query(&self, sql: &str, params: &[Option<String>]) -> Result<QueryResult, String> {
        let mut arguments = vec![sql.into()];
        arguments.extend(params.iter().map(|parameter| {
            parameter
                .as_ref()
                .map_or_else(|| "N".into(), |value| format!("S{value}"))
        }));
        let result = self
            .request("query", arguments, super::execution::result_row_cap(10_000))
            .await?;
        decode_result(result)
    }
}

fn string(value: &Value, key: &str) -> String {
    value[key].as_str().map(str::to_string).unwrap_or_default()
}

fn schema_name(row: &Value, requested: Option<&str>) -> String {
    let schema = string(row, "TABLE_SCHEM");
    if schema.is_empty() {
        requested.unwrap_or("$default").to_string()
    } else {
        schema
    }
}

#[derive(Deserialize)]
struct BridgeResult {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    rows_affected: Option<u64>,
    execution_time_ms: u64,
    truncated: bool,
}

fn decode_result(value: Value) -> Result<QueryResult, String> {
    let result: BridgeResult = serde_json::from_value(value)
        .map_err(|_| "JDBC-Abfrageergebnis ist ungültig.".to_string())?;
    let columns = super::unique_column_names(result.columns);
    if columns.len() > 1024
        || result.rows.len() > MAX_ROWS
        || result.rows.iter().any(|row| row.len() != columns.len())
    {
        return Err("JDBC-Abfrageergebnis überschreitet Struktur- oder Zeilenlimits.".into());
    }
    Ok(QueryResult {
        rows: super::rows_to_objects(&columns, result.rows),
        columns,
        rows_affected: result.rows_affected,
        execution_time_ms: result.execution_time_ms,
        truncated: result.truncated,
    })
}

#[async_trait]
impl DatabaseAdapter for JdbcAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        if self.request("ping", Vec::new(), 1).await?["ok"] == true {
            Ok(())
        } else {
            Err("JDBC-Verbindung ist nicht mehr gültig.".into())
        }
    }
    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(self
            .metadata("catalogs", Vec::new())
            .await?
            .iter()
            .map(|row| string(row, "TABLE_CAT"))
            .filter(|name| !name.is_empty())
            .collect())
    }
    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        let schemas: Vec<_> = self
            .metadata("schemas", Vec::new())
            .await?
            .iter()
            .map(|row| string(row, "TABLE_SCHEM"))
            .filter(|name| !name.is_empty())
            .collect();
        Ok(if schemas.is_empty() {
            vec!["$default".into()]
        } else {
            schemas
        })
    }
    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        Ok(self
            .metadata("tables", vec![schema.unwrap_or("").into()])
            .await?
            .iter()
            .map(|row| TableInfo {
                schema: schema_name(row, schema),
                name: string(row, "TABLE_NAME"),
            })
            .collect())
    }
    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        Ok(self
            .metadata("views", vec![schema.unwrap_or("").into()])
            .await?
            .iter()
            .map(|row| TableInfo {
                schema: schema_name(row, schema),
                name: string(row, "TABLE_NAME"),
            })
            .collect())
    }
    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        _table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        Ok(self
            .metadata(
                "columns",
                vec![schema.unwrap_or("").into(), table.unwrap_or("").into()],
            )
            .await?
            .iter()
            .map(|row| ColumnInfo {
                schema: schema_name(row, schema),
                table: string(row, "TABLE_NAME"),
                name: string(row, "COLUMN_NAME"),
                data_type: string(row, "TYPE_NAME"),
            })
            .collect())
    }
    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let keys = self
            .metadata("primary_keys", vec![schema.into(), table.into()])
            .await?;
        Ok(self
            .metadata("columns", vec![schema.into(), table.into()])
            .await?
            .iter()
            .map(|row| DetailedColumnInfo {
                name: string(row, "COLUMN_NAME"),
                data_type: string(row, "TYPE_NAME"),
                is_nullable: row["NULLABLE"].as_i64() != Some(0),
                column_default: row["COLUMN_DEF"].as_str().map(str::to_string),
                is_primary_key: keys
                    .iter()
                    .any(|key| key["COLUMN_NAME"] == row["COLUMN_NAME"]),
                ordinal_position: row["ORDINAL_POSITION"].as_i64().unwrap_or(0) as i32,
                character_maximum_length: row["COLUMN_SIZE"]
                    .as_i64()
                    .and_then(|value| i32::try_from(value).ok()),
                comment: row["REMARKS"].as_str().map(str::to_string),
            })
            .collect())
    }
    async fn fetch_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        limit: i64,
        offset: i64,
        order_by: Option<&str>,
        order_desc: bool,
        _is_view: bool,
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let filter = super::where_clause(filter, allow_raw_filter)?
            .trim_start_matches(" WHERE ")
            .to_string();
        if !(1..=50_000).contains(&limit) || !(0..=1_000_000).contains(&offset) {
            return Err("JDBC-Seite überschreitet Zeilen- oder Offset-Limit.".into());
        }
        let value = self
            .request(
                "fetch",
                vec![
                    schema.into(),
                    table.into(),
                    filter,
                    order_by.unwrap_or("").into(),
                    order_desc.to_string(),
                    offset.to_string(),
                ],
                limit as usize,
            )
            .await?;
        decode_result(value).map(|result| TableData {
            columns: result.columns,
            rows: result.rows,
        })
    }
    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let filter = super::where_clause(filter, allow_raw_filter)?
            .trim_start_matches(" WHERE ")
            .to_string();
        let value = self
            .request("count", vec![schema.into(), table.into(), filter], 1)
            .await?;
        value["rows"][0][0]
            .as_i64()
            .or_else(|| {
                value["rows"][0][0]
                    .as_str()
                    .and_then(|value| value.parse().ok())
            })
            .ok_or_else(|| "JDBC-Zeilenzahl ist ungültig.".into())
    }
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        self.query(sql, &[]).await
    }
    async fn execute_query_with_params(
        &self,
        sql: &str,
        params: &[Option<String>],
    ) -> Result<QueryResult, String> {
        self.query(sql, params).await
    }
}

#[cfg(test)]
#[path = "jdbc_tests.rs"]
mod tests;
