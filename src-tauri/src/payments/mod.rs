mod setup;
mod stripe;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const MAX_PAGE: usize = 100;

fn validate_reference(value: &str) -> Result<&str, String> {
    crate::supabase::cloud_ref(value)
}

fn config_account(reference: &str) -> Result<String, String> {
    Ok(format!(
        "backend:payments:{}",
        validate_reference(reference)?
    ))
}

fn webhook_account(reference: &str) -> Result<String, String> {
    Ok(format!(
        "backend:payments-webhook:{}",
        validate_reference(reference)?
    ))
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Config {
    key: String,
    account: String,
    test_mode: bool,
    #[serde(default)]
    origin: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(super) struct WebhookRecord {
    account: String,
    test_mode: bool,
    nonce: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    secret: Option<String>,
    #[serde(default)]
    configured_key: Option<String>,
}

impl WebhookRecord {
    fn matches(&self, config: &Config) -> bool {
        self.account == config.account && self.test_mode == config.test_mode
    }
}

fn fingerprint(key: &str) -> String {
    Sha256::digest(key.as_bytes())[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

async fn stored<T: serde::de::DeserializeOwned>(account: String) -> Result<Option<T>, String> {
    match crate::db::secrets::backend_secret(account).await? {
        None => Ok(None),
        Some(text) => serde_json::from_str(&text).map(Some).map_err(|_| {
            "Die gespeicherte Stripe-Verbindung ist beschädigt. Bitte neu verbinden.".into()
        }),
    }
}

async fn store<T: Serialize>(account: String, value: &T) -> Result<(), String> {
    let text = serde_json::to_string(value)
        .map_err(|_| "Stripe-Daten konnten nicht gespeichert werden.")?;
    crate::db::secrets::set_backend_secret(account, text).await
}

async fn config(reference: &str) -> Result<Config, String> {
    stored::<Config>(config_account(reference)?)
        .await?
        .ok_or_else(|| "Stripe ist für dieses Projekt nicht verbunden.".into())
}

#[derive(Serialize)]
pub struct PaymentStatus {
    connected: bool,
    test_mode: bool,
    account_id: Option<String>,
    origin: Option<String>,
    webhook_id: Option<String>,
    setup_current: bool,
}

fn status_of(config: Option<&Config>, webhook: Option<&WebhookRecord>) -> PaymentStatus {
    let webhook = webhook.filter(|record| config.is_some_and(|config| record.matches(config)));
    PaymentStatus {
        connected: config.is_some(),
        test_mode: config.is_none_or(|config| config.test_mode),
        account_id: config.map(|config| config.account.clone()),
        origin: config.and_then(|config| config.origin.clone()),
        webhook_id: webhook.and_then(|record| record.id.clone()),
        setup_current: config.is_some_and(|config| {
            webhook.and_then(|record| record.configured_key.as_deref())
                == Some(fingerprint(&config.key).as_str())
        }),
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Resource {
    Products,
    Prices,
    Customers,
    Subscriptions,
    Invoices,
}

impl Resource {
    fn path(self) -> &'static str {
        match self {
            Self::Products => "products",
            Self::Prices => "prices",
            Self::Customers => "customers",
            Self::Subscriptions => "subscriptions",
            Self::Invoices => "invoices",
        }
    }
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    Project,
    Account,
}

#[derive(Serialize)]
pub struct PaymentPage {
    data: Vec<Value>,
    has_more: bool,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum PaymentAction {
    CreateProduct {
        name: String,
        description: Option<String>,
    },
    ArchiveProduct {
        id: String,
    },
    CreatePrice {
        product: String,
        currency: String,
        amount: u64,
        interval: Option<String>,
    },
    CreateCustomer {
        email: String,
        name: Option<String>,
    },
    CancelSubscription {
        id: String,
    },
    CreateCheckout {
        price: String,
        customer: Option<String>,
    },
    CreatePortal {
        customer: String,
    },
}

impl PaymentAction {
    fn name(&self) -> &'static str {
        match self {
            Self::CreateProduct { .. } => "create-product",
            Self::ArchiveProduct { .. } => "archive-product",
            Self::CreatePrice { .. } => "create-price",
            Self::CreateCustomer { .. } => "create-customer",
            Self::CancelSubscription { .. } => "cancel-subscription",
            Self::CreateCheckout { .. } => "checkout",
            Self::CreatePortal { .. } => "portal",
        }
    }
}

fn identifier(value: &str, prefix: &str) -> Result<String, String> {
    if value.starts_with(prefix)
        && value.len() > prefix.len()
        && value.len() <= 160
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_')
    {
        Ok(value.to_string())
    } else {
        Err("Ungültige Stripe-Ressource.".into())
    }
}

fn short_text(value: &str, limit: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > limit || value.chars().any(char::is_control) {
        Err(format!("Der Wert muss 1 bis {limit} Zeichen lang sein."))
    } else {
        Ok(value.to_string())
    }
}

fn request_key(reference: &str, action: &str, id: &str) -> Result<String, String> {
    if id.len() < 16 || id.len() > 80 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Eine gültige Anfrage-ID ist erforderlich.".into());
    }
    Ok(format!("l8db:{reference}:{action}:{id}"))
}

fn origin(value: &str) -> Result<String, String> {
    let url = crate::baas_file::origin_url(value, "App", "https://app.example.com")?;
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn cursor(value: &str, scope: Scope) -> Result<String, String> {
    let valid = match scope {
        Scope::Account => identifier(value, "").is_ok(),
        Scope::Project => {
            !value.is_empty() && value.len() <= 512 && value.bytes().all(|c| c.is_ascii_graphic())
        }
    };
    if valid {
        Ok(value.to_string())
    } else {
        Err("Ungültiger Seitenzeiger.".into())
    }
}

fn shape(value: &Value, depth: usize) -> Value {
    if depth > 5 {
        return Value::Null;
    }
    const FIELDS: &[&str] = &[
        "id",
        "object",
        "name",
        "email",
        "description",
        "active",
        "created",
        "currency",
        "unit_amount",
        "amount_due",
        "amount_paid",
        "total",
        "status",
        "customer",
        "product",
        "recurring",
        "interval",
        "interval_count",
        "quantity",
        "price",
        "items",
        "data",
        "type",
        "current_period_start",
        "current_period_end",
        "cancel_at_period_end",
        "cancel_at",
        "livemode",
        "url",
        "hosted_invoice_url",
        "number",
        "customer_email",
        "nickname",
        "deleted",
        "metadata",
        "l8db_project",
    ];
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(name, _)| FIELDS.contains(&name.as_str()))
                .map(|(name, value)| (name.clone(), shape(value, depth + 1)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .take(MAX_PAGE)
                .map(|v| shape(v, depth + 1))
                .collect(),
        ),
        Value::String(text) => Value::String(text.chars().take(2000).collect()),
        other => other.clone(),
    }
}

fn validate_key(value: &str, allow_live: bool) -> Result<bool, String> {
    let test = value.starts_with("sk_test_") || value.starts_with("rk_test_");
    let live = value.starts_with("sk_live_") || value.starts_with("rk_live_");
    if (!test && !live)
        || value.len() < 16
        || value.len() > 512
        || !value.bytes().all(|c| c.is_ascii_graphic())
    {
        return Err(
            "Ein gültiger Stripe Secret Key (sk_…) oder Restricted Key (rk_…) ist erforderlich."
                .into(),
        );
    }
    if live && !allow_live {
        return Err("Live-Schlüssel müssen ausdrücklich bestätigt werden.".into());
    }
    Ok(test)
}

async fn connect(
    client: &stripe::StripeClient,
    key: String,
    allow_live: bool,
    previous: Option<Config>,
) -> Result<Config, String> {
    let test_mode = validate_key(&key, allow_live)?;
    let account = client.get("account", &[]).await?;
    let account = identifier(account["id"].as_str().unwrap_or_default(), "acct_")
        .map_err(|_| "Stripe hat kein gültiges Konto zurückgegeben.".to_string())?;
    Ok(Config {
        key,
        account,
        test_mode,
        origin: previous.and_then(|config| config.origin),
    })
}

#[tauri::command]
pub async fn payments_connect(
    reference: String,
    secret_key: String,
    allow_live: bool,
) -> Result<PaymentStatus, String> {
    let target = config_account(&reference)?;
    let previous = stored::<Config>(target.clone()).await.ok().flatten();
    let client = stripe::StripeClient::new(secret_key.clone());
    let next = connect(&client, secret_key, allow_live, previous).await?;
    let webhook = stored::<WebhookRecord>(webhook_account(&reference)?)
        .await
        .ok()
        .flatten();
    if webhook
        .as_ref()
        .is_some_and(|record| !record.matches(&next))
    {
        crate::db::secrets::remove_backend_secret(webhook_account(&reference)?).await?;
    }
    store(target, &next).await?;
    Ok(status_of(Some(&next), webhook.as_ref()))
}

#[tauri::command]
pub async fn payments_status(reference: String) -> Result<PaymentStatus, String> {
    let config = match stored::<Config>(config_account(&reference)?).await {
        Err(error) if error.contains("beschädigt") => None,
        other => other?,
    };
    let webhook = stored::<WebhookRecord>(webhook_account(&reference)?)
        .await
        .ok()
        .flatten();
    Ok(status_of(config.as_ref(), webhook.as_ref()))
}

#[tauri::command]
pub async fn payments_disconnect(reference: String) -> Result<(), String> {
    crate::db::secrets::remove_backend_secret(webhook_account(&reference)?).await?;
    crate::db::secrets::remove_backend_secret(config_account(&reference)?).await
}

async fn list(
    client: &stripe::StripeClient,
    reference: &str,
    resource: Resource,
    scope: Scope,
    page: Option<String>,
) -> Result<PaymentPage, String> {
    let mut params = vec![("limit".to_string(), MAX_PAGE.to_string())];
    let path = match scope {
        Scope::Project => {
            params.push((
                "query".into(),
                format!("metadata['l8db_project']:'{reference}'"),
            ));
            if let Some(page) = page {
                params.push(("page".into(), cursor(&page, scope)?));
            }
            format!("{}/search", resource.path())
        }
        Scope::Account => {
            if let Some(page) = page {
                params.push(("starting_after".into(), cursor(&page, scope)?));
            }
            if matches!(resource, Resource::Subscriptions) {
                params.push(("status".into(), "all".into()));
            }
            resource.path().to_string()
        }
    };
    let value = client.get(&path, &params).await?;
    let rows = value["data"]
        .as_array()
        .ok_or("Stripe hat keine Liste zurückgegeben.")?;
    if rows.len() > MAX_PAGE {
        return Err("Stripe hat das Seitenlimit überschritten.".into());
    }
    let has_more = value["has_more"].as_bool().unwrap_or(false);
    let next_cursor = if !has_more {
        None
    } else if scope == Scope::Project {
        value["next_page"].as_str().map(str::to_string)
    } else {
        rows.last()
            .and_then(|row| row["id"].as_str())
            .map(str::to_string)
    };
    if has_more && next_cursor.is_none() {
        return Err("Stripe hat keinen Seitenzeiger zurückgegeben.".into());
    }
    Ok(PaymentPage {
        data: rows.iter().map(|row| shape(row, 0)).collect(),
        has_more,
        next_cursor,
    })
}

#[tauri::command]
pub async fn payments_list(
    reference: String,
    resource: Resource,
    scope: Scope,
    cursor: Option<String>,
) -> Result<PaymentPage, String> {
    validate_reference(&reference)?;
    let config = config(&reference).await?;
    list(
        &stripe::StripeClient::new(config.key),
        &reference,
        resource,
        scope,
        cursor,
    )
    .await
}

async fn belongs(
    client: &stripe::StripeClient,
    path: &str,
    params: &[(String, String)],
    reference: &str,
) -> Result<Value, String> {
    let value = client.get(path, params).await?;
    if value["metadata"]["l8db_project"].as_str() != Some(reference) {
        return Err("Diese Ressource gehört nicht zu diesem Supabase-Projekt (Metadatum l8db_project fehlt).".into());
    }
    Ok(value)
}

async fn mutate(
    client: &stripe::StripeClient,
    reference: &str,
    config: &Config,
    action: PaymentAction,
    request: &str,
) -> Result<Value, String> {
    let (path, mut fields) = match action {
        PaymentAction::CreateProduct { name, description } => {
            let mut fields = vec![("name".to_string(), short_text(&name, 250)?)];
            if let Some(description) = description.filter(|text| !text.trim().is_empty()) {
                fields.push(("description".into(), short_text(&description, 2000)?));
            }
            ("products".to_string(), fields)
        }
        PaymentAction::ArchiveProduct { id } => {
            let path = format!("products/{}", identifier(&id, "prod_")?);
            belongs(client, &path, &[], reference).await?;
            (path, vec![("active".into(), "false".into())])
        }
        PaymentAction::CreatePrice {
            product,
            currency,
            amount,
            interval,
        } => {
            let product = identifier(&product, "prod_")?;
            let detail = belongs(client, &format!("products/{product}"), &[], reference).await?;
            if detail["active"] == false {
                return Err("Das Produkt ist archiviert.".into());
            }
            if currency.len() != 3
                || !currency.bytes().all(|c| c.is_ascii_lowercase())
                || !(1..=99_999_999).contains(&amount)
            {
                return Err("Währung oder Betrag (kleinste Währungseinheit) ist ungültig.".into());
            }
            let mut fields = vec![
                ("product".to_string(), product),
                ("currency".into(), currency),
                ("unit_amount".into(), amount.to_string()),
            ];
            if let Some(interval) = interval {
                if !["day", "week", "month", "year"].contains(&interval.as_str()) {
                    return Err("Ungültiges Abrechnungsintervall.".into());
                }
                fields.push(("recurring[interval]".into(), interval));
            }
            ("prices".to_string(), fields)
        }
        PaymentAction::CreateCustomer { email, name } => {
            let email = short_text(&email, 254)?;
            let (local, domain) = email.split_once('@').unwrap_or_default();
            if local.is_empty() || !domain.contains('.') || email.chars().any(char::is_whitespace) {
                return Err("Eine gültige E-Mail-Adresse ist erforderlich.".into());
            }
            let mut fields = vec![("email".to_string(), email)];
            if let Some(name) = name.filter(|text| !text.trim().is_empty()) {
                fields.push(("name".into(), short_text(&name, 250)?));
            }
            ("customers".to_string(), fields)
        }
        PaymentAction::CancelSubscription { id } => {
            let path = format!("subscriptions/{}", identifier(&id, "sub_")?);
            let detail = belongs(client, &path, &[], reference).await?;
            if detail["status"] == "canceled" {
                return Err("Das Abo ist bereits beendet.".into());
            }
            (path, vec![("cancel_at_period_end".into(), "true".into())])
        }
        PaymentAction::CreateCheckout { price, customer } => {
            let target = config
                .origin
                .as_deref()
                .ok_or("Zuerst die Einrichtung mit App-Adresse ausführen.")?;
            let price = identifier(&price, "price_")?;
            let expand = [("expand[]".to_string(), "product".to_string())];
            let detail = belongs(client, &format!("prices/{price}"), &expand, reference).await?;
            if detail["active"] != true || detail["product"]["active"] != true {
                return Err("Preis oder Produkt ist archiviert.".into());
            }
            let mode = if detail["recurring"].is_object() {
                "subscription"
            } else {
                "payment"
            };
            let mut fields = vec![
                ("line_items[0][price]".to_string(), price),
                ("line_items[0][quantity]".into(), "1".into()),
                ("mode".into(), mode.into()),
                (
                    "success_url".into(),
                    format!("{target}/billing?checkout=success&session_id={{CHECKOUT_SESSION_ID}}"),
                ),
                (
                    "cancel_url".into(),
                    format!("{target}/billing?checkout=cancelled"),
                ),
            ];
            if mode == "subscription" {
                fields.push((
                    "subscription_data[metadata][l8db_project]".into(),
                    reference.into(),
                ));
            }
            if let Some(customer) = customer.filter(|value| !value.is_empty()) {
                let customer = identifier(&customer, "cus_")?;
                belongs(client, &format!("customers/{customer}"), &[], reference).await?;
                fields.push(("customer".into(), customer));
            }
            ("checkout/sessions".to_string(), fields)
        }
        PaymentAction::CreatePortal { customer } => {
            let target = config
                .origin
                .as_deref()
                .ok_or("Zuerst die Einrichtung mit App-Adresse ausführen.")?;
            let customer = identifier(&customer, "cus_")?;
            belongs(client, &format!("customers/{customer}"), &[], reference).await?;
            let fields = vec![
                ("customer".to_string(), customer),
                ("return_url".into(), format!("{target}/billing")),
            ];
            return client
                .post("billing_portal/sessions", &fields, request)
                .await
                .map(|value| shape(&value, 0));
        }
    };
    fields.push(("metadata[l8db_project]".into(), reference.to_string()));
    client
        .post(&path, &fields, request)
        .await
        .map(|value| shape(&value, 0))
}

#[tauri::command]
pub async fn payments_mutate(
    reference: String,
    action: PaymentAction,
    request_id: String,
) -> Result<Value, String> {
    let reference = validate_reference(&reference)?;
    let request = request_key(reference, action.name(), &request_id)?;
    let config = config(reference).await?;
    mutate(
        &stripe::StripeClient::new(config.key.clone()),
        reference,
        &config,
        action,
        &request,
    )
    .await
}

#[tauri::command]
pub fn payments_setup_preview(reference: String) -> Result<setup::Preview, String> {
    setup::preview(validate_reference(&reference)?)
}

#[tauri::command]
pub async fn payments_setup(
    reference: String,
    application_origin: String,
    confirmed: bool,
) -> Result<setup::Outcome, String> {
    if !confirmed {
        return Err("Die Einrichtung muss nach der Vorschau bestätigt werden.".into());
    }
    let reference = validate_reference(&reference)?;
    let mut config = config(reference).await?;
    config.origin = Some(origin(&application_origin)?);
    store(config_account(reference)?, &config).await?;
    let previous = stored::<WebhookRecord>(webhook_account(reference)?)
        .await
        .ok()
        .flatten();
    setup::install(reference, &config, previous).await
}

#[cfg(test)]
mod tests {
    use super::stripe::mock::{reply, serve};
    use super::*;
    use serde_json::json;

    const KEY: &str = "sk_test_1234567890123456";

    fn test_config() -> Config {
        Config {
            key: KEY.into(),
            account: "acct_1".into(),
            test_mode: true,
            origin: Some("https://app.example.com".into()),
        }
    }

    #[test]
    fn validates_keys_identifiers_and_requests() {
        assert!(validate_key(KEY, false).unwrap());
        assert!(validate_key("sk_live_1234567890123456", false).is_err());
        assert!(!validate_key("sk_live_1234567890123456", true).unwrap());
        assert!(validate_key("pk_test_1234567890123456", true).is_err());
        assert!(validate_key("sk_test_12345678 90123456", true).is_err());
        assert!(identifier("prod_a/../x", "prod_").is_err());
        assert!(request_key("project", "checkout", "short").is_err());
        assert_eq!(
            request_key("project", "checkout", "1234567890abcdef").unwrap(),
            "l8db:project:checkout:1234567890abcdef"
        );
        assert!(origin("https://app.example.com/path").is_err());
        assert!(origin("http://app.example.com").is_err());
        assert!(cursor("starting/../x", Scope::Account).is_err());
        assert!(cursor("WzE3MDAwMDAwMDBd", Scope::Project).is_ok());
        assert!(cursor("a b", Scope::Project).is_err());
    }

    #[test]
    fn status_requires_matching_account_mode_and_key() {
        let config = test_config();
        let mut record = WebhookRecord {
            account: "acct_1".into(),
            test_mode: true,
            nonce: "n".into(),
            id: Some("we_1".into()),
            secret: Some("whsec_x".into()),
            configured_key: Some(fingerprint(KEY)),
        };
        let status = status_of(Some(&config), Some(&record));
        assert!(status.setup_current);
        assert_eq!(status.webhook_id.as_deref(), Some("we_1"));
        let rotated = Config {
            key: "sk_test_abcdefabcdefabcdef".into(),
            ..config.clone()
        };
        assert!(!status_of(Some(&rotated), Some(&record)).setup_current);
        record.account = "acct_2".into();
        let other = status_of(Some(&config), Some(&record));
        assert!(!other.setup_current);
        assert!(other.webhook_id.is_none());
        let status = serde_json::to_string(&status_of(Some(&config), None)).unwrap();
        assert!(!status.contains("sk_test"));
        assert!(!status_of(None, None).connected);
    }

    #[tokio::test]
    async fn connect_reads_the_account_and_rejects_unconfirmed_live_keys() {
        let (base, seen) = serve(vec![reply(200, r#"{"id":"acct_123"}"#)]).await;
        let client = stripe::StripeClient::with_base(KEY, base);
        let config = connect(&client, KEY.into(), false, Some(test_config()))
            .await
            .unwrap();
        assert_eq!(config.account, "acct_123");
        assert_eq!(config.origin.as_deref(), Some("https://app.example.com"));
        assert!(seen.lock().unwrap()[0].starts_with("GET /account "));
        let live = connect(&client, "sk_live_1234567890123456".into(), false, None).await;
        assert!(live.err().unwrap().contains("bestätigt"));
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn project_scope_searches_metadata_and_pages_with_next_page() {
        let (base, seen) = serve(vec![
            reply(200, r#"{"data":[{"id":"prod_1","secret":"x","metadata":{"l8db_project":"proj"}}],"has_more":true,"next_page":"WzE3MF0"}"#),
            reply(200, r#"{"data":[{"id":"sub_1","status":"active"}],"has_more":true}"#),
        ])
        .await;
        let client = stripe::StripeClient::with_base(KEY, base);
        let page = list(&client, "proj", Resource::Products, Scope::Project, None)
            .await
            .unwrap();
        assert_eq!(page.next_cursor.as_deref(), Some("WzE3MF0"));
        assert!(!serde_json::to_string(&page.data)
            .unwrap()
            .contains("secret"));
        let page = list(
            &client,
            "proj",
            Resource::Subscriptions,
            Scope::Account,
            Some("sub_0".into()),
        )
        .await
        .unwrap();
        assert_eq!(page.next_cursor.as_deref(), Some("sub_1"));
        let seen = seen.lock().unwrap();
        assert!(seen[0].starts_with(
            "GET /products/search?limit=100&query=metadata%5B%27l8db_project%27%5D%3A%27proj%27 "
        ));
        assert!(
            seen[1].starts_with("GET /subscriptions?limit=100&starting_after=sub_0&status=all ")
        );
    }

    #[tokio::test]
    async fn mutations_check_project_ownership_before_writing() {
        let (base, seen) = serve(vec![reply(
            200,
            r#"{"id":"sub_1","status":"active","metadata":{"l8db_project":"other"}}"#,
        )])
        .await;
        let client = stripe::StripeClient::with_base(KEY, base);
        let error = mutate(
            &client,
            "proj",
            &test_config(),
            PaymentAction::CancelSubscription { id: "sub_1".into() },
            "l8db:proj:x:1234567890abcdef",
        )
        .await
        .unwrap_err();
        assert!(error.contains("gehört nicht"));
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn checkout_requires_active_tagged_price_and_product() {
        let price = json!({"id":"price_1","active":true,"recurring":{"interval":"month"},"metadata":{"l8db_project":"proj"},"product":{"id":"prod_1","active":true}});
        let (base, seen) = serve(vec![
            reply(200, &price.to_string()),
            reply(200, r#"{"id":"cs_1","url":"https://checkout.stripe.com/c/pay/cs_1","client_secret":"hidden"}"#),
            reply(200, r#"{"id":"price_2","active":true,"metadata":{"l8db_project":"proj"},"product":{"id":"prod_2","active":false}}"#),
        ])
        .await;
        let client = stripe::StripeClient::with_base(KEY, base);
        let action = || PaymentAction::CreateCheckout {
            price: "price_1".into(),
            customer: None,
        };
        let session = mutate(
            &client,
            "proj",
            &test_config(),
            action(),
            "l8db:proj:checkout:1234567890abcdef",
        )
        .await
        .unwrap();
        assert_eq!(session["url"], "https://checkout.stripe.com/c/pay/cs_1");
        assert!(session.get("client_secret").is_none());
        let archived = PaymentAction::CreateCheckout {
            price: "price_2".into(),
            customer: None,
        };
        assert!(mutate(
            &client,
            "proj",
            &test_config(),
            archived,
            "l8db:proj:checkout:abcdef1234567890"
        )
        .await
        .unwrap_err()
        .contains("archiviert"));
        let without_origin = Config {
            origin: None,
            ..test_config()
        };
        assert!(mutate(
            &client,
            "proj",
            &without_origin,
            action(),
            "l8db:proj:checkout:0000000000abcdef"
        )
        .await
        .unwrap_err()
        .contains("Einrichtung"));
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 3);
        assert!(seen[0].starts_with("GET /prices/price_1?expand%5B%5D=product "));
        let body = seen[1].rsplit("\r\n\r\n").next().unwrap();
        assert!(body.contains("mode=subscription"));
        assert!(body.contains("subscription_data%5Bmetadata%5D%5Bl8db_project%5D=proj"));
        assert!(body.contains("metadata%5Bl8db_project%5D=proj"));
        assert!(body.contains("success_url=https%3A%2F%2Fapp.example.com%2Fbilling"));
    }

    #[test]
    fn projects_only_safe_bounded_billing_fields() {
        let value = json!({"id":"cus_1","email":"a@b.test","secret_key":"sk_secret","client_secret":"secret","payment_method":{"card":{"number":"1234"}},"metadata":{"l8db_project":"project","private":"hidden"}});
        let projected = shape(&value, 0).to_string();
        assert!(!projected.contains("secret"));
        assert!(!projected.contains("1234"));
        assert!(!projected.contains("hidden"));
        assert!(projected.contains("project"));
        let source = json!({"data":vec![value;100_000]});
        let mut samples = Vec::new();
        for _ in 0..15 {
            let started = std::time::Instant::now();
            let page = shape(&source, 0);
            assert_eq!(page["data"].as_array().unwrap().len(), MAX_PAGE);
            assert!(page.to_string().len() < 64_000);
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        samples.sort_by(f64::total_cmp);
        eprintln!("payments projection: 100000 source rows, 100 retained/<64KB, median {:.3}ms p95 {:.3}ms", samples[7], samples[14]);
        assert!(samples[7] < 25.0 && samples[14] < 50.0);
    }
}
