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
    regex::Regex::new(r"\b[A-Za-z0-9][A-Za-z0-9.-]*:\d{2,5}\b").expect("host pattern")
});

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
    line.chars().take(400).collect()
}

pub fn set_log_dir(dir: PathBuf) {
    let _ = LOG_DIR.set(dir);
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
        "description": "Create a public GitHub issue in the l8db repository for a bug or problem in l8db itself, only after the user agreed. l8db shows the draft as a native GitHub issue preview before sending, so write it like a maintainer would: title under 80 characters naming the area and the symptom (e.g. 'Tabellenansicht: Sortierung nach Datum springt zurück'), no prefixes like Bug:, no emoji. Body in GitHub-flavored Markdown, text in the user's language, no top-level heading, exactly these sections in order: ### Beschreibung (one or two sentences), ### Schritte (numbered list), ### Erwartet, ### Tatsächlich; exact error messages verbatim in a ```text block under Tatsächlich. Keep it short; no tables, no chat summary, no guesses about causes. Never include passwords, hosts, connection strings, table names or row data. l8db appends version, OS, recent errors, the latest log warnings and errors (including crashes) and, in the app, a redacted screenshot; the user confirms before sending. Returns the issue URL.",
        "inputSchema": {"type": "object", "properties": {
            "title": {"type": "string", "maxLength": 150},
            "body": {"type": "string", "description": "GitHub Markdown with ### Beschreibung, ### Schritte, ### Erwartet, ### Tatsächlich"},
            "confirm": {"type": "boolean", "description": "MCP only: true after the user saw title and body and agreed to publish them"}
        }, "required": ["title", "body"]}
    })
}

pub const PROMPT: &str = "\nWhenever something in this conversation looks like a defect in l8db itself, whatever the topic (an l8db tool fails without a database cause, the app shows wrong data, crashes, hangs or a feature does not work as described), say so in one sentence, ask whether you should create a GitHub issue for it and make \"Erstelle dafür ein GitHub-Issue\" (in the user's language) the first line of a followups block. Ask once per problem. Do not offer it for the user's own SQL errors, permissions, network or server problems. Call report_issue (load it with discover_tools when it is not offered yet) only after the user agrees.\n";

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
        crate::desktop::redact(diagnostics)
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
        log.push_str("[d][t][ERROR][l8db_lib] panic: couldn't reach db.intern:5432 WHERE name = 'Max' password=hunter2\n");
        std::fs::write(dir.path().join("l8db.log"), &log).unwrap();
        let started = std::time::Instant::now();
        let text = recent_log(dir.path());
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(text.lines().count(), LOG_LINES);
        assert!(text.len() <= LOG_LINES * 401 * 4);
        assert!(text.ends_with("panic: couldn't reach <host> WHERE name = '…' password=<redacted>"));
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
