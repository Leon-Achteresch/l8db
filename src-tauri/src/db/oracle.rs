use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use oracle::sql_type::OracleType;
pub use oracle::Connection;
use oracle::{Connector, Row};

use super::pool::PoolState;
use super::{
    create_table_sql, rows_to_objects, where_clause, AddColumnRequest, AlterColumnRequest,
    ColumnInfo, ConstraintInfo, CreateTableRequest, DatabaseAdapter, DatabaseOverview,
    DetailedColumnInfo, ForeignKeyInfo, FunctionInfo, IndexInfo, QueryResult, SchemaSize,
    SequenceInfo, SessionInfo, TableData, TableInfo, TriggerInfo,
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
            Ok(Mutex::new(conn))
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

    async fn rows(&self, sql: String) -> Result<Vec<Row>, String> {
        self.run(move |c| fetch(c, &sql)).await
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
        let columns: Vec<String> = self
            .list_table_columns_detailed(schema, table)
            .await?
            .into_iter()
            .map(|c| c.name)
            .collect();
        let order_sql = match order_by {
            Some(col) if columns.iter().any(|c| c == col) => format!(
                " ORDER BY {} {}",
                quote(col),
                if order_desc { "DESC" } else { "ASC" }
            ),
            _ => String::new(),
        };
        let sql = format!(
            "SELECT {} FROM {}.{} t{}{} OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
            if is_view { "t.*" } else { ROWID_SELECT },
            quote(schema),
            quote(table),
            where_sql,
            order_sql,
            offset.max(0),
            limit.max(1)
        );
        let (cols, rows) = self.run(move |c| run_query(c, &sql)).await?;
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
        Ok(self.rows(sql).await?.first().map(|r| i(r, 0)).unwrap_or(0))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let statement = sql.trim().trim_end_matches(';').to_string();
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
        let sql = format!(
            "SELECT text FROM all_views WHERE owner = {} AND view_name = {}",
            lit(schema),
            lit(view)
        );
        self.rows(sql)
            .await?
            .first()
            .map(|r| s(r, 0))
            .ok_or_else(|| "View nicht gefunden".to_string())
    }

    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String> {
        if dry_run {
            return self
                .run({
                    let sql = format!("EXPLAIN PLAN FOR {body}");
                    move |c| c.execute(&sql, &[]).map(|_| ()).map_err(map_err)
                })
                .await;
        }
        self.exec(format!(
            "CREATE OR REPLACE VIEW {}.{} AS {}",
            quote(schema),
            quote(view),
            body
        ))
        .await
        .map(|_| ())
    }

    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let sql = format!("SELECT owner, object_name, object_type, status FROM all_objects WHERE object_type IN ('FUNCTION', 'PROCEDURE', 'PACKAGE') AND {} ORDER BY object_name", Self::owner_filter(schema, "owner"));
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
        let sql = format!("SELECT text FROM all_source WHERE owner = {} AND name = {} AND type = {} ORDER BY line", lit(parts[0]), lit(parts[1]), lit(parts[2]));
        let rows = self.rows(sql).await?;
        if rows.is_empty() {
            return Err("Quelltext nicht verfügbar".to_string());
        }
        Ok(rows.iter().map(|r| s(r, 0)).collect::<String>())
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
        let sql = format!("SELECT trigger_name, trigger_type, triggering_event, status, trigger_body FROM all_triggers WHERE table_owner = {} AND table_name = {} ORDER BY trigger_name", lit(schema), lit(table));
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| {
                let trigger_type = s(r, 1);
                TriggerInfo {
                    trigger_name: s(r, 0),
                    table_schema: schema.to_string(),
                    table_name: table.to_string(),
                    event: s(r, 2).trim().to_string(),
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
                    enabled: if s(r, 3) == "ENABLED" { "O" } else { "D" }.to_string(),
                    definition: s(r, 4),
                }
            })
            .collect())
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

#[cfg(test)]
mod tests {
    use super::*;

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
    let statement = sql.trim().trim_end_matches(';');
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
