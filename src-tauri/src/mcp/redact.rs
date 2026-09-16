use regex::{Regex, RegexBuilder};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

use super::config::Redaction;

pub struct Redactor {
    columns: Vec<Regex>,
    values: Vec<Regex>,
    replacement: String,
}

pub fn compile(pattern: &str, case_insensitive: bool) -> Result<Regex, String> {
    RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .size_limit(1 << 20)
        .build()
        .map_err(|e| e.to_string())
}

impl Redactor {
    pub fn new(redaction: &Redaction, extra_columns: &[String]) -> Self {
        let columns = redaction
            .columns
            .iter()
            .filter(|rule| rule.enabled)
            .map(|rule| rule.pattern.as_str())
            .chain(extra_columns.iter().map(String::as_str))
            .filter_map(|pattern| compile(pattern, true).ok())
            .collect();
        let values = redaction
            .values
            .iter()
            .filter(|rule| rule.enabled)
            .filter_map(|rule| compile(&rule.pattern, false).ok())
            .collect();
        Self {
            columns,
            values,
            replacement: redaction.replacement.clone(),
        }
    }

    pub fn column_is_sensitive(&self, name: &str) -> bool {
        self.columns.iter().any(|re| re.is_match(name))
    }

    pub fn redact_text(&self, text: &str) -> String {
        let mut out = text.to_string();
        for re in &self.values {
            if re.is_match(&out) {
                out = re.replace_all(&out, self.replacement.as_str()).into_owned();
            }
        }
        out
    }

