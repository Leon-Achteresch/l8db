use std::collections::HashMap;
use std::future::Future;
use std::ops::{Deref, DerefMut};
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use futures_util::FutureExt;
use tiberius::{AuthMethod, Client, ColumnData, Config, EncryptionLevel, FromSql, Row};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use super::pool::PoolState;
use super::{
    attach_row_keys, create_table_ddl, hex_blob, rows_to_objects, timed, unsupported, where_clause,
    AddColumnRequest, AlterColumnRequest, ColumnInfo, ConstraintInfo, CreateTableRequest,
    DatabaseAdapter, DatabaseOverview, DetailedColumnInfo, ForeignKeyInfo, FunctionInfo, IndexInfo,
    ProxyUserInfo, QueryResult, SchemaSize, SequenceInfo, SessionInfo, SslMode, TableData,
    TableInfo, TriggerInfo, TxSession,
};

type MsClient = Client<Compat<TcpStream>>;
type IdleClients = Mutex<Vec<(MsClient, Instant)>>;
type SessionClients = Mutex<HashMap<String, (MsClient, Instant)>>;

const IDLE_MAX: usize = 8;
const IDLE_TTL: Duration = Duration::from_secs(300);
const SESSION_TTL: Duration = Duration::from_secs(60);
const SESSION_MAX: usize = 8;

pub struct MssqlAdapter {
    config: Config,
    proxy_user: Option<String>,
    pool_state: PoolState,
    key: String,
}

struct PooledClient {
    client: Option<MsClient>,
    idle: Arc<IdleClients>,
}

impl PooledClient {
    fn discard(mut self) {
        self.client = None;
    }

    fn into_inner(mut self) -> Option<MsClient> {
        self.client.take()
    }
}

impl Deref for PooledClient {
    type Target = MsClient;
    fn deref(&self) -> &MsClient {
        self.client
            .as_ref()
            .expect("pooled client already released")
    }
}

impl DerefMut for PooledClient {
    fn deref_mut(&mut self) -> &mut MsClient {
        self.client
            .as_mut()
            .expect("pooled client already released")
    }
}

impl Drop for PooledClient {
    fn drop(&mut self) {
        let Some(client) = self.client.take() else {
            return;
        };
        let mut idle = self.idle.lock().unwrap_or_else(|e| e.into_inner());
        if idle.len() < IDLE_MAX {
            idle.push((client, Instant::now()));
        }
    }
}

pub fn quote(ident: &str) -> String {
    format!("[{}]", ident.replace(']', "]]"))
}

pub fn lit(value: &str) -> String {
    format!("N'{}'", value.replace('\'', "''"))
}

fn map_err(e: tiberius::error::Error) -> String {
    match e {
        tiberius::error::Error::Server(token) => {
            format!(
                "SQL Server {}: {} (line {})",
                token.code(),
                token.message(),
                token.line()
            )
        }
        other => format!("SQL Server: {other}"),
    }
}

const UNREADABLE_TYPE: &str = "SQL Server: Das Ergebnis enthält eine Spalte, deren Datentyp der Treiber nicht lesen kann (geography, geometry, hierarchyid, sql_variant oder ein CLR-Typ). Spalte umwandeln, z. B. CAST(spalte AS NVARCHAR(MAX)) oder spalte.ToString().";

const BUILTIN_TYPES: &[&str] = &[
    "bigint",
    "binary",
    "bit",
    "char",
    "date",
    "datetime",
    "datetime2",
    "datetimeoffset",
    "decimal",
    "float",
    "image",
    "int",
    "money",
    "nchar",
    "ntext",
    "numeric",
    "nvarchar",
    "real",
    "rowversion",
    "smalldatetime",
    "smallint",
    "smallmoney",
    "sysname",
    "text",
    "time",
    "timestamp",
    "tinyint",
    "uniqueidentifier",
    "varbinary",
    "varchar",
    "xml",
];

async fn guarded<T>(future: impl Future<Output = Result<T, String>>) -> Result<T, String> {
    AssertUnwindSafe(future)
        .catch_unwind()
        .await
        .unwrap_or_else(|_| Err(UNREADABLE_TYPE.to_string()))
}

fn select_expression(name: &str, data_type: &str) -> String {
    let column = quote(name);
    let data_type = data_type.to_ascii_lowercase();
    match data_type.as_str() {
        "geography" | "geometry" => format!("{column}.STAsText() AS {column}"),
        "hierarchyid" => format!("{column}.ToString() AS {column}"),
        "sql_variant" => format!("CAST({column} AS NVARCHAR(4000)) AS {column}"),
        "json" | "vector" => format!("CAST({column} AS NVARCHAR(MAX)) AS {column}"),
        _ if BUILTIN_TYPES.contains(&data_type.as_str()) => column,
        _ => format!("{column}.ToString() AS {column}"),
    }
}

fn numeric_text(value: i128, scale: u8) -> String {
    let sign = if value < 0 { "-" } else { "" };
    let digits = value.unsigned_abs().to_string();
    let scale = usize::from(scale);
    if scale == 0 {
        return format!("{sign}{digits}");
    }
    let padded = format!("{digits:0>width$}", width = scale + 1);
    let (whole, fraction) = padded.split_at(padded.len() - scale);
    format!("{sign}{whole}.{fraction}")
}

fn value_to_json(data: &ColumnData<'static>) -> serde_json::Value {
    fn num(f: f64) -> serde_json::Value {
        serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(f.to_string()))
    }
    match data {
        ColumnData::U8(v) => v
            .map(serde_json::Value::from)
            .unwrap_or(serde_json::Value::Null),
        ColumnData::I16(v) => v
            .map(serde_json::Value::from)
            .unwrap_or(serde_json::Value::Null),
        ColumnData::I32(v) => v
            .map(serde_json::Value::from)
            .unwrap_or(serde_json::Value::Null),
        ColumnData::I64(v) => v
            .map(super::exact_number::int)
            .unwrap_or(serde_json::Value::Null),
        ColumnData::F32(v) => v.map(|f| num(f as f64)).unwrap_or(serde_json::Value::Null),
        ColumnData::F64(v) => v.map(num).unwrap_or(serde_json::Value::Null),
        ColumnData::Bit(v) => v
            .map(serde_json::Value::Bool)
            .unwrap_or(serde_json::Value::Null),
        ColumnData::String(v) => v
            .as_ref()
            .map(|s| serde_json::Value::String(s.to_string()))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::Guid(v) => v
            .map(|g| serde_json::Value::String(g.to_string()))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::Binary(v) => v
            .as_ref()
            .map(|b| serde_json::Value::String(hex_blob(b)))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::Numeric(v) => v
            .map(|n| serde_json::Value::String(numeric_text(n.value(), n.scale())))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::Xml(v) => v
            .as_ref()
            .map(|x| serde_json::Value::String(x.as_ref().to_string()))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::DateTime(_) | ColumnData::SmallDateTime(_) | ColumnData::DateTime2(_) => {
            chrono::NaiveDateTime::from_sql(data)
                .ok()
                .flatten()
                .map(|d| serde_json::Value::String(d.to_string()))
                .unwrap_or(serde_json::Value::Null)
        }
        ColumnData::Date(_) => chrono::NaiveDate::from_sql(data)
            .ok()
            .flatten()
            .map(|d| serde_json::Value::String(d.to_string()))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::Time(_) => chrono::NaiveTime::from_sql(data)
            .ok()
            .flatten()
            .map(|d| serde_json::Value::String(d.to_string()))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::DateTimeOffset(_) => chrono::DateTime::<chrono::FixedOffset>::from_sql(data)
            .ok()
            .flatten()
            .map(|d| serde_json::Value::String(d.to_rfc3339()))
            .unwrap_or(serde_json::Value::Null),
    }
}

fn create_or_alter(definition: &str) -> String {
    let trimmed = definition.trim_start();
    let mut words = trimmed.split_whitespace();
    let first = words.next().unwrap_or("");
    let second = words.next().unwrap_or("");
    if first.eq_ignore_ascii_case("CREATE") && !second.eq_ignore_ascii_case("OR") {
        format!("CREATE OR ALTER{}", &trimmed[first.len()..])
    } else {
        definition.to_string()
    }
}

