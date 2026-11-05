use super::{control, runner::Request, snapshot};
use crate::db::{sql_script, DatabaseKind};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;

fn text<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
    value[field]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Release-Feld {field} fehlt"))
}

fn compact(source: &str) -> String {
    let mut result = String::with_capacity(source.len());
    let mut quoted = false;
    let mut escaped = false;
    for ch in source.chars() {
        if quoted {
            result.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                quoted = false;
            }
        } else if ch == '"' {
            quoted = true;
            result.push(ch);
        } else if !ch.is_whitespace() {
            result.push(ch);
        }
    }
    result
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
        && value != "."
        && value != ".."
}

async fn release(root: &Path, commit: &str, id: &str) -> Result<(Value, String), String> {
    if !identifier(id) {
        return Err("Ungültige Release-ID".into());
    }
    let object = format!("{commit}:database/releases/{id}.json");
    let size = super::git(root, &["cat-file", "-s", &object]).await?;
    if size
        .trim()
        .parse::<usize>()
        .map_err(|_| "Ungültige Manifestgröße")?
        > 16 * 1024 * 1024
    {
        return Err("Release-Manifest ist zu groß".into());
    }
    let source = super::git(root, &["show", &object]).await?;
    let value: Value =
        serde_json::from_str(&source).map_err(|_| "Release-Manifest ist ungültig")?;
    if value["format"] != 1 || value["id"] != id {
        return Err("Release-Manifest passt nicht zur Referenz".into());
    }
    for item in value["migrations"].as_array().into_iter().flatten() {
        if item["checksum"] != control::hash(text(item, "sql")?) {
            return Err("Migrationsprüfsumme stimmt nicht".into());
        }
    }
    for item in value["objects"].as_array().into_iter().flatten() {
        if item["checksum"] != control::hash(text(item, "definition")?) {
            return Err("Objektprüfsumme stimmt nicht".into());
        }
    }
    Ok((value, control::hash(&compact(&source))))
}

fn objects(release: &Value, target: Option<&str>) -> Result<Value, String> {
    let mut result = Vec::new();
    for item in release["objects"]
        .as_array()
        .ok_or("Release-Objekte fehlen")?
    {
        let object = &item["object"];
        let selection = &object["selection"];
        let source = text(selection, "schema")?;
        let mut mapped = json!({
            "schema": target.unwrap_or(source), "sourceSchema": source,
            "name": text(selection, "objectName")?, "kind": text(selection, "objectType")?,
            "definition": text(item, "definition")?,
        });
        if !object["metadataVersion"].is_null() {
            mapped["metadataVersion"] = object["metadataVersion"].clone();
        }
        result.push(mapped);
    }
    Ok(json!(result))
}

fn map_sql(sql: &str, release: &Value, target: Option<&str>) -> Result<String, String> {
    let Some(target) = target else {
        return Ok(sql.into());
    };
    let schemas: HashSet<_> = release["objects"]
        .as_array()
        .ok_or("Release-Objekte fehlen")?
        .iter()
        .map(|object| {
            object["object"]["selection"]["schema"]
                .as_str()
                .unwrap_or("")
        })
        .collect();
    if schemas.len() != 1 || schemas.contains("") {
        return Err("Schema-Zuordnung ist nicht eindeutig".into());
    }
    Ok(snapshot::requalify(
        sql,
        schemas.into_iter().next().unwrap(),
        target,
    ))
}

fn split(kind: DatabaseKind, sql: &str) -> Result<Vec<String>, String> {
    if kind != DatabaseKind::Oracle {
        return Ok(sql_script::split_for(kind, sql));
    }
    let mut statements = Vec::new();
    for (sqlplus, statement) in crate::db::oracle::script_items(sql) {
        if !sqlplus {
            statements.push(statement);
        } else if statement.trim() != "/" {
            return Err("SQL*Plus-Befehle sind in verwalteten Migrationen nicht zulässig".into());
        }
    }
    Ok(statements)
}

