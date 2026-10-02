use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::Mutex;

use super::pool::PoolState;
use super::provider::DatabaseKind;
use super::{
    map_pg_err, mssql, mysql, oracle, quote_ident, sqlite, DatabaseAdapter, QueryResult, TxSession,
};

#[path = "transaction_read.rs"]
mod read;

pub use read::TransactionTableRead;

#[cfg(test)]
#[path = "transaction_table_tests.rs"]
mod table_tests;

#[cfg(test)]
#[path = "transaction_pg_row_tests.rs"]
mod pg_row_tests;

static TX_COUNTER: AtomicU64 = AtomicU64::new(1);

pub(crate) const PG_ROW_ID: &str = "ctid::text || '@' || tableoid::text";

#[derive(Debug, PartialEq)]
pub(crate) struct PgRowId {
    ctid: String,
    tableoid: Option<u32>,
}

impl PgRowId {
    pub(crate) fn parse(raw: &str) -> Result<Self, String> {
        let raw = raw.trim();
        let (ctid, tableoid) = match raw.split_once('@') {
            Some((ctid, oid)) => (
                ctid.trim(),
                Some(
                    oid.trim()
                        .parse::<u32>()
                        .map_err(|_| "Ungültige ctid".to_string())?,
                ),
            ),
            None => (raw, None),
        };
        let parts = ctid
            .strip_prefix('(')
            .and_then(|rest| rest.strip_suffix(')'))
            .and_then(|inner| inner.split_once(','))
            .and_then(|(block, offset)| {
                Some((
                    block.trim().parse::<u32>().ok()?,
                    offset.trim().parse::<u16>().ok()?,
                ))
            });
        let Some((block, offset)) = parts else {
            return Err("Ungültige ctid".to_string());
        };
        Ok(Self {
            ctid: format!("({block},{offset})"),
            tableoid,
        })
    }

    pub(crate) fn filter(&self, schema: &str, table: &str) -> String {
        let relation = match self.tableoid {
            Some(oid) => format!("{oid}::oid"),
            None => format!(
                "{}::regclass",
                super::quote_literal(&format!("{}.{}", quote_ident(schema), quote_ident(table)))
            ),
        };
        format!("ctid = '{}'::tid AND tableoid = {relation}", self.ctid)
    }
}

type OracleConn = Arc<std::sync::Mutex<oracle::Connection>>;

enum TransactionEntry {
    Pg(Arc<super::execution::PgSession>, super::connection::PgTls),
    Oracle(OracleConn),
    Generic(Generic),
    Dynamo(Box<super::dynamodb::DynamoTx>),
}

struct Generic {
    kind: DatabaseKind,
    adapter: Box<dyn DatabaseAdapter>,
    session: Mutex<Box<dyn TxSession>>,
}

type Key = serde_json::Map<String, serde_json::Value>;

fn quote(kind: DatabaseKind, ident: &str) -> String {
    match kind {
        DatabaseKind::Mysql => mysql::quote(ident),
        DatabaseKind::Mssql => mssql::quote(ident),
        _ => sqlite::quote(ident),
    }
}

fn lit(kind: DatabaseKind, value: &str) -> String {
    match kind {
        DatabaseKind::Mysql => mysql::lit(value),
        DatabaseKind::Mssql => mssql::lit(value),
        _ => format!("'{}'", value.replace('\'', "''")),
    }
}

fn json_lit(kind: DatabaseKind, value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(t) => lit(kind, t),
        other => lit(kind, &other.to_string()),
    }
}

fn binary_lit(kind: DatabaseKind, value: &str) -> Option<String> {
    let hex = super::hex_blob_body(value)?;
    match kind {
        DatabaseKind::Mysql | DatabaseKind::Sqlite | DatabaseKind::SqliteHttp => {
            Some(format!("X'{hex}'"))
        }
        DatabaseKind::Mssql => Some(format!("0x{hex}")),
        _ => None,
    }
}

fn value_lit(
    kind: DatabaseKind,
    binary: &HashSet<String>,
    col: &str,
    value: &Option<String>,
) -> String {
    match value.as_deref() {
        Some(v) if binary.contains(col) => binary_lit(kind, v).unwrap_or_else(|| lit(kind, v)),
        _ => opt_lit(kind, value),
    }
}

fn opt_lit(kind: DatabaseKind, value: &Option<String>) -> String {
    value
        .as_deref()
        .map(|v| lit(kind, v))
        .unwrap_or_else(|| "NULL".to_string())
}

fn parse_key(ctid: &str) -> Result<Key, String> {
    serde_json::from_str::<Key>(ctid)
        .ok()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| {
            "Zeile hat keinen Primärschlüssel und kann nicht bearbeitet werden".to_string()
        })
}

fn key_lit(kind: DatabaseKind, binary: bool, value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) if binary => {
            binary_lit(kind, text).unwrap_or_else(|| lit(kind, text))
        }
        other => json_lit(kind, other),
    }
}

