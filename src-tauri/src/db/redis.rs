use async_trait::async_trait;
use redis::aio::MultiplexedConnection;
use redis::Value;

use super::pool::PoolState;
use super::{
    rows_to_objects, timed, unsupported, ColumnInfo, DatabaseAdapter, DetailedColumnInfo,
    QueryResult, RowCount, TableData, TableInfo,
};

pub struct RedisAdapter {
    url: String,
    pool_state: PoolState,
    key: String,
}

const WRITE_COMMANDS: &[&str] = &[
    "APPEND",
    "BITFIELD",
    "BITOP",
    "BLMOVE",
    "BLMPOP",
    "BLPOP",
    "BRPOP",
    "BRPOPLPUSH",
    "BZMPOP",
    "BZPOPMAX",
    "BZPOPMIN",
    "COPY",
    "DECR",
    "DECRBY",
    "DEL",
    "EXPIRE",
    "EXPIREAT",
    "FLUSHALL",
    "FLUSHDB",
    "FUNCTION",
    "GEOADD",
    "GEORADIUS",
    "GEORADIUSBYMEMBER",
    "GEOSEARCHSTORE",
    "GETDEL",
    "GETEX",
    "GETSET",
    "HDEL",
    "HEXPIRE",
    "HEXPIREAT",
    "HINCRBY",
    "HINCRBYFLOAT",
    "HMSET",
    "HPERSIST",
    "HPEXPIRE",
    "HPEXPIREAT",
    "HSET",
    "HSETNX",
    "INCR",
    "INCRBY",
    "INCRBYFLOAT",
    "LINSERT",
    "LMOVE",
    "LMPOP",
    "LPOP",
    "LPUSH",
    "LPUSHX",
    "LREM",
    "LSET",
    "LTRIM",
    "MIGRATE",
    "MOVE",
    "MSET",
    "MSETNX",
    "PERSIST",
    "PEXPIRE",
    "PEXPIREAT",
    "PFADD",
    "PFDEBUG",
    "PFMERGE",
    "PSETEX",
    "RENAME",
    "RENAMENX",
    "RESTORE",
    "SADD",
    "SDIFFSTORE",
    "SET",
    "SETBIT",
    "SETEX",
    "SETNX",
    "SETRANGE",
    "SINTERSTORE",
    "SMOVE",
    "SORT",
    "SPOP",
    "SREM",
    "SUNIONSTORE",
    "SWAPDB",
    "UNLINK",
    "XACK",
    "XADD",
    "XAUTOCLAIM",
    "XCLAIM",
    "XDEL",
    "XGROUP",
    "XREADGROUP",
    "XSETID",
    "XTRIM",
    "ZADD",
    "ZDIFFSTORE",
    "ZINCRBY",
    "ZINTERSTORE",
    "ZMPOP",
    "ZPOPMAX",
    "ZPOPMIN",
    "ZRANGESTORE",
    "ZREM",
    "ZREMRANGEBYLEX",
    "ZREMRANGEBYRANK",
    "ZREMRANGEBYSCORE",
    "ZUNIONSTORE",
    "CONFIG",
    "DEBUG",
    "SHUTDOWN",
    "SLAVEOF",
    "REPLICAOF",
    "EVAL",
    "EVALSHA",
    "FCALL",
    "SCRIPT",
    "MODULE",
    "CLIENT",
    "ACL",
    "SAVE",
    "BGSAVE",
    "BGREWRITEAOF",
    "CLUSTER",
    "PUBLISH",
    "JSON.SET",
    "JSON.DEL",
    "JSON.MERGE",
    "JSON.MSET",
    "JSON.ARRAPPEND",
    "JSON.ARRINSERT",
    "JSON.ARRPOP",
    "JSON.ARRTRIM",
    "JSON.NUMINCRBY",
    "JSON.STRAPPEND",
    "JSON.TOGGLE",
    "JSON.CLEAR",
    "FT.CREATE",
    "FT.DROPINDEX",
    "FT.ALTER",
];

const COLUMNS: [&str; 6] = ["key", "type", "ttl", "value", "size", "truncated"];

fn column_type(column: &str) -> &str {
    match column {
        "ttl" | "size" => "integer",
        "truncated" => "boolean",
        "value" => "json",
        _ => "text",
    }
}

const SORTED_KEY_LIMIT: usize = 10_000;
const SORTED_SCAN_CALLS: usize = 32;
const SCAN_COUNT: usize = 1_000;
const SCAN_COUNT_MAX: usize = 10_000;
const MAX_SCAN_CALLS: usize = 256;
const CURSOR_PATTERNS: usize = 32;
const CURSOR_POINTS: usize = 1_024;
const KEYS_LIMIT: i64 = 100_000;
const BLOCKING: [&str; 11] = [
    "BLPOP",
    "BRPOP",
    "BLMOVE",
    "BRPOPLPUSH",
    "BLMPOP",
    "BZPOPMIN",
    "BZPOPMAX",
    "BZMPOP",
    "XREAD",
    "XREADGROUP",
    "WAIT",
];

#[derive(Clone, Copy, Debug, PartialEq)]
struct Checkpoint {
    cursor: u64,
    count: usize,
    skip: usize,
}

#[derive(Default)]
struct CursorState {
    points: std::collections::BTreeMap<usize, Checkpoint>,
    partial: bool,
}

type CursorCache = std::collections::HashMap<String, CursorState>;

fn cursor_state<T>(f: impl FnOnce(&mut CursorCache) -> T) -> T {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<CursorCache>> = std::sync::OnceLock::new();
    f(&mut CACHE
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()))
}

async fn is_dragonfly(conn: &mut impl redis::aio::ConnectionLike) -> bool {
    redis::cmd("INFO")
        .arg("server")
        .query_async::<String>(conn)
        .await
        .is_ok_and(|info| info.contains("dragonfly_version:"))
}

