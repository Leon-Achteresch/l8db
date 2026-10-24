use super::catalog::{allowed, Catalog, Keys, Objects};
use super::config::{self, McpConfig, McpConnection};
use crate::db::ColumnInfo;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;

const VERSION: u32 = 1;
const MAX_COLUMNS: usize = 5_000_000;

#[derive(Serialize, Deserialize)]
struct Disk {
    version: u32,
    key: String,
    taken: i64,
    ms: u64,
    schemas: Vec<String>,
    tables: Vec<String>,
    columns: Vec<String>,
    types: Vec<String>,
    layout: Vec<(u32, u32, Vec<u32>)>,
    #[serde(default)]
    objects: Option<Objects>,
    #[serde(default)]
    keys: Option<Keys>,
}

fn hash(parts: &[&str]) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update(part.as_bytes());
        digest.update([0u8]);
    }
    digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn dir() -> Option<PathBuf> {
    #[cfg(test)]
    std::env::var_os("L8DB_MCP_CONFIG")?;
    Some(config::config_path().with_file_name("mcp-catalogs"))
}

fn prefix(id: &str) -> String {
    hash(&[id])[..16].to_string()
}

pub(super) fn path(connection: &McpConnection) -> Option<PathBuf> {
    let database = hash(&[connection.database.as_deref().unwrap_or("")]);
    Some(dir()?.join(format!(
        "{}-{}.json",
        prefix(&connection.id),
        &database[..8]
    )))
}

pub(super) fn key(config: &McpConfig, connection: &McpConnection) -> String {
    let rules = |rules: &[config::RedactRule]| {
        rules
            .iter()
            .filter(|rule| rule.enabled)
            .map(|rule| rule.pattern.as_str())
            .collect::<Vec<_>>()
            .join("\u{1f}")
    };
    let kind = serde_json::to_string(&connection.kind).unwrap_or_default();
    hash(&[
        &VERSION.to_string(),
        &kind,
        &connection.connection_string,
        connection.database.as_deref().unwrap_or(""),
        &connection.allowed_schemas().join("\u{1f}"),
        &rules(&config.redaction.columns),
        &rules(&config.redaction.values),
        &config.redaction.replacement,
        &connection.sensitive_columns().join("\u{1f}"),
    ])
}

fn shared(config: &McpConfig, connection: &McpConnection) -> Option<String> {
    let global = config::load();
    if !global.enabled {
        return None;
    }
    let policy = super::server::exposed(&global).find(|entry| entry.id == connection.id)?;
    let policy = McpConnection {
        database: connection.database.clone(),
        ..policy.clone()
    };
    let wanted = key(config, connection);
    (key(&global, &policy) == wanted).then_some(wanted)
}

pub(super) fn current(config: &McpConfig, connection: &McpConnection, catalog: &Catalog) -> bool {
    if let Some(key) = &catalog.key {
        if *key != super::persist::key(config, connection) {
            return false;
        }
    }
    match (catalog.file(), path(connection)) {
        (Some(seen), Some(path)) => std::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .is_ok_and(|modified| modified == seen),
        _ => true,
    }
}

pub(super) fn stamp(connection: &McpConnection) -> Option<std::time::SystemTime> {
    std::fs::metadata(path(connection)?)
        .and_then(|meta| meta.modified())
        .ok()
}

pub(super) fn load(config: &McpConfig, connection: &McpConnection) -> Option<Catalog> {
    let path = path(connection)?;
    let key = shared(config, connection)?;
    let bytes = std::fs::read(&path).ok()?;
    let modified = std::fs::metadata(&path)
        .and_then(|meta| meta.modified())
        .ok();
    let disk: Disk = match serde_json::from_slice(&bytes) {
        Ok(disk) => disk,
        Err(_) => {
            let _ = std::fs::remove_file(&path);
            return None;
        }
    };
    drop(bytes);
    if disk.version != VERSION || disk.key != key {
        let _ = std::fs::remove_file(&path);
        return None;
    }
    if !super::catalog::fresh(disk.taken, disk.ms) {
        return None;
    }
    let text = |list: &[String], index: u32| list.get(index as usize).cloned().unwrap_or_default();
    let mut columns = Vec::with_capacity(
        disk.layout
            .iter()
            .map(|(_, _, cells)| cells.len() / 2)
            .sum(),
    );
    for (schema, table, cells) in &disk.layout {
        let schema = text(&disk.schemas, *schema);
        let table = text(&disk.tables, *table);
        for pair in cells.chunks_exact(2) {
            columns.push(ColumnInfo {
                schema: schema.clone(),
                table: table.clone(),
                name: text(&disk.columns, pair[0]),
                data_type: text(&disk.types, pair[1]),
            });
        }
    }
    let catalog = Catalog::restored(columns, disk.taken, disk.ms, key);
    if let Some(mut objects) = disk.objects {
        objects.sort();
        catalog.set_objects(objects, false);
    }
    if let Some(keys) = disk.keys {
        catalog.set_keys(keys);
    }
    catalog.saved(modified);
    Some(catalog)
}

