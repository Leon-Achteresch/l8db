use std::ops::Range;

fn tokens(sql: &str) -> Vec<Range<usize>> {
    let bytes = sql.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if sql[i..].starts_with("--") {
            i = sql[i..].find('\n').map_or(bytes.len(), |n| i + n);
            continue;
        }
        if sql[i..].starts_with("/*") {
            i = sql[i + 2..].find("*/").map_or(bytes.len(), |n| i + n + 4);
            continue;
        }
        let start = i;
        let quote_start = if matches!(c, b'n' | b'N') { i + 1 } else { i };
        if matches!(bytes.get(quote_start), Some(b'q' | b'Q'))
            && bytes.get(quote_start + 1) == Some(&b'\'')
        {
            if let Some(open) = sql[quote_start + 2..].chars().next() {
                let close = match open {
                    '[' => ']',
                    '(' => ')',
                    '{' => '}',
                    '<' => '>',
                    other => other,
                };
                let body = quote_start + 2 + open.len_utf8();
                let delimiter = format!("{close}'");
                i = sql[body..]
                    .find(&delimiter)
                    .map_or(bytes.len(), |n| body + n + delimiter.len());
                out.push(start..i);
                continue;
            }
        }
        if matches!(c, b'\'' | b'"') {
            i += 1;
            while i < bytes.len() {
                if bytes[i] == c {
                    i += 1;
                    if bytes.get(i) != Some(&c) {
                        break;
                    }
                }
                i += 1;
            }
        } else if c.is_ascii_alphabetic() || c == b'_' {
            i += 1;
            while i < bytes.len()
                && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b'_' | b'$' | b'#'))
            {
                i += 1;
            }
        } else {
            i += sql[i..].chars().next().unwrap().len_utf8();
        }
        out.push(start..i);
    }
    out
}

fn is_slash(sql: &str, token: &Range<usize>) -> bool {
    if &sql[token.clone()] != "/" {
        return false;
    }
    let start = sql[..token.start].rfind('\n').map_or(0, |n| n + 1);
    let end = sql[token.end..]
        .find('\n')
        .map_or(sql.len(), |n| token.end + n);
    sql[start..token.start].trim().is_empty() && sql[token.end..end].trim().is_empty()
}

fn is_plsql(sql: &str, tokens: &[Range<usize>]) -> bool {
    let mut words = tokens.iter().map(|r| sql[r.clone()].to_ascii_uppercase());
    match words.next().as_deref() {
        Some("BEGIN" | "DECLARE") => true,
        Some("CREATE") => words
            .find(|w| {
                !matches!(
                    w.as_str(),
                    "OR" | "REPLACE" | "EDITIONABLE" | "NONEDITIONABLE"
                )
            })
            .is_some_and(|w| {
                matches!(
                    w.as_str(),
                    "FUNCTION" | "PROCEDURE" | "PACKAGE" | "TRIGGER" | "TYPE" | "LIBRARY"
                )
            }),
        _ => false,
    }
}

pub(super) fn prepare(sql: &str) -> String {
    let tokens: Vec<_> = tokens(sql)
        .into_iter()
        .filter(|r| &sql[r.clone()] != ";" && !is_slash(sql, r))
        .collect();
    let (Some(first), Some(last)) = (tokens.first(), tokens.last()) else {
        return String::new();
    };
    let mut statement = sql[first.start..last.end].to_string();
    if is_plsql(sql, &tokens) {
        statement.push(';');
    }
    statement
}

pub(super) fn split_statements(sql: &str) -> Vec<String> {
    let tokens = tokens(sql);
    let mut out = Vec::new();
    let mut start = 0;
    let mut plsql = false;
    for (index, token) in tokens.iter().enumerate() {
        plsql |= is_plsql(sql, &tokens[start..=index]);
        let slash = is_slash(sql, token);
        if slash || (&sql[token.clone()] == ";" && !plsql) {
            let end = if slash { token.start } else { token.end };
            let statement = sql[tokens[start].start..end].trim();
            if !prepare(statement).is_empty() {
                out.push(statement.to_string());
            }
            start = index + 1;
            plsql = false;
        }
    }
    if let Some(first) = tokens.get(start) {
        let statement = sql[first.start..].trim();
        if !prepare(statement).is_empty() {
            out.push(statement.to_string());
        }
    }
    out
}