fn where_key(kind: DatabaseKind, key: &Key, binary: &HashSet<String>) -> String {
    key.iter()
        .map(|(col, val)| match val {
            serde_json::Value::Null => format!("{} IS NULL", quote(kind, col)),
            other => format!(
                "{} = {}",
                quote(kind, col),
                key_lit(kind, binary.contains(col), other)
            ),
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn json_to_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(t) => Some(t.clone()),
        other => Some(other.to_string()),
    }
}

fn text_to_json(value: &Option<String>) -> serde_json::Value {
    value
        .clone()
        .map(serde_json::Value::String)
        .unwrap_or(serde_json::Value::Null)
}

impl Generic {
    fn target(&self, schema: &str, table: &str) -> String {
        if schema.is_empty() {
            quote(self.kind, table)
        } else {
            format!("{}.{}", quote(self.kind, schema), quote(self.kind, table))
        }
    }

    async fn primary_key(&self, schema: &str, table: &str) -> Result<Vec<String>, String> {
        Ok(self
            .adapter
            .list_table_columns_detailed(schema, table)
            .await?
            .into_iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name)
            .collect())
    }

    async fn where_key(&self, schema: &str, table: &str, key: &Key) -> Result<String, String> {
        let values: HashMap<String, Option<String>> = key
            .iter()
            .map(|(col, value)| (col.clone(), json_to_text(value)))
            .collect();
        let binary = self.binary_columns(schema, table, &values).await?;
        Ok(where_key(self.kind, key, &binary))
    }

    async fn execute(&self, sql: &str) -> Result<QueryResult, String> {
        self.session.lock().await.execute(sql).await
    }

    async fn binary_columns(
        &self,
        schema: &str,
        table: &str,
        values: &HashMap<String, Option<String>>,
    ) -> Result<HashSet<String>, String> {
        let needed = values.values().any(|v| {
            v.as_deref()
                .is_some_and(|v| binary_lit(self.kind, v).is_some())
        });
        if !needed {
            return Ok(HashSet::new());
        }
        Ok(self
            .adapter
            .list_table_columns_detailed(schema, table)
            .await?
            .into_iter()
            .filter(|c| super::is_binary_column_type(&c.data_type))
            .map(|c| c.name)
            .collect())
    }

    async fn update_row(
        &self,
        schema: &str,
        table: &str,
        ctid: &str,
        updates: &HashMap<String, Option<String>>,
    ) -> Result<String, String> {
        let mut key = parse_key(ctid)?;
        if updates.is_empty() {
            return Ok(ctid.to_string());
        }
        let binary = self.binary_columns(schema, table, updates).await?;
        let set_parts: Vec<String> = updates
            .iter()
            .map(|(col, val)| {
                format!(
                    "{} = {}",
                    quote(self.kind, col),
                    value_lit(self.kind, &binary, col, val)
                )
            })
            .collect();
        let sql = format!(
            "UPDATE {} SET {} WHERE {}",
            self.target(schema, table),
            set_parts.join(", "),
            self.where_key(schema, table, &key).await?
        );
        if self.execute(&sql).await?.rows_affected == Some(0) {
            return Err("Zeile nicht gefunden".to_string());
        }
        for (col, val) in updates {
            if key.contains_key(col) {
                key.insert(col.clone(), text_to_json(val));
            }
        }
        Ok(serde_json::Value::Object(key).to_string())
    }

    async fn insert_row(
        &self,
        schema: &str,
        table: &str,
        values: &HashMap<String, Option<String>>,
    ) -> Result<serde_json::Value, String> {
        let target = self.target(schema, table);
        let pk = self.primary_key(schema, table).await?;
        let cols: Vec<String> = values.keys().map(|c| quote(self.kind, c)).collect();
        let binary = self.binary_columns(schema, table, values).await?;
        let vals: Vec<String> = values
            .iter()
            .map(|(col, v)| value_lit(self.kind, &binary, col, v))
            .collect();
        let (col_sql, val_sql) = if values.is_empty() {
            match self.kind {
                DatabaseKind::Mysql => ("()".to_string(), "VALUES ()".to_string()),
                _ => (String::new(), "DEFAULT VALUES".to_string()),
            }
        } else {
            (
                format!("({})", cols.join(", ")),
                format!("VALUES ({})", vals.join(", ")),
            )
        };
        let mut row = match self.kind {
            DatabaseKind::Mssql => {
                let sql = format!("INSERT INTO {target} {col_sql} OUTPUT INSERTED.* {val_sql}");
                self.execute(&sql).await?.rows.into_iter().next()
            }
            DatabaseKind::SqliteHttp => {
                let sql = format!("INSERT INTO {target} {col_sql} {val_sql} RETURNING *");
                self.execute(&sql).await?.rows.into_iter().next()
            }
            _ => {
                self.execute(&format!("INSERT INTO {target} {col_sql} {val_sql}"))
                    .await?;
                let where_sql = match self.kind {
                    DatabaseKind::Sqlite => "rowid = last_insert_rowid()".to_string(),
                    _ if pk.len() == 1 && !values.contains_key(&pk[0]) => {
                        format!("{} = LAST_INSERT_ID()", quote(self.kind, &pk[0]))
                    }
                    _ => {
                        let key: Key = pk
                            .iter()
                            .filter_map(|c| values.get(c).map(|v| (c.clone(), text_to_json(v))))
                            .collect();
                        if key.len() != pk.len() {
                            let obj: Key = values
                                .iter()
                                .map(|(k, v)| (k.clone(), text_to_json(v)))
                                .collect();
                            return Ok(serde_json::Value::Object(obj));
                        }
                        self.where_key(schema, table, &key).await?
                    }
                };
                self.execute(&format!("SELECT * FROM {target} WHERE {where_sql}"))
                    .await?
                    .rows
                    .into_iter()
                    .next()
            }
        }
        .ok_or_else(|| "Zeile konnte nicht eingefügt werden".to_string())?;
        super::attach_row_keys(std::slice::from_mut(&mut row), &pk);
        Ok(row)
    }

    async fn duplicate_row(
        &self,
        schema: &str,
        table: &str,
        ctid: &str,
    ) -> Result<serde_json::Value, String> {
        let key = parse_key(ctid)?;
        let pk = self.primary_key(schema, table).await?;
        let sql = format!(
            "SELECT * FROM {} WHERE {}",
            self.target(schema, table),
            self.where_key(schema, table, &key).await?
        );
        let source = self
            .execute(&sql)
            .await?
            .rows
            .into_iter()
            .next()
            .ok_or_else(|| "Zeile nicht gefunden".to_string())?;
        let auto_pk = pk.len() == 1 && source.get(&pk[0]).is_some_and(|v| v.is_number());
        let values: HashMap<String, Option<String>> = source
            .as_object()
            .map(|obj| {
                obj.iter()
                    .filter(|(k, _)| !(auto_pk && *k == &pk[0]))
                    .map(|(k, v)| (k.clone(), json_to_text(v)))
                    .collect()
            })
            .unwrap_or_default();
        self.insert_row(schema, table, &values).await
    }

    async fn delete_row(&self, schema: &str, table: &str, ctid: &str) -> Result<(), String> {
        let key = parse_key(ctid)?;
        let sql = format!(
            "DELETE FROM {} WHERE {}",
            self.target(schema, table),
            self.where_key(schema, table, &key).await?
        );
        let res = self.execute(&sql).await?;
        if res.rows_affected == Some(0) {
            return Err("Zeile nicht gefunden".to_string());
        }
        Ok(())
    }
}

async fn ora<T, F>(conn: OracleConn, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut oracle::Connection) -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let mut guard = conn
            .lock()
            .map_err(|_| "Oracle-Verbindung ist blockiert".to_string())?;
        f(&mut guard)
    })
    .await
    .map_err(|e| format!("Oracle-Task fehlgeschlagen: {e}"))?
}

pub struct TransactionManager {
    transactions: Mutex<HashMap<String, Arc<TransactionEntry>>>,
}

pub type TransactionState = Arc<TransactionManager>;

pub fn create_transaction_state() -> TransactionState {
    Arc::new(TransactionManager {
        transactions: Mutex::new(HashMap::new()),
    })
}

impl TransactionManager {
    pub async fn supports_cancel(&self, tx_id: &str) -> bool {
        match self.entry(tx_id).await.as_deref() {
            Ok(TransactionEntry::Pg(..)) => true,
            Ok(TransactionEntry::Generic(g)) => g.kind == DatabaseKind::Sqlite,
            _ => false,
        }
    }

