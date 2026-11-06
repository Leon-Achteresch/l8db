mod paging;
#[cfg(test)]
mod paging_tests;
mod protection;
mod sandbox;
#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::automation::connection::{self, ConnectionCache};
use crate::automation::runtime::Services;
use crate::db::execution::{self, ExecutionOptions};
use crate::db::{ColumnInfo, QueryResult, TableInfo};
use sandbox::{Definition, Sandbox};

pub const MAX_SOURCES: usize = 8;
pub const MAX_SOURCE_ROWS: usize = 50_000;
pub const MAX_TOTAL_ROWS: usize = 100_000;
pub const MAX_PAGE_ROWS: usize = 512;
pub const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_CELL_BYTES: usize = 1024 * 1024;
pub const MAX_RESULT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_RESULT_ROWS: usize = 10_000;
pub const MAX_SQL_BYTES: usize = 64 * 1024;
const MAX_CATALOG_NAMES: usize = 5_000;
const MAX_COLUMNS: usize = 256;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FederationSource {
    pub connection_id: String,
    pub database: Option<String>,
    pub schema: String,
    pub table: String,
    pub alias: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FederationRequest {
    pub sources: Vec<FederationSource>,
    pub sql: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FederationCatalog {
    pub databases: Vec<String>,
    pub schemas: Vec<String>,
    pub tables: Vec<TableInfo>,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRead {
    pub alias: String,
    pub table: String,
    pub rows: usize,
    pub bytes: usize,
    pub masked_columns: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FederationReport {
    pub result: QueryResult,
    pub sources: Vec<SourceRead>,
    pub source_rows: usize,
    pub source_bytes: usize,
    pub source_reads: usize,
    pub duration_ms: u64,
}

fn name(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
}

fn alias(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_alphabetic())
        && value.len() <= 32
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        && !matches!(value.to_ascii_lowercase().as_str(), "main" | "temp")
        && !value.to_ascii_lowercase().starts_with("sqlite_")
}

fn validate(request: &FederationRequest) -> Result<(), String> {
    if request.sources.is_empty() || request.sources.len() > MAX_SOURCES {
        return Err(format!(
            "Zwischen 1 und {MAX_SOURCES} Quelltabellen auswählen."
        ));
    }
    if request.sql.trim().is_empty() || request.sql.len() > MAX_SQL_BYTES {
        return Err("Die SQL-Abfrage darf nicht leer und höchstens 64 KiB groß sein.".into());
    }
    let mut aliases = HashMap::new();
    let mut tables = HashSet::new();
    for source in &request.sources {
        if !name(&source.connection_id)
            || !name(&source.schema)
            || !name(&source.table)
            || source
                .database
                .as_deref()
                .is_some_and(|database| !name(database))
            || !alias(&source.alias)
        {
            return Err("Ungültige Quelle. Aliase beginnen mit einem Buchstaben und enthalten höchstens 32 Buchstaben, Ziffern oder Unterstriche.".into());
        }
        let key = source.alias.to_ascii_lowercase();
        let origin = (&source.connection_id, &source.database, &source.schema);
        if aliases
            .insert(key.clone(), origin)
            .is_some_and(|previous| previous != origin)
        {
            return Err(format!(
                "Alias „{}“ bezeichnet unterschiedliche Datenbanken oder Schemas.",
                source.alias
            ));
        }
        if !tables.insert((key, source.table.to_lowercase())) {
            return Err(format!(
                "Quelle {}.{} ist doppelt ausgewählt.",
                source.alias, source.table
            ));
        }
    }
    Ok(())
}

fn visible_schemas(schemas: Vec<String>, allowed: Option<&[String]>) -> Vec<String> {
    let Some(allowed) = allowed.filter(|allowed| !allowed.is_empty()) else {
        return schemas;
    };
    let exact = allowed
        .iter()
        .filter(|name| schemas.contains(name))
        .cloned()
        .collect::<HashSet<_>>();
    let folded = allowed
        .iter()
        .filter(|name| !exact.contains(*name))
        .map(|name| name.to_lowercase())
        .collect::<HashSet<_>>();
    schemas
        .into_iter()
        .filter(|name| exact.contains(name) || folded.contains(&name.to_lowercase()))
        .collect()
}

async fn bounded<T>(
    cancel: &CancellationToken,
    deadline: Instant,
    future: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("Datenbankübergreifende Abfrage wurde abgebrochen.".into()),
        _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => Err("Zeitlimit der datenbankübergreifenden Abfrage erreicht.".into()),
        result = future => result,
    }
}

async fn columns(
    services: &Services,
    cache: &mut ConnectionCache,
    source: &FederationSource,
    cancel: &CancellationToken,
    deadline: Instant,
) -> Result<Vec<ColumnInfo>, String> {
    let resolved = bounded(
        cancel,
        deadline,
        connection::resolve(
            services,
            cache,
            &source.connection_id,
            source.database.as_deref(),
        ),
    )
    .await?;
    let adapter = connection::adapter(services, &resolved)?;
    let schemas = bounded(cancel, deadline, adapter.list_schemas()).await?;
    if !visible_schemas(schemas, resolved.schemas.as_deref()).contains(&source.schema) {
        return Err(format!(
            "Schema „{}“ ist für diese Verbindung nicht freigegeben oder nicht vorhanden.",
            source.schema
        ));
    }
    let columns = bounded(
        cancel,
        deadline,
        adapter.list_columns(Some(&source.schema), Some(&source.table), None),
    )
    .await?;
    if columns.is_empty() || columns.len() > MAX_COLUMNS {
        return Err(format!(
            "Quelle {}.{} muss zwischen 1 und {MAX_COLUMNS} Spalten enthalten.",
            source.alias, source.table
        ));
    }
    let mut names = HashSet::new();
    if columns
        .iter()
        .any(|column| !name(&column.name) || !names.insert(column.name.to_lowercase()))
    {
        return Err(format!(
            "Quelle {}.{} enthält ungültige oder mehrdeutige Spaltennamen.",
            source.alias, source.table
        ));
    }
    Ok(columns)
}

pub async fn run(
    services: &Services,
    request: FederationRequest,
    seconds: u64,
) -> Result<FederationReport, String> {
    let config = crate::mcp::config::load();
    run_with_config(services, request, seconds, &config).await
}

async fn run_with_config(
    services: &Services,
    request: FederationRequest,
    seconds: u64,
    config: &crate::mcp::config::McpConfig,
) -> Result<FederationReport, String> {
    validate(&request)?;
    let saved = services.store.connections().await?;
    if request.sources.iter().any(|source| {
        !saved
            .iter()
            .any(|connection| connection.id == source.connection_id)
    }) {
        return Err(
            "Eine gespeicherte Quellverbindung wurde nicht gefunden. Verbindung erneut auswählen."
                .into(),
        );
    }
    let started = Instant::now();
    let deadline = started + Duration::from_secs(seconds.clamp(1, 120));
    let cancel = execution::cancellation_token();
    let mut cache = ConnectionCache::new();
    let mut definitions = Vec::new();
    for source in &request.sources {
        definitions.push(Definition {
            source: source.clone(),
            columns: columns(services, &mut cache, source, &cancel, deadline).await?,
        });
    }
    let expected_columns = definitions
        .iter()
        .map(|definition| {
            (
                (
                    definition.source.alias.to_lowercase(),
                    definition.source.table.to_lowercase(),
                ),
                definition
                    .columns
                    .iter()
                    .map(|column| column.name.clone())
                    .collect::<HashSet<_>>(),
            )
        })
        .collect::<HashMap<_, _>>();
    let sql = request.sql.clone();
    let task_cancel = cancel.clone();
    let (mut sandbox, referenced) = tokio::task::spawn_blocking(move || {
        let sandbox = Sandbox::new(&definitions, task_cancel, deadline)?;
        let references = sandbox.references(&sql)?;
        Ok::<_, String>((sandbox, references))
    })
    .await
    .map_err(|_| "Lokale SQL-Planung konnte nicht abgeschlossen werden.".to_string())??;
    let mut sources = Vec::new();
    let mut source_rows = 0_usize;
    let mut source_bytes = 0_usize;
    let mut source_reads = 0;
    for source in request.sources {
        if !referenced.contains(&(source.alias.to_lowercase(), source.table.to_lowercase())) {
            continue;
        }
        let resolved = connection::resolve(
            services,
            &mut cache,
            &source.connection_id,
            source.database.as_deref(),
        )
        .await?;
        let protection = protection::Protection::new(&resolved.id, &resolved.mask_rules, config)?;
        let adapter = connection::adapter(services, &resolved)?;
        let count = bounded(
            &cancel,
            deadline,
            adapter.count_rows_capped(
                &source.schema,
                &source.table,
                None,
                false,
                (MAX_SOURCE_ROWS + 1) as i64,
            ),
        )
        .await?;
        source_reads += 1;
        if !count.exact
            || count.count < 0
            || count.count as usize > MAX_SOURCE_ROWS
            || source_rows.saturating_add(count.count as usize) > MAX_TOTAL_ROWS
        {
            return Err(format!("Quelle {}.{} überschreitet die Grenze von {MAX_SOURCE_ROWS} Zeilen je Tabelle oder {MAX_TOTAL_ROWS} Zeilen insgesamt. Eine kleinere Quelltabelle oder eine serverseitige View verwenden.", source.alias, source.table));
        }
        let expected = count.count as usize;
        let mut offset = 0;
        let mut bytes = 0_usize;
        let mut masked_columns = None;
        let known_columns =
            &expected_columns[&(source.alias.to_lowercase(), source.table.to_lowercase())];
        let mut page_plan = paging::PagePlan::prepare(
            adapter.as_ref(),
            resolved.kind,
            &source,
            expected,
            known_columns,
            &cancel,
            deadline,
        )
        .await?;
        loop {
            let remaining = expected.saturating_sub(offset);
            let page_limit = MAX_PAGE_ROWS.min(remaining + 1);
            let mut data = bounded(
                &cancel,
                deadline,
                page_plan.fetch(adapter.as_ref(), resolved.kind, &source, page_limit, offset),
            )
            .await?;
            source_reads += 1;
            let expected_page = remaining.min(page_limit);
            if data.rows.len() != expected_page {
                return Err(format!("Quelle {}.{} wurde während des Lesens geändert oder vom Treiber gekürzt. Es wird kein unvollständiges Ergebnis berechnet; erneut ausführen.", source.alias, source.table));
            }
            if data.columns.len() != known_columns.len()
                || data
                    .columns
                    .iter()
                    .any(|column| !known_columns.contains(column))
            {
                return Err("Die Struktur einer Quelle wurde während des Lesens geändert.".into());
            }
            if data.rows.iter().any(|row| !row.is_object()) {
                return Err("Eine Quelle lieferte ungültige Zeilendaten.".into());
            }
            if data
                .rows
                .iter()
                .any(|row| sandbox::value_bytes(row) > MAX_CELL_BYTES)
            {
                return Err("Eine Quellzeile überschreitet 1 MiB. Weniger Spalten in einer serverseitigen View bereitstellen.".into());
            }
            let page_bytes = data.rows.iter().fold(0_usize, |sum, row| {
                sum.saturating_add(sandbox::value_bytes(row))
            });
            bytes = bytes.saturating_add(page_bytes);
            source_bytes = source_bytes.saturating_add(page_bytes);
            source_rows += data.rows.len();
            if source_bytes > MAX_INPUT_BYTES {
                return Err("Die Quelldaten überschreiten 64 MiB. Weniger oder kleinere Tabellen auswählen.".into());
            }
            page_plan.accept(&source, &data)?;
            let page_masked_columns = protection.apply(&mut data);
            masked_columns.get_or_insert(page_masked_columns);
            offset += data.rows.len();
            let source_page = source.clone();
            sandbox = tokio::task::spawn_blocking(move || {
                sandbox.load(&source_page, data)?;
                Ok::<_, String>(sandbox)
            })
            .await
            .map_err(|_| "Quelldaten konnten nicht lokal übernommen werden.".to_string())??;
            if remaining < page_limit || expected <= MAX_PAGE_ROWS {
                break;
            }
        }
        sources.push(SourceRead {
            alias: source.alias,
            table: source.table,
            rows: expected,
            bytes,
            masked_columns: masked_columns.unwrap_or_default(),
        });
    }
    let result = tokio::task::spawn_blocking(move || sandbox.execute(&request.sql))
        .await
        .map_err(|_| "Lokale SQL-Abfrage konnte nicht abgeschlossen werden.".to_string())??;
    Ok(FederationReport {
        result,
        sources,
        source_rows,
        source_bytes,
        source_reads,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn federation_query(
    app: tauri::AppHandle,
    request: FederationRequest,
    options: Option<ExecutionOptions>,
) -> Result<FederationReport, String> {
    let seconds = options
        .as_ref()
        .and_then(|options| options.query_timeout)
        .unwrap_or(30)
        .clamp(1, 120);
    execution::run(options, true, async {
        let services = crate::automation::services_from_app(&app)?;
        run(&services, request, seconds).await
    })
    .await
}

#[tauri::command]
pub async fn federation_catalog(
    app: tauri::AppHandle,
    connection_id: String,
    database: Option<String>,
    schema: Option<String>,
    options: Option<ExecutionOptions>,
) -> Result<FederationCatalog, String> {
    if !name(&connection_id)
        || database.as_deref().is_some_and(|value| !name(value))
        || schema.as_deref().is_some_and(|value| !name(value))
    {
        return Err("Ungültige Datenbank- oder Schemaauswahl.".into());
    }
    execution::run(options, true, async {
        let services = crate::automation::services_from_app(&app)?;
        if !services
            .store
            .connections()
            .await?
            .iter()
            .any(|connection| connection.id == connection_id)
        {
            return Err("Die gespeicherte Quellverbindung wurde nicht gefunden.".into());
        }
        let mut cache = ConnectionCache::new();
        let cancel = execution::cancellation_token();
        let deadline = Instant::now() + Duration::from_secs(20);
        let resolved = bounded(
            &cancel,
            deadline,
            connection::resolve(&services, &mut cache, &connection_id, database.as_deref()),
        )
        .await?;
        let adapter = connection::adapter(&services, &resolved)?;
        let mut databases = bounded(&cancel, deadline, adapter.list_databases()).await?;
        let mut schemas = visible_schemas(
            bounded(&cancel, deadline, adapter.list_schemas()).await?,
            resolved.schemas.as_deref(),
        );
        let mut tables = if let Some(schema) = schema {
            if !schemas.contains(&schema) {
                return Err(
                    "Das Schema ist für diese Verbindung nicht freigegeben oder nicht vorhanden."
                        .into(),
                );
            }
            bounded(&cancel, deadline, adapter.list_tables(Some(&schema))).await?
        } else {
            Vec::new()
        };
        databases.sort();
        schemas.sort();
        tables.sort_by(|a, b| a.name.cmp(&b.name));
        let has_more = databases.len() > MAX_CATALOG_NAMES
            || schemas.len() > MAX_CATALOG_NAMES
            || tables.len() > MAX_CATALOG_NAMES;
        databases.truncate(MAX_CATALOG_NAMES);
        schemas.truncate(MAX_CATALOG_NAMES);
        tables.truncate(MAX_CATALOG_NAMES);
        Ok(FederationCatalog {
            databases,
            schemas,
            tables,
            has_more,
        })
    })
    .await
}
