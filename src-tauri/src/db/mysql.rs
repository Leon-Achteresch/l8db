use async_trait::async_trait;
use mysql_async::consts::{ColumnFlags, ColumnType};
use mysql_async::prelude::*;
use mysql_async::{Column, Conn, Opts, OptsBuilder, Pool, Row, SslOpts, Value};

use super::pool::PoolState;
use super::{
    attach_row_keys, create_table_ddl, rows_to_objects, timed, where_clause, AddColumnRequest,
    AlterColumnRequest, ColumnInfo, ConstraintInfo, CreateTableRequest, DatabaseAdapter,
    DatabaseOverview, DetailedColumnInfo, ForeignKeyInfo, FunctionInfo, IndexInfo, QueryResult,
    SchemaSize, SessionInfo, SslMode, TableData, TableInfo, TriggerInfo, TxSession,
};

const NO_SERVER_TLS: &str =
    "Der MySQL-Server unterstützt kein TLS. SSL-Modus „Bevorzugen“ oder „Deaktiviert“ wählen.";

type SessionConns = std::sync::Mutex<std::collections::HashMap<String, (Conn, std::time::Instant)>>;

const SESSION_TTL: std::time::Duration = std::time::Duration::from_secs(60);
const SESSION_MAX: usize = 8;

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

