use std::str::FromStr;

use postgres_native_tls::MakeTlsConnector;
use sha2::{Digest, Sha256};
use tokio_postgres::Config;

use super::SslMode;

pub const READ_ONLY_OPTION: &str = "-c default_transaction_read_only=on";

pub fn options_are_read_only(options: Option<&str>) -> bool {
    options
        .map(|value| {
            value
                .replace(' ', "")
                .contains("default_transaction_read_only=on")
        })
        .unwrap_or(false)
}

pub fn connection_string_is_read_only(value: &str) -> bool {
    url::Url::parse(value)
        .ok()
        .map(|url| {
            url.query_pairs()
                .any(|(key, val)| key == "options" && options_are_read_only(Some(val.as_ref())))
        })
        .unwrap_or(false)
}

pub const PROXY_USER_PARAM: &str = "proxy_user";

pub fn proxy_user(url: &url::Url) -> Option<String> {
    url.query_pairs()
        .find(|(key, _)| key == PROXY_USER_PARAM)
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

const PG_OPTIONS: [&str; 18] = [
    "user",
    "password",
    "dbname",
    "options",
    "application_name",
    "sslnegotiation",
    "host",
    "hostaddr",
    "port",
    "connect_timeout",
    "tcp_user_timeout",
    "keepalives",
    "keepalives_idle",
    "keepalives_interval",
    "keepalives_retries",
    "target_session_attrs",
    "channel_binding",
    "load_balance_hosts",
];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PgTls {
    pub mode: SslMode,
    pub root_cert: Option<String>,
    pub cert: Option<String>,
    pub key: Option<String>,
    pub password: Option<String>,
}

fn escape_option(value: &str) -> String {
    value
        .chars()
        .flat_map(|c| {
            let escape = (c == '\\' || c.is_whitespace()).then_some('\\');
            escape.into_iter().chain(std::iter::once(c))
        })
        .collect()
}

fn append_option(config: &mut Config, option: String) {
    let options = match config.get_options() {
        Some(existing) if !existing.trim().is_empty() => format!("{existing} {option}"),
        _ => option,
    };
    config.options(options);
}

pub fn parse_connection(value: &str, database: Option<&str>) -> Result<(Config, PgTls), String> {
    let mut url = url::Url::parse(value).map_err(|_| "Ungültige PostgreSQL-URL".to_string())?;
    if !matches!(url.scheme(), "postgres" | "postgresql") {
        return Err("Eine postgresql:// oder postgres:// URL ist erforderlich".to_string());
    }
    let role = proxy_user(&url);
    let mut tls = PgTls::default();
    let mut schema = None;
    let mut params = Vec::new();
    for part in url.query().unwrap_or_default().split('&') {
        let Some((key, value)) = url::form_urlencoded::parse(part.as_bytes()).next() else {
            continue;
        };
        let text = || Some(value.to_string()).filter(|v| !v.is_empty());
        match key.as_ref() {
            "sslmode" => {
                tls.mode = match value.as_ref() {
                    "disable" | "allow" => SslMode::Disable,
                    "prefer" => SslMode::Prefer,
                    "require" => SslMode::Require,
                    "verify-ca" => SslMode::VerifyCa,
                    "verify-full" => SslMode::VerifyFull,
                    _ => return Err("Ungültiger SSL-Modus".to_string()),
                }
            }
            "sslrootcert" => tls.root_cert = text(),
            "sslcert" => tls.cert = text(),
            "sslkey" => tls.key = text(),
            "sslpassword" => tls.password = text(),
            "schema" | "currentSchema" | "search_path" => schema = text(),
            known if PG_OPTIONS.contains(&known) => params.push(part.to_string()),
            _ => {}
        }
    }
    let query = params.join("&");
    url.set_query(if query.is_empty() { None } else { Some(&query) });
    let mut config =
        Config::from_str(url.as_str()).map_err(|e| format!("Ungültiger Connection String: {e}"))?;
    config
        .ssl_mode(tls.mode.to_pg())
        .connect_timeout(super::execution::connection_duration());
    if let Some(database) = database.filter(|db| !db.is_empty()) {
        config.dbname(database);
    }
    if let Some(schema) = schema {
        append_option(
            &mut config,
            format!("-c search_path={}", escape_option(&schema)),
        );
    }
    if let Some(role) = role {
        append_option(&mut config, format!("-c role={}", escape_option(&role)));
    }
    if config.get_application_name().is_none() {
        config.application_name("l8db");
    }
    Ok((config, tls))
}

pub fn connection_key(value: &str, database: Option<&str>) -> String {
    let mut hash = Sha256::new();
    hash.update(value.as_bytes());
    hash.update([0]);
    hash.update(database.unwrap_or_default().as_bytes());
    super::hex_blob(hash.finalize().as_slice())
}

fn read_tls_file(path: &str, label: &str) -> Result<Vec<u8>, String> {
    let expanded = match path.strip_prefix("~/") {
        Some(rest) => std::env::var("HOME")
            .map(|home| format!("{home}/{rest}"))
            .unwrap_or_else(|_| path.to_string()),
        None => path.to_string(),
    };
    std::fs::read(&expanded)
        .map_err(|e| format!("{label} konnte nicht gelesen werden ({expanded}): {e}"))
}

pub fn tls_connector(tls: &PgTls) -> Result<MakeTlsConnector, String> {
    let mut builder = native_tls::TlsConnector::builder();
    let root = tls.root_cert.as_deref().filter(|path| *path != "system");
    let verify_chain = match tls.mode {
        SslMode::VerifyCa | SslMode::VerifyFull => true,
        SslMode::Require => root.is_some(),
        SslMode::Prefer | SslMode::Disable => false,
    };
    builder
        .danger_accept_invalid_certs(!verify_chain)
        .danger_accept_invalid_hostnames(!matches!(tls.mode, SslMode::VerifyFull));
    if let Some(path) = root {
        let roots = native_tls::Certificate::stack_from_pem(&read_tls_file(path, "sslrootcert")?)
            .map_err(|e| format!("sslrootcert ist kein gültiges PEM-Zertifikat: {e}"))?;
        builder.disable_built_in_roots(true);
        for root in roots {
            builder.add_root_certificate(root);
        }
    }
    if let Some(cert_path) = tls.cert.as_deref() {
        let cert = read_tls_file(cert_path, "sslcert")?;
        let lower = cert_path.to_ascii_lowercase();
        let identity = if lower.ends_with(".p12") || lower.ends_with(".pfx") {
            native_tls::Identity::from_pkcs12(&cert, tls.password.as_deref().unwrap_or(""))
        } else {
            let key_path = tls
                .key
                .as_deref()
                .ok_or("sslcert benötigt sslkey (PKCS#8-PEM) oder eine .p12/.pfx-Datei")?;
            native_tls::Identity::from_pkcs8(&cert, &read_tls_file(key_path, "sslkey")?)
        }
        .map_err(|e| {
            format!("Client-Zertifikat konnte nicht geladen werden: {e}. Unverschlüsselte Schlüssel müssen im PKCS#8-Format vorliegen (openssl pkcs8 -topk8 -nocrypt), verschlüsselte als .p12 mit sslpassword.")
        })?;
        builder.identity(identity);
    }
    builder
        .build()
        .map(MakeTlsConnector::new)
        .map_err(|e| format!("TLS-Connector konnte nicht erstellt werden: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_ssl_modes_and_preserves_cloud_options() {
        for mode in ["disable", "prefer", "require", "verify-ca", "verify-full"] {
            let value = format!("postgresql://user:p%40ss@db.example.com:5432/app?sslmode={mode}&channel_binding=require&application_name=l8db");
            let (config, tls) = parse_connection(&value, Some("other")).unwrap();
            assert_eq!(tls.mode.as_url_param(), mode);
            assert_eq!(config.get_dbname(), Some("other"));
            assert_eq!(config.get_password(), Some(b"p@ss".as_slice()));
            assert_eq!(config.get_application_name(), Some("l8db"));
            assert_eq!(
                config.get_channel_binding(),
                tokio_postgres::config::ChannelBinding::Require
            );
        }
    }

    #[test]
    fn preserves_encoded_options() {
        let (config, _) = parse_connection("postgres://user:p+ass@localhost/app?sslmode=require&options=-c%20search_path%3Dpublic&application_name=a+b", None).unwrap();
        assert_eq!(config.get_options(), Some("-c search_path=public"));
        assert_eq!(config.get_application_name(), Some("a+b"));
        assert_eq!(config.get_password(), Some(b"p+ass".as_slice()));
    }

    #[test]
    fn detects_read_only_connections() {
        let url = "postgres://user@localhost/app?options=-c%20default_transaction_read_only%3Don";
        assert!(connection_string_is_read_only(url));
        assert!(!connection_string_is_read_only(
            "postgres://user@localhost/app?options=-c%20search_path%3Dpublic"
        ));
        assert!(!connection_string_is_read_only(
            "postgres://user@localhost/app"
        ));
        let (config, _) = parse_connection(url, None).unwrap();
        assert!(options_are_read_only(config.get_options()));
    }

    #[test]
    fn proxy_user_becomes_role_option() {
        let (config, _) = parse_connection(
            "postgres://user@localhost/app?options=-c%20default_transaction_read_only%3Don&proxy_user=app%20user",
            None,
        )
        .unwrap();
        assert_eq!(
            config.get_options(),
            Some("-c default_transaction_read_only=on -c role=app\\ user")
        );
        assert!(options_are_read_only(config.get_options()));
        let (config, _) =
            parse_connection("postgres://user@localhost/app?proxy_user=", None).unwrap();
        assert_eq!(config.get_options(), None);
    }

    #[test]
    fn pool_keys_isolate_credentials_and_databases() {
        let first = "postgresql://user:first@localhost/app";
        let second = "postgresql://user:second@localhost/app";
        assert_ne!(connection_key(first, None), connection_key(second, None));
        assert_ne!(
            connection_key(first, None),
            connection_key(first, Some("other"))
        );
        assert!(!connection_key(first, None).contains("first"));
    }

    #[test]
    fn tunnel_retains_tls_hostname() {
        let (config, _) = parse_connection(
            "postgresql://user@db.example.com:12345/app?hostaddr=127.0.0.1&sslmode=verify-full",
            None,
        )
        .unwrap();
        assert_eq!(
            config.get_hosts(),
            &[tokio_postgres::config::Host::Tcp("db.example.com".into())]
        );
        assert_eq!(config.get_hostaddrs()[0].to_string(), "127.0.0.1");
        assert_eq!(config.get_ports(), &[12345]);
    }

    #[test]
    fn extracts_tls_files_schema_and_drops_client_only_params() {
        let (config, tls) = parse_connection(
            "postgresql://u@h/app?sslmode=verify-ca&sslrootcert=~/ca.pem&sslcert=/c.pem&sslkey=/k.pem&sslpassword=pw&schema=my%20app&pgbouncer=true&connection_limit=1&options=-c%20statement_timeout%3D5s",
            None,
        )
        .unwrap();
        assert_eq!(
            tls,
            PgTls {
                mode: SslMode::VerifyCa,
                root_cert: Some("~/ca.pem".into()),
                cert: Some("/c.pem".into()),
                key: Some("/k.pem".into()),
                password: Some("pw".into()),
            }
        );
        assert_eq!(
            config.get_options(),
            Some("-c statement_timeout=5s -c search_path=my\\ app")
        );
        assert_eq!(
            parse_connection("postgres://u@h/app?sslmode=allow", None)
                .unwrap()
                .1
                .mode
                .as_url_param(),
            "disable"
        );
    }

    #[test]
    fn tls_modes_follow_libpq_semantics() {
        for mode in [
            SslMode::Prefer,
            SslMode::Require,
            SslMode::VerifyCa,
            SslMode::VerifyFull,
        ] {
            assert!(tls_connector(&PgTls {
                mode,
                ..PgTls::default()
            })
            .is_ok());
        }
        let missing = PgTls {
            mode: SslMode::VerifyFull,
            root_cert: Some("/does/not/exist.pem".into()),
            ..PgTls::default()
        };
        assert!(tls_connector(&missing)
            .err()
            .is_some_and(|e| e.contains("sslrootcert")));
        let without_key = PgTls {
            cert: Some("/does/not/exist.pem".into()),
            ..PgTls::default()
        };
        assert!(tls_connector(&without_key).is_err());
    }

    #[tokio::test]
    #[ignore]
    async fn live_tls_modes_and_client_certificates() {
        let dir = std::env::var("L8DB_E2E_PG_TLS_DIR").unwrap_or_else(|_| "/tmp/l8db-pgtls".into());
        let port = std::env::var("L8DB_E2E_PG_TLS_PORT").unwrap_or_else(|_| "55460".into());
        let connect = |user: &str, host: &str, query: String| {
            let url =
                format!("postgresql://{user}@{host}:{port}/postgres?hostaddr=127.0.0.1&{query}");
            async move {
                let (config, tls) = parse_connection(&url, None)?;
                let client = super::super::execution::connect_postgres(&config, &tls).await?;
                client
                    .query_one(
                        "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
                        &[],
                    )
                    .await
                    .map(|row| row.get::<_, bool>(0))
                    .map_err(|e| e.to_string())
            }
        };
        let ca = format!("sslrootcert={dir}/ca.pem");
        assert_eq!(
            connect("postgres:testpw", "localhost", "sslmode=require".into()).await,
            Ok(true)
        );
        assert_eq!(
            connect("postgres:testpw", "localhost", "sslmode=prefer".into()).await,
            Ok(true)
        );
        assert_eq!(
            connect("postgres:testpw", "localhost", "sslmode=disable".into()).await,
            Ok(false)
        );
        assert!(connect(
            "postgres:testpw",
            "pg.l8db.test",
            "sslmode=verify-full".into()
        )
        .await
        .is_err());
        assert_eq!(
            connect(
                "postgres:testpw",
                "pg.l8db.test",
                format!("sslmode=verify-full&{ca}")
            )
            .await,
            Ok(true)
        );
        assert!(connect(
            "postgres:testpw",
            "localhost",
            format!("sslmode=verify-full&{ca}")
        )
        .await
        .is_err());
        assert_eq!(
            connect(
                "postgres:testpw",
                "localhost",
                format!("sslmode=verify-ca&{ca}")
            )
            .await,
            Ok(true)
        );
        assert_eq!(
            connect(
                "postgres:testpw",
                "localhost",
                format!("sslmode=require&{ca}")
            )
            .await,
            Ok(true)
        );
        assert_eq!(
            connect(
                "certuser",
                "pg.l8db.test",
                format!(
                    "sslmode=verify-full&{ca}&sslcert={dir}/client.pem&sslkey={dir}/client.pk8.pem"
                )
            )
            .await,
            Ok(true)
        );
        assert_eq!(
            connect(
                "certuser",
                "localhost",
                format!("sslmode=require&sslcert={dir}/client.p12&sslpassword=secret")
            )
            .await,
            Ok(true)
        );
        assert!(connect("certuser", "localhost", "sslmode=require".into())
            .await
            .is_err());
        let rsa = connect(
            "certuser",
            "localhost",
            format!("sslmode=require&sslcert={dir}/client.pem&sslkey={dir}/client.key"),
        )
        .await;
        assert!(rsa.is_ok() || rsa.unwrap_err().contains("PKCS#8"));
    }

    #[test]
    fn rejects_invalid_protocol_and_ssl() {
        assert!(parse_connection("https://example.com", None).is_err());
        assert!(parse_connection("postgres://user@host/app?sslmode=invalid", None).is_err());
        assert!(serde_json::from_str::<SslMode>("\"require\"").is_ok());
    }
}
