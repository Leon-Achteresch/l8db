use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use oracle::sql_type::OracleType;
pub use oracle::Connection;
use oracle::{Connector, Row};

use super::pool::{BlockingPool, PoolState};
use super::server_output::ServerMessage;
use super::{
    create_table_sql, rows_to_objects, where_clause, AddColumnRequest, AlterColumnRequest,
    ColumnInfo, CompileErrorInfo, CompileResult, ConstraintInfo, CreateTableRequest,
    DatabaseAdapter, DatabaseOverview, DebugSessionInfo, DependencyInfo, DetailedColumnInfo,
    ForeignKeyInfo, FunctionInfo, IndexInfo, InvalidCompileOutcome, InvalidObjectInfo, QueryResult,
    SchedulerJobInfo, SchemaSize, SequenceInfo, SessionInfo, SynonymInfo, TableData, TableInfo,
    TriggerInfo,
};

pub struct OracleAdapter {
    user: String,
    password: String,
    connect_string: String,
    tcp: Option<(String, u16)>,
    pool_state: PoolState,
    key: String,
}

pub fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn view_create_script(
    owner: &str,
    name: &str,
    columns: &[String],
    bequeath: Option<&str>,
    text: &str,
) -> String {
    let mut out = format!(
        "CREATE OR REPLACE FORCE VIEW {}.{}",
        quote(owner),
        quote(name)
    );
    if !columns.is_empty() {
        out.push_str("\n(\n  ");
        out.push_str(
            &columns
                .iter()
                .map(|c| quote(c))
                .collect::<Vec<_>>()
                .join(",\n  "),
        );
        out.push_str("\n)");
    }
    if let Some(b) = bequeath {
        out.push_str("\nBEQUEATH ");
        out.push_str(b);
    }
    out.push_str("\nAS\n");
    out.push_str(text.trim().trim_end_matches(';').trim_end());
    out.push(';');
    out
}

fn view_select_body(ddl: &str) -> &str {
    let bytes = ddl.as_bytes();
    let (mut depth, mut quoted, mut i) = (0usize, false, 0usize);
    while i < bytes.len() {
        match bytes[i] {
            b'"' => quoted = !quoted,
            b'(' if !quoted => depth += 1,
            b')' if !quoted => depth = depth.saturating_sub(1),
            b'A' | b'a' if !quoted && depth == 0 => {
                let at_start = i == 0 || bytes[i - 1].is_ascii_whitespace() || bytes[i - 1] == b')';
                let is_as = bytes
                    .get(i + 1)
                    .is_some_and(|c| c.eq_ignore_ascii_case(&b'S'));
                let ends = bytes
                    .get(i + 2)
                    .is_none_or(|c| c.is_ascii_whitespace() || *c == b'(');
                if at_start && is_as && ends {
                    return ddl[i + 2..].trim_start();
                }
            }
            _ => {}
        }
        i += 1;
    }
    ddl
}

fn create_script(owner: &str, name: &str, object_type: &str, source: &str) -> String {
    let mut rest = source.trim_start();
    for word in object_type.split_whitespace() {
        let Some(after) = rest
            .get(..word.len())
            .filter(|head| head.eq_ignore_ascii_case(word))
            .map(|_| rest[word.len()..].trim_start())
        else {
            return format!("CREATE OR REPLACE {source}");
        };
        rest = after;
    }
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '(' || c == ';')
        .unwrap_or(rest.len());
    let head = &rest[..end];
    let is_name = head
        .rsplit('.')
        .next()
        .map(|n| n.trim_matches('"').eq_ignore_ascii_case(name))
        .unwrap_or(false);
    if !is_name {
        return format!("CREATE OR REPLACE {source}");
    }
    format!(
        "CREATE OR REPLACE {} {}.{}{}",
        object_type.to_uppercase(),
        quote(owner),
        quote(name),
        &rest[end..]
    )
}

fn map_err(e: oracle::Error) -> String {
    format!("Oracle: {e}")
}

const NLS_SESSION: &str = "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS' NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF' NLS_TIMESTAMP_TZ_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM'";
const ROWID_SELECT: &str = "ROWIDTOCHAR(t.ROWID) AS \"__ctid__\", t.*";

fn validate_rowid(rowid: &str) -> Result<&str, String> {
    let rowid = rowid.trim();
    let ok = !rowid.is_empty()
        && rowid.len() <= 4000
        && rowid
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'*'));
    if ok {
        Ok(rowid)
    } else {
        Err("Ungültige ROWID".to_string())
    }
}

fn is_query(sql: &str) -> bool {
    let first = sql.split_whitespace().next().unwrap_or("").to_uppercase();
    matches!(first.as_str(), "SELECT" | "WITH")
}

#[path = "oracle_sql.rs"]
mod sql;
use sql::prepare;

fn cell_json(row: &Row, index: usize, kind: &OracleType) -> serde_json::Value {
    let text: Option<String> = match row.get(index) {
        Ok(v) => v,
        Err(_) => return serde_json::Value::Null,
    };
    let Some(text) = text else {
        return serde_json::Value::Null;
    };
    match kind {
        OracleType::Number(..)
        | OracleType::Float(_)
        | OracleType::BinaryFloat
        | OracleType::BinaryDouble
        | OracleType::Int64
        | OracleType::UInt64 => {
            if let Ok(i) = text.parse::<i64>() {
                return serde_json::Value::from(i);
            }
            if let Ok(f) = text.parse::<f64>() {
                if let Some(n) = serde_json::Number::from_f64(f) {
                    return serde_json::Value::Number(n);
                }
            }
            serde_json::Value::String(text)
        }
        _ => serde_json::Value::String(text),
    }
}

fn s(row: &Row, index: usize) -> String {
    row.get::<usize, Option<String>>(index)
        .ok()
        .flatten()
        .unwrap_or_default()
}

fn s_opt(row: &Row, index: usize) -> Option<String> {
    row.get::<usize, Option<String>>(index)
        .ok()
        .flatten()
        .filter(|v| !v.is_empty())
}

fn i(row: &Row, index: usize) -> i64 {
    s(row, index).trim().parse().unwrap_or(0)
}

fn run_query(
    conn: &Connection,
    sql: &str,
) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>), String> {
    let rows = conn.query(sql, &[]).map_err(map_err)?;
    let info: Vec<(String, OracleType)> = rows
        .column_info()
        .iter()
        .map(|c| (c.name().to_string(), c.oracle_type().clone()))
        .collect();
    let mut out = Vec::new();
    for row in rows {
        let row = row.map_err(map_err)?;
        out.push(
            info.iter()
                .enumerate()
                .map(|(idx, (_, kind))| cell_json(&row, idx, kind))
                .collect(),
        );
    }
    Ok((info.into_iter().map(|(name, _)| name).collect(), out))
}

fn fetch(conn: &Connection, sql: &str) -> Result<Vec<Row>, String> {
    conn.query(sql, &[])
        .map_err(map_err)?
        .map(|r| r.map_err(map_err))
        .collect()
}

impl OracleAdapter {
    pub fn new(
        connection_string: &str,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige Oracle-URL".to_string())?;
        if url.scheme() != "oracle" {
            return Err(
                "Eine oracle:// URL ist erforderlich (oracle://user:pass@host:1521/service)"
                    .to_string(),
            );
        }
        let host = url.host_str().ok_or("Host fehlt")?.to_owned();
        let service = percent(url.path().trim_start_matches('/'));
        let mut connect_string = if service.is_empty() {
            String::new()
        } else {
            format!("//{host}:{}/{service}", url.port().unwrap_or(1521))
        };
        let mut from_override = false;
        for (k, v) in url.query_pairs() {
            if k == "connect_string" || k == "tns" {
                connect_string = v.into_owned();
                from_override = true;
            }
        }
        if connect_string.is_empty() {
            return Err("Service-Name fehlt in der URL".to_string());
        }
        let tcp = if from_override {
            ezconnect_endpoint(&connect_string)
        } else {
            Some((host, url.port().unwrap_or(1521)))
        };
        Ok(Self {
            user: percent(url.username()),
            password: percent(url.password().unwrap_or("")),
            connect_string,
            tcp,
            pool_state,
            key,
        })
    }

    async fn ensure_reachable(&self) -> Result<(), String> {
        let Some((host, port)) = self.tcp.clone() else {
            return Ok(());
        };
        let target = format!("{host}:{port}");
        tokio::time::timeout(
            std::time::Duration::from_secs(8),
            tokio::net::TcpStream::connect(target.as_str()),
        )
        .await
        .map_err(|_| {
            format!(
                "Oracle-Host {host}:{port} antwortet nicht (TCP-Timeout nach 8 s). Prüfe VPN, Firewall und Hostnamen."
            )
        })?
        .map_err(|e| {
            let detail = e.to_string();
            if detail.contains("lookup")
                || detail.contains("resolve")
                || detail.contains("nodename")
                || detail.contains("Name or service not known")
            {
                format!("Oracle-Host {host} kann nicht aufgelöst werden (DNS). Prüfe Hostnamen und VPN.")
            } else {
                format!("Oracle-Host {host}:{port} ist nicht erreichbar: {detail}")
            }
        })?;
        Ok(())
    }

    pub async fn open_connection(&self) -> Result<Mutex<Connection>, String> {
        self.open_raw().await.map(Mutex::new)
    }

    async fn open_raw(&self) -> Result<Connection, String> {
        ensure_client_lib();
        self.ensure_reachable().await?;
        let (user, password, connect_string) = (
            self.user.clone(),
            self.password.clone(),
            self.connect_string.clone(),
        );
        tokio::task::spawn_blocking(move || {
            let mut connector = Connector::new(&user, &password, &connect_string);
            if user.eq_ignore_ascii_case("sys") {
                connector.privilege(oracle::Privilege::Sysdba);
            }
            let mut conn = connector
                .connect()
                .map_err(|e| format!("Oracle-Verbindung fehlgeschlagen: {e}"))?;
            conn.set_autocommit(true);
            conn.execute(NLS_SESSION, &[])
                .map_err(|e| format!("Oracle-Sitzungsformat fehlgeschlagen: {e}"))?;
            Ok(conn)
        })
        .await
        .map_err(|e| format!("Oracle-Task fehlgeschlagen: {e}"))?
    }

