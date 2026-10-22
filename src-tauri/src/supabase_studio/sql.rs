use crate::supabase::{
    client, is_self_hosted, project_api_auth, project_secret_key, project_url, token, uses_pg_meta,
    validate_ref,
};
use serde::Serialize;
use serde_json::{Map, Value};
use std::time::Instant;

const MAX_ROWS: usize = 1000;
const MAX_QUERY_BYTES: usize = 1_000_000;
const MAX_ERROR_CHARS: usize = 4000;
const READ_ONLY_BLOCKED: &[&str] = &[
    "BEGIN", "START", "COMMIT", "END", "ROLLBACK", "ABORT", "PREPARE", "SET", "RESET", "DISCARD",
];

#[derive(Debug, Serialize)]
pub struct SupabaseSqlResult {
    pub columns: Vec<String>,
    pub rows: Vec<Map<String, Value>>,
    pub row_count: usize,
    pub truncated: bool,
    pub duration_ms: u64,
    pub statement_count: usize,
    pub read_only: bool,
}

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

fn dollar_tag(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    let mut end = 1;
    while end < bytes.len() && bytes[end] != b'$' {
        let valid = bytes[end].is_ascii_alphabetic()
            || bytes[end] == b'_'
            || (end > 1 && bytes[end].is_ascii_digit());
        if !valid {
            return None;
        }
        end += 1;
    }
    (end < bytes.len()).then(|| &text[..=end])
}

pub(crate) fn statement_heads(sql: &str) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut heads = Vec::new();
    let mut current: Option<String> = None;
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'-' && bytes.get(i + 1) == Some(&b'-') {
            i = sql[i..].find('\n').map_or(bytes.len(), |end| i + end + 1);
            continue;
        }
        if c == b'/' && bytes.get(i + 1) == Some(&b'*') {
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
        if c == b';' {
            heads.extend(current.take());
            i += 1;
            continue;
        }
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        let mut word = false;
        if c == b'\'' || c == b'"' {
            let escapes = c == b'\''
                && i > 0
                && bytes[i - 1].eq_ignore_ascii_case(&b'e')
                && (i < 2 || !is_word(bytes[i - 2]));
            i += 1;
            while i < bytes.len() {
                if escapes && bytes[i] == b'\\' {
                    i += 2;
                } else if bytes[i] == c {
                    i += 1;
                    if bytes.get(i) != Some(&c) {
                        break;
                    }
                    i += 1;
                } else {
                    i += 1;
                }
            }
        } else if c == b'$' {
            match dollar_tag(&sql[i..]) {
                Some(tag) => {
                    let body = i + tag.len();
                    i = sql[body..]
                        .find(tag)
                        .map_or(bytes.len(), |end| body + end + tag.len());
                }
                None => i += 1,
            }
        } else if is_word(c) {
            while i < bytes.len() && is_word(bytes[i]) {
                i += 1;
            }
            word = true;
        } else {
            i += 1;
        }
        if current.is_none() {
            current = Some(if word {
                sql[start..i].to_ascii_uppercase()
            } else {
                String::new()
            });
        }
    }
    heads.extend(current);
    heads
}

pub(crate) fn validate_query(query: &str, read_only: bool) -> Result<Vec<String>, String> {
    if query.len() > MAX_QUERY_BYTES {
        return Err("SQL ist zu lang (maximal 1 MB).".into());
    }
    let heads = statement_heads(query);
    if heads.is_empty() {
        return Err("Keine ausführbare SQL-Anweisung gefunden.".into());
    }
    if read_only {
        if let Some(head) = heads
            .iter()
            .find(|head| READ_ONLY_BLOCKED.contains(&head.as_str()))
        {
            return Err(format!(
                "{head} ist im Nur-Lesen-Modus nicht erlaubt. Nur-Lesen ausschalten, um Transaktions- und Sitzungsbefehle auszuführen."
            ));
        }
    }
    Ok(heads)
}

pub(crate) fn error_message(status: u16, body: &str) -> String {
    let parsed = serde_json::from_str::<Value>(body).ok();
    let text = parsed
        .as_ref()
        .and_then(|value| {
            ["formattedError", "message", "error", "msg"]
                .iter()
                .find_map(|key| value.get(key).and_then(Value::as_str))
        })
        .map(str::trim)
        .filter(|text| !text.is_empty());
    match (text, status) {
        (Some(text), _) => text.chars().take(MAX_ERROR_CHARS).collect(),
        (None, 401) => "Zugangstoken oder API-Schlüssel ungültig.".into(),
        (None, 403) => "Für diese Ressource fehlen Berechtigungen.".into(),
        (None, 429) => "Supabase-Limit erreicht. Bitte später erneut versuchen.".into(),
        (None, status) => format!("Supabase HTTP {status}: Anfrage fehlgeschlagen."),
    }
}

