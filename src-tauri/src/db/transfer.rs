use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::import::{self, BatchWriter, Dialect, ImportPlan, TypeClass};
use super::pool::PoolState;
use super::provider::DatabaseKind;
use super::table_copy::{self, Canonical};
use super::{DatabaseAdapter, DetailedColumnInfo, ImportColumnInfo, TxSession};

const READ_PAGE: usize = 5000;
const CURSOR: &str = "l8db_transfer";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub kind: DatabaseKind,
    pub connection_string: String,
    pub database: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaPair {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRequest {
    pub source: Endpoint,
    pub schemas: Vec<SchemaPair>,
    #[serde(default = "enabled")]
    pub fold_names: bool,
}

fn enabled() -> bool {
    true
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub object_type: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

impl Statement {
    fn plain(sql: impl Into<String>) -> Self {
        Self {
            sql: sql.into(),
            ..Default::default()
        }
    }

    fn object(sql: impl Into<String>, object_type: &str, schema: &str, name: &str) -> Self {
        Self {
            sql: sql.into(),
            object_type: Some(object_type.into()),
            schema: Some(schema.into()),
            name: Some(name.into()),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransferColumn {
    pub source: String,
    pub target: String,
    pub source_type: String,
    pub target_type: String,
    pub identity: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransferTable {
    pub source_schema: String,
    pub source_name: String,
    pub target_schema: String,
    pub target_name: String,
    pub columns: Vec<TransferColumn>,
    pub key: Vec<String>,
    pub only: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SequenceMap {
    pub source_schema: String,
    pub source_name: String,
    pub target_schema: String,
    pub target_name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManualObject {
    pub object_type: String,
    pub schema: String,
    pub name: String,
    pub reason: String,
    pub ddl: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPlan {
    pub native: bool,
    pub atomic: bool,
    pub schemas: Vec<SchemaPair>,
    pub create_schemas: Vec<String>,
    pub tables: Vec<TransferTable>,
    pub pre_data: Vec<Statement>,
    pub before_load: Vec<Statement>,
    pub post_data: Vec<Statement>,
    pub finalize: Vec<Statement>,
    pub sequences: Vec<SequenceMap>,
    pub manual: Vec<ManualObject>,
    pub warnings: Vec<String>,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub source: Endpoint,
    pub plan: TransferPlan,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableResult {
    pub schema: String,
    pub name: String,
    pub rows: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOutcome {
    pub tables: Vec<TableResult>,
    pub rows: u64,
    pub atomic: bool,
    pub committed: bool,
    pub rolled_back: bool,
    pub leftovers: Vec<String>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: &'static str,
    pub table: Option<String>,
    pub table_index: usize,
    pub tables: usize,
    pub rows: u64,
    pub total_rows: u64,
}

fn adapter(endpoint: &Endpoint, pool: &PoolState) -> Result<Box<dyn DatabaseAdapter>, String> {
    super::create_adapter_from_string(
        endpoint.kind,
        &endpoint.connection_string,
        endpoint.database.as_deref(),
        pool.clone(),
    )
}

fn dialect(kind: DatabaseKind) -> Result<Dialect, String> {
    Dialect::from_kind(kind).ok_or_else(|| "Transfer unterstützt diesen Datenbanktyp nicht.".into())
}

pub fn atomic(dialect: Dialect) -> bool {
    matches!(
        dialect,
        Dialect::Postgres | Dialect::Mssql | Dialect::Sqlite | Dialect::Duckdb
    )
}

pub fn native_family(source: DatabaseKind, target: DatabaseKind) -> bool {
    source == target
        && matches!(
            source,
            DatabaseKind::Postgres
                | DatabaseKind::Mysql
                | DatabaseKind::Mssql
                | DatabaseKind::Oracle
                | DatabaseKind::Sqlite
        )
}

fn ensure_writable(target: &Endpoint) -> Result<(), String> {
    if target.kind == DatabaseKind::Postgres
        && super::connection::connection_string_is_read_only(&target.connection_string)
    {
        return Err("Lesemodus: Die Zielverbindung ist schreibgeschützt.".into());
    }
    Ok(())
}

fn simple_identifier(name: &str) -> bool {
    name.chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn fold(target: Dialect, name: &str, enabled: bool) -> String {
    if !enabled || !simple_identifier(name) {
        return name.to_string();
    }
    match target {
        Dialect::Oracle => name.to_ascii_uppercase(),
        Dialect::Postgres => name.to_ascii_lowercase(),
        _ => name.to_string(),
    }
}

fn name_limit(target: Dialect) -> Option<usize> {
    match target {
        Dialect::Postgres => Some(63),
        Dialect::Mysql => Some(64),
        Dialect::Mssql | Dialect::Oracle => Some(128),
        _ => None,
    }
}

fn case_insensitive(target: Dialect) -> bool {
    !matches!(target, Dialect::Postgres | Dialect::Oracle)
}

fn truncate(text: &str, bytes: usize) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if out.len() + c.len_utf8() > bytes {
            break;
        }
        out.push(c);
    }
    out
}

struct Names {
    used: HashSet<String>,
    limit: usize,
}

impl Names {
    fn new(target: Dialect) -> Self {
        Self {
            used: HashSet::new(),
            limit: name_limit(target).unwrap_or(128),
        }
    }

    fn take(&mut self, stem: &str) -> String {
        let base = truncate(stem, self.limit);
        let mut candidate = base.clone();
        let mut number = 2;
        while !self.used.insert(candidate.to_ascii_lowercase()) {
            let suffix = format!("_{number}");
            candidate = format!(
                "{}{suffix}",
                truncate(&base, self.limit.saturating_sub(suffix.len()))
            );
            number += 1;
        }
        candidate
    }
}

#[derive(Debug, Clone, PartialEq)]
struct ForeignKey {
    name: String,
    columns: Vec<String>,
    ref_schema: String,
    ref_table: String,
    ref_columns: Vec<String>,
    on_delete: Option<String>,
    on_update: Option<String>,
}

struct SourceTable {
    pair: SchemaPair,
    name: String,
    columns: Vec<DetailedColumnInfo>,
    identity: HashSet<String>,
    generated: HashSet<String>,
    primary_key: Vec<String>,
    indexes: Vec<super::IndexInfo>,
    constraints: Vec<super::ConstraintInfo>,
    foreign_keys: Vec<ForeignKey>,
    partitioned: bool,
}

fn group_foreign_keys(
    rows: Vec<super::ForeignKeyInfo>,
    actions: &HashMap<String, String>,
) -> Vec<ForeignKey> {
    let mut out: Vec<ForeignKey> = Vec::new();
    for row in rows {
        match out.iter_mut().find(|fk| {
            fk.name == row.constraint_name
                && fk.ref_table == row.to_table
                && fk.ref_schema == row.to_schema
        }) {
            Some(fk) => {
                fk.columns.push(row.from_column);
                fk.ref_columns.push(row.to_column);
            }
            None => {
                let definition = actions
                    .get(&row.constraint_name)
                    .map(|d| d.to_ascii_uppercase())
                    .unwrap_or_default();
                out.push(ForeignKey {
                    on_delete: referential_action(&definition, "ON DELETE"),
                    on_update: referential_action(&definition, "ON UPDATE"),
                    name: row.constraint_name,
                    columns: vec![row.from_column],
                    ref_schema: row.to_schema,
                    ref_table: row.to_table,
                    ref_columns: vec![row.to_column],
                });
            }
        }
    }
    out
}

fn with_catalog_checks(
    mut constraints: Vec<super::ConstraintInfo>,
    catalog: &HashMap<String, String>,
) -> Vec<super::ConstraintInfo> {
    for (name, definition) in catalog {
        if definition
            .trim_start()
            .to_ascii_uppercase()
            .starts_with("CHECK")
            && !constraints.iter().any(|c| {
                c.constraint_type == "CHECK" && (&c.name == name || &c.definition == definition)
            })
        {
            constraints.push(super::ConstraintInfo {
                name: name.clone(),
                constraint_type: "CHECK".into(),
                columns: Vec::new(),
                definition: definition.clone(),
            });
        }
    }
    constraints
}

fn referential_action(definition: &str, clause: &str) -> Option<String> {
    let rest = definition.split_once(clause)?.1.trim_start();
    [
        "SET NULL",
        "SET DEFAULT",
        "CASCADE",
        "RESTRICT",
        "NO ACTION",
    ]
    .into_iter()
    .find(|action| rest.starts_with(action))
    .filter(|action| *action != "NO ACTION")
    .map(str::to_string)
}

fn load_order(tables: &[SourceTable]) -> Vec<usize> {
    let index: HashMap<(&str, &str), usize> = tables
        .iter()
        .enumerate()
        .map(|(i, t)| ((t.pair.source.as_str(), t.name.as_str()), i))
        .collect();
    let parents: Vec<HashSet<usize>> = tables
        .iter()
        .enumerate()
        .map(|(i, t)| {
            t.foreign_keys
                .iter()
                .filter_map(|fk| index.get(&(fk.ref_schema.as_str(), fk.ref_table.as_str())))
                .copied()
                .filter(|parent| *parent != i)
                .collect()
        })
        .collect();
    let mut placed = vec![false; tables.len()];
    let mut order = Vec::with_capacity(tables.len());
    while order.len() < tables.len() {
        let next = (0..tables.len())
            .find(|i| !placed[*i] && parents[*i].iter().all(|p| placed[*p]))
            .or_else(|| (0..tables.len()).find(|i| !placed[*i]))
            .unwrap_or_default();
        placed[next] = true;
        order.push(next);
    }
    order
}

fn integerish(canonical: Canonical) -> bool {
    matches!(
        canonical,
        Canonical::SmallInt
            | Canonical::Int
            | Canonical::BigInt
            | Canonical::Decimal(None)
            | Canonical::Decimal(Some((_, 0)))
    )
}

fn identity_canonical(canonical: Canonical) -> Canonical {
    match canonical {
        Canonical::Decimal(_) => Canonical::BigInt,
        other => other,
    }
}

async fn partition_info(
    source: &dyn DatabaseAdapter,
    schema: &str,
) -> (HashSet<String>, HashSet<String>) {
    let sql = format!(
        "SELECT c.relname AS child, p.relname AS parent FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = {} AND p.relkind = 'p'",
        super::quote_literal(schema)
    );
    let mut children = HashSet::new();
    let mut parents = HashSet::new();
    if let Ok(result) = source.execute_query(&sql).await {
        for row in &result.rows {
            if let Some(child) = row.get("child").and_then(super::export::value_text) {
                children.insert(child);
            }
            if let Some(parent) = row.get("parent").and_then(super::export::value_text) {
                parents.insert(parent);
            }
        }
    }
    (children, parents)
}

async fn owned_sequences(source: &dyn DatabaseAdapter, schema: &str) -> HashSet<String> {
    let sql = format!(
        "SELECT s.relname AS name FROM pg_depend d JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S' JOIN pg_namespace n ON n.oid = s.relnamespace WHERE d.deptype IN ('a', 'i') AND d.refobjsubid > 0 AND n.nspname = {}",
        super::quote_literal(schema)
    );
    source
        .execute_query(&sql)
        .await
        .map(|result| {
            result
                .rows
                .iter()
                .filter_map(|row| row.get("name").and_then(super::export::value_text))
                .collect()
        })
        .unwrap_or_default()
}

async fn read_tables(
    source: &dyn DatabaseAdapter,
    source_kind: DatabaseKind,
    pair: &SchemaPair,
    native: bool,
) -> Result<Vec<SourceTable>, String> {
    let source_dialect = dialect(source_kind)?;
    let (children, parents) = if source_kind == DatabaseKind::Postgres && !native {
        partition_info(source, &pair.source).await
    } else {
        Default::default()
    };
    let actions: HashMap<(String, String), String> = if native {
        HashMap::new()
    } else {
        source
            .schema_catalog(&pair.source, &["constraint".to_string()])
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|object| {
                let definition = object.attributes.get("definition").cloned()?;
                Some(((object.parent.unwrap_or_default(), object.name), definition))
            })
            .collect()
    };
    let mut out = Vec::new();
    for info in source.list_tables(Some(&pair.source)).await? {
        if children.contains(&info.name) {
            continue;
        }
        let columns: Vec<DetailedColumnInfo> = source
            .list_table_columns_detailed(&pair.source, &info.name)
            .await?
            .into_iter()
            .filter(|column| column.name != "__ctid__")
            .collect();
        if columns.is_empty() {
            continue;
        }
        let details = import::list_import_columns(source_dialect, source, &pair.source, &info.name)
            .await
            .unwrap_or_default();
        let primary_key = table_copy::primary_key(source, &pair.source, &info.name, &columns).await;
        let flagged = |name: &str, pick: fn(&ImportColumnInfo) -> bool| {
            details.iter().any(|d| d.name == name && pick(d))
        };
        let identity = columns
            .iter()
            .filter(|column| {
                let auto = if source_kind == DatabaseKind::Sqlite {
                    primary_key.len() == 1 && primary_key[0] == column.name
                } else {
                    flagged(&column.name, |d| d.is_identity)
                        || column
                            .column_default
                            .as_deref()
                            .is_some_and(|d| d.trim_start().starts_with("nextval("))
                };
                auto && integerish(table_copy::canonical(
                    source_kind,
                    &column.data_type,
                    column.character_maximum_length,
                ))
            })
            .map(|column| column.name.clone())
            .collect();
        let generated = columns
            .iter()
            .filter(|column| flagged(&column.name, |d| d.is_generated))
            .map(|column| column.name.clone())
            .collect();
        let (indexes, constraints, foreign_keys) = if native {
            (Vec::new(), Vec::new(), Vec::new())
        } else {
            let table_actions: HashMap<String, String> = actions
                .iter()
                .filter(|((table, _), _)| table == &info.name)
                .map(|((_, name), definition)| (name.clone(), definition.clone()))
                .collect();
            (
                source
                    .list_indexes(&pair.source, &info.name)
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|index| !index.is_primary)
                    .collect(),
                with_catalog_checks(
                    source
                        .list_constraints(&pair.source, &info.name)
                        .await
                        .unwrap_or_default(),
                    &table_actions,
                ),
                group_foreign_keys(
                    source
                        .list_foreign_keys(&pair.source, &info.name)
                        .await
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|fk| fk.from_table == info.name && fk.from_schema == pair.source)
                        .collect(),
                    &table_actions,
                ),
            )
        };
        out.push(SourceTable {
            pair: pair.clone(),
            partitioned: parents.contains(&info.name),
            name: info.name,
            columns,
            identity,
            generated,
            primary_key,
            indexes,
            constraints,
            foreign_keys,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq)]
enum DefaultValue {
    Number(String),
    Text(String),
    Bool(bool),
    Now,
}

fn strip_parens(mut text: &str) -> &str {
    loop {
        let trimmed = text.trim();
        if trimmed.starts_with('(') && trimmed.ends_with(')') {
            let inner = &trimmed[1..trimmed.len() - 1];
            let mut depth = 0i32;
            let balanced = inner.chars().all(|c| {
                match c {
                    '(' => depth += 1,
                    ')' => depth -= 1,
                    _ => {}
                }
                depth >= 0
            }) && depth == 0;
            if balanced {
                text = inner;
                continue;
            }
        }
        return trimmed;
    }
}

fn parse_default(source: DatabaseKind, raw: &str) -> Option<Result<DefaultValue, String>> {
    let text = strip_parens(raw);
    if text.is_empty() || text.eq_ignore_ascii_case("null") {
        return None;
    }
    let text = match text.rfind("::") {
        Some(position) if text.starts_with('\'') && text[..position].ends_with('\'') => {
            &text[..position]
        }
        _ => text,
    };
    let upper = text.to_ascii_uppercase();
    let now = [
        "CURRENT_TIMESTAMP",
        "NOW()",
        "GETDATE()",
        "SYSDATETIME()",
        "SYSDATE",
        "SYSTIMESTAMP",
        "LOCALTIMESTAMP",
        "CURRENT_TIMESTAMP()",
        "NOW64()",
    ];
    if now.contains(&upper.as_str()) || upper.starts_with("CURRENT_TIMESTAMP(") {
        return Some(Ok(DefaultValue::Now));
    }
    if upper == "TRUE" || upper == "FALSE" {
        return Some(Ok(DefaultValue::Bool(upper == "TRUE")));
    }
    let quoted = text.strip_prefix('N').unwrap_or(text);
    if quoted.len() >= 2 && quoted.starts_with('\'') && quoted.ends_with('\'') {
        return Some(Ok(DefaultValue::Text(
            quoted[1..quoted.len() - 1].replace("''", "'"),
        )));
    }
    if !text.is_empty()
        && text
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | '.' | 'e' | 'E'))
        && text.parse::<f64>().is_ok()
    {
        return Some(Ok(DefaultValue::Number(text.to_string())));
    }
    if source == DatabaseKind::Mysql && !text.contains('(') {
        return Some(Ok(DefaultValue::Text(text.to_string())));
    }
    Some(Err(raw.trim().to_string()))
}

fn render_default(
    target: Dialect,
    canonical: Canonical,
    rendered: &str,
    value: &DefaultValue,
) -> Option<String> {
    let flag = |on: bool| match target {
        Dialect::Postgres | Dialect::Duckdb | Dialect::Clickhouse => {
            if on { "TRUE" } else { "FALSE" }.to_string()
        }
        _ => if on { "1" } else { "0" }.to_string(),
    };
    let text = match (value, canonical) {
        (DefaultValue::Now, Canonical::Timestamp | Canonical::TimestampTz) => match target {
            Dialect::Mysql => "CURRENT_TIMESTAMP(6)".to_string(),
            Dialect::Mssql if canonical == Canonical::TimestampTz => "SYSDATETIMEOFFSET()".into(),
            Dialect::Mssql => "SYSDATETIME()".into(),
            Dialect::Oracle => "SYSTIMESTAMP".into(),
            Dialect::Clickhouse => "now64(6)".into(),
            _ => "CURRENT_TIMESTAMP".into(),
        },
        (DefaultValue::Now, _) => return None,
        (DefaultValue::Bool(on), _) => flag(*on),
        (DefaultValue::Number(n), Canonical::Bool) => flag(n.parse::<f64>().ok()? != 0.0),
        (DefaultValue::Text(t), Canonical::Bool) => flag(import::parse_bool(t)?),
        (DefaultValue::Number(n), _) => n.clone(),
        (DefaultValue::Text(t), _) => target.text_literal(t),
    };
    let unbounded = ["LONGTEXT", "JSON", "LONGBLOB"].contains(&rendered);
    Some(if target == Dialect::Mysql && unbounded {
        format!("({text})")
    } else {
        text
    })
}

fn action_sql(target: Dialect, fk: &ForeignKey, warnings: &mut Vec<String>) -> String {
    let mut out = String::new();
    let mut add = |clause: &str, action: &Option<String>| {
        let Some(action) = action else { return };
        let supported = match target {
            Dialect::Postgres | Dialect::Mysql | Dialect::Sqlite => true,
            Dialect::Mssql => action != "RESTRICT",
            Dialect::Oracle => {
                clause == "ON DELETE" && (action == "CASCADE" || action == "SET NULL")
            }
            _ => false,
        };
        if supported {
            out.push_str(&format!(" {clause} {action}"));
        } else if action != "RESTRICT" {
            warnings.push(format!(
                "Fremdschlüssel {}: {clause} {action} wird von der Zielfamilie nicht unterstützt.",
                fk.name
            ));
        }
    };
    add("ON DELETE", &fk.on_delete);
    add("ON UPDATE", &fk.on_update);
    out
}

fn columns_sql(target: Dialect, columns: &[String]) -> String {
    columns
        .iter()
        .map(|c| target.quote(c))
        .collect::<Vec<_>>()
        .join(", ")
}

fn check_is_not_null(definition: &str) -> bool {
    let upper = definition.to_ascii_uppercase();
    upper.contains("IS NOT NULL") && !upper.contains(" AND ") && !upper.contains(" OR ")
}

const CODE_TYPES: [&str; 10] = [
    "view",
    "materialized_view",
    "function",
    "procedure",
    "package",
    "package_body",
    "type",
    "type_body",
    "trigger",
    "synonym",
];

fn manual_reason(object_type: &str) -> String {
    match object_type {
        "view" | "materialized_view" => "View-Definition ist Dialekt-SQL und wird nicht übersetzt.",
        "package" | "package_body" => "Oracle-Packages (PL/SQL mit Package-Zustand) haben in der Zielfamilie keine Entsprechung.",
        "type" | "type_body" => "Benutzerdefinierte Typen sind familienspezifisch.",
        "trigger" => "Trigger-Code ist Dialekt-SQL und wird nicht übersetzt.",
        "synonym" => "Synonyme gibt es nur in Oracle.",
        "check" => "Check-Ausdruck ist Dialekt-SQL und wird nicht übersetzt.",
        "sequence" => "Die Zielfamilie kennt keine eigenständigen Sequenzen.",
        _ => "Prozeduraler Code ist Dialekt-SQL und wird nicht übersetzt.",
    }
    .into()
}

struct Mapper<'a> {
    source_kind: DatabaseKind,
    target: Dialect,
    fold: bool,
    tables: &'a [SourceTable],
}

impl Mapper<'_> {
    fn schema(&self, source_schema: &str) -> String {
        self.tables
            .iter()
            .find(|t| t.pair.source == source_schema)
            .map(|t| t.pair.target.clone())
            .unwrap_or_else(|| source_schema.to_string())
    }

    fn name(&self, name: &str) -> String {
        fold(self.target, name, self.fold)
    }

    fn table(&self, schema: &str, name: &str) -> Option<&SourceTable> {
        self.tables
            .iter()
            .find(|t| t.pair.source == schema && t.name == name)
    }
}

fn check_names(target: Dialect, plan: &TransferPlan) -> Result<(), String> {
    let key = |name: &str| {
        if case_insensitive(target) {
            name.to_ascii_lowercase()
        } else {
            name.to_string()
        }
    };
    let mut problems = Vec::new();
    let mut seen = HashSet::new();
    for table in &plan.tables {
        if !seen.insert((table.target_schema.clone(), key(&table.target_name))) {
            problems.push(format!(
                "Tabellenname {}.{} kommt im Ziel mehrfach vor.",
                table.target_schema, table.target_name
            ));
        }
        let mut columns = HashSet::new();
        for column in &table.columns {
            if !columns.insert(key(&column.target)) {
                problems.push(format!(
                    "Spalte {}.{} kommt im Ziel mehrfach vor.",
                    table.target_name, column.target
                ));
            }
        }
        if let Some(limit) = name_limit(target) {
            for name in
                std::iter::once(&table.target_name).chain(table.columns.iter().map(|c| &c.target))
            {
                if name.len() > limit {
                    problems.push(format!(
                        "Name {name} überschreitet die Ziellänge von {limit} Zeichen."
                    ));
                }
            }
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems.join("\n"))
    }
}

fn create_schema_sql(target: Dialect, schema: &str) -> String {
    match target {
        Dialect::Mysql | Dialect::Clickhouse => format!("CREATE DATABASE {}", target.quote(schema)),
        _ => format!("CREATE SCHEMA {}", target.quote(schema)),
    }
}

pub fn column_canonical(
    source_kind: DatabaseKind,
    data_type: &str,
    length: Option<i32>,
    identity: bool,
) -> Canonical {
    let mut canonical = table_copy::canonical(source_kind, data_type, length);
    if source_kind == DatabaseKind::Oracle {
        if let Canonical::Decimal(Some((precision, 0))) = canonical {
            canonical = match precision {
                0..=4 => Canonical::SmallInt,
                5..=9 => Canonical::Int,
                10..=18 => Canonical::BigInt,
                _ => canonical,
            };
        }
    }
    if identity {
        identity_canonical(canonical)
    } else {
        canonical
    }
}

type ColumnKey = (String, String, String);

fn aligned_canonicals(mapper: &Mapper) -> HashMap<ColumnKey, Canonical> {
    let mut map: HashMap<ColumnKey, Canonical> = HashMap::new();
    for table in mapper.tables {
        for column in &table.columns {
            map.insert(
                (
                    table.pair.source.clone(),
                    table.name.clone(),
                    column.name.clone(),
                ),
                column_canonical(
                    mapper.source_kind,
                    &column.data_type,
                    column.character_maximum_length,
                    table.identity.contains(&column.name),
                ),
            );
        }
    }
    for _ in 0..3 {
        for table in mapper.tables {
            for fk in &table.foreign_keys {
                for (column, referenced) in fk.columns.iter().zip(&fk.ref_columns) {
                    let parent = (
                        fk.ref_schema.clone(),
                        fk.ref_table.clone(),
                        referenced.clone(),
                    );
                    if let Some(canonical) = map.get(&parent).copied() {
                        map.insert(
                            (
                                table.pair.source.clone(),
                                table.name.clone(),
                                column.clone(),
                            ),
                            canonical,
                        );
                    }
                }
            }
        }
    }
    map
}

fn cross_ddl(plan: &mut TransferPlan, mapper: &Mapper, order: &[usize]) {
    let d = mapper.target;
    let canonicals = aligned_canonicals(mapper);
    let mut names: HashMap<String, Names> = HashMap::new();
    let mut referenced: HashSet<(String, String, String)> = HashSet::new();
    for table in mapper.tables {
        for fk in &table.foreign_keys {
            for column in &fk.ref_columns {
                referenced.insert((fk.ref_schema.clone(), fk.ref_table.clone(), column.clone()));
            }
        }
    }
    let mut dropped_defaults = Vec::new();
    let mut lossy = Vec::new();
    for &i in order {
        let table = &mapper.tables[i];
        let schema = table.pair.target.clone();
        let target_name = mapper.name(&table.name);
        let qualified = d.target(&schema, &target_name);
        let schema_names = names.entry(schema.clone()).or_insert_with(|| Names::new(d));
        let mut uniques: Vec<Vec<String>> = Vec::new();
        for index in table.indexes.iter().filter(|i| i.is_unique) {
            if !index.columns.is_empty() && !uniques.contains(&index.columns) {
                uniques.push(index.columns.clone());
            }
        }
        for constraint in table
            .constraints
            .iter()
            .filter(|c| c.constraint_type == "UNIQUE")
        {
            if !constraint.columns.is_empty() && !uniques.contains(&constraint.columns) {
                uniques.push(constraint.columns.clone());
            }
        }
        uniques.retain(|columns| columns != &table.primary_key);
        let known = |column: &String| table.columns.iter().any(|c| &c.name == column);
        let mut keyed: HashSet<String> = table.primary_key.iter().cloned().collect();
        keyed.extend(uniques.iter().flatten().cloned());
        keyed.extend(
            table
                .indexes
                .iter()
                .flat_map(|index| index.columns.iter().cloned()),
        );
        keyed.extend(
            table
                .foreign_keys
                .iter()
                .flat_map(|fk| fk.columns.iter().cloned()),
        );
        keyed.extend(table.columns.iter().map(|c| c.name.clone()).filter(|c| {
            referenced.contains(&(table.pair.source.clone(), table.name.clone(), c.clone()))
        }));
        let rowid = d == Dialect::Sqlite
            && table.primary_key.len() == 1
            && table.identity.contains(&table.primary_key[0]);
        let mut parts = Vec::new();
        let mut columns = Vec::new();
        for column in &table.columns {
            let canonical = canonicals[&(
                table.pair.source.clone(),
                table.name.clone(),
                column.name.clone(),
            )];
            let identity = table.identity.contains(&column.name);
            let rendered = table_copy::render(d, canonical, keyed.contains(&column.name));
            let target_column = mapper.name(&column.name);
            if canonical == Canonical::TimestampTz
                && matches!(d, Dialect::Mysql | Dialect::Sqlite | Dialect::Clickhouse)
            {
                lossy.push(format!("{}.{} (Zeitzone → UTC)", table.name, column.name));
            }
            if canonical == Canonical::Text {
                let base = import::base_type(&column.data_type);
                if ![
                    "char", "text", "clob", "string", "enum", "set", "xml", "json",
                ]
                .iter()
                .any(|t| base.contains(t))
                {
                    lossy.push(format!(
                        "{}.{} ({} → Text)",
                        table.name, column.name, column.data_type
                    ));
                }
            }
            let not_null = !column.is_nullable || table.primary_key.contains(&column.name);
            let mut definition = format!("{} ", d.quote(&target_column));
            let mut identity_clause = "";
            if rowid && table.primary_key[0] == column.name {
                definition.push_str("INTEGER PRIMARY KEY");
            } else {
                if d == Dialect::Clickhouse && !not_null {
                    definition.push_str(&format!("Nullable({rendered})"));
                } else {
                    definition.push_str(&rendered);
                }
                if identity {
                    identity_clause = match d {
                        Dialect::Postgres => " GENERATED BY DEFAULT AS IDENTITY",
                        Dialect::Mssql => " IDENTITY(1,1)",
                        Dialect::Oracle => " GENERATED BY DEFAULT ON NULL AS IDENTITY",
                        Dialect::Mysql if table.primary_key.first() == Some(&column.name) => {
                            " AUTO_INCREMENT"
                        }
                        _ => {
                            plan.warnings.push(format!(
                                "{}.{}: Autoinkrement wird in der Zielfamilie nicht nachgebildet; Werte werden übernommen.",
                                table.name, column.name
                            ));
                            ""
                        }
                    };
                    definition.push_str(identity_clause);
                }
                if identity_clause.is_empty() {
                    match column
                        .column_default
                        .as_deref()
                        .and_then(|raw| parse_default(mapper.source_kind, raw))
                    {
                        Some(Ok(value)) if d != Dialect::Clickhouse => {
                            match render_default(d, canonical, &rendered, &value) {
                                Some(text) => definition.push_str(&format!(" DEFAULT {text}")),
                                None => {
                                    dropped_defaults.push(format!("{}.{}", table.name, column.name))
                                }
                            }
                        }
                        Some(_) if !identity => {
                            dropped_defaults.push(format!("{}.{}", table.name, column.name))
                        }
                        _ => {}
                    }
                }
                if not_null && d != Dialect::Clickhouse {
                    definition.push_str(" NOT NULL");
                }
            }
            if table.generated.contains(&column.name) {
                plan.warnings.push(format!(
                    "{}.{}: generierte Spalte wird als normale Spalte mit Werten übernommen.",
                    table.name, column.name
                ));
            }
            parts.push(definition);
            columns.push(TransferColumn {
                source: column.name.clone(),
                target: target_column,
                source_type: column.data_type.clone(),
                target_type: rendered,
                identity: identity && !identity_clause.is_empty()
                    || rowid && table.primary_key[0] == column.name,
            });
        }
        let pk_columns: Vec<String> = table.primary_key.iter().map(|c| mapper.name(c)).collect();
        let inline_keys = matches!(d, Dialect::Mysql | Dialect::Sqlite | Dialect::Duckdb);
        if !pk_columns.is_empty() && inline_keys && !rowid {
            parts.push(format!("PRIMARY KEY ({})", columns_sql(d, &pk_columns)));
        }
        if d == Dialect::Duckdb {
            for unique in &uniques {
                let mapped: Vec<String> = unique.iter().map(|c| mapper.name(c)).collect();
                parts.push(format!("UNIQUE ({})", columns_sql(d, &mapped)));
            }
        }
        let mut foreign = Vec::new();
        for fk in &table.foreign_keys {
            let Some(parent) = mapper.table(&fk.ref_schema, &fk.ref_table) else {
                plan.warnings.push(format!(
                    "Fremdschlüssel {} auf {}.{} übersprungen: Zieltabelle ist nicht Teil des Transfers.",
                    fk.name, fk.ref_schema, fk.ref_table
                ));
                continue;
            };
            let parent_schema = mapper.schema(&fk.ref_schema);
            let from: Vec<String> = fk.columns.iter().map(|c| mapper.name(c)).collect();
            let to: Vec<String> = fk.ref_columns.iter().map(|c| mapper.name(c)).collect();
            let actions = action_sql(d, fk, &mut plan.warnings);
            let reference = d.target(&parent_schema, &mapper.name(&parent.name));
            match d {
                Dialect::Sqlite | Dialect::Duckdb => {
                    if parent_schema != schema {
                        plan.warnings.push(format!(
                            "Fremdschlüssel {} über Schemagrenzen wird in dieser Zielfamilie nicht unterstützt.",
                            fk.name
                        ));
                        continue;
                    }
                    parts.push(format!(
                        "FOREIGN KEY ({}) REFERENCES {} ({}){}",
                        columns_sql(d, &from),
                        if d == Dialect::Duckdb {
                            reference.clone()
                        } else {
                            d.quote(&mapper.name(&parent.name))
                        },
                        columns_sql(d, &to),
                        if d == Dialect::Duckdb { String::new() } else { actions }
                    ));
                }
                Dialect::Clickhouse => {}
                _ => foreign.push(Statement::plain(format!(
                    "ALTER TABLE {qualified} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {reference} ({}){actions}",
                    d.quote(&schema_names.take(&mapper.name(&fk.name))),
                    columns_sql(d, &from),
                    columns_sql(d, &to)
                ))),
            }
        }
        if d == Dialect::Clickhouse && !table.foreign_keys.is_empty() {
            plan.warnings.push(format!(
                "{}: ClickHouse kennt keine Fremdschlüssel; sie werden nicht angelegt.",
                table.name
            ));
        }
        let mut sql = format!("CREATE TABLE {qualified} ({})", parts.join(", "));
        if d == Dialect::Clickhouse {
            sql.push_str(&format!(
                " ENGINE = MergeTree ORDER BY {}",
                if pk_columns.is_empty() {
                    "tuple()".to_string()
                } else {
                    format!("({})", columns_sql(d, &pk_columns))
                }
            ));
        }
        plan.pre_data
            .push(Statement::object(sql, "table", &schema, &target_name));
        if !pk_columns.is_empty() && !inline_keys && d != Dialect::Clickhouse {
            let name = schema_names.take(&format!("{target_name}_pkey"));
            plan.post_data.push(Statement::plain(format!(
                "ALTER TABLE {qualified} ADD CONSTRAINT {} PRIMARY KEY ({})",
                d.quote(&name),
                columns_sql(d, &pk_columns)
            )));
        }
        for unique in &uniques {
            if !unique.iter().all(known) {
                continue;
            }
            let mapped: Vec<String> = unique.iter().map(|c| mapper.name(c)).collect();
            let name = schema_names.take(&format!("{target_name}_{}_key", mapped.join("_")));
            match d {
                Dialect::Duckdb | Dialect::Clickhouse => {}
                Dialect::Sqlite => {
                    plan.post_data
                        .push(Statement::plain(table_copy::create_index_sql(
                            d,
                            &schema,
                            &target_name,
                            &name,
                            true,
                            &mapped,
                        )))
                }
                _ => plan.post_data.push(Statement::plain(format!(
                    "ALTER TABLE {qualified} ADD CONSTRAINT {} UNIQUE ({})",
                    d.quote(&name),
                    columns_sql(d, &mapped)
                ))),
            }
        }
        for index in table.indexes.iter().filter(|i| !i.is_unique) {
            if d == Dialect::Clickhouse {
                break;
            }
            if index.columns.is_empty() || !index.columns.iter().all(known) {
                plan.warnings.push(format!(
                    "Index {} übersprungen (Ausdrucksindex oder unbekannte Spalten).",
                    index.name
                ));
                continue;
            }
            let mapped: Vec<String> = index.columns.iter().map(|c| mapper.name(c)).collect();
            let name = schema_names.take(&mapper.name(&index.name));
            plan.post_data
                .push(Statement::plain(table_copy::create_index_sql(
                    d,
                    &schema,
                    &target_name,
                    &name,
                    false,
                    &mapped,
                )));
        }
        plan.post_data.extend(foreign);
        for check in table
            .constraints
            .iter()
            .filter(|c| c.constraint_type == "CHECK" && !check_is_not_null(&c.definition))
        {
            plan.manual.push(ManualObject {
                object_type: "check".into(),
                schema: table.pair.source.clone(),
                name: format!("{}.{}", table.name, check.name),
                reason: manual_reason("check"),
                ddl: check.definition.clone(),
            });
        }
        if table.partitioned {
            plan.warnings.push(format!(
                "{}: Partitionierung wird nicht übernommen; alle Partitionen landen in einer Tabelle.",
                table.name
            ));
        }
        for identity in columns.iter().filter(|c| c.identity) {
            match d {
                Dialect::Postgres => plan.finalize.push(Statement::plain(format!(
                    "SELECT setval(pg_get_serial_sequence({}, {}), COALESCE(MAX({}), 0) + 1, false) FROM {qualified}",
                    super::quote_literal(&qualified),
                    super::quote_literal(&identity.target),
                    d.quote(&identity.target)
                ))),
                Dialect::Oracle => plan.finalize.push(Statement::plain(format!(
                    "ALTER TABLE {qualified} MODIFY ({} GENERATED BY DEFAULT ON NULL AS IDENTITY (START WITH LIMIT VALUE))",
                    d.quote(&identity.target)
                ))),
                _ => {}
            }
        }
        plan.tables.push(TransferTable {
            source_schema: table.pair.source.clone(),
            source_name: table.name.clone(),
            target_schema: schema,
            target_name,
            columns,
            key: table.primary_key.clone(),
            only: !table.partitioned,
        });
    }
    if !dropped_defaults.is_empty() {
        plan.warnings.push(format!(
            "Defaults mit Ausdrücken werden nicht übertragen: {}",
            dropped_defaults.join(", ")
        ));
    }
    if !lossy.is_empty() {
        plan.warnings.push(format!(
            "Typumsetzung mit Informationsverlust: {}",
            lossy.join(", ")
        ));
    }
}

fn native_tables(plan: &mut TransferPlan, tables: &[SourceTable], order: &[usize]) {
    for &i in order {
        let table = &tables[i];
        plan.tables.push(TransferTable {
            source_schema: table.pair.source.clone(),
            source_name: table.name.clone(),
            target_schema: table.pair.target.clone(),
            target_name: table.name.clone(),
            columns: table
                .columns
                .iter()
                .filter(|c| !table.generated.contains(&c.name))
                .map(|c| TransferColumn {
                    source: c.name.clone(),
                    target: c.name.clone(),
                    source_type: c.data_type.clone(),
                    target_type: c.data_type.clone(),
                    identity: table.identity.contains(&c.name),
                })
                .collect(),
            key: table.primary_key.clone(),
            only: true,
        });
    }
}

async fn oracle_identity(
    plan: &mut TransferPlan,
    source: &dyn DatabaseAdapter,
    pair: &SchemaPair,
) -> Result<(), String> {
    let result = source
        .execute_query(&format!(
            "SELECT i.table_name AS t, i.column_name AS c, i.generation_type AS g, c.default_on_null AS n FROM all_tab_identity_cols i JOIN all_tab_columns c ON c.owner = i.owner AND c.table_name = i.table_name AND c.column_name = i.column_name WHERE i.owner = {}",
            super::quote_literal(&pair.source)
        ))
        .await?;
    let d = Dialect::Oracle;
    for row in &result.rows {
        let get = |key: &str| {
            row.get(key)
                .and_then(super::export::value_text)
                .unwrap_or_default()
        };
        let (table, column) = (get("T"), get("C"));
        if !plan
            .tables
            .iter()
            .any(|t| t.source_schema == pair.source && t.source_name == table)
        {
            continue;
        }
        let qualified = d.target(&pair.target, &table);
        let always = get("G") == "ALWAYS";
        if always {
            plan.before_load.push(Statement::plain(format!(
                "ALTER TABLE {qualified} MODIFY ({} GENERATED BY DEFAULT AS IDENTITY)",
                d.quote(&column)
            )));
        }
        plan.finalize.push(Statement::plain(format!(
            "ALTER TABLE {qualified} MODIFY ({} GENERATED {} AS IDENTITY (START WITH LIMIT VALUE))",
            d.quote(&column),
            if always {
                "ALWAYS"
            } else if get("N") == "YES" {
                "BY DEFAULT ON NULL"
            } else {
                "BY DEFAULT"
            }
        )));
    }
    Ok(())
}

async fn plan_sequences(
    plan: &mut TransferPlan,
    source: &dyn DatabaseAdapter,
    source_kind: DatabaseKind,
    target: Dialect,
    pair: &SchemaPair,
    fold_names: bool,
) {
    let Ok(sequences) = source.list_sequences(Some(&pair.source)).await else {
        return;
    };
    let owned = if source_kind == DatabaseKind::Postgres && !plan.native {
        owned_sequences(source, &pair.source).await
    } else {
        HashSet::new()
    };
    for sequence in sequences {
        if sequence.name.starts_with("ISEQ$$_") || owned.contains(&sequence.name) {
            continue;
        }
        let target_name = fold(target, &sequence.name, fold_names);
        if !plan.native {
            let increment = sequence.increment_by.parse::<i128>().unwrap_or(1);
            let start = sequence
                .last_value
                .as_deref()
                .and_then(|v| v.parse::<i128>().ok())
                .map(|v| v + increment)
                .or_else(|| sequence.start_value.parse().ok())
                .unwrap_or(1);
            let qualified = target.target(&pair.target, &target_name);
            let sql = match target {
                Dialect::Postgres | Dialect::Oracle | Dialect::Duckdb => {
                    format!("CREATE SEQUENCE {qualified} START WITH {start} INCREMENT BY {increment}")
                }
                Dialect::Mssql => format!(
                    "CREATE SEQUENCE {qualified} AS BIGINT START WITH {start} INCREMENT BY {increment}"
                ),
                _ => {
                    plan.manual.push(ManualObject {
                        object_type: "sequence".into(),
                        schema: pair.source.clone(),
                        name: sequence.name.clone(),
                        reason: manual_reason("sequence"),
                        ddl: format!("START WITH {start} INCREMENT BY {increment}"),
                    });
                    continue;
                }
            };
            plan.pre_data.push(Statement::object(
                sql,
                "sequence",
                &pair.target,
                &target_name,
            ));
        }
        plan.sequences.push(SequenceMap {
            source_schema: pair.source.clone(),
            source_name: sequence.name,
            target_schema: pair.target.clone(),
            target_name,
        });
    }
}

async fn manual_objects(plan: &mut TransferPlan, source: &dyn DatabaseAdapter, pair: &SchemaPair) {
    let types: Vec<String> = CODE_TYPES.iter().map(|t| t.to_string()).collect();
    match source.schema_catalog(&pair.source, &types).await {
        Ok(objects) => {
            for object in objects
                .into_iter()
                .filter(|o| CODE_TYPES.contains(&o.object_type.as_str()))
            {
                plan.manual.push(ManualObject {
                    reason: manual_reason(&object.object_type),
                    object_type: object.object_type,
                    schema: pair.source.clone(),
                    name: object.name,
                    ddl: object.ddl,
                });
            }
        }
        Err(_) => {
            for view in source
                .list_views(Some(&pair.source))
                .await
                .unwrap_or_default()
            {
                let ddl = source
                    .get_view_definition(&pair.source, &view.name)
                    .await
                    .unwrap_or_default();
                plan.manual.push(ManualObject {
                    object_type: "view".into(),
                    schema: pair.source.clone(),
                    name: view.name,
                    reason: manual_reason("view"),
                    ddl,
                });
            }
        }
    }
}

fn object_key(target: Dialect, name: &str) -> String {
    let base = name.split('(').next().unwrap_or(name).trim();
    if case_insensitive(target) {
        base.to_ascii_lowercase()
    } else {
        base.to_string()
    }
}

async fn existing_objects(
    adapter: &dyn DatabaseAdapter,
    target: Dialect,
    schema: &str,
) -> HashSet<String> {
    let mut names: Vec<String> = Vec::new();
    names.extend(
        adapter
            .list_tables(Some(schema))
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|t| t.name),
    );
    names.extend(
        adapter
            .list_views(Some(schema))
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|t| t.name),
    );
    names.extend(
        adapter
            .list_sequences(Some(schema))
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|s| s.name),
    );
    names.extend(
        adapter
            .list_functions(Some(schema))
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|f| f.name),
    );
    names.extend(
        adapter
            .list_procedures(Some(schema))
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|f| f.name),
    );
    if target == Dialect::Oracle {
        if let Ok(result) = adapter
            .execute_query(&format!(
                "SELECT object_name AS n FROM all_objects WHERE owner = {} AND object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SEQUENCE', 'SYNONYM', 'FUNCTION', 'PROCEDURE', 'PACKAGE', 'TYPE')",
                super::quote_literal(schema)
            ))
            .await
        {
            names.extend(result.rows.iter().filter_map(|row| row.get("N").and_then(super::export::value_text)));
        }
    }
    names.iter().map(|name| object_key(target, name)).collect()
}

