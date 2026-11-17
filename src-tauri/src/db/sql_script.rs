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
    mssql_batches(sql)
}

pub fn mssql_batches(sql: &str) -> Vec<String> {
    let mut out = Vec::new();
    for batch in split_inner(sql, Dialect::Mssql, true).0 {
        let (statements, spans) = split_inner(&batch, Dialect::Mssql, false);
        let mut run: Vec<usize> = Vec::new();
        let flush = |run: &mut Vec<usize>, out: &mut Vec<String>| {
            match run.as_slice() {
                [] => {}
                [one] => out.push(terminated(&statements[*one])),
                [first, .., last] if run.iter().any(|i| needs_batch(&statements[*i])) => {
                    out.push(terminated(&batch[spans[*first].0..spans[*last].1]))
                }
                _ => out.extend(run.iter().map(|i| terminated(&statements[*i]))),
            }
            run.clear();
        };
        for (index, statement) in statements.iter().enumerate() {
            if super::mssql::starts_batch(statement) {
                flush(&mut run, &mut out);
                out.push(statement.clone());
            } else {
                run.push(index);
            }
        }
        flush(&mut run, &mut out);
    }
    out
}

fn terminated(statement: &str) -> String {
    if super::mssql::code_words(statement)
        .iter()
        .any(|w| w == "MERGE")
    {
        format!("{statement};")
    } else {
        statement.to_string()
    }
}

fn needs_batch(statement: &str) -> bool {
    let words = super::mssql::code_words(statement);
    let first = words.first().map(String::as_str);
    words
        .iter()
        .enumerate()
        .any(|(i, word)| match word.as_str() {
            w if w.starts_with('@') => !w.starts_with("@@"),
            "DECLARE" | "WHILE" | "GOTO" | "RETURN" | "BREAK" | "CONTINUE" | "TRY" | "CATCH" => {
                true
            }
            "IF" => first != Some("DROP"),
            "BEGIN" => !words.get(i + 1).is_some_and(|next| {
                matches!(
                    next.as_str(),
                    "TRAN" | "TRANSACTION" | "DISTRIBUTED" | "DIALOG" | "CONVERSATION"
                )
            }),
            _ => false,
        })
}

const CONSOLE_METHODS: [&str; 6] = ["GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"];

fn is_console_request_line(line: &str) -> bool {
    let Some((method, rest)) = line.trim().split_once(char::is_whitespace) else {
        return false;
    };
    let rest = rest.trim_start();
    !rest.is_empty()
        && !rest.starts_with('{')
        && CONSOLE_METHODS
            .iter()
            .any(|known| known.eq_ignore_ascii_case(method))
}

pub fn console_requests(sql: &str) -> Option<Vec<String>> {
    let finish = |request: String| {
        request
            .trim_end_matches(|c: char| c.is_whitespace() || c == ';')
            .to_string()
    };
    let mut requests = Vec::new();
    let mut current: Option<String> = None;
    for line in sql.split('\n') {
        let trimmed = line.trim();
        if is_console_request_line(line) {
            requests.extend(current.take().map(finish));
            current = Some(line.trim_start().to_string());
        } else if let Some(request) = current.as_mut() {
            request.push('\n');
            request.push_str(line);
        } else if !trimmed.is_empty() && !trimmed.starts_with('#') && !trimmed.starts_with("//") {
            return None;
        }
    }
    requests.extend(current.map(finish));
    (!requests.is_empty()).then_some(requests)
}

pub fn split_for(kind: DatabaseKind, sql: &str) -> Vec<String> {
    split_dialect(
        sql,
        match kind {
            DatabaseKind::Postgres => Dialect::Postgres,
            DatabaseKind::Mysql => Dialect::Mysql,
            DatabaseKind::Mssql => return mssql_batches(sql),
            DatabaseKind::Cassandra => return super::cassandra::split_script(sql),
            DatabaseKind::Elasticsearch => match console_requests(sql) {
                Some(requests) => return requests,
                None => Dialect::Lenient,
            },
            DatabaseKind::Sqlite | DatabaseKind::SqliteHttp | DatabaseKind::Duckdb => {
                Dialect::Standard
            }
            _ => Dialect::Lenient,
        },
    )
}

pub const CONNECT_UNSUPPORTED: &str = "CONNECT/DISCONNECT wird nicht unterstützt. Das Skript wurde angehalten, damit die folgenden Statements nicht im falschen Schema laufen.";

