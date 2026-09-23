use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use async_trait::async_trait;
use oracle::sql_type::OracleType;
pub use oracle::Connection;
use oracle::{Connector, Row};

use super::pool::{BlockingPool, PoolState, IDLE_CHECK_AFTER};
use super::server_output::ServerMessage;
use super::{
    create_table_sql, rows_to_objects, where_clause, AddColumnRequest, AlterColumnRequest,
    ColumnInfo, CompileErrorInfo, CompileResult, ConstraintInfo, CreateTableRequest,
    DatabaseAdapter, DatabaseOverview, DebugSessionInfo, DependencyInfo, DetailedColumnInfo,
    ForeignKeyInfo, FunctionInfo, IndexInfo, InvalidCompileOutcome, InvalidObjectInfo,
    ObjectGrantInfo, ProxyUserInfo, QueryResult, SchedulerJobInfo, SchemaSize, SequenceInfo,
    SessionInfo, SynonymInfo, TableData, TableInfo, TriggerInfo,
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

fn push_script(
    out: &mut Vec<(String, String)>,
    owner: &str,
    name: String,
    kind: &str,
    source: &str,
) {
    let script = create_script(owner, &name, kind, source);
    match out.iter_mut().find(|(n, _)| *n == name) {
        Some((_, existing)) => {
            existing.push_str("\n/\n\n");
            existing.push_str(&script);
        }
        None => out.push((name, script)),
    }
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

fn connect_sync(user: &str, password: &str, connect_string: &str) -> Result<Connection, String> {
    if !user.is_empty() && password.is_empty() {
        return Err("Oracle-Passwort fehlt: Die Verbindung wurde ohne Passwort aufgebaut. Bitte Passwort erneut eingeben.".to_string());
    }
    let mut connector = Connector::new(user, password, connect_string);
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
}

fn map_err(e: oracle::Error) -> String {
    format!("Oracle: {e}")
}

fn map_sql_err(e: oracle::Error, sql: &str) -> String {
    let offset = e.db_error().map_or(0, |db| db.offset() as usize);
    let message = map_err(e);
    if offset == 0 || offset > sql.len() || !sql.is_char_boundary(offset) {
        return message;
    }
    format!("{message}\nPosition: {}", sql[..offset].chars().count() + 1)
}

fn check_compile(c: &Connection, sql: &str) -> Result<(), String> {
    if c.last_warning().and_then(|w| w.oci_code()) != Some(24344) {
        return Ok(());
    }
    let Some((owner, name, kind)) = sql::created_object(sql) else {
        return Err("Oracle: ORA-24344: Objekt wurde mit Kompilierfehlern erstellt".to_string());
    };
    let owner = owner.map_or_else(
        || "SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')".to_string(),
        |o| lit(&o),
    );
    let rows = fetch(
        c,
        &format!(
            "SELECT line, position, attribute, text FROM all_errors WHERE owner = {owner} AND name = {} AND type = {} ORDER BY sequence",
            lit(&name),
            lit(&kind)
        ),
    )?;
    if !rows.iter().any(|r| s(r, 2) == "ERROR") {
        return Ok(());
    }
    let details = rows
        .iter()
        .map(|r| format!("Zeile {}, Spalte {}: {}", s(r, 0), s(r, 1), s(r, 3).trim()))
        .collect::<Vec<_>>()
        .join("\n");
    Err(format!(
        "Oracle: ORA-24344: {kind} {name} wurde mit Kompilierfehlern erstellt\n{details}"
    ))
}

const PARSE_ONLY: &str = "DECLARE c INTEGER := DBMS_SQL.OPEN_CURSOR; BEGIN BEGIN DBMS_SQL.PARSE(c, :1, DBMS_SQL.NATIVE); EXCEPTION WHEN OTHERS THEN :2 := SQLERRM; :3 := DBMS_SQL.LAST_ERROR_POSITION; END; DBMS_SQL.CLOSE_CURSOR(c); END;";

fn parse_only(c: &Connection, statement: &str) -> Result<(), String> {
    let word = sql::first_word(statement);
    match word.as_str() {
        "SELECT" | "WITH" | "(" | "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "BEGIN"
        | "DECLARE" | "CALL" => {}
        "COMMIT" | "ROLLBACK" | "SAVEPOINT" | "SET" => return Ok(()),
        _ => {
            return Err(format!(
                "Oracle kann {word}-Anweisungen nicht prüfen, ohne sie auszuführen. Prüfbar sind Abfragen, DML, PL/SQL-Blöcke sowie CREATE VIEW/FUNCTION/PROCEDURE/PACKAGE."
            ))
        }
    }
    let text = (0..=64)
        .find_map(|count| sql::bind_statement(statement, count).ok())
        .map_or_else(|| statement.to_string(), |(bound, _)| bound);
    let mut stmt = c.statement(PARSE_ONLY).build().map_err(map_err)?;
    stmt.execute(&[&text, &OracleType::Varchar2(4000), &OracleType::Int64])
        .map_err(map_err)?;
    let message: Option<String> = stmt.bind_value(2).map_err(map_err)?;
    let Some(message) = message else {
        return Ok(());
    };
    let offset: Option<i64> = stmt.bind_value(3).map_err(map_err)?;
    let offset = offset.unwrap_or(0).max(0) as usize;
    if offset == 0 || offset > text.len() || !text.is_char_boundary(offset) {
        return Err(format!("Oracle: {message}"));
    }
    Err(format!(
        "Oracle: {message}\nPosition: {}",
        text[..offset].chars().count() + 1
    ))
}

fn plan_statement(
    c: &Connection,
    statement: &str,
    plan: &mut Vec<sql::TempObject>,
) -> Result<(), String> {
    let Some(temp) = sql::temp_object(statement) else {
        return parse_only(c, statement);
    };
    let has_spec = plan
        .iter()
        .any(|p| p.kind == "PACKAGE" && p.target() == temp.target());
    if temp.kind == "PACKAGE BODY" && !has_spec {
        let owner = temp.owner.as_ref().map_or_else(
            || "SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')".to_string(),
            |o| lit(o),
        );
        let source: String = fetch(
            c,
            &format!(
                "SELECT text FROM all_source WHERE owner = {owner} AND name = {} AND type = 'PACKAGE' ORDER BY line",
                lit(&temp.name)
            ),
        )?
        .iter()
        .map(|r| s(r, 0))
        .collect();
        if source.is_empty() {
            return Err(format!(
                "Prüfen nicht möglich: Spezifikation des Packages {} nicht gefunden.",
                temp.name
            ));
        }
        let script = match &temp.owner {
            Some(o) => create_script(o, &temp.name, "PACKAGE", &source),
            None => format!("CREATE OR REPLACE {source}"),
        };
        let mut spec = sql::temp_object(&prepare(&script)).ok_or_else(|| {
            "Prüfen nicht möglich: Package-Spezifikation nicht lesbar".to_string()
        })?;
        spec.kind = "PACKAGE (gespeicherte Spezifikation)".to_string();
        plan.push(spec);
    }
    plan.push(temp);
    Ok(())
}

const TEMP_BLOCK_HEAD: &str = "DECLARE
  o CLOB;
  PROCEDURE note(i PLS_INTEGER, l NUMBER, p NUMBER, t VARCHAR2) IS
  BEGIN
    o := o || i || CHR(31) || l || CHR(31) || p || CHR(31) || t || CHR(30);
  END;
  PROCEDURE rm(stmt VARCHAR2, quiet BOOLEAN) IS
  BEGIN
    EXECUTE IMMEDIATE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLCODE NOT IN (-4043, -942) AND NOT quiet THEN note(-1, 0, 0, stmt || ': ' || SQLERRM); END IF;
  END;
  PROCEDURE mk(i PLS_INTEGER, stmt CLOB, own VARCHAR2, nam VARCHAR2, typ VARCHAR2) IS
  BEGIN
    BEGIN
      EXECUTE IMMEDIATE stmt;
    EXCEPTION WHEN OTHERS THEN
      IF SQLCODE <> -24344 THEN note(i, 0, 0, SQLERRM); END IF;
    END;
    FOR e IN (SELECT line, position, text FROM all_errors
              WHERE owner = NVL(own, SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'))
                AND name = nam AND type = typ AND attribute = 'ERROR' ORDER BY sequence) LOOP
      note(i, e.line, e.position, e.text);
    END LOOP;
  END;
";

fn run_temps(c: &Connection, plan: &[sql::TempObject]) -> Result<(), String> {
    if plan.is_empty() {
        return Ok(());
    }
    let mut map: Vec<(String, String)> = Vec::new();
    for temp in plan.iter().filter(|t| t.kind.starts_with("PACKAGE")) {
        if map.iter().any(|(from, _)| *from == temp.name) {
            continue;
        }
        let owner = temp.owner.as_ref().map_or_else(
            || "SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')".to_string(),
            |o| lit(o),
        );
        let name = lit(&temp.name);
        let shadowed = !fetch(
            c,
            &format!(
                "SELECT 1 FROM all_objects WHERE owner IN ({owner}, 'PUBLIC') AND object_name = {name} AND object_type IN ('TABLE', 'VIEW', 'SYNONYM', 'MATERIALIZED VIEW') UNION ALL SELECT 1 FROM all_users WHERE username = {name}"
            ),
        )?
        .is_empty();
        if !shadowed {
            map.push((temp.name.clone(), temp.temp_name.clone()));
        }
    }
    let statements: Vec<String> = plan
        .iter()
        .map(|t| sql::rewrite_qualifiers(&t.sql, &map))
        .collect();
    let mut drops: Vec<String> = Vec::new();
    let mut owners: Vec<String> = vec!["SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')".to_string()];
    for temp in plan {
        let kind = if temp.kind.starts_with("PACKAGE") {
            "PACKAGE"
        } else {
            temp.kind.as_str()
        };
        let drop = lit(&format!("DROP {kind} {}", temp.target()));
        if !drops.contains(&drop) {
            drops.push(drop);
        }
        if let Some(owner) = temp.owner.as_ref().map(|o| lit(o)) {
            if !owners.contains(&owner) {
                owners.push(owner);
            }
        }
    }
    let cleanup: String = drops
        .iter()
        .rev()
        .map(|drop| format!("    rm({drop}, FALSE);\n"))
        .collect();
    let creates: String = plan
        .iter()
        .enumerate()
        .map(|(i, temp)| {
            let kind = if temp.kind.starts_with("PACKAGE (") {
                "PACKAGE"
            } else {
                temp.kind.as_str()
            };
            format!(
                "    mk({i}, :s{i}, {}, {}, {});\n",
                temp.owner.as_ref().map_or("NULL".to_string(), |o| lit(o)),
                lit(&temp.temp_name),
                lit(kind)
            )
        })
        .collect();
    let block = format!(
        "{TEMP_BLOCK_HEAD}  PROCEDURE cleanup IS
  BEGIN
{cleanup}  END;
BEGIN
  FOR x IN (SELECT owner, object_name, object_type FROM all_objects
            WHERE owner IN ({}) AND object_name LIKE '%\\_L8DB\\_TEMP' ESCAPE '\\'
              AND object_type IN ('VIEW', 'FUNCTION', 'PROCEDURE', 'PACKAGE')
              AND last_ddl_time < SYSDATE - 10 / 1440) LOOP
    rm('DROP ' || x.object_type || ' \"' || x.owner || '\".\"' || x.object_name || '\"', TRUE);
  END LOOP;
  cleanup;
  o := NULL;
  BEGIN
{creates}  EXCEPTION WHEN OTHERS THEN
    cleanup;
    RAISE;
  END;
  cleanup;
  :result := o;
END;",
        owners.join(", ")
    );
    let mut stmt = c.statement(&block).build().map_err(map_err)?;
    for (i, statement) in statements.iter().enumerate() {
        stmt.bind(format!("s{i}").as_str(), statement)
            .map_err(map_err)?;
    }
    stmt.bind("result", &OracleType::CLOB).map_err(map_err)?;
    stmt.execute(&[]).map_err(map_err)?;
    let output: Option<String> = stmt.bind_value("result").map_err(map_err)?;
    let mut messages: Vec<String> = Vec::new();
    let mut last = None;
    for record in output.unwrap_or_default().split('\u{1e}') {
        let fields: Vec<&str> = record.splitn(4, '\u{1f}').collect();
        let [index, line, position, text] = fields[..] else {
            continue;
        };
        let text = text.trim();
        let Some(temp) = index.parse::<usize>().ok().and_then(|i| plan.get(i)) else {
            messages.push(format!(
                "Temporäres Prüfobjekt konnte nicht gelöscht werden, bitte manuell entfernen: {text}"
            ));
            continue;
        };
        if last != Some(index) {
            last = Some(index);
            messages.push(format!(
                "Oracle: {} {} enthält Fehler",
                temp.kind, temp.name
            ));
        }
        let text = plan
            .iter()
            .fold(text.to_string(), |t, p| t.replace(&p.temp_name, &p.name));
        messages.push(if line == "0" {
            text
        } else {
            format!("Zeile {line}, Spalte {position}: {text}")
        });
    }
    if messages.is_empty() {
        Ok(())
    } else {
        Err(messages.join("\n"))
    }
}

fn caller_label(owner: &str, name: &str, kind: &str) -> String {
    format!("Aufrufer {owner}.{name} ({kind})")
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
    run_query_named(conn, sql, &[])
}

fn run_query_named(
    conn: &Connection,
    sql: &str,
    params: &[(&str, &dyn oracle::sql_type::ToSql)],
) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>), String> {
    let rows = conn
        .query_named(sql, params)
        .map_err(|e| map_sql_err(e, sql))?;
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
    Ok((
        super::unique_column_names(info.into_iter().map(|(name, _)| name).collect()),
        out,
    ))
}

fn fetch(conn: &Connection, sql: &str) -> Result<Vec<Row>, String> {
    let mut stmt = conn
        .statement(sql)
        .fetch_array_size(1000)
        .build()
        .map_err(map_err)?;
    let rows = stmt
        .query(&[])
        .map_err(map_err)?
        .map(|r| r.map_err(map_err))
        .collect::<Result<Vec<Row>, String>>()?;
    Ok(rows)
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
            user: match super::connection::proxy_user(&url) {
                Some(target) => format!("{}[{target}]", percent(url.username())),
                None => percent(url.username()),
            },
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
            super::execution::connection_duration(),
            tokio::net::TcpStream::connect(target.as_str()),
        )
        .await
        .map_err(|_| {
            format!(
                "Oracle-Host {host}:{port} antwortet nicht (TCP-Timeout). Prüfe VPN, Firewall und Hostnamen."
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
        tokio::task::spawn_blocking(move || connect_sync(&user, &password, &connect_string))
            .await
            .map_err(|e| format!("Oracle-Task fehlgeschlagen: {e}"))?
    }

    async fn conn(&self) -> Result<Arc<Mutex<(Connection, Instant)>>, String> {
        self.pool_state
            .shared(&self.key, || async {
                Ok(Mutex::new((self.open_raw().await?, Instant::now())))
            })
            .await
    }

    async fn run<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    {
        let conn = self.conn().await?;
        let (user, password, connect_string) = (
            self.user.clone(),
            self.password.clone(),
            self.connect_string.clone(),
        );
        tokio::task::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|_| "Oracle-Verbindung ist blockiert".to_string())?;
            if guard.1.elapsed() > IDLE_CHECK_AFTER && guard.0.ping().is_err() {
                guard.0 = connect_sync(&user, &password, &connect_string)?;
            }
            let result = f(&guard.0);
            guard.1 = Instant::now();
            result
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
        pool.run(|| self.open_raw(), |c| c.ping().is_ok(), f).await
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

    async fn schema_copy_definitions(
        &self,
        schema: &str,
        object_type: &str,
    ) -> Result<Vec<(String, String)>, String> {
        let owner = lit(schema);
        match object_type {
            "table" => {
                let sql = format!(
                    "SELECT c.table_name, LISTAGG(c.column_name || ' ' || c.data_type || CASE WHEN c.nullable = 'N' THEN ' NOT NULL' ELSE '' END, CHR(10) ON OVERFLOW TRUNCATE) WITHIN GROUP (ORDER BY c.column_id) \
                     FROM all_tab_columns c JOIN all_tables t ON t.owner = c.owner AND t.table_name = c.table_name \
                     WHERE c.owner = {owner} GROUP BY c.table_name ORDER BY c.table_name"
                );
                Ok(self
                    .rows(sql)
                    .await?
                    .iter()
                    .map(|r| (s(r, 0), s(r, 1)))
                    .collect())
            }
            "view" => {
                let sql = format!(
                    "SELECT view_name, text FROM all_views WHERE owner = {owner} ORDER BY view_name"
                );
                Ok(self
                    .rows(sql)
                    .await?
                    .iter()
                    .map(|r| (s(r, 0), s(r, 1)))
                    .collect())
            }
            "routine" | "package" => {
                let types = if object_type == "package" {
                    "('PACKAGE', 'PACKAGE BODY')"
                } else {
                    "('FUNCTION', 'PROCEDURE')"
                };
                let sql = format!(
                    "SELECT name, type, text FROM all_source WHERE owner = {owner} AND type IN {types} ORDER BY name, type, line"
                );
                let mut out: Vec<(String, String)> = Vec::new();
                let mut current: Option<(String, String, String)> = None;
                for r in self.rows(sql).await?.iter() {
                    let (name, kind, text) = (s(r, 0), s(r, 1), s(r, 2));
                    match current.as_mut() {
                        Some((n, k, buf)) if *n == name && *k == kind => buf.push_str(&text),
                        _ => {
                            if let Some((n, k, buf)) = current.take() {
                                push_script(&mut out, schema, n, &k, &buf);
                            }
                            current = Some((name, kind, text));
                        }
                    }
                }
                if let Some((n, k, buf)) = current.take() {
                    push_script(&mut out, schema, n, &k, &buf);
                }
                Ok(out)
            }
            other => Err(format!("Unbekannter Objekttyp: {other}")),
        }
    }

    async fn schema_copy_statements(
        &self,
        source_schema: &str,
        target_schema: &str,
        object_type: &str,
        name: &str,
    ) -> Result<Vec<String>, String> {
        if source_schema.is_empty() || target_schema.is_empty() {
            return Err("Quell- und Zielschema müssen gewählt sein.".to_string());
        }
        let requalify = |sql: String| super::requalify_schema(&sql, source_schema, target_schema);
        match object_type {
            "table" => {
                let columns = self
                    .list_table_columns_detailed(source_schema, name)
                    .await?;
                if columns.is_empty() {
                    return Err(format!(
                        "Tabelle {source_schema}.{name} hat keine Spalten oder existiert nicht."
                    ));
                }
                let req = CreateTableRequest {
                    schema: target_schema.to_string(),
                    name: name.to_string(),
                    if_not_exists: false,
                    columns: columns
                        .iter()
                        .map(|c| super::ColumnDefinition {
                            name: c.name.clone(),
                            data_type: c.data_type.clone(),
                            is_nullable: c.is_nullable,
                            default_value: c.column_default.clone().map(&requalify),
                            is_primary_key: c.is_primary_key,
                            is_unique: false,
                        })
                        .collect(),
                };
                Ok(vec![create_table_sql(&req, quote, true)])
            }
            "view" => Ok(vec![requalify(
                self.get_view_definition(source_schema, name).await?,
            )]),
            "routine" => {
                let kind = self
                    .rows(format!(
                        "SELECT object_type FROM all_objects WHERE owner = {} AND object_name = {} AND object_type IN ('FUNCTION', 'PROCEDURE')",
                        lit(source_schema),
                        lit(name)
                    ))
                    .await?
                    .first()
                    .map(|r| s(r, 0))
                    .ok_or_else(|| format!("Routine {source_schema}.{name} nicht gefunden."))?;
                Ok(vec![requalify(
                    self.source_script(source_schema, name, &kind).await?,
                )])
            }
            "package" => {
                let mut out = vec![requalify(
                    self.source_script(source_schema, name, "PACKAGE").await?,
                )];
                if let Ok(body) = self
                    .source_script(source_schema, name, "PACKAGE BODY")
                    .await
                {
                    out.push(requalify(body));
                }
                Ok(out)
            }
            other => Err(format!("Unbekannter Objekttyp: {other}")),
        }
    }

    async fn exec(&self, sql: String) -> Result<u64, String> {
        self.run(move |c| {
            let count = c
                .execute(&sql, &[])
                .map_err(|e| map_sql_err(e, &sql))
                .and_then(|st| st.row_count().map_err(map_err))?;
            check_compile(c, &sql)?;
            Ok(count)
        })
        .await
    }

    fn objects_source(&self, schema: Option<&str>) -> String {
        let own = self
            .user
            .split_once('[')
            .map_or(self.user.as_str(), |(_, target)| {
                target.trim_end_matches(']')
            });
        match schema {
            Some(s) if !s.eq_ignore_ascii_case(own) => format!(
                "(SELECT owner, object_name, object_type, status FROM all_objects WHERE owner = {})",
                lit(s)
            ),
            _ => "(SELECT USER AS owner, object_name, object_type, status FROM user_objects)"
                .to_string(),
        }
    }

    fn owner_filter(schema: Option<&str>, column: &str) -> String {
        match schema {
            Some(s) => format!("{column} = {}", lit(s)),
            None => format!("{column} = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')"),
        }
    }

    async fn compile_one(&self, oid: &str, object_type: &str) -> Result<CompileResult, String> {
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

    async fn caller_impact(&self, owner: &str, name: &str) -> Result<Vec<String>, String> {
        let deps = self
            .rows(format!(
                "SELECT * FROM (SELECT d.owner, d.name, d.type FROM all_dependencies d \
                 WHERE d.referenced_owner = {} AND d.referenced_name = {} \
                   AND d.type IN ('FUNCTION','PROCEDURE','PACKAGE','PACKAGE BODY') \
                   AND NOT (d.owner = d.referenced_owner AND d.name = d.referenced_name AND d.type = d.referenced_type) \
                 ORDER BY d.owner, d.type, d.name) WHERE ROWNUM <= 30",
                lit(owner),
                lit(name)
            ))
            .await
            .unwrap_or_default();
        let mut messages = Vec::new();
        for row in deps {
            let (dep_owner, dep_name, dep_kind) = (s(&row, 0), s(&row, 1), s(&row, 2));
            let object_arg = match dep_kind.to_uppercase().as_str() {
                "PACKAGE" => "package_spec",
                "PACKAGE BODY" => "package_body",
                "FUNCTION" => "function",
                "PROCEDURE" => "procedure",
                _ => continue,
            };
            let oid = format!("{dep_owner}\u{1f}{dep_name}\u{1f}{dep_kind}");
            let _ = self.compile_one(&oid, object_arg).await;
            let texts = self
                .rows(format!(
                    "SELECT text FROM all_errors WHERE owner = {} AND name = {} AND type = {} AND attribute = 'ERROR' ORDER BY sequence",
                    lit(&dep_owner),
                    lit(&dep_name),
                    lit(&dep_kind)
                ))
                .await
                .unwrap_or_default();
            let label = caller_label(&dep_owner, &dep_name, &dep_kind);
            messages.extend(
                texts
                    .iter()
                    .map(|r| format!("{label}: {}", s(r, 0).trim()))
                    .filter(|line| !line.ends_with(": ")),
            );
        }
        Ok(messages)
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

    async fn list_proxy_users(&self) -> Result<Vec<ProxyUserInfo>, String> {
        Ok(self
            .rows("SELECT client FROM user_proxies ORDER BY client".to_string())
            .await?
            .iter()
            .map(|r| ProxyUserInfo {
                name: s(r, 0),
                category: "user",
                bypasses_rls: false,
            })
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

    async fn execute_query_with_params(
        &self,
        sql: &str,
        params: &[Option<String>],
    ) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let (statement, indexes) = sql::bind_statement(sql, params.len())?;
        let values = params.to_vec();
        self.run(move |conn| {
            let names: Vec<String> = indexes
                .iter()
                .map(|index| format!("l8db_{index}"))
                .collect();
            let binds: Vec<(&str, &dyn oracle::sql_type::ToSql)> = names
                .iter()
                .zip(&indexes)
                .map(|(name, index)| {
                    (
                        name.as_str(),
                        &values[index - 1] as &dyn oracle::sql_type::ToSql,
                    )
                })
                .collect();
            if is_query(&statement) {
                let (columns, rows) = run_query_named(conn, &statement, &binds)?;
                Ok(QueryResult {
                    rows: rows_to_objects(&columns, rows),
                    columns,
                    rows_affected: None,
                    execution_time_ms: start.elapsed().as_millis() as u64,
                })
            } else {
                let affected = conn
                    .execute_named(&statement, &binds)
                    .map_err(|e| map_sql_err(e, &statement))?
                    .row_count()
                    .map_err(map_err)?;
                Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    rows_affected: Some(affected),
                    execution_time_ms: start.elapsed().as_millis() as u64,
                })
            }
        })
        .await
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

    async fn validate_sql(&self, sql: &str) -> Result<(), String> {
        let mut statements = Vec::new();
        for raw in sql::split_statements(sql) {
            let statement = prepare(&raw);
            if !statement.trim().is_empty() {
                statements.push(statement);
            }
        }
        self.run_meta(move |c| {
            let mut plan = Vec::new();
            statements
                .iter()
                .try_for_each(|statement| plan_statement(c, statement, &mut plan))?;
            run_temps(c, &plan)
        })
        .await
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

    async fn get_table_ddl(&self, schema: &str, table: &str) -> Result<String, String> {
        let mut ddl = self
            .rows(format!(
                "SELECT DBMS_METADATA.GET_DDL('TABLE', {}, {}) FROM dual",
                lit(table),
                lit(schema)
            ))
            .await?
            .first()
            .map(|r| format!("{};\n", s(r, 0).trim()))
            .ok_or_else(|| "Tabelle nicht gefunden".to_string())?;
        let indexes = self
            .rows(format!(
                "SELECT DBMS_METADATA.GET_DDL('INDEX', i.index_name, i.owner) FROM all_indexes i \
                 WHERE i.table_owner = {} AND i.table_name = {} AND i.index_type <> 'LOB' \
                 AND NOT EXISTS (SELECT 1 FROM all_constraints c WHERE c.owner = i.table_owner AND c.table_name = i.table_name AND c.index_name = i.index_name) \
                 ORDER BY i.index_name",
                lit(schema),
                lit(table)
            ))
            .await?;
        for r in &indexes {
            ddl.push_str(&format!("\n{};\n", s(r, 0).trim()));
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
        let sql = format!("SELECT owner, object_name, object_type, status FROM {} WHERE object_type IN ('FUNCTION', 'PACKAGE') ORDER BY object_name", self.objects_source(schema));
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
        let sql = format!("SELECT owner, object_name, object_type, status FROM {} WHERE object_type = 'PROCEDURE' ORDER BY object_name", self.objects_source(schema));
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

    async fn list_schema_copy_objects(
        &self,
        source_schema: &str,
        target_schema: &str,
        object_type: &str,
    ) -> Result<Vec<super::SchemaObjectEntry>, String> {
        let source = self
            .schema_copy_definitions(source_schema, object_type)
            .await?;
        let target = self
            .schema_copy_definitions(target_schema, object_type)
            .await?;
        Ok(source
            .into_iter()
            .map(|(name, definition)| {
                let rewritten = super::requalify_schema(&definition, source_schema, target_schema);
                let (status, target_definition) =
                    match target.iter().find(|(other, _)| other == &name) {
                        None => ("missing", String::new()),
                        Some((_, def)) => {
                            let same = rewritten.split_whitespace().eq(def.split_whitespace());
                            (if same { "identical" } else { "different" }, def.clone())
                        }
                    };
                super::SchemaObjectEntry {
                    name,
                    object_type: object_type.to_string(),
                    status: status.to_string(),
                    source_definition: rewritten,
                    target_definition,
                }
            })
            .collect())
    }

    async fn preview_schema_object_copy(
        &self,
        source_schema: &str,
        target_schema: &str,
        object_type: &str,
        name: &str,
    ) -> Result<String, String> {
        Ok(self
            .schema_copy_statements(source_schema, target_schema, object_type, name)
            .await?
            .join("\n/\n\n"))
    }

    async fn execute_schema_object_copy(
        &self,
        source_schema: &str,
        target_schema: &str,
        object_type: &str,
        name: &str,
    ) -> Result<String, String> {
        let statements = self
            .schema_copy_statements(source_schema, target_schema, object_type, name)
            .await?;
        let exists = self
            .rows(format!(
                "SELECT 1 FROM all_objects WHERE owner = {} AND object_name = {} AND ROWNUM = 1",
                lit(target_schema),
                lit(name)
            ))
            .await?;
        if !exists.is_empty() {
            return Err(format!(
                "Namenskonflikt: {name} existiert bereits im Zielschema {target_schema}."
            ));
        }
        for statement in &statements {
            self.exec(statement.clone()).await?;
        }
        Ok(statements.join("\n/\n\n"))
    }

    async fn list_object_grants(
        &self,
        schema: &str,
        name: &str,
    ) -> Result<Vec<ObjectGrantInfo>, String> {
        let rows = self.rows(format!(
            "SELECT grantee, privilege, grantor, grantable, CAST(NULL AS VARCHAR2(128)) AS column_name \
             FROM all_tab_privs WHERE table_schema = {0} AND table_name = {1} \
             UNION ALL \
             SELECT grantee, privilege, grantor, grantable, column_name \
             FROM all_col_privs WHERE table_schema = {0} AND table_name = {1} \
             ORDER BY 1, 2, 3, 5",
            lit(schema), lit(name)
        )).await?;
        rows.iter()
            .map(|row| {
                Ok(ObjectGrantInfo {
                    grantee: row.get(0).map_err(|e| e.to_string())?,
                    privilege: row.get(1).map_err(|e| e.to_string())?,
                    grantor: row.get(2).map_err(|e| e.to_string())?,
                    grantable: row.get::<_, String>(3).map_err(|e| e.to_string())? == "YES",
                    column_name: row.get(4).map_err(|e| e.to_string())?,
                })
            })
            .collect()
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
        let result = self.compile_one(oid, object_type).await?;
        if result.status != "VALID" {
            return Ok(result);
        }
        let parts: Vec<&str> = oid.split('\u{1f}').collect();
        let error_type = parts.get(2).map(|t| t.to_uppercase()).unwrap_or_default();
        if !matches!(error_type.as_str(), "FUNCTION" | "PROCEDURE" | "PACKAGE") {
            return Ok(result);
        }
        let messages = self.caller_impact(parts[0], parts[1]).await?;
        if messages.is_empty() {
            return Ok(result);
        }
        Ok(CompileResult {
            status: "VALID".to_string(),
            message: Some(messages.join("\n")),
            line: None,
            position: None,
        })
    }

    async fn list_invalid_objects(
        &self,
        schema: Option<&str>,
    ) -> Result<Vec<InvalidObjectInfo>, String> {
        let sql = format!(
            "SELECT owner, object_name, object_type, status FROM {} WHERE status = 'INVALID' AND object_type IN ('FUNCTION','PROCEDURE','PACKAGE','PACKAGE BODY','TRIGGER','VIEW','MATERIALIZED VIEW','TYPE','TYPE BODY','SYNONYM') ORDER BY object_type, object_name",
            self.objects_source(schema)
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
            match self.compile_one(&item.oid, object_arg).await {
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
             (SELECT COUNT(*) FROM all_constraints k JOIN all_cons_columns kc ON kc.owner = k.owner AND kc.constraint_name = k.constraint_name WHERE k.constraint_type = 'P' AND k.owner = c.owner AND k.table_name = c.table_name AND kc.column_name = c.column_name), \
             cc.comments \
             FROM all_tab_columns c LEFT JOIN all_col_comments cc ON cc.owner = c.owner AND cc.table_name = c.table_name AND cc.column_name = c.column_name \
             WHERE c.owner = {} AND c.table_name = {} ORDER BY c.column_id",
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
                comment: s_opt(r, 7).filter(|c| !c.is_empty()),
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
             WHERE c.constraint_type = 'R' AND ((c.owner = {} AND c.table_name = {}) OR (r.owner = {} AND r.table_name = {})) ORDER BY c.owner, c.table_name, c.constraint_name, cc.position",
            lit(schema),
            lit(table),
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

    async fn table_comment(&self, schema: &str, table: &str) -> Result<Option<String>, String> {
        let sql = format!(
            "SELECT comments FROM all_tab_comments WHERE owner = {} AND table_name = {}",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(sql)
            .await?
            .first()
            .map(|r| s(r, 0))
            .filter(|c| !c.is_empty()))
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
    for dir in client_lib_candidates() {
        if has_client_lib(&dir)
            && oracle::InitParams::new()
                .oracle_client_lib_dir(dir)
                .is_ok_and(|params| params.init().is_ok())
        {
            return;
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
    #[test]
    fn push_script_merges_package_spec_and_body() {
        let mut out = Vec::new();
        super::push_script(
            &mut out,
            "HR",
            "PKG".into(),
            "PACKAGE",
            "PACKAGE pkg IS END;",
        );
        super::push_script(
            &mut out,
            "HR",
            "PKG".into(),
            "PACKAGE BODY",
            "PACKAGE BODY pkg IS END;",
        );
        assert_eq!(out.len(), 1);
        let script = &out[0].1;
        assert!(script.starts_with("CREATE OR REPLACE PACKAGE \"HR\".\"PKG\""));
        assert!(script.contains("\n/\n\nCREATE OR REPLACE PACKAGE BODY \"HR\".\"PKG\""));
        let moved = crate::db::requalify_schema(script, "HR", "DEV");
        assert!(moved.contains("\"DEV\".\"PKG\""));
        assert!(!moved.contains("\"HR\""));
    }

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

    #[test]
    fn oracle_advertises_native_bind_parameters() {
        assert!(
            super::super::provider::DatabaseKind::Oracle
                .capabilities()
                .bind_parameters
        );
    }

    #[tokio::test]
    #[ignore]
    async fn live_master_detail_bind_parameters() {
        let url = std::env::var("L8DB_SMOKE_ORACLE_URL").expect("Oracle-Testverbindung fehlt");
        let adapter = OracleAdapter::new(
            &url,
            crate::db::pool::create_pool_state(),
            "bind-test".into(),
        )
        .unwrap();
        let result = adapter.execute_query_with_params(
            "SELECT $1 AS FIRST_VALUE, $1 AS REPEATED_VALUE, $2 AS NULL_VALUE FROM DUAL WHERE 42 = $3",
            &[Some("O'Reilly".into()), None, Some("42".into())],
        ).await.unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0]["FIRST_VALUE"], "O'Reilly");
        assert_eq!(result.rows[0]["REPEATED_VALUE"], "O'Reilly");
        assert!(result.rows[0]["NULL_VALUE"].is_null());
    }

    #[tokio::test]
    #[ignore]
    async fn live_proxy_user_sees_rows_through_vpd() {
        let (Ok(url), Ok(system_url)) = (
            std::env::var("L8DB_SMOKE_ORACLE_URL"),
            std::env::var("L8DB_E2E_ORACLE_SYSTEM_URL"),
        ) else {
            return;
        };
        let pool = crate::db::pool::create_pool_state();
        let system = OracleAdapter::new(&system_url, pool.clone(), "px-system".into()).unwrap();
        let owner = OracleAdapter::new(&url, pool.clone(), "px-owner".into()).unwrap();
        let schema = url::Url::parse(&url).unwrap().username().to_uppercase();
        let _ = system
            .execute_query(&format!(
                "BEGIN DBMS_RLS.DROP_POLICY('{schema}', 'L8DB_PX_T', 'L8DB_PX_P'); END;"
            ))
            .await;
        let _ = owner.execute_query("DROP TABLE L8DB_PX_T").await;
        let _ = system
            .execute_query("DROP USER L8DB_PX_TARGET CASCADE")
            .await;
        for sql in [
            "CREATE USER L8DB_PX_TARGET IDENTIFIED BY l8dbtarget".to_string(),
            "GRANT CREATE SESSION TO L8DB_PX_TARGET".to_string(),
            format!("ALTER USER L8DB_PX_TARGET GRANT CONNECT THROUGH {schema}"),
        ] {
            system.execute_query(&sql).await.expect(&sql);
        }
        for sql in [
            "CREATE TABLE L8DB_PX_T (OWNER_NAME VARCHAR2(128), V NUMBER)",
            "INSERT INTO L8DB_PX_T VALUES ('L8DB_PX_TARGET', 1)",
            "INSERT INTO L8DB_PX_T VALUES ('OTHER', 2)",
            "INSERT INTO L8DB_PX_T VALUES ('OTHER', 3)",
            "CREATE OR REPLACE FUNCTION L8DB_PX_F(s VARCHAR2, o VARCHAR2) RETURN VARCHAR2 AS BEGIN IF SYS_CONTEXT('USERENV', 'SESSION_USER') = s THEN RETURN NULL; END IF; RETURN 'OWNER_NAME = SYS_CONTEXT(''USERENV'', ''SESSION_USER'')'; END;",
            "GRANT SELECT ON L8DB_PX_T TO L8DB_PX_TARGET",
        ] {
            owner.execute_query(sql).await.expect(sql);
        }
        let policy = format!("BEGIN DBMS_RLS.ADD_POLICY(object_schema => '{schema}', object_name => 'L8DB_PX_T', policy_name => 'L8DB_PX_P', function_schema => '{schema}', policy_function => 'L8DB_PX_F'); END;");
        system.execute_query(&policy).await.expect("vpd policy");
        let separator = if url.contains('?') { "&" } else { "?" };
        let proxied = OracleAdapter::new(
            &format!("{url}{separator}proxy_user=l8db_px_target"),
            pool.clone(),
            "px-proxied".into(),
        )
        .unwrap();
        proxied.test_connection().await.expect("proxy connection");
        assert_eq!(
            owner
                .count_rows(&schema, "L8DB_PX_T", None, false)
                .await
                .unwrap(),
            3
        );
        assert_eq!(
            proxied
                .count_rows(&schema, "L8DB_PX_T", None, false)
                .await
                .unwrap(),
            1
        );
        let who = proxied
            .execute_query(
                "SELECT USER AS WHO, SYS_CONTEXT('USERENV', 'PROXY_USER') AS PROXY FROM DUAL",
            )
            .await
            .unwrap();
        assert_eq!(who.rows[0]["WHO"], "L8DB_PX_TARGET");
        assert_eq!(who.rows[0]["PROXY"], schema.as_str());
        let denied = OracleAdapter::new(
            &format!("{url}{separator}proxy_user=system"),
            pool,
            "px-denied".into(),
        )
        .unwrap();
        assert!(denied.test_connection().await.is_err());
        let _ = system
            .execute_query(&format!(
                "BEGIN DBMS_RLS.DROP_POLICY('{schema}', 'L8DB_PX_T', 'L8DB_PX_P'); END;"
            ))
            .await;
        let _ = owner.execute_query("DROP TABLE L8DB_PX_T").await;
        let _ = owner.execute_query("DROP FUNCTION L8DB_PX_F").await;
        let _ = system
            .execute_query("DROP USER L8DB_PX_TARGET CASCADE")
            .await;
    }

    #[tokio::test]
    #[ignore]
    async fn live_validate_sql_parses_without_executing() {
        let Ok(url) = std::env::var("L8DB_SMOKE_ORACLE_URL") else {
            return;
        };
        let a = OracleAdapter::new(
            &url,
            crate::db::pool::create_pool_state(),
            "validate".into(),
        )
        .unwrap();
        let count = |sql: &'static str| {
            let a = &a;
            async move {
                let r = a.execute_query(sql).await.unwrap();
                r.rows[0]["C"].to_string().trim_matches('"').to_string()
            }
        };
        for drop in [
            "DROP TABLE L8DB_VP_T",
            "DROP VIEW L8DB_VP_DEP",
            "DROP PACKAGE L8DB_VP_REAL",
            "DROP FUNCTION L8DB_VP_F",
            "DROP TABLE L8DB_VP_F_L8DB_TEMP",
        ] {
            let _ = a.execute_query(drop).await;
        }
        a.execute_query("CREATE TABLE L8DB_VP_T (ID NUMBER PRIMARY KEY)")
            .await
            .unwrap();

        let ddl = a
            .validate_sql("CREATE TABLE L8DB_VALIDATE_PROBE (ID NUMBER)")
            .await
            .unwrap_err();
        assert!(ddl.contains("nicht prüfen"), "{ddl}");
        assert!(a
            .execute_query("SELECT COUNT(*) AS C FROM L8DB_VALIDATE_PROBE")
            .await
            .is_err());
        assert!(a.validate_sql("DROP TABLE L8DB_VP_T").await.is_err());
        assert_eq!(count("SELECT COUNT(*) AS C FROM L8DB_VP_T").await, "0");

        a.validate_sql("SELECT 1 AS ONE FROM DUAL; SELECT 2 AS TWO FROM DUAL;\nCOMMIT;")
            .await
            .expect("script parses");
        a.validate_sql("-- c\nSELECT * FROM L8DB_VP_T WHERE ID = $1 AND ID <> :x")
            .await
            .expect("binds parse");
        a.validate_sql("BEGIN NULL; END;")
            .await
            .expect("plsql parses");
        a.validate_sql("BEGIN INSERT INTO L8DB_VP_T VALUES (1); COMMIT; END;")
            .await
            .expect("block parses");
        a.validate_sql("INSERT INTO L8DB_VP_T VALUES (2)")
            .await
            .expect("dml parses");
        a.validate_sql("DELETE FROM L8DB_VP_T")
            .await
            .expect("delete parses");
        assert_eq!(count("SELECT COUNT(*) AS C FROM L8DB_VP_T").await, "0");
        let big = format!("SELECT '{}' AS X FROM DUAL", "x".repeat(3000)).repeat(1)
            + &" UNION ALL SELECT 'y' FROM DUAL".repeat(2000);
        assert!(big.len() > 32767);
        a.validate_sql(&big).await.expect("large sql parses");
        let syntax = a.validate_sql("SELECT FROM WHERE").await.unwrap_err();
        assert!(syntax.contains("ORA-00936"), "{syntax}");
        let missing = a
            .validate_sql("SELECT 1 FROM DUAL;\nSELECT * FROM l8db_no_such_table")
            .await
            .unwrap_err();
        assert!(
            missing.contains("ORA-00942") && missing.contains("Position"),
            "{missing}"
        );
        assert!(a.validate_sql("BEGIN missing_thing; END;").await.is_err());
        assert!(a
            .validate_sql("UPDATE L8DB_VP_T SET nope = 1")
            .await
            .is_err());

        a.validate_sql(
            "CREATE OR REPLACE FUNCTION L8DB_VP_F RETURN NUMBER IS BEGIN RETURN 1; END L8DB_VP_F;",
        )
        .await
        .expect("valid function");
        assert_eq!(
            count("SELECT COUNT(*) AS C FROM user_objects WHERE object_name LIKE 'L8DB\\_VP\\_F%' ESCAPE '\\'").await,
            "0",
            "check must not create the real object"
        );
        let broken = a
            .validate_sql("CREATE OR REPLACE PROCEDURE L8DB_VP_P IS\nBEGIN\n  missing_thing;\nEND;")
            .await
            .unwrap_err();
        assert!(
            broken.contains("L8DB_VP_P")
                && !broken.contains("L8DB_TEMP")
                && broken.contains("Zeile 3"),
            "{broken}"
        );
        assert!(a
            .validate_sql("CREATE PROCEDURE L8DB_VP_P IS BEGIN NULL END;")
            .await
            .is_err());
        let bad_view = a
            .validate_sql(
                "CREATE OR REPLACE FORCE VIEW L8DB_VP_V AS SELECT x FROM l8db_no_such_table",
            )
            .await
            .unwrap_err();
        assert!(
            bad_view.contains("ORA-00942") && !bad_view.contains("manuell"),
            "{bad_view}"
        );
        a.validate_sql("CREATE OR REPLACE FORCE VIEW L8DB_VP_V (A) AS SELECT ID FROM L8DB_VP_T")
            .await
            .expect("valid view");
        a.validate_sql("CREATE PACKAGE L8DB_VP_K AS PROCEDURE p; END L8DB_VP_K;\n/\nCREATE PACKAGE BODY L8DB_VP_K AS PROCEDURE p IS BEGIN NULL; END p; END L8DB_VP_K;\n/")
            .await
            .expect("valid package");
        a.validate_sql("CREATE PACKAGE L8DB_VP_N AS TYPE t_rec IS RECORD (id NUMBER); PROCEDURE put(r t_rec); PROCEDURE run; END L8DB_VP_N;\n/\nCREATE PACKAGE BODY L8DB_VP_N AS PROCEDURE put(r t_rec) IS BEGIN NULL; END put; PROCEDURE run IS v L8DB_VP_N.t_rec; BEGIN L8DB_VP_N.put(v); END run; END L8DB_VP_N;\n/")
            .await
            .expect("self-qualified package types stay compatible");
        a.validate_sql("CREATE OR REPLACE PACKAGE L8DB_VP_T AS PROCEDURE run; END;\n/\nCREATE OR REPLACE PACKAGE BODY L8DB_VP_T AS PROCEDURE run IS n NUMBER; BEGIN SELECT L8DB_VP_T.id INTO n FROM L8DB_VP_T WHERE ROWNUM = 1; END; END;\n/")
            .await
            .expect("package named like a table keeps table qualifiers");
        let procs = 1500;
        let spec: String = (0..procs)
            .map(|i| format!("PROCEDURE p{i}(a NUMBER);\n"))
            .collect();
        let body: String = (0..procs)
            .map(|i| format!("PROCEDURE p{i}(a NUMBER) IS BEGIN NULL; END p{i};\n"))
            .collect();
        let big_pkg = format!("CREATE OR REPLACE PACKAGE L8DB_VP_BIG AS\n{spec}END L8DB_VP_BIG;\n/\nCREATE OR REPLACE PACKAGE BODY L8DB_VP_BIG AS\n{body}broken_call;\nEND L8DB_VP_BIG;\n/");
        assert!(big_pkg.len() > 100_000);
        let started = std::time::Instant::now();
        let big_err = a.validate_sql(&big_pkg).await.unwrap_err();
        eprintln!("big package check: {:?}", started.elapsed());
        assert!(
            big_err.contains(&format!("Zeile {}", procs + 2)),
            "{big_err}"
        );
        a.validate_sql(&big_pkg.replace("broken_call;\n", ""))
            .await
            .expect("large package");

        a.execute_query("CREATE OR REPLACE PACKAGE L8DB_VP_K_L8DB_TEMP AS PROCEDURE stale; END;")
            .await
            .expect("simulate leftover from a killed check");
        a.validate_sql("CREATE PACKAGE L8DB_VP_K AS PROCEDURE p; END L8DB_VP_K;")
            .await
            .expect("leftover is replaced, not reported");
        let nospec = a
            .validate_sql("CREATE PACKAGE BODY L8DB_VP_K AS PROCEDURE p IS BEGIN NULL; END p; END;")
            .await
            .unwrap_err();
        assert!(nospec.contains("Spezifikation"), "{nospec}");

        a.execute_query(
            "CREATE OR REPLACE PACKAGE L8DB_VP_REAL AS FUNCTION f RETURN NUMBER; END L8DB_VP_REAL;",
        )
        .await
        .unwrap();
        a.execute_query("CREATE OR REPLACE PACKAGE BODY L8DB_VP_REAL AS FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END f; END L8DB_VP_REAL;")
            .await
            .unwrap();
        a.execute_query("CREATE VIEW L8DB_VP_DEP AS SELECT L8DB_VP_REAL.f AS V FROM DUAL")
            .await
            .unwrap();
        a.validate_sql("CREATE OR REPLACE PACKAGE BODY L8DB_VP_REAL AS FUNCTION f RETURN NUMBER IS BEGIN RETURN 2; END f; END L8DB_VP_REAL;")
            .await
            .expect("body against existing spec");
        let bad_body = a
            .validate_sql("CREATE OR REPLACE PACKAGE BODY L8DB_VP_REAL AS FUNCTION g RETURN NUMBER IS BEGIN RETURN 2; END g; END L8DB_VP_REAL;")
            .await
            .unwrap_err();
        assert!(bad_body.contains("PLS-00323"), "{bad_body}");
        assert!(a
            .validate_sql("CREATE OR REPLACE PACKAGE L8DB_VP_REAL AS FUNCTION f RETURN NUMBER END;")
            .await
            .is_err());
        assert_eq!(
            count("SELECT COUNT(*) AS C FROM user_objects WHERE object_name IN ('L8DB_VP_REAL', 'L8DB_VP_DEP') AND status <> 'VALID'").await,
            "0",
            "real objects must stay valid"
        );
        assert_eq!(count("SELECT V AS C FROM L8DB_VP_DEP").await, "1");

        let user = a
            .execute_query("SELECT USER AS C FROM DUAL")
            .await
            .unwrap()
            .rows[0]["C"]
            .as_str()
            .unwrap()
            .to_string();
        a.validate_sql(&format!("CREATE OR REPLACE EDITIONABLE FUNCTION \"{user}\".\"L8DB_VP_Q\" RETURN NUMBER IS BEGIN RETURN 1; END \"L8DB_VP_Q\";"))
            .await
            .expect("qualified function");
        let qualified = a
            .validate_sql(&format!(
                "CREATE OR REPLACE PROCEDURE {user}.l8db_vp_q IS BEGIN nope; END l8db_vp_q;"
            ))
            .await
            .unwrap_err();
        assert!(
            qualified.contains("PLS-00201") && !qualified.contains("L8DB_TEMP"),
            "{qualified}"
        );

        a.execute_query("CREATE TABLE L8DB_VP_F_L8DB_TEMP (ID NUMBER)")
            .await
            .unwrap();
        let taken = a
            .validate_sql("CREATE FUNCTION L8DB_VP_F RETURN NUMBER IS BEGIN RETURN 1; END;")
            .await
            .unwrap_err();
        assert!(taken.contains("ORA-00955"), "{taken}");
        assert_eq!(
            count("SELECT COUNT(*) AS C FROM L8DB_VP_F_L8DB_TEMP").await,
            "0"
        );

        assert_eq!(
            count("SELECT COUNT(*) AS C FROM user_objects WHERE object_name LIKE '%L8DB\\_TEMP' ESCAPE '\\' AND object_name <> 'L8DB_VP_F_L8DB_TEMP'").await,
            "0",
            "no temp objects left"
        );
        for drop in [
            "DROP TABLE L8DB_VP_T",
            "DROP VIEW L8DB_VP_DEP",
            "DROP PACKAGE L8DB_VP_REAL",
            "DROP TABLE L8DB_VP_F_L8DB_TEMP",
        ] {
            a.execute_query(drop).await.unwrap();
        }
    }

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
        q("GRANT SELECT ON L8_LIVE_PARENT TO PUBLIC")
            .await
            .expect("grant select");
        q("GRANT UPDATE (ID) ON L8_LIVE_PARENT TO PUBLIC")
            .await
            .expect("grant column update");
        let grants = a
            .list_object_grants(&schema, "L8_LIVE_PARENT")
            .await
            .expect("list grants");
        assert!(grants.iter().any(|grant| grant.grantee == "PUBLIC"
            && grant.privilege == "SELECT"
            && grant.column_name.is_none()
            && !grant.grantable));
        assert!(grants.iter().any(|grant| grant.grantee == "PUBLIC"
            && grant.privilege == "UPDATE"
            && grant.column_name.as_deref() == Some("ID")));
        assert!(a
            .list_object_grants(&schema, "L8_MISSING'OBJECT")
            .await
            .expect("missing object grants")
            .is_empty());
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
            assert!(a.terminate_session(-1).await.is_err());
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

pub fn tx_fetch_rows(
    c: &Connection,
    request: &super::transaction::TransactionTableRead,
) -> Result<TableData, String> {
    let columns = table_columns(c, &request.schema, &request.table, false)?;
    let sql = format!(
        "SELECT {} FROM {}.{} t{}{} OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
        if request.is_view { "t.*" } else { ROWID_SELECT },
        quote(&request.schema),
        quote(&request.table),
        where_clause(request.filter.as_deref(), request.allow_raw)?,
        request.order_sql(&columns, super::provider::DatabaseKind::Oracle),
        request.offset.max(0),
        request.limit.max(1),
    );
    let (cols, rows) = run_query(c, &sql)?;
    Ok(TableData {
        columns: if columns.is_empty() {
            cols.clone()
        } else {
            columns
        },
        rows: rows_to_objects(&cols, rows),
    })
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
        .map_err(|e| map_sql_err(e, statement))
        .and_then(|st| st.row_count().map_err(map_err))?;
    check_compile(c, statement)?;
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

#[derive(serde::Serialize)]
pub struct TnsNames {
    pub path: Option<String>,
    pub aliases: Vec<String>,
}

fn tnsnames_candidates() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(admin) = std::env::var_os("TNS_ADMIN") {
        dirs.push(PathBuf::from(admin));
    }
    if let Some(home) = std::env::var_os("ORACLE_HOME") {
        dirs.push(PathBuf::from(home).join("network").join("admin"));
    }
    if let Some(dir) = find_client_lib_dir() {
        dirs.push(dir.join("network").join("admin"));
    }
    if let Some(home) = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
    {
        dirs.push(home.join(".oracle"));
        dirs.push(home);
    }
    dirs.into_iter().map(|d| d.join("tnsnames.ora")).collect()
}

pub fn parse_tns_aliases(text: &str) -> Vec<String> {
    let mut aliases = Vec::new();
    let mut depth = 0i32;
    for line in text.lines() {
        let line = line.split('#').next().unwrap_or("").trim();
        if depth == 0 {
            if let Some((name, _)) = line.split_once('=') {
                let name = name.trim();
                if !name.is_empty()
                    && !name.contains(char::is_whitespace)
                    && !name.contains('(')
                    && !name.eq_ignore_ascii_case("ifile")
                {
                    aliases.push(name.to_string());
                }
            }
        }
        depth += line.matches('(').count() as i32 - line.matches(')').count() as i32;
        depth = depth.max(0);
    }
    aliases.sort_by_key(|a| a.to_lowercase());
    aliases.dedup();
    aliases
}

pub fn tns_names() -> TnsNames {
    let Some(path) = tnsnames_candidates().into_iter().find(|p| p.is_file()) else {
        return TnsNames {
            path: None,
            aliases: Vec::new(),
        };
    };
    if std::env::var_os("TNS_ADMIN").is_none() {
        if let Some(dir) = path.parent() {
            std::env::set_var("TNS_ADMIN", dir);
        }
    }
    let aliases = std::fs::read_to_string(&path)
        .map(|t| parse_tns_aliases(&t))
        .unwrap_or_default();
    TnsNames {
        path: Some(path.to_string_lossy().into_owned()),
        aliases,
    }
}

#[cfg(test)]
mod tns_tests {
    #[test]
    fn parses_aliases_and_ignores_nested_keys() {
        let text = "# comment\nSLTEST =\n  (DESCRIPTION =\n    (ADDRESS = (PROTOCOL = TCP)(HOST = h)(PORT = 1521))\n    (CONNECT_DATA = (SERVICE_NAME = sl)))\nprod.example.com, PROD = (DESCRIPTION=(ADDRESS=(HOST=x)))\nIFILE=/x\nORCL=(DESCRIPTION=(SID=orcl))\n";
        let aliases = super::parse_tns_aliases(text);
        assert_eq!(aliases, vec!["ORCL", "SLTEST"]);
    }
}