pub(super) fn created_object(sql: &str) -> Option<(Option<String>, String, String)> {
    let words: Vec<&str> = tokens(sql).into_iter().map(|r| &sql[r]).collect();
    let is = |i: usize, word: &str| words.get(i).is_some_and(|w| w.eq_ignore_ascii_case(word));
    if !is(0, "CREATE") {
        return None;
    }
    let mut i = 1;
    while ["OR", "REPLACE", "EDITIONABLE", "NONEDITIONABLE"]
        .iter()
        .any(|w| is(i, w))
    {
        i += 1;
    }
    let mut kind = words.get(i)?.to_ascii_uppercase();
    if !matches!(
        kind.as_str(),
        "FUNCTION" | "PROCEDURE" | "PACKAGE" | "TRIGGER" | "TYPE"
    ) {
        return None;
    }
    i += 1;
    if matches!(kind.as_str(), "PACKAGE" | "TYPE") && is(i, "BODY") {
        kind.push_str(" BODY");
        i += 1;
    }
    let ident = |w: &str| match w.strip_prefix('"').and_then(|w| w.strip_suffix('"')) {
        Some(quoted) => quoted.replace("\"\"", "\""),
        None => w.to_ascii_uppercase(),
    };
    let first = ident(words.get(i)?);
    if words.get(i + 1) == Some(&".") {
        return Some((Some(first), ident(words.get(i + 2)?), kind));
    }
    Some((None, first, kind))
}

pub(super) fn first_word(sql: &str) -> String {
    tokens(sql)
        .first()
        .map(|r| sql[r.clone()].to_ascii_uppercase())
        .unwrap_or_default()
}

pub(super) const TEMP_SUFFIX: &str = "_L8DB_TEMP";

pub(super) struct TempObject {
    pub sql: String,
    pub owner: Option<String>,
    pub name: String,
    pub temp_name: String,
    pub kind: String,
}

impl TempObject {
    pub fn target(&self) -> String {
        let quote = |ident: &str| format!("\"{}\"", ident.replace('"', "\"\""));
        match &self.owner {
            Some(owner) => format!("{}.{}", quote(owner), quote(&self.temp_name)),
            None => quote(&self.temp_name),
        }
    }
}

pub(super) fn temp_object(sql: &str) -> Option<TempObject> {
    let toks = tokens(sql);
    let word = |i: usize| toks.get(i).map(|r| &sql[r.clone()]);
    let is = |i: usize, w: &str| word(i).is_some_and(|t| t.eq_ignore_ascii_case(w));
    if !is(0, "CREATE") {
        return None;
    }
    let mut replacements: Vec<(Range<usize>, String)> = Vec::new();
    let mut i = 1;
    let mut replace = false;
    while let Some(w) = word(i).map(str::to_ascii_uppercase) {
        match w.as_str() {
            "REPLACE" => replace = true,
            "NO" | "FORCE" => replacements.push((toks[i].clone(), String::new())),
            "OR" | "EDITIONABLE" | "NONEDITIONABLE" | "EDITIONING" => {}
            _ => break,
        }
        i += 1;
    }
    if !replace {
        let at = toks[0].end;
        replacements.insert(0, (at..at, " OR REPLACE".to_string()));
    }
    let mut kind = word(i)?.to_ascii_uppercase();
    if !matches!(kind.as_str(), "VIEW" | "FUNCTION" | "PROCEDURE" | "PACKAGE") {
        return None;
    }
    i += 1;
    if kind == "PACKAGE" && is(i, "BODY") {
        kind.push_str(" BODY");
        i += 1;
    }
    let ident = |w: &str| match w.strip_prefix('"').and_then(|w| w.strip_suffix('"')) {
        Some(quoted) => quoted.replace("\"\"", "\""),
        None => w.to_ascii_uppercase(),
    };
    let mut owner = None;
    if word(i + 1) == Some(".") {
        owner = Some(ident(word(i)?));
        i += 2;
    }
    let name = ident(word(i)?);
    let temp_name = format!("{name}{TEMP_SUFFIX}");
    let quoted = format!("\"{}\"", temp_name.replace('"', "\"\""));
    replacements.push((toks[i].clone(), quoted.clone()));
    let last = toks.iter().rposition(|r| &sql[r.clone()] != ";")?;
    if last > i + 1 && is(last - 1, "END") && ident(word(last)?) == name {
        replacements.push((toks[last].clone(), quoted));
    }
    let mut statement = sql.to_string();
    for (range, replacement) in replacements.into_iter().rev() {
        statement.replace_range(range, &replacement);
    }
    Some(TempObject {
        sql: statement,
        owner,
        name,
        temp_name,
        kind,
    })
}

