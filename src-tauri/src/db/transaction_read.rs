use super::{map_pg_err, ora, oracle, quote, DatabaseKind, TransactionEntry, TransactionManager};
use crate::db::execution::guarded;
use crate::db::postgres::{capped_count, capped_count_sql, relation_name, table_page_sql};
use crate::db::{attach_row_keys, quote_ident, where_clause, RowCount, TableData};

#[derive(Clone)]
pub struct TransactionTableRead {
    pub schema: String,
    pub table: String,
    pub filter: Option<String>,
    pub limit: i64,
    pub offset: i64,
    pub order_by: Option<String>,
    pub order_desc: bool,
    pub is_view: bool,
    pub allow_raw: bool,
}

impl TransactionTableRead {
    pub fn order_sql(&self, columns: &[String], kind: DatabaseKind) -> String {
        match self.order_by.as_ref() {
            Some(column) if columns.contains(column) => format!(
                " ORDER BY {} {}",
                quote(kind, column),
                if self.order_desc { "DESC" } else { "ASC" }
            ),
            _ if kind == DatabaseKind::Mssql => " ORDER BY (SELECT NULL)".to_string(),
            _ => String::new(),
        }
    }
}

impl TransactionManager {
    pub async fn fetch_rows(
        &self,
        tx_id: &str,
        request: TransactionTableRead,
    ) -> Result<TableData, String> {
        let where_sql = where_clause(request.filter.as_deref(), request.allow_raw)?;
        let entry = self.entry(tx_id).await?;
        match &*entry {
            TransactionEntry::Oracle(c) => {
                ora(c.clone(), move |c| oracle::tx_fetch_rows(c, &request)).await
            }
            TransactionEntry::Generic(g) => {
                let detailed = g
                    .adapter
                    .list_table_columns_detailed(&request.schema, &request.table)
                    .await?;
                let pk: Vec<String> = detailed
                    .iter()
                    .filter(|column| column.is_primary_key)
                    .map(|column| column.name.clone())
                    .collect();
                let columns: Vec<String> = detailed.into_iter().map(|column| column.name).collect();
                let order_sql = request.order_sql(&columns, g.kind);
                let pagination = if g.kind == DatabaseKind::Mssql {
                    format!(
                        " OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
                        request.offset.max(0),
                        request.limit.max(1)
                    )
                } else {
                    format!(
                        " LIMIT {} OFFSET {}",
                        request.limit.max(0),
                        request.offset.max(0)
                    )
                };
                let sql = format!(
                    "SELECT * FROM {}{}{}{}",
                    g.target(&request.schema, &request.table),
                    where_sql,
                    order_sql,
                    pagination
                );
                let mut result = g.execute(&sql).await?;
                if !request.is_view {
                    attach_row_keys(&mut result.rows, &pk);
                }
                Ok(TableData {
                    columns: if columns.is_empty() {
                        result.columns
                    } else {
                        columns
                    },
                    rows: result.rows,
                })
            }
            TransactionEntry::Pg(c, ssl) => {
                let conn = c.lock().await?;
                pg_read(&conn, *ssl, async {
                    let column_rows = conn.query(
                        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
                        &[&request.schema, &request.table],
                    ).await.map_err(map_pg_err)?;
                    let columns: Vec<String> = column_rows.iter().map(|row| row.get(0)).collect();
                    let order = request
                        .order_by
                        .as_deref()
                        .filter(|column| columns.iter().any(|name| name == column))
                        .map(|column| (column, request.order_desc));
                    let sql = table_page_sql(
                        &request.schema,
                        &request.table,
                        &where_sql,
                        order,
                        !request.is_view,
                    );
                    let data = conn.query(&sql, &[&request.limit.max(0), &request.offset.max(0)])
                        .await.map_err(map_pg_err)?;
                    Ok(TableData { columns, rows: data.iter().map(|row| row.get(0)).collect() })
                })
                .await
            }
        }
    }

    pub async fn count_rows(
        &self,
        tx_id: &str,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw: bool,
    ) -> Result<i64, String> {
        let where_sql = where_clause(filter, allow_raw)?;
        let entry = self.entry(tx_id).await?;
        match &*entry {
            TransactionEntry::Oracle(c) => {
                let sql = format!(
                    "SELECT COUNT(*) AS N FROM {}.{}{}",
                    oracle::quote(schema),
                    oracle::quote(table),
                    where_sql
                );
                let result = ora(c.clone(), move |c| oracle::tx_execute(c, &sql)).await?;
                count_value(&result.rows)
            }
            TransactionEntry::Generic(g) => {
                let aggregate = if g.kind == DatabaseKind::Mssql {
                    "COUNT_BIG(*)"
                } else {
                    "COUNT(*)"
                };
                let sql = format!(
                    "SELECT {} AS N FROM {}{}",
                    aggregate,
                    g.target(schema, table),
                    where_sql
                );
                count_value(&g.execute(&sql).await?.rows)
            }
            TransactionEntry::Pg(c, ssl) => {
                let conn = c.lock().await?;
                let sql = format!(
                    "SELECT COUNT(*) FROM {}.{}{}",
                    quote_ident(schema),
                    quote_ident(table),
                    where_sql
                );
                pg_read(&conn, *ssl, async {
                    conn.query_one(&sql, &[])
                        .await
                        .map(|row| row.get(0))
                        .map_err(map_pg_err)
                })
                .await
            }
        }
    }

    pub async fn count_rows_capped(
        &self,
        tx_id: &str,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw: bool,
        cap: i64,
    ) -> Result<RowCount, String> {
        let entry = self.entry(tx_id).await?;
        let TransactionEntry::Pg(c, ssl) = &*entry else {
            return self
                .count_rows(tx_id, schema, table, filter, allow_raw)
                .await
                .map(RowCount::exact);
        };
        let where_sql = where_clause(filter, allow_raw)?;
        let sql = capped_count_sql(schema, table, &where_sql, cap);
        let name = relation_name(schema, table);
        let conn = c.lock().await?;
        pg_read(&conn, *ssl, async {
            let row = conn.query_one(&sql, &[&name]).await.map_err(map_pg_err)?;
            Ok(capped_count(
                row.get(0),
                row.get(1),
                cap,
                !where_sql.is_empty(),
            ))
        })
        .await
    }
}

async fn pg_read<T, F>(
    conn: &tokio_postgres::Client,
    ssl: crate::db::SslMode,
    read: F,
) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    conn.batch_execute("SAVEPOINT l8_read")
        .await
        .map_err(map_pg_err)?;
    let result = guarded(conn.cancel_token(), ssl, None, read).await;
    if result.is_err() {
        conn.batch_execute("ROLLBACK TO SAVEPOINT l8_read")
            .await
            .map_err(map_pg_err)?;
    }
    conn.batch_execute("RELEASE SAVEPOINT l8_read")
        .await
        .map_err(map_pg_err)?;
    result
}

fn count_value(rows: &[serde_json::Value]) -> Result<i64, String> {
    rows.first()
        .and_then(serde_json::Value::as_object)
        .and_then(|row| row.values().next())
        .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
        .ok_or_else(|| "Zeilenanzahl konnte nicht gelesen werden".to_string())
}
