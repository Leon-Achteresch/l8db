use std::collections::HashSet;
use std::io::{self, Write};
use std::time::Instant;

use ring::digest::{Context, SHA256};
use tokio_util::sync::CancellationToken;

use super::{bounded, FederationSource, MAX_PAGE_ROWS, MAX_SOURCE_ROWS};
use crate::db::import::Dialect;
use crate::db::{DatabaseAdapter, DatabaseKind, TableData};

#[derive(Clone, Copy)]
enum Strategy {
    Single,
    AdapterPrimaryKey,
    Sqlite(Dialect),
}

pub(super) struct PagePlan {
    strategy: Strategy,
    keys: Vec<String>,
    seen: HashSet<[u8; 32]>,
}

fn paging_error(source: &FederationSource) -> String {
    format!(
        "Quelle {}.{} hat mehr als {MAX_PAGE_ROWS} Zeilen. Sicheres Blättern ist nur für Tabellen mit vollständig bekannten, eindeutigen Primärschlüsseln und einer begrenzten, stabil sortierenden Adapterstrategie möglich. Views und Quellen ohne diese Garantie auf höchstens {MAX_PAGE_ROWS} Zeilen begrenzen oder in eine Tabelle mit Primärschlüssel übernehmen.",
        source.alias, source.table
    )
}

fn strategy(kind: DatabaseKind) -> Option<Strategy> {
    match kind {
        DatabaseKind::Postgres
        | DatabaseKind::Mysql
        | DatabaseKind::Mssql
        | DatabaseKind::Oracle => Some(Strategy::AdapterPrimaryKey),
        DatabaseKind::Sqlite | DatabaseKind::SqliteHttp => Some(Strategy::Sqlite(Dialect::Sqlite)),
        DatabaseKind::Duckdb => Some(Strategy::Sqlite(Dialect::Duckdb)),
        _ => None,
    }
}

impl PagePlan {
    pub async fn prepare(
        adapter: &dyn DatabaseAdapter,
        kind: DatabaseKind,
        source: &FederationSource,
        expected: usize,
        columns: &HashSet<String>,
        cancel: &CancellationToken,
        deadline: Instant,
    ) -> Result<Self, String> {
        if expected <= MAX_PAGE_ROWS {
            return Ok(Self {
                strategy: Strategy::Single,
                keys: Vec::new(),
                seen: HashSet::new(),
            });
        }
        let strategy = strategy(kind).ok_or_else(|| paging_error(source))?;
        let views = bounded(cancel, deadline, adapter.list_views(Some(&source.schema))).await?;
        if views
            .iter()
            .any(|view| view.name.eq_ignore_ascii_case(&source.table))
        {
            return Err(paging_error(source));
        }
        let mut detailed = bounded(
            cancel,
            deadline,
            adapter.list_table_columns_detailed(&source.schema, &source.table),
        )
        .await?;
        if detailed.len() != columns.len()
            || detailed
                .iter()
                .any(|column| !columns.contains(&column.name))
        {
            return Err(
                "Die Struktur einer Quelle wurde während der Seitenplanung geändert.".into(),
            );
        }
        detailed.sort_by(|left, right| {
            left.ordinal_position
                .cmp(&right.ordinal_position)
                .then_with(|| left.name.cmp(&right.name))
        });
        let keys: Vec<String> = detailed
            .into_iter()
            .filter(|column| column.is_primary_key)
            .map(|column| column.name)
            .collect();
        if keys.is_empty() || keys.iter().collect::<HashSet<_>>().len() != keys.len() {
            return Err(paging_error(source));
        }
        Ok(Self {
            strategy,
            keys,
            seen: HashSet::with_capacity(expected.min(MAX_SOURCE_ROWS)),
        })
    }

    pub async fn fetch(
        &self,
        adapter: &dyn DatabaseAdapter,
        kind: DatabaseKind,
        source: &FederationSource,
        limit: usize,
        offset: usize,
    ) -> Result<TableData, String> {
        if limit == 0 || limit > MAX_PAGE_ROWS || offset > MAX_SOURCE_ROWS {
            return Err("Die Quellseite überschreitet die erlaubten Seitengrenzen.".into());
        }
        match self.strategy {
            Strategy::Sqlite(dialect) => {
                let order =
                    crate::db::stable_order_terms(None, &self.keys, |name| dialect.quote(name));
                let schema = if kind == DatabaseKind::SqliteHttp {
                    ""
                } else {
                    &source.schema
                };
                let sql = format!(
                    "SELECT * FROM {} ORDER BY {} LIMIT {limit} OFFSET {offset}",
                    dialect.target(schema, &source.table),
                    order.join(", ")
                );
                let result = adapter.execute_query(&sql).await?;
                if result.truncated {
                    return Err("Eine geordnete Quellseite wurde vom Treiber gekürzt. Es wird kein unvollständiges Ergebnis berechnet.".into());
                }
                Ok(TableData {
                    columns: result.columns,
                    rows: result.rows,
                })
            }
            Strategy::AdapterPrimaryKey | Strategy::Single => {
                if matches!(self.strategy, Strategy::Single) && offset != 0 {
                    return Err(paging_error(source));
                }
                adapter
                    .fetch_rows(
                        &source.schema,
                        &source.table,
                        None,
                        limit as i64,
                        offset as i64,
                        self.keys.first().map(String::as_str),
                        false,
                        matches!(self.strategy, Strategy::Single),
                        false,
                    )
                    .await
            }
        }
    }

    pub fn accept(&mut self, source: &FederationSource, data: &TableData) -> Result<(), String> {
        if self.keys.is_empty() {
            return Ok(());
        }
        for row in &data.rows {
            let mut digest = Context::new(&SHA256);
            for key in &self.keys {
                let value = row.get(key).filter(|value| !value.is_null()).ok_or_else(|| {
                    format!("Quelle {}.{} enthält einen fehlenden oder NULL-Primärschlüssel. Eine eindeutige Seitenordnung ist nicht garantiert; es wird kein unvollständiges Ergebnis berechnet.", source.alias, source.table)
                })?;
                serde_json::to_writer(KeyWriter(&mut digest), value)
                    .map_err(|cause| cause.to_string())?;
                digest.update(&[0]);
            }
            let mut key = [0_u8; 32];
            key.copy_from_slice(digest.finish().as_ref());
            if !self.seen.insert(key) || self.seen.len() > MAX_SOURCE_ROWS {
                return Err(format!("Quelle {}.{} liefert doppelte Primärschlüssel oder wurde während des Lesens geändert. Es wird kein unvollständiges Ergebnis berechnet; erneut ausführen.", source.alias, source.table));
            }
        }
        Ok(())
    }
}

struct KeyWriter<'a>(&'a mut Context);

impl Write for KeyWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
