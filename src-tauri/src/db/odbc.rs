use std::sync::OnceLock;

use async_trait::async_trait;
use odbc_api::buffers::TextRowSet;
use odbc_api::parameter::VarCharArray;
use odbc_api::{Connection, ConnectionOptions, Cursor, Environment};

use super::pool::PoolState;
use super::{
    create_table_sql, rows_to_objects, where_clause, ColumnInfo, CreateTableRequest,
    DatabaseAdapter, DetailedColumnInfo, QueryResult, TableData, TableInfo,
};

pub struct OdbcAdapter {
    connection_string: String,
}

pub fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

fn environment() -> Result<&'static Environment, String> {
    static ENV: OnceLock<Result<Environment, String>> = OnceLock::new();
    ENV.get_or_init(|| {
        unsafe {
            Environment::set_connection_pooling(odbc_api::sys::AttrConnectionPooling::DriverAware)
                .ok();
        }
        let mut env = Environment::new()
            .map_err(|e| format!("ODBC-Treibermanager nicht verfügbar: {e}"))?;
        env.set_connection_pooling_matching(odbc_api::sys::AttrCpMatch::Strict)
            .ok();
        Ok(env)
    })
    .as_ref()
    .map_err(Clone::clone)
}

fn map_err(e: odbc_api::Error) -> String {
    format!("ODBC: {e}")
}

fn escape(value: &str) -> String {
    if value.contains([';', '{', '}', '=']) {
        format!("{{{}}}", value.replace('}', "}}"))
    } else {
        value.to_string()
    }
}

pub fn connection_string_from_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if !trimmed.starts_with("odbc://") {
        if trimmed.contains('=') && trimmed.contains(';')
            || trimmed.to_lowercase().starts_with("dsn=")
            || trimmed.to_lowercase().starts_with("driver=")
        {
            return Ok(trimmed.to_string());
        }
        return Err("Eine odbc:// URL oder ein ODBC-Connection-String (Driver=...;Server=...) ist erforderlich".to_string());
    }
    let url = url::Url::parse(trimmed).map_err(|_| "Ungültige ODBC-URL".to_string())?;
    let mut parts: Vec<(String, String)> = Vec::new();
    for (k, v) in url.query_pairs() {
        parts.push((k.into_owned(), v.into_owned()));
    }
    if let Some(host) = url.host_str() {
        if !has(&parts, "Server") && !has(&parts, "Hostname") && !has(&parts, "Host") {
            parts.push(("Server".to_string(), host.to_string()));
        }
        if let Some(port) = url.port() {
            if !has(&parts, "Port") {
                parts.push(("Port".to_string(), port.to_string()));
            }
        }
    }
    let database = percent(url.path().trim_start_matches('/'));
    if !database.is_empty()
        && !has(&parts, "Database")
        && !has(&parts, "DBQ")
        && !has(&parts, "Dbname")
    {
        parts.push(("Database".to_string(), database));
    }
    if !url.username().is_empty() && !has(&parts, "UID") {
        parts.push(("UID".to_string(), percent(url.username())));
    }
    if let Some(pw) = url.password() {
        if !has(&parts, "PWD") {
            parts.push(("PWD".to_string(), percent(pw)));
        }
    }
    if parts.is_empty() {
        return Err(
            "Die ODBC-URL enthält keine Parameter (mindestens Driver= oder DSN=)".to_string(),
        );
    }
    Ok(parts
        .into_iter()
        .map(|(k, v)| format!("{k}={}", escape(&v)))
        .collect::<Vec<_>>()
        .join(";"))
}

fn percent(value: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", value.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| value.to_string())
}

fn has(parts: &[(String, String)], key: &str) -> bool {
    parts.iter().any(|(k, _)| k.eq_ignore_ascii_case(key))
}

fn var<const N: usize>(value: &VarCharArray<N>) -> String {
    value.as_str().ok().flatten().unwrap_or("").to_string()
}