    async fn conn(&self) -> Result<Arc<Mutex<Connection>>, String> {
        self.pool_state
            .shared(&self.key, || self.open_connection())
            .await
    }

    async fn run<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    {
        let conn = self.conn().await?;
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|_| "Oracle-Verbindung ist blockiert".to_string())?;
            f(&guard)
        })
        .await
        .map_err(|e| format!("Oracle-Task fehlgeschlagen: {e}"))?
    }

    async fn run_pooled<T, F>(&self, suffix: &str, capacity: usize, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    {
        let pool = self
            .pool_state
            .shared(&format!("{}#{suffix}", self.key), || async {
                Ok(BlockingPool::<Connection>::new(capacity))
            })
            .await?;
        pool.run(|| self.open_raw(), f).await
    }

    async fn run_meta<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    {
        self.run_pooled("meta", 3, f).await
    }

    async fn run_browse<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    {
        self.run_pooled("browse", 2, f).await
    }

    async fn rows(&self, sql: String) -> Result<Vec<Row>, String> {
        self.run_meta(move |c| fetch(c, &sql)).await
    }

    async fn source_script(
        &self,
        owner: &str,
        name: &str,
        object_type: &str,
    ) -> Result<String, String> {
        let sql = format!(
            "SELECT text FROM all_source WHERE owner = {} AND name = {} AND type = {} ORDER BY line",
            lit(owner),
            lit(name),
            lit(object_type)
        );
        let rows = self.rows(sql).await?;
        if rows.is_empty() {
            return Err("Quelltext nicht verfügbar".to_string());
        }
        let source = rows.iter().map(|r| s(r, 0)).collect::<String>();
        Ok(create_script(owner, name, object_type, &source))
    }

    async fn exec(&self, sql: String) -> Result<u64, String> {
        self.run(move |c| {
            c.execute(&sql, &[])
                .map_err(map_err)
                .and_then(|st| st.row_count().map_err(map_err))
        })
        .await
    }

    fn owner_filter(schema: Option<&str>, column: &str) -> String {
        match schema {
            Some(s) => format!("{column} = {}", lit(s)),
            None => format!("{column} = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')"),
        }
    }
}

fn percent(value: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", value.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| value.to_string())
}

fn ezconnect_endpoint(value: &str) -> Option<(String, u16)> {
    let rest = value.trim().strip_prefix("//").unwrap_or(value.trim());
    if rest.is_empty() || rest.starts_with('(') {
        return None;
    }
    let (head, service) = match rest.rfind('/') {
        Some(slash) => (&rest[..slash], rest[slash + 1..].trim()),
        None => {
            let mut parts = rest.split(':');
            match (parts.next(), parts.next(), parts.next(), parts.next()) {
                (Some(host), Some(port), Some(_), None) => {
                    return Some((host.trim().to_string(), port.trim().parse().ok()?));
                }
                _ => return None,
            }
        }
    };
    if head.trim().is_empty() || service.is_empty() {
        return None;
    }
    let (host, port) = match head.trim().rsplit_once(':') {
        Some((host, port)) => (host.trim(), port.trim().parse().ok()?),
        None => (head.trim(), 1521),
    };
    if host.is_empty() {
        return None;
    }
    Some((host.to_string(), port))
}

