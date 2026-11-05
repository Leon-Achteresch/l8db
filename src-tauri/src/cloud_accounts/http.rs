use futures_util::StreamExt;
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;

pub(crate) const DEFAULT_LIMIT: usize = 4 * 1024 * 1024;
const MESSAGE_CHARS: usize = 300;

pub(crate) fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .build()
            .expect("Cloud-HTTP-Client")
    })
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ApiError {
    pub status: Option<u16>,
    pub message: String,
}

impl From<ApiError> for String {
    fn from(error: ApiError) -> Self {
        error.message
    }
}

impl ApiError {
    pub(crate) fn local(message: impl Into<String>) -> Self {
        Self {
            status: None,
            message: message.into(),
        }
    }

    pub(crate) fn is(&self, status: u16) -> bool {
        self.status == Some(status)
    }
}

#[derive(Clone, Debug)]
pub(crate) enum Auth {
    None,
    Bearer(String),
    Header(String),
}

impl Auth {
    fn secret(&self) -> Option<&str> {
        match self {
            Auth::None => None,
            Auth::Bearer(value) | Auth::Header(value) => Some(value.as_str()),
        }
    }
}

pub(crate) enum Body {
    Empty,
    Json(Value),
    Text(String),
    Form(Vec<(String, String)>),
}

pub(crate) fn is_loopback(host: &url::Host<&str>) -> bool {
    match host {
        url::Host::Domain(domain) => {
            domain.eq_ignore_ascii_case("localhost")
                || domain
                    .trim_start_matches('[')
                    .trim_end_matches(']')
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        }
        url::Host::Ipv4(ip) => ip.is_loopback(),
        url::Host::Ipv6(ip) => ip.is_loopback(),
    }
}

pub(crate) fn base_url(official: &str, custom: Option<&str>) -> Result<url::Url, String> {
    let custom = custom.map(str::trim).filter(|value| !value.is_empty());
    let Some(raw) = custom else {
        return url::Url::parse(official).map_err(|_| "Interne API-Adresse ist ungültig.".into());
    };
    let mut url = url::Url::parse(raw).map_err(|_| "Ungültige Entwickler-Adresse.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Entwickler-Adressen müssen http:// oder https:// verwenden.".into());
    }
    if !url.host().as_ref().is_some_and(is_loopback) {
        return Err(
            "Eigene Adressen sind nur für lokale Entwickler-Endpunkte (127.0.0.1, ::1, localhost) erlaubt."
                .into(),
        );
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Die Entwickler-Adresse darf keine Zugangsdaten enthalten.".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("Die Entwickler-Adresse darf keine Query oder Fragment enthalten.".into());
    }
    if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
    Ok(url)
}

pub(crate) fn is_custom(official: &str, base: &url::Url) -> bool {
    base.as_str() != official
}

pub(crate) fn validate_segment(segment: &str) -> Result<(), String> {
    if segment.is_empty()
        || segment.len() > 1024
        || segment == "."
        || segment == ".."
        || segment.chars().any(char::is_control)
    {
        return Err("Ungültiger Bezeichner in der Anfrage.".into());
    }
    Ok(())
}

pub(crate) fn endpoint(
    base: &url::Url,
    segments: &[&str],
    query: &[(&str, String)],
) -> Result<url::Url, String> {
    let mut url = base.clone();
    {
        let mut path = url
            .path_segments_mut()
            .map_err(|_| "Interne API-Adresse ist ungültig.".to_string())?;
        path.pop_if_empty();
        for segment in segments {
            validate_segment(segment)?;
            path.push(segment);
        }
    }
    if !query.is_empty() {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in query {
            pairs.append_pair(key, value);
        }
    }
    Ok(url)
}

pub(crate) fn redact(text: &str, secret: Option<&str>) -> String {
    let mut text: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    if let Some(secret) = secret.filter(|secret| secret.len() >= 4) {
        text = text.replace(secret, "***");
        if let Some((_, tail)) = secret.split_once(':').filter(|(_, tail)| tail.len() >= 4) {
            text = text.replace(tail, "***");
        }
    }
    text.chars()
        .take(MESSAGE_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
}

pub(crate) fn server_message(body: &[u8], secret: Option<&str>) -> String {
    let text = String::from_utf8_lossy(body);
    let detail = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| {
            ["message", "error_description", "error", "detail"]
                .iter()
                .find_map(|key| match &value[*key] {
                    Value::String(message) if !message.trim().is_empty() => Some(message.clone()),
                    Value::Object(inner) => inner
                        .get("message")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    _ => None,
                })
        })
        .unwrap_or_else(|| {
            if text.trim_start().starts_with('<') {
                String::new()
            } else {
                text.into_owned()
            }
        });
    redact(&detail, secret)
}

