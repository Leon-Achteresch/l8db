use std::sync::{Arc, Mutex};

use oracle::sql_type::{
    Collection, IntervalDS, IntervalYM, Object, ObjectType, OracleType, Timestamp, ToSql,
};
use oracle::{Connection, SqlValue};
use tokio_util::sync::CancellationToken;

use super::super::import::Dialect;
use super::super::oracle::OracleAdapter;
use super::super::pool::PoolState;
use super::super::DatabaseAdapter;
use super::{Endpoint, SchemaPair, TransferTable};

const BATCH_ROWS: usize = 500;
const BATCH_BYTES: usize = 16 << 20;
const TSTZ_FORMAT: &str = "SYYYY-MM-DD HH24:MI:SS.FF9 TZR TZD";

type Shared = Arc<Mutex<Connection>>;

pub struct Copier {
    source: Shared,
    target: Shared,
}

enum Cell {
    Text(Option<String>),
    Bytes(Option<Vec<u8>>),
    Time(Option<Timestamp>),
    DaySecond(Option<IntervalDS>),
    YearMonth(Option<IntervalYM>),
    Single(Option<f32>),
    Double(Option<f64>),
    Flag(Option<bool>),
    Object(Option<Object>, OracleType),
    Collection(Option<Collection>, OracleType),
}

macro_rules! cell {
    ($remap:expr, $kind:expr, $get:expr) => {
        match $kind {
            OracleType::Raw(_) | OracleType::LongRaw | OracleType::BLOB => Cell::Bytes($get?),
            OracleType::Date
            | OracleType::Timestamp(_)
            | OracleType::TimestampTZ(_)
            | OracleType::TimestampLTZ(_) => Cell::Time($get?),
            OracleType::IntervalDS(..) => Cell::DaySecond($get?),
            OracleType::IntervalYM(_) => Cell::YearMonth($get?),
            OracleType::BinaryFloat => Cell::Single($get?),
            OracleType::BinaryDouble => Cell::Double($get?),
            OracleType::Boolean => Cell::Flag($get?),
            OracleType::Object(source) => {
                let target = $remap.object_type(source)?;
                if source.is_collection() {
                    let value: Option<Collection> = $get?;
                    Cell::Collection(
                        value.map(|c| $remap.collection(&c, &target)).transpose()?,
                        OracleType::Object(target),
                    )
                } else {
                    let value: Option<Object> = $get?;
                    Cell::Object(
                        value.map(|o| $remap.object(&o, &target)).transpose()?,
                        OracleType::Object(target),
                    )
                }
            }
            _ => Cell::Text($get?),
        }
    };
}

struct Remap<'a> {
    target: &'a Connection,
    from: &'a str,
    to: &'a str,
}

impl Remap<'_> {
    fn object_type(&self, source: &ObjectType) -> oracle::Result<ObjectType> {
        let schema = if source.schema() == self.from {
            self.to
        } else {
            source.schema()
        };
        self.target
            .object_type(&format!("\"{schema}\".\"{}\"", source.name()))
    }

    fn object(&self, source: &Object, target: &ObjectType) -> oracle::Result<Object> {
        let mut out = target.new_object()?;
        for attr in source.object_type().attributes() {
            let name = attr.name();
            let value = cell!(self, attr.oracle_type(), source.get(name));
            out.set(name, value.sql())?;
        }
        Ok(out)
    }

    fn collection(&self, source: &Collection, target: &ObjectType) -> oracle::Result<Collection> {
        let mut out = target.new_collection()?;
        let kind = source
            .object_type()
            .element_oracle_type()
            .cloned()
            .unwrap_or(OracleType::Varchar2(0));
        for index in source.indices() {
            let index = index?;
            let value = cell!(self, &kind, source.get(index));
            out.push(value.sql())?;
        }
        Ok(out)
    }
}

struct Typed<'a>(&'a dyn ToSql, OracleType);

