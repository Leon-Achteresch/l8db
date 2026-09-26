use std::sync::OnceLock;

use regex::Regex;
use reqwest::Method;
use serde_json::{Map, Value};

use super::client::{Request, S3};
use super::xml;
use crate::db::QueryResult;

const MAX_ROWS: usize = 100_000;
const MAX_LIST_ROWS: usize = 10_000;

#[derive(Debug, PartialEq, Eq)]
pub enum Statement {
    Buckets,
    List {
        bucket: String,
        prefix: String,
    },
    Select {
        bucket: String,
        key: String,
        expression: String,
    },
}

fn from_pattern() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?is)\bFROM\s+(s3://[^\s;]+|"[^"]+"|'[^']+'|`[^`]+`|[a-z0-9][a-z0-9.\-]*/[^\s;]+)"#,
        )
        .expect("FROM-Muster")
    })
}

fn split_target(raw: &str, default_bucket: Option<&str>) -> (String, String) {
    let unquoted = raw.trim_matches(|c| c == '"' || c == '\'' || c == '`');
    let path = unquoted.strip_prefix("s3://").unwrap_or(unquoted);
    match path.split_once('/') {
        Some((bucket, rest)) if !bucket.is_empty() => (bucket.to_string(), rest.to_string()),
        _ => match default_bucket {
            Some(bucket) if !path.is_empty() && !unquoted.starts_with("s3://") => {
                (bucket.to_string(), path.to_string())
            }
            _ => (path.trim_matches('/').to_string(), String::new()),
        },
    }
}

pub fn parse(sql: &str, default_bucket: Option<&str>) -> Result<Statement, String> {
    let text = sql.trim().trim_end_matches(';').trim();
    let lower = text.to_ascii_lowercase();
    if lower == "show buckets" || lower == "list" || lower == "ls" {
        return Ok(Statement::Buckets);
    }
    for command in ["list ", "ls "] {
        if lower.starts_with(command) {
            let (bucket, prefix) = split_target(text[command.len()..].trim(), default_bucket);
            if bucket.is_empty() {
                return Ok(Statement::Buckets);
            }
            return Ok(Statement::List { bucket, prefix });
        }
    }
    if !lower.starts_with("select") {
        return Err("Unterstützt: SELECT … FROM s3://bucket/datei.csv (S3 Select), LIST s3://bucket/präfix, SHOW BUCKETS.".to_string());
    }
    let found = from_pattern()
        .captures(text)
        .and_then(|c| c.get(1))
        .ok_or("S3 Select benötigt ein Objekt im FROM, z. B. FROM s3://bucket/daten.csv s")?;
    let (bucket, key) = split_target(found.as_str(), default_bucket);
    if bucket.is_empty() || key.is_empty() || key.ends_with('/') {
        return Err(format!("Ungültiges Objekt im FROM: {}", found.as_str()));
    }
    let expression = format!("{}S3Object{}", &text[..found.start()], &text[found.end()..]);
    Ok(Statement::Select {
        bucket,
        key,
        expression,
    })
}

pub fn input_serialization(key: &str) -> Result<String, String> {
    let lower = key.to_ascii_lowercase();
    let (base, compression) = if let Some(b) = lower.strip_suffix(".gz") {
        (b, "GZIP")
    } else if let Some(b) = lower.strip_suffix(".bz2") {
        (b, "BZIP2")
    } else {
        (lower.as_str(), "NONE")
    };
    let format = match base.rsplit('.').next().unwrap_or_default() {
        "csv" => "<CSV><FileHeaderInfo>USE</FileHeaderInfo><AllowQuotedRecordDelimiter>true</AllowQuotedRecordDelimiter></CSV>",
        "tsv" => "<CSV><FileHeaderInfo>USE</FileHeaderInfo><FieldDelimiter>\t</FieldDelimiter></CSV>",
        "json" => "<JSON><Type>DOCUMENT</Type></JSON>",
        "jsonl" | "ndjson" => "<JSON><Type>LINES</Type></JSON>",
        "parquet" if compression == "NONE" => "<Parquet/>",
        _ => return Err(format!("S3 Select unterstützt CSV, TSV, JSON, JSONL und Parquet (optional .gz/.bz2), nicht: {key}")),
    };
    Ok(format!(
        "<CompressionType>{compression}</CompressionType>{format}"
    ))
}

