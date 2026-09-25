use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use rsa::pkcs1::DecodeRsaPrivateKey;
use rsa::pkcs1v15::SigningKey;
use rsa::pkcs8::{DecodePrivateKey, EncodePublicKey};
use rsa::signature::{SignatureEncoding, Signer};
use rsa::RsaPrivateKey;
use sha2::{Digest, Sha256};

pub(crate) const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const BIGQUERY_SCOPE: &str = "https://www.googleapis.com/auth/bigquery";

pub(crate) fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .connect_timeout(super::execution::connection_duration())
            .user_agent(concat!("l8db/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP-Client")
    })
}

pub(crate) async fn read_body(
    response: reqwest::Response,
    service: &str,
) -> Result<(u16, serde_json::Value), String> {
    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("{service}-Antwort konnte nicht gelesen werden: {e}"))?;
    let raw = gunzip(&bytes)?;
    if raw.iter().all(|b| b.is_ascii_whitespace()) {
        return Ok((status, serde_json::Value::Null));
    }
    match serde_json::from_slice(&raw) {
        Ok(value) => Ok((status, value)),
        Err(_) => Ok((
            status,
            serde_json::Value::String(String::from_utf8_lossy(&raw).trim().to_string()),
        )),
    }
}

pub(crate) fn gunzip(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() < 2 || bytes[0] != 0x1f || bytes[1] != 0x8b {
        return Ok(bytes.to_vec());
    }
    let mut out = Vec::new();
    flate2::read::MultiGzDecoder::new(bytes)
        .read_to_end(&mut out)
        .map_err(|e| format!("Komprimierte Antwort ist ungültig: {e}"))?;
    Ok(out)
}

pub(crate) async fn interruptible<T>(
    future: impl std::future::Future<Output = T>,
    deadline: Instant,
) -> Result<T, bool> {
    let cancel = super::execution::cancellation_token();
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(false),
        _ = tokio::time::sleep_until(deadline.into()) => Err(true),
        result = future => Ok(result),
    }
}

pub(crate) fn interrupted_message(timed_out: bool, confirmed: Result<(), String>) -> String {
    match (timed_out, confirmed) {
        (true, Ok(())) => format!(
            "Query-Timeout nach {} Sekunden: Abfrage vom Server abgebrochen.",
            super::execution::query_duration().as_secs()
        ),
        (false, Ok(())) => "Abfrage vom Server abgebrochen.".into(),
        (_, Err(error)) => format!(
            "Abbruch angefordert, Serverabschluss nicht bestätigt: {error}. Die Abfrage kann serverseitig weiterlaufen."
        ),
    }
}

pub(crate) fn digest_key(input: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(Sha256::digest(input.as_bytes()))
}

pub(crate) fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn normalize_pem(text: &str) -> Option<(String, String)> {
    let text = text.replace("\\n", "\n");
    let start = text.find("-----BEGIN ")?;
    let rest = &text[start + 11..];
    let label_end = rest.find("-----")?;
    let label = rest[..label_end].trim().to_string();
    let footer = format!("-----END {label}-----");
    let body_start = start + 11 + label_end + 5;
    let end = text[body_start..].find(&footer)? + body_start;
    let inner = &text[body_start..end];
    let mut headers = Vec::new();
    let mut body = String::new();
    for line in inner.lines() {
        let line = line.trim();
        if line.contains(':') {
            headers.push(line.to_string());
        } else {
            body.extend(line.chars().filter(|c| !c.is_whitespace()));
        }
    }
    let mut pem = format!("-----BEGIN {label}-----\n");
    for header in &headers {
        pem.push_str(header);
        pem.push('\n');
    }
    if !headers.is_empty() {
        pem.push('\n');
    }
    for chunk in body.as_bytes().chunks(64) {
        pem.push_str(std::str::from_utf8(chunk).unwrap_or_default());
        pem.push('\n');
    }
    pem.push_str(&footer);
    pem.push('\n');
    Some((label, pem))
}

pub(crate) fn split_key_secret(secret: &str) -> (String, Option<String>) {
    let Some(end) = secret.rfind("-----END ") else {
        return (secret.to_string(), None);
    };
    let Some(close) = secret[end + 9..].find("-----") else {
        return (secret.to_string(), None);
    };
    let cut = end + 9 + close + 5;
    let passphrase = secret[cut..]
        .trim_matches(|c| c == '\r' || c == '\n')
        .to_string();
    (
        secret[..cut].to_string(),
        (!passphrase.is_empty()).then_some(passphrase),
    )
}