pub(super) fn bind_statement(sql: &str, count: usize) -> Result<(String, Vec<usize>), String> {
    let mut replacements = Vec::new();
    let mut used = Vec::new();
    for token in tokens(sql) {
        if &sql[token.clone()] != "$" {
            continue;
        }
        let mut end = token.end;
        while sql.as_bytes().get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
        if end == token.end {
            continue;
        }
        let index = sql[token.end..end]
            .parse::<usize>()
            .map_err(|_| "Ungültiger Oracle-Bind-Parameter".to_string())?;
        if index == 0 || index > count {
            return Err(format!("Für ${index} fehlt ein Bind-Wert."));
        }
        if !used.contains(&index) {
            used.push(index);
        }
        replacements.push((token.start..end, format!(":l8db_{index}")));
    }
    if used.len() != count {
        return Err("Die Anzahl der Oracle-Bind-Werte passt nicht zur Abfrage.".to_string());
    }
    let mut statement = sql.to_string();
    for (range, replacement) in replacements.into_iter().rev() {
        statement.replace_range(range, &replacement);
    }
    Ok((prepare(&statement), used))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binds_numbered_parameters_without_touching_literals_or_comments() {
        let sql = "SELECT $2, $1, $2, '$1', q'[it's $2]', nq'{$1}', \"$1\", name$1 FROM dual -- $3\nWHERE x = $1 /* $9 */";
        let (bound, used) = bind_statement(sql, 2).unwrap();
        assert_eq!(used, vec![2, 1]);
        assert_eq!(bound, "SELECT :l8db_2, :l8db_1, :l8db_2, '$1', q'[it's $2]', nq'{$1}', \"$1\", name$1 FROM dual -- $3\nWHERE x = :l8db_1");
        assert!(bind_statement("SELECT $0 FROM dual", 1).is_err());
        assert!(bind_statement("SELECT $2 FROM dual", 1).is_err());
        assert!(bind_statement("SELECT '$1' FROM dual", 1).is_err());
        assert_eq!(
            bind_statement("SELECT $10 FROM dual", 10).unwrap_err(),
            "Die Anzahl der Oracle-Bind-Werte passt nicht zur Abfrage."
        );
    }

    #[test]
    fn detects_created_object() {
        assert_eq!(
            created_object("CREATE OR REPLACE EDITIONABLE PACKAGE BODY hr.\"Demo\" AS END;"),
            Some((Some("HR".into()), "Demo".into(), "PACKAGE BODY".into()))
        );
        assert_eq!(
            created_object("create procedure p is begin null; end;"),
            Some((None, "P".into(), "PROCEDURE".into()))
        );
        assert_eq!(created_object("CREATE TABLE t (id NUMBER)"), None);
    }

    #[test]
    fn renames_created_object_to_temp() {
        let t = temp_object(
            "CREATE PACKAGE BODY hr.demo AS\nPROCEDURE demo IS BEGIN NULL; END demo;\nEND demo;",
        )
        .unwrap();
        assert_eq!(t.sql, "CREATE OR REPLACE PACKAGE BODY hr.\"DEMO_L8DB_TEMP\" AS\nPROCEDURE demo IS BEGIN NULL; END demo;\nEND \"DEMO_L8DB_TEMP\";");
        assert_eq!(
            (t.owner.as_deref(), t.name.as_str(), t.kind.as_str()),
            (Some("HR"), "DEMO", "PACKAGE BODY")
        );
        let v =
            temp_object("create or replace force view \"v\" as select 'end v' from dual").unwrap();
        assert_eq!(
            v.sql,
            "create or replace  view \"v_L8DB_TEMP\" as select 'end v' from dual"
        );
        assert_eq!(v.temp_name, "v_L8DB_TEMP");
        let f = temp_object("CREATE FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END;").unwrap();
        assert_eq!(
            f.sql,
            "CREATE OR REPLACE FUNCTION \"F_L8DB_TEMP\" RETURN NUMBER IS BEGIN RETURN 1; END;"
        );
        assert!(temp_object("CREATE TABLE t (id NUMBER)").is_none());
        assert!(temp_object("CREATE TRIGGER t BEFORE INSERT ON x BEGIN NULL; END;").is_none());
        assert!(temp_object("SELECT 1 FROM dual").is_none());
    }

    const BODY: &str = "CREATE /* header */ OR REPLACE PACKAGE BODY demo AS\nPROCEDURE p IS\nx VARCHAR2(100) := q'[it's text;\n/\n-- not a comment]';\nBEGIN NULL; END p;\nEND demo;";

    #[test]
    fn prepares_complete_package() {
        assert_eq!(prepare(&format!("-- header\n{BODY}\n/\n-- footer")), BODY);
        assert_eq!(prepare(BODY), BODY);
        assert_eq!(
            prepare("SELECT nq'[it's; text]' FROM DUAL;"),
            "SELECT nq'[it's; text]' FROM DUAL"
        );
        assert_eq!(
            prepare("SELECT q'[it's; -- text]' FROM DUAL;"),
            "SELECT q'[it's; -- text]' FROM DUAL"
        );
        assert_eq!(
            prepare("CREATE /* comment */ OR REPLACE PROCEDURE p AS BEGIN NULL; END;\n/"),
            "CREATE /* comment */ OR REPLACE PROCEDURE p AS BEGIN NULL; END;"
        );
    }

    #[test]
    fn splits_package_units_without_splitting_procedures() {
        let spec = "CREATE OR REPLACE PACKAGE demo AS PROCEDURE p; END demo;";
        let script = format!("{spec}\r\n / \r\n{BODY}\n/\nSELECT 4/2 FROM DUAL;\n/\n");
        assert_eq!(
            split_statements(&script),
            vec![spec, BODY, "SELECT 4/2 FROM DUAL;"]
        );
        assert_eq!(split_statements(BODY), vec![BODY]);
        assert!(split_statements(";\n/\n-- comment").is_empty());
    }

    #[test]
    fn preserves_anonymous_blocks_and_ordinary_sql() {
        assert_eq!(
            split_statements("BEGIN NULL; END;\n/\nSELECT ';' FROM DUAL;"),
            vec!["BEGIN NULL; END;", "SELECT ';' FROM DUAL;"]
        );
        assert_eq!(
            split_statements("SELECT 1 FROM DUAL; SELECT 2 FROM DUAL;"),
            vec!["SELECT 1 FROM DUAL;", "SELECT 2 FROM DUAL;"]
        );
    }

    #[test]
    fn preserves_large_packages() {
        let procedures: String = (0..1500)
            .map(|i| format!("PROCEDURE p{i} IS BEGIN NULL; END p{i};\n"))
            .collect();
        let sql =
            format!("CREATE OR REPLACE PACKAGE BODY big_package AS\n{procedures}END big_package;");
        assert_eq!(prepare(&sql), sql);
        assert_eq!(split_statements(&sql), vec![sql]);
    }
}