pub fn abbreviates(word: &str, forms: &[(&str, usize)]) -> bool {
    forms
        .iter()
        .any(|(full, min)| word.len() >= *min && full.starts_with(word))
}

pub fn is_connect_command(line: &str) -> bool {
    line.split_whitespace().next().is_some_and(|word| {
        abbreviates(
            &word.trim_end_matches(';').to_ascii_uppercase(),
            &[("CONNECT", 4), ("DISCONNECT", 4)],
        )
    })
}

#[tauri::command]
pub fn sql_search_path() -> Vec<String> {
    std::env::var_os("SQLPATH")
        .map(|value| {
            std::env::split_paths(&value)
                .filter(|path| !path.as_os_str().is_empty())
                .map(|path| path.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

const ROUTINE_OBJECTS: &[&str] = &["TRIGGER", "PROCEDURE", "FUNCTION", "EVENT"];
const MSSQL_BATCH_OBJECTS: &[&str] = &["PROCEDURE", "PROC", "FUNCTION", "TRIGGER"];
const END_SUFFIXES: &[&str] = &["IF", "LOOP", "WHILE", "REPEAT"];
const MAX_GO_REPEAT: usize = 10_000;

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
    spans: Vec<(usize, usize)>,
    start: Option<usize>,
    code: bool,
    batch: bool,
    depth: usize,
    words: Vec<String>,
}

impl Splitter<'_> {
    fn flush(&mut self, end: usize) {
        if let Some(start) = self.start.filter(|_| self.code) {
            let raw = &self.sql[start..end];
            let text = raw.trim();
            if !text.is_empty() {
                let from = start + raw.len() - raw.trim_start().len();
                self.spans.push((from, from + text.len()));
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
    split_inner(sql, dialect, false).0
}

fn split_inner(sql: &str, dialect: Dialect, go_only: bool) -> (Vec<String>, Vec<(usize, usize)>) {
    let bytes = sql.as_bytes();
    let mysql = dialect == Dialect::Mysql;
    let delimiters = mysql || dialect == Dialect::Lenient;
    let mut s = Splitter {
        sql,
        out: Vec::new(),
        spans: Vec::new(),
        start: None,
        code: false,
        batch: false,
        depth: 0,
        words: Vec::new(),
    };
    let mut delimiter = String::from(";");
    let mut go_from = 0;
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
        if delimiter != ";" && bytes[i..].starts_with(delimiter.as_bytes()) {
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
                if !mysql && bytes[i..].starts_with(b"/*") {
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
                let digits =
                    rest.len() - rest.trim_start_matches(|c: char| c.is_ascii_digit()).len();
                let tail = rest[digits..].trim_start();
                if tail.is_empty() || tail.starts_with("--") {
                    s.flush(start);
                    let repeat = rest[..digits]
                        .parse::<usize>()
                        .unwrap_or(1)
                        .clamp(1, MAX_GO_REPEAT);
                    let batch = s.out[go_from..].to_vec();
                    let spans = s.spans[go_from..].to_vec();
                    for _ in 1..repeat {
                        s.out.extend(batch.iter().cloned());
                        s.spans.extend(spans.iter().copied());
                    }
                    go_from = s.out.len();
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
            if dialect == Dialect::Postgres
                && s.words.first().is_some_and(|w| w == "COPY")
                && s.words.iter().any(|w| w == "STDIN")
            {
                let mut end = line_end(sql, i);
                while end < bytes.len() {
                    let next = line_end(sql, end + 1);
                    let line = sql[end + 1..next].trim_end_matches('\r');
                    end = next;
                    if line == "\\." {
                        break;
                    }
                }
                s.flush(end);
                i = end;
                continue;
            }
            if !go_only && !s.batch && s.depth == 0 && delimiter == ";" {
                s.flush(i - 1);
            }
            continue;
        }
        s.code |= !c.is_ascii_whitespace();
        i += 1;
    }
    s.flush(bytes.len());
    (s.out, s.spans)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::{split, split_dialect, split_mssql, split_postgres, Dialect};

    #[test]
    fn copy_from_stdin_keeps_its_data_in_one_statement() {
        let parts = split_dialect(
            "COPY public.t (a, b) FROM STDIN;\n1\tx;y\n2\tz\n\\.\nSELECT 1;\nCOPY t FROM stdin;\n3",
            Dialect::Postgres,
        );
        assert_eq!(
            parts,
            vec![
                "COPY public.t (a, b) FROM STDIN;\n1\tx;y\n2\tz\n\\.".to_string(),
                "SELECT 1".to_string(),
                "COPY t FROM stdin;\n3".to_string(),
            ]
        );
    }

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
    fn only_mysql_ends_block_comments_at_the_first_close() {
        let sql = "/* alt: /* x */ select 1; select 2;";
        assert_eq!(split_dialect(sql, Dialect::Mysql).len(), 2);
        assert!(split_dialect(sql, Dialect::Mssql).is_empty());
        assert!(split_postgres(sql).is_empty());
        assert_eq!(split_mssql("select 1\nGO 3\n").len(), 3);
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
    fn custom_delimiters_survive_non_ascii_text() {
        let sql = "DELIMITER //\nCREATE PROCEDURE p() BEGIN DECLARE größe INT; SELECT 'ä//ö'; END//\nSELECT 'é'//";
        for dialect in [Dialect::Mysql, Dialect::Lenient] {
            assert_eq!(
                split_dialect(sql, dialect),
                vec![
                    "CREATE PROCEDURE p() BEGIN DECLARE größe INT; SELECT 'ä//ö'; END",
                    "SELECT 'é'"
                ]
            );
        }
        assert!(super::is_connect_command("conn scott/tiger"));
        assert!(!super::is_connect_command("CONNECTION"));
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
        assert_eq!(
            split_mssql("SELECT 0\nGO\nSELECT 1;\nSELECT 2\nGO 2 -- zweimal\nSELECT 3"),
            vec!["SELECT 0", "SELECT 1", "SELECT 2", "SELECT 1", "SELECT 2", "SELECT 3"]
        );
    }

    #[test]
    fn mssql_keeps_batch_scope_together_and_splits_plain_statements() {
        assert_eq!(
            split_mssql("DECLARE @x INT = 5; SELECT @x AS v;"),
            vec!["DECLARE @x INT = 5; SELECT @x AS v"]
        );
        assert_eq!(
            split_mssql("SELECT 1 AS a; SELECT @@VERSION;\nGO\nDECLARE @o INT; SELECT @o"),
            vec![
                "SELECT 1 AS a",
                "SELECT @@VERSION",
                "DECLARE @o INT; SELECT @o"
            ]
        );
        assert_eq!(
            split_mssql("SELECT 1; CREATE VIEW v AS SELECT 1; DECLARE @x INT; SELECT @x"),
            vec![
                "SELECT 1",
                "CREATE VIEW v AS SELECT 1",
                "DECLARE @x INT; SELECT @x"
            ]
        );
        assert_eq!(
            split_mssql("BEGIN TRAN; INSERT INTO t VALUES (1); DROP TABLE IF EXISTS x"),
            vec![
                "BEGIN TRAN",
                "INSERT INTO t VALUES (1)",
                "DROP TABLE IF EXISTS x"
            ]
        );
        assert_eq!(
            split_mssql("IF 1 = 1 BEGIN SELECT 1; SELECT 2; END; SELECT 'DECLARE @y'"),
            vec!["IF 1 = 1 BEGIN SELECT 1; SELECT 2; END; SELECT 'DECLARE @y'"]
        );
        assert_eq!(
            split_mssql("MERGE t USING s ON t.a = s.a WHEN MATCHED THEN DELETE; SELECT 1"),
            vec![
                "MERGE t USING s ON t.a = s.a WHEN MATCHED THEN DELETE;",
                "SELECT 1"
            ]
        );
        assert_eq!(
            super::split_for(
                super::DatabaseKind::Mssql,
                "SELECT CASE WHEN 1 = 1 THEN 1 ELSE 2 END; SELECT TRY_CAST('1' AS INT)"
            )
            .len(),
            2
        );
    }

    #[test]
    fn elasticsearch_console_requests_split_per_request_line() {
        let es = super::DatabaseKind::Elasticsearch;
        let sql = "# Suche\nGET a/_search\n{\n  \"query\": { \"match_all\": {} }\n}\n\nGET b/_search\nPOST logs/_doc;\n{\"a\": 1};\n";
        assert_eq!(
            super::split_for(es, sql),
            vec![
                "GET a/_search\n{\n  \"query\": { \"match_all\": {} }\n}",
                "GET b/_search",
                "POST logs/_doc;\n{\"a\": 1}",
            ]
        );
        assert_eq!(
            super::split_for(es, "SELECT 1;\nDELETE FROM logs;"),
            vec!["SELECT 1", "DELETE FROM logs"]
        );
        assert_eq!(super::split_for(es, "GET {\"x\": 1}").len(), 1);
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