fn intern(list: &mut Vec<String>, seen: &mut HashMap<String, u32>, text: &str) -> u32 {
    if let Some(id) = seen.get(text) {
        return *id;
    }
    list.push(text.to_string());
    seen.insert(text.to_string(), (list.len() - 1) as u32);
    (list.len() - 1) as u32
}

fn encode(catalog: &Catalog, schemas: &[String], key: String) -> Disk {
    let tables = catalog.tables();
    let mut disk = Disk {
        version: VERSION,
        key,
        taken: catalog.taken,
        ms: catalog.ms,
        schemas: Vec::new(),
        tables: Vec::new(),
        columns: Vec::new(),
        types: Vec::new(),
        layout: Vec::new(),
        objects: None,
        keys: None,
    };
    let mut seen = [
        HashMap::new(),
        HashMap::new(),
        HashMap::new(),
        HashMap::new(),
    ];
    for table in tables
        .list
        .iter()
        .filter(|table| tables.visible(table, schemas))
    {
        let schema = intern(&mut disk.schemas, &mut seen[0], tables.schema(table));
        let name = intern(&mut disk.tables, &mut seen[1], tables.name(table));
        let mut cells = Vec::with_capacity(table.columns.len() * 2);
        for &index in &table.columns {
            let column = &catalog.columns[index as usize];
            cells.push(intern(&mut disk.columns, &mut seen[2], &column.name));
            cells.push(intern(&mut disk.types, &mut seen[3], &column.data_type));
        }
        disk.layout.push((schema, name, cells));
    }
    disk.objects = catalog.objects().map(|objects| Objects {
        taken: objects.taken,
        ms: objects.ms,
        relations: objects
            .relations
            .iter()
            .filter(|entry| allowed(&entry.schema, schemas))
            .cloned()
            .collect(),
        routines: objects
            .routines
            .iter()
            .filter(|entry| allowed(&entry.schema, schemas))
            .cloned()
            .collect(),
        triggers: objects
            .triggers
            .iter()
            .filter(|entry| allowed(&entry.schema, schemas))
            .cloned()
            .collect(),
        ..Objects::default()
    });
    disk.keys = catalog.keys().map(|keys| Keys {
        taken: keys.taken,
        ms: keys.ms,
        edges: keys
            .edges
            .iter()
            .filter(|edge| allowed(&edge.from.0, schemas) && allowed(&edge.to.0, schemas))
            .cloned()
            .collect(),
    });
    disk
}

fn private_dir(dir: &PathBuf) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub(super) fn save(config: &McpConfig, connection: &McpConnection, catalog: &Catalog) {
    let Some(path) = path(connection) else {
        return;
    };
    let Some(key) = shared(config, connection) else {
        catalog.saved(None);
        return;
    };
    if catalog.key.as_ref().is_some_and(|own| *own != key) {
        return;
    }
    if catalog.columns.len() > MAX_COLUMNS {
        catalog.saved(None);
        return;
    }
    let disk = encode(catalog, connection.allowed_schemas(), key);
    let written = (|| -> Result<(), String> {
        let dir = path.parent().ok_or("Katalogordner fehlt")?;
        private_dir(&dir.to_path_buf()).map_err(|e| e.to_string())?;
        let file = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
        let mut writer = std::io::BufWriter::new(file);
        serde_json::to_writer(&mut writer, &disk).map_err(|e| e.to_string())?;
        let file = writer.into_inner().map_err(|e| e.to_string())?;
        file.persist(&path).map_err(|e| e.to_string())?;
        config::restrict(&path);
        Ok(())
    })();
    catalog.saved(if written.is_ok() {
        stamp(connection)
    } else {
        None
    });
    prune(&config::load());
}

pub(super) fn forget(connection: &McpConnection) {
    let Some(dir) = dir() else {
        return;
    };
    let prefix = format!("{}-", prefix(&connection.id));
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&prefix) && name.ends_with(".json") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

