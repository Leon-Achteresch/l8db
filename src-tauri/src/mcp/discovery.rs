use super::catalog::{Catalog, Hit, Name, Tables};
use super::server::{arg_str, cap, qualified};
use serde_json::Value;
use std::collections::HashMap;

const SHOWN_HITS: usize = 6;
const SAMPLE_NAMES: usize = 8;

struct Needle {
    table: Name,
    schema: Option<Name>,
}

struct Hits {
    tables: Vec<Hit>,
    columns: Vec<Hit>,
    schemas: Vec<Hit>,
}

struct Entry {
    table: usize,
    tier: u8,
    score: u32,
    named: bool,
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

fn score(tables: &Tables, index: usize, needles: &[Needle], hits: &[Hits]) -> Option<Entry> {
    let table = &tables.list[index];
    let mut entry = Entry {
        table: index,
        tier: 4,
        score: 0,
        named: false,
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
        entry.named |= named > Hit::None;
        entry.tier = entry.tier.min(tier);
        entry.score += weight;
    }
    let joined: Vec<&str> = needles
        .iter()
        .map(|needle| needle.table.words.as_str())
        .collect();
    if entry.tier == 4 && joined.join("_") == tables.table_names[table.name as usize].words {
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

fn members_text(tables: &Tables, members: &[u32]) -> String {
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

fn entry_line(
    catalog: &Catalog,
    entry: &Entry,
    needles: &[Needle],
    hits: &[Hits],
) -> (String, String) {
    let tables = catalog.tables();
    let table = &tables.list[entry.table];
    let mut head = tables.qualified(table);
    head.push_str(&members_text(tables, &entry.members));
    if entry.named {
        head.push_str(" [table]");
    } else if entry.by_schema {
        head.push_str(" [schema]");
    }
    let mut matching: Vec<(Hit, usize)> = table
        .columns
        .iter()
        .enumerate()
        .filter_map(|(position, &column)| {
            let name = tables.column_name[column as usize] as usize;
            needles
                .iter()
                .zip(hits)
                .filter(|(needle, _)| needle.schema.is_none())
                .map(|(_, hits)| hits.columns[name])
                .max()
                .filter(|hit| *hit > Hit::None)
                .map(|hit| (hit, position))
        })
        .collect();
    matching.sort_by_key(|(hit, position)| (std::cmp::Reverse(*hit), *position));
    let short = format!("{head} [columns omitted; use describe]");
    if matching.is_empty() {
        return (format!("{head} {}", cols(table.columns.len())), short);
    }
    let shown: Vec<String> = matching
        .iter()
        .take(SHOWN_HITS)
        .map(|(_, position)| {
            let column = &catalog.columns[table.columns[*position] as usize];
            format!("{} {}", column.name, column.data_type)
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
    (line, short)
}

fn page(
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

fn overview(
    catalog: &Catalog,
    allowed: &[String],
    offset: usize,
    limit: usize,
    max_chars: usize,
) -> String {
    let tables = catalog.tables();
    let mut by_schema: Vec<Vec<usize>> = vec![Vec::new(); tables.schemas.len()];
    for (index, table) in tables.list.iter().enumerate() {
        if tables.visible(table, allowed) {
            by_schema[table.schema as usize].push(index);
        }
    }
    let visible: Vec<usize> = (0..by_schema.len())
        .filter(|&schema| !by_schema[schema].is_empty())
        .collect();
    let total: usize = visible.iter().map(|&schema| by_schema[schema].len()).sum();
    if visible.len() <= 1 {
        let schema = visible
            .first()
            .map(|&schema| tables.schemas[schema].original.as_str());
        let header = match schema {
            Some(schema) if !schema.is_empty() => format!("{total} tables in {schema}"),
            _ => format!("{total} tables"),
        };
        let list = visible
            .first()
            .map(|&schema| by_schema[schema].as_slice())
            .unwrap_or_default();
        let rows = list.iter().skip(offset).map(|&index| {
            let name = tables.qualified(&tables.list[index]);
            (name.clone(), name)
        });
        return page(header, rows, list.len(), offset, limit, max_chars);
    }
    let sizes = family_sizes(tables, allowed);
    let mut groups: Vec<Vec<u32>> = Vec::new();
    let mut slot: HashMap<u32, usize> = HashMap::new();
    for &schema in &visible {
        let family = tables.family[schema];
        if sizes.get(&family).copied().unwrap_or(0) > 1 {
            if let Some(&position) = slot.get(&family) {
                groups[position].push(schema as u32);
                continue;
            }
            slot.insert(family, groups.len());
        }
        groups.push(vec![schema as u32]);
    }
    let mut header = format!("{total} tables in {} schemas", visible.len());
    if groups.len() < visible.len() {
        header.push_str(&format!(
            ", {} groups (identical schemas grouped)",
            groups.len()
        ));
    }
    let rows = groups.iter().skip(offset).map(|members| {
        let first = members[0] as usize;
        let list = &by_schema[first];
        let mut names: Vec<&str> = list
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
        let head = match members.as_slice() {
            [_] => format!("{}: {} tables", tables.schemas[first].original, list.len()),
            [.., last] => format!(
                "{}..{} ({} identical schemas): {} tables each",
                tables.schemas[first].original,
                tables.schemas[*last as usize].original,
                members.len(),
                list.len()
            ),
            [] => String::new(),
        };
        (format!("{head}: {sample}"), head)
    });
    page(header, rows, groups.len(), offset, limit, max_chars)
}

pub(super) fn search(
    catalog: &Catalog,
    allowed: &[String],
    args: &Value,
    max_chars: usize,
) -> String {
    let term = arg_str(args, "term").trim();
    let offset = args["offset"].as_u64().unwrap_or(0).min(usize::MAX as u64) as usize;
    let needles = needles(term);
    if needles.is_empty() {
        let limit = args["limit"].as_u64().unwrap_or(50).clamp(1, 200) as usize;
        return overview(catalog, allowed, offset, limit, max_chars);
    }
    let limit = args["limit"].as_u64().unwrap_or(20).clamp(1, 200) as usize;
    let tables = catalog.tables();
    let hits: Vec<Hits> = needles.iter().map(|needle| hits(tables, needle)).collect();
    let sizes = family_sizes(tables, allowed);
    let mut entries: Vec<Entry> = Vec::new();
    let mut grouped: HashMap<(u32, u32), usize> = HashMap::new();
    let mut matched = 0;
    for (index, table) in tables.list.iter().enumerate() {
        if !tables.visible(table, allowed) {
            continue;
        }
        let Some(entry) = score(tables, index, &needles, &hits) else {
            continue;
        };
        matched += 1;
        let family = tables.family[table.schema as usize];
        if sizes.get(&family).copied().unwrap_or(0) > 1 {
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
    if entries.is_empty() {
        return format!("No tables or columns match '{term}'");
    }
    entries.sort_by_key(|entry| {
        (
            std::cmp::Reverse(entry.tier),
            std::cmp::Reverse(entry.score),
            tables.name(&tables.list[entry.table]).len(),
        )
    });
    let mut header = format!("{matched} tables match \"{term}\"");
    if entries.len() < matched {
        header.push_str(&format!(
            ", {} entries (identical schemas grouped)",
            entries.len()
        ));
    }
    let rows = entries
        .iter()
        .skip(offset)
        .map(|entry| entry_line(catalog, entry, &needles, &hits));
    page(header, rows, entries.len(), offset, limit, max_chars)
}

pub(super) fn describe(
    catalog: &Catalog,
    allowed: &[String],
    table: &str,
    max_chars: usize,
) -> Result<(String, (String, String)), String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("table fehlt".into());
    }
    let tables = catalog.tables();
    let visible = || {
        tables
            .list
            .iter()
            .filter(|entry| tables.visible(entry, allowed))
    };
    let mut matching: Vec<_> = visible()
        .filter(|entry| tables.qualified(entry) == table || tables.name(entry) == table)
        .collect();
    if matching.is_empty() {
        matching = visible()
            .filter(|entry| {
                tables.qualified(entry).eq_ignore_ascii_case(table)
                    || tables.name(entry).eq_ignore_ascii_case(table)
            })
            .collect();
    }
    match matching.as_slice() {
        [] => Err(format!(
            "Tabelle '{table}' nicht gefunden. search nutzen, nach Schemaänderungen mit refresh=true."
        )),
        [entry] => {
            let columns: Vec<String> = entry
                .columns
                .iter()
                .map(|&index| {
                    let column = &catalog.columns[index as usize];
                    format!("{} {}", column.name, column.data_type)
                })
                .collect();
            let key = (tables.schema(entry).to_string(), tables.name(entry).to_string());
            Ok((
                cap(format!("{}({})", qualified(&key.0, &key.1), columns.join(", ")), max_chars),
                key,
            ))
        }
        _ => {
            let mut names: Vec<String> = matching.iter().take(20).map(|entry| tables.qualified(entry)).collect();
            if matching.len() > 20 {
                names.push(format!("+{} more", matching.len() - 20));
            }
            Err(cap(
                format!(
                    "Tabelle '{table}' ist mehrdeutig. table vollständig angeben: {}",
                    names.join(", ")
                ),
                max_chars,
            ))
        }
    }
}
