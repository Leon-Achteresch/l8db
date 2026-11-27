use serde_json::{json, Value};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, OnceLock};
use std::time::Duration;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
const LOG_TAIL_BYTES: u64 = 256 * 1024;
const LOG_LINES: usize = 30;

static QUOTED: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"(^|[\s=(,:\[])(?:'(?:[^'\n]|'')*'|"[^"\n]*")"#).expect("quoted pattern")
});
static HOST_PORT: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r"\b(?:[A-Za-z0-9.-]*[A-Za-z][A-Za-z0-9.-]*|\d{1,3}(?:\.\d{1,3}){3}):\d{2,5}\b",
    )
    .expect("host pattern")
});

static NAME: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\b[\p{L}_][\p{L}\p{N}_$#]*(?:\.[\p{L}_][\p{L}\p{N}_$#]*)*")
        .expect("name pattern")
});
static LINE_PREFIX: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r"^(?:\[\d{4}-\d\d-\d\d\]\[[\d:]+\]\[[A-Z]+\]\[[^\]]*\]|- \[\d{4}-[^\]]*\] [\w.-]+:)",
    )
    .expect("prefix pattern")
});
const PLAIN_UPPERCASE: &str = " AI ALL ALTER AND API AS BEGIN BETWEEN BIGINT BLOB BODY BOOLEAN BY CALL CASE CHAR CHECK CLASS CLOB COLUMN COMMIT CONSTRAINT CREATE CSV DATABASE DATE DB DEBUG DECLARE DEFAULT DELETE DIRECTORY DISTINCT DROP ELSE END EOF ERROR EXCEPTION EXECUTE EXISTS FATAL FOREIGN FROM FUNCTION GRANT GROUP HAVING HTTP HTTPS ID IN INDEX INFO INNER INSERT INT INTEGER INTO IO IS JAVA JDBC JOIN JSON KEY LEFT LIBRARY LIKE LIMIT LINK MATERIALIZED MCP MERGE NOT NULL NUMBER NUMERIC NVARCHAR ODBC OFFSET OK ON OR ORA ORDER OS OUTER PACKAGE PL PLS PRIMARY PROCEDURE REFERENCES REPLACE RETURNING REVOKE RIGHT ROLE ROLLBACK SCHEMA SELECT SEQUENCE SET SOURCE SQL SQLSTATE SSH SSL SYNONYM TABLE TCP TEXT THEN TIMESTAMP TLS TNS TRIGGER TRUNCATE TYPE UNION UNIQUE UPDATE URL USER UTF VALUES VARCHAR VARCHAR2 VIEW WARN WARNING WHEN WHERE WITH XML ";

fn is_object_name(line: &str, word: regex::Match) -> bool {
    let text = word.as_str();
    if text.contains('.') || text.contains('_') {
        return true;
    }
    if text.chars().count() < 2
        || !text.chars().any(char::is_uppercase)
        || text.chars().any(char::is_lowercase)
        || PLAIN_UPPERCASE.contains(&format!(" {text} "))
    {
        return false;
    }
    let mut after = line[word.end()..].chars();
    if after.next() == Some('-') && after.next().is_some_and(|c| c.is_ascii_digit()) {
        return false;
    }
    let before = &line[..word.start()];
    let state = before
        .char_indices()
        .rev()
        .nth(11)
        .map_or(before, |(start, _)| &before[start..]);
    !(text.len() == 5
        && text.chars().any(|c| c.is_ascii_digit())
        && state.to_ascii_uppercase().contains("STATE"))
}

