use super::*;
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "l8db-extensions-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        ensure_directory(&path).unwrap();
        Self(path)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn archive() -> Value {
    json!({"format":1,"manifest":{"id":"test.example","main":"dist/extension.js","permissions":["filesystem:extension-storage"]},"files":{"dist/extension.js":"exports.activate = () => {}"}})
}
#[test]
fn installation_lifecycle_and_persistence() {
    let root = Fixture::new();
    operate(&root.0, "install", "", json!({"archive":archive()})).unwrap();
    assert_eq!(
        operate(&root.0, "list", "", Value::Null)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(operate(&root.0, "install", "", json!({"archive":archive()})).is_err());
    assert!(operate(&root.0, "get", "test.example", json!({"key":"key"})).is_err());
    operate(
        &root.0,
        "update",
        "test.example",
        json!({"enabled":true,"grants":["filesystem:extension-storage"],"configuration":{}}),
    )
    .unwrap();
    operate(
        &root.0,
        "set",
        "test.example",
        json!({"key":"key","value":{"answer":42}}),
    )
    .unwrap();
    assert_eq!(
        operate(&root.0, "get", "test.example", json!({"key":"key"})).unwrap(),
        json!({"answer":42})
    );
    operate(
        &root.0,
        "update",
        "test.example",
        json!({"enabled":false,"grants":[],"configuration":{}}),
    )
    .unwrap();
    assert!(!read_installed(&root.0, "test.example").unwrap().enabled);
    operate(&root.0, "remove", "test.example", Value::Null).unwrap();
    assert!(operate(&root.0, "list", "", Value::Null)
        .unwrap()
        .as_array()
        .unwrap()
        .is_empty());
    assert!(!root.0.join("test.example").exists());
}
#[test]
fn hostile_paths_and_permissions_are_rejected() {
    let root = Fixture::new();
    for id in [
        "../escape",
        "test/escape",
        "C:\\escape",
        ".hidden",
        "test..bad",
    ] {
        assert!(location(&root.0, id).is_err());
    }
    for path in [
        "../escape.js",
        "/absolute.js",
        "dist/../../bad.js",
        "dist\\bad.js",
        "dist/NUL.js",
    ] {
        let mut value = archive();
        value["files"][path] = json!("bad");
        assert!(validate_archive(&value).is_err());
    }
    operate(&root.0, "install", "", json!({"archive":archive()})).unwrap();
    assert!(operate(
        &root.0,
        "update",
        "test.example",
        json!({"enabled":true,"grants":["network"],"configuration":{}})
    )
    .is_err());
}
#[test]
fn discovery_isolates_corrupt_entries() {
    let root = Fixture::new();
    operate(&root.0, "install", "", json!({"archive":archive()})).unwrap();
    ensure_directory(&root.0.join("test.broken")).unwrap();
    fs::write(root.0.join("test.broken/package.json"), "broken").unwrap();
    assert_eq!(
        operate(&root.0, "list", "", Value::Null)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn development_import_reads_built_code_without_installation() {
    let root = Fixture::new();
    fs::write(
        root.0.join("l8db-extension.json"),
        r#"{"id":"test.example","main":"./dist/extension.js"}"#,
    )
    .unwrap();
    ensure_directory(&root.0.join("dist")).unwrap();
    fs::write(
        root.0.join("dist/extension.js"),
        "exports.activate = () => {}",
    )
    .unwrap();
    assert_eq!(
        import_directory(&root.0).unwrap()["files"]["dist/extension.js"],
        "exports.activate = () => {}"
    );
}
#[cfg(unix)]
#[test]
fn development_cannot_escape_through_symlinks() {
    let root = Fixture::new();
    let outside = Fixture::new();
    fs::write(outside.0.join("extension.js"), "secret").unwrap();
    fs::write(
        root.0.join("l8db-extension.json"),
        r#"{"id":"test.example","main":"extension.js"}"#,
    )
    .unwrap();
    std::os::unix::fs::symlink(outside.0.join("extension.js"), root.0.join("extension.js"))
        .unwrap();
    assert!(import_directory(&root.0).is_err());
    std::os::unix::fs::symlink(&outside.0, root.0.join("test.outside")).unwrap();
    assert!(location(&root.0, "test.outside").is_err());
}
#[test]
fn replace_keeps_storage_and_drops_undeclared_grants() {
    let root = Fixture::new();
    operate(&root.0, "install", "", json!({"archive":archive()})).unwrap();
    operate(
        &root.0,
        "update",
        "test.example",
        json!({"enabled":true,"grants":["filesystem:extension-storage"],"configuration":{"a":1}}),
    )
    .unwrap();
    operate(
        &root.0,
        "set",
        "test.example",
        json!({"key":"key","value":{"answer":42}}),
    )
    .unwrap();
    let mut next = archive();
    next["manifest"]["version"] = json!("2.0.0");
    operate(&root.0, "replace", "test.example", json!({"archive":next})).unwrap();
    let installed = read_installed(&root.0, "test.example").unwrap();
    assert_eq!(installed.archive["manifest"]["version"], json!("2.0.0"));
    assert_eq!(installed.grants, vec!["filesystem:extension-storage"]);
    assert_eq!(installed.configuration, json!({"a":1}));
    assert!(installed.enabled);
    assert_eq!(
        operate(&root.0, "get", "test.example", json!({"key":"key"})).unwrap(),
        json!({"answer":42})
    );
    let mut narrowed = archive();
    narrowed["manifest"]["version"] = json!("3.0.0");
    narrowed["manifest"]["permissions"] = json!([]);
    operate(
        &root.0,
        "replace",
        "test.example",
        json!({"archive":narrowed}),
    )
    .unwrap();
    assert!(read_installed(&root.0, "test.example")
        .unwrap()
        .grants
        .is_empty());
    let mut foreign = archive();
    foreign["manifest"]["id"] = json!("other.example");
    assert!(operate(
        &root.0,
        "replace",
        "test.example",
        json!({"archive":foreign})
    )
    .is_err());
}
