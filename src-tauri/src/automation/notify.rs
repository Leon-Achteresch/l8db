use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use hmac::{Hmac, KeyInit, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

use crate::automation::model::{
    Action, AutomationSettings, ChannelRef, NotifyWhen, RunDetail, RunStatus, SmtpProfile,
    SmtpSecurity, Task, TriggerKind, WebhookKind, WebhookTarget,
};
use crate::automation::runtime::{Services, StepContext, StepOutcome};
use crate::automation::vars::Vars;

pub const MAX_ATTACHMENT_BYTES: u64 = 20 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);

pub struct Message {
    pub title: String,
    pub body: String,
    pub attachments: Vec<PathBuf>,
    pub payload: serde_json::Value,
}

pub fn rule_matches(rule: NotifyWhen, event: NotifyWhen) -> bool {
    rule == event
        || (rule == NotifyWhen::Always
            && matches!(
                event,
                NotifyWhen::Success | NotifyWhen::Warning | NotifyWhen::Failure
            ))
}

pub fn default_title(event: NotifyWhen) -> &'static str {
    match event {
        NotifyWhen::Success | NotifyWhen::Always => "✓ ${task} erfolgreich",
        NotifyWhen::Failure => "✕ ${task} fehlgeschlagen",
        NotifyWhen::Warning => "! ${task} mit Warnungen",
        NotifyWhen::AlertTriggered => "Alarm: ${task}",
        NotifyWhen::AlertResolved => "Entwarnung: ${task}",
    }
}

pub fn default_body(event: NotifyWhen) -> &'static str {
    match event {
        NotifyWhen::Failure => "${run.summary}\nFehler: ${run.error}",
        _ => "${run.summary}",
    }
}

fn status_label(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Running => "läuft",
        RunStatus::Success => "erfolgreich",
        RunStatus::Warning => "Warnung",
        RunStatus::Failed => "fehlgeschlagen",
        RunStatus::Cancelled => "abgebrochen",
        RunStatus::Timeout => "Zeitüberschreitung",
        RunStatus::Skipped => "übersprungen",
        RunStatus::Interrupted => "unterbrochen",
    }
}

fn seconds(ms: u64) -> String {
    format!("{:.1} s", ms as f64 / 1000.0).replace('.', ",")
}

