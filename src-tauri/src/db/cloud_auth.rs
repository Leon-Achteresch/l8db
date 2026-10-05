use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use hmac::{Hmac, KeyInit, Mac};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use sha2::{Digest, Sha256};

use super::aws::{self, AwsConnection, CredentialSource, Credentials};

pub const AUTH_PARAM: &str = "l8db_auth";
pub const PROFILE_PARAM: &str = "l8db_aws_profile";
pub const REGION_PARAM: &str = "l8db_aws_region";
pub const TENANT_PARAM: &str = "l8db_tenant";
pub const HOST_PARAM: &str = "l8db_token_host";
pub const PORT_PARAM: &str = "l8db_token_port";
pub const TOKEN_MARKER: &str = "l8db_token_auth";
pub const ACCESS_TOKEN_PARAM: &str = "l8db_access_token";

const RDS_TOKEN_SECONDS: u32 = 900;
const AWS_REFRESH_AFTER: Duration = Duration::from_secs(600);
const ENTRA_MARGIN_SECONDS: i64 = 300;

const AWS_ENCODE: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AzureResource {
    OssRdbms,
    SqlDatabase,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Mode {
    AwsIam {
        profile: Option<String>,
        region: Option<String>,
    },
    Entra {
        tenant: Option<String>,
    },
}

struct CacheEntry {
    token: String,
    valid_until: Instant,
}

fn cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn text(value: &str) -> Option<String> {
    Some(value.trim().to_string()).filter(|v| !v.is_empty())
}

pub fn has_marker(url: &url::Url) -> bool {
    url.query_pairs().any(|(k, _)| k == TOKEN_MARKER)
}

pub fn pool_key(value: &str, database: Option<&str>) -> String {
    let resolved = resolve(value).unwrap_or_else(|_| value.to_string());
    super::connection::connection_key(&resolved, database)
}

pub fn resolve(value: &str) -> Result<String, String> {
    if !value.contains(AUTH_PARAM) {
        return Ok(value.to_string());
    }
    let mut url = url::Url::parse(value.trim()).map_err(|_| "Ungültige URL".to_string())?;
    let mut mode = None;
    let mut profile = None;
    let mut region = None;
    let mut tenant = None;
    let mut token_host = None;
    let mut token_port = None;
    let mut kept = Vec::new();
    for (key, val) in url.query_pairs() {
        match key.as_ref() {
            AUTH_PARAM => mode = text(&val),
            PROFILE_PARAM => profile = text(&val),
            REGION_PARAM => region = text(&val),
            TENANT_PARAM => tenant = text(&val),
            HOST_PARAM => token_host = text(&val),
            PORT_PARAM => token_port = text(&val).and_then(|p| p.parse::<u16>().ok()),
            TOKEN_MARKER | ACCESS_TOKEN_PARAM => {}
            _ => kept.push((key.into_owned(), val.into_owned())),
        }
    }
    let mode = match mode.as_deref() {
        None | Some("password") => {
            set_query(&mut url, &kept);
            return Ok(url.to_string());
        }
        Some("aws_iam") => Mode::AwsIam { profile, region },
        Some("entra") => Mode::Entra { tenant },
        Some(other) => return Err(format!("Unbekannter Authentifizierungsmodus: {other}")),
    };
    let scheme = url.scheme().to_string();
    let family = match scheme.as_str() {
        "postgres" | "postgresql" => Family::Postgres,
        "mysql" | "mariadb" => Family::Mysql,
        "mssql" | "sqlserver" => Family::Mssql,
        _ => {
            return Err(
                "Token-Authentifizierung wird für diesen Datenbanktyp nicht unterstützt.".into(),
            )
        }
    };
    let host = match token_host {
        Some(host) => host,
        None => url
            .host_str()
            .map(|h| h.trim_matches(['[', ']']).to_string())
            .ok_or("Host fehlt")?,
    };
    let port = token_port.or(url.port()).unwrap_or(family.default_port());
    let user = percent_encoding::percent_decode_str(url.username())
        .decode_utf8_lossy()
        .into_owned();
    let token = match &mode {
        Mode::AwsIam { profile, region } => {
            if family == Family::Mssql {
                return Err(
                    "AWS-IAM-Authentifizierung ist nur für PostgreSQL und MySQL verfügbar.".into(),
                );
            }
            if user.is_empty() {
                return Err(
                    "Für AWS-IAM-Authentifizierung ist ein Benutzername erforderlich.".into(),
                );
            }
            aws_token(&host, port, &user, profile.as_deref(), region.as_deref())?
        }
        Mode::Entra { tenant } => entra_token(family.azure_resource(), tenant.as_deref())?,
    };
    kept.push((TOKEN_MARKER.to_string(), "1".to_string()));
    if family == Family::Mssql {
        kept.push((ACCESS_TOKEN_PARAM.to_string(), token));
    } else {
        url.set_password(Some(&utf8_percent_encode(&token, AWS_ENCODE).to_string()))
            .map_err(|_| "Token konnte nicht gesetzt werden".to_string())?;
    }
    if family == Family::Mysql {
        kept.retain(|(k, _)| k != "enable_cleartext_plugin");
        kept.push(("enable_cleartext_plugin".to_string(), "true".to_string()));
    }
    set_query(&mut url, &kept);
    Ok(url.to_string())
}

fn set_query(url: &mut url::Url, pairs: &[(String, String)]) {
    if pairs.is_empty() {
        url.set_query(None);
    } else {
        url.query_pairs_mut()
            .clear()
            .extend_pairs(pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Family {
    Postgres,
    Mysql,
    Mssql,
}

impl Family {
    fn default_port(self) -> u16 {
        match self {
            Family::Postgres => 5432,
            Family::Mysql => 3306,
            Family::Mssql => 1433,
        }
    }

    fn azure_resource(self) -> AzureResource {
        match self {
            Family::Mssql => AzureResource::SqlDatabase,
            _ => AzureResource::OssRdbms,
        }
    }
}

fn cached(key: &str) -> Option<String> {
    let cache = cache().lock().ok()?;
    cache
        .get(key)
        .filter(|entry| entry.valid_until > Instant::now())
        .map(|entry| entry.token.clone())
}

fn store(key: String, token: &str, valid_for: Duration) {
    if let Ok(mut cache) = cache().lock() {
        cache.insert(
            key,
            CacheEntry {
                token: token.to_string(),
                valid_until: Instant::now() + valid_for,
            },
        );
    }
}

fn block_on<F: std::future::Future + Send>(future: F) -> Result<F::Output, String>
where
    F::Output: Send,
{
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread {
            return Ok(tokio::task::block_in_place(|| handle.block_on(future)));
        }
    }
    std::thread::scope(|scope| {
        scope
            .spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map(|rt| rt.block_on(future))
                    .map_err(|e| e.to_string())
            })
            .join()
            .map_err(|_| "AWS-Anmeldedaten konnten nicht geladen werden".to_string())?
    })
}

fn aws_token(
    host: &str,
    port: u16,
    user: &str,
    profile: Option<&str>,
    region: Option<&str>,
) -> Result<String, String> {
    let key = format!("aws\0{host}\0{port}\0{user}\0{profile:?}\0{region:?}");
    if let Some(token) = cached(&key) {
        return Ok(token);
    }
    let connection = AwsConnection {
        region: region.map(str::to_string).or_else(|| rds_region(host)),
        source: match profile {
            Some(p) => CredentialSource::Profile(p.to_string()),
            None => CredentialSource::Default,
        },
        endpoint: None,
        path: String::new(),
        params: HashMap::new(),
    };
    let region = connection.region()?;
    let credentials = block_on(async { connection.credentials().await })?
        .map_err(|e| format!("AWS-IAM-Anmeldedaten: {e}"))?;
    let token = rds_auth_token(&credentials, host, port, user, &region, Utc::now());
    store(key, &token, AWS_REFRESH_AFTER);
    Ok(token)
}

pub fn rds_region(host: &str) -> Option<String> {
    let parts: Vec<&str> = host.split('.').collect();
    let index = parts.iter().position(|p| *p == "rds")?;
    index
        .checked_sub(1)
        .and_then(|i| parts.get(i))
        .filter(|r| r.contains('-'))
        .map(|r| r.to_string())
}

fn encode(value: &str) -> String {
    utf8_percent_encode(value, AWS_ENCODE).to_string()
}

pub fn rds_auth_token(
    credentials: &Credentials,
    host: &str,
    port: u16,
    user: &str,
    region: &str,
    now: DateTime<Utc>,
) -> String {
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = &amz_date[..8];
    let scope = format!("{date}/{region}/rds-db/aws4_request");
    let mut params = vec![
        ("Action".to_string(), "connect".to_string()),
        ("DBUser".to_string(), user.to_string()),
        (
            "X-Amz-Algorithm".to_string(),
            "AWS4-HMAC-SHA256".to_string(),
        ),
        (
            "X-Amz-Credential".to_string(),
            format!("{}/{scope}", credentials.access_key),
        ),
        ("X-Amz-Date".to_string(), amz_date.clone()),
        ("X-Amz-Expires".to_string(), RDS_TOKEN_SECONDS.to_string()),
        ("X-Amz-SignedHeaders".to_string(), "host".to_string()),
    ];
    if let Some(token) = &credentials.session_token {
        params.push(("X-Amz-Security-Token".to_string(), token.clone()));
    }
    let mut encoded: Vec<(String, String)> =
        params.iter().map(|(k, v)| (encode(k), encode(v))).collect();
    encoded.sort();
    let query = encoded
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    let authority = format!("{host}:{port}");
    let canonical = format!(
        "GET\n/\n{query}\nhost:{authority}\n\nhost\n{}",
        aws::hex(&Sha256::digest(b""))
    );
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        aws::hex(&Sha256::digest(canonical.as_bytes()))
    );
    let key = aws::signing_key(&credentials.secret_key, date, region, "rds-db");
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).expect("HMAC-Schlüssel");
    mac.update(string_to_sign.as_bytes());
    let signature = aws::hex(&mac.finalize().into_bytes());
    format!("{authority}/?{query}&X-Amz-Signature={signature}")
}

