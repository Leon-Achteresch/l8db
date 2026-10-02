use super::*;

#[test]
fn oracle_identity_metadata_is_portable_and_preserves_semantics() {
    let row = serde_json::json!({"generation":"BY DEFAULT","onNull":"NO","options":"START WITH: 1, INCREMENT BY: 1, CACHE_SIZE: 20","sequence":"ISEQ$$_123"});
    let expected = "IDENTITY BY DEFAULT (CACHE_SIZE: 20, INCREMENT BY: 1, START WITH: 1)";
    assert_eq!(snapshot::oracle_identity_default(&row).unwrap(), expected);
    let mut changed = row.clone();
    changed["options"] = serde_json::json!(" CACHE_SIZE: 20, START WITH: 1, INCREMENT BY: 1 ");
    changed["sequence"] = serde_json::json!("ISEQ$$_987");
    assert_eq!(
        snapshot::oracle_identity_default(&changed).unwrap(),
        expected
    );
    for (key, value) in [
        ("generation", "ALWAYS"),
        ("onNull", "YES"),
        ("options", "CACHE_SIZE: 40"),
    ] {
        let mut changed = row.clone();
        changed[key] = serde_json::json!(value);
        assert_ne!(
            snapshot::oracle_identity_default(&changed).unwrap(),
            expected
        );
    }
    for options in ["", "CACHE_SIZE: 20, CACHE_SIZE: 40", "CACHE_SIZE: 20: 40"] {
        let mut changed = row.clone();
        changed["options"] = serde_json::json!(options);
        assert!(snapshot::oracle_identity_default(&changed).is_err());
    }
    let mut incomplete = row;
    incomplete.as_object_mut().unwrap().remove("onNull");
    assert!(snapshot::oracle_identity_default(&incomplete).is_err());
}

#[test]
fn oracle_not_null_normalization_preserves_custom_constraints_and_states() {
    let constraint = serde_json::json!({"constraint_type":"CHECK","columns":["ID"],"definition":"CHECK (\"ID\" IS NOT NULL)"});
    let row = serde_json::json!({"generated":"GENERATED NAME","status":"ENABLED","validated":"VALIDATED","deferrable":"NOT DEFERRABLE","deferred":"IMMEDIATE"});
    let mut cols = vec![crate::db::DetailedColumnInfo {
        name: "ID".into(),
        data_type: "NUMBER".into(),
        is_nullable: false,
        column_default: None,
        is_primary_key: true,
        ordinal_position: 1,
        character_maximum_length: None,
        comment: None,
    }];
    assert!(snapshot::redundant_oracle_not_null(
        &constraint,
        &row,
        &cols
    ));
    for (key, value) in [
        ("generated", "USER NAME"),
        ("status", "DISABLED"),
        ("validated", "NOT VALIDATED"),
        ("deferrable", "DEFERRABLE"),
        ("deferred", "DEFERRED"),
    ] {
        let mut changed = row.clone();
        changed[key] = serde_json::json!(value);
        assert!(!snapshot::redundant_oracle_not_null(
            &constraint,
            &changed,
            &cols
        ));
    }
    cols[0].is_nullable = true;
    assert!(!snapshot::redundant_oracle_not_null(
        &constraint,
        &row,
        &cols
    ));
}

