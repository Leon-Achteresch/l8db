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

const COLUMNS: [&str; 4] = ["key", "type", "ttl", "value"];

fn map_err(e: redis::RedisError) -> String {
    format!("Redis: {e}")
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
            .unwrap_or(serde_json::Value::Null),
        Value::Boolean(b) => serde_json::Value::Bool(b),
        Value::VerbatimString { text, .. } => serde_json::Value::String(text),
        Value::BigNumber(n) => serde_json::Value::String(n.to_string()),
        Value::Attribute { data, .. } => value_to_json(*data),
        Value::ServerError(e) => serde_json::Value::String(format!("ERR {e:?}")),
        other => serde_json::Value::String(format!("{other:?}")),
    }
}

pub fn split_command(line: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = line.chars().peekable();
    let mut has_token = false;
    while let Some(ch) = chars.next() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some('"') if ch == '\\' => {
                if let Some(next) = chars.next() {
                    current.push(match next {
                        'n' => '\n',
                        't' => '\t',
                        other => other,
                    });
                }
            }
            Some(_) => current.push(ch),
            None if ch == '"' || ch == '\'' => {
                quote = Some(ch);
                has_token = true;
            }
            None if ch.is_whitespace() => {
                if has_token {
                    args.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            None => {
                current.push(ch);
                has_token = true;
            }
        }
    }
    if has_token {
        args.push(current);
    }
    args
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
            url.set_path(&format!("/{db}"));
        }
        Ok(Self {
            url: url.to_string(),
            pool_state,
            key,
        })
    }

    async fn conn(&self) -> Result<MultiplexedConnection, String> {
        let url = self.url.clone();
        let shared = self
            .pool_state
            .shared(&self.key, || async move {
                let client = redis::Client::open(url.as_str()).map_err(map_err)?;
                timed(async {
                    client
                        .get_multiplexed_async_connection()
                        .await
                        .map_err(map_err)
                })
                .await
            })
            .await?;
        Ok((*shared).clone())
    }

    async fn scan(
        &self,
        conn: &mut MultiplexedConnection,
        pattern: &str,
        max: usize,
    ) -> Result<Vec<String>, String> {
        let mut cursor: u64 = 0;
        let mut keys = Vec::new();
        loop {
            let (next, batch): (u64, Vec<String>) = redis::cmd("SCAN")
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
            if cursor == 0 || keys.len() >= max {
                break;
            }
        }
        keys.sort();
        Ok(keys)
    }

    async fn describe(
        &self,
        conn: &mut MultiplexedConnection,
        key: &str,
    ) -> Result<Vec<serde_json::Value>, String> {
        let kind: String = redis::cmd("TYPE")
            .arg(key)
            .query_async(conn)
            .await
            .map_err(map_err)?;
        let ttl: i64 = conn.ttl(key).await.map_err(map_err)?;
        let value: Value = match kind.as_str() {
            "string" => redis::cmd("GET").arg(key).query_async(conn).await,
            "hash" => redis::cmd("HGETALL").arg(key).query_async(conn).await,
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
            "stream" => redis::cmd("XLEN").arg(key).query_async(conn).await,
            _ => Ok(Value::Nil),
        }
        .map_err(map_err)?;
        Ok(vec![
            serde_json::Value::String(key.to_string()),
            serde_json::Value::String(kind),
            if ttl < 0 {
                serde_json::Value::Null
            } else {
                serde_json::Value::from(ttl)
            },
            value_to_json(value),
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
        let count = match redis::cmd("CONFIG")
            .arg("GET")
            .arg("databases")
            .query_async::<Vec<String>>(&mut conn)
            .await
        {
            Ok(values) => values
                .get(1)
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(16),
            Err(_) => 16,
        };
        Ok((0..count).map(|i| i.to_string()).collect())
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
                data_type: if *c == "ttl" { "integer" } else { "text" }.to_string(),
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
                data_type: if *c == "ttl" { "integer" } else { "text" }.to_string(),
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
        _order_by: Option<&str>,
        order_desc: bool,
        _is_view: bool,
        _allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let mut conn = self.conn().await?;
        let pattern = Self::pattern(filter);
        let (limit, offset) = (limit.max(0) as usize, offset.max(0) as usize);
        let mut keys = self.scan(&mut conn, &pattern, offset + limit).await?;
        if order_desc {
            keys.reverse();
        }
        let mut rows = Vec::new();
        for key in keys.into_iter().skip(offset).take(limit) {
            rows.push(self.describe(&mut conn, &key).await?);
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
        Ok(self.scan(&mut conn, &pattern, 100_000).await?.len() as i64)
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let mut conn = self.conn().await?;
        let start = std::time::Instant::now();
        let mut rows = Vec::new();
        for line in sql
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
        {
            let args = split_command(line);
            let Some((name, rest)) = args.split_first() else {
                continue;
            };
            let mut cmd = redis::cmd(name);
            for arg in rest {
                cmd.arg(arg);
            }
            let value: Value =
                timed(async { cmd.query_async(&mut conn).await.map_err(map_err) }).await?;
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
            split_command(r#"SET user:1 "Max Muster" EX 10"#),
            vec!["SET", "user:1", "Max Muster", "EX", "10"]
        );
        assert_eq!(split_command("HGETALL   'a b'"), vec!["HGETALL", "a b"]);
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
