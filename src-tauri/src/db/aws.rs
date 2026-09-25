use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use hmac::{Hmac, KeyInit, Mac};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Credentials {
    pub access_key: String,
    pub secret_key: String,
    pub session_token: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CredentialSource {
    Static(Credentials),
    Profile(String),
    Default,
}

#[derive(Clone, Debug)]
pub struct AwsConnection {
    pub region: Option<String>,
    pub source: CredentialSource,
    pub endpoint: Option<url::Url>,
    pub path: String,
    pub params: HashMap<String, String>,
}

pub struct Service {
    pub label: &'static str,
    pub signing_name: &'static str,
    pub host_prefix: &'static str,
    pub target_prefix: &'static str,
    pub content_type: &'static str,
}

pub struct AwsClient {
    service: &'static Service,
    region: String,
    credentials: Credentials,
    endpoint: url::Url,
}

fn decode(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8_lossy()
        .into_owned()
}

pub fn parse_url(connection_string: &str, scheme: &str) -> Result<AwsConnection, String> {
    let url = url::Url::parse(connection_string.trim())
        .map_err(|_| format!("Ungültige {scheme}:// URL"))?;
    if url.scheme() != scheme {
        return Err(format!("Eine {scheme}:// URL ist erforderlich"));
    }
    let host = decode(url.host_str().unwrap_or("")).to_ascii_lowercase();
    let region = (!host.is_empty() && host != "auto").then_some(host);
    let params: HashMap<String, String> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let user = decode(url.username());
    let source = if !user.is_empty() {
        let password = decode(url.password().unwrap_or(""));
        let (secret, token) = match password.split_once(':') {
            Some((secret, token)) => (secret.to_string(), Some(token.to_string())),
            None => (password, None),
        };
        if secret.is_empty() {
            return Err("Der Secret Access Key fehlt.".to_string());
        }
        CredentialSource::Static(Credentials {
            access_key: user,
            secret_key: secret,
            session_token: token.filter(|t| !t.is_empty()),
        })
    } else if let Some(profile) = params.get("profile") {
        CredentialSource::Profile(if profile.trim().is_empty() {
            "default".to_string()
        } else {
            profile.trim().to_string()
        })
    } else {
        CredentialSource::Default
    };
    let endpoint = match params.get("endpoint").map(|e| e.trim()) {
        Some(e) if !e.is_empty() => {
            let parsed = url::Url::parse(e).map_err(|_| format!("Ungültiger Endpunkt: {e}"))?;
            if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
                return Err("Der Endpunkt muss mit http:// oder https:// beginnen.".to_string());
            }
            Some(parsed)
        }
        _ => None,
    };
    Ok(AwsConnection {
        region,
        source,
        endpoint,
        path: decode(url.path().trim_matches('/')),
        params,
    })
}

impl AwsConnection {
    pub fn param(&self, key: &str) -> Option<&str> {
        self.params
            .get(key)
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
    }

    fn profile_name(&self) -> String {
        match &self.source {
            CredentialSource::Profile(name) => name.clone(),
            _ => env_value("AWS_PROFILE").unwrap_or_else(|| "default".to_string()),
        }
    }

    pub fn region(&self) -> Result<String, String> {
        if let Some(region) = &self.region {
            return Ok(region.clone());
        }
        if let Some(region) = env_value("AWS_REGION").or_else(|| env_value("AWS_DEFAULT_REGION")) {
            return Ok(region);
        }
        let profile = self.profile_name();
        profile_section(&profile, false)
            .and_then(|section| section.get("region").cloned())
            .ok_or_else(|| {
                format!("Keine Region angegeben und im Profil \"{profile}\" nicht hinterlegt.")
            })
    }

    pub async fn client(&self, service: &'static Service) -> Result<AwsClient, String> {
        let region = self.region()?;
        let credentials = match &self.source {
            CredentialSource::Static(c) => c.clone(),
            CredentialSource::Profile(name) => cached_profile_credentials(name).await?,
            CredentialSource::Default => match env_credentials() {
                Some(c) => c,
                None => cached_profile_credentials(&self.profile_name()).await?,
            },
        };
        let endpoint = match &self.endpoint {
            Some(e) => e.clone(),
            None => default_endpoint(service, &region)?,
        };
        Ok(AwsClient {
            service,
            region,
            credentials,
            endpoint,
        })
    }
}

