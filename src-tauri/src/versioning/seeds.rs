use super::control::{self, Connection};
use crate::db::{self, provider::DatabaseKind};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub repo: String,
    pub branch: String,
    pub target_id: String,
    pub checksum: String,
    pub connection: Connection,
}

pub fn allowed_branch(branch: &str) -> bool {
    !branch.is_empty()
        && !["main", "master", "trunk", "production", "prod", "HEAD"]
            .iter()
            .any(|name| name.eq_ignore_ascii_case(branch))
}

fn checksum(script: &str) -> String {
    control::hash(script.replace("\r\n", "\n").replace('\r', "\n").trim_end())
}

fn identifier(value: &str, kind: DatabaseKind) -> String {
    if value.starts_with('"') {
        value[1..value.len() - 1].replace("\"\"", "\"")
    } else if kind == DatabaseKind::Oracle {
        value.to_uppercase()
    } else {
        value.to_lowercase()
    }
}

pub fn validate_seed(sql: &str, schema: &str, kind: DatabaseKind) -> Result<Vec<String>, String> {
    if sql.is_empty() || sql.len() > 1024 * 1024 || sql.contains('\0') {
        return Err("Seed-SQL fehlt oder ist zu groß.".into());
    }
    let ident = r#"(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$#]*)"#;
    let header = Regex::new(&format!(r"(?is)^\s*INSERT\s+INTO\s+({ident})\s*\.\s*({ident})\s*\((\s*{ident}(?:\s*,\s*{ident})*\s*)\)\s+VALUES\s+(.+?)\s*$")).map_err(|e| e.to_string())?;
    let literal = Regex::new(r"(?is)^(?:NULL|TRUE|FALSE|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|(?:DATE|TIMESTAMP)\s+'(?:[^']|'')*'|'(?:[^']|'')*')$").map_err(|e| e.to_string())?;
    let statements = if kind == DatabaseKind::Postgres {
        db::sql_script::split_postgres(sql)
    } else {
        db::sql_script::split(sql)
    };
    if statements.is_empty() || statements.len() > 10000 {
        return Err("Ungültige Anzahl Seed-Anweisungen.".into());
    }
    for statement in &statements {
        let captures = header.captures(statement.trim().trim_end_matches(';')).ok_or("Seeds benötigen schemaqualifizierte INSERT INTO … VALUES-Anweisungen mit festen Werten.")?;
        if identifier(&captures[1], kind) != schema
            || identifier(&captures[2], kind)
                .to_uppercase()
                .starts_with("L8DB_VERSIONING_")
        {
            return Err(
                "Seeds dürfen nur Anwendungstabellen im gewählten Development-Schema befüllen."
                    .into(),
            );
        }
        let mut quoted = false;
        let mut depth = 0;
        let mut value = String::new();
        let mut values = 0;
        let mut tuples = 0;
        let mut chars = captures[4].chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '\'' {
                value.push(ch);
                if quoted && chars.peek() == Some(&'\'') {
                    value.push(chars.next().unwrap());
                } else {
                    quoted = !quoted;
                }
            } else if quoted {
                value.push(ch);
            } else if ch == '(' && depth == 0 && value.trim().is_empty() {
                depth = 1;
                values = 0;
                value.clear();
            } else if depth == 1 && (ch == ',' || ch == ')') {
                if !literal.is_match(value.trim()) {
                    return Err("Seeds dürfen nur feste SQL-Werte enthalten, keine Abfragen oder Funktionsaufrufe.".into());
                }
                value.clear();
                values += 1;
                if ch == ')' {
                    if values != captures[3].split(',').count() {
                        return Err("Seed-Spalten und Werte passen nicht zusammen.".into());
                    }
                    depth = 0;
                    tuples += 1;
                }
            } else if depth == 0 && (ch.is_whitespace() || ch == ',') {
            } else {
                value.push(ch);
            }
        }
        if quoted || depth != 0 || tuples == 0 || !value.trim().is_empty() {
            return Err(
                "Seed-Werte sind unvollständig oder enthalten weitere SQL-Operationen.".into(),
            );
        }
    }
    Ok(statements)
}

pub(super) fn physical_key(kind: DatabaseKind, schema: &str, row: &Value) -> String {
    let text = format!(
        "{{\"kind\":{},\"database\":{},\"server\":{},\"port\":{},\"schema\":{},\"edition\":{}}}",
        json!(kind),
        row["database"],
        row["server"],
        row["port"],
        json!(schema),
        row["edition"]
    );
    control::hash(&text)
}

