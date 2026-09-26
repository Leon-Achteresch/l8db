pub mod client;
pub mod commands;
#[cfg(test)]
mod live_tests;
pub mod ops;
pub mod select;
pub mod transfer;
pub mod xml;

use async_trait::async_trait;
use serde_json::json;

use super::{timed, ColumnInfo, DatabaseAdapter, QueryResult, TableData, TableInfo};
use client::S3;

const COLUMNS: [(&str, &str); 5] = [
    ("key", "string"),
    ("size", "bigint"),
    ("last_modified", "timestamp"),
    ("storage_class", "string"),
    ("etag", "string"),
];

pub struct S3Adapter {
    connection_string: String,
}

impl S3Adapter {
    pub fn new(connection_string: &str) -> Result<Self, String> {
        super::aws::parse_url(connection_string, "s3")?;
        Ok(Self {
            connection_string: connection_string.to_string(),
        })
    }

    async fn client(&self) -> Result<S3, String> {
        S3::connect(&self.connection_string).await
    }
}

fn prefix_filter(filter: Option<&str>) -> String {
    filter
        .map(|f| f.trim().trim_matches(|c| c == '\'' || c == '"').to_string())
        .unwrap_or_default()
}

#[async_trait]
impl DatabaseAdapter for S3Adapter {
    async fn test_connection(&self) -> Result<(), String> {
        let s3 = self.client().await?;
        match (&s3.default_bucket, timed(s3.list_buckets()).await) {
            (Some(bucket), _) => timed(s3.head_bucket(bucket)).await,
            (None, result) => result.map(|_| ()),
        }
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }

    async fn list_tables(&self, _schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let s3 = self.client().await?;
        Ok(timed(s3.list_buckets())
            .await?
            .into_iter()
            .map(|b| TableInfo {
                schema: String::new(),
                name: b.name,
            })
            .collect())
    }

    async fn list_columns(
        &self,
        _schema: Option<&str>,
        table: Option<&str>,
        _table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let tables = match table {
            Some(t) => vec![t.to_string()],
            None => self
                .list_tables(None)
                .await?
                .into_iter()
                .map(|t| t.name)
                .collect(),
        };
        Ok(tables
            .iter()
            .flat_map(|table| {
                COLUMNS.iter().map(move |(name, data_type)| ColumnInfo {
                    schema: String::new(),
                    table: table.clone(),
                    name: name.to_string(),
                    data_type: data_type.to_string(),
                })
            })
            .collect())
    }

    async fn fetch_rows(
        &self,
        _schema: &str,
        table: &str,
        filter: Option<&str>,
        limit: i64,
        offset: i64,
        _order_by: Option<&str>,
        _order_desc: bool,
        _is_view: bool,
        _allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let s3 = self.client().await?;
        let (skip, take) = (offset.max(0) as usize, limit.clamp(1, 10_000) as usize);
        let mut rows = Vec::new();
        let mut seen = 0usize;
        timed(s3.for_each_object(table, &prefix_filter(filter), |o| {
            seen += 1;
            if seen > skip {
                rows.push(json!({
                    "key": o.key,
                    "size": o.size,
                    "last_modified": o.last_modified,
                    "storage_class": o.storage_class,
                    "etag": o.etag,
                }));
            }
            rows.len() < take
        }))
        .await?;
        Ok(TableData {
            columns: COLUMNS.iter().map(|(n, _)| n.to_string()).collect(),
            rows,
        })
    }

    async fn count_rows(
        &self,
        _schema: &str,
        table: &str,
        filter: Option<&str>,
        _allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let s3 = self.client().await?;
        let stats = timed(s3.bucket_stats(table, &prefix_filter(filter))).await?;
        Ok(stats.objects as i64)
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let s3 = self.client().await?;
        timed(select::execute(&s3, sql)).await
    }
}
