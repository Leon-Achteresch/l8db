use super::{lit, quote};
use crate::db::index_metadata::{
    IndexDefinitionStatus, IndexFilter, IndexKey, IndexMetadata, IndexRoles,
};
use crate::db::IndexInfo;
use serde::Deserialize;
use std::collections::HashMap;
use tiberius::Row;

#[derive(Debug, Clone, Deserialize)]
pub(super) struct CatalogRow {
    pub index_id: i32,
    pub name: String,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: String,
    pub column: Option<String>,
    pub key_ordinal: Option<i32>,
    pub included: Option<bool>,
    pub descending: Option<bool>,
    pub has_filter: Option<bool>,
    pub filter_definition: Option<String>,
    pub index_column_id: Option<i32>,
}

impl CatalogRow {
    pub(super) fn read(row: &Row) -> Result<Self, String> {
        let error = |error: tiberius::error::Error| format!("Indexmetadaten: {error}");
        Ok(Self {
            index_id: row
                .try_get::<i32, _>(0)
                .map_err(error)?
                .ok_or("Index-ID fehlt")?,
            name: row
                .try_get::<&str, _>(1)
                .map_err(error)?
                .ok_or("Indexname fehlt")?
                .into(),
            is_unique: row
                .try_get::<bool, _>(2)
                .map_err(error)?
                .ok_or("Unique-Merkmal fehlt")?,
            is_primary: row
                .try_get::<bool, _>(3)
                .map_err(error)?
                .ok_or("Primärschlüsselmerkmal fehlt")?,
            index_type: row
                .try_get::<&str, _>(4)
                .map_err(error)?
                .ok_or("Indextyp fehlt")?
                .into(),
            column: row
                .try_get::<&str, _>(5)
                .map_err(error)?
                .map(str::to_string),
            key_ordinal: row.try_get::<i32, _>(6).map_err(error)?,
            included: row.try_get::<bool, _>(7).map_err(error)?,
            descending: row.try_get::<bool, _>(8).map_err(error)?,
            has_filter: row.try_get::<bool, _>(9).map_err(error)?,
            filter_definition: row
                .try_get::<&str, _>(10)
                .map_err(error)?
                .map(str::to_string),
            index_column_id: row.try_get::<i32, _>(11).map_err(error)?,
        })
    }
}

pub(super) fn query(schema: &str, table: &str) -> String {
    format!("SELECT i.index_id, i.name, i.is_unique, i.is_primary_key, i.type_desc, c.name, \
        CAST(ic.key_ordinal AS INT), ic.is_included_column, ic.is_descending_key, \
        i.has_filter, CASE WHEN ROW_NUMBER() OVER (PARTITION BY i.index_id ORDER BY ic.index_column_id) = 1 THEN i.filter_definition END, ic.index_column_id FROM sys.indexes i \
        LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id \
        LEFT JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
        WHERE i.object_id = OBJECT_ID({}) AND i.name IS NOT NULL ORDER BY i.name, ic.index_column_id",
        lit(&format!("{}.{}", quote(schema), quote(table))))
}

fn filter(has_filter: Option<bool>, definition: Option<String>) -> IndexFilter {
    let definition = definition.filter(|text| !text.trim().is_empty());
    match (has_filter, definition) {
        (Some(false), None) => IndexFilter::None,
        (Some(true), None) => IndexFilter::Unavailable,
        (Some(true) | None, Some(predicate)) => IndexFilter::Known { predicate },
        _ => IndexFilter::Unknown,
    }
}

struct Group {
    header: CatalogRow,
    columns: Vec<CatalogRow>,
}