#[async_trait]
impl DatabaseAdapter for OracleAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        ensure_client_lib();
        oracle::Version::client()
            .map_err(|e| format!("Oracle Instant Client nicht gefunden: {e}"))?;
        self.rows("SELECT 1 FROM dual".to_string())
            .await
            .map(|_| ())
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SELECT SYS_CONTEXT('USERENV', 'DB_NAME') FROM dual".to_string())
            .await?
            .iter()
            .map(|r| s(r, 0))
            .collect())
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SELECT username FROM all_users WHERE oracle_maintained = 'N' OR username = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') ORDER BY username".to_string())
            .await?
            .iter()
            .map(|r| s(r, 0))
            .collect())
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let sql = format!(
            "SELECT owner, table_name FROM all_tables WHERE {} ORDER BY table_name",
            Self::owner_filter(schema, "owner")
        );
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: s(r, 0),
                name: s(r, 1),
            })
            .collect())
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let source = if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
            "all_views v ON v.owner = c.owner AND v.view_name = c.table_name"
        } else {
            "all_tables v ON v.owner = c.owner AND v.table_name = c.table_name"
        };
        let mut sql = format!("SELECT c.owner, c.table_name, c.column_name, c.data_type FROM all_tab_columns c JOIN {source} WHERE {}", Self::owner_filter(schema, "c.owner"));
        if let Some(t) = table {
            sql.push_str(&format!(" AND c.table_name = {}", lit(t)));
        }
        sql.push_str(" ORDER BY c.table_name, c.column_id");
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| ColumnInfo {
                schema: s(r, 0),
                table: s(r, 1),
                name: s(r, 2),
                data_type: s(r, 3),
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
        is_view: bool,
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let where_sql = where_clause(filter, allow_raw_filter)?;
        let (schema, table) = (schema.to_string(), table.to_string());
        let order_by = order_by.map(str::to_string);
        let (columns, cols, rows) = self
            .run_browse(move |c| {
                let columns = table_columns(c, &schema, &table, false)?;
                let order_sql = match order_by {
                    Some(col) if columns.iter().any(|c| *c == col) => format!(
                        " ORDER BY {} {}",
                        quote(&col),
                        if order_desc { "DESC" } else { "ASC" }
                    ),
                    _ => String::new(),
                };
                let sql = format!(
                    "SELECT {} FROM {}.{} t{}{} OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
                    if is_view { "t.*" } else { ROWID_SELECT },
                    quote(&schema),
                    quote(&table),
                    where_sql,
                    order_sql,
                    offset.max(0),
                    limit.max(1)
                );
                let (cols, rows) = run_query(c, &sql)?;
                Ok((columns, cols, rows))
            })
            .await?;
        Ok(TableData {
            columns: if columns.is_empty() {
                cols.clone()
            } else {
                columns
            },
            rows: rows_to_objects(&cols, rows),
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
            .run_browse(move |c| fetch(c, &sql))
            .await?
            .first()
            .map(|r| i(r, 0))
            .unwrap_or(0))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let statement = prepare(sql);
        if is_query(&statement) {
            let (columns, rows) = self.run(move |c| run_query(c, &statement)).await?;
            return Ok(QueryResult {
                rows: rows_to_objects(&columns, rows),
                columns,
                rows_affected: None,
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }
        let affected = self.exec(statement).await?;
        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            rows_affected: Some(affected),
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn execute_script(&self, sql: &str) -> Result<Vec<super::ScriptStatementResult>, String> {
        let mut results = Vec::new();
        for statement in sql::split_statements(sql) {
            let result = self.execute_query(&statement).await;
            results.push(super::ScriptStatementResult {
                statement,
                success: result.is_ok(),
                rows_affected: result.as_ref().ok().and_then(|r| r.rows_affected),
                error: result.err(),
            });
        }
        Ok(results)
    }

    async fn set_server_output(&self, enabled: bool) -> Result<(), String> {
        let sql = if enabled {
            "BEGIN DBMS_OUTPUT.ENABLE(NULL); END;"
        } else {
            "BEGIN DBMS_OUTPUT.DISABLE; END;"
        };
        self.run(move |c| c.execute(sql, &[]).map(|_| ()).map_err(map_err))
            .await
    }

    async fn take_server_output(&self) -> Result<Vec<ServerMessage>, String> {
        self.run(move |c| {
            let mut stmt = c
                .statement("BEGIN DBMS_OUTPUT.GET_LINE(:1, :2); END;")
                .build()
                .map_err(map_err)?;
            let mut lines = Vec::new();
            while lines.len() < 2000 {
                stmt.execute(&[&OracleType::Varchar2(32767), &OracleType::Int64])
                    .map_err(map_err)?;
                let status: i64 = stmt.bind_value(2).map_err(map_err)?;
                if status != 0 {
                    break;
                }
                let line: Option<String> = stmt.bind_value(1).map_err(map_err)?;
                lines.push(ServerMessage {
                    level: "OUTPUT".to_string(),
                    message: line.unwrap_or_default(),
                    detail: None,
                });
            }
            Ok(lines)
        })
        .await
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let sql = format!(
            "SELECT owner, view_name FROM all_views WHERE {} ORDER BY view_name",
            Self::owner_filter(schema, "owner")
        );
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: s(r, 0),
                name: s(r, 1),
            })
            .collect())
    }

    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let text = self
            .rows(format!(
                "SELECT text FROM all_views WHERE owner = {} AND view_name = {}",
                lit(schema),
                lit(view)
            ))
            .await?
            .first()
            .map(|r| s(r, 0))
            .ok_or_else(|| "View nicht gefunden".to_string())?;
        let columns: Vec<String> = self
            .rows(format!(
                "SELECT column_name FROM all_tab_columns WHERE owner = {} AND table_name = {} ORDER BY column_id",
                lit(schema),
                lit(view)
            ))
            .await?
            .iter()
            .map(|r| s(r, 0))
            .collect();
        let bequeath = self
            .rows(format!(
                "SELECT bequeath FROM all_views WHERE owner = {} AND view_name = {}",
                lit(schema),
                lit(view)
            ))
            .await
            .ok()
            .and_then(|rows| rows.first().map(|r| s(r, 0)))
            .filter(|b| !b.is_empty());
        Ok(view_create_script(
            schema,
            view,
            &columns,
            bequeath.as_deref(),
            &text,
        ))
    }

    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String> {
        let body = body.trim().trim_end_matches(';').trim_end();
        let is_ddl = body
            .get(..6)
            .is_some_and(|h| h.eq_ignore_ascii_case("create"));
        if dry_run {
            let select = if is_ddl { view_select_body(body) } else { body };
            let sql = format!("EXPLAIN PLAN FOR {select}");
            return self
                .run(move |c| c.execute(&sql, &[]).map(|_| ()).map_err(map_err))
                .await;
        }
        let ddl = if is_ddl {
            body.to_string()
        } else {
            format!(
                "CREATE OR REPLACE VIEW {}.{} AS {}",
                quote(schema),
                quote(view),
                body
            )
        };
        self.exec(ddl).await.map(|_| ())
    }

    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let sql = format!("SELECT owner, object_name, object_type, status FROM all_objects WHERE object_type IN ('FUNCTION', 'PACKAGE') AND {} ORDER BY object_name", Self::owner_filter(schema, "owner"));
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| FunctionInfo {
                oid: format!("{}\u{1f}{}\u{1f}{}", s(r, 0), s(r, 1), s(r, 2)),
                schema: s(r, 0),
                name: s(r, 1),
                identity_args: String::new(),
                return_type: s(r, 2),
                language: "PL/SQL".to_string(),
            })
            .collect())
    }

    async fn get_function_definition(&self, oid: &str) -> Result<String, String> {
        let parts: Vec<&str> = oid.split('\u{1f}').collect();
        if parts.len() != 3 {
            return Err("Ungültige Objektreferenz".to_string());
        }
        self.source_script(parts[0], parts[1], parts[2]).await
    }

    async fn list_procedures(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let sql = format!("SELECT owner, object_name, object_type, status FROM all_objects WHERE object_type = 'PROCEDURE' AND {} ORDER BY object_name", Self::owner_filter(schema, "owner"));
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| FunctionInfo {
                oid: format!("{}\u{1f}{}\u{1f}{}", s(r, 0), s(r, 1), s(r, 2)),
                schema: s(r, 0),
                name: s(r, 1),
                identity_args: String::new(),
                return_type: "PROCEDURE".to_string(),
                language: "PL/SQL".to_string(),
            })
            .collect())
    }

    async fn list_used_by(&self, schema: &str, name: &str) -> Result<Vec<DependencyInfo>, String> {
        let deps = self
            .rows(format!(
                "SELECT d.owner, d.name, d.type, NVL(o.status, 'UNKNOWN') \
                 FROM all_dependencies d \
                 LEFT JOIN all_objects o ON o.owner = d.owner AND o.object_name = d.name \
                   AND o.object_type = d.type \
                 WHERE d.referenced_owner = {} AND d.referenced_name = {} \
                 ORDER BY d.owner, d.type, d.name",
                lit(schema),
                lit(name)
            ))
            .await
            .map_err(|e| {
                format!("ALL_DEPENDENCIES ist nicht lesbar (fehlende Leserechte?): {e}")
            })?;
        let mut out: Vec<DependencyInfo> = deps
            .iter()
            .filter(|r| !(s(r, 0) == schema && s(r, 1) == name))
            .map(|r| DependencyInfo {
                owner: s(r, 0),
                name: s(r, 1),
                object_type: s(r, 2).to_lowercase(),
                status: s(r, 3),
                relation: "Abhängigkeit".to_string(),
                oid: format!("{}\u{1f}{}\u{1f}{}", s(r, 0), s(r, 1), s(r, 2)),
                detail: String::new(),
            })
            .collect();

        let fks = self
            .rows(format!(
                "SELECT c.owner, c.table_name, c.constraint_name, NVL(c.status, 'UNKNOWN') \
                 FROM all_constraints c \
                 JOIN all_constraints r ON r.owner = c.r_owner \
                   AND r.constraint_name = c.r_constraint_name \
                 WHERE c.constraint_type = 'R' AND r.owner = {} AND r.table_name = {} \
                 ORDER BY c.owner, c.table_name",
                lit(schema),
                lit(name)
            ))
            .await
            .unwrap_or_default();
        for r in fks.iter() {
            out.push(DependencyInfo {
                owner: s(r, 0),
                name: s(r, 1),
                object_type: "table".to_string(),
                status: s(r, 3),
                relation: "Fremdschlüssel".to_string(),
                oid: String::new(),
                detail: s(r, 2),
            });
        }
        Ok(out)
    }

    async fn list_synonyms(&self, schema: Option<&str>) -> Result<Vec<SynonymInfo>, String> {
        let rows = self
            .rows(format!(
                "SELECT s.owner, s.synonym_name, s.table_owner, s.table_name, s.db_link, \
                        NVL(o.object_type, 'UNKNOWN'), NVL(o.status, 'INVALID') \
                 FROM all_synonyms s \
                 LEFT JOIN all_objects o ON o.owner = s.table_owner \
                   AND o.object_name = s.table_name \
                 WHERE {} \
                 ORDER BY s.synonym_name",
                Self::owner_filter(schema, "s.owner")
            ))
            .await
            .map_err(|e| format!("ALL_SYNONYMS ist nicht lesbar (fehlende Leserechte?): {e}"))?;
        Ok(rows
            .iter()
            .map(|r| SynonymInfo {
                owner: s(r, 0),
                name: s(r, 1),
                target_owner: s(r, 2),
                target_name: s(r, 3),
                target_type: s(r, 5).to_lowercase(),
                db_link: s_opt(r, 4),
                status: s(r, 6),
            })
            .collect())
    }

    async fn list_scheduler_jobs(&self) -> Result<Vec<SchedulerJobInfo>, String> {
        let rows = self
            .rows(
                "SELECT j.owner, j.job_name, j.enabled, j.state, \
                        NVL(j.repeat_interval, NVL(j.schedule_name, ' ')), NVL(j.job_action, ' '), \
                        TO_CHAR(j.last_start_date, 'YYYY-MM-DD HH24:MI:SS'), \
                        TO_CHAR(j.next_run_date, 'YYYY-MM-DD HH24:MI:SS'), \
                        (SELECT status FROM (SELECT d.status FROM all_scheduler_job_run_details d \
                           WHERE d.owner = j.owner AND d.job_name = j.job_name \
                           ORDER BY d.log_date DESC) WHERE ROWNUM = 1), \
                        (SELECT additional_info FROM (SELECT d.additional_info FROM \
                           all_scheduler_job_run_details d \
                           WHERE d.owner = j.owner AND d.job_name = j.job_name \
                             AND d.status <> 'SUCCEEDED' \
                           ORDER BY d.log_date DESC) WHERE ROWNUM = 1) \
                 FROM all_scheduler_jobs j ORDER BY j.owner, j.job_name"
                    .to_string(),
            )
            .await
            .map_err(|e| {
                format!(
                    "Scheduler-Jobs sind nicht lesbar (Recht auf ALL_SCHEDULER_JOBS fehlt?): {e}"
                )
            })?;
        Ok(rows
            .iter()
            .map(|r| SchedulerJobInfo {
                id: format!("{}.{}", s(r, 0), s(r, 1)),
                owner: s(r, 0),
                name: s(r, 1),
                enabled: s(r, 2).eq_ignore_ascii_case("TRUE"),
                state: s(r, 3),
                schedule: s(r, 4).trim().to_string(),
                command: s(r, 5).trim().to_string(),
                last_run: s_opt(r, 6),
                last_status: s_opt(r, 8),
                last_error: s_opt(r, 9),
                next_run: s_opt(r, 7),
            })
            .collect())
    }

    async fn set_scheduler_job_enabled(&self, job_id: &str, enabled: bool) -> Result<(), String> {
        let action = if enabled { "ENABLE" } else { "DISABLE" };
        self.exec(format!(
            "BEGIN DBMS_SCHEDULER.{action}({}); END;",
            lit(job_id)
        ))
        .await
        .map(|_| ())
    }

    async fn run_scheduler_job(&self, job_id: &str) -> Result<(), String> {
        self.exec(format!(
            "BEGIN DBMS_SCHEDULER.RUN_JOB({}, FALSE); END;",
            lit(job_id)
        ))
        .await
        .map(|_| ())
    }

    async fn compile_object(&self, oid: &str, object_type: &str) -> Result<CompileResult, String> {
        let parts: Vec<&str> = oid.split('\u{1f}').collect();
        if parts.len() != 3 {
            return Err("Ungültige Objektreferenz".to_string());
        }
        let (owner, name) = (parts[0], parts[1]);
        let error_type = match parts[2].trim().to_uppercase() {
            t if !t.is_empty() => t,
            _ => match object_type {
                "package_spec" => "PACKAGE".to_string(),
                "package_body" => "PACKAGE BODY".to_string(),
                other => other.to_uppercase(),
            },
        };
        let (compile_kind, compile_part) = match error_type.as_str() {
            "PACKAGE" => ("PACKAGE", " SPECIFICATION"),
            "PACKAGE BODY" => ("PACKAGE", " BODY"),
            "TYPE BODY" => ("TYPE", " BODY"),
            "FUNCTION" | "PROCEDURE" | "TRIGGER" | "TYPE" | "VIEW" | "MATERIALIZED VIEW" => {
                (error_type.as_str(), "")
            }
            other => return Err(format!("Objekttyp {other} kann nicht kompiliert werden")),
        };
        let compile_error = self
            .exec(format!(
                "ALTER {} {}.{} COMPILE{}",
                compile_kind,
                quote(owner),
                quote(name),
                compile_part
            ))
            .await
            .err();
        let errors = self
            .rows(format!(
                "SELECT line, position, text FROM all_errors WHERE owner = {} AND name = {} AND type = {} ORDER BY sequence",
                lit(owner),
                lit(name),
                lit(&error_type)
            ))
            .await?;
        if errors.is_empty() {
            if let Some(message) = compile_error {
                return Err(message);
            }
            return Ok(CompileResult {
                status: "VALID".to_string(),
                message: None,
                line: None,
                position: None,
            });
        }
        let line = s(&errors[0], 0).parse::<i32>().ok();
        let position = s(&errors[0], 1).parse::<i32>().ok();
        let message = errors
            .iter()
            .map(|r| format!("Zeile {}, Spalte {}: {}", s(r, 0), s(r, 1), s(r, 2)))
            .collect::<Vec<_>>()
            .join("\n");
        Ok(CompileResult {
            status: "INVALID".to_string(),
            message: Some(message),
            line,
            position,
        })
    }

    async fn list_invalid_objects(
        &self,
        schema: Option<&str>,
    ) -> Result<Vec<InvalidObjectInfo>, String> {
        let sql = format!(
            "SELECT owner, object_name, object_type, status FROM all_objects WHERE status = 'INVALID' AND {} AND object_type IN ('FUNCTION','PROCEDURE','PACKAGE','PACKAGE BODY','TRIGGER','VIEW','MATERIALIZED VIEW','TYPE','TYPE BODY','SYNONYM') ORDER BY object_type, object_name",
            Self::owner_filter(schema, "owner")
        );
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| {
                let owner = s(r, 0);
                let name = s(r, 1);
                let object_type = s(r, 2);
                InvalidObjectInfo {
                    oid: format!("{owner}\u{1f}{name}\u{1f}{object_type}"),
                    schema: owner,
                    name,
                    object_type: object_type.clone(),
                    status: s(r, 3),
                }
            })
            .collect())
    }

    async fn list_compile_errors(
        &self,
        schema: Option<&str>,
    ) -> Result<Vec<CompileErrorInfo>, String> {
        let sql = format!(
            "SELECT owner, name, type, line, position, text FROM all_errors WHERE {} ORDER BY owner, name, type, sequence",
            Self::owner_filter(schema, "owner")
        );
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| CompileErrorInfo {
                schema: s(r, 0),
                name: s(r, 1),
                object_type: s(r, 2),
                line: s(r, 3).parse::<i32>().ok(),
                position: s(r, 4).parse::<i32>().ok(),
                message: s(r, 5),
            })
            .collect())
    }

    async fn compile_invalid_objects(
        &self,
        schema: Option<&str>,
    ) -> Result<Vec<InvalidCompileOutcome>, String> {
        let invalid = self.list_invalid_objects(schema).await?;
        let mut out = Vec::new();
        for item in invalid {
            if item.object_type.eq_ignore_ascii_case("SYNONYM") {
                out.push(InvalidCompileOutcome {
                    schema: item.schema,
                    name: item.name,
                    object_type: item.object_type,
                    oid: item.oid,
                    status: "INVALID".to_string(),
                    message: Some("Synonyme können nicht kompiliert werden".to_string()),
                    line: None,
                    position: None,
                });
                continue;
            }
            let object_arg = match item.object_type.to_uppercase().as_str() {
                "PACKAGE" => "package_spec",
                "PACKAGE BODY" => "package_body",
                "FUNCTION" => "function",
                "PROCEDURE" => "procedure",
                "TRIGGER" => "trigger",
                "VIEW" => "view",
                "MATERIALIZED VIEW" => "view",
                "TYPE" => "type",
                "TYPE BODY" => "type_body",
                _ => "routine",
            };
            match self.compile_object(&item.oid, object_arg).await {
                Ok(res) => out.push(InvalidCompileOutcome {
                    schema: item.schema,
                    name: item.name,
                    object_type: item.object_type,
                    oid: item.oid,
                    status: res.status,
                    message: res.message,
                    line: res.line,
                    position: res.position,
                }),
                Err(e) => out.push(InvalidCompileOutcome {
                    schema: item.schema,
                    name: item.name,
                    object_type: item.object_type,
                    oid: item.oid,
                    status: "INVALID".to_string(),
                    message: Some(e),
                    line: None,
                    position: None,
                }),
            }
        }
        Ok(out)
    }

    async fn start_debug_session(
        &self,
        oid: &str,
        object_type: &str,
    ) -> Result<DebugSessionInfo, String> {
        let _ = object_type;
        let parts: Vec<&str> = oid.split('\u{1f}').collect();
        if parts.len() != 3 {
            return Err("Ungültige Objektreferenz".to_string());
        }
        let privileges = self
            .rows(
                "SELECT privilege FROM session_privs WHERE privilege = 'DEBUG CONNECT SESSION'"
                    .to_string(),
            )
            .await?;
        if privileges.is_empty() {
            return Ok(DebugSessionInfo {
                available: false,
                message: "Keine Debug-Rechte: DEBUG CONNECT SESSION fehlt. Ohne dieses Recht ist keine Debug-Sitzung möglich; eine direkte Ausführung erfolgt nicht.".to_string(),
            });
        }
        Ok(DebugSessionInfo {
            available: false,
            message: format!(
                "Debug-Rechte vorhanden. Die schrittweise Ausführung von {}.{} über DBMS_DEBUG ist noch nicht verfügbar.",
                parts[0], parts[1]
            ),
        })
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(format!(
            "DROP TABLE {}.{} CASCADE CONSTRAINTS",
            quote(schema),
            quote(table)
        ))
        .await
        .map(|_| ())
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(format!("TRUNCATE TABLE {}.{}", quote(schema), quote(table)))
            .await
            .map(|_| ())
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let sql = format!(
            "SELECT c.column_name, c.data_type || CASE WHEN c.data_type IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR') THEN '(' || c.char_length || ')' WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL THEN '(' || c.data_precision || ',' || NVL(c.data_scale, 0) || ')' ELSE '' END, \
             c.nullable, c.data_default, c.column_id, c.char_length, \
             (SELECT COUNT(*) FROM all_constraints k JOIN all_cons_columns kc ON kc.owner = k.owner AND kc.constraint_name = k.constraint_name WHERE k.constraint_type = 'P' AND k.owner = c.owner AND k.table_name = c.table_name AND kc.column_name = c.column_name) \
             FROM all_tab_columns c WHERE c.owner = {} AND c.table_name = {} ORDER BY c.column_id",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| DetailedColumnInfo {
                name: s(r, 0),
                data_type: s(r, 1),
                is_nullable: s(r, 2) == "Y",
                column_default: s_opt(r, 3).map(|d| d.trim().to_string()),
                ordinal_position: i(r, 4) as i32,
                character_maximum_length: s_opt(r, 5)
                    .and_then(|v| v.parse().ok())
                    .filter(|v| *v > 0),
                is_primary_key: i(r, 6) > 0,
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
            "ALTER TABLE {}.{} ADD ({} {}",
            quote(schema),
            quote(table),
            quote(&column.name),
            column.data_type
        );
        if let Some(d) = column.default_value.as_deref().filter(|d| !d.is_empty()) {
            sql.push_str(&format!(" DEFAULT {d}"));
        }
        if !column.is_nullable {
            sql.push_str(" NOT NULL");
        }
        sql.push(')');
        self.exec(sql).await.map(|_| ())
    }

    async fn alter_column(
        &self,
        schema: &str,
        table: &str,
        changes: &AlterColumnRequest,
    ) -> Result<(), String> {
        let target = format!("{}.{}", quote(schema), quote(table));
        let mut modify = Vec::new();
        if let Some(t) = changes.data_type.as_deref().filter(|t| !t.is_empty()) {
            modify.push(t.to_string());
        }
        if changes.drop_default {
            modify.push("DEFAULT NULL".to_string());
        } else if let Some(d) = changes.new_default.as_deref().filter(|d| !d.is_empty()) {
            modify.push(format!("DEFAULT {d}"));
        }
        if let Some(not_null) = changes.set_not_null {
            modify.push(if not_null { "NOT NULL" } else { "NULL" }.to_string());
        }
        if !modify.is_empty() {
            self.exec(format!(
                "ALTER TABLE {target} MODIFY ({} {})",
                quote(&changes.old_name),
                modify.join(" ")
            ))
            .await?;
        }
        if let Some(new_name) = changes
            .new_name
            .as_deref()
            .filter(|n| !n.is_empty() && *n != changes.old_name)
        {
            self.exec(format!(
                "ALTER TABLE {target} RENAME COLUMN {} TO {}",
                quote(&changes.old_name),
                quote(new_name)
            ))
            .await?;
        }
        Ok(())
    }

    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String> {
        self.exec(format!(
            "ALTER TABLE {}.{} DROP COLUMN {}",
            quote(schema),
            quote(table),
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
            "SELECT c.constraint_name, c.owner, c.table_name, cc.column_name, r.owner, r.table_name, rc.column_name FROM all_constraints c \
             JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name \
             JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name \
             JOIN all_cons_columns rc ON rc.owner = r.owner AND rc.constraint_name = r.constraint_name AND rc.position = cc.position \
             WHERE c.constraint_type = 'R' AND c.owner = {} AND c.table_name = {} ORDER BY c.constraint_name, cc.position",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| ForeignKeyInfo {
                constraint_name: s(r, 0),
                from_schema: s(r, 1),
                from_table: s(r, 2),
                from_column: s(r, 3),
                to_schema: s(r, 4),
                to_table: s(r, 5),
                to_column: s(r, 6),
            })
            .collect())
    }

    async fn list_triggers(&self, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
        let sql = format!("SELECT trigger_name, trigger_type, triggering_event, status, trigger_body, owner FROM all_triggers WHERE table_owner = {} AND table_name = {} ORDER BY trigger_name", lit(schema), lit(table));
        let rows: Vec<Vec<String>> = self
            .rows(sql)
            .await?
            .iter()
            .map(|r| (0..6).map(|i| s(r, i)).collect())
            .collect();
        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let definition = self
                .source_script(&r[5], &r[0], "TRIGGER")
                .await
                .unwrap_or_else(|_| r[4].clone());
            let trigger_type = r[1].clone();
            out.push(TriggerInfo {
                trigger_name: r[0].clone(),
                table_schema: schema.to_string(),
                table_name: table.to_string(),
                event: r[2].trim().to_string(),
                timing: trigger_type
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_string(),
                orientation: if trigger_type.contains("EACH ROW") {
                    "ROW"
                } else {
                    "STATEMENT"
                }
                .to_string(),
                function_schema: String::new(),
                function_name: String::new(),
                enabled: if r[3] == "ENABLED" { "O" } else { "D" }.to_string(),
                definition,
            });
        }
        Ok(out)
    }

    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let sql = format!(
            "SELECT i.index_name, i.uniqueness, i.index_type, ic.column_name, (SELECT COUNT(*) FROM all_constraints k WHERE k.owner = i.owner AND k.index_name = i.index_name AND k.constraint_type = 'P') \
             FROM all_indexes i JOIN all_ind_columns ic ON ic.index_owner = i.owner AND ic.index_name = i.index_name WHERE i.table_owner = {} AND i.table_name = {} ORDER BY i.index_name, ic.column_position",
            lit(schema),
            lit(table)
        );
        let mut out: Vec<IndexInfo> = Vec::new();
        for r in self.rows(sql).await? {
            let name = s(&r, 0);
            let column = s(&r, 3);
            if let Some(existing) = out.iter_mut().find(|x| x.name == name) {
                existing.columns.push(column);
                continue;
            }
            out.push(IndexInfo {
                is_unique: s(&r, 1) == "UNIQUE",
                is_primary: i(&r, 4) > 0,
                index_type: s(&r, 2).to_lowercase(),
                columns: vec![column],
                definition: String::new(),
                name,
            });
        }
        for idx in &mut out {
            idx.definition = format!(
                "CREATE {}INDEX {} ON {}.{} ({})",
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
            "SELECT c.constraint_name, c.constraint_type, LISTAGG(cc.column_name, ',') WITHIN GROUP (ORDER BY cc.position), MAX(c.search_condition_vc) \
             FROM all_constraints c LEFT JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name \
             WHERE c.owner = {} AND c.table_name = {} GROUP BY c.constraint_name, c.constraint_type ORDER BY c.constraint_type, c.constraint_name",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| {
                let constraint_type = match s(r, 1).as_str() {
                    "P" => "PRIMARY KEY",
                    "U" => "UNIQUE",
                    "R" => "FOREIGN KEY",
                    "C" => "CHECK",
                    other => other,
                }
                .to_string();
                let columns: Vec<String> = s_opt(r, 2)
                    .map(|c| c.split(',').map(str::to_string).collect())
                    .unwrap_or_default();
                let definition = s_opt(r, 3)
                    .map(|check| format!("CHECK ({check})"))
                    .unwrap_or_else(|| format!("{constraint_type} ({})", columns.join(", ")));
                ConstraintInfo {
                    name: s(r, 0),
                    constraint_type,
                    columns,
                    definition,
                }
            })
            .collect())
    }

    async fn list_sequences(&self, schema: Option<&str>) -> Result<Vec<SequenceInfo>, String> {
        let sql = format!("SELECT sequence_owner, sequence_name, TO_CHAR(min_value), TO_CHAR(max_value), TO_CHAR(increment_by), cycle_flag, TO_CHAR(last_number) FROM all_sequences WHERE {} ORDER BY sequence_name", Self::owner_filter(schema, "sequence_owner"));
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| SequenceInfo {
                schema: s(r, 0),
                name: s(r, 1),
                data_type: "NUMBER".to_string(),
                start_value: s(r, 2),
                min_value: s(r, 2),
                max_value: s(r, 3),
                increment_by: s(r, 4),
                cycle: s(r, 5) == "Y",
                last_value: s_opt(r, 6),
            })
            .collect())
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        let sql = create_table_sql(req, quote, true).replacen("IF NOT EXISTS ", "", 1);
        match self.exec(sql).await {
            Ok(_) => Ok(()),
            Err(e) if req.if_not_exists && e.contains("ORA-00955") => Ok(()),
            Err(e) => Err(e),
        }
    }

    async fn explain_query(&self, sql: &str, _analyze: bool) -> Result<serde_json::Value, String> {
        let statement = sql.trim().trim_end_matches(';').to_string();
        self.run(move |c| {
            c.execute(&format!("EXPLAIN PLAN FOR {statement}"), &[])
                .map_err(map_err)?;
            let lines: Vec<String> = fetch(
                c,
                "SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY())",
            )?
            .iter()
            .map(|r| s(r, 0))
            .collect();
            Ok(serde_json::Value::String(lines.join("\n")))
        })
        .await
    }

    async fn list_sessions(&self) -> Result<Vec<SessionInfo>, String> {
        let sql = "SELECT s.sid, NVL(s.username, ''), NVL(s.program, ''), NVL(s.machine, ''), s.status, NVL(q.sql_text, ''), TO_CHAR(s.sql_exec_start, 'YYYY-MM-DD HH24:MI:SS'), NVL(s.event, ''), CASE WHEN s.sid = SYS_CONTEXT('USERENV', 'SID') THEN 1 ELSE 0 END, s.serial# \
                   FROM v$session s LEFT JOIN v$sql q ON q.sql_id = s.sql_id AND q.child_number = 0 WHERE s.type = 'USER' ORDER BY s.sid";
        Ok(self
            .rows(sql.to_string())
            .await?
            .iter()
            .map(|r| SessionInfo {
                pid: i(r, 0) as i32,
                user: s(r, 1),
                database: String::new(),
                application: s(r, 2),
                client_addr: s_opt(r, 3),
                state: s_opt(r, 4),
                query: s(r, 5),
                query_start: s_opt(r, 6),
                transaction_start: None,
                wait_event: s_opt(r, 7),
                is_self: i(r, 8) == 1,
                blocked_by: Vec::new(),
            })
            .collect())
    }

    async fn cancel_session(&self, pid: i32) -> Result<bool, String> {
        let serial = self
            .rows(format!("SELECT serial# FROM v$session WHERE sid = {pid}"))
            .await?
            .first()
            .map(|r| i(r, 0))
            .ok_or("Sitzung nicht gefunden")?;
        self.exec(format!("ALTER SYSTEM CANCEL SQL '{pid},{serial}'"))
            .await
            .map(|_| true)
    }

    async fn terminate_session(&self, pid: i32) -> Result<bool, String> {
        let serial = self
            .rows(format!("SELECT serial# FROM v$session WHERE sid = {pid}"))
            .await?
            .first()
            .map(|r| i(r, 0))
            .ok_or("Sitzung nicht gefunden")?;
        self.exec(format!(
            "ALTER SYSTEM KILL SESSION '{pid},{serial}' IMMEDIATE"
        ))
        .await
        .map(|_| true)
    }

    async fn create_schema(&self, name: &str) -> Result<(), String> {
        self.exec(format!("CREATE USER {} NO AUTHENTICATION", quote(name)))
            .await
            .map(|_| ())
    }

    async fn drop_schema(&self, name: &str, cascade: bool) -> Result<(), String> {
        self.exec(format!(
            "DROP USER {}{}",
            quote(name),
            if cascade { " CASCADE" } else { "" }
        ))
        .await
        .map(|_| ())
    }

    async fn get_database_overview(&self) -> Result<DatabaseOverview, String> {
        let database = self
            .list_databases()
            .await?
            .into_iter()
            .next()
            .unwrap_or_default();
        let tables = self
            .rows(
                "SELECT owner, COUNT(*) FROM all_tables GROUP BY owner ORDER BY owner".to_string(),
            )
            .await?;
        let sizes: Vec<(String, i64)> = self
            .rows("SELECT owner, SUM(bytes) FROM dba_segments GROUP BY owner".to_string())
            .await
            .unwrap_or_default()
            .iter()
            .map(|r| (s(r, 0), i(r, 1)))
            .collect();
        let schemas: Vec<SchemaSize> = tables
            .iter()
            .map(|r| {
                let schema = s(r, 0);
                let size_bytes = sizes
                    .iter()
                    .find(|(o, _)| *o == schema)
                    .map(|(_, b)| *b)
                    .unwrap_or(0);
                SchemaSize {
                    schema,
                    table_count: i(r, 1),
                    size_bytes,
                }
            })
            .collect();
        let size_bytes = schemas.iter().map(|x| x.size_bytes).sum();
        Ok(DatabaseOverview {
            database,
            size_bytes,
            size_pretty: super::pretty_bytes(size_bytes),
            schemas,
        })
    }
}