    async fn insert_entry(&self, entry: TransactionEntry) -> String {
        let tx_id = format!("tx_{}", TX_COUNTER.fetch_add(1, Ordering::Relaxed));
        self.transactions
            .lock()
            .await
            .insert(tx_id.clone(), Arc::new(entry));
        tx_id
    }

    async fn entry(&self, tx_id: &str) -> Result<Arc<TransactionEntry>, String> {
        self.transactions
            .lock()
            .await
            .get(tx_id)
            .cloned()
            .ok_or_else(|| "Transaktion nicht gefunden".to_string())
    }

    pub async fn begin(
        &self,
        kind: DatabaseKind,
        connection_string: &str,
        database: Option<&str>,
        pool_state: &PoolState,
    ) -> Result<String, String> {
        match kind {
            DatabaseKind::Postgres => {}
            DatabaseKind::Oracle => {
                let key = super::connection::connection_key(connection_string, database);
                let adapter =
                    oracle::OracleAdapter::new(connection_string, pool_state.clone(), key)?;
                let mut conn = adapter.open_connection().await?;
                oracle::tx_begin(
                    conn.get_mut()
                        .map_err(|_| "Oracle-Verbindung ist blockiert")?,
                );
                return Ok(self
                    .insert_entry(TransactionEntry::Oracle(Arc::new(conn)))
                    .await);
            }
            DatabaseKind::Dynamodb => {
                let key = super::connection::connection_key(connection_string, database);
                let tx = Box::new(super::dynamodb::DynamoTx::new(connection_string, key)?);
                return Ok(self.insert_entry(TransactionEntry::Dynamo(tx)).await);
            }
            kind => {
                let adapter = super::create_adapter_from_string(
                    kind,
                    connection_string,
                    database,
                    pool_state.clone(),
                )?;
                let session = adapter.begin_transaction().await?;
                return Ok(self
                    .insert_entry(TransactionEntry::Generic(Generic {
                        kind,
                        adapter,
                        session: Mutex::new(session),
                    }))
                    .await);
            }
        }
        let (config, ssl) = super::connection::parse_connection(connection_string, database)?;
        let conn = super::execution::connect_postgres(&config, &ssl).await?;
        super::postgres::begin_guarded(&conn, "BEGIN", &[super::postgres::TRANSACTION_IDLE_GUARD])
            .await
            .map_err(map_pg_err)?;
        Ok(self
            .insert_entry(TransactionEntry::Pg(
                Arc::new(super::execution::PgSession::new(conn)),
                ssl,
            ))
            .await)
    }

    pub async fn execute_with_params(
        &self,
        tx_id: &str,
        sql: &str,
        params: &[Option<String>],
    ) -> Result<QueryResult, String> {
        let entry = self.entry(tx_id).await?;
        let (session, ssl) = match &*entry {
            TransactionEntry::Pg(c, ssl) => (c, ssl.clone()),
            _ => {
                return Err(super::unsupported("Bind-Parameter"));
            }
        };
        let conn = session.lock().await?;
        let outcome = super::execution::postgres(
            &conn,
            &ssl,
            Some(session),
            super::postgres::run_params_query(&conn, sql, params),
        )
        .await;
        session.finish(outcome)
    }

    pub async fn versioning_adapter(
        &self,
        tx_id: &str,
        pool: PoolState,
    ) -> Result<Box<dyn DatabaseAdapter>, String> {
        match &*self.entry(tx_id).await? {
            TransactionEntry::Pg(session, ssl) => Ok(Box::new(
                super::postgres::PostgresAdapter::from_session(session.clone(), ssl.clone(), pool),
            )),
            _ => Err("Transaktionsgebundene Metadaten benötigen PostgreSQL".into()),
        }
    }

    pub async fn versioning_oracle_timeout(
        &self,
        tx_id: &str,
        milliseconds: u64,
    ) -> Result<(), String> {
        if !(100..=3_600_000).contains(&milliseconds) {
            return Err("Ungültiges Oracle-Zeitlimit".into());
        }
        match &*self.entry(tx_id).await? {
            TransactionEntry::Oracle(c) => {
                ora(c.clone(), move |c| {
                    c.set_call_timeout(Some(std::time::Duration::from_millis(milliseconds)))
                        .map_err(|e| e.to_string())
                })
                .await
            }
            _ => Err("Zeitlimit benötigt eine Oracle-Sitzung".into()),
        }
    }

    pub async fn execute(&self, tx_id: &str, sql: &str) -> Result<QueryResult, String> {
        let entry = self.entry(tx_id).await?;
        let (session, ssl) = match &*entry {
            TransactionEntry::Pg(c, ssl) => (c, ssl.clone()),
            TransactionEntry::Oracle(c) => {
                let sql = sql.to_string();
                return ora(c.clone(), move |c| oracle::tx_execute(c, &sql)).await;
            }
            TransactionEntry::Generic(g) => return g.execute(sql).await,
            TransactionEntry::Dynamo(d) => return d.execute(sql).await,
        };
        let conn = session.lock().await?;
        let outcome = super::execution::postgres(
            &conn,
            &ssl,
            Some(session),
            super::postgres::run_simple_query(&conn, sql),
        )
        .await;
        session.finish(outcome)
    }

