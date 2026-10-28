use super::catalog::{allowed, Kind, Name, Tables};
use super::config::{McpConfig, McpConnection};
use super::discovery::{count_text, page, schema_id, View};
use super::insight::Edge;
use super::server::{arg_str, cap, qualified, Server};
use serde_json::Value;
use std::collections::HashMap;

const TOP_GROUPS: usize = 12;
const TOP_TABLES: usize = 10;
const TOP_PREFIXES: usize = 10;
const TOP_HUBS: usize = 8;
const SAMPLE_NAMES: usize = 8;

#[derive(Default, Clone)]
pub(super) struct Stat {
    pub tables: usize,
    pub rows: i64,
    pub bytes: i64,
    pub views: usize,
    pub routines: usize,
}

impl Stat {
    fn add(&mut self, other: &Stat) {
        self.tables += other.tables;
        self.rows += other.rows;
        self.bytes += other.bytes;
        self.views += other.views;
        self.routines += other.routines;
    }

    fn rows(&self, measured: bool) -> String {
        if measured {
            format!(", ≈{} rows", count_text(self.rows))
        } else {
            String::new()
        }
    }

    fn facts(&self, measured: bool) -> String {
        let mut out = String::new();
        if measured {
            out.push_str(&format!(", ≈{} rows", count_text(self.rows)));
        }
        if self.bytes > 0 {
            out.push_str(&format!(", {}", crate::db::pretty_bytes(self.bytes)));
        }
        if self.views > 0 {
            out.push_str(&format!(", {} views", self.views));
        }
        if self.routines > 0 {
            out.push_str(&format!(", {} routines", self.routines));
        }
        out
    }
}

fn counted(kind: Kind) -> bool {
    matches!(kind, Kind::Table | Kind::Foreign)
}

pub(super) fn stats(view: &View) -> Vec<Stat> {
    let tables = view.catalog.tables();
    let mut stats = vec![Stat::default(); tables.schemas.len()];
    for table in &tables.list {
        if tables.visible(table, view.allowed) {
            stats[table.schema as usize].tables += 1;
        }
    }
    let Some(objects) = &view.objects else {
        return stats;
    };
    for relation in &objects.relations {
        let Some(id) = schema_id(tables, &relation.schema) else {
            continue;
        };
        if !allowed(&relation.schema, view.allowed) {
            continue;
        }
        let stat = &mut stats[id];
        if matches!(relation.kind, Kind::View | Kind::Matview) {
            stat.views += 1;
            if tables.find(&relation.schema, &relation.name).is_some() {
                stat.tables = stat.tables.saturating_sub(1);
            }
        } else if counted(relation.kind) {
            stat.rows += relation.rows.unwrap_or(0);
            stat.bytes += relation.bytes.unwrap_or(0);
        }
    }
    for routine in &objects.routines {
        if let Some(id) = schema_id(tables, &routine.schema) {
            if allowed(&routine.schema, view.allowed) {
                stats[id].routines += 1;
            }
        }
    }
    stats
}

fn measured(view: &View) -> bool {
    view.objects
        .as_ref()
        .is_some_and(|objects| objects.relations.iter().any(|entry| entry.rows.is_some()))
}

fn visible_schemas(view: &View) -> Vec<usize> {
    let tables = view.catalog.tables();
    let mut seen = vec![false; tables.schemas.len()];
    for table in &tables.list {
        if tables.visible(table, view.allowed) {
            seen[table.schema as usize] = true;
        }
    }
    (0..seen.len()).filter(|&index| seen[index]).collect()
}

fn group_schemas(tables: &Tables, visible: &[usize]) -> Vec<Vec<u32>> {
    let mut sizes: HashMap<u32, u32> = HashMap::new();
    for &schema in visible {
        *sizes.entry(tables.family[schema]).or_insert(0) += 1;
    }
    let mut groups: Vec<Vec<u32>> = Vec::new();
    let mut slot: HashMap<u32, usize> = HashMap::new();
    for &schema in visible {
        let family = tables.family[schema];
        if sizes[&family] > 1 {
            if let Some(&position) = slot.get(&family) {
                groups[position].push(schema as u32);
                continue;
            }
            slot.insert(family, groups.len());
        }
        groups.push(vec![schema as u32]);
    }
    groups
}