#[tokio::test]
#[ignore = "three isolated Oracle customer logins with identical CUSTOMERS and ORDERS fixtures"]
async fn oracle_customer_snapshots_are_portable() {
    use crate::db::{create_adapter_from_string, pool::create_pool_state, provider::DatabaseKind};
    for table in ["CUSTOMERS", "ORDERS"] {
        let mut expected = String::new();
        for (suffix, schema) in [
            ("DEV", "L8DB_DEV"),
            ("A", "L8DB_CUSTOMER_A"),
            ("B", "L8DB_CUSTOMER_B"),
        ] {
            let url = std::env::var(format!("L8DB_VERSIONING_ORACLE_TEST_URL_{suffix}"))
                .expect("isolated Oracle test URL required");
            let adapter =
                create_adapter_from_string(DatabaseKind::Oracle, &url, None, create_pool_state())
                    .expect("valid Oracle test URL");
            let object = snapshot::Snapshot {
                schema: schema.into(),
                source_schema: "L8DB_DEV".into(),
                name: table.into(),
                kind: "table".into(),
                metadata_version: Some(3),
                definition: expected.clone(),
            };
            let actual = snapshot::definition(adapter.as_ref(), DatabaseKind::Oracle, &object)
                .await
                .expect("Oracle snapshot readable");
            assert!(actual.contains("DEFAULT IDENTITY BY DEFAULT ("));
            assert!(!actual.contains("ISEQ$$_"));
            assert!(!actual.contains("VARCHAR2(200)(200)"));
            assert!(!actual.contains("IS NOT NULL) [ENABLED"));
            if expected.is_empty() {
                expected = actual;
                let legacy = snapshot::Snapshot {
                    metadata_version: Some(2),
                    ..object
                };
                let previous =
                    snapshot::definition(adapter.as_ref(), DatabaseKind::Oracle, &legacy)
                        .await
                        .expect("legacy Oracle snapshot readable");
                assert!(previous.contains("ISEQ$$_"));
                assert!(previous.contains("IS NOT NULL) [ENABLED"));
            } else {
                assert_eq!(actual, expected, "{suffix}.{table}");
            }
        }
    }
}

fn request(repo: &Path, action: &str) -> Request {
    Request {
        action: action.into(),
        repo: repo.to_string_lossy().into(),
        path: None,
        content: None,
        expected: None,
        revision: None,
        name: None,
        paths: None,
        base: None,
        incoming: None,
    }
}

fn temp() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "l8db-versioning-{}-{}",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn rejects_traversal_and_unsupported_paths() {
    for path in [
        "../secret.sql",
        "database/../secret.sql",
        "database/.git/config.json",
        "database//x.sql",
        "database/a/./x.sql",
        "database/a\\x.sql",
        "database/a.sh",
        "database/a.sql:evil",
    ] {
        assert!(relative(path).is_err(), "{path}");
    }
    assert!(relative("database/packages/ORDER SERVICE.pkb").is_ok());
}

