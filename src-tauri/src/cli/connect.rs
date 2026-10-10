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
    pub production: bool,
}

impl Target {
    pub fn saved(connection: &AutomationConnection) -> Self {
        Target {
            id: connection.id.clone(),
            name: connection.name.clone(),
            kind: connection.kind,
            read_only: connection.read_only || connection.production_locked,
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
        return db::provider::list_providers()
            .into_iter()
            .find(|p| p.url_schemes.contains(&scheme.as_str()))
            .map(|p| p.kind)
            .ok_or_else(|| {
                format!(
                    "Datenbanktyp für „{scheme}://“ unbekannt. Beispiel: postgres://user@host/db"
                )
            });
    }
    let lower = url.to_ascii_lowercase();
    if lower.ends_with(".duckdb") || lower.ends_with(".ddb") {
        Ok(DatabaseKind::Duckdb)
    } else if [".db", ".sqlite", ".sqlite3", ".db3"]
        .iter()
        .any(|ext| lower.ends_with(ext))
    {
        Ok(DatabaseKind::Sqlite)
    } else {
        Err(
            "--url braucht eine URL wie postgres://user@host/db oder eine .sqlite/.duckdb-Datei."
                .into(),
        )
    }
}

pub fn ad_hoc(url: &str) -> Result<Source, String> {
    let kind = detect_kind(url)?;
    let url = match kind {
        DatabaseKind::Sqlite | DatabaseKind::Duckdb if !url.contains("://") => {
            let path = std::path::absolute(url).map_err(|e| format!("{url}: {e}"))?;
            if !path.exists() {
                return Err(format!("Datei {} gibt es nicht.", path.display()));
            }
            path.display().to_string()
        }
        _ => url.to_string(),
    };
    Ok(Source::Url {
        url,
        target: Target {
            id: String::new(),
            name: "--url".into(),
            kind,
            read_only: false,
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
    }

    #[test]
    fn missing_database_files_are_reported() {
        let Err(error) = ad_hoc("/does/not/exist.sqlite") else {
            panic!("missing file accepted");
        };
        assert!(error.contains("gibt es nicht"), "{error}");
    }
}
