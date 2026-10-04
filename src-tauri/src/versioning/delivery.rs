use super::{
    control::{self, literal, table, Connection},
    forge,
    runner::Request,
    seeds,
    team::{Target, Verified},
};
use crate::db;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Delivery {
    pub repository: String,
    pub review: bool,
    pub approvals: u8,
    pub test_first: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Promotion {
    pub target_id: String,
    pub connection: Connection,
}

pub struct Integration {
    pub branch: String,
    pub commit: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gate {
    id: &'static str,
    ok: bool,
    detail: String,
    evidence: Vec<Value>,
}

impl Gate {
    fn new(id: &'static str, result: Result<String, String>, evidence: Vec<Value>) -> Self {
        let ok = result.is_ok();
        Self {
            id,
            ok,
            detail: result.unwrap_or_else(|problem| problem),
            evidence,
        }
    }
}

pub fn validate(delivery: &Delivery) -> Result<(), String> {
    if delivery.repository.trim().is_empty()
        || delivery.repository.len() > 500
        || delivery.repository.contains(['\0', '\n'])
        || (delivery.review && !(1..=10).contains(&delivery.approvals))
    {
        return Err("Ungültige Auslieferungsregeln".into());
    }
    Ok(())
}

pub fn identity(url: &str) -> Result<String, String> {
    if let Ok(remote) = forge::parse_remote(url) {
        let host = remote
            .host
            .rsplit_once(':')
            .filter(|(_, port)| port.chars().all(|c| c.is_ascii_digit()))
            .map_or(remote.host.as_str(), |(host, _)| host);
        return Ok(format!("{host}/{}", remote.path).to_lowercase());
    }
    let path = url.strip_prefix("file://").unwrap_or(url);
    if Path::new(path).is_absolute() {
        let canonical = fs::canonicalize(path).map_err(|_| "Der Remote-Ordner fehlt.")?;
        return Ok(format!("file://{}", canonical.display()));
    }
    Err("Die Adresse des Remotes „origin“ wird für Auslieferungsregeln nicht unterstützt.".into())
}

pub async fn integration(root: &Path) -> Result<Option<Integration>, String> {
    let Ok(name) = super::git(
        root,
        &["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    )
    .await
    else {
        return Ok(None);
    };
    let name = name.trim();
    let branch = name
        .strip_prefix("refs/remotes/origin/")
        .filter(|branch| !branch.is_empty())
        .ok_or("Ungültiger Standardbranch des Remotes")?
        .to_string();
    let commit = super::revision(root, name).await?;
    Ok(Some(Integration { branch, commit }))
}

fn parse_ls_remote(output: &str) -> Result<(String, String), String> {
    let mut branch = None;
    let mut commit = None;
    for line in output.lines() {
        if let Some(rest) = line.strip_prefix("ref: ") {
            if let Some((name, "HEAD")) = rest.split_once('\t') {
                branch = name
                    .strip_prefix("refs/heads/")
                    .filter(|name| !name.is_empty())
                    .map(str::to_string);
            }
        } else if let Some((sha, "HEAD")) = line.split_once('\t') {
            if (sha.len() == 40 || sha.len() == 64) && sha.bytes().all(|b| b.is_ascii_hexdigit()) {
                commit = Some(sha.to_ascii_lowercase());
            }
        }
    }
    branch
        .zip(commit)
        .ok_or_else(|| "Der Standardbranch des Remotes ist unbekannt.".into())
}

type Tips = Mutex<HashMap<(PathBuf, String), (Instant, String, String)>>;

fn tips() -> &'static Tips {
    static TIPS: OnceLock<Tips> = OnceLock::new();
    TIPS.get_or_init(Default::default)
}

async fn remote_tip(root: &Path, url: &str, reuse: bool) -> Result<Integration, String> {
    let key = (root.to_path_buf(), url.to_string());
    let cached = tips()
        .lock()
        .unwrap()
        .get(&key)
        .filter(|(at, ..)| reuse && at.elapsed() < Duration::from_secs(120))
        .map(|(_, branch, commit)| (branch.clone(), commit.clone()));
    let (branch, commit) = match cached {
        Some(found) => found,
        None => {
            let output = super::git(root, &["ls-remote", "--symref", "origin", "HEAD"])
                .await
                .map_err(|_| {
                    "Das Git-Remote ist nicht erreichbar. Auslieferungsregeln verlangen den aktuellen Stand des Hauptbranchs."
                })?;
            let found = parse_ls_remote(&output)?;
            tips()
                .lock()
                .unwrap()
                .insert(key, (Instant::now(), found.0.clone(), found.1.clone()));
            found
        }
    };
    if super::git(root, &["cat-file", "-e", &format!("{commit}^{{commit}}")])
        .await
        .is_err()
    {
        return Err(format!(
            "Der Hauptbranch {branch} auf dem Remote ist neuer als der lokale Stand. Zuerst „Abrufen“ ausführen."
        ));
    }
    Ok(Integration { branch, commit })
}

fn short(commit: &str) -> &str {
    &commit[..commit.len().min(12)]
}

pub async fn touching(root: &Path, tip: &str, release: &str) -> Result<Vec<String>, String> {
    let path = format!("database/releases/{release}.json");
    if release.contains('/') {
        return Err("Ungültige Release-ID".into());
    }
    super::relative(&path)?;
    Ok(super::git(
        root,
        &["log", "--first-parent", "--format=%H", tip, "--", &path],
    )
    .await?
    .lines()
    .map(str::to_string)
    .collect())
}

async fn contained(root: &Path, plan: &Value, tip: &Integration) -> Result<String, String> {
    let commit = plan["reference"]["commit"]
        .as_str()
        .filter(|commit| commit.len() >= 40 && commit.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("Der Ausführungsplan nennt keinen Git-Stand.")?;
    super::git(root, &["merge-base", "--is-ancestor", commit, &tip.commit])
        .await
        .map_err(|_| {
            format!(
                "Der geplante Stand {} ist noch nicht im Hauptbranch {} gemergt. Pull Request mergen, auf {} wechseln und aktualisieren.",
                short(commit),
                tip.branch,
                tip.branch
            )
        })?;
    Ok(format!(
        "Stand {} ist im Hauptbranch {} enthalten.",
        short(commit),
        tip.branch
    ))
}

async fn merged_tip(
    root: &Path,
    url: &str,
    plan: &Value,
    reuse: bool,
) -> Result<(Integration, String), String> {
    let tip = remote_tip(root, url, reuse).await?;
    let detail = contained(root, plan, &tip).await?;
    Ok((tip, detail))
}

async fn reviewed(
    root: &Path,
    plan: &Value,
    tip: &Integration,
    minimum: u8,
) -> (Result<String, String>, Vec<Value>) {
    let mut evidence = Vec::new();
    let mut pulls = Vec::new();
    for release in plan["releases"].as_array().into_iter().flatten() {
        let id = release["id"].as_str().unwrap_or_default();
        let commits = match touching(root, &tip.commit, id).await {
            Ok(commits) if commits.is_empty() => {
                return (
                    Err(format!(
                        "Release {id} ist nicht im Hauptbranch {}.",
                        tip.branch
                    )),
                    evidence,
                )
            }
            Ok(commits) => commits,
            Err(problem) => return (Err(problem), evidence),
        };
        for commit in commits {
            let found = match forge::evidence(root, &commit, &tip.branch).await {
                Ok(Some(found)) => found,
                Ok(None) => {
                    return (
                        Err(format!(
                            "Release {id} kam ohne gemergten Pull Request in den Hauptbranch (Commit {}).",
                            short(&commit)
                        )),
                        evidence,
                    )
                }
                Err(problem) => return (Err(problem), evidence),
            };
            evidence.push(json!({"release": id, "commit": commit, "number": found.number, "url": found.url, "author": found.author, "approvals": found.approvals}));
            if !found.changes_requested.is_empty() {
                return (
                    Err(format!(
                        "Pull Request #{} hat offene Änderungswünsche von {}.",
                        found.number,
                        found.changes_requested.join(", ")
                    )),
                    evidence,
                );
            }
            if found.approvals.len() < usize::from(minimum) {
                return (
                    Err(format!(
                        "Pull Request #{} für Release {id} hat {} von {minimum} nötigen Freigaben durch andere Personen.",
                        found.number,
                        found.approvals.len()
                    )),
                    evidence,
                );
            }
            if !pulls.contains(&found.number) {
                pulls.push(found.number);
            }
        }
    }
    let list = pulls
        .iter()
        .map(|number| format!("#{number}"))
        .collect::<Vec<_>>()
        .join(", ");
    (
        Ok(format!("Geprüft und freigegeben in Pull Request {list}.")),
        evidence,
    )
}

async fn test_state(
    target: &Target,
    promotion: &Promotion,
    project: &str,
    release: &str,
    hash: &str,
    pool: db::pool::PoolState,
) -> Result<(), String> {
    let c = &promotion.connection;
    if c.project_id != project
        || c.database != target.database
        || c.schema != target.ledger_schema.as_deref().unwrap_or(&target.schema)
    {
        return Err("Verbindung passt nicht zur Teamkonfiguration".into());
    }
    let expected = target
        .expected_physical_key
        .as_deref()
        .ok_or("Datenbankidentität ist in Git nicht hinterlegt")?;
    let adapter = c.adapter(pool)?;
    let identity = adapter.execute_query(seeds::identity_sql(c.kind)).await?;
    let row = identity.rows.first().ok_or("Datenbankidentität fehlt")?;
    if seeds::physical_key(c.kind, &c.schema, row) != expected {
        return Err("Verbindung zeigt auf eine andere Datenbank".into());
    }
    let state = adapter
        .execute_query(&format!(
            "SELECT \"RELEASE_ID\", \"RELEASE_HASH\", \"STATUS\", \"LEASE\" FROM {} WHERE \"PROJECT_ID\" = {}",
            table(&c.schema, "STATE"),
            literal(&c.project_id)
        ))
        .await?;
    let row = state.rows.first().ok_or("Versionierungsstand fehlt")?;
    if row["RELEASE_HASH"] != hash {
        return Err(format!(
            "steht auf {}, nicht auf {release}",
            row["RELEASE_ID"].as_str().unwrap_or("–")
        ));
    }
    if row["STATUS"] != "ready" || !row["LEASE"].is_null() {
        return Err("die Auslieferung dort läuft noch oder ist fehlgeschlagen".into());
    }
    Ok(())
}

async fn tested(
    request: &Request,
    verified: Option<&Verified>,
    plan: &Value,
    pool: db::pool::PoolState,
) -> Result<String, String> {
    let verified =
        verified.ok_or("Test vor Produktion benötigt die gemeinsame Teamkonfiguration in Git.")?;
    let customer = verified
        .target
        .customer
        .as_deref()
        .ok_or("Das Produktivziel hat keinen Kunden in der Teamkonfiguration.")?;
    let last = plan["releases"]
        .as_array()
        .and_then(|releases| releases.last())
        .ok_or("Ausführungsplan ist leer")?;
    let (Some(release), Some(hash)) = (last["id"].as_str(), last["hash"].as_str()) else {
        return Err("Ausführungsplan ist ungültig".into());
    };
    let candidates: Vec<&Target> = verified
        .team
        .targets
        .iter()
        .filter(|target| {
            !target.production
                && target.stage.as_deref() == Some("test")
                && target.customer.as_deref() == Some(customer)
        })
        .collect();
    if candidates.is_empty() {
        return Err(format!(
            "Für {customer} ist kein Testsystem in der Teamkonfiguration hinterlegt."
        ));
    }
    let mut problems = Vec::new();
    for promotion in &request.promotion {
        let Some(target) = candidates
            .iter()
            .find(|target| target.id == promotion.target_id)
        else {
            continue;
        };
        match test_state(
            target,
            promotion,
            &request.connection.project_id,
            release,
            hash,
            pool.clone(),
        )
        .await
        {
            Ok(()) => {
                return Ok(format!(
                    "Release {release} läuft bereits fehlerfrei auf dem Testsystem {}.",
                    target.name
                ))
            }
            Err(problem) => problems.push(format!("Testsystem {}: {problem}", target.name)),
        }
    }
    Err(if problems.is_empty() {
        format!("Kein Testsystem von {customer} ist auf diesem Rechner zugeordnet. Testverbindung im Kundenbereich zuordnen.")
    } else {
        problems.join(" · ")
    })
}

pub async fn gates(
    request: &Request,
    verified: Option<&Verified>,
    delivery: &Delivery,
    production: bool,
    pool: db::pool::PoolState,
) -> Result<Vec<Gate>, String> {
    let directory = fs::canonicalize(&request.repo).map_err(|e| e.to_string())?;
    let root = PathBuf::from(
        super::git(&directory, &["rev-parse", "--show-toplevel"])
            .await?
            .trim(),
    );
    let artifact: Value =
        serde_json::from_str(&request.artifact).map_err(|_| "Freigabeartefakt ist ungültig")?;
    let plan = &artifact["execution"];
    let mut gates = Vec::new();
    let url = super::git(&root, &["remote", "get-url", "origin"])
        .await
        .map(|url| url.trim().to_string())
        .map_err(|_| "Das Repository hat keinen Remote „origin“.".to_string());
    let repository = url.clone().and_then(|url| identity(&url)).and_then(|found| {
        if found == delivery.repository {
            Ok(format!("Repository {found}"))
        } else {
            Err(format!(
                "Dieses Repository ({found}) ist nicht das in den Datenbankregeln hinterlegte Repository {}.",
                delivery.repository
            ))
        }
    });
    let passed = repository.is_ok();
    gates.push(Gate::new("repository", repository, Vec::new()));
    let url = match url {
        Ok(url) if passed => url,
        _ => return Ok(gates),
    };
    let mut merged = merged_tip(&root, &url, plan, true).await;
    if merged.is_err() {
        merged = merged_tip(&root, &url, plan, false).await;
    }
    let tip = match merged {
        Ok((tip, detail)) => {
            gates.push(Gate::new("merged", Ok(detail), Vec::new()));
            tip
        }
        Err(problem) => {
            gates.push(Gate::new("merged", Err(problem), Vec::new()));
            return Ok(gates);
        }
    };
    if delivery.review {
        let (result, evidence) = reviewed(&root, plan, &tip, delivery.approvals).await;
        let passed = result.is_ok();
        gates.push(Gate::new("review", result, evidence));
        if !passed {
            return Ok(gates);
        }
    }
    if delivery.test_first && production {
        gates.push(Gate::new(
            "test",
            tested(request, verified, plan, pool).await,
            Vec::new(),
        ));
    }
    Ok(gates)
}

pub async fn verify(
    request: &Request,
    verified: Option<&Verified>,
    policy: &Value,
    pool: db::pool::PoolState,
) -> Result<(), String> {
    if policy["delivery"].is_null() {
        return Ok(());
    }
    let delivery: Delivery = serde_json::from_value(policy["delivery"].clone())
        .map_err(|_| "Ungültige Auslieferungsregeln in der Datenbank")?;
    validate(&delivery)?;
    let production = policy["production"] == true;
    for gate in gates(request, verified, &delivery, production, pool).await? {
        if !gate.ok {
            return Err(format!("Auslieferungsregel nicht erfüllt: {}", gate.detail));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn versioning_delivery(
    request: Request,
    pool: tauri::State<'_, db::pool::PoolState>,
) -> Result<Value, String> {
    let verified = super::team::verify_request(&request).await?;
    let adapter = request.connection.adapter(pool.inner().clone())?;
    let record = control::policy(adapter.as_ref(), &request.connection).await?;
    let Some(delivery) = record.policy.delivery.clone() else {
        return Ok(json!({"rules": null, "gates": []}));
    };
    let gates = gates(
        &request,
        verified.as_ref(),
        &delivery,
        record.policy.production,
        pool.inner().clone(),
    )
    .await?;
    Ok(json!({"rules": delivery, "gates": gates}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_head_is_parsed_strictly() {
        let output = "ref: refs/heads/main\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n";
        assert_eq!(
            parse_ls_remote(output).unwrap(),
            (
                "main".to_string(),
                "0123456789abcdef0123456789abcdef01234567".to_string()
            )
        );
        assert!(parse_ls_remote("0123456789abcdef0123456789abcdef01234567\tHEAD\n").is_err());
        assert!(parse_ls_remote("ref: refs/heads/main\tHEAD\nnot-a-sha\tHEAD\n").is_err());
    }

    #[test]
    fn repository_identity_ignores_transport_and_credentials() {
        let https = identity("https://user:secret@GitHub.com/Acme/Shop-DB.git").unwrap();
        assert_eq!(https, "github.com/acme/shop-db");
        assert_eq!(identity("git@github.com:acme/shop-db.git").unwrap(), https);
        assert_eq!(
            identity("ssh://git@git.acme.de:2222/team/shop.git").unwrap(),
            identity("https://git.acme.de:8443/team/shop").unwrap()
        );
        assert_eq!(
            identity("git@ssh.dev.azure.com:v3/acme/Shop/schema").unwrap(),
            identity("https://acme@dev.azure.com/acme/Shop/_git/schema").unwrap()
        );
        assert!(identity("relative/path").is_err());
    }

    async fn git(root: &Path, args: &[&str]) -> String {
        super::super::git(root, args).await.unwrap()
    }

    #[tokio::test]
    async fn gates_follow_the_remote_default_branch() {
        let base = std::env::temp_dir().join(format!(
            "l8db-delivery-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&base).unwrap();
        let remote = base.join("remote.git");
        let work = base.join("work");
        git(
            &base,
            &[
                "init",
                "-q",
                "--bare",
                "-b",
                "main",
                remote.to_str().unwrap(),
            ],
        )
        .await;
        git(
            &base,
            &[
                "clone",
                "-q",
                remote.to_str().unwrap(),
                work.to_str().unwrap(),
            ],
        )
        .await;
        for args in [
            ["config", "user.email", "dev@example.com"],
            ["config", "user.name", "Dev"],
        ] {
            git(&work, &args).await;
        }
        fs::create_dir_all(work.join("database/releases")).unwrap();
        fs::write(work.join("database/project.json"), "{}").unwrap();
        git(&work, &["add", "."]).await;
        git(&work, &["commit", "-qm", "init"]).await;
        git(&work, &["push", "-q", "origin", "main"]).await;
        git(&work, &["switch", "-qc", "feature"]).await;
        fs::write(work.join("database/releases/r1.json"), "{}").unwrap();
        git(&work, &["add", "."]).await;
        git(&work, &["commit", "-qm", "release r1"]).await;
        let planned = git(&work, &["rev-parse", "HEAD"]).await.trim().to_string();
        let connection = json!({"kind": "postgres", "connectionString": "postgres://example.invalid/app", "database": "app", "schema": "app", "projectId": "p"});
        let request: Request = serde_json::from_value(json!({
            "connection": connection,
            "repo": work.to_str().unwrap(),
            "targetId": "prod",
            "runId": "run",
            "artifact": json!({"execution": {"reference": {"commit": planned}, "releases": [{"id": "r1", "hash": "h1"}]}}).to_string(),
        }))
        .unwrap();
        let mut rules = Delivery {
            repository: identity(remote.to_str().unwrap()).unwrap(),
            review: false,
            approvals: 0,
            test_first: false,
        };
        let pool = db::pool::PoolState::default();
        let outcome = |gates: Vec<Gate>| {
            gates
                .iter()
                .map(|gate| (gate.id, gate.ok))
                .collect::<Vec<_>>()
        };
        let found = super::gates(&request, None, &rules, true, pool.clone())
            .await
            .unwrap();
        assert_eq!(
            outcome(found),
            vec![("repository", true), ("merged", false)]
        );
        git(&work, &["switch", "-q", "main"]).await;
        git(
            &work,
            &[
                "merge",
                "-q",
                "--no-ff",
                "feature",
                "-m",
                "Merge pull request #1",
            ],
        )
        .await;
        git(&work, &["push", "-q", "origin", "main"]).await;
        let found = super::gates(&request, None, &rules, true, pool.clone())
            .await
            .unwrap();
        assert_eq!(outcome(found), vec![("repository", true), ("merged", true)]);
        let merge = git(&work, &["rev-parse", "HEAD"]).await.trim().to_string();
        assert_eq!(
            touching(&work, &merge, "r1").await.unwrap(),
            vec![merge.clone()]
        );
        assert!(touching(&work, &merge, "../r1").await.is_err());
        rules.review = true;
        rules.approvals = 1;
        let found = super::gates(&request, None, &rules, true, pool.clone())
            .await
            .unwrap();
        assert_eq!(
            outcome(found),
            vec![("repository", true), ("merged", true), ("review", false)]
        );
        rules.repository = "github.com/acme/other".into();
        let found = super::gates(&request, None, &rules, true, pool.clone())
            .await
            .unwrap();
        assert_eq!(outcome(found), vec![("repository", false)]);
        let _ = fs::remove_dir_all(base);
    }

    #[tokio::test]
    #[ignore = "isolated PostgreSQL lab via L8DB_E2E_DELIVERY_URL"]
    async fn live_production_requires_the_same_release_on_test() {
        use crate::db::provider::DatabaseKind;
        let raw = std::env::var("L8DB_E2E_DELIVERY_URL").unwrap();
        let parsed = url::Url::parse(&raw).unwrap();
        assert_eq!(parsed.host_str(), Some("127.0.0.1"));
        let database = parsed.path().trim_start_matches('/').to_string();
        let pool = db::pool::create_pool_state();
        let transactions = db::transaction::create_transaction_state();
        let connection = |schema: &str| Connection {
            kind: DatabaseKind::Postgres,
            connection_string: raw.clone(),
            database: Some(database.clone()),
            schema: schema.into(),
            project_id: "delivery-e2e".into(),
            read_only: false,
        };
        let test = connection("l8db_delivery_test");
        let production = connection("l8db_delivery_prod");
        let adapter = test.adapter(pool.clone()).unwrap();
        let mut keys = Vec::new();
        let mut context = Value::Null;
        for c in [&test, &production] {
            adapter
                .execute_query(&format!("DROP SCHEMA IF EXISTS {} CASCADE", c.schema))
                .await
                .unwrap();
            adapter
                .execute_query(&format!("CREATE SCHEMA {}", c.schema))
                .await
                .unwrap();
            let policy = control::Policy {
                track: "main".into(),
                pinned_release: None,
                paused: false,
                production: c.schema.ends_with("prod"),
                require_approval: false,
                operators: vec![],
                administrators: vec![],
                reviewers: vec![],
                delivery: None,
            };
            control::initialize(adapter.as_ref(), c, &policy)
                .await
                .unwrap();
            adapter
                .execute_query(&format!(
                    "CREATE TABLE {} (\"PROJECT_ID\" VARCHAR(100) PRIMARY KEY, \"RELEASE_ID\" VARCHAR(200), \"RELEASE_HASH\" VARCHAR(64), \"STATUS\" VARCHAR(20), \"LEASE\" VARCHAR(100))",
                    table(&c.schema, "STATE")
                ))
                .await
                .unwrap();
            adapter
                .execute_query(&format!(
                    "INSERT INTO {} VALUES ('delivery-e2e', 'r0', 'h0', 'ready', NULL)",
                    table(&c.schema, "STATE")
                ))
                .await
                .unwrap();
            let identity = adapter
                .execute_query(seeds::identity_sql(c.kind))
                .await
                .unwrap();
            keys.push(seeds::physical_key(c.kind, &c.schema, &identity.rows[0]));
            context = identity.rows[0].clone();
        }
        let base = std::env::temp_dir().join(format!(
            "l8db-delivery-live-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&base).unwrap();
        let remote = base.join("remote.git");
        let work = base.join("work");
        git(
            &base,
            &[
                "init",
                "-q",
                "--bare",
                "-b",
                "main",
                remote.to_str().unwrap(),
            ],
        )
        .await;
        git(
            &base,
            &[
                "clone",
                "-q",
                remote.to_str().unwrap(),
                work.to_str().unwrap(),
            ],
        )
        .await;
        git(&work, &["config", "user.email", "dev@example.com"]).await;
        git(&work, &["config", "user.name", "Dev"]).await;
        let team = serde_json::to_string_pretty(&json!({
            "format": 1,
            "projectId": "delivery-e2e",
            "connections": [{"id": "lab", "name": "Lab", "kind": "postgres", "host": "127.0.0.1", "port": parsed.port().unwrap_or(5432).to_string(), "service": null, "sslMode": "disable", "requiresTunnel": false}],
            "targets": [
                {"id": "prod", "name": "Kunde A · Produktion", "customer": "Kunde A", "stage": "production", "connectionRef": "lab", "database": database, "schema": production.schema, "production": true, "expectedPhysicalKey": keys[1]},
                {"id": "test", "name": "Kunde A · Test", "customer": "Kunde A", "stage": "test", "connectionRef": "lab", "database": database, "schema": test.schema, "production": false, "expectedPhysicalKey": keys[0]}
            ],
            "branches": {}
        }))
        .unwrap();
        fs::create_dir_all(work.join("database/releases")).unwrap();
        fs::write(work.join(super::super::team::PATH), &team).unwrap();
        git(&work, &["add", "."]).await;
        git(&work, &["commit", "-qm", "team"]).await;
        git(&work, &["push", "-q", "origin", "main"]).await;
        git(&work, &["switch", "-qc", "feature"]).await;
        fs::write(work.join("database/releases/r1.json"), "{}").unwrap();
        git(&work, &["add", "."]).await;
        git(&work, &["commit", "-qm", "release r1"]).await;
        git(&work, &["switch", "-q", "main"]).await;
        git(
            &work,
            &[
                "merge",
                "-q",
                "--no-ff",
                "feature",
                "-m",
                "Merge pull request #1",
            ],
        )
        .await;
        git(&work, &["push", "-q", "origin", "main"]).await;
        let head = git(&work, &["rev-parse", "HEAD"]).await.trim().to_string();
        let artifact = json!({
            "teamHash": control::hash(team.trim_end()),
            "execution": {"context": context, "reference": {"commit": head}, "releases": [{"id": "r1", "hash": "h1"}]}
        })
        .to_string();
        let payload = |c: &Connection| json!({"kind": "postgres", "connectionString": raw, "database": c.database, "schema": c.schema, "projectId": c.project_id});
        let request = |promotion: Value| -> Request {
            serde_json::from_value(json!({"connection": payload(&production), "repo": work.to_str().unwrap(), "targetId": "prod", "runId": "run", "artifact": artifact, "promotion": promotion})).unwrap()
        };
        let record = control::policy(adapter.as_ref(), &production)
            .await
            .unwrap();
        let mut rules = record.policy.clone();
        rules.delivery = Some(Delivery {
            repository: identity(remote.to_str().unwrap()).unwrap(),
            review: true,
            approvals: 0,
            test_first: true,
        });
        let save = |policy: control::Policy, revision: i64| control::Request {
            connection: production.clone(),
            action: "save-policy".into(),
            policy: Some(policy),
            revision: Some(revision),
            artifact: None,
            run_id: None,
            event: None,
            body: None,
            schemas: vec![],
            tx_id: None,
        };
        let invalid = control::handle(
            save(rules.clone(), record.revision),
            pool.clone(),
            transactions.clone(),
        )
        .await;
        assert!(invalid
            .unwrap_err()
            .contains("Ungültige Auslieferungsregeln"));
        rules.delivery.as_mut().unwrap().review = false;
        control::handle(
            save(rules, record.revision),
            pool.clone(),
            transactions.clone(),
        )
        .await
        .unwrap();
        let stored = json!(
            control::policy(adapter.as_ref(), &production)
                .await
                .unwrap()
                .policy
        );
        assert_eq!(stored["delivery"]["testFirst"], true);
        let unpromoted = request(json!([]));
        let verified = super::super::team::verify_request(&unpromoted)
            .await
            .unwrap();
        let problem = verify(&unpromoted, verified.as_ref(), &stored, pool.clone())
            .await
            .unwrap_err();
        assert!(problem.contains("Kein Testsystem von Kunde A"), "{problem}");
        let promoted = request(json!([{"targetId": "test", "connection": payload(&test)}]));
        let problem = verify(&promoted, verified.as_ref(), &stored, pool.clone())
            .await
            .unwrap_err();
        assert!(problem.contains("steht auf r0, nicht auf r1"), "{problem}");
        let disguised = request(json!([{"targetId": "test", "connection": payload(&production)}]));
        let problem = verify(&disguised, verified.as_ref(), &stored, pool.clone())
            .await
            .unwrap_err();
        assert!(
            problem.contains("passt nicht zur Teamkonfiguration"),
            "{problem}"
        );
        adapter
            .execute_query(&format!(
                "UPDATE {} SET \"RELEASE_ID\" = 'r1', \"RELEASE_HASH\" = 'h1', \"STATUS\" = 'running'",
                table(&test.schema, "STATE")
            ))
            .await
            .unwrap();
        let problem = verify(&promoted, verified.as_ref(), &stored, pool.clone())
            .await
            .unwrap_err();
        assert!(problem.contains("läuft noch"), "{problem}");
        adapter
            .execute_query(&format!(
                "UPDATE {} SET \"STATUS\" = 'ready'",
                table(&test.schema, "STATE")
            ))
            .await
            .unwrap();
        verify(&promoted, verified.as_ref(), &stored, pool.clone())
            .await
            .unwrap();
        let gates = super::gates(
            &promoted,
            verified.as_ref(),
            &serde_json::from_value::<Delivery>(stored["delivery"].clone()).unwrap(),
            true,
            pool.clone(),
        )
        .await
        .unwrap();
        assert_eq!(
            gates
                .iter()
                .map(|gate| (gate.id, gate.ok))
                .collect::<Vec<_>>(),
            vec![("repository", true), ("merged", true), ("test", true)]
        );
        let mut testing = stored.clone();
        testing["production"] = json!(false);
        verify(&unpromoted, verified.as_ref(), &testing, pool.clone())
            .await
            .unwrap();
        for c in [&test, &production] {
            adapter
                .execute_query(&format!("DROP SCHEMA IF EXISTS {} CASCADE", c.schema))
                .await
                .unwrap();
        }
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn delivery_rules_are_validated() {
        let mut rules = Delivery {
            repository: "github.com/acme/shop".into(),
            review: true,
            approvals: 2,
            test_first: true,
        };
        assert!(validate(&rules).is_ok());
        rules.approvals = 0;
        assert!(validate(&rules).is_err());
        rules.review = false;
        assert!(validate(&rules).is_ok());
        rules.repository = " ".into();
        assert!(validate(&rules).is_err());
        assert!(serde_json::from_value::<Delivery>(
            json!({"repository": "x", "review": false, "approvals": 0, "testFirst": false, "bypass": true})
        )
        .is_err());
    }
}
