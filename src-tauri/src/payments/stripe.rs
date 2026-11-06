use reqwest::Method;
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;

pub(super) const API_VERSION: &str = "2025-03-31.basil";
const MAX_BYTES: usize = 4 * 1024 * 1024;
const ATTEMPTS: u32 = 3;

pub(super) struct StripeClient {
    client: reqwest::Client,
    key: String,
    base: String,
}

impl StripeClient {
    pub fn new(key: String) -> Self {
        static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
        Self {
            client: CLIENT
                .get_or_init(|| {
                    reqwest::Client::builder()
                        .redirect(reqwest::redirect::Policy::none())
                        .connect_timeout(Duration::from_secs(10))
                        .timeout(Duration::from_secs(30))
                        .build()
                        .expect("Stripe HTTP client")
                })
                .clone(),
            key,
            base: "https://api.stripe.com/v1".into(),
        }
    }

    #[cfg(test)]
    pub fn with_base(key: &str, base: String) -> Self {
        let mut client = Self::new(key.into());
        client.base = base;
        client
    }

    pub async fn get(&self, path: &str, fields: &[(String, String)]) -> Result<Value, String> {
        self.request(Method::GET, path, fields, None).await
    }

    pub async fn post(
        &self,
        path: &str,
        fields: &[(String, String)],
        request: &str,
    ) -> Result<Value, String> {
        self.request(Method::POST, path, fields, Some(request))
            .await
    }

    pub async fn delete(&self, path: &str) -> Result<Value, String> {
        self.request(Method::DELETE, path, &[], None).await
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        fields: &[(String, String)],
        id: Option<&str>,
    ) -> Result<Value, String> {
        let mut attempt = 0;
        loop {
            attempt += 1;
            match self.attempt(method.clone(), path, fields, id).await {
                Err(Failure::Retry(_)) if attempt < ATTEMPTS => {
                    tokio::time::sleep(Duration::from_millis(400 * 3u64.pow(attempt - 1))).await;
                }
                Err(Failure::Retry(message) | Failure::Final(message)) => return Err(message),
                Ok(value) => return Ok(value),
            }
        }
    }

    async fn attempt(
        &self,
        method: Method,
        path: &str,
        fields: &[(String, String)],
        id: Option<&str>,
    ) -> Result<Value, Failure> {
        static LIMIT: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
        let _permit = tokio::time::timeout(
            Duration::from_secs(30),
            LIMIT
                .get_or_init(|| tokio::sync::Semaphore::new(4))
                .acquire(),
        )
        .await
        .map_err(|_| Failure::Final("Stripe: Zu viele gleichzeitige Anfragen.".into()))?
        .map_err(|_| Failure::Final("Stripe-Verbindung wurde geschlossen.".into()))?;
        let mut request = self
            .client
            .request(method.clone(), format!("{}/{path}", self.base))
            .bearer_auth(&self.key)
            .header("Stripe-Version", API_VERSION);
        if method == Method::POST {
            request = request.form(fields);
        } else if !fields.is_empty() {
            request = request.query(fields);
        }
        if let Some(id) = id {
            request = request.header("Idempotency-Key", id);
        }
        let mut response = request.send().await.map_err(|error| {
            Failure::Retry(if error.is_timeout() {
                "Stripe hat nicht rechtzeitig geantwortet. Erneut versuchen ist sicher.".into()
            } else {
                "Stripe ist nicht erreichbar.".into()
            })
        })?;
        let status = response.status();
        let should_retry = response
            .headers()
            .get("stripe-should-retry")
            .and_then(|value| value.to_str().ok())
            .map(|value| value == "true");
        if response
            .content_length()
            .is_some_and(|length| length > MAX_BYTES as u64)
        {
            return Err(Failure::Final("Stripe-Antwort überschreitet 4 MB.".into()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| Failure::Retry("Stripe-Antwort wurde unterbrochen.".into()))?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_BYTES {
                return Err(Failure::Final("Stripe-Antwort überschreitet 4 MB.".into()));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        if status.is_success() {
            return if value.is_object() {
                Ok(value)
            } else {
                Err(Failure::Final(
                    "Stripe hat ungültige Daten geliefert.".into(),
                ))
            };
        }
        let message = value["error"]["message"]
            .as_str()
            .unwrap_or("Anfrage fehlgeschlagen.")
            .replace(&self.key, "[Zugang entfernt]");
        let hint = match status.as_u16() {
            401 => " Der Stripe-Schlüssel ist ungültig oder widerrufen.",
            403 => " Dem Schlüssel fehlen Berechtigungen.",
            429 => " Stripe-Limit erreicht, bitte kurz warten.",
            _ => "",
        };
        let text = format!(
            "Stripe HTTP {}: {}{hint}",
            status.as_u16(),
            message.chars().take(400).collect::<String>()
        );
        let retry = should_retry.unwrap_or(status.as_u16() == 429 || status.is_server_error());
        Err(if retry {
            Failure::Retry(text)
        } else {
            Failure::Final(text)
        })
    }
}

enum Failure {
    Retry(String),
    Final(String),
}

#[cfg(test)]
pub(super) mod mock {
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    pub struct Reply {
        pub status: u16,
        pub headers: Vec<(&'static str, &'static str)>,
        pub body: String,
    }

    pub fn reply(status: u16, body: &str) -> Reply {
        Reply {
            status,
            headers: Vec::new(),
            body: body.into(),
        }
    }

    pub async fn serve(replies: Vec<Reply>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            for reply in replies {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut data = Vec::new();
                let mut buffer = [0u8; 8192];
                loop {
                    let size = stream.read(&mut buffer).await.unwrap_or(0);
                    data.extend_from_slice(&buffer[..size]);
                    let text = String::from_utf8_lossy(&data).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let length = text[..end]
                            .lines()
                            .find_map(|line| {
                                line.to_lowercase()
                                    .strip_prefix("content-length: ")
                                    .map(str::to_string)
                            })
                            .and_then(|value| value.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        if data.len() >= end + 4 + length || size == 0 {
                            break;
                        }
                    }
                    if size == 0 {
                        break;
                    }
                }
                log.lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&data).to_string());
                let mut head = format!(
                    "HTTP/1.1 {} X\r\nContent-Length: {}\r\nConnection: close\r\n",
                    reply.status,
                    reply.body.len()
                );
                for (name, value) in &reply.headers {
                    head.push_str(&format!("{name}: {value}\r\n"));
                }
                let _ = stream
                    .write_all(format!("{head}\r\n{}", reply.body).as_bytes())
                    .await;
                let _ = stream.shutdown().await;
            }
        });
        (format!("http://{address}"), seen)
    }
}

