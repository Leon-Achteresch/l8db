use super::DatabaseKind;

#[derive(Clone, Copy, PartialEq)]
pub enum Dialect {
    Lenient,
    Standard,
    Postgres,
    Mysql,
    Mssql,
}

pub fn split(sql: &str) -> Vec<String> {
    split_dialect(sql, Dialect::Lenient)
}

pub fn split_postgres(sql: &str) -> Vec<String> {
    split_dialect(sql, Dialect::Postgres)
}

pub fn split_mssql(sql: &str) -> Vec<String> {
    split_dialect(sql, Dialect::Mssql)
}

pub fn split_for(kind: DatabaseKind, sql: &str) -> Vec<String> {
    split_dialect(
        sql,
        match kind {
            DatabaseKind::Postgres => Dialect::Postgres,
            DatabaseKind::Mysql => Dialect::Mysql,
            DatabaseKind::Mssql => Dialect::Mssql,
            DatabaseKind::Sqlite | DatabaseKind::SqliteHttp | DatabaseKind::Duckdb => {
                Dialect::Standard
            }
            _ => Dialect::Lenient,
        },
    )
}

const ROUTINE_OBJECTS: &[&str] = &["TRIGGER", "PROCEDURE", "FUNCTION", "EVENT"];
const MSSQL_BATCH_OBJECTS: &[&str] = &["PROCEDURE", "PROC", "FUNCTION", "TRIGGER"];
const END_SUFFIXES: &[&str] = &["IF", "LOOP", "WHILE", "REPEAT"];

fn word_char(byte: Option<&u8>) -> bool {
    byte.is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
}

fn line_end(sql: &str, from: usize) -> usize {
    sql[from..].find('\n').map_or(sql.len(), |n| from + n)
}

fn blank_before(sql: &str, at: usize) -> bool {
    let start = sql[..at].rfind('\n').map_or(0, |n| n + 1);
    sql[start..at].trim().is_empty()
}

fn read_word(bytes: &[u8], from: usize) -> usize {
    let mut end = from;
    while word_char(bytes.get(end)) {
        end += 1;
    }
    end
}

struct Splitter<'a> {
    sql: &'a str,
    out: Vec<String>,
    start: Option<usize>,
    code: bool,
    batch: bool,
    depth: usize,
    words: Vec<String>,
}

impl Splitter<'_> {
    fn flush(&mut self, end: usize) {
        if let Some(start) = self.start.filter(|_| self.code) {
            let text = self.sql[start..end].trim();
            if !text.is_empty() {
                self.out.push(text.to_string());
            }
        }
        self.start = None;
        self.code = false;
        self.batch = false;
        self.depth = 0;
        self.words.clear();
    }
}