pub(crate) fn load_rsa_key(text: &str, passphrase: Option<&str>) -> Result<RsaPrivateKey, String> {
    let (label, pem) = normalize_pem(text).ok_or("Kein PEM-Schlüssel gefunden (-----BEGIN …).")?;
    match label.as_str() {
        "ENCRYPTED PRIVATE KEY" => {
            let passphrase = passphrase
                .filter(|p| !p.is_empty())
                .ok_or("Der private Schlüssel ist verschlüsselt, die Passphrase fehlt.")?;
            RsaPrivateKey::from_pkcs8_encrypted_pem(&pem, passphrase).map_err(|e| {
                format!("Verschlüsselter Schlüssel konnte nicht entschlüsselt werden: {e}")
            })
        }
        "RSA PRIVATE KEY" => {
            if pem.contains("ENCRYPTED") {
                return Err("Legacy-verschlüsselte PKCS#1-Schlüssel werden nicht unterstützt. Konvertiere mit: openssl pkcs8 -topk8 -v2 aes-256-cbc -in key.pem -out key.p8".into());
            }
            RsaPrivateKey::from_pkcs1_pem(&pem)
                .map_err(|e| format!("PKCS#1-Schlüssel ist ungültig: {e}"))
        }
        "PRIVATE KEY" => RsaPrivateKey::from_pkcs8_pem(&pem)
            .map_err(|e| format!("PKCS#8-Schlüssel ist ungültig: {e}")),
        other => Err(format!(
            "Nicht unterstützter Schlüsseltyp \"{other}\". Erwartet wird ein RSA-Schlüssel."
        )),
    }
}

pub(crate) fn public_key_fingerprint(key: &RsaPrivateKey) -> Result<String, String> {
    let der = key
        .to_public_key()
        .to_public_key_der()
        .map_err(|e| format!("Öffentlicher Schlüssel konnte nicht kodiert werden: {e}"))?;
    Ok(format!(
        "SHA256:{}",
        base64::engine::general_purpose::STANDARD.encode(Sha256::digest(der.as_bytes()))
    ))
}

pub(crate) fn sign_rs256(
    key: &RsaPrivateKey,
    claims: &serde_json::Value,
) -> Result<String, String> {
    let header = b64url(br#"{"alg":"RS256","typ":"JWT"}"#);
    let payload = b64url(claims.to_string().as_bytes());
    let input = format!("{header}.{payload}");
    let signature = SigningKey::<Sha256>::new(key.clone())
        .try_sign(input.as_bytes())
        .map_err(|e| format!("JWT konnte nicht signiert werden: {e}"))?;
    Ok(format!("{input}.{}", b64url(&signature.to_bytes())))
}

pub(crate) fn snowflake_jwt(
    key: &RsaPrivateKey,
    account: &str,
    user: &str,
    now: u64,
) -> Result<String, String> {
    let account = account
        .split('.')
        .next()
        .unwrap_or(account)
        .to_ascii_uppercase();
    let qualified = format!("{account}.{}", user.to_ascii_uppercase());
    let fingerprint = public_key_fingerprint(key)?;
    sign_rs256(
        key,
        &serde_json::json!({
            "iss": format!("{qualified}.{fingerprint}"),
            "sub": qualified,
            "iat": now,
            "exp": now + 3540,
        }),
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GoogleAuth {
    Adc,
    Json(String),
    File(String),
    Token(String),
    Anonymous,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct GoogleToken {
    pub token: Option<String>,
    pub quota_project: Option<String>,
}

fn token_cache() -> &'static Mutex<HashMap<String, (String, Instant)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (String, Instant)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn cached(key: &str) -> Option<String> {
    let cache = token_cache().lock().ok()?;
    let (token, expires) = cache.get(key)?;
    (Instant::now() + Duration::from_secs(60) < *expires).then(|| token.clone())
}

pub(crate) fn remember(key: &str, token: &str, lifetime: u64) {
    if let Ok(mut cache) = token_cache().lock() {
        cache.insert(
            key.to_string(),
            (
                token.to_string(),
                Instant::now() + Duration::from_secs(lifetime.max(60)),
            ),
        );
    }
}

fn gcloud_config_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLOUDSDK_CONFIG").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    if cfg!(windows) {
        return std::env::var_os("APPDATA")
            .filter(|v| !v.is_empty())
            .map(|dir| PathBuf::from(dir).join("gcloud"));
    }
    std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .map(|home| PathBuf::from(home).join(".config").join("gcloud"))
}

pub(crate) fn adc_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("GOOGLE_APPLICATION_CREDENTIALS").filter(|v| !v.is_empty())
    {
        return Some(PathBuf::from(path));
    }
    gcloud_config_dir()
        .map(|dir| dir.join("application_default_credentials.json"))
        .filter(|path| path.is_file())
}