pub(crate) fn status_error(
    label: &str,
    status: u16,
    body: &[u8],
    secret: Option<&str>,
) -> ApiError {
    let hint = match status {
        400 => "Die Anfrage wurde abgelehnt.",
        401 => "Zugangsdaten ungültig oder abgelaufen.",
        403 => "Für diese Aktion fehlen Berechtigungen.",
        404 => "Ressource nicht gefunden.",
        409 => "Konflikt mit dem aktuellen Zustand.",
        422 => "Eingaben wurden nicht akzeptiert.",
        429 => "Anfragelimit erreicht. Bitte später erneut versuchen.",
        500..=599 => "Der Dienst ist gerade gestört.",
        _ => "Anfrage fehlgeschlagen.",
    };
    let detail = server_message(body, secret);
    let message = if detail.is_empty() {
        format!("{label} HTTP {status}: {hint}")
    } else {
        format!("{label} HTTP {status}: {hint} Server: {detail}")
    };
    ApiError {
        status: Some(status),
        message,
    }
}

fn network_error(label: &str, error: &reqwest::Error) -> ApiError {
    let message = if error.is_timeout() {
        format!("{label}: Zeitüberschreitung, der Dienst hat nicht rechtzeitig geantwortet.")
    } else if error.is_connect() {
        format!("{label} ist nicht erreichbar. Netzwerk, DNS und TLS prüfen.")
    } else {
        format!("{label} hat die Verbindung abgebrochen.")
    };
    ApiError::local(message)
}

pub(crate) async fn read_limited(
    label: &str,
    response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, ApiError> {
    let too_large = || {
        ApiError::local(format!(
            "{label}: Antwort ist größer als {} KB und wurde abgebrochen.",
            limit / 1024
        ))
    };
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(too_large());
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| network_error(label, &error))?;
        if body.len() + chunk.len() > limit {
            return Err(too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub(crate) struct Reply {
    pub status: u16,
    pub body: Vec<u8>,
}

pub(crate) async fn send(
    label: &str,
    auth: &Auth,
    method: Method,
    url: url::Url,
    body: Body,
    limit: usize,
) -> Result<Reply, ApiError> {
    let mut request = client()
        .request(method, url)
        .header(reqwest::header::ACCEPT, "application/json");
    request = match auth {
        Auth::None => request,
        Auth::Bearer(token) => request.bearer_auth(token),
        Auth::Header(value) => request.header(reqwest::header::AUTHORIZATION, value),
    };
    request = match body {
        Body::Empty => request,
        Body::Json(value) => request.json(&value),
        Body::Text(text) => request
            .header(reqwest::header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(text),
        Body::Form(pairs) => {
            let encoded = url::form_urlencoded::Serializer::new(String::new())
                .extend_pairs(
                    pairs
                        .iter()
                        .map(|(key, value)| (key.as_str(), value.as_str())),
                )
                .finish();
            request
                .header(
                    reqwest::header::CONTENT_TYPE,
                    "application/x-www-form-urlencoded",
                )
                .body(encoded)
        }
    };
    let response = request
        .send()
        .await
        .map_err(|error| network_error(label, &error))?;
    let status = response.status().as_u16();
    if (300..400).contains(&status) {
        return Err(ApiError {
            status: Some(status),
            message: format!(
                "{label} HTTP {status}: Unerwartete Weiterleitung, Anfrage wurde nicht gefolgt."
            ),
        });
    }
    let body = read_limited(label, response, limit).await?;
    if !(200..300).contains(&status) {
        return Err(status_error(label, status, &body, auth.secret()));
    }
    Ok(Reply { status, body })
}

pub(crate) fn decode<T: DeserializeOwned>(label: &str, body: &[u8]) -> Result<T, ApiError> {
    serde_json::from_slice(body)
        .map_err(|_| ApiError::local(format!("{label} hat unerwartete Daten geliefert.")))
}

pub(crate) async fn json<T: DeserializeOwned>(
    label: &str,
    auth: &Auth,
    method: Method,
    url: url::Url,
    body: Body,
) -> Result<T, ApiError> {
    let reply = send(label, auth, method, url, body, DEFAULT_LIMIT).await?;
    decode(label, &reply.body)
}

pub(crate) fn random_hex(bytes: usize) -> String {
    let mut out = String::with_capacity(bytes * 2);
    while out.len() < bytes * 2 {
        for byte in rand::random::<u128>().to_be_bytes() {
            if out.len() < bytes * 2 {
                out.push_str(&format!("{byte:02x}"));
            }
        }
    }
    out
}

pub(crate) fn random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    for chunk in out.chunks_mut(16) {
        let random = rand::random::<u128>().to_be_bytes();
        chunk.copy_from_slice(&random[..chunk.len()]);
    }
    out
}

pub(crate) fn uuid_v4() -> String {
    let mut bytes = rand::random::<u128>().to_be_bytes();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}
