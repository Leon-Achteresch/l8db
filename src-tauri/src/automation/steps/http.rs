use std::time::Duration;

use crate::automation::model::{Action, HttpMethod, LogLevel};
use crate::automation::runtime::{StepContext, StepOutcome};
use crate::automation::steps::wrong_action;

const MAX_BODY: usize = 1024 * 1024;

pub fn parse_expect(spec: &str) -> Result<Vec<(u16, u16)>, String> {
    let invalid = || format!("Ungültige Statusangabe „{spec}“ (z. B. 200, 200-299, 200,204).");
    let mut ranges = Vec::new();
    for part in spec.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        let (from, to) = match part.split_once('-') {
            Some((from, to)) => (from.trim(), to.trim()),
            None => (part, part),
        };
        let from: u16 = from.parse().map_err(|_| invalid())?;
        let to: u16 = to.parse().map_err(|_| invalid())?;
        if !(100..=599).contains(&from) || !(100..=599).contains(&to) || from > to {
            return Err(invalid());
        }
        ranges.push((from, to));
    }
    if ranges.is_empty() {
        return Err(invalid());
    }
    Ok(ranges)
}

async fn read_limited(mut response: reqwest::Response) -> Result<(String, bool), String> {
    let mut body = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Antwort konnte nicht gelesen werden: {error}"))?
    {
        let room = MAX_BODY - body.len();
        if chunk.len() > room {
            body.extend_from_slice(&chunk[..room]);
            truncated = true;
            break;
        }
        body.extend_from_slice(&chunk);
    }
    Ok((String::from_utf8_lossy(&body).into_owned(), truncated))
}

pub async fn http(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Http {
        method,
        url,
        headers,
        body,
        expect_status,
        capture,
    } = config
    else {
        return Err(wrong_action());
    };
    let expect_text = expect_status
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("200-299");
    let expected = parse_expect(expect_text)?;
    let url = ctx.vars.render(url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(
            ctx.step.timeout_seconds.unwrap_or(30).max(1),
        ))
        .connect_timeout(crate::db::execution::connection_duration())
        .user_agent(concat!("l8db/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("HTTP-Client konnte nicht erstellt werden: {error}"))?;
    let verb = match method {
        HttpMethod::Get => reqwest::Method::GET,
        HttpMethod::Post => reqwest::Method::POST,
        HttpMethod::Put => reqwest::Method::PUT,
        HttpMethod::Patch => reqwest::Method::PATCH,
        HttpMethod::Delete => reqwest::Method::DELETE,
    };
    let mut request = client.request(verb.clone(), &url);
    for (name, value) in headers {
        request = request.header(name.as_str(), ctx.vars.render(value)?);
    }
    if let Some(body) = body.as_deref().filter(|b| !b.is_empty()) {
        request = request.body(ctx.vars.render(body)?);
    }
    let send = async {
        let response = request
            .send()
            .await
            .map_err(|error| format!("HTTP-Anfrage fehlgeschlagen: {error}"))?;
        let status = response.status().as_u16();
        let (text, truncated) = read_limited(response).await?;
        Ok::<_, String>((status, text, truncated))
    };
    let (status, text, truncated) = tokio::select! {
        result = send => result?,
        _ = ctx.cancel.cancelled() => return Err("Abgebrochen.".into()),
    };
    (ctx.log)(LogLevel::Info, format!("{verb} {url} → {status}"));
    if !expected
        .iter()
        .any(|(from, to)| (*from..=*to).contains(&status))
    {
        let snippet: String = text.chars().take(300).collect();
        return Err(format!(
            "HTTP-Status {status} entspricht nicht der Erwartung „{expect_text}“: {snippet}"
        ));
    }
    let mut outcome = StepOutcome {
        value: Some(serde_json::json!(status)),
        ..StepOutcome::default()
    };
    if let Some(name) = capture.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        if truncated {
            (ctx.log)(LogLevel::Warn, "Antwort auf 1 MiB gekürzt.".into());
        }
        outcome.vars.insert(name.to_string(), text);
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::engine::tests::{harness, step};
    use crate::automation::model::RunStatus;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn mock(
        status: u16,
        body: &'static str,
    ) -> (String, tokio::sync::mpsc::UnboundedReceiver<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut buffer = vec![0u8; 16384];
                let mut request = Vec::new();
                loop {
                    let n = socket.read(&mut buffer).await.unwrap_or(0);
                    request.extend_from_slice(&buffer[..n]);
                    let text = String::from_utf8_lossy(&request).to_string();
                    if n == 0 {
                        break;
                    }
                    if let Some(end) = text.find("\r\n\r\n") {
                        let length = text
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                            })
                            .unwrap_or(0);
                        if request.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let _ = sender.send(String::from_utf8_lossy(&request).to_string());
                let response = format!(
                    "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        (format!("http://{address}"), receiver)
    }

    #[test]
    fn expect_status_forms() {
        assert_eq!(parse_expect("200").unwrap(), vec![(200, 200)]);
        assert_eq!(parse_expect("200-299").unwrap(), vec![(200, 299)]);
        assert_eq!(
            parse_expect("200, 204").unwrap(),
            vec![(200, 200), (204, 204)]
        );
        assert!(parse_expect("abc").is_err());
        assert!(parse_expect("299-200").is_err());
    }

    #[tokio::test]
    async fn status_expectation_capture_and_rendering() {
        let h = harness().await;
        let (url, mut requests) = mock(201, "{\"ok\":true}").await;
        let run = h
            .db
            .run(
                &h.services,
                vec![
                    step("a", json!({ "type": "http", "method": "post", "url": format!("{url}/hook?task=${{task|url}}"), "headers": { "X-Token": "t-${run_id}" }, "body": "{\"n\": \"${task|json}\"}", "expectStatus": "200,201", "capture": "reply" })),
                    step("b", json!({ "type": "condition", "left": "${reply}|${step.a.value}", "op": "eq", "right": "{\"ok\":true}|201", "then": { "type": "next" }, "otherwise": { "type": "end_failure" } })),
                ],
            )
            .await;
        assert_eq!(run.status, RunStatus::Success, "{:?}", run.error);
        let request = requests.recv().await.unwrap();
        assert!(
            request.starts_with("POST /hook?task=Test%20Task HTTP/1.1"),
            "{request}"
        );
        assert!(request
            .to_ascii_lowercase()
            .contains(&format!("x-token: t-{}", run.id)));
        assert!(request.ends_with("{\"n\": \"Test Task\"}"));
    }

    #[tokio::test]
    async fn unexpected_status_fails() {
        let h = harness().await;
        let (url, _requests) = mock(500, "kaputt").await;
        let run =
            h.db.run(
                &h.services,
                vec![step(
                    "a",
                    json!({ "type": "http", "method": "get", "url": url }),
                )],
            )
            .await;
        assert_eq!(run.status, RunStatus::Failed);
        let error = run.error.unwrap();
        assert!(
            error.contains("500") && error.contains("200-299") && error.contains("kaputt"),
            "{error}"
        );
    }
}
