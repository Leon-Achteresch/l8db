use super::{
    control::{self, literal, table, Connection},
    snapshot::{self, Snapshot},
};
use crate::db::{self, provider::DatabaseKind, DatabaseAdapter};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
};
use tokio::sync::Mutex;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub connection: Connection,
    pub repo: String,
    pub target_id: String,
    pub run_id: String,
    pub artifact: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Artifact {
    policy_revision: i64,
    execution: Execution,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Execution {
    context: Value,
    from_id: String,
    from_hash: String,
    from_objects: Vec<Snapshot>,
    reference: Value,
    releases: Vec<Release>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Release {
    id: String,
    hash: String,
    objects: Vec<Snapshot>,
    statements: Vec<Statement>,
    preconditions: Vec<Check>,
    postconditions: Vec<Check>,
    settings: Vec<String>,
    oracle_timeout: u64,
}
#[derive(Deserialize)]
struct Statement {
    id: String,
    migration: String,
    sql: String,
}
#[derive(Deserialize)]
struct Check {
    id: String,
    sql: String,
    expected: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub id: String,
    pub target_id: String,
    pub status: String,
    pub release: String,
    pub error: Option<String>,
}
type Jobs = Arc<Mutex<HashMap<String, Status>>>;
fn jobs() -> &'static Jobs {
    static JOBS: OnceLock<Jobs> = OnceLock::new();
    JOBS.get_or_init(Default::default)
}

fn repository_request(
    repo: &str,
    action: &str,
    content: Option<String>,
    expected: Option<String>,
) -> super::Request {
    super::Request {
        action: action.into(),
        repo: repo.into(),
        path: None,
        content,
        expected,
        revision: None,
        name: None,
        paths: None,
        base: None,
        incoming: None,
    }
}
async fn persist(
    request: &Request,
    event: &Value,
    reference: Option<&Value>,
) -> Result<(), String> {
    for _ in 0..3 {
        let loaded =
            super::handle(repository_request(&request.repo, "local-read", None, None)).await?;
        let text = loaded.as_str().ok_or("Lokale Zielzuordnung fehlt")?;
        let mut store: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        if store["projectId"] != request.connection.project_id {
            return Err("Projektzuordnung geändert".into());
        }
        let target = store["targets"]
            .as_array_mut()
            .and_then(|items| items.iter_mut().find(|t| t["id"] == request.target_id))
            .ok_or("Zielzuordnung entfernt")?;
        if let Some(reference) = reference {
            target["release"] = reference.clone();
        }
        let history = target["history"]
            .as_array_mut()
            .ok_or("Lokale Historie ungültig")?;
        if let Some(old) = history.iter_mut().find(|e| e["id"] == request.run_id) {
            *old = event.clone();
        } else {
            history.insert(0, event.clone());
        }
        match super::handle(repository_request(
            &request.repo,
            "local-write",
            Some(serde_json::to_string_pretty(&store).map_err(|e| e.to_string())? + "\n"),
            Some(text.into()),
        ))
        .await
        {
            Ok(_) => return Ok(()),
            Err(error) if error.contains("geändert") || error.contains("changed") => continue,
            Err(error) => return Err(error),
        }
    }
    Err("Lokale Zielzuordnung wurde wiederholt geändert".into())
}
async fn journal(
    adapter: &dyn DatabaseAdapter,
    request: &Request,
    name: &str,
    body: Value,
) -> Result<(), String> {
    control::append(adapter, &request.connection, &request.run_id, name, &body).await
}
async fn checks(
    tx: &str,
    checks: &[Check],
    transactions: &db::transaction::TransactionState,
    event: &mut Value,
) -> Result<(), String> {
    for check in checks {
        let result = transactions.execute(tx, &check.sql).await?;
        if result.columns.len() != 1 || result.rows.len() != 1 {
            return Err(format!(
                "{}: Prüfung muss eine Zeile und eine Spalte liefern",
                check.id
            ));
        }
        let v = &result.rows[0][&result.columns[0]];
        let value = v
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| v.to_string());
        if v.is_null() || value != check.expected {
            return Err(format!(
                "{}: Erwartetes Prüfergebnis wurde nicht erreicht",
                check.id
            ));
        }
        event["checked"]
            .as_array_mut()
            .unwrap()
            .push(json!(check.id));
    }
    Ok(())
}
async fn identity(
    connection: &Connection,
    tx: &str,
    expected: &Value,
    transactions: &db::transaction::TransactionState,
) -> Result<(), String> {
    let sql = if connection.kind == DatabaseKind::Postgres {
        "SELECT current_database() AS \"database\", current_user AS \"user\", COALESCE(inet_server_addr()::text, 'local') AS \"server\", inet_server_port()::text AS \"port\", NULL::text AS \"edition\""
    } else {
        "SELECT SYS_CONTEXT('USERENV', 'DB_UNIQUE_NAME') AS \"database\", SYS_CONTEXT('USERENV', 'SESSION_USER') AS \"user\", SYS_CONTEXT('USERENV', 'SERVER_HOST') AS \"server\", SYS_CONTEXT('USERENV', 'CON_NAME') AS \"port\", SYS_CONTEXT('USERENV', 'CURRENT_EDITION_NAME') AS \"edition\" FROM dual"
    };
    let actual = transactions.execute(tx, sql).await?;
    if actual.rows.len() != 1 || actual.rows[0] != *expected {
        return Err(
            "Ausführungssitzung zeigt auf eine andere Datenbank, Rolle oder Edition".into(),
        );
    }
    Ok(())
}