fn expand_home(path: &str) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(|home| PathBuf::from(home).join(rest))
            .unwrap_or_else(|| PathBuf::from(path)),
        None => PathBuf::from(path),
    }
}

fn read_credentials(path: &std::path::Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| {
        format!(
            "Anmeldedatei {} konnte nicht gelesen werden: {e}",
            path.display()
        )
    })
}

pub(crate) async fn google_token(
    auth: &GoogleAuth,
    allow_anonymous: bool,
) -> Result<GoogleToken, String> {
    let json = match auth {
        GoogleAuth::Anonymous => return Ok(GoogleToken::default()),
        GoogleAuth::Token(token) => {
            return Ok(GoogleToken {
                token: Some(token.trim().to_string()),
                quota_project: None,
            })
        }
        GoogleAuth::Json(text) => text.clone(),
        GoogleAuth::File(path) => read_credentials(&expand_home(path))?,
        GoogleAuth::Adc => match adc_path() {
            Some(path) => read_credentials(&path)?,
            None if allow_anonymous => return Ok(GoogleToken::default()),
            None => return Err("Keine Application Default Credentials gefunden. Führe \"gcloud auth application-default login\" aus, setze GOOGLE_APPLICATION_CREDENTIALS oder hinterlege einen Service-Account-Schlüssel.".into()),
        },
    };
    credentials_token(&json).await
}