pub fn ensure_client_lib() {
    if oracle::InitParams::is_initialized() {
        return;
    }
    if let Some(dir) = find_client_lib_dir() {
        let mut params = oracle::InitParams::new();
        if let Ok(params) = params.oracle_client_lib_dir(dir) {
            let _ = params.init();
        }
    }
}

fn is_client_lib(file: &str) -> bool {
    if cfg!(target_os = "windows") {
        file.eq_ignore_ascii_case("oci.dll")
    } else if cfg!(target_os = "macos") {
        file == "libclntsh.dylib"
    } else {
        file.starts_with("libclntsh.so")
    }
}

fn has_client_lib(dir: &Path) -> bool {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .any(|e| is_client_lib(&e.file_name().to_string_lossy()))
        })
        .unwrap_or(false)
}

fn instant_client_dirs(parent: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(parent)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with("instantclient"))
                })
                .collect()
        })
        .unwrap_or_default();
    dirs.sort();
    dirs.reverse();
    dirs
}

fn client_lib_candidates() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = std::env::var_os("ORACLE_HOME") {
        dirs.push(PathBuf::from(&home).join("lib"));
        dirs.push(PathBuf::from(home));
    }
    let path_vars: &[&str] = if cfg!(target_os = "windows") {
        &["PATH"]
    } else if cfg!(target_os = "macos") {
        &["DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH"]
    } else {
        &["LD_LIBRARY_PATH"]
    };
    for var in path_vars {
        if let Some(paths) = std::env::var_os(var) {
            dirs.extend(std::env::split_paths(&paths));
        }
    }
    dirs.extend(["/opt/homebrew/lib", "/usr/local/lib"].map(PathBuf::from));
    if let Some(home) = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
    {
        dirs.push(home.join("lib"));
        dirs.extend(instant_client_dirs(&home));
        dirs.extend(instant_client_dirs(&home.join("Downloads")));
    }
    for parent in [
        "/opt/oracle",
        "/opt",
        "/usr/lib/oracle",
        "C:\\oracle",
        "C:\\",
    ] {
        dirs.extend(instant_client_dirs(Path::new(parent)));
    }
    dirs
}

