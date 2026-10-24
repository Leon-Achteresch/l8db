use super::catalog::{allowed, Catalog, Hit, Kind, Name, Objects, Relation, Routine, Tables};
use super::insight::{flat, rows};
use super::redact::Redactor;
use super::server::{arg_str, cap, qualified};
use crate::ai::knowledge::Knowledge;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

const SHOWN_HITS: usize = 6;
const NOTE_CHARS: usize = 80;
const SHOWN_COLUMNS: usize = 40;
const WIDE_COLUMNS: usize = 60;

pub(super) struct Note {
    pub description: String,
    pub columns: HashMap<String, String>,
    lower: String,
}

#[derive(Default)]
pub(super) struct Notes {
    tables: HashMap<String, Note>,
    pub glossary: Vec<(String, String)>,
}

impl Notes {
    pub fn new(knowledge: Knowledge, redactor: &Redactor) -> Self {
        let tables = knowledge
            .tables
            .into_iter()
            .map(|(key, note)| {
                let description = redactor.redact_text(note.description.trim());
                let columns: HashMap<String, String> = note
                    .columns
                    .into_iter()
                    .filter(|(_, text)| !text.trim().is_empty())
                    .map(|(column, text)| {
                        (column.to_lowercase(), redactor.redact_text(text.trim()))
                    })
                    .collect();
                let mut lower = description.to_lowercase();
                for text in columns.values() {
                    lower.push('\n');
                    lower.push_str(&text.to_lowercase());
                }
                (
                    key.trim().to_lowercase(),
                    Note {
                        description,
                        columns,
                        lower,
                    },
                )
            })
            .collect();
        let glossary = knowledge
            .glossary
            .into_iter()
            .map(|term| {
                (
                    redactor.redact_text(&term.term),
                    redactor.redact_text(&term.meaning),
                )
            })
            .collect();
        Self { tables, glossary }
    }

    pub fn table(&self, schema: &str, name: &str) -> Option<&Note> {
        if self.tables.is_empty() {
            return None;
        }
        self.tables
            .get(&qualified(schema, name).to_lowercase())
            .or_else(|| self.tables.get(&name.to_lowercase()))
    }
}

impl Note {
    pub fn column(&self, name: &str) -> Option<&str> {
        self.columns.get(&name.to_lowercase()).map(String::as_str)
    }
}

pub(super) struct View<'a> {
    pub catalog: &'a Catalog,
    pub objects: Option<Arc<Objects>>,
    pub notes: Notes,
    pub allowed: &'a [String],
    hidden: HashSet<String>,
    strict: bool,
}

pub(super) fn qualifiers(text: &str) -> Vec<(usize, usize, String)> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let word = |c: char| c.is_alphanumeric() || matches!(c, '_' | '$' | '#');
    let ident = |start: usize| -> Option<(usize, String)> {
        let (_, first) = *chars.get(start)?;
        let close = match first {
            '"' => Some('"'),
            '`' => Some('`'),
            '[' => Some(']'),
            _ => None,
        };
        if let Some(close) = close {
            let end = (start + 1..chars.len()).find(|&index| chars[index].1 == close)?;
            return Some((
                end + 1,
                chars[start + 1..end].iter().map(|(_, c)| c).collect(),
            ));
        }
        if !word(first) || first.is_ascii_digit() {
            return None;
        }
        let end = (start..chars.len())
            .find(|&index| !word(chars[index].1))
            .unwrap_or(chars.len());
        Some((end, chars[start..end].iter().map(|(_, c)| c).collect()))
    };
    let byte = |index: usize| chars.get(index).map_or(text.len(), |(at, _)| *at);
    let mut out = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if index > 0 && word(chars[index - 1].1) && word(chars[index].1) {
            index += 1;
            continue;
        }
        let Some((end, name)) = ident(index) else {
            index += 1;
            continue;
        };
        if chars.get(end).is_some_and(|(_, c)| *c == '.') {
            if let Some((after, _)) = ident(end + 1) {
                out.push((byte(index), byte(after), name));
                index = end + 1;
                continue;
            }
        }
        index = end.max(index + 1);
    }
    out
}

pub(super) fn mask_hidden(text: &str, allowed: &[String]) -> String {
    if allowed.is_empty() {
        return text.to_string();
    }
    let mut out = String::new();
    let mut last = 0;
    for (start, end, schema) in qualifiers(text) {
        if start < last || super::catalog::allowed(&schema, allowed) {
            continue;
        }
        out.push_str(&text[last..start]);
        out.push_str("[hidden]");
        last = end;
    }
    out.push_str(&text[last..]);
    out
}

impl<'a> View<'a> {
    pub fn new(catalog: &'a Catalog, allowed: &'a [String]) -> Self {
        Self::with(catalog, allowed, None, Notes::default())
    }

