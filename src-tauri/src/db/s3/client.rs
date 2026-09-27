use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use bytes::Bytes;
use hmac::{Hmac, KeyInit, Mac};
use md5::Md5;
use reqwest::Method;
use sha2::{Digest, Sha256};

use super::super::aws::{self, Credentials};
use super::xml::{self, Node};

pub const UNSIGNED_PAYLOAD: &str = "UNSIGNED-PAYLOAD";

pub struct S3 {
    region: String,
    credentials: Credentials,
    endpoint: url::Url,
    path_style: bool,
    amazon: bool,
    pub default_bucket: Option<String>,
}

#[derive(Debug, Clone)]
pub struct S3Error {
    pub status: u16,
    pub code: String,
    pub message: String,
}

impl S3Error {
    pub fn is_missing(&self) -> bool {
        self.status == 404
            || self.code.starts_with("NoSuch")
            || self.code.ends_with("NotFoundError")
            || self.code.ends_with("NotFound")
    }
}

impl std::fmt::Display for S3Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.message.is_empty() {
            write!(f, "S3 {}", self.code)
        } else {
            write!(f, "S3 {}: {}", self.code, self.message)
        }
    }
}

impl From<S3Error> for String {
    fn from(e: S3Error) -> Self {
        e.to_string()
    }
}

fn transport(e: impl std::fmt::Display) -> S3Error {
    S3Error {
        status: 0,
        code: "Verbindungsfehler".to_string(),
        message: e.to_string(),
    }
}

pub struct Request<'a> {
    method: Method,
    bucket: Option<&'a str>,
    key: Option<&'a str>,
    query: Vec<(String, String)>,
    headers: Vec<(String, String)>,
    body: Bytes,
    timeout: Option<Duration>,
}

impl<'a> Request<'a> {
    pub fn new(method: Method, bucket: Option<&'a str>, key: Option<&'a str>) -> Self {
        Self {
            method,
            bucket,
            key,
            query: Vec::new(),
            headers: Vec::new(),
            body: Bytes::new(),
            timeout: Some(super::super::execution::query_duration()),
        }
    }

    pub fn query(mut self, name: &str, value: impl Into<String>) -> Self {
        self.query.push((name.to_string(), value.into()));
        self
    }

    pub fn query_opt(self, name: &str, value: Option<&str>) -> Self {
        match value.filter(|v| !v.is_empty()) {
            Some(v) => self.query(name, v),
            None => self,
        }
    }

    pub fn header(mut self, name: &str, value: impl Into<String>) -> Self {
        self.headers.push((name.to_ascii_lowercase(), value.into()));
        self
    }

    pub fn body(mut self, body: impl Into<Bytes>) -> Self {
        self.body = body.into();
        self
    }

    pub fn with_md5(self) -> Self {
        let digest = md5_base64(&self.body);
        self.header("content-md5", digest)
    }

    pub fn xml(self, body: String, content_type: &str) -> Self {
        self.header("content-type", content_type)
            .body(body)
            .with_md5()
    }

    pub fn no_timeout(mut self) -> Self {
        self.timeout = None;
        self
    }
}

pub fn md5_base64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(Md5::digest(bytes))
}

pub fn uri_encode(value: &str, keep_slash: bool) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b'/' if keep_slash => out.push('/'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn canonical_query(query: &[(String, String)]) -> String {
    let mut pairs: Vec<(String, String)> = query
        .iter()
        .map(|(k, v)| (uri_encode(k, false), uri_encode(v, false)))
        .collect();
    pairs.sort();
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&")
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC-Schlüssel");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn region_cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(super::super::execution::connection_duration())
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("HTTP-Client")
    })
}

struct Target {
    url: String,
    host: String,
    path: String,
}

