use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use super::super::import::{self, Dialect};
use super::super::pool::PoolState;
use super::super::DatabaseAdapter;
use super::{execute, oracle_copy, replace_sql, Content, Endpoint, TransferPlan};

type Target = (String, String, String);
type Step = (String, String);

pub(super) const PREFIX: &str = "L8B$";

const ORACLE_KINDS: [&str; 10] = [
    "TABLE",
    "VIEW",
    "MATERIALIZED VIEW",
    "SEQUENCE",
    "SYNONYM",
    "FUNCTION",
    "PROCEDURE",
    "PACKAGE",
    "TYPE",
    "TRIGGER",
];

const ORACLE_CATALOG: [(&str, &str, u8); 11] = [
    ("type", "TYPE", 0),
    ("sequence", "SEQUENCE", 1),
    ("synonym", "SYNONYM", 2),
    ("function", "FUNCTION", 3),
    ("procedure", "PROCEDURE", 3),
    ("package", "PACKAGE", 3),
    ("view", "VIEW", 4),
    ("materialized_view", "MATERIALIZED VIEW", 5),
    ("type_body", "TYPE", 6),
    ("package_body", "PACKAGE", 6),
    ("trigger", "TRIGGER", 7),
];

const MYSQL_KINDS: [&str; 4] = ["TABLE", "VIEW", "FUNCTION", "PROCEDURE"];

const MYSQL_PRESENT: [&str; 3] = [
    "Duplicate foreign key constraint name",
    "Duplicate check constraint name",
    "Trigger already exists",
];

const ORACLE_GONE: [&str; 7] = [
    "ORA-04043",
    "ORA-00942",
    "ORA-04080",
    "ORA-02289",
    "ORA-01434",
    "ORA-12003",
    "ORA-12002",
];

pub(super) fn applies(dialect: Dialect, plan: &TransferPlan) -> bool {
    plan.replace
        && !plan.atomic
        && plan.content != Content::Data
        && matches!(
            dialect,
            Dialect::Oracle | Dialect::Clickhouse | Dialect::Mysql
        )
}

fn gone(dialect: Dialect) -> &'static [&'static str] {
    match dialect {
        Dialect::Oracle => &ORACLE_GONE,
        _ => &["UNKNOWN_TABLE"],
    }
}

fn schemas(targets: &[Target]) -> Vec<String> {
    let mut seen = Vec::new();
    for (_, schema, _) in targets {
        if !seen.contains(schema) {
            seen.push(schema.clone());
        }
    }
    seen
}

async fn pairs(adapter: &dyn DatabaseAdapter, sql: &str) -> Result<Vec<(String, String)>, String> {
    let result = adapter.execute_query(sql).await?;
    Ok(result
        .rows
        .iter()
        .filter_map(|row| {
            let text = |key: &str| row.get(key).and_then(super::super::export::value_text);
            Some((text("T")?, text("N")?))
        })
        .collect())
}