    pub fn with(
        catalog: &'a Catalog,
        allowed: &'a [String],
        objects: Option<Arc<Objects>>,
        notes: Notes,
    ) -> Self {
        let mut hidden = HashSet::new();
        let mut strict = false;
        if !allowed.is_empty() {
            let listed = catalog.listed();
            strict = listed.as_ref().is_some_and(|listed| listed.is_none());
            let tables = catalog.tables();
            let mut last = String::new();
            let mut add = |schema: &str| {
                if schema == last {
                    return;
                }
                last = schema.to_string();
                if !schema.is_empty() && !super::catalog::allowed(schema, allowed) {
                    hidden.insert(schema.to_lowercase());
                }
            };
            tables.schemas.iter().for_each(|name| add(&name.original));
            if let Some(objects) = &objects {
                objects
                    .relations
                    .iter()
                    .for_each(|entry| add(&entry.schema));
                objects.routines.iter().for_each(|entry| add(&entry.schema));
            }
            if let Some(Some(listed)) = &listed {
                listed.iter().for_each(|schema| add(schema));
            }
        }
        Self {
            catalog,
            objects,
            notes,
            allowed,
            hidden,
            strict,
        }
    }

    pub fn stamp(&self) -> String {
        format!("catalog {}", self.catalog.stamp())
    }

    pub fn relation(&self, schema: &str, name: &str) -> Option<&Relation> {
        self.objects.as_ref()?.relation(schema, name)
    }

    pub fn kind(&self, schema: &str, name: &str) -> Kind {
        self.relation(schema, name)
            .map_or(Kind::Table, |entry| entry.kind)
    }

    pub fn hides(&self, line: &str) -> bool {
        if self.allowed.is_empty() {
            return false;
        }
        qualifiers(line).iter().any(|(_, _, schema)| {
            let lower = schema.to_lowercase();
            self.hidden.contains(&lower)
                || (self.strict
                    && !self
                        .allowed
                        .iter()
                        .any(|entry| entry.to_lowercase() == lower))
        })
    }

    pub fn note(&self, schema: &str, name: &str) -> Option<String> {
        let knowledge = self
            .notes
            .table(schema, name)
            .map(|note| note.description.as_str())
            .filter(|text| !text.is_empty());
        let comment = self
            .relation(schema, name)
            .and_then(|entry| entry.comment.as_deref());
        knowledge.or(comment).map(|text| flat(text, NOTE_CHARS))
    }
}

struct Needle {
    table: Name,
    schema: Option<Name>,
}

