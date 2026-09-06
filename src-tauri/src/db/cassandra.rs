use std::sync::Arc;

use async_trait::async_trait;
use scylla::client::session::Session;
use scylla::client::session_builder::SessionBuilder;
use scylla::value::{CqlValue, Row};

use super::pool::PoolState;
use super::{
    hex_blob, rows_to_objects, timed, unsupported, where_clause, AddColumnRequest,
    AlterColumnRequest, ColumnInfo, CreateTableRequest, DatabaseAdapter, DetailedColumnInfo,
    IndexInfo, QueryResult, TableData, TableInfo,
};

pub struct CassandraAdapter {
    nodes: Vec<String>,
    user: Option<(String, String)>,
    keyspace: Option<String>,
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
    format!("Cassandra: {e}")
}

fn value_to_json(value: Option<CqlValue>) -> serde_json::Value {
    let Some(value) = value else {
        return serde_json::Value::Null;
    };
    match value {
        CqlValue::Ascii(s) | CqlValue::Text(s) => serde_json::Value::String(s),
        CqlValue::Boolean(b) => serde_json::Value::Bool(b),
        CqlValue::Blob(b) => serde_json::Value::String(hex_blob(&b)),
        CqlValue::Counter(c) => serde_json::Value::from(c.0),
        CqlValue::Double(d) => serde_json::Number::from_f64(d)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        CqlValue::Float(f) => serde_json::Number::from_f64(f as f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        CqlValue::Int(i) => serde_json::Value::from(i),
        CqlValue::BigInt(i) => serde_json::Value::from(i),
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
        CqlValue::List(items) | CqlValue::Set(items) => {
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

fn text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

impl CassandraAdapter {
    pub fn new(
        connection_string: &str,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige Cassandra-URL".to_string())?;
        if !matches!(url.scheme(), "cassandra" | "scylla" | "cql") {
            return Err("Eine cassandra:// URL ist erforderlich".to_string());
        }
        let host = url.host_str().ok_or("Host fehlt")?;
        let port = url.port().unwrap_or(9042);
        let mut nodes = vec![format!("{host}:{port}")];
        for (k, v) in url.query_pairs() {
            if k == "nodes" || k == "hosts" {
                nodes.extend(v.split(',').map(|n| {
                    if n.contains(':') {
                        n.to_string()
                    } else {
                        format!("{n}:{port}")
                    }
                }));
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
        Ok(Self {
            nodes,
            user,
            keyspace,
            pool_state,
            key,
        })
    }

    async fn session(&self) -> Result<Arc<Session>, String> {
        let (nodes, user, keyspace) =
            (self.nodes.clone(), self.user.clone(), self.keyspace.clone());
        self.pool_state
            .shared(&self.key, || async move {
                let mut builder = SessionBuilder::new()
                    .known_nodes(&nodes)
                    .connection_timeout(std::time::Duration::from_secs(10));
                if let Some((u, p)) = user {
                    builder = builder.user(u, p);
                }
                if let Some(ks) = keyspace {
                    builder = builder.use_keyspace(ks, true);
                }
                timed(async { builder.build().await.map_err(map_err) }).await
            })
            .await
    }

    async fn query(&self, cql: &str) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>), String> {
        let session = self.session().await?;
        let result =
            timed(async { session.query_unpaged(cql, &[]).await.map_err(map_err) }).await?;
        let rows_result = match result.into_rows_result() {
            Ok(r) => r,
            Err(scylla::response::query_result::IntoRowsResultError::ResultNotRows(_)) => {
                return Ok((vec![], vec![]))
            }
            Err(e) => return Err(map_err(e)),
        };
        let columns: Vec<String> = rows_result
            .column_specs()
            .iter()
            .map(|c| c.name().to_string())
            .collect();
        let mut rows = Vec::new();
        for row in rows_result.rows::<Row>().map_err(map_err)? {
            let row = row.map_err(map_err)?;
            rows.push(row.columns.into_iter().map(value_to_json).collect());
        }
        Ok((columns, rows))
    }

    async fn exec(&self, cql: &str) -> Result<(), String> {
        self.query(cql).await.map(|_| ())
    }

    fn keyspace_filter(&self, schema: Option<&str>) -> Result<String, String> {
        schema
            .map(str::to_string)
            .or_else(|| self.keyspace.clone())
            .ok_or_else(|| "Kein Keyspace gewählt".to_string())
    }
}

fn percent(value: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", value.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| value.to_string())
}

fn with_filtering(sql: String, has_filter: bool) -> String {
    if has_filter {
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
        let (_, rows) = self.query(&format!("SELECT column_name, type, kind, position FROM system_schema.columns WHERE keyspace_name = {} AND table_name = {}", lit(schema), lit(table))).await?;
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

    async fn fetch_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        limit: i64,
        offset: i64,
        _order_by: Option<&str>,
        _order_desc: bool,
        _is_view: bool,
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let where_sql = where_clause(filter, allow_raw_filter)?;
        let columns: Vec<String> = self
            .list_table_columns_detailed(schema, table)
            .await?
            .into_iter()
            .map(|c| c.name)
            .collect();
        let (limit, offset) = (limit.max(0) as usize, offset.max(0) as usize);
        let cql = with_filtering(
            format!(
                "SELECT * FROM {}.{}{} LIMIT {}",
                quote(schema),
                quote(table),
                where_sql,
                (limit + offset).max(1)
            ),
            !where_sql.is_empty(),
        );
        let (cols, rows) = self.query(&cql).await?;
        let page: Vec<Vec<serde_json::Value>> = rows.into_iter().skip(offset).take(limit).collect();
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
        let where_sql = where_clause(filter, allow_raw_filter)?;
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

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let (columns, rows) = self.query(sql.trim().trim_end_matches(';')).await?;
        Ok(QueryResult {
            rows: rows_to_objects(&columns, rows),
            columns,
            rows_affected: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
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

    #[test]
    fn parses_nodes_and_keyspace() {
        let a = CassandraAdapter::new(
            "cassandra://cassandra:pw@node1:9042/app?nodes=node2,node3:9043",
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