pub(super) async fn blockers(
    adapter: &dyn DatabaseAdapter,
    dialect: Dialect,
    targets: &[Target],
) -> Result<Vec<String>, String> {
    if dialect == Dialect::Clickhouse {
        let mut found = Vec::new();
        for schema in schemas(targets) {
            let engines = pairs(
                adapter,
                &format!(
                    "SELECT name AS `T`, engine AS `N` FROM system.tables WHERE database = {} \
                     AND (engine IN ('MaterializedView', 'LiveView', 'Dictionary') OR engine LIKE 'Replicated%')",
                    dialect.text_literal(&schema)
                ),
            )
            .await?;
            for (name, engine) in engines {
                let view = engine.ends_with("View");
                if view || targets.iter().any(|(_, s, n)| *s == schema && *n == name) {
                    found.push(format!("{engine} {schema}.{name}"));
                }
            }
        }
        return Ok(found);
    }
    if dialect == Dialect::Mysql {
        let mut found: Vec<String> = targets
            .iter()
            .filter(|(kind, _, _)| !MYSQL_KINDS.contains(&kind.as_str()))
            .map(|(kind, schema, name)| format!("{kind} {schema}.{name}"))
            .collect();
        let version = adapter.execute_query("SELECT VERSION() AS `T`").await?;
        let version = version
            .rows
            .first()
            .and_then(|row| row.get("T"))
            .and_then(super::super::export::value_text)
            .unwrap_or_default();
        if version.to_ascii_lowercase().contains("mariadb") {
            found.push(format!("MariaDB {version}"));
        }
        return Ok(found);
    }
    if dialect != Dialect::Oracle {
        return Ok(Vec::new());
    }
    let mut found: Vec<String> = targets
        .iter()
        .filter(|(kind, _, _)| !ORACLE_KINDS.contains(&kind.as_str()))
        .map(|(kind, schema, name)| format!("{kind} {schema}.{name}"))
        .collect();
    let has = |kind: &str, schema: &str, name: &str| {
        targets
            .iter()
            .any(|(k, s, n)| k == kind && s == schema && n == name)
    };
    for schema in schemas(targets) {
        let owner = super::super::quote_literal(&schema);
        let nested = pairs(
            adapter,
            &format!(
                "SELECT parent_table_name AS t, table_name AS n FROM all_nested_tables WHERE owner = {owner}"
            ),
        )
        .await?;
        for (table, storage) in nested {
            if has("TABLE", &schema, &table) {
                found.push(format!("Nested Table {schema}.{table} ({storage})"));
            }
        }
        if !targets.iter().any(|(k, s, _)| k == "TYPE" && *s == schema) {
            continue;
        }
        let columns = pairs(
            adapter,
            &format!(
                "SELECT table_name || '.' || column_name AS t, table_name || '/' || data_type AS n FROM all_tab_cols \
                 WHERE owner = {owner} AND data_type_owner = {owner}"
            ),
        )
        .await?;
        for (column, usage) in columns {
            let Some((table, data_type)) = usage.split_once('/') else {
                continue;
            };
            if !table.starts_with(PREFIX) && has("TYPE", &schema, data_type) {
                found.push(format!("Spalte {schema}.{column} (Typ {data_type})"));
            }
        }
    }
    Ok(found)
}

async fn rounds(
    adapter: &dyn DatabaseAdapter,
    dialect: Dialect,
    steps: &[Step],
    tolerated: &[&str],
) -> Vec<String> {
    let mut left: Vec<&Step> = steps.iter().collect();
    let mut errors = Vec::new();
    while !left.is_empty() {
        errors.clear();
        let mut failed = Vec::new();
        for step in &left {
            match execute(adapter, dialect, &step.1).await {
                Err(error) if !tolerated.iter().any(|code| error.contains(code)) => {
                    errors.push(format!("{}: {error}", step.0));
                    failed.push(*step);
                }
                _ => {}
            }
        }
        if failed.len() == left.len() {
            break;
        }
        left = failed;
    }
    if left.is_empty() {
        Vec::new()
    } else {
        errors
    }
}

struct Move {
    label: String,
    apply: String,
    undo: String,
}

pub(super) struct Backup {
    dialect: Dialect,
    prefix: String,
    drops: Vec<Step>,
    moves: Vec<Move>,
    moved: usize,
    keys: Vec<Step>,
    recreate: Vec<Step>,
    grants: Vec<Step>,
    target: Endpoint,
    pool: PoolState,
    tables: Vec<Target>,
    schemas: Vec<String>,
    file: Option<PathBuf>,
}

fn run_id() -> String {
    const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut value = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default()
        / 1000;
    (0..7)
        .map(|_| {
            let digit = DIGITS[(value % 36) as usize] as char;
            value /= 36;
            digit
        })
        .collect()
}