    fn redact_nested(&self, value: &Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.redact_text(text)),
            Value::Array(list) => Value::Array(list.iter().map(|v| self.redact_nested(v)).collect()),
            Value::Object(map) => Value::Object(
                map.iter()
                    .map(|(key, v)| {
                        let masked = if v.is_null() {
                            Value::Null
                        } else if self.column_is_sensitive(key) {
                            Value::String(self.replacement.clone())
                        } else {
                            self.redact_nested(v)
                        };
                        (key.clone(), masked)
                    })
                    .collect(),
            ),
            other => other.clone(),
        }
    }

    pub fn redact_cell(&self, column: &str, value: &Value) -> Value {
        if value.is_null() {
            return Value::Null;
        }
        if self.column_is_sensitive(column) {
            return Value::String(self.replacement.clone());
        }
        match value {
            Value::String(text) => Value::String(self.redact_text(text)),
            Value::Number(number) => {
                let text = number.to_string();
                let redacted = self.redact_text(&text);
                if redacted == text {
                    value.clone()
                } else {
                    Value::String(redacted)
                }
            }
            Value::Array(_) | Value::Object(_) => {
                let nested = self.redact_nested(value);
                Value::String(self.redact_text(&nested.to_string()))
            }
            other => other.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Word(String),
    Dot,
    Semi,
    Comma,
    Open,
    Close,
    Other(char),
}

pub fn tokenize(sql: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut chars = sql.chars().peekable();
    let flush = |current: &mut String, tokens: &mut Vec<Token>| {
        if !current.is_empty() {
            tokens.push(Token::Word(current.to_lowercase()));
            current.clear();
        }
    };
    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                flush(&mut current, &mut tokens);
                loop {
                    match chars.next() {
                        Some('\'') if chars.peek() == Some(&'\'') => {
                            chars.next();
                        }
                        Some('\'') | None => break,
                        Some('\\') => {
                            chars.next();
                        }
                        Some(_) => {}
                    }
                }
                tokens.push(Token::Other('\''));
            }
            '"' | '`' | '[' => {
                flush(&mut current, &mut tokens);
                let close = if c == '[' { ']' } else { c };
                let mut ident = String::new();
                loop {
                    match chars.next() {
                        Some(ch) if ch == close && chars.peek() == Some(&close) => {
                            chars.next();
                            ident.push(ch);
                        }
                        Some(ch) if ch == close => break,
                        Some(ch) => ident.push(ch),
                        None => break,
                    }
                }
                tokens.push(Token::Word(ident.to_lowercase()));
            }
            '$' if chars.peek().is_some_and(|n| *n == '$' || n.is_alphabetic() || *n == '_') => {
                flush(&mut current, &mut tokens);
                let mut tag = String::from("$");
                while let Some(&n) = chars.peek() {
                    tag.push(n);
                    chars.next();
                    if n == '$' {
                        break;
                    }
                }
                if tag.ends_with('$') && tag.len() > 1 {
                    let mut body = String::new();
                    while let Some(n) = chars.next() {
                        body.push(n);
                        if body.ends_with(&tag) {
                            break;
                        }
                    }
                    tokens.push(Token::Other('\''));
                } else {
                    tokens.push(Token::Other('$'));
                }
            }
            '-' if chars.peek() == Some(&'-') => {
                flush(&mut current, &mut tokens);
                for n in chars.by_ref() {
                    if n == '\n' {
                        break;
                    }
                }
            }
            '#' => {
                flush(&mut current, &mut tokens);
                for n in chars.by_ref() {
                    if n == '\n' {
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                flush(&mut current, &mut tokens);
                chars.next();
                if matches!(chars.peek(), Some('!') | Some('+')) {
                    tokens.push(Token::Other('/'));
                    continue;
                }
                let mut depth = 1;
                while let Some(n) = chars.next() {
                    if n == '/' && chars.peek() == Some(&'*') {
                        chars.next();
                        depth += 1;
                    } else if n == '*' && chars.peek() == Some(&'/') {
                        chars.next();
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                }
            }
            '*' if chars.peek() == Some(&'/') => {
                flush(&mut current, &mut tokens);
                chars.next();
            }
            '.' => {
                flush(&mut current, &mut tokens);
                tokens.push(Token::Dot);
            }
            ';' => {
                flush(&mut current, &mut tokens);
                tokens.push(Token::Semi);
            }
            ',' => {
                flush(&mut current, &mut tokens);
                tokens.push(Token::Comma);
            }
            '(' => {
                flush(&mut current, &mut tokens);
                tokens.push(Token::Open);
            }
            ')' => {
                flush(&mut current, &mut tokens);
                tokens.push(Token::Close);
            }
            c if c.is_alphanumeric() || c == '_' => current.push(c),
            c if c.is_whitespace() => flush(&mut current, &mut tokens),
            other => {
                flush(&mut current, &mut tokens);
                tokens.push(Token::Other(other));
            }
        }
    }
    flush(&mut current, &mut tokens);
    tokens
}

pub fn sql_words(sql: &str) -> Vec<String> {
    tokenize(sql)
        .into_iter()
        .filter_map(|token| match token {
            Token::Word(word) => Some(word),
            _ => None,
        })
        .collect()
}

const WRITE_WORDS: &[&str] = &[
    "insert", "update", "delete", "merge", "upsert", "replace", "drop", "alter", "create",
    "truncate", "grant", "revoke", "call", "exec", "execute", "copy", "vacuum", "analyze",
    "lock", "set", "reset", "refresh", "do", "into", "load", "import", "attach", "detach",
    "rename", "comment", "cluster", "reindex", "begin", "commit", "rollback", "savepoint",
    "prepare", "deallocate", "listen", "notify", "unlisten", "declare", "fetch", "move",
    "close", "discard", "security", "reassign", "kill", "shutdown", "use", "optimize",
    "system", "purge", "flush", "install", "pragma", "bulk", "backup", "restore", "dbcc",
    "returning", "output", "nextval", "setval", "lastval",
];

const DANGEROUS_ALWAYS: &[&str] = &[
    "waitfor", "reconfigure", "cmdshell", "httpuritype", "ctxsys", "fts3_tokenizer",
    "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf", "pg_rotate_logfile",
];

const DANGEROUS_FUNCTIONS: &[&str] = &[
    "pg_read_file", "pg_read_binary_file", "pg_stat_file", "pg_sleep", "pg_sleep_for",
    "pg_sleep_until", "lo_import", "lo_export", "lo_get", "lo_put", "dblink", "dblink_exec",
    "dblink_connect", "load_file", "benchmark", "sleep", "readfile", "writefile",
    "load_extension", "openrowset", "opendatasource", "openquery", "url", "file", "s3", "hdfs",
    "mysql", "postgresql", "odbc", "jdbc", "remote", "remotesecure", "input", "program",
    "query_to_xml", "database_to_xml", "schema_to_xml", "table_to_xml", "xmltype",
];

const DANGEROUS_PREFIXES: &[&str] = &["xp_", "sp_", "dbms_", "utl_", "pg_ls_"];

const DDL_WORDS: &[&str] = &[
    "create", "alter", "drop", "truncate", "rename", "grant", "revoke", "comment", "reindex",
    "cluster", "attach", "detach", "install", "vacuum",
];

const ALIAS_STOP: &[&str] = &[
    "on", "where", "join", "left", "right", "inner", "outer", "cross", "natural", "full",
    "using", "group", "order", "limit", "having", "union", "except", "intersect", "minus",
    "set", "values", "returning", "window", "fetch", "offset", "for", "lateral", "tablesample",
    "as", "and", "or", "not", "select", "from", "with", "straight_join", "only", "in", "is",
    "like", "between", "exists", "case", "when", "then", "else", "end", "null", "distinct",
    "top", "into", "start", "connect", "qualify", "sample", "final", "prewhere", "array",
    "unnest", "settings", "format",
];

const FROM_START: &[&str] = &["from", "join", "update", "into", "table", "only", "lateral"];
const FROM_END: &[&str] = &[
    "where", "group", "order", "limit", "having", "union", "except", "intersect", "minus",
    "on", "select", "set", "values", "returning", "window", "fetch", "offset", "for", "with",
    "qualify", "prewhere", "settings", "format",
];

pub fn write_word(sql: &str) -> Option<String> {
    sql_words(sql)
        .into_iter()
        .find(|word| WRITE_WORDS.contains(&word.as_str()))
}

pub fn dangerous_word(sql: &str) -> Option<String> {
    let tokens = tokenize(sql);
    for (i, token) in tokens.iter().enumerate() {
        if let Token::Word(word) = token {
            let always = DANGEROUS_ALWAYS.contains(&word.as_str())
                || DANGEROUS_PREFIXES.iter().any(|prefix| word.starts_with(prefix));
            let as_function = tokens.get(i + 1) == Some(&Token::Open)
                && DANGEROUS_FUNCTIONS.contains(&word.as_str());
            if always || as_function {
                return Some(word.clone());
            }
        }
    }
    None
}

pub fn is_ddl(sql: &str) -> bool {
    sql_words(sql)
        .iter()
        .any(|word| DDL_WORDS.contains(&word.as_str()))
}

pub fn statement_count(sql: &str) -> usize {
    let mut count = 0;
    let mut seen = false;
    for token in tokenize(sql) {
        match token {
            Token::Semi => {
                if seen {
                    count += 1;
                }
                seen = false;
            }
            _ => seen = true,
        }
    }
    count + usize::from(seen)
}

pub struct SchemaIndex {
    pub sensitive_columns: HashSet<String>,
    pub tables: HashMap<String, HashSet<String>>,
    pub allowed_schemas: HashSet<String>,
}

impl SchemaIndex {
    pub fn new(
        columns: &[crate::db::ColumnInfo],
        redactor: &Redactor,
        allowed_schemas: &[String],
    ) -> Self {
        let mut sensitive_columns = HashSet::new();
        let mut tables: HashMap<String, HashSet<String>> = HashMap::new();
        for column in columns {
            if redactor.column_is_sensitive(&column.name) {
                sensitive_columns.insert(column.name.to_lowercase());
            }
            tables
                .entry(column.table.to_lowercase())
                .or_default()
                .insert(column.schema.to_lowercase());
        }
        Self {
            sensitive_columns,
            tables,
            allowed_schemas: allowed_schemas.iter().map(|s| s.to_lowercase()).collect(),
        }
    }

    fn table_hidden(&self, table: &str) -> bool {
        if self.allowed_schemas.is_empty() {
            return false;
        }
        self.tables
            .get(table)
            .is_some_and(|schemas| schemas.iter().all(|schema| !self.allowed_schemas.contains(schema)))
    }
}

pub fn check_references(sql: &str, index: &SchemaIndex) -> Result<(), String> {
    let tokens = tokenize(sql);
    for token in &tokens {
        if let Token::Word(word) = token {
            if index.sensitive_columns.contains(word) {
                return Err(format!(
                    "Spalte '{word}' ist redigiert und darf in SQL nicht referenziert werden (auch nicht per Alias, Funktion oder WHERE). SELECT * liefert sie maskiert."
                ));
            }
            if !index.allowed_schemas.is_empty()
                && !index.allowed_schemas.contains(word)
                && index.tables.values().any(|schemas| schemas.contains(word))
            {
                return Err(format!("Schema '{word}' ist für diese Verbindung nicht freigegeben."));
            }
            if index.table_hidden(word) {
                return Err(format!("Tabelle '{word}' liegt in einem nicht freigegebenen Schema."));
            }
        }
    }
    let mut depth = 0i32;
    for (i, token) in tokens.iter().enumerate() {
        match token {
            Token::Open => depth += 1,
            Token::Close => depth -= 1,
            Token::Other('*')
                if depth > 0 && tokens.get(i.wrapping_sub(1)) == Some(&Token::Dot) =>
            {
                return Err("Zeilenexpansion (alias.*) ist nur als direkte Spaltenauswahl erlaubt, nicht in Funktionen oder Ausdrücken.".into());
            }
            _ => {}
        }
    }
    let word_at = |i: usize| match tokens.get(i) {
        Some(Token::Word(word)) => Some(word.as_str()),
        _ => None,
    };
    let mut aliases: HashSet<String> = HashSet::new();
    let mut in_from = false;
    let mut depth_stack: Vec<bool> = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        match token {
            Token::Word(word) if FROM_START.contains(&word.as_str()) => in_from = true,
            Token::Word(word) if FROM_END.contains(&word.as_str()) => in_from = false,
            Token::Open => {
                depth_stack.push(in_from);
                in_from = false;
            }
            Token::Close => {
                in_from = depth_stack.pop().unwrap_or(false);
                if in_from {
                    let mut j = i + 1;
                    if word_at(j) == Some("as") {
                        j += 1;
                    }
                    if let Some(next) = word_at(j) {
                        if !ALIAS_STOP.contains(&next) {
                            aliases.insert(next.to_string());
                        }
                    }
                }
            }
            Token::Word(word) if in_from && index.tables.contains_key(word) => {
                let mut j = i + 1;
                if word_at(j) == Some("as") {
                    j += 1;
                }
                if let Some(next) = word_at(j) {
                    if !ALIAS_STOP.contains(&next) && tokens.get(j + 1) != Some(&Token::Dot) {
                        aliases.insert(next.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    in_from = false;
    depth_stack.clear();
    for (i, token) in tokens.iter().enumerate() {
        match token {
            Token::Word(word) if FROM_START.contains(&word.as_str()) => in_from = true,
            Token::Word(word) if FROM_END.contains(&word.as_str()) => in_from = false,
            Token::Open => {
                depth_stack.push(in_from);
                in_from = false;
            }
            Token::Close => in_from = depth_stack.pop().unwrap_or(false),
            Token::Word(word)
                if !index.allowed_schemas.is_empty()
                    && tokens.get(i + 1) == Some(&Token::Dot)
                    && tokens.get(i.wrapping_sub(1)) != Some(&Token::Dot)
                    && !index.allowed_schemas.contains(word)
                    && !index.tables.contains_key(word)
                    && !aliases.contains(word) =>
            {
                return Err(format!(
                    "'{word}' ist kein freigegebenes Schema, keine bekannte Tabelle und kein Alias."
                ));
            }
            Token::Word(word) if index.tables.contains_key(word) || aliases.contains(word) => {
                let prev = tokens.get(i.wrapping_sub(1));
                let next = tokens.get(i + 1);
                let qualified = next == Some(&Token::Dot) || prev == Some(&Token::Dot);
                let positional = in_from
                    && matches!(
                        prev,
                        Some(Token::Word(_)) | Some(Token::Comma) | Some(Token::Close) | None
                    );
                if !(qualified || positional) {
                    return Err(format!(
                        "'{word}' darf nicht als ganze Zeile ausgegeben werden. Einzelne Spalten wählen, z. B. {word}.spalte."
                    ));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ColumnInfo;
    use crate::mcp::config::McpConfig;

    fn redactor() -> Redactor {
        Redactor::new(&McpConfig::default().redaction, &["kunden_.*".into()])
    }

    fn col(schema: &str, table: &str, name: &str) -> ColumnInfo {
        ColumnInfo {
            schema: schema.into(),
            table: table.into(),
            name: name.into(),
            data_type: "text".into(),
        }
    }

    fn index(allowed: &[&str]) -> SchemaIndex {
        let columns = vec![
            col("public", "users", "id"),
            col("public", "users", "name"),
            col("public", "users", "password"),
            col("public", "users", "email"),
            col("public", "orders", "id"),
            col("public", "orders", "status"),
            col("secret", "vault", "id"),
            col("public", "status", "code"),
        ];
        let allowed: Vec<String> = allowed.iter().map(|s| s.to_string()).collect();
        SchemaIndex::new(&columns, &redactor(), &allowed)
    }

    #[test]
    fn sensitive_columns_are_masked_case_insensitively() {
        let r = redactor();
        for name in ["password", "PassWord", "user_pwd", "api_key", "Email", "iban", "kunden_geheim", "vorname"] {
            assert!(r.column_is_sensitive(name), "{name}");
        }
        for name in ["id", "name", "created_at", "amount", "title"] {
            assert!(!r.column_is_sensitive(name), "{name}");
        }
        assert_eq!(r.redact_cell("password", &Value::from("x")), Value::from("[redacted]"));
        assert_eq!(r.redact_cell("password", &Value::Null), Value::Null);
    }

    #[test]
    fn nested_json_keys_are_masked() {
        let r = redactor();
        let row = serde_json::json!({"id": 1, "password": "hunter2", "profile": {"email": "a@b.de", "nick": "x"}, "tags": [{"token": "t"}], "note": "mail a@b.de"});
        let out = r.redact_cell("row_to_json", &row);
        let text = out.as_str().unwrap();
        assert!(!text.contains("hunter2"), "{text}");
        assert!(!text.contains("a@b.de"), "{text}");
        assert!(!text.contains("\"t\""), "{text}");
        assert!(text.contains("\"nick\":\"x\""), "{text}");
    }

    #[test]
    fn values_are_masked_inside_text() {
        let r = redactor();
        let text = "Mail an max@example.com, IBAN DE89 3704 0044 0532 0130 00, Karte 4111 1111 1111 1111, Tel +49 170 1234567, ip 10.0.0.1";
        let out = r.redact_text(text);
        for leak in ["example.com", "3704", "4111", "1234567", "10.0.0.1"] {
            assert!(!out.contains(leak), "{out}");
        }
        assert!(out.starts_with("Mail an [redacted]"), "{out}");
        assert_eq!(r.redact_text("Bestellung 42 von heute"), "Bestellung 42 von heute");
        assert_eq!(r.redact_cell("amount", &Value::from(1234)), Value::from(1234));
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        assert_eq!(r.redact_text(jwt), "[redacted]");
        let bcrypt = "$2b$12$KIXxLQ3Q8pq8eXqXk3q2Ue0mZg1XfE3Z0FQeHnQxVv0aGm1x5uZ6y";
        assert_eq!(r.redact_text(bcrypt), "[redacted]");
        assert_eq!(r.redact_text("550e8400-e29b-41d4-a716-446655440000"), "550e8400-e29b-41d4-a716-446655440000");
    }

    #[test]
    fn disabled_rules_do_nothing() {
        let mut config = McpConfig::default();
        for rule in config.redaction.values.iter_mut() {
            rule.enabled = false;
        }
        let r = Redactor::new(&config.redaction, &[]);
        assert_eq!(r.redact_text("max@example.com"), "max@example.com");
    }

    #[test]
    fn tokenizer_handles_quotes_comments_and_executable_comments() {
        assert_eq!(sql_words("SELECT \"Delete\" FROM t -- drop\n/* alter */"), vec!["select", "delete", "from", "t"]);
        assert_eq!(sql_words("select 'it''s; delete' from t"), vec!["select", "from", "t"]);
        assert_eq!(sql_words("select $$ delete $$ from t"), vec!["select", "from", "t"]);
        assert_eq!(sql_words("select $tag$ x $tag$"), vec!["select"]);
        assert_eq!(sql_words("select 1 /*! delete from t */"), vec!["select", "1", "delete", "from", "t"]);
        assert_eq!(sql_words("select 1 /* outer /* inner */ delete */"), vec!["select", "1"]);
        assert_eq!(sql_words("select 1 # delete\nfrom t"), vec!["select", "1", "from", "t"]);
        assert_eq!(sql_words("select [Password] from t"), vec!["select", "password", "from", "t"]);
        assert_eq!(sql_words("select `email` from t"), vec!["select", "email", "from", "t"]);
    }

    #[test]
    fn classifies_sql() {
        assert_eq!(write_word("SELECT * FROM users WHERE name = 'DROP TABLE'"), None);
        assert_eq!(write_word("select 1 -- delete\n/* update */"), None);
        assert_eq!(write_word("WITH x AS (SELECT 1) SELECT * FROM x"), None);
        assert_eq!(write_word("explain select 1"), None);
        assert_eq!(write_word("SELECT \"delete\" FROM t"), Some("delete".into()));
        assert_eq!(write_word("DELETE FROM users"), Some("delete".into()));
        assert_eq!(write_word("WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x"), Some("delete".into()));
        assert_eq!(write_word("select * into t2 from t"), Some("into".into()));
        assert_eq!(write_word("exec sp_who"), Some("exec".into()));
        assert_eq!(write_word("select 1 /*! delete from t */"), Some("delete".into()));
        assert_eq!(dangerous_word("select sp_helptext"), Some("sp_helptext".into()));
        assert_eq!(dangerous_word("select pg_read_file('/etc/passwd')"), Some("pg_read_file".into()));
        assert_eq!(dangerous_word("select load_file('/etc/passwd')"), Some("load_file".into()));
        assert_eq!(dangerous_word("select pg_sleep(5)"), Some("pg_sleep".into()));
        assert_eq!(dangerous_word("select url('http://169.254.169.254/')"), Some("url".into()));
        assert_eq!(dangerous_word("select 1 where 1=1 waitfor delay '0:0:5'"), Some("waitfor".into()));
        assert_eq!(dangerous_word("select url, file, sleep_ms from logs"), None);
        assert_eq!(dangerous_word("select * from users"), None);
        assert!(is_ddl("create table x(a int)"));
        assert!(!is_ddl("update x set a = 1"));
        assert_eq!(statement_count("select 1; select 2"), 2);
        assert_eq!(statement_count("select ';' ;"), 1);
        assert_eq!(statement_count("select 1 -- don't\n; select 2"), 2);
        assert_eq!(statement_count(""), 0);
    }

    #[test]
    fn rejects_references_to_redacted_columns() {
        let idx = index(&[]);
        for sql in [
            "select password as p from users",
            "select substr(PASSWORD,1,1) from users",
            "select u.\"Password\" from users u",
            "select * from users where password like 'a%'",
            "select * from users order by email",
            "select id from users where id in (select id from users order by email)",
        ] {
            assert!(check_references(sql, &idx).is_err(), "{sql}");
        }
        for sql in [
            "select * from users",
            "select id, name from users where id = 1",
            "select u.name from users u join orders o on o.id = u.id",
        ] {
            assert!(check_references(sql, &idx).is_ok(), "{sql}");
        }
    }

    #[test]
    fn rejects_whole_row_output() {
        let idx = index(&[]);
        for sql in [
            "select u from users u",
            "select users from users",
            "select name, u from users u",
            "select to_json(u) from users u",
            "select u::text from users u",
            "select cast(u as text) from users as u",
            "select row(u.*) from users u",
            "select (select u) from users u",
            "select x from (select * from users) x",
            "select x from (select * from users) as x",
        ] {
            assert!(check_references(sql, &idx).is_err(), "{sql}");
        }
        for sql in [
            "select u.* from users u",
            "select users.name from users",
            "select * from users u, orders o where u.id = o.id",
            "select count(*) from users",
            "select x.name from (select * from users) x",
            "select o.status from orders o",
            "select name from users as u where u.id = 1",
            "select id from users union select id from orders",
            "select * from public.users",
            "select name from users u left join orders on orders.id = u.id where u.id > 1 order by u.id limit 5",
        ] {
            assert!(check_references(sql, &idx).is_ok(), "{sql}");
        }
        assert!(check_references("select status from orders", &idx).is_err());
    }

    #[test]
    fn enforces_schema_allowlist() {
        let idx = index(&["public"]);
        assert!(check_references("select * from secret.vault", &idx).is_err());
        assert!(check_references("select * from vault", &idx).is_err());
        assert!(check_references("select * from pg_catalog.pg_shadow", &idx).is_err());
        assert!(check_references("select * from information_schema.tables", &idx).is_err());
        assert!(check_references("select u.name from secret.vault u", &idx).is_err());
        assert!(check_references("select * from users", &idx).is_ok());
        assert!(check_references("select * from public.users", &idx).is_ok());
        assert!(check_references("select u.name from users u where u.id = 1", &idx).is_ok());
    }
}
