use std::collections::HashMap;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bb8::PooledConnection;
use bb8_postgres::PostgresConnectionManager;
use postgres_native_tls::MakeTlsConnector;
use tokio::sync::Mutex;
use tokio_postgres::SimpleQueryMessage;

use super::pool::{PoolState, PoolUse};
use super::{map_pg_err, quote_ident, QueryResult};

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

struct TransactionEntry {
    conn: Mutex<PooledConnection<'static, PostgresConnectionManager<MakeTlsConnector>>>,
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
    pub async fn begin(
        &self,
        connection_string: &str,
        database: Option<&str>,
        pool_state: &PoolState,
    ) -> Result<String, String> {
        let mut config = tokio_postgres::Config::from_str(connection_string)
            .map_err(|e| format!("Ungültiger Connection String: {e}"))?;
        if let Some(db) = database {
            if !db.is_empty() {
                config.dbname(db);
            }
        }
        config.connect_timeout(Duration::from_secs(10));

        let pool_key = match database {
            Some(db) if !db.is_empty() => format!("{}##{db}", super::redact_connection_string(connection_string)),
            _ => super::redact_connection_string(connection_string),
        };

        let pool = pool_state.get_pool(&pool_key, config, PoolUse::Query).await?;
        let conn = pool
            .get_owned()
            .await
            .map_err(|e| format!("Verbindung fehlgeschlagen: {e}"))?;

        conn.simple_query("BEGIN")
            .await
            .map_err(map_pg_err)?;

        let tx_id = format!("tx_{}", TX_COUNTER.fetch_add(1, Ordering::Relaxed));
        let entry = Arc::new(TransactionEntry {
            conn: Mutex::new(conn),
        });

        self.transactions.lock().await.insert(tx_id.clone(), entry);
        Ok(tx_id)
    }

    pub async fn execute(&self, tx_id: &str, sql: &str) -> Result<QueryResult, String> {
        let entry = {
            self.transactions
                .lock()
                .await
                .get(tx_id)
                .ok_or_else(|| "Transaktion nicht gefunden".to_string())?
                .clone()
        };

        let conn = entry.conn.lock().await;
        let start = std::time::Instant::now();
        let messages = conn.simple_query(sql).await.map_err(map_pg_err)?;
        let elapsed = start.elapsed().as_millis() as u64;

        let mut columns: Vec<String> = Vec::new();
        let mut rows: Vec<serde_json::Value> = Vec::new();
        let mut rows_affected: Option<u64> = None;

        for msg in messages {
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
            execution_time_ms: elapsed,
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
        let entry = {
            self.transactions
                .lock()
                .await
                .get(tx_id)
                .ok_or_else(|| "Transaktion nicht gefunden".to_string())?
                .clone()
        };

        let ctid = validate_ctid(ctid)?;
        let conn = entry.conn.lock().await;

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

        conn.batch_execute("SAVEPOINT l8_op").await.map_err(map_pg_err)?;
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
        let entry = {
            self.transactions
                .lock()
                .await
                .get(tx_id)
                .ok_or_else(|| "Transaktion nicht gefunden".to_string())?
                .clone()
        };

        let conn = entry.conn.lock().await;

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

        conn.batch_execute("SAVEPOINT l8_op").await.map_err(map_pg_err)?;
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
        let entry = {
            self.transactions
                .lock()
                .await
                .get(tx_id)
                .ok_or_else(|| "Transaktion nicht gefunden".to_string())?
                .clone()
        };

        let ctid = validate_ctid(ctid)?;
        let conn = entry.conn.lock().await;

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

        conn.batch_execute("SAVEPOINT l8_op").await.map_err(map_pg_err)?;
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
        let entry = {
            self.transactions
                .lock()
                .await
                .get(tx_id)
                .ok_or_else(|| "Transaktion nicht gefunden".to_string())?
                .clone()
        };

        let ctid = validate_ctid(ctid)?;
        let conn = entry.conn.lock().await;

        let sql = format!(
            "DELETE FROM {}.{} WHERE ctid = '{}'::tid",
            quote_ident(schema),
            quote_ident(table),
            ctid,
        );

        conn.batch_execute("SAVEPOINT l8_op").await.map_err(map_pg_err)?;
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
        let conn = entry.conn.lock().await;
        conn.simple_query("COMMIT").await.map_err(map_pg_err)?;
        Ok(())
    }

    pub async fn rollback(&self, tx_id: &str) -> Result<(), String> {
        let entry = {
            self.transactions
                .lock()
                .await
                .remove(tx_id)
                .ok_or_else(|| "Transaktion nicht gefunden".to_string())?
        };
        let conn = entry.conn.lock().await;
        conn.simple_query("ROLLBACK").await.map_err(map_pg_err)?;
        Ok(())
    }

    pub async fn active_count(&self) -> usize {
        self.transactions.lock().await.len()
    }

    pub async fn list_active_ids(&self) -> Vec<String> {
        self.transactions.lock().await.keys().cloned().collect()
    }
}
