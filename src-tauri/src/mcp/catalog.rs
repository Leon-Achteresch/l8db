use super::insight::Edge;
use super::redact::{Redactor, SchemaIndex};
use crate::db::ColumnInfo;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const INDEX_SLOTS: usize = 4;
const MIN_TTL: Duration = Duration::from_secs(600);
const MAX_TTL: Duration = Duration::from_secs(6 * 3600);
const SOURCE_SLOTS: usize = 32;
const SOURCE_BYTES: usize = 8 << 20;

pub(crate) struct Catalog {
    pub(crate) at: Instant,
    pub(crate) taken: i64,
    pub(crate) ms: u64,
    pub(crate) live: bool,
    pub(crate) key: Option<String>,
    pub(crate) columns: Arc<Vec<ColumnInfo>>,
    tables: OnceLock<Tables>,
    indexes: Mutex<Vec<(String, Arc<SchemaIndex>)>>,
    extra: Mutex<Extra>,
}

#[derive(Default)]
struct Extra {
    objects: Option<Arc<Objects>>,
    keys: Option<Arc<Keys>>,
    sources: VecDeque<(String, Arc<str>)>,
    source_bytes: usize,
    complete: bool,
    file: Option<SystemTime>,
    dirty: bool,
    listed: Option<Option<Arc<Vec<String>>>>,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
pub(crate) enum Kind {
    #[serde(rename = "T")]
    Table,
    #[serde(rename = "V")]
    View,
    #[serde(rename = "M")]
    Matview,
    #[serde(rename = "FT")]
    Foreign,
    #[serde(rename = "PT")]
    Partitioned,
    #[serde(rename = "F")]
    Function,
    #[serde(rename = "P")]
    Procedure,
    #[serde(rename = "Trg")]
    Trigger,
}

impl Kind {
    pub fn code(self) -> &'static str {
        match self {
            Kind::Table | Kind::Foreign | Kind::Partitioned => "T",
            Kind::View => "V",
            Kind::Matview => "M",
            Kind::Function => "F",
            Kind::Procedure => "P",
            Kind::Trigger => "Trg",
        }
    }