fn default_endpoint(service: &Service, region: &str) -> Result<url::Url, String> {
    let suffix = if region.starts_with("cn-") {
        "amazonaws.com.cn"
    } else {
        "amazonaws.com"
    };
    url::Url::parse(&format!(
        "https://{}.{region}.{suffix}/",
        service.host_prefix
    ))
    .map_err(|_| format!("Ungültige Region: {region}"))
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(super::execution::connection_duration())
            .build()
            .expect("HTTP-Client")
    })
}

pub fn host_header(url: &url::Url) -> String {
    let host = url.host_str().unwrap_or_default();
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    }
}

impl AwsClient {
    pub async fn call(&self, action: &str, body: &Value) -> Result<Value, String> {
        let payload = serde_json::to_vec(body).map_err(|e| e.to_string())?;
        let amz_date = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let host = host_header(&self.endpoint);
        let target = format!("{}.{action}", self.service.target_prefix);
        let mut headers = vec![
            (
                "content-type".to_string(),
                self.service.content_type.to_string(),
            ),
            ("host".to_string(), host),
            ("x-amz-date".to_string(), amz_date.clone()),
            ("x-amz-target".to_string(), target),
        ];
        if let Some(token) = &self.credentials.session_token {
            headers.push(("x-amz-security-token".to_string(), token.clone()));
        }
        let path = match self.endpoint.path() {
            "" => "/",
            p => p,
        };
        let authorization = sign(
            &self.credentials,
            &SignRequest {
                method: "POST",
                path,
                query: "",
                headers: &headers,
                payload: &payload,
                region: &self.region,
                service: self.service.signing_name,
                amz_date: &amz_date,
            },
        );
        let mut request = http()
            .post(self.endpoint.clone())
            .timeout(super::execution::query_duration())
            .header("authorization", authorization);
        for (name, value) in &headers {
            if name != "host" {
                request = request.header(name.as_str(), value.as_str());
            }
        }
        let response = request.body(payload).send().await.map_err(|e| {
            format!(
                "{} nicht erreichbar ({}): {e}",
                self.service.label, self.endpoint
            )
        })?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| format!("Antwort konnte nicht gelesen werden: {e}"))?;
        if !status.is_success() {
            return Err(service_error(self.service.label, status.as_u16(), &text));
        }
        if text.trim().is_empty() {
            return Ok(Value::Object(Default::default()));
        }
        serde_json::from_str(&text)
            .map_err(|e| format!("{}: ungültige Antwort: {e}", self.service.label))
    }
}

