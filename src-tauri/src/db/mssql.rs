use std::ops::{Deref, DerefMut};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use tiberius::{AuthMethod, Client, ColumnData, Config, EncryptionLevel, FromSql, Row};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use super::pool::PoolState;
use super::{
    attach_row_keys, create_table_sql, hex_blob, rows_to_objects, timed, unsupported, where_clause,
    AddColumnRequest, AlterColumnRequest, ColumnInfo, ConstraintInfo, CreateTableRequest,
    DatabaseAdapter, DatabaseOverview, DetailedColumnInfo, ForeignKeyInfo, FunctionInfo, IndexInfo,
    QueryResult, SchemaSize, SequenceInfo, SessionInfo, SslMode, TableData, TableInfo, TriggerInfo,
    TxSession,
};

type MsClient = Client<Compat<TcpStream>>;
type IdleClients = Mutex<Vec<(MsClient, Instant)>>;

const IDLE_MAX: usize = 8;
const IDLE_TTL: Duration = Duration::from_secs(300);

pub struct MssqlAdapter {
    config: Config,
    pool_state: PoolState,
    key: String,
}

struct PooledClient {
    client: Option<MsClient>,
    idle: Arc<IdleClients>,
}

impl PooledClient {
    fn discard(mut self) {
        self.client = None;
    }

    fn into_inner(mut self) -> Option<MsClient> {
        self.client.take()
    }
}

impl Deref for PooledClient {
    type Target = MsClient;
    fn deref(&self) -> &MsClient {
        self.client.as_ref().expect("pooled client already released")
    }
}

impl DerefMut for PooledClient {
    fn deref_mut(&mut self) -> &mut MsClient {
        self.client.as_mut().expect("pooled client already released")
    }
}

impl Drop for PooledClient {
    fn drop(&mut self) {
        let Some(client) = self.client.take() else {
            return;
        };
        let mut idle = self.idle.lock().unwrap_or_else(|e| e.into_inner());
        if idle.len() < IDLE_MAX {
            idle.push((client, Instant::now()));
        }
    }
}

pub fn quote(ident: &str) -> String {
    format!("[{}]", ident.replace(']', "]]"))
}

pub fn lit(value: &str) -> String {
    format!("N'{}'", value.replace('\'', "''"))
}

fn map_err(e: tiberius::error::Error) -> String {
    match e {
        tiberius::error::Error::Server(token) => {
            format!("SQL Server {}: {}", token.code(), token.message())
        }
        other => format!("SQL Server: {other}"),
    }
}

fn value_to_json(data: &ColumnData<'static>) -> serde_json::Value {
    fn num(f: f64) -> serde_json::Value {
        serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            .unwrap_or_else(|| serde_json::Value::String(f.to_string()))
    }
    match data {
        ColumnData::U8(v) => v
            .map(serde_json::Value::from)
            .unwrap_or(serde_json::Value::Null),
        ColumnData::I16(v) => v
            .map(serde_json::Value::from)
            .unwrap_or(serde_json::Value::Null),
        ColumnData::I32(v) => v
            .map(serde_json::Value::from)
            .unwrap_or(serde_json::Value::Null),
        ColumnData::I64(v) => v
            .map(serde_json::Value::from)
            .unwrap_or(serde_json::Value::Null),
        ColumnData::F32(v) => v.map(|f| num(f as f64)).unwrap_or(serde_json::Value::Null),
        ColumnData::F64(v) => v.map(num).unwrap_or(serde_json::Value::Null),
        ColumnData::Bit(v) => v
            .map(serde_json::Value::Bool)
            .unwrap_or(serde_json::Value::Null),
        ColumnData::String(v) => v
            .as_ref()
            .map(|s| serde_json::Value::String(s.to_string()))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::Guid(v) => v
            .map(|g| serde_json::Value::String(g.to_string()))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::Binary(v) => v
            .as_ref()
            .map(|b| serde_json::Value::String(hex_blob(b)))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::Numeric(v) => v
            .map(|n| serde_json::Value::String(n.to_string()))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::Xml(v) => v
            .as_ref()
            .map(|x| serde_json::Value::String(x.as_ref().to_string()))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::DateTime(_) | ColumnData::SmallDateTime(_) | ColumnData::DateTime2(_) => {
            chrono::NaiveDateTime::from_sql(data)
                .ok()
                .flatten()
                .map(|d| serde_json::Value::String(d.to_string()))
                .unwrap_or(serde_json::Value::Null)
        }
        ColumnData::Date(_) => chrono::NaiveDate::from_sql(data)
            .ok()
            .flatten()
            .map(|d| serde_json::Value::String(d.to_string()))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::Time(_) => chrono::NaiveTime::from_sql(data)
            .ok()
            .flatten()
            .map(|d| serde_json::Value::String(d.to_string()))
            .unwrap_or(serde_json::Value::Null),
        ColumnData::DateTimeOffset(_) => chrono::DateTime::<chrono::FixedOffset>::from_sql(data)
            .ok()
            .flatten()
            .map(|d| serde_json::Value::String(d.to_rfc3339()))
            .unwrap_or(serde_json::Value::Null),
    }
}