fn server_detail(code: &str, detail: &str) -> String {
    let lower = detail.to_ascii_lowercase();
    let quoted = || {
        detail
            .split(['\'', '`'])
            .nth(1)
            .unwrap_or_default()
            .to_ascii_uppercase()
    };
    if lower.starts_with("unknown command") {
        format!("Unbekannter Befehl {}", quoted())
    } else if lower.starts_with("wrong number of arguments") {
        format!("Falsche Anzahl Argumente für {}", quoted())
    } else if lower.starts_with("syntax error") {
        "Syntaxfehler".to_string()
    } else if lower.contains("db index is out of range") {
        "Diese Datenbank gibt es auf dem Server nicht".to_string()
    } else if lower.starts_with("value is not an integer") {
        "Wert ist keine ganze Zahl oder zu groß".to_string()
    } else {
        format!("{code}: {detail}")
    }
}

fn column_comment(column: &str) -> &'static str {
    match column {
        "key" => "Name, eindeutig",
        "type" => "Redis-Datentyp",
        "ttl" => "Sekunden bis zum Ablauf, leer = kein Ablauf",
        "value" => "Vorschau: bis 100 Einträge bzw. 4 KiB",
        "size" => "Bytes bei Strings, sonst Anzahl Einträge",
        _ => "Vorschau gekürzt",
    }
}

fn map_err(e: redis::RedisError) -> String {
    if e.is_timeout() {
        return format!(
            "Zeitlimit von {} s überschritten",
            super::execution::query_duration().as_secs()
        );
    }
    if e.is_connection_refusal() {
        return "Verbindung abgelehnt: Läuft der Server, stimmt der Port?".to_string();
    }
    if e.kind() == redis::ErrorKind::AuthenticationFailed {
        return "Anmeldung fehlgeschlagen: Passwort falsch oder auf dem Server nicht gesetzt"
            .to_string();
    }
    if e.is_connection_dropped() {
        return "Verbindung zum Server getrennt".to_string();
    }
    let detail = e.detail().unwrap_or_default().trim().to_string();
    match e.code() {
        Some("NOAUTH") => {
            "Anmeldung erforderlich: Passwort in der URL angeben, z. B. redis://:passwort@host:6379 (NOAUTH)"
                .to_string()
        }
        Some("WRONGPASS") => "Benutzername oder Passwort falsch (WRONGPASS)".to_string(),
        Some("WRONGTYPE") => "Befehl passt nicht zum Datentyp des Keys (WRONGTYPE)".to_string(),
        Some("NOPERM") => format!("Keine Berechtigung: {detail} (NOPERM)"),
        Some(code) => server_detail(code, &detail),
        None => e.to_string(),
    }
}

fn blocks_forever(args: &[Vec<u8>]) -> bool {
    let upper = |index: usize| {
        args.get(index)
            .map(|arg| String::from_utf8_lossy(arg).to_ascii_uppercase())
    };
    let zero = |arg: Option<String>| arg.is_some_and(|arg| arg.parse::<f64>() == Ok(0.0));
    match upper(0).as_deref() {
        Some("BLPOP" | "BRPOP" | "BZPOPMIN" | "BZPOPMAX" | "BRPOPLPUSH" | "BLMOVE") => {
            args.len() > 2 && zero(upper(args.len() - 1))
        }
        Some("BLMPOP" | "BZMPOP") => zero(upper(1)),
        Some("WAIT") => zero(upper(2)),
        Some("XREAD" | "XREADGROUP") => args
            .iter()
            .position(|arg| arg.eq_ignore_ascii_case(b"BLOCK"))
            .is_some_and(|index| zero(upper(index + 1))),
        _ => false,
    }
}

fn info_rows(text: &str) -> Vec<Vec<serde_json::Value>> {
    let mut section = String::new();
    let mut rows = Vec::new();
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Some(name) = line.strip_prefix('#') {
            section = name.trim().to_string();
        } else if let Some((field, value)) = line.split_once(':') {
            rows.push(vec![
                section.clone().into(),
                field.to_string().into(),
                value.to_string().into(),
            ]);
        }
    }
    rows
}

fn is_binary(text: &str) -> bool {
    text.chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}

fn value_to_json(value: Value) -> serde_json::Value {
    match value {
        Value::Nil => serde_json::Value::Null,
        Value::Int(i) => serde_json::Value::from(i),
        Value::BulkString(bytes) => match String::from_utf8(bytes) {
            Ok(s) if is_binary(&s) => serde_json::Value::String(super::hex_blob(s.as_bytes())),
            Ok(s) => serde_json::Value::String(s),
            Err(e) => serde_json::Value::String(super::hex_blob(e.as_bytes())),
        },
        Value::SimpleString(s) => serde_json::Value::String(s),
        Value::Okay => serde_json::Value::String("OK".to_string()),
        Value::Array(items) | Value::Set(items) => {
            serde_json::Value::Array(items.into_iter().map(value_to_json).collect())
        }
        Value::Map(pairs) => serde_json::Value::Object(
            pairs
                .into_iter()
                .map(|(k, v)| {
                    let key = match value_to_json(k) {
                        serde_json::Value::String(s) => s,
                        other => other.to_string(),
                    };
                    (key, value_to_json(v))
                })
                .collect(),
        ),
        Value::Double(d) => serde_json::Number::from_f64(d)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(d.to_string())),
        Value::Boolean(b) => serde_json::Value::Bool(b),
        Value::VerbatimString { text, .. } => serde_json::Value::String(text),
        Value::BigNumber(n) => serde_json::Value::String(n.to_string()),
        Value::Attribute { data, .. } => value_to_json(*data),
        Value::ServerError(e) => serde_json::Value::String(format!("ERR {e:?}")),
        other => serde_json::Value::String(format!("{other:?}")),
    }
}