pub fn service_error(label: &str, status: u16, body: &str) -> String {
    let Ok(json) = serde_json::from_str::<Value>(body) else {
        return format!("{label} HTTP {status}: {}", body.trim());
    };
    let kind = json
        .get("__type")
        .and_then(Value::as_str)
        .map(|t| t.rsplit('#').next().unwrap_or(t).to_string())
        .unwrap_or_else(|| format!("HTTP {status}"));
    let message = json
        .get("message")
        .or_else(|| json.get("Message"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut out = format!("{label} {kind}: {message}");
    if let Some(reasons) = json.get("CancellationReasons").and_then(Value::as_array) {
        let details: Vec<String> = reasons
            .iter()
            .enumerate()
            .filter_map(|(i, r)| {
                let code = r.get("Code").and_then(Value::as_str)?;
                (code != "None").then(|| {
                    format!(
                        "Anweisung {}: {code} {}",
                        i + 1,
                        r.get("Message").and_then(Value::as_str).unwrap_or("")
                    )
                })
            })
            .collect();
        if !details.is_empty() {
            out.push_str(&format!("\n{}", details.join("\n")));
        }
    }
    out
}

pub struct SignRequest<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: &'a str,
    pub headers: &'a [(String, String)],
    pub payload: &'a [u8],
    pub region: &'a str,
    pub service: &'a str,
    pub amz_date: &'a str,
}

fn hex(bytes: &[u8]) -> String {
    super::hex_blob(bytes)[2..].to_string()
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC-Schlüssel");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

pub fn signing_key(secret: &str, date: &str, region: &str, service: &str) -> Vec<u8> {
    let k_date = hmac(format!("AWS4{secret}").as_bytes(), date.as_bytes());
    let k_region = hmac(&k_date, region.as_bytes());
    let k_service = hmac(&k_region, service.as_bytes());
    hmac(&k_service, b"aws4_request")
}

pub fn canonical_request(req: &SignRequest) -> (String, String) {
    let mut headers: Vec<(String, String)> = req
        .headers
        .iter()
        .map(|(k, v)| {
            (
                k.to_ascii_lowercase(),
                v.split_whitespace().collect::<Vec<_>>().join(" "),
            )
        })
        .collect();
    headers.sort();
    let canonical_headers: String = headers.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
    let signed = headers
        .iter()
        .map(|(k, _)| k.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical = format!(
        "{}\n{}\n{}\n{canonical_headers}\n{signed}\n{}",
        req.method,
        req.path,
        req.query,
        hex(&Sha256::digest(req.payload))
    );
    (canonical, signed)
}

pub fn sign(credentials: &Credentials, req: &SignRequest) -> String {
    let (canonical, signed) = canonical_request(req);
    let date = &req.amz_date[..8];
    let scope = format!("{date}/{}/{}/aws4_request", req.region, req.service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{scope}\n{}",
        req.amz_date,
        hex(&Sha256::digest(canonical.as_bytes()))
    );
    let key = signing_key(&credentials.secret_key, date, req.region, req.service);
    let signature = hex(&hmac(&key, string_to_sign.as_bytes()));
    format!(
        "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed}, Signature={signature}",
        credentials.access_key
    )
}

fn env_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn env_credentials() -> Option<Credentials> {
    Some(Credentials {
        access_key: env_value("AWS_ACCESS_KEY_ID")?,
        secret_key: env_value("AWS_SECRET_ACCESS_KEY")?,
        session_token: env_value("AWS_SESSION_TOKEN"),
    })
}

fn home() -> Option<PathBuf> {
    env_value("HOME")
        .or_else(|| env_value("USERPROFILE"))
        .map(PathBuf::from)
}

fn aws_file(env: &str, name: &str) -> Option<PathBuf> {
    env_value(env)
        .map(PathBuf::from)
        .or_else(|| home().map(|h| h.join(".aws").join(name)))
}

type Sections = HashMap<String, HashMap<String, String>>;

pub fn parse_ini(text: &str) -> Sections {
    let mut sections: Sections = HashMap::new();
    let mut current: Option<String> = None;
    for raw in text.lines() {
        if raw.starts_with([' ', '\t']) {
            continue;
        }
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
            sections.entry(name.clone()).or_default();
            current = Some(name);
            continue;
        }
        if let (Some(section), Some((key, value))) = (&current, line.split_once('=')) {
            sections
                .entry(section.clone())
                .or_default()
                .insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    sections
}

fn read_ini(env: &str, name: &str) -> Sections {
    aws_file(env, name)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|text| parse_ini(&text))
        .unwrap_or_default()
}

fn profile_section(profile: &str, with_credentials: bool) -> Option<HashMap<String, String>> {
    let config = read_ini("AWS_CONFIG_FILE", "config");
    let mut merged = config
        .get(&format!("profile {profile}"))
        .or_else(|| {
            (profile == "default")
                .then(|| config.get("default"))
                .flatten()
        })
        .cloned();
    if with_credentials {
        if let Some(creds) = read_ini("AWS_SHARED_CREDENTIALS_FILE", "credentials").get(profile) {
            let section = merged.get_or_insert_with(HashMap::new);
            for (k, v) in creds {
                section.insert(k.clone(), v.clone());
            }
        }
    }
    merged
}

type CacheEntry = (Credentials, Option<i64>, Instant);

fn cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn cached_profile_credentials(profile: &str) -> Result<Credentials, String> {
    let now = chrono::Utc::now().timestamp();
    if let Some((creds, expires, fetched)) =
        cache().lock().ok().and_then(|c| c.get(profile).cloned())
    {
        let fresh = match expires {
            Some(at) => at - 300 > now,
            None => fetched.elapsed() < Duration::from_secs(600),
        };
        if fresh {
            return Ok(creds);
        }
    }
    let (creds, expires) = profile_credentials(profile).await?;
    if let Ok(mut c) = cache().lock() {
        c.insert(
            profile.to_string(),
            (creds.clone(), expires, Instant::now()),
        );
    }
    Ok(creds)
}

async fn profile_credentials(profile: &str) -> Result<(Credentials, Option<i64>), String> {
    let section = profile_section(profile, true).ok_or_else(|| {
        format!("AWS-Profil \"{profile}\" wurde in ~/.aws/config oder ~/.aws/credentials nicht gefunden.")
    })?;
    if let (Some(access_key), Some(secret_key)) = (
        section.get("aws_access_key_id"),
        section.get("aws_secret_access_key"),
    ) {
        return Ok((
            Credentials {
                access_key: access_key.clone(),
                secret_key: secret_key.clone(),
                session_token: section.get("aws_session_token").cloned(),
            },
            None,
        ));
    }
    if let Some(command) = section.get("credential_process") {
        return credential_process(command).await;
    }
    if section.contains_key("sso_account_id") {
        return sso_credentials(profile, &section).await;
    }
    if section.contains_key("role_arn") {
        return Err(format!("Profil \"{profile}\" nutzt role_arn/AssumeRole. Das wird nicht direkt unterstützt; nutze credential_process, SSO oder temporäre Schlüssel."));
    }
    Err(format!(
        "Profil \"{profile}\" enthält keine unterstützten Zugangsdaten."
    ))
}

fn parse_expiration(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::String(s) => chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|d| d.timestamp()),
        Value::Number(n) => n.as_i64().map(|ms| ms / 1000),
        _ => None,
    }
}

pub fn parse_process_output(stdout: &str) -> Result<(Credentials, Option<i64>), String> {
    let json: Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("credential_process lieferte kein gültiges JSON: {e}"))?;
    let text = |key: &str| json.get(key).and_then(Value::as_str).map(str::to_string);
    Ok((
        Credentials {
            access_key: text("AccessKeyId").ok_or("credential_process: AccessKeyId fehlt")?,
            secret_key: text("SecretAccessKey")
                .ok_or("credential_process: SecretAccessKey fehlt")?,
            session_token: text("SessionToken"),
        },
        parse_expiration(json.get("Expiration")),
    ))
}