pub(crate) async fn credentials_token(json: &str) -> Result<GoogleToken, String> {
    let creds: serde_json::Value = serde_json::from_str(json.trim())
        .map_err(|e| format!("Google-Anmeldedaten sind kein gültiges JSON: {e}"))?;
    let field = |name: &str| creds.get(name).and_then(|v| v.as_str()).unwrap_or("");
    let quota_project = Some(field("quota_project_id").to_string()).filter(|p| !p.is_empty());
    let token_uri = Some(field("token_uri"))
        .filter(|u| !u.is_empty())
        .unwrap_or(GOOGLE_TOKEN_URI)
        .to_string();
    let cache_key = digest_key(json.trim());
    if let Some(token) = cached(&cache_key) {
        return Ok(GoogleToken {
            token: Some(token),
            quota_project,
        });
    }
    let form: Vec<(&str, String)> = match field("type") {
        "service_account" => {
            let email = field("client_email");
            if email.is_empty() {
                return Err("Service-Account-Schlüssel ohne client_email.".into());
            }
            let key = load_rsa_key(field("private_key"), None)?;
            let now = now_secs();
            let assertion = sign_rs256(
                &key,
                &serde_json::json!({
                    "iss": email,
                    "scope": BIGQUERY_SCOPE,
                    "aud": token_uri,
                    "iat": now,
                    "exp": now + 3600,
                }),
            )?;
            vec![
                (
                    "grant_type",
                    "urn:ietf:params:oauth:grant-type:jwt-bearer".to_string(),
                ),
                ("assertion", assertion),
            ]
        }
        "authorized_user" => {
            if field("refresh_token").is_empty() {
                return Err("Die Anmeldedatei enthält kein refresh_token.".into());
            }
            vec![
                ("grant_type", "refresh_token".to_string()),
                ("client_id", field("client_id").to_string()),
                ("client_secret", field("client_secret").to_string()),
                ("refresh_token", field("refresh_token").to_string()),
            ]
        }
        "" => return Err("Google-Anmeldedaten ohne Feld \"type\".".into()),
        other => {
            return Err(format!(
                "Anmeldetyp \"{other}\" wird nicht unterstützt. Verwende einen Service-Account-Schlüssel oder \"gcloud auth application-default login\"."
            ))
        }
    };
    let encoded = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form.iter().map(|(k, v)| (*k, v.as_str())))
        .finish();
    let response = http()
        .post(&token_uri)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(encoded)
        .send()
        .await
        .map_err(|e| format!("Google-Tokenendpunkt nicht erreichbar: {e}"))?;
    let (status, body) = read_body(response, "Google OAuth").await?;
    if !(200..300).contains(&status) {
        let detail = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .map(|v| {
                v.as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| v.to_string())
            })
            .unwrap_or_else(|| body.to_string());
        return Err(format!(
            "Google-Anmeldung fehlgeschlagen ({status}): {detail}"
        ));
    }
    let token = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("Google-Tokenantwort ohne access_token.")?
        .to_string();
    let lifetime = body
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .unwrap_or(3600);
    remember(&cache_key, &token, lifetime);
    Ok(GoogleToken {
        token: Some(token),
        quota_project,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use rsa::pkcs8::{EncodePrivateKey, LineEnding};
    use rsa::signature::Verifier;

    pub(crate) fn test_key() -> &'static RsaPrivateKey {
        static KEY: OnceLock<RsaPrivateKey> = OnceLock::new();
        KEY.get_or_init(|| RsaPrivateKey::new(&mut rand::rng(), 1024).expect("RSA-Schlüssel"))
    }

    pub(crate) fn test_key_pem() -> String {
        test_key().to_pkcs8_pem(LineEnding::LF).unwrap().to_string()
    }

    fn decode_part(part: &str) -> serde_json::Value {
        serde_json::from_slice(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(part)
                .unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn rs256_jwt_verifies_with_public_key() {
        let key = test_key();
        let jwt = sign_rs256(key, &serde_json::json!({"a": 1})).unwrap();
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(decode_part(parts[0])["alg"], "RS256");
        assert_eq!(decode_part(parts[1])["a"], 1);
        let signature = rsa::pkcs1v15::Signature::try_from(
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(parts[2])
                .unwrap()
                .as_slice(),
        )
        .unwrap();
        rsa::pkcs1v15::VerifyingKey::<Sha256>::new(key.to_public_key())
            .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
            .unwrap();
    }

    #[test]
    fn loads_pkcs1_pkcs8_and_flattened_pem() {
        let key = test_key();
        let pkcs8 = test_key_pem();
        assert_eq!(&load_rsa_key(&pkcs8, None).unwrap(), key);
        let pkcs1 = rsa::pkcs1::EncodeRsaPrivateKey::to_pkcs1_pem(key, LineEnding::LF)
            .unwrap()
            .to_string();
        assert_eq!(&load_rsa_key(&pkcs1, None).unwrap(), key);
        let flattened = pkcs8.replace('\n', " ");
        assert_eq!(&load_rsa_key(&flattened, None).unwrap(), key);
        let escaped = pkcs8.replace('\n', "\\n");
        assert_eq!(&load_rsa_key(&escaped, None).unwrap(), key);
        assert!(load_rsa_key("kein schluessel", None).is_err());
    }

    #[test]
    fn loads_encrypted_pkcs8_aes_and_des3() {
        use pkcs8::pkcs5::pbes2;
        let key = test_key();
        let der = key.to_pkcs8_der().unwrap();
        let info = pkcs8::PrivateKeyInfoRef::try_from(der.as_bytes()).unwrap();
        let aes = pbes2::Parameters::generate_pbkdf2_sha256_aes256cbc(2048, &[7u8; 16], [3u8; 16])
            .unwrap();
        let des3 = pbes2::Parameters {
            kdf: pbes2::Pbkdf2Params::hmac_sha256(2048, &[9u8; 8])
                .unwrap()
                .into(),
            encryption: pbes2::EncryptionScheme::DesEde3Cbc { iv: [5u8; 8] },
        };
        for params in [aes, des3] {
            let pem = info
                .encrypt_with_params(params, "geheim")
                .unwrap()
                .to_pem("ENCRYPTED PRIVATE KEY", LineEnding::LF)
                .unwrap()
                .to_string();
            assert_eq!(&load_rsa_key(&pem, Some("geheim")).unwrap(), key);
            assert!(load_rsa_key(&pem, None).unwrap_err().contains("Passphrase"));
            assert!(load_rsa_key(&pem, Some("falsch")).is_err());
        }
    }

    #[test]
    fn fingerprint_matches_openssl_format() {
        let key = test_key();
        let der = key.to_public_key().to_public_key_der().unwrap();
        let expected = format!(
            "SHA256:{}",
            base64::engine::general_purpose::STANDARD.encode(Sha256::digest(der.as_bytes()))
        );
        let fingerprint = public_key_fingerprint(key).unwrap();
        assert_eq!(fingerprint, expected);
        assert_eq!(fingerprint.len(), 7 + 44);
    }

    #[test]
    fn snowflake_jwt_claims_use_account_locator_and_upper_case() {
        let key = test_key();
        let jwt = snowflake_jwt(key, "xy12345.eu-central-1", "svc_user", 1000).unwrap();
        let claims = decode_part(jwt.split('.').nth(1).unwrap());
        let fingerprint = public_key_fingerprint(key).unwrap();
        assert_eq!(claims["sub"], "XY12345.SVC_USER");
        assert_eq!(claims["iss"], format!("XY12345.SVC_USER.{fingerprint}"));
        assert_eq!(claims["iat"], 1000);
        assert_eq!(claims["exp"], 4540);
        let org = snowflake_jwt(key, "myorg-account1", "u", 0).unwrap();
        assert_eq!(
            decode_part(org.split('.').nth(1).unwrap())["sub"],
            "MYORG-ACCOUNT1.U"
        );
    }

    #[test]
    fn splits_passphrase_after_pem_footer() {
        let (pem, pass) = split_key_secret("-----BEGIN X-----\nabc\n-----END X-----\ngeheim");
        assert_eq!(pem, "-----BEGIN X-----\nabc\n-----END X-----");
        assert_eq!(pass.as_deref(), Some("geheim"));
        let (_, none) = split_key_secret("-----BEGIN X-----\nabc\n-----END X-----\n");
        assert_eq!(none, None);
        let (token, none) = split_key_secret("pat-token");
        assert_eq!(token, "pat-token");
        assert_eq!(none, None);
    }

    #[test]
    fn gunzip_passes_plain_bytes_and_inflates_gzip() {
        use std::io::Write;
        assert_eq!(gunzip(b"[1]").unwrap(), b"[1]");
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(b"[[\"a\"]]").unwrap();
        assert_eq!(gunzip(&encoder.finish().unwrap()).unwrap(), b"[[\"a\"]]");
    }

    #[tokio::test]
    async fn service_account_and_refresh_token_flows_hit_token_endpoint() {
        let server = super::super::http_mock::start(|req| {
            if req
                .body
                .contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer")
            {
                let assertion = req.form("assertion").unwrap();
                let claims = decode_part(assertion.split('.').nth(1).unwrap());
                assert_eq!(claims["iss"], "sa@p.iam.gserviceaccount.com");
                assert_eq!(claims["scope"], BIGQUERY_SCOPE);
                return (
                    200,
                    r#"{"access_token":"sa-token","expires_in":3600}"#.into(),
                );
            }
            if req.form("grant_type").as_deref() == Some("refresh_token")
                && req.form("refresh_token").as_deref() == Some("rt")
            {
                assert_eq!(req.form("client_id").as_deref(), Some("cid"));
                return (
                    200,
                    r#"{"access_token":"user-token","expires_in":3600}"#.into(),
                );
            }
            (400, r#"{"error":"invalid_grant"}"#.into())
        });
        let token_uri = format!("{}/token", server.base);
        let sa = serde_json::json!({
            "type": "service_account",
            "client_email": "sa@p.iam.gserviceaccount.com",
            "private_key": test_key_pem(),
            "token_uri": token_uri,
        })
        .to_string();
        let token = google_token(&GoogleAuth::Json(sa.clone()), false)
            .await
            .unwrap();
        assert_eq!(token.token.as_deref(), Some("sa-token"));
        google_token(&GoogleAuth::Json(sa), false).await.unwrap();
        assert_eq!(server.requests().len(), 1);
        let user = serde_json::json!({
            "type": "authorized_user",
            "client_id": "cid",
            "client_secret": "cs",
            "refresh_token": "rt",
            "token_uri": token_uri,
            "quota_project_id": "billing",
        })
        .to_string();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("adc.json");
        std::fs::write(&path, &user).unwrap();
        let token = google_token(&GoogleAuth::File(path.display().to_string()), false)
            .await
            .unwrap();
        assert_eq!(token.token.as_deref(), Some("user-token"));
        assert_eq!(token.quota_project.as_deref(), Some("billing"));
        let bad = serde_json::json!({
            "type": "authorized_user",
            "client_id": "cid",
            "client_secret": "cs",
            "refresh_token": "other",
            "token_uri": token_uri,
        })
        .to_string();
        let err = google_token(&GoogleAuth::Json(bad), false)
            .await
            .unwrap_err();
        assert!(err.contains("invalid_grant"), "{err}");
        let err = credentials_token(r#"{"type":"external_account"}"#)
            .await
            .unwrap_err();
        assert!(err.contains("external_account"), "{err}");
    }

    #[tokio::test]
    async fn anonymous_and_static_token() {
        assert!(google_token(&GoogleAuth::Anonymous, false)
            .await
            .unwrap()
            .token
            .is_none());
        assert_eq!(
            google_token(&GoogleAuth::Token(" t ".into()), false)
                .await
                .unwrap()
                .token
                .as_deref(),
            Some("t")
        );
    }
}