pub async fn run(
    request: Request,
    pool: db::pool::PoolState,
    transactions: db::transaction::TransactionState,
) -> Result<u64, String> {
    request.connection.writable()?;
    if db::connection_string_is_read_only(&request.connection.connection_string) {
        return Err("Die Seed-Verbindung ist schreibgeschützt.".into());
    }
    if !allowed_branch(&request.branch) {
        return Err("Seeds sind auf main und Produktionsbranches gesperrt.".into());
    }
    let _lock = super::LOCK.lock().await;
    let directory = fs::canonicalize(&request.repo).map_err(|e| e.to_string())?;
    let root = PathBuf::from(
        super::git(&directory, &["rev-parse", "--show-toplevel"])
            .await?
            .trim(),
    );
    let common = PathBuf::from(
        super::git(
            &root,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )
        .await?
        .trim(),
    );
    let lock_path = common.join("l8db-operation.lock");
    if fs::symlink_metadata(&lock_path).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err("Ungültige Repository-Sperre.".into());
    }
    let operation_lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)
        .map_err(|e| e.to_string())?;
    operation_lock
        .try_lock()
        .map_err(|_| "Repository wird bereits bearbeitet.")?;
    let branch = super::git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await?;
    if branch.trim() != request.branch {
        return Err("Branch wurde inzwischen gewechselt.".into());
    }
    let default = super::git(
        &root,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    )
    .await
    .ok();
    if default
        .as_deref()
        .and_then(|name| name.trim().strip_prefix("origin/"))
        == Some(request.branch.as_str())
    {
        return Err("Seeds sind auf dem Standardbranch gesperrt.".into());
    }
    let script = super::read(&super::safe_file(&root, "database/seeds/seed.sql")?)?
        .ok_or("Seed-Datei zuerst speichern.")?;
    if checksum(&script) != request.checksum {
        return Err("Seed-Datei wurde geändert. Vorschau neu laden.".into());
    }
    let project: Value = serde_json::from_str(
        &super::read(&super::safe_file(&root, "database/project.json")?)?
            .ok_or("Projekt fehlt.")?,
    )
    .map_err(|e| e.to_string())?;
    if project["id"] != request.connection.project_id
        || project["kind"] != json!(request.connection.kind)
    {
        return Err("Seed-Projekt passt nicht zur Verbindung.".into());
    }
    let store: Value = serde_json::from_str(
        &super::read(&common.join("l8db-targets.json"))?.ok_or("Kundenzuordnung fehlt.")?,
    )
    .map_err(|e| e.to_string())?;
    let targets = store["targets"].as_array().ok_or("Zielzuordnung fehlt.")?;
    let target = targets
        .iter()
        .find(|target| target["id"] == request.target_id)
        .ok_or("Seed-Ziel fehlt.")?;
    let team = super::team::committed(&root)
        .await?
        .map(|content| super::team::parse(&content))
        .transpose()?;
    let shared_target = team
        .as_ref()
        .map(|team| {
            team.targets
                .iter()
                .find(|target| target.id == request.target_id)
                .ok_or("Seed-Ziel fehlt in der Git-Teamkonfiguration.")
        })
        .transpose()?;
    if let Some(shared) = shared_target {
        if team
            .as_ref()
            .is_none_or(|team| team.project_id != request.connection.project_id)
            || shared.production
            || shared.database != request.connection.database
            || shared.schema != request.connection.schema
        {
            return Err("Seeds benötigen eine passende Development-Zuordnung in Git.".into());
        }
    }
    if store["projectId"] != request.connection.project_id
        || target["production"] != false
        || target["database"] != json!(request.connection.database)
        || target["schema"] != request.connection.schema
        || target["release"].is_null()
    {
        return Err("Seeds benötigen eine geprüfte Development-Zuordnung mit Baseline.".into());
    }
    let statements = validate_seed(&script, &request.connection.schema, request.connection.kind)?;
    let tx = transactions
        .begin(
            request.connection.kind,
            &request.connection.connection_string,
            request.connection.database.as_deref(),
            &pool,
        )
        .await?;
    let outcome = async {
        let c = &request.connection;
        if c.kind == DatabaseKind::Postgres {
            for sql in ["SET LOCAL statement_timeout = '60s'", "SET LOCAL lock_timeout = '5s'", "SET LOCAL standard_conforming_strings = on"] { transactions.execute(&tx, sql).await?; }
        } else {
            transactions.versioning_oracle_timeout(&tx, 60000).await?;
        }
        let context = if c.kind == DatabaseKind::Postgres {
            "SELECT current_database() AS \"database\", current_user AS \"user\", COALESCE(inet_server_addr()::text, 'local') AS \"server\", inet_server_port()::text AS \"port\", NULL::text AS \"edition\""
        } else {
            "SELECT SYS_CONTEXT('USERENV', 'DB_UNIQUE_NAME') AS \"database\", SYS_CONTEXT('USERENV', 'SESSION_USER') AS \"user\", SYS_CONTEXT('USERENV', 'SERVER_HOST') AS \"server\", SYS_CONTEXT('USERENV', 'CON_NAME') AS \"port\", SYS_CONTEXT('USERENV', 'CURRENT_EDITION_NAME') AS \"edition\" FROM dual"
        };
        let identity = transactions.execute(&tx, context).await?;
        let row = identity.rows.first().ok_or("Datenbankidentität fehlt.")?;
        let key = physical_key(c.kind, &c.schema, row);
        if let Some(shared) = shared_target {
            if shared.expected_physical_key.as_deref() != Some(key.as_str())
                || team.as_ref().is_some_and(|team| team.targets.iter().any(|other| other.production && other.expected_physical_key.as_deref() == Some(key.as_str()))) {
                return Err("Seed-Ziel widerspricht der Datenbankidentität oder dem Produktionsschutz in Git.".into());
            }
        }
        if target["binding"]["physicalKey"] != key || targets.iter().any(|other| other["production"] == true && other["binding"]["physicalKey"] == key) { return Err("Seed-Ziel ist verändert oder als Produktion registriert.".into()); }
        let state = transactions.execute(&tx, &format!("SELECT \"STATUS\", \"LEASE\" FROM {} WHERE \"PROJECT_ID\"={} FOR UPDATE NOWAIT", control::table(&c.schema, "STATE"), control::literal(&c.project_id))).await?;
        if !state.rows.first().is_some_and(|row| row["STATUS"] == "ready" && row["LEASE"].is_null()) { return Err("Development-Ziel ist nicht bereit oder ein Deployment läuft.".into()); }
        let policy = transactions.execute(&tx, &format!("SELECT \"REVISION\", \"BODY\" FROM {} WHERE \"PROJECT_ID\"={} FOR UPDATE NOWAIT", control::table(&c.schema, "POLICY"), control::literal(&c.project_id))).await?;
        let body = policy.rows.first().and_then(|row| row["BODY"].as_str()).ok_or("Development-Regeln fehlen.")?;
        let policy: control::Policy = serde_json::from_str(body).map_err(|e| e.to_string())?;
        let user = row["user"].as_str().ok_or("Benutzer fehlt.")?;
        if policy.production || policy.paused || policy.require_approval || (!policy.operators.is_empty() && !policy.operators.iter().any(|operator| operator == user)) { return Err("Seeds sind durch die gemeinsamen Zielregeln gesperrt.".into()); }
        let mut inserted = 0;
        for sql in statements { inserted += transactions.execute(&tx, &sql).await?.rows_affected.unwrap_or(0); }
        transactions.execute(&tx, &control::journal_sql(c, &format!("seed-{}", chrono::Utc::now().timestamp_millis()), "seed_applied", &json!({"branch":request.branch,"checksum":request.checksum,"inserted":inserted}))?).await?;
        if super::git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await?.trim() != request.branch || super::read(&super::safe_file(&root, "database/seeds/seed.sql")?)?.as_deref() != Some(script.as_str()) { return Err("Branch oder Seed-SQL wurde während der Ausführung geändert.".into()); }
        transactions.commit(&tx).await?;
        Ok(inserted)
    }.await;
    if outcome.is_err() {
        transactions
            .rollback(&tx)
            .await
            .map_err(|error| format!("Seed fehlgeschlagen; Rollback fehlgeschlagen: {error}"))?;
    }
    outcome
}