pub fn run_summary(run: &RunDetail) -> String {
    run.steps
        .iter()
        .filter(|step| step.depth == 0)
        .map(|step| {
            let mut line = format!(
                "{}. {}: {}",
                step.seq,
                step.step_name,
                status_label(step.status)
            );
            if let Some(rows) = step.rows {
                line.push_str(&format!(", {rows} Zeilen"));
            }
            if let Some(ms) = step.duration_ms {
                line.push_str(&format!(", {}", seconds(ms)));
            }
            if let Some(error) = step.error.as_deref().filter(|e| !e.is_empty()) {
                line.push_str(&format!(" – {error}"));
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn enum_text<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

pub fn run_values(task: &Task, run: &RunDetail) -> BTreeMap<String, String> {
    let summary = &run.summary;
    let mut values = run.vars.clone();
    values.insert("task".into(), task.name.clone());
    values.insert("task_id".into(), task.id.clone());
    values.insert("run_id".into(), summary.id.clone());
    values.insert("trigger".into(), enum_text(&summary.trigger));
    values.insert(
        "environment".into(),
        summary.environment.clone().unwrap_or_default(),
    );
    values.insert("run.status".into(), enum_text(&summary.status));
    values.insert(
        "run.duration".into(),
        summary.duration_ms.map(seconds).unwrap_or_default(),
    );
    values.insert(
        "run.error".into(),
        summary.error.clone().unwrap_or_default(),
    );
    values.insert(
        "run.outputs".into(),
        run.outputs
            .iter()
            .map(|output| output.path.clone())
            .collect::<Vec<_>>()
            .join("\n"),
    );
    values.insert("run.summary".into(), run_summary(run));
    values
}

pub fn substitute(template: &str, values: &BTreeMap<String, String>) -> String {
    let pattern =
        regex::Regex::new(r"\$\$\{|\$\{([A-Za-z_][A-Za-z0-9_.\-]*)(?::-([^}|]*))?(?:\|[^}]*)?\}")
            .expect("Platzhaltermuster");
    pattern
        .replace_all(template, |caps: &regex::Captures<'_>| {
            let Some(name) = caps.get(1) else {
                return "${".to_string();
            };
            match values.get(name.as_str()) {
                Some(value) => value.clone(),
                None => match caps.get(2) {
                    Some(default) => default.as_str().to_string(),
                    None => caps[0].to_string(),
                },
            }
        })
        .into_owned()
}

fn render_run(task: &Task, run: &RunDetail, template: &str) -> String {
    let values = run_values(task, run);
    let rendered = Vars::new(
        task,
        &run.summary.id,
        run.summary.environment.as_deref(),
        &run.vars,
        &BTreeMap::new(),
    )
    .and_then(|mut vars| {
        for (name, value) in &values {
            if name.starts_with("run.") {
                vars.set(name, value.clone());
            }
        }
        let text = vars.render(template)?;
        Ok(vars.mask(&text))
    });
    rendered.unwrap_or_else(|_| substitute(template, &values))
}

fn is_empty_run(run: &RunDetail) -> bool {
    run.outputs.is_empty() && run.steps.iter().all(|step| step.rows.unwrap_or(0) == 0)
}

pub fn run_payload(
    task: &Task,
    run: &RunDetail,
    event: NotifyWhen,
    title: &str,
    body: &str,
) -> Value {
    json!({
        "event": event,
        "task": { "id": task.id, "name": task.name },
        "run": run.summary,
        "title": title,
        "body": body,
        "outputs": run.outputs,
    })
}

fn channel_label(channel: &ChannelRef) -> &'static str {
    match channel {
        ChannelRef::Native => "Systembenachrichtigung",
        ChannelRef::Email { .. } => "E-Mail",
        ChannelRef::Webhook { .. } => "Webhook",
    }
}

pub async fn dispatch(
    services: &Services,
    task: &Task,
    run: &RunDetail,
    event: NotifyWhen,
) -> Vec<String> {
    let settings = match services.store.settings().await {
        Ok(settings) => settings,
        Err(error) => return vec![format!("Benachrichtigungen nicht möglich: {error}")],
    };
    let mut warnings = Vec::new();
    for rule in task
        .notifications
        .iter()
        .filter(|rule| rule.enabled && rule_matches(rule.when, event))
    {
        if rule.skip_if_empty && is_empty_run(run) {
            continue;
        }
        let title = if rule.title.trim().is_empty() {
            default_title(event)
        } else {
            rule.title.as_str()
        };
        let body = if rule.body.trim().is_empty() {
            default_body(event)
        } else {
            rule.body.as_str()
        };
        let title = render_run(task, run, title);
        let body = render_run(task, run, body);
        let message = Message {
            payload: run_payload(task, run, event, &title, &body),
            title,
            body,
            attachments: if rule.attach_outputs {
                run.outputs
                    .iter()
                    .map(|output| PathBuf::from(&output.path))
                    .collect()
            } else {
                Vec::new()
            },
        };
        if let Err(error) = deliver(&settings, &rule.channel, &message).await {
            warnings.push(format!(
                "{} konnte nicht gesendet werden: {error}",
                channel_label(&rule.channel)
            ));
        }
    }
    let has_native = task
        .notifications
        .iter()
        .any(|rule| rule.enabled && rule.channel == ChannelRef::Native);
    if settings.notify_native_on_failure
        && run.summary.trigger != TriggerKind::Manual
        && !has_native
        && matches!(run.summary.status, RunStatus::Failed | RunStatus::Timeout)
    {
        let title = render_run(task, run, default_title(NotifyWhen::Failure));
        let body = render_run(task, run, default_body(NotifyWhen::Failure));
        if let Err(error) = native(&title, &body).await {
            warnings.push(format!(
                "Systembenachrichtigung konnte nicht gesendet werden: {error}"
            ));
        }
    }
    warnings
}

pub async fn send(
    services: &Services,
    channel: &ChannelRef,
    message: &Message,
) -> Result<(), String> {
    let settings = services.store.settings().await?;
    deliver(&settings, channel, message).await
}

pub async fn notify(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Notify {
        channel,
        title,
        body,
        attach_outputs,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let title = ctx.vars.mask(&ctx.vars.render(title)?);
    let body = ctx.vars.mask(&ctx.vars.render(body)?);
    let outputs = if *attach_outputs {
        ctx.services
            .store
            .get_run(ctx.run_id)
            .await?
            .map(|run| run.outputs)
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let message = Message {
        payload: json!({
            "event": "step",
            "task": { "id": ctx.task.id, "name": ctx.task.name },
            "run": { "id": ctx.run_id },
            "title": title,
            "body": body,
            "outputs": outputs,
        }),
        attachments: outputs
            .iter()
            .map(|output| PathBuf::from(&output.path))
            .collect(),
        title,
        body,
    };
    send(ctx.services, channel, &message).await?;
    Ok(StepOutcome::default())
}

async fn deliver(
    settings: &AutomationSettings,
    channel: &ChannelRef,
    message: &Message,
) -> Result<(), String> {
    match channel {
        ChannelRef::Native => native(&message.title, &body_with_paths(message)).await,
        ChannelRef::Email { profile_id, to, cc } => {
            let profile = settings
                .smtp_profiles
                .iter()
                .find(|profile| &profile.id == profile_id)
                .ok_or("SMTP-Profil wurde nicht gefunden.")?;
            let password = match profile.username.as_deref().filter(|user| !user.is_empty()) {
                Some(_) => Some(
                    secret(format!("automation:smtp:{}", profile.id))
                        .await?
                        .ok_or("SMTP-Passwort fehlt im Schlüsselbund.")?,
                ),
                None => None,
            };
            send_email(profile, password.as_deref(), to, cc, message).await
        }
        ChannelRef::Webhook { webhook_id } => {
            let target = settings
                .webhooks
                .iter()
                .find(|webhook| &webhook.id == webhook_id)
                .ok_or("Webhook wurde nicht gefunden.")?;
            let url = secret(format!("automation:webhook:{}", target.id))
                .await?
                .filter(|url| !url.trim().is_empty())
                .ok_or("Webhook-URL fehlt im Schlüsselbund.")?;
            let hmac = if target.sign {
                Some(
                    secret(format!("automation:webhook:{}:hmac", target.id))
                        .await?
                        .filter(|key| !key.is_empty())
                        .ok_or("HMAC-Secret fehlt im Schlüsselbund.")?,
                )
            } else {
                None
            };
            post_webhook(target, &url, hmac.as_deref(), message).await
        }
    }
}

async fn secret(account: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || crate::db::secrets::read_secret(&account))
        .await
        .map_err(|error| format!("Schlüsselbund-Zugriff fehlgeschlagen: {error}"))?
        .map_err(|error| format!("Schlüsselbund-Zugriff fehlgeschlagen: {error}"))
}

pub fn body_with_paths(message: &Message) -> String {
    if message.attachments.is_empty() {
        return message.body.clone();
    }
    let paths = message
        .attachments
        .iter()
        .map(|path| format!("- {}", path.display()))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{}\n\nAusgaben:\n{paths}", message.body)
}

async fn native(title: &str, body: &str) -> Result<(), String> {
    let (title, body) = (title.to_string(), body.to_string());
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            static APP: std::sync::Once = std::sync::Once::new();
            APP.call_once(|| {
                let _ = notify_rust::set_application("com.leon.l8db");
            });
        }
        notify_rust::Notification::new()
            .summary(&title)
            .body(&body)
            .appname("l8db")
            .show()
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

pub fn webhook_body(kind: WebhookKind, message: &Message) -> Value {
    let body = body_with_paths(message);
    match kind {
        WebhookKind::Slack => json!({ "text": format!("*{}*\n{}", message.title, body) }),
        WebhookKind::Discord => json!({
            "content": truncate_chars(&format!("**{}**\n{}", message.title, body), 2000)
        }),
        WebhookKind::Teams => json!({
            "type": "message",
            "attachments": [{
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "body": [
                        { "type": "TextBlock", "text": message.title, "weight": "Bolder", "size": "Medium", "wrap": true },
                        { "type": "TextBlock", "text": body, "wrap": true }
                    ]
                }
            }]
        }),
        WebhookKind::Generic => match &message.payload {
            Value::Object(_) => message.payload.clone(),
            _ => json!({ "title": message.title, "body": message.body }),
        },
    }
}

pub fn hmac_hex(key: &[u8], data: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC-Schlüssel");
    mac.update(data);
    mac.finalize()
        .into_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn signature(secret: &str, timestamp: i64, body: &str) -> String {
    format!(
        "sha256={}",
        hmac_hex(secret.as_bytes(), format!("{timestamp}.{body}").as_bytes())
    )
}

fn http() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(TIMEOUT)
            .connect_timeout(crate::db::execution::connection_duration())
            .user_agent(concat!("l8db/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP-Client")
    })
}

async fn post_webhook(
    target: &WebhookTarget,
    url: &str,
    hmac: Option<&str>,
    message: &Message,
) -> Result<(), String> {
    let body = serde_json::to_string(&webhook_body(target.kind, message))
        .map_err(|error| error.to_string())?;
    let mut request = http()
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json");
    for (name, value) in &target.headers {
        request = request.header(name.as_str(), value.as_str());
    }
    if let Some(key) = hmac {
        let timestamp = chrono::Utc::now().timestamp();
        request = request
            .header("X-L8db-Timestamp", timestamp.to_string())
            .header("X-L8db-Signature", signature(key, timestamp, &body));
    }
    let response = request
        .body(body)
        .send()
        .await
        .map_err(|error| error.without_url().to_string())?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let text = response.text().await.unwrap_or_default();
    Err(format!(
        "Webhook antwortete mit {status}: {}",
        truncate_chars(text.trim(), 300)
    ))
}

fn mailbox(address: &str) -> Result<lettre::message::Mailbox, String> {
    address
        .trim()
        .parse()
        .map_err(|error| format!("Ungültige E-Mail-Adresse „{}“: {error}", address.trim()))
}

pub fn email(
    profile: &SmtpProfile,
    to: &[String],
    cc: &[String],
    message: &Message,
) -> Result<lettre::Message, String> {
    use lettre::message::{header::ContentType, Attachment, MultiPart, SinglePart};
    let recipients: Vec<&String> = to.iter().filter(|to| !to.trim().is_empty()).collect();
    if recipients.is_empty() {
        return Err("Keine Empfänger angegeben.".into());
    }
    let mut builder = lettre::Message::builder()
        .from(mailbox(&profile.from)?)
        .subject(message.title.clone());
    if let Some(reply) = profile.reply_to.as_deref().filter(|r| !r.trim().is_empty()) {
        builder = builder.reply_to(mailbox(reply)?);
    }
    for address in recipients {
        builder = builder.to(mailbox(address)?);
    }
    for address in cc.iter().filter(|cc| !cc.trim().is_empty()) {
        builder = builder.cc(mailbox(address)?);
    }
    let total: u64 = message
        .attachments
        .iter()
        .map(|path| {
            std::fs::metadata(path)
                .map(|meta| meta.len())
                .unwrap_or(u64::MAX)
        })
        .fold(0u64, u64::saturating_add);
    let attach = !message.attachments.is_empty() && total <= MAX_ATTACHMENT_BYTES;
    let text = if attach {
        message.body.clone()
    } else {
        body_with_paths(message)
    };
    let plain = SinglePart::builder()
        .header(ContentType::TEXT_PLAIN)
        .body(text);
    let built = if attach {
        let mut parts = MultiPart::mixed().singlepart(plain);
        for path in &message.attachments {
            let bytes = std::fs::read(path)
                .map_err(|e| format!("Anhang {} kann nicht gelesen werden: {e}", path.display()))?;
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "anhang".into());
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            let content_type = ContentType::parse(mime.essence_str())
                .unwrap_or_else(|_| ContentType::parse("application/octet-stream").expect("MIME"));
            parts = parts.singlepart(Attachment::new(name).body(bytes, content_type));
        }
        builder.multipart(parts)
    } else {
        builder.singlepart(plain)
    };
    built.map_err(|error| format!("E-Mail kann nicht erstellt werden: {error}"))
}