struct Hits {
    tables: Vec<Hit>,
    columns: Vec<Hit>,
    schemas: Vec<Hit>,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Target {
    Table(usize),
    Relation(usize),
    Routine(usize),
    Trigger(usize),
}

struct Entry {
    target: Target,
    tier: u8,
    score: u32,
    by_schema: bool,
    members: Vec<u32>,
}

fn needles(term: &str) -> Vec<Needle> {
    term.split_whitespace()
        .filter_map(|word| {
            let needle = match word.rsplit_once('.') {
                Some((schema, table)) if !schema.is_empty() && !table.is_empty() => Needle {
                    table: Name::new(table),
                    schema: Some(Name::new(schema)),
                },
                _ => Needle {
                    table: Name::new(word.trim_matches('.')),
                    schema: None,
                },
            };
            (!needle.table.lower.is_empty()).then_some(needle)
        })
        .collect()
}

fn hits(tables: &Tables, needle: &Needle) -> Hits {
    let all = |names: &[Name], wanted: &Name| -> Vec<Hit> {
        names.iter().map(|name| name.hit(wanted)).collect()
    };
    Hits {
        tables: all(&tables.table_names, &needle.table),
        columns: match needle.schema {
            Some(_) => Vec::new(),
            None => all(&tables.column_names, &needle.table),
        },
        schemas: all(
            &tables.schemas,
            needle.schema.as_ref().unwrap_or(&needle.table),
        ),
    }
}

fn table_weight(hit: Hit) -> u32 {
    match hit {
        Hit::Exact => 40,
        Hit::Prefix => 30,
        Hit::WordStart => 25,
        Hit::Contains => 15,
        Hit::None => 0,
    }
}

fn column_weight(hit: Hit) -> u32 {
    match hit {
        Hit::Exact => 12,
        Hit::Prefix => 9,
        Hit::WordStart => 8,
        Hit::Contains => 4,
        Hit::None => 0,
    }
}

fn full_name(needles: &[Needle], name: &Name) -> bool {
    let joined: Vec<&str> = needles
        .iter()
        .map(|needle| needle.table.words.as_str())
        .collect();
    !needles.is_empty() && joined.join("_") == name.words
}

fn score(
    tables: &Tables,
    index: usize,
    needles: &[Needle],
    hits: &[Hits],
    note: Option<&Note>,
) -> Option<Entry> {
    let table = &tables.list[index];
    let mut entry = Entry {
        target: Target::Table(index),
        tier: 4,
        score: 0,
        by_schema: false,
        members: Vec::new(),
    };
    for (needle, hits) in needles.iter().zip(hits) {
        let schema = hits.schemas[table.schema as usize];
        let named = match needle.schema {
            Some(_) if schema < Hit::Prefix => Hit::None,
            _ => hits.tables[table.name as usize],
        };
        let (tier, weight) = match named {
            Hit::None => {
                let column = match needle.schema {
                    Some(_) => Hit::None,
                    None => table
                        .columns
                        .iter()
                        .map(|&column| hits.columns[tables.column_name[column as usize] as usize])
                        .max()
                        .unwrap_or(Hit::None),
                };
                if column > Hit::None {
                    (2, column_weight(column))
                } else if needle.schema.is_none()
                    && note.is_some_and(|note| note.lower.contains(&needle.table.lower))
                {
                    (2, 6)
                } else if schema >= Hit::WordStart {
                    entry.by_schema = true;
                    (1, 2)
                } else {
                    return None;
                }
            }
            Hit::Contains => (3, table_weight(named)),
            _ => (4, table_weight(named)),
        };
        entry.tier = entry.tier.min(tier);
        entry.score += weight;
    }
    if entry.tier == 4 && full_name(needles, &tables.table_names[table.name as usize]) {
        entry.tier = 5;
    }
    Some(entry)
}

pub(super) fn schema_id(tables: &Tables, schema: &str) -> Option<usize> {
    tables
        .schemas
        .binary_search_by(|name| name.original.as_str().cmp(schema))
        .ok()
}

fn object_score(
    tables: &Tables,
    target: Target,
    name: &Name,
    schema: &str,
    text: Option<&str>,
    needles: &[Needle],
    hits: &[Hits],
) -> Option<Entry> {
    let schema = schema_id(tables, schema);
    let mut entry = Entry {
        target,
        tier: 4,
        score: 0,
        by_schema: false,
        members: Vec::new(),
    };
    for (needle, hits) in needles.iter().zip(hits) {
        let schema = schema.map_or(Hit::None, |id| hits.schemas[id]);
        let named = match needle.schema {
            Some(_) if schema < Hit::Prefix => Hit::None,
            _ => name.hit(&needle.table),
        };
        let (tier, weight) = match named {
            Hit::None if text.is_some_and(|text| text.contains(&needle.table.lower)) => (2, 6),
            Hit::None if schema >= Hit::WordStart => {
                entry.by_schema = true;
                (1, 2)
            }
            Hit::None => return None,
            Hit::Contains => (3, table_weight(named)),
            _ => (4, table_weight(named)),
        };
        entry.tier = entry.tier.min(tier);
        entry.score += weight;
    }
    if entry.tier == 4 && full_name(needles, name) {
        entry.tier = 5;
    }
    Some(entry)
}

fn family_sizes(tables: &Tables, allowed: &[String]) -> HashMap<u32, u32> {
    let mut sizes = HashMap::new();
    for (index, schema) in tables.schemas.iter().enumerate() {
        if allowed.is_empty() || allowed.contains(&schema.original) {
            *sizes.entry(tables.family[index]).or_insert(0) += 1;
        }
    }
    sizes
}

pub(super) fn members_text(tables: &Tables, members: &[u32]) -> String {
    let name = |index: &u32| tables.schemas[*index as usize].original.as_str();
    match members {
        [] | [_] => String::new(),
        [first, .., last] if members.len() > 4 => format!(
            " (same in {} schemas {}..{})",
            members.len(),
            name(first),
            name(last)
        ),
        _ => format!(
            " (same in {})",
            members.iter().map(name).collect::<Vec<_>>().join(", ")
        ),
    }
}

fn cols(count: usize) -> String {
    format!("{count} col{}", if count == 1 { "" } else { "s" })
}

fn signature(routine: &Routine) -> String {
    let mut text = format!(
        "{}({})",
        qualified(&routine.schema, &routine.name),
        flat(&routine.args, NOTE_CHARS)
    );
    if !routine.returns.is_empty() {
        text.push_str(&format!(" → {}", flat(&routine.returns, 40)));
    }
    text
}

fn table_line(
    view: &View,
    entry: &Entry,
    index: usize,
    needles: &[Needle],
    hits: &[Hits],
) -> (String, String) {
    let tables = view.catalog.tables();
    let table = &tables.list[index];
    let (schema, name) = (tables.schema(table), tables.name(table));
    let mut head = format!(
        "{} {}",
        view.kind(schema, name).code(),
        tables.qualified(table)
    );
    head.push_str(&members_text(tables, &entry.members));
    if entry.by_schema {
        head.push_str(" [schema]");
    }
    if let Some(count) = view
        .relation(schema, name)
        .and_then(|entry| entry.rows)
        .filter(|_| entry.members.len() < 2)
    {
        head.push_str(&format!(" ≈{} rows", count_text(count)));
    }
    let note = view.notes.table(schema, name);
    let tail = view
        .note(schema, name)
        .map(|text| format!(" — {text}"))
        .unwrap_or_default();
    let mut matching: Vec<(Hit, usize)> = table
        .columns
        .iter()
        .enumerate()
        .filter_map(|(position, &column)| {
            let id = tables.column_name[column as usize] as usize;
            let described = note
                .and_then(|note| note.column(&view.catalog.columns[column as usize].name))
                .map(str::to_lowercase);
            needles
                .iter()
                .zip(hits)
                .filter(|(needle, _)| needle.schema.is_none())
                .map(|(needle, hits)| match hits.columns[id] {
                    Hit::None
                        if described
                            .as_deref()
                            .is_some_and(|text| text.contains(&needle.table.lower)) =>
                    {
                        Hit::Contains
                    }
                    hit => hit,
                })
                .max()
                .filter(|hit| *hit > Hit::None)
                .map(|hit| (hit, position))
        })
        .collect();
    matching.sort_by_key(|(hit, position)| (std::cmp::Reverse(*hit), *position));
    let short_line = format!("{head} [columns omitted; use describe]");
    if matching.is_empty() {
        return (
            format!("{head} {}{tail}", cols(table.columns.len())),
            short_line,
        );
    }
    let shown: Vec<String> = matching
        .iter()
        .take(SHOWN_HITS)
        .map(|(_, position)| {
            let column = &view.catalog.columns[table.columns[*position] as usize];
            let mut text = format!("{} {}", column.name, column.data_type);
            if let Some(described) = note.and_then(|note| note.column(&column.name)) {
                text.push_str(&format!(" ({})", flat(described, 40)));
            }
            text
        })
        .collect();
    let mut line = format!("{head}: {}", shown.join(", "));
    if matching.len() > SHOWN_HITS {
        line.push_str(&format!(", +{} matching", matching.len() - SHOWN_HITS));
    }
    let rest = table.columns.len() - matching.len();
    if rest > 0 {
        line.push_str(&format!(" +{}", cols(rest)));
    }
    line.push_str(&tail);
    (line, short_line)
}

pub(super) fn count_text(value: i64) -> String {
    rows(value.max(0) as f64)
}

fn object_line(view: &View, entry: &Entry, objects: &Objects) -> (String, String) {
    let tables = view.catalog.tables();
    let members = members_text(tables, &entry.members);
    match entry.target {
        Target::Relation(index) => {
            let relation = &objects.relations[index];
            let mut line = format!(
                "{} {}{members}",
                relation.kind.code(),
                qualified(&relation.schema, &relation.name)
            );
            if let Some(count) = relation.rows.filter(|_| entry.members.len() < 2) {
                line.push_str(&format!(" ≈{} rows", count_text(count)));
            }
            let short_line = line.clone();
            if let Some(note) = view.note(&relation.schema, &relation.name) {
                line.push_str(&format!(" — {note}"));
            }
            (line, short_line)
        }
        Target::Routine(index) => {
            let routine = &objects.routines[index];
            let mut line = format!("{} {}{members}", routine.kind.code(), signature(routine));
            if let Some(lines) = routine.lines {
                line.push_str(&format!(", {lines} lines"));
            }
            let short_line = format!(
                "{} {}{members}",
                routine.kind.code(),
                qualified(&routine.schema, &routine.name)
            );
            (line, short_line)
        }
        Target::Trigger(index) => {
            let trigger = &objects.triggers[index];
            let short_line = format!(
                "Trg {} on {}",
                qualified(&trigger.schema, &trigger.name),
                qualified(&trigger.schema, &trigger.table)
            );
            let line = match trigger.routine.as_str() {
                "" => short_line.clone(),
                routine => format!("{short_line} → {routine}"),
            };
            (line, short_line)
        }
        Target::Table(_) => (String::new(), String::new()),
    }
}

pub(super) fn page(
    mut text: String,
    rows: impl Iterator<Item = (String, String)>,
    total: usize,
    offset: usize,
    limit: usize,
    max_chars: usize,
) -> String {
    let footer = |next: usize| {
        format!(
            "\n[{} more; next offset={next}, limit={limit}]",
            total.saturating_sub(next)
        )
    };
    let mut shown = 0;
    let mut chars = text.chars().count();
    for (full, short) in rows.take(limit) {
        let reserve = footer(offset + shown + 1).chars().count();
        let mut row = full;
        if chars + row.chars().count() + 1 + reserve > max_chars {
            row = short;
        }
        let row_chars = row.chars().count() + 1;
        if chars + row_chars + reserve > max_chars {
            if shown == 0 {
                return cap(format!("{text}\n{row}{}", footer(offset + 1)), max_chars);
            }
            break;
        }
        text.push('\n');
        text.push_str(&row);
        chars += row_chars;
        shown += 1;
    }
    if offset.saturating_add(shown) < total {
        text.push_str(&footer(offset + shown));
    } else if offset >= total && total > 0 {
        text.push_str(&format!("\n[nothing at offset={offset}]"));
    }
    cap(text, max_chars)
}

fn glossary(view: &View, needles: &[Needle]) -> Vec<String> {
    view.notes
        .glossary
        .iter()
        .filter(|(term, _)| {
            let term = Name::new(term);
            needles.iter().any(|needle| {
                term.hit(&needle.table) > Hit::None || needle.table.hit(&term) >= Hit::WordStart
            })
        })
        .take(3)
        .map(|(term, meaning)| format!("glossary \"{}\": {}", flat(term, 40), flat(meaning, 160)))
        .collect()
}

pub(super) fn search(view: &View, args: &Value, max_chars: usize) -> Result<String, String> {
    let term = arg_str(args, "term").trim();
    let offset = args["offset"].as_u64().unwrap_or(0).min(usize::MAX as u64) as usize;
    let kinds = Kind::filter(arg_str(args, "kind"))?;
    let needles = needles(term);
    if needles.is_empty() && kinds.is_empty() {
        let limit = args["limit"].as_u64().unwrap_or(50).clamp(1, 200) as usize;
        return Ok(super::overview::listing(view, offset, limit, max_chars));
    }
    let limit = args["limit"].as_u64().unwrap_or(20).clamp(1, 200) as usize;
    let wants = |kind: Kind| kinds.is_empty() || kinds.contains(&kind);
    let tables = view.catalog.tables();
    let hits: Vec<Hits> = needles.iter().map(|needle| hits(tables, needle)).collect();
    let sizes = family_sizes(tables, view.allowed);
    let grouped_family = |schema: Option<usize>| {
        schema
            .map(|schema| tables.family[schema])
            .filter(|family| sizes.get(family).copied().unwrap_or(0) > 1)
    };
    let mut entries: Vec<Entry> = Vec::new();
    let mut grouped: HashMap<(u32, u32), usize> = HashMap::new();
    let mut grouped_objects: HashMap<(u32, Kind, &str, &str), usize> = HashMap::new();
    let mut counts: Vec<(&str, usize)> = Vec::new();
    let mut tally = |code: &'static str| match counts.iter_mut().find(|(seen, _)| *seen == code) {
        Some((_, count)) => *count += 1,
        None => counts.push((code, 1)),
    };
    if kinds.is_empty() || kinds.iter().any(|kind| kind.relation()) {
        for (index, table) in tables.list.iter().enumerate() {
            if !tables.visible(table, view.allowed) {
                continue;
            }
            let (schema, name) = (tables.schema(table), tables.name(table));
            let kind = view.kind(schema, name);
            if !wants(kind) {
                continue;
            }
            let note = view.notes.table(schema, name);
            let Some(entry) = score(tables, index, &needles, &hits, note) else {
                continue;
            };
            tally(kind.code());
            if let Some(family) = grouped_family(Some(table.schema as usize)) {
                if let Some(&position) = grouped.get(&(family, table.name)) {
                    entries[position].members.push(table.schema);
                    continue;
                }
                grouped.insert((family, table.name), entries.len());
            }
            entries.push(Entry {
                members: vec![table.schema],
                ..entry
            });
        }
    }
    let objects = view.objects.clone();
    if let Some(objects) = &objects {
        let names = objects.names();
        let (relations, routines) = (objects.relations.len(), objects.routines.len());
        let candidates = objects
            .relations
            .iter()
            .enumerate()
            .filter(|(_, entry)| tables.find(&entry.schema, &entry.name).is_none())
            .map(|(index, entry)| {
                (
                    Target::Relation(index),
                    index,
                    entry.kind,
                    entry.schema.as_str(),
                    entry.name.as_str(),
                    "",
                )
            })
            .chain(objects.routines.iter().enumerate().map(|(index, entry)| {
                (
                    Target::Routine(index),
                    relations + index,
                    entry.kind,
                    entry.schema.as_str(),
                    entry.name.as_str(),
                    entry.args.as_str(),
                )
            }))
            .chain(objects.triggers.iter().enumerate().map(|(index, entry)| {
                (
                    Target::Trigger(index),
                    relations + routines + index,
                    Kind::Trigger,
                    entry.schema.as_str(),
                    entry.name.as_str(),
                    entry.table.as_str(),
                )
            }));
        for (target, position, kind, schema, name, extra) in candidates {
            if !wants(kind) || !allowed(schema, view.allowed) {
                continue;
            }
            let text = match target {
                Target::Relation(_) => {
                    let mut text = view.note(schema, name).unwrap_or_default().to_lowercase();
                    if let Some(note) = view.notes.table(schema, name) {
                        text.push('\n');
                        text.push_str(&note.lower);
                    }
                    Some(text)
                }
                Target::Trigger(_) => Some(extra.to_lowercase()),
                _ => None,
            };
            let Some(entry) = object_score(
                tables,
                target,
                &names[position],
                schema,
                text.as_deref().filter(|text| !text.is_empty()),
                &needles,
                &hits,
            ) else {
                continue;
            };
            tally(kind.code());
            let schema_index = schema_id(tables, schema);
            if let Some(family) = grouped_family(schema_index) {
                let key = (family, kind, name, extra);
                if let Some(&position) = grouped_objects.get(&key) {
                    entries[position]
                        .members
                        .push(schema_index.unwrap_or(0) as u32);
                    continue;
                }
                grouped_objects.insert(key, entries.len());
            }
            entries.push(Entry {
                members: schema_index
                    .map(|index| vec![index as u32])
                    .unwrap_or_default(),
                ..entry
            });
        }
    }
    let matched: usize = counts.iter().map(|(_, count)| count).sum();
    let about = if term.is_empty() {
        format!("kind {}", arg_str(args, "kind").trim())
    } else {
        format!("\"{term}\"")
    };
    if entries.is_empty() {
        let mut text = format!("No tables or objects match {about} · {}", view.stamp());
        if view.objects.is_none() && !kinds.iter().all(|kind| kind.relation()) {
            text.push_str("\n[routines and views are not listed for this connection]");
        }
        for line in glossary(view, &needles) {
            text.push('\n');
            text.push_str(&line);
        }
        return Ok(text);
    }
    entries.sort_by_key(|entry| {
        let length = match entry.target {
            Target::Table(index) => tables.name(&tables.list[index]).len(),
            _ => 0,
        };
        (
            std::cmp::Reverse(entry.tier),
            std::cmp::Reverse(entry.score),
            length,
        )
    });
    let mut header = match counts.as_slice() {
        [("T", _)] => format!("{matched} tables match {about}"),
        _ => format!(
            "{matched} objects match {about} ({})",
            counts
                .iter()
                .map(|(code, count)| format!("{code} {count}"))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    };
    if entries.len() < matched {
        header.push_str(&format!(
            ", {} entries (identical schemas grouped)",
            entries.len()
        ));
    }
    header.push_str(&format!(" · {}", view.stamp()));
    for line in glossary(view, &needles) {
        header.push('\n');
        header.push_str(&line);
    }
    let rows = entries.iter().skip(offset).map(|entry| match entry.target {
        Target::Table(index) => table_line(view, entry, index, &needles, &hits),
        _ => match &objects {
            Some(objects) => object_line(view, entry, objects),
            None => (String::new(), String::new()),
        },
    });
    Ok(page(header, rows, entries.len(), offset, limit, max_chars))
}

pub(super) fn source_hits(
    view: &View,
    redactor: &Redactor,
    hits: Vec<super::objects::Hit>,
    term: &str,
    args: &Value,
    max_chars: usize,
    note: Option<&str>,
) -> String {
    let offset = args["offset"].as_u64().unwrap_or(0).min(usize::MAX as u64) as usize;
    let limit = args["limit"].as_u64().unwrap_or(20).clamp(1, 200) as usize;
    let kinds = Kind::filter(arg_str(args, "kind")).unwrap_or_default();
    let mut hits: Vec<_> = hits
        .into_iter()
        .filter(|hit| allowed(&hit.schema, view.allowed))
        .filter(|hit| kinds.is_empty() || kinds.contains(&hit.kind))
        .collect();
    hits.sort_by(|a, b| (&a.schema, &a.name).cmp(&(&b.schema, &b.name)));
    let mut header = format!(
        "{} source hits for \"{term}\" · {}",
        hits.len(),
        view.stamp()
    );
    if let Some(note) = note {
        header.push_str(&format!("\n[{note}]"));
    }
    if hits.is_empty() {
        return header;
    }
    let total = hits.len();
    let rows = hits.into_iter().skip(offset).map(|hit| {
        let head = format!(
            "{} {} line {}",
            hit.kind.code(),
            qualified(&hit.schema, &hit.name),
            hit.line
        );
        let times = if hit.occurrences > 1 {
            format!(" ({}×)", hit.occurrences)
        } else {
            String::new()
        };
        let snippet = if view.hides(&hit.snippet) {
            "[line references a hidden schema]".to_string()
        } else {
            flat(&redactor.redact_text(&hit.snippet), 120)
        };
        (format!("{head}{times}: {snippet}"), head)
    });
    page(header, rows, total, offset, limit, max_chars)
}

pub(super) enum Found {
    Table(usize),
    Relation(usize),
    Routine(usize),
    Trigger(usize),
}

pub(super) enum Missing {
    Unknown(String),
    Ambiguous(String),
}

fn pick<'b, T>(
    list: impl Iterator<Item = (usize, &'b T)> + Clone,
    wanted: &str,
    names: impl Fn(&'b T) -> (String, &'b str),
) -> Vec<usize>
where
    T: 'b,
{
    let exact: Vec<usize> = list
        .clone()
        .filter(|(_, entry)| {
            let (full, bare) = names(entry);
            full == wanted || bare == wanted
        })
        .map(|(index, _)| index)
        .collect();
    if !exact.is_empty() {
        return exact;
    }
    list.filter(|(_, entry)| {
        let (full, bare) = names(entry);
        full.eq_ignore_ascii_case(wanted) || bare.eq_ignore_ascii_case(wanted)
    })
    .map(|(index, _)| index)
    .collect()
}

fn ambiguous(name: &str, options: Vec<String>, max_chars: usize) -> Missing {
    let total = options.len();
    let mut names: Vec<String> = options.into_iter().take(20).collect();
    if total > 20 {
        names.push(format!("+{} more", total - 20));
    }
    Missing::Ambiguous(cap(
        format!(
            "'{name}' ist mehrdeutig. table vollständig angeben: {}",
            names.join(", ")
        ),
        max_chars,
    ))
}

pub(super) fn resolve(view: &View, name: &str, max_chars: usize) -> Result<Found, Missing> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Missing::Unknown("table fehlt".into()));
    }
    let tables = view.catalog.tables();
    let visible = tables
        .list
        .iter()
        .enumerate()
        .filter(|(_, entry)| tables.visible(entry, view.allowed));
    let found = pick(visible, name, |entry| {
        (tables.qualified(entry), tables.name(entry))
    });
    match found.as_slice() {
        [index] => return Ok(Found::Table(*index)),
        [] => {}
        many => {
            return Err(ambiguous(
                name,
                many.iter()
                    .map(|&index| tables.qualified(&tables.list[index]))
                    .collect(),
                max_chars,
            ))
        }
    }
    let unknown = || {
        Missing::Unknown(format!(
            "Objekt '{name}' nicht gefunden. search nutzen, nach Schemaänderungen mit refresh=true."
        ))
    };
    let Some(objects) = view.objects.as_ref() else {
        return Err(unknown());
    };
    let (base, args) = match name.split_once('(') {
        Some((base, rest)) => (base.trim(), Some(rest.trim_end_matches(')').trim())),
        None => (name, None),
    };
    let relations = pick(
        objects
            .relations
            .iter()
            .enumerate()
            .filter(|(_, entry)| allowed(&entry.schema, view.allowed)),
        base,
        |entry| (qualified(&entry.schema, &entry.name), entry.name.as_str()),
    );
    if let [index] = relations.as_slice() {
        return Ok(Found::Relation(*index));
    }
    let squash = |text: &str| text.split_whitespace().collect::<String>().to_lowercase();
    let mut routines = pick(
        objects
            .routines
            .iter()
            .enumerate()
            .filter(|(_, entry)| allowed(&entry.schema, view.allowed)),
        base,
        |entry| (qualified(&entry.schema, &entry.name), entry.name.as_str()),
    );
    if let Some(args) = args {
        let wanted = squash(args);
        routines.retain(|&index| squash(&objects.routines[index].args) == wanted);
    }
    let triggers = pick(
        objects
            .triggers
            .iter()
            .enumerate()
            .filter(|(_, entry)| allowed(&entry.schema, view.allowed)),
        base,
        |entry| (qualified(&entry.schema, &entry.name), entry.name.as_str()),
    );
    match (relations.len(), routines.as_slice(), triggers.as_slice()) {
        (0, [index], []) => Ok(Found::Routine(*index)),
        (0, [], [index]) => Ok(Found::Trigger(*index)),
        (0, [], []) => Err(unknown()),
        _ => Err(ambiguous(
            name,
            relations
                .iter()
                .map(|&index| {
                    let entry = &objects.relations[index];
                    qualified(&entry.schema, &entry.name)
                })
                .chain(routines.iter().map(|&index| {
                    let entry = &objects.routines[index];
                    format!("{}({})", qualified(&entry.schema, &entry.name), entry.args)
                }))
                .chain(triggers.iter().map(|&index| {
                    let entry = &objects.triggers[index];
                    qualified(&entry.schema, &entry.name)
                }))
                .collect(),
            max_chars,
        )),
    }
}

