use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::paging::PagePlan;
use super::{FederationSource, MAX_PAGE_ROWS};
use crate::db::{
    ColumnInfo, DatabaseAdapter, DatabaseKind, DetailedColumnInfo, QueryResult, TableData,
    TableInfo,
};

#[derive(Debug)]
struct FetchCall {
    limit: i64,
    offset: i64,
    order: Option<String>,
    is_view: bool,
}

struct Adapter {
    columns: Vec<DetailedColumnInfo>,
    rows: Vec<Value>,
    view: bool,
    truncated: bool,
    fetches: Mutex<Vec<FetchCall>>,
    queries: Mutex<Vec<String>>,
    metadata_reads: AtomicUsize,
}

impl Adapter {
    fn new(rows: usize) -> Self {
        Self {
            columns: ["tenant", "id"]
                .iter()
                .enumerate()
                .map(|(index, name)| DetailedColumnInfo {
                    name: (*name).into(),
                    data_type: "integer".into(),
                    is_nullable: false,
                    column_default: None,
                    is_primary_key: true,
                    ordinal_position: index as i32,
                    character_maximum_length: None,
                    comment: None,
                })
                .collect(),
            rows: (0..rows)
                .map(|id| json!({"tenant":id / 7,"id":id % 7}))
                .collect(),
            view: false,
            truncated: false,
            fetches: Mutex::new(Vec::new()),
            queries: Mutex::new(Vec::new()),
            metadata_reads: AtomicUsize::new(0),
        }
    }

    fn page(&self, limit: usize, offset: usize, reverse: bool) -> TableData {
        let rows = if reverse {
            self.rows
                .iter()
                .rev()
                .skip(offset)
                .take(limit)
                .cloned()
                .collect()
        } else {
            self.rows.iter().skip(offset).take(limit).cloned().collect()
        };
        TableData {
            columns: self
                .columns
                .iter()
                .map(|column| column.name.clone())
                .collect(),
            rows,
        }
    }
}

#[async_trait]
impl DatabaseAdapter for Adapter {
    async fn test_connection(&self) -> Result<(), String> {
        Ok(())
    }
    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }
    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(vec!["main".into()])
    }
    async fn list_tables(&self, _: Option<&str>) -> Result<Vec<TableInfo>, String> {
        Ok(Vec::new())
    }
    async fn list_columns(
        &self,
        _: Option<&str>,
        _: Option<&str>,
        _: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        Ok(self
            .columns
            .iter()
            .map(|column| ColumnInfo {
                schema: "main".into(),
                table: "items".into(),
                name: column.name.clone(),
                data_type: column.data_type.clone(),
            })
            .collect())
    }
    async fn list_views(&self, _: Option<&str>) -> Result<Vec<TableInfo>, String> {
        Ok(if self.view {
            vec![TableInfo {
                schema: "main".into(),
                name: "items".into(),
            }]
        } else {
            Vec::new()
        })
    }
    async fn list_table_columns_detailed(
        &self,
        _: &str,
        _: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        self.metadata_reads.fetch_add(1, Ordering::SeqCst);
        Ok(self.columns.clone())
    }
    async fn fetch_rows(
        &self,
        _: &str,
        _: &str,
        _: Option<&str>,
        limit: i64,
        offset: i64,
        order: Option<&str>,
        _: bool,
        is_view: bool,
        _: bool,
    ) -> Result<TableData, String> {
        let mut fetches = self.fetches.lock().unwrap();
        let reverse = order.is_none() && fetches.len() % 2 == 0;
        fetches.push(FetchCall {
            limit,
            offset,
            order: order.map(str::to_owned),
            is_view,
        });
        Ok(self.page(limit as usize, offset as usize, reverse))
    }
    async fn count_rows(&self, _: &str, _: &str, _: Option<&str>, _: bool) -> Result<i64, String> {
        Ok(self.rows.len() as i64)
    }
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        self.queries.lock().unwrap().push(sql.into());
        let (prefix, offset) = sql.rsplit_once(" OFFSET ").ok_or("Missing OFFSET")?;
        let (_, limit) = prefix.rsplit_once(" LIMIT ").ok_or("Missing LIMIT")?;
        let page = self.page(
            limit.parse().map_err(|_| "Invalid LIMIT")?,
            offset.parse().map_err(|_| "Invalid OFFSET")?,
            false,
        );
        Ok(QueryResult {
            columns: page.columns,
            rows: page.rows,
            rows_affected: None,
            execution_time_ms: 0,
            truncated: self.truncated,
        })
    }
}

fn source() -> FederationSource {
    FederationSource {
        connection_id: "saved".into(),
        database: None,
        schema: "main".into(),
        table: "items".into(),
        alias: "src".into(),
    }
}

async fn prepare(adapter: &Adapter, kind: DatabaseKind, rows: usize) -> Result<PagePlan, String> {
    let columns = adapter
        .columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<HashSet<_>>();
    PagePlan::prepare(
        adapter,
        kind,
        &source(),
        rows,
        &columns,
        &CancellationToken::new(),
        Instant::now() + Duration::from_secs(30),
    )
    .await
}