fn text(row: &Row, index: usize) -> String {
    match value_to_json(
        &row.cells()
            .nth(index)
            .map(|(_, d)| d.clone())
            .unwrap_or(ColumnData::String(None)),
    ) {
        serde_json::Value::String(s) => s,
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn text_opt(row: &Row, index: usize) -> Option<String> {
    let value = text(row, index);
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn int(row: &Row, index: usize) -> i64 {
    match value_to_json(
        &row.cells()
            .nth(index)
            .map(|(_, d)| d.clone())
            .unwrap_or(ColumnData::I64(None)),
    ) {
        serde_json::Value::Number(n) => n.as_i64().unwrap_or(0),
        serde_json::Value::Bool(b) => b as i64,
        serde_json::Value::String(s) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

fn is_result_statement(sql: &str) -> bool {
    let first = sql.split_whitespace().next().unwrap_or("").to_uppercase();
    sql.to_uppercase().contains(" OUTPUT ")
        || matches!(
            first.as_str(),
            "SELECT"
                | "WITH"
                | "EXEC"
                | "EXECUTE"
                | "DECLARE"
                | "SHOW"
                | "DBCC"
                | "SP_HELP"
                | "PRINT"
                | "SET"
        )
}

impl MssqlAdapter {
    pub fn new(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let url = url::Url::parse(connection_string.trim())
            .map_err(|_| "Ungültige SQL-Server-URL".to_string())?;
        if !matches!(url.scheme(), "mssql" | "sqlserver") {
            return Err("Eine mssql:// URL ist erforderlich".to_string());
        }
        let mut config = Config::new();
        config.host(url.host_str().ok_or("Host fehlt")?);
        config.port(url.port().unwrap_or(1433));
        let user = percent_decode(url.username());
        if !user.is_empty() {
            config.authentication(AuthMethod::sql_server(
                user,
                percent_decode(url.password().unwrap_or("")),
            ));
        }
        let path_db = url.path().trim_start_matches('/');
        let db = database
            .filter(|d| !d.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| percent_decode(path_db));
        if !db.is_empty() {
            config.database(db);
        }
        let mut ssl = SslMode::Prefer;
        let mut trust = false;
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "sslmode" => {
                    ssl = serde_json::from_value(serde_json::Value::String(value.into_owned()))
                        .map_err(|_| "Ungültiger SSL-Modus".to_string())?
                }
                "encrypt" => {
                    ssl = match value.to_lowercase().as_str() {
                        "optional" => SslMode::Prefer,
                        "false" | "no" | "0" | "disable" | "disabled" => SslMode::Disable,
                        _ => SslMode::Require,
                    }
                }
                "trust_server_certificate" | "trustservercertificate" => {
                    trust = matches!(value.to_lowercase().as_str(), "true" | "yes" | "1")
                }
                "application_name" | "app" => config.application_name(value.into_owned()),
                "instance" => config.instance_name(value.into_owned()),
                _ => {}
            }
        }
        config.encryption(match ssl {
            SslMode::Disable => EncryptionLevel::NotSupported,
            SslMode::Prefer => EncryptionLevel::Off,
            SslMode::Require | SslMode::VerifyCa | SslMode::VerifyFull => EncryptionLevel::Required,
        });
        if trust {
            config.trust_cert();
        }
        Ok(Self {
            config,
            pool_state,
            key,
        })
    }

    async fn connect(&self) -> Result<PooledClient, String> {
        let idle = self
            .pool_state
            .shared(&self.key, || async {
                Ok::<IdleClients, String>(Mutex::new(Vec::new()))
            })
            .await?;
        let reused = {
            let mut list = idle.lock().unwrap_or_else(|e| e.into_inner());
            list.retain(|(_, since)| since.elapsed() < IDLE_TTL);
            list.pop().map(|(client, _)| client)
        };
        let client = match reused {
            Some(client) => client,
            None => {
                timed(async {
                    let tcp = TcpStream::connect(self.config.get_addr())
                        .await
                        .map_err(|e| format!("Verbindung fehlgeschlagen: {e}"))?;
                    tcp.set_nodelay(true).ok();
                    Client::connect(self.config.clone(), tcp.compat_write())
                        .await
                        .map_err(map_err)
                })
                .await?
            }
        };
        Ok(PooledClient {
            client: Some(client),
            idle,
        })
    }

    async fn dedicated(&self) -> Result<MsClient, String> {
        self.connect()
            .await?
            .into_inner()
            .ok_or_else(|| "SQL Server: Verbindung nicht verfügbar".to_string())
    }

    async fn rows(&self, sql: &str) -> Result<Vec<Row>, String> {
        let mut client = self.connect().await?;
        let result = timed(async {
            let stream = client.simple_query(sql).await.map_err(map_err)?;
            stream.into_first_result().await.map_err(map_err)
        })
        .await;
        if result.is_err() {
            client.discard();
        }
        result
    }

    async fn exec(&self, sql: &str) -> Result<u64, String> {
        let mut client = self.connect().await?;
        let result = timed(async {
            client
                .execute(sql, &[])
                .await
                .map_err(map_err)
                .map(|r| r.total())
        })
        .await;
        if result.is_err() {
            client.discard();
        }
        result
    }

    fn object(schema: &str, name: &str) -> String {
        format!("{}.{}", quote(schema), quote(name))
    }
}

fn percent_decode(value: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", value.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| value.to_string())
}

fn is_tx_control(sql: &str) -> bool {
    let mut words = sql.split_whitespace().map(str::to_uppercase);
    let first = words.next().unwrap_or_default();
    matches!(first.as_str(), "COMMIT" | "ROLLBACK" | "SAVE")
        || (first == "BEGIN" && words.next().is_some_and(|w| w.starts_with("TRAN")))
}

async fn run_query(client: &mut MsClient, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    timed(async {
        if is_tx_control(sql) {
            client
                .simple_query(sql)
                .await
                .map_err(map_err)?
                .into_results()
                .await
                .map_err(map_err)?;
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: None,
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }
        if !is_result_statement(sql) {
            let affected = client.execute(sql, &[]).await.map_err(map_err)?.total();
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: Some(affected),
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }
        let rows = client
            .simple_query(sql)
            .await
            .map_err(map_err)?
            .into_first_result()
            .await
            .map_err(map_err)?;
        let columns: Vec<String> = rows
            .first()
            .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
            .unwrap_or_default();
        let data: Vec<Vec<serde_json::Value>> = rows
            .iter()
            .map(|r| r.cells().map(|(_, d)| value_to_json(d)).collect())
            .collect();
        Ok(QueryResult {
            rows: rows_to_objects(&columns, data),
            columns,
            rows_affected: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    })
    .await
}

struct MssqlTx {
    client: MsClient,
}

#[async_trait]
impl TxSession for MssqlTx {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        run_query(&mut self.client, sql).await
    }
    async fn commit(&mut self) -> Result<(), String> {
        run_query(&mut self.client, "COMMIT").await.map(|_| ())
    }
    async fn rollback(&mut self) -> Result<(), String> {
        run_query(&mut self.client, "ROLLBACK").await.map(|_| ())
    }
}

#[async_trait]
impl DatabaseAdapter for MssqlAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.rows("SELECT 1").await.map(|_| ())
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SELECT name FROM sys.databases WHERE state = 0 ORDER BY name")
            .await?
            .iter()
            .map(|r| text(r, 0))
            .collect())
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(self
            .rows("SELECT name FROM sys.schemas WHERE schema_id < 16384 AND name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') ORDER BY name")
            .await?
            .iter()
            .map(|r| text(r, 0))
            .collect())
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let filter = schema
            .map(|s| format!(" WHERE s.name = {}", lit(s)))
            .unwrap_or_default();
        let sql = format!("SELECT s.name, t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id{filter} ORDER BY s.name, t.name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: text(r, 0),
                name: text(r, 1),
            })
            .collect())
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let kind = if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
            "VIEW"
        } else {
            "BASE TABLE"
        };
        let mut sql = format!("SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS c JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME WHERE t.TABLE_TYPE = '{kind}'");
        if let Some(s) = schema {
            sql.push_str(&format!(" AND c.TABLE_SCHEMA = {}", lit(s)));
        }
        if let Some(t) = table {
            sql.push_str(&format!(" AND c.TABLE_NAME = {}", lit(t)));
        }
        sql.push_str(" ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| ColumnInfo {
                schema: text(r, 0),
                table: text(r, 1),
                name: text(r, 2),
                data_type: text(r, 3),
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
        order_by: Option<&str>,
        order_desc: bool,
        _is_view: bool,
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let where_sql = where_clause(filter, allow_raw_filter)?;
        let detailed = self.list_table_columns_detailed(schema, table).await?;
        let pk: Vec<String> = detailed
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name.clone())
            .collect();
        let columns: Vec<String> = detailed.into_iter().map(|c| c.name).collect();
        let order_sql = match order_by {
            Some(col) if columns.iter().any(|c| c == col) => format!(
                " ORDER BY {} {}",
                quote(col),
                if order_desc { "DESC" } else { "ASC" }
            ),
            _ => " ORDER BY (SELECT NULL)".to_string(),
        };
        let sql = format!(
            "SELECT * FROM {}{}{} OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
            Self::object(schema, table),
            where_sql,
            order_sql,
            offset.max(0),
            limit.max(1)
        );
        let mut result = self.execute_query(&sql).await?;
        attach_row_keys(&mut result.rows, &pk);
        Ok(TableData {
            columns: if columns.is_empty() {
                result.columns
            } else {
                columns
            },
            rows: result.rows,
        })
    }

    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let sql = format!(
            "SELECT COUNT_BIG(*) FROM {}{}",
            Self::object(schema, table),
            where_clause(filter, allow_raw_filter)?
        );
        Ok(self
            .rows(&sql)
            .await?
            .first()
            .map(|r| int(r, 0))
            .unwrap_or(0))
    }

    async fn begin_transaction(&self) -> Result<Box<dyn TxSession>, String> {
        let mut client = self.dedicated().await?;
        run_query(&mut client, "BEGIN TRANSACTION").await?;
        Ok(Box::new(MssqlTx { client }))
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let mut client = self.connect().await?;
        let result = run_query(&mut client, sql).await;
        if result.is_err() || is_tx_control(sql) {
            client.discard();
        }
        result
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let filter = schema
            .map(|s| format!(" WHERE s.name = {}", lit(s)))
            .unwrap_or_default();
        let sql = format!("SELECT s.name, v.name FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id{filter} ORDER BY v.name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| TableInfo {
                schema: text(r, 0),
                name: text(r, 1),
            })
            .collect())
    }

    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let sql = format!(
            "SELECT OBJECT_DEFINITION(OBJECT_ID({}))",
            lit(&Self::object(schema, view))
        );
        self.rows(&sql)
            .await?
            .first()
            .map(|r| text(r, 0))
            .filter(|d| !d.is_empty())
            .ok_or_else(|| "View-Definition nicht verfügbar".to_string())
    }

    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String> {
        let ddl = format!(
            "CREATE OR ALTER VIEW {} AS {}",
            Self::object(schema, view),
            body
        );
        let mut client = self.dedicated().await?;
        timed(async {
            client
                .simple_query("BEGIN TRANSACTION")
                .await
                .map_err(map_err)?
                .into_results()
                .await
                .map_err(map_err)?;
            let result = match client.simple_query(&ddl).await.map_err(map_err) {
                Ok(stream) => stream.into_results().await.map_err(map_err).map(|_| ()),
                Err(e) => Err(e),
            };
            let end = if dry_run || result.is_err() {
                "ROLLBACK TRANSACTION"
            } else {
                "COMMIT TRANSACTION"
            };
            let _ = client.simple_query(end).await;
            result
        })
        .await
    }

    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let filter = schema
            .map(|s| format!(" AND s.name = {}", lit(s)))
            .unwrap_or_default();
        let sql = format!("SELECT s.name, o.name, o.type_desc, o.object_id FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE o.type IN ('FN', 'IF', 'TF', 'P', 'AF', 'FS', 'FT', 'PC'){filter} ORDER BY o.name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| FunctionInfo {
                schema: text(r, 0),
                name: text(r, 1),
                identity_args: String::new(),
                return_type: text(r, 2),
                language: "T-SQL".to_string(),
                oid: text(r, 3),
            })
            .collect())
    }

    async fn get_function_definition(&self, oid: &str) -> Result<String, String> {
        let id: i64 = oid.parse().map_err(|_| "Ungültige Objekt-ID".to_string())?;
        self.rows(&format!("SELECT OBJECT_DEFINITION({id})"))
            .await?
            .first()
            .map(|r| text(r, 0))
            .filter(|d| !d.is_empty())
            .ok_or_else(|| "Definition nicht verfügbar".to_string())
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!("DROP TABLE {}", Self::object(schema, table)))
            .await
            .map(|_| ())
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        self.exec(&format!("TRUNCATE TABLE {}", Self::object(schema, table)))
            .await
            .map(|_| ())
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let sql = format!(
            "SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT, c.ORDINAL_POSITION, c.CHARACTER_MAXIMUM_LENGTH, \
             CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME) THEN 1 ELSE 0 END \
             FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = {} AND c.TABLE_NAME = {} ORDER BY c.ORDINAL_POSITION",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| DetailedColumnInfo {
                name: text(r, 0),
                data_type: text(r, 1),
                is_nullable: text(r, 2) == "YES",
                column_default: text_opt(r, 3),
                ordinal_position: int(r, 4) as i32,
                character_maximum_length: text_opt(r, 5).and_then(|v| v.parse().ok()),
                is_primary_key: int(r, 6) == 1,
            })
            .collect())
    }

    async fn add_column(
        &self,
        schema: &str,
        table: &str,
        column: &AddColumnRequest,
    ) -> Result<(), String> {
        let mut sql = format!(
            "ALTER TABLE {} ADD {} {}",
            Self::object(schema, table),
            quote(&column.name),
            column.data_type
        );
        if !column.is_nullable {
            sql.push_str(" NOT NULL");
        }
        if let Some(d) = column.default_value.as_deref().filter(|d| !d.is_empty()) {
            sql.push_str(&format!(" DEFAULT {d}"));
        }
        self.exec(&sql).await.map(|_| ())
    }

    async fn alter_column(
        &self,
        schema: &str,
        table: &str,
        changes: &AlterColumnRequest,
    ) -> Result<(), String> {
        let current = self
            .list_table_columns_detailed(schema, table)
            .await?
            .into_iter()
            .find(|c| c.name == changes.old_name)
            .ok_or_else(|| format!("Unbekannte Spalte: {}", changes.old_name))?;
        let object = Self::object(schema, table);
        if changes.data_type.is_some() || changes.set_not_null.is_some() {
            let data_type = changes
                .data_type
                .as_deref()
                .filter(|t| !t.is_empty())
                .unwrap_or(&current.data_type);
            let nullable = !changes.set_not_null.unwrap_or(!current.is_nullable);
            self.exec(&format!(
                "ALTER TABLE {object} ALTER COLUMN {} {} {}",
                quote(&changes.old_name),
                data_type,
                if nullable { "NULL" } else { "NOT NULL" }
            ))
            .await?;
        }
        if changes.drop_default || changes.new_default.is_some() {
            let existing = self
                .rows(&format!(
                    "SELECT d.name FROM sys.default_constraints d JOIN sys.columns c ON c.default_object_id = d.object_id WHERE d.parent_object_id = OBJECT_ID({}) AND c.name = {}",
                    lit(&object),
                    lit(&changes.old_name)
                ))
                .await?;
            for row in existing {
                self.exec(&format!(
                    "ALTER TABLE {object} DROP CONSTRAINT {}",
                    quote(&text(&row, 0))
                ))
                .await?;
            }
            if let Some(d) = changes.new_default.as_deref().filter(|d| !d.is_empty()) {
                self.exec(&format!(
                    "ALTER TABLE {object} ADD DEFAULT {d} FOR {}",
                    quote(&changes.old_name)
                ))
                .await?;
            }
        }
        if let Some(new_name) = changes
            .new_name
            .as_deref()
            .filter(|n| !n.is_empty() && *n != changes.old_name)
        {
            self.exec(&format!(
                "EXEC sp_rename {}, {}, 'COLUMN'",
                lit(&format!("{object}.{}", quote(&changes.old_name))),
                lit(new_name)
            ))
            .await?;
        }
        Ok(())
    }

    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String> {
        self.exec(&format!(
            "ALTER TABLE {} DROP COLUMN {}",
            Self::object(schema, table),
            quote(column)
        ))
        .await
        .map(|_| ())
    }

    async fn list_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, String> {
        let sql = format!(
            "SELECT fk.name, ps.name, pt.name, pc.name, rs.name, rt.name, rc.name FROM sys.foreign_keys fk \
             JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id \
             JOIN sys.tables pt ON pt.object_id = fk.parent_object_id JOIN sys.schemas ps ON ps.schema_id = pt.schema_id \
             JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id \
             JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id JOIN sys.schemas rs ON rs.schema_id = rt.schema_id \
             JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id \
             WHERE ps.name = {} AND pt.name = {} ORDER BY fk.name, fkc.constraint_column_id",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| ForeignKeyInfo {
                constraint_name: text(r, 0),
                from_schema: text(r, 1),
                from_table: text(r, 2),
                from_column: text(r, 3),
                to_schema: text(r, 4),
                to_table: text(r, 5),
                to_column: text(r, 6),
            })
            .collect())
    }

    async fn list_triggers(&self, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
        let sql = format!(
            "SELECT tr.name, STUFF((SELECT ' OR ' + te.type_desc FROM sys.trigger_events te WHERE te.object_id = tr.object_id FOR XML PATH('')), 1, 4, ''), \
             CASE WHEN tr.is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END, tr.is_disabled, OBJECT_DEFINITION(tr.object_id) \
             FROM sys.triggers tr JOIN sys.tables t ON t.object_id = tr.parent_id JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = {} AND t.name = {} ORDER BY tr.name",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| TriggerInfo {
                trigger_name: text(r, 0),
                table_schema: schema.to_string(),
                table_name: table.to_string(),
                event: text(r, 1),
                timing: text(r, 2),
                orientation: "STATEMENT".to_string(),
                function_schema: String::new(),
                function_name: String::new(),
                enabled: if int(r, 3) == 1 {
                    "D".to_string()
                } else {
                    "O".to_string()
                },
                definition: text(r, 4),
            })
            .collect())
    }

    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let sql = format!(
            "SELECT i.name, i.is_unique, i.is_primary_key, i.type_desc, c.name FROM sys.indexes i \
             JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id \
             JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
             WHERE i.object_id = OBJECT_ID({}) AND i.name IS NOT NULL ORDER BY i.name, ic.key_ordinal",
            lit(&Self::object(schema, table))
        );
        let mut out: Vec<IndexInfo> = Vec::new();
        for r in self.rows(&sql).await? {
            let name = text(&r, 0);
            let column = text(&r, 4);
            if let Some(existing) = out.iter_mut().find(|i| i.name == name) {
                existing.columns.push(column);
                continue;
            }
            out.push(IndexInfo {
                is_unique: int(&r, 1) == 1,
                is_primary: int(&r, 2) == 1,
                index_type: text(&r, 3).to_lowercase(),
                columns: vec![column],
                definition: String::new(),
                name,
            });
        }
        for idx in &mut out {
            idx.definition = format!(
                "CREATE {}{} INDEX {} ON {} ({})",
                if idx.is_unique { "UNIQUE " } else { "" },
                idx.index_type.to_uppercase(),
                quote(&idx.name),
                Self::object(schema, table),
                idx.columns
                    .iter()
                    .map(|c| quote(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        Ok(out)
    }

    async fn list_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, String> {
        let sql = format!(
            "SELECT tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, STUFF((SELECT ',' + k.COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k WHERE k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA ORDER BY k.ORDINAL_POSITION FOR XML PATH('')), 1, 1, ''), \
             (SELECT cc.CHECK_CLAUSE FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc WHERE cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA) \
             FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc WHERE tc.TABLE_SCHEMA = {} AND tc.TABLE_NAME = {} ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME",
            lit(schema),
            lit(table)
        );
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| {
                let columns: Vec<String> = text_opt(r, 2)
                    .map(|c| c.split(',').map(str::to_string).collect())
                    .unwrap_or_default();
                let constraint_type = text(r, 1);
                let definition = text_opt(r, 3)
                    .map(|check| format!("CHECK {check}"))
                    .unwrap_or_else(|| format!("{constraint_type} ({})", columns.join(", ")));
                ConstraintInfo {
                    name: text(r, 0),
                    constraint_type,
                    columns,
                    definition,
                }
            })
            .collect())
    }

    async fn list_sequences(&self, schema: Option<&str>) -> Result<Vec<SequenceInfo>, String> {
        let filter = schema
            .map(|s| format!(" WHERE s.name = {}", lit(s)))
            .unwrap_or_default();
        let sql = format!("SELECT s.name, q.name, TYPE_NAME(q.user_type_id), CAST(q.start_value AS NVARCHAR(40)), CAST(q.minimum_value AS NVARCHAR(40)), CAST(q.maximum_value AS NVARCHAR(40)), CAST(q.increment AS NVARCHAR(40)), q.is_cycling, CAST(q.current_value AS NVARCHAR(40)) FROM sys.sequences q JOIN sys.schemas s ON s.schema_id = q.schema_id{filter} ORDER BY q.name");
        Ok(self
            .rows(&sql)
            .await?
            .iter()
            .map(|r| SequenceInfo {
                schema: text(r, 0),
                name: text(r, 1),
                data_type: text(r, 2),
                start_value: text(r, 3),
                min_value: text(r, 4),
                max_value: text(r, 5),
                increment_by: text(r, 6),
                cycle: int(r, 7) == 1,
                last_value: text_opt(r, 8),
            })
            .collect())
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        let sql = create_table_sql(req, quote, true);
        let sql = if req.if_not_exists {
            format!(
                "IF OBJECT_ID({}) IS NULL {}",
                lit(&Self::object(&req.schema, &req.name)),
                sql.replacen("IF NOT EXISTS ", "", 1)
            )
        } else {
            sql
        };
        self.exec(&sql).await.map(|_| ())
    }

    async fn explain_query(&self, sql: &str, _analyze: bool) -> Result<serde_json::Value, String> {
        let mut client = self.dedicated().await?;
        timed(async {
            client
                .simple_query("SET SHOWPLAN_ALL ON")
                .await
                .map_err(map_err)?
                .into_results()
                .await
                .map_err(map_err)?;
            let plan = client
                .simple_query(sql)
                .await
                .map_err(map_err)?
                .into_first_result()
                .await
                .map_err(map_err);
            let _ = client.simple_query("SET SHOWPLAN_ALL OFF").await;
            let rows = plan?;
            let columns: Vec<String> = rows
                .first()
                .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
                .unwrap_or_default();
            let data: Vec<Vec<serde_json::Value>> = rows
                .iter()
                .map(|r| r.cells().map(|(_, d)| value_to_json(d)).collect())
                .collect();
            Ok(serde_json::Value::Array(rows_to_objects(&columns, data)))
        })
        .await
    }

    async fn list_sessions(&self) -> Result<Vec<SessionInfo>, String> {
        let sql = "SELECT s.session_id, s.login_name, ISNULL(DB_NAME(s.database_id), ''), ISNULL(s.program_name, ''), ISNULL(c.client_net_address, ''), ISNULL(s.status, ''), ISNULL(t.text, ''), CONVERT(NVARCHAR(30), r.start_time, 126), ISNULL(r.wait_type, ''), CASE WHEN s.session_id = @@SPID THEN 1 ELSE 0 END \
                   FROM sys.dm_exec_sessions s LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t WHERE s.is_user_process = 1 ORDER BY s.session_id";
        Ok(self
            .rows(sql)
            .await?
            .iter()
            .map(|r| SessionInfo {
                pid: int(r, 0) as i32,
                user: text(r, 1),
                database: text(r, 2),
                application: text(r, 3),
                client_addr: text_opt(r, 4),
                state: text_opt(r, 5),
                query: text(r, 6),
                query_start: text_opt(r, 7),
                transaction_start: None,
                wait_event: text_opt(r, 8),
                is_self: int(r, 9) == 1,
                blocked_by: Vec::new(),
            })
            .collect())
    }

    async fn cancel_session(&self, _pid: i32) -> Result<bool, String> {
        Err(unsupported("Abbrechen einzelner Abfragen (nutze Beenden)"))
    }

    async fn terminate_session(&self, pid: i32) -> Result<bool, String> {
        self.exec(&format!("KILL {pid}")).await.map(|_| true)
    }

    async fn create_schema(&self, name: &str) -> Result<(), String> {
        self.exec(&format!("CREATE SCHEMA {}", quote(name)))
            .await
            .map(|_| ())
    }

    async fn drop_schema(&self, name: &str, _cascade: bool) -> Result<(), String> {
        self.exec(&format!("DROP SCHEMA {}", quote(name)))
            .await
            .map(|_| ())
    }

    async fn get_database_overview(&self) -> Result<DatabaseOverview, String> {
        let database = self
            .rows("SELECT DB_NAME()")
            .await?
            .first()
            .map(|r| text(r, 0))
            .unwrap_or_default();
        let size_bytes = self.rows("SELECT CAST(SUM(CAST(size AS BIGINT)) * 8 * 1024 AS BIGINT) FROM sys.database_files").await?.first().map(|r| int(r, 0)).unwrap_or(0);
        let rows = self
            .rows("SELECT s.name, COUNT(DISTINCT t.object_id), ISNULL(SUM(CAST(p.used_page_count AS BIGINT)) * 8 * 1024, 0) FROM sys.schemas s LEFT JOIN sys.tables t ON t.schema_id = s.schema_id LEFT JOIN sys.dm_db_partition_stats p ON p.object_id = t.object_id WHERE s.schema_id < 16384 AND s.name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') GROUP BY s.name ORDER BY s.name")
            .await?;
        Ok(DatabaseOverview {
            database,
            size_bytes,
            size_pretty: super::pretty_bytes(size_bytes),
            schemas: rows
                .iter()
                .map(|r| SchemaSize {
                    schema: text(r, 0),
                    table_count: int(r, 1),
                    size_bytes: int(r, 2),
                })
                .collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_url_options() {
        let pool = crate::db::pool::create_pool_state();
        let adapter = MssqlAdapter::new("mssql://sa:P%40ss@db.example.com:1434/master?encrypt=true&trust_server_certificate=true", Some("other"), pool.clone(), "k".into()).unwrap();
        assert_eq!(adapter.config.get_addr(), "db.example.com:1434");
        assert!(MssqlAdapter::new("mysql://x@y/z", None, pool, "k".into()).is_err());
        assert!(is_result_statement("  select 1"));
        assert!(!is_result_statement("UPDATE t SET a = 1"));
        assert!(is_result_statement(
            "INSERT INTO t OUTPUT INSERTED.* DEFAULT VALUES"
        ));
        assert!(is_tx_control("begin tran"));
        assert!(is_tx_control("ROLLBACK"));
        assert!(!is_tx_control("BEGIN SELECT 1 END"));
    }
}