impl Backup {
    pub(super) async fn prepare(
        adapter: &dyn DatabaseAdapter,
        dialect: Dialect,
        targets: &[Target],
        target: &Endpoint,
        pool: &PoolState,
    ) -> Result<Self, String> {
        let mut backup = Self {
            dialect,
            prefix: format!("{PREFIX}{}$", run_id()),
            drops: Vec::new(),
            moves: Vec::new(),
            moved: 0,
            keys: Vec::new(),
            recreate: Vec::new(),
            grants: Vec::new(),
            target: target.clone(),
            pool: pool.clone(),
            tables: Vec::new(),
            schemas: schemas(targets),
            file: None,
        };
        let read = match dialect {
            Dialect::Oracle => backup.oracle(adapter, targets).await,
            Dialect::Mysql => backup.mysql(adapter, targets).await,
            _ => {
                backup.renames(targets, &["TABLE", "VIEW"]);
                Ok(())
            }
        };
        read.map_err(|error| {
            format!("Sicherung nicht möglich, das Ziel wurde nicht verändert: {error}")
        })?;
        Ok(backup)
    }

    fn renames(&mut self, targets: &[Target], kinds: &[&str]) {
        let d = self.dialect;
        for (kind, schema, name) in targets {
            if !kinds.contains(&kind.as_str()) {
                continue;
            }
            let aside = format!("{}{}", self.prefix, self.moves.len() + 1);
            let (from, to) = (d.target(schema, name), d.target(schema, &aside));
            self.moves.push(Move {
                label: format!("{kind} {schema}.{aside} (vorher {name})"),
                apply: format!("RENAME TABLE {from} TO {to}"),
                undo: format!("RENAME TABLE {to} TO {from}"),
            });
            self.tables.push((schema.clone(), aside, name.clone()));
        }
    }

    async fn mysql(
        &mut self,
        adapter: &dyn DatabaseAdapter,
        targets: &[Target],
    ) -> Result<(), String> {
        let d = Dialect::Mysql;
        let types = ["constraint", "trigger", "view", "function", "procedure"].map(String::from);
        for schema in self.schemas.clone() {
            let has = |kind: &str, name: &str| {
                targets
                    .iter()
                    .any(|(k, s, n)| k == kind && *s == schema && n == name)
            };
            let catalog = adapter.schema_catalog(&schema, &types).await?;
            let mut covered: HashSet<(String, String)> = HashSet::new();
            for object in &catalog {
                let label = format!("{} {schema}.{}", object.object_type, object.name);
                let parent = object.parent.as_deref().unwrap_or_default();
                let on = d.target(&schema, parent);
                let name = d.quote(&object.name);
                let attribute = |key: &str| object.attributes.get(key).map(String::as_str);
                match object.object_type.as_str() {
                    "constraint" if has("TABLE", parent) && attribute("generated").is_none() => {
                        match attribute("kind") {
                            Some("R") => {
                                self.drops.push((
                                    label.clone(),
                                    format!("ALTER TABLE {on} DROP FOREIGN KEY {name}"),
                                ));
                                self.keys.push((label, object.ddl.clone()));
                            }
                            Some("C") => {
                                self.drops.push((
                                    label.clone(),
                                    format!("ALTER TABLE {on} DROP CHECK {name}"),
                                ));
                                self.recreate.push((label, object.ddl.clone()));
                            }
                            _ => {}
                        }
                    }
                    "trigger" if has("TABLE", parent) => {
                        self.drops.push((
                            label.clone(),
                            format!("DROP TRIGGER IF EXISTS {}", d.target(&schema, &object.name)),
                        ));
                        self.recreate.push((label, object.ddl.clone()));
                    }
                    "view" | "function" | "procedure" => {
                        let kind = object.object_type.to_ascii_uppercase();
                        if !has(&kind, &object.name) || object.ddl.trim().is_empty() {
                            continue;
                        }
                        let target = (kind.clone(), schema.clone(), object.name.clone());
                        for sql in replace_sql(d, false, std::slice::from_ref(&target)) {
                            self.drops.push((label.clone(), sql));
                        }
                        self.recreate.push((label, object.ddl.clone()));
                        covered.insert((kind, object.name.clone()));
                    }
                    _ => {}
                }
            }
            let missing: Vec<String> = targets
                .iter()
                .filter(|(kind, s, name)| {
                    kind != "TABLE"
                        && *s == schema
                        && !covered.contains(&(kind.clone(), name.clone()))
                })
                .map(|(kind, _, name)| format!("{kind} {schema}.{name}"))
                .collect();
            if !missing.is_empty() {
                return Err(format!(
                    "Die Definition dieser Objekte ist nicht lesbar: {}",
                    missing.join(", ")
                ));
            }
        }
        self.renames(targets, &["TABLE"]);
        Ok(())
    }