#[cfg(test)]
mod tests {
    use super::mock::{reply, serve, Reply};
    use super::*;

    const KEY: &str = "sk_test_1234567890123456";

    #[tokio::test]
    async fn retries_server_errors_with_the_same_idempotency_key() {
        let (base, seen) = serve(vec![
            reply(500, r#"{"error":{"message":"boom"}}"#),
            reply(200, r#"{"id":"prod_1"}"#),
        ])
        .await;
        let client = StripeClient::with_base(KEY, base);
        let value = client
            .post(
                "products",
                &[("name".into(), "Abo".into())],
                "l8db:p:1234567890123456",
            )
            .await
            .unwrap();
        assert_eq!(value["id"], "prod_1");
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        for request in seen.iter() {
            let lower = request.to_lowercase();
            assert!(lower.starts_with("post /products "));
            assert!(lower.contains("idempotency-key: l8db:p:1234567890123456"));
            assert!(lower.contains(&format!("authorization: bearer {KEY}")));
            assert!(lower.contains(&format!("stripe-version: {}", API_VERSION.to_lowercase())));
            assert!(request.ends_with("name=Abo"));
        }
    }

    #[tokio::test]
    async fn honours_should_retry_false_and_redacts_the_key() {
        let (base, seen) = serve(vec![Reply {
            status: 429,
            headers: vec![("Stripe-Should-Retry", "false")],
            body: format!(r#"{{"error":{{"message":"rejected {KEY}"}}}}"#),
        }])
        .await;
        let client = StripeClient::with_base(KEY, base);
        let error = client.get("customers", &[]).await.unwrap_err();
        assert!(error.contains("429"));
        assert!(!error.contains("sk_test_"));
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn rejects_oversized_bodies_without_retrying() {
        let big = format!(r#"{{"data":"{}"}}"#, "x".repeat(MAX_BYTES));
        let (base, seen) = serve(vec![reply(200, &big)]).await;
        let client = StripeClient::with_base(KEY, base);
        assert!(client
            .get("products", &[])
            .await
            .unwrap_err()
            .contains("4 MB"));
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn client_errors_are_final_and_readable() {
        let (base, seen) =
            serve(vec![reply(400, r#"{"error":{"message":"No such price"}}"#)]).await;
        let client = StripeClient::with_base(KEY, base);
        let error = client.get("prices/price_x", &[]).await.unwrap_err();
        assert_eq!(error, "Stripe HTTP 400: No such price");
        assert_eq!(seen.lock().unwrap().len(), 1);
    }
}