pub(crate) fn shape_result(
    rows: Vec<Value>,
    statement_count: usize,
    duration_ms: u64,
    read_only: bool,
) -> SupabaseSqlResult {
    let row_count = rows.len();
    let rows: Vec<Map<String, Value>> = rows
        .into_iter()
        .take(MAX_ROWS)
        .map(|row| match row {
            Value::Object(map) => map,
            other => Map::from_iter([("value".to_string(), other)]),
        })
        .collect();
    let mut columns: Vec<String> = Vec::new();
    for row in &rows {
        for key in row.keys() {
            if !columns.contains(key) {
                columns.push(key.clone());
            }
        }
    }
    SupabaseSqlResult {
        columns,
        rows,
        row_count,
        truncated: row_count > MAX_ROWS,
        duration_ms,
        statement_count,
        read_only,
    }
}

async fn send(reference: &str, query: &str, read_only: bool) -> Result<Vec<Value>, String> {
    let mut payload = serde_json::json!({ "query": query });
    if read_only {
        payload["read_only"] = Value::Bool(true);
    }
    let request = if is_self_hosted(reference) {
        project_api_auth(
            client().post(project_url(reference, "pg/query").await?),
            &project_secret_key(reference).await?,
        )
    } else {
        client()
            .post(format!(
                "https://api.supabase.com/v1/projects/{reference}/database/query"
            ))
            .bearer_auth(token().await?)
    };
    let response = request
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Supabase-Datenbank ist nicht erreichbar: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Antwort konnte nicht gelesen werden: {error}"))?;
    if !status.is_success() {
        return Err(error_message(status.as_u16(), &body));
    }
    match serde_json::from_str::<Value>(&body) {
        Ok(Value::Array(rows)) => Ok(rows),
        Ok(Value::Null) => Ok(Vec::new()),
        _ => Err("Supabase hat unerwartete Daten geliefert.".into()),
    }
}