fn statement_key(sql: &str) -> &str {
    let sql = sql.trim();
    sql.strip_suffix(';').unwrap_or(sql).trim_end()
}

fn verify_statements(
    release: &Value,
    plan: &Value,
    target: Option<&str>,
    kind: DatabaseKind,
) -> Result<(), String> {
    let id = text(release, "id")?;
    let mut statements = Vec::new();
    for migration in release["migrations"]
        .as_array()
        .ok_or("Migrationen fehlen")?
    {
        let migration_id = text(migration, "id")?;
        let sql = map_sql(text(migration, "sql")?, release, target)?;
        for (index, sql) in split(kind, &sql)?.into_iter().enumerate() {
            statements.push(json!({"id":format!("{id}:{migration_id}:{}", index+1), "migration":migration_id, "sql":statement_key(&sql)}));
        }
    }
    let planned: Vec<Value> = plan["statements"]
        .as_array()
        .ok_or("SQL-Anweisungen fehlen")?
        .iter()
        .map(|item| {
            let sql = item["sql"].as_str().ok_or("SQL-Anweisung ist ungültig")?;
            let mut item = item.clone();
            item["sql"] = json!(statement_key(sql));
            Ok(item)
        })
        .collect::<Result<_, String>>()?;
    if statements.is_empty() || planned != statements {
        return Err("SQL-Anweisungen stimmen nicht mit dem committeten Release überein".into());
    }
    Ok(())
}

fn verify_plan(
    release: &Value,
    hash: &str,
    plan: &Value,
    target: Option<&str>,
    kind: DatabaseKind,
) -> Result<(), String> {
    let id = text(release, "id")?;
    if plan["id"] != id || plan["hash"] != hash || plan["objects"] != objects(release, target)? {
        return Err("Ausführungsplan weicht vom committeten Release ab".into());
    }
    verify_statements(release, plan, target, kind)?;
    for phase in ["preconditions", "postconditions"] {
        let mut checks = Vec::new();
        for check in release["safety"][phase].as_array().into_iter().flatten() {
            let sql = text(check, "sql")?;
            if check["checksum"] != control::hash(sql) {
                return Err("Prüfanweisungs-Prüfsumme stimmt nicht".into());
            }
            let mut mapped = check.clone();
            mapped["sql"] = json!(map_sql(sql, release, target)?);
            checks.push(mapped);
        }
        if plan[phase] != json!(checks) {
            return Err("Prüfanweisungen wurden im Ausführungsplan verändert".into());
        }
    }
    let safety = &release["safety"];
    let lock = safety["lockTimeoutMs"].as_u64().unwrap_or(5000);
    let timeout = safety["statementTimeoutMs"].as_u64().unwrap_or(60000);
    if lock == 0
        || lock > 600_000
        || timeout == 0
        || timeout > 3_600_000
        || plan["oracleTimeout"] != timeout
    {
        return Err("Ungültige Sitzungsgrenzen im Ausführungsplan".into());
    }
    let schemas: HashSet<_> = release["objects"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|object| target.or_else(|| object["object"]["selection"]["schema"].as_str()))
        .collect();
    let schema = if schemas.len() == 1 {
        control::quote(schemas.iter().next().unwrap())
    } else {
        "pg_catalog".into()
    };
    let settings = if kind == DatabaseKind::Postgres {
        vec![
            format!("SET LOCAL lock_timeout = '{lock}ms'"),
            format!("SET LOCAL statement_timeout = '{timeout}ms'"),
            format!(
                "SET LOCAL idle_in_transaction_session_timeout = '{}ms'",
                timeout.max(60000)
            ),
            format!("SET LOCAL search_path = {schema}, pg_temp"),
            "SET LOCAL row_security = off".into(),
        ]
    } else if schemas.len() == 1 {
        vec![
            format!("ALTER SESSION SET CURRENT_SCHEMA = {schema}"),
            format!(
                "ALTER SESSION SET DDL_LOCK_TIMEOUT = {}",
                lock.div_ceil(1000)
            ),
        ]
    } else {
        return Err("Oracle benötigt genau ein Zielschema".into());
    };
    if plan["settings"] != json!(settings) {
        return Err("Sitzungseinstellungen wurden im Ausführungsplan verändert".into());
    }
    Ok(())
}

