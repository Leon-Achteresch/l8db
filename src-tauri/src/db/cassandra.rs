use std::sync::Arc;

use async_trait::async_trait;
use scylla::client::execution_profile::ExecutionProfile;
use scylla::client::session::Session;
use scylla::client::session_builder::SessionBuilder;
use scylla::errors::TranslationError;
use scylla::policies::address_translator::{AddressTranslator, UntranslatedPeer};
use scylla::policies::load_balancing::DefaultPolicy;
use scylla::response::{PagingState, PagingStateResponse};
use scylla::statement::Consistency;
use scylla::statement::Statement;
use scylla::value::{CqlValue, Row};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::DigitallySignedStruct;

use super::pool::PoolState;
use super::{
    hex_blob, rows_to_objects, timed, unsupported, validate_table_filter, AddColumnRequest,
    AlterColumnRequest, ColumnInfo, CreateTableRequest, DatabaseAdapter, DetailedColumnInfo,
    IndexInfo, QueryResult, RowCount, SslMode, TableData, TableInfo,
};

const PAGE_SIZE: i32 = 1000;
const CQLSH_ONLY: &[&str] = &[
    "CONSISTENCY",
    "SERIAL",
    "COPY",
    "SOURCE",
    "CAPTURE",
    "TRACING",
    "EXPAND",
    "PAGING",
    "LOGIN",
    "SHOW",
];

fn without_allow_filtering(filter: &str) -> &str {
    let trimmed = filter.trim_end().trim_end_matches(';').trim_end();
    let lower = trimmed.to_ascii_lowercase();
    let Some(rest) = lower.strip_suffix("filtering") else {
        return filter;
    };
    let rest = rest.trim_end();
    match rest.strip_suffix("allow") {
        Some(head) if rest.len() < lower.len() - 9 && head.ends_with(char::is_whitespace) => {
            trimmed[..head.len()].trim_end()
        }
        _ => filter,
    }
}

fn cql_where(filter: Option<&str>, allow_raw: bool) -> Result<String, String> {
    match filter
        .map(without_allow_filtering)
        .map(str::trim)
        .filter(|f| !f.is_empty())
    {
        Some(expression) => {
            if !allow_raw {
                validate_table_filter(expression)?;
            }
            Ok(format!(" WHERE {expression}"))
        }
        None => Ok(String::new()),
    }
}

pub struct CassandraAdapter {
    nodes: Vec<String>,
    user: Option<(String, String)>,
    keyspace: Option<String>,
    tls: CassandraTls,
    datacenter: Option<String>,
    consistency: Option<Consistency>,
    pool_state: PoolState,
    key: String,
}

pub fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

fn lit(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn map_err<E: std::fmt::Display>(e: E) -> String {
    friendly(&e.to_string())
}

fn between<'a>(text: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let rest = &text[text.find(start)? + start.len()..];
    Some(&rest[..rest.find(end)?])
}

fn without_position(detail: &str) -> &str {
    let rest = detail.strip_prefix("line ").unwrap_or(detail);
    match rest.split_once(' ') {
        Some((position, tail)) if position.contains(':') && rest.len() < detail.len() => tail,
        _ => detail,
    }
}

fn friendly(raw: &str) -> String {
    if raw.contains("Authentication is required") {
        return "Cassandra verlangt eine Anmeldung. Zugangsdaten in der URL angeben: cassandra://BENUTZER:PASSWORT@host:port/keyspace".into();
    }
    if raw.contains("bad credentials") || raw.contains("and/or password are incorrect") {
        return "Cassandra: Benutzer oder Passwort falsch.".into();
    }
    if raw.contains("InvalidContentType") || raw.contains("corrupt message") {
        return "Der Server spricht kein TLS. Mit sslmode=disable verbinden oder TLS am Server aktivieren.".into();
    }
    if raw.contains("returned an empty plan") {
        return "Kein Knoten im gewählten Datacenter. Namen unter ?datacenter= prüfen.".into();
    }
    if let Some(name) = between(raw, "Keyspace '", "' does not exist") {
        return format!("Keyspace {name} gibt es nicht.");
    }
    if let Some(name) = raw.split("unconfigured table ").nth(1) {
        return format!("Tabelle {} gibt es nicht.", name.trim());
    }
    let detail = raw
        .split_once("Error message: ")
        .map(|(_, d)| without_position(d.trim()))
        .unwrap_or_else(|| raw.trim_start_matches("Database returned an error: "));
    if let Some((column, table)) = detail
        .split_once("Undefined column name ")
        .and_then(|(_, rest)| rest.split_once(" in table "))
    {
        return format!("Spalte {column} gibt es in {table} nicht.");
    }
    if let (Some(value), Some(rest)) = (
        between(detail, "constant (", ") for "),
        detail.split(") for ").nth(1),
    ) {
        if let Some((column, data_type)) = rest.split_once(" of type ") {
            return format!(
                "Wert {value} passt nicht zum Typ {data_type} der Spalte {}.",
                column.trim_matches('"')
            );
        }
    }
    if detail.contains("at input 'OR'") {
        return "CQL kennt kein OR. IN (…) oder getrennte Abfragen verwenden.".into();
    }
    if detail.contains("LIKE restriction is only supported") {
        return "LIKE geht nur auf Spalten mit SAI-Index.".into();
    }
    if detail.contains("mismatched input 'NULL' expecting K_NOT") {
        return "IS NULL gibt es in CQL nicht.".into();
    }
    if detail.contains("ORDER BY is only supported when the partition key is restricted") {
        return "Sortieren geht nur mit Partitionsschlüssel im Filter, z. B. pk = 1.".into();
    }
    if detail.contains("Order by") {
        return "Sortieren geht nur nach Clustering-Spalten.".into();
    }
    if raw.contains("syntax error") {
        return format!("CQL-Syntaxfehler: {detail}");
    }
    format!("Cassandra: {detail}")
}

fn connect_error(raw: String, nodes: &[String], reported: &[std::net::SocketAddr]) -> String {
    let at = nodes.join(", ");
    if raw.contains("Connection refused") {
        return format!("Kein Cassandra auf {at}. Host und Port prüfen.");
    }
    if raw.contains("Couldn't resolve any hostname") {
        return format!("Host {at} nicht gefunden. Sonderzeichen in Benutzer oder Passwort mit %-Kodierung schreiben (@ → %40, : → %3A, / → %2F).");
    }
    if raw.starts_with("Verbindungs-Timeout") || raw.contains("timed out") {
        let unknown: Vec<String> = reported
            .iter()
            .map(ToString::to_string)
            .filter(|addr| !nodes.contains(addr))
            .collect();
        if !unknown.is_empty() {
            return format!(
                "{raw}. Der Knoten meldet {}, das ist von hier nicht erreichbar. Bei Docker CASSANDRA_BROADCAST_RPC_ADDRESS=127.0.0.1 setzen.",
                unknown.join(", ")
            );
        }
    }
    friendly(&raw)
}

