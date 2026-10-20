use oracle::sql_type::OracleType;
use oracle::Connection;
use serde::Serialize;

const PROBE: &str = "DECLARE
  r VARCHAR2(8000);
  n NUMBER;
  v VARCHAR2(512);
  PROCEDURE put(k VARCHAR2, val VARCHAR2) IS BEGIN IF val IS NOT NULL THEN r := r || k || '=' || val || CHR(10); END IF; END;
  FUNCTION ctx(p VARCHAR2) RETURN VARCHAR2 IS BEGIN RETURN SYS_CONTEXT('USERENV', p); EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
  PROCEDURE readable(name VARCHAR2) IS BEGIN EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM ' || name || ' WHERE ROWNUM = 0' INTO n; put('view', name); EXCEPTION WHEN OTHERS THEN NULL; END;
BEGIN
  put('version', DBMS_DB_VERSION.VERSION || '.' || DBMS_DB_VERSION.RELEASE);
  BEGIN
    EXECUTE IMMEDIATE 'SELECT MAX(version_full) FROM product_component_version' INTO v;
    put('version_full', v);
  EXCEPTION WHEN OTHERS THEN
    BEGIN EXECUTE IMMEDIATE 'SELECT MAX(version) FROM product_component_version' INTO v; put('version_full', v); EXCEPTION WHEN OTHERS THEN NULL; END;
  END;
  put('container', ctx('CON_NAME'));
  put('cdb', ctx('CDB_NAME'));
  put('database', ctx('DB_NAME'));
  put('service', ctx('SERVICE_NAME'));
  put('instance', ctx('INSTANCE_NAME'));
  put('sid', ctx('SID'));
  put('edition', ctx('CURRENT_EDITION_NAME'));
  put('user', USER);
  BEGIN EXECUTE IMMEDIATE 'BEGIN :n := ORA_MAX_NAME_LEN_SUPPORTED; END;' USING OUT n; put('max_name', n); EXCEPTION WHEN OTHERS THEN put('max_name', 30); END;
  FOR p IN (SELECT privilege FROM session_privs WHERE privilege IN ('SELECT ANY DICTIONARY', 'DEBUG CONNECT SESSION', 'ALTER SYSTEM', 'ALTER SESSION')) LOOP put('privilege', p.privilege); END LOOP;
  FOR p IN (SELECT role FROM session_roles WHERE role IN ('SELECT_CATALOG_ROLE', 'DBA')) LOOP put('privilege', p.role); END LOOP;
  readable('v$session'); readable('v$sql'); readable('v$sql_plan'); readable('v$lock'); readable('v$session_longops'); readable('dba_objects'); readable('dba_ddl_locks');
  BEGIN EXECUTE IMMEDIATE 'BEGIN :v := DBMS_TRANSACTION.LOCAL_TRANSACTION_ID; END;' USING OUT v; put('package', 'DBMS_TRANSACTION'); EXCEPTION WHEN OTHERS THEN NULL; END;
  :info := r;
END;";

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ServerInfo {
    pub version: String,
    pub major: u32,
    pub minor: u32,
    pub version_full: Option<String>,
    pub container: Option<String>,
    pub cdb: Option<String>,
    pub database: Option<String>,
    pub service: Option<String>,
    pub instance: Option<String>,
    pub sid: Option<String>,
    pub edition: Option<String>,
    pub user: String,
    pub max_identifier: u32,
    pub privileges: Vec<String>,
    pub views: Vec<String>,
    pub dbms_transaction: bool,
    pub limits: Vec<String>,
}

impl ServerInfo {
    pub fn reads(&self, view: &str) -> bool {
        self.views.iter().any(|v| v.eq_ignore_ascii_case(view))
    }

    pub fn has(&self, privilege: &str) -> bool {
        self.privileges.iter().any(|p| p == privilege)
    }

    pub fn at_least(&self, major: u32, minor: u32) -> bool {
        (self.major, self.minor) >= (major, minor)
    }
}

pub fn probe(conn: &Connection) -> Result<ServerInfo, String> {
    let mut stmt = conn.statement(PROBE).build().map_err(super::map_err)?;
    stmt.execute(&[&OracleType::Varchar2(8000)])
        .map_err(super::map_err)?;
    let text: Option<String> = stmt.bind_value(1).map_err(super::map_err)?;
    Ok(parse(&text.unwrap_or_default()))
}

