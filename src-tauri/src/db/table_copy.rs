use serde::{Deserialize, Serialize};

use super::import::{self, BatchWriter, Dialect};
use super::pool::PoolState;
use super::provider::DatabaseKind;
use super::{DatabaseAdapter, DetailedColumnInfo};

pub const COPY_BATCH_ROWS: i64 = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CopyMode {
    Create,
    Truncate,
    Append,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopySource {
    pub kind: DatabaseKind,
    pub connection_string: String,
    pub database: Option<String>,
    pub schema: String,
    pub table: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCopyRequest {
    pub source: CopySource,
    pub target_schema: String,
    pub target_table: String,
    pub mode: CopyMode,
    pub include_primary_key: bool,
    pub include_indexes: bool,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCopyOutcome {
    pub rows: u64,
    pub created: bool,
    pub statements: Vec<String>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Canonical {
    Bool,
    SmallInt,
    Int,
    BigInt,
    Decimal(Option<(u32, u32)>),
    Real,
    Double,
    Char(Option<u32>),
    Varchar(Option<u32>),
    Text,
    Date,
    Time,
    Timestamp,
    TimestampTz,
    Binary,
    Json,
    Uuid,
}

fn type_args(lower: &str) -> Vec<u32> {
    lower
        .split_once('(')
        .and_then(|(_, rest)| rest.split_once(')'))
        .map(|(args, _)| {
            args.split(',')
                .filter_map(|part| {
                    part.trim()
                        .trim_end_matches(" char")
                        .trim_end_matches(" byte")
                        .parse()
                        .ok()
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn canonical(source: DatabaseKind, data_type: &str, length: Option<i32>) -> Canonical {
    let lower = import::base_type(data_type);
    let base = lower.split('(').next().unwrap_or("").trim().to_string();
    let base = base
        .strip_suffix(" unsigned")
        .unwrap_or(&base)
        .trim()
        .to_string();
    let args = type_args(&lower);
    let length = args
        .first()
        .copied()
        .or_else(|| length.filter(|n| *n > 0).map(|n| n as u32));
    if lower.ends_with("[]") || lower.starts_with("array") {
        return Canonical::Text;
    }
    if lower.contains("max)") {
        return if base.contains("binary") {
            Canonical::Binary
        } else {
            Canonical::Text
        };
    }
    if lower == "tinyint(1)" || lower == "bit(1)" || base == "bit" || base.starts_with("bool") {
        return Canonical::Bool;
    }
    if lower.contains("with time zone")
        || lower.contains("with local time zone")
        || base == "timestamptz"
        || base == "datetimeoffset"
    {
        return Canonical::TimestampTz;
    }
    match base.as_str() {
        "smallint" | "int2" | "tinyint" | "smallserial" | "int8_t" | "int16" | "uint8"
        | "utinyint" | "usmallint" => Canonical::SmallInt,
        "integer" | "int" | "int4" | "mediumint" | "serial" | "int32" | "uint16" => Canonical::Int,
        "bigint" | "int8" | "bigserial" | "int64" | "uint32" | "uinteger" => Canonical::BigInt,
        "numeric" | "decimal" | "number" | "dec" => match args.as_slice() {
            [p] => Canonical::Decimal(Some((*p, 0))),
            [p, s] => Canonical::Decimal(Some((*p, *s))),
            _ => Canonical::Decimal(None),
        },
        "money" | "smallmoney" => Canonical::Decimal(Some((19, 4))),
        "real" | "float4" | "binary_float" | "float32" => Canonical::Real,
        "float" | "float8" | "double" | "double precision" | "binary_double" | "float64" => {
            Canonical::Double
        }
        "char" | "character" | "nchar" | "bpchar" | "fixedstring" => Canonical::Char(length),
        "varchar" | "character varying" | "nvarchar" | "varchar2" | "nvarchar2" => {
            Canonical::Varchar(length)
        }
        "date" if source == DatabaseKind::Oracle => Canonical::Timestamp,
        "date" | "date32" => Canonical::Date,
        "time" | "time without time zone" => Canonical::Time,
        "bytea" | "blob" | "longblob" | "mediumblob" | "tinyblob" | "binary" | "varbinary"
        | "image" | "raw" | "long raw" => Canonical::Binary,
        "json" | "jsonb" => Canonical::Json,
        "uuid" | "uniqueidentifier" => Canonical::Uuid,
        _ if base.starts_with("timestamp")
            || base.starts_with("datetime")
            || base == "smalldatetime" =>
        {
            Canonical::Timestamp
        }
        _ if base.starts_with("uint") || base.starts_with("int") && base.len() <= 6 => {
            Canonical::BigInt
        }
        _ if base.starts_with("decimal") => Canonical::Decimal(None),
        _ => Canonical::Text,
    }
}

pub fn render(target: Dialect, canonical: Canonical, keyed: bool) -> String {
    use Canonical::*;
    let decimal_limit = match target {
        Dialect::Mysql => 65,
        Dialect::Clickhouse => 76,
        Dialect::Postgres | Dialect::Sqlite => 1000,
        _ => 38,
    };
    let text_key = || match target {
        Dialect::Mysql => "VARCHAR(255)".to_string(),
        Dialect::Mssql => "NVARCHAR(450)".to_string(),
        Dialect::Oracle => "VARCHAR2(1000 CHAR)".to_string(),
        _ => render(target, Text, false),
    };
    match (target, canonical) {
        (_, Text | Json) if keyed => text_key(),
        (_, Varchar(None)) if keyed => text_key(),
        (Dialect::Mysql, Binary) if keyed => "VARBINARY(255)".into(),
        (Dialect::Mssql, Binary) if keyed => "VARBINARY(900)".into(),
        (Dialect::Oracle, Binary) if keyed => "RAW(2000)".into(),
        (_, Decimal(Some((p, _)))) if p > decimal_limit => render(target, Text, keyed),
        (Dialect::Postgres, c) => match c {
            Bool => "boolean".into(),
            SmallInt => "smallint".into(),
            Int => "integer".into(),
            BigInt => "bigint".into(),
            Decimal(Some((p, s))) => format!("numeric({p},{s})"),
            Decimal(None) => "numeric".into(),
            Real => "real".into(),
            Double => "double precision".into(),
            Char(Some(n)) => format!("char({n})"),
            Varchar(Some(n)) => format!("varchar({n})"),
            Char(None) | Varchar(None) | Text => "text".into(),
            Date => "date".into(),
            Time => "time".into(),
            Timestamp => "timestamp".into(),
            TimestampTz => "timestamptz".into(),
            Binary => "bytea".into(),
            Json => "jsonb".into(),
            Uuid => "uuid".into(),
        },
        (Dialect::Mysql, c) => match c {
            Bool => "TINYINT(1)".into(),
            SmallInt => "SMALLINT".into(),
            Int => "INT".into(),
            BigInt => "BIGINT".into(),
            Decimal(Some((p, s))) => format!("DECIMAL({p},{})", s.min(30)),
            Decimal(None) => "DECIMAL(65,20)".into(),
            Real => "FLOAT".into(),
            Double => "DOUBLE".into(),
            Char(Some(n)) if n <= 255 => format!("CHAR({n})"),
            Char(Some(n)) | Varchar(Some(n)) if n <= 16_383 => format!("VARCHAR({n})"),
            Char(_) | Varchar(_) | Text => "LONGTEXT".into(),
            Date => "DATE".into(),
            Time => "TIME(6)".into(),
            Timestamp | TimestampTz => "DATETIME(6)".into(),
            Binary => "LONGBLOB".into(),
            Json => "JSON".into(),
            Uuid => "CHAR(36)".into(),
        },
        (Dialect::Sqlite, c) => match c {
            Bool => "BOOLEAN".into(),
            SmallInt => "SMALLINT".into(),
            Int | BigInt => "INTEGER".into(),
            Decimal(Some((p, s))) => format!("NUMERIC({p},{s})"),
            Decimal(None) => "NUMERIC".into(),
            Real | Double => "REAL".into(),
            Char(Some(n)) | Varchar(Some(n)) => format!("VARCHAR({n})"),
            Char(None) | Varchar(None) | Text | Json | Uuid => "TEXT".into(),
            Date => "DATE".into(),
            Time => "TIME".into(),
            Timestamp | TimestampTz => "TIMESTAMP".into(),
            Binary => "BLOB".into(),
        },
        (Dialect::Mssql, c) => match c {
            Bool => "BIT".into(),
            SmallInt => "SMALLINT".into(),
            Int => "INT".into(),
            BigInt => "BIGINT".into(),
            Decimal(Some((p, s))) => format!("DECIMAL({p},{s})"),
            Decimal(None) => "DECIMAL(38,10)".into(),
            Real => "REAL".into(),
            Double => "FLOAT".into(),
            Char(Some(n)) if n <= 4000 => format!("NCHAR({n})"),
            Char(Some(n)) | Varchar(Some(n)) if n <= 4000 => format!("NVARCHAR({n})"),
            Char(_) | Varchar(_) | Text | Json => "NVARCHAR(MAX)".into(),
            Date => "DATE".into(),
            Time => "TIME".into(),
            Timestamp => "DATETIME2".into(),
            TimestampTz => "DATETIMEOFFSET".into(),
            Binary => "VARBINARY(MAX)".into(),
            Uuid => "UNIQUEIDENTIFIER".into(),
        },
        (Dialect::Oracle, c) => match c {
            Bool => "NUMBER(1)".into(),
            SmallInt => "NUMBER(5)".into(),
            Int => "NUMBER(10)".into(),
            BigInt => "NUMBER(19)".into(),
            Decimal(Some((p, s))) => format!("NUMBER({p},{s})"),
            Decimal(None) => "NUMBER".into(),
            Real => "BINARY_FLOAT".into(),
            Double => "BINARY_DOUBLE".into(),
            Char(Some(n)) if n <= 2000 => format!("CHAR({n} CHAR)"),
            Char(Some(n)) | Varchar(Some(n)) if n <= 4000 => format!("VARCHAR2({n} CHAR)"),
            Char(_) | Varchar(_) | Text | Json => "CLOB".into(),
            Date | Timestamp => "TIMESTAMP(6)".into(),
            Time => "VARCHAR2(32)".into(),
            TimestampTz => "TIMESTAMP(6) WITH TIME ZONE".into(),
            Binary => "BLOB".into(),
            Uuid => "VARCHAR2(36)".into(),
        },
        (Dialect::Clickhouse, c) => match c {
            Bool => "Bool".into(),
            SmallInt => "Int16".into(),
            Int => "Int32".into(),
            BigInt => "Int64".into(),
            Decimal(Some((p, s))) => format!("Decimal({p},{s})"),
            Decimal(None) => "Decimal(38,10)".into(),
            Real => "Float32".into(),
            Double => "Float64".into(),
            Date => "Date32".into(),
            Timestamp | TimestampTz => "DateTime64(6)".into(),
            Uuid => "UUID".into(),
            _ => "String".into(),
        },
        (Dialect::Duckdb, c) => match c {
            Bool => "BOOLEAN".into(),
            SmallInt => "SMALLINT".into(),
            Int => "INTEGER".into(),
            BigInt => "BIGINT".into(),
            Decimal(Some((p, s))) => format!("DECIMAL({p},{s})"),
            Decimal(None) => "DECIMAL(38,10)".into(),
            Real => "REAL".into(),
            Double => "DOUBLE".into(),
            Char(Some(n)) | Varchar(Some(n)) => format!("VARCHAR({n})"),
            Char(None) | Varchar(None) | Text | Json => "VARCHAR".into(),
            Date => "DATE".into(),
            Time => "TIME".into(),
            Timestamp => "TIMESTAMP".into(),
            TimestampTz => "TIMESTAMPTZ".into(),
            Binary => "BLOB".into(),
            Uuid => "UUID".into(),
        },
    }
}

#[derive(Debug, Clone)]
pub struct MappedColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

pub fn map_columns(
    source: DatabaseKind,
    target: Dialect,
    columns: &[DetailedColumnInfo],
    keyed: &[String],
) -> (Vec<MappedColumn>, Vec<String>) {
    let mut warnings = Vec::new();
    let mapped = columns
        .iter()
        .map(|column| {
            let canonical = canonical(source, &column.data_type, column.character_maximum_length);
            if canonical == Canonical::TimestampTz
                && matches!(
                    target,
                    Dialect::Mysql | Dialect::Sqlite | Dialect::Clickhouse
                )
            {
                warnings.push(format!(
                    "Spalte {}: Zeitzonenangabe geht bei der Zielfamilie verloren.",
                    column.name
                ));
            }
            MappedColumn {
                name: column.name.clone(),
                data_type: render(target, canonical, keyed.contains(&column.name)),
                nullable: column.is_nullable,
            }
        })
        .collect();
    (mapped, warnings)
}

pub fn create_table_sql(
    target: Dialect,
    schema: &str,
    table: &str,
    columns: &[MappedColumn],
    primary_key: &[String],
) -> String {
    let mut parts: Vec<String> = columns
        .iter()
        .map(|column| {
            let not_null = !column.nullable || primary_key.contains(&column.name);
            let data_type = if target == Dialect::Clickhouse && !not_null {
                format!("Nullable({})", column.data_type)
            } else {
                column.data_type.clone()
            };
            format!(
                "{} {}{}",
                target.quote(&column.name),
                data_type,
                if not_null && target != Dialect::Clickhouse {
                    " NOT NULL"
                } else {
                    ""
                }
            )
        })
        .collect();
    let keys = primary_key
        .iter()
        .map(|key| target.quote(key))
        .collect::<Vec<_>>()
        .join(", ");
    if !primary_key.is_empty() && target != Dialect::Clickhouse {
        parts.push(format!("PRIMARY KEY ({keys})"));
    }
    let mut sql = format!(
        "CREATE TABLE {} ({})",
        target.target(schema, table),
        parts.join(", ")
    );
    if target == Dialect::Clickhouse {
        sql.push_str(&format!(
            " ENGINE = MergeTree ORDER BY {}",
            if primary_key.is_empty() {
                "tuple()".to_string()
            } else {
                format!("({keys})")
            }
        ));
    }
    sql
}

pub fn index_name(target: Dialect, table: &str, number: usize) -> String {
    let limit = if target == Dialect::Oracle { 30 } else { 60 };
    let suffix = format!("_ix{number}");
    let stem: String = table
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .take(limit - suffix.len())
        .collect();
    format!("{}{suffix}", if stem.is_empty() { "t" } else { &stem })
}

pub fn create_index_sql(
    target: Dialect,
    schema: &str,
    table: &str,
    name: &str,
    unique: bool,
    columns: &[String],
) -> String {
    let columns = columns
        .iter()
        .map(|column| target.quote(column))
        .collect::<Vec<_>>()
        .join(", ");
    let (name, table) = match target {
        Dialect::Oracle => (target.target(schema, name), target.target(schema, table)),
        Dialect::Sqlite => (target.target(schema, name), target.quote(table)),
        _ => (target.quote(name), target.target(schema, table)),
    };
    format!(
        "CREATE {}INDEX {name} ON {table} ({columns})",
        if unique { "UNIQUE " } else { "" }
    )
}

async fn primary_key(
    adapter: &dyn DatabaseAdapter,
    schema: &str,
    table: &str,
    columns: &[DetailedColumnInfo],
) -> Vec<String> {
    if let Ok(constraints) = adapter.list_constraints(schema, table).await {
        if let Some(pk) = constraints
            .into_iter()
            .find(|c| c.constraint_type == "PRIMARY KEY" && !c.columns.is_empty())
        {
            return pk.columns;
        }
    }
    columns
        .iter()
        .filter(|column| column.is_primary_key)
        .map(|column| column.name.clone())
        .collect()
}

struct Planned {
    statements: Vec<String>,
    indexes: Vec<String>,
    warnings: Vec<String>,
    primary_key: Vec<String>,
}

async fn plan_ddl(
    request: &TableCopyRequest,
    source: &dyn DatabaseAdapter,
    target: Dialect,
    columns: &[DetailedColumnInfo],
) -> Result<Planned, String> {
    let primary_key = primary_key(
        source,
        &request.source.schema,
        &request.source.table,
        columns,
    )
    .await;
    let mut warnings = Vec::new();
    let indexes_source = if request.include_indexes {
        match source
            .list_indexes(&request.source.schema, &request.source.table)
            .await
        {
            Ok(indexes) => indexes
                .into_iter()
                .filter(|index| !index.is_primary)
                .collect(),
            Err(error) => {
                warnings.push(format!("Indizes nicht übernommen: {error}"));
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };
    let mut keyed: Vec<String> = if request.include_primary_key {
        primary_key.clone()
    } else {
        Vec::new()
    };
    for index in &indexes_source {
        keyed.extend(index.columns.iter().cloned());
    }
    let (mapped, mut mapping_warnings) = map_columns(request.source.kind, target, columns, &keyed);
    warnings.append(&mut mapping_warnings);
    let pk = if request.include_primary_key {
        primary_key.clone()
    } else {
        Vec::new()
    };
    let mut statements = Vec::new();
    if request.mode == CopyMode::Create {
        statements.push(create_table_sql(
            target,
            &request.target_schema,
            &request.target_table,
            &mapped,
            &pk,
        ));
    }
    let mut indexes = Vec::new();
    if request.mode == CopyMode::Create && target != Dialect::Clickhouse {
        for (number, index) in indexes_source.iter().enumerate() {
            if index.columns.is_empty()
                || index
                    .columns
                    .iter()
                    .any(|column| !columns.iter().any(|c| &c.name == column))
            {
                warnings.push(format!(
                    "Index {} wird übersprungen (Ausdrucksindex oder unbekannte Spalten).",
                    index.name
                ));
                continue;
            }
            indexes.push(create_index_sql(
                target,
                &request.target_schema,
                &request.target_table,
                &index_name(target, &request.target_table, number + 1),
                index.is_unique,
                &index.columns,
            ));
        }
    }
    Ok(Planned {
        statements,
        indexes,
        warnings,
        primary_key,
    })
}

fn target_column(target: &[super::ImportColumnInfo], name: &str) -> Option<String> {
    target
        .iter()
        .find(|column| column.name == name)
        .or_else(|| {
            target
                .iter()
                .find(|column| column.name.eq_ignore_ascii_case(name))
        })
        .map(|column| column.name.clone())
}

pub async fn copy_table(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    pool: PoolState,
    request: &TableCopyRequest,
) -> Result<TableCopyOutcome, String> {
    let target = Dialect::from_kind(kind)
        .ok_or("Tabellenkopie in diesen Datenbanktyp wird nicht unterstützt.")?;
    if request.target_table.trim().is_empty() {
        return Err("Zieltabelle fehlt.".into());
    }
    let source = super::create_adapter_from_string(
        request.source.kind,
        &request.source.connection_string,
        request.source.database.as_deref(),
        pool.clone(),
    )?;
    let columns = source
        .list_table_columns_detailed(&request.source.schema, &request.source.table)
        .await?
        .into_iter()
        .filter(|column| column.name != "__ctid__")
        .collect::<Vec<_>>();
    if columns.is_empty() {
        return Err("Quelltabelle hat keine Spalten.".into());
    }
    let planned = plan_ddl(request, source.as_ref(), target, &columns).await?;
    let mut outcome = TableCopyOutcome {
        statements: planned
            .statements
            .iter()
            .chain(&planned.indexes)
            .cloned()
            .collect(),
        warnings: planned.warnings.clone(),
        ..Default::default()
    };
    if request.dry_run {
        return Ok(outcome);
    }
    let target_adapter =
        super::create_adapter_from_string(kind, connection_string, database, pool.clone())?;
    if kind == DatabaseKind::Postgres
        && super::connection::connection_string_is_read_only(connection_string)
    {
        return Err("Lesemodus: Die Zielverbindung ist schreibgeschützt.".into());
    }
    for statement in &planned.statements {
        target_adapter.execute_query(statement).await?;
        outcome.created = true;
    }
    let result = copy_rows(
        request,
        source.as_ref(),
        target_adapter.as_ref(),
        target,
        &columns,
        &planned.primary_key,
        kind,
        connection_string,
        database,
        pool,
        &mut outcome,
    )
    .await;
    if let Err(error) = result {
        outcome.error = Some(error);
    }
    if outcome.error.is_some() {
        if outcome.created {
            match target_adapter
                .drop_table(&request.target_schema, &request.target_table)
                .await
            {
                Ok(()) => outcome.created = false,
                Err(error) => outcome
                    .warnings
                    .push(format!("Angelegte Zieltabelle nicht entfernt: {error}")),
            }
        }
        outcome.rows = 0;
        return Ok(outcome);
    }
    for statement in &planned.indexes {
        if let Err(error) = target_adapter.execute_query(statement).await {
            outcome
                .warnings
                .push(format!("Index nicht angelegt: {error}"));
        }
    }
    Ok(outcome)
}

#[allow(clippy::too_many_arguments)]
async fn copy_rows(
    request: &TableCopyRequest,
    source: &dyn DatabaseAdapter,
    target_adapter: &dyn DatabaseAdapter,
    target: Dialect,
    columns: &[DetailedColumnInfo],
    primary_key: &[String],
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    pool: PoolState,
    outcome: &mut TableCopyOutcome,
) -> Result<(), String> {
    let target_columns = import::list_import_columns(
        target,
        target_adapter,
        &request.target_schema,
        &request.target_table,
    )
    .await?;
    let mut pairs: Vec<(String, String)> = Vec::new();
    for column in columns {
        match target_column(&target_columns, &column.name) {
            Some(name) => pairs.push((column.name.clone(), name)),
            None => outcome.warnings.push(format!(
                "Spalte {} fehlt in der Zieltabelle und wird ausgelassen.",
                column.name
            )),
        }
    }
    let skipped_generated: Vec<String> = target_columns
        .iter()
        .filter(|column| column.is_generated)
        .map(|column| column.name.clone())
        .collect();
    pairs.retain(|(_, target)| !skipped_generated.contains(target));
    if pairs.is_empty() {
        return Err("Keine gemeinsamen Spalten zwischen Quelle und Ziel.".into());
    }
    let target_names: Vec<String> = pairs.iter().map(|(_, target)| target.clone()).collect();
    let plan = import::prepare_plan(
        target,
        target_adapter,
        &request.target_schema,
        &request.target_table,
        &target_names,
        None,
    )
    .await?;
    if request.mode == CopyMode::Truncate {
        if let Err(error) = target_adapter
            .truncate_table(&request.target_schema, &request.target_table)
            .await
        {
            target_adapter
                .execute_query(&format!(
                    "DELETE FROM {}",
                    target.target(&request.target_schema, &request.target_table)
                ))
                .await
                .map_err(|_| error)?;
        }
    }
    let session = import::open_session(kind, connection_string, database, pool).await?;
    let mut writer = BatchWriter::new(plan, session);
    let order_by = primary_key.first().map(String::as_str);
    let mut offset = 0i64;
    loop {
        if super::execution::cancellation_token().is_cancelled() {
            let _ = writer.abort().await;
            return Err("Kopie vom Benutzer abgebrochen.".into());
        }
        let page = match source
            .fetch_rows(
                &request.source.schema,
                &request.source.table,
                None,
                COPY_BATCH_ROWS,
                offset,
                order_by,
                false,
                false,
                false,
            )
            .await
        {
            Ok(page) => page,
            Err(error) => {
                let _ = writer.abort().await;
                return Err(format!("Quelle lesen: {error}"));
            }
        };
        let fetched = page.rows.len() as i64;
        for row in &page.rows {
            let values = pairs
                .iter()
                .map(|(source, _)| row.get(source).and_then(super::export::value_text))
                .collect();
            if let Err(failure) = writer.push(values).await {
                let message = failure.message.clone();
                let result = import::finish_failure(writer, failure, &target_names).await;
                return Err(result.error.unwrap_or(message));
            }
        }
        offset += fetched;
        if fetched < COPY_BATCH_ROWS {
            break;
        }
    }
    match writer.commit().await {
        Ok(counts) => {
            outcome.rows = counts.inserted + counts.updated;
            Ok(())
        }
        Err(failure) => Err(failure.message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column(name: &str, data_type: &str, length: Option<i32>, pk: bool) -> DetailedColumnInfo {
        DetailedColumnInfo {
            name: name.into(),
            data_type: data_type.into(),
            is_nullable: !pk,
            column_default: None,
            is_primary_key: pk,
            ordinal_position: 1,
            character_maximum_length: length,
            comment: None,
        }
    }

    #[test]
    fn canonical_types_from_each_family() {
        use Canonical::*;
        let pg = DatabaseKind::Postgres;
        assert_eq!(
            canonical(pg, "character varying", Some(40)),
            Varchar(Some(40))
        );
        assert_eq!(canonical(pg, "numeric(12,3)", None), Decimal(Some((12, 3))));
        assert_eq!(canonical(pg, "timestamp with time zone", None), TimestampTz);
        assert_eq!(canonical(pg, "jsonb", None), Json);
        assert_eq!(canonical(pg, "integer[]", None), Text);
        let my = DatabaseKind::Mysql;
        assert_eq!(canonical(my, "tinyint(1)", None), Bool);
        assert_eq!(canonical(my, "int unsigned", None), Int);
        assert_eq!(canonical(my, "varchar(255)", None), Varchar(Some(255)));
        assert_eq!(canonical(my, "datetime(6)", None), Timestamp);
        let ms = DatabaseKind::Mssql;
        assert_eq!(canonical(ms, "nvarchar(max)", None), Text);
        assert_eq!(canonical(ms, "varbinary(max)", None), Binary);
        assert_eq!(canonical(ms, "uniqueidentifier", None), Uuid);
        assert_eq!(canonical(ms, "float", None), Double);
        let ora = DatabaseKind::Oracle;
        assert_eq!(canonical(ora, "DATE", None), Timestamp);
        assert_eq!(canonical(ora, "NUMBER(10,0)", None), Decimal(Some((10, 0))));
        assert_eq!(canonical(ora, "VARCHAR2(20 CHAR)", None), Varchar(Some(20)));
        assert_eq!(canonical(ora, "NUMBER", None), Decimal(None));
        assert_eq!(canonical(DatabaseKind::Sqlite, "DATE", None), Date);
        assert_eq!(
            canonical(DatabaseKind::Clickhouse, "Nullable(Int64)", None),
            BigInt
        );
    }

    #[test]
    fn renders_target_types() {
        use Canonical::*;
        assert_eq!(render(Dialect::Mysql, Text, true), "VARCHAR(255)");
        assert_eq!(
            render(Dialect::Mysql, Varchar(Some(20_000)), false),
            "LONGTEXT"
        );
        assert_eq!(
            render(Dialect::Mssql, Varchar(Some(5000)), false),
            "NVARCHAR(MAX)"
        );
        assert_eq!(render(Dialect::Mssql, Bool, false), "BIT");
        assert_eq!(render(Dialect::Oracle, Bool, false), "NUMBER(1)");
        assert_eq!(render(Dialect::Oracle, Varchar(Some(5000)), false), "CLOB");
        assert_eq!(render(Dialect::Oracle, Text, true), "VARCHAR2(1000 CHAR)");
        assert_eq!(render(Dialect::Postgres, TimestampTz, false), "timestamptz");
        assert_eq!(render(Dialect::Sqlite, BigInt, false), "INTEGER");
        assert_eq!(
            render(Dialect::Mssql, Decimal(Some((50, 2))), false),
            "NVARCHAR(MAX)"
        );
        assert_eq!(render(Dialect::Clickhouse, Date, false), "Date32");
    }

    #[test]
    fn builds_create_table_and_indexes() {
        let columns = vec![
            column("id", "integer", None, true),
            column("name", "text", None, false),
        ];
        let (mapped, _) = map_columns(
            DatabaseKind::Postgres,
            Dialect::Mysql,
            &columns,
            &["id".into(), "name".into()],
        );
        assert_eq!(
            create_table_sql(Dialect::Mysql, "app", "users", &mapped, &["id".into()]),
            "CREATE TABLE `app`.`users` (`id` INT NOT NULL, `name` VARCHAR(255), PRIMARY KEY (`id`))"
        );
        let (mapped, _) = map_columns(DatabaseKind::Mysql, Dialect::Clickhouse, &columns, &[]);
        assert_eq!(
            create_table_sql(Dialect::Clickhouse, "db", "users", &mapped, &["id".into()]),
            "CREATE TABLE `db`.`users` (`id` Int32, `name` Nullable(String)) ENGINE = MergeTree ORDER BY (`id`)"
        );
        assert_eq!(
            create_index_sql(
                Dialect::Postgres,
                "public",
                "users",
                "users_ix1",
                true,
                &["name".into()]
            ),
            "CREATE UNIQUE INDEX \"users_ix1\" ON \"public\".\"users\" (\"name\")"
        );
        assert_eq!(
            create_index_sql(Dialect::Oracle, "APP", "T", "T_IX1", false, &["A".into()]),
            "CREATE INDEX \"APP\".\"T_IX1\" ON \"APP\".\"T\" (\"A\")"
        );
        assert_eq!(index_name(Dialect::Oracle, &"x".repeat(40), 2).len(), 30);
    }
}
