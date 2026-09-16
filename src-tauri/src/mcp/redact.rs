use regex::{Regex, RegexBuilder};
use serde_json::Value;

use super::config::Redaction;

pub struct Redactor {
    columns: Vec<Regex>,
    values: Vec<Regex>,
    replacement: String,
}

fn compile(pattern: &str, case_insensitive: bool) -> Option<Regex> {
    RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .size_limit(1 << 20)
        .build()
        .ok()
}

impl Redactor {
    pub fn new(redaction: &Redaction, extra_columns: &[String]) -> Self {
        let columns = redaction
            .columns
            .iter()
            .filter(|rule| rule.enabled)
            .map(|rule| rule.pattern.as_str())
            .chain(extra_columns.iter().map(String::as_str))
            .filter_map(|pattern| compile(pattern, true))
            .collect();
        let values = redaction
            .values
            .iter()
            .filter(|rule| rule.enabled)
            .filter_map(|rule| compile(&rule.pattern, false))
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
                let text = value.to_string();
                Value::String(self.redact_text(&text))
            }
            other => other.clone(),
        }
    }
}

const WRITE_WORDS: &[&str] = &[
    "insert", "update", "delete", "merge", "upsert", "replace", "drop", "alter", "create",
    "truncate", "grant", "revoke", "call", "exec", "execute", "copy", "vacuum", "analyze",
    "lock", "set", "reset", "refresh", "do", "into", "load", "import", "attach", "detach",
    "rename", "comment", "cluster", "reindex", "begin", "commit", "rollback", "savepoint",
    "prepare", "deallocate", "listen", "notify", "unlisten", "declare", "fetch", "move",
    "close", "discard", "security", "reassign", "kill", "shutdown", "use", "optimize",
    "system", "purge", "flush", "install", "pragma", "bulk", "backup", "restore", "dbcc",
    "shutdown", "sp_", "xp_",
];

const DDL_WORDS: &[&str] = &[
    "create", "alter", "drop", "truncate", "rename", "grant", "revoke", "comment", "reindex",
    "cluster", "attach", "detach", "install", "vacuum",
];

pub fn sql_words(sql: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut chars = sql.chars().peekable();
    let mut quote: Option<char> = None;
    let mut line_comment = false;
    let mut block_comment = false;
    let flush = |current: &mut String, words: &mut Vec<String>| {
        if !current.is_empty() {
            words.push(current.to_lowercase());
            current.clear();
        }
    };
    while let Some(c) = chars.next() {
        if line_comment {
            if c == '\n' {
                line_comment = false;
            }
            continue;
        }
        if block_comment {
            if c == '*' && chars.peek() == Some(&'/') {
                chars.next();
                block_comment = false;
            }
            continue;
        }
        if let Some(q) = quote {
            if c == q {
                if chars.peek() == Some(&q) {
                    chars.next();
                } else {
                    quote = None;
                }
            }
            continue;
        }
        match c {
            '\'' | '"' | '`' | '[' => {
                flush(&mut current, &mut words);
                quote = Some(if c == '[' { ']' } else { c });
            }
            '-' if chars.peek() == Some(&'-') => {
                flush(&mut current, &mut words);
                line_comment = true;
            }
            '/' if chars.peek() == Some(&'*') => {
                flush(&mut current, &mut words);
                block_comment = true;
            }
            c if c.is_alphanumeric() || c == '_' => current.push(c),
            _ => flush(&mut current, &mut words),
        }
    }
    flush(&mut current, &mut words);
    words
}

pub fn write_word(sql: &str) -> Option<String> {
    sql_words(sql).into_iter().find(|word| {
        WRITE_WORDS
            .iter()
            .any(|w| word == w || (w.ends_with('_') && word.starts_with(w)))
    })
}

pub fn is_ddl(sql: &str) -> bool {
    sql_words(sql)
        .iter()
        .any(|word| DDL_WORDS.contains(&word.as_str()))
}

pub fn statement_count(sql: &str) -> usize {
    let mut count = 0;
    let mut quote: Option<char> = None;
    let mut seen_text = false;
    for c in sql.chars() {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            '\'' | '"' => quote = Some(c),
            ';' if seen_text => {
                count += 1;
                seen_text = false;
            }
            c if !c.is_whitespace() && c != ';' => seen_text = true,
            _ => {}
        }
    }
    count + usize::from(seen_text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::config::McpConfig;

    fn redactor() -> Redactor {
        Redactor::new(&McpConfig::default().redaction, &["kunden_.*".into()])
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
    fn values_are_masked_inside_text() {
        let r = redactor();
        let text = "Mail an max@example.com, IBAN DE89 3704 0044 0532 0130 00, Karte 4111 1111 1111 1111, Tel +49 170 1234567, ip 10.0.0.1";
        let out = r.redact_text(text);
        assert!(!out.contains("example.com"), "{out}");
        assert!(!out.contains("3704"), "{out}");
        assert!(!out.contains("4111"), "{out}");
        assert!(!out.contains("1234567"), "{out}");
        assert!(!out.contains("10.0.0.1"), "{out}");
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
    fn classifies_sql() {
        assert_eq!(write_word("SELECT * FROM users WHERE name = 'DROP TABLE'"), None);
        assert_eq!(write_word("select 1 -- delete\n/* update */"), None);
        assert_eq!(write_word("WITH x AS (SELECT 1) SELECT * FROM x"), None);
        assert_eq!(write_word("explain select 1"), None);
        assert_eq!(write_word("SELECT \"delete\" FROM t"), None);
        assert_eq!(write_word("DELETE FROM users"), Some("delete".into()));
        assert_eq!(write_word("WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x"), Some("delete".into()));
        assert_eq!(write_word("select * into t2 from t"), Some("into".into()));
        assert_eq!(write_word("exec sp_who"), Some("exec".into()));
        assert_eq!(write_word("select sp_helptext"), Some("sp_helptext".into()));
        assert!(is_ddl("create table x(a int)"));
        assert!(!is_ddl("update x set a = 1"));
        assert_eq!(statement_count("select 1; select 2"), 2);
        assert_eq!(statement_count("select ';' ;"), 1);
        assert_eq!(statement_count(""), 0);
    }
}