#[test]
fn writes_require_matching_previous_content() {
    let root = temp();
    let path = root.join("state.json");
    write(&path, "first", None).unwrap();
    assert!(write(&path, "lost update", None).is_err());
    assert!(write(&path, "lost update", Some("wrong")).is_err());
    write(&path, "second", Some("first")).unwrap();
    assert_eq!(read(&path).unwrap().unwrap(), "second");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn detects_incomplete_merge_markers() {
    assert!(has_conflict_markers("<<<<<<< Aktueller Branch\nours\n"));
    assert!(has_conflict_markers(">>>>>>> Quell-Branch\n"));
    assert!(has_conflict_markers("=======\r\n"));
    assert!(!has_conflict_markers("SELECT '<<<<<<<' AS sample;\n"));
}

fn team_fixture() -> Value {
    json!({"format":1,"projectId":"team-project","connections":[{"id":"shared-server","name":"Server","kind":"postgres","host":"db.example.invalid","port":"5432","service":null,"sslMode":"verify-full","requiresTunnel":true}],"targets":[{"id":"customer-a","name":"Customer A","connectionRef":"shared-server","database":"app","schema":"customer_a","production":true,"requireApproval":true}],"branches":{"feature/test":{"targetId":"customer-a"}}})
}

#[test]
fn team_configuration_rejects_secrets_and_local_profile_fields() {
    let fixture = team_fixture();
    assert!(team::parse(&fixture.to_string()).is_ok());
    let mut secret = fixture.clone();
    secret["connections"][0]["password"] = json!("must-not-be-written");
    assert!(team::parse(&secret.to_string()).is_err());
    let mut local = fixture.clone();
    local["targets"][0]["connectionId"] = json!("private-profile");
    assert!(team::parse(&local.to_string()).is_err());
    let mut missing = fixture;
    missing["targets"][0]["connectionRef"] = json!("missing-server");
    assert!(team::parse(&missing.to_string()).is_err());
}

#[tokio::test]
async fn team_configuration_is_absent_in_a_repository_without_commits() {
    let root = temp();
    git(&root, &["init", "-q"]).await.unwrap();
    assert_eq!(team::committed(&root).await.unwrap(), None);
    fs::create_dir_all(root.join("database")).unwrap();
    fs::write(root.join(team::PATH), team_fixture().to_string()).unwrap();
    assert!(team::committed(&root)
        .await
        .unwrap_err()
        .contains("offene Git"));
}

#[tokio::test]
async fn team_configuration_is_cloneable_and_runtime_updates_leave_git_clean() {
    let root = temp();
    handle(request(&root, "init")).await.unwrap();
    git(&root, &["config", "user.email", "test@example.invalid"])
        .await
        .unwrap();
    git(&root, &["config", "user.name", "Team Test"])
        .await
        .unwrap();
    let team = team_fixture().to_string();
    let local = json!({"format":1,"projectId":"team-project","targets":[{"id":"customer-a","connectionId":"private-profile","release":null,"history":[]}]}).to_string();
    let mut write = request(&root, "targets-write");
    write.content = Some(json!({"local":local,"team":team}).to_string());
    write.expected = Some(json!({"local":null,"team":null}).to_string());
    handle(write).await.unwrap();
    let mut commit = request(&root, "commit");
    commit.paths = Some(vec![team::PATH.into()]);
    commit.name = Some("Share team configuration".into());
    handle(commit).await.unwrap();
    let exported = git(&root, &["show", "HEAD:database/team.json"])
        .await
        .unwrap();
    assert!(!exported.contains("private-profile"));
    assert_eq!(
        team::committed(&root).await.unwrap(),
        Some(exported.clone())
    );
    fs::write(root.join(team::PATH), format!("{exported}\n")).unwrap();
    assert!(team::committed(&root)
        .await
        .unwrap_err()
        .contains("offene Git"));
    fs::write(root.join(team::PATH), &exported).unwrap();
    let clone = temp();
    git(&clone, &["clone", "--quiet", root.to_str().unwrap(), "."])
        .await
        .unwrap();
    assert!(handle(request(&clone, "local-read"))
        .await
        .unwrap()
        .is_null());
    assert_eq!(
        team::parse(&read(&clone.join(team::PATH)).unwrap().unwrap())
            .unwrap()
            .project_id,
        "team-project"
    );
    let updated =
        json!({"format":1,"projectId":"team-project","targets":[],"runtime":"changed"}).to_string();
    let mut write = request(&root, "targets-write");
    write.content = Some(json!({"local":updated,"team":team}).to_string());
    write.expected = Some(json!({"local":local,"team":team}).to_string());
    handle(write).await.unwrap();
    assert!(git(&root, &["status", "--porcelain"])
        .await
        .unwrap()
        .is_empty());
    let mut stale = request(&root, "targets-write");
    stale.content = Some(json!({"local":local,"team":team}).to_string());
    stale.expected = Some(json!({"local":local,"team":team}).to_string());
    assert!(handle(stale)
        .await
        .unwrap_err()
        .contains("inzwischen geändert"));
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(clone).unwrap();
}

#[tokio::test]
async fn rollout_review_is_bound_to_committed_team_and_database_identity() {
    let root = temp();
    handle(request(&root, "init")).await.unwrap();
    git(&root, &["config", "user.email", "test@example.invalid"])
        .await
        .unwrap();
    git(&root, &["config", "user.name", "Team Test"])
        .await
        .unwrap();
    let context = json!({"database":"app","server":"127.0.0.1","port":5432,"edition":null});
    let mut team = team_fixture();
    team["targets"][0]["expectedPhysicalKey"] = json!(seeds::physical_key(
        crate::db::provider::DatabaseKind::Postgres,
        "customer_a",
        &context
    ));
    let content = format!("{}\n", serde_json::to_string_pretty(&team).unwrap());
    fs::create_dir_all(root.join("database")).unwrap();
    fs::write(root.join(team::PATH), &content).unwrap();
    git(&root, &["add", team::PATH]).await.unwrap();
    git(&root, &["commit", "-m", "Team configuration"])
        .await
        .unwrap();
    let artifact =
        json!({"teamHash":control::hash(content.trim_end()),"execution":{"context":context}});
    let mut execution: runner::Request = serde_json::from_value(json!({"connection":{"kind":"postgres","connectionString":"postgres://example.invalid/app","database":"app","schema":"customer_a","projectId":"team-project"},"repo":root.to_str().unwrap(),"targetId":"customer-a","runId":"review-test","artifact":artifact.to_string()})).unwrap();
    assert!(team::verify_request(&execution).await.unwrap().is_some());
    execution.connection.schema = "customer_b".into();
    assert!(team::verify_request(&execution).await.is_err());
    execution.connection.schema = "customer_a".into();
    let mut altered = artifact;
    altered["teamHash"] = json!("0".repeat(64));
    execution.artifact = altered.to_string();
    assert!(team::verify_request(&execution).await.is_err());
    fs::write(root.join(team::PATH), format!("{content}\n")).unwrap();
    assert!(team::verify_request(&execution)
        .await
        .err()
        .unwrap()
        .contains("offene Git"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn shared_policy_cannot_silently_diverge_from_git() {
    let target = team::parse(&team_fixture().to_string())
        .unwrap()
        .targets
        .remove(0);
    let mut policy = json!({"production":true,"pinnedRelease":null,"requireApproval":true});
    assert!(team::verify_policy(&target, &policy).is_ok());
    policy["requireApproval"] = json!(false);
    assert!(team::verify_policy(&target, &policy).is_err());
    policy["requireApproval"] = json!(true);
    policy["production"] = json!(false);
    assert!(team::verify_policy(&target, &policy).is_err());
}

#[cfg(unix)]
#[test]
fn rejects_symlinks() {
    let root = temp();
    std::os::unix::fs::symlink(std::env::temp_dir(), root.join("database")).unwrap();
    assert!(safe_file(&root, "database/secret.sql").is_err());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn repository_roundtrip_preserves_unrelated_staging_and_local_targets() {
    let root = temp();
    handle(request(&root, "init")).await.unwrap();
    git(&root, &["config", "user.email", "test@example.invalid"])
        .await
        .unwrap();
    git(&root, &["config", "user.name", "Versioning Test"])
        .await
        .unwrap();
    fs::write(root.join("unrelated.txt"), "unrelated").unwrap();
    git(&root, &["add", "unrelated.txt"]).await.unwrap();
    let mut req = request(&root, "write");
    req.path = Some("database/packages/example.pkb".into());
    req.content = Some("package body v1".into());
    handle(req).await.unwrap();
    let mut req = request(&root, "commit");
    req.paths = Some(vec!["database/packages/example.pkb".into()]);
    req.name = Some("Baseline".into());
    let commit = handle(req).await.unwrap();
    assert!(git(&root, &["diff", "--cached", "--name-only"])
        .await
        .unwrap()
        .contains("unrelated.txt"));
    assert_eq!(
        git(&root, &["show", "HEAD:database/packages/example.pkb"])
            .await
            .unwrap(),
        "package body v1"
    );
    let mut req = request(&root, "local-write");
    req.content = Some("{\"targets\":[]}".into());
    handle(req).await.unwrap();
    assert!(!git(&root, &["status", "--porcelain"])
        .await
        .unwrap()
        .contains("targets"));
    let mut req = request(&root, "read");
    req.path = Some("database/packages/example.pkb".into());
    req.revision = Some(commit.as_str().unwrap().into());
    assert_eq!(handle(req).await.unwrap(), json!("package body v1"));
    let mut req = request(&root, "branch");
    req.name = Some("feature/test".into());
    assert!(handle(req).await.is_err());
    git(&root, &["commit", "-m", "Unrelated"]).await.unwrap();
    let mut req = request(&root, "branch");
    req.name = Some("feature/test".into());
    handle(req).await.unwrap();
    assert_eq!(
        handle(request(&root, "status")).await.unwrap()["branch"],
        "feature/test"
    );
    fs::remove_file(root.join("database/packages/example.pkb")).unwrap();
    let status = handle(request(&root, "status")).await.unwrap();
    assert!(status["files"]
        .as_array()
        .unwrap()
        .contains(&json!("database/packages/example.pkb")));
    let mut req = request(&root, "commit");
    req.paths = Some(vec!["database/packages/example.pkb".into()]);
    req.name = Some("Remove object source".into());
    handle(req).await.unwrap();
    assert!(git(&root, &["show", "HEAD:database/packages/example.pkb"])
        .await
        .is_err());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn committed_releases_are_immutable_and_merge_handles_large_packages() {
    let root = temp();
    handle(request(&root, "init")).await.unwrap();
    git(&root, &["config", "user.name", "Test"]).await.unwrap();
    git(&root, &["config", "user.email", "test@example.invalid"])
        .await
        .unwrap();
    let mut req = request(&root, "write");
    req.path = Some("database/releases/v1.json".into());
    req.content = Some("{}".into());
    handle(req).await.unwrap();
    let mut req = request(&root, "commit");
    req.name = Some("Release".into());
    req.paths = Some(vec!["database/releases/v1.json".into()]);
    handle(req).await.unwrap();
    let mut req = request(&root, "write");
    req.path = Some("database/releases/v1.json".into());
    req.content = Some("{\"changed\":true}".into());
    req.expected = Some("{}".into());
    assert!(handle(req).await.unwrap_err().contains("unveränderlich"));
    let base = (0..8000).map(|i| format!("line {i}\n")).collect::<String>();
    let mut req = request(&root, "merge");
    req.base = Some(base.clone());
    req.content = Some(base.replace("line 5\n", "customer\n"));
    req.incoming = Some(base.replace("line 7990\n", "product\n"));
    let merged = handle(req).await.unwrap();
    assert_eq!(merged["conflicts"], false);
    assert!(merged["content"].as_str().unwrap().contains("customer"));
    assert!(merged["content"].as_str().unwrap().contains("product"));
    let mut req = request(&root, "merge");
    req.base = Some("same\n".into());
    req.content = Some("customer\n".into());
    req.incoming = Some("product\n".into());
    assert_eq!(handle(req).await.unwrap()["conflicts"], true);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn branch_merge_uses_common_ancestor_and_blocks_unresolved_commits() {
    let root = temp();
    handle(request(&root, "init")).await.unwrap();
    git(&root, &["config", "user.name", "Test"]).await.unwrap();
    git(&root, &["config", "user.email", "test@example.invalid"])
        .await
        .unwrap();
    let folder = root.join("database/objects");
    fs::create_dir_all(&folder).unwrap();
    let file = folder.join("orders.sql");
    let other = folder.join("other.sql");
    fs::write(&file, "CREATE VIEW orders AS\nSELECT 1 AS value;\n").unwrap();
    fs::write(&other, "SELECT 'untouched';\n").unwrap();
    git(&root, &["add", "--", "database/"]).await.unwrap();
    git(&root, &["commit", "-m", "Baseline"]).await.unwrap();
    let current_branch = git(&root, &["symbolic-ref", "--short", "HEAD"])
        .await
        .unwrap();
    git(&root, &["switch", "-c", "product"]).await.unwrap();
    fs::write(&file, "CREATE VIEW orders AS\nSELECT 2 AS value;\n").unwrap();
    fs::write(&other, "SELECT 'product only';\n").unwrap();
    git(&root, &["commit", "-am", "Product changes"])
        .await
        .unwrap();
    git(&root, &["switch", current_branch.trim()])
        .await
        .unwrap();
    fs::write(&file, "CREATE VIEW orders AS\nSELECT 3 AS value;\n").unwrap();
    git(&root, &["commit", "-am", "Customer change"])
        .await
        .unwrap();

    let mut req = request(&root, "merge-base");
    req.name = Some("product".into());
    req.path = Some("database/objects/orders.sql".into());
    let revisions = handle(req).await.unwrap();
    let base = revisions["base"].as_str().unwrap();
    let incoming = revisions["incoming"].as_str().unwrap();
    assert_ne!(base, incoming);
    assert_eq!(revisions["head"], revision(&root, "HEAD").await.unwrap());
    let mut req = request(&root, "read");
    req.path = Some("database/objects/orders.sql".into());
    req.revision = Some(base.into());
    let ancestor = handle(req).await.unwrap().as_str().unwrap().to_string();
    let mut req = request(&root, "read");
    req.path = Some("database/objects/orders.sql".into());
    req.revision = Some(incoming.into());
    let product = handle(req).await.unwrap().as_str().unwrap().to_string();
    let current = fs::read_to_string(&file).unwrap();
    let mut req = request(&root, "merge");
    req.content = Some(current.clone());
    req.base = Some(ancestor);
    req.incoming = Some(product);
    let merged = handle(req).await.unwrap();
    assert_eq!(merged["conflicts"], true);
    let conflicted = merged["content"].as_str().unwrap();
    assert!(conflicted.contains("<<<<<<< Aktueller Branch"));
    assert_eq!(fs::read_to_string(&file).unwrap(), current);

    let mut req = request(&root, "write");
    req.path = Some("database/objects/orders.sql".into());
    req.content = Some(conflicted.into());
    req.expected = Some(current);
    handle(req).await.unwrap();
    let mut req = request(&root, "commit");
    req.paths = Some(vec!["database/objects/orders.sql".into()]);
    req.name = Some("Conflict must fail".into());
    assert!(handle(req).await.unwrap_err().contains("Merge-Konflikte"));
    assert!(git(&root, &["diff", "--cached", "--name-only"])
        .await
        .unwrap()
        .is_empty());

    let mut req = request(&root, "write");
    req.path = Some("database/objects/orders.sql".into());
    req.content = Some("CREATE VIEW orders AS\nSELECT 4 AS value;\n".into());
    req.expected = Some(conflicted.into());
    handle(req).await.unwrap();
    let mut req = request(&root, "commit");
    req.paths = Some(vec!["database/objects/orders.sql".into()]);
    req.name = Some("Resolve customer conflict".into());
    handle(req).await.unwrap();
    assert_eq!(fs::read_to_string(&other).unwrap(), "SELECT 'untouched';\n");
    assert_eq!(
        git(&root, &["show", "HEAD:database/objects/orders.sql"])
            .await
            .unwrap(),
        "CREATE VIEW orders AS\nSELECT 4 AS value;\n"
    );
    assert!(git(&root, &["merge", "product"]).await.is_err());
    fs::write(&file, "CREATE VIEW orders AS\nSELECT 5 AS value;\n").unwrap();
    let mut req = request(&root, "commit");
    req.paths = Some(vec!["database/objects/orders.sql".into()]);
    req.name = Some("Unstaged resolution must fail".into());
    assert!(handle(req).await.unwrap_err().contains("Git enthält"));
    git(&root, &["merge", "--abort"]).await.unwrap();
    assert_eq!(fs::read_to_string(&other).unwrap(), "SELECT 'untouched';\n");
    assert_eq!(
        fs::read_to_string(&file).unwrap(),
        "CREATE VIEW orders AS\nSELECT 4 AS value;\n"
    );
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn historical_file_inventory_ignores_untracked_and_deleted_working_files() {
    let root = temp();
    handle(request(&root, "init")).await.unwrap();
    git(&root, &["config", "user.name", "Test"]).await.unwrap();
    git(&root, &["config", "user.email", "test@example.invalid"])
        .await
        .unwrap();
    let mut req = request(&root, "write");
    req.path = Some("database/releases/v1.json".into());
    req.content = Some("{}".into());
    handle(req).await.unwrap();
    let mut req = request(&root, "commit");
    req.paths = Some(vec!["database/releases/v1.json".into()]);
    req.name = Some("Release".into());
    let commit = handle(req).await.unwrap();
    fs::remove_file(root.join("database/releases/v1.json")).unwrap();
    fs::write(
        root.join("database/releases/untracked.json"),
        "invalid draft",
    )
    .unwrap();
    let mut req = request(&root, "files");
    req.revision = Some(commit.as_str().unwrap().into());
    assert_eq!(
        handle(req).await.unwrap(),
        json!(["database/releases/v1.json"])
    );
    assert!(handle(request(&root, "files")).await.is_err());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn local_target_state_is_shared_by_worktrees_and_remote_sync_is_fast_forward_only() {
    let root = temp();
    let remote = temp();
    let worktree = temp();
    git(&remote, &["init", "--bare"]).await.unwrap();
    handle(request(&root, "init")).await.unwrap();
    git(&root, &["config", "user.name", "Test"]).await.unwrap();
    git(&root, &["config", "user.email", "test@example.invalid"])
        .await
        .unwrap();
    let mut req = request(&root, "write");
    req.path = Some("database/project.json".into());
    req.content = Some("{}".into());
    handle(req).await.unwrap();
    let mut req = request(&root, "commit");
    req.name = Some("Initial".into());
    req.paths = Some(vec!["database/project.json".into()]);
    handle(req).await.unwrap();
    git(
        &root,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    )
    .await
    .unwrap();
    handle(request(&root, "push")).await.unwrap();
    handle(request(&root, "fetch")).await.unwrap();
    handle(request(&root, "pull")).await.unwrap();
    git(
        &root,
        &[
            "worktree",
            "add",
            "-b",
            "customer-review",
            worktree.to_str().unwrap(),
        ],
    )
    .await
    .unwrap();
    let mut req = request(&root, "local-write");
    req.content = Some("{\"targets\":[]}".into());
    handle(req).await.unwrap();
    assert_eq!(
        handle(request(&worktree, "local-read")).await.unwrap(),
        "{\"targets\":[]}"
    );
    let mut req = request(&worktree, "local-write");
    req.content = Some("{}".into());
    assert!(handle(req).await.is_err());
    git(&root, &["worktree", "remove", worktree.to_str().unwrap()])
        .await
        .unwrap();
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(remote).unwrap();
}

#[tokio::test]
async fn branch_graph_and_merge_preserve_forks_and_abort_conflicts() {
    let root = temp();
    handle(request(&root, "init")).await.unwrap();
    git(&root, &["config", "user.email", "test@example.invalid"])
        .await
        .unwrap();
    git(&root, &["config", "user.name", "Versioning Test"])
        .await
        .unwrap();
    fs::create_dir_all(root.join("database/objects")).unwrap();
    fs::write(root.join("database/objects/view.sql"), "SELECT 1\n").unwrap();
    git(&root, &["add", "."]).await.unwrap();
    git(&root, &["commit", "-m", "Baseline"]).await.unwrap();
    let base = git(&root, &["symbolic-ref", "--short", "HEAD"])
        .await
        .unwrap()
        .trim()
        .to_string();
    let mut branch = request(&root, "branch");
    branch.name = Some("feature/billing".into());
    handle(branch).await.unwrap();
    fs::write(root.join("database/objects/billing.sql"), "SELECT 2\n").unwrap();
    git(&root, &["add", "."]).await.unwrap();
    git(&root, &["commit", "-m", "Billing"]).await.unwrap();
    let mut checkout = request(&root, "checkout");
    checkout.name = Some(base.clone());
    handle(checkout).await.unwrap();
    fs::write(root.join("database/objects/other.sql"), "SELECT 3\n").unwrap();
    git(&root, &["add", "."]).await.unwrap();
    git(&root, &["commit", "-m", "Other"]).await.unwrap();
    let mut merge = request(&root, "merge-branch");
    merge.name = Some("feature/billing".into());
    handle(merge).await.unwrap();
    let graph = handle(request(&root, "graph")).await.unwrap();
    assert!(graph.as_str().unwrap().contains("feature/billing"));
    assert_eq!(
        graph
            .as_str()
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .split('\t')
            .nth(1)
            .unwrap()
            .split(' ')
            .count(),
        2
    );
    let merged = revision(&root, "HEAD").await.unwrap();
    let mut delete = request(&root, "delete-branch");
    delete.name = Some("feature/billing".into());
    handle(delete).await.unwrap();
    let mut branch = request(&root, "branch");
    branch.name = Some("feature/from-baseline".into());
    branch.revision = Some(format!("{merged}~1"));
    handle(branch).await.unwrap();
    assert!(!root.join("database/objects/billing.sql").exists());
    let mut checkout = request(&root, "checkout");
    checkout.name = Some(base.clone());
    handle(checkout).await.unwrap();
    let mut delete = request(&root, "delete-branch");
    delete.name = Some("main".into());
    assert!(handle(delete).await.is_err());
    let mut branch = request(&root, "branch");
    branch.name = Some("feature/conflict".into());
    handle(branch).await.unwrap();
    fs::write(root.join("database/objects/view.sql"), "SELECT 4\n").unwrap();
    git(&root, &["add", "."]).await.unwrap();
    git(&root, &["commit", "-m", "Feature edit"]).await.unwrap();
    let mut checkout = request(&root, "checkout");
    checkout.name = Some(base);
    handle(checkout).await.unwrap();
    fs::write(root.join("database/objects/view.sql"), "SELECT 5\n").unwrap();
    git(&root, &["add", "."]).await.unwrap();
    git(&root, &["commit", "-m", "Base edit"]).await.unwrap();
    let head = revision(&root, "HEAD").await.unwrap();
    let mut merge = request(&root, "merge-branch");
    merge.name = Some("feature/conflict".into());
    assert!(handle(merge).await.unwrap_err().contains("Konflikte"));
    assert_eq!(revision(&root, "HEAD").await.unwrap(), head);
    assert!(git(&root, &["status", "--porcelain"])
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        fs::read_to_string(root.join("database/objects/view.sql")).unwrap(),
        "SELECT 5\n"
    );
    let mut delete = request(&root, "delete-branch");
    delete.name = Some("feature/conflict".into());
    assert!(handle(delete).await.is_err());
    fs::write(root.join("database/objects/view.sql"), "unsaved\n").unwrap();
    let mut merge = request(&root, "merge-branch");
    merge.name = Some("feature/billing".into());
    assert!(handle(merge).await.is_err());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn branch_merge_cannot_modify_or_delete_published_releases() {
    let root = temp();
    handle(request(&root, "init")).await.unwrap();
    git(&root, &["config", "user.email", "test@example.invalid"])
        .await
        .unwrap();
    git(&root, &["config", "user.name", "Versioning Test"])
        .await
        .unwrap();
    fs::create_dir_all(root.join("database/releases")).unwrap();
    fs::write(root.join("database/releases/v1.json"), "{}\n").unwrap();
    git(&root, &["add", "."]).await.unwrap();
    git(&root, &["commit", "-m", "Baseline"]).await.unwrap();
    let base = git(&root, &["symbolic-ref", "--short", "HEAD"])
        .await
        .unwrap()
        .trim()
        .to_string();
    for (name, deleted) in [("feature/modified", false), ("feature/deleted", true)] {
        let mut branch = request(&root, "branch");
        branch.name = Some(name.into());
        handle(branch).await.unwrap();
        if deleted {
            fs::remove_file(root.join("database/releases/v1.json")).unwrap();
        } else {
            fs::write(
                root.join("database/releases/v1.json"),
                "{\"changed\":true}\n",
            )
            .unwrap();
        }
        git(&root, &["add", "."]).await.unwrap();
        git(&root, &["commit", "-m", "Change existing release"])
            .await
            .unwrap();
        let mut checkout = request(&root, "checkout");
        checkout.name = Some(base.clone());
        handle(checkout).await.unwrap();
        let head = revision(&root, "HEAD").await.unwrap();
        let mut merge = request(&root, "merge-branch");
        merge.name = Some(name.into());
        assert!(handle(merge)
            .await
            .unwrap_err()
            .contains("commitete Releases"));
        assert_eq!(revision(&root, "HEAD").await.unwrap(), head);
        assert_eq!(
            fs::read_to_string(root.join("database/releases/v1.json")).unwrap(),
            "{}\n"
        );
    }
    fs::remove_dir_all(root).unwrap();
}
