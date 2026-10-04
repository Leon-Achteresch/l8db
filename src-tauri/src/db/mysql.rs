use async_trait::async_trait;
use mysql_async::consts::{ColumnFlags, ColumnType};
use mysql_async::prelude::*;
use mysql_async::{Column, Conn, Opts, OptsBuilder, Pool, Row, SslOpts, Value};

use super::pool::PoolState;
use super::{
    attach_row_keys, create_table_ddl, hex_blob, rows_to_objects, timed, where_clause,
    AddColumnRequest, AlterColumnRequest, ColumnInfo, ConstraintInfo, CreateTableRequest,
    DatabaseAdapter, DatabaseOverview, DetailedColumnInfo, ForeignKeyInfo, FunctionInfo, IndexInfo,
    QueryResult, SchemaSize, SessionInfo, SslMode, TableData, TableInfo, TriggerInfo, TxSession,
};

const NO_SERVER_TLS: &str =
    "Der MySQL-Server unterstützt kein TLS. SSL-Modus „Bevorzugen“ oder „Deaktiviert“ wählen.";

pub struct MysqlAdapter {
    opts: Opts,
    plain: Option<Opts>,
    pool_state: PoolState,
    key: String,
}

pub fn quote(ident: &str) -> String {
    format!("`{}`", ident.replace('`', "``"))
}

pub fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
}

struct ColumnDefinition {
    data_type: String,
    nullable: bool,
    default: Option<String>,
    extra: String,
    charset: Option<String>,
    collation: Option<String>,
    table_collation: Option<String>,
    comment: String,
    generation: Option<String>,
    check: Option<String>,
    mariadb: bool,
    legacy_mysql: bool,
}

const MULTI_STATEMENT_EXPLAIN: &str =
    "EXPLAIN unterstützt nur eine einzelne Anweisung. Bitte die gewünschte Anweisung markieren.";

fn has_flag(extra: &str, flag: &str) -> bool {
    extra
        .split_whitespace()
        .any(|token| token.eq_ignore_ascii_case(flag))
}

fn on_update_clause(extra: &str) -> Option<String> {
    let tokens: Vec<&str> = extra.split_whitespace().collect();
    tokens.windows(3).find_map(|w| {
        (w[0].eq_ignore_ascii_case("on") && w[1].eq_ignore_ascii_case("update"))
            .then(|| w[2].to_string())
    })
}

fn unescape_info_expr(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        match (c, chars.clone().next()) {
            ('\\', Some(next @ ('\'' | '\\'))) => {
                out.push(next);
                chars.next();
            }
            _ => out.push(c),
        }
    }
    out
}

fn is_legacy_mysql(version: &str) -> bool {
    version
        .split('.')
        .next()
        .and_then(|major| major.trim().parse::<u32>().ok())
        .is_some_and(|major| major < 8)
}