fn text(row: &Row, index: usize) -> String {
    match value_to_json(
        &row.cells()
            .nth(index)
            .map(|(_, d)| d.clone())
            .unwrap_or(ColumnData::String(None)),
    ) {
        serde_json::Value::String(s) => s,
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn text_opt(row: &Row, index: usize) -> Option<String> {
    let value = text(row, index);
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn int(row: &Row, index: usize) -> i64 {
    match value_to_json(
        &row.cells()
            .nth(index)
            .map(|(_, d)| d.clone())
            .unwrap_or(ColumnData::I64(None)),
    ) {
        serde_json::Value::Number(n) => n.as_i64().unwrap_or(0),
        serde_json::Value::Bool(b) => b as i64,
        serde_json::Value::String(s) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

fn is_result_statement(sql: &str) -> bool {
    let first = sql.split_whitespace().next().unwrap_or("").to_uppercase();
    sql.to_uppercase().contains(" OUTPUT ")
        || matches!(
            first.as_str(),
            "SELECT"
                | "WITH"
                | "EXEC"
                | "EXECUTE"
                | "DECLARE"
                | "SHOW"
                | "DBCC"
                | "SP_HELP"
                | "PRINT"
                | "SET"
        )
}

#[cfg(windows)]
fn windows_auth(user: &str, password: &str) -> Result<AuthMethod, String> {
    if user.is_empty() {
        Ok(AuthMethod::Integrated)
    } else {
        Ok(AuthMethod::windows(user, password))
    }
}

#[cfg(not(windows))]
fn windows_auth(_user: &str, _password: &str) -> Result<AuthMethod, String> {
    Err("Windows-Authentifizierung ist nur unter Windows verfügbar.".to_string())
}

impl MssqlAdapter {
    pub fn new(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige SQL-Server-URL".to_string())?;
        if !matches!(url.scheme(), "mssql" | "sqlserver") {
            return Err("Eine mssql:// URL ist erforderlich".to_string());
        }
        let mut config = Config::new();
        config.host(url.host_str().ok_or("Host fehlt")?);
        config.port(url.port().unwrap_or(1433));
        let user = percent_decode(url.username());
        let password = percent_decode(url.password().unwrap_or(""));
        if !user.is_empty() {
            config.authentication(AuthMethod::sql_server(&user, &password));
        }
        let path_db = url.path().trim_start_matches('/');
        let db = database
            .filter(|d| !d.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| percent_decode(path_db));
        if !db.is_empty() {
            config.database(db);
        }
        let mut ssl = SslMode::Prefer;
        let mut trust = false;
        let mut trusted = false;
        let mut ca = None;
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "sslmode" => {
                    ssl = serde_json::from_value(serde_json::Value::String(value.into_owned()))
                        .map_err(|_| "Ungültiger SSL-Modus".to_string())?
                }
                "encrypt" => {
                    ssl = match value.to_lowercase().as_str() {
                        "optional" => SslMode::Prefer,
                        "false" | "no" | "0" | "disable" | "disabled" => SslMode::Disable,
                        _ => SslMode::VerifyFull,
                    }
                }
                "sslrootcert" | "trust_server_certificate_ca" | "trustservercertificateca"
                    if !value.is_empty() =>
                {
                    ca = Some(value.into_owned())
                }
                "trusted_connection"
                | "trustedconnection"
                | "integrated_security"
                | "integratedsecurity" => {
                    trusted = matches!(value.to_lowercase().as_str(), "true" | "yes" | "1" | "sspi")
                }
                "trust_server_certificate" | "trustservercertificate" => {
                    trust = matches!(value.to_lowercase().as_str(), "true" | "yes" | "1")
                }
                "application_name" | "app" => config.application_name(value.into_owned()),
                "instance" => config.instance_name(value.into_owned()),
                _ => {}
            }
        }
        if trusted {
            config.authentication(windows_auth(&user, &password)?);
        }
        config.encryption(match ssl {
            SslMode::Disable => EncryptionLevel::NotSupported,
            SslMode::Prefer => EncryptionLevel::Off,
            SslMode::Require | SslMode::VerifyCa | SslMode::VerifyFull => EncryptionLevel::Required,
        });
        if let Some(ca) = ca {
            config.trust_cert_ca(ca);
        } else if trust || matches!(ssl, SslMode::Prefer | SslMode::Require) {
            config.trust_cert();
        }
        Ok(Self {
            config,
            proxy_user: super::connection::proxy_user(&url),
            pool_state,
            key,
        })
    }

    async fn connect(&self) -> Result<PooledClient, String> {
        let idle = self
            .pool_state
            .shared(&self.key, || async {
                Ok::<IdleClients, String>(Mutex::new(Vec::new()))
            })
            .await?;
        let reused = {
            let mut list = idle.lock().unwrap_or_else(|e| e.into_inner());
            list.retain(|(_, since)| since.elapsed() < IDLE_TTL);
            list.pop().map(|(client, _)| client)
        };
        let client = match reused {
            Some(client) => client,
            None => {
                super::execution::connect(async {
                    let tcp = TcpStream::connect(self.config.get_addr())
                        .await
                        .map_err(|e| format!("Verbindung fehlgeschlagen: {e}"))?;
                    tcp.set_nodelay(true).ok();
                    let mut client = Client::connect(self.config.clone(), tcp.compat_write())
                        .await
                        .map_err(map_err)?;
                    if let Some(user) = &self.proxy_user {
                        impersonate(&mut client, user).await?;
                    }
                    Ok(client)
                })
                .await?
            }
        };
        Ok(PooledClient {
            client: Some(client),
            idle,
        })
    }

    async fn sessions(&self) -> Result<Arc<SessionClients>, String> {
        self.pool_state
            .shared(&format!("{}#script-sessions", self.key), || async {
                Ok::<SessionClients, String>(Mutex::new(HashMap::new()))
            })
            .await
    }

    async fn execute_in_session(&self, session: &str, sql: &str) -> Result<QueryResult, String> {
        let sessions = self.sessions().await?;
        let parked = {
            let mut map = sessions.lock().unwrap_or_else(|e| e.into_inner());
            map.retain(|_, (_, since)| since.elapsed() < SESSION_TTL);
            map.remove(session).map(|(client, _)| client)
        };
        let mut client = match parked {
            Some(client) => client,
            None => self.dedicated().await?,
        };
        let result = run_query(&mut client, sql).await;
        if result.is_ok() || run_query(&mut client, "SELECT 1").await.is_ok() {
            let mut map = sessions.lock().unwrap_or_else(|e| e.into_inner());
            if map.len() < SESSION_MAX || map.contains_key(session) {
                map.insert(session.to_string(), (client, Instant::now()));
            }
        }
        result
    }

    async fn dedicated(&self) -> Result<MsClient, String> {
        self.connect()
            .await?
            .into_inner()
            .ok_or_else(|| "SQL Server: Verbindung nicht verfügbar".to_string())
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Row>, String> {
        let mut client = self.connect().await?;
        let result = guarded(timed(async {
            let stream = client.simple_query(sql).await.map_err(map_err)?;
            stream.into_first_result().await.map_err(map_err)
        }))
        .await;
        if result.is_err() {
            client.discard();
        }
        result
    }

    async fn exec(&self, sql: &str) -> Result<u64, String> {
        let mut client = self.connect().await?;
        let result = guarded(timed(async {
            client
                .execute(sql, &[])
                .await
                .map_err(map_err)
                .map(|r| r.total())
        }))
        .await;
        if result.is_err() {
            client.discard();
        }
        result
    }

    fn object(schema: &str, name: &str) -> String {
        format!("{}.{}", quote(schema), quote(name))
    }

    fn create_table_statement(req: &CreateTableRequest) -> Result<String, String> {
        let sql = create_table_ddl(
            req,
            quote,
            true,
            Some(super::constraints::ConstraintDialect::Mssql),
        )?;
        Ok(if req.if_not_exists {
            format!(
                "IF OBJECT_ID({}) IS NULL {}",
                lit(&Self::object(&req.schema, &req.name)),
                sql.replacen("IF NOT EXISTS ", "", 1)
            )
        } else {
            sql
        })
    }
}

async fn impersonate(client: &mut MsClient, user: &str) -> Result<(), String> {
    let login = format!("EXECUTE AS LOGIN = {}", lit(user));
    if client.execute(login, &[]).await.is_ok() {
        return Ok(());
    }
    client
        .execute(format!("EXECUTE AS USER = {}", lit(user)), &[])
        .await
        .map(|_| ())
        .map_err(|e| {
            format!(
                "Proxy-User {user} kann nicht übernommen werden: {}",
                map_err(e)
            )
        })
}

fn percent_decode(value: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", value.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| value.to_string())
}

fn is_tx_control(sql: &str) -> bool {
    let mut words = sql.split_whitespace().map(str::to_uppercase);
    let first = words.next().unwrap_or_default();
    matches!(first.as_str(), "COMMIT" | "ROLLBACK" | "SAVE")
        || (first == "BEGIN" && words.next().is_some_and(|w| w.starts_with("TRAN")))
}

fn type_sql(type_name: &str, max_length: i64, precision: i64, scale: i64) -> String {
    let size = |n: i64| {
        if max_length == -1 {
            "MAX".to_string()
        } else {
            n.to_string()
        }
    };
    match type_name {
        "varchar" | "char" | "varbinary" | "binary" => {
            format!("{type_name}({})", size(max_length))
        }
        "nvarchar" | "nchar" => format!("{type_name}({})", size(max_length / 2)),
        "decimal" | "numeric" => format!("{type_name}({precision}, {scale})"),
        "datetime2" | "time" | "datetimeoffset" => format!("{type_name}({scale})"),
        _ => type_name.to_string(),
    }
}

fn alter_column_type(requested: Option<&str>, current: &str, collation: Option<&str>) -> String {
    let requested = requested.map(str::trim).filter(|t| !t.is_empty());
    let data_type = requested.unwrap_or(current);
    let keeps_collation = match requested {
        None => true,
        Some(t) => {
            let lower = t.to_lowercase();
            let base: String = lower
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            matches!(
                base.as_str(),
                "char" | "varchar" | "nchar" | "nvarchar" | "text" | "ntext"
            ) && !lower.split_whitespace().any(|w| w == "collate")
        }
    };
    match collation {
        Some(collation) if keeps_collation => format!("{data_type} COLLATE {collation}"),
        _ => data_type.to_string(),
    }
}

#[derive(PartialEq)]
enum SqlToken {
    Word(String),
    Quoted(String),
    Literal,
    Punct(char),
}

fn sql_tokens(sql: &str) -> Vec<SqlToken> {
    let chars: Vec<char> = sql.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c.is_whitespace() {
            i += 1;
        } else if c == '-' && next == Some('-') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            let mut depth = 0;
            while i < chars.len() {
                if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                    depth += 1;
                    i += 2;
                } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    i += 1;
                }
            }
        } else if c == '\'' || c == '[' || c == '"' {
            let close = if c == '[' { ']' } else { c };
            let mut content = String::new();
            i += 1;
            while i < chars.len() {
                if chars[i] == close {
                    if chars.get(i + 1) == Some(&close) {
                        content.push(close);
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                content.push(chars[i]);
                i += 1;
            }
            tokens.push(if c == '\'' {
                SqlToken::Literal
            } else {
                SqlToken::Quoted(content)
            });
        } else if c.is_alphanumeric() || matches!(c, '_' | '@' | '#' | '$') {
            let start = i;
            while i < chars.len()
                && (chars[i].is_alphanumeric() || matches!(chars[i], '_' | '@' | '#' | '$'))
            {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            if word.eq_ignore_ascii_case("N") && chars.get(i) == Some(&'\'') {
                continue;
            }
            tokens.push(SqlToken::Word(word.to_uppercase()));
        } else {
            tokens.push(SqlToken::Punct(c));
            i += 1;
        }
    }
    tokens
}

fn may_change_session(sql: &str) -> bool {
    let tokens = sql_tokens(sql);
    let word = |i: usize| match tokens.get(i) {
        Some(SqlToken::Word(w)) => Some(w.as_str()),
        _ => None,
    };
    let first = tokens
        .iter()
        .position(|t| *t != SqlToken::Punct(';'))
        .map(|i| &tokens[i]);
    let starts_statement = match first {
        None | Some(SqlToken::Punct('(')) => true,
        Some(SqlToken::Word(w)) => matches!(
            w.as_str(),
            "SELECT"
                | "WITH"
                | "INSERT"
                | "UPDATE"
                | "DELETE"
                | "MERGE"
                | "CREATE"
                | "ALTER"
                | "DROP"
                | "TRUNCATE"
                | "DECLARE"
                | "SET"
                | "PRINT"
                | "IF"
                | "WHILE"
                | "GRANT"
                | "REVOKE"
                | "DENY"
                | "WAITFOR"
                | "KILL"
                | "RAISERROR"
                | "THROW"
                | "CHECKPOINT"
                | "BACKUP"
                | "RESTORE"
                | "BULK"
                | "ENABLE"
                | "DISABLE"
        ),
        _ => false,
    };
    if !starts_statement {
        return true;
    }
    tokens.iter().enumerate().any(|(i, token)| match token {
        SqlToken::Quoted(name) => name.starts_with('#'),
        SqlToken::Word(w) if w.starts_with('#') => true,
        SqlToken::Word(w) => match w.as_str() {
            "USE" | "REVERT" | "SETUSER" | "EXEC" | "EXECUTE" | "BEGIN" | "COMMIT" | "ROLLBACK"
            | "SAVE" | "OPEN" | "DBCC" | "CURSOR" => true,
            "SET" => {
                let assigns = matches!(
                    tokens.get(i + 2),
                    Some(SqlToken::Punct(
                        '=' | '.' | '+' | '-' | '*' | '/' | '%' | '&' | '|' | '^'
                    ))
                );
                let variable = word(i + 1).is_some_and(|w| w.starts_with('@'));
                let referential = matches!(word(i + 1), Some("NULL" | "DEFAULT"));
                !(assigns || variable || referential)
            }
            _ => false,
        },
        _ => false,
    })
}

fn starts_batch(sql: &str) -> bool {
    let words: Vec<String> = sql
        .split_whitespace()
        .take(4)
        .map(str::to_uppercase)
        .collect();
    let object = match words.first().map(String::as_str) {
        Some("CREATE") if words.get(1).map(String::as_str) == Some("OR") => words.get(3),
        Some("CREATE") | Some("ALTER") => words.get(1),
        _ => None,
    };
    object.is_some_and(|word| {
        matches!(
            word.as_str(),
            "SCHEMA" | "VIEW" | "PROC" | "PROCEDURE" | "FUNCTION" | "TRIGGER"
        )
    })
}

async fn run_query(client: &mut MsClient, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    guarded(timed(async {
        if is_tx_control(sql) || starts_batch(sql) {
            client
                .simple_query(sql)
                .await
                .map_err(map_err)?
                .into_results()
                .await
                .map_err(map_err)?;
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: None,
                execution_time_ms: start.elapsed().as_millis() as u64,
                truncated: false,
            });
        }
        if !is_result_statement(sql) {
            let affected = client.execute(sql, &[]).await.map_err(map_err)?.total();
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: Some(affected),
                execution_time_ms: start.elapsed().as_millis() as u64,
                truncated: false,
            });
        }
        let rows = client
            .simple_query(sql)
            .await
            .map_err(map_err)?
            .into_first_result()
            .await
            .map_err(map_err)?;
        let columns: Vec<String> = rows
            .first()
            .map(|r| {
                super::unique_column_names(
                    r.columns().iter().map(|c| c.name().to_string()).collect(),
                )
            })
            .unwrap_or_default();
        let data: Vec<Vec<serde_json::Value>> = rows
            .iter()
            .map(|r| r.cells().map(|(_, d)| value_to_json(d)).collect())
            .collect();
        Ok(QueryResult {
            rows: rows_to_objects(&columns, data),
            columns,
            rows_affected: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            truncated: false,
        })
    }))
    .await
}