pub fn parse(text: &str) -> ServerInfo {
    let mut info = ServerInfo {
        max_identifier: 30,
        ..Default::default()
    };
    for (key, value) in text.lines().filter_map(|line| line.split_once('=')) {
        let value = value.to_string();
        match key {
            "version" => {
                let mut parts = value.split('.').map(|p| p.parse().unwrap_or(0));
                info.major = parts.next().unwrap_or(0);
                info.minor = parts.next().unwrap_or(0);
                info.version = value;
            }
            "version_full" => info.version_full = Some(value),
            "container" => info.container = Some(value),
            "cdb" => info.cdb = Some(value),
            "database" => info.database = Some(value),
            "service" => info.service = Some(value),
            "instance" => info.instance = Some(value),
            "sid" => info.sid = Some(value),
            "edition" => info.edition = Some(value),
            "user" => info.user = value,
            "max_name" => info.max_identifier = value.parse().unwrap_or(30),
            "privilege" => info.privileges.push(value),
            "view" => info.views.push(value.to_uppercase()),
            "package" => info.dbms_transaction = value == "DBMS_TRANSACTION",
            _ => {}
        }
    }
    info.limits = limits(&info);
    info
}

fn limits(info: &ServerInfo) -> Vec<String> {
    let mut out = Vec::new();
    if info.major > 0 && !info.at_least(12, 1) {
        out.push(format!("Oracle {} wird nur eingeschränkt unterstützt: Identity-Spalten, Oracle-Maintained-Filter und einige Kataloglisten brauchen 12c.", info.version));
    }
    if info.major > 0 && !info.at_least(18, 0) {
        out.push("Abfragen fremder Sitzungen abbrechen (ALTER SYSTEM CANCEL SQL) gibt es erst ab Oracle 18c.".to_string());
    }
    if !info.reads("V$SESSION") {
        out.push("Sitzungen, Sperren und das Beenden hängender Abfragen brauchen Leserechte auf V$SESSION (SELECT_CATALOG_ROLE oder SELECT ANY DICTIONARY).".to_string());
    }
    if !info.reads("V$SQL_PLAN") {
        out.push("Laufzeitstatistiken im Ausführungsplan brauchen Leserechte auf V$SQL_PLAN_STATISTICS_ALL (SELECT_CATALOG_ROLE).".to_string());
    }
    if !info.has("DEBUG CONNECT SESSION") {
        out.push(format!("Der PL/SQL-Debugger braucht das Recht DEBUG CONNECT SESSION: GRANT DEBUG CONNECT SESSION TO {};", if info.user.is_empty() { "<benutzer>" } else { &info.user }));
    }
    if !info.has("ALTER SYSTEM") {
        out.push("Fremde Sitzungen beenden braucht das Recht ALTER SYSTEM.".to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_reads_every_probe_line_and_derives_limits() {
        let info = parse("version=19.0\nversion_full=19.22.0.0.0\ncontainer=PDB1\nsid=42\nuser=HR\nmax_name=128\nprivilege=ALTER SESSION\nprivilege=SELECT_CATALOG_ROLE\nview=v$session\nview=v$sql_plan\npackage=DBMS_TRANSACTION\n");
        assert_eq!((info.major, info.minor), (19, 0));
        assert_eq!(info.version_full.as_deref(), Some("19.22.0.0.0"));
        assert_eq!(info.container.as_deref(), Some("PDB1"));
        assert_eq!(info.max_identifier, 128);
        assert!(info.reads("V$SESSION") && !info.reads("V$LOCK"));
        assert!(info.has("SELECT_CATALOG_ROLE") && info.dbms_transaction);
        assert!(info.at_least(18, 0) && !info.at_least(21, 0));
        assert_eq!(info.limits.len(), 2);
        assert!(info.limits[0].contains("GRANT DEBUG CONNECT SESSION TO HR;"));
    }

    #[test]
    fn parse_defaults_to_the_safe_side() {
        let info = parse("version=11.2\nuser=SCOTT\n");
        assert_eq!(info.max_identifier, 30);
        assert!(!info.dbms_transaction);
        assert!(info.limits.iter().any(|l| l.contains("Oracle 11.2")));
        assert!(info.limits.iter().any(|l| l.contains("V$SESSION")));
    }
}