fn type_base(data_type: &str) -> String {
    data_type
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn is_character_type(data_type: &str) -> bool {
    let lower = data_type.to_ascii_lowercase();
    matches!(
        type_base(data_type).as_str(),
        "char" | "varchar" | "tinytext" | "text" | "mediumtext" | "longtext" | "enum" | "set"
    ) && !lower.contains("character set")
        && !lower.contains("charset")
        && !lower.contains("collate")
}

fn existing_default_sql(def: &ColumnDefinition) -> Option<String> {
    let value = def.default.as_deref()?;
    if def.mariadb {
        return Some(value.to_string());
    }
    let base = type_base(&def.data_type);
    let current_timestamp = matches!(base.as_str(), "timestamp" | "datetime")
        && value
            .trim()
            .to_ascii_uppercase()
            .starts_with("CURRENT_TIMESTAMP");
    Some(if current_timestamp {
        value.trim().to_string()
    } else if has_flag(&def.extra, "DEFAULT_GENERATED") {
        format!("({})", unescape_info_expr(value))
    } else if base == "bit"
        || (!def.legacy_mysql && matches!(base.as_str(), "binary" | "varbinary"))
    {
        value.to_string()
    } else {
        lit(value)
    })
}

fn change_column_sql(
    schema: &str,
    table: &str,
    current: &ColumnDefinition,
    changes: &AlterColumnRequest,
) -> String {
    let name = changes
        .new_name
        .as_deref()
        .filter(|n| !n.is_empty())
        .unwrap_or(&changes.old_name);
    let data_type = changes
        .data_type
        .as_deref()
        .filter(|t| !t.is_empty())
        .unwrap_or(&current.data_type);
    let generation = current
        .generation
        .as_deref()
        .filter(|g| !g.trim().is_empty() && has_flag(&current.extra, "GENERATED"));
    let mut sql = format!(
        "ALTER TABLE {}.{} CHANGE COLUMN {} {} {}",
        quote(schema),
        quote(table),
        quote(&changes.old_name),
        quote(name),
        data_type
    );
    if is_character_type(data_type) && current.collation != current.table_collation {
        if let Some(charset) = current.charset.as_deref().filter(|c| !c.is_empty()) {
            sql.push_str(&format!(" CHARACTER SET {charset}"));
            if let Some(collation) = current.collation.as_deref().filter(|c| !c.is_empty()) {
                sql.push_str(&format!(" COLLATE {collation}"));
            }
        }
    }
    if let Some(expr) = generation {
        let expr = if current.mariadb || current.legacy_mysql {
            expr.to_string()
        } else {
            unescape_info_expr(expr)
        };
        let kind = if has_flag(&current.extra, "STORED") || has_flag(&current.extra, "PERSISTENT") {
            "STORED"
        } else {
            "VIRTUAL"
        };
        sql.push_str(&format!(" GENERATED ALWAYS AS ({expr}) {kind}"));
    }
    if changes.set_not_null.is_some() || !(current.mariadb && generation.is_some()) {
        if changes.set_not_null.unwrap_or(!current.nullable) {
            sql.push_str(" NOT NULL");
        } else {
            sql.push_str(" NULL");
        }
    }
    let default = if changes.drop_default {
        None
    } else {
        changes
            .new_default
            .as_deref()
            .filter(|d| !d.is_empty())
            .map(str::to_string)
            .or_else(|| {
                generation
                    .is_none()
                    .then(|| existing_default_sql(current))
                    .flatten()
            })
    };
    if let Some(d) = default {
        sql.push_str(&format!(" DEFAULT {d}"));
    }
    if let Some(on_update) = on_update_clause(&current.extra) {
        sql.push_str(&format!(" ON UPDATE {on_update}"));
    }
    if has_flag(&current.extra, "auto_increment") {
        sql.push_str(" AUTO_INCREMENT");
    }
    if has_flag(&current.extra, "INVISIBLE") {
        sql.push_str(" INVISIBLE");
    }
    if !current.comment.is_empty() {
        sql.push_str(&format!(" COMMENT {}", lit(&current.comment)));
    }
    if let Some(check) = current.check.as_deref().filter(|c| !c.trim().is_empty()) {
        sql.push_str(&format!(
            " CHECK ({})",
            check.replace(&quote(&changes.old_name), &quote(name))
        ));
    }
    sql
}

fn map_err(e: mysql_async::Error) -> String {
    match e {
        mysql_async::Error::Server(err) => format!("MySQL {}: {}", err.code, err.message),
        other => format!("MySQL: {other}"),
    }
}

fn is_numeric(column: &Column) -> bool {
    matches!(
        column.column_type(),
        ColumnType::MYSQL_TYPE_TINY
            | ColumnType::MYSQL_TYPE_SHORT
            | ColumnType::MYSQL_TYPE_LONG
            | ColumnType::MYSQL_TYPE_LONGLONG
            | ColumnType::MYSQL_TYPE_INT24
            | ColumnType::MYSQL_TYPE_YEAR
            | ColumnType::MYSQL_TYPE_FLOAT
            | ColumnType::MYSQL_TYPE_DOUBLE
            | ColumnType::MYSQL_TYPE_DECIMAL
            | ColumnType::MYSQL_TYPE_NEWDECIMAL
    )
}

fn is_binary(column: &Column) -> bool {
    column.character_set() == 63
        && column.flags().contains(ColumnFlags::BINARY_FLAG)
        && matches!(
            column.column_type(),
            ColumnType::MYSQL_TYPE_BLOB
                | ColumnType::MYSQL_TYPE_TINY_BLOB
                | ColumnType::MYSQL_TYPE_MEDIUM_BLOB
                | ColumnType::MYSQL_TYPE_LONG_BLOB
                | ColumnType::MYSQL_TYPE_VAR_STRING
                | ColumnType::MYSQL_TYPE_STRING
                | ColumnType::MYSQL_TYPE_GEOMETRY
        )
}

fn value_to_json(value: Value, column: &Column) -> serde_json::Value {
    match value {
        Value::NULL => serde_json::Value::Null,
        Value::Bytes(bytes) => {
            if column.column_type() == ColumnType::MYSQL_TYPE_BIT && bytes.len() <= 8 {
                return super::exact_number::uint(
                    bytes.iter().fold(0u64, |acc, b| (acc << 8) | u64::from(*b)),
                );
            }
            if is_binary(column) {
                return serde_json::Value::String(hex_blob(&bytes));
            }
            let text = String::from_utf8_lossy(&bytes).into_owned();
            if is_numeric(column) {
                if matches!(
                    column.column_type(),
                    ColumnType::MYSQL_TYPE_FLOAT | ColumnType::MYSQL_TYPE_DOUBLE
                ) {
                    if let Some(n) = text
                        .parse::<f64>()
                        .ok()
                        .and_then(serde_json::Number::from_f64)
                    {
                        return serde_json::Value::Number(n);
                    }
                } else {
                    return super::exact_number::decimal(&text);
                }
            }
            if column.column_type() == ColumnType::MYSQL_TYPE_JSON {
                return super::exact_number::json_document(&text);
            }
            serde_json::Value::String(text)
        }
        Value::Int(i) => super::exact_number::int(i),
        Value::UInt(u) => super::exact_number::uint(u),
        Value::Float(f) => serde_json::Number::from_f64(f as f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Double(d) => serde_json::Number::from_f64(d)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Date(y, m, d, h, i, s, us) => serde_json::Value::String(
            if h == 0
                && i == 0
                && s == 0
                && us == 0
                && column.column_type() == ColumnType::MYSQL_TYPE_DATE
            {
                format!("{y:04}-{m:02}-{d:02}")
            } else {
                format!(
                    "{y:04}-{m:02}-{d:02} {h:02}:{i:02}:{s:02}{}",
                    if us > 0 {
                        format!(".{us:06}")
                    } else {
                        String::new()
                    }
                )
            },
        ),
        Value::Time(neg, d, h, i, s, us) => serde_json::Value::String(format!(
            "{}{:02}:{i:02}:{s:02}{}",
            if neg { "-" } else { "" },
            u32::from(h) + d * 24,
            if us > 0 {
                format!(".{us:06}")
            } else {
                String::new()
            }
        )),
    }
}

fn cell(row: &Row, index: usize) -> String {
    match row.as_ref(index) {
        Some(Value::Bytes(b)) => String::from_utf8_lossy(b).into_owned(),
        Some(Value::NULL) | None => String::new(),
        Some(Value::Int(i)) => i.to_string(),
        Some(Value::UInt(u)) => u.to_string(),
        Some(other) => format!("{other:?}"),
    }
}

fn cell_opt(row: &Row, index: usize) -> Option<String> {
    match row.as_ref(index) {
        Some(Value::NULL) | None => None,
        _ => Some(cell(row, index)),
    }
}

fn cell_i64(row: &Row, index: usize) -> i64 {
    cell(row, index).parse().unwrap_or(0)
}

fn session_pid(id: i64) -> i32 {
    i32::try_from(id).unwrap_or(-1)
}

fn kill_statement(scope: &str, pid: i32) -> Result<String, String> {
    if pid <= 0 {
        return Err("Diese Sitzungs-ID kann nicht sicher übernommen werden. Bitte direkt mit KILL auf dem Server beenden.".into());
    }
    Ok(format!("KILL {scope} {pid}"))
}

impl MysqlAdapter {
    pub fn new(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let resolved = super::cloud_auth::resolve(connection_string.trim())?;
        let mut url =
            url::Url::parse(&resolved).map_err(|_| "Ungültige MySQL-URL".to_string())?;
        let token_auth = super::cloud_auth::has_marker(&url);
        if !matches!(url.scheme(), "mysql" | "mariadb") {
            return Err("Eine mysql:// URL ist erforderlich".to_string());
        }
        let mut ssl = SslMode::Prefer;
        let mut root_cert = None;
        let mut identity = None;
        let mut identity_password = None;
        let pairs: Vec<(String, String)> = url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        let mut kept = Vec::new();
        for (k, v) in pairs {
            let flag = matches!(v.to_ascii_lowercase().as_str(), "true" | "1" | "yes");
            match k.as_str() {
                "sslmode" => {
                    ssl = serde_json::from_value(serde_json::Value::String(v))
                        .map_err(|_| "Ungültiger SSL-Modus".to_string())?;
                }
                "ssl-mode" | "ssl_mode" | "sslMode" => {
                    ssl = match v.to_lowercase().as_str() {
                        "disabled" => SslMode::Disable,
                        "preferred" => SslMode::Prefer,
                        "required" => SslMode::Require,
                        "verify_ca" => SslMode::VerifyCa,
                        "verify_identity" => SslMode::VerifyFull,
                        _ => return Err("Ungültiger SSL-Modus".to_string()),
                    };
                }
                "useSSL" | "useSsl" | "ssl" if !flag => ssl = SslMode::Disable,
                "requireSSL" | "require_ssl" if flag => ssl = ssl.max(SslMode::Require),
                "verifyServerCertificate" | "verify_ca" if flag => ssl = ssl.max(SslMode::VerifyCa),
                "verify_identity" if flag => ssl = SslMode::VerifyFull,
                "sslrootcert" | "ssl-ca" | "ssl_ca" | "sslca" => {
                    root_cert = Some(v).filter(|v| !v.is_empty())
                }
                "sslcert" | "ssl-cert" | "ssl_cert" | "clientCertificateKeyStoreUrl" => {
                    identity =
                        Some(v.trim_start_matches("file:").to_string()).filter(|v| !v.is_empty())
                }
                "sslpassword" | "ssl-password" | "clientCertificateKeyStorePassword" => {
                    identity_password = Some(v)
                }
                "abs_conn_ttl"
                | "abs_conn_ttl_jitter"
                | "client_found_rows"
                | "compression"
                | "enable_cleartext_plugin"
                | "max_allowed_packet"
                | "prefer_socket"
                | "reset_connection"
                | "secure_auth"
                | "socket"
                | "stmt_cache_size"
                | "tcp_keepalive"
                | "tcp_nodelay"
                | "wait_timeout"
                | "pool_min"
                | "pool_max"
                | "inactive_connection_ttl"
                | "ttl_check_interval"
                | "conn_ttl" => kept.push((k, v)),
                _ => {}
            }
        }
        if token_auth {
            ssl = ssl.max(SslMode::Require);
        }
        url.set_scheme("mysql").ok();
        url.query_pairs_mut()
            .clear()
            .extend_pairs(kept.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        if url.query().is_some_and(str::is_empty) {
            url.set_query(None);
        }
        let opts = Opts::from_url(url.as_str()).map_err(|e| format!("Ungültige MySQL-URL: {e}"))?;
        let mut builder = OptsBuilder::from_opts(opts)
            .tcp_nodelay(true)
            .client_found_rows(true)
            .conn_ttl(Some(std::time::Duration::from_secs(60)));
        if let Some(db) = database.filter(|d| !d.is_empty()) {
            builder = builder.db_name(Some(db));
        }
        let plain: Opts = builder.clone().ssl_opts(None::<SslOpts>).into();
        let tls = (ssl != SslMode::Disable).then(|| {
            let verify_chain = match ssl {
                SslMode::VerifyCa | SslMode::VerifyFull => true,
                SslMode::Require => root_cert.is_some(),
                SslMode::Prefer | SslMode::Disable => false,
            };
            let mut tls = SslOpts::default()
                .with_danger_accept_invalid_certs(!verify_chain)
                .with_danger_skip_domain_validation(ssl != SslMode::VerifyFull);
            if let Some(path) = &root_cert {
                tls = tls
                    .with_root_certs(vec![std::path::PathBuf::from(path).into()])
                    .with_disable_built_in_roots(true);
            }
            if let Some(path) = &identity {
                let mut client =
                    mysql_async::ClientIdentity::new(std::path::PathBuf::from(path).into());
                if let Some(password) = &identity_password {
                    client = client.with_password(password.clone());
                }
                tls = tls.with_client_identity(Some(client));
            }
            tls
        });
        if identity.as_deref().is_some_and(|path| {
            let lower = path.to_ascii_lowercase();
            !lower.ends_with(".p12") && !lower.ends_with(".pfx")
        }) {
            return Err("MySQL-Client-Zertifikate werden als PKCS#12 (.p12/.pfx) mit sslpassword erwartet (openssl pkcs12 -export -inkey key.pem -in cert.pem -out client.p12).".into());
        }
        Ok(Self {
            opts: builder.ssl_opts(tls).into(),
            plain: (ssl == SslMode::Prefer).then_some(plain),
            pool_state,
            key,
        })
    }

    async fn open_conn(&self) -> Result<Conn, String> {
        super::execution::connect(async {
            match Conn::new(self.opts.clone()).await {
                Err(mysql_async::Error::Driver(
                    mysql_async::DriverError::NoClientSslFlagFromServer,
                )) => match &self.plain {
                    Some(plain) => Conn::new(plain.clone()).await.map_err(map_err),
                    None => Err(NO_SERVER_TLS.to_string()),
                },
                other => other.map_err(map_err),
            }
        })
        .await
    }

    async fn pool(&self, key: String, opts: Opts) -> Result<std::sync::Arc<Pool>, String> {
        self.pool_state
            .shared(&key, || async move { Ok::<Pool, String>(Pool::new(opts)) })
            .await
    }

    async fn conn(&self) -> Result<Conn, String> {
        let pool = self.pool(self.key.clone(), self.opts.clone()).await?;
        super::execution::connect(async {
            match pool.get_conn().await {
                Err(mysql_async::Error::Driver(
                    mysql_async::DriverError::NoClientSslFlagFromServer,
                )) => match &self.plain {
                    Some(plain) => self
                        .pool(format!("{}#plain", self.key), plain.clone())
                        .await?
                        .get_conn()
                        .await
                        .map_err(map_err),
                    None => Err(NO_SERVER_TLS.to_string()),
                },
                other => other.map_err(map_err),
            }
        })
        .await
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Row>, String> {
        let mut conn = self.conn().await?;
        timed(async { conn.query(sql).await.map_err(map_err) }).await
    }

    async fn exec(&self, sql: &str) -> Result<(), String> {
        let mut conn = self.conn().await?;
        timed(async { conn.query_drop(sql).await.map_err(map_err) }).await
    }

    async fn current_database(&self, conn: &mut Conn) -> Result<String, String> {
        let row: Option<Option<String>> = conn
            .query_first("SELECT DATABASE()")
            .await
            .map_err(map_err)?;
        Ok(row.flatten().unwrap_or_default())
    }

    async fn column_definition(
        &self,
        schema: &str,
        table: &str,
        column: &str,
    ) -> Result<Option<ColumnDefinition>, String> {
        let sql = format!(
            "SELECT c.column_type, c.is_nullable, c.column_default, c.extra, c.character_set_name, c.collation_name, c.column_comment, c.generation_expression, VERSION(), t.table_collation FROM information_schema.columns c LEFT JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name WHERE c.table_schema = {} AND c.table_name = {} AND c.column_name = {}",
            lit(schema),
            lit(table),
            lit(column)
        );
        let Some(row) = self.rows(&sql).await?.into_iter().next() else {
            return Ok(None);
        };
        let version = cell(&row, 8);
        let mariadb = version.to_ascii_lowercase().contains("mariadb");
        let legacy_mysql = !mariadb && is_legacy_mysql(&version);
        let check = if mariadb {
            self.rows(&format!(
                "SELECT check_clause FROM information_schema.check_constraints WHERE constraint_schema = {} AND table_name = {} AND level = 'Column' AND constraint_name = {}",
                lit(schema),
                lit(table),
                lit(column)
            ))
            .await
            .ok()
            .and_then(|rows| rows.first().and_then(|r| cell_opt(r, 0)))
        } else {
            None
        };
        Ok(Some(ColumnDefinition {
            data_type: cell(&row, 0),
            nullable: cell(&row, 1) == "YES",
            default: cell_opt(&row, 2),
            extra: cell(&row, 3),
            charset: cell_opt(&row, 4),
            collation: cell_opt(&row, 5),
            table_collation: cell_opt(&row, 9),
            comment: cell(&row, 6),
            generation: cell_opt(&row, 7),
            check,
            mariadb,
            legacy_mysql,
        }))
    }

    fn function_oid(schema: &str, name: &str, routine_type: &str) -> String {
        format!("{schema}\u{1f}{name}\u{1f}{routine_type}")
    }
}

async fn run_query(conn: &mut Conn, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    timed(async {
        let mut result = conn.query_iter(sql).await.map_err(map_err)?;
        let columns_meta: Vec<Column> = result.columns().map(|c| c.to_vec()).unwrap_or_default();
        let columns: Vec<String> = columns_meta
            .iter()
            .map(|c| c.name_str().into_owned())
            .collect();
        let columns = super::unique_column_names(columns);
        let rows: Vec<Row> = result.collect().await.map_err(map_err)?;
        let rows_affected = if columns.is_empty() {
            Some(result.affected_rows())
        } else {
            None
        };
        result.drop_result().await.map_err(map_err)?;
        let data: Vec<Vec<serde_json::Value>> = rows
            .into_iter()
            .map(|row| {
                let values = row.unwrap();
                values
                    .into_iter()
                    .zip(columns_meta.iter())
                    .map(|(v, c)| value_to_json(v, c))
                    .collect()
            })
            .collect();
        Ok(QueryResult {
            rows: rows_to_objects(&columns, data),
            columns,
            rows_affected,
            execution_time_ms: start.elapsed().as_millis() as u64,
            truncated: false,
        })
    })
    .await
}

async fn read_snapshot(conn: &mut Conn, sql: &str, max_rows: usize) -> Result<TableData, String> {
    let mut result = conn.query_iter(sql).await.map_err(map_err)?;
    let meta: Vec<Column> = result.columns().map(|c| c.to_vec()).unwrap_or_default();
    let columns: Vec<String> = meta.iter().map(|c| c.name_str().into_owned()).collect();
    let mut collector = super::snapshot::Collector::new(max_rows);
    while let Some(row) = result.next().await.map_err(map_err)? {
        let values = row.unwrap().into_iter().zip(&meta);
        collector.push(
            columns
                .iter()
                .cloned()
                .zip(values.map(|(value, column)| match value {
                    Value::Bytes(bytes)
                        if matches!(
                            column.column_type(),
                            ColumnType::MYSQL_TYPE_DECIMAL | ColumnType::MYSQL_TYPE_NEWDECIMAL
                        ) =>
                    {
                        serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned())
                    }
                    value => value_to_json(value, column),
                }))
                .collect(),
        )?;
    }
    collector.finish(columns)
}

struct MysqlTx {
    conn: Conn,
}

#[async_trait]
impl TxSession for MysqlTx {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        run_query(&mut self.conn, sql).await
    }
    async fn commit(&mut self) -> Result<(), String> {
        self.conn.query_drop("COMMIT").await.map_err(map_err)
    }
    async fn rollback(&mut self) -> Result<(), String> {
        self.conn.query_drop("ROLLBACK").await.map_err(map_err)
    }
}

#[async_trait]
impl DatabaseAdapter for MysqlAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        let mut conn = self.open_conn().await?;
        conn.query_drop("SELECT 1").await.map_err(map_err)?;
        conn.disconnect().await.map_err(map_err)
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SHOW DATABASES")
            .await?
            .iter()
            .map(|r| cell(r, 0))
            .collect())
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys') ORDER BY schema_name")
            .await?
            .iter()
            .map(|r| cell(r, 0))
            .collect())
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let filter = match schema {
            Some(s) => format!(" AND table_schema = {}", lit(s)),
            None => " AND table_schema = DATABASE()".to_string(),
        };
        let sql = format!("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE'{filter} ORDER BY table_schema, table_name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: cell(r, 0),
                name: cell(r, 1),
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
        let mut sql = format!("SELECT c.table_schema, c.table_name, c.column_name, c.column_type FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name WHERE t.table_type = '{kind}'");
        match schema {
            Some(s) => sql.push_str(&format!(" AND c.table_schema = {}", lit(s))),
            None => sql.push_str(" AND c.table_schema = DATABASE()"),
        }
        if let Some(t) = table {
            sql.push_str(&format!(" AND c.table_name = {}", lit(t)));
        }
        sql.push_str(" ORDER BY c.table_schema, c.table_name, c.ordinal_position");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| ColumnInfo {
                schema: cell(r, 0),
                table: cell(r, 1),
                name: cell(r, 2),
                data_type: cell(r, 3),
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
        let columns: Vec<String> = detailed.into_iter().map(|c| c.name).collect();
        let order_sql = match order_by {
            Some(col) if columns.iter().any(|c| c == col) => format!(
                " ORDER BY {} {}",
                quote(col),
                if order_desc { "DESC" } else { "ASC" }
            ),
            _ => String::new(),
        };
        let sql = format!(
            "SELECT * FROM {}.{}{}{} LIMIT {} OFFSET {}",
            quote(schema),
            quote(table),
            where_sql,
            order_sql,
            limit.max(0),
            offset.max(0)
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
            "SELECT COUNT(*) FROM {}.{}{}",
            quote(schema),
            quote(table),
            where_clause(filter, allow_raw_filter)?
        );
        Ok(self
            .rows(&sql)
            .await?
            .first()
            .map(|r| cell_i64(r, 0))
            .unwrap_or(0))
    }

    async fn begin_transaction(&self) -> Result<Box<dyn TxSession>, String> {
        let mut conn = self.open_conn().await?;
        conn.query_drop("START TRANSACTION")
            .await
            .map_err(map_err)?;
        Ok(Box::new(MysqlTx { conn }))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let mut conn = self.conn().await?;
        run_query(&mut conn, sql).await
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let filter = match schema {
            Some(s) => format!(" WHERE table_schema = {}", lit(s)),
            None => " WHERE table_schema = DATABASE()".to_string(),
        };
        let sql = format!("SELECT table_schema, table_name FROM information_schema.views{filter} ORDER BY table_name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: cell(r, 0),
                name: cell(r, 1),
            })
            .collect())
    }

    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let sql = format!("SELECT view_definition FROM information_schema.views WHERE table_schema = {} AND table_name = {}", lit(schema), lit(view));
        self.rows(&sql)
            .await?
            .first()
            .map(|r| cell(r, 0))
            .ok_or_else(|| "View nicht gefunden".to_string())
    }

    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, String> {
        self.rows(&format!(
            "SHOW CREATE TABLE {}.{}",
            quote(schema),
            quote(table)
        ))
        .await?
        .first()
        .map(|r| format!("{};\n", cell(r, 1)))
        .ok_or_else(|| "Tabelle nicht gefunden".to_string())
    }

    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String> {
        if dry_run {
            return self.exec(&format!("EXPLAIN {body}")).await;
        }
        self.exec(&format!(
            "CREATE OR REPLACE VIEW {}.{} AS {}",
            quote(schema),
            quote(view),
            body
        ))
        .await
    }

    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let filter = match schema {
            Some(s) => format!(" WHERE routine_schema = {}", lit(s)),
            None => " WHERE routine_schema = DATABASE()".to_string(),
        };
        let sql = format!("SELECT routine_schema, routine_name, routine_type, COALESCE(dtd_identifier, ''), external_language FROM information_schema.routines{filter} ORDER BY routine_name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| {
                let (schema, name, routine_type) = (cell(r, 0), cell(r, 1), cell(r, 2));
                FunctionInfo {
                    oid: Self::function_oid(&schema, &name, &routine_type),
                    identity_args: String::new(),
                    return_type: if routine_type == "PROCEDURE" {
                        "PROCEDURE".to_string()
                    } else {
                        cell(r, 3)
                    },
                    language: cell_opt(r, 4).unwrap_or_else(|| "SQL".to_string()),
                    schema,
                    name,
                }
            })
            .collect())
    }

    async fn get_function_definition(&self, oid: &str) -> Result<String, String> {
        let parts: Vec<&str> = oid.split('\u{1f}').collect();
        if parts.len() != 3 {
            return Err("Ungültige Funktionsreferenz".to_string());
        }
        let keyword = if parts[2] == "PROCEDURE" {
            "PROCEDURE"
        } else {
            "FUNCTION"
        };
        let sql = format!(
            "SHOW CREATE {keyword} {}.{}",
            quote(parts[0]),
            quote(parts[1])
        );
        self.rows(&sql)
            .await?
            .first()
            .map(|r| cell(r, 2))
            .ok_or_else(|| "Funktion nicht gefunden".to_string())
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!("DROP TABLE {}.{}", quote(schema), quote(table)))
            .await
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!(
            "TRUNCATE TABLE {}.{}",
            quote(schema),
            quote(table)
        ))
        .await
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let sql = format!(
            "SELECT column_name, column_type, is_nullable, column_default, column_key, ordinal_position, character_maximum_length, column_comment FROM information_schema.columns WHERE table_schema = {} AND table_name = {} ORDER BY ordinal_position",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| DetailedColumnInfo {
                name: cell(r, 0),
                data_type: cell(r, 1),
                is_nullable: cell(r, 2) == "YES",
                column_default: cell_opt(r, 3),
                is_primary_key: cell(r, 4) == "PRI",
                ordinal_position: cell_i64(r, 5) as i32,
                character_maximum_length: cell_opt(r, 6).and_then(|v| v.parse().ok()),
                comment: cell_opt(r, 7).filter(|c| !c.is_empty()),
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
            "ALTER TABLE {}.{} ADD COLUMN {} {}",
            quote(schema),
            quote(table),
            quote(&column.name),
            column.data_type
        );
        if !column.is_nullable {
            sql.push_str(" NOT NULL");
        }
        if let Some(d) = column.default_value.as_deref().filter(|d| !d.is_empty()) {
            sql.push_str(&format!(" DEFAULT {d}"));
        }
        self.exec(&sql).await
    }

    async fn alter_column(
        &self,
        schema: &str,
        table: &str,
        changes: &AlterColumnRequest,
    ) -> Result<(), String> {
        let current = self
            .column_definition(schema, table, &changes.old_name)
            .await?
            .ok_or_else(|| format!("Unbekannte Spalte: {}", changes.old_name))?;
        self.exec(&change_column_sql(schema, table, &current, changes))
            .await
    }

    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String> {
        self.exec(&format!(
            "ALTER TABLE {}.{} DROP COLUMN {}",
            quote(schema),
            quote(table),
            quote(column)
        ))
        .await
    }

    async fn list_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, String> {
        let sql = format!(
            "SELECT constraint_name, table_schema, table_name, column_name, referenced_table_schema, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage WHERE referenced_table_name IS NOT NULL AND table_schema = {} AND table_name = {} ORDER BY constraint_name, ordinal_position",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| ForeignKeyInfo {
                constraint_name: cell(r, 0),
                from_schema: cell(r, 1),
                from_table: cell(r, 2),
                from_column: cell(r, 3),
                to_schema: cell(r, 4),
                to_table: cell(r, 5),
                to_column: cell(r, 6),
            })
            .collect())
    }

    async fn list_triggers(&self, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
        let sql = format!(
            "SELECT trigger_name, event_manipulation, action_timing, action_orientation, action_statement FROM information_schema.triggers WHERE event_object_schema = {} AND event_object_table = {} ORDER BY trigger_name",
            lit(schema),
            lit(table)
        );
        let rows = self.rows(&sql).await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in rows.iter() {
            let name = cell(r, 0);
            let definition = self
                .rows(&format!(
                    "SHOW CREATE TRIGGER {}.{}",
                    quote(schema),
                    quote(&name)
                ))
                .await
                .ok()
                .and_then(|rows| rows.first().map(|r| cell(r, 2)))
                .unwrap_or_else(|| cell(r, 4));
            out.push(TriggerInfo {
                trigger_name: name,
                table_schema: schema.to_string(),
                table_name: table.to_string(),
                event: cell(r, 1),
                timing: cell(r, 2),
                orientation: cell(r, 3),
                function_schema: String::new(),
                function_name: String::new(),
                enabled: "O".to_string(),
                definition,
            });
        }
        Ok(out)
    }

    async fn table_comment(&self, schema: &str, table: &str) -> Result<Option<String>, String> {
        let sql = format!(
            "SELECT table_comment FROM information_schema.tables WHERE table_schema = {} AND table_name = {}",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .first()
            .map(|r| cell(r, 0))
            .filter(|c| !c.is_empty()))
    }

    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let sql = format!(
            "SELECT index_name, non_unique, column_name, index_type FROM information_schema.statistics WHERE table_schema = {} AND table_name = {} ORDER BY index_name, seq_in_index",
            lit(schema),
            lit(table)
        );
        let mut out: Vec<IndexInfo> = Vec::new();
        for r in self.rows(&sql).await? {
            let name = cell(&r, 0);
            let column = cell(&r, 2);
            if let Some(existing) = out.iter_mut().find(|i| i.name == name) {
                existing.columns.push(column);
                continue;
            }
            out.push(IndexInfo {
                is_unique: cell(&r, 1) == "0",
                is_primary: name == "PRIMARY",
                columns: vec![column],
                index_type: cell(&r, 3).to_lowercase(),
                definition: String::new(),
                name,
            });
        }
        for idx in &mut out {
            idx.definition = format!(
                "{}INDEX {} ON {}.{} ({})",
                if idx.is_unique { "UNIQUE " } else { "" },
                quote(&idx.name),
                quote(schema),
                quote(table),
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
            "SELECT tc.constraint_name, tc.constraint_type, GROUP_CONCAT(kcu.column_name ORDER BY kcu.ordinal_position SEPARATOR ','), MAX(cc.check_clause) FROM information_schema.table_constraints tc LEFT JOIN information_schema.key_column_usage kcu ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name LEFT JOIN information_schema.check_constraints cc ON tc.constraint_type = 'CHECK' AND cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name WHERE tc.table_schema = {} AND tc.table_name = {} GROUP BY tc.constraint_name, tc.constraint_type ORDER BY tc.constraint_type, tc.constraint_name",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| {
                let columns: Vec<String> = cell_opt(r, 2)
                    .map(|c| c.split(',').map(str::to_string).collect())
                    .unwrap_or_default();
                ConstraintInfo {
                    name: cell(r, 0),
                    definition: cell_opt(r, 3)
                        .map(|clause| format!("CHECK {clause}"))
                        .unwrap_or_else(|| format!("{} ({})", cell(r, 1), columns.join(", "))),
                    constraint_type: cell(r, 1),
                    columns,
                }
            })
            .collect())
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        self.exec(&create_table_ddl(
            req,
            quote,
            true,
            Some(super::constraints::ConstraintDialect::Mysql),
        )?)
        .await
    }

    async fn preview_create_table_ddl(&self, req: &CreateTableRequest) -> Result<String, String> {
        create_table_ddl(
            req,
            quote,
            true,
            Some(super::constraints::ConstraintDialect::Mysql),
        )
    }

    async fn explain_query(&self, sql: &str, analyze: bool) -> Result<serde_json::Value, String> {
        let statement = format!(
            "EXPLAIN {} {}",
            if analyze { "ANALYZE" } else { "FORMAT=JSON" },
            sql.trim()
        );
        let mut conn = self.conn().await?;
        let rows: Vec<Row> =
            match timed(async { conn.exec(statement.as_str(), ()).await.map_err(map_err) }).await {
                Ok(rows) => rows,
                Err(e) if super::split_statements(sql).len() > 1 => {
                    return Err(format!("{MULTI_STATEMENT_EXPLAIN} ({e})"))
                }
                Err(e) => return Err(e),
            };
        let text: Vec<String> = rows.iter().map(|r| cell(r, 0)).collect();
        if analyze {
            return Ok(serde_json::Value::String(text.join("\n")));
        }
        serde_json::from_str(text.first().map(String::as_str).unwrap_or("{}"))
            .map_err(|e| format!("EXPLAIN konnte nicht gelesen werden: {e}"))
    }

    async fn list_sessions(&self) -> Result<Vec<SessionInfo>, String> {
        let mut conn = self.conn().await?;
        let self_id: Option<u64> = conn
            .query_first("SELECT CONNECTION_ID()")
            .await
            .map_err(map_err)?;
        let rows: Vec<Row> = conn
            .query("SELECT id, user, COALESCE(db, ''), COALESCE(command, ''), COALESCE(host, ''), COALESCE(state, ''), COALESCE(info, ''), time FROM information_schema.processlist ORDER BY id")
            .await
            .map_err(map_err)?;
        Ok(rows
            .iter()
            .map(|r| {
                let pid = cell_i64(r, 0);
                SessionInfo {
                    pid: session_pid(pid),
                    user: cell(r, 1),
                    database: cell(r, 2),
                    application: cell(r, 3),
                    client_addr: cell_opt(r, 4),
                    state: cell_opt(r, 5),
                    query: cell(r, 6),
                    query_start: Some(format!("vor {} s", cell(r, 7))),
                    transaction_start: None,
                    wait_event: None,
                    is_self: self_id == Some(pid as u64),
                    blocked_by: Vec::new(),
                }
            })
            .collect())
    }

    async fn cancel_session(&self, pid: i32) -> Result<bool, String> {
        self.exec(&kill_statement("QUERY", pid)?)
            .await
            .map(|_| true)
    }

    async fn terminate_session(&self, pid: i32) -> Result<bool, String> {
        self.exec(&kill_statement("CONNECTION", pid)?)
            .await
            .map(|_| true)
    }

    async fn create_schema(&self, name: &str) -> Result<(), String> {
        self.exec(&format!("CREATE DATABASE {}", quote(name))).await
    }

    async fn drop_schema(&self, name: &str, _cascade: bool) -> Result<(), String> {
        self.exec(&format!("DROP DATABASE {}", quote(name))).await
    }

    async fn get_database_overview(&self) -> Result<DatabaseOverview, String> {
        let mut conn = self.conn().await?;
        let database = self.current_database(&mut conn).await?;
        let rows: Vec<Row> = conn
            .query("SELECT table_schema, COUNT(*), COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','performance_schema','mysql','sys') GROUP BY table_schema ORDER BY table_schema")
            .await
            .map_err(map_err)?;
        let schemas: Vec<SchemaSize> = rows
            .iter()
            .map(|r| SchemaSize {
                schema: cell(r, 0),
                table_count: cell_i64(r, 1),
                size_bytes: cell_i64(r, 2),
            })
            .collect();
        let size_bytes = schemas
            .iter()
            .filter(|s| database.is_empty() || s.schema == database)
            .map(|s| s.size_bytes)
            .sum();
        Ok(DatabaseOverview {
            database,
            size_bytes,
            size_pretty: super::pretty_bytes(size_bytes),
            schemas,
        })
    }

    async fn snapshot_rows(
        &self,
        request: &super::snapshot::SnapshotRequest,
    ) -> Result<TableData, String> {
        let object = format!("{}.{}", quote(&request.schema), quote(&request.table));
        let sql = super::snapshot::select_sql(request, &object, quote)?;
        let mut conn = self.conn().await?;
        conn.query_drop("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY")
            .await
            .map_err(map_err)?;
        let result = read_snapshot(&mut conn, &sql, request.max_rows).await;
        conn.query_drop("ROLLBACK").await.map_err(map_err)?;
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

#[path = "mysql_catalog.rs"]
mod catalog;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::create_pool_state;

    #[test]
    fn session_ids_never_wrap_to_other_sessions() {
        assert_eq!(session_pid(42), 42);
        assert_eq!(session_pid(i32::MAX as i64), i32::MAX);
        assert_eq!(session_pid(1 << 31), -1);
        assert_eq!(session_pid((1 << 32) + 5), -1);
        assert_eq!(kill_statement("QUERY", 42).unwrap(), "KILL QUERY 42");
        assert_eq!(
            kill_statement("CONNECTION", 7).unwrap(),
            "KILL CONNECTION 7"
        );
        assert!(kill_statement("QUERY", -1).is_err());
        assert!(kill_statement("CONNECTION", 0).is_err());
    }

    #[tokio::test]
    #[ignore]
    async fn live_tls_modes_fallback_and_client_certificates() {
        let dir = std::env::var("L8DB_E2E_PG_TLS_DIR").unwrap_or_else(|_| "/tmp/l8db-pgtls".into());
        let cipher = |url: String| async move {
            let adapter = MysqlAdapter::new(&url, None, create_pool_state(), url.clone())?;
            adapter.test_connection().await?;
            let result = adapter
                .execute_query("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
                .await?;
            Ok::<bool, String>(
                result.rows[0]
                    .as_object()
                    .and_then(|row| row.values().nth(1))
                    .and_then(|v| v.as_str())
                    .is_some_and(|v| !v.is_empty()),
            )
        };
        let port =
            |name: &str, default: &str| std::env::var(name).unwrap_or_else(|_| default.into());
        let plain_port = port("L8DB_E2E_MYSQL_PLAIN_PORT", "53306");
        let tls_port = port("L8DB_E2E_MYSQL_TLS_PORT", "53307");
        let plain = format!("mysql://root:testpw@127.0.0.1:{plain_port}/mysql");
        assert_eq!(cipher(plain.clone()).await, Ok(false));
        assert_eq!(
            cipher(format!("{plain}?serverTimezone=UTC&useUnicode=true")).await,
            Ok(false)
        );
        assert!(cipher(format!("{plain}?sslmode=require"))
            .await
            .unwrap_err()
            .contains("kein TLS"));
        let tls = format!("mysql://root:testpw@127.0.0.1:{tls_port}/mysql");
        assert_eq!(cipher(tls.clone()).await, Ok(true));
        assert_eq!(cipher(format!("{tls}?sslmode=require")).await, Ok(true));
        assert_eq!(cipher(format!("{tls}?sslmode=disable")).await, Ok(false));
        assert!(cipher(format!("{tls}?sslmode=verify-ca")).await.is_err());
        assert_eq!(
            cipher(format!("{tls}?sslmode=verify-ca&sslrootcert={dir}/ca.pem")).await,
            Ok(true)
        );
        assert!(cipher(format!(
            "{tls}?sslmode=verify-full&sslrootcert={dir}/ca.pem"
        ))
        .await
        .is_err());
        let cert = format!("mysql://certuser@127.0.0.1:{tls_port}/");
        assert!(cipher(format!("{cert}?sslmode=require")).await.is_err());
        assert_eq!(
            cipher(format!(
                "{cert}?ssl-mode=VERIFY_CA&ssl-ca={dir}/ca.pem&sslcert={dir}/client.p12&sslpassword=secret"
            ))
            .await,
            Ok(true)
        );
    }

    fn definition(data_type: &str, default: Option<&str>, extra: &str) -> ColumnDefinition {
        ColumnDefinition {
            data_type: data_type.into(),
            nullable: true,
            default: default.map(str::to_string),
            extra: extra.into(),
            charset: None,
            collation: None,
            table_collation: None,
            comment: String::new(),
            generation: None,
            check: None,
            mariadb: false,
            legacy_mysql: false,
        }
    }

    fn rename(old: &str, new: &str) -> AlterColumnRequest {
        AlterColumnRequest {
            old_name: old.into(),
            new_name: Some(new.into()),
            data_type: None,
            set_not_null: None,
            new_default: None,
            drop_default: false,
        }
    }

    fn change(def: &ColumnDefinition, req: &AlterColumnRequest) -> String {
        change_column_sql("db", "t", def, req)
            .strip_prefix("ALTER TABLE `db`.`t` CHANGE COLUMN ")
            .unwrap()
            .to_string()
    }

    #[test]
    fn change_column_keeps_mysql_column_attributes() {
        let mut id = definition("int", None, "auto_increment INVISIBLE");
        id.nullable = false;
        id.comment = "pk 'c' \\ x".into();
        assert_eq!(
            change(&id, &rename("id", "key")),
            r"`id` `key` int NOT NULL AUTO_INCREMENT INVISIBLE COMMENT 'pk ''c'' \\ x'"
        );
        let ts = definition(
            "timestamp(3)",
            Some("CURRENT_TIMESTAMP(3)"),
            "DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)",
        );
        assert_eq!(
            change(&ts, &rename("ts", "ts")),
            "`ts` `ts` timestamp(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)"
        );
        let mut s = definition("varchar(20)", Some("it's"), "");
        s.charset = Some("latin1".into());
        s.collation = Some("latin1_bin".into());
        s.nullable = false;
        assert_eq!(
            change(&s, &rename("s", "s2")),
            "`s` `s2` varchar(20) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL DEFAULT 'it''s'"
        );
        let mut widen = rename("s", "s");
        widen.data_type = Some("TEXT".into());
        assert_eq!(
            change(&s, &widen),
            "`s` `s` TEXT CHARACTER SET latin1 COLLATE latin1_bin NOT NULL DEFAULT 'it''s'"
        );
        widen.data_type = Some("varchar(50) COLLATE utf8mb4_bin".into());
        assert_eq!(
            change(&s, &widen),
            "`s` `s` varchar(50) COLLATE utf8mb4_bin NOT NULL DEFAULT 'it''s'"
        );
        let inherited = ColumnDefinition {
            table_collation: Some("latin1_bin".into()),
            ..definition("varchar(20)", None, "")
        };
        let inherited = ColumnDefinition {
            charset: Some("latin1".into()),
            collation: Some("latin1_bin".into()),
            ..inherited
        };
        assert_eq!(
            change(&inherited, &rename("s", "s")),
            "`s` `s` varchar(20) NULL"
        );
        widen.data_type = Some("int".into());
        widen.drop_default = true;
        assert_eq!(change(&s, &widen), "`s` `s` int NOT NULL");
    }

    #[test]
    fn change_column_renders_mysql_defaults_and_generated_columns() {
        let cases = [
            ("varchar(10)", Some("NULL"), "", " DEFAULT 'NULL'"),
            ("varchar(10)", Some(r"a\b"), "", r" DEFAULT 'a\\b'"),
            ("varchar(10)", Some("now()"), "", " DEFAULT 'now()'"),
            (
                "varchar(10)",
                Some("CURRENT_TIMESTAMP"),
                "",
                " DEFAULT 'CURRENT_TIMESTAMP'",
            ),
            ("decimal(5,2)", Some("1.50"), "", " DEFAULT '1.50'"),
            ("bit(1)", Some("b'1'"), "", " DEFAULT b'1'"),
            ("varbinary(4)", Some("0x6162"), "", " DEFAULT 0x6162"),
            ("int", None, "", ""),
            (
                "varchar(40)",
                Some(r"concat(_utf8mb4\'a\\\'b\',_utf8mb4\'c\\\\d\')"),
                "DEFAULT_GENERATED",
                r" DEFAULT (concat(_utf8mb4'a\'b',_utf8mb4'c\\d'))",
            ),
            (
                "datetime",
                Some("now()"),
                "DEFAULT_GENERATED",
                " DEFAULT (now())",
            ),
        ];
        for (data_type, default, extra, expected) in cases {
            assert_eq!(
                change(&definition(data_type, default, extra), &rename("c", "c")),
                format!("`c` `c` {data_type} NULL{expected}"),
                "{data_type} {default:?}"
            );
        }
        let mut stored = definition("decimal(7,2)", None, "STORED GENERATED");
        stored.generation = Some("(`n` * 2)".into());
        assert_eq!(
            change(&stored, &rename("g", "g2")),
            "`g` `g2` decimal(7,2) GENERATED ALWAYS AS ((`n` * 2)) STORED NULL"
        );
        let mut virt = definition("varchar(40)", None, "VIRTUAL GENERATED");
        virt.generation = Some(r"concat(`s`,_utf8mb4\'x\\\'y\')".into());
        virt.charset = Some("utf8mb4".into());
        virt.collation = Some("utf8mb4_0900_ai_ci".into());
        assert_eq!(
            change(&virt, &rename("v", "v")),
            r"`v` `v` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci GENERATED ALWAYS AS (concat(`s`,_utf8mb4'x\'y')) VIRTUAL NULL"
        );
        let plain = definition("int", Some("7"), "");
        let mut new_default = rename("c", "c");
        new_default.new_default = Some("42".into());
        new_default.set_not_null = Some(true);
        assert_eq!(
            change(&plain, &new_default),
            "`c` `c` int NOT NULL DEFAULT 42"
        );
    }

    #[test]
    fn change_column_renders_mysql57_binary_defaults_and_plain_generation_expressions() {
        let legacy = |data_type: &str, default: Option<&str>, extra: &str| ColumnDefinition {
            legacy_mysql: true,
            ..definition(data_type, default, extra)
        };
        let cases = [
            ("varbinary(4)", Some("ab"), " DEFAULT 'ab'"),
            ("binary(2)", Some("a'"), " DEFAULT 'a'''"),
            ("varbinary(4)", Some("0x41"), " DEFAULT '0x41'"),
            ("bit(3)", Some("b'101'"), " DEFAULT b'101'"),
        ];
        for (data_type, default, expected) in cases {
            assert_eq!(
                change(&legacy(data_type, default, ""), &rename("c", "c")),
                format!("`c` `c` {data_type} NULL{expected}")
            );
        }
        let mut generated = legacy("varchar(20)", None, "VIRTUAL GENERATED");
        generated.generation = Some(r"concat(`base`,'x\'y\\n')".into());
        assert_eq!(
            change(&generated, &rename("g", "g")),
            r"`g` `g` varchar(20) GENERATED ALWAYS AS (concat(`base`,'x\'y\\n')) VIRTUAL NULL"
        );
        assert!(is_legacy_mysql("5.7.44-log"));
        assert!(!is_legacy_mysql("8.0.36"));
        assert!(!is_legacy_mysql("8.4.11"));
        assert!(!is_legacy_mysql(""));
    }

    #[test]
    fn change_column_keeps_mariadb_defaults_and_column_checks() {
        let maria = |data_type: &str, default: Option<&str>, extra: &str| ColumnDefinition {
            mariadb: true,
            ..definition(data_type, default, extra)
        };
        let cases = [
            ("varchar(10)", Some("'abc'"), "", " DEFAULT 'abc'"),
            ("varchar(10)", Some("'it''s'"), "", " DEFAULT 'it''s'"),
            ("varchar(10)", Some("'NULL'"), "", " DEFAULT 'NULL'"),
            ("int(11)", Some("NULL"), "", " DEFAULT NULL"),
            ("decimal(5,2)", Some("1.50"), "", " DEFAULT 1.50"),
            ("varbinary(4)", Some("x'6162'"), "", " DEFAULT x'6162'"),
            (
                "varchar(40)",
                Some(r"concat('a\'b','c')"),
                "",
                r" DEFAULT concat('a\'b','c')",
            ),
            (
                "timestamp(3)",
                Some("current_timestamp(3)"),
                "on update current_timestamp(3)",
                " DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3)",
            ),
        ];
        for (data_type, default, extra, expected) in cases {
            assert_eq!(
                change(&maria(data_type, default, extra), &rename("c", "c")),
                format!("`c` `c` {data_type} NULL{expected}"),
                "{data_type} {default:?}"
            );
        }
        let mut json = maria("longtext", None, "");
        json.charset = Some("utf8mb4".into());
        json.collation = Some("utf8mb4_bin".into());
        json.check = Some("json_valid(`j`)".into());
        assert_eq!(
            change(&json, &rename("j", "doc")),
            "`j` `doc` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL CHECK (json_valid(`doc`))"
        );
        let mut generated = maria("varchar(40)", Some("NULL"), "VIRTUAL GENERATED");
        generated.generation = Some(r"concat(`s`,'x\'y')".into());
        assert_eq!(
            change(&generated, &rename("v", "v")),
            r"`v` `v` varchar(40) GENERATED ALWAYS AS (concat(`s`,'x\'y')) VIRTUAL"
        );
    }

    fn live_urls() -> Vec<String> {
        ["L8DB_SMOKE_MYSQL_URL", "L8DB_SMOKE_MARIADB_URL"]
            .iter()
            .filter_map(|key| std::env::var(key).ok())
            .collect()
    }

    async fn live_scalar(adapter: &MysqlAdapter, sql: &str) -> String {
        cell(&adapter.rows(sql).await.unwrap()[0], 0)
    }

    #[tokio::test]
    #[ignore]
    async fn live_explain_analyze_rolls_back_changes() {
        for url in live_urls() {
            let adapter = MysqlAdapter::new(&url, None, create_pool_state(), url.clone()).unwrap();
            let mariadb = live_scalar(&adapter, "SELECT VERSION()")
                .await
                .contains("MariaDB");
            adapter
                .exec("DROP TABLE IF EXISTS l8db_explain_analyze, l8db_explain_other")
                .await
                .unwrap();
            adapter
                .exec("CREATE TABLE l8db_explain_analyze (id INT PRIMARY KEY, v INT) ENGINE=InnoDB")
                .await
                .unwrap();
            adapter
                .exec("CREATE TABLE l8db_explain_other (id INT PRIMARY KEY) ENGINE=InnoDB")
                .await
                .unwrap();
            adapter
                .exec("INSERT INTO l8db_explain_analyze VALUES (1, 10), (2, 20)")
                .await
                .unwrap();
            adapter
                .exec("INSERT INTO l8db_explain_other VALUES (1), (2)")
                .await
                .unwrap();
            for sql in [
                "UPDATE l8db_explain_analyze a JOIN l8db_explain_other o ON o.id = a.id SET a.v = a.v + 1",
                "DELETE a FROM l8db_explain_analyze a JOIN l8db_explain_other o ON o.id = a.id",
                "UPDATE l8db_explain_analyze SET v = 0",
                "DELETE FROM l8db_explain_analyze",
            ] {
                let outcome = adapter.explain_query(sql, true).await;
                assert!(mariadb || outcome.is_ok(), "{url}: {sql}: {outcome:?}");
                assert_eq!(
                    live_scalar(
                        &adapter,
                        "SELECT CONCAT(COUNT(*), '/', SUM(v)) FROM l8db_explain_analyze"
                    )
                    .await,
                    "2/30",
                    "{url}: {sql}"
                );
            }
            if !mariadb {
                let plan = adapter
                    .explain_query("SELECT * FROM l8db_explain_analyze WHERE id = 1", true)
                    .await
                    .unwrap();
                assert!(plan.is_string(), "{url}: {plan}");
            }
            assert_eq!(
                live_scalar(&adapter, "SELECT @@autocommit").await,
                "1",
                "{url}"
            );
            adapter
                .exec("DROP TABLE l8db_explain_analyze, l8db_explain_other")
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    #[ignore]
    async fn live_explain_never_runs_trailing_statements() {
        for url in live_urls() {
            let adapter = MysqlAdapter::new(&url, None, create_pool_state(), url.clone()).unwrap();
            adapter
                .exec("DROP TABLE IF EXISTS l8db_explain_guard")
                .await
                .unwrap();
            adapter
                .exec("CREATE TABLE l8db_explain_guard (id INT PRIMARY KEY)")
                .await
                .unwrap();
            adapter
                .exec("INSERT INTO l8db_explain_guard VALUES (1), (2)")
                .await
                .unwrap();
            let err = adapter
                .explain_query(
                    "SELECT * FROM l8db_explain_guard;\nDELETE FROM l8db_explain_guard",
                    false,
                )
                .await
                .unwrap_err();
            assert!(err.contains("einzelne"), "{url}: {err}");
            for sql in [
                "SELECT * FROM l8db_explain_guard WHERE id = 1--1; DELETE FROM l8db_explain_guard",
                "SELECT 1 /* /* */; DELETE FROM l8db_explain_guard; /* */",
                "SELECT 1 # comment\n; DELETE FROM l8db_explain_guard",
            ] {
                assert!(
                    adapter.explain_query(sql, false).await.is_err(),
                    "{url}: {sql}"
                );
            }
            assert_eq!(
                live_scalar(&adapter, "SELECT COUNT(*) FROM l8db_explain_guard").await,
                "2",
                "{url}"
            );
            for sql in [
                "SELECT * FROM l8db_explain_guard WHERE id = 1",
                "SELECT * FROM l8db_explain_guard WHERE id = 1;",
                "  SELECT ';' FROM l8db_explain_guard ; ",
            ] {
                let plan = adapter.explain_query(sql, false).await.unwrap();
                assert!(plan.is_object(), "{url}: {plan}");
            }
            adapter.exec("DROP TABLE l8db_explain_guard").await.unwrap();
        }
    }

    #[tokio::test]
    #[ignore]
    async fn live_alter_column_keeps_column_attributes() {
        for url in live_urls() {
            let adapter = MysqlAdapter::new(&url, None, create_pool_state(), url.clone()).unwrap();
            let schema = live_scalar(&adapter, "SELECT DATABASE()").await;
            let mariadb = live_scalar(&adapter, "SELECT VERSION()")
                .await
                .contains("MariaDB");
            adapter
                .exec("DROP TABLE IF EXISTS l8db_alter_keep")
                .await
                .unwrap();
            adapter
                .exec(
                    r#"CREATE TABLE l8db_alter_keep (
                     id INT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'pk ''c''',
                     s VARCHAR(20) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL DEFAULT 'it''s' COMMENT 'str',
                     ts TIMESTAMP(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                     n DECIMAL(5,2) DEFAULT 1.50,
                     base VARCHAR(10),
                     g DECIMAL(7,2) GENERATED ALWAYS AS (length(base) * 2) STORED,
                     v VARCHAR(40) GENERATED ALWAYS AS (concat(base, 'x''y\\z')) VIRTUAL,
                     b BIT(1) DEFAULT b'1',
                     vb VARBINARY(4) DEFAULT 'ab',
                     q VARCHAR(10) DEFAULT 'NULL',
                     bs VARCHAR(10) DEFAULT 'a\\b',
                     ex VARCHAR(40) DEFAULT (concat('a''b', 'c\\d')),
                     inv INT DEFAULT 7 INVISIBLE,
                     nd INT NULL DEFAULT NULL,
                     j JSON,
                     k INT CHECK (k > 0))"#,
                )
                .await
                .unwrap();
            let before = cell(
                &adapter
                    .rows("SHOW CREATE TABLE l8db_alter_keep")
                    .await
                    .unwrap()[0],
                1,
            );
            for column in [
                "id", "s", "ts", "n", "g", "v", "b", "vb", "q", "bs", "ex", "inv", "nd", "j", "k",
            ] {
                let renamed = if column == "k" && !mariadb {
                    column.to_string()
                } else {
                    format!("{column}_r")
                };
                for (old, new) in [
                    (column.to_string(), renamed.clone()),
                    (renamed.clone(), column.to_string()),
                ] {
                    adapter
                        .alter_column(
                            &schema,
                            "l8db_alter_keep",
                            &AlterColumnRequest {
                                old_name: old,
                                new_name: Some(new),
                                data_type: None,
                                set_not_null: None,
                                new_default: None,
                                drop_default: false,
                            },
                        )
                        .await
                        .unwrap_or_else(|e| panic!("{url} {column}: {e}"));
                }
            }
            let after = cell(
                &adapter
                    .rows("SHOW CREATE TABLE l8db_alter_keep")
                    .await
                    .unwrap()[0],
                1,
            );
            assert_eq!(before, after, "{url}");
            adapter.exec("DROP TABLE l8db_alter_keep").await.unwrap();
        }
    }

    #[tokio::test]
    #[ignore]
    async fn live_alter_column_keeps_binary_defaults_and_generated_literals() {
        for url in live_urls() {
            let adapter = MysqlAdapter::new(&url, None, create_pool_state(), url.clone()).unwrap();
            let schema = live_scalar(&adapter, "SELECT DATABASE()").await;
            adapter
                .exec("DROP TABLE IF EXISTS l8db_alter_bin")
                .await
                .unwrap();
            adapter
                .exec(
                    r#"CREATE TABLE l8db_alter_bin (
                     base VARCHAR(10),
                     vb VARBINARY(4) DEFAULT 'ab',
                     bn BINARY(2) DEFAULT 'a''',
                     hx VARBINARY(4) DEFAULT '0x41',
                     b BIT(3) DEFAULT b'101',
                     g VARCHAR(20) GENERATED ALWAYS AS (concat(base, '\\n')) VIRTUAL,
                     q VARCHAR(20) GENERATED ALWAYS AS (concat(base, 'x''y\\z')) VIRTUAL)"#,
                )
                .await
                .unwrap();
            adapter
                .exec("INSERT INTO l8db_alter_bin (base) VALUES ('a')")
                .await
                .unwrap();
            let snapshot = || async {
                (
                    cell(
                        &adapter
                            .rows("SHOW CREATE TABLE l8db_alter_bin")
                            .await
                            .unwrap()[0],
                        1,
                    ),
                    live_scalar(
                        &adapter,
                        "SELECT CONCAT(HEX(g), '/', HEX(q)) FROM l8db_alter_bin",
                    )
                    .await,
                )
            };
            let before = snapshot().await;
            for column in ["vb", "bn", "hx", "b", "g", "q"] {
                for set_not_null in [None, Some(false)] {
                    adapter
                        .alter_column(
                            &schema,
                            "l8db_alter_bin",
                            &AlterColumnRequest {
                                old_name: column.into(),
                                new_name: Some(column.into()),
                                data_type: None,
                                set_not_null,
                                new_default: None,
                                drop_default: false,
                            },
                        )
                        .await
                        .unwrap_or_else(|e| panic!("{url} {column}: {e}"));
                }
            }
            assert_eq!(snapshot().await, before, "{url}");
            adapter.exec("DROP TABLE l8db_alter_bin").await.unwrap();
        }
    }

    #[test]
    fn translates_sslmode_and_database() {
        let adapter = MysqlAdapter::new(
            "mysql://root:pw@db.example.com:3307/app?sslmode=require&compression=fast",
            Some("other"),
            create_pool_state(),
            "k".into(),
        )
        .unwrap();
        assert_eq!(adapter.opts.db_name(), Some("other"));
        assert_eq!(adapter.opts.ip_or_hostname(), "db.example.com");
        assert_eq!(adapter.opts.tcp_port(), 3307);
        assert!(adapter.opts.ssl_opts().is_some());
        assert!(adapter.plain.is_none());
        let local = MysqlAdapter::new(
            "mysql://root@localhost/app?useSSL=true&serverTimezone=UTC&characterEncoding=utf8&allowPublicKeyRetrieval=true&enable_cleartext_plugin=true",
            None,
            create_pool_state(),
            "k".into(),
        )
        .unwrap();
        assert!(local.opts.ssl_opts().is_some());
        assert!(local.plain.as_ref().is_some_and(|p| p.ssl_opts().is_none()));
        assert!(local.opts.enable_cleartext_plugin());
        let disabled = MysqlAdapter::new(
            "mysql://root@db/app?useSSL=false",
            None,
            create_pool_state(),
            "k".into(),
        )
        .unwrap();
        assert!(disabled.opts.ssl_opts().is_none());
        let verified = MysqlAdapter::new(
            "mysql://root@db/app?ssl-mode=VERIFY_IDENTITY&ssl-ca=/ca.pem&sslcert=/c.p12&sslpassword=pw",
            None,
            create_pool_state(),
            "k".into(),
        )
        .unwrap();
        let tls = verified.opts.ssl_opts().unwrap();
        assert!(!tls.accept_invalid_certs() && !tls.skip_domain_validation());
        assert_eq!(tls.root_certs().len(), 1);
        assert!(tls.client_identity().is_some());
        assert!(MysqlAdapter::new(
            "mysql://root@db/app?sslcert=/c.pem",
            None,
            create_pool_state(),
            "k".into()
        )
        .is_err());
        assert!(
            MysqlAdapter::new("postgres://x@y/z", None, create_pool_state(), "k".into()).is_err()
        );
    }
}