struct MssqlTx {
    client: MsClient,
}

#[async_trait]
impl TxSession for MssqlTx {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        run_query(&mut self.client, sql).await
    }
    async fn commit(&mut self) -> Result<(), String> {
        run_query(&mut self.client, "COMMIT").await.map(|_| ())
    }
    async fn rollback(&mut self) -> Result<(), String> {
        run_query(&mut self.client, "ROLLBACK").await.map(|_| ())
    }
}

#[async_trait]
impl DatabaseAdapter for MssqlAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.rows("SELECT 1").await.map(|_| ())
    }

    async fn list_proxy_users(&self) -> Result<Vec<ProxyUserInfo>, String> {
        let rows = self
            .rows(
                "SELECT name, 'login' FROM sys.server_principals WHERE type IN ('S','U') AND is_disabled = 0 AND name NOT LIKE '##%' \
                   AND name NOT LIKE 'NT AUTHORITY\\%' AND name NOT LIKE 'NT SERVICE\\%' AND name NOT LIKE 'BUILTIN\\%' AND name <> SUSER_SNAME() \
                 UNION ALL SELECT name, 'user' FROM sys.database_principals WHERE type IN ('S','U','E') AND principal_id > 4 AND name <> USER_NAME() \
                 ORDER BY 1, 2",
            )
            .await?;
        let mut users: Vec<ProxyUserInfo> = Vec::new();
        for row in &rows {
            let name = text(row, 0);
            if users.iter().any(|user| user.name == name) {
                continue;
            }
            users.push(ProxyUserInfo {
                name,
                category: if text(row, 1) == "login" {
                    "login"
                } else {
                    "user"
                },
                bypasses_rls: false,
            });
        }
        Ok(users)
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SELECT name FROM sys.databases WHERE state = 0 ORDER BY name")
            .await?
            .iter()
            .map(|r| text(r, 0))
            .collect())
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SELECT name FROM sys.schemas WHERE schema_id < 16384 AND name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') ORDER BY name")
            .await?
            .iter()
            .map(|r| text(r, 0))
            .collect())
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let filter = schema
            .map(|s| format!(" WHERE s.name = {}", lit(s)))
            .unwrap_or_default();
        let sql = format!("SELECT s.name, t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id{filter} ORDER BY s.name, t.name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: text(r, 0),
                name: text(r, 1),
            })
            .collect())
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let kind = if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
            "VIEW"
        } else {
            "BASE TABLE"
        };
        let mut sql = format!("SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS c JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME WHERE t.TABLE_TYPE = '{kind}'");
        if let Some(s) = schema {
            sql.push_str(&format!(" AND c.TABLE_SCHEMA = {}", lit(s)));
        }
        if let Some(t) = table {
            sql.push_str(&format!(" AND c.TABLE_NAME = {}", lit(t)));
        }
        sql.push_str(" ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| ColumnInfo {
                schema: text(r, 0),
                table: text(r, 1),
                name: text(r, 2),
                data_type: text(r, 3),
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
        let where_sql = where_clause(filter, allow_raw_filter)?;
        let detailed = self.list_table_columns_detailed(schema, table).await?;
        let pk: Vec<String> = detailed
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name.clone())
            .collect();
        let select_list = if detailed.is_empty() {
            "*".to_string()
        } else {
            detailed
                .iter()
                .map(|c| select_expression(&c.name, &c.data_type))
                .collect::<Vec<_>>()
                .join(", ")
        };
        let columns: Vec<String> = detailed.into_iter().map(|c| c.name).collect();
        let order_sql = match order_by {
            Some(col) if columns.iter().any(|c| c == col) => format!(
                " ORDER BY {} {}",
                quote(col),
                if order_desc { "DESC" } else { "ASC" }
            ),
            _ => " ORDER BY (SELECT NULL)".to_string(),
        };
        let sql = format!(
            "SELECT {} FROM {}{}{} OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
            select_list,
            Self::object(schema, table),
            where_sql,
            order_sql,
            offset.max(0),
            limit.max(1)
        );
        let mut result = self.execute_query(&sql).await?;
        attach_row_keys(&mut result.rows, &pk);
        Ok(TableData {
            columns: if columns.is_empty() {
                result.columns
            } else {
                columns
            },
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
        let sql = format!(
            "SELECT COUNT_BIG(*) FROM {}{}",
            Self::object(schema, table),
            where_clause(filter, allow_raw_filter)?
        );
        Ok(self
            .rows(&sql)
            .await?
            .first()
            .map(|r| int(r, 0))
            .unwrap_or(0))
    }

    async fn begin_transaction(&self) -> Result<Box<dyn TxSession>, String> {
        let mut client = self.dedicated().await?;
        run_query(&mut client, "BEGIN TRANSACTION").await?;
        Ok(Box::new(MssqlTx { client }))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        if let Some(session) = super::execution::session_id() {
            return self.execute_in_session(&session, sql).await;
        }
        let mut client = self.connect().await?;
        let result = run_query(&mut client, sql).await;
        if result.is_err() || may_change_session(sql) {
            client.discard();
        }
        result
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let filter = schema
            .map(|s| format!(" WHERE s.name = {}", lit(s)))
            .unwrap_or_default();
        let sql = format!("SELECT s.name, v.name FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id{filter} ORDER BY v.name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: text(r, 0),
                name: text(r, 1),
            })
            .collect())
    }

    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let sql = format!(
            "SELECT OBJECT_DEFINITION(OBJECT_ID({}))",
            lit(&Self::object(schema, view))
        );
        self.rows(&sql)
            .await?
            .first()
            .map(|r| text(r, 0))
            .filter(|d| !d.is_empty())
            .ok_or_else(|| "View-Definition nicht verfügbar".to_string())
    }

    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, String> {
        let sql = format!(
            "SELECT c.name, TYPE_NAME(c.user_type_id), c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, \
             CAST(ic.seed_value AS NVARCHAR(40)), CAST(ic.increment_value AS NVARCHAR(40)), dc.definition, cc.definition, cc.is_persisted \
             FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id \
             LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id \
             LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id \
             LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id \
             WHERE s.name = {} AND t.name = {} ORDER BY c.column_id",
            lit(schema),
            lit(table)
        );
        let columns = self.rows(&sql).await?;
        if columns.is_empty() {
            return Err(format!("Tabelle {schema}.{table} nicht gefunden"));
        }
        let mut parts: Vec<String> = columns
            .iter()
            .map(|r| {
                let name = quote(&text(r, 0));
                if let Some(expr) = text_opt(r, 10) {
                    let persisted = if int(r, 11) == 1 { " PERSISTED" } else { "" };
                    return format!("{name} AS {expr}{persisted}");
                }
                let data_type = type_sql(&text(r, 1), int(r, 2), int(r, 3), int(r, 4));
                let mut def = format!("{name} {data_type}");
                if int(r, 6) == 1 {
                    def.push_str(&format!(" IDENTITY({}, {})", text(r, 7), text(r, 8)));
                }
                def.push_str(if int(r, 5) == 1 { " NULL" } else { " NOT NULL" });
                if let Some(default) = text_opt(r, 9) {
                    def.push_str(&format!(" DEFAULT {default}"));
                }
                def
            })
            .collect();
        let quote_all =
            |cols: &[String]| cols.iter().map(|c| quote(c)).collect::<Vec<_>>().join(", ");
        let constraints = self.list_constraints(schema, table).await?;
        for c in &constraints {
            let body = match c.constraint_type.as_str() {
                "PRIMARY KEY" | "UNIQUE" => {
                    format!("{} ({})", c.constraint_type, quote_all(&c.columns))
                }
                "CHECK" => c.definition.clone(),
                _ => continue,
            };
            parts.push(format!("CONSTRAINT {} {body}", quote(&c.name)));
        }
        let fks = self.list_foreign_keys(schema, table).await?;
        let mut names: Vec<&str> = fks.iter().map(|f| f.constraint_name.as_str()).collect();
        names.dedup();
        for name in names {
            let group: Vec<_> = fks.iter().filter(|f| f.constraint_name == name).collect();
            let from: Vec<String> = group.iter().map(|f| f.from_column.clone()).collect();
            let to: Vec<String> = group.iter().map(|f| f.to_column.clone()).collect();
            parts.push(format!(
                "CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
                quote(name),
                quote_all(&from),
                Self::object(&group[0].to_schema, &group[0].to_table),
                quote_all(&to)
            ));
        }
        let mut ddl = format!(
            "CREATE TABLE {} (\n  {}\n);\n",
            Self::object(schema, table),
            parts.join(",\n  ")
        );
        for index in self.list_indexes(schema, table).await? {
            if index.is_primary || constraints.iter().any(|c| c.name == index.name) {
                continue;
            }
            ddl.push_str(&format!("\n{};\n", index.definition));
        }
        Ok(ddl)
    }

    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String> {
        let ddl = format!(
            "CREATE OR ALTER VIEW {} {}",
            Self::object(schema, view),
            super::view_ddl::view_ddl_rest(body)
        );
        let mut client = self.dedicated().await?;
        timed(async {
            client
                .simple_query("BEGIN TRANSACTION")
                .await
                .map_err(map_err)?
                .into_results()
                .await
                .map_err(map_err)?;
            let result = match client.simple_query(&ddl).await.map_err(map_err) {
                Ok(stream) => stream.into_results().await.map_err(map_err).map(|_| ()),
                Err(e) => Err(e),
            };
            let end = if dry_run || result.is_err() {
                "ROLLBACK TRANSACTION"
            } else {
                "COMMIT TRANSACTION"
            };
            let _ = client.simple_query(end).await;
            result
        })
        .await
    }

    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let filter = schema
            .map(|s| format!(" AND s.name = {}", lit(s)))
            .unwrap_or_default();
        let sql = format!("SELECT s.name, o.name, o.type_desc, o.object_id FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE o.type IN ('FN', 'IF', 'TF', 'P', 'AF', 'FS', 'FT', 'PC'){filter} ORDER BY o.name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| FunctionInfo {
                schema: text(r, 0),
                name: text(r, 1),
                identity_args: String::new(),
                return_type: text(r, 2),
                language: "T-SQL".to_string(),
                oid: text(r, 3),
            })
            .collect())
    }

    async fn get_function_definition(&self, oid: &str) -> Result<String, String> {
        let id: i64 = oid.parse().map_err(|_| "Ungültige Objekt-ID".to_string())?;
        self.rows(&format!("SELECT OBJECT_DEFINITION({id})"))
            .await?
            .first()
            .map(|r| create_or_alter(&text(r, 0)))
            .filter(|d| !d.is_empty())
            .ok_or_else(|| "Definition nicht verfügbar".to_string())
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!("DROP TABLE {}", Self::object(schema, table)))
            .await
            .map(|_| ())
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!("TRUNCATE TABLE {}", Self::object(schema, table)))
            .await
            .map(|_| ())
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let sql = format!(
            "SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT, c.ORDINAL_POSITION, c.CHARACTER_MAXIMUM_LENGTH, \
             CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME) THEN 1 ELSE 0 END, \
             (SELECT CAST(ep.value AS NVARCHAR(MAX)) FROM sys.extended_properties ep WHERE ep.class = 1 AND ep.name = 'MS_Description' AND ep.major_id = OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)) AND ep.minor_id = COLUMNPROPERTY(ep.major_id, c.COLUMN_NAME, 'ColumnId')) \
             FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = {} AND c.TABLE_NAME = {} ORDER BY c.ORDINAL_POSITION",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| DetailedColumnInfo {
                name: text(r, 0),
                data_type: text(r, 1),
                is_nullable: text(r, 2) == "YES",
                column_default: text_opt(r, 3),
                ordinal_position: int(r, 4) as i32,
                character_maximum_length: text_opt(r, 5).and_then(|v| v.parse().ok()),
                is_primary_key: int(r, 6) == 1,
                comment: text_opt(r, 7).filter(|c| !c.is_empty()),
            })
            .collect())
    }

    async fn add_column(
        &self,
        schema: &str,
        table: &str,
        column: &AddColumnRequest,
    ) -> Result<(), String> {
        let mut sql = format!(
            "ALTER TABLE {} ADD {} {}",
            Self::object(schema, table),
            quote(&column.name),
            column.data_type
        );
        if !column.is_nullable {
            sql.push_str(" NOT NULL");
        }
        if let Some(d) = column.default_value.as_deref().filter(|d| !d.is_empty()) {
            sql.push_str(&format!(" DEFAULT {d}"));
        }
        self.exec(&sql).await.map(|_| ())
    }

    async fn alter_column(
        &self,
        schema: &str,
        table: &str,
        changes: &AlterColumnRequest,
    ) -> Result<(), String> {
        let object = Self::object(schema, table);
        let current = self
            .rows(&format!(
                "SELECT TYPE_NAME(c.user_type_id), c.max_length, c.precision, c.scale, c.collation_name, c.is_nullable, t.is_user_defined, SCHEMA_NAME(t.schema_id), \
                 c.is_xml_document, SCHEMA_NAME(x.schema_id), x.name, c.is_sparse, c.is_masked, mc.masking_function \
                 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id \
                 LEFT JOIN sys.xml_schema_collections x ON x.xml_collection_id = c.xml_collection_id AND c.xml_collection_id <> 0 \
                 LEFT JOIN sys.masked_columns mc ON mc.object_id = c.object_id AND mc.column_id = c.column_id \
                 WHERE c.object_id = OBJECT_ID({}) AND c.name = {}",
                lit(&object),
                lit(&changes.old_name)
            ))
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| format!("Unbekannte Spalte: {}", changes.old_name))?;
        if changes.data_type.is_some() || changes.set_not_null.is_some() {
            let user_defined = int(&current, 6) == 1;
            let xml_schema = text_opt(&current, 10).map(|name| {
                let facet = if int(&current, 8) == 1 {
                    "DOCUMENT"
                } else {
                    "CONTENT"
                };
                format!(
                    "xml({facet} {}.{})",
                    quote(&text(&current, 9)),
                    quote(&name)
                )
            });
            let current_type = if let Some(xml) = xml_schema {
                xml
            } else if user_defined {
                format!(
                    "{}.{}",
                    quote(&text(&current, 7)),
                    quote(&text(&current, 0))
                )
            } else {
                type_sql(
                    &text(&current, 0),
                    int(&current, 1),
                    int(&current, 2),
                    int(&current, 3),
                )
            };
            let collation = text_opt(&current, 4).filter(|_| !user_defined);
            let data_type = alter_column_type(
                changes.data_type.as_deref(),
                &current_type,
                collation.as_deref(),
            );
            let nullable = !changes.set_not_null.unwrap_or(int(&current, 5) != 1);
            let sparse = if int(&current, 11) == 1 {
                " SPARSE"
            } else {
                ""
            };
            let column = quote(&changes.old_name);
            let alter = format!(
                "ALTER TABLE {object} ALTER COLUMN {column} {data_type}{sparse} {}",
                if nullable { "NULL" } else { "NOT NULL" }
            );
            let mask = text_opt(&current, 13).filter(|_| int(&current, 12) == 1);
            self.exec(&match mask {
                Some(function) => format!(
                    "SET XACT_ABORT ON; BEGIN TRANSACTION; {alter}; ALTER TABLE {object} ALTER COLUMN {column} ADD MASKED WITH (FUNCTION = {}); COMMIT TRANSACTION",
                    lit(&function)
                ),
                None => alter,
            })
            .await?;
        }
        if changes.drop_default || changes.new_default.is_some() {
            let existing = self
                .rows(&format!(
                    "SELECT d.name FROM sys.default_constraints d JOIN sys.columns c ON c.default_object_id = d.object_id WHERE d.parent_object_id = OBJECT_ID({}) AND c.name = {}",
                    lit(&object),
                    lit(&changes.old_name)
                ))
                .await?;
            for row in existing {
                self.exec(&format!(
                    "ALTER TABLE {object} DROP CONSTRAINT {}",
                    quote(&text(&row, 0))
                ))
                .await?;
            }
            if let Some(d) = changes.new_default.as_deref().filter(|d| !d.is_empty()) {
                self.exec(&format!(
                    "ALTER TABLE {object} ADD DEFAULT {d} FOR {}",
                    quote(&changes.old_name)
                ))
                .await?;
            }
        }
        if let Some(new_name) = changes
            .new_name
            .as_deref()
            .filter(|n| !n.is_empty() && *n != changes.old_name)
        {
            self.exec(&format!(
                "EXEC sp_rename {}, {}, 'COLUMN'",
                lit(&format!("{object}.{}", quote(&changes.old_name))),
                lit(new_name)
            ))
            .await?;
        }
        Ok(())
    }

    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String> {
        self.exec(&format!(
            "ALTER TABLE {} DROP COLUMN {}",
            Self::object(schema, table),
            quote(column)
        ))
        .await
        .map(|_| ())
    }

    async fn list_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, String> {
        let sql = format!(
            "SELECT fk.name, ps.name, pt.name, pc.name, rs.name, rt.name, rc.name FROM sys.foreign_keys fk \
             JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id \
             JOIN sys.tables pt ON pt.object_id = fk.parent_object_id JOIN sys.schemas ps ON ps.schema_id = pt.schema_id \
             JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id \
             JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id JOIN sys.schemas rs ON rs.schema_id = rt.schema_id \
             JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id \
             WHERE ps.name = {} AND pt.name = {} ORDER BY fk.name, fkc.constraint_column_id",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| ForeignKeyInfo {
                constraint_name: text(r, 0),
                from_schema: text(r, 1),
                from_table: text(r, 2),
                from_column: text(r, 3),
                to_schema: text(r, 4),
                to_table: text(r, 5),
                to_column: text(r, 6),
            })
            .collect())
    }

    async fn list_triggers(&self, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
        let sql = format!(
            "SELECT tr.name, STUFF((SELECT ' OR ' + te.type_desc FROM sys.trigger_events te WHERE te.object_id = tr.object_id FOR XML PATH('')), 1, 4, ''), \
             CASE WHEN tr.is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END, tr.is_disabled, OBJECT_DEFINITION(tr.object_id) \
             FROM sys.triggers tr JOIN sys.tables t ON t.object_id = tr.parent_id JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = {} AND t.name = {} ORDER BY tr.name",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| TriggerInfo {
                trigger_name: text(r, 0),
                table_schema: schema.to_string(),
                table_name: table.to_string(),
                event: text(r, 1),
                timing: text(r, 2),
                orientation: "STATEMENT".to_string(),
                function_schema: String::new(),
                function_name: String::new(),
                enabled: if int(r, 3) == 1 {
                    "D".to_string()
                } else {
                    "O".to_string()
                },
                definition: create_or_alter(&text(r, 4)),
            })
            .collect())
    }

    async fn table_comment(&self, schema: &str, table: &str) -> Result<Option<String>, String> {
        let sql = format!(
            "SELECT CAST(ep.value AS NVARCHAR(MAX)) FROM sys.extended_properties ep \
             JOIN sys.objects o ON o.object_id = ep.major_id JOIN sys.schemas s ON s.schema_id = o.schema_id \
             WHERE ep.class = 1 AND ep.minor_id = 0 AND ep.name = 'MS_Description' AND s.name = {} AND o.name = {}",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .first()
            .map(|r| text(r, 0))
            .filter(|c| !c.is_empty()))
    }

    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let sql = format!(
            "SELECT i.name, i.is_unique, i.is_primary_key, i.type_desc, c.name FROM sys.indexes i \
             JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id \
             JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
             WHERE i.object_id = OBJECT_ID({}) AND i.name IS NOT NULL ORDER BY i.name, ic.key_ordinal",
            lit(&Self::object(schema, table))
        );
        let mut out: Vec<IndexInfo> = Vec::new();
        for r in self.rows(&sql).await? {
            let name = text(&r, 0);
            let column = text(&r, 4);
            if let Some(existing) = out.iter_mut().find(|i| i.name == name) {
                existing.columns.push(column);
                continue;
            }
            out.push(IndexInfo {
                is_unique: int(&r, 1) == 1,
                is_primary: int(&r, 2) == 1,
                index_type: text(&r, 3).to_lowercase(),
                columns: vec![column],
                definition: String::new(),
                name,
            });
        }
        for idx in &mut out {
            idx.definition = format!(
                "CREATE {}{} INDEX {} ON {} ({})",
                if idx.is_unique { "UNIQUE " } else { "" },
                idx.index_type.to_uppercase(),
                quote(&idx.name),
                Self::object(schema, table),
                idx.columns
                    .iter()
                    .map(|c| quote(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        Ok(out)
    }

    async fn list_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, String> {
        let sql = format!(
            "SELECT tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, STUFF((SELECT ',' + k.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k WHERE k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA ORDER BY k.ORDINAL_POSITION FOR XML PATH('')), 1, 1, ''), \
             (SELECT cc.CHECK_CLAUSE FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc WHERE cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA) \
             FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc WHERE tc.TABLE_SCHEMA = {} AND tc.TABLE_NAME = {} ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| {
                let columns: Vec<String> = text_opt(r, 2)
                    .map(|c| c.split(',').map(str::to_string).collect())
                    .unwrap_or_default();
                let constraint_type = text(r, 1);
                let definition = text_opt(r, 3)
                    .map(|check| format!("CHECK {check}"))
                    .unwrap_or_else(|| format!("{constraint_type} ({})", columns.join(", ")));
                ConstraintInfo {
                    name: text(r, 0),
                    constraint_type,
                    columns,
                    definition,
                }
            })
            .collect())
    }

    async fn list_sequences(&self, schema: Option<&str>) -> Result<Vec<SequenceInfo>, String> {
        let filter = schema
            .map(|s| format!(" WHERE s.name = {}", lit(s)))
            .unwrap_or_default();
        let sql = format!("SELECT s.name, q.name, TYPE_NAME(q.user_type_id), CAST(q.start_value AS NVARCHAR(40)), CAST(q.minimum_value AS NVARCHAR(40)), CAST(q.maximum_value AS NVARCHAR(40)), CAST(q.increment AS NVARCHAR(40)), q.is_cycling, CAST(q.current_value AS NVARCHAR(40)) FROM sys.sequences q JOIN sys.schemas s ON s.schema_id = q.schema_id{filter} ORDER BY q.name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| SequenceInfo {
                schema: text(r, 0),
                name: text(r, 1),
                data_type: text(r, 2),
                start_value: text(r, 3),
                min_value: text(r, 4),
                max_value: text(r, 5),
                increment_by: text(r, 6),
                cycle: int(r, 7) == 1,
                last_value: text_opt(r, 8),
            })
            .collect())
    }

    async fn preview_create_table_ddl(&self, req: &CreateTableRequest) -> Result<String, String> {
        Self::create_table_statement(req)
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        let sql = Self::create_table_statement(req)?;
        self.exec(&sql).await.map(|_| ())
    }

    async fn explain_query(&self, sql: &str, _analyze: bool) -> Result<serde_json::Value, String> {
        let mut client = self.dedicated().await?;
        timed(async {
            client
                .simple_query("SET SHOWPLAN_ALL ON")
                .await
                .map_err(map_err)?
                .into_results()
                .await
                .map_err(map_err)?;
            let plan = client
                .simple_query(sql)
                .await
                .map_err(map_err)?
                .into_first_result()
                .await
                .map_err(map_err);
            let _ = client.simple_query("SET SHOWPLAN_ALL OFF").await;
            let rows = plan?;
            let columns: Vec<String> = rows
                .first()
                .map(|r| {
                    super::unique_column_names(
                        r.columns().iter().map(|c| c.name().to_string()).collect(),
                    )
                })
                .unwrap_or_default();
            let data: Vec<Vec<serde_json::Value>> = rows
                .iter()
                .map(|r| r.cells().map(|(_, d)| value_to_json(d)).collect())
                .collect();
            Ok(serde_json::Value::Array(rows_to_objects(&columns, data)))
        })
        .await
    }

    async fn list_sessions(&self) -> Result<Vec<SessionInfo>, String> {
        let sql = "SELECT s.session_id, s.login_name, ISNULL(DB_NAME(s.database_id), ''), ISNULL(s.program_name, ''), ISNULL(c.client_net_address, ''), ISNULL(s.status, ''), ISNULL(t.text, ''), CONVERT(NVARCHAR(30), r.start_time, 126), ISNULL(r.wait_type, ''), CASE WHEN s.session_id = @@SPID THEN 1 ELSE 0 END \
                   FROM sys.dm_exec_sessions s LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t WHERE s.is_user_process = 1 ORDER BY s.session_id";
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| SessionInfo {
                pid: int(r, 0) as i32,
                user: text(r, 1),
                database: text(r, 2),
                application: text(r, 3),
                client_addr: text_opt(r, 4),
                state: text_opt(r, 5),
                query: text(r, 6),
                query_start: text_opt(r, 7),
                transaction_start: None,
                wait_event: text_opt(r, 8),
                is_self: int(r, 9) == 1,
                blocked_by: Vec::new(),
            })
            .collect())
    }

    async fn cancel_session(&self, _pid: i32) -> Result<bool, String> {
        Err(unsupported("Abbrechen einzelner Abfragen (nutze Beenden)"))
    }

    async fn terminate_session(&self, pid: i32) -> Result<bool, String> {
        self.exec(&format!("KILL {pid}")).await.map(|_| true)
    }

    async fn create_schema(&self, name: &str) -> Result<(), String> {
        self.exec(&format!("CREATE SCHEMA {}", quote(name)))
            .await
            .map(|_| ())
    }

    async fn drop_schema(&self, name: &str, _cascade: bool) -> Result<(), String> {
        self.exec(&format!("DROP SCHEMA {}", quote(name)))
            .await
            .map(|_| ())
    }

    async fn get_database_overview(&self) -> Result<DatabaseOverview, String> {
        let database = self
            .rows("SELECT DB_NAME()")
            .await?
            .first()
            .map(|r| text(r, 0))
            .unwrap_or_default();
        let size_bytes = self.rows("SELECT CAST(SUM(CAST(size AS BIGINT)) * 8 * 1024 AS BIGINT) FROM sys.database_files").await?.first().map(|r| int(r, 0)).unwrap_or(0);
        let rows = self
            .rows("SELECT s.name, COUNT(DISTINCT t.object_id), ISNULL(SUM(CAST(p.used_page_count AS BIGINT)) * 8 * 1024, 0) FROM sys.schemas s LEFT JOIN sys.tables t ON t.schema_id = s.schema_id LEFT JOIN sys.dm_db_partition_stats p ON p.object_id = t.object_id WHERE s.schema_id < 16384 AND s.name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') GROUP BY s.name ORDER BY s.name")
            .await?;
        Ok(DatabaseOverview {
            database,
            size_bytes,
            size_pretty: super::pretty_bytes(size_bytes),
            schemas: rows
                .iter()
                .map(|r| SchemaSize {
                    schema: text(r, 0),
                    table_count: int(r, 1),
                    size_bytes: int(r, 2),
                })
                .collect(),
        })
    }

    async fn snapshot_rows(
        &self,
        request: &super::snapshot::SnapshotRequest,
    ) -> Result<TableData, String> {
        use futures_util::TryStreamExt;
        let object = Self::object(&request.schema, &request.table);
        let sql = super::snapshot::select_sql(request, &object, quote)?;
        let mut client = self.connect().await?;
        let result = guarded(async {
            let mut stream = client.simple_query(sql).await.map_err(map_err)?;
            let columns: Vec<String> = stream
                .columns()
                .await
                .map_err(map_err)?
                .map(|c| c.iter().map(|c| c.name().to_string()).collect())
                .unwrap_or_default();
            let mut rows = stream.into_row_stream();
            let mut collector = super::snapshot::Collector::new(request.max_rows);
            while let Some(row) = rows.try_next().await.map_err(map_err)? {
                collector.push(
                    columns
                        .iter()
                        .cloned()
                        .zip(row.cells().map(|(_, data)| value_to_json(data)))
                        .collect(),
                )?;
            }
            collector.finish(columns)
        })
        .await;
        if result.is_err() {
            client.discard();
        }
        result
    }

    async fn schema_catalog(
        &self,
        schema: &str,
        types: &[String],
    ) -> Result<Vec<super::schema_catalog::CatalogObject>, String> {
        self.schema_catalog_impl(schema, types).await
    }
}