fn read_cursor(
    mut cursor: impl Cursor,
    max_rows: Option<usize>,
) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>), String> {
    let columns: Vec<String> = cursor
        .column_names()
        .map_err(map_err)?
        .collect::<Result<_, _>>()
        .map_err(map_err)?;
    let mut buffers = TextRowSet::for_cursor(500, &mut cursor, Some(65536)).map_err(map_err)?;
    let mut block = cursor.bind_buffer(&mut buffers).map_err(map_err)?;
    let mut rows = Vec::new();
    'outer: while let Some(batch) = block.fetch().map_err(map_err)? {
        for row_index in 0..batch.num_rows() {
            let values: Vec<serde_json::Value> = (0..batch.num_cols())
                .map(|col| match batch.at(col, row_index) {
                    Some(bytes) => {
                        serde_json::Value::String(String::from_utf8_lossy(bytes).into_owned())
                    }
                    None => serde_json::Value::Null,
                })
                .collect();
            rows.push(values);
            if max_rows.is_some_and(|m| rows.len() >= m) {
                break 'outer;
            }
        }
    }
    Ok((columns, rows))
}

fn text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

impl OdbcAdapter {
    pub fn new(
        connection_string: &str,
        _pool_state: PoolState,
        _key: String,
    ) -> Result<Self, String> {
        Ok(Self {
            connection_string: connection_string_from_url(connection_string)?,
        })
    }

    async fn run<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&Connection<'static>) -> Result<T, String> + Send + 'static,
    {
        let connection_string = self.connection_string.clone();
        tokio::task::spawn_blocking(move || {
            let env = environment()?;
            let conn = env
                .connect_with_connection_string(
                    &connection_string,
                    ConnectionOptions {
                        login_timeout_sec: Some(10),
                        ..Default::default()
                    },
                )
                .map_err(|e| format!("ODBC-Verbindung fehlgeschlagen: {e}"))?;
            f(&conn)
        })
        .await
        .map_err(|e| format!("ODBC-Task fehlgeschlagen: {e}"))?
    }

    async fn query(
        &self,
        sql: String,
        max_rows: Option<usize>,
    ) -> Result<(Vec<String>, Vec<Vec<serde_json::Value>>), String> {
        self.run(
            move |conn| match conn.execute(&sql, (), Some(30)).map_err(map_err)? {
                Some(cursor) => read_cursor(cursor, max_rows),
                None => Ok((vec![], vec![])),
            },
        )
        .await
    }

    async fn exec(&self, sql: String) -> Result<(), String> {
        self.run(move |conn| {
            conn.execute(&sql, (), Some(30))
                .map_err(map_err)
                .map(|_| ())
        })
        .await
    }

    async fn catalog_tables(
        &self,
        schema: Option<&str>,
        table_type: &str,
    ) -> Result<Vec<TableInfo>, String> {
        let schema = schema.map(str::to_string);
        let table_type = table_type.to_string();
        self.run(move |conn| {
            let mut tables = Vec::new();
            for row in conn
                .tables("", schema.as_deref().unwrap_or("%"), "%", &table_type)
                .map_err(map_err)?
            {
                let row = row.map_err(map_err)?;
                tables.push(TableInfo {
                    schema: var(&row.schema),
                    name: var(&row.table),
                });
            }
            tables.sort_by(|a, b| (&a.schema, &a.name).cmp(&(&b.schema, &b.name)));
            Ok(tables)
        })
        .await
    }
}

