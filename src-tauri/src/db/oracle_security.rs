use oracle::{Connection, Row};

use super::super::principals::{
    GrantableObject, Member, ObjectGrant, Principal, PrincipalChange, PrincipalDetail,
    PrincipalList, PrincipalOptions, ProfileLimit, Quota, RoleGrant, SystemGrant,
};
use super::super::sql_log;
use super::{binds, fetch, fetch_bound, i, map_sql_err, s, s_opt, OracleAdapter};

const OBJECT_GRANT_LIMIT: usize = 5000;
const OBJECT_SEARCH_LIMIT: usize = 200;

const LIST_DBA: &str = "SELECT username, 'user', account_status, oracle_maintained FROM dba_users \
     UNION ALL SELECT role, 'role', NULL, oracle_maintained FROM dba_roles \
     UNION ALL SELECT profile, 'profile', NULL, 'N' FROM dba_profiles GROUP BY profile \
     ORDER BY 2, 4, 1";

const LIST_LIMITED: &str =
    "SELECT username, 'user', CAST(NULL AS VARCHAR2(32)), oracle_maintained FROM all_users \
     UNION ALL SELECT role, 'role', NULL, 'N' FROM session_roles \
     ORDER BY 2, 4, 1";

const USER_DBA: &str = "SELECT account_status, TO_CHAR(lock_date, 'YYYY-MM-DD HH24:MI'), \
     TO_CHAR(expiry_date, 'YYYY-MM-DD HH24:MI'), default_tablespace, temporary_tablespace, profile, \
     TO_CHAR(created, 'YYYY-MM-DD HH24:MI'), authentication_type, oracle_maintained, \
     TO_CHAR(last_login, 'YYYY-MM-DD HH24:MI') FROM dba_users WHERE username = :n";

const USER_OWN: &str = "SELECT account_status, TO_CHAR(lock_date, 'YYYY-MM-DD HH24:MI'), \
     TO_CHAR(expiry_date, 'YYYY-MM-DD HH24:MI'), default_tablespace, temporary_tablespace, NULL, \
     TO_CHAR(created, 'YYYY-MM-DD HH24:MI'), NULL, 'N', NULL FROM user_users WHERE username = :n";

const USER_OTHER: &str = "SELECT NULL, NULL, NULL, NULL, NULL, NULL, \
     TO_CHAR(created, 'YYYY-MM-DD HH24:MI'), NULL, oracle_maintained, NULL \
     FROM all_users WHERE username = :n";

fn ident(value: &str) -> Result<String, String> {
    if value.trim().is_empty() {
        return Err("Name fehlt.".to_string());
    }
    if value.contains('"') || value.contains('\0') {
        return Err(format!("Ungültiger Name: {value}"));
    }
    Ok(format!("\"{value}\""))
}

fn keyword(value: &str) -> Result<String, String> {
    let word = value.trim().to_ascii_uppercase();
    let valid = !word.is_empty()
        && word.len() <= 64
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '_');
    if valid {
        Ok(word)
    } else {
        Err(format!("Ungültiges Recht: {value}"))
    }
}

fn limit_value(value: &str) -> Result<String, String> {
    let word = value.trim();
    let valid = !word.is_empty()
        && word.len() <= 128
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '$' | '#' | '.' | '/'));
    if valid {
        Ok(word.to_ascii_uppercase())
    } else {
        Err(format!("Ungültiger Grenzwert: {value}"))
    }
}

const WHOLE_NUMBER_LIMITS: &[&str] = &[
    "SESSIONS_PER_USER",
    "CPU_PER_SESSION",
    "CPU_PER_CALL",
    "CONNECT_TIME",
    "IDLE_TIME",
    "LOGICAL_READS_PER_SESSION",
    "LOGICAL_READS_PER_CALL",
    "COMPOSITE_LIMIT",
    "FAILED_LOGIN_ATTEMPTS",
    "PASSWORD_REUSE_MAX",
];

fn check_limit(resource: &str, value: &str) -> Result<(), String> {
    if matches!(value, "UNLIMITED" | "DEFAULT") {
        return Ok(());
    }
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
    let ok = match resource {
        "PRIVATE_SGA" => digits(value.trim_end_matches(['K', 'M'])),
        _ if WHOLE_NUMBER_LIMITS.contains(&resource) => digits(value),
        _ => true,
    };
    if ok {
        Ok(())
    } else {
        Err(format!(
            "{resource} erwartet eine ganze Zahl, UNLIMITED oder DEFAULT, nicht {value}."
        ))
    }
}

fn password_clause(password: &str) -> Result<String, String> {
    if password.is_empty() || password.contains('"') || password.contains('\0') {
        return Err(
            "Das Passwort darf nicht leer sein und kein doppeltes Anführungszeichen enthalten."
                .to_string(),
        );
    }
    Ok(format!("IDENTIFIED BY \"{password}\""))
}

fn quota_size(max_bytes: i64) -> String {
    const MB: i64 = 1024 * 1024;
    match max_bytes {
        n if n < 0 => "UNLIMITED".to_string(),
        n if n > 0 && n % MB == 0 => format!("{}M", n / MB),
        n => n.to_string(),
    }
}