#[derive(Default)]
struct ReportedAddresses(std::sync::Mutex<Vec<std::net::SocketAddr>>);

#[async_trait]
impl AddressTranslator for ReportedAddresses {
    async fn translate_address(
        &self,
        peer: &UntranslatedPeer,
    ) -> Result<std::net::SocketAddr, TranslationError> {
        let address = peer.untranslated_address();
        if let Ok(mut seen) = self.0.lock() {
            if !seen.contains(&address) && seen.len() < 16 {
                seen.push(address);
            }
        }
        Ok(address)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct CassandraTls {
    mode: SslMode,
    host: String,
    root_cert: Option<String>,
    cert: Option<String>,
    key: Option<String>,
}

#[derive(Debug)]
struct HostVerifier {
    inner: Arc<dyn ServerCertVerifier>,
    host: Option<ServerName<'static>>,
    verify_chain: bool,
}

impl ServerCertVerifier for HostVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if !self.verify_chain {
            return Ok(ServerCertVerified::assertion());
        }
        let name = self.host.clone().unwrap_or_else(|| server_name.to_owned());
        match self
            .inner
            .verify_server_cert(end_entity, intermediates, &name, ocsp, now)
        {
            Err(rustls::Error::InvalidCertificate(
                rustls::CertificateError::NotValidForName
                | rustls::CertificateError::NotValidForNameContext { .. },
            )) if self.host.is_none() => Ok(ServerCertVerified::assertion()),
            other => other,
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

impl CassandraTls {
    fn client_config(&self) -> Result<Arc<rustls::ClientConfig>, String> {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let tls_err = |e: rustls::Error| format!("Cassandra-TLS: {e}");
        let inner: Arc<dyn ServerCertVerifier> = match &self.root_cert {
            Some(path) => {
                let mut roots = rustls::RootCertStore::empty();
                for cert in CertificateDer::pem_file_iter(path)
                    .map_err(|e| format!("sslrootcert konnte nicht gelesen werden ({path}): {e}"))?
                {
                    roots
                        .add(cert.map_err(|e| format!("sslrootcert ist ungültig: {e}"))?)
                        .map_err(tls_err)?;
                }
                rustls::client::WebPkiServerVerifier::builder_with_provider(
                    Arc::new(roots),
                    provider.clone(),
                )
                .build()
                .map_err(|e| format!("Cassandra-TLS: {e}"))?
            }
            None => Arc::new(
                rustls_platform_verifier::Verifier::new(provider.clone()).map_err(tls_err)?,
            ),
        };
        let verifier = HostVerifier {
            inner,
            host: (self.mode == SslMode::VerifyFull)
                .then(|| ServerName::try_from(self.host.clone()).ok())
                .flatten(),
            verify_chain: match self.mode {
                SslMode::VerifyCa | SslMode::VerifyFull => true,
                SslMode::Require => self.root_cert.is_some(),
                SslMode::Prefer | SslMode::Disable => false,
            },
        };
        let builder = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(tls_err)?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(verifier));
        let config = match (&self.cert, &self.key) {
            (Some(cert), Some(key)) => {
                let chain = CertificateDer::pem_file_iter(cert)
                    .and_then(|certs| certs.collect::<Result<Vec<_>, _>>())
                    .map_err(|e| format!("sslcert konnte nicht gelesen werden ({cert}): {e}"))?;
                let key = PrivateKeyDer::from_pem_file(key)
                    .map_err(|e| format!("sslkey konnte nicht gelesen werden ({key}): {e}"))?;
                builder.with_client_auth_cert(chain, key).map_err(tls_err)?
            }
            (None, None) => builder.with_no_client_auth(),
            _ => return Err("sslcert und sslkey müssen gemeinsam angegeben werden".into()),
        };
        Ok(Arc::new(config))
    }
}

fn value_to_json(value: Option<CqlValue>) -> serde_json::Value {
    let Some(value) = value else {
        return serde_json::Value::Null;
    };
    match value {
        CqlValue::Ascii(s) | CqlValue::Text(s) => serde_json::Value::String(s),
        CqlValue::Boolean(b) => serde_json::Value::Bool(b),
        CqlValue::Blob(b) => serde_json::Value::String(hex_blob(&b)),
        CqlValue::Counter(c) => super::exact_number::int(c.0),
        CqlValue::Double(d) => float_json(d, d.to_string()),
        CqlValue::Float(f) => float_json(f as f64, f.to_string()),
        CqlValue::Int(i) => serde_json::Value::from(i),
        CqlValue::BigInt(i) => super::exact_number::int(i),
        CqlValue::Varint(v) => super::exact_number::decimal(&super::exact_number::signed_be_text(
            v.as_signed_bytes_be_slice(),
        )),
        CqlValue::Decimal(d) => {
            let (bytes, scale) = d.as_signed_be_bytes_slice_and_exponent();
            super::exact_number::decimal(&super::exact_number::scaled_text(
                &super::exact_number::signed_be_text(bytes),
                scale,
            ))
        }
        CqlValue::Date(d) => {
            let days = i64::from(d.0) - (1 << 31);
            chrono::NaiveDate::from_ymd_opt(1970, 1, 1)
                .and_then(|epoch| epoch.checked_add_signed(chrono::Duration::days(days)))
                .map(|date| serde_json::Value::String(date.format("%Y-%m-%d").to_string()))
                .unwrap_or_else(|| serde_json::Value::from(days))
        }
        CqlValue::Time(t) => chrono::NaiveTime::from_num_seconds_from_midnight_opt(
            (t.0 / 1_000_000_000) as u32,
            (t.0 % 1_000_000_000) as u32,
        )
        .map(|time| serde_json::Value::String(time.format("%H:%M:%S%.f").to_string()))
        .unwrap_or_else(|| serde_json::Value::from(t.0)),
        CqlValue::Duration(d) => {
            serde_json::Value::String(super::interval_text(d.months, d.days, d.nanoseconds))
        }
        CqlValue::SmallInt(i) => serde_json::Value::from(i),
        CqlValue::TinyInt(i) => serde_json::Value::from(i),
        CqlValue::Timestamp(ts) => serde_json::Value::String(
            chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ts.0)
                .map(|d| d.to_rfc3339())
                .unwrap_or_else(|| ts.0.to_string()),
        ),
        CqlValue::Inet(ip) => serde_json::Value::String(ip.to_string()),
        CqlValue::Uuid(u) => serde_json::Value::String(u.to_string()),
        CqlValue::Timeuuid(u) => serde_json::Value::String(u.to_string()),
        CqlValue::List(items) | CqlValue::Set(items) | CqlValue::Vector(items) => {
            serde_json::Value::Array(items.into_iter().map(|v| value_to_json(Some(v))).collect())
        }
        CqlValue::Map(pairs) => serde_json::Value::Object(
            pairs
                .into_iter()
                .map(|(k, v)| {
                    let key = match value_to_json(Some(k)) {
                        serde_json::Value::String(s) => s,
                        other => other.to_string(),
                    };
                    (key, value_to_json(Some(v)))
                })
                .collect(),
        ),
        CqlValue::Tuple(items) => {
            serde_json::Value::Array(items.into_iter().map(value_to_json).collect())
        }
        CqlValue::UserDefinedType { fields, .. } => serde_json::Value::Object(
            fields
                .into_iter()
                .map(|(k, v)| (k, value_to_json(v)))
                .collect(),
        ),
        CqlValue::Empty => serde_json::Value::String(String::new()),
        other => serde_json::Value::String(format!("{other:?}")),
    }
}

fn float_json(value: f64, shortest: String) -> serde_json::Value {
    if value.is_nan() {
        return serde_json::Value::String("NaN".into());
    }
    if value.is_infinite() {
        let text = if value > 0.0 { "Infinity" } else { "-Infinity" };
        return serde_json::Value::String(text.into());
    }
    shortest
        .parse::<f64>()
        .ok()
        .and_then(serde_json::Number::from_f64)
        .map(serde_json::Value::Number)
        .unwrap_or(serde_json::Value::String(shortest))
}

fn text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

struct CassandraUrl {
    nodes: Vec<String>,
    user: Option<(String, String)>,
    keyspace: Option<String>,
    tls: CassandraTls,
    datacenter: Option<String>,
    consistency: Option<Consistency>,
}

fn consistency(value: &str) -> Result<Consistency, String> {
    Ok(match value.to_ascii_lowercase().as_str() {
        "any" => Consistency::Any,
        "one" => Consistency::One,
        "two" => Consistency::Two,
        "three" => Consistency::Three,
        "quorum" => Consistency::Quorum,
        "all" => Consistency::All,
        "local_quorum" => Consistency::LocalQuorum,
        "each_quorum" => Consistency::EachQuorum,
        "local_one" => Consistency::LocalOne,
        "serial" => Consistency::Serial,
        "local_serial" => Consistency::LocalSerial,
        _ => {
            return Err(format!(
                "Unbekannte Konsistenzstufe „{value}“, z. B. local_quorum, quorum oder one."
            ))
        }
    })
}

fn parse_cassandra_url(value: &str) -> Result<CassandraUrl, String> {
    let url = url::Url::parse(value.trim()).map_err(|_| "Ungültige Cassandra-URL".to_string())?;
    if !matches!(url.scheme(), "cassandra" | "scylla" | "cql") {
        return Err("Eine cassandra:// URL ist erforderlich".to_string());
    }
    if url.path().contains(['@', ':']) {
        return Err("Sonderzeichen in Benutzer oder Passwort mit %-Kodierung schreiben (@ → %40, : → %3A, / → %2F).".into());
    }
    let host = url.host_str().ok_or("Host fehlt")?;
    let port = url.port().unwrap_or(9042);
    let mut nodes = vec![format!("{host}:{port}")];
    let mut tls = CassandraTls {
        host: host.trim_matches(['[', ']']).to_string(),
        ..CassandraTls::default()
    };
    let (mut datacenter, mut level) = (None, None);
    for (k, v) in url.query_pairs() {
        let text = || Some(v.to_string()).filter(|v| !v.is_empty());
        match k.to_ascii_lowercase().as_str() {
            "nodes" | "hosts" => nodes.extend(v.split(',').map(|n| {
                if n.contains(':') {
                    n.to_string()
                } else {
                    format!("{n}:{port}")
                }
            })),
            "sslmode" => {
                tls.mode = serde_json::from_value(serde_json::Value::String(v.to_string()))
                    .map_err(|_| "Ungültiger SSL-Modus".to_string())?
            }
            "ssl" | "tls" if matches!(v.as_ref(), "true" | "1") => {
                tls.mode = tls.mode.max(SslMode::Require)
            }
            "sslrootcert" => tls.root_cert = text(),
            "sslcert" => tls.cert = text(),
            "sslkey" => tls.key = text(),
            "datacenter" | "dc" | "local_dc" => datacenter = text(),
            "consistency" => level = Some(consistency(&v)?),
            other => {
                return Err(format!(
                    "Unbekannte Option „{other}“ in der Cassandra-URL. Möglich: nodes, sslmode, sslrootcert, sslcert, sslkey, datacenter, consistency."
                ))
            }
        }
    }
    let user = if url.username().is_empty() {
        None
    } else {
        Some((
            percent(url.username()),
            percent(url.password().unwrap_or("")),
        ))
    };
    let keyspace = Some(percent(url.path().trim_start_matches('/'))).filter(|k| !k.is_empty());
    Ok(CassandraUrl {
        nodes,
        user,
        keyspace,
        tls,
        datacenter,
        consistency: level,
    })
}

pub fn endpoint(value: &str) -> Result<super::endpoint::EndpointIdentity, String> {
    let parsed = parse_cassandra_url(value)?;
    let first = parsed.nodes.first().cloned().unwrap_or_default();
    let (host, port) = match first.rsplit_once(':') {
        Some((host, port)) => (host.to_string(), port.parse::<u16>().ok()),
        None => (first, None),
    };
    let extra = parsed
        .nodes
        .iter()
        .skip(1)
        .cloned()
        .collect::<Vec<_>>()
        .join(",");
    Ok(super::endpoint::EndpointIdentity {
        host: host.trim_matches(['[', ']']).to_ascii_lowercase(),
        port,
        transport: String::new(),
        tls: parsed.tls.mode >= SslMode::Require,
        verify: parsed.tls.mode >= SslMode::VerifyCa,
        database: parsed.keyspace.unwrap_or_default(),
        schema: String::new(),
        user: parsed.user.map(|(user, _)| user).unwrap_or_default(),
        params: super::endpoint::identity_params(&[("nodes", Some(extra))]),
    })
}

impl CassandraAdapter {
    pub fn new(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let CassandraUrl {
            nodes,
            user,
            keyspace,
            tls,
            datacenter,
            consistency,
        } = parse_cassandra_url(connection_string)?;
        Ok(Self {
            nodes,
            user,
            keyspace: database.map(str::to_string).or(keyspace),
            tls,
            datacenter,
            consistency,
            pool_state,
            key,
        })
    }