async fn credential_process(command: &str) -> Result<(Credentials, Option<i64>), String> {
    #[cfg(windows)]
    let mut process = {
        let mut p = tokio::process::Command::new("cmd");
        p.arg("/C").arg(command);
        p
    };
    #[cfg(not(windows))]
    let mut process = {
        let mut p = tokio::process::Command::new("sh");
        p.arg("-c").arg(command);
        p
    };
    let output = tokio::time::timeout(
        Duration::from_secs(60),
        process
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "credential_process hat nach 60 Sekunden nicht geantwortet.".to_string())?
    .map_err(|e| format!("credential_process konnte nicht gestartet werden: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "credential_process fehlgeschlagen ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    parse_process_output(&String::from_utf8_lossy(&output.stdout))
}

async fn sso_credentials(
    profile: &str,
    section: &HashMap<String, String>,
) -> Result<(Credentials, Option<i64>), String> {
    let session = section
        .get("sso_session")
        .and_then(|name| {
            read_ini("AWS_CONFIG_FILE", "config")
                .get(&format!("sso-session {name}"))
                .cloned()
        })
        .unwrap_or_default();
    let get = |key: &str| {
        section
            .get(key)
            .or_else(|| session.get(key))
            .cloned()
            .ok_or_else(|| format!("Profil \"{profile}\": {key} fehlt"))
    };
    let start_url = get("sso_start_url")?;
    let sso_region = get("sso_region")?;
    let account = get("sso_account_id")?;
    let role = get("sso_role_name")?;
    let login = format!("aws sso login --profile {profile}");
    let token = sso_cached_token(&start_url)
        .ok_or_else(|| format!("Kein gültiges SSO-Token gefunden. Melde dich mit `{login}` an."))?;
    let url = format!("https://portal.sso.{sso_region}.amazonaws.com/federation/credentials");
    let response = http()
        .get(url)
        .timeout(super::execution::connection_duration())
        .query(&[
            ("role_name", role.as_str()),
            ("account_id", account.as_str()),
        ])
        .header("x-amz-sso_bearer_token", token)
        .send()
        .await
        .map_err(|e| format!("AWS SSO nicht erreichbar: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "{}\nGgf. erneut anmelden: `{login}`",
            service_error("AWS SSO", status.as_u16(), &body)
        ));
    }
    let json: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let role = json
        .get("roleCredentials")
        .ok_or("AWS SSO: roleCredentials fehlt")?;
    let text = |key: &str| role.get(key).and_then(Value::as_str).map(str::to_string);
    Ok((
        Credentials {
            access_key: text("accessKeyId").ok_or("AWS SSO: accessKeyId fehlt")?,
            secret_key: text("secretAccessKey").ok_or("AWS SSO: secretAccessKey fehlt")?,
            session_token: text("sessionToken"),
        },
        parse_expiration(role.get("expiration")),
    ))
}

fn sso_cached_token(start_url: &str) -> Option<String> {
    let dir = home()?.join(".aws").join("sso").join("cache");
    let now = chrono::Utc::now().timestamp();
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| std::fs::read_to_string(entry.ok()?.path()).ok())
        .filter_map(|text| serde_json::from_str::<Value>(&text).ok())
        .filter(|json| {
            json.get("startUrl")
                .and_then(Value::as_str)
                .map(|u| u.trim_end_matches('/'))
                == Some(start_url.trim_end_matches('/'))
        })
        .filter_map(|json| {
            let expires = parse_expiration(json.get("expiresAt"))?;
            let token = json.get("accessToken").and_then(Value::as_str)?;
            (expires > now + 60).then(|| (expires, token.to_string()))
        })
        .max_by_key(|(expires, _)| *expires)
        .map(|(_, token)| token)
}

