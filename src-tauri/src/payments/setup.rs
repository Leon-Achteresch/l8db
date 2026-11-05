use super::stripe::{StripeClient, API_VERSION};
use super::{fingerprint, identifier, store, webhook_account, Config, WebhookRecord};
use serde::Serialize;
use serde_json::{json, Value};
use std::future::Future;

pub(super) const SCHEMA: &str = include_str!("schema.sql");
const CHECKOUT: &str = include_str!("checkout.ts");
const WEBHOOK: &str = include_str!("webhook.ts");
const WEBHOOK_SLUG: &str = "l8db-billing-webhook";
const CHECKOUT_SLUG: &str = "l8db-billing";
const SECRETS: &[&str] = &[
    "L8DB_STRIPE_SECRET_KEY",
    "L8DB_STRIPE_WEBHOOK_SECRET",
    "L8DB_STRIPE_ACCOUNT",
    "L8DB_STRIPE_MODE",
    "L8DB_BILLING_PROJECT",
    "L8DB_BILLING_ORIGIN",
];
const EVENTS: &[&str] = &[
    "checkout.session.completed",
    "customer.created",
    "customer.updated",
    "customer.deleted",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "product.created",
    "product.updated",
    "product.deleted",
    "price.created",
    "price.updated",
    "price.deleted",
    "invoice.paid",
    "invoice.payment_failed",
];

#[derive(Serialize)]
pub struct Preview {
    sql: &'static str,
    schema: &'static str,
    functions: Vec<FunctionPreview>,
    secrets: &'static [&'static str],
    events: &'static [&'static str],
    webhook_url: String,
    api_version: &'static str,
}

#[derive(Serialize)]
pub struct FunctionPreview {
    slug: &'static str,
    url: String,
    verify_jwt: bool,
    source: &'static str,
}

#[derive(Serialize)]
pub struct Outcome {
    webhook_url: String,
    checkout_url: String,
    webhook_id: String,
    test_mode: bool,
    account_id: String,
    schema: &'static str,
}

fn function_url(reference: &str, slug: &str) -> String {
    format!("https://{reference}.supabase.co/functions/v1/{slug}")
}

pub(super) fn preview(reference: &str) -> Result<Preview, String> {
    Ok(Preview {
        sql: SCHEMA,
        schema: "l8db_billing",
        functions: vec![
            FunctionPreview {
                slug: WEBHOOK_SLUG,
                url: function_url(reference, WEBHOOK_SLUG),
                verify_jwt: false,
                source: WEBHOOK,
            },
            FunctionPreview {
                slug: CHECKOUT_SLUG,
                url: function_url(reference, CHECKOUT_SLUG),
                verify_jwt: false,
                source: CHECKOUT,
            },
        ],
        secrets: SECRETS,
        events: EVENTS,
        webhook_url: function_url(reference, WEBHOOK_SLUG),
        api_version: API_VERSION,
    })
}

fn nonce() -> String {
    format!("{:032x}", rand::random::<u128>())
}