    async fn unchecked(&self, steps: &[Step], tolerated: &[&str]) -> Result<Vec<String>, String> {
        let mut session = import::open_session(
            self.target.kind,
            &self.target.connection_string,
            self.target.database.as_deref(),
            self.pool.clone(),
        )
        .await?;
        session.execute("SET FOREIGN_KEY_CHECKS = 0").await?;
        let mut errors = Vec::new();
        for (label, sql) in steps {
            match session.execute(sql).await {
                Err(error) if !tolerated.iter().any(|known| error.contains(known)) => {
                    errors.push(format!("{label}: {error}"));
                }
                _ => {}
            }
        }
        session.execute("SET FOREIGN_KEY_CHECKS = 1").await?;
        session.commit().await?;
        Ok(errors)
    }

    async fn oracle(
        &mut self,
        adapter: &dyn DatabaseAdapter,
        targets: &[Target],
    ) -> Result<(), String> {
        let d = Dialect::Oracle;
        for schema in self.schemas.clone() {
            let owner = super::super::quote_literal(&schema);
            let tables: Vec<&str> = targets
                .iter()
                .filter(|(kind, s, _)| kind == "TABLE" && *s == schema)
                .map(|(_, _, name)| name.as_str())
                .collect();
            let mut others: Vec<(String, String)> = targets
                .iter()
                .filter(|(kind, s, _)| kind != "TABLE" && *s == schema)
                .map(|(kind, _, name)| (kind.clone(), name.clone()))
                .collect();
            let mut logs = Vec::new();
            if !tables.is_empty() {
                let known: HashSet<&str> = tables.iter().copied().collect();
                let mut parts: HashMap<String, Vec<Move>> = HashMap::new();
                let triggers = pairs(
                    adapter,
                    &format!(
                        "SELECT table_name AS t, trigger_name AS n FROM all_triggers \
                         WHERE owner = {owner} AND table_owner = {owner} AND base_object_type = 'TABLE'"
                    ),
                )
                .await?;
                for (table, name) in triggers {
                    let trigger = ("TRIGGER".to_string(), name);
                    if known.contains(table.as_str()) && !others.contains(&trigger) {
                        others.push(trigger);
                    }
                }
                for (master, sql, _) in super::oracle_mview_logs(adapter, &schema, &schema).await? {
                    if !known.contains(master.as_str()) {
                        continue;
                    }
                    let label = format!("MATERIALIZED VIEW LOG {schema}.{master}");
                    self.drops.push((
                        label.clone(),
                        format!(
                            "DROP MATERIALIZED VIEW LOG ON {}",
                            d.target(&schema, &master)
                        ),
                    ));
                    logs.push((label, sql));
                }
                let constraints = pairs(
                    adapter,
                    &format!(
                        "SELECT table_name AS t, constraint_name AS n FROM all_constraints \
                         WHERE owner = {owner} AND generated = 'USER NAME' AND constraint_type IN ('P', 'U', 'R', 'C') \
                         ORDER BY table_name, constraint_name"
                    ),
                )
                .await?;
                let indexes = pairs(
                    adapter,
                    &format!(
                        "SELECT table_name AS t, index_name AS n FROM all_indexes \
                         WHERE owner = {owner} AND table_owner = {owner} AND generated = 'N' AND index_type <> 'LOB' \
                         ORDER BY table_name, index_name"
                    ),
                )
                .await?;
                let mut count = self.moves.len();
                let mut fresh = || {
                    count += 1;
                    format!("{}{count}", self.prefix)
                };
                for (table, name) in constraints {
                    if !known.contains(table.as_str()) {
                        continue;
                    }
                    let (aside, on) = (fresh(), d.target(&schema, &table));
                    parts.entry(table).or_default().push(Move {
                        label: format!("CONSTRAINT {schema}.{aside} (vorher {name})"),
                        apply: format!(
                            "ALTER TABLE {on} RENAME CONSTRAINT {} TO {}",
                            d.quote(&name),
                            d.quote(&aside)
                        ),
                        undo: format!(
                            "ALTER TABLE {on} RENAME CONSTRAINT {} TO {}",
                            d.quote(&aside),
                            d.quote(&name)
                        ),
                    });
                }
                for (table, name) in indexes {
                    if !known.contains(table.as_str()) {
                        continue;
                    }
                    let aside = fresh();
                    parts.entry(table).or_default().push(Move {
                        label: format!("INDEX {schema}.{aside} (vorher {name})"),
                        apply: format!(
                            "ALTER INDEX {} RENAME TO {}",
                            d.target(&schema, &name),
                            d.quote(&aside)
                        ),
                        undo: format!(
                            "ALTER INDEX {} RENAME TO {}",
                            d.target(&schema, &aside),
                            d.quote(&name)
                        ),
                    });
                }
                for table in &tables {
                    self.moves.extend(parts.remove(*table).unwrap_or_default());
                    let aside = fresh();
                    self.moves.push(Move {
                        label: format!("TABLE {schema}.{aside} (vorher {table})"),
                        apply: format!(
                            "ALTER TABLE {} RENAME TO {}",
                            d.target(&schema, table),
                            d.quote(&aside)
                        ),
                        undo: format!(
                            "ALTER TABLE {} RENAME TO {}",
                            d.target(&schema, &aside),
                            d.quote(table)
                        ),
                    });
                    self.tables.push((schema.clone(), aside, table.to_string()));
                }
            }
            self.recreate.extend(logs);
            if others.is_empty() {
                continue;
            }
            let types: Vec<String> = ORACLE_CATALOG
                .iter()
                .map(|(kind, _, _)| kind.to_string())
                .chain(["grant".to_string()])
                .collect();
            let catalog = adapter.schema_catalog(&schema, &types).await?;
            let mut covered: HashSet<(String, String)> = HashSet::new();
            let mut saved: Vec<(u8, Step)> = Vec::new();
            for object in &catalog {
                let Some((_, kind, rank)) = ORACLE_CATALOG
                    .iter()
                    .find(|(catalog_kind, _, _)| *catalog_kind == object.object_type)
                else {
                    continue;
                };
                let key = (kind.to_string(), object.name.clone());
                if !others.contains(&key) || object.ddl.trim().is_empty() {
                    continue;
                }
                let label = format!("{} {schema}.{}", object.object_type, object.name);
                saved.push((*rank, (label.clone(), object.ddl.clone())));
                if object.object_type == "trigger"
                    && object.attributes.get("status").map(String::as_str) == Some("DISABLED")
                {
                    saved.push((
                        8,
                        (
                            label,
                            format!("ALTER TRIGGER {} DISABLE", d.target(&schema, &object.name)),
                        ),
                    ));
                }
                if !object.object_type.ends_with("_body") {
                    covered.insert(key);
                }
            }
            let missing: Vec<String> = others
                .iter()
                .filter(|key| !covered.contains(*key))
                .filter(|(_, name)| !name.starts_with("SYS_PLSQL_") && !name.starts_with("SYSTP"))
                .map(|(kind, name)| format!("{kind} {schema}.{name}"))
                .collect();
            if !missing.is_empty() {
                return Err(format!(
                    "Die Definition dieser Objekte ist nicht lesbar: {}",
                    missing.join(", ")
                ));
            }
            saved.sort_by_key(|(rank, _)| *rank);
            self.recreate
                .extend(saved.into_iter().map(|(_, step)| step));
            for object in catalog.iter().filter(|o| o.object_type == "grant") {
                let Some(parent) = &object.parent else {
                    continue;
                };
                if others
                    .iter()
                    .any(|(kind, name)| kind != "TRIGGER" && name == parent)
                {
                    self.grants.push((
                        format!("GRANT {schema}.{parent} {}", object.name),
                        object.ddl.clone(),
                    ));
                }
            }
            for (kind, name) in &others {
                self.drops.push((
                    format!("{kind} {schema}.{name}"),
                    oracle_copy::drop_statement(&schema, kind, name),
                ));
            }
        }
        Ok(())
    }