impl ToSql for Typed<'_> {
    fn oratype(&self, _: &Connection) -> oracle::Result<OracleType> {
        Ok(self.1.clone())
    }

    fn to_sql(&self, val: &mut SqlValue) -> oracle::Result<()> {
        self.0.to_sql(val)
    }
}

impl Cell {
    fn empty_lob(&self, kind: &OracleType) -> Option<&'static str> {
        match (kind, self) {
            (OracleType::CLOB | OracleType::NCLOB, Cell::Text(Some(text))) if text.is_empty() => {
                Some("EMPTY_CLOB()")
            }
            (OracleType::BLOB, Cell::Bytes(Some(bytes))) if bytes.is_empty() => {
                Some("EMPTY_BLOB()")
            }
            _ => None,
        }
    }

    fn size(&self) -> usize {
        match self {
            Cell::Text(value) => value.as_ref().map_or(0, String::len),
            Cell::Bytes(value) => value.as_ref().map_or(0, Vec::len),
            _ => 16,
        }
    }

    fn sql(&self) -> &dyn ToSql {
        match self {
            Cell::Text(value) => value,
            Cell::Bytes(value) => value,
            Cell::Time(value) => value,
            Cell::DaySecond(value) => value,
            Cell::YearMonth(value) => value,
            Cell::Single(value) => value,
            Cell::Double(value) => value,
            Cell::Flag(value) => value,
            Cell::Object(Some(value), _) => value,
            Cell::Collection(Some(value), _) => value,
            Cell::Object(None, kind) | Cell::Collection(None, kind) => kind,
        }
    }
}

pub(super) fn bind_type(kind: &OracleType) -> Option<OracleType> {
    match kind {
        OracleType::Number(..) | OracleType::Float(_) => Some(OracleType::Number(0, 0)),
        OracleType::NVarchar2(_) | OracleType::NChar(_) => Some(OracleType::NVarchar2(1)),
        OracleType::CLOB | OracleType::Xml | OracleType::Json => Some(OracleType::Long),
        OracleType::NCLOB => Some(OracleType::NCLOB),
        OracleType::BLOB => Some(OracleType::LongRaw),
        OracleType::Long
        | OracleType::LongRaw
        | OracleType::Date
        | OracleType::Timestamp(_)
        | OracleType::TimestampLTZ(_)
        | OracleType::IntervalDS(..)
        | OracleType::IntervalYM(_)
        | OracleType::BinaryFloat
        | OracleType::BinaryDouble
        | OracleType::Boolean => Some(kind.clone()),
        _ => None,
    }
}

fn kind_of(data_type: &str) -> String {
    data_type.trim().to_ascii_uppercase()
}

fn zoned(data_type: &str) -> bool {
    let kind = kind_of(data_type);
    kind.contains("WITH TIME ZONE") && !kind.contains("LOCAL")
}

pub fn unsupported(data_type: &str) -> bool {
    let kind = kind_of(data_type);
    let base = kind.split('(').next().unwrap_or("").trim();
    matches!(
        base,
        "BFILE" | "ANYDATA" | "ANYTYPE" | "ANYDATASET" | "VECTOR" | "MLSLABEL"
    ) || base.starts_with("REF ")
}

fn wrapped(data_type: &str) -> bool {
    matches!(kind_of(data_type).as_str(), "XMLTYPE" | "JSON")
}

pub(super) fn select_expr(column: &str, data_type: &str) -> String {
    let quoted = Dialect::Oracle.quote(column);
    match kind_of(data_type).as_str() {
        "XMLTYPE" => format!("XMLSERIALIZE(CONTENT {quoted} AS CLOB)"),
        "JSON" => format!("JSON_SERIALIZE({quoted} RETURNING CLOB)"),
        _ if zoned(data_type) => format!("TO_CHAR({quoted}, '{TSTZ_FORMAT}')"),
        _ => quoted,
    }
}