async fn send_email(
    profile: &SmtpProfile,
    password: Option<&str>,
    to: &[String],
    cc: &[String],
    message: &Message,
) -> Result<(), String> {
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
    let mail = email(profile, to, cc, message)?;
    let host = profile.host.trim();
    if host.is_empty() {
        return Err("SMTP-Server fehlt.".into());
    }
    let mut builder = match profile.security {
        SmtpSecurity::Starttls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)
            .map_err(|error| format!("SMTP: {error}"))?,
        SmtpSecurity::Tls => AsyncSmtpTransport::<Tokio1Executor>::relay(host)
            .map_err(|error| format!("SMTP: {error}"))?,
        SmtpSecurity::None => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host),
    }
    .port(profile.port)
    .timeout(Some(TIMEOUT));
    if let (Some(user), Some(password)) = (
        profile.username.as_deref().filter(|user| !user.is_empty()),
        password,
    ) {
        builder = builder.credentials(Credentials::new(user.to_string(), password.to_string()));
    }
    builder
        .build()
        .send(mail)
        .await
        .map(|_| ())
        .map_err(|error| format!("SMTP: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::model::{RunSummary, StepRun};
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

    fn message() -> Message {
        Message {
            title: "✓ Bericht erfolgreich".into(),
            body: "1. Export: erfolgreich, 3 Zeilen".into(),
            attachments: vec![PathBuf::from("/tmp/bericht.csv")],
            payload: json!({"event": "success", "title": "✓ Bericht erfolgreich"}),
        }
    }

    #[test]
    fn webhook_bodies_snapshot() {
        let message = message();
        assert_eq!(
            serde_json::to_string(&webhook_body(WebhookKind::Slack, &message)).unwrap(),
            r#"{"text":"*✓ Bericht erfolgreich*\n1. Export: erfolgreich, 3 Zeilen\n\nAusgaben:\n- /tmp/bericht.csv"}"#
        );
        assert_eq!(
            serde_json::to_string(&webhook_body(WebhookKind::Discord, &message)).unwrap(),
            r#"{"content":"**✓ Bericht erfolgreich**\n1. Export: erfolgreich, 3 Zeilen\n\nAusgaben:\n- /tmp/bericht.csv"}"#
        );
        assert_eq!(
            serde_json::to_string(&webhook_body(WebhookKind::Teams, &message)).unwrap(),
            r#"{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","content":{"type":"AdaptiveCard","version":"1.4","$schema":"http://adaptivecards.io/schemas/adaptive-card.json","body":[{"type":"TextBlock","text":"✓ Bericht erfolgreich","weight":"Bolder","size":"Medium","wrap":true},{"type":"TextBlock","text":"1. Export: erfolgreich, 3 Zeilen\n\nAusgaben:\n- /tmp/bericht.csv","wrap":true}]}}]}"#
        );
        assert_eq!(
            webhook_body(WebhookKind::Generic, &message),
            json!({"event": "success", "title": "✓ Bericht erfolgreich"})
        );
        let long = Message {
            body: "x".repeat(3000),
            attachments: Vec::new(),
            ..message
        };
        let content = webhook_body(WebhookKind::Discord, &long)["content"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(content.chars().count(), 2000);
        assert!(content.ends_with('…'));
    }

    #[test]
    fn hmac_matches_known_vectors() {
        assert_eq!(
            hmac_hex(b"Jefe", b"what do ya want for nothing?"),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        assert_eq!(
            signature("geheim", 1_790_000_000, r#"{"text":"hallo"}"#),
            "sha256=5a097ae36bb7d66fa081466c475e48aff74e65937a8715003239fd210c3ecb08"
        );
    }

    fn task() -> Task {
        serde_json::from_value(json!({
            "id": "task-1",
            "name": "Nachtbericht",
            "notifications": [
                {"id": "r1", "when": "failure", "channel": {"type": "webhook", "webhookId": "hook"}},
                {"id": "r2", "when": "always", "channel": {"type": "webhook", "webhookId": "hook"}, "title": "Lauf ${run.status}", "body": "${task}: ${run.error:-ok}"},
                {"id": "r3", "when": "success", "channel": {"type": "webhook", "webhookId": "hook"}, "skipIfEmpty": true},
                {"id": "r4", "enabled": false, "when": "failure", "channel": {"type": "webhook", "webhookId": "hook"}}
            ]
        }))
        .unwrap()
    }

    fn run(status: RunStatus, error: Option<&str>) -> RunDetail {
        RunDetail {
            summary: RunSummary {
                id: "run-1".into(),
                task_id: "task-1".into(),
                task_name: "Nachtbericht".into(),
                trigger: TriggerKind::Schedule,
                status,
                error: error.map(str::to_string),
                duration_ms: Some(1234),
                ..Default::default()
            },
            steps: vec![StepRun {
                seq: 1,
                step_id: "s1".into(),
                step_name: "Export".into(),
                kind: "export".into(),
                status,
                rows: Some(0),
                duration_ms: Some(800),
                error: error.map(str::to_string),
                ..Default::default()
            }],
            logs: Vec::new(),
            outputs: Vec::new(),
            vars: BTreeMap::new(),
            definition: task(),
        }
    }

    #[test]
    fn rules_and_rendering() {
        assert!(rule_matches(NotifyWhen::Always, NotifyWhen::Warning));
        assert!(!rule_matches(NotifyWhen::Success, NotifyWhen::Warning));
        assert!(!rule_matches(
            NotifyWhen::Always,
            NotifyWhen::AlertTriggered
        ));
        assert!(rule_matches(
            NotifyWhen::AlertResolved,
            NotifyWhen::AlertResolved
        ));
        let detail = run(RunStatus::Failed, Some("kaputt"));
        let values = run_values(&task(), &detail);
        assert_eq!(
            substitute(default_body(NotifyWhen::Failure), &values),
            "1. Export: fehlgeschlagen, 0 Zeilen, 0,8 s – kaputt\nFehler: kaputt"
        );
        assert_eq!(
            substitute("$${x} ${unbekannt} ${fehlt:-leer} ${task|upper}", &values),
            "${x} ${unbekannt} leer Nachtbericht"
        );
    }

    fn secrets_file() {
        static DIR: std::sync::OnceLock<tempfile::TempDir> = std::sync::OnceLock::new();
        DIR.get_or_init(|| {
            let dir = tempfile::tempdir().unwrap();
            if std::env::var_os("L8DB_DEV_SECRETS").is_none() {
                std::env::set_var("L8DB_DEV_SECRETS", dir.path().join("secrets.json"));
            }
            dir
        });
    }

    async fn services(settings: AutomationSettings) -> (tempfile::TempDir, Services) {
        secrets_file();
        let dir = tempfile::tempdir().unwrap();
        let store =
            crate::automation::store::Store::open(&dir.path().join("automation.db")).unwrap();
        store.save_settings(&settings).await.unwrap();
        (dir, Services::new(store, Arc::new(|_| {}), true))
    }

    async fn mock_http(
        status: u16,
        count: usize,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/hook", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let mut requests = Vec::new();
            for _ in 0..count {
                let (stream, _) = listener.accept().await.unwrap();
                let mut reader = BufReader::new(stream);
                let mut head = String::new();
                let mut length = 0usize;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).await.unwrap();
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap();
                    }
                    head.push_str(&line);
                    if line == "\r\n" {
                        break;
                    }
                }
                let mut body = vec![0u8; length];
                reader.read_exact(&mut body).await.unwrap();
                let reply = format!(
                    "HTTP/1.1 {status} X\r\ncontent-length: 4\r\nconnection: close\r\n\r\nnein"
                );
                reader.get_mut().write_all(reply.as_bytes()).await.unwrap();
                requests.push(format!("{head}{}", String::from_utf8(body).unwrap()));
            }
            requests
        });
        (url, handle)
    }

    fn webhook_settings(id: &str, sign: bool) -> AutomationSettings {
        let mut settings = AutomationSettings::default();
        settings.notify_native_on_failure = false;
        settings.webhooks.push(WebhookTarget {
            id: id.into(),
            name: "Hook".into(),
            kind: WebhookKind::Generic,
            headers: BTreeMap::from([("X-Team".to_string(), "daten".to_string())]),
            sign,
        });
        settings
    }

    #[tokio::test]
    async fn webhook_against_mock_server_with_signature() {
        let id = format!("hook-{}", crate::automation::runtime::new_id());
        let (_dir, services) = services(webhook_settings(&id, true)).await;
        let channel = ChannelRef::Webhook {
            webhook_id: id.clone(),
        };
        let missing = send(&services, &channel, &message()).await.unwrap_err();
        assert_eq!(missing, "Webhook-URL fehlt im Schlüsselbund.");
        let (url, handle) = mock_http(200, 1).await;
        crate::db::secrets::store_secret(format!("automation:webhook:{id}"), url)
            .await
            .unwrap();
        let no_key = send(&services, &channel, &message()).await.unwrap_err();
        assert_eq!(no_key, "HMAC-Secret fehlt im Schlüsselbund.");
        crate::db::secrets::store_secret(format!("automation:webhook:{id}:hmac"), "geheim".into())
            .await
            .unwrap();
        send(&services, &channel, &message()).await.unwrap();
        let request = handle.await.unwrap().remove(0);
        assert!(request.starts_with("POST /hook "), "{request}");
        let lower = request.to_ascii_lowercase();
        assert!(lower.contains("x-team: daten"));
        let body = request.split("\r\n\r\n").nth(1).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(body).unwrap(),
            json!({"event": "success", "title": "✓ Bericht erfolgreich"})
        );
        let timestamp: i64 = lower
            .lines()
            .find_map(|line| line.strip_prefix("x-l8db-timestamp: "))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let header = lower
            .lines()
            .find_map(|line| line.strip_prefix("x-l8db-signature: "))
            .unwrap()
            .trim()
            .to_string();
        assert_eq!(header, signature("geheim", timestamp, body));
    }

    #[tokio::test]
    async fn dispatch_applies_rules_and_reports_failures() {
        let id = format!("hook-{}", crate::automation::runtime::new_id());
        let mut settings = webhook_settings(&id, false);
        settings.webhooks[0].id = "hook".into();
        let (_dir, services) = services(settings).await;
        let (url, handle) = mock_http(200, 2).await;
        crate::db::secrets::store_secret("automation:webhook:hook".into(), url)
            .await
            .unwrap();
        let warnings = dispatch(
            &services,
            &task(),
            &run(RunStatus::Failed, Some("kaputt")),
            NotifyWhen::Failure,
        )
        .await;
        assert!(warnings.is_empty(), "{warnings:?}");
        let requests = handle.await.unwrap();
        let bodies: Vec<Value> = requests
            .iter()
            .map(|request| serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap())
            .collect();
        assert_eq!(bodies[0]["title"], "✕ Nachtbericht fehlgeschlagen");
        assert_eq!(bodies[0]["event"], "failure");
        assert_eq!(bodies[0]["task"]["name"], "Nachtbericht");
        assert_eq!(bodies[0]["run"]["status"], "failed");
        assert_eq!(bodies[1]["title"], "Lauf failed");
        assert_eq!(bodies[1]["body"], "Nachtbericht: kaputt");
        let (url, handle) = mock_http(500, 1).await;
        crate::db::secrets::store_secret("automation:webhook:hook".into(), url)
            .await
            .unwrap();
        let warnings = dispatch(
            &services,
            &task(),
            &run(RunStatus::Success, None),
            NotifyWhen::Success,
        )
        .await;
        handle.await.unwrap();
        assert_eq!(warnings.len(), 1, "{warnings:?}");
        assert!(warnings[0].contains("500"), "{warnings:?}");
        assert!(warnings[0].contains("nein"), "{warnings:?}");
        assert!(!warnings[0].contains("127.0.0.1"), "{warnings:?}");
    }

    async fn mock_smtp() -> (u16, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut reader = BufReader::new(stream);
            let mut transcript = String::new();
            reader
                .get_mut()
                .write_all(b"220 mock ESMTP\r\n")
                .await
                .unwrap();
            let mut in_data = false;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).await.unwrap() == 0 {
                    break;
                }
                transcript.push_str(&line);
                if in_data {
                    if line == ".\r\n" {
                        in_data = false;
                        reader.get_mut().write_all(b"250 OK\r\n").await.unwrap();
                    }
                    continue;
                }
                let upper = line.to_ascii_uppercase();
                let reply: &[u8] = if upper.starts_with("EHLO") {
                    b"250-mock\r\n250 8BITMIME\r\n"
                } else if upper.starts_with("DATA") {
                    in_data = true;
                    b"354 go\r\n"
                } else if upper.starts_with("QUIT") {
                    reader.get_mut().write_all(b"221 bye\r\n").await.unwrap();
                    break;
                } else {
                    b"250 OK\r\n"
                };
                reader.get_mut().write_all(reply).await.unwrap();
            }
            transcript
        });
        (port, handle)
    }

    #[tokio::test]
    async fn smtp_sends_mail_with_attachment() {
        let (port, handle) = mock_smtp().await;
        let dir = tempfile::tempdir().unwrap();
        let attachment = dir.path().join("bericht.csv");
        std::fs::write(&attachment, "id,name\n1,Zoë\n").unwrap();
        let mut settings = AutomationSettings::default();
        settings.smtp_profiles.push(SmtpProfile {
            id: "smtp".into(),
            name: "Lokal".into(),
            host: "127.0.0.1".into(),
            port,
            security: SmtpSecurity::None,
            username: None,
            from: "l8db <robot@example.com>".into(),
            reply_to: Some("team@example.com".into()),
        });
        let (_dir, services) = services(settings).await;
        let message = Message {
            title: "Bericht für Köln".into(),
            body: "Anbei der Bericht.".into(),
            attachments: vec![attachment],
            payload: Value::Null,
        };
        send(
            &services,
            &ChannelRef::Email {
                profile_id: "smtp".into(),
                to: vec!["ada@example.com".into()],
                cc: vec!["grace@example.com".into()],
            },
            &message,
        )
        .await
        .unwrap();
        let transcript = handle.await.unwrap();
        assert!(
            transcript.contains("MAIL FROM:<robot@example.com>"),
            "{transcript}"
        );
        assert!(
            transcript.contains("RCPT TO:<ada@example.com>"),
            "{transcript}"
        );
        assert!(
            transcript.contains("RCPT TO:<grace@example.com>"),
            "{transcript}"
        );
        assert!(transcript.contains("multipart/mixed"), "{transcript}");
        assert!(
            transcript.contains("filename=\"bericht.csv\""),
            "{transcript}"
        );
        assert!(transcript.contains("text/csv"), "{transcript}");
        assert!(
            transcript.contains("Reply-To: team@example.com"),
            "{transcript}"
        );
        let missing = send(
            &services,
            &ChannelRef::Email {
                profile_id: "fehlt".into(),
                to: vec!["a@example.com".into()],
                cc: Vec::new(),
            },
            &message,
        )
        .await
        .unwrap_err();
        assert_eq!(missing, "SMTP-Profil wurde nicht gefunden.");
    }

    #[test]
    fn large_attachments_become_paths() {
        let dir = tempfile::tempdir().unwrap();
        let big = dir.path().join("gross.bin");
        let file = std::fs::File::create(&big).unwrap();
        file.set_len(MAX_ATTACHMENT_BYTES + 1).unwrap();
        let profile = SmtpProfile {
            id: "p".into(),
            name: "p".into(),
            host: "h".into(),
            port: 25,
            security: SmtpSecurity::None,
            username: None,
            from: "a@example.com".into(),
            reply_to: None,
        };
        let mail = email(
            &profile,
            &["b@example.com".into()],
            &[],
            &Message {
                title: "t".into(),
                body: "b".into(),
                attachments: vec![big.clone()],
                payload: Value::Null,
            },
        )
        .unwrap();
        let text = String::from_utf8(mail.formatted()).unwrap();
        assert!(!text.contains("multipart/mixed"));
        assert!(text.contains("gross.bin"));
    }

    #[tokio::test]
    #[ignore]
    async fn native_notification_shows() {
        native("l8db Test", "Systembenachrichtigung aus dem Test")
            .await
            .unwrap();
    }
}