#[tokio::test]
async fn source_paging_allows_only_adapter_contracts_with_bounded_total_key_order() {
    for kind in DatabaseKind::ALL {
        let adapter = Adapter::new(513);
        let supported = matches!(
            kind,
            DatabaseKind::Postgres
                | DatabaseKind::Mysql
                | DatabaseKind::Mssql
                | DatabaseKind::Oracle
                | DatabaseKind::Sqlite
                | DatabaseKind::SqliteHttp
                | DatabaseKind::Duckdb
        );
        assert_eq!(
            prepare(&adapter, kind, 513).await.is_ok(),
            supported,
            "{kind:?}"
        );
        assert!(adapter.fetches.lock().unwrap().is_empty());
        assert!(adapter.queries.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn keyless_and_view_sources_never_start_multiple_offset_reads() {
    for view in [false, true] {
        let mut adapter = Adapter::new(513);
        adapter.view = view;
        if !view {
            for column in &mut adapter.columns {
                column.is_primary_key = false;
            }
        }
        let error = prepare(&adapter, DatabaseKind::Sqlite, 513)
            .await
            .err()
            .unwrap();
        assert!(error.contains("mehr als 512") && error.contains("Primärschlüssel"));
        assert!(adapter.fetches.lock().unwrap().is_empty());
        assert!(adapter.queries.lock().unwrap().is_empty());
        let plan = prepare(&adapter, DatabaseKind::Sqlite, MAX_PAGE_ROWS)
            .await
            .unwrap();
        plan.fetch(&adapter, DatabaseKind::Sqlite, &source(), MAX_PAGE_ROWS, 0)
            .await
            .unwrap();
        assert!(plan
            .fetch(&adapter, DatabaseKind::Sqlite, &source(), 1, MAX_PAGE_ROWS)
            .await
            .is_err());
        let calls = adapter.fetches.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].limit, MAX_PAGE_ROWS as i64);
        assert_eq!(calls[0].offset, 0);
        assert!(calls[0].is_view);
    }
}

#[tokio::test]
async fn sqlite_family_pages_sort_every_composite_key_and_never_use_unordered_fetch() {
    for kind in [
        DatabaseKind::Sqlite,
        DatabaseKind::SqliteHttp,
        DatabaseKind::Duckdb,
    ] {
        let adapter = Adapter::new(1024);
        let mut plan = prepare(&adapter, kind, 1024).await.unwrap();
        for offset in [0, 512] {
            let page = plan
                .fetch(&adapter, kind, &source(), 512, offset)
                .await
                .unwrap();
            assert_eq!(page.rows, adapter.rows[offset..offset + 512]);
            plan.accept(&source(), &page).unwrap();
        }
        assert!(adapter.fetches.lock().unwrap().is_empty());
        let sql = adapter.queries.lock().unwrap();
        assert_eq!(sql.len(), 2);
        assert!(sql
            .iter()
            .all(|sql| sql.contains("ORDER BY \"tenant\", \"id\" LIMIT 512 OFFSET ")));
        assert!(sql[0].contains(if kind == DatabaseKind::SqliteHttp {
            "FROM \"items\""
        } else {
            "FROM \"main\".\"items\""
        }));
    }
}

#[tokio::test]
async fn native_stable_key_adapters_receive_an_explicit_first_primary_key() {
    for kind in [
        DatabaseKind::Postgres,
        DatabaseKind::Mysql,
        DatabaseKind::Mssql,
        DatabaseKind::Oracle,
    ] {
        let adapter = Adapter::new(1024);
        let plan = prepare(&adapter, kind, 1024).await.unwrap();
        plan.fetch(&adapter, kind, &source(), 512, 512)
            .await
            .unwrap();
        let calls = adapter.fetches.lock().unwrap();
        assert_eq!(calls[0].order.as_deref(), Some("tenant"));
        assert_eq!(calls[0].limit, 512);
        assert!(!calls[0].is_view);
        assert!(adapter.queries.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn ordered_page_identifier_quoting_truncation_and_pk_validation_fail_closed() {
    let mut quoted = Adapter::new(513);
    quoted.columns[0].name = "tenant\"part".into();
    quoted.columns[1].name = "line id".into();
    let plan = prepare(&quoted, DatabaseKind::Sqlite, 513).await.unwrap();
    plan.fetch(&quoted, DatabaseKind::Sqlite, &source(), 512, 0)
        .await
        .unwrap();
    assert!(quoted.queries.lock().unwrap()[0].contains("ORDER BY \"tenant\"\"part\", \"line id\""));
    assert!(plan
        .fetch(&quoted, DatabaseKind::Sqlite, &source(), 513, 0)
        .await
        .is_err());
    quoted.truncated = true;
    assert!(plan
        .fetch(&quoted, DatabaseKind::Sqlite, &source(), 512, 0)
        .await
        .unwrap_err()
        .contains("gekürzt"));

    let adapter = Adapter::new(513);
    let mut plan = prepare(&adapter, DatabaseKind::Sqlite, 513).await.unwrap();
    let page = adapter.page(512, 0, false);
    plan.accept(&source(), &page).unwrap();
    assert!(plan
        .accept(&source(), &adapter.page(1, 0, false))
        .unwrap_err()
        .contains("doppelte Primärschlüssel"));
    for row in [json!({"tenant":null,"id":1}), json!({"tenant":1})] {
        let mut plan = prepare(&adapter, DatabaseKind::Sqlite, 513).await.unwrap();
        assert!(plan
            .accept(
                &source(),
                &TableData {
                    columns: vec!["tenant".into(), "id".into()],
                    rows: vec![row]
                }
            )
            .unwrap_err()
            .contains("NULL"));
    }
}