    async fn session(&self) -> Result<Arc<Session>, String> {
        let (nodes, user, keyspace) =
            (self.nodes.clone(), self.user.clone(), self.keyspace.clone());
        let (datacenter, level) = (self.datacenter.clone(), self.consistency);
        let tls = match self.tls.mode {
            SslMode::Disable | SslMode::Prefer => None,
            _ => Some(self.tls.client_config()?),
        };
        self.pool_state
            .shared(
                &format!(
                    "{}#connect-{}",
                    self.key,
                    super::execution::connection_duration().as_secs()
                ),
                || async move {
                    let reported = Arc::new(ReportedAddresses::default());
                    let mut profile = ExecutionProfile::builder();
                    if let Some(dc) = datacenter {
                        profile = profile.load_balancing_policy(
                            DefaultPolicy::builder().prefer_datacenter(dc).build(),
                        );
                    }
                    if let Some(level) = level {
                        profile = profile.consistency(level);
                    }
                    let mut builder = SessionBuilder::new()
                        .known_nodes(&nodes)
                        .address_translator(reported.clone())
                        .default_execution_profile_handle(profile.build().into_handle())
                        .connection_timeout(super::execution::connection_duration());
                    if let Some((u, p)) = user {
                        builder = builder.user(u, p);
                    }
                    if let Some(ks) = keyspace {
                        builder = builder.use_keyspace(ks, true);
                    }
                    let builder = builder.tls_context(tls);
                    super::execution::connect(async {
                        builder.build().await.map_err(|e| e.to_string())
                    })
                    .await
                    .map_err(|e| {
                        let seen = reported.0.lock().map(|s| s.clone()).unwrap_or_default();
                        connect_error(e, &nodes, &seen)
                    })
                },
            )
            .await
    }