pub fn unknown_command(statement: &str) -> Option<String> {
    let name = split_command(statement.trim()).ok()?.into_iter().next()?;
    let name = String::from_utf8_lossy(&name).to_ascii_uppercase();
    (!WRITE_COMMANDS.contains(&name.as_str())).then_some(name)
}

pub fn split_command(line: &str) -> Result<Vec<Vec<u8>>, String> {
    let mut args = Vec::new();
    let mut current = Vec::new();
    let mut quote = None;
    let mut chars = line.chars().peekable();
    let mut has_token = false;
    let mut closed_quote = false;
    while let Some(ch) = chars.next() {
        if closed_quote && !ch.is_whitespace() {
            return Err("Nach einem Anführungszeichen muss ein Leerzeichen folgen".into());
        }
        match quote {
            Some(q) if ch == q => {
                quote = None;
                closed_quote = true;
            }
            Some('"') if ch == '\\' => {
                let next = chars.next().ok_or("Unvollständige Escape-Sequenz")?;
                if next == 'x' {
                    let hi = chars.next().and_then(|c| c.to_digit(16));
                    let lo = chars.next().and_then(|c| c.to_digit(16));
                    current.push(match (hi, lo) {
                        (Some(hi), Some(lo)) => (hi * 16 + lo) as u8,
                        _ => return Err("Ungültige hexadezimale Escape-Sequenz".into()),
                    });
                } else {
                    let decoded = match next {
                        'n' => '\n',
                        'r' => '\r',
                        't' => '\t',
                        'b' => '\u{8}',
                        'a' => '\u{7}',
                        other => other,
                    };
                    let mut bytes = [0; 4];
                    current.extend_from_slice(decoded.encode_utf8(&mut bytes).as_bytes());
                }
            }
            Some('\'') if ch == '\\' && chars.peek() == Some(&'\'') => {
                chars.next();
                current.push(b'\'');
            }
            None if ch == '"' || ch == '\'' => {
                quote = Some(ch);
                has_token = true;
            }
            None if ch.is_whitespace() => {
                if has_token {
                    args.push(std::mem::take(&mut current));
                    has_token = false;
                }
                closed_quote = false;
            }
            _ => {
                let mut bytes = [0; 4];
                current.extend_from_slice(ch.encode_utf8(&mut bytes).as_bytes());
                has_token = true;
            }
        }
    }
    if quote.is_some() {
        return Err("Nicht geschlossenes Anführungszeichen".into());
    }
    if has_token {
        args.push(current);
    }
    Ok(args)
}

pub fn normalize_redis_url(value: &str, database: Option<&str>) -> Result<url::Url, String> {
    let mut url = url::Url::parse(value.trim()).map_err(|_| "Ungültige Redis-URL".to_string())?;
    if !matches!(
        url.scheme(),
        "redis" | "rediss" | "valkey" | "redis+unix" | "unix"
    ) {
        return Err("Eine redis:// URL ist erforderlich".to_string());
    }
    if url.scheme() == "valkey" {
        url.set_scheme("redis").ok();
    }
    if let Some(db) = database.filter(|d| !d.is_empty()) {
        db.parse::<u32>()
            .map_err(|_| "Redis-Datenbanken sind Zahlen (0-15)".to_string())?;
        if matches!(url.scheme(), "redis+unix" | "unix") {
            let pairs: Vec<_> = url
                .query_pairs()
                .filter(|(key, _)| key != "db")
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect();
            url.set_query(None);
            url.query_pairs_mut()
                .extend_pairs(pairs)
                .append_pair("db", db);
        } else {
            url.set_path(&format!("/{db}"));
        }
    }
    Ok(url)
}

pub fn endpoint(value: &str) -> Result<super::endpoint::EndpointIdentity, String> {
    use redis::{ConnectionAddr, IntoConnectionInfo};
    let url = normalize_redis_url(value, None)?;
    let info = url.as_str().into_connection_info().map_err(map_err)?;
    let (host, port, tls, verify) = match info.addr() {
        ConnectionAddr::Tcp(host, port) => (host.clone(), Some(*port), false, false),
        ConnectionAddr::TcpTls {
            host,
            port,
            insecure,
            ..
        } => (host.clone(), Some(*port), true, !insecure),
        ConnectionAddr::Unix(path) => (path.display().to_string(), None, false, false),
        _ => (String::new(), None, false, false),
    };
    Ok(super::endpoint::EndpointIdentity {
        host: host.trim_matches(['[', ']']).to_ascii_lowercase(),
        port,
        transport: if tls { "tls" } else { "tcp" }.to_string(),
        tls,
        verify,
        database: info.redis_settings().db().to_string(),
        schema: String::new(),
        user: info
            .redis_settings()
            .username()
            .unwrap_or_default()
            .to_string(),
        params: Vec::new(),
    })
}

fn first_scan_count(pattern: &str, needed: usize) -> usize {
    if pattern == "*" {
        needed.clamp(SCAN_COUNT, SCAN_COUNT_MAX)
    } else {
        SCAN_COUNT
    }
}

fn size_command(kind: &str) -> Option<&'static str> {
    match kind {
        "string" => Some("STRLEN"),
        "hash" => Some("HLEN"),
        "list" => Some("LLEN"),
        "set" => Some("SCARD"),
        "zset" => Some("ZCARD"),
        "stream" => Some("XLEN"),
        _ => None,
    }
}

fn value_command(kind: &str, key: &[u8]) -> Option<redis::Cmd> {
    let mut cmd = match kind {
        "string" => redis::cmd("GETRANGE"),
        "hash" => redis::cmd("HSCAN"),
        "list" => redis::cmd("LRANGE"),
        "set" => redis::cmd("SRANDMEMBER"),
        "zset" => redis::cmd("ZRANGE"),
        "stream" => redis::cmd("XRANGE"),
        _ => return None,
    };
    cmd.arg(key);
    match kind {
        "string" => cmd.arg(0).arg(4095),
        "hash" => cmd.arg(0).arg("COUNT").arg(100),
        "list" => cmd.arg(0).arg(99),
        "set" => cmd.arg(100),
        "zset" => cmd.arg(0).arg(99).arg("WITHSCORES"),
        _ => cmd.arg("-").arg("+").arg("COUNT").arg(100),
    };
    Some(cmd)
}