pub async fn verify(request: &Request) -> Result<(), String> {
    if request.artifact.len() > 16 * 1024 * 1024 {
        return Err("Freigabeartefakt ist zu groß".into());
    }
    let artifact: Value =
        serde_json::from_str(&request.artifact).map_err(|_| "Freigabeartefakt ist ungültig")?;
    let plan = &artifact["execution"];
    let commit = text(&plan["reference"], "commit")?;
    if ![40, 64].contains(&commit.len()) || !commit.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Vollständige Git-Commit-ID fehlt".into());
    }
    let directory = std::fs::canonicalize(&request.repo).map_err(|_| "Release-Repository fehlt")?;
    let root = std::path::PathBuf::from(
        super::git(&directory, &["rev-parse", "--show-toplevel"])
            .await?
            .trim(),
    );
    if super::revision(&root, commit).await? != commit {
        return Err("Git-Referenz ist nicht eindeutig".into());
    }
    let organization = crate::organization::current(false)?;
    if organization.policy.require_signed_releases {
        super::git(&root, &["verify-commit", commit])
            .await
            .map_err(|_| "Release-Commit hat keine gültige Signatur")?;
        let fingerprint =
            super::git(&root, &["show", "--no-patch", "--format=%GF", commit]).await?;
        if !organization
            .policy
            .trusted_release_signers
            .iter()
            .any(|signer| signer == fingerprint.trim())
        {
            return Err(
                "Release-Commit stammt nicht von einem durch die IT freigegebenen Signierer".into(),
            );
        }
    }
    let target = artifact["schema"]
        .as_str()
        .filter(|schema| !schema.is_empty());
    let (from, from_hash) = release(&root, commit, text(plan, "fromId")?).await?;
    if from["projectId"] != request.connection.project_id {
        return Err("Ausgangsrelease gehört nicht zum Projekt".into());
    }
    if plan["fromHash"] != from_hash || plan["fromObjects"] != objects(&from, target)? {
        return Err("Ausgangsrelease wurde im Ausführungsplan verändert".into());
    }
    let releases = plan["releases"]
        .as_array()
        .filter(|items| !items.is_empty() && items.len() <= 1000)
        .ok_or("Release-Kette fehlt oder ist zu lang")?;
    let mut previous = text(&from, "id")?.to_string();
    let mut seen = HashSet::from([previous.clone()]);
    for planned in releases {
        let id = text(planned, "id")?;
        if !seen.insert(id.to_string()) {
            return Err("Zyklische Release-Kette".into());
        }
        let (source, hash) = release(&root, commit, id).await?;
        if source["parent"] != previous
            || source["projectId"] != request.connection.project_id
            || source["kind"]
                != serde_json::to_value(request.connection.kind).map_err(|e| e.to_string())?
        {
            return Err("Release-Kette gehört nicht zum Projekt oder Ausgangsrelease".into());
        }
        verify_plan(&source, &hash, planned, target, request.connection.kind)?;
        previous = id.to_string();
    }
    if plan["reference"]["id"] != previous
        || plan["reference"]["path"] != format!("database/releases/{previous}.json")
    {
        return Err("Zielrelease stimmt nicht mit dem Ausführungsplan überein".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn committed_artifact_is_verified_before_any_database_is_opened() {
        let root = tempfile::tempdir().unwrap();
        super::super::git(root.path(), &["init", "-b", "main"])
            .await
            .unwrap();
        super::super::git(
            root.path(),
            &["config", "user.email", "test@example.invalid"],
        )
        .await
        .unwrap();
        super::super::git(root.path(), &["config", "user.name", "Test"])
            .await
            .unwrap();
        std::fs::create_dir_all(root.path().join("database/releases")).unwrap();
        let from = json!({"format":1,"id":"r1","projectId":"test","kind":"postgres","parent":null,
            "objects":[{"object":{"selection":{"schema":"public","objectName":"t","objectType":"table"}},"definition":"id integer","checksum":control::hash("id integer")}],"migrations":[]});
        let mut next = from.clone();
        next["id"] = json!("r2");
        next["parent"] = json!("r1");
        next["migrations"] = json!([{"id":"m1","sql":"ALTER TABLE public.t ADD name text","checksum":control::hash("ALTER TABLE public.t ADD name text")}]);
        for source in [&from, &next] {
            std::fs::write(
                root.path().join(format!(
                    "database/releases/{}.json",
                    source["id"].as_str().unwrap()
                )),
                serde_json::to_string(source).unwrap(),
            )
            .unwrap();
        }
        super::super::git(root.path(), &["add", "database"])
            .await
            .unwrap();
        super::super::git(
            root.path(),
            &["-c", "commit.gpgsign=false", "commit", "-m", "test"],
        )
        .await
        .unwrap();
        let commit = super::super::git(root.path(), &["rev-parse", "HEAD"])
            .await
            .unwrap()
            .trim()
            .to_string();
        let plan = json!({"fromId":"r1","fromHash":control::hash(&from.to_string()),"fromObjects":objects(&from,None).unwrap(),
            "reference":{"id":"r2","commit":commit,"path":"database/releases/r2.json"},
            "releases":[{"id":"r2","hash":control::hash(&next.to_string()),"objects":objects(&next,None).unwrap(),
                "statements":[{"id":"r2:m1:1","migration":"m1","sql":"ALTER TABLE public.t ADD name text"}],
                "preconditions":[],"postconditions":[],"oracleTimeout":60000,
                "settings":["SET LOCAL lock_timeout = '5000ms'","SET LOCAL statement_timeout = '60000ms'","SET LOCAL idle_in_transaction_session_timeout = '60000ms'","SET LOCAL search_path = \"public\", pg_temp","SET LOCAL row_security = off"]}]});
        let request = Request {
            connection: super::super::control::Connection {
                kind: DatabaseKind::Postgres,
                connection_string: "postgres://unreachable.invalid/db".into(),
                database: None,
                schema: "control".into(),
                project_id: "test".into(),
                read_only: false,
            },
            repo: root.path().to_string_lossy().into_owned(),
            target_id: "target".into(),
            run_id: "run".into(),
            artifact: json!({"schema":null,"execution":plan}).to_string(),
            promotion: Vec::new(),
        };
        verify(&request).await.unwrap();
        let mut altered: Value = serde_json::from_str(&request.artifact).unwrap();
        altered["execution"]["releases"][0]["statements"][0]["sql"] = json!("DROP DATABASE other");
        let mut request = request;
        request.artifact = altered.to_string();
        assert!(verify(&request)
            .await
            .unwrap_err()
            .contains("SQL-Anweisungen"));
    }

    #[test]
    fn artifact_json_compaction_has_bounded_latency_for_large_release_manifests() {
        let source = serde_json::to_string_pretty(&json!({"migrations":(0..2000).map(|index| json!({"id":index,"sql":"ALTER TABLE public.example ADD name text","checksum":"x".repeat(64)})).collect::<Vec<_>>()})).unwrap();
        let mut times = Vec::new();
        for _ in 0..15 {
            let start = std::time::Instant::now();
            let compacted = compact(&source);
            assert!(compacted.len() <= source.len());
            assert_eq!(
                serde_json::from_str::<Value>(&compacted).unwrap()["migrations"]
                    .as_array()
                    .unwrap()
                    .len(),
                2000
            );
            times.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        times.sort_by(f64::total_cmp);
        eprintln!("artifact-json: migrations=2000 input_bytes={} median_ms={} p95_ms={} database_requests=0",source.len(),times[7],times[14]);
        assert!(times[14] < 150.0);
        assert!(source.len() < 1024 * 1024);
    }

    #[test]
    fn source_plan_rejects_changed_sql_checks_settings_and_snapshots() {
        let release = json!({"id":"r2","objects":[{"object":{"selection":{"schema":"public","objectName":"t","objectType":"table"}},"definition":"id integer"}],
            "migrations":[{"id":"m1","sql":"ALTER TABLE public.t ADD name text"}]});
        let plan = json!({"id":"r2","hash":"hash","objects":objects(&release,None).unwrap(),
            "statements":[{"id":"r2:m1:1","migration":"m1","sql":"ALTER TABLE public.t ADD name text"}],
            "preconditions":[],"postconditions":[],"oracleTimeout":60000,
            "settings":["SET LOCAL lock_timeout = '5000ms'","SET LOCAL statement_timeout = '60000ms'","SET LOCAL idle_in_transaction_session_timeout = '60000ms'","SET LOCAL search_path = \"public\", pg_temp","SET LOCAL row_security = off"]});
        verify_plan(&release, "hash", &plan, None, DatabaseKind::Postgres).unwrap();
        for key in ["statements", "preconditions", "settings", "objects", "hash"] {
            let mut altered = plan.clone();
            altered[key] = json!("tampered");
            assert!(verify_plan(&release, "hash", &altered, None, DatabaseKind::Postgres).is_err());
        }
        assert_eq!(
            compact("{\n \"sql\": \"a b\\\"c\" }"),
            "{\"sql\":\"a b\\\"c\"}"
        );
    }

    #[test]
    fn plan_statements_match_the_frontend_splitter_output() {
        let check = |kind, sql: &str, planned: Vec<&str>| {
            let release = json!({"id":"r2","migrations":[{"id":"m1","sql":sql}]});
            let statements: Vec<Value> = planned
                .iter()
                .enumerate()
                .map(|(index, sql)| json!({"id":format!("r2:m1:{}", index + 1),"migration":"m1","sql":sql}))
                .collect();
            verify_statements(&release, &json!({"statements":statements}), None, kind)
        };
        check(
            DatabaseKind::Postgres,
            "ALTER TABLE public.t ADD note text;\nCREATE INDEX t_note ON public.t(note);",
            vec![
                "ALTER TABLE public.t ADD note text;",
                "CREATE INDEX t_note ON public.t(note);",
            ],
        )
        .unwrap();
        check(
            DatabaseKind::Oracle,
            "ALTER TABLE T ADD (X NUMBER);\nCREATE OR REPLACE PACKAGE P AS\n PROCEDURE Q;\nEND;\n/",
            vec![
                "ALTER TABLE T ADD (X NUMBER);",
                "CREATE OR REPLACE PACKAGE P AS\n PROCEDURE Q;\nEND;",
            ],
        )
        .unwrap();
        assert!(check(
            DatabaseKind::Postgres,
            "ALTER TABLE public.t ADD note text;",
            vec!["ALTER TABLE public.t ADD note text; DROP TABLE public.t;"],
        )
        .is_err());
        assert!(check(
            DatabaseKind::Postgres,
            "ALTER TABLE public.t ADD note text;",
            vec!["ALTER TABLE public.t ADD note text;;"],
        )
        .is_err());
        assert!(check(
            DatabaseKind::Oracle,
            "ALTER TABLE T ADD (X NUMBER);\n@more.sql",
            vec!["ALTER TABLE T ADD (X NUMBER);"],
        )
        .is_err());
        assert!(check(
            DatabaseKind::Oracle,
            "CREATE OR REPLACE PACKAGE P AS\n PROCEDURE Q;\nEND;\n/",
            vec!["CREATE OR REPLACE PACKAGE P AS\n PROCEDURE Q", "END"],
        )
        .is_err());
    }
}
