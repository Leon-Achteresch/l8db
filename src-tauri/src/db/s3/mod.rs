pub mod client;
pub mod commands;
#[cfg(test)]
mod live_tests;
mod object_read;
#[cfg(test)]
mod object_read_tests;
pub mod ops;
pub mod select;
pub mod transfer;
pub mod xml;

use std::sync::OnceLock;

use async_trait::async_trait;
use regex::Regex;
use serde_json::json;

use super::{timed, ColumnInfo, DatabaseAdapter, QueryResult, TableData, TableInfo};
use client::S3;
use ops::ObjectEntry;

const MAX_SORTED: usize = 100_000;

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

fn prefix_filter(filter: Option<&str>) -> Result<String, String> {
    static CONDITION: OnceLock<Regex> = OnceLock::new();
    let prefix = filter
        .map(|f| f.trim().trim_matches(|c| c == '\'' || c == '"').to_string())
        .unwrap_or_default();
    let condition = CONDITION.get_or_init(|| {
        Regex::new(r"(?i)^\w+\s*(<>|!=|<=|>=|<|>)|^\w+\s+(=|like|in|is|between)\s")
            .expect("Bedingungsmuster")
    });
    if condition.is_match(&prefix) {
        return Err(format!(
            "Bei Objektspeicher ist der Filter ein Schlüssel-Präfix (z. B. logs/2026/), keine Bedingung: {prefix}"
        ));
    }
    Ok(prefix)
}

fn sort_objects(objects: &mut [ObjectEntry], column: &str, desc: bool) {
    objects.sort_by(|a, b| {
        let order = match column {
            "size" => a.size.cmp(&b.size),
            "last_modified" => a.last_modified.cmp(&b.last_modified),
            "storage_class" => a.storage_class.cmp(&b.storage_class),
            "etag" => a.etag.cmp(&b.etag),
            _ => std::cmp::Ordering::Equal,
        }
        .then_with(|| a.key.cmp(&b.key));
        if desc {
            order.reverse()
        } else {
            order
        }
    });
}

