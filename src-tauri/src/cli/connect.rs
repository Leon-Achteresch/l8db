use std::sync::Arc;

use crate::automation::connection::{self, ConnectionCache, Via};
use crate::automation::model::AutomationConnection;
use crate::automation::runtime::Services;
use crate::automation::store::Store;
use crate::db::{self, DatabaseAdapter, DatabaseKind};

pub struct Target {
    pub id: String,
    pub name: String,
    pub kind: DatabaseKind,
    pub read_only: bool,
    pub read_only_flag: bool,
    pub production: bool,
}

impl Target {
    pub fn saved(connection: &AutomationConnection) -> Self {
        Target {
            id: connection.id.clone(),
            name: connection.name.clone(),
            kind: connection.kind,
            read_only: connection.read_only || connection.production_locked,
            read_only_flag: false,
            production: connection.environment.as_deref() == Some("production"),
        }
    }
}

pub enum Source {
    Saved(Target),
    Url { url: String, target: Target },
}

impl Source {
    pub fn target(&self) -> &Target {
        match self {
            Source::Saved(target) | Source::Url { target, .. } => target,
        }
    }
}

pub struct Session {
    pub target: Target,
    pub adapter: Box<dyn DatabaseAdapter>,
    pub url: String,
    pub via: Via,
    pub services: Arc<Services>,
}

pub fn services() -> Result<Arc<Services>, String> {
    let mut services = Services::new(Store::open_default()?, Arc::new(|_| {}), true);
    services.require_password = false;
    Ok(Arc::new(services))
}