fn read_u32(bytes: &[u8], at: usize) -> Option<usize> {
    bytes
        .get(at..at + 4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
}

fn parse_headers(mut data: &[u8]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    while let Some((&name_len, rest)) = data.split_first() {
        let Some(name) = rest.get(..name_len as usize) else {
            break;
        };
        let name = String::from_utf8_lossy(name).into_owned();
        let rest = &rest[name_len as usize..];
        let Some((&kind, rest)) = rest.split_first() else {
            break;
        };
        let (value, rest) = match kind {
            0 | 1 => (String::new(), rest),
            2 => (String::new(), rest.get(1..).unwrap_or_default()),
            3 => (String::new(), rest.get(2..).unwrap_or_default()),
            4 => (String::new(), rest.get(4..).unwrap_or_default()),
            5 | 8 => (String::new(), rest.get(8..).unwrap_or_default()),
            9 => (String::new(), rest.get(16..).unwrap_or_default()),
            6 | 7 => {
                let Some(len) = rest
                    .get(..2)
                    .map(|b| u16::from_be_bytes([b[0], b[1]]) as usize)
                else {
                    break;
                };
                let Some(value) = rest.get(2..2 + len) else {
                    break;
                };
                (
                    String::from_utf8_lossy(value).into_owned(),
                    &rest[2 + len..],
                )
            }
            _ => break,
        };
        out.push((name, value));
        data = rest;
    }
    out
}

pub fn decode_event_stream(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut records = Vec::new();
    let mut pos = 0;
    while let (Some(total), Some(headers_len)) = (read_u32(bytes, pos), read_u32(bytes, pos + 4)) {
        if total < 16 || pos + total > bytes.len() || 12 + headers_len > total - 4 {
            return Err("S3 Select: beschädigter Event-Stream".to_string());
        }
        let headers = parse_headers(&bytes[pos + 12..pos + 12 + headers_len]);
        let payload = &bytes[pos + 12 + headers_len..pos + total - 4];
        let get = |name: &str| {
            headers
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.as_str())
        };
        match (get(":message-type"), get(":event-type")) {
            (Some("error"), _) => {
                return Err(format!(
                    "S3 Select {}: {}",
                    get(":error-code").unwrap_or("Fehler"),
                    get(":error-message").unwrap_or("")
                ))
            }
            (_, Some("Records")) => records.extend_from_slice(payload),
            (_, Some("End")) => break,
            _ => {}
        }
        pos += total;
    }
    Ok(records)
}

pub fn records_to_result(records: &[u8], elapsed_ms: u64) -> QueryResult {
    let mut columns: Vec<String> = Vec::new();
    let mut rows = Vec::new();
    for line in String::from_utf8_lossy(records).lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: Value =
            serde_json::from_str(line).unwrap_or_else(|_| Value::String(line.to_string()));
        let object = match value {
            Value::Object(map) => map,
            other => Map::from_iter([("_1".to_string(), other)]),
        };
        for key in object.keys() {
            if !columns.contains(key) {
                columns.push(key.clone());
            }
        }
        rows.push(Value::Object(object));
        if rows.len() >= MAX_ROWS {
            break;
        }
    }
    QueryResult {
        columns,
        rows,
        rows_affected: None,
        execution_time_ms: elapsed_ms,
    }
}

pub async fn select(s3: &S3, bucket: &str, key: &str, expression: &str) -> Result<Vec<u8>, String> {
    let body = format!(
        "<SelectObjectContentRequest xmlns=\"{}\"><Expression>{}</Expression><ExpressionType>SQL</ExpressionType><InputSerialization>{}</InputSerialization><OutputSerialization><JSON><RecordDelimiter>\n</RecordDelimiter></JSON></OutputSerialization></SelectObjectContentRequest>",
        super::ops::S3_XMLNS,
        xml::escape(expression),
        input_serialization(key)?
    );
    let response = s3
        .send(
            Request::new(Method::POST, Some(bucket), Some(key))
                .query("select", "")
                .query("select-type", "2")
                .xml(body, "application/xml"),
        )
        .await?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("S3 Select: Antwort unvollständig: {e}"))?;
    decode_event_stream(&bytes)
}