pub(super) async fn ensure_webhook<F, Fut>(
    stripe: &StripeClient,
    reference: &str,
    url: &str,
    config: &Config,
    previous: Option<WebhookRecord>,
    save: F,
) -> Result<WebhookRecord, String>
where
    F: Fn(WebhookRecord) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    let mut record = previous
        .filter(|record| record.matches(config) && !record.nonce.is_empty())
        .unwrap_or_else(|| WebhookRecord {
            account: config.account.clone(),
            test_mode: config.test_mode,
            nonce: nonce(),
            ..WebhookRecord::default()
        });
    let has_secret = record.secret.is_some();
    if let (Some(id), true) = (record.id.clone(), has_secret) {
        let id = identifier(&id, "we_")?;
        match stripe.get(&format!("webhook_endpoints/{id}"), &[]).await {
            Ok(current) if current["url"].as_str() == Some(url) => {
                let mut fields: Vec<(String, String)> = EVENTS
                    .iter()
                    .map(|event| ("enabled_events[]".into(), event.to_string()))
                    .collect();
                fields.push(("disabled".into(), "false".into()));
                stripe
                    .post(
                        &format!("webhook_endpoints/{id}"),
                        &fields,
                        &format!("l8db:{reference}:webhook-update:{id}:{}", record.nonce),
                    )
                    .await?;
            }
            Ok(_) => {
                record = WebhookRecord {
                    nonce: nonce(),
                    configured_key: None,
                    id: None,
                    secret: None,
                    ..record
                }
            }
            Err(error) if error.starts_with("Stripe HTTP 404") => {
                record = WebhookRecord {
                    nonce: nonce(),
                    configured_key: None,
                    id: None,
                    secret: None,
                    ..record
                }
            }
            Err(error) => return Err(error),
        }
    } else {
        record.id = None;
        record.secret = None;
    }
    if record.id.is_none() {
        save(record.clone()).await?;
        let mut fields = vec![
            ("url".to_string(), url.to_string()),
            ("api_version".into(), API_VERSION.into()),
            ("description".into(), format!("l8db Supabase {reference}")),
            ("metadata[l8db_project]".into(), reference.to_string()),
        ];
        fields.extend(
            EVENTS
                .iter()
                .map(|event| ("enabled_events[]".to_string(), event.to_string())),
        );
        let created = stripe
            .post(
                "webhook_endpoints",
                &fields,
                &format!("l8db:{reference}:webhook:{}", record.nonce),
            )
            .await?;
        let id = identifier(created["id"].as_str().unwrap_or_default(), "we_")?;
        let secret = created["secret"]
            .as_str()
            .filter(|secret| secret.starts_with("whsec_"))
            .ok_or("Stripe hat kein Webhook-Secret zurückgegeben.")?;
        record.id = Some(id);
        record.secret = Some(secret.to_string());
        record.configured_key = None;
        save(record.clone()).await?;
    }
    let current = record.id.clone().unwrap_or_default();
    let listed = stripe
        .get("webhook_endpoints", &[("limit".into(), "100".into())])
        .await?;
    for endpoint in listed["data"].as_array().into_iter().flatten().take(100) {
        let id = endpoint["id"].as_str().unwrap_or_default();
        if id != current
            && endpoint["url"].as_str() == Some(url)
            && endpoint["metadata"]["l8db_project"].as_str() == Some(reference)
        {
            stripe
                .delete(&format!("webhook_endpoints/{}", identifier(id, "we_")?))
                .await?;
        }
    }
    Ok(record)
}

async fn deploy(reference: &str, slug: &str, source: &str) -> Result<(), String> {
    let token = crate::supabase::token().await?;
    let form = reqwest::multipart::Form::new()
        .text(
            "metadata",
            json!({"entrypoint_path":"index.ts","name":slug,"verify_jwt":false}).to_string(),
        )
        .part(
            "file",
            reqwest::multipart::Part::text(source.to_string())
                .file_name("index.ts")
                .mime_str("application/typescript")
                .map_err(|_| "Ungültiger Funktionstyp.")?,
        );
    let mut url = reqwest::Url::parse(&format!(
        "{}/projects/{reference}/functions/deploy",
        crate::supabase_studio::MANAGEMENT_API
    ))
    .map_err(|_| "Ungültige Projektadresse.")?;
    url.query_pairs_mut().append_pair("slug", slug);
    let response = crate::baas_file::upload_client()
        .post(url)
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|error| crate::supabase::network_error("Supabase", &error))?;
    crate::supabase_studio::checked(
        response,
        &format!("Funktion {slug} konnte nicht bereitgestellt werden."),
    )
    .await?;
    Ok(())
}

fn secret_values(
    reference: &str,
    config: &Config,
    record: &WebhookRecord,
) -> Result<Value, String> {
    let values = [
        config.key.as_str(),
        record.secret.as_deref().ok_or("Webhook-Secret fehlt.")?,
        config.account.as_str(),
        if config.test_mode { "test" } else { "live" },
        reference,
        config.origin.as_deref().ok_or("App-Adresse fehlt.")?,
    ];
    Ok(Value::Array(
        SECRETS
            .iter()
            .zip(values)
            .map(|(name, value)| json!({"name": name, "value": value}))
            .collect(),
    ))
}