    async fn scan(
        &self,
        cql: &str,
        mut on_row: impl FnMut(Row) -> bool + Send,
    ) -> Result<(Vec<String>, bool), String> {
        let session = self.session().await?;
        let mut statement = Statement::new(cql);
        statement.set_page_size(PAGE_SIZE);
        timed(async {
            let mut paging = PagingState::start();
            let mut columns = Vec::new();
            loop {
                let (result, response) = session
                    .query_single_page(statement.clone(), &[], paging)
                    .await
                    .map_err(map_err)?;
                for warning in result.warnings() {
                    super::server_output::emit(super::server_output::ServerMessage {
                        level: "WARNING".to_string(),
                        message: warning.to_string(),
                        detail: None,
                    });
                }
                let rows_result = match result.into_rows_result() {
                    Ok(r) => r,
                    Err(scylla::response::query_result::IntoRowsResultError::ResultNotRows(_)) => {
                        return Ok((columns, false))
                    }
                    Err(e) => return Err(map_err(e)),
                };
                if columns.is_empty() {
                    columns = super::unique_column_names(
                        rows_result
                            .column_specs()
                            .iter()
                            .map(|c| c.name().to_string())
                            .collect(),
                    );
                }
                for row in rows_result.rows::<Row>().map_err(map_err)? {
                    if !on_row(row.map_err(map_err)?) {
                        return Ok((columns, true));
                    }
                }
                match response {
                    PagingStateResponse::HasMorePages { state } => paging = state,
                    PagingStateResponse::NoMorePages => return Ok((columns, false)),
                }
            }
        })
        .await
    }

    async fn query_window(
        &self,
        cql: &str,
        skip: usize,
        take: usize,
    ) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>, bool), String> {
        let mut rows = Vec::new();
        let mut seen = 0usize;
        let (columns, more) = self
            .scan(cql, |row| {
                seen += 1;
                if seen <= skip {
                    return true;
                }
                if rows.len() >= take {
                    return false;
                }
                rows.push(row.columns.into_iter().map(value_to_json).collect());
                true
            })
            .await?;
        Ok((columns, rows, more))
    }

    async fn query(&self, cql: &str) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>), String> {
        self.query_window(cql, 0, usize::MAX)
            .await
            .map(|(columns, rows, _)| (columns, rows))
    }

    async fn exec(&self, cql: &str) -> Result<(), String> {
        self.query(cql).await.map(|_| ())
    }

    async fn columns_of(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let (_, rows) = self.query(&format!("SELECT column_name, type, kind, position, clustering_order FROM system_schema.columns WHERE keyspace_name = {} AND table_name = {}", lit(schema), lit(table))).await?;
        let mut columns: Vec<(i64, DetailedColumnInfo)> = rows
            .iter()
            .map(|r| {
                let kind = text(&r[2]);
                let rank = match kind.as_str() {
                    "partition_key" => 0,
                    "clustering" => 1,
                    _ => 2,
                };
                (
                    rank * 1000 + r[3].as_i64().unwrap_or(0),
                    DetailedColumnInfo {
                        name: text(&r[0]),
                        data_type: text(&r[1]),
                        is_nullable: rank == 2,
                        column_default: None,
                        is_primary_key: rank < 2,
                        ordinal_position: 0,
                        character_maximum_length: None,
                        comment: match kind.as_str() {
                            "partition_key" => Some("Partitionsschlüssel".to_string()),
                            "clustering" => {
                                Some(format!("Clustering {}", text(&r[4]).to_uppercase()))
                            }
                            "static" => Some("static".to_string()),
                            _ => None,
                        },
                    },
                )
            })
            .collect();
        columns.sort_by_key(|(rank, c)| (*rank, c.name.clone()));
        Ok(columns
            .into_iter()
            .enumerate()
            .map(|(i, (_, mut c))| {
                c.ordinal_position = i as i32 + 1;
                c
            })
            .collect())
    }

    fn keyspace_filter(&self, schema: Option<&str>) -> Result<String, String> {
        schema
            .map(str::to_string)
            .or_else(|| self.keyspace.clone())
            .ok_or_else(|| {
                "Kein Keyspace gewählt. In der URL nach dem Port angeben (…:9042/keyspace) oder mit -d.".to_string()
            })
    }
}

pub fn split_script(sql: &str) -> Vec<String> {
    let words = |statement: &str| -> Vec<String> {
        statement
            .split_whitespace()
            .map(str::to_ascii_uppercase)
            .collect()
    };
    let mut out = Vec::new();
    let mut batch: Vec<String> = Vec::new();
    for statement in super::sql_script::split(sql) {
        let w = words(&statement);
        let begins = w.first().is_some_and(|w| w == "BEGIN")
            && w.iter().take(3).skip(1).any(|w| w == "BATCH");
        if batch.is_empty() && !begins {
            out.push(statement);
            continue;
        }
        batch.push(statement);
        if w.len() >= 2 && w[w.len() - 2..] == ["APPLY", "BATCH"] {
            out.push(batch.join(";\n"));
            batch.clear();
        }
    }
    if !batch.is_empty() {
        out.push(batch.join(";\n"));
    }
    out
}

fn index_column(target: &str) -> String {
    let inner = target
        .split_once('(')
        .and_then(|(_, rest)| rest.strip_suffix(')'))
        .unwrap_or(target);
    let inner = inner.trim();
    inner
        .strip_prefix('"')
        .and_then(|i| i.strip_suffix('"'))
        .map(|i| i.replace("\"\"", "\""))
        .unwrap_or_else(|| inner.to_string())
}

fn percent(value: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", value.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| value.to_string())
}