fn describe_row(
    key: &[u8],
    kind: String,
    ttl: i64,
    size: Option<i64>,
    value: Value,
) -> Vec<serde_json::Value> {
    let mut preview_count = match &value {
        Value::BulkString(bytes) => bytes.len(),
        Value::Array(items) | Value::Set(items) => items.len(),
        _ => 0,
    };
    let value = if kind == "hash" {
        let mut result = serde_json::Map::new();
        if let Value::Array(scan) = value {
            if let Some(Value::Array(items)) = scan.into_iter().nth(1) {
                for pair in items.chunks_exact(2).take(100) {
                    let field = value_to_json(pair[0].clone());
                    result.insert(
                        field
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| field.to_string()),
                        value_to_json(pair[1].clone()),
                    );
                }
            }
        }
        preview_count = result.len();
        serde_json::Value::Object(result)
    } else {
        if kind == "zset"
            && matches!(&value, Value::Array(items) if items.first().is_some_and(|item| !matches!(item, Value::Array(_))))
        {
            preview_count /= 2;
        }
        value_to_json(value)
    };
    let truncated = size.is_some_and(|size| size > preview_count as i64);
    vec![
        value_to_json(Value::BulkString(key.to_vec())),
        serde_json::Value::String(kind),
        if ttl < 0 {
            serde_json::Value::Null
        } else {
            ttl.into()
        },
        value,
        size.map(serde_json::Value::from)
            .unwrap_or(serde_json::Value::Null),
        truncated.into(),
    ]
}

fn like_to_glob(pattern: &str) -> String {
    let mut glob = String::new();
    let mut chars = pattern.chars();
    while let Some(ch) = chars.next() {
        match ch {
            '%' => glob.push('*'),
            '_' => glob.push('?'),
            '\\' => {
                if let Some(next) = chars.next() {
                    if matches!(next, '*' | '?' | '[' | ']' | '\\') {
                        glob.push('\\');
                    }
                    glob.push(next);
                }
            }
            '*' | '?' | '[' | ']' => {
                glob.push('\\');
                glob.push(ch);
            }
            _ => glob.push(ch),
        }
    }
    glob
}

impl RedisAdapter {
    pub fn new(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let url = normalize_redis_url(connection_string, database)?;
        Ok(Self {
            url: url.to_string(),
            pool_state,
            key,
        })
    }

    async fn connect(url: &str) -> Result<MultiplexedConnection, String> {
        let client = redis::Client::open(url).map_err(map_err)?;
        let attempt = super::execution::connect(async {
            Ok(client.get_multiplexed_async_connection().await)
        })
        .await?;
        let mut conn = match attempt {
            Ok(conn) => conn,
            Err(error) => return Err(Self::connect_error(url, &client, error).await),
        };
        conn.set_response_timeout(super::execution::query_duration());
        Ok(conn)
    }

    async fn connect_error(url: &str, client: &redis::Client, error: redis::RedisError) -> String {
        use redis::ConnectionAddr;
        let info = client.get_connection_info();
        let (place, tls) = match info.addr() {
            ConnectionAddr::Tcp(host, port) => (format!("{host}:{port}"), false),
            ConnectionAddr::TcpTls { host, port, .. } => (format!("{host}:{port}"), true),
            ConnectionAddr::Unix(path) => (path.display().to_string(), false),
            _ => (String::new(), false),
        };
        if error.is_connection_refusal() {
            return format!("{place} antwortet nicht: Läuft der Server, stimmt der Port?");
        }
        if tls && (error.is_timeout() || error.is_io_error()) {
            return format!(
                "TLS-Verbindung zu {place} fehlgeschlagen: Spricht der Server TLS? Sonst redis:// verwenden."
            );
        }
        if !error
            .detail()
            .is_some_and(|d| d.contains("DB index is out of range"))
        {
            return map_err(error);
        }
        let db = info.redis_settings().db();
        let count = async {
            let mut base = url::Url::parse(url).ok()?;
            if base.scheme().contains("unix") {
                return None;
            }
            base.set_path("/0");
            let mut conn = redis::Client::open(base.as_str())
                .ok()?
                .get_multiplexed_async_connection()
                .await
                .ok()?;
            let values: Vec<String> = redis::cmd("CONFIG")
                .arg("GET")
                .arg("databases")
                .query_async(&mut conn)
                .await
                .ok()?;
            values.get(1)?.parse::<u32>().ok().filter(|n| *n > 0)
        };
        match tokio::time::timeout(std::time::Duration::from_secs(3), count)
            .await
            .ok()
            .flatten()
        {
            Some(count) => format!(
                "Datenbank {db} gibt es nicht. Der Server hat {count} Datenbanken (0–{}).",
                count - 1
            ),
            None => format!("Datenbank {db} gibt es auf dem Server nicht."),
        }
    }

    async fn conn(&self) -> Result<MultiplexedConnection, String> {
        for attempt in 0..2 {
            let shared = self
                .pool_state
                .shared(&self.key, || Self::connect(&self.url))
                .await?;
            let mut conn = (*shared).clone();
            conn.set_response_timeout(super::execution::query_duration());
            match redis::cmd("PING").query_async::<String>(&mut conn).await {
                Ok(_) => return Ok(conn),
                Err(error) if attempt == 0 && error.is_io_error() => {
                    self.pool_state.remove_pool(&self.key).await;
                }
                Err(error) => return Err(map_err(error)),
            }
        }
        Err("Redis-Verbindung konnte nicht wiederhergestellt werden".into())
    }