pub async fn conflicts(
    adapter: &dyn DatabaseAdapter,
    target: Dialect,
    plan: &TransferPlan,
) -> Vec<String> {
    let mut planned: Vec<(String, String)> = plan
        .tables
        .iter()
        .map(|t| (t.target_schema.clone(), t.target_name.clone()))
        .collect();
    for statement in plan.pre_data.iter().chain(&plan.post_data) {
        if let (Some(kind), Some(name)) = (&statement.object_type, &statement.name) {
            if matches!(
                kind.as_str(),
                "table"
                    | "view"
                    | "materialized_view"
                    | "sequence"
                    | "function"
                    | "procedure"
                    | "package"
                    | "type"
                    | "synonym"
            ) {
                let schema = statement.schema.clone().unwrap_or_default();
                planned.push((schema, name.clone()));
            }
        }
    }
    let mut inventory: HashMap<String, HashSet<String>> = HashMap::new();
    let mut out = Vec::new();
    for (schema, name) in planned {
        if plan.create_schemas.contains(&schema) {
            continue;
        }
        if !inventory.contains_key(&schema) {
            let existing = existing_objects(adapter, target, &schema).await;
            inventory.insert(schema.clone(), existing);
        }
        let label = format!("{schema}.{name}");
        if inventory[&schema].contains(&object_key(target, &name)) && !out.contains(&label) {
            out.push(label);
        }
    }
    out
}