#[derive(Default)]
pub(super) struct Detail {
    pub nullable: HashMap<String, bool>,
    pub primary: Vec<String>,
    pub comments: HashMap<String, String>,
    pub foreign: HashMap<String, String>,
    pub indexes: Vec<String>,
    pub referenced_by: Vec<String>,
    pub rows: Option<f64>,
    pub bytes: Option<i64>,
    pub kind: Option<Kind>,
}

pub(super) fn glob(pattern: &str, text: &str) -> bool {
    let pattern = pattern.trim().to_lowercase();
    let text = text.to_lowercase();
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return text == pattern;
    }
    let (first, last) = (parts[0], parts[parts.len() - 1]);
    if !text.starts_with(first) || !text[first.len()..].ends_with(last) {
        return false;
    }
    let mut rest = &text[first.len()..text.len() - last.len()];
    for part in &parts[1..parts.len() - 1] {
        match rest.find(part) {
            Some(at) => rest = &rest[at + part.len()..],
            None => return false,
        }
    }
    true
}

fn groups(names: &[&str]) -> Vec<(String, usize)> {
    let mut counts: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, name) in names.iter().enumerate() {
        let words = super::catalog::words(name);
        let parts: Vec<&str> = words.split('_').collect();
        if parts.len() < 2 {
            continue;
        }
        counts
            .entry(format!("{}_*", parts[0]))
            .or_default()
            .push(index);
        counts
            .entry(format!("*_{}", parts[parts.len() - 1]))
            .or_default()
            .push(index);
    }
    let mut candidates: Vec<(String, Vec<usize>)> = counts
        .into_iter()
        .filter(|(_, list)| list.len() >= 3)
        .collect();
    candidates.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then_with(|| a.0.cmp(&b.0)));
    let mut taken = vec![false; names.len()];
    let mut out = Vec::new();
    for (pattern, list) in candidates {
        let fresh: Vec<usize> = list.into_iter().filter(|&index| !taken[index]).collect();
        if fresh.len() < 3 {
            continue;
        }
        for &index in &fresh {
            taken[index] = true;
        }
        out.push((pattern, fresh.len()));
        if out.len() == 8 {
            break;
        }
    }
    let other = taken.iter().filter(|done| !**done).count();
    if other > 0 {
        out.push(("other".into(), other));
    }
    out
}