    pub async fn update_row(
        &self,
        tx_id: &str,
        schema: &str,
        table: &str,
        ctid: &str,
        updates: &HashMap<String, Option<String>>,
    ) -> Result<String, String> {
        let entry = self.entry(tx_id).await?;
        let conn = match &*entry {
            TransactionEntry::Pg(c, _) => c,
            TransactionEntry::Oracle(c) => {
                let (schema, table, ctid, updates) = (
                    schema.to_string(),
                    table.to_string(),
                    ctid.to_string(),
                    updates.clone(),
                );
                return ora(c.clone(), move |c| {
                    oracle::tx_update_row(c, &schema, &table, &ctid, &updates)
                })
                .await;
            }
            TransactionEntry::Generic(g) => {
                return g.update_row(schema, table, ctid, updates).await
            }
            TransactionEntry::Dynamo(d) => return d.update_row(table, ctid, updates).await,
        };

        let row_id = PgRowId::parse(ctid)?;
        let conn = conn.lock().await?;

        let col_rows = conn
            .query(
                "SELECT column_name FROM information_schema.columns \
                 WHERE table_schema = $1 AND table_name = $2",
                &[&schema, &table],
            )
            .await
            .map_err(map_pg_err)?;

        let valid_columns: std::collections::HashSet<String> =
            col_rows.iter().map(|r| r.get::<_, String>(0)).collect();

        let mut set_parts: Vec<String> = Vec::new();
        for (col, val) in updates {
            if !valid_columns.contains(col) {
                return Err(format!("Unbekannte Spalte: {col}"));
            }
            let sql_val = match val {
                None => "NULL".to_string(),
                Some(s) => format!("'{}'", s.replace('\'', "''")),
            };
            set_parts.push(format!("{} = {}", quote_ident(col), sql_val));
        }

        if set_parts.is_empty() {
            return Ok(ctid.to_string());
        }

        let sql = format!(
            "UPDATE {}.{} SET {} WHERE {} RETURNING {PG_ROW_ID}",
            quote_ident(schema),
            quote_ident(table),
            set_parts.join(", "),
            row_id.filter(schema, table),
        );

        conn.batch_execute("SAVEPOINT l8_op")
            .await
            .map_err(map_pg_err)?;
        match conn.query(sql.as_str(), &[]).await {
            Ok(rows) => {
                conn.batch_execute("RELEASE SAVEPOINT l8_op")
                    .await
                    .map_err(map_pg_err)?;
                match rows.first() {
                    Some(row) => Ok(row.get::<_, String>(0)),
                    None => Err("Zeile nicht gefunden".to_string()),
                }
            }
            Err(e) => {
                let _ = conn.batch_execute("ROLLBACK TO SAVEPOINT l8_op").await;
                Err(map_pg_err(e))
            }
        }
    }

    pub async fn insert_row(
        &self,
        tx_id: &str,
        schema: &str,
        table: &str,
        values: &HashMap<String, Option<String>>,
    ) -> Result<serde_json::Value, String> {
        let entry = self.entry(tx_id).await?;
        let conn = match &*entry {
            TransactionEntry::Pg(c, _) => c,
            TransactionEntry::Oracle(c) => {
                let (schema, table, values) =
                    (schema.to_string(), table.to_string(), values.clone());
                return ora(c.clone(), move |c| {
                    oracle::tx_insert_row(c, &schema, &table, &values)
                })
                .await;
            }
            TransactionEntry::Generic(g) => return g.insert_row(schema, table, values).await,
            TransactionEntry::Dynamo(d) => return d.insert_row(table, values).await,
        };
        let conn = conn.lock().await?;

        let col_rows = conn
            .query(
                "SELECT column_name FROM information_schema.columns \
                 WHERE table_schema = $1 AND table_name = $2",
                &[&schema, &table],
            )
            .await
            .map_err(map_pg_err)?;

        let valid_columns: std::collections::HashSet<String> =
            col_rows.iter().map(|r| r.get::<_, String>(0)).collect();

        let target = format!("{}.{}", quote_ident(schema), quote_ident(table));

        let sql = if values.is_empty() {
            format!(
                "WITH ins AS (INSERT INTO {target} DEFAULT VALUES RETURNING *, {PG_ROW_ID} AS __l8_ctid) \
                 SELECT (to_jsonb(ins) - '__l8_ctid') || jsonb_build_object('__ctid__', __l8_ctid::text) FROM ins",
            )
        } else {
            let mut cols: Vec<String> = Vec::new();
            let mut vals: Vec<String> = Vec::new();
            for (col, val) in values {
                if !valid_columns.contains(col) {
                    return Err(format!("Unbekannte Spalte: {col}"));
                }
                cols.push(quote_ident(col));
                vals.push(match val {
                    None => "NULL".to_string(),
                    Some(s) => format!("'{}'", s.replace('\'', "''")),
                });
            }
            format!(
                "WITH ins AS (INSERT INTO {target} ({}) VALUES ({}) RETURNING *, {PG_ROW_ID} AS __l8_ctid) \
                 SELECT (to_jsonb(ins) - '__l8_ctid') || jsonb_build_object('__ctid__', __l8_ctid::text) FROM ins",
                cols.join(", "),
                vals.join(", "),
            )
        };

        conn.batch_execute("SAVEPOINT l8_op")
            .await
            .map_err(map_pg_err)?;
        match conn.query(sql.as_str(), &[]).await {
            Ok(rows) => {
                conn.batch_execute("RELEASE SAVEPOINT l8_op")
                    .await
                    .map_err(map_pg_err)?;
                match rows.first() {
                    Some(row) => Ok(row.get::<_, super::exact_number::ExactJson>(0).0),
                    None => Err("Zeile konnte nicht eingefügt werden".to_string()),
                }
            }
            Err(e) => {
                let _ = conn.batch_execute("ROLLBACK TO SAVEPOINT l8_op").await;
                Err(map_pg_err(e))
            }
        }
    }

    pub async fn duplicate_row(
        &self,
        tx_id: &str,
        schema: &str,
        table: &str,
        ctid: &str,
    ) -> Result<serde_json::Value, String> {
        let entry = self.entry(tx_id).await?;
        let conn = match &*entry {
            TransactionEntry::Pg(c, _) => c,
            TransactionEntry::Oracle(c) => {
                let (schema, table, ctid) =
                    (schema.to_string(), table.to_string(), ctid.to_string());
                return ora(c.clone(), move |c| {
                    oracle::tx_duplicate_row(c, &schema, &table, &ctid)
                })
                .await;
            }
            TransactionEntry::Generic(g) => return g.duplicate_row(schema, table, ctid).await,
            TransactionEntry::Dynamo(_) => {
                return Err("DynamoDB-Zeilen lassen sich nur mit neuem Schlüssel duplizieren. Nutze Zeile einfügen.".to_string())
            }
        };

        let row_id = PgRowId::parse(ctid)?;
        let conn = conn.lock().await?;

        let col_rows = conn
            .query(
                "SELECT column_name FROM information_schema.columns \
                 WHERE table_schema = $1 AND table_name = $2 \
                 AND is_generated <> 'ALWAYS' AND is_identity <> 'YES' \
                 AND (column_default IS NULL OR column_default NOT LIKE 'nextval(%') \
                 ORDER BY ordinal_position",
                &[&schema, &table],
            )
            .await
            .map_err(map_pg_err)?;

        let cols: Vec<String> = col_rows
            .iter()
            .map(|r| quote_ident(&r.get::<_, String>(0)))
            .collect();

        let target = format!("{}.{}", quote_ident(schema), quote_ident(table));

        let sql = if cols.is_empty() {
            format!(
                "WITH ins AS (INSERT INTO {target} DEFAULT VALUES RETURNING *, {PG_ROW_ID} AS __l8_ctid) \
                 SELECT (to_jsonb(ins) - '__l8_ctid') || jsonb_build_object('__ctid__', __l8_ctid::text) FROM ins",
            )
        } else {
            let col_list = cols.join(", ");
            let row_filter = row_id.filter(schema, table);
            format!(
                "WITH ins AS (INSERT INTO {target} ({col_list}) \
                 SELECT {col_list} FROM {target} WHERE {row_filter} \
                 RETURNING *, {PG_ROW_ID} AS __l8_ctid) \
                 SELECT (to_jsonb(ins) - '__l8_ctid') || jsonb_build_object('__ctid__', __l8_ctid::text) FROM ins",
            )
        };

        conn.batch_execute("SAVEPOINT l8_op")
            .await
            .map_err(map_pg_err)?;
        match conn.query(sql.as_str(), &[]).await {
            Ok(rows) => {
                conn.batch_execute("RELEASE SAVEPOINT l8_op")
                    .await
                    .map_err(map_pg_err)?;
                match rows.first() {
                    Some(row) => Ok(row.get::<_, super::exact_number::ExactJson>(0).0),
                    None => Err("Zeile konnte nicht dupliziert werden".to_string()),
                }
            }
            Err(e) => {
                let _ = conn.batch_execute("ROLLBACK TO SAVEPOINT l8_op").await;
                Err(map_pg_err(e))
            }
        }
    }