fn group_line(
    tables: &Tables,
    stats: &[Stat],
    members: &[u32],
    measured: bool,
    full: bool,
) -> String {
    let name = |index: u32| tables.schemas[index as usize].original.as_str();
    let mut total = Stat::default();
    for &member in members {
        total.add(&stats[member as usize]);
    }
    let each = stats[members[0] as usize].tables;
    let head = match members {
        [only] => format!("{}: {} tables", name(*only), each),
        [first, .., last] => format!(
            "{}..{} ({} identical schemas): {each} tables each",
            name(*first),
            name(*last),
            members.len()
        ),
        [] => String::new(),
    };
    if full {
        format!("{head}{}", total.facts(measured))
    } else {
        format!("{head}{}", total.rows(measured))
    }
}

fn first_word(name: &Name) -> Option<&str> {
    let (head, _) = name.words.split_once('_')?;
    (!head.is_empty()).then_some(head)
}

pub(super) fn listing(view: &View, offset: usize, limit: usize, max_chars: usize) -> String {
    let tables = view.catalog.tables();
    let stats = stats(view);
    let measured = measured(view);
    let visible = visible_schemas(view);
    let total: usize = visible.iter().map(|&schema| stats[schema].tables).sum();
    if visible.len() <= 1 {
        let list: Vec<usize> = tables
            .list
            .iter()
            .enumerate()
            .filter(|(_, table)| tables.visible(table, view.allowed))
            .map(|(index, _)| index)
            .collect();
        let mut header = match visible
            .first()
            .map(|&schema| tables.schemas[schema].original.as_str())
        {
            Some(schema) if !schema.is_empty() => format!("{} tables in {schema}", list.len()),
            _ => format!("{} tables", list.len()),
        };
        if let Some(&schema) = visible.first() {
            header.push_str(&stats[schema].rows(measured));
        }
        header.push_str(&format!(" · {}", view.stamp()));
        let rows = list.iter().skip(offset).map(|&index| {
            let table = &tables.list[index];
            let (schema, name) = (tables.schema(table), tables.name(table));
            let mut line = format!(
                "{} {}",
                view.kind(schema, name).code(),
                tables.qualified(table)
            );
            if let Some(count) = view.relation(schema, name).and_then(|entry| entry.rows) {
                line.push_str(&format!(" ≈{}", count_text(count)));
            }
            (line.clone(), line)
        });
        return page(header, rows, list.len(), offset, limit, max_chars);
    }
    let groups = group_schemas(tables, &visible);
    let mut header = format!("{total} tables in {} schemas", visible.len());
    if groups.len() < visible.len() {
        header.push_str(&format!(
            ", {} groups (identical schemas grouped)",
            groups.len()
        ));
    }
    header.push_str(&format!(" · {}", view.stamp()));
    let mut by_schema: Vec<Vec<usize>> = vec![Vec::new(); tables.schemas.len()];
    for (index, table) in tables.list.iter().enumerate() {
        if tables.visible(table, view.allowed) {
            by_schema[table.schema as usize].push(index);
        }
    }
    let rows = groups.iter().skip(offset).map(|members| {
        let head = group_line(tables, &stats, members, measured, false);
        let mut names: Vec<&str> = by_schema[members[0] as usize]
            .iter()
            .map(|&index| tables.name(&tables.list[index]))
            .collect();
        names.sort_by_key(|name| (name.len(), *name));
        let mut sample = names
            .iter()
            .take(SAMPLE_NAMES)
            .copied()
            .collect::<Vec<_>>()
            .join(", ");
        if names.len() > SAMPLE_NAMES {
            sample.push_str(&format!(", +{} more", names.len() - SAMPLE_NAMES));
        }
        (format!("{head}: {sample}"), head)
    });
    page(header, rows, groups.len(), offset, limit, max_chars)
}

