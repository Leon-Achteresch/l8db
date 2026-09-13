pub fn split(sql: &str) -> Vec<String> {
    split_with_escapes(sql, true)
}

pub fn split_postgres(sql: &str) -> Vec<String> {
    split_with_escapes(sql, false)
}

fn split_with_escapes(sql: &str, backslash_strings: bool) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut result = Vec::new();
    let mut start = 0;
    let mut i = 0;
    let mut code = false;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"--") {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
        } else if bytes[i..].starts_with(b"/*") {
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
        } else if matches!(bytes[i], b'\'' | b'"' | b'`' | b'[') {
            code = true;
            let quote = if bytes[i] == b'[' { b']' } else { bytes[i] };
            let escaped = quote == b'\''
                && (backslash_strings
                    || (i > 0
                        && matches!(bytes[i - 1], b'e' | b'E')
                        && (i < 2
                            || !(bytes[i - 2].is_ascii_alphanumeric() || bytes[i - 2] == b'_'))));
            i += 1;
            while i < bytes.len() {
                if bytes[i] == quote {
                    i += 1;
                    if i < bytes.len() && bytes[i] == quote {
                        i += 1;
                    } else {
                        break;
                    }
                } else if bytes[i] == b'\\' && escaped {
                    i = (i + 2).min(bytes.len());
                } else {
                    i += 1;
                }
            }
        } else if bytes[i] == b'$' {
            code = true;
            let mut end = i + 1;
            while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') {
                end += 1;
            }
            let valid = end == i + 1 || bytes[i + 1].is_ascii_alphabetic() || bytes[i + 1] == b'_';
            if valid && end < bytes.len() && bytes[end] == b'$' {
                let tag = &sql[i..=end];
                i = sql[end + 1..]
                    .find(tag)
                    .map(|offset| end + 1 + offset + tag.len())
                    .unwrap_or(bytes.len());
            } else {
                i += 1;
            }
        } else if bytes[i] == b';' {
            if code {
                result.push(sql[start..i].trim().to_string());
            }
            i += 1;
            start = i;
            code = false;
        } else {
            code |= !bytes[i].is_ascii_whitespace();
            i += 1;
        }
    }
    if code {
        result.push(sql[start..].trim().to_string());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{split, split_postgres};

    #[test]
    fn postgres_standard_strings_keep_backslashes_literal() {
        assert_eq!(split_postgres(r"SELECT '\'; SELECT 2").len(), 2);
        assert_eq!(split_postgres(r"SELECT E'a\';b'; SELECT 2").len(), 2);
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