async fn authorize(
    request: &Request,
    revision: i64,
    pool: db::pool::PoolState,
    transactions: db::transaction::TransactionState,
) -> Result<(), String> {
    let control = control::Request {
        connection: request.connection.clone(),
        action: "authorize".into(),
        policy: None,
        revision: Some(revision),
        artifact: Some(control::hash(&request.artifact)),
        run_id: None,
        event: None,
        body: None,
        schemas: vec![],
        tx_id: None,
    };
    control::handle(control, pool, transactions)
        .await
        .map(|_| ())
}
#[cfg(test)]
pub static LOST_COMMIT: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

async fn commit(
    request: &Request,
    tx: &str,
    transactions: &db::transaction::TransactionState,
) -> Result<(), String> {
    let result = transactions.commit(tx).await;
    #[cfg(test)]
    if result.is_ok() && LOST_COMMIT.lock().unwrap().as_deref() == Some(&request.run_id) {
        return Err("Commit-Antwort verloren; Ausgang ungeklärt".into());
    }
    let _ = request;
    result
}

async fn run(
    request: &Request,
    pool: db::pool::PoolState,
    transactions: db::transaction::TransactionState,
) -> Result<(), String> {
    request.connection.writable()?;
    let artifact: Artifact = serde_json::from_str(&request.artifact).map_err(|e| e.to_string())?;
    let plan = artifact.execution;
    if plan.releases.is_empty() {
        return Err("Ausführungsplan ist leer".into());
    }
    let c = &request.connection;
    let adapter = c.adapter(pool.clone())?;
    let lock = control::lock(c, &[], &transactions, &pool).await?;
    let mut event = json!({"id":request.run_id,"startedAt":chrono::Utc::now().to_rfc3339(),"finishedAt":null,"from":{"id":plan.from_id},"to":plan.reference,"status":"running","completedMigrations":[],"completedStatements":[],"checked":[],"inFlightStatement":null,"error":null});
    let mut last_reference = None;
    let mut leased = false;
    let outcome = async {
        authorize(request,artifact.policy_revision,pool.clone(),transactions.clone()).await?;
        snapshot::verify(adapter.as_ref(),c.kind,&plan.from_objects).await?;
        persist(request,&event,None).await?;
        journal(adapter.as_ref(),request,"started",json!({"from":plan.from_id,"to":plan.reference,"artifact":control::hash(&request.artifact),"policyRevision":artifact.policy_revision})).await?;
        let state = table(&c.schema,"STATE");
        let result = adapter.execute_query(&format!("UPDATE {state} SET \"LEASE\"={}, \"STATUS\"='running' WHERE \"PROJECT_ID\"={} AND \"RELEASE_HASH\"={} AND \"STATUS\"='ready' AND \"LEASE\" IS NULL",literal(&request.run_id),literal(&c.project_id),literal(&plan.from_hash))).await?;
        if result.rows_affected!=Some(1) { return Err("Datenbankstand geändert oder ungeklärte Ausführung".into()); }
        leased = true;
        let mut previous = &plan.from_objects;
        for release in &plan.releases {
            control::check_lock(c,&lock,&transactions).await?;
            snapshot::verify(adapter.as_ref(),c.kind,previous).await?;
            let invalid_before = if c.kind==DatabaseKind::Oracle {adapter.list_invalid_objects(Some(&c.schema)).await?}else{vec![]};
            let tx = transactions.begin(c.kind,&c.connection_string,c.database.as_deref(),&pool).await?;
            let mut committed = false;
            let step = async {
                if c.kind==DatabaseKind::Oracle { transactions.versioning_oracle_timeout(&tx,release.oracle_timeout).await?; }
                for sql in &release.settings { transactions.execute(&tx,sql).await?; }
                identity(c, &tx, &plan.context, &transactions).await?;
                let mut schemas: Vec<String> = previous.iter().chain(&release.objects).map(|o| o.schema.clone()).collect();
                schemas.push(c.schema.clone());
                schemas.sort();
                schemas.dedup();
                for schema in schemas {
                    let mut scoped = c.clone();
                    scoped.schema = schema;
                    control::execution_lock(&scoped, &tx, &transactions).await?;
                }
                if c.kind == DatabaseKind::Postgres {
                    let session = transactions.versioning_adapter(&tx, pool.clone()).await?;
                    snapshot::verify(session.as_ref(), c.kind, previous).await?;
                } else {
                    snapshot::verify(adapter.as_ref(), c.kind, previous).await?;
                }
                checks(&tx,&release.preconditions,&transactions,&mut event).await?;
                for (index, statement) in release.statements.iter().enumerate() {
                    control::check_lock(c,&lock,&transactions).await?;
                    event["inFlightStatement"] = json!(statement.id);
                    journal(adapter.as_ref(),request,"statement_started",json!({"statement":statement.id,"checksum":control::hash(&statement.sql)})).await?;
                    persist(request,&event,last_reference.as_ref()).await?;
                    transactions.execute(&tx,&statement.sql).await?;
                    journal(adapter.as_ref(),request,"statement_confirmed",json!({"statement":statement.id})).await?;
                    event["completedStatements"].as_array_mut().unwrap().push(json!(statement.id));
                    event["inFlightStatement"] = Value::Null;
                    if release.statements.get(index + 1).is_none_or(|next|next.migration!=statement.migration) && !event["completedMigrations"].as_array().unwrap().contains(&json!(statement.migration)) { event["completedMigrations"].as_array_mut().unwrap().push(json!(statement.migration)); }
                }
                checks(&tx,&release.postconditions,&transactions,&mut event).await?;
                let advance = format!("UPDATE {state} SET \"RELEASE_ID\"={}, \"RELEASE_HASH\"={} WHERE \"PROJECT_ID\"={} AND \"LEASE\"={} AND \"STATUS\"='running'",literal(&release.id),literal(&release.hash),literal(&c.project_id),literal(&request.run_id));
                if c.kind==DatabaseKind::Postgres {
                    let session = transactions.versioning_adapter(&tx,pool.clone()).await?;
                    snapshot::verify(session.as_ref(),c.kind,&release.objects).await?;
                    snapshot::verify_removed(session.as_ref(),previous,&release.objects).await?;
                    if transactions.execute(&tx,&advance).await?.rows_affected!=Some(1) { return Err("Deployment-Sperre verloren".into()); }
                }
                control::check_lock(c,&lock,&transactions).await?;
                journal(adapter.as_ref(),request,"commit_requested",json!({"release":release.id})).await?;
                commit(request,&tx,&transactions).await?;
                committed = true;
                journal(adapter.as_ref(),request,"commit_confirmed",json!({"release":release.id})).await?;
                if c.kind==DatabaseKind::Oracle {
                    snapshot::verify(adapter.as_ref(),c.kind,&release.objects).await?;
                    snapshot::verify_removed(adapter.as_ref(),previous,&release.objects).await?;
                    let invalid = adapter.list_invalid_objects(Some(&c.schema)).await?;
                    if invalid.iter().any(|item| release.objects.iter().any(|o|o.name==item.name) || !invalid_before.iter().any(|old|old.name==item.name && old.object_type==item.object_type)) { return Err("Oracle enthält ungültige Objekte; vor dem Fortsetzen kompilieren und prüfen".into()); }
                    control::check_lock(c,&lock,&transactions).await?;
                    if adapter.execute_query(&advance).await?.rows_affected!=Some(1) { return Err("Deployment-Sperre verloren".into()); }
                }
                Ok::<(),String>(())
            }.await;
            if let Err(error) = step {
                if !committed { if let Err(rollback) = transactions.rollback(&tx).await { return Err(format!("{error}; Rollback konnte nicht bestätigt werden: {rollback}")); } }
                return Err(error);
            }
            let mut reference = plan.reference.clone(); reference["id"] = json!(release.id); reference["path"] = json!(format!("database/releases/{}.json",release.id));
            last_reference = Some(reference);
            persist(request,&event,last_reference.as_ref()).await?;
            if let Some(status)=jobs().lock().await.get_mut(&request.run_id) { status.release = release.id.clone(); }
            previous = &release.objects;
        }
        journal(adapter.as_ref(),request,"succeeded",json!({"to":plan.reference})).await?;
        if adapter.execute_query(&format!("UPDATE {state} SET \"LEASE\"=NULL, \"STATUS\"='ready' WHERE \"PROJECT_ID\"={} AND \"LEASE\"={}",literal(&c.project_id),literal(&request.run_id))).await?.rows_affected!=Some(1) { return Err("Deployment-Abschluss nicht bestätigt".into()); }
        leased = false;
        Ok(())
    }.await;
    if outcome.is_err() && leased {
        let _ = adapter
            .execute_query(&format!(
                "UPDATE {} SET \"STATUS\"='failed' WHERE \"PROJECT_ID\"={} AND \"LEASE\"={}",
                table(&c.schema, "STATE"),
                literal(&c.project_id),
                literal(&request.run_id)
            ))
            .await;
    }
    event["status"] = json!(if outcome.is_ok() {
        "succeeded"
    } else {
        "failed"
    });
    event["finishedAt"] = json!(chrono::Utc::now().to_rfc3339());
    if let Err(error) = &outcome {
        event["error"] = json!(error);
        let _=journal(adapter.as_ref(),request,"failed",json!({"inFlightStatement":event["inFlightStatement"],"completedStatements":event["completedStatements"]})).await;
    }
    let persisted = persist(request, &event, last_reference.as_ref()).await;
    let unlocked = transactions.rollback(&lock).await;
    outcome.and(persisted).and(unlocked)
}