pub fn split_dialect(sql: &str, dialect: Dialect) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mysql = dialect == Dialect::Mysql;
    let delimiters = mysql || dialect == Dialect::Lenient;
    let mut s = Splitter {
        sql,
        out: Vec::new(),
        start: None,
        code: false,
        batch: false,
        depth: 0,
        words: Vec::new(),
    };
    let mut delimiter = String::from(";");
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if s.start.is_none() {
            if c.is_ascii_whitespace() {
                i += 1;
                continue;
            }
            s.start = Some(i);
        }
        if delimiter != ";" && sql[i..].starts_with(delimiter.as_str()) {
            s.flush(i);
            i += delimiter.len();
            continue;
        }
        if bytes[i..].starts_with(b"--") || (mysql && c == b'#') {
            i = sql[i..].find('\n').map_or(bytes.len(), |n| i + n + 1);
            continue;
        }
        if bytes[i..].starts_with(b"/*") {
            let mut depth = 1;
            i += 2;
            while i < bytes.len() && depth > 0 {
                if bytes[i..].starts_with(b"/*") {
                    depth += 1;
                    i += 2;
                } else if bytes[i..].starts_with(b"*/") {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            continue;
        }
        if (c.is_ascii_alphabetic() || c == b'_') && (i == 0 || !word_char(bytes.get(i - 1))) {
            let start = i;
            i = read_word(bytes, start);
            let word = sql[start..i].to_ascii_uppercase();
            if dialect == Dialect::Mssql && word == "GO" && blank_before(sql, start) {
                let end = line_end(sql, i);
                let rest = sql[i..end].trim();
                if rest.is_empty() || rest.starts_with("--") {
                    s.flush(start);
                    i = end;
                    continue;
                }
            }
            if delimiters && word == "DELIMITER" && !s.code && s.words.is_empty() {
                let end = line_end(sql, i);
                if let Some(next) = sql[i..end].split_whitespace().next() {
                    if bytes.get(i).is_some_and(u8::is_ascii_whitespace) {
                        delimiter = next.to_string();
                        s.start = None;
                        i = end;
                        continue;
                    }
                }
            }
            s.code = true;
            if s.words.len() < 8 {
                s.words.push(word.clone());
            }
            let first = s.words[0].as_str();
            if dialect == Dialect::Mssql {
                let object = s.words[1..].iter().find(|w| *w != "OR" && *w != "ALTER");
                s.batch |= matches!(first, "CREATE" | "ALTER")
                    && object.is_some_and(|w| MSSQL_BATCH_OBJECTS.contains(&w.as_str()));
                continue;
            }
            let prev = if start > 0 { bytes[start - 1] } else { b' ' };
            if first != "CREATE"
                || prev == b'.'
                || prev == b'@'
                || !s.words[1..]
                    .iter()
                    .any(|w| ROUTINE_OBJECTS.contains(&w.as_str()))
            {
                continue;
            }
            if word == "BEGIN" || word == "CASE" {
                s.depth += 1;
            } else if word == "END" {
                let mut next = i;
                while bytes.get(next).is_some_and(u8::is_ascii_whitespace) {
                    next += 1;
                }
                let next_end = read_word(bytes, next);
                let suffix = sql[next..next_end].to_ascii_uppercase();
                if END_SUFFIXES.contains(&suffix.as_str()) {
                    i = next_end;
                    continue;
                }
                if suffix == "CASE" {
                    i = next_end;
                }
                s.depth = s.depth.saturating_sub(1);
            }
            continue;
        }
        if c == b'\'' {
            s.code = true;
            let escaped = match dialect {
                Dialect::Mysql | Dialect::Lenient => true,
                _ => {
                    i > 0
                        && matches!(bytes[i - 1], b'e' | b'E')
                        && (i < 2 || !(word_char(bytes.get(i - 2)) || bytes[i - 2] == b'.'))
                }
            };
            i += 1;
            while i < bytes.len() {
                if escaped && bytes[i] == b'\\' {
                    i = (i + 2).min(bytes.len());
                } else if bytes[i] == b'\'' {
                    i += 1;
                    if bytes.get(i) != Some(&b'\'') {
                        break;
                    }
                    i += 1;
                } else {
                    i += 1;
                }
            }
            continue;
        }
        if matches!(c, b'"' | b'`' | b'[') {
            s.code = true;
            let close = if c == b'[' { b']' } else { c };
            i += 1;
            while i < bytes.len() {
                if mysql && bytes[i] == b'\\' {
                    i = (i + 2).min(bytes.len());
                } else if bytes[i] == close {
                    i += 1;
                    if bytes.get(i) != Some(&close) {
                        break;
                    }
                    i += 1;
                } else {
                    i += 1;
                }
            }
            continue;
        }
        if c == b'$'
            && bytes
                .get(i + 1)
                .is_some_and(|b| b.is_ascii_alphabetic() || matches!(b, b'_' | b'$'))
            && (i == 0 || !word_char(bytes.get(i - 1)))
        {
            let mut end = i + 1;
            while word_char(bytes.get(end)) {
                end += 1;
            }
            if bytes.get(end) == Some(&b'$') {
                s.code = true;
                let tag = &sql[i..=end];
                i = sql[end + 1..]
                    .find(tag)
                    .map_or(bytes.len(), |n| end + 1 + n + tag.len());
                continue;
            }
        }
        if c == b';' {
            i += 1;
            if !s.batch && s.depth == 0 && delimiter == ";" {
                s.flush(i - 1);
            }
            continue;
        }
        s.code |= !c.is_ascii_whitespace();
        i += 1;
    }
    s.flush(bytes.len());
    s.out
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{split, split_dialect, split_mssql, split_postgres, Dialect};

    pub(crate) fn dialect(name: &str) -> Dialect {
        match name {
            "postgres" => Dialect::Postgres,
            "mysql" => Dialect::Mysql,
            "mssql" => Dialect::Mssql,
            _ => Dialect::Standard,
        }
    }

    pub(crate) fn normalize(text: &str) -> String {
        let mut rest = text.trim_start();
        loop {
            if rest.starts_with("--") {
                rest = rest.find('\n').map_or("", |n| &rest[n + 1..]).trim_start();
            } else if rest.starts_with("/*") {
                rest = rest.find("*/").map_or("", |n| &rest[n + 2..]).trim_start();
            } else {
                break;
            }
        }
        let rest = rest.trim_end();
        rest.strip_suffix(';')
            .unwrap_or(rest)
            .trim_end()
            .to_string()
    }

    #[test]
    fn shared_corpus_matches_frontend_splitter() {
        let corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/sql-splitter-corpus.json"
        ))
        .unwrap();
        let mut checked = 0;
        for case in corpus["cases"].as_array().unwrap() {
            let name = case["dialect"].as_str().unwrap();
            if name == "oracle" {
                continue;
            }
            let sql = case["sql"].as_str().unwrap();
            let expected: Vec<String> = case["statements"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| normalize(v.as_str().unwrap()))
                .collect();
            let actual: Vec<String> = split_dialect(sql, dialect(name))
                .iter()
                .map(|s| normalize(s))
                .collect();
            assert_eq!(actual, expected, "{}", case["name"]);
            checked += 1;
        }
        assert!(checked >= 6);
    }

    #[test]
    fn postgres_standard_strings_keep_backslashes_literal() {
        assert_eq!(split_postgres(r"SELECT '\'; SELECT 2").len(), 2);
        assert_eq!(split_postgres(r"SELECT E'a\';b'; SELECT 2").len(), 2);
    }

    #[test]
    fn mssql_batches_keep_procedure_bodies_and_backslash_literals() {
        let proc = "CREATE PROCEDURE dbo.p AS\nBEGIN\n  SET NOCOUNT ON;\n  SELECT 'C:\\';\nEND;";
        assert_eq!(
            split_mssql(&format!("{proc}\nGO\nSELECT 1;\nSELECT 2")),
            vec![proc, "SELECT 1", "SELECT 2"]
        );
        assert_eq!(split_mssql(proc), vec![proc]);
    }

    #[test]
    fn preserves_literals_comments_and_function_bodies() {
        let sql = "-- setup;\nINSERT INTO t VALUES ('ä;b'); /* outer; /* nested; */ */ CREATE FUNCTION f() RETURNS void AS $body$ BEGIN PERFORM 1; END; $body$ LANGUAGE plpgsql; -- end;";
        let statements = split(sql);
        assert_eq!(statements.len(), 2);
        assert!(statements[0].contains("'ä;b'"));
        assert!(statements[1].contains("BEGIN PERFORM 1; END;"));
        assert!(split("/* only; */ -- comment;").is_empty());
        assert_eq!(split("SELECT 'it''s;a', [a;b]; SELECT 2").len(), 2);
    }
}