pub(super) fn forget_all() {
    let Some(dir) = dir() else {
        return;
    };
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if entry.file_name().to_string_lossy().ends_with(".json") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

pub(crate) fn prune(config: &McpConfig) {
    let Some(dir) = dir() else {
        return;
    };
    let keep: Vec<String> = if config.enabled {
        super::server::exposed(config)
            .map(|connection| prefix(&connection.id))
            .collect()
    } else {
        Vec::new()
    };
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".json") && !keep.iter().any(|prefix| name.starts_with(prefix.as_str())) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::catalog::{now, Kind, Relation};
    use crate::mcp::server::{cache_key, Server};
    use serde_json::json;
    use std::sync::Arc;

    fn call(
        server: &mut Server,
        config: &McpConfig,
        name: &str,
        args: serde_json::Value,
    ) -> (bool, String) {
        let reply = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(server.call_with_config(&json!({"name": name, "arguments": args}), config));
        (
            reply["isError"].as_bool().unwrap(),
            reply["content"][0]["text"].as_str().unwrap().to_string(),
        )
    }

    fn calls() -> usize {
        super::super::objects::CALLS.with(|calls| calls.get())
    }

    fn server() -> Server {
        Server {
            pool: crate::db::pool::create_pool_state(),
            columns: Default::default(),
        }
    }

    #[test]
    fn discovery_catalog_persists_privately_but_checks_always_reload_live() {
        let _guard = crate::mcp::TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let (dir, mut config, mut connection, _) = super::super::sandbox::sqlite_fixture(
            "CREATE TABLE orders(id INTEGER, note TEXT); INSERT INTO orders VALUES (1, 'geheimer-wert-4711');",
        );
        connection.id = "persist-a".into();
        config.connections = vec![connection.clone()];
        std::env::set_var("L8DB_MCP_CONFIG", dir.path().join("mcp.json"));
        config::save(&config).unwrap();
        let key = cache_key(&connection);
        let mut first = server();
        let (error, text) = call(&mut first, &config, "search", json!({"term": "orders"}));
        assert!(!error && text.contains("T main.orders"), "{text}");
        let file = path(&connection).unwrap();
        assert!(file.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |path: &std::path::Path| {
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777
            };
            assert_eq!(mode(&file), 0o600);
            assert_eq!(mode(file.parent().unwrap()), 0o700);
        }
        let stored = std::fs::read_to_string(&file).unwrap();
        assert!(stored.contains("\"version\":1") && stored.contains("orders"));
        assert!(!stored.contains("geheimer-wert-4711") && !stored.contains("fixture.db"));

        let mut second = server();
        let before = calls();
        let (_, text) = call(&mut second, &config, "search", json!({"term": "orders"}));
        assert!(text.contains("T main.orders"), "{text}");
        assert_eq!(
            calls(),
            before,
            "a persisted catalog must not query the database"
        );
        assert!(!second.columns[&key].live);

        rusqlite::Connection::open(dir.path().join("fixture.db"))
            .unwrap()
            .execute_batch("CREATE TABLE late(id INTEGER, api_key TEXT)")
            .unwrap();
        let (error, text) = call(
            &mut second,
            &config,
            "query",
            json!({"sql": "SELECT api_key AS k FROM late"}),
        );
        assert!(error && text.contains("redigiert"), "{text}");
        assert!(
            second.columns[&key].live,
            "checks must reload instead of using the persisted catalog"
        );

        let (error, text) = call(
            &mut first,
            &config,
            "execute",
            json!({"sql": "CREATE TABLE fresh(id INTEGER)", "confirm": true}),
        );
        assert!(!error, "{text}");
        assert!(
            !file.exists(),
            "DDL through MCP must delete the persisted catalog"
        );
        let (_, text) = call(&mut second, &config, "search", json!({"term": "fresh"}));
        assert!(
            text.contains("T main.fresh"),
            "another process must notice the deleted file: {text}"
        );
        assert!(file.exists());

        config.connections[0].redact_columns = vec!["note".into()];
        config::save(&config).unwrap();
        let mut third = server();
        let before = calls();
        call(&mut third, &config, "search", json!({"term": "orders"}));
        assert!(
            calls() > before,
            "changed masking rules must not reuse the old file"
        );

        config.connections[0].exposed = false;
        config::save(&config).unwrap();
        assert!(!file.exists(), "unexposed connections are cleaned up");
        std::env::remove_var("L8DB_MCP_CONFIG");
    }

    #[test]
    fn only_allowed_schemas_are_written() {
        let column = |schema: &str, table: &str| ColumnInfo {
            schema: schema.into(),
            table: table.into(),
            name: "id".into(),
            data_type: "int".into(),
        };
        let catalog = Catalog::new(Arc::new(vec![column("public", "a"), column("secret", "b")]));
        let relation = |schema: &str, name: &str| Relation {
            schema: schema.into(),
            name: name.into(),
            kind: Kind::Table,
            rows: Some(5),
            bytes: None,
            comment: None,
        };
        catalog.set_objects(
            Objects {
                taken: now(),
                relations: vec![relation("public", "a"), relation("secret", "b")],
                ..Objects::default()
            },
            true,
        );
        let disk = encode(&catalog, &["public".to_string()], "k".into());
        let text = serde_json::to_string(&disk).unwrap();
        assert_eq!(disk.schemas, ["public"]);
        assert_eq!(disk.objects.unwrap().relations.len(), 1);
        assert!(!text.contains("secret"));
    }
}
