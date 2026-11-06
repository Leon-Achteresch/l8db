use serde_json::{json, Value};
use std::time::Duration;

pub fn tool_definition() -> Value {
    json!({
        "name": "report_issue",
        "description": "Create a public GitHub issue in the l8db repository for a bug or problem in l8db itself, only after the user agreed. l8db shows the draft as a native GitHub issue preview before sending, so write it like a maintainer would: title under 80 characters naming the area and the symptom (e.g. 'Tabellenansicht: Sortierung nach Datum springt zurück'), no prefixes like Bug:, no emoji. Body in GitHub-flavored Markdown, text in the user's language, no top-level heading, exactly these sections in order: ### Beschreibung (one or two sentences), ### Schritte (numbered list), ### Erwartet, ### Tatsächlich; exact error messages verbatim in a ```text block under Tatsächlich. Keep it short; no tables, no chat summary, no guesses about causes. Never include passwords, hosts, connection strings, table names or row data. l8db appends version, OS, recent errors and, in the app, a redacted screenshot; the user confirms before sending. Returns the issue URL.",
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
    Ok((
        title,
        format!(
            "{body}\n\n### Umgebung\n```\n{}\n```",
            environment.trim_end().replace("```", "'''")
        ),
    ))
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
