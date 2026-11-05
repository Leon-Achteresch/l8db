use super::control::{self, Connection, Policy};
use crate::db::{DatabaseAdapter, DatabaseKind};
use serde_json::Value;

fn is_false(value: &Value) -> bool {
    value.as_bool() == Some(false) || matches!(value.as_str(), Some("f" | "false" | "0"))
}

fn count(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| value.as_str()?.parse().ok())
}

pub async fn verify(
    adapter: &dyn DatabaseAdapter,
    connection: &Connection,
    policy: &Policy,
    plan: &Value,
) -> Result<(), String> {
    if !policy.production {
        return Ok(());
    }
    let user = control::actor(adapter, connection).await?;
    if !policy.require_approval
        || policy.reviewers.is_empty()
        || policy.operators.is_empty()
        || policy.administrators.contains(&user)
    {
        return Err("Produktion benötigt getrennte Regeladministration, freigegebene Deployer und verbindliche Vier-Augen-Freigabe.".into());
    }
    if plan["releases"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|release| release["objects"].as_array().into_iter().flatten())
        .any(|object| object["schema"].as_str() == Some(&connection.schema))
    {
        return Err("Produktionsrollouts benötigen ein getrenntes Kontrollschema außerhalb der verwalteten Anwendungsschemas.".into());
    }
    if connection.kind == DatabaseKind::Postgres {
        let schema = control::literal(&connection.schema);
        let result = adapter.execute_query(&format!("SELECT c.relname AS \"name\", (pg_has_role(session_user, c.relowner, 'MEMBER') OR pg_has_role(session_user, n.nspowner, 'MEMBER') OR r.rolsuper OR has_table_privilege(session_user, c.oid, 'DELETE') OR has_table_privilege(session_user, c.oid, 'TRUNCATE') OR has_table_privilege(session_user, c.oid, 'TRIGGER') OR (c.relname NOT IN ('L8DB_VERSIONING_STATE','L8DB_VERSIONING_LOCKS','L8DB_VERSIONING_OBJECTS') AND has_table_privilege(session_user, c.oid, 'UPDATE'))) AS \"unsafe\" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.rolname=session_user WHERE n.nspname={schema} AND c.relname IN ('L8DB_VERSIONING_POLICY','L8DB_VERSIONING_JOURNAL','L8DB_VERSIONING_APPROVALS','L8DB_VERSIONING_STATE','L8DB_VERSIONING_LOCKS','L8DB_VERSIONING_CHANGES','L8DB_VERSIONING_OBJECTS')")).await?;
        if result.rows.len() != 7 || result.rows.iter().any(|row| !is_false(&row["unsafe"])) {
            return Err("Kontrollschema und Kontrolltabellen müssen einer getrennten Rolle gehören. Deployer dürfen Regeln, Freigaben und Journal weder verändern noch löschen.".into());
        }
        let triggers = adapter.execute_query(&format!("SELECT COUNT(*) AS \"count\" FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname={schema} AND c.relname IN ('L8DB_VERSIONING_JOURNAL','L8DB_VERSIONING_APPROVALS') AND t.tgname='l8db_authentic_actor' AND t.tgenabled='A' AND NOT pg_has_role(session_user,p.proowner,'MEMBER')")).await?;
        if triggers.rows.first().and_then(|row| count(&row["count"])) != Some(2) {
            return Err("Serverseitige Identitäts- und Zeitstempelprüfung für Journal und Freigaben fehlt. DBA muss die Produktionskontrollen einrichten.".into());
        }
    } else {
        let result = adapter.execute_query("SELECT privilege AS \"privilege\" FROM session_privs WHERE privilege IN ('ALTER ANY TABLE','DROP ANY TABLE','UPDATE ANY TABLE','DELETE ANY TABLE','ALTER ANY TRIGGER','DROP ANY TRIGGER','ADMINISTER DATABASE TRIGGER','GRANT ANY OBJECT PRIVILEGE','GRANT ANY PRIVILEGE','GRANT ANY ROLE','BECOME USER','IMPERSONATE ANY USER','CREATE ANY PROCEDURE','ALTER ANY PROCEDURE','EXECUTE ANY PROCEDURE')").await?;
        if user.eq_ignore_ascii_case(&connection.schema) || !result.rows.is_empty() {
            return Err("Oracle-Produktion benötigt getrennte Kontrollschema-Eigentümer und einen Deployer ohne globale Änderungsrechte.".into());
        }
        let grants = adapter.execute_query(&format!("SELECT privilege AS \"privilege\" FROM all_tab_privs WHERE table_schema={} AND table_name IN ('L8DB_VERSIONING_POLICY','L8DB_VERSIONING_JOURNAL','L8DB_VERSIONING_APPROVALS','L8DB_VERSIONING_STATE','L8DB_VERSIONING_LOCKS','L8DB_VERSIONING_CHANGES','L8DB_VERSIONING_OBJECTS') AND (grantee IN (USER,'PUBLIC') OR grantee IN (SELECT role FROM session_roles)) AND (privilege IN ('DELETE','ALTER','INDEX') OR (privilege='UPDATE' AND table_name NOT IN ('L8DB_VERSIONING_STATE','L8DB_VERSIONING_LOCKS','L8DB_VERSIONING_OBJECTS')))",control::literal(&connection.schema))).await?;
        if !grants.rows.is_empty() {
            return Err("Oracle-Deployer dürfen Kontrolltabellen, Regeln, Freigaben und Journal weder verändern noch löschen.".into());
        }
        let result = adapter.execute_query(&format!("SELECT COUNT(*) AS \"count\" FROM all_triggers WHERE owner={} AND table_name IN ('L8DB_VERSIONING_JOURNAL','L8DB_VERSIONING_APPROVALS') AND trigger_name IN ('L8DB_JOURNAL_ACTOR','L8DB_APPROVAL_ACTOR') AND status='ENABLED'",control::literal(&connection.schema))).await?;
        if result.rows.first().and_then(|row| count(&row["count"])) != Some(2) {
            return Err("Oracle-Identitätsprüfung für Journal und Freigaben fehlt. DBA muss die Produktionskontrollen einrichten.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_results_accept_wire_strings_and_reject_unknown_values() {
        for value in [
            serde_json::json!(false),
            serde_json::json!("f"),
            serde_json::json!("false"),
        ] {
            assert!(is_false(&value));
        }
        for value in [
            Value::Null,
            serde_json::json!(true),
            serde_json::json!("t"),
            serde_json::json!("unknown"),
        ] {
            assert!(!is_false(&value));
        }
        assert_eq!(count(&serde_json::json!("2")), Some(2));
        assert_eq!(count(&serde_json::json!(2)), Some(2));
        assert_eq!(count(&Value::Null), None);
    }

    #[tokio::test]
    #[ignore]
    async fn production_controls_separate_deployer_from_owner_with_bounded_reads() {
        let source = std::env::var("L8DB_E2E_PG_URL").expect("disposable PostgreSQL lab required");
        let mut url = url::Url::parse(&source).unwrap();
        url.set_username("l8db_deployer").unwrap();
        url.set_password(Some("lab-only")).unwrap();
        let connection = Connection {
            kind: DatabaseKind::Postgres,
            connection_string: url.to_string(),
            database: None,
            schema: "l8db_control".into(),
            project_id: "test".into(),
            read_only: false,
        };
        let policy = Policy {
            track: "main".into(),
            pinned_release: None,
            paused: false,
            production: true,
            require_approval: true,
            operators: vec!["l8db_deployer".into()],
            administrators: vec!["l8db_administrator".into()],
            reviewers: vec!["l8db_reviewer".into()],
            delivery: None,
        };
        let plan = serde_json::json!({"releases":[{"objects":[{"schema":"public"}]}]});
        let adapter = connection
            .adapter(crate::db::pool::create_pool_state())
            .unwrap();
        let mut samples = Vec::new();
        for _ in 0..9 {
            let start = std::time::Instant::now();
            verify(adapter.as_ref(), &connection, &policy, &plan)
                .await
                .unwrap();
            samples.push(start.elapsed());
        }
        samples.sort();
        eprintln!("production controls: 5 tables, 2 identity triggers, 3 serial reads/check, median {:?}, p95 {:?}, no writes or background work", samples[4], samples[8]);
        assert!(samples[8] < std::time::Duration::from_millis(500));
        let mut owner = connection.clone();
        owner.connection_string = source;
        let owner_adapter = owner.adapter(crate::db::pool::create_pool_state()).unwrap();
        assert!(verify(owner_adapter.as_ref(), &owner, &policy, &plan)
            .await
            .is_err());
        let mut unsafe_policy = policy.clone();
        unsafe_policy.require_approval = false;
        assert!(verify(adapter.as_ref(), &connection, &unsafe_policy, &plan)
            .await
            .is_err());
    }
}