    fn script(&self) -> String {
        let mut text = format!(
            "-- l8db Transfer-Sicherung {}\n-- Stellt den Stand vor dem Überschreiben wieder her.\n-- Vorher die neu angelegten Objekte gleichen Namens entfernen.\n\n",
            self.prefix
        );
        let undo = self.moves.iter().rev().map(|step| step.undo.as_str());
        let recreate = self
            .keys
            .iter()
            .chain(&self.recreate)
            .map(|step| step.1.as_str());
        let grants = self.grants.iter().map(|step| step.1.as_str());
        let end = match self.dialect {
            Dialect::Oracle => "\n/\n\n",
            Dialect::Mysql => "\n$$\n\n",
            _ => ";\n\n",
        };
        if self.dialect == Dialect::Mysql {
            text.push_str("DELIMITER $$\n\n");
        }
        for sql in undo.chain(recreate).chain(grants) {
            text.push_str(sql.trim_end());
            text.push_str(end);
        }
        text
    }

    fn write(&mut self) -> Result<(), String> {
        let dir = crate::issues::log_dir().unwrap_or_else(std::env::temp_dir);
        let name: String = self
            .prefix
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .collect();
        let file = dir.join(format!("transfer-sicherung-{name}.sql"));
        std::fs::write(&file, self.script())
            .map_err(|error| format!("{}: {error}", file.display()))?;
        self.file = Some(file);
        Ok(())
    }