fn largest(view: &View, schema: Option<&str>, sizes: &HashMap<u32, usize>) -> Vec<String> {
    let Some(objects) = &view.objects else {
        return Vec::new();
    };
    let tables = view.catalog.tables();
    let mut list: Vec<_> = objects
        .relations
        .iter()
        .filter(|entry| {
            counted(entry.kind) || entry.kind == Kind::Partitioned || entry.kind == Kind::Matview
        })
        .filter(|entry| allowed(&entry.schema, view.allowed))
        .filter(|entry| schema.is_none_or(|schema| entry.schema == schema))
        .filter(|entry| entry.rows.is_some() || entry.bytes.is_some())
        .collect();
    list.sort_by_key(|entry| {
        std::cmp::Reverse((entry.rows.unwrap_or(0), entry.bytes.unwrap_or(0)))
    });
    let mut seen: Vec<(u32, &str)> = Vec::new();
    let mut out = Vec::new();
    for entry in list {
        let family = schema_id(tables, &entry.schema).map(|id| tables.family[id]);
        if let Some(family) = family {
            if seen.contains(&(family, entry.name.as_str())) {
                continue;
            }
            seen.push((family, entry.name.as_str()));
        }
        let mut line = qualified(&entry.schema, &entry.name);
        if let Some(count) = entry.rows {
            line.push_str(&format!(" ≈{}", count_text(count)));
        }
        if let Some(bytes) = entry.bytes {
            line.push_str(&format!(" {}", crate::db::pretty_bytes(bytes)));
        }
        if let Some(size) = family
            .and_then(|family| sizes.get(&family))
            .filter(|size| **size > 1)
        {
            line.push_str(&format!(" ×{size} schemas"));
        }
        out.push(line);
        if out.len() == TOP_TABLES {
            break;
        }
    }
    out
}

fn prefixes(
    view: &View,
    schema: Option<usize>,
    representative: &[bool],
) -> Vec<(String, usize, i64)> {
    let tables = view.catalog.tables();
    let mut counts: HashMap<&str, (usize, i64)> = HashMap::new();
    for table in &tables.list {
        let id = table.schema as usize;
        if !tables.visible(table, view.allowed) {
            continue;
        }
        match schema {
            Some(wanted) if wanted != id => continue,
            None if !representative[id] => continue,
            _ => {}
        }
        if let Some(word) = first_word(&tables.table_names[table.name as usize]) {
            let entry = counts.entry(word).or_default();
            entry.0 += 1;
            entry.1 += view
                .relation(tables.schema(table), tables.name(table))
                .and_then(|entry| entry.rows)
                .unwrap_or(0);
        }
    }
    let mut list: Vec<(String, usize, i64)> = counts
        .into_iter()
        .filter(|(_, (count, _))| *count >= 3)
        .map(|(word, (count, rows))| (format!("{word}_*"), count, rows))
        .collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    list
}

fn hubs(view: &View, edges: &[Edge]) -> Vec<String> {
    let mut incoming: HashMap<&(String, String), usize> = HashMap::new();
    for edge in edges {
        if edge.from != edge.to
            && allowed(&edge.from.0, view.allowed)
            && allowed(&edge.to.0, view.allowed)
        {
            *incoming.entry(&edge.to).or_insert(0) += 1;
        }
    }
    let mut list: Vec<_> = incoming
        .into_iter()
        .filter(|(_, count)| *count > 1)
        .collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    list.into_iter()
        .take(TOP_HUBS)
        .map(|(table, count)| format!("{} ←{count}", qualified(&table.0, &table.1)))
        .collect()
}

fn coverage(view: &View) -> Option<String> {
    let tables = view.catalog.tables();
    let described = tables
        .list
        .iter()
        .filter(|table| tables.visible(table, view.allowed))
        .filter(|table| {
            view.notes
                .table(tables.schema(table), tables.name(table))
                .is_some()
        })
        .count();
    if described == 0 && view.notes.glossary.is_empty() {
        return None;
    }
    Some(format!(
        "knowledge: notes for {described} tables, {} glossary terms (shown in search and describe)",
        view.notes.glossary.len()
    ))
}

fn object_counts(view: &View) -> String {
    let Some(objects) = &view.objects else {
        return String::new();
    };
    let mut counts: Vec<(&str, usize)> = [
        "views",
        "materialized views",
        "functions",
        "procedures",
        "triggers",
    ]
    .into_iter()
    .map(|word| (word, 0))
    .collect();
    let mut add = |word: &'static str| {
        if let Some((_, count)) = counts.iter_mut().find(|(seen, _)| *seen == word) {
            *count += 1;
        }
    };
    for entry in objects
        .relations
        .iter()
        .filter(|entry| allowed(&entry.schema, view.allowed))
    {
        match entry.kind {
            Kind::View => add("views"),
            Kind::Matview => add("materialized views"),
            _ => {}
        }
    }
    for entry in objects
        .routines
        .iter()
        .filter(|entry| allowed(&entry.schema, view.allowed))
    {
        add(if entry.kind == Kind::Procedure {
            "procedures"
        } else {
            "functions"
        });
    }
    for _ in objects
        .triggers
        .iter()
        .filter(|entry| allowed(&entry.schema, view.allowed))
    {
        add("triggers");
    }
    counts
        .iter()
        .filter(|(_, count)| *count > 0)
        .map(|(word, count)| format!("{count} {word}"))
        .collect::<Vec<_>>()
        .join(", ")
}

