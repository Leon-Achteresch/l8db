use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_postgres::Client;
use zeroize::Zeroizing;

use super::audit::{self, Actor};
use super::crypto::{self, Digests, Encryptor};
use super::jobs::{self, Emit, Job, CANCELLED};
use super::mask::{self, Column, MaskRule, Masker, Stats};
use super::pg::{self, Branch, DatabaseInfo, Marker, ServerInfo, TableCount};
use super::pipeline::{self, Running, Tool, Tools};
use super::vault::{self, DatabasePolicy, Vault, VaultStatus};
use crate::db::map_pg_err;
use crate::db::pool::PoolState;

const SCHEMA_LIMIT: usize = 64 * 1024 * 1024;
const MANIFEST_LIMIT: u64 = 64 * 1024 * 1024;
const CLONE_LIMIT: i64 = 1 << 30;
const ORPHAN_HOURS: i64 = 6;
const MAX_KEEP_HOURS: u32 = 24 * 90;

#[derive(Clone)]
pub struct Context {
    pub connection_string: String,
    pub root: PathBuf,
    pub tool_paths: HashMap<String, String>,
    pub pool: PoolState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Full,
    Schema,
    Anonymized,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Full => "full",
            Kind::Schema => "schema",
            Kind::Anonymized => "anonymized",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "full" => Some(Kind::Full),
            "schema" => Some(Kind::Schema),
            "anonymized" => Some(Kind::Anonymized),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Method {
    #[default]
    Auto,
    Clone,
    Stream,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub server: String,
    pub database: String,
    #[serde(default)]
    pub root: String,
    #[serde(default)]
    pub branch: Option<String>,
    pub label: String,
    #[serde(default)]
    pub note: String,
    pub trigger: String,
    pub created_at: String,
    pub created_by: Actor,
    pub server_version: String,
    pub dump_version: String,
    pub meta: pg::DatabaseMeta,
    pub counts: Vec<TableCount>,
    pub columns: Vec<Column>,
    pub data: Digests,
    pub schema: Digests,
    #[serde(default)]
    pub protected: bool,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub id: String,
    pub server: String,
    pub database: String,
    pub root: String,
    pub label: String,
    pub note: String,
    pub trigger: String,
    pub created_at: String,
    pub created_by: Option<Actor>,
    pub server_version: String,
    pub bytes: u64,
    pub plain_bytes: u64,
    pub tables: usize,
    pub rows: i64,
    pub protected: bool,
    pub expires_at: Option<String>,
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRequest {
    pub database: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub scheduled: bool,
    #[serde(default)]
    pub server: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEntry {
    pub key: String,
    pub server: String,
    pub database: String,
    pub schedule: vault::Schedule,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchRequest {
    pub source: String,
    pub name: String,
    pub kind: Kind,
    #[serde(default)]
    pub method: Method,
    #[serde(default)]
    pub snapshot: Option<String>,
    #[serde(default)]
    pub ttl_hours: Option<u32>,
    #[serde(default)]
    pub protected: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRequest {
    pub database: String,
    pub snapshot: String,
    #[serde(default)]
    pub keep_hours: u32,
    #[serde(default)]
    pub confirm: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetRequest {
    pub name: String,
    #[serde(default)]
    pub confirm: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Run {
    Branch(BranchRequest),
    Restore(RestoreRequest),
    Reset(TargetRequest),
    Delete(TargetRequest),
    Sweep,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Update {
    Protection {
        database: String,
        protection: Option<String>,
        #[serde(default)]
        confirm: String,
    },
    TeamMasking {
        database: String,
        rules: Vec<MaskRule>,
    },
    Branch {
        name: String,
        protected: bool,
        expires_at: Option<String>,
        #[serde(default)]
        confirm: String,
    },
    Rename {
        name: String,
        to: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Local {
    Snapshot {
        id: String,
        label: String,
        note: String,
        protected: bool,
        expires_at: Option<String>,
    },
    DeleteSnapshot {
        id: String,
    },
    Policy {
        key: String,
        policy: DatabasePolicy,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SchemaSource {
    Live { database: String },
    Snapshot { id: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub dump: Option<String>,
    pub psql: Option<String>,
    pub anonymize: bool,
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub server: ServerInfo,
    pub database: String,
    pub root: String,
    pub databases: Vec<DatabaseInfo>,
    pub snapshots: Vec<SnapshotInfo>,
    pub policy_key: String,
    pub policy: DatabasePolicy,
    pub vault: VaultStatus,
    pub tools: ToolStatus,
    pub read_only: bool,
}

pub struct Server {
    pub client: Client,
    pub info: ServerInfo,
}

impl Server {
    pub async fn connect(connection_string: &str) -> Result<Self, String> {
        let client = pg::maintenance(connection_string).await?;
        let info = pg::server_info(&client).await?;
        Ok(Self { client, info })
    }

    pub fn key(&self, database: &str) -> String {
        format!("{}/{database}", self.info.identity)
    }

    pub fn actor(&self) -> Actor {
        Actor::local(Some(self.info.user.clone()))
    }

    fn privileged(&self, database: &DatabaseInfo) -> bool {
        self.info.superuser || database.is_owner
    }

    fn may_create(&self) -> Result<(), String> {
        if self.info.superuser || self.info.create_db {
            Ok(())
        } else {
            Err(format!(
                "Die Rolle „{}“ darf keine Datenbanken anlegen (CREATEDB fehlt).",
                self.info.user
            ))
        }
    }
}

fn writable(connection_string: &str) -> Result<(), String> {
    if crate::db::connection_string_is_read_only(connection_string) {
        Err("Diese Verbindung ist schreibgeschützt; Branching-Vorgänge sind gesperrt.".into())
    } else {
        Ok(())
    }
}

fn check_cancel() -> Result<(), String> {
    if crate::db::execution::cancellation_token().is_cancelled() {
        Err(CANCELLED.into())
    } else {
        Ok(())
    }
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| item.to_string()).collect()
}

fn conninfo(database: &str) -> String {
    format!(
        "--dbname=dbname='{}'",
        database.replace('\\', "\\\\").replace('\'', "\\'")
    )
}

fn restore_args(target: &str, branch: bool) -> Vec<String> {
    let mut args = strings(&["-w", "--exit-on-error"]);
    if branch {
        args.extend(strings(&[
            "-O",
            "-x",
            "--no-publications",
            "--no-subscriptions",
        ]));
    }
    args.push(conninfo(target));
    args
}

fn psql_args(target: &str) -> Vec<String> {
    let mut args = strings(&["-X", "-q", "-w", "-v", "ON_ERROR_STOP=1"]);
    args.push(conninfo(target));
    args
}

fn clip(text: &str, limit: usize) -> String {
    match text.char_indices().nth(limit) {
        Some((index, _)) => format!("{}…", &text[..index]),
        None => text.to_string(),
    }
}

fn stamp() -> String {
    chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string()
}

fn hours_from_now(hours: u32) -> String {
    (chrono::Utc::now() + chrono::Duration::hours(i64::from(hours)))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn parse_time(value: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.with_timezone(&chrono::Utc))
}

fn past(value: Option<&str>) -> bool {
    value
        .and_then(parse_time)
        .is_some_and(|time| time < chrono::Utc::now())
}

fn older_than(value: &str, hours: i64) -> bool {
    parse_time(value).is_some_and(|time| time + chrono::Duration::hours(hours) < chrono::Utc::now())
}

fn valid_time(value: &Option<String>) -> Result<(), String> {
    match value {
        Some(text) if parse_time(text).is_none() => Err("Ungültiges Ablaufdatum".into()),
        _ => Ok(()),
    }
}

pub fn restrict_ready(version: &str) -> bool {
    let numbers: Vec<u32> = version
        .split(|ch: char| !ch.is_ascii_digit())
        .filter_map(|part| part.parse().ok())
        .collect();
    match numbers.as_slice() {
        [major, ..] if *major >= 18 => true,
        [17, minor, ..] => *minor >= 6,
        [16, minor, ..] => *minor >= 10,
        [15, minor, ..] => *minor >= 14,
        [14, minor, ..] => *minor >= 19,
        [13, minor, ..] => *minor >= 22,
        _ => false,
    }
}

fn ensure_restrict(producer: &Tool, psql: &Tool) -> Result<(), String> {
    if producer.restrict && restrict_ready(&psql.version) {
        return Ok(());
    }
    Err(format!(
        "Anonymisierte Branches benötigen PostgreSQL-Werkzeuge mit \\restrict-Schutz (18, 17.6, 16.10, 15.14, 14.19, 13.22 oder neuer). Gefunden: {} {}, psql {}.",
        producer.path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default(),
        producer.version,
        psql.version
    ))
}

fn actor_label(actor: &Actor) -> String {
    match &actor.db_user {
        Some(user) => format!("{user} ({}@{})", actor.os_user, actor.host),
        None => format!("{}@{}", actor.os_user, actor.host),
    }
}

fn branch_of(database: &DatabaseInfo) -> Option<&Branch> {
    database
        .marker
        .as_ref()
        .and_then(|marker| marker.branch.as_ref())
}

fn root_of(databases: &[DatabaseInfo], name: &str) -> String {
    let mut current = name.to_string();
    for _ in 0..64 {
        let parent = databases
            .iter()
            .find(|database| database.name == current)
            .and_then(branch_of)
            .map(|branch| branch.parent.clone());
        match parent {
            Some(parent)
                if parent != current
                    && databases.iter().any(|database| database.name == parent) =>
            {
                current = parent
            }
            _ => break,
        }
    }
    current
}

fn family(databases: &[DatabaseInfo], root: &str) -> Vec<DatabaseInfo> {
    let mut names = vec![root.to_string()];
    let mut index = 0;
    while index < names.len() {
        let parent = names[index].clone();
        for database in databases {
            if branch_of(database).is_some_and(|branch| branch.parent == parent)
                && !names.contains(&database.name)
            {
                names.push(database.name.clone());
            }
        }
        index += 1;
    }
    databases
        .iter()
        .filter(|database| names.contains(&database.name))
        .cloned()
        .collect()
}

fn children<'a>(databases: &'a [DatabaseInfo], name: &str) -> Vec<&'a DatabaseInfo> {
    databases
        .iter()
        .filter(|database| branch_of(database).is_some_and(|branch| branch.parent == name))
        .collect()
}

fn disposable(database: &DatabaseInfo) -> bool {
    branch_of(database).is_some_and(|branch| matches!(branch.kind.as_str(), "previous" | "staging"))
}

fn masking_rules(team: &Marker, strict: bool, local: &[MaskRule]) -> Vec<MaskRule> {
    let mut rules = team.masking.clone();
    if strict {
        return rules;
    }
    for rule in local {
        if !rules.iter().any(|known| {
            known.schema == rule.schema && known.table == rule.table && known.column == rule.column
        }) {
            rules.push(rule.clone());
        }
    }
    rules
}

fn fingerprint(rules: &[MaskRule]) -> String {
    crypto::hex(&crypto::sha256(&serde_json::to_vec(rules).unwrap_or_default())[..8])
}

fn normalize_schema(text: &str) -> String {
    text.lines()
        .filter(|line| {
            !line.starts_with("\\restrict ")
                && !line.starts_with("\\unrestrict ")
                && !line.starts_with("-- Dumped from database version")
                && !line.starts_with("-- Dumped by pg_dump version")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn release(ctx: &Context, database: &str) {
    use crate::db::connection::{connection_key, parse_connection};
    ctx.pool
        .remove_pool(&connection_key(&ctx.connection_string, Some(database)))
        .await;
    let default = parse_connection(&ctx.connection_string, None)
        .ok()
        .and_then(|(config, _)| config.get_dbname().map(str::to_string));
    if default.as_deref() == Some(database) {
        ctx.pool
            .remove_pool(&connection_key(&ctx.connection_string, None))
            .await;
    }
}

async fn tools(ctx: &Context, server: &ServerInfo) -> Result<Tools, String> {
    pipeline::tools(&ctx.tool_paths, (server.version_num / 10000) as u32).await
}

async fn unique_name(client: &Client, base: &str, prefix: &str) -> Result<String, String> {
    let name = pg::derived_name(base, &format!("{prefix}{}", stamp()));
    if !pg::exists(client, &name).await? {
        return Ok(name);
    }
    let random = crypto::hex(&crypto::random::<3>()?);
    let name = pg::derived_name(base, &format!("{prefix}{}_{random}", stamp()));
    if pg::exists(client, &name).await? {
        return Err(format!("Interner Name „{name}“ ist bereits vergeben."));
    }
    Ok(name)
}

async fn claim(client: &Client, name: &str, marker: &Marker) -> Result<(), String> {
    pg::set_comment(client, name, marker, "").await?;
    pg::make_private(client, name).await
}

async fn created<T>(
    client: &Client,
    name: &str,
    work: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let outcome = work.await;
    if let Err(error) = &outcome {
        if let Err(cleanup) = pg::drop_database(client, name).await {
            return Err(format!(
                "{error}\nAufräumen fehlgeschlagen, „{name}“ bitte manuell löschen: {cleanup}"
            ));
        }
    }
    outcome
}

fn snapshots_dir(vault: &Vault) -> PathBuf {
    vault.root.join("snapshots")
}

fn read_manifest_at(vault: &Vault, dir: &Path, id: &str) -> Result<Manifest, String> {
    let manifest: Manifest = serde_json::from_slice(&vault.read_signed(
        &dir.join("manifest.json"),
        "manifest",
        MANIFEST_LIMIT,
    )?)
    .map_err(|error| format!("Manifest ist ungültig: {error}"))?;
    if manifest.id != id {
        return Err("Das Manifest gehört zu einer anderen Sicherung.".into());
    }
    Ok(manifest)
}

pub fn manifest(vault: &Vault, id: &str) -> Result<Manifest, String> {
    read_manifest_at(vault, &vault.snapshot_dir(id)?, id)
}

fn write_manifest(vault: &Vault, dir: &Path, manifest: &Manifest) -> Result<(), String> {
    vault.write_signed(
        &dir.join("manifest.json"),
        "manifest",
        &serde_json::to_vec_pretty(manifest).map_err(|error| error.to_string())?,
    )
}

fn summary(manifest: &Manifest) -> SnapshotInfo {
    SnapshotInfo {
        id: manifest.id.clone(),
        server: manifest.server.clone(),
        database: manifest.database.clone(),
        root: if manifest.root.is_empty() {
            manifest.database.clone()
        } else {
            manifest.root.clone()
        },
        label: manifest.label.clone(),
        note: manifest.note.clone(),
        trigger: manifest.trigger.clone(),
        created_at: manifest.created_at.clone(),
        created_by: Some(manifest.created_by.clone()),
        server_version: manifest.server_version.clone(),
        bytes: manifest.data.cipher_bytes + manifest.schema.cipher_bytes,
        plain_bytes: manifest.data.plain_bytes,
        tables: manifest.counts.len(),
        rows: manifest.counts.iter().map(|count| count.rows).sum(),
        protected: manifest.protected,
        expires_at: manifest.expires_at.clone(),
        problem: None,
    }
}

pub fn snapshots(vault: &Vault) -> Vec<SnapshotInfo> {
    let Ok(entries) = std::fs::read_dir(snapshots_dir(vault)) else {
        return Vec::new();
    };
    let mut out: Vec<SnapshotInfo> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let id = entry.file_name().to_string_lossy().to_string();
            vault::valid_id(&id).ok()?;
            Some(match manifest(vault, &id) {
                Ok(manifest) => summary(&manifest),
                Err(problem) => SnapshotInfo {
                    id,
                    problem: Some(problem),
                    ..Default::default()
                },
            })
        })
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
    out
}

fn seal_bytes(vault: &Vault, path: &Path, bytes: &[u8]) -> Result<Digests, String> {
    let (mut encryptor, header) = Encryptor::new(vault.keys.file.as_ref(), &vault.keys.key_id)?;
    let mut out = header;
    encryptor.update(bytes, &mut out)?;
    let digests = encryptor.finish(&mut out)?;
    vault::write_private(path, &out)?;
    Ok(digests)
}

async fn audited<F, Fut>(
    root: &Path,
    actor: Actor,
    database: String,
    action: &str,
    target: Option<String>,
    work: F,
) -> Result<Value, String>
where
    F: FnOnce(Arc<Vault>) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let vault = Arc::new(Vault::open(root).await?);
    audit::ensure_intact(&vault).await?;
    let outcome = work(vault.clone()).await;
    let (status, detail) = match &outcome {
        Ok(value) => ("ok", value.clone()),
        Err(error) if error.starts_with(CANCELLED) => ("cancelled", Value::Null),
        Err(error) => ("failed", json!({ "error": clip(error, 800) })),
    };
    let logged = audit::append(&vault, actor, action, status, &database, target, detail).await;
    match (outcome, logged) {
        (Ok(_), Err(error)) => Err(format!(
            "Vorgang ausgeführt, aber nicht protokolliert: {error}"
        )),
        (outcome, _) => outcome,
    }
}

struct Plan<'a> {
    source: &'a str,
    snapshot: Option<&'a Manifest>,
    kind: Kind,
    method: Method,
    target: &'a str,
    rules: &'a [MaskRule],
    marker: Marker,
}

struct Built {
    method: &'static str,
    tables: usize,
    rows: i64,
    masked: Option<Stats>,
    source_at: String,
}

fn masker(plan: &Plan<'_>, vault: &Vault, columns: &[Column]) -> Result<Option<Masker>, String> {
    if plan.kind != Kind::Anonymized {
        return Ok(None);
    }
    Masker::new(plan.rules, columns, Zeroizing::new(*vault.keys.mask)).map(Some)
}

async fn verify_target(
    ctx: &Context,
    job: &Job,
    target: &str,
    expected: &[TableCount],
    kind: Kind,
) -> Result<(usize, i64), String> {
    job.phase("Prüfen");
    let client = pg::connect(&ctx.connection_string, target).await?;
    let actual = pg::counts(&client, true).await?;
    pg::compare_counts(expected, &actual, kind == Kind::Schema)?;
    if kind != Kind::Schema {
        job.phase("Statistiken aufbauen");
        client.batch_execute("ANALYZE").await.map_err(map_pg_err)?;
    }
    Ok((actual.len(), actual.iter().map(|count| count.rows).sum()))
}

async fn build(
    ctx: &Context,
    job: &Job,
    vault: &Vault,
    server: &Server,
    plan: Plan<'_>,
) -> Result<Built, String> {
    if let Some(manifest) = plan.snapshot {
        return from_snapshot(ctx, job, vault, server, &plan, manifest).await;
    }
    let client = &server.client;
    let source = pg::database(client, plan.source).await?;
    if plan.kind == Kind::Full && plan.method != Method::Stream {
        let sessions = pg::sessions(client, plan.source).await?;
        if plan.method == Method::Clone && !sessions.is_empty() {
            let who: Vec<String> = sessions
                .iter()
                .take(5)
                .map(|session| format!("{} ({})", session.user, session.application))
                .collect();
            return Err(format!(
                "„{}“ hat {} aktive Sitzung(en): {}. Ein Klon braucht eine unbenutzte Quelle; Datenstrom-Kopie wählen.",
                plan.source,
                sessions.len(),
                who.join(", ")
            ));
        }
        let fast = server.info.version_num >= 180000
            && client
                .batch_execute("SET file_copy_method = clone")
                .await
                .is_ok();
        let small = source.size.is_some_and(|size| size <= CLONE_LIMIT);
        let protected = source.marker.as_ref().is_some_and(Marker::protected);
        if plan.method == Method::Clone || (sessions.is_empty() && (small || (fast && !protected)))
        {
            job.phase("Klonen");
            match pg::create_clone(client, plan.target, plan.source, server.info.version_num).await
            {
                Ok(()) => {
                    return created(client, plan.target, async {
                        claim(client, plan.target, &plan.marker).await?;
                        Ok(Built {
                            method: "clone",
                            tables: 0,
                            rows: 0,
                            masked: None,
                            source_at: vault::now(),
                        })
                    })
                    .await;
                }
                Err(error) if plan.method == Method::Auto => job.log(format!(
                    "Klonen nicht möglich, Datenstrom-Kopie wird verwendet: {error}"
                )),
                Err(error) => return Err(error),
            }
        }
    }
    from_head(ctx, job, vault, server, &plan).await
}

async fn from_head(
    ctx: &Context,
    job: &Job,
    vault: &Vault,
    server: &Server,
    plan: &Plan<'_>,
) -> Result<Built, String> {
    let client = &server.client;
    job.phase("Werkzeuge prüfen");
    let tools = tools(ctx, &server.info).await?;
    if plan.kind == Kind::Anonymized {
        ensure_restrict(&tools.dump, &tools.psql)?;
    }
    job.phase("Konsistenten Stand festhalten");
    let exported = pg::export_snapshot(&ctx.connection_string, plan.source).await?;
    let columns = pg::columns(&exported.client).await?;
    let mut masker = masker(plan, vault, &columns)?;
    let meta = pg::meta(client, plan.source, server.info.version_num).await?;
    check_cancel()?;
    job.phase("Datenbank anlegen");
    pg::create_empty(client, plan.target, &meta).await?;
    let source_at = vault::now();
    created(client, plan.target, async {
        claim(client, plan.target, &plan.marker).await?;
        let (source_env, secrets) = pipeline::env(&ctx.connection_string, plan.source)?;
        let (target_env, _) = pipeline::env(&ctx.connection_string, plan.target)?;
        let snapshot = format!("--snapshot={}", exported.snapshot);
        job.phase(match plan.kind {
            Kind::Schema => "Schema übertragen",
            Kind::Anonymized => "Daten anonymisiert übertragen",
            Kind::Full => "Daten übertragen",
        });
        let counting = pg::counts(&exported.client, plan.kind != Kind::Schema);
        let transfer = async {
            let anonymized = plan.kind == Kind::Anonymized;
            let mut args = if anonymized {
                strings(&[
                    "-Fp",
                    "-w",
                    "-O",
                    "-x",
                    "-B",
                    "--no-publications",
                    "--no-subscriptions",
                ])
            } else {
                strings(&[
                    "-Fc",
                    "-w",
                    "-O",
                    "-x",
                    "--no-publications",
                    "--no-subscriptions",
                ])
            };
            if plan.kind == Kind::Schema {
                args.push("-s".into());
            }
            if tools.dump.statistics {
                args.push("--no-statistics".into());
            }
            args.push(snapshot.clone());
            args.push(conninfo(plan.source));
            let dump = Running::spawn(
                job,
                &tools.dump.path,
                &args,
                &source_env,
                &secrets,
                false,
                true,
            )?;
            let sink = if anonymized {
                Running::spawn(
                    job,
                    &tools.psql.path,
                    &psql_args(plan.target),
                    &target_env,
                    &secrets,
                    true,
                    false,
                )?
            } else {
                Running::spawn(
                    job,
                    &tools.restore.path,
                    &restore_args(plan.target, true),
                    &target_env,
                    &secrets,
                    true,
                    false,
                )?
            };
            pipeline::dump_into(job, dump, sink, masker.as_mut()).await
        };
        let (moved, expected) = tokio::join!(transfer, counting);
        moved?;
        let expected = expected?;
        let (tables, rows) = verify_target(ctx, job, plan.target, &expected, plan.kind).await?;
        Ok(Built {
            method: "stream",
            tables,
            rows,
            masked: masker.as_ref().map(|masker| masker.stats.clone()),
            source_at: source_at.clone(),
        })
    })
    .await
}

async fn from_snapshot(
    ctx: &Context,
    job: &Job,
    vault: &Vault,
    server: &Server,
    plan: &Plan<'_>,
    manifest: &Manifest,
) -> Result<Built, String> {
    let client = &server.client;
    job.phase("Werkzeuge prüfen");
    let tools = tools(ctx, &server.info).await?;
    if plan.kind == Kind::Anonymized {
        ensure_restrict(&tools.restore, &tools.psql)?;
    }
    let mut masker = masker(plan, vault, &manifest.columns)?;
    let path = vault.snapshot_dir(&manifest.id)?.join("data.enc");
    check_cancel()?;
    job.phase("Datenbank anlegen");
    pg::create_empty(client, plan.target, &manifest.meta).await?;
    created(client, plan.target, async {
        claim(client, plan.target, &plan.marker).await?;
        let (env, secrets) = pipeline::env(&ctx.connection_string, plan.target)?;
        job.phase("Aus Sicherung wiederherstellen");
        match masker.as_mut() {
            Some(masker) => {
                let mut args = strings(&[
                    "-f",
                    "-",
                    "-O",
                    "-x",
                    "--no-publications",
                    "--no-subscriptions",
                ]);
                if tools.restore.statistics {
                    args.push("--no-statistics".into());
                }
                let middle =
                    Running::spawn(job, &tools.restore.path, &args, &env, &secrets, true, true)?;
                let sink = Running::spawn(
                    job,
                    &tools.psql.path,
                    &psql_args(plan.target),
                    &env,
                    &secrets,
                    true,
                    false,
                )?;
                pipeline::vault_through(job, vault, &path, &manifest.data, middle, sink, masker)
                    .await?;
            }
            None => {
                let mut args = restore_args(plan.target, true);
                if plan.kind == Kind::Schema {
                    args.insert(0, "-s".into());
                }
                let sink =
                    Running::spawn(job, &tools.restore.path, &args, &env, &secrets, true, false)?;
                pipeline::vault_into(job, vault, &path, &manifest.data, sink).await?;
            }
        }
        let (tables, rows) =
            verify_target(ctx, job, plan.target, &manifest.counts, plan.kind).await?;
        Ok(Built {
            method: "snapshot",
            tables,
            rows,
            masked: masker.as_ref().map(|masker| masker.stats.clone()),
            source_at: manifest.created_at.clone(),
        })
    })
    .await
}

async fn take_snapshot(
    ctx: &Context,
    job: &Job,
    vault: &Vault,
    server: &Server,
    request: &SnapshotRequest,
    actor: &Actor,
) -> Result<Value, String> {
    let client = &server.client;
    if request
        .server
        .as_ref()
        .is_some_and(|expected| *expected != server.info.identity)
    {
        return Err(
            "Die Verbindung zeigt nicht mehr auf den geplanten Server; Sicherung übersprungen."
                .into(),
        );
    }
    let info = pg::database(client, &request.database).await?;
    let databases = pg::databases(client).await?;
    let root = root_of(&databases, &info.name);
    let root_masked = databases
        .iter()
        .find(|database| database.name == root)
        .and_then(|database| database.marker.as_ref())
        .is_some_and(Marker::masked);
    let branch = info
        .marker
        .as_ref()
        .and_then(|marker| marker.branch.as_ref());
    let masked_data =
        !branch.is_some_and(|branch| matches!(branch.kind.as_str(), "anonymized" | "schema"));
    if info.marker.as_ref().is_some_and(Marker::masked) || (root_masked && masked_data) {
        return Err(format!(
            "„{}“ gehört zu einer maskiert geschützten Datenbank: lokale Sicherungen mit Klartextdaten sind gesperrt. Einen anonymisierten Branch verwenden.",
            info.name
        ));
    }
    let branch_id = branch.map(|branch| branch.id.clone());
    pg::try_lock(client, &info.name).await?;
    job.phase("Werkzeuge prüfen");
    let tools = tools(ctx, &server.info).await?;
    let meta = pg::meta(client, &info.name, server.info.version_num).await?;
    let policy = vault
        .load_policy()?
        .databases
        .get(&server.key(&root))
        .cloned()
        .unwrap_or_default();
    job.phase("Konsistenten Stand festhalten");
    let exported = pg::export_snapshot(&ctx.connection_string, &info.name).await?;
    let id = vault::new_id()?;
    let dir = snapshots_dir(vault).join(format!(".tmp-{id}"));
    vault::private_dir(&dir)?;
    let written = async {
        let (env, secrets) = pipeline::env(&ctx.connection_string, &info.name)?;
        let snapshot = format!("--snapshot={}", exported.snapshot);
        let mut args = strings(&["-Fc", "-w"]);
        if tools.dump.statistics {
            args.push("--no-statistics".into());
        }
        args.push(snapshot.clone());
        args.push(conninfo(&info.name));
        job.phase("Daten sichern und verschlüsseln");
        let dump = Running::spawn(job, &tools.dump.path, &args, &env, &secrets, false, true)?;
        let catalog = async {
            let columns = pg::columns(&exported.client).await?;
            let counts = pg::counts(&exported.client, true).await?;
            Ok::<_, String>((columns, counts))
        };
        let data_path = dir.join("data.enc");
        let (data, catalog) = tokio::join!(
            pipeline::dump_to_vault(job, vault, dump, &data_path),
            catalog
        );
        let data = data?;
        let (columns, counts) = catalog?;
        job.phase("Schema sichern");
        let mut args = strings(&[
            "-Fp",
            "-s",
            "-w",
            "-O",
            "-x",
            "--no-publications",
            "--no-subscriptions",
        ]);
        args.push(snapshot);
        args.push(conninfo(&info.name));
        let dump = Running::spawn(job, &tools.dump.path, &args, &env, &secrets, false, true)?;
        let schema_text = pipeline::collect(job, dump, SCHEMA_LIMIT).await?;
        let schema = seal_bytes(
            vault,
            &dir.join("schema.enc"),
            normalize_schema(&schema_text).as_bytes(),
        )?;
        let label = request.label.trim();
        let manifest = Manifest {
            id: id.clone(),
            server: server.info.identity.clone(),
            database: info.name.clone(),
            root: root.clone(),
            branch: branch_id.clone(),
            label: if label.is_empty() {
                if request.scheduled {
                    "Geplante Sicherung"
                } else {
                    "Sicherung"
                }
                .into()
            } else {
                clip(label, 200)
            },
            note: clip(request.note.trim(), 4000),
            trigger: if request.scheduled {
                "schedule"
            } else {
                "manual"
            }
            .into(),
            created_at: vault::now(),
            created_by: actor.clone(),
            server_version: server.info.version.clone(),
            dump_version: tools.dump.version.clone(),
            meta,
            counts,
            columns,
            data,
            schema,
            protected: false,
            expires_at: policy
                .snapshot_ttl_days
                .filter(|days| *days > 0)
                .map(|days| hours_from_now(days.saturating_mul(24))),
        };
        write_manifest(vault, &dir, &manifest)?;
        Ok::<_, String>(manifest)
    }
    .await;
    drop(exported);
    let manifest = match written {
        Ok(manifest) => manifest,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(error);
        }
    };
    if let Err(error) = std::fs::rename(&dir, vault.snapshot_dir(&id)?) {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(format!("Sicherung konnte nicht abgelegt werden: {error}"));
    }
    let pruned = if request.scheduled {
        prune(
            vault,
            &manifest,
            policy.schedule.map(|schedule| schedule.keep).unwrap_or(0),
        )
    } else {
        Vec::new()
    };
    Ok(json!({
        "snapshot": id,
        "bytes": manifest.data.cipher_bytes,
        "tables": manifest.counts.len(),
        "rows": manifest.counts.iter().map(|count| count.rows).sum::<i64>(),
        "pruned": pruned,
    }))
}

fn prune(vault: &Vault, latest: &Manifest, keep: u32) -> Vec<String> {
    if keep == 0 {
        return Vec::new();
    }
    snapshots(vault)
        .into_iter()
        .filter(|snapshot| {
            snapshot.problem.is_none()
                && snapshot.server == latest.server
                && snapshot.database == latest.database
                && snapshot.trigger == "schedule"
                && !snapshot.protected
        })
        .skip(keep as usize)
        .filter_map(|snapshot| {
            std::fs::remove_dir_all(vault.snapshot_dir(&snapshot.id).ok()?).ok()?;
            Some(snapshot.id)
        })
        .collect()
}

async fn create_branch(
    ctx: &Context,
    job: &Job,
    vault: &Vault,
    server: &Server,
    request: &BranchRequest,
    actor: &Actor,
) -> Result<Value, String> {
    let client = &server.client;
    pg::valid_name(&request.name)?;
    server.may_create()?;
    if pg::exists(client, &request.name).await? {
        return Err(format!(
            "Eine Datenbank „{}“ existiert bereits.",
            request.name
        ));
    }
    let databases = pg::databases(client).await?;
    let manifest = request
        .snapshot
        .as_deref()
        .map(|id| manifest(vault, id))
        .transpose()?;
    if let Some(manifest) = &manifest {
        if manifest.server != server.info.identity {
            return Err("Die Sicherung stammt von einem anderen Server.".into());
        }
        if manifest.database != request.source {
            return Err("Die Sicherung gehört nicht zur gewählten Quelle.".into());
        }
    }
    let source = databases
        .iter()
        .find(|database| database.name == request.source);
    if manifest.is_none() && source.is_none() {
        return Err(format!("Datenbank „{}“ existiert nicht.", request.source));
    }
    let parent = match (source, &manifest) {
        (None, Some(manifest))
            if databases
                .iter()
                .any(|database| database.name == manifest.root) =>
        {
            manifest.root.clone()
        }
        _ => request.source.clone(),
    };
    let root = root_of(&databases, &parent);
    let root_marker = databases
        .iter()
        .find(|database| database.name == root)
        .and_then(|database| database.marker.clone())
        .unwrap_or_default();
    let source_marker = source
        .and_then(|database| database.marker.clone())
        .unwrap_or_default();
    let strict = source_marker.masked() || root_marker.masked();
    if request.kind == Kind::Full && strict {
        return Err(format!(
            "„{}“ ist als maskiert geschützt: nur anonymisierte oder Schema-Branches sind erlaubt.",
            request.source
        ));
    }
    let policy = vault
        .load_policy()?
        .databases
        .get(&server.key(&root))
        .cloned()
        .unwrap_or_default();
    let rules = masking_rules(&root_marker, strict, &policy.masking);
    if manifest.is_none() {
        pg::try_lock(client, &request.source).await?;
    }
    pg::try_lock(client, &request.name).await?;
    let mut branch = Branch {
        id: vault::new_id()?,
        parent,
        kind: request.kind.name().into(),
        method: String::new(),
        status: "creating".into(),
        source: manifest.as_ref().map(|manifest| manifest.id.clone()),
        source_name: manifest.as_ref().map(|manifest| manifest.label.clone()),
        source_at: None,
        created_at: vault::now(),
        created_by: actor_label(actor),
        reset_at: None,
        expires_at: request
            .ttl_hours
            .or(policy.branch_ttl_hours)
            .filter(|hours| *hours > 0)
            .map(hours_from_now),
        protected: request.protected,
        private: true,
        masking: (request.kind == Kind::Anonymized).then(|| fingerprint(&rules)),
    };
    let built = build(
        ctx,
        job,
        vault,
        server,
        Plan {
            source: &request.source,
            snapshot: manifest.as_ref(),
            kind: request.kind,
            method: request.method,
            target: &request.name,
            rules: &rules,
            marker: Marker {
                branch: Some(branch.clone()),
                ..Default::default()
            },
        },
    )
    .await?;
    branch.status = "ready".into();
    branch.method = built.method.into();
    branch.source_at = Some(built.source_at.clone());
    let marker = Marker {
        branch: Some(branch),
        ..Default::default()
    };
    created(
        client,
        &request.name,
        pg::set_comment(client, &request.name, &marker, ""),
    )
    .await?;
    Ok(json!({
        "branch": request.name,
        "method": built.method,
        "tables": built.tables,
        "rows": built.rows,
        "masked": built.masked,
        "masking": marker.branch.and_then(|branch| branch.masking),
    }))
}

async fn restore(
    ctx: &Context,
    job: &Job,
    vault: &Vault,
    server: &Server,
    request: &RestoreRequest,
    actor: &Actor,
) -> Result<Value, String> {
    let client = &server.client;
    let manifest = manifest(vault, &request.snapshot)?;
    if manifest.server != server.info.identity {
        return Err("Die Sicherung stammt von einem anderen Server.".into());
    }
    let target = pg::database(client, &request.database).await?;
    let marker = target.marker.clone().unwrap_or_default();
    if marker
        .branch
        .as_ref()
        .is_some_and(|branch| branch.kind == "staging")
    {
        return Err("Zwischenstufen können nicht wiederhergestellt werden.".into());
    }
    if manifest.database != target.name
        || manifest.branch != marker.branch.as_ref().map(|branch| branch.id.clone())
    {
        return Err(format!(
            "Die Sicherung stammt nicht von „{}“. Fremde Stände lassen sich nur als neuer Branch öffnen.",
            target.name
        ));
    }
    if marker.protected() {
        if request.confirm != target.name {
            return Err(format!(
                "„{}“ ist geschützt. Zur Bestätigung den Datenbanknamen eingeben.",
                target.name
            ));
        }
        if request.reason.trim().is_empty() {
            return Err("Für geschützte Datenbanken ist ein Änderungsgrund erforderlich.".into());
        }
    }
    if !server.privileged(&target) {
        return Err(format!(
            "Nur der Eigentümer von „{}“ oder ein Superuser kann wiederherstellen.",
            target.name
        ));
    }
    server.may_create()?;
    pg::try_lock(client, &target.name).await?;
    job.phase("Werkzeuge prüfen");
    let tools = tools(ctx, &server.info).await?;
    let meta = pg::meta(client, &target.name, server.info.version_num).await?;
    let staging = unique_name(client, &target.name, "_l8db_").await?;
    let previous = unique_name(client, &target.name, "_old_").await?;
    let path = vault.snapshot_dir(&manifest.id)?.join("data.enc");
    let staging_marker = Marker {
        branch: Some(Branch {
            id: vault::new_id()?,
            parent: target.name.clone(),
            kind: "staging".into(),
            method: "snapshot".into(),
            status: "creating".into(),
            source: Some(manifest.id.clone()),
            created_at: vault::now(),
            created_by: actor_label(actor),
            private: true,
            ..Default::default()
        }),
        ..Default::default()
    };
    job.phase("Zwischenstufe anlegen");
    pg::create_empty(client, &staging, &meta).await?;
    let comment = pg::raw_comment(client, &target.name).await?;
    let (tables, rows) = created(client, &staging, async {
        claim(client, &staging, &staging_marker).await?;
        let (env, secrets) = pipeline::env(&ctx.connection_string, &staging)?;
        job.phase("Sicherung einspielen");
        let sink = Running::spawn(
            job,
            &tools.restore.path,
            &restore_args(&staging, false),
            &env,
            &secrets,
            true,
            false,
        )?;
        pipeline::vault_into(job, vault, &path, &manifest.data, sink).await?;
        let verified = verify_target(ctx, job, &staging, &manifest.counts, Kind::Full).await?;
        job.phase("Eigenschaften übernehmen");
        pg::set_owner(client, &staging, &meta.owner).await?;
        pg::copy_acl(client, &target.name, &staging).await?;
        let problems = pg::copy_settings(client, &target.name, &staging).await;
        if !problems.is_empty() {
            return Err(format!(
                "Datenbankeinstellungen konnten nicht übernommen werden: {}",
                problems.join("; ")
            ));
        }
        if meta.connection_limit != -1 {
            pg::set_connection_limit(client, &staging, meta.connection_limit).await?;
        }
        pg::restore_comment(client, &staging, comment.as_deref()).await?;
        check_cancel()?;
        job.phase("Umschalten");
        pg::swap(client, &target.name, &staging, &previous).await?;
        Ok(verified)
    })
    .await?;
    let keep = request.keep_hours.clamp(1, MAX_KEEP_HOURS);
    let (_, rest) = pg::parse_comment(comment.as_deref());
    let previous_marker = Marker {
        branch: Some(Branch {
            id: vault::new_id()?,
            parent: target.name.clone(),
            kind: "previous".into(),
            method: "restore".into(),
            status: "ready".into(),
            source_at: Some(vault::now()),
            created_at: vault::now(),
            created_by: actor_label(actor),
            expires_at: Some(hours_from_now(keep)),
            ..Default::default()
        }),
        ..Default::default()
    };
    if let Err(error) = pg::set_comment(client, &previous, &previous_marker, &rest).await {
        job.log(format!(
            "Kennzeichnung von „{previous}“ fehlgeschlagen: {error}"
        ));
    }
    release(ctx, &target.name).await;
    Ok(json!({
        "database": target.name,
        "previous": previous,
        "snapshot": manifest.id,
        "snapshotLabel": manifest.label,
        "tables": tables,
        "rows": rows,
        "reason": clip(request.reason.trim(), 500),
        "keepHours": keep,
    }))
}

async fn reset(
    ctx: &Context,
    job: &Job,
    vault: &Vault,
    server: &Server,
    request: &TargetRequest,
    actor: &Actor,
) -> Result<Value, String> {
    let client = &server.client;
    let databases = pg::databases(client).await?;
    let info = databases
        .iter()
        .find(|database| database.name == request.name)
        .ok_or_else(|| format!("Datenbank „{}“ existiert nicht.", request.name))?;
    let marker = info.marker.clone().unwrap_or_default();
    let branch = marker
        .branch
        .clone()
        .ok_or("Nur von l8db angelegte Branches können zurückgesetzt werden.")?;
    let kind =
        Kind::parse(&branch.kind).ok_or("Dieser Eintrag kann nicht zurückgesetzt werden.")?;
    if marker.protected() && request.confirm != info.name {
        return Err(format!(
            "„{}“ ist geschützt. Zur Bestätigung den Namen eingeben.",
            info.name
        ));
    }
    if !server.privileged(info) {
        return Err(format!(
            "Nur der Eigentümer von „{}“ oder ein Superuser kann zurücksetzen.",
            info.name
        ));
    }
    server.may_create()?;
    let snapshot = match &branch.source {
        Some(id) => Some(
            manifest(vault, id)
                .map_err(|error| format!("Die Ursprungssicherung ist nicht verfügbar: {error}"))?,
        ),
        None => None,
    };
    let parent = databases
        .iter()
        .find(|database| database.name == branch.parent);
    if snapshot.is_none() && parent.is_none() {
        return Err(format!(
            "Der Ursprung „{}“ existiert nicht mehr.",
            branch.parent
        ));
    }
    let root = root_of(&databases, &branch.parent);
    let root_marker = databases
        .iter()
        .find(|database| database.name == root)
        .and_then(|database| database.marker.clone())
        .unwrap_or_default();
    let strict = root_marker.masked()
        || parent
            .and_then(|database| database.marker.as_ref())
            .is_some_and(Marker::masked);
    if kind == Kind::Full && strict {
        return Err(format!(
            "„{}“ ist inzwischen als maskiert geschützt: vollständige Kopien sind nicht mehr erlaubt.",
            branch.parent
        ));
    }
    let policy = vault
        .load_policy()?
        .databases
        .get(&server.key(&root))
        .cloned()
        .unwrap_or_default();
    let rules = masking_rules(&root_marker, strict, &policy.masking);
    pg::try_lock(client, &info.name).await?;
    if snapshot.is_none() {
        pg::try_lock(client, &branch.parent).await?;
    }
    let staging = unique_name(client, &info.name, "_l8db_").await?;
    let previous = unique_name(client, &info.name, "_reset_").await?;
    let built = build(
        ctx,
        job,
        vault,
        server,
        Plan {
            source: &branch.parent,
            snapshot: snapshot.as_ref(),
            kind,
            method: Method::Auto,
            target: &staging,
            rules: &rules,
            marker: Marker {
                branch: Some(Branch {
                    id: vault::new_id()?,
                    parent: info.name.clone(),
                    kind: "staging".into(),
                    status: "creating".into(),
                    created_at: vault::now(),
                    created_by: actor_label(actor),
                    private: true,
                    ..Default::default()
                }),
                ..Default::default()
            },
        },
    )
    .await?;
    let comment = pg::raw_comment(client, &info.name).await?;
    let (_, rest) = pg::parse_comment(comment.as_deref());
    let mut next = branch.clone();
    next.status = "ready".into();
    next.method = built.method.into();
    next.reset_at = Some(vault::now());
    next.source_at = Some(built.source_at.clone());
    if kind == Kind::Anonymized {
        next.masking = Some(fingerprint(&rules));
    }
    let next_marker = Marker {
        branch: Some(next),
        protection: marker.protection.clone(),
        masking: marker.masking.clone(),
    };
    created(client, &staging, async {
        job.phase("Eigenschaften übernehmen");
        pg::set_owner(client, &staging, &info.owner).await?;
        pg::copy_acl(client, &info.name, &staging).await?;
        let problems = pg::copy_settings(client, &info.name, &staging).await;
        if !problems.is_empty() {
            return Err(format!(
                "Datenbankeinstellungen konnten nicht übernommen werden: {}",
                problems.join("; ")
            ));
        }
        pg::set_comment(client, &staging, &next_marker, &rest).await?;
        check_cancel()?;
        job.phase("Umschalten");
        pg::swap(client, &info.name, &staging, &previous).await
    })
    .await?;
    job.phase("Alten Stand entfernen");
    if let Err(error) = pg::drop_database(client, &previous).await {
        job.log(format!(
            "Alter Stand „{previous}“ konnte nicht entfernt werden: {error}"
        ));
        let leftover = Marker {
            branch: Some(Branch {
                id: vault::new_id()?,
                parent: info.name.clone(),
                kind: "previous".into(),
                method: "reset".into(),
                status: "ready".into(),
                created_at: vault::now(),
                created_by: actor_label(actor),
                expires_at: Some(hours_from_now(1)),
                ..Default::default()
            }),
            ..Default::default()
        };
        let _ = pg::set_comment(client, &previous, &leftover, "").await;
    }
    release(ctx, &info.name).await;
    Ok(json!({
        "branch": info.name,
        "method": built.method,
        "tables": built.tables,
        "rows": built.rows,
        "masked": built.masked,
    }))
}

async fn delete(
    ctx: &Context,
    job: &Job,
    server: &Server,
    request: &TargetRequest,
) -> Result<Value, String> {
    let client = &server.client;
    let databases = pg::databases(client).await?;
    let info = databases
        .iter()
        .find(|database| database.name == request.name)
        .ok_or_else(|| format!("Datenbank „{}“ existiert nicht.", request.name))?;
    let marker = info.marker.clone().unwrap_or_default();
    if marker.branch.is_none() {
        return Err("Nur von l8db angelegte Branches können hier gelöscht werden.".into());
    }
    if marker.protected() && request.confirm != info.name {
        return Err(format!(
            "„{}“ ist geschützt. Zur Bestätigung den Namen eingeben.",
            info.name
        ));
    }
    if !server.privileged(info) {
        return Err(format!(
            "Nur der Eigentümer von „{}“ oder ein Superuser kann löschen.",
            info.name
        ));
    }
    let dependents = children(&databases, &info.name);
    if let Some(child) = dependents.iter().find(|child| !disposable(child)) {
        return Err(format!(
            "„{}“ hat abhängige Branches (z. B. „{}“). Diese zuerst löschen.",
            info.name, child.name
        ));
    }
    pg::try_lock(client, &info.name).await?;
    job.phase("Löschen");
    let mut deleted = Vec::new();
    for child in dependents {
        pg::try_lock(client, &child.name).await?;
        pg::drop_database(client, &child.name).await?;
        release(ctx, &child.name).await;
        deleted.push(child.name.clone());
    }
    pg::drop_database(client, &info.name).await?;
    release(ctx, &info.name).await;
    deleted.push(info.name.clone());
    Ok(json!({ "deleted": deleted }))
}

async fn sweep(ctx: &Context, job: &Job, vault: &Vault, server: &Server) -> Result<Value, String> {
    let client = &server.client;
    let databases = pg::databases(client).await?;
    let mut removed = Vec::new();
    let mut skipped = Vec::new();
    job.phase("Abgelaufene Branches suchen");
    for database in &databases {
        let Some(marker) = &database.marker else {
            continue;
        };
        let Some(branch) = &marker.branch else {
            continue;
        };
        let expired = !marker.protected() && past(branch.expires_at.as_deref());
        let orphan = branch.status == "creating" && older_than(&branch.created_at, ORPHAN_HOURS);
        if !expired && !orphan {
            continue;
        }
        if !server.privileged(database) {
            skipped.push(format!("{}: keine Berechtigung", database.name));
            continue;
        }
        if children(&databases, &database.name)
            .iter()
            .any(|child| !disposable(child))
        {
            skipped.push(format!("{}: hat abhängige Branches", database.name));
            continue;
        }
        if pg::try_lock(client, &database.name).await.is_err() {
            skipped.push(format!("{}: gerade in Bearbeitung", database.name));
            continue;
        }
        match pg::drop_database(client, &database.name).await {
            Ok(()) => {
                release(ctx, &database.name).await;
                removed.push(database.name.clone());
            }
            Err(error) => skipped.push(format!("{}: {error}", database.name)),
        }
    }
    job.phase("Abgelaufene Sicherungen suchen");
    let mut snapshots_removed = Vec::new();
    for snapshot in snapshots(vault) {
        if snapshot.problem.is_none() && !snapshot.protected && past(snapshot.expires_at.as_deref())
        {
            if let Ok(dir) = vault.snapshot_dir(&snapshot.id) {
                if std::fs::remove_dir_all(dir).is_ok() {
                    snapshots_removed.push(snapshot.id);
                }
            }
        }
    }
    if let Ok(entries) = std::fs::read_dir(snapshots_dir(vault)) {
        for entry in entries.filter_map(Result::ok) {
            let stale = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(|time| time.elapsed().ok())
                .is_some_and(|age| age.as_secs() > 24 * 60 * 60);
            if entry.file_name().to_string_lossy().starts_with(".tmp-") && stale {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
    Ok(json!({
        "databases": removed,
        "snapshots": snapshots_removed,
        "skipped": skipped,
    }))
}

async fn verify(job: &Job, vault: &Vault, id: &str) -> Result<Value, String> {
    let manifest = manifest(vault, id)?;
    let dir = vault.snapshot_dir(id)?;
    job.phase("Signatur und Prüfsummen prüfen");
    pipeline::verify_vault(job, vault, &dir.join("data.enc"), &manifest.data).await?;
    pipeline::read_vault(
        vault,
        &dir.join("schema.enc"),
        &manifest.schema,
        SCHEMA_LIMIT,
    )
    .await?;
    Ok(json!({
        "snapshot": id,
        "bytes": manifest.data.cipher_bytes,
        "sha256": manifest.data.cipher_sha256,
    }))
}

pub async fn start_snapshot(
    ctx: Context,
    request: SnapshotRequest,
    emit: Emit,
) -> Result<String, String> {
    let server = Server::connect(&ctx.connection_string).await?;
    let info = pg::database(&server.client, &request.database).await?;
    if info.marker.as_ref().is_some_and(Marker::masked) {
        return Err(format!(
            "„{}“ ist als maskiert geschützt: lokale Sicherungen sind gesperrt.",
            info.name
        ));
    }
    let key = server.key(&request.database);
    let actor = server.actor();
    drop(server);
    let label = format!("Sicherung von „{}“", request.database);
    jobs::start(
        "snapshot",
        label,
        key.clone(),
        emit,
        move |job| async move {
            let (ctx, job, request) = (&ctx, &job, &request);
            let target = Some(request.database.clone());
            let author = actor.clone();
            let policy_key = key.clone();
            audited(
                &ctx.root,
                actor,
                key,
                "snapshot.create",
                target,
                move |vault| async move {
                    let outcome = async {
                        let server = Server::connect(&ctx.connection_string).await?;
                        take_snapshot(ctx, job, &vault, &server, request, &author).await
                    }
                    .await;
                    if request.scheduled {
                        mark_schedule(
                            &vault,
                            &policy_key,
                            outcome.as_ref().err().map(|error| clip(error, 300)),
                        )
                        .await;
                    }
                    outcome
                },
            )
            .await
        },
    )
}

async fn mark_schedule(vault: &Vault, key: &str, error: Option<String>) {
    let _guard = vault::LOCK.lock().await;
    let Ok(mut policy) = vault.load_policy() else {
        return;
    };
    let Some(schedule) = policy
        .databases
        .get_mut(key)
        .and_then(|entry| entry.schedule.as_mut())
    else {
        return;
    };
    if error.is_none() {
        schedule.last_run_at = Some(vault::now());
    }
    schedule.last_error = error;
    let _ = vault.save_policy(&policy);
}

pub async fn schedules(root: &Path) -> Result<Vec<ScheduleEntry>, String> {
    if !root.join("vault.json").exists() {
        return Ok(Vec::new());
    }
    let vault = Vault::open(root).await?;
    Ok(vault
        .load_policy()?
        .databases
        .into_iter()
        .filter_map(|(key, policy)| {
            let schedule = policy.schedule.filter(|schedule| {
                schedule.every_hours > 0 && !schedule.connection_id.is_empty()
            })?;
            let (server, database) = key.split_once('/')?;
            Some(ScheduleEntry {
                server: server.to_string(),
                database: database.to_string(),
                key: key.clone(),
                schedule,
            })
        })
        .collect())
}

pub async fn start_run(ctx: Context, request: Run, emit: Emit) -> Result<String, String> {
    writable(&ctx.connection_string)?;
    let server = Server::connect(&ctx.connection_string).await?;
    let (operation, label, database, action) = match &request {
        Run::Branch(branch) => {
            pg::valid_name(&branch.name)?;
            if pg::exists(&server.client, &branch.name).await? {
                return Err(format!(
                    "Eine Datenbank „{}“ existiert bereits.",
                    branch.name
                ));
            }
            (
                "branch",
                format!("Branch „{}“ anlegen", branch.name),
                branch.source.clone(),
                "branch.create",
            )
        }
        Run::Restore(restore) => (
            "restore",
            format!("„{}“ wiederherstellen", restore.database),
            restore.database.clone(),
            "database.restore",
        ),
        Run::Reset(target) => (
            "reset",
            format!("Branch „{}“ zurücksetzen", target.name),
            target.name.clone(),
            "branch.reset",
        ),
        Run::Delete(target) => (
            "delete",
            format!("Branch „{}“ löschen", target.name),
            target.name.clone(),
            "branch.delete",
        ),
        Run::Sweep => (
            "sweep",
            "Abgelaufene Branches entfernen".into(),
            String::new(),
            "branch.sweep",
        ),
    };
    let key = server.key(&database);
    let actor = server.actor();
    drop(server);
    let target = match &request {
        Run::Branch(branch) => Some(branch.name.clone()),
        Run::Restore(restore) => Some(restore.snapshot.clone()),
        Run::Reset(target) | Run::Delete(target) => Some(target.name.clone()),
        Run::Sweep => None,
    };
    jobs::start(operation, label, key.clone(), emit, move |job| async move {
        let (ctx, job, request) = (&ctx, &job, &request);
        let author = actor.clone();
        audited(
            &ctx.root,
            actor,
            key,
            action,
            target,
            move |vault| async move {
                let server = Server::connect(&ctx.connection_string).await?;
                match request {
                    Run::Branch(branch) => {
                        create_branch(ctx, job, &vault, &server, branch, &author).await
                    }
                    Run::Restore(restore) => {
                        self::restore(ctx, job, &vault, &server, restore, &author).await
                    }
                    Run::Reset(target) => reset(ctx, job, &vault, &server, target, &author).await,
                    Run::Delete(target) => delete(ctx, job, &server, target).await,
                    Run::Sweep => sweep(ctx, job, &vault, &server).await,
                }
            },
        )
        .await
    })
}

pub async fn start_verify(root: PathBuf, id: String, emit: Emit) -> Result<String, String> {
    vault::valid_id(&id)?;
    let vault = Vault::open(&root).await?;
    let manifest = manifest(&vault, &id)?;
    drop(vault);
    let key = format!("{}/{}", manifest.server, manifest.database);
    let label = format!("Sicherung „{}“ prüfen", manifest.label);
    jobs::start("verify", label, key.clone(), emit, move |job| async move {
        let (job, id) = (&job, &id);
        audited(
            &root,
            Actor::local(None),
            key,
            "snapshot.verify",
            Some(id.clone()),
            move |vault| async move { verify(job, &vault, id).await },
        )
        .await
    })
}

pub async fn overview(ctx: &Context, database: &str) -> Result<Overview, String> {
    let server = Server::connect(&ctx.connection_string).await?;
    let all = pg::databases(&server.client).await?;
    if !all.iter().any(|info| info.name == database) {
        return Err(format!("Datenbank „{database}“ existiert nicht."));
    }
    let root = root_of(&all, database);
    let databases = family(&all, &root);
    let policy_key = server.key(&root);
    let (vault_status, snapshots, policy) = match Vault::open(&ctx.root).await {
        Ok(vault) => {
            let snapshots: Vec<SnapshotInfo> = snapshots(&vault)
                .into_iter()
                .filter(|snapshot| {
                    snapshot.problem.is_some()
                        || (snapshot.server == server.info.identity
                            && (snapshot.root == root
                                || databases.iter().any(|info| info.name == snapshot.database)))
                })
                .collect();
            let policy = vault
                .load_policy()?
                .databases
                .get(&policy_key)
                .cloned()
                .unwrap_or_default();
            let mut status = vault.status();
            status.problem = audit::ensure_intact(&vault).await.err();
            (status, snapshots, policy)
        }
        Err(problem) => (
            vault::unavailable(&ctx.root, problem),
            Vec::new(),
            DatabasePolicy::default(),
        ),
    };
    let tools = match tools(ctx, &server.info).await {
        Ok(tools) => ToolStatus {
            anonymize: tools.dump.restrict && restrict_ready(&tools.psql.version),
            dump: Some(tools.dump.version),
            psql: Some(tools.psql.version),
            problem: None,
        },
        Err(problem) => ToolStatus {
            dump: None,
            psql: None,
            anonymize: false,
            problem: Some(problem),
        },
    };
    Ok(Overview {
        server: server.info,
        database: database.to_string(),
        root,
        databases,
        snapshots,
        policy_key,
        policy,
        vault: vault_status,
        tools,
        read_only: crate::db::connection_string_is_read_only(&ctx.connection_string),
    })
}

pub async fn columns(connection_string: &str, database: &str) -> Result<Vec<Column>, String> {
    pg::columns(&pg::connect(connection_string, database).await?).await
}

async fn saved_schema(vault: &Vault, id: &str) -> Result<String, String> {
    let manifest = manifest(vault, id)?;
    let path = vault.snapshot_dir(id)?.join("schema.enc");
    let bytes = pipeline::read_vault(vault, &path, &manifest.schema, SCHEMA_LIMIT).await?;
    String::from_utf8(bytes).map_err(|_| "Schema ist kein gültiges UTF-8.".into())
}

pub async fn schema(ctx: &Context, source: SchemaSource) -> Result<String, String> {
    match source {
        SchemaSource::Snapshot { id } => saved_schema(&Vault::open(&ctx.root).await?, &id).await,
        SchemaSource::Live { database } => {
            let server = Server::connect(&ctx.connection_string).await?;
            pg::database(&server.client, &database).await?;
            let tools = tools(ctx, &server.info).await?;
            let (env, secrets) = pipeline::env(&ctx.connection_string, &database)?;
            let mut args = strings(&[
                "-Fp",
                "-s",
                "-w",
                "-O",
                "-x",
                "--no-publications",
                "--no-subscriptions",
            ]);
            args.push(conninfo(&database));
            let job = Job::detached();
            let dump = Running::spawn(&job, &tools.dump.path, &args, &env, &secrets, false, true)?;
            Ok(normalize_schema(
                &pipeline::collect(&job, dump, SCHEMA_LIMIT).await?,
            ))
        }
    }
}

pub async fn update(ctx: &Context, request: Update) -> Result<(), String> {
    writable(&ctx.connection_string)?;
    let server = Server::connect(&ctx.connection_string).await?;
    let (action, database) = match &request {
        Update::Protection { database, .. } => ("database.protect", database.clone()),
        Update::TeamMasking { database, .. } => ("database.masking", database.clone()),
        Update::Branch { name, .. } => ("branch.settings", name.clone()),
        Update::Rename { name, .. } => ("branch.rename", name.clone()),
    };
    let key = server.key(&database);
    let actor = server.actor();
    let (server, request) = (&server, &request);
    audited(
        &ctx.root,
        actor,
        key,
        action,
        Some(database.clone()),
        move |_| async move { apply_update(ctx, server, request).await },
    )
    .await
    .map(|_| ())
}

async fn apply_update(ctx: &Context, server: &Server, request: &Update) -> Result<Value, String> {
    let client = &server.client;
    match request {
        Update::Protection {
            database,
            protection,
            confirm,
        } => {
            let info = pg::database(client, database).await?;
            let next = protection.clone().filter(|level| !level.is_empty());
            if next
                .as_deref()
                .is_some_and(|level| level != "protected" && level != "masked")
            {
                return Err("Unbekannte Schutzstufe".into());
            }
            let rank = |level: Option<&str>| match level {
                Some("masked") => 2,
                Some(_) => 1,
                None => 0,
            };
            let mut marker = info.marker.clone().unwrap_or_default();
            if rank(next.as_deref()) < rank(marker.protection.as_deref()) && *confirm != info.name {
                return Err(format!(
                    "Schutz verringern: zur Bestätigung den Namen „{}“ eingeben.",
                    info.name
                ));
            }
            let before = marker.protection.clone();
            marker.protection = next.clone();
            pg::set_comment(client, &info.name, &marker, &info.comment_rest).await?;
            Ok(json!({ "before": before, "after": next }))
        }
        Update::TeamMasking { database, rules } => {
            let info = pg::database(client, database).await?;
            let columns =
                pg::columns(&pg::connect(&ctx.connection_string, database).await?).await?;
            mask::validate(rules, &columns)?;
            let mut marker = info.marker.clone().unwrap_or_default();
            let before = fingerprint(&marker.masking);
            marker.masking = rules.clone();
            pg::set_comment(client, &info.name, &marker, &info.comment_rest).await?;
            Ok(json!({
                "rules": rules.len(),
                "before": before,
                "after": fingerprint(rules),
                "uncovered": mask::uncovered(rules, &columns).len(),
            }))
        }
        Update::Branch {
            name,
            protected,
            expires_at,
            confirm,
        } => {
            valid_time(expires_at)?;
            let info = pg::database(client, name).await?;
            let mut marker = info.marker.clone().unwrap_or_default();
            let branch = marker
                .branch
                .as_mut()
                .ok_or("Kein von l8db angelegter Branch.")?;
            if branch.protected && !protected && confirm != name {
                return Err(format!(
                    "Schutz aufheben: zur Bestätigung den Namen „{name}“ eingeben."
                ));
            }
            branch.protected = *protected;
            branch.expires_at = expires_at.clone();
            pg::set_comment(client, &info.name, &marker, &info.comment_rest).await?;
            Ok(json!({ "protected": protected, "expiresAt": expires_at }))
        }
        Update::Rename { name, to } => {
            pg::valid_name(to)?;
            let databases = pg::databases(client).await?;
            let info = databases
                .iter()
                .find(|database| database.name == *name)
                .ok_or_else(|| format!("Datenbank „{name}“ existiert nicht."))?;
            let marker = info.marker.clone().unwrap_or_default();
            if marker.branch.is_none() {
                return Err("Nur von l8db angelegte Branches können umbenannt werden.".into());
            }
            if marker.protected() {
                return Err("Geschützte Branches können nicht umbenannt werden.".into());
            }
            if !children(&databases, name).is_empty() {
                return Err(
                    "Branches mit abhängigen Branches können nicht umbenannt werden.".into(),
                );
            }
            if pg::exists(client, to).await? {
                return Err(format!("Eine Datenbank „{to}“ existiert bereits."));
            }
            pg::try_lock(client, name).await?;
            pg::rename(client, name, to).await?;
            release(ctx, name).await;
            Ok(json!({ "from": name, "to": to }))
        }
    }
}

pub async fn local(root: &Path, request: Local) -> Result<(), String> {
    let vault = Vault::open(root).await?;
    audit::ensure_intact(&vault).await?;
    let (action, database, target, detail) = {
        let _guard = vault::LOCK.lock().await;
        match &request {
            Local::Snapshot {
                id,
                label,
                note,
                protected,
                expires_at,
            } => {
                valid_time(expires_at)?;
                let mut manifest = manifest(&vault, id)?;
                if !label.trim().is_empty() {
                    manifest.label = clip(label.trim(), 200);
                }
                manifest.note = clip(note.trim(), 4000);
                let before = manifest.protected;
                manifest.protected = *protected;
                manifest.expires_at = expires_at.clone();
                write_manifest(&vault, &vault.snapshot_dir(id)?, &manifest)?;
                (
                    "snapshot.settings",
                    format!("{}/{}", manifest.server, manifest.database),
                    Some(id.clone()),
                    json!({ "protectedBefore": before, "protected": protected, "expiresAt": expires_at }),
                )
            }
            Local::DeleteSnapshot { id } => {
                let dir = vault.snapshot_dir(id)?;
                let (database, detail) = match manifest(&vault, id) {
                    Ok(manifest) if manifest.protected => {
                        return Err("Geschützte Sicherungen können nicht gelöscht werden. Schutz zuerst aufheben.".into());
                    }
                    Ok(manifest) => (
                        format!("{}/{}", manifest.server, manifest.database),
                        json!({ "label": manifest.label, "createdAt": manifest.created_at }),
                    ),
                    Err(problem) => (
                        "unbekannt".to_string(),
                        json!({ "problem": clip(&problem, 300) }),
                    ),
                };
                std::fs::remove_dir_all(dir)
                    .map_err(|error| format!("Sicherung konnte nicht gelöscht werden: {error}"))?;
                ("snapshot.delete", database, Some(id.clone()), detail)
            }
            Local::Policy { key, policy } => {
                if !key.starts_with("pg:") || !key.contains('/') || key.len() > 512 {
                    return Err("Ungültiger Richtlinienschlüssel".into());
                }
                if let Some(schedule) = &policy.schedule {
                    if !(1..=24 * 31).contains(&schedule.every_hours) || schedule.keep > 1000 {
                        return Err(
                            "Zeitplan: Intervall 1–744 Stunden, höchstens 1000 Sicherungen.".into(),
                        );
                    }
                }
                if policy
                    .branch_ttl_hours
                    .is_some_and(|hours| hours > MAX_KEEP_HOURS)
                    || policy.snapshot_ttl_days.is_some_and(|days| days > 3650)
                {
                    return Err("Aufbewahrungsdauer ist zu lang.".into());
                }
                let mut all = vault.load_policy()?;
                all.databases.insert(key.clone(), policy.clone());
                vault.save_policy(&all)?;
                (
                    "policy.update",
                    key.clone(),
                    None,
                    json!({ "masking": policy.masking.len(), "fingerprint": fingerprint(&policy.masking) }),
                )
            }
        }
    };
    audit::append(
        &vault,
        Actor::local(None),
        action,
        "ok",
        &database,
        target,
        detail,
    )
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restrict_versions() {
        assert!(restrict_ready("18.0"));
        assert!(restrict_ready("17.6"));
        assert!(!restrict_ready("17.5"));
        assert!(restrict_ready("16.10"));
        assert!(!restrict_ready("16.9"));
        assert!(!restrict_ready("12.22"));
        assert!(!restrict_ready(""));
    }

    #[test]
    fn conninfo_is_quoted() {
        assert_eq!(conninfo("shop"), "--dbname=dbname='shop'");
        assert_eq!(conninfo("a' host=evil"), "--dbname=dbname='a\\' host=evil'");
        assert_eq!(conninfo("x\\y"), "--dbname=dbname='x\\\\y'");
    }

    #[test]
    fn schema_text_drops_volatile_lines() {
        let text = "--\n\\restrict abc\n-- Dumped from database version 18.3\nCREATE TABLE t ();\n\\unrestrict abc\n";
        assert_eq!(normalize_schema(text), "--\nCREATE TABLE t ();");
    }

    fn database(name: &str, parent: Option<&str>, kind: &str) -> DatabaseInfo {
        DatabaseInfo {
            name: name.into(),
            owner: "dev".into(),
            size: None,
            sessions: 0,
            own_sessions: 0,
            allow_connections: true,
            can_connect: true,
            is_owner: true,
            marker: parent.map(|parent| Marker {
                branch: Some(Branch {
                    parent: parent.into(),
                    kind: kind.into(),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            comment_rest: String::new(),
        }
    }

    #[test]
    fn family_tree_and_roots() {
        let all = vec![
            database("shop", None, ""),
            database("feature", Some("shop"), "full"),
            database("nested", Some("feature"), "schema"),
            database("shop_old", Some("shop"), "previous"),
            database("other", None, ""),
            database("loop", Some("loop"), "full"),
        ];
        assert_eq!(root_of(&all, "nested"), "shop");
        assert_eq!(root_of(&all, "other"), "other");
        assert_eq!(root_of(&all, "loop"), "loop");
        let names: Vec<String> = family(&all, "shop").into_iter().map(|db| db.name).collect();
        assert_eq!(names, vec!["shop", "feature", "nested", "shop_old"]);
        assert!(children(&all, "shop").iter().any(|child| disposable(child)));
        assert!(!disposable(&all[1]));
    }

    #[test]
    fn team_rules_win_and_strict_mode_ignores_local_rules() {
        let rule = |column: &str, strategy| MaskRule {
            schema: "public".into(),
            table: "users".into(),
            column: column.into(),
            strategy,
            value: None,
        };
        let team = Marker {
            masking: vec![rule("email", mask::Strategy::Email)],
            ..Default::default()
        };
        let local = vec![
            rule("email", mask::Strategy::Keep),
            rule("phone", mask::Strategy::Phone),
        ];
        let merged = masking_rules(&team, false, &local);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].strategy, mask::Strategy::Email);
        assert_eq!(masking_rules(&team, true, &local).len(), 1);
        assert_ne!(fingerprint(&merged), fingerprint(&team.masking));
    }

    async fn sql(url: &str, database: &str, statements: &str) {
        pg::connect(url, database)
            .await
            .unwrap()
            .batch_execute(statements)
            .await
            .unwrap();
    }

    async fn scalar(url: &str, database: &str, query: &str) -> i64 {
        pg::connect(url, database)
            .await
            .unwrap()
            .query_one(query, &[])
            .await
            .unwrap()
            .get(0)
    }

    async fn text(url: &str, database: &str, query: &str) -> String {
        pg::connect(url, database)
            .await
            .unwrap()
            .query_one(query, &[])
            .await
            .unwrap()
            .get(0)
    }

    fn rule(table: &str, column: &str, strategy: mask::Strategy) -> MaskRule {
        MaskRule {
            schema: "public".into(),
            table: table.into(),
            column: column.into(),
            strategy,
            value: None,
        }
    }

    fn branch_request(
        name: &str,
        kind: Kind,
        method: Method,
        snapshot: Option<String>,
    ) -> BranchRequest {
        BranchRequest {
            source: "l8db_e2e".into(),
            name: name.into(),
            kind,
            method,
            snapshot,
            ttl_hours: None,
            protected: false,
        }
    }

    #[tokio::test]
    #[ignore]
    async fn live_branching_flow() {
        let url = std::env::var("L8DB_BRANCHING_PG_URL").expect("L8DB_BRANCHING_PG_URL fehlt");
        let tool_paths = std::env::var("L8DB_BRANCHING_PG_BIN")
            .map(|bin| {
                ["pg_dump", "pg_restore", "psql"]
                    .iter()
                    .map(|tool| (tool.to_string(), format!("{bin}/{tool}")))
                    .collect()
            })
            .unwrap_or_default();
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::with_master(dir.path(), &[9u8; 32]).unwrap();
        let ctx = Context {
            connection_string: url.clone(),
            root: dir.path().into(),
            tool_paths,
            pool: Arc::new(crate::db::pool::PoolManager::new()),
        };
        let server = Server::connect(&url).await.unwrap();
        let actor = server.actor();
        let job = Job::detached();
        for database in pg::databases(&server.client).await.unwrap() {
            if database.name.starts_with("l8db_e2e") {
                pg::drop_database(&server.client, &database.name)
                    .await
                    .unwrap();
            }
        }
        server
            .client
            .batch_execute("CREATE DATABASE l8db_e2e")
            .await
            .unwrap();
        sql(&url, "l8db_e2e", "
            CREATE TABLE customers (id bigserial PRIMARY KEY, email text NOT NULL UNIQUE, full_name varchar(40), birthday date, notes jsonb, ip inet);
            INSERT INTO customers (email, full_name, birthday, notes, ip)
              SELECT 'kunde' || g || '@corp.example', 'Echter Name ' || g, date '1980-01-01' + g, jsonb_build_object('n', g), ('10.0.0.' || (g % 200))::inet
              FROM generate_series(1, 1500) g;
            CREATE TABLE orders (id bigserial, customer_id bigint REFERENCES customers, at date NOT NULL, total numeric) PARTITION BY RANGE (at);
            CREATE TABLE orders_2025 PARTITION OF orders FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
            CREATE TABLE orders_2026 PARTITION OF orders FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
            INSERT INTO orders (customer_id, at, total) SELECT 1 + g % 1500, date '2025-06-01' + (g % 300), g FROM generate_series(1, 4000) g;
            CREATE VIEW recent AS SELECT * FROM orders WHERE at > date '2026-01-01';
            COMMENT ON TABLE customers IS 'Stammdaten';
        ").await;
        server.client.batch_execute("COMMENT ON DATABASE l8db_e2e IS 'Produktiv-Testsystem'; GRANT CONNECT ON DATABASE l8db_e2e TO app; ALTER DATABASE l8db_e2e SET search_path TO \"$user\", public").await.unwrap();

        let snapshot = take_snapshot(
            &ctx,
            &job,
            &vault,
            &server,
            &SnapshotRequest {
                database: "l8db_e2e".into(),
                label: "vor dem Test".into(),
                note: String::new(),
                scheduled: false,
                server: Some(server.info.identity.clone()),
            },
            &actor,
        )
        .await
        .unwrap();
        let snapshot_id = snapshot["snapshot"].as_str().unwrap().to_string();
        assert_eq!(snapshot["rows"], 5500);
        let listed = snapshots(&vault);
        assert_eq!(listed.len(), 1);
        assert!(listed[0].problem.is_none());
        let raw =
            std::fs::read(vault.snapshot_dir(&snapshot_id).unwrap().join("data.enc")).unwrap();
        assert!(!raw.windows(13).any(|window| window == b"corp.example"));

        sql(
            &url,
            "l8db_e2e",
            "DELETE FROM orders WHERE total > 1000; CREATE TABLE extra (id int);",
        )
        .await;

        let full = create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &branch_request("l8db_e2e_full", Kind::Full, Method::Stream, None),
            &actor,
        )
        .await
        .unwrap();
        assert_eq!(full["method"], "stream");
        assert_eq!(
            scalar(&url, "l8db_e2e_full", "SELECT count(*) FROM orders").await,
            1000
        );
        let acl = text(
            &url,
            "postgres",
            "SELECT coalesce(datacl::text, '') FROM pg_database WHERE datname = 'l8db_e2e_full'",
        )
        .await;
        assert!(
            !acl.contains("=Tc/") && !acl.starts_with("{=c"),
            "Branch ist nicht privat: {acl}"
        );
        let full_snapshot = take_snapshot(
            &ctx,
            &job,
            &vault,
            &server,
            &SnapshotRequest {
                database: "l8db_e2e_full".into(),
                label: "Feature-Stand".into(),
                note: String::new(),
                scheduled: false,
                server: None,
            },
            &actor,
        )
        .await
        .unwrap();
        let full_snapshot_id = full_snapshot["snapshot"].as_str().unwrap().to_string();
        let full_manifest = manifest(&vault, &full_snapshot_id).unwrap();
        assert_eq!(full_manifest.root, "l8db_e2e");
        assert!(full_manifest.branch.is_some());

        pg::wait_idle(
            &server.client,
            "l8db_e2e",
            std::time::Duration::from_secs(5),
        )
        .await
        .unwrap();
        let clone = create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &branch_request("l8db_e2e_clone", Kind::Full, Method::Clone, None),
            &actor,
        )
        .await
        .unwrap();
        assert_eq!(clone["method"], "clone");
        assert_eq!(
            scalar(&url, "l8db_e2e_clone", "SELECT count(*) FROM extra").await,
            0
        );

        let schema_branch = create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &branch_request("l8db_e2e_schema", Kind::Schema, Method::Auto, None),
            &actor,
        )
        .await
        .unwrap();
        assert_eq!(schema_branch["rows"], 0);
        assert_eq!(
            scalar(
                &url,
                "l8db_e2e_schema",
                "SELECT count(*) FROM pg_views WHERE viewname = 'recent'"
            )
            .await,
            1
        );

        let refused = create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &branch_request("l8db_e2e_anon", Kind::Anonymized, Method::Auto, None),
            &actor,
        )
        .await
        .unwrap_err();
        assert!(refused.contains("ohne Regel"), "{refused}");
        assert!(!pg::exists(&server.client, "l8db_e2e_anon").await.unwrap());

        let mut policy = vault.load_policy().unwrap();
        policy.databases.insert(
            server.key("l8db_e2e"),
            DatabasePolicy {
                masking: vec![
                    rule("customers", "email", mask::Strategy::Email),
                    rule("customers", "full_name", mask::Strategy::Name),
                    rule("customers", "birthday", mask::Strategy::YearOnly),
                    rule("customers", "ip", mask::Strategy::Ip),
                ],
                ..Default::default()
            },
        );
        vault.save_policy(&policy).unwrap();
        let anon = create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &branch_request("l8db_e2e_anon", Kind::Anonymized, Method::Auto, None),
            &actor,
        )
        .await
        .unwrap();
        assert_eq!(anon["rows"], 2500);
        assert_eq!(scalar(&url, "l8db_e2e_anon", "SELECT count(*) FROM customers WHERE email LIKE '%corp.example' OR full_name LIKE 'Echter%' OR ip <<= '10.0.0.0/8'").await, 0);
        assert_eq!(
            scalar(
                &url,
                "l8db_e2e_anon",
                "SELECT count(DISTINCT email) FROM customers"
            )
            .await,
            1500
        );
        assert_eq!(
            scalar(
                &url,
                "l8db_e2e_anon",
                "SELECT count(*) FROM customers WHERE extract(doy FROM birthday) <> 1"
            )
            .await,
            0
        );
        assert_eq!(
            scalar(
                &url,
                "l8db_e2e_anon",
                "SELECT count(*) FROM customers WHERE notes ? 'n'"
            )
            .await,
            1500
        );

        let preview = create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &branch_request(
                "l8db_e2e_preview",
                Kind::Full,
                Method::Auto,
                Some(snapshot_id.clone()),
            ),
            &actor,
        )
        .await
        .unwrap();
        assert_eq!(preview["method"], "snapshot");
        assert_eq!(
            scalar(&url, "l8db_e2e_preview", "SELECT count(*) FROM orders").await,
            4000
        );
        let anon_snapshot = create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &branch_request(
                "l8db_e2e_anon2",
                Kind::Anonymized,
                Method::Auto,
                Some(snapshot_id.clone()),
            ),
            &actor,
        )
        .await
        .unwrap();
        assert_eq!(anon_snapshot["rows"], 5500);
        assert_eq!(
            scalar(
                &url,
                "l8db_e2e_anon2",
                "SELECT count(*) FROM customers WHERE email LIKE '%corp.example'"
            )
            .await,
            0
        );
        assert_eq!(
            text(
                &url,
                "l8db_e2e_anon",
                "SELECT email FROM customers WHERE id = 7"
            )
            .await,
            text(
                &url,
                "l8db_e2e_anon2",
                "SELECT email FROM customers WHERE id = 7"
            )
            .await
        );

        apply_update(
            &ctx,
            &server,
            &Update::Protection {
                database: "l8db_e2e".into(),
                protection: Some("protected".into()),
                confirm: String::new(),
            },
        )
        .await
        .unwrap();
        let restore_request = |confirm: &str, reason: &str| RestoreRequest {
            database: "l8db_e2e".into(),
            snapshot: snapshot_id.clone(),
            keep_hours: 24,
            confirm: confirm.into(),
            reason: reason.into(),
        };
        assert!(restore(
            &ctx,
            &job,
            &vault,
            &server,
            &restore_request("", "x"),
            &actor
        )
        .await
        .unwrap_err()
        .contains("geschützt"));
        assert!(restore(
            &ctx,
            &job,
            &vault,
            &server,
            &restore_request("l8db_e2e", " "),
            &actor
        )
        .await
        .unwrap_err()
        .contains("Änderungsgrund"));
        let restored = restore(
            &ctx,
            &job,
            &vault,
            &server,
            &restore_request("l8db_e2e", "CHG-1 Rücksprung"),
            &actor,
        )
        .await
        .unwrap();
        let previous = restored["previous"].as_str().unwrap().to_string();
        assert_eq!(
            scalar(&url, "l8db_e2e", "SELECT count(*) FROM orders").await,
            4000
        );
        assert_eq!(
            scalar(
                &url,
                "l8db_e2e",
                "SELECT count(*) FROM pg_tables WHERE tablename = 'extra'"
            )
            .await,
            0
        );
        assert_eq!(
            scalar(&url, &previous, "SELECT count(*) FROM orders").await,
            1000
        );
        let info = pg::database(&server.client, "l8db_e2e").await.unwrap();
        assert!(info.marker.as_ref().unwrap().protected());
        assert_eq!(info.comment_rest, "Produktiv-Testsystem");
        assert!(text(
            &url,
            "postgres",
            "SELECT datacl::text FROM pg_database WHERE datname = 'l8db_e2e'"
        )
        .await
        .contains("app=c/"));
        assert_eq!(
            text(&url, "postgres", "SELECT array_to_string(s.setconfig, ',') FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase WHERE d.datname = 'l8db_e2e'").await,
            "search_path=\"$user\", public"
        );
        let old = pg::database(&server.client, &previous).await.unwrap();
        let old_branch = old.marker.unwrap().branch.unwrap();
        assert_eq!(old_branch.kind, "previous");
        assert_eq!(old_branch.parent, "l8db_e2e");
        assert_eq!(old.comment_rest, "Produktiv-Testsystem");

        apply_update(
            &ctx,
            &server,
            &Update::Protection {
                database: "l8db_e2e".into(),
                protection: Some("masked".into()),
                confirm: String::new(),
            },
        )
        .await
        .unwrap();
        assert!(create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &branch_request("l8db_e2e_x", Kind::Full, Method::Auto, None),
            &actor
        )
        .await
        .unwrap_err()
        .contains("maskiert"));
        assert!(take_snapshot(
            &ctx,
            &job,
            &vault,
            &server,
            &SnapshotRequest {
                database: "l8db_e2e".into(),
                label: String::new(),
                note: String::new(),
                scheduled: false,
                server: None
            },
            &actor
        )
        .await
        .unwrap_err()
        .contains("maskiert"));
        let previous_snapshot = take_snapshot(
            &ctx,
            &job,
            &vault,
            &server,
            &SnapshotRequest {
                database: previous.clone(),
                label: String::new(),
                note: String::new(),
                scheduled: false,
                server: None,
            },
            &actor,
        )
        .await
        .unwrap_err();
        assert!(
            previous_snapshot.contains("maskiert"),
            "{previous_snapshot}"
        );
        let foreign = restore(
            &ctx,
            &job,
            &vault,
            &server,
            &RestoreRequest {
                database: "l8db_e2e_anon".into(),
                snapshot: snapshot_id.clone(),
                keep_hours: 1,
                confirm: String::new(),
                reason: String::new(),
            },
            &actor,
        )
        .await
        .unwrap_err();
        assert!(foreign.contains("stammt nicht"), "{foreign}");
        let anon_saved = take_snapshot(
            &ctx,
            &job,
            &vault,
            &server,
            &SnapshotRequest {
                database: "l8db_e2e_anon".into(),
                label: String::new(),
                note: String::new(),
                scheduled: false,
                server: None,
            },
            &actor,
        )
        .await
        .unwrap();
        restore(
            &ctx,
            &job,
            &vault,
            &server,
            &RestoreRequest {
                database: "l8db_e2e_anon".into(),
                snapshot: anon_saved["snapshot"].as_str().unwrap().to_string(),
                keep_hours: 1,
                confirm: String::new(),
                reason: String::new(),
            },
            &actor,
        )
        .await
        .unwrap();
        assert_eq!(
            scalar(
                &url,
                "l8db_e2e_anon",
                "SELECT count(*) FROM customers WHERE email LIKE '%corp.example'"
            )
            .await,
            0
        );
        let strict = create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &branch_request("l8db_e2e_x", Kind::Anonymized, Method::Auto, None),
            &actor,
        )
        .await
        .unwrap_err();
        assert!(strict.contains("ohne Regel"), "{strict}");
        apply_update(
            &ctx,
            &server,
            &Update::TeamMasking {
                database: "l8db_e2e".into(),
                rules: policy.databases[&server.key("l8db_e2e")].masking.clone(),
            },
        )
        .await
        .unwrap();
        assert!(apply_update(
            &ctx,
            &server,
            &Update::Protection {
                database: "l8db_e2e".into(),
                protection: None,
                confirm: String::new()
            }
        )
        .await
        .unwrap_err()
        .contains("Bestätigung"));

        sql(
            &url,
            "l8db_e2e_anon",
            "UPDATE customers SET email = 'leak@corp.example' WHERE id = 1",
        )
        .await;
        let reset_result = reset(
            &ctx,
            &job,
            &vault,
            &server,
            &TargetRequest {
                name: "l8db_e2e_anon".into(),
                confirm: String::new(),
            },
            &actor,
        )
        .await
        .unwrap();
        assert_eq!(reset_result["rows"], 5500);
        assert_eq!(
            scalar(
                &url,
                "l8db_e2e_anon",
                "SELECT count(*) FROM customers WHERE email LIKE '%corp.example'"
            )
            .await,
            0
        );
        let reset_info = pg::database(&server.client, "l8db_e2e_anon").await.unwrap();
        assert!(reset_info
            .marker
            .unwrap()
            .branch
            .unwrap()
            .reset_at
            .is_some());

        let live = schema(
            &ctx,
            SchemaSource::Live {
                database: "l8db_e2e_full".into(),
            },
        )
        .await
        .unwrap();
        let saved = saved_schema(&vault, &snapshot_id).await.unwrap();
        assert!(live.contains("CREATE TABLE public.extra"));
        assert!(!saved.contains("CREATE TABLE public.extra"));
        assert!(saved.contains("CREATE TABLE public.customers"));
        assert!(!saved.contains("\\restrict"));

        let saved_structure = create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &branch_request(
                "l8db_e2e_schema2",
                Kind::Schema,
                Method::Auto,
                Some(snapshot_id.clone()),
            ),
            &actor,
        )
        .await
        .unwrap();
        assert_eq!(saved_structure["tables"], 3);
        verify(&job, &vault, &snapshot_id).await.unwrap();
        let data = vault.snapshot_dir(&snapshot_id).unwrap().join("data.enc");
        let mut bytes = std::fs::read(&data).unwrap();
        let middle = bytes.len() / 2;
        bytes[middle] ^= 1;
        std::fs::write(&data, &bytes).unwrap();
        assert!(verify(&job, &vault, &snapshot_id)
            .await
            .unwrap_err()
            .contains("Integrität"));
        let tampered = create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &branch_request(
                "l8db_e2e_bad",
                Kind::Schema,
                Method::Auto,
                Some(snapshot_id.clone()),
            ),
            &actor,
        )
        .await
        .unwrap_err();
        assert!(tampered.contains("Integrität"), "{tampered}");
        assert!(!pg::exists(&server.client, "l8db_e2e_bad").await.unwrap());

        let nested = BranchRequest {
            source: "l8db_e2e_full".into(),
            ..branch_request("l8db_e2e_nested", Kind::Schema, Method::Auto, None)
        };
        create_branch(&ctx, &job, &vault, &server, &nested, &actor)
            .await
            .unwrap();
        assert!(delete(
            &ctx,
            &job,
            &server,
            &TargetRequest {
                name: "l8db_e2e_full".into(),
                confirm: String::new()
            }
        )
        .await
        .unwrap_err()
        .contains("abhängige"));
        assert!(delete(
            &ctx,
            &job,
            &server,
            &TargetRequest {
                name: "l8db_e2e".into(),
                confirm: String::new()
            }
        )
        .await
        .is_err());
        apply_update(
            &ctx,
            &server,
            &Update::Branch {
                name: "l8db_e2e_nested".into(),
                protected: false,
                expires_at: Some("2001-01-01T00:00:00Z".into()),
                confirm: String::new(),
            },
        )
        .await
        .unwrap();
        let swept = sweep(&ctx, &job, &vault, &server).await.unwrap();
        assert_eq!(swept["databases"], json!(["l8db_e2e_nested"]));
        delete(
            &ctx,
            &job,
            &server,
            &TargetRequest {
                name: "l8db_e2e_full".into(),
                confirm: String::new(),
            },
        )
        .await
        .unwrap();
        assert!(!pg::exists(&server.client, "l8db_e2e_full").await.unwrap());
        let orphan_full = create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &BranchRequest {
                source: "l8db_e2e_full".into(),
                ..branch_request(
                    "l8db_e2e_orphan",
                    Kind::Full,
                    Method::Auto,
                    Some(full_snapshot_id.clone()),
                )
            },
            &actor,
        )
        .await
        .unwrap_err();
        assert!(orphan_full.contains("maskiert"), "{orphan_full}");
        create_branch(
            &ctx,
            &job,
            &vault,
            &server,
            &BranchRequest {
                source: "l8db_e2e_full".into(),
                ..branch_request(
                    "l8db_e2e_orphan",
                    Kind::Schema,
                    Method::Auto,
                    Some(full_snapshot_id.clone()),
                )
            },
            &actor,
        )
        .await
        .unwrap();
        let orphan = pg::database(&server.client, "l8db_e2e_orphan")
            .await
            .unwrap();
        assert_eq!(orphan.marker.unwrap().branch.unwrap().parent, "l8db_e2e");

        apply_update(
            &ctx,
            &server,
            &Update::Protection {
                database: "l8db_e2e".into(),
                protection: None,
                confirm: "l8db_e2e".into(),
            },
        )
        .await
        .unwrap();
        for database in pg::databases(&server.client).await.unwrap() {
            if database.name.starts_with("l8db_e2e") {
                pg::drop_database(&server.client, &database.name)
                    .await
                    .unwrap();
            }
        }
    }

    #[test]
    fn times_and_clipping() {
        assert!(past(Some("2000-01-01T00:00:00Z")));
        assert!(!past(Some(&hours_from_now(2))));
        assert!(!past(None));
        assert!(older_than("2000-01-01T00:00:00Z", ORPHAN_HOURS));
        assert!(valid_time(&Some("morgen".into())).is_err());
        assert_eq!(clip("äöüß", 2), "äö…");
        assert_eq!(clip("ab", 2), "ab");
    }
}