fn with_filtering(sql: String, has_filter: bool) -> String {
    if has_filter {
        super::server_output::emit(super::server_output::ServerMessage {
            level: "INFO".into(),
            message: "Filter läuft mit ALLOW FILTERING und kann alle Knoten lesen.".into(),
            detail: None,
        });
        format!("{sql} ALLOW FILTERING")
    } else {
        sql
    }
}

#[async_trait]
impl DatabaseAdapter for CassandraAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.exec("SELECT release_version FROM system.local").await
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let (_, rows) = self.query("SELECT cluster_name FROM system.local").await?;
        Ok(rows.iter().map(|r| text(&r[0])).collect())
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        let (_, rows) = self
            .query("SELECT keyspace_name FROM system_schema.keyspaces")
            .await?;
        let mut names: Vec<String> = rows.iter().map(|r| text(&r[0])).collect();
        names.sort_by_key(|k| (k.starts_with("system"), k.clone()));
        Ok(names)
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let ks = self.keyspace_filter(schema)?;
        let (_, rows) = self
            .query(&format!(
                "SELECT table_name FROM system_schema.tables WHERE keyspace_name = {}",
                lit(&ks)
            ))
            .await?;
        if rows.is_empty() {
            let (_, found) = self
                .query(&format!(
                    "SELECT keyspace_name FROM system_schema.keyspaces WHERE keyspace_name = {}",
                    lit(&ks)
                ))
                .await?;
            if found.is_empty() {
                return Err(format!("Keyspace {ks} gibt es nicht."));
            }
        }
        let mut tables: Vec<TableInfo> = rows
            .iter()
            .map(|r| TableInfo {
                schema: ks.clone(),
                name: text(&r[0]),
            })
            .collect();
        tables.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(tables)
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let ks = self.keyspace_filter(schema)?;
        let (_, rows) = self
            .query(&format!(
                "SELECT view_name FROM system_schema.views WHERE keyspace_name = {}",
                lit(&ks)
            ))
            .await?;
        let mut views: Vec<TableInfo> = rows
            .iter()
            .map(|r| TableInfo {
                schema: ks.clone(),
                name: text(&r[0]),
            })
            .collect();
        views.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(views)
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
            return Ok(vec![]);
        }
        let ks = self.keyspace_filter(schema)?;
        let mut cql = format!("SELECT table_name, column_name, type FROM system_schema.columns WHERE keyspace_name = {}", lit(&ks));
        if let Some(t) = table {
            cql.push_str(&format!(" AND table_name = {}", lit(t)));
        }
        let (_, rows) = self.query(&cql).await?;
        let mut out: Vec<ColumnInfo> = rows
            .iter()
            .map(|r| ColumnInfo {
                schema: ks.clone(),
                table: text(&r[0]),
                name: text(&r[1]),
                data_type: text(&r[2]),
            })
            .collect();
        out.sort_by(|a, b| (&a.table, &a.name).cmp(&(&b.table, &b.name)));
        Ok(out)
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let mut columns = self.columns_of(schema, table).await?;
        for index in self.list_indexes(schema, table).await? {
            let target = index
                .columns
                .first()
                .map(|t| index_column(t))
                .unwrap_or_default();
            if let Some(column) = columns.iter_mut().find(|c| c.name == target) {
                let label = format!("Index {}", index.name);
                column.comment = Some(match column.comment.take() {
                    Some(role) => format!("{role}, {label}"),
                    None => label,
                });
            }
        }
        Ok(columns)
    }

    async fn fetch_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        limit: i64,
        offset: i64,
        order_by: Option<&str>,
        order_desc: bool,
        _is_view: bool,
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let where_sql = cql_where(filter, allow_raw_filter)?;
        let order_sql = order_by
            .map(|column| {
                format!(
                    " ORDER BY {} {}",
                    quote(column),
                    if order_desc { "DESC" } else { "ASC" }
                )
            })
            .unwrap_or_default();
        let columns: Vec<String> = self
            .columns_of(schema, table)
            .await?
            .into_iter()
            .map(|c| c.name)
            .collect();
        let (limit, offset) = (limit.max(0) as usize, offset.max(0) as usize);
        let cql = with_filtering(
            format!(
                "SELECT * FROM {}.{}{}{} LIMIT {}",
                quote(schema),
                quote(table),
                where_sql,
                order_sql,
                (limit + offset).max(1)
            ),
            !where_sql.is_empty(),
        );
        let (cols, page, _) = self.query_window(&cql, offset, limit).await?;
        Ok(TableData {
            columns: if columns.is_empty() {
                cols.clone()
            } else {
                columns
            },
            rows: rows_to_objects(&cols, page),
        })
    }

    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let where_sql = cql_where(filter, allow_raw_filter)?;
        let cql = with_filtering(
            format!(
                "SELECT COUNT(*) FROM {}.{}{}",
                quote(schema),
                quote(table),
                where_sql
            ),
            !where_sql.is_empty(),
        );
        let (_, rows) = self.query(&cql).await?;
        Ok(rows.first().and_then(|r| r[0].as_i64()).unwrap_or(0))
    }

    async fn count_rows_capped(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
        cap: i64,
    ) -> Result<RowCount, String> {
        let where_sql = cql_where(filter, allow_raw_filter)?;
        let key = self
            .columns_of(schema, table)
            .await?
            .into_iter()
            .find(|c| c.is_primary_key)
            .map(|c| quote(&c.name))
            .unwrap_or_else(|| "*".to_string());
        let cql = with_filtering(
            format!(
                "SELECT {key} FROM {}.{}{}",
                quote(schema),
                quote(table),
                where_sql
            ),
            !where_sql.is_empty(),
        );
        let mut count = 0i64;
        let (_, more) = self
            .scan(&cql, |_| {
                count += 1;
                count <= cap
            })
            .await?;
        Ok(if more {
            RowCount {
                count: cap.saturating_add(1),
                exact: false,
                estimate: None,
            }
        } else {
            RowCount::exact(count)
        })
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let first = sql
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_ascii_uppercase();
        if CQLSH_ONLY.contains(&first.as_str()) {
            return Err(format!(
                "{first} ist ein cqlsh-Befehl, kein CQL.{}",
                if first == "CONSISTENCY" || first == "SERIAL" {
                    " Konsistenz über ?consistency= in der URL setzen."
                } else {
                    ""
                }
            ));
        }
        let (columns, rows, truncated) = self
            .query_window(
                sql.trim().trim_end_matches(';'),
                0,
                super::execution::row_limit(),
            )
            .await?;
        Ok(QueryResult {
            rows: rows_to_objects(&columns, rows),
            columns,
            rows_affected: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            truncated,
        })
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!("DROP TABLE {}.{}", quote(schema), quote(table)))
            .await
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!("TRUNCATE {}.{}", quote(schema), quote(table)))
            .await
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        let pk: Vec<String> = req
            .columns
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| quote(&c.name))
            .collect();
        if pk.is_empty() {
            return Err("CQL-Tabellen benötigen einen Primary Key".to_string());
        }
        let columns: Vec<String> = req
            .columns
            .iter()
            .map(|c| format!("{} {}", quote(&c.name), c.data_type))
            .collect();
        let cql = format!(
            "CREATE TABLE {}{}.{} ({}, PRIMARY KEY ({}))",
            if req.if_not_exists {
                "IF NOT EXISTS "
            } else {
                ""
            },
            quote(&req.schema),
            quote(&req.name),
            columns.join(", "),
            pk.join(", ")
        );
        self.exec(&cql).await
    }

    async fn add_column(
        &self,
        schema: &str,
        table: &str,
        column: &AddColumnRequest,
    ) -> Result<(), String> {
        if !column.is_nullable
            || column
                .default_value
                .as_deref()
                .is_some_and(|d| !d.trim().is_empty())
        {
            return Err(unsupported("NOT NULL und Standardwerte für Spalten"));
        }
        self.exec(&format!(
            "ALTER TABLE {}.{} ADD {} {}",
            quote(schema),
            quote(table),
            quote(&column.name),
            column.data_type
        ))
        .await
    }

    async fn alter_column(
        &self,
        schema: &str,
        table: &str,
        changes: &AlterColumnRequest,
    ) -> Result<(), String> {
        if changes.data_type.is_some()
            || changes.set_not_null.is_some()
            || changes.new_default.is_some()
            || changes.drop_default
        {
            return Err(unsupported("Typänderungen, NULL-Regeln und Defaults"));
        }
        let Some(new_name) = changes.new_name.as_deref().filter(|n| !n.is_empty()) else {
            return Ok(());
        };
        self.exec(&format!(
            "ALTER TABLE {}.{} RENAME {} TO {}",
            quote(schema),
            quote(table),
            quote(&changes.old_name),
            quote(new_name)
        ))
        .await
    }

    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String> {
        self.exec(&format!(
            "ALTER TABLE {}.{} DROP {}",
            quote(schema),
            quote(table),
            quote(column)
        ))
        .await
    }

    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let (_, rows) = self.query(&format!("SELECT index_name, kind, options FROM system_schema.indexes WHERE keyspace_name = {} AND table_name = {}", lit(schema), lit(table))).await?;
        Ok(rows
            .iter()
            .map(|r| {
                let target = r[2].get("target").map(text).unwrap_or_default();
                IndexInfo {
                    name: text(&r[0]),
                    is_unique: false,
                    is_primary: false,
                    columns: vec![target.clone()],
                    index_type: text(&r[1]).to_lowercase(),
                    definition: format!(
                        "CREATE INDEX {} ON {}.{} ({target})",
                        text(&r[0]),
                        schema,
                        table
                    ),
                }
            })
            .collect())
    }

    async fn create_schema(&self, name: &str) -> Result<(), String> {
        self.exec(&format!("CREATE KEYSPACE {} WITH replication = {{'class': 'SimpleStrategy', 'replication_factor': 1}}", quote(name))).await
    }

    async fn drop_schema(&self, name: &str, _cascade: bool) -> Result<(), String> {
        self.exec(&format!("DROP KEYSPACE {}", quote(name))).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn live_tls_modes() {
        let dir = std::env::var("L8DB_E2E_PG_TLS_DIR").unwrap_or_else(|_| "/tmp/l8db-pgtls".into());
        let port = std::env::var("L8DB_E2E_CASSANDRA_TLS_PORT").unwrap_or_else(|_| "9042".into());
        let connect = |host: &str, query: String| {
            let url = format!("cassandra://{host}:{port}?{query}");
            async move {
                CassandraAdapter::new(
                    &url,
                    None,
                    crate::db::pool::create_pool_state(),
                    url.clone(),
                )?
                .test_connection()
                .await
            }
        };
        let ca = format!("sslrootcert={dir}/ca.pem");
        assert_eq!(connect("127.0.0.1", "sslmode=require".into()).await, Ok(()));
        assert_eq!(connect("127.0.0.1", "ssl=true".into()).await, Ok(()));
        assert!(connect("127.0.0.1", "sslmode=disable".into())
            .await
            .is_err());
        assert!(connect("localhost", "sslmode=verify-full".into())
            .await
            .is_err());
        assert_eq!(
            connect("localhost", format!("sslmode=verify-full&{ca}")).await,
            Ok(())
        );
        assert!(connect("127.0.0.1", format!("sslmode=verify-full&{ca}"))
            .await
            .is_err());
        assert_eq!(
            connect("127.0.0.1", format!("sslmode=verify-ca&{ca}")).await,
            Ok(())
        );
        assert_eq!(
            connect(
                "localhost",
                format!(
                    "sslmode=verify-full&{ca}&sslcert={dir}/client.pem&sslkey={dir}/client.key"
                )
            )
            .await,
            Ok(())
        );
        assert!(connect(
            "127.0.0.1",
            format!("sslmode=require&sslcert={dir}/client.pem")
        )
        .await
        .unwrap_err()
        .contains("gemeinsam"));
    }

    #[tokio::test]
    #[ignore]
    async fn live_response_warnings_are_captured() {
        use crate::db::server_output::{capture, Messages};
        let url = std::env::var("L8DB_E2E_CASSANDRA_URL")
            .unwrap_or_else(|_| "cassandra://127.0.0.1:9042".into());
        let db = CassandraAdapter::new(
            &url,
            None,
            crate::db::pool::create_pool_state(),
            "warn".into(),
        )
        .unwrap();
        db.exec("CREATE KEYSPACE IF NOT EXISTS l8db_live WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}").await.unwrap();
        db.exec("CREATE TABLE IF NOT EXISTS l8db_live.w (id int PRIMARY KEY)")
            .await
            .unwrap();
        db.exec("INSERT INTO l8db_live.w (id) VALUES (1)")
            .await
            .unwrap();
        let sink = Messages::default();
        capture(
            sink.clone(),
            db.execute_query("SELECT id FROM l8db_live.w WHERE id = 1"),
        )
        .await
        .unwrap();
        assert!(sink.take().is_empty());
        capture(
            sink.clone(),
            db.execute_query("SELECT COUNT(*) FROM l8db_live.w"),
        )
        .await
        .unwrap();
        let messages = sink.take();
        assert_eq!(messages.len(), 1, "{messages:?}");
        assert_eq!(messages[0].level, "WARNING");
        assert!(
            messages[0].message.contains("partition key"),
            "{messages:?}"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn live_values_paging_and_capped_count() {
        let url = std::env::var("L8DB_E2E_CASSANDRA_URL")
            .unwrap_or_else(|_| "cassandra://127.0.0.1:9042".into());
        let db = CassandraAdapter::new(
            &url,
            None,
            crate::db::pool::create_pool_state(),
            "live".into(),
        )
        .unwrap();
        db.exec("CREATE KEYSPACE IF NOT EXISTS l8db_live WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}").await.unwrap();
        db.exec("DROP TABLE IF EXISTS l8db_live.t").await.unwrap();
        db.exec("CREATE TABLE l8db_live.t (id int PRIMARY KEY, big varint, price decimal, day date, at time, span duration, n bigint)").await.unwrap();
        db.exec("INSERT INTO l8db_live.t (id, big, price, day, at, span, n) VALUES (0, 123456789012345678901234567890, 12345678901234567890.125, '2024-01-02', '13:14:15.5', 1mo2d3h, 9007199254740993)").await.unwrap();
        for id in 1..2501 {
            db.exec(&format!(
                "INSERT INTO l8db_live.t (id, price) VALUES ({id}, 1.50)"
            ))
            .await
            .unwrap();
        }
        let row = db
            .execute_query("SELECT big, price, day, at, span, n FROM l8db_live.t WHERE id = 0")
            .await
            .unwrap()
            .rows
            .remove(0);
        assert_eq!(
            row["big"],
            serde_json::json!("123456789012345678901234567890")
        );
        assert_eq!(row["price"], serde_json::json!("12345678901234567890.125"));
        assert_eq!(row["day"], serde_json::json!("2024-01-02"));
        assert_eq!(row["at"], serde_json::json!("13:14:15.500"));
        assert_eq!(row["span"], serde_json::json!("1 month 2 days 03:00:00"));
        assert_eq!(row["n"], serde_json::json!("9007199254740993"));
        let all = db
            .execute_query("SELECT id FROM l8db_live.t")
            .await
            .unwrap();
        assert_eq!(all.rows.len(), 2501);
        assert!(!all.truncated);
        let page = db
            .fetch_rows("l8db_live", "t", None, 10, 2000, None, false, false, false)
            .await
            .unwrap();
        assert_eq!(page.rows.len(), 10);
        let capped = db
            .count_rows_capped("l8db_live", "t", None, false, 1500)
            .await
            .unwrap();
        assert_eq!((capped.count, capped.exact), (1501, false));
        let exact = db
            .count_rows_capped("l8db_live", "t", None, false, 5000)
            .await
            .unwrap();
        assert_eq!((exact.count, exact.exact), (2501, true));
        db.exec("DROP KEYSPACE l8db_live").await.unwrap();
    }

    #[test]
    fn floats_keep_special_values_and_shortest_text() {
        assert_eq!(
            value_to_json(Some(CqlValue::Float(0.1))),
            serde_json::json!(0.1)
        );
        assert_eq!(
            value_to_json(Some(CqlValue::Double(0.1))),
            serde_json::json!(0.1)
        );
        assert_eq!(
            value_to_json(Some(CqlValue::Float(f32::NAN))),
            serde_json::json!("NaN")
        );
        assert_eq!(
            value_to_json(Some(CqlValue::Double(f64::NEG_INFINITY))),
            serde_json::json!("-Infinity")
        );
        assert_eq!(
            value_to_json(Some(CqlValue::Float(f32::INFINITY))),
            serde_json::json!("Infinity")
        );
    }

    #[test]
    fn driver_errors_become_short_german_messages() {
        let cases = [
            ("Database returned an error: The query is syntactically correct but invalid, Error message: Undefined column name nope in table cas_shop.bulk", "Spalte nope gibt es in cas_shop.bulk nicht."),
            ("Database returned an error: The query is syntactically correct but invalid, Error message: Invalid STRING constant (x) for \"pk\" of type int", "Wert x passt nicht zum Typ int der Spalte pk."),
            ("Database returned an error: The submitted query has a syntax error, Error message: line 1:45 no viable alternative at input 'OR'", "CQL kennt kein OR. IN (…) oder getrennte Abfragen verwenden."),
            ("Failed to perform initial cluster metadata fetch: Control connection pool error: The pool is broken; Last connection failed with: Failed to perform a connection setup request. Request: AUTH_RESPONSE, reason: Authentication is required. You can use SessionBuilder::user(\"user\", \"pass\")", "Cassandra verlangt eine Anmeldung. Zugangsdaten in der URL angeben: cassandra://BENUTZER:PASSWORT@host:port/keyspace"),
            ("reason: Database returned an error: Authentication failed - bad credentials, Error message: Provided username cassandra and/or password are incorrect", "Cassandra: Benutzer oder Passwort falsch."),
            ("'USE KEYSPACE <>' request failed: Database returned an error: The query is syntactically correct but invalid, Error message: Keyspace 'nokeyspace' does not exist", "Keyspace nokeyspace gibt es nicht."),
            ("Last connection failed with: received corrupt message of type InvalidContentType", "Der Server spricht kein TLS. Mit sslmode=disable verbinden oder TLS am Server aktivieren."),
            ("Database returned an error: The submitted query has a syntax error, Error message: line 1:0 no viable alternative at input 'FOO'", "CQL-Syntaxfehler: no viable alternative at input 'FOO'"),
        ];
        for (raw, expected) in cases {
            assert_eq!(friendly(raw), expected);
        }
        let nodes = vec!["127.0.0.1:19999".to_string()];
        assert_eq!(
            connect_error(
                "Last connection failed with: Connection refused (os error 61)".into(),
                &nodes,
                &[]
            ),
            "Kein Cassandra auf 127.0.0.1:19999. Host und Port prüfen."
        );
        let reported = ["172.17.0.2:9042".parse().unwrap()];
        assert!(connect_error(
            "Verbindungs-Timeout nach 15 Sekunden".into(),
            &nodes,
            &reported
        )
        .contains("Knoten meldet 172.17.0.2:9042"));
    }

    #[test]
    fn filters_and_scripts() {
        assert_eq!(
            cql_where(Some("ck > 1 allow  Filtering"), false).unwrap(),
            " WHERE ck > 1"
        );
        assert_eq!(cql_where(Some("ck > 1"), false).unwrap(), " WHERE ck > 1");
        assert_eq!(
            split_script("BEGIN BATCH INSERT INTO t (a) VALUES (1); INSERT INTO t (a) VALUES (2); APPLY BATCH; SELECT * FROM t"),
            vec![
                "BEGIN BATCH INSERT INTO t (a) VALUES (1);\nINSERT INTO t (a) VALUES (2);\nAPPLY BATCH",
                "SELECT * FROM t"
            ]
        );
        assert_eq!(split_script("SELECT 1; SELECT 2").len(), 2);
        assert!(friendly("Load balancing policy returned an empty plan.").contains("?datacenter="));
        assert_eq!(index_column("values(\"Tags\")"), "Tags");
        assert_eq!(index_column("v"), "v");
    }

    #[test]
    fn url_options_are_checked() {
        let parsed =
            parse_cassandra_url("cassandra://h:9042/ks?datacenter=dc2&consistency=LOCAL_ONE")
                .unwrap();
        assert_eq!(parsed.datacenter.as_deref(), Some("dc2"));
        assert_eq!(parsed.consistency, Some(Consistency::LocalOne));
        assert!(parse_cassandra_url("cassandra://h/ks?datacentre=x")
            .err()
            .unwrap()
            .contains("Unbekannte Option „datacentre“"));
        assert!(parse_cassandra_url("cassandra://h/ks?consistency=most")
            .err()
            .unwrap()
            .contains("Konsistenzstufe"));
        assert!(
            parse_cassandra_url("cassandra://u:p@ss:1/x@127.0.0.1:19042/ks")
                .err()
                .unwrap()
                .contains("%40")
        );
        let switched = CassandraAdapter::new(
            "cassandra://h/ks",
            Some("other"),
            crate::db::pool::create_pool_state(),
            "k".into(),
        )
        .unwrap();
        assert_eq!(switched.keyspace.as_deref(), Some("other"));
    }

    #[tokio::test]
    #[ignore]
    async fn live_all_rows_order_views_and_roles() {
        use crate::db::execution::with_row_limit;
        let url = std::env::var("L8DB_E2E_CASSANDRA_URL")
            .unwrap_or_else(|_| "cassandra://127.0.0.1:9042".into());
        let db = CassandraAdapter::new(
            &url,
            None,
            crate::db::pool::create_pool_state(),
            "all".into(),
        )
        .unwrap();
        db.exec("CREATE KEYSPACE IF NOT EXISTS l8db_live2 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}").await.unwrap();
        db.exec("DROP TABLE IF EXISTS l8db_live2.many")
            .await
            .unwrap();
        db.exec("CREATE TABLE l8db_live2.many (p int, c int, f float, d double, s text static, PRIMARY KEY (p, c)) WITH CLUSTERING ORDER BY (c DESC)").await.unwrap();
        db.exec("CREATE INDEX many_f ON l8db_live2.many (f)")
            .await
            .unwrap();
        for chunk in 0..120 {
            let inserts: Vec<String> = (0..100)
                .map(|i| {
                    let id = chunk * 100 + i;
                    format!(
                        "INSERT INTO l8db_live2.many (p, c) VALUES ({}, {id})",
                        id % 10
                    )
                })
                .collect();
            for statement in split_script(&format!(
                "BEGIN UNLOGGED BATCH {}; APPLY BATCH",
                inserts.join("; ")
            )) {
                db.exec(&statement).await.unwrap();
            }
        }
        db.exec("INSERT INTO l8db_live2.many (p, c, f, d) VALUES (-1, 1, NaN, -Infinity)")
            .await
            .unwrap();
        db.exec("INSERT INTO l8db_live2.many (p, c, f, d) VALUES (-1, 2, 0.1, 0.1)")
            .await
            .unwrap();
        let started = std::time::Instant::now();
        let all = with_row_limit(
            usize::MAX,
            db.execute_query("SELECT p, c FROM l8db_live2.many"),
        )
        .await
        .unwrap();
        eprintln!(
            "query --all: {} Zeilen in {} ms",
            all.rows.len(),
            started.elapsed().as_millis()
        );
        assert_eq!(all.rows.len(), 12_002);
        assert!(!all.truncated);
        let capped = with_row_limit(1001, db.execute_query("SELECT p, c FROM l8db_live2.many"))
            .await
            .unwrap();
        assert_eq!(capped.rows.len(), 1001);
        assert!(capped.truncated);
        let special = db
            .execute_query("SELECT c, f, d FROM l8db_live2.many WHERE p = -1")
            .await
            .unwrap();
        assert_eq!(special.rows[0]["f"], serde_json::json!(0.1));
        assert_eq!(special.rows[1]["f"], serde_json::json!("NaN"));
        assert_eq!(special.rows[1]["d"], serde_json::json!("-Infinity"));
        let asc = db
            .fetch_rows(
                "l8db_live2",
                "many",
                Some("p = 1"),
                3,
                0,
                Some("c"),
                false,
                false,
                false,
            )
            .await
            .unwrap();
        let values: Vec<i64> = asc.rows.iter().map(|r| r["c"].as_i64().unwrap()).collect();
        assert_eq!(values, vec![1, 11, 21]);
        let filtered = db
            .fetch_rows(
                "l8db_live2",
                "many",
                Some("c > 11990 ALLOW FILTERING"),
                20,
                0,
                None,
                false,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(filtered.rows.len(), 9);
        let unordered = db
            .fetch_rows(
                "l8db_live2",
                "many",
                None,
                3,
                0,
                Some("c"),
                true,
                false,
                false,
            )
            .await
            .unwrap_err();
        assert!(unordered.contains("Partitionsschlüssel"), "{unordered}");
        let columns = db
            .list_table_columns_detailed("l8db_live2", "many")
            .await
            .unwrap();
        let roles: Vec<(String, Option<String>)> = columns
            .iter()
            .map(|c| (c.name.clone(), c.comment.clone()))
            .collect();
        assert_eq!(roles[0], ("p".into(), Some("Partitionsschlüssel".into())));
        assert_eq!(roles[1], ("c".into(), Some("Clustering DESC".into())));
        assert!(
            roles.contains(&("f".into(), Some("Index many_f".into()))),
            "{roles:?}"
        );
        assert!(
            roles.contains(&("s".into(), Some("static".into()))),
            "{roles:?}"
        );
        match db.exec("CREATE MATERIALIZED VIEW IF NOT EXISTS l8db_live2.many_by_c AS SELECT p, c FROM l8db_live2.many WHERE p IS NOT NULL AND c IS NOT NULL PRIMARY KEY (c, p)").await {
            Ok(()) => {
                let views = db.list_views(Some("l8db_live2")).await.unwrap();
                assert_eq!(views.len(), 1);
                assert_eq!(views[0].name, "many_by_c");
                assert!(!db.list_table_columns_detailed("l8db_live2", "many_by_c").await.unwrap().is_empty());
            }
            Err(e) => eprintln!("Materialized Views übersprungen: {e}"),
        }
        assert_eq!(
            db.list_tables(Some("l8db_nope")).await.unwrap_err(),
            "Keyspace l8db_nope gibt es nicht."
        );
        db.exec("DROP KEYSPACE l8db_live2").await.unwrap();
    }

    #[test]
    fn parses_nodes_and_keyspace() {
        let a = CassandraAdapter::new(
            "cassandra://cassandra:pw@node1:9042/app?nodes=node2,node3:9043",
            None,
            crate::db::pool::create_pool_state(),
            "k".into(),
        )
        .unwrap();
        assert_eq!(a.nodes, vec!["node1:9042", "node2:9042", "node3:9043"]);
        assert_eq!(a.keyspace.as_deref(), Some("app"));
        assert_eq!(a.user, Some(("cassandra".to_string(), "pw".to_string())));
        assert_eq!(
            with_filtering("SELECT 1".into(), true),
            "SELECT 1 ALLOW FILTERING"
        );
    }
}