pub(super) fn render(
    view: &View,
    edges: Option<&[Edge]>,
    args: &Value,
    max_chars: usize,
) -> Result<String, String> {
    let tables = view.catalog.tables();
    let stats = stats(view);
    let measured = measured(view);
    let visible = visible_schemas(view);
    let groups = group_schemas(tables, &visible);
    let mut sizes: HashMap<u32, usize> = HashMap::new();
    let mut representative = vec![false; tables.schemas.len()];
    for members in &groups {
        representative[members[0] as usize] = true;
        sizes.insert(tables.family[members[0] as usize], members.len());
    }
    let wanted = arg_str(args, "schema").trim();
    if !wanted.is_empty() {
        return zoom(view, wanted, &stats, &groups, measured, max_chars);
    }
    let mut total = Stat::default();
    for &schema in &visible {
        total.add(&stats[schema]);
    }
    let columns: usize = tables
        .list
        .iter()
        .filter(|table| tables.visible(table, view.allowed))
        .map(|table| table.columns.len())
        .sum();
    let mut lines = vec![format!("overview · {}", view.stamp())];
    let mut summary = format!(
        "{} tables in {} schemas, {columns} columns",
        total.tables,
        visible.len()
    );
    if measured {
        summary.push_str(&format!(", ≈{} rows", count_text(total.rows)));
    }
    if total.bytes > 0 {
        summary.push_str(&format!(", {}", crate::db::pretty_bytes(total.bytes)));
    }
    let objects = object_counts(view);
    if !objects.is_empty() {
        summary.push_str(&format!("; {objects}"));
    }
    lines.push(summary);
    let mut ranked: Vec<&Vec<u32>> = groups.iter().collect();
    ranked.sort_by_key(|members| {
        let mut sum = Stat::default();
        for &member in members.iter() {
            sum.add(&stats[member as usize]);
        }
        std::cmp::Reverse((sum.rows, sum.bytes, sum.tables))
    });
    lines.push(if groups.len() < visible.len() {
        "schemas (largest first, identical schemas grouped):".to_string()
    } else {
        "schemas (largest first):".to_string()
    });
    for members in ranked.iter().take(TOP_GROUPS) {
        lines.push(format!(
            "- {}",
            group_line(tables, &stats, members, measured, true)
        ));
    }
    if ranked.len() > TOP_GROUPS {
        lines.push(format!(
            "- +{} more; search with an empty term pages through all",
            ranked.len() - TOP_GROUPS
        ));
    }
    let largest = largest(view, None, &sizes);
    if !largest.is_empty() {
        lines.push(format!("largest tables: {}", largest.join(", ")));
    }
    let prefixes = prefixes(view, None, &representative);
    if !prefixes.is_empty() {
        lines.push(format!(
            "name prefixes: {}",
            prefixes
                .iter()
                .take(TOP_PREFIXES)
                .map(|(prefix, count, _)| format!("{prefix} {count}"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if let Some(edges) = edges {
        let hubs = hubs(view, edges);
        if !hubs.is_empty() {
            lines.push(format!("most referenced (FKs in): {}", hubs.join(", ")));
        }
    }
    if let Some(coverage) = coverage(view) {
        lines.push(coverage);
    }
    lines.push("next: overview schema=<name> zooms in; search term=<words> [kind=T,V,M,F,P]; describe table=<name>".into());
    Ok(cap(lines.join("\n"), max_chars))
}

fn zoom(
    view: &View,
    wanted: &str,
    stats: &[Stat],
    groups: &[Vec<u32>],
    measured: bool,
    max_chars: usize,
) -> Result<String, String> {
    let tables = view.catalog.tables();
    let visible = visible_schemas(view);
    let id = visible
        .iter()
        .copied()
        .find(|&id| tables.schemas[id].original == wanted)
        .or_else(|| {
            visible
                .iter()
                .copied()
                .find(|&id| tables.schemas[id].original.eq_ignore_ascii_case(wanted))
        });
    let Some(id) = id else {
        let lower = wanted.to_lowercase();
        let similar: Vec<&str> = visible
            .iter()
            .map(|&id| tables.schemas[id].original.as_str())
            .filter(|name| name.to_lowercase().contains(&lower))
            .take(20)
            .collect();
        return Err(if similar.is_empty() {
            format!("Schema '{wanted}' nicht gefunden. overview ohne schema listet alle.")
        } else {
            format!(
                "Schema '{wanted}' nicht gefunden. Ähnlich: {}",
                similar.join(", ")
            )
        });
    };
    let name = tables.schemas[id].original.as_str();
    let stat = &stats[id];
    let mut lines = vec![format!(
        "schema {name} · {}: {} tables{}",
        view.stamp(),
        stat.tables,
        stat.facts(measured)
    )];
    if let Some(members) = groups.iter().find(|members| members.contains(&(id as u32))) {
        if members.len() > 1 {
            lines.push(format!(
                "identical to {} other schemas ({}..{})",
                members.len() - 1,
                tables.schemas[members[0] as usize].original,
                tables.schemas[members[members.len() - 1] as usize].original
            ));
        }
    }
    let prefixes = prefixes(view, Some(id), &[]);
    if !prefixes.is_empty() {
        let grouped: usize = prefixes.iter().map(|(_, count, _)| count).sum();
        lines.push("prefix groups:".into());
        for (prefix, count, rows) in prefixes.iter().take(15) {
            let mut line = format!("- {prefix}: {count} tables");
            if measured {
                line.push_str(&format!(", ≈{} rows", count_text(*rows)));
            }
            lines.push(line);
        }
        if prefixes.len() > 15 {
            lines.push(format!("- +{} more prefixes", prefixes.len() - 15));
        }
        if stat.tables > grouped {
            lines.push(format!(
                "- {} tables without a shared prefix",
                stat.tables - grouped
            ));
        }
    }
    let largest = largest(view, Some(name), &HashMap::new());
    if !largest.is_empty() {
        lines.push(format!("largest tables: {}", largest.join(", ")));
    }
    if let Some(objects) = &view.objects {
        let mut kinds: Vec<(&str, usize)> = Vec::new();
        let in_schema = objects
            .relations
            .iter()
            .filter(|entry| {
                entry.schema == name && matches!(entry.kind, Kind::View | Kind::Matview)
            })
            .map(|entry| entry.kind.code())
            .chain(
                objects
                    .routines
                    .iter()
                    .filter(|entry| entry.schema == name)
                    .map(|entry| entry.kind.code()),
            )
            .chain(
                objects
                    .triggers
                    .iter()
                    .filter(|entry| entry.schema == name)
                    .map(|_| "Trg"),
            );
        for code in in_schema {
            match kinds.iter_mut().find(|(seen, _)| *seen == code) {
                Some((_, count)) => *count += 1,
                None => kinds.push((code, 1)),
            }
        }
        if !kinds.is_empty() {
            lines.push(format!(
                "other objects: {}; search kind=<code> term=<words> lists them",
                kinds
                    .iter()
                    .map(|(code, count)| format!("{code} {count}"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    lines.push(format!(
        "next: search term=\"{name}.<words>\"; describe table=\"{name}.<table>\""
    ));
    Ok(cap(lines.join("\n"), max_chars))
}

impl Server {
    pub(super) async fn overview(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        args: &Value,
    ) -> Result<String, String> {
        if args["refresh"] == true {
            self.forget_catalog(connection);
        }
        let (catalog, objects, notes) = self.discover(config, connection).await?;
        let keys = self.keys(config, connection, &catalog).await;
        let graph = match &keys {
            Some(_) => None,
            None => super::insight::cached(connection),
        };
        let edges: Option<&[Edge]> = match (&keys, &graph) {
            (Some(keys), _) => Some(&keys.edges),
            (None, Some(graph)) => Some(&graph.edges),
            _ => None,
        };
        let view = View::with(&catalog, connection.allowed_schemas(), objects, notes);
        render(&view, edges, args, config.max_chars)
    }
}