pub fn parse_bool(value: Option<&str>) -> Option<bool> {
    match value?.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

impl S3 {
    pub async fn connect(connection_string: &str) -> Result<S3, String> {
        let conn = aws::parse_url(connection_string, "s3")?;
        let region = match (&conn.region, &conn.endpoint) {
            (Some(region), _) => region.clone(),
            (None, Some(_)) => conn.region().unwrap_or_else(|_| "us-east-1".to_string()),
            (None, None) => conn.region()?,
        };
        let credentials = conn.credentials().await?;
        let amazon = conn.endpoint.is_none();
        let endpoint = match &conn.endpoint {
            Some(e) => e.clone(),
            None => {
                let suffix = if region.starts_with("cn-") {
                    "amazonaws.com.cn"
                } else {
                    "amazonaws.com"
                };
                url::Url::parse(&format!("https://s3.{region}.{suffix}/"))
                    .map_err(|_| format!("Ungültige Region: {region}"))?
            }
        };
        let path_style = parse_bool(conn.param("path_style").or(conn.param("force_path_style")))
            .unwrap_or(!amazon);
        let default_bucket = conn
            .path
            .split('/')
            .next()
            .filter(|b| !b.is_empty())
            .map(str::to_string);
        Ok(S3 {
            region,
            credentials,
            endpoint,
            path_style,
            amazon,
            default_bucket,
        })
    }

    pub fn region(&self) -> &str {
        &self.region
    }

    fn cache_key(&self, bucket: &str) -> String {
        format!("{}|{bucket}", self.endpoint)
    }

    fn region_for(&self, bucket: Option<&str>) -> String {
        bucket
            .and_then(|b| {
                region_cache()
                    .lock()
                    .ok()
                    .and_then(|c| c.get(&self.cache_key(b)).cloned())
            })
            .unwrap_or_else(|| self.region.clone())
    }

    fn target(&self, region: &str, bucket: Option<&str>, key: Option<&str>) -> Target {
        let scheme = self.endpoint.scheme();
        let mut host = aws::host_header(&self.endpoint);
        if self.amazon && region != self.region {
            host = host.replacen(&format!("s3.{}.", self.region), &format!("s3.{region}."), 1);
        }
        let base = self.endpoint.path().trim_end_matches('/').to_string();
        let encoded_key = key.map(|k| uri_encode(k, true)).unwrap_or_default();
        let path = match bucket {
            Some(bucket) if self.path_style || bucket.contains('.') => {
                format!("{base}/{}/{encoded_key}", uri_encode(bucket, false))
            }
            Some(bucket) => {
                host = format!("{bucket}.{host}");
                format!("{base}/{encoded_key}")
            }
            None => format!("{base}/"),
        };
        Target {
            url: format!("{scheme}://{host}{path}"),
            host,
            path,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn authorization(
        &self,
        method: &str,
        path: &str,
        query: &str,
        headers: &[(String, String)],
        payload_hash: &str,
        region: &str,
        amz_date: &str,
    ) -> String {
        let mut sorted: Vec<(String, String)> = headers
            .iter()
            .map(|(k, v)| {
                (
                    k.to_ascii_lowercase(),
                    v.split_whitespace().collect::<Vec<_>>().join(" "),
                )
            })
            .collect();
        sorted.sort();
        let canonical_headers: String = sorted.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
        let signed = sorted
            .iter()
            .map(|(k, _)| k.as_str())
            .collect::<Vec<_>>()
            .join(";");
        let canonical =
            format!("{method}\n{path}\n{query}\n{canonical_headers}\n{signed}\n{payload_hash}");
        let date = &amz_date[..8];
        let scope = format!("{date}/{region}/s3/aws4_request");
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
            aws::hex(&Sha256::digest(canonical.as_bytes()))
        );
        let key = aws::signing_key(&self.credentials.secret_key, date, region, "s3");
        let signature = aws::hex(&hmac(&key, string_to_sign.as_bytes()));
        format!(
            "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed}, Signature={signature}",
            self.credentials.access_key
        )
    }

    pub fn presign(
        &self,
        method: &str,
        bucket: &str,
        key: &str,
        expires: u64,
        extra: &[(String, String)],
    ) -> String {
        let region = self.region_for(Some(bucket));
        let target = self.target(&region, Some(bucket), Some(key));
        let amz_date = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let scope = format!("{}/{region}/s3/aws4_request", &amz_date[..8]);
        let mut query: Vec<(String, String)> = vec![
            ("X-Amz-Algorithm".into(), "AWS4-HMAC-SHA256".into()),
            (
                "X-Amz-Credential".into(),
                format!("{}/{scope}", self.credentials.access_key),
            ),
            ("X-Amz-Date".into(), amz_date.clone()),
            (
                "X-Amz-Expires".into(),
                expires.clamp(1, 604_800).to_string(),
            ),
            ("X-Amz-SignedHeaders".into(), "host".into()),
        ];
        if let Some(token) = &self.credentials.session_token {
            query.push(("X-Amz-Security-Token".into(), token.clone()));
        }
        query.extend(extra.iter().cloned());
        let canonical = canonical_query(&query);
        let canonical_request = format!(
            "{method}\n{}\n{canonical}\nhost:{}\n\nhost\n{UNSIGNED_PAYLOAD}",
            target.path, target.host
        );
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
            aws::hex(&Sha256::digest(canonical_request.as_bytes()))
        );
        let signing = aws::signing_key(&self.credentials.secret_key, &amz_date[..8], &region, "s3");
        let signature = aws::hex(&hmac(&signing, string_to_sign.as_bytes()));
        format!("{}?{canonical}&X-Amz-Signature={signature}", target.url)
    }

    async fn attempt(&self, req: &Request<'_>, region: &str) -> Result<reqwest::Response, S3Error> {
        let target = self.target(region, req.bucket, req.key);
        let query = canonical_query(&req.query);
        let amz_date = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let payload_hash = aws::hex(&Sha256::digest(&req.body));
        let mut headers = req.headers.clone();
        headers.push(("host".into(), target.host.clone()));
        headers.push(("x-amz-date".into(), amz_date.clone()));
        headers.push(("x-amz-content-sha256".into(), payload_hash.clone()));
        if let Some(token) = &self.credentials.session_token {
            headers.push(("x-amz-security-token".into(), token.clone()));
        }
        let authorization = self.authorization(
            req.method.as_str(),
            &target.path,
            &query,
            &headers,
            &payload_hash,
            region,
            &amz_date,
        );
        let url = if query.is_empty() {
            target.url
        } else {
            format!("{}?{query}", target.url)
        };
        let mut request = http()
            .request(req.method.clone(), url)
            .header("authorization", authorization);
        if let Some(timeout) = req.timeout {
            request = request.timeout(timeout);
        }
        for (name, value) in &headers {
            if name != "host" {
                request = request.header(name.as_str(), value.as_str());
            }
        }
        request
            .body(req.body.clone())
            .send()
            .await
            .map_err(|e| transport(format!("{} nicht erreichbar: {e}", self.endpoint)))
    }

    pub async fn send(&self, req: Request<'_>) -> Result<reqwest::Response, S3Error> {
        let region = self.region_for(req.bucket);
        let response = self.attempt(&req, &region).await?;
        if response.status().is_success() {
            return Ok(response);
        }
        let redirect = response
            .headers()
            .get("x-amz-bucket-region")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .filter(|r| *r != region && !r.is_empty());
        if let (Some(bucket), Some(new_region)) = (req.bucket, redirect) {
            if let Ok(mut cache) = region_cache().lock() {
                cache.insert(self.cache_key(bucket), new_region.clone());
            }
            let retry = self.attempt(&req, &new_region).await?;
            if retry.status().is_success() {
                return Ok(retry);
            }
            return Err(read_error(retry).await);
        }
        Err(read_error(response).await)
    }

    pub async fn text(&self, req: Request<'_>) -> Result<String, S3Error> {
        self.send(req).await?.text().await.map_err(transport)
    }

    pub async fn xml(&self, req: Request<'_>) -> Result<Node, S3Error> {
        let text = self.text(req).await?;
        xml::parse(&text).map_err(transport)
    }
}

async fn read_error(response: reqwest::Response) -> S3Error {
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    let parsed = xml::parse(&body).ok();
    let code = parsed
        .as_ref()
        .and_then(|n| n.text_of("Code"))
        .unwrap_or_else(|| match status {
            403 => "AccessDenied".to_string(),
            404 => "NotFound".to_string(),
            _ => format!("HTTP {status}"),
        });
    let message = parsed
        .as_ref()
        .and_then(|n| n.text_of("Message"))
        .unwrap_or_else(|| {
            if parsed.is_none() {
                body.trim().chars().take(300).collect()
            } else {
                String::new()
            }
        });
    S3Error {
        status,
        code,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(path_style: bool, endpoint: &str) -> S3 {
        S3 {
            region: "us-east-1".into(),
            credentials: Credentials {
                access_key: "AKIAIOSFODNN7EXAMPLE".into(),
                secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".into(),
                session_token: None,
            },
            endpoint: url::Url::parse(endpoint).unwrap(),
            path_style,
            amazon: endpoint.contains("amazonaws"),
            default_bucket: None,
        }
    }

    #[test]
    fn encodes_keys_like_s3() {
        assert_eq!(uri_encode("a b/ü+c.txt", true), "a%20b/%C3%BC%2Bc.txt");
        assert_eq!(uri_encode("a/b", false), "a%2Fb");
        assert_eq!(
            canonical_query(&[
                ("prefix".into(), "a b".into()),
                ("list-type".into(), "2".into())
            ]),
            "list-type=2&prefix=a%20b"
        );
    }

    #[test]
    fn signs_aws_documentation_example() {
        let s3 = client(false, "https://s3.amazonaws.com/");
        let headers = vec![
            (
                "host".to_string(),
                "examplebucket.s3.amazonaws.com".to_string(),
            ),
            ("range".to_string(), "bytes=0-9".to_string()),
            (
                "x-amz-content-sha256".to_string(),
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
            ),
            ("x-amz-date".to_string(), "20130524T000000Z".to_string()),
        ];
        let auth = s3.authorization(
            "GET",
            "/test.txt",
            "",
            &headers,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "us-east-1",
            "20130524T000000Z",
        );
        assert!(auth.ends_with(
            "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        ));
    }

    #[test]
    fn builds_path_and_virtual_targets() {
        let minio = client(true, "http://127.0.0.1:9000");
        let t = minio.target("us-east-1", Some("demo"), Some("a b/c.txt"));
        assert_eq!(t.url, "http://127.0.0.1:9000/demo/a%20b/c.txt");
        assert_eq!(t.host, "127.0.0.1:9000");
        let aws = client(false, "https://s3.us-east-1.amazonaws.com/");
        let t = aws.target("us-east-1", Some("demo"), Some("k"));
        assert_eq!(t.url, "https://demo.s3.us-east-1.amazonaws.com/k");
        let t = aws.target("eu-west-1", Some("demo"), None);
        assert_eq!(t.host, "demo.s3.eu-west-1.amazonaws.com");
    }
}