    pub(super) async fn set_aside(
        &mut self,
        adapter: &dyn DatabaseAdapter,
    ) -> Result<Vec<String>, String> {
        let d = self.dialect;
        self.write().map_err(|error| {
            format!("Sicherung nicht möglich, das Ziel wurde nicht verändert: {error}")
        })?;
        let warnings = rounds(adapter, d, &self.drops, gone(d))
            .await
            .into_iter()
            .map(|error| format!("Im Ziel nicht gelöscht: {error}"))
            .collect();
        for index in 0..self.moves.len() {
            let step = &self.moves[index];
            let Err(error) = execute(adapter, d, &step.apply).await else {
                self.moved = index + 1;
                continue;
            };
            let failure = format!("{}: {error}", step.label);
            let leftovers = self.restore(adapter, &[]).await;
            return Err(if leftovers.is_empty() {
                format!("Sicherung nicht möglich, das Ziel wurde wiederhergestellt. {failure}")
            } else {
                format!(
                    "Sicherung nicht möglich. {failure}\n\nNicht wiederhergestellt:\n{}",
                    leftovers.join("\n")
                )
            });
        }
        Ok(warnings)
    }

    pub(super) async fn restore(
        &mut self,
        adapter: &dyn DatabaseAdapter,
        created: &[Target],
    ) -> Vec<String> {
        let d = self.dialect;
        let drops: Vec<Step> = created
            .iter()
            .filter(|(_, _, name)| !name.starts_with(&self.prefix))
            .flat_map(|target| {
                let label = format!("{} {}.{}", target.0, target.1, target.2);
                replace_sql(d, false, std::slice::from_ref(target))
                    .into_iter()
                    .map(move |sql| (label.clone(), sql))
            })
            .collect();
        let mut leftovers: Vec<String> = self
            .drop_all(adapter, &drops)
            .await
            .into_iter()
            .map(|error| format!("Neu angelegt, nicht entfernt: {error}"))
            .collect();
        for step in self.moves[..self.moved].iter().rev() {
            if let Err(error) = execute(adapter, d, &step.undo).await {
                leftovers.push(format!("Nicht zurückbenannt: {}: {error}", step.label));
            }
        }
        if !self.keys.is_empty() {
            match self.unchecked(&self.keys, &MYSQL_PRESENT).await {
                Ok(errors) => leftovers.extend(
                    errors
                        .into_iter()
                        .map(|error| format!("Nicht wiederhergestellt: {error}")),
                ),
                Err(error) => {
                    leftovers.push(format!("Fremdschlüssel nicht wiederhergestellt: {error}"))
                }
            }
        }
        let present: &[&str] = if d == Dialect::Mysql {
            &MYSQL_PRESENT
        } else {
            &["ORA-24344"]
        };
        leftovers.extend(
            rounds(adapter, d, &self.recreate, present)
                .await
                .into_iter()
                .map(|error| format!("Nicht wiederhergestellt: {error}")),
        );
        leftovers.extend(
            rounds(adapter, d, &self.grants, &[])
                .await
                .into_iter()
                .map(|error| format!("Recht nicht wiederhergestellt: {error}")),
        );
        for schema in self.schemas.iter().filter(|_| d == Dialect::Oracle) {
            let disabled = pairs(
                adapter,
                &format!(
                    "SELECT table_name AS t, index_name AS n FROM all_indexes WHERE owner = {} AND funcidx_status = 'DISABLED'",
                    super::super::quote_literal(schema)
                ),
            )
            .await
            .unwrap_or_default();
            for (table, index) in disabled {
                let enable = format!("ALTER INDEX {} ENABLE", d.target(schema, &index));
                if let Err(error) = execute(adapter, d, &enable).await {
                    leftovers.push(format!(
                        "Index {schema}.{index} auf {table} nicht aktiviert: {error}"
                    ));
                }
            }
            let _ = adapter
                .execute_script(&format!(
                    "BEGIN DBMS_UTILITY.COMPILE_SCHEMA({}, FALSE); END;",
                    super::super::quote_literal(schema)
                ))
                .await;
        }
        self.finish(leftovers)
    }