    pub fn word(self) -> &'static str {
        match self {
            Kind::Table => "table",
            Kind::View => "view",
            Kind::Matview => "materialized view",
            Kind::Foreign => "foreign table",
            Kind::Partitioned => "partitioned table",
            Kind::Function => "function",
            Kind::Procedure => "procedure",
            Kind::Trigger => "trigger",
        }
    }

    pub fn relation(self) -> bool {
        !matches!(self, Kind::Function | Kind::Procedure | Kind::Trigger)
    }

    pub fn filter(text: &str) -> Result<Vec<Kind>, String> {
        let mut kinds = Vec::new();
        for word in text
            .split(|c: char| c == ',' || c.is_whitespace())
            .filter(|word| !word.is_empty())
        {
            kinds.extend_from_slice(match word.to_ascii_lowercase().as_str() {
                "t" | "table" | "tables" => &[Kind::Table, Kind::Foreign, Kind::Partitioned][..],
                "v" | "view" | "views" => &[Kind::View],
                "m" | "matview" | "matviews" | "materialized" => &[Kind::Matview],
                "f" | "function" | "functions" => &[Kind::Function],
                "p" | "procedure" | "procedures" => &[Kind::Procedure],
                "routine" | "routines" => &[Kind::Function, Kind::Procedure],
                "trg" | "trigger" | "triggers" => &[Kind::Trigger],
                other => {
                    return Err(format!(
                        "kind '{other}' unbekannt. Erlaubt: T, V, M, F, P, Trg (kommagetrennt)."
                    ))
                }
            });
        }
        Ok(kinds)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Relation {
    #[serde(rename = "s")]
    pub schema: String,
    #[serde(rename = "n")]
    pub name: String,
    #[serde(rename = "k")]
    pub kind: Kind,
    #[serde(rename = "r", default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<i64>,
    #[serde(rename = "b", default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<i64>,
    #[serde(rename = "c", default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Routine {
    #[serde(rename = "s")]
    pub schema: String,
    #[serde(rename = "n")]
    pub name: String,
    #[serde(rename = "k")]
    pub kind: Kind,
    #[serde(rename = "a", default)]
    pub args: String,
    #[serde(rename = "r", default)]
    pub returns: String,
    #[serde(rename = "l", default)]
    pub language: String,
    #[serde(rename = "i", default)]
    pub id: String,
    #[serde(rename = "c", default, skip_serializing_if = "Option::is_none")]
    pub lines: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Trigger {
    #[serde(rename = "s")]
    pub schema: String,
    #[serde(rename = "n")]
    pub name: String,
    #[serde(rename = "t")]
    pub table: String,
    #[serde(rename = "f", default)]
    pub routine: String,
}

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Objects {
    pub taken: i64,
    pub ms: u64,
    #[serde(default)]
    pub relations: Vec<Relation>,
    #[serde(default)]
    pub routines: Vec<Routine>,
    #[serde(default)]
    pub triggers: Vec<Trigger>,
    #[serde(skip)]
    pub(crate) names: OnceLock<Vec<Name>>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Keys {
    pub taken: i64,
    pub ms: u64,
    pub edges: Vec<Edge>,
}

pub(crate) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

pub(crate) fn ttl(ms: u64) -> Duration {
    Duration::from_millis(ms)
        .saturating_mul(600)
        .clamp(MIN_TTL, MAX_TTL)
}

pub(crate) fn fresh(taken: i64, ms: u64) -> bool {
    ((now() - taken).max(0) as u64) < ttl(ms).as_secs()
}

pub(crate) fn stamp(taken: i64) -> String {
    use chrono::TimeZone;
    let Some(at) = chrono::Local.timestamp_opt(taken, 0).single() else {
        return String::new();
    };
    if at.date_naive() == chrono::Local::now().date_naive() {
        at.format("%H:%M").to_string()
    } else {
        at.format("%Y-%m-%d %H:%M").to_string()
    }
}

impl Objects {
    pub fn sort(&mut self) {
        self.relations
            .sort_by(|a, b| (&a.schema, &a.name).cmp(&(&b.schema, &b.name)));
        self.relations
            .dedup_by(|a, b| a.schema == b.schema && a.name == b.name);
        self.routines
            .sort_by(|a, b| (&a.schema, &a.name, &a.args).cmp(&(&b.schema, &b.name, &b.args)));
        self.triggers
            .sort_by(|a, b| (&a.schema, &a.table, &a.name).cmp(&(&b.schema, &b.table, &b.name)));
    }

    pub fn relation(&self, schema: &str, name: &str) -> Option<&Relation> {
        self.relations
            .binary_search_by(|entry| {
                (entry.schema.as_str(), entry.name.as_str()).cmp(&(schema, name))
            })
            .ok()
            .map(|index| &self.relations[index])
    }

    pub fn fresh(&self) -> bool {
        fresh(self.taken, self.ms)
    }

    pub fn names(&self) -> &[Name] {
        self.names.get_or_init(|| {
            self.relations
                .iter()
                .map(|entry| Name::new(&entry.name))
                .chain(self.routines.iter().map(|entry| Name::new(&entry.name)))
                .chain(self.triggers.iter().map(|entry| Name::new(&entry.name)))
                .collect()
        })
    }

    #[cfg(test)]
    pub fn retained_bytes(&self) -> usize {
        use std::mem::size_of;
        self.relations
            .iter()
            .map(|entry| {
                size_of::<Relation>()
                    + entry.schema.capacity()
                    + entry.name.capacity()
                    + entry.comment.as_ref().map_or(0, String::capacity)
            })
            .sum::<usize>()
            + self
                .routines
                .iter()
                .map(|entry| {
                    size_of::<Routine>()
                        + entry.schema.capacity()
                        + entry.name.capacity()
                        + entry.args.capacity()
                        + entry.returns.capacity()
                        + entry.language.capacity()
                        + entry.id.capacity()
                })
                .sum::<usize>()
            + self
                .triggers
                .iter()
                .map(|entry| {
                    size_of::<Trigger>()
                        + entry.schema.capacity()
                        + entry.name.capacity()
                        + entry.table.capacity()
                        + entry.routine.capacity()
                })
                .sum::<usize>()
            + self.names.get().map_or(0, |names| {
                names
                    .iter()
                    .map(|name| {
                        size_of::<Name>()
                            + name.original.capacity()
                            + name.lower.capacity()
                            + name.words.capacity()
                    })
                    .sum()
            })
    }
}

pub(crate) struct Name {
    pub original: String,
    pub lower: String,
    pub words: String,
}

pub(crate) struct Table {
    pub schema: u32,
    pub name: u32,
    pub columns: Vec<u32>,
}

pub(crate) struct Tables {
    pub list: Vec<Table>,
    pub schemas: Vec<Name>,
    pub family: Vec<u32>,
    pub table_names: Vec<Name>,
    pub column_names: Vec<Name>,
    pub column_name: Vec<u32>,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Hit {
    None,
    Contains,
    WordStart,
    Prefix,
    Exact,
}

pub(crate) fn words(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut previous: Option<char> = None;
    for c in name.chars() {
        if !c.is_alphanumeric() {
            previous = None;
            if !out.is_empty() && !out.ends_with('_') {
                out.push('_');
            }
            continue;
        }
        if let Some(p) = previous {
            let split = (p.is_lowercase() && c.is_uppercase())
                || (p.is_alphabetic() && c.is_numeric())
                || (p.is_numeric() && c.is_alphabetic());
            if split && !out.ends_with('_') {
                out.push('_');
            }
        }
        out.extend(c.to_lowercase());
        previous = Some(c);
    }
    while out.ends_with('_') {
        out.pop();
    }
    out
}

impl Name {
    pub fn new(original: &str) -> Self {
        Self {
            original: original.to_string(),
            lower: original.to_lowercase(),
            words: words(original),
        }
    }

    pub fn hit(&self, needle: &Name) -> Hit {
        if needle.words.is_empty() {
            return if self.lower.contains(&needle.lower) {
                Hit::Contains
            } else {
                Hit::None
            };
        }
        if self.words == needle.words || self.lower == needle.lower {
            Hit::Exact
        } else if self.words.starts_with(&needle.words) {
            Hit::Prefix
        } else if self
            .words
            .match_indices(&needle.words)
            .any(|(at, _)| self.words.as_bytes()[at - 1] == b'_')
        {
            Hit::WordStart
        } else if self.lower.contains(&needle.lower) || self.words.contains(&needle.words) {
            Hit::Contains
        } else {
            Hit::None
        }
    }
}

fn dictionary<'a>(names: &mut Vec<Name>, seen: &mut HashMap<&'a str, u32>, name: &'a str) -> u32 {
    *seen.entry(name).or_insert_with(|| {
        names.push(Name::new(name));
        (names.len() - 1) as u32
    })
}

impl Tables {
    fn build(columns: &[ColumnInfo]) -> Self {
        let mut grouped: HashMap<(&str, &str), Vec<u32>> = HashMap::new();
        let mut run: Option<((&str, &str), Vec<u32>)> = None;
        let mut column_names = Vec::new();
        let mut seen = HashMap::new();
        let mut column_name = Vec::with_capacity(columns.len());
        for (index, column) in columns.iter().enumerate() {
            let key = (column.schema.as_str(), column.table.as_str());
            match &mut run {
                Some((current, list)) if *current == key => list.push(index as u32),
                _ => {
                    if let Some((done, list)) = run.replace((key, vec![index as u32])) {
                        grouped.entry(done).or_default().extend(list);
                    }
                }
            }
            column_name.push(dictionary(&mut column_names, &mut seen, &column.name));
        }
        if let Some((done, list)) = run {
            grouped.entry(done).or_default().extend(list);
        }
        let mut keys: Vec<_> = grouped.into_iter().collect();
        keys.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        let mut schemas = Vec::new();
        let mut schema_ids = HashMap::new();
        let mut table_names = Vec::new();
        let mut table_ids = HashMap::new();
        let list: Vec<Table> = keys
            .into_iter()
            .map(|((schema, table), columns)| Table {
                schema: dictionary(&mut schemas, &mut schema_ids, schema),
                name: dictionary(&mut table_names, &mut table_ids, table),
                columns,
            })
            .collect();
        let mut shapes: Vec<Vec<(u32, u64)>> = vec![Vec::new(); schemas.len()];
        for table in &list {
            let mut hasher = DefaultHasher::new();
            for &index in &table.columns {
                column_name[index as usize].hash(&mut hasher);
                columns[index as usize].data_type.hash(&mut hasher);
            }
            shapes[table.schema as usize].push((table.name, hasher.finish()));
        }
        let mut families: HashMap<&[(u32, u64)], u32> = HashMap::new();
        let family = shapes
            .iter()
            .enumerate()
            .map(|(index, shape)| *families.entry(shape.as_slice()).or_insert(index as u32))
            .collect();
        Self {
            list,
            schemas,
            family,
            table_names,
            column_names,
            column_name,
        }
    }

    pub fn schema(&self, table: &Table) -> &str {
        &self.schemas[table.schema as usize].original
    }

    pub fn name(&self, table: &Table) -> &str {
        &self.table_names[table.name as usize].original
    }

    pub fn qualified(&self, table: &Table) -> String {
        super::server::qualified(self.schema(table), self.name(table))
    }

    pub fn visible(&self, table: &Table, allowed: &[String]) -> bool {
        allowed.is_empty() || allowed.iter().any(|schema| *schema == self.schema(table))
    }

    pub fn find(&self, schema: &str, name: &str) -> Option<usize> {
        self.list
            .binary_search_by(|table| (self.schema(table), self.name(table)).cmp(&(schema, name)))
            .ok()
    }
}

pub(crate) fn allowed(schema: &str, allowed: &[String]) -> bool {
    allowed.is_empty() || allowed.iter().any(|entry| entry == schema)
}

impl Catalog {
    #[cfg(test)]
    pub(crate) fn new(columns: Arc<Vec<ColumnInfo>>) -> Self {
        Self::loaded(columns, 0)
    }

    pub(crate) fn loaded(columns: Arc<Vec<ColumnInfo>>, ms: u64) -> Self {
        Self {
            at: Instant::now(),
            taken: now(),
            ms,
            live: true,
            key: None,
            columns,
            tables: OnceLock::new(),
            indexes: Mutex::new(Vec::new()),
            extra: Mutex::new(Extra::default()),
        }
    }

    pub(crate) fn restored(columns: Vec<ColumnInfo>, taken: i64, ms: u64, key: String) -> Self {
        let age = Duration::from_secs((now() - taken).max(0) as u64);
        Self {
            at: Instant::now().checked_sub(age).unwrap_or_else(Instant::now),
            taken,
            live: false,
            key: Some(key),
            ..Self::loaded(Arc::new(columns), ms)
        }
    }

    pub(crate) fn fresh(&self) -> bool {
        self.at.elapsed() < ttl(self.ms)
    }

    fn extra(&self) -> std::sync::MutexGuard<'_, Extra> {
        self.extra.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn stamp(&self) -> String {
        let objects = self.objects().map_or(self.taken, |objects| objects.taken);
        stamp(self.taken.min(objects))
    }

    pub(crate) fn objects(&self) -> Option<Arc<Objects>> {
        self.extra().objects.clone()
    }

    pub(crate) fn set_objects(&self, objects: Objects, dirty: bool) -> Arc<Objects> {
        let objects = Arc::new(objects);
        let mut extra = self.extra();
        extra.objects = Some(objects.clone());
        extra.dirty |= dirty;
        objects
    }

    pub(crate) fn keys(&self) -> Option<Arc<Keys>> {
        self.extra().keys.clone()
    }

    pub(crate) fn set_keys(&self, keys: Keys) -> Arc<Keys> {
        let keys = Arc::new(keys);
        let mut extra = self.extra();
        extra.keys = Some(keys.clone());
        extra.dirty = true;
        keys
    }

    pub(crate) fn source(&self, key: &str) -> Option<Arc<str>> {
        let mut extra = self.extra();
        let position = extra.sources.iter().position(|(slot, _)| slot == key)?;
        let entry = extra.sources.remove(position)?;
        extra.sources.push_back(entry.clone());
        Some(entry.1)
    }

    pub(crate) fn remember_source(&self, key: &str, text: Arc<str>) {
        let mut extra = self.extra();
        if let Some(position) = extra.sources.iter().position(|(slot, _)| slot == key) {
            if let Some((_, old)) = extra.sources.remove(position) {
                extra.source_bytes -= old.len();
            }
        }
        extra.source_bytes += text.len();
        extra.sources.push_back((key.to_string(), text));
        while extra.sources.len() > 1
            && (extra.sources.len() > SOURCE_SLOTS || extra.source_bytes > SOURCE_BYTES)
        {
            if let Some((_, old)) = extra.sources.pop_front() {
                extra.source_bytes -= old.len();
            }
        }
    }

    pub(crate) fn sources(&self) -> (Vec<(String, Arc<str>)>, bool) {
        let extra = self.extra();
        (extra.sources.iter().cloned().collect(), extra.complete)
    }

    #[cfg(test)]
    pub(crate) fn preload_sources(&self, sources: Vec<(String, Arc<str>)>) {
        let mut extra = self.extra();
        extra.source_bytes = sources.iter().map(|(_, text)| text.len()).sum();
        extra.sources = sources.into();
        extra.complete = true;
    }

    pub(crate) fn file(&self) -> Option<SystemTime> {
        self.extra().file
    }

    pub(crate) fn saved(&self, file: Option<SystemTime>) {
        let mut extra = self.extra();
        extra.file = file;
        extra.dirty = false;
    }

    pub(crate) fn dirty(&self) -> bool {
        self.extra().dirty
    }

    pub(crate) fn mark_dirty(&self) {
        self.extra().dirty = true;
    }

    pub(crate) fn adopt(&self, old: &Catalog) {
        if self.key != old.key {
            return;
        }
        let previous = old.extra();
        let mut extra = self.extra();
        extra.objects = previous.objects.clone();
        extra.keys = previous.keys.clone();
        extra.file = previous.file;
    }

    pub(crate) fn keyed(mut self, key: String) -> Self {
        self.key = Some(key);
        self
    }

    pub(crate) fn listed(&self) -> Option<Option<Arc<Vec<String>>>> {
        self.extra().listed.clone()
    }

    pub(crate) fn set_listed(&self, listed: Option<Vec<String>>) {
        self.extra().listed = Some(listed.map(Arc::new));
    }

    pub(crate) fn tables(&self) -> &Tables {
        self.tables.get_or_init(|| Tables::build(&self.columns))
    }

    pub(crate) fn index(&self, redactor: &Redactor, allowed: &[String]) -> Arc<SchemaIndex> {
        let key = format!("{}\u{0}{}", redactor.column_key(), allowed.join("\u{0}"));
        let mut slots = self.indexes.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, index)) = slots.iter().find(|(slot, _)| *slot == key) {
            return index.clone();
        }
        let tables = self.tables();
        let index = Arc::new(SchemaIndex::from_parts(
            tables
                .column_names
                .iter()
                .map(|name| name.original.as_str()),
            tables
                .list
                .iter()
                .map(|table| (tables.schema(table), tables.name(table))),
            redactor,
            allowed,
        ));
        if slots.len() >= INDEX_SLOTS {
            slots.remove(0);
        }
        slots.push((key, index.clone()));
        index
    }

    #[cfg(test)]
    pub(crate) fn retained_bytes(&self) -> usize {
        use std::mem::size_of;
        let names = |list: &[Name]| -> usize {
            list.iter()
                .map(|name| {
                    size_of::<Name>()
                        + name.original.capacity()
                        + name.lower.capacity()
                        + name.words.capacity()
                })
                .sum()
        };
        let tables = self.tables();
        tables
            .list
            .iter()
            .map(|table| size_of::<Table>() + table.columns.capacity() * 4)
            .sum::<usize>()
            + names(&tables.schemas)
            + names(&tables.table_names)
            + names(&tables.column_names)
            + tables.column_name.capacity() * 4
            + tables.family.capacity() * 4
    }

    #[cfg(test)]
    pub(crate) fn index_slots(&self) -> usize {
        self.indexes.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column(schema: &str, table: &str, name: &str) -> ColumnInfo {
        ColumnInfo {
            schema: schema.into(),
            table: table.into(),
            name: name.into(),
            data_type: "int".into(),
        }
    }

    #[test]
    fn reloads_adopt_objects_only_under_the_same_key_and_drop_sources() {
        let columns = Arc::new(vec![column("public", "orders", "id")]);
        let old = Catalog::loaded(columns.clone(), 1).keyed("a".into());
        old.set_objects(Objects::default(), true);
        old.remember_source("V\u{1f}public\u{1f}v", Arc::from("SELECT 1"));
        let same = Catalog::loaded(columns.clone(), 1).keyed("a".into());
        same.adopt(&old);
        assert!(same.objects().is_some() && same.source("V\u{1f}public\u{1f}v").is_none());
        let changed = Catalog::loaded(columns, 1).keyed("b".into());
        changed.adopt(&old);
        assert!(changed.objects().is_none());
    }

    #[test]
    fn names_split_at_underscores_camel_case_and_digits() {
        assert_eq!(words("customerId"), "customer_id");
        assert_eq!(words("Order__Items2024"), "order_items_2024");
        assert_eq!(words("fact_orders_daily_r01"), "fact_orders_daily_r_01");
        assert_eq!(words("HTTPServer"), "httpserver");
        let name = Name::new("invoiceLines");
        assert_eq!(name.hit(&Name::new("invoice_lines")), Hit::Exact);
        assert_eq!(name.hit(&Name::new("invoice")), Hit::Prefix);
        assert_eq!(name.hit(&Name::new("lines")), Hit::WordStart);
        assert_eq!(name.hit(&Name::new("voice")), Hit::Contains);
        assert_eq!(name.hit(&Name::new("order")), Hit::None);
        assert_eq!(Name::new("a.b").hit(&Name::new(".")), Hit::Contains);
    }

    #[test]
    fn identical_schemas_share_a_family_and_tables_keep_column_order() {
        let mut columns = Vec::new();
        for schema in ["tenant_a", "tenant_b", "other"] {
            columns.push(column(schema, "orders", "id"));
            columns.push(column(schema, "orders", "tenant_id"));
        }
        columns.push(column("other", "extra", "id"));
        columns.push(column("tenant_a", "orders", "z_last"));
        columns.push(column("tenant_b", "orders", "z_last"));
        let catalog = Catalog::new(Arc::new(columns));
        let tables = catalog.tables();
        let names: Vec<String> = tables.list.iter().map(|t| tables.qualified(t)).collect();
        assert_eq!(
            names,
            [
                "other.extra",
                "other.orders",
                "tenant_a.orders",
                "tenant_b.orders"
            ]
        );
        let order: Vec<&str> = tables.list[2]
            .columns
            .iter()
            .map(|&index| catalog.columns[index as usize].name.as_str())
            .collect();
        assert_eq!(order, ["id", "tenant_id", "z_last"]);
        let family = |schema: &str| {
            let index = tables
                .schemas
                .iter()
                .position(|s| s.original == schema)
                .unwrap();
            tables.family[index]
        };
        assert_eq!(family("tenant_a"), family("tenant_b"));
        assert_ne!(family("tenant_a"), family("other"));
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    fn aged(columns: Vec<ColumnInfo>, seconds: u64) -> Arc<Catalog> {
        let mut catalog = Catalog::new(Arc::new(columns));
        catalog.at = Instant::now()
            .checked_sub(std::time::Duration::from_secs(seconds))
            .unwrap();
        Arc::new(catalog)
    }

    #[test]
    fn checks_reload_catalogs_older_than_a_minute_but_search_keeps_them() {
        let (_dir, config, connection, mut server) = super::super::sandbox::sqlite_fixture(
            "CREATE TABLE t(id INTEGER, api_key TEXT); INSERT INTO t VALUES (1, 'k');",
        );
        let key = super::super::server::cache_key(&connection);
        let known = || vec![column("main", "t", "id")];
        let redactor = Redactor::new(&config.redaction, &connection.sensitive_columns());
        let runtime = runtime();
        let check = |server: &mut super::super::server::Server, sql: &str| {
            let index = runtime
                .block_on(server.schema_index(&config, &connection, &redactor))
                .unwrap();
            super::super::server::check_read_sql(sql, &connection, &index)
        };
        let fresh = aged(known(), 30);
        server.columns.insert(key.clone(), fresh.clone());
        assert!(check(&mut server, "SELECT id FROM t").is_ok());
        assert!(Arc::ptr_eq(&server.columns[&key], &fresh));
        let stale = aged(known(), 61);
        server.columns.insert(key.clone(), stale.clone());
        assert!(check(&mut server, "SELECT id FROM t").is_ok());
        assert!(!Arc::ptr_eq(&server.columns[&key], &stale));
        let error = check(&mut server, "SELECT api_key AS k FROM t").unwrap_err();
        assert!(error.contains("redigiert"), "{error}");
        let listed = aged(known(), 61);
        server.columns.insert(key.clone(), listed.clone());
        let reply = runtime.block_on(server.call_with_config(
            &serde_json::json!({"name": "search", "arguments": {"connection": connection.name, "term": "t"}}),
            &config,
        ));
        assert_eq!(reply["isError"], false, "{reply}");
        assert!(Arc::ptr_eq(&server.columns[&key], &listed));
    }

    #[test]
    fn writes_and_refresh_invalidate_the_cached_catalog() {
        let _guard = crate::mcp::TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let (dir, config, connection, mut server) =
            super::super::sandbox::sqlite_fixture("CREATE TABLE t(id INTEGER);");
        std::env::set_var("L8DB_MCP_CONFIG", dir.path().join("mcp.json"));
        let runtime = runtime();
        let call =
            |server: &mut super::super::server::Server, name: &str, args: serde_json::Value| {
                let reply = runtime.block_on(server.call_with_config(
                    &serde_json::json!({"name": name, "arguments": args}),
                    &config,
                ));
                reply["content"][0]["text"].as_str().unwrap().to_string()
            };
        assert!(
            call(&mut server, "search", serde_json::json!({"term": "fresh"}))
                .starts_with("No tables")
        );
        let key = super::super::server::cache_key(&connection);
        let first = server.columns[&key].clone();
        for _ in 0..3 {
            call(&mut server, "search", serde_json::json!({"term": "t"}));
            call(
                &mut server,
                "describe",
                serde_json::json!({"table": "t", "details": false}),
            );
            call(
                &mut server,
                "query",
                serde_json::json!({"sql": "SELECT id FROM t"}),
            );
        }
        assert!(Arc::ptr_eq(&server.columns[&key], &first));
        let done = call(
            &mut server,
            "execute",
            serde_json::json!({"sql": "CREATE TABLE fresh(id INTEGER)", "confirm": true}),
        );
        assert!(done.starts_with("ok"), "{done}");
        assert!(
            call(&mut server, "search", serde_json::json!({"term": "fresh"}))
                .contains("main.fresh")
        );
        rusqlite::Connection::open(dir.path().join("fixture.db"))
            .unwrap()
            .execute_batch("CREATE TABLE outside(id INTEGER)")
            .unwrap();
        assert!(call(
            &mut server,
            "search",
            serde_json::json!({"term": "outside"})
        )
        .starts_with("No tables"));
        assert!(call(
            &mut server,
            "search",
            serde_json::json!({"term": "outside", "refresh": true})
        )
        .contains("main.outside"));
        std::env::remove_var("L8DB_MCP_CONFIG");
    }
}
