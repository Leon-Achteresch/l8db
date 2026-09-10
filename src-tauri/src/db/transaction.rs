use futures_util::TryStreamExt;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use bb8::PooledConnection;
use bb8_postgres::PostgresConnectionManager;
use postgres_native_tls::MakeTlsConnector;
use tokio::sync::Mutex;
use tokio_postgres::SimpleQueryMessage;

use super::pool::{PoolState, PoolUse};
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

static TX_COUNTER: AtomicU64 = AtomicU64::new(1);

fn validate_ctid(ctid: &str) -> Result<String, String> {
    let ctid = ctid.trim();
    let valid = ctid.starts_with('(') && ctid.ends_with(')') && {
        let inner = &ctid[1..ctid.len() - 1];
        let parts: Vec<&str> = inner.splitn(2, ',').collect();
        parts.len() == 2
            && parts[0].trim().parse::<u64>().is_ok()
            && parts[1].trim().parse::<u64>().is_ok()
    };
    if !valid {
        return Err("Ungültige ctid".to_string());
    }
    Ok(ctid.to_string())
}

type OracleConn = Arc<std::sync::Mutex<oracle::Connection>>;

enum TransactionEntry {
    Pg(Box<Mutex<PooledConnection<'static, PostgresConnectionManager<MakeTlsConnector>>>>),
    Oracle(OracleConn),
    Generic(Generic),
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

fn where_key(kind: DatabaseKind, key: &Key) -> String {
    key.iter()
        .map(|(col, val)| match val {
            serde_json::Value::Null => format!("{} IS NULL", quote(kind, col)),
            other => format!("{} = {}", quote(kind, col), json_lit(kind, other)),
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

    async fn execute(&self, sql: &str) -> Result<QueryResult, String> {
        self.session.lock().await.execute(sql).await
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
        let set_parts: Vec<String> = updates
            .iter()
            .map(|(col, val)| format!("{} = {}", quote(self.kind, col), opt_lit(self.kind, val)))
            .collect();
        let sql = format!(
            "UPDATE {} SET {} WHERE {}",
            self.target(schema, table),
            set_parts.join(", "),
            where_key(self.kind, &key)
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
        let vals: Vec<String> = values.values().map(|v| opt_lit(self.kind, v)).collect();
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
                        where_key(self.kind, &key)
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
            where_key(self.kind, &key)
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
            where_key(self.kind, &key)
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
        let pool_key = super::connection::connection_key(connection_string, database);
        let pool = pool_state
            .get_pool(&pool_key, config, ssl, PoolUse::Query)
            .await?;
        let conn = pool
            .get_owned()
            .await
            .map_err(|e| format!("Verbindung fehlgeschlagen: {e}"))?;

        conn.simple_query("BEGIN").await.map_err(map_pg_err)?;
        Ok(self
            .insert_entry(TransactionEntry::Pg(Box::new(Mutex::new(conn))))
            .await)
    }

    pub async fn execute_with_params(
        &self,
        tx_id: &str,
        sql: &str,
        params: &[Option<String>],
    ) -> Result<QueryResult, String> {
        let entry = self.entry(tx_id).await?;
        let conn = match &*entry {
            TransactionEntry::Pg(c) => c,
            _ => {
                return Err(super::unsupported("Bind-Parameter"));
            }
        };
        let conn = conn.lock().await;
        super::postgres::run_params_query(&conn, sql, params).await
    }

    pub async fn execute(&self, tx_id: &str, sql: &str) -> Result<QueryResult, String> {
        let entry = self.entry(tx_id).await?;
        let conn = match &*entry {
            TransactionEntry::Pg(c) => c,
            TransactionEntry::Oracle(c) => {
                let sql = sql.to_string();
                return ora(c.clone(), move |c| oracle::tx_execute(c, &sql)).await;
            }
            TransactionEntry::Generic(g) => return g.execute(sql).await,
        };
        let conn = conn.lock().await;
        let start = std::time::Instant::now();
        let messages = conn.simple_query_raw(sql).await.map_err(map_pg_err)?;
        futures_util::pin_mut!(messages);

        let mut columns: Vec<String> = Vec::new();
        let mut rows: Vec<serde_json::Value> = Vec::new();
        let mut rows_affected: Option<u64> = None;

        while let Some(msg) = messages.try_next().await.map_err(map_pg_err)? {
            match msg {
                SimpleQueryMessage::Row(row) => {
                    if columns.is_empty() {
                        columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                    }
                    let mut obj = serde_json::Map::new();
                    for (i, col) in columns.iter().enumerate() {
                        let val = row
                            .get(i)
                            .map(|v| serde_json::Value::String(v.to_string()))
                            .unwrap_or(serde_json::Value::Null);
                        obj.insert(col.clone(), val);
                    }
                    rows.push(serde_json::Value::Object(obj));
                }
                SimpleQueryMessage::CommandComplete(count) => {
                    rows_affected = Some(count);
                }
                _ => {}
            }
        }

        Ok(QueryResult {
            columns,
            rows,
            rows_affected,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
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
            TransactionEntry::Pg(c) => c,
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
        };

        let ctid = validate_ctid(ctid)?;
        let conn = conn.lock().await;

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
            "UPDATE {}.{} SET {} WHERE ctid = '{}'::tid RETURNING ctid::text",
            quote_ident(schema),
            quote_ident(table),
            set_parts.join(", "),
            ctid,
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
            TransactionEntry::Pg(c) => c,
            TransactionEntry::Oracle(c) => {
                let (schema, table, values) =
                    (schema.to_string(), table.to_string(), values.clone());
                return ora(c.clone(), move |c| {
                    oracle::tx_insert_row(c, &schema, &table, &values)
                })
                .await;
            }
            TransactionEntry::Generic(g) => return g.insert_row(schema, table, values).await,
        };
        let conn = conn.lock().await;

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
                "WITH ins AS (INSERT INTO {target} DEFAULT VALUES RETURNING *, ctid AS __l8_ctid) \
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
                "WITH ins AS (INSERT INTO {target} ({}) VALUES ({}) RETURNING *, ctid AS __l8_ctid) \
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
                    Some(row) => Ok(row.get::<_, serde_json::Value>(0)),
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
            TransactionEntry::Pg(c) => c,
            TransactionEntry::Oracle(c) => {
                let (schema, table, ctid) =
                    (schema.to_string(), table.to_string(), ctid.to_string());
                return ora(c.clone(), move |c| {
                    oracle::tx_duplicate_row(c, &schema, &table, &ctid)
                })
                .await;
            }
            TransactionEntry::Generic(g) => return g.duplicate_row(schema, table, ctid).await,
        };

        let ctid = validate_ctid(ctid)?;
        let conn = conn.lock().await;

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
                "WITH ins AS (INSERT INTO {target} DEFAULT VALUES RETURNING *, ctid AS __l8_ctid) \
                 SELECT (to_jsonb(ins) - '__l8_ctid') || jsonb_build_object('__ctid__', __l8_ctid::text) FROM ins",
            )
        } else {
            let col_list = cols.join(", ");
            format!(
                "WITH ins AS (INSERT INTO {target} ({col_list}) \
                 SELECT {col_list} FROM {target} WHERE ctid = '{ctid}'::tid \
                 RETURNING *, ctid AS __l8_ctid) \
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
                    Some(row) => Ok(row.get::<_, serde_json::Value>(0)),
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
            TransactionEntry::Pg(c) => c,
            TransactionEntry::Oracle(c) => {
                let (schema, table, ctid) =
                    (schema.to_string(), table.to_string(), ctid.to_string());
                return ora(c.clone(), move |c| {
                    oracle::tx_delete_row(c, &schema, &table, &ctid)
                })
                .await;
            }
            TransactionEntry::Generic(g) => return g.delete_row(schema, table, ctid).await,
        };

        let ctid = validate_ctid(ctid)?;
        let conn = conn.lock().await;

        let sql = format!(
            "DELETE FROM {}.{} WHERE ctid = '{}'::tid",
            quote_ident(schema),
            quote_ident(table),
            ctid,
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
        let entry = {
            self.transactions
                .lock()
                .await
                .remove(tx_id)
                .ok_or_else(|| "Transaktion nicht gefunden".to_string())?
        };
        match &*entry {
            TransactionEntry::Pg(c) => {
                c.lock()
                    .await
                    .simple_query("COMMIT")
                    .await
                    .map_err(map_pg_err)?;
                Ok(())
            }
            TransactionEntry::Oracle(c) => ora(c.clone(), |c| oracle::tx_finish(c, true)).await,
            TransactionEntry::Generic(g) => g.session.lock().await.commit().await,
        }
    }

    pub async fn rollback(&self, tx_id: &str) -> Result<(), String> {
        let entry = {
            self.transactions
                .lock()
                .await
                .remove(tx_id)
                .ok_or_else(|| "Transaktion nicht gefunden".to_string())?
        };
        match &*entry {
            TransactionEntry::Pg(c) => {
                c.lock()
                    .await
                    .simple_query("ROLLBACK")
                    .await
                    .map_err(map_pg_err)?;
                Ok(())
            }
            TransactionEntry::Oracle(c) => ora(c.clone(), |c| oracle::tx_finish(c, false)).await,
            TransactionEntry::Generic(g) => g.session.lock().await.rollback().await,
        }
    }

    pub async fn active_count(&self) -> usize {
        self.transactions.lock().await.len()
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
            where_key(DatabaseKind::Sqlite, &key),
            r#""id" = 1 AND "name" = 'a''b' AND "x" IS NULL"#
        );
        assert_eq!(quote(DatabaseKind::Mysql, "a`b"), "`a``b`");
        assert_eq!(lit(DatabaseKind::Mssql, "x"), "N'x'");
    }

    #[tokio::test]
    async fn sqlite_transaction_roundtrip() {
        let dir = std::env::temp_dir().join(format!("l8db-tx-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&dir);
        let url = format!("sqlite://{}", dir.display());
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
