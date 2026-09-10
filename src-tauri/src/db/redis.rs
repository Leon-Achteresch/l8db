use async_trait::async_trait;
use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, Value};

use super::pool::PoolState;
use super::{
    rows_to_objects, timed, unsupported, ColumnInfo, DatabaseAdapter, DetailedColumnInfo,
    QueryResult, TableData, TableInfo,
};

pub struct RedisAdapter {
    url: String,
    pool_state: PoolState,
    key: String,
}

const COLUMNS: [&str; 6] = ["key", "type", "ttl", "value", "size", "truncated"];

fn column_type(column: &str) -> &str {
    match column {
        "ttl" | "size" => "integer",
        "truncated" => "boolean",
        "value" => "json",
        _ => "text",
    }
}

fn map_err(e: redis::RedisError) -> String {
    match e.code() {
        Some(code) => format!(
            "Redis {code}: {}",
            e.detail().unwrap_or_else(|| e.category())
        ),
        None => format!("Redis: {e}"),
    }
}

fn value_to_json(value: Value) -> serde_json::Value {
    match value {
        Value::Nil => serde_json::Value::Null,
        Value::Int(i) => serde_json::Value::from(i),
        Value::BulkString(bytes) => match String::from_utf8(bytes) {
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

impl RedisAdapter {
    pub fn new(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let mut url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige Redis-URL".to_string())?;
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
        Ok(Self {
            url: url.to_string(),
            pool_state,
            key,
        })
    }

    async fn connect(url: &str) -> Result<MultiplexedConnection, String> {
        let client = redis::Client::open(url).map_err(map_err)?;
        let mut conn = timed(async {
            client
                .get_multiplexed_async_connection()
                .await
                .map_err(map_err)
        })
        .await?;
        conn.set_response_timeout(std::time::Duration::from_secs(30));
        Ok(conn)
    }

    async fn conn(&self) -> Result<MultiplexedConnection, String> {
        for attempt in 0..2 {
            let shared = self
                .pool_state
                .shared(&self.key, || Self::connect(&self.url))
                .await?;
            let mut conn = (*shared).clone();
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

    async fn scan(
        &self,
        conn: &mut MultiplexedConnection,
        pattern: &str,
    ) -> Result<Vec<Vec<u8>>, String> {
        let mut cursor: u64 = 0;
        let mut keys = std::collections::BTreeSet::new();
        loop {
            let (next, batch): (u64, Vec<Vec<u8>>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(pattern)
                .arg("COUNT")
                .arg(1000)
                .query_async(conn)
                .await
                .map_err(map_err)?;
            keys.extend(batch);
            cursor = next;
            if keys.len() > 100_000 {
                return Err("Mehr als 100.000 Keys: Bitte das Key-Pattern einschränken".into());
            }
            if cursor == 0 {
                break;
            }
        }
        Ok(keys.into_iter().collect())
    }

    async fn describe(
        &self,
        conn: &mut MultiplexedConnection,
        key: &[u8],
    ) -> Result<Vec<serde_json::Value>, String> {
        let kind: String = redis::cmd("TYPE")
            .arg(key)
            .query_async(conn)
            .await
            .map_err(map_err)?;
        let ttl: i64 = conn.ttl(key).await.map_err(map_err)?;
        if kind == "none" || ttl == -2 {
            return Ok(vec![
                value_to_json(Value::BulkString(key.to_vec())),
                "none".into(),
            ]);
        }
        let size_command = match kind.as_str() {
            "string" => Some("STRLEN"),
            "hash" => Some("HLEN"),
            "list" => Some("LLEN"),
            "set" => Some("SCARD"),
            "zset" => Some("ZCARD"),
            "stream" => Some("XLEN"),
            _ => None,
        };
        let size: Option<i64> = match size_command {
            Some(command) => Some(
                redis::cmd(command)
                    .arg(key)
                    .query_async(conn)
                    .await
                    .map_err(map_err)?,
            ),
            None => None,
        };
        let value: Value = match kind.as_str() {
            "string" => {
                redis::cmd("GETRANGE")
                    .arg(key)
                    .arg(0)
                    .arg(4095)
                    .query_async(conn)
                    .await
            }
            "hash" => {
                redis::cmd("HSCAN")
                    .arg(key)
                    .arg(0)
                    .arg("COUNT")
                    .arg(100)
                    .query_async(conn)
                    .await
            }
            "list" => {
                redis::cmd("LRANGE")
                    .arg(key)
                    .arg(0)
                    .arg(99)
                    .query_async(conn)
                    .await
            }
            "set" => {
                redis::cmd("SRANDMEMBER")
                    .arg(key)
                    .arg(100)
                    .query_async(conn)
                    .await
            }
            "zset" => {
                redis::cmd("ZRANGE")
                    .arg(key)
                    .arg(0)
                    .arg(99)
                    .arg("WITHSCORES")
                    .query_async(conn)
                    .await
            }
            "stream" => {
                redis::cmd("XRANGE")
                    .arg(key)
                    .arg("-")
                    .arg("+")
                    .arg("COUNT")
                    .arg(100)
                    .query_async(conn)
                    .await
            }
            _ => Ok(Value::SimpleString(
                "Datentyp über den Redis-Editor lesen".into(),
            )),
        }
        .map_err(map_err)?;
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
        Ok(vec![
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
        ])
    }

    fn pattern(filter: Option<&str>) -> String {
        let trimmed = filter
            .map(str::trim)
            .filter(|f| !f.is_empty())
            .unwrap_or("*");
        trimmed
            .strip_prefix("key LIKE ")
            .or_else(|| trimmed.strip_prefix("\"key\" LIKE "))
            .map(|p| p.trim_matches('\'').replace('%', "*"))
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
        let mut keys = timed(self.scan(&mut conn, &pattern)).await?;
        if order_desc {
            keys.reverse();
        }
        let mut rows = Vec::new();
        for key in keys.into_iter().skip(offset).take(limit) {
            let row = match timed(self.describe(&mut conn, &key)).await {
                Ok(row) => row,
                Err(error) if error.contains("WRONGTYPE") => continue,
                Err(error) => return Err(error),
            };
            if row[1] != "none" {
                rows.push(row);
            }
        }
        let columns: Vec<String> = COLUMNS.iter().map(|c| c.to_string()).collect();
        Ok(TableData {
            rows: rows_to_objects(&columns, rows),
            columns,
        })
    }

    async fn count_rows(
        &self,
        _schema: &str,
        _table: &str,
        filter: Option<&str>,
        _allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let mut conn = self.conn().await?;
        let pattern = Self::pattern(filter);
        if pattern == "*" {
            return redis::cmd("DBSIZE")
                .query_async::<i64>(&mut conn)
                .await
                .map_err(map_err);
        }
        Ok(timed(self.scan(&mut conn, &pattern)).await?.len() as i64)
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let commands = sql
            .lines()
            .enumerate()
            .map(|(index, line)| (index + 1, line.trim()))
            .filter(|(_, line)| !line.is_empty() && !line.starts_with('#'))
            .map(|(index, line)| {
                split_command(line)
                    .map(|args| (index, line, args))
                    .map_err(|e| format!("Redis Zeile {index}: {e}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut transaction_open = false;
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
                _ => (),
            }
        }
        if transaction_open {
            return Err("MULTI benötigt EXEC oder DISCARD in derselben Ausführung".into());
        }
        let mut conn = Self::connect(&self.url).await?;
        let start = std::time::Instant::now();
        let mut rows = Vec::new();
        for (index, line, args) in commands {
            let Some((name, rest)) = args.split_first() else {
                continue;
            };
            let name = std::str::from_utf8(name).map_err(|_| "Ungültiger Befehlsname")?;
            let mut cmd = redis::cmd(&name.to_ascii_uppercase());
            for arg in rest {
                cmd.arg(arg);
            }
            let value: Value = timed(async { cmd.query_async(&mut conn).await.map_err(map_err) })
                .await.map_err(|e| format!("Redis Zeile {index}: {e}. Vorherige Befehle können bereits ausgeführt sein."))?;
            rows.push(vec![
                serde_json::Value::String(line.to_string()),
                value_to_json(value),
            ]);
        }
        let columns = vec!["command".to_string(), "result".to_string()];
        Ok(QueryResult {
            rows: rows_to_objects(&columns, rows),
            columns,
            rows_affected: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
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