pub async fn plan(
    target: &Endpoint,
    request: &PlanRequest,
    pool: PoolState,
) -> Result<TransferPlan, String> {
    dialect(request.source.kind)?;
    let target_dialect = dialect(target.kind)?;
    ensure_writable(target)?;
    if request.schemas.is_empty() {
        return Err("Bitte mindestens ein Quellschema wählen.".into());
    }
    let source = adapter(&request.source, &pool)?;
    let target_adapter = adapter(target, &pool)?;
    let native = native_family(request.source.kind, target.kind);
    let fold_names = request.fold_names && !native;
    let mut plan = TransferPlan {
        native,
        atomic: atomic(target_dialect),
        schemas: request.schemas.clone(),
        ..Default::default()
    };
    let existing = target_adapter.list_schemas().await?;
    for pair in &request.schemas {
        if pair.target.trim().is_empty() || pair.source.trim().is_empty() {
            return Err("Quell- und Zielschema müssen gesetzt sein.".into());
        }
        if existing.contains(&pair.target) || plan.create_schemas.contains(&pair.target) {
            continue;
        }
        match target_dialect {
            Dialect::Oracle => {
                return Err(format!(
                    "Zielschema {} existiert nicht. Oracle-Schemas sind Benutzer und müssen vorher angelegt werden.",
                    pair.target
                ))
            }
            Dialect::Sqlite => return Err(format!("Zielschema {} existiert nicht.", pair.target)),
            _ => plan.create_schemas.push(pair.target.clone()),
        }
    }
    let mut tables = Vec::new();
    for pair in &request.schemas {
        tables.extend(read_tables(source.as_ref(), request.source.kind, pair, native).await?);
    }
    if tables.is_empty() {
        return Err("Die gewählten Schemas enthalten keine Tabellen.".into());
    }
    let order = load_order(&tables);
    if native {
        native_tables(&mut plan, &tables, &order);
        if target_dialect == Dialect::Oracle {
            for pair in &request.schemas {
                oracle_identity(&mut plan, source.as_ref(), pair).await?;
            }
        }
    } else {
        let mapper = Mapper {
            source_kind: request.source.kind,
            target: target_dialect,
            fold: fold_names,
            tables: &tables,
        };
        cross_ddl(&mut plan, &mapper, &order);
        for pair in &request.schemas {
            manual_objects(&mut plan, source.as_ref(), pair).await;
        }
    }
    for pair in &request.schemas {
        plan_sequences(
            &mut plan,
            source.as_ref(),
            request.source.kind,
            target_dialect,
            pair,
            fold_names,
        )
        .await;
    }
    check_names(target_dialect, &plan)?;
    plan.conflicts = conflicts(target_adapter.as_ref(), target_dialect, &plan).await;
    Ok(plan)
}