pub fn detect_kind(url: &str) -> Result<DatabaseKind, String> {
    if let Some((scheme, _)) = url.split_once("://") {
        let scheme = scheme.to_ascii_lowercase();
        let mut kinds: Vec<(DatabaseKind, String)> = Vec::new();
        for provider in db::provider::list_providers() {
            if provider.url_schemes.contains(&scheme.as_str())
                && !kinds.iter().any(|(kind, _)| *kind == provider.kind)
            {
                let own = provider.url_schemes.first().copied().unwrap_or_default();
                kinds.push((provider.kind, format!("{own}://")));
            }
        }
        return match kinds.as_slice() {
            [] => Err(format!(
                "Datenbanktyp für „{scheme}://“ unbekannt. Beispiel: postgres://user@host/db"
            )),
            [(kind, _)] => Ok(*kind),
            many => Err(format!(
                "„{scheme}://“ ist mehrdeutig. Nutze stattdessen {}{}.",
                many.iter()
                    .map(|(_, own)| own.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
                if scheme == "https" {
                    ", jeweils mit ?tls=true"
                } else {
                    ""
                }
            )),
        };
    }
    let lower = db::sqlite::split_file_params(url).0.to_ascii_lowercase();
    if lower.starts_with("jdbc:") {
        Ok(DatabaseKind::Jdbc)
    } else if lower.starts_with("duckdb:") {
        Ok(DatabaseKind::Duckdb)
    } else if lower.starts_with("sqlite:") {
        Ok(DatabaseKind::Sqlite)
    } else if lower.ends_with(".duckdb") || lower.ends_with(".ddb") {
        Ok(DatabaseKind::Duckdb)
    } else if [".db", ".sqlite", ".sqlite3", ".db3"]
        .iter()
        .any(|ext| lower.ends_with(ext))
    {
        Ok(DatabaseKind::Sqlite)
    } else {
        Err(
            "--url: Schema oder Dateiendung fehlt. Beispiel: postgres://user@host/db, daten.sqlite, daten.duckdb"
                .into(),
        )
    }
}

pub fn ad_hoc(url: &str) -> Result<Source, String> {
    let kind = detect_kind(url)?;
    let read_only = kind.is_file_based() && db::sqlite::opens_read_only(url);
    let url = match kind {
        DatabaseKind::Sqlite | DatabaseKind::Duckdb if !url.contains("://") => {
            let file = db::sqlite::file_path(url)?;
            if file == ":memory:" {
                return Err("--url braucht eine vorhandene Datenbankdatei.".into());
            }
            let path = std::path::absolute(&file).map_err(|e| format!("{url}: {e}"))?;
            let (_, query) = db::sqlite::split_file_params(url.trim());
            if !path.exists() && !db::sqlite::can_create_file(query) {
                return Err(format!("Datei {} gibt es nicht.", path.display()));
            }
            if query.is_empty() {
                path.display().to_string()
            } else {
                format!("{}?{query}", path.display())
            }
        }
        _ => url.to_string(),
    };
    Ok(Source::Url {
        url,
        target: Target {
            id: String::new(),
            name: "--url".into(),
            kind,
            read_only,
            read_only_flag: false,
            production: false,
        },
    })
}

pub async fn open(source: Source, database: Option<&str>) -> Result<Session, String> {
    let services = services()?;
    let (target, url, via) = match source {
        Source::Url { url, target } => (target, url, Via::Direct),
        Source::Saved(target) => {
            let mut cache = ConnectionCache::new();
            let resolved = connection::resolve(&services, &mut cache, &target.id, database).await?;
            (target, resolved.url.clone(), resolved.via)
        }
    };
    let adapter =
        db::create_adapter_from_string(target.kind, &url, database, services.pool.clone())?;
    Ok(Session {
        target,
        adapter,
        url,
        via,
        services,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn detects_kinds_from_urls_and_files() {
        assert_eq!(
            detect_kind("postgresql://u@h/db").unwrap(),
            DatabaseKind::Postgres
        );
        assert_eq!(
            detect_kind("mariadb://u@h/db").unwrap(),
            DatabaseKind::Mysql
        );
        assert_eq!(detect_kind("./data.sqlite").unwrap(), DatabaseKind::Sqlite);
        assert_eq!(detect_kind("x.duckdb").unwrap(), DatabaseKind::Duckdb);
        assert!(detect_kind("nope://x").unwrap_err().contains("nope://"));
        assert!(detect_kind("readme.txt").is_err());
        assert_eq!(
            detect_kind("/d/neu.sqlite?mode=rwc").unwrap(),
            DatabaseKind::Sqlite
        );
        assert_eq!(detect_kind("sqlite:data").unwrap(), DatabaseKind::Sqlite);
        assert_eq!(detect_kind("duckdb:x.db").unwrap(), DatabaseKind::Duckdb);
        let http = detect_kind("http://127.0.0.1:9").unwrap_err();
        assert!(
            http.contains("clickhouse://") && http.contains("elasticsearch://"),
            "{http}"
        );
        assert_eq!(
            detect_kind("elasticsearch://h:9200").unwrap(),
            DatabaseKind::Elasticsearch
        );
    }

    #[test]
    fn missing_database_files_are_reported() {
        let Err(error) = ad_hoc("/does/not/exist.sqlite") else {
            panic!("missing file accepted");
        };
        assert!(error.contains("gibt es nicht"), "{error}");
    }

    #[tokio::test]
    async fn file_options_reach_the_cli_and_the_database_driver() {
        let dir = tempfile::tempdir().unwrap();
        for (extension, kind) in [
            ("sqlite", DatabaseKind::Sqlite),
            #[cfg(feature = "duckdb")]
            ("duckdb", DatabaseKind::Duckdb),
        ] {
            let path = dir.path().join(format!("A+B & Lager.{extension}"));
            let encoded = path.to_str().unwrap().replace(' ', "%20");
            let adapter = |url: &str| {
                db::create_adapter_from_string(kind, url, None, db::pool::create_pool_state())
                    .unwrap()
            };
            let Source::Url { url, target } =
                ad_hoc(&format!("{encoded}?cache=private&mode=rwc")).unwrap()
            else {
                panic!("Dateiverbindung erwartet");
            };
            assert!(!target.read_only);
            adapter(&url)
                .execute_query("CREATE TABLE bestand (anzahl INTEGER)")
                .await
                .unwrap();
            assert!(path.is_file());
            for (prefix, query) in [
                ("", "mode=ro"),
                (extension, "cache=private&immutable=1"),
                (extension, "access_mode=read_only&cache=private"),
            ] {
                let prefix = if prefix.is_empty() {
                    String::new()
                } else {
                    format!("{prefix}:")
                };
                let Source::Url { url, target } =
                    ad_hoc(&format!("{prefix}{encoded}?{query}")).unwrap()
                else {
                    panic!("Dateiverbindung erwartet");
                };
                assert!(target.read_only);
                assert_eq!(
                    db::sqlite::split_file_params(&url),
                    (path.to_str().unwrap(), query)
                );
                let db = adapter(&url);
                assert!(db
                    .execute_query("INSERT INTO bestand VALUES (1)")
                    .await
                    .is_err());
                let rows = db
                    .execute_query("SELECT COUNT(*) AS n FROM bestand")
                    .await
                    .unwrap();
                assert_eq!(rows.rows[0]["n"], 0);
            }
            let uri = format!("{extension}://{encoded}?mode=ro");
            let Source::Url { url, target } = ad_hoc(&uri).unwrap() else {
                unreachable!()
            };
            assert_eq!(url, uri);
            assert!(target.read_only);
        }
    }

    #[test]
    fn file_options_bound_resolution_cost() {
        let dir = tempfile::tempdir().unwrap();
        let queries = [
            "mode=ro",
            "immutable=1",
            "access_mode=read_only&cache=private",
            "cache=shared",
        ];
        let mut inputs = Vec::new();
        for index in 0..512 {
            let path = dir.path().join(format!("Bestand {index:04}.sqlite"));
            std::fs::File::create(&path).unwrap();
            inputs.push(format!(
                "{}?{}",
                path.display(),
                queries[index % queries.len()]
            ));
        }
        let mut samples = Vec::new();
        let mut max_capacity = 0;
        for run in 0..22 {
            let start = Instant::now();
            let mut protected = 0;
            for input in &inputs {
                let Source::Url { url, target } = ad_hoc(input).unwrap() else {
                    unreachable!()
                };
                protected += usize::from(target.read_only);
                assert_eq!(&url, input);
                assert!(url.capacity() <= 2 * input.len() + 16);
                max_capacity = max_capacity.max(url.capacity());
            }
            if run > 0 {
                samples.push(start.elapsed());
            }
            assert_eq!(protected, 384);
        }
        samples.sort_unstable();
        println!(
            "512 file URLs: median {:?}, p95 {:?}, max URL capacity {max_capacity} bytes",
            samples[10], samples[19]
        );
        assert!(samples[10] < Duration::from_millis(25));
        assert!(samples[19] < Duration::from_millis(60));
    }
}