pub fn az_args(resource: AzureResource, tenant: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = ["account", "get-access-token", "--output", "json"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    match resource {
        AzureResource::OssRdbms => {
            args.extend(["--resource-type".to_string(), "oss-rdbms".to_string()])
        }
        AzureResource::SqlDatabase => args.extend([
            "--resource".to_string(),
            "https://database.windows.net/".to_string(),
        ]),
    }
    if let Some(tenant) = tenant.filter(|t| !t.trim().is_empty()) {
        args.extend(["--tenant".to_string(), tenant.trim().to_string()]);
    }
    args
}

fn az_command() -> std::process::Command {
    let mut command = crate::process::std_command(if cfg!(windows) { "az.cmd" } else { "az" });
    let mut paths: Vec<std::path::PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    paths.extend([
        std::path::PathBuf::from("/opt/homebrew/bin"),
        std::path::PathBuf::from("/usr/local/bin"),
    ]);
    if let Ok(path) = std::env::join_paths(paths) {
        command.env("PATH", path);
    }
    command
}

pub fn parse_az_output(stdout: &str) -> Result<(String, Option<i64>), String> {
    let value: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|_| "Unerwartete Ausgabe von az account get-access-token".to_string())?;
    let token = value
        .get("accessToken")
        .and_then(|v| v.as_str())
        .filter(|t| !t.is_empty())
        .ok_or("Azure CLI lieferte kein accessToken")?
        .to_string();
    let expires = value.get("expires_on").and_then(|v| {
        v.as_i64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    });
    Ok((token, expires))
}

