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
    #[serde(default)]
    pub promotion: Vec<super::delivery::Promotion>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Artifact {
    policy_revision: i64,
    execution: Execution,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Execution {
    pub format: u32,
    pub context: Value,
    pub from_id: String,
    pub from_hash: String,
    pub from_objects: Vec<Snapshot>,
    pub reference: Value,
    pub objects: Vec<Managed>,
    #[serde(default)]
    pub variances: Vec<Managed>,
    #[serde(default)]
    pub overrides: Vec<String>,
    #[serde(default)]
    pub ahead: Vec<Ahead>,
    #[serde(default)]
    pub mode: Option<String>,
    pub releases: Vec<Release>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Ahead {
    pub object: String,
    pub change: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Managed {
    pub id: String,
    #[serde(flatten)]
    pub snapshot: Snapshot,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Release {
    pub id: String,
    pub hash: String,
    pub objects: Vec<Snapshot>,
    pub statements: Vec<Statement>,
    #[serde(default)]
    pub changes: Vec<PlannedChange>,
    pub preconditions: Vec<Check>,
    pub postconditions: Vec<Check>,
    pub settings: Vec<String>,
    pub oracle_timeout: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PlannedChange {
    pub id: String,
    pub checksum: String,
    pub kind: String,
    #[serde(default)]
    pub requires: Vec<String>,
    pub touches: Vec<Touch>,
    pub preconditions: Vec<Check>,
    pub postconditions: Vec<Check>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Touch {
    pub id: String,
    pub expect: String,
    #[serde(flatten)]
    pub object: Snapshot,
}
#[derive(Deserialize)]
pub(super) struct Statement {
    pub id: String,
    pub migration: String,
    pub sql: String,
}
#[derive(Deserialize)]
pub(super) struct Check {
    pub id: String,
    pub sql: String,
    pub expected: String,
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
        limit: None,
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
    let actual = transactions
        .execute(tx, super::seeds::identity_sql(connection.kind))
        .await?;
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
    super::artifact::verify(request).await?;
    let shared = super::team::verify_request(request).await?;
    let planned: Value =
        serde_json::from_str(&request.artifact).map_err(|_| "Freigabeartefakt ist ungültig")?;
    super::team::verify_variances(
        shared.as_ref().map(|verified| &verified.target),
        &planned["execution"]["variances"],
    )?;
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
    let current = control::handle(control, pool.clone(), transactions).await?;
    let policy: control::Policy = serde_json::from_value(current["policy"].clone())
        .map_err(|_| "Produktionsrichtlinie ist ungültig")?;
    let artifact: Value =
        serde_json::from_str(&request.artifact).map_err(|_| "Freigabeartefakt ist ungültig")?;
    super::production::verify(
        request.connection.adapter(pool.clone())?.as_ref(),
        &request.connection,
        &policy,
        &artifact["execution"],
    )
    .await?;
    if let Some(shared) = &shared {
        super::team::verify_policy(&shared.target, &current["policy"])?;
    }
    super::delivery::verify(request, shared.as_ref(), &current["policy"], pool).await
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

pub(super) const READY: &str = "ready2";

async fn applied(
    adapter: &dyn DatabaseAdapter,
    c: &Connection,
) -> Result<std::collections::HashSet<String>, String> {
    let result = adapter
        .execute_query(&format!(
            "SELECT \"CHANGE_ID\" FROM {} WHERE \"PROJECT_ID\"={}",
            table(&c.schema, "CHANGES"),
            literal(&c.project_id)
        ))
        .await
        .map_err(|e| format!("Abhakliste der Zieldatenbank nicht lesbar: {e}"))?;
    Ok(result
        .rows
        .iter()
        .filter_map(|row| row["CHANGE_ID"].as_str().map(str::to_owned))
        .collect())
}

async fn applied_objects(
    adapter: &dyn DatabaseAdapter,
    c: &Connection,
) -> Result<std::collections::HashMap<String, String>, String> {
    let result = adapter
        .execute_query(&format!(
            "SELECT \"OBJECT_ID\", \"APPLIED_HASH\" FROM {} WHERE \"PROJECT_ID\"={}",
            table(&c.schema, "OBJECTS"),
            literal(&c.project_id)
        ))
        .await
        .map_err(|e| format!("Objektstand der Zieldatenbank nicht lesbar: {e}"))?;
    Ok(result
        .rows
        .iter()
        .filter_map(|row| {
            Some((
                row["OBJECT_ID"].as_str()?.to_owned(),
                row["APPLIED_HASH"].as_str()?.to_owned(),
            ))
        })
        .collect())
}

pub(super) async fn code(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    change: &PlannedChange,
    soll: &Snapshot,
    variance: Option<&Snapshot>,
    last: Option<&str>,
    overridden: bool,
) -> Result<(bool, bool), String> {
    let touch = change
        .touches
        .first()
        .filter(|_| change.touches.len() == 1)
        .ok_or("Programmcode-Änderung muss genau ein Objekt berühren")?;
    let ist = if snapshot::exists(adapter, soll).await? {
        Some(snapshot::definition(adapter, kind, soll).await?)
    } else {
        None
    };
    if ist.as_deref() == Some(soll.definition.as_str()) {
        return Ok((false, true));
    }
    if variance.is_some_and(|v| ist.as_deref() == Some(v.definition.as_str())) {
        return Ok((false, false));
    }
    let previous = match last {
        Some(hash) => ist.as_deref().map(control::hash).as_deref() == Some(hash),
        None => match touch.expect.as_str() {
            "definition" => ist.as_deref() == Some(touch.object.definition.as_str()),
            "absent" => ist.is_none(),
            _ => false,
        },
    };
    if previous || overridden {
        return Ok((true, true));
    }
    Err(format!(
        "{}: Programmcode {}.{} wurde direkt beim Kunden geändert. Übernehmen, als Abweichung festhalten oder Überschreiben freigeben.",
        change.id, soll.schema, soll.name
    ))
}

fn touched<'a>(releases: &'a [Release]) -> std::collections::HashSet<&'a str> {
    releases
        .iter()
        .flat_map(|release| &release.changes)
        .flat_map(|change| change.touches.iter().map(|touch| touch.id.as_str()))
        .collect()
}

pub(super) async fn precheck(
    adapter: &dyn DatabaseAdapter,
    c: &Connection,
    plan: &Execution,
) -> Result<(), String> {
    if plan.format != 2 {
        return Err("Ausführungsplan stammt von einer älteren l8db-Version. Neu planen.".into());
    }
    let ledger = applied(adapter, c).await?;
    let mut planned = std::collections::HashSet::new();
    for change in plan.releases.iter().flat_map(|release| &release.changes) {
        if ledger.contains(&change.id) {
            return Err(format!(
                "Änderung {} ist in dieser Datenbank bereits angewendet. Neu planen.",
                change.id
            ));
        }
        if let Some(missing) = change
            .requires
            .iter()
            .find(|id| !ledger.contains(*id) && !planned.contains(*id))
        {
            return Err(format!(
                "Änderung {} benötigt {missing}, die noch nicht angewendet ist",
                change.id
            ));
        }
        planned.insert(change.id.clone());
    }
    let variances: std::collections::HashSet<&str> =
        plan.variances.iter().map(|v| v.id.as_str()).collect();
    let snapshots: Vec<Snapshot> = plan.variances.iter().map(|v| v.snapshot.clone()).collect();
    snapshot::verify(adapter, c.kind, &snapshots)
        .await
        .map_err(|e| format!("Festgehaltene Abweichung hat sich verändert. {e}"))?;
    if let Some(missing) = plan.ahead.iter().find(|a| !ledger.contains(&a.change)) {
        return Err(format!(
            "Vorgezogene Änderung {} ist in dieser Datenbank nicht abgehakt. Neu planen.",
            missing.change
        ));
    }
    let ahead: std::collections::HashSet<&str> =
        plan.ahead.iter().map(|a| a.object.as_str()).collect();
    let touched = touched(&plan.releases);
    let untouched: Vec<Snapshot> = plan
        .objects
        .iter()
        .filter(|o| {
            !touched.contains(o.id.as_str())
                && !variances.contains(o.id.as_str())
                && !ahead.contains(o.id.as_str())
        })
        .map(|o| o.snapshot.clone())
        .collect();
    snapshot::verify(adapter, c.kind, &untouched).await
}

fn change_sql(c: &Connection, change: &PlannedChange, release: Option<&str>, run: &str) -> String {
    format!("INSERT INTO {} (\"PROJECT_ID\", \"CHANGE_ID\", \"CHECKSUM\", \"KIND\", \"SOURCE\", \"RELEASE_ID\", \"RUN_ID\", \"APPLIED_AT\", \"APPLIED_BY\") VALUES ({}, {}, {}, {}, 'rollout', {}, {}, {}, {})",table(&c.schema,"CHANGES"),literal(&c.project_id),literal(&change.id),literal(&change.checksum),literal(&change.kind),release.map(literal).unwrap_or_else(|| "NULL".into()),literal(run),c.now_sql(),c.actor_sql())
}

pub(super) fn object_sql(c: &Connection, id: &str, hash: &str, change: Option<&str>) -> String {
    let objects = table(&c.schema, "OBJECTS");
    let change = change.map(literal).unwrap_or_else(|| "NULL".into());
    if c.kind == DatabaseKind::Oracle {
        format!("MERGE INTO {objects} t USING (SELECT {} AS p, {} AS o, {} AS h, {change} AS c FROM dual) s ON (t.\"PROJECT_ID\"=s.p AND t.\"OBJECT_ID\"=s.o) WHEN MATCHED THEN UPDATE SET t.\"APPLIED_HASH\"=s.h, t.\"CHANGE_ID\"=s.c, t.\"APPLIED_AT\"={} WHEN NOT MATCHED THEN INSERT (\"PROJECT_ID\", \"OBJECT_ID\", \"APPLIED_HASH\", \"CHANGE_ID\", \"APPLIED_AT\") VALUES (s.p, s.o, s.h, s.c, {})",literal(&c.project_id),literal(id),literal(hash),c.now_sql(),c.now_sql())
    } else {
        format!("INSERT INTO {objects} (\"PROJECT_ID\", \"OBJECT_ID\", \"APPLIED_HASH\", \"CHANGE_ID\", \"APPLIED_AT\") VALUES ({}, {}, {}, {change}, {}) ON CONFLICT (\"PROJECT_ID\", \"OBJECT_ID\") DO UPDATE SET \"APPLIED_HASH\"=EXCLUDED.\"APPLIED_HASH\", \"CHANGE_ID\"=EXCLUDED.\"CHANGE_ID\", \"APPLIED_AT\"=EXCLUDED.\"APPLIED_AT\"",literal(&c.project_id),literal(id),literal(hash),c.now_sql())
    }
}

async fn before(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    change: &PlannedChange,
) -> Result<(), String> {
    for touch in &change.touches {
        match touch.expect.as_str() {
            "definition" => snapshot::verify(adapter, kind, std::slice::from_ref(&touch.object))
                .await
                .map_err(|e| format!("{}: Vorher-Stand stimmt nicht. {e}", change.id))?,
            "absent" => snapshot::verify_absent(adapter, &touch.object)
                .await
                .map_err(|e| format!("{}: {e}", change.id))?,
            "check" => {}
            _ => return Err("Ungültige Objekterwartung im Ausführungsplan".into()),
        }
    }
    Ok(())
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
    let variances: std::collections::HashSet<&str> =
        plan.variances.iter().map(|v| v.id.as_str()).collect();
    let targets: HashMap<&str, &Snapshot> = plan
        .objects
        .iter()
        .map(|o| (o.id.as_str(), &o.snapshot))
        .collect();
    let all_targets: Vec<Snapshot> = plan.objects.iter().map(|o| o.snapshot.clone()).collect();
    let mut started = false;
    let outcome = async {
        authorize(request,artifact.policy_revision,pool.clone(),transactions.clone()).await?;
        precheck(adapter.as_ref(), c, &plan).await?;
        started = true;
        persist(request,&event,None).await?;
        journal(adapter.as_ref(),request,"started",json!({"from":plan.from_id,"to":plan.reference,"artifact":control::hash(&request.artifact),"policyRevision":artifact.policy_revision,"variances":plan.variances.iter().map(|v| json!({"object":v.id,"hash":control::hash(&v.snapshot.definition)})).collect::<Vec<_>>()})).await?;
        let state = table(&c.schema,"STATE");
        let result = adapter.execute_query(&format!("UPDATE {state} SET \"LEASE\"={}, \"STATUS\"='running' WHERE \"PROJECT_ID\"={} AND \"RELEASE_HASH\"={} AND \"STATUS\"='{READY}' AND \"LEASE\" IS NULL",literal(&request.run_id),literal(&c.project_id),literal(&plan.from_hash))).await?;
        if result.rows_affected!=Some(1) { return Err("Datenbankstand geändert oder ungeklärte Ausführung".into()); }
        leased = true;
        let mut last = applied_objects(adapter.as_ref(), c).await?;
        let variance_map: std::collections::HashMap<&str, &Snapshot> = plan.variances.iter().map(|v| (v.id.as_str(), &v.snapshot)).collect();
        event["skippedChanges"] = json!([]);
        let count = plan.releases.len();
        let change_mode = plan.mode.as_deref() == Some("change");
        for (index, release) in plan.releases.iter().enumerate() {
            control::check_lock(c,&lock,&transactions).await?;
            let later = touched(&plan.releases[index + 1..]);
            let mut settled: Vec<(&str, &Snapshot)> = release
                .changes
                .iter()
                .flat_map(|change| change.touches.iter().map(|t| t.id.as_str()))
                .filter(|id| !change_mode && !later.contains(id) && !variances.contains(id))
                .filter_map(|id| targets.get(id).map(|snapshot| (id, *snapshot)))
                .collect();
            settled.sort_by_key(|(id, _)| *id);
            settled.dedup_by_key(|(id, _)| *id);
            let settled_snapshots: Vec<Snapshot> = settled.iter().map(|(_, s)| (*s).clone()).collect();
            let planned_statements: usize = release.changes.iter().map(|change| release.statements.iter().filter(|s| s.migration == change.id).count()).sum();
            if planned_statements != release.statements.len() { return Err("Anweisungen ohne zugehörige Änderung im Ausführungsplan".into()); }
            let invalid_before = if c.kind==DatabaseKind::Oracle {adapter.list_invalid_objects(Some(&c.schema)).await?}else{vec![]};
            let tx = transactions.begin(c.kind,&c.connection_string,c.database.as_deref(),&pool).await?;
            let mut committed = false;
            let step = async {
                if c.kind==DatabaseKind::Oracle { transactions.versioning_oracle_timeout(&tx,release.oracle_timeout).await?; }
                for sql in &release.settings { transactions.execute(&tx,sql).await?; }
                identity(c, &tx, &plan.context, &transactions).await?;
                let mut schemas: Vec<String> = plan.objects.iter().map(|o| o.snapshot.schema.clone()).chain(release.objects.iter().map(|o| o.schema.clone())).collect();
                schemas.push(c.schema.clone());
                schemas.sort();
                schemas.dedup();
                for schema in schemas {
                    let mut scoped = c.clone();
                    scoped.schema = schema;
                    control::execution_lock(&scoped, &tx, &transactions).await?;
                }
                if !change_mode { checks(&tx,&release.preconditions,&transactions,&mut event).await?; }
                for change in &release.changes {
                    control::check_lock(c,&lock,&transactions).await?;
                    let session = if c.kind == DatabaseKind::Postgres { Some(transactions.versioning_adapter(&tx, pool.clone()).await?) } else { None };
                    let inspector: &dyn DatabaseAdapter = session.as_deref().unwrap_or(adapter.as_ref());
                    let soll = (change.kind == "repeatable").then(|| change.touches.first().and_then(|t| release.objects.iter().find(|o| o.schema == t.object.schema && o.name == t.object.name && o.kind == t.object.kind).map(|o| (t.id.as_str(), o)))).flatten();
                    let apply = match soll {
                        Some((id, soll)) => {
                            let (apply, settled) = code(inspector, c.kind, change, soll, variance_map.get(id).copied(), last.get(id).map(String::as_str), plan.overrides.iter().any(|o| o == id)).await?;
                            if settled { last.insert(id.to_string(), control::hash(&soll.definition)); }
                            apply
                        }
                        None => { before(inspector, c.kind, change).await?; true }
                    };
                    drop(session);
                    if !apply { event["skippedChanges"].as_array_mut().unwrap().push(json!(change.id)); }
                    checks(&tx,&change.preconditions,&transactions,&mut event).await?;
                    for statement in release.statements.iter().filter(|s| apply && s.migration == change.id) {
                        control::check_lock(c,&lock,&transactions).await?;
                        event["inFlightStatement"] = json!(statement.id);
                        journal(adapter.as_ref(),request,"statement_started",json!({"statement":statement.id,"checksum":control::hash(&statement.sql)})).await?;
                        persist(request,&event,last_reference.as_ref()).await?;
                        transactions.execute(&tx,&statement.sql).await?;
                        journal(adapter.as_ref(),request,"statement_confirmed",json!({"statement":statement.id})).await?;
                        event["completedStatements"].as_array_mut().unwrap().push(json!(statement.id));
                        event["inFlightStatement"] = Value::Null;
                    }
                    checks(&tx,&change.postconditions,&transactions,&mut event).await?;
                    transactions.execute(&tx,&change_sql(c,change,(!change_mode).then_some(release.id.as_str()),&request.run_id)).await?;
                    event["completedMigrations"].as_array_mut().unwrap().push(json!(change.id));
                }
                if !change_mode { checks(&tx,&release.postconditions,&transactions,&mut event).await?; }
                let advance = format!("UPDATE {state} SET \"RELEASE_ID\"={}, \"RELEASE_HASH\"={} WHERE \"PROJECT_ID\"={} AND \"LEASE\"={} AND \"STATUS\"='running'{}",literal(&release.id),literal(&release.hash),literal(&c.project_id),literal(&request.run_id),if change_mode { format!(" AND \"RELEASE_HASH\"={}",literal(&release.hash)) } else { String::new() });
                let last_step = index + 1 == count && !change_mode;
                if c.kind==DatabaseKind::Postgres {
                    let session = transactions.versioning_adapter(&tx,pool.clone()).await?;
                    snapshot::verify(session.as_ref(),c.kind,&settled_snapshots).await?;
                    if last_step { snapshot::verify_removed(session.as_ref(),&plan.from_objects,&all_targets).await?; }
                    for (id, snapshot) in &settled { transactions.execute(&tx,&object_sql(c,id,&control::hash(&snapshot.definition),None)).await?; }
                    if transactions.execute(&tx,&advance).await?.rows_affected!=Some(1) { return Err("Deployment-Sperre verloren".into()); }
                }
                control::check_lock(c,&lock,&transactions).await?;
                journal(adapter.as_ref(),request,"commit_requested",json!({"release":release.id})).await?;
                commit(request,&tx,&transactions).await?;
                committed = true;
                journal(adapter.as_ref(),request,"commit_confirmed",json!({"release":release.id})).await?;
                if c.kind==DatabaseKind::Oracle {
                    snapshot::verify(adapter.as_ref(),c.kind,&settled_snapshots).await?;
                    if last_step { snapshot::verify_removed(adapter.as_ref(),&plan.from_objects,&all_targets).await?; }
                    let invalid = adapter.list_invalid_objects(Some(&c.schema)).await?;
                    if invalid.iter().any(|item| all_targets.iter().any(|o|o.name==item.name) || !invalid_before.iter().any(|old|old.name==item.name && old.object_type==item.object_type)) { return Err("Oracle enthält ungültige Objekte; vor dem Fortsetzen kompilieren und prüfen".into()); }
                    control::check_lock(c,&lock,&transactions).await?;
                    for (id, snapshot) in &settled { adapter.execute_query(&object_sql(c,id,&control::hash(&snapshot.definition),None)).await?; }
                    if adapter.execute_query(&advance).await?.rows_affected!=Some(1) { return Err("Deployment-Sperre verloren".into()); }
                }
                Ok::<(),String>(())
            }.await;
            if let Err(error) = step {
                if !committed { if let Err(rollback) = transactions.rollback(&tx).await { return Err(format!("{error}; Rollback konnte nicht bestätigt werden: {rollback}")); } }
                return Err(error);
            }
            if !change_mode {
                let mut reference = plan.reference.clone(); reference["id"] = json!(release.id); reference["path"] = json!(format!("database/releases/{}.json",release.id));
                last_reference = Some(reference);
            }
            persist(request,&event,last_reference.as_ref()).await?;
            if let Some(status)=jobs().lock().await.get_mut(&request.run_id) { status.release = release.id.clone(); }
        }
        journal(adapter.as_ref(),request,"succeeded",json!({"to":plan.reference})).await?;
        if adapter.execute_query(&format!("UPDATE {state} SET \"LEASE\"=NULL, \"STATUS\"='{READY}' WHERE \"PROJECT_ID\"={} AND \"LEASE\"={}",literal(&c.project_id),literal(&request.run_id))).await?.rows_affected!=Some(1) { return Err("Deployment-Abschluss nicht bestätigt".into()); }
        leased = false;
        Ok(())
    }.await;
    if !started {
        let unlocked = transactions.rollback(&lock).await;
        return outcome.and(unlocked);
    }
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
                precheck(adapter.as_ref(), &request.connection, &artifact.execution).await?;
                let current=adapter.execute_query(&format!("SELECT \"RELEASE_HASH\", \"STATUS\", \"LEASE\" FROM {} WHERE \"PROJECT_ID\"={}",table(&request.connection.schema,"STATE"),literal(&request.connection.project_id))).await?;
                if !current.rows.first().is_some_and(|r| {
                    r["RELEASE_HASH"] == artifact.execution.from_hash
                        && r["STATUS"] == READY
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