pub(super) fn map_catalog(schema: &str, table: &str, rows: Vec<CatalogRow>) -> Vec<IndexMetadata> {
    let mut groups: Vec<Group> = Vec::new();
    let mut positions = HashMap::new();
    for mut row in rows {
        let predicate = row.filter_definition.take();
        let position = *positions.entry(row.index_id).or_insert_with(|| {
            groups.push(Group {
                header: row.clone(),
                columns: Vec::new(),
            });
            groups.len() - 1
        });
        if groups[position].header.filter_definition.is_none() {
            groups[position].header.filter_definition = predicate;
        }
        groups[position].columns.push(row);
    }
    let mut out = Vec::with_capacity(groups.len());
    for mut group in groups {
        let rowstore = matches!(
            group.header.index_type.as_str(),
            "CLUSTERED" | "NONCLUSTERED"
        );
        group.columns.sort_by_key(|row| row.index_column_id);
        let mut roles = IndexRoles {
            keys: Vec::new(),
            included: Vec::new(),
            other: Vec::new(),
            filter: filter(
                group.header.has_filter,
                group.header.filter_definition.take(),
            ),
            definition_status: IndexDefinitionStatus::Unavailable,
        };
        let mut unresolved = false;
        for row in group.columns {
            let Some(name) = row.column else {
                unresolved = true;
                continue;
            };
            if rowstore
                && row.included == Some(false)
                && row.key_ordinal.is_some_and(|ordinal| ordinal > 0)
            {
                roles.keys.push(IndexKey {
                    name,
                    position: row.key_ordinal.unwrap() as u32,
                    descending: row.descending,
                });
            } else if rowstore && row.included == Some(true) {
                roles.included.push(name);
            } else {
                roles.other.push(name);
            }
        }
        roles.keys.sort_by_key(|key| key.position);
        let mut definition = String::new();
        if rowstore
            && !unresolved
            && roles.other.is_empty()
            && !roles.keys.is_empty()
            && roles.keys.iter().all(|key| key.descending.is_some())
            && matches!(roles.filter, IndexFilter::None | IndexFilter::Known { .. })
        {
            definition = format!(
                "CREATE {}{} INDEX {} ON {}.{} ({})",
                if group.header.is_unique {
                    "UNIQUE "
                } else {
                    ""
                },
                group.header.index_type,
                quote(&group.header.name),
                quote(schema),
                quote(table),
                roles
                    .keys
                    .iter()
                    .map(|key| format!(
                        "{} {}",
                        quote(&key.name),
                        if key.descending == Some(true) {
                            "DESC"
                        } else {
                            "ASC"
                        }
                    ))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            if !roles.included.is_empty() {
                definition.push_str(&format!(
                    " INCLUDE ({})",
                    roles
                        .included
                        .iter()
                        .map(|name| quote(name))
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
            if let IndexFilter::Known { predicate } = &roles.filter {
                definition.push_str(&format!(" WHERE {predicate}"));
            }
            roles.definition_status = IndexDefinitionStatus::Reconstructed;
        }
        out.push(IndexMetadata {
            index: IndexInfo {
                name: group.header.name,
                is_unique: group.header.is_unique,
                is_primary: group.header.is_primary,
                columns: if rowstore {
                    roles.keys.iter().map(|key| key.name.clone()).collect()
                } else {
                    roles.other.clone()
                },
                index_type: group.header.index_type.to_lowercase(),
                definition,
            },
            roles: Some(roles),
        });
    }
    out.sort_by(|left, right| left.index.name.cmp(&right.index.name));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn fixture() -> Vec<CatalogRow> {
        serde_json::from_str(include_str!("indexes.fixture.json")).unwrap()
    }

    #[test]
    fn catalog_roles_keep_key_order_direction_include_and_predicate() {
        let indexes = map_catalog("dbo", "orders", fixture());
        let entry = indexes
            .iter()
            .find(|entry| entry.index.name == "by_owner")
            .unwrap();
        let roles = entry.roles.as_ref().unwrap();
        assert_eq!(entry.index.columns, vec!["tenant_id", "created_at"]);
        assert_eq!(
            roles
                .keys
                .iter()
                .map(|key| (key.position, key.descending))
                .collect::<Vec<_>>(),
            vec![(1, Some(false)), (2, Some(true))]
        );
        assert_eq!(roles.included, vec!["display]name"]);
        assert!(roles.other.is_empty());
        assert_eq!(entry.index.definition, "CREATE NONCLUSTERED INDEX [by_owner] ON [dbo].[orders] ([tenant_id] ASC, [created_at] DESC) INCLUDE ([display]]name]) WHERE ([status]=(1))");
        let json = serde_json::to_value(entry).unwrap();
        assert_eq!(json["roles"]["filter"]["state"], "known");
        assert_eq!(json["roles"]["filter"]["predicate"], "([status]=(1))");
        assert_eq!(json["roles"]["definition_status"], "reconstructed");
    }

    #[test]
    fn missing_filter_and_column_roles_never_fabricate_an_unfiltered_definition() {
        let indexes = map_catalog("dbo", "orders", fixture());
        for (name, filter_state) in [("hidden_filter", "unavailable"), ("unknown", "unknown")] {
            let entry = indexes
                .iter()
                .find(|entry| entry.index.name == name)
                .unwrap();
            assert!(entry.index.definition.is_empty());
            let json = serde_json::to_value(entry).unwrap();
            assert_eq!(json["roles"]["filter"]["state"], filter_state);
            assert_eq!(json["roles"]["definition_status"], "unavailable");
        }
        for name in ["no_columns", "zero_not_include", "columnstore"] {
            let entry = indexes
                .iter()
                .find(|entry| entry.index.name == name)
                .unwrap();
            assert!(entry.index.definition.is_empty());
            assert!(entry.roles.as_ref().unwrap().included.is_empty());
        }
        let columnstore = indexes
            .iter()
            .find(|entry| entry.index.name == "columnstore")
            .unwrap();
        assert_eq!(columnstore.roles.as_ref().unwrap().other, vec!["a"]);
        let plain = indexes
            .iter()
            .find(|entry| entry.index.name == "plain")
            .unwrap();
        assert!(matches!(
            plain.roles.as_ref().unwrap().filter,
            IndexFilter::None
        ));
    }

    #[test]
    fn catalog_query_is_a_single_read_with_nullable_filter_and_column_metadata() {
        let sql = query("a']", "t]able");
        assert_eq!(sql.matches("SELECT ").count(), 1);
        assert!(sql.contains("i.has_filter, CASE WHEN ROW_NUMBER() OVER (PARTITION BY i.index_id ORDER BY ic.index_column_id) = 1 THEN i.filter_definition END"));
        assert!(sql
            .contains("CAST(ic.key_ordinal AS INT), ic.is_included_column, ic.is_descending_key"));
        assert!(sql.contains("LEFT JOIN sys.index_columns"));
        assert!(sql.contains("LEFT JOIN sys.columns"));
        assert!(sql.contains("OBJECT_ID(N'[a'']]].[t]]able]')"));
        assert!(!sql.contains("INSERT "));
        assert!(!sql.contains("CREATE "));
    }

    #[test]
    fn optional_contract_preserves_legacy_json_and_does_not_guess_unknown_direction() {
        let mut raw = fixture();
        let first = raw.iter_mut().find(|row| row.name == "plain").unwrap();
        first.descending = None;
        let indexes = map_catalog("dbo", "t", raw);
        let plain = indexes
            .into_iter()
            .find(|entry| entry.index.name == "plain")
            .unwrap();
        assert!(plain.index.definition.is_empty());
        assert_eq!(plain.roles.as_ref().unwrap().keys[0].descending, None);
        let legacy = IndexMetadata::from(plain.index);
        let json = serde_json::to_value(legacy).unwrap();
        assert!(json.get("roles").is_none());
        assert_eq!(json["columns"], serde_json::json!(["x"]));
    }

    #[test]
    fn catalog_row_order_does_not_change_key_or_include_order() {
        let rows = fixture();
        let mut reversed = rows.clone();
        reversed.reverse();
        assert_eq!(
            serde_json::to_value(map_catalog("dbo", "t", rows)).unwrap(),
            serde_json::to_value(map_catalog("dbo", "t", reversed)).unwrap()
        );
    }

    #[test]
    fn performance_maps_1000_indexes_from_12000_catalog_rows_without_quadratic_grouping() {
        let base = fixture().remove(0);
        let rows: Vec<CatalogRow> = (0..1000)
            .flat_map(|index| {
                let base = base.clone();
                (0..12).map(move |column| CatalogRow {
                    index_id: index + 1,
                    name: format!("ix_{index:04}"),
                    column: Some(format!("column_{column}")),
                    key_ordinal: Some(if column < 2 { column + 1 } else { 0 }),
                    included: Some(column >= 2),
                    index_column_id: Some(column + 1),
                    ..base.clone()
                })
            })
            .collect();
        let mut times = Vec::new();
        let mut bytes = 0;
        for run in 0..9 {
            let input = rows.clone();
            let start = Instant::now();
            let indexes = map_catalog("dbo", "events", input);
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            assert_eq!(indexes.len(), 1000);
            assert_eq!(indexes[0].roles.as_ref().unwrap().included.len(), 10);
            bytes = serde_json::to_vec(&indexes).unwrap().len();
            assert!(bytes < 2 * 1024 * 1024);
            if run >= 2 {
                times.push(elapsed);
            }
        }
        times.sort_by(f64::total_cmp);
        eprintln!("mssql-index-roles indexes=1000 catalog_rows=12000 median_ms={:.2} p95_ms={:.2} serialized_bytes={} database_requests=0(pure_mapping)", times[3], times[6], bytes);
        assert!(times[3] < 250.0);
        assert!(times[6] < 500.0);
    }
}