pub(super) fn insert_expr(position: usize, data_type: &str) -> String {
    let bind = format!(":{position}");
    match kind_of(data_type).as_str() {
        "XMLTYPE" => format!("XMLPARSE(DOCUMENT {bind} WELLFORMED)"),
        "JSON" => format!("JSON({bind})"),
        _ if zoned(data_type) => format!("TO_TIMESTAMP_TZ({bind}, '{TSTZ_FORMAT}')"),
        _ => bind,
    }
}

async fn open(endpoint: &Endpoint, pool: &PoolState) -> Result<Shared, String> {
    let key = super::super::connection::connection_key(
        &endpoint.connection_string,
        endpoint.database.as_deref(),
    );
    let adapter = OracleAdapter::new(&endpoint.connection_string, pool.clone(), key)?;
    let mut connection = adapter
        .open_connection()
        .await?
        .into_inner()
        .map_err(|_| "Oracle-Verbindung ist blockiert".to_string())?;
    connection.set_autocommit(false);
    Ok(Arc::new(Mutex::new(connection)))
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("Oracle-Task fehlgeschlagen: {e}"))?
}

fn lock(conn: &Shared) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    conn.lock()
        .map_err(|_| "Oracle-Verbindung ist blockiert".to_string())
}

fn copy_rows(
    source: &Connection,
    target: &Connection,
    table: &TransferTable,
    cancel: &CancellationToken,
    progress: &tokio::sync::mpsc::UnboundedSender<u64>,
) -> Result<u64, String> {
    let d = Dialect::Oracle;
    let select = format!(
        "SELECT {} FROM {}",
        table
            .columns
            .iter()
            .map(|c| select_expr(&c.source, &c.source_type))
            .collect::<Vec<_>>()
            .join(", "),
        d.target(&table.source_schema, &table.source_name)
    );
    let into = format!(
        "INSERT INTO {} ({}) VALUES",
        d.target(&table.target_schema, &table.target_name),
        table
            .columns
            .iter()
            .map(|c| d.quote(&c.target))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let insert = format!(
        "{into} ({})",
        table
            .columns
            .iter()
            .enumerate()
            .map(|(i, c)| insert_expr(i + 1, &c.target_type))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let read_error = |e: oracle::Error| {
        format!(
            "Quelle {}.{} lesen: {e}",
            table.source_schema, table.source_name
        )
    };
    let write_error =
        |e: oracle::Error| format!("{}.{}: {e}", table.target_schema, table.target_name);
    let mut statement = source
        .statement(&select)
        .fetch_array_size(BATCH_ROWS as u32)
        .prefetch_rows(BATCH_ROWS as u32 + 1)
        .build()
        .map_err(read_error)?;
    let rows = statement.query(&[]).map_err(read_error)?;
    let kinds: Vec<OracleType> = rows
        .column_info()
        .iter()
        .map(|info| info.oracle_type().clone())
        .collect();
    let remap = Remap {
        target,
        from: &table.source_schema,
        to: &table.target_schema,
    };
    let mut batch = target
        .batch(&insert, BATCH_ROWS)
        .build()
        .map_err(write_error)?;
    let mut binds = Vec::with_capacity(kinds.len());
    for (index, (kind, column)) in kinds.iter().zip(&table.columns).enumerate() {
        let bind = match kind {
            OracleType::Object(source) => Some(OracleType::Object(
                remap.object_type(source).map_err(write_error)?,
            )),
            OracleType::CLOB if wrapped(&column.target_type) => Some(OracleType::CLOB),
            _ => bind_type(kind),
        };
        if let Some(bind) = &bind {
            batch.set_type(index + 1, bind).map_err(write_error)?;
        }
        binds.push(bind);
    }
    let mut copied = 0u64;
    let mut pending = (0usize, 0usize);
    for row in rows {
        if cancel.is_cancelled() {
            return Err("Transfer vom Benutzer abgebrochen.".into());
        }
        let row = row.map_err(read_error)?;
        let cells = kinds
            .iter()
            .enumerate()
            .map(|(i, kind)| Ok(cell!(remap, kind, row.get(i))))
            .collect::<oracle::Result<Vec<_>>>()
            .map_err(read_error)?;
        let empty: Vec<Option<&str>> = cells
            .iter()
            .zip(&kinds)
            .map(|(cell, kind)| cell.empty_lob(kind))
            .collect();
        if empty.iter().any(Option::is_some) {
            let mut exprs = Vec::new();
            let mut params = Vec::new();
            for (index, column) in table.columns.iter().enumerate() {
                if let Some(expr) = empty[index] {
                    exprs.push(expr.to_string());
                    continue;
                }
                exprs.push(insert_expr(params.len() + 1, &column.target_type));
                let value = cells[index].sql();
                let kind = match &binds[index] {
                    Some(kind) => kind.clone(),
                    None => value.oratype(target).map_err(write_error)?,
                };
                params.push(Typed(value, kind));
            }
            let values: Vec<&dyn ToSql> = params.iter().map(|p| p as &dyn ToSql).collect();
            target
                .execute(&format!("{into} ({})", exprs.join(", ")), &values)
                .map_err(write_error)?;
            copied += 1;
            continue;
        }
        let values: Vec<&dyn ToSql> = cells.iter().map(Cell::sql).collect();
        batch.append_row(&values).map_err(write_error)?;
        pending.0 += 1;
        pending.1 += cells.iter().map(Cell::size).sum::<usize>();
        if pending.0 >= BATCH_ROWS || pending.1 >= BATCH_BYTES {
            batch.execute().map_err(write_error)?;
            copied += pending.0 as u64;
            pending = (0, 0);
            let _ = progress.send(copied);
        }
    }
    batch.execute().map_err(write_error)?;
    copied += pending.0 as u64;
    let _ = progress.send(copied);
    Ok(copied)
}

const DROPPABLE: [&str; 20] = [
    "MATERIALIZED VIEW",
    "TABLE",
    "VIEW",
    "SYNONYM",
    "SEQUENCE",
    "FUNCTION",
    "PROCEDURE",
    "PACKAGE",
    "TRIGGER",
    "INDEX",
    "TYPE",
    "CLUSTER",
    "DIMENSION",
    "OPERATOR",
    "INDEXTYPE",
    "LIBRARY",
    "JOB",
    "PROGRAM",
    "SCHEDULE",
    "CHAIN",
];

pub async fn objects(
    adapter: &dyn DatabaseAdapter,
    schema: &str,
) -> Result<Vec<(String, String)>, String> {
    let sql = format!(
        "SELECT object_type AS t, object_name AS n FROM all_objects o WHERE owner = {} AND object_type IN ({}) \
         AND secondary = 'N' AND object_name NOT LIKE 'BIN$%' AND object_name NOT LIKE 'ISEQ$$\\_%' ESCAPE '\\' \
         AND NOT (object_type = 'TABLE' AND EXISTS (SELECT 1 FROM all_nested_tables x WHERE x.owner = o.owner AND x.table_name = o.object_name)) \
         AND NOT (object_type = 'TABLE' AND EXISTS (SELECT 1 FROM all_mviews m WHERE m.owner = o.owner AND m.container_name = o.object_name)) \
         AND NOT (object_type = 'TABLE' AND EXISTS (SELECT 1 FROM all_mview_logs l WHERE l.log_owner = o.owner AND l.log_table = o.object_name)) \
         AND NOT (object_type = 'INDEX' AND EXISTS (SELECT 1 FROM all_indexes i WHERE i.owner = o.owner AND i.index_name = o.object_name AND i.table_owner = o.owner)) \
         ORDER BY object_type, object_name",
        super::super::quote_literal(schema),
        DROPPABLE
            .iter()
            .map(|t| format!("'{t}'"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let result = adapter.execute_query(&sql).await?;
    Ok(result
        .rows
        .iter()
        .filter_map(|row| {
            let text = |key: &str| row.get(key).and_then(super::super::export::value_text);
            Some((text("T")?, text("N")?))
        })
        .collect())
}

pub(super) fn drop_statement(schema: &str, kind: &str, name: &str) -> String {
    let d = Dialect::Oracle;
    let qualified = d.target(schema, name);
    match kind {
        "TABLE" => format!("DROP TABLE {qualified} CASCADE CONSTRAINTS PURGE"),
        "VIEW" => format!("DROP VIEW {qualified} CASCADE CONSTRAINTS"),
        "TYPE" => format!("DROP TYPE {qualified} FORCE"),
        "CLUSTER" => format!("DROP CLUSTER {qualified} INCLUDING TABLES CASCADE CONSTRAINTS"),
        "OPERATOR" => format!("DROP OPERATOR {qualified} FORCE"),
        "JOB" | "PROGRAM" | "SCHEDULE" | "CHAIN" => format!(
            "BEGIN DBMS_SCHEDULER.DROP_{kind}({}, TRUE); END;",
            d.text_literal(&qualified)
        ),
        _ => format!("DROP {kind} {qualified}"),
    }
}

pub async fn clear(adapter: &dyn DatabaseAdapter, schema: &str) -> Result<Vec<String>, String> {
    let gone = |error: &str| error.contains("ORA-04043") || error.contains("ORA-00942");
    let mut failures: Vec<String> = Vec::new();
    let mut previous = Vec::new();
    for _ in 0..32 {
        let remaining = objects(adapter, schema).await?;
        if remaining.is_empty() {
            return Ok(Vec::new());
        }
        if remaining == previous {
            break;
        }
        failures.clear();
        for (kind, name) in &remaining {
            if super::super::execution::cancellation_token().is_cancelled() {
                return Err("Transfer vom Benutzer abgebrochen.".into());
            }
            let sql = drop_statement(schema, kind, name);
            let error = match adapter.execute_script(&sql).await {
                Ok(results) => results
                    .iter()
                    .find_map(|r| (!r.success).then(|| r.error.clone().unwrap_or_default())),
                Err(error) => Some(error),
            };
            if let Some(error) = error.filter(|e| !gone(e)) {
                failures.push(format!("{kind} {schema}.{name}: {error}"));
            }
        }
        previous = remaining;
    }
    if failures.is_empty() {
        failures = previous
            .iter()
            .map(|(kind, name)| format!("{kind} {schema}.{name}"))
            .collect();
    }
    Ok(failures)
}

async fn invalid_objects(
    adapter: &dyn DatabaseAdapter,
    owner: &str,
) -> Result<Vec<(String, String, String)>, String> {
    let result = adapter
        .execute_query(&format!(
            "SELECT o.object_type AS t, o.object_name AS n, \
             (SELECT MIN(e.text) KEEP (DENSE_RANK FIRST ORDER BY e.sequence) FROM all_errors e \
              WHERE e.owner = o.owner AND e.name = o.object_name AND e.type = o.object_type AND e.attribute = 'ERROR') AS e \
             FROM all_objects o WHERE o.owner = {} AND o.status = 'INVALID' ORDER BY 1, 2",
            super::super::quote_literal(owner)
        ))
        .await?;
    Ok(result
        .rows
        .iter()
        .map(|row| {
            let get = |key: &str| {
                row.get(key)
                    .and_then(super::super::export::value_text)
                    .unwrap_or_default()
            };
            (get("T"), get("N"), get("E"))
        })
        .collect())
}

pub async fn recompile(
    target: &dyn DatabaseAdapter,
    source: &dyn DatabaseAdapter,
    pairs: &[SchemaPair],
) -> Result<(Vec<String>, Vec<String>), String> {
    let (mut broken, mut inherited) = (Vec::new(), Vec::new());
    for pair in pairs {
        if invalid_objects(target, &pair.target).await?.is_empty() {
            continue;
        }
        let _ = target
            .execute_script(&format!(
                "BEGIN DBMS_UTILITY.COMPILE_SCHEMA({}, FALSE); END;",
                super::super::quote_literal(&pair.target)
            ))
            .await;
        let still = invalid_objects(target, &pair.target).await?;
        if still.is_empty() {
            continue;
        }
        let known: Vec<(String, String)> = invalid_objects(source, &pair.source)
            .await?
            .into_iter()
            .map(|(kind, name, _)| (kind, name))
            .collect();
        for (kind, name, error) in still {
            let label = format!("{kind} {}.{name}", pair.target);
            if known.contains(&(kind, name)) {
                inherited.push(label);
            } else if error.is_empty() {
                broken.push(label);
            } else {
                broken.push(format!("{label} ({})", error.trim()));
            }
        }
    }
    Ok((broken, inherited))
}

pub async fn container_id(adapter: &dyn DatabaseAdapter) -> Result<String, String> {
    let result = adapter
        .execute_query("SELECT SYS_CONTEXT('USERENV', 'CON_DBID') || '/' || SYS_CONTEXT('USERENV', 'DB_UNIQUE_NAME') AS ID FROM DUAL")
        .await?;
    result
        .rows
        .first()
        .and_then(|row| row.get("ID"))
        .and_then(super::super::export::value_text)
        .ok_or_else(|| "Datenbankkennung nicht lesbar.".to_string())
}

impl Copier {
    pub async fn open(
        source: &Endpoint,
        target: &Endpoint,
        pool: &PoolState,
    ) -> Result<Self, String> {
        let source = open(source, pool).await?;
        let target = open(target, pool).await?;
        let reader = source.clone();
        blocking(move || {
            lock(&reader)?
                .execute("SET TRANSACTION READ ONLY", &[])
                .map(|_| ())
                .map_err(|e| format!("Quelle ohne lesekonsistente Transaktion: {e}"))
        })
        .await?;
        Ok(Self { source, target })
    }

    pub async fn copy(
        &self,
        table: &TransferTable,
        report: &mut (dyn FnMut(u64) + Send),
    ) -> Result<u64, String> {
        let (source, target) = (self.source.clone(), self.target.clone());
        let cancel = super::super::execution::cancellation_token();
        let job = table.clone();
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::task::spawn_blocking(move || {
            let source = lock(&source)?;
            let target = lock(&target)?;
            let result = copy_rows(&source, &target, &job, &cancel, &sender).and_then(|rows| {
                let counted: String = target
                    .query_row_as(
                        &format!(
                            "SELECT TO_CHAR(COUNT(*)) FROM {}",
                            Dialect::Oracle.target(&job.target_schema, &job.target_name)
                        ),
                        &[],
                    )
                    .map_err(|e| format!("{}.{}: {e}", job.target_schema, job.target_name))?;
                if counted != rows.to_string() {
                    return Err(format!(
                        "Verifikation fehlgeschlagen für {}.{}: {rows} Zeilen gelesen, {counted} im Ziel gezählt.",
                        job.target_schema, job.target_name
                    ));
                }
                target.commit().map_err(|e| {
                    format!(
                        "Commit für {}.{} nicht bestätigt: {e}",
                        job.target_schema, job.target_name
                    )
                })?;
                Ok(rows)
            });
            if result.is_err() {
                let _ = target.rollback();
            }
            result
        });
        while let Some(rows) = receiver.recv().await {
            report(rows);
        }
        task.await
            .map_err(|e| format!("Oracle-Task fehlgeschlagen: {e}"))?
    }

    pub async fn close(self) {
        let source = self.source;
        let _ = blocking(move || {
            let _ = lock(&source)?.rollback();
            Ok(())
        })
        .await;
    }
}
