use super::{crypto, login::LoginLimits, model::*};
use crate::db::{
    self,
    execution::{self, ExecutionOptions},
    pool::{create_pool_state, PoolState},
    DatabaseKind,
};
use axum::{
    body::Bytes,
    extract::{ConnectInfo, DefaultBodyLimit, Path as RoutePath, RawQuery, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

#[derive(Clone)]
pub struct ServerState {
    pub db: Arc<Mutex<Connection>>,
    key: [u8; 32],
    pool: PoolState,
    queries: Arc<Semaphore>,
    auth: Arc<Semaphore>,
    attempts: Arc<Mutex<LoginLimits>>,
    jobs: Arc<Mutex<HashMap<String, String>>>,
    allow_local_files: bool,
}

type ApiResult = Result<Value, ApiError>;

pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}

impl From<String> for ApiError {
    fn from(value: String) -> Self {
        Self(StatusCode::BAD_REQUEST, value)
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(_: rusqlite::Error) -> Self {
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Workspace-Daten konnten nicht verarbeitet werden.".into(),
        )
    }
}

fn valid_sql(sql: &str) -> bool {
    !sql.trim().is_empty()
        && sql.len() <= MAX_SQL_BYTES
        && !sql
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}

fn denied() -> ApiError {
    ApiError(
        StatusCode::FORBIDDEN,
        "Dafür fehlen die Workspace-Rechte.".into(),
    )
}
fn missing() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "Eintrag nicht gefunden.".into())
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, ApiError> {
    serde_json::from_value(value)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Ungültige Anfrage.".into()))
}
fn text(value: &Value, key: &str, maximum: usize) -> Result<String, ApiError> {
    value[key]
        .as_str()
        .filter(|value| {
            !value.trim().is_empty()
                && value.len() <= maximum
                && !value.chars().any(char::is_control)
        })
        .map(|value| value.trim().to_string())
        .ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, format!("Feld {key} ist ungültig.")))
}
fn administrator(user: &WorkspaceUser) -> Result<(), ApiError> {
    if user.role == "admin" {
        Ok(())
    } else {
        Err(denied())
    }
}
fn role(value: &str) -> Result<&str, ApiError> {
    if matches!(value, "admin" | "member") {
        Ok(value)
    } else {
        Err("Rolle muss admin oder member sein.".to_string().into())
    }
}
fn email(value: &str) -> Result<String, ApiError> {
    let value = value.trim().to_lowercase();
    if value.len() > 254
        || value.chars().any(|c| c.is_control() || c.is_whitespace())
        || !value
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.'))
    {
        return Err("E-Mail-Adresse ist ungültig.".to_string().into());
    }
    Ok(value)
}