pub(super) async fn install(
    reference: &str,
    config: &Config,
    previous: Option<WebhookRecord>,
) -> Result<Outcome, String> {
    crate::supabase_studio::sql::supabase_studio_sql_run(reference.into(), SCHEMA.into(), false)
        .await
        .map_err(|error| format!("Schema l8db_billing: {error}"))?;
    let url = function_url(reference, WEBHOOK_SLUG);
    let account = webhook_account(reference)?;
    let stripe = StripeClient::new(config.key.clone());
    let save = |record: WebhookRecord| {
        let account = account.clone();
        async move { store(account, &record).await }
    };
    let mut record = ensure_webhook(&stripe, reference, &url, config, previous, save).await?;
    crate::supabase_studio::management(
        reqwest::Method::POST,
        &format!("projects/{reference}/secrets"),
        Some(secret_values(reference, config, &record)?),
        "Function-Secrets konnten nicht gespeichert werden.",
    )
    .await?;
    deploy(reference, WEBHOOK_SLUG, WEBHOOK).await?;
    deploy(reference, CHECKOUT_SLUG, CHECKOUT).await?;
    record.configured_key = Some(fingerprint(&config.key));
    store(account, &record).await?;
    Ok(Outcome {
        webhook_url: url,
        checkout_url: function_url(reference, CHECKOUT_SLUG),
        webhook_id: record.id.unwrap_or_default(),
        test_mode: config.test_mode,
        account_id: config.account.clone(),
        schema: "l8db_billing",
    })
}

#[cfg(test)]
mod tests {
    use super::super::stripe::mock::{reply, serve};
    use super::*;
    use std::sync::{Arc, Mutex};

    const KEY: &str = "sk_test_1234567890123456";
    const URL: &str = "https://proj.supabase.co/functions/v1/l8db-billing-webhook";

    fn config() -> Config {
        Config {
            key: KEY.into(),
            account: "acct_1".into(),
            test_mode: true,
            origin: Some("https://app.example.com".into()),
        }
    }

    fn saver() -> (
        Arc<Mutex<Vec<WebhookRecord>>>,
        impl Fn(WebhookRecord) -> std::future::Ready<Result<(), String>>,
    ) {
        let saved = Arc::new(Mutex::new(Vec::new()));
        let log = saved.clone();
        (saved, move |record| {
            log.lock().unwrap().push(record);
            std::future::ready(Ok(()))
        })
    }

    #[test]
    fn schema_and_functions_keep_the_security_contract() {
        assert!(!SCHEMA.to_uppercase().contains("DROP SCHEMA"));
        assert!(SCHEMA.contains("CREATE SCHEMA IF NOT EXISTS l8db_billing"));
        assert!(SCHEMA.contains("ENABLE ROW LEVEL SECURITY"));
        assert!(SCHEMA.contains("GRANT EXECUTE ON FUNCTION public.l8db_billing_apply_event(jsonb, text) TO service_role"));
        for event in EVENTS {
            assert!(WEBHOOK.contains(&format!("\"{event}\"")), "{event}");
        }
        for name in SECRETS {
            assert!(CHECKOUT.contains(name) || WEBHOOK.contains(name), "{name}");
        }
        assert!(CHECKOUT.contains(API_VERSION));
        let preview = serde_json::to_string(&preview("proj").unwrap()).unwrap();
        assert!(preview.contains(URL));
        assert!(!preview.contains("sk_test"));
    }