pub(super) fn table_section(
    view: &View,
    index: usize,
    detail: &Detail,
    filter: &[String],
) -> String {
    let tables = view.catalog.tables();
    let table = &tables.list[index];
    let (schema, name) = (tables.schema(table), tables.name(table));
    let relation = view.relation(schema, name);
    let kind = detail
        .kind
        .or(relation.map(|entry| entry.kind))
        .unwrap_or(Kind::Table);
    let mut facts = Vec::new();
    if kind != Kind::Table {
        facts.push(kind.word().to_string());
    }
    let rows_known = relation
        .and_then(|entry| entry.rows)
        .map(|count| count as f64)
        .or(detail.rows);
    if let Some(count) = rows_known {
        facts.push(format!("≈{} rows", rows(count)));
    }
    if let Some(bytes) = relation.and_then(|entry| entry.bytes).or(detail.bytes) {
        facts.push(crate::db::pretty_bytes(bytes));
    }
    let mut text = tables.qualified(table);
    if !facts.is_empty() {
        text.push_str(&format!(" ({})", facts.join(", ")));
    }
    if let Some(note) = view.note(schema, name) {
        text.push_str(&format!(" — {note}"));
    }
    let note = view.notes.table(schema, name);
    let line = |column: &crate::db::ColumnInfo| {
        let mut line = format!(" {} {}", column.name, column.data_type);
        let primary = detail.primary.contains(&column.name);
        if detail.nullable.get(&column.name) == Some(&true) && !primary {
            line.push('?');
        }
        if primary {
            line.push_str(" PK");
        }
        if let Some(target) = detail.foreign.get(&column.name) {
            line.push_str(&format!(" → {target}"));
        }
        let described = note
            .and_then(|note| note.column(&column.name))
            .or(detail.comments.get(&column.name).map(String::as_str));
        if let Some(described) = described {
            line.push_str(&format!(" — {}", flat(described, 60)));
        }
        line
    };
    let columns: Vec<&crate::db::ColumnInfo> = table
        .columns
        .iter()
        .map(|&index| &view.catalog.columns[index as usize])
        .collect();
    if !filter.is_empty() {
        let chosen: Vec<&&crate::db::ColumnInfo> = columns
            .iter()
            .filter(|column| filter.iter().any(|pattern| glob(pattern, &column.name)))
            .collect();
        text.push_str(&format!(
            "\n {} of {} columns match {}",
            chosen.len(),
            columns.len(),
            filter.join(", ")
        ));
        for column in chosen {
            text.push('\n');
            text.push_str(&line(column));
        }
    } else {
        let wide = columns.len() > WIDE_COLUMNS;
        let shown = if wide { SHOWN_COLUMNS } else { columns.len() };
        for column in &columns[..shown] {
            text.push('\n');
            text.push_str(&line(column));
        }
        if wide {
            let rest: Vec<&str> = columns[shown..]
                .iter()
                .map(|column| column.name.as_str())
                .collect();
            let summary = groups(&rest)
                .into_iter()
                .map(|(pattern, count)| format!("{pattern} {count}"))
                .collect::<Vec<_>>()
                .join(", ");
            text.push_str(&format!(
                "\n +{} more columns: {summary}; describe columns=\"pattern*\" lists them",
                rest.len()
            ));
        }
    }
    if !detail.indexes.is_empty() {
        text.push_str(&format!("\n indexes: {}", detail.indexes.join("; ")));
    }
    if !detail.referenced_by.is_empty() {
        text.push_str(&format!(
            "\n referenced by: {}",
            detail.referenced_by.join(", ")
        ));
    }
    text
}