pub async fn start(
    request: Request,
    pool: db::pool::PoolState,
    transactions: db::transaction::TransactionState,
) -> Result<String, String> {
    request.connection.writable()?;
    if request.artifact.len() > 16 * 1024 * 1024
        || request.run_id.len() > 64
        || request.run_id.is_empty()
    {
        return Err("Ungültiger Ausführungsplan".into());
    }
    let _: Artifact = serde_json::from_str(&request.artifact).map_err(|e| e.to_string())?;
    let id = request.run_id.clone();
    let mut jobs = jobs().lock().await;
    if jobs.contains_key(&id) {
        return Err("Lauf wurde bereits gestartet".into());
    }
    if jobs.len() >= 256 {
        jobs.retain(|_, j| j.status == "running");
    }
    if jobs.len() >= 256 {
        return Err("Zu viele aktive Läufe".into());
    }
    jobs.insert(
        id.clone(),
        Status {
            id: id.clone(),
            target_id: request.target_id.clone(),
            status: "running".into(),
            release: String::new(),
            error: None,
        },
    );
    drop(jobs);
    tokio::spawn(async move {
        use futures_util::FutureExt;
        let result = std::panic::AssertUnwindSafe(run(&request, pool, transactions))
            .catch_unwind()
            .await
            .unwrap_or_else(|_| Err("Ausführung unterbrochen; Datenbankjournal prüfen".into()));
        if let Some(status) = self::jobs().lock().await.get_mut(&request.run_id) {
            status.status = if result.is_ok() {
                "succeeded"
            } else {
                "failed"
            }
            .into();
            status.error = result.err();
        }
    });
    Ok(id)
}
pub async fn status(id: &str) -> Result<Status, String> {
    jobs()
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or("Lauf nicht in diesem Prozess vorhanden. Datenbankjournal prüfen.".into())
}
#[tauri::command]
pub async fn versioning_run(
    request: Request,
    pool: tauri::State<'_, db::pool::PoolState>,
    transactions: tauri::State<'_, db::transaction::TransactionState>,
) -> Result<String, String> {
    start(request, pool.inner().clone(), transactions.inner().clone()).await
}
#[tauri::command]
pub async fn versioning_run_status(id: String) -> Result<Status, String> {
    status(&id).await
}

