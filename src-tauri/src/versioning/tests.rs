use super::*;

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
