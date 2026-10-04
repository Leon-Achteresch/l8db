use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio_postgres::Client;

use super::mask::{self, MaskRule};
use crate::db::{map_pg_err, quote_ident, quote_literal};

const MARKER: &str = "[l8db] ";
pub const MIN_VERSION: i32 = 130000;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Branch {
    pub id: String,
    pub parent: String,
    pub kind: String,
    pub method: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_at: Option<String>,
    pub created_at: String,
    pub created_by: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub protected: bool,
    pub private: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub masking: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Marker {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<Branch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protection: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub masking: Vec<MaskRule>,
}

impl Marker {
    pub fn protected(&self) -> bool {
        self.protection.is_some() || self.branch.as_ref().is_some_and(|branch| branch.protected)
    }

    pub fn masked(&self) -> bool {
        self.protection.as_deref() == Some("masked")
    }
}

pub fn parse_comment(comment: Option<&str>) -> (Option<Marker>, String) {
    let Some(comment) = comment else {
        return (None, String::new());
    };
    let mut marker = None;
    let mut rest = Vec::new();
    for line in comment.lines() {
        match line.strip_prefix(MARKER) {
            Some(json) => marker = serde_json::from_str::<Marker>(json).ok().or(marker),
            None => rest.push(line),
        }
    }
    (marker, rest.join("\n").trim_end().to_string())
}

pub fn render_comment(marker: &Marker, rest: &str) -> Result<String, String> {
    let json = serde_json::to_string(marker).map_err(|error| error.to_string())?;
    Ok(if rest.trim().is_empty() {
        format!("{MARKER}{json}")
    } else {
        format!("{}\n{MARKER}{json}", rest.trim_end())
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub identity: String,
    pub version: String,
    pub version_num: i32,
    pub user: String,
    pub superuser: bool,
    pub create_db: bool,
    pub signal_backend: bool,
    pub instant_clone: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
    pub owner: String,
    pub size: Option<i64>,
    pub sessions: i64,
    pub own_sessions: i64,
    pub allow_connections: bool,
    pub can_connect: bool,
    pub is_owner: bool,
    pub marker: Option<Marker>,
    #[serde(skip)]
    pub comment_rest: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DatabaseMeta {
    pub encoding: String,
    pub collate: String,
    pub ctype: String,
    pub provider: Option<String>,
    pub locale: Option<String>,
    pub owner: String,
    pub tablespace: String,
    pub connection_limit: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCount {
    pub schema: String,
    pub table: String,
    pub rows: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub user: String,
    pub application: String,
    pub own: bool,
}

pub async fn connect(connection_string: &str, database: &str) -> Result<Client, String> {
    let (config, ssl) = crate::db::connection::parse_connection(connection_string, Some(database))?;
    crate::db::execution::connect_postgres(&config, &ssl).await
}

pub async fn maintenance(connection_string: &str) -> Result<Client, String> {
    connect(connection_string, "postgres")
        .await
        .map_err(|error| {
            format!("Verbindung zur Wartungsdatenbank „postgres“ fehlgeschlagen: {error}")
        })
}

pub fn valid_name(name: &str) -> Result<(), String> {
    let mut chars = name.chars();
    let first_ok = chars.next().is_some_and(|ch| ch.is_ascii_lowercase());
    if !first_ok
        || name.len() > 63
        || !name
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '-')
    {
        return Err("Branch-Namen: 1–63 Zeichen, Kleinbuchstaben, Ziffern, „_“ oder „-“, beginnend mit einem Buchstaben.".into());
    }
    Ok(())
}

pub fn derived_name(base: &str, suffix: &str) -> String {
    let room = 63usize.saturating_sub(suffix.len());
    let mut cut = base.len().min(room);
    while !base.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}{suffix}", &base[..cut])
}

pub async fn server_info(client: &Client) -> Result<ServerInfo, String> {
    let row = client
        .query_one(
            "SELECT current_setting('server_version'), current_setting('server_version_num')::int, session_user::text, \
             r.rolsuper, r.rolcreatedb, pg_has_role(current_user, 'pg_signal_backend', 'MEMBER'), \
             coalesce(current_setting('file_copy_method', true), '') = 'clone' \
             FROM pg_roles r WHERE r.rolname = current_user",
            &[],
        )
        .await
        .map_err(map_pg_err)?;
    let version_num: i32 = row.get(1);
    if version_num < MIN_VERSION {
        return Err("Datenbank-Branching benötigt PostgreSQL 13 oder neuer.".into());
    }
    let identity = match client
        .query_one(
            "SELECT system_identifier::text FROM pg_control_system()",
            &[],
        )
        .await
    {
        Ok(row) => format!("pg:{}", row.get::<_, String>(0)),
        Err(_) => {
            let row = client
                .query_one(
                    "SELECT coalesce(host(inet_server_addr()), 'local'), coalesce(inet_server_port(), current_setting('port')::int)",
                    &[],
                )
                .await
                .map_err(map_pg_err)?;
            format!("pg:{}:{}", row.get::<_, String>(0), row.get::<_, i32>(1))
        }
    };
    Ok(ServerInfo {
        identity,
        version: row.get(0),
        version_num,
        user: row.get(2),
        superuser: row.get(3),
        create_db: row.get(4),
        signal_backend: row.get(5),
        instant_clone: row.get(6),
    })
}

pub async fn databases(client: &Client) -> Result<Vec<DatabaseInfo>, String> {
    let rows = client
        .query(
            "SELECT d.datname::text, pg_get_userbyid(d.datdba)::text, \
             CASE WHEN has_database_privilege(d.oid, 'CONNECT') THEN pg_database_size(d.oid) END, \
             (SELECT count(*) FROM pg_stat_activity a WHERE a.datid = d.oid AND a.pid <> pg_backend_pid()), \
             (SELECT count(*) FROM pg_stat_activity a WHERE a.datid = d.oid AND a.pid <> pg_backend_pid() AND a.usename = current_user), \
             d.datallowconn, has_database_privilege(d.oid, 'CONNECT'), pg_has_role(d.datdba, 'MEMBER'), \
             shobj_description(d.oid, 'pg_database') \
             FROM pg_database d WHERE NOT d.datistemplate ORDER BY d.datname",
            &[],
        )
        .await
        .map_err(map_pg_err)?;
    Ok(rows
        .iter()
        .map(|row| {
            let comment: Option<String> = row.get(8);
            let (marker, comment_rest) = parse_comment(comment.as_deref());
            DatabaseInfo {
                name: row.get(0),
                owner: row.get(1),
                size: row.get(2),
                sessions: row.get(3),
                own_sessions: row.get(4),
                allow_connections: row.get(5),
                can_connect: row.get(6),
                is_owner: row.get(7),
                marker,
                comment_rest,
            }
        })
        .collect())
}

pub async fn database(client: &Client, name: &str) -> Result<DatabaseInfo, String> {
    databases(client)
        .await?
        .into_iter()
        .find(|database| database.name == name)
        .ok_or_else(|| format!("Datenbank „{name}“ existiert nicht."))
}

pub async fn exists(client: &Client, name: &str) -> Result<bool, String> {
    Ok(client
        .query_opt("SELECT 1 FROM pg_database WHERE datname = $1", &[&name])
        .await
        .map_err(map_pg_err)?
        .is_some())
}

pub async fn meta(client: &Client, name: &str, version_num: i32) -> Result<DatabaseMeta, String> {
    let locale = if version_num >= 170000 {
        "datlocprovider::text, datlocale::text"
    } else if version_num >= 150000 {
        "datlocprovider::text, daticulocale::text"
    } else {
        "NULL::text, NULL::text"
    };
    let row = client
        .query_one(
            &format!(
                "SELECT pg_encoding_to_char(d.encoding)::text, d.datcollate::text, d.datctype::text, {locale}, pg_get_userbyid(d.datdba)::text, \
                 t.spcname::text, d.datconnlimit \
                 FROM pg_database d JOIN pg_tablespace t ON t.oid = d.dattablespace WHERE d.datname = $1"
            ),
            &[&name],
        )
        .await
        .map_err(map_pg_err)?;
    Ok(DatabaseMeta {
        encoding: row.get(0),
        collate: row.get(1),
        ctype: row.get(2),
        provider: row.get(3),
        locale: row.get(4),
        owner: row.get(5),
        tablespace: row.get(6),
        connection_limit: row.get(7),
    })
}

pub fn create_sql(name: &str, meta: &DatabaseMeta) -> String {
    let mut sql = format!(
        "CREATE DATABASE {} WITH TEMPLATE template0 ENCODING {} LC_COLLATE {} LC_CTYPE {}",
        quote_ident(name),
        quote_literal(&meta.encoding),
        quote_literal(&meta.collate),
        quote_literal(&meta.ctype)
    );
    match (meta.provider.as_deref(), meta.locale.as_deref()) {
        (Some("i"), Some(locale)) => sql.push_str(&format!(
            " LOCALE_PROVIDER icu ICU_LOCALE {}",
            quote_literal(locale)
        )),
        (Some("b"), Some(locale)) => sql.push_str(&format!(
            " LOCALE_PROVIDER builtin BUILTIN_LOCALE {}",
            quote_literal(locale)
        )),
        _ => {}
    }
    if !meta.tablespace.is_empty() && meta.tablespace != "pg_default" {
        sql.push_str(&format!(" TABLESPACE {}", quote_ident(&meta.tablespace)));
    }
    sql
}

pub async fn create_empty(client: &Client, name: &str, meta: &DatabaseMeta) -> Result<(), String> {
    client
        .batch_execute(&create_sql(name, meta))
        .await
        .map_err(map_pg_err)
}

pub async fn create_clone(
    client: &Client,
    name: &str,
    template: &str,
    version_num: i32,
) -> Result<(), String> {
    let strategy = if version_num >= 150000 {
        " STRATEGY FILE_COPY"
    } else {
        ""
    };
    client
        .batch_execute(&format!(
            "CREATE DATABASE {} WITH TEMPLATE {}{strategy}",
            quote_ident(name),
            quote_ident(template)
        ))
        .await
        .map_err(map_pg_err)
}

pub async fn drop_database(client: &Client, name: &str) -> Result<(), String> {
    client
        .batch_execute(&format!(
            "DROP DATABASE IF EXISTS {} WITH (FORCE)",
            quote_ident(name)
        ))
        .await
        .map_err(map_pg_err)
}

pub async fn set_comment(
    client: &Client,
    name: &str,
    marker: &Marker,
    rest: &str,
) -> Result<(), String> {
    client
        .batch_execute(&format!(
            "COMMENT ON DATABASE {} IS {}",
            quote_ident(name),
            quote_literal(&render_comment(marker, rest)?)
        ))
        .await
        .map_err(|error| {
            let error = map_pg_err(error);
            if error.contains("must be owner") || error.contains("Eigentümer") {
                format!("Nur der Eigentümer von „{name}“ kann die l8db-Kennzeichnung ändern.")
            } else {
                error
            }
        })
}

pub async fn restore_comment(
    client: &Client,
    name: &str,
    comment: Option<&str>,
) -> Result<(), String> {
    let sql = match comment {
        Some(text) => format!(
            "COMMENT ON DATABASE {} IS {}",
            quote_ident(name),
            quote_literal(text)
        ),
        None => format!("COMMENT ON DATABASE {} IS NULL", quote_ident(name)),
    };
    client.batch_execute(&sql).await.map_err(map_pg_err)
}

pub async fn raw_comment(client: &Client, name: &str) -> Result<Option<String>, String> {
    Ok(client
        .query_one(
            "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = $1",
            &[&name],
        )
        .await
        .map_err(map_pg_err)?
        .get(0))
}

pub async fn make_private(client: &Client, name: &str) -> Result<(), String> {
    client
        .batch_execute(&format!(
            "REVOKE ALL ON DATABASE {} FROM PUBLIC",
            quote_ident(name)
        ))
        .await
        .map_err(map_pg_err)
}

pub async fn copy_acl(client: &Client, from: &str, to: &str) -> Result<(), String> {
    let has_acl: bool = client
        .query_one(
            "SELECT datacl IS NOT NULL FROM pg_database WHERE datname = $1",
            &[&from],
        )
        .await
        .map_err(map_pg_err)?
        .get(0);
    if !has_acl {
        return client
            .batch_execute(&format!(
                "GRANT CONNECT, TEMPORARY ON DATABASE {} TO PUBLIC",
                quote_ident(to)
            ))
            .await
            .map_err(map_pg_err);
    }
    let rows = client
        .query(
            "SELECT CASE WHEN a.grantee = 0 THEN NULL ELSE pg_get_userbyid(a.grantee)::text END, a.privilege_type::text, a.is_grantable \
             FROM pg_database d, aclexplode(d.datacl) a WHERE d.datname = $1",
            &[&from],
        )
        .await
        .map_err(map_pg_err)?;
    let mut sql = format!("REVOKE ALL ON DATABASE {} FROM PUBLIC;", quote_ident(to));
    for row in rows {
        let grantee: Option<String> = row.get(0);
        let privilege: String = row.get(1);
        if !matches!(privilege.as_str(), "CREATE" | "CONNECT" | "TEMPORARY") {
            continue;
        }
        sql.push_str(&format!(
            "GRANT {privilege} ON DATABASE {} TO {}{};",
            quote_ident(to),
            grantee
                .as_deref()
                .map(quote_ident)
                .unwrap_or_else(|| "PUBLIC".into()),
            if row.get::<_, bool>(2) {
                " WITH GRANT OPTION"
            } else {
                ""
            }
        ));
    }
    client.batch_execute(&sql).await.map_err(map_pg_err)
}

const LIST_SETTINGS: [&str; 4] = [
    "search_path",
    "temp_tablespaces",
    "session_preload_libraries",
    "local_preload_libraries",
];

pub fn setting_value(name: &str, value: &str) -> String {
    if !LIST_SETTINGS.contains(&name.to_ascii_lowercase().as_str()) {
        return quote_literal(value);
    }
    let mut items = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' if quoted && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => items.push(std::mem::take(&mut current)),
            other => current.push(other),
        }
    }
    items.push(current);
    items
        .iter()
        .map(|item| quote_literal(item.trim()))
        .collect::<Vec<_>>()
        .join(", ")
}

pub async fn settings_sql(client: &Client, from: &str, to: &str) -> Result<Vec<String>, String> {
    let rows = client
        .query(
            "SELECT CASE WHEN s.setrole = 0 THEN NULL ELSE pg_get_userbyid(s.setrole)::text END, s.setconfig \
             FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase WHERE d.datname = $1",
            &[&from],
        )
        .await
        .map_err(map_pg_err)?;
    let mut statements = Vec::new();
    for row in rows {
        let role: Option<String> = row.get(0);
        let config: Vec<String> = row.get(1);
        for entry in config {
            let Some((name, value)) = entry.split_once('=') else {
                continue;
            };
            let target = match &role {
                Some(role) => format!(
                    "ALTER ROLE {} IN DATABASE {}",
                    quote_ident(role),
                    quote_ident(to)
                ),
                None => format!("ALTER DATABASE {}", quote_ident(to)),
            };
            statements.push(format!(
                "{target} SET {} TO {}",
                quote_ident(name),
                setting_value(name, value)
            ));
        }
    }
    Ok(statements)
}

pub async fn copy_settings(client: &Client, from: &str, to: &str) -> Vec<String> {
    let statements = match settings_sql(client, from, to).await {
        Ok(statements) => statements,
        Err(error) => return vec![error],
    };
    let mut problems = Vec::new();
    for statement in statements {
        if let Err(error) = client.batch_execute(&statement).await {
            problems.push(format!("{statement}: {}", map_pg_err(error)));
        }
    }
    problems
}

pub async fn set_connection_limit(client: &Client, name: &str, limit: i32) -> Result<(), String> {
    client
        .batch_execute(&format!(
            "ALTER DATABASE {} WITH CONNECTION LIMIT {limit}",
            quote_ident(name)
        ))
        .await
        .map_err(map_pg_err)
}

pub async fn set_owner(client: &Client, name: &str, owner: &str) -> Result<(), String> {
    client
        .batch_execute(&format!(
            "ALTER DATABASE {} OWNER TO {}",
            quote_ident(name),
            quote_ident(owner)
        ))
        .await
        .map_err(map_pg_err)
}

pub async fn sessions(client: &Client, name: &str) -> Result<Vec<Session>, String> {
    let rows = client
        .query(
            "SELECT coalesce(usename::text, ''), coalesce(application_name, ''), usename = current_user \
             FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
            &[&name],
        )
        .await
        .map_err(map_pg_err)?;
    Ok(rows
        .iter()
        .map(|row| Session {
            user: row.get(0),
            application: row.get(1),
            own: row.get::<_, Option<bool>>(2).unwrap_or(false),
        })
        .collect())
}

pub async fn wait_idle(client: &Client, name: &str, timeout: Duration) -> Result<bool, String> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if sessions(client, name).await?.is_empty() {
            return Ok(true);
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

pub async fn allow_connections(client: &Client, name: &str, allow: bool) -> Result<(), String> {
    client
        .batch_execute(&format!(
            "ALTER DATABASE {} WITH ALLOW_CONNECTIONS {allow}",
            quote_ident(name)
        ))
        .await
        .map_err(map_pg_err)
}

pub async fn terminate(client: &Client, name: &str) -> Result<i64, String> {
    let row = client
        .query_one(
            "SELECT count(*) FILTER (WHERE pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
            &[&name],
        )
        .await
        .map_err(map_pg_err)?;
    Ok(row.get(0))
}

pub async fn swap(
    client: &Client,
    target: &str,
    staging: &str,
    previous: &str,
) -> Result<(), String> {
    allow_connections(client, target, false).await?;
    let outcome = async {
        terminate(client, target).await?;
        if !wait_idle(client, target, Duration::from_secs(15)).await? {
            return Err(format!(
                "Sitzungen auf „{target}“ konnten nicht beendet werden. Rolle pg_signal_backend oder Eigentümerrechte erforderlich."
            ));
        }
        if !wait_idle(client, staging, Duration::from_secs(5)).await? {
            return Err(format!("Die Zwischenstufe „{staging}“ hat noch aktive Sitzungen."));
        }
        client
            .batch_execute(&format!(
                "BEGIN; ALTER DATABASE {} RENAME TO {}; ALTER DATABASE {} RENAME TO {}; COMMIT;",
                quote_ident(target),
                quote_ident(previous),
                quote_ident(staging),
                quote_ident(target)
            ))
            .await
            .map_err(|error| {
                let error = map_pg_err(error);
                format!("Tausch abgebrochen, der bisherige Stand bleibt aktiv: {error}")
            })
    }
    .await;
    if outcome.is_err() {
        let _ = client.batch_execute("ROLLBACK").await;
        let _ = allow_connections(client, target, true).await;
        return outcome;
    }
    let _ = allow_connections(client, previous, true).await;
    let _ = allow_connections(client, target, true).await;
    Ok(())
}

pub async fn rename(client: &Client, from: &str, to: &str) -> Result<(), String> {
    client
        .batch_execute(&format!(
            "ALTER DATABASE {} RENAME TO {}",
            quote_ident(from),
            quote_ident(to)
        ))
        .await
        .map_err(map_pg_err)
}

pub async fn try_lock(client: &Client, name: &str) -> Result<(), String> {
    let locked: bool = client
        .query_one(
            "SELECT pg_try_advisory_lock(hashtextextended($1, 0))",
            &[&format!("l8db-branching:{name}")],
        )
        .await
        .map_err(map_pg_err)?
        .get(0);
    if locked {
        Ok(())
    } else {
        Err(format!(
            "Für „{name}“ läuft bereits ein Branching-Vorgang (möglicherweise von einem anderen Rechner)."
        ))
    }
}

const USER_TABLES: &str = "n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'";

pub async fn columns(client: &Client) -> Result<Vec<mask::Column>, String> {
    let rows = client
        .query(
            &format!(
                "SELECT n.nspname::text, c.relname::text, a.attname::text, format_type(a.atttypid, a.atttypmod), \
                 format_type(coalesce(nullif(t.typbasetype, 0), a.atttypid), NULL), a.attnotnull, a.attgenerated <> '', \
                 CASE WHEN coalesce(nullif(t.typbasetype, 0), a.atttypid) IN ('varchar'::regtype, 'bpchar'::regtype) \
                      AND (CASE WHEN t.typbasetype <> 0 THEN t.typtypmod ELSE a.atttypmod END) > 4 \
                      THEN (CASE WHEN t.typbasetype <> 0 THEN t.typtypmod ELSE a.atttypmod END) - 4 END, \
                 rn.nspname::text, rc.relname::text \
                 FROM pg_attribute a \
                 JOIN pg_class c ON c.oid = a.attrelid \
                 JOIN pg_namespace n ON n.oid = c.relnamespace \
                 JOIN pg_type t ON t.oid = a.atttypid \
                 JOIN pg_class rc ON rc.oid = coalesce(pg_partition_root(c.oid), c.oid) \
                 JOIN pg_namespace rn ON rn.oid = rc.relnamespace \
                 WHERE c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped AND {USER_TABLES} \
                 ORDER BY n.nspname, c.relname, a.attnum"
            ),
            &[],
        )
        .await
        .map_err(map_pg_err)?;
    Ok(rows
        .iter()
        .map(|row| {
            let base: String = row.get(4);
            let category = mask::category(&base);
            let not_null: bool = row.get(5);
            let name: String = row.get(2);
            mask::Column {
                schema: row.get(0),
                table: row.get(1),
                pii: mask::detect(&name, category, not_null),
                column: name,
                data_type: row.get(3),
                category,
                max_length: row.get::<_, Option<i32>>(7).map(|value| value as usize),
                not_null,
                generated: row.get(6),
                root_schema: row.get(8),
                root_table: row.get(9),
            }
        })
        .collect())
}

pub async fn counts(client: &Client, count: bool) -> Result<Vec<TableCount>, String> {
    let tables = client
        .query(
            &format!(
                "SELECT n.nspname::text, c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
                 WHERE c.relkind = 'r' AND c.relpersistence IN ('p', 'u') AND {USER_TABLES} \
                 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e') \
                 ORDER BY 1, 2"
            ),
            &[],
        )
        .await
        .map_err(map_pg_err)?;
    let mut out = Vec::with_capacity(tables.len());
    for row in tables {
        let schema: String = row.get(0);
        let table: String = row.get(1);
        if !count {
            out.push(TableCount {
                schema,
                table,
                rows: 0,
            });
            continue;
        }
        let rows: i64 = client
            .query_one(
                &format!(
                    "SELECT count(*) FROM {}.{}",
                    quote_ident(&schema),
                    quote_ident(&table)
                ),
                &[],
            )
            .await
            .map_err(map_pg_err)?
            .get(0);
        out.push(TableCount {
            schema,
            table,
            rows,
        });
    }
    Ok(out)
}

pub fn compare_counts(
    expected: &[TableCount],
    actual: &[TableCount],
    schema_only: bool,
) -> Result<(), String> {
    let actual: std::collections::HashMap<(&str, &str), i64> = actual
        .iter()
        .map(|count| ((count.schema.as_str(), count.table.as_str()), count.rows))
        .collect();
    let mut problems = Vec::new();
    for count in expected {
        let want = if schema_only { 0 } else { count.rows };
        match actual.get(&(count.schema.as_str(), count.table.as_str())) {
            None => problems.push(format!("{}.{} fehlt", count.schema, count.table)),
            Some(rows) if *rows != want => problems.push(format!(
                "{}.{}: {rows} statt {want} Zeilen",
                count.schema, count.table
            )),
            _ => {}
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        let more = problems.len().saturating_sub(5);
        problems.truncate(5);
        Err(format!(
            "Verifikation fehlgeschlagen: {}{}",
            problems.join("; "),
            if more > 0 {
                format!(" (+{more} weitere)")
            } else {
                String::new()
            }
        ))
    }
}

pub struct Exported {
    pub client: Client,
    pub snapshot: String,
}

pub async fn export_snapshot(connection_string: &str, database: &str) -> Result<Exported, String> {
    let client = connect(connection_string, database).await?;
    client
        .batch_execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .await
        .map_err(map_pg_err)?;
    let snapshot: String = client
        .query_one("SELECT pg_export_snapshot()", &[])
        .await
        .map_err(map_pg_err)?
        .get(0);
    Ok(Exported { client, snapshot })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers_coexist_with_user_comments() {
        let marker = Marker {
            protection: Some("masked".into()),
            ..Default::default()
        };
        let text = render_comment(&marker, "Produktivdatenbank\nTeam Billing").unwrap();
        let (parsed, rest) = parse_comment(Some(&text));
        assert!(parsed.unwrap().masked());
        assert_eq!(rest, "Produktivdatenbank\nTeam Billing");
        let (none, rest) = parse_comment(Some("nur Text"));
        assert!(none.is_none());
        assert_eq!(rest, "nur Text");
        let (broken, _) = parse_comment(Some("[l8db] {kaputt"));
        assert!(broken.is_none());
        assert_eq!(render_comment(&Marker::default(), "").unwrap(), "[l8db] {}");
    }

    #[test]
    fn names_and_derivations_are_safe() {
        assert!(valid_name("feature-login_2").is_ok());
        assert!(valid_name("Feature").is_err());
        assert!(valid_name("1abc").is_err());
        assert!(valid_name("a b").is_err());
        assert!(valid_name(&"a".repeat(64)).is_err());
        assert_eq!(
            derived_name(&"x".repeat(70), "_old_20261003_101500").len(),
            63
        );
        assert_eq!(derived_name("äöü", "_s"), "äöü_s");
        assert!(derived_name(&"ä".repeat(40), "_s").len() <= 63);
    }

    #[test]
    fn settings_keep_list_semantics() {
        assert_eq!(
            setting_value("search_path", "\"$user\", public"),
            "'$user', 'public'"
        );
        assert_eq!(setting_value("work_mem", "64MB"), "'64MB'");
        assert_eq!(setting_value("search_path", "\"a\"\"b\",c"), "'a\"b', 'c'");
        assert_eq!(setting_value("app.note", "it's"), "'it''s'");
    }

    #[test]
    fn counts_detect_missing_and_changed_tables() {
        let expected = vec![
            TableCount {
                schema: "public".into(),
                table: "a".into(),
                rows: 3,
            },
            TableCount {
                schema: "public".into(),
                table: "b".into(),
                rows: 1,
            },
        ];
        let same = expected.clone();
        assert!(compare_counts(&expected, &same, false).is_ok());
        let error = compare_counts(&expected, &same[..1], false).unwrap_err();
        assert!(error.contains("public.b fehlt"));
        let zero = vec![
            TableCount {
                schema: "public".into(),
                table: "a".into(),
                rows: 0,
            },
            TableCount {
                schema: "public".into(),
                table: "b".into(),
                rows: 0,
            },
        ];
        assert!(compare_counts(&expected, &zero, true).is_ok());
        assert!(compare_counts(&expected, &zero, false).is_err());
        let create = create_sql(
            "x\"y",
            &DatabaseMeta {
                encoding: "UTF8".into(),
                collate: "de_DE.UTF-8".into(),
                ctype: "de_DE.UTF-8".into(),
                provider: Some("i".into()),
                locale: Some("de-DE".into()),
                owner: "dev".into(),
                tablespace: "fast".into(),
                connection_limit: -1,
            },
        );
        assert!(create.starts_with("CREATE DATABASE \"x\"\"y\" WITH TEMPLATE template0"));
        assert!(create.ends_with("LOCALE_PROVIDER icu ICU_LOCALE 'de-DE' TABLESPACE \"fast\""));
    }
}