pub async fn execute(s3: &S3, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let statement = parse(sql, s3.default_bucket.as_deref())?;
    let elapsed = |start: std::time::Instant| start.elapsed().as_millis() as u64;
    match statement {
        Statement::Buckets => {
            let buckets = s3.list_buckets().await?;
            Ok(QueryResult {
                columns: vec!["name".into(), "creation_date".into()],
                rows: buckets
                    .into_iter()
                    .map(|b| serde_json::json!({"name": b.name, "creation_date": b.creation_date}))
                    .collect(),
                rows_affected: None,
                execution_time_ms: elapsed(start),
            })
        }
        Statement::List { bucket, prefix } => {
            let mut rows = Vec::new();
            let mut token: Option<String> = None;
            loop {
                let page = s3
                    .list_objects(&bucket, &prefix, Some("/"), token.as_deref(), None)
                    .await?;
                rows.extend(page.prefixes.into_iter().map(|p| {
                    serde_json::json!({"type": "folder", "key": p, "size": null, "last_modified": null, "storage_class": null, "etag": null})
                }));
                rows.extend(page.objects.into_iter().map(|o| {
                    serde_json::json!({"type": "object", "key": o.key, "size": o.size, "last_modified": o.last_modified, "storage_class": o.storage_class, "etag": o.etag})
                }));
                match page.next_token {
                    Some(next) if rows.len() < MAX_LIST_ROWS => token = Some(next),
                    _ => break,
                }
            }
            Ok(QueryResult {
                columns: [
                    "type",
                    "key",
                    "size",
                    "last_modified",
                    "storage_class",
                    "etag",
                ]
                .map(String::from)
                .to_vec(),
                rows,
                rows_affected: None,
                execution_time_ms: elapsed(start),
            })
        }
        Statement::Select {
            bucket,
            key,
            expression,
        } => {
            let records = select(s3, &bucket, &key, &expression).await?;
            Ok(records_to_result(&records, elapsed(start)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_statements() {
        assert_eq!(parse("show buckets;", None).unwrap(), Statement::Buckets);
        assert_eq!(
            parse("LIST s3://demo/data/", None).unwrap(),
            Statement::List {
                bucket: "demo".into(),
                prefix: "data/".into()
            }
        );
        assert_eq!(
            parse("ls demo", None).unwrap(),
            Statement::List {
                bucket: "demo".into(),
                prefix: String::new()
            }
        );
        assert_eq!(
            parse(
                "SELECT s.name FROM \"demo/data/a b.csv\" s WHERE s.id = '1'",
                None
            )
            .unwrap(),
            Statement::Select {
                bucket: "demo".into(),
                key: "data/a b.csv".into(),
                expression: "SELECT s.name FROM S3Object s WHERE s.id = '1'".into()
            }
        );
        assert_eq!(
            parse("select * from s3://demo/x.json", None).unwrap(),
            Statement::Select {
                bucket: "demo".into(),
                key: "x.json".into(),
                expression: "select * from S3Object".into()
            }
        );
        assert_eq!(
            parse("SELECT * FROM 'data/x.csv'", Some("demo")).unwrap(),
            Statement::Select {
                bucket: "data".into(),
                key: "x.csv".into(),
                expression: "SELECT * FROM S3Object".into()
            }
        );
        assert!(parse("DELETE FROM x", None).is_err());
        assert!(parse("SELECT 1", None).is_err());
    }

    #[test]
    fn chooses_input_format() {
        assert!(input_serialization("a.csv").unwrap().contains("<CSV>"));
        assert!(input_serialization("a.csv.gz").unwrap().contains("GZIP"));
        assert!(input_serialization("a.ndjson").unwrap().contains("LINES"));
        assert!(input_serialization("a.parquet")
            .unwrap()
            .contains("Parquet"));
        assert!(input_serialization("a.bin").is_err());
    }

    fn message(headers: &[(&str, &str)], payload: &[u8]) -> Vec<u8> {
        let mut h = Vec::new();
        for (k, v) in headers {
            h.push(k.len() as u8);
            h.extend_from_slice(k.as_bytes());
            h.push(7);
            h.extend_from_slice(&(v.len() as u16).to_be_bytes());
            h.extend_from_slice(v.as_bytes());
        }
        let total = 12 + h.len() + payload.len() + 4;
        let mut out = Vec::new();
        out.extend_from_slice(&(total as u32).to_be_bytes());
        out.extend_from_slice(&(h.len() as u32).to_be_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&h);
        out.extend_from_slice(payload);
        out.extend_from_slice(&[0; 4]);
        out
    }

    #[test]
    fn decodes_event_stream() {
        let mut stream = message(
            &[(":message-type", "event"), (":event-type", "Records")],
            b"{\"a\":1,\"b\":\"x\"}\n{\"a\"",
        );
        stream.extend(message(
            &[(":message-type", "event"), (":event-type", "Records")],
            b":2}\n",
        ));
        stream.extend(message(
            &[(":message-type", "event"), (":event-type", "Stats")],
            b"<Stats/>",
        ));
        stream.extend(message(
            &[(":message-type", "event"), (":event-type", "End")],
            b"",
        ));
        let records = decode_event_stream(&stream).unwrap();
        let result = records_to_result(&records, 1);
        assert_eq!(result.columns, vec!["a", "b"]);
        assert_eq!(result.rows.len(), 2);
        let error = message(
            &[
                (":message-type", "error"),
                (":error-code", "InvalidQuery"),
                (":error-message", "bad"),
            ],
            b"",
        );
        assert_eq!(
            decode_event_stream(&error).unwrap_err(),
            "S3 Select InvalidQuery: bad"
        );
    }
}