fn object_ref(grant: &ObjectGrant) -> Result<String, String> {
    let kind = grant.object_type.trim().to_ascii_uppercase();
    Ok(match kind.as_str() {
        "DIRECTORY" | "USER" | "EDITION" => format!("{kind} {}", ident(&grant.object)?),
        "JAVA SOURCE" | "JAVA RESOURCE" | "MINING MODEL" | "SQL TRANSLATION PROFILE" => {
            format!("{kind} {}.{}", ident(&grant.owner)?, ident(&grant.object)?)
        }
        _ => format!("{}.{}", ident(&grant.owner)?, ident(&grant.object)?),
    })
}

fn filled(value: &Option<String>) -> Option<&str> {
    value.as_deref().filter(|v| !v.trim().is_empty())
}

fn option(flag: bool, clause: &'static str) -> &'static str {
    if flag {
        clause
    } else {
        ""
    }
}

fn user_statements(
    change: &PrincipalChange,
    target: &str,
    create: bool,
) -> Result<Vec<String>, String> {
    let mut clauses = Vec::new();
    match (&change.password, create) {
        (Some(password), _) => clauses.push(password_clause(password)?),
        (None, true) => {
            return Err("Für einen neuen Benutzer wird ein Passwort benötigt.".to_string())
        }
        (None, false) => {}
    }
    if let Some(tablespace) = filled(&change.default_tablespace) {
        clauses.push(format!("DEFAULT TABLESPACE {}", ident(tablespace)?));
    }
    if let Some(tablespace) = filled(&change.temporary_tablespace) {
        clauses.push(format!("TEMPORARY TABLESPACE {}", ident(tablespace)?));
    }
    if let Some(profile) = filled(&change.profile) {
        clauses.push(format!("PROFILE {}", ident(profile)?));
    }
    if change.expire_password {
        clauses.push("PASSWORD EXPIRE".to_string());
    }
    match change.locked {
        Some(true) => clauses.push("ACCOUNT LOCK".to_string()),
        Some(false) if !create => clauses.push("ACCOUNT UNLOCK".to_string()),
        _ => {}
    }
    let mut out = Vec::new();
    if create {
        out.push(format!("CREATE USER {target} {}", clauses.join(" ")));
    } else if !clauses.is_empty() {
        out.push(format!("ALTER USER {target} {}", clauses.join(" ")));
    }
    for quota in &change.quotas {
        out.push(format!(
            "ALTER USER {target} QUOTA {} ON {}",
            quota_size(quota.max_bytes),
            ident(&quota.tablespace)?
        ));
    }
    Ok(out)
}

fn profile_statements(
    change: &PrincipalChange,
    target: &str,
    create: bool,
) -> Result<Vec<String>, String> {
    let limits = change
        .limits
        .iter()
        .map(|limit| {
            let resource = keyword(&limit.resource)?.replace(' ', "_");
            let value = limit_value(&limit.value)?;
            check_limit(&resource, &value)?;
            Ok(format!("{resource} {value}"))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(match (create, limits.is_empty()) {
        (true, true) => vec![format!(
            "CREATE PROFILE {target} LIMIT SESSIONS_PER_USER DEFAULT"
        )],
        (true, false) => vec![format!(
            "CREATE PROFILE {target} LIMIT {}",
            limits.join(" ")
        )],
        (false, true) => Vec::new(),
        (false, false) => vec![format!("ALTER PROFILE {target} LIMIT {}", limits.join(" "))],
    })
}

pub fn statements(change: &PrincipalChange) -> Result<Vec<String>, String> {
    let target = ident(&change.name)?;
    let cascade = option(change.cascade, " CASCADE");
    let create = match (change.kind.as_str(), change.action.as_str()) {
        ("user", "drop") => return Ok(vec![format!("DROP USER {target}{cascade}")]),
        ("role", "drop") => return Ok(vec![format!("DROP ROLE {target}")]),
        ("profile", "drop") => return Ok(vec![format!("DROP PROFILE {target}{cascade}")]),
        ("user" | "role" | "profile", "create") => true,
        ("user" | "role" | "profile", "alter") => false,
        (kind, action) => return Err(format!("Unbekannte Änderung: {kind} {action}")),
    };
    let mut out = match change.kind.as_str() {
        "profile" => return profile_statements(change, &target, create),
        "user" => user_statements(change, &target, create)?,
        _ if create => vec![format!("CREATE ROLE {target}")],
        _ => Vec::new(),
    };
    let mut revoked = std::collections::HashSet::new();
    for grant in &change.revoke_object_privileges {
        let statement = format!(
            "REVOKE {} ON {} FROM {target}",
            keyword(&grant.privilege)?,
            object_ref(grant)?
        );
        if revoked.insert(statement.clone()) {
            out.push(statement);
        }
    }
    for privilege in &change.revoke_system_privileges {
        out.push(format!("REVOKE {} FROM {target}", keyword(privilege)?));
    }
    for role in &change.revoke_roles {
        out.push(format!("REVOKE {} FROM {target}", ident(role)?));
    }
    for member in &change.revoke_members {
        out.push(format!("REVOKE {target} FROM {}", ident(member)?));
    }
    for role in &change.grant_roles {
        out.push(format!(
            "GRANT {} TO {target}{}",
            ident(&role.name)?,
            option(role.admin, " WITH ADMIN OPTION")
        ));
    }
    for privilege in &change.grant_system_privileges {
        out.push(format!(
            "GRANT {} TO {target}{}",
            keyword(&privilege.name)?,
            option(privilege.admin, " WITH ADMIN OPTION")
        ));
    }
    for grant in &change.grant_object_privileges {
        let privilege = keyword(&grant.privilege)?;
        let column = match filled(&grant.column) {
            Some(_) if !matches!(privilege.as_str(), "INSERT" | "UPDATE" | "REFERENCES") => {
                return Err(format!(
                    "{privilege} lässt sich nicht auf einzelne Spalten vergeben, nur INSERT, UPDATE und REFERENCES."
                ))
            }
            Some(column) => format!(" ({})", ident(column)?),
            None => String::new(),
        };
        if grant.grantable && change.kind == "role" {
            return Err("Rollen können Objektrechte nicht mit Grant-Option erhalten.".to_string());
        }
        out.push(format!(
            "GRANT {privilege}{column} ON {} TO {target}{}",
            object_ref(grant)?,
            option(grant.grantable, " WITH GRANT OPTION")
        ));
    }
    for member in &change.grant_members {
        out.push(format!(
            "GRANT {target} TO {}{}",
            ident(&member.name)?,
            option(member.admin, " WITH ADMIN OPTION")
        ));
    }
    if change.kind == "user" {
        if change.default_roles_all {
            out.push(format!("ALTER USER {target} DEFAULT ROLE ALL"));
        } else if let Some(roles) = &change.default_roles {
            let list = roles
                .iter()
                .map(|role| ident(role))
                .collect::<Result<Vec<_>, String>>()?;
            let list = if list.is_empty() {
                "NONE".to_string()
            } else {
                list.join(", ")
            };
            out.push(format!("ALTER USER {target} DEFAULT ROLE {list}"));
        }
    }
    Ok(out)
}

fn script(detail: &PrincipalDetail) -> String {
    let user = detail.kind == "user";
    let role = detail.kind == "role";
    let all_default = detail.roles.iter().all(|grant| grant.default);
    let change = PrincipalChange {
        kind: detail.kind.clone(),
        name: detail.name.clone(),
        action: "create".to_string(),
        password: user.then(|| "<Passwort>".to_string()),
        default_tablespace: detail.default_tablespace.clone(),
        temporary_tablespace: detail.temporary_tablespace.clone(),
        profile: detail.profile.clone(),
        locked: detail.locked.then_some(true),
        grant_roles: detail.roles.clone(),
        default_roles: (!all_default).then(|| {
            detail
                .roles
                .iter()
                .filter(|grant| grant.default)
                .map(|grant| grant.name.clone())
                .collect()
        }),
        grant_system_privileges: detail.system_privileges.clone(),
        grant_object_privileges: detail.object_privileges.clone(),
        quotas: detail.quotas.clone(),
        grant_members: if role {
            detail.members.clone()
        } else {
            Vec::new()
        },
        limits: detail
            .limits
            .iter()
            .filter(|limit| limit_value(&limit.value).is_ok())
            .cloned()
            .collect(),
        ..Default::default()
    };
    let authentication = match detail.authentication.as_deref() {
        Some("NONE") => "NO AUTHENTICATION",
        Some("EXTERNAL") => "IDENTIFIED EXTERNALLY",
        Some("GLOBAL") => "IDENTIFIED GLOBALLY",
        _ => "IDENTIFIED BY \"<Passwort>\"",
    };
    let note = if detail.object_privileges_truncated {
        format!("-- Nur die ersten {OBJECT_GRANT_LIMIT} Objektrechte enthalten\n")
    } else {
        String::new()
    };
    statements(&change)
        .map(|lines| {
            let body: String = lines.iter().map(|line| format!("{line};\n")).collect();
            note + &body.replacen("IDENTIFIED BY \"<Passwort>\"", authentication, 1)
        })
        .unwrap_or_default()
}

fn scoped<T>(dba: bool, read: impl Fn(bool) -> Result<T, String>) -> Result<T, String> {
    match read(dba) {
        Err(error) if dba && error.contains("ORA-00942") => read(false),
        other => other,
    }
}

fn bound(c: &Connection, sql: &str, name: &str) -> Result<Vec<Row>, String> {
    fetch_bound(c, sql, &binds(&[("n", name)]))
}

fn yes(row: &Row, index: usize) -> bool {
    matches!(s(row, index).as_str(), "YES" | "Y")
}

fn object_grants_sql(dba: bool) -> String {
    let (prefix, owner) = if dba {
        ("dba", "owner")
    } else {
        ("all", "table_schema")
    };
    format!(
        "SELECT * FROM (\
         SELECT {owner} AS owner, table_name, type, privilege, CAST(NULL AS VARCHAR2(128)) AS column_name, grantable, grantor \
         FROM {prefix}_tab_privs WHERE grantee = :n \
         UNION ALL \
         SELECT {owner}, table_name, 'TABLE', privilege, column_name, grantable, grantor \
         FROM {prefix}_col_privs WHERE grantee = :n \
         ORDER BY 1, 2, 4, 5) WHERE ROWNUM <= {}",
        OBJECT_GRANT_LIMIT + 1
    )
}

fn user_info(
    c: &Connection,
    detail: &mut PrincipalDetail,
    dba: bool,
    own: bool,
) -> Result<(), String> {
    let sql = match (dba, own) {
        (true, _) => USER_DBA,
        (false, true) => USER_OWN,
        (false, false) => USER_OTHER,
    };
    let rows = bound(c, sql, &detail.name)?;
    let row = rows
        .first()
        .ok_or_else(|| format!("Benutzer \"{}\" nicht gefunden.", detail.name))?;
    let status = s(row, 0);
    detail.locked = status.contains("LOCKED");
    detail.expired = status.contains("EXPIRED");
    detail.status = s_opt(row, 0);
    detail.lock_date = s_opt(row, 1);
    detail.expiry_date = s_opt(row, 2);
    detail.default_tablespace = s_opt(row, 3);
    detail.temporary_tablespace = s_opt(row, 4);
    detail.profile = s_opt(row, 5);
    detail.created = s_opt(row, 6);
    detail.authentication = s_opt(row, 7);
    detail.system = yes(row, 8);
    detail.last_login = s_opt(row, 9);
    if dba || own {
        let quotas = if dba {
            "SELECT tablespace_name, bytes, max_bytes FROM dba_ts_quotas WHERE username = :n ORDER BY 1"
        } else {
            "SELECT tablespace_name, bytes, max_bytes FROM user_ts_quotas WHERE :n IS NOT NULL ORDER BY 1"
        };
        detail.quotas = bound(c, quotas, &detail.name)?
            .iter()
            .map(|row| Quota {
                tablespace: s(row, 0),
                bytes: i(row, 1),
                max_bytes: i(row, 2),
            })
            .collect();
    }
    Ok(())
}

fn role_info(c: &Connection, detail: &mut PrincipalDetail, dba: bool) -> Result<(), String> {
    let sql = if dba {
        "SELECT authentication_type, oracle_maintained FROM dba_roles WHERE role = :n"
    } else {
        "SELECT NULL, 'N' FROM session_roles WHERE role = :n"
    };
    let rows = bound(c, sql, &detail.name)?;
    let row = rows
        .first()
        .ok_or_else(|| format!("Rolle \"{}\" nicht gefunden.", detail.name))?;
    detail.authentication = s_opt(row, 0);
    detail.system = yes(row, 1);
    if dba {
        detail.members = members(
            c,
            "SELECT grantee, admin_option FROM dba_role_privs WHERE granted_role = :n ORDER BY 1",
            &detail.name,
        )?;
    }
    Ok(())
}

fn members(c: &Connection, sql: &str, name: &str) -> Result<Vec<Member>, String> {
    Ok(bound(c, sql, name)?
        .iter()
        .map(|row| Member {
            name: s(row, 0),
            admin: yes(row, 1),
        })
        .collect())
}

fn profile_info(c: &Connection, detail: &mut PrincipalDetail, dba: bool) -> Result<(), String> {
    if !dba {
        return Err("Profile sind nur mit Leserechten auf die DBA-Views sichtbar.".to_string());
    }
    detail.limits = bound(
        c,
        "SELECT resource_name, resource_type, limit FROM dba_profiles WHERE profile = :n ORDER BY 2, 1",
        &detail.name,
    )?
    .iter()
    .map(|row| ProfileLimit {
        resource: s(row, 0),
        kind: s(row, 1),
        value: s(row, 2),
    })
    .collect();
    if detail.limits.is_empty() {
        return Err(format!("Profil \"{}\" nicht gefunden.", detail.name));
    }
    detail.members = members(
        c,
        "SELECT username, 'NO' FROM dba_users WHERE profile = :n ORDER BY 1",
        &detail.name,
    )?;
    Ok(())
}

fn grants(
    c: &Connection,
    detail: &mut PrincipalDetail,
    dba: bool,
    own: bool,
) -> Result<(), String> {
    let sources = match (dba, detail.kind.as_str(), own) {
        (true, _, _) => Some((
            "SELECT granted_role, admin_option, default_role FROM dba_role_privs WHERE grantee = :n ORDER BY 1",
            "SELECT privilege, admin_option FROM dba_sys_privs WHERE grantee = :n ORDER BY 1",
        )),
        (false, "role", _) => Some((
            "SELECT granted_role, admin_option, 'YES' FROM role_role_privs WHERE role = :n ORDER BY 1",
            "SELECT privilege, admin_option FROM role_sys_privs WHERE role = :n ORDER BY 1",
        )),
        (false, _, true) => Some((
            "SELECT granted_role, admin_option, default_role FROM user_role_privs WHERE username = :n ORDER BY 1",
            "SELECT privilege, admin_option FROM user_sys_privs WHERE username = :n ORDER BY 1",
        )),
        _ => None,
    };
    if let Some((roles, privileges)) = sources {
        detail.roles = bound(c, roles, &detail.name)?
            .iter()
            .map(|row| RoleGrant {
                name: s(row, 0),
                admin: yes(row, 1),
                default: yes(row, 2),
            })
            .collect();
        detail.system_privileges = bound(c, privileges, &detail.name)?
            .iter()
            .map(|row| SystemGrant {
                name: s(row, 0),
                admin: yes(row, 1),
            })
            .collect();
    }
    let rows = bound(c, &object_grants_sql(dba), &detail.name)?;
    detail.object_privileges_truncated = rows.len() > OBJECT_GRANT_LIMIT;
    detail.object_privileges =
        merge_grantors(rows.iter().take(OBJECT_GRANT_LIMIT).map(|row| ObjectGrant {
            owner: s(row, 0),
            object: s(row, 1),
            object_type: s(row, 2),
            privilege: s(row, 3),
            column: s_opt(row, 4),
            grantable: yes(row, 5),
            grantor: s(row, 6),
        }));
    Ok(())
}

fn merge_grantors(grants: impl Iterator<Item = ObjectGrant>) -> Vec<ObjectGrant> {
    let mut merged: Vec<ObjectGrant> = Vec::new();
    for grant in grants {
        match merged.last_mut() {
            Some(last)
                if last.owner == grant.owner
                    && last.object == grant.object
                    && last.privilege == grant.privilege
                    && last.column == grant.column =>
            {
                last.grantable |= grant.grantable;
                last.grantor = format!("{}, {}", last.grantor, grant.grantor);
            }
            _ => merged.push(grant),
        }
    }
    merged
}

fn detail(
    c: &Connection,
    kind: &str,
    name: &str,
    dba: bool,
    me: &str,
) -> Result<PrincipalDetail, String> {
    let mut detail = PrincipalDetail {
        name: name.to_string(),
        kind: kind.to_string(),
        limited: !dba,
        ..Default::default()
    };
    let own = name == me;
    match kind {
        "user" => user_info(c, &mut detail, dba, own)?,
        "role" => role_info(c, &mut detail, dba)?,
        "profile" => profile_info(c, &mut detail, dba)?,
        other => return Err(format!("Unbekannte Art: {other}")),
    }
    if kind != "profile" {
        grants(c, &mut detail, dba, own)?;
    }
    detail.script = script(&detail);
    Ok(detail)
}

fn list(c: &Connection, dba: bool, me: String) -> Result<PrincipalList, String> {
    let items = fetch(c, if dba { LIST_DBA } else { LIST_LIMITED })?
        .iter()
        .map(|row| Principal {
            name: s(row, 0),
            kind: s(row, 1),
            status: s_opt(row, 2),
            system: yes(row, 3),
        })
        .collect();
    Ok(PrincipalList {
        items,
        limited: !dba,
        current_user: me,
    })
}

fn options(c: &Connection, dba: bool) -> Result<PrincipalOptions, String> {
    let source = if dba {
        "dba_tablespaces"
    } else {
        "user_tablespaces"
    };
    let spaces = fetch(
        c,
        &format!("SELECT tablespace_name, contents FROM {source} ORDER BY 1"),
    )?;
    let named = |contents: &str| {
        spaces
            .iter()
            .filter(|row| s(row, 1) == contents)
            .map(|row| s(row, 0))
            .collect::<Vec<_>>()
    };
    Ok(PrincipalOptions {
        tablespaces: named("PERMANENT"),
        temporary_tablespaces: named("TEMPORARY"),
        system_privileges: fetch(c, "SELECT name FROM system_privilege_map ORDER BY name")?
            .iter()
            .map(|row| s(row, 0))
            .collect(),
    })
}

fn execute(c: &Connection, sql: &str) -> Result<(), String> {
    sql_log::logged(
        "execute",
        sql,
        |_: &()| None,
        || {
            c.execute(sql, &[])
                .map(|_| ())
                .map_err(|e| map_sql_err(e, sql))
        },
    )
}

impl OracleAdapter {
    async fn security_scope(&self) -> Result<(bool, String), String> {
        let info = self.info().await?;
        Ok((info.reads("DBA_USERS"), info.user.clone()))
    }

    pub(super) async fn principals(&self) -> Result<PrincipalList, String> {
        let (dba, me) = self.security_scope().await?;
        self.run_meta(move |c| scoped(dba, |dba| list(c, dba, me.clone())))
            .await
    }

    pub(super) async fn principal(
        &self,
        kind: &str,
        name: &str,
    ) -> Result<PrincipalDetail, String> {
        let (dba, me) = self.security_scope().await?;
        let (kind, name) = (kind.to_string(), name.to_string());
        self.run_meta(move |c| scoped(dba, |dba| detail(c, &kind, &name, dba, &me)))
            .await
    }

    pub(super) async fn security_options(&self) -> Result<PrincipalOptions, String> {
        let (dba, _) = self.security_scope().await?;
        self.run_meta(move |c| scoped(dba, |dba| options(c, dba)))
            .await
    }

    pub(super) async fn grantable_objects(
        &self,
        owner: &str,
        search: &str,
    ) -> Result<Vec<GrantableObject>, String> {
        let sql = format!(
            "SELECT object_name, object_type FROM (\
             SELECT object_name, object_type FROM all_objects \
             WHERE owner = :n AND UPPER(object_name) LIKE '%' || UPPER(:q) || '%' \
             AND object_type IN ('TABLE', 'VIEW', 'SEQUENCE', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'TYPE', 'DIRECTORY') \
             ORDER BY object_name) WHERE ROWNUM <= {OBJECT_SEARCH_LIMIT}"
        );
        let params = binds(&[("n", owner), ("q", search)]);
        Ok(self
            .run_meta(move |c| fetch_bound(c, &sql, &params))
            .await?
            .iter()
            .map(|row| GrantableObject {
                name: s(row, 0),
                object_type: s(row, 1),
            })
            .collect())
    }

    pub(super) async fn change_principal(
        &self,
        change: &PrincipalChange,
        dry_run: bool,
    ) -> Result<Vec<String>, String> {
        let statements = statements(change)?;
        let shown: Vec<String> = statements
            .iter()
            .map(|statement| sql_log::mask_secrets(statement).into_owned())
            .collect();
        if dry_run || statements.is_empty() {
            return Ok(shown);
        }
        let total = statements.len();
        let ran = shown.clone();
        self.run_meta(move |c| {
            for (done, statement) in statements.iter().enumerate() {
                execute(c, statement).map_err(|e| partial_failure(e, &ran[..done], total))?;
            }
            Ok(())
        })
        .await?;
        Ok(shown)
    }
}

fn partial_failure(error: String, ran: &[String], total: usize) -> String {
    if ran.is_empty() {
        return error;
    }
    format!(
        "{error}\nBereits ausgeführt ({} von {total}):\n{}",
        ran.len(),
        ran.join(";\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(kind: &str, action: &str) -> PrincipalChange {
        PrincipalChange {
            kind: kind.to_string(),
            name: "APP".to_string(),
            action: action.to_string(),
            ..Default::default()
        }
    }

    fn object(privilege: &str, object_type: &str, grantable: bool) -> ObjectGrant {
        ObjectGrant {
            owner: "HR".to_string(),
            object: "EMP".to_string(),
            object_type: object_type.to_string(),
            privilege: privilege.to_string(),
            grantable,
            ..Default::default()
        }
    }

    #[test]
    fn creates_a_user_with_every_clause_in_toad_order() {
        let sql = statements(&PrincipalChange {
            password: Some("Geheim#1".to_string()),
            default_tablespace: Some("USERS".to_string()),
            temporary_tablespace: Some("TEMP".to_string()),
            profile: Some("DEFAULT".to_string()),
            locked: Some(true),
            expire_password: true,
            quotas: vec![
                Quota {
                    tablespace: "USERS".to_string(),
                    max_bytes: -1,
                    ..Default::default()
                },
                Quota {
                    tablespace: "DATA".to_string(),
                    max_bytes: 100 * 1024 * 1024,
                    ..Default::default()
                },
            ],
            grant_roles: vec![RoleGrant {
                name: "CONNECT".to_string(),
                admin: true,
                default: true,
            }],
            grant_system_privileges: vec![SystemGrant {
                name: "create session".to_string(),
                admin: false,
            }],
            grant_object_privileges: vec![object("select", "TABLE", true)],
            default_roles: Some(vec!["CONNECT".to_string()]),
            ..change("user", "create")
        })
        .unwrap();
        assert_eq!(
            sql,
            vec![
                "CREATE USER \"APP\" IDENTIFIED BY \"Geheim#1\" DEFAULT TABLESPACE \"USERS\" TEMPORARY TABLESPACE \"TEMP\" PROFILE \"DEFAULT\" PASSWORD EXPIRE ACCOUNT LOCK",
                "ALTER USER \"APP\" QUOTA UNLIMITED ON \"USERS\"",
                "ALTER USER \"APP\" QUOTA 100M ON \"DATA\"",
                "GRANT \"CONNECT\" TO \"APP\" WITH ADMIN OPTION",
                "GRANT CREATE SESSION TO \"APP\"",
                "GRANT SELECT ON \"HR\".\"EMP\" TO \"APP\" WITH GRANT OPTION",
                "ALTER USER \"APP\" DEFAULT ROLE \"CONNECT\"",
            ]
        );
    }

    #[test]
    fn alters_only_what_changed_and_revokes_before_granting() {
        let sql = statements(&PrincipalChange {
            locked: Some(false),
            revoke_roles: vec!["DBA".to_string()],
            revoke_system_privileges: vec!["CREATE TABLE".to_string()],
            revoke_object_privileges: vec![
                ObjectGrant {
                    column: Some("SALARY".to_string()),
                    ..object("UPDATE", "TABLE", false)
                },
                object("UPDATE", "TABLE", false),
            ],
            grant_roles: vec![RoleGrant {
                name: "DBA".to_string(),
                ..Default::default()
            }],
            default_roles_all: true,
            ..change("user", "alter")
        })
        .unwrap();
        assert_eq!(
            sql,
            vec![
                "ALTER USER \"APP\" ACCOUNT UNLOCK",
                "REVOKE UPDATE ON \"HR\".\"EMP\" FROM \"APP\"",
                "REVOKE CREATE TABLE FROM \"APP\"",
                "REVOKE \"DBA\" FROM \"APP\"",
                "GRANT \"DBA\" TO \"APP\"",
                "ALTER USER \"APP\" DEFAULT ROLE ALL",
            ]
        );
        assert!(statements(&change("user", "alter")).unwrap().is_empty());
        assert_eq!(
            statements(&PrincipalChange {
                default_roles: Some(Vec::new()),
                ..change("user", "alter")
            })
            .unwrap(),
            vec!["ALTER USER \"APP\" DEFAULT ROLE NONE"]
        );
    }

    #[test]
    fn roles_profiles_and_drops() {
        let role = statements(&PrincipalChange {
            grant_members: vec![Member {
                name: "SCOTT".to_string(),
                admin: true,
            }],
            revoke_members: vec!["HR".to_string()],
            grant_object_privileges: vec![
                ObjectGrant {
                    object: "DUMPS".to_string(),
                    ..object("READ", "DIRECTORY", false)
                },
                ObjectGrant {
                    column: Some("NAME".to_string()),
                    ..object("UPDATE", "TABLE", false)
                },
            ],
            ..change("role", "create")
        })
        .unwrap();
        assert_eq!(
            role,
            vec![
                "CREATE ROLE \"APP\"",
                "REVOKE \"APP\" FROM \"HR\"",
                "GRANT READ ON DIRECTORY \"DUMPS\" TO \"APP\"",
                "GRANT UPDATE (\"NAME\") ON \"HR\".\"EMP\" TO \"APP\"",
                "GRANT \"APP\" TO \"SCOTT\" WITH ADMIN OPTION",
            ]
        );
        let limit = |resource: &str, value: &str| ProfileLimit {
            resource: resource.to_string(),
            value: value.to_string(),
            ..Default::default()
        };
        assert_eq!(
            statements(&PrincipalChange {
                limits: vec![
                    limit("failed_login_attempts", "5"),
                    limit("PASSWORD_LOCK_TIME", "1/24"),
                    limit("PASSWORD_VERIFY_FUNCTION", "ora12c_verify_function"),
                ],
                ..change("profile", "alter")
            })
            .unwrap(),
            vec!["ALTER PROFILE \"APP\" LIMIT FAILED_LOGIN_ATTEMPTS 5 PASSWORD_LOCK_TIME 1/24 PASSWORD_VERIFY_FUNCTION ORA12C_VERIFY_FUNCTION"]
        );
        assert_eq!(
            statements(&change("profile", "create")).unwrap(),
            vec!["CREATE PROFILE \"APP\" LIMIT SESSIONS_PER_USER DEFAULT"]
        );
        let drop = |kind: &str| {
            statements(&PrincipalChange {
                cascade: true,
                ..change(kind, "drop")
            })
            .unwrap()
        };
        assert_eq!(drop("user"), vec!["DROP USER \"APP\" CASCADE"]);
        assert_eq!(drop("role"), vec!["DROP ROLE \"APP\""]);
        assert_eq!(drop("profile"), vec!["DROP PROFILE \"APP\" CASCADE"]);
    }

    #[test]
    fn rejects_input_that_could_leave_its_clause() {
        let bad = |change: PrincipalChange| statements(&change).unwrap_err();
        bad(PrincipalChange {
            name: "A\" IDENTIFIED BY \"x".to_string(),
            ..change("user", "alter")
        });
        bad(PrincipalChange {
            password: Some("a\" ACCOUNT UNLOCK --".to_string()),
            ..change("user", "alter")
        });
        bad(change("user", "create"));
        bad(PrincipalChange {
            grant_system_privileges: vec![SystemGrant {
                name: "DBA; DROP USER X".to_string(),
                admin: false,
            }],
            ..change("user", "alter")
        });
        bad(PrincipalChange {
            grant_object_privileges: vec![object("SELECT) ON X TO PUBLIC --", "TABLE", false)],
            ..change("role", "alter")
        });
        bad(PrincipalChange {
            limits: vec![ProfileLimit {
                resource: "IDLE_TIME".to_string(),
                value: "5 CONTAINER=ALL".to_string(),
                ..Default::default()
            }],
            ..change("profile", "alter")
        });
        bad(change("table", "drop"));
        bad(change("user", "truncate"));
    }

    #[test]
    fn script_recreates_the_principal_without_its_password() {
        let detail = PrincipalDetail {
            name: "APP".to_string(),
            kind: "user".to_string(),
            default_tablespace: Some("USERS".to_string()),
            locked: true,
            roles: vec![
                RoleGrant {
                    name: "CONNECT".to_string(),
                    admin: false,
                    default: true,
                },
                RoleGrant {
                    name: "DBA".to_string(),
                    admin: false,
                    default: false,
                },
            ],
            ..Default::default()
        };
        assert_eq!(
            script(&detail),
            "CREATE USER \"APP\" IDENTIFIED BY \"<Passwort>\" DEFAULT TABLESPACE \"USERS\" ACCOUNT LOCK;\n\
             GRANT \"CONNECT\" TO \"APP\";\n\
             GRANT \"DBA\" TO \"APP\";\n\
             ALTER USER \"APP\" DEFAULT ROLE \"CONNECT\";\n"
        );
        let schema_only = PrincipalDetail {
            name: "APP".to_string(),
            kind: "user".to_string(),
            authentication: Some("NONE".to_string()),
            object_privileges_truncated: true,
            ..Default::default()
        };
        assert_eq!(
            script(&schema_only),
            "-- Nur die ersten 5000 Objektrechte enthalten\nCREATE USER \"APP\" NO AUTHENTICATION;\n"
        );
    }

    #[test]
    fn reads_merge_grantors_and_fall_back_without_dictionary_access() {
        let mut second = object("SELECT", "TABLE", true);
        second.grantor = "OTHER".to_string();
        let merged = merge_grantors(
            vec![
                object("SELECT", "TABLE", false),
                second,
                object("UPDATE", "TABLE", false),
            ]
            .into_iter(),
        );
        assert_eq!(merged.len(), 2);
        assert!(merged[0].grantable);
        assert!(merged[0].grantor.ends_with(", OTHER"));

        let limited = |dba: bool| {
            if dba {
                Err("ORA-00942: table or view does not exist".to_string())
            } else {
                Ok(1)
            }
        };
        assert_eq!(scoped(true, limited), Ok(1));
        assert_eq!(
            scoped(true, |_| Err::<i32, _>("ORA-01031".to_string())),
            Err("ORA-01031".to_string())
        );
    }

    #[test]
    fn rejects_grants_and_limits_oracle_refuses() {
        let column_select = statements(&PrincipalChange {
            grant_object_privileges: vec![ObjectGrant {
                column: Some("NAME".to_string()),
                ..object("SELECT", "TABLE", true)
            }],
            ..change("user", "alter")
        });
        assert!(column_select
            .unwrap_err()
            .contains("nur INSERT, UPDATE und REFERENCES"));
        let column_update = statements(&PrincipalChange {
            grant_object_privileges: vec![ObjectGrant {
                column: Some("NAME".to_string()),
                ..object("UPDATE", "TABLE", true)
            }],
            ..change("user", "alter")
        })
        .unwrap();
        assert_eq!(
            column_update,
            vec!["GRANT UPDATE (\"NAME\") ON \"HR\".\"EMP\" TO \"APP\" WITH GRANT OPTION"]
        );
        let role = statements(&PrincipalChange {
            grant_object_privileges: vec![object("SELECT", "TABLE", true)],
            ..change("role", "alter")
        });
        assert!(role.unwrap_err().contains("Grant-Option"));
        let limit = |resource: &str, value: &str| {
            statements(&PrincipalChange {
                limits: vec![ProfileLimit {
                    resource: resource.to_string(),
                    value: value.to_string(),
                    ..Default::default()
                }],
                ..change("profile", "alter")
            })
        };
        assert!(limit("IDLE_TIME", "1/24")
            .unwrap_err()
            .contains("ganze Zahl"));
        assert!(limit("IDLE_TIME", "60").is_ok());
        assert!(limit("PASSWORD_LIFE_TIME", "1/24").is_ok());
        assert!(limit("PRIVATE_SGA", "10M").is_ok());
        assert!(limit("SESSIONS_PER_USER", "unlimited").is_ok());
        assert_eq!(
            partial_failure("ORA-01917".into(), &["CREATE USER \"A\"".into()], 3),
            "ORA-01917\nBereits ausgeführt (1 von 3):\nCREATE USER \"A\""
        );
    }

    #[test]
    fn large_changes_stay_linear() {
        let grants: Vec<ObjectGrant> = (0..20_000)
            .map(|n| ObjectGrant {
                object: format!("T{n}"),
                ..object("SELECT", "TABLE", false)
            })
            .collect();
        let started = std::time::Instant::now();
        let sql = statements(&PrincipalChange {
            revoke_object_privileges: grants.clone(),
            grant_object_privileges: grants,
            ..change("role", "alter")
        })
        .unwrap();
        assert_eq!(sql.len(), 40_000);
        assert!(started.elapsed() < std::time::Duration::from_millis(500));
    }
}
