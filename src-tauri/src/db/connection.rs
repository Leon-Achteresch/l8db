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

pub fn parse_connection(value: &str, database: Option<&str>) -> Result<(Config, SslMode), String> {
    let mut url = url::Url::parse(value).map_err(|_| "Ungültige PostgreSQL-URL".to_string())?;
    if !matches!(url.scheme(), "postgres" | "postgresql") {
        return Err("Eine postgresql:// oder postgres:// URL ist erforderlich".to_string());
    }
    let role = proxy_user(&url);
    let mut ssl = SslMode::Prefer;

    for (key, value) in url.query_pairs() {
        if key == "sslmode" {
            ssl = match value.as_ref() {
                "disable" => SslMode::Disable,
                "prefer" => SslMode::Prefer,
                "require" => SslMode::Require,
                "verify-ca" => SslMode::VerifyCa,
                "verify-full" => SslMode::VerifyFull,
                _ => return Err("Ungültiger SSL-Modus".to_string()),
            };
        }
    }
    let params: Vec<_> = url
        .query()
        .unwrap_or_default()
        .split('&')
        .filter(|part| {
            !part.is_empty() && !part.starts_with("sslmode=") && !part.starts_with("proxy_user=")
        })
        .map(str::to_string)
        .collect();
    let query = params.join("&");
    url.set_query(if query.is_empty() { None } else { Some(&query) });
    let mut config =
        Config::from_str(url.as_str()).map_err(|e| format!("Ungültiger Connection String: {e}"))?;
    config
        .ssl_mode(ssl.to_pg())
        .connect_timeout(super::execution::connection_duration());
    if let Some(database) = database.filter(|db| !db.is_empty()) {
        config.dbname(database);
    }
    if let Some(role) = role {
        let role: String = role
            .chars()
            .flat_map(|c| {
                let escape = (c == '\\' || c.is_whitespace()).then_some('\\');
                escape.into_iter().chain(std::iter::once(c))
            })
            .collect();
        let options = match config.get_options() {
            Some(existing) if !existing.trim().is_empty() => format!("{existing} -c role={role}"),
            _ => format!("-c role={role}"),
        };
        config.options(options);
    }
    Ok((config, ssl))
}

pub fn connection_key(value: &str, database: Option<&str>) -> String {
    let mut hash = Sha256::new();
    hash.update(value.as_bytes());
    hash.update([0]);
    hash.update(database.unwrap_or_default().as_bytes());
    super::hex_blob(hash.finalize().as_slice())
}

pub fn tls_connector(ssl: SslMode) -> Result<MakeTlsConnector, String> {
    let mut builder = native_tls::TlsConnector::builder();
    if matches!(ssl, SslMode::VerifyCa) {
        builder.danger_accept_invalid_hostnames(true);
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
            let (config, ssl) = parse_connection(&value, Some("other")).unwrap();
            assert_eq!(ssl.as_url_param(), mode);
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
    fn rejects_invalid_protocol_and_ssl() {
        assert!(parse_connection("https://example.com", None).is_err());
        assert!(parse_connection("postgres://user@host/app?sslmode=invalid", None).is_err());
        assert!(serde_json::from_str::<SslMode>("\"require\"").is_ok());
    }
}