fn exact_numeric(dialect: Dialect, data_type: &str) -> bool {
    let base = import::base_type(data_type);
    let base = base.split('(').next().unwrap_or("").trim();
    let float = [
        "real",
        "float4",
        "float8",
        "double",
        "double precision",
        "binary_float",
        "binary_double",
        "float32",
        "float64",
    ]
    .contains(&base)
        || base == "float" && dialect != Dialect::Oracle;
    !float
        && matches!(
            import::classify(data_type),
            TypeClass::Integer | TypeClass::Decimal
        )
}

pub fn read_expr(dialect: Dialect, name: &str, data_type: &str) -> String {
    let q = dialect.quote(name);
    let class = import::classify(data_type);
    let base = import::base_type(data_type);
    let exact = exact_numeric(dialect, data_type);
    match dialect {
        Dialect::Mysql if exact => format!("CAST({q} AS CHAR)"),
        Dialect::Mssql if exact && base.contains("money") => {
            format!("CONVERT(NVARCHAR(100), CAST({q} AS DECIMAL(19,4)))")
        }
        Dialect::Mssql if exact && class == TypeClass::Decimal => {
            format!("CONVERT(NVARCHAR(100), {q})")
        }
        Dialect::Oracle if exact => {
            format!("TO_CHAR({q}, 'TM9', 'NLS_NUMERIC_CHARACTERS=''.,''')")
        }
        Dialect::Oracle if base == "date" => format!("TO_CHAR({q}, 'YYYY-MM-DD HH24:MI:SS')"),
        Dialect::Oracle if class == TypeClass::TimestampTz => {
            format!("TO_CHAR({q}, 'YYYY-MM-DD HH24:MI:SS.FF6 TZH:TZM')")
        }
        Dialect::Oracle if class == TypeClass::Timestamp => {
            format!("TO_CHAR({q}, 'YYYY-MM-DD HH24:MI:SS.FF6')")
        }
        Dialect::Duckdb if exact => format!("CAST({q} AS VARCHAR)"),
        Dialect::Clickhouse if exact => format!("toString({q})"),
        _ => q,
    }
}