pub async fn start_fleet(
    requests: Vec<Request>,
    pool: db::pool::PoolState,
    transactions: db::transaction::TransactionState,
) -> Result<String, String> {
    if requests.is_empty()
        || requests.len() > 1000
        || requests.iter().map(|r| r.artifact.len()).sum::<usize>() > 64 * 1024 * 1024
    {
        return Err("Eine Rollout-Welle benötigt 1 bis 1000 Ziele".into());
    }
    let mut ids = std::collections::HashSet::new();
    for request in &requests {
        request.connection.writable()?;
        if request.artifact.len() > 16 * 1024 * 1024
            || request.run_id.len() > 64
            || request.run_id.is_empty()
            || !ids.insert(request.run_id.clone())
        {
            return Err("Ungültiger oder doppelter Lauf".into());
        }
        let _: Artifact = serde_json::from_str(&request.artifact).map_err(|e| e.to_string())?;
    }
    let id = format!("fleet-{}", requests[0].run_id);
    let mut state = jobs().lock().await;
    if state.contains_key(&id) || requests.iter().any(|r| state.contains_key(&r.run_id)) {
        return Err("Rollout wurde bereits gestartet".into());
    }
    if state.len() >= 256 {
        state.retain(|_, s| s.status == "running");
    }
    if state.len() + requests.len() + 1 > 1024 {
        return Err("Zu viele aktive Rollouts".into());
    }
    state.insert(
        id.clone(),
        Status {
            id: id.clone(),
            target_id: requests[0].target_id.clone(),
            status: "running".into(),
            release: String::new(),
            error: None,
        },
    );
    for request in &requests {
        state.insert(
            request.run_id.clone(),
            Status {
                id: request.run_id.clone(),
                target_id: request.target_id.clone(),
                status: "running".into(),
                release: String::new(),
                error: None,
            },
        );
    }
    drop(state);
    let job = id.clone();
    tokio::spawn(async move {
        use futures_util::FutureExt;
        let execution = async {
            let mut identities = std::collections::HashSet::new();
            for request in &requests {
                let artifact: Artifact =
                    serde_json::from_str(&request.artifact).map_err(|e| e.to_string())?;
                let parsed: Value =
                    serde_json::from_str(&request.artifact).map_err(|e| e.to_string())?;
                let identity = parsed["binding"]["physicalKey"]
                    .as_str()
                    .ok_or("Physische Zielidentität fehlt")?;
                if !identities.insert(identity.to_string()) {
                    return Err("Datenbankziel mehrfach in derselben Welle".into());
                }
                authorize(
                    request,
                    artifact.policy_revision,
                    pool.clone(),
                    transactions.clone(),
                )
                .await?;
                let adapter = request.connection.adapter(pool.clone())?;
                snapshot::verify(
                    adapter.as_ref(),
                    request.connection.kind,
                    &artifact.execution.from_objects,
                )
                .await?;
                let current=adapter.execute_query(&format!("SELECT \"RELEASE_HASH\", \"STATUS\", \"LEASE\" FROM {} WHERE \"PROJECT_ID\"={}",table(&request.connection.schema,"STATE"),literal(&request.connection.project_id))).await?;
                if !current.rows.first().is_some_and(|r| {
                    r["RELEASE_HASH"] == artifact.execution.from_hash
                        && r["STATUS"] == "ready"
                        && r["LEASE"].is_null()
                }) {
                    return Err("Datenbankstand vor Wellenstart geändert".into());
                }
            }
            for request in &requests {
                if let Some(status) = jobs().lock().await.get_mut(&job) {
                    status.target_id = request.target_id.clone();
                    status.release = request.target_id.clone();
                }
                let outcome = run(request, pool.clone(), transactions.clone()).await;
                if let Some(status) = jobs().lock().await.get_mut(&request.run_id) {
                    status.status = if outcome.is_ok() {
                        "succeeded"
                    } else {
                        "failed"
                    }
                    .into();
                    status.error = outcome.clone().err();
                }
                outcome?;
            }
            Ok::<(), String>(())
        };
        let result = std::panic::AssertUnwindSafe(execution)
            .catch_unwind()
            .await
            .unwrap_or_else(|_| Err("Rollout unterbrochen; Datenbankjournal prüfen".into()));
        if result.is_err() {
            let mut states = jobs().lock().await;
            for request in &requests {
                if let Some(status) = states.get_mut(&request.run_id) {
                    if status.status == "running" {
                        status.status = "failed".into();
                        status.error = Some(
                            "Welle gestoppt. Dieses Ziel wurde nicht gestartet; neu planen.".into(),
                        );
                    }
                }
            }
        }
        if let Some(status) = jobs().lock().await.get_mut(&job) {
            status.status = if result.is_ok() {
                "succeeded"
            } else {
                "failed"
            }
            .into();
            status.error = result.err();
        }
    });
    Ok(id)
}

#[tauri::command]
pub async fn versioning_run_fleet(
    requests: Vec<Request>,
    pool: tauri::State<'_, db::pool::PoolState>,
    transactions: tauri::State<'_, db::transaction::TransactionState>,
) -> Result<String, String> {
    start_fleet(requests, pool.inner().clone(), transactions.inner().clone()).await
}