pub(super) fn object_header(view: &View, target: &super::objects::Target) -> String {
    use super::objects::Target as Object;
    match target {
        Object::Routine(routine) => {
            let mut text = format!("{} {}", routine.kind.code(), signature(routine));
            if !routine.language.is_empty() {
                text.push_str(&format!(" · {}", routine.language));
            }
            text.push_str(&format!(" · {}", routine.kind.word()));
            text
        }
        Object::Relation(schema, name, kind) => {
            let mut text = format!(
                "{} {} ({}",
                kind.code(),
                qualified(schema, name),
                kind.word()
            );
            if let Some(count) = view.relation(schema, name).and_then(|entry| entry.rows) {
                text.push_str(&format!(", ≈{} rows", count_text(count)));
            }
            text.push(')');
            if let Some(note) = view.note(schema, name) {
                text.push_str(&format!(" — {note}"));
            }
            text
        }
        Object::Trigger(trigger) => {
            let mut text = format!(
                "Trg {} on {}",
                qualified(&trigger.schema, &trigger.name),
                qualified(&trigger.schema, &trigger.table)
            );
            if !trigger.routine.is_empty() {
                text.push_str(&format!(" → {}", trigger.routine));
            }
            text
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_schemas_are_found_in_any_quoting_without_hiding_aliases() {
        let columns = vec![crate::db::ColumnInfo {
            schema: "public".into(),
            table: "orders".into(),
            name: "id".into(),
            data_type: "int".into(),
        }];
        let catalog = Catalog::new(Arc::new(columns));
        let allowed = vec!["public".to_string()];
        let view = View::new(&catalog, &allowed);
        assert!(
            !view.hides("FROM hidden.secret"),
            "unknown hidden schemas need a listing"
        );
        catalog.set_listed(Some(vec!["public".into(), "Hidden".into(), "a".into()]));
        let view = View::new(&catalog, &allowed);
        for line in [
            "FROM hidden.secret s",
            "JOIN \"Hidden\".\"secret\" s",
            "FROM `hidden`.`secret`",
            "FROM [hidden].[secret]",
            "FROM db.[Hidden].[secret]",
            "  PERFORM a.notify(1);",
        ] {
            assert!(view.hides(line), "{line}");
        }
        for line in [
            "JOIN public.orders o ON o.id = c.id",
            "SELECT data.x, 1.5 FROM t data",
        ] {
            assert!(!view.hides(line), "{line}");
        }
        catalog.set_listed(None);
        let strict = View::new(&catalog, &allowed);
        assert!(strict.hides("FROM elsewhere.t") && !strict.hides("FROM public.orders"));
        assert_eq!(
            mask_hidden("p hidden.secret_type, q public.t, r \"X\".\"y\"", &allowed),
            "p [hidden], q public.t, r [hidden]"
        );
        assert_eq!(mask_hidden("p hidden.t", &[]), "p hidden.t");
    }

    #[test]
    fn globs_and_column_groups_summarise_wide_tables() {
        assert!(glob("zz_*", "ZZ_abc") && glob("*_date", "ship_date") && glob("a*b*c", "axxbyyc"));
        assert!(!glob("zz_*", "a_zz_b") && !glob("*_date", "date") && glob("id", "ID"));
        let names: Vec<String> = (0..10)
            .map(|index| format!("zz_{index}"))
            .chain((0..5).map(|index| format!("c{index}_date")))
            .chain(["misc".to_string(), "other_thing".to_string()])
            .collect();
        let refs: Vec<&str> = names.iter().map(String::as_str).collect();
        assert_eq!(
            groups(&refs),
            [
                ("zz_*".to_string(), 10),
                ("*_date".to_string(), 5),
                ("other".to_string(), 2)
            ]
        );
    }
}