fn scrub_names(text: &str) -> String {
    text.lines()
        .map(|line| {
            let keep = LINE_PREFIX.find(line).map_or(0, |prefix| prefix.end());
            let rest = &line[keep..];
            let mut scrubbed = String::with_capacity(line.len());
            scrubbed.push_str(&line[..keep]);
            let mut last = 0;
            for word in NAME.find_iter(rest) {
                scrubbed.push_str(&rest[last..word.start()]);
                scrubbed.push_str(if is_object_name(rest, word) {
                    "…"
                } else {
                    word.as_str()
                });
                last = word.end();
            }
            scrubbed.push_str(&rest[last..]);
            scrubbed
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn scrub_log_line(line: &str) -> String {
    let mut line = crate::desktop::redact(line);
    for home in ["HOME", "USERPROFILE"]
        .into_iter()
        .filter_map(std::env::var_os)
    {
        let home = home.to_string_lossy();
        if home.len() > 1 {
            line = line.replace(home.as_ref(), "~");
        }
    }
    let line = QUOTED.replace_all(&line, "$1'…'");
    let line = HOST_PORT.replace_all(&line, "<host>");
    scrub_names(&line).chars().take(400).collect()
}

pub fn set_log_dir(dir: PathBuf) {
    let _ = LOG_DIR.set(dir);
}

pub fn log_dir() -> Option<PathBuf> {
    LOG_DIR.get().cloned()
}

fn recent_log(dir: &Path) -> String {
    let newest = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "log"))
        .max_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
    let Some(Ok(mut file)) = newest.map(|entry| std::fs::File::open(entry.path())) else {
        return String::new();
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut bytes = Vec::new();
    if file
        .seek(SeekFrom::Start(len.saturating_sub(LOG_TAIL_BYTES)))
        .is_err()
        || file.take(LOG_TAIL_BYTES).read_to_end(&mut bytes).is_err()
    {
        return String::new();
    }
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| line.contains("][ERROR][") || line.contains("][WARN]["))
        .collect();
    lines[lines.len().saturating_sub(LOG_LINES)..]
        .iter()
        .map(|line| scrub_log_line(line))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn tool_definition() -> Value {
    json!({
        "name": "report_issue",
        "description": "Create a public GitHub issue in the l8db repository for a defect in l8db itself, only after the user agreed. l8db shows the draft as a GitHub issue preview and the user confirms before sending. Title: under 80 characters in the user's language, \"<area>: <symptom and trigger>\" (e.g. 'Tabellenansicht: Sortierung springt nach Aktualisieren zurück'), no prefixes like Bug:, no emoji. Body: GitHub-flavored Markdown in the user's language, no top-level heading, exactly these sections in order:\n### Beschreibung: one or two sentences on what fails and where.\n### Schritte: numbered, each step one concrete action a maintainer can repeat on their own database; start with the database family and version and the column types involved instead of the user's object names.\n### Erwartet: one sentence.\n### Tatsächlich: what happened instead; exact error messages verbatim in a ```text block; then how often it happens or what avoids it, when known.\nNothing else: no tables, chat summary, guesses about causes, business context, notes about unknown details, or anything that does not help to reproduce. Never include passwords, hosts, connection strings, names of tables, columns, schemas, connections or customers, or row values. l8db appends version, OS, recent errors, the latest log warnings and errors and, in the app, a redacted screenshot. Returns the issue URL.",
        "inputSchema": {"type": "object", "properties": {
            "title": {"type": "string", "maxLength": 150},
            "body": {"type": "string", "description": "GitHub Markdown with ### Beschreibung, ### Schritte, ### Erwartet, ### Tatsächlich"},
            "confirm": {"type": "boolean", "description": "MCP only: true after the user saw title and body and agreed to publish them"}
        }, "required": ["title", "body"]}
    })
}

pub const PROMPT: &str = "\nGitHub issues for l8db defects: if something here looks like a bug in l8db itself (a tool fails without a database cause, wrong data shown, crash, freeze, a feature not working as described), say so in one sentence and put \"Erstelle dafür ein GitHub-Issue\" (in the user's language) first in a followups block, once per problem. Never for the user's own SQL errors, permissions, network or server problems. After the user agrees, make the report reproducible for a maintainer without this chat or database: look up column types (describe) and the server version yourself, then ask in one message (at most three questions) only for what is still missing, typically the exact place and action in l8db (view, button or chat tool), the visible result and whether it happens every time. Then call report_issue (inside code as tools.report_issue when it is not in your tool list). Facts only: no guesses, no \"unknown\" notes. Never copy the user's names or values, not even in SQL: use neutral names like t, a, b and placeholder values.\n";

pub fn prompt() -> &'static str {
    if relay().is_ok() {
        PROMPT
    } else {
        ""
    }
}

pub fn compose(args: &Value, diagnostics: &str) -> Result<(String, String), String> {
    let title = crate::desktop::redact(args["title"].as_str().unwrap_or("").trim());
    let body = crate::desktop::redact(args["body"].as_str().unwrap_or("").trim());
    if title.is_empty() || body.is_empty() {
        return Err("title und body sind erforderlich.".into());
    }
    let title: String = title.chars().take(150).collect();
    let body: String = body.chars().take(25_000).collect();
    let environment = format!(
        "l8db {} · {} {}\n{}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        scrub_names(&crate::desktop::redact(diagnostics))
    );
    let environment: String = environment.chars().take(4_000).collect();
    let mut body = format!(
        "{body}\n\n### Umgebung\n```\n{}\n```",
        environment.trim_end().replace("```", "'''")
    );
    let log = LOG_DIR.get().map(|dir| recent_log(dir)).unwrap_or_default();
    if !log.is_empty() {
        let skip = log.chars().count().saturating_sub(6_000);
        let log: String = log.chars().skip(skip).collect();
        body.push_str(&format!(
            "\n\n<details><summary>Log</summary>\n\n```text\n{}\n```\n</details>",
            log.replace("```", "'''")
        ));
    }
    Ok((title, body))
}

pub fn relay() -> Result<String, String> {
    std::env::var("L8DB_ISSUE_RELAY_URL")
        .ok()
        .or(option_env!("L8DB_ISSUE_RELAY_URL").map(str::to_string))
        .map(|url| url.trim().trim_end_matches('/').to_string())
        .filter(|url| url.starts_with("https://"))
        .ok_or_else(|| "Issues melden ist in diesem Build nicht eingerichtet.".to_string())
}

pub async fn submit(title: &str, body: &str, screenshot: Option<&str>) -> Result<String, String> {
    let response = reqwest::Client::new()
        .post(format!("{}/issues", relay()?))
        .timeout(Duration::from_secs(60))
        .json(&json!({"title": title, "body": body, "screenshot": screenshot}))
        .send()
        .await
        .map_err(|error| format!("Issue-Dienst nicht erreichbar: {error}"))?;
    let status = response.status();
    let answer: Value = response.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(answer["error"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| format!("Issue-Dienst antwortet mit {status}.")));
    }
    answer["url"]
        .as_str()
        .map(|url| format!("Issue erstellt: {url}"))
        .ok_or_else(|| "Issue-Dienst hat keine Adresse geliefert.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_redacts_secrets_and_requires_text() {
        let (title, body) = compose(
            &json!({"title": "Absturz", "body": "postgres://admin:geheim@db.intern:5432/app password=hunter2"}),
            "Fehler: ```x``` token=abc",
        )
        .unwrap();
        assert_eq!(title, "Absturz");
        assert!(!body.contains("geheim") && !body.contains("hunter2") && !body.contains("abc"));
        assert!(body.contains("### Umgebung") && !body.contains("```x```"));
        assert!(compose(&json!({"title": " ", "body": "x"}), "").is_err());
    }

    #[test]
    fn diagnostics_and_logs_lose_object_names_but_keep_codes() {
        let diagnostics = "l8db: 0.19.0-canary.3\nOS: windows (Win32)\n- [2026-11-19T09:48:30.123Z] window.error: Tabelle KUNDEN fehlt\n\nLetzte fehlgeschlagene Abfragen:\n- Oracle: ORA-24344: PACKAGE BODY PA_ABRECHNUNG wurde mit Kompilierfehlern erstellt\nZeile 1, Spalte 15: PLS-00905: Objekt KUNDEN_TEST.PA_ABRECHNUNG ist ungültig\nPL/SQL: Compilation unit analysis terminated\n- no such table: main.rechnung_kopf (SQLSTATE HY000) in ÄRZTE";
        let (_, body) = compose(&json!({"title": "t", "body": "b"}), diagnostics).unwrap();
        for name in ["KUNDEN", "PA_ABRECHNUNG", "rechnung_kopf", "ÄRZTE"] {
            assert!(!body.contains(name), "{name}");
        }
        for kept in [
            "l8db: 0.19.0-canary.3\nOS: windows (Win32)",
            "- [2026-11-19T09:48:30.123Z] window.error: Tabelle … fehlt",
            "- Oracle: ORA-24344: PACKAGE BODY … wurde mit Kompilierfehlern erstellt",
            "Zeile 1, Spalte 15: PLS-00905: Objekt … ist ungültig",
            "PL/SQL: Compilation unit analysis terminated",
            "- no such table: … (SQLSTATE HY000) in …",
        ] {
            assert!(body.contains(kept), "{kept}\n{body}");
        }
        assert_eq!(
            scrub_log_line("[2026-11-19][09:48:30][WARN][odbc_api::handles::logging] State: HY000, Message: [Microsoft][ODBC Driver Manager] Sicht T_AUFTRAG fehlt"),
            "[2026-11-19][09:48:30][WARN][odbc_api::handles::logging] State: HY000, Message: [Microsoft][ODBC Driver Manager] Sicht … fehlt"
        );
    }

    #[test]
    fn recent_log_keeps_bounded_redacted_warnings_of_newest_file() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old.log");
        std::fs::write(&old, "[d][t][ERROR][x] alt\n").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&old)
            .unwrap()
            .set_modified(std::time::SystemTime::UNIX_EPOCH)
            .unwrap();
        let mut log = String::new();
        for i in 0..100_000 {
            log.push_str(&format!(
                "[d][t][INFO][x] info {i}\n[d][t][WARN][x] warn {i}\n"
            ));
        }
        log.push_str("[2026-11-06][12:34:05][ERROR][l8db_lib] PLS-00905: Objekt KUNDEN_TEST.PA_ABRECHNUNG ist ungültig\n");
        log.push_str("[2026-11-06][12:34:05][ERROR][l8db_lib] panic: couldn't reach db.intern:5432 or 10.0.0.7:1521 WHERE name = 'Max' password=hunter2\n");
        std::fs::write(dir.path().join("l8db.log"), &log).unwrap();
        let started = std::time::Instant::now();
        let text = recent_log(dir.path());
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(text.lines().count(), LOG_LINES);
        assert!(text.len() <= LOG_LINES * 401 * 4);
        assert!(text.ends_with("[2026-11-06][12:34:05][ERROR][l8db_lib] panic: couldn't reach <host> or <host> WHERE name = '…' password=<redacted>"));
        assert!(text.contains("[ERROR][l8db_lib] PLS-00905: Objekt … ist ungültig\n"));
        assert!(!text.contains("info") && !text.contains("alt"));
        assert!(recent_log(&dir.path().join("fehlt")).is_empty());
    }

    #[test]
    fn issue_prompt_only_when_relay_is_configured() {
        assert_eq!(prompt().is_empty(), relay().is_err());
        assert!(PROMPT.contains("report_issue") && PROMPT.contains("followups"));
        let description = tool_definition()["description"]
            .as_str()
            .unwrap()
            .to_string();
        for section in [
            "### Beschreibung",
            "### Schritte",
            "### Erwartet",
            "### Tatsächlich",
        ] {
            assert!(description.contains(section));
        }
    }
}