impl ServerState {
    pub fn open(root: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(root)
            .map_err(|_| "Workspace-Verzeichnis konnte nicht angelegt werden")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "Workspace-Verzeichnis konnte nicht geschützt werden")?;
        }
        let path = root.join("workspace.sqlite");
        let db =
            Connection::open(&path).map_err(|_| "Workspace-Datei konnte nicht geöffnet werden")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| "Workspace-Datei konnte nicht geschützt werden")?;
        }
        Self::initialize(db, crypto::master_key(root)?)
    }

    pub fn initialize(db: Connection, key: [u8; 32]) -> Result<Self, String> {
        db.busy_timeout(Duration::from_secs(3))
            .map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,role TEXT NOT NULL CHECK(role IN ('admin','member')),active INTEGER NOT NULL DEFAULT 1,salt BLOB NOT NULL,hash BLOB NOT NULL);
          CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);
          CREATE TABLE IF NOT EXISTS invitations(hash TEXT PRIMARY KEY,email TEXT NOT NULL,role TEXT NOT NULL,expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,database_name TEXT,credentials TEXT NOT NULL,approval INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS grants(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,access TEXT NOT NULL CHECK(access IN ('read','write')),PRIMARY KEY(user_id,connection_id));
          CREATE TABLE IF NOT EXISTS saved_queries(id TEXT PRIMARY KEY,connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,name TEXT NOT NULL,sql TEXT NOT NULL,author TEXT NOT NULL REFERENCES users(id),revision INTEGER NOT NULL DEFAULT 1);
          CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY,connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,author TEXT NOT NULL REFERENCES users(id),sql TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,connection_id TEXT,outcome TEXT NOT NULL,created INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS log_created ON logs(created);
          CREATE INDEX IF NOT EXISTS pending_author ON pending(author,created); UPDATE pending SET status='failed' WHERE status='running';").map_err(|_| "Workspace-Schema konnte nicht angelegt werden")?;
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            key,
            pool: create_pool_state(),
            queries: Arc::new(Semaphore::new(4)),
            auth: Arc::new(Semaphore::new(2)),
            attempts: Arc::new(Mutex::new(LoginLimits::default())),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            allow_local_files: false,
        })
    }

    pub fn with_local_files(mut self, allowed: bool) -> Self {
        self.allow_local_files = allowed;
        self
    }

    #[cfg(test)]
    pub(super) fn active_jobs(&self) -> usize {
        self.jobs.lock().unwrap().len()
    }

    fn query_slot(&self) -> Result<OwnedSemaphorePermit, ApiError> {
        self.queries.clone().try_acquire_owned().map_err(|_| {
            ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "Vier Workspace-Abfragen laufen bereits. Bitte später erneut versuchen.".into(),
            )
        })
    }

    fn cancel_jobs(&self, user_id: Option<&str>) {
        if let Ok(jobs) = self.jobs.lock() {
            for (job, owner) in jobs
                .iter()
                .filter(|(_, owner)| user_id.is_none_or(|id| id == owner.as_str()))
            {
                let _ = owner;
                let _ = execution::cancel(job);
            }
        }
    }

    fn locked(&self) -> Result<std::sync::MutexGuard<'_, Connection>, ApiError> {
        self.db.lock().map_err(|_| {
            ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Workspace ist blockiert.".into(),
            )
        })
    }

    pub fn bootstrap(&self, credentials: Credentials) -> Result<(), String> {
        let email = email(&credentials.email).map_err(|e| e.1)?;
        let salt = crypto::random::<16>()?;
        let hash = crypto::password_hash(&credentials.password, &salt)?;
        let db = self.db.lock().map_err(|_| "Workspace ist blockiert")?;
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if count > 0 {
            return Ok(());
        }
        db.execute(
            "INSERT INTO users(id,email,role,salt,hash) VALUES(?1,?2,'admin',?3,?4)",
            params![crypto::id()?, email, salt.as_slice(), hash],
        )
        .map_err(|_| "Administrator konnte nicht angelegt werden")?;
        Ok(())
    }

    fn actor(&self, headers: &HeaderMap) -> Result<WorkspaceUser, ApiError> {
        let token = headers
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "))
            .filter(|token| token.len() <= 200)
            .ok_or_else(|| {
                ApiError(
                    StatusCode::UNAUTHORIZED,
                    "Bitte am Workspace anmelden.".into(),
                )
            })?;
        self.locked()?.query_row("SELECT u.id,u.email,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=?1 AND s.expires>?2 AND u.active=1", params![crypto::hash_token(token),now()], |row| Ok(WorkspaceUser{id:row.get(0)?,email:row.get(1)?,role:row.get(2)?,active:row.get(3)?})).optional()?.ok_or_else(|| ApiError(StatusCode::UNAUTHORIZED, "Workspace-Sitzung ist abgelaufen oder wurde widerrufen.".into()))
    }

    fn audit(
        &self,
        user: &WorkspaceUser,
        action: &str,
        connection: Option<&str>,
        outcome: &str,
    ) -> Result<(), ApiError> {
        let db = self.locked()?;
        db.execute(
            "INSERT INTO logs(actor,action,connection_id,outcome,created) VALUES(?1,?2,?3,?4,?5)",
            params![user.email, action, connection, outcome, now()],
        )?;
        db.execute(
            "DELETE FROM logs WHERE id <= (SELECT COALESCE(MAX(id),0)-?1 FROM logs)",
            [MAX_LOG_ROWS],
        )?;
        Ok(())
    }

    fn access(
        &self,
        user: &WorkspaceUser,
        id: &str,
    ) -> Result<(SharedConnection, String), ApiError> {
        let db = self.locked()?;
        let row = db
            .query_row(
                "SELECT name,kind,database_name,credentials,approval FROM connections WHERE id=?1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, bool>(4)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(missing)?;
        let access = if user.role == "admin" {
            "write".to_string()
        } else {
            db.query_row(
                "SELECT access FROM grants WHERE user_id=?1 AND connection_id=?2",
                params![user.id, id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(denied)?
        };
        let kind: DatabaseKind = serde_json::from_str(&row.1).map_err(|_| missing())?;
        if !matches!(
            kind,
            DatabaseKind::Postgres | DatabaseKind::Mysql | DatabaseKind::Sqlite
        ) || kind == DatabaseKind::Sqlite && !self.allow_local_files
        {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "Dieser Zugang ist im aktuellen Workspace-Servermodus nicht freigegeben.".into(),
            ));
        }
        let credentials = crypto::open(&self.key, id, &row.3)?;
        Ok((
            SharedConnection {
                id: id.into(),
                name: row.0,
                kind,
                database: row.2,
                access,
                require_approval: row.4,
            },
            credentials,
        ))
    }
}

pub fn router(state: ServerState) -> Router {
    Router::new()
        .route(
            "/health",
            get(|| async { Json(json!({"service":"l8db-workspace","version":1})) }),
        )
        .route("/api/login", post(login))
        .route("/api/invitations/accept", post(accept_invitation))
        .route("/api/{*path}", any(api))
        .layer(DefaultBodyLimit::max(MAX_SQL_BYTES + 65536))
        .with_state(state)
}

fn non_browser(headers: &HeaderMap) -> Result<(), ApiError> {
    if headers.contains_key("origin") {
        return Err(denied());
    }
    Ok(())
}

async fn login(
    State(state): State<ServerState>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<Credentials>,
) -> Result<Json<Value>, ApiError> {
    non_browser(&headers)?;
    let normalized = email(&input.email)?;
    let _permit = state.auth.clone().try_acquire_owned().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Anmeldung ist ausgelastet.".into(),
        )
    })?;
    let row = state
        .locked()?
        .query_row(
            "SELECT id,email,role,active,salt,hash FROM users WHERE email=?1",
            [&normalized],
            |row| {
                Ok((
                    WorkspaceUser {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        role: row.get(2)?,
                        active: row.get(3)?,
                    },
                    row.get::<_, Vec<u8>>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                ))
            },
        )
        .optional()?;
    if !state.attempts.lock().map_err(|_| denied())?.admit(
        row.as_ref().map(|row| row.0.id.as_str()),
        &normalized,
        peer.ip(),
        Instant::now(),
    ) {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Zu viele Anmeldeversuche. Bitte fünf Minuten warten.".into(),
        ));
    }
    let (salt, expected) = row
        .as_ref()
        .map(|row| (row.1.clone(), row.2.clone()))
        .unwrap_or((vec![0; 16], vec![0; 32]));
    let valid = tokio::task::spawn_blocking(move || {
        crypto::password_matches(&input.password, &salt, &expected)
    })
    .await
    .map_err(|_| denied())?;
    let user = match row.filter(|row| valid && row.0.active) {
        Some((user, _, _)) => user,
        None => {
            let limited = state
                .attempts
                .lock()
                .map_err(|_| denied())?
                .failed(peer.ip(), Instant::now());
            return Err(ApiError(
                if limited {
                    StatusCode::TOO_MANY_REQUESTS
                } else {
                    StatusCode::UNAUTHORIZED
                },
                "E-Mail oder Passwort ist falsch oder die Anmeldung ist vorübergehend begrenzt."
                    .into(),
            ));
        }
    };
    let token = crypto::id()?;
    {
        let db = state.locked()?;
        db.execute("DELETE FROM sessions WHERE expires<=?1", [now()])?;
        db.execute("DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions WHERE user_id=?1 ORDER BY expires DESC LIMIT -1 OFFSET 4)",[&user.id])?;
        db.execute(
            "INSERT INTO sessions(hash,user_id,expires) VALUES(?1,?2,?3)",
            params![crypto::hash_token(&token), user.id, now() + 12 * 3600],
        )?;
    }
    state
        .attempts
        .lock()
        .map_err(|_| denied())?
        .succeeded(&user.id, &normalized);
    state.audit(&user, "login", None, "ok")?;
    Ok(Json(json!({"token":token,"user":user})))
}