    pub async fn delete_row(
        &self,
        tx_id: &str,
        schema: &str,
        table: &str,
        ctid: &str,
    ) -> Result<(), String> {
        let entry = self.entry(tx_id).await?;
        let conn = match &*entry {
            TransactionEntry::Pg(c, _) => c,
            TransactionEntry::Oracle(c) => {
                let (schema, table, ctid) =
                    (schema.to_string(), table.to_string(), ctid.to_string());
                return ora(c.clone(), move |c| {
                    oracle::tx_delete_row(c, &schema, &table, &ctid)
                })
                .await;
            }
            TransactionEntry::Generic(g) => return g.delete_row(schema, table, ctid).await,
            TransactionEntry::Dynamo(d) => return d.delete_row(table, ctid).await,
        };

        let row_id = PgRowId::parse(ctid)?;
        let conn = conn.lock().await?;

        let sql = format!(
            "DELETE FROM {}.{} WHERE {}",
            quote_ident(schema),
            quote_ident(table),
            row_id.filter(schema, table),
        );

        conn.batch_execute("SAVEPOINT l8_op")
            .await
            .map_err(map_pg_err)?;
        match conn.execute(sql.as_str(), &[]).await {
            Ok(affected) => {
                conn.batch_execute("RELEASE SAVEPOINT l8_op")
                    .await
                    .map_err(map_pg_err)?;
                if affected == 0 {
                    return Err("Zeile nicht gefunden".to_string());
                }
                Ok(())
            }
            Err(e) => {
                let _ = conn.batch_execute("ROLLBACK TO SAVEPOINT l8_op").await;
                Err(map_pg_err(e))
            }
        }
    }

    pub async fn commit(&self, tx_id: &str) -> Result<(), String> {
        let entry = self.entry(tx_id).await?;
        let outcome = match &*entry {
            TransactionEntry::Pg(c, _) => {
                let conn = c.lock().await?;
                conn.simple_query("SELECT 1").await.map_err(|error| {
                    if error.is_closed() {
                        return "Commit nicht möglich: Die Datenbank hat die Sitzung beendet (z. B. nach 30 Minuten Leerlauf in der Transaktion). Die Änderungen wurden verworfen; Transaktion zurückrollen, um sie zu schließen.".to_string();
                    }
                    format!(
                        "Commit nicht ausgeführt; Transaktion prüfen und zurückrollen: {}",
                        map_pg_err(error)
                    )
                })?;
                conn.simple_query("COMMIT").await.map_err(map_pg_err)?;
                Ok(())
            }
            TransactionEntry::Oracle(c) => ora(c.clone(), |c| oracle::tx_finish(c, true)).await,
            TransactionEntry::Generic(g) => g.session.lock().await.commit().await,
            TransactionEntry::Dynamo(d) => d.commit().await,
        };
        if outcome.is_ok() {
            self.transactions.lock().await.remove(tx_id);
        }
        outcome
    }

    pub async fn rollback(&self, tx_id: &str) -> Result<(), String> {
        let entry = self.entry(tx_id).await?;
        let outcome = match &*entry {
            TransactionEntry::Pg(c, _) => {
                match c.lock_for_cleanup().await.simple_query("ROLLBACK").await {
                    Err(error) if !error.is_closed() => Err(map_pg_err(error)),
                    _ => Ok(()),
                }
            }
            TransactionEntry::Oracle(c) => ora(c.clone(), |c| oracle::tx_finish(c, false)).await,
            TransactionEntry::Generic(g) => g.session.lock().await.rollback().await,
            TransactionEntry::Dynamo(d) => d.rollback().await,
        };
        if outcome.is_ok() {
            self.transactions.lock().await.remove(tx_id);
        }
        outcome
    }