#[tauri::command]
pub async fn supabase_studio_sql_run(
    reference: String,
    query: String,
    read_only: bool,
) -> Result<SupabaseSqlResult, String> {
    let reference = validate_ref(&reference)?;
    let heads = validate_query(&query, read_only)?;
    if !uses_pg_meta(reference).await? {
        return Err(
            "SQL ist nur mit Secret Key (selbst gehostet) oder Supabase-Zugangstoken möglich."
                .into(),
        );
    }
    let sql = if read_only {
        format!("SET TRANSACTION READ ONLY;\n{query}")
    } else {
        query
    };
    let started = Instant::now();
    let rows = send(reference, &sql, read_only).await?;
    let duration_ms = started.elapsed().as_millis() as u64;
    Ok(shape_result(rows, heads.len(), duration_ms, read_only))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heads_skip_comments_strings_and_dollar_quotes() {
        let sql = "-- DROP x;\nselect ';' , E'\\';' ; /* a; /* b; */ */ update t set a = $$;$$;\n\
                   create function f() returns int as $body$ select 1; $body$ language sql; \
                   select \"a;b\" from t where c = $1";
        assert_eq!(
            statement_heads(sql),
            vec!["SELECT", "UPDATE", "CREATE", "SELECT"]
        );
        assert_eq!(
            statement_heads("  ;; -- nur Kommentar\n"),
            Vec::<String>::new()
        );
        assert_eq!(statement_heads("(select 1)"), vec![""]);
        assert_eq!(statement_heads("select 'unterminated"), vec!["SELECT"]);
        assert_eq!(statement_heads("select 'ä';ö"), vec!["SELECT", ""]);
    }

    #[test]
    fn read_only_rejects_transaction_control() {
        assert!(validate_query("select 1; commit; drop table t", true).is_err());
        assert!(validate_query("SET default_transaction_read_only = off", true).is_err());
        assert!(validate_query("select 'commit'; select 2", true).is_ok());
        assert!(validate_query("begin; select 1; commit", false).is_ok());
        assert!(validate_query("   ", false).is_err());
        assert!(validate_query(&"x".repeat(MAX_QUERY_BYTES + 1), false).is_err());
        assert_eq!(
            validate_query("select 1; select 2", false).unwrap().len(),
            2
        );
    }

    #[test]
    fn error_message_prefers_postgres_text() {
        let body =
            r#"{"error":"e","formattedError":"ERROR:  42601: syntax error\n","message":"m"}"#;
        assert_eq!(error_message(400, body), "ERROR:  42601: syntax error");
        assert_eq!(error_message(400, r#"{"message":"Fehler"}"#), "Fehler");
        assert_eq!(
            error_message(401, "nope"),
            "Zugangstoken oder API-Schlüssel ungültig."
        );
        assert!(error_message(502, "").contains("502"));
    }

    #[test]
    fn shape_bounds_rows_and_keeps_column_order() {
        let rows: Vec<Value> = (0..1500)
            .map(|i| serde_json::from_str(&format!(r#"{{"z":{i},"a":null}}"#)).unwrap())
            .collect();
        let result = shape_result(rows, 1, 5, false);
        assert_eq!(result.columns, vec!["z", "a"]);
        assert_eq!(result.rows.len(), MAX_ROWS);
        assert_eq!(result.row_count, 1500);
        assert!(result.truncated);
        let small = shape_result(vec![Value::from(3)], 2, 1, true);
        assert_eq!(small.columns, vec!["value"]);
        assert!(!small.truncated);
    }

    #[tokio::test]
    #[ignore]
    async fn supabase_studio_sql_live() {
        use crate::baas_self_hosted_live_tests::{env, isolate_secrets, latency};
        use crate::supabase::{supabase_connect_self_hosted, supabase_disconnect_self_hosted};
        let (Some(url), Some(key)) = (env("L8DB_E2E_SUPABASE_URL"), env("L8DB_E2E_SUPABASE_KEY"))
        else {
            return;
        };
        let _secrets = isolate_secrets();
        let project = supabase_connect_self_hosted(url, key, "SQL Lab".into())
            .await
            .unwrap();
        let reference = project.reference.clone();
        let run = |sql: &str, read_only: bool| {
            supabase_studio_sql_run(reference.clone(), sql.to_string(), read_only)
        };

        let result = run("select 2 as b, null as a, '{\"x\":1}'::jsonb as j", false)
            .await
            .unwrap();
        assert_eq!(result.columns, vec!["b", "a", "j"]);
        assert_eq!(result.rows[0]["j"]["x"], 1);
        assert!(result.rows[0]["a"].is_null());

        let multi = run("select 1 as first; select 2 as second", false)
            .await
            .unwrap();
        assert_eq!(multi.statement_count, 2);
        assert_eq!(multi.columns, vec!["second"]);

        let error = run("selec 1", false).await.unwrap_err();
        assert!(error.contains("syntax error"), "{error}");

        let table = "l8db_sql_live";
        run(
            &format!("drop table if exists {table}; create table {table}(id int)"),
            false,
        )
        .await
        .unwrap();
        let blocked = run(&format!("insert into {table} values (1)"), true)
            .await
            .unwrap_err();
        assert!(blocked.contains("read-only"), "{blocked}");
        assert!(
            run(&format!("commit; insert into {table} values (1)"), true)
                .await
                .is_err()
        );
        let count = run(&format!("select count(*)::int as n from {table}"), true)
            .await
            .unwrap();
        assert_eq!(count.rows[0]["n"], 0);
        let session = run("show transaction_read_only", false).await.unwrap();
        assert_eq!(session.rows[0]["transaction_read_only"], "off");
        let inserted = run(
            &format!("insert into {table} select generate_series(1, 1500) returning id"),
            false,
        )
        .await
        .unwrap();
        assert_eq!(inserted.row_count, 1500);
        assert_eq!(inserted.rows.len(), MAX_ROWS);
        assert!(inserted.truncated);

        latency("supabase_studio_sql_run select", 500, || {
            let future = run("select id from l8db_sql_live order by id limit 100", true);
            async move {
                future.await.unwrap();
            }
        })
        .await;
        latency("supabase_studio_sql_run bounded 1500 rows", 500, || {
            let future = run("select * from l8db_sql_live", false);
            async move {
                future.await.unwrap();
            }
        })
        .await;

        run(&format!("drop table {table}"), false).await.unwrap();
        supabase_disconnect_self_hosted(reference.clone())
            .await
            .unwrap();
    }
}