#[path = "mssql_catalog.rs"]
mod catalog;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unreadable_types_are_converted_for_browsing() {
        assert_eq!(select_expression("id", "int"), "[id]");
        assert_eq!(
            select_expression("Shape", "geography"),
            "[Shape].STAsText() AS [Shape]"
        );
        assert_eq!(
            select_expression("node", "HierarchyId"),
            "[node].ToString() AS [node]"
        );
        assert_eq!(
            select_expression("v", "sql_variant"),
            "CAST([v] AS NVARCHAR(4000)) AS [v]"
        );
        assert_eq!(select_expression("p", "Point"), "[p].ToString() AS [p]");
        assert_eq!(select_expression("a]b", "nvarchar"), "[a]]b]");
    }

    #[tokio::test]
    #[ignore]
    async fn live_unreadable_types_do_not_crash() {
        let Ok(url) = std::env::var("L8DB_SMOKE_MSSQL_URL") else {
            return;
        };
        let pool = crate::db::pool::create_pool_state();
        let adapter =
            MssqlAdapter::new(&url, Some("master"), pool.clone(), "variant".into()).unwrap();
        for sql in [
            "IF OBJECT_ID('dbo.l8db_variant') IS NOT NULL DROP TABLE dbo.l8db_variant",
            "CREATE TABLE dbo.l8db_variant (id int PRIMARY KEY, v sql_variant)",
            "INSERT INTO dbo.l8db_variant VALUES (1, CAST(42 AS sql_variant))",
            "INSERT INTO dbo.l8db_variant VALUES (2, CAST(N'text' AS sql_variant))",
        ] {
            adapter.rows(sql).await.expect(sql);
        }
        let error = adapter
            .execute_query("SELECT * FROM dbo.l8db_variant")
            .await
            .unwrap_err();
        assert_eq!(error, UNREADABLE_TYPE);
        let data = adapter
            .fetch_rows(
                "dbo",
                "l8db_variant",
                None,
                10,
                0,
                Some("id"),
                false,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(data.rows.len(), 2);
        assert_eq!(data.rows[1]["v"], serde_json::json!("text"));
        adapter.test_connection().await.expect("pool still healthy");
        adapter
            .rows("DROP TABLE dbo.l8db_variant")
            .await
            .expect("cleanup");
    }

    #[test]
    fn column_types_keep_length_precision_and_scale() {
        assert_eq!(type_sql("decimal", 9, 10, 2), "decimal(10, 2)");
        assert_eq!(type_sql("numeric", 17, 38, 0), "numeric(38, 0)");
        assert_eq!(type_sql("nvarchar", 200, 0, 0), "nvarchar(100)");
        assert_eq!(type_sql("nvarchar", -1, 0, 0), "nvarchar(MAX)");
        assert_eq!(type_sql("nchar", 10, 0, 0), "nchar(5)");
        assert_eq!(type_sql("varchar", -1, 0, 0), "varchar(MAX)");
        assert_eq!(type_sql("char", 5, 0, 0), "char(5)");
        assert_eq!(type_sql("varbinary", 16, 0, 0), "varbinary(16)");
        assert_eq!(type_sql("binary", 8, 0, 0), "binary(8)");
        assert_eq!(type_sql("datetime2", 7, 23, 3), "datetime2(3)");
        assert_eq!(type_sql("time", 3, 8, 0), "time(0)");
        assert_eq!(type_sql("datetimeoffset", 10, 34, 7), "datetimeoffset(7)");
        assert_eq!(type_sql("int", 4, 10, 0), "int");
        assert_eq!(type_sql("float", 8, 53, 0), "float");
        assert_eq!(type_sql("sysname", 256, 0, 0), "sysname");
    }

    #[test]
    fn altered_columns_keep_their_collation() {
        let ci = Some("Latin1_General_CS_AS");
        assert_eq!(
            alter_column_type(None, "nvarchar(100)", ci),
            "nvarchar(100) COLLATE Latin1_General_CS_AS"
        );
        assert_eq!(
            alter_column_type(None, "decimal(10, 2)", None),
            "decimal(10, 2)"
        );
        assert_eq!(alter_column_type(Some("  "), "int", None), "int");
        assert_eq!(
            alter_column_type(Some("nvarchar(200)"), "nvarchar(100)", ci),
            "nvarchar(200) COLLATE Latin1_General_CS_AS"
        );
        assert_eq!(
            alter_column_type(Some("VARCHAR (MAX)"), "nvarchar(100)", ci),
            "VARCHAR (MAX) COLLATE Latin1_General_CS_AS"
        );
        assert_eq!(
            alter_column_type(Some("ntext"), "nvarchar(100)", ci),
            "ntext COLLATE Latin1_General_CS_AS"
        );
        assert_eq!(
            alter_column_type(
                Some("nvarchar(50) collate Latin1_General_BIN2"),
                "nvarchar(100)",
                ci
            ),
            "nvarchar(50) collate Latin1_General_BIN2"
        );
        assert_eq!(alter_column_type(Some("int"), "nvarchar(100)", ci), "int");
        assert_eq!(
            alter_column_type(Some("varbinary(10)"), "varchar(10)", ci),
            "varbinary(10)"
        );
        assert_eq!(
            alter_column_type(Some("nvarchar(10)"), "int", None),
            "nvarchar(10)"
        );
    }

    #[test]
    fn session_changing_sql_is_detected() {
        for sql in [
            "USE master",
            "SELECT 1; USE master",
            "select 1\nuse [master]",
            "SET IMPLICIT_TRANSACTIONS ON",
            "SET ROWCOUNT 10",
            "set rowcount @n",
            "SET NOCOUNT ON",
            "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
            "SET ANSI_NULLS, QUOTED_IDENTIFIER OFF",
            "SET IDENTITY_INSERT dbo.t ON",
            "SET CONTEXT_INFO 0x01",
            "SELECT 1 /* x */ ; SET LANGUAGE German",
            "REVERT",
            "SELECT 1; REVERT",
            "EXECUTE AS USER = 'x'",
            "EXEC sp_set_session_context 'k', 'v'",
            "exec('use master')",
            "sp_setapprole 'role', 'pw'",
            "dbo.do_things",
            "[dbo].[do_things] 1",
            "BEGIN TRANSACTION",
            "DECLARE @x int; BEGIN TRAN",
            "INSERT INTO t VALUES (1); COMMIT",
            "SELECT 1 INTO #tmp",
            "SELECT 1 INTO [#tmp]",
            "CREATE TABLE ##global (id int)",
            "DECLARE c CURSOR GLOBAL FOR SELECT 1",
            "OPEN SYMMETRIC KEY k DECRYPTION BY PASSWORD = 'x'",
            "DBCC TRACEON (3604)",
            "SETUSER 'bob'",
            "SAVE TRANSACTION sp1",
            "ROLLBACK",
            "SELECT 1; SET XACT_ABORT ON",
        ] {
            assert!(may_change_session(sql), "{sql}");
        }
        for sql in [
            "",
            "SELECT * FROM [dbo].[t] WHERE [use] = 'USE master; SET ROWCOUNT 1'",
            "SELECT '#not_temp', N'EXEC x' AS [exec] -- USE master",
            "SELECT 1 /* SET ROWCOUNT 1 /* nested */ REVERT */",
            "SELECT \"set\", [begin] FROM t",
            "WITH x AS (SELECT 1 AS a) SELECT a FROM x",
            "UPDATE t SET v = v + 1",
            "UPDATE t SET [v] = 1, w = 2 WHERE id = 1",
            "UPDATE t SET t.v = 1",
            "UPDATE t SET v += 1",
            "UPDATE t SET doc.WRITE(N'x', 0, 1)",
            "UPDATE t SET @x = v = v + 1",
            "DECLARE @x int; SET @x = 1; SELECT @x",
            "INSERT INTO dbo.t (a) VALUES ('BEGIN TRAN')",
            "DELETE FROM t WHERE id = 1",
            "MERGE t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET v = s.v;",
            "CREATE TABLE t (id int, p int REFERENCES p(id) ON DELETE SET NULL ON UPDATE SET DEFAULT)",
            "SELECT TOP 10 * FROM t ORDER BY id OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY",
            "; SELECT 1",
            "(SELECT 1) UNION (SELECT 2)",
            "DROP TABLE dbo.t",
            "ALTER TABLE dbo.t ADD c int",
            "TRUNCATE TABLE dbo.t",
            "SELECT * FROM OPENJSON(@j)",
        ] {
            assert!(!may_change_session(sql), "{sql}");
        }
    }

    #[tokio::test]
    async fn driver_panics_become_errors() {
        let result: Result<(), String> = guarded(async { panic!("not yet implemented") }).await;
        assert_eq!(result.unwrap_err(), UNREADABLE_TYPE);
    }

    #[test]
    fn numeric_text_keeps_sign_and_scale() {
        assert_eq!(numeric_text(-1, 6), "-0.000001");
        assert_eq!(
            numeric_text(12345678901234123456, 6),
            "12345678901234.123456"
        );
        assert_eq!(numeric_text(150, 2), "1.50");
        assert_eq!(numeric_text(-7, 0), "-7");
    }

    #[test]
    fn module_ddl_runs_as_own_batch() {
        assert!(starts_batch("CREATE SCHEMA app"));
        assert!(starts_batch(
            "create or alter procedure [s].[p] AS SELECT 1"
        ));
        assert!(starts_batch("ALTER VIEW v AS SELECT 1"));
        assert!(!starts_batch("CREATE TABLE t (id int)"));
        assert!(!starts_batch("SELECT 1"));
    }

    #[test]
    fn create_becomes_create_or_alter() {
        assert_eq!(
            create_or_alter("\n  create   FUNCTION dbo.f() RETURNS INT AS BEGIN RETURN 1 END"),
            "CREATE OR ALTER   FUNCTION dbo.f() RETURNS INT AS BEGIN RETURN 1 END"
        );
        assert_eq!(
            create_or_alter("CREATE OR ALTER PROCEDURE p AS SELECT 1"),
            "CREATE OR ALTER PROCEDURE p AS SELECT 1"
        );
        assert_eq!(
            create_or_alter("ALTER TRIGGER t ON x AFTER INSERT AS SELECT 1"),
            "ALTER TRIGGER t ON x AFTER INSERT AS SELECT 1"
        );
    }

    #[test]
    fn parses_url_options() {
        let pool = crate::db::pool::create_pool_state();
        let adapter = MssqlAdapter::new("mssql://sa:P%40ss@db.example.com:1434/master?encrypt=true&trust_server_certificate=true", Some("other"), pool.clone(), "k".into()).unwrap();
        assert_eq!(adapter.config.get_addr(), "db.example.com:1434");
        assert!(MssqlAdapter::new("mysql://x@y/z", None, pool.clone(), "k".into()).is_err());
        let trusted = MssqlAdapter::new(
            "mssql://srv/master?trusted_connection=true",
            None,
            pool,
            "k".into(),
        );
        assert_eq!(trusted.is_ok(), cfg!(windows));
        assert!(is_result_statement("  select 1"));
        assert!(!is_result_statement("UPDATE t SET a = 1"));
        assert!(is_result_statement(
            "INSERT INTO t OUTPUT INSERTED.* DEFAULT VALUES"
        ));
        assert!(is_tx_control("begin tran"));
        assert!(is_tx_control("ROLLBACK"));
        assert!(!is_tx_control("BEGIN SELECT 1 END"));
    }

    #[tokio::test]
    #[ignore]
    async fn live_tls_modes() {
        let Ok(base) = std::env::var("L8DB_E2E_MSSQL_TLS_URL") else {
            return;
        };
        let connect = |query: &str| {
            let url = format!("{base}{query}");
            async move {
                MssqlAdapter::new(
                    &url,
                    None,
                    crate::db::pool::create_pool_state(),
                    url.clone(),
                )?
                .test_connection()
                .await
            }
        };
        assert_eq!(connect("").await, Ok(()));
        assert_eq!(connect("?sslmode=require").await, Ok(()));
        assert_eq!(connect("?sslmode=disable").await, Ok(()));
        assert!(connect("?sslmode=verify-full").await.is_err());
        assert!(connect("?encrypt=true").await.is_err());
        assert_eq!(
            connect("?encrypt=true&trustservercertificate=true").await,
            Ok(())
        );
        assert!(
            connect("?sslmode=verify-ca&sslrootcert=/does/not/exist.pem")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    #[ignore]
    async fn live_proxy_user_sees_rows_through_security_policy() {
        let Ok(url) = std::env::var("L8DB_SMOKE_MSSQL_URL") else {
            return;
        };
        let pool = crate::db::pool::create_pool_state();
        let server =
            MssqlAdapter::new(&url, Some("master"), pool.clone(), "px-master".into()).unwrap();
        for sql in [
            "IF DB_ID('l8db_px') IS NOT NULL BEGIN ALTER DATABASE l8db_px SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE l8db_px END",
            "IF SUSER_ID('l8db_px_viewer') IS NOT NULL DROP LOGIN l8db_px_viewer",
            "CREATE DATABASE l8db_px",
            "CREATE LOGIN l8db_px_viewer WITH PASSWORD = 'L8db-Viewer-pw1', CHECK_POLICY = OFF",
        ] {
            server.execute_query(sql).await.expect(sql);
        }
        let admin =
            MssqlAdapter::new(&url, Some("l8db_px"), pool.clone(), "px-admin".into()).unwrap();
        for sql in [
            "CREATE USER l8db_px_viewer FOR LOGIN l8db_px_viewer",
            "CREATE TABLE dbo.probe (owner sysname, v int)",
            "INSERT INTO dbo.probe VALUES ('l8db_px_viewer', 1), ('other', 2), ('other', 3)",
            "CREATE FUNCTION dbo.probe_pred(@owner sysname) RETURNS TABLE WITH SCHEMABINDING AS RETURN SELECT 1 AS ok WHERE @owner = USER_NAME() OR IS_MEMBER('db_owner') = 1",
            "CREATE SECURITY POLICY dbo.probe_policy ADD FILTER PREDICATE dbo.probe_pred(owner) ON dbo.probe WITH (STATE = ON)",
            "GRANT SELECT ON dbo.probe TO l8db_px_viewer",
        ] {
            admin.rows(sql).await.expect(sql);
        }
        let separator = if url.contains('?') { "&" } else { "?" };
        let proxied = MssqlAdapter::new(
            &format!("{url}{separator}proxy_user=l8db_px_viewer"),
            Some("l8db_px"),
            pool.clone(),
            "px-proxied".into(),
        )
        .unwrap();
        proxied.test_connection().await.expect("proxy connection");
        assert_eq!(
            admin.count_rows("dbo", "probe", None, false).await.unwrap(),
            3
        );
        assert_eq!(
            proxied
                .count_rows("dbo", "probe", None, false)
                .await
                .unwrap(),
            1
        );
        let who = proxied
            .execute_query("SELECT SUSER_SNAME() AS who")
            .await
            .unwrap();
        assert_eq!(who.rows[0]["who"], "l8db_px_viewer");
        proxied
            .execute_query("SELECT 1 AS x; REVERT")
            .await
            .unwrap();
        assert_eq!(
            proxied
                .count_rows("dbo", "probe", None, false)
                .await
                .unwrap(),
            1
        );
        assert!(proxied
            .execute_query("INSERT INTO dbo.probe VALUES ('l8db_px_viewer', 4)")
            .await
            .is_err());
        let denied = MssqlAdapter::new(
            &format!("{url}{separator}proxy_user=l8db_px_missing"),
            Some("l8db_px"),
            pool,
            "px-denied".into(),
        )
        .unwrap();
        assert!(denied.test_connection().await.is_err());
        drop(proxied);
        drop(admin);
        server
            .execute_query("ALTER DATABASE l8db_px SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE l8db_px; DROP LOGIN l8db_px_viewer")
            .await
            .expect("cleanup");
    }

    fn live_url() -> Option<String> {
        std::env::var("L8DB_SMOKE_MSSQL_URL").ok()
    }

    async fn column_types(adapter: &MssqlAdapter, table: &str) -> Vec<(String, String, String)> {
        adapter
            .rows(&format!(
                "SELECT c.name, TYPE_NAME(c.user_type_id) + '/' + CAST(c.max_length AS varchar(10)) + '/' + CAST(c.precision AS varchar(10)) + '/' + CAST(c.scale AS varchar(10)) + '/' + CAST(c.is_nullable AS varchar(1)), ISNULL(c.collation_name, '') FROM sys.columns c WHERE c.object_id = OBJECT_ID({}) ORDER BY c.column_id",
                lit(table)
            ))
            .await
            .unwrap()
            .iter()
            .map(|r| (text(r, 0), text(r, 1), text(r, 2)))
            .collect()
    }

    #[tokio::test]
    #[ignore]
    async fn live_alter_column_keeps_xml_schema_sparse_and_mask() {
        let Some(url) = live_url() else {
            return;
        };
        let pool = crate::db::pool::create_pool_state();
        let adapter = MssqlAdapter::new(&url, Some("master"), pool, "alter-attrs".into()).unwrap();
        for sql in [
            "IF OBJECT_ID('dbo.l8db_alter_attrs') IS NOT NULL DROP TABLE dbo.l8db_alter_attrs",
            "IF EXISTS (SELECT 1 FROM sys.xml_schema_collections WHERE name = 'l8db_rpx') DROP XML SCHEMA COLLECTION dbo.l8db_rpx",
            "CREATE XML SCHEMA COLLECTION dbo.l8db_rpx AS N'<xs:schema xmlns:xs=\"http://www.w3.org/2001/XMLSchema\"><xs:element name=\"a\" type=\"xs:int\"/></xs:schema>'",
            "CREATE TABLE dbo.l8db_alter_attrs (x xml(CONTENT dbo.l8db_rpx) NULL, xd xml(DOCUMENT dbo.l8db_rpx) NULL, sp int SPARSE NULL, m varchar(20) MASKED WITH (FUNCTION = 'partial(1, \"xx\", 0)') NULL)",
        ] {
            adapter.rows(sql).await.expect(sql);
        }
        let state = || async {
            adapter
                .rows("SELECT c.name, CAST(c.xml_collection_id AS int), CAST(c.is_xml_document AS int), CAST(c.is_sparse AS int), CAST(c.is_masked AS int), ISNULL(mc.masking_function, '') FROM sys.columns c LEFT JOIN sys.masked_columns mc ON mc.object_id = c.object_id AND mc.column_id = c.column_id WHERE c.object_id = OBJECT_ID('dbo.l8db_alter_attrs') ORDER BY c.column_id")
                .await
                .unwrap()
                .iter()
                .map(|r| format!("{}/{}/{}/{}/{}/{}", text(r, 0), int(r, 1) != 0, int(r, 2), int(r, 3), int(r, 4), text(r, 5)))
                .collect::<Vec<_>>()
        };
        let before = state().await;
        for name in ["x", "xd", "sp", "m"] {
            adapter
                .alter_column(
                    "dbo",
                    "l8db_alter_attrs",
                    &AlterColumnRequest {
                        old_name: name.into(),
                        new_name: None,
                        data_type: None,
                        set_not_null: Some(false),
                        new_default: None,
                        drop_default: false,
                    },
                )
                .await
                .unwrap_or_else(|e| panic!("{name}: {e}"));
        }
        assert_eq!(state().await, before);
        adapter
            .alter_column(
                "dbo",
                "l8db_alter_attrs",
                &AlterColumnRequest {
                    old_name: "m".into(),
                    new_name: None,
                    data_type: Some("varchar(40)".into()),
                    set_not_null: None,
                    new_default: None,
                    drop_default: false,
                },
            )
            .await
            .unwrap();
        assert_eq!(state().await, before);
        adapter
            .rows("DROP TABLE dbo.l8db_alter_attrs; DROP XML SCHEMA COLLECTION dbo.l8db_rpx")
            .await
            .expect("cleanup");
    }

    #[tokio::test]
    #[ignore]
    async fn live_alter_column_nullability_keeps_type_and_collation() {
        let Some(url) = live_url() else {
            return;
        };
        let pool = crate::db::pool::create_pool_state();
        let adapter = MssqlAdapter::new(&url, Some("master"), pool, "alter-keep".into()).unwrap();
        for sql in [
            "IF OBJECT_ID('dbo.l8db_alter_keep') IS NOT NULL DROP TABLE dbo.l8db_alter_keep",
            "IF TYPE_ID('dbo.l8db_phone') IS NOT NULL DROP TYPE dbo.l8db_phone",
            "CREATE TYPE dbo.l8db_phone FROM varchar(20) NULL",
            "CREATE TABLE dbo.l8db_alter_keep (amount decimal(10,2) NULL, label nvarchar(100) COLLATE Latin1_General_CS_AS NULL, body varchar(max) NULL, stamp datetime2(3) NULL, raw varbinary(16) NULL, code char(5) COLLATE Latin1_General_BIN2 NULL, phone dbo.l8db_phone NULL, owner sysname NULL, ratio float NULL, at time(0) NULL)",
            "INSERT INTO dbo.l8db_alter_keep VALUES (12345.67, N'Hallo Welt', REPLICATE(CAST('x' AS varchar(max)), 9000), '2024-01-02 03:04:05.678', 0x0102, 'ab', '0301 1234', N'sa', 1.5, '10:11:12')",
        ] {
            adapter.rows(sql).await.expect(sql);
        }
        let before = column_types(&adapter, "dbo.l8db_alter_keep").await;
        for (name, _, _) in &before {
            adapter
                .alter_column(
                    "dbo",
                    "l8db_alter_keep",
                    &AlterColumnRequest {
                        old_name: name.clone(),
                        new_name: None,
                        data_type: None,
                        set_not_null: Some(true),
                        new_default: None,
                        drop_default: false,
                    },
                )
                .await
                .unwrap_or_else(|e| panic!("{name}: {e}"));
        }
        let after = column_types(&adapter, "dbo.l8db_alter_keep").await;
        let expected: Vec<_> = before
            .iter()
            .map(|(n, t, c)| (n.clone(), format!("{}0", &t[..t.len() - 1]), c.clone()))
            .collect();
        assert_eq!(after, expected);
        adapter
            .alter_column(
                "dbo",
                "l8db_alter_keep",
                &AlterColumnRequest {
                    old_name: "label".into(),
                    new_name: None,
                    data_type: Some("nvarchar(200)".into()),
                    set_not_null: None,
                    new_default: None,
                    drop_default: false,
                },
            )
            .await
            .unwrap();
        let widened = column_types(&adapter, "dbo.l8db_alter_keep").await;
        assert_eq!(
            widened[1],
            (
                "label".to_string(),
                "nvarchar/400/0/0/0".to_string(),
                "Latin1_General_CS_AS".to_string()
            )
        );
        let row = adapter
            .execute_query("SELECT CAST(amount AS varchar(20)) AS amount, label, LEN(body) AS body FROM dbo.l8db_alter_keep")
            .await
            .unwrap();
        assert_eq!(row.rows[0]["amount"], "12345.67");
        assert_eq!(row.rows[0]["label"], "Hallo Welt");
        assert_eq!(row.rows[0]["body"], 9000);
        adapter
            .rows("DROP TABLE dbo.l8db_alter_keep; DROP TYPE dbo.l8db_phone")
            .await
            .expect("cleanup");
    }

    async fn in_script(
        adapter: &MssqlAdapter,
        session: &str,
        sql: &str,
    ) -> Result<QueryResult, String> {
        crate::db::execution::with_session(Some(session.to_string()), adapter.execute_query(sql))
            .await
    }

    #[tokio::test]
    #[ignore]
    async fn live_script_sessions_keep_state_between_statements() {
        let Some(url) = live_url() else {
            return;
        };
        let pool = crate::db::pool::create_pool_state();
        let adapter =
            MssqlAdapter::new(&url, Some("master"), pool, "script-session".into()).unwrap();
        adapter
            .execute_query("IF OBJECT_ID('dbo.l8db_rp') IS NOT NULL DROP TABLE dbo.l8db_rp; CREATE TABLE dbo.l8db_rp (id int IDENTITY PRIMARY KEY, d date)")
            .await
            .unwrap();
        for sql in [
            "SET IDENTITY_INSERT dbo.l8db_rp ON",
            "INSERT INTO dbo.l8db_rp (id, d) VALUES (100, '2024-01-01')",
            "SET IDENTITY_INSERT dbo.l8db_rp OFF",
            "SELECT 1 AS x INTO #t",
            "SELECT * FROM #t",
            "SET DATEFORMAT dmy",
            "INSERT INTO dbo.l8db_rp (d) VALUES ('01/02/2024')",
        ] {
            in_script(&adapter, "script-a", sql).await.expect(sql);
        }
        assert!(in_script(
            &adapter,
            "script-a",
            "INSERT INTO dbo.l8db_rp (d) VALUES ('31/31/2024')"
        )
        .await
        .is_err());
        in_script(&adapter, "script-a", "SELECT * FROM #t")
            .await
            .expect("session survives a failed statement");
        let stored = adapter
            .execute_query("SELECT CONVERT(varchar(10), d, 23) AS d FROM dbo.l8db_rp ORDER BY id")
            .await
            .unwrap();
        assert_eq!(stored.rows[0]["d"], "2024-01-01");
        assert_eq!(stored.rows[1]["d"], "2024-02-01");
        assert!(in_script(&adapter, "script-b", "SELECT * FROM #t")
            .await
            .is_err());
        let probe = adapter
            .execute_query(
                "SELECT CASE WHEN OBJECT_ID('tempdb..#t') IS NULL THEN 0 ELSE 1 END AS tmp",
            )
            .await
            .unwrap();
        assert_eq!(probe.rows[0]["tmp"], 0);
        adapter
            .execute_query("DROP TABLE dbo.l8db_rp")
            .await
            .expect("cleanup");
    }

    #[tokio::test]
    #[ignore]
    async fn live_pooled_clients_do_not_leak_session_state() {
        let Some(url) = live_url() else {
            return;
        };
        let pool = crate::db::pool::create_pool_state();
        let server =
            MssqlAdapter::new(&url, Some("master"), pool.clone(), "leak-master".into()).unwrap();
        server
            .execute_query("IF DB_ID('l8db_leak') IS NULL CREATE DATABASE l8db_leak")
            .await
            .unwrap();
        let adapter = MssqlAdapter::new(&url, Some("l8db_leak"), pool, "leak".into()).unwrap();
        let probe = "SELECT DB_NAME() AS db, @@OPTIONS & 2 AS implicit, @@TRANCOUNT AS tc, CASE WHEN OBJECT_ID('tempdb..#leak') IS NULL THEN 0 ELSE 1 END AS tmp, @@LOCK_TIMEOUT AS lt";
        let state = || async {
            let row = adapter.execute_query(probe).await.unwrap().rows[0].clone();
            let rows = adapter
                .execute_query("SELECT TOP 3 name FROM sys.all_objects")
                .await
                .unwrap()
                .rows
                .len();
            (row, rows)
        };
        let baseline = state().await;
        assert_eq!(baseline.0["db"], "l8db_leak");
        assert_eq!(baseline.1, 3);
        for sql in [
            "SELECT 1 AS x; USE master",
            "SET IMPLICIT_TRANSACTIONS ON",
            "SET ROWCOUNT 1",
            "SELECT 1 AS x INTO #leak",
            "SET LOCK_TIMEOUT 5",
            "DECLARE @x int; BEGIN TRANSACTION",
        ] {
            adapter.execute_query(sql).await.expect(sql);
            assert_eq!(state().await, baseline, "{sql}");
        }
        adapter
            .execute_query("CREATE TABLE dbo.counter (v int); INSERT INTO dbo.counter VALUES (1)")
            .await
            .unwrap();
        let spid = || async {
            adapter
                .execute_query("SELECT @@SPID AS spid")
                .await
                .unwrap()
                .rows[0]["spid"]
                .clone()
        };
        let first = spid().await;
        adapter
            .execute_query("UPDATE dbo.counter SET v = v + 1")
            .await
            .unwrap();
        assert_eq!(spid().await, first);
        drop(adapter);
        server
            .execute_query("ALTER DATABASE l8db_leak SET SINGLE_USER WITH ROLLBACK IMMEDIATE")
            .await
            .unwrap();
        server
            .execute_query("DROP DATABASE l8db_leak")
            .await
            .unwrap();
    }
}