    pub async fn list_active_ids(&self) -> Vec<String> {
        self.transactions.lock().await.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn key_helpers() {
        assert!(parse_key("").is_err());
        assert!(parse_key("{}").is_err());
        let key = parse_key(r#"{"id":1,"name":"a'b","x":null}"#).unwrap();
        assert_eq!(
            where_key(DatabaseKind::Sqlite, &key, &HashSet::new()),
            r#""id" = 1 AND "name" = 'a''b' AND "x" IS NULL"#
        );
        assert_eq!(quote(DatabaseKind::Mysql, "a`b"), "`a``b`");
        assert_eq!(lit(DatabaseKind::Mssql, "x"), "N'x'");
    }

    #[test]
    fn binary_key_columns_match_as_binary_literals() {
        let key = parse_key(r#"{"id":"\\x0a0B","name":"\\x41","n":7}"#).unwrap();
        let binary = HashSet::from(["id".to_string()]);
        for (kind, blob) in [
            (DatabaseKind::Mysql, "X'0a0B'"),
            (DatabaseKind::Sqlite, "X'0a0B'"),
            (DatabaseKind::SqliteHttp, "X'0a0B'"),
            (DatabaseKind::Mssql, "0x0a0B"),
        ] {
            let sql = where_key(kind, &key, &binary);
            for expected in [
                format!("{} = {blob}", quote(kind, "id")),
                format!("{} = {}", quote(kind, "name"), lit(kind, "\\x41")),
                format!("{} = 7", quote(kind, "n")),
            ] {
                assert!(sql.contains(&expected), "{kind:?}: {sql} lacks {expected}");
            }
        }
        let not_hex = parse_key(r#"{"id":"abc"}"#).unwrap();
        assert_eq!(
            where_key(DatabaseKind::Mysql, &not_hex, &binary),
            "`id` = 'abc'"
        );
    }

    #[tokio::test]
    async fn sqlite_blob_primary_keys_can_be_updated_and_deleted() {
        let path =
            std::env::temp_dir().join(format!("l8db-blob-key-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let url = format!("sqlite://{}?mode=rwc", path.display());
        let pool = super::super::pool::create_pool_state();
        let adapter = super::super::create_adapter_from_string(
            DatabaseKind::Sqlite,
            &url,
            None,
            pool.clone(),
        )
        .unwrap();
        for sql in [
            "CREATE TABLE t (id BLOB PRIMARY KEY, note TEXT)",
            "INSERT INTO t VALUES (X'0102', 'a'), (X'0a0b', 'b')",
        ] {
            adapter.execute_query(sql).await.unwrap();
        }
        let tx = create_transaction_state();
        let id = tx
            .begin(DatabaseKind::Sqlite, &url, None, &pool)
            .await
            .unwrap();
        let updates = HashMap::from([("note".to_string(), Some("changed".to_string()))]);
        tx.update_row(&id, "main", "t", r#"{"id":"\\x0102"}"#, &updates)
            .await
            .unwrap();
        tx.delete_row(&id, "main", "t", r#"{"id":"\\x0a0b"}"#)
            .await
            .unwrap();
        let rows = tx
            .execute(&id, "SELECT hex(id) AS id, note FROM t ORDER BY id")
            .await
            .unwrap()
            .rows;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], "0102");
        assert_eq!(rows[0]["note"], "changed");
        tx.rollback(&id).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn pg_row_id_pins_the_physical_relation() {
        let partition = PgRowId::parse(" (0, 1)@16384 ").unwrap();
        assert_eq!(
            partition.filter("public", "orders"),
            "ctid = '(0,1)'::tid AND tableoid = 16384::oid"
        );
        let legacy = PgRowId::parse("(12,7)").unwrap();
        assert_eq!(
            legacy.filter("my'schema", "Or\"ders"),
            r#"ctid = '(12,7)'::tid AND tableoid = '"my''schema"."Or""ders"'::regclass"#
        );
        for invalid in [
            "",
            "(0,1",
            "0,1",
            "(a,1)",
            "(0,1)@",
            "(0,1)@-1",
            "(0,1)@1 OR true",
            "(0,1)'; DROP TABLE x; --",
            "(0,70000)",
            "(0,1)@16384@1",
        ] {
            assert!(PgRowId::parse(invalid).is_err(), "{invalid}");
        }
        assert!(
            !crate::db::postgres::table_page_sql("s", "t", "", None, true).contains("t.ctid AS")
        );
        assert!(
            crate::db::postgres::table_page_sql("s", "t", "", None, true)
                .contains("t.ctid::text || '@' || t.tableoid::text")
        );
    }

    #[test]
    fn binary_literals_per_dialect() {
        assert_eq!(
            super::binary_lit(DatabaseKind::Mysql, "\\x00ff").as_deref(),
            Some("X'00ff'")
        );
        assert_eq!(
            super::binary_lit(DatabaseKind::Sqlite, "\\x").as_deref(),
            Some("X''")
        );
        assert_eq!(
            super::binary_lit(DatabaseKind::Mssql, "\\xab").as_deref(),
            Some("0xab")
        );
        assert_eq!(super::binary_lit(DatabaseKind::Mysql, "\\x0g"), None);
        assert_eq!(super::binary_lit(DatabaseKind::Duckdb, "\\x00"), None);
        let binary = std::collections::HashSet::from(["b".to_string()]);
        let value = Some("\\x0102".to_string());
        assert_eq!(
            super::value_lit(DatabaseKind::Mysql, &binary, "b", &value),
            "X'0102'"
        );
        assert_eq!(
            super::value_lit(DatabaseKind::Mysql, &binary, "t", &value),
            "'\\\\x0102'"
        );
    }

    #[tokio::test]
    async fn sqlite_binary_roundtrip() {
        let dir = std::env::temp_dir().join(format!("l8db-bin-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&dir);
        let url = format!("sqlite://{}?mode=rwc", dir.display());
        let pool = super::super::pool::create_pool_state();
        let adapter = super::super::create_adapter_from_string(
            DatabaseKind::Sqlite,
            &url,
            None,
            pool.clone(),
        )
        .unwrap();
        adapter
            .execute_query("CREATE TABLE t (id INTEGER PRIMARY KEY, data BLOB, note TEXT)")
            .await
            .unwrap();
        let tx = TransactionManager {
            transactions: Mutex::new(HashMap::new()),
        };
        let id = tx
            .begin(DatabaseKind::Sqlite, &url, None, &pool)
            .await
            .unwrap();
        let values = HashMap::from([
            ("data".to_string(), Some("\\x89504e47".to_string())),
            ("note".to_string(), Some("\\x41".to_string())),
        ]);
        let row = tx.insert_row(&id, "main", "t", &values).await.unwrap();
        assert_eq!(row["data"], "\\x89504e47");
        assert_eq!(row["note"], "\\x41");
        let ctid = row["__ctid__"].as_str().unwrap().to_string();
        let updates = HashMap::from([("data".to_string(), Some("\\x00ff10".to_string()))]);
        tx.update_row(&id, "main", "t", &ctid, &updates)
            .await
            .unwrap();
        let res = tx
            .execute(
                &id,
                "SELECT typeof(data) AS kind, length(data) AS n, data, note FROM t",
            )
            .await
            .unwrap();
        assert_eq!(res.rows[0]["kind"], "blob");
        assert_eq!(res.rows[0]["n"], 3);
        assert_eq!(res.rows[0]["data"], "\\x00ff10");
        assert_eq!(res.rows[0]["note"], "\\x41");
        tx.rollback(&id).await.unwrap();
        let _ = std::fs::remove_file(&dir);
    }

    #[tokio::test]
    async fn sqlite_transaction_roundtrip() {
        let dir = std::env::temp_dir().join(format!("l8db-tx-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&dir);
        let url = format!("sqlite://{}?mode=rwc", dir.display());
        let pool = super::super::pool::create_pool_state();
        let adapter = super::super::create_adapter_from_string(
            DatabaseKind::Sqlite,
            &url,
            None,
            pool.clone(),
        )
        .unwrap();
        adapter
            .execute_query("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)")
            .await
            .unwrap();
        let tx = TransactionManager {
            transactions: Mutex::new(HashMap::new()),
        };
        let id = tx
            .begin(DatabaseKind::Sqlite, &url, None, &pool)
            .await
            .unwrap();

        let mut values = HashMap::new();
        values.insert("name".to_string(), Some("a".to_string()));
        let row = tx.insert_row(&id, "main", "t", &values).await.unwrap();
        assert_eq!(row["__ctid__"], r#"{"id":1}"#);
        let ctid = row["__ctid__"].as_str().unwrap().to_string();

        let mut updates = HashMap::new();
        updates.insert("name".to_string(), Some("b".to_string()));
        assert_eq!(
            tx.update_row(&id, "main", "t", &ctid, &updates)
                .await
                .unwrap(),
            ctid
        );

        assert!(tx
            .update_row(&id, "main", "t", r#"{"id":99}"#, &updates)
            .await
            .is_err());

        let dup = tx.duplicate_row(&id, "main", "t", &ctid).await.unwrap();
        assert_eq!(dup["name"], "b");
        assert_eq!(dup["id"], 2);

        let empty = tx
            .insert_row(&id, "main", "t", &HashMap::new())
            .await
            .unwrap();
        assert_eq!(empty["id"], 3);

        tx.delete_row(&id, "main", "t", dup["__ctid__"].as_str().unwrap())
            .await
            .unwrap();
        assert!(tx
            .delete_row(&id, "main", "t", r#"{"id":99}"#)
            .await
            .is_err());
        let res = tx
            .execute(&id, "SELECT COUNT(*) AS n FROM t")
            .await
            .unwrap();
        assert_eq!(res.rows[0]["n"], 2);
        tx.rollback(&id).await.unwrap();

        let res = adapter
            .execute_query("SELECT COUNT(*) AS n FROM t")
            .await
            .unwrap();
        assert_eq!(res.rows[0]["n"], 0);

        let id = tx
            .begin(DatabaseKind::Sqlite, &url, None, &pool)
            .await
            .unwrap();
        tx.insert_row(&id, "main", "t", &values).await.unwrap();
        tx.commit(&id).await.unwrap();
        let data = adapter
            .fetch_rows("main", "t", None, 10, 0, None, false, false, false)
            .await
            .unwrap();
        assert_eq!(data.rows.len(), 1);
        assert_eq!(data.rows[0]["__ctid__"], r#"{"id":1}"#);
        assert!(!data.columns.iter().any(|c| c == "__ctid__"));
        let _ = std::fs::remove_file(&dir);
    }

    async fn generic_roundtrip(kind: DatabaseKind, var: &str, schema: &str, create: &str) {
        let Ok(url) = std::env::var(var) else {
            return;
        };
        let pool = super::super::pool::create_pool_state();
        let adapter =
            super::super::create_adapter_from_string(kind, &url, None, pool.clone()).unwrap();
        let _ = adapter.execute_query("DROP TABLE l8_tx_test").await;
        adapter.execute_query(create).await.unwrap();
        let tx = TransactionManager {
            transactions: Mutex::new(HashMap::new()),
        };
        let id = tx.begin(kind, &url, None, &pool).await.unwrap();

        let mut values = HashMap::new();
        values.insert("name".to_string(), Some("a'b".to_string()));
        let row = tx
            .insert_row(&id, schema, "l8_tx_test", &values)
            .await
            .unwrap();
        assert_eq!(row["name"], "a'b");
        let ctid = row["__ctid__"].as_str().unwrap().to_string();
        assert_eq!(ctid, format!(r#"{{"id":{}}}"#, row["id"]));

        let mut updates = HashMap::new();
        updates.insert("name".to_string(), Some("b".to_string()));
        assert_eq!(
            tx.update_row(&id, schema, "l8_tx_test", &ctid, &updates)
                .await
                .unwrap(),
            ctid
        );

        let dup = tx
            .duplicate_row(&id, schema, "l8_tx_test", &ctid)
            .await
            .unwrap();
        assert_eq!(dup["name"], "b");
        assert_ne!(dup["id"], row["id"]);

        let empty = tx
            .insert_row(&id, schema, "l8_tx_test", &HashMap::new())
            .await
            .unwrap();
        assert!(empty["__ctid__"].is_string());

        tx.delete_row(&id, schema, "l8_tx_test", dup["__ctid__"].as_str().unwrap())
            .await
            .unwrap();
        assert!(tx
            .delete_row(&id, schema, "l8_tx_test", r#"{"id":99999}"#)
            .await
            .is_err());
        let res = tx
            .execute(&id, "SELECT COUNT(*) AS n FROM l8_tx_test")
            .await
            .unwrap();
        assert_eq!(res.rows[0]["n"], 2);
        tx.rollback(&id).await.unwrap();

        let res = adapter
            .execute_query("SELECT COUNT(*) AS n FROM l8_tx_test")
            .await
            .unwrap();
        assert_eq!(res.rows[0]["n"], 0);

        let id = tx.begin(kind, &url, None, &pool).await.unwrap();
        tx.insert_row(&id, schema, "l8_tx_test", &values)
            .await
            .unwrap();
        tx.commit(&id).await.unwrap();
        let data = adapter
            .fetch_rows(schema, "l8_tx_test", None, 10, 0, None, false, false, false)
            .await
            .unwrap();
        assert_eq!(data.rows.len(), 1);
        assert!(data.rows[0]["__ctid__"]
            .as_str()
            .unwrap()
            .starts_with(r#"{"id":"#));
        assert!(!data.columns.iter().any(|c| c == "__ctid__"));
        adapter
            .execute_query("DROP TABLE l8_tx_test")
            .await
            .unwrap();
    }

    #[tokio::test]
    #[ignore]
    async fn mysql_transaction_roundtrip() {
        generic_roundtrip(
            DatabaseKind::Mysql,
            "L8DB_SMOKE_MYSQL_URL",
            "test",
            "CREATE TABLE l8_tx_test (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50))",
        )
        .await;
    }

    #[tokio::test]
    #[ignore]
    async fn mysql_big_integer_and_binary_keys_hit_exactly_one_row() {
        let Ok(url) = std::env::var("L8DB_SMOKE_MYSQL_URL") else {
            return;
        };
        let schema = std::env::var("L8DB_SMOKE_MYSQL_SCHEMA").unwrap_or_else(|_| "test".into());
        let pool = super::super::pool::create_pool_state();
        let adapter =
            super::super::create_adapter_from_string(DatabaseKind::Mysql, &url, None, pool.clone())
                .unwrap();
        for sql in [
            "DROP TABLE IF EXISTS l8_tx_bigkey",
            "DROP TABLE IF EXISTS l8_tx_binkey",
            "CREATE TABLE l8_tx_bigkey (id BIGINT UNSIGNED PRIMARY KEY, note VARCHAR(20))",
            "INSERT INTO l8_tx_bigkey VALUES (9007199254740992, 'keep'), (9007199254740993, 'drop'), (9007199254740994, 'edit')",
            "CREATE TABLE l8_tx_binkey (id BINARY(2) PRIMARY KEY, note VARCHAR(20))",
            "INSERT INTO l8_tx_binkey VALUES (X'0102', 'a'), (X'0a0b', 'b')",
        ] {
            adapter.execute_query(sql).await.unwrap();
        }
        let rows = adapter
            .fetch_rows(
                &schema,
                "l8_tx_bigkey",
                None,
                10,
                0,
                Some("id"),
                false,
                false,
                false,
            )
            .await
            .unwrap()
            .rows;
        let key = |index: usize| rows[index]["__ctid__"].as_str().unwrap().to_string();
        assert_eq!(key(1), r#"{"id":"9007199254740993"}"#);
        let tx = create_transaction_state();
        let id = tx
            .begin(DatabaseKind::Mysql, &url, None, &pool)
            .await
            .unwrap();
        tx.delete_row(&id, &schema, "l8_tx_bigkey", &key(1))
            .await
            .unwrap();
        let updates = HashMap::from([("note".to_string(), Some("edited".to_string()))]);
        tx.update_row(&id, &schema, "l8_tx_bigkey", &key(2), &updates)
            .await
            .unwrap();
        let binary_rows = adapter
            .fetch_rows(
                &schema,
                "l8_tx_binkey",
                None,
                10,
                0,
                Some("id"),
                false,
                false,
                false,
            )
            .await
            .unwrap()
            .rows;
        let binary_key = binary_rows[0]["__ctid__"].as_str().unwrap().to_string();
        tx.update_row(&id, &schema, "l8_tx_binkey", &binary_key, &updates)
            .await
            .unwrap();
        tx.commit(&id).await.unwrap();
        let left = adapter
            .execute_query("SELECT CAST(id AS CHAR) AS id, note FROM l8_tx_bigkey ORDER BY id")
            .await
            .unwrap()
            .rows;
        assert_eq!(left.len(), 2);
        assert_eq!(left[0]["id"], "9007199254740992");
        assert_eq!(left[0]["note"], "keep");
        assert_eq!(left[1]["id"], "9007199254740994");
        assert_eq!(left[1]["note"], "edited");
        let edited = adapter
            .execute_query("SELECT HEX(id) AS id FROM l8_tx_binkey WHERE note = 'edited'")
            .await
            .unwrap()
            .rows;
        assert_eq!(edited.len(), 1);
        assert_eq!(edited[0]["id"], "0102");
        for sql in ["DROP TABLE l8_tx_bigkey", "DROP TABLE l8_tx_binkey"] {
            adapter.execute_query(sql).await.unwrap();
        }
    }

    #[tokio::test]
    #[ignore]
    async fn mssql_transaction_roundtrip() {
        generic_roundtrip(
            DatabaseKind::Mssql,
            "L8DB_SMOKE_MSSQL_URL",
            "dbo",
            "CREATE TABLE l8_tx_test (id INT IDENTITY PRIMARY KEY, name NVARCHAR(50))",
        )
        .await;
    }

    #[tokio::test]
    #[ignore]
    async fn oracle_transaction_roundtrip() {
        let Ok(url) = std::env::var("L8DB_SMOKE_ORACLE_URL") else {
            return;
        };
        let pool = super::super::pool::create_pool_state();
        let adapter = super::super::create_adapter_from_string(
            DatabaseKind::Oracle,
            &url,
            None,
            pool.clone(),
        )
        .unwrap();
        let _ = adapter.execute_query("DROP TABLE L8_TX_TEST").await;
        adapter
            .execute_query("CREATE TABLE L8_TX_TEST (ID NUMBER GENERATED BY DEFAULT AS IDENTITY, NAME VARCHAR2(50), AT_TS DATE)")
            .await
            .unwrap();
        let schema = adapter.list_schemas().await.unwrap();
        let schema = schema
            .iter()
            .find(|s| s.eq_ignore_ascii_case("testuser"))
            .cloned()
            .unwrap_or_else(|| schema[0].clone());

        let tx = TransactionManager {
            transactions: Mutex::new(HashMap::new()),
        };
        let id = tx
            .begin(DatabaseKind::Oracle, &url, None, &pool)
            .await
            .unwrap();

        let mut values = HashMap::new();
        values.insert("NAME".to_string(), Some("a".to_string()));
        values.insert("AT_TS".to_string(), Some("2024-01-02 03:04:05".to_string()));
        let row = tx
            .insert_row(&id, &schema, "L8_TX_TEST", &values)
            .await
            .unwrap();
        let rowid = row["__ctid__"].as_str().unwrap().to_string();
        assert_eq!(row["NAME"], "a");
        assert_eq!(row["AT_TS"], "2024-01-02 03:04:05");

        let mut updates = HashMap::new();
        updates.insert("NAME".to_string(), Some("b".to_string()));
        tx.update_row(&id, &schema, "L8_TX_TEST", &rowid, &updates)
            .await
            .unwrap();

        let dup = tx
            .duplicate_row(&id, &schema, "L8_TX_TEST", &rowid)
            .await
            .unwrap();
        assert_eq!(dup["NAME"], "b");
        assert_ne!(dup["ID"], row["ID"]);

        let res = tx
            .execute(&id, "SELECT COUNT(*) AS N FROM L8_TX_TEST")
            .await
            .unwrap();
        assert_eq!(res.rows[0]["N"], 2);

        tx.delete_row(
            &id,
            &schema,
            "L8_TX_TEST",
            dup["__ctid__"].as_str().unwrap(),
        )
        .await
        .unwrap();
        tx.rollback(&id).await.unwrap();

        let res = adapter
            .execute_query("SELECT COUNT(*) AS N FROM L8_TX_TEST")
            .await
            .unwrap();
        assert_eq!(res.rows[0]["N"], 0);

        let id = tx
            .begin(DatabaseKind::Oracle, &url, None, &pool)
            .await
            .unwrap();
        tx.insert_row(&id, &schema, "L8_TX_TEST", &values)
            .await
            .unwrap();
        tx.commit(&id).await.unwrap();
        let res = adapter
            .execute_query("SELECT COUNT(*) AS N FROM L8_TX_TEST")
            .await
            .unwrap();
        assert_eq!(res.rows[0]["N"], 1);
        assert!(tx.list_active_ids().await.is_empty());
        let data = adapter
            .fetch_rows(
                &schema,
                "L8_TX_TEST",
                None,
                10,
                0,
                None,
                false,
                false,
                false,
            )
            .await
            .unwrap();
        assert!(data.rows[0]["__ctid__"].is_string());
        assert!(!data.columns.iter().any(|c| c == "__ctid__"));

        adapter
            .execute_query("DROP TABLE L8_TX_TEST")
            .await
            .unwrap();
    }
}
