use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;

use rusqlite::Connection;

use super::{query_all, quote, text, truthy, SqliteAdapter};
use crate::db::schema_catalog::CatalogObject;

type ForeignKeyGroups = BTreeMap<i64, (String, String, String, Vec<String>, Vec<String>)>;

const NAME: &str = r#"(?:"(?:[^"]|"")+"|\[[^\]]+\]|`[^`]+`|[^\s(."]+)"#;

static HEADER: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(&format!(
        r"(?is)^\s*CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?(UNIQUE\s+)?(TABLE|INDEX|VIEW|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:{NAME}\s*\.\s*)?{NAME}"
    ))
    .unwrap()
});
static COLLATE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r#"(?i)\bCOLLATE\s+("[^"]+"|\w+)"#).unwrap());

pub(super) fn normalize_header(sql: &str, schema: &str, name: &str) -> String {
    match HEADER.captures(sql) {
        Some(caps) => format!(
            "CREATE {}{} {}.{}{}",
            if caps.get(1).is_some() { "UNIQUE " } else { "" },
            caps[2].to_ascii_uppercase(),
            quote(schema),
            quote(name),
            sql[caps[0].len()..].trim_end().trim_end_matches(';')
        ),
        None => sql.trim().to_string(),
    }
}

fn skip_quoted(bytes: &[u8], index: usize) -> usize {
    let close = match bytes[index] {
        b'[' => b']',
        other => other,
    };
    let mut i = index + 1;
    while i < bytes.len() {
        if bytes[i] == close {
            if close != b']' && i + 1 < bytes.len() && bytes[i + 1] == close {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i += 1;
    }
    bytes.len()
}

fn closing_paren(text: &str, open: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut depth = 0;
    let mut i = open;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' | b'`' | b'[' => {
                i = skip_quoted(bytes, i);
                continue;
            }
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

pub(super) fn table_parts(sql: &str) -> Vec<String> {
    let Some(open) = sql.find('(') else {
        return Vec::new();
    };
    let Some(close) = closing_paren(sql, open) else {
        return Vec::new();
    };
    let body = &sql[open + 1..close];
    let bytes = body.as_bytes();
    let mut parts = Vec::new();
    let mut depth = 0;
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' | b'`' | b'[' => {
                i = skip_quoted(bytes, i);
                continue;
            }
            b'(' => depth += 1,
            b')' => depth -= 1,
            b',' if depth == 0 => {
                parts.push(body[start..i].trim().to_string());
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    let last = body[start..].trim();
    if !last.is_empty() {
        parts.push(last.to_string());
    }
    parts
}

fn unquote(name: &str) -> String {
    let trimmed = name.trim();
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 2 {
        let (first, last) = (bytes[0], bytes[bytes.len() - 1]);
        if (first == b'"' && last == b'"') || (first == b'`' && last == b'`') {
            let quote = first as char;
            return trimmed[1..trimmed.len() - 1]
                .replace(&format!("{quote}{quote}"), &quote.to_string());
        }
        if first == b'[' && last == b']' {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

fn first_token(part: &str) -> (String, usize) {
    let bytes = part.as_bytes();
    if bytes.is_empty() {
        return (String::new(), 0);
    }
    let end = if matches!(bytes[0], b'"' | b'`' | b'[') {
        skip_quoted(bytes, 0)
    } else {
        part.find(|c: char| c.is_whitespace() || c == '(')
            .unwrap_or(part.len())
    };
    (part[..end].to_string(), end)
}

fn is_table_constraint(part: &str) -> bool {
    let (token, _) = first_token(part);
    matches!(
        token.to_ascii_uppercase().as_str(),
        "CONSTRAINT" | "PRIMARY" | "UNIQUE" | "CHECK" | "FOREIGN"
    )
}

fn keyword_positions(text: &str, keyword: &str) -> Vec<usize> {
    let bytes = text.as_bytes();
    let upper = text.to_ascii_uppercase();
    let mut found = Vec::new();
    let mut depth = 0;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' | b'`' | b'[' => {
                i = skip_quoted(bytes, i);
                continue;
            }
            b'(' => depth += 1,
            b')' => depth -= 1,
            _ if depth == 0
                && upper[i..].starts_with(keyword)
                && (i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_'))
                && upper[i + keyword.len()..]
                    .chars()
                    .next()
                    .is_none_or(|c| !(c.is_ascii_alphanumeric() || c == '_')) =>
            {
                found.push(i);
            }
            _ => {}
        }
        i += 1;
    }
    found
}

pub(super) fn check_clauses(part: &str) -> Vec<(Option<String>, String)> {
    let mut out = Vec::new();
    for position in keyword_positions(part, "CHECK") {
        let Some(open) = part[position..].find('(').map(|offset| position + offset) else {
            continue;
        };
        let Some(close) = closing_paren(part, open) else {
            continue;
        };
        let before = part[..position].trim_end();
        let name = keyword_positions(before, "CONSTRAINT")
            .last()
            .and_then(|start| {
                let rest = before[start + "CONSTRAINT".len()..].trim();
                let (token, end) = first_token(rest);
                (end == rest.len()).then(|| unquote(&token))
            });
        out.push((name, part[open + 1..close].trim().to_string()));
    }
    out
}

fn generated_expression(part: &str) -> Option<String> {
    let position = *keyword_positions(part, "AS").first()?;
    let open = position + part[position..].find('(')?;
    let close = closing_paren(part, open)?;
    let storage = if part[close..].to_ascii_uppercase().contains("STORED") {
        "STORED"
    } else {
        "VIRTUAL"
    };
    Some(format!("{} {storage}", part[open + 1..close].trim()))
}

fn collect_table(
    conn: &Connection,
    schema: &str,
    name: &str,
    sql: &str,
    want_table: bool,
    want_constraint: bool,
    out: &mut Vec<CatalogObject>,
) -> Result<(), String> {
    let parts = table_parts(sql);
    let column_text: HashMap<String, String> = parts
        .iter()
        .filter(|part| !is_table_constraint(part))
        .map(|part| {
            let (token, _) = first_token(part);
            (unquote(&token), part.clone())
        })
        .collect();
    let (_, columns) = query_all(
        conn,
        &format!("PRAGMA {}.table_xinfo({})", quote(schema), quote(name)),
    )?;
    let mut primary: Vec<(i64, String)> = Vec::new();
    for row in &columns {
        let hidden = row.get(6).and_then(|value| value.as_i64()).unwrap_or(0);
        if hidden == 1 {
            continue;
        }
        let column = text(&row[1]);
        let pk = row[5].as_i64().unwrap_or(0);
        if pk > 0 {
            primary.push((pk, column.clone()));
        }
        if !want_table {
            continue;
        }
        let definition = column_text
            .get(&column)
            .cloned()
            .unwrap_or_else(|| format!("{} {}", quote(&column), text(&row[2])));
        let mut object = CatalogObject::new(
            "column",
            column.clone(),
            Some(name.to_string()),
            definition.clone(),
        )
        .attr("type", text(&row[2]).to_ascii_uppercase())
        .attr("nullable", if truthy(&row[3]) { "NO" } else { "YES" });
        if hidden == 2 || hidden == 3 {
            if let Some(expression) = generated_expression(&definition) {
                object = object.attr("generated", expression);
            }
        } else if !row[4].is_null() {
            object = object.attr("default", text(&row[4]));
        }
        if let Some(caps) = COLLATE.captures(&definition) {
            object = object.attr("collation", unquote(&caps[1]).to_ascii_uppercase());
        }
        if definition.to_ascii_uppercase().contains("AUTOINCREMENT") {
            object = object.attr("identity", "AUTOINCREMENT");
        }
        out.push(object);
    }
    if want_table {
        out.push(CatalogObject::new(
            "table",
            name.to_string(),
            None,
            normalize_header(sql, schema, name),
        ));
    }
    if !want_constraint {
        return Ok(());
    }
    let mut push = |kind: &str, definition: String| {
        out.push(
            CatalogObject::new(
                "constraint",
                definition.clone(),
                Some(name.to_string()),
                definition.clone(),
            )
            .attr("kind", kind)
            .attr("definition", definition)
            .attr("generated", "YES"),
        );
    };
    if !primary.is_empty() {
        primary.sort();
        push(
            "P",
            format!(
                "PRIMARY KEY ({})",
                primary
                    .iter()
                    .map(|(_, column)| quote(column))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        );
    }
    let (_, indexes) = query_all(
        conn,
        &format!("PRAGMA {}.index_list({})", quote(schema), quote(name)),
    )?;
    let mut uniques = Vec::new();
    for index in &indexes {
        if text(&index[3]) != "u" {
            continue;
        }
        let (_, info) = query_all(
            conn,
            &format!(
                "PRAGMA {}.index_info({})",
                quote(schema),
                quote(&text(&index[1]))
            ),
        )?;
        uniques.push(format!(
            "UNIQUE ({})",
            info.iter()
                .map(|row| quote(&text(&row[2])))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    uniques.sort();
    for unique in uniques {
        push("U", unique);
    }
    let (_, keys) = query_all(
        conn,
        &format!("PRAGMA {}.foreign_key_list({})", quote(schema), quote(name)),
    )?;
    let mut grouped = ForeignKeyGroups::new();
    for row in &keys {
        let entry = grouped
            .entry(row[0].as_i64().unwrap_or(0))
            .or_insert_with(|| {
                (
                    text(&row[2]),
                    text(&row[5]),
                    text(&row[6]),
                    Vec::new(),
                    Vec::new(),
                )
            });
        entry.3.push(quote(&text(&row[3])));
        if !row[4].is_null() {
            entry.4.push(quote(&text(&row[4])));
        }
    }
    let mut foreign: Vec<String> = grouped
        .into_values()
        .map(|(table, update, delete, own, other)| {
            let referenced = if other.is_empty() {
                String::new()
            } else {
                format!(" ({})", other.join(", "))
            };
            format!(
                "FOREIGN KEY ({}) REFERENCES {}{referenced} ON UPDATE {update} ON DELETE {delete}",
                own.join(", "),
                quote(&table)
            )
        })
        .collect();
    foreign.sort();
    for key in foreign {
        push("R", key);
    }
    let mut checks: Vec<String> = parts
        .iter()
        .flat_map(|part| check_clauses(part))
        .map(|(constraint, expression)| match constraint {
            Some(constraint) => format!("CONSTRAINT {} CHECK ({expression})", quote(&constraint)),
            None => format!("CHECK ({expression})"),
        })
        .collect();
    checks.sort();
    for check in checks {
        push("C", check);
    }
    Ok(())
}

fn catalog(
    conn: &Connection,
    schema: &str,
    types: &[String],
) -> Result<Vec<CatalogObject>, String> {
    let want = |kind: &str| types.iter().any(|item| item == kind);
    let (_, rows) = query_all(
        conn,
        &format!(
            "SELECT type, name, tbl_name, sql FROM {}.sqlite_master \
             WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type, name",
            quote(schema)
        ),
    )?;
    let mut out = Vec::new();
    for row in &rows {
        let kind = text(&row[0]);
        let name = text(&row[1]);
        let parent = text(&row[2]);
        let sql = text(&row[3]);
        match kind.as_str() {
            "table" => {
                if sql.to_ascii_uppercase().starts_with("CREATE VIRTUAL") {
                    continue;
                }
                if want("table") || want("constraint") {
                    collect_table(
                        conn,
                        schema,
                        &name,
                        &sql,
                        want("table"),
                        want("constraint"),
                        &mut out,
                    )?;
                }
            }
            "index" if want("index") => out.push(CatalogObject::new(
                "index",
                name.clone(),
                Some(parent),
                normalize_header(&sql, schema, &name),
            )),
            "trigger" if want("trigger") => out.push(CatalogObject::new(
                "trigger",
                name.clone(),
                Some(parent),
                normalize_header(&sql, schema, &name),
            )),
            "view" if want("view") => out.push(CatalogObject::new(
                "view",
                name.clone(),
                None,
                normalize_header(&sql, schema, &name),
            )),
            _ => {}
        }
    }
    Ok(out)
}

impl SqliteAdapter {
    pub(super) async fn schema_catalog_impl(
        &self,
        schema: &str,
        types: &[String],
    ) -> Result<Vec<CatalogObject>, String> {
        let schema = schema.to_string();
        let types = types.to_vec();
        self.run(move |conn| catalog(conn, &schema, &types)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DatabaseAdapter;

    #[test]
    fn parses_sqlite_table_definitions() {
        assert_eq!(
            normalize_header(
                "CREATE UNIQUE INDEX IF NOT EXISTS main.\"a b\" ON t(x)",
                "main",
                "a b"
            ),
            "CREATE UNIQUE INDEX \"main\".\"a b\" ON t(x)"
        );
        assert_eq!(
            normalize_header("create table [t](x)", "main", "t"),
            "CREATE TABLE \"main\".\"t\"(x)"
        );
        let sql = "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK (length(name) > 0), \"a,b\" TEXT DEFAULT 'x,y', total REAL GENERATED ALWAYS AS (id * 2) STORED, CONSTRAINT pos CHECK (id > 0), UNIQUE (name))";
        let parts = table_parts(sql);
        assert_eq!(parts.len(), 6);
        assert_eq!(parts[2], "\"a,b\" TEXT DEFAULT 'x,y'");
        assert!(is_table_constraint(&parts[4]));
        assert_eq!(
            check_clauses(&parts[1]),
            vec![(None, "length(name) > 0".to_string())]
        );
        assert_eq!(
            check_clauses(&parts[4]),
            vec![(Some("pos".to_string()), "id > 0".to_string())]
        );
        assert_eq!(
            generated_expression(&parts[3]).as_deref(),
            Some("id * 2 STORED")
        );
    }

    #[tokio::test]
    async fn reads_sqlite_catalog() {
        let adapter = SqliteAdapter::new(
            ":memory:",
            crate::db::pool::create_pool_state(),
            "sqlite-catalog-test".into(),
        )
        .unwrap();
        for statement in [
            "CREATE TABLE p (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE COLLATE NOCASE)",
            "CREATE TABLE c (cid INTEGER, p_id INTEGER REFERENCES p(id) ON DELETE CASCADE, n INT DEFAULT 5 CHECK (n > 0), PRIMARY KEY (cid))",
            "CREATE INDEX c_n ON c(n DESC)",
            "CREATE VIEW v AS SELECT cid FROM c",
            "CREATE TRIGGER c_t AFTER INSERT ON c BEGIN UPDATE c SET n = 1 WHERE cid = NEW.cid; END",
        ] {
            adapter.execute_query(statement).await.unwrap();
        }
        let all: Vec<String> = ["table", "constraint", "index", "view", "trigger"]
            .iter()
            .map(|item| item.to_string())
            .collect();
        let objects = adapter.schema_catalog_impl("main", &all).await.unwrap();
        let find = |kind: &str, name: &str| {
            objects
                .iter()
                .find(|object| object.object_type == kind && object.name == name)
                .unwrap_or_else(|| panic!("{kind} {name} fehlt"))
        };
        assert_eq!(
            find("column", "id")
                .attributes
                .get("identity")
                .map(String::as_str),
            Some("AUTOINCREMENT")
        );
        assert_eq!(
            find("column", "code")
                .attributes
                .get("collation")
                .map(String::as_str),
            Some("NOCASE")
        );
        assert_eq!(
            find("column", "n")
                .attributes
                .get("default")
                .map(String::as_str),
            Some("5")
        );
        find("constraint", "UNIQUE (\"code\")");
        find(
            "constraint",
            "FOREIGN KEY (\"p_id\") REFERENCES \"p\" (\"id\") ON UPDATE NO ACTION ON DELETE CASCADE",
        );
        find("constraint", "CHECK (n > 0)");
        find("constraint", "PRIMARY KEY (\"cid\")");
        assert_eq!(
            find("index", "c_n").ddl,
            "CREATE INDEX \"main\".\"c_n\" ON c(n DESC)"
        );
        assert!(find("trigger", "c_t")
            .ddl
            .starts_with("CREATE TRIGGER \"main\".\"c_t\" AFTER INSERT"));
        assert_eq!(
            find("view", "v").ddl,
            "CREATE VIEW \"main\".\"v\" AS SELECT cid FROM c"
        );
    }
}