    async fn sorted_keys(
        &self,
        conn: &mut MultiplexedConnection,
        pattern: &str,
    ) -> Result<Option<Vec<Vec<u8>>>, String> {
        let cache_key = self.cursor_key(pattern);
        if cursor_state(|cache| cache.contains_key(&cache_key)) {
            return Ok(None);
        }
        let total: i64 = redis::cmd("DBSIZE")
            .query_async(conn)
            .await
            .map_err(map_err)?;
        let small = total.max(0) as usize <= SORTED_KEY_LIMIT;
        if !small && pattern == "*" {
            return Ok(None);
        }
        let count = if pattern == "*" {
            SCAN_COUNT
        } else {
            SCAN_COUNT_MAX
        };
        let mut cursor: u64 = 0;
        let mut keys = std::collections::BTreeSet::new();
        for call in 0.. {
            if !small && call == SORTED_SCAN_CALLS {
                return Ok(None);
            }
            let (next, batch): (u64, Vec<Vec<u8>>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(pattern)
                .arg("COUNT")
                .arg(count)
                .query_async(conn)
                .await
                .map_err(map_err)?;
            keys.extend(batch);
            if keys.len() > SORTED_KEY_LIMIT {
                return Ok(None);
            }
            cursor = next;
            if cursor == 0 {
                break;
            }
        }
        Ok(Some(keys.into_iter().collect()))
    }

    fn cursor_key(&self, pattern: &str) -> String {
        format!("{}\n{pattern}", self.url)
    }

    async fn scan_page(
        &self,
        conn: &mut MultiplexedConnection,
        pattern: &str,
        offset: usize,
        limit: usize,
    ) -> Result<(Vec<Vec<u8>>, usize), String> {
        let cache_key = self.cursor_key(pattern);
        let end = offset + limit;
        let (mut position, start) = cursor_state(|cache| {
            cache
                .get(&cache_key)
                .and_then(|state| state.points.range(..=offset).next_back())
                .map(|(position, point)| (*position, *point))
        })
        .unwrap_or((
            0,
            Checkpoint {
                cursor: 0,
                count: 0,
                skip: 0,
            },
        ));
        let Checkpoint {
            mut cursor,
            mut count,
            mut skip,
        } = start;
        if count == 0 {
            count = first_scan_count(pattern, end - position);
        }
        let mut keys = Vec::with_capacity(limit.min(SCAN_COUNT_MAX));
        let mut points = Vec::new();
        let mut calls = 0;
        let mut complete = limit == 0;
        while !complete {
            if calls == MAX_SCAN_CALLS {
                break;
            }
            let (next, batch): (u64, Vec<Vec<u8>>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(pattern)
                .arg("COUNT")
                .arg(count)
                .query_async(conn)
                .await
                .map_err(map_err)?;
            calls += 1;
            let available = batch.len().saturating_sub(skip);
            for (index, key) in batch.into_iter().skip(skip).enumerate() {
                if (offset..end).contains(&(position + index)) {
                    keys.push(key);
                }
            }
            if position + available > end {
                points.push((
                    end,
                    Checkpoint {
                        cursor,
                        count,
                        skip: skip + end - position,
                    },
                ));
                complete = true;
                continue;
            }
            position += available;
            skip = 0;
            cursor = next;
            if cursor == 0 {
                complete = true;
                continue;
            }
            if available < end - position {
                count = (count * 4).min(SCAN_COUNT_MAX);
            }
            points.push((
                position,
                Checkpoint {
                    cursor,
                    count,
                    skip: 0,
                },
            ));
            complete = position == end;
        }
        cursor_state(|cache| {
            if !cache.contains_key(&cache_key) && cache.len() >= CURSOR_PATTERNS {
                cache.clear();
            }
            let state = cache.entry(cache_key).or_default();
            state.points.extend(points);
            while state.points.len() > CURSOR_POINTS {
                state.points.pop_first();
            }
            state.partial = !complete;
        });
        if !complete {
            return Err(format!(
                "Seite nach {MAX_SCAN_CALLS} SCAN-Aufrufen nicht voll: Das Key-Muster passt auf wenige Keys. Erneut versuchen liest weiter, ein Präfix im Muster ist schneller."
            ));
        }
        Ok((keys, calls))
    }

    async fn describe_keys(
        &self,
        conn: &mut MultiplexedConnection,
        keys: Vec<Vec<u8>>,
    ) -> Result<Vec<Vec<serde_json::Value>>, String> {
        if keys.is_empty() {
            return Ok(Vec::new());
        }
        let mut meta = redis::pipe();
        meta.ignore_errors();
        for key in &keys {
            meta.cmd("TYPE").arg(key).cmd("TTL").arg(key);
        }
        let meta: Vec<redis::RedisResult<Value>> = meta.query_async(conn).await.map_err(map_err)?;
        let mut found = Vec::new();
        let mut reads = redis::pipe();
        reads.ignore_errors();
        let mut commands = 0;
        for (key, pair) in keys.into_iter().zip(meta.chunks_exact(2)) {
            let kind = match &pair[0] {
                Ok(Value::SimpleString(kind)) => kind.clone(),
                Ok(Value::BulkString(kind)) => String::from_utf8_lossy(kind).into_owned(),
                Ok(_) => continue,
                Err(error) => return Err(map_err(error.clone())),
            };
            let ttl = match &pair[1] {
                Ok(Value::Int(ttl)) => *ttl,
                _ => -1,
            };
            if kind == "none" || ttl == -2 {
                continue;
            }
            let size = size_command(&kind);
            let value = value_command(&kind, &key);
            if let Some(command) = size {
                reads.cmd(command).arg(&key);
            }
            if let Some(command) = &value {
                reads.add_command(command.clone());
            }
            let first = commands;
            commands += usize::from(size.is_some()) + usize::from(value.is_some());
            found.push((key, kind, ttl, first, size.is_some(), value.is_some()));
        }
        let results: Vec<redis::RedisResult<Value>> = if commands == 0 {
            Vec::new()
        } else {
            reads.query_async(conn).await.map_err(map_err)?
        };
        let mut rows = Vec::with_capacity(found.len());
        for (key, kind, ttl, first, has_size, has_value) in found {
            let mut next = first;
            let mut take = |present: bool| -> Result<Option<Value>, Option<String>> {
                if !present {
                    return Ok(None);
                }
                next += 1;
                match results.get(next - 1) {
                    Some(Ok(value)) => Ok(Some(value.clone())),
                    Some(Err(error)) if error.code() == Some("WRONGTYPE") => Err(None),
                    Some(Err(error)) => Err(Some(map_err(error.clone()))),
                    None => Err(Some("Unvollständige Antwort vom Server".to_string())),
                }
            };
            let size = match take(has_size) {
                Ok(value) => value.and_then(|v| match v {
                    Value::Int(size) => Some(size),
                    _ => None,
                }),
                Err(None) => continue,
                Err(Some(error)) => return Err(error),
            };
            let value = match take(has_value) {
                Ok(value) => value.unwrap_or_else(|| {
                    Value::SimpleString("Datentyp über den Redis-Editor lesen".into())
                }),
                Err(None) => continue,
                Err(Some(error)) => return Err(error),
            };
            rows.push(describe_row(&key, kind, ttl, size, value));
        }
        Ok(rows)
    }

    fn pattern(filter: Option<&str>) -> String {
        let trimmed = filter
            .map(str::trim)
            .filter(|f| !f.is_empty())
            .unwrap_or("*");
        trimmed
            .strip_prefix("key LIKE ")
            .or_else(|| trimmed.strip_prefix("\"key\" LIKE "))
            .map(|p| {
                let p = p.trim();
                let p = p
                    .strip_prefix('\'')
                    .and_then(|p| p.strip_suffix('\''))
                    .unwrap_or(p);
                like_to_glob(&p.replace("''", "'"))
            })
            .unwrap_or_else(|| trimmed.to_string())
    }
}

#[async_trait]
impl DatabaseAdapter for RedisAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        let mut conn = self.conn().await?;
        let pong: String = redis::cmd("PING")
            .query_async(&mut conn)
            .await
            .map_err(map_err)?;
        if pong == "PONG" {
            Ok(())
        } else {
            Err(format!("Unerwartete Antwort: {pong}"))
        }
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let mut conn = self.conn().await?;
        if let Ok(values) = redis::cmd("CONFIG")
            .arg("GET")
            .arg("databases")
            .query_async::<Vec<String>>(&mut conn)
            .await
        {
            if let Some(count) = values.get(1).and_then(|v| v.parse::<u32>().ok()) {
                return Ok((0..count).map(|i| i.to_string()).collect());
            }
        }
        let current = redis::Client::open(self.url.as_str())
            .map_err(map_err)?
            .get_connection_info()
            .redis_settings()
            .db();
        let mut probe = Self::connect(&self.url).await?;
        let mut databases = Vec::new();
        for database in 0..1024 {
            match redis::cmd("SELECT")
                .arg(database)
                .query_async::<()>(&mut probe)
                .await
            {
                Ok(()) => databases.push(database.to_string()),
                Err(error) if error.is_io_error() => return Err(map_err(error)),
                Err(_) => break,
            }
        }
        let current = current.to_string();
        if !databases.contains(&current) {
            databases.push(current);
        }
        Ok(databases)
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(vec!["keys".to_string()])
    }

