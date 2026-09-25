use std::sync::OnceLock;

pub(crate) fn client(insecure: bool) -> &'static reqwest::Client {
    static SECURE: OnceLock<reqwest::Client> = OnceLock::new();
    static INSECURE: OnceLock<reqwest::Client> = OnceLock::new();
    let cell = if insecure { &INSECURE } else { &SECURE };
    cell.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(super::execution::connection_duration())
            .tls_danger_accept_invalid_certs(insecure)
            .build()
            .expect("HTTP-Client")
    })
}

pub(crate) struct Reply {
    pub status: u16,
    pub body: String,
    pub headers: reqwest::header::HeaderMap,
}

impl Reply {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn json(&self) -> Option<serde_json::Value> {
        serde_json::from_str(&self.body).ok()
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }
}

fn describe(error: &reqwest::Error) -> String {
    let mut text = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(inner) = source {
        let detail = inner.to_string();
        if !text.contains(&detail) {
            text.push_str(": ");
            text.push_str(&detail);
        }
        source = inner.source();
    }
    text
}

pub(crate) async fn send(label: &str, request: reqwest::RequestBuilder) -> Result<Reply, String> {
    super::timed(async {
        let response = request
            .send()
            .await
            .map_err(|e| format!("{label} nicht erreichbar: {}", describe(&e)))?;
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        let body = response
            .text()
            .await
            .map_err(|e| format!("Antwort konnte nicht gelesen werden: {e}"))?;
        Ok(Reply {
            status,
            body,
            headers,
        })
    })
    .await
}

pub(crate) fn decode(value: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", value.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| value.to_string())
}

pub(crate) fn param(url: &url::Url, names: &[&str]) -> Option<String> {
    url.query_pairs()
        .find(|(k, _)| names.iter().any(|n| k.eq_ignore_ascii_case(n)))
        .map(|(_, v)| v.into_owned())
}

fn flag(value: &str) -> Option<bool> {
    match value.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

pub(crate) struct Tls {
    pub secure: bool,
    pub insecure: bool,
}

pub(crate) fn tls(url: &url::Url, default_secure: bool) -> Tls {
    let mut secure = match url.scheme() {
        "https" => true,
        "http" => false,
        _ => default_secure || matches!(url.port(), Some(443) | Some(9243)),
    };
    let mut insecure = false;
    if let Some(mode) = param(url, &["sslmode", "ssl-mode"]) {
        match mode.to_ascii_lowercase().as_str() {
            "disable" | "disabled" => secure = false,
            "require" | "required" => {
                secure = true;
                insecure = true;
            }
            "verify-ca" | "verify-full" | "verify_ca" | "verify_identity" => secure = true,
            _ => {}
        }
    }
    if let Some(on) = param(url, &["tls", "ssl", "secure"]).and_then(|v| flag(&v)) {
        secure = on;
    }
    if let Some(on) =
        param(url, &["insecure", "tls_insecure", "skip_verify"]).and_then(|v| flag(&v))
    {
        insecure = on;
    }
    Tls { secure, insecure }
}

pub(crate) fn base_url(
    url: &url::Url,
    secure: bool,
    default_port: Option<u16>,
) -> Result<String, String> {
    let host = url.host_str().ok_or("Host fehlt in der URL")?;
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let port = url
        .port()
        .or(default_port)
        .map(|p| format!(":{p}"))
        .unwrap_or_default();
    Ok(format!(
        "{}://{host}{port}",
        if secure { "https" } else { "http" }
    ))
}

pub(crate) fn text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

pub(crate) fn error_message(body: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return body.trim().chars().take(2000).collect();
    };
    let candidates = [
        value.pointer("/error/root_cause/0/reason"),
        value.pointer("/error/reason"),
        value.pointer("/error/details"),
        value.pointer("/errors/0/message"),
        value.pointer("/error/message"),
        value.get("message"),
        value.get("error"),
    ];
    let found = candidates
        .into_iter()
        .flatten()
        .find(|v| !v.is_null() && !v.is_object())
        .map(text);
    found.unwrap_or_else(|| body.trim().chars().take(2000).collect())
}

#[cfg(test)]
pub(crate) mod mock {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[derive(Debug, Clone)]
    pub struct Request {
        pub method: String,
        pub path: String,
        pub headers: Vec<(String, String)>,
        pub body: String,
    }

    impl Request {
        pub fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.as_str())
        }

        pub fn json(&self) -> serde_json::Value {
            serde_json::from_str(&self.body).unwrap_or(serde_json::Value::Null)
        }
    }

    pub type Log = std::sync::Arc<std::sync::Mutex<Vec<Request>>>;

    pub async fn serve<F>(handler: F) -> (String, Log)
    where
        F: Fn(&Request) -> (u16, String) + Send + Sync + 'static,
    {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let log: Log = Default::default();
        let handler = std::sync::Arc::new(handler);
        let shared = log.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let handler = handler.clone();
                let log = shared.clone();
                tokio::spawn(async move {
                    let mut buffer = Vec::new();
                    let mut chunk = [0u8; 8192];
                    let (head_end, length) = loop {
                        let n = socket.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        buffer.extend_from_slice(&chunk[..n]);
                        if let Some(pos) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
                            let head = String::from_utf8_lossy(&buffer[..pos]).to_string();
                            let length = head
                                .lines()
                                .find_map(|l| {
                                    let (k, v) = l.split_once(':')?;
                                    k.trim()
                                        .eq_ignore_ascii_case("content-length")
                                        .then(|| v.trim().parse::<usize>().ok())?
                                })
                                .unwrap_or(0);
                            break (pos + 4, length);
                        }
                    };
                    while buffer.len() < head_end + length {
                        let n = socket.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        buffer.extend_from_slice(&chunk[..n]);
                    }
                    let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
                    let mut lines = head.lines();
                    let first = lines.next().unwrap_or_default();
                    let mut parts = first.split_whitespace();
                    let request = Request {
                        method: parts.next().unwrap_or_default().to_string(),
                        path: parts.next().unwrap_or_default().to_string(),
                        headers: lines
                            .filter_map(|l| {
                                let (k, v) = l.split_once(':')?;
                                Some((k.trim().to_string(), v.trim().to_string()))
                            })
                            .collect(),
                        body: String::from_utf8_lossy(&buffer[head_end..]).to_string(),
                    };
                    let (status, body) = handler(&request);
                    log.lock().unwrap().push(request);
                    let response = format!(
                        "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    let _ = socket.shutdown().await;
                });
            }
        });
        (format!("127.0.0.1:{}", addr.port()), log)
    }
}