pub fn value_lit(value: &str) -> String {
    if !value.contains('\\') {
        return lit(value);
    }
    let hex: String = value.bytes().map(|b| format!("{b:02X}")).collect();
    format!("_utf8mb4 X'{hex}'")
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

const MARIADB_ANALYZE_READ_ONLY: &str =
    "ANALYZE führt die Anweisung aus. Auf MariaDB nur für SELECT.";

const MULTI_STATEMENT_EXPLAIN: &str =
    "EXPLAIN unterstützt nur eine einzelne Anweisung. Bitte die gewünschte Anweisung markieren.";

fn extra_results_note(extra: usize) -> String {
    match extra {
        1 => "1 weitere Ergebnismenge wird nicht angezeigt.".into(),
        n => format!("{n} weitere Ergebnismengen werden nicht angezeigt."),
    }
}

const SYSTEM_SCHEMAS: &str = "('information_schema','performance_schema','mysql','sys')";

const MYSQL_LOCKS: &str = "SELECT COALESCE(t.PROCESSLIST_ID, 0), l.LOCK_TYPE, CONCAT_WS('.', l.OBJECT_SCHEMA, l.OBJECT_NAME), CONCAT_WS(' · ', l.LOCK_MODE, l.INDEX_NAME), l.LOCK_STATUS = 'GRANTED' FROM performance_schema.data_locks l LEFT JOIN performance_schema.threads t ON t.THREAD_ID = l.THREAD_ID UNION ALL SELECT COALESCE(t.PROCESSLIST_ID, 0), 'METADATA', CONCAT_WS('.', m.OBJECT_SCHEMA, m.OBJECT_NAME), m.LOCK_TYPE, m.LOCK_STATUS = 'GRANTED' FROM performance_schema.metadata_locks m LEFT JOIN performance_schema.threads t ON t.THREAD_ID = m.OWNER_THREAD_ID WHERE m.OBJECT_TYPE = 'TABLE' AND m.OBJECT_SCHEMA NOT IN ('information_schema','performance_schema','mysql','sys') AND COALESCE(t.PROCESSLIST_ID, 0) <> CONNECTION_ID() ORDER BY 1, 5 DESC LIMIT 1000";

const MARIADB_LOCKS: &str = "SELECT COALESCE(x.trx_mysql_thread_id, 0), l.lock_type, l.lock_table, CONCAT_WS(' · ', l.lock_mode, l.lock_index), w.requesting_trx_id IS NULL FROM information_schema.INNODB_LOCKS l LEFT JOIN information_schema.INNODB_TRX x ON x.trx_id = l.lock_trx_id LEFT JOIN information_schema.INNODB_LOCK_WAITS w ON w.requested_lock_id = l.lock_id ORDER BY 1, 5 DESC LIMIT 1000";

const TABLE_TYPES: &str = "('BASE TABLE','SYSTEM VERSIONED')";

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

fn timestamp_on_update(data_type: &str, extra: &str) -> Option<String> {
    let base = data_type.split('(').next().unwrap_or_default();
    if !(base.eq_ignore_ascii_case("timestamp") || base.eq_ignore_ascii_case("datetime"))
        || has_flag(extra, "generated")
    {
        return None;
    }
    let rule = on_update_clause(extra)?.to_ascii_uppercase();
    let valid_precision = rule
        .strip_prefix("CURRENT_TIMESTAMP(")
        .and_then(|suffix| suffix.strip_suffix(')'))
        .is_some_and(|digits| matches!(digits.as_bytes(), [b'0'..=b'6']));
    (rule == "CURRENT_TIMESTAMP" || valid_precision).then_some(rule)
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
    if changes.set_not_null.unwrap_or(!current.nullable) {
        sql.push_str(" NOT NULL");
    } else if !(current.mariadb && generation.is_some()) {
        sql.push_str(" NULL");
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

const NO_LOCAL_INFILE: &str = "LOAD DATA LOCAL INFILE wird nicht unterstützt. Datei auf den Server legen (LOAD DATA INFILE) oder den CSV-Import nutzen.";

fn map_err(e: mysql_async::Error) -> String {
    match e {
        mysql_async::Error::Server(err) if err.code == 3948 => NO_LOCAL_INFILE.into(),
        mysql_async::Error::Server(err) if err.code == 1792 => {
            format!(
                "Verbindung ist schreibgeschützt: MySQL 1792: {}",
                err.message
            )
        }
        mysql_async::Error::Server(err) => format!("MySQL {}: {}", err.code, err.message),
        mysql_async::Error::Driver(mysql_async::DriverError::LocalInfile(
            mysql_async::LocalInfileError::NoHandler,
        )) => NO_LOCAL_INFILE.into(),
        mysql_async::Error::Io(mysql_async::IoError::Io(err)) => format!("MySQL: {err}"),
        mysql_async::Error::Io(mysql_async::IoError::Tls(err)) => {
            format!("MySQL: TLS-Fehler: {err}")
        }
        other => format!("MySQL: {other}"),
    }
}

fn connect_err(opts: &Opts, e: mysql_async::Error) -> String {
    let address = format!("{}:{}", opts.ip_or_hostname(), opts.tcp_port());
    match &e {
        mysql_async::Error::Io(mysql_async::IoError::Io(err)) => match err.kind() {
            std::io::ErrorKind::ConnectionRefused => {
                format!("Verbindung zu {address} abgelehnt. Läuft der Server und stimmt der Port?")
            }
            std::io::ErrorKind::TimedOut => {
                format!("Zeitüberschreitung beim Verbinden mit {address}.")
            }
            _ => format!("Verbindung zu {address} fehlgeschlagen: {err}"),
        },
        _ => map_err(e),
    }
}

fn is_mariadb(conn: &Conn) -> bool {
    conn.server_version().0 >= 10
}

fn flavored(mariadb: bool, message: String) -> String {
    match message.strip_prefix("MySQL") {
        Some(rest) if mariadb => format!("MariaDB{rest}"),
        _ => message,
    }
}

fn filter_error(filter: Option<&str>, message: String) -> String {
    let Some(filter) = filter.filter(|_| message.contains(" 1064:")) else {
        return message;
    };
    let upper = filter.to_ascii_uppercase();
    let hint = if upper.contains("ILIKE") {
        "ILIKE gibt es hier nicht, LIKE verwenden."
    } else if filter.contains("::") {
        "„::“ gibt es hier nicht, CAST(… AS …) verwenden."
    } else {
        "Filter hat einen Syntaxfehler."
    };
    let server = message
        .find(" near '")
        .map_or(message.as_str(), |end| &message[..end]);
    format!("{hint}\n  {server}")
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
                return serde_json::Value::String(super::hex_0x(&bytes));
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

fn plan_text(rows: &[Row]) -> String {
    let Some(first) = rows.first().filter(|r| r.columns_ref().len() > 1) else {
        return rows
            .iter()
            .map(|r| cell(r, 0))
            .collect::<Vec<_>>()
            .join("\n");
    };
    let header: Vec<String> = first
        .columns_ref()
        .iter()
        .map(|c| c.name_str().into_owned())
        .collect();
    let body: Vec<Vec<String>> = rows
        .iter()
        .map(|r| (0..header.len()).map(|i| cell(r, i)).collect())
        .collect();
    let widths: Vec<usize> = (0..header.len())
        .map(|i| {
            body.iter()
                .map(|line| line[i].chars().count())
                .chain([header[i].chars().count()])
                .max()
                .unwrap_or(0)
        })
        .collect();
    std::iter::once(&header)
        .chain(body.iter())
        .map(|line| {
            line.iter()
                .zip(&widths)
                .map(|(value, width)| format!("{value:<width$}"))
                .collect::<Vec<_>>()
                .join("  ")
                .trim_end()
                .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn replace_view_sql(create: &str, check: &str, schema: &str, view: &str, body: &str) -> String {
    let attributes = create
        .find(" SQL SECURITY ")
        .and_then(|start| {
            create[start..]
                .find(" VIEW ")
                .map(|end| create["CREATE".len()..start + end].trim())
        })
        .unwrap_or("");
    let body = body.trim().trim_end_matches(';').trim_end();
    let check = match check {
        "CASCADED" | "LOCAL" if !body.to_uppercase().ends_with("CHECK OPTION") => {
            format!(" WITH {check} CHECK OPTION")
        }
        _ => String::new(),
    };
    format!(
        "CREATE OR REPLACE {attributes}{}VIEW {}.{} AS {body}{check}",
        if attributes.is_empty() { "" } else { " " },
        quote(schema),
        quote(view)
    )
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

pub struct MysqlUrl {
    pub url: url::Url,
    pub ssl: SslMode,
    pub root_cert: Option<String>,
    pub identity: Option<String>,
    pub identity_password: Option<String>,
    pub read_only: bool,
}

pub const READ_ONLY_SETUP: &str = "SET SESSION TRANSACTION READ ONLY";

fn without_setup(opts: &Opts) -> Opts {
    OptsBuilder::from_opts(opts.clone())
        .setup(Vec::<String>::new())
        .into()
}

async fn read_only_session_supported(opts: Opts, plain: Option<Opts>) -> Result<bool, String> {
    let mut conn = match Conn::new(without_setup(&opts)).await {
        Err(mysql_async::Error::Driver(mysql_async::DriverError::NoClientSslFlagFromServer)) => {
            match plain {
                Some(plain) => Conn::new(without_setup(&plain))
                    .await
                    .map_err(|e| connect_err(&plain, e))?,
                None => return Err(NO_SERVER_TLS.to_string()),
            }
        }
        other => other.map_err(|e| connect_err(&opts, e))?,
    };
    let supported = match conn.query_drop(READ_ONLY_SETUP).await {
        Ok(()) => true,
        Err(mysql_async::Error::Server(error)) => {
            eprintln!(
                "l8db: Server lehnt {READ_ONLY_SETUP} ab ({} {}); Lesemodus nur clientseitig.",
                error.code, error.message
            );
            false
        }
        Err(error) => return Err(map_err(error)),
    };
    let _ = conn.disconnect().await;
    Ok(supported)
}

pub fn parse_mysql_url(value: &str) -> Result<MysqlUrl, String> {
    let mut url = url::Url::parse(value.trim()).map_err(|_| "Ungültige MySQL-URL".to_string())?;
    let token_auth = super::cloud_auth::has_marker(&url);
    if !matches!(url.scheme(), "mysql" | "mariadb") {
        return Err("Eine mysql:// URL ist erforderlich".to_string());
    }
    let mut ssl = SslMode::Prefer;
    let mut root_cert = None;
    let mut identity = None;
    let mut identity_password = None;
    let mut read_only = false;
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
                identity = Some(v.trim_start_matches("file:").to_string()).filter(|v| !v.is_empty())
            }
            "sslpassword" | "ssl-password" | "clientCertificateKeyStorePassword" => {
                identity_password = Some(v)
            }
            "read_only" => read_only = v == "true",
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
    Ok(MysqlUrl {
        url,
        ssl,
        root_cert,
        identity,
        identity_password,
        read_only,
    })
}

pub fn endpoint(value: &str) -> Result<super::endpoint::EndpointIdentity, String> {
    let parsed = parse_mysql_url(value)?;
    let opts =
        Opts::from_url(parsed.url.as_str()).map_err(|e| format!("Ungültige MySQL-URL: {e}"))?;
    Ok(super::endpoint::EndpointIdentity {
        host: opts
            .ip_or_hostname()
            .trim_matches(['[', ']'])
            .to_ascii_lowercase(),
        port: Some(opts.tcp_port()),
        transport: String::new(),
        tls: parsed.ssl >= SslMode::Require,
        verify: parsed.ssl >= SslMode::VerifyCa,
        database: opts.db_name().unwrap_or_default().to_string(),
        schema: String::new(),
        user: opts.user().unwrap_or_default().to_string(),
        params: Vec::new(),
    })
}

impl MysqlAdapter {
    pub fn new(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let resolved = super::cloud_auth::resolve(connection_string.trim())?;
        let MysqlUrl {
            url,
            ssl,
            root_cert,
            identity,
            identity_password,
            read_only,
        } = parse_mysql_url(&resolved)?;
        let opts = Opts::from_url(url.as_str()).map_err(|e| format!("Ungültige MySQL-URL: {e}"))?;
        let mut builder = OptsBuilder::from_opts(opts)
            .tcp_nodelay(true)
            .client_found_rows(true)
            .conn_ttl(Some(std::time::Duration::from_secs(60)));
        if let Some(db) = database.filter(|d| !d.is_empty()) {
            builder = builder.db_name(Some(db));
        }
        if read_only {
            builder = builder.setup(vec![READ_ONLY_SETUP]);
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

    async fn session_opts(&self) -> Result<(Opts, Option<Opts>), String> {
        if self.opts.setup().is_empty() {
            return Ok((self.opts.clone(), self.plain.clone()));
        }
        let probe = read_only_session_supported(self.opts.clone(), self.plain.clone());
        let supported = self
            .pool_state
            .shared(&format!("{}#read-only-session", self.key), || {
                super::execution::connect(probe)
            })
            .await?;
        Ok(if *supported {
            (self.opts.clone(), self.plain.clone())
        } else {
            (
                without_setup(&self.opts),
                self.plain.as_ref().map(without_setup),
            )
        })
    }

    async fn open_conn(&self) -> Result<Conn, String> {
        let (opts, plain) = self.session_opts().await?;
        super::execution::connect(async {
            match Conn::new(opts.clone()).await {
                Err(mysql_async::Error::Driver(
                    mysql_async::DriverError::NoClientSslFlagFromServer,
                )) => match &plain {
                    Some(plain) => Conn::new(plain.clone())
                        .await
                        .map_err(|e| connect_err(plain, e)),
                    None => Err(NO_SERVER_TLS.to_string()),
                },
                other => other.map_err(|e| connect_err(&opts, e)),
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
        let (opts, plain) = self.session_opts().await?;
        let pool = self.pool(self.key.clone(), opts.clone()).await?;
        super::execution::connect(async {
            match pool.get_conn().await {
                Err(mysql_async::Error::Driver(
                    mysql_async::DriverError::NoClientSslFlagFromServer,
                )) => match &plain {
                    Some(plain) => self
                        .pool(format!("{}#plain", self.key), plain.clone())
                        .await?
                        .get_conn()
                        .await
                        .map_err(|e| connect_err(plain, e)),
                    None => Err(NO_SERVER_TLS.to_string()),
                },
                other => other.map_err(|e| connect_err(&opts, e)),
            }
        })
        .await
    }

    async fn execute_in_session(&self, session: &str, sql: &str) -> Result<QueryResult, String> {
        let sessions = self
            .pool_state
            .shared(&format!("{}#script-sessions", self.key), || async {
                Ok::<SessionConns, String>(std::sync::Mutex::new(Default::default()))
            })
            .await?;
        let parked = {
            let mut map = sessions.lock().unwrap_or_else(|e| e.into_inner());
            map.retain(|_, (_, since)| since.elapsed() < SESSION_TTL);
            map.remove(session).map(|(conn, _)| conn)
        };
        let mut conn = match parked {
            Some(conn) => conn,
            None => self.open_conn().await?,
        };
        let result = run_query(&mut conn, sql).await;
        if result.is_ok() || conn.ping().await.is_ok() {
            let mut map = sessions.lock().unwrap_or_else(|e| e.into_inner());
            if map.len() < SESSION_MAX || map.contains_key(session) {
                map.insert(session.to_string(), (conn, std::time::Instant::now()));
            }
        }
        result
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Row>, String> {
        let mut conn = self.conn().await?;
        let mariadb = is_mariadb(&conn);
        timed(async { conn.query(sql).await.map_err(map_err) })
            .await
            .map_err(|e| flavored(mariadb, e))
    }

    async fn detailed_column_metadata(
        &self,
        schema: &str,
        table: &str,
        include_update: bool,
    ) -> Result<Vec<super::column_metadata::ColumnMetadata>, String> {
        let mut conn = self.conn().await?;
        let mysql8 = include_update && conn.server_version().0 == 8;
        let update_fields = if mysql8 {
            ", extra, table_schema, table_name"
        } else {
            ""
        };
        let sql = format!(
            "SELECT column_name, column_type, is_nullable, column_default, column_key, ordinal_position, character_maximum_length, column_comment{update_fields} FROM information_schema.columns WHERE table_schema = {} AND table_name = {} ORDER BY ordinal_position",
            lit(schema),
            lit(table)
        );
        let mariadb = is_mariadb(&conn);
        let rows: Vec<Row> = timed(async { conn.query(sql).await.map_err(map_err) })
            .await
            .map_err(|e| flavored(mariadb, e))?;
        Ok(rows
            .iter()
            .map(|r| {
                let data_type = catalog::normalize_type(&cell(r, 1));
                let on_update = if mysql8 && cell(r, 9) == schema && cell(r, 10) == table {
                    timestamp_on_update(&data_type, &cell(r, 8))
                } else {
                    None
                };
                let mut metadata =
                    super::column_metadata::ColumnMetadata::from(DetailedColumnInfo {
                        name: cell(r, 0),
                        data_type,
                        is_nullable: cell(r, 2) == "YES",
                        column_default: cell_opt(r, 3),
                        is_primary_key: cell(r, 4) == "PRI",
                        ordinal_position: cell_i64(r, 5) as i32,
                        character_maximum_length: cell_opt(r, 6).and_then(|v| v.parse().ok()),
                        comment: cell_opt(r, 7).filter(|c| !c.is_empty()),
                    });
                metadata.on_update = on_update;
                metadata
            })
            .collect())
    }

    async fn exec(&self, sql: &str) -> Result<(), String> {
        let mut conn = self.conn().await?;
        let mariadb = is_mariadb(&conn);
        timed(async { conn.query_drop(sql).await.map_err(map_err) })
            .await
            .map_err(|e| flavored(mariadb, e))
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
    let outcome = timed(async { Ok(read_query(conn, sql).await) }).await?;
    let failed = match &outcome {
        Ok(_) if conn.get_warnings() > 0 => Some(None),
        Err(mysql_async::Error::Server(error)) => Some(Some(error.code)),
        _ => None,
    };
    if let (Some(failed), true) = (failed, super::server_output::sink().is_some()) {
        let _ = timed(emit_warnings(conn, failed)).await;
    }
    outcome.map_err(|e| flavored(is_mariadb(conn), map_err(e)))
}

async fn emit_warnings(conn: &mut Conn, failed: Option<u16>) -> Result<(), String> {
    let rows: Vec<(String, u32, String)> = conn.query("SHOW WARNINGS").await.map_err(map_err)?;
    for (level, code, message) in rows {
        if level.eq_ignore_ascii_case("error") && failed == Some(code as u16) {
            continue;
        }
        super::server_output::emit(super::server_output::ServerMessage {
            level: level.to_uppercase(),
            message,
            detail: Some(format!("Code {code}")),
        });
    }
    Ok(())
}

async fn read_query(conn: &mut Conn, sql: &str) -> Result<QueryResult, mysql_async::Error> {
    let start = std::time::Instant::now();
    {
        let mut result = conn.query_iter(sql).await?;
        let columns_meta: Vec<Column> = result.columns().map(|c| c.to_vec()).unwrap_or_default();
        let columns: Vec<String> = columns_meta
            .iter()
            .map(|c| c.name_str().into_owned())
            .collect();
        let columns = super::unique_column_names(columns);
        let limit = super::execution::row_limit();
        let mut rows: Vec<Row> = Vec::new();
        while let Some(row) = result.next().await? {
            if rows.len() < limit {
                rows.push(row);
            }
        }
        let rows_affected = if columns.is_empty() {
            Some(result.affected_rows())
        } else {
            None
        };
        let mut extra = 0usize;
        while let Some(more) = result.columns() {
            extra += usize::from(!more.is_empty());
            while result.next().await?.is_some() {}
        }
        result.drop_result().await?;
        if extra > 0 {
            super::server_output::emit(super::server_output::ServerMessage {
                level: "INFO".into(),
                message: extra_results_note(extra),
                detail: None,
            });
        }
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
    }
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
            .rows(&format!("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN {SYSTEM_SCHEMAS} ORDER BY schema_name"))
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
        let sql = format!("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type IN {TABLE_TYPES}{filter} ORDER BY table_schema, table_name");
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
            "('VIEW')"
        } else {
            TABLE_TYPES
        };
        let mut sql = format!("SELECT c.table_schema, c.table_name, c.column_name, c.column_type FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name WHERE t.table_type IN {kind}");
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
                data_type: catalog::normalize_type(&cell(r, 3)),
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
        let order = order_by
            .filter(|col| columns.iter().any(|c| c == col))
            .map(|col| (col, order_desc));
        let terms = super::stable_order_terms(order, &pk, quote);
        let order_sql = super::order_clause(&where_sql, &terms);
        let sql = format!(
            "SELECT * FROM {}.{}{}{} LIMIT {} OFFSET {}",
            quote(schema),
            quote(table),
            where_sql,
            order_sql,
            limit.max(0),
            offset.max(0)
        );
        let mut result = self
            .execute_query(&sql)
            .await
            .map_err(|e| filter_error(filter, e))?;
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
            .await
            .map_err(|e| filter_error(filter, e))?
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
        if let Some(session) = super::execution::session_id() {
            return self.execute_in_session(&session, sql).await;
        }
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
        let create = self
            .rows(&format!(
                "SHOW CREATE VIEW {}.{}",
                quote(schema),
                quote(view)
            ))
            .await?
            .first()
            .map(|r| cell(r, 1))
            .ok_or_else(|| "View nicht gefunden".to_string())?;
        let check = self
            .rows(&format!(
                "SELECT CHECK_OPTION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = {} AND TABLE_NAME = {}",
                lit(schema),
                lit(view)
            ))
            .await?
            .first()
            .map(|r| cell(r, 0))
            .unwrap_or_default();
        self.exec(&replace_view_sql(&create, &check, schema, view, body))
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
        Ok(self
            .detailed_column_metadata(schema, table, false)
            .await?
            .into_iter()
            .map(|metadata| metadata.column)
            .collect())
    }

    async fn list_table_column_metadata(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<super::column_metadata::ColumnMetadata>, String> {
        self.detailed_column_metadata(schema, table, true).await
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
        let mut conn = self.conn().await?;
        let mariadb = is_mariadb(&conn);
        let statement = if analyze && mariadb {
            let first = sql
                .trim_start()
                .split(|c: char| c.is_whitespace() || c == '(')
                .next()
                .unwrap_or("")
                .to_ascii_uppercase();
            if !matches!(first.as_str(), "SELECT" | "WITH" | "VALUES" | "TABLE") {
                return Err(MARIADB_ANALYZE_READ_ONLY.into());
            }
            format!("ANALYZE {}", sql.trim())
        } else {
            format!(
                "EXPLAIN {} {}",
                if analyze { "ANALYZE" } else { "FORMAT=JSON" },
                sql.trim()
            )
        };
        let rows: Vec<Row> =
            match timed(async { conn.exec(statement.as_str(), ()).await.map_err(map_err) }).await {
                Ok(rows) => rows,
                Err(e) if super::split_statements(sql).len() > 1 => {
                    return Err(format!("{MULTI_STATEMENT_EXPLAIN} ({e})"))
                }
                Err(e) => return Err(flavored(mariadb, e)),
            };
        let text: Vec<String> = rows.iter().map(|r| cell(r, 0)).collect();
        if analyze {
            return Ok(serde_json::Value::String(plan_text(&rows)));
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
                    ..Default::default()
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

    async fn list_locks(&self) -> Result<Vec<super::LockInfo>, String> {
        let mut conn = self.conn().await?;
        let mariadb = is_mariadb(&conn);
        let sql = if mariadb { MARIADB_LOCKS } else { MYSQL_LOCKS };
        let rows: Vec<Row> = timed(async { conn.query(sql).await.map_err(map_err) })
            .await
            .map_err(|e| flavored(mariadb, e))?;
        Ok(rows
            .iter()
            .map(|r| super::LockInfo {
                pid: session_pid(cell_i64(r, 0)),
                lock_type: cell(r, 1),
                relation: cell_opt(r, 2).filter(|v| !v.is_empty()),
                mode: cell(r, 3),
                granted: cell(r, 4) == "1",
            })
            .collect())
    }

    async fn search_columns(
        &self,
        schema: Option<&str>,
        term: &str,
        limit: i64,
    ) -> Result<Vec<super::ColumnMatch>, String> {
        let sql = format!(
            "SELECT c.table_schema, c.table_name, c.column_name, c.column_type, t.table_type FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name WHERE c.table_schema NOT IN {SYSTEM_SCHEMAS}{} AND c.column_name LIKE {} ORDER BY c.table_schema, c.table_name, c.ordinal_position LIMIT {}",
            schema.map_or(String::new(), |s| format!(" AND c.table_schema = {}", lit(s))),
            lit(&super::postgres::like_pattern(term)),
            limit.max(0)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| super::ColumnMatch {
                schema: cell(r, 0),
                table: cell(r, 1),
                column: cell(r, 2),
                data_type: catalog::normalize_type(&cell(r, 3)),
                object_type: cell(r, 4),
            })
            .collect())
    }

    async fn search_source(
        &self,
        schema: Option<&str>,
        term: &str,
        limit: i64,
    ) -> Result<Vec<super::SourceMatch>, String> {
        let pattern = lit(&super::postgres::like_pattern(term));
        let only =
            |column: &str| schema.map_or(String::new(), |s| format!(" AND {column} = {}", lit(s)));
        let sql = format!(
            "SELECT routine_schema, routine_name, routine_type, routine_definition FROM information_schema.routines WHERE routine_schema NOT IN {SYSTEM_SCHEMAS}{} AND routine_definition LIKE {pattern} UNION ALL SELECT table_schema, table_name, 'VIEW', view_definition FROM information_schema.views WHERE table_schema NOT IN {SYSTEM_SCHEMAS}{} AND view_definition LIKE {pattern} ORDER BY 1, 2 LIMIT {}",
            only("routine_schema"),
            only("table_schema"),
            limit.max(0)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .filter_map(|r| {
                let (schema, name, kind) = (cell(r, 0), cell(r, 1), cell(r, 2));
                let (line, snippet, occurrences) =
                    super::postgres::source_snippet(&cell(r, 3), term)?;
                let view = kind == "VIEW";
                Some(super::SourceMatch {
                    oid: if view {
                        format!("{schema}.{name}")
                    } else {
                        Self::function_oid(&schema, &name, &kind)
                    },
                    identity: String::new(),
                    object_type: if view { "view" } else { "routine" }.into(),
                    schema,
                    name,
                    line,
                    snippet,
                    occurrences,
                })
            })
            .collect())
    }

    async fn list_scheduler_jobs(&self) -> Result<Vec<super::SchedulerJobInfo>, String> {
        let rows = self
            .rows("SELECT event_schema, event_name, definer, status, event_type, interval_value, interval_field, execute_at, starts, ends, event_definition, last_executed, @@event_scheduler FROM information_schema.events WHERE event_schema = DATABASE() ORDER BY event_name")
            .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let (schema, name, status) = (cell(r, 0), cell(r, 1), cell(r, 3));
                let schedule = if cell(r, 4) == "ONE TIME" {
                    format!("AT {}", cell(r, 7))
                } else {
                    let mut text = format!("EVERY {} {}", cell(r, 5), cell(r, 6));
                    if let Some(starts) = cell_opt(r, 8) {
                        text.push_str(&format!(" STARTS {starts}"));
                    }
                    if let Some(ends) = cell_opt(r, 9) {
                        text.push_str(&format!(" ENDS {ends}"));
                    }
                    text
                };
                super::SchedulerJobInfo {
                    id: format!("{schema}\u{1f}{name}"),
                    owner: cell(r, 2),
                    enabled: status == "ENABLED",
                    state: if cell(r, 12).eq_ignore_ascii_case("ON") {
                        status
                    } else {
                        format!("{status} · Scheduler aus")
                    },
                    schedule,
                    command: cell(r, 10),
                    last_run: cell_opt(r, 11),
                    last_status: None,
                    last_error: None,
                    next_run: None,
                    name,
                }
            })
            .collect())
    }

    async fn set_scheduler_job_enabled(&self, job_id: &str, enabled: bool) -> Result<(), String> {
        let (schema, name) = job_id
            .split_once('\u{1f}')
            .ok_or_else(|| "Ungültige Event-ID.".to_string())?;
        self.exec(&format!(
            "ALTER EVENT {}.{} {}",
            quote(schema),
            quote(name),
            if enabled { "ENABLE" } else { "DISABLE" }
        ))
        .await
    }

    async fn run_scheduler_job(&self, job_id: &str) -> Result<(), String> {
        let _ = job_id;
        Err("MySQL-Events lassen sich nicht manuell starten.".into())
    }

    async fn get_partition_info(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<super::PartitionInfo, String> {
        let rows = self
            .rows(&format!(
                "SELECT DISTINCT partition_name, partition_method, partition_expression, partition_ordinal_position FROM information_schema.partitions WHERE table_schema = {} AND table_name = {} AND partition_name IS NOT NULL ORDER BY partition_ordinal_position LIMIT 10000",
                lit(schema),
                lit(table)
            ))
            .await?;
        Ok(super::PartitionInfo {
            is_partitioned: !rows.is_empty(),
            strategy: rows.first().map(|r| cell(r, 1)),
            partition_key: rows.first().and_then(|r| cell_opt(r, 2)),
            partitions: rows
                .iter()
                .map(|r| super::PartitionChild {
                    schema: table.to_string(),
                    name: cell(r, 0),
                })
                .collect(),
            read_only: true,
        })
    }

    async fn list_sequences(
        &self,
        schema: Option<&str>,
    ) -> Result<Vec<super::SequenceInfo>, String> {
        let filter = schema.map_or_else(|| "DATABASE()".to_string(), lit);
        let names = self
            .rows(&format!("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'SEQUENCE' AND table_schema = {filter} ORDER BY table_name LIMIT 1000"))
            .await?;
        if names.is_empty() {
            return Ok(Vec::new());
        }
        let sql = names
            .iter()
            .map(|r| {
                let (schema, name) = (cell(r, 0), cell(r, 1));
                format!(
                    "SELECT {}, {}, start_value, minimum_value, maximum_value, increment, cycle_option FROM {}.{}",
                    lit(&schema),
                    lit(&name),
                    quote(&schema),
                    quote(&name)
                )
            })
            .collect::<Vec<_>>()
            .join(" UNION ALL ");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| super::SequenceInfo {
                schema: cell(r, 0),
                name: cell(r, 1),
                data_type: "bigint".into(),
                start_value: cell(r, 2),
                min_value: cell(r, 3),
                max_value: cell(r, 4),
                increment_by: cell(r, 5),
                cycle: cell(r, 6) == "1",
                last_value: None,
            })
            .collect())
    }

    async fn alter_sequence(
        &self,
        schema: &str,
        name: &str,
        changes: &super::AlterSequenceRequest,
    ) -> Result<(), String> {
        let number = |value: &str| -> Result<String, String> {
            let value = value.trim();
            value
                .parse::<i128>()
                .map(|_| value.to_string())
                .map_err(|_| format!("„{value}“ ist keine ganze Zahl."))
        };
        let mut parts: Vec<String> = Vec::new();
        if let Some(inc) = changes.increment_by.as_deref() {
            parts.push(format!("INCREMENT BY {}", number(inc)?));
        }
        for (value, keyword) in [
            (&changes.min_value, "MINVALUE"),
            (&changes.max_value, "MAXVALUE"),
        ] {
            match value.as_deref().map(str::trim) {
                Some("") => parts.push(format!("NO {keyword}")),
                Some(v) => parts.push(format!("{keyword} {}", number(v)?)),
                None => {}
            }
        }
        if let Some(cycle) = changes.cycle {
            parts.push(if cycle { "CYCLE" } else { "NOCYCLE" }.into());
        }
        if let Some(restart) = changes
            .restart_with
            .as_deref()
            .filter(|v| !v.trim().is_empty())
        {
            parts.push(format!("RESTART WITH {}", number(restart)?));
        }
        if parts.is_empty() {
            return Ok(());
        }
        self.exec(&format!(
            "ALTER SEQUENCE {}.{} {}",
            quote(schema),
            quote(name),
            parts.join(" ")
        ))
        .await
    }

    async fn create_schema(&self, name: &str) -> Result<(), String> {
        self.exec(&format!("CREATE DATABASE {}", quote(name))).await
    }

    async fn drop_schema(&self, name: &str, _cascade: bool) -> Result<(), String> {
        self.exec(&format!("DROP DATABASE {}", quote(name))).await
    }

    async fn live_metrics(&self, include_details: bool) -> Result<super::LiveMetrics, String> {
        let mut conn = self.conn().await?;
        let rows: Vec<Row> = conn.query("SHOW GLOBAL STATUS").await.map_err(map_err)?;
        let status: std::collections::HashMap<String, i64> = rows
            .iter()
            .filter_map(|r| cell(r, 1).parse().ok().map(|value| (cell(r, 0), value)))
            .collect();
        let stat = |name: &str| status.get(name).copied().unwrap_or(0);
        let sum = |names: &[&str]| names.iter().map(|name| stat(name)).sum::<i64>();
        let variables: Option<Row> = conn
            .query_first("SELECT @@max_connections, @@version, @@time_zone, @@system_time_zone")
            .await
            .map_err(map_err)?;
        let isolation: Option<String> = match conn
            .query_first::<Row, _>("SELECT @@transaction_isolation")
            .await
        {
            Ok(row) => row.and_then(|r| cell_opt(&r, 0)),
            Err(_) => conn
                .query_first::<Row, _>("SELECT @@tx_isolation")
                .await
                .ok()
                .flatten()
                .and_then(|r| cell_opt(&r, 0)),
        };
        let size = if include_details {
            conn.query_first::<Row, _>(
                "SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = DATABASE()",
            )
            .await
            .ok()
            .flatten()
            .map(|r| cell_i64(&r, 0))
        } else {
            None
        };
        let replica: Vec<Row> = match conn.query("SHOW REPLICA STATUS").await {
            Ok(rows) => rows,
            Err(_) => conn.query("SHOW SLAVE STATUS").await.unwrap_or_default(),
        };
        let replication: Vec<super::ReplicationStat> = replica
            .iter()
            .map(|r| {
                let named = |names: &[&str]| {
                    r.columns_ref()
                        .iter()
                        .position(|column| names.contains(&column.name_str().as_ref()))
                        .and_then(|index| cell_opt(r, index))
                };
                let io = named(&["Replica_IO_Running", "Slave_IO_Running"]).unwrap_or_default();
                let sql = named(&["Replica_SQL_Running", "Slave_SQL_Running"]).unwrap_or_default();
                super::ReplicationStat {
                    name: named(&["Channel_Name"])
                        .filter(|name| !name.is_empty())
                        .or_else(|| named(&["Source_Host", "Master_Host"]))
                        .unwrap_or_default(),
                    client_addr: named(&["Source_Host", "Master_Host"]),
                    state: format!("IO {io} · SQL {sql}"),
                    sync_state: None,
                    write_lag_ms: None,
                    flush_lag_ms: None,
                    replay_lag_ms: named(&["Seconds_Behind_Source", "Seconds_Behind_Master"])
                        .and_then(|value| value.parse::<f64>().ok())
                        .map(|seconds| seconds * 1000.0),
                    lag_bytes: None,
                }
            })
            .collect();
        let read = stat("Com_select");
        let write = sum(&[
            "Com_insert",
            "Com_insert_select",
            "Com_update",
            "Com_update_multi",
            "Com_delete",
            "Com_delete_multi",
            "Com_replace",
            "Com_replace_select",
            "Com_load",
        ]);
        Ok(super::LiveMetrics {
            connections: stat("Threads_connected"),
            max_connections: variables.as_ref().map(|r| cell_i64(r, 0)),
            active_sessions: (stat("Threads_running") - 1).max(0),
            waiting_locks: stat("Innodb_row_lock_current_waits"),
            database_size_bytes: size,
            commits: stat("Handler_commit"),
            rollbacks: stat("Handler_rollback"),
            queries_read: Some(read),
            queries_write: Some(write),
            queries_other: Some((stat("Questions") - read - write).max(0)),
            rows_read: stat("Innodb_rows_read"),
            rows_written: sum(&[
                "Innodb_rows_inserted",
                "Innodb_rows_updated",
                "Innodb_rows_deleted",
            ]),
            blocks_read: stat("Innodb_buffer_pool_reads"),
            blocks_hit: (stat("Innodb_buffer_pool_read_requests")
                - stat("Innodb_buffer_pool_reads"))
            .max(0),
            temp_bytes: None,
            deadlocks: status.get("Innodb_deadlocks").copied(),
            cpu_busy: None,
            cpu_total: None,
            server_version: variables.as_ref().map(|r| cell(r, 1)).unwrap_or_default(),
            uptime_seconds: status.get("Uptime").copied(),
            timezone: variables.as_ref().and_then(|r| {
                cell_opt(r, 2)
                    .filter(|zone| zone != "SYSTEM")
                    .or_else(|| cell_opt(r, 3))
            }),
            default_isolation: isolation.map(|level| level.replace('-', " ").to_lowercase()),
            in_recovery: !replication.is_empty(),
            replay_delay_ms: replication
                .iter()
                .filter_map(|r| r.replay_lag_ms)
                .reduce(f64::max),
            replication,
            table_io: Vec::new(),
        })
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

pub(crate) use catalog::strip_int_widths;

#[cfg(test)]
#[path = "mysql_column_update_tests.rs"]
mod column_update_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::create_pool_state;

    #[test]
    fn read_only_urls_lock_every_session() {
        let url = "mysql://app@db:3306/shop?ssl-mode=DISABLED&read_only=true";
        let parsed = parse_mysql_url(url).unwrap();
        assert!(parsed.read_only);
        assert!(!parsed.url.as_str().contains("read_only"));
        let adapter = MysqlAdapter::new(url, None, create_pool_state(), "ro".into()).unwrap();
        assert_eq!(adapter.opts.setup(), [READ_ONLY_SETUP]);
        let writable = MysqlAdapter::new(
            "mysql://app@db:3306/shop",
            None,
            create_pool_state(),
            "rw".into(),
        )
        .unwrap();
        assert!(writable.opts.setup().is_empty());
        assert!(without_setup(&adapter.opts).setup().is_empty());
        assert_eq!(
            without_setup(&adapter.opts).ip_or_hostname(),
            adapter.opts.ip_or_hostname()
        );
        assert!(
            !parse_mysql_url("mysql://app@db/shop?read_only=false")
                .unwrap()
                .read_only
        );
        let error = map_err(mysql_async::Error::Server(mysql_async::ServerError {
            code: 1792,
            message: "Cannot execute statement in a READ ONLY transaction.".into(),
            state: "25006".into(),
        }));
        assert!(
            error.starts_with("Verbindung ist schreibgeschützt"),
            "{error}"
        );
    }

    #[test]
    fn filter_errors_hint_dialect_without_internal_sql() {
        let server = "MySQL 1064: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'ILIKE 'n%') ORDER BY `id` LIMIT 3 OFFSET 0' at line 1".to_string();
        let text = filter_error(Some("name ILIKE 'n%'"), server.clone());
        assert!(
            text.starts_with("ILIKE gibt es hier nicht, LIKE verwenden."),
            "{text}"
        );
        assert!(!text.contains("LIMIT 3"), "{text}");
        assert!(text.contains("MySQL 1064"), "{text}");
        assert!(filter_error(Some("d::date = '2020-01-01'"), server.clone()).starts_with("„::“"));
        assert_eq!(filter_error(None, server.clone()), server);
        let other = "MySQL 1054: Unknown column 'x'".to_string();
        assert_eq!(filter_error(Some("x = 1"), other.clone()), other);
        assert_eq!(
            flavored(true, server.clone())[..12].to_string(),
            "MariaDB 1064"
        );
        assert_eq!(flavored(false, other.clone()), other);
        assert_eq!(
            extra_results_note(1),
            "1 weitere Ergebnismenge wird nicht angezeigt."
        );
        assert_eq!(
            extra_results_note(3),
            "3 weitere Ergebnismengen werden nicht angezeigt."
        );
    }

    #[tokio::test]
    async fn refused_connection_names_host_and_port() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let url = format!("mysql://root:x@127.0.0.1:{port}/db?sslmode=disable");
        let adapter = MysqlAdapter::new(&url, None, create_pool_state(), url.clone()).unwrap();
        let error = adapter.test_connection().await.unwrap_err();
        assert_eq!(
            error,
            format!(
                "Verbindung zu 127.0.0.1:{port} abgelehnt. Läuft der Server und stimmt der Port?"
            )
        );
    }

    #[tokio::test]
    #[ignore]
    async fn live_partitions_are_listed_read_only() {
        if live_urls().is_empty() {
            eprintln!("übersprungen: L8DB_SMOKE_MYSQL_URL und L8DB_SMOKE_MARIADB_URL fehlen");
        }
        for url in live_urls() {
            let adapter = MysqlAdapter::new(&url, None, create_pool_state(), url.clone()).unwrap();
            let schema = live_scalar(&adapter, "SELECT DATABASE()").await;
            adapter
                .execute_query("DROP TABLE IF EXISTS l8db_fix_part, l8db_fix_plain")
                .await
                .unwrap();
            adapter
                .execute_query("CREATE TABLE l8db_fix_part (id INT, d DATE) PARTITION BY RANGE COLUMNS(d) (PARTITION p2022 VALUES LESS THAN ('2023-01-01'), PARTITION p2023 VALUES LESS THAN ('2024-01-01'), PARTITION pmax VALUES LESS THAN (MAXVALUE))")
                .await
                .unwrap();
            adapter
                .execute_query("CREATE TABLE l8db_fix_plain (id INT)")
                .await
                .unwrap();
            let info = adapter
                .get_partition_info(&schema, "l8db_fix_part")
                .await
                .unwrap();
            assert!(info.is_partitioned && info.read_only);
            assert_eq!(info.strategy.as_deref(), Some("RANGE COLUMNS"));
            assert_eq!(info.partition_key.as_deref(), Some("`d`"));
            let names: Vec<_> = info.partitions.iter().map(|p| p.name.as_str()).collect();
            assert_eq!(names, ["p2022", "p2023", "pmax"]);
            let plain = adapter
                .get_partition_info(&schema, "l8db_fix_plain")
                .await
                .unwrap();
            assert!(!plain.is_partitioned && plain.partitions.is_empty());
            adapter
                .execute_query("DROP TABLE l8db_fix_part, l8db_fix_plain")
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    #[ignore]
    async fn live_objects_results_and_messages() {
        use crate::db::server_output::{capture, Messages};
        for url in live_urls() {
            let adapter = MysqlAdapter::new(&url, None, create_pool_state(), url.clone()).unwrap();
            let mariadb = live_scalar(&adapter, "SELECT VERSION()")
                .await
                .contains("MariaDB");
            let schema = live_scalar(&adapter, "SELECT DATABASE()").await;
            for sql in [
                "DROP PROCEDURE IF EXISTS l8db_fix_two",
                "DROP TABLE IF EXISTS l8db_fix_ver, l8db_fix_t",
                "DROP EVENT IF EXISTS l8db_fix_ev",
                "CREATE TABLE l8db_fix_t (id INT PRIMARY KEY, l8db_fix_col INT, g INT(11))",
                "INSERT INTO l8db_fix_t VALUES (1, 1, 1), (2, 2, 2)",
                "CREATE PROCEDURE l8db_fix_two() BEGIN SELECT id FROM l8db_fix_t; SELECT COUNT(*) AS l8db_fix_marker FROM l8db_fix_t; SELECT 3; END",
                "CREATE EVENT l8db_fix_ev ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1",
            ] {
                adapter.exec(sql).await.unwrap();
            }
            let sink = Messages::default();
            let result = capture(sink.clone(), adapter.execute_query("CALL l8db_fix_two()"))
                .await
                .unwrap();
            assert_eq!(result.rows.len(), 2, "{url}");
            let notes: Vec<String> = sink.take().into_iter().map(|m| m.message).collect();
            assert!(
                notes.contains(&"2 weitere Ergebnismengen werden nicht angezeigt.".to_string()),
                "{url}: {notes:?}"
            );
            let error = adapter
                .fetch_rows(
                    &schema,
                    "l8db_fix_t",
                    Some("id ILIKE '1'"),
                    3,
                    0,
                    None,
                    false,
                    false,
                    false,
                )
                .await
                .unwrap_err();
            assert!(
                error.starts_with("ILIKE gibt es hier nicht"),
                "{url}: {error}"
            );
            assert!(!error.contains("LIMIT 3"), "{url}: {error}");
            assert!(
                error.contains(if mariadb {
                    "MariaDB 1064"
                } else {
                    "MySQL 1064"
                }),
                "{url}: {error}"
            );
            let types = adapter
                .list_table_columns_detailed(&schema, "l8db_fix_t")
                .await
                .unwrap();
            assert_eq!(types[2].data_type, "int", "{url}");
            let columns = adapter
                .search_columns(Some(&schema), "l8db_fix_c", 5)
                .await
                .unwrap();
            assert_eq!(columns.len(), 1, "{url}: {columns:?}");
            assert_eq!(columns[0].table, "l8db_fix_t");
            let limited = adapter.search_columns(None, "", 1).await.unwrap();
            assert!(limited.len() <= 1, "{url}");
            let source = adapter
                .search_source(Some(&schema), "l8db_fix_marker", 5)
                .await
                .unwrap();
            assert_eq!(source.len(), 1, "{url}: {source:?}");
            assert_eq!(source[0].object_type, "routine");
            assert_eq!(
                source[0].oid,
                MysqlAdapter::function_oid(&schema, "l8db_fix_two", "PROCEDURE")
            );
            let event = adapter
                .list_scheduler_jobs()
                .await
                .unwrap()
                .into_iter()
                .find(|job| job.name == "l8db_fix_ev")
                .unwrap();
            assert!(!event.enabled, "{url}");
            assert!(
                event.schedule.starts_with("EVERY 1 DAY"),
                "{url}: {}",
                event.schedule
            );
            adapter
                .set_scheduler_job_enabled(&event.id, true)
                .await
                .unwrap();
            assert_eq!(
                live_scalar(
                    &adapter,
                    "SELECT status FROM information_schema.events WHERE event_name = 'l8db_fix_ev'"
                )
                .await,
                "ENABLED"
            );
            assert!(adapter.run_scheduler_job(&event.id).await.is_err());
            let mut holder = adapter.open_conn().await.unwrap();
            holder.query_drop("START TRANSACTION").await.unwrap();
            holder
                .query_drop("SELECT * FROM l8db_fix_t WHERE id = 1 FOR UPDATE")
                .await
                .unwrap();
            let mut waiter = adapter.open_conn().await.unwrap();
            let waiting = tokio::spawn(async move {
                waiter
                    .query_drop("SET SESSION innodb_lock_wait_timeout = 10")
                    .await
                    .unwrap();
                waiter.query_drop("START TRANSACTION").await.unwrap();
                let outcome = waiter
                    .query_drop("SELECT * FROM l8db_fix_t WHERE id = 1 FOR UPDATE")
                    .await;
                waiter.query_drop("ROLLBACK").await.unwrap();
                outcome
            });
            let mut locks = Vec::new();
            for _ in 0..50 {
                locks = adapter.list_locks().await.unwrap();
                if locks.iter().any(|l| !l.granted) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            assert!(
                locks.iter().any(|l| !l.granted
                    && l.relation
                        .as_deref()
                        .is_some_and(|r| r.contains("l8db_fix_t"))),
                "{url}: {locks:?}"
            );
            assert!(
                locks.iter().any(|l| l.granted && l.pid > 0),
                "{url}: {locks:?}"
            );
            assert!(locks.len() <= 1000);
            holder.query_drop("ROLLBACK").await.unwrap();
            waiting.await.unwrap().unwrap();
            drop(holder);
            if mariadb {
                for sql in [
                    "DROP SEQUENCE IF EXISTS l8db_fix_seq",
                    "CREATE TABLE l8db_fix_ver (id INT PRIMARY KEY) WITH SYSTEM VERSIONING",
                    "CREATE SEQUENCE l8db_fix_seq START WITH 100 INCREMENT BY 5",
                ] {
                    adapter.exec(sql).await.unwrap();
                }
                let tables = adapter.list_tables(Some(&schema)).await.unwrap();
                assert!(tables.iter().any(|t| t.name == "l8db_fix_ver"), "{url}");
                assert_eq!(
                    adapter
                        .count_rows(&schema, "l8db_fix_ver", None, false)
                        .await
                        .unwrap(),
                    0
                );
                let sequences = adapter.list_sequences(Some(&schema)).await.unwrap();
                let seq = sequences.iter().find(|s| s.name == "l8db_fix_seq").unwrap();
                assert_eq!(
                    (seq.start_value.as_str(), seq.increment_by.as_str()),
                    ("100", "5")
                );
                adapter
                    .alter_sequence(
                        &schema,
                        "l8db_fix_seq",
                        &crate::db::AlterSequenceRequest {
                            increment_by: Some("7".into()),
                            min_value: None,
                            max_value: Some("".into()),
                            cycle: Some(false),
                            restart_with: Some("200".into()),
                        },
                    )
                    .await
                    .unwrap();
                assert_eq!(
                    live_scalar(&adapter, "SELECT NEXTVAL(l8db_fix_seq)").await,
                    "200"
                );
                assert!(adapter
                    .alter_sequence(
                        &schema,
                        "l8db_fix_seq",
                        &crate::db::AlterSequenceRequest {
                            increment_by: Some("1; DROP TABLE x".into()),
                            min_value: None,
                            max_value: None,
                            cycle: None,
                            restart_with: None,
                        },
                    )
                    .await
                    .is_err());
                let catalog = adapter
                    .schema_catalog(&schema, &["table".to_string()])
                    .await
                    .unwrap();
                assert!(catalog
                    .iter()
                    .any(|o| o.ddl.contains("l8db_fix_ver")
                        && o.ddl.ends_with("WITH SYSTEM VERSIONING")));
                adapter.exec("DROP SEQUENCE l8db_fix_seq").await.unwrap();
                adapter.exec("DROP TABLE l8db_fix_ver").await.unwrap();
            } else {
                assert!(adapter
                    .list_sequences(Some(&schema))
                    .await
                    .unwrap()
                    .is_empty());
            }
            for sql in [
                "DROP EVENT l8db_fix_ev",
                "DROP PROCEDURE l8db_fix_two",
                "DROP TABLE l8db_fix_t",
            ] {
                adapter.exec(sql).await.unwrap();
            }
        }
    }

    #[test]
    fn value_literals_do_not_depend_on_backslash_escapes() {
        assert_eq!(value_lit("it's"), "'it''s'");
        assert_eq!(value_lit("a\\b"), "_utf8mb4 X'615C62'");
    }

    #[test]
    fn view_replace_keeps_definer_security_and_check_option() {
        let create = "CREATE ALGORITHM=MERGE DEFINER=`bob`@`%` SQL SECURITY INVOKER VIEW `v` AS select 1 AS `x`";
        assert_eq!(
            replace_view_sql(create, "CASCADED", "app", "v", "SELECT 2 AS x;"),
            "CREATE OR REPLACE ALGORITHM=MERGE DEFINER=`bob`@`%` SQL SECURITY INVOKER VIEW `app`.`v` AS SELECT 2 AS x WITH CASCADED CHECK OPTION"
        );
        assert_eq!(
            replace_view_sql(create, "LOCAL", "app", "v", "SELECT 2 WITH LOCAL CHECK OPTION"),
            "CREATE OR REPLACE ALGORITHM=MERGE DEFINER=`bob`@`%` SQL SECURITY INVOKER VIEW `app`.`v` AS SELECT 2 WITH LOCAL CHECK OPTION"
        );
        assert_eq!(
            replace_view_sql("", "NONE", "app", "v", "SELECT 1"),
            "CREATE OR REPLACE VIEW `app`.`v` AS SELECT 1"
        );
    }

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
            using: None,
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
        assert_eq!(
            change(
                &generated,
                &AlterColumnRequest {
                    set_not_null: Some(false),
                    ..rename("v", "v")
                }
            ),
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

    async fn show_warnings_count(conn: &mut Conn) -> u64 {
        let row: (String, String) = conn
            .query_first("SHOW SESSION STATUS LIKE 'Com_show_warnings'")
            .await
            .unwrap()
            .unwrap();
        row.1.parse().unwrap()
    }

    #[tokio::test]
    #[ignore]
    async fn live_warnings_are_read_only_when_reported() {
        use crate::db::server_output::{capture, Messages};
        for url in live_urls() {
            let pool = create_pool_state();
            let adapter = MysqlAdapter::new(&url, None, pool.clone(), "output".into()).unwrap();
            let mut conn = adapter.open_conn().await.unwrap();
            let sink = Messages::default();
            let base = show_warnings_count(&mut conn).await;
            let mut plain = Vec::new();
            let mut captured = Vec::new();
            for round in 0..200 {
                let started = std::time::Instant::now();
                if round % 2 == 0 {
                    capture(sink.clone(), run_query(&mut conn, "SELECT 1 AS n"))
                        .await
                        .unwrap();
                    captured.push(started.elapsed().as_secs_f64() * 1000.0);
                } else {
                    run_query(&mut conn, "SELECT 1 AS n").await.unwrap();
                    plain.push(started.elapsed().as_secs_f64() * 1000.0);
                }
            }
            assert_eq!(show_warnings_count(&mut conn).await, base);
            assert!(sink.take().is_empty());
            plain.sort_by(f64::total_cmp);
            captured.sort_by(f64::total_cmp);
            eprintln!(
                "performance mysql-warning-capture: url_kind={} statements=200 show_warnings_round_trips=0 plain_median_ms={:.3} plain_p95_ms={:.3} captured_median_ms={:.3} captured_p95_ms={:.3}",
                if url.contains("maria") { "mariadb" } else { "mysql" },
                plain[50],
                plain[95],
                captured[50],
                captured[95]
            );

            capture(
                sink.clone(),
                run_query(&mut conn, "SELECT CAST('1x' AS SIGNED) AS n"),
            )
            .await
            .unwrap();
            assert_eq!(show_warnings_count(&mut conn).await, base + 1);
            let messages = sink.take();
            assert_eq!(messages.len(), 1, "{messages:?}");
            assert_eq!(messages[0].level, "WARNING");
            assert!(messages[0].message.contains("1x"), "{messages:?}");
            assert_eq!(messages[0].detail.as_deref(), Some("Code 1292"));

            capture(
                sink.clone(),
                run_query(&mut conn, "DROP TABLE IF EXISTS l8db_output_missing"),
            )
            .await
            .unwrap();
            let messages = sink.take();
            assert_eq!(messages[0].level, "NOTE", "{messages:?}");
            assert_eq!(messages[0].detail.as_deref(), Some("Code 1051"));

            let error = capture(
                sink.clone(),
                run_query(&mut conn, "SELECT * FROM l8db_output_missing"),
            )
            .await
            .unwrap_err();
            assert!(error.contains("1146"), "{error}");
            assert!(sink.take().is_empty());

            let before = show_warnings_count(&mut conn).await;
            run_query(&mut conn, "SELECT CAST('1x' AS SIGNED) AS n")
                .await
                .unwrap();
            assert_eq!(show_warnings_count(&mut conn).await, before);

            capture(
                crate::db::commands::output_sink(&url, None),
                adapter.execute_query("SELECT CAST('2x' AS SIGNED) AS n"),
            )
            .await
            .unwrap();
            let taken = crate::db::commands::take_output(
                crate::db::DatabaseKind::Mysql,
                &url,
                None,
                pool.clone(),
            )
            .await
            .unwrap();
            assert_eq!(taken.len(), 1, "{taken:?}");
            assert!(taken[0].message.contains("2x"));

            let tx = crate::db::transaction::create_transaction_state();
            let id = tx
                .begin(crate::db::DatabaseKind::Mysql, &url, None, &pool)
                .await
                .unwrap();
            tx.execute(&id, "SELECT CAST('3x' AS SIGNED) AS n")
                .await
                .unwrap();
            let output = tx.server_output(&id).await.unwrap();
            assert_eq!(output.len(), 1, "{output:?}");
            assert!(output[0].message.contains("3x"));
            tx.rollback(&id).await.unwrap();
        }
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
            let plan = adapter
                .explain_query("SELECT * FROM l8db_explain_analyze WHERE id = 1", true)
                .await
                .unwrap();
            let text = plan.as_str().unwrap_or_default();
            assert!(
                if mariadb {
                    text.contains("select_type") && text.contains("l8db_explain_analyze")
                } else {
                    text.contains("actual time")
                },
                "{url}: {plan}"
            );
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
                                using: None,
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
                                using: None,
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

    #[tokio::test]
    #[ignore]
    async fn live_script_sessions_keep_state_between_statements() {
        for url in live_urls() {
            let pool = create_pool_state();
            let adapter = MysqlAdapter::new(&url, None, pool, "script-session".into()).unwrap();
            for sql in [
                "DROP DATABASE IF EXISTS l8db_rv2_a",
                "DROP DATABASE IF EXISTS l8db_rv2_b",
                "CREATE DATABASE l8db_rv2_a",
                "CREATE DATABASE l8db_rv2_b",
                "CREATE TABLE l8db_rv2_a.t (id int)",
                "CREATE TABLE l8db_rv2_b.t (id int)",
                "INSERT INTO l8db_rv2_a.t VALUES (1)",
                "INSERT INTO l8db_rv2_b.t VALUES (2)",
            ] {
                adapter.execute_query(sql).await.expect(sql);
            }
            let step = |sql: &'static str| {
                crate::db::execution::with_session(
                    Some("script-a".into()),
                    adapter.execute_query(sql),
                )
            };
            step("USE l8db_rv2_a").await.unwrap();
            let busy = adapter.conn().await.unwrap();
            step("SET @x = 41").await.unwrap();
            step("CREATE TEMPORARY TABLE l8db_rv2_tmp (n int)")
                .await
                .unwrap();
            step("USE l8db_rv2_b").await.unwrap();
            step("TRUNCATE t").await.unwrap();
            assert!(step("SELECT * FROM missing_table").await.is_err());
            let x = step("SELECT @x + 1 AS x, DATABASE() AS db FROM l8db_rv2_a.l8db_rv2_tmp RIGHT JOIN (SELECT 1) one ON 1=1")
                .await
                .unwrap();
            drop(busy);
            assert_eq!(x.rows[0]["x"], 42);
            assert_eq!(x.rows[0]["db"], "l8db_rv2_b");
            assert_eq!(
                live_scalar(&adapter, "SELECT COUNT(*) FROM l8db_rv2_a.t").await,
                "1"
            );
            assert_eq!(
                live_scalar(&adapter, "SELECT COUNT(*) FROM l8db_rv2_b.t").await,
                "0"
            );
            assert!(adapter.execute_query("SELECT @x").await.unwrap().rows[0]["@x"].is_null());
            adapter
                .execute_query("DROP DATABASE l8db_rv2_a")
                .await
                .unwrap();
            adapter
                .execute_query("DROP DATABASE l8db_rv2_b")
                .await
                .unwrap();
        }
    }
}
