use super::control::{hash, literal, quote};
use crate::db::{provider::DatabaseKind, DatabaseAdapter};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema: String,
    pub source_schema: String,
    pub name: String,
    pub kind: String,
    pub metadata_version: Option<u32>,
    pub definition: String,
}

pub fn requalify(sql: &str, from: &str, to: &str) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let mut output = String::new();
    let mut i = 0;
    while i < chars.len() {
        let start = i;
        if chars[i..].starts_with(&['-', '-']) {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if chars[i..].starts_with(&['/', '*']) {
            i += 2;
            let mut depth = 1;
            while i < chars.len() && depth > 0 {
                if chars[i..].starts_with(&['/', '*']) {
                    depth += 1;
                    i += 2;
                } else if chars[i..].starts_with(&['*', '/']) {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
        } else if (chars[i..].starts_with(&['q', '\'']) || chars[i..].starts_with(&['Q', '\'']))
            && i + 3 < chars.len()
        {
            let close = match chars[i + 2] {
                '[' => ']',
                '(' => ')',
                '{' => '}',
                '<' => '>',
                c => c,
            };
            i += 3;
            while i < chars.len() && !chars[i..].starts_with(&[close, '\'']) {
                i += 1;
            }
            i = (i + 2).min(chars.len());
        } else if chars[i] == '\'' {
            i += 1;
            while i < chars.len() {
                if chars[i] == '\'' {
                    i += 1;
                    if i < chars.len() && chars[i] == '\'' {
                        i += 1;
                    } else {
                        break;
                    }
                } else if chars[i] == '\\' {
                    i = (i + 2).min(chars.len());
                } else {
                    i += 1;
                }
            }
        } else if chars[i] == '$' {
            let mut end = i + 1;
            while end < chars.len() && (chars[end].is_ascii_alphanumeric() || chars[end] == '_') {
                end += 1;
            }
            if end < chars.len() && chars[end] == '$' {
                let delimiter = &chars[i..=end];
                i = end + 1;
                while i < chars.len() && !chars[i..].starts_with(delimiter) {
                    i += 1;
                }
                i = (i + delimiter.len()).min(chars.len());
            } else {
                i += 1;
            }
        } else if chars[i] == '"' || chars[i].is_ascii_alphabetic() || chars[i] == '_' {
            let quoted = chars[i] == '"';
            i += 1;
            if quoted {
                while i < chars.len() {
                    if chars[i] == '"' {
                        i += 1;
                        if i < chars.len() && chars[i] == '"' {
                            i += 1;
                        } else {
                            break;
                        }
                    } else {
                        i += 1;
                    }
                }
            } else {
                while i < chars.len()
                    && (chars[i].is_ascii_alphanumeric() || "_$#".contains(chars[i]))
                {
                    i += 1;
                }
            }
            let token: String = chars[start..i].iter().collect();
            let name = if quoted {
                token[1..token.len() - 1].replace("\"\"", "\"")
            } else {
                token.clone()
            };
            let mut end = i;
            while end < chars.len() && chars[end].is_whitespace() {
                end += 1;
            }
            if end < chars.len()
                && chars[end] == '.'
                && (if quoted {
                    name == from
                } else {
                    name.eq_ignore_ascii_case(from)
                })
            {
                output.push_str(&quote(to));
                continue;
            }
        } else {
            i += 1;
        }
        output.extend(chars[start..i].iter());
    }
    output.replace("\r\n", "\n").trim_end().to_string()
}

fn value(row: &Value, key: &str) -> String {
    match &row[key] {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        v => v.to_string(),
    }
}
fn columns(row: &Value) -> Vec<String> {
    row["columns"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}
fn section(lines: &mut Vec<String>, title: &str, mut entries: Vec<String>, expected: &str) {
    if entries.is_empty() {
        return;
    }
    entries.sort_by_key(|line| expected.find(line).unwrap_or(usize::MAX));
    lines.push(title.into());
    lines.extend(entries);
}

pub async fn definition(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    object: &Snapshot,
) -> Result<String, String> {
    let schema = &object.schema;
    let name = &object.name;
    let normalize = |s: &str| requalify(s, schema, &object.source_schema);
    let result = match object.kind.as_str() {
        "table" => {
            let cols = adapter.list_table_columns_detailed(schema, name).await?;
            if cols.is_empty() {
                return Err(format!(
                    "Tabelle {schema}.{name} fehlt oder ist nicht lesbar"
                ));
            }
            let mut constraints = json!(adapter.list_constraints(schema, name).await?)
                .as_array()
                .cloned()
                .unwrap_or_default();
            let mut indexes = json!(adapter.list_indexes(schema, name).await?)
                .as_array()
                .cloned()
                .unwrap_or_default();
            if kind == DatabaseKind::Oracle && object.metadata_version == Some(2) {
                let sql = format!("SELECT c.constraint_name AS \"name\", c.generated AS \"generated\", c.status AS \"status\", c.validated AS \"validated\", c.deferrable AS \"deferrable\", c.deferred AS \"deferred\", c.delete_rule AS \"delete_rule\", p.owner AS \"referenced_schema\", p.table_name AS \"referenced_table\", (SELECT LISTAGG(cc.column_name, ',') WITHIN GROUP (ORDER BY cc.position) FROM all_cons_columns cc WHERE cc.owner = p.owner AND cc.constraint_name = p.constraint_name) AS \"referenced_columns\" FROM all_constraints c LEFT JOIN all_constraints p ON p.owner = c.r_owner AND p.constraint_name = c.r_constraint_name WHERE c.owner = {} AND c.table_name = {}",literal(schema),literal(name));
                let metadata = adapter.execute_query(&sql).await?;
                for constraint in &mut constraints {
                    let row = metadata
                        .rows
                        .iter()
                        .find(|r| r["name"] == constraint["name"])
                        .ok_or("Constraint-Metadaten unvollständig")?;
                    let mut definition = value(constraint, "definition");
                    if constraint["constraint_type"] == "FOREIGN KEY" {
                        for key in [
                            "referenced_schema",
                            "referenced_table",
                            "referenced_columns",
                        ] {
                            if row[key].as_str().is_none_or(str::is_empty) {
                                return Err("Fremdschlüssel-Ziel nicht lesbar".into());
                            }
                        }
                        definition = format!(
                            "FOREIGN KEY ({}) REFERENCES {}.{} ({}) ON DELETE {}",
                            columns(constraint)
                                .iter()
                                .map(|v| quote(v))
                                .collect::<Vec<_>>()
                                .join(", "),
                            quote(row["referenced_schema"].as_str().unwrap()),
                            quote(row["referenced_table"].as_str().unwrap()),
                            row["referenced_columns"]
                                .as_str()
                                .unwrap()
                                .split(',')
                                .map(quote)
                                .collect::<Vec<_>>()
                                .join(", "),
                            row["delete_rule"].as_str().unwrap_or("")
                        );
                    }
                    definition.push_str(&format!(
                        " [{}; {}; {}; {}]",
                        row["status"].as_str().unwrap_or(""),
                        row["validated"].as_str().unwrap_or(""),
                        row["deferrable"].as_str().unwrap_or(""),
                        row["deferred"].as_str().unwrap_or("")
                    ));
                    if row["generated"] == "GENERATED NAME" {
                        let name = format!(
                            "L8DB_GENERATED_{}",
                            hash(
                                &json!([
                                    constraint["constraint_type"],
                                    constraint["columns"],
                                    normalize(&definition)
                                ])
                                .to_string()
                            )[..16]
                                .to_uppercase()
                        );
                        let old = value(constraint, "name");
                        for index in &mut indexes {
                            if index["name"] == old {
                                index["definition"] = json!(value(index, "definition").replacen(
                                    &format!("INDEX {} ON", quote(&old)),
                                    &format!("INDEX {} ON", quote(&name)),
                                    1
                                ));
                                index["name"] = json!(name);
                            }
                        }
                        constraint["name"] = json!(name);
                    }
                    constraint["definition"] = json!(definition);
                }
            }
            let mut cols = cols;
            cols.sort_by_key(|c| c.ordinal_position);
            let mut lines = vec![
                normalize(&format!("TABLE {schema}.{name}")),
                "COLUMNS".into(),
            ];
            for col in cols {
                let width = col
                    .character_maximum_length
                    .filter(|n| *n != 0)
                    .map(|n| format!("({n})"))
                    .unwrap_or_default();
                let default = col
                    .column_default
                    .filter(|s| !s.is_empty())
                    .map(|s| format!(" DEFAULT {s}"))
                    .unwrap_or_default();
                lines.push(normalize(&format!(
                    "  {} {}{} {}{}{}",
                    col.name,
                    col.data_type,
                    width,
                    if col.is_nullable { "NULL" } else { "NOT NULL" },
                    default,
                    if col.is_primary_key {
                        " PRIMARY KEY"
                    } else {
                        ""
                    }
                )));
            }
            section(
                &mut lines,
                "CONSTRAINTS",
                constraints
                    .iter()
                    .map(|c| {
                        normalize(
                            format!(
                                "{} {} ({}) {}",
                                value(c, "name"),
                                value(c, "constraint_type"),
                                columns(c).join(", "),
                                value(c, "definition")
                            )
                            .trim(),
                        )
                    })
                    .collect(),
                &object.definition,
            );
            section(
                &mut lines,
                "INDEXES",
                indexes
                    .iter()
                    .map(|v| {
                        let d = value(v, "definition");
                        normalize(&format!(
                            "  {}",
                            if d.is_empty() {
                                format!("{} {}", value(v, "name"), columns(v).join(", "))
                            } else {
                                d
                            }
                        ))
                    })
                    .collect(),
                &object.definition,
            );
            let triggers = adapter.list_triggers(schema, name).await?;
            section(
                &mut lines,
                "TRIGGERS",
                triggers
                    .iter()
                    .map(|t| {
                        normalize(&format!(
                            "  {}",
                            if t.definition.is_empty() {
                                format!("{} {} {}", t.timing, t.event, t.trigger_name)
                            } else {
                                t.definition.clone()
                            }
                        ))
                    })
                    .collect(),
                &object.definition,
            );
            lines.join("\n")
        }
        "package" => {
            let spec = adapter
                .get_function_definition(&format!("{schema}\u{1f}{name}\u{1f}PACKAGE"))
                .await?;
            let exists = adapter.execute_query(&format!("SELECT object_type FROM all_objects WHERE owner={} AND object_name={} AND object_type='PACKAGE BODY'",literal(schema),literal(name))).await?;
            let body = if exists.rows.is_empty() {
                String::new()
            } else {
                adapter
                    .get_function_definition(&format!("{schema}\u{1f}{name}\u{1f}PACKAGE BODY"))
                    .await?
            };
            format!(
                "PACKAGE SPEC {schema}.{name}\n\n{spec}\n\nPACKAGE BODY {schema}.{name}\n\n{body}"
            )
        }
        "sequence" => {
            let sequences = adapter.list_sequences(Some(schema)).await?;
            let seq = sequences
                .iter()
                .find(|s| s.name == *name)
                .ok_or("Sequenz fehlt")?;
            format!("SEQUENCE {}.{}\n  data_type {}\n  start {}\n  min {}\n  max {}\n  increment {}\n  cycle {}",schema,name,seq.data_type,seq.start_value,seq.min_value,seq.max_value,seq.increment_by,if seq.cycle {"YES"}else{"NO"})
        }
        "view" | "materialized_view" => adapter.get_view_definition(schema, name).await?,
        "routine" | "procedure" => super::metadata::read(adapter, &object.kind, schema, name)
            .await?
            .as_str()
            .ok_or("Routinedefinition fehlt")?
            .to_string(),
        _ => return Err("Nicht unterstützter Objekttyp".into()),
    };
    Ok(normalize(&result))
}

pub async fn verify(
    adapter: &dyn DatabaseAdapter,
    kind: DatabaseKind,
    objects: &[Snapshot],
) -> Result<(), String> {
    for object in objects {
        let actual = definition(adapter, kind, object).await?;
        if actual != object.definition {
            return Err(format!(
                "Zielstruktur weicht vom Release ab: {}.{}",
                object.schema, object.name
            ));
        }
    }
    Ok(())
}

pub async fn verify_removed(
    adapter: &dyn DatabaseAdapter,
    previous: &[Snapshot],
    next: &[Snapshot],
) -> Result<(), String> {
    for old in previous.iter().filter(|old| {
        !next
            .iter()
            .any(|new| new.schema == old.schema && new.kind == old.kind && new.name == old.name)
    }) {
        let exists = match old.kind.as_str() {
            "table" => adapter
                .list_tables(Some(&old.schema))
                .await?
                .iter()
                .any(|v| v.name == old.name),
            "view" => adapter
                .list_views(Some(&old.schema))
                .await?
                .iter()
                .any(|v| v.name == old.name),
            "materialized_view" => adapter
                .list_materialized_views(Some(&old.schema))
                .await?
                .iter()
                .any(|v| v.name == old.name),
            "sequence" => adapter
                .list_sequences(Some(&old.schema))
                .await?
                .iter()
                .any(|v| v.name == old.name),
            "routine" | "procedure" | "package" => {
                let routines = if old.kind == "procedure" {
                    adapter.list_procedures(Some(&old.schema)).await?
                } else {
                    adapter.list_functions(Some(&old.schema)).await?
                };
                routines.iter().any(|r| {
                    if old.kind == "package" {
                        r.name == old.name && r.return_type == "PACKAGE"
                    } else {
                        format!("{}({})", r.name, r.identity_args) == old.name
                    }
                })
            }
            _ => return Err("Entferntes Objekt hat unbekannten Typ".into()),
        };
        if exists {
            return Err(format!(
                "Entferntes Objekt existiert weiterhin: {}.{}",
                old.schema, old.name
            ));
        }
    }
    Ok(())
}