    async fn list_tables(&self, _schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        Ok(vec![TableInfo {
            schema: "keys".to_string(),
            name: "keys".to_string(),
        }])
    }

    async fn list_columns(
        &self,
        _schema: Option<&str>,
        _table: Option<&str>,
        _table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        Ok(COLUMNS
            .iter()
            .map(|c| ColumnInfo {
                schema: "keys".to_string(),
                table: "keys".to_string(),
                name: c.to_string(),
                data_type: column_type(c).to_string(),
            })
            .collect())
    }

    async fn list_table_columns_detailed(
        &self,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        Ok(COLUMNS
            .iter()
            .enumerate()
            .map(|(i, c)| DetailedColumnInfo {
                name: c.to_string(),
                data_type: column_type(c).to_string(),
                is_nullable: i > 1,
                column_default: None,
                is_primary_key: i == 0,
                ordinal_position: i as i32 + 1,
                character_maximum_length: None,
                comment: Some(column_comment(c).to_string()),
            })
            .collect())
    }

    async fn fetch_rows(
        &self,
        _schema: &str,
        _table: &str,
        filter: Option<&str>,
        limit: i64,
        offset: i64,
        order_by: Option<&str>,
        order_desc: bool,
        _is_view: bool,
        _allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        if order_by.is_some_and(|column| column != "key") {
            return Err("Redis unterstützt in der Key-Übersicht nur Sortierung nach Key".into());
        }
        let mut conn = self.conn().await?;
        let pattern = Self::pattern(filter);
        let (limit, offset) = (limit.max(0) as usize, offset.max(0) as usize);
        if offset == 0 {
            let cache_key = self.cursor_key(&pattern);
            cursor_state(|cache| {
                if cache.get(&cache_key).is_some_and(|state| !state.partial) {
                    cache.remove(&cache_key);
                }
            });
        }
        let keys = match timed(self.sorted_keys(&mut conn, &pattern)).await? {
            Some(mut keys) => {
                if order_desc {
                    keys.reverse();
                }
                keys.into_iter().skip(offset).take(limit).collect()
            }
            None if order_by.is_some() || order_desc => {
                return Err(
                    "Sortieren nach Key geht nur bis 10.000 Keys. Key-Muster einschränken oder unsortiert blättern."
                        .into(),
                )
            }
            None => {
                timed(self.scan_page(&mut conn, &pattern, offset, limit))
                    .await?
                    .0
            }
        };
        let rows = timed(self.describe_keys(&mut conn, keys)).await?;
        let columns: Vec<String> = COLUMNS.iter().map(|c| c.to_string()).collect();
        Ok(TableData {
            rows: rows_to_objects(&columns, rows),
            columns,
        })
    }

    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
    ) -> Result<i64, String> {
        self.count_rows_capped(schema, table, filter, allow_raw_filter, i64::MAX)
            .await
            .map(|count| count.count)
    }

    async fn count_rows_capped(
        &self,
        _schema: &str,
        _table: &str,
        filter: Option<&str>,
        _allow_raw_filter: bool,
        cap: i64,
    ) -> Result<RowCount, String> {
        let mut conn = self.conn().await?;
        let pattern = Self::pattern(filter);
        if pattern == "*" {
            return redis::cmd("DBSIZE")
                .query_async::<i64>(&mut conn)
                .await
                .map(RowCount::exact)
                .map_err(map_err);
        }
        timed(async {
            let mut cursor: u64 = 0;
            let mut count: i64 = 0;
            loop {
                let (next, batch): (u64, Vec<redis::Value>) = redis::cmd("SCAN")
                    .arg(cursor)
                    .arg("MATCH")
                    .arg(&pattern)
                    .arg("COUNT")
                    .arg(SCAN_COUNT_MAX)
                    .query_async(&mut conn)
                    .await
                    .map_err(map_err)?;
                count += batch.len() as i64;
                if count > cap {
                    return Ok(RowCount {
                        count: cap.saturating_add(1),
                        exact: false,
                        estimate: None,
                    });
                }
                cursor = next;
                if cursor == 0 {
                    return Ok(RowCount::exact(count));
                }
            }
        })
        .await
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let lines: Vec<(usize, &str)> = sql
            .lines()
            .enumerate()
            .map(|(index, line)| (index + 1, line.trim()))
            .filter(|(_, line)| !line.is_empty() && !line.starts_with('#'))
            .collect();
        let multi = lines.len() > 1;
        let at = |index: usize, error: String| {
            if multi {
                format!("Zeile {index}: {error}")
            } else {
                error
            }
        };
        let commands = lines
            .into_iter()
            .map(|(index, line)| {
                split_command(line)
                    .map(|args| (index, line, args))
                    .map_err(|e| at(index, e))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut transaction_open = false;
        let mut scans_keys = false;
        for (_, _, args) in &commands {
            let name = args
                .first()
                .and_then(|name| std::str::from_utf8(name).ok())
                .unwrap_or("")
                .to_ascii_uppercase();
            match name.as_str() {
                "SUBSCRIBE" | "PSUBSCRIBE" | "SSUBSCRIBE" | "MONITOR" => return Err("Dauerhafte Subscriptions und MONITOR werden im Redis-Abfrageeditor nicht unterstützt".into()),
                "MULTI" => transaction_open = true,
                "EXEC" | "DISCARD" => transaction_open = false,
                "KEYS" => scans_keys = true,
                _ if blocks_forever(args) => {
                    return Err(format!(
                        "{name} mit Timeout 0 wartet unbegrenzt. Wartezeit angeben, z. B. BLPOP key 5."
                    ))
                }
                _ => (),
            }
        }
        if transaction_open {
            return Err("MULTI benötigt EXEC oder DISCARD in derselben Ausführung".into());
        }
        let single_info = commands.len() == 1
            && commands[0]
                .2
                .first()
                .is_some_and(|name| name.eq_ignore_ascii_case(b"INFO"));
        let mut conn = Self::connect(&self.url).await?;
        if scans_keys {
            let total: i64 = redis::cmd("DBSIZE")
                .query_async(&mut conn)
                .await
                .map_err(map_err)?;
            if total > KEYS_LIMIT {
                return Err(format!(
                    "KEYS blockiert den Server bei {total} Keys. SCAN 0 MATCH <muster> COUNT 1000 verwenden."
                ));
            }
        }
        let start = std::time::Instant::now();
        let mut rows = Vec::new();
        for (index, line, args) in commands {
            let Some((name, rest)) = args.split_first() else {
                continue;
            };
            let name = std::str::from_utf8(name)
                .map_err(|_| "Ungültiger Befehlsname")?
                .to_ascii_uppercase();
            let mut cmd = redis::cmd(&name);
            for arg in rest {
                cmd.arg(arg);
            }
            let value = match timed(async { cmd.query_async(&mut conn).await.map_err(map_err) })
                .await
            {
                Ok(value) => value_to_json(value),
                Err(error) if name == "SHUTDOWN" && error.contains("getrennt") => {
                    "Server beendet".into()
                }
                Err(mut error) => {
                    if BLOCKING.contains(&name.as_str())
                        && (error.contains("Zeitlimit") || error.contains("Timeout"))
                    {
                        error = format!(
                            "{error}: {name} wartet, bis Daten ankommen. Wartezeit im Befehl begrenzen, z. B. BLPOP key 5."
                        );
                    }
                    if error.contains("Unbekannter Befehl") && is_dragonfly(&mut conn).await {
                        error.push_str(", Dragonfly unterstützt ihn nicht");
                    }
                    if !rows.is_empty() {
                        if !error.ends_with('.') {
                            error.push('.');
                        }
                        error.push_str(" Vorherige Befehle wurden bereits ausgeführt.");
                    }
                    return Err(at(index, error));
                }
            };
            rows.push(vec![serde_json::Value::String(line.to_string()), value]);
        }
        if let Some(text) = rows
            .first()
            .and_then(|row| row[1].as_str())
            .filter(|_| single_info)
        {
            let columns = vec![
                "section".to_string(),
                "field".to_string(),
                "value".to_string(),
            ];
            let info = info_rows(text);
            return Ok(QueryResult {
                rows: rows_to_objects(&columns, info),
                columns,
                rows_affected: None,
                execution_time_ms: start.elapsed().as_millis() as u64,
                truncated: false,
            });
        }
        let columns = vec!["command".to_string(), "result".to_string()];
        Ok(QueryResult {
            rows: rows_to_objects(&columns, rows),
            columns,
            rows_affected: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            truncated: false,
        })
    }

    async fn truncate_table(&self, _schema: &str, _table: &str) -> Result<(), String> {
        let mut conn = self.conn().await?;
        redis::cmd("FLUSHDB")
            .query_async::<()>(&mut conn)
            .await
            .map_err(map_err)
    }

    async fn drop_table(&self, _schema: &str, _table: &str) -> Result<(), String> {
        Err(unsupported("DROP (nutze FLUSHDB über Leeren)"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_commands_are_named() {
        assert_eq!(unknown_command("FOOBAR x").as_deref(), Some("FOOBAR"));
        assert_eq!(unknown_command("nosuch").as_deref(), Some("NOSUCH"));
        assert_eq!(unknown_command("set a 1"), None);
        assert_eq!(unknown_command("FLUSHALL"), None);
        assert_eq!(unknown_command("json.set k $ 1"), None);
    }

    #[test]
    fn like_filters_become_globs() {
        assert_eq!(
            RedisAdapter::pattern(Some("key LIKE 'db1_key:0000%'")),
            "db1?key:0000*"
        );
        assert_eq!(RedisAdapter::pattern(Some("key LIKE 'a*b'")), "a\\*b");
        assert_eq!(
            RedisAdapter::pattern(Some("key LIKE 'it''s\\_x'")),
            "it's_x"
        );
        assert_eq!(RedisAdapter::pattern(Some("user:*")), "user:*");
    }

    #[test]
    fn server_errors_are_german_without_product_prefix() {
        assert_eq!(
            server_detail(
                "ERR",
                "unknown command 'foobar', with args beginning with: 'x' "
            ),
            "Unbekannter Befehl FOOBAR"
        );
        assert_eq!(
            server_detail("ERR", "unknown command `OBJECT`"),
            "Unbekannter Befehl OBJECT"
        );
        assert_eq!(
            server_detail("ERR", "wrong number of arguments for 'get' command"),
            "Falsche Anzahl Argumente für GET"
        );
        assert_eq!(
            server_detail("ERR", "something else"),
            "ERR: something else"
        );
        let error = redis::RedisError::from((
            redis::ErrorKind::AuthenticationFailed,
            "Password authentication failed",
        ));
        assert!(map_err(error).starts_with("Anmeldung fehlgeschlagen"));
    }

    #[test]
    fn control_characters_render_as_hex() {
        assert_eq!(
            value_to_json(Value::BulkString(vec![1, 0, 8])),
            serde_json::json!("\\x010008")
        );
        assert_eq!(
            value_to_json(Value::BulkString(b"a\nb\tc".to_vec())),
            serde_json::json!("a\nb\tc")
        );
    }

    #[test]
    fn rejects_only_unbounded_blocking_commands() {
        let args = |line: &str| split_command(line).unwrap();
        assert!(blocks_forever(&args("BLPOP q 0")));
        assert!(blocks_forever(&args("brpop a b 0.0")));
        assert!(blocks_forever(&args("XREAD COUNT 1 BLOCK 0 STREAMS s $")));
        assert!(blocks_forever(&args("BLMPOP 0 1 q LEFT")));
        assert!(blocks_forever(&args("WAIT 1 0")));
        assert!(!blocks_forever(&args("BLPOP q 5")));
        assert!(!blocks_forever(&args("XREAD STREAMS s 0")));
        assert!(!blocks_forever(&args("GET 0")));
        let rows =
            info_rows("# Server\r\nredis_version:7.4\r\n\r\n# Clients\r\nconnected_clients:2\r\n");
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows[1],
            vec![
                serde_json::json!("Clients"),
                "connected_clients".into(),
                "2".into()
            ]
        );
    }

    #[test]
    fn scan_counts_stay_bounded() {
        assert_eq!(first_scan_count("*", 1), SCAN_COUNT);
        assert_eq!(first_scan_count("*", 5_000), 5_000);
        assert_eq!(first_scan_count("*", 1_000_000), SCAN_COUNT_MAX);
        assert_eq!(first_scan_count("user:*", 1_000_000), SCAN_COUNT);
        let row = describe_row(
            b"z",
            "zset".into(),
            -1,
            Some(3),
            Value::Array(vec![
                Value::BulkString(b"a".to_vec()),
                Value::BulkString(b"1".to_vec()),
            ]),
        );
        assert_eq!(row[2], serde_json::Value::Null);
        assert_eq!(row[5], serde_json::json!(true));
    }

    #[test]
    fn splits_commands_with_quotes() {
        assert_eq!(
            split_command(r#"SET user:1 "Max Muster" EX 10"#).unwrap(),
            ["SET", "user:1", "Max Muster", "EX", "10"].map(|v| v.as_bytes().to_vec())
        );
        assert_eq!(
            split_command("HGETALL   'a b'").unwrap(),
            [b"HGETALL".to_vec(), b"a b".to_vec()]
        );
        assert_eq!(
            RedisAdapter::pattern(Some("\"key\" LIKE 'user:%'")),
            "user:*"
        );
        assert_eq!(RedisAdapter::pattern(None), "*");
    }

    #[test]
    fn selects_database_via_path() {
        let a = RedisAdapter::new(
            "redis://:pw@localhost:6379/0",
            Some("3"),
            crate::db::pool::create_pool_state(),
            "k".into(),
        )
        .unwrap();
        assert!(a.url.ends_with("/3"));
        assert!(RedisAdapter::new(
            "redis://localhost",
            Some("x"),
            crate::db::pool::create_pool_state(),
            "k".into()
        )
        .is_err());
    }
}

#[cfg(test)]
#[path = "redis_integration_tests.rs"]
mod integration_tests;

#[cfg(test)]
#[path = "redis_browser_tests.rs"]
mod browser_tests;
