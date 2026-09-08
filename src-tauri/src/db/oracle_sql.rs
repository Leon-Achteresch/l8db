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

#[cfg(test)]
mod tests {
    use super::*;

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