#[tauri::command]
pub async fn versioning_run_seed(
    request: Request,
    pool_state: tauri::State<'_, db::pool::PoolState>,
    tx_state: tauri::State<'_, db::transaction::TransactionState>,
) -> Result<u64, String> {
    run(
        request,
        pool_state.inner().clone(),
        tx_state.inner().clone(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_checksum_matches_frontend_normalization_and_preserves_literal_changes() {
        let sql = "INSERT INTO public.people (name) VALUES ('Test');";
        assert_eq!(checksum(&format!("{sql}\r\n")), control::hash(sql));
        assert_eq!(checksum(&format!("{sql}\n")), checksum(sql));
        assert_ne!(
            checksum(sql),
            checksum("INSERT INTO public.people (name) VALUES ('Test ');")
        );
    }

    #[test]
    fn seed_branches_exclude_production_and_detached_head() {
        for branch in ["", "main", "MASTER", "HEAD", "production", "trunk"] {
            assert!(!allowed_branch(branch));
        }
        assert!(allowed_branch("feature/billing"));
        assert!(allowed_branch("development"));
    }

    #[test]
    fn seed_sql_accepts_only_literal_inserts_in_the_target_schema() {
        let sql = "INSERT INTO \"public\".\"people\" (id, name, active) VALUES (1, 'O''Brien; DROP TABLE x', true), (2, 'Test', false);";
        assert_eq!(
            validate_seed(sql, "public", DatabaseKind::Postgres)
                .unwrap()
                .len(),
            1
        );
        for sql in [
            "DELETE FROM public.people",
            "INSERT INTO public.people (id) SELECT 1",
            "INSERT INTO other.people (id) VALUES (1)",
            "INSERT INTO public.people (id) VALUES (nextval('x'))",
            "INSERT INTO public.people (id) VALUES (1); COMMIT",
            "INSERT INTO public.L8DB_VERSIONING_STATE (id) VALUES (1)",
            "INSERT INTO public.people (id) VALUES (1,2)",
            "INSERT INTO public.people (id) VALUES ('unfinished)",
        ] {
            assert!(
                validate_seed(sql, "public", DatabaseKind::Postgres).is_err(),
                "{sql}"
            );
        }
        assert!(validate_seed(
            "INSERT INTO \"APP\".\"PEOPLE\" (id, born) VALUES (1, DATE '2025-01-01')",
            "APP",
            DatabaseKind::Oracle
        )
        .is_ok());
    }
}