async fn accept_invitation(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    non_browser(&headers)?;
    let token = text(&body, "token", 200)?;
    let email = email(&text(&body, "email", 254)?)?;
    let password = body["password"].as_str().ok_or_else(denied)?.to_string();
    let _permit = state.auth.clone().try_acquire_owned().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Anmeldung ist ausgelastet.".into(),
        )
    })?;
    let salt = crypto::random::<16>()?;
    let hash = tokio::task::spawn_blocking(move || crypto::password_hash(&password, &salt))
        .await
        .map_err(|_| denied())??;
    let mut db = state.locked()?;
    let tx = db.transaction()?;
    let role: String = tx
        .query_row(
            "SELECT role FROM invitations WHERE hash=?1 AND email=?2 AND expires>?3",
            params![crypto::hash_token(&token), email, now()],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| {
            ApiError(
                StatusCode::BAD_REQUEST,
                "Einladung ungültig oder abgelaufen.".into(),
            )
        })?;
    tx.execute(
        "INSERT INTO users(id,email,role,salt,hash) VALUES(?1,?2,?3,?4,?5)",
        params![crypto::id()?, email, role, salt.as_slice(), hash],
    )?;
    tx.execute(
        "DELETE FROM invitations WHERE hash=?1",
        [crypto::hash_token(&token)],
    )?;
    tx.commit()?;
    Ok(Json(json!({"accepted":true})))
}

async fn api(
    State(state): State<ServerState>,
    RoutePath(path): RoutePath<String>,
    method: Method,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    non_browser(&headers)?;
    let user = state.actor(&headers)?;
    let mut body = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body)
            .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Ungültiges JSON.".into()))?
    };
    if let Some(query) = query {
        if !body.is_object() {
            body = json!({});
        }
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            let numeric = if method == Method::GET && key == "offset" {
                value.parse::<u64>().ok().map(Value::from)
            } else {
                None
            };
            body[key.as_ref()] = numeric.unwrap_or_else(|| Value::String(value.into_owned()));
        }
    }
    let segments: Vec<&str> = path.split('/').collect();
    dispatch(&state, &user, &method, &segments, body)
        .await
        .map(Json)
}