    async fn drop_all(&self, adapter: &dyn DatabaseAdapter, drops: &[Step]) -> Vec<String> {
        if self.dialect != Dialect::Mysql || drops.is_empty() {
            return rounds(adapter, self.dialect, drops, gone(self.dialect)).await;
        }
        match self.unchecked(drops, &[]).await {
            Ok(errors) => errors,
            Err(error) => vec![error],
        }
    }

    pub(super) fn abandon(&mut self, error: &str) -> Vec<String> {
        let mut leftovers = vec![format!(
            "Der alte Stand wurde nicht wiederhergestellt, weil das Ziel nicht lesbar ist: {error}"
        )];
        leftovers.extend(self.tables.iter().map(|(schema, aside, name)| {
            format!("Sicherung vorhanden: {schema}.{aside} (vorher {name})")
        }));
        self.finish(leftovers)
    }

    fn finish(&mut self, mut leftovers: Vec<String>) -> Vec<String> {
        if let Some(file) = &self.file {
            if leftovers.is_empty() {
                let _ = std::fs::remove_file(file);
            } else {
                leftovers.push(format!("Wiederherstellungsskript: {}", file.display()));
            }
        }
        leftovers
    }

    pub(super) async fn discard(&mut self, adapter: &dyn DatabaseAdapter) -> Vec<String> {
        let d = self.dialect;
        let drops: Vec<Step> = self
            .tables
            .iter()
            .flat_map(|(schema, aside, original)| {
                let target = ("TABLE".to_string(), schema.clone(), aside.clone());
                let label = format!("{schema}.{aside} (vorher {original})");
                replace_sql(d, false, std::slice::from_ref(&target))
                    .into_iter()
                    .map(move |sql| (label.clone(), sql))
            })
            .collect();
        let warnings: Vec<String> = self
            .drop_all(adapter, &drops)
            .await
            .into_iter()
            .map(|error| format!("Sicherung nicht entfernt: {error}"))
            .collect();
        if let Some(file) = &self.file {
            if warnings.is_empty() {
                let _ = std::fs::remove_file(file);
            }
        }
        warnings
    }
}