fn orderable(data_type: &str) -> bool {
    let base = import::base_type(data_type);
    if import::classify(data_type) == TypeClass::Binary || base.contains("max)") {
        return false;
    }
    ![
        "text",
        "ntext",
        "clob",
        "nclob",
        "json",
        "jsonb",
        "xml",
        "geometry",
        "geography",
        "blob",
        "long",
        "array",
        "[]",
        "map(",
        "tuple(",
        "object",
    ]
    .iter()
    .any(|t| base.contains(t))
}

fn page_clause(dialect: Dialect, offset: u64) -> String {
    match dialect {
        Dialect::Mssql | Dialect::Oracle => {
            format!(" OFFSET {offset} ROWS FETCH NEXT {READ_PAGE} ROWS ONLY")
        }
        _ => format!(" LIMIT {READ_PAGE} OFFSET {offset}"),
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Page {
    Cursor,
    Keyset(usize, Option<String>),
    Offset(Vec<String>, u64),
    Single,
}

pub struct Reader {
    dialect: Dialect,
    session: Box<dyn TxSession>,
    page: Page,
    done: bool,
}

fn select_list(dialect: Dialect, table: &TransferTable) -> String {
    table
        .columns
        .iter()
        .enumerate()
        .map(|(i, c)| {
            format!(
                "{} AS {}",
                read_expr(dialect, &c.source, &c.source_type),
                dialect.quote(&format!("c{i}"))
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn source_from(dialect: Dialect, table: &TransferTable) -> String {
    let qualified = dialect.target(&table.source_schema, &table.source_name);
    if dialect == Dialect::Postgres && table.only {
        format!("ONLY {qualified}")
    } else {
        qualified
    }
}

impl Reader {
    pub async fn open(source: &Endpoint, pool: &PoolState) -> Result<(Self, Vec<String>), String> {
        let d = dialect(source.kind)?;
        let mut warnings = Vec::new();
        let session: Box<dyn TxSession> = if d == Dialect::Postgres {
            let (config, ssl) = super::connection::parse_connection(
                &source.connection_string,
                source.database.as_deref(),
            )?;
            Box::new(
                import::PgTx::open_with(
                    &config,
                    &ssl,
                    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
                )
                .await?,
            )
        } else {
            let mut session = import::open_session(
                source.kind,
                &source.connection_string,
                source.database.as_deref(),
                pool.clone(),
            )
            .await?;
            match d {
                Dialect::Mysql => {
                    if let Err(error) = session
                        .execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY")
                        .await
                    {
                        warnings.push(format!("Quelle ohne konsistenten Snapshot: {error}"));
                    }
                }
                Dialect::Oracle => {
                    if let Err(error) = session.execute("SET TRANSACTION READ ONLY").await {
                        warnings.push(format!("Quelle ohne lesekonsistente Transaktion: {error}"));
                    }
                }
                Dialect::Mssql => {
                    let allowed = session
                        .execute("SELECT snapshot_isolation_state AS s FROM sys.databases WHERE name = DB_NAME()")
                        .await
                        .ok()
                        .and_then(|r| r.rows.first().and_then(|row| row.get("s")).and_then(super::export::value_text))
                        .is_some_and(|s| s == "1");
                    if allowed {
                        session
                            .execute("COMMIT TRANSACTION; SET TRANSACTION ISOLATION LEVEL SNAPSHOT; BEGIN TRANSACTION")
                            .await?;
                    } else {
                        warnings.push("Die Quelldatenbank erlaubt keine SNAPSHOT-Isolation; gleichzeitige Schreibzugriffe während des Transfers werden nicht isoliert.".into());
                    }
                }
                Dialect::Clickhouse => warnings.push(
                    "ClickHouse hat keine Transaktionen; gleichzeitige Schreibzugriffe während des Transfers werden nicht isoliert.".into(),
                ),
                _ => {}
            }
            session
        };
        Ok((
            Self {
                dialect: d,
                session,
                page: Page::Single,
                done: true,
            },
            warnings,
        ))
    }

    pub async fn start(&mut self, table: &TransferTable) -> Result<(), String> {
        let d = self.dialect;
        self.done = false;
        if d == Dialect::Postgres {
            self.session
                .execute(&format!(
                    "DECLARE {CURSOR} NO SCROLL CURSOR FOR SELECT {} FROM {}",
                    select_list(d, table),
                    source_from(d, table)
                ))
                .await?;
            self.page = Page::Cursor;
            return Ok(());
        }
        let position = |name: &str| table.columns.iter().position(|c| c.source == name);
        let keyset = match table.key.as_slice() {
            [key] => position(key).filter(|i| {
                let column = &table.columns[*i];
                matches!(
                    import::classify(&column.source_type),
                    TypeClass::Integer | TypeClass::Decimal | TypeClass::Text
                ) && orderable(&column.source_type)
            }),
            _ => None,
        };
        self.page = match keyset {
            Some(i) => Page::Keyset(i, None),
            None => {
                let order: Vec<String> =
                    if !table.key.is_empty() && table.key.iter().all(|k| position(k).is_some()) {
                        table.key.clone()
                    } else {
                        table
                            .columns
                            .iter()
                            .filter(|c| orderable(&c.source_type))
                            .map(|c| c.source.clone())
                            .collect()
                    };
                if order.is_empty() {
                    Page::Single
                } else {
                    Page::Offset(order, 0)
                }
            }
        };
        Ok(())
    }

    fn page_sql(&self, table: &TransferTable) -> String {
        let d = self.dialect;
        let base = format!(
            "SELECT {} FROM {}",
            select_list(d, table),
            source_from(d, table)
        );
        match &self.page {
            Page::Cursor => format!("FETCH FORWARD {READ_PAGE} FROM {CURSOR}"),
            Page::Keyset(i, last) => {
                let column = &table.columns[*i];
                let key = d.quote(&column.source);
                let filter = last
                    .as_deref()
                    .map(|value| {
                        format!(
                            " WHERE {key} > {}",
                            import::literal(d, &column.source_type, Some(value))
                        )
                    })
                    .unwrap_or_default();
                format!("{base}{filter} ORDER BY {key}{}", page_clause(d, 0))
            }
            Page::Offset(order, offset) => format!(
                "{base} ORDER BY {}{}",
                columns_sql(d, order),
                page_clause(d, *offset)
            ),
            Page::Single => base,
        }
    }

    pub async fn next(
        &mut self,
        table: &TransferTable,
    ) -> Result<Vec<Vec<Option<String>>>, String> {
        if self.done {
            return Ok(Vec::new());
        }
        let result = self.session.execute(&self.page_sql(table)).await?;
        let aliases: Vec<String> = (0..table.columns.len()).map(|i| format!("c{i}")).collect();
        let rows: Vec<Vec<Option<String>>> = result
            .rows
            .iter()
            .map(|row| {
                aliases
                    .iter()
                    .map(|alias| row.get(alias).and_then(super::export::value_text))
                    .collect()
            })
            .collect();
        let full = rows.len() >= READ_PAGE;
        match &mut self.page {
            Page::Keyset(i, last) => *last = rows.last().and_then(|row| row[*i].clone()),
            Page::Offset(_, offset) => *offset += rows.len() as u64,
            _ => {}
        }
        if !full || self.page == Page::Single {
            self.done = true;
            if self.page == Page::Cursor {
                self.session.execute(&format!("CLOSE {CURSOR}")).await?;
            }
        }
        Ok(rows)
    }

    pub async fn close(mut self) {
        let _ = self.session.rollback().await;
    }
}

fn normalize(
    target: Dialect,
    source_class: TypeClass,
    target_class: TypeClass,
    value: Option<String>,
) -> Option<String> {
    let value = value?;
    if source_class == TypeClass::Bool
        && matches!(target_class, TypeClass::Integer | TypeClass::Decimal)
    {
        if let Some(flag) = import::parse_bool(&value) {
            return Some(if flag { "1" } else { "0" }.into());
        }
    }
    if target_class == TypeClass::Timestamp
        && matches!(
            target,
            Dialect::Mysql | Dialect::Sqlite | Dialect::Clickhouse | Dialect::Duckdb
        )
    {
        if let Some((moment, Some(offset))) = import::parse_moment(&value) {
            let utc = moment - chrono::Duration::seconds(offset.local_minus_utc() as i64);
            return Some(utc.format("%Y-%m-%d %H:%M:%S%.6f").to_string());
        }
    }
    Some(value)
}

fn drop_sql(target: Dialect, statement: &Statement) -> Option<String> {
    let kind = statement.object_type.as_deref()?;
    let name = statement.name.as_deref()?;
    let qualified = target.target(statement.schema.as_deref().unwrap_or_default(), name);
    Some(match (target, kind) {
        (Dialect::Oracle, "table") => format!("DROP TABLE {qualified} CASCADE CONSTRAINTS PURGE"),
        (Dialect::Oracle, "view") => format!("DROP VIEW {qualified} CASCADE CONSTRAINTS"),
        (Dialect::Oracle, "materialized_view") => format!("DROP MATERIALIZED VIEW {qualified}"),
        (Dialect::Oracle, "type") => format!("DROP TYPE {qualified} FORCE"),
        (
            Dialect::Oracle,
            "sequence" | "synonym" | "function" | "procedure" | "package" | "trigger",
        ) => format!("DROP {} {qualified}", kind.to_ascii_uppercase()),
        (Dialect::Mysql, "view" | "function" | "procedure" | "trigger") => {
            format!("DROP {} IF EXISTS {qualified}", kind.to_ascii_uppercase())
        }
        (Dialect::Clickhouse, "table") => format!("DROP TABLE IF EXISTS {qualified}"),
        (Dialect::Clickhouse, "view" | "materialized_view") => {
            format!("DROP VIEW IF EXISTS {qualified}")
        }
        _ => return None,
    })
}

struct Runner<'a> {
    target: &'a Endpoint,
    dialect: Dialect,
    pool: PoolState,
    adapter: Box<dyn DatabaseAdapter>,
    session: Option<Box<dyn TxSession>>,
    journal: Vec<Statement>,
    created_schemas: Vec<String>,
}

impl Runner<'_> {
    async fn exec(&mut self, statement: &Statement) -> Result<(), String> {
        let sql = statement.sql.as_str();
        let result = match &mut self.session {
            Some(session) => session.execute(sql).await.map(|_| ()),
            None if self.dialect == Dialect::Oracle => match self.adapter.execute_script(sql).await
            {
                Ok(results) => match results.iter().find(|r| !r.success) {
                    Some(failed) => Err(failed.error.clone().unwrap_or_default()),
                    None if results.is_empty() => {
                        Err("Die Anweisung wurde nicht ausgeführt.".into())
                    }
                    None => Ok(()),
                },
                Err(error) => Err(error),
            },
            None => self.adapter.execute_query(sql).await.map(|_| ()),
        };
        result.map_err(|error| {
            let head: String = sql.chars().take(300).collect();
            format!("{error}\nAnweisung: {head}")
        })?;
        if self.session.is_none() && statement.object_type.is_some() {
            self.journal.push(statement.clone());
        }
        Ok(())
    }

    async fn table_session(&mut self) -> Result<Box<dyn TxSession>, String> {
        match self.session.take() {
            Some(session) => Ok(session),
            None => {
                import::open_session(
                    self.target.kind,
                    &self.target.connection_string,
                    self.target.database.as_deref(),
                    self.pool.clone(),
                )
                .await
            }
        }
    }

    async fn load_table(
        &mut self,
        reader: &mut Reader,
        table: &TransferTable,
        report: &mut (dyn FnMut(u64) + Send),
    ) -> Result<u64, String> {
        let d = self.dialect;
        let has_identity = table.columns.iter().any(|c| c.identity);
        let plan = ImportPlan {
            dialect: d,
            target: d.target(&table.target_schema, &table.target_name),
            columns: table
                .columns
                .iter()
                .enumerate()
                .map(|(i, c)| ImportColumnInfo {
                    name: c.target.clone(),
                    data_type: c.target_type.clone(),
                    is_nullable: true,
                    has_default: false,
                    is_identity: c.identity,
                    is_generated: false,
                    ordinal_position: i as i32 + 1,
                })
                .collect(),
            conflict: None,
            identity_insert: d == Dialect::Mssql && has_identity,
            overriding: d == Dialect::Postgres && has_identity,
        };
        let classes: Vec<(TypeClass, TypeClass)> = table
            .columns
            .iter()
            .map(|c| {
                (
                    import::classify(&c.source_type),
                    import::classify(&c.target_type),
                )
            })
            .collect();
        let names: Vec<String> = table.columns.iter().map(|c| c.target.clone()).collect();
        let session = self.table_session().await?;
        let mut writer = BatchWriter::new(plan, session);
        if let Err(error) = reader.start(table).await {
            let _ = writer.abort().await;
            return Err(format!(
                "Quelle {}.{} lesen: {error}",
                table.source_schema, table.source_name
            ));
        }
        let mut read = 0u64;
        loop {
            if super::execution::cancellation_token().is_cancelled() {
                let _ = writer.abort().await;
                return Err("Transfer vom Benutzer abgebrochen.".into());
            }
            let rows = match reader.next(table).await {
                Ok(rows) => rows,
                Err(error) => {
                    let _ = writer.abort().await;
                    return Err(format!(
                        "Quelle {}.{} lesen: {error}",
                        table.source_schema, table.source_name
                    ));
                }
            };
            if rows.is_empty() {
                break;
            }
            for row in rows {
                let values = row
                    .into_iter()
                    .zip(&classes)
                    .map(|(value, (source, target))| normalize(d, *source, *target, value))
                    .collect();
                if let Err(failure) = writer.push(values).await {
                    let message = failure.message.clone();
                    let result = import::finish_failure(writer, failure, &names).await;
                    return Err(format!(
                        "{}.{}: {}",
                        table.target_schema,
                        table.target_name,
                        result.error.unwrap_or(message)
                    ));
                }
                read += 1;
            }
            report(read);
        }
        let (counts, mut session) = match writer.finish().await {
            Ok(done) => done,
            Err((failure, mut session)) => {
                let _ = session.rollback().await;
                return Err(format!(
                    "{}.{}: {}",
                    table.target_schema, table.target_name, failure.message
                ));
            }
        };
        let counted = session
            .execute(&format!(
                "SELECT COUNT(*) AS n FROM {}",
                d.target(&table.target_schema, &table.target_name)
            ))
            .await
            .ok()
            .and_then(|r| {
                let column = r.columns.first()?.clone();
                r.rows
                    .first()?
                    .get(&column)
                    .and_then(super::export::value_text)
            })
            .and_then(|n| n.parse::<f64>().ok())
            .map(|n| n as u64);
        if counts.inserted != read || counted != Some(read) {
            let _ = session.rollback().await;
            return Err(format!(
                "Verifikation fehlgeschlagen für {}.{}: {read} Zeilen gelesen, {} geschrieben, {} im Ziel gezählt.",
                table.target_schema,
                table.target_name,
                counts.inserted,
                counted.map(|n| n.to_string()).unwrap_or_else(|| "keine".into())
            ));
        }
        if atomic(d) {
            self.session = Some(session);
        } else {
            session.commit().await.map_err(|error| {
                format!(
                    "Commit für {}.{} nicht bestätigt: {error}",
                    table.target_schema, table.target_name
                )
            })?;
        }
        Ok(read)
    }

    async fn sync_sequences(
        &mut self,
        source: &dyn DatabaseAdapter,
        plan: &TransferPlan,
        warnings: &mut Vec<String>,
    ) -> Result<(), String> {
        let d = self.dialect;
        let mut values: HashMap<(String, String), (i128, i128)> = HashMap::new();
        for pair in &plan.schemas {
            for sequence in source
                .list_sequences(Some(&pair.source))
                .await
                .unwrap_or_default()
            {
                if let Some(last) = sequence
                    .last_value
                    .as_deref()
                    .and_then(|v| v.parse::<i128>().ok())
                {
                    let increment = sequence.increment_by.parse::<i128>().unwrap_or(1);
                    values.insert((pair.source.clone(), sequence.name), (last, increment));
                }
            }
        }
        for sequence in &plan.sequences {
            let Some((last, increment)) =
                values.get(&(sequence.source_schema.clone(), sequence.source_name.clone()))
            else {
                continue;
            };
            let qualified = d.target(&sequence.target_schema, &sequence.target_name);
            let sql = match d {
                Dialect::Postgres => format!(
                    "SELECT setval(to_regclass({}), {last}, true)",
                    super::quote_literal(&qualified)
                ),
                Dialect::Oracle => format!(
                    "ALTER SEQUENCE {qualified} RESTART START WITH {}",
                    last + increment
                ),
                Dialect::Mssql => format!(
                    "IF OBJECT_ID({}, 'SO') IS NOT NULL ALTER SEQUENCE {qualified} RESTART WITH {}",
                    d.text_literal(&qualified),
                    last + increment
                ),
                _ => continue,
            };
            if let Err(error) = self.exec(&Statement::plain(sql)).await {
                if self.session.is_some() {
                    return Err(error);
                }
                warnings.push(format!("Sequenz {qualified} nicht nachgezogen: {error}"));
            }
        }
        Ok(())
    }

    async fn compensate(&mut self) -> Vec<String> {
        let d = self.dialect;
        let mut leftovers = Vec::new();
        let journal: Vec<Statement> = std::mem::take(&mut self.journal)
            .into_iter()
            .rev()
            .filter(|s| {
                !self
                    .created_schemas
                    .contains(&s.schema.clone().unwrap_or_default())
            })
            .collect();
        if d == Dialect::Mysql {
            let tables: Vec<String> = journal
                .iter()
                .filter(|s| s.object_type.as_deref() == Some("table"))
                .filter_map(|s| Some(d.target(s.schema.as_deref()?, s.name.as_deref()?)))
                .collect();
            if !tables.is_empty() {
                let result = async {
                    let mut session = self.table_session().await?;
                    session.execute("SET FOREIGN_KEY_CHECKS = 0").await?;
                    session
                        .execute(&format!("DROP TABLE IF EXISTS {}", tables.join(", ")))
                        .await?;
                    session.execute("SET FOREIGN_KEY_CHECKS = 1").await?;
                    session.commit().await
                }
                .await;
                if let Err(error) = result {
                    leftovers.push(format!("{}: {error}", tables.join(", ")));
                }
            }
        }
        for statement in &journal {
            if d == Dialect::Mysql && statement.object_type.as_deref() == Some("table") {
                continue;
            }
            let Some(sql) = drop_sql(d, statement) else {
                continue;
            };
            let result = if d == Dialect::Oracle {
                self.adapter.execute_script(&sql).await.and_then(|r| {
                    match r.iter().find(|x| !x.success) {
                        Some(failed) => Err(failed.error.clone().unwrap_or_default()),
                        None => Ok(()),
                    }
                })
            } else {
                self.adapter.execute_query(&sql).await.map(|_| ())
            };
            if let Err(error) = result {
                leftovers.push(format!(
                    "{} {}.{}: {error}",
                    statement.object_type.clone().unwrap_or_default(),
                    statement.schema.clone().unwrap_or_default(),
                    statement.name.clone().unwrap_or_default()
                ));
            }
        }
        for schema in self.created_schemas.clone().iter().rev() {
            if let Err(error) = self
                .adapter
                .execute_query(&format!("DROP DATABASE {}", d.quote(schema)))
                .await
            {
                leftovers.push(format!("Datenbank {schema}: {error}"));
            }
        }
        leftovers
    }
}

pub async fn run(
    target: &Endpoint,
    request: &RunRequest,
    pool: PoolState,
    progress: &(dyn Fn(Progress) + Send + Sync),
) -> Result<TransferOutcome, String> {
    let plan = &request.plan;
    let d = dialect(target.kind)?;
    dialect(request.source.kind)?;
    ensure_writable(target)?;
    if plan.tables.is_empty() {
        return Err("Der Plan enthält keine Tabellen.".into());
    }
    if plan.atomic != atomic(d) {
        return Err("Der Plan passt nicht zur Zielverbindung. Bitte neu analysieren.".into());
    }
    let target_adapter = adapter(target, &pool)?;
    let found = conflicts(target_adapter.as_ref(), d, plan).await;
    if !found.is_empty() {
        return Err(format!(
            "Im Ziel existieren bereits Objekte aus dem Plan; es wurde nichts geschrieben: {}",
            found
                .iter()
                .take(20)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    let source = adapter(&request.source, &pool)?;
    let (mut reader, warnings) = Reader::open(&request.source, &pool).await?;
    let mut outcome = TransferOutcome {
        atomic: plan.atomic,
        warnings,
        ..Default::default()
    };
    let mut runner = Runner {
        target,
        dialect: d,
        pool: pool.clone(),
        adapter: target_adapter,
        session: None,
        journal: Vec::new(),
        created_schemas: Vec::new(),
    };
    let tables = plan.tables.len();
    let emit = |phase: &'static str, table: Option<String>, index: usize, rows: u64, total: u64| {
        progress(Progress {
            phase,
            table,
            table_index: index,
            tables,
            rows,
            total_rows: total,
        })
    };
    let result: Result<(), String> = async {
        if plan.atomic {
            let mut session = runner.table_session().await?;
            match d {
                Dialect::Postgres => {
                    session
                        .execute("SET LOCAL check_function_bodies = false")
                        .await?;
                }
                Dialect::Sqlite => {
                    session.execute("PRAGMA defer_foreign_keys = ON").await?;
                }
                _ => {}
            }
            runner.session = Some(session);
        }
        emit("pre", None, 0, 0, 0);
        for schema in &plan.create_schemas {
            runner
                .exec(&Statement::plain(create_schema_sql(d, schema)))
                .await?;
            if !plan.atomic {
                runner.created_schemas.push(schema.clone());
            }
        }
        for statement in plan.pre_data.iter().chain(&plan.before_load) {
            runner.exec(statement).await?;
        }
        let mut total = 0u64;
        for (index, table) in plan.tables.iter().enumerate() {
            let label = format!("{}.{}", table.target_schema, table.target_name);
            emit("data", Some(label.clone()), index, 0, total);
            let base = total;
            let mut report =
                |rows: u64| emit("data", Some(label.clone()), index, rows, base + rows);
            let rows = runner.load_table(&mut reader, table, &mut report).await?;
            total += rows;
            outcome.tables.push(TableResult {
                schema: table.target_schema.clone(),
                name: table.target_name.clone(),
                rows,
            });
        }
        outcome.rows = total;
        emit("post", None, tables, total, total);
        for statement in &plan.post_data {
            if super::execution::cancellation_token().is_cancelled() {
                return Err("Transfer vom Benutzer abgebrochen.".into());
            }
            runner.exec(statement).await?;
        }
        emit("finalize", None, tables, total, total);
        for statement in &plan.finalize {
            runner.exec(statement).await?;
        }
        runner
            .sync_sequences(source.as_ref(), plan, &mut outcome.warnings)
            .await?;
        Ok(())
    }
    .await;
    reader.close().await;
    match result {
        Ok(()) => {
            if let Some(mut session) = runner.session.take() {
                if let Err(error) = session.commit().await {
                    outcome.error = Some(format!(
                        "Commit nicht bestätigt: {error}. Zielzustand vor erneutem Transfer prüfen."
                    ));
                    return Ok(outcome);
                }
            }
            outcome.committed = true;
        }
        Err(error) => {
            outcome.error = Some(error);
            outcome.tables.clear();
            outcome.rows = 0;
            if plan.atomic {
                if let Some(mut session) = runner.session.take() {
                    if let Err(error) = session.rollback().await {
                        let aborted_by_server = d == Dialect::Mssql && error.contains("3903");
                        if !aborted_by_server {
                            outcome
                                .leftovers
                                .push(format!("Rollback nicht bestätigt: {error}"));
                        }
                    }
                }
                outcome.rolled_back = outcome.leftovers.is_empty();
            } else {
                outcome.leftovers = runner.compensate().await;
                outcome.rolled_back = outcome.leftovers.is_empty();
            }
        }
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn plan_transfer(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    request: PlanRequest,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<TransferPlan, String> {
    let target = Endpoint {
        kind,
        connection_string,
        database,
    };
    plan(&target, &request, pool_state.inner().clone()).await
}

#[tauri::command]
pub async fn run_transfer(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    request: RunRequest,
    app: tauri::AppHandle,
    options: Option<super::execution::ExecutionOptions>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<TransferOutcome, String> {
    use tauri::Emitter;
    let job_id = options.as_ref().and_then(|options| options.job_id.clone());
    let target = Endpoint {
        kind,
        connection_string,
        database,
    };
    let emit = move |progress: Progress| {
        let _ = app.emit(
            "transfer-progress",
            serde_json::json!({ "jobId": job_id, "progress": progress }),
        );
    };
    super::execution::run(
        options,
        true,
        run(&target, &request, pool_state.inner().clone(), &emit),
    )
    .await
}

#[cfg(test)]
#[path = "transfer_tests.rs"]
mod tests;