#[async_trait]
impl DatabaseAdapter for S3Adapter {
    async fn test_connection(&self) -> Result<(), String> {
        let s3 = self.client().await?;
        match &s3.default_bucket {
            Some(bucket) => timed(s3.head_bucket(bucket)).await,
            None => timed(s3.list_buckets()).await.map(|_| ()),
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
        order_by: Option<&str>,
        order_desc: bool,
        _is_view: bool,
        _allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let prefix = prefix_filter(filter)?;
        let s3 = self.client().await?;
        let (skip, take) = (offset.max(0) as usize, limit.max(1) as usize);
        let order = order_by
            .filter(|c| COLUMNS.iter().any(|(name, _)| name == c))
            .filter(|c| *c != "key" || order_desc);
        let mut objects = Vec::new();
        match order {
            None => {
                let mut seen = 0usize;
                timed(s3.for_each_object(table, &prefix, |o| {
                    seen += 1;
                    if seen > skip {
                        objects.push(o);
                    }
                    objects.len() < take
                }))
                .await?;
            }
            Some(column) => {
                let full = timed(s3.for_each_object(table, &prefix, |o| {
                    objects.push(o);
                    objects.len() <= MAX_SORTED
                }))
                .await?;
                if full {
                    return Err(format!(
                        "Sortieren nach „{column}“ geht bei höchstens {MAX_SORTED} Objekten. Bitte mit einem Präfix eingrenzen."
                    ));
                }
                sort_objects(&mut objects, column, order_desc);
                objects = objects.into_iter().skip(skip).take(take).collect();
            }
        }
        Ok(TableData {
            columns: COLUMNS.iter().map(|(n, _)| n.to_string()).collect(),
            rows: objects
                .into_iter()
                .map(|o| {
                    json!({
                        "key": o.key,
                        "size": o.size,
                        "last_modified": o.last_modified,
                        "storage_class": o.storage_class,
                        "etag": o.etag,
                    })
                })
                .collect(),
        })
    }

    async fn count_rows(
        &self,
        _schema: &str,
        table: &str,
        filter: Option<&str>,
        _allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let prefix = prefix_filter(filter)?;
        let s3 = self.client().await?;
        let mut count = 0i64;
        timed(s3.for_each_object(table, &prefix, |_| {
            count += 1;
            true
        }))
        .await?;
        Ok(count)
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let s3 = self.client().await?;
        timed(select::execute(&s3, sql)).await
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::http_mock::{self, MockServer};

    pub(crate) fn bucket_server(objects: usize) -> MockServer {
        http_mock::start(move |request| {
            let start: usize = request
                .query("continuation-token")
                .and_then(|t| t.parse().ok())
                .unwrap_or(0);
            let max: usize = request
                .query("max-keys")
                .and_then(|m| m.parse().ok())
                .unwrap_or(1000);
            let end = (start + max).min(objects);
            let contents: String = (start..end)
                .map(|i| {
                    format!(
                        "<Contents><Key>obj-{i:05}</Key><Size>{}</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified><StorageClass>STANDARD</StorageClass></Contents>",
                        (i * 7919) % 1000
                    )
                })
                .collect();
            let next = if end < objects {
                format!("<IsTruncated>true</IsTruncated><NextContinuationToken>{end}</NextContinuationToken>")
            } else {
                "<IsTruncated>false</IsTruncated>".to_string()
            };
            (
                200,
                format!("<ListBucketResult>{next}{contents}</ListBucketResult>").into_bytes(),
            )
        })
    }

    pub(crate) fn url(server: &MockServer) -> String {
        format!(
            "s3://ak:sk@us-east-1?endpoint={}",
            url::form_urlencoded::byte_serialize(server.base.as_bytes()).collect::<String>()
        )
    }

    fn lists(server: &MockServer) -> usize {
        server
            .requests()
            .iter()
            .filter(|r| r.query("list-type").is_some())
            .count()
    }

    #[tokio::test]
    async fn fetch_rows_honours_large_limits_and_stops_paging() {
        let server = bucket_server(12_000);
        let adapter = S3Adapter::new(&url(&server)).unwrap();
        let data = adapter
            .fetch_rows("", "b", None, 11_500, 0, None, false, false, false)
            .await
            .unwrap();
        assert_eq!(data.rows.len(), 11_500);
        assert_eq!(data.rows[11_499]["key"], "obj-11499");
        assert_eq!(lists(&server), 12);
        let server = bucket_server(12_000);
        let adapter = S3Adapter::new(&url(&server)).unwrap();
        let data = adapter
            .fetch_rows("", "b", None, 3, 2_000, None, false, false, false)
            .await
            .unwrap();
        assert_eq!(data.rows[0]["key"], "obj-02000");
        assert_eq!(lists(&server), 3);
        assert_eq!(
            adapter.count_rows("", "b", None, false).await.unwrap(),
            12_000
        );
    }

    #[tokio::test]
    async fn fetch_rows_sorts_by_column() {
        let server = bucket_server(2_500);
        let adapter = S3Adapter::new(&url(&server)).unwrap();
        let data = adapter
            .fetch_rows("", "b", None, 5, 0, Some("size"), true, false, false)
            .await
            .unwrap();
        let sizes: Vec<u64> = data
            .rows
            .iter()
            .map(|r| r["size"].as_u64().unwrap())
            .collect();
        assert_eq!(sizes, [999, 999, 999, 998, 998]);
        assert_eq!(lists(&server), 3);
        let data = adapter
            .fetch_rows("", "b", None, 2, 0, Some("key"), true, false, false)
            .await
            .unwrap();
        assert_eq!(data.rows[0]["key"], "obj-02499");
    }

    #[test]
    fn rejects_sql_conditions_as_prefix() {
        assert_eq!(prefix_filter(Some("'logs/2026/'")).unwrap(), "logs/2026/");
        assert_eq!(prefix_filter(Some("year=2026/")).unwrap(), "year=2026/");
        assert!(prefix_filter(Some("size > 10")).is_err());
        assert!(prefix_filter(Some("key like 'a%'")).is_err());
        assert!(prefix_filter(Some("id = 3")).is_err());
    }
}