pub fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

pub fn quote_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn example() -> Credentials {
        Credentials {
            access_key: "AKIDEXAMPLE".to_string(),
            secret_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".to_string(),
            session_token: None,
        }
    }

    fn headers(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn derives_signing_key_from_aws_docs() {
        let key = signing_key(
            "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            "20120215",
            "us-east-1",
            "iam",
        );
        assert_eq!(
            hex(&key),
            "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d"
        );
    }

    #[test]
    fn signs_get_vanilla_test_vector() {
        let h = headers(&[
            ("Host", "example.amazonaws.com"),
            ("X-Amz-Date", "20150830T123600Z"),
        ]);
        let req = SignRequest {
            method: "GET",
            path: "/",
            query: "",
            headers: &h,
            payload: b"",
            region: "us-east-1",
            service: "service",
            amz_date: "20150830T123600Z",
        };
        assert_eq!(
            sign(&example(), &req),
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
        );
    }

    #[test]
    fn signs_iam_list_users_example() {
        let h = headers(&[
            (
                "Content-Type",
                "application/x-www-form-urlencoded; charset=utf-8",
            ),
            ("Host", "iam.amazonaws.com"),
            ("X-Amz-Date", "20150830T123600Z"),
        ]);
        let req = SignRequest {
            method: "GET",
            path: "/",
            query: "Action=ListUsers&Version=2010-05-08",
            headers: &h,
            payload: b"",
            region: "us-east-1",
            service: "iam",
            amz_date: "20150830T123600Z",
        };
        let (canonical, _) = canonical_request(&req);
        assert_eq!(
            hex(&Sha256::digest(canonical.as_bytes())),
            "f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59"
        );
        assert!(sign(&example(), &req).ends_with(
            "SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"
        ));
    }

    #[test]
    fn signs_post_vanilla_test_vector() {
        let h = headers(&[
            ("Host", "example.amazonaws.com"),
            ("X-Amz-Date", "20150830T123600Z"),
        ]);
        let req = SignRequest {
            method: "POST",
            path: "/",
            query: "",
            headers: &h,
            payload: b"",
            region: "us-east-1",
            service: "service",
            amz_date: "20150830T123600Z",
        };
        assert!(sign(&example(), &req).ends_with(
            "Signature=5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b"
        ));
    }

    #[test]
    fn parses_url_credential_sources() {
        let conn = parse_url(
            "dynamodb://AKID:se%2Fcret%3Atoken@eu-central-1?endpoint=http%3A%2F%2Flocalhost%3A8000",
            "dynamodb",
        )
        .unwrap();
        assert_eq!(conn.region.as_deref(), Some("eu-central-1"));
        assert_eq!(
            conn.source,
            CredentialSource::Static(Credentials {
                access_key: "AKID".to_string(),
                secret_key: "se/cret".to_string(),
                session_token: Some("token".to_string()),
            })
        );
        assert_eq!(
            host_header(conn.endpoint.as_ref().unwrap()),
            "localhost:8000"
        );
        let conn = parse_url("athena://auto/AwsDataCatalog?profile=dev", "athena").unwrap();
        assert_eq!(conn.region, None);
        assert_eq!(conn.source, CredentialSource::Profile("dev".to_string()));
        assert_eq!(conn.path, "AwsDataCatalog");
        let conn = parse_url("athena://us-east-1", "athena").unwrap();
        assert_eq!(conn.source, CredentialSource::Default);
        assert!(parse_url("dynamodb://AKID@us-east-1", "dynamodb").is_err());
        assert!(parse_url("athena://us-east-1", "dynamodb").is_err());
        assert!(parse_url("dynamodb://us-east-1?endpoint=ftp%3A%2F%2Fx", "dynamodb").is_err());
    }

    #[test]
    fn parses_aws_ini_profiles() {
        let ini = parse_ini(
            "[default]\nregion = eu-west-1\n[profile  dev]\nsso_session = corp\ns3 =\n  max_concurrent_requests = 5\n# note\n[sso-session corp]\nsso_region=us-east-1\n",
        );
        assert_eq!(ini["default"]["region"], "eu-west-1");
        assert_eq!(ini["profile dev"]["sso_session"], "corp");
        assert!(!ini["profile dev"].contains_key("max_concurrent_requests"));
        assert_eq!(ini["sso-session corp"]["sso_region"], "us-east-1");
    }

    #[test]
    fn parses_credential_process_output() {
        let (creds, expires) = parse_process_output(
            r#"{"Version":1,"AccessKeyId":"A","SecretAccessKey":"S","SessionToken":"T","Expiration":"2030-01-01T00:00:00Z"}"#,
        )
        .unwrap();
        assert_eq!(creds.session_token.as_deref(), Some("T"));
        assert_eq!(expires, Some(1893456000));
        assert!(parse_process_output("{}").is_err());
    }

    #[test]
    fn formats_service_errors_with_cancellation_reasons() {
        let msg = service_error(
            "DynamoDB",
            400,
            r#"{"__type":"com.amazonaws.dynamodb.v20120810#TransactionCanceledException","Message":"Transaction cancelled","CancellationReasons":[{"Code":"None"},{"Code":"ConditionalCheckFailed","Message":"The conditional request failed"}]}"#,
        );
        assert!(msg.starts_with("DynamoDB TransactionCanceledException: Transaction cancelled"));
        assert!(msg.contains("Anweisung 2: ConditionalCheckFailed"));
    }
}