    #[test]
    fn secrets_carry_account_mode_and_origin() {
        let record = WebhookRecord {
            secret: Some("whsec_1".into()),
            ..WebhookRecord::default()
        };
        let values = secret_values("proj", &config(), &record)
            .unwrap()
            .to_string();
        assert!(values.contains(r#""name":"L8DB_STRIPE_MODE","value":"test""#));
        assert!(values.contains(r#""name":"L8DB_STRIPE_ACCOUNT","value":"acct_1""#));
        assert!(
            values.contains(r#""name":"L8DB_BILLING_ORIGIN","value":"https://app.example.com""#)
        );
        assert!(secret_values(
            "proj",
            &Config {
                origin: None,
                ..config()
            },
            &record
        )
        .is_err());
    }

    #[tokio::test]
    async fn creates_once_with_a_persisted_nonce_and_removes_orphans() {
        let (base, seen) = serve(vec![
            reply(200, r#"{"id":"we_new","secret":"whsec_abc"}"#),
            reply(200, &format!(r#"{{"data":[{{"id":"we_new","url":"{URL}","metadata":{{"l8db_project":"proj"}}}},{{"id":"we_old","url":"{URL}","metadata":{{"l8db_project":"proj"}}}},{{"id":"we_foreign","url":"https://x.test","metadata":{{}}}}]}}"#)),
            reply(200, r#"{"id":"we_old","deleted":true}"#),
        ])
        .await;
        let stripe = StripeClient::with_base(KEY, base);
        let (saved, save) = saver();
        let record = ensure_webhook(&stripe, "proj", URL, &config(), None, save)
            .await
            .unwrap();
        assert_eq!(record.id.as_deref(), Some("we_new"));
        let saved = saved.lock().unwrap();
        assert_eq!(saved.len(), 2);
        assert!(saved[0].id.is_none() && saved[0].nonce == record.nonce);
        let seen = seen.lock().unwrap();
        assert!(seen[0].to_lowercase().contains(&format!(
            "idempotency-key: l8db:proj:webhook:{}",
            record.nonce
        )));
        assert!(seen[0].contains("api_version=2025-03-31.basil"));
        assert!(seen[2].starts_with("DELETE /webhook_endpoints/we_old "));
        assert_eq!(seen.len(), 3);
    }

    #[tokio::test]
    async fn retry_after_a_lost_response_reuses_the_pending_nonce() {
        let (base, seen) = serve(vec![
            reply(200, r#"{"id":"we_new","secret":"whsec_abc"}"#),
            reply(200, r#"{"data":[]}"#),
        ])
        .await;
        let stripe = StripeClient::with_base(KEY, base);
        let pending = WebhookRecord {
            account: "acct_1".into(),
            test_mode: true,
            nonce: "abc123".into(),
            ..WebhookRecord::default()
        };
        let (_, save) = saver();
        ensure_webhook(&stripe, "proj", URL, &config(), Some(pending), save)
            .await
            .unwrap();
        assert!(seen.lock().unwrap()[0]
            .to_lowercase()
            .contains("idempotency-key: l8db:proj:webhook:abc123"));
    }

    #[tokio::test]
    async fn a_record_from_another_account_or_mode_is_never_reused() {
        let (base, seen) = serve(vec![
            reply(200, r#"{"id":"we_live","secret":"whsec_live"}"#),
            reply(200, r#"{"data":[]}"#),
        ])
        .await;
        let stripe = StripeClient::with_base(KEY, base);
        let old = WebhookRecord {
            account: "acct_other".into(),
            test_mode: true,
            nonce: "old".into(),
            id: Some("we_old".into()),
            secret: Some("whsec_old".into()),
            configured_key: None,
        };
        let (_, save) = saver();
        let record = ensure_webhook(&stripe, "proj", URL, &config(), Some(old), save)
            .await
            .unwrap();
        assert_eq!(record.secret.as_deref(), Some("whsec_live"));
        assert_eq!(record.account, "acct_1");
        let seen = seen.lock().unwrap();
        assert!(seen[0].starts_with("POST /webhook_endpoints "));
        assert!(!seen[0].contains("old"));
    }

    #[tokio::test]
    async fn an_existing_endpoint_is_updated_not_duplicated() {
        let (base, seen) = serve(vec![
            reply(200, &format!(r#"{{"id":"we_1","url":"{URL}","status":"disabled"}}"#)),
            reply(200, r#"{"id":"we_1"}"#),
            reply(200, &format!(r#"{{"data":[{{"id":"we_1","url":"{URL}","metadata":{{"l8db_project":"proj"}}}}]}}"#)),
        ])
        .await;
        let stripe = StripeClient::with_base(KEY, base);
        let existing = WebhookRecord {
            account: "acct_1".into(),
            test_mode: true,
            nonce: "n1".into(),
            id: Some("we_1".into()),
            secret: Some("whsec_1".into()),
            configured_key: None,
        };
        let (saved, save) = saver();
        let record = ensure_webhook(&stripe, "proj", URL, &config(), Some(existing), save)
            .await
            .unwrap();
        assert_eq!(record.secret.as_deref(), Some("whsec_1"));
        assert!(saved.lock().unwrap().is_empty());
        let seen = seen.lock().unwrap();
        assert!(seen[1].starts_with("POST /webhook_endpoints/we_1 "));
        assert!(seen[1].ends_with("disabled=false"));
        assert_eq!(seen.len(), 3);
    }
}