#[async_trait]
impl DatabaseAdapter for OdbcAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.run(|_| Ok(())).await
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        self.run(|conn| Ok(vec![conn.current_catalog().unwrap_or_default()]))
            .await
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        self.run(|conn| {
            let mut schemas = Vec::new();
            for row in conn.tables("", "%", "", "").map_err(map_err)? {
                let schema = var(&row.map_err(map_err)?.schema);
                if !schema.is_empty() {
                    schemas.push(schema);
                }
            }
            schemas.sort();
            schemas.dedup();
            if schemas.is_empty() {
                schemas.push(String::new());
            }
            Ok(schemas)
        })
        .await
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        self.catalog_tables(schema, "TABLE").await
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        self.catalog_tables(schema, "VIEW").await
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let tables = match table {
            Some(t) => vec![TableInfo {
                schema: schema.unwrap_or_default().to_string(),
                name: t.to_string(),
            }],
            None => {
                self.catalog_tables(
                    schema,
                    if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
                        "VIEW"
                    } else {
                        "TABLE"
                    },
                )
                .await?
            }
        };
        let mut out = Vec::new();
        for t in tables {
            for c in self.list_table_columns_detailed(&t.schema, &t.name).await? {
                out.push(ColumnInfo {
                    schema: t.schema.clone(),
                    table: t.name.clone(),
                    name: c.name,
                    data_type: c.data_type,
                });
            }
        }
        Ok(out)
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let (schema, table) = (schema.to_string(), table.to_string());
        self.run(move |conn| {
            let mut columns = Vec::new();
            for row in conn.columns("", &schema, &table, "%").map_err(map_err)? {
                let row = row.map_err(map_err)?;
                columns.push(DetailedColumnInfo {
                    name: var(&row.column_name),
                    data_type: var(&row.type_name),
                    is_nullable: row.nullable != 0,
                    column_default: Some(var(&row.column_default)).filter(|d| !d.is_empty()),
                    is_primary_key: false,
                    ordinal_position: row.ordinal_position,
                    character_maximum_length: row.column_size.into_opt(),
                });
            }
            Ok(columns)
        })
        .await
    }

    async fn fetch_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        limit: i64,
        offset: i64,
        order_by: Option<&str>,
        order_desc: bool,
        _is_view: bool,
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let where_sql = where_clause(filter, allow_raw_filter)?;
        let target = if schema.is_empty() {
            quote(table)
        } else {
            format!("{}.{}", quote(schema), quote(table))
        };
        let order_sql = order_by
            .map(|c| {
                format!(
                    " ORDER BY {} {}",
                    quote(c),
                    if order_desc { "DESC" } else { "ASC" }
                )
            })
            .unwrap_or_default();
        let (limit, offset) = (limit.max(0) as usize, offset.max(0) as usize);
        let (columns, rows) = self
            .query(
                format!("SELECT * FROM {target}{where_sql}{order_sql}"),
                Some(limit + offset),
            )
            .await?;
        let page: Vec<Vec<serde_json::Value>> = rows.into_iter().skip(offset).take(limit).collect();
        Ok(TableData {
            rows: rows_to_objects(&columns, page),
            columns,
        })
    }

    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let target = if schema.is_empty() {
            quote(table)
        } else {
            format!("{}.{}", quote(schema), quote(table))
        };
        let (_, rows) = self
            .query(
                format!(
                    "SELECT COUNT(*) FROM {target}{}",
                    where_clause(filter, allow_raw_filter)?
                ),
                Some(1),
            )
            .await?;
        Ok(rows
            .first()
            .and_then(|r| text(&r[0]).trim().parse().ok())
            .unwrap_or(0))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let sql = sql.trim().to_string();
        let (columns, rows, affected) = self
            .run(move |conn| {
                let mut statement = conn.preallocate().map_err(map_err)?;
                let fetched = match statement.execute(&sql, ()).map_err(map_err)? {
                    Some(cursor) => Some(read_cursor(cursor, Some(10_000))?),
                    None => None,
                };
                match fetched {
                    Some((columns, rows)) => Ok((columns, rows, None)),
                    None => {
                        let affected = statement.row_count().map_err(map_err)?.map(|n| n as u64);
                        Ok((vec![], vec![], affected))
                    }
                }
            })
            .await?;
        Ok(QueryResult {
            rows: rows_to_objects(&columns, rows),
            columns,
            rows_affected: affected,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let target = if schema.is_empty() {
            quote(table)
        } else {
            format!("{}.{}", quote(schema), quote(table))
        };
        self.exec(format!("DROP TABLE {target}")).await
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let target = if schema.is_empty() {
            quote(table)
        } else {
            format!("{}.{}", quote(schema), quote(table))
        };
        self.exec(format!("DELETE FROM {target}")).await
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        self.exec(
            create_table_sql(req, quote, !req.schema.is_empty()).replacen("IF NOT EXISTS ", "", 1),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_connection_strings() {
        assert_eq!(
            connection_string_from_url("odbc://db2inst1:p%3Bw@localhost:50000/SAMPLE?Driver=IBM%20DB2%20ODBC%20DRIVER").unwrap(),
            "Driver=IBM DB2 ODBC DRIVER;Server=localhost;Port=50000;Database=SAMPLE;UID=db2inst1;PWD={p;w}"
        );
        assert_eq!(
            connection_string_from_url("DSN=mydsn;UID=a").unwrap(),
            "DSN=mydsn;UID=a"
        );
        assert!(connection_string_from_url("odbc://").is_err());
    }
}