pub fn find_client_lib_dir() -> Option<PathBuf> {
    find_client_lib_in(&client_lib_candidates())
}

fn find_client_lib_in(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|dir| has_client_lib(dir)).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_create_script_and_select_body() {
        let ddl = view_create_script(
            "ZEN",
            "V_X",
            &["REF".to_string(), "NAME".to_string()],
            Some("DEFINER"),
            "SELECT a.ref, (SELECT n FROM t WHERE x = 'AS') AS name FROM a\n",
        );
        assert_eq!(
            ddl,
            "CREATE OR REPLACE FORCE VIEW \"ZEN\".\"V_X\"\n(\n  \"REF\",\n  \"NAME\"\n)\nBEQUEATH DEFINER\nAS\nSELECT a.ref, (SELECT n FROM t WHERE x = 'AS') AS name FROM a;"
        );
        assert_eq!(
            view_select_body(ddl.trim_end_matches(';')),
            "SELECT a.ref, (SELECT n FROM t WHERE x = 'AS') AS name FROM a"
        );
        assert_eq!(
            view_select_body("CREATE OR REPLACE VIEW s.v AS SELECT 1 FROM dual"),
            "SELECT 1 FROM dual"
        );
    }

    #[test]
    fn create_script_prefixes_and_qualifies() {
        assert_eq!(
            create_script("DEV", "TEST_FUNKTION", "FUNCTION", "function test_funktion(p NUMBER) RETURN NUMBER IS\nBEGIN RETURN p; END;"),
            "CREATE OR REPLACE FUNCTION \"DEV\".\"TEST_FUNKTION\"(p NUMBER) RETURN NUMBER IS\nBEGIN RETURN p; END;"
        );
        assert_eq!(
            create_script(
                "DEV",
                "PKG",
                "PACKAGE BODY",
                "PACKAGE BODY \"PKG\" AS\nEND;"
            ),
            "CREATE OR REPLACE PACKAGE BODY \"DEV\".\"PKG\" AS\nEND;"
        );
        assert_eq!(
            create_script(
                "DEV",
                "P",
                "PROCEDURE",
                "PROCEDURE dev.p IS BEGIN NULL; END;"
            ),
            "CREATE OR REPLACE PROCEDURE \"DEV\".\"P\" IS BEGIN NULL; END;"
        );
        assert_eq!(
            create_script("DEV", "X", "FUNCTION", "irgendwas"),
            "CREATE OR REPLACE irgendwas"
        );
    }

    #[test]
    fn finds_client_lib_dir_in_candidates() {
        let dir = std::env::temp_dir().join(format!("l8db-oracle-{}", std::process::id()));
        let empty = dir.join("leer");
        std::fs::create_dir_all(&empty).unwrap();
        let name = if cfg!(target_os = "windows") {
            "oci.dll"
        } else if cfg!(target_os = "macos") {
            "libclntsh.dylib"
        } else {
            "libclntsh.so.21.1"
        };
        std::fs::write(dir.join(name), b"").unwrap();
        assert_eq!(
            find_client_lib_in(&[empty.clone(), dir.clone()]),
            Some(dir.clone())
        );
        assert_eq!(find_client_lib_in(&[empty]), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prepares_statements() {
        assert_eq!(prepare("SELECT 1 FROM DUAL;"), "SELECT 1 FROM DUAL");
        assert_eq!(
            prepare("SELECT 1 FROM DUAL; -- hinweis"),
            "SELECT 1 FROM DUAL"
        );
        assert_eq!(
            prepare("-- kopf\nSELECT 1 FROM DUAL;\n/* ende */\n"),
            "SELECT 1 FROM DUAL"
        );
        assert_eq!(prepare("SELECT ';' FROM DUAL;"), "SELECT ';' FROM DUAL");
        assert_eq!(
            prepare("SELECT 'it''s;' FROM DUAL;;"),
            "SELECT 'it''s;' FROM DUAL"
        );
        assert_eq!(prepare("BEGIN NULL; END;\n/\n"), "BEGIN NULL; END;");
        assert_eq!(prepare("begin null; end"), "begin null; end;");
        assert_eq!(
            prepare("CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;\n/"),
            "CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;"
        );
        assert_eq!(
            prepare("CREATE TABLE t (TYPE NUMBER);"),
            "CREATE TABLE t (TYPE NUMBER)"
        );
        assert_eq!(prepare("SELECT 4/2 FROM DUAL;"), "SELECT 4/2 FROM DUAL");
        assert!(is_query(&prepare("/* x */ SELECT 1 FROM DUAL")));
        assert_eq!(prepare("   "), "");
    }

    fn lenient<T>(what: &str, result: Result<T, String>, allowed: &[&str]) -> Option<T> {
        match result {
            Ok(v) => Some(v),
            Err(e) if allowed.iter().any(|code| e.contains(code)) => {
                eprintln!("{what}: übersprungen ({e})");
                None
            }
            Err(e) => panic!("{what}: {e}"),
        }
    }

    const NO_PRIV: &[&str] = &["ORA-01031", "ORA-27486", "ORA-01950", "ORA-00942"];

    #[tokio::test]
    #[ignore]
    async fn live_all_functions() {
        let Ok(url) = std::env::var("L8DB_SMOKE_ORACLE_URL") else {
            return;
        };
        let a =
            OracleAdapter::new(&url, crate::db::pool::create_pool_state(), "live".into()).unwrap();
        let a = &a;
        let q = |sql: &str| {
            let sql = sql.to_string();
            async move { a.execute_query(&sql).await }
        };
        let cleanup = [
            "DROP TRIGGER L8_LIVE_TRG",
            "DROP VIEW L8_LIVE_V",
            "DROP SYNONYM L8_LIVE_SYN",
            "DROP TABLE L8_LIVE_CHILD CASCADE CONSTRAINTS",
            "DROP TABLE L8_LIVE_PARENT CASCADE CONSTRAINTS",
            "DROP TABLE L8_LIVE_CT CASCADE CONSTRAINTS",
            "DROP SEQUENCE L8_LIVE_SEQ",
            "DROP PACKAGE L8_LIVE_PKG",
            "DROP PROCEDURE L8_LIVE_PROC",
            "DROP FUNCTION L8_LIVE_FN",
            "BEGIN DBMS_SCHEDULER.DROP_JOB('L8_LIVE_JOB', TRUE); END;",
            "DROP USER L8_LIVE_USR CASCADE",
        ];
        for sql in cleanup {
            let _ = q(sql).await;
        }

        a.test_connection().await.expect("test_connection");
        assert!(!a.list_databases().await.expect("list_databases").is_empty());
        let schema = q("SELECT USER AS U FROM dual;").await.expect("user").rows[0]["U"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(a
            .list_schemas()
            .await
            .expect("list_schemas")
            .contains(&schema));

        for sql in [
            "CREATE TABLE L8_LIVE_PARENT (ID NUMBER PRIMARY KEY, NAME VARCHAR2(50) NOT NULL, CREATED DATE DEFAULT SYSDATE)",
            "CREATE TABLE L8_LIVE_CHILD (ID NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, PARENT_ID NUMBER CONSTRAINT L8_LIVE_FK REFERENCES L8_LIVE_PARENT (ID), NOTE VARCHAR2(100), CONSTRAINT L8_LIVE_CHK CHECK (NOTE <> 'x'));",
            "CREATE INDEX L8_LIVE_IDX ON L8_LIVE_CHILD (NOTE, PARENT_ID)",
            "CREATE SEQUENCE L8_LIVE_SEQ",
            "CREATE OR REPLACE VIEW L8_LIVE_V AS SELECT ID, NAME FROM L8_LIVE_PARENT",
            "CREATE SYNONYM L8_LIVE_SYN FOR L8_LIVE_PARENT",
            "CREATE OR REPLACE TRIGGER L8_LIVE_TRG BEFORE INSERT ON L8_LIVE_PARENT FOR EACH ROW\nBEGIN\n  :NEW.NAME := UPPER(:NEW.NAME);\nEND;\n/\n",
            "-- Funktion\nCREATE OR REPLACE FUNCTION L8_LIVE_FN(p NUMBER) RETURN NUMBER IS\nBEGIN\n  RETURN p * 2;\nEND L8_LIVE_FN;\n/",
            "CREATE OR REPLACE PROCEDURE L8_LIVE_PROC(p OUT NUMBER) IS BEGIN p := L8_LIVE_FN(2); END;",
            "CREATE OR REPLACE PACKAGE L8_LIVE_PKG AS\n  FUNCTION f RETURN NUMBER;\n  PROCEDURE p;\nEND L8_LIVE_PKG;\n/",
            "CREATE OR REPLACE PACKAGE BODY L8_LIVE_PKG AS\n  FUNCTION f RETURN NUMBER IS BEGIN RETURN L8_LIVE_FN(1); END;\n  PROCEDURE p IS BEGIN NULL; END;\nEND L8_LIVE_PKG;\n/",
        ] {
            q(sql).await.unwrap_or_else(|e| panic!("{sql}: {e}"));
        }
        let ins = q("INSERT INTO L8_LIVE_PARENT (ID, NAME) VALUES (1, 'alpha');")
            .await
            .expect("insert");
        assert_eq!(ins.rows_affected, Some(1));
        q("INSERT INTO L8_LIVE_CHILD (PARENT_ID, NOTE) VALUES (1, 'n')")
            .await
            .expect("insert child");
        let sel = q("/* kopf */ SELECT NAME FROM L8_LIVE_PARENT; -- ende")
            .await
            .expect("select");
        assert_eq!(sel.rows[0]["NAME"], "ALPHA");

        a.set_server_output(true).await.expect("set_server_output");
        q("BEGIN\n  DBMS_OUTPUT.PUT_LINE('hallo');\nEND;\n/")
            .await
            .expect("plsql block");
        let out = a.take_server_output().await.expect("take_server_output");
        assert!(
            out.iter().any(|m| format!("{m:?}").contains("hallo")),
            "{out:?}"
        );
        a.set_server_output(false)
            .await
            .expect("set_server_output off");

        let fns = a
            .list_functions(Some(&schema))
            .await
            .expect("list_functions");
        let fn_oid = fns
            .iter()
            .find(|f| f.name == "L8_LIVE_FN")
            .expect("fn listed")
            .oid
            .clone();
        let pkg = fns
            .iter()
            .find(|f| f.name == "L8_LIVE_PKG")
            .expect("pkg listed");
        assert_eq!(pkg.return_type, "PACKAGE");
        assert!(!a
            .list_functions(None)
            .await
            .expect("list_functions default")
            .is_empty());
        let procs = a
            .list_procedures(Some(&schema))
            .await
            .expect("list_procedures");
        let proc_oid = procs
            .iter()
            .find(|f| f.name == "L8_LIVE_PROC")
            .expect("proc listed")
            .oid
            .clone();
        let spec_oid = format!("{schema}\u{1f}L8_LIVE_PKG\u{1f}PACKAGE");
        let body_oid = format!("{schema}\u{1f}L8_LIVE_PKG\u{1f}PACKAGE BODY");
        for oid in [&fn_oid, &proc_oid, &spec_oid, &body_oid] {
            assert!(!a
                .get_function_definition(oid)
                .await
                .expect("definition")
                .is_empty());
        }
        for (oid, kind) in [
            (&fn_oid, "function"),
            (&proc_oid, "procedure"),
            (&spec_oid, "package_spec"),
            (&body_oid, "package_body"),
            (&spec_oid, "function"),
        ] {
            let r = a
                .compile_object(oid, kind)
                .await
                .unwrap_or_else(|e| panic!("compile {kind}: {e}"));
            assert_eq!(r.status, "VALID", "{kind}: {:?}", r.message);
        }
        let _ = q("CREATE OR REPLACE PACKAGE BODY L8_LIVE_PKG AS\n  FUNCTION f RETURN NUMBER IS BEGIN RETURN gibt_es_nicht(1); END;\n  PROCEDURE p IS BEGIN NULL; END;\nEND L8_LIVE_PKG;\n/").await;
        let broken = a
            .compile_object(&body_oid, "package_body")
            .await
            .expect("compile broken body");
        assert_eq!(broken.status, "INVALID");
        assert!(broken.line.is_some());
        assert!(
            broken.message.as_deref().unwrap_or("").contains("PLS-"),
            "{:?}",
            broken.message
        );
        q("CREATE OR REPLACE PACKAGE BODY L8_LIVE_PKG AS\n  FUNCTION f RETURN NUMBER IS BEGIN RETURN L8_LIVE_FN(1); END;\n  PROCEDURE p IS BEGIN NULL; END;\nEND L8_LIVE_PKG;\n/").await.expect("restore body");
        assert_eq!(
            a.compile_object(&body_oid, "package_body")
                .await
                .unwrap()
                .status,
            "VALID"
        );

        let used = a
            .list_used_by(&schema, "L8_LIVE_FN")
            .await
            .expect("list_used_by");
        assert!(used.iter().any(|d| d.name == "L8_LIVE_PKG"), "{used:?}");
        let used = a
            .list_used_by(&schema, "L8_LIVE_PARENT")
            .await
            .expect("list_used_by table");
        assert!(
            used.iter()
                .any(|d| d.name == "L8_LIVE_CHILD" && d.relation == "Fremdschlüssel"),
            "{used:?}"
        );
        let syn = a.list_synonyms(Some(&schema)).await.expect("list_synonyms");
        assert!(
            syn.iter()
                .any(|s| s.name == "L8_LIVE_SYN" && s.target_type == "table"),
            "{syn:?}"
        );
        a.list_synonyms(None).await.expect("list_synonyms default");

        let views = a.list_views(Some(&schema)).await.expect("list_views");
        assert!(views.iter().any(|v| v.name == "L8_LIVE_V"));
        assert!(a
            .get_view_definition(&schema, "L8_LIVE_V")
            .await
            .expect("view def")
            .contains("L8_LIVE_PARENT"));
        a.update_view_definition(&schema, "L8_LIVE_V", "SELECT ID FROM L8_LIVE_PARENT", true)
            .await
            .expect("view dry run");
        a.update_view_definition(&schema, "L8_LIVE_V", "SELECT ID FROM L8_LIVE_PARENT", false)
            .await
            .expect("view update");
        assert!(!a
            .get_view_definition(&schema, "L8_LIVE_V")
            .await
            .unwrap()
            .contains("NAME"));

        let tables = a.list_tables(Some(&schema)).await.expect("list_tables");
        assert!(tables.iter().any(|t| t.name == "L8_LIVE_PARENT"));
        a.list_tables(None).await.expect("list_tables default");
        assert_eq!(
            a.list_columns(Some(&schema), Some("L8_LIVE_PARENT"), None)
                .await
                .expect("list_columns")
                .len(),
            3
        );
        assert_eq!(
            a.list_columns(Some(&schema), Some("L8_LIVE_V"), Some("view"))
                .await
                .expect("list_columns view")
                .len(),
            1
        );
        a.list_columns(None, None, None)
            .await
            .expect("list_columns all");
        let detailed = a
            .list_table_columns_detailed(&schema, "L8_LIVE_PARENT")
            .await
            .expect("detailed");
        assert!(detailed[0].is_primary_key);
        assert_eq!(detailed[1].data_type, "VARCHAR2(50)");
        assert_eq!(detailed[1].character_maximum_length, Some(50));
        assert_eq!(detailed[2].column_default.as_deref(), Some("SYSDATE"));

        let data = a
            .fetch_rows(
                &schema,
                "L8_LIVE_PARENT",
                Some("ID = 1"),
                10,
                0,
                Some("NAME"),
                true,
                false,
                true,
            )
            .await
            .expect("fetch_rows");
        assert_eq!(data.rows.len(), 1);
        assert!(data.rows[0]["__ctid__"].is_string());
        assert_eq!(data.columns, vec!["ID", "NAME", "CREATED"]);
        let data = a
            .fetch_rows(&schema, "L8_LIVE_V", None, 10, 0, None, false, true, false)
            .await
            .expect("fetch_rows view");
        assert_eq!(data.rows.len(), 1);
        assert_eq!(
            a.count_rows(&schema, "L8_LIVE_PARENT", Some("ID = 1"), true)
                .await
                .expect("count_rows"),
            1
        );
        assert_eq!(
            a.count_rows(&schema, "L8_LIVE_PARENT", None, false)
                .await
                .expect("count_rows plain"),
            1
        );

        a.add_column(
            &schema,
            "L8_LIVE_PARENT",
            &AddColumnRequest {
                name: "EXTRA".into(),
                data_type: "VARCHAR2(10)".into(),
                is_nullable: false,
                default_value: Some("'x'".into()),
            },
        )
        .await
        .expect("add_column");
        a.alter_column(
            &schema,
            "L8_LIVE_PARENT",
            &AlterColumnRequest {
                old_name: "EXTRA".into(),
                new_name: Some("EXTRA2".into()),
                data_type: Some("VARCHAR2(20)".into()),
                set_not_null: Some(false),
                new_default: Some("'y'".into()),
                drop_default: false,
            },
        )
        .await
        .expect("alter_column");
        a.alter_column(
            &schema,
            "L8_LIVE_PARENT",
            &AlterColumnRequest {
                old_name: "EXTRA2".into(),
                new_name: None,
                data_type: None,
                set_not_null: None,
                new_default: None,
                drop_default: true,
            },
        )
        .await
        .expect("alter_column drop default");
        a.drop_column(&schema, "L8_LIVE_PARENT", "EXTRA2")
            .await
            .expect("drop_column");
        assert_eq!(
            a.list_table_columns_detailed(&schema, "L8_LIVE_PARENT")
                .await
                .unwrap()
                .len(),
            3
        );

        let fks = a
            .list_foreign_keys(&schema, "L8_LIVE_CHILD")
            .await
            .expect("list_foreign_keys");
        assert_eq!(fks.len(), 1);
        assert_eq!(fks[0].to_table, "L8_LIVE_PARENT");
        let trg = a
            .list_triggers(&schema, "L8_LIVE_PARENT")
            .await
            .expect("list_triggers");
        assert_eq!(trg.len(), 1);
        assert_eq!(trg[0].timing, "BEFORE");
        assert_eq!(trg[0].orientation, "ROW");
        let idx = a
            .list_indexes(&schema, "L8_LIVE_CHILD")
            .await
            .expect("list_indexes");
        let composite = idx
            .iter()
            .find(|i| i.name == "L8_LIVE_IDX")
            .expect("index listed");
        assert_eq!(composite.columns, vec!["NOTE", "PARENT_ID"]);
        assert!(idx.iter().any(|i| i.is_primary));
        let cons = a
            .list_constraints(&schema, "L8_LIVE_CHILD")
            .await
            .expect("list_constraints");
        for kind in ["PRIMARY KEY", "FOREIGN KEY", "CHECK"] {
            assert!(
                cons.iter().any(|c| c.constraint_type == kind),
                "{kind}: {cons:?}"
            );
        }
        assert!(a
            .list_sequences(Some(&schema))
            .await
            .expect("list_sequences")
            .iter()
            .any(|s| s.name == "L8_LIVE_SEQ"));
        a.list_sequences(None)
            .await
            .expect("list_sequences default");

        let ct = CreateTableRequest {
            schema: schema.clone(),
            name: "L8_LIVE_CT".into(),
            columns: vec![
                super::super::ColumnDefinition {
                    name: "ID".into(),
                    data_type: "NUMBER".into(),
                    is_nullable: false,
                    default_value: None,
                    is_primary_key: true,
                    is_unique: false,
                },
                super::super::ColumnDefinition {
                    name: "NAME".into(),
                    data_type: "VARCHAR2(20)".into(),
                    is_nullable: false,
                    default_value: Some("'n'".into()),
                    is_primary_key: false,
                    is_unique: false,
                },
                super::super::ColumnDefinition {
                    name: "CODE".into(),
                    data_type: "VARCHAR2(5)".into(),
                    is_nullable: true,
                    default_value: None,
                    is_primary_key: false,
                    is_unique: true,
                },
            ],
            if_not_exists: true,
        };
        a.create_table(&ct).await.expect("create_table");
        a.create_table(&ct)
            .await
            .expect("create_table if_not_exists");
        a.truncate_table(&schema, "L8_LIVE_CT")
            .await
            .expect("truncate_table");
        a.drop_table(&schema, "L8_LIVE_CT")
            .await
            .expect("drop_table");

        let plan = a
            .explain_query("SELECT * FROM L8_LIVE_PARENT WHERE ID = 1;", false)
            .await
            .expect("explain_query");
        assert!(
            plan.as_str().unwrap_or("").contains("L8_LIVE_PARENT"),
            "{plan}"
        );

        if let Some(sessions) = lenient("list_sessions", a.list_sessions().await, NO_PRIV) {
            let me = sessions
                .iter()
                .find(|s| s.is_self)
                .expect("own session listed");
            lenient(
                "cancel_session",
                a.cancel_session(me.pid).await,
                &["ORA-01013", "ORA-00022", "ORA-01031"],
            );
            lenient(
                "terminate_session",
                a.terminate_session(me.pid).await,
                &["ORA-00027", "ORA-01031"],
            );
        }

        if lenient("create job", q("BEGIN DBMS_SCHEDULER.CREATE_JOB(job_name => 'L8_LIVE_JOB', job_type => 'PLSQL_BLOCK', job_action => 'BEGIN NULL; END;', start_date => SYSTIMESTAMP + INTERVAL '1' DAY, repeat_interval => 'FREQ=DAILY', enabled => FALSE); END;").await, NO_PRIV).is_some() {
            let jobs = a.list_scheduler_jobs().await.expect("list_scheduler_jobs");
            let job = jobs.iter().find(|j| j.name == "L8_LIVE_JOB").expect("job listed");
            assert!(!job.enabled);
            a.set_scheduler_job_enabled(&job.id, true).await.expect("enable job");
            a.set_scheduler_job_enabled(&job.id, false).await.expect("disable job");
            a.run_scheduler_job(&job.id).await.expect("run job");
            assert!(a.list_scheduler_jobs().await.unwrap().iter().any(|j| j.name == "L8_LIVE_JOB"));
        } else {
            lenient("list_scheduler_jobs", a.list_scheduler_jobs().await, NO_PRIV);
        }

        let dbg = a
            .start_debug_session(&proc_oid, "procedure")
            .await
            .expect("start_debug_session");
        assert!(!dbg.available);
        if lenient(
            "create_schema",
            a.create_schema("L8_LIVE_USR").await,
            NO_PRIV,
        )
        .is_some()
        {
            a.drop_schema("L8_LIVE_USR", true)
                .await
                .expect("drop_schema");
        }
        let overview = a
            .get_database_overview()
            .await
            .expect("get_database_overview");
        assert!(!overview.database.is_empty());
        assert!(overview.schemas.iter().any(|s| s.schema == schema));

        let script = a.execute_script("INSERT INTO L8_LIVE_PARENT (ID, NAME) VALUES (2, 'b'); SELECT COUNT(*) AS C FROM L8_LIVE_PARENT").await.expect("execute_script");
        assert!(script.iter().all(|r| r.success), "{script:?}");

        for sql in cleanup {
            let _ = q(sql).await;
        }
    }

    #[test]
    fn parses_url() {
        let a = OracleAdapter::new(
            "oracle://system:p%40ss@db.example.com:1522/FREEPDB1",
            crate::db::pool::create_pool_state(),
            "k".into(),
        )
        .unwrap();
        assert_eq!(a.connect_string, "//db.example.com:1522/FREEPDB1");
        assert_eq!(a.password, "p@ss");
        assert_eq!(a.tcp, Some(("db.example.com".to_string(), 1522)));
        assert!(OracleAdapter::new(
            "oracle://x@host",
            crate::db::pool::create_pool_state(),
            "k".into()
        )
        .is_err());
        let alias = OracleAdapter::new(
            "oracle://scott:tiger@ORCL/?connect_string=ORCL",
            crate::db::pool::create_pool_state(),
            "k".into(),
        )
        .unwrap();
        assert_eq!(alias.user, "scott");
        assert_eq!(alias.password, "tiger");
        assert_eq!(alias.connect_string, "ORCL");
        assert_eq!(alias.tcp, None);
        let corporate = OracleAdapter::new(
            "oracle://DEV_ACHTERESCH:XXX@csorastby.rzhit.win:1521/sltest.rzhit.win",
            crate::db::pool::create_pool_state(),
            "k".into(),
        )
        .unwrap();
        assert_eq!(
            corporate.connect_string,
            "//csorastby.rzhit.win:1521/sltest.rzhit.win"
        );
        assert_eq!(
            corporate.tcp,
            Some(("csorastby.rzhit.win".to_string(), 1521))
        );
        assert!(is_query("  with x as (select 1 from dual) select * from x"));
    }

    #[test]
    fn parses_ezconnect_endpoints() {
        assert_eq!(
            ezconnect_endpoint("//db.example.com:1521/ORCLPDB"),
            Some(("db.example.com".to_string(), 1521))
        );
        assert_eq!(
            ezconnect_endpoint("db.example.com/ORCLPDB"),
            Some(("db.example.com".to_string(), 1521))
        );
        assert_eq!(
            ezconnect_endpoint("db.example.com:1521:ORCL"),
            Some(("db.example.com".to_string(), 1521))
        );
        assert_eq!(ezconnect_endpoint("ORCL"), None);
        assert_eq!(
            ezconnect_endpoint("(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=h)(PORT=1521)))"),
            None
        );
        assert_eq!(ezconnect_endpoint("//db.example.com:99999/ORCLPDB"), None);
    }

    #[tokio::test]
    async fn unreachable_tcp_fails_fast() {
        let adapter = OracleAdapter::new(
            "oracle://scott:tiger@127.0.0.1:1/ORCL",
            crate::db::pool::create_pool_state(),
            "k".into(),
        )
        .unwrap();
        let error = adapter.ensure_reachable().await.unwrap_err();
        assert!(error.contains("127.0.0.1:1"), "{error}");
    }
}

fn table_columns(
    c: &Connection,
    schema: &str,
    table: &str,
    insertable: bool,
) -> Result<Vec<String>, String> {
    let extra = if insertable {
        " AND virtual_column = 'NO' AND identity_column = 'NO'"
    } else {
        ""
    };
    let sql = format!(
        "SELECT column_name FROM all_tab_cols WHERE owner = {} AND table_name = {} AND hidden_column = 'NO'{extra} ORDER BY column_id",
        lit(schema),
        lit(table)
    );
    Ok(fetch(c, &sql)?.iter().map(|r| s(r, 0)).collect())
}

fn row_by_rowid(
    c: &Connection,
    schema: &str,
    table: &str,
    rowid: &str,
) -> Result<serde_json::Value, String> {
    let sql = format!(
        "SELECT {ROWID_SELECT} FROM {}.{} t WHERE t.ROWID = CHARTOROWID({})",
        quote(schema),
        quote(table),
        lit(rowid)
    );
    let (cols, rows) = run_query(c, &sql)?;
    rows_to_objects(&cols, rows)
        .into_iter()
        .next()
        .ok_or_else(|| "Zeile nicht gefunden".to_string())
}

fn sql_value(value: &Option<String>) -> String {
    value
        .as_deref()
        .map(lit)
        .unwrap_or_else(|| "NULL".to_string())
}

pub fn tx_begin(c: &mut Connection) {
    c.set_autocommit(false);
}

pub fn tx_finish(c: &mut Connection, commit: bool) -> Result<(), String> {
    let result = if commit { c.commit() } else { c.rollback() };
    let _ = c.close();
    result.map_err(map_err)
}

pub fn tx_execute(c: &Connection, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let statement = prepare(sql);
    let statement = statement.as_str();
    if is_query(statement) {
        let (columns, rows) = run_query(c, statement)?;
        return Ok(QueryResult {
            rows: rows_to_objects(&columns, rows),
            columns,
            rows_affected: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
        });
    }
    let affected = c
        .execute(statement, &[])
        .map_err(map_err)
        .and_then(|st| st.row_count().map_err(map_err))?;
    Ok(QueryResult {
        columns: vec![],
        rows: vec![],
        rows_affected: Some(affected),
        execution_time_ms: start.elapsed().as_millis() as u64,
    })
}

pub fn tx_update_row(
    c: &Connection,
    schema: &str,
    table: &str,
    rowid: &str,
    updates: &std::collections::HashMap<String, Option<String>>,
) -> Result<String, String> {
    let rowid = validate_rowid(rowid)?;
    let valid = table_columns(c, schema, table, false)?;
    let mut set_parts = Vec::new();
    for (col, val) in updates {
        if !valid.contains(col) {
            return Err(format!("Unbekannte Spalte: {col}"));
        }
        set_parts.push(format!("{} = {}", quote(col), sql_value(val)));
    }
    if set_parts.is_empty() {
        return Ok(rowid.to_string());
    }
    let sql = format!(
        "UPDATE {}.{} SET {} WHERE ROWID = CHARTOROWID({})",
        quote(schema),
        quote(table),
        set_parts.join(", "),
        lit(rowid)
    );
    let affected = c
        .execute(&sql, &[])
        .map_err(map_err)
        .and_then(|st| st.row_count().map_err(map_err))?;
    if affected == 0 {
        return Err("Zeile nicht gefunden".to_string());
    }
    Ok(rowid.to_string())
}

pub fn tx_insert_row(
    c: &Connection,
    schema: &str,
    table: &str,
    values: &std::collections::HashMap<String, Option<String>>,
) -> Result<serde_json::Value, String> {
    let valid = table_columns(c, schema, table, false)?;
    let (cols, vals): (Vec<String>, Vec<String>) = if values.is_empty() {
        let first = valid.first().ok_or("Tabelle hat keine Spalten")?;
        (vec![quote(first)], vec!["DEFAULT".to_string()])
    } else {
        let mut cols = Vec::new();
        let mut vals = Vec::new();
        for (col, val) in values {
            if !valid.contains(col) {
                return Err(format!("Unbekannte Spalte: {col}"));
            }
            cols.push(quote(col));
            vals.push(sql_value(val));
        }
        (cols, vals)
    };
    let sql = format!(
        "INSERT INTO {}.{} ({}) VALUES ({}) RETURNING ROWIDTOCHAR(ROWID) INTO :rid",
        quote(schema),
        quote(table),
        cols.join(", "),
        vals.join(", ")
    );
    let stmt = c
        .execute(&sql, &[&OracleType::Varchar2(4000)])
        .map_err(map_err)?;
    let rowid: String = stmt
        .returned_values::<&str, String>("rid")
        .map_err(map_err)?
        .into_iter()
        .next()
        .ok_or_else(|| "Zeile konnte nicht eingefügt werden".to_string())?;
    row_by_rowid(c, schema, table, &rowid)
}

pub fn tx_duplicate_row(
    c: &Connection,
    schema: &str,
    table: &str,
    rowid: &str,
) -> Result<serde_json::Value, String> {
    let rowid = validate_rowid(rowid)?;
    let insertable = table_columns(c, schema, table, true)?;
    let source = row_by_rowid(c, schema, table, rowid)?;
    let values = source
        .as_object()
        .map(|obj| {
            obj.iter()
                .filter(|(k, _)| insertable.contains(k))
                .map(|(k, v)| {
                    let text = match v {
                        serde_json::Value::Null => None,
                        serde_json::Value::String(t) => Some(t.clone()),
                        other => Some(other.to_string()),
                    };
                    (k.clone(), text)
                })
                .collect()
        })
        .unwrap_or_default();
    tx_insert_row(c, schema, table, &values)
}

pub fn tx_delete_row(c: &Connection, schema: &str, table: &str, rowid: &str) -> Result<(), String> {
    let rowid = validate_rowid(rowid)?;
    let sql = format!(
        "DELETE FROM {}.{} WHERE ROWID = CHARTOROWID({})",
        quote(schema),
        quote(table),
        lit(rowid)
    );
    let affected = c
        .execute(&sql, &[])
        .map_err(map_err)
        .and_then(|st| st.row_count().map_err(map_err))?;
    if affected == 0 {
        return Err("Zeile nicht gefunden".to_string());
    }
    Ok(())
}