async fn dispatch(
    state: &ServerState,
    user: &WorkspaceUser,
    method: &Method,
    path: &[&str],
    body: Value,
) -> ApiResult {
    match (method.as_str(), path) {
        ("GET", ["me"]) => Ok(json!(user)),
        ("POST", ["logout"]) => {
            state
                .locked()?
                .execute("DELETE FROM sessions WHERE user_id=?1", [&user.id])?;
            state.cancel_jobs(Some(&user.id));
            state.audit(user, "logout", None, "ok")?;
            Ok(json!({"ok":true}))
        }
        ("GET", ["users"]) => {
            administrator(user)?;
            let offset = body["offset"].as_u64().unwrap_or(0).min(10_000_000) as i64;
            let db = state.locked()?;
            let mut statement = db.prepare(
                "SELECT id,email,role,active FROM users ORDER BY email LIMIT 101 OFFSET ?1",
            )?;
            let mut users = statement
                .query_map([offset], |row| {
                    Ok(WorkspaceUser {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        role: row.get(2)?,
                        active: row.get(3)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let more = users.len() > PAGE_SIZE;
            users.truncate(PAGE_SIZE);
            Ok(json!({"items":users,"more":more}))
        }
        ("PATCH", ["users", id]) => {
            administrator(user)?;
            let target_role = role(body["role"].as_str().unwrap_or("member"))?;
            let active = body["active"].as_bool().unwrap_or(true);
            {
                let mut db = state.locked()?;
                let tx = db.transaction()?;
                let (old_role, was_active): (String, bool) = tx
                    .query_row("SELECT role,active FROM users WHERE id=?1", [id], |row| {
                        Ok((row.get(0)?, row.get(1)?))
                    })
                    .optional()?
                    .ok_or_else(missing)?;
                if was_active && old_role == "admin" && (!active || target_role != "admin") {
                    let admins: i64 = tx.query_row(
                        "SELECT COUNT(*) FROM users WHERE role='admin' AND active=1",
                        [],
                        |row| row.get(0),
                    )?;
                    if admins <= 1 {
                        return Err("Der letzte aktive Administrator bleibt erhalten."
                            .to_string()
                            .into());
                    }
                }
                tx.execute(
                    "UPDATE users SET role=?1,active=?2 WHERE id=?3",
                    params![target_role, active, id],
                )?;
                tx.execute("DELETE FROM sessions WHERE user_id=?1", [id])?;
                tx.commit()?;
            }
            state.cancel_jobs(Some(id));
            state.audit(user, "user.update", None, "ok")?;
            Ok(json!({"ok":true}))
        }
        ("POST", ["users", id, "revoke"]) => {
            administrator(user)?;
            state
                .locked()?
                .execute("DELETE FROM sessions WHERE user_id=?1", [id])?;
            state.cancel_jobs(Some(id));
            state.audit(user, "session.revoke", None, "ok")?;
            Ok(json!({"ok":true}))
        }
        ("POST", ["invitations"]) => {
            administrator(user)?;
            let email = email(&text(&body, "email", 254)?)?;
            let role = role(body["role"].as_str().unwrap_or("member"))?;
            let token = crypto::id()?;
            {
                let db = state.locked()?;
                db.execute(
                    "DELETE FROM invitations WHERE expires<=?1 OR email=?2",
                    params![now(), email],
                )?;
                let count: i64 =
                    db.query_row("SELECT COUNT(*) FROM invitations", [], |row| row.get(0))?;
                if count >= 1000 {
                    return Err("Höchstens 1000 offene Einladungen erlaubt."
                        .to_string()
                        .into());
                }
                db.execute(
                    "INSERT INTO invitations(hash,email,role,expires) VALUES(?1,?2,?3,?4)",
                    params![crypto::hash_token(&token), email, role, now() + 86400],
                )?;
            }
            state.audit(user, "invitation.create", None, "ok")?;
            Ok(json!({"token":token,"email":email,"expiresAt":now()+86400}))
        }
        ("DELETE", ["invitations", invitation]) => {
            administrator(user)?;
            state
                .locked()?
                .execute("DELETE FROM invitations WHERE hash=?1", [invitation])?;
            state.audit(user, "invitation.revoke", None, "ok")?;
            Ok(json!({"ok":true}))
        }
        ("GET", ["invitations"]) => {
            administrator(user)?;
            let db = state.locked()?;
            let offset = body["offset"].as_u64().unwrap_or(0).min(10_000_000) as i64;
            let mut statement=db.prepare("SELECT hash,email,role,expires FROM invitations WHERE expires>?1 ORDER BY expires LIMIT 101 OFFSET ?2")?;
            let mut items=statement.query_map(params![now(),offset],|row|Ok(json!({"id":row.get::<_,String>(0)?,"email":row.get::<_,String>(1)?,"role":row.get::<_,String>(2)?,"expiresAt":row.get::<_,i64>(3)?})))?.collect::<Result<Vec<_>,_>>()?;
            let more = items.len() > PAGE_SIZE;
            items.truncate(PAGE_SIZE);
            Ok(json!({"items":items,"more":more}))
        }
        ("GET", ["connections"]) => {
            let offset = body["offset"].as_u64().unwrap_or(0).min(10_000_000) as i64;
            let db = state.locked()?;
            let mut statement=db.prepare("SELECT c.id,c.name,c.kind,c.database_name,c.approval,CASE WHEN ?1='admin' THEN 'write' ELSE g.access END FROM connections c LEFT JOIN grants g ON g.connection_id=c.id AND g.user_id=?2 WHERE ?1='admin' OR g.access IS NOT NULL ORDER BY c.name LIMIT 101 OFFSET ?3")?;
            let mut items = statement
                .query_map(params![user.role, user.id, offset], |row| {
                    let raw: String = row.get(2)?;
                    Ok(SharedConnection {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        kind: serde_json::from_str(&raw)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?,
                        database: row.get(3)?,
                        require_approval: row.get(4)?,
                        access: row.get(5)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let more = items.len() > PAGE_SIZE;
            items.truncate(PAGE_SIZE);
            Ok(json!({"items":items,"more":more}))
        }
        ("POST", ["connections"]) => {
            administrator(user)?;
            let input: ConnectionInput = decode(body)?;
            if !matches!(
                input.kind,
                DatabaseKind::Postgres | DatabaseKind::Mysql | DatabaseKind::Sqlite
            ) {
                return Err("Workspace-Verbindungen unterstützen PostgreSQL, MySQL und lokal freigegebenes SQLite.".to_string().into());
            }
            if input.kind == DatabaseKind::Sqlite && !state.allow_local_files {
                return Err(
                    "SQLite-Dateien benötigen den ausdrücklich lokalen Workspace-Modus."
                        .to_string()
                        .into(),
                );
            }
            if input.name.trim().is_empty() || input.name.len() > 200 {
                return Err("Verbindungsname ungültig.".to_string().into());
            }
            if input.database.as_ref().is_some_and(|database| {
                database.len() > 256 || database.chars().any(char::is_control)
            }) {
                return Err(
                    "Datenbankname darf höchstens 256 Bytes und keine Steuerzeichen enthalten."
                        .to_string()
                        .into(),
                );
            }
            let id = input.id.unwrap_or(crypto::id()?);
            if id.len() > 100
                || id.is_empty()
                || !id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                return Err("Verbindungs-ID ungültig.".to_string().into());
            }
            let kind = serde_json::to_string(&input.kind).map_err(|_| denied())?;
            if input
                .connection_string
                .as_ref()
                .is_none_or(|raw| raw.trim().is_empty())
            {
                let old_kind: Option<String> = state
                    .locked()?
                    .query_row("SELECT kind FROM connections WHERE id=?1", [&id], |row| {
                        row.get(0)
                    })
                    .optional()?;
                if old_kind.as_ref().is_some_and(|previous| previous != &kind) {
                    return Err(
                        "Ein neuer Datenbanktyp benötigt eine neue Verbindungsadresse."
                            .to_string()
                            .into(),
                    );
                }
            }
            let credentials =
                if let Some(raw) = input.connection_string.filter(|s| !s.trim().is_empty()) {
                    if raw.len() > 65536 || raw.starts_with("workspace:") {
                        return Err("Verbindungsadresse ungültig.".to_string().into());
                    }
                    let _ = db::create_adapter_from_string(
                        input.kind,
                        &raw,
                        input.database.as_deref(),
                        state.pool.clone(),
                    )?;
                    crypto::seal(&state.key, &id, &raw)?
                } else {
                    state
                        .locked()?
                        .query_row(
                            "SELECT credentials FROM connections WHERE id=?1",
                            [&id],
                            |row| row.get(0),
                        )
                        .optional()?
                        .ok_or_else(|| {
                            ApiError(
                                StatusCode::BAD_REQUEST,
                                "Eine Verbindungsadresse ist erforderlich.".into(),
                            )
                        })?
                };
            {
                let db = state.locked()?;
                db.execute("INSERT INTO connections(id,name,kind,database_name,credentials,approval) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,database_name=excluded.database_name,credentials=excluded.credentials,approval=excluded.approval",params![id,input.name.trim(),kind,input.database,credentials,input.require_approval])?;
                db.execute("UPDATE pending SET status='cancelled' WHERE connection_id=?1 AND status='pending'",[&id])?;
            }
            state.cancel_jobs(None);
            state.audit(user, "connection.save", Some(&id), "ok")?;
            Ok(json!({"id":id}))
        }
        ("DELETE", ["connections", id]) => {
            administrator(user)?;
            state
                .locked()?
                .execute("DELETE FROM connections WHERE id=?1", [id])?;
            state.cancel_jobs(None);
            state.audit(user, "connection.delete", Some(id), "ok")?;
            Ok(json!({"ok":true}))
        }
        ("GET", ["connections", id, "grants"]) => {
            administrator(user)?;
            state.access(user, id)?;
            let selected = body["users"].as_str().unwrap_or("");
            if selected.len() > 10_000 {
                return Err(denied());
            }
            let db = state.locked()?;
            let mut statement=db.prepare("SELECT g.user_id,u.email,g.access FROM grants g JOIN users u ON u.id=g.user_id WHERE g.connection_id=?1 AND (?2='' OR instr(','||?2||',',','||g.user_id||',')>0) ORDER BY u.email LIMIT 101")?;
            let mut items=statement.query_map(params![id,selected],|row|Ok(json!({"userId":row.get::<_,String>(0)?,"email":row.get::<_,String>(1)?,"access":row.get::<_,String>(2)?})))?.collect::<Result<Vec<_>,_>>()?;
            let more = items.len() > PAGE_SIZE;
            items.truncate(PAGE_SIZE);
            Ok(json!({"items":items,"more":more}))
        }
        ("PUT", ["connections", id, "grants"]) => {
            administrator(user)?;
            state.access(user, id)?;
            let input: GrantInput = decode(body)?;
            {
                let db = state.locked()?;
                if input.access == "none" {
                    db.execute(
                        "DELETE FROM grants WHERE user_id=?1 AND connection_id=?2",
                        params![input.user_id, id],
                    )?;
                } else if matches!(input.access.as_str(), "read" | "write") {
                    db.execute("INSERT INTO grants(user_id,connection_id,access) VALUES(?1,?2,?3) ON CONFLICT(user_id,connection_id) DO UPDATE SET access=excluded.access",params![input.user_id,id,input.access])?;
                } else {
                    return Err("Zugriff muss read, write oder none sein."
                        .to_string()
                        .into());
                }
            }
            state.cancel_jobs(Some(&input.user_id));
            state.audit(user, "grant.update", Some(id), "ok")?;
            Ok(json!({"ok":true}))
        }
        ("POST", ["connections", id, "query"]) => {
            let input: QueryInput = decode(body)?;
            execute_query(state, user, id, input, false, None).await
        }
        ("POST", ["connections", id, "cancel"]) => {
            state.access(user, id)?;
            let job = text(&body, "jobId", 100)?;
            let key = format!("workspace:{}:{}", user.id, job);
            if state.jobs.lock().map_err(|_| denied())?.get(&key) != Some(&user.id) {
                return Ok(json!({"cancelled":false}));
            }
            Ok(json!({"cancelled":execution::cancel(&key)?}))
        }
        ("POST", ["connections", id, "metadata"]) => metadata(state, user, id, decode(body)?).await,
        ("GET", ["queries"]) => {
            let connection = text(&body, "connectionId", 100)?;
            state.access(user, &connection)?;
            let offset = body["offset"].as_u64().unwrap_or(0).min(10_000_000) as i64;
            let db = state.locked()?;
            let mut statement=db.prepare("SELECT id,connection_id,name,substr(sql,1,256),author,revision FROM saved_queries WHERE connection_id=?1 ORDER BY name LIMIT 101 OFFSET ?2")?;
            let mut items = statement
                .query_map(params![connection, offset], |row| {
                    Ok(json!({"id":row.get::<_,String>(0)?,"connectionId":row.get::<_,String>(1)?,"name":row.get::<_,String>(2)?,"sqlPreview":row.get::<_,String>(3)?,"author":row.get::<_,String>(4)?,"revision":row.get::<_,i64>(5)?}))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let more = items.len() > PAGE_SIZE;
            items.truncate(PAGE_SIZE);
            Ok(json!({"items":items,"more":more}))
        }
        ("GET", ["queries", id]) => {
            let query:SharedQuery=state.locked()?.query_row("SELECT id,connection_id,name,sql,author,revision FROM saved_queries WHERE id=?1",[id],|row|Ok(SharedQuery{id:row.get(0)?,connection_id:row.get(1)?,name:row.get(2)?,sql:row.get(3)?,author:row.get(4)?,revision:row.get(5)?})).optional()?.ok_or_else(missing)?;
            state.access(user, &query.connection_id)?;
            Ok(json!(query))
        }
        ("POST", ["queries"]) => {
            let connection = text(&body, "connectionId", 100)?;
            state.access(user, &connection)?;
            let name = text(&body, "name", 200)?;
            let sql = body["sql"]
                .as_str()
                .filter(|sql| valid_sql(sql))
                .ok_or_else(denied)?;
            let id = body["id"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or(crypto::id()?);
            let revision = {
                let mut db = state.locked()?;
                let tx = db.transaction()?;
                let previous:Option<(String,String,i64,i64)>=tx.query_row("SELECT author,connection_id,revision,length(CAST(sql AS BLOB)) FROM saved_queries WHERE id=?1",[&id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional()?;
                if let Some((author, old_connection, old_revision, _)) = previous.as_ref() {
                    if author != &user.id && user.role != "admin" {
                        return Err(denied());
                    }
                    if old_connection != &connection {
                        return Err(denied());
                    }
                    if body["expectedRevision"].as_i64() != Some(*old_revision) {
                        return Err(ApiError(StatusCode::CONFLICT,"Die gemeinsame SQL-Abfrage wurde inzwischen geändert. Bitte neu laden und Änderungen abgleichen.".into()));
                    }
                }
                let (count, bytes): (i64, i64) = tx.query_row(
                    "SELECT count(*),COALESCE(sum(length(CAST(sql AS BLOB))),0) FROM saved_queries",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                if previous.is_none() && count >= 1000
                    || bytes - previous.as_ref().map(|row| row.3).unwrap_or(0) + sql.len() as i64
                        > 8 * 1024 * 1024
                {
                    return Err("Gemeinsame SQL-Abfragen überschreiten 1000 Einträge oder 8 MB. Bitte alte Abfragen löschen.".to_string().into());
                }
                let revision = previous.as_ref().map(|row| row.2 + 1).unwrap_or(1);
                tx.execute("INSERT INTO saved_queries(id,connection_id,name,sql,author,revision) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sql=excluded.sql,revision=excluded.revision",params![id,connection,name,sql,user.id,revision])?;
                tx.commit()?;
                revision
            };
            state.audit(user, "query.save", Some(&connection), "ok")?;
            Ok(json!({"id":id,"revision":revision}))
        }
        ("DELETE", ["queries", id]) => {
            let (connection, author): (String, String) = state
                .locked()?
                .query_row(
                    "SELECT connection_id,author FROM saved_queries WHERE id=?1",
                    [id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?
                .ok_or_else(missing)?;
            state.access(user, &connection)?;
            if author != user.id && user.role != "admin" {
                return Err(denied());
            }
            state
                .locked()?
                .execute("DELETE FROM saved_queries WHERE id=?1", [id])?;
            state.audit(user, "query.delete", Some(&connection), "ok")?;
            Ok(json!({"ok":true}))
        }
        ("GET", ["logs"]) => {
            administrator(user)?;
            let offset = body["offset"].as_u64().unwrap_or(0).min(10_000_000) as i64;
            let db = state.locked()?;
            let mut statement=db.prepare("SELECT id,actor,action,connection_id,outcome,created FROM logs ORDER BY id DESC LIMIT 101 OFFSET ?1")?;
            let mut items = statement
                .query_map([offset], |row| {
                    Ok(WorkspaceLog {
                        id: row.get(0)?,
                        actor: row.get(1)?,
                        action: row.get(2)?,
                        connection_id: row.get(3)?,
                        outcome: row.get(4)?,
                        created_at: row.get(5)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let more = items.len() > PAGE_SIZE;
            items.truncate(PAGE_SIZE);
            Ok(json!({"items":items,"more":more}))
        }
        ("GET", ["pending"]) => {
            let offset = body["offset"].as_u64().unwrap_or(0).min(10_000_000) as i64;
            let db = state.locked()?;
            let mut statement=db.prepare("SELECT id,connection_id,author,substr(sql,1,256),status,created FROM pending WHERE ?1='admin' OR author=?2 ORDER BY created DESC LIMIT 101 OFFSET ?3")?;
            let mut items = statement
                .query_map(params![user.role, user.id, offset], |row| {
                    Ok(json!({"id":row.get::<_,String>(0)?,"connectionId":row.get::<_,String>(1)?,"author":row.get::<_,String>(2)?,"sqlPreview":row.get::<_,String>(3)?,"status":row.get::<_,String>(4)?,"createdAt":row.get::<_,i64>(5)?}))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let more = items.len() > PAGE_SIZE;
            items.truncate(PAGE_SIZE);
            Ok(json!({"items":items,"more":more}))
        }
        ("GET", ["pending", id]) => {
            let query: PendingQuery = state
                .locked()?
                .query_row(
                    "SELECT id,connection_id,author,sql,status,created FROM pending WHERE id=?1",
                    [id],
                    |row| {
                        Ok(PendingQuery {
                            id: row.get(0)?,
                            connection_id: row.get(1)?,
                            author: row.get(2)?,
                            sql: row.get(3)?,
                            status: row.get(4)?,
                            created_at: row.get(5)?,
                        })
                    },
                )
                .optional()?
                .ok_or_else(missing)?;
            if user.role != "admin" && query.author != user.id {
                return Err(denied());
            }
            state.access(user, &query.connection_id)?;
            Ok(json!(query))
        }
        ("POST", ["pending", id, decision]) if matches!(*decision, "approve" | "reject") => {
            administrator(user)?;
            let pending: PendingQuery = state
                .locked()?
                .query_row(
                    "SELECT id,connection_id,author,sql,status,created FROM pending WHERE id=?1",
                    [id],
                    |row| {
                        Ok(PendingQuery {
                            id: row.get(0)?,
                            connection_id: row.get(1)?,
                            author: row.get(2)?,
                            sql: row.get(3)?,
                            status: row.get(4)?,
                            created_at: row.get(5)?,
                        })
                    },
                )
                .optional()?
                .ok_or_else(missing)?;
            if pending.status != "pending" || pending.created_at < now() - 86400 {
                return Err("Anfrage wurde bereits bearbeitet.".to_string().into());
            }
            if pending.author == user.id {
                return Err("Eigene Abfragen können nicht selbst freigegeben werden."
                    .to_string()
                    .into());
            }
            let author: WorkspaceUser = state
                .locked()?
                .query_row(
                    "SELECT id,email,role,active FROM users WHERE id=?1 AND active=1",
                    [&pending.author],
                    |row| {
                        Ok(WorkspaceUser {
                            id: row.get(0)?,
                            email: row.get(1)?,
                            role: row.get(2)?,
                            active: row.get(3)?,
                        })
                    },
                )
                .optional()?
                .ok_or_else(denied)?;
            let (connection, _) = state.access(&author, &pending.connection_id)?;
            if connection.access != "write" {
                return Err(denied());
            }
            let reserved_slot = if *decision == "approve" {
                Some(state.query_slot()?)
            } else {
                None
            };
            let next = if *decision == "approve" {
                "running"
            } else {
                "rejected"
            };
            let claimed = state.locked()?.execute(
                "UPDATE pending SET status=?1 WHERE id=?2 AND status='pending'",
                params![next, id],
            )?;
            if claimed != 1 {
                return Err("Anfrage wurde bereits bearbeitet.".to_string().into());
            }
            if *decision == "reject" {
                state.audit(user, "query.reject", Some(&pending.connection_id), "ok")?;
                return Ok(json!({"ok":true}));
            }
            let result = execute_query(
                state,
                &author,
                &pending.connection_id,
                QueryInput {
                    sql: pending.sql,
                    job_id: Some(format!("approved-{id}")),
                    max_rows: Some(MAX_RESULT_ROWS),
                },
                true,
                reserved_slot,
            )
            .await;
            state.locked()?.execute(
                "UPDATE pending SET status=?1 WHERE id=?2",
                params![if result.is_ok() { "executed" } else { "failed" }, id],
            )?;
            state.audit(
                user,
                "query.approve",
                Some(&pending.connection_id),
                if result.is_ok() { "ok" } else { "failed" },
            )?;
            result
        }
        _ => Err(missing()),
    }
}

struct JobRegistration {
    jobs: Arc<Mutex<HashMap<String, String>>>,
    key: String,
}

impl Drop for JobRegistration {
    fn drop(&mut self) {
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.remove(&self.key);
        }
    }
}

async fn execute_query(
    state: &ServerState,
    user: &WorkspaceUser,
    id: &str,
    input: QueryInput,
    approved: bool,
    reserved_slot: Option<OwnedSemaphorePermit>,
) -> ApiResult {
    if !valid_sql(&input.sql) {
        return Err("Abfrage muss zwischen 1 Byte und 1 MB groß sein."
            .to_string()
            .into());
    }
    let (connection, credentials) = state.access(user, id)?;
    let read = db::dml_preview::ensure_read_query(connection.kind, &input.sql).is_ok();
    if !read
        && (crate::mcp::redact::statement_count(&input.sql) != 1
            || crate::mcp::redact::sql_words(&input.sql)
                .first()
                .is_none_or(|word| {
                    !matches!(
                        word.as_str(),
                        "insert"
                            | "update"
                            | "delete"
                            | "merge"
                            | "with"
                            | "create"
                            | "alter"
                            | "drop"
                            | "truncate"
                            | "comment"
                            | "grant"
                            | "revoke"
                    )
                }))
    {
        return Err("Workspace-Schreibabfragen müssen eine einzelne Daten- oder Strukturänderung sein. Sitzungs- und Transaktionsbefehle sind nicht erlaubt.".to_string().into());
    }
    if connection.access != "write" && !read {
        return Err(denied());
    }
    if !read && connection.require_approval && !approved {
        let pending = crypto::id()?;
        {
            let mut db = state.locked()?;
            let tx = db.transaction()?;
            tx.execute(
                "UPDATE pending SET status='cancelled' WHERE status='pending' AND created<?1",
                [now() - 86400],
            )?;
            tx.execute(
                "DELETE FROM pending WHERE status NOT IN ('pending','running')",
                [],
            )?;
            let (count, bytes): (i64, i64) = tx.query_row(
                "SELECT count(*),COALESCE(sum(length(CAST(sql AS BLOB))),0) FROM pending",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if count >= 500 || bytes + input.sql.len() as i64 > 8 * 1024 * 1024 {
                return Err("Freigabewarteschlange überschreitet 500 Anfragen oder 8 MB. Bitte bestehende Anfragen bearbeiten.".to_string().into());
            }
            tx.execute(
                "INSERT INTO pending(id,connection_id,author,sql,created) VALUES(?1,?2,?3,?4,?5)",
                params![pending, id, user.id, input.sql, now()],
            )?;
            tx.commit()?;
        }
        state.audit(user, "query.request", Some(id), "pending")?;
        return Err(ApiError(
            StatusCode::ACCEPTED,
            format!("Abfrage wartet auf Freigabe: {pending}"),
        ));
    }
    let job = input.job_id.unwrap_or(crypto::id()?);
    if job.len() > 80
        || !job
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Aufgaben-ID ungültig.".to_string().into());
    }
    let key = format!("workspace:{}:{job}", user.id);
    let _permit = match reserved_slot {
        Some(permit) => permit,
        None => state.query_slot()?,
    };
    {
        let mut jobs = state.jobs.lock().map_err(|_| denied())?;
        if jobs.insert(key.clone(), user.id.clone()).is_some() {
            return Err("Aufgabe läuft bereits.".to_string().into());
        }
    }
    let _registration = JobRegistration {
        jobs: state.jobs.clone(),
        key: key.clone(),
    };
    let maximum = input
        .max_rows
        .unwrap_or(MAX_RESULT_ROWS)
        .clamp(1, MAX_RESULT_ROWS);
    let adapter = db::create_adapter_from_string(
        connection.kind,
        &credentials,
        connection.database.as_deref(),
        if read {
            create_pool_state()
        } else {
            state.pool.clone()
        },
    )?;
    let result=execution::run_query(Some(ExecutionOptions{job_id:Some(key),query_timeout:Some(30),max_rows:Some(maximum+1),..Default::default()}),true,async {
        let operation = async {
        if read {
            crate::mcp::server::validate_read_query(connection.kind,input.sql.clone())?;
            if connection.kind == DatabaseKind::Postgres {
                let (config,tls)=db::connection::parse_connection(&credentials,connection.database.as_deref())?;
                let client=execution::connect_postgres(&config,&tls).await?;
                return execution::postgres(&client,&tls,None,async {
                    client.batch_execute(&db::dml_preview::postgres_prelude(Duration::from_secs(30),None)).await.map_err(db::map_pg_err)?;
                    db::run_postgres_simple_query(&client,&input.sql).await
                }).await;
            }
            let mut transaction=adapter.begin_transaction().await?;
            let guard=match connection.kind {
                DatabaseKind::Mysql => "START TRANSACTION READ ONLY",
                DatabaseKind::Sqlite => "PRAGMA query_only = ON",
                _ => return Err("Lesende Workspace-Abfragen benötigen einen PostgreSQL-, MySQL- oder SQLite-Zugang mit nativer Lesesperre.".into()),
            };
            if connection.kind==DatabaseKind::Mysql {transaction.rollback().await?;}
            transaction.execute(guard).await?;
            let result=transaction.execute(&input.sql).await;
            if connection.kind==DatabaseKind::Sqlite { let _=transaction.execute("PRAGMA query_only = OFF").await; }
            let cleanup=transaction.rollback().await;
            match (result,cleanup) {(Ok(result),Ok(()))=>Ok(result),(Err(error),_)=>Err(error),(_,Err(error))=>Err(error)}
        } else { adapter.execute_query(&input.sql).await }
        };
        if matches!(connection.kind, DatabaseKind::Postgres | DatabaseKind::Sqlite) {
            operation.await
        } else {
            let cancelled = execution::cancellation_token();
            tokio::select! {
                biased;
                _ = cancelled.cancelled() => Err("Abfrage abgebrochen. Der Serverabschluss ist nicht bestätigt; vor erneutem Schreiben den Zustand prüfen.".to_string()),
                result = tokio::time::timeout(Duration::from_secs(30), operation) => result.map_err(|_| execution::timeout_message())?,
            }
        }
    }).await;
    state.audit(
        user,
        "query.execute",
        Some(id),
        if result.is_ok() { "ok" } else { "failed" },
    )?;
    let mut result = result.map_err(|error| {
        ApiError(
            StatusCode::BAD_REQUEST,
            sanitize_error(&error, &credentials),
        )
    })?;
    if result.rows.len() > maximum {
        result.rows.truncate(maximum);
        result.truncated = true;
    }
    let value = serde_json::to_value(result).map_err(|_| denied())?;
    if serde_json::to_vec(&value).map_err(|_| denied())?.len() > MAX_RESULT_BYTES {
        return Err(
            "Ergebnis überschreitet 4 MB. Bitte Spalten und Zeilen in SQL einschränken."
                .to_string()
                .into(),
        );
    }
    Ok(value)
}

fn sanitize_error(error: &str, credentials: &str) -> String {
    let mut error = error.replace(credentials, "[Zugang]");
    if let Ok(url) = url::Url::parse(credentials) {
        if let Some(password) = url.password().filter(|value| !value.is_empty()) {
            error = error.replace(password, "[geschützt]");
        }
    }
    error.chars().take(1000).collect()
}

async fn metadata(
    state: &ServerState,
    user: &WorkspaceUser,
    id: &str,
    input: MetadataInput,
) -> ApiResult {
    let (connection, credentials) = state.access(user, id)?;
    let _permit = state.queries.clone().try_acquire_owned().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Workspace ist ausgelastet.".into(),
        )
    })?;
    if input
        .database
        .as_ref()
        .is_some_and(|database| Some(database) != connection.database.as_ref())
    {
        return Err("Ein Workspace-Zugang ist auf seine konfigurierte Datenbank begrenzt. Lege für weitere Datenbanken einen eigenen Zugang an.".to_string().into());
    }
    let adapter = db::create_adapter_from_string(
        connection.kind,
        &credentials,
        connection.database.as_deref(),
        state.pool.clone(),
    )?;
    let operation = async {
        let value = match input.operation.as_str() {
            "test" => {
                adapter.test_connection().await?;
                json!({"ok":true})
            }
            "databases" => json!(connection
                .database
                .as_ref()
                .map(|database| vec![database.clone()])
                .unwrap_or_default()),
            "schemas" => {
                serde_json::to_value(adapter.list_schemas().await?).map_err(|e| e.to_string())?
            }
            "tables" => serde_json::to_value(adapter.list_tables(input.schema.as_deref()).await?)
                .map_err(|e| e.to_string())?,
            "views" => serde_json::to_value(adapter.list_views(input.schema.as_deref()).await?)
                .map_err(|e| e.to_string())?,
            "columns" => serde_json::to_value(
                adapter
                    .list_columns(input.schema.as_deref(), input.table.as_deref(), None)
                    .await?,
            )
            .map_err(|e| e.to_string())?,
            "rows" => serde_json::to_value(
                adapter
                    .fetch_rows(
                        input.schema.as_deref().ok_or("Schema fehlt")?,
                        input.table.as_deref().ok_or("Tabelle fehlt")?,
                        input.filter.as_deref(),
                        input.limit.unwrap_or(100).clamp(1, MAX_RESULT_ROWS as i64),
                        input.offset.unwrap_or(0).clamp(0, 10_000_000),
                        input.order_by.as_deref(),
                        input.order_desc,
                        input.is_view,
                        false,
                    )
                    .await?,
            )
            .map_err(|e| e.to_string())?,
            "count" => json!(
                adapter
                    .count_rows(
                        input.schema.as_deref().ok_or("Schema fehlt")?,
                        input.table.as_deref().ok_or("Tabelle fehlt")?,
                        input.filter.as_deref(),
                        false
                    )
                    .await?
            ),
            _ => return Err("Unbekannte Metadatenoperation.".to_string()),
        };
        if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > MAX_RESULT_BYTES {
            return Err(
                "Metadaten überschreiten 4 MB. Bitte Schema oder Tabelle eingrenzen.".into(),
            );
        }
        Ok(value)
    };
    let operation = execution::run_query(
        Some(ExecutionOptions {
            query_timeout: Some(30),
            max_rows: Some(10001),
            ..Default::default()
        }),
        true,
        operation,
    );
    tokio::time::timeout(Duration::from_secs(30), operation)
        .await
        .map_err(|_| {
            ApiError(
                StatusCode::REQUEST_TIMEOUT,
                "Metadatenabfrage nach 30 Sekunden beendet.".into(),
            )
        })?
        .map_err(|e| ApiError(StatusCode::BAD_REQUEST, sanitize_error(&e, &credentials)))
}