fn entra_token(resource: AzureResource, tenant: Option<&str>) -> Result<String, String> {
    let key = format!("entra\0{resource:?}\0{tenant:?}");
    if let Some(token) = cached(&key) {
        return Ok(token);
    }
    let output = az_command()
        .args(az_args(resource, tenant))
        .output()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => "Azure CLI (az) wurde nicht gefunden. Bitte installieren und mit \"az login\" anmelden.".to_string(),
            _ => format!("Azure CLI konnte nicht gestartet werden: {e}"),
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr.trim();
        return Err(
            if detail.contains("az login") || detail.contains("AADSTS") {
                format!("Azure CLI ist nicht angemeldet. Bitte \"az login\" ausführen. ({detail})")
            } else {
                format!("Entra-ID-Token konnte nicht abgerufen werden: {detail}")
            },
        );
    }
    let (token, expires) = parse_az_output(&String::from_utf8_lossy(&output.stdout))?;
    let remaining = expires
        .map(|e| e - Utc::now().timestamp() - ENTRA_MARGIN_SECONDS)
        .unwrap_or(1800)
        .clamp(0, 3000);
    store(key, &token, Duration::from_secs(remaining as u64));
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn credentials(session: Option<&str>) -> Credentials {
        Credentials {
            access_key: "AKIDEXAMPLE".into(),
            secret_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".into(),
            session_token: session.map(str::to_string),
        }
    }

    #[test]
    fn builds_rds_auth_token() {
        let now = Utc.with_ymd_and_hms(2026, 10, 4, 12, 0, 0).unwrap();
        let host = "db.abc123.eu-central-1.rds.amazonaws.com";
        let token = rds_auth_token(
            &credentials(None),
            host,
            5432,
            "app_user",
            "eu-central-1",
            now,
        );
        assert!(token.starts_with(&format!("{host}:5432/?Action=connect&DBUser=app_user&")));
        assert!(token.contains("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
        assert!(token.contains(
            "X-Amz-Credential=AKIDEXAMPLE%2F20261004%2Feu-central-1%2Frds-db%2Faws4_request"
        ));
        assert!(token.contains("X-Amz-Date=20261004T120000Z"));
        assert!(token.contains("X-Amz-Expires=900"));
        assert!(token.contains("X-Amz-SignedHeaders=host"));
        assert!(!token.contains("X-Amz-Security-Token"));
        let signature = token.rsplit("X-Amz-Signature=").next().unwrap();
        assert_eq!(signature.len(), 64);
        assert!(signature.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            token,
            rds_auth_token(
                &credentials(None),
                host,
                5432,
                "app_user",
                "eu-central-1",
                now
            )
        );
        let session = rds_auth_token(
            &credentials(Some("tok/en")),
            host,
            5432,
            "app_user",
            "eu-central-1",
            now,
        );
        assert!(session.contains("X-Amz-Security-Token=tok%2Fen"));
        assert_ne!(
            session.rsplit("X-Amz-Signature=").next().unwrap(),
            signature
        );
    }

    #[test]
    fn detects_rds_region() {
        assert_eq!(
            rds_region("db.abc123.eu-central-1.rds.amazonaws.com").as_deref(),
            Some("eu-central-1")
        );
        assert_eq!(rds_region("localhost"), None);
    }

    #[test]
    fn builds_az_arguments() {
        assert_eq!(
            az_args(AzureResource::OssRdbms, None),
            [
                "account",
                "get-access-token",
                "--output",
                "json",
                "--resource-type",
                "oss-rdbms"
            ]
        );
        assert_eq!(
            az_args(AzureResource::SqlDatabase, Some(" contoso ")),
            [
                "account",
                "get-access-token",
                "--output",
                "json",
                "--resource",
                "https://database.windows.net/",
                "--tenant",
                "contoso"
            ]
        );
    }

    #[test]
    fn parses_az_output() {
        let (token, expires) =
            parse_az_output(r#"{"accessToken":"abc","expiresOn":"x","expires_on":1700000000}"#)
                .unwrap();
        assert_eq!(token, "abc");
        assert_eq!(expires, Some(1700000000));
        assert!(parse_az_output("{}").is_err());
    }

    #[test]
    fn leaves_password_connections_untouched() {
        let url = "postgres://u:p@h:5432/db?sslmode=require";
        assert_eq!(resolve(url).unwrap(), url);
    }

    #[test]
    fn rejects_aws_iam_for_sql_server() {
        assert!(resolve("mssql://u@h:1433/db?l8db_auth=aws_iam").is_err());
    }
}
