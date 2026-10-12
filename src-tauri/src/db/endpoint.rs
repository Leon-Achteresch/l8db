use serde::{Deserialize, Serialize};

use super::provider::DatabaseKind;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndpointIdentity {
    pub host: String,
    pub port: Option<u16>,
    pub transport: String,
    pub tls: bool,
    pub verify: bool,
    pub database: String,
    pub schema: String,
    pub user: String,
    pub params: Vec<(String, String)>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct EndpointRequest {
    pub kind: DatabaseKind,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EndpointResult {
    pub identity: Option<EndpointIdentity>,
    pub error: Option<String>,
}

pub const MAX_ENDPOINT_REQUESTS: usize = 20_000;

pub fn host_of(url: &url::Url) -> String {
    url.host_str()
        .unwrap_or_default()
        .trim_matches(['[', ']'])
        .to_ascii_lowercase()
}

pub fn identity_params(pairs: &[(&str, Option<String>)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .filter_map(|(key, value)| {
            value
                .as_ref()
                .filter(|v| !v.is_empty())
                .map(|v| (key.to_string(), v.clone()))
        })
        .collect()
}

pub fn resolve(kind: DatabaseKind, url: &str) -> Result<EndpointIdentity, String> {
    match kind {
        DatabaseKind::Postgres => super::connection::endpoint(url),
        DatabaseKind::Mysql => super::mysql::endpoint(url),
        DatabaseKind::Mssql => super::mssql::endpoint(url),
        DatabaseKind::Cassandra => super::cassandra::endpoint(url),
        DatabaseKind::Clickhouse => super::clickhouse::endpoint(url),
        DatabaseKind::Elasticsearch => super::elasticsearch::endpoint(url),
        DatabaseKind::Influxdb => super::influxdb::endpoint(url),
        DatabaseKind::Redis => super::redis::endpoint(url),
        DatabaseKind::Mongodb => super::mongodb::endpoint(url),
        DatabaseKind::Oracle => super::oracle::endpoint(url),
        DatabaseKind::Snowflake => super::snowflake::endpoint(url),
        DatabaseKind::Bigquery => super::bigquery::endpoint(url),
        DatabaseKind::Athena => super::athena::endpoint(url),
        DatabaseKind::Dynamodb => super::dynamodb::endpoint(url),
        other => Err(format!("Für {other:?} gibt es keine Endpunkt-Auflösung.")),
    }
}

pub fn resolve_all(requests: &[EndpointRequest]) -> Result<Vec<EndpointResult>, String> {
    if requests.len() > MAX_ENDPOINT_REQUESTS {
        return Err(format!(
            "Zu viele Verbindungen ({}, maximal {MAX_ENDPOINT_REQUESTS}).",
            requests.len()
        ));
    }
    Ok(requests
        .iter()
        .map(|request| match resolve(request.kind, &request.url) {
            Ok(identity) => EndpointResult {
                identity: Some(identity),
                error: None,
            },
            Err(error) => EndpointResult {
                identity: None,
                error: Some(error),
            },
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Instant;

    fn ok(kind: DatabaseKind, url: &str) -> EndpointIdentity {
        resolve(kind, url).unwrap_or_else(|error| panic!("{url}: {error}"))
    }

    fn summary(kind: DatabaseKind, url: &str) -> (String, Option<u16>, bool, bool) {
        let identity = ok(kind, url);
        (identity.host, identity.port, identity.tls, identity.verify)
    }

    #[test]
    fn clickhouse_follows_adapter_parsing() {
        use DatabaseKind::Clickhouse as C;
        assert_eq!(
            summary(C, "clickhouse://u@ch/db"),
            ("ch".into(), Some(8123), false, false)
        );
        assert_eq!(
            summary(C, "clickhouse://u@ch:8443/db"),
            ("ch".into(), Some(8443), true, true)
        );
        assert_eq!(
            summary(C, "http://u@ch:443/db"),
            ("ch".into(), Some(443), true, true)
        );
        assert_eq!(
            summary(C, "https://u@ch/db"),
            ("ch".into(), Some(8443), true, true)
        );
        assert_eq!(summary(C, "https://u@ch:443/db").1, Some(443));
        assert_eq!(
            summary(C, "http://u@ch:80/db"),
            ("ch".into(), Some(80), false, false)
        );
        assert_eq!(summary(C, "http://u@ch/db").1, Some(8123));
        assert!(!ok(C, "clickhouse://ch:8443/db?secure=1&ssl=false").tls);
        assert!(ok(C, "clickhouse://ch/db?ssl=false&secure=1").tls);
        assert!(!ok(C, "clickhouse://ch/db?secure=on").tls);
        assert!(!ok(C, "clickhouse://ch/db?SECURE=1").tls);
        assert!(!ok(C, "clickhouse://ch/db?tls=true").tls);
        assert!(ok(C, "clickhouse://ch/db?sslmode=allow").tls);
        assert!(!ok(C, "clickhouse://ch/db?sslmode=prefer").tls);
        assert!(ok(C, "clickhouse://ch/db?sslmode=DISABLE").tls);
        assert_eq!(ok(C, "clickhouse://ch").database, "default");
    }

    #[test]
    fn http_families_follow_http_api() {
        use DatabaseKind::{Elasticsearch as E, Influxdb as I};
        assert_eq!(
            summary(E, "elasticsearch://u@es"),
            ("es".into(), Some(9200), false, false)
        );
        assert_eq!(
            summary(E, "elasticsearch://u@es:9243"),
            ("es".into(), Some(9243), true, true)
        );
        assert_eq!(
            summary(E, "https://u@es"),
            ("es".into(), Some(443), true, true)
        );
        assert_eq!(
            summary(E, "http://u@es:80"),
            ("es".into(), Some(80), false, false)
        );
        assert_eq!(summary(E, "http://u@es").1, Some(9200));
        assert_eq!(summary(I, "http://i:80").1, Some(80));
        assert!(!ok(E, "https://es?ssl=false").tls);
        assert!(!ok(E, "https://es?sslmode=disable").tls);
        assert!(!ok(E, "https://es?sslmode=DISABLE").tls);
        assert!(ok(E, "https://es?sslmode=prefer").tls);
        assert!(!ok(E, "elasticsearch://es?tls=false&ssl=true").tls);
        assert!(ok(E, "elasticsearch://es?SSL=1").tls);
        assert!(ok(E, "elasticsearch://es?ssl=1").tls);
        assert!(!ok(E, "elasticsearch://es?ssl=true&insecure=true").verify);
        assert!(ok(E, "elasticsearch://x.es.io.elastic-cloud.com").tls);
        assert_eq!(
            summary(I, "influxdb://i"),
            ("i".into(), Some(8086), false, false)
        );
        assert!(ok(I, "influxdb://abc.influxdata.com").tls);
        assert_eq!(
            ok(I, "influxdb://token@i/metrics?org=o").database,
            "metrics"
        );
        assert_eq!(
            ok(I, "influxdb://i?orgID=x&version=3").params,
            vec![("org".into(), "x".into()), ("version".into(), "3".into())]
        );
    }

    #[test]
    fn libpq_families_follow_their_parsers() {
        use DatabaseKind::{Cassandra, Mssql, Mysql, Postgres};
        let pg = ok(
            Postgres,
            "postgres://U@DB.example.com/app?sslmode=verify-ca&hostaddr=10.0.0.1",
        );
        assert_eq!(
            (pg.host.as_str(), pg.port, pg.tls, pg.verify),
            ("db.example.com", Some(5432), true, true)
        );
        assert_eq!(pg.params, vec![("hostaddr".into(), "10.0.0.1".into())]);
        assert!(resolve(Postgres, "postgresql://u@db/app?sslmode=DISABLE").is_err());
        assert!(!ok(Postgres, "postgresql://u@db/app?sslmode=allow").tls);
        assert!(
            ok(
                Postgres,
                "postgresql://u@db/app?sslmode=prefer&sslmode=require"
            )
            .tls
        );
        let my = ok(Mysql, "mysql://u@db/app?useSSL=true&requireSSL=true");
        assert!(my.tls && !my.verify);
        assert!(!ok(Mysql, "mysql://u@db/app?requireSSL=true&useSSL=false").tls);
        assert!(ok(Mysql, "mysql://u@db/app?useSSL=false&requireSSL=true").tls);
        assert!(ok(Mysql, "mysql://u@db/app?sslMode=VERIFY_IDENTITY").verify);
        assert_eq!(ok(Mysql, "mariadb://u@db:3307/app").port, Some(3307));
        let ms = ok(
            Mssql,
            "mssql://sa@db/erp?encrypt=true&trust_server_certificate=true&instance=X",
        );
        assert!(ms.tls && !ms.verify);
        assert_eq!(ms.params, vec![("instance".into(), "X".into())]);
        assert!(!ok(Mssql, "mssql://sa@db/erp?encrypt=optional").tls);
        let plain = ok(
            Mssql,
            "mssql://sa@db/erp?encrypt=false&sslrootcert=%2Fca.pem",
        );
        assert!(!plain.tls && !plain.verify);
        assert!(
            ok(
                Mssql,
                "mssql://sa@db/erp?trustServerCertificate=true&encrypt=true"
            )
            .verify
        );
        assert!(
            ok(
                Mssql,
                "mssql://sa@db/erp?TrustServerCertificate=true&encrypt=true"
            )
            .verify
        );
        let cs = ok(Cassandra, "cassandra://u@c1/ks?ssl=true&sslmode=prefer");
        assert!(!cs.tls);
        assert!(ok(Cassandra, "cassandra://u@c1/ks?sslmode=prefer&ssl=true").tls);
        assert!(!ok(Cassandra, "cassandra://u@c1/ks?SSL=1").tls);
        assert_eq!(
            ok(Cassandra, "cassandra://c1/ks?nodes=c2,c3:9043").params,
            vec![("nodes".into(), "c2:9042,c3:9043".into())]
        );
    }

    #[test]
    fn redis_mongo_and_oracle_use_their_drivers() {
        use DatabaseKind::{Mongodb, Oracle, Redis};
        assert_eq!(
            summary(Redis, "redis://db/0"),
            ("db".into(), Some(6379), false, false)
        );
        assert_eq!(
            summary(Redis, "rediss://db/0"),
            ("db".into(), Some(6379), true, true)
        );
        assert!(!ok(Redis, "redis://db/0?ssl=true").tls);
        assert_eq!(ok(Redis, "valkey://u:p@db:6380/3").database, "3");
        let srv = ok(Mongodb, "mongodb+srv://u@cluster.example.com/app");
        assert_eq!(
            (srv.port, srv.tls, srv.transport.as_str()),
            (None, true, "mongodb+srv")
        );
        let plain = ok(
            Mongodb,
            "mongodb://u@m1/app?replicaSet=rs0&authSource=admin",
        );
        assert_eq!((plain.port, plain.tls), (Some(27017), false));
        assert_eq!(plain.params.len(), 2);
        assert!(resolve(
            Mongodb,
            "mongodb://m1/app?tls=true&tlsAllowInvalidHostnames=true"
        )
        .is_err());
        assert!(!ok(Mongodb, "mongodb://m1/app?tls=true&tlsInsecure=true").verify);
        assert!(ok(Mongodb, "mongodb://m1/app?tls=true").verify);
        let insecure = ok(
            Mongodb,
            "mongodb://m1/app?tls=true&tlsAllowInvalidCertificates=true",
        );
        assert!(insecure.tls && !insecure.verify);
        assert!(!ok(Mongodb, "mongodb+srv://c.example.com/?tls=false").tls);
        let ora = ok(Oracle, "oracle://hr@ora:1522/FREEPDB1");
        assert_eq!(
            (ora.host.as_str(), ora.port, ora.database.as_str()),
            ("ora", Some(1522), "//ora:1522/FREEPDB1")
        );
    }

    #[test]
    fn cloud_families_follow_their_parsers() {
        use DatabaseKind::{Athena, Bigquery, Dynamodb, Snowflake};
        let sf = ok(
            Snowflake,
            "snowflake://ANNA@acme_eu//SALES/PUBLIC?warehouse=WH",
        );
        assert_eq!(
            (sf.host.as_str(), sf.database.as_str(), sf.schema.as_str()),
            ("acme-eu.snowflakecomputing.com", "SALES", "PUBLIC")
        );
        assert_eq!(ok(Snowflake, "snowflake://U@acme/A%2FB").database, "A/B");
        assert_eq!(
            ok(Snowflake, "snowflake://U@acme/A?db=B&db=C").database,
            "C"
        );
        assert_eq!(
            ok(Snowflake, "snowflake://U@acme/A?DATABASE=B").database,
            "B"
        );
        assert_eq!(
            ok(Snowflake, "snowflake://U@acme?role=R&proxy_user=P").params,
            vec![("role".into(), "P".into())]
        );
        let bq = ok(Bigquery, "bigquery://p/d?location=EU&key_file=%2Fk.json");
        assert_eq!(
            (bq.host.as_str(), bq.database.as_str(), bq.port),
            ("p", "d", Some(443))
        );
        assert_eq!(
            bq.params,
            vec![
                ("location".into(), "EU".into()),
                ("credentials_file".into(), "/k.json".into())
            ]
        );
        let at = ok(Athena, "athena://AKIA@eu-central-1?workgroup=w&profile=p");
        assert_eq!(
            (at.host.as_str(), at.database.as_str(), at.user.as_str()),
            ("eu-central-1", "AwsDataCatalog", "AKIA")
        );
        let local = ok(
            Dynamodb,
            "dynamodb://local@us-east-1?endpoint=http%3A%2F%2Flocalhost%3A8000",
        );
        assert_eq!(
            (local.transport.as_str(), local.port, local.tls),
            ("http", Some(8000), false)
        );
        assert_eq!(ok(Dynamodb, "dynamodb://auto").host, "");
        assert!(resolve(Dynamodb, "dynamodb://eu-west-1?endpoint=ftp%3A%2F%2Fx").is_err());
    }

    #[test]
    fn rejects_unknown_kinds_and_oversized_batches() {
        assert!(resolve(DatabaseKind::S3, "s3://bucket").is_err());
        let requests = vec![
            EndpointRequest {
                kind: DatabaseKind::Redis,
                url: "redis://db".into()
            };
            MAX_ENDPOINT_REQUESTS + 1
        ];
        assert!(resolve_all(&requests).is_err());
        let mixed = resolve_all(&[
            EndpointRequest {
                kind: DatabaseKind::Redis,
                url: "redis://db".into(),
            },
            EndpointRequest {
                kind: DatabaseKind::Redis,
                url: "mysql://db".into(),
            },
        ])
        .unwrap();
        assert!(mixed[0].identity.is_some() && mixed[1].error.is_some());
    }

    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/connection-endpoints.json")
    }

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct FixtureEntry {
        kind: DatabaseKind,
        url: String,
        identity: Option<EndpointIdentity>,
        error: Option<String>,
    }

    #[test]
    fn endpoint_fixtures_match_the_adapters() {
        let path = fixture_path();
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{} fehlt: {error}", path.display()));
        let entries: Vec<FixtureEntry> = serde_json::from_str(&text).unwrap();
        let fresh: Vec<FixtureEntry> = entries
            .iter()
            .map(|entry| {
                let result = resolve(entry.kind, &entry.url);
                FixtureEntry {
                    kind: entry.kind,
                    url: entry.url.clone(),
                    identity: result.as_ref().ok().cloned(),
                    error: result.err(),
                }
            })
            .collect();
        if std::env::var("L8DB_UPDATE_ENDPOINT_FIXTURES").is_ok() {
            std::fs::write(&path, serde_json::to_string_pretty(&fresh).unwrap() + "\n").unwrap();
            return;
        }
        for (entry, fresh) in entries.iter().zip(&fresh) {
            assert_eq!(
                entry,
                fresh,
                "{} {}",
                serde_json::to_string(&entry.kind).unwrap(),
                entry.url
            );
        }
    }

    #[test]
    fn resolves_4000_urls_within_budget() {
        let requests: Vec<EndpointRequest> = (0..4000)
            .map(|index| match index % 4 {
                0 => EndpointRequest {
                    kind: DatabaseKind::Postgres,
                    url: format!("postgresql://user_{index}@db-{index}.internal:5432/app_{index}?sslmode=prefer"),
                },
                1 => EndpointRequest {
                    kind: DatabaseKind::Mysql,
                    url: format!("mysql://user_{index}@db-{index}.internal:3306/app_{index}?sslmode=require"),
                },
                2 => EndpointRequest {
                    kind: DatabaseKind::Mssql,
                    url: format!("mssql://user_{index}@db-{index}.internal:1433/app_{index}?sslmode=verify-full"),
                },
                _ => EndpointRequest {
                    kind: DatabaseKind::Clickhouse,
                    url: format!("clickhouse://user_{index}@db-{index}.internal:8443/app_{index}?secure=1"),
                },
            })
            .collect();
        let mut durations = Vec::new();
        for _ in 0..9 {
            let started = Instant::now();
            let results = resolve_all(&requests).unwrap();
            durations.push(started.elapsed().as_secs_f64() * 1000.0);
            assert!(results.iter().all(|result| result.identity.is_some()));
        }
        durations.sort_by(f64::total_cmp);
        let median = durations[durations.len() / 2];
        let p95 = durations[durations.len() - 1];
        println!("performance connection-endpoints-rust: {{\"urls\":4000,\"runs\":9,\"medianMs\":{median:.2},\"p95Ms\":{p95:.2}}}");
        assert!(p95 < 1500.0, "p95 {p95} ms");
    }
}
