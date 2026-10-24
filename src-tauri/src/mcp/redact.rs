use regex::{Regex, RegexBuilder};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use super::config::Redaction;

const COMPILED_SLOTS: usize = 8;
static COMPILED: LazyLock<Mutex<Vec<(String, Redactor)>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

#[derive(Clone)]
pub struct Redactor {
    columns: Vec<Regex>,
    values: Vec<Regex>,
    replacement: String,
    invalid: Option<String>,
}

pub fn compile(pattern: &str, case_insensitive: bool) -> Result<Regex, String> {
    RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .size_limit(1 << 20)
        .build()
        .map_err(|e| e.to_string())
}

fn invalid_pattern_error(pattern: &str) -> String {
    format!(
        "Maskierungsregel „{pattern}“ ist kein gültiger regulärer Ausdruck. Der MCP sperrt Abfragen auf dieser Verbindung, bis die Regel in l8db korrigiert ist."
    )
}

impl Redactor {
    pub fn new(redaction: &Redaction, extra_columns: &[String]) -> Self {
        let Ok(key) = serde_json::to_string(&(redaction, extra_columns)) else {
            return Self::compile(redaction, extra_columns);
        };
        let mut compiled = COMPILED.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, redactor)) = compiled.iter().find(|(slot, _)| *slot == key) {
            return redactor.clone();
        }
        let redactor = Self::compile(redaction, extra_columns);
        if compiled.len() >= COMPILED_SLOTS {
            compiled.remove(0);
        }
        compiled.push((key, redactor.clone()));
        redactor
    }

    fn compile(redaction: &Redaction, extra_columns: &[String]) -> Self {
        let mut columns = Vec::new();
        let mut invalid = None;
        for pattern in redaction
            .columns
            .iter()
            .filter(|rule| rule.enabled)
            .map(|rule| rule.pattern.as_str())
            .chain(extra_columns.iter().map(String::as_str))
            .filter(|pattern| !pattern.trim().is_empty())
        {
            match compile(pattern, true) {
                Ok(re) => columns.push(re),
                Err(_) => {
                    invalid.get_or_insert_with(|| pattern.to_string());
                }
            }
        }
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
            invalid,
        }
    }

    pub fn check_valid(&self) -> Result<(), String> {
        match &self.invalid {
            Some(pattern) => Err(invalid_pattern_error(pattern)),
            None => Ok(()),
        }
    }

    pub fn column_key(&self) -> String {
        let mut key: Vec<&str> = self.columns.iter().map(Regex::as_str).collect();
        key.extend(self.invalid.as_deref());
        key.join("\u{1}")
    }

    pub fn column_is_sensitive(&self, name: &str) -> bool {
        self.invalid.is_some() || self.columns.iter().any(|re| re.is_match(name))
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
            Value::Array(list) => {
                Value::Array(list.iter().map(|v| self.redact_nested(v)).collect())
            }
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

#[derive(Clone, Copy)]
struct Lexer {
    escapes: bool,
    escaped_quotes: bool,
    escaped_ticks: bool,
    e_strings: bool,
    hash: bool,
    spaced_dash: bool,
    dollar: bool,
    nested: bool,
    brackets: bool,
}

const MYSQL: Lexer = Lexer {
    escapes: true,
    escaped_quotes: false,
    escaped_ticks: false,
    e_strings: false,
    hash: true,
    spaced_dash: false,
    dollar: true,
    nested: true,
    brackets: true,
};

const STANDARD: Lexer = Lexer {
    escapes: false,
    hash: false,
    ..MYSQL
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Dialect {
    Mysql,
    Postgres,
    Sqlite,
    Backslash,
}

impl Dialect {
    fn lexer(self) -> Lexer {
        match self {
            Self::Mysql => Lexer {
                escaped_quotes: true,
                spaced_dash: true,
                dollar: false,
                nested: false,
                brackets: false,
                ..MYSQL
            },
            Self::Postgres => Lexer {
                e_strings: true,
                brackets: false,
                ..STANDARD
            },
            Self::Sqlite => Lexer {
                dollar: false,
                nested: false,
                ..STANDARD
            },
            Self::Backslash => Lexer {
                escaped_quotes: true,
                escaped_ticks: true,
                nested: false,
                brackets: false,
                ..MYSQL
            },
        }
    }
}

pub fn tokenize(sql: &str) -> Vec<Token> {
    tokenize_as(sql, MYSQL)
}

fn readings(sql: &str) -> [Vec<Token>; 2] {
    [tokenize_as(sql, MYSQL), tokenize_as(sql, STANDARD)]
}

pub fn check_dialect(
    sql: &str,
    dialect: Dialect,
    index: &SchemaIndex,
    row_values: bool,
) -> Result<(), String> {
    let tokens = tokenize_as(sql, dialect.lexer());
    if statement_count_in(&tokens) > 1 {
        return Err("Nur ein Statement pro Aufruf (Anführungszeichen und Kommentare im Dialekt der Verbindung gelesen).".into());
    }
    if let Some(word) = write_word_in(&tokens) {
        return Err(format!("query ist read-only, '{word}' ist nicht erlaubt."));
    }
    if let Some(word) = dangerous_word_in(&tokens) {
        return Err(format!("Funktion '{word}' ist über den MCP gesperrt."));
    }
    check_references_in(&tokens, index, row_values)
}

fn dollar_tag(chars: &std::iter::Peekable<std::str::Chars>) -> Option<usize> {
    let mut ahead = chars.clone();
    let mut length = 0;
    loop {
        let n = ahead.next()?;
        length += 1;
        if n == '$' {
            return Some(length);
        }
        if !(n.is_alphabetic() || n == '_' || (length > 1 && n.is_alphanumeric())) {
            return None;
        }
    }
}

fn tokenize_as(sql: &str, lexer: Lexer) -> Vec<Token> {
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
                let escapes =
                    lexer.escapes || (lexer.e_strings && current.eq_ignore_ascii_case("e"));
                flush(&mut current, &mut tokens);
                loop {
                    match chars.next() {
                        Some('\'') if chars.peek() == Some(&'\'') => {
                            chars.next();
                        }
                        Some('\'') | None => break,
                        Some('\\') if escapes => {
                            chars.next();
                        }
                        Some(_) => {}
                    }
                }
                tokens.push(Token::Other('\''));
            }
            '"' | '`' | '[' if c != '[' || lexer.brackets => {
                flush(&mut current, &mut tokens);
                let close = if c == '[' { ']' } else { c };
                let escapes =
                    (c == '"' && lexer.escaped_quotes) || (c == '`' && lexer.escaped_ticks);
                let mut ident = String::new();
                loop {
                    match chars.next() {
                        Some('\\') if escapes => {
                            chars.next();
                        }
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
            '$' if lexer.dollar && dollar_tag(&chars).is_some() => {
                flush(&mut current, &mut tokens);
                let mut tag = String::from("$");
                for _ in 0..dollar_tag(&chars).unwrap_or(0) {
                    tag.extend(chars.next());
                }
                let mut body = String::new();
                while let Some(n) = chars.next() {
                    body.push(n);
                    if body.ends_with(&tag) {
                        break;
                    }
                }
                tokens.push(Token::Other('\''));
            }
            '-' if chars.peek() == Some(&'-')
                && (!lexer.spaced_dash || {
                    let mut ahead = chars.clone();
                    ahead.next();
                    ahead
                        .next()
                        .is_none_or(|n| n.is_whitespace() || n.is_control())
                }) =>
            {
                flush(&mut current, &mut tokens);
                for n in chars.by_ref() {
                    if n == '\n' {
                        break;
                    }
                }
            }
            '#' if lexer.hash => {
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
                let mut ahead = chars.clone();
                if matches!(ahead.next(), Some('M' | 'm')) && ahead.next() == Some('!') {
                    chars.next();
                }
                if matches!(chars.peek(), Some('!') | Some('+')) {
                    tokens.push(Token::Other('/'));
                    if chars.next_if_eq(&'!').is_some() {
                        while chars.next_if(char::is_ascii_digit).is_some() {}
                    }
                    continue;
                }
                let mut depth = 1;
                while let Some(n) = chars.next() {
                    if lexer.nested && n == '/' && chars.peek() == Some(&'*') {
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
            '.' if !current.is_empty()
                && current.chars().all(|c| c.is_ascii_digit())
                && chars.peek().is_some_and(char::is_ascii_digit) =>
            {
                current.push('.')
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
    let [mysql, plain] = readings(sql);
    let extra = if plain == mysql { Vec::new() } else { plain };
    mysql
        .into_iter()
        .chain(extra)
        .filter_map(|token| match token {
            Token::Word(word) => Some(word),
            _ => None,
        })
        .collect()
}

const WRITE_WORDS: &[&str] = &[
    "insert",
    "update",
    "delete",
    "merge",
    "upsert",
    "replace",
    "drop",
    "alter",
    "create",
    "truncate",
    "grant",
    "revoke",
    "call",
    "exec",
    "execute",
    "copy",
    "vacuum",
    "analyze",
    "lock",
    "set",
    "reset",
    "refresh",
    "do",
    "into",
    "load",
    "import",
    "attach",
    "detach",
    "rename",
    "comment",
    "cluster",
    "reindex",
    "begin",
    "commit",
    "rollback",
    "savepoint",
    "prepare",
    "deallocate",
    "listen",
    "notify",
    "unlisten",
    "declare",
    "fetch",
    "move",
    "close",
    "discard",
    "security",
    "reassign",
    "kill",
    "shutdown",
    "use",
    "optimize",
    "system",
    "purge",
    "flush",
    "install",
    "pragma",
    "bulk",
    "backup",
    "restore",
    "dbcc",
    "returning",
    "output",
    "nextval",
    "setval",
    "lastval",
];

const DANGEROUS_ALWAYS: &[&str] = &[
    "waitfor",
    "reconfigure",
    "cmdshell",
    "httpuritype",
    "ctxsys",
    "fts3_tokenizer",
    "pg_terminate_backend",
    "pg_cancel_backend",
    "pg_reload_conf",
    "pg_rotate_logfile",
];

const DANGEROUS_FUNCTIONS: &[&str] = &[
    "pg_read_file",
    "pg_read_binary_file",
    "pg_stat_file",
    "pg_sleep",
    "pg_sleep_for",
    "pg_sleep_until",
    "lo_import",
    "lo_export",
    "lo_get",
    "lo_put",
    "dblink",
    "dblink_exec",
    "dblink_connect",
    "load_file",
    "benchmark",
    "sleep",
    "readfile",
    "writefile",
    "load_extension",
    "openrowset",
    "opendatasource",
    "openquery",
    "url",
    "file",
    "s3",
    "hdfs",
    "mysql",
    "postgresql",
    "odbc",
    "jdbc",
    "remote",
    "remotesecure",
    "input",
    "program",
    "query_to_xml",
    "database_to_xml",
    "schema_to_xml",
    "table_to_xml",
    "xmltype",
    "set_config",
    "lo_create",
    "lo_creat",
    "lo_unlink",
    "lo_from_bytea",
    "lo_truncate",
    "lo_truncate64",
    "pg_notify",
    "pg_logical_emit_message",
    "txid_current",
    "pg_current_xact_id",
    "get_lock",
    "release_lock",
    "release_all_locks",
    "source_pos_wait",
    "master_pos_wait",
    "wait_for_executed_gtid_set",
    "wait_until_sql_thread_after_gtids",
    "arrowflight",
    "azureblobstorage",
    "azureblobstoragecluster",
    "clusterallreplicas",
    "cosn",
    "deltalake",
    "deltalakeazure",
    "deltalakecluster",
    "deltalakelocal",
    "deltalakes3",
    "executable",
    "filecluster",
    "gcs",
    "hdfscluster",
    "hive",
    "hudi",
    "hudicluster",
    "iceberg",
    "icebergazure",
    "icebergazurecluster",
    "iceberghdfs",
    "iceberghdfscluster",
    "iceberglocal",
    "icebergs3",
    "icebergs3cluster",
    "mergetreeindex",
    "mergetreeprojection",
    "mongodb",
    "oss",
    "prometheusquery",
    "prometheusqueryrange",
    "redis",
    "s3cluster",
    "sqlite",
    "timeseriesdata",
    "timeseriesmetrics",
    "timeseriesselector",
    "timeseriestags",
    "urlcluster",
    "ytsaurus",
    "loop",
    "dictionary",
];

const DUCKDB_FILE_FUNCTIONS: &[&str] = &[
    "delta_scan",
    "glob",
    "iceberg_metadata",
    "iceberg_scan",
    "iceberg_snapshots",
    "json_execute_serialized_sql",
    "parquet_bloom_probe",
    "parquet_file_metadata",
    "parquet_kv_metadata",
    "parquet_metadata",
    "parquet_scan",
    "parquet_schema",
    "query",
    "query_table",
    "read_avro",
    "read_blob",
    "read_csv",
    "read_csv_auto",
    "read_json",
    "read_json_auto",
    "read_json_objects",
    "read_json_objects_auto",
    "read_ndjson",
    "read_ndjson_auto",
    "read_ndjson_objects",
    "read_parquet",
    "read_text",
    "read_xlsx",
    "sniff_csv",
    "sqlite_scan",
    "st_read",
    "st_read_meta",
];

const TSQL_BATCH_WORDS: &[&str] = &[
    "checkpoint",
    "deny",
    "receive",
    "send",
    "setuser",
    "updatetext",
    "writetext",
];

const WRITE_STATEMENTS: &[&str] = &[
    "administer",
    "associate",
    "audit",
    "binlog",
    "cache",
    "change",
    "checkpoint",
    "clone",
    "deny",
    "disable",
    "disassociate",
    "enable",
    "exchange",
    "export",
    "flashback",
    "force",
    "handler",
    "noaudit",
    "repair",
    "restart",
    "setuser",
    "start",
    "stop",
    "undrop",
    "uninstall",
    "unlock",
    "updatetext",
    "writetext",
    "xa",
];

const DANGEROUS_PREFIXES: &[&str] = &[
    "xp_",
    "sp_",
    "dbms_",
    "utl_",
    "pg_ls_",
    "pg_create_",
    "pg_drop_",
    "pg_replication_",
    "pg_advisory_",
    "pg_try_advisory_",
];

const DDL_WORDS: &[&str] = &[
    "create", "alter", "drop", "truncate", "rename", "grant", "revoke", "comment", "reindex",
    "cluster", "attach", "detach", "install", "vacuum",
];

const ALIAS_STOP: &[&str] = &[
    "on",
    "where",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "cross",
    "natural",
    "full",
    "using",
    "group",
    "order",
    "limit",
    "having",
    "union",
    "except",
    "intersect",
    "minus",
    "set",
    "values",
    "returning",
    "window",
    "fetch",
    "offset",
    "for",
    "lateral",
    "tablesample",
    "as",
    "and",
    "or",
    "not",
    "select",
    "from",
    "with",
    "straight_join",
    "only",
    "in",
    "is",
    "like",
    "between",
    "exists",
    "case",
    "when",
    "then",
    "else",
    "end",
    "null",
    "distinct",
    "top",
    "into",
    "start",
    "connect",
    "qualify",
    "sample",
    "final",
    "prewhere",
    "array",
    "unnest",
    "settings",
    "format",
];

const FROM_START: &[&str] = &["from", "join", "update", "into", "table", "only", "lateral"];
const FROM_END: &[&str] = &[
    "where",
    "group",
    "order",
    "limit",
    "having",
    "union",
    "except",
    "intersect",
    "minus",
    "on",
    "select",
    "set",
    "values",
    "returning",
    "window",
    "fetch",
    "offset",
    "for",
    "with",
    "qualify",
    "prewhere",
    "settings",
    "format",
];

pub fn write_word(sql: &str) -> Option<String> {
    readings(sql)
        .iter()
        .find_map(|tokens| write_word_in(tokens))
}

fn write_word_in(tokens: &[Token]) -> Option<String> {
    let word_at = |i: usize| match tokens.get(i) {
        Some(Token::Word(word)) => Some(word.as_str()),
        _ => None,
    };
    if let Some(Token::Word(first)) = tokens.iter().find(|token| matches!(token, Token::Word(_))) {
        if WRITE_STATEMENTS.contains(&first.as_str()) {
            return Some(first.clone());
        }
    }
    tokens.iter().enumerate().find_map(|(i, token)| {
        let Token::Word(word) = token else {
            return None;
        };
        let member = i >= 2
            && tokens[i - 1] == Token::Dot
            && word_at(i - 2).is_some_and(|owner| !owner.starts_with(|c: char| c.is_ascii_digit()));
        let named = match word.as_str() {
            "system" => tokens.get(i + 1) == Some(&Token::Dot),
            "fetch" => i > 0 && matches!(word_at(i + 1), Some("first" | "next")),
            "replace" => i > 0 && tokens.get(i + 1) == Some(&Token::Open),
            _ => false,
        };
        (WRITE_WORDS.contains(&word.as_str()) && !member && !named).then(|| word.clone())
    })
}

pub fn dangerous_word(sql: &str) -> Option<String> {
    readings(sql)
        .iter()
        .find_map(|tokens| dangerous_word_in(tokens))
}

fn dangerous_word_in(tokens: &[Token]) -> Option<String> {
    for (i, token) in tokens.iter().enumerate() {
        if let Token::Word(word) = token {
            let always = DANGEROUS_ALWAYS.contains(&word.as_str())
                || (word != "dbms_output"
                    && DANGEROUS_PREFIXES
                        .iter()
                        .any(|prefix| word.starts_with(prefix)));
            let as_function = tokens.get(i + 1) == Some(&Token::Open)
                && DANGEROUS_FUNCTIONS.contains(&word.as_str());
            if always || as_function {
                return Some(word.clone());
            }
        }
    }
    None
}

pub fn duckdb_file_access(sql: &str) -> Option<String> {
    let [mysql, standard] = readings(sql);
    [mysql, standard, tokenize_as(sql, Dialect::Postgres.lexer())]
        .iter()
        .find_map(|tokens| duckdb_file_access_in(tokens))
}

fn duckdb_file_access_in(tokens: &[Token]) -> Option<String> {
    let mut scopes = vec![false];
    let mut previous: Option<&Token> = None;
    for (i, token) in tokens.iter().enumerate() {
        match token {
            Token::Open => scopes.push(matches!(
                previous,
                Some(Token::Word(word)) if matches!(word.as_str(), "extract" | "trim" | "substring" | "overlay" | "position")
            )),
            Token::Close if scopes.len() > 1 => {
                scopes.pop();
            }
            Token::Word(word) => match tokens.get(i + 1) {
                Some(Token::Open)
                    if DUCKDB_FILE_FUNCTIONS.contains(&word.as_str())
                        || word.starts_with("pragma_") =>
                {
                    return Some(word.clone())
                }
                Some(Token::Other('\''))
                    if (word == "from"
                        && scopes.last() == Some(&false)
                        && previous != Some(&Token::Word("distinct".into())))
                        || word == "join" =>
                {
                    return Some(format!("{word} '…'"))
                }
                _ => {}
            },
            _ => {}
        }
        previous = Some(token);
    }
    None
}

pub fn tsql_batch_word(sql: &str) -> Option<String> {
    readings(sql).iter().find_map(|tokens| {
        tokens.iter().enumerate().find_map(|(i, token)| {
            let Token::Word(word) = token else {
                return None;
            };
            let statement = TSQL_BATCH_WORDS.contains(&word.as_str())
                || (matches!(word.as_str(), "disable" | "enable")
                    && tokens.get(i + 1) == Some(&Token::Word("trigger".into())));
            (statement && !(i > 0 && tokens[i - 1] == Token::Dot)).then(|| word.clone())
        })
    })
}

pub fn is_ddl(sql: &str) -> bool {
    sql_words(sql)
        .iter()
        .any(|word| DDL_WORDS.contains(&word.as_str()))
}

pub fn statement_count(sql: &str) -> usize {
    readings(sql)
        .iter()
        .map(|tokens| statement_count_in(tokens))
        .max()
        .unwrap_or(0)
}

fn statement_count_in(tokens: &[Token]) -> usize {
    let mut count = 0;
    let mut seen = false;
    for token in tokens {
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
    schemas: HashSet<String>,
    column_rules: Vec<Regex>,
    invalid_pattern: Option<String>,
}

impl SchemaIndex {
    pub fn new(
        columns: &[crate::db::ColumnInfo],
        redactor: &Redactor,
        allowed_schemas: &[String],
    ) -> Self {
        Self::from_parts(
            columns.iter().map(|column| column.name.as_str()),
            columns
                .iter()
                .map(|column| (column.schema.as_str(), column.table.as_str())),
            redactor,
            allowed_schemas,
        )
    }

    pub fn from_parts<'a>(
        column_names: impl Iterator<Item = &'a str>,
        tables: impl Iterator<Item = (&'a str, &'a str)>,
        redactor: &Redactor,
        allowed_schemas: &[String],
    ) -> Self {
        let sensitive_columns = column_names
            .filter(|name| redactor.column_is_sensitive(name))
            .map(str::to_lowercase)
            .collect();
        let mut by_table: HashMap<String, HashSet<String>> = HashMap::new();
        let mut schemas = HashSet::new();
        for (schema, table) in tables {
            let schema = schema.to_lowercase();
            by_table
                .entry(table.to_lowercase())
                .or_default()
                .insert(schema.clone());
            schemas.insert(schema);
        }
        Self {
            sensitive_columns,
            tables: by_table,
            allowed_schemas: allowed_schemas.iter().map(|s| s.to_lowercase()).collect(),
            schemas,
            column_rules: redactor.columns.clone(),
            invalid_pattern: redactor.invalid.clone(),
        }
    }

    pub fn table_hidden(&self, table: &str) -> bool {
        if self.allowed_schemas.is_empty() {
            return false;
        }
        self.tables.get(table).is_some_and(|schemas| {
            schemas
                .iter()
                .all(|schema| !self.allowed_schemas.contains(schema))
        })
    }
}

const RENAME_WORD_SKIP: &[&str] = &[
    "partition",
    "index",
    "key",
    "pivot",
    "unpivot",
    "match_recognize",
];
const RENAME_PREV_SKIP: &[&str] = &["apply"];
const SET_OPERATORS: &[&str] = &["union", "intersect", "except", "minus"];
const STATEMENT_HEADS: &[&str] = &[
    "select", "insert", "update", "delete", "merge", "upsert", "replace", "create",
];
const POSITIONAL_HEADS: &[&str] = &["insert", "upsert", "replace", "merge", "create"];

fn matching_close(tokens: &[Token], open: usize) -> Option<usize> {
    let mut depth = 0i32;
    for (i, token) in tokens.iter().enumerate().skip(open) {
        match token {
            Token::Open => depth += 1,
            Token::Close => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn is_select_star(tokens: &[Token], i: usize) -> bool {
    if tokens.get(i) != Some(&Token::Other('*')) || i == 0 {
        return false;
    }
    match &tokens[i - 1] {
        Token::Comma | Token::Dot => true,
        Token::Word(word) if matches!(word.as_str(), "select" | "distinct" | "all") => true,
        Token::Word(word) if word.chars().all(|c| c.is_ascii_digit()) => {
            i >= 2 && tokens[i - 2] == Token::Word("top".into())
        }
        _ => false,
    }
}

fn check_renames(tokens: &[Token]) -> Result<(), String> {
    let word_at = |i: usize| match tokens.get(i) {
        Some(Token::Word(word)) => Some(word.as_str()),
        _ => None,
    };
    let set_operation = tokens
        .iter()
        .any(|token| matches!(token, Token::Word(word) if SET_OPERATORS.contains(&word.as_str())));
    let mut depth = 0i32;
    let mut head = None;
    for token in tokens {
        match token {
            Token::Open => depth += 1,
            Token::Close => depth -= 1,
            Token::Word(word) if depth == 0 && STATEMENT_HEADS.contains(&word.as_str()) => {
                head = Some(word.as_str());
                break;
            }
            _ => {}
        }
    }
    let positional_head = head.is_some_and(|word| POSITIONAL_HEADS.contains(&word));
    let rename = || {
        Err("Spaltenlisten für Aliase (z. B. AS t(a, b) oder WITH x(a, b)) sind über den MCP gesperrt, weil sie redigierte Spalten umbenennen könnten.".to_string())
    };
    let star = || {
        Err("SELECT * ist hier gesperrt: In UNION, INSERT … SELECT oder Vergleichs-Subqueries würden Spalten ohne ihren Namen weitergegeben. Spalten einzeln wählen.".to_string())
    };
    let mut in_from = false;
    let mut stack: Vec<(bool, usize)> = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        match token {
            Token::Word(word) if FROM_START.contains(&word.as_str()) => in_from = true,
            Token::Word(word) if FROM_END.contains(&word.as_str()) => in_from = false,
            Token::Open => {
                stack.push((in_from, i));
                in_from = false;
            }
            Token::Close => in_from = stack.pop().map(|(from, _)| from).unwrap_or(false),
            _ => {}
        }
        if is_select_star(tokens, i) {
            if set_operation {
                return star();
            }
            match stack.last() {
                None if positional_head => return star(),
                None => {}
                Some(&(from, open)) => {
                    let opener = open.checked_sub(1).and_then(word_at);
                    if !from && !matches!(opener, Some("exists" | "as" | "materialized")) {
                        return star();
                    }
                }
            }
        }
        let Token::Word(word) = token else { continue };
        if tokens.get(i + 1) != Some(&Token::Open) {
            continue;
        }
        let prev = i.checked_sub(1).and_then(|p| tokens.get(p));
        let cte = match prev {
            Some(Token::Word(p)) if p == "with" || p == "recursive" => true,
            Some(Token::Comma) => matching_close(tokens, i + 1).is_some_and(|close| {
                word_at(close + 1) == Some("as")
                    && (tokens.get(close + 2) == Some(&Token::Open)
                        || matches!(word_at(close + 2), Some("materialized" | "not")))
            }),
            _ => false,
        };
        if cte {
            return rename();
        }
        if in_from
            && !ALIAS_STOP.contains(&word.as_str())
            && !RENAME_WORD_SKIP.contains(&word.as_str())
        {
            let alias = match prev {
                Some(Token::Close) => true,
                Some(Token::Word(p)) => {
                    p == "as"
                        || !(ALIAS_STOP.contains(&p.as_str())
                            || FROM_START.contains(&p.as_str())
                            || RENAME_PREV_SKIP.contains(&p.as_str()))
                }
                _ => false,
            };
            if alias {
                return rename();
            }
        }
    }
    Ok(())
}

fn is_positional(word: &str) -> bool {
    word.len() > 1 && word.starts_with('_') && word[1..].chars().all(|c| c.is_ascii_digit())
}

pub fn check_s3_select(sql: &str, index: &SchemaIndex) -> Result<(), String> {
    if let Some(pattern) = &index.invalid_pattern {
        return Err(invalid_pattern_error(pattern));
    }
    let expression = match crate::db::s3::select::parse(sql, Some("bucket"))? {
        crate::db::s3::select::Statement::Select { expression, .. } => expression,
        _ => return Ok(()),
    };
    for word in sql_words(&expression) {
        if is_positional(&word) {
            return Err(format!(
                "Positionsspalte '{word}' ist über den MCP gesperrt. Spalten per Namen wählen."
            ));
        }
        if index.column_rules.iter().any(|re| re.is_match(&word)) {
            return Err(format!(
                "Spalte '{word}' ist redigiert und darf in SQL nicht referenziert werden. SELECT * liefert sie maskiert."
            ));
        }
    }
    Ok(())
}

pub fn check_references(sql: &str, index: &SchemaIndex, row_values: bool) -> Result<(), String> {
    if let Some(pattern) = &index.invalid_pattern {
        return Err(invalid_pattern_error(pattern));
    }
    for tokens in readings(sql) {
        check_references_in(&tokens, index, row_values)?;
    }
    Ok(())
}

fn check_references_in(
    tokens: &[Token],
    index: &SchemaIndex,
    row_values: bool,
) -> Result<(), String> {
    let word_at = |i: usize| match tokens.get(i) {
        Some(Token::Word(word)) => Some(word.as_str()),
        _ => None,
    };
    if !index.sensitive_columns.is_empty() {
        check_renames(&tokens)?;
    }
    for (i, token) in tokens.iter().enumerate() {
        if let Token::Word(word) = token {
            if index.sensitive_columns.contains(word) {
                return Err(format!(
                    "Spalte '{word}' ist redigiert und darf in SQL nicht referenziert werden (auch nicht per Alias, Funktion oder WHERE). SELECT * liefert sie maskiert."
                ));
            }
            let named = i > 0
                && ((tokens[i - 1] == Token::Dot && tokens.get(i + 1) != Some(&Token::Dot))
                    || word_at(i - 1) == Some("as"));
            if !named
                && !index.allowed_schemas.is_empty()
                && !index.allowed_schemas.contains(word)
                && index.schemas.contains(word)
            {
                return Err(format!(
                    "Schema '{word}' ist für diese Verbindung nicht freigegeben."
                ));
            }
            if !named && index.table_hidden(word) {
                return Err(format!(
                    "Tabelle '{word}' liegt in einem nicht freigegebenen Schema."
                ));
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
            Token::Other('*')
                if !index.sensitive_columns.is_empty()
                    && tokens.get(i.wrapping_sub(1)) == Some(&Token::Open)
                    && !matches!(word_at(i.wrapping_sub(2)), Some("count" | "count_big")) =>
            {
                return Err("* ist als Funktionsargument nur in count(*) erlaubt, weil sonst redigierte Spalten unmaskiert ausgegeben würden. Spalten einzeln wählen.".into());
            }
            Token::Word(word)
                if word == "apply"
                    && !index.sensitive_columns.is_empty()
                    && matches!(
                        tokens.get(i.wrapping_sub(1)),
                        Some(Token::Other('*') | Token::Close)
                    ) =>
            {
                return Err("APPLY auf Spaltenmengen ist gesperrt, weil es redigierte Spalten umbenennt. Spalten einzeln wählen.".into());
            }
            _ => {}
        }
    }
    let mut aliases: HashSet<String> = HashSet::new();
    let mut relations: HashSet<String> = HashSet::new();
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
            Token::Word(word)
                if in_from
                    && !ALIAS_STOP.contains(&word.as_str())
                    && !matches!(tokens.get(i + 1), Some(Token::Dot | Token::Open))
                    && (index.tables.contains_key(word)
                        || matches!(
                            tokens.get(i.wrapping_sub(1)),
                            Some(Token::Comma | Token::Dot)
                        )
                        || word_at(i.wrapping_sub(1))
                            .is_some_and(|prev| FROM_START.contains(&prev))) =>
            {
                relations.insert(word.clone());
                let mut j = i + 1;
                if word_at(j) == Some("as") {
                    j += 1;
                }
                if let Some(next) = word_at(j) {
                    if !ALIAS_STOP.contains(&next)
                        && !RENAME_WORD_SKIP.contains(&next)
                        && tokens.get(j + 1) != Some(&Token::Dot)
                    {
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
                    && !aliases.contains(word)
                    && !relations.contains(word) =>
            {
                return Err(format!(
                    "'{word}' ist kein freigegebenes Schema, keine bekannte Tabelle und kein Alias."
                ));
            }
            Token::Word(word)
                if row_values
                    && word_at(i.wrapping_sub(1)) != Some("as")
                    && (index.tables.contains_key(word) || aliases.contains(word)) =>
            {
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
                        "'{word}' ist ein Tabellenname und darf nicht als ganze Zeile ausgegeben werden. Einzelne Spalten wählen (z. B. {word}.spalte) oder einen gleichnamigen Spaltenalias umbenennen (z. B. {word}_count)."
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
        for name in [
            "password",
            "PassWord",
            "user_pwd",
            "api_key",
            "Email",
            "iban",
            "kunden_geheim",
            "vorname",
        ] {
            assert!(r.column_is_sensitive(name), "{name}");
        }
        for name in ["id", "name", "created_at", "amount", "title"] {
            assert!(!r.column_is_sensitive(name), "{name}");
        }
        assert_eq!(
            r.redact_cell("password", &Value::from("x")),
            Value::from("[redacted]")
        );
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
        assert_eq!(
            r.redact_text("Bestellung 42 von heute"),
            "Bestellung 42 von heute"
        );
        assert_eq!(
            r.redact_cell("amount", &Value::from(1234)),
            Value::from(1234)
        );
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        assert_eq!(r.redact_text(jwt), "[redacted]");
        let bcrypt = "$2b$12$KIXxLQ3Q8pq8eXqXk3q2Ue0mZg1XfE3Z0FQeHnQxVv0aGm1x5uZ6y";
        assert_eq!(r.redact_text(bcrypt), "[redacted]");
        assert_eq!(
            r.redact_text("550e8400-e29b-41d4-a716-446655440000"),
            "550e8400-e29b-41d4-a716-446655440000"
        );
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
        assert_eq!(
            sql_words("SELECT \"Delete\" FROM t -- drop\n/* alter */"),
            vec!["select", "delete", "from", "t"]
        );
        assert_eq!(
            sql_words("select 'it''s; delete' from t"),
            vec!["select", "from", "t"]
        );
        assert_eq!(
            sql_words("select $$ delete $$ from t"),
            vec!["select", "from", "t"]
        );
        assert_eq!(sql_words("select $tag$ x $tag$"), vec!["select"]);
        assert_eq!(
            sql_words("select 1 /*! delete from t */"),
            vec!["select", "1", "delete", "from", "t"]
        );
        assert_eq!(
            sql_words("select 1 /* outer /* inner */ delete */"),
            vec!["select", "1"]
        );
        assert!(sql_words("select 1 # delete\nfrom t").contains(&"delete".to_string()));
        assert_eq!(statement_count("UPDATE t SET a = '\\'; COMMIT; --'"), 2);
        assert_eq!(statement_count("SELECT 1 # x; DELETE FROM t"), 2);
        assert_eq!(
            write_word("SELECT 1 # x\n; DELETE FROM t").as_deref(),
            Some("delete")
        );
        assert_eq!(statement_count("SELECT * FROM #temp"), 1);
        assert_eq!(statement_count("SELECT 'C:\\path\\' AS p"), 1);
        assert_eq!(
            sql_words("select [Password] from t"),
            vec!["select", "password", "from", "t"]
        );
        assert_eq!(
            sql_words("select `email` from t"),
            vec!["select", "email", "from", "t"]
        );
    }

    #[test]
    fn classifies_sql() {
        assert_eq!(
            write_word("SELECT * FROM users WHERE name = 'DROP TABLE'"),
            None
        );
        assert_eq!(write_word("select 1 -- delete\n/* update */"), None);
        assert_eq!(write_word("WITH x AS (SELECT 1) SELECT * FROM x"), None);
        assert_eq!(write_word("explain select 1"), None);
        assert_eq!(
            write_word("SELECT \"delete\" FROM t"),
            Some("delete".into())
        );
        assert_eq!(write_word("DELETE FROM users"), Some("delete".into()));
        assert_eq!(
            write_word("WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x"),
            Some("delete".into())
        );
        assert_eq!(write_word("select * into t2 from t"), Some("into".into()));
        assert_eq!(write_word("exec sp_who"), Some("exec".into()));
        assert_eq!(
            write_word("select 1 /*! delete from t */"),
            Some("delete".into())
        );
        assert_eq!(
            dangerous_word("select sp_helptext"),
            Some("sp_helptext".into())
        );
        assert_eq!(
            dangerous_word("select pg_read_file('/etc/passwd')"),
            Some("pg_read_file".into())
        );
        assert_eq!(
            dangerous_word("select load_file('/etc/passwd')"),
            Some("load_file".into())
        );
        assert_eq!(
            dangerous_word("select pg_sleep(5)"),
            Some("pg_sleep".into())
        );
        assert_eq!(
            dangerous_word("select url('http://169.254.169.254/')"),
            Some("url".into())
        );
        assert_eq!(
            dangerous_word("select 1 where 1=1 waitfor delay '0:0:5'"),
            Some("waitfor".into())
        );
        assert_eq!(dangerous_word("select url, file, sleep_ms from logs"), None);
        assert_eq!(dangerous_word("select * from users"), None);
        assert_eq!(dangerous_word("begin dbms_output.put_line(1); end;"), None);
        assert!(dangerous_word("begin dbms_lock.sleep(5); end;").is_some());
        assert!(is_ddl("create table x(a int)"));
        assert!(!is_ddl("update x set a = 1"));
        assert_eq!(statement_count("select 1; select 2"), 2);
        assert_eq!(statement_count("select ';' ;"), 1);
        assert_eq!(statement_count("select 1 -- don't\n; select 2"), 2);
        assert_eq!(statement_count(""), 0);
    }

    #[test]
    fn dialect_readings_close_quote_and_comment_mixing() {
        let idx = index(&[]);
        for (dialect, sql) in [
            (
                Dialect::Mysql,
                "SELECT \"a\\\"\" ; DELETE FROM users ; SELECT \"x\"",
            ),
            (Dialect::Mysql, "SELECT 1 --1, password AS p FROM users"),
            (
                Dialect::Mysql,
                "SELECT 1 /* /* */ , password AS p FROM users -- */",
            ),
            (
                Dialect::Mysql,
                "SELECT 1 AS $$, password AS p FROM users -- $$",
            ),
            (
                Dialect::Postgres,
                "SELECT E'\\'' AS a, '\\' AS b, password AS p FROM users -- '",
            ),
            (
                Dialect::Postgres,
                "SELECT ARRAY['a]'], password AS p FROM users -- '",
            ),
            (
                Dialect::Sqlite,
                "SELECT 1 /* /* */ , password AS p FROM users -- */",
            ),
            (
                Dialect::Backslash,
                "SELECT `a\\`` , password AS p FROM users, `x`",
            ),
            (
                Dialect::Backslash,
                "SELECT \"a\\\"\" , password AS p FROM users -- \"",
            ),
        ] {
            assert!(
                check_dialect(sql, dialect, &idx, true).is_err(),
                "{dialect:?}: {sql}"
            );
        }
        assert!(check_references("SELECT $a, password AS p FROM users", &idx, true).is_err());
        for (dialect, sql) in [
            (
                Dialect::Mysql,
                "SELECT 'it\\'s', \"a\\\"b\" AS q, `id` FROM users -- note",
            ),
            (
                Dialect::Postgres,
                "SELECT E'it\\'s', $$x; delete$$, \"name\" FROM users /* a /* b */ c */",
            ),
            (Dialect::Sqlite, "SELECT [name], 'C:\\' FROM users /* c */"),
            (
                Dialect::Backslash,
                "SELECT `na\\`me`, 'it\\'s' FROM users # c",
            ),
        ] {
            assert!(
                check_dialect(sql, dialect, &idx, true).is_ok(),
                "{dialect:?}: {sql}"
            );
        }
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
            assert!(check_references(sql, &idx, true).is_err(), "{sql}");
        }
        for sql in [
            "select * from users",
            "select id, name from users where id = 1",
            "select u.name from users u join orders o on o.id = u.id",
        ] {
            assert!(check_references(sql, &idx, true).is_ok(), "{sql}");
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
            assert!(check_references(sql, &idx, true).is_err(), "{sql}");
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
            assert!(check_references(sql, &idx, true).is_ok(), "{sql}");
        }
        assert!(check_references("select status from orders", &idx, true).is_err());
    }

    #[test]
    fn enforces_schema_allowlist() {
        let idx = index(&["public"]);
        assert!(check_references("select * from secret.vault", &idx, true).is_err());
        assert!(check_references("select * from vault", &idx, true).is_err());
        assert!(check_references("select * from pg_catalog.pg_shadow", &idx, true).is_err());
        assert!(check_references("select * from information_schema.tables", &idx, true).is_err());
        assert!(check_references("select u.name from secret.vault u", &idx, true).is_err());
        assert!(check_references("select * from users", &idx, true).is_ok());
        assert!(check_references("select * from public.users", &idx, true).is_ok());
        assert!(check_references("select u.name from users u where u.id = 1", &idx, true).is_ok());
        for sql in [
            "select quantile(0.9)(id) from users",
            "select id * 1.19, 0.5e3 from public.users where id > 2.5",
        ] {
            assert!(check_references(sql, &idx, true).is_ok(), "{sql}");
            assert!(
                check_dialect(sql, Dialect::Backslash, &idx, true).is_ok(),
                "{sql}"
            );
        }
        for sql in [
            "select * from `2024`.vault",
            "select * from \"0\".\"9\"",
            "select * from secret.vault where id > 0.5",
        ] {
            assert!(check_references(sql, &idx, true).is_err(), "{sql}");
        }
    }

    #[test]
    fn duckdb_file_readers_and_string_tables_are_flagged() {
        for sql in [
            "SELECT * FROM read_text('/etc/hosts')",
            "select * from READ_CSV_AUTO('x.csv')",
            "SELECT * FROM '/etc/hosts'",
            "SELECT * FROM (SELECT * FROM 'x.parquet')",
            "SELECT * FROM t JOIN 'x.csv' USING (id)",
            "SELECT extract(year FROM d) FROM 'x.csv'",
            "SELECT column_name, stats FROM pragma_storage_info('secret.notes')",
            "SELECT * FROM query('SELECT * FROM secret.notes')",
            "SELECT * FROM query_table('secret.notes')",
            "SELECT E'\\'' AS q, '\\' AS a, * FROM read_text('/etc/hosts') -- '",
        ] {
            assert!(duckdb_file_access(sql).is_some(), "{sql}");
        }
        for sql in [
            "SELECT extract(year FROM '2024-01-01'::date) AS y FROM t",
            "SELECT trim(both 'x' FROM 'xax'), substring('abc' FROM 2) FROM t",
            "SELECT 'from' AS read_text, glob FROM t WHERE name GLOB 'a*'",
            "SELECT * FROM read_text_log",
            "SELECT * FROM t WHERE status IS DISTINCT FROM 'open' OR status IS NOT DISTINCT FROM 'x'",
        ] {
            assert!(duckdb_file_access(sql).is_none(), "{sql}");
        }
        assert!(dangerous_word("SELECT x.query('/a') AS q FROM t").is_none());
    }

    #[test]
    fn mariadb_executable_comments_and_tsql_batches_are_read_as_statements() {
        let idx = index(&["public"]);
        for sql in [
            "SELECT 1 /*M! UNION SELECT password FROM hidden.users */",
            "SELECT 1 /*M!100100 UNION SELECT password FROM hidden.users */",
        ] {
            assert!(check_references(sql, &idx, true).is_err(), "{sql}");
        }
        assert!(write_word("/*M!100100 DELETE FROM users */").is_some());
        assert!(write_word("SELECT 1 /*M! deny */").is_none());
        for sql in [
            "SELECT 1 DENY SELECT ON SCHEMA::dbo TO public",
            "SELECT 1 WHERE 1 = 1 DISABLE TRIGGER ALL ON dbo.orders",
            "SELECT 1 CHECKPOINT",
            "RECEIVE TOP (1) * FROM dbo.queue",
        ] {
            assert!(tsql_batch_word(sql).is_some(), "{sql}");
        }
        for sql in [
            "SELECT t.deny, t.checkpoint, t.send FROM t",
            "SELECT disabled, enable_flag FROM t",
        ] {
            assert!(tsql_batch_word(sql).is_none(), "{sql}");
        }
    }

    #[test]
    fn admin_statements_and_external_table_functions_are_not_reads() {
        for sql in [
            "STOP REPLICA",
            "start replica",
            "START TRANSACTION",
            "CHANGE REPLICATION SOURCE TO SOURCE_HOST = 'x'",
            "BINLOG 'AAAA'",
            "RESTART",
            "CLONE LOCAL DATA DIRECTORY = '/tmp/x'",
            "UNINSTALL PLUGIN audit_log",
            "XA START 'x'",
            "HANDLER users OPEN",
            "CACHE INDEX users IN hot",
            "UNLOCK TABLES",
            "REPAIR TABLE users",
            "EXCHANGE TABLES a AND b",
            "UNDROP TABLE users",
            "/*!80000 STOP REPLICA */",
            "DENY SELECT ON users TO public",
            "DISABLE TRIGGER ALL ON users",
            "enable trigger all on users",
            "CHECKPOINT",
            "SETUSER",
            "WRITETEXT users.name 0x0 'x'",
            "/*!80000DELETE FROM users */",
            "/*!800001UPDATE users SET name = 'x' */",
            "SELECT 1 /*!50000INTO OUTFILE '/tmp/x' */",
            "FLASHBACK TABLE users TO BEFORE DROP",
            "AUDIT SELECT ON users",
            "NOAUDIT ALL",
            "ASSOCIATE STATISTICS WITH COLUMNS users.id USING NULL",
            "DISASSOCIATE STATISTICS FROM COLUMNS users.id",
            "ADMINISTER KEY MANAGEMENT CREATE KEYSTORE 'x' IDENTIFIED BY y",
            "EXPORT DATABASE '/tmp/x'",
            "FORCE CHECKPOINT",
        ] {
            assert!(write_word(sql).is_some(), "{sql}");
        }
        let idx = index(&[]);
        assert!(check_dialect(
            "SELECT id /*!80000, password */ FROM users",
            Dialect::Mysql,
            &idx,
            true
        )
        .is_err());
        assert!(check_dialect(
            "SELECT 1 /*!80000DELETE FROM users */",
            Dialect::Mysql,
            &idx,
            true
        )
        .is_err());
        for sql in [
            "select start, stop, change, cache, handler from users",
            "select u.xa, u.repair from users u where exchange = 1",
        ] {
            assert!(write_word(sql).is_none(), "{sql}");
        }
        for sql in [
            "select get_lock('x', 10)",
            "select release_all_locks()",
            "select source_pos_wait('f', 4)",
            "SELECT * FROM s3Cluster('c', 'http://x/y.csv')",
            "select * from urlCluster('c', 'http://x')",
            "select * from gcs('http://x')",
            "select * from azureBlobStorage('http://x', 'c', 'f')",
            "select * from fileCluster('c', '/etc/passwd')",
            "select * from sqlite('/x.db', 't')",
            "select * from executable('x.sh', TSV, 'a String')",
            "select * from mongodb('h', 'd', 'c', 'u', 'p', 'a String')",
            "select * from icebergS3('http://x')",
            "select * from mergeTreeIndex('secret', 'vault')",
            "select * from timeSeriesData('secret', 'vault')",
            "select * from clusterAllReplicas('default', 'secret', 'vault')",
        ] {
            assert!(dangerous_word(sql).is_some(), "{sql}");
        }
        assert!(dangerous_word("select sqlite, redis, gcs, hive, oss from users").is_none());
    }

    #[test]
    fn rejects_column_alias_lists_that_rename_redacted_columns() {
        let idx = index(&[]);
        for sql in [
            "select * from users as u(i, n, p, e)",
            "select * from users u(i, n, p, e)",
            "select u.p from users as u(i, n, p, e)",
            "select * from public.users as u(i, n, p, e)",
            "select * from users u join orders as o(a, b) on o.a = u.id",
            "with x(a, b, c, d) as (select * from users) select * from x",
            "with recursive x(a, b, c, d) as (select * from users) select * from x",
            "with y as (select 1), x(a, b, c, d) as (select * from users) select * from x",
            "with x(a, b, c, d) as materialized (select * from users) select * from x",
            "select * from (select * from users) t(a, b, c, d)",
            "select * from (select * from users) as t(a, b, c, d)",
            "select * from [users] as [u]([i], [n], [p], [e])",
            "select 1, 2, 3, 4 union select * from users",
            "select * from orders union select * from users",
            "select id, status from orders union all select u.* from users u",
            "select x.a from (select 1 a, 2 b, 3 c, 4 d union select * from users) x",
            "select 1 from orders where (1, 'n', 'pw', 'e') in (select * from users)",
            "select 1 from orders where row(1, 'n', 'pw', 'e') = (select * from users limit 1)",
            "insert into notes select * from users",
            "insert into notes (a, b, c, d) select u.* from users u",
        ] {
            assert!(check_references(sql, &idx, true).is_err(), "{sql}");
        }
        for sql in [
            "select * from users u join orders o using (id)",
            "select * from users partition (p0)",
            "select * from users force index (users_idx)",
            "select * from users ignore key (users_idx)",
            "select * from users tablesample system (10)",
            "with x as (select id from users) select id from x",
            "with x as (select id from users), y as (select id from orders) select x.id from x, y",
            "select coalesce(name, 'x') as label from users where id in (select id from orders)",
            "insert into users (id, name) values (1, 'x')",
            "insert into public.users(id, name) values (1, 'x')",
            "select count(*) from users",
            "select u.name from users u where exists (select 1 from orders o where o.id = u.id)",
            "select * from users where exists (select * from orders o where o.id = users.id)",
            "with x as (select * from users) select * from x",
            "select id * 2 from orders union select id from orders",
            "select count(*) from users union select count(*) from orders",
            "select top 5 * from users",
        ] {
            assert!(check_references(sql, &idx, true).is_ok(), "{sql}");
        }
    }

    #[test]
    fn alias_lists_are_allowed_without_redacted_columns() {
        let columns = vec![
            col("public", "orders", "id"),
            col("public", "orders", "status"),
        ];
        let idx = SchemaIndex::new(
            &columns,
            &Redactor::new(&McpConfig::default().redaction, &[]),
            &[],
        );
        assert!(
            check_references("select * from generate_series(1, 3) as g(n)", &idx, true).is_ok()
        );
        assert!(check_references(
            "with x(a) as (select id from orders) select a from x",
            &idx,
            true
        )
        .is_ok());
    }

    #[test]
    fn s3_select_rejects_positions_and_redacted_names() {
        let idx = index(&[]);
        for sql in [
            "select s.password from s3://data/customers_email.csv s",
            "select s.passwort_hash as h from s3://data/customers_email.csv s",
            "select s.secret_token from s3://data/customers_email.csv s",
            "select s._3 from s3://data/customers_email.csv s",
            "select _3 from s3://data/customers_email.csv",
            "select upper(s.api_key) from s3://data/customers_email.csv s",
            "select s.name from s3://data/customers_email.csv s where s.email like 'a%'",
        ] {
            assert!(check_s3_select(sql, &idx).is_err(), "{sql}");
        }
        for sql in [
            "select * from s3://data/customers_email.csv",
            "select s.name, s.amount from s3://data/customers_email.csv s where s.amount > 10 limit 5",
            "select count(*) from s3://data/customers_email.csv s",
            "select s.name as label, cast(s.amount as int) from s3://data/customers_email.csv s",
            "list s3://data/secret_tokens/",
            "show buckets",
        ] {
            assert!(check_s3_select(sql, &idx).is_ok(), "{sql}");
        }
    }

    #[test]
    fn invalid_column_patterns_fail_closed() {
        let config = McpConfig::default();
        for bad in ["*email*", "kunde(", "(?!x)secret"] {
            let r = Redactor::new(&config.redaction, &[bad.to_string()]);
            assert!(r.check_valid().unwrap_err().contains(bad));
            assert!(r.column_is_sensitive("id"), "{bad}");
            assert_eq!(
                r.redact_cell("id", &Value::from("42")),
                Value::from("[redacted]")
            );
            let columns = vec![col("public", "orders", "id")];
            let idx = SchemaIndex::new(&columns, &r, &[]);
            let err = check_references("select id from orders", &idx, true).unwrap_err();
            assert!(err.contains(bad), "{err}");
            assert!(check_s3_select("select * from s3://b/k.csv", &idx).is_err());
        }
        let mut broken = config.clone();
        broken.redaction.columns[0].pattern = "(".into();
        let r = Redactor::new(&broken.redaction, &[]);
        assert!(r.check_valid().is_err());
        assert!(r.column_is_sensitive("id"));
        broken.redaction.columns[0].enabled = false;
        assert!(Redactor::new(&broken.redaction, &[]).check_valid().is_ok());
        let ok = Redactor::new(&config.redaction, &["kunden_.*".into(), " ".into()]);
        assert!(ok.check_valid().is_ok());
        assert!(!ok.column_is_sensitive("id"));
    }

    #[test]
    fn compiled_redactors_are_reused_bounded_and_keyed_by_rules() {
        let config = McpConfig::default();
        for n in 0..COMPILED_SLOTS * 2 {
            let r = Redactor::new(&config.redaction, &[format!("extra_{n}")]);
            assert!(r.column_is_sensitive(&format!("extra_{n}")));
            assert!(!r.column_is_sensitive(&format!("other_{n}")));
        }
        assert!(COMPILED.lock().unwrap().len() <= COMPILED_SLOTS);
        let split = Redactor::new(&config.redaction, &["a".into(), "b".into()]);
        let joined = Redactor::new(&config.redaction, &["a\u{0}b".into()]);
        assert!(split.column_is_sensitive("b"));
        assert!(!joined.column_is_sensitive("b"));
        let mut off = config.clone();
        off.redaction
            .columns
            .iter_mut()
            .for_each(|rule| rule.enabled = false);
        assert!(Redactor::new(&config.redaction, &[]).column_is_sensitive("password"));
        assert!(!Redactor::new(&off.redaction, &[]).column_is_sensitive("password"));
        assert!(Redactor::new(&config.redaction, &[]).column_is_sensitive("password"));
    }

    #[test]
    fn blocks_postgres_session_and_large_object_writers() {
        for sql in [
            "select set_config('default_transaction_read_only', 'off', false)",
            "SELECT pg_catalog.set_config('transaction_read_only', 'off', true)",
            "select lo_from_bytea(0, 'x')",
            "select lo_create(0)",
            "select lo_creat(-1)",
            "select lo_unlink(1)",
            "select pg_notify('c', 'x')",
            "select pg_create_logical_replication_slot('s', 'pgoutput')",
            "select pg_drop_replication_slot('s')",
            "select pg_advisory_lock(1)",
        ] {
            assert!(dangerous_word(sql).is_some(), "{sql}");
        }
        assert_eq!(
            dangerous_word("select current_setting('search_path')"),
            None
        );
        assert_eq!(dangerous_word("select set_config_name from settings"), None);
    }

    #[test]
    fn keywords_used_as_names_are_not_writes() {
        for sql in [
            "select t.comment, o.close, s.load from t",
            "select name, value from system.metrics",
            "select id from orders order by id fetch first 10 rows only",
            "select id from orders offset 5 rows fetch next 5 rows only",
            "select replace(name, 'a', 'b') from users",
        ] {
            assert_eq!(write_word(sql), None, "{sql}");
        }
        for (sql, word) in [
            ("select 1.into outfile '/tmp/x'", "into"),
            ("replace into t values (1)", "replace"),
            ("replace t values (1)", "replace"),
            ("fetch next from c", "fetch"),
            ("system flush logs", "system"),
            ("select comment from t", "comment"),
        ] {
            assert_eq!(write_word(sql).as_deref(), Some(word), "{sql}");
        }
    }

    #[test]
    fn column_aliases_named_like_tables_pass() {
        let idx = index(&[]);
        for sql in [
            "select count(*) as users from users",
            "select name, count(*) as orders from orders group by name",
            "select v.total from monthly_view v",
        ] {
            assert!(check_references(sql, &idx, true).is_ok(), "{sql}");
        }
        let sql = "select name, count(*) as orders from orders group by name order by orders desc";
        assert!(check_references(sql, &idx, true).is_err());
        assert!(check_references(sql, &idx, false).is_ok());
        let restricted = index(&["public"]);
        for sql in [
            "select count(*) as vault from users",
            "select o.vault from orders o",
            "select v.total from public.monthly_view v",
            "with t as (select id from orders) select t.id from t",
        ] {
            assert!(check_references(sql, &restricted, true).is_ok(), "{sql}");
        }
        assert!(check_references("select id from vault", &restricted, false).is_err());
        assert!(check_references(
            "select x.id from users secret, secret.vault x",
            &restricted,
            false
        )
        .is_err());
        assert!(check_references(
            "select v.id from users u, u.secret.vault v",
            &restricted,
            false
        )
        .is_err());
    }

    #[test]
    fn star_inside_functions_cannot_bypass_redaction() {
        let idx = index(&[]);
        for sql in [
            "select tuple(*) from users",
            "select toJSONString(tuple(*)) as t from users",
            "select * apply(toString) from users",
            "select columns('.*') apply(toString) from users",
        ] {
            assert!(check_references(sql, &idx, false).is_err(), "{sql}");
        }
        for sql in [
            "select count(*) from users",
            "select o.id from orders o cross apply (select 1 as x) a",
        ] {
            assert!(check_references(sql, &idx, false).is_ok(), "{sql}");
        }
    }
}
